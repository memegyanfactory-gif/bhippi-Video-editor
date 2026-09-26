// Scopes and colour statistics: what the Histogram panel draws and what the AI reads.
//
// The panel samples the picture under the playhead — the top video or still on screen (or the
// selected one), drawn small — and runs it through that clip's colour effects and the adjustment
// layers above it, the same functions the preview and export use. The AI reads the same
// statistics from a frame the export renders (inspect_color), so both see the graded picture.

import { sampleLut, type ColorParams, type Lut3D } from './colorGrade';
import { exportTables } from './effectExport';
import { gradeFirst } from './effectFilters';
import { bakedGrade } from './luts';
import { effectScope } from './magicMask';
import { clipEnd, tracksOf } from './timeline';
import type { AppliedEffect, Clip, Comp, Project } from './types';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const LR = 0.2126, LG = 0.7152, LB = 0.0722;
export const luma709 = (r: number, g: number, b: number) => LR * r + LG * g + LB * b;

// ───────────────────────────── the colour chain of a clip ─────────────────────────────

/** Grades one pixel in place (RGB 0–1). */
export type PixelFn = (rgb: number[]) => void;

const cachedGrade = (params: ColorParams): Lut3D => bakedGrade(params).lut;

const hueMatrix = (deg: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
};

/** The colour part of one effect as a pixel function; null for effects that do not change colour. */
export function effectPixelFn(fx: AppliedEffect): PixelFn | null {
  if (!fx.enabled) return null;
  const p = fx.params;
  const n = (key: string, fallback: number) => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : fallback);
  switch (fx.effectId) {
    case 'lumetri-color': {
      const lut = cachedGrade(p);
      const out = [0, 0, 0];
      return (rgb) => { sampleLut(lut, rgb[0], rgb[1], rgb[2], out); rgb[0] = out[0]; rgb[1] = out[1]; rgb[2] = out[2]; };
    }
    case 'curves': case 'levels': case 'brightness-contrast': {
      const tables = exportTables(fx)!.map((t) => t.map(Number));
      return (rgb) => { for (let c = 0; c < 3; c++) rgb[c] = tables[c][Math.round(clamp01(rgb[c]) * 255)]; };
    }
    case 'black-white': {
      const amount = clamp01(n('amount', 100) / 100);
      return (rgb) => { const y = luma709(rgb[0], rgb[1], rgb[2]); for (let c = 0; c < 3; c++) rgb[c] += (y - rgb[c]) * amount; };
    }
    case 'invert': {
      const amount = clamp01(n('amount', 100) / 100);
      return (rgb) => { for (let c = 0; c < 3; c++) rgb[c] = rgb[c] + (1 - 2 * rgb[c]) * amount; };
    }
    case 'hue-saturation': case 'color-balance-hls': {
      const sat = Math.max(0, (100 + n('masterSaturation', 0)) / 100);
      const m = hueMatrix(n('masterHue', 0));
      const light = 1 + n('masterLightness', 0) / 100;
      return (rgb) => {
        const y = luma709(rgb[0], rgb[1], rgb[2]);
        const s = [0, 1, 2].map((c) => y + (rgb[c] - y) * sat);
        for (let c = 0; c < 3; c++) rgb[c] = clamp01((m[c * 3] * s[0] + m[c * 3 + 1] * s[1] + m[c * 3 + 2] * s[2]) * light);
      };
    }
    case 'tint': {
      const parse = (hex: unknown, fallback: number[]) => /^#[0-9a-f]{6}$/i.test(String(hex)) ? [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16) / 255) : fallback;
      const black = parse(p.mapBlackTo, [0, 0, 0]), white = parse(p.mapWhiteTo, [1, 1, 1]);
      const amount = clamp01(n('amount', 100) / 100);
      return (rgb) => { const y = luma709(rgb[0], rgb[1], rgb[2]); for (let c = 0; c < 3; c++) rgb[c] += (black[c] + (white[c] - black[c]) * y - rgb[c]) * amount; };
    }
    default:
      return null;
  }
}

const isAdjustment = (project: Project, clip: Clip) => clip.adjustment || (clip.source.type === 'item' && project.items.find((item) => item.id === (clip.source as { itemId: string }).itemId)?.kind === 'adjustment-layer');
const onAt = (clip: Clip, time: number) => clip.enabled && time >= clip.start && time < clipEnd(clip);

