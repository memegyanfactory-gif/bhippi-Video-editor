// Overlay FX for the @funny roast mode (docs/FUNNY-MODE-PLAN.md §1.4 and §3.5): money rain, anime
// speed lines, a hearts burst, fire embers, a heavenly spotlight, confetti and a smoke "?". Each one
// is a transparent GPU scene laid over the host — shapes, expressions and effects of the motion
// engine only, so no stock footage and no licences are involved.
//
// Particles move by expressions written into the scene (`value + […]`), so a particle is one
// layer whose rest position is its `value`; the physics (linear drag, gravity, flutter) is exact at
// any frame and the scene stays small. Every random choice comes from a seeded generator, so the
// same params (and `seed`) always build the same scene, and preview and export agree.
import { seededRandom } from '../expr';
import type { Animated, Ease, Effect, Key, Layer, MotionScene, ShapeData, Vec } from '../types';
import { blurFx, glowFx, scene, unit, type KitContext } from './common';
import type { TemplateSpec } from './index';
import { FX_TEMPLATES, type FxTemplateId } from '../../lib/roast/types';

type Params = Record<string, unknown>;
type Gradient = NonNullable<ShapeData['gradient']>;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ───────────────────────── colour ─────────────────────────

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hex6(color: string): string {
  const h = color.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) return `#${h.slice(0, 3).split('').map((c) => c + c).join('')}`.toLowerCase();
  return `#${h.slice(0, 6)}`.toLowerCase();
}
const rgbOf = (color: string): [number, number, number] => {
  const h = hex6(color).slice(1);
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) || 0) as [number, number, number];
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
/** `a` → `b` by `t` (0..1), as #rrggbb. */
const mix = (a: string, b: string, t: number) => { const x = rgbOf(a); const y = rgbOf(b); return toHex(x.map((v, i) => lerp(v, y[i], t))); };
/** A colour with an alpha byte (0..1). */
const alpha = (color: string, a: number) => `${hex6(color)}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`;
const luminance = (color: string) => { const [r, g, b] = rgbOf(color).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// ───────────────────────── params ─────────────────────────

const numParam = (p: Params, key: string, fallback: number, lo = -Infinity, hi = Infinity) => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
};
const str = (p: Params, key: string, fallback: string) => (typeof p[key] === 'string' && (p[key] as string).trim() ? (p[key] as string).trim().slice(0, 6) : typeof p[key] === 'number' ? String(p[key]) : fallback);
const colourParam = (p: Params, key: string, fallback: string) => (typeof p[key] === 'string' && HEX.test((p[key] as string).trim()) ? hex6(p[key] as string) : fallback);

/**
 * A point param: `[x, y]` (or `{ x, y }`) as fractions of the frame, or canvas pixels when a value is
 * above 2. Falls back to `fallback` (fractions).
 */
function pointParam(p: Params, key: string, ctx: KitContext, fallback: [number, number]): [number, number] {
  const v = p[key];
  let xy: number[] | null = null;
  if (Array.isArray(v) && v.length >= 2) xy = [Number(v[0]), Number(v[1])];
  else if (v && typeof v === 'object' && 'x' in v && 'y' in v) xy = [Number((v as { x: unknown }).x), Number((v as { y: unknown }).y)];
  if (!xy || !xy.every(Number.isFinite)) xy = fallback;
  return [Math.abs(xy[0]) <= 2 ? xy[0] * ctx.width : xy[0], Math.abs(xy[1]) <= 2 ? xy[1] * ctx.height : xy[1]];
}

/** What every FX builder starts from. */
function setup(ctx: KitContext, params: Params, seconds: number) {
  const seed = numParam(params, 'seed', 1);
  return {
    W: ctx.width,
    H: ctx.height,
    u: unit(ctx),
    dur: numParam(params, 'seconds', numParam(params, 'duration', seconds), 0.5, 30),
    density: numParam(params, 'density', 1, 0.2, 3),
    seed,
    rng: seededRandom(seed * 7.31 + 0.5),
  };
}

// ───────────────────────── expressions and keys ─────────────────────────

/** A number for an expression: short, never in exponent form. */
const n = (v: number) => (Math.abs(v) < 1e-5 ? '0' : String(Number(v.toFixed(Math.abs(v) >= 100 ? 1 : 3))));

/**
 * Linear-drag ballistics from scene second `t0`: launched at (vx, vy) px/s, slowed by drag `k` 1/s
 * and pulled down by `g` px/s². `sway` adds a horizontal flutter that grows as the piece slows.
 */
function ballistic(t0: number, vx: number, vy: number, k: number, g: number, sway?: { amp: number; freq: number; phase: number }): string {
  const flutter = sway ? ` + ${n(sway.amp)} * (1 - exp(-2.5 * t)) * sin(${n(sway.freq)} * t + ${n(sway.phase)})` : '';
  return `var t = max(time - ${n(t0)}, 0); var e = 1 - exp(-${n(k)} * t); value + [${n(vx / k)} * e${flutter}, ${n(vy / k)} * e + ${n(g / k)} * (t - e / ${n(k)})]`;
}

/** Opacity (or any 0–peak value) that comes in, holds and goes out. */
function envelope(at: number, inDur: number, outAt: number, outDur: number, peak = 100, inEase: Ease = 'cubic-out', outEase: Ease = 'cubic-in'): Animated<number> {
  const k: Key<number>[] = [{ t: at, v: 0, ease: inEase }, { t: at + inDur, v: peak, ease: 'linear' }];
  const out = Math.max(outAt, at + inDur + 1e-3);
  k.push({ t: out, v: peak, ease: outEase }, { t: out + outDur, v: 0 });
  return { k };
}

/** Keys from `[t, v, ease?]` triples. */
/** A value turning at a steady `rate` per second from `from` across `dur` seconds (linear keys). */
const turning = (from: number, rate: number, dur: number): Animated<number> => ({ k: [{ t: 0, v: from, ease: 'linear' }, { t: dur, v: from + rate * dur }] });

/**
 * `base + amp·sin(freq·t + phase)` over [0, dur] as keys at its peaks with sine eases: the same
 * sway as the expression, editable as keyframes and far cheaper to evaluate.
 */
function swayKeys(base: number, amp: number, freq: number, phase: number, dur: number): Animated<number> {
  const at = (t: number) => base + amp * Math.sin(freq * t + phase);
  const times = [0];
  for (let k = Math.ceil((phase - Math.PI / 2) / Math.PI - 1); k < 64; k++) {
    const t = (Math.PI / 2 + k * Math.PI - phase) / freq;
    if (t > 1e-3 && t < dur - 1e-3) times.push(t);
    if (t >= dur) break;
  }
  times.push(dur);
  return { k: times.map((t, i) => ({ t: Number(t.toFixed(4)), v: Number(at(t).toFixed(3)), ease: (i === 0 ? 'sine-out' : i === times.length - 2 ? 'sine-in' : 'sine-in-out') as Ease })) };
}

const keyed = <T extends number | Vec>(...entries: [number, T, Ease?][]): Animated<T> => ({ k: entries.map(([t, v, e]) => (e ? { t, v, ease: e } : { t, v })) });

