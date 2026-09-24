// Shape trees (AE shape groups): resolves a ShapeItem tree at time t, measures it and draws it
// on a 2D context. Paths are bezier subpaths (vector/path.ts); primitives are built as paths too,
// so bounds, trim and (later) path operators treat every item the same way.
import { num, vec, type ExprContext } from '../anim';
import type { ArrayLayout, Paint, ShapeItem, ShapeStroke, Vec } from '../types';
import { flatten, pathBounds, pathLength, parseSvgPath, resample, tracePaths, transformPaths, type Box, type Subpath } from './path';
import { applyOps, type PathOpSpec } from './pathOps';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const parsed = new Map<string, Subpath[]>();
/** SVG path data parsed once per string (scenes are immutable; the same icon appears many times). */
export function pathData(d: string): Subpath[] {
  let hit = parsed.get(d);
  if (!hit) {
    hit = parseSvgPath(d);
    parsed.set(d, hit);
    if (parsed.size > 2000) parsed.delete(parsed.keys().next().value!);
  }
  return hit;
}

const K = 0.5522847498;

/** The geometry of a leaf item at time t, in its parent's pixels. */
export function itemPaths(item: ShapeItem, t: number, ctx: ExprContext): Subpath[] {
  if (item.kind === 'path') return item.d ? pathData(item.d) : [];
  const size = vec(item.size, t, [100, 100], ctx);
  const w = Math.max(0, size[0]);
  const h = Math.max(0, size[1] ?? size[0]);
  const c = vec(item.position, t, [w / 2, h / 2], ctx);
  const x0 = c[0] - w / 2, y0 = c[1] - h / 2;
  const v = (x: number, y: number, ix = x, iy = y, ox = x, oy = y) => ({ x, y, ix, iy, ox, oy });
  if (item.kind === 'ellipse') {
    const rx = w / 2, ry = h / 2, cx = c[0], cy = c[1];
    return [{ closed: true, v: [
      v(cx, cy - ry, cx - rx * K, cy - ry, cx + rx * K, cy - ry),
      v(cx + rx, cy, cx + rx, cy - ry * K, cx + rx, cy + ry * K),
      v(cx, cy + ry, cx + rx * K, cy + ry, cx - rx * K, cy + ry),
      v(cx - rx, cy, cx - rx, cy + ry * K, cx - rx, cy - ry * K),
    ] }];
  }
  if (item.kind === 'rect') {
    const r = Math.min(Math.max(0, num(item.radius, t, 0, ctx)), w / 2, h / 2);
    if (r <= 0) return [{ closed: true, v: [v(x0, y0), v(x0 + w, y0), v(x0 + w, y0 + h), v(x0, y0 + h)] }];
    const k = r * K;
    const x1 = x0 + w, y1 = y0 + h;
    return [{ closed: true, v: [
      v(x0 + r, y0, x0 + r - k, y0, x0 + r, y0), v(x1 - r, y0, x1 - r, y0, x1 - r + k, y0),
      v(x1, y0 + r, x1, y0 + r - k, x1, y0 + r), v(x1, y1 - r, x1, y1 - r, x1, y1 - r + k),
      v(x1 - r, y1, x1 - r + k, y1, x1 - r, y1), v(x0 + r, y1, x0 + r, y1, x0 + r - k, y1),
      v(x0, y1 - r, x0, y1 - r + k, x0, y1 - r), v(x0, y0 + r, x0, y0 + r, x0, y0 + r - k),
    ] }];
  }
  // polygon / star, pointing up
  const sides = Math.max(3, item.sides ?? (item.kind === 'star' ? 5 : 6));
  const count = item.kind === 'star' ? sides * 2 : sides;
  const inner = Math.min(1, Math.max(0.01, num(item.innerRadius, t, 0.45, ctx)));
  const pts = [];
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / count;
    const r = item.kind === 'star' && k % 2 === 1 ? inner : 1;
    pts.push(v(c[0] + Math.cos(angle) * (w / 2) * r, c[1] + Math.sin(angle) * (h / 2) * r));
  }
  return [{ closed: true, v: pts }];
}

