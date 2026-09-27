// The plugin library in memory, and what the running plugins report: their console, the
// actions they offer Bhippi AI, and the page URL each one loads from. One small external store,
// read by the editor (the Plugins panel), the Plugin Maker, and the AI tools.

import { useSyncExternalStore } from 'react';
import { api, fileSrc } from '../lib/ipc';
import { composePage, validatePlugin, withRevision } from './rules';
import type { Plugin, PluginAction, PluginGenerator, PluginLog } from './types';

const MAX_LOGS = 300;

type State = {
  loaded: boolean;
  plugins: Plugin[];
  /** Page URL per plugin id; changes whenever the page is rewritten, which reloads its frame. */
  pages: Record<string, string>;
  logs: Record<string, PluginLog[]>;
  actions: PluginAction[];
  /** Kinds of clip the running plugins draw (bhippi.generator), for add_plugin_clip and the Properties panel. */
  generators: PluginGenerator[];
};

let state: State = { loaded: false, plugins: [], pages: {}, logs: {}, actions: [], generators: [] };
const listeners = new Set<() => void>();

function set(change: Partial<State>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const pluginStore = {
  get: () => state,
  subscribe,
};

export function usePlugins(): State {
  return useSyncExternalStore(subscribe, pluginStore.get);
}

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Writes a plugin's page and records the URL its frame loads — the asset protocol in the app, a blob in a plain browser. */
async function publishPage(plugin: Plugin): Promise<string> {
  const html = composePage(plugin);
  let url: string;
  if (inTauri()) {
    const path = await api.pluginPageWrite(plugin.id, html);
    url = `${fileSrc(path)}?r=${plugin.revision}-${Date.now().toString(36)}`;
  } else {
    const previous = state.pages[plugin.id];
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }
  set({ pages: { ...state.pages, [plugin.id]: url } });
  return url;
}

let loading: Promise<Plugin[]> | null = null;

/**
 * Pages already stored outside the library (plugins.rs `plugins/sources/`), page → hash, so a save
 * sends only pages that are new. The library names each page and revision by its hash.
 */
const stored = new Map<string, string>();
type Stored = { htmlHash?: string };

/** Takes the hashes the loaded library carried, so the pages are not sent again. */
function remember(plugin: Plugin): Plugin {
  const { htmlHash, ...rest } = plugin as Plugin & Stored;
  if (htmlHash) stored.set(plugin.html, htmlHash);
  const revisions = rest.revisions?.map((revision) => {
    const { htmlHash: hash, ...kept } = revision as typeof revision & Stored;
    if (hash) stored.set(revision.html, hash);
    return kept;
  });
  return revisions ? { ...rest, revisions } : rest;
}

async function pageRef(html: string): Promise<string> {
  const known = stored.get(html);
  if (known) return known;
  const hash = await api.pluginSourcePut(html);
  stored.set(html, hash);
  return hash;
}

/** The library as it is written: every page stored first, then named by its hash. */
async function slimLibrary(plugins: Plugin[]): Promise<unknown[]> {
  const slim = await Promise.all(plugins.map(async ({ html, revisions, ...rest }) => ({
    ...rest,
    htmlHash: await pageRef(html),
    ...(revisions ? { revisions: await Promise.all(revisions.map(async ({ html: page, ...revision }) => ({ ...revision, htmlHash: await pageRef(page) }))) } : {}),
  })));
  // Forget pages nothing names any more, so they can be let go.
  const live = new Set(plugins.flatMap((plugin) => [plugin.html, ...(plugin.revisions ?? []).map((revision) => revision.html)]));
  for (const page of [...stored.keys()]) if (!live.has(page)) stored.delete(page);
  return slim;
}

export function loadPlugins(): Promise<Plugin[]> {
  if (state.loaded) return Promise.resolve(state.plugins);
  loading ??= (async () => {
    let plugins: Plugin[] = [];
    try {
      const saved = await api.pluginsLoad();
      plugins = Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === 'string' && typeof item.html === 'string').map(remember) : [];
    } catch {
      // Outside the app (tests, the browser harness) there is no library yet.
    }
    set({ plugins, loaded: true });
    await Promise.all(plugins.filter((plugin) => plugin.enabled).map((plugin) => publishPage(plugin).catch(() => undefined)));
    return plugins;
  })();
  return loading;
}

/** Library writes, one at a time and in order, so an older library never lands after a newer one. */
let writing: Promise<unknown> = Promise.resolve();

async function persist(plugins: Plugin[]) {
  set({ plugins });
  const write = writing.then(async () => {
    try {
      await api.pluginsSave(inTauri() ? await slimLibrary(plugins) : plugins);
    } catch (error) {
      if (inTauri()) throw error;
    }
  });
  writing = write.catch(() => undefined);
  await write;
}

export const findPlugin = (id: string) => state.plugins.find((plugin) => plugin.id === id) ?? null;

/**
 * Saves a new plugin or a change to one (the old page kept as a revision) and republishes its
 * page, so a frame showing it reloads with the change.
 */
