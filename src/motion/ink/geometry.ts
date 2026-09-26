// What each drawn item is made of: ordered fills and strokes (polylines), dots and text runs, in
// the item's own space (centred on 0,0 inside its box). The look (paint.ts) decides how they are
// inked; motion verbs (draw-on, fill-in, pop) and placement are applied by draw.ts.
import { parseSvgPath, flatten, pathBounds } from '../vector/path';
import type { DrawItem, Face } from './types';
import { ellipsePts, hash, noise1, roundRectPts, rng, starPts, type Poly } from './core';

export type Mark = {
  kind: 'fill' | 'stroke';
  pts: Poly;
  closed: boolean;
  color: string;
  /** Second colour (crayon hatching mix, cut-paper streaks). */
  color2?: string;
  width?: number;
  alpha?: number;
  /** guide = construction line (thin, never boils much); detail = face/texture lines (no paper rim). */
  role?: 'outline' | 'guide' | 'detail' | 'glow';
  /** Excluded from draw-on (always shown). */
  always?: boolean;
  /** Dashed stroke [on, off] px. */
  dash?: number[];
};
export type Dot = { x: number; y: number; r: number; color: string; alpha?: number; star?: boolean };
export type TextRun = { text: string; x: number; y: number; font: string; size: number; color: string; align: 'left' | 'center' | 'right'; /** Letters to show (fractional = the current letter partly written). */ shown: number };
export type Geo = { marks: Mark[]; dots: Dot[]; texts: TextRun[] };

export type Palette = { line: string; fill: string; accent: string; paper: string; guide: string };

export type GeoEnv = {
  /** Held drawing time (s). */
  t: number;
  /** Drawing index (re-seeds the boil and flicker). */
  index: number;
  seed: number;
  pal: Palette;
  /** Box [w, h]. */
  w: number;
  h: number;
  /** The item's evaluated `progress` (tear). */
  progress?: number;
};

const TAU = Math.PI * 2;
const empty = (): Geo => ({ marks: [], dots: [], texts: [] });

function shape(g: Geo, it: DrawItem, pal: Palette, pts: Poly, closed = true, lineWidth?: number) {
  const fill = it.fill === undefined ? (closed ? pal.fill : null) : it.fill;
  const stroke = it.stroke === undefined ? pal.line : it.stroke;
  if (fill && closed) g.marks.push({ kind: 'fill', pts, closed, color: fill, color2: it.fill2, role: 'outline' });
  if (stroke) g.marks.push({ kind: 'stroke', pts, closed, color: stroke, width: lineWidth ?? 3, role: 'outline' });
}

/** A face drawn at (cx, cy) with feature spacing `s` (px between the eyes). */
export function faceMarks(face: Face, cx: number, cy: number, s: number, color = '#1d1b22', cheeks?: string): Geo {
  const g = empty();
  const lw = Math.max(1.5, s * 0.09);
  const eyes = [cx - s / 2, cx + s / 2];
  const stroke = (pts: Poly, closed = false, width = lw) => g.marks.push({ kind: 'stroke', pts, closed, color, width, role: 'detail', always: true });
  const fill = (pts: Poly) => g.marks.push({ kind: 'fill', pts, closed: true, color, role: 'detail', always: true });
  const e = s * 0.2;
  switch (face) {
    case 'dots': for (const x of eyes) fill(roundRectPts(x, cy, e * 1.1, e * 1.3, e * 0.2)); break;
    case 'wide': for (const x of eyes) fill(roundRectPts(x, cy, e * 1.9, e * 1.9, e * 0.3)); break;
    case 'happy': for (const x of eyes) stroke([x - e, cy + e * 0.45, x, cy - e * 0.55, x + e, cy + e * 0.45]); break;
    case 'squint': stroke([eyes[0] - e, cy - e * 0.6, eyes[0] + e * 0.6, cy, eyes[0] - e, cy + e * 0.6]); stroke([eyes[1] + e, cy - e * 0.6, eyes[1] - e * 0.6, cy, eyes[1] + e, cy + e * 0.6]); break;
    case 'closed': for (const x of eyes) stroke([x - e, cy, x + e, cy]); break;
    case 'sleepy': for (const x of eyes) stroke([x - e, cy - e * 0.2, x, cy + e * 0.4, x + e, cy - e * 0.2]); break;
    case 'dizzy':
      for (const x of eyes) {
        const p: Poly = [];
        for (let a = 0; a < TAU * 2.2; a += 0.35) p.push(x + Math.cos(a) * (a / (TAU * 2.2)) * e * 1.3, cy + Math.sin(a) * (a / (TAU * 2.2)) * e * 1.3);
        stroke(p);
      }
      break;
    case 'smile':
      for (const x of eyes) stroke([x - e * 0.8, cy + e * 0.3, x, cy - e * 0.4, x + e * 0.8, cy + e * 0.3]);
      stroke(arc(cx, cy + e * 1.2, e * 1.1, 0.15 * Math.PI, 0.85 * Math.PI));
      break;
    case 'surprised':
      for (const x of eyes) fill(ellipsePts(x, cy, e * 0.55, e * 0.65, 14));
      stroke(ellipsePts(cx, cy + e * 1.6, e * 0.45, e * 0.6, 14), true);
      break;
    case 'none': break;
  }
  if (cheeks) for (const x of [eyes[0] - e * 0.8, eyes[1] + e * 0.8]) g.marks.push({ kind: 'fill', pts: ellipsePts(x, cy + e * 1.3, e * 0.7, e * 0.45, 12), closed: true, color: cheeks, alpha: 0.75, role: 'detail', always: true });
  return g;
}

