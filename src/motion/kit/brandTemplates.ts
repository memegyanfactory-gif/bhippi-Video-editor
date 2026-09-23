// Brand templates: scenes built directly from the active brand kit's guideline. Every element sits
// in a guideline layout zone, is set in the guideline's type scale, and moves by the guideline's
// frame-by-frame keys (src/lib/brandKit/guideline.ts) — so the video is the guideline, not a
// house template recoloured.
import { layoutFor, stateAt, zoneRect } from '../../lib/brandKit/guideline';
import { motionBrandFromKit, toEase, type MotionBrand } from '../../lib/brandKit/motionBrand';
import { newBrandKit } from '../../lib/brandKit/build';
import type { BrandMove, FrameState, LayoutZone, MoveElement, TypeStep } from '../../lib/brandKit/types';
import type { Ease, Effect, Key, Layer, MotionScene, TextLayerData, Vec } from '../types';
import type { KitContext } from './common';
import type { TemplateSpec } from './index';

let house: MotionBrand | null = null;
/** The brand in the context, or the house kit when no kit is active. */
export function brandOf(ctx: KitContext): MotionBrand {
  if (ctx.brand) return ctx.brand;
  house ??= motionBrandFromKit(newBrandKit());
  return house;
}

const unit = (ctx: KitContext) => Math.min(ctx.width, ctx.height) / 1080;
const move = (b: MotionBrand, id: string): BrandMove | undefined => b.guideline.moves.find((m) => m.id === id);
const element = (b: MotionBrand, moveId: string, role: MoveElement['role'], index = 0): MoveElement | undefined => move(b, moveId)?.elements.filter((e) => e.role === role)[index];
const step = (b: MotionBrand, role: TypeStep['role']): TypeStep => b.guideline.typeScale.find((s) => s.role === role) ?? b.guideline.typeScale[0];
const lum = (hex: string) => {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return 0;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const onColour = (bg: string, b: MotionBrand) => (lum(bg) > 0.4 ? (lum(b.colors.text) < 0.3 ? b.colors.text : '#0a0a0a') : lum(b.colors.text) > 0.6 ? b.colors.text : '#ffffff');
const cased = (text: string, transform: string) => (transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text);

/** One element of a move played at scene second `at`. */
type Segment = { element: MoveElement | undefined; at: number; fps: number };

/** The keys of every animated property across segments, in scene seconds. */
function realize(segments: Segment[], b: MotionBrand) {
  const props: (keyof FrameState)[] = ['opacity', 'x', 'y', 'scale', 'rotate', 'blur', 'clip'];
  const out: Partial<Record<keyof FrameState, Key<number>[]>> = {};
  for (const { element: e, at, fps } of segments) {
    if (!e) continue;
    const firstEase = e.keys.find((k) => k.ease)?.ease;
    for (const prop of props) {
      const withProp = e.keys.filter((k) => k.state[prop] !== undefined).sort((a, c) => a.frame - c.frame);
      if (!withProp.length) continue;
      const list = (out[prop] ??= []);
      for (const k of withProp) list.push({ t: at + k.frame / fps, v: k.state[prop]!, ease: toEase(k.ease ?? firstEase, b.ease) as Ease });
    }
  }
  for (const list of Object.values(out)) list?.sort((a, c) => a.t - c.t);
  return out;
}

/** Position keys: rest `base` plus the guideline's x/y offsets (1080p px scaled by `u`). */
function positionKeys(segments: Segment[], b: MotionBrand, base: Vec, u: number): Key<Vec>[] | null {
  const frames: { t: number; x: number; y: number; ease: Ease }[] = [];
  for (const { element: e, at, fps } of segments) {
    if (!e) continue;
    const firstEase = e.keys.find((k) => k.ease)?.ease;
    for (const k of e.keys.filter((key) => key.state.x !== undefined || key.state.y !== undefined)) {
      const s = stateAt(e, k.frame);
      frames.push({ t: at + k.frame / fps, x: k.state.x ?? s.x, y: k.state.y ?? s.y, ease: toEase(k.ease ?? firstEase, b.ease) });
    }
  }
  if (!frames.length) return null;
  return frames.sort((a, c) => a.t - c.t).map((f) => ({ t: f.t, v: [base[0] + f.x * u, base[1] + f.y * u], ease: f.ease }));
}

/**
 * A layer animated by guideline segments. Shapes reveal (`clip`) by scaling from their leading edge;
 * text reveals by its typewriter `reveal`. Blur becomes a gaussian blur effect.
 */
function animate<L extends Layer>(layer: L, segments: Segment[], b: MotionBrand, base: Vec, u: number, size?: Vec): L {
  const k = realize(segments, b);
  const transform: NonNullable<Layer['transform']> = { ...(layer.transform ?? {}), position: base };
  const pos = positionKeys(segments, b, base, u);
  if (pos) transform.position = { k: pos };
  if (k.opacity) transform.opacity = { k: k.opacity.map((key) => ({ ...key, v: key.v * 100 })) };
  if (k.rotate) transform.rotation = { k: k.rotate };
  const effects: Effect[] = [...(layer.effects ?? [])];
  if (k.blur?.some((key) => key.v > 0)) effects.push({ type: 'gaussian-blur', blurriness: { k: k.blur.map((key) => ({ ...key, v: key.v * u })) } } as Effect);
  const out = { ...layer, transform, effects } as L;
  if (k.clip && layer.type === 'text') {
    (out as Extract<Layer, { type: 'text' }>).text = { ...(layer as Extract<Layer, { type: 'text' }>).text, reveal: { k: k.clip } };
  }
  if (layer.type === 'shape' && k.clip && size) {
    // Reveal from the leading (left) edge: anchor there and scale x with the clip.
    transform.anchor = [0, size[1] / 2];
    if (pos) transform.position = { k: pos.map((key) => ({ ...key, v: [key.v[0] - size[0] / 2, key.v[1]] })) };
    else transform.position = [base[0] - size[0] / 2, base[1]];
    const scale = k.scale ?? [{ t: k.clip[0].t, v: 1 }];
    const times = [...new Set([...k.clip.map((key) => key.t), ...scale.map((key) => key.t)])].sort((a, c) => a - c);
    const at = (list: Key<number>[], t: number) => {
      const i = list.findIndex((key) => key.t >= t);
      if (i <= 0) return list[Math.max(0, i)].v;
      return list[i].t === t ? list[i].v : list[i - 1].v + (list[i].v - list[i - 1].v) * ((t - list[i - 1].t) / (list[i].t - list[i - 1].t));
    };
    transform.scale = { k: times.map((t) => ({ t, v: [Math.max(0.001, at(k.clip!, t)) * at(scale, t) * 100, at(scale, t) * 100], ease: (k.clip!.find((key) => key.t === t)?.ease ?? b.ease) as Ease })) };
  } else if (k.scale) transform.scale = { k: k.scale.map((key) => ({ ...key, v: key.v * 100 })) };
  return out;
}

/** Text in a type-scale step, fitted to its zone's width. */
function textLayer(id: string, text: string, zone: LayoutZone, st: TypeStep, ctx: KitContext, extra: Partial<TextLayerData> = {}): { layer: Extract<Layer, { type: 'text' }>; base: Vec; rect: ReturnType<typeof zoneRect> } {
  const u = unit(ctx);
  const rect = zoneRect(zone, ctx.width, ctx.height);
  const value = cased(text, st.transform);
  // Phones are held close: display and heading type read bigger on a portrait canvas.
  let size = st.size * u * (ctx.height > ctx.width && (st.role === 'display' || st.role === 'heading') ? 1.2 : 1);
  // Longest line must fit the zone within its max words per line.
  const words = value.split(/\s+/).filter(Boolean);
  const lines = Math.max(1, Math.ceil(words.length / Math.max(1, st.maxWordsPerLine)));
  const perLine = Math.ceil(value.length / lines);
  const estWidth = perLine * size * 0.56;
  if (estWidth > rect.w) size = Math.max(st.size * u * 0.45, size * (rect.w / estWidth));
  const x = zone.align === 'left' ? rect.x : zone.align === 'right' ? rect.x + rect.w : rect.x + rect.w / 2;
  const base: Vec = [x, rect.y + rect.h / 2];
  return {
    base,
    rect,
    layer: {
      id,
      name: text.slice(0, 32),
      type: 'text',
      text: { text: value, font: st.family, weight: st.weight, size, color: st.color, align: zone.align, tracking: st.tracking, lineHeight: st.lineHeight, box: rect.w, ...extra },
    },
  };
}

const rectShape = (id: string, rect: { w: number; h: number }, fill: string, radius = 0, extra: Partial<Layer> = {}): Extract<Layer, { type: 'shape' }> =>
  ({ id, name: id, type: 'shape', shape: { shape: 'rect', size: [rect.w, rect.h], radius, fill }, ...extra }) as Extract<Layer, { type: 'shape' }>;

/** The brand stage: full-frame gradient with the guideline's slow drift. */
function stageLayer(ctx: KitContext, b: MotionBrand, duration: number): Layer {
  const drift = element(b, 'background-drift', 'background');
  const layer: Layer = { id: 'brand-stage', name: 'Brand stage', type: 'shape', shape: { shape: 'rect', size: [ctx.width * 1.12, ctx.height * 1.12], gradient: { kind: 'linear', stops: b.gradient.map((c, i, all) => [i / Math.max(1, all.length - 1), c] as [number, string]), from: [0, 0], to: [ctx.width * 0.4, ctx.height * 1.12] } } };
  const fit = drift ? { ...drift, keys: drift.keys.map((k) => ({ ...k, frame: Math.min(k.frame, Math.round(duration * 30)) })) } : undefined;
  return animate(layer, [{ element: fit, at: 0, fps: 30 }], b, [ctx.width / 2, ctx.height / 2], unit(ctx));
}

const zoneOf = (spec: ReturnType<typeof layoutFor>, role: string, index = 0) => spec?.zones.filter((z) => z.role === role)[index];
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function scene(ctx: KitContext, duration: number, layers: Layer[], b: MotionBrand, background?: string | null): MotionScene {
  return { version: 1, width: ctx.width, height: ctx.height, duration, layers, motionBlur: { samples: 8, shutter: 180 }, ...(background ? { background } : {}), brand: { kitId: b.kitId, name: b.name, snapshot: b } };
}

/** A headline: one element's move for 1–2 words, the word cascade for more (transcript times win). */
function headlineLayer(id: string, text: string, zone: LayoutZone, st: TypeStep, ctx: KitContext, b: MotionBrand, at: number, outAt: number | null, opts: { accentWord?: string; times?: number[]; accentColour?: string } = {}): Layer {
  const u = unit(ctx);
  const accent = opts.accentWord?.toLowerCase();
  const list = words(text);
  const spans = accent && list.some((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === accent.replace(/[^\p{L}\p{N}]/gu, ''))
    ? list.map((w, i) => ({ text: cased(w, st.transform) + (i < list.length - 1 ? ' ' : ''), ...(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === accent.replace(/[^\p{L}\p{N}]/gu, '') ? { color: opts.accentColour ?? b.colors.accent } : {}) }))
    : undefined;
  const built = textLayer(id, text, zone, st, ctx, spans ? { spans, text: undefined } : {});
  const titleIn = element(b, 'title-in', 'headline');
  const titleOut = element(b, 'title-out', 'headline');
  if (list.length > 2 || opts.times) {
    const w = element(b, 'word-cascade', 'headline');
    const first = w?.keys[0]?.state ?? { y: b.distance, blur: b.blur, scale: 0.96 };
    const out = titleOut?.keys[titleOut.keys.length - 1]?.state ?? { y: -b.distance / 2, blur: b.blur };
    built.layer.text.cascade = {
      by: 'word',
      ...(opts.times ? { times: opts.times } : { delay: at, stagger: b.wordStagger }),
      duration: b.enter,
      ease: b.ease,
      from: { opacity: 0, blur: (first.blur ?? 0) * u, position: [(first.x ?? 0) * u, (first.y ?? 0) * u], scale: (first.scale ?? 1) * 100 },
      ...(outAt !== null ? { exit: { at: outAt, duration: b.exit, stagger: 0.02, ease: b.easeIn, to: { opacity: 0, blur: (out.blur ?? 0) * u, position: [(out.x ?? 0) * u, (out.y ?? 0) * u] } } } : {}),
    };
    return { ...built.layer, transform: { position: built.base } };
  }
  return animate(built.layer, [{ element: titleIn, at, fps: 30 }, ...(outAt !== null ? [{ element: titleOut, at: outAt, fps: 30 }] : [])], b, built.base, u);
}

// ── templates ────────────────────────────────────────────────────────────────

function brandTitle(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'title', ctx.width, ctx.height);
  const title = str(p.title, b.name);
  const background = str(p.background, 'gradient');
  const titleIn = move(b, 'title-in');
  const inLength = (titleIn?.frames ?? 30) / 30;
  const duration = num(p.duration, inLength + b.hold + b.exit + 0.3);
  const outAt = p.exit === false ? null : duration - b.exit - 0.05;
  const layers: Layer[] = [];
  if (background !== 'none') layers.push(stageLayer(ctx, b, duration));
  const kickerZone = zoneOf(spec, 'kicker');
  if (kickerZone && typeof p.kicker === 'string' && p.kicker) {
    const k = textLayer('kicker', p.kicker, kickerZone, step(b, 'label'), ctx);
    layers.push(animate(k.layer, [{ element: element(b, 'title-in', 'kicker'), at: 0, fps: 30 }, ...(outAt !== null ? [{ element: element(b, 'title-out', 'subhead'), at: outAt, fps: 30 }] : [])], b, k.base, u));
  }
  const headZone = zoneOf(spec, 'headline');
  if (headZone) layers.push(headlineLayer('headline', title, headZone, step(b, 'display'), ctx, b, (element(b, 'title-in', 'headline')?.keys[0]?.frame ?? 0) / 30, outAt, { accentWord: str(p.accentWord) || undefined, times: Array.isArray(p.times) ? (p.times as number[]) : undefined }));
  const barZone = zoneOf(spec, 'accent-bar');
  if (barZone && p.accentBar !== false) {
    const r = zoneRect(barZone, ctx.width, ctx.height);
    layers.push(animate(rectShape('accent-bar', r, b.colors.accent, r.h / 2), [{ element: element(b, 'title-in', 'accent-bar'), at: 0, fps: 30 }, ...(outAt !== null ? [{ element: element(b, 'title-out', 'accent-bar'), at: outAt, fps: 30 }] : [])], b, [r.x + r.w / 2, r.y + r.h / 2], u, [r.w, r.h]));
  }
  const subZone = zoneOf(spec, 'subhead');
  if (subZone && typeof p.subtitle === 'string' && p.subtitle) {
    const s = textLayer('subhead', p.subtitle, subZone, step(b, 'subhead'), ctx);
    layers.push(animate(s.layer, [{ element: element(b, 'title-in', 'subhead'), at: 0, fps: 30 }, ...(outAt !== null ? [{ element: element(b, 'title-out', 'subhead'), at: outAt, fps: 30 }] : [])], b, s.base, u));
  }
  return scene(ctx, duration, layers, b);
}

function brandLowerThird(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'lower-third', ctx.width, ctx.height);
  const duration = num(p.duration, Math.max(3, b.hold * 1.5 + b.enter + b.exit));
  const outAt = duration - (move(b, 'lower-third-out')?.frames ?? 12) / 30 - 0.05;
  const layers: Layer[] = [];
  const panelZone = zoneOf(spec, 'panel');
  if (panelZone) {
    const r = zoneRect(panelZone, ctx.width, ctx.height);
    layers.push(animate(rectShape('panel', r, `${b.colors.surface}eb`, b.radius * Math.min(ctx.width, ctx.height) * 0.6, { effects: [{ type: 'drop-shadow', distance: 10 * u, softness: 30 * u, opacity: 35, direction: 180, color: '#000000' } as Effect] }), [{ element: element(b, 'lower-third-in', 'panel'), at: 0, fps: 30 }, { element: element(b, 'lower-third-out', 'panel'), at: outAt, fps: 30 }], b, [r.x + r.w / 2, r.y + r.h / 2], u, [r.w, r.h]));
  }
  const barZone = zoneOf(spec, 'accent-bar');
  if (barZone) {
    const r = zoneRect(barZone, ctx.width, ctx.height);
    layers.push(animate(rectShape('accent-bar', r, b.colors.accent), [{ element: element(b, 'lower-third-in', 'accent-bar'), at: 0, fps: 30 }, { element: element(b, 'lower-third-out', 'panel'), at: outAt, fps: 30 }], b, [r.x + r.w / 2, r.y + r.h / 2], u, [r.w, r.h]));
  }
  const nameZone = zoneOf(spec, 'headline');
  if (nameZone) {
    const n = textLayer('name', str(p.name, str(p.title, 'Name')), nameZone, step(b, 'heading'), ctx);
    layers.push(animate(n.layer, [{ element: element(b, 'lower-third-in', 'headline'), at: 0, fps: 30 }, { element: element(b, 'lower-third-out', 'headline'), at: outAt, fps: 30 }], b, n.base, u));
  }
  const roleZone = zoneOf(spec, 'subhead');
  if (roleZone && (p.role || p.subtitle)) {
    const r = textLayer('role', str(p.role, str(p.subtitle)), roleZone, { ...step(b, 'label'), color: b.colors.muted }, ctx);
    layers.push(animate(r.layer, [{ element: element(b, 'lower-third-in', 'subhead'), at: 0, fps: 30 }, { element: element(b, 'lower-third-out', 'subhead'), at: outAt, fps: 30 }], b, r.base, u));
  }
  return scene(ctx, duration, layers, b);
}

