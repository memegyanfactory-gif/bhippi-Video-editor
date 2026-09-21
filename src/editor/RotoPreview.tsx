import { useEffect, useRef, useState } from 'react';
import { api, fileSrc, type RotoCache } from '../lib/ipc';
import { correctedAlpha } from '../lib/rotoCorrections';
import type { RotoCorrection } from '../lib/types';
import { canvasImage } from '../lib/canvasImage';

/** Low-resolution display of the lossless master; export retains the 16-bit alpha. */
export function RotoPreview({ matte, sourceTime, video, corrections, at, fps }: { matte: string; sourceTime: number; video: React.RefObject<HTMLDivElement | null>; corrections: RotoCorrection[]; at: number; fps: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = useRef(sourceTime);
  time.current = sourceTime;
  const edits = useRef({ corrections, at, fps });
  edits.current = { corrections, at, fps };
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let metadata: RotoCache | null = null;
    const cache = new Map<number, { mask: HTMLCanvasElement; alpha: ImageData }>();
    const pending = new Set<number>();
    const failed = new Set<number>();
    let corrected: { index: number; corrections: RotoCorrection[]; frame: number; canvas: HTMLCanvasElement } | null = null;
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
        const mask = document.createElement('canvas');
        mask.width = image.naturalWidth; mask.height = image.naturalHeight;
        const context = mask.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0);
        const alpha = context.getImageData(0, 0, mask.width, mask.height);
        for (let p = 0; p < alpha.data.length; p += 4) alpha.data[p + 3] = alpha.data[p];
        context.putImageData(alpha, 0, 0);
        cache.set(index, { mask, alpha });
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
      // Refresh LRU position so a held frame survives speculative prefetching.
      cache.delete(index); cache.set(index, entry);
      const { alpha } = entry;
      if (output.width !== alpha.width || output.height !== alpha.height) { output.width = alpha.width; output.height = alpha.height; }
      const context = output.getContext('2d');
      if (!context) return;
      const active = edits.current;
      let mask = entry.mask;
      const activeFrame = Math.floor(active.at * active.fps + 1e-5);
      if (active.corrections.length) {
        if (!corrected || corrected.index !== index || corrected.corrections !== active.corrections || corrected.frame !== activeFrame) {
          const layer = document.createElement('canvas'); layer.width = alpha.width; layer.height = alpha.height;
          const pixels = new ImageData(new Uint8ClampedArray(alpha.data), alpha.width, alpha.height);
          for (let p = 0; p < pixels.data.length; p += 4) pixels.data[p + 3] = Math.round(255 * correctedAlpha(alpha.data[p] / 255, (p / 4) % alpha.width, Math.floor(p / 4 / alpha.width), alpha.width, alpha.height, active.at, active.fps, active.corrections));
          layer.getContext('2d')?.putImageData(pixels, 0, 0);
          corrected = { index, corrections: active.corrections, frame: activeFrame, canvas: layer };
        }
        mask = corrected.canvas;
      }
      // Composite on canvas without reading the decoded video back to the CPU each frame.
      context.globalCompositeOperation = 'copy';
      context.drawImage(media, 0, 0, output.width, output.height);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(mask, 0, 0);
      context.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [matte, video]);
  return <><canvas ref={canvas} className="layer-media" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />{error && <span role="alert">{error}</span>}</>;
}
