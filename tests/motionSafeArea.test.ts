import { describe, expect, it } from 'vitest';
import { fitToSafeArea, layoutIssues, safeMargins } from '../src/motion/safeArea';
import { evaluateMeasured } from '../src/motion/measure';
import { entryBounds } from '../src/motion/evaluate';
import { keys } from '../src/motion/anim';
import { MOTION_TEMPLATES } from '../src/motion/kit';
import { restingLayerBoxes } from '../src/lib/polish';
import { frameQa, type QaLayer } from '../src/lib/production';
import { newComp } from '../src/lib/timeline';
import type { Layer, MotionScene } from '../src/motion/types';

const W = 1920;
const H = 1080;

const scene: MotionScene = {
  version: 1, width: W, height: H, duration: 3,
  layers: [
    { id: 'stage', type: 'procedural', kind: 'crimson-stage' },
    { id: 'band', type: 'shape', shape: { shape: 'rect', size: [W * 1.2, 120], fill: '#fff' }, transform: { position: [W / 2, 900] } },
    // A panel that settles with its right third off the frame, and the words on it.
    { id: 'panel', name: 'Panel', type: 'shape', shape: { shape: 'rect', size: [700, 400], fill: '#222' }, transform: { position: keys<number[]>([0, [2600, 500], 'expo-out'], [0.6, [1750, 500]]) } },
    { id: 'words', name: 'Words', type: 'text', parent: 'panel', text: { text: 'Point one', size: 48 }, transform: { position: [350, 200] } },
    // Slides in from off frame and rests well inside: fine.
    { id: 'title', name: 'Title', type: 'text', text: { text: 'Hello', size: 90 }, transform: { position: keys<number[]>([0, [-400, 200], 'expo-out'], [0.5, [500, 200]]) } },
  ],
};

const boxOf = (s: MotionScene, id: string, t: number) => {
  const entry = evaluateMeasured(s, t).layers.find((l) => l.layer.id === id)!;
  return entryBounds(entry.matrix, entry.size)!;
};

describe('layoutIssues', () => {
  it('flags a panel that rests off frame, not an entrance or a full-width band', () => {
    const issues = layoutIssues(scene);
    expect(issues).toHaveLength(1);
    expect(issues[0].names.sort()).toEqual(['Panel', 'Words']);
    expect(issues[0].offFrame).toBe(true);
    expect(issues[0].overflow.right).toBeGreaterThan(200);
    expect(issues[0].fixable).toBe(true);
  });
});

describe('bleed', () => {
  it('leaves a layer that runs off the frame on purpose alone: no issue, no fit, no QA box', () => {
    const bleeding: MotionScene = { ...scene, layers: scene.layers.map((l) => (l.id === 'panel' || l.id === 'words' ? { ...l, bleed: true } as Layer : l)) };
    expect(layoutIssues(bleeding)).toEqual([]);
    const fitted = fitToSafeArea(bleeding);
    expect(fitted.moved).toEqual([]);
    expect(fitted.scene.layers.find((l) => l.id === 'panel')).toEqual(bleeding.layers.find((l) => l.id === 'panel'));
    expect(restingLayerBoxes(bleeding, 2).map((b) => b.layer.id)).not.toContain('panel');
  });
});

