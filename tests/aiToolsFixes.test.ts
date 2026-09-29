import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: {
    mogrtFramesBegin: vi.fn(),
    exportFrame: vi.fn(),
    chatReadImages: vi.fn(),
    rotoRead: vi.fn(async () => null),
    audioLoudness: vi.fn(),
    fsRunCommand: vi.fn(),
  },
  errorText: (e: unknown) => String(e instanceof Error ? e.message : e),
  fileSrc: (p: string) => p,
}));
// Rendering stills needs a browser; QA only needs the paths and the blank-frame stats.
vi.mock('../src/motion/exportFrames', async (actual) => ({ ...(await actual<object>()), renderMotionStill: vi.fn(async (project: unknown) => project) }));
vi.mock('../src/lib/htmlFrames', () => ({ renderHtmlStill: vi.fn(async (project: unknown) => project) }));
vi.mock('../src/lib/polish', async (actual) => ({ ...(await actual<object>()), frameStats: vi.fn(async () => null) }));

import { api } from '../src/lib/ipc';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { collectQaLayers } from '../src/lib/polish';
import { frameQa } from '../src/lib/production';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import { retryNote, workflowInstruction } from '../src/chat/ChatPanel';
import type { Asset, Project } from '../src/lib/types';

function harness(project: Project, assets: Asset[]) {
  let current = project;
  const host = {
    history: {
      current: () => current,
      commit: (change: (p: Project) => Project) => { current = change(current); },
    },
    assets: () => new Map(assets.map((asset) => [asset.id, asset])),
    selection: () => [],
    setSelection: vi.fn(),
  } as unknown as ToolHost;
  return { host, comp: () => current.comps[0] };
}

const footage = (id: string, width: number, height: number) =>
  ({ id, name: id + '.mp4', kind: 'video', duration: 60, width, height, hasAudio: true }) as Asset;

beforeEach(() => vi.clearAllMocks());

describe('run_frame_qa contact frames', () => {
  /** A full-frame shot, then from 5 s the same shot reduced with nothing behind it (black edges at 5.0). */
  function fixture() {
    const project = newProject();
    const comp = project.comps[0];
    const video = tracksOf(comp, 'video')[0].id;
    const reduced = newClip({ trackId: video, start: 5, duration: 5, source: { type: 'media', assetId: 'cam' } });
    reduced.transform = { ...reduced.transform, scale: 50 };
    comp.clips = [newClip({ trackId: video, start: 0, duration: 5, source: { type: 'media', assetId: 'cam' } }), reduced];
    vi.mocked(api.mogrtFramesBegin).mockResolvedValue('qa-dir');
    vi.mocked(api.exportFrame).mockImplementation(async (_p, _c, _t, path) => path);
    return harness(project, [footage('cam', 1920, 1080)]);
  }

  it('attaches at most four frames, problem moments first', async () => {
    const { host } = fixture();
    vi.mocked(api.chatReadImages).mockImplementation(async (paths: string[]) => paths.map(() => 'img'));
    const result = await runTool(host, 'run_frame_qa', {});
    expect(result.ok, String(result.error)).toBe(true);
    // 12 spread stills plus the problem moment at 5.0.
    expect(api.exportFrame).toHaveBeenCalledTimes(13);
    const attached = vi.mocked(api.chatReadImages).mock.calls[0][0];
    expect(attached.length).toBeLessThanOrEqual(4);
    expect(result.times).toContain(5);
  });

  it('says honestly that checked frames could not be attached', async () => {
    const { host } = fixture();
    vi.mocked(api.chatReadImages).mockRejectedValue(new Error('vision payload too large'));
    const result = await runTool(host, 'run_frame_qa', {});
    expect(result.ok, String(result.error)).toBe(true);
    expect(result.summary).not.toContain('blank frames were not checked');
    expect(result.summary).toContain('could not be attached (vision payload too large)');
  });
});

describe('level_audio', () => {
  it('patches the gains onto the comp as it is after measuring, keeping edits made meanwhile', async () => {
    const project = newProject();
    const comp = project.comps[0];
    const voice = newClip({ trackId: tracksOf(comp, 'audio')[0].id, start: 0, duration: 8, source: { type: 'media', assetId: 'voice' } });
    const shot = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 4, source: { type: 'media', assetId: 'cam' } });
    comp.clips = [voice, shot];
    const { host, comp: live } = harness(project, [footage('cam', 1920, 1080), { id: 'voice', name: 'voice.wav', kind: 'audio', duration: 8, hasAudio: true } as Asset]);
    vi.mocked(api.audioLoudness).mockImplementation(async () => {
      // The user drags the shot while the loudness is measured.
      host.history.commit((p) => ({ ...p, comps: p.comps.map((c) => ({ ...c, clips: c.clips.map((x) => (x.id === shot.id ? { ...x, start: 3 } : x)) })) }));
      return { integratedLufs: -26, rangeLu: 6, truePeakDb: -12, duration: 8 };
    });
    const result = await runTool(host, 'level_audio', {});
    expect(result.ok, String(result.error)).toBe(true);
    expect(live().clips.find((c) => c.id === shot.id)!.start).toBe(3);
    expect(live().clips.find((c) => c.id === voice.id)!.volume).toBeCloseTo(10 ** (10 / 20), 6);
  });
});