// ───────────────────────── shapes ─────────────────────────

/** A heart outline (the classic parametric heart), `size` px wide, as path points. */
function heartPoints(size: number, steps = 44): number[] {
  const pts: number[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const x = 16 * Math.sin(a) ** 3;
    const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
    // x ∈ [-16, 16], y ∈ [-17, 12] (y up): fit into size × size*0.92, y down.
    pts.push(((x + 16) / 32) * size, ((12 - y) / 29) * size * 0.92);
  }
  return pts.map((v) => Number(v.toFixed(2)));
}

/** A four-point sparkle (thin star), `size` px across. */
function sparklePoints(size: number, waist = 0.16): number[] {
  const c = size / 2;
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const r = i % 2 === 0 ? c : c * waist;
    pts.push(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  return pts.map((v) => Number(v.toFixed(2)));
}

const radial = (w: number, h: number, stops: [number, string][], centre: Vec = [w / 2, h / 2], radius = Math.max(w, h) / 2): Gradient => ({ kind: 'radial', stops, from: centre, to: [centre[0] + radius, centre[1]] });
const linear = (from: Vec, to: Vec, stops: [number, string][]): Gradient => ({ kind: 'linear', stops, from, to });

/** A soft round dot (a mote, a bokeh ember): opaque core fading to nothing at the rim. */
const softDot = (id: string, d: number, color: string, extra: Partial<Layer> = {}): Layer => ({
  id,
  type: 'shape',
  shape: { shape: 'ellipse', size: [d, d], fill: null, gradient: radial(d, d, [[0, alpha(color, 1)], [0.35, alpha(color, 0.9)], [0.7, alpha(color, 0.35)], [1, alpha(color, 0)]]) },
  ...extra,
} as Layer);

function fxScene(ctx: KitContext, id: FxTemplateId, dur: number, seed: number, params: Params, layers: Layer[], cues: MotionScene['cues'] = []): MotionScene {
  return scene(ctx, dur, layers, { background: null, seed, cues, template: { id, params: { ...params } } });
}

// ───────────────────────── money rain ─────────────────────────

/**
 * Banknotes tumbling down in three depths: far notes small, soft and slow; near notes big, fast,
 * motion-blurred and casting a shadow. Each note is paper with a printed border, a dark medallion
 * and a dashed guilloche frame, turning in 3D as it flutters down.
 */
export function moneyRain(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 2.5);
  const ink = colourParam(params, 'tint', '#2e6b3a');
  const paper = mix(ink, '#f5f8ee', 0.86);
  const paperShade = mix(ink, '#e9efe0', 0.62);
  const rim = mix(ink, paper, 0.3);
  const total = Math.max(4, Math.round(30 * density));
  const tiers = [
    { share: 0.4, scale: 0.55, speed: [0.36, 0.48], blur: 2.2, opacity: 78, face: false, shadow: false, blurMotion: false },
    { share: 0.35, scale: 1, speed: [0.5, 0.66], blur: 0, opacity: 97, face: true, shadow: false, blurMotion: true },
    { share: 0.25, scale: 1.6, speed: [0.64, 0.86], blur: 0, opacity: 100, face: true, shadow: true, blurMotion: true },
  ];
  const layers: Layer[] = [];
  let index = 0;
  tiers.forEach((tier, tierIndex) => {
    const count = Math.max(1, Math.round(total * tier.share));
    for (let j = 0; j < count; j++, index++) {
      const s = tier.scale * lerp(0.88, 1.12, rng());
      const w = 170 * u * s;
      const h = 72 * u * s;
      const speed = lerp(tier.speed[0], tier.speed[1], rng()) * H;
      // Front-loaded entries: the frame fills fast, then notes keep arriving until ~80% of the clip.
      const enterBy = Math.pow(rng(), 1.35) * dur * 0.8;
      const x0 = lerp(-0.04, 1.04, (j + rng()) / count) * W;
      const y0 = -h * 0.9 - enterBy * speed;
      const sway = { amp: lerp(14, 46, rng()) * u * s, freq: lerp(1.8, 4.2, rng()), phase: rng() * TAU };
      const drift = (rng() - 0.5) * 70 * u;
      const tumble = rng() < 0.5;
      const id = `bill-${index}`;
      const opacity = envelope(0, 0.01, dur - 0.3, 0.3, tier.opacity);
      const effects: Effect[] = [];
      if (tier.blur) effects.push(blurFx(tier.blur * u));
      if (tier.shadow) effects.push({ type: 'drop-shadow', distance: 16 * u, softness: 22 * u, opacity: 32, direction: 160, color: '#000000' });
      layers.push({
        id,
        name: `Note ${index + 1}`,
        type: 'shape',
        threeD: true,
        motionBlur: tier.blurMotion,
        transform: {
          position: { expr: `value + [${n(drift)} * time + ${n(sway.amp)} * sin(${n(sway.freq)} * time + ${n(sway.phase)}), ${n(speed)} * time]`, v: [x0, y0, 0] },
          rotation: swayKeys((rng() - 0.5) * 90, lerp(14, 34, rng()), sway.freq, sway.phase + 1.2, dur),
          rotationX: tumble ? turning(rng() * 360, (rng() < 0.5 ? -1 : 1) * lerp(150, 380, rng()), dur) : swayKeys(0, lerp(35, 70, rng()), lerp(2.5, 5, rng()), rng() * TAU, dur),
          rotationY: swayKeys(0, lerp(20, 55, rng()), lerp(1.5, 3.5, rng()), rng() * TAU, dur),
          opacity,
        },
        shape: {
          shape: 'rect',
          size: [w, h],
          radius: 2.5 * u * s,
          fill: null,
          // Printed end panels (hard stops) either side of a lighter centre.
          gradient: linear([0, 0], [w, 0], [[0, paperShade], [0.07, paperShade], [0.071, mix(paper, ink, 0.1)], [0.2, paper], [0.5, mix(paper, '#ffffff', 0.35)], [0.8, paper], [0.929, mix(paper, ink, 0.1)], [0.93, paperShade], [1, paperShade]]),
          stroke: rim,
          strokeWidth: 2.2 * u * s,
        },
        effects,
        note: tierIndex === 0 ? 'Far note: small, defocused, slow (parallax).' : tierIndex === 2 ? 'Near note: big, fast, motion-blurred, casting a shadow.' : undefined,
      } as Layer);
      if (!tier.face) continue;
      const fw = w * 0.9;
      const fh = h * 0.8;
      layers.push({
        id: `${id}-print`,
        name: `Note ${index + 1} print`,
        type: 'shape',
        threeD: true,
        parent: id,
        motionBlur: tier.blurMotion,
        transform: { position: [w / 2, h / 2, 0], opacity },
        shape: {
          shape: 'rect',
          size: [fw, fh],
          radius: 1.5 * u * s,
          fill: null,
          // The portrait medallion: a dark oval with a lighter core, clear outside it.
          gradient: radial(fw, fh, [[0, mix(ink, paper, 0.5)], [0.5, mix(ink, paper, 0.25)], [0.8, alpha(ink, 0.92)], [0.86, alpha(mix(ink, paper, 0.4), 0.5)], [0.9, alpha(paper, 0)], [1, alpha(paper, 0)]], [fw / 2, fh / 2], fh * 0.4),
          stroke: alpha(ink, 0.6),
          strokeWidth: 1.4 * u * s,
          dash: [5 * u * s, 2.2 * u * s],
        },
      } as Layer);
      // The denomination in two corners of the near notes.
      if (!tier.shadow) continue;
      for (const [cx, cy, align] of [[0.075, 0.24, 'left'], [0.925, 0.76, 'right']] as const) {
        layers.push({
          id: `${id}-value-${align}`,
          name: `Note ${index + 1} value`,
          type: 'text',
          threeD: true,
          parent: id,
          motionBlur: tier.blurMotion,
          transform: { position: [w * cx, h * cy, 0], opacity },
          text: { text: str(params, 'value', '100'), font: 'Arial Black', size: 15 * u * s, weight: 900, color: alpha(ink, 0.88), align, tracking: -2 },
        } as Layer);
      }
    }
  });
  return fxScene(ctx, 'fx-money-rain', dur, seed, params, layers, [{ at: 0, sound: 'chime', note: 'cash register / coins' }]);
}

