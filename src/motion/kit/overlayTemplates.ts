// Overlay-group motion templates (reference techniques T3–T6, T15–T17): frame-to-card, the 3D
// card wall, the cut-out stage with callouts, the split rules panel, stat badges with count-up
// and the dock with a clicking cursor. Every builder is deterministic (no Math.random), sizes
// everything from `unit(ctx)`, and adapts its layout to portrait canvases.
import { keys } from '../anim';
import { DEFAULT_ZOOM_RATIO } from '../evaluate';
import type { Ease, Effect, FootageSource, Key, Layer, MotionScene, Prop, TextCascade, TextLayerData, Vec } from '../types';
import { blurFx, glowFx, pal, scene, shadowFx, stage, unit, type KitContext } from './common';
import type { TemplateSpec } from './index';

// ───────────────────────── shared helpers ─────────────────────────

type Footageish = FootageSource | string;

/** A footage param: a path/asset string or a FootageSource. */
function src(value: unknown, fallback?: FootageSource): FootageSource {
  if (typeof value === 'string') return /\.(png|jpe?g|webp|gif)$/i.test(value) ? { path: value, kind: 'image' } : { path: value };
  if (value && typeof value === 'object') return { ...(value as FootageSource) };
  return fallback ?? { path: '' };
}

/** Deterministic 0..1 noise for layout jitter. */
const hash = (i: number, salt = 1) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalises #rgb / #rrggbb(aa) to #rrggbb. */
function hex6(color: string): string {
  const h = color.replace('#', '');
  if (h.length === 3 || h.length === 4) return `#${h.slice(0, 3).split('').map((c) => c + c).join('')}`;
  return `#${h.slice(0, 6).padEnd(6, '0')}`;
}

