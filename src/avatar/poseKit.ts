// The small pieces every pose is built from, shared by poses.ts (Heli and the cat) and
// heroPoses.ts (the heroes), so neither imports the other.

import { REST, type Character, type Gear, type Pose } from './sprite';

export type AnimName =
  | 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'dizzy'
  | 'research' | 'cut' | 'carry' | 'place' | 'kick' | 'polish' | 'mix' | 'direct' | 'draw' | 'think' | 'talk' | 'ask' | 'push' | 'tweak'
  | 'dangle' | 'slap' | 'celebrate' | 'sleep' | 'wave' | 'poked'
  // A character's signature move (a web, a batarang, a smash…), flying between panels, and swinging on a line.
  | 'power' | 'fly' | 'swing';

export type AnimOptions = {
  /** Extra headwear for the council seat at work. */
  gear?: Gear[];
  /** Colour of the clip being carried or placed. */
  color?: string;
  /** Who plays it (Settings › Avatar); Heli when unset. */
  character?: Character;
};

export type AnimFn = (t: number, options: AnimOptions) => Pose;

export const FPS = 12;

export const cyc = (t: number, rate: number, n: number) => Math.floor(t * rate) % n;

export const make = (over: Partial<Pose>, options: AnimOptions, own: Gear[] = []): Pose => ({
  ...REST,
  ...over,
  character: options.character,
  gear: [...new Set([...own, ...(options.gear ?? []), ...(over.gear ?? [])])],
});

/** Blinks every few seconds so a still character still looks alive. */
export const blinking = (t: number, eyes: Pose['eyes'] = 'open'): Pose['eyes'] => ((t % 3.4) > 3.26 ? 'blink' : eyes);

export const walkLegs = (k: number, stride = 1): Pick<Pose, 'legL' | 'legR'> => ({
  legL: ([[stride, 0], [0, 2], [-stride, 0], [0, 0]] as [number, number][])[k],
  legR: ([[-stride, 0], [0, 0], [stride, 0], [0, 2]] as [number, number][])[k],
});

export const smooth = (u: number) => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };
export const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
