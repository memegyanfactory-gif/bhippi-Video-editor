// The product demo (docs/plans/NATIVE-AI-TOOLKIT-PLAN.md Phase 3; the upgrade plan's U1.3,
// U2.1–U2.5, U3.4): a captured app session (capture_app_session: every named part in every state,
// 3x pictures with their CSS boxes) made into a scene of layers the user can open and edit. The
// window is a 3D null holding each part as its own picture where it sits in the app, each state a
// timed layer; a camera lands on a part, dollies between shots and pulls back to the whole window
// tilted; named cursors click and type; the window can come apart in depth and slam back on a
// beat. The numbers the premium films used (docs/research/launch-film-learnings.md §4–5) are the
// defaults, so a call with only parts and times still gets the craft, and the style inputs and the
// variant keep two films from coming out the same. Pure: the same params build the same scene.
import { cubicBezier, ease as easeAt } from '../anim';
import { adaptiveBlur } from '../blur';
import { DEFAULT_ZOOM_RATIO } from '../evaluate';
import type { Ease, Effect, Key, Layer, MotionScene, Vec } from '../types';
import type { KitContext } from './common';
import type { TemplateSpec } from './index';

/** One picture of a capture: a part in a state, where it sat on the page (CSS px, padding included). */
export type CapturePart = { part: string; state: string; file: string; boxCss: number[]; pixels?: number[]; typed?: string };
/** A capture_app_session manifest, as far as the demo reads it. */
export type DemoCapture = { name?: string; dir: string; width: number; height: number; scale: number; parts: CapturePart[] };

/**
 * Where the camera lands at `at`: close on a part (filling `fill` of the frame; the frame stays on
 * the app where it can, `centre` aims dead centre), or the whole window tilted.
 */
export type DemoShot = { at: number; focus?: string; wide?: boolean; fill?: number; tilt?: number[]; move?: number; ease?: Ease; centre?: boolean };
export type DemoAction = {
  at: number;
  /** Moves the cursor onto the part and clicks it: a press, a ring, and the part's pressed state when it has one. */
  click?: string;
  hover?: string;
  /** Plays the part's typing states (t00, t01…) from `at` to `until`, or one word per time in `words`. */
  type?: string;
  until?: number;
  words?: number[];
  text?: string;
  /** Swaps a part to another captured state on this frame. */
  set?: { part: string; state: string };
  cursor?: string;
};
export type DemoCursor = { id: string; label?: string; color?: string };
/** The window comes apart in depth from `at` and slams back together on `slam` (a drop, a bar). */
export type DemoExplode = { at: number; slam: number; depth?: number; spread?: number; blur?: number };
export type ProductDemoParams = {
  capture: DemoCapture;
  duration?: number;
  shots?: DemoShot[];
  actions?: DemoAction[];
  cursors?: (string | DemoCursor)[];
  /** "light", "grid", "cool", "dark", "none", a colour, or [top, bottom] colours. */
  stage?: string | string[];
  /** The part that is the whole window (default: one named window/app/screen, or covering the capture). */
  base?: string;
  /** The wide shot's tilt [rx, ry] in degrees. */
  tilt?: number[];
  explode?: DemoExplode;
  /** Picks the tilt side, the stage and the explode pattern; recorded, so a rebuild keeps its look. */
  variant?: number;
  fps?: number;
  /** false: the first shot starts where it lands instead of settling in. */
  settle?: boolean;
};

// The films' numbers (launch-film-learnings.md §4.1, §4.4, §5 P3–P5).
const WIDE_FILL = 0.84;
const FOCUS_FILL = 0.7;
const BREATHE = 0.012;
const DWELL = 0.055;
/** The cursor arrow's height on screen at 1080p: about 1.6x a system pointer, the size the films kept at every zoom. */
const CURSOR = 30;
const PRESS_DIP = 86;
const RING: [number, number] = [16, 86];
const SLAM = 0.43;
/** Opus's panel depths on a 1920 px window (the back plate at +520), cycled over the parts. */
const DEPTHS = [-420, 300, -280, 120, -170, 300, -70, 170, -110];
const BACK = 520;
const RESTING = ['idle', 'rest', 'default', 'normal', 'closed', 'empty', 'off', 'before'];
const PRESSED = ['pressed', 'down', 'clicked'];
const BASE_NAMES = /^(window|app|screen|page|base|root|full|desktop)$/i;
/** Named multiplayer cursors with the app's own colours: blue is your move, ember is Bhippi at work. */
export const ACTORS: Record<string, { label: string; color: string }> = {
  you: { label: 'You', color: '#2d8ceb' },
  bhippi: { label: 'Bhippi', color: '#ff7a1a' },
  claude: { label: 'Claude', color: '#d97757' },
  gpt: { label: 'GPT', color: '#10a37f' },
  codex: { label: 'Codex', color: '#10a37f' },
  gemini: { label: 'Gemini', color: '#3186ff' },
  grok: { label: 'Grok', color: '#e6e6e6' },
  kimi: { label: 'Kimi', color: '#155eef' },
  local: { label: 'Local', color: '#6b7280' },
};
const SPARE = ['#8b5cf6', '#14b8a6', '#e11d48', '#f59e0b'];
/** Looks a film can land on without asking: the wide tilt's side, the stage, the orbit of the explode. */
const VARIANTS: { stage: string; tilt: [number, number]; orbit: [number, number]; side: 1 | -1 }[] = [
  { stage: 'light', tilt: [5, -9], orbit: [15, -33], side: 1 },
  { stage: 'grid', tilt: [4, 8], orbit: [13, 30], side: -1 },
  { stage: 'cool', tilt: [6, -7], orbit: [16, -28], side: 1 },
  { stage: 'light', tilt: [3, 10], orbit: [12, 34], side: -1 },
];
const ARROW = 'M0 0 L0 20.5 L5.2 15.6 L8.6 23.4 L12 21.9 L8.7 14.4 L15.6 14.4 Z';

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
const titled = (name: string) => name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const typingNumber = (state: string) => (/^t\d+$/.test(state) ? Number(state.slice(1)) : -1);

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// ───────────────────────── the camera ─────────────────────────

/** What the camera sees: a point of the window (window px) at the frame centre, magnified `m`, the window tilted [rx, ry]. */
export type Framing = { target: Vec; m: number; tilt: [number, number] };
export type Station = Framing & { t: number; ease: Ease };

/**
 * A camera that frames a box of the window: its centre at the frame centre, big enough that the
 * box fills `fill` of the frame (in the side that runs out first), no closer than the pictures'
 * pixels allow. With a one-node camera at the target, `m` is `zoom / distance`.
 */
