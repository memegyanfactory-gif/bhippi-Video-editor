// Motion scenes for the export: each clip is rendered off-screen, frame-exact (every video sought
// to its frame, every matte frame loaded), to a PNG sequence with alpha that the FFmpeg exporter
// overlays like an HTML graphic's frames. Same renderer as the preview.
import { api } from '../lib/ipc';
import { openFrameWriter, type FrameWriter } from '../lib/pngEncoder';
import type { Asset, Clip, Comp, Project } from '../lib/types';
import { MotionRenderer } from './gl/renderer';
import { editorMediaHost } from './host';

type MotionSource = Extract<Clip['source'], { type: 'motion' }>;
export type RenderedFrames = { dir: string; fps: number; frames: number; width: number; height: number };

/** One reused 2D canvas showing the frame just rendered, for the progress preview. */
function previewSurface() {
  let surface: { canvas: OffscreenCanvas | HTMLCanvasElement; context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;
  return (width: number, height: number, data: Uint8ClampedArray) => {
    if (!surface || surface.canvas.width !== width || surface.canvas.height !== height) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
      const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error('no 2D canvas for the frame preview');
      surface = { canvas, context };
    }
    surface.context.putImageData(new ImageData(data, width, height), 0, 0);
    return surface.canvas;
  };
}

/** Renders one motion clip's frames (clip-local, at the comp rate) to `dir/%05d.png`. */
export async function renderMotionClipFrames(source: MotionSource, clip: Clip, comp: Pick<Comp, 'fps'>, assets: Asset[], options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; onCanvas?: (canvas: OffscreenCanvas | HTMLCanvasElement) => void } = {}): Promise<RenderedFrames> {
  const fps = Math.min(60, Math.max(1, comp.fps));
  const frames = Math.max(1, Math.round(clip.duration * fps));
  const dir = await api.mogrtFramesBegin(clip.id);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  const renderer = new MotionRenderer(canvas, editorMediaHost(assets, 'export'));
  const scene = source.scene;
  const preview = previewSurface();
  let writer: FrameWriter | null = null;
  try {
    // Frame i's PNG is encoded (on workers) and written while frame i+1 renders.
    writer = await openFrameWriter(dir, (done) => options.onProgress?.(done, frames));
    for (let index = 0; index < frames; index++) {
      if (options.signal?.aborted) throw new Error('export cancelled');
      const local = index / fps;
      // The preview's scene time (Compositor 'motion': sourceTimeAt, held inside the scene) — a
      // frame hold is clamped the same way, so a hold past the scene's end shows its last frame.
      const t = Math.max(0, Math.min(scene.duration - 1e-3, clip.hold !== null ? clip.hold : clip.in + (clip.reverse ? clip.duration - local : local) * clip.speed));
      await renderer.bank.prepareExact(scene, t);
      const px = renderer.pixels(scene, t, { scale: 1, fps, motionBlur: true });
      if (options.onCanvas) options.onCanvas(preview(px.width, px.height, px.data));
      await writer.pixels(index, px.width, px.height, px.data);
    }
    await writer.finish();
  } finally {
    await writer?.close();
    renderer.dispose();
  }
  return { dir, fps, frames, width: scene.width, height: scene.height };
}

/** Frames a motion clip renders to at export. */
export const motionFrameCount = (clip: Pick<Clip, 'duration'>, comp: Pick<Comp, 'fps'>) => Math.max(1, Math.round(clip.duration * Math.min(60, Math.max(1, comp.fps))));

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
export async function renderMotionScenesForExport(project: Project, compId: string, assets: Asset[], options: { signal?: AbortSignal; onProgress?: (message: string) => void; onItem?: (title: string, index: number, count: number, frames: number) => void; onFrame?: (done: number, total: number) => void; onCanvas?: (canvas: OffscreenCanvas | HTMLCanvasElement) => void } = {}): Promise<Project> {
  const targets = motionClipsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, RenderedFrames>();
  for (const [i, target] of targets.entries()) {
    const title = target.source.title ?? 'motion scene';
    options.onItem?.(title, i + 1, targets.length, motionFrameCount(target.clip, target.comp));
    rendered.set(target.clip.id, await renderMotionClipFrames(target.source, target.clip, target.comp, assets, {
      signal: options.signal,
      onCanvas: options.onCanvas,
      onProgress: (done, total) => { options.onFrame?.(done, total); options.onProgress?.(`Rendering ${title} (${i + 1}/${targets.length}) · ${done}/${total} frames`); },
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
