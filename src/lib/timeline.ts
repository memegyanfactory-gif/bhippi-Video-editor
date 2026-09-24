// Comp editing with Premiere's semantics, as pure functions over the project model.
//
// Invariants every operation keeps: clips on one track never overlap; a clip never reads past
// its source; locked tracks are never changed; transitions follow their clips through splits and
// disappear when their edit point does. Operations take and return whole comps so the history
// can undo any of them as one step.
import { normalizeEffectClip } from './effectState';
import { clamp, DEFAULT_EFFECTS, DEFAULT_TEXT, DEFAULT_TRANSFORM, FPS, isHexColor, SFX_LENGTH, STILL_DEFAULT, uid } from './editor';
import { EMPTY_KEYFRAMES, shiftKeys } from './keyframes';
import { findRbCard, parseRbStyle } from './reactbits';
import type { Asset, Clip, ClipSource, Comp, Folder, ItemKind, Marker, MediaRef, Preset, Project, ProjectItem, SfxKind, Track, TrackKind, Transition, TransitionKind } from './types';

export const EPS = 1e-4;
/** The shortest clip an edit may leave behind. */
export const MIN_DURATION = 1 / 120;

export type AssetMap = Map<string, Asset>;
export type PlaceMode = 'overwrite' | 'insert';

// ───────────────────────────── construction ─────────────────────────────

export const COMP_PRESETS = [
  { id: '1080p', label: 'HD 1080p', width: 1920, height: 1080 },
  { id: '4k', label: 'UHD 4K', width: 3840, height: 2160 },
  { id: '720p', label: 'HD 720p', width: 1280, height: 720 },
  { id: 'vertical', label: 'Vertical 9:16', width: 1080, height: 1920 },
  { id: 'square', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait 4:5', width: 1080, height: 1350 },
] as const;

export type CompPresetId = (typeof COMP_PRESETS)[number]['id'];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

export const ITEM_LABEL: Record<ItemKind, string> = {
  'color-matte': 'Color Matte',
  'black-video': 'Black Video',
  'transparent-video': 'Transparent Video',
  'bars-and-tone': 'Bars and Tone',
  'adjustment-layer': 'Adjustment Layer',
  countdown: 'Countdown Leader',
};

export const newTrack = (kind: TrackKind): Track => ({ id: uid(), kind, name: '', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 52 });

/** A comp with Premiere's default three video and three audio tracks. */
export function newComp({ name, width = 1920, height = 1080, fps = FPS }: { name: string; width?: number; height?: number; fps?: number }): Comp {
  const tracks = [newTrack('video'), newTrack('video'), newTrack('video'), newTrack('audio'), newTrack('audio'), newTrack('audio')];
  return {
    id: uid(), name, width, height, fps, tracks, clips: [], markers: [], transitions: [], inPoint: null, outPoint: null,
    sourceVideo: tracks[0].id, sourceAudio: tracks[3].id, folderId: null,
  };
}

export function newProject(name = 'Untitled project'): Project {
  const comp = newComp({ name: 'Comp 1' });
  return { version: 3, name, comps: [comp], items: [], media: [], folders: [], activeCompId: comp.id, openCompIds: [comp.id], captionStyle: null, activeBrandKitId: null };
}

/**
 * Deletes project-panel entries by id: comps (any of them, including the last
 * one — the timeline, monitors and export all tolerate zero comps), items,
 * media refs and folders. Timeline clips reading deleted sources go with
 * them; children of a deleted folder move to the root instead of vanishing.
 * Disk files are never touched.
 */
export function deleteBinEntries(project: Project, ids: Iterable<string>): Project {
  const gone = new Set(ids);
  const refersTo = (clip: Clip) =>
    (clip.source.type === 'media' && gone.has(clip.source.assetId))
    || (clip.source.type === 'comp' && gone.has(clip.source.compId))
    || (clip.source.type === 'item' && gone.has(clip.source.itemId));
  const unfoldered = (folderId: string | null) => (gone.has(folderId ?? '') ? null : folderId);
  const comps = project.comps
    .filter((item) => !gone.has(item.id))
    .map((item) => ({ ...item, folderId: unfoldered(item.folderId), clips: item.clips.filter((clip) => !refersTo(clip)) }));
  const folders = project.folders.filter((folder) => !gone.has(folder.id));
  return {
    ...project,
    comps,
    items: project.items.filter((item) => !gone.has(item.id)).map((item) => ({ ...item, folderId: unfoldered(item.folderId) })),
    media: project.media.filter((ref) => !gone.has(ref.assetId)).map((ref) => ({ ...ref, folderId: unfoldered(ref.folderId) })),
    folders,
    activeCompId: comps.some((item) => item.id === project.activeCompId) ? project.activeCompId : (comps[0]?.id ?? null),
    openCompIds: project.openCompIds.filter((id) => comps.some((item) => item.id === id)),
  };
}

export function newItem(kind: ItemKind, comp: Pick<Comp, 'width' | 'height'>, options: { name?: string; color?: string; duration?: number } = {}): ProjectItem {
  return {
    id: uid(),
    kind,
    name: options.name?.trim() || ITEM_LABEL[kind],
    color: isHexColor(options.color) ? options.color.toUpperCase() : kind === 'countdown' ? '#FFFFFF' : kind === 'color-matte' ? '#3D7BFF' : '#000000',
    width: comp.width,
    height: comp.height,
    duration: clamp(options.duration ?? (kind === 'countdown' ? 8 : STILL_DEFAULT), 0.1, 24 * 3600),
    folderId: null,
  };
}

/** Default SFX level by kind (linear gain: whoosh ≈ −16 dB … riser ≈ −20 dB); lib/sfxLevels.ts builds on it. */
export const SFX_DEFAULT_GAIN: Record<SfxKind, number> = { whoosh: 0.16, impact: 0.2, pop: 0.125, chime: 0.125, riser: 0.1 };

export function newClip(fields: Pick<Clip, 'trackId' | 'start' | 'duration' | 'source'> & Partial<Clip>): Clip {
  return {
    id: uid(), in: 0, speed: 1, linkId: null, enabled: true, name: null, volume: fields.source.type === 'sfx' ? 0.7 : 1,
    transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS },
    label: null, groupId: null, reverse: false, maintainPitch: true, hold: null, interpolation: 'sampling', deinterlace: false,
    adjustment: false, mask: null, keyframes: { ...EMPTY_KEYFRAMES }, channels: 'stereo', enhanceSpeech: false, audioType: null,
    appliedEffects: [],
    ...fields,
  };
}

export function textSource(preset: Preset, options: { text?: string; subtitle?: string; color?: string; style?: string | null; vertical?: boolean } = {}): ClipSource {
  // Caption clips keep any style id. Other presets keep only React-Bits motion /
  // card tokens (bare `rb-*` ids) so entrances like `rb-decrypted` survive the
  // round trip; catalogue caption style ids on a title would be meaningless.
  const keepMotion = (() => {
    if (preset === 'caption' || !options.style) return options.style ?? null;
    const { motionId } = parseRbStyle(options.style);
    if (motionId || findRbCard(options.style)) return options.style;
    return null;
  })();
  return {
    type: 'text', preset,
    text: options.text ?? DEFAULT_TEXT[preset].text,
    subtitle: options.subtitle ?? DEFAULT_TEXT[preset].subtitle,
    color: isHexColor(options.color) ? options.color.toUpperCase() : preset === 'caption' ? '#FFFFFF' : '#FFC53D',
    style: preset === 'caption' ? (options.style ?? null) : keepMotion,
    vertical: !!options.vertical,
  };
}

// ───────────────────────────── tracks ─────────────────────────────

export const tracksOf = (comp: Comp, kind: TrackKind) => comp.tracks.filter((track) => track.kind === kind);

export function trackLabel(comp: Comp, trackId: string): string {
  const track = comp.tracks.find((item) => item.id === trackId);
  if (!track) return '?';
  const index = tracksOf(comp, track.kind).findIndex((item) => item.id === trackId);
  return `${track.kind === 'video' ? 'V' : 'A'}${index + 1}`;
}

export const trackIndex = (comp: Comp, trackId: string) => {
  const track = comp.tracks.find((item) => item.id === trackId);
  return track ? tracksOf(comp, track.kind).findIndex((item) => item.id === trackId) : -1;
};

export const trackOf = (comp: Comp, trackId: string) => comp.tracks.find((track) => track.id === trackId);

/** A track by label (`V2`, `a1`) or id. */
export function resolveTrack(comp: Comp, ref: string | null | undefined): Track | undefined {
  if (!ref) return undefined;
  const match = /^([va])(\d{1,2})$/i.exec(ref.trim());
  if (match) return tracksOf(comp, match[1].toLowerCase() === 'v' ? 'video' : 'audio')[Number(match[2]) - 1];
  return comp.tracks.find((track) => track.id === ref);
}

/** Adds tracks of `kind` until index `index` (0-based) exists. */
export function ensureTrack(comp: Comp, kind: TrackKind, index: number): { comp: Comp; track: Track } {
  let next = comp;
  while (tracksOf(next, kind).length <= index) next = addTracks(next, kind, 1).comp;
  return { comp: next, track: tracksOf(next, kind)[index] };
}

/** Adds tracks after `after` (a track id of the same kind), or at the far end: top for video, bottom for audio. */
export function addTracks(comp: Comp, kind: TrackKind, count: number, after?: string): { comp: Comp; ids: string[] } {
  const created = Array.from({ length: clamp(Math.round(count), 1, 99) }, () => newTrack(kind));
  const tracks = [...comp.tracks];
  const anchor = after ? tracks.findIndex((track) => track.id === after && track.kind === kind) : -1;
  if (anchor >= 0) tracks.splice(anchor + 1, 0, ...created);
  else {
    let last = -1;
    tracks.forEach((track, index) => track.kind === kind && (last = index));
    tracks.splice(last + 1, 0, ...created);
  }
  return { comp: { ...comp, tracks }, ids: created.map((track) => track.id) };
}

