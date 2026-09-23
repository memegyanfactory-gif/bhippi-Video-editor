// Stage templates (T9–T14 of docs/MOTION-DESIGN-MASTER-PLAN.md): full-frame teaching graphics on
// the crimson stage — the hex chapter roadmap, the glass teaching card, the ribbon title, the
// numbered lanes, the diamond list beside a PiP and the node tree. Every builder speaks the
// reference's motion grammar: blur + slide/scale + fade on expo-out (back-out for pops), staggered
// 60–120 ms, exits faster on expo-in, 3D camera moves for the fly-ins, and it scales with the
// canvas (`unit`) with a portrait layout when the frame is taller than wide.
import { ease as easeAt, keys } from '../anim';
import type { Ease, Effect, FootageSource, Layer, MotionScene, TextCascade, Vec } from '../types';
import { blurFx, glowFx, pal, scene, shadowFx, stage, unit, type KitContext } from './common';
import type { TemplateSpec } from './index';

// ───────────────────────── param readers ─────────────────────────

const str = (value: unknown, fallback: string): string => (typeof value === 'string' && value.trim() ? value : fallback);
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const list = <T>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) && value.length ? (value as T[]) : fallback);
const optIndex = (value: unknown, count: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(count - 1, Math.round(value)));
};
const footageOf = (value: unknown): FootageSource | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as FootageSource;
  return source.asset || source.path ? source : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ───────────────────────── motion vocabulary ─────────────────────────

/** Opacity that fades in at `at` (fast, 60 % of `dur`), holds and optionally fades out. */
function fade(at: number, dur = 0.45, outAt: number | null = null, outDur = 0.28, rest = 100, from = 0): { k: { t: number; v: number; ease?: Ease }[] } {
  const k: { t: number; v: number; ease?: Ease }[] = [{ t: at, v: from, ease: 'expo-out' }, { t: at + dur * 0.6, v: rest }];
  if (outAt !== null && outAt > at + dur * 0.6) k.push({ t: outAt, v: rest, ease: 'expo-in' }, { t: outAt + outDur, v: 0 });
  return { k };
}

/** A gaussian-blur effect that pulls into focus at `at` and optionally blurs away at `outAt`. */
function focusFx(at: number, amount: number, dur = 0.55, outAt: number | null = null, outDur = 0.28): Effect {
  const k: { t: number; v: number; ease?: Ease }[] = [{ t: at, v: amount, ease: 'expo-out' }, { t: at + dur, v: 0 }];
  if (outAt !== null && outAt > at + dur) k.push({ t: outAt, v: 0, ease: 'expo-in' }, { t: outAt + outDur, v: amount });
  return blurFx({ k });
}

type TextOpts = {
  at: number;
  size: number;
  position: Vec;
  align?: 'left' | 'center' | 'right';
  color?: string;
  weight?: number;
  by?: 'char' | 'word' | 'line';
  stagger?: number;
  duration?: number;
  times?: number[];
  /** Entrance deltas (px). */
  dx?: number;
  dy?: number;
  blur?: number;
  scale?: number;
  out?: number | null;
  outDuration?: number;
  glow?: number;
  box?: number;
  tracking?: number;
  lineHeight?: number;
  dimTo?: number;
  opacity?: Prop100;
  parent?: string;
  threeD?: boolean;
  motionBlur?: boolean;
  name?: string;
};
type Prop100 = number | { k: { t: number; v: number; ease?: Ease }[] };

/** A text layer with a per-unit cascade entrance (blur + slide + fade, expo-out) and a faster exit. */
function text(id: string, value: string, ctx: KitContext, o: TextOpts): Layer {
  const u = unit(ctx);
  const out = o.out ?? null;
  return {
    id,
    name: o.name ?? value.slice(0, 32),
    type: 'text',
    in: Math.max(0, o.at - 0.05),
    ...(out !== null ? { out: out + (o.outDuration ?? 0.35) + 0.4 } : {}),
    ...(o.parent ? { parent: o.parent } : {}),
    ...(o.threeD ? { threeD: true } : {}),
    ...(o.motionBlur ? { motionBlur: true } : {}),
    transform: { position: o.position, ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) },
    text: {
      text: value,
      font: ctx.font,
      size: o.size,
      weight: o.weight ?? 700,
      color: o.color ?? '#ffffff',
      align: o.align ?? 'left',
      tracking: o.tracking ?? -1,
      lineHeight: o.lineHeight ?? 1.08,
      ...(o.box ? { box: o.box } : {}),
      cascade: {
        by: o.by ?? 'word',
        ...(o.times ? { times: o.times } : {}),
        delay: o.at,
        stagger: o.stagger ?? 0.08,
        duration: o.duration ?? 0.6,
        ease: 'expo-out',
        from: { opacity: 0, blur: o.blur ?? 14 * u, position: [o.dx ?? 0, o.dy ?? 20 * u], scale: o.scale ?? 100 },
        ...(o.dimTo !== undefined ? { dimTo: o.dimTo, brightenAfter: 0.18 } : {}),
        ...(out !== null ? { exit: { at: out, duration: o.outDuration ?? 0.32, stagger: 0.02, to: { opacity: 0, blur: 12 * u, position: [0, -12 * u] } } } : {}),
      },
    },
    effects: o.glow === 0 ? [] : [glowFx(o.glow ?? 16 * u, 0.5)],
  } as Layer;
}

/** Typewriter-style write-on for small detail lines: characters blur in quickly left to right. */
function writeOn(id: string, value: string, ctx: KitContext, o: Omit<TextOpts, 'by'> & { cps?: number }): Layer {
  const u = unit(ctx);
  const chars = Math.max(1, Array.from(value).length);
  const cps = o.cps ?? clamp(chars / 0.9, 28, 70);
  return text(id, value, ctx, { weight: 500, glow: 0, blur: 8 * u, dx: -8 * u, dy: 0, duration: 0.35, ...o, by: 'char', stagger: 1 / cps });
}

/** Seconds a write-on of `value` takes (so the next beat can follow it). */
const writeOnSeconds = (value: string) => Math.min(1.4, Array.from(value).length / clamp(Array.from(value).length / 0.9, 28, 70)) + 0.35;

const hexPath = (w: number, h: number): Vec => {
  // Flat-topped hexagon inside a w × h box (points in layer pixels).
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    pts.push(w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2);
  }
  return pts;
};

