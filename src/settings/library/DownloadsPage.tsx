// "Downloads": what is downloading now, what waits in line, what was paused (and where it stopped),
// what failed and what finished lately. Pausing keeps the part-file, so Resume continues from there.
// The queue lives in Rust (model_library/queue_run.rs); this page only shows it and sends the
// person's choices. Every button answers at once: the row shows "Pausing…" while the call runs.
import { ArrowUpToLine, Check, FolderOpen, Pause, Play, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/ipc';
import type { Job } from '../../lib/types';
import { libraryApi, onQueueChange, type QueueRow, type QueueView } from '../../lib/modelLibrary';
import { Thumb } from '../libraryShared';
import { failureText, finishedAgo, groupQueue, jobName, otherDownloads, pausedLine, progressLine, variantLine } from './downloadsModel';
import type { LibraryContext } from './shared';

/** The queue, kept fresh: re-read on every change event, and every second while something runs. */
export function useDownloadQueue() {
  const [view, setView] = useState<QueueView | null>(null);
  const busy = useRef(false);
  const moving = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await libraryApi.queue();
      moving.current = next.rows.some((row) => row.state === 'running' || row.state === 'verifying');
      setView(next);
    } catch {
      // Not fatal: the page shows the last queue it had.
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    let off: (() => void) | null = null;
    let gone = false;
    onQueueChange(() => void refresh()).then((unlisten) => { if (gone) unlisten(); else off = unlisten; }).catch(() => undefined);
    const timer = window.setInterval(() => { if (moving.current) void refresh(); }, 1000);
    return () => { gone = true; off?.(); window.clearInterval(timer); };
  }, [refresh]);
  return { view, refresh: () => void refresh() };
}

type Act = (id: string, doing: string, work: () => Promise<unknown>, failure: string) => void;

function Bar({ row }: { row: QueueRow }) {
  const fraction = row.bytesTotal > 0 ? Math.min(1, row.bytesDone / row.bytesTotal) : 0;
  return <div className="dl-bar ml-dl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}><i style={{ width: `${fraction * 100}%` }} /></div>;
}

function Frame({ row, ctx, children, actions, note }: { row: QueueRow; ctx: LibraryContext; children?: React.ReactNode; actions: React.ReactNode; note?: React.ReactNode }) {
  const view = ctx.views.find((candidate) => candidate.entry.id === row.id);
  return (
    <div className={`ml-dl-row ${row.state}`} role="listitem">
      {row.position != null && <span className="ml-dl-order" aria-label={`Number ${row.position} in line`}>{row.position}</span>}
      {view ? <Thumb view={view} /> : <span className="ml-thumb" aria-hidden="true" />}
      <div className="ml-dl-text">
        <div className="ml-dl-name"><strong>{row.name}</strong><span>{variantLine(row)}</span></div>
        {children}
        {note}
      </div>
      <div className="ml-dl-actions">{actions}</div>
    </div>
  );
}

