// The plugin bridge: the only way a plugin's sandboxed page reaches the editor. Each frame's
// messages are matched to it by `event.source` (a sandboxed page has no origin to check), and
// every call a plugin makes is answered here:
//
//   tool       → the plugin's manifest (rules.ts), then the user's permission mode, then the
//                edit workflow (Quick edit rules: the local-generation switch still holds),
//                then runTool — the same function Bhippi AI's calls go through. Each edit is
//                one Undo step, labelled with the plugin's name. Calls run one at a time per frame.
//   importMedia → the same checks as the import_media tool it ends in; the file is written under
//                Generated/Plugins/<id>/ (plugins.rs) and imported with import_media.
//   project, session, comp, selection, playhead, storage, projectStorage, toast, chat, fileUrl,
//   subscribe, expose.
//   Bhippi's services (capabilities.ts, which lists them and the permission each needs):
//   transcript.*, ai.ask, playback.*, audio.*, batch, jobs.*.
//
// Sessions: each saved project has a key (a hash of its file path — the path itself never reaches
// a plugin). Opening, starting or saving a project under a new file sends every frame a 'session'
// event, so a plugin can keep data per project (`bhippi.projectStorage`). That data sits in the
// plugin's own data file under PROJECTS; an unsaved project's lives in memory and moves to the file
// the first time the project is saved.
//
// Test frames (the Plugin Maker's plugin_test / plugin_screenshot, testRunner.ts) are connected
// with `connectSandboxFrame`: the same handlers, but against a scratch editor — a copy of the
// project, its own selection, playhead, storage and log — and only tools that stay inside the
// project really run. Nothing a test frame does reaches the user's project, storage or chat, and
// the real editor's events never reach it.
//
// The editor hands the bridge what it needs once, with `setPluginEditor`.

import { convertFileSrc } from '@tauri-apps/api/core';
import { aiContext, compDetail } from '../lib/aiTools';
import type { ToolHost } from '../lib/aiTools';
import { EditWorkflow } from '../lib/editWorkflow';
import { errorText, api, fileSrc, type Transcript } from '../lib/ipc';
import { BUCKETS_PER_SECOND, loadPeaks } from '../lib/peaks';
import { allowTool, type PermissionMode } from '../lib/permissions';
import { playhead } from '../lib/playhead';
import { newClip, newComp } from '../lib/timeline';
import { wordsOnTimeline } from '../lib/subtitlesEngine';
import { toLines } from '../lib/transcriptText';
import type { Asset, Clip, Job, PluginClipSource, Project, ToolResult } from '../lib/types';
import { audioAt, prepareAudio, type AudioFrame } from './clipAudio';
import { PLUGIN_SERVICES, type PluginService } from './capabilities';
import { pluginToolRefusal } from './rules';
import { dropActions, findGenerator, findPlugin, pluginStore, pushLog, setAction, setGenerator } from './store';
import type { GeneratorParam, Plugin, PluginAction, PluginGenerator, PluginLog } from './types';

export type PluginEditor = {
  /** The host AI tool calls run against (history committed synchronously). */
  host: () => ToolHost;
  runTool: (host: ToolHost, name: string, args: unknown) => Promise<ToolResult>;
  known: ReadonlySet<string>;
  toolSpecs: () => { name: string; description: string; input_schema: unknown }[];
  permission: () => PermissionMode;
  disableLocalGeneration: () => boolean;
  toast: (tone: 'info' | 'success' | 'error', title: string, body?: string) => void;
  /**
   * Offers the user a message for the Bhippi AI chat, from the named plugin. The user sends it or
   * not: nothing a plugin writes reaches the assistant without a click.
   */
  chat: (message: string, pluginName: string) => void;
  /** The open project's .bhippi file, or null while it has never been saved. */
  projectPath: () => string | null;
  /** The model Bhippi AI answers with (Settings / the chat's picker), for bhippi.ai.ask. */
  ai: () => { providerId: string | null; model: string | null };
  /** Shows (or updates) a plugin's job in the editor's job list. */
  job: (job: Job) => void;
};

let editor: PluginEditor | null = null;
export const setPluginEditor = (next: PluginEditor) => {
  editor = next;
};
/** The live editor the bridge serves, for the test runner to copy from. */
export const pluginEditor = () => editor;

const TAG = 'bhippi-plugin';
type Subscription = 'project' | 'selection' | 'playhead' | 'playback' | 'theme' | 'session' | 'export';
const SUBSCRIPTIONS: Subscription[] = ['project', 'selection', 'playhead', 'playback', 'theme', 'session', 'export'];
/** The largest file a plugin may hand the project with bhippi.importMedia. */
export const MAX_PLUGIN_MEDIA_BYTES = 512 * 1024 * 1024;
type Data = Record<string, unknown>;

/** A test frame's world (testRunner.ts): everything it touches is its own. */
export type Sandbox = {
  editor: PluginEditor;
  plugin: Plugin;
  /** Why a tool is not really run during a test, or null to run it (on the scratch project). */
  skip: (name: string) => string | null;
  logs: PluginLog[];
  storage: Data;
  projectStorage: Data;
  playhead: number;
  actions: PluginAction[];
  calls: { name: string; ok: boolean; skipped?: boolean; error?: string }[];
  /** Clip generators the page registered (bhippi.generator). */
  generators: PluginGenerator[];
  /** Replies to the runner's requests (runChecks, snapshot), by id. */
  waiting: Map<string, (message: Record<string, unknown>) => void>;
  hello: () => void;
};

type Frame = {
  key: string;
  pluginId: string;
  window: Window;
  subscriptions: Set<Subscription>;
  /** Tool calls run in order, one at a time. */
  queue: Promise<unknown>;
  connectedAt: number;
  sandbox?: Sandbox;
  /** When each rate-limited call was made, newest last, per kind. */
  recent: Partial<Record<Limited, number[]>>;
  /** Jobs this frame started that have not ended, by id. */
  jobs: Map<string, Job>;
  /** Menu entries this frame offers (bhippi.menu.add), by id. */
  menus: Map<string, { id: string; label: string; where: PluginMenuPlace[] }>;
  /** Clip generators this page draws (bhippi.generator), by name. */
  generators: Set<string>;
  /** 'render': a hidden copy kept to draw the plugin's clips (generators.ts), not a panel. */
  role: PluginRole;
};

/** What a plugin page is for: a panel (or background work), or drawing clips. */
export type PluginRole = 'panel' | 'render';

/** The context menus a plugin can add entries to. */
export type PluginMenuPlace = 'clip' | 'timeline' | 'media';
const MENU_PLACES: PluginMenuPlace[] = ['clip', 'timeline', 'media'];

