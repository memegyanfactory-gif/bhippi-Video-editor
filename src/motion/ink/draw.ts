// Draws a `drawing` layer for one frame. The steps:
// · the drawing clock (on twos…);
// · each item placed, popped, wobbled (boil) and drawn on;
// · the pen following the tip of whatever is being drawn;
// · painted in the look.
// Riso draws coverage into one canvas per ink plate; the GPU screens and prints them
// (RISO_FS). Every other look paints colour straight into one canvas.
import { num, vec, type ExprContext } from '../anim';
import { clamp, drawingClock, hash, pointAt, polyLength, ribbon, separate, shade, tornEdge, trimPoly, wobble, bounds, rgbOf, noise1, type Poly } from './core';
import { itemGeometry, penGeometry, pointsBox, type Dot, type Geo, type Mark, type Palette, type TextRun } from './geometry';
import type { DrawItem, DrawingData, Look } from './types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Default inks per look (riso plates; the palette for the others). */
export const LOOK_INKS: Record<Look, string[]> = {
  riso: ['#2f6fb0', '#ff48b0', '#ffe800', '#3b2f8f'],
  crayon: ['#2a2733', '#ec8452', '#5fb35a', '#8e86cf'],
  ink: ['#1d1b22', '#e8583a', '#2f6fb0'],
  pencil: ['#3a3a42', '#8a8a92'],
  'cut-paper': ['#df6c52', '#f2c14e', '#3d6fb6', '#e98fb0'],
  felt: ['#2e3a8c', '#f2c14e', '#df6c52'],
  flat: ['#1d1b22', '#ff5a6e', '#4cc9f0'],
  scope: ['#a8f0c8', '#f4b39a', '#8fa8ff'],
};

const DEFAULT_BOIL: Record<Look, number> = { riso: 0.6, crayon: 1.2, ink: 1, pencil: 1.3, 'cut-paper': 0.8, felt: 0.8, flat: 0, scope: 0 };

export function lookPalette(data: DrawingData): Palette {
  const inks = data.inks?.length ? data.inks : LOOK_INKS[data.look] ?? LOOK_INKS.flat;
  switch (data.look) {
    case 'riso': return { line: inks[inks.length > 3 ? 3 : 0], fill: inks[0], accent: inks[1] ?? inks[0], paper: data.paper ?? '#efe9df', guide: inks[0] };
    case 'scope': return { line: inks[0], fill: inks[2] ?? inks[0], accent: inks[1] ?? inks[0], paper: data.paper ?? '#111214', guide: '#3a3f48' };
    case 'pencil': return { line: inks[0], fill: inks[1] ?? '#9a9aa2', accent: '#e8583a', paper: data.paper ?? '#f3efe6', guide: '#9fb6d8' };
    default: return { line: inks[0], fill: inks[1] ?? inks[0], accent: inks[2] ?? inks[1] ?? inks[0], paper: data.paper ?? '#f2ecdf', guide: '#6f8fd8' };
  }
}

/** The box an item draws in when it gives no `size`: full-layer motifs fill the layer. */
const FULL = new Set(['hills', 'stars', 'waves', 'construction', 'rain', 'grass', 'ripples', 'tear']);
function defaultSize(it: DrawItem, W: number, H: number): [number, number] {
  if (FULL.has(it.kind)) return [W, it.kind === 'grass' ? H * 0.12 : H];
  const m = Math.min(W, H);
  switch (it.kind) {
    case 'write': return [W * 0.6, m * 0.12];
    case 'note': return [m * 0.5, m * 0.38];
    case 'trace': return [W * 0.8, H * 0.2];
    case 'cloud-points': return [m * 0.6, m * 0.4];
    case 'pen': return [m * 0.06, m * 0.06];
    case 'bot': return [m * 0.36, m * 0.36];
    case 'sprite': return [m * 0.42, m * 0.42];
    default: return [m * 0.3, m * 0.3];
  }
}

type Placed = {
  it: DrawItem;
  index: number;
  m: number[];
  opacity: number;
  geo: Geo;
  draw: number;
  fillIn: number;
  burst: boolean;
  box: [number, number];
  /** Where the drawn line currently ends (the pen's target), layer px. */
  tip: { x: number; y: number; angle: number } | null;
  start: [number, number] | null;
  end: [number, number] | null;
};

const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mulM = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const xform = (m: number[], p: Poly): Poly => { const o = new Array(p.length); for (let i = 0; i + 1 < p.length; i += 2) { o[i] = m[0] * p[i] + m[2] * p[i + 1] + m[4]; o[i + 1] = m[1] * p[i] + m[3] * p[i + 1] + m[5]; } return o; };

