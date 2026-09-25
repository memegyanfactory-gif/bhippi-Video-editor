// What the title-bar download button (UpdateButton) and Settings › About (UpdateSection) share, so
// both say the same thing the same way: which state to show, its headline, its icon tile and the
// download bar. The state itself lives in lib/updater.ts; the look in styles/updates.css.
import { CircleCheck, Download, LoaderCircle, PackageCheck, TriangleAlert } from 'lucide-react';
import { downloadPercent, downloadedText, type UpdateSnapshot, type UpdateStep } from '../lib/updater';
import '../styles/updates.css';

/** One state at a time, as the interface shows it (a finer cut than `UpdatePhase`). */
export type UpdateView =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** `rechecking`: asking again after "up to date" — the answer stays on screen, its button spinning. */
  | { kind: 'current'; rechecking: boolean }
  | { kind: 'available' }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready' }
  | { kind: 'installing' }
  /** `retry`: what "Try again" does — the step that failed. */
  | { kind: 'error'; retry: UpdateStep };

export type UpdateTone = 'idle' | 'good' | 'new' | 'bad';

export function updateView(state: Pick<UpdateSnapshot, 'phase' | 'info' | 'progress' | 'failed'>): UpdateView {
  switch (state.phase) {
    case 'checking':
      return state.info && !state.info.available ? { kind: 'current', rechecking: true } : { kind: 'checking' };
    case 'current':
      return { kind: 'current', rechecking: false };
    case 'available':
      return { kind: 'available' };
    case 'downloading':
      return { kind: 'downloading', percent: downloadPercent(state.progress) };
    case 'ready':
      return { kind: 'ready' };
    case 'installing':
      return { kind: 'installing' };
    case 'error':
      // The store records the step; guessing from what is known is only for a state without it.
      return { kind: 'error', retry: state.failed ?? (state.info?.ready ? 'install' : state.info?.available ? 'download' : 'check') };
    default:
      return { kind: 'idle' };
  }
}

export function updateTone(view: UpdateView): UpdateTone {
  switch (view.kind) {
    case 'current': return 'good';
    case 'available': case 'downloading': case 'ready': case 'installing': return 'new';
    case 'error': return 'bad';
    default: return 'idle';
  }
}

/** The headline for a state; `latest` is the version bhippi.com offers. */
export function updateTitle(view: UpdateView, latest: string | null | undefined): string {
  const next = latest ? `Bhippi ${latest}` : 'A new Bhippi';
  switch (view.kind) {
    case 'idle': return 'Check for a newer Bhippi';
    case 'checking': return 'Checking for updates…';
    case 'current': return 'You’re on the latest version';
    case 'available': return `${next} is available`;
    case 'downloading': return `Downloading ${latest ? `Bhippi ${latest}` : 'the update'}`;
    case 'ready': return `${next} is ready`;
    case 'installing': return 'Starting the installer…';
    case 'error':
      return view.retry === 'check' ? 'Couldn’t check for updates' : view.retry === 'download' ? 'The download didn’t finish' : 'The installer didn’t start';
  }
}

/** Lucide's download icon; `dropping` loops its arrow down into the tray while bytes arrive. */
export function DownloadGlyph({ size = 16, dropping = false }: { size?: number; dropping?: boolean }) {
  return <Download size={size} className={`upd-glyph${dropping ? ' is-dropping' : ''}`} aria-hidden="true" />;
}

/** The state's icon on a small tinted tile. */
export function UpdateTile({ view, large = false }: { view: UpdateView; large?: boolean }) {
  const size = large ? 19 : 17;
  const icon =
    view.kind === 'checking' || view.kind === 'installing' ? <LoaderCircle size={size} className="upd-spin" aria-hidden="true" />
    : view.kind === 'current' ? <CircleCheck size={size} aria-hidden="true" />
    : view.kind === 'ready' ? <PackageCheck size={size} aria-hidden="true" />
    : view.kind === 'error' ? <TriangleAlert size={size} aria-hidden="true" />
    : <DownloadGlyph size={size} dropping={view.kind === 'downloading'} />;
  return <span className={`upd-tile tone-${updateTone(view)}${large ? ' large' : ''}`} aria-hidden="true">{icon}</span>;
}

/** The download bar and, under it, bytes on the left and the percent on the right. */
export function UpdateProgress({ progress, version }: { progress: UpdateSnapshot['progress']; version?: string | null }) {
  const percent = downloadPercent(progress);
  const bytes = downloadedText(progress);
  return (
    <div className="upd-progress">
      <div
        className={`upd-bar${percent == null ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label={version ? `Downloading Bhippi ${version}` : 'Downloading the update'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={bytes ? `${bytes}${percent != null ? ` · ${percent}%` : ''}` : undefined}
      >
        <i style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="upd-progress-meta" aria-hidden="true">
        <span>{bytes || 'Starting…'}</span>
        {percent != null && <b>{percent}%</b>}
      </div>
    </div>
  );
}
