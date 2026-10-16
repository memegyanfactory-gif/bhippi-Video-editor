import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []), mixLoudness: vi.fn() },
  errorText: (e: unknown) => String(e instanceof Error ? e.message : e),
  fileSrc: (p: string) => p,
}));

import { runTool, type ToolHost } from '../src/lib/aiTools';
import { runProgram, clipIdList } from '../src/lib/editProgram';
import { closestGenre, runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { contactSheet } from '../src/lib/polish';
import { parseColor } from '../src/motion/gl/color';
import { expandIcons } from '../src/motion/vector/icons';
import { repairBrandKit } from '../src/lib/brandKit/build';
import { newClip, newProject, tracksOf, updateComp } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

beforeEach(() => vi.clearAllMocks());

function host(project: Project, assets: Asset[] = []) {
  let current = project;
  const h = {
    history: { current: () => current, commit: (change: (p: Project) => Project) => { current = change(current); }, view: (change: (p: Project) => Project) => { current = change(current); } },
    assets: () => new Map(assets.map((a) => [a.id, a])),
    selection: () => [],
    setSelection: vi.fn(),
  } as unknown as ToolHost;
  return { host: h, get: () => current };
}

function motionHarness(project: Project) {
  let current = project;
  const ctx = {
    get project() { return current; },
    assets: new Map(),
    commit: (change: (p: Project) => Project) => { current = change(current); },
    editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
    pickComp: (p: Project) => p.comps[0],
    current: () => current,
  } as unknown as MotionToolContext;
  return { ctx, get: () => current };
}

describe('update_motion_scene with a partial scene', () => {
  it('expandIcons and a scene without layers no longer throw "is not iterable"', async () => {
    const partial = { motionBlur: { samples: 16, shutter: 150 } } as unknown as MotionScene;
    await expect(expandIcons(partial)).resolves.toBe(partial);
  });

  it('applies {scene:{motionBlur}} on a layered motion comp', async () => {
    const { ctx, get } = motionHarness(newProject());
    const made = await runMotionTool('create_motion_scene', { template: 'glass-mark', params: { wordmark: 'Bhippi' }, title: 'Mark' }, ctx) as unknown as { error?: string; compId: string };
    expect(made.error).toBeUndefined();
    const result = await runMotionTool('update_motion_scene', { compId: made.compId, fit: false, scene: { motionBlur: { samples: 16, shutter: 150 } } }, ctx) as { ok: boolean; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(get().comps.length).toBeGreaterThan(1);
  });
});

describe('apply_edit clips and numbers as models send them', () => {
  it('reads clips as an array, one id, a comma list, {item:[…]} or {ids:[…]}', () => {
    expect(clipIdList(['a', 'b'])).toEqual(['a', 'b']);
    expect(clipIdList('a')).toEqual(['a']);
    expect(clipIdList('a, b')).toEqual(['a', 'b']);
    expect(clipIdList({ item: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(clipIdList({ ids: ['a'] })).toEqual(['a']);
    expect(clipIdList([{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
  });

  it('volume with clips as {item:[…]} and db as a string changes the volume', () => {
    const project = newProject();
    const comp = project.comps[0];
    const track = tracksOf(comp, 'video')[0].id;
    const clip = newClip({ trackId: track, start: 0, duration: 2, source: { type: 'media', assetId: 'x' } });
    comp.clips = [clip];
    const out = runProgram(project, new Map(), comp, { ops: [{ op: 'volume', clips: { item: [clip.id] }, db: '-8' } as never] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.comp.clips[0].volume).toBeCloseTo(10 ** (-8 / 20), 3);
  });

  it('volume with no usable clips says so', () => {
    const project = newProject();
    const out = runProgram(project, new Map(), project.comps[0], { ops: [{ op: 'volume', clips: {}, db: -3 } as never] });
    expect(out.ok).toBe(false);
  });
});

describe('brand kit tolerates what models send', () => {
  it('tokens as {item:[…]} and endCard as a string come back as lists', () => {
    const base = repairBrandKit({ name: 'K' })!.kit;
    const sent = { ...base, colors: { ...base.colors, tokens: { item: base.colors.tokens } }, social: { ...base.social, endCard: 'Follow us\nbhippi.com' } };
    const fixed = repairBrandKit(sent)!.kit;
    expect(Array.isArray(fixed.colors.tokens)).toBe(true);
    expect(fixed.social.endCard).toEqual(['Follow us', 'bhippi.com']);
    expect(() => fixed.colors.tokens.find((t) => t.role === 'accent')).not.toThrow();
  });
});

describe('parseColor', () => {
  it('reads objects and numbers instead of throwing "trim is not a function"', () => {
    expect(parseColor({ hex: '#ff0000' } as never)).toEqual([1, 0, 0, 1]);
    expect(() => parseColor(5 as never)).not.toThrow();
    expect(() => parseColor({} as never)).not.toThrow();
    expect(parseColor(undefined)).toEqual([0, 0, 0, 1]);
  });
});

describe('check_pacing', () => {
  it('returns a normal result (data must not carry its own ok) and maps a loose genre to the nearest', async () => {
    const project = newProject();
    const { ctx } = motionHarness(project);
    const result = await runMotionTool('check_pacing', { genre: 'launch-film' }, ctx) as { ok: boolean; error?: string; passed?: boolean };
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(typeof result.passed).toBe('boolean');
    const loose = await runMotionTool('check_pacing', { genre: 'motion' }, ctx) as { ok: boolean; summary: string };
    expect(loose.ok).toBe(true);
    expect(closestGenre('Launch Film')?.id).toBe('launch-film');
    const unknown = await runMotionTool('check_pacing', { genre: 'zzzz' }, ctx);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain('saas-explainer');
  });
});

describe('clip and comp errors say what they found', () => {
  const asset = { id: 'pic', name: 'pic.png', kind: 'image', duration: 5, width: 100, height: 100 } as Asset;

  function fixture() {
    const project = newProject();
    const comp = project.comps[0];
    const track = tracksOf(comp, 'video')[0].id;
    const image = newClip({ trackId: track, start: 0, duration: 2, source: { type: 'media', assetId: 'pic' } });
    comp.clips = [image];
    return { project, image, ...host(project, [asset]) };
  }

  it('inspect_clip_frames on an image or unknown id explains the kind', async () => {
    const { host: h, image } = fixture();
    const onImage = await runTool(h, 'inspect_clip_frames', { clipId: image.id });
    expect(onImage.ok).toBe(false);
    expect(onImage.error).toContain('is an image');
    const missing = await runTool(h, 'inspect_clip_frames', { clipId: 'nope' });
    expect(missing.error).toContain('No clip with id "nope"');
  });

  it('get_comp with a stale compId falls back to the active comp with a note; open_comp lists the comps', async () => {
    const { host: h } = fixture();
    const read = await runTool(h, 'get_comp', { compId: 'stale' }) as { ok: boolean; note?: string };
    expect(read.ok).toBe(true);
    expect(read.note).toContain('No comp "stale"');
    const open = await runTool(h, 'open_comp', { compId: 'stale' });
    expect(open.ok).toBe(false);
    expect(open.error).toContain('no comp with that id');
    expect(open.error).toContain('1 clip');
  });

  it('prefers the duplicate-named comp that has clips', async () => {
    const { project } = fixture();
    const real = project.comps[0];
    const phantom = { ...JSON.parse(JSON.stringify(real)), id: 'phantom', clips: [] };
    const second = host({ ...project, comps: [phantom, real] }, [asset]);
    const read = await runTool(second.host, 'get_comp', { compId: real.name }) as { ok: boolean };
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read)).toContain(real.id);
    expect(JSON.stringify(read)).not.toContain('"id":"phantom"');
  });

  it('get_motion_scene on an imported media clip names what it is', async () => {
    const { project, image } = fixture();
    const { ctx } = motionHarness(project);
    const result = await runMotionTool('get_motion_scene', { clipId: image.id }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('imported media');
  });
});

describe('contactSheet', () => {
  it('returns null for no rows instead of throwing', async () => {
    await expect(contactSheet([])).resolves.toBeNull();
  });
});
