// The Helios motion engine's scene model: an After Effects-style composition that the GPU
// executor (src/motion/gl) draws identically in the preview and in the export.
//
// Conventions (all of them AE's, so a motion designer or the AI can think in AE terms):
// · Units are pixels of the scene canvas (`width` × `height`), origin top-left, +y down, +z away
//   from the viewer. Rotations are degrees. Opacity is 0–100. Time is seconds from the start of
//   the motion clip.
// · `layers` are listed bottom to top: the first entry is drawn first.
// · A layer's `position` defaults to the canvas centre and its `anchor` to its own centre.
// · Any animatable value (`Prop`) is a literal, `{ k: keys }` or `{ expr: '…' }` — see anim.ts.
import type { MotionBrand } from '../lib/brandKit/motionBrand';

export type Vec = number[];

/** A named ease, or cubic-bezier control points `[x1, y1, x2, y2]` like CSS. */
export type EaseName =
  | 'linear' | 'hold'
  | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'sine-in' | 'sine-out' | 'sine-in-out'
  | 'cubic-in' | 'cubic-out' | 'cubic-in-out'
  | 'quart-in' | 'quart-out' | 'quart-in-out'
  | 'expo-in' | 'expo-out' | 'expo-in-out'
  | 'back-in' | 'back-out' | 'back-in-out'
  | 'elastic-out' | 'bounce-out' | 'spring';
export type Ease = EaseName | [number, number, number, number];

/** A keyframe. `ease` shapes the segment that *starts* at this key (Helios' existing convention). */
export type Key<T = number | Vec> = { t: number; v: T; ease?: Ease };

export type Animated<T = number | Vec> = { k: Key<T>[] };
/** `v` is the static base value, `k` optional keyframes the expression can read (`value`, `loopOut`). */
export type Expression<T = number | Vec> = { expr: string; v?: T; k?: Key<T>[] };
export type Prop<T = number | Vec> = T | Animated<T> | Expression<T>;

export type BlendMode =
  | 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'soft-light' | 'hard-light'
  | 'color-dodge' | 'color-burn' | 'lighten' | 'darken' | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'lighten', 'darken', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

export type MatteMode = 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';

export type Transform = {
  anchor?: Prop<Vec>;
  /** [x, y] or [x, y, z]. */
  position?: Prop<Vec>;
  /** Percent; a number scales uniformly, [sx, sy(, sz)] per axis. */
  scale?: Prop<number | Vec>;
  /** Z rotation (the only rotation of a 2D layer). */
  rotation?: Prop<number>;
  rotationX?: Prop<number>;
  rotationY?: Prop<number>;
  opacity?: Prop<number>;
  /** Degrees of skew along `skewAxis`. */
  skew?: Prop<number>;
  skewAxis?: Prop<number>;
};

/** An opacity mask in the layer's own pixels. Shapes combine top to bottom by `mode`. */
export type Mask = {
  shape: 'rect' | 'ellipse' | 'path';
  /** rect/ellipse box `[x, y, w, h]`; defaults to the whole layer. */
  box?: Prop<Vec>;
  /** rect corner radius. */
  radius?: Prop<number>;
  /** path points `[x0, y0, x1, y1, …]`, straight segments, closed. */
  points?: Prop<Vec>;
  mode?: 'add' | 'subtract' | 'intersect';
  feather?: Prop<number>;
  /** Grows (+) or shrinks (−) the shape, px. */
  expansion?: Prop<number>;
  opacity?: Prop<number>;
  inverted?: boolean;
};

/** One effect in a layer's stack. Every numeric param may be animated. */
export type Effect = { type: EffectType; enabled?: boolean } & Record<string, unknown>;

export type EffectType =
  | 'glow' | 'gaussian-blur' | 'directional-blur' | 'zoom-blur' | 'lens-blur'
  | 'chromatic-aberration' | 'vignette' | 'grain' | 'tint' | 'duotone' | 'black-white'
  | 'brightness-contrast' | 'hue-saturation' | 'levels' | 'exposure' | 'invert'
  | 'fill' | 'drop-shadow' | 'stroke' | 'halation' | 'mosaic' | 'pixel-sort'
  | 'displacement' | 'turbulent-displace' | 'wave-warp' | 'rgb-split' | 'lens-distortion'
  | 'light-leak' | 'liquid-glass' | 'radial-gradient-overlay' | 'matte-choke'
  | 'subject-reveal' | 'matte-fill' | 'matte-edge-glow';

