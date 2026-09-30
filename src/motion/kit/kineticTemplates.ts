// Kinetic and text templates: the type and camera moves the premium films were cut from, as
// layered scenes a model fills with words and times.
//   type-on-voice    · a line typed on the voice's word onsets, re-centring as it grows (launch film S01)
//   fly-through-word · the camera plunges through a letter into the next scene (launch film S01 → S02)
//   word-land        · words land grey and turn white on their beat (crimson explainer)
//   label-pill       · a filled label that springs in, then reveals its words (crimson explainer)
//   slam-tilt        · a card slams in tilted on a bar, then dollies (crimson explainer 6.5 s)
//   whip-pan         · one shot whips out as the next whips in, under a directional blur
//   match-grow       · a small card grows until its anchor sits on the next shot's, which fades in around it
//   logo-lockup      · glow point → mark → wordmark → subline on the words, halo breathing (S08, S21)
//   end-card         · lockup, tagline, call to action, the film's own shots drifting behind (S23, crimson end)
// The numbers are the films' own: docs/research/opus-launch-film-study.md §3 and
// docs/research/film-lab/crimson-explainer.md §2.3. Every element is its own layer; colours come from
// the house palette, so a brand kit re-colours them (brandify.ts), and `look` plus each template's
// variants keep two films from coming out alike.
import { safeFor } from '../../lib/layout';
import { ease, keys } from '../anim';
import type { Ease, Effect, FootageSource, Key, Layer, MotionScene, TextSpan, Vec } from '../types';
import { blurFx, glowFx, pal, scene, stage, unit, type KitContext } from './common';
import { estimateWidth, richSpans } from './storyTemplates';
import type { TemplateSpec } from './index';

type Params = Record<string, unknown>;
type Cue = NonNullable<MotionScene['cues']>[number];

// ───────────────────────── shared ─────────────────────────

/** The films' eases, as they named them (cubic-bezier control points). */
const EASE = {
  /** Arrivals: fast start, long settle. */
  out: [0.16, 1, 0.3, 1] as Ease,
  /** Glides, parks and pushes. */
  move: [0.65, 0, 0.35, 1] as Ease,
  /** Slow drifts and crossfades. */
  sine: [0.37, 0, 0.63, 1] as Ease,
  /** Exits and whips out. */
  in: [0.7, 0, 0.84, 0] as Ease,
  /** Gather then snap: whips and the match-cut grow. */
  whip: [0.55, 0, 0.12, 1] as Ease,
  /** Word exits. */
  exit: [0.4, 0, 0.8, 0.55] as Ease,
};

const TRACK = -3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places = 4) => Math.round(v * 10 ** places) / 10 ** places;
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const num = (p: Params, key: string, fallback: number, lo = -Infinity, hi = Infinity) => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? clamp(p[key] as number, lo, hi) : fallback);
const text = (p: Params, key: string, fallback: string) => (typeof p[key] === 'string' && (p[key] as string).trim() ? (p[key] as string).trim() : fallback);
const choice = <T extends string>(p: Params, key: string, values: readonly T[], fallback: T): T => (typeof p[key] === 'string' && values.includes(p[key] as T) ? (p[key] as T) : fallback);
const flag = (p: Params, key: string, fallback: boolean) => (typeof p[key] === 'boolean' ? (p[key] as boolean) : fallback);
const template = (id: string, params: Params) => ({ id, params });
/** The label pill's height at this canvas size (42 px at 1080p). */
const pillHeight = (ctx: KitContext) => 42 * unit(ctx);

/** Footage params arrive as `{ asset | path, in?, matte? }` or a bare asset id / path string. */
function source(value: unknown): FootageSource | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return /[\\/.]/.test(value) ? { path: value } : { asset: value };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const s = value as FootageSource;
    return s.asset || s.path || s.sequence ? { ...s } : undefined;
  }
  return undefined;
}

/** The safe area in canvas pixels: broadcast margins for wide frames, the social ones for tall. */
function safeRect(ctx: KitContext) {
  const s = safeFor(ctx.width, ctx.height);
  const x0 = ctx.width * s.left;
  const x1 = ctx.width * (1 - s.right);
  const y0 = ctx.height * s.top;
  const y1 = ctx.height * (1 - s.bottom);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** The type size that fits `line` into `maxWidth`, never above `want` nor below `floor`. */
const fitSize = (line: string, want: number, maxWidth: number, floor = want * 0.45) => clamp(Math.min(want, maxWidth / Math.max(1e-3, estimateWidth(line, 1, TRACK))), floor, want);

/** Keys that follow a damped spring from `from` to `to` (hz, damping ratio), one per frame until it settles. */
export function springKeys(at: number, from: number, to: number, hz: number, zeta: number, settle = 0.7): Key<number>[] {
  const w = 2 * Math.PI * hz;
  const z = clamp(zeta, 0.05, 0.99);
  const wd = w * Math.sqrt(1 - z * z);
  const frames = Math.max(2, Math.round(settle * 30));
  const out: Key<number>[] = [];
  for (let i = 0; i < frames; i++) {
    const s = i / 30;
    out.push({ t: round(at + s), v: round(to + (from - to) * Math.exp(-z * w * s) * (Math.cos(wd * s) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * s)), 3) });
  }
  out.push({ t: round(at + frames / 30), v: to });
  return out;
}

/** A 0 → 1 → 0 pulse: up over `up` seconds on the arrival ease, down over `down` on the drift. */
const bump = (at: number, peak: number, up: number, down: number, rest = 0): { k: Key<number>[] } => ({ k: [{ t: at, v: rest, ease: EASE.out }, { t: at + up, v: peak, ease: EASE.sine }, { t: at + up + down, v: rest }] });

// ── looks: the stage a scene sits on ──

const LOOKS = ['stage', 'light', 'dark', 'grid', 'none'] as const;
type Look = (typeof LOOKS)[number];
const LOOK_PROSE = '"stage" | "light" | "dark" | "grid" | "none"';

/** The look asked for; with a brand kit and none asked, the brand's own stage tone. */
function lookOf(ctx: KitContext, p: Params, fallback: Look): Look {
  if (typeof p.look === 'string' && (LOOKS as readonly string[]).includes(p.look)) return p.look as Look;
  if (ctx.brand && fallback !== 'none') return ctx.brand.stageDark ? 'stage' : 'light';
  return fallback;
}

/** Type colours per look: ink, the grey a word lands in, a softer ink for small lines, the shadow. */
function inkOf(look: Look) {
  const light = look === 'light' || look === 'grid';
  // Light stages take the launch film's warm-brown shadow, which reads soft on cream; dark ones glow.
  return light
    ? { text: '#17120f', dim: '#c9c2bd', soft: '#6f6660', shadow: '#462814', light }
    : { text: '#f7f3f1', dim: '#8a8383', soft: '#d9d2cf', shadow: '#000000', light };
}

/** The backdrop layers of a look (none for "none": the scene overlays the timeline). */
function backdrop(ctx: KitContext, look: Look): { layers: Layer[]; background: string | null } {
  const u = unit(ctx);
  switch (look) {
    case 'stage':
      return { layers: [stage(ctx, 'backdrop')], background: pal(ctx).void };
    case 'light':
      // The launch film's cream stage: #F7F5F1 → #EDE9E3 with a highlight up at (0.5, 0.35).
      return { layers: [{ id: 'backdrop', name: 'Light stage', type: 'procedural', kind: 'radial-glow', params: { inner: '#fcfbf8', outer: '#ebe6df', center: [0.5, 0.35], radius: 0.95 } }], background: '#efebe5' };
    case 'dark':
      // Near-black with a radial ember: the reveal stage.
      return { layers: [{ id: 'backdrop', name: 'Ember stage', type: 'procedural', kind: 'radial-glow', params: { inner: '#2c1208', outer: '#0b0605', center: [0.5, 0.55], radius: 0.85 } }], background: '#0b0605' };
    case 'grid':
      // Peach with hairlines every 80 px and fainter ones every 16 px.
      return {
        layers: [
          { id: 'backdrop', name: 'Grid stage', type: 'procedural', kind: 'grid', params: { bg: '#fce8db', color: '#c98b6b2e', spacing: 80 * u, line: 1.2 * u, fade: 0.6 } },
          { id: 'backdrop-fine', name: 'Fine grid', type: 'procedural', kind: 'grid', blend: 'multiply', params: { bg: '#ffffff', color: '#c98b6b14', spacing: 16 * u, line: 1 * u, fade: 0.6 } },
        ],
        background: '#fce8db',
      };
    default:
      return { layers: [], background: null };
  }
}

/** A soft shadow or glow for type on a look. */
function typeFx(ctx: KitContext, look: Look): Effect[] {
  const u = unit(ctx);
  const ink = inkOf(look);
  if (ink.light) return [{ type: 'drop-shadow', distance: 6 * u, softness: 26 * u, opacity: 22, direction: 180, color: ink.shadow }];
  // Dark stages: a white bloom at 28% and a wider accent one at 22% (the crimson word glow).
  return [glowFx(9 * u, 0.28), glowFx(26 * u, 0.22, pal(ctx).crimson)];
}

/** A picture: the footage when given, else a gradient panel in the house colours so the scene still reads. */
function picture(ctx: KitContext, id: string, name: string, media: FootageSource | undefined, size: Vec, extra: Partial<Layer> = {}, hue = 0): Layer {
  if (media) return { id, name, type: 'footage', source: media, fit: 'cover', size, ...extra } as Layer;
  const p = pal(ctx);
  const ramps: [number, string][][] = [
    [[0, p.oxblood], [0.6, p.crimson], [1, p.accent]],
    [[0, '#1b1216'], [0.55, p.oxblood], [1, p.pink]],
    [[0, p.void], [0.5, '#3a2a30'], [1, p.crimson]],
  ];
  return { id, name, type: 'shape', shape: { shape: 'rect', size, radius: 0, fill: null, gradient: { kind: 'linear', stops: ramps[hue % ramps.length], from: [0, 0], to: [size[0], size[1]] } }, ...extra } as Layer;
}

// ── words on times ──

type TimedWord = { text: string; start: number; end?: number };

/**
 * Word timings as a model passes them: analyze_song's word list (`{ text, start, end }`, song
 * seconds), `{ word, at }`, or bare onsets. `offset` (the song second the scene starts at) is taken off.
 */
function timedWords(value: unknown, offset: number): TimedWord[] {
  if (!Array.isArray(value)) return [];
  const out: TimedWord[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push({ text: '', start: item - offset });
    else if (item && typeof item === 'object') {
      const w = item as Record<string, unknown>;
      const start = typeof w.start === 'number' ? w.start : typeof w.at === 'number' ? w.at : typeof w.t === 'number' ? w.t : null;
      if (start === null || !Number.isFinite(start)) continue;
      out.push({ text: typeof w.text === 'string' ? w.text : typeof w.word === 'string' ? w.word : '', start: start - offset, ...(typeof w.end === 'number' ? { end: w.end - offset } : {}) });
    }
  }
  return out;
}