/** Time at which a keyed 0→1 prop first reaches `v` (for the pen's schedule), or null. */
function reachTime(prop: DrawItem['draw'], v: number): number | null {
  if (prop === undefined) return null;
  if (typeof prop === 'number') return prop >= v ? -Infinity : null;
  const keys = (prop as { k?: { t: number; v: number | number[] }[] }).k;
  if (!Array.isArray(keys)) return null;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const cur = Number(sorted[i].v);
    if (cur >= v) {
      if (i === 0) return sorted[i].t;
      const prev = Number(sorted[i - 1].v);
      const u = cur === prev ? 1 : (v - prev) / (cur - prev);
      return sorted[i - 1].t + (sorted[i].t - sorted[i - 1].t) * clamp(u);
    }
  }
  return null;
}

/** Resolves every item of the drawing at time t into placed geometry (pure; the unit tests read it). */
export function placeItems(data: DrawingData, size: [number, number], t: number, ctx: ExprContext = { seed: 1 }): { placed: Placed[]; pens: Placed[]; clock: { t: number; index: number } } {
  const [W, H] = size;
  const clock = drawingClock(t, data.step ?? 1, data.fps ?? 24);
  const tq = clock.t;
  const stepDur = Math.max(1, data.step ?? 1) / (data.fps ?? 24);
  const pal = lookPalette(data);
  const seed = (data.seed ?? 1) * 101 + (ctx.seed ?? 1);
  const boil = data.boil ?? DEFAULT_BOIL[data.look] ?? 0;
  const placed: Placed[] = [];
  const pens: Placed[] = [];
  let index = 0;

  const visit = (items: DrawItem[], parent: number[], parentOpacity: number) => {
    for (const it of items) {
      const i = index++;
      if (!it || typeof it !== 'object') continue;
      if (typeof it.in === 'number' && tq < it.in - 1e-6) continue;
      if (typeof it.out === 'number' && tq >= it.out - 1e-6) continue;
      let burst = false;
      let popScale = 1;
      if (typeof it.pop === 'number') {
        const age = tq - it.pop;
        if (age < -1e-6) continue;
        // Film 5: two drawings big with burst ticks, one a touch big, then rest.
        if (age < stepDur * 2 - 1e-6) { popScale = 1.16; burst = true; } else if (age < stepDur * 3 - 1e-6) popScale = 1.05;
      }
      const pb = pointsBox(it.points);
      const box: [number, number] = (() => {
        if (it.size !== undefined) { const s = vec(it.size as never, tq, [100, 100], ctx); return [Math.max(1, s[0]), Math.max(1, s.length > 1 ? s[1] : s[0])]; }
        if (pb) return [pb.w, pb.h];
        return defaultSize(it, W, H);
      })();
      const at = vec(it.at, tq, pb ? [pb.cx, pb.cy] : FULL.has(it.kind) ? [W / 2, it.kind === 'grass' ? H - box[1] / 2 : H / 2] : [W / 2, H / 2], ctx);
      const rot = (num(it.rotation, tq, 0, ctx) * Math.PI) / 180;
      const sc = vec(it.scale as never, tq, [100, 100], ctx);
      const sx = (sc[0] / 100) * popScale;
      const sy = ((sc.length > 1 ? sc[1] : sc[0]) / 100) * popScale;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const local = [c * sx, s * sx, -s * sy, c * sy, at[0], at[1]];
      const m = mulM(parent, local);
      const opacity = parentOpacity * clamp(num(it.opacity, tq, 100, ctx) / 100);
      if (it.kind === 'group') {
        // Children are laid out in the group's box, top-left at 0,0.
        visit(it.items ?? [], mulM(m, [1, 0, 0, 1, -box[0] / 2, -box[1] / 2]), opacity);
        continue;
      }
      const draw = it.draw === undefined ? 1 : clamp(num(it.draw, tq, 1, ctx));
      const fillIn = it.fillIn !== undefined ? clamp(num(it.fillIn, tq, 1, ctx)) : draw;
      const geo = it.kind === 'pen' ? { marks: [], dots: [], texts: [] } : itemGeometry(it, { t: tq, index: clock.index, seed: seed + i * 131, pal, w: box[0], h: box[1], progress: clamp(num(it.progress, tq, 1, ctx)) });
      if (it.draw !== undefined && draw < 1) geo.marks = geo.marks.filter((mk) => !(mk.role === 'detail' && mk.always));
      const entry: Placed = { it, index: i, m, opacity, geo, draw, fillIn, burst, box, tip: null, start: null, end: null };
      // World-space marks, boiled: a fill and its outline share points, so they wobble as one.
      const amp = boil + (it.wobble ?? 0);
      const wob = new Map<Poly, Poly>();
      const scaleK = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      entry.geo = {
        marks: geo.marks.map((mk, k) => {
          let pts = wob.get(mk.pts);
          if (!pts) {
            pts = xform(m, mk.pts);
            const a = mk.role === 'guide' ? amp * 0.35 : amp;
            if (a > 0) pts = wobble(pts, a, Math.floor(hash(clock.index, i, seed) * 1e6) + k * 0, 42, mk.closed);
            wob.set(mk.pts, pts);
          }
          return { ...mk, pts, width: (mk.width ?? 3) * (it.width !== undefined ? num(it.width, tq, 3, ctx) / 3 : 1) * scaleK };
        }),
        dots: geo.dots.map((d) => { const [x, y] = apply(m, d.x, d.y); return { ...d, x, y, r: d.r * scaleK }; }),
        texts: geo.texts,
      };
      // Draw-on across the item's strokes in order; the tip is where the line ends now.
      const strokes = entry.geo.marks.filter((mk) => mk.kind === 'stroke' && !mk.always);
      const total = strokes.reduce((sum, mk) => sum + polyLength(mk.pts, mk.closed), 0);
      if (strokes.length) {
        entry.start = [strokes[0].pts[0], strokes[0].pts[1]];
        const last = strokes[strokes.length - 1];
        const endAt = pointAt(last.pts, polyLength(last.pts, last.closed), last.closed);
        entry.end = [endAt.x, endAt.y];
      }
      if (it.draw !== undefined && draw < 1 && total > 0) {
        let left = draw * total;
        for (const mk of strokes) {
          const len = polyLength(mk.pts, mk.closed);
          if (left <= 0) { mk.pts = []; continue; }
          if (left < len) { const p = pointAt(mk.pts, left, mk.closed); entry.tip = { x: p.x, y: p.y, angle: p.angle }; mk.pts = trimPoly(mk.pts, left, mk.closed); mk.closed = false; }
          left -= len;
        }
      }
      if (it.kind === 'pen') pens.push(entry);
      else placed.push(entry);
    }
  };
  visit(data.items ?? [], [1, 0, 0, 1, 0, 0], 1);
  return { placed, pens, clock };
}

