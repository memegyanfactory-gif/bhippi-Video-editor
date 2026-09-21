// The brand guideline a project is edited to.
//
// Before any graphic is made, a project decides what it looks like: an accent taken from the
// footage itself, a type pairing, a corner radius, a shadow, and the motion it moves with. Every
// title, card, pill and caption then reads from that one place, which is why the reference film
// looks like one film rather than a pile of effects.
//
// It is derived, not invented: the colours come from the footage's own palette (see the
// `asset_palette` command), the tone comes from what is being said, and the frame decides the
// type sizes. It is then written into the project so it survives, and can be edited by hand.
import { CURVES, TIMING, type CurveName } from './motion';
import type { Comp } from './types';

export type Palette = {
  /** The one colour used for emphasis: pills, numbers, the accent in a gradient. */
  accent: string;
  /** Deepest background. Nearly black in the reference film. */
  ink: string;
  /** The mid tone a card is filled with. */
  surface: string;
  /** Type on `ink` and `surface`. */
  text: string;
  /** Type that is present but quiet. */
  muted: string;
  /** The second accent, used sparingly — a highlighted word, a live state. */
  accentAlt: string;
};

export type TypeScale = {
  /** Per cent of frame height, as caption styles already measure type. */
  hook: number;
  title: number;
  subtitle: number;
  body: number;
  label: number;
  caption: number;
};

export type Brand = {
  /** What this look is called, so it can be reused across projects. */
  name: string;
  /** One line on the feel, which is also what the assistant is told. */
  voice: string;
  palette: Palette;
  fonts: { display: string; body: string; mono: string };
  type: TypeScale;
  /** Corner radius as a fraction of the short side, so it scales with the frame. */
  radius: number;
  /** Shadow depth, 0–1. */
  shadow: number;
  motion: { entrance: CurveName; exit: CurveName; emphasis: CurveName; beat: number };
  /** The caption style id this brand uses, from the WatchFIWN set. */
  captionStyle: string | null;
  /** Where it came from, so it can be explained and regenerated. */
  derivedFrom: string;
};

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const parse = (value: string) => {
  const clean = value.replace('#', '');
  return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
};