const cues = (entries: [number, 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser' | 'click', string][]): MotionScene['cues'] =>
  entries.filter(([at]) => at >= 0).map(([at, sound, note]) => ({ at: Math.round(at * 1000) / 1000, sound, note }));

// ───────────────────────── T9 hex roadmap ─────────────────────────

export type HexStage = { label: string; icon?: string };

const DEFAULT_STAGES: HexStage[] = [
  { label: 'What is Motion Design', icon: '▶' },
  { label: 'The Tools', icon: '✎' },
  { label: 'Design Pillars', icon: '◆' },
  { label: 'Motion Principles', icon: '◎' },
  { label: 'Your Portfolio', icon: '★' },
];
const DEFAULT_ICONS = ['▶', '✎', '◆', '◎', '★', '✦', '●', '▲'];

export function hexRoadmap(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const stages = list<HexStage | string>(params.stages, DEFAULT_STAGES).slice(0, 8).map((s) => (typeof s === 'string' ? { label: s } : s)).map((s, i) => ({ label: str(s.label, `Stage ${i + 1}`), icon: str(s.icon, DEFAULT_ICONS[i % DEFAULT_ICONS.length]) }));
  const n = stages.length;
  const active = optIndex(params.active, n);
  const title = str(params.title, `${n} STAGES`);
  const subtitle = str(params.subtitle, 'Motion Design Roadmap');

  // Flat-topped honeycomb: column step 1.5R, row step √3R, odd columns shifted half a row. The
  // stages sit in consecutive columns, so they zig-zag like the reference.
  const span = portrait ? 0.92 * W : 0.64 * W;
  const R = Math.min(span / (1.5 * (n - 1) + 2), (portrait ? 0.13 : 0.19) * H);
  const rowH = Math.sqrt(3) * R;
  const stageY = portrait ? 0.56 * H : 0.64 * H;
  const firstX = W / 2 - (1.5 * R * (n - 1)) / 2;
  const colX = (c: number) => firstX + c * 1.5 * R;
  const cellY = (c: number, r: number) => stageY - rowH / 4 + r * rowH + (((c % 2) + 2) % 2) * (rowH / 2);
  const Z = W * (2666.7 / 1920);

  const t0 = 0.05;
  const titleAt = 0.55;
  const popAt = 1.05;
  const popStep = 0.11;
  const settled = popAt + n * popStep + 0.7;
  const pushAt = active !== null ? settled + 0.55 : null;
  const duration = pushAt !== null ? pushAt + 1.25 : settled + 1.6;
  const exitAt = pushAt !== null ? pushAt - 0.1 : null;

  const layers: Layer[] = [];
  // The field: every cell a beveled crimson hex, brighter towards the lower middle of the frame.
  const cMin = Math.floor((-R * 1.2 - firstX) / (1.5 * R));
  const cMax = Math.ceil((W + R * 1.2 - firstX) / (1.5 * R));
  const rMin = Math.floor((-rowH * 1.2 - stageY) / rowH) - 1;
  const rMax = Math.ceil((H + rowH * 1.2 - stageY) / rowH) + 1;
  const gap = 0.07 * R;
  const hw = 2 * R - gap;
  const hh = rowH - gap * 0.9;
  let fieldIndex = 0;
  for (let c = cMin; c <= cMax; c++) {
    for (let r = rMin; r <= rMax; r++) {
      const x = colX(c);
      const y = cellY(c, r);
      if (y < -rowH * 0.8 || y > H + rowH * 0.8) continue;
      const dx = (x - W / 2) / W;
      const dy = (y - H * 0.62) / H;
      const shade = clamp(1 - Math.hypot(dx * 1.1, dy * 1.4) * 0.95, 0.28, 1);
      layers.push({
        id: `field-${fieldIndex++}`,
        name: 'Field hex',
        type: 'shape',
        threeD: true,
        transform: { position: [x, y, 0], opacity: Math.round(shade * 100) },
        shape: {
          shape: 'path',
          points: hexPath(hw, hh),
          closed: true,
          size: [hw, hh],
          gradient: { kind: 'linear', stops: [[0, '#2a040c'], [0.45, '#650a1b'], [0.85, '#b3132e'], [1, '#d81a38']], from: [0, 0], to: [0, hh] },
          stroke: '#ffc4cc70',
          strokeWidth: 2.6 * u,
        },
      } as Layer);
    }
  }
  // Rack focus on the field while the camera settles.
  layers.push({ id: 'field-focus', name: 'Field focus', type: 'solid', color: '#000000', adjustment: true, effects: [blurFx(keys<number>([t0, 22 * u, 'expo-out'], [t0 + 0.95, 0])), { type: 'vignette', amount: 0.55, size: 1.05, softness: 0.85 }] } as Layer);

  // The stages: 3D groups (null + hex + icon + label) that pop into their cells.
  stages.forEach((s, i) => {
    const at = popAt + i * popStep;
    const x = colX(i);
    const y = cellY(i, 0);
    const isActive = active === i;
    const dim = active !== null && !isActive && pushAt !== null ? [{ t: pushAt - 0.5, v: 100, ease: 'expo-out' as Ease }, { t: pushAt - 0.1, v: 45 }] : [];
    // Neighbours' icons and labels clear out during the fly-in (no clipped words at the edges).
    const dimText = dim.length ? [...dim.slice(0, 1), { ...dim[1], ease: 'expo-in' as Ease }, { t: pushAt! + 0.4, v: 0 }] : [];
    const group = `stage-${i}`;
    layers.push({
      id: group,
      name: `Stage ${i + 1}`,
      type: 'null',
      threeD: true,
      transform: {
        position: [x, y, -6],
        scale: isActive && pushAt !== null
          ? keys<number>([at, 55, 'back-out'], [at + 0.6, 100, 'linear'], [pushAt - 0.55, 100, 'back-out'], [pushAt - 0.1, 110])
          : keys<number>([at, 55, 'back-out'], [at + 0.6, 100]),
      },
    } as Layer);
    layers.push({
      id: `hex-${i}`,
      name: `Stage hex ${i + 1}`,
      type: 'shape',
      parent: group,
      threeD: true,
      motionBlur: true,
      transform: { position: [0, 0, 0], opacity: { k: [{ t: at, v: 0, ease: 'expo-out' }, { t: at + 0.3, v: 100 }, ...dim] } },
      shape: {
        shape: 'path',
        points: hexPath(hw, hh),
        closed: true,
        size: [hw, hh],
        gradient: { kind: 'linear', stops: [[0, '#ff8a9c'], [0.45, '#f0324f'], [1, '#b8122d']], from: [0, 0], to: [0, hh] },
        stroke: '#ffd6dd',
        strokeWidth: 3 * u,
      },
      effects: [focusFx(at, 22 * u, 0.5), glowFx(26 * u, isActive ? 0.85 : 0.55, p.accent), shadowFx(10 * u, 30 * u, 50)],
    } as Layer);
    const labelSize = clamp(R * 0.17, 14 * u, 28 * u);
    layers.push(text(`icon-${i}`, s.icon, ctx, { at: at + 0.08, size: R * 0.46, position: [0, -R * 0.12, -1], align: 'center', by: 'char', dy: 0, scale: 40, blur: 10 * u, duration: 0.5, parent: group, threeD: true, glow: 14 * u, opacity: { k: [{ t: 0, v: 100 }, ...dimText] } }));
    layers.push(text(`label-${i}`, s.label, ctx, { at: at + 0.18, size: labelSize, position: [0, R * 0.38, -1], align: 'center', weight: 600, box: R * 1.45, stagger: 0.05, dy: 8 * u, blur: 8 * u, parent: group, threeD: true, glow: 0, opacity: { k: [{ t: 0, v: 100 }, ...dimText] } }));
  });

  // Title block, top left (top centre in portrait).
  const titleSize = (portrait ? 118 : 112) * u;
  const titleX = portrait ? W / 2 : W * 0.06;
  const titleY = portrait ? H * 0.2 : H * 0.14;
  const align = portrait ? 'center' : 'left';
  layers.push(text('title', title, ctx, { at: titleAt, size: titleSize, position: [titleX, titleY], align, weight: 800, tracking: -2.5, stagger: 0.14, dy: 26 * u, blur: 20 * u, out: exitAt, glow: 20 * u }));
  layers.push(text('subtitle', subtitle, ctx, { at: titleAt + 0.35, size: 30 * u, position: [titleX + (portrait ? 0 : 6 * u), titleY + titleSize * 0.62], align, weight: 500, color: p.muted, stagger: 0.07, dy: 10 * u, blur: 10 * u, out: exitAt, glow: 0, dimTo: 0.5 }));

  // Camera: settles out of the field at the start; with an active stage it flies into that hex.
  const rest: Vec = [W / 2, H / 2, -Z];
  const camKeys: { t: number; v: Vec; ease?: Ease }[] = [{ t: t0, v: [W / 2, H * 0.56, -Z / 1.7], ease: 'expo-out' }, { t: t0 + 1.1, v: rest }];
  if (pushAt !== null && active !== null) {
    // Fill the frame with the hex face, but keep its icon and label inside the frame.
    const m = Math.min((H * 1.35) / hh, (W * 1.25) / hw);
    camKeys.push({ t: pushAt, v: rest, ease: [0.7, 0, 0.84, 0] }, { t: pushAt + 0.85, v: [colX(active), cellY(active, 0), -6 - Z / m] });
  }
  layers.push({ id: 'camera', name: 'Camera', type: 'camera', zoom: Z, transform: { position: { k: camKeys } } } as Layer);
  if (pushAt !== null) {
    layers.push({ id: 'push-blur', name: 'Push zoom blur', type: 'solid', color: '#000000', adjustment: true, in: pushAt, effects: [{ type: 'zoom-blur', amount: keys<number>([pushAt, 0, 'cubic-in'], [pushAt + 0.7, 0.28, 'cubic-out'], [pushAt + 1.1, 0]) }] } as Layer);
  }

  return scene(ctx, duration, layers, {
    background: p.void,
    cues: cues([
      [t0, 'whoosh', 'field settles'],
      [titleAt, 'impact', 'title'],
      ...stages.map((_, i) => [popAt + i * popStep, 'pop', `stage ${i + 1}`] as [number, 'pop', string]),
      ...(pushAt !== null ? [[pushAt - 0.5, 'click', 'active stage'] as [number, 'click', string], [pushAt, 'riser', 'fly in'] as [number, 'riser', string], [pushAt + 0.8, 'whoosh', 'into the hex'] as [number, 'whoosh', string]] : []),
    ]),
    template: { id: 'hex-roadmap', params },
  });
}

const HEX_ROADMAP: TemplateSpec = {
  id: 'hex-roadmap',
  label: 'Hex roadmap (chapter map)',
  technique: 'T9',
  use: 'The recurring chapter map: a beveled crimson hex field, the title and a zig-zag of stage hexes with icons popping in. Set `active` at each chapter break so the camera flies into that stage’s hex as the transition.',
  params: {
    stages: '{ label, icon? }[] — 3–8 stages; icon is one character or emoji (default: 5 motion-design stages)',
    active: 'number | null — 0-based stage to highlight and fly into at the end (default none: hold on the map)',
    title: 'string — big title (default "<n> STAGES")',
    subtitle: 'string — kicker under the title (default "Motion Design Roadmap")',
  },
  seconds: 4,
  fullFrame: true,
  build: hexRoadmap,
};

// ───────────────────────── T10 glass teaching card ─────────────────────────

export type TeachingItem = { title: string; detail?: string; at?: number };

const DEFAULT_ITEMS: TeachingItem[] = [
  { title: 'Contrast', detail: 'what makes the important thing pop' },
  { title: 'Hierarchy', detail: 'what the eye sees first, second & third' },
  { title: 'Balance', detail: 'so nothing feels like it’s tipping' },
];

/** A sweeping pink streak (trim-path segment travelling along a sine) behind the stage graphics. */
function streak(id: string, ctx: KitContext, at: number, o: { y: number; amplitude: number; width: number; dur?: number; color?: string }): Layer {
  const W = ctx.width;
  const u = unit(ctx);
  const off = W * 0.1;
  const pts: number[] = [];
  const count = 26;
  for (let i = 0; i < count; i++) {
    const x = -off + (i / (count - 1)) * (W + off * 2);
    pts.push(x + off, o.amplitude + Math.sin((x / W) * Math.PI * 2 * 0.85 + 0.6) * -o.amplitude + 4);
  }
  const dur = o.dur ?? 1.3;
  return {
    id,
    name: 'Ribbon streak',
    type: 'shape',
    in: at,
    out: at + dur + 0.1,
    transform: { position: [-off, o.y - o.amplitude - 4], anchor: [0, 0] },
    shape: {
      shape: 'path',
      points: pts,
      closed: false,
      curve: true,
      stroke: o.color ?? '#ff4f78',
      strokeWidth: o.width,
      cap: 'round',
      trimEnd: keys<number>([at, 0, 'cubic-in-out'], [at + dur * 0.75, 100]),
      trimStart: keys<number>([at + dur * 0.2, 0, 'cubic-in-out'], [at + dur, 100]),
    },
    effects: [glowFx(18 * u, 0.9, '#ff4f78')],
  } as Layer;
}

export function glassTeachingCard(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const kicker = str(params.kicker, 'Pillar 1');
  const title = str(params.title, 'Design Principles');
  const items = list<TeachingItem | string>(params.items, DEFAULT_ITEMS).slice(0, 7).map((item) => (typeof item === 'string' ? { title: item } : item)).map((item, i) => ({ title: str(item.title, `Point ${i + 1}`), detail: typeof item.detail === 'string' ? item.detail : '', at: item.at }));
  const n = items.length;
  const withExit = params.exit !== false;

  const k = portrait ? 1.22 : 1;
  const kickerSize = 30 * u * k;
  const titleSize = 72 * u * k;
  const itemSize = 48 * u * k;
  const detailSize = itemSize * 0.56;
  const step = 138 * u * k;
  const cardW = portrait ? W * 0.88 : Math.min(W * 0.64, 1300 * u);
  const cardH = Math.min(H * (portrait ? 0.72 : 0.86), 250 * u * k + n * step);
  const cx = W / 2;
  const cy = H / 2;
  const left = cx - cardW / 2 + 48 * u;
  const top = cy - cardH / 2;
  const box = cardW - 96 * u;

  const cardAt = 0.15;
  const titleAt = 0.5;
  // Item times: explicit `at`, else one after another with room for the detail to write on.
  const times: number[] = [];
  let next = 1.15;
  for (const item of items) {
    const at = typeof item.at === 'number' ? item.at : next;
    times.push(at);
    next = at + Math.max(0.85, 0.45 + (item.detail ? writeOnSeconds(item.detail) : 0) + 0.2);
  }
  const lastEnd = Math.max(...times.map((at, i) => at + 0.45 + (items[i].detail ? writeOnSeconds(items[i].detail) : 0.2)));
  const duration = Math.max(num(params.duration, 0), lastEnd + (withExit ? 2.2 : 1.8));
  const exitAt = withExit ? duration - 0.45 : null;

  const layers: Layer[] = [stage(ctx, 'stage', { glowY: 1.12, spread: 0.36 })];
  if (params.ribbon !== false) layers.push(streak('streak', ctx, cardAt + 0.05, { y: cy - cardH * 0.1, amplitude: H * 0.12, width: 9 * u, dur: 1.5 }));
  const cardFrom = portrait ? 40 * u : 34 * u;
  const move = keys<Vec>([cardAt, [cx, cy + cardFrom], 'expo-out'], [cardAt + 0.8, [cx, cy]]);
  const cardScale: [number, number, Ease?][] = [[cardAt, 93, 'expo-out'], [cardAt + 0.8, 100, 'linear']];
  if (exitAt !== null) cardScale.push([exitAt, 100, 'expo-in'], [exitAt + 0.35, 104]);
  // Frost: a white multiply layer blurs what is behind the card at full coverage without tinting
  // it (the renderer weights backdrop blur by the layer's alpha, and the glass itself is sheer).
  layers.push({
    id: 'card-frost',
    name: 'Card frost',
    type: 'shape',
    blend: 'multiply',
    transform: { position: move, scale: keys<number>(...cardScale), opacity: fade(cardAt, 0.6, exitAt, 0.35) },
    shape: { shape: 'rect', size: [cardW, cardH], radius: 26 * u, fill: '#ffffff' },
    backdrop: { blur: 34, saturation: 1.2, brightness: -12 },
  } as Layer);
  layers.push({
    id: 'card',
    name: 'Glass card',
    type: 'shape',
    motionBlur: true,
    transform: { position: move, scale: keys<number>(...cardScale), opacity: fade(cardAt, 0.6, exitAt, 0.35) },
    shape: {
      shape: 'rect',
      size: [cardW, cardH],
      radius: 26 * u,
      gradient: { kind: 'linear', stops: [[0, '#ffffff14'], [0.4, '#3a061230'], [0.78, `${p.crimson}8c`], [1, '#d8183ad0']], from: [0, 0], to: [0, cardH] },
      stroke: '#ffd0d8b0',
      strokeWidth: 2 * u,
    },
    effects: [focusFx(cardAt, 24 * u, 0.7, exitAt, 0.35), { type: 'grain', amount: 0.3, size: 1.2, animated: false }, glowFx(14 * u, 0.35, p.pink), shadowFx(26 * u, 70 * u, 55)],
  } as Layer);

  const kickerY = top + 56 * u;
  const titleY = kickerY + kickerSize * 0.6 + titleSize * 0.62;
  layers.push(text('kicker', kicker, ctx, { at: titleAt, size: kickerSize, position: [left, kickerY], weight: 500, color: p.muted, by: 'char', stagger: 0.025, dy: 0, dx: -10 * u, blur: 8 * u, out: exitAt, glow: 0 }));
  layers.push(text('title', title, ctx, { at: titleAt + 0.12, size: titleSize, position: [left, titleY], weight: 700, by: 'char', stagger: 0.03, dy: 0, dx: -14 * u, blur: 14 * u, out: exitAt, glow: 14 * u, box }));
  const firstY = titleY + titleSize * 0.7 + itemSize * 1.25;
  const itemStep = Math.min(step * 1.5, (top + cardH - 56 * u - firstY - itemSize * 0.4 - detailSize) / Math.max(1, n - 1));
  items.forEach((item, i) => {
    const y = firstY + i * itemStep;
    layers.push(text(`item-${i}`, item.title, ctx, { at: times[i], size: itemSize, position: [left, y], weight: 600, by: 'char', stagger: 0.028, dy: 0, dx: -16 * u, blur: 12 * u, out: exitAt, glow: 10 * u, box }));
    if (item.detail) layers.push(writeOn(`detail-${i}`, item.detail, ctx, { at: times[i] + 0.45, size: detailSize, position: [left, y + itemSize * 0.5 + detailSize * 0.62], color: p.muted, opacity: 72, out: exitAt, box }));
  });

  return scene(ctx, duration, layers, {
    cues: cues([
      [cardAt, 'whoosh', 'card'],
      [titleAt + 0.12, 'click', 'title'],
      ...times.map((at, i) => [at, 'pop', `item ${i + 1}`] as [number, 'pop', string]),
      ...(exitAt !== null ? [[exitAt, 'whoosh', 'out'] as [number, 'whoosh', string]] : []),
    ]),
    template: { id: 'glass-teaching-card', params },
  });
}

const GLASS_TEACHING_CARD: TemplateSpec = {
  id: 'glass-teaching-card',
  label: 'Glass teaching card',
  technique: 'T10',
  use: 'A frosted glass card on the crimson stage that teaches one idea: a kicker ("Pillar 1"), a title, then list items that write on as they are spoken, each with a smaller dimmer sub-line. Use for the long teaching sections; time items to the transcript.',
  params: {
    kicker: 'string — small label above the title (default "Pillar 1")',
    title: 'string — card title (default "Design Principles")',
    items: '{ title, detail?, at? }[] — 1–7 points; `at` = scene seconds the point lands (default: one after another from 1.15 s)',
    ribbon: 'boolean — a pink streak sweeps behind the card on entry (true)',
    exit: 'boolean — blur the card away at the end (true)',
    duration: 'number s — minimum length (default: last detail + 2.2 s)',
  },
  seconds: 6,
  fullFrame: true,
  build: glassTeachingCard,
};

// ───────────────────────── T11 ribbon title ─────────────────────────

export function ribbonTitle(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const value = str(params.text, '5 Pillars of Design');
  const amplitude = clamp(num(params.amplitude, 0.09), 0, 0.3) * H * (portrait ? 0.5 : 1);
  const withExit = params.exit !== false;
  const cy = H * 0.5;
  const drawAt = 0.35;
  const drawDur = 1.25;
  const chars = Array.from(value).length;
  const typeAt = drawAt + drawDur * 0.28;
  const stagger = clamp((drawDur * 0.6) / Math.max(1, chars), 0.025, 0.07);
  // Size the title to span ~74 % of the width (one line in landscape; wrapped in portrait).
  const size = portrait ? clamp((W * 0.84 * 2) / Math.max(4, chars * 0.52), 90 * u, 150 * u) : clamp((W * 0.74) / Math.max(4, chars * 0.5), 80 * u, 190 * u);
  const off = W * 0.08;
  // Each glyph lands as the ribbon's tip passes it (landscape: one line, x known well enough).
  const tipAt = (x: number) => {
    const target = clamp((x + off) / (W + off * 2), 0, 1);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (easeAt('cubic-in-out', mid) < target) lo = mid; else hi = mid; }
    return drawAt + ((lo + hi) / 2) * drawDur;
  };
  const textW = chars * size * 0.5;
  const times = portrait ? undefined : Array.from({ length: chars }, (_, i) => tipAt(W / 2 - textW / 2 + ((i + 0.5) / chars) * textW) - 0.06);
  const settled = (times ? Math.max(...times) : typeAt + stagger * chars) + 0.6;
  const duration = Math.max(num(params.duration, 0), settled + (withExit ? 1.9 : 1.6));
  const exitAt = withExit ? duration - 0.5 : null;

  // A sine ribbon across the frame: rises on the left, dips under the title, lifts off the right.
  const pts: number[] = [];
  const count = 40;
  const lift = amplitude * 1.5 + 30 * u;
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const x = -off + f * (W + off * 2);
    const y = cy + H * 0.035 - amplitude * Math.sin((x / W) * Math.PI * 2 * 0.95 + 0.25);
    pts.push(x + off, y - cy + lift);
  }
  const drift = keys<Vec>([0, [-off - 14 * u, cy - lift], 'sine-in-out'], [duration, [-off + 14 * u, cy - lift]]);
  const trimEnd = keys<number>([drawAt, 0, 'cubic-in-out'], [drawAt + drawDur, 100]);
  const trimStart = exitAt !== null ? keys<number>([exitAt, 0, 'expo-in'], [exitAt + 0.45, 100]) : 0;
  const ribbon = (id: string, color: string, width: number, dy: number, effects: Effect[]): Layer => ({
    id,
    name: 'Ribbon',
    type: 'shape',
    motionBlur: true,
    transform: { position: drift, anchor: [0, -dy] },
    shape: { shape: 'path', points: pts, closed: false, curve: true, stroke: color, strokeWidth: width, cap: 'round', trimEnd, trimStart },
    effects,
  } as Layer);

  const cascade: TextCascade = {
    by: 'char',
    ...(times ? { times } : {}),
    delay: typeAt,
    stagger,
    duration: 0.55,
    ease: 'expo-out',
    from: { opacity: 0, blur: 20 * u, position: [-18 * u, 6 * u], scale: 100 },
  };
  if (exitAt !== null) cascade.exit = { at: exitAt - 0.05, duration: 0.35, stagger: 0.012, to: { opacity: 0, blur: 16 * u, position: [22 * u, 0] } };
  const layers: Layer[] = [
    stage(ctx, 'stage', { glowY: 1.15, spread: 0.4 }),
    { id: 'haze', name: 'Haze', type: 'procedural', kind: 'radial-glow', params: { inner: '#7a0c1f', outer: '#0b0204', center: [0.72, 0.9], radius: 0.95 }, blend: 'screen', transform: { opacity: 55 } } as Layer,
    ribbon('ribbon', '#c81d48', 24 * u, 0, [glowFx(34 * u, 0.9, '#ff2a55')]),
    ribbon('ribbon-core', '#ff9db4', 9 * u, -4 * u, [blurFx(2 * u), glowFx(10 * u, 0.5, '#ff8aa4')]),
    {
      id: 'title',
      name: value.slice(0, 32),
      type: 'text',
      in: Math.max(0, typeAt - 0.05),
      transform: { position: [W / 2, cy - size * 0.08], scale: keys<number>([typeAt, 100, 'sine-out'], [duration, 104]) },
      text: { text: value, font: ctx.font, size, weight: 600, color: '#ffffff', align: 'center', tracking: -2, lineHeight: 1.02, ...(portrait ? { box: W * 0.84 } : {}), cascade },
      effects: [glowFx(24 * u, 0.75)],
    } as Layer,
  ];

  return scene(ctx, duration, layers, {
    cues: cues([
      [drawAt, 'whoosh', 'ribbon draws'],
      [typeAt, 'riser', 'title types'],
      [settled - 0.3, 'impact', 'title lands'],
      ...(exitAt !== null ? [[exitAt, 'whoosh', 'out'] as [number, 'whoosh', string]] : []),
    ]),
    template: { id: 'ribbon-title', params },
  });
}

