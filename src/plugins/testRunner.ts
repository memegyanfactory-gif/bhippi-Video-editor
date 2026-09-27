// Runs a plugin for the Plugin Maker (plugin_test, plugin_screenshot) without touching anything
// real: its page loads in a hidden sandboxed frame connected to a sandbox (bridge.ts) whose editor
// is a SCRATCH COPY of the open project — its own undo history, selection, playhead, storage and
// log. Only tools that stay inside the project really run there; a tool that would touch files,
// the network, the shell, the real playhead or the user's settings is answered "skipped during a
// test" instead, and reported as skipped rather than as the plugin's fault.

import type { ToolHost } from '../lib/aiTools';
import type { History } from '../lib/history';
import type { Project, ToolResult } from '../lib/types';
import type { PluginChecker } from './aiTools';
import { connectSandboxFrame, pluginEditor, type PluginEditor, type Sandbox } from './bridge';
import { judgePlugin, type TestReport } from './makerJudge';
import { composePage, PLUGIN_READS } from './rules';
import type { Plugin } from './types';

/** Reads that run during a test: the same pure reads a plugin gets without asking (rules.ts). */
export const SCRATCH_READS = PLUGIN_READS;

/**
 * Tools that only change the project itself, so they are safe to really run on a scratch copy.
 * Everything that is neither this nor a SCRATCH_READS read is skipped during a test.
 */
export const SCRATCH_TOOLS = new Set([
  'add_fx', 'add_marker', 'add_shape', 'add_text', 'add_tracks', 'add_transition', 'apply_edit', 'color_grade',
  'create_comp', 'create_folder', 'create_item', 'delete_clips', 'delete_project_items', 'delete_tracks', 'edit_effect',
  'frame_hold', 'group_clips', 'layout_clip', 'link_clips', 'nest_clips', 'open_comp', 'organize_bin', 'place_clip',
  'remove_range', 'remove_transitions', 'seamless_transition', 'set_caption_style', 'set_in_out', 'set_keyframes',
  'set_mask', 'split_clips', 'split_screen', 'undo', 'update_clip', 'update_comp', 'update_item', 'update_track',
]);

/** Why `name` is not really run during a test, or null. */
export function scratchSkip(name: string): string | null {
  if (SCRATCH_READS.has(name) || SCRATCH_TOOLS.has(name)) return null;
  return `[test] ${name} was not run: during a test only reads and project edits run, never files, network, shell or settings. It will run for the user.`;
}

