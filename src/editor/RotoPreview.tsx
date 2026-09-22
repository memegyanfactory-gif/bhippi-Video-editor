import { useEffect, useRef, useState } from 'react';
import { api, fileSrc, type RotoCache } from '../lib/ipc';
import { correctedAlpha } from '../lib/rotoCorrections';
import type { RotoCorrection } from '../lib/types';
import { canvasImage } from '../lib/canvasImage';

const LUMA_FILTER_ID = 'helios-roto-luma-alpha';

/**
 * One hidden SVG filter, mounted once: alpha ← red, colour ← black. Drawn through `ctx.filter`
 * the matte PNG becomes an alpha mask on the GPU. This replaces a getImageData → per-pixel JS
 * loop → putImageData pass that ran on the main thread for every matte frame (2M iterations at
 * 1080p, ~30 times a second, per roto clip) — the single biggest cost during playback, and the
 * reason a paused timeline played smoothly for a moment after resuming: the prefetch cache had
 * filled, then starved. `sRGB` interpolation keeps the stored alpha values exact rather than
 * gamma-shifting the soft edges.
 */
function ensureLumaFilter(): string {
  if (!document.getElementById(LUMA_FILTER_ID)) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="${LUMA_FILTER_ID}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0"/></filter>`;
    document.body.appendChild(svg);
  }
  return `url(#${LUMA_FILTER_ID})`;
}

type MaskFrame = { image: HTMLImageElement; alpha?: ImageData; mask?: HTMLCanvasElement };

/** The CPU alpha copy, only when something needs the pixels (manual corrections, or a canvas with no filter support). */
function readAlpha(entry: MaskFrame): MaskFrame {
  if (entry.alpha && entry.mask) return entry;
  const mask = document.createElement('canvas');
  mask.width = entry.image.naturalWidth;
  mask.height = entry.image.naturalHeight;
  const context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) return entry;
  context.drawImage(entry.image, 0, 0);
  const alpha = context.getImageData(0, 0, mask.width, mask.height);
  for (let p = 0; p < alpha.data.length; p += 4) alpha.data[p + 3] = alpha.data[p];
  context.putImageData(alpha, 0, 0);
  entry.alpha = alpha;
  entry.mask = mask;
  return entry;
}

