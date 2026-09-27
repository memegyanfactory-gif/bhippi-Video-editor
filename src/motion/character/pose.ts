// The pose solver: timed actions → the character's pose at any moment. Pure and closed-form (no
// state carried between frames), so every frame renders the same in a scrub and the export.
// Charts are the MDS film's (reports/HO3VEhvobCQ.md §4): hop 2/1/7/2 + contact 2 + squash 6, leap
// 3/1/8/4 + 0.83 → 0.55 squash, blink half-closed-closed-half + a rounder open, sneak 12 f a step,
// run 6 f a step leaning 21°, idles as dead holds broken by short bursts, the rig on twos.
import { ease } from '../anim';
import type { Vec } from '../types';
import { STUDIO_KIND, STUDIO_RIG, STUDIO_SCALE, type CharacterAction, type CharacterData, type CharacterKind, type CharacterPalette, type Mouth, type Pose, type StudioMotionFrame, type StudioMotionSettings, type StudioSpec } from './types';

const F = 1 / 30;

/** Proportions of each base character, in character px. */
export type Rig = {
  hip: number;       // hip height above the ground
  chest: number;     // shoulder line height
  neck: number;      // head base height
  shoulderX: number;
  hipX: number;
  upperArm: number;
  lowerArm: number;
  thigh: number;
  shin: number;
  armWidth: number;
  legWidth: number;
  head: [number, number];
};

export const RIGS: Record<CharacterKind, Rig> = {
  'dome-kid': { hip: 150, chest: 292, neck: 300, shoulderX: 58, hipX: 26, upperArm: 70, lowerArm: 70, thigh: 78, shin: 72, armWidth: 17, legWidth: 20, head: [210, 92] },
  'shape-buddy': { hip: 70, chest: 160, neck: 250, shoulderX: 118, hipX: 42, upperArm: 42, lowerArm: 40, thigh: 36, shin: 34, armWidth: 16, legWidth: 18, head: [260, 250] },
  'flat-corporate': { hip: 210, chest: 390, neck: 404, shoulderX: 62, hipX: 26, upperArm: 88, lowerArm: 84, thigh: 104, shin: 104, armWidth: 20, legWidth: 24, head: [104, 118] },
};

export const PALETTES: Record<CharacterKind, CharacterPalette> = {
  'dome-kid': { skin: '#ffd6b8', top: '#f2a93b', bottom: '#2f3350', shoe: '#1b1d2c', hair: '#3a2a22', line: '#1b1d2c', accent: '#ffffff', eye: '#ffffff', pupil: '#1b1d2c', mouth: '#5a2330' },
  'shape-buddy': { skin: '#7b61ff', top: '#7b61ff', bottom: '#5a44d6', shoe: '#3b2c9e', hair: '#5a44d6', line: '#2a1f6b', accent: '#ffd166', eye: '#ffffff', pupil: '#16123a', mouth: '#2a1f6b' },
  'flat-corporate': { skin: '#e8b48e', top: '#4c6ef5', bottom: '#2b2d42', shoe: '#1a1b26', hair: '#2b1d16', line: '#1a1b26', accent: '#ffffff', eye: '#ffffff', pupil: '#1a1b26', mouth: '#7a2e3a' },
};

/** Hands hang, feet stand under the hips. */
/** The rig a character's actions are timed on: its own, or for a library character the one it borrows. */
export const rigKind = (kind: CharacterData['kind']): CharacterKind => (kind === STUDIO_KIND ? STUDIO_RIG : kind);

export function restPose(kind: CharacterKind, data: Pick<CharacterData, 'expression' | 'facing'> = {}): Pose {
  const r = RIGS[kind];
  const reach = (r.upperArm + r.lowerArm) * 0.93;
  return {
    x: 0, y: 0, lean: 0, squash: 1, headTilt: 0, headDip: 0, turn: 0,
    hands: [[-10, reach], [10, reach]],
    feet: [[-4, r.hip - 2], [4, r.hip - 2]],
    eyes: 1, look: [0, 0], expression: data.expression ?? 'normal', mouth: 'rest', facing: data.facing ?? 1,
  };
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec, b: Vec, t: number): Vec => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Weight of an action at local time `a` of `d`: in over `inS`, out over `outS`. */
const envelope = (a: number, d: number, inS = 4 * F, outS = 5 * F) => Math.min(clamp01(a / inS), clamp01((d - a) / outS));