/** Rotates points about the origin by `a` radians. */
export function rotatePts(pts: Poly, a: number): Poly {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Poly = new Array(pts.length);
  for (let i = 0; i + 1 < pts.length; i += 2) { out[i] = pts[i] * c - pts[i + 1] * s; out[i + 1] = pts[i] * s + pts[i + 1] * c; }
  return out;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, ry = r): Poly {
  const p: Poly = [];
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r / 8));
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * ry); }
  return p;
}

const merge = (into: Geo, from: Geo) => { into.marks.push(...from.marks); into.dots.push(...from.dots); into.texts.push(...from.texts); return into; };

/** The face showing at time t (the last key at or before t). */
export function faceAt(it: DrawItem, t: number, fallback: Face): Face {
  let face = fallback;
  for (const k of [...(it.faces ?? [])].sort((a, b) => a.t - b.t)) if (k.t <= t + 1e-6) face = k.face;
  return face;
}

/** Points of an item given as absolute layer px, re-centred on their box (so rotation turns about it). */
export function pointsBox(points: number[] | undefined): { cx: number; cy: number; w: number; h: number } | null {
  if (!points || points.length < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) { x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1]); }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export function itemGeometry(it: DrawItem, env: GeoEnv): Geo {
  const { w, h, pal, t } = env;
  const rx = w / 2;
  const ry = h / 2;
  const R = Math.min(rx, ry);
  const seed = (it.seed ?? 0) * 7919 + env.seed;
  const g = empty();
  const lw = 3;
  switch (it.kind) {
    case 'circle':
    case 'ellipse': shape(g, it, pal, ellipsePts(0, 0, it.kind === 'circle' ? R : rx, it.kind === 'circle' ? R : ry)); break;
    case 'rect': shape(g, it, pal, roundRectPts(0, 0, w, h, it.radius ?? Math.min(w, h) * 0.08)); break;
    case 'polygon': shape(g, it, pal, starPts(0, 0, rx, ry, it.sides ?? 6)); break;
    case 'star': shape(g, it, pal, starPts(0, 0, rx, ry, it.sides ?? 5, it.inner ?? 0.45)); break;
    case 'heart': {
      const p: Poly = [];
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * TAU;
        const x = 16 * Math.sin(a) ** 3;
        const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        p.push((x / 17) * rx, (y / 17) * ry + ry * 0.05);
      }
      shape(g, it, pal, p);
      break;
    }
    case 'blob': {
      const p: Poly = [];
      const rough = it.rough ?? 0.35;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const k = 1 + rough * 0.5 * (noise1(Math.cos(a) * 1.6 + 5, seed) + noise1(Math.sin(a) * 1.6 + 9, seed + 1));
        p.push(Math.cos(a) * rx * k * 0.85, Math.sin(a) * ry * k * 0.85);
      }
      shape(g, it, pal, p);
      break;
    }
    case 'line':
    case 'trail': {
      const box = pointsBox(it.points);
      if (!box) break;
      const p = it.points!.map((v, i) => v - (i % 2 ? box.cy : box.cx));
      g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.stroke ?? pal.line, width: 3, role: 'outline', ...(it.kind === 'trail' ? { dash: [10, 9] } : {}) });
      break;
    }
    case 'path':
    case 'icon': {
      if (!it.d) break;
      const paths = parseSvgPath(it.d);
      const b = it.box && it.box.length >= 4 ? { x: it.box[0], y: it.box[1], width: it.box[2], height: it.box[3] } : pathBounds(paths);
      if (!b || b.width <= 0 && b.height <= 0) break;
      const k = Math.min(w / Math.max(1e-6, b.width), h / Math.max(1e-6, b.height));
      const ox = b.x + b.width / 2;
      const oy = b.y + b.height / 2;
      for (const sp of flatten(paths, 10)) {
        const p = sp.pts.map((v, i) => (v - (i % 2 ? oy : ox)) * k);
        if (sp.closed && p.length >= 6) shape(g, it, pal, p, true, it.kind === 'icon' ? Math.max(2, k * 2) : undefined);
        else g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.stroke ?? pal.line, width: it.kind === 'icon' ? Math.max(2, k * 2) : lw, role: 'outline' });
      }
      break;
    }
    case 'ripples': {
      // Film 1: rings grow out of a dot, a new one every `period`, thinning and fading as they go.
      const period = it.period ?? 1 / 6;
      const life = it.life ?? 0.75;
      const start = it.start ?? 0;
      const total = it.count ?? 999;
      const color = it.stroke ?? pal.line;
      for (let k = Math.max(0, Math.floor((t - start - life) / period)); k < total; k++) {
        const age = t - start - k * period;
        if (age < 0) break;
        if (age > life) continue;
        const u = age / life;
        const r = R * (1 - (1 - u) ** 2.2);
        g.marks.push({ kind: 'stroke', pts: ellipsePts(0, 0, (r * rx) / Math.max(1, R), (r * ry) / Math.max(1, R)), closed: true, color, width: 5 * (1 - 0.75 * u) + 0.8, alpha: 1 - u ** 3, role: 'outline', always: true });
      }
      if (it.fill !== null) g.dots.push({ x: 0, y: 0, r: Math.max(4, R * 0.035), color: it.fill ?? pal.accent });
      break;
    }
    case 'rose': {
      const k = it.n ?? 4;
      const turns = it.turns ?? (Number.isInteger(k) ? 1 : 4);
      const p: Poly = [];
      const steps = Math.ceil(720 * turns);
      for (let i = 0; i <= steps; i++) { const a = (i / steps) * TAU * turns; const r = Math.cos(k * a); p.push(Math.cos(a) * r * rx, Math.sin(a) * r * ry); }
      g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.stroke ?? pal.line, width: 2.5, role: 'outline' });
      break;
    }
    case 'lissajous': {
      const [a, b] = it.ratio && it.ratio.length >= 2 ? it.ratio : [3, 2];
      const p: Poly = [];
      for (let i = 0; i <= 900; i++) { const u = (i / 900) * TAU; p.push(Math.sin(a * u + Math.PI / 2) * rx, Math.sin(b * u) * ry); }
      g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.stroke ?? pal.line, width: 2.5, role: 'outline' });
      break;
    }
    case 'spiral': {
      // A nautilus: the golden spiral with its chamber walls.
      const turns = it.turns ?? 2.6;
      const b = Math.log((1 + Math.sqrt(5)) / 2) / (Math.PI / 2);
      const amax = turns * TAU;
      const a0 = R / Math.exp(b * amax);
      const at = (a: number) => [Math.cos(a) * a0 * Math.exp(b * a), Math.sin(a) * a0 * Math.exp(b * a)];
      const p: Poly = [];
      for (let i = 0; i <= 600; i++) { const [x, y] = at((i / 600) * amax); p.push(x, y); }
      const color = it.stroke ?? pal.line;
      g.marks.push({ kind: 'stroke', pts: p, closed: false, color, width: 2.5, role: 'outline' });
      for (let a = TAU; a <= amax; a += Math.PI / 5) {
        const [x1, y1] = at(a);
        const [x0, y0] = at(a - TAU);
        g.marks.push({ kind: 'stroke', pts: [x0, y0, (x0 + x1) / 2 + (y1 - y0) * 0.12, (y0 + y1) / 2 - (x1 - x0) * 0.12, x1, y1], closed: false, color, width: 1.6, role: 'outline' });
      }
      break;
    }
    case 'snowflake': {
      const arms = it.sides ?? 6;
      const color = it.stroke ?? pal.line;
      const branch = (x: number, y: number, ang: number, len: number, depth: number) => {
        const x2 = x + Math.cos(ang) * len;
        const y2 = y + Math.sin(ang) * len;
        g.marks.push({ kind: 'stroke', pts: [x, y, x2, y2], closed: false, color, width: Math.max(1, 3 - depth), role: 'outline' });
        if (depth >= 2) return;
        for (let k = 1; k <= 3; k++) {
          const bx = x + Math.cos(ang) * len * (k / 4);
          const by = y + Math.sin(ang) * len * (k / 4);
          const bl = len * 0.42 * (1 - k / 5);
          branch(bx, by, ang + Math.PI / 3, bl, depth + 1);
          branch(bx, by, ang - Math.PI / 3, bl, depth + 1);
        }
      };
      for (let i = 0; i < arms; i++) branch(0, 0, -Math.PI / 2 + (i / arms) * TAU, R, 0);
      g.marks.push({ kind: 'stroke', pts: starPts(0, 0, R * 0.16, R * 0.16, arms), closed: true, color, width: 2, role: 'outline' });
      break;
    }
    case 'web': {
      const spokes = it.sides ?? 12;
      const rings = it.count ?? 9;
      const color = it.stroke ?? pal.line;
      const angle = (i: number) => -Math.PI / 2 + (i / spokes) * TAU + (hash(i, seed) - 0.5) * 0.12;
      for (let i = 0; i < spokes; i++) g.marks.push({ kind: 'stroke', pts: [0, 0, Math.cos(angle(i)) * rx, Math.sin(angle(i)) * ry], closed: false, color, width: 1.8, role: 'outline' });
      for (let r = 1; r <= rings; r++) {
        const p: Poly = [];
        const k = r / (rings + 0.6);
        for (let i = 0; i <= spokes; i++) {
          const a0 = angle(i % spokes);
          const a1 = angle((i + 1) % spokes) + (i + 1 === spokes ? TAU : 0);
          p.push(Math.cos(a0) * rx * k, Math.sin(a0) * ry * k);
          if (i < spokes) { const am = (a0 + a1) / 2; p.push(Math.cos(am) * rx * k * 0.93, Math.sin(am) * ry * k * 0.93); }
        }
        g.marks.push({ kind: 'stroke', pts: p, closed: false, color, width: 1.3, role: 'outline' });
      }
      break;
    }
    case 'dandelion': {
      const seeds = it.count ?? 64;
      const color = it.stroke ?? pal.line;
      const head = R * 0.45;
      const hy = -ry + head * 1.1;
      g.marks.push({ kind: 'stroke', pts: [0, ry, head * 0.1, (ry + hy) / 2, 0, hy], closed: false, color: it.fill2 ?? '#6aa36b', width: 3, role: 'outline' });
      for (let i = 0; i < seeds; i++) {
        const a = (i / seeds) * TAU + hash(i, seed) * 0.2;
        const l = head * (0.8 + 0.2 * hash(i, seed + 1));
        const x = Math.cos(a) * l;
        const y = hy + Math.sin(a) * l;
        g.marks.push({ kind: 'stroke', pts: [0, hy, x, y], closed: false, color, width: 1.1, role: 'outline' });
        for (const d of [-0.5, 0, 0.5]) g.marks.push({ kind: 'stroke', pts: [x, y, x + Math.cos(a + d) * head * 0.12, y + Math.sin(a + d) * head * 0.12], closed: false, color, width: 0.9, role: 'detail' });
      }
      g.dots.push({ x: 0, y: hy, r: head * 0.1, color: it.fill ?? '#b0785a' });
      break;
    }
    case 'sparkle': {
      // Film 4: an eight-point star with a faint guide circle and ticks around it.
      const points = it.sides ?? 8;
      shape(g, { ...it, fill: it.fill === undefined ? '#ffffff' : it.fill }, pal, starPts(0, 0, R * 0.62, R * 0.62, points, it.inner ?? 0.42), true, 2.2);
      const color = it.stroke ?? pal.line;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8;
        g.marks.push({ kind: 'stroke', pts: [Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78, Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98], closed: false, color, width: 2, role: 'detail' });
      }
      break;
    }
    case 'burst': {
      const rays = it.sides ?? 12;
      const color = it.stroke ?? pal.line;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + hash(i, seed) * 0.25;
        const r0 = R * (0.55 + 0.1 * hash(i, seed + 2));
        g.marks.push({ kind: 'stroke', pts: [Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * R, Math.sin(a) * R], closed: false, color, width: 3, role: 'outline' });
      }
      break;
    }
    case 'constellation': {
      const box = pointsBox(it.points);
      if (!box) break;
      const p = it.points!.map((v, i) => v - (i % 2 ? box.cy : box.cx));
      const n = p.length / 2;
      const edges = it.edges && it.edges.length >= 2 ? it.edges : Array.from({ length: Math.max(0, n - 1) * 2 }, (_, i) => Math.floor(i / 2) + (i % 2));
      const color = it.stroke ?? '#ffffff';
      for (let e = 0; e + 1 < edges.length; e += 2) {
        const a = edges[e];
        const b = edges[e + 1];
        if (a >= n || b >= n) continue;
        g.marks.push({ kind: 'stroke', pts: [p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1]], closed: false, color, width: 2.2, role: 'outline' });
      }
      for (let i = 0; i < n; i++) g.dots.push({ x: p[i * 2], y: p[i * 2 + 1], r: 9 * (0.8 + 0.4 * hash(i, seed)), color: it.fill ?? '#ffffff', star: true });
      break;
    }
    case 'stars': {
      const count = it.count ?? 60;
      for (let i = 0; i < count; i++) {
        const twinkle = 0.55 + 0.45 * hash(i, seed, env.index);
        g.dots.push({ x: (hash(i, seed, 1) - 0.5) * w, y: (hash(i, seed, 2) - 0.5) * h, r: 1.5 + 3.5 * hash(i, seed, 3) ** 2, color: hash(i, seed, 4) < 0.2 && it.fill2 ? it.fill2 : (it.fill ?? '#fff6c8'), alpha: twinkle, star: hash(i, seed, 5) < 0.25 });
      }
      break;
    }
    case 'waves': {
      const count = it.count ?? 5;
      const colors = it.colors?.length ? it.colors : [it.stroke ?? pal.line];
      for (let k = 0; k < count; k++) {
        const y0 = -ry + (h * (k + 0.5)) / count;
        const p: Poly = [];
        const amp = (h / count) * 0.28 * (it.rough ?? 1);
        const phase = t * 1.4 + k * 1.3;
        for (let x = -rx; x <= rx + 0.1; x += Math.max(6, w / 80)) p.push(x, y0 + Math.sin(x / (w / 5) * TAU + phase) * amp);
        if (it.fill) {
          const band = [...p, rx, ry, -rx, ry];
          g.marks.push({ kind: 'fill', pts: band, closed: true, color: colors.length > 1 ? colors[k % colors.length] : it.fill, color2: it.fill2, role: 'outline' });
        }
        g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.stroke ?? colors[k % colors.length], width: 3, role: 'outline' });
      }
      break;
    }
    case 'hills': {
      const colors = it.colors?.length ? it.colors : ['#8e86cf', '#3f8f78', '#5fb35a'];
      colors.forEach((color, k) => {
        const top = -ry + (h * (k + 0.6)) / (colors.length + 0.6);
        const amp = (h / colors.length) * 0.35 * (it.rough ?? 1);
        const p: Poly = [];
        for (let x = -rx; x <= rx + 0.1; x += Math.max(6, w / 90)) p.push(x, top + noise1(x / (w / 2.4) + k * 7, seed + k) * amp);
        p.push(rx, ry, -rx, ry);
        g.marks.push({ kind: 'fill', pts: p, closed: true, color, color2: it.fill2, role: 'outline' });
        if (it.stroke) g.marks.push({ kind: 'stroke', pts: p.slice(0, -4), closed: false, color: it.stroke, width: 2.5, role: 'outline' });
      });
      break;
    }
    case 'sun': {
      const rays = it.sides ?? 9;
      const color = it.fill ?? '#f6b73c';
      shape(g, { ...it, fill: color }, pal, ellipsePts(0, 0, R * 0.55, R * 0.55));
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU;
        const p: Poly = [];
        for (let k = 0; k <= 8; k++) { const r = R * (0.68 + 0.3 * (k / 8)); const wv = Math.sin(k * 1.6 + i) * R * 0.035; p.push(Math.cos(a) * r - Math.sin(a) * wv, Math.sin(a) * r + Math.cos(a) * wv); }
        g.marks.push({ kind: 'stroke', pts: p, closed: false, color: it.fill2 ?? (i % 2 ? '#e8583a' : '#f0b33a'), width: 4, role: 'outline' });
      }
      break;
    }
    case 'moon': {
      shape(g, { ...it, fill: it.fill ?? '#efece0' }, pal, ellipsePts(0, 0, R, R));
      const r = rng(seed + 5);
      for (let i = 0; i < 4; i++) {
        const cr = R * (0.12 + 0.14 * r());
        const a = r() * TAU;
        const d = R * 0.5 * r();
        g.marks.push({ kind: 'fill', pts: ellipsePts(Math.cos(a) * d, Math.sin(a) * d, cr, cr, 20), closed: true, color: it.fill2 ?? '#d2cfc4', role: 'detail' });
      }
      break;
    }
    case 'cloud': {
      const p: Poly = [];
      const bumps = [[-0.55, 0.25, 0.42], [-0.18, -0.05, 0.55], [0.3, -0.1, 0.5], [0.62, 0.25, 0.38]];
      const top = (x: number) => {
        let y = ry * 0.45;
        for (const [bx, by, br] of bumps) { const dx = (x / rx - bx) / br; if (Math.abs(dx) < 1) y = Math.min(y, (by - br * Math.sqrt(1 - dx * dx)) * ry); }
        return y;
      };
      for (let x = -rx * 0.95; x <= rx * 0.95; x += rx / 30) p.push(x, top(x));
      p.push(rx * 0.95, ry * 0.45, -rx * 0.95, ry * 0.45);
      shape(g, { ...it, fill: it.fill === undefined ? '#ffffff' : it.fill }, pal, p);
      break;
    }
    case 'flower': {
      const petals = it.sides ?? 5;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * TAU - Math.PI / 2;
        const p = rotatePts(ellipsePts(0, -R * 0.48, R * 0.26, R * 0.46, 22), a + Math.PI / 2);
        shape(g, { ...it, fill: it.fill ?? '#f28fb5' }, pal, p, true, 2);
      }
      shape(g, { ...it, fill: it.fill2 ?? '#f5c542' }, pal, ellipsePts(0, 0, R * 0.22, R * 0.22, 20), true, 2);
      break;
    }
    case 'tree': {
      shape(g, { ...it, fill: it.fill2 ?? '#7a4b2e' }, pal, roundRectPts(0, ry * 0.45, w * 0.12, h * 0.5, 4));
      const crown: Poly = [];
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * TAU;
        const k = 1 + 0.08 * Math.sin(a * 7 + seed) + 0.05 * noise1(i / 6, seed);
        crown.push(Math.cos(a) * rx * 0.85 * k, -ry * 0.18 + Math.sin(a) * ry * 0.58 * k);
      }
      shape(g, { ...it, fill: it.fill ?? '#3f9a4f' }, pal, crown);
      break;
    }
    case 'grass': {
      const count = it.count ?? Math.max(12, Math.round(w / 14));
      const color = it.stroke ?? '#2f7d3b';
      for (let i = 0; i < count; i++) {
        const x = -rx + w * hash(i, seed, 1);
        const len = h * (0.35 + 0.65 * hash(i, seed, 2));
        const lean = (hash(i, seed, 3) - 0.5) * len * 0.5 + Math.sin(t * 2 + i) * 2;
        g.marks.push({ kind: 'stroke', pts: [x, ry, x + lean * 0.4, ry - len * 0.55, x + lean, ry - len], closed: false, color, width: 2, role: 'outline' });
      }
      break;
    }
    case 'rain': {
      const count = it.count ?? 40;
      const color = it.stroke ?? '#6fa8e8';
      const speed = h * 1.4;
      for (let i = 0; i < count; i++) {
        const x = -rx + w * hash(i, seed, 1);
        const y = -ry + ((hash(i, seed, 2) * h + (t - (it.start ?? 0)) * speed) % h);
        g.marks.push({ kind: 'stroke', pts: [x, y, x - 3, y + Math.min(26, h * 0.05)], closed: false, color, width: 3, role: 'outline', always: true });
      }
      break;
    }
    case 'planet': {
      const body = ellipsePts(0, 0, R * 0.62, R * 0.62);
      shape(g, { ...it, fill: it.fill ?? '#e3b25a' }, pal, body);
      for (let k = -1; k <= 1; k++) g.marks.push({ kind: 'stroke', pts: arc(0, k * R * 0.22, R * 0.6 * Math.cos(Math.asin(Math.min(0.99, Math.abs(k * 0.35)))), Math.PI * 0.05, Math.PI * 0.95, R * 0.08), closed: false, color: it.fill2 ?? '#c98b3a', width: 3, role: 'detail' });
      g.marks.push({ kind: 'stroke', pts: ellipsePts(0, 0, R, R * 0.26).map((v, i) => (i % 2 ? v + 0 : v)), closed: true, color: it.stroke ?? '#e6806a', width: Math.max(6, R * 0.09), role: 'outline' });
      break;
    }
    case 'bot': {
      // Films 2 and 4: the cube creature — body, stubby arms, legs, a replaceable face.
      const bw = w * 0.66;
      const bh = h * 0.52;
      const cy = -h * 0.08;
      const color = it.fill ?? '#ec8452';
      const line = it.stroke === undefined ? pal.line : it.stroke;
      const part = (pts: Poly) => shape(g, { ...it, fill: color, stroke: line }, pal, pts, true, 2.5);
      const legs = it.legs ?? 4;
      const lw2 = (bw * 0.8) / (legs * 1.35);
      for (let i = 0; i < legs; i++) part(roundRectPts(-bw * 0.4 + lw2 / 2 + (i * (bw * 0.8 - lw2)) / Math.max(1, legs - 1), cy + bh / 2 + h * 0.1, lw2, h * 0.22, lw2 * 0.25));
      if (it.arms !== false) for (const s of [-1, 1]) part(roundRectPts(s * (bw / 2 + w * 0.05), cy + bh * 0.06, w * 0.1, h * 0.12, 3));
      part(roundRectPts(0, cy, bw, bh, Math.min(bw, bh) * 0.06));
      merge(g, faceMarks(faceAt(it, t, 'dots'), 0, cy - bh * 0.05, bw * 0.4, '#1b1a20'));
      break;
    }
    case 'sprite': {
      // Film 5: the sun-sprite — a round body with torn-paper tentacle rays and a face.
      const rays = it.sides ?? 12;
      const color = it.fill ?? '#df6c52';
      const body = R * 0.3;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + Math.sin(t * 2.2 + i * 1.7) * 0.06;
        const len = R * (0.92 + 0.08 * hash(i, seed));
        const ww = body * 0.48;
        const p: Poly = [];
        for (let k = 0; k <= 10; k++) {
          const s = k / 10;
          const bend = Math.sin(s * Math.PI) * Math.sin(t * 1.8 + i) * R * 0.05;
          const cx = Math.cos(a) * len * (0.2 + 0.8 * s) - Math.sin(a) * bend;
          const cyy = Math.sin(a) * len * (0.2 + 0.8 * s) + Math.cos(a) * bend;
          p.push(cx, cyy);
        }
        const rb: Poly = [];
        const n = p.length / 2;
        for (let k = 0; k < n; k++) rb.push(p[k * 2] - Math.sin(a) * ww * 0.5, p[k * 2 + 1] + Math.cos(a) * ww * 0.5);
        for (let k = 0; k <= 6; k++) { const aa = a - Math.PI / 2 + (k / 6) * Math.PI; rb.push(p[(n - 1) * 2] + Math.cos(aa) * ww * 0.5, p[(n - 1) * 2 + 1] + Math.sin(aa) * ww * 0.5); }
        for (let k = n - 1; k >= 0; k--) rb.push(p[k * 2] + Math.sin(a) * ww * 0.5, p[k * 2 + 1] - Math.cos(a) * ww * 0.5);
        g.marks.push({ kind: 'fill', pts: rb, closed: true, color, color2: it.fill2, role: 'outline' });
      }
      g.marks.push({ kind: 'fill', pts: ellipsePts(0, 0, body, body), closed: true, color, color2: it.fill2, role: 'outline' });
      merge(g, faceMarks(faceAt(it, t, 'closed'), 0, 0, body * 0.9, '#1b1a20', it.cheeks === false ? undefined : '#f2a0a0'));
      break;
    }
    case 'write': {
      const size = it.fontSize ?? Math.max(24, h * 0.7);
      const text = it.text ?? '';
      const total = [...text.replace(/\n/g, '')].length;
      const from = it.from ?? it.in ?? 0;
      const shown = it.draw !== undefined ? total : Math.max(0, (t - from) * (it.cps ?? 12));
      const align = it.align ?? 'center';
      const lines = text.split('\n');
      let used = 0;
      lines.forEach((line, i) => {
        const count = [...line].length;
        g.texts.push({ text: line, x: align === 'center' ? 0 : align === 'left' ? -rx : rx, y: (i - (lines.length - 1) / 2) * size * 1.15, font: `${it.weight ?? 500} ${size}px "${it.font ?? 'Caveat'}", "Comic Sans MS", cursive`, size, color: it.fill ?? it.stroke ?? '#2e4a9e', align, shown: Math.max(0, Math.min(count, shown - used)) });
        used += count;
      });
      break;
    }
    case 'note': {
      const paper = it.fill ?? '#fbf8ef';
      const top: Poly = [];
      for (let x = -rx; x <= rx + 0.1; x += 6) top.push(x, -ry + 4 * noise1(x / 7, seed) + 3 * hash(Math.round(x), seed));
      g.marks.push({ kind: 'fill', pts: [...top, rx, ry, -rx, ry], closed: true, color: paper, role: 'outline' });
      const lines = Math.max(3, Math.floor(h / 34));
      for (let i = 1; i < lines; i++) { const y = -ry + (h * i) / lines + 6; g.marks.push({ kind: 'stroke', pts: [-rx + 6, y, rx - 6, y], closed: false, color: '#a9c1e6', width: 1.4, role: 'guide', always: true }); }
      g.marks.push({ kind: 'stroke', pts: [-rx + w * 0.12, -ry + 8, -rx + w * 0.12, ry], closed: false, color: '#e8a0a0', width: 1.4, role: 'guide', always: true });
      if (it.stroke) g.marks.push({ kind: 'stroke', pts: [...top, rx, ry, -rx, ry], closed: true, color: it.stroke, width: 2, role: 'outline', always: true });
      break;
    }
    case 'construction': {
      // Film 4: graph paper, a guide circle, a centre cross and wavy guides, in pale blue.
      const guide = it.stroke ?? pal.guide;
      const cell = Math.max(12, Math.min(w, h) / 22);
      for (let x = -rx; x <= rx; x += cell) g.marks.push({ kind: 'stroke', pts: [x, -ry, x, ry], closed: false, color: guide, width: 0.8, alpha: 0.35, role: 'guide', always: true });
      for (let y = -ry; y <= ry; y += cell) g.marks.push({ kind: 'stroke', pts: [-rx, y, rx, y], closed: false, color: guide, width: 0.8, alpha: 0.35, role: 'guide', always: true });
      g.marks.push({ kind: 'stroke', pts: ellipsePts(0, -ry * 0.28, R * 0.22, R * 0.22), closed: true, color: guide, width: 2, role: 'guide' });
      g.marks.push({ kind: 'stroke', pts: [0, -ry * 0.7, 0, ry * 0.75], closed: false, color: guide, width: 1.6, role: 'guide' });
      g.marks.push({ kind: 'stroke', pts: [-rx * 0.5, ry * 0.2, rx * 0.5, ry * 0.2], closed: false, color: guide, width: 1.6, role: 'guide' });
      for (let k = 0; k < 3; k++) {
        const p: Poly = [];
        for (let x = -rx; x <= rx + 0.1; x += w / 60) p.push(x, -ry * 0.5 + k * ry * 0.55 + Math.sin(x / w * TAU * 1.2 + k) * ry * 0.06);
        g.marks.push({ kind: 'stroke', pts: p, closed: false, color: guide, width: 1.8, alpha: 0.8, role: 'guide' });
      }
      break;
    }
    case 'trace': {
      // Film 3: a signal line; spikes rise in one frame and decay (the window scrolls with time).
      const win = it.window ?? 3;
      const decay = it.decay ?? 0.33;
      const colors = it.colors?.length ? it.colors : ['#a8f0c8', '#f4b39a'];
      colors.forEach((color, ch) => {
        const amp = ch === 0 ? 1 : 0.12;
        const p: Poly = [];
        const steps = Math.max(60, Math.round(w / 3));
        for (let i = 0; i <= steps; i++) {
          const tau = t - win + (i / steps) * win;
          let v = 0;
          for (const s of it.spikes ?? []) { const age = tau - s; if (age >= 0) v += age < 1 / 24 ? age * 24 : Math.exp(-(age - 1 / 24) / decay); }
          p.push(-rx + (i / steps) * w, ry - 6 - Math.min(1.2, v) * amp * (h - 12));
        }
        g.marks.push({ kind: 'stroke', pts: p, closed: false, color, width: 2.4, role: 'glow', always: true });
      });
      break;
    }
    case 'cloud-points': {
      // Film 3: a glowing point cloud in three lobes; regions flare with the spikes.
      const count = it.count ?? 900;
      const colors = it.colors?.length ? it.colors : ['#7ef0b0', '#8fa8ff', '#ff8a6a', '#d990ff'];
      let flare = 0;
      for (const s of it.spikes ?? []) { const age = t - s; if (age >= 0) flare = Math.max(flare, Math.exp(-age / (it.decay ?? 0.33))); }
      const lobes = [[-0.42, -0.1, 0.34, 0.3], [0.42, -0.1, 0.34, 0.3], [0, -0.02, 0.3, 0.36], [0, 0.42, 0.07, 0.3]];
      for (let i = 0; i < count; i++) {
        const lobe = lobes[Math.floor(hash(i, seed, 1) * lobes.length)];
        const a = hash(i, seed, 2) * TAU;
        const d = Math.sqrt(hash(i, seed, 3));
        const region = Math.floor(hash(i, seed, 4) * colors.length);
        const hot = region === 2 ? flare : 0;
        g.dots.push({ x: (lobe[0] + Math.cos(a) * lobe[2] * d) * rx, y: (lobe[1] + Math.sin(a) * lobe[3] * d) * ry, r: 1 + 1.6 * hash(i, seed, 5) + hot * 1.2, color: colors[region], alpha: 0.18 + 0.22 * hash(i, seed, 6) + hot * 0.45 });
      }
      break;
    }
    case 'tear': {
      // Film 4's page turn: a region swept in from the left up to a jagged torn edge.
      const p = env.progress ?? 1;
      const margin = w * 0.08;
      const edge = -rx - margin + (w + margin * 2) * p;
      const edgeX = (y: number) => edge + noise1(y / 60, seed) * w * 0.035 + (hash(Math.round(y), seed) - 0.5) * 9;
      const ys: number[] = [];
      for (let y = -ry - 20; y <= ry + 20; y += 7) ys.push(y);
      if (it.rim) {
        // Only the torn white strip along the edge: the paper that tore (drawn over the cut).
        const band = it.rim;
        const pts: Poly = [];
        for (const y of ys) pts.push(edgeX(y), y);
        for (let k = ys.length - 1; k >= 0; k--) pts.push(edgeX(ys[k]) - band * (0.6 + 0.8 * hash(k, seed + 9)), ys[k]);
        g.marks.push({ kind: 'fill', pts, closed: true, color: it.fill ?? '#fbf6ea', role: 'detail' });
      } else {
        const pts: Poly = [-rx - w, -ry - 20];
        for (const y of ys) pts.push(edgeX(y), y);
        pts.push(-rx - w, ry + 20);
        g.marks.push({ kind: 'fill', pts, closed: true, color: it.fill ?? '#ffffff', role: 'outline' });
      }
      break;
    }
    case 'pen':
    case 'group':
      break;
  }
  return g;
}