describe('create_motion_graphic', () => {
  it('refuses a stat-callout without a real metric', async () => {
    const { host, comp } = harness(newProject(), []);
    const result = await runTool(host, 'create_motion_graphic', { template: 'stat-callout', title: 'Revenue' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('real, verified metric');
    expect(comp().clips).toHaveLength(0);
  });
});

describe('layout_clip in a 9:16 comp', () => {
  const slots = ['left-55', 'right-55', 'top-55', 'bottom-55', 'pip-bottom-right', 'pip-bottom-left', 'pip-top-right', 'pip-top-left', 'centre-small', 'full'];
  function portrait(width: number, height: number) {
    const project = newProject();
    const comp = project.comps[0];
    comp.width = 1080;
    comp.height = 1920;
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 6, source: { type: 'media', assetId: 'cam' } });
    comp.clips = [clip];
    const asset = footage('cam', width, height);
    return { ...harness(project, [asset]), clip, asset };
  }

  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    it('keeps every slot of ' + width + 'x' + height + ' footage inside the social safe area', async () => {
      for (const slot of slots) {
        const { host, comp, clip, asset } = portrait(width, height);
        const result = await runTool(host, 'layout_clip', { clipId: clip.id, slot, animate: false });
        expect(result.ok, slot + ': ' + String(result.error)).toBe(true);
        const layers = await collectQaLayers(host.history.current(), new Map([[asset.id, asset]]), comp(), [1], { rotoSubjects: async () => null });
        const issues = frameQa(comp(), layers, [1]).filter((issue) => issue.kind === 'outside-safe' || issue.kind === 'off-frame');
        expect(issues, slot).toEqual([]);
      }
    });
  }

  it('stacks the side slots: left-55 frees the bottom, not the right side', async () => {
    const { host, clip } = portrait(1920, 1080);
    const result = await runTool(host, 'layout_clip', { clipId: clip.id, slot: 'left-55', animate: false });
    expect(result.ok).toBe(true);
    expect(result.summary).not.toContain('right side is free');
    expect(result.freeSide).toBe('bottom');
  });
});

describe('set_keyframes', () => {
  function keyed() {
    const project = newProject();
    const comp = project.comps[0];
    const clip = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 4, source: { type: 'media', assetId: 'cam' } });
    clip.keyframes = { ...clip.keyframes, x: [{ time: 0, value: 0.1, easing: 'linear' }, { time: 1, value: 0.2, easing: 'linear' }] };
    comp.clips = [clip];
    const h = harness(project, [footage('cam', 1920, 1080)]);
    return { ...h, keys: () => h.comp().clips[0].keyframes.x, clipId: clip.id };
  }

  it('refuses motion-engine keys and leaves the existing ones', async () => {
    const f = keyed();
    const result = await runTool(f.host, 'set_keyframes', { clipId: f.clipId, property: 'x', keyframes: [{ t: 0, v: 1 }] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('keyframes[0] needs numeric time and value');
    expect(f.keys()).toHaveLength(2);
  });

  it('refuses a missing array and an unknown easing', async () => {
    const f = keyed();
    expect((await runTool(f.host, 'set_keyframes', { clipId: f.clipId, property: 'x' })).ok).toBe(false);
    expect((await runTool(f.host, 'set_keyframes', { clipId: f.clipId, property: 'x', keyframes: [{ time: 0, value: 1, easing: 'bounce' }] })).ok).toBe(false);
    expect(f.keys()).toHaveLength(2);
  });

  it('reads numeric strings as numbers', async () => {
    const f = keyed();
    const result = await runTool(f.host, 'set_keyframes', { clipId: f.clipId, property: 'x', keyframes: [{ time: '0', value: '1.2' }] });
    expect(result.ok, String(result.error)).toBe(true);
    expect(f.keys()).toEqual([{ time: 0, value: 1.2, easing: 'linear' }]);
  });

  it('clears on an explicit empty array', async () => {
    const f = keyed();
    const result = await runTool(f.host, 'set_keyframes', { clipId: f.clipId, property: 'x', keyframes: [] });
    expect(result.ok).toBe(true);
    expect(f.keys()).toEqual([]);
  });
});

