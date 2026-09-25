// The render queue: every export this session, live — Premiere's render queue
// without leaving Bhippi. Running renders show progress and cancel; queued
// ones wait for a render slot; finished ones reveal or open their file.
import { CheckCircle2, Clapperboard, CircleAlert, Film, LoaderCircle, Plus, X } from 'lucide-react';
import { Modal } from '../components/ui';
import type { Job } from '../lib/types';

type Props = {
  jobs: Job[];
  onClose: () => void;
  onQueue: () => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  onOpen: (path: string) => void;
};

const mb = (size: number | undefined) => (size ? `${(size / 1048576).toFixed(1)} MB` : '');

function statusOf(job: Job): 'rendering' | 'queued' | 'done' | 'failed' {
  if (job.status === 'running') return job.progress > 0 || !/queued/i.test(job.message) ? 'rendering' : 'queued';
  if (job.status === 'done') return 'done';
  return 'failed';
}

export function RenderQueueDialog({ jobs, onClose, onQueue, onCancel, onReveal, onOpen }: Props) {
  const exports = jobs.filter((job) => job.kind === 'export');
  const active = exports.filter((job) => job.status === 'running');
  const finished = exports.filter((job) => job.status !== 'running').reverse();
  const ordered = [...active, ...finished];
  return (
    <Modal title={`Render Queue${active.length ? ` · ${active.length} rendering` : ''}`} onClose={onClose} width={620} footer={
      <>
        <div className="toolbar-spacer" />
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={onQueue}><Plus size={14} /> Queue a comp</button>
      </>
    }>
      {!ordered.length && (
        <div className="queue-empty">
          <Clapperboard size={22} />
          <p>No renders yet. Queue any comp — it renders here with a live progress bar, two at a time.</p>
        </div>
      )}
      {ordered.map((job) => {
        const status = statusOf(job);
        const percent = Math.round(job.progress * 100);
        return (
          <div key={job.id} className={`queue-row status-${status}`}>
            <div className="queue-main">
              <div className="queue-title">
                {status === 'rendering' && <LoaderCircle size={13} className="spin" />}
                {status === 'queued' && <Film size={13} />}
                {status === 'done' && <CheckCircle2 size={13} />}
                {status === 'failed' && <CircleAlert size={13} />}
                <strong>{job.label}</strong>
              </div>
              <div className="queue-sub muted">{job.message}{status === 'done' && job.result?.size ? ` · ${mb(job.result.size)}` : ''}</div>
              {(status === 'rendering' || status === 'queued') && (
                <span className="progress queue-bar"><span style={{ width: `${percent}%` }} /></span>
              )}
            </div>
            <div className="queue-actions">
              {status === 'rendering' && <span className="muted">{percent}%</span>}
              {(status === 'rendering' || status === 'queued') && (
                <button type="button" className="btn btn-small" onClick={() => onCancel(job.id)}><X size={12} /> Cancel</button>
              )}
              {status === 'done' && job.result?.path && (
                <>
                  <button type="button" className="btn btn-small" onClick={() => onReveal(job.result!.path!)}>Reveal</button>
                  <button type="button" className="btn btn-small" onClick={() => onOpen(job.result!.path!)}>Open</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