// ───────────────────────── speed lines ─────────────────────────

/**
 * One frame of manga emphasis lines: thin wedges from beyond the frame edge towards the focus, as
 * a single path (a keyhole polygon: the notched inner loop minus an outer loop outside the frame).
 */
function speedLinePath(W: number, H: number, O: [number, number], count: number, rng: () => number): number[] {
  const corner = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - O[0], y - O[1])));
  const rOut = corner * 1.08;
  const rFar = corner * 1.8;
  const at = (r: number, a: number) => [O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r];
  const inner: number[] = [];
  const first = { a: 0, d: 0 };
  const spacing = TAU / count;
  for (let i = 0; i < count; i++) {
    // Neighbours never overlap (an overlap would cut a hole where two wedges cross).
    const a = (i + 0.5 + (rng() - 0.5) * 0.5) * spacing;
    // Mostly hairlines, a few thick strokes.
    const d = Math.min(0.24 * spacing, ((0.18 + Math.pow(rng(), 2.2) * 1.5) * Math.PI) / 180);
    // The clear area is an ellipse the shape of the frame; tips stop at varied depths inside it.
    const reach = lerp(0.2, 0.47, Math.pow(rng(), 0.8));
    const tip = [O[0] + Math.cos(a) * W * reach, O[1] + Math.sin(a) * H * (reach + 0.05)];
    if (i === 0) Object.assign(first, { a, d });
    inner.push(...at(rOut, a - d), ...tip, ...at(rOut, a + d));
  }
  const start = first.a - first.d;
  const outer = [0, -1, -2, -3, -4].flatMap((q) => at(rFar, start + (q * TAU) / 4));
  return [...inner, ...inner.slice(0, 2), ...outer].map((v) => Number(v.toFixed(1)));
}

export function speedLines(ctx: KitContext, params: Params): MotionScene {
  const { W, H, dur, density, seed, rng } = setup(ctx, params, 1.5);
  const tint = colourParam(params, 'tint', '#ffffff');
  const O = pointParam(params, 'origin', ctx, [0.5, 0.45]);
  const vignette = numParam(params, 'vignette', 0.55, 0, 1);
  const count = Math.max(12, Math.round(52 * density));
  const corner = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - O[0], y - O[1])));
  const shade = luminance(tint) > 0.45 ? '#000000' : '#ffffff';
  const layers: Layer[] = [];
  const env = envelope(0, 0.08, dur - 0.18, 0.18, 100);
  if (vignette > 0) {
    layers.push({
      id: 'focus-vignette',
      name: 'Focus vignette',
      type: 'shape',
      transform: { position: [W / 2, H / 2], opacity: env },
      shape: { shape: 'rect', size: [W, H], fill: null, gradient: radial(W, H, [[0, alpha(shade, 0)], [0.42, alpha(shade, 0)], [0.8, alpha(shade, vignette * 0.55)], [1, alpha(shade, vignette)]], O, corner) },
    } as Layer);
  }
  // Three drawings of the lines swap every frame at 12 fps: the hand-drawn anime flicker.
  for (let set = 0; set < 3; set++) {
    const points = speedLinePath(W, H, O, count, rng);
    layers.push({
      id: `lines-${set}`,
      name: `Speed lines ${set + 1}`,
      type: 'shape',
      transform: {
        anchor: [O[0], O[1]],
        position: [O[0], O[1]],
        // Rush in from wide, then breathe a little on every drawing.
        scale: { expr: `value + 2.5 * noise(floor(time * 12) * 1.7 + ${set * 5})`, k: [{ t: 0, v: 135, ease: 'expo-out' }, { t: 0.22, v: 100 }] },
        rotation: { expr: `value + 0.8 * noise(floor(time * 12) * 2.3 + ${set * 3})`, v: 0 },
        opacity: { expr: `floor(time * 12) % 3 == ${set} ? value : 0`, k: env.k },
      },
      shape: { shape: 'path', size: [W, H], points, closed: true, fill: null, gradient: radial(W, H, [[0, alpha(tint, 0)], [0.22, alpha(tint, 0)], [0.42, alpha(tint, 0.7)], [0.62, alpha(tint, 0.96)], [1, alpha(tint, 1)]], O, corner) },
    } as Layer);
  }
  return fxScene(ctx, 'fx-speed-lines', dur, seed, params, layers, [{ at: 0, sound: 'whoosh', note: 'anime zoom whoosh' }]);
}

// ───────────────────────── hearts burst ─────────────────────────

