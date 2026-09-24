// The drawn-FX library (docs/REFERENCE-FILMS-PLAN.md P5, B3): one-call accents a motion designer
// drops on a beat — a confetti pop, sparkles, a burst, a ripple, a star glint, a glow ring, speed
// lines, comic "!" marks, a moving gradient border, an echo trail — as ordinary engine layers
// (particles, shapes, links), so they preview, export and edit like everything else. Pure.
import { Track } from './keys';
import type { Layer, MotionScene, ShapeItem, Vec } from './types';

type Cue = NonNullable<MotionScene['cues']>[number];

export const FX_KINDS = ['confetti-pop', 'confetti-rain', 'sparkles', 'burst', 'ripple', 'star-glint', 'glow-ring', 'speed-lines', 'exclaim', 'gradient-border', 'echo', 'dust', 'bokeh', 'snow', 'embers', 'light-shafts', 'mesh-gradient', 'dot-wave'] as const;
export type FxKind = (typeof FX_KINDS)[number];

export type FxOptions = {
  kind: FxKind;
  /** Scene seconds it starts. */
  t?: number;
  /** Frame point (px). */
  at?: Vec;
  duration?: number;
  color?: string;
  colors?: string[];
  /** Size in px (glint, ring, burst reach, sparkle area) or a multiplier for particles. */
  size?: number;
  count?: number;
  /** gradient-border / echo: the layer it wraps or trails. */
  target?: string;
  /** gradient-border: the box [x, y, w, h] when there is no target (or to override it). */
  box?: Vec;
  radius?: number;
  seed?: number;
  /** echo: copies, seconds between them, opacity kept per copy. */
  copies?: number;
  delay?: number;
  decay?: number;
  direction?: number;
};

export type FxResult = { layers: { layer: Layer; below?: string; above?: string }[]; cues: Cue[] };

export const FX_HELP: Record<FxKind, string> = {
  'confetti-pop': 'a confetti burst from a point (at) that falls (celebration, a number landing)',
  'confetti-rain': 'confetti falling from the top for `duration`',
  sparkles: 'twinkling four-point stars around a point (at, size = radius)',
  burst: 'a ring of short lines shooting out from a point (a click, a pop, an arrival)',
  ripple: 'expanding rings from a point (a tap, a drop)',
  'star-glint': 'a lens star glint that flashes and turns (glass, a logo, a product edge)',
  'glow-ring': 'a glowing ring that expands and fades',
  'speed-lines': 'streaks rushing across the frame (direction degrees) for `duration`',
  exclaim: 'comic "!" emphasis marks popping around a point',
  'gradient-border': 'a moving gradient outline around a layer (target) or box',
  echo: 'trailing copies of a moving layer (target), each `delay` s behind and fainter',
  dust: 'drifting dust motes (ambient, full frame)',
  bokeh: 'soft out-of-focus light circles (ambient)',
  snow: 'falling snow (ambient)',
  embers: 'rising embers (ambient)',
  'light-shafts': 'god rays from above (overlay; at = origin in px)',
  'mesh-gradient': 'a drifting mesh-gradient background (colors: up to 4)',
  'dot-wave': 'a dot-lattice wave terrain background',
};

const DEFAULT_LEN: Partial<Record<FxKind, number>> = { 'confetti-pop': 3, 'confetti-rain': 4, sparkles: 2, burst: 0.8, ripple: 1.3, 'star-glint': 0.7, 'glow-ring': 0.9, 'speed-lines': 1.2, exclaim: 0.9, 'gradient-border': 3 };

const SOUNDS: Partial<Record<FxKind, Cue['sound']>> = { 'confetti-pop': 'pop', burst: 'pop', ripple: 'blip', 'star-glint': 'glass', sparkles: 'shimmer', 'glow-ring': 'chime', 'speed-lines': 'whoosh', exclaim: 'pop' };