/** Deletes tracks and their clips, always keeping one track of each kind. */
export function deleteTracks(comp: Comp, ids: string[]): Comp {
  const doomed = new Set(ids);
  let tracks = comp.tracks.filter((track) => !doomed.has(track.id));
  for (const kind of ['video', 'audio'] as const) {
    if (!tracks.some((track) => track.kind === kind)) {
      const keep = tracksOf(comp, kind)[0];
      tracks = kind === 'video' ? [keep, ...tracks] : [...tracks, keep];
    }
  }
  const alive = new Set(tracks.map((track) => track.id));
  return tidy({
    ...comp,
    tracks,
    clips: comp.clips.filter((clip) => alive.has(clip.trackId)),
    sourceVideo: comp.sourceVideo && alive.has(comp.sourceVideo) ? comp.sourceVideo : (tracks.find((t) => t.kind === 'video')?.id ?? null),
    sourceAudio: comp.sourceAudio && alive.has(comp.sourceAudio) ? comp.sourceAudio : (tracks.find((t) => t.kind === 'audio')?.id ?? null),
  });
}

export const emptyTracks = (comp: Comp) => comp.tracks.filter((track) => !comp.clips.some((clip) => clip.trackId === track.id)).map((track) => track.id);

/** Whether an audio track is heard: when any track is soloed only soloed tracks play. */
export const audible = (comp: Comp, track: Track) => (comp.tracks.some((item) => item.kind === 'audio' && item.solo) ? track.solo : !track.muted);

export const updateTrack = (comp: Comp, trackId: string, patch: Partial<Track>): Comp => ({
  ...comp,
  tracks: comp.tracks.map((track) => (track.id === trackId ? { ...track, ...patch, id: track.id, kind: track.kind } : track)),
});

// ───────────────────────────── clips & sources ─────────────────────────────

export const clipEnd = (clip: Clip) => clip.start + clip.duration;

/** The only kind of track a source may sit on, or null when either kind will do. */
const trackKindFor = (source: ClipSource): TrackKind | null =>
  source.type === 'sfx' ? 'audio' : source.type === 'text' || source.type === 'shape' || source.type === 'html' || source.type === 'motion' ? 'video' : null;

// ───────────────────────────── putting a comp back inside the rules ──────────────────────────

/**
 * Trims a comp back inside the invariants.
 *
 * Every operation in this file keeps them, but a comp can still arrive broken — from an older
 * project file, from a tool that built clips by hand instead of going through `placeClips`, or
 * from an assistant writing clips straight into the project. One overlap is enough to make the
 * backend refuse the whole project, and then *nothing* saves: the autosave fails on every
 * keystroke and the work is only in memory. Repairing beats refusing, because the repair is
 * exactly what an overwrite drop would have done — the earlier clip gives way to the later one.
 *
 * Returns the same object when there was nothing to fix, so React identity checks still hold
 * and a healthy project costs one pass and no allocation.
 */
export function healComp(comp: Comp): Comp {
  let changed = false;
  // A picture on an audio track, or a sound effect on a video one, is refused by the backend
  // too. It moves to the same index on the right kind of track rather than being dropped.
  const kinds = new Map(comp.tracks.map((track) => [track.id, track.kind]));
  let fixed = comp;
  for (const clip of comp.clips) {
    const kind = kinds.get(clip.trackId);
    const wanted = trackKindFor(clip.source);
    if (!kind || !wanted || kind === wanted) continue;
    const ensured = ensureTrack(fixed, wanted, Math.max(0, trackIndex(comp, clip.trackId)));
    fixed = { ...ensured.comp, clips: ensured.comp.clips.map((item) => (item.id === clip.id ? { ...item, trackId: ensured.track.id } : item)) };
    changed = true;
  }
  const trackIds = new Set(fixed.tracks.map((track) => track.id));
  const byTrack = new Map<string, Clip[]>();
  for (const clip of fixed.clips) {
    // A clip on a track that no longer exists can never be seen or selected again.
    if (!trackIds.has(clip.trackId) || !Number.isFinite(clip.start) || !Number.isFinite(clip.duration)) {
      changed = true;
      continue;
    }
    const list = byTrack.get(clip.trackId);
    if (list) list.push(clip);
    else byTrack.set(clip.trackId, [clip]);
  }

  const kept: Clip[] = [];
  for (const list of byTrack.values()) {
    // Ties broken by id so the repair is the same every time it runs.
    list.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let index = 0; index < list.length; index++) {
      let clip = list[index];
      if (clip.start < 0) {
        changed = true;
        clip = { ...clip, start: 0 };
      }
      const next = list[index + 1];
      if (next && next.start < clipEnd(clip) - EPS) {
        changed = true;
        const duration = next.start - clip.start;
        // Completely buried by the one after it: there is nothing left to keep.
        if (duration < MIN_DURATION) continue;
        clip = { ...clip, duration };
      }
      if (clip.duration < MIN_DURATION) {
        changed = true;
        continue;
      }
      kept.push(clip);
    }
  }
  const candidate: Comp = changed ? { ...fixed, clips: kept } : comp;
  const tidied = tidy(candidate);
  if (
    tidied.transitions.length !== comp.transitions.length ||
    tidied.transitions.some((t, i) => t !== comp.transitions[i])
  ) {
    changed = true;
  }
  return changed ? tidied : comp;
}

/** [`healComp`] across a whole project; the same project back when nothing needed it. */
export function healProject(project: Project): Project {
  let changed = false;
  const comps = project.comps.map((comp) => {
    const healed = healComp(comp);
    if (healed !== comp) changed = true;
    return healed;
  });
  return changed ? { ...project, comps } : project;
}
export const sourceOut = (clip: Clip) => clip.in + clip.duration * clip.speed;
export const compDuration = (comp: Comp) => comp.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);

export const clipsOn = (comp: Comp, trackId: string) => comp.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.start - b.start);

/** `ids` plus every clip linked or grouped with one of them. */
export function withLinked(comp: Comp, ids: Iterable<string>, groups = true): string[] {
  const chosen = new Set(ids);
  const picked = comp.clips.filter((clip) => chosen.has(clip.id));
  const links = new Set(picked.map((clip) => clip.linkId).filter(Boolean));
  const groupIds = new Set(groups ? picked.map((clip) => clip.groupId).filter(Boolean) : []);
  for (const clip of comp.clips) {
    if ((clip.linkId && links.has(clip.linkId)) || (clip.groupId && groupIds.has(clip.groupId))) chosen.add(clip.id);
  }
  return [...chosen];
}

export const activeComp = (project: Project): Comp | undefined => project.comps.find((comp) => comp.id === project.activeCompId) ?? project.comps[0];

export const updateComp = (project: Project, compId: string, change: (comp: Comp) => Comp): Project => ({
  ...project,
  comps: project.comps.map((comp) => (comp.id === compId ? change(comp) : comp)),
});

export function findClip(project: Project, clipId: string): { comp: Comp; clip: Clip } | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((item) => item.id === clipId);
    if (clip) return { comp, clip };
  }
  return null;
}

export type SourceInfo = { name: string; hasVideo: boolean; hasAudio: boolean; length: number; width: number; height: number };

/** What a source offers: picture, sound, how long it can run (Infinity for stills, solids and text). */
export function sourceInfo(project: Project, assets: AssetMap, source: ClipSource): SourceInfo {
  switch (source.type) {
    case 'media': {
      const asset = assets.get(source.assetId);
      if (!asset) return { name: 'Media Offline', hasVideo: true, hasAudio: false, length: Infinity, width: 1920, height: 1080 };
      return {
        name: asset.name,
        hasVideo: asset.kind !== 'audio',
        hasAudio: asset.kind !== 'image' && asset.hasAudio,
        length: asset.kind === 'image' ? Infinity : asset.duration,
        width: asset.width || 1920,
        height: asset.height || 1080,
      };
    }
    case 'comp': {
      const comp = project.comps.find((item) => item.id === source.compId);
      if (!comp) return { name: 'Missing comp', hasVideo: true, hasAudio: false, length: Infinity, width: 1920, height: 1080 };
      const audioTracks = new Set(tracksOf(comp, 'audio').map((track) => track.id));
      return { name: comp.name, hasVideo: true, hasAudio: comp.clips.some((clip) => audioTracks.has(clip.trackId)), length: Math.max(compDuration(comp), 1 / comp.fps), width: comp.width, height: comp.height };
    }
    case 'item': {
      const item = project.items.find((entry) => entry.id === source.itemId);
      if (!item) return { name: 'Missing item', hasVideo: true, hasAudio: false, length: Infinity, width: 1920, height: 1080 };
      return { name: item.name, hasVideo: true, hasAudio: item.kind === 'bars-and-tone' || item.kind === 'countdown', length: item.kind === 'countdown' ? item.duration : Infinity, width: item.width, height: item.height };
    }
    case 'text':
      return { name: source.text, hasVideo: true, hasAudio: false, length: Infinity, width: 1920, height: 1080 };
    case 'shape':
      return { name: source.shape === 'rectangle' ? 'Rectangle' : source.shape === 'ellipse' ? 'Ellipse' : 'Polygon', hasVideo: true, hasAudio: false, length: Infinity, width: source.width, height: source.height };
    case 'html':
      return { name: source.title || 'Motion Graphic', hasVideo: true, hasAudio: false, length: Infinity, width: 1920, height: 1080 };
    case 'sfx':
      return { name: source.kind[0].toUpperCase() + source.kind.slice(1), hasVideo: false, hasAudio: true, length: SFX_LENGTH[source.kind], width: 0, height: 0 };
    case 'motion':
      return { name: source.title || source.scene.template?.id || 'Motion scene', hasVideo: true, hasAudio: false, length: source.scene.duration, width: source.scene.width, height: source.scene.height };
    case 'scene3d':
      return { name: source.title || source.scene?.name || '3D Scene', hasVideo: true, hasAudio: false, length: source.scene?.duration ?? Infinity, width: 1920, height: 1080 };
  }
}

