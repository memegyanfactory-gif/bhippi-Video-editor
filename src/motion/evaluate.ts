// Resolves a MotionScene at one moment into a flat list of layers with their final matrices,
// opacities, masks and effect parameters. Pure: no DOM, no GL — the GPU executor, thumbnails,
// frame QA and the tests all read the same answer.
import { num, vec, valueOf, isAnimated, isExpression, type ExprContext } from './anim';
import { identity, lookAt, multiply, perspective, rotationX, rotationY, rotationZ, scaling, skewing, transformPoint, translation, type Mat4 } from './math';
import type { Effect, Layer, Mask, MotionScene, Prop, Vec } from './types';

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
};

export type CameraState = { eye: Vec; target: Vec; zoom: number; view: Mat4; projection: Mat4; focus: number; aperture: number };

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

function localTransform(layer: Layer, size: [number, number], scene: MotionScene, t: number, ctx: ExprContext, anchorOf?: AnchorOf): Local {
  const tr = layer.transform ?? {};
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
    const size = sizeOf(layer, t);
    const local = localTransform(layer, size, scene, t, ctx(index), anchorOf);
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
    const zoom = Math.max(1, num(layer.zoom, t, defaultZoom, c));
    const tr = layer.transform ?? {};
    const localEye = vec(tr.position, t, [scene.width / 2, scene.height / 2, -zoom], c);
    const localTarget = vec(layer.pointOfInterest, t, [scene.width / 2, scene.height / 2, 0], c);
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
    const roll = num(tr.rotation, t, 0, c);
    if (roll) view = multiply(rotationZ(-roll), view);
    return { eye, target, zoom, view, projection: perspective(zoom, scene.width, scene.height), focus: num(layer.focus, t, zoom, c), aperture: num(layer.aperture, t, 0, c) };
  }
  const eye = [scene.width / 2, scene.height / 2, -defaultZoom];
  const target = [scene.width / 2, scene.height / 2, 0];
  return { eye, target, zoom: defaultZoom, view: lookAt(eye, target), projection: perspective(defaultZoom, scene.width, scene.height), focus: defaultZoom, aperture: 0 };
}

export type EvaluateOptions = { sizeOf?: SizeOf; anchorOf?: AnchorOf; fps?: number; motionBlur?: boolean };

function frameMatrices(scene: MotionScene, t: number, sizeOf: SizeOf, ctx: (index: number) => ExprContext, anchorOf?: AnchorOf) {
  const { resolve } = worldMatrices(scene, t, sizeOf, ctx, anchorOf);
  const camera = cameraAt(scene, t, (index) => resolve(index).world, ctx);
  const cameraMatrix = multiply(camera.projection, camera.view);
  const final = (index: number) => {
    const entry = resolve(index);
    return { ...entry, matrix: entry.local.is3D ? multiply(cameraMatrix, entry.world) : entry.world };
  };
  return { final, camera, cameraMatrix };
}

/** The scene at scene time `t`. */
export function evaluateScene(scene: MotionScene, t: number, options: EvaluateOptions = {}): ResolvedFrame {
  const sizeOf = options.sizeOf ?? ((layer: Layer, time: number) => defaultSize(scene, layer, time));
  const seed = scene.seed ?? 1;
  const ctx = (index: number): ExprContext => ({ seed, index, duration: scene.duration, width: scene.width, height: scene.height, inPoint: scene.layers[index]?.in ?? 0, outPoint: scene.layers[index]?.out ?? scene.duration });
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
    const active = t >= (layer.in ?? 0) && t < (layer.out ?? Infinity) && layer.type !== 'camera' && layer.type !== 'null';
    let blurMatrices: Mat4[] = [];
    if (layer.motionBlur && subFrames.length) {
      const mats = subFrames.map((frame) => frame.final(index).matrix);
      const moving = mats.some((m) => m.some((value, k) => Math.abs(value - entry.matrix[k]) > 1e-3));
      if (moving) blurMatrices = mats;
    }
    const centre = transformPoint(entry.world, entry.size[0] / 2, entry.size[1] / 2, 0);
    const cam = transformPoint(now.camera.view, centre[0], centre[1], centre[2]);
    return {
      layer,
      index,
      active,
      size: entry.size,
      matrix: entry.matrix,
      blurMatrices,
      opacity: entry.local.opacity,
      is3D: entry.local.is3D,
      depth: cam[2],
      masks: (layer.masks ?? []).map((mask) => resolveMask(mask, entry.size, t, c)),
      effects: (layer.effects ?? []).filter((effect) => effect.enabled !== false).map((effect) => resolveEffect(effect, t, c)),
      time: layer.type === 'precomp' ? (t - (layer.offset ?? 0)) * (layer.speed ?? 1) : t,
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
  if (!layer) return null;
  const [w, h] = layer.size;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => transformPoint(layer.matrix, x, y, 0));
  if (corners.some((p) => p[3] <= 1e-6)) return null;
  const xs = corners.map((p) => p[0] / p[3]);
  const ys = corners.map((p) => p[1] / p[3]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export { identity };
