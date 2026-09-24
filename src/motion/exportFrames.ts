// Motion scenes for the export: each clip is rendered off-screen, frame-exact (every video sought
// to its frame, every matte frame loaded), to a PNG sequence with alpha that the FFmpeg exporter
// overlays like an HTML graphic's frames. Same renderer as the preview.
import { api } from '../lib/ipc';
import { isLayerClip, stackGroups, standaloneScene, type StackGroup } from '../lib/motionStack';
import { openFrameWriter, type FrameWriter, type InflightFrame } from '../lib/pngEncoder';
import { renderProgress } from '../lib/renderProgress';
import { clipEnd, compClocks, exportFrameRate, newClip, newTrack } from '../lib/timeline';
import type { Asset, Clip, Comp, Project, Track } from '../lib/types';
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

/** An off-screen renderer for export frames. */
function exportRenderer(assets: Asset[]): MotionRenderer {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  return new MotionRenderer(canvas, editorMediaHost(assets, 'export'));
}

/**
 * Renders one motion clip's frames (clip-local, at the comp rate) to `dir/%05d.png`. With
 * `options.renderer` it draws on that renderer (which the caller disposes) instead of its own.
 */
export async function renderMotionClipFrames(source: MotionSource, clip: Clip, comp: Pick<Comp, 'fps'>, assets: Asset[], options: { fps?: number; scale?: number; signal?: AbortSignal; renderer?: MotionRenderer; onProgress?: (done: number, total: number) => void; onCanvas?: (canvas: OffscreenCanvas | HTMLCanvasElement) => void; onInflight?: (frames: InflightFrame[]) => void } = {}): Promise<RenderedFrames> {
  const fps = exportFrameRate(options.fps ?? comp.fps);
  // Above 1 the scene is drawn at the export's size (an export larger than the comp), not upscaled.
  const scale = Math.max(1, options.scale ?? 1);
  let size = { width: Math.round(source.scene.width * scale), height: Math.round(source.scene.height * scale) };
  const frames = Math.max(1, Math.round(clip.duration * fps));
  const dir = await api.mogrtFramesBegin(clip.id);
  const renderer = options.renderer ?? exportRenderer(assets);
  renderer.bank.fps = fps;
  const scene = source.scene;
  const preview = previewSurface();
  const cancelled = () => { if (options.signal?.aborted) throw new Error('export cancelled'); };
  let writer: FrameWriter | null = null;
  try {
    // Frame i's PNG is encoded (on workers) and written while frame i+1 renders.
    writer = await openFrameWriter(dir, (done) => options.onProgress?.(done, frames), options.signal, options.onInflight);
    for (let index = 0; index < frames; index++) {
      cancelled();
      const local = index / fps;
      // The preview's scene time (Compositor 'motion': sourceTimeAt, held inside the scene) — a
      // frame hold is clamped the same way, so a hold past the scene's end shows its last frame.
      const t = Math.max(0, Math.min(scene.duration - 1e-3, clip.hold !== null ? clip.hold : clip.in + (clip.reverse ? clip.duration - local : local) * clip.speed));
      await renderer.bank.prepareExact(scene, t);
      cancelled();
      const px = renderer.pixels(scene, t, { scale, fps, motionBlur: true });
      size = { width: px.width, height: px.height };
      if (options.onCanvas) options.onCanvas(preview(px.width, px.height, px.data));
      await writer.pixels(index, px.width, px.height, px.data);
    }
    await writer.finish();
  } finally {
    await writer?.close();
    if (!options.renderer) renderer.dispose();
  }
  return { dir, fps, frames, ...size };
}

/** Frames a motion clip renders to at export (at the export's frame rate when it sets one). */
export const motionFrameCount = (clip: Pick<Clip, 'duration'>, comp: Pick<Comp, 'fps'>, fps?: number) => Math.max(1, Math.round(clip.duration * exportFrameRate(fps ?? comp.fps)));

/**
 * One motion picture an export renders: a fused layer stack as one stand-in clip on its bottom
 * track (`members` are the layer clips it stands for), or a motion clip that draws on its own.
 */