/** The picture a scope reads at `time`: the selected clip when it is on screen, else the top video or still. */
export function scopeClip(project: Project, comp: Comp, time: number, selection: string[]): Clip | null {
  const tracks = tracksOf(comp, 'video').filter((track) => !track.hidden);
  const onTrack = new Set(tracks.map((track) => track.id));
  const pictures = comp.clips.filter((clip) => onTrack.has(clip.trackId) && onAt(clip, time) && clip.source.type === 'media' && !isAdjustment(project, clip));
  const selected = pictures.find((clip) => selection.includes(clip.id));
  if (selected) return selected;
  const order = new Map(tracks.map((track, index) => [track.id, index]));
  return pictures.sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0) || b.start - a.start)[0] ?? null;
}

/** A clip's whole colour chain at `time`: its own colour effects, then the adjustment layers above it, each mixed by its opacity. */
export function clipColorChain(project: Project, comp: Comp, clip: Clip, time: number): { fns: PixelFn[]; key: string } {
  const fns: PixelFn[] = [];
  const keys: string[] = [];
  const whole = (c: Clip) => gradeFirst((c.appliedEffects ?? []).filter((fx) => effectScope(c, fx).kind === 'whole'));
  for (const fx of whole(clip)) { const fn = effectPixelFn(fx); if (fn) { fns.push(fn); keys.push(JSON.stringify(fx.params) + fx.enabled); } }
  const tracks = tracksOf(comp, 'video').filter((track) => !track.hidden);
  const index = tracks.findIndex((track) => track.id === clip.trackId);
  const above = new Set(tracks.slice(index + 1).map((track) => track.id));
  const adjustments = comp.clips.filter((c) => above.has(c.trackId) && onAt(c, time) && isAdjustment(project, c))
    .sort((a, b) => tracks.findIndex((t) => t.id === a.trackId) - tracks.findIndex((t) => t.id === b.trackId));
  for (const adjustment of adjustments) {
    const mix = clamp01((adjustment.transform.opacity ?? 100) / 100);
    for (const fx of whole(adjustment)) {
      const fn = effectPixelFn(fx);
      if (!fn) continue;
      keys.push(`${adjustment.id}:${mix}:${JSON.stringify(fx.params)}`);
      if (mix >= 1) { fns.push(fn); continue; }
      const graded = [0, 0, 0];
      fns.push((rgb) => { graded[0] = rgb[0]; graded[1] = rgb[1]; graded[2] = rgb[2]; fn(graded); for (let c = 0; c < 3; c++) rgb[c] += (graded[c] - rgb[c]) * mix; });
    }
  }
  return { fns, key: keys.join('|') };
}

/** Runs pixels (RGBA bytes) through a chain, in place. */
export function applyChain(data: Uint8ClampedArray, fns: PixelFn[]): void {
  if (!fns.length) return;
  const rgb = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    rgb[0] = data[i] / 255; rgb[1] = data[i + 1] / 255; rgb[2] = data[i + 2] / 255;
    for (const fn of fns) fn(rgb);
    data[i] = Math.round(clamp01(rgb[0]) * 255); data[i + 1] = Math.round(clamp01(rgb[1]) * 255); data[i + 2] = Math.round(clamp01(rgb[2]) * 255);
  }
}

// ───────────────────────────── drawing the scopes ─────────────────────────────

export type ScopeMode = 'histogram' | 'waveform' | 'parade' | 'vectorscope';
export const SCOPE_MODES: { id: ScopeMode; label: string }[] = [
  { id: 'histogram', label: 'Histogram' },
  { id: 'waveform', label: 'Waveform' },
  { id: 'parade', label: 'Parade' },
  { id: 'vectorscope', label: 'Vector' },
];

const GRATICULE = 'rgba(214, 170, 60, 0.55)';
const GRATICULE_TEXT = 'rgba(214, 170, 60, 0.9)';

