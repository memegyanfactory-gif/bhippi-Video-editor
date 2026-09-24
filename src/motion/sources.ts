// Footage, stills and roto mattes for motion scenes. The bank owns hidden, muted media elements;
// in the preview they run alongside the playhead, in the export every frame is sought exactly.
import type { FootageSource, Layer, MotionScene } from './types';
import { layerTime, num } from './anim';

/** What the host (the Helios editor, a test harness) knows about media. */
export type MediaHost = {
  /** URL, kind and natural size of a footage source; null when it cannot be found. */
  resolve(source: FootageSource): { url: string; kind: 'video' | 'image'; width?: number; height?: number } | null;
  /** Frame sequence of a roto matte (the clip's `rotoMatte` path). */
  matte(path: string): Promise<MatteSequence | null>;
};

export type MatteSequence = { fps: number; frames: number; /** Source seconds of frame 0. */ first: number; frameUrl: (index: number) => string };

export type FootageFrame = { image: TexImageSource; width: number; height: number; key: string };

const EXACT_SEEK_TIMEOUT = 4000;
/** An export frame gives up on footage that has not loaded (or sought) by then. */
const FOOTAGE_TIMEOUT = 20000;

/** `wait`, or a rejection naming `url` once FOOTAGE_TIMEOUT passes without it settling. */
function loaded<T>(wait: Promise<T>, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`footage ${url} did not load in 20 s`)), FOOTAGE_TIMEOUT); });
  return Promise.race([wait, late]).finally(() => clearTimeout(timer));
}

/** Source seconds a footage layer shows at scene time `t`. */
export function sourceTime(source: FootageSource, t: number): number {
  if (source.timeRemap !== undefined) return Math.max(0, num(source.timeRemap, t, 0));
  return Math.max(0, (source.in ?? 0) + t * (source.speed ?? 1));
}

/**
 * Every footage layer of a scene (precomps included) with the source time it needs at `t`, how
 * many source seconds it runs per scene second (its own speed times any time stretch above it),
 * and whether it is on screen at `t` (`active`) or only about to start or just ended (lookahead).
 */
export function footageAt(scene: MotionScene, t: number, out: { layer: Layer & { type: 'footage' }; time: number; rate: number; active: boolean }[] = [], depth = 0, rate = 1, shown = true): typeof out {
  if (depth > 6) return out;
  for (const layer of scene.layers) {
    const inWindow = t >= (layer.in ?? 0) - 0.5 && t < (layer.out ?? Infinity) + 0.1;
    if (!inWindow) continue;
    const active = shown && (layer.in ?? 0) <= t && t < (layer.out ?? Infinity);
    const lt = layerTime(layer, t);
    const stretch = rate * (layer.timeScale ?? 1);
    if (layer.type === 'footage') out.push({ layer, time: sourceTime(layer.source, lt), rate: stretch * (layer.source.speed ?? 1), active });
    else if (layer.type === 'precomp') footageAt(layer.scene, (lt - (layer.offset ?? 0)) * (layer.speed ?? 1), out, depth + 1, stretch * (layer.speed ?? 1), active);
  }
  return out;
}

type VideoEntry = { el: HTMLVideoElement; ready: Promise<void>; lastUsed: number; width: number; height: number };
type ImageEntry = { el: HTMLImageElement; ready: Promise<void>; width: number; height: number };

export class MediaBank {
  private videos = new Map<string, VideoEntry>();
  private images = new Map<string, ImageEntry>();
  private mattes = new Map<string, Promise<MatteSequence | null>>();
  private matteMeta = new Map<string, MatteSequence | null>();
  private matteFrames = new Map<string, ImageEntry>();
  private listeners = new Set<() => void>();
  private onFrame = () => { for (const listener of this.listeners) listener(); };
  /** The frame rate draws run at (the renderer sets it): a video within half a frame of the time asked for shows that time. */
  fps = 30;

  constructor(private host: MediaHost) {}

