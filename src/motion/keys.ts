// Keyframe tracks built up from many timed events (UI actions, sequence transitions) and sorted
// at the end into an engine Prop: a static value when nothing animates it.
import type { Ease, Key, Prop, Vec } from './types';

const HOUSE: Ease = 'house';
export const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Keyframes for one property, gathered from many actions and sorted at the end. */
export class Track<T extends number | Vec> {
  keys: Key<T>[] = [];
  constructor(public base: T) {}
  key(t: number, v: T, ease?: Ease) { this.keys.push({ t: Math.max(0, round(t)), v: (typeof v === 'number' ? round(v) : (v as number[]).map(round)) as T, ...(ease ? { ease } : {}) }); return this; }
  /** base → peak (in), hold, → base (out). */
  pulse(t: number, peak: T, inS: number, hold: number, outS: number, easeIn: Ease = HOUSE, easeOut: Ease = HOUSE) {
    return this.key(t, this.base, easeIn).key(t + inS, peak).key(t + inS + hold, peak, easeOut).key(t + inS + hold + outS, this.base);
  }
  move(t: number, dur: number, from: T, to: T, ease: Ease = HOUSE) { return this.key(t, from, ease).key(t + dur, to); }
  prop(): Prop<T> {
    if (!this.keys.length) return this.base;
    const sorted = [...this.keys].sort((a, b) => a.t - b.t);
    const out: Key<T>[] = [];
    for (const key of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.t - key.t) < 1e-4) out[out.length - 1] = key.ease || !last.ease ? key : { ...key, ease: last.ease };
      else out.push(key);
    }
    return { k: out } as Prop<T>;
  }
}

