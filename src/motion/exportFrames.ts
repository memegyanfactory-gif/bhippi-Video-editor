// Motion scenes for the export: each clip is rendered off-screen, frame-exact (every video sought
// to its frame, every matte frame loaded), to a PNG sequence with alpha that the FFmpeg exporter
// overlays like an HTML graphic's frames. Same renderer as the preview.
import { api } from '../lib/ipc';
import type { Asset, Clip, Comp, Project } from '../lib/types';
import { MotionRenderer } from './gl/renderer';
import { editorMediaHost } from './host';

type MotionSource = Extract<Clip['source'], { type: 'motion' }>;
export type RenderedFrames = { dir: string; fps: number; frames: number; width: number; height: number };

async function toPng(width: number, height: number, data: Uint8ClampedArray): Promise<Uint8Array> {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D canvas for PNG encoding');
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  const blob = canvas instanceof OffscreenCanvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders one motion clip's frames (clip-local, at the comp rate) to `dir/%05d.png`. */
export async function renderMotionClipFrames(source: MotionSource, clip: Clip, comp: Pick<Comp, 'fps'>, assets: Asset[], options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<RenderedFrames> {
  const fps = Math.min(60, Math.max(1, comp.fps));
  const frames = Math.max(1, Math.round(clip.duration * fps));
  const dir = await api.mogrtFramesBegin(clip.id);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  const renderer = new MotionRenderer(canvas, editorMediaHost(assets, 'export'));
  const scene = source.scene;
  try {
    for (let index = 0; index < frames; index++) {
      if (options.signal?.aborted) throw new Error('export cancelled');
      const local = index / fps;
      const t = clip.hold !== null ? clip.hold : Math.max(0, Math.min(scene.duration - 1e-4, clip.in + (clip.reverse ? clip.duration - local : local) * clip.speed));
      await renderer.bank.prepareExact(scene, t);
      const px = renderer.pixels(scene, t, { scale: 1, fps, motionBlur: true });
      await api.mogrtFrameWrite(dir, index, await toPng(px.width, px.height, px.data));
      options.onProgress?.(index + 1, frames);
    }
  } finally {
    renderer.dispose();
  }
  return { dir, fps, frames, width: scene.width, height: scene.height };
}

export function motionClipsForExport(project: Project, compId: string): { comp: Comp; clip: Clip; source: MotionSource }[] {
  const seen = new Set<string>();
  const out: { comp: Comp; clip: Clip; source: MotionSource }[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId);
      if (clip.source.type === 'motion' && !clip.adjustment) out.push({ comp, clip, source: clip.source });
    }
  };
  visit(compId);
  return out;
}

/** A copy of the project whose motion clips carry rendered frame sequences. */
export async function renderMotionScenesForExport(project: Project, compId: string, assets: Asset[], options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}): Promise<Project> {
  const targets = motionClipsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, RenderedFrames>();
  for (const [i, target] of targets.entries()) {
    const title = target.source.title ?? 'motion scene';
    rendered.set(target.clip.id, await renderMotionClipFrames(target.source, target.clip, target.comp, assets, {
      signal: options.signal,
      onProgress: (done, total) => options.onProgress?.(`Rendering ${title} (${i + 1}/${targets.length}) · ${done}/${total} frames`),
    }));
  }
  return {
    ...project,
    comps: project.comps.map((comp) => ({
      ...comp,
      clips: comp.clips.map((clip) => (clip.source.type === 'motion' && rendered.has(clip.id) ? { ...clip, source: { ...clip.source, frames: rendered.get(clip.id) } } : clip)),
    })),
  };
}
