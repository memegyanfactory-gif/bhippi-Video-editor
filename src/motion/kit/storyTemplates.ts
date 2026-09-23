// Story templates: the reference video's storytelling devices as native motion scenes.
//   blurred-sentence (T8)  · a sentence over the blurred speaker, keywords red, strike + swap
//   zoom-tunnel      (T19) · a wall of thumbnails dives at the camera through a zoom blur
//   social-card      (T23) · a YouTube-style card floating on the stage, views counting up
//   demo-callouts    (T24) · a screen recording in a floating frame with dashed callouts
//   comparison-pair  (T25) · two cards slide in from opposite sides with labels
//   grade-hit        (T20) · an adjustment-layer grade that switches on the beat
//   big-number-behind(T27) · huge type sandwiched between the plate and the cut-out presenter
//   stylized-broll   (T21) · duotone b-roll with halation and a stacked kinetic caption
// Every layout is in `unit(ctx)` (1 = 1 px at 1080p on the short side) and adapts to portrait.
import { keys } from '../anim';
import type { Ease, Effect, FootageSource, Key, Layer, MotionScene, TextLayerData, TextSpan, Vec } from '../types';
import { blurFx, glowFx, pal, scene, shadowFx, stage, unit, type KitContext } from './common';
import type { TemplateSpec } from './index';

// ───────────────────────── helpers ─────────────────────────

type Params = Record<string, unknown>;

/** Footage params arrive as `{ asset | path, in?, matte? }` or a bare asset id / path string. */
function source(value: unknown): FootageSource | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return /[\\/.]/.test(value) ? { path: value } : { asset: value };
  if (typeof value === 'object') return { ...(value as FootageSource) };
  return undefined;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const TRACK = -3;

/**
 * Rough advance of `text` at `size` for layouts that must be decided before measuring (the
 * builders are pure). Tuned to a bold geometric sans; errs a little wide.
 */
export function estimateWidth(text: string, size: number, tracking = TRACK, script = false): number {
  let w = 0;
  for (const ch of Array.from(text)) {
    let k = 0.56;
    if (ch === ' ') k = 0.27;
    else if ('il.,:;\'!|’`'.includes(ch)) k = 0.27;
    else if ('fjrtI()[]'.includes(ch)) k = 0.36;
    else if ('mwMW@%'.includes(ch)) k = 0.88;
    else if (/[0-9]/.test(ch)) k = 0.58;
    else if (/[A-Z]/.test(ch)) k = 0.68;
    if (script) k *= 0.82;
    w += size * k + tracking * (size / 1000) * 10;
  }
  return Math.max(0, w);
}

/** The text layout's padding (the renderer draws text into a padded box). Pure. */

/** Rich text shorthand: `*italic*`, `~script~`, `[accent]`. Returns spans. */
export function richSpans(text: string, accent: string, base: Partial<TextSpan> = {}): TextSpan[] {
  const spans: TextSpan[] = [];
  const re = /(\*[^*]+\*|~[^~]+~|\[[^\]]+\])/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ ...base, text: text.slice(last, index) });
    const body = match[0].slice(1, -1);
    if (match[0][0] === '*') spans.push({ ...base, text: body, italic: true });
    else if (match[0][0] === '~') spans.push({ ...base, text: body, font: 'script' });
    else spans.push({ ...base, text: body, color: accent });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ ...base, text: text.slice(last) });
  return spans.filter((span) => span.text.length);
}

const spansText = (spans: TextSpan[]) => spans.map((span) => span.text).join('');

function textLayer(id: string, data: TextLayerData, extra: Partial<Layer> = {}): Layer {
  return { id, name: (data.text ?? spansText(data.spans ?? [])).slice(0, 32) || id, type: 'text', text: data, ...extra } as Layer;
}

/**
 * Makes a text layer's static `position` mean "left edge, top of the first line box" for a block of
 * `lines` lines. The renderer anchors left-aligned text at [pad(t), height/2]; the padding grows
 * and shrinks with the animation symmetrically, so the distance from that anchor to the first
 * line box only depends on the line sizes and count.
 */
function anchorTopLeft(layer: Layer, lines = 1): Layer {
  if (layer.type !== 'text') return layer;
  const data = layer.text;
  const base = typeof data.size === 'number' ? data.size : 96;
  const lineSize = Math.max(base, ...(data.spans ?? []).map((span) => span.size ?? (span.font === 'script' ? base * 1.1 : base)));
  const lh = data.lineHeight ?? 1.12;
  const offset = (lineSize * lh * Math.max(1, lines) - lineSize * (lh - 1) * 0.5) / 2;
  const position = layer.transform?.position;
  const at = Array.isArray(position) ? position : [0, 0];
  const { anchor: _drop, ...rest } = layer.transform ?? {};
  void _drop;
  layer.transform = { ...rest, position: [at[0], at[1] + offset] };
  return layer;
}

function rect(id: string, size: Vec, opts: { radius?: number; fill?: string | null; stroke?: string | null; strokeWidth?: number; dash?: Vec; gradient?: { kind: 'linear' | 'radial'; stops: [number, string][]; from?: Vec; to?: Vec } } & Partial<Layer> = {}): Layer {
  const { radius, fill, stroke, strokeWidth, dash, gradient, ...extra } = opts;
  return { id, type: 'shape', shape: { shape: 'rect', size, radius: radius ?? 0, fill: fill === undefined ? '#ffffff' : fill, stroke: stroke ?? null, strokeWidth: strokeWidth ?? 0, ...(dash ? { dash } : {}), ...(gradient ? { gradient } : {}) }, ...extra } as Layer;
}

const fade = (at: number, dur = 0.3, ease: Ease = 'expo-out') => keys<number>([at, 0, ease], [at + dur, 100]);
/** Opacity in at `at`, out at `out` (faster, expo-in). */
function fadeInOut(at: number, inDur: number, out: number | null, outDur = 0.25): { k: Key<number>[] } {
  const k: Key<number>[] = [{ t: at, v: 0, ease: 'expo-out' }, { t: at + inDur, v: 100 }];
  if (out !== null && out > at + inDur) k.push({ t: out, v: 100, ease: 'expo-in' }, { t: out + outDur, v: 0 });
  return { k };
}
/** Gaussian-blur effect keyed in (and optionally out). */
function blurInOut(at: number, amount: number, dur: number, out: number | null = null, outDur = 0.25): Effect {
  const k: Key<number>[] = [{ t: at, v: amount, ease: 'expo-out' }, { t: at + dur, v: 0 }];
  if (out !== null && out > at + dur) k.push({ t: out, v: 0, ease: 'expo-in' }, { t: out + outDur, v: amount * 0.7 });
  return blurFx({ k });
}

const template = (id: string, params: Params) => ({ id, params });

// ───────────────────────── T8 blurred-sentence ─────────────────────────

export type BlurredSentenceParams = {
  footage?: FootageSource | string;
  sentence?: string;
  keywords?: string[];
  times?: number[];
  strike?: { words: string; at?: number; replaceWith?: string; replaceAt?: number; times?: number[] } | null;
  at?: number;
  duration?: number;
  size?: number;
  blurIn?: boolean;
};