/** How often a plugin may do things that cost the user something, per minute. */
export const PLUGIN_RATE_LIMITS = { tool: 120, toast: 20, chat: 6, ai: 20 } as const;
type Limited = keyof typeof PLUGIN_RATE_LIMITS;

/** Records one `kind` call, or throws when the frame is over its limit for the last minute. */
function spend(frame: Frame, kind: Limited, now = Date.now()) {
  const recent = (frame.recent[kind] ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= PLUGIN_RATE_LIMITS[kind]) {
    frame.recent[kind] = recent;
    const what = { tool: 'tool calls', toast: 'notifications', chat: 'chat suggestions', ai: 'AI questions' }[kind];
    throw new Error(`Slow down: a plugin may make ${PLUGIN_RATE_LIMITS[kind]} ${what} a minute.`);
  }
  frame.recent[kind] = [...recent, now];
}

const normalPath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Whether a plugin may show `path`: a file of the open project's media, or anything inside the
 * project's own folder. Any other path on the disk is refused.
 */
export function fileAllowed(path: string, assetPaths: Iterable<string>, projectFile: string | null): boolean {
  const wanted = normalPath(path);
  if (!wanted || wanted.split('/').includes('..')) return false;
  for (const asset of assetPaths) if (asset && normalPath(asset) === wanted) return true;
  if (!projectFile) return false;
  const folder = normalPath(projectFile).replace(/\/[^/]*$/, '');
  return !!folder && wanted.startsWith(`${folder}/`);
}

const frames = new Map<string, Frame>();
const liveFrames = () => [...frames.values()].filter((frame) => !frame.sandbox);
const waitingActions = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
let actionSeq = 0;

const editorFor = (frame: Frame): PluginEditor | null => frame.sandbox?.editor ?? editor;
const pluginFor = (frame: Frame): Plugin | null => frame.sandbox?.plugin ?? findPlugin(frame.pluginId);
function log(frame: Frame, level: PluginLog['level'], text: string) {
  if (frame.sandbox) frame.sandbox.logs.push({ at: Date.now(), level, text });
  else pushLog(frame.pluginId, level, text);
}

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
export function connectPluginFrame(pluginId: string, target: Window, role: PluginRole = 'panel'): () => void {
  const key = `${pluginId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  frames.set(key, { key, pluginId, window: target, subscriptions: new Set(['theme']), queue: Promise.resolve(), connectedAt: Date.now(), recent: {}, jobs: new Map(), menus: new Map(), generators: new Set(), role });
  return () => {
    const frame = frames.get(key);
    // A job cannot outlive the page doing it.
    if (frame) for (const job of frame.jobs.values()) editor?.job({ ...job, status: 'error', message: 'The plugin closed before it finished', cancellable: false });
    frames.delete(key);
    if (!liveFrames().some((frame) => frame.pluginId === pluginId)) dropActions(pluginId);
  };
}

/**
 * Connects a test frame to its sandbox. `request` asks the page for its acceptance checks or a
 * snapshot and resolves with the page's answer.
 */
export function connectSandboxFrame(target: Window, sandbox: Sandbox) {
  const key = `test:${sandbox.plugin.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const frame: Frame = { key, pluginId: sandbox.plugin.id, window: target, subscriptions: new Set(['theme']), queue: Promise.resolve(), connectedAt: Date.now(), sandbox, recent: {}, jobs: new Map(), menus: new Map(), generators: new Set(), role: 'panel' };
  frames.set(key, frame);
  let seq = 0;
  return {
    request(type: 'runChecks' | 'snapshot', timeoutMs: number): Promise<Record<string, unknown>> {
      const id = `r${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          sandbox.waiting.delete(id);
          reject(new Error(`the plugin did not answer ${type} within ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        sandbox.waiting.set(id, (message) => {
          window.clearTimeout(timer);
          sandbox.waiting.delete(id);
          resolve(message);
        });
        send(frame, { type, id });
      });
    },
    /** One frame of a generator the test page registered (plugin_test draws each once). */
    render: (generator: string, info: RenderInfo) => requestRender(frame, generator, info, sandbox.plugin.name),
    disconnect: () => frames.delete(key),
  };
}

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
async function session(frame?: Frame): Promise<Session> {
  if (frame?.sandbox) return { key: null, name: frame.sandbox.editor.host().history.current().name ?? '', saved: false };
  const key = await currentKey();
  return { key, name: editor?.host().history.current().name ?? '', saved: key !== null };
}

/** This plugin's data for the open project. */
function projectSlice(pluginId: string, key: string | null): Promise<Data> {
  if (key === null) return Promise.resolve({ ...(unsaved.get(pluginId) ?? {}) });
  return withData(pluginId, (data) => ({ ...(projectsOf(data)[key] ?? {}) }));
}

async function init(frame: Frame) {
  const plugin = pluginFor(frame);
  const identity = plugin ? { id: plugin.id, name: plugin.name } : { id: frame.pluginId, name: frame.pluginId };
  if (frame.sandbox) {
    const { storage, projectStorage } = frame.sandbox;
    send(frame, { type: 'init', plugin: identity, storage: { ...storage }, session: await session(frame), projectStorage: { ...projectStorage }, theme: themeTokens(), testing: true, role: frame.role });
    return;
  }
  const [storage, info] = await Promise.all([withData(frame.pluginId, withoutProjects), session()]);
  const projectStorage = await projectSlice(frame.pluginId, info.key);
  send(frame, { type: 'init', plugin: identity, storage, session: info, projectStorage, theme: themeTokens(), role: frame.role });
}

/** Why a plugin's call to a Bhippi tool is refused, or null: its manifest, the permission mode, the workflow. */
function refusal(frame: Frame, name: string, args: Record<string, unknown>): string | null {
  const current = editorFor(frame);
  if (!current) return 'The editor is not ready.';
  const plugin = pluginFor(frame);
  if (!plugin || (!frame.sandbox && !plugin.enabled)) return 'This plugin is turned off.';
  const manifest = pluginToolRefusal(plugin.permissions, name, current.known);
  if (manifest) return manifest;
  const mode = allowTool(current.permission(), name);
  if (!mode.ok) return mode.reason.replace(/Bhippi AI/g, 'Bhippi');
  const host = current.host();
  const workflow = new EditWorkflow(host.history.current(), host.assets(), 'quick', current.disableLocalGeneration(), false);
  return workflow.before(name, args, host.history.current());
}