/**
 * One onset per word of the line: the next given word spelt the same (a few ahead, so a missed
 * word does not shift the rest), else the next in order; words past the list follow `spacing` apart.
 */
export function onsetsFor(line: string[], given: TimedWord[], at: number, spacing: number): TimedWord[] {
  const out: TimedWord[] = [];
  let next = 0;
  line.forEach((word, i) => {
    let hit = -1;
    for (let k = next; k < Math.min(given.length, next + 4); k++) if (given[k].text && norm(given[k].text) === norm(word)) { hit = k; break; }
    if (hit < 0 && next < given.length && (!given[next].text || !line.slice(i + 1).some((w) => norm(w) === norm(given[next].text)))) hit = next;
    const previous = out[i - 1]?.start;
    const start = hit >= 0 ? given[hit].start : previous === undefined ? at : previous + spacing;
    if (hit >= 0) next = hit + 1;
    out.push({ text: word, start: Math.max(start, previous ?? -Infinity, 0), ...(hit >= 0 && given[hit].end !== undefined ? { end: given[hit].end } : {}) });
  });
  return out;
}

/**
 * The second each character of the line is typed (the words joined by single spaces): each word
 * from its onset, 46–66 ms a character (the launch film's range), never running into the next word.
 */
export function typingTimes(line: TimedWord[], step?: number): number[] {
  const times: number[] = [];
  line.forEach((word, i) => {
    const chars = Array.from(word.text).length + (i < line.length - 1 ? 1 : 0);
    const next = line[i + 1]?.start;
    const room = next !== undefined ? next - word.start : word.end !== undefined ? Math.max(0.05, word.end - word.start) : chars * 0.066;
    let per = step ?? clamp((room * 0.85) / Math.max(1, chars), 0.046, 0.066);
    // A word sung faster than the typing: squeeze it so the next word still starts on its onset.
    if (next !== undefined && per * chars > room) per = Math.max(0.004, room / chars);
    for (let k = 0; k < chars; k++) times.push(round(Math.max(word.start + k * per, times[times.length - 1] ?? -Infinity)));
  });
  return times;
}

// ── the label pill (also the end card's call to action) ──

const PILL_VARIANTS = ['filled', 'glass', 'outline', 'light'] as const;
type PillVariant = (typeof PILL_VARIANTS)[number];

/**
 * The crimson label: 42 px tall at 1080p, gradient #e7233e → #c3122c, Inter 600 22 px. The body
 * springs in (2.8 Hz, ζ 0.6) from 78%, fades in over 0.10 s, de-blurs 6 px and rises 14 px; its words
 * follow 0.10 s later, 0.04 s apart, each over 0.12 s; it leaves in 0.16 s. Parented layers: body,
 * top highlight, dot, label.
 */
function pillLayers(ctx: KitContext, id: string, label: string, opts: { at: number; out: number | null; center: Vec; height: number; variant: PillVariant; dot?: boolean; parent?: string; press?: number }): { layers: Layer[]; width: number } {
  const p = pal(ctx);
  const u = unit(ctx);
  const h = opts.height;
  const k = h / 42;
  const size = 22 * k;
  const dotW = opts.dot ? 16 * k : 0;
  const width = estimateWidth(label, size, -1) + 40 * k + dotW;
  const { at, out } = opts;
  const look: Record<PillVariant, { fill: string | null; gradient?: [number, string][]; stroke?: string; ink: string; glow: boolean; frost?: boolean }> = {
    filled: { fill: null, gradient: [[0, '#e7233e'], [1, '#c3122c']], ink: '#ffffff', glow: true },
    glass: { fill: '#ffffff26', stroke: '#ffffff55', ink: '#ffffff', glow: false, frost: true },
    outline: { fill: '#00000000', stroke: p.accent, ink: p.accent, glow: true },
    light: { fill: '#f7f3f1', stroke: '#ffffff', ink: '#17120f', glow: false },
  };
  const style = look[opts.variant];
  const scale: Key<number>[] = springKeys(at, 78, 100, 2.8, 0.6);
  if (opts.press !== undefined) scale.push({ t: round(opts.press - 0.04), v: 100, ease: 'cubic-out' }, { t: round(opts.press + 0.03), v: 94, ease: 'back-out' }, { t: round(opts.press + 0.3), v: 100 });
  if (out !== null) scale.push({ t: out, v: 100, ease: EASE.in }, { t: out + 0.16, v: 92 });
  const opacity: Key<number>[] = [{ t: at, v: 0, ease: EASE.out }, { t: at + 0.1, v: 100 }];
  if (out !== null) opacity.push({ t: out, v: 100, ease: EASE.in }, { t: out + 0.16, v: 0 });
  const effects: Effect[] = [blurFx(keys<number>([at, 6 * u, EASE.out], [at + 0.2, 0]))];
  if (style.glow) effects.push(glowFx(22 * k, 0.45, p.accent));
  effects.push({ type: 'drop-shadow', distance: 8 * k, softness: 26 * k, opacity: 40, direction: 180, color: '#000000' });
  const body: Layer = {
    id,
    name: `Pill: ${label.slice(0, 24)}`,
    type: 'shape',
    ...(opts.parent ? { parent: opts.parent } : {}),
    in: Math.max(0, at - 0.02),
    ...(out !== null ? { out: out + 0.2 } : {}),
    motionBlur: true,
    shape: { shape: 'rect', size: [width, h], radius: h / 2, fill: style.fill, ...(style.gradient ? { gradient: { kind: 'linear' as const, stops: style.gradient, from: [0, 0], to: [0, h] } } : {}), ...(style.stroke ? { stroke: style.stroke, strokeWidth: 1.5 * k } : {}) },
    ...(style.frost ? { backdrop: { blur: 18, saturation: 1.2, brightness: -4 } } : {}),
    transform: { position: { k: [{ t: at, v: [opts.center[0], opts.center[1] + 14 * u], ease: EASE.out }, { t: at + 0.32, v: opts.center }] }, scale: { k: scale }, opacity: { k: opacity } },
    effects,
  } as Layer;
  const layers: Layer[] = [body];
  // Children do not inherit opacity, so every part of the pill fades with the body.
  // A 1 px highlight along the top edge (the filled pill's lit rim).
  if (opts.variant === 'filled') layers.push({ id: `${id}-rim`, name: 'Pill highlight', type: 'shape', parent: id, in: body.in, ...(out !== null ? { out: out + 0.2 } : {}), shape: { shape: 'rect', size: [width - h * 0.9, 1.2 * k], radius: 1, fill: '#ffffff66' }, transform: { position: [width / 2, 1.6 * k], opacity: { k: opacity } } } as Layer);
  if (opts.dot) layers.push({ id: `${id}-dot`, name: 'Pill dot', type: 'shape', parent: id, in: body.in, ...(out !== null ? { out: out + 0.2 } : {}), shape: { shape: 'ellipse', size: [8 * k, 8 * k], fill: style.ink }, transform: { position: [20 * k + 4 * k, h / 2], scale: keys<number>([at + 0.35, 100, 'sine-in-out'], [at + 0.95, 130, 'sine-in-out'], [at + 1.55, 100]), opacity: { k: opacity } } } as Layer);
  const wordsAt = at + 0.1;
  layers.push({
    id: `${id}-label`,
    name: label.slice(0, 32),
    type: 'text',
    parent: id,
    in: body.in,
    ...(out !== null ? { out: out + 0.2 } : {}),
    transform: { position: [width / 2 + dotW / 2, h / 2], opacity: { k: opacity } },
    text: {
      text: label,
      font: ctx.font,
      size,
      weight: 600,
      color: style.ink,
      align: 'center',
      tracking: -1,
      cascade: { by: 'word', delay: wordsAt, stagger: 0.04, duration: 0.12, ease: EASE.out, from: { opacity: 0, position: [0, 7 * k], blur: 4 * k } },
    },
  } as Layer);
  return { layers, width };
}

// ───────────────────────── type-on-voice ─────────────────────────

function typeOnVoice(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'light');
  const ink = inkOf(look);
  const accent = pal(ctx).accent;
  const line = words(text(p, 'text', 'An editor with a producer inside.'));
  const onsets = onsetsFor(line, timedWords(p.words, num(p, 'offset', 0)), num(p, 'at', 0.3, 0), 0.32);
  const step = typeof p.step === 'number' ? clamp(p.step, 0.02, 0.2) : undefined;
  const times = typingTimes(onsets, step);
  const last = times[times.length - 1] ?? 0.3;
  const hold = num(p, 'hold', 1.2, 0.2, 10);
  const exit = choice(p, 'exit', ['none', 'blur', 'rise'] as const, 'none');
  const duration = num(p, 'duration', last + hold + (exit === 'none' ? 0 : 0.35), 0.5, 60);
  const full = line.join(' ');
  const size = typeof p.size === 'number' ? p.size : fitSize(full, (W < H ? 88 : 96) * u, safe.w * 0.92, 60 * u);
  // Too long for one line even at the floor: it wraps inside the safe width.
  const wraps = estimateWidth(full, size, TRACK) > safe.w * 0.96;
  const place = choice(p, 'place', ['center', 'upper', 'lower'] as const, 'center');
  const y = place === 'upper' ? safe.y0 + safe.h * 0.3 : place === 'lower' ? safe.y1 - safe.h * 0.22 : safe.cy;
  // Accent words take the accent colour (the launch film set "producer" in its molten gradient).
  const accents = new Set(words(text(p, 'accent', '')).map(norm));
  const spans: TextSpan[] = line.map((w, i) => ({ text: w + (i < line.length - 1 ? ' ' : ''), ...(accents.has(norm(w)) ? { color: accent } : {}) }));
  const caret = flag(p, 'caret', true);
  const exitAt = duration - 0.35;
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  layers.push({
    id: 'line',
    name: full.slice(0, 32),
    type: 'text',
    // No motion blur: its sub-frames would catch characters mid-arrival and ghost the line.
    transform: {
      position: exit === 'rise' ? keys<number[]>([exitAt, [safe.cx, y], EASE.in], [duration, [safe.cx, y - 40 * u]]) : [safe.cx, y],
      ...(exit !== 'none' ? { opacity: keys<number>([exitAt, 100, EASE.in], [duration, 0]) } : {}),
    },
    text: {
      spans,
      font: ctx.font,
      size,
      weight: 700,
      color: ink.text,
      align: 'center',
      tracking: TRACK,
      ...(wraps ? { box: safe.w * 0.96 } : {}),
      type: { times, recenter: 0.154, fadeIn: 0, caret: caret ? 'bar' : 'none', caretColor: accent, blink: 1.65 },
    },
    effects: [...typeFx(ctx, look), ...(exit === 'blur' ? [blurFx(keys<number>([exitAt, 0, EASE.in], [duration, 14 * u]))] : [])],
  } as Layer);
  return scene(ctx, duration, layers, {
    background: backdrop(ctx, look).background,
    cues: [{ at: times[0] ?? 0, sound: 'typing', duration: Math.max(0.1, last - (times[0] ?? 0) + 0.08), note: 'typing on the words' }],
    template: template('type-on-voice', p),
  });
}