function blurredSentence(ctx: KitContext, params: BlurredSentenceParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.3;
  const sentence = words(params.sentence ?? "because you don't know what to make");
  const times = sentence.map((_, i) => params.times?.[i] ?? at + i * 0.13);
  const size = params.size ?? (portrait ? 80 : 64) * u;
  const box = portrait ? W * 0.84 : W * 0.88;
  const keySet = new Set((params.keywords ?? []).flatMap(words).map(norm));
  const colorOf = (word: string) => (keySet.has(norm(word)) ? p.accent : p.white);

  // Strike range inside the sentence.
  const strike = params.strike && params.strike.words ? params.strike : null;
  let s0 = -1;
  let s1 = -1;
  if (strike) {
    const target = words(strike.words).map(norm);
    for (let i = 0; i + target.length <= sentence.length && s0 < 0; i++) {
      if (target.every((w, k) => norm(sentence[i + k]) === w)) { s0 = i; s1 = i + target.length - 1; }
    }
  }
  const hasStrike = !!strike && s0 >= 0;
  const strikeAt = strike?.at ?? (times[times.length - 1] ?? at) + 0.6;
  const replaceAt = strike?.replaceAt ?? strikeAt + 0.7;
  const replacement = words(strike?.replaceWith ?? '');
  const rTimes = replacement.map((_, j) => strike?.times?.[j] ?? replaceAt + 0.12 + j * 0.13);
  const lastWord = hasStrike ? Math.max(times[times.length - 1] ?? at, rTimes[rTimes.length - 1] ?? replaceAt) : times[times.length - 1] ?? at;
  const duration = params.duration ?? Math.max(2.5, lastWord + 1.6);

  // The speaker, pushed back: blurred, darkened, desaturated, slowly drifting.
  const blurAmount = 46 * u;
  const bg: Layer = {
    id: 'speaker',
    name: 'Speaker (blurred)',
    type: 'footage',
    source: source(params.footage) ?? { asset: '' },
    fit: 'cover',
    transform: { scale: keys<number>([0, 108, 'sine-in-out'], [duration, 113]) },
    effects: [
      blurFx(params.blurIn === false ? blurAmount : keys<number>([0, 0, 'expo-out'], [Math.max(0.25, at), blurAmount])),
      { type: 'brightness-contrast', brightness: params.blurIn === false ? -20 : keys<number>([0, 0, 'expo-out'], [Math.max(0.25, at), -20]), contrast: -6 },
      { type: 'hue-saturation', saturation: -12 },
      { type: 'vignette', amount: 0.45, size: 1.05, softness: 0.8 },
    ],
  };

  const cascadeBase = { by: 'word' as const, duration: 0.55, ease: 'expo-out' as Ease, from: { opacity: 0, blur: 14 * u, position: [0, 18 * u] }, dimTo: 0.55, brightenAfter: 0.16 };
  const baseData = { font: ctx.font, size, weight: 700, color: p.white, tracking: TRACK, lineHeight: 1.18 };
  const wordSpans = (list: { w: string; color: string }[], trailing: boolean): TextSpan[] => list.map((item, i) => ({ text: item.w + (i < list.length - 1 || trailing ? ' ' : ''), color: item.color }));
  const glow = [glowFx(14 * u, 0.5)];

  if (!hasStrike) {
    // Balanced wrap: split into the fewest lines of similar length (no one-word widow).
    const est = estimateWidth(sentence.join(' '), size);
    const lines = Math.max(1, Math.ceil(est / box));
    const balanced = lines > 1 ? Math.min(box, (est / lines) * 1.12) : box;
    const text = textLayer('sentence', {
      ...baseData,
      spans: wordSpans(sentence.map((w) => ({ w, color: colorOf(w) })), false),
      align: 'center',
      box: balanced,
      cascade: { ...cascadeBase, times },
    }, { transform: { position: [W / 2, H / 2] }, effects: glow });
    return scene(ctx, duration, [bg, text], {
      background: '#000000',
      cues: [{ at: Math.max(0, at - 0.15), sound: 'whoosh', note: 'blur in' }],
      template: template('blurred-sentence', params as Params),
    });
  }

  // With a strike: two left-aligned layers share the same origin so the unchanged prefix stays
  // put. A holds the original (prefix invisible) and carries the strike; B holds the prefix and
  // the replacement. A null glides the pair so the line stays centred as the words swap.
  // Lines are broken here (greedy, on estimated widths) with explicit newlines rather than by a
  // wrap box: the shared prefix then breaks identically in both layers and the line counts are
  // known, which the vertical anchor depends on.
  const breakAfter = (list: string[]) => {
    const seps: string[] = [];
    let x = 0;
    list.forEach((word, i) => {
      const w = estimateWidth(word, size);
      if (i > 0) {
        const space = estimateWidth(' ', size);
        if (x + space + w > box * 0.9) { seps[i - 1] = '\n'; x = w; return; }
        seps[i - 1] = ' ';
        x += space + w;
      } else x = w;
    });
    seps[list.length - 1] = '';
    return seps;
  };
  const measureLines = (list: string[], seps: string[]) => {
    const lines: string[] = [''];
    list.forEach((word, i) => { lines[lines.length - 1] += word; if (seps[i] === '\n') lines.push(''); else if (seps[i]) lines[lines.length - 1] += ' '; });
    return { count: lines.length, width: Math.max(...lines.map((line) => estimateWidth(line.trim(), size))) };
  };
  const prefix = sentence.slice(0, s0);
  const struck = sentence.slice(s0, s1 + 1);
  const suffix = sentence.slice(s1 + 1);
  const sepA = breakAfter(sentence);
  const clear = '#ffffff00';
  const aSpans: TextSpan[] = prefix.map((w, i) => ({ text: w + sepA[i], color: clear }));
  // One struck span per line so each line gets its own strike.
  let run = '';
  struck.forEach((w, k) => {
    const i = s0 + k;
    run += w;
    if (sepA[i] === '\n' || k === struck.length - 1) {
      aSpans.push({ text: run, color: p.white, strike: { at: strikeAt + aSpans.filter((sp) => sp.strike).length * 0.12, duration: 0.45, color: p.accent } });
      if (sepA[i]) aSpans.push({ text: sepA[i], color: clear });
      run = '';
    } else run += sepA[i];
  });
  suffix.forEach((w, k) => aSpans.push({ text: w + sepA[s1 + 1 + k], color: colorOf(w) }));
  const aData: TextLayerData = {
    ...baseData,
    spans: aSpans,
    align: 'left',
    cascade: { ...cascadeBase, times, exit: { at: replaceAt, duration: 0.3, stagger: 0.02, to: { opacity: 0, blur: 12 * u, position: [0, -12 * u] } } },
    animators: [{ by: 'word', start: (s0 / sentence.length) * 100, end: ((s1 + 1) / sentence.length) * 100, props: { fillColor: p.pink, fillAmount: keys<number>([strikeAt, 0, 'expo-out'], [strikeAt + 0.35, 100]), opacity: keys<number>([strikeAt, 100, 'expo-out'], [strikeAt + 0.35, 72]) } }],
  };
  const bWords = [...prefix, ...replacement, ...suffix];
  const sepB = breakAfter(bWords);
  const bTimes = [
    ...times.slice(0, s0),
    ...rTimes,
    ...suffix.map((_, k) => (rTimes[rTimes.length - 1] ?? replaceAt) + 0.13 * (k + 1)),
  ];
  const bData: TextLayerData = {
    ...baseData,
    spans: bWords.map((w, i) => ({ text: w + sepB[i], color: colorOf(w) })),
    align: 'left',
    cascade: { ...cascadeBase, times: bTimes },
  };
  const A = measureLines(sentence, sepA);
  const B = measureLines(bWords, sepB);
  const lineH = size * baseData.lineHeight;
  const topA = H / 2 - (A.count * lineH) / 2;
  const topB = H / 2 - (B.count * lineH) / 2;
  const glideEnd = (rTimes[rTimes.length - 1] ?? replaceAt) + 0.45;
  const group: Layer = {
    id: 'sentence-rig',
    type: 'null',
    transform: { position: keys<number[]>([replaceAt, [W / 2 - A.width / 2, topA], 'cubic-in-out'], [glideEnd, [W / 2 - B.width / 2, topB]]) },
  };
  const original = anchorTopLeft(textLayer('sentence-original', aData, {
    parent: 'sentence-rig',
    transform: { position: [0, 0], opacity: keys<number>([replaceAt, 100, 'expo-in'], [replaceAt + 0.32 + prefix.length * 0.02, 0]) },
    out: replaceAt + 0.6 + prefix.length * 0.02,
    effects: glow,
  }), A.count);
  const updated = anchorTopLeft(textLayer('sentence', bData, { parent: 'sentence-rig', transform: { position: [0, 0] }, effects: glow }), B.count);
  return scene(ctx, duration, [bg, group, original, updated], {
    background: '#000000',
    cues: [
      { at: Math.max(0, at - 0.15), sound: 'whoosh', note: 'blur in' },
      { at: strikeAt, sound: 'click', note: 'strike' },
      { at: replaceAt, sound: 'whoosh', note: 'swap' },
    ],
    template: template('blurred-sentence', params as Params),
  });
}

// ───────────────────────── T19 zoom-tunnel ─────────────────────────

export type ZoomTunnelParams = { images?: (FootageSource | string)[]; title?: string; at?: number; duration?: number; light?: boolean };

