import { describe, expect, it } from 'vitest';
import { mergePaths, offsetPaths, roundCorners } from '../src/motion/vector/pathOps';
import { flatten, parseSvgPath, pathBounds } from '../src/motion/vector/path';
import { resolveTree } from '../src/motion/vector/shapes';

const area = (paths: ReturnType<typeof parseSvgPath>) => {
  let a = 0;
  for (const { pts } of flatten(paths, 16)) { let s = 0; const n = pts.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; } a += s / 2; }
  return Math.abs(a);
};
const sq = (x: number, y: number, s: number) => parseSvgPath(`M${x} ${y}h${s}v${s}h-${s}z`);

describe('path operators', () => {
  it('merges: union, subtract, intersect', () => {
    const a = sq(0, 0, 100), b = sq(50, 50, 100);
    expect(area(mergePaths([a, b], 'union'))).toBeCloseTo(17500, -1);
    expect(area(mergePaths([a, b], 'subtract'))).toBeCloseTo(7500, -1);
    expect(area(mergePaths([a, b], 'intersect'))).toBeCloseTo(2500, -1);
  });
  it('offsets outlines out and in', () => {
    const grown = pathBounds(offsetPaths(sq(0, 0, 100), 10))!;
    expect(grown.x).toBeCloseTo(-10, 1); expect(grown.width).toBeCloseTo(120, 1);
    const shrunk = pathBounds(offsetPaths(sq(0, 0, 100), -10))!;
    expect(shrunk.width).toBeCloseTo(80, 1);
  });
  it('rounds sharp corners with curves', () => {
    const r = roundCorners(sq(0, 0, 100), 20);
    expect(r[0].v).toHaveLength(8);
    expect(area(r)).toBeLessThan(10000);
    expect(area(r)).toBeGreaterThan(10000 - 4 * 400 + 4 * Math.PI * 100 - 40);
  });
  it('runs as group ops in a shape tree (a ring cut from two circles)', () => {
    const [op] = resolveTree([{ kind: 'group', fill: '#fff', ops: [{ op: 'merge', mode: 'subtract' }], items: [{ kind: 'ellipse', size: [200, 200] }, { kind: 'ellipse', size: [120, 120], position: [100, 100] }] }], 0, { seed: 1 });
    expect(op.fill).toBe('#fff');
    expect(op.paths.length).toBe(2);
    expect(area(op.paths.slice(0, 1))).toBeGreaterThan(0);
  });
});