function brandStat(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'stat', ctx.width, ctx.height);
  const value = num(p.value, 100);
  const duration = num(p.duration, 1.2 + b.hold + b.exit + 0.6);
  const outAt = duration - b.exit - 0.05;
  const layers: Layer[] = [];
  if (str(p.background, 'gradient') !== 'none') layers.push(stageLayer(ctx, b, duration));
  const numberZone = zoneOf(spec, 'number');
  if (numberZone) {
    const format = `${str(p.prefix)}{n}${str(p.suffix)}`;
    const n = textLayer('number', format.replace('{n}', String(value)), numberZone, { ...step(b, 'display'), size: step(b, 'display').size * 1.5, color: p.accentNumber === false ? b.colors.text : b.colors.accent }, ctx, {
      counter: { value: { k: [{ t: 0, v: 0, ease: b.ease }, { t: 1.2, v: value }] }, decimals: num(p.decimals, Number.isInteger(value) ? 0 : 1), format, separator: str(p.separator, ',') },
    });
    layers.push(animate(n.layer, [{ element: element(b, 'stat-count', 'number'), at: 0, fps: 30 }, { element: element(b, 'title-out', 'headline'), at: outAt, fps: 30 }], b, n.base, u));
  }
  const barZone = zoneOf(spec, 'accent-bar');
  if (barZone) {
    const r = zoneRect(barZone, ctx.width, ctx.height);
    layers.push(animate(rectShape('accent-bar', r, b.colors.accent, r.h / 2), [{ element: element(b, 'stat-count', 'accent-bar'), at: 0, fps: 30 }, { element: element(b, 'title-out', 'accent-bar'), at: outAt, fps: 30 }], b, [r.x + r.w / 2, r.y + r.h / 2], u, [r.w, r.h]));
  }
  const labelZone = zoneOf(spec, 'label');
  if (labelZone && p.label) {
    const l = textLayer('label', str(p.label), labelZone, step(b, 'subhead'), ctx);
    layers.push(animate(l.layer, [{ element: element(b, 'stat-count', 'label'), at: 0, fps: 30 }, { element: element(b, 'title-out', 'subhead'), at: outAt, fps: 30 }], b, l.base, u));
  }
  return scene(ctx, duration, layers, b);
}