/** Draws one scope of `image` (RGBA, `width`×`height`) filling `canvas`. */
export function drawScope(canvas: HTMLCanvasElement, mode: ScopeMode, image: ImageData, scale = 1): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Drawn in CSS pixels on a `scale`× backing store, so the graticule text stays crisp.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const W = canvas.width / scale, H = canvas.height / scale;
  ctx.fillStyle = '#060607';
  ctx.fillRect(0, 0, W, H);
  if (mode === 'vectorscope') return drawVectorscope(ctx, W, H, image);
  const left = 30, top = 6, right = 6, bottom = 6;
  const plotW = W - left - right, plotH = H - top - bottom;
  if (mode === 'histogram') drawHistogram(ctx, left, top, plotW, plotH, image);
  else drawWaveform(ctx, left, top, plotW, plotH, image, mode === 'parade');
  // The 10-bit graticule down the side, as in the grading suites.
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const levels = mode === 'histogram' ? [] : [0, 128, 256, 384, 512, 640, 768, 896, 1023];
  for (const level of levels) {
    const y = top + plotH - (level / 1023) * plotH;
    ctx.strokeStyle = GRATICULE;
    ctx.lineWidth = level === 512 ? 0.5 : 0.75;
    ctx.setLineDash(level === 512 ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(left + plotW, Math.round(y) + 0.5); ctx.stroke();
    ctx.fillStyle = GRATICULE_TEXT;
    ctx.fillText(String(level), left - 4, y);
  }
  ctx.setLineDash([]);
  if (mode === 'histogram') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const level of [0, 256, 512, 768, 1023]) {
      const x = left + (level / 1023) * plotW;
      ctx.strokeStyle = GRATICULE;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, top + plotH); ctx.stroke();
    }
  }
}

function drawWaveform(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, image: ImageData, parade: boolean) {
  const cols = Math.max(1, Math.floor(w)), rows = Math.max(1, Math.floor(h));
  const bins = [new Float32Array(cols * rows), new Float32Array(cols * rows), new Float32Array(cols * rows)];
  const { data, width, height } = image;
  const lane = parade ? Math.floor(cols / 3) : cols;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const col = Math.min(lane - 1, Math.floor((x / width) * lane));
    for (let c = 0; c < 3; c++) {
      // Spread each 8-bit level across the rows it stands for, so the trace has no banding stripes.
      const level = Math.min(1, Math.max(0, (data[i + c] + ((x * 7 + y * 13 + c * 5) % 16) / 16 - 0.5) / 255));
      const row = rows - 1 - Math.min(rows - 1, Math.round(level * (rows - 1)));
      bins[c][row * cols + (parade ? col + c * lane : col)] += 1;
    }
  }
  const out = ctx.createImageData(cols, rows);
  // Density to brightness: a log curve, so a single stray pixel still shows and dense bands do not flood.
  const gain = 255 / Math.log1p(height * (rows / 256) * 0.9);
  for (let k = 0; k < cols * rows; k++) {
    const r = Math.min(255, Math.log1p(bins[0][k]) * gain), g = Math.min(255, Math.log1p(bins[1][k]) * gain), b = Math.min(255, Math.log1p(bins[2][k]) * gain);
    const o = k * 4;
    if (parade) {
      // Each lane is drawn in its own channel's colour.
      out.data[o] = Math.min(255, r + g * 0.15 + b * 0.25); out.data[o + 1] = Math.min(255, g + r * 0.12 + b * 0.35); out.data[o + 2] = Math.min(255, b + r * 0.12 + g * 0.12);
    } else {
      out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b;
    }
    out.data[o + 3] = Math.max(r, g, b) > 0 ? 255 : 0;
  }
  const temp = document.createElement('canvas');
  temp.width = cols; temp.height = rows;
  temp.getContext('2d')?.putImageData(out, 0, 0);
  ctx.drawImage(temp, x0, y0, w, h);
  if (parade) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (const k of [1, 2]) { const x = x0 + (w * k) / 3; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y0 + h); ctx.stroke(); }
  }
}

export function histogramBins(image: ImageData, bins = 256): { r: Uint32Array; g: Uint32Array; b: Uint32Array; y: Uint32Array } {
  const r = new Uint32Array(bins), g = new Uint32Array(bins), b = new Uint32Array(bins), y = new Uint32Array(bins);
  const d = image.data, k = (bins - 1) / 255;
  for (let i = 0; i < d.length; i += 4) {
    r[Math.round(d[i] * k)]++; g[Math.round(d[i + 1] * k)]++; b[Math.round(d[i + 2] * k)]++;
    y[Math.round(luma709(d[i], d[i + 1], d[i + 2]) * k)]++;
  }
  return { r, g, b, y };
}

