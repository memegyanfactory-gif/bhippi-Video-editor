// Every animation the avatar knows, as a function from time to a pose.
//
// Time is stepped at 12 frames a second so the motion reads like hand-made pixel animation (the
// sprite moves across the screen smoothly; its drawing changes in steps). Poses only move hands,
// feet, eyes and mouth — sprite.ts draws whatever they describe.

import { CX, FEET_Y, REST, TORSO_Y, type Character, type Gear, type Pose, type Prop } from './sprite';

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
  sleep: (t, o) => make({ sit: 'floor', headY: 2 + cyc(t, 0.6, 2), eyes: 'sleep', mouth: 'o', armL: [4, 6], armR: [-3, 6], legL: [0, 0], legR: [0, 0] }, o),
  wave: (t, o) => make({ armR: cyc(t, 5, 2) ? [4, -8] : [6, -7], eyes: 'happy', mouth: 'laugh' }, o),
  poked: (t, o) => make({ y: cyc(t, 12, 2) ? -1 : 0, eyes: 'squeeze', mouth: 'laugh', blush: true, armL: [-1, 4], armR: [1, 4] }, o),
};

/** The pose of `anim` at `t` seconds, stepped to the pixel frame rate. */
export function poseAt(anim: AnimName, t: number, options: AnimOptions = {}): Pose {
  return ANIMS[anim](Math.floor(Math.max(0, t) * FPS) / FPS, options);
}