async function runPluginTool(frame: Frame, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const plugin = pluginFor(frame);
  const refused = refusal(frame, name, args);
  if (refused) {
    log(frame, 'call', `✕ ${name}: ${refused}`);
    frame.sandbox?.calls.push({ name, ok: false, error: refused });
    return { ok: false, error: refused };
  }
  const skipped = frame.sandbox?.skip(name);
  if (frame.sandbox && skipped) {
    log(frame, 'call', `⏭ ${name}: ${skipped}`);
    frame.sandbox.calls.push({ name, ok: false, skipped: true, error: skipped });
    return { ok: false, error: skipped };
  }
  const current = editorFor(frame)!;
  const base = current.host();
  const label = plugin?.name ?? frame.pluginId;
  // The same host as an AI call, with the plugin's name on each undo step.
  const host: ToolHost = {
    ...base,
    turnId: undefined,
    history: { ...base.history, commit: (change, text) => base.history.commit(change, `${label}: ${(text ?? name).replace(/^AI( Tool)?: /, '')}`) },
    guard: (step, stepArgs) => refusal(frame, step, stepArgs) ?? frame.sandbox?.skip(step) ?? null,
  };
  const before = base.history.current();
  let result: ToolResult;
  try {
    result = await current.runTool(host, name, args);
  } catch (error) {
    result = { ok: false, error: errorText(error) };
  }
  log(frame, 'call', `${result.ok ? '✓' : '✕'} ${name}: ${String(result.ok ? result.summary ?? 'done' : result.error).split('\n')[0].slice(0, 240)}`);
  if (frame.sandbox) {
    frame.sandbox.calls.push({ name, ok: result.ok, ...(result.ok ? {} : { error: String(result.error) }) });
    // The scratch project changed: tell the test frame, as the editor tells a live one.
    if (base.history.current() !== before && frame.subscriptions.has('project')) send(frame, { type: 'event', event: 'project', data: null });
  }
  return result;
}

type Handler = (frame: Frame, params: Record<string, unknown>) => Promise<unknown> | unknown;

/** A handler's answer that carries bytes: handed to the page as it is, not through JSON. */
class Binary {
  constructor(readonly value: Record<string, unknown>) {}
}

const GENERATOR_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

/** A generator's settings, kept to the kinds the Properties panel can edit. */
export function generatorParams(raw: unknown): Record<string, GeneratorParam> {
  const out: Record<string, GeneratorParam> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key) || !value || typeof value !== 'object') continue;
    const spec = value as Record<string, unknown>;
    const label = typeof spec.label === 'string' ? spec.label.slice(0, 60) : undefined;
    const number = (field: string) => (typeof spec[field] === 'number' && Number.isFinite(spec[field]) ? (spec[field] as number) : undefined);
    switch (spec.type) {
      case 'number': out[key] = { type: 'number', label, default: number('default'), min: number('min'), max: number('max'), step: number('step') }; break;
      case 'color': out[key] = { type: 'color', label, default: typeof spec.default === 'string' ? spec.default : undefined }; break;
      case 'boolean': out[key] = { type: 'boolean', label, default: typeof spec.default === 'boolean' ? spec.default : undefined }; break;
      case 'select': {
        const options = Array.isArray(spec.options) ? spec.options.filter((item): item is string => typeof item === 'string').slice(0, 40) : [];
        if (options.length) out[key] = { type: 'select', label, options, default: typeof spec.default === 'string' && options.includes(spec.default) ? spec.default : options[0] };
        break;
      }
      case 'text': out[key] = { type: 'text', label, default: typeof spec.default === 'string' ? spec.default.slice(0, 400) : undefined }; break;
    }
  }
  return out;
}

/** A clip's settings over its generator's defaults. */
export function withDefaults(params: Record<string, unknown>, spec: Record<string, GeneratorParam> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec ?? {})) if (value.default !== undefined) out[key] = value.default;
  return { ...out, ...params };
}

/** Why this frame's plugin may not use `service`, or null. */
function serviceRefusal(frame: Frame, service: PluginService): string | null {
  const plugin = pluginFor(frame);
  if (!plugin || (!frame.sandbox && !plugin.enabled)) return 'This plugin is turned off.';
  if (plugin.permissions.services?.includes(service)) return null;
  return `This plugin has not been given the “${service}” service (${PLUGIN_SERVICES[service].label}). Add it to permissions.services.`;
}
function needService(frame: Frame, service: PluginService) {
  const refused = serviceRefusal(frame, service);
  if (refused) {
    log(frame, 'call', `✕ ${service}: ${refused}`);
    frame.sandbox?.calls.push({ name: service, ok: false, error: refused });
    throw new Error(refused);
  }
}
/** Work a test run never does: it costs the user, or reaches outside the scratch project. */
function notDuringTest(frame: Frame, what: string) {
  if (!frame.sandbox) return;
  const reason = `[test] ${what} does not run during a plugin test (bhippi.testing is true); it will for the user.`;
  log(frame, 'call', `⏭ ${reason}`);
  frame.sandbox.calls.push({ name: what, ok: false, skipped: true, error: reason });
  throw new Error(reason);
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Transcripts for `assetIds`: the ones Bhippi has, and with `transcribe` the rest made first. */
async function transcriptsFor(frame: Frame, assetIds: string[], transcribe: boolean): Promise<{ found: Map<string, Transcript>; missing: string[] }> {
  const ids = [...new Set(assetIds)];
  const cached = ids.length ? await api.transcriptsCached(ids).catch(() => [] as Transcript[]) : [];
  const found = new Map(cached.map((transcript) => [transcript.assetId, transcript]));
  const missing = ids.filter((id) => !found.has(id));
  if (!transcribe || !missing.length) return { found, missing };
  needService(frame, 'transcribe');
  notDuringTest(frame, 'Transcribing');
  for (const id of missing) {
    log(frame, 'call', `→ transcribing ${id}`);
    found.set(id, await api.transcribeAsset(id, 'auto'));
  }
  return { found, missing: [] };
}

function findClip(project: Project, clipId: string): Clip | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((item) => item.id === clipId);
    if (clip) return clip;
  }
  return null;
}

/** The text of a model's answer as JSON: bare, fenced, or the first object/array in it. */
export function answerJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        // Falls through to the error below.
      }
    }
    throw new Error('The model did not answer with JSON');
  }
}

/** The largest media file a plugin may read whole with bhippi.media.read. */
export const MAX_PLUGIN_READ_BYTES = 256 * 1024 * 1024;

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('the frame could not be read'));
  reader.readAsDataURL(blob);
});

/**
 * A picture of `compId` at `time` as the export draws it (motion graphics and HTML cards
 * included), `shortSide` pixels on its short side, as a PNG data URL.
 */
