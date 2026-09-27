// Bhippi's services for plugins (src/plugins/capabilities.ts): every one reachable from the SDK and
// answered by the bridge, gated by its permission, and doing what the reference says.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', async (actual) => ({
  ...(await actual<object>()),
  api: {
    transcriptsCached: vi.fn(async () => []),
    transcribeAsset: vi.fn(),
    pluginAsk: vi.fn(),
    audioLoudness: vi.fn(),
  },
}));
vi.mock('../src/plugins/store', async (actual) => ({ ...(await actual<object>()), findPlugin: vi.fn() }));

import { api, type Transcript } from '../src/lib/ipc';
import { squashStep } from '../src/lib/history';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Asset, Job, Project, ToolResult } from '../src/lib/types';
import type { ToolHost } from '../src/lib/aiTools';
import { answerJson, BRIDGE_METHODS, callAs, connectPluginFrame, pluginMenuItems, setPluginEditor, type PluginEditor } from '../src/plugins/bridge';
import { PLUGIN_SERVICES, SDK_METHODS, servicesReference } from '../src/plugins/capabilities';
import { PLUGIN_SDK_REFERENCE } from '../src/plugins/brief';
import { validateDraft } from '../src/plugins/drafts';
import { widens } from '../src/plugins/package';
import { validatePlugin } from '../src/plugins/rules';
import { SDK_SOURCE } from '../src/plugins/sdk';
import { findPlugin } from '../src/plugins/store';
import { scratchHistory } from '../src/plugins/testRunner';
import type { Plugin, PluginPermissions } from '../src/plugins/types';

const permissions = (change: Partial<PluginPermissions> = {}): PluginPermissions => ({ tools: [], network: [], chat: false, services: [], ...change });
const plugin = (change: Partial<PluginPermissions> = {}): Plugin => ({
  version: 1, id: 'cap', name: 'Cap', description: '', html: '<p>hi</p>', permissions: permissions(change),
  background: false, enabled: true, panel: true, author: 'user', createdAt: '', updatedAt: '', revision: 1,
});

describe('the capability registry', () => {
  it('the SDK the page gets is valid JavaScript', () => {
    expect(() => new Function(SDK_SOURCE)).not.toThrow();
  });

  it('every service is answered by the bridge and reachable from the SDK', () => {
    for (const { method } of SDK_METHODS) {
      expect(BRIDGE_METHODS.has(method), `${method} has no bridge handler`).toBe(true);
      expect(SDK_SOURCE.includes(`call('${method}'`), `${method} is not in the SDK`).toBe(true);
    }
  });

  it('every service the bridge answers is in the registry, so the Maker is told about it', () => {
    const services = [...BRIDGE_METHODS].filter((method) => /^(transcript|ai|playback|audio|video|media|jobs|menu)\./.test(method) || method === 'batch');
    const listed = new Set(SDK_METHODS.map((entry) => entry.method));
    for (const method of services) expect(listed.has(method), `${method} is missing from capabilities.ts`).toBe(true);
  });

  it('the SDK reference the Plugin Maker reads describes each service', () => {
    const reference = servicesReference();
    expect(PLUGIN_SDK_REFERENCE).toContain(reference);
    for (const entry of SDK_METHODS.filter((item) => !item.usage.startsWith('('))) expect(reference).toContain(entry.usage);
    for (const name of Object.keys(PLUGIN_SERVICES)) expect(reference).toContain(name);
  });
});

