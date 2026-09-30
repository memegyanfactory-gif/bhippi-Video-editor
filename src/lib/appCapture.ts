// capture_app_session, the app side (the capture itself is src-tauri/src/app_capture.rs).
//
// To capture Bhippi's own interface, its React UI runs in a headless browser with a stand-in for
// the desktop backend: the same trick every film agent built by hand. The stand-in answers from
// the real app's state (demo mode): your providers, settings, library and open project, so the
// captured screens are yours. Named parts (`@composer`, `@send`, `@timeline`…) spare a model from
// guessing Bhippi's DOM, and a key made from the session lets a capture be reused (the part library).
import { api, fetchFile } from './ipc';
import type { Asset, Project } from './types';

export type CaptureStep =
  | { do: 'click' | 'hover'; selector: string }
  | { do: 'type'; selector: string; text: string; part?: string; partSelector?: string }
  | { do: 'key'; key: string }
  | { do: 'wait'; ms: number }
  | { do: 'eval'; js: string }
  | { do: 'capture'; part: string; selector: string; state?: string; pad?: number };

/** One picture of a part in a state; a typing state carries its text so far (`typed`). */
export type CapturedPart = { part: string; state: string; file: string; boxCss: [number, number, number, number]; pixels: [number, number]; typed?: string };
export type CaptureManifest = { key: string | null; url: string; width: number; height: number; scale: number; parts: CapturedPart[]; issues: string[]; dir: string };
export type CaptureRequest = { url?: string; name: string; width?: number; height?: number; scale?: number; standin?: string; ready?: string; transparent?: boolean; key?: string; steps: CaptureStep[] };

/** Bhippi's own parts by name: a step's selector "@composer" means the real composer. */
export const BHIPPI_PARTS: Record<string, string> = {
  composer: 'form.composer',
  field: 'form.composer textarea',
  send: 'form.composer .send-btn',
  pills: '.composer-pills',
  menu: '.pill-menu',
  chat: '.panel-chat',
  messages: '.chat-list',
  timeline: '.timeline',
  program: '.monitor.program',
  source: '.monitor.source',
  project: '.bin',
};

/** A step's selector with any `@name` replaced by Bhippi's real selector. */
export const resolveSelector = (selector: string) => (selector.startsWith('@') ? BHIPPI_PARTS[selector.slice(1)] ?? selector : selector);

/**
 * The steps a model gave, checked and resolved: unknown actions and missing fields are refused
 * with the reason, so a small model gets a fix instead of a silent empty capture.
 */
export function parseSteps(raw: unknown): { steps: CaptureStep[]; problems: string[] } {
  const steps: CaptureStep[] = [];
  const problems: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.slice(0, 400).forEach((entry, index) => {
    const step = (entry ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof step[key] === 'string' ? (step[key] as string) : '');
    const where = `step ${index + 1}`;
    switch (step.do) {
      case 'click':
      case 'hover':
        if (!text('selector')) problems.push(`${where}: ${step.do} needs a selector`);
        else steps.push({ do: step.do, selector: resolveSelector(text('selector')) });
        break;
      case 'type':
        if (!text('selector') || !text('text')) problems.push(`${where}: type needs a selector and text`);
        else steps.push({ do: 'type', selector: resolveSelector(text('selector')), text: text('text').slice(0, 200), ...(text('part') ? { part: text('part') } : {}), ...(text('partSelector') ? { partSelector: resolveSelector(text('partSelector')) } : {}) });
        break;
      case 'key':
        if (!text('key')) problems.push(`${where}: key needs a key name (Enter, Escape, Tab…)`);
        else steps.push({ do: 'key', key: text('key') });
        break;
      case 'wait':
        steps.push({ do: 'wait', ms: Math.max(0, Math.min(10000, Number(step.ms) || 300)) });
        break;
      case 'eval':
        if (!text('js')) problems.push(`${where}: eval needs js`);
        else steps.push({ do: 'eval', js: text('js') });
        break;
      case 'capture':
        if (!text('part') || !text('selector')) problems.push(`${where}: capture needs a part name and a selector`);
        else steps.push({ do: 'capture', part: text('part'), selector: resolveSelector(text('selector')), ...(text('state') ? { state: text('state') } : {}), ...(typeof step.pad === 'number' ? { pad: step.pad } : {}) });
        break;
      default:
        problems.push(`${where}: "${String(step.do)}" is not an action (click, hover, type, key, wait, eval, capture)`);
    }
  });
  return { steps, problems };
}

