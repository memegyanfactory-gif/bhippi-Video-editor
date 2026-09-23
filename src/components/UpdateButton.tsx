// The title bar's download button, left of the Settings gear. Always there; a small amber dot when a
// newer Helios is waiting, a ring that fills while it downloads. Clicking opens a small panel that
// says one thing: you're on the latest version, or here is the new one — download it / install it.
// Settings › About (UpdateSection) has the same state with the release notes and the auto switch.
import { ChevronRight, PackageCheck, RefreshCw, RotateCw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatBytes, updater, useUpdater, type UpdateSnapshot } from '../lib/updater';
import { DownloadGlyph, UpdateProgress, UpdateTile, updateTitle, updateView, type UpdateView } from './UpdateParts';

/** A "you're up to date" older than this is asked again, quietly, when the panel opens. */
const STALE_MS = 15 * 60 * 1000;

function buttonLabel(view: UpdateView, latest: string | null | undefined): string {
  switch (view.kind) {
    case 'available': case 'ready': case 'installing': case 'error':
      return updateTitle(view, latest);
    case 'downloading':
      return `${updateTitle(view, latest)}${view.percent != null ? ` — ${view.percent}%` : ''}`;
    default:
      return 'Updates';
  }
}

/** Around the icon while downloading: fills with the percent, or spins while the size is unknown. */
function ProgressRing({ percent }: { percent: number | null }) {
  return (
    <svg className={`upd-ring${percent == null ? ' indeterminate' : ''}`} viewBox="0 0 28 28" aria-hidden="true">
      <circle className="upd-ring-track" cx="14" cy="14" r="12" />
      <circle className="upd-ring-fill" cx="14" cy="14" r="12" pathLength={100} style={percent == null ? undefined : { strokeDashoffset: 100 - percent }} />
    </svg>
  );
}

