// Headless-Blender 3D scenes (docs/REFERENCE-FILMS-PLAN.md §5, A6). The AI writes a small 3D
// scene — or picks one of the presets below — and `blender_render_start` renders it in the user's
// Blender to a PNG sequence with alpha, which lands in the motion engine as `source.sequence`
// footage. The presets are the 3D moments of the reference films, rebuilt from the proofs:
//   pearl-core-orb       aflow's glossy orb over a soft shadow, turning slowly
//   crystal-gradient-env Modern Motion's faceted crystal lit by a hand-made gradient environment
//   device-hero          a rounded phone/laptop slab settling into a hero angle (SaaS films)
//   logo-extrude         extruded glass/metal word that swings into place
//   letters-drop         letters falling onto a floor one by one (keyed, not simulated)
// Scene axes are Blender's: x right, y away from the camera, z up; sizes in metres (1 m ≈ 1000 px
// at the default framing). Keys: {t: seconds, v: value, ease: [x1,y1,x2,y2] or a named ease}.

import type { Layer, MotionScene } from '../motion/types';

export type Vec3 = [number, number, number];
export type Key3 = { t: number; v: Vec3 | number; ease?: string | [number, number, number, number] };
export type MaterialSpec = { preset: 'plastic' | 'glass' | 'frosted' | 'pearl' | 'metal' | 'gem' | 'clay' | 'emission' | 'flat' | 'image'; /** image: the picture on the surface (a UI screen from create_ui_screen, a poster). */ image?: string; color?: string; roughness?: number; metallic?: number; ior?: number; thinFilm?: number; strength?: number };
export type Object3D = {
  id: string;
  kind: 'box' | 'rounded-box' | 'sphere' | 'icosphere' | 'torus' | 'cylinder' | 'cone' | 'capsule' | 'crystal' | 'text' | 'plane' | 'empty' | 'floor';
  position?: Vec3; rotation?: Vec3; scale?: number | Vec3;
  material?: MaterialSpec;
  positionKeys?: Key3[]; rotationKeys?: Key3[]; scaleKeys?: Key3[];
  /** An earlier object's id: this one moves with it (position/rotation are relative to it). */
  parent?: string;
  [extra: string]: unknown;
};
export type Scene3D = {
  width: number; height: number; fps: number; duration: number;
  engine?: 'eevee' | 'cycles'; samples?: number; step?: number; frames?: number[];
  transparent?: boolean; motionBlur?: boolean;
  world?: string | { color?: string; gradient?: [number, string][]; strength?: number; poleFade?: number };
  lights?: 'studio' | { id: string; position: Vec3; power?: number; size?: number; color?: string; target?: Vec3; kind?: 'area' | 'point' | 'sun' | 'spot' }[];
  camera?: { position?: Vec3; target?: Vec3; lens?: number; fstop?: number; positionKeys?: Key3[]; targetKeys?: Key3[] };
  objects: Object3D[];
  /** Scene px per metre in camera.json; chosen so a 2D layer at the camera target's depth keeps its size. */
  pxPerMetre?: number;
};

type Frame = { width: number; height: number; fps: number; duration: number };
type Params = Record<string, unknown>;

const str = (p: Params, k: string, d: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : d);
const num = (p: Params, k: string, d: number) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : d);

/** A calm floor with a soft shadow (Cycles: a shadow catcher; EEVEE: the shadow-only trick). */
const floor = (z: number): Object3D => ({ id: 'floor', kind: 'floor', position: [0, 0, z], fade: 5 });

export type Preset3D = { id: string; label: string; use: string; params: Record<string, string>; seconds: number; build: (p: Params, f: Frame) => Omit<Scene3D, keyof Frame> };

