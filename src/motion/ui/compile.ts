// Compiles a rasterised UI screen (spec.ts, raster.ts) into engine layers: one precomp holding the
// device chrome, the screen picture, a layer per part (parented like the DOM), live text for typed
// fields and counters, overlays (ripples, outlines, tooltips) and the cursor. Every action becomes
// plain keyframes, so the result is an ordinary motion scene. Pure: no DOM.
//
// Timing is the SaaS films' (docs/REFERENCE-FILMS-PLAN.md §2.1): the house ease, a glide of about
// 14 frames, hover-lift 9 f in / 19 f hold / 8 f out at ×1.088 with the rest dimmed to 32 %, typing
// at 30 cps in fields.
import type { Effect, Ease, Key, Layer, MotionScene, Prop, ShapeItem, Vec } from '../types';
import type { UiAction, UiRaster, UiRasterPart, UiRasterState, UiScreenSpec } from './spec';

type Cue = NonNullable<MotionScene['cues']>[number];
export type UiCompiled = { layer: Layer; scene: MotionScene; cues: Cue[]; duration: number };

const F = 1 / 30;
const HOUSE: Ease = 'house';

/** Keyframes for one property, gathered from many actions and sorted at the end. */
class Track<T extends number | Vec> {
  keys: Key<T>[] = [];
  constructor(public base: T) {}
  key(t: number, v: T, ease?: Ease) { this.keys.push({ t: Math.max(0, round(t)), v: (typeof v === 'number' ? round(v) : (v as number[]).map(round)) as T, ...(ease ? { ease } : {}) }); return this; }
  /** base → peak (in), hold, → base (out). */
  pulse(t: number, peak: T, inS: number, hold: number, outS: number, easeIn: Ease = HOUSE, easeOut: Ease = HOUSE) {
    return this.key(t, this.base, easeIn).key(t + inS, peak).key(t + inS + hold, peak, easeOut).key(t + inS + hold + outS, this.base);
  }
  move(t: number, dur: number, from: T, to: T, ease: Ease = HOUSE) { return this.key(t, from, ease).key(t + dur, to); }
  prop(): Prop<T> {
    if (!this.keys.length) return this.base;
    const sorted = [...this.keys].sort((a, b) => a.t - b.t);
    const out: Key<T>[] = [];
    for (const key of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.t - key.t) < 1e-4) out[out.length - 1] = key.ease || !last.ease ? key : { ...key, ease: last.ease };
      else out.push(key);
    }
    return { k: out } as Prop<T>;
  }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '_');

/** Device chrome around the screen, in CSS px: canvas size and where the screen's top-left sits. */
export function deviceFrame(spec: Pick<UiScreenSpec, 'device'>, w: number, h: number): { width: number; height: number; x: number; y: number; screenRadius: number } {
  switch (spec.device ?? 'browser') {
    case 'browser': return { width: w, height: h + 44, x: 0, y: 44, screenRadius: 14 };
    case 'phone': return { width: w + 32, height: h + 32, x: 16, y: 16, screenRadius: 48 };
    case 'laptop': {
      const width = Math.round(w * 1.14);
      return { width, height: h + 18 + 26 + 22, x: Math.round((width - w) / 2), y: 18, screenRadius: 6 };
    }
    case 'glass-card': return { width: w + 40, height: h + 40, x: 20, y: 20, screenRadius: 20 };
    default: return { width: w, height: h, x: 0, y: 0, screenRadius: 0 };
  }
}

