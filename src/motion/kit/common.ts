// Shared vocabulary for motion-kit templates: the reference video's motion grammar as helpers.
// Entrances are blur + slide + fade on expo-out; exits are faster on expo-in; nothing is linear.
import { keys } from '../anim';
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
};

export const pal = (ctx: KitContext): Palette => ({ ...CRIMSON_PALETTE, ...(ctx.palette ?? {}) });

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${(++counter).toString(36)}`;

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
