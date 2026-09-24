// Resolves a MotionScene at one moment into a flat list of layers with their final matrices,
// opacities, masks and effect parameters. Pure: no DOM, no GL — the GPU executor, thumbnails,
// frame QA and the tests all read the same answer.
import { layerTime, num, vec, valueOf, isAnimated, isExpression, type ExprContext } from './anim';
import { identity, lookAt, multiply, perspective, rotationX, rotationY, rotationZ, scaling, skewing, transformPoint, translation, type Mat4 } from './math';
import type { Effect, Layer, Mask, MotionScene, Prop, Vec } from './types';
import { treeBounds } from './vector/shapes';

/** Layer-space size of a layer's content in pixels (text needs measuring, so the host supplies it). */
export type SizeOf = (layer: Layer, t: number) => [number, number];
/** A layer's default anchor when it sets none (text anchors at its alignment edge, like AE). */
export type AnchorOf = (layer: Layer, size: [number, number], t: number) => Vec | null;

export type ResolvedMask = { shape: Mask['shape']; box: Vec; radius: number; points: Vec; mode: 'add' | 'subtract' | 'intersect'; feather: number; expansion: number; opacity: number; inverted: boolean };
export type ResolvedEffect = { type: Effect['type']; params: Record<string, unknown> };

export type ResolvedLayer = {
  layer: Layer;
  index: number;
  /** In its in/out window at this time. */
  active: boolean;
  size: [number, number];
  /** Layer pixels → canvas homogeneous pixels (divide x, y by w). */
  matrix: Mat4;
  /** Extra matrices for motion blur (empty when the layer does not blur or does not move). */
  blurMatrices: Mat4[];
  opacity: number;
  is3D: boolean;
  /** Camera-space depth of the layer's centre (3D layers), for back-to-front sorting. */
  depth: number;
  masks: ResolvedMask[];
  effects: ResolvedEffect[];
  /** Scene seconds the content is sampled at (the layer's own time for precomps/footage remaps). */
  time: number;
  /** Camera depth-of-field blur for this layer: gaussian sigma in *layer* pixels (0 = sharp). */
  defocus: number;
};

export type CameraDof = { band: number; near: number; far: number; max: number };
export type CameraState = { eye: Vec; target: Vec; zoom: number; view: Mat4; projection: Mat4; focus: number; aperture: number; dof: CameraDof };

const NO_DOF: CameraDof = { band: 0, near: 1, far: 1, max: 48 };

/**
 * The circle-of-confusion blur (screen-pixel sigma) of a point `depth` px in front of the camera:
 * AE's thin-lens model, blur radius = aperture × |d − focus| / d × zoom / focus, with a sharp band
 * around the focus and separate near/far strengths (a 2.5D look keeps a band sharp and softens
 * both sides; the reference Motion Tricks film is sharp across a 2.2× depth band).
 */
export function defocusSigma(camera: CameraState, depth: number): number {
  if (camera.aperture <= 0 || depth <= 1e-3 || camera.focus <= 0) return 0;
  const off = Math.max(0, Math.abs(depth - camera.focus) - camera.dof.band / 2);
  if (off <= 0) return 0;
  const strength = depth < camera.focus ? camera.dof.near : camera.dof.far;
  const radius = camera.aperture * (off / depth) * (camera.zoom / camera.focus) * strength;
  return Math.min(camera.dof.max, radius / 2);
}

/** Screen pixels per layer pixel where a layer lands (0 when it is behind the camera). */
export function projectedScale(matrix: Mat4, size: [number, number]): number {
  const [w, h] = size;
  if (w <= 0 || h <= 0) return 0;
  const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => transformPoint(matrix, x, y, 0)).filter((p) => p[3] > 1e-6).map((p) => [p[0] / p[3], p[1] / p[3]]);
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.sqrt(Math.abs(area / 2) / (w * h));
}

export type ResolvedFrame = {
  time: number;
  width: number;
  height: number;
  layers: ResolvedLayer[];
  camera: CameraState;
  /** Draw order: indexes into `layers`, bottom first, with runs of 3D layers depth-sorted. */
  order: number[];
};

export const DEFAULT_ZOOM_RATIO = 2666.7 / 1920;

const isPropValue = (value: unknown): boolean =>
  typeof value === 'number' || (Array.isArray(value) && value.every((v) => typeof v === 'number')) || isAnimated(value as Prop) || isExpression(value as Prop);

