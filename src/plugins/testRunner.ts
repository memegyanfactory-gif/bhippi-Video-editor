// Runs a plugin for the Plugin Maker (plugin_test, plugin_screenshot) without touching anything
// real: its page loads in a hidden sandboxed frame connected to a sandbox (bridge.ts) whose editor
// is a SCRATCH COPY of the open project — its own undo history, selection, playhead, storage and
// log. Only tools that stay inside the project really run there; a tool that would touch files,
// the network, the shell, the real playhead or the user's settings is answered "skipped during a
// test" instead, and reported as skipped rather than as the plugin's fault.

import type { ToolHost } from '../lib/aiTools';
import type { History } from '../lib/history';
import { api, fileSrc } from '../lib/ipc';
import type { Project, ToolResult } from '../lib/types';
import type { PluginChecker } from './aiTools';
import { connectSandboxFrame, pluginEditor, withDefaults, type PluginEditor, type Sandbox } from './bridge';
import { judgePlugin, type TestReport } from './makerJudge';
import { composePage, PLUGIN_READS } from './rules';
import type { Plugin, PluginGenerator, PluginLog } from './types';

/** Reads that run during a test: the same pure reads a plugin gets without asking (rules.ts). */
export const SCRATCH_READS = PLUGIN_READS;

/**
 * Tools safe to really run on a scratch copy: they change only the project, or only read it and
 * its media on this computer. On the scratch host (`testing`) a tool makes no new transcription,
 * tracks nothing heavy and asks nothing (create_shorts, for one, uses cached words and skips faces).
 */
export const SCRATCH_TOOLS = new Set([
  'add_fx', 'add_marker', 'add_plugin_clip', 'add_shape', 'add_text', 'add_tracks', 'add_transition', 'apply_edit', 'color_grade',
  'create_comp', 'create_folder', 'create_item', 'delete_clips', 'delete_project_items', 'delete_tracks', 'edit_effect',
  'frame_hold', 'group_clips', 'layout_clip', 'link_clips', 'nest_clips', 'open_comp', 'organize_bin', 'place_clip',
  'remove_range', 'remove_transitions', 'seamless_transition', 'set_caption_style', 'set_in_out', 'set_keyframes',
  'set_mask', 'split_clips', 'split_screen', 'undo', 'update_clip', 'update_comp', 'update_item', 'update_track',
  // Shorts, captions, sound levels and beats: project edits from what is already known.
  'create_shorts', 'add_captions', 'level_audio', 'snap_cuts_to_beats', 'fill_background', 'apply_recipe', 'call_custom_tool',
  // Graphics and motion built inside the project.
  'create_motion_graphic', 'add_graphic', 'react_bits', 'remotion_kit', 'create_motion_sequence', 'create_motion_scene', 'update_motion_scene',
  'nest_motion_scenes', 'split_motion_layers', 'create_stick_figure', 'animate_character', 'create_ui_screen', 'update_ui_screen',
  'apply_brand_kit', 'save_beat_sheet', 'roast_move', 'apply_roast_edl',
  // Local reads of the project and its media.
  'inspect_clip_frames', 'inspect_source_frames', 'detect_scenes', 'analyze_music_beats', 'score_audio_clip', 'inspect_color',
  'check_brand_compliance', 'list_brand_archetypes', 'brand_kit_prompt', 'validate_roast_edl', 'edit_dna',
  'local_media_capabilities', 'cloud_generation_capabilities',
]);

/**
 * Tools a plugin may call (when its permissions name them) that never run during a test, and why.
 * Every tool in the catalogue is a read, a scratch tool, one of these, sensitive or forbidden:
 * tests/pluginCapabilities.test.ts fails for a new tool until it is put in one of them.
 */
export const SCRATCH_SKIPPED: Record<string, string> = Object.fromEntries([
  ...['import_media', 'import_lottie', 'import_generated_media', 'import_brand_logo', 'import_brand_kit', 'export_brand_kit', 'render_brand_board',
    'create_brand_kit', 'update_brand_kit', 'train_brand_kit', 'forget_training', 'set_active_brand_kit', 'create_project_guideline', 'save_style_profile', 'create_character',
    'add_sound_effect', 'generate_selection_sound', 'normalize_audio', 'add_voiceover', 'compose_music', 'make_background', 'build_edit_from_brief']
    .map((name) => [name, 'it writes or imports files']),
  ...['analyze_clip_speech', 'podcast_cut', 'track_people', 'lip_sync_character', 'detect_faces', 'track_motion', 'rotoscope_clip', 'erase_subject_clip',
    'reveal_subject', 'depth_occlusion_clip', 'add_text_behind_subject', 'add_media_behind_subject', 'key_green_screen', 'cutout_image',
    'render_3d_scene', 'generate_local_media', 'generation_job']
    .map((name) => [name, 'it transcribes or runs a heavy local model']),
  ...['search_sfx', 'place_sfx'].map((name) => [name, 'it may search or download online']),
  ...['choose_shorts_format', 'set_playhead'].map((name) => [name, 'it asks the user or moves the real playhead']),
  ...['propose_storyboards', 'save_storyboard', 'save_video_blueprint', 'execute_blueprint', 'attach_production_asset', 'finish_gathering',
    'judge_edit', 'run_frame_qa', 'query_frame_atlas', 'list_subagents', 'list_learned_skills', 'apply_learned_skill']
    .map((name) => [name, 'it belongs to an AI turn or its memory']),
]);

