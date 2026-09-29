// Settings › About › Updates: what version this is, whether bhippi.com has a newer one, and the
// buttons to fetch and install it. The state is shared with the title-bar download button
// (lib/updater.ts, components/UpdateButton.tsx), and so are its words and pieces (UpdateParts).
import { PackageCheck, RefreshCw, RotateCw, X } from 'lucide-react';
import { DownloadGlyph, UpdateProgress, UpdateTile, updateTitle, updateTone, updateView } from '../components/UpdateParts';
import { formatBytes, updater, useUpdater } from '../lib/updater';
import type { Settings } from '../lib/types';

function ago(at: number | null): string {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

export function UpdateSection({ version, settings, onSettings }: { version?: string; settings: Settings; onSettings: (next: Settings) => void }) {
  const { phase, info, progress, error, failed, checkedAt } = useUpdater();
  const view = updateView({ phase, info, progress, failed });
  const latest = info?.latest;
  const current = info?.current ?? version ?? '';
  const have = current ? `You have ${current}` : '';

  const detail =
    view.kind === 'error' ? error || 'Something went wrong.'
    : view.kind === 'current' ? [have && `${have}, the newest version`, checkedAt && `checked ${ago(checkedAt)}`].filter(Boolean).join(' · ')
    : view.kind === 'available' ? [have, info?.size ? `${formatBytes(info.size)} download` : ''].filter(Boolean).join(' · ')
    : view.kind === 'downloading' ? 'Keep working — Bhippi will say when it’s ready.'
    : view.kind === 'ready' ? 'Updating saves your project, closes Bhippi, and reopens the new version a few seconds later.'
    : view.kind === 'installing' ? 'Bhippi will close and reopen.'
    : view.kind === 'idle' ? [have, 'not checked yet'].filter(Boolean).join(' · ')
    : have;

  const primary =
    view.kind === 'ready' || (view.kind === 'error' && view.retry === 'install')
      ? { label: view.kind === 'ready' ? 'Restart and install' : 'Try installing again', icon: <PackageCheck size={14} aria-hidden="true" />, run: () => void updater.install() }
    : view.kind === 'available' || (view.kind === 'error' && view.retry === 'download')
      ? { label: view.kind === 'available' ? 'Download update' : 'Download again', icon: <DownloadGlyph size={14} />, run: () => void updater.download() }
    : null;

  const checking = phase === 'checking';
  // Nothing to check while a download or the installer is under way; the button comes back after.
  const fetching = phase === 'downloading' || phase === 'installing';
  const showNotes = !!info?.notes && (view.kind === 'available' || view.kind === 'downloading' || view.kind === 'ready');

  return (
    <section className={`upd-card tone-${updateTone(view)}`} aria-label="Updates">
      <div className="upd-card-head">
        <UpdateTile view={view} large />
        <div className="upd-copy">
          <div className="upd-title" aria-live="polite">{updateTitle(view, latest)}</div>
          {detail && <div className={`upd-sub${view.kind === 'error' ? ' is-error' : ''}`}>{detail}</div>}
        </div>
        <div className="upd-card-actions">
          {primary && (
            <button type="button" className="btn btn-primary" onClick={primary.run}>
              {primary.icon} {primary.label}
            </button>
          )}
          {view.kind === 'downloading' && (
            <button type="button" className="btn" onClick={() => void updater.cancel()}>
              <X size={13} aria-hidden="true" /> Cancel download
            </button>
          )}
          {!fetching && (
            <button type="button" className="btn" disabled={checking} onClick={() => void updater.check()}>
              {view.kind === 'error' && view.retry === 'check' ? <RotateCw size={13} aria-hidden="true" /> : <RefreshCw size={13} className={checking ? 'upd-spin' : undefined} aria-hidden="true" />}
              {checking ? 'Checking…' : view.kind === 'error' && view.retry === 'check' ? 'Try again' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>

      {view.kind === 'downloading' && <UpdateProgress progress={progress} version={latest} />}

      {showNotes && (
        <div className="upd-notes">
          <div className="upd-notes-label">What’s new{latest ? ` in ${latest}` : ''}</div>
          <p>{info?.notes}</p>
        </div>
      )}

      <div className="upd-card-foot">
        <label className="upd-auto">
          <input type="checkbox" checked={settings.autoUpdate !== false} onChange={(event) => onSettings({ ...settings, autoUpdate: event.target.checked })} />
          Download updates automatically
        </label>
        <span className="upd-foot-note">
          {info?.dev ? 'This is a development build — it never downloads on its own' : 'Installing always waits for you'}
        </span>
      </div>
    </section>
  );
}