export async function savePlugin(next: Plugin, known: ReadonlySet<string>, note = 'Edited'): Promise<Plugin> {
  await loadPlugins();
  const problem = validatePlugin(next, known);
  if (problem) throw new Error(problem);
  const previous = findPlugin(next.id);
  const stamped: Plugin = { ...next, updatedAt: new Date().toISOString() };
  const saved = previous ? withRevision(previous, stamped, note) : stamped;
  await persist(previous ? state.plugins.map((plugin) => (plugin.id === saved.id ? saved : plugin)) : [...state.plugins, saved]);
  if (saved.enabled) await publishPage(saved);
  return saved;
}

/** Changes a plugin's switches (panel, enabled, background) without touching its page. */
export async function patchPlugin(id: string, change: Partial<Pick<Plugin, 'panel' | 'enabled' | 'background' | 'permissions' | 'name' | 'description' | 'icon' | 'logo' | 'revoked'>>) {
  await loadPlugins();
  const current = findPlugin(id);
  if (!current) throw new Error(`No plugin “${id}”`);
  const revoked = change.revoked ?? current.revoked;
  if (change.enabled && revoked) throw new Error(`“${current.name}” was pulled from the marketplace (${revoked.reason}), so it cannot be turned on. Install a newer version, or delete it.`);
  const next = { ...current, ...change, updatedAt: new Date().toISOString() };
  await persist(state.plugins.map((plugin) => (plugin.id === id ? next : plugin)));
  // A change of permissions changes the page's policy; turning a plugin on needs its page.
  if (next.enabled && (change.permissions || change.enabled || !state.pages[id])) await publishPage(next);
  if (!next.enabled) dropActions(id);
  return next;
}

/** Puts back the page from before the last change. */
export async function revertPlugin(id: string, known: ReadonlySet<string>) {
  const current = findPlugin(id);
  const [last, ...older] = current?.revisions ?? [];
  if (!current || !last) throw new Error('There is no earlier version to go back to.');
  const restored: Plugin = { ...current, html: last.html, revision: current.revision + 1, revisions: older, updatedAt: new Date().toISOString() };
  if (validatePlugin(restored, known)) throw new Error(validatePlugin(restored, known)!);
  await persist(state.plugins.map((plugin) => (plugin.id === id ? restored : plugin)));
  if (restored.enabled) await publishPage(restored);
  return restored;
}

/** Removes a plugin, its page and its saved data. Only ever on the user's say-so. */
export async function removePlugin(id: string) {
  await loadPlugins();
  if (!findPlugin(id)) throw new Error(`No plugin “${id}”`);
  await persist(state.plugins.filter((plugin) => plugin.id !== id));
  dropActions(id);
  const { [id]: page, ...pages } = state.pages;
  if (page?.startsWith('blob:')) URL.revokeObjectURL(page);
  const { [id]: _logs, ...logs } = state.logs;
  void _logs;
  set({ pages, logs });
  await api.pluginFilesRemove(id).catch(() => undefined);
  // Its draft and every installed package version go with it (drafts.ts, package.ts).
  await api.pluginDraftRemove(id).catch(() => undefined);
  await api.pluginPkgRemove(id).catch(() => undefined);
}

/** Reloads a plugin's frame by giving its page a fresh URL. */
export function reloadPlugin(id: string) {
  const plugin = findPlugin(id);
  if (plugin?.enabled) void publishPage(plugin);
}

export function pushLog(id: string, level: PluginLog['level'], text: string) {
  const list = [...(state.logs[id] ?? []), { at: Date.now(), level, text }].slice(-MAX_LOGS);
  set({ logs: { ...state.logs, [id]: list } });
}

export function clearLogs(id: string) {
  set({ logs: { ...state.logs, [id]: [] } });
}

export function setAction(action: PluginAction) {
  set({ actions: [...state.actions.filter((item) => !(item.plugin === action.plugin && item.name === action.name)), action] });
}

export function setGenerator(generator: PluginGenerator) {
  set({ generators: [...state.generators.filter((item) => !(item.plugin === generator.plugin && item.name === generator.name)), generator] });
}

export const findGenerator = (plugin: string, name: string) => state.generators.find((item) => item.plugin === plugin && item.name === name);

/** A plugin's frame went away (or reloaded): what it offered goes with it until it offers again. */
export function dropActions(id: string) {
  if (state.actions.some((item) => item.plugin === id)) set({ actions: state.actions.filter((item) => item.plugin !== id) });
  if (state.generators.some((item) => item.plugin === id)) set({ generators: state.generators.filter((item) => item.plugin !== id) });
}

/** What Bhippi AI is told about the plugins on every turn. */
export function pluginsBrief() {
  return {
    installed: state.plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: plugin.enabled,
      shownAsPanel: plugin.panel,
      background: plugin.background,
    })),
    actions: state.actions.map((action) => ({ plugin: action.plugin, name: action.name, description: action.description, params: action.params ?? undefined })),
    // Placed with add_plugin_clip: a clip on the timeline the plugin draws, in the preview and the export.
    clipGenerators: state.generators.map((item) => ({ plugin: item.plugin, generator: item.name, label: item.label, description: item.description, params: item.params })),
  };
}