describe('the services permission', () => {
  const known = new Set(['add_marker']);
  it('only names real services', () => {
    expect(validatePlugin(plugin({ services: ['ai', 'transcribe'] }), known)).toBeNull();
    expect(validatePlugin(plugin({ services: ['shell'] }), known)).toMatch(/not a Bhippi service/);
  });

  it('asking for a new service waits for the user', () => {
    expect(widens(permissions(), permissions({ services: ['ai'] }))).toBe(true);
    expect(widens(permissions({ services: ['ai'] }), permissions({ services: ['ai'] }))).toBe(false);
    expect(widens(permissions({ services: ['ai', 'transcribe'] }), permissions({ services: ['ai'] }))).toBe(false);
  });

  it('plugin_validate wants the service the code uses, and only that', () => {
    const files = (services: string[], code: string) => ({
      'manifest.json': JSON.stringify({ name: 'Cap', description: '', permissions: { tools: [], network: [], chat: false, services } }),
      'index.html': '<script src="app.js"></script>',
      'app.js': code,
    });
    const asks = 'await bhippi.ready; const reply = await bhippi.ai.ask("hi", { json: true });';
    expect(validateDraft(files([], asks), known).problems.join(' ')).toMatch(/does not list "ai"/);
    expect(validateDraft(files(['ai'], asks), known).problems.join(' ')).not.toMatch(/"ai"/);
    const transcribes = 'await bhippi.ready; await bhippi.transcript.comp({ transcribe: true });';
    expect(validateDraft(files([], transcribes), known).problems.join(' ')).toMatch(/does not list "transcribe"/);
    expect(validateDraft(files([], 'await bhippi.ready; await bhippi.transcript.comp();'), known).problems.join(' ')).not.toMatch(/transcribe/);
    expect(validateDraft(files(['ai'], 'await bhippi.ready;'), known).warnings.join(' ')).toMatch(/never calls bhippi.ai.ask/);
  });
});

describe('answers as JSON', () => {
  it('reads bare, fenced and wrapped JSON', () => {
    expect(answerJson('{"a":1}')).toEqual({ a: 1 });
    expect(answerJson('Here:\n```json\n[1, 2]\n```')).toEqual([1, 2]);
    expect(answerJson('Sure! {"cue": "riser"} hope that helps')).toEqual({ cue: 'riser' });
    expect(() => answerJson('no json here')).toThrow(/did not answer with JSON/);
  });
});

describe('squashing undo steps', () => {
  it('folds everything since a project into one named step', () => {
    const a = newProject('a');
    const b = { ...a, name: 'b' };
    const c = { ...a, name: 'c' };
    const d = { ...a, name: 'd' };
    const state = { past: [{ project: a, label: 'Open' }, { project: b, label: 'one' }, { project: c, label: 'two' }], present: d, presentLabel: 'three', future: [], pending: null };
    const squashed = squashStep(state, b, 'Plugin: 3 edits');
    expect(squashed.past.map((entry) => entry.label)).toEqual(['Open', 'one']);
    expect(squashed.present).toBe(d);
    expect(squashed.presentLabel).toBe('Plugin: 3 edits');
    // Nothing changed, a gesture in flight, or a project no longer in the history: left alone.
    expect(squashStep({ ...state, present: b }, b, 'x').presentLabel).toBe('three');
    expect(squashStep({ ...state, pending: c }, b, 'x')).toEqual({ ...state, pending: c });
    expect(squashStep(state, newProject('gone'), 'x')).toBe(state);
  });
});

