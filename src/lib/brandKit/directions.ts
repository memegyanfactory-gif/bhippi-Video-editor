// Three brand directions from a brief — local, deterministic, no model.
//
// 1. Every archetype gets a measured personality (`traitsOf`): playful↔serious, minimal↔expressive,
//    warm↔cool, classic↔modern, light/dark, hue.
// 2. They are scored against the brief: how close their traits sit to the sliders, whether their
//    industries match what the person makes, whether the words they chose appear in the archetype's
//    character, light/dark preference, and a nudge toward the colours the person already owns.
// 3. Three are picked that are FAR APART from each other (greedy: best score first, then the one that
//    keeps the most distance from what is already chosen without giving up fit).
// 4. Each is adapted: the user's colours blended in (roles kept, contrast repaired to AA), a type
//    pairing and two alternates, motion tuned by the sliders, a voice written from slider positions
//    and industry, a wordmark (or the user's logo). The kit is built with kitFromArchetypeChecked and
//    mergeBrandKitChecked so it validates exactly like every other kit.

import { ARCHETYPES } from './archetypes';
import type { BrandArchetype, BrandKit, MotionIntensity } from './types';
import {
  contrastRatio, fontFallback, isDark, kitFromArchetypeChecked, mergeBrandKitChecked, mix, relativeLuminance, type NewBrandKitInput,
} from './build';
import { satLight } from './palette';
import { INDUSTRIES, industryThing, type Brief, type Sliders } from './brief';

// ── colour helpers ───────────────────────────────────────────────────────────

type Colors = BrandArchetype['colors'];
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  return `#${hex2(f(hh + 1 / 3) * 255)}${hex2(f(hh) * 255)}${hex2(f(hh - 1 / 3) * 255)}`;
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
export const rotateHue = (hex: string, degrees: number): string => { const c = hexToHsl(hex); return hslToHex(c.h + degrees, c.s, c.l); };

/** Nudges `fg` away from `bg` (toward white on a dark field, black on a light one) until it meets `min`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = isDark(bg) ? '#ffffff' : '#000000';
  let out = fg;
  for (let i = 1; i <= 20; i++) {
    out = mix(fg, target, i * 0.05);
    if (contrastRatio(out, bg) >= min) return out;
  }
  return target;
}

/** Roles keep their meaning and every readable pair meets AA (text 4.5, brand colours 3). */
export function fixColors(c: Colors): Colors {
  const out = { ...c };
  out.text = ensureContrast(out.text, out.bg, 7);
  if (contrastRatio(out.text, out.surface) < 4.5) out.surface = mix(out.surface, out.bg, 0.8);
  out.text = ensureContrast(out.text, out.surface, 4.5);
  out.muted = ensureContrast(out.muted, out.bg, 3.2);
  out.primary = ensureContrast(out.primary, out.bg, 3);
  out.accent = ensureContrast(out.accent, out.bg, 3);
  out.accent2 = ensureContrast(out.accent2, out.bg, 2.2);
  return out;
}

const COLOR_NAMES: [number, string][] = [[12, 'red'], [28, 'vermilion'], [48, 'amber'], [68, 'yellow'], [100, 'lime'], [160, 'green'], [182, 'teal'], [205, 'cyan'], [235, 'blue'], [262, 'indigo'], [292, 'violet'], [330, 'pink'], [352, 'rose'], [361, 'red']];
/** A plain-English name for a colour ("deep indigo", "soft rose", "ink black"). */
export function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.1) return l > 0.88 ? 'paper white' : l < 0.18 ? 'ink black' : l < 0.45 ? 'charcoal' : 'stone grey';
  const base = COLOR_NAMES.find(([limit]) => h < limit)?.[1] ?? 'red';
  if (base === 'amber' && l < 0.4) return 'chestnut';
  if (base === 'vermilion' && l < 0.38) return 'terracotta';
  return l < 0.3 ? `deep ${base}` : l > 0.74 ? `soft ${base}` : base;
}

// ── traits ───────────────────────────────────────────────────────────────────

export type Traits = Sliders & {
  /** 1 for a dark field, 0 for a light one. */
  dark: number;
  hue: number;
  chroma: number;
  serif: boolean;
};

const SERIF = new Set(['Georgia', 'Cambria', 'Palatino Linotype', 'Garamond', 'Times New Roman', 'Fraunces']);
const MONO = new Set(['Consolas', 'Courier New', 'Cascadia Code', 'JetBrains Mono']);
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ENERGY: Record<MotionIntensity, number> = { calm: 0.12, balanced: 0.5, energetic: 0.9 };

const PLAYFUL_WORDS = /playful|cheeky|enthusiastic|friendly|fun|upbeat|cheerful|encouraging|punchy|bold|warm|witty|helpful|nostalgic|hearty|proud/;
const SERIOUS_WORDS = /precise|refined|calm|credible|clear|dramatic|spare|exact|informed|commanding|assured|respectful|reassuring|sparse|smart|quiet|declarative|competent|elegant|soothing/;
const warmOf = (hex: string) => {
  const { h, s } = hexToHsl(hex);
  if (s < 0.08) return 0.5;
  const w = h < 70 || h >= 300 ? 1 : h >= 170 && h <= 265 ? 0 : 0.5;
  return lerp(0.5, w, Math.min(1, s * 1.6));
};

const traitCache = new Map<string, Traits>();

