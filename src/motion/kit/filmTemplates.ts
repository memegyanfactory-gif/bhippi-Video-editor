// Launch-film templates (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md Phase 4): moves every premium
// Bhippi film built by hand, as layered scenes a model fills with words and times. Numbers come
// from the films (docs/research/opus-launch-film-study.md §3.9 and §3.12, film-lab/crimson-explainer.md
// §2), and every template takes the film's own stage, colour and variant, so no two films match.
//   glass-mark   · a logo as glass and light: lands on its beat (or swings shut, or resolves out of
//                  a light point), a specular sheen crosses it, an ember halo breathes, the wordmark
//                  and tagline land after it. Bhippi's own mark, any SVG, or a PNG logo.
//   connect-hub  · providers (Claude, GPT, Gemini, local…) fly in on their words around a hub,
//                  wires draw to it, light pulses run along them, the hub wakes and pulses on the
//                  beats, then everything squeezes into the centre behind a flash.
//   flash-bridge · the warm flash of the drops, laid over a cut between two clips.
//   glow-handoff · a light point laid over a cut: it grows into the cut and contracts where the
//                  next clip's element is.
// Joins between beats of one create_motion_sequence are its transitions (sequence.ts, joins.ts).
import { MARK_B, MARK_LEFT, MARK_LETTER, MARK_RIGHT, MARK_RING, MARK_STROKE } from '../../lib/bhippiMark';
import { FALLBACK_MARKS, VECTOR_MARKS } from '../../lib/providerMarks';
import { flashLayer, glowPointLayer, WARM_WHITE } from '../joins';
import { round, Track } from '../keys';
import type { Effect, Key, Layer, MotionScene, Paint, ShapeItem, Vec } from '../types';
import { svgToShape } from '../vector/svg';
import { headline, scene, unit, type KitContext } from './common';
import type { TemplateSpec } from './index';
import { estimateWidth } from './overlayTemplates';

