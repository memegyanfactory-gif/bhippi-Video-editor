// Motion sequences (docs/REFERENCE-FILMS-PLAN.md P4, B2): beats joined into ONE motion scene with
// the reference films' transitions, instead of cuts between separate clips.
//
// · Each beat is a precomp that starts playing as it comes into view.
// · `cuts` layout: beats replace each other in place through a transition (whip, zoom-through,
//   blur-bridge, z-recede, card-zoom-reveal, shape wipes, eyelids, swap-when-hidden…).
// · `world` layout: the beats sit side by side on one canvas and a camera trucks between them —
//   the SaaS films' rule that the background never cuts. Other transition kinds still work there
//   (the camera jumps under them).
// · A continuity object (`guide`: a dot, orb, sparkle or ring) travels from beat to beat above
//   everything, the eye-line of Workly, Virgil and aflow.
// Pure: no DOM. Timings are the films' (§2.1): blur-bridge 1 f on / cut 3 f later / 7 f back,
// white-out 7–13 f, a 12 f black breath, z-recede pop-and-rise 13 f, whips accelerating ×1.4 a frame.
import type { Effect, Layer, MotionScene, ShapeItem, Vec } from './types';
import { round, Track } from './keys';

type Cue = NonNullable<MotionScene['cues']>[number];
const F = 1 / 30;