/** Piecewise keys over frames: [[frame, value], …] sampled at local seconds `a` (linear between, eased with `e`). */
function chart(a: number, keys: [number, number][], e: Parameters<typeof ease>[0] = 'ease-in-out'): number {
  const f = a / F;
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, v0] = keys[i];
    const [f1, v1] = keys[i + 1];
    if (f <= f1) return lerp(v0, v1, ease(e, (f - f0) / Math.max(1e-6, f1 - f0)));
  }
  return keys[keys.length - 1][1];
}

const VISEME: Record<string, Mouth> = { a: 'A', i: 'A', e: 'E', o: 'O', u: 'O', w: 'O', m: 'M', b: 'M', p: 'M', f: 'F', v: 'F', l: 'L', t: 'L', d: 'L', n: 'L', th: 'L' };
/** The mouth shape at `t` for words spoken with their times. */
export function visemeAt(words: { t: number; end: number; w: string }[], t: number): Mouth {
  for (const word of words) {
    if (t < word.t || t >= word.end) continue;
    const letters = word.w.toLowerCase().replace(/[^a-z]/g, '');
    if (!letters) return 'rest';
    const i = Math.min(letters.length - 1, Math.floor(((t - word.t) / Math.max(1e-3, word.end - word.t)) * letters.length));
    const ch = letters[i];
    return VISEME[ch] ?? (/[aeiou]/.test(ch) ? 'A' : 'E');
  }
  return 'rest';
}

/** Words for `text` spread evenly over [t, t + duration] (about 2.7 words a second). */
export function wordsFromText(text: string, t: number, duration?: number): { t: number; end: number; w: string }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const total = duration ?? Math.max(0.6, words.length / 2.7);
  const weights = words.map((w) => Math.max(2, w.length));
  const sum = weights.reduce((m, w) => m + w, 0);
  let at = t;
  return words.map((w, i) => {
    const d = (weights[i] / sum) * total;
    const out = { t: at, end: at + d * 0.9, w };
    at += d;
    return out;
  });
}

const STEP_FRAMES: Record<string, number> = { walk: 14, sneak: 12, run: 6 };
const STRIDE: Record<string, number> = { walk: 70, sneak: 55, run: 120 };

/** How long an action lasts. */
export function actionDuration(action: CharacterAction): number {
  if (action.duration !== undefined) return Math.max(F, action.duration);
  switch (action.do) {
    case 'hop': return 22 * F;
    case 'leap': return 26 * F;
    case 'walk': case 'sneak': case 'run': {
      const dx = typeof action.to === 'number' ? action.to : Array.isArray(action.to) ? action.to[0] : 200;
      const steps = Math.max(2, Math.round(Math.abs(dx) / STRIDE[action.do]));
      return steps * STEP_FRAMES[action.do] * F;
    }
    case 'talk': return action.words?.length ? Math.max(...action.words.map((w) => w.end)) - action.t : action.text ? Math.max(0.6, action.text.split(/\s+/).length / 2.7) : 1.5;
    case 'surprise': return 0.9;
    case 'nod': case 'shake': return 0.7;
    case 'expression': return 0.01;
    case 'idle': return 4;
    default: return 1.3;
  }
}

/** New studio actions use the room's timing; explicit-step scenes retain their old schedules. */
export function characterActionDuration(data: Pick<CharacterData, 'kind' | 'step'>, action: CharacterAction): number {
  if (data.kind === STUDIO_KIND && data.step === undefined && typeof window !== 'undefined') {
    const motion = (window as unknown as { CharMotion?: { duration(action: CharacterAction): number } }).CharMotion;
    if (motion) return motion.duration(action);
  }
  return actionDuration(action);
}

