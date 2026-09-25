// Checks a MotionScene the AI (or a user) wrote before it reaches the timeline: shapes, ids,
// references, expressions and sizes. Returns human-readable problems; empty means valid.
import { isAnimated, isExpression } from './anim';
import { checkExpression } from './expr';
import { parseSvgPath } from './vector/path';
import { PARTICLE_PRESETS } from './particles';
import { FORM_KINDS, FORM_LOOKS } from './form';
import { ACTIONS, CHARACTER_KINDS } from './character/types';
import type { EffectType, Layer, MotionScene, ShapeItem } from './types';

const LAYER_TYPES = new Set(['footage', 'solid', 'procedural', 'particles', 'form', 'character', 'shape', 'text', 'null', 'camera', 'precomp']);
export const EFFECT_TYPES: EffectType[] = [
  'glow', 'gaussian-blur', 'directional-blur', 'zoom-blur', 'lens-blur', 'chromatic-aberration', 'vignette', 'grain', 'tint', 'duotone', 'black-white',
  'brightness-contrast', 'hue-saturation', 'levels', 'exposure', 'invert', 'fill', 'drop-shadow', 'stroke', 'halation', 'mosaic', 'pixel-sort',
  'displacement', 'turbulent-displace', 'wave-warp', 'rgb-split', 'lens-distortion', 'light-leak', 'liquid-glass', 'radial-gradient-overlay', 'matte-choke',
  'subject-reveal', 'matte-fill', 'matte-edge-glow', 'inner-shadow', 'inner-glow', 'bevel', 'gradient-overlay',
];
const EFFECTS = new Set<string>(EFFECT_TYPES);
const PROCEDURALS = new Set(['crimson-stage', 'radial-glow', 'linear-gradient', 'hex-field', 'grid', 'light-rails', 'noise', 'light-leak', 'dots', 'aurora', 'mesh-gradient', 'light-shafts', 'dot-wave']);
const BLENDS = new Set(['normal', 'add', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'lighten', 'darken', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

const ITEM_KINDS = new Set(['path', 'rect', 'ellipse', 'polygon', 'star', 'group', 'icon', 'array']);

/** What is wrong with a shape tree the AI wrote: unknown kinds, paths that draw nothing, empty groups. */
function shapeTreeProblems(items: unknown, name: string, where = 'shape.groups', depth = 0): string[] {
  if (!Array.isArray(items)) return [`${name}: ${where} must be a list of shape items.`];
  if (depth > 16) return [`${name}: ${where} nests too deep (16 levels max).`];
  const out: string[] = [];
  items.forEach((raw, i) => {
    const item = raw as ShapeItem;
    const at = `${where}[${i}]`;
    if (!item || typeof item !== 'object' || !ITEM_KINDS.has(item.kind)) { out.push(`${name}: ${at}.kind must be one of ${[...ITEM_KINDS].join(', ')}.`); return; }
    if (item.kind === 'path' && (typeof item.d !== 'string' || !parseSvgPath(item.d).some((sp) => sp.v.length > 1))) out.push(`${name}: ${at} needs d, SVG path data that draws something (M x y L … C … Z).`);
    if (item.kind === 'icon' && (typeof item.icon !== 'string' || !item.icon)) out.push(`${name}: ${at} needs icon, a Lucide icon name (search_icons finds them).`);
    if (item.kind === 'array' && (!item.item || !(Number(item.count) >= 1))) out.push(`${name}: ${at} (array) needs item (the shape to repeat, drawn around 0,0) and count >= 1.`);
    if (item.kind === 'array' && item.item) out.push(...shapeTreeProblems([item.item], name, `${at}.item`, depth + 1));
    if (item.kind === 'group') out.push(...shapeTreeProblems(item.items ?? [], name, `${at}.items`, depth + 1));
  });
  return out;
}

/** Visits every animatable value (anything shaped like a Prop) under `value`. */
function walkProps(value: unknown, path: string, visit: (prop: unknown, path: string) => void) {
  if (value === null || value === undefined) return;
  if (isAnimated(value as never) || isExpression(value as never)) { visit(value, path); return; }
  if (Array.isArray(value)) { value.forEach((item, i) => { if (item && typeof item === 'object') walkProps(item, `${path}[${i}]`, visit); }); return; }
  if (typeof value === 'object') for (const [key, inner] of Object.entries(value as Record<string, unknown>)) walkProps(inner, path ? `${path}.${key}` : key, visit);
}

export function validateScene(scene: unknown, depth = 0): string[] {
  const problems: string[] = [];
  if (!scene || typeof scene !== 'object') return ['The scene must be an object.'];
  const s = scene as MotionScene;
  const where = depth ? `precomp (depth ${depth})` : 'scene';
  if (s.version !== 1) problems.push(`${where}: version must be 1.`);
  if (!(s.width > 0 && s.width <= 8192 && s.height > 0 && s.height <= 8192)) problems.push(`${where}: width/height must be 1–8192 px.`);
  if (!(s.duration > 0 && s.duration <= 600)) problems.push(`${where}: duration must be 0–600 s.`);
  if (!Array.isArray(s.layers)) return [...problems, `${where}: layers must be an array.`];
  if (depth > 6) return [...problems, 'precomps nest deeper than 6.'];
  const ids = new Set<string>();
  for (const layer of s.layers as Layer[]) {
    const name = `${where} layer "${(layer as { id?: string })?.id ?? '?'}"`;
    if (!layer || typeof layer !== 'object') { problems.push(`${where}: a layer is not an object.`); continue; }
    if (typeof layer.id !== 'string' || !layer.id) problems.push(`${where}: every layer needs a string id.`);
    else if (ids.has(layer.id)) problems.push(`${name}: duplicate id.`);
    else ids.add(layer.id);
    if (!LAYER_TYPES.has(layer.type)) { problems.push(`${name}: unknown type "${String(layer.type)}".`); continue; }
    if (layer.blend && !BLENDS.has(layer.blend)) problems.push(`${name}: unknown blend "${layer.blend}".`);
    if (typeof layer.in === 'number' && typeof layer.out === 'number' && !(layer.out > layer.in)) problems.push(`${name}: out must be after in.`);
    if (typeof layer.in === 'number' && layer.in >= s.duration) problems.push(`${name}: in must be before the scene's end.`);
    for (const effect of layer.effects ?? []) if (!EFFECTS.has(effect?.type)) problems.push(`${name}: unknown effect "${String(effect?.type)}" (known: ${EFFECT_TYPES.join(', ')}).`);
    if (layer.type === 'procedural' && !PROCEDURALS.has(layer.kind)) problems.push(`${name}: unknown procedural kind "${layer.kind}".`);
    if (layer.type === 'character') {
      if (!(CHARACTER_KINDS as readonly string[]).includes(layer.character?.kind)) problems.push(`${name}: character kind must be one of ${CHARACTER_KINDS.join(', ')}.`);
      for (const [i, action] of (layer.character?.actions ?? []).entries()) {
        if (!(ACTIONS as readonly string[]).includes(action?.do)) problems.push(`${name}: actions[${i}].do must be one of ${ACTIONS.join(', ')}.`);
        else if (typeof action.t !== 'number') problems.push(`${name}: actions[${i}] needs a time t.`);
      }
    }
    if (layer.type === 'form' && !(FORM_KINDS as readonly string[]).includes(layer.form?.kind)) problems.push(`${name}: form kind must be one of ${FORM_KINDS.join(', ')}.`);
    if (layer.type === 'form' && layer.form?.morph && !(FORM_KINDS as readonly string[]).includes(layer.form.morph.to)) problems.push(`${name}: form morph.to must be a form kind.`);
    if (layer.type === 'form' && layer.form?.look && !(FORM_LOOKS as readonly string[]).includes(layer.form.look)) problems.push(`${name}: form look must be one of ${FORM_LOOKS.join(', ')}.`);
    if (layer.type === 'particles' && !(PARTICLE_PRESETS as readonly string[]).includes(layer.particles?.preset)) problems.push(`${name}: particles need a preset (${PARTICLE_PRESETS.join(', ')}).`);
    if (layer.type === 'footage' && !layer.source?.asset && !layer.source?.path && !layer.source?.sequence) problems.push(`${name}: footage needs source.asset (a project asset id), source.path or source.sequence.`);
    if (layer.type === 'footage' && layer.source?.sequence) {
      const q = layer.source.sequence;
      if (typeof q.dir !== 'string' || !q.dir) problems.push(`${name}: source.sequence.dir must be the folder of numbered frames.`);
      if (!(q.fps > 0) || !(q.frames >= 1)) problems.push(`${name}: source.sequence needs fps > 0 and frames ≥ 1.`);
    }
    if (layer.type === 'text' && !layer.text?.text && !layer.text?.spans?.length && !layer.text?.counter) problems.push(`${name}: text needs text, spans or counter.`);
    if (layer.type === 'shape' && !layer.shape?.shape && !layer.shape?.groups?.length) problems.push(`${name}: shape needs shape.shape (a primitive) or shape.groups (a shape tree).`);
    if (layer.type === 'shape' && layer.shape?.groups) problems.push(...shapeTreeProblems(layer.shape.groups, name));
    if (layer.type === 'precomp') problems.push(...validateScene(layer.scene, depth + 1));
    walkProps(layer, '', (prop, path) => {
      if (isExpression(prop as never)) {
        const error = checkExpression((prop as { expr: string }).expr);
        if (error) problems.push(`${name}: expression at ${path}: ${error}`);
      } else if (isAnimated(prop as never)) {
        const keys = (prop as { k: { t: unknown }[] }).k;
        if (!keys.every((key) => typeof key?.t === 'number' && Number.isFinite(key.t))) problems.push(`${name}: keyframes at ${path} need numeric t.`);
      }
    });
  }
  for (const layer of s.layers as Layer[]) {
    if (layer?.parent && !ids.has(layer.parent)) problems.push(`${where} layer "${layer.id}": parent "${layer.parent}" does not exist.`);
    for (const link of layer?.link ?? []) {
      if (!['position', 'scale', 'rotation', 'opacity'].includes(link?.prop)) problems.push(`${where} layer "${layer.id}": link prop must be position, scale, rotation or opacity.`);
      else if (!ids.has(link.from) || link.from === layer.id) problems.push(`${where} layer "${layer.id}": link from "${link.from}" must be another layer of this scene.`);
    }
    if (layer?.matte && !ids.has(layer.matte.layer)) problems.push(`${where} layer "${layer.id}": matte layer "${layer.matte.layer}" does not exist.`);
  }
  return problems;
}

/** Footage asset ids a scene uses (for bin usage and export checks). */
export function sceneAssets(scene: MotionScene, out = new Set<string>()): Set<string> {
  for (const layer of scene.layers) {
    if (layer.type === 'footage' && layer.source.asset) out.add(layer.source.asset);
    if (layer.type === 'precomp') sceneAssets(layer.scene, out);
  }
  return out;
}

/**
 * Where an overlay scene draws, as fractions of its canvas (frame QA): the union of its text and
 * shape layers at 80% of its length. Null for scenes that carry their own footage or a full
 * stage (they are the picture, not something laid over it).
 */
export function overlayBox(scene: MotionScene, evaluate: (scene: MotionScene, t: number) => { layers: { layer: Layer; active: boolean; size: [number, number]; matrix: Float64Array }[] }): { x: number; y: number; width: number; height: number } | null {
  if (scene.layers.some((layer) => layer.type === 'footage' || layer.type === 'procedural' || (layer.type === 'solid' && !layer.size) || layer.type === 'precomp')) return null;
  const frame = evaluate(scene, scene.duration * 0.8);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const entry of frame.layers) {
    if (!entry.active || (entry.layer.type !== 'text' && entry.layer.type !== 'shape' && entry.layer.type !== 'solid')) continue;
    const [w, h] = entry.size;
    for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const m = entry.matrix;
      const X = m[0] * px + m[4] * py + m[12];
      const Y = m[1] * px + m[5] * py + m[13];
      const W = m[3] * px + m[7] * py + m[15];
      if (W <= 1e-6) continue;
      x0 = Math.min(x0, X / W); y0 = Math.min(y0, Y / W); x1 = Math.max(x1, X / W); y1 = Math.max(y1, Y / W);
    }
  }
  if (!Number.isFinite(x0)) return null;
  const cx = (v: number, max: number) => Math.min(1, Math.max(0, v / max));
  const bx = cx(x0, scene.width);
  const by = cx(y0, scene.height);
  return { x: bx, y: by, width: cx(x1, scene.width) - bx, height: cx(y1, scene.height) - by };
}
