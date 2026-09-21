// The 3D layer system: an After Effects-style scene with a real camera, objects, lights,
// materials and an environment, kept as plain JSON inside a clip source so it saves with the
// project, undoes like any edit and can be authored by hand in the 3D workspace or by the AI
// through the scene3d tools. The preview draws it with three.js (scene3dRuntime.ts), the export
// renders it to PNG frames with alpha (scene3dFrames.ts), and the Blender bridge rebuilds the
// same JSON in Blender for a path-traced render (workers/blender_bridge.py).
//
// Units are metres, +Y up, the camera looks down −Z like Blender and three.js. Rotations are
// degrees in XYZ order. Every animated number is a keyframe track keyed by a property path
// ('position.x', 'orbit.azimuth', 'focusDistance'), evaluated with the same easings as clip
// keyframes so a rack focus and a clip opacity ramp feel the same.
import { valueAt } from './keyframes';
import type { Clip, Comp, Easing, Keyframe, Project, Track } from './types';

export type Vec3 = [number, number, number];
export type Scene3dTracks = Record<string, Keyframe[]>;

export type Scene3dPrimitive = 'box' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'torus' | 'torusKnot' | 'capsule' | 'ring' | 'icosahedron';
export type Scene3dObjectKind = Scene3dPrimitive | 'text' | 'label' | 'model' | 'image' | 'video' | 'group' | 'null';
export const PRIMITIVES: Scene3dPrimitive[] = ['box', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'torusKnot', 'capsule', 'ring', 'icosahedron'];
export const OBJECT_KINDS: Scene3dObjectKind[] = [...PRIMITIVES, 'text', 'label', 'model', 'image', 'video', 'group', 'null'];

export type Scene3dMaterialType = 'standard' | 'physical' | 'basic' | 'toon';
export type Scene3dMaterial = {
  id: string;
  name: string;
  /** The library preset it started from, for the inspector and the AI. */
  preset?: string;
  type: Scene3dMaterialType;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  /** Physical only: 0 solid … 1 fully see-through (glass). */
  transmission: number;
  ior: number;
  thickness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  iridescence: number;
  wireframe: boolean;
  flatShading: boolean;
  side: 'front' | 'double';
  envMapIntensity: number;
  /** An image asset id or absolute path used as the colour texture. */
  map?: string | null;
};

export type Scene3dObject = {
  id: string;
  name: string;
  kind: Scene3dObjectKind;
  parentId: string | null;
  position: Vec3;
  /** Degrees, XYZ order. */
  rotation: Vec3;
  scale: Vec3;
  materialId: string | null;
  /** 0…1, multiplied into the material's opacity. */
  opacity: number;
  castShadow: boolean;
  receiveShadow: boolean;
  visible: boolean;
  /**
   * Geometry parameters by kind: box width/height/depth; sphere radius; plane width/height;
   * cylinder radiusTop/radiusBottom/height; cone radius/height; torus radius/tube; text text/size/
   * depth/font/align; label text/fontSize/width/color/background; model path (a .glb/.gltf);
   * image/video assetId or path, width/height (auto from the picture when 0).
   */
  params: Record<string, number | string | boolean>;
  animation: Scene3dTracks;
};

export type Scene3dCameraMode = 'free' | 'orbit';
export type Scene3dCamera = {
  mode: Scene3dCameraMode;
  position: Vec3;
  rotation: Vec3;
  /** Free mode: when set, the camera aims here instead of using `rotation`. */
  lookAt: Vec3 | null;
  /** Orbit mode: the camera sits on a sphere around `target`. Azimuth and elevation in degrees. */
  orbit: { target: Vec3; radius: number; azimuth: number; elevation: number };
  /** Millimetres, the lens the user thinks in (24, 35, 50, 85…). */
  focalLength: number;
  /** Millimetres; 36 is full frame. Vertical fov follows from the frame aspect. */
  sensorWidth: number;
  /** f/N. Lower is a wider aperture and shallower focus. */
  fStop: number;
  /** Metres from the camera to the sharpest plane. */
  focusDistance: number;
  depthOfField: boolean;
  /** Aperture blades (bokeh shape) — honoured by Blender; the preview draws round bokeh. */
  blades: number;
  /** Degrees, 180 is the film standard; motion blur amount in Blender renders. */
  shutterAngle: number;
  near: number;
  far: number;
  animation: Scene3dTracks;
};

export type Scene3dLightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot' | 'area';
export type Scene3dLight = {
  id: string;
  name: string;
  kind: Scene3dLightKind;
  color: string;
  intensity: number;
  position: Vec3;
  /** Directional, spot and area lights aim here. */
  target: Vec3;
  castShadow: boolean;
  /** Spot cone, degrees. */
  angle: number;
  penumbra: number;
  decay: number;
  distance: number;
  /** Area light size, metres. */
  width: number;
  height: number;
  /** Hemisphere: the colour from below. */
  groundColor: string;
  animation: Scene3dTracks;
};

export type Scene3dEnvironmentPreset = 'none' | 'room' | 'studio' | 'outdoor' | 'sunset' | 'night' | 'hdri';
export type Scene3dEnvironment = {
  preset: Scene3dEnvironmentPreset;
  /** Absolute path of a .hdr / .exr when preset is 'hdri'. */
  hdri: string | null;
  intensity: number;
  /** Degrees around Y. */
  rotation: number;
  background: 'transparent' | 'color' | 'environment' | 'gradient';
  backgroundColor: string;
  backgroundColor2: string;
  /** 0…1 blur of the visible environment background. */
  blur: number;
  fog: { enabled: boolean; color: string; near: number; far: number };
  animation: Scene3dTracks;
};

export type Scene3dRender = {
  shadows: boolean;
  shadowMapSize: 1024 | 2048 | 4096;
  toneMapping: 'aces' | 'neutral' | 'agx' | 'linear' | 'reinhard';
  exposure: number;
  antialias: boolean;
  /** Blender only: engine and samples for the high-quality render path. */
  engine: 'eevee' | 'cycles';
  samples: number;
  motionBlur: boolean;
};

export type Scene3d = {
  version: 1;
  name: string;
  /** Seconds; the clip usually matches. */
  duration: number;
  objects: Scene3dObject[];
  materials: Scene3dMaterial[];
  camera: Scene3dCamera;
  lights: Scene3dLight[];
  environment: Scene3dEnvironment;
  render: Scene3dRender;
};

export type Scene3dSource = Extract<Clip['source'], { type: 'scene3d' }>;

// ───────────────────────────── ids and defaults ─────────────────────────────

const uid = () => `s3_${Math.random().toString(36).slice(2, 9)}`;

export const DEFAULT_SENSOR_WIDTH = 36;

export function defaultCamera(): Scene3dCamera {
  return {
    mode: 'free',
    position: [0, 1.2, 6],
    rotation: [0, 0, 0],
    lookAt: [0, 0.6, 0],
    orbit: { target: [0, 0.6, 0], radius: 6, azimuth: 0, elevation: 12 },
    focalLength: 50,
    sensorWidth: DEFAULT_SENSOR_WIDTH,
    fStop: 2.8,
    focusDistance: 6,
    depthOfField: false,
    blades: 6,
    shutterAngle: 180,
    near: 0.05,
    far: 200,
    animation: {},
  };
}

export function defaultEnvironment(): Scene3dEnvironment {
  return {
    preset: 'studio',
    hdri: null,
    intensity: 1,
    rotation: 0,
    background: 'transparent',
    backgroundColor: '#0b0b0f',
    backgroundColor2: '#25060a',
    blur: 0.4,
    fog: { enabled: false, color: '#0b0b0f', near: 8, far: 30 },
    animation: {},
  };
}

export function defaultRender(): Scene3dRender {
  return { shadows: true, shadowMapSize: 2048, toneMapping: 'aces', exposure: 1, antialias: true, engine: 'eevee', samples: 64, motionBlur: false };
}