export function defaultDuration(project: Project, assets: AssetMap, source: ClipSource): number {
  if (source.type === 'text') return DEFAULT_TEXT[source.preset].duration;
  if (source.type === 'item') return project.items.find((item) => item.id === source.itemId)?.duration ?? STILL_DEFAULT;
  const { length } = sourceInfo(project, assets, source);
  return Number.isFinite(length) ? length : STILL_DEFAULT;
}

export const clipName = (project: Project, assets: AssetMap, clip: Clip) => clip.name || sourceInfo(project, assets, clip.source).name;

/** How far a clip may run into its source. Frame holds and reversed clips read the same window. */
export const sourceLimit = (project: Project, assets: AssetMap, clip: Clip) => sourceInfo(project, assets, clip.source).length;

/**
 * Builds the clips for a source placed at `start`: a picture on `videoTrack`, sound on
 * `audioTrack`, linked when both are present.
 */
export function clipsForSource(
  project: Project,
  assets: AssetMap,
  source: ClipSource,
  options: { start: number; videoTrack: string | null; audioTrack: string | null; in?: number; duration?: number },
): Clip[] {
  const info = sourceInfo(project, assets, source);
  const inPoint = Math.max(0, options.in ?? 0);
  const available = Number.isFinite(info.length) ? info.length - inPoint : Infinity;
  const duration = Math.max(MIN_DURATION, Math.min(options.duration ?? defaultDuration(project, assets, source) - (Number.isFinite(info.length) ? inPoint : 0), available));
  const clips: Clip[] = [];
  const both = info.hasVideo && info.hasAudio && options.videoTrack && options.audioTrack;
  const linkId = both ? uid() : null;
  if (info.hasVideo && options.videoTrack) clips.push(newClip({ trackId: options.videoTrack, start: options.start, duration, in: inPoint, source, linkId }));
  if (info.hasAudio && options.audioTrack) clips.push(newClip({ trackId: options.audioTrack, start: options.start, duration, in: inPoint, source, linkId }));
  return clips;
}

// ───────────────────────────── primitives ─────────────────────────────

/**
 * What one operation learned while splitting: link ids of right-hand pieces (so they stay linked
 * to each other) and which new clip now carries an old clip's tail (so tail transitions follow).
 */
export type Ctx = { links: Map<string, string>; tails: Map<string, string> };
export const newCtx = (): Ctx => ({ links: new Map(), tails: new Map() });

const relink = (ctx: Ctx, linkId: string | null) => {
  if (!linkId) return null;
  if (!ctx.links.has(linkId)) ctx.links.set(linkId, uid());
  return ctx.links.get(linkId) ?? null;
};

/** Where playback is inside the source for a head moved `offset` timeline seconds into the clip. */
const advance = (clip: Clip, offset: number) => (clip.reverse ? clip.in : clip.in + offset * clip.speed);
/** Source in for the right-hand piece of a reversed clip is unchanged at the tail end; the head moves. */
const reversedHeadIn = (clip: Clip, keptHead: number) => clip.in + (clip.duration - keptHead) * clip.speed;

function head(clip: Clip, length: number): Clip {
  // A reversed clip shows its source backwards, so its head is the END of its source window.
  return clip.reverse ? { ...clip, in: reversedHeadIn(clip, length), duration: length } : { ...clip, duration: length };
}

function tail(clip: Clip, from: number, ctx: Ctx, newId: boolean): Clip {
  const offset = from - clip.start;
  const piece: Clip = {
    ...clip,
    id: newId ? uid() : clip.id,
    linkId: newId ? relink(ctx, clip.linkId) : clip.linkId,
    start: from,
    in: advance(clip, offset),
    duration: clipEnd(clip) - from,
    keyframes: shiftKeys(clip.keyframes, offset),
  };
  if (newId) ctx.tails.set(clip.id, piece.id);
  return piece;
}

/** Everything in `[start, end)` on `trackId` disappears: clips inside go, straddlers are trimmed or split. */
export function clearRange(clips: Clip[], trackId: string, start: number, end: number, keep: Set<string> = new Set(), ctx: Ctx = newCtx()): Clip[] {
  if (end - start < EPS) return clips;
  const out: Clip[] = [];
  for (const clip of clips) {
    const s = clip.start;
    const e = clipEnd(clip);
    if (clip.trackId !== trackId || keep.has(clip.id) || e <= start + EPS || s >= end - EPS) {
      out.push(clip);
      continue;
    }
    const keepsHead = s < start - EPS;
    const keepsTail = e > end + EPS;
    if (keepsHead) out.push(head(clip, start - s));
    if (keepsTail) out.push(tail(clip, end, ctx, keepsHead));
  }
  return out;
}

/** Cuts clips crossing `time` on `tracks` (all when null), or only `only`. */
export function splitAt(clips: Clip[], time: number, tracks: Set<string> | null, ctx: Ctx = newCtx(), only?: Set<string>): Clip[] {
  const out: Clip[] = [];
  for (const clip of clips) {
    const crosses = clip.start < time - MIN_DURATION && clipEnd(clip) > time + MIN_DURATION;
    if (!crosses || (tracks && !tracks.has(clip.trackId)) || (only && !only.has(clip.id))) {
      out.push(clip);
      continue;
    }
    out.push(head(clip, time - clip.start));
    out.push(tail(clip, time, ctx, true));
  }
  return out;
}

/** Moves every clip starting at or after `time` on `tracks` by `amount`, splitting what crosses `time` first. */
export function shiftFrom(clips: Clip[], time: number, amount: number, tracks: Set<string>, ctx: Ctx = newCtx()): Clip[] {
  return splitAt(clips, time, tracks, ctx).map((clip) =>
    tracks.has(clip.trackId) && clip.start >= time - EPS ? { ...clip, start: Math.max(0, clip.start + amount) } : clip,
  );
}

const unlockedIds = (comp: Comp) => new Set(comp.tracks.filter((track) => !track.locked).map((track) => track.id));
const lockedIds = (comp: Comp) => new Set(comp.tracks.filter((track) => track.locked).map((track) => track.id));
/** Tracks an insert or ripple elsewhere carries along: unlocked and sync-locked, plus `edited`. */
const syncIds = (comp: Comp, edited: Iterable<string> = []) => {
  const ids = new Set(comp.tracks.filter((track) => !track.locked && track.syncLock).map((track) => track.id));
  const locked = lockedIds(comp);
  for (const id of edited) if (!locked.has(id)) ids.add(id);
  return ids;
};

/** Keeps transitions attached to their clips and drops those whose edit point is gone. */
export function tidy(comp: Comp, ctx?: Ctx): Comp {
  if (!comp.transitions.length) return comp;
  const trackMap = new Map(comp.tracks.map((t) => [t.id, t]));
  const byId = new Map(comp.clips.map((clip) => [clip.id, clip]));
  const follow = (id: string | null) => {
    let current = id;
    const seen = new Set<string>();
    while (current && ctx?.tails.has(current) && !seen.has(current)) {
      seen.add(current);
      current = ctx.tails.get(current) ?? current;
    }
    return current;
  };
  const transitions: Transition[] = [];
  for (const transition of comp.transitions) {
    const track = trackMap.get(transition.trackId);
    if (!track) continue;
    if (isAudioTransition(transition.kind) !== (track.kind === 'audio')) continue;
    const fromClip = follow(transition.fromClip);
    const from = fromClip ? byId.get(fromClip) : undefined;
    const to = transition.toClip ? byId.get(transition.toClip) : undefined;
    if (transition.fromClip && (!from || from.trackId !== transition.trackId)) continue;
    if (transition.toClip && (!to || to.trackId !== transition.trackId)) continue;
    if (!from && !to) continue;
    if (from && to && Math.abs(clipEnd(from) - to.start) > 2 * EPS) continue;
    const room = from && to ? from.duration + to.duration : (from ?? to)?.duration ?? 0;
    if (room <= 0) continue;
    transitions.push({ ...transition, fromClip: fromClip ?? null, duration: Math.min(transition.duration, room) });
  }
  return { ...comp, transitions };
}

/** Places clips with overwrite (replace what is under them) or insert (push everything later). */
export function placeClips(comp: Comp, incoming: Clip[], mode: PlaceMode): Comp {
  const locked = lockedIds(comp);
  const placeable = incoming.filter((clip) => !locked.has(clip.trackId) && comp.tracks.some((track) => track.id === clip.trackId));
  if (!placeable.length) return comp;
  const ctx = newCtx();
  let clips = comp.clips;
  let markers = comp.markers;
  if (mode === 'insert') {
    const at = Math.min(...placeable.map((clip) => clip.start));
    const amount = Math.max(...placeable.map(clipEnd)) - at;
    clips = shiftFrom(clips, at, amount, syncIds(comp, placeable.map((clip) => clip.trackId)), ctx);
    markers = markers.map((marker) => (marker.time >= at - EPS ? { ...marker, time: marker.time + amount } : marker));
  } else {
    for (const clip of placeable) clips = clearRange(clips, clip.trackId, clip.start, clipEnd(clip), new Set(), ctx);
  }
  return tidy({ ...comp, clips: [...clips, ...placeable], markers }, ctx);
}

/**
 * Moves clips on `tracks` that start at or after `from` by `amount` (negative closes a gap),
 * skipping any track where the move would run into a clip that stays put.
 */
function rippleTracks(clips: Clip[], from: number, amount: number, tracks: Set<string>): Clip[] {
  if (Math.abs(amount) < EPS) return clips;
  const movable = new Set<string>();
  for (const trackId of tracks) {
    const onTrack = clips.filter((clip) => clip.trackId === trackId);
    const later = onTrack.filter((clip) => clip.start >= from - EPS);
    if (!later.length) continue;
    if (amount < 0) {
      const earliest = Math.min(...later.map((clip) => clip.start));
      const blocking = onTrack.filter((clip) => clip.start < from - EPS).reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
      if (earliest + amount < blocking - EPS) continue;
    }
    movable.add(trackId);
  }
  return clips.map((clip) => (movable.has(clip.trackId) && clip.start >= from - EPS ? { ...clip, start: Math.max(0, clip.start + amount) } : clip));
}

