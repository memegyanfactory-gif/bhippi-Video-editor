import { useEffect, useMemo, useRef } from 'react';
import { computeAppliedEffects } from '../lib/effectFilters';
import { fileSrc, type RotoCache } from '../lib/ipc';
import { effectScope, maskColor, pointsOnFrame, useMagicMaskView } from '../lib/magicMask';
import type { AppliedEffect, Clip, MagicMask } from '../lib/types';
import { keepEdges } from './edgeBlur';
import { ensureLumaFilter, loadMask, maskUrl, readRun, runOf } from './RotoPreview';

type Scoped = { fx: AppliedEffect; mask: MagicMask; outside: boolean; filter: string };

/** The SVG filter that turns a matte frame into a mask: luma → alpha, grown or shrunk, softened, inverted. */
const maskFilterId = (clipId: string, mask: MagicMask, invert: boolean) => `bhippi-mm-${clipId}-${mask.id}-${invert ? 'i' : 'n'}`;

function MaskFilter({ id, mask, invert, height }: { id: string; mask: MagicMask; invert: boolean; height: number }) {
  // Sized like the export: px at 1080 of the picture's own height.
  const grow = (mask.expand * height) / 1080;
  const soft = (mask.feather * height) / 1080 / 2;
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" />
      {Math.abs(grow) >= 0.5 && <feMorphology operator={grow > 0 ? 'dilate' : 'erode'} radius={Math.min(80, Math.abs(grow))} />}
      {soft > 0.05 && <feGaussianBlur stdDeviation={Math.min(200, soft)} edgeMode="duplicate" />}
      {invert && <feComponentTransfer><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>}
    </filter>
  );
}

/**
 * Magic Mask in the preview, over a video clip's picture:
 *   · effects limited to a mask — the frame is drawn with each effect's filter and cut to the mask
 *     (inside, or outside by inverting it), in stack order, like the export's `maskedmerge` pass.
 *     The layer's whole-clip CSS filter then applies over this canvas, as the export's stack does.
 *   · while the tool is in hand, the masks tinted in their colours and the clicks on this frame.
 */
