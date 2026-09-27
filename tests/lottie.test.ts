import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []), uiScreenSave: vi.fn(async (s: string, n: string) => `C:/p/${s}/${n}`) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
  fetchFile: (p: string) => fetch(p),
}));
const renders: unknown[] = [];
vi.mock('../src/motion/lottie/render', () => ({
  renderLottieFrames: vi.fn(async (json: { op: number }) => { renders.push(json); return { dir: 'C:/p/lottie_x', frames: json.op, fps: 30, width: 300, height: 300 }; }),
}));

import { ellipsePath, lottieToScene, rectPath } from '../src/motion/lottie/convert';
import { readLottie } from '../src/lib/lottieTools';
import { validateScene } from '../src/motion/validate';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Key, Layer } from '../src/motion/types';

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8'));
const native = load('lottie-native.json');
const morph = load('lottie-morph.json');

describe('Lottie → motion scene', () => {
  it('converts the native subset with nothing left over, into a valid scene of the file’s size and length', () => {
    const { scene, unsupported } = lottieToScene(native);
    expect(unsupported).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
    expect([scene.width, scene.height, scene.duration]).toEqual([400, 400, 2]);
    // Bottom to top in the engine: the frame (listed last in Lottie) first.
    expect(scene.layers.map((l) => l.name)).toEqual(['Frame', 'Ball', 'Mover']);
  });

  it('carries keys, their beziers, parenting and anchors over', () => {
    const { scene } = lottieToScene(native);
    const mover = scene.layers.find((l) => l.name === 'Mover')!;
    const keys = (mover.transform!.position as { k: Key<number[]>[] }).k;
    expect(keys.map((k) => [k.t, k.v])).toEqual([[0, [100, 300]], [1, [300, 120]], [2, [100, 300]]]);
    expect(keys[0].ease).toEqual([0.25, 0, 0, 1]);
    const ball = scene.layers.find((l) => l.name === 'Ball')!;
    expect(ball.parent).toBe(mover.id);
    expect(ball.type).toBe('shape');
    // Content around 0,0 is shifted into the layer; the anchor moves with it.
    const shift = ((ball as Layer & { type: 'shape' }).shape.groups![0].transform!.position as number[]);
    expect(ball.transform!.anchor).toEqual(shift);
  });

  it('trim offsets become percent, and rectangles/ellipses start where Lottie’s do', () => {
    expect(rectPath([0, 0], [100, 60], 0, false).startsWith('M50 -30 L50 30')).toBe(true);
    expect(rectPath([0, 0], [100, 60], 0, true).startsWith('M50 -30')).toBe(true);
    expect(ellipsePath([0, 0], [100, 100]).startsWith('M0 -50 C')).toBe(true);
  });

  it('names what it cannot reproduce (an animated path), so the importer renders instead', () => {
    expect(lottieToScene(morph).unsupported).toContain('animated paths');
    expect(lottieToScene({ ...native, layers: [{ ty: 5, ind: 9, ks: {} }, { ty: 4, ind: 1, ks: {}, tt: 1, shapes: [] }] }).unsupported).toEqual(expect.arrayContaining(['text layers', 'track mattes']));
  });

  it('reads .lottie zips as well as .json', () => {
    const zip = zipSync({ 'manifest.json': strToU8('{}'), 'animations/a.json': strToU8(JSON.stringify(morph)) });
    expect(readLottie(zip).nm).toBe('Bhippi test: morph');
    expect(readLottie(strToU8(JSON.stringify(native))).nm).toBe('Bhippi test: native');
  });
});

describe('import_lottie', () => {
  function harness(project: Project) {
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

  it('places native files as editable layers and renders the rest', async () => {
    const files: Record<string, unknown> = { 'native.json': native, 'morph.json': morph };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ arrayBuffer: async () => strToU8(JSON.stringify(files[url])).buffer })));
    const { ctx } = harness(newProject());
    const a = await runMotionTool('import_lottie', { path: 'native.json', start: 1 }, ctx) as { ok: boolean; native: boolean; summary: string; error?: string };
    expect(a.error).toBeUndefined();
    expect(a.native).toBe(true);
    expect(a.summary).toContain('editable layer');
    const b = await runMotionTool('import_lottie', { path: 'morph.json' }, ctx) as { ok: boolean; native: boolean; summary: string };
    expect(b.native).toBe(false);
    expect(b.summary).toContain('animated paths');
    expect(renders).toHaveLength(1);
    const forced = await runMotionTool('import_lottie', { path: 'native.json', mode: 'render' }, ctx) as unknown as { native: boolean };
    expect(forced.native).toBe(false);
    vi.unstubAllGlobals();
  });
});