function brandPanel(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'split', ctx.width, ctx.height);
  const points = Array.isArray(p.points) ? (p.points as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  const duration = num(p.duration, b.enter + b.stagger * (points.length + 2) + b.hold * 2 + b.exit);
  const outAt = duration - b.exit - 0.05;
  const mirror = p.side === 'right';
  const flip = (z: LayoutZone | undefined): LayoutZone | undefined => (z && mirror ? { ...z, x: 1 - z.x - z.w } : z);
  const layers: Layer[] = [];
  const panelZone = flip(zoneOf(spec, 'panel'));
  if (panelZone) {
    const r = zoneRect(panelZone, ctx.width, ctx.height);
    layers.push(animate(rectShape('panel', r, `${b.colors.surface}f0`, b.radius * Math.min(ctx.width, ctx.height)), [{ element: element(b, 'lower-third-in', 'panel'), at: 0, fps: 30 }, { element: element(b, 'lower-third-out', 'panel'), at: outAt, fps: 30 }], b, [r.x + r.w / 2, r.y + r.h / 2], u, [r.w, r.h]));
  }
  const titleZone = flip(zoneOf(spec, 'headline'));
  if (titleZone) {
    const t = textLayer('panel-title', str(p.title, 'Title'), titleZone, step(b, 'heading'), ctx);
    layers.push(animate(t.layer, [{ element: element(b, 'lower-third-in', 'headline'), at: 0, fps: 30 }, { element: element(b, 'title-out', 'headline'), at: outAt, fps: 30 }], b, t.base, u));
  }
  const bodyZone = flip(zoneOf(spec, 'body'));
  if (bodyZone && points.length) {
    const lineH = bodyZone.h / Math.max(points.length, 3);
    points.forEach((point, i) => {
      const z: LayoutZone = { ...bodyZone, y: bodyZone.y + i * lineH, h: lineH };
      const t = textLayer(`point-${i + 1}`, point, z, step(b, 'body'), ctx);
      layers.push(animate(t.layer, [{ element: element(b, 'title-in', 'subhead'), at: b.stagger * (i + 2), fps: 30 }, { element: element(b, 'title-out', 'subhead'), at: outAt, fps: 30 }], b, t.base, u));
      const dot = zoneRect({ ...z, x: z.x - 0.018, w: 0.008, h: 0.008 * (ctx.width / ctx.height), y: z.y + z.h / 2 - 0.004 }, ctx.width, ctx.height);
      layers.push(animate({ id: `point-dot-${i + 1}`, name: 'Bullet', type: 'shape', shape: { shape: 'ellipse', size: [dot.w, dot.w], fill: b.colors.accent } } as Layer, [{ element: element(b, 'title-in', 'subhead'), at: b.stagger * (i + 2), fps: 30 }, { element: element(b, 'title-out', 'subhead'), at: outAt, fps: 30 }], b, [dot.x + dot.w / 2, t.base[1]], u));
    });
  }
  return scene(ctx, duration, layers, b);
}

