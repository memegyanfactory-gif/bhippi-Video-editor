// LUTs for the Color Studio: parsing .cube files, the built-in conversions and looks, and the
// registry the grade resolves `lutId`s through.
//
// Imported LUTs live in the project (Project.luts), resampled to 33³ and stored as base64 16-bit
// values — portable with the project, available synchronously to the preview and the export, and
// small enough to keep in undo history. Built-ins are generated from their formulas on first use.

import { bakeGrade, GRADE_LUT_SIZE, type ColorParams, type Lut3D } from './colorGrade';
import type { Project, ProjectLut } from './types';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ───────────────────────────── .cube ─────────────────────────────

/**
 * Reads an Adobe/Resolve .cube file: a 3D LUT (LUT_3D_SIZE) or a 1D one (LUT_1D_SIZE, turned into
 * a 3D LUT), with an optional DOMAIN_MIN/DOMAIN_MAX. Throws with the reason when it is not one.
 */
export function parseCube(text: string): { title: string | null; lut: Lut3D } {
  let title: string | null = null;
  let size3 = 0, size1 = 0;
  let min = [0, 0, 0], max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) { title = line.slice(5).trim().replace(/^"|"$/g, '') || null; continue; }
    if (upper.startsWith('LUT_3D_SIZE')) { size3 = Number(line.split(/\s+/)[1]); continue; }
    if (upper.startsWith('LUT_1D_SIZE')) { size1 = Number(line.split(/\s+/)[1]); continue; }
    if (upper.startsWith('DOMAIN_MIN')) { min = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (upper.startsWith('DOMAIN_MAX')) { max = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (upper.startsWith('LUT_3D_INPUT_RANGE') || upper.startsWith('LUT_1D_INPUT_RANGE')) {
      const [lo, hi] = line.split(/\s+/).slice(1, 3).map(Number);
      min = [lo, lo, lo]; max = [hi, hi, hi];
      continue;
    }
    if (/^[A-Z_]/.test(upper)) continue; // an unknown keyword
    const parts = line.split(/\s+/).slice(0, 3).map(Number);
    if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) throw new Error(`Unreadable LUT line: "${line.slice(0, 40)}"`);
    values.push(...parts);
  }
  if ([...min, ...max].some((v) => !Number.isFinite(v)) || max.some((v, i) => v <= min[i])) throw new Error('The LUT has an invalid DOMAIN_MIN/DOMAIN_MAX.');
  const domain = (v: number, c: number) => clamp01((v - min[c]) / (max[c] - min[c]));
  if (size3) {
    if (!Number.isInteger(size3) || size3 < 2 || size3 > 256) throw new Error('LUT_3D_SIZE must be between 2 and 256.');
    if (values.length !== size3 ** 3 * 3) throw new Error(`The LUT has ${values.length / 3} entries; LUT_3D_SIZE ${size3} needs ${size3 ** 3}.`);
    // The input domain maps onto the grid; outputs are taken as they are (display 0–1).
    const lut: Lut3D = { size: size3, data: Float32Array.from(values, clamp01) };
    if (min.some((v) => v !== 0) || max.some((v) => v !== 1)) return { title, lut: resample((r, g, b, out) => sampleLutDomain(lut, r, g, b, min, max, out), GRADE_LUT_SIZE) };
    return { title, lut };
  }
  if (size1) {
    if (!Number.isInteger(size1) || size1 < 2 || size1 > 65536) throw new Error('LUT_1D_SIZE must be between 2 and 65536.');
    if (values.length !== size1 * 3) throw new Error(`The LUT has ${values.length / 3} entries; LUT_1D_SIZE ${size1} needs ${size1}.`);
    const curve = (v: number, c: number) => {
      const at = domain(v, c) * (size1 - 1), i = Math.min(size1 - 2, Math.floor(at));
      return clamp01(values[i * 3 + c] + (values[(i + 1) * 3 + c] - values[i * 3 + c]) * (at - i));
    };
    return { title, lut: resample((r, g, b, out) => { out[0] = curve(r, 0); out[1] = curve(g, 1); out[2] = curve(b, 2); }, GRADE_LUT_SIZE) };
  }
  throw new Error('This is not a .cube LUT (no LUT_3D_SIZE or LUT_1D_SIZE).');
}

function sampleLutDomain(lut: Lut3D, r: number, g: number, b: number, min: number[], max: number[], out: number[]) {
  // Our grid runs 0–1; the file's grid covers min–max, so read it where our value falls in that.
  const at = [r, g, b].map((v, c) => clamp01((v - min[c]) / (max[c] - min[c])));
  trilinear(lut, at[0], at[1], at[2], out);
}