/** Low-resolution display of the lossless master; export retains the 16-bit alpha. */
export function RotoPreview({ matte, sourceTime, video, corrections, at, fps, quality = 1 }: { matte: string; sourceTime: number; video: React.RefObject<HTMLDivElement | null>; corrections: RotoCorrection[]; at: number; fps: number; quality?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = useRef(sourceTime);
  time.current = sourceTime;
  const edits = useRef({ corrections, at, fps });
  edits.current = { corrections, at, fps };
  // This is a manual canvas composite, not a `stageW`/`stageH`-sized DOM element, so the
  // preview-resolution control (ProgramMonitor) cannot shrink it for free the way it does the
  // rest of the picture — it has to be told the same scale explicitly, here.
  const scale = useRef(quality);
  scale.current = quality;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let metadata: RotoCache | null = null;
    const cache = new Map<number, MaskFrame>();
    const pending = new Set<number>();
    const failed = new Set<number>();
    let corrected: { index: number; corrections: RotoCorrection[]; frame: number; canvas: HTMLCanvasElement } | null = null;
    /** undefined until the first draw decides; null when this canvas cannot filter. */
    let gpu: string | null | undefined;
    /** What the canvas currently shows, so a paused frame costs nothing per tick. */
    let drawn: { time: number; index: number; frame: number; corrections: RotoCorrection[]; scale: number } | null = null;
    const parts = matte.replaceAll('\\', '/').split('/');
    const runId = parts.at(-2) ?? '';
    const folder = parts.slice(0, -1).join('/');
    setError(null);
    void api.rotoRead(runId).then(result => { if (!stopped) { metadata = result; if (!result) setError('Roto cache unavailable; run Roto again.'); } }).catch(() => { if (!stopped) setError('Cannot read Roto preview.'); });
    const fetchMask = (index: number) => {
      if (!metadata || index < 0 || index >= metadata.frames || cache.has(index) || pending.has(index) || failed.has(index) || pending.size >= 4) return;
      pending.add(index);
      const previewPath = `${folder}/preview/${String(index + 1).padStart(5, '0')}.png`.replace(/\//g, '\\');
      void canvasImage(fileSrc(previewPath)).then(image => {
        pending.delete(index);
        if (stopped) return;
        // Decoded off the main thread by the image loader; nothing is read back here.
        cache.set(index, { image });
        while (cache.size > 12) cache.delete(cache.keys().next().value!);
      }).catch(error => { pending.delete(index); failed.add(index); if (!stopped) setError(`Roto preview: ${error instanceof Error ? error.message : String(error)}`); });
    };
    const draw = () => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      const media = video.current?.querySelector('video');
      const output = canvas.current;
      if (!media || media.readyState < 2 || !output || !metadata) return;
      const first = metadata.subjects[0]?.at ?? 0;
      // Match the matte to the actual decoded picture, not a playhead ahead of a seeking decoder.
      const decodedTime = media.currentTime;
      const index = Math.max(0, Math.min(metadata.frames - 1, Math.floor((decodedTime - first) * metadata.fps + 1e-5)));
      fetchMask(index);
      for (const offset of [1, 2, 3, -1]) fetchMask(index + offset);
      const entry = cache.get(index);
      if (!entry) {
        drawn = null;
        if (failed.has(index)) {
          const context = output.getContext('2d');
          if (context) {
            context.globalCompositeOperation = 'copy';
            context.drawImage(media, 0, 0, output.width, output.height);
            context.globalCompositeOperation = 'source-over';
          }
        } else {
          output.getContext('2d')?.clearRect(0, 0, output.width, output.height);
        }
        return;
      }
      const active = edits.current;
      const activeFrame = Math.floor(active.at * active.fps + 1e-5);
      // Same decoded frame, same matte, same edits, same size: the canvas already shows it.
      if (drawn && drawn.time === decodedTime && drawn.index === index && drawn.frame === activeFrame && drawn.corrections === active.corrections && drawn.scale === scale.current) return;
      // Refresh LRU position so a held frame survives speculative prefetching.
      cache.delete(index); cache.set(index, entry);
      // Drawn at the chosen preview resolution, not the mask's own — the two drawImage calls
      // below cost proportionally to output.width * output.height, and the canvas element is
      // already CSS-stretched to 100% of its layer box regardless of its backing pixel size, so
      // this is the same free-upscale trick the rest of the picture uses.
      const outW = Math.max(1, Math.round(entry.image.naturalWidth * scale.current));
      const outH = Math.max(1, Math.round(entry.image.naturalHeight * scale.current));
      if (output.width !== outW || output.height !== outH) { output.width = outW; output.height = outH; }
      const context = output.getContext('2d');
      if (!context) return;
      if (gpu === undefined) gpu = 'filter' in context ? ensureLumaFilter() : null;
      // Composite on canvas without reading the decoded video back to the CPU each frame.
      context.globalCompositeOperation = 'copy';
      context.drawImage(media, 0, 0, output.width, output.height);
      context.globalCompositeOperation = 'destination-in';
      if (active.corrections.length) {
        // Hand-painted corrections need the pixels; this path is per corrected clip only.
        const { alpha } = readAlpha(entry);
        if (alpha) {
          if (!corrected || corrected.index !== index || corrected.corrections !== active.corrections || corrected.frame !== activeFrame) {
            const layer = document.createElement('canvas'); layer.width = alpha.width; layer.height = alpha.height;
            const pixels = new ImageData(new Uint8ClampedArray(alpha.data), alpha.width, alpha.height);
            for (let p = 0; p < pixels.data.length; p += 4) pixels.data[p + 3] = Math.round(255 * correctedAlpha(alpha.data[p] / 255, (p / 4) % alpha.width, Math.floor(p / 4 / alpha.width), alpha.width, alpha.height, active.at, active.fps, active.corrections));
            layer.getContext('2d')?.putImageData(pixels, 0, 0);
            corrected = { index, corrections: active.corrections, frame: activeFrame, canvas: layer };
          }
          context.drawImage(corrected.canvas, 0, 0, output.width, output.height);
        }
      } else if (gpu) {
        context.filter = gpu;
        context.drawImage(entry.image, 0, 0, output.width, output.height);
        context.filter = 'none';
      } else {
        const { mask } = readAlpha(entry);
        if (mask) context.drawImage(mask, 0, 0, output.width, output.height);
      }
      context.globalCompositeOperation = 'source-over';
      drawn = { time: decodedTime, index, frame: activeFrame, corrections: active.corrections, scale: scale.current };
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [matte, video]);
  return <><canvas ref={canvas} className="layer-media" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />{error && <span role="alert">{error}</span>}</>;
}