async function renderFrame(project: Project, compId: string, time: number, shortSide: number, assets: Iterable<Asset>): Promise<string> {
  // Loaded on first use: the renderers are big, and most plugins never ask for a frame.
  const [{ renderHtmlStill }, { renderMotionStill }] = await Promise.all([import('../lib/htmlFrames'), import('../motion/exportFrames')]);
  const dir = await api.mogrtFramesBegin('plugin');
  const prepared = await renderHtmlStill(await renderMotionStill(project, compId, [time], [...assets]), compId, [time]);
  const path = await api.exportFrame(prepared, compId, time, `${dir}/frame-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`, shortSide);
  const response = await fetch(fileSrc(path));
  if (!response.ok) throw new Error('The rendered frame could not be read');
  return dataUrl(await response.blob());
}

let jobSeq = 0;
const playbackState = (frame: Frame) => (frame.sandbox ? { playing: false, rate: 1, time: frame.sandbox.playhead } : { playing: playhead.isPlaying(), rate: playhead.rate(), time: playhead.get() });

const HANDLERS: Record<string, Handler> = {
  project: async (frame) => {
    const host = editorFor(frame)!.host();
    const context = aiContext(host.history.current(), host.assets(), host.selection());
    const key = frame.sandbox ? null : await currentKey();
    return { ...context, project: { ...context.project, key, saved: key !== null } };
  },
  session: (frame) => session(frame),
  comp: (frame, params) => {
    const host = editorFor(frame)!.host();
    const project = host.history.current();
    const id = typeof params.id === 'string' ? params.id : project.activeCompId;
    const comp = project.comps.find((item) => item.id === id || item.name === id);
    if (!comp) throw new Error(`No comp “${id}”`);
    return compDetail(project, host.assets(), comp);
  },
  tool: (frame, params) => {
    spend(frame, 'tool');
    const name = typeof params.name === 'string' ? params.name : '';
    const args = params.args && typeof params.args === 'object' && !Array.isArray(params.args) ? (params.args as Record<string, unknown>) : {};
    const run = frame.queue.then(() => runPluginTool(frame, name, args));
    frame.queue = run.catch(() => undefined);
    return run.then((result) => {
      if (!result.ok) throw new Error(String(result.error));
      return result;
    });
  },
  importMedia: (frame, params) => {
    spend(frame, 'tool');
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    const bytes = params.bytes instanceof ArrayBuffer ? new Uint8Array(params.bytes) : null;
    if (!bytes?.length) throw new Error('importMedia needs the file: a Blob, ArrayBuffer, typed array, canvas or data: URL');
    if (bytes.length > MAX_PLUGIN_MEDIA_BYTES) throw new Error(`importMedia takes files up to ${MAX_PLUGIN_MEDIA_BYTES / 1024 / 1024} MB`);
    const run = frame.queue.then(async () => {
      // Asked before anything is written: the manifest, then the user's permission mode.
      const current = editorFor(frame)!;
      const plugin = pluginFor(frame);
      const refused = !plugin ? 'This plugin is turned off.' : pluginToolRefusal(plugin.permissions, 'import_media', current.known) ?? (() => {
        const mode = allowTool(current.permission(), 'import_media');
        return mode.ok ? null : mode.reason.replace(/Bhippi AI/g, 'Bhippi');
      })();
      const skipped = frame.sandbox?.skip('import_media');
      if (refused || skipped) {
        log(frame, 'call', `${refused ? '✕' : '⏭'} importMedia ${name}: ${refused ?? skipped}`);
        frame.sandbox?.calls.push({ name: 'import_media', ok: false, ...(refused ? {} : { skipped: true }), error: (refused ?? skipped)! });
        throw new Error((refused ?? skipped)!);
      }
      const path = await api.pluginMediaSave(frame.pluginId, name, bytes);
      const result = await runPluginTool(frame, 'import_media', { paths: [path] });
      if (!result.ok) throw new Error(String(result.error));
      return result;
    });
    frame.queue = run.catch(() => undefined);
    return run;
  },
  tools: (frame) => editorFor(frame)!.toolSpecs().map((spec) => ({ name: spec.name, description: spec.description, input_schema: spec.input_schema })),
  'selection.get': (frame) => editorFor(frame)!.host().selection(),
  'selection.set': (frame, params) => {
    const ids = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === 'string') : [];
    editorFor(frame)!.host().setSelection(ids);
    return ids;
  },
  'playhead.get': (frame) => (frame.sandbox ? frame.sandbox.playhead : playhead.get()),
  'playhead.seek': (frame, params) => {
    const time = Number(params.time);
    if (!Number.isFinite(time) || time < 0) throw new Error('seek needs a time in seconds');
    if (frame.sandbox) frame.sandbox.playhead = time;
    else playhead.seek(time);
    return time;
  },
  'storage.set': async (frame, params) => {
    const next = isObject(params.data) ? withoutProjects(params.data) : {};
    if (frame.sandbox) {
      frame.sandbox.storage = next;
      return true;
    }
    await withData(frame.pluginId, (data) => api.pluginStorageSave(frame.pluginId, data[PROJECTS] === undefined ? next : { ...next, [PROJECTS]: data[PROJECTS] }));
    return true;
  },
  'projectStorage.set': async (frame, params) => {
    const next = isObject(params.data) ? params.data : {};
    if (frame.sandbox) {
      frame.sandbox.projectStorage = next;
      return true;
    }
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
    spend(frame, 'toast');
    const plugin = pluginFor(frame);
    const tone = params.tone === 'error' || params.tone === 'success' ? params.tone : 'info';
    const message = String(params.message ?? '').slice(0, 400);
    if (frame.sandbox) log(frame, 'info', `toast (${tone}): ${message}`);
    else editorFor(frame)!.toast(tone, plugin?.name ?? 'Plugin', message);
    return true;
  },
  chat: (frame, params) => {
    const plugin = pluginFor(frame);
    if (!plugin?.permissions.chat) throw new Error('This plugin has not been given the chat permission.');
    const message = String(params.message ?? '').trim();
    if (!message) throw new Error('chat needs a message');
    spend(frame, 'chat');
    log(frame, 'call', `→ chat suggestion${frame.sandbox ? ' (not shown during a test)' : ''}: ${message.slice(0, 160)}`);
    // Offered to the user, never sent on the plugin's word.
    if (!frame.sandbox) editorFor(frame)!.chat(`[From the “${plugin.name}” plugin] ${message.slice(0, 8000)}`, plugin.name);
    return true;
  },
  fileUrl: (frame, params) => {
    const path = typeof params.path === 'string' ? params.path : '';
    if (!path) return '';
    const current = editorFor(frame)!;
    const assets = [...current.host().assets().values()].map((asset) => asset.path);
    if (!fileAllowed(path, assets, current.projectPath())) throw new Error("fileUrl only shows the project's own media and files in its folder.");
    return convertFileSrc(path);
  },
  'transcript.get': async (frame, params) => {
    const host = editorFor(frame)!.host();
    const project = host.history.current();
    const clipId = typeof params.clipId === 'string' ? params.clipId : '';
    const clip = clipId ? findClip(project, clipId) : null;
    if (clipId && !clip) throw new Error(`No clip “${clipId}”`);
    const assetId = clip ? (clip.source.type === 'media' ? clip.source.assetId : null) : typeof params.assetId === 'string' ? params.assetId : null;
    if (!assetId) throw new Error(clip ? 'That clip is not media (text, graphics and comps have no speech).' : 'transcript.get needs a clipId or an assetId');
    if (!host.assets().has(assetId)) throw new Error(`No media “${assetId}” in the project`);
    const { found } = await transcriptsFor(frame, [assetId], params.transcribe === true);
    const transcript = found.get(assetId);
    if (!transcript) return { assetId, clipId: clip?.id ?? null, cached: false, language: null, text: '', words: [] };
    let words = transcript.words.map((word) => ({ text: word.text, start: word.start, end: word.end, sourceStart: word.start, sourceEnd: word.end, ...(word.speaker !== undefined ? { speaker: word.speaker } : {}) }));
    if (clip) {
      const speed = clip.speed || 1;
      const from = clip.in;
      const to = clip.in + clip.duration * speed;
      words = words
        .filter((word) => (word.sourceStart + word.sourceEnd) / 2 >= from && (word.sourceStart + word.sourceEnd) / 2 < to)
        .map((word) => ({ ...word, start: clip.start + (word.sourceStart - from) / speed, end: clip.start + (word.sourceEnd - from) / speed }));
    }
    return { assetId, clipId: clip?.id ?? null, cached: true, language: transcript.language, text: words.map((word) => word.text).join(' '), words };
  },
  'transcript.comp': async (frame, params) => {
    const host = editorFor(frame)!.host();
    const project = host.history.current();
    const id = typeof params.compId === 'string' && params.compId ? params.compId : project.activeCompId;
    const comp = project.comps.find((item) => item.id === id || item.name === id);
    if (!comp) throw new Error(`No comp “${String(id)}”`);
    const assets = host.assets();
    const speaking = comp.clips.flatMap((clip) => (clip.enabled && clip.source.type === 'media' && assets.get(clip.source.assetId)?.hasAudio ? [clip.source.assetId] : []));
    const { found, missing } = await transcriptsFor(frame, speaking, params.transcribe === true);
    const words = wordsOnTimeline(comp, assets, new Map([...found].map(([assetId, transcript]) => [assetId, transcript.words]))).map((word) => ({ text: word.word, start: word.start, end: word.end }));
    words.sort((a, b) => a.start - b.start);
    return { compId: comp.id, words, lines: toLines(words), text: words.map((word) => word.text).join(' '), missing };
  },
  'ai.ask': async (frame, params) => {
    needService(frame, 'ai');
    notDuringTest(frame, 'Asking the AI model');
    spend(frame, 'ai');
    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) throw new Error('ai.ask needs a prompt');
    const json = params.json === true || (!!params.json && typeof params.json === 'object');
    let system = String(params.system ?? '');
    if (json) {
      system = `${system}\n\nAnswer with JSON only: no prose, no code fences.${typeof params.json === 'object' ? ` It must match this JSON schema:\n${JSON.stringify(params.json)}` : ''}`.trim();
    }
    const maxTokens = finite(params.maxTokens);
    const target = editorFor(frame)!.ai();
    log(frame, 'call', `→ ai.ask (${prompt.length} characters${json ? ', JSON' : ''})`);
    const reply = await api.pluginAsk({ providerId: target.providerId, model: target.model, system, prompt, ...(maxTokens ? { maxTokens: Math.round(maxTokens) } : {}) });
    return { text: reply.text, json: json ? answerJson(reply.text) : null, provider: reply.provider, model: reply.model, usage: { input: reply.inputTokens, output: reply.outputTokens } };
  },
  'playback.state': (frame) => playbackState(frame),
  'playback.play': (frame, params) => {
    const from = finite(params.from);
    const rate = finite(params.rate) ?? 1;
    if (rate === 0 || Math.abs(rate) > 8) throw new Error('rate is between -8 and 8, and not 0');
    if (frame.sandbox) {
      if (from !== null) frame.sandbox.playhead = Math.max(0, from);
      return playbackState(frame);
    }
    if (from !== null) playhead.set(Math.max(0, from));
    playhead.setPlaying(true, rate);
    return playbackState(frame);
  },
  'playback.pause': (frame) => {
    if (!frame.sandbox) playhead.setPlaying(false);
    return playbackState(frame);
  },
  'playback.toggle': (frame) => {
    if (!frame.sandbox) playhead.setPlaying(!playhead.isPlaying());
    return playbackState(frame);
  },
  'audio.peaks': async (frame, params) => {
    const asset = editorFor(frame)!.host().assets().get(String(params.assetId ?? ''));
    if (!asset) throw new Error(`No media “${String(params.assetId)}” in the project`);
    if (!asset.hasAudio || !asset.peaks) throw new Error(`“${asset.name}” has no sound to measure${asset.hasAudio ? ' yet (its waveform is still being made)' : ''}`);
    const peaks = await loadPeaks(asset.peaks);
    if (!peaks) throw new Error(`The waveform of “${asset.name}” could not be read`);
    const first = Math.max(0, Math.floor((finite(params.from) ?? 0) * BUCKETS_PER_SECOND));
    const last = Math.min(peaks.buckets, Math.ceil((finite(params.to) ?? peaks.buckets / BUCKETS_PER_SECOND) * BUCKETS_PER_SECOND));
    const peak: number[] = [];
    const rms: number[] = [];
    for (let bucket = first; bucket < last; bucket++) {
      peak.push(Math.round((peaks.data[bucket * 2] / 255) * 1000) / 1000);
      rms.push(Math.round((peaks.data[bucket * 2 + 1] / 255) * 1000) / 1000);
    }
    return { perSecond: BUCKETS_PER_SECOND, from: first / BUCKETS_PER_SECOND, peak, rms };
  },
  'audio.loudness': async (frame, params) => {
    const asset = editorFor(frame)!.host().assets().get(String(params.assetId ?? ''));
    if (!asset) throw new Error(`No media “${String(params.assetId)}” in the project`);
    if (!asset.hasAudio) throw new Error(`“${asset.name}” has no sound`);
    const from = Math.max(0, finite(params.from) ?? 0);
    const to = Math.min(asset.duration, finite(params.to) ?? asset.duration);
    return api.audioLoudness(asset.id, from, to);
  },
  'video.frame': async (frame, params) => {
    spend(frame, 'tool');
    const host = editorFor(frame)!.host();
    const assets = host.assets();
    let project = host.history.current();
    let compId: string;
    let time = Math.max(0, finite(params.time) ?? (frame.sandbox ? frame.sandbox.playhead : playhead.get()));
    const shortSide = Math.round(Math.max(64, Math.min(2160, finite(params.size) ?? 540)));
    if (typeof params.assetId === 'string' && params.assetId) {
      // One file's own picture: a throwaway comp holding just it, never committed.
      const asset = assets.get(params.assetId);
      if (!asset) throw new Error(`No media “${params.assetId}” in the project`);
      if (asset.kind === 'audio') throw new Error(`“${asset.name}” is sound only`);
      const comp = newComp({ name: 'Plugin frame', width: asset.width || 1920, height: asset.height || 1080 });
      const at = Math.min(time, Math.max(0, asset.duration - 1 / comp.fps));
      comp.clips = [newClip({ trackId: comp.tracks[0].id, start: 0, duration: 1, in: asset.kind === 'image' ? 0 : at, source: { type: 'media', assetId: asset.id } })];
      project = { ...project, comps: [...project.comps, comp] };
      compId = comp.id;
      time = 0;
    } else {
      const wanted = typeof params.compId === 'string' && params.compId ? params.compId : project.activeCompId;
      const comp = project.comps.find((item) => item.id === wanted || item.name === wanted);
      if (!comp) throw new Error(`No comp “${String(wanted)}”`);
      compId = comp.id;
    }
    const image = await renderFrame(project, compId, time, shortSide, assets.values());
    return { image, time, compId: typeof params.assetId === 'string' ? null : compId };
  },
  'media.read': async (frame, params) => {
    const asset = editorFor(frame)!.host().assets().get(String(params.assetId ?? ''));
    if (!asset) throw new Error(`No media “${String(params.assetId)}” in the project`);
    const response = await fetch(fileSrc(asset.path));
    if (!response.ok) throw new Error(`“${asset.name}” could not be read (is it offline?)`);
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > MAX_PLUGIN_READ_BYTES) throw new Error(`“${asset.name}” is ${Math.round(size / 1024 / 1024)} MB; a plugin may read files up to ${MAX_PLUGIN_READ_BYTES / 1024 / 1024} MB whole`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_PLUGIN_READ_BYTES) throw new Error(`“${asset.name}” is too big to read whole`);
    return new Binary({ name: asset.name, kind: asset.kind, bytes });
  },
  'generator.register': (frame, params) => {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!GENERATOR_NAME.test(name)) throw new Error('A generator name is letters, digits, - and _ (up to 48).');
    const plugin = pluginFor(frame);
    const generator: PluginGenerator = {
      plugin: frame.pluginId,
      name,
      label: String(params.label ?? '').trim().slice(0, 60) || name,
      description: String(params.description ?? '').trim().slice(0, 400),
      params: generatorParams(params.params),
    };
    frame.generators.add(name);
    if (frame.sandbox) frame.sandbox.generators = [...frame.sandbox.generators.filter((item) => item.name !== name), generator];
    else if (plugin?.enabled) setGenerator(generator);
    return true;
  },
  'audio.analyze': async (frame, params) => {
    const host = editorFor(frame)!.host();
    const project = host.history.current();
    const wanted = typeof params.compId === 'string' && params.compId ? params.compId : project.activeCompId;
    const comp = project.comps.find((item) => item.id === wanted || item.name === wanted);
    if (!comp) throw new Error(`No comp “${String(wanted)}”`);
    const fps = Math.max(1, Math.min(120, finite(params.fps) ?? 30));
    const from = Math.max(0, finite(params.from) ?? 0);
    const to = Math.max(from, finite(params.to) ?? from + 1 / fps);
    const count = Math.ceil((to - from) * fps);
    if (count > 36_000) throw new Error('audio.analyze returns at most 36,000 frames a call: ask for a shorter range or a lower fps');
    const bands = finite(params.bands) ?? 32;
    const assets = host.assets();
    await prepareAudio(project, comp.id, assets);
    const out: AudioFrame[] = [];
    for (let index = 0; index < count; index++) out.push(audioAt(project, comp.id, from + index / fps, assets, bands));
    return { compId: comp.id, fps, from, frames: out };
  },
  'plugins.list': () => {
    const { plugins, actions, generators } = pluginStore.get();
    const running = new Set(liveFrames().map((item) => item.pluginId));
    return plugins.filter((plugin) => plugin.enabled && running.has(plugin.id)).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      actions: actions.filter((action) => action.plugin === plugin.id).map((action) => ({ name: action.name, description: action.description, params: action.params ?? null })),
      generators: generators.filter((item) => item.plugin === plugin.id).map((item) => ({ name: item.name, label: item.label })),
    }));
  },
  'plugins.call': async (frame, params) => {
    needService(frame, 'plugins');
    notDuringTest(frame, 'Calling another plugin');
    spend(frame, 'tool');
    const target = typeof params.plugin === 'string' ? params.plugin : '';
    const action = typeof params.action === 'string' ? params.action : '';
    if (!target || !action) throw new Error('plugins.call needs a plugin id and an action name');
    const other = findPlugin(target);
    if (!other?.enabled) throw new Error(`No running plugin “${target}”`);
    const args = params.args && typeof params.args === 'object' && !Array.isArray(params.args) ? (params.args as Record<string, unknown>) : {};
    log(frame, 'call', `→ ${target}.${action}`);
    return { result: await callPluginAction(target, action, args) };
  },
  'menu.add': (frame, params) => {
    const id = typeof params.id === 'string' ? params.id.trim() : '';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(id)) throw new Error('A menu entry id is letters, digits, - and _ (up to 48).');
    const label = String(params.label ?? '').trim().slice(0, 60);
    if (!label) throw new Error('A menu entry needs a label');
    const wanted = Array.isArray(params.where) ? params.where : [params.where];
    const where = MENU_PLACES.filter((place) => wanted.includes(place));
    if (!where.length) throw new Error(`where is one or more of ${MENU_PLACES.join(', ')}`);
    if (!frame.menus.has(id) && frame.menus.size >= 12) throw new Error('A plugin may offer at most 12 menu entries');
    frame.menus.set(id, { id, label, where });
    return true;
  },
  'menu.remove': (frame, params) => {
    frame.menus.delete(String(params.id ?? ''));
    return true;
  },
  batch: (frame, params) => {
    const steps: unknown[] = Array.isArray(params.steps) ? params.steps : [];
    if (!steps.length) throw new Error('batch needs steps: [{ tool, args }, …]');
    if (steps.length > 100) throw new Error('A batch runs at most 100 steps');
    const plugin = pluginFor(frame);
    const label = `${plugin?.name ?? frame.pluginId}: ${String(params.label ?? '').trim().slice(0, 80) || `${steps.length} edits`}`;
    const run = frame.queue.then(async () => {
      const history = editorFor(frame)!.host().history;
      const before = history.current();
      const results: ToolResult[] = [];
      try {
        for (const [index, step] of steps.entries()) {
          const item = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>;
          const name = typeof item.tool === 'string' ? item.tool : typeof item.name === 'string' ? item.name : '';
          const args = item.args && typeof item.args === 'object' && !Array.isArray(item.args) ? (item.args as Record<string, unknown>) : {};
          spend(frame, 'tool');
          const result = await runPluginTool(frame, name, args);
          if (!result.ok) throw new Error(`Step ${index + 1} (${name || 'no tool'}) failed: ${String(result.error)}`);
          results.push(result);
        }
      } finally {
        history.squash(before, label);
      }
      return { results };
    });
    frame.queue = run.catch(() => undefined);
    return run;
  },
  'jobs.start': (frame, params) => {
    const plugin = pluginFor(frame);
    const id = `plugin:${frame.pluginId}:${Date.now().toString(36)}${(++jobSeq).toString(36)}`;
    const job: Job = { id, kind: 'plugin', label: `${plugin?.name ?? frame.pluginId}: ${String(params.label ?? 'Working').slice(0, 120)}`, status: 'running', progress: 0, message: '', result: null, cancellable: params.cancellable === true };
    frame.jobs.set(id, job);
    if (frame.sandbox) log(frame, 'info', `job started: ${job.label}`);
    else editorFor(frame)!.job(job);
    return id;
  },
  'jobs.update': (frame, params) => {
    const id = String(params.id ?? '');
    const job = frame.jobs.get(id);
    if (!job) throw new Error("That job has ended or is not this plugin's");
    const status = params.status === 'done' || params.status === 'error' ? params.status : 'running';
    const progress = status === 'done' ? 1 : Math.max(0, Math.min(1, finite(params.progress) ?? job.progress));
    const next: Job = { ...job, status, progress, message: typeof params.message === 'string' ? params.message.slice(0, 300) : job.message, cancellable: status === 'running' && job.cancellable };
    if (status === 'running') frame.jobs.set(id, next);
    else frame.jobs.delete(id);
    if (frame.sandbox) {
      if (status !== 'running') log(frame, 'info', `job ${status}: ${next.label}${next.message ? ` — ${next.message}` : ''}`);
    } else editorFor(frame)!.job(next);
    return true;
  },
  subscribe: (frame, params) => {
    const event = params.event as Subscription;
    if (!SUBSCRIPTIONS.includes(event)) throw new Error(`There is no “${String(params.event)}” event (${SUBSCRIPTIONS.join(', ')}).`);
    frame.subscriptions.add(event);
    return true;
  },
  expose: (frame, params) => {
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(name)) throw new Error('An action name is letters, digits, - and _ (up to 48).');
    const action: PluginAction = { plugin: frame.pluginId, name, description: String(params.description ?? '').slice(0, 400), params: params.params && typeof params.params === 'object' ? (params.params as Record<string, unknown>) : undefined };
    if (frame.sandbox) frame.sandbox.actions = [...frame.sandbox.actions.filter((item) => item.name !== name), action];
    else setAction(action);
    return true;
  },
};

