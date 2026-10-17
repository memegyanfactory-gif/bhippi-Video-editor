// The brand film and the motion pack: pure builders from a brand kit to real motion-engine scenes.
//
// Nothing here draws pixels. Every function returns a `MotionScene` (src/motion/types.ts) built from
// the kit's own tokens through `motionBrandFromKit`: its colours, its display/heading/body faces,
// its ease, enter/stagger timings, travel distance, blur and its transition style. The Brand Studio
// previews them with the real renderer (`MotionLayer`), the AI places the very same scene with
// `brand_motion_pack` (create_motion_scene) and "Add to timeline" sends it through that tool, so
// what the studio shows is exactly what lands in an edit.
//
//   reelScene(kit, size)            the 10.4 s brand film (logo, tagline, type, palette light, lower third, end card)
//   packItems(kit)                  the 13 named pieces (ids are stable; the three stings follow the kit's motion intensity)
//   packScene(kit, id, size, opts)  one piece as a scene
import { ease as applyEase } from '../../motion/anim';
import { svgToShape } from '../../motion/vector/svg';
import type { Ease, Effect, Key, Layer, MotionScene, ShapeItem, Transform, Vec } from '../../motion/types';
import { motionBrandFromKit, type MotionBrand } from './motionBrand';
import type { BrandKit } from './types';
import { brandCopy } from './brandCopy';

// ── public surface ───────────────────────────────────────────────────────────

export const REEL_SECONDS = 11.6;

export type PackGroup = 'sting' | 'lower-third' | 'title' | 'transition' | 'end' | 'cta';
export type PackItem = { id: string; group: PackGroup; name: string; blurb: string; seconds: number; /** The scene second to show as a still: the piece at its hold, fully revealed (a transition: mid-wipe). */ poster: number };
export type SceneSize = { width: number; height: number };
export type Aspect = '16:9' | '9:16' | '1:1';
export const ASPECTS: Record<Aspect, SceneSize> = { '16:9': { width: 1920, height: 1080 }, '9:16': { width: 1080, height: 1920 }, '1:1': { width: 1080, height: 1080 } };

/** The words a piece shows; every field has a brand-derived default. */
export type PackCopy = { name?: string; tagline?: string; person?: string; role?: string; headline?: string; kicker?: string; cta?: string; handle?: string };
export type PackOptions = {
  /** Draw the brand stage behind (default true for full-frame pieces, false for overlays). */
  background?: boolean;
  copy?: PackCopy;
  /** Use the kit's imported logo file (a library asset) when it has no inline SVG; the Studio preview has no asset library. */
  assets?: boolean;
  /** Transitions: draw two plates under the wipe so a preview shows what it does. */
  demo?: boolean;
};

export type TransitionStyle = 'wipe' | 'push' | 'whip' | 'pop' | 'fade';

/** The kit's transition vocabulary ("wipe", "whip", "zoom-punch", "dissolve", …) as one of the five the engine builds. */
export function transitionStyleOf(kit: BrandKit): TransitionStyle {
  const first = (kit.motionGuide.transitions ?? []).map((t) => t.toLowerCase()).find((t) => t !== 'cut') ?? 'wipe';
  if (/push|slide/.test(first)) return 'push';
  if (/whip|swipe|spin/.test(first)) return 'whip';
  if (/zoom|punch|flash|pop|bounce|pixel|glitch/.test(first)) return 'pop';
  if (/fade|dissolve|cross/.test(first)) return 'fade';
  return 'wipe';
}

type StingVariant = 'clean' | 'bloom' | 'kinetic' | 'glitch' | 'punch';

const STINGS: Record<StingVariant, { name: string; blurb: string; seconds: number }> = {
  clean: { name: 'Clean reveal', blurb: 'Mark scales in, name rises through a mask, one light sweep.', seconds: 2.8 },
  bloom: { name: 'Soft bloom', blurb: 'Out of focus into focus on a slow glow.', seconds: 3.2 },
  kinetic: { name: 'Kinetic', blurb: 'The name springs in letter by letter, the mark spins home.', seconds: 2.6 },
  glitch: { name: 'Glitch energy', blurb: 'Signal tear, RGB split and a hard snap to rest.', seconds: 2.6 },
  punch: { name: 'Zoom punch', blurb: 'Slams in from close, shock ring, flash.', seconds: 2.4 },
};

/** Which three stings suit the kit: calm brands get restraint, energetic ones get the hits. */
export function stingVariants(kit: BrandKit): StingVariant[] {
  switch (kit.motionGuide.intensity) {
    case 'calm': return ['clean', 'bloom', 'kinetic'];
    case 'energetic': return ['kinetic', 'glitch', 'punch'];
    default: return ['clean', 'kinetic', 'glitch'];
  }
}

const FIXED: Omit<PackItem, 'poster'>[] = [
  { id: 'lower-third-panel', group: 'lower-third', name: 'Panel', blurb: 'A brand panel slides in with a name and role.', seconds: 4.2 },
  { id: 'lower-third-line', group: 'lower-third', name: 'Underline', blurb: 'Type rises through a mask over a drawn line.', seconds: 4.2 },
  { id: 'lower-third-tag', group: 'lower-third', name: 'Accent tag', blurb: 'A solid accent tag types the name on.', seconds: 4.2 },
  { id: 'title-statement', group: 'title', name: 'Statement', blurb: 'Big kinetic words with one accent word.', seconds: 3.8 },
  { id: 'title-chapter', group: 'title', name: 'Chapter', blurb: 'Outlined number, masked title, accent rule.', seconds: 3.8 },
  { id: 'transition-brand', group: 'transition', name: 'Brand transition', blurb: 'The brand’s own transition over a cut.', seconds: 1.1 },
  { id: 'transition-flash', group: 'transition', name: 'Light burst', blurb: 'A ring of brand light blooms over the cut.', seconds: 1.1 },
  { id: 'end-logo', group: 'end', name: 'Logo end card', blurb: 'Mark and tagline resolve, light sweeps through.', seconds: 4.4 },
  { id: 'end-next', group: 'end', name: 'Next up', blurb: 'Two video slots, handle and a subscribe pill.', seconds: 5 },
  { id: 'cta-subscribe', group: 'cta', name: 'Subscribe', blurb: 'A pill that gets pressed and answers.', seconds: 3.4 },
];

/** Where each piece rests fully built (seconds); falls back to the end minus a beat. */
const POSTER: Record<string, number> = {
  'sting-clean': 2.5, 'sting-bloom': 2.9, 'sting-kinetic': 2.35, 'sting-glitch': 2.35, 'sting-punch': 2.2,
  'lower-third-panel': 2.0, 'lower-third-line': 2.0, 'lower-third-tag': 2.0,
  'title-statement': 2.9, 'title-chapter': 2.9, 'transition-brand': 0.32, 'transition-flash': 0.32,
  'end-logo': 3.6, 'end-next': 3.3, 'cta-subscribe': 1.2,
};

