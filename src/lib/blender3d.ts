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
  /** What this object is called as a render layer ("Phone", "Glass shell"); the id, tidied, when left out. */
  label?: string;
  [extra: string]: unknown;
};
/** One footage layer of a render: the objects it shows (their children come too). `kind` is set when the request is resolved. */
export type LayerSpec = { id: string; name?: string; objects: string[]; kind?: 'objects' | 'shadow' | 'background' };
export type Scene3D = {
  width: number; height: number; fps: number; duration: number;
  engine?: 'eevee' | 'cycles'; samples?: number; step?: number; frames?: number[];
  transparent?: boolean; motionBlur?: boolean;
  world?: string | { color?: string; gradient?: [number, string][]; strength?: number; poleFade?: number };
  lights?: 'studio' | { id: string; position: Vec3; power?: number; size?: number; color?: string; target?: Vec3; kind?: 'area' | 'point' | 'sun' | 'spot' }[];
  camera?: { position?: Vec3; target?: Vec3; lens?: number; fstop?: number; positionKeys?: Key3[]; targetKeys?: Key3[] };
  objects: Object3D[];
  /** How the render is split into footage layers. 'auto' (default): one layer per top-level object (its children ride along), a "Shadow" layer for the floor and a "Background" layer when `transparent` is false. 'single': one sequence. Or your own groups of object ids. */
  layers?: 'auto' | 'single' | LayerSpec[];
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
      // The pearl sits wholly behind its glass shell, so the shell's layer already holds it: one "Orb" layer.
      layers: [{ id: 'orb', name: 'Orb', objects: ['core', 'shell'] }],
      // Glass only reads against light: the shell refracts a bright lavender world (aflow's palette).
      world: { gradient: [[0, '#f4f1ff'], [0.25, '#b9a8ff'], [0.5, '#ffffff'], [0.75, '#9fd8ff']], strength: 1.2 },
      camera: { position: [0, -5.2, 0.7], target: [0, 0, 0.05], lens: 50, positionKeys: [{ t: 0, v: [0, -5.6, 0.75], ease: 'settle' }, { t: f.duration, v: [0, -5.0, 0.65] }] },
      objects: [
        floor(-0.62),
        { id: 'core', label: 'Pearl orb', kind: 'sphere', radius: 0.4, material: { preset: 'pearl', color: str(p, 'color', '#9d8cff') },
          rotationKeys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: f.duration, v: [0, 0, num(p, 'spin', 60)] }] },
        { id: 'shell', label: 'Glass shell', kind: 'sphere', radius: 0.56, material: { preset: 'glass', color: str(p, 'shell', '#ffffff'), roughness: 0.02, thinFilm: 380 },
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
          { id: 'crystal', label: 'Crystal', kind: 'crystal', material: { preset: 'gem', color: '#ffffff', metallic: 1, roughness: 0.15 },
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
          { id: 'body', label: device === 'laptop' ? 'Laptop' : device === 'tablet' ? 'Tablet' : 'Phone', kind: 'rounded-box', size, radius: device === 'laptop' ? 0.05 : 0.09, material: { preset: 'plastic', color: str(p, 'color', '#1d1f2b'), roughness: 0.25 },
            rotationKeys: [{ t: 0, v: [8, 0, num(p, 'from', -35)], ease: 'house' }, { t: land, v: [0, 0, 0] }],
            positionKeys: [{ t: 0, v: [0, 0.6, -0.15], ease: 'house' }, { t: land, v: [0, 0, 0] }] },
          typeof p.screenImage === 'string' && p.screenImage
            ? { id: 'screen', label: 'Screen', kind: 'plane', parent: 'body', size: [size[0] * 0.9, size[2] * 0.92], position: [0, -size[1] / 2 - 0.006, 0], material: { preset: 'image', image: p.screenImage } }
            : { id: 'screen', label: 'Screen', kind: 'box', parent: 'body', size: [size[0] * 0.9, 0.01, size[2] * 0.92], position: [0, -size[1] / 2 - 0.006, 0], material: { preset: 'flat', color: str(p, 'screen', '#6a5cff') } },
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
          { id: 'word', label: 'Logo text', kind: 'text', text, size: Math.min(0.9, 5 / Math.max(3, text.length)), extrude: 0.1, bevel: 0.02, rotation: [90, 0, 0],
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
              id: `l${i}`, label: `Letter ${letter}`, kind: 'text', text: letter, size, extrude: size * 0.25, bevel: size * 0.06, rotation: [90, 0, 0],
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
          { id: 'ring', label: 'Cards', kind: 'empty', rotationKeys: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: f.duration, v: [0, 0, num(p, 'spin', 90)] }] },
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
            id: `s${i}`, label: `Sphere ${i + 1}`, kind: 'sphere', radius: r, position: [x, y, z],
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
    return withLayers(withPxPerMetre({ ...base, ...frame, ...preset.build(input.params ?? {}, frame), ...(input.scene ?? {}) } as Scene3D));
  }
  if (!input.scene?.objects?.length) throw new Error('Give a preset (list_3d_presets) or a scene with objects.');
  return withLayers(withPxPerMetre({ ...base, ...frame, ...input.scene } as Scene3D));
}

