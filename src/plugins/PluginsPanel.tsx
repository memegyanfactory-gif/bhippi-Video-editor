// The Plugins panel: a home tab listing every installed or created plugin with the way to the
// marketplace, one tab per plugin the user opened, and the plugins that run in the background
// with no panel at all.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BookOpen, ChevronRight, Download, ExternalLink, MoreVertical, Plus, Puzzle, Search, Store, Upload } from 'lucide-react';
import '../styles/plugins.css';
import { SAMPLE_PLUGINS, type SamplePlugin } from './marketSamples';
import { PluginFrame } from './PluginFrame';
import { AppIcon } from './PluginMarket';
import { patchPlugin, usePlugins } from './store';
import type { Plugin } from './types';

export const pluginGlyph = (plugin: Pick<Plugin, 'icon'>) => plugin.icon?.trim() || '🧩';

/** A plugin's mark for places that can show a picture: its uploaded logo, else its emoji. */
export function PluginMark({ plugin, size = 16 }: { plugin: Pick<Plugin, 'icon' | 'logo'>; size?: number }) {
  if (plugin.logo) return <img className="plugin-mark" src={plugin.logo} width={size} height={size} alt="" draggable={false} />;
  return <>{pluginGlyph(plugin)}</>;
}

/** The plugins that are tabs in the panel, in library order. One docked in the editing area is a panel there instead. */
export const panelPlugins = (plugins: Plugin[], docked: ReadonlySet<string> = new Set()) => plugins.filter((plugin) => plugin.enabled && plugin.panel && !docked.has(plugin.id));

/**
 * The panel's body. Every tab's frame stays mounted (hidden when not active), so switching tabs
 * does not restart a plugin. `skip` is the plugin the Plugin Maker has open: its preview is the
 * one running copy while it is being built. `builtin` is a tab Bhippi ships (Characters): when it
 * is the active tab it shows instead, and the plugins' frames stay mounted behind it.
 */