// ───────────────────────── fly-through-word ─────────────────────────

/** How far the camera has zoomed at u (0..1) of the plunge: fast from the start, then accelerating hard. */
export const zoomCurve = (u: number, depth = 270) => Math.exp(Math.log(depth) * (0.35 * u + 0.65 * Math.pow(clamp(u, 0, 1), 2.2)));

const COUNTER_LETTERS = 'oaedbpqgOQDAPRB0689';

function flyThroughWord(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'light');
  const ink = inkOf(look);
  const colours = pal(ctx);
  const word = words(text(p, 'word', 'producer'))[0] ?? 'producer';
  let line = words(text(p, 'line', word));
  let wordIndex = line.findIndex((w) => norm(w) === norm(word));
  if (wordIndex < 0) { line = [word]; wordIndex = 0; }
  const full = line.join(' ');
  const typed = Array.isArray(p.words) && p.words.length > 0;
  const onsets = typed ? onsetsFor(line, timedWords(p.words, num(p, 'offset', 0)), 0.3, 0.3) : [];
  const times = typed ? typingTimes(onsets) : [];
  const lastKey = times[times.length - 1] ?? 0;
  // The plunge waits for the line to settle (the re-centre glide takes 0.154 s).
  const at = Math.max(num(p, 'at', typed ? lastKey + 0.45 : 0.6, 0), typed ? lastKey + 0.2 : 0);
  const Z = num(p, 'zoom', 1.0, 0.6, 1.6);
  const depth = num(p, 'depth', 270, 60, 400);
  const hold = num(p, 'hold', 0.5, 0.1, 5);
  const duration = num(p, 'duration', at + Z + hold, at + Z + 0.05, 60);
  const want = (line.length === 1 ? 220 : W < H ? 96 : 110) * u;
  const size = typeof p.size === 'number' ? p.size : fitSize(full, want, safe.w * 0.9, 56 * u);
  const center: Vec = [safe.cx, safe.cy];

  // The letter to fly through: the one asked for, else the counter letter nearest the word's middle.
  const letters = Array.from(line[wordIndex]);
  const asked = typeof p.letter === 'number' ? Math.round(p.letter) : -1;
  const counters = letters.map((ch, i) => ({ ch, i })).filter(({ ch }) => COUNTER_LETTERS.includes(ch));
  const middle = (letters.length - 1) / 2;
  const letter = asked >= 0 && asked < letters.length ? asked : counters.length ? counters.reduce((a, b) => (Math.abs(b.i - middle) < Math.abs(a.i - middle) ? b : a)).i : Math.floor(middle);
  const ch = letters[letter] ?? 'o';
  const before = line.slice(0, wordIndex).join(' ') + (wordIndex > 0 ? ' ' : '') + letters.slice(0, letter).join('');
  const lineLeft = center[0] - estimateWidth(full, size, TRACK) / 2;
  // The aim: the letter's counter. The layout box is centred 0.53 em below its top, the baseline
  // 0.86 em down; a lowercase counter sits ~0.27 em above the baseline, a capital's ~0.36 em.
  const upper = ch !== ch.toLowerCase();
  const aim: Vec = [lineLeft + estimateWidth(before, size, TRACK) + estimateWidth(ch, size, TRACK) / 2, center[1] + (upper ? -0.03 : 0.06) * size];
  const counter: Vec = upper ? [0.2 * size, 0.25 * size] : [0.13 * size, 0.16 * size];

  // The word's fill: the launch film's molten gradient, one colour per letter across the word.
  const fill = choice(p, 'fill', ['gradient', 'accent', 'ink'] as const, 'gradient');
  const molten = ['#ff2d1a', '#ff6a1a', '#ffb347'];
  const letterColour = (i: number) => {
    if (fill === 'accent') return colours.accent;
    if (fill === 'ink') return ink.text;
    const t = letters.length > 1 ? i / (letters.length - 1) : 0.5;
    const [a, b, f] = t < 0.55 ? [molten[0], molten[1], t / 0.55] : [molten[1], molten[2], (t - 0.55) / 0.45];
    const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
    const [x, y] = [rgb(a), rgb(b)];
    return `#${x.map((v, k) => Math.round(v + (y[k] - v) * f).toString(16).padStart(2, '0')).join('')}`;
  };
  // Two layers with the very same text so they register exactly: the line without the word, and
  // the word without the rest (clear spans keep every letter's place).
  const clear = '#ffffff00';
  const spansFor = (part: 'rest' | 'word'): TextSpan[] => {
    const out: TextSpan[] = [];
    line.forEach((w, i) => {
      const sep = i < line.length - 1 ? ' ' : '';
      if (i !== wordIndex) out.push({ text: w + sep, color: part === 'rest' ? ink.text : clear });
      else if (part === 'rest') out.push({ text: w + sep, color: clear });
      else { Array.from(w).forEach((c, k) => out.push({ text: c, color: letterColour(k) })); if (sep) out.push({ text: sep, color: clear }); }
    });
    return out;
  };
  // Typed, both carry the same caret (clear on the word) so their layouts stay the same width.
  const textData = (part: 'rest' | 'word') => ({
    spans: spansFor(part), font: ctx.font, size, weight: 700, color: ink.text, align: 'center' as const, tracking: TRACK,
    ...(typed ? { type: { times, recenter: 0.154, fadeIn: 0, caret: 'bar' as const, blink: 1.65, caretColor: part === 'rest' ? colours.accent : clear } } : {}),
  });

  // The rig carries the words: its origin is the aim point, so scaling it plunges into the letter.
  const samples = Math.max(8, Math.ceil(Z * 30));
  const zoomKeys: Key<number>[] = [];
  const aimKeys: Key<Vec>[] = [];
  const portalBox: Key<Vec>[] = [];
  const portalFeather: Key<number>[] = [];
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const t = round(at + f * Z);
    const s = zoomCurve(f, depth);
    // The aim point glides to the frame centre on the sine ease while the zoom runs.
    const e = ease(EASE.sine, f);
    const pos = [aim[0] + (W / 2 - aim[0]) * e, aim[1] + (H / 2 - aim[1]) * e];
    zoomKeys.push({ t, v: round(s * 100, 2) });
    aimKeys.push({ t, v: pos.map((v) => round(v, 2)) });
    portalBox.push({ t, v: [pos[0] - counter[0] * s, pos[1] - counter[1] * s, counter[0] * 2 * s, counter[1] * 2 * s].map((v) => round(v, 2)) });
    portalFeather.push({ t, v: round(counter[0] * 0.35 * s, 2) });
  }
  const at2 = (f: number) => round(at + f * Z);
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  layers.push({ id: 'rig', name: 'Camera rig', type: 'null', transform: { anchor: [0, 0], position: { k: aimKeys }, scale: { k: zoomKeys } } } as Layer);
  const offset: Vec = [center[0] - aim[0], center[1] - aim[1]];
  if (line.length > 1) {
    layers.push({
      id: 'line',
      name: 'Line',
      type: 'text',
      parent: 'rig',
      out: at + 0.3,
      transform: { position: offset, opacity: keys<number>([at, 100, EASE.sine], [at + 0.16, 0]) },
      text: textData('rest'),
      effects: typeFx(ctx, look),
    } as Layer);
  }
  layers.push({ id: 'word', name: `Word: ${word}`, type: 'text', parent: 'rig', motionBlur: true, transform: { position: offset }, text: textData('word'), effects: typeFx(ctx, look) } as Layer);
  layers.push({ id: 'word-matte', name: 'Word matte', type: 'text', parent: 'rig', hidden: true, transform: { position: offset }, text: textData('word') } as Layer);
  // The next scene: pixelated inside the letters, then through the counter until it fills the frame.
  const next = source(p.next);
  const pixel = num(p, 'pixelate', 36, 1, 120) * u;
  const mosaic = (): Effect => ({ type: 'mosaic', cell: keys<number>([at2(0.44), pixel, EASE.sine], [at2(0.88), 1]) });
  layers.push(picture(ctx, 'next-letters', 'Next scene (in the letters)', next, [W, H], {
    in: at2(0.3),
    matte: { layer: 'word-matte', mode: 'alpha' },
    transform: { position: [W / 2, H / 2], opacity: keys<number>([at2(0.42), 0, EASE.sine], [at2(0.72), 100]) },
    effects: [mosaic()],
  }));
  layers.push(picture(ctx, 'next', 'Next scene', next, [W, H], {
    in: at2(0.3),
    masks: [{ shape: 'ellipse', box: { k: portalBox }, feather: { k: portalFeather } }],
    transform: { position: [W / 2, H / 2], opacity: keys<number>([at2(0.34), 0, EASE.sine], [at2(0.6), 100]) },
    effects: [mosaic()],
  }));
  // A light radial zoom blur on the push: 0.07 at its peak (the launch film's bump from 0.43 of the way).
  layers.push({ id: 'zoom-blur', name: 'Zoom blur', type: 'solid', color: '#ffffff', adjustment: true, in: at, effects: [{ type: 'zoom-blur', center: [0.5, 0.5], amount: bump(at2(0.43), 0.07, 0.25, 0.4) }] } as Layer);
  const cues: Cue[] = [];
  if (typed) cues.push({ at: times[0], sound: 'typing', duration: Math.max(0.1, lastKey - times[0] + 0.08), note: 'typing' });
  cues.push({ at: Math.max(0, at - 0.1), sound: 'riser', duration: Z, note: 'plunge' }, { at: at2(0.8), sound: 'whoosh', note: 'through the letter' }, { at: at + Z, sound: 'shimmer', note: 'next scene' });
  return scene(ctx, duration, layers, { background: backdrop(ctx, look).background, motionBlur: { samples: 8, shutter: 180 }, cues, template: template('fly-through-word', p) });
}

// ───────────────────────── word-land ─────────────────────────