export const PRESETS_3D: Preset3D[] = [
  {
    id: 'pearl-core-orb',
    label: 'Pearl core orb',
    use: 'A glossy pearl orb inside a glass shell turning over a soft shadow — the AI "core" hero (aflow).',
    params: { color: 'core colour (#hex)', shell: 'glass tint (#hex)', spin: 'degrees turned over the shot (default 60)' },
    seconds: 4,
    build: (p, f) => ({
      // Glass only reads against light: the shell refracts a bright lavender world (aflow's palette).
      world: { gradient: [[0, '#f4f1ff'], [0.25, '#b9a8ff'], [0.5, '#ffffff'], [0.75, '#9fd8ff']], strength: 1.2 },
      camera: { position: [0, -5.2, 0.7], target: [0, 0, 0.05], lens: 50, positionKeys: [{ t: 0, v: [0, -5.6, 0.75], ease: 'settle' }, { t: f.duration, v: [0, -5.0, 0.65] }] },
      objects: [
        floor(-0.62),
        { id: 'core', kind: 'sphere', radius: 0.4, material: { preset: 'pearl', color: str(p, 'color', '#9d8cff') },
          rotationKeys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: f.duration, v: [0, 0, num(p, 'spin', 60)] }] },
        { id: 'shell', kind: 'sphere', radius: 0.56, material: { preset: 'glass', color: str(p, 'shell', '#ffffff'), roughness: 0.02, thinFilm: 380 },
          scaleKeys: [{ t: 0, v: 0.9, ease: 'rise' }, { t: Math.min(1.2, f.duration), v: 1 }] },
      ],
    }),
  },
  {
    id: 'crystal-gradient-env',
    label: 'Crystal in a gradient world',
    use: 'A faceted crystal whose every facet picks a different hue from a hand-made gradient environment, turning slowly (Modern Motion).',
    params: { colors: 'list of 3–5 #hex the facets pick up (default pink → violet → cyan → gold)', spin: 'degrees turned (default 90)' },
    seconds: 4,
    build: (p, f) => {
      const colors = Array.isArray(p.colors) && p.colors.length >= 2 ? (p.colors as string[]) : ['#ff5ab4', '#6a5cff', '#29d3ff', '#ffd166'];
      return {
        world: { gradient: colors.map((c, i) => [i / colors.length, c] as [number, string]), strength: 1.4 },
        // One soft top light casts the floor shadow; the facets' colour comes from the world.
        lights: [{ id: 'top', position: [0.6, -0.8, 4], power: 350, size: 2.5, color: '#ffffff' }],
        camera: { position: [0, -4.2, 0.5], target: [0, 0, 0.1], lens: 45 },
        objects: [
          { ...floor(-0.75), fade: 2.2, lit: 0.55 },
          { id: 'crystal', kind: 'crystal', material: { preset: 'gem', color: '#ffffff', metallic: 1, roughness: 0.15 },
            rotationKeys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: f.duration, v: [0, 0, num(p, 'spin', 90)] }],
            positionKeys: [{ t: 0, v: [0, 0, -0.08], ease: 'ease-in-out' }, { t: f.duration / 2, v: [0, 0, 0.05], ease: 'ease-in-out' }, { t: f.duration, v: [0, 0, -0.08] }] },
        ],
      };
    },
  },
  {
    id: 'device-hero',
    label: 'Device hero',
    use: 'A rounded phone or laptop slab that swings from an angle into its hero pose — put the UI on it afterwards as a 2D layer riding camera.json.',
    params: { device: 'phone | tablet | laptop (default phone)', color: 'body colour (#hex)', screen: 'screen colour (#hex)', screenImage: 'a picture shown on the screen: a UI screen from create_ui_screen (its screen picture path) or any image file', from: 'start yaw in degrees (default -35)' },
    seconds: 3,
    build: (p, f) => {
      const device = str(p, 'device', 'phone');
      const size: Vec3 = device === 'laptop' ? [2.2, 0.08, 1.4] : device === 'tablet' ? [1.3, 0.06, 1.75] : [0.78, 0.07, 1.6];
      const land = Math.min(1.4, f.duration * 0.6);
      return {
        world: { color: '#eef0ff', strength: 0.8 },
        camera: { position: [0, -5.5, 0.4], target: [0, 0, 0], lens: 55 },
        objects: [
          floor(-size[2] / 2 - 0.25),
          { id: 'body', kind: 'rounded-box', size, radius: device === 'laptop' ? 0.05 : 0.09, material: { preset: 'plastic', color: str(p, 'color', '#1d1f2b'), roughness: 0.25 },
            rotationKeys: [{ t: 0, v: [8, 0, num(p, 'from', -35)], ease: 'house' }, { t: land, v: [0, 0, 0] }],
            positionKeys: [{ t: 0, v: [0, 0.6, -0.15], ease: 'house' }, { t: land, v: [0, 0, 0] }] },
          typeof p.screenImage === 'string' && p.screenImage
            ? { id: 'screen', kind: 'plane', parent: 'body', size: [size[0] * 0.9, size[2] * 0.92], position: [0, -size[1] / 2 - 0.006, 0], material: { preset: 'image', image: p.screenImage } }
            : { id: 'screen', kind: 'box', parent: 'body', size: [size[0] * 0.9, 0.01, size[2] * 0.92], position: [0, -size[1] / 2 - 0.006, 0], material: { preset: 'flat', color: str(p, 'screen', '#6a5cff') } },
        ],
      };
    },
  },
  {
    id: 'logo-extrude',
    label: 'Extruded logo word',
    use: 'A word extruded in glass, metal or plastic that swings in and settles — the 3D logo resolve.',
    params: { text: 'the word (≤ 24 characters)', material: 'glass | metal | plastic | pearl (default metal)', color: '#hex' },
    seconds: 3,
    build: (p, f) => {
      const text = str(p, 'text', 'Bhippi').slice(0, 24);
      const land = Math.min(1.3, f.duration * 0.55);
      return {
        world: { gradient: [[0, '#6a5cff'], [0.33, '#ffffff'], [0.66, '#29d3ff']], strength: 1.1 },
        camera: { position: [0, -5, 0.3], target: [0, 0, 0], lens: 50 },
        objects: [
          floor(-0.45),
          { id: 'word', kind: 'text', text, size: Math.min(0.9, 5 / Math.max(3, text.length)), extrude: 0.1, bevel: 0.02, rotation: [90, 0, 0],
            material: { preset: str(p, 'material', 'metal') as MaterialSpec['preset'], color: str(p, 'color', '#e8e8ff') },
            rotationKeys: [{ t: 0, v: [90, 0, -28], ease: 'snap-settle' }, { t: land, v: [90, 0, 0] }],
            scaleKeys: [{ t: 0, v: 0.82, ease: 'snap-settle' }, { t: land, v: 1 }] },
        ],
      };
    },
  },
  {
    id: 'letters-drop',
    label: 'Letters drop',
    use: 'Rounded 3D letters that drop onto a floor one after another and settle with a small bounce (keyed, so every render is identical).',
    params: { text: 'the word (≤ 12 characters)', color: '#hex', stagger: 'seconds between letters (default 0.08)' },
    seconds: 3,
    build: (p) => {
      const letters = Array.from(str(p, 'text', 'HELLO').slice(0, 12));
      const size = Math.min(0.7, 4.2 / Math.max(4, letters.length));
      const gap = size * 0.72;
      const stagger = num(p, 'stagger', 0.08);
      return {
        world: { color: '#f5f3ff', strength: 0.9 },
        camera: { position: [0, -5.2, 1.4], target: [0, 0, 0.2], lens: 45 },
        objects: [
          floor(0),
          ...letters.map((letter, i): Object3D => {
            const x = (i - (letters.length - 1) / 2) * gap;
            const at = i * stagger;
            return {
              id: `l${i}`, kind: 'text', text: letter, size, extrude: size * 0.25, bevel: size * 0.06, rotation: [90, 0, 0],
              material: { preset: 'plastic', color: str(p, 'color', '#6a5cff') },
              positionKeys: [
                { t: 0, v: [x, 0, 2.6] }, { t: at, v: [x, 0, 2.6], ease: 'cubic-in' }, { t: at + 0.42, v: [x, 0, size * 0.36], ease: 'cubic-out' },
                { t: at + 0.56, v: [x, 0, size * 0.36 + 0.12], ease: 'cubic-in' }, { t: at + 0.7, v: [x, 0, size * 0.36] },
              ],
              rotationKeys: [{ t: 0, v: [90, 0, 14 * (i % 2 ? 1 : -1)] }, { t: at, v: [90, 0, 14 * (i % 2 ? 1 : -1)], ease: 'settle' }, { t: at + 0.7, v: [90, 0, 0] }],
            };
          }),
        ],
      };
    },
  },
  {
    id: 'card-ring',
    label: 'Card ring',
    use: 'A ring of rounded cards turning around the centre (feature cards, app screens, logos) — the Virgil / aflow 3D card carousel. Give images for real UI on the cards.',
    params: { count: 'cards (default 8)', images: 'list of picture paths shown on the cards (UI screens, logos); cycles if fewer than cards', color: 'card colour (#hex)', spin: 'degrees the ring turns (default 90)' },
    seconds: 5,
    build: (p, f) => {
      const n = Math.max(3, Math.min(16, Math.round(num(p, 'count', 8))));
      const images = Array.isArray(p.images) ? (p.images as string[]).filter((x) => typeof x === 'string' && x) : [];
      const radius = 1.9;
      const cards: Object3D[] = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const position: Vec3 = [Math.sin(a) * radius, -Math.cos(a) * radius, 0];
        // Each card faces outward from the ring's centre (its yaw follows its angle round the ring).
        const yaw = (a * 180) / Math.PI;
        const body: Object3D = { id: `card${i}`, kind: 'rounded-box', parent: 'ring', size: [1.1, 0.03, 0.75], radius: 0.02, position, rotation: [0, 0, yaw], material: { preset: 'plastic', color: str(p, 'color', images.length ? '#1c1e2a' : '#f5f6ff'), roughness: 0.3 } };
        return images.length ? [body, { id: `face${i}`, kind: 'plane', parent: `card${i}`, size: [1.04, 0.7], position: [0, -0.017, 0], rotation: [90, 0, 0], material: { preset: 'image', image: images[i % images.length] } } as Object3D] : [body];
      }).flat();
      return {
        world: { gradient: [[0, '#1b1d3a'], [0.5, '#3b2f8f'], [1, '#1b1d3a']], strength: 0.9 },
        camera: { position: [0, -6.2, 1.1], target: [0, 0, 0], lens: 40 },
        objects: [
          floor(-0.7),
          { id: 'ring', kind: 'empty', rotationKeys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: f.duration, v: [0, 0, num(p, 'spin', 90)] }] },
          ...cards,
        ],
      };
    },
  },
  {
    id: 'sphere-bouquet',
    label: 'Sphere bouquet',
    use: 'A cluster of glossy spheres in the brand colours that settles in and floats — the aflow drop world.',
    params: { colors: 'list of 3–6 #hex (default violet, pink, lavender, white, blue)', material: 'pearl | plastic | glass (default pearl)' },
    seconds: 4,
    build: (p, f) => {
      const colors = Array.isArray(p.colors) && p.colors.length ? (p.colors as string[]) : ['#7b61ff', '#ff5ab4', '#c7b8ff', '#ffffff', '#4c8dff'];
      const spots: [number, number, number, number][] = [[0, 0, 0, 0.55], [-0.85, 0.3, 0.35, 0.38], [0.9, 0.2, 0.3, 0.42], [-0.35, -0.2, -0.55, 0.3], [0.45, -0.3, 0.7, 0.26], [0.2, 0.5, -0.6, 0.33], [-0.95, -0.1, -0.45, 0.22], [1.15, -0.2, -0.35, 0.2]];
      return {
        world: { gradient: [[0, '#f4f1ff'], [0.35, '#d9ccff'], [0.7, '#ffe3f3']], strength: 1.1 },
        camera: { position: [0, -5.5, 0.6], target: [0, 0, 0.05], lens: 50, fstop: 2.4 },
        objects: [
          floor(-0.8),
          ...spots.map(([x, y, z, r], i): Object3D => ({
            id: `s${i}`, kind: 'sphere', radius: r, position: [x, y, z],
            material: { preset: str(p, 'material', 'pearl') as MaterialSpec['preset'], color: colors[i % colors.length] },
            positionKeys: [{ t: 0, v: [x * 1.6, y, z + 2.2], ease: 'settle' }, { t: 0.9 + i * 0.07, v: [x, y, z], ease: 'ease-in-out' }, { t: f.duration, v: [x, y, z + 0.08 * ((i % 2) * 2 - 1)] }],
          })),
        ],
      };
    },
  },
];