export const TRANSITION_KINDS = [
  'cut', 'dissolve', 'push', 'slide', 'whip', 'zoom-through', 'blur-bridge', 'z-recede', 'card-zoom-reveal',
  'shape-wipe', 'iris', 'diagonal-wipe', 'noise-dissolve', 'white-out', 'black-breath', 'palette-swap-cut', 'eyelid',
  'scale-cut', 'snap-punch', 'snap-zoom-out', 'snap-press', 'swap-when-hidden', 'collapse-into', 'spin', 'glitch', 'light-leak', 'truck',
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export type SeqTransition = {
  kind: TransitionKind;
  /** Seconds (each kind has its own default). */
  duration?: number;
  direction?: 'left' | 'right' | 'up' | 'down';
  /** white-out / black-breath / eyelid colour; shape-wipe glyph colour is irrelevant (it is a matte). */
  color?: string;
  /** shape-wipe glyph, and whether the new beat grows out of it ('out') or the old one shrinks into it ('in', a logo-resolve). */
  glyph?: 'circle' | 'square' | 'rounded' | 'star' | 'diamond';
  mode?: 'out' | 'in';
  /** Frame point for shape-wipe / iris / collapse-into (default the centre). */
  at?: [number, number];
  /** swap-when-hidden: degrees of Z twist that disguise the swap. */
  twist?: number;
};

export type SeqBeat = { scene: MotionScene; name?: string; /** Seconds the beat owns the frame (default its scene's duration). */ hold?: number };

export type GuideSpec = {
  shape?: 'dot' | 'orb' | 'sparkle' | 'ring';
  color?: string;
  /** Diameter in px (default 28). */
  size?: number;
  /** Where the guide is: a beat, a point in that beat's frame, seconds into the beat, and an optional size there. */
  stops: { beat: number; at: [number, number]; t?: number; size?: number }[];
  /** 'fade' (default) leaves after the last stop; 'stay' keeps it (it becomes the logo dot). */
  end?: 'fade' | 'stay';
};

export type SequenceSpec = {
  width: number;
  height: number;
  beats: SeqBeat[];
  /** One per join (beats − 1); missing ones are dissolves in `cuts`, trucks in `world`. */
  transitions?: (SeqTransition | TransitionKind)[];
  layout?: 'cuts' | 'world';
  /** world layout: how the beats are laid out and the gap between them (px). */
  world?: { path?: 'row' | 'column' | 'zigzag' | 'grid'; gap?: number; columns?: number };
  /** A colour under everything that never cuts (null: transparent). */
  background?: string | null;
  guide?: GuideSpec;
  sfx?: boolean;
};

export type CompiledSequence = { scene: MotionScene; starts: number[]; cuts: number[]; duration: number };

const DEFAULT_DURATION: Partial<Record<TransitionKind, number>> = {
  cut: 0, dissolve: 0.5, push: 0.6, slide: 0.6, whip: 0.36, 'zoom-through': 0.5, 'blur-bridge': 11 * F, 'z-recede': 0.6, 'card-zoom-reveal': 0.8,
  'shape-wipe': 0.7, iris: 0.6, 'diagonal-wipe': 0.5, 'noise-dissolve': 0.8, 'white-out': 0.5, 'black-breath': 15 * F, 'palette-swap-cut': 2 * F, eyelid: 0.5,
  'scale-cut': 0.35, 'snap-punch': 6 * F, 'snap-zoom-out': 8 * F, 'snap-press': 9 * F, 'swap-when-hidden': 0.5, 'collapse-into': 0.6, spin: 0.6, glitch: 6 * F, 'light-leak': 0.7, truck: 0.9,
};

/** Kinds where both beats are on screen together (the new one enters before the cut point). */
const OVERLAP = new Set<TransitionKind>(['dissolve', 'push', 'slide', 'card-zoom-reveal', 'shape-wipe', 'iris', 'diagonal-wipe', 'noise-dissolve', 'z-recede', 'truck']);

const SOUND: Partial<Record<TransitionKind, Cue['sound']>> = {
  push: 'whoosh', slide: 'whoosh', whip: 'whoosh', 'zoom-through': 'whoosh', 'blur-bridge': 'swish', 'z-recede': 'swish', 'card-zoom-reveal': 'whoosh', truck: 'whoosh',
  'shape-wipe': 'swish', iris: 'swish', 'diagonal-wipe': 'swish', 'white-out': 'shimmer', 'black-breath': 'sub', 'scale-cut': 'impact', 'snap-punch': 'impact', 'snap-zoom-out': 'pop',
  'snap-press': 'pop', 'swap-when-hidden': 'swish', 'collapse-into': 'whoosh', spin: 'whoosh', glitch: 'blip', 'light-leak': 'shimmer', 'palette-swap-cut': 'click',
};

/** The keyed state of one beat's precomp layer. */
class BeatLayer {
  pos: Track<Vec>;
  scale = new Track<number>(100);
  opacity = new Track<number>(100);
  rotation = new Track<number>(0);
  rotY = new Track<number>(0);
  blur: Track<number> | null = null;
  dblur: { track: Track<number>; direction: number } | null = null;
  zblur: Track<number> | null = null;
  invert: Track<number> | null = null;
  rgb: Track<number> | null = null;
  mask: { box: Track<Vec>; radius: Track<number> } | null = null;
  matte: { layer: string; mode: 'alpha' | 'alpha-inverted' | 'luma' } | null = null;
  threeD = false;
  in = 0;
  out = Infinity;
  constructor(public rest: Vec) { this.pos = new Track<Vec>(rest); }
  get blurT() { return (this.blur ??= new Track<number>(0)); }
  dirBlur(direction: number) { return (this.dblur ??= { track: new Track<number>(0), direction }).track; }
  get zoomBlurT() { return (this.zblur ??= new Track<number>(0)); }
  get invertT() { return (this.invert ??= new Track<number>(0)); }
  get rgbT() { return (this.rgb ??= new Track<number>(0)); }
  effects(): Effect[] {
    const out: Effect[] = [];
    if (this.blur) out.push({ type: 'gaussian-blur', blurriness: this.blur.prop() });
    if (this.dblur) out.push({ type: 'directional-blur', direction: this.dblur.direction, length: this.dblur.track.prop() });
    if (this.zblur) out.push({ type: 'zoom-blur', amount: this.zblur.prop() });
    if (this.invert) out.push({ type: 'invert', amount: this.invert.prop() });
    if (this.rgb) out.push({ type: 'rgb-split', x: this.rgb.prop() });
    return out;
  }
}

const unit = (dir: SeqTransition['direction']): Vec => (dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : [-1, 0]);
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];

function glyphItem(glyph: SeqTransition['glyph'], size: number): ShapeItem {
  const c: Vec = [size / 2, size / 2];
  switch (glyph) {
    case 'square': return { kind: 'rect', position: c, size: [size, size], fill: '#fff' };
    case 'rounded': return { kind: 'rect', position: c, size: [size, size], radius: size * 0.22, fill: '#fff' };
    case 'star': return { kind: 'star', position: c, size: [size, size], sides: 5, innerRadius: 0.48, fill: '#fff' };
    case 'diamond': return { kind: 'polygon', position: c, size: [size, size], sides: 4, fill: '#fff' };
    default: return { kind: 'ellipse', position: c, size: [size, size], fill: '#fff' };
  }
}