/** Where the pen is: on the tip being drawn, travelling between items, or at rest. */
export function penPosition(pen: Placed, placed: Placed[], textTips: Map<number, { x: number; y: number }>, tq: number): { x: number; y: number; drawing: boolean } {
  const ids = pen.it.follow;
  const followed = placed.filter((p) => (ids?.length ? ids.includes(p.it.id ?? '') : p.it.draw !== undefined || p.it.kind === 'write'));
  for (let k = followed.length - 1; k >= 0; k--) {
    const p = followed[k];
    const tt = textTips.get(p.index);
    if (tt) return { ...tt, drawing: true };
    if (p.tip) return { x: p.tip.x, y: p.tip.y, drawing: true };
  }
  // Between strokes: glide from the end of the last finished item to the start of the next.
  const sched = followed.map((p) => {
    const startT = p.it.kind === 'write' ? (p.it.from ?? p.it.in ?? 0) : reachTime(p.it.draw, 1e-3);
    const endT = p.it.kind === 'write' ? (p.it.from ?? p.it.in ?? 0) + [...(p.it.text ?? '').replace(/\n/g, '')].length / (p.it.cps ?? 12) : reachTime(p.it.draw, 1);
    return { p, startT: startT ?? Infinity, endT: endT ?? Infinity };
  }).filter((s) => Number.isFinite(s.startT)).sort((a, b) => a.startT - b.startT);
  const restAt = pen.it.rest ?? (pen.m ? [pen.m[4], pen.m[5]] : [0, 0]);
  let prev: (typeof sched)[number] | null = null;
  for (const s of sched) {
    if (s.startT > tq) {
      const from = prev?.p.end ?? restAt;
      const to = s.p.start ?? restAt;
      const t0 = prev ? prev.endT : s.startT - 0.6;
      const u = clamp((tq - t0) / Math.max(0.05, s.startT - t0));
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      return { x: from[0] + (to[0] - from[0]) * e, y: from[1] + (to[1] - from[1]) * e - Math.sin(Math.PI * u) * 30, drawing: false };
    }
    prev = s;
  }
  if (prev?.p.end) {
    const u = clamp((tq - prev.endT) / 0.5);
    return { x: prev.p.end[0] + ((restAt[0] - prev.p.end[0]) * u), y: prev.p.end[1] + ((restAt[1] - prev.p.end[1]) * u), drawing: false };
  }
  return { x: restAt[0], y: restAt[1], drawing: false };
}

// ---------------------------------------------------------------------------------------------
// Painting