function RowActions({ row, ctx, act, busy, confirm, setConfirm, kind }: { row: QueueRow; ctx: LibraryContext; act: Act; busy: string | undefined; confirm: string | null; setConfirm: (id: string | null) => void; kind: 'running' | 'queued' | 'paused' | 'failed' | 'done' }) {
  const view = ctx.views.find((candidate) => candidate.entry.id === row.id);
  if (busy) return <span className="ml-dl-busy" role="status">{busy}</span>;
  if (confirm === row.id) {
    return (
      <span className="ml-confirm" role="alert">
        {kind === 'queued' ? 'Remove from the list?' : `Discard ${row.bytesDone > 0 ? 'what was downloaded' : 'it'}?`}
        <button type="button" className="btn btn-small btn-danger" onClick={() => { setConfirm(null); act(row.id, 'Removing…', () => libraryApi.discard(row.id), 'Could not remove the download'); }}>{kind === 'queued' ? 'Remove' : 'Discard'}</button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirm(null)}>Keep</button>
      </span>
    );
  }
  const pause = <button type="button" className="btn btn-small" onClick={() => act(row.id, 'Pausing…', () => libraryApi.pause(row.id), 'Could not pause')}><Pause size={12} />Pause</button>;
  const resume = <button type="button" className="btn btn-small" onClick={() => act(row.id, 'Resuming…', () => libraryApi.resume(row.id), 'Could not resume')}><Play size={12} />Resume</button>;
  const discard = (label: string, icon: React.ReactNode) => <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirm(row.id)}>{icon}{label}</button>;
  switch (kind) {
    case 'running': return <>{pause}{discard('Cancel', <X size={12} />)}</>;
    case 'queued': return (
      <>
        {(row.position ?? 1) > 1 && <button type="button" className="btn btn-small btn-ghost" onClick={() => act(row.id, 'Moving…', () => libraryApi.moveToTop(row.id), 'Could not move it')}><ArrowUpToLine size={12} />Move to top</button>}
        {discard('Remove', <X size={12} />)}
      </>
    );
    case 'paused': return <>{resume}{discard('Discard', <Trash2 size={12} />)}</>;
    case 'failed': return <><button type="button" className="btn btn-small" onClick={() => act(row.id, 'Retrying…', () => libraryApi.resume(row.id), 'Could not retry')}><RotateCcw size={12} />Retry</button>{discard('Discard', <Trash2 size={12} />)}</>;
    default: return (
      <>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => ctx.open(row.id)}>Open in library</button>
        {ctx.storage && <button type="button" className="btn btn-small btn-ghost ml-icon-btn" title="Show folder" aria-label={`Show ${view?.entry.name ?? 'the'} folder`} onClick={() => void ctx.run(() => api.revealPath(ctx.storage?.dir ?? ''), 'Could not open the folder')}><FolderOpen size={13} /></button>}
      </>
    );
  }
}

function Section({ title, count, children, hint }: { title: string; count: number; children: React.ReactNode; hint?: string }) {
  if (!count) return null;
  return (
    <section className="ml-group">
      <h4 className="ml-group-title">{title}<span className="ml-dl-count">{count}</span>{hint && <em>{hint}</em>}</h4>
      <div className="ml-rows ml-dl-rows" role="list">{children}</div>
    </section>
  );
}

