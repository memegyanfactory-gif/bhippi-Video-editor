// The preview cache: motion scenes rendered ahead of time into RAM, plus what the media warm-up
// (editor/previewWarm.ts) has made ready, drawn as the Timeline's render bar.
//
// A motion scene drawn live needs every one of its videos sought to the right frame and every
// matte frame loaded before the picture is whole; until they arrive the renderer leaves those
// layers out. That is the "things missing" while playing and the wait after a seek. Here each
// motion clip of the active comp is rendered in the background — its own off-screen renderer and
// media bank, so the live preview's videos are never touched — one exact frame at a time, into
// ImageBitmaps. The Program monitor shows a cached frame instantly and renders live only where
// the cache has nothing yet.
//
// Frames are keyed by the scene (a hash of its JSON and the media it resolves to) and the scene
// frame, not by the clip: moving, trimming or retiming a clip keeps every frame it still shows,
// and editing a scene drops only that scene's frames. Work runs at idle priority, nearest the
// playhead first (ahead weighs more than behind), pauses while the user scrubs, and stays inside a
// RAM budget, evicting the frames furthest from the playhead.
//
// Framework-free like jobsStore.ts: React reads it through useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { MotionRenderer } from '../motion/gl/renderer';
import { editorMediaHost } from '../motion/host';
import type { MediaHost } from '../motion/sources';
import type { MotionScene } from '../motion/types';
import type { StackGroup } from './motionStack';
import { playhead } from './playhead';
import { clipEnd, sourceTimeAt } from './timeline';
import type { Asset, Clip, Comp } from './types';

// ───────────────────────────── pure logic (unit-tested) ─────────────────────────────