  /**
   * The footage a scene needs at `t`, resolved: layers on screen first, then the lookahead of
   * layers about to start. A lookahead entry never takes a video an on-screen layer shows at
   * another time (a razor cut of one file: the next piece must not pull the first off its frame).
   */
  private footage(scene: MotionScene, t: number) {
    const entries = footageAt(scene, t).flatMap((entry) => {
      const resolved = this.host.resolve(entry.layer.source);
      return resolved ? [{ ...entry, resolved }] : [];
    });
    const shown = entries.filter((entry) => entry.active);
    const near = 0.5 / this.fps;
    const ahead = entries.filter((entry) => !entry.active && !shown.some((on) => on.resolved.url === entry.resolved.url && Math.abs(on.time - entry.time) > near));
    return [...shown, ...ahead];
  }

  /** Called when a frame the preview was waiting for arrives (a seek finished, a matte loaded). */
  listen(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private video(url: string): VideoEntry {
    let entry = this.videos.get(url);
    if (entry) { entry.lastUsed = performance.now(); return entry; }
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.src = url;
    const ready = new Promise<void>((resolve) => {
      if (el.readyState >= 2) resolve();
      el.addEventListener('loadeddata', () => resolve(), { once: true });
      el.addEventListener('error', () => resolve(), { once: true });
    });
    entry = { el, ready, lastUsed: performance.now(), width: 0, height: 0 };
    el.addEventListener('loadedmetadata', () => { entry!.width = el.videoWidth; entry!.height = el.videoHeight; });
    el.addEventListener('seeked', () => this.onFrame());
    this.videos.set(url, entry);
    return entry;
  }

  private image(url: string, map = this.images): ImageEntry {
    let entry = map.get(url);
    if (entry) return entry;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.decoding = 'async';
    const ready = new Promise<void>((resolve) => {
      el.onload = () => { entry!.width = el.naturalWidth; entry!.height = el.naturalHeight; resolve(); this.onFrame(); };
      el.onerror = () => resolve();
    });
    el.src = url;
    entry = { el, ready, width: 0, height: 0 };
    map.set(url, entry);
    return entry;
  }

  private matteSequence(path: string): MatteSequence | null | undefined {
    if (!this.mattes.has(path)) {
      const request = this.host.matte(path).catch(() => null);
      this.mattes.set(path, request);
      void request.then((meta) => { this.matteMeta.set(path, meta); this.onFrame(); });
    }
    return this.matteMeta.has(path) ? this.matteMeta.get(path) : undefined;
  }

  private matteIndex(meta: MatteSequence, time: number) {
    return Math.max(0, Math.min(meta.frames - 1, Math.floor((time - meta.first) * meta.fps + 1e-5)));
  }

  /**
   * Preview: keeps each video near `time` (running while playing, parked on the frame while
   * paused) and starts matte loads. Never waits.
   */
  syncPreview(scene: MotionScene, t: number, playing: boolean, rate: number) {
    for (const { layer, time, rate: runs, resolved } of this.footage(scene, t)) {
      if (resolved.kind === 'image') { this.image(resolved.url); continue; }
      const { el } = this.video(resolved.url);
      const speed = runs * rate;
      if (playing && rate > 0 && layer.source.timeRemap === undefined) {
        const drift = time - el.currentTime;
        if (!el.seeking && Math.abs(drift) > 0.25) el.currentTime = time;
        const nudge = Math.abs(drift) < 0.03 ? 0 : Math.max(-0.12, Math.min(0.12, drift * 0.5));
        const target = Math.min(16, Math.max(0.0625, speed * (1 + nudge)));
        if (Math.abs(el.playbackRate - target) > 1e-3) el.playbackRate = target;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - time) > 1 / 120) el.currentTime = time;
      }
      if (layer.source.matte) {
        const meta = this.matteSequence(layer.source.matte);
        if (meta) {
          const index = this.matteIndex(meta, time);
          for (let k = index; k <= index + 5; k++) if (k < meta.frames) this.image(meta.frameUrl(k), this.matteFrames);
          this.trimMattes();
        }
      }
    }
    // Videos no scene on screen asked for lately (their layer ended, their clip left): stop decoding.
    this.pauseIdle(500);
  }

  /**
   * Export: seeks every video to its exact frame and loads every matte frame, then resolves.
   * `presented: false` (the preview cache) trusts `seeked` alone: the decoded frame is already
   * uploadable then, and waiting for it to reach the compositor costs up to 120 ms a frame on
   * a video that is not in the page.
   */
  async prepareExact(scene: MotionScene, t: number, options: { presented?: boolean } = {}): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const { layer, time, resolved } of this.footage(scene, t)) {
      if (resolved.kind === 'image') { waits.push(loaded(this.image(resolved.url).ready, resolved.url)); continue; }
      const entry = this.video(resolved.url);
      waits.push(loaded(entry.ready, resolved.url).then(() => loaded(seekExact(entry.el, time, options.presented ?? true), resolved.url)));
      if (layer.source.matte) {
        const path = layer.source.matte;
        waits.push(loaded((async () => {
          if (!this.mattes.has(path)) this.matteSequence(path);
          const meta = await this.mattes.get(path)!;
          this.matteMeta.set(path, meta);
          if (!meta) return;
          const index = this.matteIndex(meta, time);
          await this.image(meta.frameUrl(index), this.matteFrames).ready;
          this.trimMattes();
        })(), path));
      }
    }
    await Promise.all(waits);
  }

  /** The videos a scene shows at `t`: each one's speed, and whether a time remap drives it (capture runs). */
  videosAt(scene: MotionScene, t: number): { el: HTMLVideoElement; speed: number; remapped: boolean }[] {
    const out: { el: HTMLVideoElement; speed: number; remapped: boolean }[] = [];
    for (const { layer, rate, resolved } of this.footage(scene, t)) {
      if (resolved.kind !== 'video') continue;
      out.push({ el: this.video(resolved.url).el, speed: rate, remapped: layer.source.timeRemap !== undefined });
    }
    return out;
  }

  /** Loads every matte frame the scene needs from `from` to `to` scene seconds (at most 90). */
  async loadMattes(scene: MotionScene, from: number, to: number, fps: number): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const seen = new Set<string>();
    for (let t = from; t <= to + 1e-6 && seen.size < 90; t += 1 / fps) {
      for (const { layer, time } of footageAt(scene, t)) {
        const path = layer.source.matte;
        if (!path) continue;
        if (!this.mattes.has(path)) this.matteSequence(path);
        const meta = await this.mattes.get(path)!;
        this.matteMeta.set(path, meta);
        if (!meta) continue;
        const url = meta.frameUrl(this.matteIndex(meta, time));
        if (seen.has(url)) continue;
        seen.add(url);
        waits.push(this.image(url, this.matteFrames).ready);
      }
    }
    await Promise.all(waits);
    this.trimMattes();
  }

  private trimMattes() {
    while (this.matteFrames.size > 128) {
      const first = this.matteFrames.keys().next().value!;
      this.matteFrames.delete(first);
    }
  }

  /** The current picture of a footage source, or null while it is loading. */
  frame(source: FootageSource, time: number): FootageFrame | null {
    const resolved = this.host.resolve(source);
    if (!resolved) return null;
    if (resolved.kind === 'image') {
      const entry = this.image(resolved.url);
      if (!entry.el.complete || !entry.width) return null;
      return { image: entry.el, width: entry.width, height: entry.height, key: resolved.url };
    }
    const entry = this.video(resolved.url);
    if (entry.el.readyState < 2 || !entry.el.videoWidth) return null;
    // The element shows another moment (another layer's, or it is still seeking): not this
    // layer's frame. A playing one runs within syncPreview's drift allowance of the playhead.
    const off = Math.abs(entry.el.currentTime - (Number.isFinite(entry.el.duration) ? Math.min(time, entry.el.duration - 1e-3) : time));
    if (entry.el.seeking || off > (entry.el.paused ? 0.5 / this.fps : 0.25)) return null;
    return { image: entry.el, width: entry.el.videoWidth, height: entry.el.videoHeight, key: `${resolved.url}@${entry.el.currentTime.toFixed(4)}` };
  }

  /** The matte frame for `time` (nearest loaded one while the exact frame loads, in preview). */
  matteFrame(path: string, time: number): FootageFrame | null {
    const meta = this.matteSequence(path);
    if (!meta) return null;
    const index = this.matteIndex(meta, time);
    const exact = this.matteFrames.get(meta.frameUrl(index));
    if (exact && exact.width) return { image: exact.el, width: exact.width, height: exact.height, key: meta.frameUrl(index) };
    this.image(meta.frameUrl(index), this.matteFrames);
    for (const k of [index - 1, index + 1, index - 2, index + 2]) {
      const near = k >= 0 ? this.matteFrames.get(meta.frameUrl(k)) : undefined;
      if (near && near.width) return { image: near.el, width: near.width, height: near.height, key: meta.frameUrl(k) };
    }
    return null;
  }

  /**
   * Gets a scene that is about to appear ready without disturbing one on screen: loads its
   * stills, opens its videos (parking an idle one on the first frame it will show) and starts
   * its matte frames. A video that is playing belongs to a scene on screen and is left alone.
   */
  warm(scene: MotionScene, t: number) {
    for (const { layer, time } of footageAt(scene, t)) {
      const resolved = this.host.resolve(layer.source);
      if (!resolved) continue;
      if (resolved.kind === 'image') { this.image(resolved.url); continue; }
      if (layer.source.matte) {
        const meta = this.matteSequence(layer.source.matte);
        if (meta) {
          const index = this.matteIndex(meta, time);
          for (let k = index; k <= index + 8 && k < meta.frames; k++) this.image(meta.frameUrl(k), this.matteFrames);
          this.trimMattes();
        }
      }
      const known = this.videos.get(resolved.url);
      // Used by a scene on screen in the last second (playing, or parked on its frame): not ours.
      if (known && (!known.el.paused || known.el.seeking || performance.now() - known.lastUsed < 1000)) continue;
      const entry = known ?? this.video(resolved.url);
      entry.lastUsed = 0;
      if (Math.abs(entry.el.currentTime - time) > 1 / 60) entry.el.currentTime = time;
    }
  }

  /** Pauses everything (the preview stopped or the layer left the screen). */
  pauseAll() {
    for (const { el } of this.videos.values()) if (!el.paused) el.pause();
  }

  /** Pauses every playing video no one has asked for in the last `ms`. */
  pauseIdle(ms: number) {
    const now = performance.now();
    for (const { el, lastUsed } of this.videos.values()) if (!el.paused && now - lastUsed > ms) el.pause();
  }

  dispose() {
    for (const { el } of this.videos.values()) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.videos.clear();
    this.images.clear();
    this.matteFrames.clear();
  }
}

/** Seeks a video to `time` and resolves once that frame is decoded and presentable. */
export function seekExact(el: HTMLVideoElement, time: number, presented = true): Promise<void> {
  if (!el.paused) el.pause();
  const target = Math.max(0, Math.min(Number.isFinite(el.duration) ? el.duration - 1e-3 : time, time));
  if (Math.abs(el.currentTime - target) < 1e-4 && el.readyState >= 2 && !el.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, EXACT_SEEK_TIMEOUT);
    const onSeeked = () => {
      el.removeEventListener('seeked', onSeeked);
      // Wait for the frame to actually be presented to the compositor when the API exists.
      const rvfc = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (rvfc && presented) {
        rvfc.call(el, () => finish());
        setTimeout(finish, 120);
      } else finish();
    };
    el.addEventListener('seeked', onSeeked);
    el.currentTime = target;
  });
}
