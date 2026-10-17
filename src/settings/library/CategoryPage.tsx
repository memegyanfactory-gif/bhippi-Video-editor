// A category page: a calm grid of model cards. Each card is one button that opens the detail panel;
// downloading, choosing a size and switching on all happen there.
import type { ReactNode } from 'react';
import { UseToggle } from './UseToggle';
import { useLiveJobs } from '../../lib/jobsStore';
import { defaultVariant, fitOf } from '../../lib/modelFit';
import type { LibraryView } from '../../lib/modelLibrary';
import { FitDot, StatusPill, Thumb, shownVariant, sizeText, statusOf, useDownloadProgress, useQueueWatch } from '../libraryShared';
import type { LibraryContext } from './shared';

export function ModelCard({ view, ctx, onOpen }: { view: LibraryView; ctx: LibraryContext; onOpen: () => void }) {
  const { entry, state } = view;
  const jobs = useLiveJobs();
  const job = state.download ? jobs.find((row) => row.id === state.download?.jobId) : undefined;
  useQueueWatch();
  const status = statusOf(view, job, ctx.inUse.has(entry.id));
  const progress = useDownloadProgress(view, job);
  const variant = shownVariant(view, ctx.hw) ?? defaultVariant(entry.variants, ctx.hw, entry.runtime);
  const fit = variant ? fitOf(variant, ctx.hw, { runtime: entry.runtime }) : null;
  const size = sizeText(view, ctx.hw);
  const downloading = status.id === 'downloading';
  const hasUse = !!state.installedVariant && !state.broken;
  return (
    <div className={`ml-card-wrap${hasUse ? ' has-use' : ''}`}>
    <button type="button" className={`ml-card s-${status.id}`} onClick={onOpen} aria-label={`${entry.name}, ${entry.maker}. Open details`}>
      <span className="ml-card-pic">
        <Thumb view={view} />
        {downloading && <span className="ml-card-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></span>}
      </span>
      <span className="ml-card-text">
        <strong className="ml-card-name">{entry.name}</strong>
        <span className="ml-maker">{entry.maker}</span>
        <span className="ml-card-summary">{entry.summary}</span>
      </span>
      <span className="ml-card-foot">
        <span className="ml-card-meta">
          {size && <span className="ml-size">{size}</span>}
          {fit && state.installedVariant == null && <FitDot fit={fit} />}
        </span>
        <StatusPill status={status} />
      </span>
    </button>
    {hasUse && <div className="ml-card-use"><UseToggle view={view} choices={ctx.defaults} run={ctx.run} onChanged={ctx.refresh} /></div>}
    </div>
  );
}

export function CategoryPage({ views, ctx, empty, above }: { views: LibraryView[]; ctx: LibraryContext; empty: string; /** Shown above the grid (a category's own settings). */ above?: ReactNode }) {
  if (views.length === 0) return <>{above}<div className="ml-empty">{empty}</div></>;
  return (
    <>
    {above}
    <div className="ml-grid">
      {views.map((view) => <ModelCard key={view.entry.id} view={view} ctx={ctx} onOpen={() => ctx.open(view.entry.id)} />)}
    </div>
    </>
  );
}