/** 53-bit FNV-1a-style string hash (two 32-bit lanes), as base-36. */
export function hashString(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}${((b >>> 0) & 0x1fffff).toString(36)}`;
}

const sceneHashes = new WeakMap<MotionScene, { hash: string; ids: string[]; paths: string[]; last?: { assets: ReadonlyMap<string, Asset>; key: string } }>();

/** Asset ids and file paths a scene's footage refers to (precomps included). */
function sceneMedia(json: string): { ids: string[]; paths: string[] } {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const match of json.matchAll(/"(asset|path|matte)":"((?:[^"\\]|\\.)*)"/g)) (match[1] === 'asset' ? ids : paths).add(match[2]);
  return { ids: [...ids], paths: [...paths] };
}

/**
 * What a scene's frames depend on: its JSON and the files its footage resolves to (a proxy
 * finishing, or media relinked, changes the picture without changing the scene).
 */
export function sceneKeyOf(scene: MotionScene, assets: ReadonlyMap<string, Asset>): string {
  let entry = sceneHashes.get(scene);
  if (!entry) {
    const json = JSON.stringify(scene);
    entry = { hash: hashString(json), ...sceneMedia(json) };
    sceneHashes.set(scene, entry);
  }
  if (entry.last?.assets === assets) return entry.last.key;
  const media = entry.ids.map((id) => {
    const asset = assets.get(id);
    return asset ? `${asset.proxy ?? asset.path}|${asset.missing ? 0 : 1}|${asset.preview ?? ''}` : '-';
  });
  const key = media.length ? `${entry.hash}.${hashString(media.join('\n'))}` : entry.hash;
  entry.last = { assets, key };
  return key;
}

/** Scene seconds a motion clip shows at comp time `t` (as the Compositor computes it). */
export function sceneTimeAt(clip: Clip, sceneDuration: number, t: number): number {
  return Math.max(0, Math.min(sceneDuration - 1e-3, sourceTimeAt(clip, Math.min(t, clipEnd(clip) - 1e-3))));
}

/** The cached frame index for a scene time. */
export const sceneFrameOf = (sceneTime: number, fps: number) => Math.max(0, Math.round(sceneTime * fps + 1e-6));

/** A motion clip of the active comp as the cache plans it: one scene frame per comp frame. */
export type PlanClip = {
  clipId: string;
  key: string;
  scene: MotionScene;
  /** First comp frame the clip covers. */
  first: number;
  /** Scene frame shown at comp frame `first + i`. */
  frames: Int32Array;
};

/**
 * Top-level motion pictures of `comp` that draw (enabled, on a visible track), frame by frame: each
 * fused layer stack as one scene on comp time (lib/motionStack.ts), and every other motion clip
 * with the scene it draws (`sceneOf` resolves a layer clip drawing on its own).
 */
export function planComp(comp: Comp, keyOf: (scene: MotionScene) => string, options: { groups?: StackGroup[]; sceneOf?: (clip: Clip) => MotionScene } = {}): PlanClip[] {
  const fps = comp.fps;
  const hidden = new Set(comp.tracks.filter((track) => track.hidden || track.kind !== 'video').map((track) => track.id));
  const plan: PlanClip[] = [];
  const grouped = new Set<string>();
  for (const group of options.groups ?? []) {
    for (const clip of group.clips) grouped.add(clip.id);
    const first = Math.ceil(group.start * fps - 1e-6);
    const last = Math.ceil(group.end * fps - 1e-6);
    const count = Math.max(0, last - first);
    const frames = new Int32Array(count);
    // Comp time is the stack's scene time.
    for (let i = 0; i < count; i++) frames[i] = sceneFrameOf(Math.max(0, Math.min(group.scene.duration - 1e-3, (first + i) / fps)), fps);
    plan.push({ clipId: group.key, key: keyOf(group.scene), scene: group.scene, first, frames });
  }
  for (const clip of comp.clips) {
    if (!clip.enabled || clip.adjustment || clip.source.type !== 'motion' || hidden.has(clip.trackId) || grouped.has(clip.id)) continue;
    const scene = options.sceneOf?.(clip) ?? clip.source.scene;
    const first = Math.ceil(clip.start * fps - 1e-6);
    const last = Math.ceil(clipEnd(clip) * fps - 1e-6);
    const count = Math.max(0, last - first);
    const frames = new Int32Array(count);
    for (let i = 0; i < count; i++) frames[i] = sceneFrameOf(sceneTimeAt(clip, scene.duration, (first + i) / fps), fps);
    plan.push({ clipId: clip.id, key: keyOf(scene), scene, first, frames });
  }
  return plan;
}

/** How far a comp frame is from the playhead for scheduling and eviction: behind costs 3×. */
export function frameDistance(compFrame: number, playheadFrame: number): number {
  const d = compFrame - playheadFrame;
  return d >= 0 ? d : -d * 3;
}

export type Pick = { clip: PlanClip; index: number; compFrame: number; sceneFrame: number };

/**
 * The next frame to render: the nearest uncached one, in chunks of `chunk` comp frames rendered
 * front to back (a video decodes forward cheaply; hopping around the playhead would seek it back
 * and forth). `skip` holds frames that should not be tried now.
 */
export function pickNext(plan: PlanClip[], has: (key: string, sceneFrame: number) => boolean, playheadFrame: number, chunk = 15, skip?: (key: string, sceneFrame: number) => boolean): Pick | null {
  let best: Pick | null = null;
  let bestScore = Infinity;
  for (const clip of plan) {
    for (let start = 0; start < clip.frames.length; start += chunk) {
      const chunkFrame = clip.first + start;
      const end = Math.min(clip.frames.length, start + chunk);
      // A chunk the playhead is inside scores 0; others by their nearest edge.
      const score = playheadFrame >= chunkFrame && playheadFrame < clip.first + end ? 0 : Math.min(frameDistance(chunkFrame, playheadFrame), frameDistance(clip.first + end - 1, playheadFrame));
      if (score >= bestScore) continue;
      // Inside the chunk, start at the playhead when it is there (the frame being looked at first).
      const from = score === 0 ? Math.max(start, playheadFrame - clip.first) : start;
      for (let pass = 0; pass < 2; pass++) {
        const lo = pass === 0 ? from : start;
        const hi = pass === 0 ? end : from;
        let found = -1;
        for (let i = lo; i < hi; i++) {
          const frame = clip.frames[i];
          if (!has(clip.key, frame) && !skip?.(clip.key, frame)) { found = i; break; }
        }
        if (found >= 0) {
          best = { clip, index: found, compFrame: clip.first + found, sceneFrame: clip.frames[found] };
          bestScore = score;
          break;
        }
      }
    }
  }
  return best;
}

export type CacheEntry = { key: string; frame: number; bitmap: ImageBitmap | null; width: number; height: number; bytes: number; scale: number; lastUsed: number };

/** Cached frames with a byte count, dropped by scene or by distance from the playhead. */
export class FrameStore {
  private entries = new Map<string, CacheEntry>();
  private byScene = new Map<string, Set<number>>();
  bytes = 0;

  static id = (key: string, frame: number) => `${key}#${frame}`;

  get size() { return this.entries.size; }
  get(key: string, frame: number): CacheEntry | undefined { return this.entries.get(FrameStore.id(key, frame)); }
  has(key: string, frame: number): boolean { return this.entries.has(FrameStore.id(key, frame)); }
  scenes(): string[] { return [...this.byScene.keys()]; }
  framesOf(key: string): ReadonlySet<number> { return this.byScene.get(key) ?? new Set(); }

  put(entry: CacheEntry) {
    const id = FrameStore.id(entry.key, entry.frame);
    const old = this.entries.get(id);
    if (old) this.remove(old);
    this.entries.set(id, entry);
    this.bytes += entry.bytes;
    let frames = this.byScene.get(entry.key);
    if (!frames) this.byScene.set(entry.key, (frames = new Set()));
    frames.add(entry.frame);
  }

  private remove(entry: CacheEntry) {
    this.entries.delete(FrameStore.id(entry.key, entry.frame));
    this.bytes -= entry.bytes;
    const frames = this.byScene.get(entry.key);
    frames?.delete(entry.frame);
    if (frames && !frames.size) this.byScene.delete(entry.key);
    entry.bitmap?.close();
  }

  delete(key: string, frame: number) {
    const entry = this.get(key, frame);
    if (entry) this.remove(entry);
  }

  /** Drops every frame of the scenes `keep` does not list; returns how many went. */
  retain(keep: ReadonlySet<string>): number {
    let dropped = 0;
    for (const key of [...this.byScene.keys()]) {
      if (keep.has(key)) continue;
      for (const frame of [...(this.byScene.get(key) ?? [])]) { this.delete(key, frame); dropped++; }
    }
    return dropped;
  }

  /**
   * Evicts the entry with the highest `score` (furthest from the playhead; Infinity for frames
   * nothing needs now) while over `budget` bytes, or while an incoming frame scoring `incoming`
   * needs `room` bytes. Returns false when the incoming frame is itself the furthest (no room).
   */
  makeRoom(budget: number, room: number, incoming: number, score: (entry: CacheEntry) => number): boolean {
    while (this.bytes + room > budget && this.entries.size) {
      let worst: CacheEntry | null = null;
      let worstScore = -Infinity;
      for (const entry of this.entries.values()) {
        const s = score(entry);
        if (s > worstScore || (s === worstScore && worst && entry.lastUsed < worst.lastUsed)) { worst = entry; worstScore = s; }
      }
      if (!worst || worstScore <= incoming) return this.bytes + room <= budget;
      this.remove(worst);
    }
    return this.bytes + room <= budget;
  }

  clear() {
    for (const entry of [...this.entries.values()]) this.remove(entry);
  }
}

