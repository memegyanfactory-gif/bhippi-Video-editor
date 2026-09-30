// Finish presets (docs/plans/MOTION-ENGINE-UPGRADE-PLAN.md U4.1): the light a whole film is
// graded with, as ONE adjustment layer on top of a scene. Its effects are ordinary effects
// (exposure, glow, vignette, grain), so the user opens the "Finish" layer and changes or switches
// off any of them like any other layer's effects.
//
// Hand-built finishes went wrong in both directions: a glow at threshold 0.75 washed a white UI to
// grey (the audit's own test), and the 15 s film's v1 was too dark to read (luma 21) until an
// exposure lift, a 10% vignette and bloom on colour only brought it up (docs/research/
// launch-film-learnings.md §4.5). The presets carry those numbers:
//   launch-light: the Opus film's light stage: static fine grain (1.1/255) so gradients never
//                 band, no bloom, no vignette, and warm-brown soft shadows under UI cards.
//   launch-dark:  the 15 s v2 dark stage: +0.7 EV in linear light under a hue-preserving
//                 shoulder (knee 0.45, ceiling 0.80), display gamma 0.85, bloom on saturated colour
//                 only (threshold 0.7, knee 0.2, strength 0.32) so white UI and type stay clean,
//                 a 10% vignette and fine luminance-shaped grain.
// Every number can be overridden per film; the presets are a starting light, not a house look.
import type { Effect, Layer, MotionScene } from './types';

export const FINISH_PRESETS = ['launch-light', 'launch-dark'] as const;
export type FinishPreset = (typeof FINISH_PRESETS)[number];

export type Finish = {
  preset: FinishPreset;
  /** Exposure lift in stops, in linear light (dark 0.7, light 0). */
  exposure?: number;
  /** Bloom strength on saturated colour (dark 0.32, light 0 = none). */
  bloom?: number;
  /** Vignette: how much the corners darken, 0–1 (dark 0.1, light 0). */
  vignette?: number;
  /** Grain in 8-bit levels of noise (light 1.1, dark 2.8). */
  grain?: number;
  /** Warm soft shadows under UI cards (light: on, dark: off). */
  cardShadow?: boolean;
  /** Shadow colour: warm brown by default, which is why shadows read soft on cream. */
  shadowColor?: string;
};

type Defaults = Required<Omit<Finish, 'preset'>>;

const DEFAULTS: Record<FinishPreset, Defaults> = {
  'launch-light': { exposure: 0, bloom: 0, vignette: 0, grain: 1.1, cardShadow: true, shadowColor: '#462814' },
  'launch-dark': { exposure: 0.7, bloom: 0.32, vignette: 0.1, grain: 2.8, cardShadow: false, shadowColor: '#462814' },
};

/** The dark finish's tone curve: shoulder in linear light, then display gamma 0.85. */
const DARK_TONE = { linear: true, knee: 0.45, ceiling: 0.8, gamma: 1 / 0.85 };

/** Id of the finish layer; a scene has at most one. */
export const FINISH_LAYER = 'finish';

/** Grain `amount` for a noise of `levels` 8-bit levels: the shader's noise is triangular (σ 0.41) × amount × 0.25. */
const grainAmount = (levels: number) => (levels / 255) / (0.408 * 0.25);

/** A preset with the film's own overrides filled in. */
export function finishSettings(finish: Finish): Defaults & { preset: FinishPreset } {
  const base = DEFAULTS[finish.preset];
  const pick = <K extends keyof Defaults>(key: K): Defaults[K] => (finish[key] ?? base[key]) as Defaults[K];
  return { preset: finish.preset, exposure: pick('exposure'), bloom: pick('bloom'), vignette: pick('vignette'), grain: pick('grain'), cardShadow: pick('cardShadow'), shadowColor: pick('shadowColor') };
}

/** The finish's effect stack, in the order it runs: light, bloom, vignette, grain. */
export function finishEffects(finish: Finish, short = 1080): Effect[] {
  const s = finishSettings(finish);
  const u = short / 1080;
  const effects: Effect[] = [];
  if (s.exposure) effects.push({ type: 'exposure', exposure: s.exposure, ...(s.preset === 'launch-dark' ? DARK_TONE : {}) });
  // Three radii (0.5, 1.2, 2.8 × radius) like the film's bloom; saturation weight 1 keeps white out.
  if (s.bloom > 0) effects.push({ type: 'glow', radius: 24 * u, intensity: s.bloom, threshold: 0.7, knee: 0.2, saturationWeight: 1, deep: true });
  if (s.vignette > 0) effects.push({ type: 'vignette', amount: s.vignette, size: 1.05, softness: 0.75, roundness: 0 });
  // Light films keep one static grain frame (seed 7, as the Opus film did); dark films let it move.
  if (s.grain > 0) effects.push({ type: 'grain', amount: Math.round(grainAmount(s.grain) * 1e4) / 1e4, size: 1, animated: s.preset === 'launch-dark' });
  return effects;
}

