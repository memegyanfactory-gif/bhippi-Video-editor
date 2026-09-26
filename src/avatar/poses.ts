// Every animation the avatar knows, as a function from time to a pose.
//
// Time is stepped at 12 frames a second so the motion reads like hand-made pixel animation (the
// sprite moves across the screen smoothly; its drawing changes in steps). Poses only move hands,
// feet, eyes and mouth — sprite.ts draws whatever they describe.

import { CX, FEET_Y, REST, TORSO_Y, type CatPose, type CatTail, type Character, type Gear, type Pose, type Prop } from './sprite';

export type AnimName =
  | 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'dizzy'
  | 'research' | 'cut' | 'carry' | 'place' | 'kick' | 'polish' | 'mix' | 'direct' | 'draw' | 'think' | 'talk' | 'ask' | 'push' | 'tweak'
  | 'dangle' | 'slap' | 'celebrate' | 'sleep' | 'wave' | 'poked';

export type AnimOptions = {
  /** Extra headwear for the council seat at work. */
  gear?: Gear[];
  /** Colour of the clip being carried or placed. */
  color?: string;
  /** Who plays it (Settings › Avatar); Heli when unset. */
  character?: Character;
};

export const FPS = 12;

const cyc = (t: number, rate: number, n: number) => Math.floor(t * rate) % n;
const make = (over: Partial<Pose>, options: AnimOptions, own: Gear[] = []): Pose => ({
  ...REST,
  ...over,
  character: options.character,
  gear: [...new Set([...own, ...(options.gear ?? []), ...(over.gear ?? [])])],
});

/** Blinks every few seconds so a still character still looks alive. */
const blinking = (t: number, eyes: Pose['eyes'] = 'open'): Pose['eyes'] => ((t % 3.4) > 3.26 ? 'blink' : eyes);

const walkLegs = (k: number, stride = 1): Pick<Pose, 'legL' | 'legR'> => ({
  legL: ([[stride, 0], [0, 2], [-stride, 0], [0, 0]] as [number, number][])[k],
  legR: ([[-stride, 0], [0, 0], [stride, 0], [0, 2]] as [number, number][])[k],
});

/** A film clip held in front of the chest (x, y are its top-left corner). */
const clip = (y: number, color: string, lean = 0): Prop => ({ kind: 'clip', x: CX - 8 + lean, y, color });

/**
 * The first beat of every long job, as in a sprite sheet's first frame: it notices the work
 * ("!"), then gets on with it.
 */
const notice = (t: number, o: AnimOptions, gear: Gear[]): Pose | null =>
  t < 0.34 ? make({ y: t < 0.1 ? -2 : 0, eyes: 'wide', mouth: 'o', armR: [3, -5], armL: [-2, 6], legL: [-1, 0], legR: [1, 0] }, o, gear) : null;

type AnimFn = (t: number, options: AnimOptions) => Pose;

/**
 * The puppy's bedtime: where its kennel goes (the art column of its centre) and when, in seconds
 * into the sleep, the kennel lands and when the puppy is curled up inside it.
 */
export const KENNEL = { x: CX + 10, landsAt: 2.1, asleepAt: 3.9 };
/** Where the puppy stands to set the kennel down and admire it: to the left of it. */
const KENNEL_STEP = -14;

const smooth = (u: number) => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };
const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);

/**
 * A yawn; it reaches behind its back and hauls out a little kennel, steps aside and swings it
 * round, sets it down with a bump, admires it, trots in through the door, turns round and curls
 * up with its sleepy face peeking out of the doorway.
 */