function trilinear(lut: Lut3D, r: number, g: number, b: number, out: number[]) {
  const n = lut.size - 1, s = lut.size, s2 = s * s, d = lut.data;
  const fr = clamp01(r) * n, fg = clamp01(g) * n, fb = clamp01(b) * n;
  const r0 = Math.min(n - 1, Math.floor(fr)), g0 = Math.min(n - 1, Math.floor(fg)), b0 = Math.min(n - 1, Math.floor(fb));
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => d[(ri + gi * s + bi * s2) * 3 + c];
    const x00 = at(r0, g0, b0) + (at(r0 + 1, g0, b0) - at(r0, g0, b0)) * tr;
    const x10 = at(r0, g0 + 1, b0) + (at(r0 + 1, g0 + 1, b0) - at(r0, g0 + 1, b0)) * tr;
    const x01 = at(r0, g0, b0 + 1) + (at(r0 + 1, g0, b0 + 1) - at(r0, g0, b0 + 1)) * tr;
    const x11 = at(r0, g0 + 1, b0 + 1) + (at(r0 + 1, g0 + 1, b0 + 1) - at(r0, g0 + 1, b0 + 1)) * tr;
    const y0 = x00 + (x10 - x00) * tg, y1 = x01 + (x11 - x01) * tg;
    out[c] = y0 + (y1 - y0) * tb;
  }
}

/** Samples any colour function onto a `size`³ grid, red fastest. */
export function resample(fn: (r: number, g: number, b: number, out: number[]) => void, size = GRADE_LUT_SIZE): Lut3D {
  const data = new Float32Array(size ** 3 * 3);
  const out = [0, 0, 0];
  let k = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    fn(r / (size - 1), g / (size - 1), b / (size - 1), out);
    data[k++] = clamp01(out[0]); data[k++] = clamp01(out[1]); data[k++] = clamp01(out[2]);
  }
  return { size, data };
}

/** Any LUT at the grade's own size (33³), so every stored LUT is the same shape. */
export function normalizeLut(lut: Lut3D): Lut3D {
  return lut.size === GRADE_LUT_SIZE ? lut : resample((r, g, b, out) => trilinear(lut, r, g, b, out));
}

/** A LUT as .cube text (for the export and for saving a grade out). */
export function lutToCube(lut: Lut3D, title = 'Bhippi grade'): string {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

// ───────────────────────────── compact storage ─────────────────────────────

/** LUT values as base64 of little-endian 16-bit integers (0–65535 ↔ 0–1). */
export function encodeLut(lut: Lut3D): string {
  const bytes = new Uint8Array(lut.data.length * 2);
  for (let i = 0; i < lut.data.length; i++) {
    const v = Math.round(clamp01(lut.data[i]) * 65535);
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >> 8;
  }
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function decodeLut(size: number, encoded: string): Lut3D | null {
  try {
    const text = atob(encoded);
    const count = size ** 3 * 3;
    if (text.length !== count * 2) return null;
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) data[i] = (text.charCodeAt(i * 2) | (text.charCodeAt(i * 2 + 1) << 8)) / 65535;
    return { size, data };
  } catch {
    return null;
  }
}

// ───────────────────────────── built-ins ─────────────────────────────

type Mat = number[][];
const mul = (m: Mat, v: number[]) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
/** Scene-linear → Rec.709 display: a gentle filmic shoulder, then the BT.709 transfer. */
const display709 = (linear: number) => {
  const x = Math.max(0, linear);
  // Extended Reinhard (white at 4.0, about 4.5 stops over grey), scaled so 18% grey stays 18%.
  const toned = 1.17 * x * (1 + x / 16) / (1 + x);
  const v = clamp01(toned);
  return v < 0.018 ? v * 4.5 : 1.099 * Math.pow(v, 0.45) - 0.099;
};

// Log decodings, from the manufacturers' published formulas.
const slog3 = (x: number) => (x >= 171.2102946929 / 1023 ? Math.pow(10, (x * 1023 - 420) / 261.5) * (0.18 + 0.01) - 0.01 : ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95));
const vlog = (x: number) => (x < 0.181 ? (x - 0.125) / 5.6 : Math.pow(10, (x - 0.598206) / 0.241514) - 0.00873);
const logc3 = (x: number) => (x > 0.1496582 ? (Math.pow(10, (x - 0.385537) / 0.247190) - 0.052272) / 5.555556 : (x - 0.092809) / 5.367655);
const clog3 = (x: number) => (x < 0.097465473 ? -(Math.pow(10, (0.12783901 - x) / 0.36726845) - 1) / 14.98325 : x <= 0.15277891 ? (x - 0.12512219) / 1.9754798 : (Math.pow(10, (x - 0.12240537) / 0.36726845) - 1) / 14.98325);
const flog = (x: number) => (x >= 0.100537775223865 ? Math.pow(10, (x - 0.790453) / 0.344676) / 0.555556 - 0.009468 / 0.555556 : (x - 0.092864) / 8.735631);