type Params = Record<string, unknown>;
const F = 1 / 30;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const nums = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []);
const point = (v: unknown): Vec | null => (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number') ? [v[0], v[1]] : null);
const colour = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

/** Records the template id and params on the scene so it can be rebuilt with new words. */
const recorded = (id: string, build: (ctx: KitContext, p: Params) => MotionScene) => (ctx: KitContext, p: Params): MotionScene => ({ ...build(ctx, p), template: { id, params: p } });

// ───────────────────────── stages ─────────────────────────

const STAGE_KINDS = ['light', 'peach', 'dark', 'none'] as const;
type StageKind = (typeof STAGE_KINDS)[number];

/** The films' stages: cream with a soft highlight, peach with a centre lift, and the ember-dark reveal stage. */
const STAGES: Record<Exclude<StageKind, 'none'>, { inner: string; outer: string; center: Vec; ink: string; muted: string }> = {
  light: { inner: '#fcfbf8', outer: '#ebe6df', center: [0.5, 0.36], ink: '#1d1a17', muted: '#6f655c' },
  peach: { inner: '#fff3ea', outer: '#f5d2bd', center: [0.5, 0.45], ink: '#2a1a12', muted: '#7a5a48' },
  dark: { inner: '#2c1208', outer: '#0b0605', center: [0.5, 0.42], ink: '#f6efe8', muted: '#b3aaa2' },
};

const stageLayer = (kind: StageKind): Layer[] => (kind === 'none' ? [] : [{ id: 'stage', name: `Stage (${kind})`, type: 'procedural', kind: 'radial-glow', params: { inner: STAGES[kind].inner, outer: STAGES[kind].outer, center: STAGES[kind].center, radius: 0.95 } }]);
const inkOf = (kind: StageKind) => STAGES[kind === 'none' ? 'dark' : kind];

/** Warm-brown soft shadow (the Opus film's shadow_tex: colour (70, 40, 20), blur 40–70, alpha 0.24–0.34). */
const warmShadow = (u: number, opacity = 30): Effect => ({ type: 'drop-shadow', color: '#462814', opacity, distance: 16 * u, softness: 48 * u, direction: 180 });

// ───────────────────────── the Bhippi mark as shapes ─────────────────────────

const gradientPaint = (g: { from: number[]; to: number[]; stops: [number, string][] }): Paint => ({ gradient: { kind: 'linear', stops: g.stops, from: g.from, to: g.to } });

/**
 * Bhippi's mark in a `size` px box: the two ring halves (each a group that can swing about the
 * centre) and the B. `halves` are rotation props per half; `spin` turns the whole ring.
 */
function bhippiMarkItems(size: number, motion: { left?: Key<number>[]; right?: Key<number>[]; spin?: Key<number>[] } = {}): ShapeItem[] {
  const ring = gradientPaint(MARK_RING);
  const light: Paint = { gradient: { kind: 'linear', stops: [[0, '#fff4dcf2'], [0.45, '#ffb35c59'], [1, '#ff7a1a00']], from: [18, 8], to: [82, 92] } };
  const half = (name: string, d: string, keys?: Key<number>[]): ShapeItem => ({
    kind: 'group', name, transform: { anchor: [50, 50], position: [50, 50], ...(keys?.length ? { rotation: { k: keys } } : {}) },
    items: [
      { kind: 'path', d, fill: null, stroke: { paint: ring, width: MARK_STROKE, cap: 'butt' } },
      { kind: 'path', d, fill: null, stroke: { paint: light, width: 6, cap: 'butt' }, opacity: 60 },
    ],
  });
  return [{
    kind: 'group', name: 'Bhippi mark', transform: { scale: size },
    items: [
      { kind: 'group', name: 'Ring', transform: { anchor: [50, 50], position: [50, 50], ...(motion.spin?.length ? { rotation: { k: motion.spin } } : {}) }, items: [half('Left half', MARK_LEFT, motion.left), half('Right half', MARK_RIGHT, motion.right)] },
      { kind: 'path', name: 'B', d: MARK_B, fill: gradientPaint(MARK_LETTER), stroke: { paint: '#ffc98a8c', width: 1.8, join: 'round' } },
    ],
  }];
}

// ───────────────────────── glass-mark ─────────────────────────

const MATERIALS = ['ember', 'clear', 'frosted', 'tinted'] as const;
type Material = (typeof MATERIALS)[number];

/** Each material's light: what fills the logo, the rim light, the shade and the glow it gives off. */
const MATERIAL: Record<Material, { tint: string; fill: number; rim: string; shade: string; glow: string; refraction: number }> = {
  ember: { tint: '#ff8a24', fill: 0, rim: '#fff2dc', shade: '#5a1a04', glow: '#ff8a24', refraction: 10 },
  clear: { tint: '#dfe9f5', fill: 55, rim: '#ffffff', shade: '#1d2a3a', glow: '#cfe3ff', refraction: 16 },
  frosted: { tint: '#f3f5f8', fill: 80, rim: '#ffffff', shade: '#2a2f38', glow: '#ffffff', refraction: 6 },
  tinted: { tint: '#6f8bff', fill: 60, rim: '#f4f6ff', shade: '#141a3a', glow: '#8fa4ff', refraction: 14 },
};

/**
 * The glass: the logo's own colour (or a fill for clear and tinted glass), a bevel whose height is
 * the blurred alpha (a soft signed-distance field of the logo, so the edges round off like cast
 * glass), a rim of light inside the edge, refraction with a specular from `light` degrees, and the
 * glow the glass gives off. All ordinary effects, editable on the Mark layer.
 */
function glassEffects(material: Material, tint: string, light: number, stage: StageKind, u: number): Effect[] {
  const m = MATERIAL[material];
  const rad = (light * Math.PI) / 180;
  const effects: Effect[] = [];
  if (m.fill) effects.push({ type: 'fill', color: tint, amount: m.fill });
  effects.push(
    { type: 'bevel', size: 20 * u, depth: 140, angle: light, altitude: 38, highlight: m.rim, highlightOpacity: 85, shadow: m.shade, shadowOpacity: 45 },
    { type: 'inner-glow', size: 14 * u, color: m.rim, opacity: 55 },
    { type: 'liquid-glass', bevel: 14 * u, refraction: m.refraction * u, specular: 0.9, tint, tintAmount: 0.12, light: [round(Math.cos(rad) * 0.86), round(-Math.sin(rad) * 0.86)] },
    // On a light stage glass reads by its shadow, not its glow.
    { type: 'glow', radius: 26 * u, intensity: stage === 'dark' || stage === 'none' ? 0.6 : 0.22, threshold: 0.5, color: material === 'ember' ? m.glow : tint },
  );
  if (stage === 'light' || stage === 'peach') effects.push(warmShadow(u, 28));
  return effects;
}

/** The damped clack after a mark lands (crimson film: −9°·e^(−7u)·sin 26u), sampled a frame at a time. */
function clack(at: number, amp: number, sign: number): Key<number>[] {
  const out: Key<number>[] = [];
  for (let i = 1; i <= 18; i++) {
    const t = i * F;
    out.push({ t: round(at + t), v: round(sign * amp * Math.exp(-7 * t) * Math.sin(26 * t)), ease: 'linear' });
  }
  out.push({ t: round(at + 19 * F), v: 0 });
  return out;
}

type MarkSource = { layer: Layer; split: boolean; width: number; height: number };

/** The logo: Bhippi's vector mark, an SVG as shapes, or a PNG/asset as footage. */
function markSource(ctx: KitContext, p: Params, size: number, halves: { left?: Key<number>[]; right?: Key<number>[] }): MarkSource {
  const svg = str(p.svg);
  if (svg && /<svg[\s>]/i.test(svg)) {
    const shape = svgToShape(svg, { fit: [size * 2.4, size] });
    if (shape.groups.length) return { layer: { id: 'mark', name: 'Mark', type: 'shape', shape: { shape: 'rect', groups: shape.groups, bounds: shape.bounds } }, split: false, width: shape.bounds[0], height: shape.bounds[1] };
  }
  const logo = str(p.logo) || ctx.brand?.logoAsset || 'bhippi';
  if (logo.toLowerCase() !== 'bhippi') {
    const source = /[\\/.]/.test(logo) ? { path: logo, kind: 'image' as const } : { asset: logo, kind: 'image' as const };
    return { layer: { id: 'mark', name: 'Mark', type: 'footage', source, fit: 'contain', size: [size * 1.6, size] }, split: false, width: size * 1.6, height: size };
  }
  return { layer: { id: 'mark', name: 'Mark', type: 'shape', shape: { shape: 'rect', groups: bhippiMarkItems(size, halves), bounds: [size, size] } }, split: true, width: size, height: size };
}

function glassMark(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const at = Math.max(0.2, num(p.at, 0.5));
  const size = Math.max(60, num(p.size, 300)) * u;
  const stage = pick(p.stage, STAGE_KINDS, 'dark');
  const ink = inkOf(stage);
  const bhippi = !/<svg[\s>]/i.test(str(p.svg)) && (str(p.logo) || ctx.brand?.logoAsset || 'bhippi').toLowerCase() === 'bhippi';
  const material = pick(p.material, MATERIALS, bhippi ? 'ember' : 'clear');
  const tint = colour(p.tint, material === 'tinted' && ctx.brand ? ctx.brand.colors.accent : MATERIAL[material].tint);
  const light = num(p.light, 120);
  const landing = pick(p.landing, ['land', 'swing', 'resolve'] as const, bhippi ? 'swing' : 'land');
  const wordmark = str(p.wordmark);
  const tagline = str(p.tagline);
  const side = portrait ? 'below' : pick(p.side, ['below', 'right'] as const, 'below');
  const beats = nums(p.beats).filter((b) => b > at + 0.3);
  const sheenAt = num(p.sheenAt, at + 1.0);
  const duration = Math.max(num(p.duration, 3.2), sheenAt + 1, ...beats.map((b) => b + 0.8));

  // Heroes land on empty space at final size: 3 frames early at 1.15×, opaque in 2, blur ≤ 4 px.
  const t0 = at - 3 * F;
  const open = 26; // appears already near shut: past 30° the halves read as a broken bowl
  const leftKeys: Key<number>[] = [];
  const rightKeys: Key<number>[] = [];
  if (landing === 'swing') {
    leftKeys.push({ t: round(t0), v: -open, ease: 'cubic-in' }, { t: round(at), v: 0, ease: 'linear' }, ...clack(at, 9, -1));
    rightKeys.push({ t: round(t0), v: open, ease: 'cubic-in' }, { t: round(at), v: 0, ease: 'linear' }, ...clack(at, 9, 1));
    // A heartbeat on each later beat: the halves part 6° and clack shut.
    for (const b of beats) {
      leftKeys.push({ t: round(b - 0.08), v: 0, ease: 'cubic-out' }, { t: round(b), v: -6, ease: 'cubic-in' }, { t: round(b + 0.16), v: 0 });
      rightKeys.push({ t: round(b - 0.08), v: 0, ease: 'cubic-out' }, { t: round(b), v: 6, ease: 'cubic-in' }, { t: round(b + 0.16), v: 0 });
    }
  }
  const mark = markSource(ctx, p, size, landing === 'swing' ? { left: leftKeys, right: rightKeys } : {});

  // The lockup: the wordmark below the mark, or beside it on a wide frame.
  const wordSize = (portrait ? 120 : 132) * u;
  const wordWidth = wordmark ? estimateWidth(wordmark, wordSize, -30, 700) : 0;
  const gap = 56 * u;
  const lockRight = side === 'right' && !!wordmark;
  const centre: Vec = lockRight ? [W / 2 - (mark.width + gap + wordWidth) / 2 + mark.width / 2, H * 0.47] : [W / 2, wordmark ? H * 0.4 : H * 0.47];
  const wordAt: Vec = lockRight ? [centre[0] + mark.width / 2 + gap, centre[1]] : [W / 2, centre[1] + mark.height / 2 + wordSize * 0.85];

  const scaleKeys = new Track<number>(100);
  const opacity = new Track<number>(100);
  const blur = new Track<number>(0);
  if (landing === 'resolve') {
    // The mark comes out of a light point that contracts onto it (the send glow became the logo).
    scaleKeys.move(at - 2 * F, 0.35, 72, 100, 'expo-out');
    opacity.move(at - 2 * F, 4 * F, 0, 100, 'cubic-out');
    blur.move(at - 2 * F, 0.3, 10 * u, 0, 'expo-out');
  } else {
    scaleKeys.key(t0, 115, 'cubic-in').key(at, 100, 'linear');
    for (let i = 1; i <= 15; i++) scaleKeys.key(at + i * F, 100 * (1 + 0.06 * Math.exp(-8 * i * F) * Math.cos(20 * i * F)), 'linear');
    scaleKeys.key(at + 16 * F, 100);
    opacity.move(t0, 2 * F, 0, 100, 'linear');
    blur.move(t0, 5 * F, 4 * u, 0, 'cubic-out');
  }
  for (const b of beats) scaleKeys.pulse(b - 0.06, 101.8, 0.06, 0, 0.3, 'cubic-out', 'expo-out');
  const markTransform = { position: centre, scale: scaleKeys.prop(), opacity: opacity.prop() };

  const layers: Layer[] = [...stageLayer(stage)];
  // An ember halo that wakes with the mark and breathes on the beats (additive on dark stages).
  if (p.halo !== false) {
    const hs = size * 3;
    const c: Vec = [hs / 2, hs / 2];
    const glowColour = material === 'ember' ? '#ff7a1a' : tint;
    const breathe = new Track<number>(0).key(at - 0.1, 0, 'cubic-out').key(at + 0.35, 90);
    const beatsOrBars = beats.length ? beats : [at + 1.2, at + 2.4].filter((t) => t < duration - 0.2);
    for (const b of beatsOrBars) breathe.key(b - 0.05, 60, 'cubic-out').key(b + 0.12, 100, 'sine-in-out').key(b + 0.6, 65);
    layers.push({
      id: 'halo', name: 'Halo', type: 'shape', bleed: true, blend: stage === 'dark' || stage === 'none' ? 'add' : 'normal',
      transform: { position: centre, opacity: stage === 'dark' || stage === 'none' ? breathe.prop() : { k: (breathe.prop() as { k: Key<number>[] }).k.map((k) => ({ ...k, v: round(k.v * 0.45) })) } },
      shape: { shape: 'rect', bounds: [hs, hs], groups: [{ kind: 'ellipse', position: c, size: [hs, hs], fill: { gradient: { kind: 'radial', stops: [[0, `${glowColour}88`], [0.35, `${glowColour}33`], [1, `${glowColour}00`]], from: c, to: [hs, hs / 2] } } }] },
    });
  }
  // The shockwave ring of the landing (200 px, ×1.6 → ×10.6 over 0.55 s).
  if (p.ring !== false && landing !== 'resolve') {
    const rs = 200 * u;
    layers.push({
      id: 'ring', name: 'Landing ring', type: 'shape', bleed: true, in: round(at), out: round(at + 0.6),
      transform: { position: centre, scale: new Track<number>(160).move(at, 0.55, 160, 1060, 'expo-out').prop(), opacity: new Track<number>(85).move(at, 0.55, 85, 0, 'cubic-out').prop() },
      effects: [{ type: 'glow', radius: 10 * u, intensity: 0.8, color: material === 'ember' ? '#ff8a24' : tint }],
      shape: { shape: 'rect', bounds: [rs + 8, rs + 8], groups: [{ kind: 'ellipse', position: [rs / 2 + 4, rs / 2 + 4], size: [rs, rs], fill: null, stroke: { paint: stage === 'dark' || stage === 'none' ? '#fff2dc' : material === 'ember' ? '#ff8a24' : tint, width: 3 * u } }] },
    });
  }
  if (landing === 'resolve') layers.push(glowPointLayer({ id: 'light-point', from: centre, to: centre, start: at - 0.62, cut: at - 0.3, end: at + 0.05, peak: size, rest: size * 0.3, color: material === 'ember' ? '#ffb45c' : tint }));
  layers.push({ ...mark.layer, transform: markTransform, motionBlur: true, effects: [...(blur.keys.length ? [{ type: 'gaussian-blur', blurriness: blur.prop() } as Effect] : []), ...glassEffects(material, tint, light, stage, u)] } as Layer);
  // A specular sheen crosses the glass, cut by a copy of the mark (the copy sits right above it).
  if (p.sheen !== false && sheenAt < duration) {
    const bw = size * 0.34;
    const bh = mark.height * 2.4;
    layers.push({
      id: 'sheen', name: 'Sheen', type: 'shape', blend: 'add', in: round(sheenAt - 0.05), out: round(sheenAt + 0.8),
      matte: { layer: 'mark-matte', mode: 'alpha' },
      transform: { rotation: 20, position: new Track<Vec>([centre[0] - mark.width, centre[1]]).move(sheenAt, 0.7, [centre[0] - mark.width * 0.9, centre[1]], [centre[0] + mark.width * 0.9, centre[1]], 'sine-in-out').prop() },
      shape: { shape: 'rect', bounds: [bw, bh], groups: [{ kind: 'rect', position: [bw / 2, bh / 2], size: [bw, bh], fill: { gradient: { kind: 'linear', stops: [[0, '#ffffff00'], [0.5, '#ffffffd9'], [1, '#ffffff00']], from: [0, 0], to: [bw, 0] } } }] },
    });
    layers.push({ ...mark.layer, id: 'mark-matte', name: 'Sheen matte', hidden: true, transform: markTransform } as Layer);
  }
  if (wordmark) {
    layers.push(headline('wordmark', wordmark, ctx, { at: at + 0.12, size: wordSize, position: wordAt, align: lockRight ? 'left' : 'center', color: ink.ink, weight: 700, by: 'char', stagger: 0.035, dx: lockRight ? -70 * u : 0, dy: lockRight ? 0 : 26 * u, glow: false }));
  }
  if (tagline) {
    const times = nums(p.taglineTimes);
    const tagSize = 44 * u;
    const tagAt: Vec = lockRight ? [wordAt[0], wordAt[1] + wordSize * 0.78] : [W / 2, wordmark ? wordAt[1] + wordSize * 0.9 : centre[1] + mark.height / 2 + 70 * u];
    layers.push(headline('tagline', tagline, ctx, { at: at + 0.4, size: tagSize, position: tagAt, align: lockRight ? 'left' : 'center', color: ink.muted, weight: 500, stagger: 0.12, dy: 14 * u, glow: false, ...(times.length ? { times } : {}) }));
  }
  // The landing flash, centred on the mark: a radial at twice the frame, decaying e^(−t/0.06).
  if (p.flash !== false && landing !== 'resolve') {
    const fs = Math.max(W, H) * 2;
    const c: Vec = [fs / 2, fs / 2];
    const peak = stage === 'dark' || stage === 'none' ? 72 : 40;
    const decay = new Track<number>(0).key(at - F, 0, 'linear');
    for (let i = 0; i <= 9; i++) decay.key(at + i * F, peak * Math.exp(-(i * F) / 0.06), 'linear');
    decay.key(at + 10 * F, 0);
    layers.push({
      id: 'flash', name: 'Landing flash', type: 'shape', blend: 'add', bleed: true, in: round(at - F), out: round(at + 11 * F),
      transform: { position: centre, opacity: decay.prop() },
      shape: { shape: 'rect', bounds: [fs, fs], groups: [{ kind: 'ellipse', position: c, size: [fs, fs], fill: { gradient: { kind: 'radial', stops: [[0, WARM_WHITE], [0.25, `${WARM_WHITE}80`], [1, `${WARM_WHITE}00`]], from: c, to: [fs, fs / 2] } } }] },
    });
  }
  const cues: NonNullable<MotionScene['cues']> = [{ at: round(at), sound: 'glass', note: 'mark lands' }];
  if (p.sheen !== false && sheenAt < duration) cues.push({ at: round(sheenAt), sound: 'shimmer', note: 'sheen' });
  for (const b of beats) cues.push({ at: round(b), sound: 'tick', note: 'heartbeat' });
  return scene(ctx, round(duration), layers, { cues });
}

// ───────────────────────── connect-hub ─────────────────────────

/** Names a film might use for a provider, to the mark the app draws for it. */
const PROVIDER_KEYS: Record<string, string> = { gpt: 'codex', chatgpt: 'codex', openai: 'codex', codex: 'codex', claude: 'claude', anthropic: 'claude', gemini: 'gemini', google: 'gemini', local: 'local', 'local models': 'local', grok: 'grok', xai: 'grok', kimi: 'kimi', moonshot: 'kimi', antigravity: 'antigravity', opencode: 'opencode' };

type ProviderMark = { label: string; bg: string; fg: string; viewBox: [number, number, number, number]; paths: string[]; glyph: string };

function providerMark(name: string): ProviderMark {
  const key = PROVIDER_KEYS[name.toLowerCase()] ?? name.toLowerCase().replace(/\s+/g, '');
  const vector = VECTOR_MARKS[key];
  if (vector) {
    const vb = (vector.viewBox ?? '0 0 24 24').split(/\s+/).map(Number) as [number, number, number, number];
    // SVG fills an open path as if closed; the engine fills only closed ones (Gemini's star has no Z).
    return { label: name, bg: vector.bg, fg: vector.fg, viewBox: vb, paths: vector.paths.map((d) => (/z\s*$/i.test(d) ? d : `${d}Z`)), glyph: '' };
  }
  const fallback = FALLBACK_MARKS[key];
  return { label: name, bg: fallback?.bg ?? '#262320', fg: fallback?.fg ?? '#e8e2da', viewBox: [0, 0, 24, 24], paths: [], glyph: fallback?.glyph ?? (name.trim()[0] ?? '?').toUpperCase() };
}

const LAYOUTS = ['ring', 'arc', 'column', 'row'] as const;
type HubLayout = (typeof LAYOUTS)[number];

/** Where the hub and each provider sit for a layout, in canvas px. */
function hubPlaces(layout: HubLayout, n: number, W: number, H: number): { hub: Vec; spots: Vec[] } {
  const short = Math.min(W, H);
  const spread = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
  if (layout === 'column') {
    const top = H * 0.26;
    const bottom = H * 0.82;
    return { hub: [W * 0.34, H * 0.54], spots: Array.from({ length: n }, (_, i) => [W * 0.68, top + (bottom - top) * spread(i)]) };
  }
  if (layout === 'row') return { hub: [W / 2, H * 0.4], spots: Array.from({ length: n }, (_, i) => [W * (0.2 + 0.6 * spread(i)), H * 0.74]) };
  if (layout === 'arc') {
    const hub: Vec = [W / 2, H * 0.64];
    const r = short * 0.4;
    return { hub, spots: Array.from({ length: n }, (_, i) => { const a = ((-165 + 150 * spread(i)) * Math.PI) / 180; return [hub[0] + Math.cos(a) * r * (W > H ? 1.35 : 1), hub[1] + Math.sin(a) * r]; }) };
  }
  const hub: Vec = [W / 2, H * 0.55];
  const r = short * 0.33;
  return { hub, spots: Array.from({ length: n }, (_, i) => { const a = ((-90 + 180 / n + (360 * i) / n) * Math.PI) / 180; return [hub[0] + Math.cos(a) * r * (W > H ? 1.25 : 1), hub[1] + Math.sin(a) * r]; }) };
}

function connectHub(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const names = (Array.isArray(p.providers) ? p.providers.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []).slice(0, 8);
  const providers = (names.length ? names : ['Claude', 'GPT', 'Gemini', 'Local']).map(providerMark);
  const n = providers.length;
  const stage = pick(p.stage, STAGE_KINDS, 'light');
  const ink = inkOf(stage);
  const dark = stage === 'dark' || stage === 'none';
  const layout = pick(p.layout, LAYOUTS, 'ring') === 'column' && H > W ? 'row' : pick(p.layout, LAYOUTS, 'ring');
  const wire = colour(p.accent, ctx.brand?.colors.accent ?? '#ff8a24');
  const hubAt = num(p.hubAt, 0.15);
  // Each provider arrives on its word (Claude 18.59, GPT 19.95 … in the Opus film); 0.2 s apart without words.
  const given = nums(p.times);
  const times = providers.map((_, i) => given[i] ?? hubAt + 0.35 + 0.2 * i);
  const lastLand = Math.max(...times);
  const flowAt = num(p.flowAt, lastLand + 0.55);
  const pulses = Math.round(Math.min(6, Math.max(0, num(p.pulses, 3))));
  const beats = nums(p.beats).length ? nums(p.beats) : [0, 1, 2].map((i) => flowAt + 0.5 + 0.4 * i);
  const exit = pick(p.exit, ['squeeze', 'collapse', 'none'] as const, 'squeeze');
  const duration = Math.max(num(p.duration, 4.2), flowAt + 0.42 * pulses + 0.6, ...beats.map((b) => b + 0.6));
  const exitAt = exit === 'none' ? null : num(p.exitAt, duration - 0.7);
  const title = str(p.title);
  const { hub, spots } = hubPlaces(layout, n, W, H);
  const T = (n > 5 ? 112 : 132) * u;
  const HS = 190 * u;

  const layers: Layer[] = [...stageLayer(stage)];
  if (title) layers.push(headline('title', title, ctx, { at: num(p.titleAt, 0.1), size: (H > W ? 76 : 84) * u, position: [W / 2, H * 0.13], color: ink.ink, weight: 700, glow: false, ...(exitAt !== null ? { out: exitAt } : {}) }));

  // Wires: a curve from each provider into the hub, drawn in 0.32 s once it has landed.
  const curves = spots.map((s, i) => {
    const mid: Vec = [(s[0] + hub[0]) / 2, (s[1] + hub[1]) / 2];
    const len = Math.hypot(hub[0] - s[0], hub[1] - s[1]);
    const nx = -(hub[1] - s[1]) / Math.max(1, len);
    const ny = (hub[0] - s[0]) / Math.max(1, len);
    const bow = len * 0.12 * (i % 2 ? 1 : -1);
    const control: Vec = [mid[0] + nx * bow, mid[1] + ny * bow];
    // The curve's own middle, which a pulse passes through.
    const through: Vec = [0.25 * s[0] + 0.5 * control[0] + 0.25 * hub[0], 0.25 * s[1] + 0.5 * control[1] + 0.25 * hub[1]];
    return { control, through };
  });
  spots.forEach((s, i) => {
    const drawn = times[i] + 0.14;
    const end = new Track<number>(0).move(drawn, 0.32, 0, 100, 'cubic-out');
    const start = new Track<number>(0);
    const opacity = new Track<number>(100);
    if (exitAt !== null) { start.move(exitAt, 0.4, 0, 100, 'expo-in'); opacity.move(exitAt + 0.25, 0.2, 100, 0, 'linear'); }
    layers.push({
      id: `wire-${i + 1}`, name: `Wire · ${providers[i].label}`, type: 'shape', in: round(drawn),
      transform: { position: [W / 2, H / 2], opacity: opacity.prop() },
      ...(dark ? { effects: [{ type: 'glow', radius: 8 * u, intensity: 0.6, color: wire }] } : {}),
      shape: { shape: 'rect', bounds: [W, H], groups: [{ kind: 'path', d: `M${round(s[0])} ${round(s[1])} Q${round(curves[i].control[0])} ${round(curves[i].control[1])} ${round(hub[0])} ${round(hub[1])}`, fill: null, stroke: { paint: wire, width: 4 * u, cap: 'round', trim: { start: start.prop(), end: end.prop() } } }] },
    });
  });

  // Light pulses run in along each wire: three per wire, 0.42 s apart.
  if (pulses) spots.forEach((s, i) => {
    const d = 22 * u;
    const c: Vec = [d, d];
    const position: Key<Vec>[] = [];
    const opacity = new Track<number>(0);
    for (let k = 0; k < pulses; k++) {
      const t = flowAt + 0.06 * i + 0.42 * k;
      if (exitAt !== null && t + 0.36 > exitAt) break;
      position.push({ t: round(t), v: [round(s[0]), round(s[1])], ease: 'sine-in-out', through: curves[i].through.map(round) }, { t: round(t + 0.36), v: [round(hub[0]), round(hub[1])], ease: 'hold' });
      opacity.key(t, 0, 'cubic-out').key(t + 0.06, 100).key(t + 0.28, 100, 'cubic-in').key(t + 0.36, 0);
    }
    if (!position.length) return;
    layers.push({
      id: `pulse-${i + 1}`, name: `Pulse · ${providers[i].label}`, type: 'shape', blend: dark ? 'add' : 'normal', motionBlur: true, in: round(flowAt - 0.05),
      transform: { position: { k: position }, opacity: opacity.prop() },
      effects: [{ type: 'glow', radius: 10 * u, intensity: 0.9, color: wire }],
      shape: { shape: 'rect', bounds: [d * 2, d * 2], groups: [{ kind: 'ellipse', position: c, size: [d * 2, d * 2], fill: { gradient: { kind: 'radial', stops: [[0, '#ffffff'], [0.3, wire], [1, `${wire}00`]], from: c, to: [d * 2, d] } } }] },
    });
  });

  // Provider tiles, with the app's own marks: they fly in from outside on their word, blur 12 → 0.
  providers.forEach((mark, i) => {
    const s = spots[i];
    const t = times[i];
    const len = Math.hypot(s[0] - hub[0], s[1] - hub[1]) || 1;
    const outward: Vec = [s[0] + ((s[0] - hub[0]) / len) * 280 * u, s[1] + ((s[1] - hub[1]) / len) * 280 * u];
    const position = new Track<Vec>(s).move(t, 0.5, outward, s, 'expo-out');
    const scale = new Track<number>(100).move(t, 0.45, 86, 100, 'back-out');
    const opacity = new Track<number>(0).move(t, 0.12, 0, 100, 'linear');
    if (exitAt !== null) {
      position.move(exitAt, exit === 'collapse' ? 0.45 : 0.5, s, hub, 'expo-in');
      scale.move(exitAt, exit === 'collapse' ? 0.45 : 0.5, 100, exit === 'collapse' ? 10 : 20, 'expo-in');
      if (exit === 'collapse') opacity.key(exitAt + 0.4, 100, 'linear').key(exitAt + 0.45, 0);
    }
    const c: Vec = [T / 2, T / 2];
    const [vx, vy, vw, vh] = mark.viewBox;
    const connected = times[i] + 0.46;
    const items: ShapeItem[] = [
      { kind: 'rect', name: 'Tile', position: c, size: [T, T], radius: T * 0.24, fill: mark.bg, stroke: { paint: dark ? '#ffffff26' : '#00000017', width: 1.5 * u } },
      ...(mark.paths.length ? [{ kind: 'group' as const, name: `${mark.label} mark`, fill: mark.fg, transform: { anchor: [vx + vw / 2, vy + vh / 2], position: c, scale: ((T * 0.52) / Math.max(vw, vh)) * 100 }, items: mark.paths.map((d): ShapeItem => ({ kind: 'path', d })) }] : []),
      // The green "connected" dot pops as its wire reaches the hub.
      { kind: 'group', name: 'Connected', transform: { anchor: [T * 0.84, T * 0.16], position: [T * 0.84, T * 0.16], scale: new Track<number>(0).move(connected, 0.28, 0, 100, 'back-out').prop() }, items: [{ kind: 'ellipse', position: [T * 0.84, T * 0.16], size: [T * 0.16, T * 0.16], fill: '#34c759', stroke: { paint: '#ffffff', width: 2.5 * u } }] },
    ];
    layers.push({
      id: `provider-${i + 1}`, name: mark.label, type: 'shape', motionBlur: true, in: round(t),
      transform: { position: position.prop(), scale: scale.prop(), opacity: opacity.prop() },
      effects: [{ type: 'gaussian-blur', blurriness: new Track<number>(0).move(t, 0.24, 12 * u, 0, 'cubic-out').prop() }, ...(dark ? [] : [warmShadow(u, 26)])],
      shape: { shape: 'rect', bounds: [T, T], groups: items },
    });
    // A provider with no vector mark shows its initial, as the app's fallback does.
    if (!mark.paths.length) layers.push({ id: `provider-${i + 1}-glyph`, name: `${mark.label} glyph`, type: 'text', parent: `provider-${i + 1}`, transform: { position: c }, text: { text: mark.glyph, size: T * 0.5, weight: 700, color: mark.fg, align: 'center', font: ctx.font } });
    if (p.labels !== false) {
      const below = layout !== 'column';
      layers.push({
        id: `label-${i + 1}`, name: `${mark.label} label`, type: 'text', in: round(t + 0.08),
        ...(exitAt !== null ? { out: round(exitAt + 0.25) } : {}),
        transform: { position: below ? [s[0], s[1] + T / 2 + 34 * u] : [s[0] + T / 2 + 28 * u, s[1]], opacity: new Track<number>(0).move(t + 0.08, 0.3, 0, 100, 'expo-out').key(exitAt ?? duration + 1, 100, 'expo-in').key((exitAt ?? duration + 1) + 0.2, 0).prop() },
        text: { text: mark.label, size: 30 * u, weight: 600, color: ink.muted, align: below ? 'center' : 'left', font: ctx.font },
      });
    }
  });

  // The hub: Bhippi's mark (or the brand's logo) on a dark tile. It pops in, wakes (the ring turns)
  // while the light flows, and pulses on the beats.
  const hubScale = new Track<number>(100).move(hubAt, 0.4, 0, 100, 'back-out');
  for (const b of beats) hubScale.pulse(b - 0.05, 108, 0.05, 0, 0.3, 'cubic-out', 'expo-out');
  if (exitAt !== null) {
    if (exit === 'collapse') hubScale.pulse(exitAt + 0.4, 112, 0.06, 0, 0.3, 'cubic-out', 'back-out');
    else hubScale.move(exitAt, 0.5, 100, 60, 'expo-in');
  }
  const hubLogo = str(p.hub) || ctx.brand?.logoAsset || 'bhippi';
  const spinEnd = exitAt ?? duration;
  const hc: Vec = [HS / 2, HS / 2];
  const hubItems: ShapeItem[] = [{ kind: 'rect', name: 'Tile', position: hc, size: [HS, HS], radius: HS * 0.26, fill: '#16161b', stroke: { paint: '#ffffff1f', width: 1.5 * u } }];
  if (hubLogo.toLowerCase() === 'bhippi') hubItems.push({ kind: 'group', name: 'Mark', transform: { anchor: [HS * 0.36, HS * 0.36], position: hc }, items: bhippiMarkItems(HS * 0.72, { spin: [{ t: round(flowAt), v: 0, ease: 'sine-in-out' }, { t: round(spinEnd), v: round(48 * (spinEnd - flowAt)) }] }) });
  layers.push({ id: 'hub-ring', name: 'Hub pulse ring', type: 'shape', transform: { position: hub, scale: { k: beats.flatMap((b): Key<number>[] => [{ t: round(b), v: 100, ease: 'expo-out' }, { t: round(b + 0.5), v: 190, ease: 'hold' }]) }, opacity: { k: [{ t: 0, v: 0, ease: 'hold' }, ...beats.flatMap((b): Key<number>[] => [{ t: round(b), v: 90, ease: 'cubic-out' }, { t: round(b + 0.5), v: 0, ease: 'hold' }])] } }, shape: { shape: 'rect', bounds: [HS * 1.2, HS * 1.2], groups: [{ kind: 'rect', position: [HS * 0.6, HS * 0.6], size: [HS * 1.08, HS * 1.08], radius: HS * 0.3, fill: null, stroke: { paint: wire, width: 3 * u } }] } });
  layers.push({
    id: 'hub', name: 'Hub', type: 'shape', motionBlur: true,
    transform: { position: hub, scale: hubScale.prop(), opacity: new Track<number>(0).move(hubAt, 0.08, 0, 100, 'linear').prop() },
    effects: [...(dark ? [{ type: 'glow', radius: 18 * u, intensity: 0.35, threshold: 0.4, color: '#ff8a24' } as Effect] : [warmShadow(u, 32)])],
    shape: { shape: 'rect', bounds: [HS, HS], groups: hubItems },
  });
  if (hubLogo.toLowerCase() === 'none') {
    // A product with no logo to show: its name's first letter on the tile, as a provider without a
    // mark shows its initial. Never Bhippi's mark in someone else's film.
    const initial = Array.from(str(p.name) || ctx.brand?.name || '').find((ch) => /[\p{L}\p{N}]/u.test(ch));
    if (initial) layers.push({ id: 'hub-initial', name: 'Hub initial', type: 'text', parent: 'hub', transform: { position: hc }, text: { text: initial.toUpperCase(), size: HS * 0.46, weight: 700, color: '#ffffff', align: 'center', font: ctx.font } });
  } else if (hubLogo.toLowerCase() !== 'bhippi') {
    const source = /[\\/.]/.test(hubLogo) ? { path: hubLogo, kind: 'image' as const } : { asset: hubLogo, kind: 'image' as const };
    layers.push({ id: 'hub-logo', name: 'Hub logo', type: 'footage', parent: 'hub', source, fit: 'contain', size: [HS * 0.62, HS * 0.62], transform: { position: hc } });
  }
  // The exit: everything squeezes into the hub behind a warm flash.
  if (exitAt !== null && exit === 'squeeze') layers.push(flashLayer({ id: 'flash', cut: exitAt + 0.5, rise: 0.25, decay: 0.3, strength: 0.75 }));

  const cues: NonNullable<MotionScene['cues']> = [
    { at: round(hubAt), sound: 'pop', note: 'hub' },
    ...times.map((t, i) => ({ at: round(t), sound: 'pop' as const, note: providers[i].label })),
    ...(pulses ? [{ at: round(flowAt), sound: 'shimmer' as const, note: 'light flows in' }] : []),
    ...beats.map((b) => ({ at: round(b), sound: 'tick' as const, note: 'hub pulse' })),
    ...(exitAt !== null ? [{ at: round(exitAt), sound: 'whoosh' as const, note: exit }] : []),
  ];
  return scene(ctx, round(duration), layers, { cues: cues.filter((c) => c.at < duration).sort((a, b) => a.at - b.at) });
}

// ───────────────────────── joins between clips ─────────────────────────

function flashBridge(ctx: KitContext, p: Params): MotionScene {
  const rise = Math.max(F, num(p.rise, 0.27));
  const decay = Math.max(F, num(p.decay, 0.33));
  const cut = Math.max(rise, num(p.cut, rise + 0.03));
  const strength = Math.min(1, Math.max(0.1, num(p.strength, 0.7)));
  return scene(ctx, round(cut + decay + 0.1), [flashLayer({ id: 'flash', cut, rise, decay, strength, color: colour(p.color, WARM_WHITE) })], { cues: [{ at: round(cut), sound: 'shimmer', note: 'flash on the cut' }] });
}

function glowHandoff(ctx: KitContext, p: Params): MotionScene {
  const W = ctx.width;
  const H = ctx.height;
  const rise = Math.max(0.1, num(p.rise, 0.32));
  const fall = Math.max(0.1, num(p.fall, 0.38));
  const cut = Math.max(rise, num(p.cut, rise + 0.03));
  const from = point(p.from) ?? [W / 2, H / 2];
  const to = point(p.to) ?? [W / 2, H / 2];
  const peak = Math.max(40, num(p.size, Math.min(W, H) * 0.3));
  return scene(ctx, round(cut + fall + 0.2), [glowPointLayer({ id: 'light-point', from, to, start: cut - rise, cut, end: cut + fall, peak, color: colour(p.color, '#ffb45c') })], { cues: [{ at: round(cut), sound: 'glass', note: 'light handoff' }] });
}

export const FILM_TEMPLATES: TemplateSpec[] = [
  {
    id: 'glass-mark',
    label: 'Glass mark (logo as glass and light)',
    technique: 'launch films: glass logo reveal + lockup',
    use: 'Identity moments and the logo reveal of a launch film: the logo as glass and light lands on its beat (or its halves swing shut, or it resolves out of a light point), a specular sheen crosses it, a halo breathes, and the wordmark and tagline land after it. Bhippi\'s own mark by default (the brand kit\'s logo when one is active); give svg (markup) for the sharpest glass edges, or logo (an asset id or PNG path).',
    params: {
      logo: 'string — asset id or image path of the logo ("bhippi" for Bhippi\'s mark; default the brand kit\'s logo, else Bhippi\'s)',
      svg: 'string — the logo as SVG markup (drawn as vector glass)',
      material: '"ember" | "clear" | "frosted" | "tinted" (ember for Bhippi\'s mark, clear for others)',
      tint: 'colour — the glass tint (tinted/clear)',
      stage: '"dark" | "light" | "peach" | "none" ("dark") — none lays it over the footage',
      landing: '"swing" | "land" | "resolve" (swing for split marks) — resolve comes out of a light point',
      at: 'number s (0.5) — the beat or word the mark lands on',
      size: 'number px at 1080p (300)',
      wordmark: 'string — the name beside or below the mark',
      tagline: 'string — lands word by word',
      taglineTimes: 'number[] — scene seconds each tagline word lands (the sung syllables)',
      side: '"below" | "right" ("below") — where the wordmark sits',
      beats: 'number[] — later beats the mark pulses on (heartbeat)',
      sheenAt: 'number s — when the sheen crosses (at + 1)',
      light: 'number degrees (120) — where the light comes from',
      halo: 'boolean (true)', ring: 'boolean (true) — the landing shockwave', flash: 'boolean (true) — the landing flash', sheen: 'boolean (true)',
      duration: 'number s (3.2)',
    },
    seconds: 3.2,
    fullFrame: true,
    build: recorded('glass-mark', glassMark),
  },
  {
    id: 'connect-hub',
    label: 'Connect hub (providers wire in)',
    technique: 'launch films: hub and spoke',
    use: '"Connect your AI" without a word: providers (Claude, GPT, Gemini, local…) fly in on their names around the product\'s hub, wires draw to it, light pulses run in along them, the hub wakes and pulses on the beats, then everything squeezes into the centre behind a flash (or collapses into the hub). Provider marks are the app\'s own logos. Give times from the transcript so each lands on its word.',
    params: {
      providers: 'string[] (≤8) — provider names ("Claude", "GPT", "Gemini", "Local", "Grok", "Kimi"…)',
      times: 'number[] — scene seconds each provider lands (its word)',
      layout: '"ring" | "arc" | "column" | "row" ("ring")',
      stage: '"light" | "peach" | "dark" | "none" ("light")',
      accent: 'colour — wires and pulses (the brand accent, else ember #ff8a24)',
      hub: 'string — asset id or image path for the hub logo ("bhippi" for Bhippi\'s mark, "none" for the name\'s initial; default the brand kit\'s logo, else Bhippi\'s)',
      name: 'string — the product\'s name: its initial fills a hub with no logo (hub "none")',
      title: 'string — a headline above ("Connect your AI")',
      titleAt: 'number s (0.1)',
      hubAt: 'number s (0.15)',
      flowAt: 'number s — when the light starts running in (after the last provider lands)',
      pulses: 'number 0–6 (3) — pulses per wire',
      beats: 'number[] — beats the hub pulses on',
      exit: '"squeeze" | "collapse" | "none" ("squeeze")',
      exitAt: 'number s — when the exit starts (0.7 s before the end)',
      labels: 'boolean (true) — provider names under the tiles',
      duration: 'number s (4.2)',
    },
    seconds: 4.2,
    fullFrame: true,
    build: recorded('connect-hub', connectHub),
  },
  {
    id: 'flash-bridge',
    label: 'Flash bridge (warm flash on a cut)',
    technique: 'launch films: flash bridge join',
    use: 'Hides a hard change between two clips on a drop or reveal: a warm-white flash rises into the cut and decays into the next shot. Place it so `cut` sits on the cut (start = cut time − cut). Between beats of one create_motion_sequence use the flash-bridge transition instead.',
    params: { cut: 'number s (0.3) — where in the overlay the cut is', strength: 'number 0.5–0.9 (0.7) — the peak', color: 'colour (#fff7eb) — warm white', rise: 'number s (0.27)', decay: 'number s (0.33)' },
    seconds: 0.73,
    fullFrame: false,
    build: recorded('flash-bridge', flashBridge),
  },
  {
    id: 'glow-handoff',
    label: 'Glow handoff (a light point becomes the next shot)',
    technique: 'launch films: light point handoff',
    use: 'Joins two clips through a light: a glow lights at `from` (a send button, a spark), drifts to `to` growing into the cut, then contracts where the next clip\'s element is. Place it so `cut` sits on the cut. Between beats of one create_motion_sequence use the glow-handoff transition, which also brings the next beat up under the light.',
    params: { from: '[x, y] px — where the light starts (centre)', to: '[x, y] px — where it becomes the next element (centre)', cut: 'number s (0.35)', size: 'number px — the peak glow (30% of the short side)', color: 'colour (#ffb45c)', rise: 'number s (0.32)', fall: 'number s (0.38)' },
    seconds: 0.93,
    fullFrame: false,
    build: recorded('glow-handoff', glowHandoff),
  },
];