/** The finish as an adjustment layer over the whole frame. */
export function finishLayer(finish: Finish, width: number, height: number): Layer {
  return {
    id: FINISH_LAYER,
    name: `Finish · ${finish.preset}`,
    type: 'solid',
    color: '#ffffff',
    size: [width, height],
    adjustment: true,
    effects: finishEffects(finish, Math.min(width, height)),
    note: `Finish preset ${finish.preset}: an adjustment layer that grades everything below it. Change or switch off any effect, or delete the layer.`,
  };
}

/** Reads a finish from a tool argument: a preset name, `{preset, …overrides}`, or "none". */
export function readFinish(value: unknown): Finish | 'none' | null {
  if (value === 'none' || value === false) return 'none';
  const raw = typeof value === 'string' ? { preset: value } : value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!raw || !FINISH_PRESETS.includes(raw.preset as FinishPreset)) return null;
  const n = (key: string, lo: number, hi: number) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? { [key]: Math.min(hi, Math.max(lo, raw[key] as number)) } : {});
  return {
    preset: raw.preset as FinishPreset,
    ...n('exposure', -2, 2), ...n('bloom', 0, 1), ...n('vignette', 0, 0.5), ...n('grain', 0, 12),
    ...(typeof raw.cardShadow === 'boolean' ? { cardShadow: raw.cardShadow } : {}),
    ...(typeof raw.shadowColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.shadowColor) ? { shadowColor: raw.shadowColor } : {}),
  };
}

// ───────────────────────── warm shadows under UI cards ─────────────────────────

const UI_NAME = /\b(card|panel|window|screen|composer|menu|popover|modal|dialog|toast|chat|timeline|monitor|sidebar|ui)\b|ui-parts/i;

/** A layer that reads as a UI card: a rounded panel, a captured UI part or a UI screen, not the stage. */
function isCard(layer: Layer, width: number, height: number): boolean {
  if (layer.adjustment || layer.hidden || layer.ref || layer.type === 'text' || layer.type === 'camera' || layer.type === 'null') return false;
  if (layer.effects?.some((effect) => effect.type === 'drop-shadow' && !effect.finish)) return false;
  const size = 'size' in layer && Array.isArray(layer.size) ? layer.size : null;
  // The stage and full-frame plates are never cards.
  if (size && size[0] >= width * 0.9 && size[1] >= height * 0.9) return false;
  if (layer.type === 'shape') {
    const shape = layer.shape;
    const box = Array.isArray(shape.size) ? (shape.size as number[]) : null;
    const short = Math.min(width, height);
    return shape.shape === 'rect' && !!box && box[0] >= short * 0.12 && box[1] >= short * 0.08 && box[0] < width * 0.9 && typeof shape.radius === 'number' && shape.radius > 0 && (!!shape.fill || !!shape.gradient);
  }
  const label = `${layer.name ?? ''} ${layer.id} ${layer.type === 'footage' ? layer.source.path ?? '' : ''}`;
  return (layer.type === 'footage' || layer.type === 'precomp') && UI_NAME.test(label);
}

/** The Opus film's card shadow: warm brown, soft (blur 40–70 at 1080p), about 30% strong, cast down. */
const cardShadow = (color: string, short: number): Effect => ({ type: 'drop-shadow', color, opacity: 30, distance: 18 * (short / 1080), softness: 56 * (short / 1080), direction: 180, finish: true });

function withoutFinish(layers: Layer[]): Layer[] {
  return layers
    .filter((layer) => layer.id !== FINISH_LAYER)
    .map((layer) => {
      const effects = layer.effects?.filter((effect) => !effect.finish);
      let next = layer;
      if (effects && effects.length !== layer.effects!.length) {
        // A layer that only had the finish's shadow goes back to having no effects at all.
        const { effects: _, ...rest } = layer;
        next = (effects.length ? { ...layer, effects } : rest) as Layer;
      }
      return next.type === 'precomp' ? { ...next, scene: { ...next.scene, layers: withoutFinish(next.scene.layers) } } : next;
    });
}

