// A motion scene in the Program monitor. One shared WebGL renderer (browsers cap live WebGL
// contexts) draws every motion clip off-screen; each clip copies its frame into its own 2D
// canvas. The same renderer code produces the export frames (src/motion/exportFrames.ts).
// Frames the preview cache (lib/previewCache.ts) has rendered ahead are shown from RAM instead.
import { useEffect, useRef, useState } from 'react';
import { editorMediaHost } from '../motion/host';
import { MotionRenderer } from '../motion/gl/renderer';
import { entryBounds } from '../motion/evaluate';
import type { MediaHost } from '../motion/sources';
import type { MotionScene } from '../motion/types';
import type { Asset } from '../lib/types';
import { previewCache } from '../lib/previewCache';

let shared: MotionRenderer | null = null;
let sharedError: string | null = null;
/** Bumped when a lost renderer is replaced, so every clip listens to the new one's bank. */
let rendererGeneration = 0;
/** The asset map the shared renderer resolves against (the latest the editor rendered with). */
let currentAssets = new Map<string, Asset>();

/** The one preview renderer. */
function previewRenderer(assets: Map<string, Asset>): MotionRenderer | null {
  currentAssets = assets;
  if (shared?.gl.lost) {
    // The GPU took the context back (driver reset, the context cap): a fresh renderer takes over.
    try { shared.dispose(); } catch { /* already gone with its context */ }
    shared = null;
    rendererGeneration++;
  }
  if (sharedError) return null;
  if (!shared) {
    try {
      const host: MediaHost = {
        resolve: (source) => editorMediaHost(currentAssets, 'preview').resolve(source),
        matte: (path) => editorMediaHost(currentAssets, 'preview').matte(path),
      };
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
      shared = new MotionRenderer(canvas, host);
    } catch (error) {
      sharedError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
  return shared;
}

/**
 * Canvas-space boxes of the layers a scene draws at `t` (visible, not hidden or a matte-only
 * copy), laid out by the preview renderer so text is measured. Empty without WebGL.
 */
export function sceneLayerBoxes(scene: MotionScene, time: number, assets: Map<string, Asset>, fps = 30): { id: string; x: number; y: number; width: number; height: number }[] {
  const renderer = previewRenderer(assets);
  if (!renderer) return [];
  try {
    const frame = renderer.evaluate(scene, time, fps);
    const matteSources = new Set(scene.layers.map((layer) => layer.matte?.layer).filter(Boolean));
    return frame.layers.flatMap((entry) => {
      const layer = entry.layer;
      if (!entry.active || entry.opacity <= 0.01 || layer.hidden || layer.ref || matteSources.has(layer.id)) return [];
      const box = entryBounds(entry.matrix, entry.size);
      return box && box.width > 0 && box.height > 0 ? [{ id: layer.id, ...box }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Gets a motion scene that appears soon ready on the live renderer (its stills, videos and matte
 * frames), without touching a video a scene on screen is using. Called by the media warm-up.
 */
export function warmMotionScene(scene: MotionScene, time: number, assets: Map<string, Asset>) {
  previewRenderer(assets)?.bank.warm(scene, time);
}

type Props = {
  scene: MotionScene;
  /** Scene seconds to show. */
  time: number;
  playing: boolean;
  rate: number;
  stageW: number;
  stageH: number;
  quality: number;
  assets: Map<string, Asset>;
  /** The comp frame rate: the preview cache's frame grid. */
  fps?: number;
};

export function MotionLayer({ scene, time, playing, rate, stageW, quality, assets, fps = 30 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(sharedError);
  const [tick, setTick] = useState(0);
  /** Whether the canvas holds a whole picture of this scene (so a half-loaded one never replaces it). */
  const shown = useRef(false);
  /** Whether the canvas shows this very moment whole; if not, a frame the cache fills in redraws it. */
  const whole = useRef(false);
  const now = useRef(time);
  now.current = time;

  // Redraw when a frame this clip was waiting for arrives (seek finished, matte loaded).
  useEffect(() => {
    const renderer = previewRenderer(assets);
    if (!renderer) return;
    let queued = false;
    return renderer.bank.listen(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; setTick((n) => n + 1); });
    });
    // A replaced renderer (its context was lost) has a new bank to listen to.
  }, [assets, rendererGeneration]);

  useEffect(() => { shown.current = false; }, [scene]);

  useEffect(() => previewCache.subscribe(() => {
    if (!whole.current && previewCache.lookup(scene, assets, now.current, fps)) setTick((n) => n + 1);
  }), [scene, assets, fps]);

  useEffect(() => {
    const out = canvas.current;
    if (!out) return;
    const blit = (source: CanvasImageSource, width: number, height: number) => {
      if (out.width !== width || out.height !== height) { out.width = width; out.height = height; }
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, out.width, out.height);
      ctx.drawImage(source, 0, 0);
      shown.current = true;
    };
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scale = Math.max(0.1, Math.min(1, (stageW * dpr * quality) / scene.width));
    // A frame rendered ahead of time (lib/previewCache.ts): shown at once. While playing it is the
    // picture; while parked it stands in until the sharper live render is whole.
    const cached = previewCache.lookup(scene, assets, time, fps);
    whole.current = false;
    if (cached?.bitmap) { blit(cached.bitmap, cached.width, cached.height); whole.current = true; }
    const renderer = previewRenderer(assets);
    if (!renderer) { if (sharedError) setError(sharedError); return; }
    const live = () => {
      try {
        renderer.draw(scene, time, { scale, fps, motionBlur: !playing || quality >= 0.75 });
        // Footage or a matte frame still loading: keep the whole picture already on screen (the
        // cached frame, or the last live one) rather than flash one with layers missing.
        if (renderer.incomplete > 0 && shown.current) return;
        const source = renderer.canvas;
        blit(source as CanvasImageSource, source.width, source.height);
        if (renderer.incomplete > 0) shown.current = false;
        else whole.current = true;
        if (error) setError(null);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    // The live bank rests while the cache covers the next half second; it wakes up in time to
    // be running where the cache runs out.
    const ahead = playing && rate > 0 ? time + 0.5 * rate : time;
    if (!cached || !previewCache.covers(scene, assets, time, ahead, fps)) renderer.bank.syncPreview(scene, time, playing, rate);
    if (!cached) return live();
    if (error) setError(null);
    if (playing || cached.scale >= scale * 0.85) return;
    // Parked on a view sharper than the cache: the cached frame paints now, the live one after.
    const later = requestAnimationFrame(live);
    return () => cancelAnimationFrame(later);
  }, [scene, time, playing, rate, stageW, quality, assets, tick, error, fps]);

  useEffect(() => { if (shared && !playing) shared.bank.pauseAll(); }, [playing]);
  // Leaving the screen: its videos stop once no other clip on screen has used them for a moment.
  useEffect(() => () => { window.setTimeout(() => shared?.bank.pauseIdle(250), 300); }, []);

  return (
    <>
      <canvas ref={canvas} className="layer-media" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {error && <span className="motion-layer-error" role="alert" style={{ position: 'absolute', left: 8, bottom: 8, color: '#ff8a9a', font: '12px system-ui' }}>Motion scene: {error}</span>}
    </>
  );
}