function wordLand(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'stage');
  const ink = inkOf(look);
  const colours = pal(ctx);
  // " / " breaks a line; markup *emphasis* and [accent].
  const raw = text(p, 'text', 'Describe the *edit* you want.').replace(/\s+\/\s+/g, '\n');
  const emphasis = choice(p, 'emphasis', ['serif', 'accent', 'bold'] as const, 'serif');
  const size = typeof p.size === 'number' ? p.size : (W < H ? 104 : 118) * u;
  const spans = richSpans(raw, colours.accent).map((span) => {
    if (!span.italic) return span;
    // Emphasis: an italic serif set ~16% larger (the crimson film's Fraunces accents), or the accent colour, or heavier.
    if (emphasis === 'serif') return { ...span, font: 'Fraunces', weight: 420, size: size * 1.16 };
    if (emphasis === 'accent') return { ...span, italic: false, color: colours.accent };
    return { ...span, italic: false, weight: 900 };
  });
  const plain = spans.map((s) => s.text).join('');
  const lineList = plain.split('\n');
  const n = words(plain).length;
  const onsets = onsetsFor(words(plain), timedWords(p.words ?? p.times, num(p, 'offset', 0)), num(p, 'at', 0.25, 0), num(p, 'stagger', 0.3, 0.05, 2));
  const times = onsets.map((o) => o.start);
  const align = choice(p, 'align', ['center', 'left'] as const, 'center');
  const box = safe.w * 0.94;
  // Shrink until the longest line fits, then let long lines wrap in the box.
  const longest = lineList.reduce((a, b) => (estimateWidth(a, 1) > estimateWidth(b, 1) ? a : b), '');
  const fitted = typeof p.size === 'number' ? size : fitSize(longest, size, box, size * 0.6);
  const scaled = fitted / size;
  const out = typeof p.out === 'number' ? p.out : null;
  const last = times[times.length - 1] ?? 0.25;
  const duration = num(p, 'duration', Math.max(out !== null ? out + 0.5 : 0, last + 1.4), 0.5, 60);
  const enter = choice(p, 'enter', ['rise', 'drop', 'slide', 'scale'] as const, 'rise');
  const from = {
    rise: { opacity: 0, position: [0, 34 * u], blur: 16 * u, scale: 106 },
    drop: { opacity: 0, position: [0, -34 * u], blur: 16 * u, scale: 106 },
    slide: { opacity: 0, position: [-40 * u, 0], blur: 16 * u, scale: 100 },
    scale: { opacity: 0, position: [0, 8 * u], blur: 12 * u, scale: 140 },
  }[enter];
  // Grey on landing, white from 0.07 s to 0.36 s after: a range selector sweeps word by word.
  const whiteKeys: Key<number>[] = [];
  times.forEach((t0, i) => {
    const a = Math.max(t0 + 0.07, whiteKeys[whiteKeys.length - 1]?.t ?? -Infinity);
    const b = Math.max(Math.min(t0 + 0.36, (times[i + 1] ?? Infinity) + 0.07), a + 0.02);
    whiteKeys.push({ t: round(a), v: round((i / n) * 100, 3), ease: 'sine-out' }, { t: round(b), v: round(((i + 1) / n) * 100, 3) });
  });
  const y = choice(p, 'place', ['center', 'upper', 'lower'] as const, 'center');
  const lines = lineList.length;
  const cy = y === 'upper' ? safe.y0 + safe.h * 0.28 : y === 'lower' ? safe.y1 - safe.h * 0.2 : safe.cy;
  const x = align === 'left' ? safe.x0 + safe.w * 0.02 : safe.cx;
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  layers.push({
    id: 'words',
    name: plain.replace(/\n/g, ' ').slice(0, 32),
    type: 'text',
    motionBlur: true,
    transform: { position: [x, cy] },
    ...(align === 'left' ? { note: 'Left-aligned: the position is the left edge of the lines.' } : {}),
    text: {
      spans: spans.map((s) => (s.size ? { ...s, size: s.size * scaled } : s)),
      font: ctx.font,
      size: fitted,
      weight: 600,
      color: ink.text,
      align,
      tracking: -3.8,
      lineHeight: lines > 1 ? 1.08 : 1.12,
      box,
      cascade: {
        by: 'word',
        times: times.map((t) => round(Math.max(0, t - 0.04))),
        duration: 0.3,
        ease: EASE.out,
        from,
        ...(out !== null ? { exit: { at: out, duration: 0.24, stagger: 0.03, ease: EASE.exit, to: { opacity: 0, position: [0, -26 * u], blur: 12 * u } } } : {}),
      },
      animators: [{ by: 'word', start: { k: whiteKeys }, end: 100, smoothness: 1, props: { fillColor: ink.dim, fillAmount: 100 } }],
    },
    effects: typeFx(ctx, look),
  } as Layer);
  return scene(ctx, duration, layers, {
    background: backdrop(ctx, look).background,
    cues: times.slice(0, 1).map((t) => ({ at: Math.max(0, t - 0.05), sound: 'whoosh' as const, note: 'words land' })),
    template: template('word-land', p),
  });
}

// ───────────────────────── label-pill ─────────────────────────

function labelPill(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const safe = safeRect(ctx);
  const label = text(p, 'label', 'Bring your own AI');
  const at = num(p, 'at', 0.1, 0);
  const height = num(p, 'height', 42, 24, 120) * u;
  const variant = choice(p, 'variant', PILL_VARIANTS, 'filled');
  const side = choice(p, 'side', ['below', 'above', 'left', 'right'] as const, 'below');
  const gap = num(p, 'gap', 38, 0, 400) * u;
  const k = height / 42;
  const width = estimateWidth(label, 22 * k, -1) + 40 * k + (p.dot === true ? 16 * k : 0);
  // Where it sits: beside the thing it names (`attach`, a rect in frame fractions), at `position`, or low centre.
  let center: Vec = [safe.cx, safe.y1 - safe.h * 0.16];
  if (Array.isArray(p.position) && p.position.length >= 2) center = [Number(p.position[0]) * (Number(p.position[0]) <= 1.5 ? W : 1), Number(p.position[1]) * (Number(p.position[1]) <= 1.5 ? H : 1)];
  if (Array.isArray(p.attach) && p.attach.length >= 4) {
    const [ax, ay, aw, ah] = (p.attach as number[]).map(Number);
    const [bx, by, bw, bh] = [ax * W, ay * H, aw * W, ah * H];
    center = side === 'below' ? [bx + bw / 2, by + bh + gap + height / 2]
      : side === 'above' ? [bx + bw / 2, by - gap - height / 2]
        : side === 'left' ? [bx - gap - width / 2, by + bh / 2]
          : [bx + bw + gap + width / 2, by + bh / 2];
  }
  // Kept inside the safe area whatever it labels.
  center = [clamp(center[0], safe.x0 + width / 2, Math.max(safe.x0 + width / 2, safe.x1 - width / 2)), clamp(center[1], safe.y0 + height, safe.y1 - height)];
  // Every word stays readable for at least 0.6 s before it leaves (the crimson film's fix).
  const wordsDone = at + 0.1 + Math.max(0, words(label).length - 1) * 0.04 + 0.12;
  const out = typeof p.out === 'number' ? Math.max(p.out, wordsDone + 0.6) : null;
  const pill = pillLayers(ctx, 'pill', label, { at, out, center, height, variant, dot: p.dot === true });
  const duration = Math.max(num(p, 'duration', out !== null ? out + 0.3 : Math.max(2, wordsDone + 1.4), 0.5, 60), out !== null ? out + 0.2 : wordsDone + 0.6);
  return scene(ctx, duration, pill.layers, {
    background: null,
    cues: [{ at, sound: 'pop', note: 'pill' }, ...(out !== null ? [{ at: out, sound: 'swish' as const, note: 'pill out' }] : [])],
    template: template('label-pill', p),
  });
}

// ───────────────────────── slam-tilt ─────────────────────────

function slamTilt(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'stage');
  const ink = inkOf(look);
  const colours = pal(ctx);
  const at = num(p, 'at', 0.35, 0.05);
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : null;
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : null;
  const media = source(p.media);
  const aspect = num(p, 'aspect', media?.width && media?.height ? media.width / media.height : 16 / 9, 0.3, 4);
  // The card fills most of the safe area, leaving room for the title above and a label below.
  const room = safe.h * (title ? 0.62 : 0.78) * (label ? 0.88 : 1);
  const cw = Math.min(safe.w * (portrait ? 0.96 : num(p, 'width', 0.72, 0.3, 0.95)), room * aspect);
  const ch = cw / aspect;
  const cy = safe.cy + (title ? safe.h * 0.08 : 0) - (label ? pillHeight(ctx) * 0.6 : 0);
  const tilt = choice(p, 'tilt', ['settle', 'flat', 'steep'] as const, 'settle');
  // Scale 1.32 → 1, rotateX 26° → 13°, rotateY −14° → −6°, blur 18 → 0 over 0.22 s, then a dolly.
  const rx = { settle: [26, 13], flat: [22, 0], steep: [34, 20] }[tilt];
  const ry = { settle: [-14, -6], flat: [-12, 0], steep: [-18, -9] }[tilt];
  const dolly = choice(p, 'dolly', ['left', 'right', 'in', 'none'] as const, 'left');
  const duration = num(p, 'duration', 2.4, at + 0.6, 60);
  const settle = at + 0.22;
  const drift = dolly === 'left' ? [-80 * u, 0] : dolly === 'right' ? [80 * u, 0] : [0, 0];
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  // A small camera shake after the hit, on a null so the card and its words move as one.
  const shake = flag(p, 'shake', true);
  const shakeKeys: Key<Vec>[] = [{ t: 0, v: [safe.cx, cy] }];
  if (shake) [[0, 0], [9, -6], [-7, 5], [4, -3], [-2, 1], [0, 0]].forEach(([dx, dy], i) => shakeKeys.push({ t: round(settle + i * 0.035), v: [safe.cx + dx * u, cy + dy * u] }));
  layers.push({ id: 'rig', name: 'Slam rig', type: 'null', transform: { anchor: [0, 0], position: { k: shakeKeys } } } as Layer);
  layers.push(picture(ctx, 'card', 'Card', media, [cw, ch], {
    parent: 'rig',
    threeD: true,
    in: Math.max(0, at - 0.02),
    motionBlur: true,
    masks: [{ shape: 'rect', radius: 18 * u }],
    transform: {
      position: keys<number[]>([at, [0, 0, 0], EASE.out], [settle, [0, 0, 0], EASE.sine], [duration, [drift[0], drift[1], dolly === 'in' ? -60 * u : 0]]),
      scale: keys<number>([at, 132, EASE.out], [settle, 100]),
      rotationX: keys<number>([at, rx[0], EASE.out], [settle, rx[1], EASE.sine], [duration, rx[1] - 2]),
      rotationY: keys<number>([at, ry[0], EASE.out], [settle, ry[1], EASE.sine], [duration, ry[1] + 2]),
      opacity: keys<number>([at, 0, 'linear'], [at + 2 / 30, 100]),
    },
    effects: [
      blurFx(keys<number>([at, 18 * u, EASE.out], [settle, 0])),
      { type: 'stroke', width: 1.5 * u, color: colours.pink, opacity: 42, position: 'inside' },
      glowFx(34 * u, 0.3, colours.accent),
      { type: 'drop-shadow', distance: 34 * u, softness: 90 * u, opacity: 62, direction: 180, color: '#000000' },
    ],
  }));
  if (flag(p, 'flash', true)) {
    // A white flash on the hit, gone in a few frames (e^(−t/0.06)).
    layers.push({ id: 'flash', name: 'Flash', type: 'solid', color: '#ffffff', blend: 'add', in: at, out: at + 0.4, transform: { opacity: { k: [0, 1, 2, 3, 5, 8].map((f) => ({ t: round(at + f / 30), v: round(55 * Math.exp(-(f / 30) / 0.06), 2) })) } } } as Layer);
  }
  if (title) {
    const size = fitSize(title, (portrait ? 84 : 92) * u, safe.w * 0.92, 44 * u);
    const ty = Math.max(safe.y0 + size * 0.7, cy - ch / 2 - size * 0.95);
    const tWords = words(title);
    layers.push({
      id: 'title',
      name: title.slice(0, 32),
      type: 'text',
      transform: { position: [safe.cx, ty] },
      text: {
        text: title, font: ctx.font, size, weight: 700, color: ink.text, align: 'center', tracking: TRACK,
        cascade: { by: 'word', times: tWords.map((_, i) => round(at + 0.1 + i * 0.09)), duration: 0.3, ease: EASE.out, from: { opacity: 0, position: [0, 34 * u], blur: 16 * u, scale: 106 } },
      },
      effects: typeFx(ctx, look),
    } as Layer);
  }
  if (label) {
    const h = pillHeight(ctx);
    layers.push(...pillLayers(ctx, 'label', label, { at: at + 0.14, out: null, center: [safe.cx, Math.min(safe.y1 - h, cy + ch / 2 + 38 * u + h / 2)], height: h, variant: choice(p, 'variant', PILL_VARIANTS, 'filled') }).layers);
  }
  return scene(ctx, duration, layers, {
    background: backdrop(ctx, look).background,
    motionBlur: { samples: 8, shutter: 180 },
    cues: [{ at: Math.max(0, at - 0.3), sound: 'whoosh', note: 'reverse whoosh into the slam' }, { at, sound: 'impact', note: 'slam' }, ...(label ? [{ at: at + 0.14, sound: 'pop' as const, note: 'label' }] : [])],
    template: template('slam-tilt', p),
  });
}

