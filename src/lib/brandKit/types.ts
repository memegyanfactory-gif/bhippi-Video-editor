// Brand kits — the identity a video is edited to, as data.
//
// A brand kit is what a design studio hands over with a logo: the marks and how to place them, the
// colour tokens and gradients, the type pairing and scale, the voice, the way things move, the look
// of the imagery, where things sit in the frame, what it sounds like, and how it behaves on each
// platform. Bhippi keeps kits at user level (Settings), points a project at one, and reads it
// everywhere a look is decided: Crimson templates, React Bits themes, text clips, caption styles,
// generation prompts, voice-over voice and the system prompt the copilot works from.
//
// It extends the older `Brand` (src/lib/brand.ts) so `brandVars()` / `brandSummary()` keep working.

import type { Brand, TypeScale } from '../brand';

export type BrandKitVersion = 1;

export type LogoRole = 'primary' | 'mark' | 'wordmark' | 'monochrome' | 'inverse' | 'icon';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export type BrandLogo = {
  id: string;
  role: LogoRole;
  /** An imported library asset (preferred: it gets a thumbnail and relink support). */
  assetId?: string | null;
  /** Absolute path of the file, kept beside the asset id. */
  path?: string | null;
  /** Inline SVG markup for vector marks — survives export without any data URL. */
  svg?: string | null;
  /** data:image/… cache for raster logos so exported graphics can embed them. Never sent to the model. */
  dataUrl?: string | null;
  /** Clear space around the mark, in multiples of the mark height. */
  clearSpace: number;
  /** Minimum rendered height in design pixels at 1080p. */
  minSize: number;
  /** Where the bug sits by default. */
  placement: Corner;
  /** Background the logo may sit on: light, dark or both. */
  on: 'light' | 'dark' | 'any';
  doNots: string[];
};

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'muted' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'custom';

export type BrandColorToken = { name: string; hex: string; role: ColorRole; usage: string };
export type BrandGradient = { name: string; angle: number; stops: string[]; usage: string };

export type BrandColors = {
  tokens: BrandColorToken[];
  gradients: BrandGradient[];
  /** Named pairs that meet contrast: "text on background", "primary on surface". */
  pairs: { fg: string; bg: string; ratio: number; use: string }[];
  /** Colour rules in words: proportions, what the accent is for, what never mixes. */
  rules: string[];
  /** Colour rules that mirror a DaisyUI theme, when the kit was made from one. */
  daisyTheme?: string | null;
  /** Open Props hue the scale was taken from (red, pink, purple, …), when one was. */
  openPropsHue?: string | null;
};

export type BrandTypeface = {
  /** A family that exists on the machine (preview and export both resolve by name only). */
  family: string;
  fallback: string;
  weight: number;
  letterSpacing: string;
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  italic: boolean;
};

export type BrandTypography = {
  display: BrandTypeface;
  heading: BrandTypeface;
  body: BrandTypeface;
  caption: BrandTypeface;
  mono: BrandTypeface;
  /** Per cent of frame height, as caption styles measure type (from `Brand.type`). */
  scale: TypeScale;
  lineHeight: number;
  /** Casing, pairing and hierarchy rules in words. */
  rules: string[];
};

export type BrandVoice = {
  tone: string[];
  personality: string[];
  /** Words and phrases the brand uses. */
  use: string[];
  /** Words and phrases it avoids. */
  avoid: string[];
  /** Example lines in the brand's voice. */
  samples: string[];
  language: string;
  /** How captions read: length, casing, punctuation, emoji. */
  captionRules: string[];
};

export type MotionIntensity = 'calm' | 'balanced' | 'energetic';

export type BrandMotion = {
  /** The signature ease as a cubic-bezier (or a named ease from src/lib/motion.ts). */
  easing: string;
  /** Seconds. */
  enter: number;
  exit: number;
  hold: number;
  stagger: number;
  intensity: MotionIntensity;
  /** Preferred transition kinds, in order: cut, push, zoom-punch, occluder, dissolve, wipe… */
  transitions: string[];
  principles: string[];
  /** React Bits pieces this brand reaches for first (ids). */
  preferredBits: string[];
  /** Crimson templates this brand reaches for first. */
  preferredTemplates: string[];
  /** Animate.css names for the three classic moments, when the brand uses that vocabulary. */
  animateCss: { entrance: string; exit: string; attention: string } | null;
  /** Open Props easing token (ease-3, ease-elastic-3, ease-spring-3 …) when one applies. */
  openPropsEase?: string | null;
};

