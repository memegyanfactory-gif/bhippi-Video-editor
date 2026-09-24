// Where the picture does not fill the frame.
//
// Scale a shot below full frame ("zoom out"), move it aside, crop it or rotate it, and whatever it
// no longer covers renders black — render.rs composites onto black, and nothing on the timeline
// says so. This finds those moments with the same geometry the preview and export use
// (editor.placement), so the AI can be told about them and fill them (fill_background).

import { placement } from './editor';
import { animated } from './keyframes';
import { clipEnd, sourceInfo, sourceTimeAt, tracksOf, transitionWindow, type AssetMap } from './timeline';
import type { Clip, Comp, Project } from './types';
import { entryBounds } from '../motion/evaluate';
import { parseColor } from '../motion/gl/color';
import { evaluateMeasured } from '../motion/measure';
import type { MotionScene } from '../motion/types';

/** A stretch of the comp where some picture is on screen but no layer fills the frame. */
export type UncoveredSpan = {
  start: number;
  end: number;
  /** The picture clips on screen that do not fill the frame, lowest track first. */
  clipIds: string[];
};

const EDGE = 0.5; // px of slack at the frame edge, so rounding is not a gap
const STEP = 0.25; // s between samples, on top of every clip edge and keyframe
const MIN_SPAN = 0.1; // s; shorter slivers are not reported
const MAX_DEPTH = 4;

type Picture = { clip: Clip; trackIndex: number; covers: boolean };

const opaque = (color: string | null | undefined) => !!color && parseColor(color)[3] >= 0.995;

/**
 * Whether a motion scene at scene time `t` paints every pixel of its own canvas: an opaque
 * background colour, or an opaque full-canvas stage (a solid, a procedural field, or a filled
 * rect) drawn normally. A layer clip of a layered comp counts only its own layers.
 */
function sceneFillsCanvas(scene: MotionScene, t: number, fps: number): boolean {
  if (opaque(scene.background)) return true;
  const own = scene.stack ? new Set(scene.stack.own) : null;
  const matteSources = new Set(scene.layers.map((layer) => layer.matte?.layer).filter(Boolean));
  const frame = evaluateMeasured(scene, Math.max(0, Math.min(scene.duration - 1e-3, t)), fps);
  return frame.layers.some((entry) => {
    const layer = entry.layer;
    if (own && !own.has(layer.id)) return false;
    if (!entry.active || layer.hidden || layer.ref || layer.adjustment || layer.threeD || layer.matte || entry.masks.length || matteSources.has(layer.id)) return false;
    if ((layer.blend ?? 'normal') !== 'normal' || entry.opacity < 0.995) return false;
    const paints = layer.type === 'solid' ? opaque(layer.color)
      : layer.type === 'procedural' ? layer.kind !== 'light-leak' // the one field drawn with alpha
        // Only a square-cornered rect fills its bounds; an ellipse or rounded card leaves the corners.
        : layer.type === 'shape' ? layer.shape.shape === 'rect' && !layer.shape.radius && (layer.shape.gradient ? layer.shape.gradient.stops.every(([, color]) => opaque(color)) : opaque(layer.shape.fill))
          : false;
    if (!paints) return false;
    const box = entryBounds(entry.matrix, entry.size);
    return !!box && box.x <= EDGE && box.y <= EDGE && box.x + box.width >= scene.width - EDGE && box.y + box.height >= scene.height - EDGE;
  });
}

/** Whether `clip` at comp time `t` is an opaque layer that fills the whole frame. */
function fillsFrame(project: Project, assets: AssetMap, comp: Comp, clip: Clip, t: number, depth: number): boolean {
  if (clip.mask || clip.rotoMatte) return false;
  if (animated(clip, 'opacity', t, clip.transform.opacity) < 99.5) return false;
  const source = clip.source;
  if (source.type === 'media') {
    const asset = assets.get(source.assetId);
    if (!asset || asset.kind === 'audio') return false;
  } else if (source.type === 'item') {
    const item = project.items.find((entry) => entry.id === source.itemId);
    if (!item || item.kind === 'adjustment-layer') return false;
  } else if (source.type === 'comp') {
    // A nested comp fills the frame only where its own picture does.
    const child = project.comps.find((entry) => entry.id === source.compId);
    if (!child || depth >= MAX_DEPTH) return false;
    const childTime = clip.in + (t - clip.start) * clip.speed;
    if (!pictureAt(project, assets, child, childTime, depth + 1).filled) return false;
  } else if (source.type === 'motion') {
    // A motion scene is an overlay unless an opaque stage covers its canvas at this moment.
    if (!sceneFillsCanvas(source.scene, sourceTimeAt(clip, t), comp.fps)) return false;
  } else {
    return false; // text, shapes, HTML graphics: overlays with transparency
  }

  const info = sourceInfo(project, assets, source);
  const W = comp.width;
  const H = comp.height;
  const transform = {
    ...clip.transform,
    x: animated(clip, 'x', t, clip.transform.x),
    y: animated(clip, 'y', t, clip.transform.y),
    scale: animated(clip, 'scale', t, clip.transform.scale),
    rotation: animated(clip, 'rotation', t, clip.transform.rotation),
  };
  const place = placement(transform, info.width, info.height, W, H);
  // The part of the picture left after cropping, in frame pixels, before rotation.
  const left = place.left + (transform.cropLeft / 100) * place.width;
  const right = place.left + place.width - (transform.cropRight / 100) * place.width;
  const top = place.top + (transform.cropTop / 100) * place.height;
  const bottom = place.top + place.height - (transform.cropBottom / 100) * place.height;
  // Rotation is about the crop centre (placement's origin); undo it on the frame corners instead.
  const cx = place.left + place.originX;
  const cy = place.top + place.originY;
  const angle = (-transform.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const dx = px - cx;
    const dy = py - cy;
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    if (x < left - EDGE || x > right + EDGE || y < top - EDGE || y > bottom + EDGE) return false;
  }
  return true;
}