export function normalizeTransition(t: SeqTransition | TransitionKind | undefined, layout: 'cuts' | 'world'): SeqTransition {
  const base = typeof t === 'string' ? { kind: t } : t ?? { kind: layout === 'world' ? 'truck' : 'dissolve' };
  return { ...base, duration: Math.max(0, base.duration ?? DEFAULT_DURATION[base.kind] ?? 0.5) } as SeqTransition;
}

export function compileSequence(spec: SequenceSpec): CompiledSequence {
  const { width: W, height: H } = spec;
  const C: Vec = [W / 2, H / 2];
  const layout = spec.layout ?? 'cuts';
  const n = spec.beats.length;
  const transitions = Array.from({ length: Math.max(0, n - 1) }, (_, i) => normalizeTransition(spec.transitions?.[i], layout));
  const cues: Cue[] = [];
  const extra: { after: number; layer: Layer }[] = [];
  let fx = 0;
  const id = (name: string) => `${name}-${++fx}`;

  // ── where each beat sits (world) ──
  const gap = spec.world?.gap ?? Math.round(W * 0.12);
  const cols = spec.world?.columns ?? 3;
  const cell = (i: number): Vec => {
    const path = spec.world?.path ?? 'row';
    const [c, r] = path === 'column' ? [0, i] : path === 'zigzag' ? [i, i % 2] : path === 'grid' ? [i % cols, Math.floor(i / cols)] : [i, 0];
    return [c * (W + gap), r * (H + gap)];
  };
  const world = layout === 'world';
  const beats = spec.beats.map((_, i) => new BeatLayer(world ? add(cell(i), C) : C));
  const home = (i: number): Vec => [0 - cell(i)[0], 0 - cell(i)[1]];
  const worldPos = new Track<Vec>(world ? home(0) : [0, 0]);

  // ── timing ──
  const starts: number[] = [0];
  const cuts: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const tr = transitions[i];
    const hold = spec.beats[i].hold ?? spec.beats[i].scene.duration;
    const T = starts[i] + Math.max(0.2, hold);
    cuts.push(T);
    const lead = OVERLAP.has(tr.kind) ? tr.duration! / 2 : 0;
    starts.push(Math.max(starts[i] + 0.1, T - lead));
  }
  const lastHold = spec.beats[n - 1]?.hold ?? spec.beats[n - 1]?.scene.duration ?? 0;
  const duration = round((starts[n - 1] ?? 0) + lastHold);

  // ── transitions ──
  for (let i = 0; i < n - 1; i++) {
    const tr = transitions[i];
    const A = beats[i];
    const B = beats[i + 1];
    const T = cuts[i];
    const d = tr.duration!;
    const h = d / 2;
    const s = T - h;
    const e = T + h;
    const overlap = OVERLAP.has(tr.kind);
    A.out = overlap ? e : T;
    B.in = starts[i + 1];
    const ra = A.rest;
    const rb = B.rest;
    const v = unit(tr.direction);
    const span = Math.abs(v[0]) ? W : H;
    const at: Vec = tr.at ? (world ? add(rb, [tr.at[0] - W / 2, tr.at[1] - H / 2]) : [tr.at[0], tr.at[1]]) : rb;
    // The camera: a truck travels, every other kind jumps at the cut.
    if (world) {
      const from = home(i);
      const to = home(i + 1);
      if (tr.kind === 'truck') worldPos.move(s, d, from, to, 'house');
      else worldPos.key(T - 1e-3, from, 'hold').key(T, to);
    }
    const sound = SOUND[tr.kind];
    if (sound && spec.sfx !== false) cues.push({ at: round(Math.max(0, tr.kind === 'whip' || tr.kind === 'zoom-through' ? T - 0.25 : s)), sound });

    switch (tr.kind) {
      case 'cut':
      case 'truck':
        break;
      case 'dissolve':
        B.opacity.move(s, d, 0, 100, 'ease-in-out');
        break;
      case 'push':
        A.pos.move(s, d, ra, add(ra, v, span), 'house');
        B.pos.move(s, d, add(rb, v, -span), rb, 'house');
        break;
      case 'slide':
        B.pos.move(s, d, add(rb, v, -span), rb, 'house');
        A.scale.move(s, d, 100, 96, 'house');
        break;
      case 'whip': {
        const dir = Math.abs(v[0]) ? 90 : 0;
        A.pos.move(s, h, ra, add(ra, v, span * 1.1), 'expo-in');
        A.dirBlur(dir).key(s, 0, 'expo-in').key(T, span * 0.09);
        B.pos.move(T, h, add(rb, v, -span * 1.1), rb, 'expo-out');
        B.dirBlur(dir).key(T, span * 0.09, 'expo-out').key(e, 0);
        break;
      }
      case 'zoom-through':
        A.scale.move(s, h, 100, 360, 'expo-in');
        A.zoomBlurT.key(s, 0, 'expo-in').key(T, 0.6);
        A.opacity.key(T - h * 0.35, 100, 'cubic-in').key(T, 0);
        B.scale.move(T, h, 55, 100, 'expo-out');
        B.zoomBlurT.key(T, 0.45, 'expo-out').key(e, 0);
        B.opacity.move(T, 0.1, 0, 100, 'cubic-out');
        break;
      case 'blur-bridge':
        // Blur on in 1 frame, cut 3 frames later, focus back in about 7.
        A.blurT.key(T - 4 * F, 0, 'linear').key(T - 3 * F, 48);
        B.blurT.key(T, 48, 'cubic-out').key(T + 7 * F, 0);
        break;
      case 'z-recede':
        A.scale.move(s, d, 100, 65, 'house');
        A.blurT.move(s, d, 0, 12, 'house');
        A.opacity.move(s, d, 100, 40, 'house');
        B.scale.move(T, 13 * F, 85, 100, 'back-out');
        B.pos.move(T, 13 * F, add(rb, [0, 40]), rb, 'settle');
        B.opacity.move(T - 1e-3, 5 * F, 0, 100, 'cubic-out');
        break;
      case 'card-zoom-reveal': {
        const cw = W * 0.34;
        const ch = H * 0.34;
        B.mask = { box: new Track<Vec>([0, 0, W, H]).move(s, d, [(W - cw) / 2, (H - ch) / 2, cw, ch], [0, 0, W, H], 'card-zoom'), radius: new Track<number>(0).move(s, d, 28, 0, 'card-zoom') };
        B.scale.move(s, d, 112, 100, 'card-zoom');
        A.scale.move(s, d, 100, 92, 'card-zoom');
        break;
      }
      case 'shape-wipe':
      case 'iris': {
        const size = 200;
        const cover = (Math.hypot(W, H) * 1.15 * (tr.glyph === 'star' ? 2.2 : tr.glyph === 'diamond' ? 1.5 : 1)) / size * 100;
        const inward = tr.mode === 'in';
        const matte = id('wipe');
        const scale = new Track<number>(0).move(s, d, inward ? cover : 0, inward ? 0 : cover, inward ? 'expo-in-out' : 'cubic-in-out');
        // The matte stays for the rest of the beat: it ends fully revealing (the beat's matte source must not vanish).
        extra.push({ after: i + 1, layer: { id: matte, name: 'Wipe matte', type: 'shape', hidden: true, in: round(s), ...(world ? { parent: 'world' } : {}), transform: { position: at, scale: scale.prop(), rotation: new Track<number>(0).move(s, d, 0, tr.glyph === 'star' ? 72 : 0).prop() }, shape: { shape: 'rect', groups: [glyphItem(tr.kind === 'iris' ? 'circle' : tr.glyph, size)], bounds: [size, size] } } });
        B.matte = { layer: matte, mode: inward ? 'alpha-inverted' : 'alpha' };
        break;
      }
      case 'diagonal-wipe': {
        const matte = id('wipe');
        const bw = W * 2.2;
        const angle = -20;
        const dir = v[0] || 1;
        // The rotated band starts clear of the frame on one side and ends covering all of it.
        const margin = W * 0.4;
        const start = add(rb, [-dir * (W * 0.5 + bw * 0.5 + margin), 0]);
        const end = add(rb, [dir * (bw * 0.5 - W * 0.5 - margin), 0]);
        extra.push({ after: i + 1, layer: { id: matte, name: 'Wipe matte', type: 'shape', hidden: true, in: round(s), ...(world ? { parent: 'world' } : {}), transform: { position: new Track<Vec>(end).move(s, d, start, end, 'cubic-in-out').prop(), rotation: angle }, shape: { shape: 'rect', groups: [{ kind: 'rect', position: [bw / 2, H * 1.6], size: [bw, H * 3.2], fill: '#fff' }], bounds: [bw, H * 3.2] } } });
        B.matte = { layer: matte, mode: 'alpha' };
        break;
      }
      case 'noise-dissolve': {
        const matte = id('noise');
        const lo = new Track<number>(255).move(s, d, 255, -24, 'ease-in-out');
        const hi = new Track<number>(279).move(s, d, 279, 0, 'ease-in-out');
        extra.push({ after: i + 1, layer: { id: matte, name: 'Noise matte', type: 'procedural', kind: 'noise', hidden: true, in: round(s), ...(world ? { parent: 'world', transform: { position: rb } } : {}), params: { from: '#000000', to: '#ffffff', scale: 150, speed: 0 }, effects: [{ type: 'levels', inBlack: lo.prop(), inWhite: hi.prop() }] } });
        B.matte = { layer: matte, mode: 'luma' };
        break;
      }
      case 'white-out':
      case 'black-breath':
      case 'light-leak': {
        const color = tr.color ?? (tr.kind === 'black-breath' ? '#000000' : '#ffffff');
        const opacity = new Track<number>(0);
        if (tr.kind === 'black-breath') opacity.key(T - 12 * F, 0, 'cubic-in').key(T - 8 * F, 100).key(T, 100, 'cubic-out').key(T + 3 * F, 0);
        else opacity.key(s, 0, 'cubic-in').key(T, 100).key(T + (tr.kind === 'light-leak' ? h : 2 * F), 100, 'cubic-out').key(e + (tr.kind === 'white-out' ? 4 * F : 0), 0);
        const base = { id: id(tr.kind), name: tr.kind === 'light-leak' ? 'Light leak' : 'Flash', in: round(s - 12 * F), out: round(e + 6 * F), transform: { opacity: opacity.prop() } } as const;
        extra.push({ after: n, layer: tr.kind === 'light-leak' ? { ...base, type: 'procedural', kind: 'light-leak', blend: 'screen', params: { intensity: 1 } } : { ...base, type: 'solid', color } });
        break;
      }
      case 'palette-swap-cut':
        B.invertT.key(T, 100, 'hold').key(T + 2 * F, 0);
        break;
      case 'eyelid': {
        const color = tr.color ?? '#000000';
        for (const side of [-1, 1]) {
          const open: Vec = [W / 2, H / 2 + side * (H * 0.75)];
          const shut: Vec = [W / 2, H / 2 + side * (H * 0.25)];
          extra.push({ after: n, layer: { id: id('lid'), name: side < 0 ? 'Top lid' : 'Bottom lid', type: 'solid', color, size: [W, H / 2 + 4], in: round(s), out: round(e), transform: { position: new Track<Vec>(open).key(s, open, 'cubic-in').key(T, shut).key(T + 1e-3, shut, 'cubic-out').key(e, open).prop() } } });
        }
        break;
      }
      case 'scale-cut':
        A.scale.move(s, h, 100, 112, 'expo-in');
        B.scale.move(T, d, 130, 100, 'expo-out');
        break;
      case 'snap-punch':
        B.scale.move(T, d, 140, 100, 'snap-settle');
        break;
      case 'snap-zoom-out':
        B.scale.move(T, d, 300, 100, 'snap-settle');
        break;
      case 'snap-press':
        A.scale.move(T - 3 * F, 3 * F, 100, 66, 'expo-in');
        B.scale.move(T, 6 * F, 66, 100, 'snap-settle');
        break;
      case 'swap-when-hidden': {
        A.threeD = true;
        B.threeD = true;
        A.rotY.move(s, h, 0, 90, 'cubic-in');
        B.rotY.move(T, h, -90, 0, 'cubic-out');
        if (tr.twist) {
          A.rotation.move(s, h, 0, tr.twist, 'cubic-in');
          B.rotation.move(T, h, -tr.twist, 0, 'cubic-out');
        }
        break;
      }
      case 'collapse-into':
        A.scale.move(s, h, 100, 0, 'expo-in');
        A.pos.move(s, h, ra, world ? add(at, [ra[0] - rb[0], ra[1] - rb[1]]) : at, 'expo-in');
        B.scale.move(T, h, 0, 100, 'expo-out');
        B.pos.move(T, h, at, rb, 'expo-out');
        break;
      case 'spin':
        A.rotation.move(s, h, 0, -90, 'expo-in');
        A.scale.move(s, h, 100, 60, 'expo-in');
        A.opacity.key(T - h * 0.3, 100).key(T, 0);
        B.rotation.move(T, h, 90, 0, 'expo-out');
        B.scale.move(T, h, 60, 100, 'expo-out');
        break;
      case 'glitch':
        A.rgbT.key(T - 3 * F, 0, 'linear').key(T - F, 24);
        B.rgbT.key(T, 24, 'linear').key(T + 3 * F, 0);
        B.pos.key(T, add(rb, [18, 0]), 'hold').key(T + F, add(rb, [-10, 0]), 'hold').key(T + 2 * F, rb);
        break;
    }
  }

  // ── layers ──
  const layers: Layer[] = [];
  if (spec.background) layers.push({ id: 'background', name: 'Background', type: 'solid', color: spec.background });
  if (world) layers.push({ id: 'world', name: 'World (camera)', type: 'null', transform: { anchor: [0, 0], position: worldPos.prop() } });
  const extrasAfter = (index: number) => extra.filter((x) => x.after === index).map((x) => x.layer);
  spec.beats.forEach((beat, i) => {
    const b = beats[i];
    const effects = b.effects();
    const out = b.out === Infinity ? undefined : round(b.out);
    layers.push({
      id: `beat-${i + 1}`, name: beat.name ?? `Beat ${i + 1}`, type: 'precomp', scene: beat.scene, offset: round(starts[i]),
      ...(i > 0 ? { in: round(b.in) } : {}), ...(out !== undefined && i < n - 1 ? { out } : {}),
      ...(world ? { parent: 'world' } : {}),
      ...(b.threeD ? { threeD: true } : {}),
      transform: { position: b.pos.prop(), scale: b.scale.prop(), opacity: b.opacity.prop(), rotation: b.rotation.prop(), ...(b.threeD ? { rotationY: b.rotY.prop() } : {}) },
      ...(effects.length ? { effects } : {}),
      ...(b.matte ? { matte: b.matte } : {}),
      ...(b.mask ? { masks: [{ shape: 'rect', box: b.mask.box.prop(), radius: b.mask.radius.prop() }] } : {}),
    } as Layer);
    layers.push(...extrasAfter(i).filter((l) => l.hidden));
  });
  // Matte layers must sit right above the layer they cut; overlays go on top.
  for (const l of extrasAfter(n)) layers.push(l);
  for (const [index, x] of extra.entries()) if (x.after !== n && !x.layer.hidden) layers.push(extra[index].layer);

  // Beats' own sound cues, shifted to where they play.
  spec.beats.forEach((beat, i) => { for (const cue of beat.scene.cues ?? []) cues.push({ ...cue, at: round(cue.at + starts[i]) }); });

  // ── the guide ──
  if (spec.guide?.stops.length) layers.push(guideLayer(spec.guide, starts, world ? cell : null, duration));

  const scene: MotionScene = { version: 1, width: W, height: H, duration, layers, ...(cues.length ? { cues: cues.filter((c) => c.at < duration).sort((a, b) => a.at - b.at) } : {}) };
  return { scene, starts: starts.map(round), cuts: cuts.map(round), duration };
}