function drawHistogram(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, image: ImageData) {
  const bins = histogramBins(image, 256);
  let peak = 1;
  // Scale to the tallest interior bin, so a crushed black or clipped white spike does not flatten the rest.
  for (const channel of [bins.r, bins.g, bins.b]) for (let i = 2; i < 254; i++) peak = Math.max(peak, channel[i]);
  const shape = (channel: Uint32Array) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h);
    for (let i = 0; i < 256; i++) ctx.lineTo(x0 + (i / 255) * w, y0 + h - Math.min(1, channel[i] / peak) * h);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
  };
  ctx.globalCompositeOperation = 'lighter';
  for (const [channel, color] of [[bins.r, 'rgba(235,64,64,0.55)'], [bins.g, 'rgba(64,220,90,0.5)'], [bins.b, 'rgba(70,120,255,0.6)']] as const) {
    shape(channel);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  shape(bins.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** BT.709 colour-difference of an RGB value, each about −0.5…0.5. */
const cbcr = (r: number, g: number, b: number) => { const y = luma709(r, g, b); return [(b - y) / 1.8556, (r - y) / 1.5748]; };

function drawVectorscope(ctx: CanvasRenderingContext2D, W: number, H: number, image: ImageData) {
  const size = Math.min(W, H) - 12;
  const cx = W / 2, cy = H / 2, radius = size / 2;
  const n = 160;
  const density = new Float32Array(n * n);
  const hueR = new Float32Array(n * n), hueG = new Float32Array(n * n), hueB = new Float32Array(n * n);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const [u, v] = cbcr(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    // 75% colour bars land at ~0.75 of the radius, as on a broadcast vectorscope.
    const x = Math.round(((u / 0.5) * 0.5 + 0.5) * (n - 1)), y = Math.round((0.5 - (v / 0.5) * 0.5) * (n - 1));
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    const k = y * n + x;
    density[k]++; hueR[k] += d[i]; hueG[k] += d[i + 1]; hueB[k] += d[i + 2];
  }
  ctx.strokeStyle = GRATICULE;
  ctx.lineWidth = 0.75;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
  const out = ctx.createImageData(n, n);
  const gain = 255 / Math.log1p(Math.max(4, (d.length / 4) / 400));
  for (let k = 0; k < n * n; k++) {
    if (!density[k]) continue;
    const bright = Math.min(1, (Math.log1p(density[k]) * gain) / 255);
    const r = hueR[k] / density[k], g = hueG[k] / density[k], b = hueB[k] / density[k];
    const top = Math.max(r, g, b, 1);
    const o = k * 4;
    out.data[o] = Math.min(255, 60 + (r / top) * 195); out.data[o + 1] = Math.min(255, 60 + (g / top) * 195); out.data[o + 2] = Math.min(255, 60 + (b / top) * 195);
    out.data[o + 3] = Math.round(bright * 255);
  }
  const temp = document.createElement('canvas');
  temp.width = n; temp.height = n;
  temp.getContext('2d')?.putImageData(out, 0, 0);
  ctx.drawImage(temp, cx - radius, cy - radius, radius * 2, radius * 2);
  // Targets for 75% bars, and the skin-tone line.
  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, rgb] of [['R', [0.75, 0, 0]], ['Mg', [0.75, 0, 0.75]], ['B', [0, 0, 0.75]], ['Cy', [0, 0.75, 0.75]], ['G', [0, 0.75, 0]], ['Yl', [0.75, 0.75, 0]]] as const) {
    const [u, v] = cbcr(rgb[0], rgb[1], rgb[2]);
    const x = cx + (u / 0.5) * radius, y = cy - (v / 0.5) * radius;
    ctx.strokeStyle = GRATICULE;
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = GRATICULE_TEXT;
    ctx.fillText(label, x + (x > cx ? 11 : -11), y);
  }
  const [su, sv] = cbcr(0.87, 0.62, 0.5);
  const angle = Math.atan2(sv, su);
  ctx.strokeStyle = 'rgba(230, 180, 140, 0.55)';
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius); ctx.stroke();
  ctx.setLineDash([]);
}