export type SpanState = 'ready' | 'pending';
export type Span = { start: number; end: number; state: SpanState };
/** A stretch of the timeline the media warm-up covers, and whether it is ready. */
export type WarmSpan = { start: number; end: number; ready: boolean };

const NONE = 0;
const READY = 1;
const PENDING = 2;

/**
 * The render bar: per comp frame, ready where everything needed there is cached or warmed,
 * pending where something is still to do, nothing where nothing is needed; merged into spans.
 */
export function cacheSpans(plan: PlanClip[], has: (key: string, sceneFrame: number) => boolean, warm: WarmSpan[], fps: number, frames: number, due: (compFrame: number) => boolean = () => true): Span[] {
  const n = Math.max(0, Math.ceil(frames));
  const state = new Uint8Array(n);
  const mark = (i: number, value: number) => { if (i >= 0 && i < n && state[i] !== PENDING) state[i] = value === PENDING ? PENDING : Math.max(state[i], value); };
  for (const clip of plan) for (let i = 0; i < clip.frames.length; i++) {
    const at = clip.first + i;
    if (has(clip.key, clip.frames[i])) mark(at, READY);
    else if (due(at)) mark(at, PENDING);
  }
  for (const span of warm) {
    const a = Math.max(0, Math.ceil(span.start * fps - 1e-6));
    const b = Math.min(n, Math.ceil(span.end * fps - 1e-6));
    for (let i = a; i < b; i++) mark(i, span.ready ? READY : PENDING);
  }
  const spans: Span[] = [];
  let i = 0;
  while (i < n) {
    const value = state[i];
    let j = i + 1;
    while (j < n && state[j] === value) j++;
    if (value !== NONE) spans.push({ start: i / fps, end: j / fps, state: value === READY ? 'ready' : 'pending' });
    i = j;
  }
  return spans;
}