let counter = 0;
const uid = (kind: string) => `fx-${kind}-${(++counter).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function fxLayers(o: FxOptions, scene: Pick<MotionScene, 'width' | 'height' | 'duration' | 'layers'>, bounds?: (layerId: string, t: number) => { x: number; y: number; width: number; height: number } | null): FxResult | string {
  const W = scene.width;
  const H = scene.height;
  const t = Math.max(0, o.t ?? 0);
  const at: Vec = o.at ?? [W / 2, H / 2];
  const len = o.duration ?? DEFAULT_LEN[o.kind] ?? Math.max(1, scene.duration - t);
  const color = o.color ?? '#ffffff';
  const id = uid(o.kind);
  const window = { in: t, out: t + len };
  const cues: Cue[] = SOUNDS[o.kind] ? [{ at: t, sound: SOUNDS[o.kind]! }] : [];
  const particles = (preset: string, extra: Record<string, unknown> = {}): FxResult => ({
    layers: [{ layer: { id, name: o.kind, type: 'particles', ...window, particles: { preset, seed: o.seed ?? (counter * 17 + 3), start: t, ...(o.count ? { count: o.count } : {}), ...(o.colors?.length ? { colors: o.colors } : o.color ? { colors: [o.color] } : {}), ...extra } } as Layer }],
    cues,
  });
  switch (o.kind) {
    case 'confetti-pop': return particles('confetti-burst', { at, ...(o.size ? { size: o.size } : {}) });
    case 'confetti-rain': return particles('confetti', { duration: len, ...(o.size ? { size: o.size } : {}) });
    case 'sparkles': { const r = o.size ?? 160; return particles('sparkle', { area: [at[0] - r, at[1] - r, r * 2, r * 2], duration: len }); }
    case 'burst': return particles('burst', { at, ...(o.size ? { size: o.size / 130 } : {}) });
    case 'ripple': return particles('ripple-rings', { at, ...(o.size ? { size: o.size / 270 } : {}) });
    case 'speed-lines': return particles('speed-lines', { duration: len, ...(o.direction !== undefined ? { direction: o.direction } : {}) });
    case 'dust': case 'bokeh': case 'snow': case 'embers': return { layers: [{ layer: { id, name: o.kind, type: 'particles', in: t, particles: { preset: o.kind, seed: o.seed ?? 5, ...(o.count ? { count: o.count } : {}), ...(o.colors?.length ? { colors: o.colors } : o.color ? { colors: [o.color] } : {}) } } as Layer }], cues: [] };
    case 'light-shafts':
      return { layers: [{ layer: { id, name: 'Light shafts', type: 'procedural', kind: 'light-shafts', blend: 'screen', in: t, params: { color, origin: [at[0] / W, o.at ? at[1] / H : -0.1], intensity: 0.5 } } }], cues: [] };
    case 'mesh-gradient': {
      const c = o.colors ?? [];
      return { layers: [{ layer: { id, name: 'Mesh gradient', type: 'procedural', kind: 'mesh-gradient', in: t, params: { ...(c[0] ? { a: c[0] } : {}), ...(c[1] ? { b: c[1] } : {}), ...(c[2] ? { c: c[2] } : {}), ...(c[3] ? { d: c[3] } : {}) } } }], cues: [] };
    }
    case 'dot-wave':
      return { layers: [{ layer: { id, name: 'Dot wave', type: 'procedural', kind: 'dot-wave', in: t, params: { ...(o.color ? { color: o.color } : {}) } } }], cues: [] };
    case 'star-glint': {
      const s = o.size ?? 220;
      const box = s * 1.2;
      const c: Vec = [box / 2, box / 2];
      // Each spike is a group so it can turn about the centre (leaf shapes do not rotate on their own).
      const spike = (w: number, h: number, rot: number): ShapeItem => ({ kind: 'group', transform: { anchor: c, position: c, rotation: rot }, items: [{ kind: 'ellipse', position: c, size: [w, h], fill: { gradient: { kind: 'radial', stops: [[0, '#ffffff'], [0.4, color], [1, `${color}00`]], from: c, to: [c[0] + w / 2, c[1]] } } }] });
      return {
        layers: [{ layer: {
          id, name: 'Star glint', type: 'shape', ...window, blend: 'add',
          transform: { position: at, scale: new Track<number>(0).key(t, 0, 'expo-out').key(t + len * 0.3, 100, 'cubic-in').key(t + len, 0).prop(), rotation: new Track<number>(0).move(t, len, -15, 25, 'linear').prop() },
          effects: [{ type: 'glow', radius: s * 0.12, intensity: 1.2, color }],
          shape: { shape: 'rect', bounds: [box, box], groups: [spike(s, s * 0.05, 0), spike(s, s * 0.05, 90), spike(s * 0.5, s * 0.035, 45), spike(s * 0.5, s * 0.035, -45), { kind: 'ellipse', position: c, size: [s * 0.08, s * 0.08], fill: '#ffffff' }] },
        } as Layer }],
        cues,
      };
    }
    case 'glow-ring': {
      const s = o.size ?? 260;
      const box = s + 40;
      return {
        layers: [{ layer: {
          id, name: 'Glow ring', type: 'shape', ...window,
          transform: { position: at, scale: new Track<number>(20).move(t, len, 20, 110, 'expo-out').prop(), opacity: new Track<number>(0).key(t, 0, 'cubic-out').key(t + 0.08, 100).key(t + len * 0.4, 100, 'cubic-in').key(t + len, 0).prop() },
          effects: [{ type: 'glow', radius: 18, intensity: 1, color }],
          shape: { shape: 'rect', bounds: [box, box], groups: [{ kind: 'ellipse', position: [box / 2, box / 2], size: [s, s], fill: null, stroke: { paint: color, width: 4 } }] },
        } as Layer }],
        cues,
      };
    }
    case 'exclaim': {
      const s = o.size ?? 120;
      const box = s * 2;
      const c: Vec = [box / 2, box / 2];
      const marks: ShapeItem[] = [-50, -15, 20].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        const r0 = s * 0.45;
        const r1 = s * 0.9;
        return { kind: 'path', d: `M${c[0] + Math.cos(a) * r0} ${c[1] + Math.sin(a) * r0} L${c[0] + Math.cos(a) * r1} ${c[1] + Math.sin(a) * r1}`, fill: null, stroke: { paint: color, width: s * 0.09, cap: 'round', trim: { end: new Track<number>(0).move(t, 0.18, 0, 100, 'expo-out').prop(), start: new Track<number>(0).move(t + len - 0.25, 0.25, 0, 100, 'cubic-in').prop() } } } as ShapeItem;
      });
      return { layers: [{ layer: { id, name: 'Emphasis marks', type: 'shape', ...window, transform: { position: [at[0] + s * 0.35, at[1] - s * 0.35] }, shape: { shape: 'rect', bounds: [box, box], groups: marks } } as Layer }], cues };
    }
    case 'gradient-border': {
      const b = o.box ? { x: o.box[0], y: o.box[1], width: o.box[2], height: o.box[3] } : o.target && bounds ? bounds(o.target, t + len / 2) : null;
      if (!b) return 'gradient-border needs a target layer (or a box [x, y, w, h]).';
      const pad = 6;
      const colors = o.colors?.length ? o.colors : [color === '#ffffff' ? '#7b61ff' : color, '#4cc9f0', '#ff4d6d'];
      return gradientBorder(id, window, b, pad, colors, o);
    }
    case 'echo': {
      const target = o.target ? scene.layers.find((l) => l.id === o.target) : undefined;
      if (!target) return 'echo needs the id of a moving layer (target).';
      const copies = Math.max(1, Math.min(8, o.copies ?? 4));
      const delay = o.delay ?? 0.05;
      const decay = o.decay ?? 0.55;
      const layers = Array.from({ length: copies }, (_, i) => {
        const k = copies - i;
        const { id: _drop, name, transform: _t, ...rest } = target;
        void _drop; void _t;
        return {
          layer: {
            ...rest, id: `${target.id}-echo${k}`, name: `${name ?? target.id} echo ${k}`, transform: { anchor: target.transform?.anchor },
            link: [{ prop: 'position', from: target.id, delay: delay * k }, { prop: 'scale', from: target.id, delay: delay * k }, { prop: 'rotation', from: target.id, delay: delay * k }, { prop: 'opacity', from: target.id, delay: delay * k, multiply: Math.pow(decay, k) }],
          } as Layer,
          below: target.id,
        };
      });
      return { layers, cues: [] };
    }
  }
  return `Unknown fx "${o.kind}".`;
}

function gradientBorder(id: string, window: { in: number; out: number }, b: { x: number; y: number; width: number; height: number }, pad: number, colors: string[], o: FxOptions): FxResult {
  // The gradient's direction turns once around the box over the effect: its end points circle the centre.
  const w = b.width + pad * 2;
  const h = b.height + pad * 2;
  const c: Vec = [w / 2 + 4, h / 2 + 4];
  const steps = 8;
  const from = new Track<Vec>([c[0] - w / 2, c[1]]);
  const to = new Track<Vec>([c[0] + w / 2, c[1]]);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const tt = window.in + ((window.out - window.in) * i) / steps;
    from.key(tt, [c[0] - Math.cos(a) * w / 2, c[1] - Math.sin(a) * h / 2], 'linear');
    to.key(tt, [c[0] + Math.cos(a) * w / 2, c[1] + Math.sin(a) * h / 2], 'linear');
  }
  return {
    layers: [{
      layer: {
        id, name: 'Gradient border', type: 'shape', ...window,
        transform: { position: [b.x + b.width / 2, b.y + b.height / 2], opacity: new Track<number>(0).move(window.in, 0.25, 0, 100, 'cubic-out').prop() },
        effects: [{ type: 'glow', radius: 10, intensity: 0.6 }],
        shape: { shape: 'rect', bounds: [w + 8, h + 8], groups: [{ kind: 'rect', position: c, size: [w, h], radius: (o.radius ?? 16) + pad, fill: null, stroke: { paint: { gradient: { kind: 'linear', stops: colors.map((col, i) => [i / Math.max(1, colors.length - 1), col] as [number, string]), from: from.prop(), to: to.prop() } }, width: 3 } }] },
      } as Layer,
      ...(o.target ? { above: o.target } : {}),
    }],
    cues: [],
  };
}
