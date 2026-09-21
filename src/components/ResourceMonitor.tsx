import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Cpu, HardDrive, MemoryStick, TriangleAlert, X, Zap } from 'lucide-react';
import type { Job } from '../lib/types';
import type { ToolRun } from '../chat/Activity';

export type GpuUsage = { name: string; utilPercent: number; memUsedMb: number; memTotalMb: number } | null;

type Usage = {
  cpuPercent: number; ramUsedGb: number; ramTotalGb: number;
  diskFreeGb: number; diskTotalGb: number; drive: string; gpu: GpuUsage;
  processes: { name: string; pid: number; ramGb: number }[];
};

/** Kinds whose cancellation can waste minutes of work or leave state behind. */
export const CRITICAL_KINDS = ['export', 'generation', 'model'];
export const isCriticalJob = (job: Pick<Job, 'kind'>): boolean => CRITICAL_KINDS.includes(job.kind);
export const clampPct = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);

/** Sparkline points for the last samples, `width`×`height` viewBox, 0–100 scale. */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, index) => `${(index * step).toFixed(1)},${(height - (clampPct(value) / 100) * height).toFixed(1)}`).join(' ');
}

const HISTORY = 30;
const pushHistory = (ring: number[], value: number): number[] => [...ring.slice(-HISTORY + 1), clampPct(value)];

