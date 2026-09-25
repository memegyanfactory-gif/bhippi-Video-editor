// The Plugins panel: every plugin the user chose to show, one tab each, and the plugins that
// run in the background with no panel at all.

import { Plus, Puzzle } from 'lucide-react';
import '../styles/plugins.css';
import { PluginFrame } from './PluginFrame';
import { patchPlugin, usePlugins } from './store';
import type { Plugin } from './types';

export const pluginGlyph = (plugin: Pick<Plugin, 'icon'>) => plugin.icon?.trim() || '🧩';

/** The plugins that are tabs in the panel, in library order. */
export const panelPlugins = (plugins: Plugin[]) => plugins.filter((plugin) => plugin.enabled && plugin.panel);

/**
 * The panel's body. Every tab's frame stays mounted (hidden when not active), so switching tabs
 * does not restart a plugin. `skip` is the plugin the Plugin Maker has open: its preview is the
 * one running copy while it is being built.
 */
export function PluginsPanelBody({ active, skip, onMaker, onOpenInMaker }: { active: string | null; skip: string | null; onMaker: () => void; onOpenInMaker: (id: string) => void }) {
  const { plugins, loaded } = usePlugins();
  const shown = panelPlugins(plugins);
  if (!shown.length) {
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
  const current = shown.find((plugin) => plugin.id === active) ?? shown[0];
  return (
    <div className="plugins-body">
      {shown.map((plugin) =>
        plugin.id === skip ? (
          plugin.id === current.id && (
            <div key={plugin.id} className="plugin-frame-empty">
              “{plugin.name}” is open in the Plugin Maker. <button type="button" className="btn" onClick={() => onOpenInMaker(plugin.id)}>Go there</button>
            </div>
          )
        ) : (
          <PluginFrame key={plugin.id} pluginId={plugin.id} hidden={plugin.id !== current.id} />
        ),
      )}
    </div>
  );
}

/** Plugins that keep running without a visible panel: background ones not already shown as a tab. */
export function BackgroundPlugins({ panelShown, skip }: { panelShown: boolean; skip: string | null }) {
  const { plugins } = usePlugins();
  const running = plugins.filter((plugin) => plugin.enabled && plugin.background && plugin.id !== skip && !(panelShown && plugin.panel));
  if (!running.length) return null;
  return (
    <div className="plugins-background" aria-hidden="true">
      {running.map((plugin) => <PluginFrame key={plugin.id} pluginId={plugin.id} hidden />)}
    </div>
  );
}
