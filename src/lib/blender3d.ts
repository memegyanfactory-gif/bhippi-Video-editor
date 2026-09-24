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

import type { MotionScene } from '../motion/types';

export type Vec3 = [number, number, number];
export type Key3 = { t: number; v: Vec3 | number; ease?: string | [number, number, number, number] };
export type MaterialSpec = { preset: 'plastic' | 'glass' | 'frosted' | 'pearl' | 'metal' | 'gem' | 'clay' | 'emission' | 'flat'; color?: string; roughness?: number; metallic?: number; ior?: number; thinFilm?: number; strength?: number };
export type Object3D = {
  id: string;
  kind: 'box' | 'rounded-box' | 'sphere' | 'icosphere' | 'torus' | 'cylinder' | 'cone' | 'capsule' | 'crystal' | 'text' | 'floor';
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
    params: { device: 'phone | tablet | laptop (default phone)', color: 'body colour (#hex)', screen: 'screen colour (#hex)', from: 'start yaw in degrees (default -35)' },
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
          { id: 'screen', kind: 'box', parent: 'body', size: [size[0] * 0.9, 0.01, size[2] * 0.92], position: [0, -size[1] / 2 - 0.006, 0], material: { preset: 'flat', color: str(p, 'screen', '#6a5cff') } },
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
      const text = str(p, 'text', 'Helios').slice(0, 24);
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
];

export const find3dPreset = (id: string) => PRESETS_3D.find((preset) => preset.id === id);

/** The render request for a preset or a raw scene, sized to the comp; quality picks the engine. */
export function scene3dRequest(input: { preset?: string; params?: Params; scene?: Partial<Scene3D> }, frame: Frame, quality: 'draft' | 'final' = 'draft'): Scene3D {
  const engine = quality === 'final' ? 'cycles' : 'eevee';
  const base: Partial<Scene3D> = { engine, samples: quality === 'final' ? 64 : 32, transparent: true, motionBlur: true };
  if (input.preset) {
    const preset = find3dPreset(input.preset);
    if (!preset) throw new Error(`No 3D preset "${input.preset}". Presets: ${PRESETS_3D.map((p) => p.id).join(', ')}.`);
    return { ...base, ...frame, ...preset.build(input.params ?? {}, frame), ...(input.scene ?? {}) } as Scene3D;
  }
  if (!input.scene?.objects?.length) throw new Error('Give a preset (list_3d_presets) or a scene with objects.');
  return { ...base, ...frame, ...input.scene } as Scene3D;
}

export type Render3DResult = { dir: string; frames: number; fps: number; step?: number; width: number; height: number; camera?: string; objects2d?: string };

/** The motion scene that plays a finished render: one footage layer reading the PNG sequence. */
export function renderScene(render: Render3DResult, size: { width: number; height: number }, title = '3D render'): MotionScene {
  const fps = render.fps / Math.max(1, render.step ?? 1);
  const duration = Math.max(1 / render.fps, render.frames / fps);
  return {
    version: 1, width: size.width, height: size.height, duration,
    layers: [{
      id: 'render3d', name: title, type: 'footage', fit: 'contain',
      source: { sequence: { dir: render.dir, fps, frames: render.frames, start: 1, digits: 5, ext: 'png' }, kind: 'image', width: render.width, height: render.height },
    }],
  } as MotionScene;
}
