// Settings › Model Library › Language models: browse and search models like LM Studio does.
// Left: a search box, Bhippi's picks or Hugging Face, sort and quick filters, and the list (each
// row with its maker's round logo). Right: the model's page with its sizes to download, each with
// how it fits this PC, and its README. Hugging Face is reached from Rust (llm_hub.rs); the logos
// are cached files on disk. See docs/model-library.md.
import { LoaderCircle, Search, SearchX, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '../../lib/ipc';
import { useLiveJobs } from '../../lib/jobsStore';
import {
  compact, displayName, entryCapabilities, entryMatches, hubCapabilities, needsClientCheck, passesFilters, paramsLabel, prettyMaker, QUICK_FILTERS, relativeDate, searchText,
  type HubRow, type QuickFilter,
} from '../../lib/llmHub';
import { libraryApi, onLibraryChange, type HubSort, type LibraryListing, type LibraryView, type LlmRuntimeStatus } from '../../lib/modelLibrary';
import { statusOf, useQueueWatch } from '../libraryShared';
import { useHardware } from '../LocalModelAdvisor';
import { LlmDetail, repoOfEntry, type Selection } from './LlmDetail';
import { CapIcons, MakerLogo, VerifiedTick } from './parts';
import { STRATA_BADGE } from './StrataPanel';
import '../../styles/model-library.css';
import '../../styles/llm-browser.css';

type Mode = 'picks' | 'hub';
type SortChoice = 'match' | HubSort;

const SORTS: { id: SortChoice; label: string }[] = [
  { id: 'match', label: 'Best match' },
  { id: 'downloads', label: 'Most downloads' },
  { id: 'trending', label: 'Trending' },
  { id: 'likes', label: 'Most liked' },
  { id: 'updated', label: 'Recently updated' },
];

type HubState = { items: HubRow[]; next: string | null; loading: boolean; error: string | null; searched: boolean };
const EMPTY_HUB: HubState = { items: [], next: null, loading: false, error: null, searched: false };

const readMode = (): Mode => {
  try { return window.sessionStorage.getItem('bhippi.llm.mode') === 'hub' ? 'hub' : 'picks'; } catch { return 'picks'; }
};

/** One line of a list row, whatever the row stands for. */
type Row = {
  key: string;
  selection: Selection;
  name: string;
  maker: string;
  logo: string | null;
  verified: boolean;
  line: string;
  caps: ReturnType<typeof hubCapabilities>;
  date: string | null;
  /** The engine it needs when that is not the usual llama.cpp, e.g. Runs with Strata. */
  engine: string | null;
  downloads: number | null;
  mark: { tone: 'use' | 'done' | 'busy'; label: string } | null;
};

export function LlmBrowser({ onChanged }: { onChanged: () => void }) {
  const { hw } = useHardware();
  useQueueWatch();
  const jobs = useLiveJobs();
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [listError, setListError] = useState('');
  const [llm, setLlm] = useState<LlmRuntimeStatus | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortChoice>('match');
  const [filters, setFilters] = useState<ReadonlySet<QuickFilter>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hub, setHub] = useState<HubState>(EMPTY_HUB);
  const [meta, setMeta] = useState<Record<string, HubRow>>({});
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const setMode = (next: Mode) => {
    setModeState(next);
    setSelection(null);
    try { window.sessionStorage.setItem('bhippi.llm.mode', next); } catch { /* the choice just is not remembered */ }
  };

  // ---- the library: Bhippi's picks and what was added ---------------------------------------
  const refresh = useCallback(async () => {
    try {
      setListing(await libraryApi.list());
      setListError('');
    } catch (failure) {
      setListError(errorText(failure));
    }
    libraryApi.llmStatus().then(setLlm).catch(() => setLlm(null));
    changed.current();
  }, []);

  useEffect(() => {
    void refresh();
    let off: (() => void) | null = null;
    let gone = false;
    onLibraryChange(() => void refresh()).then((unlisten) => { if (gone) unlisten(); else off = unlisten; }).catch(() => undefined);
    return () => { gone = true; off?.(); };
  }, [refresh]);

  const jobKey = jobs.filter((job) => job.kind === 'model' || job.kind === 'install').map((job) => `${job.id}:${job.status}`).join(',');
  useEffect(() => { if (listing) void refresh(); }, [jobKey]);

  const llmViews = useMemo(() => (listing?.models ?? []).filter((view) => view.entry.kind === 'llm'), [listing]);
  const picks = useMemo(() => llmViews.filter((view) => view.entry.source !== 'huggingface'), [llmViews]);
  const added = useMemo(() => llmViews.filter((view) => view.entry.source === 'huggingface'), [llmViews]);
  const freeGb = listing?.storage.freeGb ?? null;

  // The makers' logos and live numbers for the picks (one small search each, a few at a time).
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const wanted = [...picks, ...added].map((view) => repoOfEntry(view.entry)).filter((repo): repo is string => !!repo && !asked.current.has(repo));
    if (!wanted.length) return;
    wanted.forEach((repo) => asked.current.add(repo));
    let live = true;
    const queue = [...new Set(wanted)];
    const worker = async () => {
      for (let repo = queue.shift(); repo && live; repo = queue.shift()) {
        const [author, name] = repo.split('/');
        try {
          const page = await libraryApi.hubSearch(name, { author, limit: 8 });
          const found = (page.models as HubRow[]).find((model) => model.repo === repo);
          if (found && live) setMeta((now) => ({ ...now, [repo]: found }));
        } catch { asked.current.delete(repo); return; }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { live = false; };
  }, [picks, added]);

  // ---- Hugging Face ---------------------------------------------------------------------------
  const seq = useRef(0);
  const hubNext = useRef<string | null>(null);
  const hubBusy = useRef(false);
  const filterKey = [...filters].sort().join(',');
  const hwReady = !!hw;

  const fetchHub = useCallback(async (reset: boolean) => {
    if (!reset && (hubBusy.current || !hubNext.current)) return;
    const mine = reset ? ++seq.current : seq.current;
    hubBusy.current = true;
    setHub((now) => ({ ...now, loading: true, error: null, ...(reset ? { items: [], next: null } : {}) }));
    const text = searchText(query, filters);
    const choice = sort === 'match' ? (text ? undefined : 'trending') : sort;
    const filtered = needsClientCheck(filters);
    let cursor = reset ? null : hubNext.current;
    const found: HubRow[] = [];
    try {
      for (let pages = 0; pages < (filtered ? 6 : 1); pages += 1) {
        const page = await libraryApi.hubSearch(text, { sort: choice, limit: 30, cursor });
        if (mine !== seq.current) return;
        cursor = page.next;
        found.push(...(page.models as HubRow[]).filter((model) => passesFilters(model, filters, hw)));
        if (!cursor || found.length >= 12) break;
      }
      hubNext.current = cursor;
      setHub((now) => {
        const seen = new Set((reset ? [] : now.items).map((item) => item.repo));
        return { items: [...(reset ? [] : now.items), ...found.filter((item) => !seen.has(item.repo))], next: cursor, loading: false, error: null, searched: true };
      });
    } catch (failure) {
      if (mine === seq.current) setHub((now) => ({ ...now, loading: false, error: errorText(failure), searched: true }));
    } finally {
      if (mine === seq.current) hubBusy.current = false;
    }
  }, [query, sort, filters, hw]);

  useEffect(() => {
    if (mode !== 'hub') return;
    const timer = window.setTimeout(() => void fetchHub(true), query ? 320 : 0);
    return () => window.clearTimeout(timer);
    // `fetchHub` changes with every input it reads; the inputs are listed so it runs once per change.
  }, [mode, query, sort, filterKey, filters.has('fits') ? hwReady : 0]);

  // Load the next page when the end of the list scrolls into view.
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || mode !== 'hub' || !hub.next) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void fetchHub(false); }, { root: listRef.current, rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode, hub.next, hub.items.length, fetchHub]);

  // ---- rows -----------------------------------------------------------------------------------
  const runningId = llm?.running?.modelId ?? null;
  const cardRow = useCallback((view: LibraryView): Row => {
    const entry = view.entry;
    const repo = repoOfEntry(entry);
    const known = repo ? meta[repo] : undefined;
    const job = view.state.download ? jobs.find((candidate) => candidate.id === view.state.download?.jobId) : undefined;
    const status = statusOf(view, job);
    const shape = entry.variants.find((variant) => variant.default)?.llm ?? entry.variants[0]?.llm;
    const facts = [shape ? paramsLabel(shape.totalParamsB) + (shape.moe ? ` · ${paramsLabel(shape.activeParamsB)} active` : '') : '', entry.source === 'huggingface' ? entry.publisher?.name ?? '' : ''].filter(Boolean);
    return {
      key: `card:${entry.id}`,
      selection: { kind: 'card', id: entry.id },
      name: entry.name,
      maker: known?.maker ?? entry.maker,
      logo: known?.makerAvatarPath ?? entry.publisher?.avatarPath ?? null,
      verified: known?.verified ?? entry.source !== 'huggingface',
      line: entry.source === 'huggingface' ? [prettyMaker(entry.maker), ...facts].join(' · ') : entry.summary,
      caps: entryCapabilities(entry),
      date: known?.updatedAt ?? null,
      engine: entry.runtime === 'strata' ? STRATA_BADGE : null,
      downloads: known?.downloads ?? null,
      mark: runningId === entry.id ? { tone: 'use', label: 'In use' }
        : status.id === 'downloading' || status.id === 'queued' ? { tone: 'busy', label: status.label }
        : status.id === 'ready' || status.id === 'on' ? { tone: 'done', label: 'Downloaded' }
        : null,
    };
  }, [jobs, meta, runningId]);

  const hubRow = useCallback((model: HubRow): Row => {
    const ownedView = added.find((view) => view.entry.publisher?.repo === model.repo && !!view.state.installedVariant);
    const facts = [model.paramsB ? paramsLabel(model.paramsB) : '', model.architecture ?? ''].filter(Boolean);
    return {
      key: `hub:${model.repo}`,
      selection: { kind: 'hub', row: model },
      name: displayName(model.name),
      maker: model.maker,
      logo: model.makerAvatarPath ?? model.avatarPath,
      verified: model.verified,
      line: [model.author !== model.maker ? model.author : prettyMaker(model.maker), ...facts].join(' · '),
      caps: hubCapabilities(model),
      date: model.updatedAt,
      engine: null,
      downloads: model.downloads,
      mark: ownedView ? { tone: runningId === ownedView.entry.id ? 'use' : 'done', label: runningId === ownedView.entry.id ? 'In use' : 'Downloaded' } : null,
    };
  }, [added, runningId]);

  const pickRows = useMemo(() => picks.filter((view) => entryMatches(view.entry, query, filters, hw)).map(cardRow), [picks, query, filters, hw, cardRow]);
  const addedRows = useMemo(() => added.filter((view) => entryMatches(view.entry, query, filters, hw)).map(cardRow), [added, query, filters, hw, cardRow]);
  const hubRows = useMemo(() => hub.items.map(hubRow), [hub.items, hubRow]);
  const visible = mode === 'picks' ? [...pickRows, ...addedRows] : hubRows;

  // Show the first model when nothing is open, and drop a selection that left the list (a deleted download).
  const selectedKey = selection ? (selection.kind === 'card' ? `card:${selection.id}` : `hub:${selection.row.repo}`) : null;
  useEffect(() => {
    if (selection && selection.kind === 'card' && listing && !llmViews.some((view) => view.entry.id === selection.id)) { setSelection(null); return; }
    if (!selection && visible.length) setSelection(visible[0].selection);
  }, [selection, visible, listing, llmViews]);

  const toggle = (filter: QuickFilter) => setFilters((now) => { const next = new Set(now); if (next.has(filter)) next.delete(filter); else next.add(filter); return next; });
  const offline = hub.error?.includes("Couldn't reach");

  const emptyPicks = mode === 'picks' && listing && !visible.length;
  const countText = mode === 'picks'
    ? `${pickRows.length} pick${pickRows.length === 1 ? '' : 's'}${addedRows.length ? ` · ${addedRows.length} added` : ''}`
    : hub.items.length ? `${hub.items.length}${hub.next ? '+' : ''} models` : '';

  return (
    <div className="lb">
      <aside className="lb-side" aria-label="Find a language model">
        <div className="lb-side-head">
          <label className="lb-search">
            <Search size={14} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models by name or publisher" aria-label="Search models by name or publisher" spellCheck={false} />
            {query && <button type="button" className="lb-clear" onClick={() => setQuery('')} aria-label="Clear the search"><X size={13} /></button>}
          </label>
          <div className="lb-seg" role="tablist" aria-label="Where to look">
            <button type="button" role="tab" aria-selected={mode === 'picks'} className={mode === 'picks' ? 'on' : ''} onClick={() => setMode('picks')}>Bhippi picks</button>
            <button type="button" role="tab" aria-selected={mode === 'hub'} className={mode === 'hub' ? 'on' : ''} onClick={() => setMode('hub')}>Hugging Face</button>
          </div>
          <div className="lb-controls">
            {mode === 'hub' ? (
              <label className="lb-sort">
                <span className="lb-sr">Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortChoice)}>
                  {SORTS.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                </select>
              </label>
            ) : <span className="lb-faint">Tested by Bhippi for this PC</span>}
            <span className="lb-count" aria-live="polite">{countText}</span>
          </div>
          <div className="lb-filters" role="group" aria-label="Quick filters">
            {QUICK_FILTERS.map((filter) => (
              <button key={filter.id} type="button" className={`lb-toggle${filters.has(filter.id) ? ' on' : ''}`} aria-pressed={filters.has(filter.id)} title={filter.hint} onClick={() => toggle(filter.id)}>{filter.label}</button>
            ))}
          </div>
        </div>

        <div className="lb-list" ref={listRef} role="listbox" aria-label="Models">
          {mode === 'picks' && !listing && !listError && <Skeletons />}
          {mode === 'picks' && listError && !listing && (
            <div className="lb-state"><TriangleAlert size={18} /><strong>The model list is not available</strong><span>{listError}</span><button type="button" className="btn btn-small" onClick={() => void refresh()}>Try again</button></div>
          )}
          {mode === 'picks' && pickRows.length > 0 && <RowGroup title={addedRows.length ? 'Bhippi picks' : null} rows={pickRows} selectedKey={selectedKey} onSelect={setSelection} />}
          {mode === 'picks' && addedRows.length > 0 && <RowGroup title="Added from Hugging Face" rows={addedRows} selectedKey={selectedKey} onSelect={setSelection} />}
          {emptyPicks && (
            <div className="lb-state"><SearchX size={18} /><strong>No picks match</strong><span>Try Hugging Face to search every model it hosts.</span><button type="button" className="btn btn-small" onClick={() => setMode('hub')}>Search Hugging Face</button></div>
          )}

          {mode === 'hub' && hub.loading && !hub.items.length && <Skeletons />}
          {mode === 'hub' && hubRows.length > 0 && <RowGroup title={null} rows={hubRows} selectedKey={selectedKey} onSelect={setSelection} />}
          {mode === 'hub' && hub.next && <div ref={sentinel} className="lb-more">{hub.loading ? <><LoaderCircle size={13} className="spin" /> Loading more…</> : <button type="button" className="btn btn-small" onClick={() => void fetchHub(false)}>Load more</button>}</div>}
          {mode === 'hub' && hub.error && (
            <div className="lb-state">
              {offline ? <WifiOff size={18} /> : <TriangleAlert size={18} />}
              <strong>{offline ? "Couldn't reach Hugging Face" : 'Search did not work'}</strong>
              <span>{offline ? 'Check your connection.' : hub.error}</span>
              <button type="button" className="btn btn-small" onClick={() => void fetchHub(!hub.items.length)}>Try again</button>
            </div>
          )}
          {mode === 'hub' && hub.searched && !hub.loading && !hub.error && !hubRows.length && (
            <div className="lb-state"><SearchX size={18} /><strong>No models found</strong><span>{filters.size ? 'Try turning a filter off, or a different search.' : 'Try a different search, or a publisher such as unsloth or bartowski.'}</span>{filters.size > 0 && <button type="button" className="btn btn-small" onClick={() => setFilters(new Set())}>Clear filters</button>}</div>
          )}
        </div>
      </aside>

      <section className="lb-detail-pane" aria-label="Model details">
        {selection ? (
          <LlmDetail selection={selection} ctx={{ hw, freeGb, views: llmViews, jobs, llm, refresh: () => void refresh(), onSelectCard: (id) => setSelection(id ? { kind: 'card', id } : null) }} />
        ) : (
          <div className="lb-state big">{hub.loading || (!listing && !listError) ? <><LoaderCircle size={18} className="spin" /><span>Loading…</span></> : <><SearchX size={18} /><span>Pick a model on the left to see its sizes.</span></>}</div>
        )}
      </section>
    </div>
  );
}

