// The Color Studio grade: one colour function, baked into a 3D LUT that both the preview (a WebGL
// pass, editor/GradeCanvas.tsx) and the export (ffmpeg lut3d, render/video.rs) apply — so what
// the colourist sees is what renders.
//
// Stages, in order, all on display-referred values in [0, 1]:
//   1. Input LUT (a camera log conversion, say) — only when the LUT stage is "input".
//   2. Per-channel primaries: white balance, exposure, Lift/Gamma/Gain/Offset wheels, contrast
//      around a pivot, highlights/shadows/whites/blacks, the older three-way bands, soft clip and
//      the custom R/G/B curves. Each is a function of one channel, so they fold into three 1D
//      tables.
//   3. Colour: hue rotation, saturation, vibrance (colour boost), the hue/lum/sat curves and the
//      Color Slice vectors. These work on luma + a chroma plane, so they need the full 3D LUT.
//   4. Output LUT (a creative look), mixed by its intensity.

export type ColorParams = Record<string, number | boolean | string>;

/** Edge length of the baked grade: 33³ is the size cameras, Resolve and ffmpeg all expect. */
export const GRADE_LUT_SIZE = 33;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const number = (p: ColorParams, key: string, fallback = 0) => typeof p[key] === 'number' && Number.isFinite(p[key]) ? p[key] as number : fallback;

/** A space-separated sample table read at `x`, piecewise-linearly; identity when it is not one. */
export function curveValue(text: unknown, x: number): number {
  if (typeof text !== 'string' || !text.trim()) return x;
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length < 2 || values.some(v => !Number.isFinite(v))) return x;
  const at = clamp01(x) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(at));
  return clamp01(values[i] + (values[i + 1] - values[i]) * (at - i));
}

/** The zero-mean RGB push of a hue in degrees (red at 0°, green at 120°, blue at 240°). */
export function wheelRGB(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs(h % 2 - 1);
  return (h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]).map(v => v - 0.5);
}

// ───────────────────────────── the wheels ─────────────────────────────

export const WHEELS = ['lift', 'gamma', 'gain', 'offset'] as const;
export type Wheel = typeof WHEELS[number];
export const WHEEL_LABELS: Record<Wheel, string> = { lift: 'Lift', gamma: 'Gamma', gain: 'Gain', offset: 'Offset' };
/** How far a wheel's puck at the rim pushes a channel. */
export const WHEEL_REACH: Record<Wheel, number> = { lift: 0.25, gamma: 0.25, gain: 0.5, offset: 0.2 };

/**
 * The luma-neutral RGB push toward screen direction `angle` (radians, counter-clockwise from the
 * right, y up), laid out like a vectorscope: pushing a wheel toward a direction moves the trace
 * that way. Scaled so its largest channel is 1.
 */
export function pushDirection(angle: number): [number, number, number] {
  // Cb = (B − Y) / 1.8556 and Cr = (R − Y) / 1.5748 with Y = 0: the push lies along (cos, sin).
  const r = 1.5748 * Math.sin(angle), b = 1.8556 * Math.cos(angle);
  const g = -(0.2126 * r + 0.0722 * b) / 0.7152;
  const top = Math.max(Math.abs(r), Math.abs(g), Math.abs(b)) || 1;
  return [r / top, g / top, b / top];
}

/**
 * A wheel's per-channel values from its puck (x right, y up, both −1…1) and its master: the puck
 * adds a push that keeps luma, the master moves all three channels together.
 */
export function wheelFromPuck(wheel: Wheel, x: number, y: number, master: number): { r: number; g: number; b: number } {
  const radius = Math.min(1, Math.hypot(x, y));
  const push = pushDirection(Math.atan2(y, x)).map((v) => v * radius * WHEEL_REACH[wheel]);
  return { r: master + push[0], g: master + push[1], b: master + push[2] };
}

