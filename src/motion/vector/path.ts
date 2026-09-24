// Bezier path geometry for the vector engine: SVG path data → cubic subpaths (the AE/Lottie model:
// vertices with in/out tangents), bounds, arc length, drawing and resampling. Pure: no DOM, no GL,
// so validation, sizing, QA and the tests share it with the rasteriser.

/** One vertex: position plus its in/out tangent handles as absolute points (equal to the vertex = no handle). */
export type Vertex = { x: number; y: number; ix: number; iy: number; ox: number; oy: number };
export type Subpath = { v: Vertex[]; closed: boolean };
export type Box = { x: number; y: number; width: number; height: number };

const vtx = (x: number, y: number): Vertex => ({ x, y, ix: x, iy: y, ox: x, oy: y });

/** Parses SVG path data (M L H V C S Q T A Z, absolute and relative) into cubic subpaths. */
export function parseSvgPath(d: string): Subpath[] {
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let cmd = '';
  let pos = 0;
  const n = d.length;
  const skip = () => { while (pos < n && /[\s,]/.test(d[pos])) pos++; };
  const isCmd = () => { skip(); return pos < n && /[a-zA-Z]/.test(d[pos]); };
  const more = () => { skip(); return pos < n && /[-+.\d]/.test(d[pos]); };
  /** One number; a second "." or a sign ends it (".5.5" is two numbers, as in compact icon paths). */
  const num = () => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(pos, pos + 40));
    if (!m) { pos = n; return NaN; }
    pos += m[0].length;
    return Number(m[0]);
  };
  /** An arc flag: a single 0 or 1, which may be packed against the next number ("a2 2 0 012 2"). */
  const flag = () => { skip(); const c = d[pos]; if (c === '0' || c === '1') { pos++; return c === '1' ? 1 : 0; } return num(); };
  const start = (nx: number, ny: number) => { cur = { v: [vtx(nx, ny)], closed: false }; out.push(cur); sx = nx; sy = ny; };
  const last = () => cur!.v[cur!.v.length - 1];
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
    if (![c1x, c1y, c2x, c2y, ex, ey].every(Number.isFinite)) return;
    if (!cur) start(x, y);
    const p = last();
    p.ox = c1x; p.oy = c1y;
    const nv = vtx(ex, ey); nv.ix = c2x; nv.iy = c2y;
    cur!.v.push(nv);
    x = ex; y = ey;
  };
  const line = (ex: number, ey: number) => cubic(x, y, ex, ey, ex, ey);
  while (pos < n) {
    if (isCmd()) cmd = d[pos++];
    else if (!more()) { pos++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur) {
        const s = cur as Subpath;
        const first = s.v[0];
        const end = s.v[s.v.length - 1];
        // A closing segment that lands on the start merges into it (keeping its in-handle).
        if (s.v.length > 1 && Math.hypot(end.x - first.x, end.y - first.y) < 1e-6) { first.ix = end.ix; first.iy = end.iy; s.v.pop(); }
        s.closed = true;
      }
      x = sx; y = sy; cur = null; lastCtrl = lastQuad = null;
      continue;
    }
    if (!more()) continue;
    switch (C) {
      case 'M': { const mx = num() + (rel ? x : 0), my = num() + (rel ? y : 0); if (Number.isFinite(mx) && Number.isFinite(my)) { start(mx, my); x = mx; y = my; } cmd = rel ? 'l' : 'L'; while (more()) line(num() + (rel ? x : 0), num() + (rel ? y : 0)); lastCtrl = lastQuad = null; break; }
      case 'L': { while (more()) line(num() + (rel ? x : 0), num() + (rel ? y : 0)); lastCtrl = lastQuad = null; break; }
      case 'H': { while (more()) line(num() + (rel ? x : 0), y); lastCtrl = lastQuad = null; break; }
      case 'V': { while (more()) line(x, num() + (rel ? y : 0)); lastCtrl = lastQuad = null; break; }
      case 'C': {
        while (more()) { const bx = rel ? x : 0, by = rel ? y : 0; const c1x = num() + bx, c1y = num() + by, c2x = num() + bx, c2y = num() + by, ex = num() + bx, ey = num() + by; cubic(c1x, c1y, c2x, c2y, ex, ey); lastCtrl = [c2x, c2y]; }
        lastQuad = null; break;
      }
      case 'S': {
        while (more()) { const bx = rel ? x : 0, by = rel ? y : 0; const c1: [number, number] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]; const c2x = num() + bx, c2y = num() + by, ex = num() + bx, ey = num() + by; cubic(c1[0], c1[1], c2x, c2y, ex, ey); lastCtrl = [c2x, c2y]; }
        lastQuad = null; break;
      }
      case 'Q': {
        while (more()) { const bx = rel ? x : 0, by = rel ? y : 0; const qx = num() + bx, qy = num() + by, ex = num() + bx, ey = num() + by; cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey); lastQuad = [qx, qy]; }
        lastCtrl = null; break;
      }
      case 'T': {
        while (more()) { const bx = rel ? x : 0, by = rel ? y : 0; const q: [number, number] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y]; const ex = num() + bx, ey = num() + by; cubic(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), ex + (2 / 3) * (q[0] - ex), ey + (2 / 3) * (q[1] - ey), ex, ey); lastQuad = q; }
        lastCtrl = null; break;
      }
      case 'A': {
        while (more()) {
          const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
          const ex = num() + (rel ? x : 0), ey = num() + (rel ? y : 0);
          if (![rx, ry, rot, large, sweep, ex, ey].every(Number.isFinite)) break;
          for (const seg of arcToCubics(x, y, rx, ry, rot, !!large, !!sweep, ex, ey)) cubic(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
          x = ex; y = ey;
        }
        lastCtrl = lastQuad = null; break;
      }
      default: num();
    }
  }
  return out.filter((s) => s.v.length > 0);
}

