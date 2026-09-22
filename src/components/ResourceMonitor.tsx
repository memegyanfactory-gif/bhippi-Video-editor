// What the machine is doing, in the header.
//
// A chip with three small meters — RAM, GPU, storage on the models drive — and a drop-down with
// the detail: the same three as cards with a bar each, then whatever Helios itself is running
// (tools mid-call, background jobs) and the memory its own processes take. The numbers come from
// the `resource_usage` command every three seconds while the window is visible; a failed poll
// keeps the last reading on screen, dimmed and marked stale, rather than blanking the chip.
//
// The activity lists come from props, not the poll, so a job's progress moves the moment the
// event lands rather than on the next tick.
import { ChevronDown, ChevronRight, Cpu, Gauge, HardDrive, LoaderCircle, MemoryStick, Square, Trash2, Video, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Job } from '../lib/types';
import type { ToolRun } from '../chat/Activity';
import { api } from '../lib/ipc';

type Gpu = { name: string | null; utilPercent: number | null; vramUsedMb: number | null; vramTotalMb: number | null; tempC: number | null };
type Drive = { letter: string; freeGb: number; totalGb: number; role: 'models' | 'project' | null };
type Process = { name: string; pid: number; ramGb: number };
type Usage = {
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskFreeGb: number;
  diskTotalGb: number;
  drive: string;
  gpu: Gpu | null;
  drives: Drive[];
  processes: Process[];
};

const INTERVAL_MS = 3000;
const TOP_PROCESSES = 8;

export type Tone = 'ok' | 'warn' | 'high';

/** Green under 70 %, amber under 90 %, red from there — the same steps as the plan meter. */
export function usageTone(percent: number): Tone {
  if (!Number.isFinite(percent)) return 'ok';
  if (percent >= 90) return 'high';
  if (percent >= 70) return 'warn';
  return 'ok';
}

/**
 * Gigabytes the way a person says them: one decimal under 100, whole numbers above, terabytes
 * from 1000 up, and never a trailing ".0". `withUnit` off gives just the number for "54.7 / 63.9 GB".
 */
export function formatGb(gb: number, withUnit = true): string {
  if (!Number.isFinite(gb)) return '—';
  const trim = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  if (gb >= 1000) return `${trim(gb / 1000)}${withUnit ? ' TB' : ''}`;
  const text = gb >= 100 ? String(Math.round(gb)) : trim(gb);
  return withUnit ? `${text} GB` : text;
}

const percentOf = (used: number, total: number) => (total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : null);
const clampPercent = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value)));
const elapsedText = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** A thin bar. `percent` null draws it empty; `tone` picks the colour, `accent` is the neutral blue for job progress. */
function Bar({ percent, tone }: { percent: number | null; tone?: Tone | 'accent' }) {
  const width = percent == null ? 0 : percent;
  const fill = tone ?? (percent == null ? 'ok' : usageTone(percent));
  return (
    <span className="rm-bar" role="progressbar" aria-valuenow={percent == null ? undefined : Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`rm-bar-fill ${fill}`} style={{ width: `${width}%` }} />
    </span>
  );
}

/** The chip's meters: icon plus bar, or icon plus a dash when there is nothing to measure. */
function ChipMeter({ icon: Icon, label, percent }: { icon: ComponentType<{ size?: number }>; label: string; percent: number | null }) {
  const text = percent == null ? `${label} —` : `${label} ${Math.round(percent)}%`;
  return (
    <span className="rm-meter" aria-label={text} title={text}>
      <Icon size={12} />
      {percent == null ? <span className="rm-meter-dash">{label} —</span> : <Bar percent={percent} />}
    </span>
  );
}

/** Identical process names fold into one row so seven WebView2 helpers read as one line. */
function groupProcesses(processes: Process[]) {
  const groups = new Map<string, { name: string; ramGb: number; pids: number[] }>();
  for (const process of processes) {
    const key = process.name.toLowerCase();
    const group = groups.get(key) ?? { name: process.name, ramGb: 0, pids: [] };
    group.ramGb += process.ramGb;
    group.pids.push(process.pid);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.ramGb - a.ramGb);
}