describe('run_command output', () => {
  it('keeps only the last 12 KB and says how much was cut', async () => {
    const { host } = harness(newProject(), []);
    const stdout = 'x'.repeat(1024 * 1024 - 3) + 'end';
    vi.mocked(api.fsRunCommand).mockResolvedValue({ exitCode: 0, stdout, stderr: '', durationMs: 5 });
    const result = await runTool(host, 'run_command', { command: 'dump' });
    expect(result.ok).toBe(true);
    expect(new TextEncoder().encode(result.stdout as string).length).toBeLessThanOrEqual(12 * 1024);
    expect((result.stdout as string).endsWith('end')).toBe(true);
    expect(result.stdoutTruncated).toBe(1024 * 1024 - 12 * 1024);
    expect(result.stderrTruncated).toBeUndefined();
    expect(result.summary).toContain('read_file a range');
  });
});

describe('storyboard graphics', () => {
  function planning() {
    const project = newProject();
    const comp = project.comps[0];
    comp.clips = [newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 12, source: { type: 'media', assetId: 'cam' } })];
    return harness(project, [footage('cam', 1920, 1080)]);
  }
  const visual = 'Punch-in from 100 to 112 percent on the talking head at the cut, kinetic title lower third, roto foreground kept clean with soft matte edges and depth behind';
  const audio = 'Dialogue stays forward, music bed ducks minus 16 dB under speech with a whoosh into the cut and a short riser';
  const evidence = 'Transcript: "welcome back" at 0.2s; frames show a centered subject with free negative space on the right';
  const scenes = (template: string) => [
    { start: 0, end: 6, intent: 'Hook the viewer with the core promise of this video', visual, audio, evidence, mogrt: { template, headline: 'Write less' } },
    { start: 6, end: 12, intent: 'Pay off the hook with the first concrete demonstration', visual, audio, evidence },
  ];

  it('accepts a brand/engine template for a beat', async () => {
    const { host, comp } = planning();
    const result = await runTool(host, 'save_storyboard', { scenes: scenes('brand-title') });
    expect(result.ok, String(result.error)).toBe(true);
    expect(comp().storyboard?.[0].mogrt?.template).toBe('brand-title');
  });

  it('rejects a template that does not exist', async () => {
    const { host } = planning();
    const result = await runTool(host, 'save_storyboard', { scenes: scenes('no-such-template') });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('"no-such-template" is not a template');
  });
});

describe('per-turn instructions', () => {
  it('plan and gather turns are told to finish their phase, not to verify', () => {
    for (const phase of ['planning', 'plan-ready', 'gathering', 'gathered']) {
      const text = workflowInstruction({ phase });
      expect(text).not.toContain('verify_edit_workflow');
      expect(text).toContain('end your turn');
    }
    expect(workflowInstruction({ phase: 'editing' })).toContain('verify_edit_workflow');
    expect(workflowInstruction(null)).toContain('verify_edit_workflow');
  });

  it('a retried plan turn continues the plan', () => {
    const run = { callId: 'c', name: 'online_research', request: '', summary: '', status: 'done' as const, at: 1, ms: 1 };
    const plan = retryNote({ content: '', steps: [] }, [run], { phase: 'planning' });
    expect(plan).toContain('PLAN phase');
    expect(plan).not.toContain('verify_edit_workflow');
    expect(retryNote({ content: '', steps: [] }, [run], { phase: 'editing' })).toContain('verify_edit_workflow');
  });
});

describe('the assistant undo tool', () => {
  const withSteps = (present: string, past: string[]) => {
    const undo = vi.fn();
    const host = { history: { current: () => newProject(), undo, steps: { present, past, future: [] } }, assets: () => new Map(), selection: () => [], setSelection: vi.fn() } as unknown as ToolHost;
    return { host, undo };
  };

  it('undoes only its own steps from the top of the history', async () => {
    const { host, undo } = withSteps('AI: add_text', ['Open', 'Trim', 'AI: place_clip']);
    const result = await runTool(host, 'undo', { steps: 5 });
    expect(result.ok).toBe(true);
    expect(undo).toHaveBeenCalledTimes(2);
    if (result.ok) expect(result.summary).toContain("user's own edit");
  });

  it("refuses when the latest step is the user's", async () => {
    const { host, undo } = withSteps('Ripple Delete', ['Open', 'AI: add_text']);
    const result = await runTool(host, 'undo', {});
    expect(result.ok).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});
