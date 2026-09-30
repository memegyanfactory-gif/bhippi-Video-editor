import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { applyFinish, bloomShare, carryFinish, FINISH_LAYER, finishEffects, finishLayer, finishOf, readFinish, toneOf } from '../src/motion/finish';
import { validateScene } from '../src/motion/validate';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { logicalScene } from '../src/lib/motionStack';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Effect, Layer, MotionScene } from '../src/motion/types';

const W = 1920;
const H = 1080;
/** Rec. 709 luma of an sRGB colour, in 8-bit levels. */
const luma = (rgb: number[]) => 255 * (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
const grey = (level: number) => [level / 255, level / 255, level / 255];
const DARK_TONE = () => finishEffects({ preset: 'launch-dark' }).find((e) => e.type === 'exposure') as Effect & Parameters<typeof toneOf>[1];

const uiScene = (): MotionScene => ({
  version: 1, width: W, height: H, duration: 3,
  layers: [
    { id: 'stage', type: 'procedural', kind: 'radial-glow' },
    { id: 'plate', type: 'solid', color: '#f7f5f1', size: [W, H] },
    { id: 'panel', name: 'Settings panel', type: 'shape', shape: { shape: 'rect', size: [640, 420], radius: 24, fill: '#ffffff' } },
    { id: 'dot', type: 'shape', shape: { shape: 'ellipse', size: [40, 40], fill: '#ff8a24' } },
    { id: 'title', type: 'text', text: { text: 'Meet Bhippi' } },
    { id: 'composer', name: 'Composer', type: 'footage', source: { path: 'C:/AI Work/ui-parts/launch/composer-typing.png', kind: 'image' } },
    { id: 'inner', type: 'precomp', scene: { version: 1, width: W, height: H, duration: 2, layers: [{ id: 'card', type: 'shape', shape: { shape: 'rect', size: [500, 300], radius: 18, fill: '#ffffff' } }] } },
  ],
});
const shadowOn = (layer: Layer) => !!layer.effects?.some((e) => e.type === 'drop-shadow' && e.finish);

describe('finish presets', () => {
  it('launch-dark: exposure in linear light under a shoulder, bloom on colour only, a 10% vignette, moving grain', () => {
    const effects = finishEffects({ preset: 'launch-dark' });
    expect(effects.map((e) => e.type)).toEqual(['exposure', 'glow', 'vignette', 'grain']);
    expect(effects[0]).toMatchObject({ exposure: 0.7, linear: true, knee: 0.45, ceiling: 0.8 });
    expect(effects[1]).toMatchObject({ threshold: 0.7, knee: 0.2, intensity: 0.32, saturationWeight: 1 });
    expect(effects[2]).toMatchObject({ amount: 0.1 });
    expect(effects[3]).toMatchObject({ animated: true });
  });

  it('launch-light: only a static fine grain (1.1/255), no bloom and no vignette', () => {
    const effects = finishEffects({ preset: 'launch-light' });
    expect(effects.map((e) => e.type)).toEqual(['grain']);
    expect(effects[0].animated).toBe(false);
    // The shader's noise is triangular (σ ≈ 0.41) × amount × 0.25: 1.1 levels of σ.
    expect((effects[0].amount as number) * 0.25 * 0.408 * 255).toBeCloseTo(1.1, 2);
  });

  it('keeps white UI white and lifts a murky frame into the readable range (the 15 s film\'s numbers)', () => {
    const tone = DARK_TONE();
    // UI whites stay at 230 or above, and white gets no bloom at all.
    expect(luma(toneOf([1, 1, 1], tone))).toBeGreaterThanOrEqual(230);
    expect(bloomShare([1, 1, 1], 0.7, 0.2, 1) * 0.32 * 255).toBeLessThan(3);
    expect(bloomShare(grey(235), 0.7, 0.2, 1)).toBe(0);
    // Saturated ember still blooms; with no saturation weight white would bloom fully (the old glow).
    expect(bloomShare([1, 0.54, 0.14], 0.7, 0.2, 1)).toBeGreaterThan(0.5);
    expect(bloomShare([1, 1, 1], 0.7, 0.2, 0)).toBe(1);
    // A dark frame at mean luma 30 lands in 45–60; the one at 21 the critics could not read gets well above it.
    const lifted = luma(toneOf(grey(30), tone));
    expect(lifted).toBeGreaterThanOrEqual(45);
    expect(lifted).toBeLessThanOrEqual(60);
    expect(luma(toneOf(grey(21), tone))).toBeGreaterThan(35);
    // Hue holds through the shoulder: ember stays ember.
    const ember = toneOf([1, 0.54, 0.14], tone);
    expect(ember[0]).toBeGreaterThan(ember[1]);
    expect(ember[1]).toBeGreaterThan(ember[2]);
    // Order is kept: nothing crosses over.
    const ramp = [10, 40, 90, 140, 200, 250].map((v) => luma(toneOf(grey(v), tone)));
    expect([...ramp].sort((a, b) => a - b)).toEqual(ramp);
  });

  it('is one adjustment layer on top of the scene; switching presets or "none" leaves nothing behind', () => {
    const base = uiScene();
    const light = applyFinish(base, { preset: 'launch-light' });
    expect(validateScene(light)).toEqual([]);
    const top = light.layers[light.layers.length - 1];
    expect(top).toMatchObject({ id: FINISH_LAYER, type: 'solid', adjustment: true, name: 'Finish · launch-light', size: [W, H] });
    expect(finishOf(light)).toBe('launch-light');
    // Warm soft shadows under the UI cards only: the panel, the captured part and the card inside a precomp.
    const shadowed = light.layers.filter(shadowOn).map((l) => l.id);
    expect(shadowed).toEqual(['panel', 'composer']);
    const inner = (light.layers.find((l) => l.id === 'inner') as Extract<Layer, { type: 'precomp' }>).scene.layers[0];
    expect(shadowOn(inner)).toBe(true);
    expect(light.layers.find((l) => l.id === 'panel')!.effects![0]).toMatchObject({ color: '#462814', direction: 180 });
    const dark = applyFinish(light, { preset: 'launch-dark' });
    expect(dark.layers.filter((l) => l.id === FINISH_LAYER)).toHaveLength(1);
    expect(dark.layers.some(shadowOn)).toBe(false);
    expect(finishOf(dark)).toBe('launch-dark');
    expect(applyFinish(dark, 'none')).toEqual(base);
    expect(applyFinish(applyFinish(base, { preset: 'launch-light' }), 'none')).toEqual(base);
  });

  it('takes per-film overrides, and reads what a tool call sends', () => {
    const layer = finishLayer({ preset: 'launch-dark', exposure: 0.4, vignette: 0, bloom: 0.2 }, W, H);
    expect(layer.effects!.map((e) => e.type)).toEqual(['exposure', 'glow', 'grain']);
    expect(layer.effects![0].exposure).toBe(0.4);
    expect(readFinish('launch-dark')).toEqual({ preset: 'launch-dark' });
    expect(readFinish({ preset: 'launch-light', grain: 99, cardShadow: false, shadowColor: 'brown' })).toEqual({ preset: 'launch-light', grain: 12, cardShadow: false });
    expect(readFinish('none')).toBe('none');
    expect(readFinish('cinematic')).toBeNull();
    expect(readFinish({ exposure: 1 })).toBeNull();
  });

  it('a rebuilt scene keeps its finish, with the user\'s changes to it', () => {
    const finished = applyFinish(uiScene(), { preset: 'launch-light' });
    const edited = { ...finished, layers: finished.layers.map((l) => (l.id === FINISH_LAYER ? { ...l, effects: [{ ...l.effects![0], amount: 0.2 }] } : l)) };
    const rebuilt = carryFinish(edited, uiScene());
    expect(rebuilt.layers[rebuilt.layers.length - 1].effects![0].amount).toBe(0.2);
    expect(rebuilt.layers.filter(shadowOn).map((l) => l.id)).toEqual(['panel', 'composer']);
    expect(carryFinish(uiScene(), uiScene())).toEqual(uiScene());
  });
});

describe('update_motion_scene finish', () => {
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

  it('puts the finish on a layered comp as its own editable layer clip, keeps it through a rebuild, and takes it off', async () => {
    const { ctx, get } = harness(newProject());
    const made = await runMotionTool('create_motion_scene', { template: 'glass-mark', params: { wordmark: 'Bhippi' }, title: 'Mark' }, ctx) as { ok: boolean; error?: string; compId: string };
    expect(made.error).toBeUndefined();
    const comp = () => get().comps.find((c) => c.id === made.compId)!;
    const finished = await runMotionTool('update_motion_scene', { compId: made.compId, finish: 'launch-dark' }, ctx) as { ok: boolean; error?: string; summary: string };
    expect(finished.error).toBeUndefined();
    expect(finished.summary).toContain('launch-dark');
    let scene = logicalScene(get(), comp())!;
    expect(scene.layers[scene.layers.length - 1]).toMatchObject({ id: FINISH_LAYER, adjustment: true });
    expect(comp().clips.some((clip) => clip.name === 'Finish · launch-dark')).toBe(true);
    // New words rebuild the template; the finish stays on top.
    const rebuilt = await runMotionTool('update_motion_scene', { compId: made.compId, params: { wordmark: 'Bhippi Studio' } }, ctx) as { ok: boolean; error?: string };
    expect(rebuilt.error).toBeUndefined();
    scene = logicalScene(get(), comp())!;
    expect(scene.layers[scene.layers.length - 1].id).toBe(FINISH_LAYER);
    const off = await runMotionTool('update_motion_scene', { compId: made.compId, finish: 'none' }, ctx) as { ok: boolean; error?: string };
    expect(off.error).toBeUndefined();
    expect(logicalScene(get(), comp())!.layers.some((l) => l.id === FINISH_LAYER)).toBe(false);
    const bad = await runMotionTool('update_motion_scene', { compId: made.compId, finish: 'teal-orange' }, ctx) as { ok: boolean; error?: string };
    expect(bad.error).toContain('launch-light');
  });
});