export function heartsBurst(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 1.5);
  const pink = colourParam(params, 'tint', '#ff2e93');
  const O = pointParam(params, 'origin', ctx, [0.5, 0.55]);
  const light = mix(pink, '#ffffff', 0.72);
  const mid = mix(pink, '#ffffff', 0.25);
  const deep = mix(pink, '#5a0030', 0.35);
  const gold = '#ffd84a';
  const layers: Layer[] = [];
  const endAt = dur - 0.05;
  // The burst: a soft flash ring at the origin.
  const ring = 0.5 * Math.min(W, H);
  layers.push({
    id: 'burst-flash',
    name: 'Burst flash',
    type: 'shape',
    in: 0,
    out: Math.min(dur, 0.6),
    transform: { position: O, scale: keyed<number>([0, 15, 'expo-out'], [0.45, 130]), opacity: keyed<number>([0, 90, 'cubic-out'], [0.45, 0]) },
    shape: { shape: 'ellipse', size: [ring, ring], fill: null, gradient: radial(ring, ring, [[0, alpha(light, 0.9)], [0.35, alpha(mid, 0.5)], [0.7, alpha(pink, 0.18)], [1, alpha(pink, 0)]]) },
  } as Layer);
  const hearts = Math.max(4, Math.round(28 * density));
  for (let i = 0; i < hearts; i++) {
    const big = i < Math.ceil(hearts * 0.22);
    const size = (big ? lerp(130, 210, rng()) : lerp(48, 115, rng())) * u;
    const t0 = rng() * 0.14;
    const angle = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.55;
    const speed = lerp(900, 2100, rng()) * u * (big ? 0.75 : 1);
    const k = lerp(2.2, 3.2, rng());
    const life = Math.min(endAt - t0, lerp(0.95, 1.4, rng()));
    const id = `heart-${i}`;
    const pop = keyed<number>([t0, 0, 'back-out'], [t0 + 0.28, 100, 'linear'], [t0 + life - 0.32, 100, 'cubic-in'], [t0 + life, 55]);
    const fade = envelope(t0, 0.06, t0 + life - 0.3, 0.3, 100);
    const pts = heartPoints(size);
    layers.push({
      id,
      name: `Heart ${i + 1}`,
      type: 'shape',
      motionBlur: true,
      transform: {
        position: { expr: ballistic(t0, Math.cos(angle) * speed, Math.sin(angle) * speed, k, 820 * u, { amp: lerp(10, 30, rng()) * u, freq: lerp(4, 8, rng()), phase: rng() * TAU }), v: O },
        rotation: swayKeys((rng() - 0.5) * 50, lerp(8, 18, rng()), lerp(6, 11, rng()), rng() * TAU, dur),
        scale: pop,
        opacity: fade,
      },
      shape: { shape: 'path', size: [size, size * 0.92], points: pts, closed: true, fill: null, gradient: radial(size, size * 0.92, [[0, light], [0.16, mid], [0.55, pink], [1, deep]], [size * 0.32, size * 0.26], size * 0.82) },
      effects: big ? [{ type: 'drop-shadow', distance: 6 * u, softness: 14 * u, opacity: 30, direction: 170, color: '#5a0030' }] : [],
    } as Layer);
    if (big) {
      // The cartoon gloss on the big hearts.
      layers.push({
        id: `${id}-gloss`,
        name: `Heart ${i + 1} gloss`,
        type: 'shape',
        parent: id,
        transform: { position: [size * 0.3, size * 0.27], rotation: -38, opacity: fade },
        shape: { shape: 'ellipse', size: [size * 0.2, size * 0.11], fill: '#ffffffd0' },
      } as Layer);
    }
  }
  // Sparkles twinkle around the burst, and a few tiny dots.
  const sparkles = Math.max(3, Math.round(14 * density));
  for (let i = 0; i < sparkles; i++) {
    const size = lerp(22, 62, rng()) * u;
    const t0 = 0.05 + rng() * Math.max(0.1, dur - 0.7);
    const a = rng() * TAU;
    const r = lerp(0.08, 0.42, Math.sqrt(rng())) * Math.min(W, H);
    const x = O[0] + Math.cos(a) * r * 1.3;
    const y = O[1] + Math.sin(a) * r * 0.9 - 0.06 * H;
    const life = lerp(0.35, 0.6, rng());
    layers.push({
      id: `sparkle-${i}`,
      name: `Sparkle ${i + 1}`,
      type: 'shape',
      in: Math.max(0, t0 - 0.01),
      out: Math.min(dur, t0 + life + 0.02),
      transform: {
        position: { expr: `value + [${n(Math.cos(a) * 40 * u)} * (time - ${n(t0)}), ${n(Math.sin(a) * 40 * u - 30 * u)} * (time - ${n(t0)})]`, v: [x, y] },
        scale: keyed<number>([t0, 0, 'back-out'], [t0 + life * 0.45, 100, 'cubic-in'], [t0 + life, 0]),
        rotation: keyed<number>([t0, -30, 'linear'], [t0 + life, 50]),
      },
      shape: { shape: 'path', size: [size, size], points: sparklePoints(size), closed: true, fill: null, gradient: radial(size, size, [[0, '#ffffff'], [0.25, '#fff6c8'], [0.6, gold], [1, mix(gold, '#ff9f1a', 0.5)]]) },
      effects: [glowFx(10 * u, 0.8, gold)],
    } as Layer);
  }
  const dots = Math.max(2, Math.round(10 * density));
  for (let i = 0; i < dots; i++) {
    const d = lerp(7, 15, rng()) * u;
    const t0 = rng() * 0.2;
    const angle = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.8;
    const speed = lerp(700, 1600, rng()) * u;
    const life = Math.min(endAt - t0, lerp(0.7, 1.2, rng()));
    layers.push(softDot(`glint-${i}`, d, rng() < 0.5 ? '#ffffff' : gold, {
      name: `Glint ${i + 1}`,
      motionBlur: true,
      transform: {
        position: { expr: ballistic(t0, Math.cos(angle) * speed, Math.sin(angle) * speed, 3, 700 * u), v: O },
        opacity: envelope(t0, 0.05, t0 + life - 0.25, 0.25, 100),
      },
    }));
  }
  return fxScene(ctx, 'fx-hearts-burst', dur, seed, params, layers, [{ at: 0, sound: 'pop', note: 'sparkle / aww' }]);
}

// ───────────────────────── embers ─────────────────────────

