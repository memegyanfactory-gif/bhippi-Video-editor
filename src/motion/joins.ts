// Scene joins from the launch films (docs/research/launch-film-learnings.md §6,
// docs/research/opus-launch-film-study.md §3.9): the three ways they hid a cut that the sequence
// transitions did not have yet. Used by create_motion_sequence (sequence.ts) between beats and by
// the join templates (kit/filmTemplates.ts) laid over a cut between two clips.
//   camera-match  · the incoming scene opens on exactly the camera the outgoing one ended on
//                   (Opus S02 → S03 at [960, 520, 0.84, 5, −9]), then settles into its own.
//   glow-handoff  · a light point (the send button's glow) drifts to where the next scene's
//                   element is and grows (60 → 320 px), then contracts (300 → 90 px) as that
//                   element takes its place (S07 → S08: the glow became the logo).
//   flash-bridge  · warm white (1.0, 0.97, 0.92) at 0.5–0.9 rising into the cut on cubic-in,
//                   and a mirror flash decaying out of it into the new scene (the drops).
// Pure: no DOM.
import { isAnimated, isExpression, layerTime, num, valueOf, vec } from './anim';
import { DEFAULT_ZOOM_RATIO, evaluateScene } from './evaluate';
import { round, Track } from './keys';
import type { Ease, Key, Layer, MotionScene, Prop, Vec } from './types';

/** The films' flash colour: warm white, never pure white. */
export const WARM_WHITE = '#fff7eb';

/** A warm-white flash over a cut at `cut`: up on cubic-in over `rise`, down over `decay`. */
export function flashLayer(o: { id: string; cut: number; rise?: number; decay?: number; strength?: number; color?: string; name?: string }): Layer {
  const rise = Math.max(1 / 30, o.rise ?? 0.27);
  const decay = Math.max(1 / 30, o.decay ?? 0.33);
  const peak = Math.min(1, Math.max(0, o.strength ?? 0.7)) * 100;
  const opacity = new Track<number>(0).key(o.cut - rise, 0, 'cubic-in').key(o.cut, peak, 'expo-out').key(o.cut + decay, 0);
  return { id: o.id, name: o.name ?? 'Flash', type: 'solid', color: o.color ?? WARM_WHITE, in: round(Math.max(0, o.cut - rise)), out: round(o.cut + decay + 1 / 30), transform: { opacity: opacity.prop() } };
}

/**
 * A light point for a glow handoff: it lights at `from` at `start`, drifts to `to` growing to
 * `peak` px by `cut`, then contracts to `rest` px and fades by `end` while the next element
 * appears under it. Additive, so it reads as light on any stage.
 */
export function glowPointLayer(o: { id: string; from: Vec; to: Vec; start: number; cut: number; end: number; peak?: number; rest?: number; color?: string; name?: string }): Layer {
  const peak = o.peak ?? 320;
  const size = peak * 1.6;
  const color = o.color ?? '#ffb45c';
  const c: Vec = [size / 2, size / 2];
  const pct = (px: number) => (px / peak) * 100;
  const scale = new Track<number>(pct(60)).key(o.start, pct(60), 'cubic-in').key(o.cut, 100, 'expo-out').key(o.end, pct(o.rest ?? 90));
  const opacity = new Track<number>(0).key(o.start, 0, 'cubic-out').key(o.start + 0.08, 100).key(o.end - 0.12, 100, 'cubic-in').key(o.end + 0.1, 0);
  const position = new Track<Vec>(o.from).key(o.start, o.from, 'house').key(o.cut, o.to);
  return {
    id: o.id, name: o.name ?? 'Light point', type: 'shape', blend: 'add', motionBlur: true,
    in: round(Math.max(0, o.start)), out: round(o.end + 0.15),
    transform: { position: position.prop(), scale: scale.prop(), opacity: opacity.prop() },
    effects: [{ type: 'glow', radius: peak * 0.12, intensity: 0.8, color }],
    shape: { shape: 'rect', bounds: [size, size], groups: [{ kind: 'ellipse', position: c, size: [size, size], fill: { gradient: { kind: 'radial', stops: [[0, '#ffffff'], [0.12, '#fff6e6'], [0.32, `${color}c0`], [0.62, `${color}33`], [1, `${color}00`]], from: c, to: [size, size / 2] } } }] },
  };
}

// ───────────────────────── camera match ─────────────────────────

/** A camera's state in scene space: where it is, what it looks at, its zoom and roll. */
export type CameraShot = { eye: Vec; target: Vec; zoom: number; roll: number };

/** The topmost camera layer active at `t`, as the renderer picks it (evaluate.ts cameraAt). */
export function activeCamera(scene: MotionScene, t: number): (Layer & { type: 'camera' }) | null {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i];
    if (layer.type === 'camera' && t >= (layer.in ?? 0) && t < (layer.out ?? Infinity)) return layer;
  }
  return null;
}

/** AE's default 50 mm camera, which is what a scene without a camera is seen through. */
export function defaultShot(scene: Pick<MotionScene, 'width' | 'height'>): CameraShot {
  const zoom = scene.width * DEFAULT_ZOOM_RATIO;
  return { eye: [scene.width / 2, scene.height / 2, -zoom], target: [scene.width / 2, scene.height / 2, 0], zoom, roll: 0 };
}

