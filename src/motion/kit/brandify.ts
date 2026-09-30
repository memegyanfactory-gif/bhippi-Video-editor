// Puts a scene in a brand: every colour of the Crimson system (the templates' house reds, the
// procedural backgrounds' defaults) moves onto a ramp built from the brand's colours, keeping each
// colour's lightness so depth and contrast survive; type takes the brand's fonts; entrance and exit
// eases, word staggers and entrance durations take the brand's motion numbers. Neutral colours
// (white, greys, black) are left alone, and so is footage.
import type { MotionBrand } from '../../lib/brandKit/motionBrand';
import type { Ease, Layer, MotionScene, ProceduralKind, TextLayerData } from '../types';
import type { KitContext } from './common';

// ── colour ───────────────────────────────────────────────────────────────────

type RGB = [number, number, number];
const hexToRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const rgbToHex = (c: RGB) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hsl([r, g, b]: RGB): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60;
  return { h, s, l };
}

/** Warm reds, pinks, oranges and golds: the Crimson system's whole family. */
const isHouseColour = (rgb: RGB) => {
  const { h, s } = hsl(rgb);
  return s >= 0.15 && (h >= 290 || h <= 48);
};

/** The brand's ramp by lightness, anchored where Crimson's named colours sit. */
export function brandRamp(brand: MotionBrand): [number, RGB][] {
  const c = brand.colors;
  const primary = hexToRgb(c.primary);
  const accent = hexToRgb(c.accent);
  const bg = hexToRgb(c.background);
  const black: RGB = [0, 0, 0];
  const white: RGB = [255, 255, 255];
  // A dark stage keeps the brand background as its deepest colour; a light brand still gets a deep,
  // brand-hued stage so the templates' white type keeps its contrast.
  const voidC = brand.stageDark ? bg : mixRgb(primary, black, 0.86);
  const deep = mixRgb(voidC, primary, 0.28);
  return [
    [0.025, voidC], // #0b0204 void
    [0.094, deep], // #2a0610 oxblood
    [0.38, primary], // #b0142f crimson
    [0.56, accent], // #ff1f3d accent
    [0.77, mixRgb(accent, white, 0.55)], // #ff8a9a pink
    [1, white],
  ];
}

/** The brand's own colours: never remapped, even when the brand itself is warm. */
const ownColours = (brand: MotionBrand) => new Set([...Object.values(brand.colors), ...brand.gradient].map((c) => c.toLowerCase().slice(0, 7)));

export function brandColour(value: string, brand: MotionBrand, ramp = brandRamp(brand), own = ownColours(brand)): string {
  const m = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return value;
  let hex = m[1];
  if (hex.length <= 4) hex = hex.split('').map((ch) => ch + ch).join('');
  if (own.has(`#${hex.slice(0, 6).toLowerCase()}`)) return value;
  const rgb = hexToRgb(`#${hex.slice(0, 6)}`);
  if (!isHouseColour(rgb)) return value;
  const { l } = hsl(rgb);
  let out = ramp[0][1];
  if (l >= ramp[ramp.length - 1][0]) out = ramp[ramp.length - 1][1];
  else if (l > ramp[0][0]) {
    const i = ramp.findIndex(([at]) => at >= l);
    const [a, ca] = ramp[i - 1];
    const [b, cb] = ramp[i];
    out = mixRgb(ca, cb, (l - a) / (b - a));
  } else {
    out = mixRgb([0, 0, 0], ramp[0][1], l / ramp[0][0]);
  }
  return `${rgbToHex(out)}${hex.length === 8 ? hex.slice(6) : ''}`;
}

/** The colour params every procedural background falls back to (src/motion/gl/procedural.ts). */
const PROCEDURAL_DEFAULTS: Partial<Record<ProceduralKind, Record<string, string>>> = {
  'crimson-stage': { top: '#0d0204', glow: '#a3102a', hot: '#ff4a64' },
  'radial-glow': { inner: '#6b0a1b', outer: '#0a0204' },
  'linear-gradient': { from: '#0d0204', to: '#a3102a' },
  'hex-field': { base: '#12020a', face: '#b0142f', highlight: '#ff5a70' },
  grid: { bg: '#0a0204', color: '#ff4a6433' },
  'light-rails': { bg: '#0d0204', color: '#ff8a9a' },
  noise: { from: '#0d0204', to: '#3a0710' },
  'light-leak': { color1: '#ff6a2a', color2: '#ff2a5a', color3: '#ffd28a' },
  dots: { bg: '#0a0204', color: '#ff4a6455' },
  aurora: { bg: '#050108', a: '#c2182f', b: '#ff7a3d' },
};

