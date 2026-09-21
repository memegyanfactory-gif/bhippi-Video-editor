// Provider + model picker for the chat composer (adapted from Bhippi's UnifiedModelPicker).
import { ChevronDown, Search, Settings2, Star } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProviderInfo } from '../lib/types';
import { pickerModels, splitVariant } from '../lib/modelVariants';
import { ProviderLogo } from './ProviderLogo';

const FAVORITES_KEY = 'helios.favoriteModels.v1';
const key = (provider: string, model: string) => `${provider}::${model}`;

function loadFavorites(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
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

type Props = {
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  onSelect: (providerId: string, model: string | null) => void;
  onManage: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ModelPicker({ providers, providerId, model, onSelect, onManage, open, onOpenChange }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState(providerId ?? providers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [favorites, setFavorites] = useState(loadFavorites);
  const [position, setPosition] = useState({ left: 8, bottom: 48, width: 400, maxHeight: 440 });
  const current = providers.find((provider) => provider.id === providerId);
  const tabProvider = providers.find((provider) => provider.id === tab);

  useEffect(() => {
    if (open) {
      setTab(providerId && providers.some((p) => p.id === providerId) ? providerId : providers[0]?.id ?? '');
      window.setTimeout(() => search.current?.focus(), 0);
    } else {
      setQuery('');
      setCustom('');
    }
  }, [open, providerId, providers]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(420, window.innerWidth - 16);
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      setPosition({ width, bottom, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), maxHeight: Math.max(160, window.innerHeight - bottom - 48) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const rows = useMemo(
    () => providers.flatMap((provider) => pickerModels([...new Set(provider.models)]).map((id) => ({ id, provider }))),
    [providers],
  );
  const needle = query.trim().toLowerCase();
  const visible = rows.filter((row) =>
    needle
      ? `${row.id} ${row.provider.label}`.toLowerCase().includes(needle)
      : tab === 'favorites'
        ? favorites.includes(key(row.provider.id, row.id))
        : row.provider.id === tab,
  );

  const choose = (provider: string, chosen: string | null) => {
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

  const toggleFavorite = (provider: string, id: string) => {
    const k = key(provider, id);
    const next = favorites.includes(k) ? favorites.filter((item) => item !== k) : [...favorites, k];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // Favorites are a convenience; losing them is fine.
    }
  };

  const label = model ? shortModel(model) : defaultModelLabel(current);

  return (
    <div ref={anchor} className="picker-anchor">
      <button type="button" className={`picker-trigger${open ? ' active' : ''}`} onClick={() => onOpenChange(!open)} title={`${current?.label ?? 'Provider'} · ${model ?? 'default'}`}>
        <ProviderLogo id={providerId ?? 'helios'} size={16} />
        <span className="picker-provider">{current?.label ?? 'Choose provider'}</span>
        <span className="picker-model">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="popover picker-panel" role="dialog" aria-label="Choose AI provider and model" style={{ position: 'fixed', ...position }}>
            <div className="picker-rail">
              <button type="button" className={`picker-rail-btn${tab === 'favorites' ? ' active' : ''}`} title="Favorites" onClick={() => setTab('favorites')}>
                <Star size={14} />
              </button>
              {providers.map((provider) => (
                <button key={provider.id} type="button" title={provider.label} className={`picker-rail-btn${tab === provider.id ? ' active' : ''}`} onClick={() => { setTab(provider.id); setQuery(''); }}>
                  <ProviderLogo id={provider.id} size={18} />
                </button>
              ))}
            </div>
            <div className="picker-main">
              <label className="picker-search">
                <Search size={13} />
                <input ref={search} placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              {!needle && tabProvider && tab !== 'favorites' && (
                <div className="picker-heading">
                  <strong>{tabProvider.label}</strong>
                  <span>{tabProvider.version ?? (tabProvider.detectedPort ? `port ${tabProvider.detectedPort}` : tabProvider.kind === 'cloud_api' ? 'cloud API' : '')}</span>
                </div>
              )}
              <div className="picker-list">
                {!needle && tabProvider && tab !== 'favorites' && (
                  <button type="button" className={`picker-row${tabProvider.id === providerId && !model ? ' selected' : ''}`} onClick={() => choose(tabProvider.id, null)}>
                    <span className="picker-row-title">{tabProvider.kind === 'builtin' ? 'Offline command parser' : `Use ${defaultModelLabel(tabProvider).toLowerCase()}`}</span>
                    <span className="picker-row-sub">{tabProvider.kind === 'cli' ? `Whatever ${tabProvider.label} is configured to use` : tabProvider.kind === 'builtin' ? 'Instant, no AI — understands direct edit commands' : 'First model the provider lists'}</span>
                  </button>
                )}
                {visible.map((row) => {
                  const starred = favorites.includes(key(row.provider.id, row.id));
                  return (
                    <div key={key(row.provider.id, row.id)} className={`picker-row with-star${row.provider.id === providerId && row.id === model ? ' selected' : ''}`}>
                      <button type="button" className="picker-row-main" title={row.id} onClick={() => choose(row.provider.id, row.id)}>
                        <span className="picker-row-title">{shortModel(row.id)}</span>
                        <span className="picker-row-sub">{row.provider.label}</span>
                      </button>
                      <button type="button" className={`picker-star${starred ? ' on' : ''}`} title={starred ? 'Remove favorite' : 'Add to favorites'} onClick={() => toggleFavorite(row.provider.id, row.id)}>
                        <Star size={12} fill={starred ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })}
                {visible.length === 0 && (needle || tab === 'favorites') && (
                  <div className="picker-empty">{needle ? 'No matching models.' : 'Star a model to keep it here.'}</div>
                )}
              </div>
              {!needle && tabProvider?.acceptsCustomModel && tab !== 'favorites' && (
                <form className="picker-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) choose(tabProvider.id, custom.trim()); }}>
                  <input placeholder="Exact model id…" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Custom model id" />
                  <button type="submit" className="btn btn-small" disabled={!custom.trim()}>Use</button>
                </form>
              )}
              <button type="button" className="picker-manage" onClick={() => { onOpenChange(false); onManage(); }}>
                <Settings2 size={13} /> Manage AI providers
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
