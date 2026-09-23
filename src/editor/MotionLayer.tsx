// A motion scene in the Program monitor. One shared WebGL renderer (browsers cap live WebGL
// contexts) draws every motion clip off-screen; each clip copies its frame into its own 2D
// canvas. The same renderer code produces the export frames (src/motion/exportFrames.ts).
import { useEffect, useRef, useState } from 'react';
import { editorMediaHost } from '../motion/host';
import { MotionRenderer } from '../motion/gl/renderer';
import type { MediaHost } from '../motion/sources';
import type { MotionScene } from '../motion/types';
import type { Asset } from '../lib/types';

let shared: MotionRenderer | null = null;
let sharedError: string | null = null;
/** The asset map the shared renderer resolves against (the latest the editor rendered with). */
let currentAssets = new Map<string, Asset>();

/** The one preview renderer. */
function previewRenderer(assets: Map<string, Asset>): MotionRenderer | null {
  currentAssets = assets;
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
};

export function MotionLayer({ scene, time, playing, rate, stageW, quality, assets }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(sharedError);
  const [tick, setTick] = useState(0);

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
  }, [assets]);

  useEffect(() => {
    const renderer = previewRenderer(assets);
    const out = canvas.current;
    if (!renderer || !out) { if (sharedError) setError(sharedError); return; }
    try {
      renderer.bank.syncPreview(scene, time, playing, rate);
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const scale = Math.max(0.1, Math.min(1, (stageW * dpr * quality) / scene.width));
      renderer.draw(scene, time, { scale, fps: 30, motionBlur: !playing || quality >= 0.75 });
      const source = renderer.canvas;
      if (out.width !== source.width || out.height !== source.height) { out.width = source.width; out.height = source.height; }
      const ctx = out.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, out.width, out.height);
        ctx.drawImage(source as CanvasImageSource, 0, 0);
      }
      if (error) setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [scene, time, playing, rate, stageW, quality, assets, tick, error]);

  useEffect(() => { if (shared && !playing) shared.bank.pauseAll(); }, [playing]);

  return (
    <>
      <canvas ref={canvas} className="layer-media" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {error && <span className="motion-layer-error" role="alert" style={{ position: 'absolute', left: 8, bottom: 8, color: '#ff8a9a', font: '12px system-ui' }}>Motion scene: {error}</span>}
    </>
  );
}
