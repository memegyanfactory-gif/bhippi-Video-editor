// The hand-made toolkit under the drawn styles: seeded randomness and noise, polylines (length,
// trim, point-at, densify), boil wobble, pressure ribbons, torn edges and the on-twos clock. Pure
// functions of their inputs, so any frame redraws identically.

/** A polyline: flat [x0, y0, x1, y1, …]. */
export type Poly = number[];

/** A deterministic hash of up to three ints → [0, 1). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** mulberry32: a seeded stream of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let s = (Math.floor(seed * 2654435761) ^ 0x5bd1e995) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  return (hash(i, seed) * 2 - 1) * (1 - smooth(f)) + (hash(i + 1, seed) * 2 - 1) * smooth(f);
}

/** Smooth 2D value noise in [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const v = (a: number, b: number) => hash(a, b, seed) * 2 - 1;
  const top = v(ix, iy) * (1 - fx) + v(ix + 1, iy) * fx;
  const bottom = v(ix, iy + 1) * (1 - fx) + v(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The drawing clock. With `step` > 1 the picture only changes every `step` frames of `fps` (on
 * twos at 24 fps = 12 drawings a second, Films 4 and 5): returns the held time and the drawing's
 * index, which re-seeds the boil.
 */
export function drawingClock(t: number, step = 1, fps = 24): { t: number; index: number } {
  const s = Math.max(1, Math.round(step));
  const index = Math.floor((t * fps) / s + 1e-6);
  return s <= 1 ? { t, index } : { t: (index * s) / fps, index };
}

export function polyLength(p: Poly, closed = false): number {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  if (closed && p.length >= 4) len += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  return len;
}

/** The first `length` px of a polyline (closed ones wrap back to the start). */
export function trimPoly(p: Poly, length: number, closed = false): Poly {
  const pts = closed && p.length >= 4 ? [...p, p[0], p[1]] : p;
  if (length <= 0 || pts.length < 4) return [];
  const out = [pts[0], pts[1]];
  let left = length;
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (seg >= left) {
      const u = seg > 0 ? left / seg : 0;
      out.push(lerp(pts[i - 2], pts[i], u), lerp(pts[i - 1], pts[i + 1], u));
      return out;
    }
    out.push(pts[i], pts[i + 1]);
    left -= seg;
  }
  return out;
}

/** The point and direction (radians) `length` px along a polyline. */
export function pointAt(p: Poly, length: number, closed = false): { x: number; y: number; angle: number } {
  const pts = closed && p.length >= 4 ? [...p, p[0], p[1]] : p;
  if (pts.length < 4) return { x: pts[0] ?? 0, y: pts[1] ?? 0, angle: 0 };
  let left = Math.max(0, length);
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - pts[i - 2];
    const dy = pts[i + 1] - pts[i - 1];
    const seg = Math.hypot(dx, dy);
    if (seg >= left || i === pts.length - 2) {
      const u = seg > 0 ? Math.min(1, left / seg) : 0;
      return { x: pts[i - 2] + dx * u, y: pts[i - 1] + dy * u, angle: Math.atan2(dy, dx) };
    }
    left -= seg;
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1], angle: 0 };
}

/** Adds points so no segment is longer than `maxSeg` px (wobble needs something to bend). */
export function densify(p: Poly, maxSeg: number, closed = false): Poly {
  if (p.length < 4) return p.slice();
  const out: Poly = [p[0], p[1]];
  const n = p.length / 2;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    const bx = p[((i + 1) % n) * 2];
    const by = p[((i + 1) % n) * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxSeg));
    for (let k = 1; k <= steps; k++) {
      if (closed && i === last - 1 && k === steps) break;
      out.push(lerp(ax, bx, k / steps), lerp(ay, by, k / steps));
    }
  }
  return out;
}

/**
 * Hand wobble: each point drifts by smooth noise of its distance along the line, `amp` px, bent
 * over `wavelength` px. A new `seed` per drawing makes the line boil; the same seed holds it.
 */
export function wobble(p: Poly, amp: number, seed: number, wavelength = 42, closed = false): Poly {
  if (amp <= 0 || p.length < 4) return p;
  const d = densify(p, Math.max(3, wavelength / 5), closed);
  const out: Poly = new Array(d.length);
  let s = 0;
  for (let i = 0; i < d.length; i += 2) {
    if (i >= 2) s += Math.hypot(d[i] - d[i - 2], d[i + 1] - d[i - 1]);
    out[i] = d[i] + noise1(s / wavelength, seed) * amp;
    out[i + 1] = d[i + 1] + noise1(s / wavelength + 37.1, seed + 11) * amp;
  }
  return out;
}

/**
 * A pressure ribbon around a polyline: a filled outline whose width swells from thin ends to
 * `width` in the middle (a drawn contour, not a mechanical stroke). `taper` 0 = constant width.
 */