export function ResourceMonitor({
  jobs,
  runs,
  defaultOpen = false,
  onCancelJob,
  onDeleteJob,
}: {
  jobs: Job[];
  runs: ToolRun[];
  defaultOpen?: boolean;
  onCancelJob?: (id: string) => Promise<void> | void;
  onDeleteJob?: (id: string) => Promise<void> | void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [stale, setStale] = useState(false);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [showProcesses, setShowProcesses] = useState(false);
  const [allProcesses, setAllProcesses] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busyJobs, setBusyJobs] = useState<Record<string, 'cancelling' | 'deleting'>>({});
  const chip = useRef<HTMLButtonElement>(null);

  const handleCancel = async (id: string) => {
    setBusyJobs((prev) => ({ ...prev, [id]: 'cancelling' }));
    try {
      if (onCancelJob) {
        await onCancelJob(id);
      } else {
        await api.jobCancel(id);
      }
    } catch (e) {
      console.error('Failed to cancel job', e);
    } finally {
      setBusyJobs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setBusyJobs((prev) => ({ ...prev, [id]: 'deleting' }));
    try {
      if (onDeleteJob) {
        await onDeleteJob(id);
      } else {
        await api.jobCancel(id).catch(() => undefined);
        await api.jobDelete(id).catch(() => undefined);
      }
    } catch (e) {
      console.error('Failed to delete job', e);
    } finally {
      setBusyJobs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Poll while the window is visible. A hidden window stops the loop entirely and the
  // visibility change restarts it, so a minimised app does not keep spawning PowerShell.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const value = await invoke<Usage | null>('resource_usage');
        if (stopped) return;
        if (value) {
          setUsage({ ...value, drives: Array.isArray(value.drives) ? value.drives : [], processes: Array.isArray(value.processes) ? value.processes : [] });
          setStale(false);
          setReadAt(Date.now());
        } else {
          setStale(true);
        }
      } catch {
        if (!stopped) setStale(true);
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = setTimeout(poll, INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !inFlight) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The "updated N s ago" line and the tools' elapsed times only tick while the panel is open;
  // the header does not need to re-render every second for a closed one.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeJobs = jobs.filter((job) => job.status === 'running');
  const activeRuns = runs.filter((run) => run.status === 'running');
  const activeCount = activeJobs.length + activeRuns.length;

  const isVideoJob = (job: Job) => {
    const label = job.label.toLowerCase();
    const kind = job.kind.toLowerCase();
    return (
      (kind === 'generation' && label.includes('video')) ||
      label.includes('wan') ||
      label.includes('ltx') ||
      label.includes('t2v') ||
      label.includes('i2v') ||
      (job.result as { task?: string } | undefined)?.task === 'video'
    );
  };

  const isHeavyJob = (job: Job) => isVideoJob(job) || job.kind === 'generation';
  const activeVideoJob = activeJobs.find(isVideoJob) ?? activeJobs.find(isHeavyJob);

  const ramPercent = usage ? percentOf(usage.ramUsedGb, usage.ramTotalGb) : null;
  const cpuPercent = usage ? clampPercent(usage.cpuPercent) : null;
  const gpu = usage?.gpu ?? null;
  const gpuPercent = gpu ? clampPercent(gpu.utilPercent) : null;
  const drives = usage?.drives ?? [];
  // The models drive is the one holding the data folder; older backends only send the flat fields.
  const models: Drive | null = usage
    ? (drives.find((drive) => drive.role === 'models') ?? { letter: usage.drive.replace(/:$/, ''), freeGb: usage.diskFreeGb, totalGb: usage.diskTotalGb, role: 'models' })
    : null;
  const otherDrives = drives.filter((drive) => drive !== models);
  const storageUsedGb = models ? Math.max(0, models.totalGb - models.freeGb) : 0;
  const storagePercent = models ? percentOf(storageUsedGb, models.totalGb) : null;
  const heliosGb = useMemo(() => (usage?.processes ?? []).reduce((sum, process) => sum + process.ramGb, 0), [usage]);
  const groups = useMemo(() => groupProcesses(usage?.processes ?? []), [usage]);
  const visibleGroups = allProcesses ? groups : groups.slice(0, TOP_PROCESSES);

  const chipText = !usage
    ? 'Reading…'
    : `${formatGb(usage.ramUsedGb)} · ${gpuPercent == null ? 'GPU —' : `${Math.round(gpuPercent)}%`} · ${models ? `${formatGb(models.freeGb)} free` : '—'}`;
  const chipTitle = usage
    ? `RAM ${Math.round(ramPercent ?? 0)}% · GPU ${gpuPercent == null ? '—' : `${Math.round(gpuPercent)}%`} · ${models ? `${models.letter}: ${Math.round(storagePercent ?? 0)}% used` : ''}${stale ? ' · stale' : ''}`
    : 'System usage and Helios activity';
  const agoSeconds = readAt ? Math.max(0, Math.round((now - readAt) / 1000)) : null;

  const vramPercent = gpu && gpu.vramUsedMb != null && gpu.vramTotalMb != null ? percentOf(gpu.vramUsedMb, gpu.vramTotalMb) : null;
  const vramValue = gpu && gpu.vramUsedMb != null && gpu.vramTotalMb != null
    ? `${formatGb(gpu.vramUsedMb / 1024, false)} / ${formatGb(gpu.vramTotalMb / 1024)}`
    : null;
  // Name and temperature share the sub line (like the GPU name did on its own before); the VRAM
  // row's own value slot is only 60px, so keeping it to "used / total" is what keeps that row's
  // text from clipping the way the old three-part "13 % · 0.9 / 10 GB VRAM · 40 °C" string did.
  const gpuSub = gpu
    ? [gpu.name, gpu.tempC == null ? null : `${Math.round(gpu.tempC)}°C`].filter(Boolean).join(' · ') || (usage ? 'No GPU reading' : 'Reading…')
    : (usage ? 'No GPU reading' : 'Reading…');

  return (
    <div className="rm-anchor">
      <button
        type="button"
        ref={chip}
        className={`bar-chip rm-chip${open ? ' active' : ''}${stale ? ' stale' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={chipTitle}
      >
        <ChipMeter icon={MemoryStick} label="RAM" percent={ramPercent} />
        <ChipMeter icon={Gauge} label="GPU" percent={gpuPercent} />
        <ChipMeter icon={HardDrive} label="Storage" percent={storagePercent} />
        <span className="rm-chip-text">{chipText}</span>
        {activeCount > 0 && (
          <span className="rm-chip-badge" title={`${activeCount} running`}>
            <LoaderCircle size={10} className="rm-spin" />
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="bar-scrim" onPointerDown={() => setOpen(false)} aria-hidden="true" />
          <div className="bar-popover rm-popover" role="dialog" aria-label="System and Helios activity">
            <div className="rm-head">
              <span className={`rm-live${stale ? ' stale' : ''}`} aria-hidden="true" />
              <span className="rm-title">System &amp; Helios</span>
              <span className="rm-meta">
                {stale ? 'stale · ' : ''}
                {agoSeconds == null ? 'waiting for the first reading' : `updated ${agoSeconds} s ago`} · every {INTERVAL_MS / 1000} s
              </span>
              <button type="button" className="rm-close" onClick={() => setOpen(false)} aria-label="Close">
                <X size={12} />
              </button>
            </div>

            <div className={`rm-cards${stale ? ' stale' : ''}`}>
              <div className="rm-card">
                <div className="rm-card-head"><MemoryStick size={13} /><span className="rm-card-label">RAM</span></div>
                <div className="rm-card-value">{usage ? <>{formatGb(usage.ramUsedGb, false)} / {formatGb(usage.ramTotalGb)}</> : '—'}</div>
                <Bar percent={ramPercent} />
                <div className="rm-card-sub">{usage ? `Helios processes use ${formatGb(heliosGb)}` : 'Reading…'}</div>
                <div className="rm-card-line">
                  <Cpu size={11} />
                  <span>CPU</span>
                  <Bar percent={cpuPercent} />
                  <span className="rm-card-line-value">{cpuPercent == null ? '—' : `${Math.round(cpuPercent)}%`}</span>
                </div>
              </div>

              <div className="rm-card">
                <div className="rm-card-head"><Gauge size={13} /><span className="rm-card-label">GPU</span></div>
                <div className="rm-card-value">{gpuPercent == null ? '—' : `${Math.round(gpuPercent)}%`}</div>
                <Bar percent={gpuPercent} />
                <div className="rm-card-sub" title={gpu?.name ?? undefined}>{gpuSub}</div>
                {vramValue && (
                  <div className="rm-card-line">
                    <MemoryStick size={11} />
                    <span>VRAM</span>
                    <Bar percent={vramPercent} />
                    <span className="rm-card-line-value">{vramValue}</span>
                  </div>
                )}
              </div>

              <div className="rm-card">
                <div className="rm-card-head"><HardDrive size={13} /><span className="rm-card-label">Storage</span></div>
                <div className="rm-card-value">{models ? <>{formatGb(storageUsedGb)} used of {formatGb(models.totalGb)}</> : '—'}</div>
                <Bar percent={storagePercent} />
                <div className="rm-card-sub">{models ? `Models on ${models.letter}: · ${formatGb(models.freeGb)} free` : 'Reading…'}</div>
                {otherDrives.map((drive) => (
                  <div className="rm-card-line" key={drive.letter} title={`${drive.letter}: ${formatGb(drive.freeGb)} free of ${formatGb(drive.totalGb)}`}>
                    <span className="rm-drive-letter">{drive.letter}:</span>
                    <Bar percent={percentOf(Math.max(0, drive.totalGb - drive.freeGb), drive.totalGb)} />
                    <span className="rm-card-line-value">{formatGb(drive.freeGb)} free</span>
                  </div>
                ))}
              </div>
            </div>

            {activeVideoJob && (
              <div className="rm-urgent-card">
                <div className="rm-urgent-head">
                  <div className="rm-urgent-title">
                    <Video size={13} className="rm-urgent-icon" />
                    <span>{activeVideoJob.label}</span>
                  </div>
                  <span className="rm-urgent-percent">{Math.round(Math.min(1, Math.max(0, activeVideoJob.progress)) * 100)}%</span>
                </div>
                <div className="rm-urgent-desc">
                  Heavy video generation running. If your PC is hanging or frozen, cancel or stop it immediately here.
                </div>
                <Bar percent={Math.round(Math.min(1, Math.max(0, activeVideoJob.progress)) * 100)} tone="high" />
                <div className="rm-urgent-actions">
                  <button
                    type="button"
                    className="rm-urgent-stop"
                    onClick={() => void handleCancel(activeVideoJob.id)}
                    disabled={busyJobs[activeVideoJob.id] === 'cancelling' || busyJobs[activeVideoJob.id] === 'deleting'}
                    title="Stop video generation process immediately"
                  >
                    {busyJobs[activeVideoJob.id] === 'cancelling' ? (
                      <LoaderCircle size={11} className="rm-spin" />
                    ) : (
                      <Square size={10} fill="currentColor" />
                    )}
                    <span>{busyJobs[activeVideoJob.id] === 'cancelling' ? 'Stopping…' : 'Stop Video Generation'}</span>
                  </button>
                  <button
                    type="button"
                    className="rm-urgent-delete"
                    onClick={() => void handleDelete(activeVideoJob.id)}
                    disabled={busyJobs[activeVideoJob.id] === 'cancelling' || busyJobs[activeVideoJob.id] === 'deleting'}
                    title="Delete task and cancel process"
                  >
                    {busyJobs[activeVideoJob.id] === 'deleting' ? (
                      <LoaderCircle size={11} className="rm-spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}
                    <span>{busyJobs[activeVideoJob.id] === 'deleting' ? 'Deleting…' : 'Delete Task'}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="rm-section">
              <div className="rm-section-title"><Wrench size={11} />Running tools{activeRuns.length > 0 && <span className="rm-count">{activeRuns.length}</span>}</div>
              {activeRuns.length === 0 && <div className="rm-empty">Nothing running</div>}
              {activeRuns.map((run) => (
                <div className="rm-run" key={run.callId}>
                  <LoaderCircle size={12} className="rm-spin" />
                  <span className="rm-run-name">{run.name.replace(/_/g, ' ')}</span>
                  {run.request && <span className="rm-run-request" title={run.request}>{run.request}</span>}
                  <span className="rm-run-time">{elapsedText(now - run.at)}</span>
                </div>
              ))}
            </div>

            <div className="rm-section">
              <div className="rm-section-title">
                <LoaderCircle size={11} className={activeJobs.length ? 'rm-spin' : undefined} />
                Background jobs{activeJobs.length > 0 && <span className="rm-count">{activeJobs.length}</span>}
              </div>
              {activeJobs.length === 0 && <div className="rm-empty">Nothing running</div>}
              {activeJobs.map((job) => {
                const percent = Math.round(Math.min(1, Math.max(0, job.progress)) * 100);
                const isVideo = isVideoJob(job);
                const isBusy = !!busyJobs[job.id];
                return (
                  <div className={`rm-job${isVideo ? ' rm-job-video' : ''}`} key={job.id}>
                    <div className="rm-job-head">
                      <div className="rm-job-title-group">
                        {isVideo && <span title="Video generation task" style={{ display: 'inline-flex', alignItems: 'center' }}><Video size={12} className="rm-job-video-icon" /></span>}
                        <span className="rm-job-label">{job.label}</span>
                      </div>
                      <div className="rm-job-actions">
                        <span className="rm-job-percent">{percent}%</span>
                        <button
                          type="button"
                          className="rm-btn-stop"
                          onClick={() => void handleCancel(job.id)}
                          disabled={isBusy}
                          title="Stop this task"
                          aria-label={`Stop ${job.label}`}
                        >
                          {busyJobs[job.id] === 'cancelling' ? (
                            <LoaderCircle size={10} className="rm-spin" />
                          ) : (
                            <Square size={9} fill="currentColor" />
                          )}
                          <span>{busyJobs[job.id] === 'cancelling' ? 'Stopping…' : 'Stop'}</span>
                        </button>
                        <button
                          type="button"
                          className="rm-btn-delete"
                          onClick={() => void handleDelete(job.id)}
                          disabled={isBusy}
                          title="Delete / cancel task"
                          aria-label={`Delete ${job.label}`}
                        >
                          {busyJobs[job.id] === 'deleting' ? (
                            <LoaderCircle size={11} className="rm-spin" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                        </button>
                      </div>
                    </div>
                    <Bar percent={percent} tone={isVideo ? 'high' : 'accent'} />
                    {job.message && <div className="rm-job-message" title={job.message}>{job.message}</div>}
                  </div>
                );
              })}
            </div>

            {usage && (
              <div className="rm-section">
                <button type="button" className="rm-procs-toggle" onClick={() => setShowProcesses(!showProcesses)} aria-expanded={showProcesses}>
                  {showProcesses ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span>Helios processes</span>
                  <span className="rm-procs-summary">{usage.processes.length} {usage.processes.length === 1 ? 'process' : 'processes'} · {formatGb(heliosGb)}</span>
                </button>
                {showProcesses && (
                  <div className="rm-procs">
                    {visibleGroups.map((group) => (
                      <div className="rm-proc" key={group.name} title={`PID ${group.pids.join(', ')}`}>
                        <span className="rm-proc-name">{group.name}</span>
                        {group.pids.length > 1 && <span className="rm-proc-count">×{group.pids.length}</span>}
                        <span className="rm-proc-ram">{formatGb(group.ramGb)}</span>
                      </div>
                    ))}
                    {groups.length > TOP_PROCESSES && (
                      <button type="button" className="rm-link" onClick={() => setAllProcesses(!allProcesses)}>
                        {allProcesses ? 'Show fewer' : `Show all ${groups.length}`}
                      </button>
                    )}
                    {groups.length === 0 && <div className="rm-empty">None measured</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