function zoomTunnel(ctx: KitContext, params: ZoomTunnelParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 1.3;
  const duration = params.duration ?? at + 1.4;
  const light = params.light !== false;
  const images = (params.images ?? []).map(source).filter((s): s is FootageSource => !!s);
  const cols = portrait ? 9 : 13;
  const rows = portrait ? 17 : 11;
  const tw = 230 * u;
  const th = tw * 9 / 16;
  const gap = 20 * u;
  const layers: Layer[] = [];
  layers.push({ id: 'bg', type: 'solid', color: light ? '#efedec' : p.void });
  // The wall rig: scales from a distant wall to a dive past the camera, then (behind the flash)
  // resets to a distant tunnel that keeps drifting in under the title.
  layers.push({
    id: 'wall',
    type: 'null',
    transform: {
      position: [W / 2, H / 2],
      scale: keys<number>([0, 52, 'sine-out'], [0.45, 64, 'expo-in'], [at, 1500, 'hold'], [at + 0.001, 34, 'sine-out'], [duration, 58]),
      rotation: keys<number>([0, -4, 'sine-in-out'], [at, 7, 'hold'], [at + 0.001, -3, 'sine-out'], [duration, 2]),
    },
  });
  const palette = [p.crimson, p.oxblood, p.accent, '#3a3a44', '#c9c4c2', p.pink];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (tw + gap);
      const y = (r - (rows - 1) / 2) * (th + gap);
      const ring = Math.max(Math.abs(c - (cols - 1) / 2), Math.abs(r - (rows - 1) / 2));
      const t0 = 0.02 + ring * 0.028;
      const common: Partial<Layer> = {
        parent: 'wall',
        motionBlur: true,
        transform: { position: [x, y], scale: keys<number>([t0, 55, 'back-out'], [t0 + 0.4, 100]), opacity: keys<number>([t0, 0, 'expo-out'], [t0 + 0.2, 100]) },
      };
      const img = images.length ? images[(r * 5 + c * 3 + n) % images.length] : null;
      if (img) layers.push({ id: `tile-${n}`, type: 'footage', source: { kind: 'image', ...img }, fit: 'cover', size: [tw, th], masks: [{ shape: 'rect', radius: 10 * u }], ...common } as Layer);
      else layers.push(rect(`tile-${n}`, [tw, th], { radius: 10 * u, fill: null, gradient: { kind: 'linear', stops: [[0, palette[n % palette.length]], [1, palette[(n + 2) % palette.length]]], from: [0, 0], to: [tw, th] }, ...common }));
      n++;
    }
  }
  // Light streaks: rays from the centre, added on top of the wall.
  const R = Math.hypot(W, H) * 0.75;
  const rays = (id: string, count: number, r0: number, width: number, rot: number, opacity: number): Layer => ({
    id,
    type: 'shape',
    shape: { shape: 'line', size: [R * 2, R * 2], points: [R, R - r0, R, 0], stroke: '#ffffff', strokeWidth: width, cap: 'round', repeat: { count, offset: [0, 0], rotation: 360 / count } },
    blend: 'add',
    transform: {
      position: [W / 2, H / 2],
      rotation: keys<number>([0, rot, 'sine-in'], [at, rot + 14, 'hold'], [at + 0.001, rot - 6, 'sine-out'], [duration, rot]),
      scale: keys<number>([0, 60, 'expo-in'], [at, 150, 'hold'], [at + 0.001, 90, 'sine-out'], [duration, 110]),
      opacity: keys<number>([0.2, 0, 'expo-in'], [at, opacity, 'hold'], [at + 0.001, opacity * 0.55, 'sine-out'], [duration, opacity * 0.35]),
    },
  });
  layers.push(rays('rays-a', 36, 60 * u, 2.2 * u, 0, 70), rays('rays-b', 23, 140 * u, 1.4 * u, 4.3, 55));
  // Zoom blur on everything below, ramping with the speed of the dive.
  layers.push({
    id: 'zoom-blur',
    type: 'solid',
    color: '#ffffff',
    adjustment: true,
    effects: [
      { type: 'zoom-blur', center: [0.5, 0.5], amount: keys<number>([0, 0.3, 'sine-out'], [0.4, 0.1, 'expo-in'], [at, 0.9, 'hold'], [at + 0.001, 0.8, 'sine-out'], [duration, 0.62]) },
      { type: 'vignette', amount: 0.25, size: 1.1, softness: 0.9 },
    ],
  });
  // The flash that hides the reset, decaying to a white veil under the title.
  layers.push({ id: 'flash', type: 'solid', color: '#ffffff', in: at - 0.12, transform: { opacity: keys<number>([at - 0.12, 0, 'expo-in'], [at, 100, 'expo-out'], [at + 0.5, 62, 'sine-out'], [duration, 55]) } });
  const title = params.title ?? 'Luma';
  const size = Math.min((portrait ? 230 : 280) * u, (W * 0.8) / Math.max(1, estimateWidth(title, 1)));
  layers.push(textLayer('title', {
    text: title,
    font: ctx.font,
    size,
    weight: 800,
    color: p.void,
    align: 'center',
    tracking: -4,
    cascade: { by: 'char', delay: at + 0.02, stagger: 0.035, duration: 0.6, ease: 'expo-out', from: { opacity: 0, blur: 22 * u, scale: 135, position: [0, 0] } },
  }, {
    in: at - 0.02,
    motionBlur: true,
    transform: { position: [W / 2, H / 2], scale: keys<number>([at, 118, 'expo-out'], [at + 0.7, 100, 'sine-out'], [duration, 97]) },
    effects: [shadowFx(10 * u, 40 * u, 22)],
  }));
  return scene(ctx, duration, layers, {
    background: light ? '#efedec' : p.void,
    cues: [{ at: 0.05, sound: 'riser', note: 'dive' }, { at: at - 0.02, sound: 'impact', note: 'flash' }, { at: at + 0.02, sound: 'whoosh', note: 'title' }],
    template: template('zoom-tunnel', params as Params),
  });
}

// ───────────────────────── T23 social-card ─────────────────────────

export type SocialCardParams = {
  thumbnail?: FootageSource | string;
  title?: string;
  channel?: { name?: string; subscribers?: string; avatar?: FootageSource | string };
  views?: { from?: number; to?: number };
  age?: string;
  likes?: string;
  duration_label?: string;
  word?: string | null;
  at?: number;
  duration?: number;
};

