// How things move.
//
// The twelve principles are usually quoted and rarely encoded. Here each one that applies to
// motion graphics is a curve, a timing, or a rule about how several things enter together —
// something the renderer and the preview can both use, and something the assistant can name
// instead of inventing numbers.
//
// The reference film is the brief: nothing cuts on, everything arrives; words land one at a time;
// cards overshoot a little and settle; a thing that leaves does not simply vanish.

/** A cubic Bézier, as CSS and FFmpeg both understand it. */
export type Curve = readonly [number, number, number, number];

export type Principle =
  | 'squash-and-stretch'
  | 'anticipation'
  | 'staging'
  | 'follow-through'
  | 'slow-in-slow-out'
  | 'arc'
  | 'secondary-action'
  | 'timing'
  | 'exaggeration'
  | 'solid-drawing'
  | 'appeal'
  | 'straight-ahead';

/**
 * The curves, named for what they do rather than for their numbers.
 *
 * `standard` is the workhorse: fast out of the gate, long settle — the shape almost every good
 * interface and every card in the reference film uses. `overshoot` passes its target and comes
 * back, which is follow-through. `anticipate` pulls back before it goes.
 */
export const CURVES = {
  /** Slow in, slow out. The default for anything that moves without comment. */
  standard: [0.4, 0, 0.2, 1] as Curve,
  /** Leaves quickly, settles slowly: the one to use when something arrives. */
  entrance: [0.16, 1, 0.3, 1] as Curve,
  /** Gathers speed and goes: the one to use when something leaves. */
  exit: [0.7, 0, 0.84, 0] as Curve,
  /** Passes the mark and comes back — follow-through and overlapping action. */
  overshoot: [0.34, 1.56, 0.64, 1] as Curve,
  /** Pulls back before it moves — anticipation. */
  anticipate: [0.68, -0.55, 0.27, 1.55] as Curve,
  /** No easing at all, for machine-like or continuous motion. */
  linear: [0, 0, 1, 1] as Curve,
  /** A heavy thing: slow to start, quick to arrive, no bounce. */
  weighted: [0.55, 0.06, 0.68, 0.19] as Curve,
  /** Soft at both ends, for a light or a glow rather than an object. */
  gentle: [0.37, 0, 0.63, 1] as Curve,
} as const;

export type CurveName = keyof typeof CURVES;

export const css = (curve: Curve) => `cubic-bezier(${curve[0]}, ${curve[1]}, ${curve[2]}, ${curve[3]})`;

/** Sampling the curve, for the renderer and for drawing the graph in the editor. */
export function sampleCurve(curve: Curve, t: number): number {
  // A cubic Bézier through (0,0) and (1,1): solve x(u) = t by bisection, then read y(u).
  const clamped = Math.min(1, Math.max(0, t));
  const bezier = (a: number, b: number, u: number) => {
    const inverse = 1 - u;
    return 3 * inverse * inverse * u * a + 3 * inverse * u * u * b + u * u * u;
  };
  let low = 0;
  let high = 1;
  let guess = clamped;
  for (let step = 0; step < 24; step++) {
    const x = bezier(curve[0], curve[2], guess);
    if (Math.abs(x - clamped) < 1e-5) break;
    if (x < clamped) low = guess;
    else high = guess;
    guess = (low + high) / 2;
  }
  return bezier(curve[1], curve[3], guess);
}

/**
 * Timings, in seconds. Motion graphics live between a fifth of a second and about a second; below
 * that a move is not read, above it the viewer waits.
 */
export const TIMING = {
  /** A label, a pill, a small badge. */
  quick: 0.28,
  /** The default: a card, a title, a thumbnail. */
  normal: 0.45,
  /** A whole scene changing, or something large crossing the frame. */
  slow: 0.75,
  /** One word of a line, when words land one at a time. */
  word: 0.09,
  /** Between items of a list, so they read as a sequence rather than a block. */
  stagger: 0.07,
  /** How long a thing sits still before it leaves, at minimum. */
  hold: 0.6,
} as const;