export function embers(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 2.5);
  const fire = colourParam(params, 'tint', '#ff6a00');
  const hot = mix(fire, '#fff4c2', 0.7);
  const deep = mix(fire, '#b30000', 0.6);
  const palette = [mix(fire, '#ffffff', 0.78), hot, mix(fire, '#ffd166', 0.5), fire, mix(fire, '#ff2a00', 0.5)];
  const layers: Layer[] = [];
  const count = Math.max(6, Math.round(60 * density));
  for (let i = 0; i < count; i++) {
    const bokeh = i < Math.round(count * 0.1);
    const d = (bokeh ? lerp(20, 38, rng()) : 11 + Math.pow(rng(), 2) * 16) * u;
    const life = lerp(0.9, 2.1, rng());
    // Born across the whole clip, some before it starts, so the frame is alive from the first frame.
    const born = lerp(-life * 0.85, dur - 0.35, rng());
    const x0 = rng() * W;
    const y0 = lerp(0.72, 1.08, rng()) * H;
    const rise = lerp(0.2, 0.55, rng()) * H * (bokeh ? 0.7 : 1);
    const sway = { amp: lerp(8, 36, rng()) * u, freq: lerp(2.5, 7, rng()), phase: rng() * TAU };
    const drift = (rng() - 0.35) * 90 * u;
    const color = bokeh ? mix(fire, '#ffb070', 0.4) : palette[Math.floor(rng() * palette.length)];
    const from = Math.max(0, born);
    const to = Math.min(dur, born + life);
    if (to - from < 0.1) continue;
    const peak = bokeh ? 55 : lerp(85, 100, rng());
    const spark: Layer = bokeh ? softDot(`ember-${i}`, d, color) : {
      id: `ember-${i}`,
      type: 'shape',
      // A white-hot core in a coloured halo; stretched along its path it reads as a flying spark.
      shape: { shape: 'ellipse', size: [d, d], fill: null, gradient: radial(d, d, [[0, '#fffbea'], [0.22, hot], [0.5, alpha(color, 0.95)], [0.78, alpha(color, 0.35)], [1, alpha(color, 0)]]) },
    } as Layer;
    layers.push({
      ...spark,
      name: bokeh ? `Ember glow ${i + 1}` : `Ember ${i + 1}`,
      in: from,
      out: to,
      transform: {
        position: { expr: `var t = time - ${n(born)}; value + [${n(drift)} * t + ${n(sway.amp)} * sin(${n(sway.freq)} * t + ${n(sway.phase)}), -${n(rise)} * t - ${n(rise * 0.25)} * t * t]`, v: [x0, y0] },
        // Leaning into its own velocity.
        ...(bokeh ? {} : { rotation: swayKeys((Math.atan(drift / rise) * 180) / Math.PI, Math.min(40, (Math.atan((sway.amp * sway.freq) / rise) * 180) / Math.PI), sway.freq, sway.phase - born * sway.freq + Math.PI / 2, dur) }),
        scale: bokeh ? keyed<number>([born, 100, 'sine-in'], [born + life, 70]) : keyed<Vec>([born, [78, 150], 'sine-in'], [born + life, [34, 62]]),
        // Embers flicker as they cool.
        opacity: { expr: `value * (0.62 + 0.38 * noise(time * ${n(lerp(9, 16, rng()))} + ${n(rng() * 50)}))`, k: envelope(born, 0.15, born + life - 0.45, 0.45, peak).k },
      },
      ...(bokeh ? { effects: [blurFx(6 * u)] } : {}),
    } as Layer);
  }
  // The glow of the whole field: one adjustment layer instead of a glow per spark.
  layers.push({ id: 'ember-glow', name: 'Ember glow', type: 'solid', color: '#000000', adjustment: true, effects: [glowFx(16 * u, 1.6, fire)], note: 'Adjustment layer: blooms every ember below it.' } as Layer);
  // The fire tint: a hot glow rising from the bottom and a red burn at the edges, both flickering.
  const flicker = (phase: number, peak: number) => ({ expr: `value * (0.82 + 0.18 * noise(time * 4.5 + ${phase}))`, k: envelope(0, 0.35, dur - 0.4, 0.4, peak).k });
  const corner = Math.hypot(W / 2, H / 2);
  layers.push({
    id: 'edge-burn',
    name: 'Edge burn',
    type: 'shape',
    transform: { position: [W / 2, H / 2], opacity: flicker(3, 100) },
    shape: { shape: 'rect', size: [W, H], fill: null, gradient: radial(W, H, [[0, alpha(deep, 0)], [0.55, alpha(deep, 0)], [0.8, alpha(deep, 0.32)], [1, alpha(mix(deep, '#3a0000', 0.4), 0.62)]], [W / 2, H * 0.46], corner) },
  } as Layer);
  layers.push({
    id: 'heat-glow',
    name: 'Heat glow',
    type: 'shape',
    transform: { position: [W / 2, H * 0.78], opacity: flicker(11, 100) },
    shape: { shape: 'rect', size: [W, H * 0.44], fill: null, gradient: linear([0, H * 0.44], [0, 0], [[0, alpha(fire, 0.5)], [0.3, alpha(deep, 0.26)], [1, alpha(deep, 0)]]) },
  } as Layer);
  return fxScene(ctx, 'fx-embers', dur, seed, params, layers, [{ at: 0, sound: 'whoosh', note: 'fire whoosh / crackle' }]);
}

// ───────────────────────── spotlight ─────────────────────────

/** Signed area of a polygon given as `[x0, y0, x1, y1, …]` (its sign is the winding). */
function signedArea(pts: number[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

/**
 * A path layer sized to its points (clipped to the frame plus a margin), so a beam across the frame
 * rasterises only the pixels it covers. `pivot` (canvas px) becomes its anchor and position.
 */
function pathLayer(W: number, H: number, id: string, name: string, points: number[], shape: Partial<ShapeData>, pivot: Vec | null, extra: Partial<Layer> = {}): Layer {
  const m = 0.12 * Math.max(W, H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) { x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1]); }
  x0 = Math.max(x0, -m); y0 = Math.max(y0, -m); x1 = Math.min(x1, W + m); y1 = Math.min(y1, H + m);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const shift = (v: Vec): Vec => [v[0] - x0, v[1] - y0];
  const gradient = shape.gradient ? { ...shape.gradient, ...(shape.gradient.from ? { from: shift(shape.gradient.from) } : {}), ...(shape.gradient.to ? { to: shift(shape.gradient.to) } : {}) } : undefined;
  const at = pivot ?? [x0 + w / 2, y0 + h / 2];
  return {
    id,
    name,
    type: 'shape',
    ...extra,
    transform: { anchor: shift(at), position: at, ...(extra.transform ?? {}) },
    shape: { shape: 'path', closed: true, fill: null, ...shape, ...(gradient ? { gradient } : {}), size: [w, h], points: points.map((v, i) => Number((v - (i % 2 ? y0 : x0)).toFixed(1))) },
  } as Layer;
}