const RIBBON_TITLE: TemplateSpec = {
  id: 'ribbon-title',
  label: 'Ribbon title',
  technique: 'T11',
  use: 'A section title card: a glowing pink ribbon draws a sine path across the crimson stage and the title types on along it, letter by letter. Use to open a teaching section ("5 Pillars of Design").',
  params: {
    text: 'string — the title (default "5 Pillars of Design")',
    amplitude: 'number 0–0.3 — ribbon wave height as a fraction of the frame height (0.09)',
    exit: 'boolean — ribbon retracts and the title blurs away at the end (true)',
    duration: 'number s — minimum length (default ≈ 4 s)',
  },
  seconds: 4,
  fullFrame: true,
  build: ribbonTitle,
};

// ───────────────────────── T12 numbered lanes ─────────────────────────

export type Lane = { title: string; bullets?: string[] };

const DEFAULT_LANES: Lane[] = [
  { title: 'Motion Design for Social Media', bullets: ['Brands', 'Explainer Reels', 'Ads', 'D2C Campaigns'] },
  { title: 'SaaS and Product Motion', bullets: ['Explainer Videos', 'Product Demos', 'Launch Films'] },
  { title: 'Broadcast & Titles', bullets: ['Title Sequences', 'Lower Thirds'] },
  { title: 'UI Motion', bullets: ['Micro-interactions', 'Prototypes'] },
  { title: '3D & VFX', bullets: ['Product Renders', 'Compositing'] },
];