function guideLayer(guide: GuideSpec, starts: number[], cell: ((i: number) => Vec) | null, duration: number): Layer {
  const size = guide.size ?? 28;
  const color = guide.color ?? '#5b5bf0';
  const box = size * 3;
  const c: Vec = [box / 2, box / 2];
  const items: ShapeItem[] = guide.shape === 'ring'
    ? [{ kind: 'ellipse', position: c, size: [size, size], fill: null, stroke: { paint: color, width: Math.max(2, size * 0.12) } }]
    : guide.shape === 'sparkle'
      ? [{ kind: 'path', d: `M${c[0]} ${c[1] - size / 2} Q${c[0]} ${c[1]} ${c[0] + size / 2} ${c[1]} Q${c[0]} ${c[1]} ${c[0]} ${c[1] + size / 2} Q${c[0]} ${c[1]} ${c[0] - size / 2} ${c[1]} Q${c[0]} ${c[1]} ${c[0]} ${c[1] - size / 2} Z`, fill: color }]
      : guide.shape === 'orb'
        ? [{ kind: 'ellipse', position: c, size: [size, size], fill: { gradient: { kind: 'radial', stops: [[0, '#ffffff'], [0.35, color], [1, `${color}00`]], from: [c[0] - size * 0.15, c[1] - size * 0.15], to: [c[0] + size / 2, c[1] + size / 2] } } }]
        : [{ kind: 'ellipse', position: c, size: [size, size], fill: color }];
  const stops = [...guide.stops].map((stop) => ({ ...stop, time: round((starts[stop.beat] ?? 0) + (stop.t ?? 0.3)), point: (cell ? [stop.at[0] + cell(stop.beat)[0], stop.at[1] + cell(stop.beat)[1]] : stop.at) as Vec })).sort((a, b) => a.time - b.time);
  const position = new Track<Vec>(stops[0].point);
  const scale = new Track<number>(100);
  let prev = stops[0];
  position.key(prev.time, prev.point, 'house');
  scale.move(Math.max(0, prev.time - 0.25), 0.25, 0, ((prev.size ?? size) / size) * 100, 'back-out');
  for (const stop of stops.slice(1)) {
    const glide = Math.min(0.6, Math.max(0.12, (stop.time - prev.time) * 0.8));
    position.key(stop.time - glide, prev.point, 'house').key(stop.time, stop.point);
    if ((stop.size ?? size) !== (prev.size ?? size)) scale.move(stop.time - glide, glide, ((prev.size ?? size) / size) * 100, ((stop.size ?? size) / size) * 100, 'house');
    prev = stop;
  }
  const opacity = new Track<number>(100);
  if ((guide.end ?? 'fade') === 'fade' && prev.time + 0.6 < duration) opacity.key(prev.time + 0.4, 100, 'cubic-in').key(prev.time + 0.6, 0);
  return {
    id: 'guide', name: 'Guide', type: 'shape', motionBlur: true, ...(cell ? { parent: 'world' } : {}),
    transform: { position: position.prop(), scale: scale.prop(), opacity: opacity.prop() },
    ...(guide.shape === 'orb' || guide.shape === 'sparkle' ? { effects: [{ type: 'glow', radius: size * 0.8, intensity: 0.9, color }] } : {}),
    shape: { shape: 'rect', groups: items, bounds: [box, box] },
  } as Layer;
}