function chromeItems(spec: UiScreenSpec, frame: ReturnType<typeof deviceFrame>, w: number, h: number, k: number): ShapeItem[] {
  const dark = spec.theme === 'dark';
  const S = (n: number) => n * k;
  const rect = (x: number, y: number, rw: number, rh: number, radius: number, fill: string, stroke?: string): ShapeItem => ({
    kind: 'rect', position: [S(x + rw / 2), S(y + rh / 2)], size: [S(rw), S(rh)], radius: S(radius), fill, ...(stroke ? { stroke: { paint: stroke, width: S(1) } } : {}),
  });
  switch (spec.device ?? 'browser') {
    case 'browser': {
      const bar = dark ? '#1b1e27' : '#eef0f4';
      const pill = dark ? '#2a2e3a' : '#ffffff';
      return [
        rect(0, 0, frame.width, frame.height, 14, bar, dark ? '#ffffff22' : '#00000014'),
        ...[['#ff5f57', 22], ['#febc2e', 42], ['#28c840', 62]].map(([c, x]): ShapeItem => ({ kind: 'ellipse', position: [S(x as number), S(22)], size: [S(12), S(12)], fill: c as string })),
        rect(w * 0.3, 9, w * 0.4, 26, 13, pill),
      ];
    }
    case 'phone':
      return [rect(0, 0, frame.width, frame.height, 64, '#0d0f14', '#3a3f4b'), rect(frame.width / 2 - 55, 26, 110, 30, 15, '#000000')];
    case 'laptop': {
      const deck = frame.height - 22;
      return [
        rect(frame.x - 18, 0, w + 36, h + 44, 18, '#16181e', '#3a3f4b'),
        { kind: 'path', d: `M${S(0)} ${S(deck)} L${S(frame.width)} ${S(deck)} L${S(frame.width - 30)} ${S(frame.height)} L${S(30)} ${S(frame.height)} Z`, fill: { gradient: { kind: 'linear', stops: [[0, '#d9dce3'], [1, '#9aa0ab']], from: [0, S(deck)], to: [0, S(frame.height)] } } },
        rect(frame.width / 2 - 70, deck, 140, 8, 4, '#80858f'),
      ];
    }
    case 'glass-card':
      return [rect(0, 0, frame.width, frame.height, 32, '#ffffff2e', '#ffffff66')];
    default:
      return [];
  }
}

const ARROW = 'M0 0 L0 20.5 L5.2 15.6 L8.6 23.4 L12 21.9 L8.7 14.4 L15.6 14.4 Z';

function cursorLayer(spec: UiScreenSpec, k: number): { layer: Layer & { type: 'shape' }; tip: Vec } {
  const c = spec.cursor || {};
  const size = (c.size ?? 30) * k;
  const style = c.style ?? 'arrow';
  if (style === 'dot') {
    return { layer: { id: 'cursor', name: 'Cursor', type: 'shape', shape: { shape: 'rect', groups: [{ kind: 'ellipse', position: [size / 2 + 2, size / 2 + 2], size: [size * 0.7, size * 0.7], fill: `${c.color ?? '#111827'}bb`, stroke: { paint: '#ffffff', width: 2 * k } }] } }, tip: [size / 2 + 2, size / 2 + 2] };
  }
  if (style === 'hand') {
    return { layer: { id: 'cursor', name: 'Cursor', type: 'shape', shape: { shape: 'rect', groups: [{ kind: 'icon', icon: 'pointer', iconSize: size * 1.1, color: c.color ?? '#111827', position: [size * 0.55 + 2, size * 0.55 + 2] }] } }, tip: [size * 0.45 + 2, size * 0.1 + 2] };
  }
  const s = size / 24;
  return {
    layer: { id: 'cursor', name: 'Cursor', type: 'shape', shape: { shape: 'rect', groups: [{ kind: 'group', transform: { position: [2 * k, 2 * k], scale: s * 100 }, items: [{ kind: 'path', d: ARROW, fill: c.color ?? '#111827', stroke: { paint: '#ffffff', width: 1.6, join: 'round' } }] }] } },
    tip: [2 * k, 2 * k],
  };
}

type PartCtx = { part: UiRasterPart; state: UiRasterState; layerId: string; scale: Track<number>; opacity: Track<number>; position: Track<Vec>; shadow: Track<number> | null; rest: Vec };