/** What an archetype feels like, measured from its own data (palette, type, easing, tone words). */
export function traitsOf(a: BrandArchetype): Traits {
  const hit = traitCache.get(a.id);
  if (hit) return hit;
  const energy = ENERGY[a.motion.intensity];
  const nums = (a.motion.easing.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const overshoot = nums[1] > 1 || nums[3] > 1;
  const tone = `${a.voice.tone.join(' ')} ${a.character}`.toLowerCase();
  const play = (tone.match(new RegExp(PLAYFUL_WORDS, 'g')) ?? []).length;
  const grave = (tone.match(new RegExp(SERIOUS_WORDS, 'g')) ?? []).length;
  const pSat = satLight(a.colors.primary).s;
  const aSat = satLight(a.colors.accent).s;
  const chroma = (pSat + aSat) / 2;
  const playful = clamp(0.5 + 0.12 * (play - grave) + (energy - 0.5) * 0.35 + (overshoot ? 0.18 : 0) + (a.typography.display.family === 'Verdana' ? 0.08 : 0));
  const heavy = a.typography.display.weight >= 800 || a.typography.display.family === 'Impact';
  const expressive = clamp(0.12 + energy * 0.3 + chroma * 0.55 + (heavy ? 0.12 : 0) + (a.gradient.stops.length > 2 ? 0.05 : 0));
  const grade = (a.imagery.grade.warmth + 1) / 2;
  const primaryHsl = satLight(a.colors.primary);
  const warm = primaryHsl.s > 0.12 ? 0.5 * warmOf(a.colors.primary) + 0.2 * warmOf(a.colors.accent) + 0.3 * grade : 0.45 * warmOf(a.colors.bg) + 0.25 * warmOf(a.colors.accent) + 0.3 * grade;
  const fam = a.typography.display.family;
  const vintage = /retro|vintage|nostalgic|heritage|print|craft|classic|editorial/.test(`${a.id} ${tone}`);
  const modern = clamp((SERIOUS_FAMILY(fam)) + (vintage ? -0.2 : 0) + (/tech|neon|cyber|gradient|startup|minimal|mono|fin/.test(a.id) ? 0.12 : 0));
  const traits: Traits = {
    serious: 1 - playful,
    expressive,
    cool: clamp(1 - warm),
    modern,
    dark: isDark(a.colors.bg) ? 1 : 0,
    hue: hexToHsl(primaryHsl.s > 0.12 ? a.colors.primary : a.colors.accent).h,
    chroma,
    serif: SERIF.has(fam),
  };
  traitCache.set(a.id, traits);
  return traits;
}

function SERIOUS_FAMILY(fam: string): number {
  if (SERIF.has(fam)) return 0.14;
  if (MONO.has(fam)) return 0.92;
  if (fam === 'Impact') return 0.3;
  if (fam === 'Verdana' || fam === 'Trebuchet MS') return 0.5;
  if (fam === 'Arial Black') return 0.55;
  return 0.74;
}

// ── distance and scoring ─────────────────────────────────────────────────────

const WEIGHTS: Record<keyof Sliders, number> = { serious: 1, expressive: 1, cool: 0.85, modern: 1 };

/** How far apart two archetypes feel: traits, light/dark, hue and serif/sans. 0 identical … ~1.6. */
export function archetypeDistance(a: BrandArchetype, b: BrandArchetype): number {
  const x = traitsOf(a);
  const y = traitsOf(b);
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof Sliders)[]) { sum += WEIGHTS[k] * (x[k] - y[k]) ** 2; w += WEIGHTS[k]; }
  const slider = Math.sqrt(sum / w);
  const hue = x.chroma > 0.15 && y.chroma > 0.15 ? hueGap(x.hue, y.hue) / 180 : 0.25;
  return slider * 1.1 + Math.abs(x.dark - y.dark) * 0.28 + hue * 0.35 + (x.serif === y.serif ? 0 : 0.18);
}

const briefTraits = (brief: Brief): Sliders => brief.sliders;
const textOf = (a: BrandArchetype) => `${a.industries.join(' ')} ${a.character} ${a.voice.tone.join(' ')} ${a.imagery.style}`.toLowerCase();

/** Industries the brief's free text points at (labels from INDUSTRIES), most specific first. */
export function industriesIn(brief: Brief): string[] {
  const text = `${brief.industry} ${brief.makes}`;
  return INDUSTRIES.filter((i) => i.label.toLowerCase() === brief.industry.toLowerCase() || i.test.test(text)).map((i) => i.label);
}

export type Scored = { archetype: BrandArchetype; score: number; parts: { traits: number; industry: number; words: number; mode: number; colours: number; penalty: number } };

/** Seeds: the colours the person already owns, strongest source first (logo, site, pictures, words). */
export function seedColors(brief: Brief): string[] {
  const vivid = (hex: string) => { const { s, l } = satLight(hex); return s > 0.16 && l > 0.08 && l < 0.95; };
  const out: string[] = [];
  for (const c of [...brief.logoColors, ...brief.siteColors, ...brief.imageColors, ...brief.colorHints]) {
    if (!/^#[0-9a-f]{6}$/i.test(c) || !vivid(c)) continue;
    if (out.every((o) => Math.hypot(...rgb(o).map((v, i) => v - rgb(c)[i])) > 60)) out.push(c.toLowerCase());
    if (out.length >= 4) break;
  }
  return out;
}

const wantsDark = (brief: Brief): boolean | null => {
  if (brief.mode === 'dark') return true;
  if (brief.mode === 'light') return false;
  return brief.siteBackground ? relativeLuminance(brief.siteBackground) < 0.2 : null;
};

export function scoreArchetype(a: BrandArchetype, brief: Brief): Scored {
  const t = traitsOf(a);
  const target = briefTraits(brief);
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof Sliders)[]) { sum += WEIGHTS[k] * (t[k] - target[k]) ** 2; w += WEIGHTS[k]; }
  // With no light/dark wish, a playful brief leans light and a serious one a little darker.
  if (wantsDark(brief) === null) { sum += 0.6 * (t.dark - clamp(0.25 + 0.35 * target.serious)) ** 2; w += 0.6; }
  const traits = clamp(1 - Math.sqrt(sum / w) * 1.7);

  const hay = textOf(a);
  const probes = INDUSTRIES.filter((i) => industriesIn(brief).includes(i.label)).flatMap((i) => i.probes);
  const hits = new Set(probes.filter((p) => hay.includes(p))).size;
  const industry = clamp(hits * 0.45, 0, 1);

  const words = brief.words.map((x) => x.toLowerCase());
  const wordHits = words.filter((x) => hay.includes(x.slice(0, Math.max(4, x.length - 2)))).length;
  const wordsScore = Math.min(0.3, wordHits * 0.1);

  const dark = wantsDark(brief);
  const mode = dark === null ? 0 : (dark ? 1 : 0) === t.dark ? 0.14 : -0.14;
  const seeds = seedColors(brief);
  const colours = seeds.length ? 0.1 * (1 - hueGap(hexToHsl(seeds[0]).h, t.hue) / 180) : 0;
  const penalty = (a.group === 'reference' ? 0.07 : 0) + (a.group === 'house' ? 0.12 : 0);
  return { archetype: a, score: 0.55 * traits + 0.38 * industry + wordsScore + mode + colours - penalty, parts: { traits, industry, words: wordsScore, mode, colours, penalty } };
}