/** Why `name` is not really run during a test, or null. */
export function scratchSkip(name: string): string | null {
  if (SCRATCH_READS.has(name) || SCRATCH_TOOLS.has(name)) return null;
  const why = SCRATCH_SKIPPED[name] ?? 'during a test only reads and project edits run, never files, network, shell or settings';
  return `[test] ${name} was not run: ${why}. It will run for the user.`;
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
    squash: (before: Project, text: string) => {
      if (present === before) return;
      let at = -1;
      for (let index = past.length - 1; index >= 0 && at < 0; index--) if (past[index].project === before) at = index;
      if (at < 0) return;
      edits -= past.length - at - 1;
      past.length = at + 1;
      future.length = 0;
      label = text;
    },
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
    testing: true,
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

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
let testSeq = 0;

/**
 * Where a test frame loads its page from. In the app, a file served by the asset protocol, like a
 * live plugin's page: a blob: page would inherit the editor's own content security policy (no
 * inline scripts), so neither the SDK nor the plugin would ever run. Outside the app, a blob.
 */
async function testPage(html: string): Promise<{ url: string; dispose: () => void }> {
  if (inTauri()) {
    // Not a plugin id (those start with a letter or digit), so it can never replace a real page.
    const id = `_test-${Date.now().toString(36)}-${++testSeq}`;
    const path = await api.pluginPageWrite(id, html);
    return { url: fileSrc(path), dispose: () => void api.pluginFilesRemove(id).catch(() => undefined) };
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  return { url, dispose: () => URL.revokeObjectURL(url) };
}

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
    logs: [], storage: {}, projectStorage: {}, playhead: 0, actions: [], calls: [], generators: [], waiting: new Map(),
    hello: () => { helloAt ??= Date.now(); resolveHello(); },
  };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off screen, not hidden: a hidden page has no layout to picture.
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${options.widths[0] ?? 480}px;height:720px;border:0;pointer-events:none;`;
  const page = await testPage(composePage(sandbox.plugin));
  const started = Date.now();
  document.body.appendChild(frame);
  const connection = { current: null as ReturnType<typeof connectSandboxFrame> | null };
  // Connect before the page runs, so its first message is heard.
  if (frame.contentWindow) connection.current = connectSandboxFrame(frame.contentWindow, sandbox);
  frame.src = page.url;
  const images: { width: number; image: string }[] = [];
  let checks: TestReport['checks'] = [];
  try {
    await Promise.race([hello, sleep(8000)]);
    if (helloAt !== null) {
      await sleep(options.waitMs);
      if (options.checks && connection.current) {
        const answer = await connection.current.request('runChecks', 60_000).catch((error: Error): Record<string, unknown> => ({ ok: false, error: error.message }));
        checks = Array.isArray(answer.results) ? (answer.results as TestReport['checks']) : [{ name: 'running the checks', ok: false, error: String(answer.error ?? 'no answer'), ms: 0 }];
        // Each clip generator draws one frame, with sound: a failure is an error, an empty frame a warning.
        for (const generator of sandbox.generators) await drawOnce(connection.current, generator, sandbox.logs);
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
    page.dispose();
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

/** A made-up moment of sound for a test frame: a falling spectrum with a kick in it. */
const TEST_AUDIO = {
  rms: 0.3, peak: 0.7, loading: false,
  bands: Array.from({ length: 64 }, (_, index) => Math.max(0, 0.9 - index / 80 + (index % 7 === 0 ? 0.1 : 0))),
  smooth: Array.from({ length: 64 }, (_, index) => Math.max(0, 0.85 - index / 80)),
  waveform: Array.from({ length: 128 }, (_, index) => Math.sin(index / 6) * 0.6),
};

async function drawOnce(connection: ReturnType<typeof connectSandboxFrame>, generator: PluginGenerator, logs: PluginLog[]) {
  const info = { time: 1, duration: 5, progress: 0.2, compTime: 1, fps: 30, frame: 30, width: 480, height: 270, u: 0.25, exporting: false, params: withDefaults({}, generator.params), audio: TEST_AUDIO };
  const started = Date.now();
  try {
    const bitmap = await connection.render(generator.name, info);
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, info.width, info.height);
    let drawn = 0;
    for (let index = 3; index < data.length; index += 16) if (data[index] > 0) drawn++;
    logs.push(drawn
      ? { at: Date.now(), level: 'info', text: `clip generator “${generator.name}” drew a frame in ${Date.now() - started} ms` }
      : { at: Date.now(), level: 'warn', text: `clip generator “${generator.name}” drew an empty (transparent) frame for a moment with sound` });
  } catch (error) {
    logs.push({ at: Date.now(), level: 'error', text: `clip generator “${generator.name}” failed to draw: ${error instanceof Error ? error.message : String(error)}` });
  }
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
      report.loaded
        ? `Ran against a scratch copy of the project: ${report.calls} call${report.calls === 1 ? '' : 's'}, ${report.edits} edit${report.edits === 1 ? '' : 's'} to the copy, the real project untouched.`
        : `It never connected: the page's scripts did not run far enough to load the bhippi SDK within 8 s.${report.errors.length ? ` Errors: ${report.errors.join(' | ')}` : ' No script error was reported, so check the page for a syntax error before any code runs, or a script that blocks forever.'}`,
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