/** Deletes clips; with `ripple`, later material moves up to close each gap. */
export function removeClips(comp: Comp, ids: Iterable<string>, ripple: boolean): Comp {
  const locked = lockedIds(comp);
  const doomed = new Set([...ids].filter((id) => {
    const clip = comp.clips.find((item) => item.id === id);
    return clip && !locked.has(clip.trackId);
  }));
  if (!doomed.size) return comp;
  const removed = comp.clips.filter((clip) => doomed.has(clip.id));
  let clips = comp.clips.filter((clip) => !doomed.has(clip.id));
  if (ripple) {
    // Close each removed span, latest first, on the edited and sync-locked tracks that are empty there.
    const spans = mergeSpans(removed.map((clip) => [clip.start, clipEnd(clip)] as [number, number]));
    const tracks = syncIds(comp, removed.map((clip) => clip.trackId));
    for (const [start, end] of spans.reverse()) {
      const occupied = new Set(clips.filter((clip) => clip.start < end - EPS && clipEnd(clip) > start + EPS).map((clip) => clip.trackId));
      clips = rippleTracks(clips, end, start - end, new Set([...tracks].filter((id) => !occupied.has(id))));
    }
  }
  return tidy({ ...comp, clips });
}

function mergeSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/** Lift (leave the gap) or extract (close it) the range on `tracks` (every unlocked track when null). */
export function removeRange(comp: Comp, start: number, end: number, mode: 'lift' | 'extract', tracks: string[] | null = null): Comp {
  if (end - start < EPS) return comp;
  const unlocked = unlockedIds(comp);
  const targets = new Set((tracks ?? [...unlocked]).filter((id) => unlocked.has(id)));
  const ctx = newCtx();
  let clips = comp.clips;
  for (const trackId of targets) clips = clearRange(clips, trackId, start, end, new Set(), ctx);
  let markers = comp.markers;
  if (mode === 'extract') {
    const gap = end - start;
    const moving = new Set([...targets, ...syncIds(comp)]);
    clips = clips.map((clip) => (moving.has(clip.trackId) && clip.start >= end - EPS ? { ...clip, start: clip.start - gap } : clip));
    markers = markers.filter((marker) => marker.time < start || marker.time >= end).map((marker) => (marker.time >= end ? { ...marker, time: marker.time - gap } : marker));
  }
  return tidy({ ...comp, clips, markers, inPoint: null, outPoint: null }, ctx);
}

/** The empty span on a track around `time`, if `time` is in a gap between clips. */
export function gapAt(comp: Comp, trackId: string, time: number): { start: number; end: number } | null {
  const clips = clipsOn(comp, trackId);
  let previousEnd = 0;
  for (const clip of clips) {
    if (time < clip.start - EPS) return time >= previousEnd - EPS && clip.start - previousEnd > EPS ? { start: previousEnd, end: clip.start } : null;
    if (time < clipEnd(clip)) return null;
    previousEnd = clipEnd(clip);
  }
  return null;
}

/** Ripple Delete on a gap: everything after it moves up. */
export function closeGap(comp: Comp, trackId: string, time: number): Comp {
  const gap = gapAt(comp, trackId, time);
  if (!gap) return comp;
  return tidy({ ...comp, clips: rippleTracks(comp.clips, gap.end, gap.start - gap.end, syncIds(comp, [trackId])) });
}

// ───────────────────────────── move ─────────────────────────────

/**
 * Moves (or with `duplicate`, copies) clips by `dt` seconds and by whole tracks — video and
 * audio shift independently — then overwrites or inserts at the destination. Returns null when
 * the destination is impossible (below V1/A1 or a locked track).
 */
export function moveClips(comp: Comp, ids: string[], dt: number, shift: { video: number; audio: number }, mode: PlaceMode, duplicate = false): { comp: Comp; ids: string[] } | null {
  const chosen = new Set(ids);
  const moving = comp.clips.filter((clip) => chosen.has(clip.id));
  if (!moving.length) return null;
  const locked = lockedIds(comp);
  if (moving.some((clip) => locked.has(clip.trackId))) return null;
  const delta = Math.max(dt, -Math.min(...moving.map((clip) => clip.start)));
  let next = comp;
  const destinations = new Map<string, string>();
  for (const clip of moving) {
    const track = trackOf(comp, clip.trackId);
    if (!track) return null;
    const index = trackIndex(comp, clip.trackId) + (track.kind === 'video' ? shift.video : shift.audio);
    if (index < 0) return null;
    const ensured = ensureTrack(next, track.kind, index);
    next = ensured.comp;
    if (ensured.track.locked) return null;
    destinations.set(clip.id, ensured.track.id);
  }
  const ctx = newCtx();
  const groupCopies = new Map<string, string>();
  const idMap = new Map<string, string>();
  const placed = moving.map((clip) => {
    const id = duplicate ? uid() : clip.id;
    idMap.set(clip.id, id);
    return {
      ...clip,
      id,
      linkId: duplicate ? relink(ctx, clip.linkId) : clip.linkId,
      groupId: duplicate && clip.groupId ? (groupCopies.get(clip.groupId) ?? (groupCopies.set(clip.groupId, uid()), groupCopies.get(clip.groupId) ?? null)) : clip.groupId,
      trackId: destinations.get(clip.id) ?? clip.trackId,
      start: clip.start + delta,
    };
  });
  const remaining = duplicate ? next.clips : next.clips.filter((clip) => !chosen.has(clip.id));
  // Transitions that belong entirely to the moved clips travel with them (copies get copies).
  const carried = next.transitions.filter((transition) => [transition.fromClip, transition.toClip].every((id) => !id || chosen.has(id)) && (transition.fromClip || transition.toClip));
  const moved = carried.map((transition) => ({
    ...transition,
    id: duplicate ? uid() : transition.id,
    trackId: destinations.get((transition.fromClip ?? transition.toClip) as string) ?? transition.trackId,
    fromClip: transition.fromClip ? (idMap.get(transition.fromClip) ?? null) : null,
    toClip: transition.toClip ? (idMap.get(transition.toClip) ?? null) : null,
  }));
  const base: Comp = { ...next, clips: remaining, transitions: duplicate ? next.transitions : next.transitions.filter((transition) => !carried.includes(transition)) };
  const result = placeClips(base, placed, mode);
  return { comp: tidy({ ...result, transitions: [...result.transitions, ...moved] }), ids: placed.map((clip) => clip.id) };
}

/** A copied clip with the kind and index of the track it was copied from. */
export type ClipboardEntry = { clip: Clip; kind: TrackKind; index: number };

/**
 * Paste: copied clips placed in `destCompId` from `at` on, keeping their spacing, each on the
 * same kind and number of track it came from (added when the comp lacks it). Links and groups
 * among the pasted clips are made fresh so they never join the originals, and a nested comp
 * that would end up inside itself is skipped (`skipped` holds those clips' ids).
 */
export function pasteClips(project: Project, destCompId: string, board: { clips: ClipboardEntry[]; comp: string }, at: number, mode: PlaceMode): { project: Project; ids: string[]; skipped: string[] } {
  const dest = project.comps.find((comp) => comp.id === destCompId);
  const skipped = board.clips.filter(({ clip }) => clip.source.type === 'comp' && wouldCycle(project, destCompId, clip.source.compId)).map(({ clip }) => clip.id);
  const entries = board.clips.filter(({ clip }) => !skipped.includes(clip.id));
  if (!dest || !entries.length) return { project, ids: [], skipped };
  const earliest = Math.min(...entries.map(({ clip }) => clip.start));
  const links = newCtx();
  const groups = newCtx();
  let next = dest;
  const placed = entries.map(({ clip, kind, index }) => {
    const ensured = ensureTrack(next, kind, index);
    next = ensured.comp;
    return { ...clip, id: uid(), linkId: relink(links, clip.linkId), groupId: relink(groups, clip.groupId), trackId: ensured.track.id, start: at + (clip.start - earliest) };
  });
  return { project: updateComp(project, destCompId, () => placeClips(next, placed, mode)), ids: placed.map((clip) => clip.id), skipped };
}

// ───────────────────────────── trim ─────────────────────────────

export type TrimMode = 'normal' | 'ripple' | 'rolling' | 'stretch';

/** The clip right before/after `clip` on its track that touches it. */
export function neighbour(clips: Clip[], clip: Clip, side: 'before' | 'after'): Clip | undefined {
  return clips.find((other) => other.trackId === clip.trackId && other.id !== clip.id && (side === 'before' ? Math.abs(clipEnd(other) - clip.start) < 2 * EPS : Math.abs(other.start - clipEnd(clip)) < 2 * EPS));
}

function bounds(clips: Clip[], clip: Clip) {
  const others = clips.filter((other) => other.trackId === clip.trackId && other.id !== clip.id);
  const before = others.filter((other) => clipEnd(other) <= clip.start + EPS).reduce((end, other) => Math.max(end, clipEnd(other)), 0);
  const after = others.filter((other) => other.start >= clipEnd(clip) - EPS).reduce((start, other) => Math.min(start, other.start), Infinity);
  return { before, after };
}

/** How far a clip's head may extend earlier (in source seconds available before `in`). */
const headRoom = (clip: Clip, limit: number) => (clip.hold !== null ? Infinity : clip.reverse ? limit - sourceOut(clip) : clip.in);
/** How far its tail may extend later. */
const tailRoom = (clip: Clip, limit: number) => (clip.hold !== null ? Infinity : clip.reverse ? clip.in : limit - sourceOut(clip));

/**
 * Drags the `edge` of a clip (and of linked clips sharing that edge, unless `alone`) toward
 * `target` seconds. `limit(clip)` is how long the clip's source runs. The target is clamped
 * identically for the whole group so linked audio and video stay in sync.
 */
