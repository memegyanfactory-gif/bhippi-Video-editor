// Settings › Model Library: the local AI models Bhippi can run, in two panes that fill the
// Settings content area. The left rail picks a page: "In use" (which model the AI reaches for,
// per job), "Downloaded", or one category. The detail panel opens inside the main area, so nothing
// here is positioned against the window. Data and downloads come from `libraryApi`
// (src/lib/modelLibrary.ts); this file keeps them fresh and picks what to show.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/ui';
import { errorText } from '../lib/ipc';
import { useLiveJobs } from '../lib/jobsStore';
import { defaultVariant, fitOf, fitRank, variantBytes } from '../lib/modelFit';
import { capabilityOfEntry } from '../lib/modelUse';
import type { Settings } from '../lib/types';
import { libraryApi, onLibraryChange, usable, type CapabilityChoice, type ComfyStatus, type LibraryListing, type LlmRuntimeStatus } from '../lib/modelLibrary';
import { useHardware } from './LocalModelAdvisor';
import { ModelDetail } from './ModelDetail';
import { CATEGORIES, CATEGORY_BY_CAPABILITY, CATEGORY_BY_KIND } from './libraryShared';
import { CategoryPage } from './library/CategoryPage';
import { DownloadedPage } from './library/DownloadedPage';
import { DownloadsPage, useDownloadQueue } from './library/DownloadsPage';
import { activeCount, otherDownloads } from './library/downloadsModel';
import { EnginesPage } from './library/engines/EnginesPage';
import { InUsePage } from './library/InUsePage';
import { Rail } from './library/Rail';
import { CategoryPrefs } from './library/speech/CategoryPrefs';
import type { LibraryContext, LibraryPage } from './library/shared';
import { LlmBrowser } from './llm/LlmBrowser';
import type { SettingsTab } from './SettingsModal';
import '../styles/model-library.css';

type Sort = 'recommended' | 'smallest';

/** When the backend cannot say what is in use, show the downloaded models per job so the page is still useful. */
const guessDefaults = (listing: LibraryListing | null): CapabilityChoice[] =>
  CATEGORIES.map((category) => {
    const candidates = (listing?.models ?? []).filter((view) => capabilityOfEntry(view.entry) === category.capability && !!view.state.installedVariant && !view.state.broken);
    const inUse = candidates.find((view) => usable(view));
    return {
      capability: category.capability,
      modelId: inUse?.entry.id ?? null,
      variant: inUse?.state.installedVariant ?? null,
      candidates: candidates.map((view) => ({ modelId: view.entry.id, name: view.entry.name, variant: view.state.installedVariant, variantLabel: view.entry.variants.find((row) => row.id === view.state.installedVariant)?.label ?? null })),
      note: '',
    };
  });

const PAGE_TITLES: Record<string, { title: string; blurb: string }> = {
  inuse: { title: 'In use', blurb: 'The model Bhippi’s AI uses for each job. Everything runs on this computer.' },
  downloaded: { title: 'Downloaded', blurb: 'Models on this computer. Switch one on and Bhippi’s AI uses it for that job.' },
  downloads: { title: 'Downloads', blurb: 'What is downloading, what waits in line and what you paused. Pause any time and continue from where it stopped.' },
  engines: { title: 'Engines', blurb: 'The programs Bhippi runs local models on.' },
};