function socialCard(ctx: KitContext, params: SocialCardParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.1;
  const duration = params.duration ?? 3.4;
  const cw = portrait ? Math.min(W * 0.86, 920 * u) : Math.min(W * 0.5, 940 * u);
  const k = cw / 860; // card-local unit
  const pd = 22 * k;
  const tw = cw - pd * 2;
  const th = tw * 9 / 16;
  const titleSize = 34 * k;
  const titleText = params.title ?? 'I Learned Motion Design in 30 Days (Here’s What Happened)';
  const titleLines = Math.min(2, Math.max(1, Math.ceil(estimateWidth(titleText, titleSize, -2) / tw)));
  const yTitle = pd + th + 22 * k;
  const yViews = yTitle + titleLines * titleSize * 1.16 + 12 * k;
  const yRow = yViews + 30 * k + 30 * k;
  const rowH = 58 * k;
  const ch = yRow + rowH + pd + 4 * k;
  const channel = params.channel ?? {};
  const name = channel.name ?? 'Meme Gyan';
  const subs = channel.subscribers ?? '1.2M subscribers';
  const views = { from: params.views?.from ?? 0, to: params.views?.to ?? 2400000 };
  const age = params.age ?? '2 days ago';
  const t0 = at + 0.1;

  const cl: Layer[] = [];
  cl.push(rect('card-bg', [cw, ch], { radius: 26 * k, fill: null, gradient: { kind: 'linear', stops: [[0, '#1c1719'], [1, '#100c0e']], from: [0, 0], to: [0, ch] }, stroke: '#ffffff26', strokeWidth: 1.5 * k, transform: { position: [cw / 2, ch / 2] } }));
  // Thumbnail through a rounded matte so it can Ken-Burns inside a fixed frame.
  cl.push(rect('thumb-matte', [tw, th], { radius: 16 * k, fill: '#ffffff', hidden: true, transform: { position: [pd + tw / 2, pd + th / 2] } }));
  const thumb = source(params.thumbnail);
  cl.push(thumb
    ? { id: 'thumb', type: 'footage', source: thumb, fit: 'cover', size: [tw, th], matte: { layer: 'thumb-matte', mode: 'alpha' }, transform: { position: [pd + tw / 2, pd + th / 2], scale: keys<number>([t0, 122, 'expo-out'], [t0 + 1.1, 106, 'sine-out'], [duration, 100]) } } as Layer
    : rect('thumb', [tw, th], { fill: null, gradient: { kind: 'linear', stops: [[0, p.oxblood], [1, p.crimson]], from: [0, 0], to: [tw, th] }, matte: { layer: 'thumb-matte', mode: 'alpha' }, transform: { position: [pd + tw / 2, pd + th / 2] } }));
  const len = params.duration_label ?? '12:48';
  const lenW = estimateWidth(len, 20 * k, 0) + 20 * k;
  cl.push(rect('len-pill', [lenW, 32 * k], { radius: 7 * k, fill: '#000000cc', transform: { position: [pd + tw - 14 * k - lenW / 2, pd + th - 14 * k - 16 * k], opacity: fade(t0 + 0.5, 0.3) } }));
  cl.push(textLayer('len', { text: len, font: ctx.font, size: 20 * k, weight: 700, color: '#ffffff', align: 'center' }, { transform: { position: [pd + tw - 14 * k - lenW / 2, pd + th - 14 * k - 16 * k], opacity: fade(t0 + 0.5, 0.3) } }));
  cl.push(anchorTopLeft(textLayer('title', {
    text: titleText, font: ctx.font, size: titleSize, weight: 700, color: '#ffffff', align: 'left', tracking: -2, lineHeight: 1.16, box: tw,
    cascade: { by: 'word', delay: t0 + 0.2, stagger: 0.035, duration: 0.5, ease: 'expo-out', from: { opacity: 0, blur: 10 * k, position: [0, 12 * k] } },
  }, { transform: { position: [pd, yTitle] } }), titleLines));
  cl.push(anchorTopLeft(textLayer('views', {
    font: ctx.font, size: 26 * k, weight: 600, color: '#ffffffb3', align: 'left', tracking: -1,
    counter: { value: keys<number>([t0 + 0.35, views.from, 'expo-out'], [t0 + 2.3, views.to]), decimals: 0, separator: ',', format: `{n} views · ${age}` },
  }, { transform: { position: [pd, yViews], opacity: fade(t0 + 0.35, 0.3) } })));
  cl.push(rect('divider', [tw, 1.5 * k], { fill: '#ffffff1a', transform: { position: [pd + tw / 2, yRow - 16 * k], scale: keys<number[]>([t0 + 0.4, [0, 100], 'expo-out'], [t0 + 1.0, [100, 100]]) } }));
  // Channel row: avatar, name + subscribers; pills on the right.
  const rowY = yRow + rowH / 2;
  const popScale = (i: number) => keys<number>([t0 + 0.5 + i * 0.07, 70, 'back-out'], [t0 + 0.95 + i * 0.07, 100]);
  const popOpacity = (i: number) => fade(t0 + 0.5 + i * 0.07, 0.2);
  const av = 56 * k;
  const avatar = source(channel.avatar);
  cl.push(avatar
    ? { id: 'avatar', type: 'footage', source: avatar, fit: 'cover', size: [av, av], masks: [{ shape: 'ellipse' }], transform: { position: [pd + av / 2, rowY], scale: popScale(0), opacity: popOpacity(0) } } as Layer
    : { id: 'avatar', type: 'shape', shape: { shape: 'ellipse', size: [av, av], fill: null, gradient: { kind: 'linear', stops: [[0, p.accent], [1, p.pink]], from: [0, 0], to: [av, av] } }, transform: { position: [pd + av / 2, rowY], scale: popScale(0), opacity: popOpacity(0) } });
  if (!avatar) cl.push(textLayer('avatar-initial', { text: (name[0] ?? 'M').toUpperCase(), font: ctx.font, size: 28 * k, weight: 800, color: '#ffffff', align: 'center' }, { transform: { position: [pd + av / 2, rowY], scale: popScale(0), opacity: popOpacity(0) } }));
  const nameX = pd + av + 16 * k;
  cl.push(anchorTopLeft(textLayer('channel-name', { text: name, font: ctx.font, size: 25 * k, weight: 700, color: '#ffffff', align: 'left', tracking: -1 }, { transform: { position: [nameX, rowY - 29 * k], opacity: popOpacity(1) } })));
  cl.push(anchorTopLeft(textLayer('channel-subs', { text: subs, font: ctx.font, size: 19 * k, weight: 500, color: '#ffffff8c', align: 'left' }, { transform: { position: [nameX, rowY + 2 * k], opacity: popOpacity(1) } })));
  const pillH = 44 * k;
  const pills = [
    { id: 'subscribe', text: 'Subscribe', fill: '#ffffff', color: '#0f0f0f' },
    { id: 'share', text: '↗ Share', fill: '#ffffff1f', color: '#ffffff' },
    { id: 'like', text: `♥ ${params.likes ?? '48K'}`, fill: '#ffffff1f', color: '#ffffff' },
  ];
  let right = pd + tw;
  pills.forEach((pill, i) => {
    const pw = estimateWidth(pill.text, 19 * k, 0) + 36 * k;
    const cx = right - pw / 2;
    right -= pw + 10 * k;
    const order = 4 - i;
    cl.push(rect(`${pill.id}-pill`, [pw, pillH], { radius: pillH / 2, fill: pill.fill, transform: { position: [cx, rowY], scale: popScale(order), opacity: popOpacity(order) } }));
    cl.push(textLayer(`${pill.id}-text`, {
      text: pill.text, font: ctx.font, size: 19 * k, weight: 700, color: pill.color, align: 'center',
      ...(pill.id === 'like' ? { animators: [{ by: 'char' as const, start: 0, end: (1 / pill.text.length) * 100, props: { fillColor: p.accent, fillAmount: keys<number>([t0 + 1.5, 0, 'expo-out'], [t0 + 1.7, 100]), scale: keys<number>([t0 + 1.5, 100, 'back-out'], [t0 + 1.62, 150, 'expo-out'], [t0 + 1.9, 100]) } }] } : {}),
    }, { transform: { position: [cx, rowY], scale: popScale(order), opacity: popOpacity(order) } }));
  });
  const card: MotionScene = { version: 1, width: Math.ceil(cw), height: Math.ceil(ch), duration, layers: cl };

  const word = params.word === undefined ? '~entire world~' : params.word;
  const cy = portrait ? H * 0.42 : H * 0.5;
  const cx = portrait || !word ? W / 2 : W / 2 - 70 * u;
  const layers: Layer[] = [stage(ctx)];
  layers.push({
    id: 'card',
    type: 'precomp',
    scene: card,
    threeD: true,
    motionBlur: true,
    transform: {
      position: keys<number[]>([at, [cx, cy + 170 * u, 0], 'expo-out'], [at + 0.8, [cx, cy, 0], 'sine-in-out'], [duration, [cx, cy - 12 * u, 0]]),
      rotationX: keys<number>([at, 28, 'expo-out'], [at + 0.9, 7, 'sine-in-out'], [duration, 3]),
      rotationY: keys<number>([at, portrait ? -8 : -20, 'expo-out'], [at + 0.9, portrait ? -3 : -9, 'sine-in-out'], [duration, portrait ? 2 : -4]),
      scale: keys<number>([at, 86, 'expo-out'], [at + 0.8, 100, 'sine-in-out'], [duration, 103]),
      opacity: fade(at, 0.35),
    },
    effects: [shadowFx(34 * u, 90 * u, 60)],
  });
  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'whoosh', note: 'card in' }, { at: t0 + 0.5, sound: 'pop', note: 'channel row' }, { at: t0 + 1.5, sound: 'click', note: 'like' }];
  if (word) {
    const wordAt = at + 1.0;
    const spans = richSpans(word, p.accent);
    const hasScript = spans.some((s) => s.font === 'script');
    const size = (portrait ? 120 : 132) * u;
    const maxW = portrait ? W * 0.9 : W * 0.5;
    const est = spans.reduce((sum, s) => sum + estimateWidth(s.text, s.font === 'script' ? size * 1.1 : size, TRACK, s.font === 'script'), 0);
    const wSize = est > maxW ? size * (maxW / est) : size;
    const pos = portrait ? [W / 2, cy + ch / 2 + 150 * u] : [cx + cw / 2 - 30 * u, cy - ch / 2 + 70 * u];
    layers.push(textLayer('word', {
      spans, font: ctx.font, size: wSize, weight: 800, color: '#ffffff', align: 'center', tracking: TRACK,
      shadow: { color: '#00000088', blur: 24 * u, y: 6 * u },
      cascade: { by: hasScript ? 'char' : 'word', delay: wordAt, stagger: hasScript ? 0.03 : 0.09, duration: 0.6, ease: 'expo-out', from: { opacity: 0, blur: 20 * u, position: [0, 26 * u], scale: 115 } },
    }, { in: wordAt - 0.05, motionBlur: true, transform: { position: pos, rotation: -4, scale: keys<number>([wordAt, 112, 'expo-out'], [wordAt + 0.6, 100, 'sine-out'], [duration, 104]) }, effects: [glowFx(22 * u, 0.6)] }));
    cues.push({ at: wordAt, sound: 'whoosh', note: 'word' });
  }
  return scene(ctx, duration, layers, { cues, template: template('social-card', params as Params) });
}

// ───────────────────────── T24 demo-callouts ─────────────────────────

export type DemoCalloutsParams = {
  screen?: FootageSource | string;
  aspect?: number;
  boxes?: { rect: Vec; label?: string; at?: number }[];
  push?: number | boolean;
  at?: number;
  duration?: number;
};

