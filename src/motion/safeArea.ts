// Keeps a motion scene's type and panels inside the picture. A layer is judged where it rests — on
// screen, mostly opaque and not moving — so an entrance that slides in from off frame is fine and
// a card that settles half outside it is not. Layers that overlap where they rest (a panel and the
// words on it) are one cluster and move together, so a design keeps its alignment.
//
// Full-frame layers (stages, plates, cover footage, a frame-sized shot) and 3D layers are left
// alone: they bleed by design. A full-width band may bleed left and right, a full-height one top
// and bottom.
import { entryBounds, type ResolvedFrame } from './evaluate';
import { evaluateMeasured } from './measure';
import { isAnimated, isExpression } from './anim';
import { SAFE, SOCIAL_SAFE } from '../lib/layout';
import type { Layer, MotionScene, Prop, Vec } from './types';

export type Box = { x: number; y: number; width: number; height: number };
export type LayoutIssue = {
  /** Layer ids of the cluster, and readable names. */
  layers: string[];
  names: string[];
  /** Scene second where the cluster rests furthest out. */
  at: number;
  /** Pixels past each safe edge (0 when inside). */
  overflow: { left: number; right: number; top: number; bottom: number };
  /** Whether any of it rests past the edge of the frame itself (not just the margin). */
  offFrame: boolean;
  /** Whether the cluster carries information (type, footage, a card) — the fitter only moves those. */
  fixable: boolean;
};

export type Margins = { top: number; bottom: number; left: number; right: number };

/**
 * Margins as fractions of the frame: one number for every side, per axis, or per side. The default
 * is the editor's safe area for the scene's orientation (lib/layout.ts, the one frame QA checks):
 * SAFE (5% at the sides, 6% top and bottom) for a wide frame, SOCIAL_SAFE (6% at the sides, 12%
 * top, 18% bottom, clear of the platform's buttons) for a tall one.
 */
export type SafeOptions = { margin?: number | { x: number; y: number } | Margins; step?: number; evaluate?: (scene: MotionScene, t: number) => ResolvedFrame };

/** The per-side margins `margin` stands for in `scene`. */
export function safeMargins(scene: { width: number; height: number }, margin?: SafeOptions['margin']): Margins {
  if (typeof margin === 'number') return { top: margin, bottom: margin, left: margin, right: margin };
  if (margin && 'x' in margin) return { top: margin.y, bottom: margin.y, left: margin.x, right: margin.x };
  return { ...(margin ?? (scene.height > scene.width ? SOCIAL_SAFE : SAFE)) };
}

function safeRect(scene: MotionScene, margin: SafeOptions['margin']) {
  const m = safeMargins(scene, margin);
  return { x0: scene.width * m.left, y0: scene.height * m.top, x1: scene.width * (1 - m.right), y1: scene.height * (1 - m.bottom) };
}

const FULL = 0.9;

type Sample = { t: number; box: Box; opacity: number };

function roots(scene: MotionScene): Map<string, string> {
  const byId = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const out = new Map<string, string>();
  for (const layer of scene.layers) {
    let root = layer;
    for (let guard = 0; root.parent && byId.has(root.parent) && guard < 32; guard++) root = byId.get(root.parent)!;
    out.set(layer.id, root.id);
  }
  return out;
}

/** Layers whose place the check judges. */
function candidates(scene: MotionScene): Layer[] {
  const matteSources = new Set(scene.layers.map((layer) => layer.matte?.layer).filter(Boolean));
  return scene.layers.filter((layer) => {
    if (layer.hidden || layer.ref || layer.adjustment || layer.threeD || layer.bleed || matteSources.has(layer.id)) return false;
    if (layer.type === 'null' || layer.type === 'camera' || layer.type === 'procedural' || layer.type === 'particles') return false;
    if ((layer.type === 'solid' || layer.type === 'footage') && !layer.size) return false;
    return true;
  });
}

const informational = (layer: Layer) => layer.type === 'text' || layer.type === 'footage' || layer.type === 'precomp';
const overlaps = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