/** What each principle means here, and what to reach for. Written to be read by a model as well. */
export const PRINCIPLES: Record<Principle, { about: string; use: string; curve?: CurveName }> = {
  'slow-in-slow-out': { about: 'Nothing real starts or stops instantly.', use: 'Every move. Never linear unless it is a machine or a loop.', curve: 'standard' },
  anticipation: { about: 'A small move against the direction before the move itself.', use: 'A card about to fly in, a number about to count, a title about to drop.', curve: 'anticipate' },
  'follow-through': { about: 'Parts keep going after the whole has stopped, and settle.', use: 'A card that lands and rocks a little; type that overshoots a hair.', curve: 'overshoot' },
  timing: { about: 'How long a move takes is what gives it weight.', use: 'Small things move quickly, large things slowly. See TIMING.' },
  staging: { about: 'One idea per frame, pointed at clearly.', use: 'Do not put a title, a card and a caption in the same moment; move one.' },
  arc: { about: 'Living things move on curves, not straight lines.', use: 'Give a flying thumbnail a slight arc rather than a ruled diagonal.' },
  'secondary-action': { about: 'A smaller motion that supports the main one.', use: 'A glow that swells as a card lands; a shadow that spreads.' },
  exaggeration: { about: 'Push the readable part further than life would.', use: 'Scale 1.12 on a punch-in, not 1.02. A hook word bigger than it needs to be.' },
  'squash-and-stretch': { about: 'Volume is kept while shape changes.', use: 'A word that lands can widen a little as it stops, then settle.' },
  'straight-ahead': { about: 'Some motion is drawn frame by frame rather than posed.', use: 'Noise, particles, a light sweep — let it run rather than keyframing each step.' },
  'solid-drawing': { about: 'Things have weight and sit in space.', use: 'Shadows under cards, a consistent light direction, no floating.' },
  appeal: { about: 'The thing is pleasant to look at and reads at a glance.', use: 'One accent colour, generous margins, type large enough to read on a phone.' },
};

// ── moves, as things a graphic can be told to do ───────────────────────────

export type Move = {
  name: string;
  about: string;
  /** The principles it leans on, so the reason is in the data. */
  principles: Principle[];
  curve: CurveName;
  seconds: number;
  /** The property path and its from/to, in the units the compositor uses. */
  from: Record<string, number>;
  to: Record<string, number>;
};

