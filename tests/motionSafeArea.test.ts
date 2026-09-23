import { describe, expect, it } from 'vitest';
import { fitToSafeArea, layoutIssues } from '../src/motion/safeArea';
import { evaluateMeasured } from '../src/motion/measure';
import { entryBounds } from '../src/motion/evaluate';
import { keys } from '../src/motion/anim';
import { MOTION_TEMPLATES } from '../src/motion/kit';
import type { MotionScene } from '../src/motion/types';

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