/** Where every candidate rests: samples on screen, at least half opaque, not moving. */
function restSamples(scene: MotionScene, options: SafeOptions): Map<string, Sample[]> {
  const step = options.step ?? 1 / 15;
  const evaluate = options.evaluate ?? ((s: MotionScene, t: number) => evaluateMeasured(s, t));
  const list = candidates(scene);
  const ids = new Set(list.map((layer) => layer.id));
  const rest = new Map<string, Sample[]>(list.map((layer) => [layer.id, []]));
  const previous = new Map<string, Box>();
  const count = Math.min(240, Math.max(2, Math.ceil(scene.duration / step)));
  for (let i = 0; i < count; i++) {
    const t = Math.min(scene.duration - 1e-3, (i * scene.duration) / count);
    const frame = evaluate(scene, t);
    const seen = new Set<string>();
    for (const entry of frame.layers) {
      const id = entry.layer.id;
      if (!ids.has(id) || !entry.active) continue;
      const box = entryBounds(entry.matrix, entry.size);
      if (!box) continue;
      seen.add(id);
      const before = previous.get(id);
      previous.set(id, box);
      if (entry.opacity < 0.5 || !before) continue;
      const moving = Math.abs(box.x - before.x) > 2.5 || Math.abs(box.y - before.y) > 2.5 || Math.abs(box.width - before.width) > 2.5 || Math.abs(box.height - before.height) > 2.5;
      // A frame-sized moment (the shot before it becomes a card) is the picture, not a panel.
      const fullFrame = box.width >= scene.width * FULL && box.height >= scene.height * FULL;
      if (!moving && !fullFrame) rest.get(id)!.push({ t, box, opacity: entry.opacity });
    }
    for (const id of [...previous.keys()]) if (!seen.has(id)) previous.delete(id);
  }
  return rest;
}

/** Clusters of candidates that overlap where they rest, each with how far it rests past the safe area. */
export function layoutIssues(scene: MotionScene, options: SafeOptions = {}): LayoutIssue[] {
  const safe = safeRect(scene, options.margin);
  const rest = restSamples(scene, options);
  const byId = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const ids = [...rest.keys()].filter((id) => rest.get(id)!.length);
  // Union-find over layers whose rest boxes overlap at the same moment.
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = rest.get(ids[i])!;
    const b = rest.get(ids[j])!;
    if (a.some((sa) => b.some((sb) => Math.abs(sa.t - sb.t) < 1e-6 && overlaps(sa.box, sb.box)))) parent.set(find(ids[i]), find(ids[j]));
  }
  const clusters = new Map<string, string[]>();
  for (const id of ids) clusters.set(find(id), [...(clusters.get(find(id)) ?? []), id]);
  const issues: LayoutIssue[] = [];
  for (const members of clusters.values()) {
    const overflow = { left: 0, right: 0, top: 0, bottom: 0 };
    let offFrame = false;
    let worst = { at: 0, amount: 0 };
    for (const id of members) {
      const text = byId.get(id)?.type === 'text';
      for (const { t, box } of rest.get(id)!) {
        // Type never bleeds: a headline wider than the frame is too big, not a band.
        const bandX = !text && box.width >= scene.width * FULL;
        const bandY = !text && box.height >= scene.height * FULL;
        const out = {
          left: bandX ? 0 : Math.max(0, safe.x0 - box.x),
          right: bandX ? 0 : Math.max(0, box.x + box.width - safe.x1),
          top: bandY ? 0 : Math.max(0, safe.y0 - box.y),
          bottom: bandY ? 0 : Math.max(0, box.y + box.height - safe.y1),
        };
        overflow.left = Math.max(overflow.left, out.left);
        overflow.right = Math.max(overflow.right, out.right);
        overflow.top = Math.max(overflow.top, out.top);
        overflow.bottom = Math.max(overflow.bottom, out.bottom);
        if ((!bandX && (box.x < -1 || box.x + box.width > scene.width + 1)) || (!bandY && (box.y < -1 || box.y + box.height > scene.height + 1))) offFrame = true;
        const amount = out.left + out.right + out.top + out.bottom;
        if (amount > worst.amount) worst = { at: t, amount };
      }
    }
    if (worst.amount <= 1) continue;
    const layers = members.map((id) => byId.get(id)!).filter(Boolean);
    issues.push({
      layers: members,
      names: layers.map((layer) => layer.name?.trim() || (layer.type === 'text' ? (layer.text.text ?? '').slice(0, 24) : '') || layer.id),
      at: worst.at,
      overflow: { left: Math.round(overflow.left), right: Math.round(overflow.right), top: Math.round(overflow.top), bottom: Math.round(overflow.bottom) },
      offFrame,
      fixable: layers.some(informational),
    });
  }
  return issues.sort((a, b) => Number(b.offFrame) - Number(a.offFrame) || a.at - b.at);
}

/** Applies `map` to every value of a position prop (static, keyed, or an expression's base and keys). */
function mapVec(prop: Prop<Vec> | undefined, fallback: Vec, map: (v: Vec) => Vec): Prop<Vec> {
  if (prop === undefined) return map(fallback);
  if (Array.isArray(prop)) return map(prop);
  if (isAnimated(prop)) return { ...prop, k: prop.k.map((key) => ({ ...key, v: map(key.v) })) };
  if (isExpression(prop)) return { ...prop, ...(prop.v !== undefined ? { v: map(prop.v) } : {}), ...(prop.k ? { k: prop.k.map((key) => ({ ...key, v: map(key.v) })) } : {}) };
  return prop;
}

