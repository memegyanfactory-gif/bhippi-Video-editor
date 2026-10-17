// How each hero moves. Everything here layers over the base animations in poses.ts: a hero
// overrides only what makes it itself — its stance, its signature strike (which stands in for
// cutting, deleting and slapping a cursor), how it travels between panels, and what it says.
//
// A strike is one timeline for every hero: wind up until FIRE_AT, release (the engine fires the
// projectile or lands the blow at that moment), then follow through. `Strike` names what the
// engine draws for it (a web, a batarang, a card, a repulsor blast…).

import type { Character, Pose, Prop } from './sprite';
import { blinking, cyc, make, walkLegs, type AnimFn, type AnimName, type AnimOptions } from './poseKit';
import type { HeroId } from './heroes';

/** When, in seconds into a strike, the blow lands or the projectile leaves the hand. */
export const FIRE_AT = 0.3;

export type Strike = 'web' | 'batarang' | 'card' | 'swipe' | 'blast' | 'smash' | 'beam' | 'arrow' | 'shield' | 'claw' | 'whirl';
export const HERO_STRIKE: Record<HeroId, Strike> = {
  spider: 'web', bat: 'batarang', jester: 'card', butler: 'swipe', ironclad: 'blast', brute: 'smash', synth: 'beam', archer: 'arrow', patriot: 'shield', panther: 'claw', chakra: 'whirl',
};

/** How a hero gets from one panel to the next. */
export type Travel = 'walk' | 'swing' | 'grapple' | 'fly' | 'leap' | 'pounce';
export const HERO_TRAVEL: Record<HeroId, Travel> = {
  spider: 'swing', bat: 'grapple', jester: 'walk', butler: 'walk', ironclad: 'fly', brute: 'leap', synth: 'fly', archer: 'walk', patriot: 'walk', panther: 'pounce', chakra: 'fly',
};

const glow = (hand: 'L' | 'R' | 'both', size: number, color: string): Prop => ({ kind: 'glow', hand, size, color });

type Own = Partial<Record<AnimName, AnimFn>>;

/** A strike for one hero, as a function of seconds since it began. */
type StrikeFn = (t: number, o: AnimOptions) => Pose;