export function compileUi(spec: UiScreenSpec, raster: UiRaster, comp: { width: number; height: number }, opts: { name?: string } = {}): UiCompiled {
  const k = raster.scale;
  const W = raster.width;
  const H = raster.height;
  const frame = deviceFrame(spec, W, H);
  const P = (x: number, y: number): Vec => [round((x + frame.x) * k), round((y + frame.y) * k)];
  const accent = spec.accent ?? '#5b5bf0';
  const dark = spec.theme === 'dark';
  const actions = [...(spec.actions ?? [])].sort((a, b) => a.t - b.t);
  const lastT = actions.reduce((m, a) => Math.max(m, a.t + actionLength(a)), 0);
  const duration = round(spec.duration ?? Math.max(3, lastT + 1.5));
  const cues: Cue[] = [];
  const ticks = spec.sfx !== 'none';
  const cue = (at: number, sound: Cue['sound'], extra: Partial<Cue> = {}) => { if (ticks) cues.push({ at: round(at), sound, ...extra }); };

  // ── state windows ──
  const switches = actions.filter((a): a is Extract<UiAction, { type: 'state' }> => a.type === 'state');
  const stateAt = (t: number) => { let id = 'main'; for (const s of switches) if (s.t <= t + 1e-6) id = s.to; return id; };

  // ── parts ──
  const parts = new Map<string, PartCtx>();
  const key = (state: string, id: string) => `${state}\u0000${id}`;
  for (const state of raster.states) {
    for (const part of state.parts) {
      const [x, y, w, h] = part.box;
      const parent = part.parent ? state.parts.find((p) => p.id === part.parent) : undefined;
      const rest: Vec = parent
        ? [round((x + w / 2 - (parent.box[0] - parent.margin)) * k), round((y + h / 2 - (parent.box[1] - parent.margin)) * k)]
        : P(x + w / 2, y + h / 2);
      parts.set(key(state.id, part.id), { part, state, layerId: `part-${slug(state.id)}-${slug(part.id)}`, scale: new Track<number>(100), opacity: new Track<number>(100), position: new Track<Vec>(rest), shadow: null, rest });
    }
  }
  const find = (name: string, t: number): PartCtx | undefined => parts.get(key(stateAt(t), name)) ?? [...parts.values()].find((p) => p.part.id === name);
  const centre = (p: PartCtx): Vec => P(p.part.box[0] + p.part.box[2] / 2, p.part.box[1] + p.part.box[3] / 2);
  const point = (target: string | [number, number], t: number): Vec | null => (Array.isArray(target) ? P(target[0], target[1]) : (() => { const p = find(target, t); return p ? centre(p) : null; })());
  const shadowOf = (p: PartCtx) => (p.shadow ??= new Track<number>(0));

  // Overlays per state, and layers drawn under a part (selections).
  const overlays = new Map<string, Layer[]>();
  const under = new Map<string, Layer[]>();
  const addOverlay = (state: string, layer: Layer) => { if (!overlays.has(state)) overlays.set(state, []); overlays.get(state)!.push(layer); };
  const liveText = new Map<string, Layer[]>();
  let n = 0;
  const fx = () => `fx${++n}`;

  // States whose screen fades in under an assemble, and when.
  const assembleBase = new Map<string, number>();

  // ── cursor waypoints ──
  const waypoints: { t: number; p: Vec; press?: boolean; hold?: number }[] = [];

  const lift = (p: PartCtx, t: number, scale = 1.088, dim = 0.32, hold = 19 * F) => {
    p.scale.pulse(t, scale * 100, 9 * F, hold, 8 * F);
    shadowOf(p).pulse(t, 38, 9 * F, hold, 8 * F);
    for (const other of parts.values()) {
      if (other === p || other.state !== p.state || other.part.parent !== p.part.parent || (p.part.group !== undefined && other.part.group !== p.part.group)) continue;
      other.opacity.pulse(t, dim * 100, 9 * F, hold, 8 * F);
    }
  };

  const textLayer = (p: PartCtx, id: string, extra: Record<string, unknown>, color?: string): Layer | null => {
    const tx = p.part.text;
    if (!tx) return null;
    const origin: Vec = [p.part.box[0] - p.part.margin, p.part.box[1] - p.part.margin];
    return {
      id, name: `${p.part.id} text`, type: 'text', parent: p.layerId,
      transform: { position: [round((tx.x - origin[0]) * k), round((tx.y - origin[1]) * k)] },
      text: { text: tx.value, font: tx.font, size: round(tx.size * k), weight: tx.weight, color: color ?? tx.color, align: tx.align, lineHeight: 1.15, ...extra },
    } as Layer;
  };
  const pushText = (p: PartCtx, layer: Layer | null) => { if (!layer) return; const list = liveText.get(p.layerId) ?? []; list.push(layer); liveText.set(p.layerId, list); };
  const placeholderDone = new Set<string>();

  for (const action of actions) {
    const t = action.t;
    switch (action.type) {
      case 'type':
      case 'type-script': {
        const p = find(action.target, t);
        if (!p) break;
        const tx = p.part.text;
        const at = tx ? P(tx.x + (tx.align === 'left' ? 6 : 0), tx.y) : centre(p);
        if (action.click !== false) { waypoints.push({ t: t - 0.2, p: at, press: true }); cue(t - 0.2, 'click'); }
        // The field's own text is the placeholder until the typing starts.
        if (tx?.value && !placeholderDone.has(p.layerId)) {
          placeholderDone.add(p.layerId);
          const ph = textLayer(p, `ph-${p.layerId}`, {});
          if (ph) pushText(p, { ...ph, out: round(t) });
        }
        const script = action.type === 'type' ? undefined : action.script;
        const text = action.type === 'type' ? action.text : '';
        const cps = action.cps ?? 30;
        const typed = textLayer(p, `type-${p.layerId}-${n++}`, { text, type: { at: round(t), cps, ...(action.type === 'type' && action.chunk ? { chunk: action.chunk } : {}), ...(script ? { script } : {}), caret: 'bar', caretColor: accent, blink: 1.1 } }, action.color ?? (dark ? '#f5f6fa' : '#111827'));
        if (typed) pushText(p, { ...typed, in: round(Math.max(0, t - 0.2)) });
        const chars = script ? script.reduce((m, s) => m + ('type' in s ? s.type.length : 'backspace' in s ? s.backspace : 0), 0) : text.length;
        const seconds = script ? chars / cps + script.reduce((m, s) => m + ('wait' in s ? s.wait : 0), 0) : chars / cps;
        if (action.type !== 'type' || action.chunk !== 'word') cue(t, 'typing', { duration: round(Math.min(2, Math.max(0.15, seconds))) });
        break;
      }
      case 'click': {
        const p = find(action.target, t);
        if (!p) break;
        const c = centre(p);
        waypoints.push({ t, p: c, press: true });
        p.scale.pulse(t, 97, 0.06, 0, 0.14, 'cubic-out', 'cubic-out');
        if (action.ripple !== false) {
          const d = 56 * k;
          addOverlay(p.state.id, {
            id: fx(), name: 'Ripple', type: 'shape', in: round(t), out: round(t + 0.55), transform: { position: c, scale: new Track<number>(30).move(t, 0.5, 30, 150, 'cubic-out').prop(), opacity: new Track<number>(55).move(t, 0.5, 55, 0, 'cubic-out').prop() },
            shape: { shape: 'rect', groups: [{ kind: 'ellipse', position: [d / 2 + 4, d / 2 + 4], size: [d, d], fill: `${accent}33`, stroke: { paint: accent, width: 2 * k } }] },
          });
        }
        cue(t, 'click');
        break;
      }
      case 'hover':
      case 'cursor': {
        const c = point(action.target, t);
        if (c) waypoints.push({ t, p: c });
        break;
      }
      case 'hover-lift': {
        const p = find(action.target, t);
        if (!p) break;
        waypoints.push({ t, p: centre(p) });
        lift(p, t, action.scale ?? 1.088, action.dimOthers ?? 0.32, action.hold ?? 19 * F);
        cue(t, 'tick');
        break;
      }
      case 'sweep': {
        const every = action.every ?? 0.3;
        action.targets.forEach((name, i) => {
          const at = t + i * every;
          const p = find(name, at);
          if (!p) return;
          waypoints.push({ t: at, p: centre(p) });
          lift(p, at, 1.05, 0.55, Math.max(0, every - 17 * F));
          cue(at, 'tick');
        });
        break;
      }
      case 'select': {
        const p = find(action.target, t);
        if (!p) break;
        const [, , w, h] = p.part.box;
        const list = under.get(p.layerId) ?? [];
        list.push({
          id: fx(), name: 'Selection', type: 'shape', ...(p.part.parent ? { parent: parts.get(key(p.state.id, p.part.parent))?.layerId } : {}),
          transform: { position: p.rest, opacity: new Track<number>(0).move(t, 0.15, 0, 100, 'cubic-out').prop() },
          shape: { shape: 'rect', groups: [{ kind: 'rect', position: [(w / 2 + 6) * k, (h / 2 + 6) * k], size: [(w + 12) * k, (h + 12) * k], radius: (p.part.radius + 6) * k, fill: action.color ?? `${accent}24` }] },
        });
        under.set(p.layerId, list);
        cue(t, 'tick');
        break;
      }
      case 'highlight':
      case 'pulse':
      case 'focus': {
        const p = find(action.target, t);
        if (!p) break;
        const [, , w, h] = p.part.box;
        const color = action.color ?? accent;
        const opacity = new Track<number>(0).key(t, 0, 'cubic-out').key(t + 0.2, 100);
        const scale = new Track<number>(100);
        if (action.type === 'highlight') opacity.key(t + 0.2 + (action.duration ?? 1.2), 100, 'cubic-in').key(t + 0.5 + (action.duration ?? 1.2), 0);
        if (action.type === 'pulse') {
          scale.pulse(t + 0.2, 106, 0.18, 0, 0.22, 'sine-in-out', 'sine-in-out').pulse(t + 0.62, 106, 0.18, 0, 0.22, 'sine-in-out', 'sine-in-out');
          opacity.key(t + 1.1, 100, 'cubic-in').key(t + 1.4, 0);
        }
        addOverlay(p.state.id, {
          id: fx(), name: `${action.type} ${p.part.id}`, type: 'shape', in: round(t),
          transform: { position: centre(p), opacity: opacity.prop(), scale: scale.prop() },
          effects: [{ type: 'glow', radius: 14, intensity: 0.7, color } as Effect],
          shape: { shape: 'rect', groups: [{ kind: 'rect', position: [(w / 2 + 16) * k, (h / 2 + 16) * k], size: [(w + 12) * k, (h + 12) * k], radius: (p.part.radius + 6) * k, fill: null, stroke: { paint: color, width: 2.5 * k } }] },
        });
        break;
      }
      case 'count': {
        const p = find(action.target, t);
        if (!p?.part.text) break;
        const { format, decimals, separator } = numberFormat(p.part.text.value);
        const from = action.from ?? 0;
        const layer = textLayer(p, `count-${p.layerId}`, {
          text: undefined,
          counter: { value: new Track<number>(from).move(t, action.duration ?? 1.2, from, action.to, 'expo-out').prop(), decimals: action.decimals ?? decimals, format, separator },
        });
        if (layer) pushText(p, layer);
        cue(t, 'blip');
        break;
      }
      case 'tooltip':
      case 'notify': {
        const p = action.target ? find(action.target, t) : undefined;
        const state = p?.state.id ?? stateAt(t);
        const notify = action.type === 'notify';
        const tw = Math.min(notify ? 360 : 280, 24 + action.text.length * (notify ? 8 : 7.2));
        const th = notify ? 64 : 34;
        const cx = notify ? W - 24 - tw / 2 : p ? p.part.box[0] + p.part.box[2] / 2 : W / 2;
        const cy = notify ? 24 + th / 2 : p ? p.part.box[1] - 12 - th / 2 : H / 2;
        const until = t + (action.duration ?? (notify ? 2.6 : 1.8));
        const id = fx();
        const fill = notify ? (dark ? '#1e2230' : '#ffffff') : '#111827';
        const opacity = new Track<number>(0).move(t, 0.18, 0, 100, 'cubic-out').key(until, 100, 'cubic-in').key(until + 0.25, 0);
        const pos = notify ? new Track<Vec>(P(cx, cy)).move(t, 0.45, P(cx + 40, cy), P(cx, cy), 'settle') : new Track<Vec>(P(cx, cy));
        const scale = notify ? new Track<number>(100) : new Track<number>(100).move(t, 0.28, 85, 100, 'back-out');
        addOverlay(state, {
          id, name: notify ? 'Notification' : 'Tooltip', type: 'shape', in: round(t), out: round(until + 0.3),
          transform: { position: pos.prop(), opacity: opacity.prop(), scale: scale.prop() },
          ...(notify ? { effects: [{ type: 'drop-shadow', color: '#0b1020', opacity: 22, softness: 30, distance: 10, direction: 180 } as Effect] } : {}),
          shape: { shape: 'rect', bounds: [tw * k, (th + (notify ? 0 : 7)) * k], groups: [
            { kind: 'rect', position: [(tw / 2) * k, (th / 2) * k], size: [tw * k, th * k], radius: (notify ? 14 : 8) * k, fill },
            ...(notify ? [{ kind: 'ellipse', position: [20 * k, (th / 2) * k], size: [10 * k, 10 * k], fill: accent } as ShapeItem] : [{ kind: 'path', d: `M${(tw / 2 - 7) * k} ${th * k} L${(tw / 2) * k} ${(th + 7) * k} L${(tw / 2 + 7) * k} ${th * k} Z`, fill } as ShapeItem]),
          ] },
        });
        addOverlay(state, {
          id: `${id}-text`, name: 'Text', type: 'text', parent: id, in: round(t), out: round(until + 0.3),
          transform: { position: [(notify ? 36 : tw / 2) * k, (th / 2) * k] },
          text: { text: action.text, font: 'Inter', size: (notify ? 15 : 13) * k, weight: notify ? 600 : 500, color: notify ? (dark ? '#f5f6fa' : '#111827') : '#ffffff', align: notify ? 'left' : 'center' },
        });
        cue(t, notify ? 'blip' : 'pop');
        break;
      }
      case 'assemble': {
        const state = raster.states.find((s) => s.id === stateAt(t)) ?? raster.states[0];
        const top = [...parts.values()].filter((p) => p.state === state && !p.part.parent);
        const mid: Vec = [W / 2, H / 2];
        const dist = (p: PartCtx) => Math.hypot(p.part.box[0] + p.part.box[2] / 2 - mid[0], p.part.box[1] + p.part.box[3] / 2 - mid[1]);
        if (action.order !== 'dom') top.sort((a, b) => dist(a) - dist(b));
        top.forEach((p, i) => {
          const at = t + 0.15 + i * (action.stagger ?? 0.045);
          p.position.move(at, 0.55, [p.rest[0], p.rest[1] + 40 * k], p.rest, 'settle');
          p.scale.move(at, 0.55, 92, 100, 'settle');
          p.opacity.move(at, 0.3, 0, 100, 'cubic-out');
        });
        assembleBase.set(state.id, t);
        cue(t + 0.15, 'whoosh');
        break;
      }
      case 'drag': {
        const p = find(action.target, t);
        const to = point(action.to, t);
        if (!p || !to) break;
        const dur = action.duration ?? 0.8;
        const from = centre(p);
        const delta: Vec = [to[0] - from[0], to[1] - from[1]];
        waypoints.push({ t, p: from, press: true, hold: dur });
        waypoints.push({ t: t + dur, p: to });
        p.position.move(t + 2 * F, dur, p.rest, [p.rest[0] + delta[0], p.rest[1] + delta[1]]);
        p.scale.pulse(t, 104, 0.12, dur - 0.1, 0.15);
        shadowOf(p).pulse(t, 35, 0.12, dur - 0.1, 0.15);
        cue(t, 'click');
        cue(t + dur, 'tick');
        break;
      }
      case 'state':
        cue(t, action.transition === 'slide' ? 'swish' : 'tick');
        break;
      case 'zoom':
        cue(t, 'whoosh');
        break;
    }
  }

  // ── state layers ──
  function stateLayers(state: UiRasterState): Layer[] {
    const out: Layer[] = [];
    const baseOpacity = assembleBase.has(state.id) ? new Track<number>(100).move(assembleBase.get(state.id)!, 0.35, 0, 100, 'cubic-out').prop() : 100;
    out.push({
      id: `base-${slug(state.id)}`, name: `Screen${raster.states.length > 1 ? ` · ${state.id}` : ''}`, type: 'footage', fit: 'contain', size: [W * k, H * k],
      source: { path: state.base, kind: 'image', width: W * k, height: H * k },
      transform: { position: P(W / 2, H / 2), opacity: baseOpacity },
      ...(frame.screenRadius ? { masks: [{ shape: 'rect', radius: frame.screenRadius * k }] } : {}),
    } as Layer);
    for (const part of state.parts) {
      const p = parts.get(key(state.id, part.id))!;
      out.push(...(under.get(p.layerId) ?? []));
      const m = part.margin;
      const size: Vec = [(part.box[2] + 2 * m) * k, (part.box[3] + 2 * m) * k];
      out.push({
        id: p.layerId, name: part.id, type: 'footage', fit: 'contain', size,
        ...(part.parent ? { parent: parts.get(key(state.id, part.parent))?.layerId } : {}),
        source: { path: part.path, kind: 'image', width: size[0], height: size[1] },
        transform: { position: p.position.prop(), scale: p.scale.prop(), opacity: p.opacity.prop() },
        ...(p.shadow ? { effects: [{ type: 'drop-shadow', color: '#0b1020', opacity: p.shadow.prop(), softness: 34, distance: 16, direction: 180 } as Effect] } : {}),
      } as Layer);
      out.push(...(liveText.get(p.layerId) ?? []));
    }
    out.push(...(overlays.get(state.id) ?? []));
    return out;
  }

  const canvas: Vec = [round(frame.width * k), round(frame.height * k)];
  const layers: Layer[] = [];
  const chrome = chromeItems(spec, frame, W, H, k);
  if (chrome.length) {
    layers.push({ id: 'chrome', name: 'Device', type: 'shape', shape: { shape: 'rect', groups: chrome, bounds: canvas } });
    if ((spec.device ?? 'browser') === 'browser' && spec.url) {
      layers.push({ id: 'url', name: 'Address', type: 'text', transform: { position: [round((W / 2) * k), round(22 * k)] }, text: { text: spec.url, font: 'Inter', size: 13 * k, weight: 500, color: dark ? '#a4a9b6' : '#5d6472', align: 'center' } });
    }
  }
  if (raster.states.length === 1) layers.push(...stateLayers(raster.states[0]));
  else {
    // Each state is its own precomp, shown in its windows (cut, fade or slide between them).
    const order = ['main', ...switches.map((s) => s.to)];
    const times = [0, ...switches.map((s) => s.t)];
    for (const state of raster.states) {
      const opacity = new Track<number>(state.id === 'main' ? 100 : 0);
      const position = new Track<Vec>([canvas[0] / 2, canvas[1] / 2]);
      order.forEach((id, i) => {
        if (i === 0) return;
        const at = times[i];
        const how = switches[i - 1].transition ?? 'fade';
        const coming = id === state.id;
        const going = order[i - 1] === state.id && !coming;
        if (!coming && !going) return;
        const dur = how === 'cut' ? F : how === 'slide' ? 0.5 : 0.3;
        opacity.move(at, dur, coming ? 0 : 100, coming ? 100 : 0, how === 'cut' ? 'hold' : 'cubic-out');
        if (how === 'slide') position.move(at, 0.5, [canvas[0] / 2 + (coming ? 1 : 0) * canvas[0] * 0.06, canvas[1] / 2], [canvas[0] / 2 - (going ? 1 : 0) * canvas[0] * 0.06, canvas[1] / 2], HOUSE);
      });
      layers.push({
        id: `state-${slug(state.id)}`, name: `State · ${state.id}`, type: 'precomp',
        scene: { version: 1, width: canvas[0], height: canvas[1], duration, layers: stateLayers(state) },
        transform: { opacity: opacity.prop(), position: position.prop() },
      });
    }
  }

  // ── cursor ──
  if (spec.cursor !== false && waypoints.length) {
    const { layer, tip } = cursorLayer(spec, k);
    waypoints.sort((a, b) => a.t - b.t);
    const from = spec.cursor && spec.cursor.from ? P(spec.cursor.from[0], spec.cursor.from[1]) : P(W + 40, H * 0.92);
    const position = new Track<Vec>(from);
    const scale = new Track<number>(100);
    const first = waypoints[0];
    const glide = (a: Vec, b: Vec) => Math.min(0.75, 0.35 + Math.hypot(b[0] - a[0], b[1] - a[1]) / k / 1800);
    const appear = Math.max(0, first.t - glide(from, first.p) - 0.25);
    let prev = { t: appear, p: from };
    position.key(appear, from, HOUSE);
    for (const wp of waypoints) {
      const depart = Math.max(prev.t + 0.1, wp.t - glide(prev.p, wp.p));
      if (depart < wp.t - 1e-3) position.key(depart, prev.p, HOUSE).key(wp.t, wp.p);
      else position.key(wp.t, wp.p);
      if (wp.press) scale.pulse(wp.t, 84, 0.07, wp.hold ?? 0, 0.13, 'cubic-out', 'cubic-out');
      prev = { t: wp.t + (wp.hold ?? 0), p: wp.p };
    }
    const hideAt = prev.t + (spec.cursor && spec.cursor.hideAfter !== undefined ? spec.cursor.hideAfter : 1);
    const opacity = new Track<number>(0).move(appear, 0.15, 0, 100, 'cubic-out');
    if (hideAt < duration) opacity.key(hideAt, 100, 'cubic-in').key(hideAt + 0.25, 0);
    layers.push({ ...layer, transform: { anchor: tip, position: position.prop(), scale: scale.prop(), opacity: opacity.prop() } });
  }

  // ── the screen in the comp ──
  const share = spec.place?.width ?? 0.72;
  const base = round(100 * Math.min((comp.width * share) / canvas[0], (comp.height * 0.84) / canvas[1]));
  const at: Vec = spec.place?.position ?? [comp.width / 2, comp.height / 2];
  const mid: Vec = [canvas[0] / 2, canvas[1] / 2];
  const scale = new Track<number>(base);
  const anchor = new Track<Vec>(mid);
  const position = new Track<Vec>(at);
  const opacity = new Track<number>(100);
  const enter = spec.place?.enter ?? 'rise';
  const enterAt = spec.place?.enterAt ?? 0;
  if (enter !== 'none') {
    opacity.move(enterAt, 0.35, 0, 100, 'cubic-out');
    if (enter === 'rise') position.move(enterAt, 0.8, [at[0], at[1] + comp.height * 0.07], at, 'settle');
    if (enter === 'scale') scale.move(enterAt, 0.8, base * 0.9, base, 'settle');
  }
  let zoomed: { anchor: Vec; scale: number } = { anchor: mid, scale: base };
  for (const action of actions) {
    if (action.type !== 'zoom') continue;
    const p = action.target ? find(action.target, action.t) : undefined;
    const next = p ? { anchor: centre(p), scale: round(base * (action.zoom ?? 2)) } : { anchor: mid, scale: base };
    const dur = action.duration ?? 0.8;
    anchor.move(action.t, dur, zoomed.anchor, next.anchor, HOUSE);
    scale.move(action.t, dur, zoomed.scale, next.scale, HOUSE);
    zoomed = next;
  }
  const exitAt = spec.place?.exitAt;
  if (exitAt !== undefined) {
    opacity.key(exitAt, 100, 'cubic-in').key(exitAt + 0.4, 0);
    position.key(exitAt, at, 'cubic-in').key(exitAt + 0.4, [at[0], at[1] + comp.height * 0.04]);
  }
  const tilt = spec.place?.tilt;
  const scene: MotionScene = { version: 1, width: canvas[0], height: canvas[1], duration, layers };
  const layer: Layer = {
    id: 'ui-screen', name: opts.name ?? 'UI screen', type: 'precomp', scene,
    ...(tilt ? { threeD: true } : {}),
    transform: { anchor: anchor.prop(), position: position.prop(), scale: scale.prop(), opacity: opacity.prop(), ...(tilt ? { rotationX: tilt[0], rotationY: tilt[1] } : {}) },
    ...(spec.device === 'phone' || spec.device === 'laptop' || spec.device === 'browser' || spec.device === undefined ? { effects: [{ type: 'drop-shadow', color: '#0b1020', opacity: 26, softness: 60, distance: 24, direction: 180 } as Effect] } : {}),
  };
  return { layer, scene, cues: cues.filter((c) => c.at >= 0 && c.at < duration).sort((a, b) => a.at - b.at), duration };
}