/** Evaluates every animatable param of an effect; strings, booleans and objects pass through. */
export function resolveEffect(effect: Effect, t: number, ctx: ExprContext): ResolvedEffect {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(effect)) {
    if (key === 'type' || key === 'enabled') continue;
    if (isPropValue(value)) {
      const resolved = valueOf(value as Prop, t, 0, ctx);
      params[key] = resolved;
    } else params[key] = value;
  }
  return { type: effect.type, params };
}

function resolveMask(mask: Mask, size: [number, number], t: number, ctx: ExprContext): ResolvedMask {
  return {
    shape: mask.shape,
    box: vec(mask.box, t, [0, 0, size[0], size[1]], ctx),
    radius: num(mask.radius, t, 0, ctx),
    points: vec(mask.points, t, [], ctx),
    mode: mask.mode ?? 'add',
    feather: Math.max(0, num(mask.feather, t, 0, ctx)),
    expansion: num(mask.expansion, t, 0, ctx),
    opacity: Math.max(0, Math.min(100, num(mask.opacity, t, 100, ctx))) / 100,
    inverted: !!mask.inverted,
  };
}

export function defaultSize(scene: Pick<MotionScene, 'width' | 'height'>, layer: Layer, t: number): [number, number] {
  switch (layer.type) {
    case 'footage':
    case 'solid':
    case 'procedural': {
      const size = layer.size;
      return size ? [size[0], size[1]] : [scene.width, scene.height];
    }
    case 'shape': {
      const shape = layer.shape;
      if (shape.groups?.length) {
        if (shape.bounds) return [Math.max(1, shape.bounds[0]), Math.max(1, shape.bounds[1] ?? shape.bounds[0])];
        const box = treeBounds(shape.groups, t, { seed: 1 });
        return box ? [Math.max(1, box.x + box.width), Math.max(1, box.y + box.height)] : [1, 1];
      }
      if (shape.size !== undefined) {
        const s = vec(shape.size, t, [100, 100]);
        return [Math.max(1, s[0]), Math.max(1, s[1])];
      }
      const points = vec(shape.points, t, []);
      let w = 1;
      let h = 1;
      for (let i = 0; i + 1 < points.length; i += 2) { w = Math.max(w, points[i]); h = Math.max(h, points[i + 1]); }
      const pad = num(shape.strokeWidth, t, 0);
      return [w + pad, h + pad];
    }
    case 'precomp':
      return [layer.scene.width, layer.scene.height];
    case 'text':
      return [scene.width, scene.height];
    default:
      return [0, 0];
  }
}

type Local = { matrix: Mat4; opacity: number; is3D: boolean };

/** The layer's transform with its cross-layer links resolved to plain values at `t`. */
function linkedTransform(layer: Layer, scene: MotionScene, t: number, ctx: ExprContext): NonNullable<Layer['transform']> {
  const tr = layer.transform ?? {};
  if (!layer.link?.length) return tr;
  const out = { ...tr };
  for (const link of layer.link) {
    const source = scene.layers.find((l) => l.id === link.from);
    if (!source || source === layer) continue;
    const st = source.transform ?? {};
    const at = t - (link.delay ?? 0);
    const mul = link.multiply ?? 1;
    const add = typeof link.offset === 'number' ? link.offset : 0;
    if (link.prop === 'position') {
      const v = vec(st.position, at, source.parent ? [0, 0, 0] : [scene.width / 2, scene.height / 2, 0], ctx);
      const o = Array.isArray(link.offset) ? link.offset : [0, 0, 0];
      out.position = [v[0] + (o[0] ?? 0), v[1] + (o[1] ?? 0), (v[2] ?? 0) + (o[2] ?? 0)];
    } else if (link.prop === 'scale') {
      const v = valueOf<number | Vec>(st.scale, at, 100, ctx);
      out.scale = (typeof v === 'number' ? v : v[0] ?? 100) * mul + add;
    } else if (link.prop === 'rotation') out.rotation = num(st.rotation, at, 0, ctx) * mul + add;
    else out.opacity = num(st.opacity, at, 100, ctx) * mul + add;
  }
  return out;
}