export const find3dPreset = (id: string) => PRESETS_3D.find((preset) => preset.id === id);

/** The render request for a preset or a raw scene, sized to the comp; quality picks the engine. */
export function scene3dRequest(input: { preset?: string; params?: Params; scene?: Partial<Scene3D> }, frame: Frame, quality: 'draft' | 'final' = 'draft'): Scene3D {
  const engine = quality === 'final' ? 'cycles' : 'eevee';
  const base: Partial<Scene3D> = { engine, samples: quality === 'final' ? 64 : 32, transparent: true, motionBlur: true };
  if (input.preset) {
    const preset = find3dPreset(input.preset);
    if (!preset) throw new Error(`No 3D preset "${input.preset}". Presets: ${PRESETS_3D.map((p) => p.id).join(', ')}.`);
    return withPxPerMetre({ ...base, ...frame, ...preset.build(input.params ?? {}, frame), ...(input.scene ?? {}) } as Scene3D);
  }
  if (!input.scene?.objects?.length) throw new Error('Give a preset (list_3d_presets) or a scene with objects.');
  return withPxPerMetre({ ...base, ...frame, ...input.scene } as Scene3D);
}

/** Pixels per metre in camera.json, chosen so a 2D 3D-layer at the camera target's depth shows at its own size (AE zoom = lens / sensor × width). */
export function withPxPerMetre(scene: Scene3D): Scene3D {
  if (scene.pxPerMetre) return scene;
  const cam = scene.camera ?? {};
  const pos = cam.positionKeys?.[0]?.v ?? cam.position ?? [0, -6, 1.2];
  const target = cam.targetKeys?.[0]?.v ?? cam.target ?? [0, 0, 0];
  const d = Array.isArray(pos) && Array.isArray(target) ? Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]) : 6;
  const zoom = ((cam.lens ?? 50) / 36) * scene.width;
  return { ...scene, pxPerMetre: Math.round((zoom / Math.max(0.1, d)) * 100) / 100 };
}