/** The puck position and master of a wheel's per-channel values (the inverse of wheelFromPuck). */
export function puckOf(wheel: Wheel, r: number, g: number, b: number): { x: number; y: number; master: number } {
  const master = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const pr = r - master, pg = g - master, pb = b - master;
  const cb = pb / 1.8556, cr = pr / 1.5748;
  if (Math.hypot(cb, cr) < 1e-9) return { x: 0, y: 0, master };
  const angle = Math.atan2(cr, cb);
  const top = Math.max(Math.abs(pr), Math.abs(pg), Math.abs(pb));
  const radius = Math.min(1, top / WHEEL_REACH[wheel]);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, master };
}

/** The colour at a wheel direction, for drawing the ring: mid-grey pushed hard that way. */
export function wheelColor(angle: number): string {
  const push = pushDirection(angle).map((v) => 0.5 + v * 0.5);
  // Stretched to a vivid hue: the ring shows which way each direction pushes, not how far.
  const lo = Math.min(...push), hi = Math.max(...push);
  return '#' + push.map((v) => Math.round((0.12 + ((v - lo) / Math.max(1e-6, hi - lo)) * 0.83) * 255).toString(16).padStart(2, '0')).join('');
}

// ───────────────────────────── curves ─────────────────────────────

export type CurvePoints = [number, number][];
export const HUE_CURVES = ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'] as const;
export type HueCurve = typeof HUE_CURVES[number];
export const HUE_CURVE_LABELS: Record<HueCurve, string> = { hueHue: 'Hue vs Hue', hueSat: 'Hue vs Sat', hueLum: 'Hue vs Lum', lumSat: 'Lum vs Sat', satSat: 'Sat vs Sat' };
/** The hue curves wrap around the colour circle; the other two run from dark/grey to bright/vivid. */
export const PERIODIC: Record<HueCurve, boolean> = { hueHue: true, hueSat: true, hueLum: true, lumSat: false, satSat: false };

/** Control points of a curve param (`[[x,y],…]`, y 0.5 = no change); empty when unset or unreadable. */
export function curvePoints(value: unknown): CurvePoints {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
      .map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  } catch {
    return [];
  }
}

/**
 * A curve through its control points: a Catmull-Rom spline that wraps round for the periodic hue
 * curves and holds flat past the ends for the others. No points is the neutral line (0.5).
 */