export function rankArchetypes(brief: Brief, pool: BrandArchetype[] = ARCHETYPES.filter((a) => a.group !== 'house')): Scored[] {
  return pool.map((a) => scoreArchetype(a, brief)).sort((x, y) => y.score - x.score || x.archetype.id.localeCompare(y.archetype.id));
}

/** Two archetypes that would read as the same brand: same light/dark, same display face and a near hue. */
export function sameLook(a: BrandArchetype, b: BrandArchetype): boolean {
  const x = traitsOf(a);
  const y = traitsOf(b);
  return a.id === b.id || (x.dark === y.dark && a.typography.display.family === b.typography.display.family && hueGap(x.hue, y.hue) < 30);
}

/** Three that fit and feel unlike each other (never the same archetype, never the same look). */
export function pickThree(brief: Brief, pool: BrandArchetype[] = ARCHETYPES.filter((a) => a.group !== 'house'), minGap = 0.34): Scored[] {
  const ranked = rankArchetypes(brief, pool);
  if (ranked.length <= 3) return ranked;
  // Only archetypes that really fit are in the running: a diverse pick must still be a good one.
  const top = ranked.filter((c, i) => i < 6 || (i < 12 && c.score >= ranked[0].score * 0.5));
  const best = top[0].score;
  const worst = top[top.length - 1].score;
  const norm = (s: number) => (best === worst ? 1 : (s - worst) / (best - worst));
  const chosen = [top[0]];
  while (chosen.length < 3) {
    let pick: Scored | null = null;
    let pickValue = -Infinity;
    for (const c of top) {
      if (chosen.includes(c)) continue;
      const gap = Math.min(...chosen.map((x) => archetypeDistance(x.archetype, c.archetype)));
      const alike = chosen.some((x) => sameLook(x.archetype, c.archetype));
      // Below the gap an option is only taken if nothing else is far enough.
      const value = 1.15 * norm(c.score) + 0.6 * Math.min(gap, 0.75) - (gap < minGap ? 1 : 0) - (alike ? 2 : 0);
      if (value > pickValue) { pick = c; pickValue = value; }
    }
    if (!pick) break;
    chosen.push(pick);
  }
  return chosen;
}

// ── names for a direction ────────────────────────────────────────────────────

const NAMES: { title: string; t: Sliders; dark?: number }[] = [
  { title: 'Quiet confidence', t: { serious: 0.8, expressive: 0.2, cool: 0.55, modern: 0.55 } },
  { title: 'Bold & electric', t: { serious: 0.4, expressive: 0.95, cool: 0.7, modern: 0.9 } },
  { title: 'Warm & handmade', t: { serious: 0.35, expressive: 0.45, cool: 0.15, modern: 0.2 } },
  { title: 'Sunny & playful', t: { serious: 0.12, expressive: 0.85, cool: 0.3, modern: 0.6 } },
  { title: 'Timeless elegance', t: { serious: 0.8, expressive: 0.3, cool: 0.4, modern: 0.08 } },
  { title: 'Fresh & clean', t: { serious: 0.5, expressive: 0.12, cool: 0.7, modern: 0.85 } },
  { title: 'After dark', t: { serious: 0.75, expressive: 0.65, cool: 0.6, modern: 0.6 }, dark: 1 },
  { title: 'Calm & natural', t: { serious: 0.5, expressive: 0.15, cool: 0.3, modern: 0.3 } },
  { title: 'Loud & proud', t: { serious: 0.25, expressive: 1, cool: 0.4, modern: 0.5 } },
  { title: 'Editorial edge', t: { serious: 0.7, expressive: 0.55, cool: 0.45, modern: 0.35 } },
  { title: 'Friendly craft', t: { serious: 0.4, expressive: 0.4, cool: 0.25, modern: 0.4 } },
  { title: 'Sharp & trusted', t: { serious: 0.85, expressive: 0.4, cool: 0.8, modern: 0.65 } },
];

export function nameDirections(items: { traits: Traits }[]): string[] {
  const used = new Set<string>();
  return items.map(({ traits }) => {
    const ranked = NAMES.map((n) => {
      let d = 0;
      for (const k of Object.keys(n.t) as (keyof Sliders)[]) d += (n.t[k] - traits[k]) ** 2;
      if (n.dark !== undefined) d += 0.5 * (n.dark - traits.dark) ** 2;
      else if (traits.dark && n.title !== 'After dark') d += 0.04;
      return { title: n.title, d };
    }).sort((a, b) => a.d - b.d);
    const pick = ranked.find((r) => !used.has(r.title)) ?? ranked[0];
    used.add(pick.title);
    return pick.title;
  });
}

// ── type pairings ────────────────────────────────────────────────────────────

export type Pairing = {
  id: string;
  label: string;
  display: string;
  displayWeight: number;
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  tracking: string;
  heading: string;
  headingWeight: number;
  body: string;
  caption: string;
};