/** Most object layers a render is split into; the smallest and furthest objects share "Other objects". */
export const MAX_OBJECT_LAYERS = 6;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const tidy = (id: string) => { const words = id.replace(/[-_]+/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').trim(); return words ? words[0].toUpperCase() + words.slice(1) : id; };
const vec = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number') ? [v[0], v[1], v[2]] : null);

/** A rough size in metres, for choosing which objects keep their own layer. */
function objectSize(o: Object3D): number {
  const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is number => typeof x === 'number') : []);
  let size = Math.max(n('radius') * 2, n('height'), ...arr('size'), n('major') * 2);
  if (o.kind === 'text') size = Math.max(size, n('size') * Math.max(1, String(o.text ?? '').length) * 0.5);
  const scale = typeof o.scale === 'number' ? o.scale : Array.isArray(o.scale) ? Math.max(...(o.scale as number[])) : 1;
  return (size || 1) * (scale || 1);
}

/**
 * The layers a request renders in. `auto` (the default) gives every top-level object its own layer
 * (children ride with their parent), the floor's shadow a "Shadow" layer, and a world that is not
 * transparent a "Background" layer; a scene that would come out as one layer (one object, no floor,
 * a transparent world) stays one sequence.
 * Past MAX_OBJECT_LAYERS the smallest, furthest objects are grouped as "Other objects". A list of
 * groups you wrote is honoured the same way; objects it leaves out go to "Other objects".
 * Returns `'single'` or the list the Blender bridge renders (back to front is decided there).
 */