function mapScale(prop: Prop<number | Vec> | undefined, factor: number): Prop<number | Vec> {
  const scale = (v: number | Vec): number | Vec => (typeof v === 'number' ? v * factor : v.map((x) => x * factor));
  if (prop === undefined) return 100 * factor;
  if (typeof prop === 'number' || Array.isArray(prop)) return scale(prop);
  if (isAnimated(prop)) return { ...prop, k: prop.k.map((key) => ({ ...key, v: scale(key.v) })) };
  if (isExpression(prop)) return { ...prop, ...(prop.v !== undefined ? { v: scale(prop.v) } : {}), ...(prop.k ? { k: prop.k.map((key) => ({ ...key, v: scale(key.v) })) } : {}) };
  return prop;
}

export type Fitted = { scene: MotionScene; moved: { names: string[]; dx: number; dy: number; scale: number }[]; remaining: LayoutIssue[] };

/**
 * Moves (and, when a cluster is wider or taller than the safe area, shrinks) every informational
 * cluster that rests outside the safe area back inside it. The move is applied to each member's
 * top parent, so rigs, cards and the words on them travel together. Returns what moved and what
 * could not be fixed (decorative shapes, 3D, clusters that keep moving).
 */
export function fitToSafeArea(scene: MotionScene, options: SafeOptions = {}): Fitted {
  const safe = safeRect(scene, options.margin);
  let current = scene;
  const moved: Fitted['moved'] = [];
  for (let pass = 0; pass < 3; pass++) {
    const issues = layoutIssues(current, options).filter((issue) => issue.fixable);
    if (!issues.length) break;
    const rest = restSamples(current, options);
    const rootOf = roots(current);
    const byId = new Map(current.layers.map((layer) => [layer.id, layer]));
    const changes = new Map<string, { dx: number; dy: number; scale: number; cx: number; cy: number }>();
    for (const issue of issues) {
      const boxes = issue.layers.flatMap((id) => rest.get(id) ?? []).map((sample) => sample.box);
      if (!boxes.length) continue;
      const hasText = issue.layers.some((id) => byId.get(id)?.type === 'text');
      const bandX = !hasText && boxes.every((box) => box.width >= current.width * FULL);
      const bandY = !hasText && boxes.every((box) => box.height >= current.height * FULL);
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.width));
      const y1 = Math.max(...boxes.map((b) => b.y + b.height));
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const scale = Math.max(0.3, Math.min(1, bandX ? 1 : (safe.x1 - safe.x0) / (x1 - x0), bandY ? 1 : (safe.y1 - safe.y0) / (y1 - y0)));
      const nx0 = cx + (x0 - cx) * scale;
      const nx1 = cx + (x1 - cx) * scale;
      const ny0 = cy + (y0 - cy) * scale;
      const ny1 = cy + (y1 - cy) * scale;
      const dx = bandX ? 0 : nx0 < safe.x0 ? safe.x0 - nx0 : nx1 > safe.x1 ? safe.x1 - nx1 : 0;
      const dy = bandY ? 0 : ny0 < safe.y0 ? safe.y0 - ny0 : ny1 > safe.y1 ? safe.y1 - ny1 : 0;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && scale > 0.999) continue;
      for (const id of issue.layers) {
        const root = rootOf.get(id) ?? id;
        if (byId.get(root)?.threeD || changes.has(root)) continue;
        changes.set(root, { dx, dy, scale, cx, cy });
      }
      moved.push({ names: issue.names, dx: Math.round(dx), dy: Math.round(dy), scale: Math.round(scale * 1000) / 1000 });
    }
    if (!changes.size) break;
    current = {
      ...current,
      layers: current.layers.map((layer) => {
        const change = changes.get(layer.id);
        if (!change) return layer;
        const { dx, dy, scale, cx, cy } = change;
        const place = (v: Vec): Vec => [cx + (v[0] - cx) * scale + dx, cy + (v[1] - cy) * scale + dy, ...v.slice(2)];
        const transform = { ...(layer.transform ?? {}) };
        transform.position = mapVec(transform.position, [current.width / 2, current.height / 2], place);
        if (scale < 0.999) transform.scale = mapScale(transform.scale, scale);
        return { ...layer, transform } as Layer;
      }),
    };
  }
  return { scene: current, moved, remaining: layoutIssues(current, options) };
}
