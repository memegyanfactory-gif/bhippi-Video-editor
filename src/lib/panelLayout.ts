// layout_panels: a scene's pictures and cards laid out so none sits half on another.
//
// The stacked-screenshots fault (several panels piled into one space) is what frame QA now
// reports inside a scene; this is its fix in one call. It measures the panels where they rest,
// keeps each one's shape (nothing cropped or stretched), gives each a slot inside the safe area
// (lib/layout.ts panelSlots), and moves and scales the layers to their slots. Entrances and exits
// keep their motion: every position key shifts by the same amount and every scale key by the same
// factor, so a card still flies in, only to its new place. The result is a list of
// update_motion_scene patches, so it lands as ordinary, undoable layer edits.
import { evaluateScene } from '../motion/evaluate';
import { transformPoint } from '../motion/math';
import type { Key, MotionScene, Prop, Vec } from '../motion/types';
import { bestArrangement, panelSlots, SAFE, type Box, type PanelArrangement } from './layout';
import { isPanel, restingLayerBoxes } from './polish';

export type PanelPatch = { layer: string; path: string; value: unknown };
export type PanelPlan = {
  at: number;
  arrangement: PanelArrangement;
  panels: { layer: string; name: string; from: Box; to: Box }[];
  patches: PanelPatch[];
  /** Panels left where they are, with why. */
  skipped: string[];
};
export type PanelOptions = { at?: number; layers?: string[]; arrangement?: PanelArrangement | 'auto'; gap?: number; margin?: number };

const round = (n: number) => Math.round(n * 100) / 100;
const isKeyed = <T>(prop: Prop<T> | undefined): prop is { k: Key<T>[] } => !!prop && typeof prop === 'object' && !Array.isArray(prop) && Array.isArray((prop as { k?: unknown }).k);

/** The top-level panels resting at `t` (none inside a precomp: those belong to its own scene). */
function restingPanels(scene: MotionScene, t: number, only?: string[]) {
  return restingLayerBoxes(scene, t).filter(({ layer, key }) => !key.includes('/') && isPanel(layer) && (!only?.length || only.includes(layer.id)));
}

/** The moment most panels rest: the one asked for, else the busiest of a few through the scene. */
function restingMoment(scene: MotionScene, options: PanelOptions): number {
  if (typeof options.at === 'number' && Number.isFinite(options.at)) return Math.min(Math.max(0, options.at), Math.max(0, scene.duration - 1e-3));
  const candidates = [0.3, 0.45, 0.6, 0.75, 0.9].map((f) => round(f * scene.duration));
  return candidates.reduce((best, t) => (restingPanels(scene, t, options.layers).length > restingPanels(scene, best, options.layers).length ? t : best));
}

const shiftPosition = (prop: Prop<Vec>, delta: [number, number]): Prop<Vec> => {
  const move = (v: Vec): Vec => [round(v[0] + delta[0]), round(v[1] + delta[1]), ...v.slice(2)] as Vec;
  return isKeyed(prop) ? { ...prop, k: prop.k.map((key) => ({ ...key, v: move(key.v) })) } : move(prop as Vec);
};

const scaleBy = (prop: Prop<number | Vec> | undefined, factor: number): Prop<number | Vec> => {
  const grow = (v: number | Vec): number | Vec => (typeof v === 'number' ? round(v * factor) : (v.map((n, i) => (i < 2 ? round(n * factor) : n)) as Vec));
  if (prop === undefined) return round(100 * factor);
  return isKeyed(prop) ? { ...prop, k: prop.k.map((key) => ({ ...key, v: grow(key.v) })) } : grow(prop as number | Vec);
};

/**
 * Where each resting panel of `scene` goes so none overlaps another, and the patches that move it
 * there; a string says why nothing can be laid out.
 */