export function ribbon(p: Poly, width: number, taper = 0.7, seed = 0, closed = false): Poly {
  const n = p.length / 2;
  if (n < 2) return [];
  const total = polyLength(p, closed) || 1;
  const left: number[] = [];
  const right: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = p[b * 2] - p[a * 2];
    let ty = p[b * 2 + 1] - p[a * 2 + 1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const u = s / total;
    const ends = closed ? 1 : Math.sin(Math.PI * clamp(u, 0, 1)) ** 0.5;
    const pressure = 1 - taper + taper * ends;
    const w = (width / 2) * pressure * (1 + 0.12 * noise1(s / 60, seed));
    left.push(p[i * 2] - ty * w, p[i * 2 + 1] + tx * w);
    right.push(p[i * 2] + ty * w, p[i * 2 + 1] - tx * w);
  }
  const out = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i], right[i + 1]);
  return out;
}

/** The centroid of a polygon's points (a cheap centre). */
export function centre(p: Poly): [number, number] {
  let x = 0;
  let y = 0;
  const n = p.length / 2 || 1;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
  return [x / n, y / n];
}

/**
 * A torn paper rim: the outline pushed out `rim` px from its centre, with a fine jagged edge
 * (tiny fibres every few px). Seeded, so it stays put while the drawing holds.
 */
export function tornEdge(p: Poly, rim: number, seed: number): Poly {
  const d = densify(p, 3, true);
  const [cx, cy] = centre(d);
  const out: Poly = [];
  for (let i = 0, k = 0; i < d.length; i += 2, k++) {
    const dx = d[i] - cx;
    const dy = d[i + 1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    const jag = rim * (0.75 + 0.5 * hash(k, seed)) + rim * 0.35 * noise1(k / 9, seed + 3);
    out.push(d[i] + (dx / l) * jag, d[i + 1] + (dy / l) * jag);
  }
  return out;
}

/** Bounding box of polylines: [x, y, w, h], or null when empty. */
export function bounds(polys: Poly[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** Points on an ellipse (closed polyline, no repeated end point). */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, steps = 0, start = -Math.PI / 2): Poly {
  const n = steps || Math.max(24, Math.min(160, Math.ceil((Math.PI * (rx + ry)) / 10)));
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

/** A rounded rectangle as a closed polyline, centred on (cx, cy). */
export function roundRectPts(cx: number, cy: number, w: number, h: number, r: number): Poly {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  const out: Poly = [];
  const arc = (ax: number, ay: number, a0: number) => {
    const n = rr > 0 ? 6 : 1;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push(ax + Math.cos(a) * rr, ay + Math.sin(a) * rr);
    }
  };
  arc(x1 - rr, y0 + rr, -Math.PI / 2);
  arc(x1 - rr, y1 - rr, 0);
  arc(x0 + rr, y1 - rr, Math.PI / 2);
  arc(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/** A regular polygon or star (inner < 1) as a closed polyline, first point up. */
export function starPts(cx: number, cy: number, rx: number, ry: number, points: number, inner = 1, rotation = 0): Poly {
  const out: Poly = [];
  const n = Math.max(3, Math.round(points));
  const count = inner < 1 ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = rotation - Math.PI / 2 + (i / count) * Math.PI * 2;
    const k = inner < 1 && i % 2 ? inner : 1;
    out.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  return out;
}

/** Parses a CSS hex/rgb colour into [r, g, b] 0–255 (black when unknown). */
export function rgbOf(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.split('').slice(0, 3).map((x) => x + x).join('') : h.slice(0, 6);
    const v = parseInt(full, 16);
    if (Number.isFinite(v)) return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [0, 0, 0];
}

export const hexOf = (rgb: number[]) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Mixes a colour toward white (amount > 0) or black (amount < 0). */
export function shade(color: string, amount: number): string {
  const c = rgbOf(color);
  return hexOf(c.map((v) => (amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
}

const solved = new Map<string, number[]>();

/**
 * Riso separation of one colour: the coverage 0–1 of each ink whose multiplied print over the
 * paper best matches it (projected gradient descent on the multiply model, cached per colour).
 * So an AI can ask for "#8a3fb0" and get blue + pink overprinted.
 */
export function separate(color: string, inks: string[], paper = '#ffffff'): number[] {
  const key = `${color}|${inks.join(',')}|${paper}`;
  const hit = solved.get(key);
  if (hit) return hit;
  const target = rgbOf(color).map((v) => v / 255);
  const base = rgbOf(paper).map((v) => Math.max(0.05, v / 255));
  const ink = inks.map((i) => rgbOf(i).map((v) => v / 255));
  const a = ink.map(() => 0.5);
  const predict = () => [0, 1, 2].map((ch) => base[ch] * a.reduce((m, ai, i) => m * (1 - ai * (1 - ink[i][ch])), 1));
  for (let iter = 0; iter < 240; iter++) {
    const p = predict();
    for (let i = 0; i < a.length; i++) {
      let g = 0;
      for (let ch = 0; ch < 3; ch++) {
        const f = 1 - a[i] * (1 - ink[i][ch]);
        const dPd = f > 1e-4 ? (p[ch] / f) * -(1 - ink[i][ch]) : 0;
        g += 2 * (p[ch] - target[ch]) * dPd;
      }
      a[i] = clamp(a[i] - g * 0.6);
    }
  }
  const out = a.map((v) => (v < 0.04 ? 0 : v > 0.96 ? 1 : v));
  solved.set(key, out);
  if (solved.size > 512) solved.delete(solved.keys().next().value!);
  return out;
}