export function numberedLanes(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const lanes = list<Lane | string>(params.lanes, DEFAULT_LANES).slice(0, 7).map((lane) => (typeof lane === 'string' ? { title: lane } : lane)).map((lane, i) => ({ title: str(lane.title, `Lane ${i + 1}`), bullets: list<string>(lane.bullets, []).filter((b) => typeof b === 'string').slice(0, 6) }));
  const n = lanes.length;
  const active = optIndex(params.active, n);
  const title = str(params.title, `${n} Lanes in Motion Design`);
  const Z = W * (2666.7 / 1920);

  const laneW = ((portrait ? 0.9 : 0.8) * W) / n;
  const x0 = W / 2 - (n * laneW) / 2;
  const floorY = portrait ? 0.6 * H : 0.72 * H;
  const railTop = portrait ? 0.3 * H : 0.1 * H;
  const digitSize = Math.min(laneW * 1.12, (floorY - railTop) * 0.62);
  const lineL = W * 0.96;
  const lineX = W * 0.02;
  const zLane = 0;

  const lineAt = 0.15;
  const lineDur = 0.75;
  const railAt = 0.8;
  const digitAt = 1.0;
  const titleAt = digitAt + n * 0.1 + 0.35;
  const settled = titleAt + 0.9;
  const truckAt = active !== null ? settled + 0.5 : null;
  const truckDur = 1.1;
  const headAt = truckAt !== null ? truckAt + truckDur * 0.72 : null;
  const bullets = active !== null ? lanes[active].bullets : [];
  const bulletStep = 0.28;
  const duration = headAt !== null ? headAt + 0.5 + bullets.length * bulletStep + 1.9 : settled + 1.8;

  const layers: Layer[] = [
    stage(ctx, 'stage', { glowY: -0.18, spread: 0.42, intensity: 1.15 }),
    { id: 'floor-glow', name: 'Floor glow', type: 'shape', threeD: true, transform: { position: [W / 2, floorY + 50 * u, zLane + 1], opacity: fade(railAt, 0.9, null, 0, 55) }, shape: { shape: 'ellipse', size: [W * 0.85, 110 * u], fill: '#ff4a6a' }, effects: [blurFx(80 * u)], blend: 'screen' } as Layer,
  ];
  // Baseline grows out from the centre.
  layers.push({
    id: 'baseline',
    name: 'Baseline',
    type: 'shape',
    threeD: true,
    transform: { position: [lineX, floorY, zLane], anchor: [0, 0] },
    shape: { shape: 'line', points: [0, 0, lineL, 0], stroke: '#fff4f6', strokeWidth: 2.5 * u, cap: 'round', trimStart: keys<number>([lineAt, 50, 'expo-out'], [lineAt + lineDur, 0]), trimEnd: keys<number>([lineAt, 50, 'expo-out'], [lineAt + lineDur, 100]) },
    effects: [glowFx(12 * u, 0.8, p.pink)],
  } as Layer);
  // Ticks (diamonds) and rails at the lane edges.
  for (let k = 0; k <= n; k++) {
    const x = x0 + k * laneW;
    const reach = Math.abs(x - W / 2) / (lineL / 2);
    const at = lineAt + lineDur * 0.25 * reach;
    const d = 11 * u;
    layers.push({
      id: `tick-${k}`,
      name: 'Tick',
      type: 'shape',
      threeD: true,
      transform: { position: [x, floorY, zLane - 1], rotation: 45, scale: keys<number>([at, 0, 'back-out'], [at + 0.4, 100]) },
      shape: { shape: 'rect', size: [d, d], fill: '#ffffff' },
      effects: [glowFx(10 * u, 0.9, p.pink)],
    } as Layer);
    const rh = floorY - railTop;
    const rAt = railAt + k * 0.07;
    layers.push({
      id: `rail-${k}`,
      name: 'Rail',
      type: 'shape',
      threeD: true,
      transform: { position: [x, floorY - rh / 2, zLane], opacity: 80 },
      shape: { shape: 'line', points: [0, rh, 0, 0], stroke: '#ffe8ec', strokeWidth: 2 * u, cap: 'round', trimEnd: keys<number>([rAt, 0, 'expo-out'], [rAt + 0.8, 100]) },
      effects: [glowFx(9 * u, 0.7, p.pink)],
    } as Layer);
  }
  // Big digits with floor reflections.
  const dimKeys = (i: number, rest: number, low: number) => (active !== null && truckAt !== null && i !== active ? [{ t: truckAt, v: rest, ease: 'expo-out' as Ease }, { t: truckAt + 0.6, v: low }] : []);
  lanes.forEach((_, i) => {
    const cx = x0 + (i + 0.5) * laneW;
    const at = digitAt + i * 0.1;
    const digit = String(i + 1);
    const restY = floorY - digitSize * 0.35;
    layers.push({
      id: `digit-${i}`,
      name: `Digit ${digit}`,
      type: 'text',
      threeD: true,
      motionBlur: true,
      transform: { position: keys<Vec>([at, [cx, restY + digitSize * 0.25, zLane], 'expo-out'], [at + 0.7, [cx, restY, zLane]]), opacity: { k: [{ t: at, v: 0, ease: 'expo-out' }, { t: at + 0.4, v: 84 }, ...dimKeys(i, 84, 30)] } },
      text: { text: digit, font: ctx.font, size: digitSize, weight: 800, color: '#fff0f3', align: 'center', tracking: 0 },
      effects: [focusFx(at, 26 * u, 0.6), glowFx(22 * u, 0.45, p.pink)],
    } as Layer);
    // The reflection: a flipped, blurred copy fading away from the floor (a feathered mask on the
    // part nearest the baseline, in the unflipped layer's pixels).
    const pad = Math.ceil(digitSize * 0.35);
    const baseline = pad + digitSize * 0.86;
    const reflY = floorY + digitSize * 0.35 + 4 * u;
    layers.push({
      id: `reflection-${i}`,
      name: `Reflection ${digit}`,
      type: 'text',
      threeD: true,
      motionBlur: true,
      transform: { position: keys<Vec>([at, [cx, reflY - digitSize * 0.25, zLane], 'expo-out'], [at + 0.7, [cx, reflY, zLane]]), scale: [100, -100, 100], opacity: { k: [{ t: at, v: 0, ease: 'expo-out' }, { t: at + 0.5, v: 26 }, ...dimKeys(i, 26, 9)] } },
      text: { text: digit, font: ctx.font, size: digitSize, weight: 800, color: '#ffc4ce', align: 'center', tracking: 0 },
      masks: [{ shape: 'rect', box: [-1e4, baseline - digitSize * 0.5, 2e4, digitSize * 2], feather: digitSize * 0.45 }],
      effects: [blurFx(9 * u)],
    } as Layer);
  });
  // Title between the rails, above the digits.
  const titleSize = (portrait ? 50 : 46) * u;
  const exitTitle = truckAt !== null ? truckAt - 0.1 : null;
  layers.push({ ...text('title', title, ctx, { at: titleAt, size: titleSize, position: [W / 2, floorY - digitSize * 1.02 - titleSize * 0.9, zLane - 2], align: 'center', weight: 650, stagger: 0.09, dy: 14 * u, blur: 14 * u, out: exitTitle, glow: 14 * u, box: portrait ? W * 0.8 : undefined }), threeD: true } as Layer);

  // Camera: rests facing the lanes; with an active lane it trucks and pushes to it.
  const rest: Vec = [W / 2, H / 2, -Z];
  const camKeys: { t: number; v: Vec; ease?: Ease }[] = [{ t: 0, v: [W / 2, H / 2 + 0.03 * H, -Z * 1.08], ease: 'sine-out' }, { t: settled, v: rest }];
  if (active !== null && truckAt !== null && headAt !== null) {
    const m = portrait ? 2.1 : 2.2;
    const laneCx = x0 + (active + 0.5) * laneW;
    const screenX = portrait ? 0.5 * W : 0.34 * W;
    const floorScreen = portrait ? 0.84 * H : 0.9 * H;
    const camX = laneCx - (screenX - W / 2) / m;
    const camY = floorY - (floorScreen - H / 2) / m;
    camKeys.push({ t: truckAt, v: rest, ease: 'quart-in-out' }, { t: truckAt + truckDur, v: [camX, camY, -Z / m] });
    // World ↔ screen for the lane header, written in the pushed-in view.
    const world = (sx: number, sy: number): Vec => [camX + (sx - W / 2) / m, camY + (sy - H / 2) / m, zLane - 3];
    const laneLeftScreen = screenX - (laneW * m) / 2 + laneW * m * 0.08;
    const headSize = (portrait ? 50 : 46) * u;
    const bulletSize = headSize * 0.58;
    const boxW = laneW * 0.86;
    const headLines = Math.max(1, Math.ceil((lanes[active].title.length * headSize * 0.52) / (boxW * m)));
    const headTop = portrait ? 0.2 * H : 0.12 * H;
    const head = world(laneLeftScreen, headTop + (headLines * headSize * 1.05) / 2);
    layers.push({ ...text('lane-title', lanes[active].title, ctx, { at: headAt, size: headSize / m, position: head, weight: 700, stagger: 0.07, dy: (12 * u) / m, blur: (12 * u) / m, glow: (12 * u) / m, box: boxW, lineHeight: 1.05 }), threeD: true } as Layer);
    bullets.forEach((bullet, j) => {
      const sy = headTop + headLines * headSize * 1.05 + headSize * 0.55 + j * bulletSize * 1.45;
      layers.push({ ...writeOn(`lane-bullet-${j}`, bullet, ctx, { at: headAt + 0.45 + j * bulletStep, size: bulletSize / m, position: world(laneLeftScreen, sy), color: '#ffe3e8', blur: (8 * u) / m, dx: (-8 * u) / m, box: boxW }), threeD: true } as Layer);
    });
  }
  layers.push({ id: 'camera', name: 'Camera', type: 'camera', zoom: Z, transform: { position: { k: camKeys } } } as Layer);

  return scene(ctx, duration, layers, {
    cues: cues([
      [lineAt, 'whoosh', 'baseline'],
      [railAt, 'riser', 'rails rise'],
      ...lanes.map((_, i) => [digitAt + i * 0.1, 'pop', `digit ${i + 1}`] as [number, 'pop', string]),
      [titleAt, 'click', 'title'],
      ...(truckAt !== null ? [[truckAt, 'whoosh', 'camera trucks'] as [number, 'whoosh', string]] : []),
      ...(headAt !== null ? [[headAt, 'pop', 'lane title'] as [number, 'pop', string]] : []),
    ]),
    template: { id: 'numbered-lanes', params },
  });
}