export function spotlight(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 3);
  const light = colourParam(params, 'tint', '#fff7e6');
  const target = pointParam(params, 'origin', ctx, [0.5, 0.32]);
  const dim = numParam(params, 'dim', 0.5, 0, 0.9);
  const apex: Vec = [target[0] + (target[0] < W / 2 ? 0.035 : -0.035) * W, -0.06 * H];
  // The beam's axis runs from the apex through the target to below the frame.
  const axis = [target[0] - apex[0], target[1] - apex[1]];
  const axisLen = Math.hypot(axis[0], axis[1]);
  const dir = [axis[0] / axisLen, axis[1] / axisLen];
  const perp = [-dir[1], dir[0]];
  const length = (H * 1.15 - apex[1]) / Math.max(0.3, dir[1]);
  const along = (L: number, side: number): number[] => [apex[0] + dir[0] * L + perp[0] * side, apex[1] + dir[1] * L + perp[1] * side];
  const spread = (numParam(params, 'spread', 13, 4, 35) * Math.PI) / 180;
  const cone = (topHalf: number, beamSpread: number): number[] => {
    const bottomHalf = topHalf + length * Math.tan(beamSpread);
    return [...along(0, -topHalf), ...along(0, topHalf), ...along(length, bottomHalf), ...along(length, -bottomHalf)].map((v) => Number(v.toFixed(1)));
  };
  const openAt = 0.05;
  const env = (peak: number) => envelope(openAt, 0.45, dur - 0.5, 0.5, peak);
  // Opens like a shutter: the cone widens from a sliver about its apex.
  const opening: Animated<Vec> = { k: [{ t: openAt, v: [12, 100], ease: 'expo-out' }, { t: openAt + 0.55, v: [100, 100] }] };
  const end = [apex[0] + dir[0] * length, apex[1] + dir[1] * length];
  const beamStops = (a: number): [number, string][] => [[0, alpha(light, a)], [0.3, alpha(light, a * 0.78)], [0.62, alpha(light, a * 0.36)], [1, alpha(light, 0)]];
  const layers: Layer[] = [];
  if (dim > 0) {
    // The room outside the beam: the frame minus the cone (a keyhole path), softened on the GPU.
    const hole = cone(W * 0.045, spread * 1.3);
    const m = 0.1 * Math.max(W, H);
    let outer = [-m, -m, W + m, -m, W + m, H + m, -m, H + m];
    if (Math.sign(signedArea(outer)) === Math.sign(signedArea(hole))) outer = [-m, -m, -m, H + m, W + m, H + m, W + m, -m];
    layers.push(pathLayer(W, H, 'surround-dim', 'Surround dim', [...outer, outer[0], outer[1], ...hole, hole[0], hole[1]], { fill: '#04050a' }, null, { transform: { opacity: env(dim * 100) }, effects: [blurFx(110 * u)] }));
  }
  const beam = (id: string, name: string, topHalf: number, beamSpread: number, a: number, blur: number): Layer =>
    pathLayer(W, H, id, name, cone(topHalf, beamSpread), { gradient: linear(apex, end, beamStops(a)) }, apex, { transform: { scale: opening, opacity: env(100) }, effects: [blurFx(blur * u)] });
  layers.push(beam('beam-wide', 'Beam (soft)', W * 0.03, spread, 0.46, 16));
  layers.push(beam('beam-core', 'Beam (core)', W * 0.016, spread * 0.5, 0.5, 7));
  // Shafts of light inside the beam, shimmering.
  for (let i = 0; i < 5; i++) {
    const off = (i - 2) * 0.36 * spread + (rng() - 0.5) * 0.12 * spread;
    const half = spread * lerp(0.035, 0.08, rng());
    const ray = (ang: number) => [apex[0] + (dir[0] * Math.cos(ang) - dir[1] * Math.sin(ang)) * length, apex[1] + (dir[0] * Math.sin(ang) + dir[1] * Math.cos(ang)) * length];
    const pts = [apex[0] - perp[0] * 2 * u, apex[1] - perp[1] * 2 * u, apex[0] + perp[0] * 2 * u, apex[1] + perp[1] * 2 * u, ...ray(off + half), ...ray(off - half)].map((v) => Number(v.toFixed(1)));
    layers.push(pathLayer(W, H, `shaft-${i}`, `Light shaft ${i + 1}`, pts, { gradient: linear(apex, [apex[0] + dir[0] * length * 0.85, apex[1] + dir[1] * length * 0.85], beamStops(0.5)) }, apex, {
      transform: { scale: opening, opacity: { expr: `value * (0.3 + 0.7 * abs(noise(time * 1.1 + ${i * 7})))`, k: env(90).k } },
      effects: [blurFx(3 * u)],
    }));
  }
  // The glow where the light lands, and the source at the top of the frame.
  const halo = 0.4 * H;
  layers.push({
    id: 'halo',
    name: 'Halo',
    type: 'shape',
    transform: { position: target, opacity: { expr: `value * (0.9 + 0.1 * sin(time * 2.2))`, k: env(80).k } },
    shape: { shape: 'ellipse', size: [halo * 1.3, halo], fill: null, gradient: radial(halo * 1.3, halo, [[0, alpha(light, 0.3)], [0.45, alpha(light, 0.12)], [1, alpha(light, 0)]], [halo * 0.65, halo / 2], halo * 0.65) },
  } as Layer);
  const source = 0.16 * W;
  layers.push({
    id: 'source',
    name: 'Light source',
    type: 'shape',
    transform: { position: [apex[0], Math.max(0, apex[1] + 0.05 * H)], scale: opening, opacity: env(100) },
    shape: { shape: 'ellipse', size: [source, source * 0.3], fill: null, gradient: radial(source, source * 0.3, [[0, '#ffffff'], [0.3, alpha(light, 0.85)], [0.7, alpha(light, 0.25)], [1, alpha(light, 0)]], [source / 2, source * 0.15], source / 2) },
    effects: [glowFx(26 * u, 0.9, light)],
  } as Layer);
  // Dust motes drifting in the light.
  const motes = Math.max(4, Math.round(34 * density));
  for (let i = 0; i < motes; i++) {
    const L = length * lerp(0.1, 0.8, rng());
    const half = (W * 0.03 + L * Math.tan(spread)) * 0.85;
    const [x, y] = along(L, (rng() * 2 - 1) * half);
    if (y < 0 || y > H) continue;
    const dm = lerp(3.5, 9, Math.pow(rng(), 2)) * u;
    layers.push(softDot(`mote-${i}`, dm, '#ffffff', {
      name: `Dust mote ${i + 1}`,
      transform: {
        position: { expr: `wiggle(0.5, ${n(16 * u)}) + [0, ${n(lerp(10, 30, rng()) * u)} * time]`, v: [x, y] },
        opacity: { expr: `value * (0.3 + 0.7 * abs(sin(time * ${n(lerp(1.5, 4, rng()))} + ${n(rng() * TAU)})))`, k: envelope(openAt + 0.3, 0.6, dur - 0.6, 0.5, lerp(60, 100, rng())).k },
      },
    }));
  }
  // A few heavenly twinkles near the target.
  for (let i = 0; i < 3; i++) {
    const size = lerp(30, 50, rng()) * u;
    const t0 = 0.6 + i * 0.55 + rng() * 0.3;
    if (t0 + 0.6 > dur) break;
    const a = rng() * TAU;
    const x = target[0] + Math.cos(a) * 0.14 * W;
    const y = target[1] + Math.sin(a) * 0.12 * H - 0.05 * H;
    layers.push({
      id: `twinkle-${i}`,
      name: `Twinkle ${i + 1}`,
      type: 'shape',
      in: t0,
      out: t0 + 0.6,
      transform: { position: [x, y], scale: keyed<number>([t0, 0, 'back-out'], [t0 + 0.25, 100, 'cubic-in'], [t0 + 0.6, 0]), rotation: keyed<number>([t0, 0, 'linear'], [t0 + 0.6, 60]) },
      shape: { shape: 'path', size: [size, size], points: sparklePoints(size, 0.12), closed: true, fill: null, gradient: radial(size, size, [[0, '#ffffff'], [0.5, alpha(light, 0.95)], [1, alpha(light, 0.6)]]) },
      effects: [glowFx(10 * u, 0.9, light)],
    } as Layer);
  }
  return fxScene(ctx, 'fx-spotlight', dur, seed, params, layers, [{ at: 0, sound: 'chime', note: 'heavenly choir / ahh' }]);
}

// ───────────────────────── confetti ─────────────────────────

const CONFETTI = ['#ff3b5c', '#ffcc2e', '#2ec4ff', '#5bff7a', '#b36bff', '#ff8a2e', '#ffffff'];