/** A short stable hash (FNV-1a) of the session: the same capture of the same app version is reused. */
export function captureKey(request: Omit<CaptureRequest, 'standin' | 'key'>, version: string): string {
  const text = JSON.stringify([version, request.url ?? 'bhippi', request.width ?? 1920, request.height ?? 1080, request.scale ?? 3, request.transparent ?? false, request.steps]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The script that stands in for Bhippi's desktop backend in a plain browser: it answers the UI's
 * calls from `answers`, lists come back empty, everything else null, events can be listened to,
 * and local files load from the capture's own file server (`{{FILES}}`, filled in by Rust).
 */
export function standinSource(answers: Record<string, unknown>): string {
  return `(() => {
  const answers = ${JSON.stringify(answers)};
  const lists = /_list$|_load$|s_cached$|_scan$|_docs$|^library_missing$|^trace_list$|^mcp_servers$|^refs_list$|^project_backups$|^chat_active_turns$|^effort_levels$|^service_keys$|^transcribe_engines$|^plugin_draft_list$/;
  const callbacks = new Map();
  let nextCallback = 1;
  const listeners = new Map();
  let nextListener = 1;
  const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' }, windows: [{ label: 'main' }], webviews: [{ windowLabel: 'main', label: 'main' }] },
    plugins: {},
    transformCallback(callback, once) { const id = nextCallback++; callbacks.set(id, { callback, once }); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    runCallback(id, data) { const entry = callbacks.get(id); if (!entry) return; if (entry.once) callbacks.delete(id); if (entry.callback) entry.callback(data); },
    convertFileSrc(path) { return path ? '{{FILES}}' + encodeURIComponent(String(path).replace(/\\\\/g, '/')) : ''; },
    async invoke(cmd, args) {
      if (cmd === 'plugin:event|listen') { const id = nextListener++; const list = listeners.get(args.event) || []; list.push({ id, handler: args.handler }); listeners.set(args.event, list); return id; }
      if (cmd === 'plugin:event|unlisten') { listeners.set(args.event, (listeners.get(args.event) || []).filter((entry) => entry.id !== args.eventId)); return null; }
      if (cmd.startsWith('plugin:event|')) return null;
      if (cmd.startsWith('plugin:window|') || cmd.startsWith('plugin:webview|') || cmd.startsWith('plugin:app|')) {
        if (cmd.endsWith('inner_size') || cmd.endsWith('outer_size')) return { width: window.innerWidth, height: window.innerHeight };
        if (cmd.endsWith('scale_factor')) return 1;
        if (cmd.endsWith('is_maximized') || cmd.endsWith('is_fullscreen')) return false;
        if (cmd.endsWith('is_visible') || cmd.endsWith('is_focused')) return true;
        if (cmd.endsWith('title')) return 'Bhippi';
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(answers, cmd)) return copy(answers[cmd]);
      if (lists.test(cmd)) return [];
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: 'windows', os_type: 'windows', family: 'windows', arch: 'x86_64', version: '10.0', eol: '\\r\\n', exe_extension: 'exe' };
  window.__bhippiEmit = (event, payload) => { for (const entry of listeners.get(event) || []) window.__TAURI_INTERNALS__.runCallback(entry.handler, { event, id: entry.id, payload }); };
})();`;
}

/**
 * What the stand-in answers, from the real app (demo mode): the user's own settings, providers,
 * library and open project, so the captured screens show their Bhippi. A call that fails leaves
 * its answer empty rather than stopping the capture.
 */
export async function bhippiAnswers(project: Project, assets: Asset[]): Promise<Record<string, unknown>> {
  const get = async <T>(call: () => Promise<T>) => { try { return await call(); } catch { return null; } };
  const [settings, providers, info, license, storage] = await Promise.all([
    get(() => api.settingsGet()), get(() => api.providersList()), get(() => api.appInfo()), get(() => api.licenseStatus()), get(() => api.storageInfo()),
  ]);
  // Onboarding, the tour and updates would cover the interface being filmed.
  const calm = settings ? { ...settings, onboarded: true, tour: false, tourSeen: true, autoUpdate: false } : null;
  return {
    settings_get: calm,
    settings_save: calm,
    providers_list: providers ?? [],
    app_info: info,
    license_status: license ?? { state: 'active', offline: false, devBuild: false, devBypassAllowed: false, account: null, expiresAt: null, message: null, deviceName: 'Bhippi' },
    library_list: assets,
    project_load: project,
    chat_log_load: [],
    storage_info: storage,
    update_status: { state: 'idle' },
    startup_file: null,
    support_outbox_count: 0,
  };
}

/** A session name as its folder under AI Work/ui-parts, the way app_capture.rs `slug` makes it. */
export function captureFolder(name: string): string {
  const cleaned = [...name].map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : '-')).join('').replace(/^-+|-+$/g, '');
  return cleaned ? [...cleaned].slice(0, 60).join('') : 'session';
}

