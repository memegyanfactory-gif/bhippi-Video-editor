// Puts a background behind picture that no longer fills the frame (see coverage.ts).
//
// What goes behind, in order: a source the caller names; a background from the project library
// (an image or video whose name or bin says bg / background / backdrop / plate / texture /
// wallpaper); a blurred, darkened, full-frame copy of the shot itself (the usual fix for a
// zoomed-out or vertical shot); a colour matte in the plan's palette.

import { DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from './editor';
import { clipEnd, newClip, newItem, newTrack, placeClips, tracksOf, trackLabel, updateComp, type AssetMap } from './timeline';
import type { UncoveredSpan } from './coverage';
import type { Asset, Clip, Comp, Project } from './types';

export type FillSource = 'auto' | 'blur' | 'color' | string;

export type Filled = { start: number; end: number; track: string; what: string };

const BG_WORDS = /(^|[^a-z])(bg|background|backgrounds|backdrop|plate|texture|wallpaper)([^a-z]|$)/i;
const EPS = 1e-3;

/** A library asset made to sit behind things, best first for a span `length` seconds long. */
export function libraryBackground(project: Project, assets: AssetMap, exclude: ReadonlySet<string>, length: number): Asset | null {
  const folderName = (id: string | null) => project.folders.find((folder) => folder.id === id)?.name ?? '';
  const candidates = project.media
    .map((ref) => ({ asset: assets.get(ref.assetId), folder: folderName(ref.folderId) }))
    .filter((entry): entry is { asset: Asset; folder: string } => !!entry.asset)
    .filter(({ asset, folder }) => (asset.kind === 'image' || asset.kind === 'video') && !asset.missing && !exclude.has(asset.id) && (BG_WORDS.test(asset.name) || BG_WORDS.test(folder)))
    .map(({ asset }) => asset);
  const score = (asset: Asset) => (asset.kind === 'video' && asset.duration >= length ? 3 : asset.kind === 'image' ? 2 : 1);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Adds a video track directly under `trackId` (V1 is the first video track, the bottom one). */
export function insertTrackBelow(comp: Comp, trackId: string): { comp: Comp; trackId: string } {
  const index = comp.tracks.findIndex((track) => track.id === trackId);
  const created = newTrack('video');
  const tracks = [...comp.tracks];
  tracks.splice(Math.max(0, index), 0, created);
  return { comp: { ...comp, tracks }, trackId: created.id };
}

/** A video track under the lowest picture's track that is empty for the whole span, or a new one under it. */
function trackUnder(comp: Comp, lowestTrackId: string, start: number, end: number): { comp: Comp; trackId: string } {
  const video = tracksOf(comp, 'video');
  const lowest = video.findIndex((track) => track.id === lowestTrackId);
  for (let index = lowest - 1; index >= 0; index--) {
    const track = video[index];
    if (track.locked || track.hidden) continue;
    const busy = comp.clips.some((clip) => clip.trackId === track.id && clip.start < end - EPS && clipEnd(clip) > start + EPS);
    if (!busy) return { comp, trackId: track.id };
  }
  return insertTrackBelow(comp, lowestTrackId);
}

const fullFrame = { ...DEFAULT_TRANSFORM, fit: 'fill' as const };

/**
 * Fills each span with a background under its lowest picture. Returns the edited project, or the
 * reason nothing could be done.
 */
export function fillBackground(
  project: Project,
  assets: AssetMap,
  compId: string,
  spans: UncoveredSpan[],
  options: { source?: FillSource; color?: string } = {},
): { project: Project; filled: Filled[] } | { error: string } {
  const source = options.source ?? 'auto';
  if (source !== 'auto' && source !== 'blur' && source !== 'color' && !assets.has(source)) return { error: `No asset with id ${source}; use 'auto', 'blur', 'color' or an asset id from the library` };
  let next = project;
  const filled: Filled[] = [];
  for (const span of spans) {
    const comp = next.comps.find((entry) => entry.id === compId);
    if (!comp) return { error: 'The comp no longer exists' };
    const lowest = comp.clips.find((clip) => clip.id === span.clipIds[0]);
    if (!lowest) continue;
    const length = span.end - span.start;
    const shotAsset = lowest.source.type === 'media' ? assets.get(lowest.source.assetId) : undefined;
    const canBlur = !!shotAsset && (shotAsset.kind === 'video' || shotAsset.kind === 'image');

    let chosen: { kind: 'asset'; asset: Asset } | { kind: 'blur' } | { kind: 'color'; color: string };
    if (source !== 'auto' && source !== 'blur' && source !== 'color') chosen = { kind: 'asset', asset: assets.get(source)! };
    else if (source === 'blur' && canBlur) chosen = { kind: 'blur' };
    else if (source === 'color') chosen = { kind: 'color', color: options.color ?? paletteColor(comp) };
    else {
      const fromLibrary = source === 'auto' ? libraryBackground(next, assets, new Set(shotAsset ? [shotAsset.id] : []), length) : null;
      chosen = fromLibrary ? { kind: 'asset', asset: fromLibrary } : canBlur ? { kind: 'blur' } : { kind: 'color', color: options.color ?? paletteColor(comp) };
    }

    const target = trackUnder(comp, lowest.trackId, span.start, span.end);
    let working = target.comp;
    const clips: Clip[] = [];
    let what: string;
    if (chosen.kind === 'asset') {
      const asset = chosen.asset;
      // A short video is laid end to end until the span is covered.
      const piece = asset.kind === 'video' && asset.duration > 0 ? asset.duration : length;
      for (let at = span.start; at < span.end - EPS; at += piece) {
        clips.push(newClip({ trackId: target.trackId, start: at, duration: Math.min(piece, span.end - at), source: { type: 'media', assetId: asset.id }, transform: { ...fullFrame }, name: `Background · ${asset.name}` }));
      }
      what = `“${asset.name}” from the library`;
    } else if (chosen.kind === 'blur') {
      // The same shot, time-aligned so its motion matches, filling the frame, blurred and dimmed.
      clips.push(newClip({
        trackId: target.trackId, start: span.start, duration: length, source: lowest.source,
        in: lowest.in + (span.start - lowest.start) * lowest.speed, speed: lowest.speed, reverse: lowest.reverse,
        transform: { ...fullFrame }, effects: { ...DEFAULT_EFFECTS, blur: 36, brightness: -28 },
        name: `Background · blurred ${lowest.name ?? shotAsset?.name ?? 'shot'}`,
      }));
      what = 'a blurred copy of the shot';
    } else {
      const item = newItem('color-matte', comp, { name: 'Background', color: chosen.color, duration: length });
      next = { ...next, items: [...next.items, item] };
      clips.push(newClip({ trackId: target.trackId, start: span.start, duration: length, source: { type: 'item', itemId: item.id }, name: 'Background' }));
      what = `a ${chosen.color} colour matte`;
    }
    working = placeClips(working, clips, 'overwrite');
    next = updateComp(next, compId, () => working);
    filled.push({ start: span.start, end: span.end, track: trackLabel(working, target.trackId), what });
  }
  return { project: next, filled };
}

/** The plan's palette colour, or near-black. */
function paletteColor(comp: Comp): string {
  const palette = comp.videoBlueprint?.style?.palette;
  return palette?.find((color) => /^#[0-9a-f]{6}$/i.test(color)) ?? '#121212';
}