function localTransform(layer: Layer, size: [number, number], scene: MotionScene, t: number, ctx: ExprContext, anchorOf?: AnchorOf): Local {
  const tr = linkedTransform(layer, scene, t, ctx);
  const is3D = !!layer.threeD;
  const fallbackAnchor = (tr.anchor === undefined && anchorOf?.(layer, size, t)) || [size[0] / 2, size[1] / 2, 0];
  const anchor = vec(tr.anchor, t, [fallbackAnchor[0], fallbackAnchor[1], fallbackAnchor[2] ?? 0], ctx);
  const position = vec(tr.position, t, layer.parent ? [0, 0, 0] : [scene.width / 2, scene.height / 2, 0], ctx);
  const scaleValue = valueOf<number | Vec>(tr.scale, t, 100, ctx);
  const scale = typeof scaleValue === 'number' ? [scaleValue, scaleValue, scaleValue] : [scaleValue[0] ?? 100, scaleValue[1] ?? scaleValue[0] ?? 100, scaleValue[2] ?? 100];
  const rz = num(tr.rotation, t, 0, ctx);
  const opacity = Math.max(0, Math.min(100, num(tr.opacity, t, 100, ctx))) / 100;
  let m = translation(position[0], position[1], is3D ? position[2] ?? 0 : 0);
  m = multiply(m, rotationZ(rz));
  if (is3D) {
    m = multiply(m, rotationY(num(tr.rotationY, t, 0, ctx)));
    m = multiply(m, rotationX(num(tr.rotationX, t, 0, ctx)));
  }
  const skew = num(tr.skew, t, 0, ctx);
  if (skew) m = multiply(m, skewing(skew, num(tr.skewAxis, t, 0, ctx)));
  m = multiply(m, scaling(scale[0] / 100, scale[1] / 100, is3D ? scale[2] / 100 : 1));
  m = multiply(m, translation(-anchor[0], -anchor[1], is3D ? -(anchor[2] ?? 0) : 0));
  return { matrix: m, opacity, is3D };
}

/** World matrices (layer pixels → scene pixels, before the camera) for every layer at `t`. */
function worldMatrices(scene: MotionScene, t: number, sizeOf: SizeOf, ctx: (index: number) => ExprContext, anchorOf?: AnchorOf) {
  const byId = new Map(scene.layers.map((layer, index) => [layer.id, index]));
  const cache = new Map<number, { world: Mat4; local: Local; size: [number, number] }>();
  const visiting = new Set<number>();
  const resolve = (index: number): { world: Mat4; local: Local; size: [number, number] } => {
    const hit = cache.get(index);
    if (hit) return hit;
    const layer = scene.layers[index];
    const lt = layerTime(layer, t);
    const size = sizeOf(layer, lt);
    const local = localTransform(layer, size, scene, lt, ctx(index), anchorOf);
    let world = local.matrix;
    const parentIndex = layer.parent !== undefined ? byId.get(layer.parent) : undefined;
    if (parentIndex !== undefined && !visiting.has(parentIndex) && parentIndex !== index) {
      visiting.add(index);
      world = multiply(resolve(parentIndex).world, local.matrix);
      visiting.delete(index);
    }
    const entry = { world, local, size };
    cache.set(index, entry);
    return entry;
  };
  return { resolve, byId };
}

/** The active camera: the topmost camera layer in its window, else AE's default 50 mm camera. */
function cameraAt(scene: MotionScene, t: number, world: (index: number) => Mat4, ctx: (index: number) => ExprContext): CameraState {
  const defaultZoom = scene.width * DEFAULT_ZOOM_RATIO;
  for (let index = scene.layers.length - 1; index >= 0; index--) {
    const layer = scene.layers[index];
    if (layer.type !== 'camera') continue;
    if (t < (layer.in ?? 0) || t >= (layer.out ?? Infinity)) continue;
    const c = ctx(index);
    // The camera's own clock (its clip may sit anywhere on a layered comp's timeline).
    const lt = layerTime(layer, t);
    const zoom = Math.max(1, num(layer.zoom, lt, defaultZoom, c));
    const tr = layer.transform ?? {};
    const localEye = vec(tr.position, lt, [scene.width / 2, scene.height / 2, -zoom], c);
    const localTarget = vec(layer.pointOfInterest, lt, [scene.width / 2, scene.height / 2, 0], c);
    let eye = localEye;
    let target = localTarget;
    if (layer.parent) {
      const parentIndex = scene.layers.findIndex((l) => l.id === layer.parent);
      if (parentIndex >= 0) {
        const pw = world(parentIndex);
        const e = transformPoint(pw, localEye[0], localEye[1], localEye[2] ?? 0);
        const g = transformPoint(pw, localTarget[0], localTarget[1], localTarget[2] ?? 0);
        eye = [e[0], e[1], e[2]];
        target = [g[0], g[1], g[2]];
      }
    }
    // A camera that only moves (no point of interest animation) still looks straight ahead of
    // itself when its position was animated but not its target: AE's one-node camera.
    if (layer.pointOfInterest === undefined) target = [eye[0], eye[1], (eye[2] ?? 0) + zoom];
    let view = lookAt([eye[0], eye[1], eye[2] ?? -zoom], [target[0], target[1], target[2] ?? 0]);
    const roll = num(tr.rotation, lt, 0, c);
    if (roll) view = multiply(rotationZ(-roll), view);
    const d = layer.dof;
    const dof: CameraDof = d ? { band: Math.max(0, num(d.band, lt, 0, c)), near: d.near ?? 1, far: d.far ?? 1, max: d.max ?? 48 } : NO_DOF;
    return { eye, target, zoom, view, projection: perspective(zoom, scene.width, scene.height), focus: num(layer.focus, lt, zoom, c), aperture: Math.max(0, num(layer.aperture, lt, 0, c)), dof };
  }
  const eye = [scene.width / 2, scene.height / 2, -defaultZoom];
  const target = [scene.width / 2, scene.height / 2, 0];
  return { eye, target, zoom: defaultZoom, view: lookAt(eye, target), projection: perspective(defaultZoom, scene.width, scene.height), focus: defaultZoom, aperture: 0, dof: NO_DOF };
}