/** Every method the bridge answers (the coverage test checks capabilities.ts against it). */
export const BRIDGE_METHODS: ReadonlySet<string> = new Set(Object.keys(HANDLERS));

/** Runs one SDK call for `frame`; resolves with what the page receives (plain JSON). */
async function answer(frame: Frame, method: string, params: Record<string, unknown>): Promise<unknown> {
  const handler = HANDLERS[method];
  if (!editorFor(frame)) throw new Error('The editor is not ready.');
  if (!handler) throw new Error(`bhippi has no “${method}”`);
  const result = await handler(frame, params);
  if (result instanceof Binary) return result.value;
  return result === undefined ? null : JSON.parse(JSON.stringify(result));
}

/** An SDK call as the page at `target` would make it: for tests, which have no message events. */
export function callAs(target: Window, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const frame = [...frames.values()].find((item) => item.window === target);
  return frame ? answer(frame, method, params) : Promise.reject(new Error('That frame is not connected'));
}

function onMessage(event: MessageEvent) {
  const data = event.data as { tag?: string; type?: string; id?: number | string; method?: string; params?: Record<string, unknown>; level?: string; text?: string; ok?: boolean; result?: unknown; error?: string } | null;
  if (!data || data.tag !== TAG) return;
  const frame = [...frames.values()].find((item) => item.window === event.source);
  if (!frame) return;
  switch (data.type) {
    case 'hello':
      void init(frame);
      frame.sandbox?.hello();
      return;
    case 'log': {
      const level = (['log', 'info', 'warn', 'error'] as const).find((item) => item === data.level) ?? 'log';
      log(frame, level, String(data.text ?? '').slice(0, 4000));
      return;
    }
    case 'runChecksResult':
    case 'snapshotResult':
      frame.sandbox?.waiting.get(String(data.id))?.(data as Record<string, unknown>);
      return;
    case 'renderResult': {
      const waiting = waitingRenders.get(String(data.id));
      if (!waiting) return;
      waitingRenders.delete(String(data.id));
      window.clearTimeout(waiting.timer);
      const bitmap = (data as { bitmap?: unknown }).bitmap;
      if (data.ok && typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) waiting.resolve(bitmap);
      else waiting.reject(new Error(String(data.error ?? 'The plugin drew nothing')));
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
      const reply = (message: Record<string, unknown>) => send(frame, { type: 'reply', id: data.id, ...message });
      answer(frame, String(data.method), data.params ?? {})
        .then((result) => reply({ ok: true, result }))
        .catch((error) => reply({ ok: false, error: errorText(error) }));
      return;
    }
  }
}