describe('fitToSafeArea', () => {
  it('moves the panel and its words back inside together', () => {
    const fitted = fitToSafeArea(scene);
    expect(fitted.remaining).toEqual([]);
    expect(fitted.moved).toHaveLength(1);
    const panel = boxOf(fitted.scene, 'panel', 2);
    expect(panel.x + panel.width).toBeLessThanOrEqual(W * 0.95 + 0.5);
    // The words keep their place on the panel.
    const before = { panel: boxOf(scene, 'panel', 2), words: boxOf(scene, 'words', 2) };
    const words = boxOf(fitted.scene, 'words', 2);
    expect(words.x - panel.x).toBeCloseTo(before.words.x - before.panel.x, 3);
    // The title is untouched.
    expect(fitted.scene.layers.find((l) => l.id === 'title')).toEqual(scene.layers.find((l) => l.id === 'title'));
  });

  it('shrinks a cluster wider than the safe area', () => {
    const wide: MotionScene = { ...scene, layers: [{ id: 'long', type: 'text', text: { text: 'A long headline that runs past both edges', size: 120 } }] };
    const fitted = fitToSafeArea(wide);
    expect(fitted.remaining).toEqual([]);
    const box = boxOf(fitted.scene, 'long', 1);
    expect(box.x).toBeGreaterThanOrEqual(W * 0.05 - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(W * 0.95 + 0.5);
  });

  it('leaves every built-in template inside the frame', () => {
    const footage = { asset: 'a1', matte: 'C:/roto/run/matte.mkv' };
    const failures: string[] = [];
    for (const spec of MOTION_TEMPLATES) {
      const params: Record<string, unknown> = { subject: footage, footage, plate: { asset: 'p1', kind: 'image' }, title: 'A title that is reasonably long', points: ['First point to make', 'Second point', 'Third one'] };
      let built: MotionScene;
      try { built = spec.build({ width: W, height: H }, params); } catch { continue; }
      const fitted = fitToSafeArea(built);
      const off = fitted.remaining.filter((issue) => issue.offFrame && issue.fixable);
      if (off.length) failures.push(`${spec.id}: ${off.map((issue) => issue.names.join('+')).join(', ')}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('safe area by orientation', () => {
  const params: Record<string, unknown> = { subject: { asset: 'a1', matte: 'C:/roto/run/matte.mkv' }, footage: { asset: 'a1', matte: 'C:/roto/run/matte.mkv' }, plate: { asset: 'p1', kind: 'image' }, title: 'A title that is reasonably long', points: ['First point to make', 'Second point', 'Third one'] };
  const built = (width: number, height: number) => MOTION_TEMPLATES.flatMap((spec) => {
    try { return [{ id: spec.id, scene: spec.build({ width, height }, params) }]; } catch { return []; }
  });

  /** What frame QA (run_frame_qa) says about every fitted template, as `template: layer` → the issue kinds and the layer. */
  function frameQaOf(width: number, height: number) {
    const comp = newComp({ name: 'QA', width, height, fps: 30 });
    const found = new Map<string, { kinds: Set<string>; layer: Layer; box: { width: number; height: number } }>();
    for (const { id, scene: raw } of built(width, height)) {
      const scene = fitToSafeArea(raw).scene;
      const times: number[] = [];
      for (let t = 0.1; t < scene.duration; t += 0.25) times.push(Math.round(t * 1000) / 1000);
      const boxes = times.flatMap((t) => restingLayerBoxes(scene, t).map((entry) => ({ ...entry, t })));
      const layers: QaLayer[] = boxes.map(({ layer, box, behind, t }) => ({ clipId: id, group: id, name: layer.id, kind: layer.type === 'text' ? 'text' : 'graphic', box, from: t, to: t + 1e-3, behind }));
      for (const issue of frameQa(comp, layers, times)) {
        if (issue.kind !== 'outside-safe' && issue.kind !== 'off-frame') continue;
        const entry = boxes.find((box) => box.layer.id === issue.a)!;
        const key = `${id}: ${issue.a}`;
        found.set(key, { kinds: new Set([...(found.get(key)?.kinds ?? []), issue.kind]), layer: entry.layer, box: entry.box });
      }
    }
    return found;
  }

  it('keeps the 16:9 fit exactly as it was (5% at the sides, 6% top and bottom)', () => {
    for (const { scene } of built(W, H)) expect(fitToSafeArea(scene).scene).toEqual(fitToSafeArea(scene, { margin: { x: 0.05, y: 0.06 } }).scene);
  }, 60_000);

  it('fits a 9:16 frame to the social margins frame QA checks, so fitted templates pass it', () => {
    const wide = frameQaOf(W, H);
    const tall = frameQaOf(1080, 1920);
    const failures = [...tall].filter(([key, { kinds, layer, box }]) => {
      if (!kinds.has('outside-safe')) return false;
      // Already flagged at 16:9: the full-width ribbons, streaks and the dock cursor.
      if (wide.has(key)) return false;
      // Full-width or full-height bands bleed by design, and decorative shapes are never moved, in any orientation.
      if (box.width >= 0.9 || box.height >= 0.9) return false;
      return layer.type === 'text' || layer.type === 'footage' || layer.type === 'precomp';
    }).map(([key]) => key);
    expect(failures).toEqual([]);
  }, 60_000);

  it('takes per-side margins', () => {
    const tall: MotionScene = {
      version: 1, width: 1080, height: 1920, duration: 2,
      layers: [{ id: 'lower', name: 'Lower third', type: 'text', text: { text: 'Name here', size: 80 }, transform: { position: [540, 1750] } }],
    };
    const box = (s: MotionScene) => boxOf(s, 'lower', 1);
    // The default for a tall frame keeps it above the bottom 18%, where the platform puts its buttons.
    expect(box(tall).y + box(tall).height).toBeGreaterThan(1920 * 0.82);
    const fitted = fitToSafeArea(tall).scene;
    expect(box(fitted).y + box(fitted).height).toBeLessThanOrEqual(1920 * 0.82 + 0.5);
    // Margins given side by side are used as given.
    expect(box(fitToSafeArea(tall, { margin: { top: 0.06, bottom: 0.06, left: 0.05, right: 0.05 } }).scene)).toEqual(box(tall));
    expect(layoutIssues(tall, { margin: { top: 0.1, bottom: 0.05, left: 0.05, right: 0.05 } })).toEqual([]);
    expect(layoutIssues(tall, { margin: { top: 0.05, bottom: 0.18, left: 0.05, right: 0.05 } })[0].overflow.bottom).toBeGreaterThan(0);
    expect(safeMargins(tall)).toEqual({ top: 0.12, bottom: 0.18, left: 0.06, right: 0.06 });
    expect(safeMargins({ width: W, height: H })).toEqual({ top: 0.06, bottom: 0.06, left: 0.05, right: 0.05 });
    expect(safeMargins(tall, 0.1)).toEqual({ top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 });
  });
});