export function trimEdge(comp: Comp, clipId: string, edge: 'in' | 'out', target: number, mode: TrimMode, limit: (clip: Clip) => number, options: { minDuration?: number; alone?: boolean } = {}): Comp {
  const minDuration = options.minDuration ?? MIN_DURATION;
  const clip = comp.clips.find((item) => item.id === clipId);
  if (!clip) return comp;
  const locked = lockedIds(comp);
  const edgeTime = edge === 'in' ? clip.start : clipEnd(clip);
  const group = comp.clips.filter((item) =>
    !locked.has(item.trackId) && (item.id === clip.id || (!options.alone && clip.linkId && item.linkId === clip.linkId && Math.abs((edge === 'in' ? item.start : clipEnd(item)) - edgeTime) < 2 * EPS)),
  );
  if (!group.length) return comp;

  let low = -Infinity;
  let high = Infinity;
  for (const item of group) {
    const { before, after } = bounds(comp.clips, item);
    const sourceEnd = limit(item);
    if (mode === 'stretch') {
      const sourceLength = item.duration * item.speed;
      if (edge === 'out') {
        low = Math.max(low, item.start + Math.max(minDuration, sourceLength / 20));
        high = Math.min(high, after, item.start + sourceLength / 0.05);
      } else {
        low = Math.max(low, before, clipEnd(item) - sourceLength / 0.05);
        high = Math.min(high, clipEnd(item) - Math.max(minDuration, sourceLength / 20));
      }
      continue;
    }
    if (edge === 'out') {
      low = Math.max(low, item.start + minDuration);
      high = Math.min(high, clipEnd(item) + tailRoom(item, sourceEnd) / item.speed);
      if (mode === 'normal') high = Math.min(high, after);
      if (mode === 'rolling') {
        const next = neighbour(comp.clips, item, 'after');
        if (next) {
          low = Math.max(low, next.start - headRoom(next, limit(next)) / next.speed);
          high = Math.min(high, clipEnd(next) - minDuration);
        } else high = Math.min(high, after);
      }
    } else {
      high = Math.min(high, clipEnd(item) - minDuration);
      low = Math.max(low, item.start - headRoom(item, sourceEnd) / item.speed);
      if (mode === 'normal') low = Math.max(low, before);
      if (mode === 'rolling') {
        const previous = neighbour(comp.clips, item, 'before');
        if (previous) {
          low = Math.max(low, previous.start + minDuration);
          high = Math.min(high, clipEnd(previous) + tailRoom(previous, limit(previous)) / previous.speed);
        } else low = Math.max(low, before);
      }
    }
  }
  if (low > high) return comp;
  const to = clamp(target, low, high);
  const delta = to - edgeTime;
  if (Math.abs(delta) < 1e-9) return comp;

  const groupIds = new Set(group.map((item) => item.id));
  const extendHead = (item: Clip, amount: number): Clip => ({
    // `amount` > 0 trims the head; < 0 reveals more of it.
    ...item,
    in: item.hold !== null || item.reverse ? item.in : item.in + amount * item.speed,
    keyframes: shiftKeys(item.keyframes, amount),
  });
  const extendTail = (item: Clip, amount: number): Clip => (item.reverse && item.hold === null ? { ...item, in: item.in - amount * item.speed } : item);

  let clips = comp.clips.map((item) => {
    if (!groupIds.has(item.id)) return item;
    if (mode === 'stretch') {
      const sourceLength = item.duration * item.speed;
      const duration = edge === 'out' ? to - item.start : clipEnd(item) - to;
      const scale = duration / item.duration;
      const keyframes = { ...item.keyframes };
      for (const name of Object.keys(keyframes) as (keyof typeof keyframes)[]) keyframes[name] = keyframes[name].map((key) => ({ ...key, time: key.time * scale }));
      return { ...item, start: edge === 'in' ? to : item.start, duration, speed: clamp(sourceLength / duration, 0.05, 20), keyframes };
    }
    if (edge === 'out') return { ...extendTail(item, delta), duration: to - item.start };
    if (mode === 'ripple') return { ...extendHead(item, delta), duration: item.duration - delta };
    return { ...extendHead(item, delta), start: to, duration: clipEnd(item) - to };
  });

  if (mode === 'rolling') {
    const partners = new Set(group.map((item) => neighbour(comp.clips, item, edge === 'out' ? 'after' : 'before')?.id).filter(Boolean) as string[]);
    clips = clips.map((item) => {
      if (!partners.has(item.id) || locked.has(item.trackId)) return item;
      return edge === 'out'
        ? { ...extendHead(item, delta), start: item.start + delta, duration: item.duration - delta }
        : { ...extendTail(item, delta), duration: item.duration + delta };
    });
  }
  if (mode === 'ripple') {
    // Out edge: later material follows the new end. In edge: the head was trimmed in place, so
    // everything after the clip moves by the length removed.
    const amount = edge === 'out' ? delta : -delta;
    const others = rippleTracks(clips.filter((item) => !groupIds.has(item.id)), clipEnd(clip), amount, syncIds(comp, group.map((item) => item.trackId)));
    clips = [...others, ...clips.filter((item) => groupIds.has(item.id))];
  }
  return tidy({ ...comp, clips });
}

/** Slip: same position and length, different part of the source. */
export function slipClip(comp: Comp, clipId: string, sourceDelta: number, limit: (clip: Clip) => number): Comp {
  const clip = comp.clips.find((item) => item.id === clipId);
  if (!clip || trackOf(comp, clip.trackId)?.locked || clip.hold !== null) return comp;
  const group = comp.clips.filter((item) => item.id === clip.id || (clip.linkId && item.linkId === clip.linkId && Math.abs(item.start - clip.start) < 2 * EPS && Math.abs(item.duration - clip.duration) < 2 * EPS));
  let low = -Infinity;
  let high = Infinity;
  for (const item of group) {
    low = Math.max(low, -item.in);
    high = Math.min(high, limit(item) - sourceOut(item));
  }
  if (low > high) return comp;
  const delta = clamp(sourceDelta, low, high);
  const ids = new Set(group.map((item) => item.id));
  return { ...comp, clips: comp.clips.map((item) => (ids.has(item.id) ? { ...item, in: item.in + delta } : item)) };
}

/** Slide: the clip moves; the clip before gets longer or shorter at its tail, the one after at its head. */
export function slideClip(comp: Comp, clipId: string, dt: number, limit: (clip: Clip) => number, minDuration = MIN_DURATION): Comp {
  const clip = comp.clips.find((item) => item.id === clipId);
  if (!clip) return comp;
  const locked = lockedIds(comp);
  const group = comp.clips.filter((item) => !locked.has(item.trackId) && (item.id === clip.id || (clip.linkId && item.linkId === clip.linkId && Math.abs(item.start - clip.start) < 2 * EPS)));
  let low = -Infinity;
  let high = Infinity;
  const plan = group.map((item) => {
    const previous = neighbour(comp.clips, item, 'before');
    const next = neighbour(comp.clips, item, 'after');
    const { before, after } = bounds(comp.clips, item);
    if (previous) {
      low = Math.max(low, -(previous.duration - minDuration));
      high = Math.min(high, tailRoom(previous, limit(previous)) / previous.speed);
    } else low = Math.max(low, before - item.start);
    if (next) {
      high = Math.min(high, next.duration - minDuration);
      low = Math.max(low, -headRoom(next, limit(next)) / next.speed);
    } else high = Math.min(high, after - clipEnd(item));
    return { item, previous, next };
  });
  if (low > high) return comp;
  const delta = clamp(dt, low, high);
  const changes = new Map<string, Clip>();
  for (const { item, previous, next } of plan) {
    changes.set(item.id, { ...item, start: item.start + delta });
    if (previous) changes.set(previous.id, { ...previous, duration: previous.duration + delta });
    if (next) changes.set(next.id, { ...next, start: next.start + delta, in: next.hold !== null || next.reverse ? next.in : next.in + delta * next.speed, duration: next.duration - delta, keyframes: shiftKeys(next.keyframes, delta) });
  }
  return tidy({ ...comp, clips: comp.clips.map((item) => changes.get(item.id) ?? item) });
}

/** Razor at `time` on `tracks` (every unlocked track when null), or only on `clipIds` (and their links unless `links` is false). */
export function razor(comp: Comp, time: number, tracks: string[] | null, clipIds?: string[], links = true): Comp {
  const unlocked = unlockedIds(comp);
  const trackSet = new Set((tracks ?? [...unlocked]).filter((id) => unlocked.has(id)));
  const only = clipIds ? new Set(links ? withLinked(comp, clipIds, false) : clipIds) : undefined;
  const ctx = newCtx();
  return tidy({ ...comp, clips: splitAt(comp.clips, time, trackSet, ctx, only) }, ctx);
}

/** Speed/Duration: the source range stays the same unless a duration is given. Without ripple the clip is cut short rather than overlap the next one. */
export function setSpeed(comp: Comp, ids: string[], options: { speed: number; duration?: number; ripple?: boolean; reverse?: boolean; maintainPitch?: boolean; interpolation?: Clip['interpolation']; limit: (clip: Clip) => number }): Comp {
  let next = comp;
  for (const id of ids) {
    const clip = next.clips.find((item) => item.id === id);
    if (!clip || trackOf(next, clip.trackId)?.locked) continue;
    const rate = clamp(options.speed, 0.05, 20);
    const wanted = options.duration ?? (clip.duration * clip.speed) / rate;
    const maxBySource = clip.hold !== null ? Infinity : (options.limit(clip) - clip.in) / rate;
    let duration = Math.max(MIN_DURATION, Math.min(wanted, maxBySource));
    const { after } = bounds(next.clips, clip);
    let clips = next.clips;
    if (options.ripple) clips = [...rippleTracks(clips.filter((item) => item.id !== clip.id), clipEnd(clip), clip.start + duration - clipEnd(clip), syncIds(next, [clip.trackId])), clip];
    else duration = Math.min(duration, after - clip.start);
    const scale = duration / clip.duration;
    next = {
      ...next,
      clips: clips.map((item) => (item.id !== clip.id ? item : {
        ...item,
        speed: rate,
        duration,
        reverse: options.reverse ?? item.reverse,
        maintainPitch: options.maintainPitch ?? item.maintainPitch,
        interpolation: options.interpolation ?? item.interpolation,
        keyframes: Object.fromEntries(Object.entries(item.keyframes).map(([name, keys]) => [name, keys.map((key) => ({ ...key, time: key.time * scale }))])) as Clip['keyframes'],
      })),
    };
  }
  return tidy(next);
}