/** Cache render scales: the smallest one at least as sharp as the view, capped at half size. */
const SCALES = [0.125, 0.25, 1 / 3, 0.5];
export const MAX_CACHE_SCALE = 0.5;
export function cacheScale(viewPixels: number, sceneWidth: number): number {
  const needed = viewPixels / Math.max(1, sceneWidth);
  return SCALES.find((scale) => scale >= needed - 1e-6) ?? MAX_CACHE_SCALE;
}

// ───────────────────────────── the live cache (browser) ─────────────────────────────

export const DEFAULT_CACHE_MB = 1536;

type Snapshot = { enabled: boolean; compId: string | null; spans: Span[]; bytes: number; frames: number; budget: number; busy: boolean };

type Source = { comp: Comp; assets: ReadonlyMap<string, Asset>; groups: StackGroup[]; sceneOf?: (clip: Clip) => MotionScene };

const store = new FrameStore();
let enabled = true;
let budget = DEFAULT_CACHE_MB * 1024 * 1024;
let source: Source | null = null;
let plan: PlanClip[] = [];
let viewPixels = 960;
let warmSpans: WarmSpan[] = [];
let snapshot: Snapshot = { enabled, compId: null, spans: [], bytes: 0, frames: 0, budget, busy: false };
const listeners = new Set<() => void>();
/** Bumped whenever the plan changes, so a frame rendered for an old plan is not stored. */
let generation = 0;
const attempts = new Map<string, number>();
const stats = { rendered: 0, renderMs: 0, prepareMs: 0, startedAt: 0, lastFrameAt: 0, evicted: 0, invalidated: 0, runs: 0, runMs: 0, exact: 0 };

let renderer: MotionRenderer | null = null;
let rendererFailed = false;
let running = false;
let lastScrub = 0;
let publishTimer = 0;
/** How far from the playhead (frameDistance) the budget reaches; Infinity until it runs out. */
let reach = Infinity;

const fpsOf = () => source?.comp.fps ?? 30;
const keyOf = (scene: MotionScene) => sceneKeyOf(scene, source?.assets ?? new Map());

/** Frames a scale stale for the current view count as not cached for planning (they still show). */
const wanted = (key: string, frame: number) => {
  const entry = store.get(key, frame);
  return !!entry && entry.scale >= currentScale() - 1e-6;
};
const currentScale = () => cacheScale(viewPixels, source?.comp.width ?? 1920);

function publishNow() {
  publishTimer = 0;
  const fps = fpsOf();
  const frames = source ? Math.ceil(Math.max(0, ...source.comp.clips.map(clipEnd)) * fps) + 1 : 0;
  // Past what the budget holds nothing is going to be cached: no bar there, not a yellow one.
  const head = Math.round(playhead.get() * fps);
  const spans = enabled && source ? cacheSpans(plan, wanted, warmSpans, fps, frames, (at) => frameDistance(at, head) < reach) : [];
  const next: Snapshot = { enabled, compId: source?.comp.id ?? null, spans, bytes: store.bytes, frames: store.size, budget, busy: running };
  const same = snapshot.enabled === next.enabled && snapshot.compId === next.compId && snapshot.bytes === next.bytes && snapshot.busy === next.busy && snapshot.budget === next.budget
    && snapshot.spans.length === next.spans.length && snapshot.spans.every((span, i) => span.start === next.spans[i].start && span.end === next.spans[i].end && span.state === next.spans[i].state);
  if (same) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** Coalesces bar updates to a few a second. */
function publish(soon = false) {
  if (publishTimer) return;
  publishTimer = window.setTimeout(publishNow, soon ? 16 : 250);
}

function getRenderer(): MotionRenderer | null {
  if (renderer?.gl.lost) {
    // The context is gone (driver reset, the context cap): start over on a fresh one.
    try { renderer.dispose(); } catch { /* already gone with its context */ }
    renderer = null;
    store.clear();
    attempts.clear();
    publish();
  }
  if (renderer || rendererFailed) return renderer;
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    const host: MediaHost = {
      resolve: (footage) => editorMediaHost((source?.assets ?? new Map()) as Map<string, Asset>, 'preview').resolve(footage),
      matte: (path) => editorMediaHost([], 'preview').matte(path),
      file: (path) => editorMediaHost([], 'preview').file!(path),
    };
    renderer = new MotionRenderer(canvas, host);
  } catch {
    rendererFailed = true;
  }
  return renderer;
}