const luma = (value: string) => {
  const { r, g, b } = parse(value);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const saturation = (value: string) => {
  const { r, g, b } = parse(value);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};

const mix = (a: string, b: string, amount: number) => {
  const one = parse(a);
  const two = parse(b);
  return hex(one.r + (two.r - one.r) * amount, one.g + (two.g - one.g) * amount, one.b + (two.b - one.b) * amount);
};

/** Pushes a colour until it is vivid enough to carry emphasis on a dark field. */
function vivid(value: string): string {
  const { r, g, b } = parse(value);
  const max = Math.max(r, g, b, 1);
  const boost = Math.min(2.4, 210 / max);
  const lifted = hex(r * boost, g * boost, b * boost);
  // Still grey? Nothing in the footage was colourful, so fall back to the house crimson.
  return saturation(lifted) < 0.25 ? '#E11D2E' : lifted;
}

export const DEFAULT_BRAND: Brand = {
  name: 'Helios House',
  voice: 'Deep, near-black field with one hot accent and white type. Cards with soft shadows, words that land one at a time.',
  palette: {
    accent: '#E11D2E',
    ink: '#120406',
    surface: '#2A0B10',
    text: '#FFFFFF',
    muted: '#C9A9AE',
    accentAlt: '#FF7A59',
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  type: { hook: 11, title: 8, subtitle: 5, body: 3.6, label: 2.6, caption: 6 },
  radius: 0.022,
  shadow: 0.45,
  motion: { entrance: 'entrance', exit: 'exit', emphasis: 'overshoot', beat: TIMING.normal },
  captionStyle: null,
  derivedFrom: 'the default house look',
};

/**
 * Builds a brand from what the project actually contains.
 *
 * `palette` is the footage's own colours, brightest-first, as `asset_palette` returns them. Words
 * from the transcript decide the tone: a review or a tutorial is not a hype reel, and should not
 * be dressed as one.
 */
export function deriveBrand(options: {
  name?: string;
  comp?: Comp;
  /** Colours sampled from the footage, most common first. */
  palette?: string[];
  /** A few hundred words of what is being said, if there is a transcript. */
  transcript?: string;
  captionStyle?: string | null;
}): Brand {
  const { comp, palette = [], transcript = '' } = options;
  const words = transcript.toLowerCase();
  const hypey = /\b(insane|crazy|viral|hack|secret|blow|best|fastest|money|rich)\b/.test(words);
  const calm = /\b(tutorial|guide|step|lesson|explain|documentation|review|analysis)\b/.test(words);

  // The accent is the most colourful thing the camera saw, pushed until it carries on a dark field.
  const colourful = [...palette].sort((a, b) => saturation(b) * luma(b) - saturation(a) * luma(a))[0];
  const accent = colourful ? vivid(colourful) : DEFAULT_BRAND.palette.accent;
  const darkest = [...palette].sort((a, b) => luma(a) - luma(b))[0];
  const ink = darkest ? mix(darkest, '#000000', 0.55) : DEFAULT_BRAND.palette.ink;

  const scale: TypeScale = hypey
    ? { hook: 13, title: 9.5, subtitle: 5.5, body: 3.8, label: 2.8, caption: 7 }
    : calm
      ? { hook: 9, title: 6.5, subtitle: 4.4, body: 3.2, label: 2.4, caption: 5.2 }
      : DEFAULT_BRAND.type;

  // A tall frame is watched on a phone at arm's length: everything goes up a size.
  const vertical = comp ? comp.height > comp.width : false;
  const type = vertical
    ? (Object.fromEntries(Object.entries(scale).map(([key, value]) => [key, Math.round(value * 1.25 * 10) / 10])) as TypeScale)
    : scale;

  return {
    name: options.name ?? (hypey ? 'Punch' : calm ? 'Explainer' : 'House'),
    voice: hypey
      ? 'Loud and close: big type, hard accent, words that land on the beat.'
      : calm
        ? 'Quiet and clear: smaller type, generous margins, motion that never distracts from the point.'
        : DEFAULT_BRAND.voice,
    palette: {
      accent,
      ink,
      surface: mix(ink, accent, 0.18),
      text: '#FFFFFF',
      muted: mix('#FFFFFF', ink, 0.45),
      accentAlt: mix(accent, '#FFB020', 0.45),
    },
    fonts: DEFAULT_BRAND.fonts,
    type,
    radius: vertical ? 0.028 : 0.022,
    shadow: calm ? 0.3 : 0.5,
    motion: {
      entrance: 'entrance',
      exit: 'exit',
      emphasis: hypey ? 'overshoot' : 'standard',
      beat: hypey ? TIMING.quick : calm ? TIMING.slow : TIMING.normal,
    },
    captionStyle: options.captionStyle ?? null,
    derivedFrom: [
      palette.length ? `${palette.length} colours from the footage` : 'no footage palette',
      transcript ? `${transcript.split(/\s+/).filter(Boolean).length} words of transcript` : 'no transcript',
      comp ? `${comp.width}×${comp.height}` : 'no comp',
    ].join(', '),
  };
}

/** The CSS a graphic reads, so preview and export cannot drift apart. */
export function brandVars(brand: Brand, shortSide: number): Record<string, string> {
  return {
    '--b-accent': brand.palette.accent,
    '--b-accent-alt': brand.palette.accentAlt,
    '--b-ink': brand.palette.ink,
    '--b-surface': brand.palette.surface,
    '--b-text': brand.palette.text,
    '--b-muted': brand.palette.muted,
    '--b-radius': `${Math.round(brand.radius * shortSide)}px`,
    '--b-shadow': `0 ${Math.round(brand.shadow * 24)}px ${Math.round(brand.shadow * 60)}px rgba(0,0,0,${0.35 + brand.shadow * 0.3})`,
    '--b-display': brand.fonts.display,
    '--b-body': brand.fonts.body,
    '--b-entrance': `cubic-bezier(${CURVES[brand.motion.entrance].join(',')})`,
    '--b-exit': `cubic-bezier(${CURVES[brand.motion.exit].join(',')})`,
    '--b-emphasis': `cubic-bezier(${CURVES[brand.motion.emphasis].join(',')})`,
    '--b-beat': `${brand.motion.beat}s`,
  };
}

/** A short, readable summary — what the assistant is told, and what the panel shows. */
export function brandSummary(brand: Brand): string {
  return [
    `${brand.name}: ${brand.voice}`,
    `Accent ${brand.palette.accent} on ${brand.palette.ink}, cards ${brand.palette.surface}.`,
    `Type ${brand.type.title}% for titles, ${brand.type.caption}% for captions.`,
    `Moves on ${brand.motion.beat}s with ${brand.motion.emphasis} for emphasis.`,
    `Derived from ${brand.derivedFrom}.`,
  ].join(' ');
}