function shadowCards(layers: Layer[], color: string, width: number, height: number): Layer[] {
  const short = Math.min(width, height);
  return layers.map((layer) => {
    if (isCard(layer, width, height)) return { ...layer, effects: [...(layer.effects ?? []), cardShadow(color, short)] } as Layer;
    if (layer.type === 'precomp') return { ...layer, scene: { ...layer.scene, layers: shadowCards(layer.scene.layers, color, layer.scene.width, layer.scene.height) } };
    return layer;
  });
}

/**
 * The scene with `finish` applied: any earlier finish (its layer and its card shadows) is taken
 * off first, so switching presets or "none" leaves nothing behind. The finish layer goes on top.
 */
export function applyFinish(scene: MotionScene, finish: Finish | 'none'): MotionScene {
  const layers = withoutFinish(scene.layers);
  if (finish === 'none') return { ...scene, layers };
  const s = finishSettings(finish);
  const shadowed = s.cardShadow ? shadowCards(layers, s.shadowColor, scene.width, scene.height) : layers;
  return { ...scene, layers: [...shadowed, finishLayer(finish, scene.width, scene.height)] };
}

/** The preset a scene is finished with, if any. */
export function finishOf(scene: MotionScene): FinishPreset | null {
  const layer = scene.layers.find((entry) => entry.id === FINISH_LAYER && entry.adjustment);
  const match = layer?.name?.match(/launch-(light|dark)/);
  return match ? (`launch-${match[1]}` as FinishPreset) : null;
}

// ───────────────────────── the tone the shader draws ─────────────────────────

/**
 * One colour (0–1 sRGB) through the exposure effect and the bloom threshold, exactly as the GPU
 * runs them (gl/shaders.ts COLOR_FS op 6 and THRESHOLD_FS): for checks and tests without a GPU.
 */
export function toneOf(rgb: number[], p: { exposure?: number; offset?: number; gamma?: number; linear?: boolean; knee?: number; ceiling?: number }): number[] {
  let x = rgb.map((c) => (p.linear ? Math.pow(c, 2.2) : c));
  x = x.map((c) => Math.max(c * Math.pow(2, p.exposure ?? 0) + (p.offset ?? 0), 0));
  const m = Math.max(...x);
  const knee = p.knee ?? 0;
  const ceiling = p.ceiling ?? 0;
  if (knee > 0 && ceiling > knee && m > knee) {
    const rolled = knee + (ceiling - knee) * (1 - Math.exp(-(m - knee) / (ceiling - knee)));
    x = x.map((c) => (c * rolled) / m);
  }
  if (p.linear) x = x.map((c) => Math.pow(c, 1 / 2.2));
  return x.map((c) => Math.min(1, Math.max(0, Math.pow(c, 1 / Math.max(p.gamma ?? 1, 0.01)))));
}

/** How much of a colour (0–1 sRGB) passes into the bloom: the soft threshold times the saturation weight. */
export function bloomShare(rgb: number[], threshold: number, knee: number, saturationWeight: number): number {
  const l = Math.max(...rgb);
  const t = Math.min(1, Math.max(0, (l - (threshold - knee)) / (2 * knee)));
  const k = t * t * (3 - 2 * t);
  const sat = l > 1e-4 ? (l - Math.min(...rgb)) / l : 0;
  return k * (1 - saturationWeight * (1 - sat));
}

/** Whether any layer (in precomps too) carries a finish's card shadow; its colour when it does. */
function finishShadow(layers: Layer[]): string | null {
  for (const layer of layers) {
    const effect = layer.effects?.find((entry) => entry.finish && entry.type === 'drop-shadow');
    if (effect) return typeof effect.color === 'string' ? effect.color : DEFAULTS['launch-light'].shadowColor;
    if (layer.type === 'precomp') { const inner = finishShadow(layer.scene.layers); if (inner) return inner; }
  }
  return null;
}

/**
 * A rebuilt scene keeps the finish its earlier build had: the same finish layer (with any changes
 * made to its effects) on top, and the card shadows on the new layers when it had them.
 */
export function carryFinish(from: MotionScene, to: MotionScene): MotionScene {
  const layer = from.layers.find((entry) => entry.id === FINISH_LAYER && entry.adjustment);
  const preset = finishOf(from);
  if (!layer || !preset) return to;
  const shadow = finishShadow(from.layers);
  const applied = applyFinish(to, { preset, cardShadow: !!shadow, ...(shadow ? { shadowColor: shadow } : {}) });
  return { ...applied, layers: applied.layers.map((entry) => (entry.id === FINISH_LAYER ? layer : entry)) };
}
