// Keyframe evaluation shared by the preview, the timeline rubber bands and the properties panel.
// Mirrors src-tauri/src/render.rs: a keyframe's easing shapes the segment that starts at it, and
// the value holds before the first and after the last keyframe.
import type { Clip, Easing, Keyframe, KeyframedProperty, Keyframes } from './types';

export const EMPTY_KEYFRAMES: Keyframes = { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] };

export const KEYFRAMED: KeyframedProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];

/** Every easing a keyframe may carry, in the order the properties panel offers them. */
export const EASINGS: Easing[] = ['linear', 'hold', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'overshoot'];

/**
 * A keyframe's curve as a function of progress 0..1 — the same polynomials `Easing::shape` in
 * src-tauri/src/project.rs turns into FFmpeg expressions, so the preview and the export agree.
 */
export function shape(easing: Easing, p: number): number {
  switch (easing) {
    case 'hold': return p >= 1 ? 1 : 0;
    case 'ease': return p * p * (3 - 2 * p);
    case 'ease-in': return p * p * p;
    case 'ease-out': return 1 - (1 - p) ** 3;
    case 'ease-in-out': return p * p * p * (p * (p * 6 - 15) + 10);
    case 'overshoot': { const q = p - 1; return 1 + q * q * (2.70158 * q + 1.70158); }
    default: return p;
  }
}

/** The value of a keyframed track at `local` seconds from the clip start, or null without keys. */
export function valueAt(keys: Keyframe[], local: number): number | null {
  if (!keys.length) return null;
  const sorted = keys.length > 1 && keys.some((key, index) => index > 0 && key.time < keys[index - 1].time) ? [...keys].sort((a, b) => a.time - b.time) : keys;
  if (local <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (local >= last.time) return last.value;
  for (let index = 0; index < sorted.length - 1; index++) {
    const a = sorted[index];
    const b = sorted[index + 1];
    if (local < b.time) {
      if (a.easing === 'hold') return a.value;
      const t = shape(a.easing, (local - a.time) / Math.max(1e-9, b.time - a.time));
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** A clip's property at timeline time `time`: its keyframes when it has any, else `fallback`. */
export function animated(clip: Clip, property: KeyframedProperty, time: number, fallback: number): number {
  return valueAt(clip.keyframes[property], time - clip.start) ?? fallback;
}

export const hasKeyframes = (clip: Clip, property?: KeyframedProperty) =>
  property ? clip.keyframes[property].length > 0 : KEYFRAMED.some((name) => clip.keyframes[name].length > 0);

/** Adds or replaces the keyframe at `time` (within half a frame). */
export function setKey(keys: Keyframe[], time: number, value: number, fps: number, easing: Keyframe['easing'] = 'linear'): Keyframe[] {
  const tolerance = 0.5 / fps;
  const rest = keys.filter((key) => Math.abs(key.time - time) >= tolerance);
  return [...rest, { time: Math.max(0, time), value, easing }].sort((a, b) => a.time - b.time);
}

export function removeKey(keys: Keyframe[], time: number, fps: number): Keyframe[] {
  const tolerance = 0.5 / fps;
  return keys.filter((key) => Math.abs(key.time - time) >= tolerance);
}

/**
 * Keyframes of a clip whose head moved by `delta` seconds (times are clip-relative). Keys that
 * fall before the new head are replaced by one key at 0 holding the value there, so the
 * animation the viewer sees does not change.
 */
export function shiftKeys(keyframes: Keyframes, delta: number): Keyframes {
  if (Math.abs(delta) < 1e-9) return keyframes;
  const out = { ...keyframes };
  for (const property of KEYFRAMED) {
    const keys = keyframes[property];
    if (!keys.length) continue;
    const moved = keys.map((key) => ({ ...key, time: key.time - delta }));
    const kept = moved.filter((key) => key.time > 1e-6);
    if (kept.length === moved.length) {
      out[property] = moved;
      continue;
    }
    const head = valueAt(keys, delta) ?? keys[0].value;
    const before = [...moved].reverse().find((key) => key.time <= 1e-6);
    out[property] = [{ time: 0, value: head, easing: before?.easing ?? 'linear' }, ...kept];
  }
  return out;
}