// ───────────────────────────── link, group, holds, attributes ─────────────────────────────

/** Link selected clips into one unit (Premiere: Link), or break their links (Unlink). */
export function setLinked(comp: Comp, ids: string[], linked: boolean): Comp {
  const chosen = new Set(linked ? ids : withLinked(comp, ids, false));
  const linkId = linked ? uid() : null;
  return { ...comp, clips: comp.clips.map((clip) => (chosen.has(clip.id) ? { ...clip, linkId } : clip)) };
}

export function setGrouped(comp: Comp, ids: string[], grouped: boolean): Comp {
  const chosen = new Set(grouped ? ids : withLinked(comp, ids));
  const groupId = grouped ? uid() : null;
  return { ...comp, clips: comp.clips.map((clip) => (chosen.has(clip.id) ? { ...clip, groupId } : clip)) };
}

/** The source time a clip shows at timeline time `time`. */
export function sourceTimeAt(clip: Clip, time: number): number {
  if (clip.hold !== null) return clip.hold;
  const offset = clamp(time - clip.start, 0, clip.duration) * clip.speed;
  return clip.reverse ? sourceOut(clip) - offset : clip.in + offset;
}

/**
 * Where each comp's clock stands at `time` of `compId`: the root at `time`, then every comp nested
 * in a clip that is on screen (enabled, on a visible track), followed down. A comp nested twice
 * lists both times.
 */
export function compClocks(project: Project, compId: string, time: number): Map<string, number[]> {
  const clocks = new Map<string, number[]>();
  const walk = (id: string, t: number, depth: number) => {
    if (depth > 6) return;
    clocks.set(id, [...(clocks.get(id) ?? []), t]);
    const comp = project.comps.find((entry) => entry.id === id);
    if (!comp) return;
    const hidden = new Set(comp.tracks.filter((track) => track.hidden).map((track) => track.id));
    for (const clip of comp.clips) {
      if (!clip.enabled || hidden.has(clip.trackId) || clip.source.type !== 'comp' || t < clip.start || t >= clipEnd(clip)) continue;
      walk(clip.source.compId, sourceTimeAt(clip, t), depth + 1);
    }
  };
  walk(compId, time, 0);
  return clocks;
}

/** Add Frame Hold: the part of each video clip after `time` freezes on the frame at `time`. */
export function addFrameHold(comp: Comp, ids: string[], time: number): Comp {
  const video = new Set(tracksOf(comp, 'video').map((track) => track.id));
  const targets = comp.clips.filter((clip) => ids.includes(clip.id) && video.has(clip.trackId) && clip.start < time && clipEnd(clip) > time);
  if (!targets.length) return comp;
  const ctx = newCtx();
  let clips = splitAt(comp.clips, time, null, ctx, new Set(targets.map((clip) => clip.id)));
  const holds = new Map(targets.map((clip) => [ctx.tails.get(clip.id), sourceTimeAt(clip, time)]));
  clips = clips.map((clip) => (holds.has(clip.id) ? { ...clip, hold: holds.get(clip.id) ?? 0, linkId: null, keyframes: { ...EMPTY_KEYFRAMES } } : clip));
  return tidy({ ...comp, clips }, ctx);
}

/** Insert Frame Hold Segment: a still of the frame at `time`, `length` long, pushes the rest later. */
export function insertFrameHold(comp: Comp, clipId: string, time: number, length = 2): Comp {
  const clip = comp.clips.find((item) => item.id === clipId);
  if (!clip || clip.start > time || clipEnd(clip) < time) return comp;
  const hold = newClip({ ...clip, id: uid(), start: time, duration: length, hold: sourceTimeAt(clip, time), linkId: null, groupId: null, keyframes: { ...EMPTY_KEYFRAMES } });
  return placeClips(comp, [hold], 'insert');
}

export type AttributeSet = { motion: boolean; opacity: boolean; crop: boolean; effects: boolean; speed: boolean; volume: boolean; mask: boolean; audio: boolean };

/** Paste Attributes: copies the chosen properties (and their keyframes) from `from` onto clips. */
export function pasteAttributes(comp: Comp, ids: string[], from: Clip, attributes: AttributeSet, limit: (clip: Clip) => number): Comp {
  let next = comp;
  const chosen = new Set(ids);
  next = {
    ...next,
    clips: next.clips.map((clip) => {
      if (!chosen.has(clip.id) || trackOf(next, clip.trackId)?.locked) return clip;
      const out = { ...clip, transform: { ...clip.transform }, keyframes: { ...clip.keyframes } };
      if (attributes.motion) {
        Object.assign(out.transform, { fit: from.transform.fit, x: from.transform.x, y: from.transform.y, scale: from.transform.scale, rotation: from.transform.rotation });
        for (const name of ['x', 'y', 'scale', 'rotation'] as const) out.keyframes[name] = from.keyframes[name];
      }
      if (attributes.opacity) {
        out.transform.opacity = from.transform.opacity;
        out.keyframes.opacity = from.keyframes.opacity;
      }
      if (attributes.crop) Object.assign(out.transform, { cropLeft: from.transform.cropLeft, cropTop: from.transform.cropTop, cropRight: from.transform.cropRight, cropBottom: from.transform.cropBottom });
      if (attributes.effects) out.effects = { ...from.effects };
      if (attributes.mask) out.mask = from.mask ? { ...from.mask, points: [...from.mask.points] } : null;
      if (attributes.volume) {
        out.volume = from.volume;
        out.keyframes.volume = from.keyframes.volume;
      }
      if (attributes.audio) Object.assign(out, { channels: from.channels, enhanceSpeech: from.enhanceSpeech });
      return out;
    }),
  };
  if (attributes.speed) next = setSpeed(next, ids, { speed: from.speed, reverse: from.reverse, maintainPitch: from.maintainPitch, interpolation: from.interpolation, limit });
  return tidy(next);
}

/** Remove Attributes: puts the chosen properties back to their defaults. */
export function removeAttributes(comp: Comp, ids: string[], attributes: AttributeSet, limit: (clip: Clip) => number): Comp {
  const blank = newClip({ trackId: '', start: 0, duration: 1, source: { type: 'sfx', kind: 'pop' } });
  return pasteAttributes(comp, ids, { ...blank, volume: 1 }, attributes, limit);
}

/** Replace With Clip: new source, same position, length and attributes. */
export function replaceSource(comp: Comp, ids: string[], source: ClipSource, inPoint: number): Comp {
  const chosen = new Set(ids);
  return { ...comp, clips: comp.clips.map((clip) => (chosen.has(clip.id) ? { ...clip, source, in: Math.max(0, inPoint), hold: null, name: null } : clip)) };
}

/** Synchronize: moves clips so their chosen sync points line up with the first clip's. */
export function synchronize(comp: Comp, ids: string[], mode: 'start' | 'end' | 'source'): Comp {
  const clips = comp.clips.filter((clip) => ids.includes(clip.id)).sort((a, b) => trackIndex(comp, a.trackId) - trackIndex(comp, b.trackId));
  if (clips.length < 2) return comp;
  const point = (clip: Clip) => (mode === 'start' ? clip.start : mode === 'end' ? clipEnd(clip) : clip.start - clip.in / clip.speed);
  const anchor = point(clips[0]);
  let next = comp;
  for (const clip of clips.slice(1)) {
    const moved = moveClips(next, [clip.id], anchor - point(clip), { video: 0, audio: 0 }, 'overwrite');
    if (moved) next = moved.comp;
  }
  return next;
}

// ───────────────────────────── transitions ─────────────────────────────

export const VIDEO_TRANSITIONS: { kind: TransitionKind; label: string; group: string }[] = [
  { kind: 'cross-dissolve', label: 'Cross Dissolve', group: 'Dissolve' },
  { kind: 'dip-to-black', label: 'Dip to Black', group: 'Dissolve' },
  { kind: 'dip-to-white', label: 'Dip to White', group: 'Dissolve' },
  { kind: 'film-dissolve', label: 'Film Dissolve', group: 'Dissolve' },
  { kind: 'additive-dissolve', label: 'Additive Dissolve', group: 'Dissolve' },
  { kind: 'push-left', label: 'Push Left', group: 'Slide' },
  { kind: 'push-right', label: 'Push Right', group: 'Slide' },
  { kind: 'push-up', label: 'Push Up', group: 'Slide' },
  { kind: 'push-down', label: 'Push Down', group: 'Slide' },
  { kind: 'slide-left', label: 'Slide Left', group: 'Slide' },
  { kind: 'slide-right', label: 'Slide Right', group: 'Slide' },
  { kind: 'slide-up', label: 'Slide Up', group: 'Slide' },
  { kind: 'slide-down', label: 'Slide Down', group: 'Slide' },
  { kind: 'wipe-left', label: 'Wipe Left', group: 'Wipe' },
  { kind: 'wipe-right', label: 'Wipe Right', group: 'Wipe' },
  { kind: 'wipe-up', label: 'Wipe Up', group: 'Wipe' },
  { kind: 'wipe-down', label: 'Wipe Down', group: 'Wipe' },
  { kind: 'iris-round', label: 'Iris Round', group: 'Iris' },
  { kind: 'iris-box', label: 'Iris Box', group: 'Iris' },
  { kind: 'cross-zoom', label: 'Cross Zoom', group: 'Zoom' },
];

export const AUDIO_TRANSITIONS: { kind: TransitionKind; label: string; group: string }[] = [
  { kind: 'constant-power', label: 'Constant Power', group: 'Crossfade' },
  { kind: 'constant-gain', label: 'Constant Gain', group: 'Crossfade' },
  { kind: 'exponential-fade', label: 'Exponential Fade', group: 'Crossfade' },
];