export function confetti(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 2);
  const O = pointParam(params, 'origin', ctx, [0.5, 0.62]);
  const tint = typeof params.tint === 'string' && HEX.test(params.tint.trim()) ? hex6(params.tint) : null;
  const palette = tint ? [tint, mix(tint, '#ffffff', 0.45), mix(tint, '#000000', 0.25), '#ffd23f', '#ffffff'] : CONFETTI;
  const layers: Layer[] = [];
  const piece = (id: string, name: string, color: string, position: Layer['transform'], extra: Partial<Layer> = {}): Layer => {
    const kind = rng();
    const w = lerp(18, 30, rng()) * u;
    const h = kind < 0.72 ? lerp(30, 54, rng()) * u : w;
    const shape: ShapeData = kind < 0.72
      ? { shape: 'rect', size: [w, h], radius: 1.5 * u, fill: null, gradient: linear([0, 0], [0, h], [[0, mix(color, '#ffffff', 0.25)], [1, mix(color, '#000000', 0.18)]]) }
      : kind < 0.87 ? { shape: 'ellipse', size: [w, w], fill: color } : { shape: 'polygon', sides: 3, size: [w * 1.2, w * 1.2], fill: color };
    return { id, name, type: 'shape', threeD: true, motionBlur: true, transform: position, shape, ...extra } as Layer;
  };
  const spin = () => ({
    rotation: turning(rng() * 360, (rng() - 0.5) * 520, dur),
    rotationX: turning(rng() * 360, (rng() < 0.5 ? -1 : 1) * lerp(280, 820, rng()), dur),
    rotationY: turning(rng() * 360, (rng() - 0.5) * 500, dur),
  });
  const burst = Math.max(6, Math.round(44 * density));
  for (let i = 0; i < burst; i++) {
    const t0 = rng() * 0.08;
    const angle = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.1;
    const speed = lerp(1300, 3000, rng()) * u;
    const fadeAt = lerp(dur - 0.55, dur - 0.25, rng());
    layers.push(piece(`confetti-${i}`, `Confetti ${i + 1}`, palette[Math.floor(rng() * palette.length)], {
      position: { expr: ballistic(t0, Math.cos(angle) * speed, Math.sin(angle) * speed, lerp(2.6, 3.6, rng()), lerp(560, 760, rng()) * u, { amp: lerp(20, 50, rng()) * u, freq: lerp(3, 6, rng()), phase: rng() * TAU }), v: [O[0], O[1], 0] },
      ...spin(),
      scale: keyed<number>([t0, 30, 'expo-out'], [t0 + 0.2, 100]),
      opacity: envelope(t0, 0.03, fadeAt, 0.25),
    }));
  }
  // Confetti already in the air, drifting down from the top.
  const rain = Math.max(3, Math.round(20 * density));
  for (let i = 0; i < rain; i++) {
    const x0 = lerp(0.03, 0.97, (i + rng()) / rain) * W;
    const y0 = -lerp(0.04, 0.55, rng()) * H;
    const fall = lerp(0.28, 0.46, rng()) * H;
    const sway = { amp: lerp(20, 50, rng()) * u, freq: lerp(2.5, 5, rng()), phase: rng() * TAU };
    layers.push(piece(`confetti-fall-${i}`, `Confetti (falling) ${i + 1}`, palette[Math.floor(rng() * palette.length)], {
      position: { expr: `value + [${n(sway.amp)} * sin(${n(sway.freq)} * time + ${n(sway.phase)}), ${n(fall)} * time]`, v: [x0, y0, 0] },
      ...spin(),
      opacity: envelope(0, 0.01, dur - 0.3, 0.3),
    }));
  }
  return fxScene(ctx, 'fx-confetti', dur, seed, params, layers, [{ at: 0, sound: 'pop', note: 'party popper' }]);
}

// ───────────────────────── smoke "?" ─────────────────────────

/** The centre line of a question mark in a glyph box 1 unit tall (y down, origin at its centre), and its dot. */
function questionPath(): { line: [number, number][]; dot: [number, number] } {
  const line: [number, number][] = [];
  const cx = 0;
  const cy = -0.2;
  const r = 0.21;
  for (let a = 200; a <= 400; a += 5) {
    const rad = (a * Math.PI) / 180;
    line.push([cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]);
  }
  const [ex, ey] = line[line.length - 1];
  // Curl in under the bowl, then the stem.
  const bend: [number, number][] = [[ex - 0.05, ey + 0.06], [0.05, cy + r + 0.08], [0.025, cy + r + 0.15], [0.02, cy + r + 0.24]];
  line.push(...bend);
  return { line, dot: [0.02, cy + r + 0.42] };
}

/** Points every `step` along a polyline. */
function along(line: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= seg) {
      out.push([x0 + ((x1 - x0) * d) / seg, y0 + ((y1 - y0) * d) / seg]);
      d += step;
    }
    carry = seg - (d - step);
  }
  return out;
}

export function smokeQuestion(ctx: KitContext, params: Params): MotionScene {
  const { W, H, u, dur, density, seed, rng } = setup(ctx, params, 2);
  const smoke = colourParam(params, 'tint', '#ffffff');
  const centre = pointParam(params, 'origin', ctx, [0.74, 0.42]);
  const glyph = numParam(params, 'size', 0.56, 0.15, 0.95) * Math.min(H, W * 1.2);
  const { line, dot } = questionPath();
  const step = 0.05 / Math.sqrt(clamp(density, 0.5, 2));
  const trail = along(line, step);
  const formEnd = Math.min(0.62, dur * 0.35);
  const holdEnd = Math.max(formEnd + 0.3, dur - 0.78);
  const shadeC = mix(smoke, '#8e9098', 0.35);
  const puff = (id: string, name: string, p: [number, number], d: number, at: number, order: number, lumps = 3 + Math.floor(rng() * 2)): Layer => {
    const x = centre[0] + p[0] * glyph;
    const y = centre[1] + p[1] * glyph;
    const lift = lerp(60, 130, rng()) * u;
    const spread = [(p[0] * 0.8 + (rng() - 0.5) * 0.4) * 140 * u, -lift];
    const leave = holdEnd + order * 0.28 + rng() * 0.12;
    const gone = Math.min(dur, leave + lerp(0.45, 0.7, rng()));
    return {
      id,
      name,
      type: 'shape',
      in: Math.max(0, at - 0.01),
      transform: {
        position: { expr: `wiggle(0.7, ${n(5 * u)})`, k: [{ t: at, v: [x - p[0] * 30 * u, y + 34 * u], ease: 'expo-out' }, { t: at + 0.4, v: [x, y], ease: 'linear' }, { t: leave, v: [x, y], ease: 'sine-in' }, { t: gone, v: [x + spread[0], y + spread[1]] }] },
        scale: keyed<number>([at, 12, 'back-out'], [at + 0.34, 100, 'sine-in-out'], [leave, 110, 'sine-out'], [gone, 175]),
        rotation: { expr: `value + ${n((rng() - 0.5) * 40)} * time`, v: rng() * 360 },
        opacity: keyed<number>([at, 0, 'cubic-out'], [at + 0.1, 100, 'linear'], [leave, 100, 'sine-in'], [gone, 0]),
      },
      // Three overlapping lumps per puff (a repeater): the cauliflower edge of a cumulus.
      shape: {
        shape: 'ellipse',
        size: [d, d],
        fill: null,
        // Flat bright body, shade only at the rim and the underside: cotton, not glass beads.
        gradient: radial(d, d, [[0, smoke], [0.55, smoke], [0.78, mix(smoke, shadeC, 0.3)], [0.92, alpha(mix(smoke, shadeC, 0.6), 0.7)], [1, alpha(shadeC, 0)]], [d * 0.46, d * 0.4], d * 0.58),
        repeat: { count: lumps, offset: [d * lerp(0.2, 0.34, rng()), d * lerp(-0.12, 0.16, rng())], scale: lerp(62, 84, rng()), rotation: 40 + rng() * 100 },
      },
    } as Layer;
  };
  const layers: Layer[] = [];
  trail.forEach((p, i) => {
    const at = 0.04 + (formEnd - 0.1) * (i / Math.max(1, trail.length - 1));
    const d = lerp(0.1, 0.17, Math.pow(rng(), 0.7)) * glyph;
    layers.push(puff(`puff-${i}`, `Smoke puff ${i + 1}`, p, d, at, (trail.length - i) / trail.length));
    // Now and then a small wisp beside the stroke breaks the outline up.
    if (rng() < 0.35) {
      const side: [number, number] = [p[0] + (rng() - 0.5) * 0.09, p[1] + (rng() - 0.5) * 0.09];
      layers.push(puff(`wisp-${i}`, `Smoke wisp ${i + 1}`, side, lerp(0.05, 0.08, rng()) * glyph, at + 0.06, (trail.length - i) / trail.length, 2));
    }
  });
  for (let i = 0; i < 3; i++) {
    const p: [number, number] = [dot[0] + (i === 0 ? 0 : (i === 1 ? -1 : 1) * 0.04), dot[1] + (i === 0 ? 0 : 0.025)];
    layers.push(puff(`dot-${i}`, `Smoke dot ${i + 1}`, p, (i === 0 ? 0.16 : 0.11) * glyph, formEnd - 0.02 + i * 0.05, 0));
  }
  // Depth and dissolve for the whole cloud: a soft shadow, then wisps and blur as it breaks up.
  layers.push({
    id: 'smoke-air',
    name: 'Smoke shading',
    type: 'solid',
    color: '#000000',
    adjustment: true,
    effects: [
      { type: 'turbulent-displace', amount: keyed<number>([holdEnd, 0, 'sine-in'], [dur, 34 * u]), size: 70 * u, speed: 0.8 },
      blurFx(keyed<number>([0, 4.5 * u, 'linear'], [holdEnd, 4.5 * u, 'sine-in'], [dur, 24 * u])),
      { type: 'drop-shadow', distance: 12 * u, softness: 34 * u, opacity: 28, direction: 165, color: '#1a1c24' },
    ],
    note: 'Adjustment layer: the cloud\'s shadow, and the wisps and blur as it dissolves.',
  } as Layer);
  return fxScene(ctx, 'fx-smoke-question', dur, seed, params, layers, [{ at: 0, sound: 'whoosh', note: 'poof' }]);
}