/** Lightens (amount > 0) or darkens (amount < 0) a colour, −1..1. */
function shade(color: string, amount: number): string {
  const h = hex6(color).slice(1);
  const rgb = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) || 0);
  const out = rgb.map((v) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)));
  return `#${out.map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance 0..1 of a colour (for picking a legible glyph colour). */
function luminance(color: string): number {
  const h = hex6(color).slice(1);
  const [r, g, b] = [0, 2, 4].map((k) => (parseInt(h.slice(k, k + 2), 16) || 0) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Colour with an alpha byte (0..1). */
const alpha = (color: string, a: number) => `${hex6(color)}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`;

/** Rough advance of `text` at `size` px (a bold geometric sans), including tracking. */
export function estimateWidth(text: string, size: number, tracking = 0, weight = 700): number {
  let w = 0;
  for (const ch of Array.from(text)) {
    let k = 0.56;
    if (ch === ' ') k = 0.27;
    else if (/[il.,:;'|!]/.test(ch)) k = 0.27;
    else if (/[mwMW@%]/.test(ch)) k = 0.86;
    else if (/[A-Z0-9$€£₹]/.test(ch)) k = 0.66;
    else if (/[frtj]/.test(ch)) k = 0.36;
    else if (/[\u{1F000}-\u{1FFFF}☀-➿]/u.test(ch)) k = 1.1;
    w += size * k * (weight >= 700 ? 1.04 : 1) + tracking * (size / 1000) * 10;
  }
  return Math.max(0, w);
}

/** Opacity that fades in (and optionally out) with an expo curve. */
function fade(at: number, dur = 0.3, outAt?: number | null, outDur = 0.25): Prop<number> {
  const k: Key<number>[] = [{ t: at, v: 0, ease: 'expo-out' }, { t: at + dur, v: 100 }];
  if (outAt !== undefined && outAt !== null && outAt > at + dur) k.push({ t: outAt, v: 100, ease: 'expo-in' }, { t: outAt + outDur, v: 0 });
  return { k };
}

/** Blur that clears on entry and (optionally) returns on exit. */
function blurInOut(at: number, amount: number, dur = 0.5, outAt?: number | null, outDur = 0.25, outAmount = amount): Effect {
  const k: Key<number>[] = [{ t: at, v: amount, ease: 'expo-out' }, { t: at + dur, v: 0 }];
  if (outAt !== undefined && outAt !== null && outAt > at + dur) k.push({ t: outAt, v: 0, ease: 'expo-in' }, { t: outAt + outDur, v: outAmount });
  return blurFx({ k });
}

/** Position that slides from `rest + offset` to `rest` (and optionally out to `rest + outOffset`). */
function slide(at: number, rest: Vec, offset: Vec, dur = 0.6, ease: Ease = 'expo-out', outAt?: number | null, outOffset: Vec = [0, 0], outDur = 0.3): Prop<Vec> {
  const add = (a: Vec, b: Vec) => a.map((v, i) => v + (b[i] ?? 0));
  const k: Key<Vec>[] = [{ t: at, v: add(rest, offset), ease }, { t: at + dur, v: rest }];
  if (outAt !== undefined && outAt !== null && outAt > at + dur) k.push({ t: outAt, v: rest, ease: 'expo-in' }, { t: outAt + outDur, v: add(rest, outOffset) });
  return { k };
}

/** Scale that pops from `from`% with back-out (or `ease`). */
function pop(at: number, from = 70, dur = 0.5, ease: Ease = 'back-out', outAt?: number | null, outTo = 90, outDur = 0.25): Prop<number> {
  const k: Key<number>[] = [{ t: at, v: from, ease }, { t: at + dur, v: 100 }];
  if (outAt !== undefined && outAt !== null && outAt > at + dur) k.push({ t: outAt, v: 100, ease: 'expo-in' }, { t: outAt + outDur, v: outTo });
  return { k };
}

type TextOpts = {
  at: number;
  size: number;
  position: Vec;
  align?: 'left' | 'center' | 'right';
  color?: string;
  weight?: number;
  font?: string;
  tracking?: number;
  by?: 'char' | 'word' | 'line';
  stagger?: number;
  duration?: number;
  from?: TextCascade['from'];
  out?: number | null;
  outTo?: NonNullable<TextCascade['exit']>['to'];
  parent?: string;
  glow?: number;
  shadow?: TextLayerData['shadow'];
  box?: number;
  lineHeight?: number;
  extra?: Partial<TextLayerData>;
  italic?: boolean;
};

/** A text layer that cascades in (blur + slide + fade on expo-out) and optionally out. */
function text(id: string, value: string, ctx: KitContext, o: TextOpts): Layer {
  const u = unit(ctx);
  const outAt = o.out ?? null;
  return {
    id,
    name: value.slice(0, 32) || id,
    type: 'text',
    ...(o.parent ? { parent: o.parent } : { in: Math.max(0, o.at - 0.05) }),
    ...(outAt !== null && !o.parent ? { out: outAt + 0.7 } : {}),
    transform: { position: o.position },
    text: {
      text: value,
      font: o.font ?? ctx.font,
      size: o.size,
      weight: o.weight ?? 700,
      italic: o.italic,
      color: o.color ?? '#ffffff',
      align: o.align ?? 'left',
      tracking: o.tracking ?? -4,
      lineHeight: o.lineHeight,
      box: o.box,
      shadow: o.shadow,
      cascade: {
        by: o.by ?? 'word',
        delay: o.at,
        stagger: o.stagger ?? 0.07,
        duration: o.duration ?? 0.55,
        ease: 'expo-out',
        from: o.from ?? { opacity: 0, blur: 14 * u, position: [0, 16 * u] },
        ...(outAt !== null ? { exit: { at: outAt, duration: 0.3, stagger: 0.02, to: o.outTo ?? { opacity: 0, blur: 12 * u, position: [0, -10 * u] } } } : {}),
      },
      ...(o.extra ?? {}),
    },
    effects: o.glow ? [glowFx(o.glow, 0.45)] : [],
  };
}

function rect(id: string, size: Vec, style: { fill?: string | null; gradient?: NonNullable<Extract<Layer, { type: 'shape' }>['shape']['gradient']>; stroke?: string | null; strokeWidth?: number; radius?: number }, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    type: 'shape',
    shape: { shape: 'rect', size, radius: style.radius ?? 0, fill: style.fill ?? null, gradient: style.gradient, stroke: style.stroke ?? null, strokeWidth: style.strokeWidth ?? 0 },
    ...extra,
  } as Layer;
}

function ellipse(id: string, d: number, style: { fill?: string | null; stroke?: string | null; strokeWidth?: number }, extra: Partial<Layer> = {}): Layer {
  return { id, type: 'shape', shape: { shape: 'ellipse', size: [d, d], fill: style.fill ?? null, stroke: style.stroke ?? null, strokeWidth: style.strokeWidth ?? 0 }, ...extra } as Layer;
}

/** Crimson glass: a vertical gradient, a light rim and a backdrop blur (the reference's pills). */
function crimsonGlass(ctx: KitContext, h: number, strength = 1): { gradient: NonNullable<Extract<Layer, { type: 'shape' }>['shape']['gradient']>; stroke: string } {
  const p = pal(ctx);
  return {
    gradient: { kind: 'linear', stops: [[0, alpha(shade(p.accent, 0.08), 0.78 * strength)], [0.5, alpha(p.crimson, 0.72 * strength)], [1, alpha(shade(p.crimson, -0.25), 0.82 * strength)]], from: [0, 0], to: [0, h] },
    stroke: '#ffffff44',
  };
}

const portrait = (ctx: KitContext) => ctx.width < ctx.height;

// ───────────────────────── T5 frame-to-card ─────────────────────────

export type FrameToCardParams = {
  footage?: Footageish;
  /** A whole scene to shrink instead of footage (precomp). */
  scene?: MotionScene;
  /** When the frame starts shrinking (s). */
  at?: number;
  /** Card size, % of the frame. */
  scale?: number;
  /** Visual corner radius px at 1080p. */
  radius?: number;
  exit?: 'left' | 'up' | 'push' | 'none';
  exitAt?: number;
  /** Degrees of Y tilt at rest (X gets 40% of it). */
  tilt?: number;
  /** Optional footage that replaces the card when it exits (the "push into next"). */
  next?: Footageish;
  duration?: number;
};

function cardLayer(id: string, content: { footage?: FootageSource; scene?: MotionScene }, extra: Partial<Layer>): Layer {
  if (content.scene) return { id, type: 'precomp', scene: content.scene, threeD: true, motionBlur: true, ...extra } as Layer;
  return { id, type: 'footage', source: content.footage ?? { path: '' }, fit: 'cover', threeD: true, motionBlur: true, ...extra } as Layer;
}

export function frameToCard(ctx: KitContext, params: FrameToCardParams): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const at = params.at ?? 0.3;
  const S = clamp(params.scale ?? (portrait(ctx) ? 72 : 58), 10, 100);
  const k = S / 100;
  const R = (params.radius ?? 34) * u;
  const tilt = params.tilt ?? 8;
  const exit = params.exit ?? 'left';
  const exitAt = exit === 'none' ? null : (params.exitAt ?? at + 1.7);
  const next = params.next ? src(params.next) : null;
  const duration = params.duration ?? (exitAt === null ? at + 2.2 : exitAt + (next ? 1.3 : 0.8));
  const shrink = 0.75;
  const centre: Vec = [W / 2, H / 2, 0];

  const cardFx = (start: number): Effect[] => [
    { type: 'stroke', width: keys<number>([start, 0, 'expo-out'], [start + 0.4, (2.5 * u) / k]), color: '#ffffff', opacity: 32, position: 'inside' },
    shadowFx((26 * u) / k, (70 * u) / k, 62),
  ];

  // The card: scale from full frame, a tilt that swings in and settles, rounded corners.
  const pos: Key<Vec>[] = [{ t: at, v: centre, ease: 'expo-in-out' }, { t: at + shrink, v: [W / 2, H / 2 - 6 * u, 0], ease: 'sine-in-out' }];
  const rotY: Key<number>[] = [{ t: at, v: 0, ease: 'expo-in-out' }, { t: at + shrink * 0.8, v: -tilt, ease: 'sine-in-out' }, { t: at + shrink + 0.9, v: -tilt * 0.35, ease: 'sine-in-out' }];
  const rotX: Key<number>[] = [{ t: at, v: 0, ease: 'expo-in-out' }, { t: at + shrink * 0.8, v: tilt * 0.4, ease: 'sine-in-out' }, { t: at + shrink + 0.9, v: tilt * 0.15 }];
  const scale: Key<number>[] = [{ t: at, v: 100, ease: 'expo-in-out' }, { t: at + shrink, v: S, ease: 'sine-in-out' }];
  const opacity: Key<number>[] = [{ t: 0, v: 100 }];
  const blurKeys: Key<number>[] = [{ t: 0, v: 0 }];
  if (exitAt !== null) {
    const rest: Vec = [W / 2, H / 2 - 6 * u, 0];
    scale.push({ t: exitAt, v: S * 0.97, ease: 'expo-in' });
    pos.push({ t: exitAt, v: rest, ease: 'expo-in' });
    rotY.push({ t: exitAt, v: -tilt * 0.35, ease: 'expo-in' });
    const end = exitAt + 0.5;
    if (exit === 'left') { pos.push({ t: end, v: [-W * 0.65, H / 2 - 30 * u, 0] }); rotY.push({ t: end, v: 32 }); scale.push({ t: end, v: S * 0.97 }); }
    else if (exit === 'up') { pos.push({ t: end, v: [W / 2, -H * 0.75, 0] }); rotY.push({ t: end, v: 0 }); rotX.push({ t: exitAt, v: tilt * 0.15, ease: 'expo-in' }, { t: end, v: -28 }); scale.push({ t: end, v: S * 0.97 }); }
    else { pos.push({ t: end, v: [W / 2, H / 2 - 40 * u, 2600] }); rotY.push({ t: end, v: -tilt }); scale.push({ t: end, v: S * 0.97 }); opacity.push({ t: exitAt + 0.15, v: 100, ease: 'expo-in' }, { t: end, v: 0 }); blurKeys.push({ t: exitAt, v: 0, ease: 'expo-in' }, { t: end, v: 30 * u }); }
  }
  const content = params.scene ? { scene: params.scene } : { footage: src(params.footage) };
  const card = cardLayer('card', content, {
    name: 'Frame as card',
    ...(exitAt !== null ? { out: exitAt + 0.55 } : {}),
    transform: { position: { k: pos }, scale: { k: scale }, rotationY: { k: rotY }, rotationX: { k: rotX }, opacity: { k: opacity } },
    masks: [{ shape: 'rect', radius: keys<number>([at, 0, 'expo-out'], [at + 0.45, R / k]) }],
    effects: [...cardFx(at), ...(exit === 'push' ? [blurFx({ k: blurKeys })] : [])],
  });

  const layers: Layer[] = [stage(ctx, 'stage'), card];
  if (next && exitAt !== null) {
    const t0 = exitAt + 0.12;
    const rest: Vec = [W / 2, H / 2 - 6 * u, 0];
    const fromPos: Vec = exit === 'left' ? [W * 1.65, H / 2 + 20 * u, 0] : exit === 'up' ? [W / 2, H * 1.75, 0] : [W / 2, H / 2, -900];
    layers.push(cardLayer('next', { footage: next }, {
      name: 'Next card',
      in: exitAt,
      transform: {
        position: keys<Vec>([t0, fromPos, 'expo-out'], [t0 + 0.7, rest]),
        scale: S,
        rotationY: keys<number>([t0, exit === 'left' ? -34 : 0, 'expo-out'], [t0 + 0.8, -tilt * 0.35]),
        rotationX: keys<number>([t0, exit === 'up' ? 26 : 0, 'expo-out'], [t0 + 0.8, tilt * 0.15]),
        opacity: keys<number>([t0, exit === 'push' ? 0 : 100, 'expo-out'], [t0 + 0.3, 100]),
      },
      masks: [{ shape: 'rect', radius: R / k }],
      effects: [
        { type: 'stroke', width: (2.5 * u) / k, color: '#ffffff', opacity: 32, position: 'inside' },
        shadowFx((26 * u) / k, (70 * u) / k, 62),
        ...(exit === 'push' ? [blurFx(keys<number>([t0, 24 * u, 'expo-out'], [t0 + 0.5, 0]))] : []),
      ],
    }));
  }
  const cues: NonNullable<MotionScene['cues']> = [{ at: Math.max(0, at - 0.05), sound: 'whoosh', note: 'frame to card' }];
  if (exitAt !== null) cues.push({ at: exitAt - 0.05, sound: 'whoosh', note: `card exits ${exit}` });
  return scene(ctx, duration, layers, { background: pal(ctx).void, cues, template: { id: 'frame-to-card', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── T6 card wall 3D ─────────────────────────

export type CardWallParams = {
  images?: Footageish[];
  words?: { text: string; at: number }[];
  headline?: string;
  headlineAt?: number;
  /** When the first card starts flying in. */
  at?: number;
  duration?: number;
};

export function cardWall3D(ctx: KitContext, params: CardWallParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const tall = portrait(ctx);
  const at = params.at ?? 0.1;
  const images = (params.images ?? []).map((image) => src(image));
  const words = params.words ?? [{ text: 'You', at: 0.9 }, { text: 'Great', at: 1.55 }, { text: 'Still manual…', at: 2.2 }];
  const headlineText = params.headline ?? 'Unnecessarily Complex';
  const lastWord = words.length ? Math.max(...words.map((w) => w.at)) : at + 0.8;
  const headlineAt = params.headlineAt ?? lastWord + 0.7;
  const duration = params.duration ?? Math.max(4.2, headlineAt + 1.6);
  const zoom = W * DEFAULT_ZOOM_RATIO;

  // Deterministic layout: a jittered grid in screen space, pushed to varied depths and scaled
  // back up so the projection keeps the collage dense.
  const cols = tall ? 3 : 5;
  const rows = tall ? 6 : 4;
  const spanX = W * 1.22;
  const spanY = H * 1.2;
  const baseW = tall ? W * 0.42 : W * 0.2;
  const depths = [-160, 40, 260, 520, 820];
  const layers: Layer[] = [
    stage(ctx, 'stage', { intensity: 0.9 }),
    { id: 'cam', name: 'Camera', type: 'camera', zoom, transform: { position: keys<Vec>([0, [W / 2 - 0.03 * W, H / 2 + 0.02 * H, -zoom * 1.22], 'sine-in-out'], [duration, [W / 2 + 0.03 * W, H / 2 - 0.01 * H, -zoom * 0.9]]), rotation: keys<number>([0, -2.5, 'sine-in-out'], [duration, 1]) } },
  ];
  const cards: { i: number; order: number }[] = [];
  const n = cols * rows;
  for (let i = 0; i < n; i++) cards.push({ i, order: hash(i, 7) });
  const flightOrder = [...cards].sort((a, b) => {
    // Centre cards land first, the rim follows (with a seeded shuffle).
    const da = Math.hypot((a.i % cols) - (cols - 1) / 2, Math.floor(a.i / cols) - (rows - 1) / 2) + a.order * 1.4;
    const db = Math.hypot((b.i % cols) - (cols - 1) / 2, Math.floor(b.i / cols) - (rows - 1) / 2) + b.order * 1.4;
    return da - db;
  });
  const stagger = Math.min(0.06, 1.3 / n);
  flightOrder.forEach(({ i }, rank) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const aspect = hash(i, 3) < 0.18 ? 1.5 : hash(i, 3) < 0.45 ? 0.75 : 0.5625;
    const sizeK = 0.78 + hash(i, 5) * 0.5;
    const cw = baseW * sizeK * (aspect > 1 ? 0.55 : 1);
    const ch = cw * aspect;
    const sx = W / 2 + ((col + 0.5) / cols - 0.5) * spanX + (hash(i, 11) - 0.5) * W * 0.06 + (row % 2 ? W * 0.04 : -W * 0.02);
    const sy = H / 2 + ((row + 0.5) / rows - 0.5) * spanY + (hash(i, 13) - 0.5) * H * 0.07;
    const z = depths[Math.floor(hash(i, 17) * depths.length)];
    const f = (zoom + z) / zoom;
    const wx = W / 2 + (sx - W / 2) * f;
    const wy = H / 2 + (sy - H / 2) * f;
    const t0 = at + rank * stagger;
    const dof = z >= 500 ? (z - 400) / 45 * u : z < 0 ? 5 * u : 0;
    const rx = (hash(i, 19) - 0.5) * 10;
    const ry = (hash(i, 23) - 0.5) * 14;
    const image = images.length ? images[i % images.length] : null;
    const common: Partial<Layer> = {
      name: `Card ${i + 1}`,
      threeD: true,
      motionBlur: true,
      transform: {
        position: keys<Vec>([t0, [wx + (sx - W / 2) * 0.6, wy + (sy - H / 2) * 0.6, z + 2600], 'expo-out'], [t0 + 0.95, [wx, wy, z]]),
        scale: f * 100,
        rotationX: keys<number>([t0, rx + 28 * (row < rows / 2 ? 1 : -1), 'expo-out'], [t0 + 1.1, rx]),
        rotationY: keys<number>([t0, ry - 30 * (col < cols / 2 ? 1 : -1), 'expo-out'], [t0 + 1.1, ry]),
        opacity: keys<number>([t0, 0, 'expo-out'], [t0 + 0.25, 100]),
      },
      effects: [
        { type: 'stroke', width: 1.5 * u, color: '#ffffff', opacity: 28, position: 'inside' },
        shadowFx(14 * u, 40 * u, 55),
        blurFx(keys<number>([t0, 26 * u, 'expo-out'], [t0 + 0.8, dof])),
        ...(z >= 500 ? [{ type: 'brightness-contrast', brightness: -Math.min(35, (z - 300) / 18), contrast: 0 } as Effect] : []),
      ],
    };
    if (image) {
      layers.push({ id: `card-${i}`, type: 'footage', source: image, fit: 'cover', size: [cw, ch], masks: [{ shape: 'rect', radius: 12 * u }], ...common } as Layer);
    } else {
      // Without images: UI-like panels in the stage palette.
      const kind = Math.floor(hash(i, 29) * 4);
      const fills = ['#f4f1f2', '#15090c', p.crimson, '#241015'];
      layers.push(rect(`card-${i}`, [cw, ch], { fill: fills[kind], radius: 12 * u, stroke: '#ffffff30', strokeWidth: 1.5 * u }, common));
    }
  });

  // Kinetic words land on top of the wall; each hands over to the next, the headline stays.
  const spots: Vec[] = tall
    ? [[0.5, 0.36], [0.5, 0.58], [0.5, 0.44], [0.5, 0.66]]
    : [[0.34, 0.4], [0.6, 0.6], [0.44, 0.7], [0.64, 0.34]];
  const wordSize = (value: string, base: number) => Math.min(base, (W * 0.84) / Math.max(1, estimateWidth(value, 1, -2)));
  const shadow = { color: '#000000aa', blur: 30 * u, y: 6 * u };
  const sorted = [...words].sort((a, b) => a.at - b.at);
  sorted.forEach((word, index) => {
    const nextAt = index + 1 < sorted.length ? sorted[index + 1].at : headlineAt;
    const spot = spots[index % spots.length];
    const size = wordSize(word.text, (tall ? 120 : 128) * u);
    layers.push(text(`word-${index}`, word.text, ctx, {
      at: word.at,
      size,
      position: [W * spot[0], H * spot[1]],
      align: 'center',
      by: 'char',
      stagger: 0.035,
      duration: 0.5,
      tracking: -2,
      from: { opacity: 0, blur: 22 * u, position: [0, 34 * u], scale: 118 },
      out: Math.max(word.at + 0.45, nextAt - 0.15),
      outTo: { opacity: 0, blur: 18 * u, scale: 92 },
      shadow,
      glow: 18 * u,
      extra: index % 3 === 1 ? { color: '#ffe3e8' } : {},
    }));
  });
  const headSize = wordSize(headlineText, (tall ? 110 : 120) * u);
  layers.push(text('headline', headlineText, ctx, {
    at: headlineAt,
    size: headSize,
    position: [W / 2, H * (tall ? 0.46 : 0.45)],
    align: 'center',
    by: 'word',
    stagger: 0.12,
    duration: 0.6,
    tracking: -2,
    from: { opacity: 0, blur: 24 * u, position: [0, 40 * u], scale: 112 },
    shadow,
    glow: 22 * u,
    box: W * 0.9,
  }));
  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'whoosh', note: 'wall flies in' }, ...sorted.map((w) => ({ at: w.at, sound: 'pop' as const, note: w.text })), { at: headlineAt, sound: 'impact', note: headlineText }];
  return scene(ctx, duration, layers, { background: p.void, cues, template: { id: 'card-wall-3d', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── T3 + T4 cut-out stage ─────────────────────────

export type Callout = { anchor: Vec; text: string; detail?: string; at: number; side?: 'left' | 'right' };

export type CutoutStageParams = {
  subject?: Footageish;
  name?: string;
  role?: string;
  callouts?: Callout[];
  /** When the silhouette starts filling (s). */
  at?: number;
  /** Canvas x of the subject's centre (default 0.6 W landscape, 0.5 W portrait). */
  subjectX?: number;
  /** % scale of the subject layer. */
  subjectScale?: number;
  fill?: string;
  fill2?: string;
  nameAt?: number;
  outAt?: number | null;
  duration?: number;
};

/** The subject layer's box on the canvas: [centreX, centreY, width, height]. */
export function cutoutSubjectBox(ctx: KitContext, params: Pick<CutoutStageParams, 'subjectX' | 'subjectScale'>): [number, number, number, number] {
  const W = ctx.width;
  const H = ctx.height;
  const k = (params.subjectScale ?? 100) / 100;
  if (portrait(ctx)) {
    const w = W * 1.55 * k;
    const h = w * 0.5625;
    return [params.subjectX ?? W / 2, H - h / 2, w, h];
  }
  // Scaled about the bottom edge, so a waist-up cut-out keeps standing on the frame edge.
  return [params.subjectX ?? W * 0.6, H - (H * k) / 2, W * k, H * k];
}

export function cutoutStage(ctx: KitContext, params: CutoutStageParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const tall = portrait(ctx);
  const at = params.at ?? 0.2;
  const subject = src(params.subject);
  const [sx, sy, sw, sh] = cutoutSubjectBox(ctx, params);
  const callouts = [...(params.callouts ?? [])].sort((a, b) => a.at - b.at);
  const nameAt = params.nameAt ?? at + 1.05;
  const outAt = params.outAt ?? null;
  const lastCallout = callouts.length ? callouts[callouts.length - 1].at : nameAt;
  const duration = params.duration ?? Math.max(4, (outAt ?? lastCallout + 1.6) + (outAt ? 0.6 : 0));
  const fillA = params.fill ?? p.accent;
  const fillB = params.fill2 ?? '#ff8a1f';

  const layers: Layer[] = [stage(ctx, 'stage', { intensity: 1.05 })];

  const isImage = subject.kind === 'image' || /\.(png|webp)$/i.test(subject.path ?? '');
  layers.push({
    id: 'subject',
    name: 'Cut-out subject',
    type: 'footage',
    source: subject.matte ? { ...subject, cutout: true } : subject,
    fit: isImage ? 'contain' : 'cover',
    size: [sw, sh],
    transform: {
      position: keys<Vec>([at, [sx, sy + 24 * u], 'expo-out'], [at + 1.4, [sx, sy]]),
      scale: keys<number>([at, 104, 'expo-out'], [at + 1.6, 100]),
      ...(outAt !== null ? { opacity: keys<number>([outAt, 100, 'expo-in'], [outAt + 0.35, 0]) } : {}),
    },
    effects: [
      { type: 'matte-fill', from: 'bottom', fill: fillA, fill2: fillB, softness: 0.06, progress: keys<number>([at, 0, 'cubic-out'], [at + 0.6, 1]), mix: keys<number>([at + 0.5, 0, 'sine-in-out'], [at + 1.15, 1]) },
      { type: 'matte-edge-glow', radius: 12 * u, color: fillA, intensity: keys<number>([at, 1.5, 'expo-out'], [at + 1.6, 0.5]) },
    ],
  } as Layer);

  // Name + role: left of the subject (landscape) or above it (portrait).
  const name = params.name ?? '';
  const role = params.role ?? '';
  const nameSize = Math.min((tall ? 110 : 104) * u, (tall ? W * 0.86 : Math.max(W * 0.3, sx - sw * 0.16 - W * 0.06)) / Math.max(1, estimateWidth(name, 1, -6)));
  const nameX = tall ? W / 2 : W * 0.06;
  const nameY = tall ? Math.max(H * 0.2, sy - sh / 2 - 110 * u) : H * 0.6;
  const align = tall ? 'center' : 'left';
  if (name) {
    layers.push(text('name', name, ctx, {
      at: nameAt,
      size: nameSize,
      position: [nameX, nameY],
      align,
      by: 'char',
      stagger: 0.03,
      tracking: -6,
      from: { opacity: 0, blur: 18 * u, position: [-18 * u, 0], scale: 104 },
      out: outAt,
      glow: 16 * u,
      shadow: { color: '#00000066', blur: 18 * u, y: 4 * u },
    }));
  }
  if (role) {
    layers.push(text('role', role, ctx, {
      at: nameAt + 0.25,
      size: 28 * u,
      weight: 500,
      color: p.muted,
      position: [nameX + (tall ? 0 : 4 * u), nameY + nameSize * 0.62 + 8 * u],
      align,
      by: 'word',
      stagger: 0.05,
      tracking: 0,
      from: { opacity: 0, blur: 10 * u, position: [0, 8 * u] },
      out: outAt,
    }));
  }

  // Callouts: dot at the anchor → trim-path line → glass pill with the value (and detail).
  const margin = 28 * u;
  callouts.forEach((c, i) => {
    const side = c.side ?? (c.anchor[0] > sx ? 'right' : 'left');
    const mainSize = 36 * u;
    const detailSize = 24 * u;
    const detailLines = c.detail ? c.detail.split('\n') : [];
    const padX = 20 * u;
    const padY = 14 * u;
    const pw = Math.max(estimateWidth(c.text, mainSize, -3, 700), ...detailLines.map((line) => estimateWidth(line, detailSize, 0, 500))) + padX * 2;
    const ph = padY * 2 + mainSize * 1.05 + detailLines.length * detailSize * 1.2;
    const reach = 130 * u;
    let px = side === 'right' ? c.anchor[0] + reach : c.anchor[0] - reach - pw;
    let py = c.anchor[1] - 110 * u - ph / 2;
    px = clamp(px, margin, W - margin - pw);
    py = clamp(py, margin, H - margin - ph);
    const end: Vec = side === 'right' ? [px + 4 * u, py + ph - 8 * u] : [px + pw - 4 * u, py + ph - 8 * u];
    const a = c.anchor;
    const minX = Math.min(a[0], end[0]);
    const minY = Math.min(a[1], end[1]);
    const t0 = c.at;
    const lineDone = t0 + 0.38;
    const out = outAt;
    layers.push(ellipse(`co-${i}-ring`, 30 * u, { stroke: '#ffffff', strokeWidth: 2 * u }, {
      in: t0,
      transform: { position: a, scale: keys<number>([t0, 30, 'expo-out'], [t0 + 0.7, 130]), opacity: keys<number>([t0, 90, 'expo-out'], [t0 + 0.7, 0]) },
    }));
    layers.push(ellipse(`co-${i}-dot`, 12 * u, { fill: '#ffffff' }, {
      in: t0,
      transform: { position: a, scale: pop(t0, 0, 0.4), opacity: fade(t0, 0.15, out) },
      effects: [glowFx(10 * u, 0.9, '#ffffff')],
    }));
    layers.push({
      id: `co-${i}-line`,
      type: 'shape',
      in: t0,
      shape: { shape: 'line', points: [a[0] - minX, a[1] - minY, end[0] - minX, end[1] - minY], size: [Math.max(1, Math.abs(end[0] - a[0])), Math.max(1, Math.abs(end[1] - a[1]))], stroke: '#ffffffd9', strokeWidth: 2 * u, trimEnd: keys<number>([t0 + 0.05, 0, 'expo-out'], [lineDone, 100]) },
      transform: { anchor: [0, 0], position: [minX, minY], opacity: fade(t0, 0.1, out) },
    } as Layer);
    const glass = crimsonGlass(ctx, ph);
    const pillT = lineDone - 0.12;
    layers.push(rect(`co-${i}-pill`, [pw, ph], { gradient: glass.gradient, stroke: glass.stroke, strokeWidth: 1.5 * u, radius: 10 * u }, {
      in: pillT,
      motionBlur: true,
      backdrop: { blur: 22, saturation: 1.3, brightness: -6 },
      transform: {
        position: slide(pillT, [px + pw / 2, py + ph / 2], [side === 'right' ? -24 * u : 24 * u, 14 * u], 0.55, 'expo-out', out, [0, -12 * u]),
        scale: pop(pillT, 82, 0.55, 'back-out', out, 94),
        rotation: keys<number>([pillT, side === 'right' ? -7 : 7, 'expo-out'], [pillT + 0.6, 0]),
        opacity: fade(pillT, 0.22, out),
      },
      effects: [blurInOut(pillT, 16 * u, 0.45, out, 0.25), shadowFx(10 * u, 30 * u, 45)],
    }));
    const pillId = `co-${i}-pill`;
    layers.push(text(`co-${i}-text`, c.text, ctx, {
      parent: pillId,
      at: pillT + 0.18,
      size: mainSize,
      position: [padX, padY + mainSize * 0.55],
      align: 'left',
      by: 'char',
      stagger: 0.022,
      duration: 0.4,
      tracking: -3,
      from: { opacity: 0, blur: 10 * u, position: [8 * u, 0] },
      out,
    }));
    detailLines.forEach((line, j) => {
      layers.push(text(`co-${i}-detail-${j}`, line, ctx, {
        parent: pillId,
        at: pillT + 0.4 + j * 0.12,
        size: detailSize,
        weight: 500,
        color: '#ffe1e5',
        position: [padX, padY + mainSize * 1.05 + detailSize * (0.62 + j * 1.2)],
        align: 'left',
        by: 'word',
        stagger: 0.05,
        duration: 0.4,
        tracking: 0,
        from: { opacity: 0, blur: 8 * u, position: [0, 6 * u] },
        out,
      }));
    });
  });

  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'riser', note: 'silhouette fill' }, { at: at + 0.6, sound: 'impact', note: 'subject resolves' }];
  if (name) cues.push({ at: nameAt, sound: 'whoosh', note: 'name' });
  callouts.forEach((c) => cues.push({ at: c.at, sound: 'pop', note: c.text }));
  if (outAt !== null) cues.push({ at: outAt, sound: 'whoosh', note: 'out' });
  return scene(ctx, duration, layers, { background: p.void, cues, template: { id: 'cutout-stage', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── T15 split rules panel ─────────────────────────

export type SplitRulesParams = {
  footage?: Footageish;
  title?: string;
  subtitle?: string;
  rules?: { text: string; at: number }[];
  /** Where the black panel sits: right (default) / left; portrait always puts it at the bottom. */
  side?: 'left' | 'right';
  /** Fraction of the frame the footage keeps (0.3–0.7). */
  split?: number;
  at?: number;
  outAt?: number | null;
  duration?: number;
};

export function splitRulesPanel(ctx: KitContext, params: SplitRulesParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const tall = portrait(ctx);
  const at = params.at ?? 0.15;
  const split = clamp(params.split ?? 0.5, 0.3, 0.7);
  const side = params.side ?? 'right';
  const rules = [...(params.rules ?? [])].sort((a, b) => a.at - b.at);
  const title = params.title ?? '3 RULES';
  const subtitle = params.subtitle ?? '';
  const outAt = params.outAt ?? null;
  const lastRule = rules.length ? rules[rules.length - 1].at : at + 1.5;
  const duration = params.duration ?? Math.max(3.5, (outAt ?? lastRule + 1.8) + (outAt ? 0.7 : 0));
  const move = 0.75;
  const ease: Ease = 'expo-in-out';

  // Footage: pushed aside and cropped by an animated mask.
  const footageLayer: Layer = {
    id: 'footage',
    name: 'Footage',
    type: 'footage',
    source: src(params.footage),
    fit: 'cover',
    transform: {},
    masks: [],
  } as Layer;
  // Panel box on the canvas.
  let panel: [number, number, number, number];
  let panelFrom: Vec;
  if (tall) {
    // Portrait: the shot is its own W × fh layer (a sensible crop of a landscape source) that
    // starts scaled up to cover the canvas and settles into the top region.
    const fh = H * split;
    const cover = Math.max(H / fh, 1) * 100;
    Object.assign(footageLayer, { size: [W, fh] });
    footageLayer.transform = { position: keys<Vec>([at, [W / 2, H / 2], ease], [at + move, [W / 2, fh / 2]]), scale: keys<number>([at, cover, ease], [at + move, 100]) };
    footageLayer.masks = [];
    panel = [0, fh, W, H - fh];
    panelFrom = [W / 2, H + (H - fh) / 2];
  } else {
    const fw = W * split;
    const fx = side === 'right' ? fw / 2 : W - fw / 2;
    footageLayer.transform = { position: keys<Vec>([at, [W / 2, H / 2], ease], [at + move, [fx, H / 2]]) };
    footageLayer.masks = [{ shape: 'rect', box: keys<Vec>([at, [0, 0, W, H], ease], [at + move, [W / 2 - fw / 2, 0, fw, H]]) }];
    panel = side === 'right' ? [fw, 0, W - fw, H] : [0, 0, W - fw, H];
    panelFrom = side === 'right' ? [W + (W - fw) / 2, H / 2] : [-(W - fw) / 2, H / 2];
  }
  const [bx, by, bw, bh] = panel;
  const panelRest: Vec = [bx + bw / 2, by + bh / 2];
  // Flare sits in the panel corner away from the footage.
  const flareCentre: Vec = tall ? [0.92, 0.95] : side === 'right' ? [0.95, 0.92] : [0.05, 0.92];
  const layers: Layer[] = [
    { id: 'bg', type: 'solid', color: '#000000' },
    footageLayer,
    {
      id: 'panel',
      name: 'Panel',
      type: 'procedural',
      kind: 'radial-glow',
      params: { inner: shade(p.crimson, -0.05), outer: '#000000', center: flareCentre, radius: 0.62 },
      size: [bw, bh],
      motionBlur: true,
      transform: { position: keys<Vec>([at, panelFrom, ease], [at + move, panelRest]) },
    } as Layer,
    {
      id: 'flare',
      name: 'Crimson flare',
      type: 'procedural',
      kind: 'light-leak',
      params: { color1: p.accent, color2: p.crimson, color3: '#ff6a7a', speed: 0.25, intensity: 0.8 },
      size: [bw, bh],
      parent: 'panel',
      blend: 'screen',
      transform: { position: [bw / 2, bh / 2], opacity: keys<number>([at + move * 0.6, 0, 'sine-in-out'], [at + move + 0.8, 55]) },
      masks: [{ shape: 'ellipse', box: [bw * (flareCentre[0] - 0.75), bh * (flareCentre[1] - 0.7), bw * 1.5, bh * 1.4], feather: Math.min(bw, bh) * 0.35 }],
    } as Layer,
    // A soft light streak through the flare corner, drifting slowly (the reference's red swoosh).
    {
      id: 'flare-streak',
      name: 'Flare streak',
      type: 'shape',
      parent: 'panel',
      blend: 'screen',
      shape: { shape: 'ellipse', size: [Math.max(bw, bh) * 0.85, Math.min(bw, bh) * 0.16], gradient: { kind: 'radial', stops: [[0, alpha('#ff7a88', 0.85)], [0.45, alpha(p.accent, 0.4)], [1, alpha(p.crimson, 0)]] } },
      transform: {
        position: keys<Vec>([at + move * 0.5, [bw * (flareCentre[0] * 0.8 + 0.1) + (flareCentre[0] > 0.5 ? 40 : -40) * u, bh * 0.82], 'sine-in-out'], [duration, [bw * (flareCentre[0] * 0.8 + 0.1), bh * 0.76]]),
        rotation: keys<number>([at, flareCentre[0] > 0.5 ? -38 : 38, 'sine-in-out'], [duration, flareCentre[0] > 0.5 ? -30 : 30]),
        opacity: keys<number>([at + move * 0.5, 0, 'sine-in-out'], [at + move + 0.9, 80]),
      },
      effects: [blurFx(Math.min(bw, bh) * 0.05)],
    } as Layer,
    // A thin light seam where footage meets panel.
    rect('seam', tall ? [W, 2 * u] : [2 * u, H], { fill: alpha(p.pink, 0.35) }, {
      parent: 'panel',
      transform: { position: tall ? [bw / 2, 0] : side === 'right' ? [0, bh / 2] : [bw, bh / 2], opacity: keys<number>([at + move * 0.8, 0, 'expo-out'], [at + move + 0.3, 100]) },
    }),
  ];

  const inset = (tall ? 64 : 56) * u;
  const contentW = bw - inset * 2;
  const titleSize = Math.min((tall ? 130 : 118) * u, contentW / Math.max(1, estimateWidth(title, 1, -4, 800)));
  const titleY = by + inset + titleSize * 0.45;
  const textAt = at + move * 0.7;
  layers.push(text('title', title, ctx, {
    at: textAt,
    size: titleSize,
    weight: 800,
    position: [bx + inset, titleY],
    align: 'left',
    by: 'char',
    stagger: 0.03,
    tracking: -4,
    from: { opacity: 0, blur: 16 * u, position: [30 * u, 0] },
    out: outAt,
    glow: 14 * u,
  }));
  const subSize = Math.min((tall ? 52 : 44) * u, contentW / Math.max(1, estimateWidth(subtitle, 1, 0, 500)));
  const subY = titleY + titleSize * 0.52 + subSize * 0.9;
  if (subtitle) {
    layers.push(text('subtitle', subtitle, ctx, {
      at: textAt + 0.2,
      size: subSize,
      weight: 500,
      position: [bx + inset, subY],
      align: 'left',
      by: 'word',
      stagger: 0.06,
      tracking: 0,
      from: { opacity: 0, blur: 12 * u, position: [0, 10 * u] },
      out: outAt,
    }));
  }

  const pillH = (tall ? 96 : 84) * u;
  const gap = 16 * u;
  const numBox = pillH - 20 * u;
  const textSize = (tall ? 40 : 36) * u;
  let pillY = subY + subSize * 0.7 + 34 * u;
  const maxText = contentW - numBox - 52 * u;
  const sizeOfRule = (value: string) => Math.min(textSize, maxText / Math.max(1, estimateWidth(value, 1, -2, 600)));
  // One width for every pill (the longest rule), like a list.
  const pw = Math.min(contentW, Math.max(contentW * 0.7, ...rules.map((r) => estimateWidth(r.text, sizeOfRule(r.text), -2, 600) + numBox + 56 * u)));
  rules.forEach((rule, i) => {
    const size = sizeOfRule(rule.text);
    const cy = pillY + pillH / 2;
    const id = `rule-${i}`;
    const glass = crimsonGlass(ctx, pillH, 1.15);
    layers.push(rect(id, [pw, pillH], { gradient: glass.gradient, stroke: glass.stroke, strokeWidth: 1.5 * u, radius: 12 * u }, {
      in: rule.at,
      motionBlur: true,
      transform: {
        position: slide(rule.at, [bx + inset + pw / 2, cy], [70 * u, 0], 0.6, 'expo-out', outAt, [40 * u, 0]),
        scale: keys<number>([rule.at, 94, 'expo-out'], [rule.at + 0.6, 100]),
        opacity: fade(rule.at, 0.25, outAt),
      },
      effects: [blurInOut(rule.at, 18 * u, 0.5, outAt), shadowFx(10 * u, 28 * u, 50)],
    }));
    layers.push(rect(`${id}-num-box`, [numBox, numBox], { gradient: { kind: 'linear', stops: [[0, alpha(p.pink, 0.55)], [1, alpha(p.accent, 0.5)]], from: [0, 0], to: [0, numBox] }, stroke: '#ffffff66', strokeWidth: 1.2 * u, radius: 10 * u }, {
      parent: id,
      transform: { position: [10 * u + numBox / 2, pillH / 2], scale: pop(rule.at + 0.12, 40, 0.5), opacity: fade(rule.at + 0.12, 0.2, outAt) },
    }));
    layers.push(text(`${id}-num`, String(i + 1), ctx, {
      parent: `${id}-num-box`,
      at: rule.at + 0.16,
      size: numBox * 0.62,
      weight: 800,
      position: [numBox / 2, numBox / 2],
      align: 'center',
      by: 'char',
      from: { opacity: 0, blur: 8 * u, scale: 60 },
      out: outAt,
    }));
    layers.push(text(`${id}-text`, rule.text, ctx, {
      parent: id,
      at: rule.at + 0.2,
      size,
      weight: 600,
      position: [10 * u + numBox + 18 * u, pillH / 2],
      align: 'left',
      by: 'word',
      stagger: 0.05,
      duration: 0.45,
      tracking: -2,
      from: { opacity: 0, blur: 10 * u, position: [12 * u, 0] },
      out: outAt,
    }));
    pillY += pillH + gap;
  });

  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'whoosh', note: 'panel in' }, ...rules.map((r) => ({ at: r.at, sound: 'pop' as const, note: r.text }))];
  if (outAt !== null) cues.push({ at: outAt, sound: 'whoosh', note: 'out' });
  return scene(ctx, duration, layers, { background: '#000000', cues, template: { id: 'split-rules-panel', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── T16 stat badges ─────────────────────────

export type BadgePosition = 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type Badge = {
  value: number;
  from?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label: string;
  icon?: string;
  position?: BadgePosition;
  at: number;
  /** Text that replaces the rolling number when it lands (e.g. "$1B+"), popping in. */
  swap?: string;
};

export type StatBadgesParams = { badges?: Badge[]; countDuration?: number; outAt?: number | null; duration?: number };

const formatNumber = (value: number, decimals: number) => {
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const [i, f] = fixed.split('.');
  return `${value < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
};