const pathOf = (c: Ctx2D, pts: Poly, closed: boolean) => {
  c.beginPath();
  if (pts.length < 2) return;
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i + 1 < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  if (closed) c.closePath();
};

const toothCache = new Map<string, CanvasPattern | null>();
function paperPattern(c: Ctx2D, kind: 'tooth' | 'felt', seed: number, color: string): CanvasPattern | null {
  const key = `${kind}|${seed}|${color}`;
  if (toothCache.has(key)) return toothCache.get(key)!;
  let pattern: CanvasPattern | null = null;
  try {
    const size = 256;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : (() => { const e = document.createElement('canvas'); e.width = size; e.height = size; return e; })();
    const p = canvas.getContext('2d') as Ctx2D | null;
    if (p) {
      if (kind === 'tooth') {
        for (let i = 0; i < 2600; i++) {
          const dark = hash(i, seed, 1) < 0.55;
          p.fillStyle = dark ? `rgba(60,40,20,${0.03 + 0.05 * hash(i, seed, 2)})` : `rgba(255,255,255,${0.08 + 0.1 * hash(i, seed, 2)})`;
          p.fillRect(hash(i, seed, 3) * size, hash(i, seed, 4) * size, 1 + hash(i, seed, 5) * 1.5, 1 + hash(i, seed, 6) * 1.5);
        }
        p.lineWidth = 0.6;
        for (let i = 0; i < 70; i++) {
          p.strokeStyle = `rgba(90,70,40,${0.05 + 0.05 * hash(i, seed, 7)})`;
          const x = hash(i, seed, 8) * size, y = hash(i, seed, 9) * size, a = hash(i, seed, 10) * Math.PI * 2, l = 4 + 10 * hash(i, seed, 11);
          p.beginPath(); p.moveTo(x, y); p.quadraticCurveTo(x + Math.cos(a + 0.6) * l, y + Math.sin(a + 0.6) * l, x + Math.cos(a) * l * 1.6, y + Math.sin(a) * l * 1.6); p.stroke();
        }
      } else {
        // Felt / marker streaks: long, soft, mostly diagonal strokes, lighter and darker.
        p.lineCap = 'round';
        for (let i = 0; i < 420; i++) {
          const light = hash(i, seed, 1) < 0.5;
          p.strokeStyle = light ? `rgba(255,255,255,${0.04 + 0.07 * hash(i, seed, 2)})` : `rgba(0,0,0,${0.03 + 0.06 * hash(i, seed, 2)})`;
          p.lineWidth = 1 + 3 * hash(i, seed, 3);
          const x = hash(i, seed, 4) * size, y = hash(i, seed, 5) * size, l = 20 + 70 * hash(i, seed, 6), a = -0.35 + 0.2 * hash(i, seed, 7);
          for (const ox of [-size, 0, size]) { p.beginPath(); p.moveTo(x + ox, y); p.lineTo(x + ox + Math.cos(a) * l, y + Math.sin(a) * l); p.stroke(); }
        }
      }
      pattern = c.createPattern(canvas as CanvasImageSource, 'repeat');
    }
  } catch { pattern = null; }
  toothCache.set(key, pattern);
  if (toothCache.size > 32) toothCache.delete(toothCache.keys().next().value!);
  return pattern;
}

/** Clips to the part of a box the fill-in sweep has reached (perpendicular to the hatching). */
function sweepClip(c: Ctx2D, pts: Poly, fillIn: number, angleDeg: number) {
  if (fillIn >= 1) return;
  const b = bounds([pts]);
  if (!b) return;
  const a = (angleDeg * Math.PI) / 180;
  const nx = Math.sin(a);
  const ny = Math.cos(a);
  const corners = [[b[0], b[1]], [b[0] + b[2], b[1]], [b[0], b[1] + b[3]], [b[0] + b[2], b[1] + b[3]]];
  const proj = corners.map(([x, y]) => x * nx + y * ny);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const cut = lo + (hi - lo) * fillIn;
  const big = (b[2] + b[3]) * 2;
  const cx = nx * cut;
  const cy = ny * cut;
  // Half-plane {p · n ≤ cut}: a big quad on the near side of the cut line.
  const tx = -ny;
  const ty = nx;
  c.beginPath();
  c.moveTo(cx + tx * big, cy + ty * big);
  c.lineTo(cx - tx * big, cy - ty * big);
  c.lineTo(cx - tx * big - nx * big, cy - ty * big - ny * big);
  c.lineTo(cx + tx * big - nx * big, cy + ty * big - ny * big);
  c.closePath();
  c.clip();
}