function demoCallouts(ctx: KitContext, params: DemoCalloutsParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.1;
  const scr = source(params.screen);
  const aspect = params.aspect ?? (scr?.width && scr?.height ? scr.width / scr.height : 16 / 9);
  const sw = Math.min(portrait ? W * 0.92 : W * 0.72, (portrait ? H * 0.6 : H * 0.74) * aspect);
  const sh = sw / aspect;
  const cy = H / 2;
  const boxes = (params.boxes ?? [{ rect: [0.56, 0.52, 0.34, 0.2], label: 'Agent gives choices to proceed' }]).map((box, i) => ({ ...box, at: box.at ?? at + 0.8 + i * 1.6 }));
  const lastAt = boxes.length ? boxes[boxes.length - 1].at : at;
  const duration = params.duration ?? lastAt + 2.0;
  const push = params.push === false || params.push === undefined ? 1 : params.push === true ? 1.35 : Math.max(1, params.push);

  const layers: Layer[] = [stage(ctx)];
  // Rig: pans and pushes in on each box in turn (the boxes and labels ride along).
  const rigPos: Key<number[]>[] = [{ t: 0, v: [W / 2, cy] }];
  const rigScale: Key<number>[] = [{ t: 0, v: 100 }];
  if (push > 1) {
    let prevPos = [W / 2, cy];
    let prevScale = 100;
    for (const box of boxes) {
      const [rx, ry, rw, rh] = box.rect;
      const bx = (rx + rw / 2 - 0.5) * sw;
      const by = (ry + rh / 2 - 0.5) * sh;
      const S = clamp(Math.min(push, (W * 0.8) / (rw * sw), (H * 0.62) / (rh * sh)), 1, push);
      // Aim between the box centre and the frame centre so the frame never leaves the canvas.
      const target = [W / 2 - bx * S * 0.8, cy - by * S * 0.8];
      rigPos.push({ t: box.at - 0.15, v: prevPos, ease: 'quart-in-out' }, { t: box.at + 1.05, v: target });
      rigScale.push({ t: box.at - 0.15, v: prevScale, ease: 'quart-in-out' }, { t: box.at + 1.05, v: S * 100 });
      prevPos = target;
      prevScale = S * 100;
    }
  }
  layers.push({ id: 'rig', type: 'null', transform: { position: { k: rigPos }, scale: { k: rigScale } } });
  const screenCommon: Partial<Layer> = {
    parent: 'rig',
    motionBlur: true,
    masks: [{ shape: 'rect', radius: 18 * u }],
    transform: { position: keys<number[]>([at, [0, 70 * u], 'expo-out'], [at + 0.8, [0, 0]]), scale: keys<number>([at, 90, 'expo-out'], [at + 0.8, 100]), opacity: fade(at, 0.35) },
  };
  const screenFx: Effect[] = [blurInOut(at, 24 * u, 0.6), { type: 'stroke', width: 1.5 * u, color: '#ffffff', opacity: 30, position: 'inside' }, shadowFx(26 * u, 70 * u, 60)];
  layers.push(scr
    ? { id: 'screen', type: 'footage', source: scr, fit: 'cover', size: [sw, sh], effects: screenFx, ...screenCommon } as Layer
    : rect('screen', [sw, sh], { fill: '#1a1416', radius: 18 * u, effects: screenFx, ...screenCommon }));

  const cues: NonNullable<MotionScene['cues']> = [{ at, sound: 'whoosh', note: 'screen in' }];
  boxes.forEach((box, i) => {
    const [rx, ry, rw, rh] = box.rect;
    const bw = rw * sw;
    const bh = rh * sh;
    const bx = (rx + rw / 2 - 0.5) * sw;
    const by = (ry + rh / 2 - 0.5) * sh;
    const t = box.at;
    const out = i < boxes.length - 1 ? boxes[i + 1].at - 0.1 : null;
    const stroke = 3 * u;
    layers.push(rect(`box-${i}-draw`, [bw, bh], {
      radius: 10 * u, fill: null, stroke: p.accent, strokeWidth: stroke,
      parent: 'rig', in: t, out: t + 0.62,
      transform: { position: [bx, by] },
      effects: [glowFx(10 * u, 0.6, p.accent)],
    } as Partial<Layer>));
    const drawLayer = layers[layers.length - 1];
    if (drawLayer.type === 'shape') drawLayer.shape.trimEnd = keys<number>([t, 0, 'cubic-in-out'], [t + 0.55, 100]);
    layers.push(rect(`box-${i}`, [bw, bh], {
      radius: 10 * u, fill: `${p.accent}1c`, stroke: p.accent, strokeWidth: stroke, dash: [16 * u, 10 * u],
      parent: 'rig', in: t + 0.5, ...(out !== null ? { out: out + 0.3 } : {}),
      transform: { position: [bx, by], opacity: fadeInOut(t + 0.5, 0.1, out) },
      effects: [glowFx(10 * u, 0.5, p.accent)],
    } as Partial<Layer>));
    if (box.label) {
      const size = 26 * u;
      const pw = estimateWidth(box.label, size, TRACK) + 40 * u;
      const ph = 50 * u;
      const below = by + bh / 2 + 14 * u + ph < sh / 2 + 10 * u || by < 0;
      const ly = below ? by + bh / 2 + 14 * u + ph / 2 : by - bh / 2 - 14 * u - ph / 2;
      // Keep the pill over the frame: align it with the box's left edge, clamped inside.
      const left = clamp(bx - bw / 2, -sw / 2, sw / 2 - pw);
      const la = t + 0.35;
      layers.push(rect(`label-${i}-pill`, [pw, ph], {
        radius: ph / 2, fill: p.accent, parent: 'rig', in: la, ...(out !== null ? { out: out + 0.3 } : {}),
        transform: { anchor: [0, ph / 2], position: [left, ly], scale: keys<number[]>([la, [30, 100], 'expo-out'], [la + 0.5, [100, 100]]), opacity: fadeInOut(la, 0.15, out) },
        effects: [shadowFx(8 * u, 24 * u, 45)],
        motionBlur: true,
      } as Partial<Layer>));
      layers.push(textLayer(`label-${i}`, {
        text: box.label, font: ctx.font, size, weight: 700, color: '#ffffff', align: 'left', tracking: TRACK,
        cascade: { by: 'word', delay: la + 0.04, stagger: 0.05, duration: 0.5, ease: 'expo-out', from: { opacity: 0, blur: 10 * u, position: [-14 * u, 0] } },
      }, { parent: 'rig', in: la, ...(out !== null ? { out: out + 0.3 } : {}), transform: { position: [left + 20 * u, ly + 1 * u], opacity: fadeInOut(la, 0.01, out) } }));
    }
    cues.push({ at: t, sound: 'click', note: `callout ${i + 1}` });
  });
  return scene(ctx, duration, layers, { cues, template: template('demo-callouts', params as Params) });
}

// ───────────────────────── T25 comparison-pair ─────────────────────────

export type ComparisonPairParams = {
  left?: { media?: FootageSource | string; label?: string };
  right?: { media?: FootageSource | string; label?: string };
  divider?: 'line' | 'vs' | 'none';
  at?: number;
  duration?: number;
};