/** The pen tool's own drawing (tip at 0,0, handle up and to the right), `s` = nib length px. */
export function penGeometry(tool: string, s: number, angle: number): Geo {
  const g = empty();
  const rot = (pts: Poly) => rotatePts(pts, angle);
  const line = '#23222a';
  // Local frame: the tool points down-left along -x; +x runs up the handle.
  const along = (x0: number, x1: number, w0: number, w1: number): Poly => [x0, -w0 / 2, x1, -w1 / 2, x1, w1 / 2, x0, w0 / 2];
  const add = (pts: Poly, fill: string, width = 2) => {
    g.marks.push({ kind: 'fill', pts: rot(pts), closed: true, color: fill, role: 'detail', always: true });
    g.marks.push({ kind: 'stroke', pts: rot(pts), closed: true, color: line, width, role: 'detail', always: true });
  };
  if (tool === 'pencil' || tool === 'crayon') {
    add(along(s * 0.38, s * 4, s * 0.3, s * 0.3), tool === 'crayon' ? '#e8583a' : '#2f6b4f');
    add([0, 0, s * 0.38, -s * 0.15, s * 0.38, s * 0.15], '#e9c89a');
    add([0, 0, s * 0.12, -s * 0.05, s * 0.12, s * 0.05], '#3a3a3a', 1);
  } else if (tool === 'brush') {
    add(along(s * 1.1, s * 4.2, s * 0.22, s * 0.26), '#c98c50');
    add(along(s * 0.8, s * 1.1, s * 0.26, s * 0.26), '#6b6d75');
    add([0, 0, s * 0.3, -s * 0.16, s * 0.8, -s * 0.13, s * 0.8, s * 0.13, s * 0.3, s * 0.16], '#3a3036');
  } else {
    // The dip nib of Film 4: wooden handle, steel ferrule, white nib with a slit and breather hole.
    add(along(s * 1.25, s * 4.6, s * 0.3, s * 0.34), '#c98c50');
    add(along(s * 0.95, s * 1.25, s * 0.34, s * 0.34), '#5b5d66');
    add([0, 0, s * 0.35, -s * 0.13, s * 0.95, -s * 0.2, s * 0.95, s * 0.2, s * 0.35, s * 0.13], '#f6f3ec');
    g.marks.push({ kind: 'stroke', pts: rot([s * 0.05, 0, s * 0.5, 0]), closed: false, color: line, width: 1.4, role: 'detail', always: true });
    g.marks.push({ kind: 'stroke', pts: rot(ellipsePts(s * 0.55, 0, s * 0.06, s * 0.06, 10)), closed: true, color: line, width: 1.4, role: 'detail', always: true });
  }
  return g;
}