// ───────────────────────── arrays ─────────────────────────

type Slot = { x: number; y: number; angle: number };

/** The slots of a layout around its centre (0, 0). */
export function layoutSlots(layout: ArrayLayout, count: number, t: number, ctx: ExprContext): Slot[] {
  const out: Slot[] = [];
  if (layout.type === 'ring') {
    const r = num(layout.radius, t, 200, ctx);
    const a0 = layout.startAngle ?? 0;
    for (let i = 0; i < count; i++) {
      const a = a0 + (360 * i) / count;
      const rad = (a * Math.PI) / 180;
      out.push({ x: r * Math.sin(rad), y: -r * Math.cos(rad), angle: layout.orient ? a : 0 });
    }
  } else if (layout.type === 'line') {
    const sp = vec(layout.spacing, t, [100, 0], ctx);
    for (let i = 0; i < count; i++) { const k = i - (count - 1) / 2; out.push({ x: k * sp[0], y: k * (sp[1] ?? 0), angle: 0 }); }
  } else {
    const cols = Math.max(1, Math.floor(layout.columns ?? Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const sp = vec(layout.spacing, t, [100, 100], ctx);
    for (let i = 0; i < count; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      out.push({ x: (c - (cols - 1) / 2) * sp[0], y: (r - (rows - 1) / 2) * (sp[1] ?? sp[0]), angle: 0 });
    }
  }
  const rot = num(layout.rotation, t, 0, ctx);
  if (rot) {
    const rad = (rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    for (const p of out) {
      const x = p.x * cos - p.y * sin, y = p.x * sin + p.y * cos;
      p.x = x; p.y = y;
      if (layout.orient) p.angle += rot;
    }
  }
  return out;
}

/** The copies of an `array` item at t: one group per slot, placed, turned and faded. */
export function arrayCopies(item: ShapeItem, t: number, ctx: ExprContext): ShapeItem[] {
  const template = item.item;
  if (!template) return [];
  const count = Math.max(1, Math.min(2000, Math.floor(item.count ?? 1)));
  const from = layoutSlots(item.layout ?? { type: 'grid' }, count, t, ctx);
  const to = item.morph ? layoutSlots(item.morph.to, count, t, ctx) : null;
  const T = item.morph ? Math.max(0, Math.min(1, num(item.morph.t, t, 0, ctx))) : 0;
  const stagger = Math.max(0, item.morph?.stagger ?? 0);
  // Copy i starts `stagger` later than copy i−1; the whole run still ends at T = 1.
  const progress = (i: number) => Math.max(0, Math.min(1, T * (1 + stagger * (count - 1)) - stagger * i));
  const slots = from.map((a, i) => {
    if (!to) return a;
    const b = to[i], u = progress(i);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: a.angle + (b.angle - a.angle) * u };
  });
  // Default centre keeps every copy (both layouts) in positive layer space.
  const itemBox = pathBounds(resolveTree([template], t, ctx).flatMap((op) => op.paths)) ?? { x: 0, y: 0, width: 0, height: 0 };
  const reach = Math.max(Math.abs(itemBox.x), Math.abs(itemBox.x + itemBox.width), Math.abs(itemBox.y), Math.abs(itemBox.y + itemBox.height));
  const all = to ? [...from, ...to] : from;
  const centre = vec(item.layout?.center, t, [Math.max(...all.map((p) => Math.abs(p.x))) + reach, Math.max(...all.map((p) => Math.abs(p.y))) + reach], ctx);
  const ramp = item.opacityRamp;
  return slots.map((p, i) => ({
    kind: 'group' as const,
    transform: { position: [centre[0] + p.x, centre[1] + p.y], rotation: p.angle, ...(ramp ? { opacity: ramp[0] + (ramp[1] - ramp[0]) * (count > 1 ? i / (count - 1) : 0) } : {}) },
    items: [template],
  }));
}

// ───────────────────────── morph ─────────────────────────

const MORPH_POINTS = 96;

/** One closed polyline morphed into another: resampled to equal counts, rotated and wound to match, then blended. */
function morphRing(a: number[], b: number[], u: number): number[] {
  const n = MORPH_POINTS;
  const A = resample(a, true, n);
  let B = resample(b, true, n);
  const cost = (P: number[], k: number) => {
    let c = 0;
    for (let i = 0; i < n; i += 4) { const j = ((i + k) % n) * 2; c += Math.hypot(A[i * 2] - P[j], A[i * 2 + 1] - P[j + 1]); }
    return c;
  };
  const best = (P: number[]) => {
    let bk = 0, bc = Infinity;
    for (let k = 0; k < n; k++) { const c = cost(P, k); if (c < bc) { bc = c; bk = k; } }
    return { k: bk, c: bc };
  };
  const reversed: number[] = [];
  for (let i = n - 1; i >= 0; i--) reversed.push(B[i * 2], B[i * 2 + 1]);
  const f = best(B), r = best(reversed);
  const shift = r.c < f.c ? r.k : f.k;
  if (r.c < f.c) B = reversed;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const j = ((i + shift) % n) * 2; out.push(A[i * 2] + (B[j] - A[i * 2]) * u, A[i * 2 + 1] + (B[j + 1] - A[i * 2 + 1]) * u); }
  return out;
}

/** `from` morphed into `to` at u (0..1): subpaths pair up by order; an unpaired one grows from / shrinks to its partner's centre. */
export function morphPaths(from: Subpath[], to: Subpath[], u: number): Subpath[] {
  if (u <= 0) return from;
  if (u >= 1) return to;
  const fa = flatten(from, 12), fb = flatten(to, 12);
  const centre = (pts: number[]) => {
    let x = 0, y = 0;
    const n = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
    return [x / n, y / n];
  };
  const dot = (pts: number[]) => { const c = centre(pts); return [c[0], c[1], c[0] + 0.01, c[1]]; };
  const out: Subpath[] = [];
  for (let k = 0; k < Math.max(fa.length, fb.length); k++) {
    const pa = fa[k]?.pts ?? dot(fb[k].pts);
    const pb = fb[k]?.pts ?? dot(fa[k].pts);
    const pts = morphRing(pa, pb, u);
    const v = [];
    for (let i = 0; i < pts.length; i += 2) v.push({ x: pts[i], y: pts[i + 1], ix: pts[i], iy: pts[i + 1], ox: pts[i], oy: pts[i + 1] });
    out.push({ closed: true, v });
  }
  return out;
}

/** A group's transform as a 2D affine [a, b, c, d, e, f] (AE order: position · rotation · scale · −anchor). */
export function groupMatrix(item: ShapeItem, t: number, ctx: ExprContext): number[] {
  const tr = item.transform;
  if (!tr) return [1, 0, 0, 1, 0, 0];
  const anchor = vec(tr.anchor, t, [0, 0], ctx);
  const position = vec(tr.position, t, anchor, ctx);
  const sRaw = tr.scale === undefined ? 100 : (typeof tr.scale === 'number' || !Array.isArray(tr.scale) ? num(tr.scale as never, t, 100, ctx) : null);
  const sv = sRaw !== null ? [sRaw, sRaw] : vec(tr.scale as never, t, [100, 100], ctx);
  const sx = sv[0] / 100, sy = (sv[1] ?? sv[0]) / 100;
  const r = (num(tr.rotation, t, 0, ctx) * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  return [a, b, c, d, position[0] - (a * anchor[0] + c * anchor[1]), position[1] - (b * anchor[0] + d * anchor[1])];
}

const compose = (m: number[], n: number[]) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** `matrix`: the item's world transform — stroke widths scale with it and gradient points are in its local space, as in AE. */
type Drawn = { paths: Subpath[]; fill: Paint | null; fillRule: 'nonzero' | 'evenodd'; stroke: ShapeStroke | null; opacity: number; matrix: number[] };

/** Flattens a tree into draw operations with world (layer-pixel) geometry, in back-to-front order. */
export function resolveTree(items: ShapeItem[], t: number, ctx: ExprContext, parent: number[] = [1, 0, 0, 1, 0, 0], inherited: { fill: Paint | null; stroke: ShapeStroke | null; opacity: number } = { fill: null, stroke: null, opacity: 1 }, out: Drawn[] = [], depth = 0): Drawn[] {
  if (depth > 16) return out;
  for (const item of items) {
    const opacity = inherited.opacity * Math.max(0, Math.min(100, num(item.opacity, t, 100, ctx))) / 100;
    const fill = item.fill !== undefined ? item.fill : inherited.fill;
    const stroke = item.stroke !== undefined ? item.stroke : inherited.stroke;
    if (item.kind === 'array') {
      resolveTree(arrayCopies(item, t, ctx), t, ctx, parent, { fill, stroke, opacity }, out, depth + 1);
      continue;
    }
    if (item.kind === 'group') {
      const groupOpacity = item.transform?.opacity !== undefined ? Math.max(0, Math.min(100, num(item.transform.opacity, t, 100, ctx))) / 100 : 1;
      const world = compose(parent, groupMatrix(item, t, ctx));
      if (item.ops?.length) {
        // Operators turn the children into one outline, painted with the group's paint (or its first child's).
        const children = resolveTree(item.items ?? [], t, ctx, world, { fill, stroke, opacity: 1 }, [], depth + 1);
        if (!children.length) continue;
        const specs: PathOpSpec[] = item.ops.map((op) => op.op === 'merge' ? op : op.op === 'offset' ? { op: 'offset', amount: num(op.amount, t, 0, ctx), join: op.join } : { op: 'round-corners', radius: num(op.radius, t, 0, ctx) });
        const paths = applyOps(children.map((c) => c.paths), specs);
        const first = children[0];
        out.push({ paths, fill: fill ?? first.fill, fillRule: 'nonzero', stroke: stroke ?? first.stroke, opacity: opacity * groupOpacity, matrix: world });
        continue;
      }
      resolveTree(item.items ?? [], t, ctx, world, { fill, stroke, opacity: opacity * groupOpacity }, out, depth + 1);
      continue;
    }
    let local = itemPaths(item, t, ctx);
    if (item.morphTo) {
      const u = Math.max(0, Math.min(1, num(item.morphT, t, 0, ctx)));
      if (u > 0) local = morphPaths(local, itemPaths(item.morphTo, t, ctx), u);
    }
    const paths = transformPaths(local, parent);
    // A bare path with nothing set still shows: black fill, like SVG.
    out.push({ paths, fill: fill === null && stroke === null && item.fill === undefined && item.stroke === undefined && inherited.fill === null && inherited.stroke === null ? '#000000' : fill, fillRule: item.fillRule ?? 'nonzero', stroke, opacity, matrix: parent });
  }
  return out;
}

/** The widest stroke in a tree (for padding the raster). */
export function treeStrokeWidth(items: ShapeItem[], t: number, ctx: ExprContext): number {
  let max = 0;
  for (const op of resolveTree(items, t, ctx)) if (op.stroke) max = Math.max(max, num(op.stroke.width, t, 2, ctx) * lengthScale(op.matrix));
  return max;
}

/** Bounds of a tree's geometry at t (strokes excluded), or null when empty. */
export function treeBounds(items: ShapeItem[], t: number, ctx: ExprContext): Box | null {
  const all = resolveTree(items, t, ctx).flatMap((op) => op.paths);
  return pathBounds(all);
}

const apply = (m: number[], p: number[]) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** How much a 2D affine scales lengths (for stroke widths). */
const lengthScale = (m: number[]) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function paintStyle(c: Ctx2D, paint: Paint, t: number, ctx: ExprContext, d: number, off: number, box: Box, m: number[]): string | CanvasGradient {
  if (typeof paint === 'string') return paint;
  const g = paint.gradient;
  // Explicit points are in the item's own space (like its geometry); defaults span its world bounds.
  const from = g.from !== undefined ? apply(m, vec(g.from, t, [0, 0], ctx)) : g.kind === 'linear' ? [box.x, box.y] : [box.x + box.width / 2, box.y + box.height / 2];
  const to = g.to !== undefined ? apply(m, vec(g.to, t, [0, 0], ctx)) : g.kind === 'linear' ? [box.x, box.y + box.height] : [box.x + box.width, box.y + box.height / 2];
  const grad = g.kind === 'linear'
    ? c.createLinearGradient(from[0] * d + off, from[1] * d + off, to[0] * d + off, to[1] * d + off)
    : c.createRadialGradient(from[0] * d + off, from[1] * d + off, 0, from[0] * d + off, from[1] * d + off, Math.max(1e-3, Math.hypot(to[0] - from[0], to[1] - from[1])) * d);
  for (const [stop, color] of g.stops) grad.addColorStop(Math.min(1, Math.max(0, stop)), color);
  return grad;
}

/** Draws a shape tree onto `c` at density `d`, offset by `off` device pixels (the raster pad). */
export function drawTree(c: Ctx2D, items: ShapeItem[], t: number, ctx: ExprContext, d: number, off: number) {
  for (const op of resolveTree(items, t, ctx)) {
    if (!op.paths.length || op.opacity <= 0) continue;
    const box = pathBounds(op.paths) ?? { x: 0, y: 0, width: 1, height: 1 };
    c.save();
    c.globalAlpha *= op.opacity;
    const closed = op.paths.some((s) => s.closed);
    if (op.fill && closed) {
      c.beginPath();
      tracePaths(c, op.paths, d, off);
      c.fillStyle = paintStyle(c, op.fill, t, ctx, d, off, box, op.matrix);
      c.fill(op.fillRule);
    }
    if (op.stroke) {
      const s = op.stroke;
      const width = Math.max(0, num(s.width, t, 2, ctx)) * lengthScale(op.matrix);
      if (width > 0) {
        c.beginPath();
        tracePaths(c, op.paths, d, off);
        c.strokeStyle = paintStyle(c, s.paint, t, ctx, d, off, box, op.matrix);
        c.lineWidth = width * d;
        c.lineCap = s.cap ?? 'round';
        c.lineJoin = s.join ?? 'round';
        const start = num(s.trim?.start, t, 0, ctx) / 100;
        const end = num(s.trim?.end, t, 100, ctx) / 100;
        const offset = num(s.trim?.offset, t, 0, ctx) / 100;
        if (start > 0 || end < 1 || offset) {
          // Trim per subpath, the way AE trims a group's paths "simultaneously".
          c.restore(); c.save(); c.globalAlpha *= op.opacity;
          c.strokeStyle = paintStyle(c, s.paint, t, ctx, d, off, box, op.matrix);
          c.lineWidth = width * d; c.lineCap = s.cap ?? 'round'; c.lineJoin = s.join ?? 'round';
          for (const sub of op.paths) {
            const length = pathLength([sub]) * d;
            const visible = Math.max(0, end - start) * length;
            if (visible <= 0.01) continue;
            c.beginPath();
            tracePaths(c, [sub], d, off);
            c.setLineDash([visible, length * 2 + 10]);
            c.lineDashOffset = -((start + offset) % 1) * length;
            c.stroke();
          }
          c.setLineDash([]);
        } else {
          c.setLineDash(s.dash?.length ? s.dash.map((x) => x * d) : []);
          c.stroke();
          c.setLineDash([]);
        }
      }
    }
    c.restore();
  }
}

/** A tree's points flattened (for tests and QA): every subpath as a polyline. */
export function treePolylines(items: ShapeItem[], t: number, ctx: ExprContext): { pts: number[]; closed: boolean }[] {
  return flatten(resolveTree(items, t, ctx).flatMap((op) => op.paths));
}

export type { Vec };

const staticCache = new WeakMap<object, boolean>();
/** True when nothing under `value` is keyframed or an expression: its raster never changes. */
export function isStaticShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const hit = staticCache.get(value as object);
  if (hit !== undefined) return hit;
  let result = true;
  if (Array.isArray(value)) result = value.every(isStaticShape);
  else {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.k) || typeof o.expr === 'string') result = false;
    else result = Object.values(o).every(isStaticShape);
  }
  staticCache.set(value as object, result);
  return result;
}