export type BrandImagery = {
  style: string;
  photography: string[];
  illustration: string;
  iconography: 'line' | 'filled' | 'duotone' | '3d' | 'flat' | 'hand-drawn' | 'custom';
  /** Grade the AI applies to generated or found media: −1…1 each. */
  grade: { saturation: number; contrast: number; warmth: number; note: string };
  /** Prefixed to every image/video generation prompt. */
  promptPrefix: string;
  /** Appended to every image/video generation prompt. */
  promptSuffix: string;
  /** Added to every negative prompt. */
  negativePrompt: string;
  keywords: string[];
  avoid: string[];
};

export type BrandLayout = {
  /** Fraction of the frame kept clear on every side. */
  safeMargin: number;
  /** Columns the layout snaps to. */
  grid: number;
  logoBug: Corner;
  lowerThird: 'bottom-left' | 'bottom-right' | 'bottom-center';
  captions: 'bottom-center' | 'top-center' | 'center' | 'lower-third-side';
  /** Corner radius as a fraction of the short side (mirrors `Brand.radius`). */
  radius: number;
  /** Aspect ratios the brand publishes in. */
  aspects: string[];
  rules: string[];
};

export type BrandAudio = {
  music: string;
  /** BPM range. */
  tempo: [number, number];
  sfx: string[];
  /** TTS voice id to prefer for voice-overs, when set. */
  voice: string | null;
  voiceMode: string | null;
  /** Music-under-speech level in dB and other sound rules. */
  rules: string[];
};

export type BrandSocial = {
  platforms: string[];
  /** How the first two seconds behave. */
  intro: string;
  /** How the last three seconds behave. */
  outro: string;
  /** End card contents in order. */
  endCard: string[];
  hashtags: string[];
  /** Lower-third, sticker, subscribe-bug rules per platform. */
  rules: string[];
};

export type BrandAssetKind = 'logo' | 'font' | 'image' | 'pattern' | 'texture' | 'music' | 'sfx' | 'video' | 'template' | 'other';

export type BrandAsset = {
  id: string;
  kind: BrandAssetKind;
  name: string;
  assetId?: string | null;
  path?: string | null;
  tags: string[];
  notes: string;
};

// ── the brand guideline: how the kit looks and moves, frame by frame ─────────────────────────
//
// Every kit carries a guideline the AI builds videos from. It is derived from the kit's tokens
// (src/lib/brandKit/guideline.ts) the moment a kit exists, and the AI or the user may refine any
// part of it (`update_brand_kit {"section":"guideline"}`). Brand motion templates in the motion
// engine (`brand-*`) are built directly from `moves` and `layouts`, so what the guideline says is
// what renders.

/** One element's state at one frame. Offsets are design px at 1080p; scale is a factor (1 = rest). */
export type FrameState = {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  /** Reveal from the element's leading edge, 0 (hidden) … 1 (whole). */
  clip?: number;
  /** Letter spacing delta in 1/100 em. */
  tracking?: number;
};

/** A keyframe of a move. `ease` shapes the segment that starts here (a cubic-bezier or a named ease). */
export type MoveKey = { frame: number; state: FrameState; ease?: string; note?: string };

export type MoveRole = 'headline' | 'subhead' | 'body' | 'kicker' | 'panel' | 'accent-bar' | 'logo' | 'background' | 'number' | 'label' | 'cta' | 'caption' | 'outgoing' | 'incoming' | 'shape';

export type MoveElement = { name: string; role: MoveRole; keys: MoveKey[]; note?: string };

/** A signature animation: every element it moves, keyed frame by frame at `fps`. */
export type BrandMove = {
  id: string;
  name: string;
  /** When to use it. */
  use: string;
  /** How it reads, in words (what happens on which frame). */
  description: string;
  fps: number;
  /** Length in frames. */
  frames: number;
  elements: MoveElement[];
};

export type LayoutZone = {
  /** headline, subhead, logo, captions, panel, number, cta, presenter, media, lower-third … */
  role: string;
  name: string;
  /** Fractions of the frame: left, top, width, height. */
  x: number;
  y: number;
  w: number;
  h: number;
  align: 'left' | 'center' | 'right';
  /** Which step of the type scale sets text here. */
  type?: 'display' | 'heading' | 'subhead' | 'body' | 'caption' | 'label';
  notes?: string;
};

export type BrandLayoutSpec = { id: string; name: string; aspect: '16:9' | '9:16' | '1:1' | '4:5'; use: string; zones: LayoutZone[] };