// ── eases and timing ─────────────────────────────────────────────────────────

const OUT_EASES = new Set(['expo-out', 'cubic-out', 'quart-out', 'sine-out', 'ease-out']);
const IN_EASES = new Set(['expo-in', 'cubic-in', 'quart-in', 'sine-in', 'ease-in']);
const brandEase = (ease: unknown, brand: MotionBrand): Ease | unknown => (typeof ease === 'string' && OUT_EASES.has(ease) ? brand.ease : typeof ease === 'string' && IN_EASES.has(ease) ? brand.easeIn : ease);

// ── the walk ─────────────────────────────────────────────────────────────────

function isBrandFont(font: string | undefined, brand: MotionBrand) {
  return !!font && Object.values(brand.fonts).includes(font);
}

function brandText(text: TextLayerData, brand: MotionBrand, short: number) {
  const size = typeof text.size === 'number' ? text.size : short * 0.06;
  const display = size >= short * 0.055;
  if (!isBrandFont(text.font, brand)) {
    text.font = display ? brand.fonts.display : brand.fonts.body;
    if (display && text.weight !== undefined && text.weight >= 600) text.weight = Math.max(brand.weights.display, 500);
  }
  for (const span of text.spans ?? []) if (span.font && !isBrandFont(span.font, brand)) span.font = display ? brand.fonts.display : brand.fonts.body;
  if (text.cascade) {
    text.cascade.ease = brandEase(text.cascade.ease ?? 'expo-out', brand) as Ease;
    if (typeof text.cascade.stagger === 'number' && !text.cascade.times) text.cascade.stagger = brand.wordStagger;
    if (typeof text.cascade.duration === 'number') text.cascade.duration = brand.enter;
    if (text.cascade.exit) text.cascade.exit.ease = brandEase(text.cascade.exit.ease ?? 'expo-in', brand) as Ease;
  }
}

function walk(value: unknown, brand: MotionBrand, ramp: [number, RGB][], own: Set<string>): unknown {
  if (typeof value === 'string') return brandColour(value, brand, ramp, own);
  if (Array.isArray(value)) return value.map((v) => walk(v, brand, ramp, own));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'source' || k === 'id' || k === 'name' || k === 'kind' || k === 'text' && typeof v === 'string' || k === 'expr' || k === 'note' || k === 'brand') out[k] = v;
      else if (k === 'ease') out[k] = brandEase(v, brand);
      else out[k] = walk(v, brand, ramp, own);
    }
    return out;
  }
  return value;
}

/** A copy of `scene` in the brand. Idempotent on already-branded colours (they are not house colours unless the brand is warm red). */
export function brandifyScene(scene: MotionScene, brand: MotionBrand): MotionScene {
  const ramp = brandRamp(brand);
  const own = ownColours(brand);
  const short = Math.min(scene.width, scene.height);
  const prepare = (layers: Layer[]): Layer[] =>
    layers.map((layer) => {
      if (layer.type === 'procedural') {
        const defaults = PROCEDURAL_DEFAULTS[layer.kind] ?? {};
        return { ...layer, params: { ...defaults, ...(layer.params ?? {}) } };
      }
      if (layer.type === 'precomp') return { ...layer, scene: { ...layer.scene, layers: prepare(layer.scene.layers) } };
      return layer;
    });
  const branded = walk({ ...scene, layers: prepare(scene.layers) }, brand, ramp, own) as MotionScene;
  const fixText = (layers: Layer[]) => {
    for (const layer of layers) {
      if (layer.type === 'text') brandText(layer.text, brand, short);
      if (layer.type === 'precomp') fixText(layer.scene.layers);
    }
  };
  fixText(branded.layers);
  return { ...branded, brand: { kitId: brand.kitId, name: brand.name, snapshot: brand } };
}

/**
 * Builds a template in a brand: `brand-*` templates are made from the guideline directly, and so
 * are templates that keep their colours (a captured product, each AI's cursor colour); every other
 * template is built with the brand's font and then put in the brand. Without a brand it is the plain build.
 */
export function buildInBrand(spec: { id: string; keepsColours?: boolean; build: (ctx: KitContext, params: Record<string, unknown>) => MotionScene }, ctx: KitContext, params: Record<string, unknown>, brand: MotionBrand | null | undefined): MotionScene {
  if (!brand) return spec.build(ctx, params);
  const scene = spec.build({ ...ctx, brand, font: ctx.font ?? brand.fonts.display }, params);
  return spec.id.startsWith('brand-') || spec.keepsColours ? scene : brandifyScene(scene, brand);
}