const STRIKES: Record<HeroId, StrikeFn> = {
  // Thwip: crouch, then the wrist shooter fires.
  spider: (t, o) => {
    if (t < FIRE_AT) return make({ y: 1, lean: -1, armR: [-1, -2], armL: [-4, 4], legL: [-2, 0], legR: [2, 0], eyes: 'focus', props: [glow('R', 0.3, '#cfe4ff')] }, o);
    if (t < FIRE_AT + 0.2) return make({ y: 1, lean: 2, headX: 1, armR: [10, -4], armL: [-3, 3], finger: 'R', legL: [-2, 0], legR: [3, 0], eyes: 'angry', look: 1, props: [glow('R', 1.6, '#ffffff')] }, o);
    return make({ y: 1, lean: 1, armR: [9, -3], armL: [-3, 3], legL: [-2, 0], legR: [2, 0], eyes: 'focus', look: 1, props: [glow('R', 0.5, '#cfe4ff')] }, o);
  },
  // The batarang is wound back, then thrown.
  bat: (t, o) => {
    if (t < FIRE_AT) return make({ lean: -1, armR: [-6, -5], armL: [-3, 4], cape: 1, eyes: 'angry', mouth: 'flat', props: [{ kind: 'boomerang', angle: 200 + t * 600 }] }, o);
    if (t < FIRE_AT + 0.15) return make({ lean: 2, armR: [10, -2], armL: [-4, 3], cape: 2, eyes: 'angry', mouth: 'flat', look: 1, props: [{ kind: 'boomerang', angle: 20 }] }, o);
    return make({ lean: 1, armR: [8, -1], armL: [-3, 4], cape: 1, eyes: 'focus', mouth: 'flat', look: 1 }, o);
  },
  // A card flicked from between two fingers, then jazz hands.
  jester: (t, o) => {
    if (t < FIRE_AT) return make({ lean: -1, armR: [-3, -7], armL: [-3, 4], eyes: 'wide', props: [{ kind: 'card', flip: 0 }] }, o);
    if (t < FIRE_AT + 0.15) return make({ lean: 2, armR: [10, -3], armL: [-5, -2], eyes: 'wide', look: 1, props: [{ kind: 'card', flip: 1 }] }, o);
    return make({ armR: [7, -8], armL: [-7, -8], eyes: 'happy' }, o);
  },
  // A smooth, unhurried swipe of the silver tray.
  butler: (t, o) => {
    const tray: Prop = { kind: 'tray', steam: 0 };
    if (t < FIRE_AT) return make({ lean: -1, armL: [-7, -3], armR: [-1, 5], eyes: 'focus', props: [tray] }, o);
    if (t < FIRE_AT + 0.2) return make({ lean: 2, armL: [11, 0], armR: [-2, 5], eyes: 'focus', look: 1, props: [tray] }, o);
    return make({ armL: [6, 1], armR: [-2, 5], eyes: 'happy', mouth: 'smile', props: [tray] }, o);
  },
  // Palm up, charging, then the repulsor fires.
  ironclad: (t, o) => {
    if (t < FIRE_AT) return make({ armR: [5, -4], armL: [-5, 2], eyes: 'focus', props: [glow('R', 0.4 + t * 4, '#7df3ff')] }, o);
    if (t < FIRE_AT + 0.2) return make({ lean: 1, armR: [11, -1], armL: [-6, 2], eyes: 'angry', look: 1, props: [glow('R', 2.4, '#7df3ff')] }, o);
    return make({ armR: [10, -1], armL: [-5, 2], eyes: 'focus', look: 1, props: [glow('R', 1, '#7df3ff')] }, o);
  },
  // Both fists up and a roar, then the slam.
  brute: (t, o) => {
    if (t < FIRE_AT) return make({ y: -2, armL: [-3, -13], armR: [3, -13], eyes: 'angry', mouth: 'shout', legL: [-2, 0], legR: [2, 0], sway: 0.6 }, o);
    if (t < FIRE_AT + 0.25) return make({ y: 3, lean: 1, armL: [-2, 10], armR: [2, 10], eyes: 'angry', mouth: 'shout', legL: [-2, 0], legR: [3, 0] }, o);
    return make({ y: 2, armL: [-4, 9], armR: [4, 9], eyes: 'angry', mouth: cyc(t, 3, 2) ? 'shout' : 'flat', legL: [-2, 0], legR: [2, 0] }, o);
  },
  // Arms spread, the gem on the brow flares; a calm beam.
  synth: (t, o) => {
    if (t < FIRE_AT) return make({ y: -4, armL: [-5, 3], armR: [5, 3], legL: [0, 3], legR: [0, 3], eyes: 'wide', headY: -1, cape: 1 }, o);
    return make({ y: -4, armL: [-8, -2], armR: [8, -2], legL: [0, 3], legR: [0, 3], eyes: 'focus', headX: 1, cape: 2, mouth: 'flat' }, o);
  },
  // Draw, hold, release.
  archer: (t, o) => {
    const draw = Math.min(1, t / FIRE_AT);
    if (t < FIRE_AT) return make({ lean: -1, armR: [10, -2], armL: [Math.round(4 + draw * 6), -3], look: 1, eyes: 'focus', mouth: 'flat', legL: [-2, 0], legR: [2, 0], props: [{ kind: 'bow', draw }] }, o);
    if (t < FIRE_AT + 0.3) return make({ lean: 1, armR: [10, -2], armL: [3, 1], look: 1, eyes: 'focus', mouth: 'smile', legL: [-2, 0], legR: [2, 0], props: [{ kind: 'bow', draw: 0 }] }, o);
    return make({ armR: [8, 0], armL: [-2, 6], look: 1, eyes: 'happy', mouth: 'cat', props: [{ kind: 'bow', draw: 0 }] }, o);
  },
  // Shield back, forward, away — and caught again a moment later.
  patriot: (t, o) => {
    const shield: Prop = { kind: 'shield' };
    if (t < FIRE_AT) return make({ lean: -1, armL: [-6, -5], armR: [3, 3], eyes: 'angry', mouth: 'flat', look: 1, props: [shield] }, o);
    if (t < FIRE_AT + 0.15) return make({ lean: 2, armL: [11, -3], armR: [3, 3], eyes: 'angry', mouth: 'flat', look: 1, props: [shield] }, o);
    if (t < 1.05) return make({ lean: 1, armL: [8, -2], armR: [3, 3], eyes: 'focus', look: 1 }, o);
    return make({ armL: [3, 3], armR: [3, 5], eyes: 'happy', mouth: 'cat', props: [shield] }, o);
  },
  // A low coil, then three claws raked across.
  panther: (t, o) => {
    if (t < FIRE_AT) return make({ y: 1, lean: -2, armR: [3, -8], armL: [-4, 3], legL: [-2, 0], legR: [2, 0], eyes: 'angry', props: [{ kind: 'claws', out: 0 }] }, o);
    if (t < FIRE_AT + 0.2) return make({ y: 2, lean: 3, headX: 1, armR: [10, 6], armL: [-4, 3], legL: [-2, 0], legR: [4, 0], eyes: 'angry', look: 1, props: [{ kind: 'claws', out: 2 }] }, o);
    return make({ y: 1, lean: 1, armR: [8, 4], armL: [-4, 3], legL: [-2, 0], legR: [2, 0], eyes: 'focus', look: 1, props: [{ kind: 'claws', out: 1 }] }, o);
  },
  // Arms out and spinning, wind wrapped round (the engine squashes the sprite as it turns).
  chakra: (t, o) => make({ y: -3, armL: [-9, 0], armR: [9, 0], legL: [0, 4], legR: [0, 4], eyes: 'focus', mouth: 'open', props: [{ kind: 'whirl', phase: t }] }, o),
};

