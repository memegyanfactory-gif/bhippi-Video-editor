import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p, fetchFile: vi.fn() }));

import { pictureLed } from '../src/lib/council';
import { bestArrangement, panelSlots, type Box } from '../src/lib/layout';
import { planPanelLayout } from '../src/lib/panelLayout';
import { restingLayerBoxes } from '../src/lib/polish';
import { frameQa, type QaLayer } from '../src/lib/production';
import { newProject } from '../src/lib/timeline';
import type { Layer, MotionScene } from '../src/motion/types';

const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const inside = (a: Box, area: Box, eps = 1e-6) => a.x >= area.x - eps && a.y >= area.y - eps && a.x + a.width <= area.x + area.width + eps && a.y + a.height <= area.y + area.height + eps;
const AREA: Box = { x: 96, y: 65, width: 1728, height: 950 };

describe('panel slots', () => {
  for (const arrangement of ['row', 'column', 'grid', 'feature'] as const) {
    it(`${arrangement}: every panel keeps its shape, inside the area, none on another`, () => {
      const aspects = [16 / 9, 3.2, 0.7, 1.5];
      const slots = panelSlots(aspects, AREA, arrangement, 40);
      expect(slots).toHaveLength(4);
      slots.forEach((slot, i) => {
        expect(slot.width / slot.height).toBeCloseTo(aspects[i], 5);
        expect(inside(slot, AREA)).toBe(true);
        for (const other of slots.slice(i + 1)) expect(overlap(slot, other)).toBe(0);
      });
    });
  }

  it('picks the arrangement where the smallest panel reads largest', () => {
    // Three wide strips read best stacked; three tall cards read best side by side.
    expect(bestArrangement([4, 4, 4], AREA, 40)).toBe('column');
    expect(bestArrangement([0.5, 0.5, 0.5], AREA, 40)).toBe('row');
  });
});

const card = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Layer> = {}): Layer =>
  ({ id, name: id, type: 'footage', source: { path: `C:/ui/${id}.png`, kind: 'image', width: w * 2, height: h * 2 }, size: [w, h], transform: { position: [x, y] }, ...extra } as Layer);
const scene = (layers: Layer[], duration = 4): MotionScene => ({ version: 1, width: 1920, height: 1080, duration, layers });
/** Three screenshots piled into the middle of the frame, the way the Codex launch film stacked its panels. */
const stacked = () => scene([
  card('timeline', 960, 560, 1100, 420),
  card('program', 1060, 420, 760, 420),
  card('bin', 700, 500, 300, 440),
]);

/** Applies update_motion_scene-style patches (only the transform paths the layout writes). */
function applied(base: MotionScene, patches: { layer: string; path: string; value: unknown }[]): MotionScene {
  const copy = structuredClone(base);
  for (const patch of patches) {
    const layer = copy.layers.find((l) => l.id === patch.layer)!;
    const key = patch.path.split('.')[1] as 'position' | 'scale';
    layer.transform = { ...layer.transform, [key]: patch.value } as Layer['transform'];
  }
  return copy;
}

describe('layout_panels', () => {
  it('moves stacked screenshots into slots where none overlaps another, each its own shape', () => {
    const before = restingLayerBoxes(stacked(), 2);
    const shared = (list: typeof before) => list.flatMap((a, i) => list.slice(i + 1).map((b) => overlap(a.box, b.box))).reduce((sum, v) => sum + v, 0);
    expect(shared(before)).toBeGreaterThan(0);
    const plan = planPanelLayout(stacked());
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.panels).toHaveLength(3);
    const after = restingLayerBoxes(applied(stacked(), plan.patches), 2);
    expect(after).toHaveLength(3);
    expect(shared(after)).toBe(0);
    for (const { layer, box } of after) {
      const original = before.find((b) => b.layer.id === layer.id)!.box;
      expect((box.width * 1920) / (box.height * 1080)).toBeCloseTo((original.width * 1920) / (original.height * 1080), 2);
      // Positions are written to a hundredth of a pixel: half a pixel of slack.
      expect(inside(box, { x: 0.05, y: 0.06, width: 0.9, height: 0.88 }, 0.5 / 1080)).toBe(true);
    }
  });

  it('keeps an entrance: every position key shifts by the same amount', () => {
    const flyIn = scene([
      card('a', 960, 540, 900, 500, { transform: { position: { k: [{ t: 0, v: [960, 1400] }, { t: 0.6, v: [960, 540] }] } } }),
      card('b', 1000, 560, 900, 500),
    ]);
    const plan = planPanelLayout(flyIn, { arrangement: 'row' });
    if (typeof plan === 'string') throw new Error(plan);
    const moved = plan.patches.find((p) => p.layer === 'a' && p.path === 'transform.position')!.value as { k: { v: number[] }[] };
    expect(moved.k).toHaveLength(2);
    expect(moved.k[0].v[0] - 960).toBeCloseTo(moved.k[1].v[0] - 960, 5);
    expect(moved.k[0].v[1] - moved.k[1].v[1]).toBeCloseTo(1400 - 540, 5);
  });

  it('says when nothing rests to lay out', () => {
    expect(planPanelLayout(scene([{ id: 't', type: 'text', text: { text: 'Hi' } } as Layer]))).toMatch(/No pictures or cards rest/);
  });
});