export function evalCurve(points: CurvePoints, x: number, periodic: boolean): number {
  const n = points.length;
  if (!n) return 0.5;
  if (n === 1) return points[0][1];
  const pts = points;
  if (!periodic) {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
  }
  // Find the segment [i, i+1] holding x; periodic curves wrap from the last point to the first.
  let i = -1;
  for (let k = 0; k < n - 1; k++) if (x >= pts[k][0] && x <= pts[k + 1][0]) { i = k; break; }
  const at = (k: number): [number, number] => {
    if (!periodic) return pts[Math.max(0, Math.min(n - 1, k))];
    const wrap = Math.floor(k / n);
    const p = pts[((k % n) + n) % n];
    return [p[0] + wrap, p[1]];
  };
  let x0: number;
  if (i < 0) {
    // Periodic, x lies in the wrap gap after the last point (or before the first).
    i = n - 1;
    x0 = x < pts[0][0] ? x + 1 : x;
  } else x0 = x;
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  const span = p2[0] - p1[0];
  if (span <= 1e-9) return p1[1];
  const t = (x0 - p1[0]) / span;
  // Tangents scaled to the neighbouring spans (a non-uniform Catmull-Rom, no overshoot at clusters).
  const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * span;
  const m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * span;
  const t2 = t * t, t3 = t2 * t;
  const y = (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  return clamp01(y);
}

function curveTable(value: unknown, periodic: boolean, samples = 361): Float32Array | null {
  const points = curvePoints(value);
  if (!points.length || points.every(([, y]) => Math.abs(y - 0.5) < 1e-4)) return null;
  const table = new Float32Array(samples);
  for (let i = 0; i < samples; i++) table[i] = evalCurve(points, i / (samples - 1), periodic);
  return table;
}

const sample = (table: Float32Array, x: number) => {
  const at = clamp01(x) * (table.length - 1), i = Math.min(table.length - 2, Math.floor(at));
  return table[i] + (table[i + 1] - table[i]) * (at - i);
};

// ───────────────────────────── Color Slice ─────────────────────────────

/** The Color Slice vectors: a centre hue (degrees) and how far either side it reaches. */
export const SLICES = [
  { id: 'red', label: 'Red', hue: 0, width: 38, swatch: '#e5484d' },
  { id: 'skin', label: 'Skin', hue: 24, width: 22, swatch: '#d99873' },
  { id: 'yellow', label: 'Yellow', hue: 58, width: 36, swatch: '#e8c547' },
  { id: 'green', label: 'Green', hue: 120, width: 48, swatch: '#46a758' },
  { id: 'cyan', label: 'Cyan', hue: 185, width: 40, swatch: '#3fb8c9' },
  { id: 'blue', label: 'Blue', hue: 235, width: 42, swatch: '#3e63dd' },
  { id: 'magenta', label: 'Magenta', hue: 300, width: 42, swatch: '#c74ab8' },
] as const;
export type SliceId = typeof SLICES[number]['id'];
export const sliceKey = (id: SliceId, what: 'Hue' | 'Sat' | 'Den') => `slice${id[0].toUpperCase()}${id.slice(1)}${what}`;

// ───────────────────────────── LUTs ─────────────────────────────

/** A 3D LUT: `size`³ RGB entries, red fastest (the .cube order). */
export type Lut3D = { size: number; data: Float32Array };

/** Trilinear lookup — the interpolation the GPU texture and ffmpeg's `interp=trilinear` both use. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number, out: number[]): void {
  const n = lut.size - 1, d = lut.data;
  const fr = clamp01(r) * n, fg = clamp01(g) * n, fb = clamp01(b) * n;
  const r0 = Math.min(n - 1, Math.floor(fr)), g0 = Math.min(n - 1, Math.floor(fg)), b0 = Math.min(n - 1, Math.floor(fb));
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const s = lut.size, s2 = s * s;
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => d[(ri + gi * s + bi * s2) * 3 + c];
    const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
    const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
    const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
    out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
}

// ───────────────────────────── compiling a grade ─────────────────────────────

const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const SQ3_2 = Math.sqrt(3) / 2;
// (Y, a, b) → RGB, where a = R − (G+B)/2 and b = √3/2 (G − B): the inverse of that linear map.
const INV = (() => {
  const m = [[LR, LG, LB], [1, -0.5, -0.5], [0, SQ3_2, -SQ3_2]];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
  ];
  return inv;
})();

/** Resolves a LUT id to its data (lib/luts.ts supplies the registry). */
export type LutResolver = (id: string) => Lut3D | null;

/** The per-channel primaries as a function of one channel value (stage 2). */
function channelFunction(p: ColorParams, channel: 0 | 1 | 2): (x: number) => number {
  const key = ['R', 'G', 'B'][channel];
  const temperature = number(p, 'temperature') / 100, tint = number(p, 'tint') / 100;
  // White balance as channel gains, normalised so a grey keeps its brightness.
  const gains = [1 + 0.3 * temperature + 0.1 * tint, 1 - 0.25 * tint, 1 - 0.3 * temperature + 0.1 * tint];
  const norm = LR * gains[0] + LG * gains[1] + LB * gains[2];
  const wb = gains[channel] / norm;
  const exposure = Math.pow(2, number(p, 'exposure'));
  const lift = number(p, 'liftY') + number(p, 'lift' + key);
  const gamma = number(p, 'gammaY') + number(p, 'gamma' + key);
  const gain = number(p, 'gainY') + number(p, 'gain' + key);
  const offset = number(p, 'offsetY') + number(p, 'offset' + key);
  const gammaPower = Math.pow(2, -2 * gamma);
  const contrast = Math.max(0, 1 + number(p, 'contrast') / 100);
  const pivot = clamp01(number(p, 'pivot', 46) / 100);
  const highlights = number(p, 'highlights'), shadows = number(p, 'shadows'), whites = number(p, 'whites'), blacks = number(p, 'blacks');
  const legacy = (['shadow', 'midtone', 'highlight'] as const).map((band) => ({
    push: wheelRGB(number(p, band + 'Hue'))[channel] * number(p, band + 'Amount') / 100,
    luma: number(p, band + 'Luma') / 200,
  }));
  const softHigh = clamp01(number(p, 'softClipHigh') / 100), softLow = clamp01(number(p, 'softClipLow') / 100);
  const table = p[['rTable', 'gTable', 'bTable'][channel]] ?? p.tableValues;
  return (input: number) => {
    let x = input * wb * exposure;
    x = x + lift * (1 - x);
    x = x * (1 + gain);
    x = x > 0 ? Math.pow(x, gammaPower) : x;
    x += offset;
    x = (x - pivot) * contrast + pivot;
    const c = clamp01(x);
    const shadow = (1 - c) * (1 - c), highlight = c * c, mid = 4 * c * (1 - c);
    x += (shadows * shadow + highlights * highlight) / 200;
    x += (blacks * Math.pow(1 - c, 4) + whites * Math.pow(c, 4)) / 200;
    x += (legacy[0].push + legacy[0].luma) * shadow + (legacy[1].push + legacy[1].luma) * mid + (legacy[2].push + legacy[2].luma) * highlight;
    // Soft clip: a smooth shoulder above 1 − k and toe below k instead of a hard clip.
    if (softHigh > 0) { const knee = 1 - softHigh * 0.5; if (x > knee) x = knee + (1 - knee) * Math.tanh((x - knee) / (1 - knee)); }
    if (softLow > 0) { const knee = softLow * 0.5; if (x < knee) x = knee - knee * Math.tanh((knee - x) / knee); }
    return curveValue(table, clamp01(x));
  };
}

/** Whether a grade uses anything beyond per-channel tone (so a plain 1D filter cannot show it). */
export function gradeNeeds3D(p: ColorParams): boolean {
  if (number(p, 'saturation', 100) !== 100 || number(p, 'vibrance') !== 0 || number(p, 'hue') !== 0) return true;
  if (HUE_CURVES.some((key) => curveTable(p[key], PERIODIC[key], 9))) return true;
  if (SLICES.some((s) => number(p, sliceKey(s.id, 'Hue')) !== 0 || number(p, sliceKey(s.id, 'Sat')) !== 0 || number(p, sliceKey(s.id, 'Den')) !== 0)) return true;
  return typeof p.lutId === 'string' && p.lutId !== '' && number(p, 'lutAmount', 100) > 0;
}

export type CompiledGrade = {
  /** Grades one pixel into `out` (RGB, 0–1). */
  apply: (r: number, g: number, b: number, out: number[]) => void;
  /** The per-channel primaries alone, as three 256-entry tables — the 1D part of the grade. */
  channelTables: () => number[][];
};

export function compileGrade(p: ColorParams, resolve: LutResolver = () => null): CompiledGrade {
  const tables = ([0, 1, 2] as const).map((c) => {
    const fn = channelFunction(p, c);
    const t = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) t[i] = fn(i / 1024);
    return t;
  });
  const saturation = Math.max(0, number(p, 'saturation', 100) / 100);
  const vibrance = number(p, 'vibrance') / 100;
  const hueTurn = (number(p, 'hue') * Math.PI) / 180;
  const hueHue = curveTable(p.hueHue, true), hueSat = curveTable(p.hueSat, true), hueLum = curveTable(p.hueLum, true);
  const lumSat = curveTable(p.lumSat, false, 257), satSat = curveTable(p.satSat, false, 257);
  const slices = SLICES.map((s) => ({ ...s, shift: number(p, sliceKey(s.id, 'Hue')), sat: number(p, sliceKey(s.id, 'Sat')) / 100, den: number(p, sliceKey(s.id, 'Den')) / 100 }))
    .filter((s) => s.shift !== 0 || s.sat !== 0 || s.den !== 0);
  const colorOps = saturation !== 1 || vibrance !== 0 || hueTurn !== 0 || hueHue || hueSat || hueLum || lumSat || satSat || slices.length > 0;
  const lutId = typeof p.lutId === 'string' ? p.lutId : '';
  const lut = lutId ? resolve(lutId) : null;
  const lutMix = clamp01(number(p, 'lutAmount', 100) / 100);
  const lutInput = lut && lutMix > 0 && p.lutStage === 'input';
  const lutOutput = lut && lutMix > 0 && p.lutStage !== 'input';
  const scratch = [0, 0, 0];

  const applyLut = (rgb: number[]) => {
    sampleLut(lut!, rgb[0], rgb[1], rgb[2], scratch);
    for (let c = 0; c < 3; c++) rgb[c] += (scratch[c] - rgb[c]) * lutMix;
  };

  const apply = (r: number, g: number, b: number, out: number[]) => {
    out[0] = r; out[1] = g; out[2] = b;
    if (lutInput) applyLut(out);
    out[0] = sample(tables[0], out[0]); out[1] = sample(tables[1], out[1]); out[2] = sample(tables[2], out[2]);
    if (colorOps) {
      let Y = LR * out[0] + LG * out[1] + LB * out[2];
      let a = out[0] - (out[1] + out[2]) / 2;
      let bb = SQ3_2 * (out[1] - out[2]);
      let chroma = Math.hypot(a, bb);
      let hue = chroma > 1e-7 ? Math.atan2(bb, a) : 0; // radians, red at 0
      if (hueTurn) hue += hueTurn;
      const hue01 = () => ((hue / (2 * Math.PI)) % 1 + 1) % 1;
      // Selectivity fades in with chroma, so greys and near-greys never pick up a hue shift.
      const gate = Math.min(1, chroma / 0.12);
      let satScale = saturation;
      if (vibrance) satScale *= 1 + vibrance * (1 - Math.min(1, chroma / 0.6));
      if (hueHue) hue += (sample(hueHue, hue01()) - 0.5) * (Math.PI / 1.5) * gate; // ±60°
      if (hueSat) satScale *= Math.max(0, 2 * sample(hueSat, hue01()));
      if (hueLum) Y += (sample(hueLum, hue01()) - 0.5) * 0.5 * gate;
      if (lumSat) satScale *= Math.max(0, 2 * sample(lumSat, clamp01(Y)));
      if (satSat) satScale *= Math.max(0, 2 * sample(satSat, clamp01(chroma / 0.8)));
      if (slices.length) {
        const deg = hue01() * 360;
        for (const s of slices) {
          let d = Math.abs(deg - s.hue);
          if (d > 180) d = 360 - d;
          if (d >= s.width) continue;
          const w = 0.5 * (1 + Math.cos((Math.PI * d) / s.width)) * gate;
          hue += ((s.shift * Math.PI) / 180) * w;
          satScale *= 1 + s.sat * w;
          // Density darkens (or lifts) the colour in proportion to how saturated it is.
          Y -= s.den * w * Math.min(1, chroma) * 0.35;
        }
      }
      chroma *= satScale;
      a = Math.cos(hue) * chroma;
      bb = Math.sin(hue) * chroma;
      Y = Math.max(0, Y);
      out[0] = INV[0][0] * Y + INV[0][1] * a + INV[0][2] * bb;
      out[1] = INV[1][0] * Y + INV[1][1] * a + INV[1][2] * bb;
      out[2] = INV[2][0] * Y + INV[2][1] * a + INV[2][2] * bb;
    }
    out[0] = clamp01(out[0]); out[1] = clamp01(out[1]); out[2] = clamp01(out[2]);
    if (lutOutput) applyLut(out);
    out[0] = clamp01(out[0]); out[1] = clamp01(out[1]); out[2] = clamp01(out[2]);
  };

  const channelTables = () => [0, 1, 2].map((c) => Array.from({ length: 256 }, (_, i) => clamp01(sample(tables[c], i / 255))));
  return { apply, channelTables };
}

