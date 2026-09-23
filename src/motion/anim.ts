// Animated values: easing curves, keyframe interpolation and AE-style expressions.
//
// A `Prop` is one of
//   · a literal            `12` or `[960, 540]`
//   · keyframes            `{ k: [{ t: 0, v: 0, ease: 'expo-out' }, { t: 0.6, v: 100 }] }`
//   · an expression        `{ expr: 'wiggle(2, 8)', v: [960, 540] }` (with optional `k` to read)
// A key's `ease` shapes the segment that starts at it; values hold before the first key and after
// the last. Vectors interpolate per component.
import { evaluateExpression } from './expr';
import type { Animated, Ease, EaseName, Expression, Key, Prop, Vec } from './types';

// ───────────────────────── easing ─────────────────────────

/** Solves a CSS cubic-bezier(x1, y1, x2, y2) at progress `x`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  // Newton first, bisection as the fallback when the slope is flat.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - x;
    if (Math.abs(error) < 1e-6) return ((ay * t + by) * t + cy) * t;
    const slope = slopeX(t);
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const value = sampleX(t);
    if (Math.abs(value - x) < 1e-7) break;
    if (value < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

const BEZIERS: Partial<Record<EaseName, [number, number, number, number]>> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'sine-in': [0.12, 0, 0.39, 0],
  'sine-out': [0.61, 1, 0.88, 1],
  'sine-in-out': [0.37, 0, 0.63, 1],
  'cubic-in': [0.32, 0, 0.67, 0],
  'cubic-out': [0.33, 1, 0.68, 1],
  'cubic-in-out': [0.65, 0, 0.35, 1],
  'quart-in': [0.5, 0, 0.75, 0],
  'quart-out': [0.25, 1, 0.5, 1],
  'quart-in-out': [0.76, 0, 0.24, 1],
  'back-in': [0.36, 0, 0.66, -0.56],
  'back-out': [0.34, 1.56, 0.64, 1],
  'back-in-out': [0.68, -0.6, 0.32, 1.6],
};

export const EASE_NAMES: EaseName[] = ['linear', 'hold', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'sine-in', 'sine-out', 'sine-in-out', 'cubic-in', 'cubic-out', 'cubic-in-out', 'quart-in', 'quart-out', 'quart-in-out', 'expo-in', 'expo-out', 'expo-in-out', 'back-in', 'back-out', 'back-in-out', 'elastic-out', 'bounce-out', 'spring'];

/** Progress 0..1 through a segment shaped by `ease`. */
export function ease(kind: Ease | undefined, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  if (!kind || kind === 'linear') return x;
  if (Array.isArray(kind)) return cubicBezier(kind[0], kind[1], kind[2], kind[3], x);
  switch (kind) {
    case 'hold': return x >= 1 ? 1 : 0;
    case 'expo-in': return x === 0 ? 0 : 2 ** (10 * x - 10);
    case 'expo-out': return x === 1 ? 1 : 1 - 2 ** (-10 * x);
    case 'expo-in-out':
      if (x === 0 || x === 1) return x;
      return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
    case 'elastic-out': {
      if (x === 0 || x === 1) return x;
      return 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    }
    case 'bounce-out': {
      const n = 7.5625;
      const d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) { const y = x - 1.5 / d; return n * y * y + 0.75; }
      if (x < 2.5 / d) { const y = x - 2.25 / d; return n * y * y + 0.9375; }
      const y = x - 2.625 / d;
      return n * y * y + 0.984375;
    }
    case 'spring': {
      // A critically-underdamped spring settling by the end of the segment (one soft overshoot).
      const omega = 12;
      const zeta = 0.55;
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      const v = 1 - Math.exp(-zeta * omega * x) * (Math.cos(wd * x) + ((zeta * omega) / wd) * Math.sin(wd * x));
      return x >= 1 ? 1 : v;
    }
    default: {
      const bezier = BEZIERS[kind];
      return bezier ? cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], x) : x;
    }
  }
}

// ───────────────────────── values ─────────────────────────

export const isAnimated = <T>(prop: Prop<T> | undefined): prop is Animated<T> => !!prop && typeof prop === 'object' && !Array.isArray(prop) && Array.isArray((prop as Animated<T>).k) && typeof (prop as Expression<T>).expr !== 'string';
export const isExpression = <T>(prop: Prop<T> | undefined): prop is Expression<T> => !!prop && typeof prop === 'object' && !Array.isArray(prop) && typeof (prop as Expression<T>).expr === 'string';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(a: number | Vec, b: number | Vec, t: number): number | Vec {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  const va = typeof a === 'number' ? [a] : a;
  const vb = typeof b === 'number' ? [b] : b;
  const n = Math.max(va.length, vb.length);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = lerp(va[i] ?? va[va.length - 1] ?? 0, vb[i] ?? vb[vb.length - 1] ?? 0, t);
  return out;
}