const NUMBERED_LANES: TemplateSpec = {
  id: 'numbered-lanes',
  label: 'Numbered lanes',
  technique: 'T12',
  use: 'Introduces N parallel options or career paths: a glowing baseline with diamond ticks grows from the centre, light rails rise, huge digits with floor reflections land, then the title. With `active`, the camera trucks to that lane and its title and bullets write on — rebuild with the next `active` for each lane.',
  params: {
    lanes: '{ title, bullets?: string[] }[] — 2–7 lanes (default: 5 motion-design lanes)',
    active: 'number | null — 0-based lane the camera trucks to, writing its title + bullets (default none)',
    title: 'string — overview title (default "<n> Lanes in Motion Design")',
  },
  seconds: 6,
  fullFrame: true,
  build: numberedLanes,
};

// ───────────────────────── T13 diamond list + PiP ─────────────────────────

export type ListItem = { title: string; detail?: string };

const DEFAULT_LIST: ListItem[] = [
  { title: 'Timing', detail: 'Move something too slow = feels lazy. Too fast = feels cheap.' },
  { title: 'Weight', detail: 'A logo landing and a subtitle fading in should not feel the same' },
  { title: 'Rhythm', detail: 'Great motion design has a pulse, like a good song does' },
  { title: 'Intention', detail: 'Ask: what do I want the viewer to feel in this moment?' },
];