export type Render3DResult = { dir: string; frames: number; fps: number; step?: number; width: number; height: number; camera?: string; objects2d?: string };

export type CameraFile = { fps: number; width: number; height: number; pxPerMetre: number; frames: { frame: number; t: number; position: number[]; pointOfInterest: number[]; zoom: number }[] };
export type ObjectsFile = { fps: number; frames: ({ frame: number } & Record<string, { x: number; y: number; box: number[]; behind: boolean } | number>)[] };

/** A motion-engine camera that moves exactly like Blender's, so 3D layers (type, UI, glints set to threeD) sit in the render's space. */
export function cameraLayer(file: CameraFile, every = 2): Layer {
  const frames = file.frames.filter((_, i) => i % every === 0 || i === file.frames.length - 1);
  const keys = (pick: (f: CameraFile['frames'][number]) => number | number[]) => ({ k: frames.map((f) => ({ t: Math.round(f.t * 1e4) / 1e4, v: pick(f), ease: 'linear' as const })) });
  const still = frames.every((f) => f.position.every((v, i) => Math.abs(v - frames[0].position[i]) < 0.01) && Math.abs(f.zoom - frames[0].zoom) < 0.01);
  return {
    id: 'blender-camera', name: 'Camera (from Blender)', type: 'camera',
    transform: { position: still ? frames[0].position : keys((f) => f.position) as never },
    pointOfInterest: still ? frames[0].pointOfInterest : keys((f) => f.pointOfInterest) as never,
    zoom: still ? frames[0].zoom : keys((f) => f.zoom) as never,
  } as Layer;
}