const idle = (fn: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 250 });
  else window.setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 16);
};

function kick() {
  if (running || !enabled || !source || !plan.length || typeof window === 'undefined') return;
  running = true;
  if (!stats.startedAt) stats.startedAt = performance.now();
  publish();
  idle(step);
}

function stop() {
  running = false;
  publish();
}

async function step(deadline: { timeRemaining(): number; didTimeout: boolean }) {
  if (!enabled || !source) return stop();
  const now = performance.now();
  // Scrubbing: the live preview needs the machine; resume shortly after it stops.
  if (now - lastScrub < 300) { window.setTimeout(() => idle(step), 300); return; }
  // Playing: only in real idle time, so a frame of work never lands on a frame of playback.
  if (playhead.isPlaying() && !deadline.didTimeout && deadline.timeRemaining() < 6) { idle(step); return; }
  const fps = fpsOf();
  const head = Math.round(playhead.get() * fps);
  const next = pickNext(plan, wanted, head, 15, (key, frame) => (attempts.get(FrameStore.id(key, frame)) ?? 0) >= 3);
  if (!next) return stop();
  const scale = currentScale();
  if (!roomFor(next.clip.scene, scale, next.compFrame, head)) { reach = frameDistance(next.compFrame, head); return stop(); }
  reach = Infinity;
  const r = getRenderer();
  if (!r) return stop();
  const videos = r.bank.videosAt(next.clip.scene, next.sceneFrame / fps);
  // While the program plays, only work that fits in the idle time left (a heavy scene draws for
  // 90 ms: a dropped frame of playback) and no footage (its videos would decode alongside the
  // live ones); the rest waits for the pause.
  if (playhead.isPlaying() && (videos.length || (drawCost.get(next.clip.key) ?? 20) > deadline.timeRemaining())) {
    window.setTimeout(() => idle(step), 250);
    return;
  }
  try {
    // Footage: an exact seek per frame costs a decode from the last keyframe (~300 ms a frame on
    // a long-GOP camera file), so a stretch of frames is captured from the videos playing instead.
    if (videos.length && videos.every((video) => !video.remapped)) await captureRun(r, next, scale, head);
    else await renderExact(r, next.clip.key, next.clip.scene, next.sceneFrame, scale);
  } catch {
    attempts.set(FrameStore.id(next.clip.key, next.sceneFrame), 3);
  }
  idle(step);
}

/** Frees room for one more frame of `scene`; false when every cached frame is nearer the playhead. */
function roomFor(scene: MotionScene, scale: number, compFrame: number, head: number): boolean {
  const bytes = Math.max(1, Math.round(scene.width * scale)) * Math.max(1, Math.round(scene.height * scale)) * 4;
  return store.makeRoom(budget, bytes, frameDistance(compFrame, head), (entry) => distanceOf(entry, head));
}