export const TRANSITION_HELP: Record<TransitionKind, string> = {
  cut: 'hard cut',
  dissolve: 'cross-fade',
  push: 'the new beat pushes the old one out (direction)',
  slide: 'the new beat slides over the old one (direction)',
  whip: 'fast whip pan with motion blur, cut at the peak (direction)',
  'zoom-through': 'push through the old beat into the new one',
  'blur-bridge': 'a hidden cut under a defocus: blur on in 1 f, cut 3 f later, focus back in 7 f (SaaS films)',
  'z-recede': 'the old beat recedes (0.65, blur) while the new one pops and rises (13 f)',
  'card-zoom-reveal': 'the new beat opens from a card to full frame',
  'shape-wipe': 'the new beat grows out of a glyph (circle, square, rounded, star, diamond); mode "in" shrinks the old one into it (logo resolve)',
  iris: 'circle iris wipe',
  'diagonal-wipe': 'a hard diagonal wipe',
  'noise-dissolve': 'dissolve through noise',
  'white-out': 'flash to white (7–13 f) and out into the new beat',
  'black-breath': 'a 12 f black breath before the next beat (before a drop)',
  'palette-swap-cut': 'hard cut with a 2-frame inverted flash',
  eyelid: 'black eyelids close and open onto the new beat',
  'scale-cut': 'hard cut punching into a closer framing that settles',
  'snap-punch': 'one-frame snap: the new beat lands at 140% and snaps to 100%',
  'snap-zoom-out': 'the new beat snaps out from 300%',
  'snap-press': 'the old beat presses to 66% and the new one snaps out',
  'swap-when-hidden': 'the old beat turns edge-on and the new one turns in (twist to disguise)',
  'collapse-into': 'the old beat collapses into a point and the new one grows out of it (at)',
  spin: 'spin out and in',
  glitch: 'RGB-split glitch cut',
  'light-leak': 'a light leak washes over the cut',
  truck: 'world layout: the camera travels to the next beat on the house ease (the background never cuts)',
};