export function statBadges(ctx: KitContext, params: StatBadgesParams): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const tall = portrait(ctx);
  const badges = params.badges ?? [];
  const countDur = params.countDuration ?? 1.1;
  const outAt = params.outAt ?? null;
  const lastAt = badges.length ? Math.max(...badges.map((b) => b.at)) : 0;
  const duration = params.duration ?? Math.max(3, (outAt ?? lastAt + countDur + 1.4) + (outAt ? 0.5 : 0));
  const defaults: BadgePosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center'];

  const valueSize = 80 * u;
  const labelSize = 27 * u;
  const iconBox = 88 * u;
  const pad = 20 * u;
  const bh = iconBox + pad * 2;
  const marginX = (tall ? 48 : 64) * u;
  const marginY = (tall ? 150 : 64) * u;

  type Placed = { b: Badge; i: number; w: number; h: number; x: number; y: number; pos: BadgePosition };
  const placed: Placed[] = [];
  badges.forEach((b, i) => {
    const pos = b.position ?? defaults[i % defaults.length];
    const decimals = b.decimals ?? 0;
    const fmt = (v: number) => `${b.prefix ?? ''}${formatNumber(v, decimals)}${b.suffix ?? ''}`;
    const valueW = Math.max(estimateWidth(fmt(b.value), valueSize, -4, 800), estimateWidth(fmt(b.from ?? 0), valueSize, -4, 800), b.swap ? estimateWidth(b.swap, valueSize, -4, 800) : 0);
    const w = Math.min(W - marginX * 2, pad + iconBox + 16 * u + Math.max(valueW, estimateWidth(b.label, labelSize, 0, 500)) + pad * 1.6);
    const [v, h] = pos.split('-') as ['top' | 'center' | 'bottom', 'left' | 'center' | 'right'];
    const x = h === 'left' ? marginX : h === 'right' ? W - marginX - w : (W - w) / 2;
    let y = v === 'top' ? marginY : v === 'bottom' ? H - marginY - bh : (H - bh) / 2;
    // Resolve overlaps with earlier badges: stack away from the edge they hug.
    const dir = v === 'bottom' ? -1 : 1;
    for (let guard = 0; guard < 12; guard++) {
      const hit = placed.find((o) => x < o.x + o.w + 12 * u && o.x < x + w + 12 * u && y < o.y + o.h + 12 * u && o.y < y + bh + 12 * u);
      if (!hit) break;
      y = dir > 0 ? hit.y + hit.h + 16 * u : hit.y - bh - 16 * u;
    }
    placed.push({ b, i, w, h: bh, x, y, pos });
  });

  const layers: Layer[] = [];
  for (const { b, i, w, h, x, y, pos } of placed) {
    const id = `badge-${i}`;
    const t0 = b.at;
    const fromTop = pos.startsWith('top') || (pos.startsWith('center') && y < H / 2);
    const glass = crimsonGlass(ctx, h, 0.92);
    layers.push(rect(id, [w, h], { gradient: glass.gradient, stroke: glass.stroke, strokeWidth: 1.5 * u, radius: 16 * u }, {
      in: t0,
      name: `Badge ${b.label}`,
      motionBlur: true,
      backdrop: { blur: 24, saturation: 1.35, brightness: -4 },
      transform: {
        position: slide(t0, [x + w / 2, y + h / 2], [0, (fromTop ? -26 : 26) * u], 0.6, 'expo-out', outAt, [0, (fromTop ? -20 : 20) * u]),
        scale: pop(t0, 72, 0.55, 'back-out', outAt, 88),
        opacity: fade(t0, 0.22, outAt),
      },
      effects: [blurInOut(t0, 20 * u, 0.45, outAt), shadowFx(14 * u, 36 * u, 50)],
    }));
    // Icon tile.
    layers.push(rect(`${id}-icon-box`, [iconBox, iconBox], { gradient: { kind: 'linear', stops: [[0, '#ffffff38'], [1, '#ffffff14']], from: [0, 0], to: [0, iconBox] }, stroke: '#ffffff55', strokeWidth: 1.2 * u, radius: iconBox * 0.28 }, {
      parent: id,
      transform: { position: [pad + iconBox / 2, h / 2], scale: pop(t0 + 0.1, 40, 0.5), opacity: fade(t0 + 0.1, 0.2, outAt) },
    }));
    layers.push(text(`${id}-icon`, b.icon ?? '★', ctx, {
      parent: `${id}-icon-box`,
      at: t0 + 0.14,
      size: iconBox * 0.5,
      position: [iconBox / 2, iconBox / 2],
      align: 'center',
      by: 'char',
      from: { opacity: 0, blur: 6 * u, scale: 50, rotation: -30 },
      out: outAt,
    }));
    const textX = pad + iconBox + 16 * u;
    const valueY = h * 0.4;
    const countAt = t0 + 0.12;
    const landAt = countAt + countDur;
    layers.push({
      id: `${id}-value`,
      name: `${b.label} value`,
      type: 'text',
      parent: id,
      transform: { position: [textX, valueY], ...(b.swap ? { opacity: keys<number>([landAt - 0.02, 100, 'expo-in'], [landAt + 0.08, 0]) } : {}) },
      text: {
        font: ctx.font,
        size: valueSize,
        weight: 800,
        color: '#ffffff',
        align: 'left',
        tracking: -4,
        counter: { value: keys<number>([countAt, b.from ?? 0, 'quart-out'], [landAt, b.value]), decimals: b.decimals ?? 0, format: `${b.prefix ?? ''}{n}${b.suffix ?? ''}` },
        cascade: { by: 'line', delay: t0 + 0.08, duration: 0.45, ease: 'expo-out', from: { opacity: 0, blur: 12 * u, position: [10 * u, 0] }, ...(outAt !== null ? { exit: { at: outAt, duration: 0.25, to: { opacity: 0, blur: 10 * u } } } : {}) },
      },
      effects: [glowFx(12 * u, 0.4)],
    } as Layer);
    if (b.swap) {
      layers.push(text(`${id}-swap`, b.swap, ctx, {
        parent: id,
        at: landAt,
        size: valueSize,
        weight: 800,
        position: [textX, valueY],
        align: 'left',
        by: 'line',
        duration: 0.45,
        tracking: -4,
        from: { opacity: 0, blur: 10 * u, scale: 135 },
        out: outAt,
        glow: 12 * u,
      }));
    }
    layers.push(text(`${id}-label`, b.label, ctx, {
      parent: id,
      at: t0 + 0.22,
      size: labelSize,
      weight: 500,
      color: '#ffe1e5',
      position: [textX + 2 * u, h * 0.76],
      align: 'left',
      by: 'word',
      stagger: 0.05,
      tracking: 0,
      from: { opacity: 0, blur: 8 * u, position: [0, 6 * u] },
      out: outAt,
    }));
  }
  const cues: NonNullable<MotionScene['cues']> = badges.map((b) => ({ at: b.at, sound: 'pop' as const, note: b.label }));
  badges.filter((b) => b.swap).forEach((b) => cues.push({ at: b.at + 0.12 + countDur, sound: 'impact', note: b.swap }));
  if (outAt !== null) cues.push({ at: outAt, sound: 'whoosh', note: 'out' });
  return scene(ctx, duration, layers, { background: null, cues, template: { id: 'stat-badges', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── T17 dock + cursor ─────────────────────────

export type DockIcon = { label: string; color: string; glyph?: string };
export type DockCursorParams = { icons?: DockIcon[]; clicks?: { index: number; at: number }[]; at?: number; outAt?: number | null; duration?: number; /** Dock centre y as a fraction of the height. */ y?: number };

/** Arrow cursor outline, tip at (0, 0), in 1/20ths of its height. */
const ARROW = [0, 0, 0, 17.2, 4.1, 13.4, 6.9, 19.6, 9.6, 18.4, 6.9, 12.3, 12.3, 12.3];

export function dockCursor(ctx: KitContext, params: DockCursorParams): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const tall = portrait(ctx);
  const icons = params.icons?.length ? params.icons : [{ label: 'Finder', color: '#3b82f6', glyph: 'F' }];
  const at = params.at ?? 0.1;
  const clicks = [...(params.clicks ?? [])].filter((c) => c.index >= 0 && c.index < icons.length).sort((a, b) => a.at - b.at);
  const outAt = params.outAt ?? null;
  const lastClick = clicks.length ? clicks[clicks.length - 1].at : at + 1;
  const duration = params.duration ?? Math.max(3, (outAt ?? lastClick + 1.2) + (outAt ? 0.5 : 0));

  const n = icons.length;
  let ts = (tall ? 110 : 88) * u;
  let gap = 16 * u;
  const padD = 14 * u;
  const maxW = W * 0.9;
  const natural = n * ts + (n - 1) * gap + padD * 2;
  if (natural > maxW) { const k = maxW / natural; ts *= k; gap *= k; }
  const dw = n * ts + (n - 1) * gap + padD * 2;
  const dh = ts + padD * 2;
  const cy = H * (params.y ?? (tall ? 0.78 : 0.82));
  const dockLeft = W / 2 - dw / 2;
  const tileCentre = (i: number): Vec => [padD + ts / 2 + i * (ts + gap), dh / 2];
  const tileCanvas = (i: number): Vec => [dockLeft + tileCentre(i)[0], cy - dh / 2 + tileCentre(i)[1]];

  const layers: Layer[] = [
    rect('dock', [dw, dh], { gradient: { kind: 'linear', stops: [[0, '#2a2a30b8'], [1, '#121216cc']], from: [0, 0], to: [0, dh] }, stroke: '#ffffff5c', strokeWidth: 1.5 * u, radius: 22 * u }, {
      name: 'Dock',
      in: at,
      motionBlur: true,
      backdrop: { blur: 26, saturation: 1.4, brightness: -10 },
      transform: {
        position: slide(at, [W / 2, cy], [0, 90 * u], 0.65, 'expo-out', outAt, [0, 60 * u], 0.35),
        scale: keys<number>([at, 90, 'expo-out'], [at + 0.65, 100]),
        opacity: fade(at, 0.25, outAt),
      },
      effects: [blurInOut(at, 20 * u, 0.5, outAt), shadowFx(16 * u, 40 * u, 55)],
    }),
  ];

  // Per tile: the state after each click (lifted + highlighted until the next click).
  const clickTimes = clicks.map((c) => c.at);
  icons.forEach((icon, i) => {
    const id = `tile-${i}`;
    const t0 = at + 0.12 + i * 0.06;
    const [x, y] = tileCentre(i);
    const posK: Key<Vec>[] = [{ t: t0, v: [x, y + 26 * u], ease: 'back-out' }, { t: t0 + 0.5, v: [x, y] }];
    const scaleK: Key<number>[] = [{ t: t0, v: 40, ease: 'back-out' }, { t: t0 + 0.5, v: 100 }];
    clicks.forEach((c, k) => {
      if (c.index !== i) return;
      const release = k + 1 < clickTimes.length ? clickTimes[k + 1] : null;
      posK.push({ t: c.at, v: [x, y], ease: 'cubic-out' }, { t: c.at + 0.07, v: [x, y + 4 * u], ease: 'back-out' }, { t: c.at + 0.45, v: [x, y - 16 * u] });
      scaleK.push({ t: c.at, v: 100, ease: 'cubic-out' }, { t: c.at + 0.07, v: 86, ease: 'back-out' }, { t: c.at + 0.45, v: 114 });
      if (release !== null) {
        posK.push({ t: release, v: [x, y - 16 * u], ease: 'expo-out' }, { t: release + 0.4, v: [x, y] });
        scaleK.push({ t: release, v: 114, ease: 'expo-out' }, { t: release + 0.4, v: 100 });
      }
    });
    const base = hex6(icon.color);
    layers.push(rect(id, [ts, ts], { gradient: { kind: 'linear', stops: [[0, shade(base, 0.28)], [1, shade(base, -0.18)]], from: [0, 0], to: [0, ts] }, stroke: '#ffffff40', strokeWidth: 1 * u, radius: ts * 0.24 }, {
      name: icon.label,
      parent: 'dock',
      transform: { position: { k: posK }, scale: { k: scaleK }, opacity: fade(t0, 0.2, outAt) },
      effects: [shadowFx(4 * u, 10 * u, 35)],
    }));
    layers.push(text(`${id}-glyph`, icon.glyph ?? icon.label.slice(0, 1).toUpperCase(), ctx, {
      parent: id,
      at: t0 + 0.05,
      size: ts * 0.46,
      weight: 800,
      color: luminance(base) > 0.62 ? '#16161a' : '#ffffff',
      position: [ts / 2, ts / 2],
      align: 'center',
      by: 'line',
      duration: 0.4,
      tracking: 0,
      from: { opacity: 0, blur: 6 * u, scale: 60 },
      out: outAt,
    }));
  });

  // Click feedback: a ring from the tile and a tooltip with the label above it.
  clicks.forEach((c, k) => {
    const [x, y] = tileCanvas(c.index);
    const release = k + 1 < clickTimes.length ? clickTimes[k + 1] : outAt;
    layers.push(ellipse(`click-ring-${k}`, ts * 1.05, { stroke: '#ffffff', strokeWidth: 3 * u }, {
      in: c.at,
      out: c.at + 0.6,
      transform: { position: [x, y], scale: keys<number>([c.at, 70, 'expo-out'], [c.at + 0.55, 165]), opacity: keys<number>([c.at, 85, 'expo-out'], [c.at + 0.55, 0]) },
    }));
    const label = icons[c.index].label;
    const tipSize = Math.max(16, 26 * u);
    const tw = estimateWidth(label, tipSize, 0, 600) + 28 * u;
    const th = tipSize + 18 * u;
    const tipY = y - ts / 2 - 16 * u - 22 * u - th / 2;
    const tipX = clamp(x, tw / 2 + 12 * u, W - tw / 2 - 12 * u);
    const tipAt = c.at + 0.12;
    const tipOut = release !== null && release !== undefined ? Math.max(tipAt + 0.4, release - 0.35) : null;
    layers.push(rect(`tip-${k}`, [tw, th], { fill: '#1b1b20e6', stroke: '#ffffff40', strokeWidth: 1 * u, radius: th / 2 }, {
      in: tipAt,
      ...(tipOut !== null ? { out: tipOut + 0.3 } : {}),
      transform: { position: slide(tipAt, [tipX, tipY], [0, 10 * u], 0.45, 'expo-out', tipOut, [0, 6 * u], 0.2), scale: pop(tipAt, 80, 0.45, 'back-out', tipOut, 92, 0.2), opacity: fade(tipAt, 0.18, tipOut, 0.2) },
      effects: [blurInOut(tipAt, 10 * u, 0.35, tipOut, 0.2)],
    }));
    layers.push(text(`tip-${k}-label`, label, ctx, {
      parent: `tip-${k}`,
      at: tipAt + 0.05,
      size: tipSize,
      weight: 600,
      position: [tw / 2, th / 2],
      align: 'center',
      by: 'line',
      duration: 0.35,
      tracking: 0,
      from: { opacity: 0, blur: 6 * u },
      out: tipOut,
    }));
  });

  // The cursor: x and y ride separate eases (on a null + child) so the path curves.
  const cs = (tall ? 3.2 : 2.8) * u;
  const aim = (i: number): Vec => { const [x, y] = tileCanvas(i); return [x + ts * 0.08, y + ts * 0.12]; };
  const start: Vec = [Math.min(W - 40 * u, tileCanvas(n - 1)[0] + ts * 2.2), Math.min(H - 30 * u, cy + dh * 1.6)];
  const cursorIn = at + 0.35;
  const xs: Key<Vec>[] = [{ t: 0, v: [start[0], 0] }];
  const ys: Key<Vec>[] = [{ t: 0, v: [0, start[1]] }];
  let prevT = cursorIn;
  let prev = start;
  clicks.forEach((c) => {
    const target = aim(c.index);
    const travel = clamp(Math.hypot(target[0] - prev[0], target[1] - prev[1]) / (900 * u), 0.35, 0.75);
    const leave = Math.max(prevT, c.at - 0.08 - travel);
    const arrive = c.at - 0.06;
    xs.push({ t: leave, v: [prev[0], 0], ease: 'cubic-in-out' }, { t: arrive, v: [target[0], 0] });
    ys.push({ t: leave, v: [0, prev[1]], ease: target[1] < prev[1] ? 'quart-out' : 'sine-in-out' }, { t: arrive, v: [0, target[1]] });
    prev = target;
    prevT = c.at + 0.2;
  });
  const cursorScale: Key<number>[] = [{ t: cursorIn, v: 60, ease: 'back-out' }, { t: cursorIn + 0.4, v: 100 }];
  clicks.forEach((c) => cursorScale.push({ t: c.at - 0.05, v: 100, ease: 'cubic-out' }, { t: c.at + 0.02, v: 80, ease: 'back-out' }, { t: c.at + 0.28, v: 100 }));
  layers.push({ id: 'cursor-x', name: 'Cursor path', type: 'null', transform: { position: { k: xs }, anchor: [0, 0] } } as Layer);
  layers.push({
    id: 'cursor',
    name: 'Cursor',
    type: 'shape',
    parent: 'cursor-x',
    in: cursorIn,
    motionBlur: true,
    shape: { shape: 'path', points: ARROW.map((v) => v * cs), closed: true, size: [12.3 * cs, 19.6 * cs], fill: '#ffffff', stroke: '#111114', strokeWidth: 1.4 * u },
    transform: { anchor: [0, 0], position: { k: ys }, scale: { k: cursorScale }, opacity: fade(cursorIn, 0.2, outAt) },
    effects: [shadowFx(5 * u, 12 * u, 55)],
  } as Layer);

  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'whoosh', note: 'dock rises' }, ...clicks.map((c) => ({ at: c.at, sound: 'click' as const, note: icons[c.index].label }))];
  if (outAt !== null) cues.push({ at: outAt, sound: 'whoosh', note: 'out' });
  return scene(ctx, duration, layers, { background: null, cues, template: { id: 'dock-cursor', params: params as unknown as Record<string, unknown> } });
}