export function newLight(kind: Scene3dLightKind, fields: Partial<Scene3dLight> = {}): Scene3dLight {
  const base: Scene3dLight = {
    id: uid(),
    name: kind === 'directional' ? 'Key' : kind[0].toUpperCase() + kind.slice(1),
    kind,
    color: '#ffffff',
    intensity: kind === 'ambient' ? 0.4 : kind === 'hemisphere' ? 0.6 : kind === 'directional' ? 2.5 : kind === 'point' ? 20 : kind === 'spot' ? 40 : 8,
    position: kind === 'directional' ? [4, 6, 4] : kind === 'spot' ? [3, 5, 3] : [2, 3, 2],
    target: [0, 0, 0],
    castShadow: kind === 'directional' || kind === 'spot',
    angle: 35,
    penumbra: 0.4,
    decay: 2,
    distance: 0,
    width: 2,
    height: 2,
    groundColor: '#2a1a14',
    animation: {},
  };
  return { ...base, ...fields, id: fields.id ?? base.id };
}

export function newObject(kind: Scene3dObjectKind, fields: Partial<Scene3dObject> = {}): Scene3dObject {
  const params: Record<string, number | string | boolean> = {};
  switch (kind) {
    case 'box': Object.assign(params, { width: 1, height: 1, depth: 1, segments: 1 }); break;
    case 'sphere': Object.assign(params, { radius: 0.6, segments: 48 }); break;
    case 'plane': Object.assign(params, { width: 4, height: 4 }); break;
    case 'cylinder': Object.assign(params, { radiusTop: 0.5, radiusBottom: 0.5, height: 1, segments: 48 }); break;
    case 'cone': Object.assign(params, { radius: 0.6, height: 1.2, segments: 48 }); break;
    case 'torus': Object.assign(params, { radius: 0.7, tube: 0.22, segments: 64 }); break;
    case 'torusKnot': Object.assign(params, { radius: 0.6, tube: 0.18, p: 2, q: 3, segments: 128 }); break;
    case 'capsule': Object.assign(params, { radius: 0.35, length: 0.8, segments: 24 }); break;
    case 'ring': Object.assign(params, { innerRadius: 0.5, outerRadius: 0.8, segments: 64 }); break;
    case 'icosahedron': Object.assign(params, { radius: 0.7, detail: 1 }); break;
    case 'text': Object.assign(params, { text: 'HELIOS', size: 0.8, depth: 0.18, font: 'bold', align: 'center', letterSpacing: 0, bevel: true }); break;
    case 'label': Object.assign(params, { text: 'Label', fontSize: 64, width: 4, color: '#f7f2ee', background: 'transparent', fontFamily: 'Inter, Arial, sans-serif', align: 'center' }); break;
    case 'model': Object.assign(params, { path: '', fit: 1 }); break;
    case 'image': Object.assign(params, { assetId: '', path: '', width: 0, height: 2 }); break;
    case 'video': Object.assign(params, { assetId: '', path: '', width: 0, height: 2 }); break;
    default: break;
  }
  const base: Scene3dObject = {
    id: uid(),
    name: kind === 'torusKnot' ? 'Torus Knot' : kind[0].toUpperCase() + kind.slice(1),
    kind,
    parentId: null,
    position: [0, 0.6, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    materialId: null,
    opacity: 1,
    castShadow: kind !== 'plane' && kind !== 'null' && kind !== 'group' && kind !== 'label',
    receiveShadow: true,
    visible: true,
    params,
    animation: {},
  };
  return { ...base, ...fields, params: { ...params, ...(fields.params ?? {}) }, id: fields.id ?? base.id };
}

// ───────────────────────────── material library ─────────────────────────────

const material = (id: string, name: string, fields: Partial<Scene3dMaterial>): Scene3dMaterial => ({
  id,
  name,
  preset: id,
  type: 'standard',
  color: '#c9c9c9',
  metalness: 0,
  roughness: 0.5,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0.5,
  clearcoat: 0,
  clearcoatRoughness: 0.1,
  sheen: 0,
  iridescence: 0,
  wireframe: false,
  flatShading: false,
  side: 'front',
  envMapIntensity: 1,
  map: null,
  ...fields,
});

/** The built-in material library: what the inspector offers and what the AI names by id. */
export const MATERIAL_LIBRARY: Scene3dMaterial[] = [
  material('matte-plastic', 'Matte plastic', { color: '#d8d4d0', roughness: 0.85 }),
  material('glossy-plastic', 'Glossy plastic', { type: 'physical', color: '#d34b55', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
  material('clay', 'Clay', { color: '#b98a72', roughness: 1 }),
  material('ceramic', 'Ceramic', { type: 'physical', color: '#f2efe9', roughness: 0.25, clearcoat: 0.6 }),
  material('rubber', 'Rubber', { color: '#1c1c1e', roughness: 0.95 }),
  material('brushed-metal', 'Brushed metal', { color: '#9ea3ab', metalness: 1, roughness: 0.45 }),
  material('chrome', 'Chrome', { color: '#ffffff', metalness: 1, roughness: 0.04, envMapIntensity: 1.4 }),
  material('gold', 'Gold', { color: '#ffc45e', metalness: 1, roughness: 0.22 }),
  material('copper', 'Copper', { color: '#d9835a', metalness: 1, roughness: 0.3 }),
  material('gunmetal', 'Gunmetal', { color: '#3a3f47', metalness: 0.9, roughness: 0.4 }),
  material('carbon', 'Carbon', { color: '#141517', metalness: 0.3, roughness: 0.6, clearcoat: 0.8 }),
  material('glass', 'Glass', { type: 'physical', color: '#ffffff', roughness: 0.02, transmission: 1, ior: 1.5, thickness: 0.6, envMapIntensity: 1.2 }),
  material('frosted-glass', 'Frosted glass', { type: 'physical', color: '#ffffff', roughness: 0.45, transmission: 0.95, ior: 1.45, thickness: 0.8 }),
  material('crimson-glass', 'Crimson glass', { type: 'physical', color: '#b32639', roughness: 0.08, transmission: 0.75, ior: 1.5, thickness: 0.8, emissive: '#3a0008', emissiveIntensity: 0.3 }),
  material('neon', 'Neon', { color: '#ffffff', emissive: '#ff3b5c', emissiveIntensity: 3, roughness: 0.4 }),
  material('neon-cyan', 'Neon cyan', { color: '#ffffff', emissive: '#38e6ff', emissiveIntensity: 3, roughness: 0.4 }),
  material('holographic', 'Holographic', { type: 'physical', color: '#d0d6ff', metalness: 0.6, roughness: 0.15, iridescence: 1, clearcoat: 1 }),
  material('velvet', 'Velvet', { type: 'physical', color: '#4a0f1e', roughness: 1, sheen: 1 }),
  material('toon', 'Toon', { type: 'toon', color: '#ffb547', roughness: 1 }),
  material('wireframe', 'Wireframe', { type: 'basic', color: '#ffd8d3', wireframe: true }),
  material('warm-white', 'Warm white', { color: '#f7f2ee', roughness: 0.6 }),
  material('void', 'Void black', { color: '#100607', roughness: 0.9 }),
];

export const materialPreset = (id: string): Scene3dMaterial | undefined => MATERIAL_LIBRARY.find((entry) => entry.id === id);

/** A fresh material instance for a scene from a library preset, with overrides. */
export function materialFromPreset(preset: string, overrides: Partial<Scene3dMaterial> = {}): Scene3dMaterial {
  const base = materialPreset(preset) ?? MATERIAL_LIBRARY[0];
  return { ...base, ...overrides, id: overrides.id ?? uid(), preset: base.id, name: overrides.name ?? base.name };
}

// ───────────────────────────── environments ─────────────────────────────

export const ENVIRONMENT_PRESETS: { id: Scene3dEnvironmentPreset; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Only the scene lights' },
  { id: 'room', label: 'Room', hint: 'Neutral room with soft panels (three.js RoomEnvironment)' },
  { id: 'studio', label: 'Studio', hint: 'Three softboxes on black — product and type' },
  { id: 'outdoor', label: 'Outdoor', hint: 'Blue sky, warm sun, soft ground bounce' },
  { id: 'sunset', label: 'Sunset', hint: 'Low warm key, violet sky' },
  { id: 'night', label: 'Night', hint: 'Cool moonlight and city glow' },
  { id: 'hdri', label: 'HDRI file', hint: 'A .hdr or .exr image lights and reflects' },
];

/** CC0 HDRIs from Poly Haven the installer can fetch (1k, a few MB each). */
export const HDRI_CATALOGUE: { id: string; label: string; file: string; url: string; mood: string }[] = [
  'studio_small_09', 'studio_small_08', 'brown_photostudio_02', 'neon_photostudio', 'blue_photo_studio',
  'venice_sunset', 'kloofendal_48d_partly_cloudy_puresky', 'moonless_golf', 'empty_warehouse_01', 'dancing_hall',
].map((id) => ({
  id,
  label: id.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
  file: `${id}_1k.hdr`,
  url: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`,
  mood: id.includes('studio') ? 'studio' : id.includes('sunset') ? 'sunset' : id.includes('moonless') ? 'night' : id.includes('sky') ? 'outdoor' : 'interior',
}));

// ───────────────────────────── camera optics ─────────────────────────────

/** Vertical field of view in degrees for a lens on a sensor, at the frame's aspect (w/h). */
export function verticalFov(focalLength: number, sensorWidth: number, aspect: number): number {
  const sensorHeight = sensorWidth / Math.max(0.1, aspect);
  return (2 * Math.atan(sensorHeight / (2 * Math.max(1, focalLength))) * 180) / Math.PI;
}

/** The lens that gives a vertical fov, the inverse of `verticalFov`. */
export function focalLengthForFov(fovDeg: number, sensorWidth: number, aspect: number): number {
  const sensorHeight = sensorWidth / Math.max(0.1, aspect);
  return sensorHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/**
 * Depth of field as the preview's bokeh pass wants it. The shader's `aperture` is a blur gain,
 * not f/N, so it is derived from the physical aperture diameter (focal length ÷ f-stop), scaled
 * so f/1.4 on a 50 mm is visibly shallow and f/16 is nearly sharp. Blender gets the real values.
 */
export function bokehParams(camera: Pick<Scene3dCamera, 'focalLength' | 'fStop' | 'focusDistance' | 'depthOfField'>): { focus: number; aperture: number; maxblur: number } {
  if (!camera.depthOfField) return { focus: camera.focusDistance, aperture: 0, maxblur: 0 };
  const diameterMm = camera.focalLength / Math.max(0.7, camera.fStop);
  const aperture = Math.min(0.06, Math.max(0.0005, diameterMm / 1800));
  return { focus: Math.max(0.05, camera.focusDistance), aperture, maxblur: 0.012 + Math.min(0.012, diameterMm / 4000) };
}

/** Hyperfocal-style near/far sharp range in metres for the inspector's readout. */
export function depthOfFieldRange(camera: Pick<Scene3dCamera, 'focalLength' | 'fStop' | 'focusDistance' | 'sensorWidth'>): { near: number; far: number } {
  const coc = (camera.sensorWidth / 36) * 0.03; // mm, the classic full-frame circle of confusion
  const f = camera.focalLength;
  const hyperfocal = (f * f) / (camera.fStop * coc) + f; // mm
  const s = camera.focusDistance * 1000; // mm
  const near = (hyperfocal * s) / (hyperfocal + (s - f));
  const far = s >= hyperfocal ? Infinity : (hyperfocal * s) / (hyperfocal - (s - f));
  return { near: near / 1000, far: far / 1000 };
}

/** Where an orbit camera sits, from its spherical parameters. */
export function orbitPosition(orbit: Scene3dCamera['orbit']): Vec3 {
  const az = (orbit.azimuth * Math.PI) / 180;
  const el = (orbit.elevation * Math.PI) / 180;
  const r = Math.max(0.01, orbit.radius);
  return [orbit.target[0] + r * Math.cos(el) * Math.sin(az), orbit.target[1] + r * Math.sin(el), orbit.target[2] + r * Math.cos(el) * Math.cos(az)];
}

// ───────────────────────────── animation ─────────────────────────────

const getPath = (target: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), target);

const setPath = (target: Record<string, unknown>, path: string, value: number) => {
  const keys = path.split('.');
  let node: Record<string, unknown> = target;
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    const next = node[key];
    if (Array.isArray(next)) node[key] = [...next] as unknown as Record<string, unknown>;
    else if (next && typeof next === 'object') node[key] = { ...(next as Record<string, unknown>) };
    else node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  (node as Record<string, unknown>)[keys[keys.length - 1]] = value;
};

/** Vector components are addressed as `position.x`; the model stores them as tuples. */
const AXIS: Record<string, number> = { x: 0, y: 1, z: 2 };
const normalisePath = (path: string) => path.replace(/\.(x|y|z)$/, (_, axis: string) => `.${AXIS[axis]}`);

/** `base` with every track applied at `time` (seconds from the clip start). Pure; base is not touched. */
export function applyTracks<T extends object>(base: T, tracks: Scene3dTracks | undefined, time: number): T {
  if (!tracks) return base;
  const entries = Object.entries(tracks).filter(([, keys]) => keys && keys.length);
  if (!entries.length) return base;
  const copy = structuredCloneSafe(base) as Record<string, unknown>;
  for (const [path, keys] of entries) {
    const value = valueAt(keys, time);
    if (value === null) continue;
    setPath(copy, normalisePath(path), value);
  }
  return copy as T;
}

function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

/** The value a track has at `time`, or the base value when the property is not animated. */
export function trackValue(base: unknown, tracks: Scene3dTracks | undefined, path: string, time: number): number {
  const keys = tracks?.[path];
  const animatedValue = keys && keys.length ? valueAt(keys, time) : null;
  if (animatedValue !== null && animatedValue !== undefined) return animatedValue;
  const raw = getPath(base, normalisePath(path));
  return typeof raw === 'number' ? raw : 0;
}

export type ResolvedScene = {
  objects: Scene3dObject[];
  camera: Scene3dCamera & { worldPosition: Vec3 };
  lights: Scene3dLight[];
  environment: Scene3dEnvironment;
};

/** Every animated property resolved at `time`: what the runtime draws and Blender bakes. */
export function evaluateScene(scene: Scene3d, time: number): ResolvedScene {
  const camera = applyTracks(scene.camera, scene.camera.animation, time);
  const worldPosition = camera.mode === 'orbit' ? orbitPosition(camera.orbit) : camera.position;
  return {
    objects: scene.objects.map((object) => applyTracks(object, object.animation, time)),
    camera: { ...camera, worldPosition },
    lights: scene.lights.map((light) => applyTracks(light, light.animation, time)),
    environment: applyTracks(scene.environment, scene.environment.animation, time),
  };
}

export type TrackTarget = { kind: 'object' | 'light'; id: string } | { kind: 'camera' } | { kind: 'environment' };

/** Adds or replaces one keyframe on a target's property; a new track starts from the base value. */
export function setSceneKeyframe(scene: Scene3d, target: TrackTarget, path: string, time: number, value: number, easing: Easing = 'ease-out', fps = 30): Scene3d {
  const tolerance = 0.5 / Math.max(1, fps);
  const edit = (tracks: Scene3dTracks): Scene3dTracks => {
    const keys = (tracks[path] ?? []).filter((key) => Math.abs(key.time - time) >= tolerance);
    return { ...tracks, [path]: [...keys, { time: Math.max(0, time), value, easing }].sort((a, b) => a.time - b.time) };
  };
  return mapTarget(scene, target, (tracks) => edit(tracks));
}

export function removeSceneKeyframe(scene: Scene3d, target: TrackTarget, path: string, time: number, fps = 30): Scene3d {
  const tolerance = 0.5 / Math.max(1, fps);
  return mapTarget(scene, target, (tracks) => {
    const keys = (tracks[path] ?? []).filter((key) => Math.abs(key.time - time) >= tolerance);
    const next = { ...tracks };
    if (keys.length) next[path] = keys;
    else delete next[path];
    return next;
  });
}

export function clearSceneTrack(scene: Scene3d, target: TrackTarget, path?: string): Scene3d {
  return mapTarget(scene, target, (tracks) => {
    if (!path) return {};
    const next = { ...tracks };
    delete next[path];
    return next;
  });
}

function mapTarget(scene: Scene3d, target: TrackTarget, change: (tracks: Scene3dTracks) => Scene3dTracks): Scene3d {
  switch (target.kind) {
    case 'camera':
      return { ...scene, camera: { ...scene.camera, animation: change(scene.camera.animation ?? {}) } };
    case 'environment':
      return { ...scene, environment: { ...scene.environment, animation: change(scene.environment.animation ?? {}) } };
    case 'object':
      return { ...scene, objects: scene.objects.map((object) => (object.id === target.id ? { ...object, animation: change(object.animation ?? {}) } : object)) };
    case 'light':
      return { ...scene, lights: scene.lights.map((light) => (light.id === target.id ? { ...light, animation: change(light.animation ?? {}) } : light)) };
  }
}

// ───────────────────────────── healing ─────────────────────────────

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const vec3 = (value: unknown, fallback: Vec3): Vec3 => (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [value[0], value[1], value[2]] : fallback);
const tracks = (value: unknown): Scene3dTracks => {
  if (!value || typeof value !== 'object') return {};
  const out: Scene3dTracks = {};
  for (const [path, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(keys)) continue;
    const clean = keys
      .filter((key): key is Keyframe => !!key && typeof key === 'object' && typeof (key as Keyframe).time === 'number' && typeof (key as Keyframe).value === 'number')
      .map((key) => ({ time: Math.max(0, key.time), value: key.value, easing: (['linear', 'hold', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'overshoot'] as Easing[]).includes(key.easing) ? key.easing : 'ease-out' as Easing }))
      .sort((a, b) => a.time - b.time);
    if (clean.length) out[path] = clean;
  }
  return out;
};

function healMaterial(input: unknown): Scene3dMaterial | null {
  if (!input || typeof input !== 'object') return null;
  const m = input as Partial<Scene3dMaterial>;
  const base = materialPreset(str(m.preset, '')) ?? MATERIAL_LIBRARY[0];
  const type = (['standard', 'physical', 'basic', 'toon'] as Scene3dMaterialType[]).includes(m.type as Scene3dMaterialType) ? (m.type as Scene3dMaterialType) : base.type;
  return {
    id: str(m.id, uid()),
    name: str(m.name, base.name),
    preset: m.preset ? str(m.preset, base.id) : undefined,
    type,
    color: str(m.color, base.color),
    metalness: clamp01(num(m.metalness, base.metalness)),
    roughness: clamp01(num(m.roughness, base.roughness)),
    emissive: str(m.emissive, base.emissive),
    emissiveIntensity: Math.max(0, num(m.emissiveIntensity, base.emissiveIntensity)),
    opacity: clamp01(num(m.opacity, base.opacity)),
    transmission: clamp01(num(m.transmission, base.transmission)),
    ior: Math.min(2.5, Math.max(1, num(m.ior, base.ior))),
    thickness: Math.max(0, num(m.thickness, base.thickness)),
    clearcoat: clamp01(num(m.clearcoat, base.clearcoat)),
    clearcoatRoughness: clamp01(num(m.clearcoatRoughness, base.clearcoatRoughness)),
    sheen: clamp01(num(m.sheen, base.sheen)),
    iridescence: clamp01(num(m.iridescence, base.iridescence)),
    wireframe: bool(m.wireframe, base.wireframe),
    flatShading: bool(m.flatShading, base.flatShading),
    side: m.side === 'double' ? 'double' : 'front',
    envMapIntensity: Math.max(0, num(m.envMapIntensity, base.envMapIntensity)),
    map: typeof m.map === 'string' && m.map ? m.map : null,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function healObject(input: unknown, materials: Set<string>): Scene3dObject | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Partial<Scene3dObject>;
  const kind = OBJECT_KINDS.includes(o.kind as Scene3dObjectKind) ? (o.kind as Scene3dObjectKind) : 'box';
  const fresh = newObject(kind);
  const params: Record<string, number | string | boolean> = { ...fresh.params };
  if (o.params && typeof o.params === 'object') {
    for (const [key, value] of Object.entries(o.params)) {
      if (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' || typeof value === 'boolean') params[key] = value;
    }
  }
  return {
    id: str(o.id, fresh.id),
    name: str(o.name, fresh.name),
    kind,
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
    position: vec3(o.position, fresh.position),
    rotation: vec3(o.rotation, fresh.rotation),
    scale: vec3(o.scale, fresh.scale),
    materialId: typeof o.materialId === 'string' && materials.has(o.materialId) ? o.materialId : null,
    opacity: clamp01(num(o.opacity, 1)),
    castShadow: bool(o.castShadow, fresh.castShadow),
    receiveShadow: bool(o.receiveShadow, fresh.receiveShadow),
    visible: bool(o.visible, true),
    params,
    animation: tracks(o.animation),
  };
}

function healLight(input: unknown): Scene3dLight | null {
  if (!input || typeof input !== 'object') return null;
  const l = input as Partial<Scene3dLight>;
  const kind = (['ambient', 'hemisphere', 'directional', 'point', 'spot', 'area'] as Scene3dLightKind[]).includes(l.kind as Scene3dLightKind) ? (l.kind as Scene3dLightKind) : 'point';
  const fresh = newLight(kind);
  return {
    id: str(l.id, fresh.id),
    name: str(l.name, fresh.name),
    kind,
    color: str(l.color, fresh.color),
    intensity: Math.max(0, num(l.intensity, fresh.intensity)),
    position: vec3(l.position, fresh.position),
    target: vec3(l.target, fresh.target),
    castShadow: bool(l.castShadow, fresh.castShadow),
    angle: Math.min(89, Math.max(1, num(l.angle, fresh.angle))),
    penumbra: clamp01(num(l.penumbra, fresh.penumbra)),
    decay: Math.max(0, num(l.decay, fresh.decay)),
    distance: Math.max(0, num(l.distance, fresh.distance)),
    width: Math.max(0.01, num(l.width, fresh.width)),
    height: Math.max(0.01, num(l.height, fresh.height)),
    groundColor: str(l.groundColor, fresh.groundColor),
    animation: tracks(l.animation),
  };
}

function healCamera(input: unknown): Scene3dCamera {
  const fresh = defaultCamera();
  if (!input || typeof input !== 'object') return fresh;
  const c = input as Partial<Scene3dCamera>;
  const orbit = c.orbit && typeof c.orbit === 'object' ? c.orbit : fresh.orbit;
  return {
    mode: c.mode === 'orbit' ? 'orbit' : 'free',
    position: vec3(c.position, fresh.position),
    rotation: vec3(c.rotation, fresh.rotation),
    lookAt: c.lookAt === null ? null : vec3(c.lookAt, fresh.lookAt as Vec3),
    orbit: { target: vec3(orbit.target, fresh.orbit.target), radius: Math.max(0.01, num(orbit.radius, fresh.orbit.radius)), azimuth: num(orbit.azimuth, fresh.orbit.azimuth), elevation: Math.min(89.9, Math.max(-89.9, num(orbit.elevation, fresh.orbit.elevation))) },
    focalLength: Math.min(1200, Math.max(4, num(c.focalLength, fresh.focalLength))),
    sensorWidth: Math.min(100, Math.max(4, num(c.sensorWidth, fresh.sensorWidth))),
    fStop: Math.min(64, Math.max(0.7, num(c.fStop, fresh.fStop))),
    focusDistance: Math.max(0.05, num(c.focusDistance, fresh.focusDistance)),
    depthOfField: bool(c.depthOfField, fresh.depthOfField),
    blades: Math.min(16, Math.max(3, Math.round(num(c.blades, fresh.blades)))),
    shutterAngle: Math.min(360, Math.max(1, num(c.shutterAngle, fresh.shutterAngle))),
    near: Math.max(0.001, num(c.near, fresh.near)),
    far: Math.max(1, num(c.far, fresh.far)),
    animation: tracks(c.animation),
  };
}

function healEnvironment(input: unknown): Scene3dEnvironment {
  const fresh = defaultEnvironment();
  if (!input || typeof input !== 'object') return fresh;
  const e = input as Partial<Scene3dEnvironment>;
  const fog = e.fog && typeof e.fog === 'object' ? e.fog : fresh.fog;
  return {
    preset: ENVIRONMENT_PRESETS.some((preset) => preset.id === e.preset) ? (e.preset as Scene3dEnvironmentPreset) : fresh.preset,
    hdri: typeof e.hdri === 'string' && e.hdri ? e.hdri : null,
    intensity: Math.max(0, num(e.intensity, fresh.intensity)),
    rotation: num(e.rotation, fresh.rotation),
    background: (['transparent', 'color', 'environment', 'gradient'] as Scene3dEnvironment['background'][]).includes(e.background as Scene3dEnvironment['background']) ? (e.background as Scene3dEnvironment['background']) : fresh.background,
    backgroundColor: str(e.backgroundColor, fresh.backgroundColor),
    backgroundColor2: str(e.backgroundColor2, fresh.backgroundColor2),
    blur: clamp01(num(e.blur, fresh.blur)),
    fog: { enabled: bool(fog.enabled, false), color: str(fog.color, fresh.fog.color), near: Math.max(0, num(fog.near, fresh.fog.near)), far: Math.max(0.1, num(fog.far, fresh.fog.far)) },
    animation: tracks(e.animation),
  };
}

function healRender(input: unknown): Scene3dRender {
  const fresh = defaultRender();
  if (!input || typeof input !== 'object') return fresh;
  const r = input as Partial<Scene3dRender>;
  return {
    shadows: bool(r.shadows, fresh.shadows),
    shadowMapSize: r.shadowMapSize === 1024 || r.shadowMapSize === 4096 ? r.shadowMapSize : 2048,
    toneMapping: (['aces', 'neutral', 'agx', 'linear', 'reinhard'] as Scene3dRender['toneMapping'][]).includes(r.toneMapping as Scene3dRender['toneMapping']) ? (r.toneMapping as Scene3dRender['toneMapping']) : fresh.toneMapping,
    exposure: Math.min(8, Math.max(0.05, num(r.exposure, fresh.exposure))),
    antialias: bool(r.antialias, fresh.antialias),
    engine: r.engine === 'cycles' ? 'cycles' : 'eevee',
    samples: Math.min(4096, Math.max(1, Math.round(num(r.samples, fresh.samples)))),
    motionBlur: bool(r.motionBlur, fresh.motionBlur),
  };
}

/** A well-formed scene from anything: a saved project, an AI payload, an older version. */
export function healScene(input: unknown): Scene3d {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<Scene3d>;
  const materials = (Array.isArray(s.materials) ? s.materials : []).map(healMaterial).filter((m): m is Scene3dMaterial => !!m);
  const materialIds = new Set(materials.map((m) => m.id));
  const objects = (Array.isArray(s.objects) ? s.objects : []).map((o) => healObject(o, materialIds)).filter((o): o is Scene3dObject => !!o);
  const objectIds = new Set(objects.map((o) => o.id));
  for (const object of objects) if (object.parentId && (!objectIds.has(object.parentId) || object.parentId === object.id)) object.parentId = null;
  return {
    version: 1,
    name: str(s.name, '3D Scene'),
    duration: Math.max(0.1, num(s.duration, 5)),
    objects,
    materials,
    camera: healCamera(s.camera),
    lights: (Array.isArray(s.lights) ? s.lights : []).map(healLight).filter((l): l is Scene3dLight => !!l),
    environment: healEnvironment(s.environment),
    render: healRender(s.render),
  };
}

// ───────────────────────────── AI scene operations ─────────────────────────────

export type SceneOp =
  | { op: 'add_object'; object: Partial<Scene3dObject> & { kind: Scene3dObjectKind; material?: string } }
  | { op: 'update_object'; id: string; patch: Partial<Scene3dObject> & { material?: string } }
  | { op: 'remove_object'; id: string }
  | { op: 'add_material'; material: Partial<Scene3dMaterial> & { preset?: string } }
  | { op: 'update_material'; id: string; patch: Partial<Scene3dMaterial> }
  | { op: 'add_light'; light: Partial<Scene3dLight> & { kind: Scene3dLightKind } }
  | { op: 'update_light'; id: string; patch: Partial<Scene3dLight> }
  | { op: 'remove_light'; id: string }
  | { op: 'set_camera'; patch: Partial<Scene3dCamera> }
  | { op: 'set_environment'; patch: Partial<Scene3dEnvironment> }
  | { op: 'set_render'; patch: Partial<Scene3dRender> }
  | { op: 'set_keyframes'; target: TrackTarget; property: string; keys: { time: number; value: number; easing?: Easing }[]; replace?: boolean }
  | { op: 'clear_keyframes'; target: TrackTarget; property?: string }
  | { op: 'set_name'; name: string }
  | { op: 'set_duration'; duration: number };

const findByIdOrName = <T extends { id: string; name: string }>(items: T[], ref: string) => items.find((item) => item.id === ref) ?? items.find((item) => item.name.toLowerCase() === ref.toLowerCase());

/** Resolves a material reference (`material: 'chrome'`) into a scene material id, adding the preset when needed. */
function ensureMaterial(scene: Scene3d, ref: string | undefined | null): { scene: Scene3d; id: string | null } {
  if (!ref) return { scene, id: null };
  const existing = findByIdOrName(scene.materials, ref) ?? scene.materials.find((m) => m.preset === ref);
  if (existing) return { scene, id: existing.id };
  if (!materialPreset(ref)) return { scene, id: null };
  const created = materialFromPreset(ref);
  return { scene: { ...scene, materials: [...scene.materials, created] }, id: created.id };
}

/** Applies a list of scene ops in order; unknown references throw with the reason. */
export function applySceneOps(scene: Scene3d, ops: SceneOp[]): Scene3d {
  let next = scene;
  for (const op of ops) {
    switch (op.op) {
      case 'add_object': {
        const { material, ...fields } = op.object;
        const resolved = ensureMaterial(next, material ?? fields.materialId);
        next = resolved.scene;
        const object = newObject(fields.kind, { ...(healObject({ ...newObject(fields.kind), ...fields }, new Set(next.materials.map((m) => m.id))) ?? {}), materialId: resolved.id ?? fields.materialId ?? null });
        if (object.parentId && !next.objects.some((o) => o.id === object.parentId)) object.parentId = findByIdOrName(next.objects, object.parentId)?.id ?? null;
        next = { ...next, objects: [...next.objects, object] };
        break;
      }
      case 'update_object': {
        const target = findByIdOrName(next.objects, op.id);
        if (!target) throw new Error(`No object "${op.id}" in the scene.`);
        const { material, ...patch } = op.patch;
        const resolved = ensureMaterial(next, material);
        next = resolved.scene;
        const merged = healObject({ ...target, ...patch, params: { ...target.params, ...(patch.params ?? {}) }, materialId: resolved.id ?? patch.materialId ?? target.materialId, animation: patch.animation ?? target.animation }, new Set(next.materials.map((m) => m.id)));
        next = { ...next, objects: next.objects.map((o) => (o.id === target.id ? (merged ?? o) : o)) };
        break;
      }
      case 'remove_object': {
        const target = findByIdOrName(next.objects, op.id);
        if (!target) throw new Error(`No object "${op.id}" in the scene.`);
        next = { ...next, objects: next.objects.filter((o) => o.id !== target.id).map((o) => (o.parentId === target.id ? { ...o, parentId: target.parentId } : o)) };
        break;
      }
      case 'add_material': {
        const created = healMaterial({ ...(op.material.preset ? materialFromPreset(op.material.preset) : {}), ...op.material, id: op.material.id ?? uid() });
        if (created) next = { ...next, materials: [...next.materials, created] };
        break;
      }
      case 'update_material': {
        const target = findByIdOrName(next.materials, op.id) ?? next.materials.find((m) => m.preset === op.id);
        if (!target) throw new Error(`No material "${op.id}" in the scene.`);
        const merged = healMaterial({ ...target, ...op.patch, id: target.id });
        next = { ...next, materials: next.materials.map((m) => (m.id === target.id ? (merged ?? m) : m)) };
        break;
      }
      case 'add_light': {
        const light = healLight({ ...newLight(op.light.kind), ...op.light });
        if (light) next = { ...next, lights: [...next.lights, light] };
        break;
      }
      case 'update_light': {
        const target = findByIdOrName(next.lights, op.id);
        if (!target) throw new Error(`No light "${op.id}" in the scene.`);
        const merged = healLight({ ...target, ...op.patch, id: target.id });
        next = { ...next, lights: next.lights.map((l) => (l.id === target.id ? (merged ?? l) : l)) };
        break;
      }
      case 'remove_light': {
        const target = findByIdOrName(next.lights, op.id);
        if (!target) throw new Error(`No light "${op.id}" in the scene.`);
        next = { ...next, lights: next.lights.filter((l) => l.id !== target.id) };
        break;
      }
      case 'set_camera':
        next = { ...next, camera: healCamera({ ...next.camera, ...op.patch, orbit: { ...next.camera.orbit, ...(op.patch.orbit ?? {}) }, animation: op.patch.animation ?? next.camera.animation }) };
        break;
      case 'set_environment':
        next = { ...next, environment: healEnvironment({ ...next.environment, ...op.patch, fog: { ...next.environment.fog, ...(op.patch.fog ?? {}) }, animation: op.patch.animation ?? next.environment.animation }) };
        break;
      case 'set_render':
        next = { ...next, render: healRender({ ...next.render, ...op.patch }) };
        break;
      case 'set_keyframes': {
        const target = resolveTarget(next, op.target);
        if (op.replace) next = clearSceneTrack(next, target, op.property);
        for (const key of op.keys) {
          if (typeof key.time !== 'number' || typeof key.value !== 'number') continue;
          next = setSceneKeyframe(next, target, op.property, key.time, key.value, key.easing ?? 'ease-out');
        }
        break;
      }
      case 'clear_keyframes':
        next = clearSceneTrack(next, resolveTarget(next, op.target), op.property);
        break;
      case 'set_name':
        next = { ...next, name: op.name };
        break;
      case 'set_duration':
        next = { ...next, duration: Math.max(0.1, op.duration) };
        break;
      default:
        throw new Error(`Unknown scene op ${(op as { op: string }).op}`);
    }
  }
  return next;
}

function resolveTarget(scene: Scene3d, target: TrackTarget): TrackTarget {
  if (target.kind === 'object') {
    const found = findByIdOrName(scene.objects, target.id);
    if (!found) throw new Error(`No object "${target.id}" in the scene.`);
    return { kind: 'object', id: found.id };
  }
  if (target.kind === 'light') {
    const found = findByIdOrName(scene.lights, target.id);
    if (!found) throw new Error(`No light "${target.id}" in the scene.`);
    return { kind: 'light', id: found.id };
  }
  return target;
}

/** A compact, id-bearing description for the AI (`get_3d_scene`). */
export function describeScene(scene: Scene3d) {
  const animated = (tracks: Scene3dTracks) => Object.entries(tracks).filter(([, keys]) => keys.length).map(([path, keys]) => `${path} (${keys.length})`);
  return {
    name: scene.name,
    duration: scene.duration,
    camera: {
      mode: scene.camera.mode,
      position: scene.camera.mode === 'orbit' ? orbitPosition(scene.camera.orbit) : scene.camera.position,
      lookAt: scene.camera.mode === 'orbit' ? scene.camera.orbit.target : scene.camera.lookAt,
      orbit: scene.camera.mode === 'orbit' ? scene.camera.orbit : undefined,
      focalLength: scene.camera.focalLength,
      sensorWidth: scene.camera.sensorWidth,
      fStop: scene.camera.fStop,
      focusDistance: scene.camera.focusDistance,
      depthOfField: scene.camera.depthOfField,
      animated: animated(scene.camera.animation),
    },
    objects: scene.objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind, parentId: o.parentId ?? undefined, position: o.position, rotation: o.rotation, scale: o.scale, material: scene.materials.find((m) => m.id === o.materialId)?.name ?? null, params: o.params, animated: animated(o.animation), visible: o.visible })),
    materials: scene.materials.map((m) => ({ id: m.id, name: m.name, preset: m.preset, type: m.type, color: m.color, metalness: m.metalness, roughness: m.roughness, transmission: m.transmission, emissive: m.emissiveIntensity > 0 ? m.emissive : undefined })),
    lights: scene.lights.map((l) => ({ id: l.id, name: l.name, kind: l.kind, color: l.color, intensity: l.intensity, position: l.position, target: l.target, castShadow: l.castShadow, animated: animated(l.animation) })),
    environment: { preset: scene.environment.preset, hdri: scene.environment.hdri, intensity: scene.environment.intensity, background: scene.environment.background, fog: scene.environment.fog.enabled },
    render: scene.render,
  };
}

// ───────────────────────────── presets ─────────────────────────────

export type ScenePresetId = 'empty' | 'product-turntable' | 'floating-text' | 'orbit-hero' | 'exploded-grid' | 'parallax-photo' | 'neon-tunnel' | 'glass-showcase' | 'logo-reveal';
export const SCENE_PRESETS: { id: ScenePresetId; label: string; hint: string }[] = [
  { id: 'empty', label: 'Empty stage', hint: 'Camera, key light and studio environment; add your own objects' },
  { id: 'product-turntable', label: 'Product turntable', hint: 'A hero object on a pedestal, camera orbits 90° with shallow focus' },
  { id: 'floating-text', label: 'Floating 3D text', hint: 'Extruded title in crimson glass, slow orbit, rack focus' },
  { id: 'orbit-hero', label: 'Orbit hero', hint: 'One glass sphere and a gold ring, full 360° orbit' },
  { id: 'exploded-grid', label: 'Exploded grid', hint: '5×5 cubes pop in with stagger while the camera pushes in' },
  { id: 'parallax-photo', label: 'Parallax photo', hint: 'Image planes at three depths; a dolly makes them separate' },
  { id: 'neon-tunnel', label: 'Neon tunnel', hint: 'Emissive rings receding into fog, camera flies through' },
  { id: 'glass-showcase', label: 'Glass showcase', hint: 'Frosted glass slab over a dark floor, sunset light' },
  { id: 'logo-reveal', label: 'Logo reveal', hint: 'An image card flips in with overshoot, then holds' },
];

export type ScenePresetOptions = { title?: string; accent?: string; duration?: number; assetIds?: string[]; imagePaths?: string[]; modelPath?: string; aspect?: number };

const keys = (points: [number, number, Easing?][]): Keyframe[] => points.map(([time, value, easing]) => ({ time, value, easing: easing ?? 'ease-in-out' }));

/** A whole scene from a preset id; unknown ids give the empty stage. */
export function buildScenePreset(id: string, options: ScenePresetOptions = {}): Scene3d {
  const duration = options.duration && options.duration > 0 ? options.duration : 5;
  const accent = options.accent ?? '#d34b55';
  const title = options.title ?? 'HELIOS';
  const base = healScene({ name: title, duration, materials: [], objects: [], lights: [newLight('hemisphere', { intensity: 0.5 }), newLight('directional', { position: [4, 7, 5], intensity: 2.2 })], camera: defaultCamera(), environment: defaultEnvironment(), render: defaultRender() });
  const mat = (preset: string, overrides: Partial<Scene3dMaterial> = {}) => materialFromPreset(preset, overrides);

  switch (id) {
    case 'product-turntable': {
      const pedestal = mat('void', { name: 'Pedestal' });
      const hero = mat('chrome', { name: 'Hero' });
      const floor = mat('void', { name: 'Floor', roughness: 0.35 });
      return {
        ...base,
        materials: [pedestal, hero, floor],
        objects: [
          newObject('plane', { name: 'Floor', position: [0, 0, 0], rotation: [-90, 0, 0], materialId: floor.id, params: { width: 30, height: 30 }, castShadow: false }),
          newObject('cylinder', { name: 'Pedestal', position: [0, 0.12, 0], materialId: pedestal.id, params: { radiusTop: 1.1, radiusBottom: 1.2, height: 0.24, segments: 96 } }),
          newObject(options.modelPath ? 'model' : 'torusKnot', { name: 'Hero', position: [0, 1.15, 0], materialId: options.modelPath ? null : hero.id, params: options.modelPath ? { path: options.modelPath, fit: 1.4 } : { radius: 0.55, tube: 0.17, p: 2, q: 3, segments: 160 }, animation: { 'rotation.y': keys([[0, -20, 'linear'], [duration, 40, 'linear']]) } }),
        ],
        camera: { ...base.camera, mode: 'orbit', orbit: { target: [0, 0.95, 0], radius: 5, azimuth: -45, elevation: 14 }, focalLength: 65, fStop: 2, focusDistance: 5, depthOfField: true, animation: { 'orbit.azimuth': keys([[0, -45, 'ease-in-out'], [duration, 45]]), 'orbit.radius': keys([[0, 5.4, 'ease-out'], [duration, 4.6]]) } },
        lights: [newLight('hemisphere', { intensity: 0.35 }), newLight('spot', { name: 'Key', position: [3, 6, 3], target: [0, 1, 0], intensity: 120, angle: 32, penumbra: 0.5 }), newLight('spot', { name: 'Rim', position: [-4, 4, -3], target: [0, 1, 0], intensity: 60, color: accent, angle: 40, penumbra: 0.6, castShadow: false })],
        environment: { ...base.environment, preset: 'studio', background: 'gradient', backgroundColor: '#0c0608', backgroundColor2: '#2a080f' },
      };
    }
    case 'floating-text': {
      const glass = mat('crimson-glass', { name: 'Title glass', color: accent });
      const floor = mat('void', { name: 'Floor', roughness: 0.3 });
      return {
        ...base,
        materials: [glass, floor],
        objects: [
          newObject('plane', { name: 'Floor', position: [0, -0.6, 0], rotation: [-90, 0, 0], materialId: floor.id, params: { width: 40, height: 40 }, castShadow: false }),
          newObject('text', { name: 'Title', position: [0, 0.3, 0], materialId: glass.id, params: { text: title, size: 0.9, depth: 0.22, font: 'bold', align: 'center', bevel: true }, animation: { 'position.y': keys([[0, -0.2, 'ease-out'], [1.2, 0.3]]), 'rotation.y': keys([[0, -12, 'linear'], [duration, 12, 'linear']]) } }),
        ],
        camera: { ...base.camera, mode: 'orbit', orbit: { target: [0, 0.3, 0], radius: 7, azimuth: 18, elevation: 8 }, focalLength: 85, fStop: 1.8, focusDistance: 7, depthOfField: true, animation: { 'focusDistance': keys([[0, 9, 'ease-in-out'], [1.4, 7]]), 'orbit.azimuth': keys([[0, 18, 'ease-in-out'], [duration, -14]]) } },
        lights: [newLight('hemisphere', { intensity: 0.4 }), newLight('directional', { name: 'Key', position: [5, 8, 4], intensity: 2.4 }), newLight('point', { name: 'Fill', position: [-4, 2, 4], intensity: 30, color: '#ffd8d3', castShadow: false })],
        environment: { ...base.environment, preset: 'studio', background: 'transparent' },
      };
    }
    case 'orbit-hero': {
      const glass = mat('glass', { name: 'Sphere' });
      const gold = mat('gold', { name: 'Ring' });
      return {
        ...base,
        materials: [glass, gold],
        objects: [
          newObject('sphere', { name: 'Sphere', position: [0, 0.8, 0], materialId: glass.id, params: { radius: 0.7, segments: 96 } }),
          newObject('torus', { name: 'Ring', position: [0, 0.8, 0], rotation: [70, 0, 20], materialId: gold.id, params: { radius: 1.1, tube: 0.05, segments: 128 }, animation: { 'rotation.z': keys([[0, 20, 'linear'], [duration, 380, 'linear']]) } }),
        ],
        camera: { ...base.camera, mode: 'orbit', orbit: { target: [0, 0.8, 0], radius: 4.5, azimuth: 0, elevation: 10 }, focalLength: 50, fStop: 2.8, focusDistance: 4.5, depthOfField: true, animation: { 'orbit.azimuth': keys([[0, 0, 'linear'], [duration, 360, 'linear']]) } },
        environment: { ...base.environment, preset: 'sunset', background: 'transparent' },
      };
    }
    case 'exploded-grid': {
      const cube = mat('glossy-plastic', { name: 'Cube', color: accent });
      const alt = mat('warm-white', { name: 'Cube light' });
      const objects: Scene3dObject[] = [];
      let index = 0;
      for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
          const delay = 0.08 * index++;
          objects.push(newObject('box', { name: `Cube ${index}`, position: [x * 1.15, y * 1.15 + 1.2, 0], materialId: (x + y) % 2 === 0 ? cube.id : alt.id, params: { width: 0.9, height: 0.9, depth: 0.9 }, animation: { 'scale.x': keys([[delay, 0, 'overshoot'], [delay + 0.7, 1]]), 'scale.y': keys([[delay, 0, 'overshoot'], [delay + 0.7, 1]]), 'scale.z': keys([[delay, 0, 'overshoot'], [delay + 0.7, 1]]), 'rotation.y': keys([[delay, -90, 'ease-out'], [delay + 0.9, 0]]) } }));
        }
      }
      return {
        ...base,
        materials: [cube, alt],
        objects,
        camera: { ...base.camera, mode: 'orbit', orbit: { target: [0, 1.2, 0], radius: 11, azimuth: -25, elevation: 12 }, focalLength: 60, fStop: 4, focusDistance: 11, depthOfField: false, animation: { 'orbit.radius': keys([[0, 12, 'ease-out'], [duration, 8.5]]), 'orbit.azimuth': keys([[0, -25, 'ease-in-out'], [duration, 15]]) } },
        environment: { ...base.environment, preset: 'room', background: 'transparent' },
      };
    }
    case 'parallax-photo': {
      const layers = (options.imagePaths?.length ? options.imagePaths : options.assetIds ?? []).slice(0, 4);
      const card = mat('warm-white', { name: 'Card' });
      const objects: Scene3dObject[] = layers.length
        ? layers.map((ref, i) => newObject('image', { name: `Layer ${i + 1}`, position: [(i - (layers.length - 1) / 2) * 0.6, 1, -i * 2.2], params: { [ref.includes('/') || ref.includes('\\') ? 'path' : 'assetId']: ref, width: 0, height: 2.6 + i * 0.6 }, castShadow: false }))
        : [0, 1, 2].map((i) => newObject('plane', { name: `Card ${i + 1}`, position: [(i - 1) * 1.4, 1, -i * 2.2], materialId: card.id, params: { width: 2.2, height: 3 }, castShadow: false }));
      return {
        ...base,
        materials: [card],
        objects,
        camera: { ...base.camera, mode: 'free', position: [-1.2, 1, 6], lookAt: [0, 1, -2], focalLength: 40, fStop: 2, focusDistance: 6, depthOfField: true, animation: { 'position.x': keys([[0, -1.2, 'ease-in-out'], [duration, 1.2]]), 'position.z': keys([[0, 6.5, 'ease-out'], [duration, 5.2]]) } },
        environment: { ...base.environment, preset: 'room', background: 'transparent' },
      };
    }
    case 'neon-tunnel': {
      const neon = mat('neon', { name: 'Neon', emissive: accent });
      const objects = Array.from({ length: 14 }, (_, i) => newObject('torus', { name: `Ring ${i + 1}`, position: [0, 1.2, -i * 2.4], materialId: neon.id, params: { radius: 2.2, tube: 0.06, segments: 96 }, castShadow: false, animation: { 'rotation.z': keys([[0, i * 8, 'linear'], [duration, i * 8 + (i % 2 ? 60 : -60), 'linear']]) } }));
      return {
        ...base,
        materials: [neon],
        objects,
        camera: { ...base.camera, mode: 'free', position: [0, 1.2, 4], lookAt: [0, 1.2, -40], focalLength: 24, fStop: 2.8, focusDistance: 8, depthOfField: false, animation: { 'position.z': keys([[0, 4, 'ease-in'], [duration, -22]]) } },
        lights: [newLight('ambient', { intensity: 0.2 })],
        environment: { ...base.environment, preset: 'night', background: 'color', backgroundColor: '#05030a', fog: { enabled: true, color: '#05030a', near: 4, far: 26 } },
      };
    }
    case 'glass-showcase': {
      const slab = mat('frosted-glass', { name: 'Slab' });
      const floor = mat('void', { name: 'Floor', roughness: 0.2 });
      return {
        ...base,
        materials: [slab, floor],
        objects: [
          newObject('plane', { name: 'Floor', position: [0, 0, 0], rotation: [-90, 0, 0], materialId: floor.id, params: { width: 30, height: 30 }, castShadow: false }),
          newObject('box', { name: 'Slab', position: [0, 1, 0], materialId: slab.id, params: { width: 3.2, height: 1.8, depth: 0.16 }, animation: { 'rotation.y': keys([[0, -35, 'ease-out'], [1.6, 0]]), 'position.y': keys([[0, 0.7, 'ease-out'], [1.6, 1]]) } }),
        ],
        camera: { ...base.camera, mode: 'orbit', orbit: { target: [0, 1, 0], radius: 5.5, azimuth: 8, elevation: 6 }, focalLength: 50, fStop: 2.2, focusDistance: 5.5, depthOfField: true },
        environment: { ...base.environment, preset: 'sunset', background: 'transparent' },
      };
    }
    case 'logo-reveal': {
      const ref = options.imagePaths?.[0] ?? options.assetIds?.[0];
      const card = mat('ceramic', { name: 'Card' });
      return {
        ...base,
        materials: [card],
        objects: [
          ref
            ? newObject('image', { name: 'Logo', position: [0, 1, 0], params: { [ref.includes('/') || ref.includes('\\') ? 'path' : 'assetId']: ref, width: 0, height: 2.2 }, animation: { 'rotation.y': keys([[0, 100, 'overshoot'], [1.1, 0]]), 'scale.x': keys([[0, 0.6, 'overshoot'], [1.1, 1]]), 'scale.y': keys([[0, 0.6, 'overshoot'], [1.1, 1]]) } })
            : newObject('box', { name: 'Logo card', position: [0, 1, 0], materialId: card.id, params: { width: 3, height: 1.7, depth: 0.1 }, animation: { 'rotation.y': keys([[0, 100, 'overshoot'], [1.1, 0]]), 'scale.x': keys([[0, 0.6, 'overshoot'], [1.1, 1]]), 'scale.y': keys([[0, 0.6, 'overshoot'], [1.1, 1]]) } }),
        ],
        camera: { ...base.camera, mode: 'free', position: [0, 1, 5.5], lookAt: [0, 1, 0], focalLength: 55, fStop: 2.8, focusDistance: 5.5, depthOfField: true },
        environment: { ...base.environment, preset: 'studio', background: 'transparent' },
      };
    }
    default:
      return base;
  }
}

// ───────────────────────────── project integration ─────────────────────────────

const clipBase = (fields: Pick<Clip, 'id' | 'trackId' | 'start' | 'duration' | 'source' | 'name'>): Clip => ({
  in: 0,
  speed: 1,
  linkId: null,
  enabled: true,
  volume: 1,
  transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
  effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
  label: 'purple',
  groupId: null,
  reverse: false,
  maintainPitch: true,
  hold: null,
  interpolation: 'sampling',
  deinterlace: false,
  adjustment: false,
  mask: null,
  keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
  channels: 'stereo',
  enhanceSpeech: false,
  audioType: null,
  appliedEffects: [],
  ...fields,
});

export type CreateSceneResult = {
  project: Project;
  sceneComp?: Comp;
  /** The clip on the target comp (the overlay when nested, the scene clip itself otherwise). */
  newClipId: string;
  /** The clip whose source holds the scene JSON. */
  sceneClipId: string;
  targetCompId: string;
  trackId: string;
  start: number;
  duration: number;
  scene: Scene3d;
};

/**
 * Packages a scene as a `[3D] name` comp holding one scene3d clip, overlaid on the target comp
 * on the track above the footage — the same shape as a MOGRT, so every timeline tool, the
 * export and frame QA treat it like any other graphic. `asNestedComp: false` puts the scene
 * clip straight on the track.
 */
export function createScene3dComp(project: Project, opts: { scene: Scene3d; targetCompId?: string; start?: number; duration?: number; track?: string; asNestedComp?: boolean }): CreateSceneResult {
  const targetCompId = opts.targetCompId || project.activeCompId || project.comps[0]?.id;
  const targetComp = project.comps.find((c) => c.id === targetCompId);
  if (!targetComp) throw new Error(`Target comp not found: ${targetCompId}`);
  const duration = opts.duration && opts.duration > 0 ? opts.duration : opts.scene.duration;
  const scene = { ...opts.scene, duration };
  const asNestedComp = opts.asNestedComp ?? true;

  const videoTracks = targetComp.tracks.filter((t) => t.kind === 'video');
  let targetTrack = opts.track ? targetComp.tracks.find((t) => t.id === opts.track || t.name.toLowerCase() === opts.track?.toLowerCase()) : undefined;
  const newTracks = [...targetComp.tracks];
  if (!targetTrack) {
    if (videoTracks.length >= 2) targetTrack = videoTracks[videoTracks.length - 1];
    else {
      const created: Track = { id: `v${videoTracks.length + 1}`, kind: 'video', name: `Video ${videoTracks.length + 1}`, locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 64 };
      newTracks.push(created);
      targetTrack = created;
    }
  }

  let start = opts.start ?? 0;
  if (opts.start === undefined) {
    const primary = targetComp.clips.find((c) => c.enabled && targetComp.tracks.find((t) => t.id === c.trackId)?.kind === 'video');
    if (primary) start = primary.duration > duration + 2 ? Math.round((primary.start + 1.5) * 10) / 10 : primary.start;
  }

  const newClipId = uid();
  const name = `[3D] ${scene.name}`;
  if (asNestedComp) {
    const sceneCompId = `comp_3d_${uid()}`;
    const sceneClipId = uid();
    const sceneClip = clipBase({ id: sceneClipId, trackId: 'v1', start: 0, duration, name: scene.name, source: { type: 'scene3d', scene, title: scene.name } });
    const sceneComp: Comp = {
      id: sceneCompId,
      name,
      width: targetComp.width || 1920,
      height: targetComp.height || 1080,
      fps: targetComp.fps || 30,
      tracks: [{ id: 'v1', kind: 'video', name: '3D Layer', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 64 }],
      clips: [sceneClip],
      markers: [],
      transitions: [],
      inPoint: null,
      outPoint: null,
      sourceVideo: null,
      sourceAudio: null,
      folderId: null,
    };
    const overlay = clipBase({ id: newClipId, trackId: targetTrack.id, start, duration, name, source: { type: 'comp', compId: sceneCompId } });
    const updatedTarget = { ...targetComp, tracks: newTracks, clips: [...targetComp.clips, overlay] };
    return { project: { ...project, comps: [...project.comps.filter((c) => c.id !== targetComp.id), updatedTarget, sceneComp] }, sceneComp, newClipId, sceneClipId, targetCompId: targetComp.id, trackId: targetTrack.id, start, duration, scene };
  }
  const direct = clipBase({ id: newClipId, trackId: targetTrack.id, start, duration, name, source: { type: 'scene3d', scene, title: scene.name } });
  const updatedTarget = { ...targetComp, tracks: newTracks, clips: [...targetComp.clips, direct] };
  return { project: { ...project, comps: project.comps.map((c) => (c.id === targetComp.id ? updatedTarget : c)) }, newClipId, sceneClipId: newClipId, targetCompId: targetComp.id, trackId: targetTrack.id, start, duration, scene };
}

/** The scene clip a timeline clip refers to: itself, or the single scene3d clip inside a `[3D]` comp. */
export function findSceneClip(project: Project, clipId: string): { comp: Comp; clip: Clip; source: Scene3dSource } | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((c) => c.id === clipId);
    if (!clip) continue;
    if (clip.source.type === 'scene3d') return { comp, clip, source: clip.source };
    if (clip.source.type === 'comp') {
      const child = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      const inner = child?.clips.find((c) => c.source.type === 'scene3d');
      if (child && inner && inner.source.type === 'scene3d') return { comp: child, clip: inner, source: inner.source };
    }
    return null;
  }
  return null;
}

/** Every enabled scene3d clip reachable from `compId`, with the comp it lives in. */
export function scene3dClipsForExport(project: Project, compId: string): { comp: Comp; clip: Clip; source: Scene3dSource }[] {
  const seen = new Set<string>();
  const out: { comp: Comp; clip: Clip; source: Scene3dSource }[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId);
      if (clip.source.type === 'scene3d' && !clip.adjustment) out.push({ comp, clip, source: clip.source });
    }
  };
  visit(compId);
  return out;
}

/** Replaces the scene on a clip (by scene clip id) without touching anything else. */
export function replaceScene(project: Project, sceneClipId: string, scene: Scene3d): Project {
  return {
    ...project,
    comps: project.comps.map((comp) => ({
      ...comp,
      clips: comp.clips.map((clip) => (clip.id === sceneClipId && clip.source.type === 'scene3d' ? { ...clip, name: clip.name && clip.name !== clip.source.scene.name ? clip.name : scene.name, source: { ...clip.source, scene, title: scene.name } } : clip)),
    })),
  };
}