export const transitionLabel = (kind: TransitionKind) => [...VIDEO_TRANSITIONS, ...AUDIO_TRANSITIONS].find((item) => item.kind === kind)?.label ?? kind;
export const isAudioTransition = (kind: TransitionKind) => AUDIO_TRANSITIONS.some((item) => item.kind === kind);

/** The timeline window a transition covers (mirrors `Transition::window` in project.rs). */
export function transitionWindow(comp: Comp, transition: Transition): { start: number; end: number; at: number } | null {
  const from = transition.fromClip ? comp.clips.find((clip) => clip.id === transition.fromClip) : undefined;
  const to = transition.toClip ? comp.clips.find((clip) => clip.id === transition.toClip) : undefined;
  const at = from ? clipEnd(from) : to ? to.start : null;
  if (at === null) return null;
  const alignment = from && !to ? 'end' : to && !from ? 'start' : transition.alignment;
  const d = transition.duration;
  if (alignment === 'center') return { start: at - d / 2, end: at + d / 2, at };
  if (alignment === 'start') return { start: at, end: at + d, at };
  return { start: at - d, end: at, at };
}

/**
 * Applies a transition at the edit point nearest `time` on `trackId` (within `tolerance`), or
 * at a clip's head or tail when it has no neighbour there — replacing any transition already on
 * that edit. `clipIds` limits it to the edges of those clips (Ctrl+D on a selection).
 */
export function addTransition(comp: Comp, trackId: string, time: number, kind: TransitionKind, duration: number, tolerance = Infinity): Comp {
  const track = trackOf(comp, trackId);
  if (!track || track.locked || isAudioTransition(kind) !== (track.kind === 'audio')) return comp;
  const clips = clipsOn(comp, trackId);
  let best: { fromClip: string | null; toClip: string | null; at: number } | null = null;
  const consider = (candidate: { fromClip: string | null; toClip: string | null; at: number }) => {
    if (Math.abs(candidate.at - time) > tolerance) return;
    if (!best || Math.abs(candidate.at - time) < Math.abs(best.at - time)) best = candidate;
  };
  for (const clip of clips) {
    const before = neighbour(clips, clip, 'before');
    const after = neighbour(clips, clip, 'after');
    consider({ fromClip: before?.id ?? null, toClip: clip.id, at: clip.start });
    if (!after) consider({ fromClip: clip.id, toClip: null, at: clipEnd(clip) });
  }
  const chosen = best as { fromClip: string | null; toClip: string | null; at: number } | null;
  if (!chosen) return comp;
  const transitions = comp.transitions.filter((item) => !(item.trackId === trackId && item.fromClip === chosen.fromClip && item.toClip === chosen.toClip));
  const transition: Transition = { id: uid(), trackId, kind, fromClip: chosen.fromClip, toClip: chosen.toClip, duration, alignment: chosen.fromClip && chosen.toClip ? 'center' : chosen.toClip ? 'start' : 'end' };
  return tidy({ ...comp, transitions: [...transitions, transition] });
}

/** Default transitions on every edit of the selected clips' edges (Shift+D / Ctrl+D). */
export function transitionsOnSelection(comp: Comp, ids: string[], kinds: { video: TransitionKind; audio: TransitionKind }, duration: number): Comp {
  let next = comp;
  for (const clip of comp.clips.filter((item) => ids.includes(item.id))) {
    const track = trackOf(comp, clip.trackId);
    if (!track) continue;
    const kind = track.kind === 'audio' ? kinds.audio : kinds.video;
    next = addTransition(next, clip.trackId, clip.start, kind, duration, EPS * 10);
    next = addTransition(next, clip.trackId, clipEnd(clip), kind, duration, EPS * 10);
  }
  return next;
}

// ───────────────────────────── nest ─────────────────────────────

/** Premiere's Nest: the clips move into a new comp and one clip of that comp takes their place. */
export function nestClips(project: Project, compId: string, ids: string[], name: string, replace = true): { project: Project; compId: string; clipIds: string[] } | null {
  const parent = project.comps.find((comp) => comp.id === compId);
  if (!parent) return null;
  const chosen = new Set(withLinked(parent, ids));
  const clips = parent.clips.filter((clip) => chosen.has(clip.id));
  if (!clips.length) return null;
  const start = Math.min(...clips.map((clip) => clip.start));
  const end = Math.max(...clips.map(clipEnd));
  const child = newComp({ name, width: parent.width, height: parent.height, fps: parent.fps });
  let childComp: Comp = { ...child, folderId: parent.folderId, tracks: [], clips: [] };
  const indexes = { video: [] as number[], audio: [] as number[] };
  for (const kind of ['video', 'audio'] as const) {
    const used = [...new Set(clips.filter((clip) => trackOf(parent, clip.trackId)?.kind === kind).map((clip) => trackIndex(parent, clip.trackId)))];
    indexes[kind] = used;
    childComp = addTracks(childComp, kind, Math.max(1, used.length ? Math.max(...used) + 1 : 1)).comp;
  }
  const idMap = new Map<string, string>();
  childComp = {
    ...childComp,
    sourceVideo: tracksOf(childComp, 'video')[0].id,
    sourceAudio: tracksOf(childComp, 'audio')[0].id,
    clips: clips.map((clip) => {
      const kind = trackOf(parent, clip.trackId)?.kind ?? 'video';
      const id = uid();
      idMap.set(clip.id, id);
      return { ...clip, id, start: clip.start - start, trackId: tracksOf(childComp, kind)[trackIndex(parent, clip.trackId)].id };
    }),
  };
  childComp.transitions = parent.transitions
    .filter((transition) => [transition.fromClip, transition.toClip].every((id) => !id || chosen.has(id)))
    .map((transition) => {
      const owner = (transition.fromClip ?? transition.toClip) as string;
      const clip = childComp.clips.find((item) => item.id === idMap.get(owner));
      return { ...transition, id: uid(), trackId: clip?.trackId ?? transition.trackId, fromClip: transition.fromClip ? (idMap.get(transition.fromClip) ?? null) : null, toClip: transition.toClip ? (idMap.get(transition.toClip) ?? null) : null };
    });
  if (!replace) return { project: { ...project, comps: [...project.comps, childComp] }, compId: childComp.id, clipIds: [] };
  const lowestVideo = indexes.video.length ? Math.min(...indexes.video) : null;
  const lowestAudio = indexes.audio.length ? Math.min(...indexes.audio) : null;
  let nextParent = removeClips(parent, chosen, false);
  const source: ClipSource = { type: 'comp', compId: childComp.id };
  const linkId = lowestVideo !== null && lowestAudio !== null ? uid() : null;
  const placed: Clip[] = [];
  if (lowestVideo !== null) placed.push(newClip({ trackId: tracksOf(nextParent, 'video')[lowestVideo].id, start, duration: end - start, source, linkId }));
  if (lowestAudio !== null) placed.push(newClip({ trackId: tracksOf(nextParent, 'audio')[lowestAudio].id, start, duration: end - start, source, linkId }));
  nextParent = placeClips(nextParent, placed, 'overwrite');
  return {
    project: { ...project, comps: [...project.comps.map((comp) => (comp.id === compId ? nextParent : comp)), childComp] },
    compId: childComp.id,
    clipIds: placed.map((clip) => clip.id),
  };
}

/** Whether placing `childId` inside `parentId` would nest a comp in itself. */
export function wouldCycle(project: Project, parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === parentId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const comp = project.comps.find((item) => item.id === id);
    return !!comp?.clips.some((clip) => clip.source.type === 'comp' && visit(clip.source.compId));
  };
  return visit(childId);
}

// ───────────────────────────── navigation ─────────────────────────────

/** Cut points on `tracks` (all when null), plus the start. */
export function editPoints(comp: Comp, tracks: string[] | null = null): number[] {
  const set = tracks ? new Set(tracks) : null;
  const points = [0];
  for (const clip of comp.clips) if (!set || set.has(clip.trackId)) points.push(clip.start, clipEnd(clip));
  return [...new Set(points.map((point) => Math.round(point * 10000) / 10000))].sort((a, b) => a - b);
}

/** The next (or previous) point from `time`. */
export function nextPoint(points: number[], time: number, direction: 1 | -1): number | null {
  const sorted = [...new Set(points.map((p) => Math.round(p * 10000) / 10000))].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((p) => p > time + EPS) ?? null;
  return [...sorted].reverse().find((p) => p < time - EPS) ?? null;
}

/** Where things snap: clip edges, the playhead, markers, In and Out. */
export function snapTargets(comp: Comp, exclude: Set<string>, playhead: number): number[] {
  const points = [0, playhead, ...comp.markers.map((marker) => marker.time)];
  if (comp.inPoint !== null) points.push(comp.inPoint);
  if (comp.outPoint !== null) points.push(comp.outPoint);
  for (const clip of comp.clips) if (!exclude.has(clip.id)) points.push(clip.start, clipEnd(clip));
  return points;
}

/** Track Select Forward/Backward: every clip starting at or after (ending at or before) `time`. */
export function trackSelect(comp: Comp, time: number, direction: 1 | -1, trackId: string | null): string[] {
  return comp.clips
    .filter((clip) => (!trackId || clip.trackId === trackId) && (direction > 0 ? clipEnd(clip) > time + EPS : clip.start < time - EPS))
    .map((clip) => clip.id);
}

/** The lowest video track above V1 (or audio track) free over a span, created when none is. */
export function freeTrack(comp: Comp, kind: TrackKind, start: number, end: number, from = kind === 'video' ? 1 : 0): { comp: Comp; track: Track } {
  let next = comp;
  for (let index = from; index < 99; index++) {
    const ensured = ensureTrack(next, kind, index);
    next = ensured.comp;
    const busy = next.clips.some((clip) => clip.trackId === ensured.track.id && clip.start < end - EPS && clipEnd(clip) > start + EPS);
    if (!busy && !ensured.track.locked) return { comp: next, track: ensured.track };
  }
  return ensureTrack(next, kind, from);
}