/** Nulls that follow objects' screen centres, so 2D labels, glints and callouts can be parented to them. */
export function trackLayers(file: ObjectsFile, ids: string[], every = 2): Layer[] {
  return ids.flatMap((id) => {
    const points = file.frames.filter((f, i) => (i % every === 0 || i === file.frames.length - 1) && typeof f[id] === 'object').map((f) => ({ t: Math.round(((f.frame - 1) / file.fps) * 1e4) / 1e4, v: [(f[id] as { x: number }).x, (f[id] as { y: number }).y] }));
    return points.length ? [{ id: `track-${id}`, name: `Track · ${id}`, type: 'null', transform: { position: { k: points.map((p) => ({ ...p, ease: 'linear' as const })) } } } as Layer] : [];
  });
}

/** The motion scene that plays a finished render: one footage layer reading the PNG sequence. */
export function renderScene(render: Render3DResult, size: { width: number; height: number }, title = '3D render', extras: Layer[] = []): MotionScene {
  const fps = render.fps / Math.max(1, render.step ?? 1);
  const duration = Math.max(1 / render.fps, render.frames / fps);
  return {
    version: 1, width: size.width, height: size.height, duration,
    layers: [{
      id: 'render3d', name: title, type: 'footage', fit: 'contain',
      source: { sequence: { dir: render.dir, fps, frames: render.frames, start: 1, digits: 5, ext: 'png' }, kind: 'image', width: render.width, height: render.height },
    }, ...extras],
  } as MotionScene;
}