// Camera gamut → Rec.709 primaries (linear), published by the manufacturers.
const SGAMUT3CINE_709: Mat = [[1.6269474, -0.5401385, -0.0868089], [-0.1785155, 1.4179409, -0.2394254], [-0.0444361, -0.1959199, 1.2403560]];
const VGAMUT_709: Mat = [[1.806576, -0.695697, -0.110879], [-0.170090, 1.305955, -0.135865], [-0.025206, -0.154468, 1.179674]];
const AWG3_709: Mat = [[1.617523, -0.537287, -0.080237], [-0.070573, 1.334613, -0.264040], [-0.021102, -0.226954, 1.248056]];
const CINEMA_GAMUT_709: Mat = [[1.9468, -0.8364, -0.1104], [-0.1316, 1.1897, -0.0581], [-0.0312, -0.2055, 1.2367]];
const FGAMUT_709: Mat = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];

const logToRec709 = (decode: (x: number) => number, gamut: Mat) => (r: number, g: number, b: number, out: number[]) => {
  const lin = mul(gamut, [decode(r), decode(g), decode(b)]);
  out[0] = display709(lin[0]); out[1] = display709(lin[1]); out[2] = display709(lin[2]);
};

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const sCurve = (x: number, k: number) => clamp01(0.5 + (x - 0.5) * (1 + k) - 4 * k * (x - 0.5) ** 3);

export type BuiltinLut = { id: string; name: string; group: 'Camera' | 'Creative'; hint: string; fn: (r: number, g: number, b: number, out: number[]) => void };

export const BUILTIN_LUTS: BuiltinLut[] = [
  { id: 'builtin:slog3-709', name: 'Sony S-Log3 → Rec.709', group: 'Camera', hint: 'S-Log3 / S-Gamut3.Cine footage to a normal-contrast Rec.709 picture', fn: logToRec709(slog3, SGAMUT3CINE_709) },
  { id: 'builtin:vlog-709', name: 'Panasonic V-Log → Rec.709', group: 'Camera', hint: 'V-Log / V-Gamut footage to Rec.709', fn: logToRec709(vlog, VGAMUT_709) },
  { id: 'builtin:logc3-709', name: 'ARRI LogC3 → Rec.709', group: 'Camera', hint: 'LogC3 (EI 800) / ARRI Wide Gamut 3 to Rec.709', fn: logToRec709(logc3, AWG3_709) },
  { id: 'builtin:clog3-709', name: 'Canon Log 3 → Rec.709', group: 'Camera', hint: 'Canon Log 3 / Cinema Gamut to Rec.709', fn: logToRec709(clog3, CINEMA_GAMUT_709) },
  { id: 'builtin:flog-709', name: 'Fujifilm F-Log → Rec.709', group: 'Camera', hint: 'F-Log / F-Gamut to Rec.709', fn: logToRec709(flog, FGAMUT_709) },
  {
    id: 'builtin:teal-orange', name: 'Teal & Orange', group: 'Creative', hint: 'Warm skin and highlights against teal shadows',
    fn: (r, g, b, out) => {
      const y = luma(r, g, b), w = smooth(0.15, 0.85, y);
      out[0] = sCurve(r + 0.06 * w - 0.05 * (1 - w), 0.25); out[1] = sCurve(g + 0.01 * w + 0.02 * (1 - w), 0.25); out[2] = sCurve(b - 0.07 * w + 0.07 * (1 - w), 0.25);
    },
  },
  {
    id: 'builtin:warm-film', name: 'Warm Film', group: 'Creative', hint: 'Golden, lifted-black print look',
    fn: (r, g, b, out) => {
      const lift = (x: number) => 0.04 + x * 0.94;
      out[0] = sCurve(lift(r * 1.04), 0.18); out[1] = sCurve(lift(g * 1.0), 0.18); out[2] = sCurve(lift(b * 0.88), 0.18);
    },
  },
  {
    id: 'builtin:cool-night', name: 'Cool Night', group: 'Creative', hint: 'Blue, low-key night look',
    fn: (r, g, b, out) => {
      const y = luma(r, g, b);
      out[0] = clamp01((r * 0.7 + y * 0.3) * 0.82); out[1] = clamp01((g * 0.75 + y * 0.25) * 0.9); out[2] = clamp01((b * 0.8 + y * 0.2) * 1.05 + 0.03);
    },
  },
  {
    id: 'builtin:bleach-bypass', name: 'Bleach Bypass', group: 'Creative', hint: 'Desaturated, high-contrast silver look',
    fn: (r, g, b, out) => {
      const y = luma(r, g, b);
      [r, g, b].forEach((v, c) => { out[c] = sCurve(v * 0.45 + y * 0.55, 0.45); });
    },
  },
  {
    id: 'builtin:faded-matte', name: 'Faded Matte', group: 'Creative', hint: 'Soft, lifted blacks and muted colour',
    fn: (r, g, b, out) => {
      const y = luma(r, g, b);
      [r, g, b].forEach((v, c) => { out[c] = 0.08 + (v * 0.8 + y * 0.2) * 0.86; });
    },
  },
  {
    id: 'builtin:mono-contrast', name: 'Mono Contrast', group: 'Creative', hint: 'Rich black & white with a firm S-curve',
    fn: (r, g, b, out) => { const y = sCurve(luma(r, g, b), 0.35); out[0] = y; out[1] = y; out[2] = y; },
  },
];