export function framePart(box: { x: number; y: number; w: number; h: number }, frame: { width: number; height: number }, fill: number, maxM = Infinity): Framing {
  const m = clamp(fill * Math.min(frame.width / Math.max(1, box.w), frame.height / Math.max(1, box.h)), 0.2, maxM);
  return { target: [box.x + box.w / 2, box.y + box.h / 2], m, tilt: [0, 0] };
}

/**
 * A close-up keeps the frame on the app where it can, the way an operator frames a part near the
 * window's edge: the camera slides toward the window's inside, but never so far that any of the
 * part (with a 6% margin) leaves the frame. A tall frame on a wide window then shows the app above
 * a part at its bottom edge instead of half a frame of empty stage.
 */
export function onWindow(framing: Framing, box: { x: number; y: number; w: number; h: number }, frame: { width: number; height: number }, window: [number, number]): Framing {
  const axis = (aim: number, from: number, size: number, half: number, span: number) => {
    const inside = span >= 2 * half ? clamp(aim, half, span - half) : span / 2;
    const margin = half * 0.12;
    const low = Math.min(from + size - half + margin, from + size / 2);
    const high = Math.max(from + half - margin, from + size / 2);
    return clamp(inside, low, high);
  };
  const half = [frame.width / 2 / framing.m, frame.height / 2 / framing.m];
  return { ...framing, target: [axis(framing.target[0], box.x, box.w, half[0], window[0]), axis(framing.target[1], box.y, box.h, half[1], window[1])] };
}

/**
 * Where a point of the window lands in the scene: the window null sits at the frame centre and
 * turns about its own centre, rotation Y after X as the engine applies them.
 */
export function windowPoint(point: Vec, windowCentre: Vec, tilt: number[], frame: { width: number; height: number }): Vec {
  const rx = (tilt[0] * Math.PI) / 180;
  const ry = (tilt[1] * Math.PI) / 180;
  const dx = point[0] - windowCentre[0];
  const dy = point[1] - windowCentre[1];
  return [frame.width / 2 + Math.cos(ry) * dx + Math.sin(ry) * Math.sin(rx) * dy, frame.height / 2 + Math.cos(rx) * dy, -Math.sin(ry) * dx + Math.cos(ry) * Math.sin(rx) * dy];
}

/**
 * The one-node camera for a framing: at the target, `zoom / m` in front of it, looking straight
 * down the depth axis, so the target sits at the frame centre magnified `m`; focus on the target.
 */
export function cameraFor(framing: Framing, windowCentre: Vec, frame: { width: number; height: number }): { position: Vec; focus: number } {
  const zoom = frame.width * DEFAULT_ZOOM_RATIO;
  const at = windowPoint(framing.target, windowCentre, framing.tilt, frame);
  return { position: [at[0], at[1], at[2] - zoom / framing.m], focus: zoom / framing.m };
}

/**
 * The ease for the camera's distance on a dolly from magnification a to b (`ratio` = a / b): the
 * zoom then reads at a steady speed (keyed in log space, as the 15 s film found) while the target
 * and tilt keep `ease`. A bezier fitted to (r^e(u) − 1)/(r − 1), its control points kept inside
 * 0–1 so the camera never overshoots a landing.
 */
export function dollyEase(ease: Ease, ratio: number): Ease {
  if (!(ratio > 0) || Math.abs(Math.log(ratio)) < 0.01) return ease;
  const us = Array.from({ length: 24 }, (_, i) => (i + 0.5) / 24);
  const goal = us.map((u) => (ratio ** easeAt(ease, u) - 1) / (ratio - 1));
  const error = (p: number[]) => us.reduce((sum, u, i) => sum + (cubicBezier(p[0], p[1], p[2], p[3], u) - goal[i]) ** 2, 0);
  let best = [0.42, 0, 0.58, 1];
  let bestError = error(best);
  for (const x1 of [0.1, 0.3, 0.5, 0.7]) for (const y1 of [0, 0.25, 0.5]) for (const x2 of [0.3, 0.5, 0.7, 0.9]) for (const y2 of [0.5, 0.75, 1]) {
    const e = error([x1, y1, x2, y2]);
    if (e < bestError) { best = [x1, y1, x2, y2]; bestError = e; }
  }
  for (let step = 0.1; step > 0.001; step /= 2) {
    let better = true;
    while (better) {
      better = false;
      for (let k = 0; k < 4; k++) {
        for (const d of [step, -step]) {
          const p = [...best];
          p[k] = clamp(p[k] + d, 0, 1);
          const e = error(p);
          if (e < bestError - 1e-12) { best = p; bestError = e; better = true; }
        }
      }
    }
  }
  return best.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number];
}

/** The framing at `t` along the stations, as the camera means it: target and tilt on the segment's ease, magnification in log space. */
export function framingAt(stations: Station[], t: number): Framing {
  if (!stations.length) return { target: [0, 0], m: 1, tilt: [0, 0] };
  if (t <= stations[0].t) return stations[0];
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    if (t < b.t) {
      const e = easeAt(a.ease, (t - a.t) / Math.max(1e-9, b.t - a.t));
      const mix = (x: number, y: number) => x + (y - x) * e;
      return { target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1])], m: Math.exp(mix(Math.log(a.m), Math.log(b.m))), tilt: [mix(a.tilt[0], b.tilt[0]), mix(a.tilt[1], b.tilt[1])] };
    }
  }
  return stations[stations.length - 1];
}

const OVERSHOOT = new Set(['back-in', 'back-out', 'back-in-out', 'elastic-out', 'bounce-out', 'spring']);

/** A camera ease that lands without overshooting: springy ones become a glide, bezier handles stay in 0–1. */
function calm(ease: Ease | undefined, notes: string[], where: string): Ease {
  if (ease === undefined) return 'cubic-in-out';
  if (Array.isArray(ease)) return ease.length === 4 ? [clamp(ease[0], 0, 1), clamp(ease[1], 0, 1), clamp(ease[2], 0, 1), clamp(ease[3], 0, 1)] : 'cubic-in-out';
  if (!OVERSHOOT.has(ease)) return ease;
  notes.push(`${where}: the camera glides on cubic-in-out instead of ${ease}, so it lands without bouncing`);
  return 'cubic-in-out';
}

/** How long the camera takes between two framings: longer for a bigger zoom, pan or turn (0.6–1.6 s). */
export function travelTime(a: Framing, b: Framing, windowDiagonal: number): number {
  const zoom = Math.abs(Math.log(b.m / a.m));
  const pan = Math.hypot(b.target[0] - a.target[0], b.target[1] - a.target[1]) / Math.max(1, windowDiagonal);
  const turn = Math.max(Math.abs(b.tilt[0] - a.tilt[0]), Math.abs(b.tilt[1] - a.tilt[1]));
  return clamp(0.6 + 0.35 * zoom + 0.9 * pan + 0.015 * turn, 0.6, 1.6);
}

