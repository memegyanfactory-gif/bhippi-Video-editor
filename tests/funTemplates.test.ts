import { describe, expect, it } from 'vitest';
import { FX_TEMPLATES } from '../src/lib/roast/types';
import { SYSTEM_FONTS } from '../src/lib/brandKit/build';
import { MOTION_TEMPLATES, findTemplate } from '../src/motion/kit';
import { FUN_TEMPLATES, buildFunFx } from '../src/motion/kit/funTemplates';
import { evaluateScene } from '../src/motion/evaluate';
import { validateScene } from '../src/motion/validate';
import type { Layer, MotionScene } from '../src/motion/types';

const LAND = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const colours = (scene: MotionScene) => JSON.stringify(scene).match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? [];

describe('@funny overlay FX templates', () => {
  it('registers exactly the contract ids in the motion kit', () => {
    expect(FUN_TEMPLATES.map((spec) => spec.id)).toEqual([...FX_TEMPLATES]);
    for (const id of FX_TEMPLATES) {
      expect(findTemplate(id), id).toBeTruthy();
      expect(MOTION_TEMPLATES.filter((spec) => spec.id === id)).toHaveLength(1);
    }
    for (const spec of FUN_TEMPLATES) {
      expect(spec.fullFrame, spec.id).toBe(false);
      expect(spec.use.length, spec.id).toBeGreaterThan(60);
      expect(Object.keys(spec.params)).toEqual(expect.arrayContaining(['tint', 'density', 'seconds', 'seed']));
    }
  });

  it('builds valid transparent scenes with their defaults, wide and tall', () => {
    for (const spec of FUN_TEMPLATES) {
      for (const ctx of [LAND, TALL]) {
        const scene = spec.build(ctx, {});
        expect(validateScene(scene), `${spec.id} ${ctx.width}x${ctx.height}`).toEqual([]);
        expect(scene.background ?? null).toBeNull();
        expect(scene.width).toBe(ctx.width);
        expect(scene.height).toBe(ctx.height);
        expect(scene.duration).toBe(spec.seconds);
        expect(scene.template?.id).toBe(spec.id);
        expect(scene.layers.length, spec.id).toBeGreaterThan(3);
        expect(scene.layers.length, spec.id).toBeLessThanOrEqual(96);
        expect(scene.cues?.length, spec.id).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every layer to finite numbers across the clip', () => {
    for (const spec of FUN_TEMPLATES) {
      const scene = spec.build(LAND, {});
      for (const t of [0, scene.duration * 0.3, scene.duration * 0.7, scene.duration - 0.01]) {
        const frame = evaluateScene(scene, t);
        for (const entry of frame.layers) {
          expect([...entry.matrix].every(Number.isFinite), `${spec.id} ${entry.layer.id} @${t}`).toBe(true);
          expect(Number.isFinite(entry.opacity), `${spec.id} ${entry.layer.id} @${t}`).toBe(true);
        }
      }
      // Something is on screen in the middle of it.
      const mid = evaluateScene(scene, scene.duration * 0.45);
      expect(mid.layers.some((entry) => entry.active && entry.opacity > 0.2), spec.id).toBe(true);
    }
  });

  it('is deterministic: the same params build the same scene, another seed another scatter', () => {
    for (const id of FX_TEMPLATES) {
      const a = buildFunFx(id, LAND, { seed: 3 });
      const b = buildFunFx(id, LAND, { seed: 3 });
      expect(a, id).toEqual(b);
      const c = buildFunFx(id, LAND, { seed: 4 });
      expect(JSON.stringify(c.layers), id).not.toEqual(JSON.stringify(a.layers));
    }
  });

  it('takes seconds (or duration), density, tint and origin', () => {
    for (const id of FX_TEMPLATES) {
      expect(buildFunFx(id, LAND, { seconds: 4 }).duration, id).toBe(4);
      expect(buildFunFx(id, LAND, { duration: 3.2 }).duration, id).toBe(3.2);
      expect(validateScene(buildFunFx(id, LAND, { seconds: 6, density: 2.5 })), id).toEqual([]);
    }
    for (const id of ['fx-money-rain', 'fx-hearts-burst', 'fx-embers', 'fx-confetti', 'fx-spotlight'] as const) {
      const few = buildFunFx(id, LAND, { density: 0.5 }).layers.length;
      const many = buildFunFx(id, LAND, { density: 2 }).layers.length;
      expect(many, id).toBeGreaterThan(few);
    }
    expect(colours(buildFunFx('fx-hearts-burst', LAND, { tint: '#3366ff' }))).toContain('#3366ff');
    expect(colours(buildFunFx('fx-embers', LAND, { tint: '#22aaff' })).join()).toContain('#22aaff');
    // Speed lines converge on the origin (fractions or pixels).
    const lines = buildFunFx('fx-speed-lines', LAND, { origin: [0.3, 0.4] }).layers.find((l) => l.id === 'lines-0')!;
    expect(lines.transform?.position).toEqual([576, 432]);
    const px = buildFunFx('fx-speed-lines', LAND, { origin: [576, 432] }).layers.find((l) => l.id === 'lines-0')!;
    expect(px.transform?.position).toEqual([576, 432]);
    const heart = buildFunFx('fx-hearts-burst', LAND, { origin: [0.25, 0.5] }).layers.find((l) => l.id === 'heart-0')!;
    expect((heart.transform?.position as { v: number[] }).v).toEqual([480, 540]);
  });

  it('only uses system fonts for its type', () => {
    for (const spec of FUN_TEMPLATES) {
      const texts = spec.build(LAND, {}).layers.filter((l): l is Extract<Layer, { type: 'text' }> => l.type === 'text');
      for (const t of texts) expect(SYSTEM_FONTS, `${spec.id} ${t.id}`).toContain(t.text.font);
    }
  });

  it('flickers the speed lines one drawing at a time at 12 fps', () => {
    const scene = buildFunFx('fx-speed-lines', LAND, {});
    for (const t of [0.3, 0.38, 0.47, 0.9]) {
      const shown = evaluateScene(scene, t).layers.filter((entry) => entry.layer.id.startsWith('lines-') && entry.opacity > 0.01);
      expect(shown, `t=${t}`).toHaveLength(1);
    }
  });
});