describe('frame QA inside one scene', () => {
  const comp = newProject('qa').comps[0];
  const panel = (name: string, box: Box, key: string): QaLayer => ({ clipId: 'scene', group: 'scene', name, kind: 'graphic', box, from: 0, to: 1, panel: key });

  it('reports two pictures of one scene half on top of each other', () => {
    const issues = frameQa(comp, [panel('timeline', { x: 0.2, y: 0.4, width: 0.5, height: 0.35 }, 'a'), panel('program', { x: 0.4, y: 0.25, width: 0.4, height: 0.35 }, 'b')], [0.5]);
    expect(issues.some((issue) => issue.kind === 'graphic-overlap' && /half on top of each other/.test(issue.suggestion) && /layout_panels/.test(issue.suggestion))).toBe(true);
  });

  it('leaves a part that sits wholly inside its card, and type on a panel, alone', () => {
    const nested = frameQa(comp, [panel('card', { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 'a'), panel('button', { x: 0.5, y: 0.6, width: 0.1, height: 0.05 }, 'b')], [0.5]);
    expect(nested.filter((issue) => issue.kind === 'graphic-overlap')).toEqual([]);
    const title: QaLayer = { clipId: 'scene', group: 'scene', name: 'title', kind: 'text', box: { x: 0.3, y: 0.3, width: 0.4, height: 0.1 }, from: 0, to: 1 };
    expect(frameQa(comp, [panel('card', { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 'a'), title], [0.5]).filter((issue) => issue.kind === 'graphic-overlap')).toEqual([]);
  });

  it('opens a resting precomp and judges its layers where it draws them', () => {
    const beat = scene([card('panel', 960, 540, 800, 400)]);
    const outer = scene([{ id: 'beat', type: 'precomp', scene: beat, transform: { position: [960, 540], scale: 50 } } as Layer]);
    const boxes = restingLayerBoxes(outer, 1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].key).toBe('beat/panel');
    expect(boxes[0].box.width).toBeCloseTo(400 / 1920, 3);
    expect(boxes[0].box.x).toBeCloseTo((960 - 200) / 1920, 3);
  });
});

describe('a moving slideshow', () => {
  const slide = (id: string, from: number, to: number) => card(id, to, 540, 500, 300, { transform: { position: { k: [{ t: 0, v: [from, 540] }, { t: 0.8, v: [to, 540] }] } } });
  const lyric = { id: 'lyric', name: 'lyric', type: 'text', text: { text: 'Every move, you can undo', cascade: { stagger: 0.05 } } } as Layer;

  it('is screenshots sliding about while nothing in the interface acts', () => {
    expect(pictureLed(scene([slide('a', -300, 400), slide('b', 2200, 960), slide('c', 960, 1500), lyric]), new Map())).toBe(true);
  });

  it('is not when the interface acts inside: a recording plays, or a field types', () => {
    const recording = { id: 'live', type: 'footage', source: { path: 'C:/rec/recording.mp4', kind: 'video' }, size: [1200, 675] } as Layer;
    expect(pictureLed(scene([slide('a', -300, 400), slide('b', 2200, 960), slide('c', 960, 1500), recording]), new Map())).toBe(false);
    const typing = { id: 'field', type: 'text', text: { text: 'Make a launch film', type: { at: 1, cps: 20 } } } as Layer;
    expect(pictureLed(scene([slide('a', -300, 400), slide('b', 2200, 960), slide('c', 960, 1500), typing]), new Map())).toBe(false);
  });
});
