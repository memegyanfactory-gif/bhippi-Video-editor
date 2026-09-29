// Provider + model picker for the chat composer.
//
// A quiet pill in the composer (provider glyph, model name, chevron) opens a fixed 360×346 panel:
// a narrow rail of providers down the left — Favorites first — with one bar that slides to the
// one in view, and on the right a search on an underline over a flat list of models. Each row is
// the model's readable name (a NEW tag for models that turned up this week), the provider under
// it, a Ctrl+1…9 chip on the first nine rows and a star. Providers with long lists (OpenCode
// alone lists nearly four hundred) show their first section and fold the others into rows that
// open in place. The keyboard drives all of it from the search box: ↑ ↓ to move, Enter to
// choose, Ctrl+1…9 to jump, Tab to walk the rail, Esc to close.
import { Check, ChevronDown, ChevronRight, LoaderCircle, Plus, RefreshCw, Search, Settings2, Star } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/ipc';
import type { ProviderInfo } from '../lib/types';
import { splitVariant } from '../lib/modelVariants';
import { modelGroup, prettyModel, tierFamilies, tierOf } from '../lib/modelTiers';
import { pickerModels } from '../lib/modelVariants';
import { ProviderLogo } from './ProviderLogo';
import '../styles/models.css';

const FAVORITES_KEY = 'bhippi.favoriteModels.v1';
const RECENTS_KEY = 'bhippi.recentModels.v1';
const FIRST_SEEN_KEY = 'bhippi.modelFirstSeen.v1';
/** A model list older than this is re-read in the background when the picker opens. */
export const STALE_AFTER_MS = 10 * 60_000;
/** How long a model that just appeared in a provider's list keeps its NEW tag. */
const NEW_FOR_MS = 7 * 24 * 60 * 60_000;
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 346;
const SEARCH_LIMIT = 150;
/** A provider list longer than this shows its first section and folds the rest. */
const FOLD_AFTER = 14;
const key = (provider: string, model: string) => `${provider}::${model}`;
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

function loadList(storageKey: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveList(storageKey: string, list: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {
    // Favorites and recents are conveniences; losing them is fine.
  }
}

/**
 * When each model was first listed, so a model a provider adds can say NEW for a week. The very
 * first run records everything as old: a fresh install should not call the whole list new.
 */
function firstSeen(providers: ProviderInfo[], now: number): Record<string, number> {
  let seen: Record<string, number> = {};
  let fresh = false;
  try {
    const raw = localStorage.getItem(FIRST_SEEN_KEY);
    fresh = raw === null;
    const value: unknown = JSON.parse(raw ?? '{}');
    if (value && typeof value === 'object') seen = value as Record<string, number>;
  } catch {
    fresh = true;
  }
  let changed = false;
  for (const provider of providers) {
    for (const id of provider.models) {
      const k = key(provider.id, id);
      if (typeof seen[k] !== 'number') {
        seen[k] = fresh ? 0 : now;
        changed = true;
      }
    }
  }
  if (changed) {
    try {
      localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(seen));
    } catch {
      // Only the NEW tags depend on it.
    }
  }
  return seen;
}

/** Model ids are long; the picker shows the readable tail. */
export function shortModel(model: string) {
  const base = splitVariant(model)?.base || model;
  const tail = base.split('/').pop() ?? base;
  return tail.length > 34 ? `${tail.slice(0, 32)}…` : tail;
}

export function defaultModelLabel(provider: ProviderInfo | undefined) {
  if (!provider) return 'Choose a provider';
  if (provider.kind === 'builtin') return 'Offline commands';
  if (provider.kind === 'cli') return `${provider.label} default`;
  // The backend sends the first listed model when none is picked (recommended ones lead the list).
  return provider.models[0] ? `Auto (${prettyModel(provider.models[0])})` : 'Default model';
}

/** Whether any row's model list is old enough to re-read. */
export function isStale(providers: ProviderInfo[], now = Date.now()) {
  return providers.some((provider) => provider.kind !== 'builtin' && now - Date.parse(provider.detectedAt) > STALE_AFTER_MS);
}

/** One refresh at a time across every picker instance. */
let refreshing: Promise<unknown> | null = null;
function refreshProviders() {
  refreshing ??= api.providersRefresh().catch(() => undefined).finally(() => { refreshing = null; });
  return refreshing;
}