/** Crayon / pencil hatching inside the current clip, over the fill's box. */
function hatch(c: Ctx2D, pts: Poly, colors: string[], angleDeg: number, spacing: number, width: number, alpha: [number, number], seed: number) {
  const b = bounds([pts]);
  if (!b) return;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const nx = Math.sin(a);
  const ny = Math.cos(a);
  const cx = b[0] + b[2] / 2;
  const cy = b[1] + b[3] / 2;
  const reach = Math.hypot(b[2], b[3]) / 2 + 4;
  c.lineCap = 'round';
  let k = 0;
  for (let s = -reach; s <= reach; s += spacing, k++) {
    const j = hash(k, seed);
    const jitter = (hash(k, seed, 2) - 0.5) * 0.08;
    const ox = cx + nx * s;
    const oy = cy + ny * s;
    const ddx = dx * Math.cos(jitter) - dy * Math.sin(jitter);
    const ddy = dx * Math.sin(jitter) + dy * Math.cos(jitter);
    const l0 = reach * (0.85 + 0.15 * hash(k, seed, 3));
    c.strokeStyle = colors[k % colors.length];
    c.globalAlpha = alpha[0] + (alpha[1] - alpha[0]) * j;
    c.lineWidth = width * (0.7 + 0.6 * hash(k, seed, 4));
    c.beginPath();
    c.moveTo(ox - ddx * l0, oy - ddy * l0);
    c.lineTo(ox + ddx * l0, oy + ddy * l0);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function printTexture(c: Ctx2D, pts: Poly, kind: string, seed: number) {
  const b = bounds([pts]);
  if (!b) return;
  c.globalAlpha = 0.55;
  c.strokeStyle = '#5a5a66';
  c.fillStyle = '#5a5a66';
  c.lineWidth = 1.2;
  const [x0, y0, w, h] = b;
  if (kind === 'news') {
    for (let y = y0 + 6, r = 0; y < y0 + h; y += 9, r++) for (let x = x0 + 4; x < x0 + w;) { const l = 8 + 26 * hash(r, Math.round(x), seed); c.fillRect(x, y, l, 3); x += l + 5; }
  } else if (kind === 'music') {
    for (let y = y0 + 10; y < y0 + h; y += 44) { for (let k = 0; k < 5; k++) { c.beginPath(); c.moveTo(x0, y + k * 6); c.lineTo(x0 + w, y + k * 6); c.stroke(); } for (let x = x0 + 14; x < x0 + w; x += 26) { c.beginPath(); c.ellipse(x, y + 6 * Math.floor(hash(Math.round(x), Math.round(y), seed) * 5), 5, 4, -0.4, 0, Math.PI * 2); c.fill(); } }
  } else if (kind === 'grid' || kind === 'lines') {
    for (let y = y0; y < y0 + h; y += 16) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke(); }
    if (kind === 'grid') for (let x = x0; x < x0 + w; x += 16) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + h); c.stroke(); }
  } else if (kind === 'dots') {
    for (let y = y0; y < y0 + h; y += 12) for (let x = x0; x < x0 + w; x += 12) c.fillRect(x, y, 2, 2);
  }
  c.globalAlpha = 1;
}

function paintFill(c: Ctx2D, mk: Mark, look: Look, p: Placed, seed: number, alpha: number) {
  if (mk.pts.length < 6) return;
  const color = mk.color;
  const angle = p.it.hatchAngle ?? 55;
  c.save();
  c.globalAlpha = alpha * (mk.alpha ?? 1);
  if (look === 'cut-paper' && mk.role !== 'detail') {
    // The torn white paper rim under the colour, with a soft contact shadow.
    const rim = tornEdge(mk.pts, p.it.rim ?? 5, seed);
    c.save();
    sweepClip(c, mk.pts, p.fillIn, angle);
    c.shadowColor = 'rgba(40,20,10,0.22)';
    c.shadowBlur = 6;
    c.shadowOffsetY = 2;
    pathOf(c, rim, true);
    c.fillStyle = '#fbf6ea';
    c.fill();
    c.restore();
  }
  pathOf(c, mk.pts, true);
  c.clip();
  sweepClip(c, mk.pts, p.fillIn, angle);
  switch (look) {
    case 'crayon': {
      c.globalAlpha = alpha * 0.55 * (mk.alpha ?? 1);
      c.fillStyle = color;
      c.fillRect(-1e5, -1e5, 2e5, 2e5);
      hatch(c, mk.pts, [color, mk.color2 ?? shade(color, -0.18), shade(color, 0.22)], angle, 4.2, 2.6, [0.35 * alpha, 0.8 * alpha], seed);
      hatch(c, mk.pts, [shade(color, -0.1)], angle + 12, 9, 1.6, [0.12 * alpha, 0.3 * alpha], seed + 7);
      break;
    }
    case 'pencil':
      hatch(c, mk.pts, [color, shade(color, 0.25)], angle, 5, 1.3, [0.25 * alpha, 0.55 * alpha], seed);
      hatch(c, mk.pts, [color], angle - 70, 11, 1, [0.1 * alpha, 0.25 * alpha], seed + 3);
      break;
    case 'cut-paper':
    case 'felt': {
      c.fillStyle = color;
      c.fillRect(-1e5, -1e5, 2e5, 2e5);
      if (p.it.print && mk.role !== 'detail') printTexture(c, mk.pts, p.it.print, seed);
      if (mk.role !== 'detail') {
        const pat = paperPattern(c, 'felt', 7, color);
        if (pat) { c.globalAlpha = alpha; c.fillStyle = pat; c.fillRect(-1e5, -1e5, 2e5, 2e5); }
        if (mk.color2) hatch(c, mk.pts, [mk.color2], -18, 7, 3, [0.12 * alpha, 0.3 * alpha], seed);
      }
      break;
    }
    case 'scope':
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = alpha * 0.3;
      c.fillStyle = color;
      c.fillRect(-1e5, -1e5, 2e5, 2e5);
      break;
    default:
      c.fillStyle = color;
      c.fillRect(-1e5, -1e5, 2e5, 2e5);
  }
  c.restore();
}