/**
 * A capture's manifest, by the session's name (its folder in the project's AI Work/ui-parts), its
 * folder, or the manifest.json itself. Fails with where it looked.
 */
export async function loadCaptureManifest(ref: string): Promise<CaptureManifest> {
  let path = ref.trim();
  if (!/[\\/]/.test(path)) {
    const info = await api.storageInfo();
    const aiWork = info.categories.find((category) => category.id === 'ai-work')?.path;
    if (!aiWork) throw new Error('The project has no AI Work folder yet: run capture_app_session first.');
    const sep = aiWork.includes('\\') ? '\\' : '/';
    path = [aiWork.replace(/[\\/]+$/, ''), 'ui-parts', captureFolder(path), 'manifest.json'].join(sep);
  } else if (!/\.json$/i.test(path)) path = `${path.replace(/[\\/]+$/, '')}${path.includes('\\') ? '\\' : '/'}manifest.json`;
  let manifest: CaptureManifest;
  try {
    manifest = (await (await fetchFile(path)).json()) as CaptureManifest;
  } catch {
    throw new Error(`No capture at ${path}: run capture_app_session with that name first (or give the manifest.json path).`);
  }
  if (!manifest || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error(`${path} lists no captured parts.`);
  return manifest;
}

/** The parts to show the model: each part's last state, and for typing, its first, middle and last. */
export function sheetParts(manifest: CaptureManifest, limit = 24): CapturedPart[][] {
  const byPart = new Map<string, CapturedPart[]>();
  for (const part of manifest.parts) byPart.set(part.part, [...(byPart.get(part.part) ?? []), part]);
  const picked: CapturedPart[] = [];
  for (const states of byPart.values()) {
    const typing = states.filter((state) => /^t\d+$/.test(state.state));
    if (typing.length > 2) picked.push(typing[0], typing[Math.floor(typing.length / 2)], typing[typing.length - 1]);
    for (const state of states) if (!/^t\d+$/.test(state.state) && !picked.includes(state)) picked.push(state);
  }
  const kept = picked.slice(0, limit);
  return Array.from({ length: Math.ceil(kept.length / 6) }, (_, i) => kept.slice(i * 6, i * 6 + 6));
}