// ───────────────────────── typing ─────────────────────────

/**
 * When each typing state lands (seconds, by characters typed). Across a span, evenly; on word
 * times, each word starts 35 ms before its onset and types at about 55 ms a character (46–66 ms in
 * the Opus film), faster when the next word comes sooner.
 */
export function typingTimes(counts: number[], action: { at: number; until?: number; words?: number[]; text?: string }): number[] {
  const total = Math.max(1, ...counts);
  const words = (action.words ?? []).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (words.length) {
    // Each word's first and last character: from the text when known, else the characters shared out.
    const spans: [number, number][] = [];
    const text = action.text?.trim();
    if (text) {
      const scale = total / text.length;
      for (const match of text.matchAll(/\S+\s*/g)) spans.push([Math.round(match.index! * scale), Math.round((match.index! + match[0].length) * scale)]);
    }
    while (spans.length > words.length) spans[words.length - 1][1] = spans.pop()![1];
    if (spans.length < words.length) {
      spans.length = 0;
      words.forEach((_, j) => spans.push([Math.round((j * total) / words.length), Math.round(((j + 1) * total) / words.length)]));
    }
    return counts.map((count) => {
      if (count <= 0) return words[0] - 0.035;
      const j = Math.max(0, spans.findIndex(([, end]) => count <= end));
      const [start, end] = spans[j];
      const next = words[j + 1] ?? words[j] + (end - start) * 0.055 + 0.3;
      const step = clamp((next - words[j]) / Math.max(1, end - start + 1), 0.02, 0.058);
      return words[j] - 0.035 + (count - start - 1) * step;
    });
  }
  const until = action.until !== undefined && action.until > action.at ? action.until : action.at + total * 0.045;
  return counts.map((count) => action.at + (count / total) * (until - action.at));
}

// ───────────────────────── the scene ─────────────────────────

type Picture = CapturePart;
type Interval = { state: Picture; from: number; to: number };
type Box = { x: number; y: number; w: number; h: number };

function readCapture(capture: DemoCapture): Map<string, Picture[]> {
  if (!capture || typeof capture !== 'object' || !Array.isArray(capture.parts)) throw new Error('product-demo needs a capture: capture_app_session first, then create_product_demo {capture: its name}.');
  const parts = new Map<string, Picture[]>();
  for (const picture of capture.parts) {
    if (!picture || typeof picture.part !== 'string' || typeof picture.file !== 'string' || !Array.isArray(picture.boxCss) || picture.boxCss.length < 4) continue;
    parts.set(picture.part, [...(parts.get(picture.part) ?? []), picture]);
  }
  if (!parts.size) throw new Error('The capture has no parts to show.');
  return parts;
}

const area = (box: number[]) => box[2] * box[3];
const inside = (a: number[], b: number[]) => a[0] >= b[0] - 2 && a[1] >= b[1] - 2 && a[0] + a[2] <= b[0] + b[2] + 2 && a[1] + a[3] <= b[1] + b[3] + 2;

function stageLayers(stage: string | string[], u: number): Layer[] {
  if (Array.isArray(stage)) return [{ id: 'stage', name: 'Stage', type: 'procedural', kind: 'linear-gradient', params: { from: stage[0], to: stage[1] ?? stage[0], angle: 90 } }];
  switch (stage) {
    case 'none': return [];
    // Cream with a soft highlight (the Opus film), peach with hairlines, a cool grey, an ember dark.
    case 'light': return [{ id: 'stage', name: 'Stage', type: 'procedural', kind: 'radial-glow', params: { inner: '#fcfbf8', outer: '#ebe6df', center: [0.5, 0.34], radius: 1.1 } }];
    case 'grid': return [{ id: 'stage', name: 'Stage', type: 'procedural', kind: 'grid', params: { bg: '#fce8db', color: '#c98f6c2e', spacing: Math.round(40 * u), line: 1, fade: 0.55 } }];
    case 'cool': return [{ id: 'stage', name: 'Stage', type: 'procedural', kind: 'radial-glow', params: { inner: '#f6f7f8', outer: '#dfe3e8', center: [0.5, 0.36], radius: 1.1 } }];
    case 'dark': return [{ id: 'stage', name: 'Stage', type: 'procedural', kind: 'radial-glow', params: { inner: '#2c1208', outer: '#0b0605', center: [0.5, 0.62], radius: 0.95 } }];
    default: return [{ id: 'stage', name: 'Stage', type: 'solid', color: stage }];
  }
}

const darkStage = (stage: string | string[]) => {
  const colour = Array.isArray(stage) ? stage[0] : stage === 'dark' ? '#0b0605' : /^#[0-9a-f]{6}/i.test(stage) ? stage : '#f0f0f0';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
};

/** A cursor's label width at `size` px (Inter 600; the pill is sized before the text is measured). */
const labelWidth = (text: string, size: number) => [...text].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 0.68 : /\s/.test(ch) ? 0.28 : 0.56), 0) * size;

/**
 * Builds the product demo. Throws with the fix spelled out when the params name a part or state
 * the capture does not have. `notes` say what was adjusted (a close-up held to the capture's pixels).
 */