function paintStroke(c: Ctx2D, mk: Mark, look: Look, alpha: number, seed: number) {
  if (mk.pts.length < 4) return;
  const w = mk.width ?? 3;
  c.save();
  c.globalAlpha = alpha * (mk.alpha ?? 1);
  c.strokeStyle = mk.color;
  c.fillStyle = mk.color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (mk.dash) c.setLineDash(mk.dash);
  const ribbons = (look === 'ink' || look === 'crayon' || look === 'cut-paper' || look === 'felt') && mk.role !== 'guide' && !mk.dash && w >= 1.5;
  if (look === 'scope') {
    c.globalCompositeOperation = 'lighter';
    c.shadowColor = mk.color;
    c.shadowBlur = 10;
    pathOf(c, mk.pts, mk.closed);
    c.lineWidth = w;
    c.stroke();
  } else if (look === 'pencil' && mk.role !== 'guide') {
    // Several faint passes, each wobbling on its own.
    for (let k = 0; k < 3; k++) {
      c.globalAlpha = alpha * (mk.alpha ?? 1) * (k === 0 ? 0.75 : 0.35);
      pathOf(c, k ? wobble(mk.pts, 0.9, seed + k * 17, 30, mk.closed) : mk.pts, mk.closed);
      c.lineWidth = Math.max(0.8, w * (k === 0 ? 0.55 : 0.4));
      c.stroke();
    }
  } else if (ribbons) {
    const closedPts = mk.closed ? [...mk.pts, mk.pts[0], mk.pts[1]] : mk.pts;
    pathOf(c, ribbon(closedPts, w * 1.15, mk.closed ? 0.25 : 0.7, seed, false), true);
    c.fill();
    if (look === 'crayon') { c.globalAlpha *= 0.35; c.lineWidth = w * 0.4; pathOf(c, wobble(mk.pts, 1.2, seed + 5, 24, mk.closed), mk.closed); c.stroke(); }
  } else {
    pathOf(c, mk.pts, mk.closed);
    c.lineWidth = w;
    c.stroke();
  }
  c.restore();
}

function paintDot(c: Ctx2D, d: Dot, look: Look, alpha: number) {
  c.save();
  c.globalAlpha = alpha * (d.alpha ?? 1);
  c.fillStyle = d.color;
  if (look === 'scope') { c.globalCompositeOperation = 'lighter'; c.shadowColor = d.color; c.shadowBlur = d.r * 1.5; }
  c.beginPath();
  if (d.star) {
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? d.r * 0.3 : d.r; c.lineTo(d.x + Math.cos(a) * r, d.y + Math.sin(a) * r); }
    c.closePath();
  } else c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Writes text letter by letter (the current letter swept in); returns where the pen is. */