/** Where the character has walked to by `t` (travel persists after each walk ends). */
function travelled(actions: CharacterAction[], t: number): { x: number; facing: 1 | -1 | 0 } {
  let x = 0;
  let facing: 1 | -1 | 0 = 0;
  for (const a of actions) {
    if (!['walk', 'sneak', 'run', 'leap'].includes(a.do) || t < a.t) continue;
    const dx = typeof a.to === 'number' ? a.to : Array.isArray(a.to) ? a.to[0] : a.do === 'leap' ? 0 : 200;
    const d = actionDuration(a);
    const p = a.do === 'leap' ? clamp01((t - a.t - 4 * F) / (12 * F)) : ease('ease-in-out', clamp01((t - a.t) / d));
    x += dx * p;
    if (dx) facing = dx > 0 ? 1 : -1;
  }
  return { x, facing };
}

/**
 * The exact room sampler also drives timeline roots and render parameters. It is loaded by
 * studio.ts; keeping this bridge here avoids a pose ↔ studio import cycle. Old scene targets
 * and distances remain in character pixels, while the room engine uses its own rig units.
 */
export function sampleStudioMotion(data: CharacterData, sceneT: number): StudioMotionFrame | null {
  if (data.kind !== STUDIO_KIND || !data.spec || typeof window === 'undefined') return null;
  const w = window as unknown as {
    CharMotion?: { sample(spec: StudioSpec, options: { t: number; actions: CharacterAction[]; motion?: StudioMotionSettings; seed?: number; blink?: boolean; facing?: 1 | -1; step?: 1 | 2 | 3 }): StudioMotionFrame };
    CharEngine?: { defaults(): StudioSpec };
    BhippiChars?: { to2D(spec: StudioSpec, defaults: StudioSpec): StudioSpec };
  };
  if (!w.CharMotion) return null;
  const spec = w.BhippiChars && w.CharEngine ? w.BhippiChars.to2D(data.spec, w.CharEngine.defaults()) : data.spec;
  const actions = [...(data.actions ?? [])].sort((a, b) => a.t - b.t).map((action): CharacterAction => {
    const converted = { ...action, duration: characterActionDuration(data, action) };
    if (['walk', 'run', 'sneak', 'leap'].includes(action.do)) {
      const distance = typeof action.to === 'number' ? action.to : Array.isArray(action.to) ? action.to[0] : action.do === 'leap' ? 0 : 200;
      converted.to = distance / STUDIO_SCALE;
    } else if ((action.do === 'point' || action.do === 'look') && Array.isArray(action.to)) {
      converted.to = [action.to[0] / STUDIO_SCALE, action.to[1] / STUDIO_SCALE];
    }
    return converted;
  });
  if (data.expression) actions.unshift({ t: 0, do: 'expression', expression: data.expression });
  return w.CharMotion.sample(spec, { t: sceneT, actions, motion: spec.motion2d, seed: data.seed, blink: data.blink, facing: data.facing, step: data.step });
}

