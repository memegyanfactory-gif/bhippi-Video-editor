// Downloads in the corner. Setup's models, the AI pack, Model Center downloads and provider
// installs keep running after the window that started them is gone ("Continue in the
// background"); this badge is where they stay visible. Collapsed it says how many are running
// and how far along they are, with a light sweeping its lower edge; a click opens the list —
// each download's bar, what it has fetched so far, and whether it finished or failed. Once
// everything is through it says so until dismissed.
import { Check, ChevronDown, Download, TriangleAlert, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveJobs } from '../lib/jobsStore';
import type { Job } from '../lib/types';

/** Job kinds that are downloads or installs. */
const DOWNLOAD_KINDS = new Set<string>(['model', 'ai-pack', 'install']);
const pct = (fraction: number) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
/** "Downloading Whisper large v3 turbo" → "Whisper large v3 turbo"; the row's state says the rest. */
const nameOf = (job: Job) => job.label.replace(/^(Downloading|Installing|Updating)\s+/, '');

export function DownloadsBadge({ onCancel }: { onCancel?: (id: string) => void }) {
  const live = useLiveJobs();
  /** Finished downloads the user has dismissed; running ones always show. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  /** Downloads seen running while Bhippi was open: only those report finishing (not last week's, reloaded at startup). */
  const [watched, setWatched] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fresh = live.filter((job) => DOWNLOAD_KINDS.has(job.kind) && job.status === 'running' && !watched.has(job.id));
    if (fresh.length) setWatched((current) => new Set([...current, ...fresh.map((job) => job.id)]));
  }, [live, watched]);
  const jobs = useMemo(() => live.filter((job) => DOWNLOAD_KINDS.has(job.kind) && (job.status === 'running' || (watched.has(job.id) && !dismissed.has(job.id)))), [live, watched, dismissed]);
  const running = jobs.filter((job) => job.status === 'running');
  const failed = jobs.filter((job) => job.status === 'error');
  const ref = useRef<HTMLDivElement>(null);

  // A click outside folds the list back into the badge.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);

  if (!jobs.length) return null;
  const overall = running.length ? running.reduce((sum, job) => sum + job.progress, 0) / running.length : 1;
  const state = running.length ? 'working' : failed.length ? 'error' : 'done';
  const title = running.length
    ? `Downloading ${running.length === 1 ? nameOf(running[0]) : `${running.length} items`} · ${pct(overall)}`
    : failed.length ? `${failed.length} download${failed.length === 1 ? '' : 's'} failed` : 'Downloads finished';
  const detail = running.length ? running[0].message || 'Starting…' : failed.length ? 'Click to see what went wrong' : `${jobs.length} ready to use`;
  const Icon = state === 'working' ? Download : state === 'error' ? TriangleAlert : Check;
  const dismissFinished = () => {
    setDismissed((current) => new Set([...current, ...jobs.filter((job) => job.status !== 'running').map((job) => job.id)]));
    setOpen(false);
  };

  return (
    <div ref={ref} className={`dl-badge-wrap${open ? ' open' : ''}`}>
      {open && (
        <div className="dl-list" role="dialog" aria-label="Downloads">
          <header className="dl-list-head">
            <strong>Downloads</strong>
            {jobs.some((job) => job.status !== 'running') && <button type="button" className="btn btn-ghost btn-small" onClick={dismissFinished}>Clear finished</button>}
          </header>
          <ul>
            {jobs.map((job) => (
              <li key={job.id} className={`dl-row ${job.status}`}>
                <div className="dl-row-top">
                  <span className="dl-row-name" title={job.label}>{nameOf(job)}</span>
                  <span className="dl-row-state">
                    {job.status === 'running' ? pct(job.progress) : job.status === 'done' ? <><Check size={12} /> Done</> : job.status === 'error' ? <><TriangleAlert size={12} /> Failed</> : 'Stopped'}
                  </span>
                  {job.status === 'running' && job.cancellable && onCancel && (
                    <button type="button" className="dl-row-cancel" onClick={() => onCancel(job.id)} title="Stop this download" aria-label={`Stop ${nameOf(job)}`}><X size={12} /></button>
                  )}
                </div>
                <div className="dl-bar"><i style={{ width: job.status === 'done' ? '100%' : pct(job.progress) }} /></div>
                {job.message && <span className="dl-row-msg" title={job.message}>{job.status === 'done' ? 'Ready to use' : job.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={`pm-badge dl-badge ${state}`} role="status" aria-live="polite">
        <button type="button" className="pm-badge-main" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={open ? 'Hide downloads' : 'Show downloads'}>
          <span className="pm-badge-icon"><Icon size={18} /></span>
          <span className="pm-badge-text"><strong>{title}</strong><em>{detail}</em></span>
          <ChevronDown size={14} className="dl-chevron" />
        </button>
        {!running.length && (
          <button type="button" className="pm-badge-close" onClick={dismissFinished} title="Dismiss" aria-label="Dismiss"><X size={14} /></button>
        )}
        {running.length > 0 && <span className="dl-badge-progress" style={{ width: pct(overall) }} />}
      </div>
    </div>
  );
}

/**
 * The bottom-right column the status badges (downloads, Plugin Maker) share, above the status bar.
 * Its height is published as `--corner-stack-h` so toasts rise above it rather than covering it.
 */
export function CornerStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () => document.documentElement.style.setProperty('--corner-stack-h', `${node.offsetHeight ? node.offsetHeight + 8 : 0}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--corner-stack-h'); };
  }, []);
  return <div ref={ref} className="corner-stack">{children}</div>;
}