export function PluginsPanelBody({ active, skip, docked, onMaker, onOpenInMaker, builtin }: {
  active: string | null;
  skip: string | null;
  /** Plugins docked in the editing area, which run there and not as tabs here. */
  docked: ReadonlySet<string>;
  onMaker: () => void;
  onOpenInMaker: (id: string) => void;
  builtin?: { id: string; body: ReactNode };
}) {
  const { plugins, loaded } = usePlugins();
  const shown = panelPlugins(plugins, docked);
  const builtinActive = !!builtin && (active === builtin.id || !shown.length);
  if (!shown.length && !builtin) {
    const others = plugins.filter((plugin) => !plugin.panel);
    return (
      <div className="plugins-empty">
        <Puzzle size={28} strokeWidth={1.4} />
        <p><strong>Plugins</strong> add your own tools, dashboards and automations to Bhippi — describe one and Bhippi AI builds it.</p>
        <button type="button" className="btn btn-primary" onClick={onMaker}><Plus size={13} /> Custom plugin</button>
        {loaded && !!others.length && (
          <div className="plugins-empty-list">
            <span>Installed</span>
            {others.map((plugin) => (
              <button key={plugin.id} type="button" className="btn" onClick={() => void patchPlugin(plugin.id, { panel: true, enabled: true })} title={plugin.description}>
                {pluginGlyph(plugin)} {plugin.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const current = builtinActive ? null : shown.find((plugin) => plugin.id === active) ?? shown[0];
  return (
    <div className="plugins-body">
      {builtinActive && builtin?.body}
      {shown.map((plugin) =>
        plugin.id === skip ? (
          plugin.id === current?.id && (
            <div key={plugin.id} className="plugin-frame-empty">
              “{plugin.name}” is open in the Plugin Maker. <button type="button" className="btn" onClick={() => onOpenInMaker(plugin.id)}>Go there</button>
            </div>
          )
        ) : (
          <PluginFrame key={plugin.id} pluginId={plugin.id} hidden={plugin.id !== current?.id} />
        ),
      )}
    </div>
  );
}

/** The panel's home tab id: the library of every plugin, shown before any plugin's own tab. */
export const PLUGINS_HOME = 'plugins-home';

/**
 * A plugin Bhippi ships (Characters), featured at the top of the library and opened its own way.
 * `banner` is the artwork behind its featured card; `icon` its small square avatar.
 */
export type BuiltinPlugin = { id: string; name: string; description: string; icon: ReactNode; banner?: string; onOpen: () => void };

const origin = (plugin: Plugin) => (plugin.pkg && plugin.pkg.source !== 'local' ? 'Installed' : 'Created');

/** A plugin's square icon: its emoji on a tile tinted from its id, like the marketplace's app icons. */
function PluginIcon({ plugin }: { plugin: Plugin }) {
  const hue = [...plugin.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);
  return <span className={`ph-icon${plugin.logo ? ' logo' : ''}`} style={{ ['--hue' as string]: hue }} aria-hidden="true"><PluginMark plugin={plugin} size={40} /></span>;
}

/** The ⋮ menu on a card: a few actions in a small popover that closes on any outside click. */
function CardMenu({ label, items }: { label: string; items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="ph-menu" ref={ref}>
      <button type="button" className="ph-menu-btn" aria-label={`${label} options`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreVertical size={15} /></button>
      {open && (
        <div className="ph-menu-list" role="menu">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : undefined} onClick={() => { setOpen(false); item.run(); }}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The home tab: a search, Installed / Discover, the built-in Characters featured on top, every
 * plugin the user has installed or created as a card, and the way to build one. Opening a plugin
 * turns it on and gives it a tab; Get on a Discover card opens it in the Marketplace.
 */
export function PluginsHome({ builtins, docked, onDragOut, onOpen, onMarket, onMaker, onOpenInMaker, onLearn }: {
  builtins: BuiltinPlugin[];
  /** Plugins docked in the editing area. */
  docked: ReadonlySet<string>;
  /** A press on a plugin's card, which can be dragged into the editing area to dock it. */
  onDragOut: (plugin: Plugin, event: ReactPointerEvent) => void;
  onOpen: (id: string) => void;
  onMarket: () => void;
  onMaker: () => void;
  onOpenInMaker: (id: string) => void;
  onLearn?: () => void;
}) {
  const { plugins, loaded } = usePlugins();
  const [view, setView] = useState<'installed' | 'discover'>('installed');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const open = (plugin: Plugin) => {
    if (!(plugin.enabled && plugin.panel)) void patchPlugin(plugin.id, { panel: true, enabled: true });
    onOpen(plugin.id);
  };
  const featured = builtins.filter((item) => matches(`${item.name} ${item.description}`));
  const mine = plugins.filter((plugin) => matches(`${plugin.name} ${plugin.description ?? ''}`));
  const discover = SAMPLE_PLUGINS.filter((plugin) => !plugins.some((own) => own.name === plugin.name) && matches(`${plugin.name} ${plugin.tagline} ${plugin.summary}`));
  // A new user (no plugin installed or made yet) sees a clean start: the Marketplace, or build one.
  if (loaded && !plugins.length) {
    return (
      <div className="plugins-home ph-start">
        <div className="ph-start-hero">
          <span className="ph-start-glyph"><Puzzle size={28} strokeWidth={1.5} /></span>
          <strong>Add your first plugin</strong>
          <span className="ph-desc">Plugins add new tools, panels and automations to Bhippi.</span>
        </div>
        <button type="button" className="ph-start-option primary" onClick={onMarket}>
          <span className="ph-start-icon"><Store size={16} /></span>
          <span className="ph-card-text"><strong>Browse the Marketplace</strong><span className="ph-desc">Install plugins made by the community.</span></span>
          <ChevronRight size={16} />
        </button>
        <button type="button" className="ph-start-option" onClick={onMaker}>
          <span className="ph-start-icon"><Plus size={16} /></span>
          <span className="ph-card-text"><strong>Create your own</strong><span className="ph-desc">Describe it and Bhippi AI builds it, or import one.</span></span>
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="plugins-home">
      <div className="ph-head">
        <span className="ph-title"><Puzzle size={16} /> Plugins</span>
        <button type="button" className="ph-head-btn" onClick={onMarket} title="Marketplace" aria-label="Marketplace"><Store size={14} /></button>
        <button type="button" className="ph-head-btn" onClick={onMaker} title="Create or import a plugin" aria-label="Create or import a plugin"><Upload size={14} /></button>
      </div>
      <label className="ph-search">
        <Search size={14} />
        <input placeholder="Search plugins..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="ph-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'installed'} className={view === 'installed' ? 'on' : undefined} onClick={() => setView('installed')}>Installed</button>
        <button type="button" role="tab" aria-selected={view === 'discover'} className={view === 'discover' ? 'on' : undefined} onClick={() => setView('discover')}>Discover</button>
      </div>

      {view === 'installed' && featured.length > 0 && (
        <section className="ph-section">
          <h3>Featured</h3>
          {featured.map((item) => (
            <div key={item.id} className="ph-featured">
              <div className="ph-banner" style={item.banner ? { backgroundImage: `url("${item.banner}")` } : undefined}>
                <CardMenu label={item.name} items={[{ label: `Open ${item.name}`, run: item.onOpen }]} />
              </div>
              <div className="ph-featured-body">
                <span className="ph-avatar">{item.icon}</span>
                <strong>{item.name}</strong>
                <span className="ph-desc">{item.description}</span>
                <span className="ph-chip">Built-in</span>
                <button type="button" className="ph-open" onClick={item.onOpen}>Open <ExternalLink size={13} /></button>
              </div>
            </div>
          ))}
        </section>
      )}

      {view === 'installed' && mine.length > 0 && (
        <section className="ph-section">
          <h3>My plugins</h3>
          {mine.map((plugin) => (
            <div key={plugin.id} className={`ph-card${plugin.enabled ? '' : ' off'}${plugin.revoked ? '' : ' draggable'}`}
              title={plugin.revoked ? `Pulled from the marketplace: ${plugin.revoked.reason}` : `${plugin.description ? `${plugin.description}
` : ''}Drag into the editing area to dock it as a panel.`}
              onPointerDown={(event) => { if (!plugin.revoked && !(event.target as HTMLElement).closest('button')) onDragOut(plugin, event); }}>
              <PluginIcon plugin={plugin} />
              <div className="ph-card-text">
                <strong>{plugin.name}</strong>
                <span className="ph-desc">{plugin.description || (plugin.revoked ? 'Revoked' : origin(plugin))}</span>
                <button type="button" className="ph-get" disabled={!!plugin.revoked || docked.has(plugin.id)} onClick={() => open(plugin)}>
                  {plugin.revoked ? 'Revoked' : docked.has(plugin.id) ? 'In editing area' : <><ExternalLink size={13} /> Open</>}
                </button>
              </div>
              <CardMenu label={plugin.name} items={plugin.revoked ? [] : [
                { label: 'Edit in Plugin Maker', run: () => onOpenInMaker(plugin.id) },
                plugin.enabled ? { label: 'Turn off', run: () => void patchPlugin(plugin.id, { enabled: false }) } : { label: 'Turn on', run: () => void patchPlugin(plugin.id, { enabled: true }) },
                ...(plugin.panel ? [{ label: 'Remove from panel', run: () => void patchPlugin(plugin.id, { panel: false }) }] : []),
              ]} />
            </div>
          ))}
        </section>
      )}

      {view === 'discover' && (
        <section className="ph-section">
          <h3>Discover</h3>
          {discover.map((plugin) => <DiscoverCard key={plugin.id} plugin={plugin} onGet={onMarket} />)}
          {discover.length > 0 && <button type="button" className="ph-link" onClick={onMarket}><Store size={13} /> Browse the Marketplace</button>}
        </section>
      )}

      {needle && (view === 'installed' ? !featured.length && !mine.length : !discover.length) && (
        <p className="plugins-home-empty">No plugins match “{query.trim()}”.</p>
      )}

      <section className="ph-section">
        <h3>Create your own</h3>
        <button type="button" className="ph-create" onClick={onMaker}>
          <span className="ph-create-plus"><Plus size={20} /></span>
          <span className="ph-card-text"><strong>Create plugin</strong><span className="ph-desc">Build and import your own Bhippi plugin.</span></span>
          <ChevronRight size={16} />
        </button>
      </section>

      <button type="button" className="ph-link ph-learn" onClick={onLearn ?? onMaker}><BookOpen size={13} /> Learn about plugins <ExternalLink size={12} /></button>
    </div>
  );
}

/** A marketplace plugin suggested in the panel; Get opens the Marketplace, where it is installed. */
function DiscoverCard({ plugin, onGet }: { plugin: SamplePlugin; onGet: () => void }) {
  return (
    <div className="ph-card" title={plugin.about}>
      <AppIcon plugin={plugin} size={40} />
      <div className="ph-card-text">
        <strong>{plugin.name}</strong>
        <span className="ph-desc">{plugin.tagline}</span>
        <button type="button" className="ph-get" onClick={onGet}><Download size={13} /> Get</button>
      </div>
      <CardMenu label={plugin.name} items={[{ label: 'View in Marketplace', run: onGet }]} />
    </div>
  );
}

/**
 * Plugins that keep running without a visible panel: background ones not already shown as a tab
 * or docked in the editing area. `docked` is every docked plugin; `dockShown` says whether the
 * editing area is showing them (not while another panel is maximized).
 */
export function BackgroundPlugins({ panelShown, docked, dockShown, skip }: { panelShown: boolean; docked: ReadonlySet<string>; dockShown: boolean; skip: string | null }) {
  const { plugins } = usePlugins();
  const shown = (plugin: Plugin) => (docked.has(plugin.id) ? dockShown : panelShown && plugin.panel);
  const running = plugins.filter((plugin) => plugin.enabled && plugin.background && plugin.id !== skip && !shown(plugin));
  if (!running.length) return null;
  return (
    <div className="plugins-background" aria-hidden="true">
      {running.map((plugin) => <PluginFrame key={plugin.id} pluginId={plugin.id} hidden />)}
    </div>
  );
}
