// Building, merging, reading and rendering brand kits.
//
// A kit starts from an archetype (the house look, a style, or a reference kit) plus whatever the
// user or the AI supplies, and every other part of Bhippi reads it through the small functions
// here: a React Bits theme, the Crimson accent and type stack, generation prompt rules, CSS
// variables, a compact context object for the system prompt, and the brand board graphic the
// Settings panel previews and the AI can place on the timeline.

import { learningsBrief } from './learnings';
import { normalizeGradients, normalizeKitGradients } from './gradients';
import { brandSummary, brandVars, type Brand, type TypeScale } from '../brand';
import { TIMING } from '../motion';
import { RBX_BASE_CSS, esc, px, type BitTheme } from '../rbx/core';
import type { Project } from '../types';
import { ARCHETYPES, HOUSE_ARCHETYPE, findArchetype } from './archetypes';
import { compactGuideline, guidelineOf, refineGuideline } from './guideline';
import { isDataUrl } from './logoData';
import {
  BRAND_KIT_SECTIONS,
  type BrandArchetype, type BrandColorToken, type BrandColors, type BrandKit, type BrandKitDoc, type BrandKitSection, type BrandLogo, type BrandTypeface, type ColorRole, type LogoRole,
} from './types';

export const BRAND_KIT_VERSION = 1 as const;

const uid = () => `bk_${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();
export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// ── colour maths ─────────────────────────────────────────────────────────────

const parse = (hex: string) => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.slice(0, 6);
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
};
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, amount: number): string => {
  const one = parse(a);
  const two = parse(b);
  return toHex(one.r + (two.r - one.r) * amount, one.g + (two.g - one.g) * amount, one.b + (two.b - one.b) * amount);
};
const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export const relativeLuminance = (hex: string): number => { const { r, g, b } = parse(hex); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
};
export const isDark = (hex: string): boolean => relativeLuminance(hex) < 0.35;
/** A hex with alpha appended, for rims and lines. */
export const withAlpha = (hex: string, alpha: number): string => `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;

// ── type ─────────────────────────────────────────────────────────────────────