function comparisonPair(ctx: KitContext, params: ComparisonPairParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.1;
  const duration = params.duration ?? 3;
  const divider = params.divider ?? 'line';
  const cw = portrait ? W * 0.8 : W * 0.4;
  const ch = cw * 9 / 16;
  const gap = portrait ? 190 * u : 100 * u;
  const labelSize = portrait ? 62 * u : 60 * u;
  const layers: Layer[] = [stage(ctx)];
  const sides = [
    { key: 'left', data: params.left ?? { label: 'Rockstar Games' }, sign: -1 },
    { key: 'right', data: params.right ?? { label: 'Luma AI' }, sign: 1 },
  ];
  // Landscape: side by side, labels under. Portrait: stacked, each label under its card.
  const midY = portrait ? H / 2 - 40 * u : H / 2 - 20 * u;
  const centreOf = (sign: number) => (portrait ? [W / 2, midY + sign * (ch / 2 + gap / 2)] : [W / 2 + sign * (cw / 2 + gap / 2), midY]);
  const cues: NonNullable<MotionScene['cues']> = [];
  sides.forEach(({ key, data, sign }, i) => {
    const t = at + i * 0.14;
    const [cx, cy] = centreOf(sign);
    const from = portrait ? [cx + sign * W * 0.7, cy] : [cx + sign * W * 0.45, cy];
    const media = source(data.media);
    const common: Partial<Layer> = {
      motionBlur: true,
      masks: [{ shape: 'rect', radius: 22 * u }],
      transform: {
        position: keys<number[]>([t, from, 'expo-out'], [t + 0.75, [cx, cy], 'sine-in-out'], [duration, [cx, cy - 8 * u]]),
        rotation: keys<number>([t, sign * 7, 'expo-out'], [t + 0.8, 0]),
        scale: keys<number>([t, 92, 'expo-out'], [t + 0.8, 100, 'sine-in-out'], [duration, 102]),
        opacity: fade(t, 0.3),
      },
    };
    const fx: Effect[] = [blurInOut(t, 30 * u, 0.55), { type: 'stroke', width: 1.5 * u, color: '#ffffff', opacity: 30, position: 'inside' }, shadowFx(24 * u, 70 * u, 60)];
    layers.push(media
      ? { id: `${key}-card`, type: 'footage', source: media, fit: 'cover', size: [cw, ch], effects: fx, ...common } as Layer
      : rect(`${key}-card`, [cw, ch], { radius: 22 * u, fill: null, gradient: { kind: 'linear', stops: [[0, p.oxblood], [1, p.crimson]], from: [0, 0], to: [cw, ch] }, effects: fx, ...common }));
    if (data.label) {
      const la = t + 0.35;
      const size = Math.min(labelSize, (cw * 0.95) / Math.max(1, estimateWidth(data.label, 1)));
      layers.push(textLayer(`${key}-label`, {
        text: data.label, font: ctx.font, size, weight: 700, color: '#ffffff', align: 'center', tracking: TRACK,
        cascade: { by: 'word', delay: la, stagger: 0.08, duration: 0.55, ease: 'expo-out', from: { opacity: 0, blur: 14 * u, position: [0, 18 * u] } },
      }, { transform: { position: [cx, portrait && sign < 0 ? cy - ch / 2 - 62 * u : cy + ch / 2 + 62 * u] }, effects: [glowFx(16 * u, 0.5)] }));
    }
    cues.push({ at: t, sound: 'whoosh', note: `${key} card` });
  });
  if (divider !== 'none') {
    const dt = at + 0.4;
    const len = portrait ? W * 0.5 : ch * 1.15;
    const [cx, cy] = [W / 2, midY];
    layers.push({
      id: 'divider',
      type: 'shape',
      shape: { shape: 'line', size: [len, 4 * u], points: [0, 2 * u, len, 2 * u], stroke: p.pink, strokeWidth: 3 * u, cap: 'round', trimStart: keys<number>([dt, 50, 'expo-out'], [dt + 0.6, 0]), trimEnd: keys<number>([dt, 50, 'expo-out'], [dt + 0.6, 100]) },
      transform: { position: [cx, cy], rotation: portrait ? 0 : 90 },
      effects: [glowFx(18 * u, 1.1, p.accent)],
    });
    if (divider === 'vs') {
      const d = 104 * u;
      const vt = dt + 0.25;
      layers.push({ id: 'vs-badge', type: 'shape', shape: { shape: 'ellipse', size: [d, d], fill: p.void, stroke: p.accent, strokeWidth: 3 * u }, transform: { position: [cx, cy], scale: keys<number>([vt, 0, 'back-out'], [vt + 0.45, 100]) }, effects: [glowFx(20 * u, 0.8, p.accent)] });
      layers.push(textLayer('vs', { text: 'VS', font: ctx.font, size: 40 * u, weight: 800, color: '#ffffff', align: 'center', tracking: -2 }, { transform: { position: [cx, cy], scale: keys<number>([vt + 0.05, 0, 'back-out'], [vt + 0.5, 100]) } }));
      cues.push({ at: vt, sound: 'impact', note: 'VS' });
    }
  }
  return scene(ctx, duration, layers, { cues, template: template('comparison-pair', params as Params) });
}

// ───────────────────────── T20 grade-hit ─────────────────────────

export type GradeHitParams = { preset?: 'bw' | 'duotone' | 'crush'; at?: number; duration?: number | null; footage?: FootageSource | string; punch?: boolean; sceneDuration?: number };

export const GRADE_PRESETS: Record<'bw' | 'duotone' | 'crush', (u: number) => Effect[]> = {
  bw: (u) => [
    { type: 'black-white', amount: 100 },
    { type: 'brightness-contrast', brightness: 3, contrast: 24 },
    { type: 'levels', inBlack: 6, inWhite: 235, gamma: 1.12 },
    { type: 'vignette', amount: 0.4, size: 1.05, softness: 0.8 },
    { type: 'grain', amount: 0.42, size: 1.3 * u },
  ],
  duotone: (u) => [
    { type: 'duotone', shadows: '#07323b', highlights: '#ff5a44', amount: 100, contrast: 1.05 },
    { type: 'halation', radius: 50 * u, intensity: 0.85, threshold: 0.55, color: '#ff3a24' },
    { type: 'vignette', amount: 0.45, size: 1.05, softness: 0.8 },
    { type: 'grain', amount: 0.4, size: 1.3 * u },
  ],
  crush: () => [
    { type: 'levels', inBlack: 26, inWhite: 225, gamma: 1.0 },
    { type: 'hue-saturation', saturation: -35 },
    { type: 'brightness-contrast', brightness: 0, contrast: 12 },
    { type: 'vignette', amount: 0.62, size: 0.98, softness: 0.75 },
  ],
};

function gradeHit(ctx: KitContext, params: GradeHitParams): MotionScene {
  const u = unit(ctx);
  const at = params.at ?? 0.5;
  const hold = params.duration === null ? null : params.duration ?? 1.5;
  const duration = params.sceneDuration ?? Math.max(at + (hold ?? 1.5) + 0.5, 1);
  const preset = params.preset && GRADE_PRESETS[params.preset] ? params.preset : 'bw';
  const layers: Layer[] = [];
  const foot = source(params.footage);
  const punch = params.punch !== false;
  const f = 1 / 30;
  const punchKeys: Key<number>[] = [{ t: at - 0.001, v: 100, ease: 'hold' }, { t: at, v: 109, ease: 'expo-out' }, { t: at + 0.3, v: 106, ease: 'hold' }];
  if (hold !== null) punchKeys.push({ t: at + hold, v: 100 });
  if (foot) {
    // The shot itself punches in on the cut (T26) and keeps the new framing while graded.
    layers.push({
      id: 'footage', type: 'footage', source: foot, fit: 'cover',
      transform: { scale: punch ? { k: punchKeys } : 100 },
    });
  }
  layers.push({ id: 'grade', name: `Grade: ${preset}`, type: 'solid', color: '#ffffff', adjustment: true, in: at, ...(hold !== null ? { out: at + hold } : {}), effects: GRADE_PRESETS[preset](u), note: 'Adjustment layer: grades everything below it inside this scene.' });
  if (punch) {
    // A 3-frame flash and lens punch on the switch.
    layers.push({
      id: 'punch', type: 'solid', color: '#ffffff', adjustment: true, in: at, out: at + 0.35,
      effects: [
        { type: 'exposure', exposure: keys<number>([at, 1.1, 'expo-out'], [at + 3 * f, 0]) },
        { type: 'lens-distortion', amount: keys<number>([at, 0.12, 'expo-out'], [at + 0.3, 0]), zoom: keys<number>([at, 1.08, 'expo-out'], [at + 0.3, 1]) },
        { type: 'zoom-blur', center: [0.5, 0.5], amount: keys<number>([at, 0.14, 'expo-out'], [at + 4 * f, 0]) },
      ],
    });
  }
  return scene(ctx, duration, layers, {
    cues: [{ at, sound: 'impact', note: `grade ${preset}` }],
    template: template('grade-hit', params as Params),
  });
}

// ───────────────────────── T27 big-number-behind ─────────────────────────

export type BigNumberParams = {
  subject?: FootageSource | string;
  plate?: FootageSource | string;
  text?: string;
  counter?: { from?: number; to: number; format?: string; decimals?: number; separator?: string; duration?: number } | null;
  suffix?: string;
  /** 'super': small superscript after the number; 'split': same size, right of the face with the number left of it. */
  suffixStyle?: 'super' | 'split';
  /** Split gap (px) kept clear for the head. */
  gap?: number;
  position?: 'center' | 'left' | 'right' | Vec;
  at?: number;
  duration?: number;
  size?: number;
  color?: string;
};