/** Moves the renderer's current frame into the cache (or counts a try when media was missing). */
async function keep(r: MotionRenderer, key: string, frame: number, scale: number, began: number, prepared: number): Promise<boolean> {
  const id = FrameStore.id(key, frame);
  const tries = (attempts.get(id) ?? 0) + 1;
  // A frame whose footage or matte did not arrive (or whose context was lost) is never kept: it
  // is tried again later, and after a few tries the live render shows that moment instead.
  if (r.incomplete > 0) { attempts.set(id, tries); return false; }
  const canvas = r.canvas;
  let bitmap: ImageBitmap;
  try {
    bitmap = 'transferToImageBitmap' in canvas ? (canvas as OffscreenCanvas).transferToImageBitmap() : await createImageBitmap(canvas);
  } catch {
    attempts.set(id, tries);
    return false;
  }
  attempts.delete(id);
  store.put({ key, frame, bitmap, width: bitmap.width, height: bitmap.height, bytes: bitmap.width * bitmap.height * 4, scale, lastUsed: performance.now() });
  stats.rendered++;
  stats.prepareMs += prepared - began;
  stats.renderMs += performance.now() - prepared;
  stats.lastFrameAt = performance.now();
  publish();
  return true;
}

/** One frame with every video sought exactly: scenes without footage (no seeks at all) or remapped footage. */
async function renderExact(r: MotionRenderer, key: string, scene: MotionScene, frame: number, scale: number) {
  const fps = fpsOf();
  const gen = generation;
  const t = frame / fps;
  const began = performance.now();
  stats.exact++;
  await within(r.bank.prepareExact(scene, t, { presented: false }));
  const prepared = performance.now();
  if (gen !== generation || !enabled) return;
  r.draw(scene, t, { scale, fps, motionBlur: true });
  noteCost(key, performance.now() - prepared);
  await keep(r, key, frame, scale, began, prepared);
}

/** How long a frame of each scene takes to draw (moving average), to keep playback smooth. */
const drawCost = new Map<string, number>();
const noteCost = (key: string, ms: number) => drawCost.set(key, (drawCost.get(key) ?? ms) * 0.7 + ms * 0.3);

/** Media that never loads must not stall the cache: after `ms` the frame is drawn with what arrived. */
const within = (work: Promise<unknown>, ms = 8000) => Promise.race([work, new Promise((resolve) => setTimeout(resolve, ms))]);

/** The most frames one capture run records before the scheduler looks around again. */
const RUN_FRAMES = 90;
let holder: HTMLDivElement | null = null;

/**
 * The media time of the next frame a playing video presents (its current time when the browser
 * has no frame callback); null when nothing came within `ms`.
 */
function nextFrame(el: HTMLVideoElement, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: number | null) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(el.paused || el.ended ? null : el.currentTime), ms);
    const video = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback((_, meta) => finish(meta.mediaTime));
    else setTimeout(() => finish(el.currentTime), 1000 / 60);
  });
}

/**
 * Records a stretch of a footage scene the way it plays: after one exact seek its videos run at
 * normal speed and every frame the lead video presents is drawn and kept. The timing comes from
 * that video (a media-driven clock, like the Program monitor's), the other videos follow it the
 * way the live preview's do, and every matte frame of the stretch is loaded before it starts.
 */