type PairingSpec = Pairing & { t: Sliders; kind: 'sans' | 'serif' | 'display' | 'mono' | 'script' | 'geometric' };

const P = (id: string, display: string, displayWeight: number, heading: string, body: string, t: Sliders, kind: PairingSpec['kind'], extra: Partial<Pairing> = {}): PairingSpec => ({
  id, label: `${display} + ${body}`, display, displayWeight, transform: 'none', tracking: '-0.03em', heading, headingWeight: 600, body, caption: body, t, kind, ...extra,
});

export const PAIRINGS: PairingSpec[] = [
  P('grotesk', 'Inter', 800, 'Inter', 'Inter', { serious: 0.5, expressive: 0.6, cool: 0.6, modern: 0.85 }, 'sans', { tracking: '-0.045em' }),
  P('geometric', 'Outfit', 700, 'Outfit', 'Plus Jakarta Sans', { serious: 0.35, expressive: 0.6, cool: 0.5, modern: 0.9 }, 'geometric', { tracking: '-0.03em' }),
  P('editorial-serif', 'Fraunces', 700, 'Fraunces', 'Inter', { serious: 0.65, expressive: 0.5, cool: 0.4, modern: 0.3 }, 'serif', { tracking: '-0.02em' }),
  P('georgia', 'Georgia', 700, 'Georgia', 'Segoe UI', { serious: 0.7, expressive: 0.35, cool: 0.4, modern: 0.2 }, 'serif', { tracking: '-0.01em' }),
  P('garamond-caps', 'Garamond', 400, 'Garamond', 'Inter', { serious: 0.9, expressive: 0.2, cool: 0.4, modern: 0.1 }, 'serif', { transform: 'uppercase', tracking: '0.1em', headingWeight: 400 }),
  P('poster', 'Impact', 400, 'Archivo', 'Inter', { serious: 0.3, expressive: 1, cool: 0.4, modern: 0.45 }, 'display', { transform: 'uppercase', tracking: '0.02em', headingWeight: 700 }),
  P('black-statement', 'Archivo', 900, 'Archivo', 'Inter', { serious: 0.35, expressive: 0.9, cool: 0.45, modern: 0.7 }, 'display', { transform: 'uppercase', tracking: '-0.01em', headingWeight: 700 }),
  P('hand', 'Caveat', 700, 'Manrope', 'Manrope', { serious: 0.1, expressive: 0.7, cool: 0.1, modern: 0.3 }, 'script', { tracking: '0em', headingWeight: 700 }),
  P('mono-tech', 'JetBrains Mono', 700, 'Inter', 'Inter', { serious: 0.55, expressive: 0.7, cool: 0.85, modern: 0.95 }, 'mono', { transform: 'uppercase', tracking: '0.02em' }),
  P('friendly-round', 'Trebuchet MS', 700, 'Trebuchet MS', 'Verdana', { serious: 0.2, expressive: 0.65, cool: 0.35, modern: 0.5 }, 'sans', { tracking: '-0.015em' }),
  P('sora-soft', 'Sora', 600, 'Sora', 'Manrope', { serious: 0.5, expressive: 0.45, cool: 0.65, modern: 0.92 }, 'geometric', { tracking: '-0.03em' }),
  P('light-wide', 'Inter', 300, 'Inter', 'Inter', { serious: 0.85, expressive: 0.3, cool: 0.55, modern: 0.6 }, 'sans', { transform: 'uppercase', tracking: '0.18em', headingWeight: 500 }),
  P('palatino', 'Palatino Linotype', 400, 'Palatino Linotype', 'Segoe UI', { serious: 0.7, expressive: 0.2, cool: 0.35, modern: 0.12 }, 'serif', { tracking: '0em', headingWeight: 400 }),
  P('montserrat', 'Montserrat', 800, 'Montserrat', 'Inter', { serious: 0.45, expressive: 0.7, cool: 0.5, modern: 0.75 }, 'geometric', { tracking: '-0.02em' }),
];

const toPairing = (p: PairingSpec): Pairing => ({ id: p.id, label: p.label, display: p.display, displayWeight: p.displayWeight, transform: p.transform, tracking: p.tracking, heading: p.heading, headingWeight: p.headingWeight, body: p.body, caption: p.caption });

/** The archetype's own pairing, then the two best-fitting alternatives that differ from it and from each other. */
export function pairingsFor(arch: BrandArchetype, traits: Sliders): Pairing[] {
  const own: Pairing = {
    id: 'signature',
    label: `${arch.typography.display.family} + ${arch.typography.body.family}`,
    display: arch.typography.display.family,
    displayWeight: arch.typography.display.weight,
    transform: arch.typography.display.transform,
    tracking: arch.typography.display.letterSpacing,
    heading: arch.typography.heading.family === arch.typography.display.family ? arch.typography.display.family : arch.typography.heading.family,
    headingWeight: arch.typography.heading.weight,
    body: arch.typography.body.family,
    caption: arch.typography.caption.family === arch.typography.body.family ? arch.typography.body.family : arch.typography.caption.family,
  };
  const dist = (p: PairingSpec) => (Object.keys(WEIGHTS) as (keyof Sliders)[]).reduce((s, k) => s + (p.t[k] - traits[k]) ** 2, 0);
  const rest = PAIRINGS.filter((p) => p.display !== own.display).sort((a, b) => dist(a) - dist(b));
  const first = rest[0];
  const second = rest.find((p) => p !== first && p.display !== first.display && p.kind !== first.kind && p.kind !== 'script') ?? rest.find((p) => p !== first);
  return [own, toPairing(first), toPairing(second ?? rest[1])];
}

// ── motion ───────────────────────────────────────────────────────────────────

export type MotionTune = { easing: string; enter: number; exit: number; hold: number; stagger: number; intensity: MotionIntensity; transitions: string[]; label: string };