export function buildProductDemo(ctx: KitContext, raw: Record<string, unknown>, id = 'product-demo', recorded: Record<string, unknown> = raw): { scene: MotionScene; notes: string[] } {
  const params = raw as unknown as ProductDemoParams;
  const capture = params.capture;
  const parts = readCapture(capture);
  const notes: string[] = [];
  const W = ctx.width;
  const H = ctx.height;
  const u = Math.min(W, H) / 1080;
  const zoom = W * DEFAULT_ZOOM_RATIO;
  const fps = params.fps ?? 30;
  const names = [...parts.keys()];
  const variantIndex = Number.isInteger(params.variant) ? Math.abs(params.variant as number) : hash(capture.name ?? capture.dir ?? names.join()) % VARIANTS.length;
  const variant = VARIANTS[variantIndex % VARIANTS.length];
  const partNamed = (asked: unknown, where: string): string => {
    const want = typeof asked === 'string' ? asked.replace(/^@/, '').trim() : '';
    const found = names.find((n) => n === want) ?? names.find((n) => n.toLowerCase() === want.toLowerCase());
    if (!found) throw new Error(`${where}: no part "${want}" in the capture. Its parts: ${names.join(', ')}.`);
    return found;
  };

  // The window: the capture of the whole app when there is one (named window/app/screen…, or one
  // covering the page), else the box around every part. It fits the frame at magnification 1.
  const baseName = params.base !== undefined ? partNamed(params.base, 'base')
    : names.find((n) => BASE_NAMES.test(n)) ?? names.find((n) => area(parts.get(n)![0].boxCss) >= capture.width * capture.height * 0.85) ?? null;
  const allBoxes = [...parts.values()].flat().map((p) => p.boxCss);
  const win = baseName ? parts.get(baseName)![0].boxCss : (() => {
    const x0 = Math.min(...allBoxes.map((b) => b[0]));
    const y0 = Math.min(...allBoxes.map((b) => b[1]));
    return [x0, y0, Math.max(...allBoxes.map((b) => b[0] + b[2])) - x0, Math.max(...allBoxes.map((b) => b[1] + b[3])) - y0];
  })();
  const k = Math.min(W / win[2], H / win[3]);
  const winW = win[2] * k;
  const winH = win[3] * k;
  const winCentre: Vec = [winW / 2, winH / 2];
  const toLocal = (box: number[]): Box => ({ x: (box[0] - win[0]) * k, y: (box[1] - win[1]) * k, w: box[2] * k, h: box[3] * k });
  // Closer than this and the 3x pictures go soft (the 15 s film's lesson: close-ups need pixels).
  const maxM = ((capture.scale || 2) / k) * 1.1;

  const actions = (Array.isArray(params.actions) ? params.actions : []).map((action, i) => {
    if (!action || typeof action !== 'object' || typeof action.at !== 'number' || !Number.isFinite(action.at)) throw new Error(`actions[${i}] needs at (seconds).`);
    return { ...action, index: i };
  }).sort((a, b) => a.at - b.at || a.index - b.index);
  const asked = params.explode;
  const number = (value: unknown, fallback: number, lo: number, hi: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback);
  const explode: Required<DemoExplode> | null = asked && typeof asked.at === 'number' && typeof asked.slam === 'number' && asked.slam > asked.at + 0.3
    ? { at: Math.max(0, asked.at), slam: asked.slam, depth: number(asked.depth, 1, 0.2, 3), spread: number(asked.spread, 0.075, 0, 0.3), blur: number(asked.blur, 4, 0, 16) }
    : null;
  if (asked && !explode) notes.push('explode needs at and a later slam (at least 0.3 s after); it was left out');
  const shotList = (Array.isArray(params.shots) && params.shots.length ? params.shots : [{ at: 0, wide: true }]).map((shot, i) => {
    if (!shot || typeof shot !== 'object' || typeof shot.at !== 'number') throw new Error(`shots[${i}] needs at (seconds).`);
    return shot;
  }).sort((a, b) => a.at - b.at);
  const lastMoment = Math.max(0, ...shotList.map((s) => s.at), ...actions.map((a) => Math.max(a.at, a.until ?? 0, ...(a.words ?? []))), explode ? explode.slam : 0);
  const duration = round(clamp(params.duration ?? Math.max(3, lastMoment + 1.2), 0.5, 600));

  // ── states: which picture of each part shows when ──
  const statesOf = (name: string) => parts.get(name)!;
  const pictureOf = (name: string, state: string, where: string) => {
    const found = statesOf(name).find((s) => s.state === state);
    if (!found) throw new Error(`${where}: "${name}" has no state "${state}". Its states: ${statesOf(name).map((s) => s.state).join(', ')}.`);
    return found;
  };
  const changes = new Map<string, { t: number; state: string }[]>(names.map((name) => {
    const states = statesOf(name);
    const typing = states.filter((s) => typingNumber(s.state) >= 0).sort((a, b) => typingNumber(a.state) - typingNumber(b.state));
    return [name, [{ t: 0, state: states.find((s) => RESTING.includes(s.state))?.state ?? typing[0]?.state ?? states[0].state }]];
  }));
  const flashes: { part: string; state: Picture; from: number; to: number }[] = [];
  const cues: NonNullable<MotionScene['cues']> = [];
  for (const action of actions) {
    const where = `actions[${action.index}]`;
    if (action.set) {
      const name = partNamed(action.set.part, `${where}.set`);
      pictureOf(name, action.set.state, `${where}.set`);
      changes.get(name)!.push({ t: action.at, state: action.set.state });
      cues.push({ at: round(action.at), sound: 'pop', note: `${name} ${action.set.state}` });
    }
    if (action.type !== undefined) {
      const name = partNamed(action.type, `${where}.type`);
      const typing = statesOf(name).filter((s) => typingNumber(s.state) >= 0).sort((a, b) => typingNumber(a.state) - typingNumber(b.state));
      if (typing.length < 2) throw new Error(`${where}: "${name}" has no typing states (t00, t01…): capture it with a type step that names the part.`);
      const text = action.text ?? typing[typing.length - 1].typed;
      const times = typingTimes(typing.map((s) => typingNumber(s.state)), { ...action, text });
      typing.forEach((s, i) => changes.get(name)!.push({ t: Math.max(0, times[i]), state: s.state }));
      const first = Math.max(0, times[Math.min(1, times.length - 1)]);
      cues.push({ at: round(first), sound: 'typing', duration: round(Math.max(0.15, times[times.length - 1] - first)), note: `typing in ${name}` });
    }
    if (action.click !== undefined) {
      const name = partNamed(action.click, `${where}.click`);
      const press = statesOf(name).find((s) => PRESSED.includes(s.state));
      if (press) flashes.push({ part: name, state: press, from: action.at, to: action.at + 0.2 });
      cues.push({ at: round(action.at), sound: 'click', note: `click ${name}` });
    }
    if (action.hover !== undefined) partNamed(action.hover, `${where}.hover`);
  }
  // Each part's pictures as intervals, the latest change on top: a part inside another (the send
  // button in the composer) hides once its container changes after it, since the container's newer
  // picture already shows it as it now looks.
  const rawIntervals = new Map<string, Interval[]>(names.map((name) => {
    const list = [...changes.get(name)!].sort((a, b) => a.t - b.t);
    const out: Interval[] = [];
    list.forEach((change, i) => {
      const to = i + 1 < list.length ? list[i + 1].t : duration;
      const state = pictureOf(name, change.state, name);
      const last = out[out.length - 1];
      if (last && last.state === state) last.to = to;
      else if (to - change.t > 1e-4) out.push({ state, from: change.t, to });
    });
    return [name, out];
  }));
  const firstBox = (name: string) => statesOf(name)[0].boxCss;
  const containers = new Map(names.map((name) => [name, names.filter((other) => other !== name && area(firstBox(other)) > area(firstBox(name)) && inside(firstBox(name), firstBox(other)))]));
  const intervals = new Map<string, Interval[]>(names.map((name) => [name, rawIntervals.get(name)!.flatMap((iv) => {
    const later = containers.get(name)!.flatMap((c) => rawIntervals.get(c)!.map((x) => x.from)).filter((t) => t > iv.from + 1e-4 && t < iv.to - 1e-4);
    const to = later.length ? Math.min(...later) : iv.to;
    return to - iv.from > 1e-3 ? [{ ...iv, to }] : [];
  })]));
  const stateAt = (name: string, t: number) => {
    const list = rawIntervals.get(name)!;
    return (list.find((iv) => t >= iv.from && t < iv.to) ?? (t < (list[0]?.from ?? 0) ? list[0] : list[list.length - 1]))?.state ?? statesOf(name)[0];
  };
  const boxAt = (name: string, t: number) => toLocal(stateAt(name, t).boxCss);

  // ── the camera: stations it lands on, with holds that breathe ──
  const wideTilt: [number, number] = params.tilt && params.tilt.length >= 2 ? [params.tilt[0], params.tilt[1]] : variant.tilt;
  const diagonal = Math.hypot(winW, winH);
  const frameSize = { width: W, height: H };
  // Tilting about the target swings the far corners at the camera: keep every corner well in front.
  const safe = (framing: Framing): Framing => {
    let tilt = framing.tilt;
    const distance = zoom / framing.m;
    const nearest = (t: [number, number]) => Math.min(...[[0, 0], [winW, 0], [winW, winH], [0, winH]].map(([x, y]) => {
      const dx = x - framing.target[0];
      const dy = y - framing.target[1];
      const rx = (t[0] * Math.PI) / 180;
      const ry = (t[1] * Math.PI) / 180;
      return distance - Math.sin(ry) * dx + Math.cos(ry) * Math.sin(rx) * dy;
    }));
    for (let i = 0; i < 12 && nearest(tilt) < distance * 0.35; i++) tilt = [tilt[0] * 0.8, tilt[1] * 0.8];
    return tilt === framing.tilt ? framing : { ...framing, tilt: [round(tilt[0]), round(tilt[1])] };
  };
  const framingOf = (shot: DemoShot, where: string): Framing => {
    const tilt = (fallback: [number, number]): [number, number] => (shot.tilt && shot.tilt.length >= 2 ? [shot.tilt[0], shot.tilt[1]] : fallback);
    if (shot.wide || shot.focus === undefined) return safe({ target: winCentre, m: clamp(shot.fill ?? WIDE_FILL, 0.2, 1.6), tilt: tilt(wideTilt) });
    const name = partNamed(shot.focus, where);
    const fill = clamp(shot.fill ?? FOCUS_FILL, 0.1, 1.2);
    const box = boxAt(name, shot.at);
    const framed = framePart(box, frameSize, fill, maxM);
    if (framed.m < fill * Math.min(W / box.w, H / box.h) - 1e-3) notes.push(`${where}: "${name}" is held at ${round(maxM)}x, as close as its ${capture.scale}x pictures stay sharp`);
    const angle = tilt([0, 0]);
    const flat = Math.abs(angle[0]) < 1 && Math.abs(angle[1]) < 1;
    return safe({ ...(shot.centre || !flat ? framed : onWindow(framed, box, frameSize, [winW, winH])), tilt: angle });
  };
  // The explode owns the camera from its start to the slam: an orbit out, then back to flat on the slam.
  type Plan = { at: number; framing: Framing; move?: number; ease: Ease };
  const plans: Plan[] = [];
  shotList.forEach((shot, i) => {
    if (explode && shot.at > explode.at && shot.at <= explode.slam) { notes.push(`shots[${i}] at ${shot.at}s falls inside the explode; the explode's own camera plays there`); return; }
    plans.push({ at: shot.at, framing: framingOf(shot, `shots[${i}]`), move: shot.move, ease: calm(shot.ease, notes, `shots[${i}]`) });
  });
  const rise = explode ? Math.min(1.5, (explode.slam - explode.at) * 0.6) : 0;
  const slamMove = explode ? Math.min(SLAM, (explode.slam - explode.at) * 0.3) : 0;
  if (explode) {
    if (!plans.length || plans[0].at > explode.at) plans.unshift({ at: 0, framing: safe({ target: winCentre, m: WIDE_FILL, tilt: wideTilt }), ease: 'cubic-in-out' });
    plans.push({ at: explode.at + rise, framing: safe({ target: winCentre, m: WIDE_FILL * 0.76, tilt: variant.orbit }), move: rise, ease: 'cubic-in-out' });
    plans.push({ at: explode.slam, framing: { target: winCentre, m: WIDE_FILL * 1.07, tilt: [0, 0] }, move: slamMove, ease: 'cubic-in' });
    plans.sort((a, b) => a.at - b.at);
  }
  const stations: Station[] = [];
  const first = plans[0];
  // The first shot settles in from a little further out, when there is room before the next move.
  const second = plans[1];
  const settleEnd = Math.min(0.9, (second ? second.at - (second.move ?? travelTime(first.framing, second.framing, diagonal)) : duration) - 0.1);
  const settle = params.settle !== false && first.at <= 0.35 && settleEnd >= 0.4;
  stations.push({ t: 0, ...first.framing, m: settle ? first.framing.m * 0.9 : first.framing.m, ease: settle ? 'cubic-out' : 'sine-in-out' });
  let arrived = 0;
  let current = first.framing;
  if (settle) {
    arrived = settleEnd;
    stations.push({ t: arrived, ...current, ease: 'sine-in-out' });
  }
  // A hold is never dead: the camera keeps a slow push (about 1.2% a second, at most 3.5%).
  const breathe = (framing: Framing, seconds: number): Framing => (seconds > 0.6 ? { ...framing, m: framing.m * (1 + Math.min(0.035, BREATHE * seconds)) } : framing);
  for (const plan of plans.slice(1)) {
    const move = plan.move ?? travelTime(current, plan.framing, diagonal);
    // A move with its own length (the explode's, or one the call timed) starts exactly then; an
    // automatic one lets the last landing hold at least 0.15 s.
    const start = Math.max(arrived + (plan.move === undefined ? 0.15 : 0), plan.at - move);
    const end = Math.max(start + 0.25, plan.at);
    if (start > arrived + 1e-3) {
      current = breathe(current, start - arrived);
      stations[stations.length - 1].ease = 'sine-in-out';
      stations.push({ t: start, ...current, ease: plan.ease });
    } else stations[stations.length - 1].ease = plan.ease;
    stations.push({ t: end, ...plan.framing, ease: 'sine-in-out' });
    // A big move is heard: a whoosh on its fastest stretch.
    if (Math.abs(Math.log(plan.framing.m / current.m)) > 0.4 || Math.hypot(plan.framing.target[0] - current.target[0], plan.framing.target[1] - current.target[1]) > diagonal * 0.2) cues.push({ at: round(start + (end - start) * 0.3), sound: 'whoosh', note: 'camera move' });
    current = plan.framing;
    arrived = end;
  }
  if (duration > arrived + 1e-3) stations.push({ t: duration, ...breathe(current, duration - arrived), ease: 'linear' });
  // The camera travels to the target on the move's ease, and dollies on the fitted one.
  const dolly = stations.map((s, i) => (i + 1 < stations.length ? dollyEase(s.ease, s.m / stations[i + 1].m) : s.ease));
  const cameraKeys: Key<Vec>[] = stations.map((s, i) => ({ t: round(s.t), v: cameraFor(s, winCentre, frameSize).position.map(round), ease: s.ease, ...(dolly[i] !== s.ease ? { easeAxes: [s.ease, s.ease, dolly[i]] } : {}) }));
  const focusKeys: Key<number>[] = stations.map((s, i) => ({ t: round(s.t), v: round(zoom / s.m), ease: dolly[i] }));
  // Cursors keep one size on screen whatever the camera does: their scale follows its distance.
  const onScreenKeys = (): Key<number>[] => stations.map((s, i) => ({ t: round(s.t), v: round(100 / s.m), ease: dolly[i] }));

  // ── the explode: each part lifts to its own depth and spreads out, then slams back ──
  const depthScale = (winW / 1920) * (explode?.depth ?? 1);
  const spread = explode?.spread ?? 0;
  const drawOrder = [...names].sort((a, b) => (a === baseName ? -1 : b === baseName ? 1 : area(firstBox(b)) - area(firstBox(a)) || names.indexOf(a) - names.indexOf(b)));
  const lift = new Map(drawOrder.filter((n) => n !== baseName).map((name, i) => [name, DEPTHS[(i + variantIndex * 2) % DEPTHS.length] * depthScale]));
  const positionOf = (name: string, centre: Vec): Vec | { k: Key<Vec>[] } => {
    const rest: Vec = [round(centre[0]), round(centre[1]), 0];
    if (!explode) return rest;
    const origin = toLocal(firstBox(name));
    const dz = name === baseName ? BACK * depthScale : lift.get(name) ?? 0;
    const dx = name === baseName ? 0 : (origin.x + origin.w / 2 - winCentre[0]) * spread;
    const dy = name === baseName ? 0 : (origin.y + origin.h / 2 - winCentre[1]) * spread;
    const out: Vec = [round(centre[0] + dx), round(centre[1] + dy), round(dz)];
    return { k: [{ t: round(explode.at), v: rest, ease: 'cubic-in-out' }, { t: round(explode.at + rise), v: out, ease: 'linear' }, { t: round(explode.slam - slamMove), v: out, ease: 'cubic-in' }, { t: round(explode.slam), v: rest }] };
  };

  // ── layers ──
  const stage = params.stage ?? (ctx.brand ? ctx.brand.colors.background : variant.stage);
  const shadow: Effect = { type: 'drop-shadow', color: darkStage(stage) ? '#000000' : '#462814', opacity: darkStage(stage) ? 45 : 30, softness: round(60 * k), distance: round(26 * k), direction: 180 };
  const join = (file: string) => (/[\\/]$/.test(capture.dir) ? `${capture.dir}${file}` : `${capture.dir}${capture.dir.includes('\\') && !capture.dir.includes('/') ? '\\' : '/'}${file}`);
  const used = new Set<string>();
  const layerId = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  const picture = (name: string, iv: Interval): Layer => {
    const box = toLocal(iv.state.boxCss);
    const topLevel = !baseName && !containers.get(name)!.length;
    return {
      id: layerId(`${idOf(name)}@${idOf(iv.state.state)}`),
      name: `${titled(name)} · ${iv.state.state}`,
      type: 'footage',
      threeD: true,
      parent: 'window',
      ...(iv.from > 1e-3 ? { in: round(iv.from) } : {}),
      ...(iv.to < duration - 1e-3 ? { out: round(iv.to) } : {}),
      source: { path: join(iv.state.file), kind: 'image', ...(iv.state.pixels ? { width: iv.state.pixels[0], height: iv.state.pixels[1] } : {}) },
      fit: 'cover',
      size: [round(box.w), round(box.h)],
      transform: { position: positionOf(name, [box.x + box.w / 2, box.y + box.h / 2]) },
      motionBlur: true,
      ...(name === baseName || topLevel ? { effects: [shadow] } : {}),
    } as Layer;
  };
  const layers: Layer[] = [...stageLayers(stage, u)];
  // The window stays where it is and only tilts; the camera does the travelling.
  const tilted = stations.some((s) => s.tilt[0] !== 0 || s.tilt[1] !== 0);
  layers.push({
    id: 'window', name: 'Window', type: 'null', threeD: true,
    transform: {
      position: [round(W / 2), round(H / 2), 0],
      anchor: [round(winCentre[0]), round(winCentre[1]), 0],
      ...(tilted ? {
        rotationX: { k: stations.map((s) => ({ t: round(s.t), v: round(s.tilt[0]), ease: s.ease })) },
        rotationY: { k: stations.map((s) => ({ t: round(s.t), v: round(s.tilt[1]), ease: s.ease })) },
      } : {}),
    },
  });
  for (const name of drawOrder) {
    for (const iv of intervals.get(name)!) layers.push(picture(name, iv));
    for (const flash of flashes.filter((f) => f.part === name)) layers.push(picture(name, { state: flash.state, from: flash.from, to: Math.min(duration, flash.to) }));
  }

  // ── cursors: arrows with name tags that travel on arcs, press and ring on every click ──
  const declared = (Array.isArray(params.cursors) ? params.cursors : []).map((c) => (typeof c === 'string' ? { id: c } : c)).filter((c): c is DemoCursor => !!c && typeof c.id === 'string');
  const defaultCursor = (declared[0]?.id ?? 'you').toLowerCase();
  type Waypoint = { arrive: number; point: Vec; press?: number };
  const paths = new Map<string, Waypoint[]>();
  for (const action of actions) {
    const who = (action.cursor ?? (action.click !== undefined || action.hover !== undefined ? defaultCursor : '')).toLowerCase();
    const target = action.click ?? action.hover ?? (action.cursor ? action.type : undefined);
    if (!who || target === undefined) continue;
    const name = partNamed(target, `actions[${action.index}]`);
    const box = boxAt(name, action.at);
    const point: Vec = [box.x + box.w / 2, box.y + box.h / 2];
    const clicks = action.click !== undefined || action.type !== undefined;
    paths.set(who, [...(paths.get(who) ?? []), { arrive: action.at - (clicks ? DWELL : 0), point, ...(clicks ? { press: action.at } : {}) }]);
  }
  const cursorIds = [...new Set([...declared.map((c) => c.id.toLowerCase()), ...paths.keys()])].filter((who) => paths.has(who));
  const tagSize = CURSOR * 0.62 * u;
  cursorIds.forEach((who, index) => {
    const own = declared.find((c) => c.id.toLowerCase() === who);
    const actor = ACTORS[who];
    const label = own?.label ?? actor?.label ?? titled(who);
    const color = own?.color ?? actor?.color ?? SPARE[index % SPARE.length];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? '#111315' : '#ffffff';
    const waypoints = paths.get(who)!;
    const key = idOf(who);
    // It flies in from just beyond the nearest edge of what the camera shows then (close up, that
    // is not the window's edge), arriving on its first target.
    const firstPoint = waypoints[0].point;
    const appear = Math.max(0, waypoints[0].arrive - 0.75);
    const view = framingAt(stations, appear);
    const half: Vec = [W / 2 / view.m, H / 2 / view.m];
    const edges = [firstPoint[0] - (view.target[0] - half[0]), view.target[0] + half[0] - firstPoint[0], firstPoint[1] - (view.target[1] - half[1]), view.target[1] + half[1] - firstPoint[1]];
    const side = edges.indexOf(Math.min(...edges));
    const beyond = 0.1 * half[0];
    const from: Vec = side === 0 ? [view.target[0] - half[0] - beyond, firstPoint[1] + half[1] * 0.25]
      : side === 1 ? [view.target[0] + half[0] + beyond, firstPoint[1] + half[1] * 0.25]
        : side === 2 ? [firstPoint[0] + half[0] * 0.2, view.target[1] - half[1] - beyond]
          : [firstPoint[0] + half[0] * 0.2, view.target[1] + half[1] + beyond];
    const arc = (a: Vec, b: Vec) => round(0.25 * variant.side * (b[0] >= a[0] ? 1 : -1));
    const keys: Key<Vec>[] = [];
    let at = appear;
    let from3: Vec = from;
    waypoints.forEach((wp, i) => {
      const travel = i === 0 ? Math.max(0.2, wp.arrive - appear) : clamp(0.3 + Math.hypot(wp.point[0] - from3[0], wp.point[1] - from3[1]) / (diagonal * 0.9), 0.3, 0.8);
      const depart = Math.max(at, wp.arrive - travel);
      if (wp.arrive - depart > 0.05) keys.push({ t: round(depart), v: [round(from3[0]), round(from3[1]), -3], ease: i === 0 ? 'expo-out' : 'cubic-in-out', arc: arc(from3, wp.point) });
      keys.push({ t: round(Math.max(depart, wp.arrive)), v: [round(wp.point[0]), round(wp.point[1]), -3] });
      at = Math.max(depart, wp.arrive) + (wp.press !== undefined ? DWELL + 0.1 : 0.05);
      from3 = wp.point;
    });
    const presses = waypoints.flatMap((wp) => (wp.press !== undefined ? [wp.press] : []));
    const cursorId = `cursor-${key}`;
    const inAt = appear > 1e-3 ? { in: round(appear) } : {};
    layers.push({ id: cursorId, name: `Cursor · ${label}`, type: 'null', threeD: true, parent: 'window', ...inAt, transform: { position: { k: keys }, scale: { k: onScreenKeys() } } });
    const arrowScale = (CURSOR * u) / 24;
    const dip: Key<number>[] = [{ t: 0, v: 100 }];
    for (const press of presses) dip.push({ t: round(press), v: 100, ease: 'cubic-out' }, { t: round(press + 0.05), v: PRESS_DIP, ease: 'sine-in-out' }, { t: round(press + 0.27), v: 100 });
    layers.push({
      id: `${cursorId}-arrow`, name: `${label} · arrow`, type: 'shape', threeD: true, parent: cursorId, ...inAt, motionBlur: true, shutter: 72,
      transform: { anchor: [2, 2, 0], position: [0, 0, 0], scale: dip.length > 1 ? { k: dip } : 100 },
      shape: { shape: 'path', bounds: [round(16 * arrowScale + 6), round(24 * arrowScale + 6)], groups: [{ kind: 'group', transform: { position: [2, 2], scale: round(arrowScale * 100) }, items: [{ kind: 'path', d: ARROW, fill: color, stroke: { paint: '#ffffff', width: 1.6, join: 'round' } }] }] },
      effects: [{ type: 'drop-shadow', color: '#000000', opacity: 35, softness: round(6 * u), distance: round(2 * u), direction: 180 }],
    } as Layer);
    // The name tag sits right of the tip and a little below, as the films placed theirs.
    const pillH = round(CURSOR * 1.05 * u);
    const pillW = round(labelWidth(label, tagSize) + pillH * 0.8);
    const pillAt: Vec = [round(CURSOR * 0.62 * u), round(CURSOR * 0.78 * u)];
    layers.push({ id: `${cursorId}-tag`, name: `${label} · tag`, type: 'shape', threeD: true, parent: cursorId, ...inAt, motionBlur: true, shutter: 72, transform: { position: [round(pillAt[0] + pillW / 2), round(pillAt[1] + pillH / 2), 0] }, shape: { shape: 'rect', size: [pillW, pillH], radius: round(pillH / 2), fill: color } } as Layer);
    layers.push({ id: `${cursorId}-label`, name: `${label} · name`, type: 'text', threeD: true, parent: cursorId, ...inAt, motionBlur: true, shutter: 72, transform: { position: [round(pillAt[0] + pillH * 0.4), round(pillAt[1] + pillH / 2), 0] }, text: { text: label, font: 'Inter', weight: 600, size: round(tagSize), color: ink, align: 'left' } });
    if (presses.length) {
      // A ring 16 → 86 px on every click, fading as it grows. It waits where the click was on a
      // holder that keeps one size on screen, as the cursor does, so a camera move under it
      // does not shrink it.
      const holder = `${cursorId}-clicks`;
      const ringIn = { in: round(Math.max(0, presses[0] - 0.02)) };
      const place: Key<Vec>[] = waypoints.filter((wp) => wp.press !== undefined).map((wp) => ({ t: round(wp.press!), v: [round(wp.point[0]), round(wp.point[1]), -2], ease: 'hold' }));
      const grow: Key<number>[] = [];
      const fade: Key<number>[] = [{ t: 0, v: 0, ease: 'hold' }];
      presses.forEach((press, i) => {
        const end = Math.min(press + 0.5, (presses[i + 1] ?? Infinity) - 0.02);
        const reached = easeAt('expo-out', (end - press) / 0.5);
        grow.push({ t: round(press), v: round((100 * RING[0]) / RING[1]), ease: 'expo-out' }, { t: round(end), v: round((100 * (RING[0] + (RING[1] - RING[0]) * reached)) / RING[1]), ease: 'hold' });
        fade.push({ t: round(press), v: 90, ease: 'expo-out' }, { t: round(end), v: round(90 * (1 - reached)), ease: 'hold' });
      });
      layers.push({ id: holder, name: `${label} · clicks`, type: 'null', threeD: true, parent: 'window', ...ringIn, transform: { position: { k: place }, scale: { k: onScreenKeys() } } });
      layers.push({ id: `${cursorId}-ring`, name: `${label} · click ring`, type: 'shape', threeD: true, parent: holder, ...ringIn, transform: { position: [0, 0, 0], scale: { k: grow }, opacity: { k: fade } }, shape: { shape: 'ellipse', size: [round(RING[1] * u), round(RING[1] * u)], fill: null, stroke: color, strokeWidth: round(3 * u) } } as Layer);
    }
  });

  // ── the slam's warm flash, the camera ──
  if (explode) {
    layers.push({ id: 'flash', name: 'Slam flash', type: 'solid', color: '#fff7eb', in: round(Math.max(0, explode.slam - 0.05)), out: round(Math.min(duration, explode.slam + 0.3)), transform: { opacity: { k: [{ t: round(explode.slam - 0.04), v: 0, ease: 'cubic-out' }, { t: round(explode.slam + 0.02), v: 55, ease: 'sine-out' }, { t: round(explode.slam + 0.22), v: 0 }] } } });
    cues.push({ at: round(explode.at), sound: 'whoosh', note: 'the window comes apart' }, { at: round(Math.max(0, explode.slam - 1)), sound: 'riser', duration: round(Math.min(1, explode.slam)), note: 'into the slam' }, { at: round(explode.slam), sound: 'impact', note: 'the window slams back' });
  }
  const camera: Layer = { id: 'camera', name: 'Camera', type: 'camera', zoom: round(zoom), transform: { position: { k: cameraKeys } } };
  if (explode) {
    // Depth of field only while the parts truly sit at different depths: the farthest about
    // `blur` px soft at the orbit, focus kept on the window's plane the whole way.
    const orbitDistance = zoom / (WIDE_FILL * 0.76);
    const off = Math.max(BACK, ...DEPTHS.map(Math.abs)) * depthScale;
    const aperture = round((2 * explode.blur) / ((off / (orbitDistance + off)) * (zoom / orbitDistance)));
    Object.assign(camera, {
      focus: { k: focusKeys },
      aperture: { k: [{ t: round(explode.at), v: 0, ease: 'cubic-in-out' }, { t: round(explode.at + rise), v: aperture, ease: 'linear' }, { t: round(explode.slam - slamMove), v: aperture, ease: 'cubic-in' }, { t: round(explode.slam), v: 0 }] },
    });
  }
  layers.push(camera);

  const built: MotionScene = {
    version: 1, width: W, height: H, duration, layers,
    motionBlur: { shutter: 120 },
    cues: cues.filter((cue) => cue.at >= 0 && cue.at < duration).sort((a, b) => a.at - b.at),
    template: { id, params: { ...recorded, variant: variantIndex } },
  };
  // Motion blur from how fast things really move: one sub-frame per 1.6 px of streak, none on a hold.
  return { scene: { ...built, motionBlur: adaptiveBlur(built, fps) }, notes };
}