/** The progress p (0–1) at which `kind`'s eased value reaches `value`: solved by bisection. */
function progressFor(kind: Ease, value: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (applyEase(kind, m) < value) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * The scene second where a transition's cover fills about a third of the frame, so a still shows
 * shot A on one side and shot B (or A) on the other. Measured from the keys transitionLayers writes:
 * a wipe's leading edge is at 34% of the width, a burst's circle is 35% of the frame diagonal, a veil is at 35% of its peak.
 */
export function coverPoster(style: TransitionStyle, enter: Ease, seconds = 1.1): number {
  const total = seconds * 0.9;
  const mid = seconds / 2;
  const t0 = mid - total / 2;
  if (style === 'pop') {
    const diag = Math.hypot(1920, 1080);
    const final = (diag / 1000) * 100;
    const target = (0.35 * diag) / 10;
    return t0 + progressFor('expo-out', (target - 4) / (final - 4)) * (mid - 0.02 - t0);
  }
  if (style === 'fade') return t0 + progressFor('sine-in-out', 0.35 / 0.86) * (mid - t0);
  // wipe, push, whip: the front slab (1.5 frames wide) travels from -0.8 to 0.3 frame widths; its leading edge is 0.75 ahead of its centre.
  const edge = 0.34;
  return t0 + progressFor(enter, (edge - 0.75 + 0.8) / 1.1) * (mid - 0.05 - t0);
}

export function packItems(kit: BrandKit): PackItem[] {
  const stings = stingVariants(kit).map((v) => ({ id: `sting-${v}`, group: 'sting' as const, ...STINGS[v] }));
  const style = transitionStyleOf(kit);
  const wipe = style === 'pop';
  // A transition's poster is mid-move, with both shots still showing: how long that takes depends on its style.
  const enter = motionBrandFromKit(kit).ease;
  const mid = (s: TransitionStyle) => coverPoster(s, enter);
  return [...stings, ...FIXED].map((item) => ({
    ...item,
    name: wipe && item.id === 'transition-flash' ? 'Wipe' : item.name,
    poster: item.id === 'transition-brand' ? mid(style) : item.id === 'transition-flash' ? mid(wipe ? 'wipe' : 'pop') : POSTER[item.id] ?? Math.max(0, item.seconds - 0.4),
  }));
}

export const PACK_IDS = [...Object.keys(STINGS).map((v) => `sting-${v}`), ...FIXED.map((i) => i.id)];

export function packScene(kit: BrandKit, id: string, size: SceneSize, options: PackOptions = {}): MotionScene | null {
  const c = context(kit, size, options);
  const sting = /^sting-(clean|bloom|kinetic|glitch|punch)$/.exec(id);
  if (sting) return sealed(c, sting[0] === id ? stingScene(c, sting[1] as StingVariant, options) : null);
  switch (id) {
    case 'lower-third-panel': return sealed(c, lowerThird(c, 'panel', options));
    case 'lower-third-line': return sealed(c, lowerThird(c, 'line', options));
    case 'lower-third-tag': return sealed(c, lowerThird(c, 'tag', options));
    case 'title-statement': return sealed(c, titleStatement(c, options));
    case 'title-chapter': return sealed(c, titleChapter(c, options));
    case 'transition-brand': return sealed(c, transitionPiece(c, options, false));
    case 'transition-flash': return sealed(c, transitionPiece(c, options, true));
    case 'end-logo': return sealed(c, endLogo(c, options));
    case 'end-next': return sealed(c, endNext(c, options));
    case 'cta-subscribe': return sealed(c, ctaSubscribe(c, options));
    default: return null;
  }
}

export function reelScene(kit: BrandKit, size: SceneSize = ASPECTS['16:9'], options: PackOptions = {}): MotionScene {
  const c = context(kit, size, options);
  return sealed(c, buildReel(c, options))!;
}

/** The create_motion_scene arguments that place a piece (what the AI tool and "Add to timeline" send). */
export function packPlacement(kit: BrandKit, id: string, size: SceneSize, start: number, options: PackOptions = {}) {
  const scene = id === 'reel' ? reelScene(kit, size, options) : packScene(kit, id, size, options);
  if (!scene) return null;
  const title = id === 'reel' ? `${kit.name} brand film` : `${kit.name} · ${packItems(kit).find((i) => i.id === id)?.name ?? id}`;
  return { scene, title, args: { scene, start, title, duration: scene.duration, fit: false, useBrand: false, sfx: false } };
}

// ── colour and number helpers ────────────────────────────────────────────────

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  if (!isHex(hex)) return 0;
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a: string, b: string, t: number) => {
  if (!isHex(a) || !isHex(b)) return a;
  const x = rgb(a); const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const alpha = (hex: string, a: number) => (isHex(hex) ? `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}` : hex);
const onColour = (bg: string, b: MotionBrand) => (lum(bg) > 0.4 ? (lum(b.colors.text) < 0.3 ? b.colors.text : '#0a0a0a') : lum(b.colors.text) > 0.6 ? b.colors.text : '#ffffff');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const cased = (text: string, transform: string) => (transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text);

// ── the build context ────────────────────────────────────────────────────────

type Logo = { groups: ShapeItem[]; bounds: [number, number] };

type C = {
  kit: BrandKit;
  b: MotionBrand;
  w: number;
  h: number;
  u: number;
  cx: number;
  cy: number;
  land: boolean;
  port: boolean;
  logo: Logo | null;
  assetLogo: string | null;
  trans: TransitionStyle;
  /** Entrance length: the guideline's enter time, never snappier than 0.45 s. */
  dur: number;
  n: number;
  /** The stage tone of the section being built: what its type must read against. */
  tone: Tone;
  copy: Required<PackCopy>;
};

function context(kit: BrandKit, size: SceneSize, options: PackOptions): C {
  const b = motionBrandFromKit(kit);
  const w = size.width;
  const h = size.height;
  const svg = (kit.logos.find((l) => l.role === 'primary' && l.svg) ?? kit.logos.find((l) => l.svg))?.svg ?? null;
  let logo: Logo | null = null;
  if (svg) {
    try {
      const shape = svgToShape(svg, { fit: [1000, 1000], color: b.colors.text });
      if (shape.groups.length && shape.bounds[0] > 0 && shape.bounds[1] > 0) logo = { groups: shape.groups, bounds: shape.bounds };
    } catch { logo = null; }
  }
  const given = options.copy ?? {};
  const words = brandCopy(kit);
  const tagline = given.tagline ?? words.tagline;
  return {
    kit, b, w, h, u: Math.min(w, h) / 1080, cx: w / 2, cy: h / 2, land: w >= h * 1.2, port: h >= w * 1.2, logo,
    assetLogo: options.assets && !logo ? b.logoAsset : null,
    trans: transitionStyleOf(kit),
    dur: clamp(b.enter * 1.25, 0.45, 0.95),
    n: 0,
    tone: 'brand',
    copy: {
      name: given.name ?? b.name, tagline, person: given.person ?? 'Alex Morgan', role: given.role ?? 'Creative Director',
      headline: given.headline ?? (given.tagline ? given.tagline : words.headline), kicker: given.kicker ?? b.name, cta: given.cta ?? 'Subscribe', handle: given.handle ?? `@${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
    },
  };
}

const nid = (c: C, prefix: string) => `${prefix}-${++c.n}`;

function sealed(c: C, built: { duration: number; layers: Layer[]; background?: string | null } | null): MotionScene | null {
  if (!built) return null;
  return {
    version: 1, width: c.w, height: c.h, duration: built.duration, layers: built.layers, motionBlur: { samples: 8, shutter: 160 },
    ...(built.background ? { background: built.background } : {}), seed: 7,
    brand: { kitId: c.b.kitId, name: c.b.name, snapshot: c.b },
  };
}

// ── primitives ───────────────────────────────────────────────────────────────

const step = (c: C, role: 'display' | 'heading' | 'subhead' | 'label' | 'body') => c.b.guideline.typeScale.find((s) => s.role === role) ?? c.b.guideline.typeScale[0];
const keys = <T extends number | Vec>(...list: [number, T, Ease?][]): { k: Key<T>[] } => ({ k: list.map(([t, v, ease]) => ({ t, v, ...(ease ? { ease } : {}) }) as Key<T>) });

type Enter = { at: number; dur?: number; dx?: number; dy?: number; s0?: number; rot0?: number; blur?: number; ease?: Ease; fade?: number; out?: { at: number; dur?: number; dy?: number; dx?: number; s1?: number } };

/** An entrance (and optional exit) on any layer: travel, scale, rotation, blur-to-sharp and fade, in scene seconds. */
function put<L extends Layer>(c: C, layer: L, base: Vec, e: Enter): L {
  const dur = e.dur ?? c.dur;
  const ease = e.ease ?? c.b.ease;
  const t: Transform = { ...(layer.transform ?? {}) };
  const moves = !!(e.dx || e.dy || e.out?.dy || e.out?.dx);
  const posKeys: Key<Vec>[] = [];
  if (e.dx || e.dy) posKeys.push({ t: e.at, v: [base[0] + (e.dx ?? 0) * c.u, base[1] + (e.dy ?? 0) * c.u], ease });
  else if (moves) posKeys.push({ t: e.at, v: base });
  posKeys.push({ t: e.at + dur, v: base, ...(e.out ? { ease: c.b.easeIn } : {}) });
  if (e.out && (e.out.dx || e.out.dy)) {
    posKeys[posKeys.length - 1] = { ...posKeys[posKeys.length - 1], t: e.out.at };
    posKeys.push({ t: e.out.at + (e.out.dur ?? 0.4), v: [base[0] + (e.out.dx ?? 0) * c.u, base[1] + (e.out.dy ?? 0) * c.u] });
  }
  t.position = moves ? { k: posKeys } : base;
  const opacity: Key<number>[] = [{ t: e.at, v: 0, ease: 'sine-out' }, { t: e.at + (e.fade ?? dur * 0.5), v: 100 }];
  if (e.out) opacity.push({ t: e.out.at, v: 100, ease: 'sine-in' }, { t: e.out.at + (e.out.dur ?? 0.4) * 0.8, v: 0 });
  t.opacity = { k: opacity };
  if ((e.s0 !== undefined && e.s0 !== 1) || e.out?.s1) {
    const s: Key<number>[] = [{ t: e.at, v: (e.s0 ?? 1) * 100, ease }, { t: e.at + dur, v: 100 }];
    if (e.out?.s1) { s[1] = { ...s[1], t: e.out.at, ease: c.b.easeIn }; s.push({ t: e.out.at + (e.out.dur ?? 0.4), v: e.out.s1 * 100 }); }
    t.scale = { k: s };
  }
  if (e.rot0) t.rotation = keys<number>([e.at, e.rot0, ease], [e.at + dur, 0]);
  const effects: Effect[] = [...(layer.effects ?? [])];
  if (e.blur) effects.push({ type: 'gaussian-blur', blurriness: { k: [{ t: e.at, v: e.blur * c.u, ease: 'quart-out' }, { t: e.at + dur * 0.85, v: 0 }] } } as Effect);
  return { ...layer, transform: t, effects, ...(e.out ? { out: e.out.at + (e.out.dur ?? 0.4) + 0.02 } : {}) } as L;
}

const within = <L extends Layer>(layer: L, a: number, z: number): L => ({ ...layer, in: a, out: z }) as L;

function rect(id: string, size: Vec, fill: string | null, extra: Record<string, unknown> = {}, radius = 0): Layer {
  return { id, name: id, type: 'shape', shape: { shape: 'rect', size, radius, fill }, ...extra } as Layer;
}
function ellipse(id: string, size: Vec, fill: string, extra: Record<string, unknown> = {}): Layer {
  return { id, name: id, type: 'shape', shape: { shape: 'ellipse', size, fill }, ...extra } as Layer;
}

type TextOpts = {
  role?: 'display' | 'heading' | 'subhead' | 'label' | 'body';
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  box?: number;
  font?: string;
  weight?: number;
  tracking?: number;
  upper?: boolean;
  keepCase?: boolean;
  italic?: boolean;
  extra?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

/** Text in the brand's type scale step; `size` is px on this canvas. Width is fitted to `box` by shrinking. */
function textLayer(c: C, id: string, value: string, o: TextOpts = {}): Layer {
  const st = step(c, o.role ?? 'heading');
  const { wrap, ...data } = (o.data ?? {}) as Record<string, unknown> & { wrap?: boolean };
  const text = o.keepCase ? value : cased(value, o.upper ? 'uppercase' : st.transform);
  let size = o.size ?? st.size * c.u;
  if (o.box && !wrap) {
    const longest = Math.max(1, ...text.split('\n').map((l) => l.length));
    const est = longest * size * (st.weight >= 700 ? 0.6 : 0.54);
    if (est > o.box) size = Math.max(size * 0.4, size * (o.box / est));
  }
  return {
    id, name: value.slice(0, 28), type: 'text',
    text: {
      text, font: o.font ?? st.family, weight: o.weight ?? st.weight, size, color: o.color ?? st.color, align: o.align ?? 'center',
      tracking: o.tracking ?? st.tracking, lineHeight: st.lineHeight, ...(o.italic ? { italic: true } : {}), ...(o.box && wrap ? { box: o.box } : {}), ...data,
    },
    ...(o.extra ?? {}),
  } as Layer;
}
const textSize = (layer: Layer) => (layer.type === 'text' && typeof layer.text.size === 'number' ? layer.text.size : 40);
const textWidth = (c: C, layer: Layer) => {
  if (layer.type !== 'text') return 0;
  const t = layer.text.text ?? (layer.text.spans ?? []).map((s) => s.text).join('');
  return Math.max(...t.split('\n').map((l) => l.length)) * textSize(layer) * (((layer.text.weight ?? 500) >= 700 ? 0.62 : 0.58) + (layer.text.tracking ?? 0) / 100) + c.u * 0;
};

/** A text layer shrunk (never grown) so its measured width fits `maxW`. */
function fitWidth(c: C, layer: Layer, maxW: number): Layer {
  if (layer.type !== 'text') return layer;
  const width = textWidth(c, layer);
  if (width <= maxW) return layer;
  return { ...layer, text: { ...layer.text, size: textSize(layer) * (maxW / width) * 0.97 } } as Layer;
}

/** A line of type that rises through a hard mask edge (text and a hidden rectangle matte). */
function maskedRise(c: C, id: string, layer: Layer, base: Vec, boxW: number, lineH: number, at: number, a: number, z: number, dur = c.dur * 1.1, rise = 1.1): Layer[] {
  const align = layer.type === 'text' ? layer.text.align ?? 'center' : 'center';
  const mx = align === 'left' ? base[0] + boxW / 2 : align === 'right' ? base[0] - boxW / 2 : base[0];
  const matte = within(rect(`${id}-m`, [boxW, lineH], '#ffffff', { hidden: true, transform: { position: [mx, base[1]] } }), a, z);
  const moved = put(c, { ...layer, id, matte: { layer: matte.id, mode: 'alpha' } } as Layer, base, { at, dur, dy: lineH * rise / c.u, ease: c.b.ease, fade: dur * 0.3 });
  return [matte, within(moved, a, z)];
}

/** A soft diagonal band of light that crosses `from`→`to` (x, px), optionally only inside a text layer's letters. */
function sweep(c: C, id: string, at: number, dur: number, from: number, to: number, y: number, o: { height?: number; width?: number; angle?: number; color?: string; opacity?: number; matte?: Layer } = {}): Layer[] {
  const width = o.width ?? c.w * 0.14;
  const height = o.height ?? c.h * 1.6;
  const color = o.color ?? '#ffffff';
  const matteId = o.matte ? `${id}-mm` : undefined;
  const mattes = o.matte ? [{ ...o.matte, id: matteId!, hidden: true } as Layer] : [];
  const band = {
    id, name: id, type: 'shape', blend: 'screen', opacity: undefined,
    shape: { shape: 'rect', size: [width, height], gradient: { kind: 'linear', stops: [[0, alpha(color, 0)], [0.5, alpha(color, 0.95)], [1, alpha(color, 0)]], from: [0, 0], to: [width, 0] } },
    transform: { rotation: o.angle ?? 16, position: keys<Vec>([at, [from, y], 'cubic-in-out'], [at + dur, [to, y]]), opacity: keys<number>([at, 0, 'sine-out'], [at + dur * 0.2, o.opacity ?? 70], [at + dur * 0.8, o.opacity ?? 70, 'sine-in'], [at + dur, 0]) },
    in: at, out: at + dur + 0.05,
    ...(matteId ? { matte: { layer: matteId, mode: 'alpha' } } : {}),
  } as unknown as Layer;
  return [...mattes.map((m) => ({ ...m, in: at, out: at + dur + 0.05 }) as Layer), band];
}

/** The first clause of a line, at most five words: what a title card can carry. */
const shortLine = (text: string) => (text.split(/[;:.—]/)[0] ?? text).split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || text;

const paletteOf = (c: C): string[] => {
  const k = c.b.colors;
  const seen = new Set<string>();
  return [k.primary, k.accent, k.secondary, k.surface, k.background, k.text].filter((h) => isHex(h) && !seen.has(h.toLowerCase()) && !!seen.add(h.toLowerCase()));
};

// ── the stage: gradient, drifting palette light, aurora ──────────────────────

type Tone = 'brand' | 'primary' | 'surface';

function toneColours(c: C, tone: Tone) {
  const k = c.b.colors;
  const readable = (bg: string) => (contrast(k.text, bg) >= 4.2 ? k.text : contrast('#0b0b0b', bg) >= contrast('#ffffff', bg) ? '#0b0b0b' : '#ffffff');
  const settle = (stops: string[]) => {
    const hexes = stops.filter(isHex);
    const mid = hexes.reduce((acc, x, i) => (i ? mix(acc, x, 1 / (i + 1)) : x), hexes[0] ?? k.background);
    const fg = readable(mid);
    return { dark: lum(mid) < 0.36, base: hexes[0] ?? mid, mid, fg, soft: mix(fg, mid, 0.38), stops: hexes };
  };
  if (tone === 'primary') {
    const base = isHex(k.primary) ? k.primary : k.accent;
    return settle([mix(base, '#000000', 0.18), base, mix(base, isHex(k.accent) ? k.accent : '#ffffff', 0.3)]);
  }
  if (tone === 'surface') return settle([k.surface, k.background]);
  // The brand stage: the gradient pulled toward the background so type always has a calm field.
  return settle(c.b.gradient.map((x, i) => mix(x, k.background, i === 0 ? 0.4 : 0.25)));
}

/** Readable type and a quieter second ink for the section being built. */
const ink = (c: C) => toneColours(c, c.tone).fg;
const muted = (c: C) => toneColours(c, c.tone).soft;

/** Everything behind a section, living only in [a, z]: gradient plate, light blobs in the brand colours, an aurora on dark stages. */
function stage(c: C, a: number, z: number, tone: Tone = 'brand', flow = 1, fade = 0): Layer[] {
  const t = toneColours(c, tone);
  const { w, h } = c;
  const span = Math.max(1, z - a);
  const out: Layer[] = [];
  out.push(within({
    id: nid(c, 'stage'), name: 'Stage', type: 'shape',
    shape: { shape: 'rect', size: [w * 1.2, h * 1.2], gradient: { kind: 'linear', stops: t.stops.map((s, i, all) => [i / Math.max(1, all.length - 1), s] as [number, string]), from: [0, 0], to: [w * 0.45, h * 1.2] } },
    transform: { position: keys<Vec>([a, [c.cx - w * 0.03, c.cy], 'sine-in-out'], [z, [c.cx + w * 0.03, c.cy + h * 0.015]]), ...(fade ? { opacity: keys<number>([a, 0, 'sine-in-out'], [a + fade, 100]) } : {}) },
  } as Layer, a, z));
  const k = c.b.colors;
  const lights = [k.primary, k.accent, k.secondary].filter(isHex);
  const big = Math.max(w, h);
  lights.forEach((colour, i) => {
    const phase = i * 2.1;
    const x0 = [0.2, 0.8, 0.5][i] * w; const y0 = [0.3, 0.7, 0.95][i] * h;
    out.push(within(ellipse(nid(c, 'light'), [big * 0.5, big * 0.5], colour, {
      blend: t.dark ? 'screen' : 'normal',
      transform: {
        position: keys<Vec>([a, [x0 - w * 0.1 * flow, y0], 'sine-in-out'], [a + span * 0.5, [x0 + w * 0.12 * flow, y0 - h * 0.08 * (1 + phase / 4)], 'sine-in-out'], [z, [x0 - w * 0.06 * flow, y0 + h * 0.04]]),
        opacity: fade ? keys<number>([a, 0], [a + fade, t.dark ? 20 : 16]) : t.dark ? 20 : 16,
      },
      effects: [{ type: 'gaussian-blur', blurriness: big * 0.11 }],
    }), a, z));
  });
  if (t.dark && tone === 'brand') {
    out.push(within({
      id: nid(c, 'aurora'), name: 'Aurora', type: 'procedural', kind: 'aurora', size: [w, h], blend: 'screen',
      params: { bg: '#00000000', a: isHex(k.primary) ? k.primary : k.accent, b: isHex(k.accent) ? k.accent : k.primary, speed: 0.12 * flow },
      transform: { position: [c.cx, c.cy], opacity: fade ? keys<number>([a, 0], [a + fade, 10]) : 10 },
    } as Layer, a, z));
  }
  return out;
}

/** Film finish over the whole scene: soft vignette and a breath of grain. */
function finish(c: C): Layer {
  return { id: nid(c, 'finish'), name: 'Finish', type: 'solid', color: '#ffffff', adjustment: true, effects: [{ type: 'vignette', amount: c.b.stageDark ? 0.32 : 0.1, size: 1.1, softness: 0.8 }, { type: 'grain', amount: 0.07, size: 1.1 }] } as Layer;
}

// ── the brand lockup: logo file, or mark + wordmark in the display face ──────

type Part = { role: 'badge' | 'initial' | 'word' | 'logo'; layer: Layer; base: Vec; size: Vec };
type Lockup = { parts: Part[]; width: number; height: number; word?: Part; mark?: Part[] };

function lockup(c: C, x: number, y: number, S: number, colour: string, o: { stack?: boolean; name?: string; markColour?: string } = {}): Lockup {
  const name = o.name ?? c.copy.name;
  if (c.logo) {
    const boxH = S * 1.7;
    const k = boxH / Math.max(c.logo.bounds[1], c.logo.bounds[0] * 0.35);
    const size: Vec = [c.logo.bounds[0] * k, c.logo.bounds[1] * k];
    const fit = Math.min(1, (c.w * 0.62) / size[0]);
    const layer = { id: nid(c, 'logo'), name: 'Logo', type: 'shape', shape: { shape: 'path', groups: c.logo.groups, bounds: c.logo.bounds }, transform: { scale: k * fit * 100 } } as Layer;
    const p: Part = { role: 'logo', layer, base: [x, y], size: [size[0] * fit, size[1] * fit] };
    return { parts: [p], width: p.size[0], height: p.size[1], mark: [p] };
  }
  if (c.assetLogo) {
    const size: Vec = [S * 5, S * 1.8];
    const layer = { id: nid(c, 'logo'), name: 'Logo', type: 'footage', source: { asset: c.assetLogo, kind: 'image' }, fit: 'contain', size } as Layer;
    const p: Part = { role: 'logo', layer, base: [x, y], size };
    return { parts: [p], width: size[0], height: size[1], mark: [p] };
  }
  const wordLayer = textLayer(c, nid(c, 'wordmark'), name, { role: 'display', size: S, color: colour, align: o.stack ? 'center' : 'left', upper: false });
  const wordW = Math.min(textWidth(c, wordLayer), c.w * 0.8);
  const badge = S * 1.12;
  const gap = S * 0.36;
  const mc = o.markColour ?? c.b.colors.accent;
  const radius = clamp(c.b.radius, 0, 0.5) * badge * 1.2;
  const initial = (name.trim()[0] ?? 'B').toUpperCase();
  let bx: number; let by: number; let wx: number; let wy: number; let total: number; let height: number;
  if (o.stack) {
    bx = x; by = y - S * 0.78; wx = x; wy = y + badge * 0.5; total = Math.max(wordW, badge); height = badge + S * 0.9;
  } else {
    total = badge + gap + wordW; bx = x - total / 2 + badge / 2; by = y; wx = x - total / 2 + badge + gap; wy = y; height = badge;
  }
  const badgeLayer = rect(nid(c, 'badge'), [badge, badge], mc, {}, radius);
  const initialLayer = textLayer(c, nid(c, 'initial'), initial, { role: 'display', size: badge * 0.62, color: onColour(mc, c.b), upper: true });
  const wp: Part = { role: 'word', layer: wordLayer, base: [wx, wy], size: [wordW, S * 1.1] };
  const bp: Part = { role: 'badge', layer: badgeLayer, base: [bx, by], size: [badge, badge] };
  const ip: Part = { role: 'initial', layer: initialLayer, base: [bx, by], size: [badge, badge] };
  return { parts: [bp, ip, wp], width: total, height, word: wp, mark: [bp, ip] };
}

/** Where the lockup's size comes from: big enough to carry the frame, never wider than the safe width. */
const lockupSize = (c: C, scale = 1) => clamp((c.land ? c.h * 0.115 : c.port ? c.w * 0.105 : c.h * 0.1) * scale, 36, 220);

function placeLockup(_c: C, l: Lockup, a: number, z: number, anim: (part: Part, i: number) => Layer): Layer[] {
  return l.parts.map((p, i) => within(anim(p, i), a, z));
}

function tagline(c: C, text: string, x: number, y: number, at: number, a: number, z: number, colour: string, o: { size?: number; typed?: boolean; role?: 'subhead' | 'label' } = {}): Layer {
  const size = o.size ?? Math.min(c.h, c.w) * (c.land ? 0.042 : 0.044);
  const typed = o.typed !== false;
  const cps = clamp(text.length / 1.25, 16, 38);
  const layer = textLayer(c, nid(c, 'tagline'), text, {
    role: o.role ?? 'subhead', size, color: colour, box: c.w * 0.84,
    data: typed ? { type: { at, cps, caret: 'bar', caretColor: c.b.colors.accent, blink: 2, fadeIn: 0.06 } } : {},
  });
  const base: Vec = [x, y];
  const placed = typed ? { ...layer, transform: { position: base, opacity: keys<number>([at - 0.02, 0], [at, 100]) } } as Layer : put(c, layer, base, { at, dy: 18, blur: 6 });
  return within(placed, a, z);
}

// ── transitions ──────────────────────────────────────────────────────────────

/** The brand's transition as overlay layers centred on `mid` (the frame is fully covered for ~0.12 s around it). */
function transitionLayers(c: C, mid: number, total: number, style: TransitionStyle = c.trans): Layer[] {
  const { w, h, b } = c;
  const t0 = mid - total / 2; const t1 = mid + total / 2;
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const second = isHex(b.colors.primary) && b.colors.primary.toLowerCase() !== accent.toLowerCase() ? b.colors.primary : b.colors.surface;
  if (style === 'wipe' || style === 'push' || style === 'whip') {
    const whip = style === 'whip';
    const slab = (id: string, colour: string, delay: number, rot: number): Layer => ({
      id: nid(c, id), name: id, type: 'shape', shape: { shape: 'rect', size: [w * 1.5, h * 1.6], fill: colour }, in: t0, out: t1 + 0.1, ...(whip ? { shutter: 140 } : {}),
      transform: {
        rotation: rot,
        position: keys<Vec>([t0 + delay, [c.cx - w * 1.3, c.cy], b.ease], [mid - 0.05 + delay * 0.4, [c.cx - w * 0.2, c.cy], 'sine-in-out'], [mid + 0.07 + delay * 0.4, [c.cx + w * 0.2, c.cy], b.easeIn], [t1 + delay, [c.cx + w * 1.3, c.cy]]),
      },
      effects: whip ? [{ type: 'directional-blur', direction: 90, length: 90 * c.u }] : [],
    } as Layer);
    const rot = style === 'push' ? 0 : -9;
    return [slab('slab-back', second, 0.05, rot), slab('slab-front', accent, 0, rot)];
  }
  if (style === 'pop') {
    const diag = Math.hypot(w, h) * 1.25;
    return [
      { id: nid(c, 'burst'), name: 'Burst', type: 'shape', shape: { shape: 'ellipse', size: [1000, 1000], fill: accent }, in: t0, out: t1,
        transform: { position: [c.cx, c.cy], scale: keys<number>([t0, 4, 'expo-out'], [mid - 0.02, (diag / 1000) * 100], [t1, (diag / 1000) * 100 * 1.1]), opacity: keys<number>([t0, 100], [mid + 0.06, 100, 'sine-out'], [t1, 0]) } } as Layer,
      { id: nid(c, 'ring'), name: 'Ring', type: 'shape', shape: { shape: 'ellipse', size: [1000, 1000], fill: null, stroke: '#ffffff', strokeWidth: 10 * c.u }, in: t0, out: t1, blend: 'screen',
        transform: { position: [c.cx, c.cy], scale: keys<number>([t0 + 0.05, 5, 'expo-out'], [t1, (diag / 1000) * 100 * 1.25]), opacity: keys<number>([t0 + 0.05, 90], [t1, 0, 'sine-out']) } } as Layer,
    ];
  }
  return [{ id: nid(c, 'veil'), name: 'Veil', type: 'solid', color: b.colors.background, in: t0, out: t1, transform: { opacity: keys<number>([t0, 0, 'sine-in-out'], [mid, 86, 'sine-in-out'], [t1, 0]) } } as Layer];
}

// ── the reel ─────────────────────────────────────────────────────────────────

const REEL_CUTS = [0, 2.95, 5.3, 7.3, 8.8, REEL_SECONDS];
/** The five scenes of the film, for the scrubber. */
export const REEL_CHAPTERS = [
  { at: REEL_CUTS[0], label: 'Logo' }, { at: REEL_CUTS[1], label: 'Message' }, { at: REEL_CUTS[2], label: 'Type' }, { at: REEL_CUTS[3], label: 'Colour' }, { at: REEL_CUTS[4], label: 'End card' },
];

function buildReel(c: C, options: PackOptions) {
  const [s0, s1, s2, s3, s4, end] = REEL_CUTS;
  const T = clamp(c.b.exit * 1.4 + 0.45, 0.6, 0.85);
  // A "fade" kit crossfades: the next scene's stage fades in over the last while its type arrives, so no frame is ever empty.
  // Every other style hard-cuts under its wipe, which is fully covered by brand colour at the cut.
  const xf = c.trans === 'fade';
  const ov = xf ? T / 2 : 0;
  const from = (cut: number) => cut - 0.05 - ov;
  const to = (cut: number) => cut + 0.05 + ov;
  const early = (cut: number) => cut - 0.02 - ov * 0.5;
  const fade = xf ? T : 0;
  const layers: Layer[] = [];
  void options;

  // A · logo reveal and tagline type-on, on the brand stage.
  c.tone = 'brand';
  layers.push(...stage(c, s0, to(s1), 'brand'));
  layers.push(...logoReveal(c, s0, to(s1), 0.1, { stingLike: false }));

  // B · the line as kinetic type on the primary colour.
  c.tone = 'primary';
  layers.push(...stage(c, from(s1), to(s2), 'primary', 1.4, fade));
  layers.push(...kineticStatement(c, from(s1), to(s2), early(s1), 'primary'));

  // C · type specimen: Aa, the three faces, the palette chips.
  c.tone = 'surface';
  layers.push(...stage(c, from(s2), to(s3), 'surface', 0.7, fade));
  layers.push(...specimen(c, from(s2), to(s3), early(s2)));

  // D · the palette as moving light, with a lower third riding on it.
  c.tone = 'brand';
  layers.push(...stage(c, from(s3), to(s4), 'brand', 1.5, fade));
  layers.push(...paletteLight(c, from(s3), to(s4), early(s3)));
  layers.push(...lowerThirdParts(c, 'panel', s3 + 0.55, 1.5, from(s3), to(s4)));

  // E · end card: logo and tagline resolve.
  layers.push(...stage(c, from(s4), end, 'brand', 0.8, fade));
  layers.push(...logoReveal(c, from(s4), end, early(s4), { stingLike: false, resolve: true, rule: true, withTagline: true, shiftUp: 0.02 }));

  // Brand transitions between the five scenes, in the kit's own style.
  if (!xf) [s1, s2, s3, s4].forEach((cut) => layers.push(...transitionLayers(c, cut, T)));

  // The loop point: a short veil so the wrap back to the first frame is a breath, not a jump.
  layers.push({ id: nid(c, 'loop-veil'), name: 'Loop veil', type: 'solid', color: toneColours(c, 'brand').base, transform: { opacity: keys<number>([0, 70, 'sine-out'], [0.2, 0], [end - 0.14, 0, 'sine-in'], [end, 70]) } } as Layer);
  layers.push(finish(c));
  return { duration: end, layers, background: toneColours(c, 'brand').base };
}

/** The logo lockup revealing in [a, z]: mark pops, name rises through a mask, light sweeps the letters, tagline types on. */
function logoReveal(c: C, a: number, z: number, at: number, o: { stingLike: boolean; resolve?: boolean; rule?: boolean; withTagline?: boolean; shiftUp?: number; colour?: string }): Layer[] {
  const { b, w, h, u } = c;
  const fg = o.colour ?? ink(c);
  const S = lockupSize(c, c.logo || c.assetLogo ? 1 : 1);
  const cy = c.cy - h * (c.port ? 0.05 : 0.045) - (o.shiftUp ?? 0) * h;
  const l = lockup(c, c.cx, cy, S, fg, { stack: c.port });
  const out: Layer[] = [];
  const dur = c.dur * 1.15;
  const settle: Ease = o.resolve ? 'resolve' : b.ease;
  const parts = placeLockup(c, l, a, z, (p, i) => {
    if (p.role === 'badge') return put(c, p.layer, p.base, { at, dur: dur * 0.9, s0: 0.2, rot0: b.overshoot > 0 ? -90 : -35, ease: b.overshoot > 0 ? 'back-out' : settle, fade: 0.2, blur: 8 });
    if (p.role === 'initial') return put(c, p.layer, p.base, { at: at + 0.14, dur: dur * 0.8, s0: 0.5, ease: settle, fade: 0.2 });
    if (p.role === 'logo') return put(c, p.layer, p.base, { at, dur: dur * 1.3, s0: 0.84, dy: 16, ease: settle, blur: 14, fade: dur * 0.6 });
    void i;
    return p.layer;
  });
  if (l.word) {
    const wp = l.word;
    const rise = maskedRise(c, nid(c, 'name'), wp.layer, wp.base, wp.size[0] + 60 * u, wp.size[1] * 1.5, at + 0.12, a, z, dur * 1.1, 1.05);
    out.push(...parts.filter((p) => !(p.type === 'text' && p.id === wp.layer.id)), ...rise);
    {
      const tx0 = wp.base[0] - (c.port ? wp.size[0] / 2 : 0) - 40 * u;
      out.push(...sweep(c, nid(c, 'shine'), at + 0.85, 0.8, tx0, tx0 + wp.size[0] + 120 * u, wp.base[1], { width: 90 * u, height: wp.size[1] * 3, angle: 18, opacity: 85, matte: { id: 'x', type: 'text', text: { ...(wp.layer as Extract<Layer, { type: 'text' }>).text }, transform: { position: wp.base } } as Layer }).map((s) => within(s, a, z)));
    }
  } else out.push(...parts);
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const below = cy + l.height / 2 + h * 0.07;
  if (o.rule !== false) {
    const rw = Math.min(w * 0.18, 300 * u);
    out.push(within(rect(nid(c, 'rule'), [rw, 4 * u], accent, { transform: { position: [c.cx, below - h * 0.012], scale: keys<Vec>([at + 0.5, [0, 100], 'expo-out'], [at + 1.1, [100, 100]]), opacity: 100 } }, 2 * u), a, z));
  }
  if (o.withTagline !== false) out.push(tagline(c, c.copy.tagline, c.cx, below + h * 0.025, at + (o.resolve ? 0.9 : 1.05), a, z, muted(c), { typed: !o.resolve }));
  return out;
}

/** Tagline as big words that cascade up, one in the accent colour, over a ghosted brand name drifting behind. */
function kineticStatement(c: C, a: number, z: number, at: number, tone: Tone, text = c.copy.headline, kicker: string | null = c.copy.kicker): Layer[] {
  const { b, w, h, u } = c;
  const t = toneColours(c, tone);
  const out: Layer[] = [];
  const st = step(c, 'display');
  const words = text.split(/\s+/).filter(Boolean).slice(0, 8);
  const longest = words.reduce((m, x) => (x.length > m.length ? x : m), words[0] ?? '');
  const accentColour = [b.colors.secondary, b.colors.accent, b.colors.primary, '#ffffff', '#0b0b0b'].find((col) => isHex(col) && contrast(col, t.mid) > 3.2) ?? t.fg;
  const box = w * (c.land ? 0.8 : 0.84);
  const chars = words.join(' ').length;
  const lineCount = clamp(Math.ceil(chars / (c.land ? 18 : 12)), 1, 3);
  const cap = c.land ? h * 0.17 : w * 0.15;
  const size = clamp(Math.min(cap, box / (Math.max(5, Math.ceil(chars / lineCount)) * 0.62)), 36, cap);
  const cased1 = (s: string) => cased(s, st.transform);
  const spans = words.map((word, i) => ({ text: cased1(word) + (i < words.length - 1 ? ' ' : ''), ...(word === longest ? { color: accentColour } : {}) }));
  const headline = textLayer(c, nid(c, 'headline'), text, { role: 'display', size, color: t.fg, box, data: { spans, text: undefined, wrap: true, cascade: { by: 'word', delay: at, stagger: Math.max(0.06, b.wordStagger * 1.1), duration: c.dur * 1.1, ease: b.ease, from: { opacity: 0, blur: 14 * u, position: [0, size * 0.55], scale: 92 } } } });
  out.push(within({ ...headline, transform: { position: [c.cx, c.cy + (kicker ? h * 0.02 : 0)] } } as Layer, a, z));
  if (kicker) {
    const k = textLayer(c, nid(c, 'kicker'), kicker, { role: 'label', size: Math.min(w, h) * 0.024, color: t.fg, upper: true, tracking: 22, data: {} });
    out.push(...[put(c, k, [c.cx, c.cy - cap * (lineCount * 0.62) - h * 0.04], { at: at - 0.05, dy: 12, blur: 6 })].map((l) => within(l, a, z)));
    const barW = Math.min(w * 0.12, 220 * u);
    out.push(within(rect(nid(c, 'bar'), [barW, 5 * u], accentColour, { transform: { position: [c.cx, c.cy + cap * (lineCount * 0.62) + h * 0.06], scale: keys<Vec>([at + 0.6, [0, 100], 'expo-out'], [at + 1.2, [100, 100]]) } }, 3 * u), a, z));
  }
  // The ghosted name: a huge outlined word drifting slower than the front type, for depth.
  const ghost = textLayer(c, nid(c, 'ghost'), c.copy.name, { role: 'display', size: h * (c.land ? 0.62 : 0.34), color: alpha(t.fg, 0.05), upper: true, data: { stroke: { color: alpha(t.fg, 0.16), width: 2 * u } }, extra: { bleed: true } });
  out.push(within({ ...ghost, transform: { position: keys<Vec>([a, [c.cx + w * 0.09, c.cy + h * 0.06], 'sine-in-out'], [z, [c.cx - w * 0.09, c.cy + h * 0.06]]), opacity: keys<number>([a, 0], [a + 0.5, 100]) } } as Layer, a, z));
  out.push(...sweep(c, nid(c, 'light'), at + 0.5, 1.1, -w * 0.1, w * 1.1, c.cy, { width: w * 0.12, color: '#ffffff', opacity: t.dark ? 22 : 40, angle: 16 }).map((l) => within(l, a, z)));
  return out;
}

/** Type specimen: a giant Aa, the display, heading and body faces set as themselves, and the palette as chips. */
function specimen(c: C, a: number, z: number, at: number): Layer[] {
  const { b, w, h, u } = c;
  const fg = ink(c);
  const out: Layer[] = [];
  const land = c.land;
  const aaSize = land ? h * 0.5 : w * 0.4;
  const aa = textLayer(c, nid(c, 'aa'), 'Aa', { role: 'display', size: aaSize, color: fg, tracking: -2, keepCase: true, data: {} });
  const aaBase: Vec = land ? [w * 0.27, h * 0.5] : [c.cx, h * 0.25];
  out.push(...maskedRise(c, nid(c, 'aa'), aa, aaBase, aaSize * 1.6, aaSize * 1.15, at, a, z, c.dur * 1.4, 0.9));
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  // Accent disc behind the glyph: depth, and the first palette colour arrives with it.
  out.push(within(ellipse(nid(c, 'disc'), [aaSize * 0.9, aaSize * 0.9], accent, { transform: { position: land ? [w * 0.27, h * 0.52] : [c.cx, h * 0.27], scale: keys<number>([at, 40, 'expo-out'], [at + 1.2, 100]), opacity: keys<number>([at, 0], [at + 0.6, 22]) }, effects: [{ type: 'gaussian-blur', blurriness: aaSize * 0.08 }] }), a, z));
  const colX = land ? w * 0.54 : w * 0.1;
  const colW = land ? w * 0.38 : w * 0.8;
  const rows: { label: string; sample: string; role: 'display' | 'heading' | 'body'; size: number; family: string; weight: number }[] = [
    { label: `Display · ${b.fonts.display} ${b.weights.display}`, sample: c.copy.headline.split(/\s+/).slice(0, 3).join(' ') || c.copy.name, role: 'display', size: land ? h * 0.088 : w * 0.085, family: b.fonts.display, weight: b.weights.display },
    { label: `Heading · ${b.fonts.heading} ${b.weights.heading}`, sample: 'Every frame, on brand.', role: 'heading', size: land ? h * 0.054 : w * 0.05, family: b.fonts.heading, weight: b.weights.heading },
    { label: `Body · ${b.fonts.body} ${b.weights.body}`, sample: 'The same colours, type and timing in every film you make.', role: 'body', size: land ? h * 0.031 : w * 0.032, family: b.fonts.body, weight: b.weights.body },
  ];
  const y0 = land ? h * 0.2 : h * 0.47;
  const gap = land ? h * 0.21 : h * 0.12;
  rows.forEach((row, i) => {
    const y = y0 + i * gap;
    const rowAt = at + 0.45 + i * Math.max(0.16, b.stagger * 1.6);
    const label = textLayer(c, nid(c, 'label'), row.label, { role: 'label', size: Math.min(w, h) * 0.0185, color: muted(c), align: 'left', upper: true, tracking: 14, data: {} });
    out.push(within(put(c, label, [colX, y], { at: rowAt, dy: 10, blur: 4 }), a, z));
    const sampleRaw = textLayer(c, nid(c, 'sample'), row.sample, { role: row.role, size: row.size, font: row.family, weight: row.weight, color: fg, align: 'left', box: colW, data: row.role === 'body' ? { wrap: true } : {} });
    const sample = row.role === 'body' ? sampleRaw : fitWidth(c, sampleRaw, colW);
    const sy = y + h * 0.034 + row.size * (row.role === 'body' ? 1.2 : 0.62);
    out.push(...maskedRise(c, nid(c, 'sample'), sample, [colX, sy], colW + 20 * u, row.size * (row.role === 'body' ? 2.5 : 1.3), rowAt + 0.08, a, z, c.dur * 1.05, 0.9));
  });
  // Palette chips.
  const chips = paletteOf(c).slice(0, 6);
  const chip = land ? h * 0.07 : w * 0.1;
  const cy = land ? h * 0.9 : h * 0.9;
  const start = land ? colX + chip / 2 : c.cx - ((chips.length - 1) * (chip * 1.35)) / 2;
  chips.forEach((hex, i) => {
    const x = (land ? colX + chip / 2 : start) + i * chip * 1.35;
    const chipAt = at + 1.3 + i * 0.07;
    const rad = chip * clamp(b.radius * 1.4 + 0.12, 0.12, 0.5);
    // A hairline ring in the ink colour keeps a chip the colour of its stage visible.
    out.push(within(put(c, rect(nid(c, 'chip-ring'), [chip + 6 * u, chip + 6 * u], alpha(fg, 0.28), {}, rad + 3 * u), [x, cy], { at: chipAt, dur: 0.6, s0: 0.2, dy: 22, ease: b.overshoot > 0 ? 'back-out' : b.ease, fade: 0.2 }), a, z));
    out.push(within(put(c, rect(nid(c, 'chip'), [chip, chip], hex, {}, rad), [x, cy], { at: chipAt, dur: 0.6, s0: 0.2, dy: 22, ease: b.overshoot > 0 ? 'back-out' : b.ease, fade: 0.2 }), a, z));
  });
  return out;
}

/** The palette as moving light: tall bars of each brand colour rise and sway, bright and glowing, with their hex codes. */
function paletteLight(c: C, a: number, z: number, at: number): Layer[] {
  const { b, w, h, u } = c;
  const colours = paletteOf(c).filter((hex) => hex.toLowerCase() !== b.gradient[0].toLowerCase()).slice(0, c.port ? 5 : 6);
  const out: Layer[] = [];
  const barW = c.land ? w * 0.082 : w * 0.13;
  const gap = barW * 0.42;
  const total = colours.length * barW + (colours.length - 1) * gap;
  const barH = c.land ? h * 0.52 : h * 0.34;
  const midY = c.land ? h * 0.4 : h * 0.34;
  const radius = barW * clamp(b.radius * 2.2 + 0.3, 0.3, 0.5);
  const span = z - a;
  // A broad ribbon of the brand gradient flowing behind, screened onto the stage.
  out.push(within({
    id: nid(c, 'flow'), name: 'Gradient flow', type: 'shape', blend: b.stageDark ? 'screen' : 'normal',
    shape: { shape: 'rect', size: [w * 1.5, h * 0.55], gradient: { kind: 'linear', stops: colours.slice(0, 4).map((hex, i, all) => [i / Math.max(1, all.length - 1), alpha(hex, 0.9)] as [number, string]), from: [0, 0], to: [w * 1.5, 0] } },
    transform: { rotation: -11, position: keys<Vec>([a, [c.cx + w * 0.25, midY + h * 0.05], 'sine-in-out'], [z, [c.cx - w * 0.25, midY - h * 0.03]]), opacity: keys<number>([a, 0], [a + 0.5, 34, 'sine-in-out'], [z - 0.3, 34]) },
    effects: [{ type: 'gaussian-blur', blurriness: h * 0.07 }],
  } as Layer, a, z));
  colours.forEach((hex, i) => {
    const x = c.cx - total / 2 + barW / 2 + i * (barW + gap);
    const delay = at + i * Math.max(0.07, b.stagger * 0.9);
    const rise = c.dur * 1.25;
    const sway = h * (c.land ? 0.028 : 0.02);
    const hi = h * (0.06 + 0.035 * ((i * 5) % 3));
    const base: Layer = rect(nid(c, 'bar'), [barW, barH + hi], hex, {
      transform: {
        position: { k: [
          { t: delay, v: [x, midY + h * 0.7], ease: b.ease },
          { t: delay + rise, v: [x, midY], ease: 'sine-in-out' },
          { t: delay + rise + span * 0.22, v: [x, midY - sway * (i % 2 ? 1 : -1)], ease: 'sine-in-out' },
          { t: z, v: [x, midY + sway * (i % 2 ? 1 : -1)] },
        ] },
        opacity: keys<number>([delay, 0], [delay + 0.25, 100]),
      },
      effects: [{ type: 'glow', radius: 34 * u, intensity: 0.55, threshold: 0.2, color: hex, deep: true }, ...(lum(hex) > 0.8 ? [{ type: 'drop-shadow', distance: 0, softness: 14 * u, opacity: 25, color: '#000000' } as Effect] : [])],
    }, radius);
    out.push(within(base, a, z));
    const labelColour = ink(c);
    const lbl = textLayer(c, nid(c, 'hex'), hex.toUpperCase(), { role: 'label', size: Math.min(w, h) * 0.0185, color: labelColour, tracking: 12, data: {} });
    out.push(within(put(c, lbl, [x, midY + (barH + hi) / 2 + h * 0.045], { at: delay + rise * 0.85, dy: 8, blur: 4 }), a, z));
  });
  return out;
}

// ── lower thirds ─────────────────────────────────────────────────────────────

type LTStyle = 'panel' | 'line' | 'tag';

/** A lower third living in [a, z]: in at `at`, out `hold` seconds later. */
function lowerThirdParts(c: C, style: LTStyle, at: number, hold: number, a: number, z: number): Layer[] {
  const { b, w, h, u } = c;
  const m = clamp(b.safeMargin, 0.04, 0.12);
  const x0 = w * m + (c.land ? w * 0.02 : 0);
  const y = h * (c.port ? 0.82 : 0.84);
  const nameSize = Math.min(w, h) * (c.land ? 0.056 : 0.058);
  const roleSize = nameSize * 0.52;
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const out: Layer[] = [];
  const outAt = at + c.dur + hold;
  const exit = { at: outAt, dur: 0.42 };
  const name = textLayer(c, nid(c, 'name'), c.copy.person, { role: 'heading', size: nameSize, color: ink(c), align: 'left', box: w * 0.6, data: {} });
  const role = textLayer(c, nid(c, 'role'), c.copy.role, { role: 'label', size: roleSize, color: muted(c), align: 'left', box: w * 0.6, upper: true, tracking: 14, data: {} });
  const nw = Math.max(textWidth(c, name), textWidth(c, role) * 1.02);
  if (style === 'panel') {
    const pad = nameSize * 0.7;
    const pw = nw + pad * 2 + 18 * u;
    const ph = nameSize * 2.5 + pad * 0.3;
    const px = x0 + pw / 2;
    const rad = clamp(b.radius, 0, 0.5) * ph * 0.5;
    out.push(within(put(c, rect(nid(c, 'panel'), [pw, ph], `${isHex(b.colors.surface) ? b.colors.surface : '#111111'}f2`, { effects: [{ type: 'drop-shadow', distance: 12 * u, softness: 34 * u, opacity: 38, direction: 180, color: '#000000' }] }, rad), [px, y], { at, dur: c.dur, dx: -pw * 0.5 / u, ease: b.ease, fade: 0.25, out: { ...exit, dx: -pw * 0.3 / u } }), a, z));
    out.push(within(put(c, rect(nid(c, 'tab'), [8 * u, ph * 0.62], accent, {}, 4 * u), [x0 + pad * 0.5, y], { at: at + 0.08, dur: c.dur, s0: 1, dy: 0, ease: b.ease, out: { ...exit } }), a, z));
    out.push(within(put(c, name, [x0 + pad + 12 * u, y - nameSize * 0.45], { at: at + 0.15, dur: c.dur, dx: -26, blur: 6, out: { ...exit, dx: -16 } }), a, z));
    out.push(within(put(c, role, [x0 + pad + 12 * u, y + nameSize * 0.72], { at: at + 0.24, dur: c.dur, dx: -20, blur: 4, out: { ...exit, dx: -12 } }), a, z));
  } else if (style === 'line') {
    const lw = nw + nameSize;
    out.push(within({ ...rect(nid(c, 'scrim'), [w, h * 0.3], null, {
      transform: { position: [c.cx, h * 0.97 - h * 0.15], opacity: keys<number>([at, 0], [at + 0.5, 100], [outAt, 100], [outAt + 0.4, 0]) },
    }), shape: { shape: 'rect', size: [w, h * 0.3], gradient: { kind: 'linear', stops: [[0, '#00000000'], [1, '#000000aa']], from: [0, 0], to: [0, h * 0.3] } } } as Layer, a, z));
    out.push(...maskedRise(c, nid(c, 'name'), name, [x0, y - nameSize * 0.4], lw + 30 * u, nameSize * 1.5, at + 0.1, a, z, c.dur * 1.05, 1).map((l) => (l.hidden ? l : { ...l, out: outAt + 0.4 })));
    out.push(within(rect(nid(c, 'line'), [lw, 3 * u], accent, { transform: { position: [x0 + lw / 2, y + nameSize * 0.28], scale: { k: [{ t: at, v: [0, 100], ease: b.ease }, { t: at + c.dur, v: [100, 100] }, { t: outAt, v: [100, 100], ease: b.easeIn }, { t: outAt + 0.4, v: [0, 100] }] } } }, 2 * u), a, z));
    out.push(within(put(c, role, [x0, y + nameSize * 0.78], { at: at + 0.3, dur: c.dur, dy: 14, blur: 4, out: { ...exit, dy: 8 } }), a, z));
  } else {
    const pad = nameSize * 0.6;
    const tw = Math.max(nw, textWidth(c, role)) + pad * 2;
    const th = nameSize * 1.9;
    const tx = x0 + tw / 2;
    const fg = onColour(accent, b);
    out.push(within(put(c, rect(nid(c, 'tag'), [tw, th], accent, {}, clamp(b.radius, 0, 0.5) * th * 0.5), [tx, y - nameSize * 0.2], { at, dur: c.dur * 0.9, s0: 0.2, dx: -40, ease: b.overshoot > 0 ? 'back-out' : b.ease, fade: 0.2, out: { ...exit, s1: 0.4, dx: -30 } }), a, z));
    const typed = { ...name, text: { ...(name as Extract<Layer, { type: 'text' }>).text, color: fg, type: { at: at + 0.3, cps: 26, caret: 'bar', caretColor: fg, blink: 2, fadeIn: 0.05 } } } as Layer;
    out.push(within({ ...typed, transform: { position: [x0 + pad, y - nameSize * 0.5], opacity: keys<number>([at + 0.28, 0], [at + 0.3, 100], [outAt, 100], [outAt + 0.3, 0]) } } as Layer, a, z));
    const r2 = { ...role, text: { ...(role as Extract<Layer, { type: 'text' }>).text, color: alpha(fg, 0.72) } } as Layer;
    out.push(within(put(c, r2, [x0 + pad, y + nameSize * 0.42], { at: at + 0.6, dur: c.dur, dy: 10, blur: 4, out: { ...exit, dy: 6 } }), a, z));
  }
  return out;
}

function lowerThird(c: C, style: LTStyle, options: PackOptions) {
  const dur = 4.2;
  const bg = options.background === true;
  const layers: Layer[] = [];
  if (bg) layers.push(...demoPlate(c, 0, dur));
  layers.push(...lowerThirdParts(c, style, 0.15, dur - 0.15 - c.dur - 0.5 - 0.1, 0, dur));
  return { duration: dur, layers };
}

/** A calm "footage" stand-in for previews of overlays: a dim graded frame with soft shapes. */
function demoPlate(c: C, a: number, z: number): Layer[] {
  const { b, w, h } = c;
  const base = mix(b.colors.background, '#000000', b.stageDark ? 0.15 : 0.55);
  const lit = isHex(b.colors.primary) ? b.colors.primary : b.colors.accent;
  return [
    within({ id: nid(c, 'plate'), name: 'Plate', type: 'shape', shape: { shape: 'rect', size: [w, h], gradient: { kind: 'linear', stops: [[0, mix(base, lit, 0.22)], [1, base]], from: [0, 0], to: [w, h] } }, transform: { position: [c.cx, c.cy] } } as Layer, a, z),
    within(ellipse(nid(c, 'plate-light'), [Math.max(w, h) * 0.5, Math.max(w, h) * 0.5], lit, { blend: 'screen', transform: { position: [w * 0.7, h * 0.35], opacity: 34 }, effects: [{ type: 'gaussian-blur', blurriness: Math.max(w, h) * 0.08 }] }), a, z),
  ];
}

// ── stings ───────────────────────────────────────────────────────────────────

function stingScene(c: C, variant: StingVariant, options: PackOptions) {
  const { b, w, h, u } = c;
  const dur = STINGS[variant].seconds;
  const layers: Layer[] = [];
  const bg = options.background !== false;
  if (bg) layers.push(...stage(c, 0, dur, 'brand', variant === 'bloom' ? 0.6 : 1.3));
  const S = lockupSize(c, variant === 'punch' ? 1.08 : 1);
  const fg = ink(c);
  const l = lockup(c, c.cx, c.cy - h * 0.025, S, fg, { stack: c.port });
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const at = 0.3;
  if (variant === 'clean') {
    layers.push(...logoReveal(c, 0, dur, at, { stingLike: true, withTagline: true, shiftUp: 0.005 }));
  } else if (variant === 'bloom') {
    const parts = placeLockup(c, l, 0, dur, (p) => put(c, p.layer, p.base, { at: at + (p.role === 'word' ? 0.15 : 0), dur: 1.5, s0: 1.14, blur: 36, ease: 'cubic-out', fade: 1.1 }));
    layers.push(...parts);
    layers.push(within(ellipse(nid(c, 'bloom'), [h * 1.1, h * 1.1], accent, { blend: 'screen', transform: { position: [c.cx, c.cy], scale: keys<number>([at, 20, 'cubic-out'], [at + 1.6, 100], [dur, 120]), opacity: keys<number>([at, 0], [at + 0.7, 38, 'sine-in-out'], [dur, 0]) }, effects: [{ type: 'gaussian-blur', blurriness: h * 0.16 }] }), 0, dur));
    layers.push(tagline(c, c.copy.tagline, c.cx, c.cy + l.height / 2 + h * 0.09, at + 1.2, 0, dur, muted(c), { typed: false }));
  } else if (variant === 'kinetic') {
    layers.push(...placeLockup(c, l, 0, dur, (p) => {
      if (p.role === 'badge') return put(c, p.layer, p.base, { at, dur: 0.75, s0: 0.1, rot0: 220, ease: 'back-out', fade: 0.12 });
      if (p.role === 'initial') return put(c, p.layer, p.base, { at: at + 0.18, dur: 0.5, s0: 0.3, ease: 'back-out', fade: 0.1 });
      if (p.role === 'word') {
        const t = p.layer as Extract<Layer, { type: 'text' }>;
        return { ...p.layer, text: { ...t.text, cascade: { by: 'char', delay: at + 0.2, stagger: 0.04, duration: 0.55, ease: 'back-out', from: { opacity: 0, position: [0, S * 0.9], rotation: 14, scale: 60, blur: 10 * u } } }, transform: { position: p.base } } as Layer;
      }
      return put(c, p.layer, p.base, { at, dur: 0.8, s0: 0.5, ease: 'back-out' });
    }));
    const bw = l.width * 1.06;
    layers.push(within(rect(nid(c, 'slam'), [bw, 6 * u], accent, { transform: { position: [c.cx, c.cy + l.height / 2 + h * 0.035], scale: keys<Vec>([at + 0.55, [0, 100], 'expo-out'], [at + 0.95, [100, 100]]) } }, 3 * u), 0, dur));
    layers.push(tagline(c, c.copy.tagline, c.cx, c.cy + l.height / 2 + h * 0.085, at + 1.05, 0, dur, muted(c), { typed: true }));
  } else if (variant === 'glitch') {
    const jitter = (base: Vec, t0: number): { k: Key<Vec>[] } => ({ k: [
      { t: t0, v: [base[0] - 40 * u, base[1]], ease: 'hold' }, { t: t0 + 0.06, v: [base[0] + 26 * u, base[1] - 6 * u], ease: 'hold' }, { t: t0 + 0.12, v: [base[0] - 12 * u, base[1] + 4 * u], ease: 'hold' },
      { t: t0 + 0.2, v: [base[0] + 8 * u, base[1]], ease: 'hold' }, { t: t0 + 0.34, v: base },
    ] });
    layers.push(...placeLockup(c, l, 0, dur, (p) => ({
      ...p.layer,
      transform: { ...(p.layer.transform ?? {}), position: jitter(p.base, at), opacity: { k: [{ t: at, v: 0, ease: 'hold' }, { t: at + 0.05, v: 100, ease: 'hold' }, { t: at + 0.1, v: 20, ease: 'hold' }, { t: at + 0.14, v: 100 }] } },
      effects: [
        { type: 'rgb-split', x: { k: [{ t: at, v: 34 * u, ease: 'hold' }, { t: at + 0.12, v: -22 * u, ease: 'hold' }, { t: at + 0.26, v: 10 * u, ease: 'expo-out' }, { t: at + 0.7, v: 0 }] }, y: 0 } as Effect,
        { type: 'mosaic', cell: { k: [{ t: at, v: 40 * u, ease: 'hold' }, { t: at + 0.1, v: 14 * u, ease: 'hold' }, { t: at + 0.18, v: 1 }] } } as Effect,
      ],
    } as Layer)));
    // A signal tear: a bright bar that scans down once, as the mark settles.
    layers.push(...sweep(c, nid(c, 'scan'), at + 0.15, 0.55, -h * 0.2, h * 1.2, c.cx, { width: 14 * u, height: w * 1.4, angle: 90, opacity: 60 }).map((s) => (s.id.endsWith('mm') ? s : { ...s, transform: { ...(s.transform ?? {}), rotation: 90, position: keys<Vec>([at + 0.15, [c.cx, -h * 0.1], 'expo-out'], [at + 0.7, [c.cx, h * 1.1]]) } } as Layer)));
    layers.push(tagline(c, c.copy.tagline.toUpperCase(), c.cx, c.cy + l.height / 2 + h * 0.085, at + 0.8, 0, dur, accent, { typed: true, role: 'label', size: Math.min(w, h) * 0.026 }));
  } else {
    // punch
    layers.push(...placeLockup(c, l, 0, dur, (p) => put(c, p.layer, p.base, { at, dur: 0.55, s0: 3.2, blur: 28, ease: 'expo-out', fade: 0.1 })));
    const diag = Math.hypot(w, h);
    layers.push(within({ id: nid(c, 'shock'), name: 'Shock ring', type: 'shape', shape: { shape: 'ellipse', size: [1000, 1000], fill: null, stroke: accent, strokeWidth: 14 * u }, blend: 'screen', transform: { position: [c.cx, c.cy], scale: keys<number>([at + 0.35, 6, 'expo-out'], [at + 1.3, (diag / 1000) * 100]), opacity: keys<number>([at + 0.35, 95], [at + 1.3, 0, 'sine-out']) } } as Layer, 0, dur));
    layers.push(within({ id: nid(c, 'flash'), name: 'Flash', type: 'solid', color: '#ffffff', blend: 'screen', transform: { opacity: keys<number>([at + 0.3, 0], [at + 0.36, 70, 'expo-out'], [at + 0.7, 0]) } } as Layer, 0, dur));
    layers.push(tagline(c, c.copy.tagline, c.cx, c.cy + l.height / 2 + h * 0.085, at + 0.85, 0, dur, muted(c), { typed: false }));
  }
  if (bg) layers.push(finish(c));
  return { duration: dur, layers, ...(bg ? { background: toneColours(c, 'brand').base } : {}) };
}

// ── titles ───────────────────────────────────────────────────────────────────

function titleStatement(c: C, options: PackOptions) {
  const dur = 3.8;
  const bg = options.background !== false;
  const layers: Layer[] = [];
  c.tone = 'primary';
  if (bg) layers.push(...stage(c, 0, dur, 'primary', 1.3));
  layers.push(...kineticStatement(c, 0, dur, 0.25, bg ? 'primary' : 'brand'));
  if (bg) layers.push(finish(c));
  return { duration: dur, layers, ...(bg ? { background: toneColours(c, 'primary').base } : {}) };
}

function titleChapter(c: C, options: PackOptions) {
  const { b, w, h, u } = c;
  const dur = 3.8;
  const bg = options.background !== false;
  const tone: Tone = bg ? 'brand' : 'brand';
  const t = toneColours(c, tone);
  const layers: Layer[] = [];
  if (bg) layers.push(...stage(c, 0, dur, tone, 1));
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const left = c.land ? w * 0.1 : w * 0.1;
  const num = textLayer(c, nid(c, 'num'), '01', { role: 'display', size: h * (c.land ? 0.5 : 0.24), color: alpha(accent, 0.0), align: 'left', tracking: -4, data: { stroke: { color: accent, width: 3 * u } }, extra: { bleed: true } });
  const numBase: Vec = c.land ? [left, h * 0.5] : [left, h * 0.3];
  layers.push(within(put(c, num, numBase, { at: 0.2, dur: c.dur * 1.4, dx: -60, blur: 18, ease: b.ease, fade: 0.5 }), 0, dur));
  const tx = c.land ? w * 0.47 : left;
  const ty = c.land ? h * 0.46 : h * 0.55;
  const title = textLayer(c, nid(c, 'ctitle'), shortLine(c.copy.headline), { role: 'display', size: Math.min(h * (c.land ? 0.11 : 0.06), w * 0.09), color: ink(c), align: 'left', box: w * (c.land ? 0.44 : 0.8), data: { wrap: true } });
  layers.push(...maskedRise(c, nid(c, 'ctitle'), title, [tx, ty], w * (c.land ? 0.46 : 0.82), h * 0.3, 0.45, 0, dur, c.dur * 1.2, 0.9));
  layers.push(within(rect(nid(c, 'crule'), [Math.min(w * 0.14, 260 * u), 5 * u], accent, { transform: { position: [tx + Math.min(w * 0.14, 260 * u) / 2, ty + h * (c.land ? 0.18 : 0.12)], scale: keys<Vec>([0.9, [0, 100], 'expo-out'], [1.5, [100, 100]]) } }, 3 * u), 0, dur));
  const sub = textLayer(c, nid(c, 'csub'), c.copy.kicker, { role: 'label', size: Math.min(w, h) * 0.024, color: muted(c), align: 'left', upper: true, tracking: 22, data: {} });
  layers.push(within(put(c, sub, [tx, ty - h * (c.land ? 0.16 : 0.1)], { at: 0.4, dur: c.dur, dy: 12, blur: 4 }), 0, dur));
  void t;
  if (bg) layers.push(finish(c));
  return { duration: dur, layers, ...(bg ? { background: toneColours(c, tone).base } : {}) };
}

// ── transitions (as pieces) ──────────────────────────────────────────────────

function transitionPiece(c: C, options: PackOptions, second: boolean) {
  const dur = 1.1;
  const { w, h } = c;
  const demo = options.demo === true;
  const style: TransitionStyle = second ? (c.trans === 'pop' ? 'wipe' : 'pop') : c.trans;
  const layers: Layer[] = [];
  const mid = dur / 2;
  if (demo) {
    // Two plates stand in for the shots either side of the cut.
    const fg = ink(c);
    layers.push(...stage(c, 0, mid, 'surface', 0.4));
    layers.push(within(put(c, textLayer(c, nid(c, 'a'), 'Shot A', { role: 'label', size: Math.min(w, h) * 0.035, color: fg, upper: true, tracking: 24, data: {} }), [c.cx, c.cy], { at: 0, dur: 0.01, fade: 0.01 }), 0, mid));
    layers.push(...stage(c, mid, dur, 'primary', 0.4));
    layers.push(within(put(c, textLayer(c, nid(c, 'b'), 'Shot B', { role: 'label', size: Math.min(w, h) * 0.035, color: toneColours(c, 'primary').fg, upper: true, tracking: 24, data: {} }), [c.cx, c.cy], { at: mid, dur: 0.01, fade: 0.01 }), mid, dur));
  }
  layers.push(...transitionLayers(c, mid, dur * 0.9, style));
  return { duration: dur, layers };
}

// ── end screens ──────────────────────────────────────────────────────────────

function endLogo(c: C, options: PackOptions) {
  const dur = 4.4;
  const bg = options.background !== false;
  const layers: Layer[] = [];
  if (bg) layers.push(...stage(c, 0, dur, 'brand', 0.8));
  layers.push(...logoReveal(c, 0, dur, 0.25, { stingLike: false, resolve: true, rule: true, withTagline: true, shiftUp: 0.02 }));
  if (bg) layers.push(finish(c));
  return { duration: dur, layers, ...(bg ? { background: toneColours(c, 'brand').base } : {}) };
}

function endNext(c: C, options: PackOptions) {
  const { b, w, h, u } = c;
  const dur = 5;
  const bg = options.background !== false;
  const layers: Layer[] = [];
  if (bg) layers.push(...stage(c, 0, dur, 'brand', 0.9));
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const cardW = c.land ? w * 0.34 : w * 0.78;
  const cardH = cardW * 9 / 16;
  const gap = c.land ? w * 0.035 : h * 0.03;
  const cards: Vec[] = c.land
    ? [[c.cx - cardW / 2 - gap / 2, h * 0.43], [c.cx + cardW / 2 + gap / 2, h * 0.43]]
    : [[c.cx, h * 0.3], [c.cx, h * 0.3 + cardH + gap]];
  const rad = clamp(b.radius, 0, 0.5) * cardH * 0.45 + 6 * u;
  cards.forEach((pos, i) => {
    const at = 0.25 + i * Math.max(0.14, b.stagger * 2);
    const fill = i === 0 ? mix(b.colors.surface, b.colors.primary, 0.18) : mix(b.colors.surface, b.colors.accent, 0.14);
    layers.push(within(put(c, rect(nid(c, 'slot'), [cardW, cardH], fill, { effects: [{ type: 'drop-shadow', distance: 14 * u, softness: 36 * u, opacity: 40, direction: 180, color: '#000000' }, { type: 'stroke', width: 2 * u, color: alpha(ink(c), 0.18) }] }, rad), pos, { at, dur: c.dur * 1.1, dy: 40, s0: 0.92, blur: 10, ease: b.ease }), 0, dur));
    layers.push(within(put(c, { id: nid(c, 'play'), name: 'Play', type: 'shape', shape: { shape: 'polygon', sides: 3, size: [cardH * 0.26, cardH * 0.26], fill: i === 0 ? accent : ink(c) }, transform: { rotation: 90 } } as Layer, pos, { at: at + 0.25, dur: 0.5, s0: 0.2, ease: 'back-out', fade: 0.15 }), 0, dur));
  });
  const y = c.land ? h * 0.78 : h * 0.84;
  const handle = textLayer(c, nid(c, 'handle'), c.copy.handle, { role: 'subhead', size: Math.min(w, h) * 0.036, color: ink(c), align: 'left', data: {} });
  const pillW = Math.min(w, h) * 0.34; const pillH = pillW * 0.3;
  const px = c.land ? c.cx - cardW - gap / 2 + pillW / 2 + 0 : c.cx - pillW / 2 - w * 0.08;
  const hx = px + pillW / 2 + 24 * u;
  layers.push(within(put(c, rect(nid(c, 'pill'), [pillW, pillH], accent, {}, pillH / 2), [px, y], { at: 0.9, dur: 0.6, s0: 0.5, ease: b.overshoot > 0 ? 'back-out' : b.ease, fade: 0.2 }), 0, dur));
  layers.push(within(put(c, textLayer(c, nid(c, 'pill-t'), c.copy.cta, { role: 'label', size: pillH * 0.4, color: onColour(accent, b), upper: false, weight: 700, data: {} }), [px, y], { at: 1.0, dur: 0.5, dy: 8, blur: 4 }), 0, dur));
  layers.push(within(put(c, handle, [hx, y], { at: 1.1, dur: 0.6, dx: -18, blur: 4 }), 0, dur));
  if (bg) layers.push(finish(c));
  return { duration: dur, layers, ...(bg ? { background: toneColours(c, 'brand').base } : {}) };
}

function ctaSubscribe(c: C, options: PackOptions) {
  const { b, w, h, u } = c;
  const dur = 3.4;
  const bg = options.background === true;
  const layers: Layer[] = [];
  if (bg) layers.push(...demoPlate(c, 0, dur));
  const accent = isHex(b.colors.accent) ? b.colors.accent : b.colors.primary;
  const s = Math.min(w, h);
  const pillW = s * (c.land ? 0.4 : 0.62); const pillH = pillW * 0.27;
  const y = c.land ? h * 0.78 : h * 0.8;
  const pos: Vec = [c.cx, y];
  const press = 1.35;
  const done = mix(b.colors.surface, accent, 0.0);
  layers.push(within({
    ...put(c, rect(nid(c, 'cta-pill'), [pillW, pillH], accent, { effects: [{ type: 'drop-shadow', distance: 8 * u, softness: 26 * u, opacity: 40, direction: 180, color: '#000000' }] }, pillH / 2), pos, { at: 0.2, dur: 0.7, s0: 0.4, dy: 40, ease: b.overshoot > 0 ? 'back-out' : b.ease, fade: 0.2 }),
  } as Layer, 0, dur));
  // Press: the pill dips, a ring answers, the label swaps.
  const pressed = layers[layers.length - 1] as Extract<Layer, { type: 'shape' }>;
  const sk = (pressed.transform?.scale as { k: Key<number>[] } | undefined)?.k ?? [];
  pressed.transform = { ...pressed.transform, scale: { k: [...sk, { t: press, v: 100, ease: 'sine-in' }, { t: press + 0.09, v: 91, ease: 'expo-out' }, { t: press + 0.4, v: 100 }] } };
  layers.push(within(ellipse(nid(c, 'cta-ring'), [pillH * 1.2, pillH * 1.2], accent, { blend: 'screen', transform: { position: pos, scale: keys<number>([press + 0.06, 40, 'expo-out'], [press + 0.95, (pillW * 1.5) / (pillH * 1.2) * 100]), opacity: keys<number>([press + 0.06, 45], [press + 0.95, 0, 'sine-out']) } }), press, dur));
  const tcol = onColour(accent, b);
  const tsize = pillH * 0.38;
  layers.push(within(put(c, { ...textLayer(c, nid(c, 'cta-a'), c.copy.cta, { role: 'label', size: tsize, color: tcol, weight: 700, data: {} }), out: press + 0.14 } as Layer, [pos[0] + pillH * 0.3, y], { at: 0.35, dur: 0.5, dy: 10, blur: 4 }), 0, press + 0.2));
  layers.push(within(put(c, textLayer(c, nid(c, 'cta-b'), `${c.copy.cta.replace(/e?$/, 'ed')}`, { role: 'label', size: tsize, color: tcol, weight: 700, data: {} }), [pos[0] + pillH * 0.3, y], { at: press + 0.1, dur: 0.4, dy: 8, blur: 3 }), press + 0.08, dur));
  layers.push(within(put(c, { id: nid(c, 'cta-play'), name: 'Play', type: 'shape', shape: { shape: 'polygon', sides: 3, size: [pillH * 0.34, pillH * 0.34], fill: tcol }, transform: { rotation: 90 } } as Layer, [c.cx - pillW / 2 + pillH * 0.62, y], { at: 0.45, dur: 0.5, s0: 0.2, ease: 'back-out', fade: 0.15 }), 0, dur));
  void done;
  return { duration: dur, layers };
}