// ───────────────────────────── the registry ─────────────────────────────

const builtinCache = new Map<string, Lut3D>();
let projectLuts: ProjectLut[] | undefined;
const projectCache = new Map<string, { source: ProjectLut; lut: Lut3D | null }>();

/** Points the registry at the open project's imported LUTs. Cheap to call on every render. */
export function syncProjectLuts(project: Pick<Project, 'luts'> | null | undefined) {
  projectLuts = project?.luts ?? undefined;
}

/** A LUT by id: a built-in, or one imported into the open project. */
export function resolveLut(id: string): Lut3D | null {
  if (!id) return null;
  const builtin = BUILTIN_LUTS.find((entry) => entry.id === id);
  if (builtin) {
    let lut = builtinCache.get(id);
    if (!lut) { lut = resample(builtin.fn); builtinCache.set(id, lut); }
    return lut;
  }
  const stored = projectLuts?.find((entry) => entry.id === id);
  if (!stored) return null;
  const hit = projectCache.get(id);
  if (hit && hit.source === stored) return hit.lut;
  const lut = decodeLut(stored.size, stored.data);
  projectCache.set(id, { source: stored, lut });
  return lut;
}

/** The name shown for a LUT id, or null when the LUT is unknown (deleted, or from another project). */
export function lutName(id: string): string | null {
  return BUILTIN_LUTS.find((entry) => entry.id === id)?.name ?? projectLuts?.find((entry) => entry.id === id)?.name ?? null;
}

/** Every LUT a grade can use in this project: built-ins first, then the imported ones. */
export function availableLuts(project: Pick<Project, 'luts'>): { id: string; name: string; group: string; hint?: string }[] {
  return [
    ...BUILTIN_LUTS.map(({ id, name, group, hint }) => ({ id, name, group, hint })),
    ...(project.luts ?? []).map(({ id, name }) => ({ id, name, group: 'Imported' })),
  ];
}

/** A .cube file's text as a project LUT, resampled to 33³. */
export function importCube(text: string, fileName: string): ProjectLut {
  const { title, lut } = parseCube(text);
  const normal = normalizeLut(lut);
  const base = fileName.replace(/\.cube$/i, '');
  return { id: `lut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: title || base || 'Imported LUT', size: normal.size, data: encodeLut(normal) };
}

/** The `lutId`s every Color Studio effect in the project uses. */
export function lutsInUse(project: Project): Set<string> {
  const used = new Set<string>();
  for (const comp of project.comps) for (const clip of comp.clips) for (const fx of clip.appliedEffects ?? []) {
    if (fx.effectId === 'lumetri-color' && typeof fx.params.lutId === 'string' && fx.params.lutId) used.add(fx.params.lutId);
  }
  return used;
}

// ───────────────────────────── baked grades, shared ─────────────────────────────

const bakedGrades = new Map<string, Lut3D>();

/** The key a grade bakes under: its params and the LUT it resolves to right now. */
export function gradeKey(params: ColorParams): string {
  const lutId = typeof params.lutId === 'string' ? params.lutId : '';
  const lut = lutId ? resolveLut(lutId) : null;
  return JSON.stringify(params) + (lut ? `|${lutId}:${lut.data.length}:${lut.data[lut.data.length >> 1]}:${lut.data[lut.data.length >> 2]}` : '');
}

/**
 * A grade baked to its 33³ LUT, cached: the preview's GPU pass and the scopes share one bake per
 * change, so dragging a slider costs a single bake (about 20 ms) however many readers it has.
 */
export function bakedGrade(params: ColorParams): { key: string; lut: Lut3D } {
  const key = gradeKey(params);
  let lut = bakedGrades.get(key);
  if (lut) {
    bakedGrades.delete(key);
  } else {
    lut = bakeGrade(params, resolveLut);
    while (bakedGrades.size >= 48) bakedGrades.delete(bakedGrades.keys().next().value!);
  }
  bakedGrades.set(key, lut);
  return { key, lut };
}