/** Per-glyph animator, AE's Text Animator: properties applied by a range selector's amount. */
export type TextAnimator = {
  /** Which units the selector counts. */
  by?: 'char' | 'word' | 'line';
  /** Range selector: start/end/offset in percent of the units (0–100). */
  start?: Prop<number>;
  end?: Prop<number>;
  offset?: Prop<number>;
  /** How the amount falls across the range edge. */
  shape?: 'square' | 'ramp-up' | 'ramp-down' | 'triangle' | 'round' | 'smooth';
  /** Softness of the range edge in units (a sweeping reveal needs ~1–3). */
  smoothness?: number;
  /** Randomise which unit is which (seeded). */
  randomize?: boolean;
  seed?: number;
  /** Selected units get these deltas at amount 1. */
  props: {
    position?: Prop<Vec>;
    scale?: Prop<number>;
    rotation?: Prop<number>;
    opacity?: Prop<number>;
    blur?: Prop<number>;
    tracking?: Prop<number>;
    fillColor?: string;
    fillAmount?: Prop<number>;
    skew?: Prop<number>;
  };
};

/**
 * A timed entrance per unit: the friendlier way to say "each word blurs in as it is spoken".
 * `times` are seconds (one per unit) when each unit starts entering; they usually come from the
 * transcript. The entry animates FROM the given deltas TO rest over `duration`.
 */
export type TextCascade = {
  by: 'char' | 'word' | 'line';
  /** Explicit start per unit, or generated from `delay` + `stagger`. */
  times?: number[];
  delay?: number;
  stagger?: number;
  duration?: number;
  ease?: Ease;
  from: { position?: Vec; scale?: number; rotation?: number; opacity?: number; blur?: number; tracking?: number };
  /** A second stage: units start dim and brighten when "spoken" (karaoke emphasis). */
  dimTo?: number;
  brightenAfter?: number;
  /** Exit: all units leave at `at` over `duration` (staggered like the entrance). */
  exit?: { at: number; duration?: number; stagger?: number; ease?: Ease; to: { position?: Vec; scale?: number; opacity?: number; blur?: number } };
};

export type TextSpan = { text: string; font?: string; weight?: number; italic?: boolean; color?: string; size?: number; tracking?: number; strike?: { at: number; duration?: number; color?: string } };

export type TextLayerData = {
  /** Plain text, or rich `spans`. `\n` breaks lines. */
  text?: string;
  spans?: TextSpan[];
  font?: string;
  weight?: number;
  italic?: boolean;
  size?: Prop<number>;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Letter spacing in hundredths of an em (AE tracking ÷ 10: AE −30 is −3 here). */
  tracking?: number;
  lineHeight?: number;
  /** Wrap width in px; no wrapping when absent. */
  box?: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; x?: number; y?: number };
  animators?: TextAnimator[];
  cascade?: TextCascade;
  /** A rolling number: the text becomes `format` with `{n}` replaced by the animated value. */
  counter?: { value: Prop<number>; decimals?: number; format?: string; separator?: string };
  /** Typewriter: characters visible, 0..1 of the text. */
  reveal?: Prop<number>;
};

export type ShapeData = {
  shape: 'rect' | 'ellipse' | 'polygon' | 'star' | 'path' | 'line';
  size?: Prop<Vec>;
  radius?: Prop<number>;
  sides?: number;
  /** path/line points `[x0,y0,x1,y1,…]` in layer pixels. `curve` rounds corners into quadratics. */
  points?: Prop<Vec>;
  closed?: boolean;
  curve?: boolean;
  fill?: string | null;
  /** A gradient fill instead of `fill`. */
  gradient?: { kind: 'linear' | 'radial'; stops: [number, string][]; from?: Vec; to?: Vec };
  stroke?: string | null;
  strokeWidth?: Prop<number>;
  dash?: Vec;
  cap?: 'butt' | 'round' | 'square';
  /** Trim Paths: the visible portion of the stroke, 0–100. */
  trimStart?: Prop<number>;
  trimEnd?: Prop<number>;
  trimOffset?: Prop<number>;
  /** Repeater: copies with a cumulative offset. */
  repeat?: { count: number; offset: Vec; scale?: number; rotation?: number; opacityEnd?: number };
};