function bigNumberBehind(ctx: KitContext, params: BigNumberParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.2;
  const duration = params.duration ?? 2.6;
  const subject = source(params.subject) ?? { asset: '' };
  const plate = source(params.plate) ?? { ...subject, matte: undefined, cutout: false };
  const counter = params.counter ?? null;
  const format = counter?.format ?? '{n}';
  const shown = counter ? format.replace('{n}', (counter.to).toFixed(counter.decimals ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, counter.separator ?? '')) : params.text ?? '45';
  const suffix = params.suffix ?? '';
  const split = !!suffix && params.suffixStyle === 'split';
  const pos = params.position;
  const y = portrait ? H * 0.2 : H * 0.4;
  const centre: Vec = Array.isArray(pos) ? pos : [pos === 'left' ? W * 0.3 : pos === 'right' ? W * 0.7 : W / 2, y];
  // Split: the number ends left of the face and the suffix starts right of it, same size (the
  // reference's "45 | Sec"). Super: a small superscript after the number.
  const gap = params.gap ?? (portrait ? W * 0.5 : W * 0.2);
  const maxW = portrait ? W * 0.92 : W * 0.86;
  const perSize = split
    ? Math.max(estimateWidth(shown, 1, TRACK), estimateWidth(suffix, 1, TRACK)) * 2 + gap / Math.max(1, (portrait ? 300 : 360) * u)
    : estimateWidth(shown, 1, TRACK) + (suffix ? estimateWidth(suffix, 0.36) + 0.06 : 0);
  const size = split
    ? Math.min(params.size ?? 360 * u, ((Math.min(centre[0], W - centre[0]) - gap / 2) * 0.94) / Math.max(0.3, Math.max(estimateWidth(shown, 1, TRACK), estimateWidth(suffix, 1, TRACK))))
    : Math.min(params.size ?? (portrait ? 320 : 400) * u, maxW / Math.max(0.3, perSize));
  const numberW = estimateWidth(shown, size, TRACK);
  const suffixW = suffix && !split ? estimateWidth(suffix, size * 0.36) : 0;
  const numberX = split ? centre[0] - gap / 2 : centre[0] - (suffixW ? (suffixW + size * 0.06) / 2 : 0);
  const layers: Layer[] = [];
  layers.push({ id: 'plate', type: 'footage', source: plate, fit: 'cover', transform: { scale: keys<number>([0, 100, 'sine-in-out'], [duration, 104]) }, effects: [{ type: 'vignette', amount: 0.35, size: 1.05, softness: 0.8 }] });
  const data: TextLayerData = {
    font: ctx.font, size, weight: 800, color: params.color ?? '#f6f3f1', align: split ? 'right' : 'center', tracking: TRACK,
    cascade: { by: 'char', delay: at, stagger: 0.05, duration: 0.55, ease: 'back-out', from: { opacity: 0, blur: 26 * u, scale: 150, position: [split ? -30 * u : 0, 20 * u] } },
  };
  if (counter) data.counter = { value: keys<number>([at, counter.from ?? 0, 'expo-out'], [at + (counter.duration ?? 1.1), counter.to]), decimals: counter.decimals ?? 0, separator: counter.separator ?? '', format };
  else data.text = shown;
  const textFx = [glowFx(18 * u, 0.32), shadowFx(8 * u, 30 * u, 30)];
  layers.push(textLayer('number', data, {
    motionBlur: true,
    transform: { position: [numberX, centre[1]], scale: keys<number>([at, 118, 'expo-out'], [at + 0.5, 100, 'sine-out'], [duration, 104]) },
    effects: textFx,
  }));
  if (suffix && split) {
    const st = at + 0.22;
    layers.push(textLayer('suffix', {
      text: suffix, font: ctx.font, size, weight: 700, color: params.color ?? '#f6f3f1', align: 'left', tracking: TRACK,
      cascade: { by: 'char', delay: st, stagger: 0.05, duration: 0.55, ease: 'back-out', from: { opacity: 0, blur: 26 * u, scale: 150, position: [30 * u, 20 * u] } },
    }, { motionBlur: true, transform: { position: [centre[0] + gap / 2, centre[1]], scale: keys<number>([st, 118, 'expo-out'], [st + 0.5, 100, 'sine-out'], [duration, 104]) }, effects: textFx }));
  } else if (suffix) {
    const st = at + 0.3;
    layers.push(anchorTopLeft(textLayer('suffix', {
      text: suffix, font: ctx.font, size: size * 0.36, weight: 700, color: p.pink, align: 'left', tracking: TRACK,
      cascade: { by: 'char', delay: st, stagger: 0.035, duration: 0.5, ease: 'expo-out', from: { opacity: 0, blur: 12 * u, position: [-24 * u, 0] } },
    }, { transform: { position: [numberX + numberW / 2 + size * 0.06, centre[1] - size * 0.62] }, effects: [glowFx(14 * u, 0.4)] })));
  }
  layers.push({ id: 'subject', type: 'footage', source: { ...subject, cutout: true }, fit: 'cover', transform: { scale: keys<number>([0, 100, 'sine-in-out'], [duration, 104]) } });
  return scene(ctx, duration, layers, {
    cues: [{ at, sound: 'impact', note: 'number slam' }, ...(suffix ? [{ at: at + 0.3, sound: 'whoosh' as const, note: 'suffix' }] : [])],
    template: template('big-number-behind', params as Params),
  });
}

// ───────────────────────── T21 stylized-broll ─────────────────────────

type BrollLine = { spans?: { text: string; script?: boolean; italic?: boolean; accent?: boolean }[]; text?: string; at?: number; times?: number[] };
export type StylizedBrollParams = { footage?: FootageSource | string; lines?: (BrollLine | string)[]; grade?: 'crimson' | 'pink' | 'teal'; at?: number; duration?: number; out?: number | null; size?: number };

const BROLL_GRADES = {
  crimson: { shadows: '#04171c', highlights: '#ff4a34', halation: '#ff3a1f', contrast: 1.3 },
  pink: { shadows: '#2a0914', highlights: '#ffc2ce', halation: '#ff7f9a', contrast: 1.15 },
  teal: { shadows: '#021317', highlights: '#94efe6', halation: '#4fdccc', contrast: 1.2 },
};

function stylizedBroll(ctx: KitContext, params: StylizedBrollParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const at = params.at ?? 0.35;
  const grade = BROLL_GRADES[params.grade ?? 'crimson'] ?? BROLL_GRADES.crimson;
  const raw = params.lines ?? ['obviously,', 'a beginner', 'is *going to*', 'get ~scared~'];
  const lines = raw.map((line, i) => {
    const l: BrollLine = typeof line === 'string' ? { text: line } : line;
    const spans: TextSpan[] = l.spans
      ? l.spans.map((s) => ({ text: s.text, ...(s.script ? { font: 'script' } : {}), ...(s.italic ? { italic: true } : {}), ...(s.accent ? { color: p.accent } : {}) }))
      : richSpans(l.text ?? '', p.accent);
    return { spans, at: l.at ?? at + i * 0.55, times: l.times };
  });
  const lastAt = lines.length ? lines[lines.length - 1].at : at;
  const duration = params.duration ?? lastAt + 1.6;
  const out = params.out === undefined ? null : params.out;
  const layers: Layer[] = [];
  layers.push({
    id: 'broll',
    type: 'footage',
    source: source(params.footage) ?? { asset: '' },
    fit: 'cover',
    transform: {
      position: { expr: `wiggle(1.3, ${(5 * u).toFixed(2)})`, v: [W / 2, H / 2] },
      scale: keys<number>([0, 112, 'sine-out'], [duration, 105]),
      rotation: keys<number>([0, -0.8, 'sine-in-out'], [duration, 0.6]),
    },
    effects: [
      blurFx(1.6 * u),
      { type: 'exposure', exposure: 0.55, gamma: 1.1 },
      { type: 'duotone', shadows: grade.shadows, highlights: grade.highlights, amount: 100, contrast: grade.contrast },
      { type: 'halation', radius: 64 * u, intensity: 1.0, threshold: 0.42, color: grade.halation },
      { type: 'chromatic-aberration', amount: keys<number>([0, 14 * u, 'expo-out'], [0.5, 5 * u]) },
      { type: 'vignette', amount: 0.6, size: 1.0, softness: 0.85 },
      { type: 'grain', amount: 0.5, size: 1.4 * u },
    ],
  });
  const base = params.size ?? (portrait ? 76 : 66) * u;
  const first = base * 1.45;
  const left = portrait ? 70 * u : 90 * u;
  let y = portrait ? H * 0.16 : H * 0.11;
  lines.forEach((line, i) => {
    const size = i === 0 ? first : base;
    const n = words(spansText(line.spans)).length;
    const times = Array.from({ length: n }, (_, k) => line.times?.[k] ?? line.at + k * 0.11);
    const layer = anchorTopLeft(textLayer(`line-${i}`, {
      spans: line.spans.map((span) => (span.font === 'script' && span.size === undefined ? { ...span, size: size * 1.4 } : span)), font: ctx.font, size, weight: 700, color: '#ffffff', align: 'left', tracking: TRACK, lineHeight: 1.05,
      box: W - left * 2,
      shadow: { color: '#00000070', blur: 18 * u, y: 3 * u },
      cascade: {
        by: 'word', times, duration: 0.55, ease: 'expo-out', from: { opacity: 0, blur: 14 * u, position: [0, 18 * u] }, dimTo: 0.6, brightenAfter: 0.14,
        ...(out !== null ? { exit: { at: out + i * 0.04, duration: 0.3, stagger: 0.02, to: { opacity: 0, blur: 12 * u, position: [0, -12 * u] } } } : {}),
      },
    }, { in: Math.max(0, line.at - 0.05), transform: { position: [left, y] }, effects: [glowFx(14 * u, 0.45)] }));
    layers.push(layer);
    const tallest = line.spans.some((span) => span.font === 'script') ? size * 1.4 : size;
    y += tallest * (i === 0 ? 1.08 : 1.0);
  });
  return scene(ctx, duration, layers, {
    background: '#000000',
    cues: lines.map((line, i) => ({ at: line.at, sound: i === 0 ? 'whoosh' as const : 'pop' as const, note: `line ${i + 1}` })),
    template: template('stylized-broll', params as Params),
  });
}