// ───────────────────────────── statistics (what the AI reads) ─────────────────────────────

export type ColorStats = {
  pixels: number;
  luma: { mean: number; p1: number; p5: number; p50: number; p95: number; p99: number };
  clipped: { black: number; white: number };
  /** Mean RGB in the shadows (luma < 0.25), mids (0.25–0.7) and highlights (> 0.7), 0–1. */
  bands: Record<'shadows' | 'midtones' | 'highlights', { share: number; r: number; g: number; b: number }>;
  saturation: { mean: number; p95: number };
  /** Average colour cast of the near-neutral pixels, as a direction and strength. */
  cast: { r: number; g: number; b: number };
  /** Mean hue (degrees, red 0) of skin-like pixels and their share, when any. */
  skin: { share: number; hue: number | null };
};

export function colorStats(image: ImageData): ColorStats {
  const d = image.data;
  const count = d.length / 4;
  const lumas = new Float32Array(count);
  const sats = new Float32Array(count);
  const bands = { shadows: { share: 0, r: 0, g: 0, b: 0 }, midtones: { share: 0, r: 0, g: 0, b: 0 }, highlights: { share: 0, r: 0, g: 0, b: 0 } };
  let black = 0, white = 0, sum = 0;
  const cast = { r: 0, g: 0, b: 0, n: 0 };
  let skinN = 0, skinX = 0, skinY = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const y = luma709(r, g, b);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    lumas[k] = y; sats[k] = sat; sum += y;
    if (max <= 2 / 255) black++;
    if (min >= 253 / 255) white++;
    const band = y < 0.25 ? bands.shadows : y < 0.7 ? bands.midtones : bands.highlights;
    band.share++; band.r += r; band.g += g; band.b += b;
    if (sat < 0.25 && y > 0.15 && y < 0.92) { cast.r += r - y; cast.g += g - y; cast.b += b - y; cast.n++; }
    // Skin: warm hue (≈ 5–45°), moderate saturation, not too dark or bright.
    const a = r - (g + b) / 2, bb = (Math.sqrt(3) / 2) * (g - b);
    const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
    if (hue > 5 && hue < 45 && sat > 0.15 && sat < 0.65 && y > 0.2 && y < 0.85) { skinN++; skinX += Math.cos((hue * Math.PI) / 180); skinY += Math.sin((hue * Math.PI) / 180); }
  }
  const sorted = Float32Array.from(lumas).sort();
  const pct = (q: number) => sorted[Math.min(count - 1, Math.max(0, Math.round(q * (count - 1))))];
  const satSorted = Float32Array.from(sats).sort();
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const finish = (band: { share: number; r: number; g: number; b: number }) => band.share
    ? { share: round(band.share / count), r: round(band.r / band.share), g: round(band.g / band.share), b: round(band.b / band.share) }
    : { share: 0, r: 0, g: 0, b: 0 };
  return {
    pixels: count,
    luma: { mean: round(sum / count), p1: round(pct(0.01)), p5: round(pct(0.05)), p50: round(pct(0.5)), p95: round(pct(0.95)), p99: round(pct(0.99)) },
    clipped: { black: round(black / count), white: round(white / count) },
    bands: { shadows: finish(bands.shadows), midtones: finish(bands.midtones), highlights: finish(bands.highlights) },
    saturation: { mean: round(sats.reduce((a, b) => a + b, 0) / count), p95: round(satSorted[Math.round(0.95 * (count - 1))]) },
    cast: cast.n ? { r: round(cast.r / cast.n), g: round(cast.g / cast.n), b: round(cast.b / cast.n) } : { r: 0, g: 0, b: 0 },
    skin: { share: round(skinN / count), hue: skinN ? Math.round(((Math.atan2(skinY, skinX) * 180) / Math.PI + 360) % 360) : null },
  };
}

