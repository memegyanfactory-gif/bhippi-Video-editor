// Shared vocabulary for motion-kit templates: the reference video's motion grammar as helpers.
// Entrances are blur + slide + fade on expo-out; exits are faster on expo-in; nothing is linear.
import { keys } from '../anim';
import type { MotionBrand } from '../../lib/brandKit/motionBrand';
import type { Ease, Effect, FootageSource, Key, Layer, MotionScene, Vec } from '../types';

export type Palette = { void: string; oxblood: string; crimson: string; accent: string; pink: string; white: string; muted: string };

export const CRIMSON_PALETTE: Palette = {
  void: '#0b0204',
  oxblood: '#2a0610',
  crimson: '#b0142f',
  accent: '#ff1f3d',
  pink: '#ff8a9a',
  white: '#ffffff',
  muted: '#d9c9cc',
};

export type KitContext = {
  width: number;
  height: number;
  palette?: Partial<Palette>;
  /** Font family for body/headline type; the brand kit's when it has one. */
  font?: string;
  /** The active brand kit, resolved for the engine; `brand-*` templates build from its guideline and every scene is put in it. */
  brand?: MotionBrand;
};

export const pal = (ctx: KitContext): Palette => ({ ...CRIMSON_PALETTE, ...(ctx.palette ?? {}) });

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${(++counter).toString(36)}`;

const f = (frames: number) => frames / 30;

/**
 * Timing tokens measured frame by frame on the reference films (docs/REFERENCE-FILMS-PLAN.md
 * §2.1; frames at 30 fps, stored in seconds). Templates, the direction guide and pacing QA read
 * these instead of inventing numbers; each names the film it was measured on.
 */
export const TIMING = {
  /** Pop-in (bubble, badge, button): full scale in 3–4 f, rotation settles over the next 2–4 f. */
  pop: { scale: f(4), settle: f(3), overshootRotation: 0.09 },
  /** UI panel/card entrance: orientation lands first (6 f), scale settles later (16 f) — Virgil. */
  panel: { orientation: f(6), scale: f(16), ease: 'emphasized' as Ease },
  /** A phone or card rising in with focus (Limelight: 33 f, blur σ 24 → 0, opacity in 5 f). */
  rise: { duration: f(33), blur: 24, fade: f(5), ease: 'rise' as Ease },
  /** Dark-AI settle: 43 f, each frame keeps ~85% of the remaining distance — Solair. */
  settle: { duration: f(43), ease: 'settle' as Ease },
  /** Sibling stagger: rows/chars 1 f, words 2–4 f, cards and widgets 2 f. */
  stagger: { char: f(1), row: f(1), word: f(3), card: f(2) },
  /** Hover-lift of a UI row: ×1.088 — 9 f in, 19 f hold, 8 f out; the other rows dim to 32% after 4 f (WasteProtection). */
  hoverLift: { scale: 1.088, in: f(9), hold: f(19), out: f(8), dimTo: 0.32, dimDelay: f(4), sweepPerRow: f(5) },
  /** Camera push onto a target: 25 f (Virgil "Invite"). */
  push: { duration: f(25), ease: 'push' as Ease },
  /** Wordmark / big reveal rise: 28–44 f. */
  wordmark: { duration: f(36), ease: 'rise' as Ease },
  /** Exits accelerate (×1.4 speed per frame): 3–14 f on expo-in, faster than entrances. */
  exit: { fast: f(4), normal: f(8), whip: f(12), ease: 'expo-in' as Ease },
  /** One-frame snaps (Solair): zoom-out to 0.3×, punch-in 1.4×, button press 0.66×. */
  snap: { zoomOut: 0.3, punchIn: 1.4, press: 0.66 },
  /** A word slam: 1.29× → 1.07 → 1.0 over 2 f (Workly "Built-in"). */
  slam: { from: 1.29, mid: 1.07, frames: 2 },
  /** Tracking breathe: opens +0.166 em in 9 f, holds 10 f, closes in 15 f (Workly). */
  breathe: { open: 0.166, in: f(9), hold: f(10), out: f(15) },
  /** Typing speed by purpose, in characters per second: UI fields 30, text read with the voice-over 12–13. */
  typing: { field: 30, read: 12.5, softEdge: 8, frontLag: 6 },
  /** Focus pull: 10–20 f, linear in σ, peak σ 3–13 px (Virgil). */
  focusPull: { duration: f(15), peak: 10 },
  /** Blur-bridge hidden cut: blur on in 1 f (σ ≈ 10), cut 3 f later, focus back ~7 f after (Workly). */
  blurBridge: { on: f(1), cutAfter: f(3), recover: f(7), sigma: 10 },
  /** Card zoom reveal: 6–8 f. */
  cardZoom: { duration: f(7), ease: 'card-zoom' as Ease },
  /** Logo mask-slide: 10–11 f; the mark shrinks to 0.59 (Limelight). */
  logoSlide: { duration: f(10.5), markScale: 0.59, markEase: [0.635, 0.177, 0.109, 0.977] as Ease, wordEase: [0.032, 0, 0.072, 0.816] as Ease },
  /** Brand glyph resolving into the logo: shrinks in 15 f, spins 145° over 43 f (Solair). */
  logoResolve: { shrink: f(15), spin: f(43), degrees: 145, ease: 'resolve' as Ease },
  /** White-out 7–13 f; a black breath of 12 f before a drop. */
  whiteOut: f(10), blackBreath: f(12),
  /** End-card hold 1.2–3.9 s. */
  endHold: 2.2,
  /** Text vs voice-over: headlines lead by 0.56 s; payoffs land on the word (±0.2 s); typed lines finish 0.3 s early (Limelight). */
  voice: { headlineLead: 0.56, payoffTolerance: 0.2, typedFinishEarly: 0.3, wordsPerMinute: 150 },
} as const;

/** Unit of size: 1 = one pixel at 1080p, scaled to the canvas' short side. */
export const unit = (ctx: KitContext) => Math.min(ctx.width, ctx.height) / 1080;

/** Standard entrance: keyframes for opacity, blur (as an effect) and a slide. */
export function enter(at: number, duration = 0.55, from: { dx?: number; dy?: number; scale?: number; blur?: number } = {}, ease: Ease = 'expo-out') {
  const opacity = keys<number>([at, 0, ease], [at + duration * 0.6, 100]);
  const blur = keys<number>([at, from.blur ?? 18, ease], [at + duration, 0]);
  return { opacity, blur, dx: from.dx ?? 0, dy: from.dy ?? 0, scale: from.scale, at, duration, ease };
}

/** Keys for a value that enters, holds and exits. */
export function inHoldOut<T extends number | Vec>(at: number, inDur: number, outAt: number | null, outDur: number, from: T, rest: T, to: T, inEase: Ease = 'expo-out', outEase: Ease = 'expo-in'): { k: Key<T>[] } {
  const k: Key<T>[] = [{ t: at, v: from, ease: inEase }, { t: at + inDur, v: rest, ease: 'linear' }];
  if (outAt !== null && outAt > at + inDur) k.push({ t: outAt, v: rest, ease: outEase }, { t: outAt + outDur, v: to });
  return { k };
}

export const glowFx = (radius: number, intensity = 0.7, color?: string): Effect => ({ type: 'glow', radius, intensity, threshold: 0, ...(color ? { color } : {}), deep: true });
export const blurFx = (blurriness: number | { k: Key<number>[] }): Effect => ({ type: 'gaussian-blur', blurriness } as Effect);
export const shadowFx = (distance = 18, softness = 40, opacity = 55): Effect => ({ type: 'drop-shadow', distance, softness, opacity, direction: 180, color: '#000000' });

export function stage(ctx: KitContext, id = 'stage', params: Record<string, unknown> = {}): Layer {
  const p = pal(ctx);
  return { id, name: 'Stage', type: 'procedural', kind: 'crimson-stage', params: { top: p.void, glow: p.crimson, hot: p.pink, ...params } };
}

/** A glass card: rounded rect with a soft vertical gradient, 1px light rim and drop shadow. */
export function glassCard(id: string, size: Vec, ctx: KitContext, extra: Partial<Layer> = {}): Layer {
  const p = pal(ctx);
  const u = unit(ctx);
  return {
    id,
    name: 'Glass card',
    type: 'shape',
    shape: { shape: 'rect', size, radius: 22 * u, gradient: { kind: 'linear', stops: [[0, '#ffffff1c'], [0.55, `${p.crimson}55`], [1, `${p.crimson}aa`]], from: [0, 0], to: [0, size[1]] }, stroke: '#ffffff40', strokeWidth: 1.5 * u },
    backdrop: { blur: 26, saturation: 1.3, brightness: -8 },
    effects: [shadowFx(22 * u, 60 * u, 45)],
    ...extra,
  } as Layer;
}

export function footage(id: string, source: FootageSource, extra: Partial<Layer> = {}): Layer {
  return { id, type: 'footage', source, fit: 'cover', ...extra } as Layer;
}

export function scene(ctx: KitContext, duration: number, layers: Layer[], extra: Partial<MotionScene> = {}): MotionScene {
  return { version: 1, width: ctx.width, height: ctx.height, duration, layers, motionBlur: { samples: 8, shutter: 180 }, ...extra };
}

/** Text that blurs and slides in word by word (the reference's default headline entrance). */
export function headline(id: string, text: string, ctx: KitContext, opts: { at: number; size: number; position: Vec; align?: 'left' | 'center' | 'right'; color?: string; weight?: number; stagger?: number; dy?: number; dx?: number; out?: number; font?: string; glow?: boolean; box?: number; times?: number[]; by?: 'word' | 'char' | 'line'; spans?: { text: string; font?: string; color?: string; italic?: boolean; weight?: number; size?: number }[] }): Layer {
  const u = unit(ctx);
  return {
    id,
    name: text.slice(0, 32),
    type: 'text',
    in: Math.max(0, opts.at - 0.05),
    ...(opts.out !== undefined ? { out: opts.out + 0.6 } : {}),
    transform: { position: opts.position },
    text: {
      ...(opts.spans ? { spans: opts.spans } : { text }),
      font: opts.font ?? ctx.font,
      size: opts.size,
      weight: opts.weight ?? 700,
      color: opts.color ?? pal(ctx).white,
      align: opts.align ?? 'center',
      tracking: -3,
      box: opts.box,
      cascade: {
        by: opts.by ?? 'word',
        times: opts.times,
        delay: opts.at,
        stagger: opts.stagger ?? 0.08,
        duration: 0.6,
        ease: 'expo-out',
        from: { opacity: 0, blur: 16 * u, position: [opts.dx ?? 0, opts.dy ?? 22 * u], scale: 100 },
        ...(opts.out !== undefined ? { exit: { at: opts.out, duration: 0.35, stagger: 0.03, to: { opacity: 0, blur: 12 * u, position: [0, -14 * u] } } } : {}),
      },
    },
    effects: opts.glow === false ? [] : [glowFx(18 * u, 0.55)],
  };
}