export type MotionTarget = { comp: Comp; clip: Clip; source: MotionSource; members: string[] };

/** A layered stack's stand-in: comp time is scene time, so it starts where the stack does and reads from there. */
function carrierClip(group: StackGroup): Clip {
  const names = group.clips.map((clip) => clip.name ?? '').filter(Boolean);
  return newClip({
    id: `stack_${group.clips[0].id}`,
    trackId: group.trackIds[0],
    start: group.start,
    in: group.start,
    duration: Math.max(1e-3, group.end - group.start),
    source: { type: 'motion', scene: group.scene, title: names.length > 1 ? `${names[0]} + ${names.length - 1} layers` : names[0] || 'Motion layers' },
    name: 'Motion layers',
  });
}

/** A layer clip drawing on its own has its Motion properties baked into its scene: the exporter must not move it again. */
function restingClip(clip: Clip): Clip {
  return {
    ...clip,
    transform: { ...clip.transform, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 },
    keyframes: { ...clip.keyframes, x: [], y: [], scale: [], rotation: [], opacity: [] },
  };
}

export function motionClipsForExport(project: Project, compId: string): MotionTarget[] {
  const seen = new Set<string>();
  const out: MotionTarget[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const comp = project.comps.find((c) => c.id === id);
    if (!comp) return;
    const groups = stackGroups(project, comp);
    const grouped = new Set(groups.flatMap((group) => group.clips.map((clip) => clip.id)));
    for (const group of groups) {
      const clip = carrierClip(group);
      out.push({ comp, clip, source: clip.source as MotionSource, members: group.clips.map((member) => member.id) });
    }
    for (const clip of comp.clips) {
      if (!clip.enabled) continue;
      if (clip.source.type === 'comp') visit(clip.source.compId);
      if (clip.source.type === 'motion' && !clip.adjustment && !grouped.has(clip.id)) {
        const scene = standaloneScene(project, clip) ?? clip.source.scene;
        out.push({ comp, clip: isLayerClip(clip) ? restingClip(clip) : clip, source: { ...clip.source, scene }, members: [clip.id] });
      }
    }
  };
  visit(compId);
  return out;
}

/**
 * The project as the FFmpeg exporter takes it: every motion picture carries its rendered frames,
 * and each fused layer stack is one clip (its layer clips switched off in this copy). A stack's
 * clip goes on a track of its own, inserted where the stack's bottom track is: on that track it
 * would overlap the switched-off layer clips, and the exporter refuses a comp with overlapping
 * clips on one track ("two clips overlap on V1"), so nothing exported at all.
 */
function withRendered(project: Project, targets: MotionTarget[], rendered: Map<string, RenderedFrames>): Project {
  const byComp = new Map<string, MotionTarget[]>();
  for (const target of targets) byComp.set(target.comp.id, [...(byComp.get(target.comp.id) ?? []), target]);
  return {
    ...project,
    comps: project.comps.map((comp) => {
      const mine = byComp.get(comp.id);
      if (!mine) return comp;
      const replaced = new Map<string, Clip>();
      const off = new Set<string>();
      const carriers: Clip[] = [];
      // The track each stack's clip gets, keyed by the track it goes under (the stack's bottom one).
      const lanes = new Map<string, Track>();
      for (const target of mine) {
        const frames = rendered.get(target.clip.id);
        const clip = { ...target.clip, source: { ...target.source, ...(frames ? { frames } : {}) } };
        if (target.members.length === 1 && target.members[0] === target.clip.id) replaced.set(target.clip.id, clip);
        else {
          for (const id of target.members) off.add(id);
          const lane: Track = { ...newTrack('video'), id: `${clip.id}_track`, name: 'Motion layers' };
          lanes.set(clip.trackId, lane);
          carriers.push({ ...clip, trackId: lane.id });
        }
      }
      const tracks = comp.tracks.flatMap((track) => {
        const lane = lanes.get(track.id);
        return lane ? [lane, track] : [track];
      });
      return { ...comp, tracks, clips: [...comp.clips.map((clip) => replaced.get(clip.id) ?? (off.has(clip.id) ? { ...clip, enabled: false } : clip)), ...carriers] };
    }),
  };
}