type Props = {
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  onSelect: (providerId: string, model: string | null) => void;
  onManage: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picker was closed by a choice or Escape: the caller hands the keyboard back (to the composer). */
  onDone?: () => void;
};

/** One model the list can show. */
type Row = { provider: ProviderInfo; id: string; title: string; group: string };

/** What the list draws, in order: models, the provider's default, and folded sections. */
type Item =
  | { type: 'model'; row: Row }
  | { type: 'default'; provider: ProviderInfo }
  | { type: 'fold'; group: string; count: number; open: boolean }
  | { type: 'custom'; provider: ProviderInfo };

/** A provider's models, one row per model: effort variants folded away, sizes kept apart. */
function rowsOf(provider: ProviderInfo): Row[] {
  const ids = pickerModels([...new Set(provider.models)]);
  // A family's sizes (Opus · Sonnet · Haiku) sit next to each other, largest first.
  const families = tierFamilies(ids);
  const placed = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    const family = families.get(tierOf(id).family);
    if (!family) ordered.push(id);
    else if (!placed.has(tierOf(id).family)) {
      placed.add(tierOf(id).family);
      ordered.push(...[...family].reverse().map((step) => step.id));
    }
  }
  return ordered.map((id) => ({ provider, id, title: prettyModel(id), group: modelGroup(id) }));
}