// ───────────────────────── specs ─────────────────────────

const FOOTAGE = 'footage { asset, in?, matte? }';

export const STORY_TEMPLATES: TemplateSpec[] = [
  {
    id: 'blurred-sentence',
    label: 'Sentence over blurred speaker',
    technique: 'T8',
    use: 'A key sentence over the speaker, who blurs and darkens behind it; words land as spoken, keywords in red. With `strike`, some words get a red strike-through and are swapped for new words while the line re-centres (a correction beat: "because you don\'t know what to make" → "you keep losing the thread between tools").',
    params: {
      footage: `${FOOTAGE} — the talking-head clip under the sentence (required)`,
      sentence: 'string — the sentence (default "because you don\'t know what to make")',
      keywords: 'string[] — words drawn in the accent colour',
      times: 'number[] — scene seconds each word lands (from the transcript); default 0.13 s apart from `at`',
      strike: '{ words, at?, replaceWith?, replaceAt?, times? } | null — words (a phrase inside the sentence) to strike at `at` and swap for `replaceWith` at `replaceAt`',
      at: 'number s (0.3) — first word; the footage blurs in before it',
      size: 'number px (58 at 1080p)', blurIn: 'boolean (true) — animate the blur in from a sharp frame', duration: 'number s (auto)',
    },
    seconds: 4,
    fullFrame: true,
    build: (ctx, params) => blurredSentence(ctx, params as BlurredSentenceParams),
  },
  {
    id: 'zoom-tunnel',
    label: 'Zoom-blur thumbnail tunnel',
    technique: 'T19',
    use: 'A high-energy transition: a wall of thumbnails dives at the camera through a radial zoom blur with light streaks, flashes white and lands on a title. Use between chapters or to introduce a product/name.',
    params: {
      images: 'footage[] — thumbnails/screenshots tiled on the wall (repeated; gradients when empty)',
      title: 'string — the word the flash lands on (default "Luma")',
      at: 'number s (1.3) — the flash', duration: 'number s (at + 1.4)', light: 'boolean (true) — light wall like the reference; false for a dark one',
    },
    seconds: 2.7,
    fullFrame: true,
    build: (ctx, params) => zoomTunnel(ctx, params as ZoomTunnelParams),
  },
  {
    id: 'social-card',
    label: 'YouTube card with view count',
    technique: 'T23',
    use: 'Social proof: a YouTube-style video card floats in on the crimson stage (thumbnail, title, views counting up, channel row with subscribe/like/share pills), with an optional big kinetic word in front. Use when the narration cites a video, a channel or reach.',
    params: {
      thumbnail: `${FOOTAGE} — the video thumbnail`,
      title: 'string — video title (wraps to 2 lines)',
      channel: '{ name, subscribers ("1.2M subscribers"), avatar? footage }',
      views: '{ from (0), to (2400000) } — counts up with expo-out',
      age: 'string ("2 days ago")', likes: 'string ("48K")', duration_label: 'string ("12:48")',
      word: 'string | null — kinetic word in front; markup *italic*, ~script~, [accent] (default "~entire world~")',
      at: 'number s (0.1)', duration: 'number s (3.4)',
    },
    seconds: 3.4,
    fullFrame: true,
    build: (ctx, params) => socialCard(ctx, params as SocialCardParams),
  },
  {
    id: 'demo-callouts',
    label: 'App demo with dashed callouts',
    technique: 'T24',
    use: 'Walk through a screen recording or screenshot: it floats in a rounded frame on the stage, dashed accent boxes draw on around regions one at a time with a caption pill ("Agent gives choices to proceed"), and the frame optionally pushes in on each region.',
    params: {
      screen: `${FOOTAGE} — the screen recording or screenshot (required)`,
      aspect: 'number — screen aspect (default from the footage size, else 16/9)',
      boxes: '[{ rect: [x, y, w, h] fractions 0..1 of the screen, label?, at? s }] — one callout per step; each replaces the previous',
      push: 'number | boolean — push-in scale on each box (true = 1.35; default none)',
      at: 'number s (0.1)', duration: 'number s (last box + 2)',
    },
    seconds: 5,
    fullFrame: true,
    build: (ctx, params) => demoCallouts(ctx, params as DemoCalloutsParams),
  },
  {
    id: 'comparison-pair',
    label: 'Side-by-side comparison',
    technique: 'T25',
    use: 'Compare two things: two media cards slide and blur in from opposite sides (stacked in portrait) with a label under each and a glowing divider or a VS badge ("Rockstar Games | Luma AI").',
    params: {
      left: `{ media: ${FOOTAGE}, label }`, right: `{ media: ${FOOTAGE}, label }`,
      divider: '"line" | "vs" | "none" (line)', at: 'number s (0.1)', duration: 'number s (3)',
    },
    seconds: 3,
    fullFrame: true,
    build: (ctx, params) => comparisonPair(ctx, params as ComparisonPairParams),
  },
  {
    id: 'grade-hit',
    label: 'Grade switch on a beat',
    technique: 'T20 T26',
    use: 'Emphasis beat: at `at` the picture snaps to a new grade (bw = contrasty black & white with grain, duotone = crimson/teal with halation, crush = crushed levels + heavy vignette) with a 3-frame flash and lens punch, and snaps back after `duration`. It is an ADJUSTMENT scene: it grades what is below it inside the scene, so pass the talking-head clip as `footage` (the host places it as the bottom layer); without footage it is only useful where the host composites adjustment scenes over the timeline.',
    params: {
      preset: '"bw" | "duotone" | "crush" (bw)', at: 'number s (0.5) — the beat', duration: 'number s | null (1.5) — how long the grade holds; null = to the end',
      footage: `${FOOTAGE} — the shot to grade, placed at the bottom (punches in 100→106% on the beat)`,
      punch: 'boolean (true) — flash + lens punch on the switch', sceneDuration: 'number s (auto)',
    },
    seconds: 2.5,
    fullFrame: false,
    build: (ctx, params) => gradeHit(ctx, params as GradeHitParams),
  },
  {
    id: 'big-number-behind',
    label: 'Big number behind the presenter',
    technique: 'T27 T1',
    use: 'A huge number or word ("45 Sec", "FIRST BATCH", "12917 AED", "2026") slams in behind the presenter: plate at the bottom, the type in the middle, the cut-out subject on top so the head occludes it. Needs a roto matte on the subject clip; best with a clean plate.',
    params: {
      subject: `${FOOTAGE} — the talking-head clip with its roto matte (required)`,
      plate: `${FOOTAGE} — clean plate (optional; the uncut clip otherwise)`,
      text: 'string — the big word/number (default "45")',
      counter: '{ from?, to, format? ("{n}"), decimals?, separator?, duration? } | null — roll the number instead of `text`',
      suffix: 'string — word after it ("Sec", "AED", "weeks")',
      suffixStyle: '"super" (small superscript, default) | "split" (same size, number left of the face and suffix right of it, like "45 | Sec")',
      gap: 'number px — split gap kept clear for the head (20% of the width)',
      position: '"center" | "left" | "right" | [x, y] (center, at head height)',
      at: 'number s (0.2)', duration: 'number s (2.6)', size: 'number px (auto-fit)', color: 'colour',
    },
    seconds: 2.6,
    fullFrame: true,
    build: (ctx, params) => bigNumberBehind(ctx, params as BigNumberParams),
  },
  {
    id: 'stylized-broll',
    label: 'Stylised b-roll with kinetic caption',
    technique: 'T21 T7',
    use: 'B-roll or a cutaway of the speaker graded crimson/teal duotone (or pink/teal) with halation, chromatic aberration, grain and a handheld drift, with a stacked caption at the top-left: bold sans lines landing one by one, one handwritten script accent word and italic emphasis ("obviously, / a beginner / is *going to* / get ~scared~").',
    params: {
      footage: `${FOOTAGE} — the b-roll clip (required)`,
      lines: 'Array of string (markup *italic*, ~script~, [accent]) or { spans: [{ text, script?, italic?, accent? }], at?, times? } — first line is set larger',
      grade: '"crimson" | "pink" | "teal" (crimson)', at: 'number s (0.35) — first line; later lines 0.55 s apart unless given',
      out: 'number s | null — caption exit', size: 'number px (60 at 1080p)', duration: 'number s (auto)',
    },
    seconds: 3.5,
    fullFrame: true,
    build: (ctx, params) => stylizedBroll(ctx, params as StylizedBrollParams),
  },
];
