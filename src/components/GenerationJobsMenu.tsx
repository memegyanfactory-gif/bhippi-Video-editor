// The "Generating…" status-bar item: click it to pull up every generation job, each with its
// own progress and a cancel that asks for confirmation before it stops the run.
import { LoaderCircle, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { Portal, usePlacement } from './Portal';
import type { Job } from '../lib/types';

const pct = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

export function GenerationJobsMenu({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const at = usePlacement(chip, open, 300);

  const primary = jobs[0];
  if (!primary) return null;

  const close = () => {
    setOpen(false);
    setConfirmId(null);
  };

  const runCancel = async (id: string) => {
    setBusyId(id);
    try {
      await onCancel(id);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={chip}
        className={`status-item generation-progress${open ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={`${primary.label}: ${primary.message} — click to see every generating task`}
      >
        <LoaderCircle size={12} className="spin gen-chip-spin" />
        <span className="gen-chip-label">{primary.label || 'Generating'}:</span>
        <span className="gen-chip-message">{primary.message}</span>
        <span className="progress gen-chip-bar"><span style={{ width: `${pct(primary.progress)}%` }} /></span>
        <span className="gen-chip-percent">{pct(primary.progress)}%</span>
        {jobs.length > 1 && <span className="muted">+{jobs.length - 1} more</span>}
      </button>

      {open && (
        <Portal><div className="bar-popover wide gen-popover" style={at} role="dialog" aria-label="Generating">
          <div className="popover-head">Generating{jobs.length > 1 ? ` · ${jobs.length}` : ''}</div>
          <div className="bar-list">
            {jobs.map((job) => {
              const percent = pct(job.progress);
              const confirming = confirmId === job.id;
              const busy = busyId === job.id;
              return (
                <div className="gen-job" key={job.id}>
                  <div className="gen-job-head">
                    <span className="gen-job-label">{job.label}</span>
                    <span className="gen-job-percent">{percent}%</span>
                  </div>
                  <span className="progress gen-job-bar"><span style={{ width: `${percent}%` }} /></span>
                  {job.message && <div className="gen-job-message" title={job.message}>{job.message}</div>}
                  {job.cancellable && (
                    confirming ? (
                      <div className="gen-job-confirm">
                        <span>Cancel this task?</span>
                        <div className="gen-job-confirm-actions">
                          <button type="button" className="gen-btn-yes" disabled={busy} onClick={() => void runCancel(job.id)}>
                            {busy ? <LoaderCircle size={11} className="spin" /> : 'Yes, cancel'}
                          </button>
                          <button type="button" className="gen-btn-no" disabled={busy} onClick={() => setConfirmId(null)}>
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="gen-job-cancel" onClick={() => setConfirmId(job.id)}>
                        <Square size={9} fill="currentColor" /> Cancel
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div></Portal>
      )}
      {open && <Portal><div className="bar-scrim" onPointerDown={close} aria-hidden="true" /></Portal>}
    </>
  );
}