/** The grade baked into a `size`³ LUT, red fastest. */
export function bakeGrade(p: ColorParams, resolve?: LutResolver, size = GRADE_LUT_SIZE): Lut3D {
  const grade = compileGrade(p, resolve);
  const data = new Float32Array(size * size * size * 3);
  const out = [0, 0, 0];
  let k = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    grade.apply(r / (size - 1), g / (size - 1), b / (size - 1), out);
    data[k++] = out[0]; data[k++] = out[1]; data[k++] = out[2];
  }
  return { size, data };
}

/** Per-channel tables of a grade's primaries, as space-separated feFunc tableValues. */
export function gradeTables(p: ColorParams): string[] {
  return compileGrade(p).channelTables().map((t) => t.map((v) => v.toFixed(6)).join(' '));
}

/** Single-channel evaluation of the primaries — kept for callers that grade one value at a time. */
export function gradeChannel(input: number, channel: number, p: ColorParams): number {
  return clamp01(channelFunction(p, (channel as 0 | 1 | 2))(input));
}

// ───────────────────────────── the Color Studio controls ─────────────────────────────

export type GradeControl = { id: string; name: string; min: number; max: number; step: number; defaultValue: number; unit?: string; hint?: string };

/** Every numeric Color Studio control, with its range: the schema the panel, the AI and validation share. */
export const GRADE_CONTROLS: GradeControl[] = [
  { id: 'temperature', name: 'Temperature', min: -100, max: 100, step: 1, defaultValue: 0, hint: 'Warm (+) / cool (−) white balance' },
  { id: 'tint', name: 'Tint', min: -100, max: 100, step: 1, defaultValue: 0, hint: 'Magenta (+) / green (−)' },
  { id: 'exposure', name: 'Exposure', min: -5, max: 5, step: 0.05, defaultValue: 0, unit: 'EV' },
  { id: 'contrast', name: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
  { id: 'pivot', name: 'Pivot', min: 0, max: 100, step: 1, defaultValue: 46, hint: 'The level contrast turns around' },
  { id: 'highlights', name: 'Highlights', min: -100, max: 100, step: 1, defaultValue: 0 },
  { id: 'shadows', name: 'Shadows', min: -100, max: 100, step: 1, defaultValue: 0 },
  { id: 'whites', name: 'Whites', min: -100, max: 100, step: 1, defaultValue: 0 },
  { id: 'blacks', name: 'Blacks', min: -100, max: 100, step: 1, defaultValue: 0 },
  { id: 'softClipHigh', name: 'High Soft', min: 0, max: 100, step: 1, defaultValue: 0, hint: 'Rolls highlights off instead of clipping' },
  { id: 'softClipLow', name: 'Low Soft', min: 0, max: 100, step: 1, defaultValue: 0, hint: 'Rolls shadows off instead of crushing' },
  { id: 'saturation', name: 'Saturation', min: 0, max: 200, step: 1, defaultValue: 100, unit: '%' },
  { id: 'vibrance', name: 'Color Boost', min: -100, max: 100, step: 1, defaultValue: 0, hint: 'Saturates the muted colours first, leaves vivid ones' },
  { id: 'hue', name: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' },
  ...WHEELS.flatMap((wheel) => (['Y', 'R', 'G', 'B'] as const).map((ch) => ({
    id: wheel + ch, name: `${WHEEL_LABELS[wheel]} ${ch === 'Y' ? 'Master' : ch}`,
    min: wheel === 'gain' ? -1 : -1, max: wheel === 'gain' ? 3 : 1, step: 0.005, defaultValue: 0,
  }))),
  ...SLICES.flatMap((s) => [
    { id: sliceKey(s.id, 'Hue'), name: `${s.label} Hue`, min: -60, max: 60, step: 1, defaultValue: 0, unit: '°' },
    { id: sliceKey(s.id, 'Sat'), name: `${s.label} Sat`, min: -100, max: 100, step: 1, defaultValue: 0 },
    { id: sliceKey(s.id, 'Den'), name: `${s.label} Density`, min: -100, max: 100, step: 1, defaultValue: 0 },
  ]),
  { id: 'lutAmount', name: 'LUT Intensity', min: 0, max: 100, step: 1, defaultValue: 100, unit: '%' },
];
export const GRADE_CONTROL_MAP = new Map(GRADE_CONTROLS.map((c) => [c.id, c]));

/** String params of the Color Studio: curves (tables and point lists) and the LUT. */
export const GRADE_TEXT_PARAMS = ['rTable', 'gTable', 'bTable', 'curvesJson', ...HUE_CURVES, 'lutId', 'lutStage'] as const;