// ───────────────────────── whip-pan ─────────────────────────

function whipPan(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const direction = choice(p, 'direction', ['left', 'right', 'up', 'down'] as const, 'left');
  const frame = choice(p, 'frame', ['full', 'card'] as const, 'full');
  const look = frame === 'card' ? lookOf(ctx, p, 'stage') : 'none';
  const at = num(p, 'at', 0.6, 0.2);
  const d = num(p, 'duration', 0.32, 0.18, 0.8);
  const blur = num(p, 'blur', 14, 0, 60) * u;
  const tilt = num(p, 'tilt', 18, 0, 40);
  const sceneDuration = num(p, 'sceneDuration', at + d * 1.2 + 0.8, at + d * 1.2 + 0.1, 60);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  // The two shots sit side by side and pan as one strip (a card frame leaves stage between them).
  const travel = frame === 'card' ? (horizontal ? W : H) * 0.72 + 120 * u : horizontal ? W : H;
  // One move on the whip ease (gather, snap, long settle), timed so the shots swap at `at`.
  const span = d * 1.6;
  const t0 = round(at - span * 0.45);
  const t1 = round(t0 + span);
  const size: Vec = frame === 'card' ? [W * 0.72, H * 0.72] : [W, H];
  const c: Vec = [W / 2, H / 2];
  const off = (k: number): Vec => (horizontal ? [c[0] + sign * k * travel, c[1]] : [c[0], c[1] + sign * k * travel]);
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  const card = frame === 'card' ? { masks: [{ shape: 'rect' as const, radius: 20 * u }], effects: [{ type: 'drop-shadow', distance: 26 * u, softness: 70 * u, opacity: 55, direction: 180, color: '#000000' } as Effect] } : { effects: [] as Effect[] };
  layers.push(picture(ctx, 'outgoing', 'Outgoing shot', source(p.from), size, {
    out: t1,
    threeD: frame === 'card',
    motionBlur: true,
    ...(card.masks ? { masks: card.masks } : {}),
    transform: {
      position: keys<number[]>([t0, c, EASE.whip], [t1, off(1)]),
      ...(frame === 'card' && horizontal ? { rotationY: keys<number>([t0, 0, EASE.whip], [at, sign * tilt]) } : {}),
    },
    effects: card.effects,
  }, 0));
  // The incoming shot trails it in from the far side, its small turn unwinding as it lands.
  layers.push(picture(ctx, 'incoming', 'Incoming shot', source(p.to), size, {
    in: t0,
    threeD: frame === 'card' || tilt > 0,
    motionBlur: true,
    ...(card.masks ? { masks: card.masks } : {}),
    transform: {
      position: keys<number[]>([t0, off(-1), EASE.whip], [t1, c]),
      ...(horizontal && tilt > 0 ? { rotationY: keys<number>([at, -sign * tilt, EASE.out], [t1, 0]) } : {}),
      ...(!horizontal && tilt > 0 ? { rotationX: keys<number>([at, sign * tilt, EASE.out], [t1, 0]) } : {}),
    },
    effects: card.effects,
  }, 1));
  if (typeof p.title === 'string' && p.title.trim()) {
    const title = p.title.trim();
    const safe = safeRect(ctx);
    const tSize = fitSize(title, (W < H ? 92 : 104) * u, safe.w * 0.9, 44 * u);
    layers.push({
      id: 'title', name: title.slice(0, 32), type: 'text', parent: 'incoming', in: t0, motionBlur: true,
      transform: { position: [size[0] / 2 + (safe.cx - W / 2), size[1] / 2] },
      text: { text: title, font: ctx.font, size: tSize, weight: 700, color: '#ffffff', align: 'center', tracking: TRACK, shadow: { color: '#00000066', blur: 20 * u, y: 4 * u } },
    } as Layer);
  }
  // The pan's smear: a directional blur along the move, peaking on the whip.
  layers.push({ id: 'whip-blur', name: 'Whip blur', type: 'solid', color: '#ffffff', adjustment: true, in: t0, out: t1, effects: [{ type: 'directional-blur', direction: horizontal ? 90 : 0, length: { k: [{ t: t0, v: 0, ease: 'cubic-in' }, { t: round(at), v: blur * 6 }, { t: round(at + 0.001), v: blur * 6, ease: EASE.out }, { t: round(at + d * 1.1), v: 0 }] } }] } as Layer);
  const reverse = direction === 'right' || direction === 'down';
  return scene(ctx, sceneDuration, layers, {
    background: backdrop(ctx, look).background,
    motionBlur: { samples: 12, shutter: 180 },
    cues: [{ at: Math.max(0, at - d * 0.4), sound: 'whoosh', note: `whip ${reverse ? 'back' : 'on'}` }],
    template: template('whip-pan', p),
  });
}

// ───────────────────────── match-grow ─────────────────────────

function matchGrow(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const look = lookOf(ctx, p, 'stage');
  const colours = pal(ctx);
  const at = num(p, 'at', 0.3, 0);
  const d = num(p, 'grow', 0.28, 0.15, 1.2);
  const fadeIn = num(p, 'crossfade', 0.1, 0.03, 0.6);
  const rectOf = (value: unknown, fallback: number[]) => (Array.isArray(value) && value.length >= 4 ? (value as number[]).map(Number) : fallback);
  const pointOf = (value: unknown, fallback: number[]) => (Array.isArray(value) && value.length >= 2 ? (value as number[]).slice(0, 2).map(Number) : fallback);
  const [rx, ry, rw, rh] = rectOf(p.fromRect, W < H ? [0.08, 0.64, 0.3, 0.17] : [0.05, 0.7, 0.2, 0.2]);
  const card: Vec = [rw * W, rh * H];
  const [afx, afy] = pointOf(p.anchorFrom, [0.5, 0.4]);
  const [atx, aty] = pointOf(p.anchorTo, [0.5, 0.4]);
  const anchor: Vec = [afx * card[0], afy * card[1]];
  const start: Vec = [rx * W + anchor[0], ry * H + anchor[1]];
  const land: Vec = [atx * W, aty * H];
  // The card's end size: as asked, else so its picture is as wide as the frame (the same shot, matched).
  const scaleTo = num(p, 'scale', (W / card[0]) * 100, 50, 4000);
  const landed = at + d;
  const duration = num(p, 'duration', landed + fadeIn + 1.0, landed + fadeIn + 0.1, 60);
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  // The next shot, full frame, fading in around the landed card.
  layers.push(picture(ctx, 'to', 'Next shot', source(p.to), [W, H], { in: Math.max(0, landed - 0.02), transform: { position: [W / 2, H / 2], opacity: keys<number>([landed, 0, EASE.sine], [landed + fadeIn, 100]) } }, 1));
  layers.push(picture(ctx, 'card', 'Small card', source(p.from), card, {
    motionBlur: true,
    out: landed + fadeIn + 0.15,
    masks: [{ shape: 'rect', radius: 24 * u }],
    transform: {
      anchor,
      position: keys<number[]>([at, start, EASE.whip], [landed, land]),
      scale: keys<number>([at, 100, EASE.whip], [landed, round(scaleTo, 2)]),
      opacity: keys<number>([landed + fadeIn, 100, EASE.sine], [landed + fadeIn + 0.12, 0]),
    },
    effects: [
      blurFx(keys<number>([at, 0, EASE.whip], [at + d * 0.5, 10 * u, EASE.out], [landed, 0])),
      { type: 'stroke', width: 1.5 * u, color: colours.pink, opacity: 42, position: 'inside' },
      { type: 'drop-shadow', distance: 20 * u, softness: 60 * u, opacity: 55, direction: 180, color: '#000000' },
    ],
  }, 0));
  // The corners stay 24 px on screen as the card grows, so the landed card reads as the frame.
  const card0 = layers[layers.length - 1];
  card0.masks = [{ shape: 'rect', radius: keys<number>([at, 24 * u, EASE.whip], [landed, round((24 * u * 100) / scaleTo, 3)]) }];
  return scene(ctx, duration, layers, {
    background: backdrop(ctx, look).background,
    motionBlur: { samples: 12, shutter: 180 },
    cues: [{ at, sound: 'whoosh', note: 'card grows' }, { at: landed, sound: 'shimmer', note: 'match' }],
    template: template('match-grow', p),
  });
}

// ───────────────────────── logo-lockup ─────────────────────────