function puppyBedtime(t: number, o: AnimOptions): Pose {
  const ground = FEET_Y - 1;
  const house = (y: number, stage: NonNullable<Pose['kennel']>['stage'], x = KENNEL.x) => ({ kennel: { x, y, stage } });
  if (t < 0.6) return make({ eyes: 'sleep', mouth: 'o', armL: [-4, -6], armR: [4, -6], y: t < 0.3 ? -1 : 0 }, o);
  if (t < 1.2) {
    const u = smooth((t - 0.6) / 0.5);
    return make({
      armLBack: true, armRBack: true, armL: [7, 3 - lerp(0, 3, u)], armR: [5, 2 - lerp(0, 3, u)], lean: -1, look: 1,
      eyes: 'focus', mouth: 'tongue', ...house(ground - lerp(0, 7, u), 'behind', CX + 8),
    }, o);
  }
  if (t < 1.8) {
    const u = smooth((t - 1.2) / 0.6);
    const k = cyc(t, 8, 4);
    return make({
      ...walkLegs(k), lean: lerp(0, KENNEL_STEP, u), armL: [3, 5], armR: [9, 2], look: 1, eyes: 'squeeze', mouth: 'grin',
      ...house(ground - 7, u < 0.5 ? 'behind' : 'held', lerp(CX + 8, KENNEL.x, u)),
    }, o);
  }
  if (t < KENNEL.landsAt + 0.1) {
    const u = smooth((t - 1.8) / (KENNEL.landsAt - 1.8));
    return make({
      lean: KENNEL_STEP, y: u < 1 ? 1 : 0, armL: [2, 6], armR: [9, 3 + lerp(0, 4, u)], look: 1, eyes: 'focus', mouth: 'o',
      ...house(ground - lerp(7, 0, u), 'placed'),
    }, o);
  }
  if (t < 2.7) return make({ lean: KENNEL_STEP, headY: cyc(t, 6, 2), armL: [-2, 7], armR: [3, 6], look: 1, eyes: 'happy', mouth: 'cat', ...house(ground, 'placed') }, o);
  // Ducks low and crawls in through the door.
  if (t < 2.9) return make({ lean: KENNEL_STEP, y: 4, armL: [2, 7], armR: [5, 6], look: 1, eyes: 'focus', mouth: 'smile', ...house(ground, 'placed') }, o);
  if (t < 3.5) {
    const u = smooth((t - 2.9) / 0.6);
    return make({
      sit: 'floor', y: 14 - cyc(t, 8, 2), lean: lerp(KENNEL_STEP, KENNEL.x - CX, u), armL: [4, 5 - cyc(t, 8, 2)], armR: [6, 4], look: 1,
      eyes: 'focus', mouth: 'tongue', sway: -0.4, ...house(ground, 'inside'),
    }, o);
  }
  // Inside: it turns round and flops down until its face fills the doorway.
  const settle = smooth((t - 3.5) / (KENNEL.asleepAt - 3.5));
  const asleep = t >= KENNEL.asleepAt;
  return make({
    sit: 'floor', lean: KENNEL.x - CX, y: lerp(14, 19, settle), headY: asleep ? cyc(t, 0.6, 2) : 0,
    eyes: asleep ? 'sleep' : settle < 0.5 ? 'blink' : 'down', mouth: asleep ? 'o' : 'smile', blush: true,
    ...house(ground, 'inside'),
  }, o);
}