if (typeof window !== 'undefined') window.addEventListener('message', onMessage);

/** Tells subscribed frames something changed. Project changes are coalesced to one every 250 ms. Test frames never hear the real editor. */
let projectTimer: number | null = null;
export const pluginEvents = {
  project() {
    if (projectTimer !== null || !liveFrames().length) return;
    projectTimer = window.setTimeout(() => {
      projectTimer = null;
      for (const frame of liveFrames()) if (frame.subscriptions.has('project')) send(frame, { type: 'event', event: 'project', data: null });
    }, 250);
  },
  selection(ids: string[]) {
    for (const frame of liveFrames()) if (frame.subscriptions.has('selection')) send(frame, { type: 'event', event: 'selection', data: ids });
  },
  playhead(time: number) {
    for (const frame of liveFrames()) if (frame.subscriptions.has('playhead')) send(frame, { type: 'event', event: 'playhead', data: time });
  },
  /** An export started or ended. Only the output's file name reaches a plugin, never its folder. */
  export(status: 'started' | 'done' | 'error' | 'cancelled', output: string | null) {
    const file = output ? output.split(/[\\/]/).pop() ?? null : null;
    for (const frame of liveFrames()) if (frame.subscriptions.has('export')) send(frame, { type: 'event', event: 'export', data: { status, file } });
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
    await Promise.all(liveFrames().map(async (frame) => {
      const projectStorage = await projectSlice(frame.pluginId, info.key).catch(() => ({}));
      send(frame, { type: 'event', event: 'session', data: { ...info, projectStorage } });
    }));
  },
};