export function DownloadsPage({ queue, jobs, ctx, onRefresh }: { queue: QueueView | null; jobs: Job[]; ctx: LibraryContext; onRefresh: () => void }) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const rows = queue?.rows ?? [];
  const groups = useMemo(() => groupQueue(rows), [rows]);
  const others = useMemo(() => otherDownloads(jobs, rows), [jobs, rows]);

  const act: Act = useCallback((id, doing, work, failure) => {
    setBusy((current) => ({ ...current, [id]: doing }));
    void ctx.run(work, failure).finally(() => {
      setBusy((current) => { const { [id]: _done, ...rest } = current; return rest; });
      onRefresh();
    });
  }, [ctx, onRefresh]);

  const canPause = groups.downloading.length + groups.queued.length > 0;
  const canResume = groups.paused.length > 0;
  const all = (id: string, doing: string, work: () => Promise<unknown>, failure: string) => act(id, doing, work, failure);
  const everything = groups.downloading.length + groups.queued.length + groups.paused.length + groups.failed.length + groups.finished.length + others.length;

  if (!queue) return <div className="ml-empty" role="status">Loading downloads…</div>;
  if (!everything) {
    return (
      <div className="ml-empty ml-dl-empty" role="status">
        <span>Nothing is downloading. When you download a model it shows up here, and you can pause it and carry on later.</span>
        <button type="button" className="btn btn-small" onClick={() => ctx.goto('video')}>Browse models</button>
      </div>
    );
  }
  const props = (row: QueueRow, kind: 'running' | 'queued' | 'paused' | 'failed' | 'done') => <RowActions row={row} ctx={ctx} act={act} busy={busy[row.id]} confirm={confirm} setConfirm={setConfirm} kind={kind} />;
  return (
    <div className="ml-groups ml-dl">
      <div className="ml-dl-toolbar">
        <span className="ml-dl-limit">
          At once
          <select value={queue.maxParallel} aria-label="Downloads at once" onChange={(event) => act('limit', 'Saving…', () => libraryApi.setParallel(Number(event.target.value)), 'Could not change the limit')}>
            {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </span>
        <span className="ml-dl-spacer" />
        {canPause && <button type="button" className="btn btn-small" disabled={!!busy.all} onClick={() => all('all', 'Pausing…', () => libraryApi.pauseAll(), 'Could not pause the downloads')}><Pause size={12} />Pause all</button>}
        {canResume && <button type="button" className="btn btn-small" disabled={!!busy.all} onClick={() => all('all', 'Resuming…', () => libraryApi.resumeAll(), 'Could not resume the downloads')}><Play size={12} />Resume all</button>}
      </div>

      <Section title="Downloading" count={groups.downloading.length + others.length}>
        {groups.downloading.map((row) => (
          <Frame key={row.id} row={row} ctx={ctx} actions={props(row, 'running')}>
            <Bar row={row} />
            <span className="ml-dl-line">{busy[row.id] ?? progressLine(row)}</span>
          </Frame>
        ))}
        {others.map((job) => (
          <div key={job.id} className="ml-dl-row running" role="listitem">
            <span className="ml-thumb" aria-hidden="true" />
            <div className="ml-dl-text">
              <div className="ml-dl-name"><strong>{jobName(job)}</strong><span>Installs on its own, cannot wait in line</span></div>
              <div className="dl-bar ml-dl-bar"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
              <span className="ml-dl-line">{job.message || `${Math.round(job.progress * 100)}%`}</span>
            </div>
            <div className="ml-dl-actions">
              {job.cancellable && <button type="button" className="btn btn-small btn-ghost" onClick={() => void ctx.run(() => api.jobCancel(job.id), 'Could not stop it')}><X size={12} />Cancel</button>}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Queued" count={groups.queued.length} hint={`Up to ${queue.maxParallel} at a time, in this order`}>
        {groups.queued.map((row) => (
          <Frame key={row.id} row={row} ctx={ctx} actions={props(row, 'queued')} note={<span className="ml-dl-line">{busy[row.id] ?? 'Waiting for its turn'}</span>} />
        ))}
      </Section>

      <Section title="Paused" count={groups.paused.length}>
        {groups.paused.map((row) => (
          <Frame key={row.id} row={row} ctx={ctx} actions={props(row, 'paused')}>
            <Bar row={row} />
            <span className="ml-dl-line">{busy[row.id] ?? pausedLine(row)}</span>
          </Frame>
        ))}
      </Section>

      <Section title="Failed" count={groups.failed.length}>
        {groups.failed.map((row) => (
          <Frame key={row.id} row={row} ctx={ctx} actions={props(row, 'failed')}>
            <span className="ml-dl-line ml-dl-error"><TriangleAlert size={12} />{busy[row.id] ?? failureText(row.error)}</span>
            {row.bytesDone > 0 && <span className="ml-dl-line">{pausedLine({ bytesDone: row.bytesDone, bytesTotal: row.bytesTotal }).replace('Paused at', 'Kept')}</span>}
          </Frame>
        ))}
      </Section>

      <Section title="Finished" count={groups.finished.length}>
        {groups.finished.map((row) => (
          <Frame key={row.id} row={row} ctx={ctx} actions={props(row, 'done')}>
            <span className="ml-dl-line ml-dl-ok"><Check size={12} />{finishedAgo(row.finishedAt)} · checked and ready</span>
          </Frame>
        ))}
      </Section>
    </div>
  );
}
