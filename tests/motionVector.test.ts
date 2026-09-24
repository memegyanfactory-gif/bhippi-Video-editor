import { describe, expect, it } from 'vitest';
import { flatten, parseSvgPath, pathBounds, pathLength, resample } from '../src/motion/vector/path';
import { isStaticShape, itemPaths, resolveTree, treeBounds } from '../src/motion/vector/shapes';
import { evaluateScene } from '../src/motion/evaluate';
import { validateScene } from '../src/motion/validate';
import type { MotionScene, ShapeItem } from '../src/motion/types';

const ctx = { seed: 1 };
const near = (a: number, b: number, eps = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('SVG path data', () => {
  it('parses absolute and relative lines, H/V and closes', () => {
    const [s] = parseSvgPath('M10 10 h80 v80 H10 z');
    expect(s.closed).toBe(true);
    expect(s.v.map((p) => [p.x, p.y])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
    const [r] = parseSvgPath('m5 5 l10 0 l0 10');
    expect(r.v.map((p) => [p.x, p.y])).toEqual([[5, 5], [15, 5], [15, 15]]);
  });
  it('keeps cubic handles and reflects S', () => {
    const [s] = parseSvgPath('M0 0 C10 0 20 10 20 20 S30 40 40 40');
    expect([s.v[0].ox, s.v[0].oy]).toEqual([10, 0]);
    expect([s.v[1].ix, s.v[1].iy]).toEqual([20, 10]);
    // S reflects the previous second handle about the current point: (20,20)*2-(20,10) = (20,30)
    expect([s.v[1].ox, s.v[1].oy]).toEqual([20, 30]);
  });
  it('turns quadratics and arcs into cubics that stay on the curve', () => {
    // A full circle from two arcs, radius 50 around (50,50).
    const paths = parseSvgPath('M0 50 A50 50 0 0 1 100 50 A50 50 0 0 1 0 50 Z');
    const box = pathBounds(paths)!;
    near(box.x, 0); near(box.y, 0); near(box.width, 100); near(box.height, 100);
    near(pathLength(paths), Math.PI * 100, 1);
    const q = pathBounds(parseSvgPath('M0 0 Q50 100 100 0'))!;
    near(q.height, 50);
  });
  it('reads the numbers of compact icon paths (Lucide style)', () => {
    const paths = parseSvgPath('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z');
    const box = pathBounds(paths)!;
    near(box.x, 4, 0.1); near(box.x + box.width, 20, 0.1);
    near(box.y, 2, 0.1); near(box.y + box.height, 22, 0.1);
  });
  it('reads packed arc flags and numbers the way icon sets write them', () => {
    // "a2 2 0 012 2" = rx 2, ry 2, rot 0, large 0, sweep 1, then 2 2; ".5.5" = 0.5 0.5
    const [s] = parseSvgPath('M0 0a2 2 0 012 2l.5.5');
    const last = s.v[s.v.length - 1];
    near(last.x, 2.5, 1e-6); near(last.y, 2.5, 1e-6);
    near(pathLength(parseSvgPath('M0 2a2 2 0 014 0')), Math.PI * 2, 0.05);
  });
  it('resamples by arc length', () => {
    const pts = resample([0, 0, 100, 0], false, 5);
    expect(pts).toEqual([0, 0, 25, 0, 50, 0, 75, 0, 100, 0]);
    expect(flatten(parseSvgPath('M0 0 L10 0'))[0].pts).toEqual([0, 0, 10, 0]);
  });
});

describe('shape trees', () => {
  it('builds primitives centred on their position, from the origin by default', () => {
    const rect = pathBounds(itemPaths({ kind: 'rect', size: [200, 100], radius: 20 }, 0, ctx))!;
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const ellipse = pathBounds(itemPaths({ kind: 'ellipse', size: [80, 40], position: [100, 100] }, 0, ctx))!;
    near(ellipse.x, 60); near(ellipse.width, 80); near(ellipse.height, 40);
    const star = itemPaths({ kind: 'star', size: [100, 100], sides: 5 }, 0, ctx)[0];
    expect(star.v).toHaveLength(10);
  });
  it('applies group transforms (anchor, position, scale, rotation) and inherits paint', () => {
    const tree: ShapeItem[] = [{ kind: 'group', fill: '#f00', transform: { anchor: [50, 50], position: [300, 200], scale: 50, rotation: 90 }, items: [{ kind: 'rect', size: [100, 100] }] }];
    const [op] = resolveTree(tree, 0, ctx);
    expect(op.fill).toBe('#f00');
    const box = pathBounds(op.paths)!;
    near(box.x, 275); near(box.y, 175); near(box.width, 50); near(box.height, 50);
    const all = treeBounds(tree, 0, ctx)!;
    near(all.x + all.width, 325);
  });
  it('knows static trees from animated ones', () => {
    expect(isStaticShape({ shape: 'rect', groups: [{ kind: 'rect', size: [10, 10] }] })).toBe(true);
    expect(isStaticShape({ shape: 'rect', groups: [{ kind: 'rect', size: { k: [{ t: 0, v: [1, 1] }, { t: 1, v: [2, 2] }] } }] })).toBe(false);
  });
  it('sizes a tree layer to its content and validates what the AI writes', () => {
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 1, layers: [
      { id: 'icon', type: 'shape', shape: { groups: [{ kind: 'path', d: 'M0 0 L240 0 L240 120 Z', fill: '#fff' }] } as never },
    ] };
    expect(validateScene(scene)).toEqual([]);
    const f = evaluateScene(scene, 0);
    expect(f.layers[0].size).toEqual([240, 120]);
    const bad: MotionScene = { ...scene, layers: [{ id: 'x', type: 'shape', shape: { groups: [{ kind: 'blob' }, { kind: 'path', d: 'nonsense' }] } as never }] };
    const problems = validateScene(bad).join(' | ');
    expect(problems).toMatch(/kind must be one of/);
    expect(problems).toMatch(/needs d, SVG path data/);
  });
});

describe('arrays and morphs', () => {
  it('lays copies out on a grid, a ring and a line, inside positive space', async () => {
    const { arrayCopies, layoutSlots } = await import('../src/motion/vector/shapes');
    const ring = layoutSlots({ type: 'ring', radius: 100 }, 4, 0, ctx);
    near(ring[0].x, 0); near(ring[0].y, -100); near(ring[1].x, 100); near(ring[1].y, 0);
    const grid = layoutSlots({ type: 'grid', columns: 3, spacing: [50, 40] }, 6, 0, ctx);
    near(grid[0].x, -50); near(grid[0].y, -20); near(grid[5].x, 50); near(grid[5].y, 20);
    const copies = arrayCopies({ kind: 'array', count: 6, item: { kind: 'rect', size: [20, 20], position: [0, 0] }, layout: { type: 'grid', columns: 3, spacing: [50, 40] } }, 0, ctx);
    expect(copies).toHaveLength(6);
    const box = treeBounds(copies, 0, ctx)!;
    expect(box.x).toBeGreaterThanOrEqual(-0.01);
    expect(box.y).toBeGreaterThanOrEqual(-0.01);
  });
  it('morphs every copy from one layout to another with a stagger, and fades a ramp', async () => {
    const { arrayCopies } = await import('../src/motion/vector/shapes');
    const item: ShapeItem = { kind: 'array', count: 4, item: { kind: 'ellipse', size: [10, 10], position: [0, 0] }, layout: { type: 'line', spacing: [100, 0], center: [500, 500] }, morph: { to: { type: 'ring', radius: 50, center: [500, 500] }, t: 1, stagger: 0.2 }, opacityRamp: [100, 25] };
    const done = arrayCopies(item, 0, ctx);
    const p0 = (done[0].transform!.position as number[]);
    near(p0[0], 500); near(p0[1], 450);
    expect(done[3].transform!.opacity).toBe(25);
    const half = arrayCopies({ ...item, morph: { ...item.morph!, t: 0.3 } }, 0, ctx);
    // With the stagger the first copy is further along than the last.
    const moved = (i: number) => Math.hypot((half[i].transform!.position as number[])[0] - (arrayCopies({ ...item, morph: undefined }, 0, ctx)[i].transform!.position as number[])[0], (half[i].transform!.position as number[])[1] - (arrayCopies({ ...item, morph: undefined }, 0, ctx)[i].transform!.position as number[])[1]);
    expect(moved(0)).toBeGreaterThan(moved(3));
  });
  it('morphs a square into a star through matched outlines', () => {
    const tree: ShapeItem[] = [{ kind: 'rect', size: [100, 100], fill: '#fff', morphTo: { kind: 'star', size: [100, 100], sides: 4 }, morphT: 0.5 }];
    const [op] = resolveTree(tree, 0, ctx);
    expect(op.paths[0].v.length).toBe(96);
    const box = pathBounds(op.paths)!;
    near(box.width, 100, 2);
    const [end] = resolveTree([{ ...tree[0], morphT: 1 }], 0, ctx);
    expect(end.paths[0].v.length).toBe(8);
  });
  it('validates arrays', () => {
    const scene: MotionScene = { version: 1, width: 100, height: 100, duration: 1, layers: [{ id: 'a', type: 'shape', shape: { groups: [{ kind: 'array' }] } as never }] };
    expect(validateScene(scene).join(' ')).toMatch(/needs item/);
  });
});

describe('layer-style effects', () => {
  it('validate as effects any layer can carry', () => {
    const scene: MotionScene = { version: 1, width: 100, height: 100, duration: 1, layers: [{ id: 't', type: 'text', text: { text: 'Hi' }, effects: [
      { type: 'gradient-overlay', stops: [[0, '#f0f'], [1, '#00f']], angle: 35 }, { type: 'bevel', size: 20 }, { type: 'inner-glow' }, { type: 'inner-shadow', distance: 6 },
    ] }] };
    expect(validateScene(scene)).toEqual([]);
  });
});