/**
 * The entries running plugins offer in the `where` menu, each named after its plugin. Choosing one
 * sends its page a 'menu' event with the entry's id and what was right-clicked (`context`).
 */
export function pluginMenuItems(where: PluginMenuPlace, context: Record<string, unknown>): { label: string; run: () => void }[] {
  const items: { label: string; run: () => void }[] = [];
  const seen = new Set<string>();
  for (const frame of [...liveFrames()].sort((a, b) => b.connectedAt - a.connectedAt)) {
    const plugin = findPlugin(frame.pluginId);
    if (!plugin?.enabled) continue;
    for (const entry of frame.menus.values()) {
      const key = `${frame.pluginId}:${entry.id}`;
      if (!entry.where.includes(where) || seen.has(key)) continue;
      seen.add(key);
      items.push({ label: `${plugin.name}: ${entry.label}`, run: () => send(frame, { type: 'event', event: 'menu', data: { id: entry.id, where, ...context } }) });
    }
  }
  return items;
}

/** One frame of a plugin clip, as the plugin is asked to draw it (bhippi.generator's `info`). */
export type RenderInfo = {
  /** Seconds from the clip's start; its length; time / duration. */
  time: number;
  duration: number;
  progress: number;
  /** Where the playhead is on the comp's timeline. */
  compTime: number;
  fps: number;
  frame: number;
  /** Pixels to draw; u = width / 1920, the design unit. */
  width: number;
  height: number;
  u: number;
  /** True for the export's frames, false in the preview. */
  exporting: boolean;
  params: Record<string, unknown>;
  audio: AudioFrame;
};