/** An undo history over a copy of `initial`, with the shape of the editor's (history.ts). */
export function scratchHistory(initial: Project): History & { edits: () => number } {
  let present = initial;
  let label = 'Test start';
  const past: { project: Project; label: string }[] = [];
  const future: { project: Project; label: string }[] = [];
  let edits = 0;
  const commit = (next: Project | ((current: Project) => Project), text = 'Edit') => {
    const project = typeof next === 'function' ? next(present) : next;
    if (project === present) return;
    past.push({ project: present, label });
    future.length = 0;
    present = project;
    label = text;
    edits += 1;
  };
  const undo = () => {
    const previous = past.pop();
    if (!previous) return;
    future.unshift({ project: present, label });
    present = previous.project;
    label = previous.label;
  };
  const redo = () => {
    const next = future.shift();
    if (!next) return;
    past.push({ project: present, label });
    present = next.project;
    label = next.label;
  };
  const history = {
    get project() { return present; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get undoLabel() { return label; },
    get redoLabel() { return future[0]?.label ?? ''; },
    get steps() { return { past: past.map((entry) => entry.label), present: label, future: future.map((entry) => entry.label) }; },
    commit,
    preview: (next: Project | ((current: Project) => Project)) => { present = typeof next === 'function' ? next(present) : next; },
    settle: (text = 'Edit') => { label = text; edits += 1; },
    cancel: () => undefined,
    view: (change: (current: Project) => Project) => { present = change(present); },
    reset: (project: Project) => { present = project; past.length = 0; future.length = 0; },
    undo,
    redo,
    jump: (steps: number) => { for (let i = 0; i < Math.abs(steps); i++) (steps < 0 ? undo : redo)(); },
    current: () => present,
    gesture: () => false,
    edits: () => edits,
  };
  return history as unknown as History & { edits: () => number };
}

const notInTest = (what: string) => () => Promise.reject(new Error(`[test] ${what} does not run during a plugin test.`));

/** A tool host over the scratch history: the real assets to read, nothing that reaches outside. */
export function scratchHost(base: ToolHost, history: History): ToolHost {
  let selection: string[] = [];
  return {
    history,
    assets: base.assets,
    selection: () => selection,
    setSelection: (ids) => { selection = [...ids]; },
    importMedia: notInTest('Importing media'),
    speak: notInTest('Voice-over'),
    ask: notInTest('Asking the editor'),
    permission: base.permission,
    settings: base.settings,
    saveSettings: notInTest('Changing settings'),
    approveGeneration: async () => null,
  };
}

/** The editor a test frame sees: the scratch host, the real rules. */
function scratchEditor(live: PluginEditor, host: ToolHost): PluginEditor {
  return {
    ...live,
    host: () => host,
    toast: () => undefined,
    chat: () => undefined,
    projectPath: () => null,
  };
}

type Run = { report: TestReport; images: { width: number; image: string }[] };

const frameTick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Loads `plugin` in a hidden frame against a scratch project, runs its checks and/or pictures it. */
export async function runPlugin(plugin: Plugin, options: { waitMs: number; checks: boolean; widths: number[] }): Promise<Run> {
  const live = pluginEditor();
  if (!live) throw new Error('The editor is not ready.');
  const history = scratchHistory(live.host().history.current());
  const host = scratchHost(live.host(), history);
  let helloAt: number | null = null;
  let resolveHello: () => void = () => undefined;
  const hello = new Promise<void>((resolve) => { resolveHello = resolve; });
  const sandbox: Sandbox = {
    editor: scratchEditor(live, host),
    plugin: { ...plugin, enabled: true },
    skip: scratchSkip,
    logs: [], storage: {}, projectStorage: {}, playhead: 0, actions: [], calls: [], waiting: new Map(),
    hello: () => { helloAt ??= Date.now(); resolveHello(); },
  };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off screen, not hidden: a hidden page has no layout to picture.
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${options.widths[0] ?? 480}px;height:720px;border:0;pointer-events:none;`;
  const url = URL.createObjectURL(new Blob([composePage(sandbox.plugin)], { type: 'text/html' }));
  const started = Date.now();
  document.body.appendChild(frame);
  const connection = { current: null as ReturnType<typeof connectSandboxFrame> | null };
  // Connect before the page runs, so its first message is heard.
  if (frame.contentWindow) connection.current = connectSandboxFrame(frame.contentWindow, sandbox);
  frame.src = url;
  const images: { width: number; image: string }[] = [];
  let checks: TestReport['checks'] = [];
  try {
    await Promise.race([hello, sleep(8000)]);
    if (helloAt !== null) {
      await sleep(options.waitMs);
      if (options.checks && connection.current) {
        const answer = await connection.current.request('runChecks', 60_000).catch((error: Error): Record<string, unknown> => ({ ok: false, error: error.message }));
        checks = Array.isArray(answer.results) ? (answer.results as TestReport['checks']) : [{ name: 'running the checks', ok: false, error: String(answer.error ?? 'no answer'), ms: 0 }];
      }
      for (const width of options.widths.length && !options.checks ? options.widths : []) {
        frame.style.width = `${width}px`;
        await frameTick();
        await sleep(250);
        const shot = await connection.current!.request('snapshot', 15_000).catch((error: Error): Record<string, unknown> => ({ ok: false, error: error.message }));
        if (shot.ok && typeof shot.image === 'string') images.push({ width, image: shot.image });
        else sandbox.logs.push({ at: Date.now(), level: 'warn', text: `No picture at ${width}px: ${String(shot.error ?? 'no answer')}` });
      }
    }
  } finally {
    connection.current?.disconnect();
    frame.remove();
    URL.revokeObjectURL(url);
  }

  const report: TestReport = {
    loaded: helloAt !== null,
    loadMs: helloAt === null ? null : helloAt - started,
    errors: sandbox.logs.filter((line) => line.level === 'error').map((line) => line.text.slice(0, 300)),
    warnings: sandbox.logs.filter((line) => line.level === 'warn').length,
    checks,
    refused: sandbox.calls.filter((call) => !call.ok && !call.skipped).map((call) => ({ name: call.name, error: (call.error ?? '').slice(0, 200) })),
    skipped: [...new Set(sandbox.calls.filter((call) => call.skipped).map((call) => call.name))],
    calls: sandbox.calls.length,
    edits: history.edits(),
    actions: sandbox.actions.map((action) => action.name),
    logs: sandbox.logs.slice(-40).map((line) => `${line.level.toUpperCase()} ${line.text.slice(0, 300)}`),
  };
  return { report, images };
}

/** plugin_test and plugin_screenshot for the Maker's tools (aiTools.ts). */
export const pluginChecker: PluginChecker = {
  async test(plugin, waitMs, check) {
    const { report } = await runPlugin(plugin, { waitMs, checks: true, widths: [480] });
    const verdict = judgePlugin(check, report);
    const failing = report.checks.filter((item) => !item.ok);
    const lines = [
      `Judge: ${verdict.score}/100 (pass mark 80) for “${plugin.name}” — ${verdict.pass ? 'PASS' : 'below the mark'}.`,
      verdict.criteria.map((item) => `${item.label} ${Math.round(item.score * item.weight)}/${item.weight} (${item.note})`).join('; '),
      report.loaded ? `Ran against a scratch copy of the project: ${report.calls} call${report.calls === 1 ? '' : 's'}, ${report.edits} edit${report.edits === 1 ? '' : 's'} to the copy, the real project untouched.` : 'It never connected: nothing ran.',
      ...(report.skipped.length ? [`Skipped during the test (they run for the user): ${report.skipped.join(', ')}.`] : []),
      ...(failing.length ? [`Failing checks: ${failing.map((item) => `“${item.name}”: ${item.error ?? 'failed'}`).join(' | ')}`] : []),
      ...(verdict.fixes.length ? ['Fix, in order:', ...verdict.fixes.map((fix) => `- ${fix}`)] : ['Nothing to fix. Take a plugin_screenshot to check the look.']),
    ];
    return { ok: true, summary: lines.join('\n'), score: verdict.score, pass: verdict.pass, criteria: verdict.criteria, fixes: verdict.fixes, report } as ToolResult;
  },
  async screenshot(plugin, widths) {
    const { report, images } = await runPlugin(plugin, { waitMs: 800, checks: false, widths });
    if (!report.loaded) return { ok: false, error: `“${plugin.name}” never loaded, so there is nothing to picture. plugin_test shows why.` };
    if (!images.length) return { ok: false, error: `No picture could be drawn: ${report.logs.filter((line) => line.startsWith('WARN')).join(' | ') || 'no answer from the page'}` };
    return {
      ok: true,
      summary: `“${plugin.name}” at ${images.map((item) => `${item.width}px`).join(' and ')} wide (images attached, in that order), rendered against a scratch copy of the project. Look for overflow, cramped or clipped text, weak contrast, missing empty/error states and anything that does not match the editor.`,
      widths: images.map((item) => item.width),
      images: images.map((item) => item.image),
    } as ToolResult;
  },
};