function paintText(c: Ctx2D, run: TextRun, m: number[], alpha: number): { x: number; y: number } | null {
  if (run.shown <= 0) return null;
  c.save();
  c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  c.font = run.font;
  c.fillStyle = run.color;
  c.globalAlpha = alpha;
  c.textBaseline = 'alphabetic';
  const letters = [...run.text];
  const widths = letters.map((l) => c.measureText(l).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = run.align === 'center' ? run.x - total / 2 : run.align === 'right' ? run.x - total : run.x;
  const y = run.y + run.size * 0.32;
  let tip: [number, number] | null = null;
  for (let i = 0; i < letters.length; i++) {
    const part = run.shown - i;
    if (part <= 0) break;
    if (part >= 1) c.fillText(letters[i], x, y);
    else {
      c.save();
      c.beginPath();
      c.rect(x - 2, y - run.size * 1.1, widths[i] * part + 2, run.size * 1.5);
      c.clip();
      c.fillText(letters[i], x, y);
      c.restore();
      tip = [x + widths[i] * part, y - run.size * 0.25];
    }
    x += widths[i];
  }
  c.restore();
  if (!tip && run.shown < letters.length + 1e-6 && run.shown % 1 === 0 && run.shown < letters.length) tip = [x, y - run.size * 0.25];
  return tip ? { x: apply(m, tip[0], tip[1])[0], y: apply(m, tip[0], tip[1])[1] } : null;
}

function paintBurst(c: Ctx2D, p: Placed, color: string) {
  const b = bounds(p.geo.marks.map((mk) => mk.pts));
  if (!b) return;
  const cx = b[0] + b[2] / 2;
  const cy = b[1] + b[3] / 2;
  const r = Math.max(b[2], b[3]) * 0.62;
  c.save();
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineWidth = Math.max(2, r * 0.025);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + hash(i, p.index) * 0.3;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    c.lineTo(cx + Math.cos(a) * r * 1.22, cy + Math.sin(a) * r * 1.22);
    c.stroke();
  }
  c.restore();
}

function paintItem(c: Ctx2D, p: Placed, look: Look, pal: Palette, alpha: number, textTips: Map<number, { x: number; y: number }>) {
  const seed = p.index * 977 + 13;
  for (const mk of p.geo.marks) {
    if (mk.kind === 'fill') { if (p.fillIn > 0) paintFill(c, mk, look, p, seed, alpha); } else paintStroke(c, mk, look, alpha, seed);
  }
  for (const d of p.geo.dots) paintDot(c, d, look, alpha * (p.it.draw !== undefined ? p.draw : 1));
  for (const run of p.geo.texts) {
    const tip = paintText(c, run, p.m, alpha);
    if (tip) textTips.set(p.index, tip);
  }
  if (p.burst) paintBurst(c, p, p.it.stroke ?? pal.line);
}

/**
 * Draws the drawing at time t. `main` gets colour (every look except riso, and riso's pen); for
 * riso, `plates` (one canvas per ink) get coverage in alpha and the GPU prints them.
 * Everything is in layer px, scaled by `density`.
 */