export function ModelLibrary({ onTab, settings, onSettings, initialPage }: { onTab?: (tab: SettingsTab) => void; settings: Settings; onSettings: (settings: Settings) => void; /** Opens on this page (a category, Downloaded, Engines or In use). */ initialPage?: LibraryPage }) {
  const toast = useToast();
  const { hw } = useHardware();
  const jobs = useLiveJobs();
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [error, setError] = useState('');
  const [defaults, setDefaults] = useState<CapabilityChoice[] | null>(null);
  const [comfy, setComfy] = useState<ComfyStatus | null>(null);
  const [comfyError, setComfyError] = useState('');
  const [llm, setLlm] = useState<LlmRuntimeStatus | null>(null);
  const [page, setPage] = useState<LibraryPage>(initialPage ?? 'inuse');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recommended');
  const [openId, setOpenId] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setListing(await libraryApi.list());
      setError('');
    } catch (failure) {
      setError(errorText(failure));
    }
    libraryApi.defaults().then(setDefaults).catch(() => setDefaults(null));
    libraryApi.comfyStatus().then((value) => { setComfy(value); setComfyError(''); }).catch((failure) => setComfyError(errorText(failure)));
    libraryApi.llmStatus().then(setLlm).catch(() => setLlm(null));
  }, []);

  useEffect(() => {
    void refresh();
    let off: (() => void) | null = null;
    let gone = false;
    onLibraryChange(() => void refresh()).then((unlisten) => { if (gone) unlisten(); else off = unlisten; }).catch(() => undefined);
    return () => { gone = true; off?.(); };
  }, [refresh]);

  // A download or an engine install finishing is a job update, not always a library event: re-read then.
  const jobKey = jobs.filter((job) => job.kind === 'model' || job.kind === 'install').map((job) => `${job.id}:${job.status}`).join(',');
  useEffect(() => { if (listing) void refresh(); }, [jobKey]);

  /** Runs one backend call; a failure becomes a toast with the reason. Resolves true when it worked. */
  const run = useCallback(async (work: () => Promise<unknown>, failure: string) => {
    try {
      await work();
      return true;
    } catch (caught) {
      toast({ tone: 'error', title: failure, body: errorText(caught) });
      return false;
    }
  }, [toast]);

  const changeFolder = async () => {
    const picked = await openDialog({ directory: true, title: 'Where to keep downloaded models' });
    if (typeof picked !== 'string') return;
    setChanging(true);
    const ok = await run(() => libraryApi.setStorage(picked), 'Could not use that folder');
    setChanging(false);
    if (ok) {
      toast({ tone: 'success', title: 'Models folder changed', body: 'New downloads go there. Models you already have keep working.' });
      void refresh();
    }
  };

  const views = listing?.models ?? [];
  const storage = listing?.storage ?? null;
  const choices = useMemo(() => defaults ?? guessDefaults(listing), [defaults, listing]);
  const inUse = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const choice of choices) {
      if (!choice.modelId) continue;
      map.set(choice.modelId, [...(map.get(choice.modelId) ?? []), CATEGORY_BY_CAPABILITY[choice.capability]?.short ?? choice.capability]);
    }
    return map;
  }, [choices]);

  const goto = useCallback((next: LibraryPage) => { setPage(next); setOpenId(null); setQuery(''); }, []);
  // Settings can be opened straight onto a page (e.g. Speech & Voice…) while the library is already showing.
  useEffect(() => { if (initialPage) goto(initialPage); }, [initialPage, goto]);
  const ctx: LibraryContext = {
    views, hw, storage, comfy, comfyError, llm, defaults: choices, defaultsGuessed: defaults == null && !!listing, inUse, settings, onSettings, run,
    refresh: () => void refresh(), open: setOpenId, goto,
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const view of views) out[view.entry.kind] = (out[view.entry.kind] ?? 0) + 1;
    return out;
  }, [views]);
  const downloaded = views.filter((view) => !!view.state.installedVariant).length;
  const downloadQueue = useDownloadQueue();
  const activeDownloads = activeCount(downloadQueue.view?.rows ?? [], otherDownloads(jobs, downloadQueue.view?.rows ?? []));

  const needle = query.trim().toLowerCase();
  const matches = useCallback((view: (typeof views)[number]) => !needle || [view.entry.name, view.entry.maker, view.entry.summary, ...view.entry.tags].some((text) => text.toLowerCase().includes(needle)), [needle]);
  const categoryRows = useMemo(() => {
    if (page === 'inuse' || page === 'downloaded' || page === 'downloads' || page === 'engines') return [];
    const items = views.filter((view) => view.entry.kind === page && matches(view)).map((view, index) => {
      const variant = defaultVariant(view.entry.variants, hw, view.entry.runtime);
      const fit = variant ? fitOf(variant, hw, { runtime: view.entry.runtime }).fit : 'no';
      const sizes = view.entry.variants.map((row) => variantBytes(row)).filter((bytes) => bytes > 0);
      return { view, index, bytes: sizes.length ? Math.min(...sizes) : Number.MAX_SAFE_INTEGER, rank: fitRank(fit) };
    });
    items.sort((a, b) => sort === 'smallest' ? a.bytes - b.bytes
      : Number(!!b.view.state.installedVariant) - Number(!!a.view.state.installedVariant) || b.rank - a.rank || a.index - b.index);
    return items.map((item) => item.view);
  }, [views, page, matches, sort, hw]);
  const downloadedRows = useMemo(() => views.filter(matches), [views, matches]);

  const open = views.find((view) => view.entry.id === openId) ?? null;
  const category = page === 'inuse' || page === 'downloaded' || page === 'downloads' || page === 'engines' ? null : CATEGORY_BY_KIND[page];
  const head = category ? { title: category.label, blurb: category.blurb } : PAGE_TITLES[page];
  const isLlm = page === 'llm';

  let body: React.ReactNode;
  if (error && !listing) {
    body = (
      <div className="ml-empty" role="status">
        <TriangleAlert size={15} />
        <span>The model list is not available right now. {error}</span>
        <button type="button" className="btn btn-small" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  } else if (!listing) {
    body = <div className="ml-empty" role="status"><LoaderCircle size={15} className="spin" /> Loading models…</div>;
  } else if (page === 'inuse') {
    body = <InUsePage ctx={ctx} />;
  } else if (page === 'downloaded') {
    body = <DownloadedPage views={downloadedRows} ctx={ctx} />;
  } else if (page === 'downloads') {
    body = <DownloadsPage queue={downloadQueue.view} jobs={jobs} ctx={ctx} onRefresh={() => { downloadQueue.refresh(); void refresh(); }} />;
  } else if (page === 'engines') {
    body = <EnginesPage ctx={ctx} />;
  } else if (isLlm) {
    body = <LlmBrowser onChanged={() => void refresh()} />;
  } else {
    body = <CategoryPage views={categoryRows} ctx={ctx} empty={query ? 'No models match that search.' : 'No models in this category yet.'}
      above={page === 'voice' || page === 'speech' ? <CategoryPrefs kind={page} settings={settings} onSettings={onSettings} /> : undefined} />;
  }

  return (
    <div className="model-library">
      <Rail page={page} onPage={goto} counts={counts} downloaded={downloaded} active={activeDownloads} storage={storage} hw={hw} changing={changing} onChangeFolder={() => void changeFolder()} />
      <div className={`ml-main${open ? ' has-detail' : ''}`}>
        <div className={`ml-page${isLlm ? ' flush' : ''}`}>
          {!isLlm && (
            <header className="ml-page-head">
              <div className="ml-page-title">
                <h3>{head.title}</h3>
                <p>{head.blurb}</p>
              </div>
              {(category || page === 'downloaded') && (
                <div className="ml-tools">
                  <label className="ml-search"><Search size={13} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search this page" /></label>
                  {category && (
                    <label className="ml-select">
                      <span className="ml-sr">Sort models</span>
                      <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                        <option value="recommended">Recommended</option>
                        <option value="smallest">Smallest</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </header>
          )}
          <div className="ml-page-body">{body}</div>
        </div>
        {open && (
          <ModelDetail key={open.entry.id} view={open} hw={hw} storage={storage} comfy={comfy} comfyError={comfyError} llm={llm} inUse={inUse.get(open.entry.id) ?? []} choices={choices} settings={settings} onSettings={onSettings}
            run={run} onClose={() => setOpenId(null)} onChanged={() => void refresh()} onTab={onTab} />
        )}
      </div>
    </div>
  );
}