const strikeAs = (offset: number): AnimFn => (t, o) => {
  const who = o.character as HeroId;
  return STRIKES[who](t + offset, o);
};

/** Stances and moves that belong to one hero alone. */
export const HERO_ANIMS: Partial<Record<Character, Own>> = {
  spider: {
    // Always a little crouched, fingers ready, head cocked.
    idle: (t, o) => {
      const b = cyc(t, 1.4, 2);
      return make({ y: 1, headY: b, headX: cyc(t, 0.4, 2), armL: [-4, 3 + b], armR: [4, 3 + (1 - b)], legL: [-2, 0], legR: [2, 0], eyes: blinking(t), look: t % 6 > 4 ? 1 : 0 }, o);
    },
    run: (t, o) => {
      const k = cyc(t, 12, 4);
      return make({ ...walkLegs(k, 2), y: 2, lean: 3, headX: 2, armL: [-3 + [3, 0, -3, 0][k], 5], armR: [3 - [3, 0, -3, 0][k], 5], look: 1, eyes: 'focus', sway: -1 }, o);
    },
    swing: (t, o) => make({ lean: 1, armR: [4, -14], armL: [-2, -4], legL: [-2, 5], legR: [2, 4 + cyc(t, 6, 2)], eyes: 'wide', look: 1, sway: -0.6 }, o),
    celebrate: (t, o) => {
      if (t < 1.1) return make({ y: -[0, 3, 6, 3][cyc(t, 8, 4)], armL: [-7, -9], armR: [7, -9], legL: [-1, 4], legR: [1, 4], finger: 'both', eyes: 'happy' }, o);
      return make({ y: 1, armR: [9, -3], armL: [-4, 3], finger: 'R', eyes: 'wink', look: 1, props: [glow('R', 0.5, '#cfe4ff')] }, o);
    },
    // Spider sense: everything tingles.
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? -2 : 0, armL: [-6, -1], armR: [6, -1], legL: [-2, 1], legR: [2, 1], eyes: 'wide', headX: cyc(t, 12, 2) ? 1 : -1 }, o),
    think: (t, o) => make({ y: 1, armR: [-3, -6], armL: [-4, 3], headX: cyc(t, 0.5, 2), eyes: t % 3 < 2 ? 'up' : blinking(t), look: 1 }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  bat: {
    // Arms crossed, cowl low, cape hanging: the long stare.
    idle: (t, o) => make({ armL: [9, 3], armR: [-9, 4], headY: cyc(t, 0.8, 2), eyes: blinking(t, 'focus'), mouth: 'flat', look: t % 8 > 6 ? 1 : 0, cape: t % 5 > 4.4 ? 1 : 0 }, o),
    walk: (t, o) => {
      const k = cyc(t, 7, 4);
      return make({ ...walkLegs(k), y: k % 2 ? -1 : 0, armL: [9, 3], armR: [-9, 4], look: 1, eyes: 'focus', mouth: 'flat', sway: -0.5 }, o);
    },
    jump: (_t, o) => make({ legL: [-1, 3], legR: [1, 3], armL: [-6, -7], armR: [6, -7], cape: 2, eyes: 'focus', mouth: 'flat', look: 1 }, o),
    fall: (t, o) => make({ legL: [-1, 2], legR: [1, 2], armL: [-9, -3], armR: [9, -3], cape: 2, eyes: 'wide', mouth: 'flat', sway: cyc(t, 8, 2) ? 0.8 : 1 }, o),
    swing: (_t, o) => make({ lean: 1, armL: [-9, -3], armR: [10, -3], legL: [-1, 3], legR: [1, 3], cape: 2, eyes: 'focus', mouth: 'flat', look: 1 }, o),
    celebrate: (t, o) => make({ armL: [9, 3], armR: [-9, 4], cape: t < 1.1 ? 2 : 1, y: t < 1.1 ? -cyc(t, 6, 2) : 0, eyes: t < 1.1 ? 'focus' : 'wink', mouth: t < 1.1 ? 'flat' : 'cat', headX: 1 }, o),
    poked: (t, o) => make({ armL: [9, 3], armR: [-9, 4], cape: 1, eyes: cyc(t, 6, 2) ? 'angry' : 'focus', mouth: 'flat', headX: cyc(t, 4, 2) }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  jester: {
    // Hip cocked, one hand on it, the other conducting the joke.
    idle: (t, o) => {
      const b = cyc(t, 3, 2);
      return make({ headX: b ? 1 : -1, lean: b, armL: [-3, 3], armR: [4 + b, -2 - b], legL: [-1, 0], legR: [2, 0], eyes: 'wide' }, o);
    },
    celebrate: (t, o) => make({ y: -cyc(t, 8, 3), armL: [-2, 2], armR: [3, 2], headY: -1, lean: -1, eyes: 'squeeze', mouth: 'laugh', cape: 0 }, o),
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? -2 : 0, armL: [-2, 3], armR: [2, 3], headX: cyc(t, 12, 2) ? 1 : -1, eyes: 'squeeze', mouth: 'laugh' }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  butler: {
    // Upright, the tray at the ready, the other hand behind the back.
    idle: (t, o) => make({ headY: cyc(t, 1, 2) ? 0 : 0, armL: [3, 1], armR: [-1, 7], armRBack: true, eyes: blinking(t), mouth: 'smile', look: t % 9 > 6.5 ? 1 : 0, props: [{ kind: 'tray', steam: cyc(t, 1, 2) ? 1 : 2 }] }, o),
    walk: (t, o) => {
      const k = cyc(t, 6, 4);
      return make({ ...walkLegs(k, 1), armL: [3, 1], armR: [-1, 7], armRBack: true, eyes: blinking(t), mouth: 'smile', look: 1, props: [{ kind: 'tray', steam: 0 }] }, o);
    },
    // A deep, correct bow.
    celebrate: (t, o) => {
      if (t < 1.1) return make({ headY: 3, y: 2, lean: 1, armL: [3, 1], armR: [-1, 7], armRBack: true, eyes: 'happy', mouth: 'smile', props: [{ kind: 'tray', steam: 0 }] }, o);
      return make({ armL: [3, 1], armR: [-1, 7], armRBack: true, eyes: 'wink', mouth: 'smile', props: [{ kind: 'tray', steam: cyc(t, 2, 2) + 1 }] }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 8, 2) ? -1 : 0, armL: [2, 1], armR: [5, -2], finger: 'R', eyes: 'wide', mouth: 'o', props: [{ kind: 'tray', steam: 0 }] }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  ironclad: {
    // Fists on hips, chin up.
    idle: (t, o) => make({ headY: cyc(t, 1.2, 2), armL: [-4, 2], armR: [4, 2], legL: [-1, 0], legR: [1, 0], eyes: 'open', look: t % 8 > 6 ? 1 : 0, mouth: 'flat' }, o),
    fly: (t, o) => make({ lean: 2, headX: 1, y: -2, armL: [3, 3], armR: [7, 0], legL: [-2, 6], legR: [0, 5 + cyc(t, 8, 2)], look: 1, eyes: 'focus', mouth: 'flat', props: [glow('both', 0.2, '#7df3ff')] }, o),
    // The superhero landing: a knee down, one fist on the ground, then a thumbs-up.
    celebrate: (t, o) => {
      if (t < 1.1) return make({ y: cyc(t, 8, 4) < 2 ? 3 : 2, headY: 2, lean: 1, armR: [3, 9], armL: [-6, 0], legL: [-4, 0], legR: [4, 0], eyes: 'focus', mouth: 'flat', props: t < 0.6 ? [glow('both', 0.3, '#7df3ff')] : [] }, o);
      return make({ armR: [4, -3], thumb: 'R', armL: [-4, 2], eyes: 'wink', mouth: 'grin', headX: 1 }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? -1 : 0, armL: [-8, 0], armR: [8, 0], headX: cyc(t, 6, 2) ? 1 : -1, eyes: 'wide', mouth: 'o' }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  brute: {
    // Hunched, fists hanging, breathing like a bull.
    idle: (t, o) => {
      const b = cyc(t, 1.4, 2);
      return make({ y: b, headY: 1 + b, armL: [-5, 8], armR: [5, 8], legL: [-2, 0], legR: [2, 0], eyes: t % 3.4 > 3.26 ? 'blink' : 'angry', mouth: 'flat', look: t % 7 > 5.5 ? 1 : 0 }, o);
    },
    walk: (t, o) => {
      const k = cyc(t, 5, 4);
      return make({ ...walkLegs(k, 2), y: k % 2 ? 1 : 0, armL: [-5 + [2, 0, -2, 0][k], 8], armR: [5 - [2, 0, -2, 0][k], 8], look: 1, eyes: 'angry', mouth: 'flat', sway: -0.3 }, o);
    },
    run: (t, o) => {
      const k = cyc(t, 9, 4);
      return make({ ...walkLegs(k, 3), y: k % 2 ? 0 : 1, lean: 3, headX: 2, armL: [-4 + [4, 0, -4, 0][k], 6], armR: [4 - [4, 0, -4, 0][k], 6], look: 1, eyes: 'angry', mouth: 'shout', sway: -1 }, o);
    },
    jump: (_t, o) => make({ legL: [-2, 3], legR: [2, 3], armL: [-6, -3], armR: [6, -3], eyes: 'angry', mouth: 'shout', look: 1 }, o),
    celebrate: (t, o) => {
      if (t < 1.4) {
        const k = cyc(t, 6, 2);
        return make({ y: k, headY: -1, armL: k ? [3, -2] : [-2, 5], armR: k ? [-3, 5] : [2, -2], eyes: 'squeeze', mouth: 'shout', legL: [-2, 0], legR: [2, 0] }, o);
      }
      return make({ armL: [-5, 8], armR: [5, 8], eyes: 'wink', mouth: 'grin' }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 8, 2), armL: [-6, 5], armR: [6, 5], eyes: 'angry', mouth: cyc(t, 4, 2) ? 'shout' : 'flat', headX: cyc(t, 6, 2) ? 1 : -1 }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  synth: {
    // Hovering a hand above the floor, serene.
    idle: (t, o) => {
      const b = cyc(t, 0.9, 3);
      return make({ y: -3 - b, armL: [-3, 6], armR: [3, 6], legL: [0, 3], legR: [0, 3], eyes: 'open', mouth: 'flat', cape: 1, look: t % 9 > 6.5 ? 1 : 0 }, o);
    },
    walk: (t, o) => make({ y: -3 - cyc(t, 1.5, 2), armL: [-3, 6], armR: [3, 6], legL: [0, 3], legR: [0, 3], eyes: 'open', mouth: 'flat', cape: 2, look: 1, sway: -0.6 }, o),
    run: (_t, o) => make({ y: -4, lean: 2, armL: [-2, 7], armR: [2, 7], legL: [-1, 5], legR: [1, 5], eyes: 'focus', mouth: 'flat', cape: 2, look: 1, sway: -1 }, o),
    fly: (t, o) => make({ y: -5 - cyc(t, 2, 2), lean: 1, armL: [-3, 6], armR: [3, 6], legL: [0, 4], legR: [0, 4], eyes: 'open', mouth: 'flat', cape: 2, look: 1, sway: -0.8 }, o),
    celebrate: (t, o) => make({ y: -5 - (t < 1.1 ? cyc(t, 4, 2) : 0), armL: [-8, -3], armR: [8, -3], legL: [0, 4], legR: [0, 4], eyes: 'happy', mouth: 'smile', cape: 2 }, o),
    poked: (t, o) => make({ y: -4, armL: [-4, 4], armR: [4, 4], legL: [0, 3], legR: [0, 3], eyes: cyc(t, 8, 2) ? 'wide' : 'blink', mouth: 'o', headX: cyc(t, 6, 2) ? 1 : -1 }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  archer: {
    // Weight on one leg, bow low, scanning.
    idle: (t, o) => make({ headY: cyc(t, 1.2, 2), armL: [-3, 6], armR: [4, 3], legL: [-1, 0], legR: [2, 0], eyes: blinking(t, 'focus'), mouth: 'smile', look: t % 7 > 4.5 ? 1 : 0, props: [{ kind: 'bow', draw: 0 }] }, o),
    celebrate: (t, o) => {
      if (t < 1.1) return make({ y: -cyc(t, 8, 2) * 2, armR: [6, -4 + cyc(t, 8, 2)], armL: [-4, 5], eyes: 'squeeze', mouth: 'laugh', props: [{ kind: 'bow', draw: 0 }] }, o);
      return make({ armR: [4, 3], armL: [-3, 6], eyes: 'wink', mouth: 'grin', headX: 1, props: [{ kind: 'bow', draw: 0 }] }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? 1 : 0, armR: [3, 1], armL: [-3, 4], eyes: 'wide', mouth: 'o', headX: cyc(t, 6, 2) ? 1 : -1, props: [{ kind: 'bow', draw: 0 }] }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  patriot: {
    // Soldier-straight, shield on the arm.
    idle: (t, o) => make({ headY: cyc(t, 1, 2) ? 0 : 0, armL: [1, 4], armR: [2, 7], legL: [-1, 0], legR: [1, 0], eyes: blinking(t), mouth: 'smile', look: t % 9 > 6.5 ? 1 : 0, props: [{ kind: 'shield' }] }, o),
    // A crisp salute.
    celebrate: (t, o) => {
      if (t < 1.1) return make({ y: -cyc(t, 8, 2), armR: [4, -12], armL: [1, 4], eyes: 'happy', mouth: 'cat', props: [{ kind: 'shield' }] }, o);
      return make({ armR: [4, -12], armL: [1, 4], eyes: 'wink', mouth: 'grin', props: [{ kind: 'shield' }] }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? -1 : 0, armL: [4, -3], armR: [2, 6], eyes: 'wide', mouth: 'o', headX: cyc(t, 6, 2) ? 1 : -1, props: [{ kind: 'shield' }] }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  panther: {
    // Still as a held breath, one claw flexing.
    idle: (t, o) => make({ y: 1, headY: cyc(t, 1, 2), armL: [-4, 4], armR: [4, 4 + cyc(t, 0.5, 2)], legL: [-2, 0], legR: [2, 0], eyes: blinking(t, 'focus'), mouth: 'flat', look: t % 8 > 6 ? 1 : 0 }, o),
    run: (t, o) => {
      const k = cyc(t, 12, 4);
      return make({ ...walkLegs(k, 3), y: 2, lean: 4, headX: 2, armL: [-3 + [3, 0, -3, 0][k], 4], armR: [3 - [3, 0, -3, 0][k], 4], look: 1, eyes: 'focus', mouth: 'flat', sway: -1 }, o);
    },
    jump: (_t, o) => make({ lean: 2, armL: [8, 1], armR: [9, -2], legL: [-3, 3], legR: [3, 2], eyes: 'angry', mouth: 'flat', look: 1, props: [{ kind: 'claws', out: 1 }] }, o),
    // Arms crossed over the chest, head bowed.
    celebrate: (t, o) => make({ armL: [9, -1], armR: [-9, 0], headY: t < 1.1 ? 0 : 1, eyes: t < 1.1 ? 'focus' : 'sleep', mouth: 'flat' }, o),
    poked: (t, o) => make({ y: 1, armL: [-6, 0], armR: [6, -3], headX: cyc(t, 8, 2) ? 1 : -1, eyes: 'angry', mouth: 'flat', props: [{ kind: 'claws', out: 2 }] }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
  chakra: {
    // Fists on hips: a proud, golden stance.
    idle: (t, o) => make({ headY: cyc(t, 1.2, 2), armL: [-5, 2], armR: [5, 2], legL: [-1, 0], legR: [1, 0], eyes: blinking(t), mouth: 'smile', look: t % 8 > 6 ? 1 : 0, sway: 0 }, o),
    fly: (t, o) => make({ y: -4, lean: 3, headX: 1, armR: [9, -9], armL: [-2, 5], legL: [-1, 6], legR: [0, 5 + cyc(t, 8, 2)], look: 1, eyes: 'focus', mouth: 'smile', sway: -1 }, o),
    // Namaste.
    celebrate: (t, o) => {
      if (t < 1.1) return make({ y: -[0, 2, 4, 2][cyc(t, 8, 4)], armL: [8, -2], armR: [-8, -2], eyes: 'squeeze', mouth: 'laugh', sway: 0.4 }, o);
      return make({ armL: [8, -2], armR: [-8, -2], headY: 1, eyes: 'happy', mouth: 'smile' }, o);
    },
    poked: (t, o) => make({ y: cyc(t, 12, 2) ? -1 : 0, armL: [-6, 0], armR: [6, 0], headX: cyc(t, 6, 2) ? 1 : -1, eyes: 'wide', mouth: 'o' }, o),
    power: strikeAs(0),
    cut: strikeAs(0.05),
    kick: strikeAs(0.1),
    slap: strikeAs(0.15),
  },
};

/** Anims during which a hero keeps what it carries (a shield, a bow, a tray) in its hands. */
const CARRIES = new Set<AnimName>(['idle', 'walk', 'run', 'talk', 'ask', 'think', 'push', 'wave']);

/** What a hero's pose gets on top of whatever the base animation made: carried gear, the jester's laugh. */
export function heroFilter(who: Character, anim: AnimName, t: number, pose: Pose): Pose {
  switch (who) {
    case 'jester': {
      if (anim === 'sleep' || anim === 'dizzy') return pose;
      // He never stops laughing: the mouth alternates, the eyes bug and squeeze, the body bounces.
      const k = Math.floor(t * 8) % 2;
      const bounce = pose.sit || pose.y > 0 ? 0 : k ? -1 : 0;
      return {
        ...pose, mouth: k ? 'laugh' : 'shout', eyes: (['wide', 'happy', 'wide', 'squeeze'] as const)[Math.floor(t * 6) % 4],
        y: pose.y + bounce, headY: pose.headY + (k ? 0 : 1), sway: (pose.sway ?? 0) + (k ? 0.3 : -0.3),
      };
    }
    case 'patriot': return carry(pose, anim, { kind: 'shield' });
    case 'archer': return carry(pose, anim, { kind: 'bow', draw: 0 });
    case 'butler': return carry(pose, anim, { kind: 'tray', steam: 0 });
    default: return pose;
  }
}

function carry(pose: Pose, anim: AnimName, prop: Prop): Pose {
  if (!CARRIES.has(anim) || pose.sit || pose.props?.length || pose.armLBack) return pose;
  return { ...pose, props: [prop] };
}

/** Words that belong to one character; anything not listed falls back to the shared lines (brain.ts). */
export const HERO_LINES: Partial<Record<Character, Record<string, string[]>>> = {
  spider: {
    wake: ['Thwip! On it!', 'Swinging in!', 'Web ready!'], done: ['Nailed it!', 'Web-tastic!', 'All stuck!'], poked: ['Tingle tingle!', 'Hey, web sense!', 'Hehe!'],
    slap: ['No no no!', 'Web ya later!', 'Stuck on you!'], grabbed: ['Whoa! Whee!', 'Hang on!', 'Wall-crawl!'], dizzy: ['Woah...', 'Stars...'], delete: ['Yoink!', 'Thwip! Gone!'], cut: ['Thwip! Snip!'],
  },
  bat: {
    wake: ['Night falls.', 'On it.', 'Silent entry.'], done: ['Case closed.', 'Done. Quietly.', 'Justice served.'], poked: ['...', 'Hmph.', 'Not now.'],
    slap: ['Back off.', 'Hands off.', 'Not tonight.'], grabbed: ['Unhand me!', 'Put. Me. Down.', 'Undignified!'], dizzy: ['Hrm...'], delete: ['Gone.', 'Eliminated.'], cut: ['Precise.'],
  },
  jester: {
    wake: ['Hahaha! Showtime!', 'Ha! Here we go!', 'Ha ha ha!'], done: ['Ha ha! Done!', 'Punchline!', 'Hahaha! Ta-da!'], poked: ['HAHAHA!', 'Tickles! Ha!', 'Hehehe!'],
    slap: ['Hahaha NO!', 'Ha! Naughty!', 'Ha ha! Mine!'], grabbed: ['HAHAHAHA!', 'Ha ha ha stop!', 'Whee ha ha!'], stopped: ['Ha... stopped.', 'Boo! Ha!'], failed: ['Ha! Oops!', 'Ha ha... uh oh'], delete: ['Ha! Poof!', 'HA! Bye!'], cut: ['Ha! Snip!'], dizzy: ['Hahaha... woo...'],
  },
  butler: {
    wake: ['Very good.', 'At once.', 'Right away.'], done: ['Served.', 'Will that be all?', 'Impeccable.'], poked: ['I beg your pardon!', 'Really!', 'Mind the suit.'],
    slap: ['Most improper!', 'Tut tut!', 'Not the edit!'], grabbed: ['Good heavens!', 'How undignified!', 'Put me down!'], dizzy: ['Dear me...'], delete: ['Cleared.', 'Tidied away.'], ask: ['Your decision?', 'Anything else?'], cut: ['Precisely.'],
  },
  ironclad: {
    wake: ['Powering up.', 'Systems online.', 'Repulsors hot.'], done: ['Mission complete.', 'Boom. Done.', 'Flawless.'], poked: ['Watch the paint!', 'Careful!', 'Hey!'],
    slap: ['Access denied!', 'Hands off the edit!', 'Firewall up!'], grabbed: ['Whoa, easy!', 'Armour! Careful!', 'Boot jets!'], dizzy: ['Gyros... spinning'], delete: ['Blasted.', 'Vaporised.'], cut: ['Laser cut.'],
  },
  brute: {
    wake: ['Smash time!', 'Me ready!', 'Rrrgh!'], done: ['DONE!', 'Smashed it!', 'ROAR!'], poked: ['Hey!', 'Not toy!', 'Grr!'],
    slap: ['NO TOUCH!', 'Mad!', 'Hands off!'], grabbed: ['PUT DOWN!', 'RAAAH!', 'Grr! Wheee?'], dizzy: ['Head... spin...'], delete: ['SMASH!', 'Gone!'], cut: ['CHOP!'],
  },
  synth: {
    wake: ['Computing.', 'Calm. Focused.', 'Beginning.'], done: ['Complete.', 'As calculated.', 'Task resolved.'], poked: ['Curious.', 'Intriguing.', 'Hello.'],
    slap: ['Not advisable.', 'Please refrain.', 'Access denied.'], grabbed: ['Fascinating!', 'Gravity. Hm.', 'Interesting.'], dizzy: ['Recalibrating...'], delete: ['Dissolved.', 'Removed.'], cut: ['Divided.'],
  },
  archer: {
    wake: ['Locked on.', 'Target acquired.', 'Nocking.'], done: ['Bullseye!', 'Never miss.', 'Nailed it!'], poked: ['Hey!', 'Easy there.', 'Watch it.'],
    slap: ['Back off!', 'Stay clear!', 'Watch it!'], grabbed: ['Whoa!', 'Put me down!', 'Hey hey!'], dizzy: ['Seeing double...'], delete: ['Pinned. Gone.', 'Bullseye.'], cut: ['Thwip! Split.'],
  },
  patriot: {
    wake: ['Ready!', 'Shield up!', 'Moving out!'], done: ['Mission complete!', 'Good work, team!', 'All secured!'], poked: ['At ease!', 'Hey, soldier!', 'Easy!'],
    slap: ['Stand down!', 'Hands off!', 'Not on my watch!'], grabbed: ['Whoa, soldier!', 'Easy!', 'Hey now!'], dizzy: ['Back... on my feet'], delete: ['Cleared!', 'Out of here!'], cut: ['Shield cut!'],
  },
  panther: {
    wake: ['Silent. Swift.', 'Stalking.', 'Claws ready.'], done: ['Hunt complete.', 'Purrfect.', 'Quietly done.'], poked: ['Hss!', 'Mrrow?', 'Careful.'],
    slap: ['Back!', 'Claws out!', 'Not today.'], grabbed: ['Hsss!', 'Release me!', 'Unhand me!'], dizzy: ['Nine lives...'], delete: ['Shredded.', 'Gone.'], cut: ['Slash!'],
  },
  chakra: {
    wake: ['Chalo shuru!', 'Main aa gaya!', 'Taiyaar!'], done: ['Kaam ho gaya!', 'Shabash!', 'Jai ho!'], poked: ['Arre!', 'Kya hai?', 'Hehe!'],
    slap: ['Nahi nahi!', 'Door raho!', 'Haath hatao!'], grabbed: ['Arre arre!', 'Chhodo mujhe!', 'Wah wah!'], dizzy: ['Chakkar aa gaya!'], delete: ['Udd gaya!', 'Bye clip!'], cut: ['Kat gaya!'], stopped: ['Theek hai, ruk gaya'],
  },
};