/** How long an action keeps moving after its start, for the default scene length. */
function actionLength(action: UiAction): number {
  switch (action.type) {
    case 'type': return action.text.length / (action.cps ?? 30);
    case 'type-script': return action.script.reduce((m, s) => m + ('type' in s ? s.type.length / (action.cps ?? 30) : 'backspace' in s ? s.backspace / 45 : s.wait), 0);
    case 'sweep': return action.targets.length * (action.every ?? 0.3);
    case 'count': return action.duration ?? 1.2;
    case 'tooltip': case 'notify': return (action.duration ?? 2) + 0.3;
    case 'drag': return action.duration ?? 0.8;
    case 'zoom': return action.duration ?? 0.8;
    default: return 0.6;
  }
}

/** "$12,400" → format "${n}", 0 decimals, "," separator; "4.8★" → "{n}★", 1 decimal. */
export function numberFormat(text: string): { format: string; decimals: number; separator: string } {
  const match = /-?\d[\d,]*(\.\d+)?/.exec(text);
  if (!match) return { format: `${text}{n}`, decimals: 0, separator: '' };
  const decimals = match[1] ? match[1].length - 1 : 0;
  return { format: `${text.slice(0, match.index)}{n}${text.slice(match.index + match[0].length)}`, decimals, separator: match[0].includes(',') ? ',' : '' };
}