export const ANIMS: Record<AnimName, AnimFn> = {
  idle: (t, o) => {
    const breathe = cyc(t, 1.2, 2);
    const cycle = t % 9;
    const look: Pose['look'] = cycle > 6 && cycle < 7.2 ? 1 : cycle > 7.4 && cycle < 8.3 ? -1 : 0;
    return make({ headY: breathe, armL: [-2, 7 + breathe], armR: [2, 7 + breathe], look, eyes: blinking(t) }, o);
  },
  walk: (t, o) => {
    const k = cyc(t, 8, 4);
    const swing = [1, 0, -1, 0][k];
    return make({ ...walkLegs(k), y: k % 2 ? -1 : 0, armL: [-2 + swing, 7], armR: [2 + swing, 7], look: 1, eyes: blinking(t), sway: -0.4 }, o);
  },
  run: (t, o) => {
    const k = cyc(t, 12, 4);
    const swing = [3, 0, -3, 0][k];
    return make({ ...walkLegs(k, 2), y: k % 2 ? -1 : 0, lean: 1, headX: 1, armL: [-1 + swing, 4], armR: [1 - swing, 4], look: 1, mouth: 'open', eyes: 'focus', sway: -1 }, o);
  },
  jump: (_t, o) => make({ legL: [-1, 3], legR: [1, 3], armL: [-4, -7], armR: [4, -7], eyes: 'wide', mouth: 'open', look: 1, sway: 0.4 }, o),
  fall: (t, o) => {
    const k = cyc(t, 10, 2);
    return make({ legL: [-1, k ? 1 : 3], legR: [1, k ? 3 : 1], armL: [-5, -8 + k], armR: [5, -9 + (1 - k)], eyes: 'wide', mouth: 'shout', sway: k ? 0.8 : 1 }, o);
  },
  land: (t, o) => make({ y: t < 0.12 ? 2 : t < 0.24 ? 1 : 0, legL: [-1, 0], legR: [1, 0], armL: [-5, 4], armR: [5, 4], eyes: t < 0.2 ? 'squeeze' : 'open', mouth: 'o' }, o),
  dizzy: (t, o) => make({ headX: [-1, 0, 1, 0][cyc(t, 4, 4)], eyes: 'dizzy', mouth: 'wavy', armL: [-3, 7], armR: [3, 7], legL: [cyc(t, 3, 2) ? -1 : 0, 0], legR: [cyc(t, 3, 2) ? 0 : 1, 0], sway: [-0.5, 0, 0.5, 0][cyc(t, 4, 4)] }, o),

  // Research: glasses on, cross-legged behind a laptop, typing, reading, nodding at what it finds.
  research: (t, o) => {
    const intro = notice(t, o, ['glasses']);
    if (intro) return intro;
    const k = cyc(t, 10, 2);
    const reading = t % 5 > 3.6;
    const found = t % 11 > 9.6;
    if (found) return make({ sit: 'floor', armR: [6, -8], finger: 'R', armL: [5, 3], eyes: 'wide', mouth: 'open', props: [{ kind: 'laptop', glow: 1 }] }, o, ['glasses']);
    return make({
      sit: 'floor', armL: [5, 3 + k], armR: [-4, 3 + (1 - k)],
      eyes: reading ? blinking(t, 'open') : 'focus', look: reading ? ([-1, 1][cyc(t, 1.5, 2)] as -1 | 1) : 0,
      mouth: reading ? 'o' : 'flat', headY: reading ? 0 : cyc(t, 1.4, 2),
      props: [{ kind: 'laptop', glow: cyc(t, 2, 2) }],
    }, o, ['glasses']);
  },

  // Cutting a clip: big scissors in the right hand, snipping three times a second.
  cut: (t, o) => {
    const k = cyc(t, 3, 2);
    return make({ armR: [5, 1 + k], armL: [1, 5], legL: [-1, 0], legR: [1, 0], look: 1, eyes: k ? 'wink' : 'focus', mouth: k ? 'grin' : 'tongue', props: [{ kind: 'scissors', open: k ? 0 : 1 }] }, o);
  },
  carry: (t, o) => {
    const k = cyc(t, 8, 4);
    const y = k % 2 ? -1 : 0;
    return make({ ...walkLegs(k), y, armL: [0, 5 + y], armR: [1, 5 + y], look: 1, mouth: 'grin', eyes: blinking(t), sway: -0.4, props: [clip(TORSO_Y + 1 + y, o.color ?? '#6fa8ff')] }, o);
  },
  place: (t, o) => {
    const p = Math.min(1, t / 0.35);
    const clipY = TORSO_Y + 1 + Math.round(p * (FEET_Y - 11 - (TORSO_Y + 1)));
    const done = t > 0.45;
    return make({
      y: done ? 0 : Math.round(p * 3), armL: done ? [-3, 6] : [0, 5 + Math.round(p * 8)], armR: done ? [3, 6] : [1, 5 + Math.round(p * 8)],
      eyes: done ? 'happy' : 'focus', mouth: done ? 'cat' : 'grin', look: 1,
      props: done ? [] : [clip(clipY, o.color ?? '#6fa8ff')],
    }, o);
  },
  // Deleting: a wind-up, a kick that sends the clip flying, then dusting off the hands.
  kick: (t, o) => {
    if (t < 0.25) return make({ legR: [-2, 3], lean: -1, armL: [-5, 3], armR: [4, 2], eyes: 'angry', mouth: 'grin', look: 1 }, o);
    if (t < 0.5) return make({ legR: [5, 5], lean: 1, armL: [-6, 0], armR: [-1, 5], eyes: 'angry', mouth: 'shout', look: 1, sway: -0.6 }, o);
    const k = cyc(t, 6, 2);
    return make({ armL: [3 + k, 5], armR: [-3 - k, 5], eyes: 'happy', mouth: 'cat' }, o);
  },
  // Polishing: a cloth rubbed in quick circles, shuffling along, beaming at the shine.
  polish: (t, o) => {
    const intro = notice(t, o, []);
    if (intro) return intro;
    const a = t * Math.PI * 2 * 2.5;
    const k = cyc(t, 4, 2);
    const proud = t % 2.4 > 1.8;
    return make({
      armR: [5 + Math.round(2.5 * Math.cos(a)), 2 + Math.round(2 * Math.sin(a))], armL: [1, 6],
      legL: [k, 0], legR: [k ? 0 : 1, 0], look: 1,
      eyes: proud ? 'happy' : blinking(t, 'focus'), mouth: proud ? 'grin' : 'smile',
      props: [{ kind: 'cloth', phase: t * 2 }],
    }, o);
  },
  // The Audio Guru: headphones on, kneeling at a mixer, riding faders, nodding on the beat —
  // and every few bars a fist in the air.
  mix: (t, o) => {
    const intro = notice(t, o, ['headphones']);
    if (intro) return intro;
    const k = cyc(t, 4, 2);
    const rocking = t % 6 > 4.4;
    if (rocking) return make({ sit: 'floor', headY: cyc(t, 4, 2), armR: [6, -10 + k], armL: [5, 4], eyes: 'happy', mouth: 'laugh', props: [{ kind: 'mixer', phase: t }] }, o, ['headphones']);
    const vibing = t % 3 < 1.8;
    return make({
      sit: 'floor', headY: cyc(t, 2.2, 2), headX: vibing ? cyc(t, 1.1, 2) : 0, armL: [4, 4 + k], armR: [-3, 4 + (1 - k)],
      eyes: vibing ? 'happy' : blinking(t, 'focus'), mouth: vibing ? 'smile' : 'o',
      props: [{ kind: 'mixer', phase: t }],
    }, o, ['headphones']);
  },
  // The Director: beret on; frames the shot with both hands, then slates it.
  direct: (t, o) => {
    const intro = notice(t, o, ['beret']);
    if (intro) return intro;
    const phase = t % 3;
    if (phase < 1.6) return make({ armL: [-6, -10], armR: [6, -10], finger: 'both', eyes: 'wink', mouth: 'flat', legL: [-1, 0], legR: [1, 0] }, o, ['beret']);
    const open = phase < 2.3 ? 1 : 0;
    return make({ armR: [3, -3], armL: [-1, 6], eyes: open ? 'focus' : 'squeeze', mouth: open ? 'flat' : 'shout', look: 1, props: [{ kind: 'clapper', open }] }, o, ['beret']);
  },
  // The Animator: visor on, drawing frame after frame in a flipbook, flipping it to check.
  draw: (t, o) => {
    const intro = notice(t, o, ['visor']);
    if (intro) return intro;
    const flipping = t % 4 > 3.1;
    if (flipping) return make({ armL: [5, 3], armR: [-2, 1], eyes: 'happy', mouth: 'grin', props: [{ kind: 'flipbook', page: t * 12 }] }, o, ['visor']);
    const zig = cyc(t, 8, 3) - 1;
    const zag = cyc(t, 5, 2);
    return make({
      armL: [5, 5], armR: [-6 + zig, 2 + zag], eyes: 'focus', mouth: 'tongue',
      props: [{ kind: 'flipbook', page: t * 2 }, { kind: 'pencil' }],
    }, o, ['visor']);
  },
  // Writing the reply in the chat: turned to it, talking with its hands.
  talk: (t, o) => {
    const k = cyc(t, 8, 4);
    const beat = cyc(t, 2.5, 2);
    return make({
      mouth: (['open', 'smile', 'o', 'grin'] as const)[k], eyes: blinking(t), look: 1, headY: cyc(t, 3, 2),
      armR: beat ? [5, -2] : [4, 2], armL: [-2, 6], finger: beat ? 'R' : undefined,
    }, o);
  },
  // Waiting on the user's answer: a hand up, eyes on them.
  ask: (t, o) => make({ y: cyc(t, 2, 2) ? -1 : 0, armR: [5, -10 + cyc(t, 3, 2)], armL: [-2, 6], eyes: blinking(t, 'wide'), mouth: 'o', look: 0 }, o),
  think: (t, o) => make({ armR: [-5, -3], armL: [2, 6], eyes: t % 3 < 2 ? 'up' : blinking(t), look: cyc(t, 0.7, 2) ? 1 : -1, mouth: t % 3 < 2 ? 'flat' : 'wavy', headX: cyc(t, 0.5, 2) }, o),
  push: (t, o) => {
    const k = cyc(t, 6, 4);
    return make({ ...walkLegs(k), lean: 2, headX: 1, armL: [7, 1], armR: [6, 2], eyes: 'squeeze', mouth: 'grin', look: 1 }, o);
  },
  tweak: (t, o) => {
    const k = cyc(t, 4, 2);
    return make({ armR: k ? [4, -4] : [4, 2], armL: [0, 6], look: 1, eyes: blinking(t, 'focus'), mouth: 'tongue', props: [{ kind: 'wrench' }] }, o);
  },

  // Picked up by the mouse: wriggling, kicking, laughing its head off.
  dangle: (t, o) => {
    const k = cyc(t, 10, 2);
    const kick = cyc(t, 7, 3);
    return make({
      armL: [-5 + k, -8], armR: [5 - k, -8 - k], legL: [[-2, 3], [0, 0], [-1, 2]][kick] as [number, number], legR: [[1, 0], [2, 3], [0, 1]][kick] as [number, number],
      headX: k ? 1 : -1, eyes: 'squeeze', mouth: 'laugh', blush: true, sway: k ? 0.6 : -0.6,
    }, o);
  },
  // Slapping the cursor away, then wagging a finger: "no no no".
  slap: (t, o) => {
    if (t < 0.12) return make({ armR: [-3, -8], armRBack: true, lean: -1, eyes: 'angry', mouth: 'grin', look: 1 }, o);
    if (t < 0.32) return make({ armR: [9, -3], lean: 2, headX: 1, eyes: 'angry', mouth: 'shout', look: 1, legL: [-1, 0], legR: [2, 0], sway: -0.5 }, o);
    const wag = cyc(t, 7, 2) ? 1 : -1;
    return make({ armR: [5 + wag, -7], finger: 'R', armL: [0, 6], eyes: 'angry', mouth: cyc(t, 3, 2) ? 'shout' : 'flat', look: 1 }, o);
  },
  // Done: a fist pump with a hop, then the thumbs-up and a wink.
  celebrate: (t, o) => {
    if (t < 1.1) {
      const k = cyc(t, 8, 4);
      return make({ y: -[0, 2, 4, 2][k], armR: [6, -11 + cyc(t, 6, 2)], armL: [-3, 4], eyes: 'squeeze', mouth: 'laugh', sway: [0, 0.4, 0.8, 0.4][k] }, o);
    }
    return make({ armR: [4, -3], thumb: 'R', armL: [-2, 6], eyes: 'wink', mouth: 'grin', headX: 1 }, o);
  },
  sleep: (t, o) => {
    // The genie yawns, streams back into its lamp and sleeps in there, puffing out of the spout.
    if (o.character === 'genie') {
      if (t < 0.6) return make({ eyes: 'sleep', mouth: 'o', armL: [-4, -6], armR: [4, -6], y: t < 0.3 ? -1 : 0 }, o);
      if (t < 0.85) return make({ lamp: 1 }, o);
      if (t < 1.1) return make({ lamp: 2 }, o);
      return make({ lamp: 3, snore: cyc(t, 0.6, 2) === 1 }, o);
    }
    if (o.character === 'puppy') return puppyBedtime(t, o);
    return make({ sit: 'floor', headY: 2 + cyc(t, 0.6, 2), eyes: 'sleep', mouth: 'o', armL: [4, 6], armR: [-3, 6], legL: [0, 0], legR: [0, 0] }, o);
  },
  wave: (t, o) => make({ armR: cyc(t, 5, 2) ? [4, -8] : [6, -7], eyes: 'happy', mouth: 'laugh' }, o),
  poked: (t, o) => make({ y: cyc(t, 12, 2) ? -1 : 0, eyes: 'squeeze', mouth: 'laugh', blush: true, armL: [-1, 4], armR: [1, 4] }, o),
};