/** The way a brand moves for an energy from 0 (a glide) to 1 (a bounce). */
export function motionFor(energy: number): MotionTune {
  const e = clamp(energy);
  const easing = e < 0.22 ? 'cubic-bezier(.4,0,.2,1)' : e < 0.46 ? 'cubic-bezier(.25,.1,.25,1)' : e < 0.7 ? 'cubic-bezier(.16,1,.3,1)' : e < 0.86 ? 'cubic-bezier(.7,0,.2,1)' : 'cubic-bezier(.34,1.56,.64,1)';
  const enter = Math.round(lerp(1.0, 0.36, e) * 100) / 100;
  const intensity: MotionIntensity = e < 0.34 ? 'calm' : e > 0.66 ? 'energetic' : 'balanced';
  return {
    easing,
    enter,
    exit: Math.round(enter * 0.42 * 100) / 100,
    hold: Math.round(lerp(2.5, 1.5, e) * 10) / 10,
    stagger: Math.round(lerp(0.15, 0.05, e) * 100) / 100,
    intensity,
    transitions: intensity === 'calm' ? ['dissolve', 'cut'] : intensity === 'energetic' ? ['cut', 'zoom-punch', 'whip'] : ['cut', 'push', 'wipe'],
    label: e < 0.22 ? 'A slow glide' : e < 0.46 ? 'Easy and unhurried' : e < 0.7 ? 'Confident ease-out' : e < 0.86 ? 'Quick and snappy' : 'Springy overshoot',
  };
}

// ── voice ────────────────────────────────────────────────────────────────────

const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

const SAMPLES = {
  playful: [
    '{Name}: {thing}, with a wink.', 'Hello from {Name}. Pull up a chair.', 'Small joys, made by {Name}.', 'We make {thing}. Joyfully.',
    'Good things happen when {Name} shows up.', 'Made with love. Shared with everyone.', 'Pssst. Your day just got better.', 'Less boring. More {Name}.', 'Say hi to {thing}.',
  ],
  warm: [
    'We make {thing} for {audience}.', 'Clear, friendly and always on your side.', '{Name} is here to make it easy.', 'Made carefully, explained plainly.',
    'Real people. Real {thing}.', 'Start simple. We will take it from there.', 'Built around {audience}, not around us.', '{Name}: the straightforward way.', 'Honest about {thing}, from the first hello.',
  ],
  serious: [
    '{Name} makes {thing}. Precisely.', 'Built for {audience} who expect more.', 'No noise. Just {thing}, done properly.', 'Considered in every detail.',
    'The standard {audience} measure against.', 'Quietly exacting since the first frame.', '{Name}. Nothing wasted.', 'Trust is built one clear sentence at a time.', 'Every detail in service of {thing}.',
  ],
};

const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export type VoiceDraft = { tone: string[]; personality: string[]; use: string[]; avoid: string[]; samples: string[] };

export function voiceFor(brief: Brief, arch: BrandArchetype, index: number, traits: Sliders = brief.sliders): VoiceDraft {
  const tier = traits.serious < 0.36 ? 'playful' : traits.serious > 0.64 ? 'serious' : 'warm';
  const name = brief.name.trim() || 'Your brand';
  const thing = industryThing(brief.industry) || (brief.industry && !/&/.test(brief.industry) ? brief.industry.toLowerCase() : '') || 'work worth sharing';
  const audience = lc(brief.audience.trim()) || 'people like you';
  // Lines that talk about the audience wait until there is one to talk about.
  const bank = SAMPLES[tier].filter((line) => brief.audience.trim() || !line.includes('{audience}'));
  const start = (hash(name) + index) % bank.length;
  const samples = [0, 1, 2].map((i) => bank[(start + i * 3) % bank.length])
    .filter((s, i, all) => all.indexOf(s) === i)
    .map((s) => s.replace('{Name}', name).replace('{thing}', thing).replace('{audience}', audience));
  const feel = tier === 'playful' ? ['playful', 'warm'] : tier === 'serious' ? ['assured', 'precise'] : ['friendly', 'clear'];
  const expressive = traits.expressive > 0.64 ? 'vivid' : traits.expressive < 0.36 ? 'spare' : 'balanced';
  const tone = [...new Set([...feel, expressive, ...arch.voice.tone.slice(0, 2)])].slice(0, 4);
  return {
    tone,
    personality: [...new Set([...tone, ...brief.words.map((w) => w.toLowerCase())])].slice(0, 6),
    use: [...arch.voice.use.slice(0, 2), `plain words about ${thing}`, `speak to ${audience} directly`].slice(0, 4),
    avoid: [...arch.voice.avoid.slice(0, 2), ...(tier === 'playful' ? ['corporate jargon', 'stiff formality'] : tier === 'serious' ? ['slang', 'exclamation marks', 'emoji'] : ['hype', 'jargon'])].slice(0, 4),
    samples,
  };
}

// ── wordmark ─────────────────────────────────────────────────────────────────

export type WordmarkStyle = 'dot' | 'initial' | 'bar';