export type EvaluateOptions = { sizeOf?: SizeOf; anchorOf?: AnchorOf; fps?: number; motionBlur?: boolean };

/**
 * A layer clip's own transform on a layered comp's timeline (`layer.frame`), applied after the
 * parent chain and the camera: the offset moves the picture in canvas pixels, scale and rotation
 * turn it about its own centre where it stands — what the clip's Motion properties do to the
 * layer, the way AE scales a layer about its anchor. Null when there is none.
 */
function clipFrame(layer: Layer, placed: Mat4, size: [number, number], t: number): { matrix: Mat4; opacity: number } | null {
  const frame = layer.frame;
  if (!frame) return null;
  const offset = vec(frame.offset, t, [0, 0]);
  const scale = num(frame.scale, t, 100) / 100;
  const rotation = num(frame.rotation, t, 0);
  const opacity = Math.max(0, Math.min(100, num(frame.opacity, t, 100))) / 100;
  const centre = transformPoint(placed, size[0] / 2, size[1] / 2, 0);
  const w = Math.abs(centre[3]) > 1e-9 ? centre[3] : 1;
  const cx = centre[0] / w;
  const cy = centre[1] / w;
  let m = translation(cx + offset[0], cy + offset[1], 0);
  if (rotation) m = multiply(m, rotationZ(rotation));
  if (scale !== 1) m = multiply(m, scaling(scale, scale, 1));
  return { matrix: multiply(m, translation(-cx, -cy, 0)), opacity };
}

function frameMatrices(scene: MotionScene, t: number, sizeOf: SizeOf, ctx: (index: number) => ExprContext, anchorOf?: AnchorOf) {
  const { resolve } = worldMatrices(scene, t, sizeOf, ctx, anchorOf);
  const camera = cameraAt(scene, t, (index) => resolve(index).world, ctx);
  const cameraMatrix = multiply(camera.projection, camera.view);
  const final = (index: number) => {
    const entry = resolve(index);
    const placed = entry.local.is3D ? multiply(cameraMatrix, entry.world) : entry.world;
    const clip = clipFrame(scene.layers[index], placed, entry.size, t);
    return { ...entry, matrix: clip ? multiply(clip.matrix, placed) : placed, clipOpacity: clip?.opacity ?? 1 };
  };
  return { final, camera, cameraMatrix };
}