/** The picture clips on screen at `t` and whether any of them fills the frame. */
function pictureAt(project: Project, assets: AssetMap, comp: Comp, t: number, depth = 0): { filled: boolean; pictures: Picture[] } {
  const videoTracks = tracksOf(comp, 'video');
  const pictures: Picture[] = [];
  videoTracks.forEach((track, trackIndex) => {
    if (track.hidden) return;
    for (const clip of comp.clips) {
      if (clip.trackId !== track.id || !clip.enabled || clip.adjustment || t < clip.start || t >= clipEnd(clip)) continue;
      if (clip.source.type === 'sfx') continue;
      pictures.push({ clip, trackIndex, covers: fillsFrame(project, assets, comp, clip, t, depth) });
    }
  });
  return { filled: pictures.some((picture) => picture.covers), pictures };
}

/** Times worth looking at: every clip edge and keyframe, plus a regular step between them. */
function sampleTimes(comp: Comp, from: number, to: number): number[] {
  const marks = new Set<number>([from, to]);
  for (const clip of comp.clips) {
    marks.add(clip.start);
    marks.add(clipEnd(clip));
    for (const property of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) for (const key of clip.keyframes[property]) marks.add(clip.start + key.time);
  }
  for (let t = from; t < to; t += STEP) marks.add(t);
  return [...marks].filter((t) => t >= from && t <= to).sort((a, b) => a - b);
}

/**
 * Every stretch of `comp` (or of [from, to]) where picture is on screen and none of it fills the
 * frame. Moments inside a transition are skipped: a push or a wipe shows edges on purpose.
 * Empty stretches (no picture at all) are not reported — a cut to black is a choice.
 */
export function uncoveredSpans(project: Project, assets: AssetMap, comp: Comp, from = 0, to = Infinity): UncoveredSpan[] {
  const end = Math.min(to, Math.max(0, ...comp.clips.map(clipEnd)));
  if (!(end > from)) return [];
  const windows = comp.transitions.map((transition) => transitionWindow(comp, transition)).filter((window): window is NonNullable<typeof window> => !!window);
  const times = sampleTimes(comp, from, end);
  const spans: UncoveredSpan[] = [];
  for (let index = 0; index < times.length - 1; index++) {
    const a = times[index];
    const b = times[index + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    if (windows.some((window) => mid >= window.start && mid < window.end)) continue;
    const { filled, pictures } = pictureAt(project, assets, comp, mid);
    if (filled || pictures.length === 0) continue;
    const clipIds = pictures.sort((p, q) => p.trackIndex - q.trackIndex).map((picture) => picture.clip.id);
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.end - a) < 1e-6 && last.clipIds.join() === clipIds.join()) last.end = b;
    else spans.push({ start: a, end: b, clipIds });
  }
  return spans.filter((span) => span.end - span.start >= MIN_SPAN);
}

/** Spans in `after` that were not already uncovered in `before` (so a warning is about this edit). */
export function newlyUncovered(before: UncoveredSpan[], after: UncoveredSpan[]): UncoveredSpan[] {
  return after.filter((span) => !before.some((old) => old.start <= span.start + 1e-3 && old.end >= span.end - 1e-3));
}

const seconds = (value: number) => `${value.toFixed(2)}s`;

/** One line the model can act on. */
export function describeUncovered(spans: UncoveredSpan[], comp: Comp, project?: Project, assets?: AssetMap): string {
  // A clip's own name, else its source's (most clips have none of their own).
  const nameOf = (id: string) => {
    const clip = comp.clips.find((entry) => entry.id === id);
    if (!clip) return id;
    return clip.name || (project && assets ? sourceInfo(project, assets, clip.source).name : id);
  };
  const names = (ids: string[]) => [...new Set(ids.map(nameOf))].join(', ');
  const list = (group: UncoveredSpan[]) => {
    const shown = group.slice(0, 6).map((span) => `${seconds(span.start)}–${seconds(span.end)} (${names(span.clipIds)})`).join('; ');
    return `${shown}${group.length > 6 ? ` and ${group.length - 6} more` : ''}`;
  };
  // Titles, captions and motion graphics with no picture under them: nothing was scaled or moved.
  const overlay = (clip: Clip | undefined, depth = 0): boolean => {
    if (!clip) return false;
    const source = clip.source;
    if (source.type === 'comp') {
      const child = project?.comps.find((entry) => entry.id === source.compId);
      const shown = child?.clips.filter((entry) => entry.enabled && entry.source.type !== 'sfx') ?? [];
      return depth < MAX_DEPTH && shown.length > 0 && shown.every((entry) => overlay(entry, depth + 1));
    }
    return source.type === 'text' || source.type === 'html' || source.type === 'shape' || source.type === 'motion';
  };
  const graphicsOnly = (span: UncoveredSpan) => span.clipIds.every((id) => overlay(comp.clips.find((entry) => entry.id === id)));
  const graphics = spans.filter(graphicsOnly);
  const pictures = spans.filter((span) => !graphicsOnly(span));
  const lines: string[] = [];
  if (pictures.length) lines.push(`The picture does not fill the frame at ${list(pictures)}: it is scaled down, moved, cropped or rotated with nothing behind it, so those frames render black at the edges.`);
  if (graphics.length) lines.push(`Only graphics are on screen at ${list(graphics)}: graphics over an empty frame, so everything around them renders black.`);
  return `${lines.join(' ')} Call fill_background to put a background behind ${pictures.length ? 'it (it picks one from the project library, or a blurred copy of the shot)' : 'them (it picks one from the project library, or a colour matte)'}.`;
}
