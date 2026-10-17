// "Downloaded": everything on this PC, grouped by category, as compact rows with the few things
// you do to a downloaded model: use it, look at it, delete it.
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLiveJobs } from '../../lib/jobsStore';
import { formatBytes, variantBytes } from '../../lib/modelFit';
import { libraryApi, type LibraryView } from '../../lib/modelLibrary';
import { CATEGORIES, StatusPill, Thumb, statusOf } from '../libraryShared';
import { UseToggle } from './UseToggle';
import type { LibraryContext } from './shared';

function Row({ view, ctx }: { view: LibraryView; ctx: LibraryContext }) {
  const { entry, state } = view;
  const jobs = useLiveJobs();
  const job = state.download ? jobs.find((row) => row.id === state.download?.jobId) : undefined;
  const uses = ctx.inUse.get(entry.id) ?? [];
  const status = statusOf(view, job, uses.length > 0);
    const [confirm, setConfirm] = useState(false);
  const variant = entry.variants.find((row) => row.id === state.installedVariant);
  const bytes = variant ? variantBytes(variant) : 0;
  const meta = [entry.maker, variant && entry.variants.length > 1 ? variant.label : null].filter(Boolean).join(' · ');
  const downloading = status.id === 'downloading';
  const installed = !!state.installedVariant;

  return (
    <div className="ml-row" role="listitem">
      <button type="button" className="ml-row-main" onClick={() => ctx.open(entry.id)} aria-label={`${entry.name}. Open details`}>
        <Thumb view={view} />
        <span className="ml-row-text">
          <strong>{entry.name}</strong>
          <span>{meta}</span>
        </span>
      </button>
      <span className="ml-row-size">{!downloading && bytes > 0 ? formatBytes(bytes) : ''}</span>
      <span className="ml-row-status">
        {installed && !state.broken
          ? <UseToggle view={view} choices={ctx.defaults} run={ctx.run} onChanged={ctx.refresh} />
          : <StatusPill status={status} />}
      </span>
      <span className="ml-row-actions">
        {confirm ? (
          <span className="ml-confirm" role="alert">
            Delete {entry.name}?
            <button type="button" className="btn btn-small btn-danger" onClick={() => void ctx.run(() => libraryApi.delete(entry.id), 'Could not delete').then((ok) => { setConfirm(false); if (ok) ctx.refresh(); })}>Delete</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirm(false)}>Keep</button>
          </span>
        ) : (
          <>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => ctx.open(entry.id)}>Details</button>
            {(installed || state.broken) && <button type="button" className="btn btn-small btn-ghost ml-icon-btn" onClick={() => setConfirm(true)} aria-label={`Delete ${entry.name}`} title="Delete"><Trash2 size={13} /></button>}
          </>
        )}
      </span>
    </div>
  );
}

export function DownloadedPage({ views, ctx }: { views: LibraryView[]; ctx: LibraryContext }) {
  // Downloads in progress come first so they are never lost; then installed models by category.
  const active = views.filter((view) => !view.state.installedVariant && (view.state.download || view.state.partialBytes > 0));
  const groups = CATEGORIES.map((category) => ({ category, rows: views.filter((view) => view.entry.kind === category.id && !!view.state.installedVariant) })).filter((group) => group.rows.length > 0);
  if (!groups.length && !active.length) {
    return <div className="ml-empty">Nothing downloaded yet. Pick a category on the left to find models.</div>;
  }
  return (
    <div className="ml-groups">
      {active.length > 0 && (
        <section className="ml-group">
          <h4 className="ml-group-title">Downloading</h4>
          <div className="ml-rows" role="list">{active.map((view) => <Row key={view.entry.id} view={view} ctx={ctx} />)}</div>
        </section>
      )}
      {groups.map(({ category, rows }) => (
        <section key={category.id} className="ml-group">
          <h4 className="ml-group-title"><category.icon size={13} />{category.label}</h4>
          <div className="ml-rows" role="list">{rows.map((view) => <Row key={view.entry.id} view={view} ctx={ctx} />)}</div>
        </section>
      ))}
    </div>
  );
}
