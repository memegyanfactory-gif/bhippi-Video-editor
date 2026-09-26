// The Bhippi motion engine's scene model: an After Effects-style composition that the GPU
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
import type { ParticleData } from './particles';
import type { FormData } from './form';
import type { CharacterData } from './character/types';
import type { DrawingData } from './ink/types';

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
  | 'elastic-out' | 'bounce-out' | 'spring'
  // Measured on the reference films (docs/REFERENCE-FILMS-PLAN.md §2.1):
  | 'house' | 'settle' | 'emphasized' | 'rise' | 'push' | 'creep' | 'snap-settle' | 'resolve' | 'card-zoom';
export type Ease = EaseName | [number, number, number, number];

/** A keyframe. `ease` shapes the segment that *starts* at this key (Bhippi's existing convention). */
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
  | 'subject-reveal' | 'matte-fill' | 'matte-edge-glow'
  // Layer styles (the inflated / glass looks): inside the layer's alpha.
  | 'inner-shadow' | 'inner-glow' | 'bevel' | 'gradient-overlay'
  // Print looks (src/motion/ink, docs/DRAWN-STYLES.md): any layer printed as riso inks or a halftone.
  | 'riso' | 'halftone';

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
  exit?: { at: number; duration?: number; stagger?: number; ease?: Ease; to: { position?: Vec; scale?: number; opacity?: number; blur?: number }; /** Which unit leaves first: 'forward' (default), 'reverse' (last first — Virgil's "Too many"), 'random'. */ order?: 'forward' | 'reverse' | 'random' };
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
  /** Line spacing in percent of lineHeight, animatable: 0 collapses the lines onto each other (Workly). */
  lineSpacing?: Prop<number>;
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
  /**
   * Live typing (measured on the SaaS films: 30 cps in UI fields, 12–13 cps for text read with the
   * voice-over). The layout only holds what has been typed, so a centred line re-centres as it
   * grows. `script` types, backspaces and waits (search retype cycles); without it `text` is typed.
   */
  type?: TypeOn;
  /** Overwrite the text with `to`, left to right from `at` (Solair's retype morph); changed letters flash `flash`. */
  retype?: { to: string; at: number; cps?: number; flash?: string; flashFor?: number };
  /** Glyphs fly in from scattered places and converge (WasteProtection's "Powered by AI"). */
  scatter?: { at: number; duration?: number; spread?: number; rotate?: number; stagger?: number; seed?: number; ease?: Ease };
};

export type TypeOn = {
  /** Seconds the typing starts. */
  at?: number;
  /** Characters per second (30 = one per frame at 30 fps). */
  cps?: number;
  /** 'word' types a word at a time (fast AI prompts). */
  chunk?: 'char' | 'word';
  script?: ({ type: string } | { backspace: number } | { wait: number })[];
  backspaceCps?: number;
  /** Each new character fades in over this many seconds (default 2 frames). */
  fadeIn?: number;
  /** A feathered edge: the newest N characters ramp from faint to full (WasteProtection). */
  edge?: number;
  /** The newest characters show `color`: the last `chars` of the line, and/or each for `hold` s, then snap; or blend back over `settle` s. */
  front?: { color: string; chars?: number; hold?: number; settle?: number };
  caret?: 'bar' | 'block' | 'none';
  caretColor?: string;
  /** Caret blinks per second while idle (typing keeps it solid). */
  blink?: number;
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
  /**
   * A shape tree instead of the single primitive above (AE shape groups): bezier paths, primitives
   * and nested groups with their own transforms, fills and strokes, drawn in order (first = back).
   * Coordinates are layer pixels from the top-left; the layer is sized to the content (or `bounds`).
   */
  groups?: ShapeItem[];
  /** Explicit layer size [w, h] for a shape tree (otherwise its content's right/bottom edge). */
  bounds?: Vec;
};

/** Where an array's copies sit. grid: `columns` × rows, `spacing` [x, y]; ring: on a circle of `radius` (copies turn with it when `orient`), starting at `startAngle` degrees (0 = top); line: `spacing` [x, y] between copies. `center` defaults to keeping the whole array in positive layer space. `rotation` (degrees) spins the whole layout. */
export type ArrayLayout = { type: 'grid' | 'ring' | 'line'; columns?: number; spacing?: Prop<Vec>; radius?: Prop<number>; startAngle?: number; orient?: boolean; center?: Prop<Vec>; rotation?: Prop<number> };

/** A fill or stroke colour: a CSS colour or a gradient in layer pixels. */
export type Paint = string | { gradient: { kind: 'linear' | 'radial'; stops: [number, string][]; from?: Prop<Vec>; to?: Prop<Vec> } };