const waitingRenders = new Map<string, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void; timer: number }>();
let renderSeq = 0;

/** The page that draws `source`'s clips: a render copy first, then the newest page that registered it. */
function rendererFor(source: PluginClipSource): Frame | undefined {
  return liveFrames()
    .filter((frame) => frame.pluginId === source.id && frame.generators.has(source.generator))
    .sort((a, b) => (a.role === b.role ? b.connectedAt - a.connectedAt : a.role === 'render' ? -1 : 1))[0];
}

/**
 * A frame of a plugin clip, drawn by the plugin's own page. Waits up to `waitMs` for the page to
 * load and register its generator (a project just opened, a plugin just saved).
 */
export async function renderPluginFrame(source: PluginClipSource, info: Omit<RenderInfo, 'params'>, waitMs = 10_000): Promise<ImageBitmap> {
  // The plugin library may still be loading (a project opened at startup), and the page starting.
  let frame = rendererFor(source);
  for (const until = Date.now() + waitMs; !frame && Date.now() < until;) {
    const waiting = findPlugin(source.id);
    if (waiting && !waiting.enabled) break;
    if (!waiting && pluginStore.get().loaded) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
    frame = rendererFor(source);
  }
  const plugin = findPlugin(source.id);
  if (!plugin) throw new Error(`The “${source.id}” plugin that draws this clip is not installed`);
  if (!plugin.enabled) throw new Error(`“${plugin.name}” draws this clip but is turned off`);
  if (!frame) throw new Error(`“${plugin.name}” did not offer the “${source.generator}” clip (is it still in the plugin?)`);
  const params = withDefaults(source.params ?? {}, findGenerator(source.id, source.generator)?.params);
  return requestRender(frame, source.generator, { ...info, params }, plugin.name);
}

/** Asks `frame` for one frame of its `generator`. */
function requestRender(frame: Frame, generator: string, info: RenderInfo, name: string): Promise<ImageBitmap> {
  const id = `g${++renderSeq}`;
  return new Promise<ImageBitmap>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waitingRenders.delete(id);
      reject(new Error(`“${name}” took more than 15 s to draw a frame of “${generator}”`));
    }, 15_000);
    waitingRenders.set(id, { resolve, reject, timer });
    send(frame, { type: 'render', id, generator, info });
  });
}

/** The user stopped a plugin's job: its page hears 'jobCancel' (job.onCancel) and the job ends. */
export function cancelPluginJob(id: string): boolean {
  for (const frame of liveFrames()) {
    const job = frame.jobs.get(id);
    if (!job) continue;
    frame.jobs.delete(id);
    send(frame, { type: 'event', event: 'jobCancel', data: { id } });
    editor?.job({ ...job, status: 'cancelled', message: 'Cancelled by user', cancellable: false });
    return true;
  }
  return false;
}

/** Playback starting, stopping or changing speed reaches the frames listening for 'playback'. */
if (typeof window !== 'undefined') {
  let last = { playing: playhead.isPlaying(), rate: playhead.rate() };
  playhead.subscribe(() => {
    const now = { playing: playhead.isPlaying(), rate: playhead.rate() };
    if (now.playing === last.playing && now.rate === last.rate) return;
    last = now;
    for (const frame of liveFrames()) if (frame.subscriptions.has('playback')) send(frame, { type: 'event', event: 'playback', data: { ...now, time: playhead.get() } });
  });
}

/** Whether a plugin has a frame running right now (a panel, the Plugin Maker preview, or in the background). */
export const pluginRunning = (pluginId: string) => liveFrames().some((frame) => frame.pluginId === pluginId);

/** Runs an action a plugin exposed, in its newest frame, for Bhippi AI. */
export function callPluginAction(pluginId: string, name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
  const frame = liveFrames().filter((item) => item.pluginId === pluginId).sort((a, b) => b.connectedAt - a.connectedAt)[0];
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