describe('the services, through the bridge', () => {
  type Fixture = { project: Project; clipId: string; frame: Window; jobs: Job[]; history: ReturnType<typeof scratchHistory>; runTool: ReturnType<typeof vi.fn> };

  const words: Transcript = {
    assetId: 'talk', provider: 'test', language: 'en', text: 'hello there general kenobi',
    words: [
      { text: 'hello', start: 1, end: 1.4 },
      { text: 'there', start: 1.5, end: 2 },
      { text: 'general', start: 10, end: 10.5 },
      { text: 'kenobi', start: 10.6, end: 11.2 },
    ],
  };

  function fixture(change: Partial<PluginPermissions> = {}): Fixture {
    const project = newProject();
    const comp = project.comps[0];
    const audio = tracksOf(comp, 'audio')[0].id;
    // The clip plays 9–12 s of the file from 20 s on the timeline, at double speed.
    const clip = newClip({ trackId: audio, start: 20, duration: 1.5, in: 9, speed: 2, source: { type: 'media', assetId: 'talk' } });
    comp.clips = [clip];
    const assets = new Map([['talk', { id: 'talk', name: 'talk.wav', kind: 'audio', duration: 30, hasAudio: true, peaks: null } as unknown as Asset]]);
    const history = scratchHistory(project);
    const jobs: Job[] = [];
    const runTool = vi.fn(async (host: ToolHost, name: string): Promise<ToolResult> => {
      host.history.commit((current) => ({ ...current, name: `${current.name}+${name}` }), name);
      return { ok: true, summary: name };
    });
    const editor: PluginEditor = {
      host: () => ({ history, assets: () => assets, selection: () => [], setSelection: () => undefined } as unknown as ToolHost),
      runTool, known: new Set(['add_marker', 'add_text']), toolSpecs: () => [], permission: () => 'edit' as never, disableLocalGeneration: () => true,
      toast: () => undefined, chat: () => undefined, projectPath: () => null,
      ai: () => ({ providerId: 'claude', model: 'opus' }), job: (job) => { jobs.push(job); },
    };
    setPluginEditor(editor);
    vi.mocked(findPlugin).mockReturnValue(plugin({ tools: ['add_marker', 'add_text'], ...change }));
    const frame = { postMessage: vi.fn() } as unknown as Window;
    connectPluginFrame('cap', frame);
    return { project, clipId: clip.id, frame, jobs, history, runTool };
  }

  beforeEach(() => {
    vi.mocked(api.transcriptsCached).mockReset().mockResolvedValue([]);
    vi.mocked(api.transcribeAsset).mockReset();
    vi.mocked(api.pluginAsk).mockReset();
  });

  it('transcript.get maps a clip\'s words onto the timeline', async () => {
    const { frame, clipId } = fixture();
    vi.mocked(api.transcriptsCached).mockResolvedValue([words]);
    const result = await callAs(frame, 'transcript.get', { clipId }) as { words: { text: string; start: number; end: number; sourceStart: number }[]; cached: boolean };
    expect(result.cached).toBe(true);
    // Only the words inside 9–12 s of the file, at 20 + (source − 9) / 2.
    expect(result.words.map((word) => word.text)).toEqual(['general', 'kenobi']);
    expect(result.words[0].start).toBeCloseTo(20.5);
    expect(result.words[1].end).toBeCloseTo(21.1);
    expect(result.words[0].sourceStart).toBe(10);
  });

  it('transcript.comp reads what Bhippi has, and says what is missing', async () => {
    const { frame } = fixture();
    const missing = await callAs(frame, 'transcript.comp', {}) as { words: unknown[]; missing: string[] };
    expect(missing.words).toEqual([]);
    expect(missing.missing).toEqual(['talk']);
    expect(api.transcribeAsset).not.toHaveBeenCalled();
    vi.mocked(api.transcriptsCached).mockResolvedValue([words]);
    const found = await callAs(frame, 'transcript.comp', {}) as { words: { text: string }[]; lines: { text: string }[]; text: string };
    expect(found.text).toBe('general kenobi');
    expect(found.lines[0].text).toBe('general kenobi');
  });

  it('a new transcription needs the transcribe service', async () => {
    const { frame } = fixture();
    await expect(callAs(frame, 'transcript.comp', { transcribe: true })).rejects.toThrow(/“transcribe” service/);
    expect(api.transcribeAsset).not.toHaveBeenCalled();
    const allowed = fixture({ services: ['transcribe'] });
    vi.mocked(api.transcribeAsset).mockResolvedValue(words);
    const result = await callAs(allowed.frame, 'transcript.comp', { transcribe: true }) as { text: string; missing: string[] };
    expect(api.transcribeAsset).toHaveBeenCalledWith('talk', 'auto');
    expect(result.text).toBe('general kenobi');
    expect(result.missing).toEqual([]);
  });

  it('ai.ask needs the ai service, uses the user\'s model and parses JSON', async () => {
    const refused = fixture();
    await expect(callAs(refused.frame, 'ai.ask', { prompt: 'hi' })).rejects.toThrow(/“ai” service/);
    expect(api.pluginAsk).not.toHaveBeenCalled();
    const { frame } = fixture({ services: ['ai'] });
    vi.mocked(api.pluginAsk).mockResolvedValue({ text: '```json\n{"cues":[{"at":1}]}\n```', provider: 'Claude Code', model: 'opus', inputTokens: 10, outputTokens: 5 });
    const reply = await callAs(frame, 'ai.ask', { prompt: 'Where do sounds go?', json: { type: 'object' } }) as { json: unknown; usage: { input: number } };
    expect(reply.json).toEqual({ cues: [{ at: 1 }] });
    expect(reply.usage.input).toBe(10);
    const sent = vi.mocked(api.pluginAsk).mock.calls[0][0];
    expect(sent.providerId).toBe('claude');
    expect(sent.model).toBe('opus');
    expect(sent.system).toMatch(/JSON only/);
    expect(sent.system).toContain('"type":"object"');
  });

  it('batch runs every step as one undo step', async () => {
    const { frame, history, runTool } = fixture();
    const before = history.steps.past.length;
    const result = await callAs(frame, 'batch', { steps: [{ tool: 'add_marker', args: {} }, { tool: 'add_text', args: {} }, { tool: 'add_marker', args: {} }], label: 'Cues' }) as { results: unknown[] };
    expect(result.results).toHaveLength(3);
    expect(runTool).toHaveBeenCalledTimes(3);
    expect(history.steps.past.length).toBe(before + 1);
    expect(history.steps.present).toBe('Cap: Cues');
  });

  it('batch stops at a step the plugin may not run, and still leaves one undo step', async () => {
    const { frame, history } = fixture();
    const before = history.steps.past.length;
    await expect(callAs(frame, 'batch', { steps: [{ tool: 'add_marker' }, { tool: 'delete_clips' }, { tool: 'add_text' }] })).rejects.toThrow(/Step 2 \(delete_clips\) failed/);
    expect(history.steps.past.length).toBe(before + 1);
  });

  it('menu entries show under their plugin and tell the page what was clicked', async () => {
    const { frame } = fixture();
    await callAs(frame, 'menu.add', { id: 'score', label: 'Score this clip', where: ['clip', 'media'] });
    expect(pluginMenuItems('timeline', {})).toEqual([]);
    const items = pluginMenuItems('clip', { clipIds: ['c1'], time: 3 });
    expect(items.map((item) => item.label)).toEqual(['Cap: Score this clip']);
    items[0].run();
    const sent = vi.mocked(frame.postMessage).mock.calls.map(([message]) => message as { event?: string; data?: Record<string, unknown> });
    expect(sent.find((message) => message.event === 'menu')?.data).toEqual({ id: 'score', where: 'clip', clipIds: ['c1'], time: 3 });
    await callAs(frame, 'menu.remove', { id: 'score' });
    expect(pluginMenuItems('clip', {})).toEqual([]);
    await expect(callAs(frame, 'menu.add', { id: 'x', label: 'X', where: 'toolbar' })).rejects.toThrow(/where is one or more/);
  });

  it('jobs show in the editor and end', async () => {
    const { frame, jobs } = fixture();
    const id = await callAs(frame, 'jobs.start', { label: 'Scoring', cancellable: true }) as string;
    await callAs(frame, 'jobs.update', { id, progress: 0.5, message: 'half' });
    await callAs(frame, 'jobs.update', { id, status: 'done' });
    expect(jobs.map((job) => [job.status, job.progress])).toEqual([['running', 0], ['running', 0.5], ['done', 1]]);
    expect(jobs[0].label).toBe('Cap: Scoring');
    await expect(callAs(frame, 'jobs.update', { id, progress: 0.9 })).rejects.toThrow(/has ended/);
  });
});