export function planPanelLayout(scene: MotionScene, options: PanelOptions = {}): PanelPlan | string {
  const W = scene.width;
  const H = scene.height;
  const at = restingMoment(scene, options);
  const found = restingPanels(scene, at, options.layers);
  const skipped: string[] = [];
  const panels = found.filter(({ layer }) => {
    // A child's position is in its parent's space; moving it on the frame would fight the parent.
    if (layer.parent) { skipped.push(`${layer.name ?? layer.id} (moves with its parent ${layer.parent})`); return false; }
    return true;
  });
  if (!panels.length) return `No pictures or cards rest on screen at ${round(at)} s${options.layers?.length ? ` among ${options.layers.join(', ')}` : ''}: give at (a moment they rest) or layers (their ids, get_motion_scene lists them).`;
  const m = typeof options.margin === 'number' && options.margin >= 0 && options.margin < 0.3 ? options.margin : null;
  const area: Box = m === null
    ? { x: W * SAFE.left, y: H * SAFE.top, width: W * (1 - SAFE.left - SAFE.right), height: H * (1 - SAFE.top - SAFE.bottom) }
    : { x: W * m, y: H * m, width: W * (1 - 2 * m), height: H * (1 - 2 * m) };
  const gap = typeof options.gap === 'number' && options.gap > 0 ? (options.gap < 1 ? options.gap * W : options.gap) : W * 0.025;
  const px = (box: Box): Box => ({ x: box.x * W, y: box.y * H, width: box.width * W, height: box.height * H });
  const boxes = panels.map((panel) => ({ ...panel, px: px(panel.box) }));
  const aspects = (list: typeof boxes) => list.map((b) => b.px.width / Math.max(1e-6, b.px.height));
  const asked = options.arrangement && options.arrangement !== 'auto' ? options.arrangement : null;
  const arrangement = asked ?? bestArrangement(aspects(boxes), area, gap);
  // Reading order is kept: left to right for a row, top to bottom for a column, rows then columns
  // for a grid; a feature is led by the largest panel.
  const ordered = [...boxes].sort((a, b) => {
    if (arrangement === 'row') return a.px.x - b.px.x;
    if (arrangement === 'column') return a.px.y - b.px.y;
    if (arrangement === 'feature') return b.px.width * b.px.height - a.px.width * a.px.height;
    return Math.round((a.px.y - b.px.y) / (H * 0.1)) || a.px.x - b.px.x;
  });
  const slots = panelSlots(aspects(ordered), area, arrangement, gap);
  const frame = evaluateScene(scene, at, { motionBlur: false });
  const patches: PanelPatch[] = [];
  const placed: PanelPlan['panels'] = [];
  ordered.forEach((panel, i) => {
    const slot = slots[i];
    const entry = frame.layers.find((resolved) => resolved.layer.id === panel.layer.id);
    if (!entry) return;
    const factor = slot.width / Math.max(1e-6, panel.px.width);
    // Where the layer's anchor lands now, and where it must land so its box fills the slot.
    const given = panel.layer.transform?.anchor;
    const anchor = Array.isArray(given) ? given : [entry.size[0] / 2, entry.size[1] / 2];
    const point = transformPoint(entry.matrix, anchor[0], anchor[1], 0);
    const now: [number, number] = [point[0] / point[3], point[1] / point[3]];
    const centre = [panel.px.x + panel.px.width / 2, panel.px.y + panel.px.height / 2];
    const target = [slot.x + slot.width / 2 - (centre[0] - now[0]) * factor, slot.y + slot.height / 2 - (centre[1] - now[1]) * factor];
    const delta: [number, number] = [target[0] - now[0], target[1] - now[1]];
    const position = panel.layer.transform?.position ?? ([W / 2, H / 2] as Vec);
    if (Math.abs(delta[0]) > 0.5 || Math.abs(delta[1]) > 0.5) patches.push({ layer: panel.layer.id, path: 'transform.position', value: shiftPosition(position, delta) });
    if (Math.abs(factor - 1) > 0.005) patches.push({ layer: panel.layer.id, path: 'transform.scale', value: scaleBy(panel.layer.transform?.scale, factor) });
    const fraction = (b: Box): Box => ({ x: round(b.x / W), y: round(b.y / H), width: round(b.width / W), height: round(b.height / H) });
    placed.push({ layer: panel.layer.id, name: panel.layer.name ?? panel.layer.id, from: fraction(panel.px), to: fraction(slot) });
  });
  return { at: round(at), arrangement, panels: placed, patches, skipped };
}

/** The layers a plan moves, for the reply. */
export const describePlan = (plan: PanelPlan): string => plan.panels.map((p) => `${p.name} → ${Math.round(p.to.x * 100)}%,${Math.round(p.to.y * 100)}% ${Math.round(p.to.width * 100)}% wide`).join('; ');