export const MOVES: Move[] = [
  {
    name: 'rise',
    about: 'Comes up into place and settles. The safe default for type.',
    principles: ['slow-in-slow-out', 'follow-through'],
    curve: 'entrance',
    seconds: TIMING.normal,
    from: { y: 0.06, opacity: 0 },
    to: { y: 0, opacity: 100 },
  },
  {
    name: 'pop',
    about: 'Scales up past its size and comes back. For a word that lands on a beat.',
    principles: ['exaggeration', 'follow-through', 'squash-and-stretch'],
    curve: 'overshoot',
    seconds: TIMING.quick,
    from: { scale: 72, opacity: 0 },
    to: { scale: 100, opacity: 100 },
  },
  {
    name: 'drop-in',
    about: 'Pulls up, then falls into place. For a card arriving with weight.',
    principles: ['anticipation', 'timing', 'solid-drawing'],
    curve: 'anticipate',
    seconds: TIMING.normal,
    from: { y: -0.05, scale: 96, opacity: 0 },
    to: { y: 0, scale: 100, opacity: 100 },
  },
  {
    name: 'scale-into-card',
    about: 'The whole frame shrinks into a rounded card, revealing the field behind it — the reference film’s hook ending.',
    principles: ['staging', 'slow-in-slow-out'],
    curve: 'entrance',
    seconds: TIMING.slow,
    from: { scale: 100 },
    to: { scale: 62 },
  },
  {
    name: 'slide-beside',
    about: 'Comes in from the edge it belongs to, so it reads as beside the subject rather than over him.',
    principles: ['staging', 'arc'],
    curve: 'entrance',
    seconds: TIMING.normal,
    from: { x: 0.08, opacity: 0 },
    to: { x: 0, opacity: 100 },
  },
  {
    name: 'fade-through',
    about: 'Leaves while the next thing arrives, so the frame is never empty.',
    principles: ['staging', 'timing'],
    curve: 'exit',
    seconds: TIMING.quick,
    from: { opacity: 100 },
    to: { opacity: 0 },
  },
  // ── React-Bits shelf (see src/lib/reactbits.ts for the full catalogue) ──
  // Each move is the deterministic twin of a React Bits entrance: the preview
  // plays the rich keyframe, planners and style packs stage one of these.
  {
    name: 'scramble-in',
    about: 'Snaps into order like a resolved scramble. For hooks and reveals.',
    principles: ['exaggeration', 'timing'],
    curve: 'overshoot',
    seconds: TIMING.quick,
    from: { scale: 85, opacity: 0 },
    to: { scale: 100, opacity: 100 },
  },
  {
    name: 'glitch-cut',
    about: 'Slices in with offset energy and lands hard. For drops and hard cuts.',
    principles: ['exaggeration', 'timing'],
    curve: 'exit',
    seconds: TIMING.quick,
    from: { x: 0.05, scale: 104, opacity: 0 },
    to: { x: 0, scale: 100, opacity: 100 },
  },
  {
    name: 'blur-rise',
    about: 'Resolves out of blur while rising. The soft reveal over busy footage.',
    principles: ['slow-in-slow-out', 'staging'],
    curve: 'entrance',
    seconds: TIMING.normal,
    from: { y: 0.04, opacity: 0 },
    to: { y: 0, opacity: 100 },
  },
  {
    name: 'warp-in',
    about: 'Bends through a wave as it lands. For music visuals and psychedelia.',
    principles: ['exaggeration', 'squash-and-stretch'],
    curve: 'overshoot',
    seconds: TIMING.normal,
    from: { scale: 88, opacity: 0 },
    to: { scale: 100, opacity: 100 },
  },
  {
    name: 'magnet-settle',
    about: 'Leans past its mark and springs back. Playful cards and menus.',
    principles: ['follow-through', 'exaggeration'],
    curve: 'overshoot',
    seconds: TIMING.normal,
    from: { y: 0.05, scale: 94, opacity: 0 },
    to: { y: 0, scale: 100, opacity: 100 },
  },
  {
    name: 'orbit-in',
    about: 'Swings in on an arc rather than a straight line. Living entrances.',
    principles: ['arc', 'slow-in-slow-out'],
    curve: 'entrance',
    seconds: TIMING.slow,
    from: { x: -0.09, y: 0.05, opacity: 0 },
    to: { x: 0, y: 0, opacity: 100 },
  },
  {
    name: 'ripple-land',
    about: 'Lands soft with a spreading calm. Nature, wellness, quiet reveals.',
    principles: ['slow-in-slow-out', 'secondary-action'],
    curve: 'gentle',
    seconds: TIMING.normal,
    from: { scale: 92, opacity: 0 },
    to: { scale: 100, opacity: 100 },
  },
  {
    name: 'peel-reveal',
    about: 'Uncovers as if a corner peeled back. Announcements and unboxings.',
    principles: ['staging', 'timing'],
    curve: 'entrance',
    seconds: TIMING.normal,
    from: { x: 0.06, opacity: 0 },
    to: { x: 0, opacity: 100 },
  },
  {
    name: 'expand-bloom',
    about: 'Blooms from thumbnail to full frame. Hook endings and big reveals.',
    principles: ['staging', 'exaggeration'],
    curve: 'entrance',
    seconds: TIMING.slow,
    from: { scale: 62, opacity: 0 },
    to: { scale: 100, opacity: 100 },
  },
  {
    name: 'type-on',
    about: 'Appears with no motion at all, like a typed character. Terminals and code.',
    principles: ['timing', 'staging'],
    curve: 'linear',
    seconds: TIMING.word,
    from: { opacity: 0 },
    to: { opacity: 100 },
  },
];

export const findMove = (name: string) => MOVES.find((move) => move.name === name.trim().toLowerCase());

/**
 * When each of `count` things should start, so they read as a sequence. The last one must still
 * land inside `within`, or a list of twelve takes longer than the shot it belongs to.
 */
export function staggerTimes(count: number, within = 1.2, gap: number = TIMING.stagger): number[] {
  if (count <= 1) return [0];
  const step = Math.min(gap, within / (count - 1));
  return Array.from({ length: count }, (_, index) => Math.round(index * step * 1000) / 1000);
}

/** Word-by-word timings across a line, the way the reference film lands its titles. */
export function wordTimes(words: number, seconds: number = TIMING.word): number[] {
  return Array.from({ length: Math.max(0, words) }, (_, index) => Math.round(index * seconds * 1000) / 1000);
}