export type ProceduralKind = 'crimson-stage' | 'radial-glow' | 'linear-gradient' | 'hex-field' | 'grid' | 'light-rails' | 'noise' | 'light-leak' | 'dots' | 'aurora';

export type FootageSource = {
  /** A project asset id (resolved by the host) or an absolute path. */
  asset?: string;
  path?: string;
  kind?: 'video' | 'image';
  /** Source seconds at scene time 0. */
  in?: number;
  speed?: number;
  /** Time remap: source seconds as a function of scene time (overrides in/speed). */
  timeRemap?: Prop<number>;
  /** Roto matte (the clip's `rotoMatte`) — the subject's alpha, aligned with this source. */
  matte?: string;
  /** Use the matte as this layer's alpha (the cut-out subject). */
  cutout?: boolean;
  /** Natural size; filled in by the host when known. */
  width?: number;
  height?: number;
};

type LayerCommon = {
  id: string;
  name?: string;
  /** Scene seconds the layer appears / disappears (default: whole scene). */
  in?: number;
  out?: number;
  parent?: string;
  threeD?: boolean;
  transform?: Transform;
  blend?: BlendMode;
  /** Track matte: `layer` is the id of another layer (usually listed right above this one) whose alpha or luma cuts this one. */
  matte?: { layer: string; mode: MatteMode };
  /** A layer used only as a matte is not drawn itself. */
  hidden?: boolean;
  masks?: Mask[];
  effects?: Effect[];
  motionBlur?: boolean;
  /** Frosted glass: blur what is behind the layer's alpha before drawing it. */
  backdrop?: { blur: Prop<number>; saturation?: number; brightness?: number };
  /** Makes the layer an adjustment layer: its effects apply to everything below, cut by its alpha. */
  adjustment?: boolean;
  /** Free-form notes the AI can use to explain intent. */
  note?: string;
};

export type Layer = LayerCommon & (
  | { type: 'footage'; source: FootageSource; fit?: 'cover' | 'contain' | 'none'; /** Layer size when fitted; defaults to the canvas. */ size?: Vec }
  | { type: 'solid'; color: string; size?: Vec }
  | { type: 'procedural'; kind: ProceduralKind; params?: Record<string, unknown>; size?: Vec }
  | { type: 'shape'; shape: ShapeData }
  | { type: 'text'; text: TextLayerData }
  | { type: 'null' }
  | { type: 'camera'; zoom?: Prop<number>; pointOfInterest?: Prop<Vec>; focus?: Prop<number>; aperture?: Prop<number> }
  | { type: 'precomp'; scene: MotionScene; /** Scene seconds at which the precomp's time 0 plays. */ offset?: number; speed?: number }
);

export type LayerType = Layer['type'];

export type MotionScene = {
  version: 1;
  width: number;
  height: number;
  duration: number;
  /** Background colour; transparent when null/absent (the clip overlays the timeline). */
  background?: string | null;
  layers: Layer[];
  motionBlur?: { samples?: number; shutter?: number };
  /** Seed for wiggle/noise/random so renders are repeatable. */
  seed?: number;
  /** Sound cues the template wants (seconds): the host may lay SFX on them. */
  cues?: { at: number; sound: 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser' | 'click'; note?: string }[];
  /** Template id and params it was built from, so it can be rebuilt with new words. */
  template?: { id: string; params: Record<string, unknown> };
  /** The brand kit the scene was put in (src/motion/kit/brandify.ts), with the snapshot it used, so rebuilds stay on brand. */
  brand?: { kitId: string; name: string; snapshot: MotionBrand };
};