async function captureRun(r: MotionRenderer, pick: Pick, scale: number, head: number) {
  const fps = fpsOf();
  const { clip } = pick;
  const { key, scene } = clip;
  const targets = new Set<number>();
  for (let i = pick.index; i < clip.frames.length && targets.size < RUN_FRAMES; i++) {
    const frame = clip.frames[i];
    if (wanted(key, frame)) { if (targets.size) break; continue; }
    targets.add(frame);
  }
  const lastFrame = Math.max(...targets);
  const t0 = pick.sceneFrame / fps;
  const gen = generation;
  const aborted = () => gen !== generation || !enabled || performance.now() - lastScrub < 300 || playhead.isPlaying();
  const began = performance.now();
  stats.runs++;
  await within(r.bank.prepareExact(scene, t0, { presented: false }));
  await within(r.bank.loadMattes(scene, t0, lastFrame / fps, fps));
  if (aborted()) return;
  r.draw(scene, t0, { scale, fps, motionBlur: true });
  await keep(r, key, pick.sceneFrame, scale, began, performance.now());
  // The clock is the video with the most left to play: one that runs out mid-run would stop.
  const left = (el: HTMLVideoElement) => (Number.isFinite(el.duration) ? el.duration - el.currentTime : Infinity);
  const videos = r.bank.videosAt(scene, t0);
  const lead = [...videos].sort((a, b) => left(b.el) - left(a.el))[0];
  if (!lead || aborted()) return;
  // In the page (invisibly), so the browser presents their frames and calls back for each one.
  if (!holder) {
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(holder);
  }
  for (const { el } of videos) if (el.parentNode !== holder) { el.style.cssText = 'width:2px;height:2px'; holder.appendChild(el); }
  const m0 = lead.el.currentTime;
  // The videos run slower than real time when a frame takes longer to draw than it lasts, so
  // none is skipped (a skipped frame would cost an exact seek later).
  let drawMs = 1000 / fps / 2;
  const rate = () => Math.max(0.1, Math.min(1, 1000 / fps / (drawMs * 1.4)));
  r.bank.syncPreview(scene, t0, true, rate());
  let stalls = 0;
  let lastMedia = -1;
  let last = pick.sceneFrame;
  let lastT = t0;
  /** Presented frames that gave nothing to keep; a run that keeps nothing for long is over. */
  let barren = 0;
  try {
    while (!aborted()) {
      const media = await nextFrame(lead.el, 250);
      // Nothing new for a while (the video stalled, or ended): give up the run, not the thread.
      if (media === null || media === lastMedia) {
        if (++stalls > 12) break;
        r.bank.syncPreview(scene, last / fps, true, rate());
        continue;
      }
      stalls = 0;
      lastMedia = media;
      const t = t0 + (media - m0) / Math.max(1e-3, lead.speed);
      // Past the stretch, or the clock jumped back (the video looped or was sought): done.
      if (t > (lastFrame + 0.5) / fps || t < lastT - 1 / fps || ++barren > 60) break;
      lastT = t;
      r.bank.syncPreview(scene, t, true, rate());
      const frame = sceneFrameOf(t, fps);
      if (frame === last || !targets.has(frame) || wanted(key, frame)) continue;
      last = frame;
      const at = pick.compFrame + (frame - pick.sceneFrame);
      if (!roomFor(scene, scale, at, head)) { reach = frameDistance(at, head); break; }
      const start = performance.now();
      r.draw(scene, frame / fps, { scale, fps, motionBlur: true });
      if (await keep(r, key, frame, scale, start, start)) barren = 0;
      drawMs = drawMs * 0.7 + (performance.now() - start) * 0.3;
      noteCost(key, performance.now() - start);
    }
  } finally {
    r.bank.pauseAll();
    stats.runMs += performance.now() - began;
  }
}

/** Where a cached frame sits relative to the playhead (Infinity when no clip shows it now). */
let placement = new Map<string, number>();
function distanceOf(entry: CacheEntry, head: number): number {
  const at = placement.get(FrameStore.id(entry.key, entry.frame));
  return at === undefined ? Infinity : frameDistance(at, head);
}

function replan() {
  if (!source) { plan = []; placement = new Map(); return; }
  plan = planComp(source.comp, keyOf, { groups: source.groups, sceneOf: source.sceneOf });
  placement = new Map();
  const head = Math.round(playhead.get() * fpsOf());
  for (const clip of plan) for (let i = 0; i < clip.frames.length; i++) {
    const id = FrameStore.id(clip.key, clip.frames[i]);
    const at = clip.first + i;
    const prev = placement.get(id);
    if (prev === undefined || frameDistance(at, head) < frameDistance(prev, head)) placement.set(id, at);
  }
}

let lastKick = 0;
playhead.subscribe(() => {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (!playhead.isPlaying()) lastScrub = now;
  // The playhead moved on: frames that did not fit the budget, or were all done, may be due now.
  if (!running && now - lastKick > 500) { lastKick = now; kick(); }
});