/** Plain-language reading of the statistics — the colourist's first look at the scopes. */
export function describeStats(s: ColorStats): string[] {
  const notes: string[] = [];
  if (s.luma.p99 < 0.8) notes.push(`Highlights stop at ${Math.round(s.luma.p99 * 1023)} of 1023: the image has headroom — raise Gain or Whites.`);
  if (s.luma.p1 > 0.08) notes.push(`Blacks sit at ${Math.round(s.luma.p1 * 1023)}: lifted/milky — lower Lift or Blacks unless the look wants it.`);
  if (s.clipped.white > 0.01) notes.push(`${(s.clipped.white * 100).toFixed(1)}% of pixels clip to white — pull Gain/Highlights down or add High Soft clip.`);
  if (s.clipped.black > 0.05) notes.push(`${(s.clipped.black * 100).toFixed(1)}% of pixels crush to black.`);
  if (s.luma.p50 < 0.3) notes.push(`Median luma ${Math.round(s.luma.p50 * 1023)}: reads underexposed.`);
  else if (s.luma.p50 > 0.68) notes.push(`Median luma ${Math.round(s.luma.p50 * 1023)}: reads bright/overexposed.`);
  const cast = s.cast;
  const strongest = [['red', cast.r], ['green', cast.g], ['blue', cast.b]].sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))[0];
  if (Math.abs(strongest[1] as number) > 0.02) {
    const warm = cast.r - cast.b;
    notes.push(`Neutrals carry a ${(strongest[1] as number) > 0 ? '' : 'lack of '}${strongest[0]} cast (${JSON.stringify(cast)}) — ${warm > 0.02 ? 'warm: cool Temperature or push Gain toward blue' : warm < -0.02 ? 'cool: warm Temperature or push Gain toward orange' : 'correct with Tint or the Gamma wheel'}.`);
  }
  if (s.saturation.mean < 0.12) notes.push('Colour is muted (mean saturation low) — Color Boost or Saturation.');
  else if (s.saturation.p95 > 0.9) notes.push('Some colours are near full saturation — watch for clipping in a channel.');
  if (s.skin.hue !== null && s.skin.share > 0.02) {
    const off = s.skin.hue - 24;
    if (Math.abs(off) > 8) notes.push(`Skin tones sit at ${s.skin.hue}° (the skin line is ≈24°): ${off > 0 ? 'too yellow — shift Skin hue down' : 'too red/magenta — shift Skin hue up'} in Color Slice.`);
  }
  if (!notes.length) notes.push('Levels and balance read healthy: full range without clipping and neutral greys.');
  return notes;
}

/**
 * A starting correction from the statistics of the ungraded picture: black and white points set by
 * Lift and Gain (1st and 99.5th luma percentile), and the neutral cast taken out with per-channel
 * Gain — the "Auto Balance" of the grading suites. Returns Color Studio params to merge.
 */
export function autoBalance(image: ImageData): Record<string, number> {
  const d = image.data;
  const count = d.length / 4;
  const lumas = new Float32Array(count);
  const neutral = [0, 0, 0];
  let neutralN = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const y = luma709(r, g, b);
    lumas[k] = y;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (y > 0.2 && y < 0.9 && (max - min) < 0.25 * max) { neutral[0] += r; neutral[1] += g; neutral[2] += b; neutralN++; }
  }
  const sorted = lumas.sort();
  const bp = Math.min(0.2, sorted[Math.round(0.01 * (count - 1))]);
  const wp = Math.max(0.6, sorted[Math.round(0.995 * (count - 1))]);
  const lift = Math.max(-0.25, -bp / Math.max(0.05, 1 - bp));
  const gain = Math.max(-0.5, Math.min(1.5, 1 / Math.max(0.3, wp + lift * (1 - wp)) - 1));
  const out: Record<string, number> = { liftY: +lift.toFixed(3), gainY: +gain.toFixed(3), liftR: 0, liftG: 0, liftB: 0, gainR: 0, gainG: 0, gainB: 0 };
  if (neutralN > count * 0.02) {
    const mean = neutral.map((v) => v / neutralN);
    const y = luma709(mean[0], mean[1], mean[2]);
    // Each channel's gain brought to the neutral's luma; the master gain stays in gainY.
    (['R', 'G', 'B'] as const).forEach((ch, c) => {
      const ratio = Math.max(0.7, Math.min(1.4, y / Math.max(0.02, mean[c])));
      out['gain' + ch] = +((1 + gain) * ratio - 1 - gain).toFixed(3);
    });
  }
  return out;
}