// ───────────────────────── specs ─────────────────────────

const COMMON = {
  tint: 'colour',
  density: 'number 0.2–3 (1) — how many particles',
  seconds: 'number s — the length (the template default)',
  seed: 'number (1) — another seed gives another scatter; the same seed the same scene',
};

export const FUN_TEMPLATES: TemplateSpec[] = [
  {
    id: 'fx-money-rain',
    label: 'Money rain',
    technique: '@funny overlay FX',
    use: 'Banknotes tumble down over the host in three depths (far notes soft and slow, near notes big, motion-blurred, casting shadows). For flex, money, "rich" and bribe jokes. Transparent overlay; place it above the host clip.',
    params: { ...COMMON, tint: 'colour (#2e6b3a) — the ink green of the notes; the paper is a pale tint of it', value: 'string ("100") — the denomination printed in the corners' },
    seconds: 2.5,
    fullFrame: false,
    build: moneyRain,
  },
  {
    id: 'fx-speed-lines',
    label: 'Anime speed lines',
    technique: '@funny overlay FX',
    use: 'A manga emphasis frame: white speed lines rush in from the edges towards the focus and flicker at 12 fps over a darkened rim. For shock, realisation and "wait, what?" beats; pair with a zoom punch.',
    params: { ...COMMON, tint: 'colour (#ffffff) — line colour (black for a light frame)', origin: '[x, y] fractions (0.5, 0.45) — where the lines point (the face)', vignette: 'number 0–1 (0.55) — how dark the rim gets' },
    seconds: 1.5,
    fullFrame: false,
    build: speedLines,
  },
  {
    id: 'fx-hearts-burst',
    label: 'Hearts burst',
    technique: '@funny overlay FX',
    use: 'Glossy hearts burst from a point, arc and fall with gravity while gold sparkles twinkle. For fake-wholesome, crush, "aww" and sarcastic love beats.',
    params: { ...COMMON, tint: 'colour (#ff2e93) — heart pink', origin: '[x, y] fractions (0.5, 0.55) — where they burst from' },
    seconds: 1.5,
    fullFrame: false,
    build: heartsBurst,
  },
  {
    id: 'fx-embers',
    label: 'Fire embers',
    technique: '@funny overlay FX',
    use: 'Orange sparks rise and flicker across the frame over a red burn at the edges and a heat glow from below. For roasts that land hard, rage, "this is fire" and dramatic beats (with a B&W or red grade on the host).',
    params: { ...COMMON, tint: 'colour (#ff6a00) — fire colour' },
    seconds: 2.5,
    fullFrame: false,
    build: embers,
  },
  {
    id: 'fx-spotlight',
    label: 'Heavenly spotlight',
    technique: '@funny overlay FX',
    use: 'A soft white beam opens from above onto the host, shafts shimmering, dust motes drifting and the room dimming around it. For fake-holy, "blessed", innocence and hero moments.',
    params: { ...COMMON, tint: 'colour (#fff7e6) — light colour', origin: '[x, y] fractions (0.5, 0.32) — where the beam lands (the head)', spread: 'number deg (13) — cone half-angle', dim: 'number 0–0.9 (0.5) — how dark the room gets outside the beam' },
    seconds: 3,
    fullFrame: false,
    build: spotlight,
  },
  {
    id: 'fx-confetti',
    label: 'Confetti',
    technique: '@funny overlay FX',
    use: 'Paper confetti bursts up from a point and flutters down in 3D, with more drifting in from the top. For fake celebrations, wins, "congratulations" and sarcastic applause.',
    params: { ...COMMON, tint: 'colour — one colour family instead of the party mix', origin: '[x, y] fractions (0.5, 0.62) — where the burst comes from' },
    seconds: 2,
    fullFrame: false,
    build: confetti,
  },
  {
    id: 'fx-smoke-question',
    label: 'Smoke question mark',
    technique: '@funny overlay FX',
    use: 'White smoke puffs roll in along the shape of a big "?" beside the host, hang, then break up into wisps. For confusion, rhetorical questions and "what did I just hear?" beats.',
    params: { ...COMMON, tint: 'colour (#ffffff) — smoke colour', origin: '[x, y] fractions (0.74, 0.42) — centre of the "?"', size: 'number 0.15–0.95 (0.56) — height of the "?" as a share of the frame' },
    seconds: 2,
    fullFrame: false,
    build: smokeQuestion,
  },
];

const BY_ID = new Map(FUN_TEMPLATES.map((spec) => [spec.id, spec]));

/** Builds one @funny overlay FX scene sized for `ctx`. */
export function buildFunFx(id: FxTemplateId, ctx: KitContext, params: Params = {}): MotionScene {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown overlay FX "${id}" (known: ${FX_TEMPLATES.join(', ')})`);
  return spec.build(ctx, params);
}