export type ShapeStroke = {
  paint: Paint;
  width?: Prop<number>;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  dash?: Vec;
  /** Trim Paths, 0–100. */
  trim?: { start?: Prop<number>; end?: Prop<number>; offset?: Prop<number> };
};

/**
 * One item of a shape tree. `path` takes SVG path data (`d`: M L H V C S Q T A Z, beziers and
 * arcs). rect/ellipse/polygon/star sit centred on `position` (default: half their size, so they
 * start at the origin). A `group` holds `items` under its own transform, fill and stroke, which
 * its children inherit unless they set their own.
 */
export type ShapeItem = {
  kind: 'path' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'group' | 'icon' | 'array';
  name?: string;
  d?: string;
  /** `icon`: a Lucide icon name ("shield-check", "sparkles", "bar-chart-3"…; find names with search_icons). Expanded to paths when the scene is built. */
  icon?: string;
  /** `icon`: size in px (default 96), line colour (default white) and Lucide stroke width (default 2, in 24-unit icon space). */
  iconSize?: number;
  color?: string;
  strokeWidth?: number;
  position?: Prop<Vec>;
  size?: Prop<Vec>;
  /** rect corner radius. */
  radius?: Prop<number>;
  /** polygon/star points. */
  sides?: number;
  /** star inner radius as a fraction of the outer (default 0.45). */
  innerRadius?: Prop<number>;
  items?: ShapeItem[];
  /** `array`: the item repeated (drawn centred on each slot; author it around 0,0), how many, and where. */
  item?: ShapeItem;
  count?: number;
  layout?: ArrayLayout;
  /** `array`: move every copy from `layout` to `morph.to` as `morph.t` goes 0 → 1, copy i starting `stagger`·i later (tiles → ring). */
  morph?: { to: ArrayLayout; t: Prop<number>; stagger?: number };
  /** `array`: opacity from the first copy to the last, 0–100 (a spinner's tail). */
  opacityRamp?: [number, number];
  /**
   * `group`: path operators run in order over the group's children before it is painted (AE's
   * Merge Paths, Offset Paths, Round Corners): merge = the first child against the rest.
   */
  ops?: ({ op: 'merge'; mode?: 'union' | 'subtract' | 'intersect' | 'xor' } | { op: 'offset'; amount: Prop<number>; join?: 'round' | 'miter' | 'bevel' } | { op: 'round-corners'; radius: Prop<number> })[];
  /** A leaf that morphs into another shape as `morphT` goes 0 → 1 (square → sparkle, circle → logo mark). */
  morphTo?: ShapeItem;
  morphT?: Prop<number>;
  transform?: { anchor?: Prop<Vec>; position?: Prop<Vec>; scale?: Prop<number | Vec>; rotation?: Prop<number>; opacity?: Prop<number> };
  fill?: Paint | null;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: ShapeStroke | null;
  opacity?: Prop<number>;
};

export type ProceduralKind = 'crimson-stage' | 'radial-glow' | 'linear-gradient' | 'hex-field' | 'grid' | 'light-rails' | 'noise' | 'light-leak' | 'dots' | 'aurora' | 'mesh-gradient' | 'light-shafts' | 'dot-wave';

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
  /**
   * A numbered image sequence instead of one file: `dir/<start + i, zero-padded to digits>.<ext>`.
   * Headless-Blender renders, Lottie pre-renders and any PNG run with alpha come in this way and
   * then composite like any footage (mattes, effects, blend, 3D). `first` = source seconds of the
   * first frame; outside the run the first/last frame holds, or the run repeats with `loop`.
   */
  sequence?: { dir: string; fps: number; frames: number; first?: number; start?: number; digits?: number; ext?: 'png' | 'jpg' | 'webp'; loop?: boolean };
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
  /** Deliberately runs off the frame (a giant word panning past, type cropped by the edge): the safe-area fitter and frame QA leave it alone. */
  bleed?: boolean;
  masks?: Mask[];
  effects?: Effect[];
  motionBlur?: boolean;
  /** Frosted glass: blur what is behind the layer's alpha before drawing it. */
  backdrop?: { blur: Prop<number>; saturation?: number; brightness?: number };
  /** Makes the layer an adjustment layer: its effects apply to everything below, cut by its alpha. */
  adjustment?: boolean;
  /**
   * Cross-layer links (plan P4): this layer's property follows another layer's, `delay` seconds
   * behind — a trail after a moving dot, echo copies, a label riding a card. Position adds
   * `offset` ([x, y]); scale, rotation and opacity multiply by `multiply` and add `offset`.
   * The source's own keyed value is read (not its parent chain).
   */
  link?: { prop: 'position' | 'scale' | 'rotation' | 'opacity'; from: string; delay?: number; offset?: number | Vec; multiply?: number }[];
  /** Free-form notes the AI can use to explain intent. */
  note?: string;
  /**
   * AE's Start Time and Time Stretch: the layer's own clock is `(t − startTime) × timeScale`, so its
   * keyframes, text, footage and effects play from there. In/out stay in scene time. A layered
   * motion comp (lib/motionStack.ts) sets both from where the layer's clip sits and how fast it runs.
   */
  startTime?: number;
  timeScale?: number;
  /**
   * The clip transform of a layered motion comp's layer clip, applied after everything else, in
   * canvas pixels around the canvas centre: what moving, scaling or fading the clip on the timeline
   * does to the layer (keyed on scene time). Children do not inherit it.
   */
  frame?: { offset?: Prop<Vec>; scale?: Prop<number>; rotation?: Prop<number>; opacity?: Prop<number> };
  /**
   * A copy of a layer that lives in another clip of the same layered comp, kept (hidden) so this
   * clip still renders right on its own: a parent, a matte source or the camera. The stack drops it
   * when it renders the whole comp as one scene.
   */
  ref?: boolean;
};