/** A copy of the project whose motion pictures carry rendered frame sequences. */
export async function renderMotionScenesForExport(project: Project, compId: string, assets: Asset[], options: { fps?: number; scale?: number; signal?: AbortSignal; onProgress?: (message: string) => void; onItem?: (title: string, index: number, count: number, frames: number) => void; onFrame?: (done: number, total: number) => void; onCanvas?: (canvas: OffscreenCanvas | HTMLCanvasElement) => void } = {}): Promise<Project> {
  const targets = motionClipsForExport(project, compId);
  if (!targets.length) return project;
  const rendered = new Map<string, RenderedFrames>();
  // One GPU context for the whole export: browsers cap live WebGL contexts, and one per target
  // used to push the Program monitor's own renderer out.
  const renderer = exportRenderer(assets);
  try {
    for (const [i, target] of targets.entries()) {
      const title = target.source.title ?? 'motion scene';
      options.onItem?.(title, i + 1, targets.length, motionFrameCount(target.clip, target.comp, options.fps));
      try {
        rendered.set(target.clip.id, await renderMotionClipFrames(target.source, target.clip, target.comp, assets, {
          fps: options.fps,
          scale: options.scale,
          signal: options.signal,
          renderer,
          onCanvas: options.onCanvas,
          onInflight: renderProgress.inflight,
          onProgress: (done, total) => { options.onFrame?.(done, total); options.onProgress?.(`Rendering ${title} (${i + 1}/${targets.length}) · ${done}/${total} frames`); },
        }));
      } finally {
        // Each target's videos and stills are let go once it is done, as when it had its own renderer.
        renderer.bank.dispose();
      }
    }
  } finally {
    renderer.dispose();
  }
  return withRendered(project, targets, rendered);
}

/**
 * The project with every motion picture on screen at `times` of `compId` (nested comps followed
 * down) carrying just the frames those moments need, so single-frame exports — the QA contact
 * sheet, storyboard cards — show the motion graphics instead of leaving them out.
 */
export async function renderMotionStill(project: Project, compId: string, times: number[], assets: Asset[]): Promise<Project> {
  const targets = motionClipsForExport(project, compId);
  if (!targets.length || !times.length) return project;
  const clocks = new Map<string, number[]>();
  for (const time of times) for (const [id, list] of compClocks(project, compId, time)) clocks.set(id, [...(clocks.get(id) ?? []), ...list]);
  // Made on the first target on screen: a still with no motion in it costs no GPU context.
  let renderer: MotionRenderer | null = null;
  const rendered = new Map<string, RenderedFrames>();
  try {
    for (const target of targets) {
      const clip = target.clip;
      const fps = Math.min(60, Math.max(1, target.comp.fps));
      // The exporter reads frame round(τ·fps) of the sequence: those files are all it needs.
      const indices = [...new Set((clocks.get(target.comp.id) ?? []).filter((at) => at >= clip.start && at < clipEnd(clip)).map((at) => Math.max(0, Math.round((at - clip.start) * fps))))];
      if (!indices.length) continue;
      renderer ??= exportRenderer(assets);
      renderer.bank.fps = fps;
      const scene = target.source.scene;
      const dir = await api.mogrtFramesBegin(`${clip.id}-still`);
      const writer = await openFrameWriter(dir, () => undefined);
      try {
        for (const index of indices) {
          const local = index / fps;
          const sceneTime = Math.max(0, Math.min(scene.duration - 1e-3, clip.hold !== null ? clip.hold : clip.in + (clip.reverse ? clip.duration - local : local) * clip.speed));
          await renderer.bank.prepareExact(scene, sceneTime);
          const px = renderer.pixels(scene, sceneTime, { scale: 1, fps, motionBlur: true });
          await writer.pixels(index, px.width, px.height, px.data);
        }
        await writer.finish();
      } finally {
        await writer.close();
      }
      rendered.set(clip.id, { dir, fps, frames: Math.max(...indices) + 1, width: scene.width, height: scene.height });
    }
  } finally {
    renderer?.dispose();
  }
  return withRendered(project, targets, rendered);
}