export function poseAt(data: CharacterData, sceneT: number): Pose {
  const kind = rigKind(data.kind);
  const studio = sampleStudioMotion(data, sceneT);
  if (studio) {
    const pose = restPose(kind, data);
    pose.x = studio.root.x * STUDIO_SCALE;
    pose.y = studio.root.y * STUDIO_SCALE;
    pose.facing = studio.yaw < 0 ? -1 : 1;
    pose.eyes = studio.eyeOpen ?? (typeof studio.blink === 'number' ? 1 - studio.blink : studio.blink ? 0 : 1);
    return pose;
  }
  const rig = RIGS[kind];
  const step = data.step ?? 2;
  // The rig runs on twos (or threes): its clock holds each drawing for `step` frames.
  const t = step > 1 ? Math.floor(sceneT * 30 / step + 1e-6) * step / 30 : sceneT;
  const actions = [...(data.actions ?? [])].sort((a, b) => a.t - b.t);
  const pose = restPose(kind, data);
  const walk = travelled(actions, t);
  pose.x = walk.x;
  if (walk.facing) pose.facing = walk.facing;
  const reach = (rig.upperArm + rig.lowerArm) * 0.93;
  const up = rig.upperArm + rig.lowerArm;
  // How far out from its shoulder a raised hand must be to clear the side of the head.
  const headClear = Math.max(30, rig.head[0] / 2 - rig.shoulderX + 22);
  let talking = false;

  // Held expressions: the last one set before t.
  for (const a of actions) if (a.do === 'expression' && a.t <= t && a.expression) pose.expression = a.expression;

  for (const action of actions) {
    const d = actionDuration(action);
    const a = t - action.t;
    if (a < 0 || a > d) continue;
    const w = envelope(a, d);
    const side = action.hand === 'left' ? 0 : 1;
    switch (action.do) {
      case 'idle': {
        // Dead holds broken by 2–3-drawing bursts (no sine breathing).
        const beat = Math.floor(a / 1.6);
        const inBeat = a - beat * 1.6;
        const r = hash(data.seed ?? 1, beat + Math.round(action.t * 10));
        if (inBeat < 6 * F) {
          pose.headTilt += (r - 0.5) * 8;
          pose.lean += (hash(beat, 7) - 0.5) * 3;
        }
        break;
      }
      case 'wave': {
        const lift = chart(a, [[0, 0], [2, -0.15], [6, 1], [d / F - 5, 1], [d / F, 0]]);
        const swing = Math.sin(a * Math.PI * 2 * 2.6) * 26 * clamp01(lift);
        // Beside the head, never across the face.
        const target: Vec = [(side ? 1 : -1) * (headClear + 10) + swing, -up * 0.72];
        pose.hands[side] = lerpV(pose.hands[side], target, clamp01(Math.abs(lift)) * (lift < 0 ? 0 : 1));
        if (lift < 0) pose.headDip += 4;
        pose.mouth = 'smile';
        pose.headTilt += (side ? 1 : -1) * 4 * w;
        break;
      }
      case 'point': case 'look': {
        // Targets are in unmirrored character space; a character facing left draws mirrored, so aim mirrored too.
        const raw = Array.isArray(action.to) ? action.to : [300, -rig.chest];
        const to = [(raw[0] - pose.x) * pose.facing + pose.x, raw[1]];
        const shoulder: Vec = [(side ? 1 : -1) * rig.shoulderX, -rig.chest];
        const dir = [to[0] - pose.x - shoulder[0], to[1] - shoulder[1]];
        const len = Math.hypot(dir[0], dir[1]) || 1;
        if (action.do === 'point') {
          const hand = action.hand ?? (dir[0] < 0 ? 'left' : 'right');
          const s = hand === 'left' ? 0 : 1;
          const sh: Vec = [(s ? 1 : -1) * rig.shoulderX, -rig.chest];
          const dd = [to[0] - pose.x - sh[0], to[1] - sh[1]];
          const l2 = Math.hypot(dd[0], dd[1]) || 1;
          pose.hands[s] = lerpV(pose.hands[s], [(dd[0] / l2) * up * 0.97, (dd[1] / l2) * up * 0.97], w);
          pose.lean += Math.sign(dd[0]) * 5 * w;
        }
        pose.look = lerpV(pose.look, [dir[0] / len, dir[1] / len], w);
        pose.headTilt += (dir[0] / len) * 6 * w;
        break;
      }
      case 'hop': {
        // 2 crouch, 1 take-off, 7 rise + hang, 2 fall (stretch 1.24), contact 2, squash 6, recover 2.
        pose.squash *= chart(a, [[0, 1], [2, 0.95], [3, 1.08], [5, 1], [10, 1], [12, 1.24], [12.01, 0.83], [14, 0.83], [20, 0.94], [22, 1]], 'linear');
        pose.y += chart(a, [[0, 0], [3, 0], [6, -64], [10, -70], [12, 0]], 'cubic-out');
        const tuck = chart(a, [[0, 0], [3, 0], [5, 1], [10, 1], [12, 0]]);
        pose.feet[0][1] -= 26 * tuck;
        pose.feet[1][1] -= 26 * tuck;
        const armsUp = chart(a, [[0, 0], [10, 0], [12, 1], [18, 1], [22, 0]]);
        pose.hands = [lerpV(pose.hands[0], [-headClear * 0.8, -up * 0.5], armsUp), lerpV(pose.hands[1], [headClear * 0.8, -up * 0.5], armsUp)];
        break;
      }
      case 'leap': {
        // Crouch 3 (held), take-off 1 (smear), air 8, fall stretch 4 (1.7×), contact 2 (0.83), squash 2 (0.55), recover 6.
        pose.squash *= chart(a, [[0, 1], [3, 0.82], [4, 1.5], [6, 1.05], [12, 1.05], [16, 1.7], [16.01, 0.83], [18, 0.83], [20, 0.55], [26, 1]], 'linear');
        pose.y += chart(a, [[0, 0], [4, 0], [8, -150], [12, -160], [16, 0]], 'cubic-out');
        pose.lean += chart(a, [[0, 0], [3, 10], [6, 4], [16, 0], [20, 8], [26, 0]]) * pose.facing;
        const reachUp = chart(a, [[0, 0], [3, 0], [5, 1], [14, 1], [18, 0]]);
        pose.hands = [lerpV(pose.hands[0], [-headClear * 0.7, -up * 0.8], reachUp), lerpV(pose.hands[1], [headClear * 0.7, -up * 0.8], reachUp)];
        break;
      }
      case 'walk': case 'sneak': case 'run': {
        const sf = STEP_FRAMES[action.do] * F;
        const p = a / sf;
        const stride = STRIDE[action.do] * 0.5;
        const swing = Math.sin(p * Math.PI);
        const lift = Math.abs(Math.sin(p * Math.PI));
        pose.feet[0] = [pose.feet[0][0] + swing * stride, pose.feet[0][1] - (swing > 0 ? lift * 22 : 0)];
        pose.feet[1] = [pose.feet[1][0] - swing * stride, pose.feet[1][1] - (swing < 0 ? lift * 22 : 0)];
        pose.hands[0] = [pose.hands[0][0] - swing * stride * 0.6, pose.hands[0][1] - (action.do === 'run' ? 50 : 0)];
        pose.hands[1] = [pose.hands[1][0] + swing * stride * 0.6, pose.hands[1][1] - (action.do === 'run' ? 50 : 0)];
        pose.y -= lift * (action.do === 'run' ? 14 : 6);
        pose.lean += (action.do === 'run' ? 21 : action.do === 'sneak' ? 12 : 4) * pose.facing * w;
        if (action.do === 'sneak') { pose.squash *= 0.9; pose.hands = [[-34, reach * 0.5], [40, reach * 0.4]]; }
        break;
      }
      case 'celebrate': {
        const dip = chart(a, [[0, 1], [3, 0.9], [6, 1.06], [9, 1]]);
        pose.squash *= dip;
        pose.y += chart(a, [[0, 0], [4, 0], [9, -40], [14, 0]], 'cubic-out');
        const armsUp = chart(a, [[0, 0], [4, 0], [7, 1], [d / F - 5, 1], [d / F, 0]]);
        const wiggle = Math.sin(a * Math.PI * 2 * 3) * 10;
        pose.hands = [lerpV(pose.hands[0], [-headClear + wiggle, -up * 0.78], armsUp), lerpV(pose.hands[1], [headClear - wiggle, -up * 0.78], armsUp)];
        pose.expression = 'happy';
        pose.mouth = 'grin';
        break;
      }
      case 'shrug': {
        const k = w;
        pose.hands = [lerpV(pose.hands[0], [-up * 0.62, up * 0.12], k), lerpV(pose.hands[1], [up * 0.62, up * 0.12], k)];
        pose.headTilt += 9 * k;
        pose.headDip += 5 * k;
        pose.mouth = 'flat';
        pose.expression = 'unsure';
        break;
      }
      case 'nod':
        pose.headDip += Math.max(0, Math.sin((a / d) * Math.PI * 4)) * 10 * w;
        break;
      case 'shake':
        pose.turn += Math.sin((a / d) * Math.PI * 4) * 0.55 * w;
        break;
      case 'facepalm': {
        const k = chart(a, [[0, 0], [6, 1], [d / F - 6, 1], [d / F, 0]]);
        const s = action.hand === 'left' ? 0 : 1;
        pose.hands[s] = lerpV(pose.hands[s], [(s ? -1 : 1) * rig.shoulderX * 0.9, -(rig.neck - rig.chest) - rig.head[1] * 0.45], k);
        pose.headDip += 10 * k;
        pose.headTilt += -6 * k;
        if (k > 0.5) { pose.expression = 'closed'; pose.mouth = 'flat'; }
        break;
      }
      case 'surprise': {
        // A take: anticipation squash 3 f, pop up stretched, arms out, eyes wide.
        pose.squash *= chart(a, [[0, 1], [3, 0.9], [5, 1.12], [8, 1.12], [14, 1]]);
        const out = chart(a, [[0, 0], [3, 0], [5, 1], [d / F - 6, 1], [d / F, 0]]);
        pose.hands = [lerpV(pose.hands[0], [-Math.max(up * 0.8, headClear), -up * 0.3], out), lerpV(pose.hands[1], [Math.max(up * 0.8, headClear), -up * 0.3], out)];
        if (a > 3 * F) { pose.expression = 'wide'; pose.mouth = 'o'; }
        break;
      }
      case 'think': {
        const s = action.hand === 'left' ? 0 : 1;
        pose.hands[s] = lerpV(pose.hands[s], [(s ? -1 : 1) * rig.shoulderX * 0.6, -(rig.neck - rig.chest) + 6], w);
        pose.look = lerpV(pose.look, [-0.5, -0.7], w);
        pose.headTilt += 7 * w;
        pose.mouth = 'flat';
        break;
      }
      case 'type': {
        const tap = Math.floor(a * 16) % 2;
        pose.hands = [lerpV(pose.hands[0], [18, up * 0.45 - (tap ? 6 : 0)], w), lerpV(pose.hands[1], [-18, up * 0.45 - (tap ? 0 : 6)], w)];
        pose.look = lerpV(pose.look, [0, 0.6], w);
        pose.headDip += 5 * w;
        break;
      }
      case 'talk': {
        talking = true;
        const words = action.words?.length ? action.words : wordsFromText(action.text ?? 'la la la la', action.t, action.duration);
        pose.mouth = visemeAt(words, t);
        break;
      }
      case 'turn':
        pose.turn = lerp(pose.turn, Math.max(-1, Math.min(1, typeof action.amount === 'number' ? action.amount : 0.6)), w);
        break;
      case 'expression':
        break;
    }
  }

  // Blinks every few seconds: half, closed, closed, half, then a rounder open (MDS f8–12).
  if (data.blink !== false && pose.expression !== 'closed') {
    const period = 3.2;
    const k = Math.floor(t / period);
    const at = k * period + 0.4 + hash(data.seed ?? 3, k) * 1.8;
    const f = Math.floor((t - at) * 30);
    if (f >= 0 && f < 6) pose.eyes = [0.5, 0, 0, 0.5, 1.12, 1.05][f];
  }
  if (!talking && pose.mouth === 'rest' && pose.expression === 'happy') pose.mouth = 'smile';
  if (!talking && pose.mouth === 'rest' && pose.expression === 'sad') pose.mouth = 'sad';
  return pose;
}