// ── the cat ────────────────────────────────────────────────────────────────
//
// Miso does everything the way a real cat does: it walks on four paws with its tail up, sits with
// the tail wrapped round its feet, washes a paw, loafs, swats, and naps curled nose-to-tail. The
// jobs the others do with their hands, it does with a paw.

/** Seconds into the nap when the cat is curled up asleep (the z's start then). */
export const CAT_NAP = 2.4;

const kitty = (over: Partial<Pose>, cat: CatPose, o: AnimOptions, own: Gear[] = []): Pose => make({ blush: false, mouth: 'cat', ...over, cat }, o, own);

/** A walk: the diagonal pairs step together (near front with far back), each foot forward, back, lifted. */
const catSteps = (k: number, stride = 2): [number, number][] => {
  const cycle: [number, number][] = [[stride, 0], [0, 0], [-stride, 0], [0, 2]];
  const at = (shift: number) => cycle[(k + shift) % 4];
  return [at(0), at(2), at(2), at(0)];
};
/** A gallop: both front paws reach together, then both back ones. */
const gallop = (k: number): [number, number][] => {
  const cycle: [number, number][] = [[4, 1], [1, 0], [-3, 0], [0, 3]];
  const front = cycle[k];
  const rear = cycle[(k + 2) % 4];
  return [front, [front[0] - 1, front[1]], rear, [rear[0] - 1, rear[1]]];
};
/** Tail up with a hook at the tip: a pleased cat. */
const tailUp = (t: number): CatTail => ({ a: 78 + cyc(t, 2, 2) * 4, curl: 0.7 });
/** Tail wrapped round the paws, the tip flicking now and then. */
const tailWrapped = (t: number): CatTail => ({ wrap: true, flick: t % 2.6 > 2.3 ? 2 : t % 2.6 > 2 ? 1 : 0 });