/** The mark: the brand's logo file, or a tile with the name's initial. */
function markLayers(ctx: KitContext, logo: FootageSource | undefined, name: string, size: number, extra: Partial<Layer>): Layer[] {
  const colours = pal(ctx);
  const u = unit(ctx);
  if (logo) return [{ id: 'mark', name: 'Logo', type: 'footage', source: { kind: 'image', ...logo }, fit: 'contain', size: [size, size], ...extra } as Layer];
  const layers: Layer[] = [{
    id: 'mark',
    name: 'Mark',
    type: 'shape',
    shape: { shape: 'rect', size: [size, size], radius: size * 0.28, fill: null, gradient: { kind: 'linear', stops: [[0, colours.accent], [1, colours.crimson]], from: [0, 0], to: [size, size] }, stroke: '#ffffff40', strokeWidth: 1.5 * u },
    ...extra,
    effects: [...(extra.effects ?? []), glowFx(26 * u, 0.4, colours.accent)],
  } as Layer];
  // It appears and fades with the tile (children do not inherit opacity).
  layers.push({ id: 'mark-initial', name: 'Mark initial', type: 'text', parent: 'mark', ...(extra.in !== undefined ? { in: extra.in } : {}), transform: { position: [size / 2, size / 2], ...(extra.transform?.opacity !== undefined ? { opacity: extra.transform.opacity } : {}) }, text: { text: (Array.from(name)[0] ?? 'B').toUpperCase(), font: ctx.font, size: size * 0.56, weight: 800, color: '#ffffff', align: 'center', tracking: 0 } } as Layer);
  return layers;
}

function logoLockup(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'dark');
  const ink = inkOf(look);
  const colours = pal(ctx);
  const name = text(p, 'name', ctx.brand?.name ?? 'Bhippi');
  const logo = source(p.logo) ?? (ctx.brand?.logoAsset ? { asset: ctx.brand.logoAsset, kind: 'image' as const } : undefined);
  const tagline = typeof p.tagline === 'string' && p.tagline.trim() ? p.tagline.trim() : null;
  const at = num(p, 'at', 0.4, 0.15);
  const layout = choice(p, 'layout', ['side', 'stacked'] as const, W < H ? 'stacked' : 'side');
  const tagWords = tagline ? words(tagline) : [];
  const tagOnsets = onsetsFor(tagWords, timedWords(p.words ?? p.times, num(p, 'offset', 0)), at + 0.72, 0.16).map((o) => o.start);
  const lastLand = Math.max(at + 0.9, (tagOnsets[tagOnsets.length - 1] ?? 0) + 0.4);
  const flood = flag(p, 'flood', false);
  const duration = num(p, 'duration', lastLand + 1.6 + (flood ? 0.35 : 0), lastLand + 0.3, 60);
  const markSize = (layout === 'stacked' ? 190 : 150) * u;
  const nameSize = fitSize(name, (layout === 'stacked' ? 120 : 150) * u, layout === 'stacked' ? safe.w * 0.9 : safe.w * 0.9 - markSize - 40 * u, 60 * u);
  const nameW = estimateWidth(name, nameSize, -2);
  const tagSize = fitSize(tagline ?? '', 46 * u, safe.w * 0.9, 26 * u);
  // Places: the mark left of the wordmark (side) or above it (stacked); the tagline under both.
  const block = layout === 'side' ? markSize + 36 * u + nameW : Math.max(markSize, nameW);
  const blockH = layout === 'side' ? markSize : markSize + 30 * u + nameSize;
  const top = safe.cy - (blockH + (tagline ? tagSize * 1.9 : 0)) / 2;
  const markPos: Vec = layout === 'side' ? [safe.cx - block / 2 + markSize / 2, top + markSize / 2] : [safe.cx, top + markSize / 2];
  const namePos: Vec = layout === 'side' ? [safe.cx - block / 2 + markSize + 36 * u + nameW / 2, top + markSize / 2] : [safe.cx, top + markSize + 30 * u + nameSize / 2];
  const tagY = top + blockH + tagSize * 1.25;
  const pushTo = 100 + num(p, 'push', 3.5, 0, 12);
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  // A slow push over the whole lockup (+3.5%), from the lockup's centre.
  layers.push({ id: 'world', name: 'Push', type: 'null', transform: { anchor: [0, 0], position: [safe.cx, safe.cy], scale: flood ? keys<number>([0, 100, EASE.sine], [duration - 0.35, pushTo, 'cubic-in'], [duration, pushTo + 10]) : keys<number>([0, 100, EASE.sine], [duration, pushTo]) } } as Layer);
  const rel = (v: Vec): Vec => [v[0] - safe.cx, v[1] - safe.cy];
  if (flag(p, 'halo', true)) {
    // The ember halo, breathing on the given beats (or every bar at 99 BPM).
    const beats = Array.isArray(p.beats) ? (p.beats as unknown[]).filter((b): b is number => typeof b === 'number' && b > at && b < duration) : [];
    const pulses = beats.length ? beats : Array.from({ length: Math.floor((duration - at) / 2.424) }, (_, i) => at + 0.6 + i * 2.424).filter((b) => b < duration - 0.3);
    const scaleKeys: Key<number>[] = [{ t: 0, v: 60, ease: EASE.out }, { t: at + 0.4, v: 100 }];
    for (const b of pulses) if (b - 0.02 > scaleKeys[scaleKeys.length - 1].t) scaleKeys.push({ t: round(b - 0.02), v: 100, ease: EASE.out }, { t: round(b + 0.12), v: 108, ease: EASE.sine }, { t: round(b + 0.6), v: 100 });
    layers.push({ id: 'halo', name: 'Halo', type: 'shape', parent: 'world', blend: 'add', shape: { shape: 'ellipse', size: [900 * u, 900 * u], fill: null, gradient: { kind: 'radial', stops: [[0, `${colours.crimson}66`], [0.45, `${colours.oxblood}33`], [1, '#00000000']] } }, transform: { position: rel(markPos), scale: { k: scaleKeys }, opacity: keys<number>([0, 0, EASE.out], [at + 0.3, look === 'light' ? 40 : 100]) } } as Layer);
  }
  // The glow point contracts 300 → 90 px into the mark's landing (the send glow that became the logo).
  layers.push({ id: 'glow-point', name: 'Glow point', type: 'shape', parent: 'world', blend: 'add', out: at + 0.5, shape: { shape: 'ellipse', size: [300 * u, 300 * u], fill: null, gradient: { kind: 'radial', stops: [[0, '#fff3e6'], [0.3, `${colours.pink}aa`], [1, '#00000000']] } }, transform: { position: rel(markPos), scale: keys<number>([0, 100, EASE.out], [at, 30]), opacity: keys<number>([0, 0, EASE.out], [0.08, 100, EASE.sine], [at, 100, EASE.out], [at + 0.3, 0]) } } as Layer);
  // The mark: 0.86 → 1 and 10 → 0 px blur over 0.34 s.
  layers.push(...markLayers(ctx, logo, name, markSize, {
    parent: 'world',
    in: Math.max(0, at - 0.02),
    motionBlur: true,
    transform: { position: rel(markPos), scale: keys<number>([at, 86, EASE.out], [at + 0.34, 100]), opacity: keys<number>([at, 0, EASE.out], [at + 0.08, 100]) },
    effects: [blurFx(keys<number>([at, 10 * u, EASE.out], [at + 0.34, 0]))],
  }));
  // The wordmark 0.08 s later, from 50 px back towards the mark, blurred 14 → 0.
  const nameAt = at + 0.08;
  const from: Vec = layout === 'side' ? [-50 * u, 0] : [0, -50 * u];
  layers.push({
    id: 'wordmark',
    name: name.slice(0, 32),
    type: 'text',
    parent: 'world',
    in: nameAt,
    motionBlur: true,
    transform: { position: { k: [{ t: nameAt, v: [rel(namePos)[0] + from[0], rel(namePos)[1] + from[1]], ease: EASE.out }, { t: nameAt + 0.37, v: rel(namePos) }] }, opacity: keys<number>([nameAt, 0, EASE.out], [nameAt + 0.2, 100]) },
    text: { text: name, font: ctx.font, size: nameSize, weight: 700, color: ink.text, align: 'center', tracking: -2 },
    effects: [blurFx(keys<number>([nameAt, 14 * u, EASE.out], [nameAt + 0.37, 0])), ...typeFx(ctx, look)],
  } as Layer);
  if (tagline) {
    layers.push({
      id: 'tagline',
      name: tagline.slice(0, 32),
      type: 'text',
      parent: 'world',
      transform: { position: [0, tagY - safe.cy] },
      text: {
        text: tagline, font: ctx.font, size: tagSize, weight: 500, color: ink.soft, align: 'center', tracking: -1,
        cascade: { by: 'word', times: tagOnsets.map((t) => round(Math.max(0, t - 0.04))), duration: 0.3, ease: EASE.out, from: { opacity: 0, position: [0, 18 * u], blur: 10 * u } },
      },
    } as Layer);
  }
  if (flood) layers.push({ id: 'flood', name: 'Light flood', type: 'solid', color: '#fffaf2', in: duration - 0.36, transform: { opacity: keys<number>([duration - 0.35, 0, 'cubic-in'], [duration, 85]) } } as Layer);
  return scene(ctx, duration, layers, {
    background: backdrop(ctx, look).background,
    cues: [{ at: Math.max(0, at - 0.3), sound: 'riser', duration: 0.3, note: 'glow gathers' }, { at, sound: 'glass', note: 'mark' }, { at: nameAt, sound: 'whoosh', note: 'wordmark' }, ...(flood ? [{ at: duration - 0.35, sound: 'shimmer' as const, note: 'light flood' }] : [])],
    template: template('logo-lockup', p),
  });
}

// ───────────────────────── end-card ─────────────────────────

/** The launch film's cursor arrow (tip at 0,0), at 1080p. */
const ARROW = [0, 0, 0, 26, 6.4, 20.4, 10.6, 29.6, 15, 27.7, 10.8, 18.8, 19, 18.8];

