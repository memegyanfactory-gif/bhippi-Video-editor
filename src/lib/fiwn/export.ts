// WatchFIWN-look captions for the export: each caption clip is drawn frame by frame with FIWN's
// own renderer (the Program monitor's code) to a PNG sequence with alpha, the size of the frame,
// which the FFmpeg exporter overlays as it does a motion graphic's frames. Only a caption's own
// span is rendered. A caption FIWN cannot draw stays a text clip, so the export burns it in with
// the classic look rather than failing or dropping it.
import { api } from '../ipc';
import { openFrameWriter, type InflightFrame } from '../pngEncoder';
import { parseRbStyle } from '../reactbits';
import { isTextClip, textGraphic } from '../textGraphic';
import { exportFrameRate } from '../timeline';
import { clipFrameWindow, type ExportRange } from '../exportWindow';
import type { Clip, Comp, Project } from '../types';
import { drawFiwnCaption, ensureFiwnFonts, fiwnCue, fiwnStyle, type FiwnStyle } from './index';

export type CaptionTarget = { comp: Comp; clip: Clip; style: FiwnStyle };
type Frames = { dir: string; fps: number; frames: number; width: number; height: number };

/** Every caption an export of `compId` draws with FIWN's renderer (nested comps followed down, in order of appearance). */
export function fiwnCaptionsForExport(project: Project, compId: string): CaptionTarget[] {
  if (project.captionLook !== 'fiwn') return [];
  const seen = new Set<string>();
  const out: (CaptionTarget & { at: number })[] = [];
  const visit = (id: string, offset: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId, offset + clip.start - clip.in / Math.max(1e-6, clip.speed));
      if (!isTextClip(clip) || clip.source.preset !== 'caption') continue;
      const style = fiwnStyle(parseRbStyle(clip.source.style).base ?? clip.source.style);
      if (style) out.push({ comp, clip, style, at: offset + clip.start });
    }
  };
  visit(compId, 0);
  return out.sort((a, b) => a.at - b.at);
}

/** Frames a caption renders to at export. */
export const captionFrameCount = (clip: Pick<Clip, 'duration'>, comp: Pick<Comp, 'fps'>, fps?: number) => Math.max(1, Math.round(clip.duration * exportFrameRate(fps ?? comp.fps)));

type Hooks = {
  fps?: number;
  scale?: number;
  signal?: AbortSignal;
  /** Only the frames showing these moments of `compId` (Export Frame, frame QA), not the whole caption. */
  times?: number[];
  /** In→Out: only the frames the range shows (captions of the exported comp itself). */
  range?: ExportRange | null;
  onItem?: (title: string, index: number, count: number, frames: number) => void;
  onFrame?: (done: number, total: number) => void;
  onCanvas?: (canvas: HTMLCanvasElement | OffscreenCanvas) => void;
  onInflight?: (frames: InflightFrame[]) => void;
};

function surface(width: number, height: number) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D canvas to draw captions on');
  return { canvas, ctx };
}

/** One caption's frames: frame i shows the caption at clip.start + i / fps. Null when FIWN cannot draw it. */
async function renderCaption(project: Project, target: CaptionTarget, hooks: Hooks, compId: string): Promise<Frames | null> {
  const { comp, clip, style } = target;
  const fps = exportFrameRate(hooks.fps ?? comp.fps);
  const scale = Math.max(1, hooks.scale ?? 1);
  const width = Math.round(comp.width * scale);
  const height = Math.round(comp.height * scale);
  const total = captionFrameCount(clip, comp, hooks.fps);
  const wanted = hooks.times
    ? [...new Set(hooks.times.filter((at) => at >= clip.start && at < clip.start + clip.duration).map((at) => Math.min(total - 1, Math.max(0, Math.round((at - clip.start) * fps)))))]
    : null;
  if (wanted && !wanted.length) return null;
  // Captions inside nested comps render whole: a parent clip's speed changes their timing.
  const window = clipFrameWindow(comp.id === compId ? clip.start : 0, clip.duration, fps, comp.id === compId ? hooks.range : null);
  if (!wanted && !window) return null;
  const indices = wanted ?? Array.from({ length: window!.last - window!.first + 1 }, (_, index) => window!.first + index);
  await ensureFiwnFonts(style);
  const cue = fiwnCue(textGraphic(project, clip as Parameters<typeof textGraphic>[1]));
  const { canvas, ctx } = surface(width, height);
  const dir = await api.mogrtFramesBegin(`${clip.id}-caption${hooks.times ? '-still' : ''}`);
  const writer = await openFrameWriter(dir, (done) => hooks.onFrame?.(done, indices.length), hooks.signal, hooks.onInflight);
  try {
    for (const index of indices) {
      if (hooks.signal?.aborted) throw new Error('export cancelled');
      ctx.clearRect(0, 0, width, height);
      // Sampled a hair inside the clip at its end, as the monitor never shows t = end.
      const time = Math.min(clip.start + index / fps, clip.start + clip.duration - 1e-3);
      if (!drawFiwnCaption(ctx, cue, time, width, height, style)) return null;
      hooks.onCanvas?.(canvas);
      await writer.pixels(index, width, height, ctx.getImageData(0, 0, width, height).data);
    }
    await writer.finish();
  } finally {
    await writer.close();
  }
  return { dir, fps, frames: Math.max(...indices) + 1, width, height };
}

/**
 * A copy of the project whose WatchFIWN-look captions carry rendered frames: each becomes a
 * full-frame graphic with its frames (so the exporter overlays it instead of burning the text in
 * with libass). The saved project is untouched.
 */
export async function renderFiwnCaptionsForExport(project: Project, compId: string, hooks: Hooks = {}): Promise<Project> {
  const targets = fiwnCaptionsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, Frames>();
  for (const [index, target] of targets.entries()) {
    const title = `Caption "${(target.clip.source as { text: string }).text.slice(0, 32)}"`;
    hooks.onItem?.(title, index + 1, targets.length, captionFrameCount(target.clip, target.comp, hooks.fps));
    const frames = await renderCaption(project, target, hooks, compId);
    if (frames) rendered.set(target.clip.id, frames);
  }
  if (!rendered.size) return project;
  return {
    ...project,
    comps: project.comps.map((comp) => {
      if (!comp.clips.some((clip) => rendered.has(clip.id))) return comp;
      return {
        ...comp,
        clips: comp.clips.map((clip) => {
          const frames = rendered.get(clip.id);
          if (!frames || !isTextClip(clip)) return clip;
          return { ...clip, source: { type: 'html' as const, html: '', title: `Caption: ${clip.source.text}`, frames } };
        }),
      };
    }),
  };
}