/** window-explode's params as a product demo: the whole window tilted, coming apart and slamming back. */
function explodeParams(params: Record<string, unknown>): Record<string, unknown> {
  const duration = typeof params.duration === 'number' ? params.duration : 3.2;
  const at = typeof params.at === 'number' ? params.at : 0.3;
  const slam = typeof params.slam === 'number' ? params.slam : Math.max(at + 0.8, duration - 0.5);
  return { ...params, duration, shots: [{ at: 0, wide: true }], explode: { at, slam, depth: params.depth, spread: params.spread, blur: params.blur }, actions: [] };
}

const CAPTURE_PARAM = 'object — the capture_app_session manifest (create_product_demo loads it by name) (required)';

export const PRODUCT_TEMPLATES: TemplateSpec[] = [
  {
    id: 'product-demo',
    label: 'Product demo (a camera through the real app)',
    technique: 'U2.5',
    use: 'The real product doing the real thing, from a capture_app_session capture: the camera lands close on a part, named cursors (You, Bhippi, Claude…) click and type while each part changes state on its frame, then it pulls back to the whole window tilted in 3D; optionally the window comes apart and slams back on a beat. Make it with create_product_demo {capture}; params here rebuild it with new times.',
    params: {
      capture: CAPTURE_PARAM,
      shots: '{ at, focus?, wide?, fill?, tilt?, move?, centre? }[] — where the camera lands and when (a part close up, or the whole window)',
      actions: '{ at, click?|hover?|type?|set?, cursor?, until?, words?, text? }[] — what happens on screen',
      cursors: 'string[] — named cursors (you, bhippi, claude, gpt, gemini, local) or { id, label, color }',
      explode: '{ at, slam, depth?, spread?, blur? } — the window comes apart in depth and slams back on slam',
      stage: 'string — light, grid, cool, dark, none, or a colour',
      tilt: 'number[] — the wide shot tilt [rx, ry] in degrees',
      duration: 'number s',
      variant: 'number — picks the tilt side, stage and explode pattern',
    },
    seconds: 6,
    fullFrame: true,
    keepsColours: true,
    build: (ctx, params) => buildProductDemo(ctx, params).scene,
  },
  {
    id: 'window-explode',
    label: 'Window explode (the app comes apart and slams back)',
    technique: 'U3.4',
    use: 'The pre-drop move: the whole app window tilts, its captured parts float apart in depth with soft focus between them, then slam back together on the drop with a warm flash. Needs a capture_app_session capture; make it with create_product_demo {capture, template:"window-explode", at, slam}.',
    params: {
      capture: CAPTURE_PARAM,
      at: 'number s (0.3) — when the parts start to float apart',
      slam: 'number s — when they slam back together (a drop or a bar)',
      depth: 'number 0.5–2 (1) — how far apart',
      spread: 'number 0–0.2 (0.075) — how far each part moves out from the centre',
      stage: 'string — light, grid, cool, dark, none, or a colour',
      duration: 'number s (3.2)',
      variant: 'number — picks the tilt side, stage and depth pattern',
    },
    seconds: 3.2,
    fullFrame: true,
    keepsColours: true,
    build: (ctx, params) => buildProductDemo(ctx, explodeParams(params), 'window-explode', params).scene,
  },
];

/** Builds either demo template by id, with its notes (create_product_demo). */
export function buildDemoTemplate(id: 'product-demo' | 'window-explode', ctx: KitContext, params: Record<string, unknown>): { scene: MotionScene; notes: string[] } {
  return id === 'window-explode' ? buildProductDemo(ctx, explodeParams(params), 'window-explode', params) : buildProductDemo(ctx, params);
}