function endCard(ctx: KitContext, p: Params): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = W < H;
  const safe = safeRect(ctx);
  const look = lookOf(ctx, p, 'dark');
  const ink = inkOf(look);
  const colours = pal(ctx);
  const name = text(p, 'name', ctx.brand?.name ?? 'Bhippi');
  const logo = source(p.logo) ?? (ctx.brand?.logoAsset ? { asset: ctx.brand.logoAsset, kind: 'image' as const } : undefined);
  const tagline = typeof p.tagline === 'string' && p.tagline.trim() ? p.tagline.trim() : null;
  const cta = typeof p.cta === 'string' && p.cta.trim() ? p.cta.trim() : null;
  const url = typeof p.url === 'string' && p.url.trim() ? p.url.trim() : null;
  const at = num(p, 'at', 0.2, 0);
  const align = choice(p, 'layout', ['center', 'left'] as const, 'center');
  // Beats: tagline +0.36 s, call to action +0.70 s (back-out), a click on it a second later.
  const tagAt = at + 0.36;
  const ctaAt = at + 0.7;
  const click = cta && flag(p, 'click', true) ? ctaAt + 1.0 : null;
  const lastLand = Math.max(at + 0.9, cta ? ctaAt + 0.5 : 0, url ? ctaAt + 0.6 : 0, click !== null ? click + 0.4 : 0);
  // The card holds at least 1.5 s after everything has landed, however short a duration is asked.
  const hold = Math.max(1.5, num(p, 'hold', 2.2, 0, 20));
  const duration = Math.max(num(p, 'duration', lastLand + hold, 0.5, 60), lastLand + 1.5);
  const x = align === 'left' ? safe.x0 + safe.w * 0.04 : safe.cx;
  const textAlign = align === 'left' ? 'left' : 'center';
  const markSize = (portrait ? 170 : 130) * u;
  const nameSize = fitSize(name, (portrait ? 118 : 128) * u, safe.w * 0.86, 56 * u);
  const tagSize = fitSize(tagline ?? '', (portrait ? 46 : 44) * u, safe.w * 0.86, 24 * u);
  const pillH = 64 * u;
  // A column from the top down: mark, wordmark, tagline, call to action, address; centred as a block.
  const gapY = 26 * u;
  const heights = [markSize, nameSize * 1.05, tagline ? tagSize * 1.3 : 0, cta ? pillH + gapY : 0, url ? 34 * u : 0];
  const total = heights.reduce((a, b) => a + b, 0) + gapY * heights.filter(Boolean).length;
  let y = safe.cy - total / 2;
  const slot = (h: number) => { const c = y + h / 2; y += h + (h ? gapY : 0); return c; };
  const markY = slot(heights[0]);
  const nameY = slot(heights[1]);
  const tagY = slot(heights[2]);
  const ctaY = slot(heights[3]) - gapY / 2;
  const urlY = slot(heights[4]);
  const push = num(p, 'push', 4.5, 0, 12);
  const layers: Layer[] = [...backdrop(ctx, look).layers];
  // The film's own shots, far behind: 26% opacity, defocused 8–13 px, turned ±18°, drifting.
  const shots = (Array.isArray(p.backdrop) ? p.backdrop : []).map(source).filter((s): s is FootageSource => !!s).slice(0, 6);
  const spots: [number, number, number][] = [[0.14, 0.2, 18], [0.86, 0.24, -18], [0.1, 0.78, 14], [0.9, 0.76, -16], [0.5, 0.1, 8], [0.52, 0.92, -10]];
  shots.forEach((shot, i) => {
    const [fx, fy, turn] = spots[i];
    const size: Vec = [W * 0.34, W * 0.34 * 9 / 16];
    layers.push({
      id: `shot-${i}`, name: `Film shot ${i + 1}`, type: 'footage', source: shot, fit: 'cover', size, threeD: true,
      masks: [{ shape: 'rect', radius: 16 * u }],
      transform: { position: keys<number[]>([0, [fx * W, fy * H, 900 * u], EASE.sine], [duration, [fx * W + (i % 2 ? -40 : 40) * u, fy * H - 20 * u, 900 * u]]), rotationY: turn, opacity: 26 },
      effects: [blurFx(8 * u + (i % 3) * 2.5 * u)],
    } as Layer);
  });
  layers.push({ id: 'world', name: 'Push', type: 'null', transform: { anchor: [0, 0], position: [safe.cx, safe.cy], scale: keys<number>([at, 100, EASE.sine], [duration, 100 + push]) } } as Layer);
  const rel = (px: number, py: number): Vec => [px - safe.cx, py - safe.cy];
  const markX = align === 'left' ? x + markSize / 2 : x;
  // The mark lands, then beats with a small pulse where beats are given (the heartbeat).
  const beats = Array.isArray(p.beats) ? (p.beats as unknown[]).filter((b): b is number => typeof b === 'number' && b > at + 0.4 && b < duration - 0.2).slice(0, 8) : [];
  const markScale: Key<number>[] = [{ t: at, v: 86, ease: EASE.out }, { t: at + 0.34, v: 100 }];
  for (const b of beats) if (b - 0.02 > markScale[markScale.length - 1].t) markScale.push({ t: round(b - 0.02), v: 100, ease: EASE.out }, { t: round(b + 0.08), v: 103.5, ease: EASE.sine }, { t: round(b + 0.4), v: 100 });
  layers.push(...markLayers(ctx, logo, name, markSize, {
    parent: 'world',
    in: Math.max(0, at - 0.02),
    motionBlur: true,
    transform: { position: rel(markX, markY), scale: { k: markScale }, opacity: keys<number>([at, 0, EASE.out], [at + 0.08, 100]) },
    effects: [blurFx(keys<number>([at, 10 * u, EASE.out], [at + 0.34, 0]))],
  }));
  const nameAt = at + 0.08;
  layers.push({
    id: 'wordmark', name: name.slice(0, 32), type: 'text', parent: 'world', in: nameAt, motionBlur: true,
    transform: { position: { k: [{ t: nameAt, v: rel(x, nameY - 40 * u), ease: EASE.out }, { t: nameAt + 0.37, v: rel(x, nameY) }] }, opacity: keys<number>([nameAt, 0, EASE.out], [nameAt + 0.2, 100]) },
    text: { text: name, font: ctx.font, size: nameSize, weight: 700, color: ink.text, align: textAlign, tracking: -2 },
    effects: [blurFx(keys<number>([nameAt, 14 * u, EASE.out], [nameAt + 0.37, 0])), ...typeFx(ctx, look)],
  } as Layer);
  if (tagline) {
    const tagWords = words(tagline);
    const given = timedWords(p.words ?? p.times, num(p, 'offset', 0));
    const times = onsetsFor(tagWords, given, tagAt, 0.08).map((o) => round(Math.max(0, o.start - 0.04)));
    layers.push({
      id: 'tagline', name: tagline.slice(0, 32), type: 'text', parent: 'world',
      transform: { position: rel(x, tagY) },
      text: {
        text: tagline, font: ctx.font, size: tagSize, weight: 500, color: ink.soft, align: textAlign, tracking: -1,
        cascade: { by: 'word', times, duration: 0.3, ease: EASE.out, from: { opacity: 0, position: [0, 18 * u], blur: 10 * u } },
      },
    } as Layer);
  }
  if (cta) {
    const k = pillH / 42;
    const pillW = estimateWidth(cta, 22 * k, -1) + 40 * k;
    const ctaX = align === 'left' ? x + pillW / 2 : x;
    const pill = pillLayers(ctx, 'cta', cta, { at: ctaAt, out: null, center: rel(ctaX, ctaY), height: pillH, variant: choice(p, 'variant', PILL_VARIANTS, 'filled'), parent: 'world', ...(click !== null ? { press: click } : {}) });
    layers.push(...pill.layers);
    if (click !== null) {
      // "You" clicks it: the arrow glides in on an arc, dips 14% on the press and rings.
      const tip = rel(ctaX + pillW * 0.18, ctaY + pillH * 0.12);
      const cs = 1.35 * u;
      layers.push({
        id: 'cursor', name: 'Cursor', type: 'shape', parent: 'world', in: click - 0.75, motionBlur: true,
        shape: { shape: 'path', points: ARROW.map((v) => v * cs), closed: true, size: [19 * cs, 29.6 * cs], fill: ink.light ? '#111111' : '#ffffff', stroke: ink.light ? '#ffffff' : '#111111', strokeWidth: 2.2 * u },
        transform: {
          anchor: [0, 0],
          position: { k: [{ t: click - 0.75, v: [tip[0] + 260 * u, tip[1] + 180 * u], ease: EASE.move, arc: -0.12 }, { t: click - 0.08, v: tip }] },
          scale: keys<number>([click - 0.04, 100, 'cubic-out'], [click + 0.05, 86, EASE.sine], [click + 0.26, 100]),
          opacity: keys<number>([click - 0.75, 0, EASE.out], [click - 0.6, 100]),
        },
        effects: [{ type: 'drop-shadow', distance: 3 * u, softness: 10 * u, opacity: 45, direction: 150, color: '#000000' }],
      } as Layer);
      // The ring: 16 → 86 px over 0.5 s, fading as it grows, flattened as it sits on the pill.
      layers.push({
        id: 'click-ring', name: 'Click ring', type: 'shape', parent: 'world', in: click, out: click + 0.55,
        shape: { shape: 'ellipse', size: [86 * u, 86 * u], fill: null, stroke: colours.accent, strokeWidth: 4 * u },
        transform: { position: tip, scale: keys<number[]>([click, [19, 10], EASE.out], [click + 0.5, [100, 55]]), opacity: keys<number>([click, 90, 'linear'], [click + 0.5, 0]) },
      } as Layer);
    }
  }
  if (url) {
    layers.push({
      id: 'url', name: url.slice(0, 32), type: 'text', parent: 'world',
      transform: { position: rel(x, urlY), opacity: keys<number>([ctaAt + 0.2, 0, EASE.out], [ctaAt + 0.5, 100]) },
      text: { text: url, font: ctx.font, size: 28 * u, weight: 500, color: ink.soft, align: textAlign, tracking: 0 },
    } as Layer);
  }
  // The last 0.5 s sinks 12% towards the stage colour.
  const bg = backdrop(ctx, look).background;
  if (bg) layers.push({ id: 'fade', name: 'Fade to stage', type: 'solid', color: bg, in: duration - 0.5, transform: { opacity: keys<number>([duration - 0.5, 0, EASE.sine], [duration, 12]) } } as Layer);
  return scene(ctx, duration, layers, {
    background: bg,
    cues: [
      { at, sound: 'glass', note: 'mark' },
      { at: nameAt, sound: 'whoosh', note: 'wordmark' },
      ...(cta ? [{ at: ctaAt, sound: 'pop' as const, note: 'call to action' }] : []),
      ...(click !== null ? [{ at: click, sound: 'click' as const, note: 'click' }] : []),
    ],
    template: template('end-card', p),
  });
}

// ───────────────────────── specs ─────────────────────────

const FOOTAGE = 'footage { asset, in? }';
const WORDS = '{ text, start, end? }[] | number[] — word times from analyze_song or the transcript (song seconds; shifted by `offset`)';
const LOOK = `${LOOK_PROSE} — the stage (brand kits pick light or stage); none overlays the footage below`;