function brandLogoSting(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'end-card', ctx.width, ctx.height);
  const sting = move(b, 'logo-sting');
  const duration = num(p.duration, (sting?.frames ?? 40) / 30 + 1.2);
  const layers: Layer[] = [animate(stageLayer(ctx, b, duration), [{ element: element(b, 'logo-sting', 'background'), at: 0, fps: 30 }], b, [ctx.width / 2, ctx.height / 2], u)];
  const logoZone = zoneOf(spec, 'logo');
  const headZone = zoneOf(spec, 'headline');
  const asset = str(p.logo) || b.logoAsset;
  if (asset && logoZone) {
    const r = zoneRect({ ...logoZone, y: 0.34, h: 0.2, x: 0.5 - 0.15, w: 0.3 }, ctx.width, ctx.height);
    layers.push(animate({ id: 'logo', name: 'Logo', type: 'footage', source: { asset, kind: 'image' }, fit: 'contain', size: [r.w, r.h] } as Layer, [{ element: element(b, 'logo-sting', 'logo'), at: 0, fps: 30 }], b, [r.x + r.w / 2, r.y + r.h / 2], u));
  }
  if (headZone) {
    const word = textLayer('wordmark', str(p.name, b.name), { ...headZone, y: asset ? 0.56 : headZone.y }, step(b, 'display'), ctx);
    layers.push(animate(word.layer, [{ element: element(b, 'logo-sting', 'headline'), at: 0, fps: 30 }], b, word.base, u));
  }
  const tagline = str(p.tagline, b.tagline);
  if (tagline && headZone) {
    const t = textLayer('tagline', tagline, { ...headZone, y: (asset ? 0.56 : headZone.y) + headZone.h + 0.02, h: 0.06 }, step(b, 'subhead'), ctx);
    layers.push(animate(t.layer, [{ element: element(b, 'logo-sting', 'subhead'), at: 0, fps: 30 }], b, t.base, u));
  }
  return scene(ctx, duration, layers, b);
}