export function MagicMaskLayer({ clip, holder, stageH, quality = 1, fps }: { clip: Clip; holder: React.RefObject<HTMLDivElement | null>; stageH: number; quality?: number; fps: number }) {
  const view = useMagicMaskView();
  const effects = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const scoped = useMemo<Scoped[]>(() => (clip.appliedEffects ?? []).flatMap((fx) => {
    if (!fx.enabled) return [];
    const scope = effectScope(clip, fx);
    if (scope.kind !== 'masked') return [];
    const css = computeAppliedEffects(clip.id, [fx], stageH * quality).cssFilters.join(' ');
    const filter = keepEdges(css || undefined).filter ?? 'none';
    return [{ fx, mask: scope.mask, outside: scope.outside, filter }];
  }), [clip, stageH, quality]);
  const showOverlay = view.overlay === clip.id && (clip.magicMasks?.length ?? 0) > 0;
  const latest = useRef({ clip, view, scoped, showOverlay, quality, fps });
  latest.current = { clip, view, scoped, showOverlay, quality, fps };
  const version = useRef(0);
  version.current++;
  const boxHeight = holder.current?.clientHeight ?? stageH;

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let drawnKey = '';
    const runs = new Map<string, RotoCache | null>();
    const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
    const scratch = document.createElement('canvas');
    const want = (url: string): HTMLImageElement | null => {
      const hit = images.get(url);
      if (hit instanceof HTMLImageElement) return hit;
      if (!hit) {
        images.set(url, 'loading');
        void loadMask(url).then((image) => { images.set(url, image); drawnKey = ''; }, () => images.set(url, 'failed'));
        while (images.size > 64) images.delete(images.keys().next().value!);
      }
      return null;
    };
    /** The matte frame of a tracked run at source time `time`, loading it (and its neighbours) as needed. */
    const matteAt = (matte: string, time: number): HTMLImageElement | null => {
      const run = runOf(matte);
      if (!runs.has(run)) {
        runs.set(run, null);
        void readRun(run).then((meta) => { runs.set(run, meta); drawnKey = ''; }, () => undefined);
        return null;
      }
      const meta = runs.get(run);
      if (!meta || !meta.frames) return null;
      const first = meta.subjects[0]?.at ?? 0;
      const index = Math.max(0, Math.min(meta.frames - 1, Math.floor((time - first) * meta.fps + 1e-5)));
      for (const ahead of [1, 2, 3]) if (index + ahead < meta.frames) want(maskUrl(matte, index + ahead));
      return want(maskUrl(matte, index));
    };
    const draw = () => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      const media = holder.current?.querySelector('video');
      const box = holder.current;
      if (!media || !box || media.readyState < 2) return;
      const now = latest.current;
      const width = Math.max(1, Math.round(box.clientWidth * now.quality));
      const height = Math.max(1, Math.round(box.clientHeight * now.quality));
      const key = `${media.currentTime}|${width}|${height}|${version.current}`;
      if (key === drawnKey) return;
      drawnKey = key;
      const time = media.currentTime;
      const sourceFrame = Math.floor(time * now.fps + 1e-6);
      const luma = ensureLumaFilter();

      const out = effects.current;
      if (out && now.scoped.length) {
        if (out.width !== width || out.height !== height) { out.width = width; out.height = height; }
        const context = out.getContext('2d');
        if (context) {
          context.globalCompositeOperation = 'copy';
          context.drawImage(media, 0, 0, width, height);
          context.globalCompositeOperation = 'source-over';
          if (scratch.width !== width || scratch.height !== height) { scratch.width = width; scratch.height = height; }
          const work = scratch.getContext('2d');
          for (const entry of now.scoped) {
            const matte = entry.mask.matte ? matteAt(entry.mask.matte, time) : null;
            if (!work || !matte) { drawnKey = ''; continue; }
            work.globalCompositeOperation = 'copy';
            work.filter = entry.filter;
            work.drawImage(out, 0, 0, width, height);
            work.globalCompositeOperation = 'destination-in';
            work.filter = `url(#${maskFilterId(now.clip.id, entry.mask, entry.mask.invert !== entry.outside)})`;
            work.drawImage(matte, 0, 0, width, height);
            work.filter = 'none';
            work.globalCompositeOperation = 'source-over';
            context.drawImage(scratch, 0, 0);
          }
          // A cut-out clip stays cut out.
          if (now.clip.rotoMatte) {
            const cut = matteAt(now.clip.rotoMatte, time);
            if (cut) {
              context.globalCompositeOperation = 'destination-in';
              context.filter = luma;
              context.drawImage(cut, 0, 0, width, height);
              context.filter = 'none';
              context.globalCompositeOperation = 'source-over';
            } else drawnKey = '';
          }
        }
      }

      const tint = overlay.current;
      if (tint) {
        if (tint.width !== width || tint.height !== height) { tint.width = width; tint.height = height; }
        const context = tint.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, width, height);
        if (!now.showOverlay) return;
        if (scratch.width !== width || scratch.height !== height) { scratch.width = width; scratch.height = height; }
        const work = scratch.getContext('2d');
        const masks = now.clip.magicMasks ?? [];
        const active = now.view.active[now.clip.id] ?? masks[0]?.id;
        masks.forEach((mask, order) => {
          const preview = now.view.preview;
          const fresh = preview && preview.clipId === now.clip.id && preview.maskId === mask.id && preview.frame === sourceFrame;
          const image = fresh ? want(fileSrc(preview.png)) : mask.matte ? matteAt(mask.matte, time) : null;
          if (fresh && !image) drawnKey = '';
          if (!work || !image) return;
          work.globalCompositeOperation = 'copy';
          work.fillStyle = maskColor(mask, order);
          work.fillRect(0, 0, width, height);
          work.globalCompositeOperation = 'destination-in';
          work.filter = `url(#${maskFilterId(now.clip.id, mask, false)})`;
          work.drawImage(image, 0, 0, width, height);
          work.filter = 'none';
          work.globalCompositeOperation = 'source-over';
          context.globalAlpha = mask.id === active ? 0.5 : 0.3;
          context.drawImage(scratch, 0, 0);
          context.globalAlpha = 1;
        });
        // The clicks on this frame, for the mask they belong to.
        for (const mask of masks) {
          for (const point of pointsOnFrame(mask, sourceFrame, now.fps)) {
            const radius = Math.max(4, Math.min(width, height) * 0.012);
            context.beginPath();
            context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
            context.fillStyle = point.mode === 'include' ? '#3ddc84' : '#ff3b5c';
            context.strokeStyle = mask.id === active ? '#ffffff' : 'rgba(255,255,255,0.5)';
            context.lineWidth = Math.max(1.5, radius / 3);
            context.fill();
            context.stroke();
          }
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [holder]);

  const filters = new Map<string, { mask: MagicMask; invert: boolean }>();
  for (const entry of scoped) filters.set(maskFilterId(clip.id, entry.mask, entry.mask.invert !== entry.outside), { mask: entry.mask, invert: entry.mask.invert !== entry.outside });
  if (showOverlay) for (const mask of clip.magicMasks ?? []) filters.set(maskFilterId(clip.id, mask, false), { mask, invert: false });
  const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } as const;
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        {[...filters].map(([id, entry]) => <MaskFilter key={id} id={id} mask={entry.mask} invert={entry.invert} height={boxHeight * quality} />)}
      </svg>
      {scoped.length > 0 && <canvas ref={effects} className="layer-media" style={fill} />}
      <canvas ref={overlay} style={fill} />
    </>
  );
}