/** Families that resolve on a stock Windows/macOS machine; preview and export both read names only. */
export const SYSTEM_FONTS = ['Inter', 'Segoe UI', 'Arial', 'Helvetica', 'Arial Black', 'Impact', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Calibri', 'Candara', 'Georgia', 'Cambria', 'Palatino Linotype', 'Garamond', 'Times New Roman', 'Consolas', 'Courier New', 'Cascadia Code', 'JetBrains Mono', 'Segoe UI Black', 'Manrope', 'Plus Jakarta Sans', 'Sora', 'Outfit', 'Montserrat', 'Fraunces', 'Caveat', 'Archivo'];
const SERIF = new Set(['Georgia', 'Cambria', 'Palatino Linotype', 'Garamond', 'Times New Roman']);
const MONO = new Set(['Consolas', 'Courier New', 'Cascadia Code', 'JetBrains Mono']);

export const fontFallback = (family: string): string =>
  SERIF.has(family) ? `Georgia, "Times New Roman", serif` : MONO.has(family) ? `Consolas, "Courier New", monospace` : `"Segoe UI", Arial, Helvetica, sans-serif`;
export const fontStack = (face: Pick<BrandTypeface, 'family' | 'fallback'>): string => `"${face.family}", ${face.fallback}`;

export const typeface = (family: string, weight: number, extra: Partial<BrandTypeface> = {}): BrandTypeface => ({
  family, fallback: fontFallback(family), weight, letterSpacing: '-0.02em', transform: 'none', italic: false, ...extra,
});

// ── construction ─────────────────────────────────────────────────────────────

export type NewBrandKitInput = {
  /** The archetype id/name/word to start from; the house look when unknown. */
  style?: string;
  name?: string;
  brandName?: string;
  tagline?: string;
  description?: string;
  industry?: string;
  audience?: string;
  values?: string[];
  /** Quick colour overrides. */
  primary?: string;
  accent?: string;
  accent2?: string;
  background?: string;
  surface?: string;
  text?: string;
  /** Quick type overrides. */
  displayFont?: string;
  bodyFont?: string;
  /** Vector logo markup. */
  logoSvg?: string;
  voice?: Partial<BrandKit['voiceGuide']>;
  motion?: Partial<BrandKit['motionGuide']>;
  imagery?: Partial<BrandKit['imagery']>;
  layout?: Partial<BrandKit['layout']>;
  audio?: Partial<BrandKit['audio']>;
  social?: Partial<BrandKit['social']>;
  notes?: string;
  id?: string;
};

const pick = <T extends string>(value: unknown, fallback: T): T => (isHex(value) ? (value as T) : fallback);

/** Semantic tokens from the seven archetype colours. */
export function tokensFrom(c: BrandArchetype['colors']): BrandColorToken[] {
  return [
    { name: 'Background', hex: c.bg, role: 'background', usage: 'Full-frame fields, plates behind graphics.' },
    { name: 'Surface', hex: c.surface, role: 'surface', usage: 'Cards, panels, lower thirds.' },
    { name: 'Text', hex: c.text, role: 'text', usage: 'Headlines and body on background and surface.' },
    { name: 'Muted', hex: c.muted, role: 'muted', usage: 'Secondary lines, kickers, timestamps.' },
    { name: 'Primary', hex: c.primary, role: 'primary', usage: 'Brand colour: logo, big fills, key bars.' },
    { name: 'Accent', hex: c.accent, role: 'accent', usage: 'The one highlight: the accent word, rules, live states.' },
    { name: 'Accent 2', hex: c.accent2, role: 'secondary', usage: 'Second highlight, gradients, hover states — sparingly.' },
    { name: 'Success', hex: '#1FBF75', role: 'success', usage: 'Confirmations, checks.' },
    { name: 'Warning', hex: '#F5B301', role: 'warning', usage: 'Cautions, timers.' },
    { name: 'Error', hex: '#FF3B30', role: 'error', usage: 'Errors, deletes, declines.' },
  ];
}

export function colorsFrom(arch: BrandArchetype, c: BrandArchetype['colors']): BrandColors {
  const tokens = tokensFrom(c);
  return {
    tokens,
    gradients: [
      { name: 'Brand', angle: arch.gradient.angle, stops: arch.gradient.stops, usage: 'Hero backgrounds, gradient text on a dark field.' },
      { name: 'Accent sweep', angle: 90, stops: [c.accent, c.accent2], usage: 'Bars, rules, progress.' },
    ],
    pairs: [
      { fg: c.text, bg: c.bg, ratio: contrastRatio(c.text, c.bg), use: 'Body and headlines on the background.' },
      { fg: c.text, bg: c.surface, ratio: contrastRatio(c.text, c.surface), use: 'Text on cards.' },
      { fg: isDark(c.primary) ? '#FFFFFF' : '#111111', bg: c.primary, ratio: contrastRatio(isDark(c.primary) ? '#FFFFFF' : '#111111', c.primary), use: 'Text on the primary fill (buttons, pills).' },
    ],
    rules: [
      `Budget: about 75% ${isDark(c.bg) ? 'dark field or footage' : 'light field or footage'}, 17% information, 8% accent.`,
      `${c.accent} is the only highlight colour; use it once per frame.`,
      'Footage keeps its natural colour; only graphics take the brand grade.',
      'Never place text on the primary fill without checking the contrast pair.',
    ],
    daisyTheme: null,
    openPropsHue: null,
  };
}

/** A full kit from an archetype and the details the user or the AI gave. */
export function kitFromArchetype(arch: BrandArchetype, input: NewBrandKitInput = {}): BrandKit {
  const c = {
    bg: pick(input.background, arch.colors.bg),
    surface: pick(input.surface, arch.colors.surface),
    text: pick(input.text, arch.colors.text),
    muted: arch.colors.muted,
    primary: pick(input.primary, arch.colors.primary),
    accent: pick(input.accent, input.primary && !input.accent ? arch.colors.accent : arch.colors.accent),
    accent2: pick(input.accent2, arch.colors.accent2),
  };
  if (input.primary && !input.accent) c.accent = mix(c.primary, '#ffffff', 0.18);
  const brandName = input.brandName?.trim() || input.name?.trim() || 'My brand';
  const displayFamily = input.displayFont && SYSTEM_FONTS.includes(input.displayFont) ? input.displayFont : arch.typography.display.family;
  const bodyFamily = input.bodyFont && SYSTEM_FONTS.includes(input.bodyFont) ? input.bodyFont : arch.typography.body.family;
  const dark = isDark(c.bg);
  const scale: TypeScale = arch.motion.intensity === 'energetic'
    ? { hook: 13, title: 9.5, subtitle: 5.5, body: 3.8, label: 2.8, caption: 7 }
    : arch.motion.intensity === 'calm'
      ? { hook: 9, title: 6.5, subtitle: 4.4, body: 3.2, label: 2.4, caption: 5.2 }
      : { hook: 11, title: 8, subtitle: 5, body: 3.6, label: 2.6, caption: 6 };
  const stamp = now();
  const brand: Brand = {
    name: input.name?.trim() || brandName,
    voice: arch.character,
    palette: { accent: c.accent, ink: c.bg, surface: c.surface, text: c.text, muted: c.muted, accentAlt: c.accent2 },
    fonts: { display: displayFamily, body: bodyFamily, mono: 'Consolas' },
    type: scale,
    radius: arch.motion.intensity === 'energetic' ? 0.018 : arch.id.includes('playful') || arch.id.includes('kids') ? 0.04 : 0.022,
    shadow: dark ? 0.45 : 0.25,
    motion: { entrance: 'entrance', exit: 'exit', emphasis: arch.motion.intensity === 'energetic' ? 'overshoot' : 'standard', beat: arch.motion.intensity === 'energetic' ? TIMING.quick : arch.motion.intensity === 'calm' ? TIMING.slow : TIMING.normal },
    captionStyle: null,
    derivedFrom: `the ${arch.name} archetype`,
  };
  const logos: BrandLogo[] = input.logoSvg?.trim().startsWith('<svg')
    ? [{ id: uid(), role: 'primary', svg: input.logoSvg.trim(), assetId: null, path: null, dataUrl: null, clearSpace: 1, minSize: 64, placement: arch.layout.logoBug, on: dark ? 'dark' : 'light', doNots: ['Do not stretch, rotate or recolour the mark.', 'Do not place it on busy footage without a plate.'] }]
    : [];
  return {
    ...brand,
    id: input.id ?? uid(),
    version: BRAND_KIT_VERSION,
    style: arch.id,
    tagline: input.tagline?.trim() ?? '',
    description: input.description?.trim() ?? arch.character,
    industry: input.industry?.trim() ?? arch.industries[0] ?? '',
    audience: input.audience?.trim() ?? '',
    values: input.values?.filter((v) => typeof v === 'string' && v.trim()).slice(0, 8) ?? [],
    createdAt: stamp,
    updatedAt: stamp,
    logos,
    colors: colorsFrom(arch, c),
    typography: {
      display: typeface(displayFamily, arch.typography.display.weight, { letterSpacing: arch.typography.display.letterSpacing, transform: arch.typography.display.transform }),
      heading: typeface(arch.typography.heading.family === arch.typography.display.family ? displayFamily : arch.typography.heading.family, arch.typography.heading.weight, { letterSpacing: '-0.03em' }),
      body: typeface(bodyFamily, arch.typography.body.weight, { letterSpacing: '-0.01em' }),
      caption: typeface(arch.typography.caption.family === arch.typography.body.family ? bodyFamily : arch.typography.caption.family, arch.typography.caption.weight, { letterSpacing: '-0.01em' }),
      mono: typeface('Consolas', 500, { letterSpacing: '0' }),
      scale,
      lineHeight: 1.1,
      rules: [
        `Display: ${displayFamily} ${arch.typography.display.weight}${arch.typography.display.transform !== 'none' ? `, ${arch.typography.display.transform}` : ''}; one grotesque or one serif per frame, never three fonts in a title.`,
        'Hero 112–144 px, heading 64–88, body 32–44, captions 44–52 at 1080p; tabular figures for numbers.',
        'Titles hold at least 1.5–2 s; captions 32–42 characters per line, one accent word at most.',
      ],
    },
    voiceGuide: {
      tone: arch.voice.tone,
      personality: arch.voice.tone,
      use: arch.voice.use,
      avoid: arch.voice.avoid,
      samples: arch.voice.samples,
      language: 'en',
      captionRules: ['Phrase-based cues, stable line breaks, sentence case unless the display face is uppercase.', 'No emoji in captions unless the voice guide allows them.'],
      ...input.voice,
    },
    motionGuide: {
      easing: arch.motion.easing,
      enter: arch.motion.enter,
      exit: arch.motion.exit,
      hold: arch.motion.hold,
      stagger: arch.motion.stagger,
      intensity: arch.motion.intensity,
      transitions: arch.motion.transitions,
      principles: ['One primary motion and at most one secondary at a time.', 'Motion follows meaning: build, transform, explain, hold.', 'Cuts and entrances land on beats; J/L-cut audio across seams.'],
      preferredBits: arch.motion.intensity === 'energetic' ? ['glitch-text', 'split-text', 'count-up', 'star-border', 'zoom-punch'] : arch.motion.intensity === 'calm' ? ['blur-text', 'fade-content', 'masked-heading', 'spotlight-card'] : ['split-text', 'blur-text', 'count-up', 'animated-list', 'magic-bento'],
      preferredTemplates: ['hook-promise', 'teaching-card', 'stat-chart', 'crimson-lower-third'],
      animateCss: arch.motion.intensity === 'energetic' ? { entrance: 'bounceInUp', exit: 'fadeOutUp', attention: 'pulse' } : arch.motion.intensity === 'calm' ? { entrance: 'fadeInUp', exit: 'fadeOut', attention: 'pulse' } : { entrance: 'fadeInUp', exit: 'fadeOutUp', attention: 'heartBeat' },
      openPropsEase: arch.motion.intensity === 'energetic' ? 'ease-spring-3' : arch.motion.intensity === 'calm' ? 'ease-out-4' : 'ease-3',
      ...input.motion,
    },
    imagery: {
      style: arch.imagery.style,
      photography: [arch.imagery.style],
      illustration: arch.imagery.iconography === 'flat' ? 'Flat, bold shapes.' : arch.imagery.iconography === 'hand-drawn' ? 'Hand-drawn line illustration.' : 'Minimal, geometric.',
      iconography: (['line', 'filled', 'duotone', '3d', 'flat', 'hand-drawn', 'custom'] as const).find((k) => k === arch.imagery.iconography) ?? 'line',
      grade: { ...arch.imagery.grade, note: `${arch.imagery.grade.saturation >= 0 ? 'keep' : 'reduce'} saturation, ${arch.imagery.grade.contrast >= 0 ? 'lift' : 'soften'} contrast, ${arch.imagery.grade.warmth >= 0 ? 'warm' : 'cool'} balance.` },
      promptPrefix: arch.imagery.promptPrefix,
      promptSuffix: `brand colours ${c.primary} and ${c.accent}, ${dark ? 'dark' : 'light'} background`,
      negativePrompt: arch.imagery.negativePrompt,
      keywords: arch.industries,
      avoid: [],
      ...input.imagery,
    },
    layout: {
      safeMargin: arch.layout.safeMargin,
      grid: 12,
      logoBug: arch.layout.logoBug,
      lowerThird: arch.layout.lowerThird,
      captions: arch.layout.captions,
      radius: brand.radius,
      aspects: ['16:9', '9:16', '1:1'],
      rules: ['Graphics sit in the free side of the frame; never text across a face.', `Keep ${Math.round(arch.layout.safeMargin * 100)}% clear on every side.`, `Logo bug ${arch.layout.logoBug}; lower thirds ${arch.layout.lowerThird}; captions ${arch.layout.captions}.`],
      ...input.layout,
    },
    audio: { music: arch.audio.music, tempo: arch.audio.tempo, sfx: arch.audio.sfx, voice: null, voiceMode: null, rules: ['Music 18–24 dB under speech, ducked 3–5 dB more under dense phrases.', 'A whoosh leads a panel by 1–2 frames; no hit on every word.'], ...input.audio },
    social: { platforms: ['YouTube', 'Instagram Reels', 'TikTok'], intro: 'First two seconds: the promise, in the brand voice, with the logo bug present.', outro: 'Last three seconds: the end card with the mark, one call to action, and a hold.', endCard: ['Logo', 'Tagline', 'One call to action', 'Handle'], hashtags: [], rules: ['Vertical: type up one size; captions above the bottom 12%.'], ...input.social },
    assets: [],
    notes: input.notes?.trim() ?? '',
  };
}

export const newBrandKit = (input: NewBrandKitInput = {}): BrandKit => kitFromArchetype(findArchetype(input.style) ?? HOUSE_ARCHETYPE, input);

const SECTION_KEYS: Record<BrandKitSection, (keyof BrandKit)[]> = {
  identity: ['name', 'tagline', 'description', 'industry', 'audience', 'values', 'style', 'voice'],
  logos: ['logos'],
  colors: ['colors', 'palette'],
  typography: ['typography', 'fonts', 'type'],
  voice: ['voiceGuide'],
  motion: ['motionGuide', 'motion'],
  imagery: ['imagery'],
  layout: ['layout', 'radius'],
  audio: ['audio'],
  social: ['social'],
  assets: ['assets'],
  notes: ['notes'],
  guideline: ['guideline'],
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = <T>(base: T, patch: unknown): T => {
  if (!isRecord(base) || !isRecord(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) out[key] = isRecord(value) && isRecord(out[key]) ? deepMerge(out[key], value) : value;
  return out as T;
};

/** Merges a patch into one section (or the whole kit with 'all'); keeps derived fields in step. */
export function mergeBrandKit(kit: BrandKit, section: BrandKitSection | 'all', patch: Record<string, unknown>): BrandKit {
  // The kit keeps only the guideline's refinements (moves, layouts and recipes merged by id), so the
  // rest keeps following the kit's edits; null resets it.
  if (section === 'guideline') {
    const value = 'guideline' in patch ? patch.guideline : patch;
    if (value === null) return { ...kit, guideline: null, updatedAt: now() };
    const source = isRecord(value) && (value.source === 'edited' || value.source === 'ai') ? value.source : 'ai';
    return { ...kit, guideline: refineGuideline(kit, isRecord(value) ? value : {}, source), updatedAt: now() };
  }
  const allowed = section === 'all' ? null : new Set<string>(SECTION_KEYS[section] as string[]);
  // A guideline an older Bhippi saved whole is cut to its refinements against the kit before this
  // edit, the one it was derived from, so the edit reaches everything nobody refined.
  let next: BrandKit = { ...compactGuideline(normalizeKitGradients(kit)) };
  for (const [key, value] of Object.entries(patch)) {
    const target = section === 'all' ? key : allowed?.has(key) ? key : SECTION_KEYS[section][0];
    const current = (next as unknown as Record<string, unknown>)[target];
    (next as unknown as Record<string, unknown>)[target] = target === key ? deepMerge(current, value) : deepMerge(current, { [key]: value });
  }
  // Keep the quick palette in step with the token list, and vice versa.
  const token = (role: ColorRole) => next.colors?.tokens?.find((t) => t.role === role)?.hex;
  if (section === 'colors' || section === 'all') {
    next = {
      ...next,
      palette: {
        accent: token('accent') ?? next.palette.accent,
        ink: token('background') ?? next.palette.ink,
        surface: token('surface') ?? next.palette.surface,
        text: token('text') ?? next.palette.text,
        muted: token('muted') ?? next.palette.muted,
        accentAlt: token('secondary') ?? next.palette.accentAlt,
      },
    };
  }
  if (section === 'typography' || section === 'all') {
    next = { ...next, fonts: { display: next.typography.display.family, body: next.typography.body.family, mono: next.typography.mono.family }, type: next.typography.scale };
  }
  return { ...normalizeKitGradients(next), updatedAt: now() };
}

export function validateBrandKit(kit: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(kit)) return ['a brand kit must be an object'];
  const k = kit as Partial<BrandKit>;
  if (!k.id) errors.push('missing id');
  if (!k.name) errors.push('missing name');
  if (!k.colors || !Array.isArray(k.colors.tokens) || k.colors.tokens.length < 4) errors.push('colors.tokens needs at least background, surface, text and accent');
  for (const t of k.colors?.tokens ?? []) if (!isHex(t.hex)) errors.push(`token ${t.name ?? '?'} has no 6-digit hex`);
  if (!k.typography?.display?.family) errors.push('typography.display.family is required');
  for (const face of ['display', 'heading', 'body', 'caption'] as const) {
    const family = k.typography?.[face]?.family;
    if (family && !SYSTEM_FONTS.includes(family)) errors.push(`typography.${face}: "${family}" is not a system-safe family (${SYSTEM_FONTS.slice(0, 8).join(', ')}…)`);
  }
  if (k.motionGuide && !(k.motionGuide.enter > 0 && k.motionGuide.exit > 0 && k.motionGuide.hold >= 0)) errors.push('motionGuide enter/exit/hold must be positive seconds');
  for (const logo of k.logos ?? []) if (!logo.svg && !logo.path && !logo.assetId && !logo.dataUrl) errors.push(`logo ${logo.role} has no svg, path or asset`);
  return errors;
}

// ── consumers ────────────────────────────────────────────────────────────────

export const kitColor = (kit: BrandKit, role: ColorRole): string | undefined => kit.colors.tokens.find((t) => t.role === role)?.hex;

/** The React Bits theme a kit becomes (`theme: "brand"`). */
export function brandKitTheme(kit: BrandKit): BitTheme {
  const bg = kitColor(kit, 'background') ?? kit.palette.ink;
  const text = kitColor(kit, 'text') ?? kit.palette.text;
  return {
    name: 'brand',
    bg,
    fg: text,
    muted: kitColor(kit, 'muted') ?? kit.palette.muted,
    accent: kitColor(kit, 'accent') ?? kit.palette.accent,
    accent2: kitColor(kit, 'secondary') ?? kit.palette.accentAlt,
    card: kitColor(kit, 'surface') ?? kit.palette.surface,
    line: withAlpha(text, 0.36),
  };
}

/** What Crimson templates take from a kit. */
export function brandKitCrimson(kit: BrandKit): { accent: string; fontStack: string; tokens: Record<string, string> } {
  const theme = brandKitTheme(kit);
  return {
    accent: theme.accent,
    fontStack: fontStack(kit.typography.display),
    tokens: { '--void': theme.bg, '--ox': theme.bg, '--burg': mix(theme.bg, theme.card, 0.5), '--panel': theme.card, '--glow': mix(theme.accent, theme.bg, 0.4), '--accent': theme.accent, '--rim': withAlpha(theme.fg, 0.55), '--white': theme.fg, '--muted': theme.muted, '--pink': theme.accent2 },
  };
}

/** Generation prompt rules for image and video models. */
export function brandKitPrompt(kit: BrandKit, kind: 'image' | 'video' = 'image'): { prefix: string; suffix: string; negative: string; grade: BrandKit['imagery']['grade'] } {
  const motion = kind === 'video' ? `, ${kit.motionGuide.intensity === 'calm' ? 'slow gentle camera' : kit.motionGuide.intensity === 'energetic' ? 'dynamic camera, fast motion' : 'steady camera'}` : '';
  return { prefix: kit.imagery.promptPrefix.trim(), suffix: `${kit.imagery.promptSuffix.trim()}${motion}`, negative: kit.imagery.negativePrompt.trim(), grade: kit.imagery.grade };
}

/** Prefixes a generation prompt and its negative with the kit's imagery rules, once. */
export function brandedPrompt(kit: BrandKit, prompt: string, negative: string | undefined, kind: 'image' | 'video'): { prompt: string; negative: string } {
  const rules = brandKitPrompt(kit, kind);
  const already = prompt.includes(rules.prefix.slice(0, 24));
  return {
    prompt: already ? prompt : [rules.prefix, prompt.trim(), rules.suffix].filter(Boolean).join(' '),
    negative: negative && negative.includes(rules.negative.slice(0, 20)) ? negative : [negative?.trim(), rules.negative].filter(Boolean).join(', '),
  };
}

/** CSS custom properties for a graphic root: the older `--b-*` set plus `--bk-*` for every token. */
export function brandKitVars(kit: BrandKit, shortSide = 1080): Record<string, string> {
  const vars: Record<string, string> = { ...brandVars(kit, shortSide) };
  for (const token of kit.colors.tokens) vars[`--bk-${token.role === 'custom' ? token.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : token.role}`] = token.hex;
  normalizeGradients(kit.colors.gradients).forEach((g, i) => { vars[`--bk-gradient-${i + 1}`] = `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`; });
  vars['--bk-display'] = fontStack(kit.typography.display);
  vars['--bk-heading'] = fontStack(kit.typography.heading);
  vars['--bk-body'] = fontStack(kit.typography.body);
  vars['--bk-caption'] = fontStack(kit.typography.caption);
  vars['--bk-mono'] = fontStack(kit.typography.mono);
  vars['--bk-ease'] = kit.motionGuide.easing;
  vars['--bk-enter'] = `${kit.motionGuide.enter}s`;
  vars['--bk-exit'] = `${kit.motionGuide.exit}s`;
  vars['--bk-hold'] = `${kit.motionGuide.hold}s`;
  vars['--bk-stagger'] = `${kit.motionGuide.stagger}s`;
  vars['--bk-radius'] = `${Math.round(kit.layout.radius * shortSide)}px`;
  return vars;
}

/** The compact object the system prompt receives when a kit is active — never the raw kit. */
export function brandKitContext(kit: BrandKit) {
  kit = normalizeKitGradients(kit);
  const theme = brandKitTheme(kit);
  return {
    id: kit.id,
    name: kit.name,
    style: kit.style,
    tagline: kit.tagline || undefined,
    summary: brandKitSummary(kit),
    colors: { background: theme.bg, surface: theme.card, text: theme.fg, muted: theme.muted, primary: kitColor(kit, 'primary') ?? theme.accent, accent: theme.accent, accent2: theme.accent2, gradients: kit.colors.gradients.map((g) => `${g.name}: ${g.angle}deg ${g.stops.join('→')}`), rules: kit.colors.rules },
    typography: { display: `${kit.typography.display.family} ${kit.typography.display.weight}${kit.typography.display.transform !== 'none' ? ` ${kit.typography.display.transform}` : ''}`, heading: `${kit.typography.heading.family} ${kit.typography.heading.weight}`, body: `${kit.typography.body.family} ${kit.typography.body.weight}`, caption: `${kit.typography.caption.family} ${kit.typography.caption.weight}`, rules: kit.typography.rules },
    voice: { tone: kit.voiceGuide.tone, use: kit.voiceGuide.use, avoid: kit.voiceGuide.avoid, samples: kit.voiceGuide.samples.slice(0, 3), captionRules: kit.voiceGuide.captionRules },
    motion: { easing: kit.motionGuide.easing, enter: kit.motionGuide.enter, exit: kit.motionGuide.exit, hold: kit.motionGuide.hold, stagger: kit.motionGuide.stagger, intensity: kit.motionGuide.intensity, transitions: kit.motionGuide.transitions, preferredBits: kit.motionGuide.preferredBits, preferredTemplates: kit.motionGuide.preferredTemplates, animateCss: kit.motionGuide.animateCss },
    imagery: { style: kit.imagery.style, iconography: kit.imagery.iconography, grade: kit.imagery.grade, promptPrefix: kit.imagery.promptPrefix, promptSuffix: kit.imagery.promptSuffix, negativePrompt: kit.imagery.negativePrompt, avoid: kit.imagery.avoid },
    layout: { safeMargin: kit.layout.safeMargin, logoBug: kit.layout.logoBug, lowerThird: kit.layout.lowerThird, captions: kit.layout.captions, rules: kit.layout.rules },
    audio: { music: kit.audio.music, tempo: kit.audio.tempo, sfx: kit.audio.sfx, voice: kit.audio.voice },
    social: { intro: kit.social.intro, outro: kit.social.outro, endCard: kit.social.endCard },
    logos: kit.logos.map((l) => ({ id: l.id, role: l.role, placement: l.placement, vector: !!l.svg, assetId: l.assetId ?? undefined, clearSpace: l.clearSpace, minSize: l.minSize })),
    guideline: (() => {
      const g = guidelineOf(kit);
      return {
        source: g.source,
        summary: g.summary,
        stage: g.color.stage,
        ratio: g.color.ratio,
        typeScale: g.typeScale.map((t) => `${t.role} ${t.family} ${t.weight} ${t.size}px ≤${t.maxWordsPerLine}w/line`),
        timing: g.motion.timing,
        moves: g.moves.map((m) => `${m.id} (${m.frames}f)`),
        recipes: g.recipes.map((r) => `${r.id} → ${r.template ?? 'custom'} [${r.moves.join(' → ')}]`),
      };
    })(),
    // What the kit learned from the user's references (/train), most confident first, budgeted.
    ...(learningsBrief(kit).length ? { learned: learningsBrief(kit), learnedNote: 'Learned from the user\'s own references (/train): follow these like the rest of the kit; where one conflicts with a generic default, the learned rule wins.' } : {}),
    howToUse: 'Binding for every graphic, text and generation. Motion scenes (create_motion_scene) are built in the brand automatically; the brand-* templates render the guideline moves and layouts exactly. get_brand_guideline for the frame-by-frame moves, layouts and recipes; update_brand_kit {"section":"guideline"} to tailor it to this video; check_brand_compliance before verifying; get_brand_kit {"section":"…"} for any other section. theme "brand" on create_motion_graphic and add_text use it automatically; brand_kit_prompt for generation prefixes; render_brand_board to show it.',
  };
}

/**
 * The kit for a Quick edit: what a change to one layer needs (colours, type, logos, layout, what it
 * learned), not the voice, motion, imagery and guideline a production plans with.
 */
export function brandKitQuickContext(kit: BrandKit) {
  const { id, name, style, summary, colors, typography, logos, layout, learned, learnedNote } = brandKitContext(kit) as ReturnType<typeof brandKitContext> & { learned?: unknown; learnedNote?: string };
  return { id, name, style, summary, colors, typography, logos, layout, ...(learned ? { learned, learnedNote } : {}), more: 'Binding for every graphic and text. get_brand_kit {"section":"…"} for the voice, motion, imagery, audio or guideline when the change needs them.' };
}

export function brandKitSummary(kit: BrandKit): string {
  const theme = brandKitTheme(kit);
  return [
    `${kit.name}${kit.tagline ? ` — “${kit.tagline}”` : ''} (${kit.style}). ${kit.description}`,
    `Colours: background ${theme.bg}, surface ${theme.card}, text ${theme.fg}, primary ${kitColor(kit, 'primary') ?? theme.accent}, accent ${theme.accent}.`,
    `Type: ${kit.typography.display.family} ${kit.typography.display.weight} display, ${kit.typography.body.family} body.`,
    `Motion: ${kit.motionGuide.intensity}, enter ${kit.motionGuide.enter}s, exit ${kit.motionGuide.exit}s, hold ${kit.motionGuide.hold}s; ${kit.motionGuide.transitions.slice(0, 3).join(' / ')}.`,
    `Voice: ${kit.voiceGuide.tone.join(', ')}. Imagery: ${kit.imagery.style}`,
    brandSummary(kit),
  ].join(' ');
}

// ── logos and the brand board ────────────────────────────────────────────────

/** Inline markup for a logo at `height` design px: inline SVG, an embedded data URL, or a monogram. */
export function logoMarkup(kit: BrandKit, role: LogoRole | 'any' = 'any', height = 120): string {
  const logo = kit.logos.find((l) => role === 'any' ? true : l.role === role) ?? kit.logos[0];
  if (logo?.svg) return `<div class="bk-logo" style="height:${px(height)};display:inline-flex;align-items:center">${logo.svg.replace(/<svg\b/, `<svg style="height:${px(height)};width:auto"`)}</div>`;
  if (isDataUrl(logo?.dataUrl)) return `<div class="bk-logo" style="height:${px(height)};display:inline-flex;align-items:center;background-image:url(${logo!.dataUrl});background-size:contain;background-repeat:no-repeat;background-position:left center;width:${px(height * 3)}"></div>`;
  const initials = kit.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'B';
  return `<div class="bk-logo bk-monogram" style="height:${px(height)};width:${px(height)};border-radius:${px(height * 0.24)};display:inline-flex;align-items:center;justify-content:center;background:var(--bk-primary,var(--accent));color:#fff;font-family:var(--bk-display);font-weight:800;font-size:${px(height * 0.46)};letter-spacing:-.04em">${esc(initials)}</div>`;
}

/** The brand board: logo, name, palette, type, gradient, a lower-third mock and a motion sample, on one frame. */
export function brandBoard(kit: BrandKit, canvas: { width: number; height: number } = { width: 1920, height: 1080 }): { html: string; css: string; box: { x: number; y: number; width: number; height: number }; seconds: number } {
  const theme = brandKitTheme(kit);
  const u = canvas.width / 1920;
  const portrait = canvas.height > canvas.width;
  const vars = Object.entries({ ...brandKitVars(kit, Math.min(canvas.width, canvas.height) / u), '--u': u.toFixed(4), '--bg': theme.bg, '--fg': theme.fg, '--muted': theme.muted, '--accent': theme.accent, '--accent2': theme.accent2, '--card': theme.card, '--line': theme.line }).map(([k, v]) => `${k}:${v}`).join(';');
  const swatches = kit.colors.tokens.slice(0, 8).map((t, i) => `<div class="a rise bk-sw" style="--d:${(0.5 + i * 0.07).toFixed(2)}s"><i style="background:${t.hex};${isDark(t.hex) === isDark(theme.bg) ? `box-shadow:inset 0 0 0 1px ${theme.line}` : ''}"></i><b>${esc(t.name)}</b><span class="mono">${esc(t.hex.toUpperCase())}</span></div>`).join('');
  const gradient = normalizeGradients(kit.colors.gradients)[0];
  const sample = kit.voiceGuide.samples[0] ?? kit.tagline ?? kit.name;
  const disp = kit.typography.display;
  // Escaped: the font stacks carry double quotes ("Palatino Linotype", …), which would otherwise end
  // the attribute early and drop every variable after them (--u, --bg, --fg, …).
  const html = `<div class="rbx bk-board" style="${esc(vars)}">
    <div class="fill" style="background:var(--bg)"></div>
    <div class="bk-grid" style="${portrait ? 'grid-template-columns:1fr;grid-template-rows:auto auto auto auto 1fr' : ''}">
      <div class="bk-cell bk-id"><div class="a rise" style="--d:.1s">${logoMarkup(kit, 'any', portrait ? 120 : 150)}</div><div class="a rise bk-name" style="--d:.3s;font-family:var(--bk-display);font-weight:${disp.weight};letter-spacing:${disp.letterSpacing};text-transform:${disp.transform}">${esc(kit.name)}</div>${kit.tagline ? `<div class="a rise small" style="--d:.45s;font-family:var(--bk-body)">${esc(kit.tagline)}</div>` : ''}<div class="a fade kicker" style="--d:.6s">${esc(kit.style)} · ${esc(kit.industry || 'brand kit')}</div></div>
      <div class="bk-cell"><div class="kicker a fade" style="--d:.4s">Colour</div><div class="bk-swatches">${swatches}</div>${gradient ? `<div class="a grow-x bk-gradient" style="--d:1.1s;background:linear-gradient(${gradient.angle}deg,${gradient.stops.join(',')})"></div>` : ''}</div>
      <div class="bk-cell"><div class="kicker a fade" style="--d:.7s">Type</div><div class="a rise bk-aa" style="--d:.8s;font-family:var(--bk-display);font-weight:${disp.weight};letter-spacing:${disp.letterSpacing};text-transform:${disp.transform}">Aa</div><div class="a rise" style="--d:.95s"><div class="bk-type-row" style="font-family:var(--bk-display);font-weight:${disp.weight}">${esc(disp.family)} ${disp.weight} <span class="small">display</span></div><div class="bk-type-row" style="font-family:var(--bk-heading);font-weight:${kit.typography.heading.weight}">${esc(kit.typography.heading.family)} ${kit.typography.heading.weight} <span class="small">heading</span></div><div class="bk-type-row body" style="font-family:var(--bk-body)">${esc(kit.typography.body.family)} ${kit.typography.body.weight} <span class="small">body</span></div></div></div>
      <div class="bk-cell"><div class="kicker a fade" style="--d:1.0s">Voice · Motion</div><div class="a rise bk-quote" style="--d:1.1s;font-family:var(--bk-heading)">“${esc(sample)}”</div><div class="a rise small" style="--d:1.25s">${esc(kit.voiceGuide.tone.join(' · '))}</div><div class="bk-motion a rise" style="--d:1.4s"><span class="pill" style="font-size:${px(22)}">${esc(kit.motionGuide.intensity)}</span><span class="small mono">enter ${kit.motionGuide.enter}s · exit ${kit.motionGuide.exit}s · hold ${kit.motionGuide.hold}s</span></div><div class="bk-sample a bk-move" style="--d:1.6s;animation-duration:${kit.motionGuide.enter}s;animation-timing-function:${kit.motionGuide.easing}"></div></div>
      <div class="bk-cell bk-lt"><div class="kicker a fade" style="--d:1.3s">Lower third · ${esc(kit.layout.lowerThird)}</div><div class="bk-lower a slide-l" style="--d:1.45s;animation-timing-function:${kit.motionGuide.easing}"><i style="background:var(--accent)"></i><div><div style="font-family:var(--bk-heading);font-weight:${kit.typography.heading.weight};font-size:${px(44)}">${esc(kit.name)}</div><div class="small" style="font-family:var(--bk-body)">${esc(kit.tagline || kit.industry || 'Brand kit')}</div></div></div><div class="a fade small" style="--d:1.8s;font-family:var(--bk-body)">${esc(kit.imagery.style)}</div></div>
    </div>
  </div>`;
  const css = `${RBX_BASE_CSS}
.rbx.bk-board{font-family:var(--bk-body)}
.rbx .bk-grid{position:absolute;inset:${px(70)} ${px(90)};display:grid;grid-template-columns:1.2fr 1fr 1fr;grid-template-rows:auto 1fr;gap:${px(40)}}
.rbx .bk-cell{position:relative;min-width:0}
.rbx .bk-id{grid-row:1 / span 2}
.rbx .bk-name{font-size:${px(96)};line-height:1;margin-top:${px(30)};color:var(--fg)}
.rbx .bk-swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:${px(14)};margin-top:${px(14)}}
.rbx .bk-sw i{display:block;height:${px(64)};border-radius:${px(12)}}
.rbx .bk-sw b{display:block;margin-top:${px(8)};font-size:${px(20)};font-weight:600;color:var(--fg)}
.rbx .bk-sw span{display:block;font-size:${px(17)};color:var(--muted)}
.rbx .bk-gradient{height:${px(26)};border-radius:${px(13)};margin-top:${px(20)}}
.rbx .bk-aa{font-size:${px(150)};line-height:1;color:var(--fg)}
.rbx .bk-type-row{font-size:${px(30)};margin-top:${px(8)};color:var(--fg)}
.rbx .bk-type-row .small{font-size:${px(20)};margin-left:${px(10)}}
.rbx .bk-quote{font-size:${px(34)};line-height:1.25;color:var(--fg);margin-top:${px(10)}}
.rbx .bk-motion{display:flex;align-items:center;gap:${px(14)};margin-top:${px(16)}}
.rbx .bk-sample{width:${px(120)};height:${px(120)};margin-top:${px(20)};border-radius:var(--bk-radius);background:var(--accent);box-shadow:var(--b-shadow)}
.rbx .bk-move{animation-name:rbx-rise}
.rbx .bk-lt{grid-column:2 / span 2}
.rbx .bk-lower{display:flex;align-items:stretch;gap:${px(18)};margin-top:${px(12)};padding:${px(18)} ${px(24)};border-radius:var(--bk-radius);background:var(--card);box-shadow:var(--b-shadow);max-width:${px(720)}}
.rbx .bk-lower i{width:${px(6)};border-radius:3px}
.rbx .bk-board .kicker{color:var(--muted)}
.rbx .bk-board .small{color:var(--muted)}`;
  return { html, css, box: { x: 0, y: 0, width: 1, height: 1 }, seconds: 6 };
}

// ── documents, activation, retinting ─────────────────────────────────────────

export const emptyBrandKitDoc = (): BrandKitDoc => ({ kits: [], activeId: null });

export function exportBrandKit(kit: BrandKit): string {
  const { logos, ...rest } = kit;
  return JSON.stringify({ ...rest, logos: logos.map(({ dataUrl, ...logo }) => ({ ...logo, dataUrl: dataUrl && dataUrl.length < 400_000 ? dataUrl : null })) }, null, 2);
}

export function importBrandKit(text: string): BrandKit | { error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) return { error: 'not a brand kit object' };
    const base = newBrandKit({ style: typeof value.style === 'string' ? value.style : undefined, name: typeof value.name === 'string' ? value.name : undefined });
    const merged = normalizeKitGradients({ ...deepMerge(base, value), id: typeof value.id === 'string' && value.id ? value.id : uid(), version: BRAND_KIT_VERSION, updatedAt: now() } as BrandKit);
    const errors = validateBrandKit(merged);
    return errors.length ? { error: errors.join('; ') } : merged;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The kit a project is edited to: its own pointer first, then the user's default, then the only kit there is. */
export function resolveActiveKit(doc: BrandKitDoc | null | undefined, project?: Pick<Project, 'activeBrandKitId'> | null): BrandKit | null {
  if (!doc?.kits?.length) return null;
  const id = project?.activeBrandKitId ?? doc.activeId;
  const found = doc.kits.find((k) => k.id === id) ?? (project?.activeBrandKitId ? doc.kits.find((k) => k.id === doc.activeId) : undefined);
  if (found) return normalizeKitGradients(found);
  return doc.kits.length === 1 ? normalizeKitGradients(doc.kits[0]) : null;
}

/** How well a kit matches free text (a brand name, a product, an industry, a style word). */
export function scoreBrandKit(kit: BrandKit, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const name = kit.name.toLowerCase();
  let score = 0;
  if (name === q) score += 100;
  else if (name.includes(q) || q.includes(name)) score += 60;
  const haystack = [kit.tagline, kit.style, kit.industry, kit.audience, kit.description, ...kit.values, ...kit.voiceGuide.tone, ...kit.imagery.keywords].join(' ').toLowerCase();
  for (const term of q.split(/[\s,./]+/).filter((t) => t.length > 2)) {
    if (name.includes(term)) score += 20;
    if (haystack.includes(term)) score += 6;
  }
  return score;
}

/**
 * Picks a kit without being told which: the only kit, else the best text match when the match is
 * unambiguous, else the user default, else the most recently edited kit.
 */
export function pickBrandKit(doc: BrandKitDoc | null | undefined, query?: string | null): { kit: BrandKit; reason: string } | null {
  if (!doc?.kits?.length) return null;
  if (doc.kits.length === 1) return { kit: doc.kits[0], reason: 'the only kit' };
  if (query?.trim()) {
    const ranked = doc.kits.map((kit) => ({ kit, score: scoreBrandKit(kit, query) })).sort((a, b) => b.score - a.score);
    if (ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score ?? 0)) return { kit: ranked[0].kit, reason: `the best match for "${query.trim()}"` };
  }
  const fallback = doc.kits.find((k) => k.id === doc.activeId);
  if (fallback) return { kit: fallback, reason: 'the user default' };
  const newest = [...doc.kits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return { kit: newest, reason: 'the most recently edited kit' };
}

export function findKit(doc: BrandKitDoc | null | undefined, query: string | null | undefined): BrandKit | undefined {
  if (!doc || !query) return undefined;
  const key = query.trim().toLowerCase();
  return doc.kits.find((k) => k.id === query) ?? doc.kits.find((k) => k.name.toLowerCase() === key) ?? doc.kits.find((k) => k.name.toLowerCase().includes(key));
}

/** Re-tints an existing Crimson (`.mgc`) or React Bits (`.rbx`) graphic's root variables to a kit. */
export function retintGraphicHtml(html: string, kit: BrandKit): string {
  const theme = brandKitTheme(kit);
  const rbxVars: Record<string, string> = { '--bg': theme.bg, '--fg': theme.fg, '--muted': theme.muted, '--accent': theme.accent, '--accent2': theme.accent2, '--card': theme.card, '--line': theme.line };
  let out = html.replace(/(<div class="rbx[^"]*" style=")([^"]*)(")/, (_m, open: string, style: string, close: string) => {
    let next = style;
    for (const [name, value] of Object.entries(rbxVars)) next = next.includes(`${name}:`) ? next.replace(new RegExp(`${name}:[^;"]*`), `${name}:${value}`) : `${next};${name}:${value}`;
    return `${open}${next}${close}`;
  });
  const crimson = brandKitCrimson(kit);
  // A light kit's dark text needs a backing where a template sits straight on the footage (.onfoot).
  const light = !isDark(theme.bg);
  out = out.replace(/(<div class="mgc)(" style=")([^"]*)(")/, (_m, cls: string, open: string, style: string, close: string) => {
    const base = style.replace(/--mg-accent:[^;"]*/, `--mg-accent:${crimson.accent}`);
    const extra = Object.entries(crimson.tokens).filter(([k]) => k !== '--accent').map(([k, v]) => `${k}:${v}`).join(';');
    return `${cls}${light ? ' light' : ''}${open}${base};${extra};font-family:${crimson.fontStack.replace(/"/g, "'")}${close}`;
  });
  return out;
}

export { ARCHETYPES, HOUSE_ARCHETYPE, findArchetype, BRAND_KIT_SECTIONS };