export const KINETIC_TEMPLATES: TemplateSpec[] = [
  {
    id: 'type-on-voice',
    label: 'Type-on to the voice',
    technique: 'launch film S01',
    use: 'A line typed on the voice: each word starts on its sung or spoken onset and types at 46–66 ms a character, the centred line gliding to its new centre as it grows, a caret waiting between words. Pass the word list from analyze_song (or the transcript) and the song second the scene starts at.',
    params: {
      text: 'string (required) — the line as sung or spoken; *emphasis* is not used here',
      words: WORDS,
      offset: 'number s (0) — the song second this scene starts at',
      at: 'number s (0.3) — the first word when no word times are given; later words 0.32 s apart',
      step: 'number s 0.02–0.2 — seconds per character (default: 46–66 ms, fitted to each word)',
      accent: 'string — word(s) of the line set in the accent colour',
      look: LOOK,
      place: '"center" | "upper" | "lower" (center)',
      caret: 'boolean (true)',
      exit: '"none" | "blur" | "rise" (none)',
      size: 'number px (fits the safe area)', hold: 'number s (1.2) — held after the last key', duration: 'number s (auto)',
    },
    seconds: 3,
    fullFrame: true,
    build: (ctx, params) => typeOnVoice(ctx, params),
  },
  {
    id: 'fly-through-word',
    label: 'Fly through a word',
    technique: 'launch film S01 → S02',
    use: 'The camera plunges through a letter of a word into the next scene: the rest of the line fades, the zoom runs exp(ln 270·(0.35u + 0.65u^2.2)) over ~1 s towards the letter\'s counter, the next shot shows pixelated (36 → 1 px) inside the letters and opens through the counter to fill the frame, under a light zoom blur. With `words` the line is typed on the voice first.',
    params: {
      word: 'string (required) — the word flown through',
      line: 'string — the whole line the word sits in (default: the word alone)',
      next: `${FOOTAGE} — the next scene's shot (a colour field when absent)`,
      letter: 'number — index of the letter in the word (default: the counter letter nearest its middle)',
      words: `${WORDS}; types the line first`,
      offset: 'number s (0) — the song second this scene starts at',
      at: 'number s (0.6) — the plunge starts', zoom: 'number s 0.6–1.6 (1.0) — length of the plunge', depth: 'number 60–400 (270) — how far it zooms',
      fill: '"gradient" | "accent" | "ink" (gradient) — the word\'s own colour',
      pixelate: 'number px 1–120 (36) — the reveal\'s first block size',
      look: LOOK,
      size: 'number px (fits the safe area)', hold: 'number s (0.5) — the next shot held after', duration: 'number s (auto)',
    },
    seconds: 2.2,
    fullFrame: true,
    build: (ctx, params) => flyThroughWord(ctx, params),
  },
  {
    id: 'word-land',
    label: 'Words land grey, turn white',
    technique: 'crimson explainer: word landing',
    use: 'A title that lands word by word on the voice: each word rises 34 px, de-blurs 16 px and settles from 106%, grey at first and white 0.07–0.36 s later; emphasis words in an italic serif ~16% larger. " / " breaks a line. The kinetic headline of an explainer beat.',
    params: {
      text: 'string (required) — the words; markup *emphasis*, [accent], " / " for a new line',
      words: WORDS,
      offset: 'number s (0) — the song second this scene starts at',
      at: 'number s (0.25) — first word without word times', stagger: 'number s 0.05–2 (0.3) — spacing without word times',
      enter: '"rise" | "drop" | "slide" | "scale" (rise)',
      emphasis: '"serif" | "accent" | "bold" (serif) — how *emphasis* is set',
      align: '"center" | "left" (center)', place: '"center" | "upper" | "lower" (center)',
      look: LOOK,
      out: 'number s — the words leave (0.24 s, rising 26 px)', size: 'number px (118 at 1080p)', duration: 'number s (auto)',
    },
    seconds: 2.5,
    fullFrame: true,
    build: (ctx, params) => wordLand(ctx, params),
  },
  {
    id: 'label-pill',
    label: 'Label pill',
    technique: 'crimson explainer: label pill',
    use: 'A filled label naming what is on screen ("Bring your own AI", "18 cuts, on the beat"): the pill springs in from 78%, its words follow 0.10 s later, and it stays readable at least 0.6 s. Place it beside the thing it names with `attach`. Transparent: it overlays the shot.',
    params: {
      label: 'string (required) — 2–5 words',
      attach: '[x, y, w, h] — the thing it names, fractions of the frame; the pill sits at its `side`',
      side: '"below" | "above" | "left" | "right" (below)', gap: 'number px (38)',
      position: '[x, y] — where the pill sits instead (fractions or px); default low centre',
      variant: '"filled" | "glass" | "outline" | "light" (filled)',
      dot: 'boolean (false) — a small live dot before the words',
      at: 'number s (0.1)', out: 'number s — leaves (never before its words have held 0.6 s)', height: 'number px 24–120 (42)', duration: 'number s (auto)',
    },
    seconds: 2.2,
    fullFrame: false,
    build: (ctx, params) => labelPill(ctx, params),
  },
  {
    id: 'slam-tilt',
    label: 'Card slams in tilted',
    technique: 'crimson explainer: timeline slam',
    use: 'A card lands on a bar: scale 1.32 → 1, tilted back (rotateX 26° → 13°), de-blurring 18 px in 0.22 s, with a flash and a small shake, then dollies while it holds. For the drop that shows the product doing the work; add a title above and a label pill under.',
    params: {
      media: `${FOOTAGE} — the card's picture (a UI capture, a shot); a gradient panel when absent`,
      at: 'number s (0.35) — the bar it slams on',
      title: 'string — words above the card, landing just after the hit',
      label: 'string — a label pill under the card',
      tilt: '"settle" | "flat" | "steep" (settle)', dolly: '"left" | "right" | "in" | "none" (left)',
      flash: 'boolean (true)', shake: 'boolean (true)',
      look: LOOK, variant: '"filled" | "glass" | "outline" | "light" (filled) — the label\'s pill',
      width: 'number 0.3–0.95 (0.72) — card width, fraction of the safe area', aspect: 'number (from the media, else 16/9)', duration: 'number s (2.4)',
    },
    seconds: 2.4,
    fullFrame: true,
    build: (ctx, params) => slamTilt(ctx, params),
  },
  {
    id: 'whip-pan',
    label: 'Whip pan between shots',
    technique: 'launch film joins; crimson whips',
    use: 'A join that reads as one camera pan: the outgoing shot accelerates away 1150–1400 px while the incoming one arrives from the far side with a small turn, under a directional blur that peaks on the whip. Centre it on the cut; `frame: "card"` whips floating cards over a stage instead of full-frame shots.',
    params: {
      from: `${FOOTAGE} — the outgoing shot`, to: `${FOOTAGE} — the incoming shot`,
      direction: '"left" | "right" | "up" | "down" (left) — where the outgoing shot goes',
      at: 'number s (0.6) — the middle of the whip', duration: 'number s 0.18–0.8 (0.32) — the whip',
      blur: 'number px 0–60 (14)', tilt: 'number 0–40 (18) — degrees the incoming shot turns in',
      frame: '"full" | "card" (full)', look: LOOK,
      title: 'string — words riding in on the incoming shot', sceneDuration: 'number s (auto)',
    },
    seconds: 1.5,
    fullFrame: true,
    build: (ctx, params) => whipPan(ctx, params),
  },
  {
    id: 'match-grow',
    label: 'Match-grow cut',
    technique: 'crimson explainer: match cut',
    use: 'A small card (a parked picture-in-picture) gathers and whips forward, growing so a point inside it lands exactly on the same point of the next shot, which fades in around it in 0.10 s. Hides a hard scene change: the viewer\'s eye stays on the subject.',
    params: {
      from: `${FOOTAGE} — the small card's picture`, to: `${FOOTAGE} — the next shot`,
      fromRect: '[x, y, w, h] — where the card starts, fractions of the frame',
      anchorFrom: '[x, y] (0.5, 0.4) — the point inside the card that must land, fractions of the card',
      anchorTo: '[x, y] (0.5, 0.4) — where it lands in the next shot, fractions of the frame',
      scale: 'number % — the card\'s final size (default: as wide as the frame)',
      at: 'number s (0.3)', grow: 'number s 0.15–1.2 (0.28)', crossfade: 'number s 0.03–0.6 (0.1)',
      look: LOOK, duration: 'number s (auto)',
    },
    seconds: 1.6,
    fullFrame: true,
    build: (ctx, params) => matchGrow(ctx, params),
  },
  {
    id: 'logo-lockup',
    label: 'Logo lockup',
    technique: 'launch film S08 / S21',
    use: 'The reveal: a glow point contracts into the mark (0.86 → 1, blur 10 → 0 in 0.34 s), the wordmark lands 0.08 s later from 50 px back, the tagline lands word by word on the voice, an ember halo breathes on the beats and the whole lockup pushes in 3.5%. Uses the brand kit\'s name and logo when there is one.',
    params: {
      name: 'string — the wordmark (brand name)', logo: `${FOOTAGE} — the logo image (the brand kit's by default; a lettered tile when none)`,
      tagline: 'string — the line under it, word by word', words: WORDS, offset: 'number s (0)',
      at: 'number s (0.4) — the mark lands (put it on the word)', layout: '"side" | "stacked" (side; stacked in tall frames)',
      look: LOOK, halo: 'boolean (true)', beats: 'number[] — scene seconds the halo breathes on (every bar at 99 BPM)',
      push: 'number % 0–12 (3.5)', flood: 'boolean (false) — ends in a light flood into the next scene', duration: 'number s (auto)',
    },
    seconds: 3.2,
    fullFrame: true,
    build: (ctx, params) => logoLockup(ctx, params),
  },
  {
    id: 'end-card',
    label: 'End card',
    technique: 'launch film S23; crimson end card',
    use: 'The last card: mark and wordmark, the tagline 0.36 s later, a call-to-action pill 0.70 s later that a cursor clicks, an address under it, the film\'s own shots drifting far behind (26%, defocused), a 4.5% push and the mark beating on the song. It always holds at least 1.5 s after the last thing lands.',
    params: {
      name: 'string — the wordmark (brand name)', logo: `${FOOTAGE} — the logo image (the brand kit's by default)`,
      tagline: 'string', cta: 'string — the call to action ("Try it free")', url: 'string — an address or handle under it',
      backdrop: 'footage[] — up to 6 of the film\'s own shots drifting behind',
      beats: 'number[] — scene seconds the mark pulses on', click: 'boolean (true) — a cursor clicks the call to action',
      words: WORDS, offset: 'number s (0)',
      layout: '"center" | "left" (center)', look: LOOK, variant: '"filled" | "glass" | "outline" | "light" (filled)',
      at: 'number s (0.2)', hold: 'number s (2.2) — held after the last landing, at least 1.5', push: 'number % 0–12 (4.5)', duration: 'number s (auto, never shorter than the hold)',
    },
    seconds: 4.5,
    fullFrame: true,
    build: (ctx, params) => endCard(ctx, params),
  },
];