export const previewCache = {
  /** Turns the cache on or off and sets its RAM budget (megabytes). */
  configure(options: { enabled?: boolean; budgetMb?: number }) {
    if (options.enabled !== undefined && options.enabled !== enabled) {
      enabled = options.enabled;
      if (!enabled) { store.clear(); attempts.clear(); }
    }
    if (options.budgetMb !== undefined && Number.isFinite(options.budgetMb)) {
      budget = Math.max(64, options.budgetMb) * 1024 * 1024;
      reach = Infinity;
      const head = Math.round(playhead.get() * fpsOf());
      store.makeRoom(budget, 0, -1, (entry) => distanceOf(entry, head));
    }
    publish(true);
    kick();
  },
  /**
   * The comp the Program monitor shows. Frames of scenes no clip in the project uses any more
   * are dropped (an edited scene has a new key); everything else is kept.
   */
  setSource(comp: Comp | undefined, assets: ReadonlyMap<string, Asset>, allScenes: MotionScene[], stack: { groups?: StackGroup[]; sceneOf?: (clip: Clip) => MotionScene } = {}) {
    source = comp ? { comp, assets, groups: stack.groups ?? [], sceneOf: stack.sceneOf } : null;
    generation++;
    reach = Infinity;
    const keep = new Set(allScenes.map((scene) => sceneKeyOf(scene, assets)));
    const dropped = store.retain(keep);
    if (dropped) stats.invalidated += dropped;
    for (const id of [...attempts.keys()]) if (!keep.has(id.slice(0, id.lastIndexOf('#')))) attempts.delete(id);
    replan();
    publish(true);
    kick();
  },
  /** Device pixels across the Program monitor's picture: sets the cache's render scale. */
  setView(pixels: number) {
    if (!Number.isFinite(pixels) || pixels <= 0 || Math.abs(pixels - viewPixels) < 1) return;
    const before = currentScale();
    viewPixels = pixels;
    if (currentScale() !== before) { publish(true); kick(); }
  },
  /** What the media warm-up has made ready (or is still preparing), for the bar. */
  setWarm(spans: WarmSpan[]) {
    warmSpans = spans;
    publish();
  },
  /** The cached picture of `scene` at scene seconds `time`, if there is one. */
  lookup(scene: MotionScene, assets: ReadonlyMap<string, Asset>, time: number, fps: number): CacheEntry | null {
    if (!enabled) return null;
    const entry = store.get(sceneKeyOf(scene, assets), sceneFrameOf(time, fps));
    if (!entry?.bitmap) return null;
    entry.lastUsed = performance.now();
    return entry;
  },
  /** Whether frames from `from` to `to` scene seconds are all cached (so the live bank may rest). */
  covers(scene: MotionScene, assets: ReadonlyMap<string, Asset>, from: number, to: number, fps: number): boolean {
    if (!enabled) return false;
    const key = sceneKeyOf(scene, assets);
    const a = sceneFrameOf(Math.min(from, to), fps);
    const b = sceneFrameOf(Math.min(Math.max(from, to), scene.duration - 1e-3), fps);
    for (let f = a; f <= b; f++) if (!store.has(key, f)) return false;
    return true;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: () => snapshot,
  /** Numbers for profiling. */
  stats() {
    const elapsed = stats.lastFrameAt && stats.startedAt ? (stats.lastFrameAt - stats.startedAt) / 1000 : 0;
    const needed = plan.reduce((sum, clip) => sum + clip.frames.length, 0);
    let covered = 0;
    for (const clip of plan) for (const frame of clip.frames) if (store.has(clip.key, frame)) covered++;
    return {
      frames: store.size, mb: Math.round(store.bytes / 1048576), budgetMb: Math.round(budget / 1048576), scale: currentScale(),
      rendered: stats.rendered, fillFps: elapsed > 0 ? +(stats.rendered / elapsed).toFixed(1) : 0,
      avgPrepareMs: stats.rendered ? +(stats.prepareMs / stats.rendered).toFixed(1) : 0, avgDrawMs: stats.rendered ? +(stats.renderMs / stats.rendered).toFixed(1) : 0,
      planFrames: needed, planCovered: covered, invalidated: stats.invalidated, running, runs: stats.runs, runMs: Math.round(stats.runMs), exact: stats.exact,
      clips: plan.map((clip) => ({ clip: clip.clipId.slice(0, 6), at: +(clip.first / fpsOf()).toFixed(2), frames: clip.frames.length, cached: [...clip.frames].filter((frame) => store.has(clip.key, frame)).length })),
    };
  },
};

if (typeof window !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __previewCache: typeof previewCache }).__previewCache = previewCache;

/** The render bar's state; re-renders its caller a few times a second at most. */
export const usePreviewCache = () => useSyncExternalStore(previewCache.subscribe, previewCache.snapshot, previewCache.snapshot);