const sortedCache = new WeakMap<Key<unknown>[], Key<unknown>[]>();
function sortedKeys<T>(keys: Key<T>[]): Key<T>[] {
  let sorted = sortedCache.get(keys as Key<unknown>[]) as Key<T>[] | undefined;
  if (!sorted) {
    sorted = keys.length > 1 ? [...keys].sort((a, b) => a.t - b.t) : keys;
    sortedCache.set(keys as Key<unknown>[], sorted as Key<unknown>[]);
  }
  return sorted;
}

/** The value of keyframes at time `t`. */
export function keysAt<T extends number | Vec>(keys: Key<T>[], t: number): T {
  if (!keys.length) return 0 as T;
  const sorted = sortedKeys(keys);
  if (t <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < b.t) {
      if (a.ease === 'hold') return a.v;
      const p = ease(a.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
      return mix(a.v, b.v, p) as T;
    }
  }
  return last.v;
}

/** Context expressions can read beyond the property itself. */
export type ExprContext = { seed: number; index?: number; duration?: number; inPoint?: number; outPoint?: number; width?: number; height?: number };

const DEFAULT_CTX: ExprContext = { seed: 1 };

/** A property's value at scene time `t`; `fallback` when the prop is absent. */
export function valueOf<T extends number | Vec>(prop: Prop<T> | undefined, t: number, fallback: T, ctx: ExprContext = DEFAULT_CTX): T {
  if (prop === undefined || prop === null) return fallback;
  if (typeof prop === 'number' || Array.isArray(prop)) return prop as T;
  if (isAnimated(prop)) return prop.k.length ? keysAt(prop.k, t) : fallback;
  if (isExpression(prop)) {
    const keys = prop.k;
    const base = (keys?.length ? keysAt(keys, t) : prop.v ?? fallback) as T;
    const result = evaluateExpression(prop.expr, {
      time: t,
      value: base,
      valueAtTime: (at: number) => (keys?.length ? keysAt(keys, at) : base),
      keys: keys ?? [],
      ...ctx,
    });
    if (typeof base === 'number') return (typeof result === 'number' ? result : Array.isArray(result) ? result[0] ?? base : base) as T;
    if (Array.isArray(result)) return result as T;
    if (typeof result === 'number') return (base as Vec).map(() => result) as T;
    return base;
  }
  return fallback;
}

export const num = (prop: Prop<number> | undefined, t: number, fallback: number, ctx?: ExprContext): number => {
  const value = valueOf<number | Vec>(prop as Prop<number | Vec> | undefined, t, fallback, ctx);
  return typeof value === 'number' ? value : value[0] ?? fallback;
};

export const vec = (prop: Prop<Vec> | Prop<number | Vec> | undefined, t: number, fallback: Vec, ctx?: ExprContext): Vec => {
  const value = valueOf<number | Vec>(prop as Prop<number | Vec> | undefined, t, fallback, ctx);
  if (typeof value === 'number') return fallback.map(() => value);
  if (value.length >= fallback.length) return value;
  return [...value, ...fallback.slice(value.length)];
};

/** A layer's own clock at scene time `t` (its Start Time and Time Stretch, see types.ts). */
export function layerTime(layer: { startTime?: number; timeScale?: number }, t: number): number {
  if (layer.startTime === undefined && layer.timeScale === undefined) return t;
  return (t - (layer.startTime ?? 0)) * (layer.timeScale ?? 1);
}

/** Every key time used by a prop (for UI markers and for tests). */
export function keyTimes(prop: Prop<number | Vec> | undefined): number[] {
  if (isAnimated(prop)) return prop.k.map((key) => key.t);
  if (isExpression(prop)) return (prop.k ?? []).map((key) => key.t);
  return [];
}

/** Shorthand builders for templates: `keys([0, 0, 'expo-out'], [0.6, 100])`. */
export function keys<T extends number | Vec>(...entries: [number, T, Ease?][]): Animated<T> {
  return { k: entries.map(([t, v, e]) => (e ? { t, v, ease: e } : { t, v })) };
}