function Spark({ values, tone }: { values: number[]; tone: string }) {
  return (
    <svg className={`mon-spark ${tone}`} viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={sparkPoints(values, 60, 16)} fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function ResourceMonitor({ jobs, runs, onCancelJob }: { jobs: Job[]; runs: ToolRun[]; onCancelJob: (id: string) => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [updated, setUpdated] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const busy = useRef(false);
  const history = useRef<{ cpu: number[]; ram: number[]; gpu: number[] }>({ cpu: [], ram: [], gpu: [] });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!busy.current) {
        busy.current = true;
        try {
          const value = await invoke<Usage>('resource_usage');
          if (!stopped) {
            setUsage(value);
            setError(false);
            setUpdated(new Date().toLocaleTimeString());
            const ram = value.ramTotalGb > 0 ? (value.ramUsedGb / value.ramTotalGb) * 100 : 0;
            history.current = {
              cpu: pushHistory(history.current.cpu, value.cpuPercent),
              ram: pushHistory(history.current.ram, ram),
              gpu: pushHistory(history.current.gpu, value.gpu?.utilPercent ?? 0),
            };
          }
        } catch {
          if (!stopped) setError(true);
        } finally {
          busy.current = false;
        }
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const activeJobs = jobs.filter((job) => job.status === 'running');
  const activeRuns = runs.filter((run) => run.status === 'running');
  const cpu = usage ? clampPct(usage.cpuPercent) : 0;
  const ram = usage && usage.ramTotalGb > 0 ? clampPct((usage.ramUsedGb / usage.ramTotalGb) * 100) : 0;
  const diskUsed = usage && usage.diskTotalGb > 0 ? clampPct(((usage.diskTotalGb - usage.diskFreeGb) / usage.diskTotalGb) * 100) : 0;
  const gpu = usage?.gpu ?? null;
  const gpuMem = gpu && gpu.memTotalMb > 0 ? clampPct((gpu.memUsedMb / gpu.memTotalMb) * 100) : 0;
  const maxProcRam = Math.max(0.001, ...((usage?.processes ?? []).map((p) => p.ramGb)));

  const cancelJob = (job: Job) => {
    if (isCriticalJob(job)) setConfirmId(job.id);
    else onCancelJob(job.id);
  };

  return (
    <div className="resource-monitor">
      <button type="button" className="resource-toggle" aria-expanded={open} onClick={() => setOpen(!open)} title="Live system usage and Helios activity">
        {error ? 'Usage unavailable' : usage ? (
          <span className="mon-top">
            <span className="mon-bar" title={`CPU ${usage.cpuPercent}%`}><span style={{ width: `${cpu}%` }} /></span>
            <span className="mon-bar ram" title={`RAM ${usage.ramUsedGb}/${usage.ramTotalGb} GB`}><span style={{ width: `${ram}%` }} /></span>
            <span className="muted">{usage.diskFreeGb} GB free</span>
          </span>
        ) : 'Reading usage…'}
      </button>
      {open && (
        <section className="resource-details mon" aria-label="System and Helios activity">
          <div className="resource-heading">
            <strong>System & Helios activity</strong>
            <span className={`mon-live${error ? ' stale' : ''}`}>{error ? 'Stale' : 'Live'}</span>
            <span className="muted">updated {updated || 'pending'}</span>
            <button onClick={() => setOpen(false)} aria-label="Close usage details">×</button>
          </div>
          {error && <p role="alert">Refresh failed. Last measurements may be stale.</p>}
          <div className="mon-cards">
            <div className="mon-card">
              <div className="mon-card-head"><Cpu size={14} /><span>CPU</span><strong>{usage ? `${usage.cpuPercent}%` : '—'}</strong></div>
              <span className="mon-bar wide"><span style={{ width: `${cpu}%` }} /></span>
              <Spark values={history.current.cpu} tone="cpu" />
            </div>
            <div className="mon-card">
              <div className="mon-card-head"><MemoryStick size={14} /><span>RAM</span><strong>{usage ? `${usage.ramUsedGb} / ${usage.ramTotalGb} GB` : '—'}</strong></div>
              <span className="mon-bar wide ram"><span style={{ width: `${ram}%` }} /></span>
              <Spark values={history.current.ram} tone="ram" />
            </div>
            <div className="mon-card">
              <div className="mon-card-head"><Zap size={14} /><span>Graphic</span><strong>{gpu ? `${Math.round(gpu.utilPercent)}%` : '—'}</strong></div>
              {gpu ? (
                <>
                  <span className="mon-bar wide gpu"><span style={{ width: `${clampPct(gpu.utilPercent)}%` }} /></span>
                  <Spark values={history.current.gpu} tone="gpu" />
                  <small className="muted">{gpu.name} · VRAM {(gpu.memUsedMb / 1024).toFixed(1)} / {(gpu.memTotalMb / 1024).toFixed(1)} GB</small>
                  <span className="mon-bar wide vram"><span style={{ width: `${gpuMem}%` }} /></span>
                </>
              ) : (
                <small className="muted">No live GPU sensor on this machine — NVIDIA GPUs report load here.</small>
              )}
            </div>
            <div className="mon-card">
              <div className="mon-card-head"><HardDrive size={14} /><span>Storage</span><strong>{usage ? `${usage.diskFreeGb} GB free` : '—'}</strong></div>
              <span className="mon-bar wide disk"><span style={{ width: `${diskUsed}%` }} /></span>
              <small className="muted">{usage ? `Model drive ${usage.drive}: ${usage.diskFreeGb} / ${usage.diskTotalGb} GB free` : 'Waiting for measurements…'}</small>
            </div>
          </div>

          <strong>Helios processes · memory</strong>
          {!usage?.processes.length && <p>No Helios child processes right now.</p>}
          {!!usage?.processes.length && (
            <table className="mon-table">
              <thead><tr><th>Process</th><th>PID</th><th>Memory</th></tr></thead>
              <tbody>
                {usage.processes.map((p) => (
                  <tr key={p.pid}>
                    <td>{p.name}</td>
                    <td>{p.pid}</td>
                    <td>
                      <span className="mon-bar proc"><span style={{ width: `${clampPct((p.ramGb / maxProcRam) * 100)}%` }} /></span>
                      {p.ramGb.toFixed(3)} GB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <strong>Running tools ({activeRuns.length})</strong>
          {!activeRuns.length && <p>No tool currently running.</p>}
          {activeRuns.map((run) => (
            <div className="resource-task" key={run.callId}>
              <b>{run.name.replace(/_/g, ' ')}</b>
              <p>{run.request}</p>
            </div>
          ))}

          <strong>Background jobs ({activeJobs.length})</strong>
          {!activeJobs.length && <p>No app-managed job currently running.</p>}
          {activeJobs.map((job) => (
            <div className="resource-task mon-job" key={job.id}>
              <div className="mon-job-top">
                <b>{job.label}</b>
                {confirmId === job.id ? (
                  <span className="mon-confirm" role="alert">
                    <TriangleAlert size={12} /> Critical task — stop it?
                    <button type="button" className="btn btn-small danger" onClick={() => { setConfirmId(null); onCancelJob(job.id); }}>Delete</button>
                    <button type="button" className="btn btn-small" onClick={() => setConfirmId(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="icon-btn small danger" title={isCriticalJob(job) ? 'Stop this task (asks first — it is critical)' : 'Stop this task'} onClick={() => cancelJob(job)} disabled={!job.cancellable}>
                    {job.cancellable ? <X size={12} /> : <Check size={12} />}
                  </button>
                )}
              </div>
              <span className="mon-bar wide"><span style={{ width: `${clampPct(job.progress * 100)}%` }} /></span>
              <p>{job.message} · {Math.round(job.progress * 100)}%</p>
            </div>
          ))}
          <p>CPU and memory totals include the whole computer. Process memory is shown separately; shared in-app tools do not have independent memory measurements.</p>
        </section>
      )}
    </div>
  );
}
