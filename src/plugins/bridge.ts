// The plugin bridge: the only way a plugin's sandboxed page reaches the editor. Each frame's
// messages are matched to it by `event.source` (a sandboxed page has no origin to check), and
// every call a plugin makes is answered here:
//
//   tool       → the plugin's manifest (rules.ts), then the user's permission mode, then the
//                edit workflow (Quick edit rules: the local-generation switch still holds),
//                then runTool — the same function Bhippi AI's calls go through. Each edit is
//                one Undo step, labelled with the plugin's name. Calls run one at a time per frame.
//   project, session, comp, selection, playhead, storage, projectStorage, toast, chat, fileUrl,
//   subscribe, expose.
//
// Sessions: each saved project has a key (a hash of its file path — the path itself never reaches
// a plugin). Opening, starting or saving a project under a new file sends every frame a 'session'
// event, so a plugin can keep data per project (`bhippi.projectStorage`). That data sits in the
// plugin's own data file under PROJECTS; an unsaved project's lives in memory and moves to the file
// the first time the project is saved.
//
// The editor hands the bridge what it needs once, with `setPluginEditor`.

import { convertFileSrc } from '@tauri-apps/api/core';
import { aiContext, compDetail } from '../lib/aiTools';
import type { ToolHost } from '../lib/aiTools';
import { EditWorkflow } from '../lib/editWorkflow';
import { errorText, api } from '../lib/ipc';
import { allowTool, type PermissionMode } from '../lib/permissions';
import { playhead } from '../lib/playhead';
import type { ToolResult } from '../lib/types';
import { pluginToolRefusal } from './rules';
import { dropActions, findPlugin, pluginStore, pushLog, setAction } from './store';

export type PluginEditor = {
  /** The host AI tool calls run against (history committed synchronously). */
  host: () => ToolHost;
  runTool: (host: ToolHost, name: string, args: unknown) => Promise<ToolResult>;
  known: ReadonlySet<string>;
  toolSpecs: () => { name: string; description: string; input_schema: unknown }[];
  permission: () => PermissionMode;
  disableLocalGeneration: () => boolean;
  toast: (tone: 'info' | 'success' | 'error', title: string, body?: string) => void;
  /** Sends a message to the Bhippi AI chat. */
  chat: (message: string) => void;
  /** The open project's .bhippi file, or null while it has never been saved. */
  projectPath: () => string | null;
};

let editor: PluginEditor | null = null;
export const setPluginEditor = (next: PluginEditor) => {
  editor = next;
};

const TAG = 'bhippi-plugin';
type Subscription = 'project' | 'selection' | 'playhead' | 'theme' | 'session';

type Frame = {
  key: string;
  pluginId: string;
  window: Window;
  subscriptions: Set<Subscription>;
  /** Tool calls run in order, one at a time. */
  queue: Promise<unknown>;
  connectedAt: number;
};

const frames = new Map<string, Frame>();
const waitingActions = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
let actionSeq = 0;

/** The editor's look, as CSS variables the plugin's page takes on. */
const THEME_TOKENS = ['app', 'seam', 'panel', 'panel-2', 'panel-3', 'panel-4', 'field', 'line', 'line-strong', 'text', 'text-dim', 'text-faint', 'blue', 'blue-hi', 'blue-soft', 'accent', 'gold', 'green', 'green-soft', 'red', 'red-soft', 'amber', 'radius', 'font', 'mono'];
export function themeTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const style = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) tokens[name] = value;
  }
  return tokens;
}

const send = (frame: Frame, message: Record<string, unknown>) => {
  try {
    frame.window.postMessage({ ...message, tag: TAG }, '*');
  } catch {
    // The frame navigated away or closed; it is dropped when it disconnects.
  }
};