export type Layer = LayerCommon & (
  | { type: 'footage'; source: FootageSource; fit?: 'cover' | 'contain' | 'none'; /** Layer size when fitted; defaults to the canvas. */ size?: Vec }
  | { type: 'solid'; color: string; size?: Vec }
  | { type: 'procedural'; kind: ProceduralKind; params?: Record<string, unknown>; size?: Vec }
  /** Confetti, sparkles, dust, bokeh, speed lines, snow, embers, bursts (src/motion/particles.ts); the layer is the scene size unless `size`. */
  | { type: 'particles'; particles: ParticleData; size?: Vec }
  /** A soft 2.5D object (src/motion/form.ts): sphere, capsule, cylinder, rounded box, torus, coin, slab, prism, cone. */
  | { type: 'form'; form: FormData }
  /** A rigged character driven by timed actions (src/motion/character); the layer is CHARACTER_BOX with the feet at CHARACTER_FEET. */
  | { type: 'character'; character: CharacterData }
  /** A hand-made drawing (src/motion/ink, docs/DRAWN-STYLES.md): riso, crayon, ink, pencil, cut paper, felt or scope looks; items drawn on, popped and boiled on twos. The layer is the scene size unless `drawing.size`. */
  | { type: 'drawing'; drawing: DrawingData }
  | { type: 'shape'; shape: ShapeData }
  | { type: 'text'; text: TextLayerData }
  | { type: 'null' }
  | { type: 'camera'; zoom?: Prop<number>; pointOfInterest?: Prop<Vec>;
      /** Focus distance in px from the camera (default: the zoom). 3D layers away from it blur. */
      focus?: Prop<number>;
      /** Aperture in px (AE's): 0 = no depth of field. The blur radius is about aperture × |distance − focus| / distance. */
      aperture?: Prop<number>;
      /** Depth-of-field shape: `band` = px of depth around the focus that stays sharp; `near`/`far` scale the blur in front of / behind it; `max` caps it (screen px, default 48). */
      dof?: { band?: Prop<number>; near?: number; far?: number; max?: number } }
  | { type: 'precomp'; scene: MotionScene; /** Scene seconds at which the precomp's time 0 plays. */ offset?: number; speed?: number; /** A layered motion comp that holds this precomp's layers; when present it replaces `scene` (which stays as the fallback). */ comp?: string }
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
  cues?: { at: number; sound: 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser' | 'click' | 'tick' | 'key' | 'typing' | 'glass' | 'shimmer' | 'sub' | 'blip' | 'swish' | 'ding' | 'boom'; /** Seconds to keep (a typing bed runs as long as the typing). */ duration?: number; note?: string }[];
  /** Template id and params it was built from, so it can be rebuilt with new words. */
  template?: { id: string; params: Record<string, unknown> };
  /** The brand kit the scene was put in (src/motion/kit/brandify.ts), with the snapshot it used, so rebuilds stay on brand. */
  brand?: { kitId: string; name: string; snapshot: MotionBrand };
  /**
   * Set on the scene of one layer clip of a layered motion comp (lib/motionStack.ts): `own` lists
   * the layer(s) this clip is; every other layer in it is a hidden `ref` copy. `id` ties together
   * the clips opened from one scene.
   */
  stack?: { id: string; own: string[] };
};
