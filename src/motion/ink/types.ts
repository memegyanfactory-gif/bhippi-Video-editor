// Drawn styles (docs/DRAWN-STYLES.md): hand-made looks — riso print, crayon, ink, pencil, cut paper,
// felt, scope — as one `drawing` layer the AI writes as data. Every frame is a function of the
// data, the seed and the (optionally on-twos) time, so preview, scrub and export agree.
import type { Prop, Vec } from '../types';

export const LOOKS = ['riso', 'crayon', 'ink', 'pencil', 'cut-paper', 'felt', 'flat', 'scope'] as const;
export type Look = (typeof LOOKS)[number];

export const FACES = ['dots', 'happy', 'squint', 'closed', 'dizzy', 'wide', 'smile', 'surprised', 'sleepy', 'none'] as const;
export type Face = (typeof FACES)[number];

export const ITEM_KINDS = [
  // primitives
  'circle', 'ellipse', 'rect', 'polygon', 'star', 'line', 'path', 'blob', 'icon',
  // motifs
  'ripples', 'rose', 'spiral', 'snowflake', 'web', 'lissajous', 'dandelion', 'sparkle', 'burst', 'constellation',
  'stars', 'waves', 'hills', 'sun', 'moon', 'cloud', 'flower', 'tree', 'grass', 'rain', 'planet', 'heart', 'trail',
  // characters
  'bot', 'sprite',
  // type and paper
  'write', 'note',
  // tools
  'pen', 'construction',
  // transitions
  'tear',
  // scope
  'trace', 'cloud-points',
  // grouping
  'group',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const PEN_TOOLS = ['nib', 'pencil', 'brush', 'crayon'] as const;
export const PRINTS = ['news', 'music', 'grid', 'lines', 'dots'] as const;

/**
 * One thing in a drawing. Coordinates are layer px from the top-left. `at` is the item's centre
 * (default the layer centre) and `size` its box [w, h] (a number means a square). Every numeric
 * placement value may be keyed or an expression, like any motion Prop.
 */
export type DrawItem = {
  kind: ItemKind;
  /** Lets the pen follow this item, links, and error messages. */
  id?: string;
  at?: Prop<Vec>;
  size?: Prop<number | Vec>;
  rotation?: Prop<number>;
  /** Percent, uniform or [sx, sy] (squash and stretch). */
  scale?: Prop<number | Vec>;
  /** 0–100. */
  opacity?: Prop<number>;
  /** Seconds the item appears / disappears (default: always). */
  in?: number;
  out?: number;

  fill?: string | null;
  /** A second fill colour: crayon hatching mixes it in, cut paper uses it for streaks. */
  fill2?: string;
  stroke?: string | null;
  /** Outline width in px. */
  width?: Prop<number>;
  /**
   * Riso: which ink plate(s) print this item. A number is one plate at full coverage; a list is a
   * coverage 0–1 per plate (so [0.8, 0.5] prints ink 0 at 80% and ink 1 at 50% — overprints mix).
   * Default: the plate whose ink is nearest `fill` (or `stroke`).
   */
  ink?: number | number[];
  /** Riso: print on top of what is under it instead of knocking it out first. */
  overprint?: boolean;

  /** tear: how far the torn edge has swept across the box, 0 → 1 (animatable). */
  progress?: Prop<number>;
  /** cut-paper: px of torn white paper rim under the shape (default 5); tear: draw only a torn strip this wide along the edge. */
  rim?: number;
  /** Draw-on, 0 → 1: the outline strokes appear along their length (the pen follows the tip). */
  draw?: Prop<number>;
  /** Fill-in, 0 → 1: the fill sweeps on (crayon hatching, a wipe for other looks). */
  fillIn?: Prop<number>;
  /** Degrees the fill-in sweeps toward and the hatching runs (default 35). */
  hatchAngle?: number;
  /** Seconds the item pops on: 2 drawings big with burst ticks, then settles (Film 5). */
  pop?: number;
  /** px of extra wobble for this item (adds to the drawing's boil). */
  wobble?: number;
  /** A texture printed inside cut-paper shapes: newsprint, a music staff, graph grid, ruled lines, dots. */
  print?: (typeof PRINTS)[number];
  seed?: number;

  // ---- kind parameters ----
  /** polygon/star/flower/sparkle/burst/web/snowflake/sprite: points, petals, rays, spokes. */
  sides?: number;
  /** star/sparkle: inner radius as a fraction of the outer (default 0.45). */
  inner?: number;
  /** rect corner radius (px). */
  radius?: number;
  /** path: SVG path data; icon: a Lucide icon name (turned into a path when the scene is built). */
  d?: string;
  icon?: string;
  /** path: the coordinate box the data was drawn in [x, y, w, h] (fitted into `size`). Default: the data's own bounds. */
  box?: Vec;
  /** line/trail/constellation: points [x0, y0, x1, y1, …] in layer px. */
  points?: Vec;
  /** constellation: pairs of point indices to join; default each to the next. */
  edges?: Vec;
  /** rose: k = n/d petals; lissajous: a:b frequency ratio [a, b]; spiral: turns. */
  n?: number;
  ratio?: Vec;
  turns?: number;
  /** ripples: rings alive at once; stars/grass/rain/cloud-points/dandelion: how many marks. */
  count?: number;
  /** ripples: seconds between rings and a ring's life. */
  period?: number;
  life?: number;
  /** ripples/rain/burst/trace start time (s). */
  start?: number;
  /** hills/waves: band colours back to front. */
  colors?: string[];
  /** hills/waves/grass: how bumpy (0–1). */
  rough?: number;
  /** write: the text; note: lines of text. `\n` breaks lines. */
  text?: string;
  font?: string;
  /** write: px. */
  fontSize?: number;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  /** write: letters per second (default 12 = 2 f a letter at 24 fps, Films 1 and 4). */
  cps?: number;
  /** write: seconds the writing starts (default the item's `in`, else 0); or drive it with `draw`. */
  from?: number;
  /** bot/sprite: expressions over time [{t, face}]. */
  faces?: { t: number; face: Face }[];
  /** bot: legs (default 4) and whether it has side arms (default true); sprite: cheeks. */
  legs?: number;
  arms?: boolean;
  cheeks?: boolean;
  /** pen: which tool, which items it follows (ids; default every item with `draw`) and where it rests. */
  tool?: (typeof PEN_TOOLS)[number];
  follow?: string[];
  rest?: Vec;
  /** trace: spike times (s), the visible window (s) and decay (s). */
  spikes?: number[];
  window?: number;
  decay?: number;
  /** group: children, placed in the group's box. */
  items?: DrawItem[];
};

export type DrawingData = {
  look: Look;
  /** Ink/palette colours. Riso: the plates (2–4 inks, printed in order). */
  inks?: string[];
  /** Paper colour behind everything; null or absent = transparent (drawn over the layers below). */
  paper?: string | null;
  /** Show paper tooth / fibre grain on the paper (default true when there is paper). */
  tooth?: boolean;
  /** Drawings per… frame step: 2 = on twos (the drawing changes every 2 frames of `fps`). */
  step?: number;
  /** The frame rate `step` counts in (default 24). */
  fps?: number;
  /** px of line wobble, re-drawn every step (the boil). 0 = still lines. */
  boil?: number;
  seed?: number;
  /** Riso: halftone pitch in px (default 5), plate misregistration px (default 3), per-step tremor px. */
  pitch?: number;
  misregister?: number;
  tremor?: number;
  /** Riso: plate screen angles in degrees (default 15, 75, 0, 45). */
  angles?: number[];
  /** Layer size [w, h] (default the scene). */
  size?: Vec;
  items: DrawItem[];
};
