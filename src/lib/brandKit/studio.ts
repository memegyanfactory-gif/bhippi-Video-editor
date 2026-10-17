// Pure helpers behind Brand Studio (Settings → Brand kit): colour spaces for the picker, tint scales,
// contrast fixes, easing curves for the motion editor and the personality sliders. No React here.

import { contrastRatio, isDark, isHex, mix } from './build';
import type { BrandKit, BrandPersonality } from './types';

// ── colour spaces ────────────────────────────────────────────────────────────

export type Hsl = { h: number; s: number; l: number };
export type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const norm = (hex: string): string => {
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toLowerCase()}` : '#000000';
};
export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const h = norm(hex);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
};
export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + (((h % 360) + 360) % 360) / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  const h = d === 0 ? 0 : max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60;
  return { h: h % 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const S = clamp(s, 0, 100) / 100, V = clamp(v, 0, 100) / 100;
  const f = (n: number) => { const k = (n + (((h % 360) + 360) % 360) / 60) % 6; return V - V * S * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/** A typed or pasted colour (#abc, abc, #aabbcc) as #rrggbb, or null. */
export function parseHex(text: string): string | null {
  const clean = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(clean)) return `#${clean.split('').map((c) => c + c).join('').toLowerCase()}`;
  return /^[0-9a-f]{6}$/i.test(clean) ? `#${clean.toLowerCase()}` : null;
}

// ── scales and contrast ──────────────────────────────────────────────────────

export type Tint = { label: string; hex: string; base: boolean };

/** Nine steps, 100 (lightest) … 900 (darkest), with the colour itself at 500. */
export function tintScale(hex: string): Tint[] {
  const base = norm(hex);
  const steps: [string, number, 'w' | 'b' | 'x'][] = [
    ['100', 0.86, 'w'], ['200', 0.7, 'w'], ['300', 0.5, 'w'], ['400', 0.24, 'w'], ['500', 0, 'x'],
    ['600', 0.2, 'b'], ['700', 0.4, 'b'], ['800', 0.6, 'b'], ['900', 0.78, 'b'],
  ];
  return steps.map(([label, amount, to]) => ({ label, base: to === 'x', hex: to === 'x' ? base : mix(base, to === 'w' ? '#ffffff' : '#000000', amount) }));
}

export type ContrastLevel = 'AAA' | 'AA' | 'AA large' | 'fail';
export const contrastLevel = (ratio: number): ContrastLevel => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fail');

/**
 * `fg` nudged in lightness (keeping its hue and saturation) until it reads on `bg` at `target`:1.
 * Falls back to white or black when no shade of the hue gets there. Returns `fg` when it already does.
 */
export function fixContrast(fg: string, bg: string, target = 4.5): string {
  if (contrastRatio(fg, bg) >= target) return norm(fg);
  const hsl = hexToHsl(fg);
  const goLighter = isDark(bg);
  for (let step = 1; step <= 40; step++) {
    const l = clamp(hsl.l + (goLighter ? step : -step) * 2.5, 0, 100);
    const candidate = hslToHex({ ...hsl, l });
    if (contrastRatio(candidate, bg) >= target) return candidate;
    if (l === 0 || l === 100) break;
  }
  const extreme = goLighter ? '#ffffff' : '#000000';
  return contrastRatio(extreme, bg) >= target ? extreme : (contrastRatio('#ffffff', bg) > contrastRatio('#000000', bg) ? '#ffffff' : '#000000');
}

/** A readable label colour for text on `bg`. */
export const onColor = (bg: string): string => (contrastRatio('#ffffff', bg) >= contrastRatio('#111111', bg) ? '#ffffff' : '#111111');

// ── easing ───────────────────────────────────────────────────────────────────

export type Bezier = [number, number, number, number];