/** A rounded footage card with a light rim and a soft shadow (the picture-in-picture). */
function pipCard(id: string, source: FootageSource, ctx: KitContext, o: { at: number; size: Vec; position: Vec; fromX?: number; out?: number | null; radius?: number }): Layer {
  const u = unit(ctx);
  const [x, y] = o.position;
  const out = o.out ?? null;
  const fromX = o.fromX ?? 60 * u;
  const path: [number, Vec, Ease?][] = [[o.at, [x + fromX, y], 'expo-out'], [o.at + 0.75, [x, y], 'linear']];
  if (out !== null) path.push([out, [x, y], 'expo-in'], [out + 0.35, [x + fromX, y]]);
  return {
    id,
    name: 'Picture in picture',
    type: 'footage',
    source,
    fit: 'cover',
    size: o.size,
    in: Math.max(0, o.at - 0.05),
    motionBlur: true,
    transform: { position: keys<Vec>(...path), scale: keys<number>([o.at, 88, 'expo-out'], [o.at + 0.75, 100]), opacity: fade(o.at, 0.5, out, 0.3) },
    masks: [{ shape: 'rect', radius: o.radius ?? 20 * u }],
    effects: [focusFx(o.at, 20 * u, 0.6, out, 0.3), { type: 'stroke', width: 2.5 * u, color: '#ffffff', opacity: 55, position: 'inside' }, shadowFx(22 * u, 60 * u, 60)],
  } as Layer;
}

export function diamondListPip(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const items = list<ListItem | string>(params.items, DEFAULT_LIST).slice(0, 7).map((item) => (typeof item === 'string' ? { title: item } : item)).map((item, i) => ({ title: str(item.title, `Point ${i + 1}`), detail: typeof item.detail === 'string' ? item.detail : '' }));
  const n = items.length;
  const pip = footageOf(params.pip);
  const withExit = params.exit !== false;
  const given = list<number>(params.times, []);

  const badge = (portrait ? 90 : 96) * u;
  const listX = portrait ? W * 0.1 : W * 0.07;
  const textX = listX + badge * 0.95;
  const top = portrait ? H * 0.09 : H * 0.13;
  const bottom = portrait ? (pip ? H * 0.54 : H * 0.86) : H * 0.87;
  const step = Math.min((bottom - top) / Math.max(1, n - 1), (portrait ? 260 : 250) * u);
  const titleSize = (portrait ? 54 : 58) * u;
  const detailSize = titleSize * 0.56;
  const box = portrait ? W * 0.8 : pip ? W * 0.62 : W * 0.8;

  const badgeAt = 0.2;
  const times: number[] = [];
  let next = badgeAt + n * 0.09 + 0.75;
  items.forEach((item, i) => {
    const at = typeof given[i] === 'number' ? given[i] : next;
    times.push(at);
    next = at + Math.max(0.8, (item.detail ? writeOnSeconds(item.detail) : 0) + 0.45);
  });
  const lastEnd = Math.max(...times.map((at, i) => at + (items[i].detail ? writeOnSeconds(items[i].detail) : 0.3)));
  const duration = Math.max(num(params.duration, 0), lastEnd + (withExit ? 2 : 1.6));
  const exitAt = withExit ? duration - 0.45 : null;

  const layers: Layer[] = [stage(ctx, 'stage', { glowY: 1.1, spread: 0.34 })];
  items.forEach((item, i) => {
    const y = top + i * step;
    const at = badgeAt + i * 0.09;
    const pulse = times[i];
    layers.push({
      id: `badge-${i}`,
      name: `Badge ${i + 1}`,
      type: 'shape',
      motionBlur: true,
      transform: {
        position: [listX, y],
        rotation: keys<number>([at, -45, 'back-out'], [at + 0.6, 45]),
        scale: keys<number>([at, 30, 'back-out'], [at + 0.55, 100, 'linear'], [pulse, 100, 'back-out'], [pulse + 0.25, 114, 'expo-out'], [pulse + 0.6, 100]),
        opacity: fade(at, 0.35, exitAt, 0.3),
      },
      shape: { shape: 'rect', size: [badge, badge], radius: 6 * u, gradient: { kind: 'linear', stops: [[0, '#ff4d66'], [1, '#9c0f28']], from: [0, 0], to: [badge, badge] }, stroke: '#ffffff', strokeWidth: 3 * u },
      effects: [focusFx(at, 16 * u, 0.45, exitAt, 0.3), glowFx(16 * u, 0.6, p.accent)],
    } as Layer);
    layers.push(text(`number-${i}`, String(i + 1), ctx, { at: at + 0.12, size: badge * 0.62, position: [listX, y + badge * 0.02], align: 'center', weight: 800, by: 'char', dy: 0, scale: 50, blur: 10 * u, duration: 0.45, out: exitAt, glow: 8 * u }));
    const titleY = item.detail ? y - titleSize * 0.28 : y;
    layers.push(text(`title-${i}`, item.title, ctx, { at: at + 0.16, size: titleSize, position: [textX, titleY], weight: 700, by: 'word', stagger: 0.06, dy: 0, dx: -28 * u, blur: 14 * u, out: exitAt, glow: 10 * u, box }));
    if (item.detail) layers.push(writeOn(`detail-${i}`, item.detail, ctx, { at: times[i], size: detailSize, position: [textX, titleY + titleSize * 0.52 + detailSize * 0.6], color: '#ffe6ea', opacity: 74, out: exitAt, box }));
  });
  if (pip) {
    const size: Vec = portrait ? [W * 0.62, W * 0.62 * 0.78] : [W * 0.18, W * 0.18 * 1.27];
    const position: Vec = portrait ? [W / 2, H * 0.79] : [W * 0.875, H * 0.72];
    layers.push(pipCard('pip', pip, ctx, { at: 0.45, size, position, fromX: portrait ? 0 : 80 * u, out: exitAt }));
  }

  return scene(ctx, duration, layers, {
    cues: cues([
      ...items.map((_, i) => [badgeAt + i * 0.09, 'pop', `badge ${i + 1}`] as [number, 'pop', string]),
      ...(pip ? [[0.45, 'whoosh', 'pip'] as [number, 'whoosh', string]] : []),
      ...times.map((at, i) => [at, 'click', `detail ${i + 1}`] as [number, 'click', string]),
      ...(exitAt !== null ? [[exitAt, 'whoosh', 'out'] as [number, 'whoosh', string]] : []),
    ]),
    template: { id: 'diamond-list-pip', params },
  });
}