function brandEndCard(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const u = unit(ctx);
  const spec = layoutFor(b.guideline, 'end-card', ctx.width, ctx.height);
  const card = move(b, 'end-card');
  const duration = num(p.duration, (card?.frames ?? 40) / 30 + 2.5);
  const layers: Layer[] = [stageLayer(ctx, b, duration)];
  const headZone = zoneOf(spec, 'headline');
  if (headZone) layers.push(headlineLayer('headline', str(p.headline, str(p.title, 'Thanks for watching')), headZone, step(b, 'heading'), ctx, b, (element(b, 'end-card', 'headline')?.keys[0]?.frame ?? 4) / 30, null, { accentWord: str(p.accentWord) || undefined }));
  const ctaZone = zoneOf(spec, 'cta');
  if (ctaZone) {
    const r = zoneRect(ctaZone, ctx.width, ctx.height);
    const seg = [{ element: element(b, 'end-card', 'cta'), at: 0, fps: 30 }];
    layers.push(animate(rectShape('cta-pill', r, b.colors.accent, r.h / 2), seg, b, [r.x + r.w / 2, r.y + r.h / 2], u));
    const t = textLayer('cta', str(p.cta, 'Subscribe'), { ...ctaZone, align: 'center' }, { ...step(b, 'label'), color: onColour(b.colors.accent, b), size: step(b, 'label').size * 1.3 }, ctx);
    layers.push(animate(t.layer, seg, b, t.base, u));
  }
  const logoZone = zoneOf(spec, 'logo');
  if (logoZone) {
    const r = zoneRect(logoZone, ctx.width, ctx.height);
    const seg = [{ element: element(b, 'end-card', 'logo'), at: 0, fps: 30 }];
    if (b.logoAsset) layers.push(animate({ id: 'logo', name: 'Logo', type: 'footage', source: { asset: b.logoAsset, kind: 'image' }, fit: 'contain', size: [r.w, r.h] } as Layer, seg, b, [r.x + r.w / 2, r.y + r.h / 2], u));
    else {
      const t = textLayer('wordmark', str(p.handle, b.name), logoZone, { ...step(b, 'label'), color: b.colors.text }, ctx);
      layers.push(animate(t.layer, seg, b, t.base, u));
    }
  }
  return scene(ctx, duration, layers, b);
}

