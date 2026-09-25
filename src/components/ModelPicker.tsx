// Provider + model picker for the chat composer (adapted from the Bhippi desktop app's UnifiedModelPicker).
//
// The panel is one fixed height whatever the provider lists — OpenCode alone lists nearly four
// hundred models — and the list scrolls inside it. Families that come in several sizes (Gemini
// Pro · Flash · Flash-Lite, Claude Opus · Sonnet · Haiku…) fold into one row with the sizes as
// pills, sections follow the vendor, recent picks sit on top, and the keyboard drives it all from
// the search box: ↑ ↓ to move, Enter to choose, Esc to close.
import { Check, ChevronDown, LoaderCircle, Plus, RefreshCw, Search, Settings2, Star } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/ipc';
import type { ProviderInfo } from '../lib/types';
import { splitVariant } from '../lib/modelVariants';
import { modelTitle, pickerEntries, type PickerEntry } from '../lib/modelTiers';
import { ProviderLogo } from './ProviderLogo';
import '../styles/models.css';

const FAVORITES_KEY = 'bhippi.favoriteModels.v1';
const RECENTS_KEY = 'bhippi.recentModels.v1';
/** A model list older than this is re-read in the background when the picker opens. */
export const STALE_AFTER_MS = 10 * 60_000;
/** The panel's height. It never grows with the list; the list scrolls inside it. */
const PANEL_HEIGHT = 400;
const SEARCH_LIMIT = 150;
const key = (provider: string, model: string) => `${provider}::${model}`;

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

/** Model ids are long; the picker shows the readable tail. */
export function shortModel(model: string) {
  const base = splitVariant(model)?.base || model;
  const tail = base.split('/').pop() ?? base;
  return tail.length > 34 ? `${tail.slice(0, 32)}…` : tail;
}

export function defaultModelLabel(provider: ProviderInfo | undefined) {
  if (!provider) return 'Choose a provider';
  if (provider.kind === 'builtin') return 'Offline commands';
  if (provider.kind === 'cli') return 'Default model';
  return provider.models[0] ? shortModel(provider.models[0]) : 'Default model';
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
};

/** Something the keyboard can land on, in the order it is drawn. */
type Option = { provider: string; model: string | null };

type Section = { title: string | null; provider: ProviderInfo; entries: PickerEntry[] };