export function toggleMarker(comp: Comp, time: number): Comp {
  const tolerance = 0.5 / comp.fps;
  const existing = comp.markers.find((marker) => Math.abs(marker.time - time) < tolerance);
  if (existing) return { ...comp, markers: comp.markers.filter((marker) => marker !== existing) };
  const marker: Marker = { id: uid(), time, name: '', color: '#3FB950' };
  return { ...comp, markers: [...comp.markers, marker].sort((a, b) => a.time - b.time) };
}

/** How many uses each media, comp and item id has across every comp (a linked pair is one use). */
export function usage(project: Project): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comp of project.comps) {
    const seen = new Set<string>();
    for (const clip of comp.clips) {
      const key = clip.source.type === 'media' ? clip.source.assetId : clip.source.type === 'comp' ? clip.source.compId : clip.source.type === 'item' ? clip.source.itemId : null;
      const token = `${key}:${clip.linkId ?? clip.id}`;
      if (!key || seen.has(token)) continue;
      seen.add(token);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// ───────────────────────────── loading ─────────────────────────────

type Legacy = {
  name?: string;
  aspect?: string;
  clips?: { id?: string; assetId?: string; in?: number; out?: number; volume?: number; transform?: Partial<Clip['transform']> }[];
  graphics?: { text?: string; subtitle?: string; start?: number; duration?: number; preset?: Preset; color?: string; style?: string | null }[];
  sounds?: { kind?: SfxKind; start?: number; volume?: number }[];
  tracks?: Record<string, boolean>;
  markers?: number[];
  inPoint?: number | null;
  outPoint?: number | null;
  captionStyle?: string | null;
};

const LEGACY_SIZE: Record<string, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** The single-track projects of Helios 0.2: V1 clips back to back, text on V2+, effects on A2+. */
function migrateLegacy(value: Legacy, assets: AssetMap): Project {
  const [width, height] = LEGACY_SIZE[value.aspect ?? '16:9'] ?? LEGACY_SIZE['16:9'];
  const project = newProject(value.name?.trim() || 'Untitled project');
  let comp: Comp = { ...project.comps[0], name: value.name?.trim() || 'Comp 1', width, height };
  const flags = value.tracks ?? {};
  const [v1, v2] = tracksOf(comp, 'video');
  const [a1, a2] = tracksOf(comp, 'audio');
  comp = updateTrack(comp, v1.id, { hidden: !!flags.v1Hidden, locked: !!flags.v1Locked });
  comp = updateTrack(comp, v2.id, { hidden: !!flags.v2Hidden, locked: !!flags.v2Locked });
  comp = updateTrack(comp, a1.id, { muted: !!flags.a1Muted, solo: !!flags.a1Solo, locked: !!flags.a1Locked });
  comp = updateTrack(comp, a2.id, { muted: !!flags.a2Muted, solo: !!flags.a2Solo, locked: !!flags.a2Locked });
  let cursor = 0;
  const clips: Clip[] = [];
  for (const old of value.clips ?? []) {
    const asset = old.assetId ? assets.get(old.assetId) : undefined;
    const inPoint = Math.max(0, finite(old.in, 0));
    const duration = Math.max(MIN_DURATION, finite(old.out, inPoint + STILL_DEFAULT) - inPoint);
    const source: ClipSource = { type: 'media', assetId: old.assetId ?? '' };
    const hasVideo = !asset || asset.kind !== 'audio';
    const hasAudio = !!asset && asset.kind !== 'image' && asset.hasAudio;
    const linkId = hasVideo && hasAudio ? uid() : null;
    if (hasVideo) clips.push(newClip({ trackId: v1.id, start: cursor, duration, in: inPoint, source, linkId, transform: { ...DEFAULT_TRANSFORM, ...(old.transform ?? {}) } }));
    if (hasAudio) clips.push(newClip({ trackId: a1.id, start: cursor, duration, in: inPoint, source, linkId, volume: clamp(finite(old.volume, 1), 0, 8) }));
    cursor += duration;
  }
  comp = { ...comp, clips };
  for (const graphic of value.graphics ?? []) {
    const start = Math.max(0, finite(graphic.start, 0));
    const duration = Math.max(0.1, finite(graphic.duration, 2));
    const free = freeTrack(comp, 'video', start, start + duration);
    comp = { ...free.comp, clips: [...free.comp.clips, newClip({ trackId: free.track.id, start, duration, source: textSource(graphic.preset ?? 'title', { text: graphic.text ?? '', subtitle: graphic.subtitle ?? '', color: graphic.color, style: graphic.style ?? null }) })] };
  }
  for (const sound of value.sounds ?? []) {
    const kind = sound.kind ?? 'pop';
    const start = Math.max(0, finite(sound.start, 0));
    const free = freeTrack(comp, 'audio', start, start + SFX_LENGTH[kind], 1);
    // Sound effects default well under the voice (−14…−20 dB by kind) and say what they are.
    comp = { ...free.comp, clips: [...free.comp.clips, newClip({ trackId: free.track.id, start, duration: SFX_LENGTH[kind], source: { type: 'sfx', kind }, volume: clamp(finite(sound.volume, SFX_DEFAULT_GAIN[kind]), 0, 8), name: `SFX · ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`, audioType: 'sfx' })] };
  }
  comp = {
    ...comp,
    markers: (value.markers ?? []).filter((time) => Number.isFinite(time)).map((time) => ({ id: uid(), time, name: '', color: '#3FB950' })),
    inPoint: Number.isFinite(value.inPoint) ? (value.inPoint as number) : null,
    outPoint: Number.isFinite(value.outPoint) ? (value.outPoint as number) : null,
  };
  return { ...project, comps: [comp], activeCompId: comp.id, openCompIds: [comp.id], media: [...assets.keys()].map((assetId) => ({ assetId, folderId: null, offline: false })), captionStyle: value.captionStyle ?? null };
}

/** Fills in defaults a hand-edited or older v3 file lacks and drops references to nothing. */
function sanitize(value: Project): Project {
  const comps = (Array.isArray(value.comps) ? value.comps : []).map((comp): Comp => {
    const tracks = (Array.isArray(comp.tracks) ? comp.tracks : []).map((track) => ({ ...newTrack(track.kind === 'audio' ? 'audio' : 'video'), ...track }));
    let next: Comp = {
      ...newComp({ name: comp.name || 'Comp', width: finite(comp.width, 1920), height: finite(comp.height, 1080), fps: finite(comp.fps, FPS) }),
      ...comp,
      tracks,
      markers: (Array.isArray(comp.markers) ? comp.markers : []).map((marker) => ({ id: marker.id ?? uid(), time: finite(marker.time, 0), name: marker.name ?? '', color: marker.color ?? '#3FB950' })),
      transitions: Array.isArray(comp.transitions) ? comp.transitions : [],
      inPoint: Number.isFinite(comp.inPoint) ? comp.inPoint : null,
      outPoint: Number.isFinite(comp.outPoint) ? comp.outPoint : null,
      folderId: comp.folderId ?? null,
    };
    for (const kind of ['video', 'audio'] as const) if (!tracksOf(next, kind).length) next = addTracks(next, kind, 1).comp;
    const ids = new Set(next.tracks.map((track) => track.id));
    next.clips = (Array.isArray(comp.clips) ? comp.clips : [])
      .filter((clip) => clip && ids.has(clip.trackId) && clip.source)
      .map((clip) => {
        const base = newClip({ trackId: clip.trackId, start: 0, duration: 1, source: clip.source });
        const source = clip.source.type === 'text' ? { ...clip.source, vertical: !!clip.source.vertical } : clip.source;
        return normalizeEffectClip({ ...base, ...clip, source, transform: { ...DEFAULT_TRANSFORM, ...(clip.transform ?? {}) }, effects: { ...DEFAULT_EFFECTS, ...(clip.effects ?? {}) }, keyframes: { ...EMPTY_KEYFRAMES, ...(clip.keyframes ?? {}) } });
      });
    if (!next.sourceVideo || !ids.has(next.sourceVideo)) next.sourceVideo = tracksOf(next, 'video')[0].id;
    if (!next.sourceAudio || !ids.has(next.sourceAudio)) next.sourceAudio = tracksOf(next, 'audio')[0].id;
    return tidy(next);
  });
  const compIds = new Set(comps.map((comp) => comp.id));
  const items = (Array.isArray(value.items) ? value.items : []).map((item) => ({ ...item, folderId: item.folderId ?? null }));
  const itemIds = new Set(items.map((item) => item.id));
  const cleaned = comps.map((comp) => tidy({ ...comp, clips: comp.clips.filter((clip) => (clip.source.type !== 'comp' || compIds.has(clip.source.compId)) && (clip.source.type !== 'item' || itemIds.has(clip.source.itemId))) }));
  const withComps = cleaned.length ? cleaned : newProject().comps;
  const activeCompId = value.activeCompId && withComps.some((comp) => comp.id === value.activeCompId) ? value.activeCompId : withComps[0].id;
  const openCompIds = (Array.isArray(value.openCompIds) ? value.openCompIds : []).filter((id) => withComps.some((comp) => comp.id === id));
  return {
    version: 3,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : 'Untitled project',
    comps: withComps,
    items,
    media: (Array.isArray(value.media) ? value.media : []).map((ref: MediaRef) => ({ assetId: ref.assetId, folderId: ref.folderId ?? null, offline: !!ref.offline })),
    folders: (Array.isArray(value.folders) ? value.folders : []).map((folder: Folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId ?? null })),
    activeCompId,
    openCompIds: openCompIds.includes(activeCompId) ? openCompIds : [...openCompIds, activeCompId],
    captionStyle: value.captionStyle ?? null,
    activeBrandKitId: typeof value.activeBrandKitId === 'string' ? value.activeBrandKitId : null,
  };
}

/** Any project Helios has saved, in the current shape. */
export function loadProject(value: unknown, assets: AssetMap): Project {
  if (!value || typeof value !== 'object') {
    const fresh = newProject();
    return { ...fresh, media: [...assets.keys()].map((assetId) => ({ assetId, folderId: null, offline: false })) };
  }
  const record = value as { version?: number };
  if (record.version === 3) return sanitize(value as Project);
  return migrateLegacy(value as Legacy, assets);
}