function brandTransition(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const b = brandOf(ctx);
  const T = Math.max(0.35, (move(b, 'transition')?.frames ?? 14) / 30);
  const duration = num(p.duration, T + 0.1);
  const W = ctx.width;
  const H = ctx.height;
  const sweep = (id: string, colour: string, delay: number): Layer => ({
    id, name: id, type: 'shape', shape: { shape: 'rect', size: [W * 1.3, H * 1.4], fill: colour },
    transform: { rotation: -8, position: { k: [{ t: delay, v: [-W * 0.75, H / 2], ease: b.ease }, { t: delay + T * 0.5, v: [W / 2, H / 2], ease: b.easeIn }, { t: delay + T, v: [W * 1.75, H / 2] }] } },
  } as Layer);
  return { ...scene(ctx, duration, [sweep('wipe-surface', b.colors.surface, 0.06), sweep('wipe-accent', b.colors.accent, 0)], b), cues: [{ at: 0, sound: 'whoosh' }] };
}

const P = {
  background: '"gradient" (brand gradient stage, default) | "none" (overlay on the footage)',
  duration: 'number s (from the guideline timing)',
};

/** Records the template id and params on the scene so it can be rebuilt with new words (update_motion_scene, the inspector). */
const recorded = (id: string, build: (ctx: KitContext, p: Record<string, unknown>) => MotionScene) => (ctx: KitContext, p: Record<string, unknown>): MotionScene => ({ ...build(ctx, p), template: { id, params: p } });

