// Plugin clips: clips a plugin draws itself, frame by frame (bhippi.generator).
//
// A plugin clip is an HTML clip carrying `plugin: { id, generator, params }` (types.ts), so it is
// stacked, transformed, faded, trimmed and exported like any motion graphic. What differs is who
// draws it: the plugin's own sandboxed page, asked for one frame at a time over the bridge, never
// code running in the editor's document. The preview (PluginClipLayer) and the export
// (htmlFrames.ts, through `mountPluginClip`) ask the same way with the same inputs — the clip's
// time, its settings and the edit's sound at that moment (clipAudio.ts) — so they draw the same.

import type { AssetMap } from '../lib/timeline';
import type { Clip, Comp, PluginClipSource, Project } from '../lib/types';
import { pluginEditor, renderPluginFrame, type RenderInfo } from './bridge';
import { audioAt, prepareAudio } from './clipAudio';

/** Spectrum bands a plugin clip is given. */
export const CLIP_BANDS = 64;

/** The plugin source of a clip, if a plugin draws it. */
export const pluginSourceOf = (clip: Pick<Clip, 'source'>): PluginClipSource | null => (clip.source.type === 'html' && clip.source.plugin ? clip.source.plugin : null);

/** Every plugin that draws a clip somewhere in the project. */
export function pluginClipIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const comp of project.comps) for (const clip of comp.clips) {
    const source = pluginSourceOf(clip);
    if (source) ids.add(source.id);
  }
  return [...ids].sort();
}

/** What the plugin is told about one frame (all but its settings, which the bridge adds). */
export function frameInfo(project: Project, comp: Comp, clip: Pick<Clip, 'start' | 'duration'>, compTime: number, size: { width: number; height: number }, assets: AssetMap, exporting: boolean, fps = comp.fps): Omit<RenderInfo, 'params'> {
  const time = Math.max(0, Math.min(clip.duration, compTime - clip.start));
  return {
    time,
    duration: clip.duration,
    progress: clip.duration > 0 ? time / clip.duration : 0,
    compTime,
    fps,
    frame: Math.round(time * fps),
    width: size.width,
    height: size.height,
    u: size.width / 1920,
    exporting,
    audio: audioAt(project, comp.id, compTime, assets, CLIP_BANDS),
  };
}

/**
 * A plugin clip set up for the export, with the interface htmlFrames.ts's mountGraphic has:
 * draw(elapsed) → the frame on a canvas. Its sound is decoded first, so no frame is drawn quiet.
 */
export async function mountPluginClip(project: Project, comp: Comp, clip: Clip, scale = 1, fps = comp.fps) {
  const source = pluginSourceOf(clip);
  if (!source) throw new Error('not a plugin clip');
  const assets: AssetMap = pluginEditor()?.host().assets() ?? new Map();
  await prepareAudio(project, comp.id, assets);
  const pixels = { width: Math.max(2, Math.round(comp.width * scale)), height: Math.max(2, Math.round(comp.height * scale)) };
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d')!;
  return {
    canvas,
    pixels,
    draw: async (elapsed: number) => {
      const bitmap = await renderPluginFrame(source, frameInfo(project, comp, clip, clip.start + elapsed, pixels, assets, true, fps));
      context.clearRect(0, 0, pixels.width, pixels.height);
      context.drawImage(bitmap, 0, 0, pixels.width, pixels.height);
      bitmap.close();
      return canvas;
    },
    unmount: () => undefined,
  };
}