/** An SVG elliptical arc as cubic segments [c1x, c1y, c2x, c2y, x, y] (the W3C endpoint → centre conversion). */
export function arcToCubics(x1: number, y1: number, rx: number, ry: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!Number.isFinite(dt) || !Number.isFinite(cx) || !Number.isFinite(cy)) return [[x1, y1, x2, y2, x2, y2]];
  const segments = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  let a = t1;
  const point = (t: number) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let s = 0; s < segments; s++) {
    const b = a + step;
    const p0 = point(a), p1 = point(b), d0 = deriv(a), d1 = deriv(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    a = b;
  }
  const lastSeg = out[out.length - 1];
  lastSeg[4] = x2; lastSeg[5] = y2;
  return out;
}

/** Calls `seg` for every cubic segment of a subpath (p0, c1, c2, p1). */
export function eachSegment(s: Subpath, seg: (p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number]) => void) {
  const n = s.v.length;
  const count = s.closed ? n : n - 1;
  for (let k = 0; k < count; k++) {
    const a = s.v[k];
    const b = s.v[(k + 1) % n];
    seg([a.x, a.y], [a.ox, a.oy], [b.ix, b.iy], [b.x, b.y]);
  }
}

const bez = (a: number, b: number, c: number, d: number, t: number) => { const m = 1 - t; return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d; };

/** Points along the subpaths, `steps` per cubic segment (for bounds, length, trim and morph). */
export function flatten(paths: Subpath[], steps = 16): { pts: number[]; closed: boolean }[] {
  return paths.map((s) => {
    const pts: number[] = [];
    if (s.v.length) pts.push(s.v[0].x, s.v[0].y);
    eachSegment(s, (p0, c1, c2, p1) => {
      const straight = c1[0] === p0[0] && c1[1] === p0[1] && c2[0] === p1[0] && c2[1] === p1[1];
      const n = straight ? 1 : steps;
      for (let k = 1; k <= n; k++) { const t = k / n; pts.push(bez(p0[0], c1[0], c2[0], p1[0], t), bez(p0[1], c1[1], c2[1], p1[1], t)); }
    });
    return { pts, closed: s.closed };
  });
}

/** Tight-enough bounding box of the subpaths (flattened), or null when empty. */
export function pathBounds(paths: Subpath[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { pts } of flatten(paths, 12)) for (let k = 0; k + 1 < pts.length; k += 2) { x0 = Math.min(x0, pts[k]); y0 = Math.min(y0, pts[k + 1]); x1 = Math.max(x1, pts[k]); y1 = Math.max(y1, pts[k + 1]); }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Total arc length of the subpaths. */
export function pathLength(paths: Subpath[]): number {
  let total = 0;
  for (const { pts } of flatten(paths, 24)) for (let k = 2; k + 1 < pts.length; k += 2) total += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
  return total;
}

/** Traces the subpaths on a 2D context (scaled by `d`, offset by `off`); the caller fills/strokes. */
export function tracePaths(c: { moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void }, paths: Subpath[], d: number, off: number) {
  for (const s of paths) {
    if (!s.v.length) continue;
    c.moveTo(s.v[0].x * d + off, s.v[0].y * d + off);
    eachSegment(s, (_p0, c1, c2, p1) => c.bezierCurveTo(c1[0] * d + off, c1[1] * d + off, c2[0] * d + off, c2[1] * d + off, p1[0] * d + off, p1[1] * d + off));
    if (s.closed) c.closePath();
  }
}

/** Moves every point of the subpaths by (dx, dy). */
export function translatePaths(paths: Subpath[], dx: number, dy: number): Subpath[] {
  return paths.map((s) => ({ closed: s.closed, v: s.v.map((p) => ({ x: p.x + dx, y: p.y + dy, ix: p.ix + dx, iy: p.iy + dy, ox: p.ox + dx, oy: p.oy + dy })) }));
}

/** Applies a 2D affine [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f) to the subpaths. */
export function transformPaths(paths: Subpath[], m: number[]): Subpath[] {
  const T = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return paths.map((s) => ({ closed: s.closed, v: s.v.map((p) => { const [x, y] = T(p.x, p.y); const [ix, iy] = T(p.ix, p.iy); const [ox, oy] = T(p.ox, p.oy); return { x, y, ix, iy, ox, oy }; }) }));
}

/** Resamples a closed or open polyline to `count` points evenly spaced by arc length. */
export function resample(pts: number[], closed: boolean, count: number): number[] {
  const n = Math.floor(pts.length / 2);
  if (n === 0) return new Array(count * 2).fill(0);
  const P = (k: number) => [pts[(k % n) * 2], pts[(k % n) * 2 + 1]];
  const segs = closed ? n : n - 1;
  const lens: number[] = [];
  let total = 0;
  for (let k = 0; k < segs; k++) { const a = P(k), b = P(k + 1); const l = Math.hypot(b[0] - a[0], b[1] - a[1]); lens.push(l); total += l; }
  const out: number[] = [];
  if (total === 0) { for (let k = 0; k < count; k++) out.push(pts[0], pts[1]); return out; }
  const stepLen = total / (closed ? count : Math.max(1, count - 1));
  let seg = 0, acc = 0;
  for (let k = 0; k < count; k++) {
    const target = Math.min(total, k * stepLen);
    while (seg < segs - 1 && acc + lens[seg] < target) { acc += lens[seg]; seg++; }
    const a = P(seg), b = P(seg + 1);
    const u = lens[seg] > 0 ? (target - acc) / lens[seg] : 0;
    out.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
  }
  return out;
}