/** It notices the job: sits up, eyes wide, tail straight up. */
const catNotice = (t: number, o: AnimOptions, gear: Gear[]): Pose | null =>
  t < 0.34 ? kitty({ y: t < 0.1 ? -2 : 0, eyes: 'wide', mouth: 'o' }, { body: 'sit', tail: { a: 88, curl: 0.3 } }, o, gear) : null;

const CAT_ANIMS: Record<AnimName, AnimFn> = {
  idle: (t, o) => {
    const cycle = t % 11;
    // Every so often it washes: a paw up to the mouth, a few licks.
    if (cycle > 8 && cycle < 9.6) {
      const lick = cyc(t, 5, 2);
      return kitty({ eyes: 'happy', mouth: lick ? 'tongue' : 'cat', headY: 1 }, { body: 'sit', tail: tailWrapped(t), raise: [2, -6 - lick] }, o);
    }
    const look: Pose['look'] = cycle > 5 && cycle < 6.2 ? 1 : cycle > 6.5 && cycle < 7.4 ? -1 : 0;
    return kitty({ headY: cyc(t, 1.2, 2), look, eyes: t % 4.3 > 4 ? 'happy' : blinking(t) }, { body: 'sit', tail: tailWrapped(t) }, o);
  },
  walk: (t, o) => {
    const k = cyc(t, 8, 4);
    return kitty({ headY: k % 2, eyes: blinking(t) }, { body: 'stand', paws: catSteps(k), tail: tailUp(t) }, o);
  },
  run: (t, o) => {
    const k = cyc(t, 12, 4);
    return kitty({ y: -[0, 1, 2, 1][k], eyes: 'focus', headX: 1 }, { body: 'stand', paws: gallop(k), tail: { a: 12 + k * 3 }, earsBack: true }, o);
  },
  jump: (_t, o) => kitty({ eyes: 'wide', mouth: 'o' }, { body: 'leap', tail: { a: 25, curl: 0.3 } }, o),
  fall: (t, o) => {
    const k = cyc(t, 10, 2);
    return kitty({ eyes: 'wide', mouth: 'open' }, { body: 'leap', paws: [[5, 7 - k], [3, 6 + k], [-5, 7 - k], [-3, 6 + k]], tail: { a: 70 + k * 10, curl: k ? 0.6 : -0.6 } }, o);
  },
  land: (t, o) => kitty({ y: t < 0.12 ? 3 : t < 0.24 ? 1 : 0, eyes: t < 0.2 ? 'squeeze' : 'open', mouth: 'o' }, { body: 'stand', tail: { a: 40 } }, o),
  dizzy: (t, o) => kitty({ headX: [-1, 0, 1, 0][cyc(t, 4, 4)], eyes: 'dizzy', mouth: 'wavy', sway: [-0.5, 0, 0.5, 0][cyc(t, 4, 4)] }, { body: 'sit', tail: { a: 60 + cyc(t, 4, 2) * 20, curl: -0.4 } }, o),

  // Research: glasses on, sat at a laptop, tapping at the keys with one paw, reading, and every so
  // often a paw up at what it found.
  research: (t, o) => {
    const intro = catNotice(t, o, ['glasses']);
    if (intro) return intro;
    const k = cyc(t, 10, 2);
    const reading = t % 5 > 3.6;
    if (t % 11 > 9.6) return kitty({ eyes: 'wide', mouth: 'open', look: 1 }, { body: 'sit', tail: { a: 85, curl: 0.8 }, desk: 'laptop', deskPhase: 1, raise: [11, -7] }, o, ['glasses']);
    return kitty({
      eyes: reading ? blinking(t) : 'focus', look: 1, mouth: reading ? 'cat' : 'flat', headY: reading ? 0 : cyc(t, 1.4, 2),
    }, { body: 'sit', tail: tailWrapped(t), desk: 'laptop', deskPhase: cyc(t, 2, 2), raise: reading ? undefined : [9, 6 + k] }, o, ['glasses']);
  },
  // Cutting: claws out, a swipe down at the clip three times a second.
  cut: (t, o) => {
    const k = cyc(t, 3, 2);
    return kitty({ eyes: k ? 'angry' : 'focus', mouth: k ? 'open' : 'cat', look: 1 }, { body: 'stand', tail: { a: 30 + k * 12 }, raise: k ? [11, 6] : [11, -4], claws: true, earsBack: !!k }, o);
  },
  // A new clip: carried in by the mouth, trotting, tail up.
  carry: (t, o) => {
    const k = cyc(t, 8, 4);
    return kitty({ headY: k % 2, eyes: blinking(t) }, { body: 'stand', paws: catSteps(k), tail: tailUp(t), carry: { color: o.color ?? '#6fa8ff', drop: 0 } }, o);
  },
  place: (t, o) => {
    const p = Math.min(1, t / 0.35);
    const done = t > 0.45;
    return kitty({ y: done ? 0 : Math.round(p * 3), headY: done ? 0 : Math.round(p * 3), eyes: done ? 'happy' : 'focus' }, {
      body: 'stand', tail: done ? tailUp(t) : { a: 40 }, carry: done ? undefined : { color: o.color ?? '#6fa8ff', drop: p },
    }, o);
  },
  // Deleting: what cats do best — a look, a slow paw, and it goes off the edge. Then a smug sit.
  kick: (t, o) => {
    if (t < 0.25) return kitty({ eyes: 'focus', look: 1 }, { body: 'stand', tail: { a: 50, curl: 0.4 }, raise: [5, -1] }, o);
    if (t < 0.5) return kitty({ eyes: 'happy', look: 1, lean: 1 }, { body: 'stand', tail: { a: 60, curl: 0.6 }, raise: [12, 4] }, o);
    return kitty({ eyes: blinking(t, 'happy'), look: -1 }, { body: 'sit', tail: tailWrapped(t) }, o);
  },
  // Polishing: strolling along the timeline rubbing against it, purring.
  polish: (t, o) => {
    const intro = catNotice(t, o, []);
    if (intro) return intro;
    const k = cyc(t, 6, 4);
    return kitty({ headY: 1 + (k % 2), eyes: 'happy', blush: true }, { body: 'stand', paws: catSteps(k), tail: { a: 80, curl: 0.9 } }, o);
  },
  // The Audio Guru: headphones on at a mixer, head bobbing, a paw on the faders, the tail keeping time.
  mix: (t, o) => {
    const intro = catNotice(t, o, ['headphones']);
    if (intro) return intro;
    const k = cyc(t, 4, 2);
    if (t % 6 > 4.4) return kitty({ headY: cyc(t, 4, 2), eyes: 'happy', mouth: 'open' }, { body: 'sit', tail: { a: 80, curl: k ? 0.8 : -0.2 }, desk: 'mixer', deskPhase: t, raise: [11, -7 + k] }, o, ['headphones']);
    return kitty({ headY: cyc(t, 2.2, 2), eyes: t % 3 < 1.8 ? 'happy' : blinking(t, 'focus') }, { body: 'sit', tail: { wrap: true, flick: cyc(t, 2.2, 2) * 2 }, desk: 'mixer', deskPhase: t, raise: [9, 4 + k] }, o, ['headphones']);
  },
  // The Director: beret on, a paw up to frame the shot, then down on the slate.
  direct: (t, o) => {
    const intro = catNotice(t, o, ['beret']);
    if (intro) return intro;
    const phase = t % 3;
    if (phase < 1.6) return kitty({ eyes: 'wink', look: 1 }, { body: 'sit', tail: { a: 80, curl: 0.7 }, raise: [11, -8] }, o, ['beret']);
    const open = phase < 2.3;
    return kitty({ eyes: open ? 'focus' : 'squeeze', mouth: open ? 'cat' : 'open', look: 1 }, { body: 'sit', tail: tailWrapped(t), raise: open ? [11, -4] : [10, 6] }, o, ['beret']);
  },
  // The Animator: visor on, scribbling on a pad with a paw, tongue out.
  draw: (t, o) => {
    const intro = catNotice(t, o, ['visor']);
    if (intro) return intro;
    const flipping = t % 4 > 3.1;
    const zig = cyc(t, 8, 3) - 1;
    const zag = cyc(t, 5, 2);
    return kitty({ eyes: flipping ? 'happy' : 'focus', mouth: flipping ? 'cat' : 'tongue', look: 1, headY: flipping ? 0 : 1 }, {
      body: 'sit', tail: tailWrapped(t), desk: 'pad', deskPhase: t * 2, raise: flipping ? [11, -6] : [10 + zig, 7 + zag],
    }, o, ['visor']);
  },
  // Writing the reply: sat facing the chat, meowing it out.
  talk: (t, o) => {
    const k = cyc(t, 8, 4);
    return kitty({ mouth: (['open', 'cat', 'o', 'cat'] as const)[k], eyes: blinking(t), look: 1, headY: cyc(t, 3, 2), headX: cyc(t, 1.2, 2) }, { body: 'sit', tail: tailWrapped(t) }, o);
  },
  ask: (t, o) => kitty({ y: cyc(t, 2, 2) ? -1 : 0, eyes: blinking(t, 'wide'), mouth: 'o' }, { body: 'sit', tail: { a: 84, curl: 0.9 }, raise: [11, -7 + cyc(t, 3, 2)] }, o),
  think: (t, o) => kitty({
    eyes: t % 3 < 2 ? 'up' : blinking(t), look: cyc(t, 0.7, 2) ? 1 : -1, mouth: t % 3 < 2 ? 'flat' : 'cat', headX: cyc(t, 0.5, 2),
  }, { body: 'loaf', tail: { wrap: true, flick: cyc(t, 1.5, 2) * 2 } }, o),
  // Moving a clip: head down, shoving it along.
  push: (t, o) => {
    const k = cyc(t, 6, 4);
    return kitty({ headX: 1, headY: 2, eyes: 'squeeze', lean: 1 }, { body: 'stand', paws: catSteps(k, 1), tail: { a: 30 }, earsBack: true }, o);
  },
  // Tweaking: batting at it, tap tap, tongue out.
  tweak: (t, o) => {
    const k = cyc(t, 4, 2);
    return kitty({ eyes: blinking(t, 'focus'), mouth: 'tongue', look: 1 }, { body: 'stand', tail: { a: 55, curl: 0.5 }, raise: k ? [11, -3] : [12, 5] }, o);
  },
  // Picked up by the scruff: mostly limp, with a wriggle and a yowl now and then.
  dangle: (t, o) => {
    const wriggle = t % 2.4 > 1.4;
    const k = cyc(t, 10, 2);
    return kitty({ eyes: 'squeeze', mouth: wriggle ? 'open' : 'cat', blush: true, headX: wriggle ? (k ? 1 : -1) : 0, sway: wriggle ? (k ? 0.6 : -0.6) : 0 }, {
      body: 'hang', earsBack: true, tail: { a: -80 + (k ? 10 : -10), curl: 0.5 },
      paws: wriggle ? [[-2 - k, 5], [2 + k, 4], [-2, 6 + k], [2, 7 - k]] : [[0, 5], [0, 5], [-1, 6], [1, 6]],
    }, o);
  },
  // Hands off: ears back, a claws-out swat at the cursor, then a hiss.
  slap: (t, o) => {
    if (t < 0.12) return kitty({ eyes: 'angry', mouth: 'open', look: 1 }, { body: 'stand', tail: { a: 70 }, raise: [-1, -1], earsBack: true }, o);
    if (t < 0.32) return kitty({ eyes: 'angry', mouth: 'shout', look: 1, lean: 2 }, { body: 'stand', tail: { a: 75 }, raise: [13, -4], claws: true, earsBack: true }, o);
    const k = cyc(t, 7, 2);
    return kitty({ eyes: 'angry', mouth: cyc(t, 3, 2) ? 'shout' : 'flat', look: 1 }, { body: 'stand', tail: { a: 80 + k * 6, curl: k ? 0.3 : -0.3 }, earsBack: true, raise: [12, -3 + k] }, o);
  },
  // Done: a few happy hops, then sat up with a paw raised.
  celebrate: (t, o) => {
    if (t < 1.1) {
      const k = cyc(t, 8, 4);
      return kitty({ y: -[0, 3, 5, 3][k], eyes: 'squeeze', mouth: 'open' }, { body: k ? 'leap' : 'stand', paws: k ? [[3, 5], [2, 5], [-3, 5], [-2, 5]] : undefined, tail: { a: 85, curl: 0.8 } }, o);
    }
    return kitty({ eyes: 'wink', headX: 1 }, { body: 'sit', tail: { a: 84, curl: 0.9 }, raise: [11, -8] }, o);
  },
  // A long stretch and a yawn, a few kneads of the spot, a loaf, then curled up nose-to-tail, breathing.
  sleep: (t, o) => {
    if (t < 0.9) return kitty({ eyes: 'squeeze', mouth: t > 0.3 ? 'open' : 'o' }, { body: 'stretch', tail: { a: 80, curl: 0.4 } }, o);
    if (t < 1.8) {
      const k = cyc(t, 5, 2);
      return kitty({ eyes: 'happy', headY: 1 }, { body: 'stand', paws: [[k, k * 2], [1 - k, (1 - k) * 2], [0, 0], [0, 0]], tail: { a: 60, curl: 0.5 } }, o);
    }
    if (t < CAT_NAP) return kitty({ eyes: t < 2.1 ? 'blink' : 'down' }, { body: 'loaf', tail: { wrap: true } }, o);
    return kitty({ eyes: 'sleep', headY: t % 7 > 6.6 ? -1 : 0 }, { body: 'curl', breath: cyc(t, 0.6, 2), tail: { wrap: true } }, o);
  },
  wave: (t, o) => kitty({ eyes: 'happy', mouth: 'open' }, { body: 'sit', tail: { a: 84, curl: 0.9 }, raise: cyc(t, 5, 2) ? [11, -8] : [13, -6] }, o),
  poked: (t, o) => kitty({ y: cyc(t, 12, 2) ? 1 : 0, eyes: 'squeeze', blush: true }, { body: 'loaf', tail: { a: 70, curl: 0.6 }, earsBack: cyc(t, 6, 2) === 1 }, o),
};

/** The pose of `anim` at `t` seconds, stepped to the pixel frame rate. */
export function poseAt(anim: AnimName, t: number, options: AnimOptions = {}): Pose {
  return (options.character === 'cat' ? CAT_ANIMS : ANIMS)[anim](Math.floor(Math.max(0, t) * FPS) / FPS, options);
}