export type TypeStep = {
  role: 'display' | 'heading' | 'subhead' | 'body' | 'caption' | 'label';
  family: string;
  weight: number;
  /** Design px at 1080p (short side). */
  size: number;
  lineHeight: number;
  /** 1/100 em. */
  tracking: number;
  transform: BrandTypeface['transform'];
  color: string;
  maxWordsPerLine: number;
};

/** A kind of beat and exactly how the brand builds it. */
export type SceneRecipe = {
  id: string;
  name: string;
  use: string;
  /** A `layouts` id per aspect ratio. */
  layout: string;
  background: { kind: 'solid' | 'gradient' | 'procedural' | 'footage'; colors: string[]; procedural?: string; note: string };
  /** `moves` ids, in the order they play. */
  moves: string[];
  /** The motion-engine template that realises it (`brand-*`). */
  template?: string;
  copy: string;
  /** Seconds on screen after the last element lands. */
  hold: number;
};

export type BrandGuideline = {
  version: 1;
  /** derived = computed from the kit's tokens; ai / edited = refined since. */
  source: 'derived' | 'ai' | 'edited';
  updatedAt: string;
  summary: string;
  color: {
    /** The proportion rule, e.g. "60 background / 30 surface / 10 accent". */
    ratio: string;
    stage: { tone: 'dark' | 'light'; background: string; gradient: string[]; note: string };
    roles: { role: string; hex: string; use: string }[];
    rules: string[];
  };
  typeScale: TypeStep[];
  motion: {
    principles: string[];
    fps: number;
    easing: { enter: string; exit: string; move: string };
    /** Seconds. */
    timing: { enter: number; exit: number; hold: number; stagger: number; wordStagger: number };
    /** px at 1080p an element travels when it enters. */
    distance: number;
    blur: number;
    overshoot: number;
  };
  moves: BrandMove[];
  layouts: BrandLayoutSpec[];
  recipes: SceneRecipe[];
  dos: string[];
  donts: string[];
};

/** A complete brand kit. `Brand`'s fields stay the quick summary the older code reads. */
export type BrandKit = Brand & {
  id: string;
  version: BrandKitVersion;
  /** The archetype it started from (minimal-mono, bold-startup, …) or "custom". */
  style: string;
  tagline: string;
  description: string;
  industry: string;
  audience: string;
  values: string[];
  createdAt: string;
  updatedAt: string;
  logos: BrandLogo[];
  colors: BrandColors;
  typography: BrandTypography;
  voiceGuide: BrandVoice;
  motionGuide: BrandMotion;
  imagery: BrandImagery;
  layout: BrandLayout;
  audio: BrandAudio;
  social: BrandSocial;
  assets: BrandAsset[];
  notes: string;
  /** The detailed guideline; derived from the tokens when absent (`guidelineOf`). */
  guideline?: BrandGuideline | null;
};

/** What Settings persists. */
export type BrandKitDoc = { kits: BrandKit[]; activeId: string | null };

/** A style archetype the presets and the AI generator start from (see docs/research/brand-kit-archetypes.json). */
export type BrandArchetype = {
  id: string;
  name: string;
  /** The house look, a style archetype, or a named reference kit rebuilt from a public brand shot. */
  group: 'house' | 'archetype' | 'reference';
  character: string;
  industries: string[];
  colors: { bg: string; surface: string; text: string; muted: string; primary: string; accent: string; accent2: string };
  gradient: { angle: number; stops: string[] };
  typography: {
    display: { family: string; weight: number; letterSpacing: string; transform: BrandTypeface['transform'] };
    heading: { family: string; weight: number };
    body: { family: string; weight: number };
    caption: { family: string; weight: number };
  };
  motion: { easing: string; enter: number; exit: number; hold: number; stagger: number; intensity: MotionIntensity; transitions: string[] };
  imagery: { style: string; grade: { saturation: number; contrast: number; warmth: number }; iconography: string; promptPrefix: string; negativePrompt: string };
  voice: { tone: string[]; use: string[]; avoid: string[]; samples: string[] };
  layout: { safeMargin: number; logoBug: Corner; lowerThird: BrandLayout['lowerThird']; captions: BrandLayout['captions'] };
  audio: { music: string; tempo: [number, number]; sfx: string[] };
};

/** The sections a patch may touch, for `update_brand_kit` and the Settings editor. */
export const BRAND_KIT_SECTIONS = ['identity', 'logos', 'colors', 'typography', 'voice', 'motion', 'imagery', 'layout', 'audio', 'social', 'assets', 'notes', 'guideline'] as const;
export type BrandKitSection = (typeof BRAND_KIT_SECTIONS)[number];