export function drawDrawing(targets: { main: Ctx2D; plates?: Ctx2D[] }, data: DrawingData, size: [number, number], t: number, density: number, ctx: ExprContext = { seed: 1 }) {
  const { placed, pens, clock } = placeItems(data, size, t, ctx);
  const look = data.look;
  const pal = lookPalette(data);
  const textTips = new Map<number, { x: number; y: number }>();
  const [W, H] = size;
  const main = targets.main;
  main.setTransform(density, 0, 0, density, 0, 0);

  if (look === 'riso' && targets.plates?.length) {
    const inks = (data.inks?.length ? data.inks : LOOK_INKS.riso).slice(0, targets.plates.length);
    const paper = data.paper ?? '#ffffff';
    for (const c of targets.plates) c.setTransform(density, 0, 0, density, 0, 0);
    for (const p of placed) {
      const cover = (color: string): number[] => {
        if (Array.isArray(p.it.ink)) return inks.map((_, i) => clamp(Number((p.it.ink as number[])[i] ?? 0)));
        if (typeof p.it.ink === 'number') return inks.map((_, i) => (i === p.it.ink ? 1 : 0));
        const exact = inks.findIndex((ink) => ink.toLowerCase() === color.toLowerCase());
        return exact >= 0 ? inks.map((_, i) => (i === exact ? 1 : 0)) : separate(color, inks, paper);
      };
      const alpha = p.opacity;
      const paintCoverage = (draw: (c: Ctx2D, fill: string) => void, color: string) => {
        const cov = cover(color);
        targets.plates!.forEach((c, i) => {
          c.save();
          if (!p.it.overprint) { c.globalCompositeOperation = 'destination-out'; c.globalAlpha = alpha; draw(c, '#000'); }
          c.globalCompositeOperation = 'source-over';
          if (cov[i] > 0) { c.globalAlpha = alpha * cov[i]; draw(c, '#000'); }
          c.restore();
        });
      };
      for (const mk of p.geo.marks) {
        if (mk.pts.length < 4) continue;
        const a = mk.alpha ?? 1;
        if (mk.kind === 'fill') {
          if (p.fillIn <= 0 || mk.pts.length < 6) continue;
          paintCoverage((c, f) => { c.save(); c.globalAlpha *= a; pathOf(c, mk.pts, true); c.clip(); sweepClip(c, mk.pts, p.fillIn, p.it.hatchAngle ?? 55); c.fillStyle = f; c.fillRect(-1e5, -1e5, 2e5, 2e5); c.restore(); }, mk.color);
        } else {
          paintCoverage((c, f) => { c.save(); c.globalAlpha *= a; c.strokeStyle = f; c.lineWidth = mk.width ?? 3; c.lineCap = 'round'; c.lineJoin = 'round'; if (mk.dash) c.setLineDash(mk.dash); pathOf(c, mk.pts, mk.closed); c.stroke(); c.restore(); }, mk.color);
        }
      }
      for (const d of p.geo.dots) paintCoverage((c, f) => paintDot(c, { ...d, color: f }, 'flat', 1), d.color);
      for (const run of p.geo.texts) {
        let tip: { x: number; y: number } | null = null;
        paintCoverage((c, f) => { tip = paintText(c, { ...run, color: f }, p.m, 1) ?? tip; }, run.color);
        if (tip) textTips.set(p.index, tip);
      }
      if (p.burst) paintCoverage((c, f) => paintBurst(c, p, f), p.it.stroke ?? pal.line);
    }
  } else {
    if (data.paper !== null && data.paper !== undefined || look === 'felt') {
      main.fillStyle = pal.paper;
      main.fillRect(0, 0, W, H);
      if (data.tooth !== false) {
        const pat = paperPattern(main, look === 'felt' || look === 'cut-paper' ? 'felt' : 'tooth', 3, pal.paper);
        if (pat) { main.fillStyle = pat; main.fillRect(0, 0, W, H); }
      }
    }
    for (const p of placed) paintItem(main, p, look, pal, p.opacity, textTips);
  }

  // The pen goes on last, on top, in colour (Film 4's nib is never printed).
  for (const pen of pens) {
    const pos = penPosition(pen, placed, textTips, clock.t);
    // Film 4's nib is big: its blade alone is about a tenth of the frame.
    const s = (pen.it.size !== undefined ? pen.box[0] : Math.min(W, H) * 0.1) * (Math.sqrt(Math.abs(pen.m[0] * pen.m[3] - pen.m[1] * pen.m[2])) || 1);
    const bob = pos.drawing ? noise1(clock.index * 0.7, 5) * s * 0.06 : 0;
    const angle = -0.95 + (pos.drawing ? 0.05 * noise1(clock.index * 0.5, 9) : 0);
    const geo = penGeometry(pen.it.tool ?? 'nib', s, angle);
    const m = [1, 0, 0, 1, pos.x, pos.y + bob];
    const shifted: Placed = { ...pen, geo: { marks: geo.marks.map((mk) => ({ ...mk, pts: xform(m, mk.pts) })), dots: [], texts: [] }, fillIn: 1, draw: 1, burst: false };
    paintItem(main, shifted, look === 'riso' ? 'flat' : look === 'scope' ? 'flat' : look === 'crayon' ? 'ink' : look, pal, pen.opacity, textTips);
  }
}

/** Riso screen settings for the GPU print pass. */
export function risoParams(data: DrawingData, t: number): { inks: [number, number, number][]; paper: [number, number, number, number]; pitch: number; angles: number[]; offsets: number[]; seed: number } {
  const inks = (data.inks?.length ? data.inks : LOOK_INKS.riso).slice(0, 4);
  const clock = drawingClock(t, data.step ?? 1, data.fps ?? 24);
  const mis = data.misregister ?? 3;
  const tremor = data.tremor ?? 0.8;
  const angles = data.angles?.length ? data.angles : [15, 75, 0, 45];
  const offsets: number[] = [];
  for (let i = 0; i < 4; i++) {
    const base = i === 0 ? [0, 0] : [Math.cos(i * 2.1) * mis, Math.sin(i * 2.1) * mis];
    offsets.push(base[0] + (hash(clock.index, i, 1) - 0.5) * 2 * tremor, base[1] + (hash(clock.index, i, 2) - 0.5) * 2 * tremor);
  }
  const paper = data.paper === null ? null : data.paper ?? '#efe9df';
  return {
    inks: inks.map((c) => rgbOf(c).map((v) => v / 255) as [number, number, number]),
    paper: paper ? [...(rgbOf(paper).map((v) => v / 255) as [number, number, number]), 1] : [1, 1, 1, 0],
    pitch: data.pitch ?? 5,
    angles: [0, 1, 2, 3].map((i) => ((angles[i % angles.length] ?? 0) * Math.PI) / 180),
    offsets,
    seed: (data.seed ?? 1) % 997,
  };
}