export const BRAND_TEMPLATES: TemplateSpec[] = [
  { id: 'brand-title', label: 'Brand title', technique: 'brand guideline: title-in / word-cascade / title-out', use: 'Hooks, chapter and section titles, quotes — built from the active brand kit guideline (layout zones, type scale, frame-by-frame moves). The first choice whenever a brand kit is active.', params: { title: 'string', kicker: 'string — small label above', subtitle: 'string', accentWord: 'string — the word set in the accent colour', times: 'number[] — scene seconds each headline word lands (transcript)', exit: 'boolean (true)', accentBar: 'boolean (true)', ...P }, seconds: 3, fullFrame: true, build: recorded('brand-title', brandTitle) },
  { id: 'brand-lower-third', label: 'Brand lower third', technique: 'brand guideline: lower-third-in / out', use: 'A name and role (or a source) over the talking shot, in the brand lower-third zone.', params: { name: 'string', role: 'string', duration: P.duration }, seconds: 4, fullFrame: false, build: recorded('brand-lower-third', brandLowerThird) },
  { id: 'brand-stat', label: 'Brand stat', technique: 'brand guideline: stat-count', use: 'One real number that counts up, with its label.', params: { value: 'number', prefix: 'string', suffix: 'string (e.g. "%")', decimals: 'number', label: 'string', accentNumber: 'boolean (true)', ...P }, seconds: 3.5, fullFrame: true, build: recorded('brand-stat', brandStat) },
  { id: 'brand-panel', label: 'Brand panel', technique: 'brand guideline: split layout', use: 'Title and up to 5 points on a brand panel beside the presenter (reframe the footage to the other side with layout_clip).', params: { title: 'string', points: 'string[] (≤5)', side: '"left" (default) | "right"', duration: P.duration }, seconds: 6, fullFrame: false, build: recorded('brand-panel', brandPanel) },
  { id: 'brand-logo-sting', label: 'Brand logo sting', technique: 'brand guideline: logo-sting', use: 'Intro / outro ident with the brand logo (or wordmark) and tagline.', params: { name: 'string (brand name)', tagline: 'string', logo: 'asset id (defaults to the kit logo)', duration: P.duration }, seconds: 2.5, fullFrame: true, build: recorded('brand-logo-sting', brandLogoSting) },
  { id: 'brand-end-card', label: 'Brand end card', technique: 'brand guideline: end-card', use: 'The last seconds: headline, call to action, logo.', params: { headline: 'string', cta: 'string', accentWord: 'string', handle: 'string (shown when the kit has no logo file)', duration: P.duration }, seconds: 4, fullFrame: true, build: recorded('brand-end-card', brandEndCard) },
  { id: 'brand-transition', label: 'Brand transition', technique: 'brand guideline: transition', use: 'A brand-colour wipe to cover a cut between beats; place it centred on the cut.', params: { duration: P.duration }, seconds: 0.6, fullFrame: false, build: recorded('brand-transition', brandTransition) },
];

/** Every move of the guideline as a small scene, for previews and the Motion Lab. */
export function guidelinePreview(ctx: KitContext): MotionScene {
  const b = brandOf(ctx);
  return brandTitle(ctx, { title: b.name, kicker: 'BRAND', subtitle: b.tagline || b.guideline.summary.split('.')[0], accentWord: words(b.name)[0] });
}