/** Average glyph width per em of the families a kit can use (a wordmark is sized from it). */
const AVG_WIDTH: Record<string, number> = {
  Verdana: 0.7, 'Trebuchet MS': 0.58, Georgia: 0.6, 'Palatino Linotype': 0.56, Garamond: 0.5, Impact: 0.46, Inter: 0.58, Archivo: 0.6, 'Arial Black': 0.72, Fraunces: 0.6, Caveat: 0.42,
  'JetBrains Mono': 0.62, Consolas: 0.55, 'Courier New': 0.6, 'Cascadia Code': 0.6, Sora: 0.62, Outfit: 0.56, Montserrat: 0.68, Manrope: 0.6, 'Segoe UI': 0.56, 'Times New Roman': 0.52, Cambria: 0.55,
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An SVG wordmark: the name in the display face, with one accent gesture. */
export function wordmarkSvg(opts: { name: string; family: string; weight: number; transform: Pairing['transform']; tracking: string; color: string; accent: string; style: WordmarkStyle }): string {
  const size = 64;
  const raw = opts.name.trim() || 'Brand';
  const text = opts.transform === 'uppercase' ? raw.toUpperCase() : opts.transform === 'lowercase' ? raw.toLowerCase() : raw;
  const em = parseFloat(opts.tracking) || 0;
  const k = AVG_WIDTH[opts.family] ?? 0.58;
  const caps = text === text.toUpperCase() ? 1.2 : 1;
  const extra = opts.style === 'dot' ? 1 : 0;
  // Generous on purpose: the text is centred, so spare room is split evenly and nothing clips.
  const width = Math.ceil((text.length + extra) * size * (k * caps * (opts.weight >= 700 ? 1.08 : 1) + em) * 1.08) + 24;
  const body = opts.style === 'initial'
    ? `<tspan fill="${opts.accent}">${esc(text.slice(0, 1))}</tspan>${esc(text.slice(1))}`
    : opts.style === 'dot' ? `${esc(text)}<tspan fill="${opts.accent}">.</tspan>` : esc(text);
  const bar = opts.style === 'bar' ? `<rect x="${Math.round((width - 56) / 2)}" y="78" width="56" height="7" rx="3.5" fill="${opts.accent}"/>` : '';
  const family = `'${opts.family}', ${fontFallback(opts.family).replace(/"/g, "'")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 92" width="${width}" height="92" role="img" aria-label="${esc(raw)}"><text x="${Math.round(width / 2)}" y="62" text-anchor="middle" font-family="${esc(family)}" font-size="${size}" font-weight="${opts.weight}" letter-spacing="${(em * size).toFixed(1)}" fill="${opts.color}">${body}</text>${bar}</svg>`;
}

// ── palette variants ─────────────────────────────────────────────────────────

export type PaletteVariant = { id: string; label: string; colors: Colors; gradient: BrandArchetype['gradient'] };

export function flipMode(c: Colors): Colors {
  const t = c.primary;
  if (isDark(c.bg)) {
    const bg = mix('#fbfaf7', t, 0.05);
    const text = mix('#101015', t, 0.1);
    return { ...c, bg, surface: mix('#ffffff', t, 0.025), text, muted: mix(text, bg, 0.5) };
  }
  const bg = mix('#09090d', t, 0.12);
  const text = mix('#f7f5f2', t, 0.05);
  return { ...c, bg, surface: mix(bg, '#ffffff', 0.07), text, muted: mix(text, bg, 0.5) };
}

const remap = (g: BrandArchetype['gradient'], from: Colors, to: Colors, pull: number): BrandArchetype['gradient'] => ({
  angle: g.angle,
  stops: g.stops.map((s) => {
    const key = (Object.keys(from) as (keyof Colors)[]).find((k) => from[k].toLowerCase() === s.toLowerCase());
    return key ? to[key] : mix(s, to.primary, pull);
  }),
});

/** The user's colours blended into an archetype palette, strongest on the first direction. */
export function adaptColors(arch: BrandArchetype, seeds: string[], strength: number, swap: boolean): Colors {
  const c: Colors = { ...arch.colors };
  if (seeds.length) {
    const s0 = swap && seeds[1] ? seeds[1] : seeds[0];
    const s1 = swap && seeds[1] ? seeds[0] : seeds[1];
    c.primary = mix(c.primary, s0, strength);
    c.accent = s1 ? mix(c.accent, s1, strength) : c.accent;
    c.accent2 = mix(c.accent2, s1 ?? s0, strength * 0.6);
    c.bg = mix(c.bg, c.primary, 0.05);
    c.surface = mix(c.surface, c.primary, 0.06);
    c.muted = mix(c.muted, c.primary, 0.1);
  }
  // Keep the accent a different colour from the primary.
  const p = hexToHsl(c.primary);
  const a = hexToHsl(c.accent);
  if (p.s > 0.2 && a.s > 0.2 && hueGap(p.h, a.h) < 22 && Math.abs(p.l - a.l) < 0.1) c.accent = hslToHex(p.h + 42, Math.max(a.s, 0.55), clamp(a.l, 0.45, 0.65));
  return fixColors(c);
}

export function paletteVariants(arch: BrandArchetype, base: Colors, wantDark: boolean | null): PaletteVariant[] {
  const gradient = remap(arch.gradient, arch.colors, base, 0.25);
  const signature = base;
  const flipped = fixColors(flipMode(base));
  const shifted = fixColors({ ...base, primary: rotateHue(base.primary, 34), accent: rotateHue(base.accent, 34), accent2: rotateHue(base.accent2, 34) });
  // If the person asked for dark (or light) and the archetype is the other, lead with the flipped one.
  const lead = wantDark !== null && isDark(signature.bg) !== wantDark;
  const list = lead ? [flipped, signature, shifted] : [signature, flipped, shifted];
  const labels = lead ? ['Signature', `Back to ${isDark(signature.bg) ? 'dark' : 'light'}`, 'Hue shifted'] : ['Signature', isDark(signature.bg) ? 'Daylight' : 'Night mode', 'Hue shifted'];
  return list.map((colors, i) => ({ id: ['signature', 'flip', 'shift'][i], label: labels[i], colors, gradient: remap(gradient, base, colors, 0.2) }));
}

// ── directions ───────────────────────────────────────────────────────────────

export type RefineChoice = { palette: number; pairing: number; energy: number };

export type Direction = {
  id: string;
  index: number;
  title: string;
  archetypeId: string;
  archetypeName: string;
  archetypeGroup: BrandArchetype['group'];
  rationale: string;
  traits: Traits;
  fit: number;
  palettes: PaletteVariant[];
  pairings: Pairing[];
  /** Default energy 0…1 for this direction (the archetype's, pulled toward the brief). */
  energy: number;
  wordmark: WordmarkStyle;
  /** The logo shown in the lockup: the user's, or the generated wordmark. */
  logo: { svg: string | null; dataUrl: string | null; generated: boolean };
  voice: VoiceDraft;
  kit: BrandKit;
  issues: string[];
  brief: Brief;
  base: BrandArchetype;
};

export const archetypeLabel = (name: string): string => name.replace(/\s*\((reference|house)\)$/, '');

export function sanitizeSvg(text: string): string {
  return text
    .replace(/<\?xml[^>]*>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '').trim();
}

// Each direction's one-line rationale says what makes it different from the other two: its stance
// (light or dark plus the two traits where it stands apart) and its signature move (palette, type, motion).
type Axis = keyof Sliders;
const ADJ: Record<Axis, { hi: string[]; lo: string[] }> = {
  serious: { hi: ['precise', 'assured', 'composed'], lo: ['playful', 'cheeky', 'sunny'] },
  expressive: { hi: ['bold', 'vivid', 'loud'], lo: ['spare', 'quiet', 'restrained'] },
  cool: { hi: ['crisp', 'techy', 'cool'], lo: ['warm', 'earthy', 'inviting'] },
  modern: { hi: ['modern', 'sharp', 'forward'], lo: ['timeless', 'classic', 'heritage'] },
};
const AXES: Axis[] = ['serious', 'expressive', 'cool', 'modern'];
const SANS_ROUND = new Set(['Outfit', 'Sora', 'Montserrat', 'Manrope', 'Plus Jakarta Sans']);

function typePhrase(p: Pairing): string {
  const caps = p.transform === 'uppercase' ? ' capitals' : '';
  const f = p.display;
  if (SERIF.has(f)) return `${f}${caps || ' serif type'}`;
  if (MONO.has(f)) return `monospaced ${f}${caps}`;
  if (f === 'Caveat') return 'a handwritten display face';
  if (f === 'Impact' || f === 'Archivo' || f === 'Arial Black') return `heavy ${f}${caps || ' headlines'}`;
  if (SANS_ROUND.has(f)) return `${f}'s geometric sans${caps}`;
  return `clean ${f}${caps || ' type'}`;
}

const motionPhrase = (energy: number): string => { const i = motionFor(energy).intensity; return i === 'calm' ? 'slow, unhurried motion' : i === 'energetic' ? 'quick, springy motion' : 'confident ease-out motion'; };

/** Rewrites each direction's rationale relative to the others; the first four words never repeat. */
export function writeRationales(dirs: Direction[], brief: Brief): void {
  const who = brief.audience ? lc(brief.audience) : brief.industry ? `${lc(brief.industry)} brands` : 'your people';
  const nod = brief.city ? `, with a nod to ${brief.city}` : '';
  const openings = new Set<string>();
  dirs.forEach((d, i) => {
    const others = dirs.filter((_, j) => j !== i);
    const ranked = AXES.map((axis) => {
      const mean = others.reduce((sum, o) => sum + o.traits[axis], 0) / Math.max(1, others.length);
      return { axis, score: Math.abs(d.traits[axis] - 0.5) + 1.5 * Math.abs(d.traits[axis] - mean) };
    }).sort((x, y) => y.score - x.score);
    const mode = isDark(d.palettes[0].colors.bg) ? 'Dark' : 'Light';
    let opening = '';
    for (let shift = 0; shift < 9; shift++) {
      const words = ranked.slice(0, 2).map((r, k) => { const pool = d.traits[r.axis] >= 0.5 ? ADJ[r.axis].hi : ADJ[r.axis].lo; return pool[(i + k * 2 + shift) % pool.length]; });
      const alt = words[0] === words[1] ? ADJ[ranked[2].axis][d.traits[ranked[2].axis] >= 0.5 ? 'hi' : 'lo'][0] : words[1];
      opening = `${mode}, ${words[0]} and ${alt}`;
      if (!openings.has(opening.toLowerCase())) break;
    }
    openings.add(opening.toLowerCase());
    const c = d.palettes[0].colors;
    const canvas = isDark(c.bg) ? 'canvas' : 'space';
    d.rationale = `${opening}: ${colorName(c.bg)} ${canvas} with ${colorName(c.accent)} accents, ${typePhrase(d.pairings[0])} and ${motionPhrase(d.energy)}, for ${who}${nod}.`;
  });
}

const dedupe = <T,>(items: T[]) => [...new Set(items)];

/** The final kit for a direction and the person's refinements (palette 0–2, pairing 0–2, energy 0–1). */
export function buildDirectionKit(d: Pick<Direction, 'base' | 'palettes' | 'pairings' | 'brief' | 'logo' | 'wordmark' | 'index' | 'traits'>, choice: RefineChoice): { kit: BrandKit; issues: string[] } {
  const { brief, base } = d;
  const pal = d.palettes[Math.max(0, Math.min(d.palettes.length - 1, choice.palette))];
  const pair = d.pairings[Math.max(0, Math.min(d.pairings.length - 1, choice.pairing))];
  const motion = motionFor(choice.energy);
  const colors = pal.colors;
  const sliders = brief.sliders;
  const name = brief.name.trim() || 'My brand';
  const generated = d.logo.generated
    ? wordmarkSvg({ name, family: pair.display, weight: pair.displayWeight, transform: pair.transform, tracking: pair.tracking, color: ensureContrast(colors.primary, colors.bg, 4.5), accent: colors.accent, style: d.wordmark })
    : null;
  const arch: BrandArchetype = {
    ...base,
    colors,
    gradient: pal.gradient,
    typography: {
      display: { family: pair.display, weight: pair.displayWeight, letterSpacing: pair.tracking, transform: pair.transform },
      heading: { family: pair.heading, weight: pair.headingWeight },
      body: { family: pair.body, weight: 400 },
      caption: { family: pair.caption, weight: 600 },
    },
    motion: { easing: motion.easing, enter: motion.enter, exit: motion.exit, hold: motion.hold, stagger: motion.stagger, intensity: motion.intensity, transitions: motion.transitions },
  };
  const voice = voiceFor(brief, base, d.index, sliders);
  const input: NewBrandKitInput = {
    name,
    brandName: name,
    tagline: voice.samples[0] ?? '',
    description: brief.makes.trim() || `${name} makes ${industryThing(brief.industry) || 'work worth sharing'}${brief.audience ? ` for ${lc(brief.audience)}` : ''}.`,
    industry: brief.industry || base.industries[0],
    audience: brief.audience,
    values: brief.words.map((w) => w.toLowerCase()),
    logoSvg: d.logo.svg ?? generated ?? undefined,
    voice: { tone: voice.tone, personality: voice.personality, use: voice.use, avoid: voice.avoid, samples: voice.samples },
    motion: { easing: motion.easing, enter: motion.enter, exit: motion.exit, hold: motion.hold, stagger: motion.stagger, intensity: motion.intensity, transitions: motion.transitions },
    notes: `Made with the brand wizard from "${d.base.name}" and a brief: ${[brief.makes, brief.city && `nods to ${brief.city}`].filter(Boolean).join('; ')}.`,
  };
  const built = kitFromArchetypeChecked(arch, input);
  let kit = built.kit;
  const issues = [...built.issues];
  const keywords = dedupe([...base.industries, ...brief.words.map((w) => w.toLowerCase()), ...(brief.industry ? [brief.industry.toLowerCase()] : [])]).slice(0, 10);
  const patches: [Parameters<typeof mergeBrandKitChecked>[1], Record<string, unknown>][] = [
    ['imagery', { keywords, promptSuffix: `brand colours ${colors.primary} and ${colors.accent}, ${isDark(colors.bg) ? 'dark' : 'light'} background${brief.city ? `, a hint of ${brief.city}` : ''}` }],
    ['layout', { radius: Math.round(lerp(0.045, 0.012, sliders.serious) * 1000) / 1000 }],
  ];
  if (!d.logo.svg && d.logo.dataUrl) {
    patches.push(['logos', { logos: [{ id: `logo_${Math.abs(hash(d.logo.dataUrl)).toString(36)}`, role: 'primary', assetId: null, path: brief.logo?.path ?? null, svg: null, dataUrl: d.logo.dataUrl, clearSpace: 1, minSize: 64, placement: kit.layout.logoBug, on: 'any', doNots: ['Do not stretch, rotate or recolour the mark.'] }] }]);
  }
  for (const [section, patch] of patches) {
    const merged = mergeBrandKitChecked(kit, section, patch);
    kit = merged.kit;
    issues.push(...merged.issues);
  }
  return { kit, issues };
}

/** Three distinct directions for a brief. */
export function generateDirections(brief: Brief): Direction[] {
  const picks = pickThree(brief);
  const seeds = seedColors(brief);
  const wantDark = wantsDark(brief);
  const strengths = [0.92, 0.66, 0.46];
  const energyOfBrief = clamp((1 - brief.sliders.serious) * 0.55 + brief.sliders.expressive * 0.45);
  const feltOf = (arch: BrandArchetype): Sliders => {
    const t = traitsOf(arch);
    return { serious: lerp(t.serious, brief.sliders.serious, 0.5), expressive: lerp(t.expressive, brief.sliders.expressive, 0.5), cool: lerp(t.cool, brief.sliders.cool, 0.5), modern: lerp(t.modern, brief.sliders.modern, 0.5) };
  };
  const titles = nameDirections(picks.map((p) => ({ traits: { ...traitsOf(p.archetype), ...feltOf(p.archetype) } })));
  const styles: WordmarkStyle[] = ['dot', 'initial', 'bar'];

  const built = picks.map((pick, index) => {
    const arch = pick.archetype;
    const base = adaptColors(arch, seeds, strengths[index] ?? 0.4, index === 1);
    const palettes = paletteVariants(arch, base, wantDark);
    const traits = { ...traitsOf(arch) };
    // The direction's own feel: the archetype's, pulled halfway toward what the sliders asked for.
    const felt: Sliders = {
      serious: lerp(traits.serious, brief.sliders.serious, 0.5), expressive: lerp(traits.expressive, brief.sliders.expressive, 0.5),
      cool: lerp(traits.cool, brief.sliders.cool, 0.5), modern: lerp(traits.modern, brief.sliders.modern, 0.5),
    };
    const pairings = pairingsFor(arch, felt);
    const energy = clamp(lerp(ENERGY[arch.motion.intensity], energyOfBrief, 0.5));
    const hasLogo = !!(brief.logo && (brief.logo.svg || brief.logo.dataUrl));
    const logo = { svg: brief.logo?.svg ? sanitizeSvg(brief.logo.svg) : null, dataUrl: brief.logo?.dataUrl ?? null, generated: !hasLogo };
    const partial = { base: arch, palettes, pairings, brief, logo, wordmark: styles[index] ?? 'dot', index, traits };
    const { kit, issues } = buildDirectionKit(partial, { palette: 0, pairing: 0, energy });
    return {
      id: `${arch.id}-${index}`,
      index,
      title: titles[index],
      archetypeId: arch.id,
      archetypeName: archetypeLabel(arch.name),
      archetypeGroup: arch.group,
      rationale: '',
      traits: { ...traits, ...felt },
      fit: Math.round(clamp(pick.score) * 100) / 100,
      palettes,
      pairings,
      energy,
      wordmark: styles[index] ?? 'dot',
      logo,
      voice: voiceFor(brief, arch, index, brief.sliders),
      kit,
      issues,
      brief,
      base: arch,
    };
  });
  writeRationales(built, brief);
  return built;
}