// ───────────────────────── specs ─────────────────────────

const FOOTAGE = 'footage { asset | path, in?, matte? } or a path string';

export const OVERLAY_TEMPLATES: TemplateSpec[] = [
  {
    id: 'frame-to-card',
    label: 'Frame to card',
    technique: 'T5',
    use: 'Turn the current shot into an object: the full frame shrinks into a rounded card with a light rim and shadow on the crimson stage, tilting slightly in 3D, then flies off (left/up) or pushes into depth to make room for the next beat. Use at a topic change or right before a card wall / social mock.',
    params: {
      footage: `${FOOTAGE} — the shot to shrink (required unless scene is given)`,
      scene: 'MotionScene — a whole scene to shrink instead (precomp)',
      at: 'number s (0.3) — when the shrink starts',
      scale: 'number % (58 landscape, 72 portrait) — card size',
      radius: 'number px @1080p (34) — card corner radius',
      exit: '"left" | "up" | "push" | "none" ("left")',
      exitAt: 'number s (at + 1.7)',
      tilt: 'number deg (8) — Y tilt while moving; settles to a third of it',
      next: `${FOOTAGE} — optional card that replaces it on exit`,
    },
    seconds: 2.8,
    fullFrame: true,
    build: (ctx, params) => frameToCard(ctx, params as FrameToCardParams),
  },
  {
    id: 'card-wall-3d',
    label: '3D card wall',
    technique: 'T6',
    use: 'A hook-montage beat: a wall of image/video cards flies in from depth at varied distances under a slow camera dolly (motion blur, far cards defocused), while short kinetic words land on top one after another and a headline stays. Use for "look how much there is" moments.',
    params: {
      images: `(${FOOTAGE})[] — card pictures, cycled across ~20 cards (UI-style panels when empty)`,
      words: '{ text, at }[] — words that land and hand over (default You / Great / Still manual…)',
      headline: 'string ("Unnecessarily Complex") — the line that lands last and stays',
      headlineAt: 'number s (last word + 0.7)',
      at: 'number s (0.1) — first card leaves the depth',
    },
    seconds: 4.5,
    fullFrame: true,
    build: (ctx, params) => cardWall3D(ctx, params as CardWallParams),
  },
  {
    id: 'cutout-stage',
    label: 'Cut-out on stage with callouts',
    technique: 'T3 T4',
    use: 'Introduce a person: their roto cut-out (clip with matte, or transparent PNG) appears on the crimson stage as a solid crimson→orange silhouette rising from the bottom that dissolves into the footage with an edge glow; name + role land beside them; callouts (dot → drawn line → glass pill with value and detail) point at the body.',
    params: {
      subject: `${FOOTAGE} — with matte (cut out automatically) or a transparent PNG (required)`,
      name: 'string — big name title',
      role: 'string — small line under the name',
      callouts: '{ anchor: [x, y] canvas px on the body, text, detail? ("\\n" for lines), at, side?: "left"|"right" }[]',
      at: 'number s (0.2) — silhouette fill start',
      subjectX: 'number canvas px (0.6 W landscape, 0.5 W portrait) — subject centre',
      subjectScale: 'number % (100)',
      fill: 'colour (accent)', fill2: 'colour (#ff8a1f) — gradient end of the silhouette',
      nameAt: 'number s (at + 1.05)',
      outAt: 'number s | null — everything exits',
    },
    seconds: 5,
    fullFrame: true,
    build: (ctx, params) => cutoutStage(ctx, params as CutoutStageParams),
  },
  {
    id: 'split-rules-panel',
    label: 'Split rules panel',
    technique: 'T15',
    use: 'A numbered list beside the speaker: the shot is pushed to one side and cropped while a black panel with a crimson flare slides in carrying a big title, a subtitle and numbered crimson pills that land as each rule is spoken. Portrait puts the panel under the shot.',
    params: {
      footage: `${FOOTAGE} — the talking head (required)`,
      title: 'string ("3 RULES")',
      subtitle: 'string',
      rules: '{ text, at }[] — each pill lands at its time',
      side: '"right" | "left" ("right") — where the panel sits (landscape)',
      split: 'number 0.3–0.7 (0.5) — share of the frame the footage keeps',
      at: 'number s (0.15)',
      outAt: 'number s | null',
    },
    seconds: 6,
    fullFrame: true,
    build: (ctx, params) => splitRulesPanel(ctx, params as SplitRulesParams),
  },
  {
    id: 'stat-badges',
    label: 'Stat badges (count-up)',
    technique: 'T16',
    use: 'Overlay proof numbers on the talking head: translucent crimson glass badges pop in (back-out + blur) with an icon, a number that rolls up to its value, and a small label; optionally the number swaps to a rounder figure when it lands ("$998M" → "$1B+").',
    params: {
      badges: '{ value, from? (0), prefix?, suffix?, decimals?, label, icon? (char/emoji), position?: "top-left"|"top-right"|"bottom-left"|"bottom-right"|"top-center"|"bottom-center"|"center-left"|"center-right", at, swap? }[]',
      countDuration: 'number s (1.1)',
      outAt: 'number s | null',
    },
    seconds: 3.5,
    fullFrame: false,
    build: (ctx, params) => statBadges(ctx, params as StatBadgesParams),
  },
  {
    id: 'dock-cursor',
    label: 'Dock with clicking cursor',
    technique: 'T17',
    use: 'Overlay a macOS-style dock of app tiles that rises from the bottom, and a cursor that glides along a curved path to click apps (the tile dips, bounces up and shows its name). Use when the speaker lists tools or apps.',
    params: {
      icons: '{ label, color, glyph? (letter/emoji; default first letter) }[]',
      clicks: '{ index, at }[] — which tile is clicked when',
      at: 'number s (0.1) — dock rises',
      y: 'number 0..1 (0.82 landscape, 0.78 portrait) — dock centre',
      outAt: 'number s | null',
    },
    seconds: 3.5,
    fullFrame: false,
    build: (ctx, params) => dockCursor(ctx, params as DockCursorParams),
  },
];