/** The camera `scene` is seen through at `t` (its default camera when it has none). */
export function cameraShot(scene: MotionScene, t: number): CameraShot {
  const layer = activeCamera(scene, t);
  if (!layer) return defaultShot(scene);
  const camera = evaluateScene(scene, t).camera;
  return { eye: [...camera.eye], target: [...camera.target], zoom: camera.zoom, roll: num(layer.transform?.rotation, layerTime(layer, t), 0) };
}

/** Keys that start at `from` and ease into what `prop` does from `settle` on. */
function carry<T extends number | Vec>(prop: Prop<T> | undefined, from: T, settle: number, ease: Ease, rest: T): Prop<T> {
  const own: Key<T>[] = isAnimated(prop) ? prop.k : [{ t: 0, v: (prop ?? rest) as T }];
  const at = valueOf(prop, settle, rest);
  const running = [...own].reverse().find((key) => key.t <= settle + 1e-4);
  const later = own.filter((key) => key.t > settle + 1e-4);
  const clean = (v: T) => (typeof v === 'number' ? round(v) : (v as number[]).map(round)) as T;
  return { k: [{ t: 0, v: clean(from), ease }, { t: round(settle), v: clean(at), ...(running?.ease && later.length ? { ease: running.ease } : {}) }, ...later] };
}

/**
 * `scene` with its own camera opening on `shot` and easing into its own framing over `settle`
 * seconds. Null when it has no camera of its own at 0 to carry the shot (or one on a parent, or
 * one driven by expressions): the caller matches the framing instead (see framingOf).
 */
export function matchCamera(scene: MotionScene, shot: CameraShot, settle = 0.6, ease: Ease = 'house'): MotionScene | null {
  const camera = activeCamera(scene, 0);
  if (!camera || camera.parent) return null;
  const tr = camera.transform ?? {};
  if ([tr.position, tr.rotation, camera.pointOfInterest, camera.zoom].some((prop) => isExpression(prop as Prop))) return null;
  const s = Math.max(1 / 30, settle);
  const own = defaultShot(scene);
  const zoomAt = (t: number) => Math.max(1, num(camera.zoom, t, own.zoom));
  const eyeAt = (t: number) => vec(tr.position, t, [scene.width / 2, scene.height / 2, -zoomAt(t)]);
  // A one-node camera looks straight ahead; to open on a shot that looked elsewhere it gets a
  // point of interest that leads back to straight ahead, following its moves after the settle.
  let pointOfInterest: Prop<Vec> | undefined = camera.pointOfInterest;
  if (pointOfInterest === undefined) {
    const e = eyeAt(0);
    const ahead = (t: number): Vec => { const p = eyeAt(t); return [p[0], p[1], (p[2] ?? 0) + zoomAt(t)]; };
    const lookedAhead = Math.hypot(shot.target[0] - shot.eye[0], shot.target[1] - shot.eye[1]) < 0.5 && Math.hypot(shot.eye[0] - e[0], shot.eye[1] - e[1]) < 0.5;
    if (!lookedAhead) {
      const times = [...new Set([s, ...[tr.position, camera.zoom].flatMap((prop) => (isAnimated(prop as Prop) ? (prop as { k: Key[] }).k.map((key) => key.t) : [])).filter((t) => t > s)])].sort((a, b) => a - b);
      pointOfInterest = { k: [{ t: 0, v: shot.target.map(round), ease }, ...times.map((t) => ({ t: round(t), v: ahead(t).map(round) }))] };
    }
  } else pointOfInterest = carry(pointOfInterest, shot.target, s, ease, [scene.width / 2, scene.height / 2, 0]);
  const matched: Layer = {
    ...camera,
    zoom: carry(camera.zoom, shot.zoom, s, ease, own.zoom),
    ...(pointOfInterest !== undefined ? { pointOfInterest } : {}),
    transform: {
      ...tr,
      position: carry(tr.position, shot.eye, s, ease, [scene.width / 2, scene.height / 2, -own.zoom]),
      ...(shot.roll || tr.rotation !== undefined ? { rotation: carry(tr.rotation, shot.roll, s, ease, 0) } : {}),
    },
  };
  return { ...scene, layers: scene.layers.map((layer) => (layer === camera ? matched : layer)) };
}

/**
 * How a shot frames the flat picture (the z = 0 plane): the point it centres, how much it
 * magnifies it and its roll. A scene without a camera of its own takes this as its precomp
 * transform so it opens framed the way the last scene ended.
 */
export function framingOf(shot: CameraShot): { centre: Vec; scale: number; roll: number } {
  const [ex, ey, ez] = [shot.eye[0], shot.eye[1], shot.eye[2] ?? 0];
  const [tx, ty, tz] = [shot.target[0], shot.target[1], shot.target[2] ?? 0];
  // Where the line of sight meets the picture plane; straight ahead when it runs parallel to it.
  const k = Math.abs(tz - ez) > 1e-6 ? -ez / (tz - ez) : 1;
  const centre: Vec = Math.abs(tz - ez) > 1e-6 ? [ex + (tx - ex) * k, ey + (ty - ey) * k] : [ex, ey];
  const distance = Math.hypot(centre[0] - ex, centre[1] - ey, ez);
  return { centre, scale: shot.zoom / Math.max(1, distance), roll: shot.roll };
}