const NAMED_EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'sine-in': [0.12, 0, 0.39, 0], 'sine-out': [0.61, 1, 0.88, 1], 'sine-in-out': [0.37, 0, 0.63, 1],
  'cubic-in': [0.32, 0, 0.67, 0], 'cubic-out': [0.33, 1, 0.68, 1], 'cubic-in-out': [0.65, 0, 0.35, 1],
  'quart-in': [0.5, 0, 0.75, 0], 'quart-out': [0.25, 1, 0.5, 1], 'quart-in-out': [0.76, 0, 0.24, 1],
  'expo-in': [0.7, 0, 0.84, 0], 'expo-out': [0.16, 1, 0.3, 1], 'expo-in-out': [0.87, 0, 0.13, 1],
};

/** `cubic-bezier(a,b,c,d)` or a named ease as four numbers; null when it is neither. */
export function easingToBezier(value: string | undefined | null): Bezier | null {
  if (!value) return null;
  const m = value.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (m) {
    const curve = [m[1], m[2], m[3], m[4]].map(Number) as Bezier;
    return curve.every(Number.isFinite) ? curve : null;
  }
  return NAMED_EASES[value.trim()] ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Four numbers as CSS; x handles are held in 0…1, y may overshoot (−1…2). */
export const bezierToEasing = ([a, b, c, d]: Bezier): string => `cubic-bezier(${round2(clamp(a, 0, 1))}, ${round2(clamp(b, -1, 2))}, ${round2(clamp(c, 0, 1))}, ${round2(clamp(d, -1, 2))})`;

/** Eased progress for time `t` (0…1) on a cubic-bezier. */
export function bezierAt(t: number, [x1, y1, x2, y2]: Bezier): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    const x = ((ax * s + bx) * s + cx) * s;
    if (x < t) lo = s; else hi = s;
  }
  return ((ay * s + by) * s + cy) * s;
}

export const EASE_PRESETS: { name: string; curve: Bezier }[] = [
  { name: 'Expo out', curve: [0.16, 1, 0.3, 1] },
  { name: 'Smooth', curve: [0.4, 0, 0.2, 1] },
  { name: 'Soft', curve: [0.25, 0.1, 0.25, 1] },
  { name: 'Springy', curve: [0.34, 1.56, 0.64, 1] },
  { name: 'Snap', curve: [0.7, 0, 0.84, 0] },
  { name: 'Linear', curve: [0, 0, 1, 1] },
];

// ── personality ──────────────────────────────────────────────────────────────

export const PERSONALITY_AXES: { key: keyof BrandPersonality; left: string; right: string }[] = [
  { key: 'tone', left: 'Playful', right: 'Serious' },
  { key: 'expression', left: 'Minimal', right: 'Expressive' },
  { key: 'temperature', left: 'Warm', right: 'Cool' },
  { key: 'era', left: 'Classic', right: 'Modern' },
];

/** The sliders for a kit that has none yet, read off its motion, colour and type. */
export function inferPersonality(kit: BrandKit): BrandPersonality {
  const intensity = kit.motionGuide?.intensity;
  const accent = kit.colors.tokens.find((t) => t.role === 'accent' || t.role === 'primary')?.hex ?? '#888888';
  const hue = hexToHsl(accent).h;
  const warm = hue < 70 || hue > 320;
  const serif = /Georgia|Cambria|Palatino|Garamond|Times|Fraunces/.test(kit.typography?.display?.family ?? '');
  return {
    tone: intensity === 'energetic' ? 0.25 : intensity === 'calm' ? 0.7 : 0.5,
    expression: intensity === 'energetic' ? 0.8 : intensity === 'calm' ? 0.3 : 0.55,
    temperature: warm ? 0.25 : 0.7,
    era: serif ? 0.3 : 0.75,
  };
}

export const personalityOf = (kit: BrandKit): BrandPersonality => kit.personality ?? inferPersonality(kit);

/** A short phrase for the four sliders: "playful, expressive, warm and modern". */
export function personalityPhrase(p: BrandPersonality): string {
  const pick = (v: number, left: string, right: string) => (v < 0.4 ? left : v > 0.6 ? right : null);
  const words = [pick(p.tone, 'playful', 'serious'), pick(p.expression, 'minimal', 'expressive'), pick(p.temperature, 'warm', 'cool'), pick(p.era, 'classic', 'modern')].filter((w): w is string => !!w);
  if (!words.length) return 'balanced';
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export { isHex };