function RowGroup({ title, rows, selectedKey, onSelect }: { title: string | null; rows: Row[]; selectedKey: string | null; onSelect: (selection: Selection) => void }) {
  return (
    <div className="lb-group">
      {title && <div className="lb-group-title">{title}</div>}
      {rows.map((row) => (
        <button key={row.key} type="button" role="option" aria-selected={row.key === selectedKey} className={`lb-row${row.key === selectedKey ? ' on' : ''}`} onClick={() => onSelect(row.selection)}>
          <MakerLogo path={row.logo} name={row.maker || row.name} size={38} />
          <span className="lb-row-body">
            <span className="lb-row-top">
              <span className="lb-row-name">{row.name}</span>
              {row.verified && <VerifiedTick maker={prettyMaker(row.maker)} />}
              {row.mark && <span className={`lb-mark ${row.mark.tone}`}>{row.mark.label}</span>}
            </span>
            <span className="lb-row-line">{row.line}</span>
            <span className="lb-row-foot">
              <CapIcons caps={row.caps} />
              {row.engine && <span className="lb-engine">{row.engine}</span>}
              {row.downloads != null && row.downloads > 0 && <span className="lb-faint lb-downloads" title={`${row.downloads.toLocaleString()} downloads`}>↓ {compact(row.downloads)}</span>}
              {row.date && <span className="lb-faint lb-date">{relativeDate(row.date)}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="lb-group" aria-label="Loading models" role="status">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="lb-row skeleton" aria-hidden="true">
          <span className="lb-skeleton circle" />
          <span className="lb-row-body"><span className="lb-skeleton line" style={{ width: `${55 + ((index * 13) % 30)}%` }} /><span className="lb-skeleton line short" /><span className="lb-skeleton line tiny" /></span>
        </div>
      ))}
    </div>
  );
}