const DIAMOND_LIST_PIP: TemplateSpec = {
  id: 'diamond-list-pip',
  label: 'Diamond list + PiP',
  technique: 'T13',
  use: 'A numbered list with crimson diamond badges down the left; each point’s detail writes on when it is spoken, and the speaker stays visible in a rounded picture-in-picture card at the right. Use for "N fundamentals / rules" explanations.',
  params: {
    items: '{ title, detail? }[] — 2–7 points (default: Timing / Weight / Rhythm / Intention)',
    pip: 'footage { asset | path, in?, kind? } — the talking head shown in the PiP card (optional)',
    times: 'number[] — scene seconds each detail writes on (default: one after another)',
    exit: 'boolean — everything blurs away at the end (true)',
    duration: 'number s — minimum length',
  },
  seconds: 7,
  fullFrame: true,
  build: diamondListPip,
};

// ───────────────────────── T14 node tree ─────────────────────────

export type TreeNode = { id: string; label: string; detail?: string; x?: number; y?: number };

const DEFAULT_NODES: TreeNode[] = [
  { id: 'basic', label: 'Basic', detail: 'After Effects' },
  { id: 'intermediate', label: 'Intermediate', detail: 'Illustrator · Photoshop' },
  { id: 'advanced', label: 'Advanced', detail: 'Figma' },
];

type Box = { cx: number; cy: number; w: number; h: number };

/** Connector points from box `a` to box `b`: straight when aligned, one elbow otherwise. */
function connector(a: Box, b: Box): { points: number[]; start: Vec; end: Vec } {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  let pts: number[];
  if (Math.abs(dy) < (a.h + b.h) / 4) {
    const sx = a.cx + (Math.sign(dx) * a.w) / 2;
    const ex = b.cx - (Math.sign(dx) * b.w) / 2;
    const mx = (sx + ex) / 2;
    pts = [sx, a.cy, mx, a.cy, mx, b.cy, ex, b.cy];
  } else if (Math.abs(dx) < (a.w + b.w) / 4) {
    const sy = a.cy + (Math.sign(dy) * a.h) / 2;
    const ey = b.cy - (Math.sign(dy) * b.h) / 2;
    const my = (sy + ey) / 2;
    pts = [a.cx, sy, a.cx, my, b.cx, my, b.cx, ey];
  } else {
    const sy = a.cy + (Math.sign(dy) * a.h) / 2;
    const ex = b.cx - (Math.sign(dx) * b.w) / 2;
    pts = [a.cx, sy, a.cx, b.cy, ex, b.cy];
  }
  return { points: pts, start: [pts[0], pts[1]], end: [pts[pts.length - 2], pts[pts.length - 1]] };
}