export function resolveLayers(scene: Scene3D): 'single' | LayerSpec[] {
  const mode = scene.layers ?? 'auto';
  if (mode === 'single') return 'single';
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const rootOf = (o: Object3D): Object3D => {
    let cur = o;
    for (let guard = 0; cur.parent && byId.has(cur.parent) && guard < 64; guard++) cur = byId.get(cur.parent)!;
    return cur;
  };
  const floors = scene.objects.filter((o) => o.kind === 'floor' && o.shadow !== 'none').map((o) => o.id);
  const shows = (o: Object3D) => o.kind !== 'floor' && o.kind !== 'empty';
  const visible = scene.objects.filter(shows);
  if (!visible.length) return 'single';
  const family = new Map<string, Object3D[]>();
  for (const o of scene.objects) if (o.kind !== 'floor') family.set(rootOf(o).id, [...(family.get(rootOf(o).id) ?? []), o]);

  const cam = scene.camera ?? {};
  const eye = vec(cam.positionKeys?.[0]?.v) ?? vec(cam.position) ?? [0, -6, 1.2];
  const near = (o: Object3D) => {
    const at = vec(o.positionKeys?.[o.positionKeys.length - 1]?.v) ?? vec(o.position) ?? [0, 0, 0];
    return Math.max(0.5, Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]));
  };
  type Group = { id: string; name: string; objects: string[]; score: number };
  let groups: Group[] = [];
  if (Array.isArray(mode)) {
    const claimed = new Set<string>();
    for (const spec of mode) {
      const ids = new Set<string>();
      const take = (id: string) => {
        if (claimed.has(id) || byId.get(id)?.kind === 'floor') return;
        ids.add(id);
        claimed.add(id);
        for (const o of scene.objects) if (o.parent === id) take(o.id);
      };
      for (const id of spec.objects ?? []) if (byId.has(id)) take(id);
      const members = [...ids].map((id) => byId.get(id)!);
      if (!members.some(shows)) continue;
      groups.push({ id: spec.id || members[0].id, name: spec.name || members[0].label || tidy(members[0].id), objects: [...ids], score: Math.max(...members.filter(shows).map((m) => objectSize(m) / near(m))) });
    }
    const left = visible.filter((o) => !claimed.has(o.id));
    if (left.length) groups.push({ id: 'other-objects', name: 'Other objects', objects: scene.objects.filter((o) => o.kind !== 'floor' && !claimed.has(o.id)).map((o) => o.id), score: 0 });
  } else {
    groups = [...family.values()].filter((members) => members.some(shows)).map((members) => {
      const root = rootOf(members[0]);
      return { id: root.id, name: root.label || tidy(root.id), objects: members.map((m) => m.id), score: Math.max(...members.filter(shows).map((m) => objectSize(m) / near(m))) };
    });
  }
  if (groups.length > MAX_OBJECT_LAYERS) {
    const ranked = [...groups].sort((a, b) => b.score - a.score);
    const keep = new Set(ranked.slice(0, MAX_OBJECT_LAYERS - 1));
    const rest = groups.filter((g) => !keep.has(g));
    groups = [...groups.filter((g) => keep.has(g)), { id: 'other-objects', name: 'Other objects', objects: rest.flatMap((g) => g.objects), score: 0 }];
  }
  const taken = new Set(['shadow', 'background']);
  const layers: LayerSpec[] = groups.map((g) => {
    let id = slug(g.id) || 'layer';
    for (let n = 2; taken.has(id); n++) id = `${slug(g.id) || 'layer'}-${n}`;
    taken.add(id);
    return { id, name: g.name, objects: g.objects, kind: 'objects' };
  });
  if (floors.length) layers.push({ id: 'shadow', name: 'Shadow', objects: floors, kind: 'shadow' });
  if (scene.transparent === false) layers.push({ id: 'background', name: 'Background', objects: [], kind: 'background' });
  return layers.length >= 2 ? layers : 'single';
}

/** The scene with its layers settled: 'single', or the explicit list the bridge renders. */
export function withLayers(scene: Scene3D): Scene3D {
  return { ...scene, layers: resolveLayers(scene) };
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

/** One rendered layer: its own PNG sequence (`dir`, absolute), the object ids it shows and its distance from the camera. */
export type RenderLayer = { id: string; name: string; dir: string; frames: number; objects: string[]; depth: number; kind?: LayerSpec['kind'] };
export type Render3DResult = { dir: string; frames: number; fps: number; step?: number; width: number; height: number; camera?: string; objects2d?: string; /** Back to front; absent for a single render. */ layers?: RenderLayer[] };

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

/**
 * The motion scene that plays a finished render: one footage layer reading the PNG sequence, or,
 * for a layered render, one footage layer per rendered layer. The engine draws `layers[0]` at the
 * bottom, so a layered render keeps the bridge's back-to-front order (Background, Shadow, then the
 * objects far to near) and each layer is named by its layer name ("Phone", "Shadow").
 */
export function renderScene(render: Render3DResult, size: { width: number; height: number }, title = '3D render', extras: Layer[] = []): MotionScene {
  const fps = render.fps / Math.max(1, render.step ?? 1);
  const duration = Math.max(1 / render.fps, render.frames / fps);
  const footage = (id: string, name: string, dir: string, frames: number): Layer => ({
    id, name, type: 'footage', fit: 'contain',
    source: { sequence: { dir, fps, frames, start: 1, digits: 5, ext: 'png' }, kind: 'image', width: render.width, height: render.height },
  } as Layer);
  const parts = render.layers?.length
    ? render.layers.map((layer) => footage(`render3d-${layer.id}`, layer.name || tidy(layer.id), layer.dir, layer.frames || render.frames))
    : [footage('render3d', title, render.dir, render.frames)];
  return { version: 1, width: size.width, height: size.height, duration, layers: [...parts, ...extras] } as MotionScene;
}