export function UpdateButton({ onDetails }: { onDetails?: () => void }) {
  const state = useUpdater();
  const view = updateView(state);
  const latest = state.info?.latest;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Open: focus the panel, and close on a press anywhere else or Escape (which also keeps Escape
  // from reaching the editor's own shortcuts). A dialog opening over it (Ctrl+, for Settings, a
  // toast's button) closes it too, and that dialog's Escape is left to the dialog.
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus({ preventScroll: true });
    const modalOpen = () => document.querySelector('.modal-backdrop') !== null;
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (modalOpen()) {
        setOpen(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const inside = anchor.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (inside) button.current?.focus();
    };
    // Modals are portaled straight into <body>.
    const modals = new MutationObserver(() => {
      if (modalOpen()) setOpen(false);
    });
    modals.observe(document.body, { childList: true });
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      modals.disconnect();
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const { phase, checkedAt } = updater.get();
    if (phase === 'idle') void updater.check();
    else if (phase === 'current' && (!checkedAt || Date.now() - checkedAt > STALE_MS)) void updater.check({ quiet: true });
    setOpen(true);
  };

  // A button that starts a step usually disappears with the state it belonged to; keep focus in the
  // panel so the keyboard does not fall back to the page.
  const run = (action: () => void) => {
    dialog.current?.focus({ preventScroll: true });
    action();
  };

  const busy = view.kind === 'downloading' || view.kind === 'installing';
  const dot = view.kind === 'available' || view.kind === 'ready' ? 'new' : view.kind === 'error' && view.retry !== 'check' ? 'bad' : null;
  const label = buttonLabel(view, latest);

  return (
    <div
      className="upd-anchor"
      ref={anchor}
      onBlur={(event) => {
        // Tabbing out of the panel closes it; focus lost to nothing (a button that went away) does not.
        const next = event.relatedTarget as Node | null;
        if (open && next && !anchor.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={button}
        className={`icon-btn upd-btn${open ? ' open' : ''}${busy ? ' busy' : ''}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={open ? undefined : label}
      >
        {busy && <ProgressRing percent={view.kind === 'downloading' ? view.percent : null} />}
        <DownloadGlyph dropping={view.kind === 'downloading'} />
        {dot && <span className={`upd-dot ${dot}`} aria-hidden="true" />}
      </button>
      {open && (
        <div className="upd-pop" role="dialog" aria-label="Updates" id={panelId} ref={dialog} tabIndex={-1}>
          <UpdatePanel
            state={state}
            run={run}
            onDetails={onDetails && (() => {
              setOpen(false);
              onDetails();
            })}
          />
        </div>
      )}
    </div>
  );
}

/** The popover's contents for one state. Separate from the button so it renders from a plain snapshot. */
export function UpdatePanel({ state, run = (action) => action(), onDetails }: {
  state: Pick<UpdateSnapshot, 'phase' | 'info' | 'progress' | 'error' | 'failed'>;
  run?: (action: () => void) => void;
  onDetails?: () => void;
}) {
  const view = updateView(state);
  const { info, progress, error } = state;
  const latest = info?.latest;
  const current = info?.current;

  let sub: string | null = null;
  let body: React.ReactNode = null;
  let aside: React.ReactNode = null;
  switch (view.kind) {
    case 'idle':
    case 'checking':
      sub = current ? `Helios ${current}` : null;
      break;
    case 'current':
      sub = current ? `Helios ${current}` : null;
      aside = (
        <button type="button" className="upd-text-btn" disabled={view.rechecking} onClick={() => run(() => void updater.check())}>
          <RefreshCw size={12} className={view.rechecking ? 'upd-spin' : undefined} aria-hidden="true" />
          {view.rechecking ? 'Checking…' : 'Check again'}
        </button>
      );
      break;
    case 'available':
      sub = [current && `You have ${current}`, info?.size ? formatBytes(info.size) : null].filter(Boolean).join(' · ') || null;
      body = (
        <button type="button" className="btn btn-primary upd-wide" onClick={() => run(() => void updater.download())}>
          <DownloadGlyph size={14} /> Download
        </button>
      );
      break;
    case 'downloading':
      sub = 'You can keep working meanwhile';
      body = <UpdateProgress progress={progress} version={latest} />;
      aside = (
        <button type="button" className="upd-text-btn" onClick={() => run(() => void updater.cancel())}>
          <X size={12} aria-hidden="true" /> Cancel download
        </button>
      );
      break;
    case 'ready':
      sub = 'Downloaded and verified';
      body = (
        <>
          <button type="button" className="btn btn-primary upd-wide" onClick={() => run(() => void updater.install())}>
            <PackageCheck size={14} aria-hidden="true" /> Restart and install
          </button>
          <p className="upd-note">Your project is saved first</p>
        </>
      );
      break;
    case 'installing':
      sub = 'Helios will close and reopen';
      break;
    case 'error': {
      const retry = view.retry === 'install' ? () => updater.install() : view.retry === 'download' ? () => updater.download() : () => updater.check();
      sub = error || 'Something went wrong';
      body = (
        <button type="button" className="btn upd-wide" onClick={() => run(() => void retry())}>
          <RotateCw size={13} aria-hidden="true" /> Try again
        </button>
      );
      break;
    }
  }

  return (
    <div className={`upd-panel is-${view.kind}`}>
      <div className="upd-head">
        <UpdateTile view={view} />
        <div className="upd-copy">
          <div className="upd-title" aria-live="polite">{updateTitle(view, latest)}</div>
          {sub && <div className={`upd-sub${view.kind === 'error' ? ' is-error' : ''}`} title={view.kind === 'error' ? sub : undefined}>{sub}</div>}
        </div>
      </div>
      {body && <div className="upd-body">{body}</div>}
      {(aside || onDetails) && (
        <div className="upd-foot">
          {aside}
          <span className="upd-foot-gap" />
          {onDetails && (
            <button type="button" className="upd-text-btn" onClick={onDetails}>
              Details <ChevronRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
