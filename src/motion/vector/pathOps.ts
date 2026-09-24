// Path operators for shape groups (AE's Merge Paths, Offset Paths, Round Corners), run on the
// group's resolved geometry before it is painted. Booleans and offsets go through Clipper2
// (clipper2-ts, Boost licence, double precision) on flattened outlines; round corners stay curves.
// (clipper2-js was tried first: its negative offsets are wrong.)
import { Clipper, EndType, FillRule, JoinType } from 'clipper2-ts';
import { flatten, type Subpath, type Vertex } from './path';

const K = 0.5522847498;
type PathD = { x: number; y: number }[];
const C = Clipper as unknown as {
  makePathD(pts: number[]): PathD;
  unionD(subject: PathD[], clip: PathD[], rule: number): PathD[];
  differenceD(subject: PathD[], clip: PathD[], rule: number): PathD[];
  intersectD(subject: PathD[], clip: PathD[], rule: number): PathD[];
  xorD(subject: PathD[], clip: PathD[], rule: number): PathD[];
  inflatePathsD(paths: PathD[], delta: number, join: number, end: number, miterLimit?: number, precision?: number): PathD[];
};

export type PathOpSpec =
  | { op: 'merge'; mode?: 'union' | 'subtract' | 'intersect' | 'xor' }
  | { op: 'offset'; amount: number; join?: 'round' | 'miter' | 'bevel' }
  | { op: 'round-corners'; radius: number };

function toClipper(paths: Subpath[]): PathD[] {
  const out: PathD[] = [];
  for (const { pts, closed } of flatten(paths, 16)) if (closed && pts.length >= 6) out.push(C.makePathD(pts));
  return out;
}

function fromClipper(paths: PathD[]): Subpath[] {
  return paths.filter((p) => p.length >= 3).map((p) => ({ closed: true, v: p.map(({ x, y }) => ({ x, y, ix: x, iy: y, ox: x, oy: y })) }));
}

/** Boolean of the first subpath group against the rest (AE Merge Paths). */
export function mergePaths(groups: Subpath[][], mode: 'union' | 'subtract' | 'intersect' | 'xor' = 'union'): Subpath[] {
  if (!groups.length) return [];
  const subject = toClipper(groups[0]);
  const clip = toClipper(groups.slice(1).flat());
  const run = mode === 'subtract' ? C.differenceD : mode === 'intersect' ? C.intersectD : mode === 'xor' ? C.xorD : C.unionD;
  return fromClipper(run.call(Clipper, subject, clip, FillRule.NonZero));
}

/** Grows (+) or shrinks (−) closed outlines by `amount` px (AE Offset Paths). */
export function offsetPaths(paths: Subpath[], amount: number, join: 'round' | 'miter' | 'bevel' = 'round'): Subpath[] {
  if (!amount) return paths;
  const jt = join === 'miter' ? JoinType.Miter : join === 'bevel' ? JoinType.Bevel : JoinType.Round;
  return fromClipper(C.inflatePathsD(toClipper(paths), amount, jt, EndType.Polygon, 4, 2));
}

/** Rounds every sharp corner between straight segments with a circular-looking fillet (AE Round Corners). */
export function roundCorners(paths: Subpath[], radius: number): Subpath[] {
  if (radius <= 0) return paths;
  return paths.map((s) => {
    const n = s.v.length;
    if (n < 3) return s;
    const out: Vertex[] = [];
    for (let i = 0; i < n; i++) {
      const p = s.v[i];
      const sharp = p.ix === p.x && p.iy === p.y && p.ox === p.x && p.oy === p.y;
      const hasPrev = s.closed || i > 0, hasNext = s.closed || i < n - 1;
      if (!sharp || !hasPrev || !hasNext) { out.push({ ...p }); continue; }
      const a = s.v[(i - 1 + n) % n], b = s.v[(i + 1) % n];
      const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
      const r = Math.min(radius, la / 2, lb / 2);
      if (r <= 1e-6) { out.push({ ...p }); continue; }
      const ua = [(a.x - p.x) / la, (a.y - p.y) / la], ub = [(b.x - p.x) / lb, (b.y - p.y) / lb];
      const p1 = [p.x + ua[0] * r, p.y + ua[1] * r], p2 = [p.x + ub[0] * r, p.y + ub[1] * r];
      out.push({ x: p1[0], y: p1[1], ix: p1[0], iy: p1[1], ox: p1[0] - ua[0] * r * K, oy: p1[1] - ua[1] * r * K });
      out.push({ x: p2[0], y: p2[1], ix: p2[0] - ub[0] * r * K, iy: p2[1] - ub[1] * r * K, ox: p2[0], oy: p2[1] });
    }
    return { closed: s.closed, v: out };
  });
}

/** Runs a group's operators, in order, over its children's geometry (one list of subpaths per child). */
export function applyOps(children: Subpath[][], ops: PathOpSpec[]): Subpath[] {
  let groups = children;
  for (const op of ops) {
    if (op.op === 'merge') groups = [mergePaths(groups, op.mode)];
    else if (op.op === 'offset') groups = groups.map((g) => offsetPaths(g, op.amount, op.join));
    else if (op.op === 'round-corners') groups = groups.map((g) => roundCorners(g, op.radius));
  }
  return groups.flat();
}