/** Starts talking to a plugin's frame. Returns the disconnect. */
export function connectPluginFrame(pluginId: string, target: Window): () => void {
  const key = `${pluginId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  frames.set(key, { key, pluginId, window: target, subscriptions: new Set(['theme']), queue: Promise.resolve(), connectedAt: Date.now() });
  return () => {
    frames.delete(key);
    if (![...frames.values()].some((frame) => frame.pluginId === pluginId)) dropActions(pluginId);
  };
}

type Data = Record<string, unknown>;
/** The reserved key in a plugin's data file that holds its per-project data, by session key. */
const PROJECTS = '__projects';
const isObject = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);

/** Reads and writes of one plugin's data file run one at a time, so storage and projectStorage never overwrite each other. */
const diskQueues = new Map<string, Promise<unknown>>();
function withData<T>(pluginId: string, work: (data: Data) => Promise<T> | T): Promise<T> {
  const run = (diskQueues.get(pluginId) ?? Promise.resolve()).then(async () => {
    let data: Data = {};
    try {
      const loaded = await api.pluginStorageLoad(pluginId);
      if (isObject(loaded)) data = loaded;
    } catch {
      // No saved data yet, or no app around it.
    }
    return work(data);
  });
  diskQueues.set(pluginId, run.catch(() => undefined));
  return run;
}
const projectsOf = (data: Data): Record<string, Data> => (isObject(data[PROJECTS]) ? (data[PROJECTS] as Record<string, Data>) : {});
const withoutProjects = (data: Data): Data => {
  const rest = { ...data };
  delete rest[PROJECTS];
  return rest;
};

/** A stable, private key for a project file: the same file always gives the same key. */
const keyCache = new Map<string, string>();
async function sessionKey(path: string | null): Promise<string | null> {
  if (!path) return null;
  const normal = path.replace(/\//g, '\\').toLowerCase();
  const cached = keyCache.get(normal);
  if (cached) return cached;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normal));
  const key = [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  keyCache.set(normal, key);
  return key;
}

/** The session plugins currently see; undefined until first asked. */
let activeKey: string | null | undefined;
/** Per-project data plugins keep for a project that has never been saved, by plugin id. */
const unsaved = new Map<string, Data>();

async function currentKey(): Promise<string | null> {
  if (activeKey === undefined) activeKey = await sessionKey(editor?.projectPath() ?? null);
  return activeKey;
}

type Session = { key: string | null; name: string; saved: boolean };
async function session(): Promise<Session> {
  const key = await currentKey();
  return { key, name: editor?.host().history.current().name ?? '', saved: key !== null };
}

/** This plugin's data for the open project. */
function projectSlice(pluginId: string, key: string | null): Promise<Data> {
  if (key === null) return Promise.resolve({ ...(unsaved.get(pluginId) ?? {}) });
  return withData(pluginId, (data) => ({ ...(projectsOf(data)[key] ?? {}) }));
}

async function init(frame: Frame) {
  const plugin = findPlugin(frame.pluginId);
  const [storage, info] = await Promise.all([withData(frame.pluginId, withoutProjects), session()]);
  const projectStorage = await projectSlice(frame.pluginId, info.key);
  send(frame, { type: 'init', plugin: plugin ? { id: plugin.id, name: plugin.name } : { id: frame.pluginId, name: frame.pluginId }, storage, session: info, projectStorage, theme: themeTokens() });
}

/** Why a plugin's call to a Bhippi tool is refused, or null: its manifest, the permission mode, the workflow. */
function refusal(pluginId: string, name: string, args: Record<string, unknown>): string | null {
  if (!editor) return 'The editor is not ready.';
  const plugin = findPlugin(pluginId);
  if (!plugin || !plugin.enabled) return 'This plugin is turned off.';
  const manifest = pluginToolRefusal(plugin.permissions, name, editor.known);
  if (manifest) return manifest;
  const mode = allowTool(editor.permission(), name);
  if (!mode.ok) return mode.reason.replace(/Bhippi AI/g, 'Bhippi');
  const host = editor.host();
  const workflow = new EditWorkflow(host.history.current(), host.assets(), 'quick', editor.disableLocalGeneration(), false);
  return workflow.before(name, args, host.history.current());
}

async function runPluginTool(pluginId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const plugin = findPlugin(pluginId);
  const refused = refusal(pluginId, name, args);
  if (refused) {
    pushLog(pluginId, 'call', `✕ ${name}: ${refused}`);
    return { ok: false, error: refused };
  }
  const base = editor!.host();
  const label = plugin?.name ?? pluginId;
  // The same host as an AI call, with the plugin's name on each undo step.
  const host: ToolHost = {
    ...base,
    turnId: undefined,
    history: { ...base.history, commit: (change, text) => base.history.commit(change, `${label}: ${(text ?? name).replace(/^AI( Tool)?: /, '')}`) },
    guard: (step, stepArgs) => refusal(pluginId, step, stepArgs),
  };
  let result: ToolResult;
  try {
    result = await editor!.runTool(host, name, args);
  } catch (error) {
    result = { ok: false, error: errorText(error) };
  }
  pushLog(pluginId, 'call', `${result.ok ? '✓' : '✕'} ${name}: ${String(result.ok ? result.summary ?? 'done' : result.error).split('\n')[0].slice(0, 240)}`);
  return result;
}

type Handler = (frame: Frame, params: Record<string, unknown>) => Promise<unknown> | unknown;

const HANDLERS: Record<string, Handler> = {
  project: async () => {
    const host = editor!.host();
    const context = aiContext(host.history.current(), host.assets(), host.selection());
    const key = await currentKey();
    return { ...context, project: { ...context.project, key, saved: key !== null } };
  },
  session: () => session(),
  comp: (_frame, params) => {
    const host = editor!.host();
    const project = host.history.current();
    const id = typeof params.id === 'string' ? params.id : project.activeCompId;
    const comp = project.comps.find((item) => item.id === id || item.name === id);
    if (!comp) throw new Error(`No comp “${id}”`);
    return compDetail(project, host.assets(), comp);
  },
  tool: (frame, params) => {
    const name = typeof params.name === 'string' ? params.name : '';
    const args = params.args && typeof params.args === 'object' && !Array.isArray(params.args) ? (params.args as Record<string, unknown>) : {};
    const run = frame.queue.then(() => runPluginTool(frame.pluginId, name, args));
    frame.queue = run.catch(() => undefined);
    return run.then((result) => {
      if (!result.ok) throw new Error(String(result.error));
      return result;
    });
  },
  tools: () => editor!.toolSpecs().map((spec) => ({ name: spec.name, description: spec.description, input_schema: spec.input_schema })),
  'selection.get': () => editor!.host().selection(),
  'selection.set': (_frame, params) => {
    const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === 'string') : [];
    editor!.host().setSelection(ids);
    return ids;
  },
  'playhead.get': () => playhead.get(),
  'playhead.seek': (_frame, params) => {
    const time = Number(params.time);
    if (!Number.isFinite(time) || time < 0) throw new Error('seek needs a time in seconds');
    playhead.seek(time);
    return time;
  },
  'storage.set': async (frame, params) => {
    const next = isObject(params.data) ? withoutProjects(params.data) : {};
    await withData(frame.pluginId, (data) => api.pluginStorageSave(frame.pluginId, data[PROJECTS] === undefined ? next : { ...next, [PROJECTS]: data[PROJECTS] }));
    return true;
  },
  'projectStorage.set': async (frame, params) => {
    const next = isObject(params.data) ? params.data : {};
    const key = await currentKey();
    if (key === null) {
      unsaved.set(frame.pluginId, next);
      return true;
    }
    await withData(frame.pluginId, (data) => {
      const projects = { ...projectsOf(data) };
      if (Object.keys(next).length) projects[key] = next;
      else delete projects[key];
      return api.pluginStorageSave(frame.pluginId, { ...data, [PROJECTS]: projects });
    });
    return true;
  },
  toast: (frame, params) => {
    const plugin = findPlugin(frame.pluginId);
    const tone = params.tone === 'error' || params.tone === 'success' ? params.tone : 'info';
    editor!.toast(tone, plugin?.name ?? 'Plugin', String(params.message ?? '').slice(0, 400));
    return true;
  },
  chat: (frame, params) => {
    const plugin = findPlugin(frame.pluginId);
    if (!plugin?.permissions.chat) throw new Error('This plugin has not been given the chat permission.');
    const message = String(params.message ?? '').trim();
    if (!message) throw new Error('chat needs a message');
    pushLog(frame.pluginId, 'call', `→ chat: ${message.slice(0, 160)}`);
    editor!.chat(`[From the “${plugin.name}” plugin] ${message.slice(0, 8000)}`);
    return true;
  },
  fileUrl: (_frame, params) => (typeof params.path === 'string' && params.path ? convertFileSrc(params.path) : ''),
  subscribe: (frame, params) => {
    const event = params.event as Subscription;
    if (!['project', 'selection', 'playhead', 'theme', 'session'].includes(event)) throw new Error(`There is no “${String(params.event)}” event (project, selection, playhead, theme, session).`);
    frame.subscriptions.add(event);
    return true;
  },
  expose: (frame, params) => {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(name)) throw new Error('An action name is letters, digits, - and _ (up to 48).');
    setAction({ plugin: frame.pluginId, name, description: String(params.description ?? '').slice(0, 400), params: params.params && typeof params.params === 'object' ? (params.params as Record<string, unknown>) : undefined });
    return true;
  },
};

function onMessage(event: MessageEvent) {
  const data = event.data as { tag?: string; type?: string; id?: number | string; method?: string; params?: Record<string, unknown>; level?: string; text?: string; ok?: boolean; result?: unknown; error?: string } | null;
  if (!data || data.tag !== TAG) return;
  const frame = [...frames.values()].find((item) => item.window === event.source);
  if (!frame) return;
  switch (data.type) {
    case 'hello':
      void init(frame);
      return;
    case 'log': {
      const level = (['log', 'info', 'warn', 'error'] as const).find((item) => item === data.level) ?? 'log';
      pushLog(frame.pluginId, level, String(data.text ?? '').slice(0, 4000));
      return;
    }
    case 'actionResult': {
      const waiting = waitingActions.get(String(data.id));
      if (!waiting) return;
      waitingActions.delete(String(data.id));
      window.clearTimeout(waiting.timer);
      if (data.ok) waiting.resolve(data.result);
      else waiting.reject(new Error(String(data.error ?? 'The action failed')));
      return;
    }
    case 'call': {
      const handler = HANDLERS[String(data.method)];
      const reply = (message: Record<string, unknown>) => send(frame, { type: 'reply', id: data.id, ...message });
      if (!handler || !editor) {
        reply({ ok: false, error: editor ? `bhippi has no “${String(data.method)}”` : 'The editor is not ready.' });
        return;
      }
      Promise.resolve()
        .then(() => handler(frame, data.params ?? {}))
        .then((result) => reply({ ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }))
        .catch((error) => reply({ ok: false, error: errorText(error) }));
      return;
    }
  }
}

if (typeof window !== 'undefined') window.addEventListener('message', onMessage);

/** Tells subscribed frames something changed. Project changes are coalesced to one every 250 ms. */
let projectTimer: number | null = null;
export const pluginEvents = {
  project() {
    if (projectTimer !== null || !frames.size) return;
    projectTimer = window.setTimeout(() => {
      projectTimer = null;
      for (const frame of frames.values()) if (frame.subscriptions.has('project')) send(frame, { type: 'event', event: 'project', data: null });
    }, 250);
  },
  selection(ids: string[]) {
    for (const frame of frames.values()) if (frame.subscriptions.has('selection')) send(frame, { type: 'event', event: 'selection', data: ids });
  },
  playhead(time: number) {
    for (const frame of frames.values()) if (frame.subscriptions.has('playhead')) send(frame, { type: 'event', event: 'playhead', data: time });
  },
  theme() {
    const tokens = themeTokens();
    for (const frame of frames.values()) send(frame, { type: 'event', event: 'theme', data: tokens });
  },
  /**
   * The editor calls this after opening or starting a project ('opened') and after saving
   * ('saved'), with the project's file (null for a new, unsaved one). When the project now lives
   * in a different file, every frame gets a 'session' event with its data for that project; a
   * save under a new file carries the project's data along.
   */
  async session(reason: 'opened' | 'saved', path: string | null) {
    const before = await currentKey();
    const after = await sessionKey(path);
    if (reason === 'saved' && after === before) return;
    activeKey = after;
    if (reason === 'saved' && after !== null) {
      // Save As: the project keeps its plugin data under its new file.
      const ids = new Set([...unsaved.keys(), ...pluginStore.get().plugins.map((plugin) => plugin.id)]);
      await Promise.all([...ids].map((id) => withData(id, async (data) => {
        const projects = projectsOf(data);
        const carried = before === null ? unsaved.get(id) : projects[before];
        if (!carried || !Object.keys(carried).length || projects[after]) return;
        await api.pluginStorageSave(id, { ...data, [PROJECTS]: { ...projects, [after]: carried } });
      }).catch(() => undefined)));
    }
    unsaved.clear();
    const info = await session();
    await Promise.all([...frames.values()].map(async (frame) => {
      const projectStorage = await projectSlice(frame.pluginId, info.key).catch(() => ({}));
      send(frame, { type: 'event', event: 'session', data: { ...info, projectStorage } });
    }));
  },
};

/** Whether a plugin has a frame running right now (a panel, the Plugin Maker preview, or in the background). */
export const pluginRunning = (pluginId: string) => [...frames.values()].some((frame) => frame.pluginId === pluginId);

/** Runs an action a plugin exposed, in its newest frame, for Bhippi AI. */
export function callPluginAction(pluginId: string, name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
  const frame = [...frames.values()].filter((item) => item.pluginId === pluginId).sort((a, b) => b.connectedAt - a.connectedAt)[0];
  if (!frame) return Promise.reject(new Error(`The “${pluginId}” plugin is not running. Show it as a panel (or turn on Run in background) and try again.`));
  const id = `a${++actionSeq}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waitingActions.delete(id);
      reject(new Error(`${pluginId}.${name} did not answer within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    waitingActions.set(id, { resolve, reject, timer });
    send(frame, { type: 'action', id, name, args });
  });
}