/** The scene at scene time `t`. */
export function evaluateScene(scene: MotionScene, t: number, options: EvaluateOptions = {}): ResolvedFrame {
  const sizeOf = options.sizeOf ?? ((layer: Layer, time: number) => defaultSize(scene, layer, time));
  const seed = scene.seed ?? 1;
  // In and out points on the layer's own clock, the one `time` runs on in its expressions.
  const ctx = (index: number): ExprContext => {
    const layer = scene.layers[index];
    return { seed, index, duration: scene.duration, width: scene.width, height: scene.height, inPoint: layer ? layerTime(layer, layer.in ?? 0) : 0, outPoint: layer ? layerTime(layer, layer.out ?? scene.duration) : scene.duration };
  };
  const now = frameMatrices(scene, t, sizeOf, ctx, options.anchorOf);
  const fps = options.fps ?? 30;
  const samples = Math.max(1, Math.min(32, Math.round(scene.motionBlur?.samples ?? 8)));
  const shutter = Math.max(0, Math.min(720, scene.motionBlur?.shutter ?? 180)) / 360;
  const wantsBlur = options.motionBlur !== false && samples > 1 && shutter > 0 && scene.layers.some((layer) => layer.motionBlur);
  const subFrames = wantsBlur
    ? Array.from({ length: samples }, (_, i) => t + ((i / (samples - 1)) - 0.5) * shutter / fps).map((time) => frameMatrices(scene, time, sizeOf, ctx, options.anchorOf))
    : [];

  const layers: ResolvedLayer[] = scene.layers.map((layer, index) => {
    const c = ctx(index);
    const entry = now.final(index);
    const lt = layerTime(layer, t);
    const active = t >= (layer.in ?? 0) && t < (layer.out ?? Infinity) && layer.type !== 'camera' && layer.type !== 'null';
    let blurMatrices: Mat4[] = [];
    if (layer.motionBlur && subFrames.length) {
      const mats = subFrames.map((frame) => frame.final(index).matrix);
      const moving = mats.some((m) => m.some((value, k) => Math.abs(value - entry.matrix[k]) > 1e-3));
      if (moving) blurMatrices = mats;
    }
    const centre = transformPoint(entry.world, entry.size[0] / 2, entry.size[1] / 2, 0);
    const cam = transformPoint(now.camera.view, centre[0], centre[1], centre[2]);
    let defocus = 0;
    if (entry.local.is3D && active && now.camera.aperture > 0) {
      const sigma = defocusSigma(now.camera, cam[2]);
      const ratio = sigma > 0 ? projectedScale(entry.matrix, entry.size) : 0;
      if (ratio > 1e-6) defocus = sigma / ratio;
    }
    return {
      layer,
      index,
      active,
      size: entry.size,
      matrix: entry.matrix,
      blurMatrices,
      opacity: entry.local.opacity * entry.clipOpacity,
      is3D: entry.local.is3D,
      depth: cam[2],
      masks: (layer.masks ?? []).map((mask) => resolveMask(mask, entry.size, lt, c)),
      effects: (layer.effects ?? []).filter((effect) => effect.enabled !== false).map((effect) => resolveEffect(effect, lt, c)),
      time: layer.type === 'precomp' ? (lt - (layer.offset ?? 0)) * (layer.speed ?? 1) : lt,
      defocus,
    };
  });

  // AE draws layers in stack order, except that a contiguous run of 3D layers intersects by
  // depth: we sort such runs back to front (farthest first).
  const order: number[] = [];
  let run: number[] = [];
  const flush = () => {
    run.sort((a, b) => layers[b].depth - layers[a].depth || a - b);
    order.push(...run);
    run = [];
  };
  for (const entry of layers) {
    if (entry.is3D) run.push(entry.index);
    else { flush(); order.push(entry.index); }
  }
  flush();
  return { time: t, width: scene.width, height: scene.height, layers, camera: now.camera, order };
}

/** Where a layer-space point lands on the canvas at time `t` (for UI handles and frame QA). */
export function projectPoint(frame: ResolvedFrame, layerId: string, x: number, y: number): [number, number] | null {
  const layer = frame.layers.find((entry) => entry.layer.id === layerId);
  if (!layer) return null;
  const p = transformPoint(layer.matrix, x, y, 0);
  if (p[3] <= 1e-6) return null;
  return [p[0] / p[3], p[1] / p[3]];
}

/** Canvas-space bounding box of a layer's content, or null when it is behind the camera. */
export function layerBounds(frame: ResolvedFrame, layerId: string): { x: number; y: number; width: number; height: number } | null {
  const layer = frame.layers.find((entry) => entry.layer.id === layerId);
  return layer ? entryBounds(layer.matrix, layer.size) : null;
}

/** Canvas-space bounding box of content of `size` placed by `matrix`, or null behind the camera. */
export function entryBounds(matrix: Mat4, size: [number, number]): { x: number; y: number; width: number; height: number } | null {
  const [w, h] = size;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => transformPoint(matrix, x, y, 0));
  if (corners.some((p) => p[3] <= 1e-6)) return null;
  const xs = corners.map((p) => p[0] / p[3]);
  const ys = corners.map((p) => p[1] / p[3]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export { identity };