/** Auto layouts by node count (fractions of the frame), chosen so hub connectors branch off one trunk without crossing cards. */
const AUTO_LAND: Vec[][] = [
  [[0.8, 0.4]],
  [[0.18, 0.4], [0.82, 0.4]],
  [[0.18, 0.4], [0.5, 0.76], [0.82, 0.4]],
  [[0.18, 0.4], [0.82, 0.4], [0.3, 0.8], [0.7, 0.8]],
  [[0.16, 0.22], [0.84, 0.22], [0.16, 0.62], [0.84, 0.62], [0.5, 0.82]],
  [[0.16, 0.2], [0.84, 0.2], [0.16, 0.6], [0.84, 0.6], [0.33, 0.84], [0.67, 0.84]],
];
const AUTO_PORT: Vec[][] = [
  [[0.5, 0.6]],
  [[0.27, 0.55], [0.73, 0.55]],
  [[0.27, 0.52], [0.5, 0.8], [0.73, 0.52]],
  [[0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
  [[0.27, 0.48], [0.73, 0.48], [0.27, 0.68], [0.73, 0.68], [0.5, 0.88]],
  [[0.27, 0.46], [0.73, 0.46], [0.27, 0.64], [0.73, 0.64], [0.27, 0.82], [0.73, 0.82]],
];

export function nodeTree(ctx: KitContext, params: Record<string, unknown>): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const portrait = H > W;
  const raw = list<TreeNode>(params.nodes, DEFAULT_NODES).slice(0, 6);
  const auto = (portrait ? AUTO_PORT : AUTO_LAND)[Math.max(0, raw.length - 1)];
  const nodes = raw.map((node, i) => ({ id: str(node.id, `n${i}`), label: str(node.label, `Node ${i + 1}`), detail: typeof node.detail === 'string' ? node.detail : '', x: num(node.x, auto[i][0]), y: num(node.y, auto[i][1]) }));
  const center = footageOf(params.center);
  const centerPos: Vec = portrait ? [0.5, 0.24] : [0.5, 0.4];
  const edges = list<[string, string]>(params.edges, nodes.map((node) => ['center', node.id] as [string, string])).filter((e) => Array.isArray(e) && e.length >= 2);
  const withExit = params.exit !== false;

  const cardW = portrait ? W * 0.42 : W * 0.25;
  const cardH = portrait ? H * 0.12 : H * 0.21;
  const hub: Box = center
    ? { cx: centerPos[0] * W, cy: centerPos[1] * H, w: portrait ? W * 0.32 : W * 0.12, h: portrait ? W * 0.4 : H * 0.28 }
    : { cx: centerPos[0] * W, cy: centerPos[1] * H, w: 70 * u, h: 70 * u };
  const boxes = new Map<string, Box>([['center', hub]]);
  nodes.forEach((node) => boxes.set(node.id, { cx: node.x * W, cy: node.y * H, w: cardW, h: cardH }));

  const hubAt = 0.2;
  const edgeAt = 0.85;
  const edgeStep = 0.65;
  const drawDur = 0.45;
  // Each node appears when the first edge reaching it lands (nodes nobody points at come last).
  const arrive = new Map<string, number>();
  edges.forEach(([, to], i) => { if (!arrive.has(to)) arrive.set(to, edgeAt + i * edgeStep + drawDur - 0.05); });
  let spare = edgeAt + edges.length * edgeStep;
  nodes.forEach((node) => { if (!arrive.has(node.id)) { arrive.set(node.id, spare); spare += 0.3; } });
  const settled = Math.max(...[...arrive.values()]) + 0.8;
  const duration = Math.max(num(params.duration, 0), settled + (withExit ? 1.9 : 1.5));
  const exitAt = withExit ? duration - 0.45 : null;

  const layers: Layer[] = [stage(ctx, 'stage', { glowY: 1.12, spread: 0.36 })];
  // Connectors under the cards.
  edges.forEach(([from, to], i) => {
    const a = boxes.get(from);
    const b = boxes.get(to);
    if (!a || !b) return;
    const at = edgeAt + i * edgeStep;
    const c = connector(a, b);
    layers.push({
      id: `edge-${i}`,
      name: `Edge ${from} → ${to}`,
      type: 'shape',
      in: at,
      transform: { position: [0, 0], anchor: [0, 0], opacity: fade(at, 0.2, exitAt, 0.3) },
      shape: { shape: 'path', points: c.points, closed: false, stroke: '#ffe1e6', strokeWidth: 2.5 * u, cap: 'round', trimEnd: keys<number>([at, 0, [0.4, 0, 0.2, 1]], [at + drawDur, 100]) },
      effects: [glowFx(10 * u, 0.8, p.pink)],
    } as Layer);
    const ends: [string, Vec, number][] = [['s', c.start, at], ['e', c.end, at + drawDur - 0.05]];
    for (const [tag, point, t] of ends) {
      layers.push({
        id: `dot-${i}-${tag}`,
        name: 'Connector dot',
        type: 'shape',
        in: t,
        transform: { position: point, scale: keys<number>([t, 0, 'back-out'], [t + 0.35, 100]), opacity: fade(t, 0.2, exitAt, 0.3) },
        shape: { shape: 'ellipse', size: [9 * u, 9 * u], fill: '#ffffff' },
        effects: [glowFx(10 * u, 0.9, p.pink)],
      } as Layer);
    }
  });
  // The hub: the speaker's card or a glowing star node.
  if (center) {
    layers.push(pipCard('center', center, ctx, { at: hubAt, size: [hub.w, hub.h], position: [hub.cx, hub.cy], fromX: 0, out: exitAt, radius: 16 * u }));
  } else {
    layers.push({
      id: 'center',
      name: 'Hub',
      type: 'shape',
      motionBlur: true,
      transform: { position: [hub.cx, hub.cy], scale: keys<number>([hubAt, 20, 'back-out'], [hubAt + 0.6, 100]), opacity: fade(hubAt, 0.4, exitAt, 0.3) },
      shape: { shape: 'ellipse', size: [hub.w, hub.h], gradient: { kind: 'radial', stops: [[0, '#ff6a80'], [1, '#a0102a']] }, stroke: '#ffffff', strokeWidth: 3 * u },
      effects: [glowFx(24 * u, 0.9, p.accent)],
    } as Layer);
    layers.push({ id: 'center-star', name: 'Hub star', type: 'shape', transform: { position: [hub.cx, hub.cy], rotation: keys<number>([hubAt, -72, 'expo-out'], [hubAt + 0.8, 0]), opacity: fade(hubAt + 0.1, 0.4, exitAt, 0.3) }, shape: { shape: 'star', size: [hub.w * 0.5, hub.w * 0.5], fill: '#ffffff' } } as Layer);
  }
  // Cards.
  nodes.forEach((node, i) => {
    const b = boxes.get(node.id)!;
    const at = arrive.get(node.id)!;
    const from = boxes.get(edges.find(([, to]) => to === node.id)?.[0] ?? 'center') ?? hub;
    const push = [Math.sign(b.cx - from.cx) * 26 * u, Math.sign(b.cy - from.cy) * 26 * u];
    layers.push({
      id: `card-${i}`,
      name: `Card ${node.label}`,
      type: 'shape',
      motionBlur: true,
      in: at - 0.05,
      transform: {
        position: keys<Vec>([at, [b.cx - push[0], b.cy - push[1]], 'expo-out'], [at + 0.7, [b.cx, b.cy]]),
        scale: keys<number>([at, 86, 'back-out'], [at + 0.6, 100]),
        opacity: fade(at, 0.4, exitAt, 0.3),
      },
      shape: { shape: 'rect', size: [b.w, b.h], radius: 16 * u, gradient: { kind: 'linear', stops: [[0, '#e3233f'], [0.55, '#8e0e24'], [1, '#4a0612']], from: [0, 0], to: [b.w * 0.7, b.h] }, stroke: '#ffb3c0aa', strokeWidth: 2 * u },
      backdrop: { blur: 24, saturation: 1.2, brightness: -6 },
      effects: [focusFx(at, 18 * u, 0.55, exitAt, 0.3), shadowFx(18 * u, 46 * u, 50)],
    } as Layer);
    const left = b.cx - b.w / 2 + 24 * u;
    const topY = b.cy - b.h / 2;
    const starSize = 34 * u;
    layers.push({ id: `star-${i}`, name: 'Star', type: 'shape', in: at, transform: { position: [left + starSize / 2, topY + 22 * u + starSize / 2], rotation: keys<number>([at + 0.1, -72, 'expo-out'], [at + 0.8, 0]), scale: keys<number>([at + 0.1, 0, 'back-out'], [at + 0.5, 100]), opacity: fade(at + 0.1, 0.3, exitAt, 0.3) }, shape: { shape: 'star', size: [starSize, starSize], fill: null, stroke: '#ffffff', strokeWidth: 1.8 * u } } as Layer);
    const labelSize = (portrait ? 48 : 50) * u;
    const detailSize = labelSize * 0.55;
    const labelY = node.detail ? b.cy + b.h * 0.12 : b.cy + b.h * 0.18;
    layers.push(text(`label-${i}`, node.label, ctx, { at: at + 0.15, size: labelSize, position: [left, labelY], weight: 700, stagger: 0.06, dx: -16 * u, dy: 0, blur: 12 * u, out: exitAt, glow: 10 * u, box: b.w - 48 * u }));
    if (node.detail) layers.push(writeOn(`detail-${i}`, node.detail, ctx, { at: at + 0.35, size: detailSize, position: [left, labelY + labelSize * 0.5 + detailSize * 0.7], color: '#ffe3e8', opacity: 72, out: exitAt, box: b.w - 48 * u }));
  });

  return scene(ctx, duration, layers, {
    cues: cues([
      [hubAt, 'pop', 'hub'],
      ...edges.map((_, i) => [edgeAt + i * edgeStep, 'whoosh', `edge ${i + 1}`] as [number, 'whoosh', string]),
      ...nodes.map((node) => [arrive.get(node.id)!, 'pop', node.label] as [number, 'pop', string]),
      ...(exitAt !== null ? [[exitAt, 'whoosh', 'out'] as [number, 'whoosh', string]] : []),
    ]),
    template: { id: 'node-tree', params },
  });
}

const NODE_TREE: TemplateSpec = {
  id: 'node-tree',
  label: 'Node tree',
  technique: 'T14',
  use: 'A skill/roadmap tree: glassy crimson cards (star icon, label, small detail) connected to a central node — optionally the speaker in a PiP — by lines that draw on one after another. Use for levels, branches or "what to learn next" maps.',
  params: {
    nodes: '{ id, label, detail?, x?, y? }[] — 1–6 cards; x/y are 0–1 fractions of the frame (default: auto layout around the centre)',
    edges: '[fromId, toId][] — "center" is the hub (default: hub → every node, in order)',
    center: 'footage { asset | path, in?, kind? } — the hub as a PiP card (optional; else a glowing star node)',
    exit: 'boolean — everything blurs away at the end (true)',
    duration: 'number s — minimum length',
  },
  seconds: 5,
  fullFrame: true,
  build: nodeTree,
};

export const STAGE_TEMPLATES: TemplateSpec[] = [HEX_ROADMAP, GLASS_TEACHING_CARD, RIBBON_TITLE, NUMBERED_LANES, DIAMOND_LIST_PIP, NODE_TREE];