export function ModelPicker({ providers, providerId, model, onSelect, onManage, open, onOpenChange }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState(providerId ?? providers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => loadList(FAVORITES_KEY));
  const [recents, setRecents] = useState(() => loadList(RECENTS_KEY));
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 48, width: 440, height: PANEL_HEIGHT });
  const current = providers.find((provider) => provider.id === providerId);
  const tabProvider = providers.find((provider) => provider.id === tab);

  const refresh = useCallback(() => {
    setBusy(true);
    void refreshProviders().finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (open) {
      setTab(providerId && providers.some((p) => p.id === providerId) ? providerId : providers[0]?.id ?? '');
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
      const width = Math.min(440, window.innerWidth - 16);
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      const height = Math.max(220, Math.min(PANEL_HEIGHT, window.innerHeight - bottom - 12));
      setPosition({ width, bottom, height, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const needle = query.trim().toLowerCase();

  // What the list shows, as sections of rows. Built once per input change.
  const sections = useMemo<Section[]>(() => {
    if (needle) {
      return providers.flatMap((provider) => {
        const words = needle.split(/\s+/);
        const label = provider.label.toLowerCase();
        const entries = pickerEntries(provider.models, provider.id === providerId ? model : null)
          .filter((entry) => words.every((word) => entry.haystack.includes(word) || label.includes(word)));
        return entries.length ? [{ title: provider.label, provider, entries }] : [];
      });
    }
    if (tab === 'favorites') {
      return providers.flatMap((provider) => {
        const entries = pickerEntries(provider.models, provider.id === providerId ? model : null)
          .flatMap((entry) => {
            const ids = entry.tiers.length ? entry.tiers.map((step) => step.id) : [entry.id];
            return ids.filter((id) => favorites.includes(key(provider.id, id)))
              .map((id): PickerEntry => ({ id, title: modelTitle(id), group: entry.group, tiers: [], haystack: id }));
          });
        return entries.length ? [{ title: provider.label, provider, entries }] : [];
      });
    }
    if (!tabProvider) return [];
    const entries = pickerEntries(tabProvider.models, tabProvider.id === providerId ? model : null);
    const recent = recents
      .filter((item) => item.startsWith(`${tabProvider.id}::`))
      .map((item) => item.slice(tabProvider.id.length + 2))
      .filter((id) => tabProvider.models.includes(id))
      .slice(0, 3)
      .map((id): PickerEntry => ({ id, title: modelTitle(id), group: 'Recent', tiers: [], haystack: id }));
    const groups = new Map<string, PickerEntry[]>();
    for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    // Headings only earn their space when there is more than one section to tell apart.
    const out: Section[] = [];
    if (recent.length && entries.length > 6) out.push({ title: 'Recent', provider: tabProvider, entries: recent });
    for (const [group, rows] of groups) out.push({ title: groups.size > 1 || out.length ? group : null, provider: tabProvider, entries: rows });
    return out;
  }, [needle, tab, tabProvider, providers, providerId, model, favorites, recents]);

  const showDefault = !needle && tab !== 'favorites' && !!tabProvider;
  let shown = 0;
  const trimmed = sections.map((section) => {
    const room = Math.max(0, SEARCH_LIMIT - shown);
    const entries = needle ? section.entries.slice(0, room) : section.entries;
    shown += entries.length;
    return { ...section, entries };
  });
  const hidden = needle ? sections.reduce((sum, section) => sum + section.entries.length, 0) - shown : 0;

  const options: Option[] = [
    ...(showDefault && tabProvider ? [{ provider: tabProvider.id, model: null }] : []),
    ...trimmed.flatMap((section) => section.entries.map((entry) => ({ provider: section.provider.id, model: entry.id }))),
  ];

  // The cursor starts on the model in use, so Enter on open keeps things as they are.
  useEffect(() => {
    if (!open) return;
    const at = options.findIndex((option) => option.provider === providerId && sameModel(option.model, model));
    setCursor(at >= 0 ? at : 0);
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
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys);
    };
  }, [open, onOpenChange]);

  const navigate = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') setCursor((at) => Math.min(last, at + 1));
    else if (event.key === 'ArrowUp') setCursor((at) => Math.max(0, at - 1));
    else if (event.key === 'PageDown') setCursor((at) => Math.min(last, at + 8));
    else if (event.key === 'PageUp') setCursor((at) => Math.max(0, at - 8));
    else if (event.key === 'Enter') {
      const option = options[cursor];
      if (option) choose(option.provider, option.model);
    } else if (event.key === 'Tab' && !event.shiftKey && !needle) {
      // Tab walks the provider rail, which is quicker than the mouse for a handful of providers.
      const ids = ['favorites', ...providers.map((provider) => provider.id)];
      setTab(ids[(ids.indexOf(tab) + 1) % ids.length]);
    } else return;
    event.preventDefault();
  };

  const toggleFavorite = (provider: string, id: string) => {
    const k = key(provider, id);
    const next = favorites.includes(k) ? favorites.filter((item) => item !== k) : [...favorites, k];
    setFavorites(next);
    saveList(FAVORITES_KEY, next);
  };

  const label = model ? shortModel(model) : defaultModelLabel(current);
  let index = showDefault ? 1 : 0;

  return (
    <div ref={anchor} className="picker-anchor">
      <button type="button" className={`picker-trigger${open ? ' active' : ''}`} onClick={() => onOpenChange(!open)} title={`${current?.label ?? 'Provider'} · ${model ?? 'default'}`}>
        <ProviderLogo id={providerId ?? 'bhippi'} size={16} />
        <span className="picker-provider">{current?.label ?? 'Choose provider'}</span>
        <span className="picker-model">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="popover picker-panel mp" role="dialog" aria-label="Choose AI provider and model" style={{ position: 'fixed', ...position }}>
            <div className="picker-rail mp-rail">
              <button type="button" className={`picker-rail-btn${tab === 'favorites' ? ' active' : ''}`} title="Favorites" onClick={() => { setTab('favorites'); setQuery(''); }}>
                <Star size={14} />
              </button>
              {providers.map((provider) => (
                <button key={provider.id} type="button" title={`${provider.label} · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`} className={`picker-rail-btn${tab === provider.id ? ' active' : ''}`} onClick={() => { setTab(provider.id); setQuery(''); search.current?.focus(); }}>
                  <ProviderLogo id={provider.id} size={18} />
                </button>
              ))}
            </div>
            <div className="picker-main mp-main">
              <label className="picker-search">
                <Search size={13} />
                <input
                  ref={search}
                  placeholder="Search every provider's models…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={navigate}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="mp-list"
                  aria-activedescendant={`mp-option-${cursor}`}
                />
              </label>
              <div className="mp-heading">
                <strong>{needle ? 'Search' : tab === 'favorites' ? 'Favorites' : tabProvider?.label}</strong>
                <span>
                  {needle
                    ? `${shown + hidden} match${shown + hidden === 1 ? '' : 'es'}`
                    : tab !== 'favorites' && tabProvider
                      ? `${tabProvider.models.length} model${tabProvider.models.length === 1 ? '' : 's'}${tabProvider.version ? ` · ${tabProvider.version}` : tabProvider.detectedPort ? ` · port ${tabProvider.detectedPort}` : ''}`
                      : ''}
                </span>
                <button type="button" className="mp-icon" onClick={refresh} disabled={busy} title="Re-read every provider's model list">
                  {busy ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}
                </button>
              </div>
              <div className="mp-list" id="mp-list" role="listbox" ref={list} aria-label="Models">
                {showDefault && tabProvider && (
                  <div
                    id="mp-option-0"
                    data-option={0}
                    role="option"
                    aria-selected={tabProvider.id === providerId && !model}
                    className={`mp-row${cursor === 0 ? ' cursor' : ''}${tabProvider.id === providerId && !model ? ' selected' : ''}`}
                    onClick={() => choose(tabProvider.id, null)}
                    onPointerMove={() => setCursor(0)}
                  >
                    <span className="mp-row-text">
                      <span className="mp-title">{tabProvider.kind === 'builtin' ? 'Offline command parser' : `Use ${defaultModelLabel(tabProvider).toLowerCase()}`}</span>
                      <span className="mp-sub">{tabProvider.kind === 'cli' ? `Whatever ${tabProvider.label} is set to` : tabProvider.kind === 'builtin' ? 'Instant, no AI — direct edit commands' : 'First model the provider lists'}</span>
                    </span>
                    {tabProvider.id === providerId && !model && <Check size={13} className="mp-check" />}
                  </div>
                )}
                {trimmed.map((section, sectionAt) => (
                  <Fragment key={`${section.provider.id}:${section.title ?? sectionAt}`}>
                    {section.title && <div className="mp-group" role="presentation">{section.title}</div>}
                    {section.entries.map((entry) => {
                      const at = index++;
                      const provider = section.provider;
                      const inUse = provider.id === providerId;
                      const selected = inUse && (sameModel(entry.id, model) || entry.tiers.some((step) => sameModel(step.id, model)));
                      const starred = favorites.includes(key(provider.id, entry.id));
                      return (
                        <div
                          key={`${provider.id}:${section.title}:${entry.id}`}
                          id={`mp-option-${at}`}
                          data-option={at}
                          role="option"
                          aria-selected={selected}
                          title={entry.tiers.length ? entry.tiers.map((step) => step.id).join(' · ') : entry.id}
                          className={`mp-row${cursor === at ? ' cursor' : ''}${selected ? ' selected' : ''}`}
                          onClick={() => choose(provider.id, entry.id)}
                          onPointerMove={() => { if (cursor !== at) setCursor(at); }}
                        >
                          <span className="mp-row-text">
                            <span className="mp-title">{entry.title}</span>
                            {(needle || tab === 'favorites') && <span className="mp-sub">{provider.label}</span>}
                            {!needle && tab !== 'favorites' && entry.tiers.length === 0 && entry.title !== entry.id && <span className="mp-sub">{entry.id}</span>}
                          </span>
                          {entry.tiers.length > 0 && (
                            <span className="mp-tiers" role="group" aria-label="Size">
                              {entry.tiers.map((step) => {
                                const on = inUse && sameModel(step.id, model);
                                return (
                                  <button
                                    key={step.id}
                                    type="button"
                                    className={`mp-tier${on ? ' on' : ''}`}
                                    title={step.id}
                                    onClick={(event) => { event.stopPropagation(); choose(provider.id, step.id); }}
                                  >
                                    {step.label}
                                  </button>
                                );
                              })}
                            </span>
                          )}
                          {selected && entry.tiers.length === 0 && <Check size={13} className="mp-check" />}
                          <button
                            type="button"
                            className={`picker-star mp-star${starred ? ' on' : ''}`}
                            title={starred ? 'Remove favorite' : 'Add to favorites'}
                            onClick={(event) => { event.stopPropagation(); toggleFavorite(provider.id, entry.id); }}
                          >
                            <Star size={12} fill={starred ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
                {hidden > 0 && <div className="picker-empty">{hidden} more — keep typing to narrow it down.</div>}
                {options.length === 0 && (
                  <div className="picker-empty">
                    {needle ? 'No matching models.' : tab === 'favorites' ? 'Star a model to keep it here.' : busy ? 'Reading the model list…' : 'This provider listed no models. Refresh, or use a custom id.'}
                  </div>
                )}
              </div>
              <div className="mp-foot">
                {!needle && tabProvider?.acceptsCustomModel && tab !== 'favorites' && (customOpen ? (
                  <form className="picker-custom mp-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) choose(tabProvider.id, custom.trim()); }}>
                    <input autoFocus placeholder="Exact model id…" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Custom model id" />
                    <button type="submit" className="btn btn-small" disabled={!custom.trim()}>Use</button>
                  </form>
                ) : (
                  <button type="button" className="mp-link" onClick={() => setCustomOpen(true)}><Plus size={12} /> Custom id</button>
                ))}
                <button type="button" className="mp-link" onClick={() => { onOpenChange(false); onManage(); }}>
                  <Settings2 size={12} /> Manage providers
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Whether two ids are the same model, ignoring an effort suffix (the slider picks that). */
function sameModel(a: string | null, b: string | null) {
  if (a === null || b === null) return a === b;
  return a === b || (splitVariant(a)?.base || a) === (splitVariant(b)?.base || b);
}