export function ModelPicker({ providers: allProviders, providerId, model, onSelect, onManage, open, onOpenChange, onDone }: Props) {
  // The offline command parser is not listed: it is Bhippi's own fallback, not an AI to choose.
  const providers = useMemo(() => allProviders.filter((provider) => provider.kind !== 'builtin'), [allProviders]);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState(providerId ?? providers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => loadList(FAVORITES_KEY));
  const [recents, setRecents] = useState(() => loadList(RECENTS_KEY));
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bar, setBar] = useState<number | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [position, setPosition] = useState({ left: 8, bottom: 48, width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const current = allProviders.find((provider) => provider.id === providerId);
  const tabProvider = providers.find((provider) => provider.id === tab);

  const refresh = useCallback(() => {
    setBusy(true);
    void refreshProviders().finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (open) {
      // Like t3code: Favorites first when there are any, else the provider in use.
      const inUse = providerId && providers.some((p) => p.id === providerId) ? providerId : providers[0]?.id ?? '';
      setTab(favorites.length ? 'favorites' : inUse);
      setUnfolded([]);
      setSeen(firstSeen(providers, Date.now()));
      window.setTimeout(() => search.current?.focus(), 0);
    } else {
      setQuery('');
      setCustom('');
      setCustomOpen(false);
    }
    // Only on opening: a background refresh must not yank the tab back.
  }, [open]);

  // Opening with an old list re-reads every provider in the background; the rows update in place
  // when the sweep lands (App listens for `bhippi://providers`).
  useEffect(() => {
    if (open && isStale(providers)) refresh();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      const height = Math.max(220, Math.min(PANEL_HEIGHT, window.innerHeight - bottom - 12));
      setPosition({ width, bottom, height, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // The rail's one selection bar slides to the button in view.
  useLayoutEffect(() => {
    if (!open) return;
    const button = rail.current?.querySelector<HTMLElement>('[data-rail-on="true"]');
    setBar(button ? button.offsetTop + button.offsetHeight / 2 - 10 : null);
  }, [open, tab, providers.length]);

  const needle = query.trim().toLowerCase();
  const allRows = useMemo(() => new Map(providers.map((provider) => [provider.id, rowsOf(provider)])), [providers]);
  const starred = (row: Row) => favorites.includes(key(row.provider.id, row.id));

  // What the list shows, in order. Built once per input change.
  const items = useMemo<Item[]>(() => {
    if (needle) {
      const words = needle.split(/\s+/);
      const hits = providers.flatMap((provider) => (allRows.get(provider.id) ?? []).filter((row) => {
        const hay = `${row.id} ${row.title} ${provider.label}`.toLowerCase();
        return words.every((word) => hay.includes(word));
      }));
      // Favorites first, then the provider's own order.
      hits.sort((a, b) => Number(starred(b)) - Number(starred(a)));
      return hits.slice(0, SEARCH_LIMIT).map((row) => ({ type: 'model', row }));
    }
    if (tab === 'favorites') {
      return providers.flatMap((provider) => (allRows.get(provider.id) ?? []).filter(starred).map((row): Item => ({ type: 'model', row })));
    }
    if (!tabProvider) return [];
    const rows = allRows.get(tabProvider.id) ?? [];
    const out: Item[] = [{ type: 'default', provider: tabProvider }];
    const recent = recents
      .filter((item) => item.startsWith(`${tabProvider.id}::`))
      .map((item) => item.slice(tabProvider.id.length + 2));
    // Favorites, then what was picked lately, then the provider's order.
    const rank = (row: Row) => (starred(row) ? 0 : recent.includes(row.id) ? 1 : 2);
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
    if (rows.length <= FOLD_AFTER) out.push(...sorted.map((row): Item => ({ type: 'model', row })));
    else {
      // Favorites, recents and the first section show; every other section folds.
      const first = rows[0]?.group;
      const shown = sorted.filter((row) => rank(row) < 2 || row.group === first);
      out.push(...shown.map((row): Item => ({ type: 'model', row })));
      const rest = new Map<string, Row[]>();
      for (const row of sorted) if (!shown.includes(row)) rest.set(row.group, [...(rest.get(row.group) ?? []), row]);
      for (const [group, groupRows] of rest) {
        const isOpen = unfolded.includes(group);
        out.push({ type: 'fold', group, count: groupRows.length, open: isOpen });
        if (isOpen) out.push(...groupRows.map((row): Item => ({ type: 'model', row })));
      }
    }
    if (tabProvider.acceptsCustomModel) out.push({ type: 'custom', provider: tabProvider });
    return out;
  }, [needle, tab, tabProvider, providers, allRows, favorites, recents, unfolded]);

  const hidden = needle ? providers.reduce((sum, provider) => sum + (allRows.get(provider.id) ?? []).filter((row) => needle.split(/\s+/).every((word) => `${row.id} ${row.title} ${provider.label}`.toLowerCase().includes(word))).length, 0) - items.length : 0;

  // Two rows with the same readable name (an alias and its dated snapshot) show their ids.
  const clashes = useMemo(() => {
    const count = new Map<string, number>();
    for (const item of items) if (item.type === 'model') count.set(item.row.title, (count.get(item.row.title) ?? 0) + 1);
    return count;
  }, [items]);

  // Ctrl+1…9 belong to the first nine models in view.
  const jumps = items.flatMap((item, at) => (item.type === 'model' ? [at] : [])).slice(0, 9);

  // The cursor starts on the model in use, so Enter on open keeps things as they are.
  useEffect(() => {
    if (!open) return;
    const at = items.findIndex((item) => item.type === 'model' && item.row.provider.id === providerId && sameModel(item.row.id, model));
    const fallback = items.findIndex((item) => item.type === 'model');
    setCursor(at >= 0 ? at : Math.max(0, fallback));
  }, [open, tab, needle]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-option="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const choose = (provider: string, chosen: string | null) => {
    if (chosen) {
      const next = [key(provider, chosen), ...recents.filter((item) => item !== key(provider, chosen))].slice(0, 12);
      setRecents(next);
      saveList(RECENTS_KEY, next);
    }
    onSelect(provider, chosen);
    onOpenChange(false);
    onDone?.();
  };

  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.type === 'model') choose(item.row.provider.id, item.row.id);
    else if (item.type === 'default') choose(item.provider.id, null);
    else if (item.type === 'fold') setUnfolded((groups) => (groups.includes(item.group) ? groups.filter((g) => g !== item.group) : [...groups, item.group]));
    else setCustomOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!anchor.current?.contains(node) && !panel.current?.contains(node)) onOpenChange(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        onDone?.();
        return;
      }
      // Ctrl+1…9 (⌘ on a Mac) picks that row, wherever the focus is inside the picker.
      if ((isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        const at = jumps[Number(event.key) - 1];
        if (at === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        activate(items[at]);
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keys, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys, true);
    };
  }, [open, onOpenChange, items, jumps]);

  const navigate = (event: React.KeyboardEvent) => {
    const last = items.length - 1;
    if (event.key === 'ArrowDown') setCursor((at) => Math.min(last, at + 1));
    else if (event.key === 'ArrowUp') setCursor((at) => Math.max(0, at - 1));
    else if (event.key === 'PageDown') setCursor((at) => Math.min(last, at + 8));
    else if (event.key === 'PageUp') setCursor((at) => Math.max(0, at - 8));
    else if (event.key === 'Enter') activate(items[cursor]);
    else if (event.key === 'Tab' && !needle) {
      // Tab walks the provider rail, quicker than the mouse for a handful of providers.
      const ids = ['favorites', ...providers.map((provider) => provider.id)];
      const step = event.shiftKey ? ids.length - 1 : 1;
      setTab(ids[(ids.indexOf(tab) + step) % ids.length]);
    } else return;
    event.preventDefault();
  };

  const toggleFavorite = (provider: string, id: string) => {
    const k = key(provider, id);
    const next = favorites.includes(k) ? favorites.filter((item) => item !== k) : [...favorites, k];
    setFavorites(next);
    saveList(FAVORITES_KEY, next);
  };

  const label = model ? prettyModel(splitVariant(model)?.base || model) : defaultModelLabel(current);
  const now = Date.now();
  const jumpLabel = (at: number) => {
    const n = jumps.indexOf(at);
    return n < 0 ? null : isMac ? `⌘${n + 1}` : `Ctrl+${n + 1}`;
  };

  return (
    <div ref={anchor} className="picker-anchor">
      <button
        type="button"
        className={`composer-pill picker-trigger${open ? ' active' : ''}`}
        onClick={() => onOpenChange(!open)}
        title={`${current?.label ?? 'Provider'} · ${model ?? 'default model'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="picker-trigger-main">
          <ProviderLogo id={providerId ?? 'bhippi'} size={16} />
          <span className="picker-model">{label}</span>
        </span>
        <ChevronDown size={14} strokeWidth={2.25} className="pill-chevron" />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="mp2 menu-glass" role="dialog" aria-label="Choose AI provider and model" style={{ position: 'fixed', ...position }}>
            {!needle && (
              <div className="mp2-rail" ref={rail} role="tablist" aria-orientation="vertical" aria-label="Providers">
                <button type="button" role="tab" aria-selected={tab === 'favorites'} data-rail-on={tab === 'favorites'} className="mp2-rail-btn" title="Favorites" onClick={() => { setTab('favorites'); search.current?.focus(); }}>
                  <Star size={18} fill="currentColor" />
                </button>
                <div className="mp2-rail-rule" />
                {providers.map((provider) => (
                  <button key={provider.id} type="button" role="tab" aria-selected={tab === provider.id} data-rail-on={tab === provider.id} title={`${provider.label} · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`} className="mp2-rail-btn" onClick={() => { setTab(provider.id); search.current?.focus(); }}>
                    <ProviderLogo id={provider.id} size={20} />
                  </button>
                ))}
                <span className="mp2-rail-fill" />
                <button type="button" className="mp2-rail-btn small" onClick={refresh} disabled={busy} title="Re-read every provider's model list">
                  {busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                </button>
                <button type="button" className="mp2-rail-btn small" onClick={() => { onOpenChange(false); onManage(); }} title="Manage providers">
                  <Settings2 size={15} />
                </button>
                {bar !== null && <span className="mp2-rail-bar" style={{ top: bar }} />}
              </div>
            )}
            <div className="mp2-main">
              <div className="mp2-search">
                <Search size={15} />
                <input
                  ref={search}
                  placeholder="Search models..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={navigate}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="mp2-list"
                  aria-activedescendant={`mp2-option-${cursor}`}
                  spellCheck={false}
                />
              </div>
              <div className="mp2-list" id="mp2-list" role="listbox" ref={list} aria-label="Models">
                {items.map((item, at) => {
                  const common = {
                    id: `mp2-option-${at}`,
                    'data-option': at,
                    onPointerMove: () => { if (cursor !== at) setCursor(at); },
                  };
                  if (item.type === 'fold') {
                    return (
                      <div key={`fold:${item.group}`} {...common} role="option" aria-selected={false} aria-expanded={item.open} className={`mp2-row fold${cursor === at ? ' cursor' : ''}`} onClick={() => activate(item)}>
                        <span className="mp2-copy">
                          <span className="mp2-name">{item.group}</span>
                          <span className="mp2-sub">{item.count} model{item.count === 1 ? '' : 's'}</span>
                        </span>
                        <ChevronRight size={16} className={`mp2-fold-chevron${item.open ? ' open' : ''}`} />
                      </div>
                    );
                  }
                  if (item.type === 'custom') {
                    return customOpen ? (
                      <form key="custom" className="mp2-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) choose(item.provider.id, custom.trim()); }}>
                        <input autoFocus placeholder="Exact model id…" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Custom model id" spellCheck={false} />
                        <button type="submit" className="btn btn-small" disabled={!custom.trim()}>Use</button>
                      </form>
                    ) : (
                      <div key="custom" {...common} role="option" aria-selected={false} className={`mp2-row${cursor === at ? ' cursor' : ''}`} onClick={() => activate(item)}>
                        <span className="mp2-copy">
                          <span className="mp2-name mp2-with-icon"><Plus size={12} /> Custom model id</span>
                          <span className="mp2-sub">Any id {item.provider.label} accepts</span>
                        </span>
                      </div>
                    );
                  }
                  if (item.type === 'default') {
                    const on = item.provider.id === providerId && !model;
                    return (
                      <div key="default" {...common} role="option" aria-selected={on} className={`mp2-row${cursor === at ? ' cursor' : ''}${on ? ' selected' : ''}`} onClick={() => activate(item)}>
                        <span className="mp2-copy">
                          <span className="mp2-name">{item.provider.kind === 'cli' ? 'Default model' : defaultModelLabel(item.provider)}</span>
                          <span className="mp2-sub"><ProviderLogo id={item.provider.id} size={12} />{item.provider.kind === 'cli' ? `Whatever ${item.provider.label} is set to` : item.provider.label}</span>
                        </span>
                        {on && <Check size={13} className="mp2-check" />}
                      </div>
                    );
                  }
                  const { row } = item;
                  const on = row.provider.id === providerId && sameModel(row.id, model);
                  const star = starred(row);
                  const fresh = (seen[key(row.provider.id, row.id)] ?? 0) > now - NEW_FOR_MS;
                  const jump = jumpLabel(at);
                  return (
                    <div
                      key={`${row.provider.id}:${row.id}`}
                      {...common}
                      role="option"
                      aria-selected={on}
                      title={row.id}
                      className={`mp2-row${cursor === at ? ' cursor' : ''}${on ? ' selected' : ''}`}
                      onClick={() => activate(item)}
                    >
                      <span className="mp2-copy">
                        <span className="mp2-name-line">
                          <span className="mp2-name">{row.title}</span>
                          {fresh && <span className="mp2-new">New</span>}
                        </span>
                        <span className="mp2-sub">
                          <ProviderLogo id={row.provider.id} size={12} />
                          {row.provider.label}{(clashes.get(row.title) ?? 0) > 1 ? ` · ${shortModel(row.id)}` : ''}
                        </span>
                      </span>
                      <span className="mp2-end">
                        {jump && <kbd className="mp2-kbd">{jump}</kbd>}
                        <button
                          type="button"
                          className={`mp2-star${star ? ' on' : ''}`}
                          title={star ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={star ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={(event) => { event.stopPropagation(); toggleFavorite(row.provider.id, row.id); }}
                        >
                          <Star size={12} fill={star ? 'currentColor' : 'none'} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {hidden > 0 && <div className="mp2-empty">{hidden} more — keep typing to narrow it down.</div>}
                {items.length === 0 && (
                  <div className="mp2-empty">
                    {needle ? 'No models found' : tab === 'favorites' ? 'Star a model to keep it here.' : busy ? 'Reading the model list…' : 'This provider listed no models.'}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Whether two ids are the same model, ignoring an effort suffix (the thinking menu picks that). */
function sameModel(a: string | null, b: string | null) {
  if (a === null || b === null) return a === b;
  return a === b || (splitVariant(a)?.base || a) === (splitVariant(b)?.base || b);
}
