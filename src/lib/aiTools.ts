import { makeStickFigure } from './stickFigure';
import { textBehindSubject, mediaBehindSubject } from './behindSubject';
import { depthOcclusion } from './depth';
import { scoreEnvelope, type AudioEnvelope } from './audioEnvelope';
import { rotoscope } from './roto';
import { validateRotoResult } from './rotoValidation';
import { generateSelectionSound } from './generateSound';
import { AVAILABLE_EFFECTS } from './effectsCatalog';
import { createAppliedEffect, getEffectSchema } from './effectFilters';
import { applyPodcastCut, planShots, speakerTurns, type CastEntry, type PersonTrack } from './reframe';
import { summarizePersonTracks, trackPeopleAsset } from './personTracks';import { normalizeEffectClip } from './effectState';
import { adaptRhythmProgram } from './learning';
import { storyboardContentError, type StoryboardSceneInput } from './editWorkflow';
import { createMotionGraphicComp } from './motionGraphics';
// Runs Helios AI's tool calls against the live project. Every tool is one undo step labelled
// "AI: …", so a turn can be stepped back or reverted whole. The catalogue the models see is
// src/lib/ai-tools.json; this file is the other half of that contract.
import catalog from './ai-tools.json';
import { clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, gainToDb, isHexColor, presetLabel, STILL_DEFAULT, timecode, uid } from './editor';
import type { History } from './history';
import { api, errorText } from './ipc';
import { describe as describeDiff, runProgram, type Op, type Program } from './editProgram';
import { buildRecipe, findRecipe, recipeCatalogue, registerCustomRecipe, setCustomRecipes } from './recipes';
import {
  loadCustomTools, saveCustomTools, createCustomTool, updateCustomTool,
  substituteTemplate, customToolToRecipe, recordToolUsage,
  type CustomTool, type CustomToolParam
} from './customTools';
import { EMPTY_KEYFRAMES } from './keyframes';
import { playhead } from './playhead';
import {
  addFrameHold, addTracks, addTransition, audible, clipEnd, clipName, clipsForSource, compDuration, COMP_PRESETS, deleteTracks, emptyTracks, freeTrack, insertFrameHold, ITEM_LABEL, moveClips,
  newClip, newComp, newItem, nestClips, placeClips, razor, removeClips, removeRange, resolveTrack, setGrouped, setLinked, setSpeed, sourceInfo, sourceLimit, sourceOut, sourceTimeAt, textSource,
  tracksOf, trackLabel, transitionWindow, trimEdge, updateComp, updateTrack, usage, wouldCycle, type AssetMap,
} from './timeline';
import type { Asset, Clip, ClipSource, Comp, Easing, Effects, ItemKind, Keyframe, KeyframedProperty, Mask, Project, ProjectItem, Track, TrackKind, Transform, TransitionKind, ToolResult } from './types';

export type ToolSpec = { name: string; description: string; input_schema: unknown };
export const TOOL_SPECS: ToolSpec[] = catalog.tools as ToolSpec[];

export type ToolHost = {
  history: History;
  assets: () => AssetMap;
  selection: () => string[];
  setSelection: (ids: string[]) => void;
  importMedia: (paths: string[], targetFolderId?: string | null) => Promise<Asset[]>;
  /** Reads a script aloud, imports the take and returns it. */
  speak: (text: string, voice: string | null, mode: string, name?: string) => Promise<Asset>;
  /** Puts a question to the editor and waits for the answer. */
  ask: (question: { question: string; options: string[]; context: string | null }) => Promise<string>;
  /** Sets the active project reference guideline. */
  setReference?: (id: string | null) => void;
};

function findOrCreateFolder(
  project: Project,
  commit: (edit: (current: Project) => Project, label?: string) => void,
  folderName: string,
  parentId?: string | null,
): string {
  const clean = folderName.trim();
  const existing = project.folders.find(
    (f) => f.name.toLowerCase() === clean.toLowerCase() && (parentId === undefined || f.parentId === (parentId ?? null))
  );
  if (existing) return existing.id;
  const newId = uid();
  commit(
    (current) => ({
      ...current,
      folders: [...current.folders, { id: newId, name: clean, parentId: parentId ?? null }],
    }),
    'Create Folder'
  );
  return newId;
}

type Args = Record<string, unknown>;

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, summary, ...data });

const num = (args: Args, key: string): number | undefined => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
const str = (args: Args, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
const bool = (args: Args, key: string): boolean | undefined => (typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined);
const list = (args: Args, key: string): string[] => (Array.isArray(args[key]) ? (args[key] as unknown[]).filter((item): item is string => typeof item === 'string') : []);
const record = (args: Args, key: string): Args | undefined => (args[key] && typeof args[key] === 'object' && !Array.isArray(args[key]) ? (args[key] as Args) : undefined);

// ───────────────────────────── what the model sees ─────────────────────────────

const round = (value: number) => Math.round(value * 1000) / 1000;

function clipSummary(project: Project, assets: AssetMap, comp: Comp, clip: Clip) {
  const source = clip.source;
  const kind = source.type === 'media' ? 'media' : source.type;
  const summary: Record<string, unknown> = {
    id: clip.id,
    track: trackLabel(comp, clip.trackId),
    name: clipName(project, assets, clip),
    kind,
    start: round(clip.start),
    end: round(clipEnd(clip)),
    in: round(clip.in),
    duration: round(clip.duration),
  };
  if (source.type === 'media') summary.mediaId = source.assetId;
  if (source.type === 'comp') summary.compId = source.compId;
  if (source.type === 'item') summary.itemId = source.itemId;
  if (source.type === 'text') Object.assign(summary, { text: source.text, subtitle: source.subtitle || undefined, preset: source.preset, color: source.color, captionStyle: source.style ?? undefined, vertical: source.vertical || undefined });
  if (source.type === 'sfx') summary.sfx = source.kind;
  if (source.type === 'shape') Object.assign(summary, { shape: source.shape, fill: source.fill, size: `${Math.round(source.width)}x${Math.round(source.height)}` });
  if (source.type === 'html') Object.assign(summary, { html: true, title: source.title, hasGsap: !!source.js });
  if (clip.linkId) summary.linkedTo = comp.clips.find((item) => item.linkId === clip.linkId && item.id !== clip.id)?.id;
  if (clip.groupId) summary.groupId = clip.groupId;
  if (clip.speed !== 1) summary.speed = clip.speed;
  if (clip.reverse) summary.reverse = true;
  if (clip.hold !== null) summary.frameHold = round(clip.hold);
  if (!clip.enabled) summary.enabled = false;
  if (clip.adjustment) summary.adjustmentLayer = true;
  if (clip.label) summary.label = clip.label;
  if (clip.mask) summary.mask = clip.mask.shape;
  if (clip.rotoMatte) summary.roto = { applied: true, matte: 'local-cache' };
  if (JSON.stringify(clip.transform) !== JSON.stringify(DEFAULT_TRANSFORM)) summary.transform = clip.transform;
  if (JSON.stringify(clip.effects) !== JSON.stringify(DEFAULT_EFFECTS)) summary.effects = clip.effects;
  summary.appliedEffects = clip.appliedEffects || [];
  const animated = (Object.keys(clip.keyframes) as KeyframedProperty[]).filter((property) => clip.keyframes[property].length);
  if (animated.length) summary.keyframed = animated;
  if (comp.tracks.find((track) => track.id === clip.trackId)?.kind === 'audio') {
    summary.volume = clip.volume;
    summary.gainDb = round(gainToDb(clip.volume));
    if (clip.channels !== 'stereo') summary.channels = clip.channels;
    if (clip.enhanceSpeech) summary.enhanceSpeech = true;
  }
  return summary;
}

/** One comp in full: what `get_comp` answers with. */
export function compDetail(project: Project, assets: AssetMap, comp: Comp) {
  const ranged = comp.inPoint !== null && comp.outPoint !== null && comp.outPoint > comp.inPoint;
  return {
    id: comp.id,
    name: comp.name,
    size: `${comp.width}x${comp.height}`,
    fps: comp.fps,
    duration: round(compDuration(comp)),
    inPoint: comp.inPoint,
    outPoint: comp.outPoint,
    // When the user marked In/Out, that span IS the job: every time-based op
    // (cuts, trims, placements, ranges) defaults inside it unless told otherwise.
    workingRange: ranged
      ? `WORKING RANGE ${round(comp.inPoint ?? 0)}–${round(comp.outPoint ?? 0)}s (In→Out marked): do the requested work inside this span only`
      : null,
    tracks: comp.tracks.map((track) => ({
      track: trackLabel(comp, track.id),
      id: track.id,
      name: track.name || undefined,
      locked: track.locked || undefined,
      hidden: track.kind === 'video' && track.hidden ? true : undefined,
      muted: track.kind === 'audio' && track.muted ? true : undefined,
      solo: track.solo || undefined,
      audible: track.kind === 'audio' ? audible(comp, track) : undefined,
      clips: comp.clips.filter((clip) => clip.trackId === track.id).length,
    })),
    clips: [...comp.clips].sort((a, b) => a.start - b.start).map((clip) => clipSummary(project, assets, comp, clip)),
    transitions: comp.transitions.map((transition) => {
      const window = transitionWindow(comp, transition);
      return { id: transition.id, kind: transition.kind, track: trackLabel(comp, transition.trackId), at: window ? round(window.at) : null, duration: round(transition.duration), alignment: transition.alignment, fromClip: transition.fromClip, toClip: transition.toClip };
    }),
    markers: comp.markers.map((marker) => ({ id: marker.id, time: round(marker.time), name: marker.name || undefined })),
    storyboard: comp.storyboard ?? [],
  };
}

/** The project overview `get_project` answers with, and the context each chat turn carries. */
export function aiContext(project: Project, assets: AssetMap, selection: string[]) {
  const counts = usage(project);
  const active = project.comps.find((comp) => comp.id === project.activeCompId) ?? project.comps[0];
  return {
    project: { name: project.name, captionStyle: project.captionStyle, activeCompId: active?.id ?? null },
    playhead: round(playhead.get()),
    selectedClipIds: selection,
    comps: project.comps.map((comp) => ({
      id: comp.id,
      name: comp.name,
      size: `${comp.width}x${comp.height}`,
      fps: comp.fps,
      duration: round(compDuration(comp)),
      videoTracks: tracksOf(comp, 'video').length,
      audioTracks: tracksOf(comp, 'audio').length,
      clips: comp.clips.length,
      usedInOtherComps: counts.get(comp.id) ?? 0,
      folder: comp.folderId ?? undefined,
    })),
    media: project.media.map((ref) => {
      const asset = assets.get(ref.assetId);
      if (!asset) return { id: ref.assetId, name: 'missing', offline: true };
      return {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        duration: asset.kind === 'image' ? null : round(asset.duration),
        size: `${asset.width}x${asset.height}`,
        hasAudio: asset.hasAudio,
        used: counts.get(asset.id) ?? 0,
        offline: ref.offline || asset.missing || undefined,
        folder: ref.folderId ?? undefined,
      };
    }),
    items: project.items.map((item) => ({ id: item.id, name: item.name, kind: item.kind, color: item.color, duration: round(item.duration), used: counts.get(item.id) ?? 0, folder: item.folderId ?? undefined })),
    folders: project.folders.map((folder) => ({ id: folder.id, name: folder.name, parent: folder.parentId ?? undefined })),
    activeComp: active ? compDetail(project, assets, active) : null,
  };
}

// ───────────────────────────── helpers ─────────────────────────────

function pickComp(project: Project, args: Args): Comp | undefined {
  const wanted = str(args, 'compId');
  if (wanted) return project.comps.find((comp) => comp.id === wanted || comp.name === wanted);
  return project.comps.find((comp) => comp.id === project.activeCompId) ?? project.comps[0];
}

/** A track by label or id, creating tracks up to that number when the label runs past the end. */
function trackFor(comp: Comp, ref: string | undefined, kind: TrackKind): { comp: Comp; track: Track } | null {
  if (!ref) return null;
  const existing = resolveTrack(comp, ref);
  if (existing) return { comp, track: existing };
  const match = /^([va])(\d{1,2})$/i.exec(ref.trim());
  if (!match) return null;
  const wantKind = match[1].toLowerCase() === 'v' ? 'video' : 'audio';
  if (wantKind !== kind) return null;
  let next = comp;
  while (tracksOf(next, kind).length < Number(match[2])) next = addTracks(next, kind, 1).comp;
  return { comp: next, track: tracksOf(next, kind)[Number(match[2]) - 1] };
}

/** The first video track above every clip that overlaps a span (where an overlay belongs). */
function aboveTrack(comp: Comp, start: number, end: number): { comp: Comp; track: Track } {
  const busy = comp.clips.filter((clip) => clip.start < end && clipEnd(clip) > start).map((clip) => comp.tracks.findIndex((track) => track.id === clip.trackId));
  const videoTracks = tracksOf(comp, 'video');
  let highest = 0;
  for (const index of busy) {
    const track = comp.tracks[index];
    if (track?.kind !== 'video') continue;
    highest = Math.max(highest, videoTracks.findIndex((item) => item.id === track.id) + 1);
  }
  return freeTrack(comp, 'video', start, end, Math.max(1, highest));
}

const findClipIn = (project: Project, clipId: string) => {
  for (const comp of project.comps) {
    const clip = comp.clips.find((item) => item.id === clipId);
    if (clip) return { comp, clip };
  }
  return null;
};

const ITEM_KINDS: Record<string, ItemKind> = {
  color_matte: 'color-matte', black_video: 'black-video', transparent_video: 'transparent-video', bars_and_tone: 'bars-and-tone', adjustment_layer: 'adjustment-layer', countdown: 'countdown',
};

// ───────────────────────────── the executor ─────────────────────────────

export async function runTool(host: ToolHost, name: string, rawArgs: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const args: Args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Args) : {};
  const project = host.history.current();
  const assets = host.assets();
  const label = `AI: ${name.replace(/_/g, ' ')}`;
  const commit = (change: (current: Project) => Project) => {
    if (signal?.aborted) throw new Error('The AI turn ended; no pending edit was applied.');
    host.history.commit(change, label);
  };
  const editComp = (comp: Comp, change: (current: Comp) => Comp) => commit((current) => updateComp(current, comp.id, change));
  const limit = (clip: Clip) => sourceLimit(project, assets, clip);
  const fps = (comp: Comp) => comp.fps;

  // A tool from an MCP server Helios is connected to: hand it straight back to that server.
  if (name.startsWith('mcp__')) {
    try {
      const result = await api.mcpCall(name, args);
      return { ok: true, summary: `${name.split('__').slice(1).join(' · ')} ran`, result };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  switch (name) {
    case 'add_text_behind_subject': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found) return fail('Choose a Roto clip.');
      try {
        const result = textBehindSubject(found.comp, found.clip.id, str(args, 'text') ?? '', str(args, 'color') ?? '#ffffff');
        editComp(found.comp, () => result.comp);
        host.setSelection([result.titleId]);
        return done('Original scene preserved below animated text; existing Roto foreground placed above it. Review matte edges in the shot.', { titleId: result.titleId, foregroundId: result.foregroundId, backgroundId: result.backgroundId });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'score_audio_clip': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.comp.tracks.find(t => t.id === found.clip.trackId)?.kind !== 'audio') return fail('Choose a clip on an audio track.');
      if (found.comp.tracks.find(t => t.id === found.clip.trackId)?.locked) return fail('Unlock the audio track first.');
      if ((args.cues !== undefined && !Array.isArray(args.cues)) || (args.speech !== undefined && !Array.isArray(args.speech))) return fail('Cues and speech must be arrays.');
      try {
        const rawCues = (Array.isArray(args.cues) ? args.cues : []) as { time: number; gainDb: number }[];
        const clipStart = found.clip.start;
        const clipEnd = clipStart + found.clip.duration;
        const validCues = rawCues
          .filter(c => typeof c === 'object' && c !== null && Number.isFinite(c.time) && Number.isFinite(c.gainDb))
          .map(c => {
            let t = c.time;
            if (clipStart > 0 && t >= 0 && t <= found.clip.duration) t = clipStart + t;
            return { time: Math.round(t * 1000) / 1000, gainDb: Math.max(-60, Math.min(12, c.gainDb)) };
          })
          .filter(c => c.time >= clipStart && c.time <= clipEnd);
        const seen = new Set<number>();
        const dedupedCues = validCues.filter(c => {
          if (seen.has(c.time)) return false;
          seen.add(c.time);
          return true;
        });
        const rawSpeech = (Array.isArray(args.speech) ? args.speech : []) as { start: number; end: number }[];
        const validSpeech = rawSpeech
          .filter(r => typeof r === 'object' && r !== null && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
          .map(r => ({ start: Math.round(r.start * 1000) / 1000, end: Math.round(r.end * 1000) / 1000 }));
        const clipDur = found.clip.duration;
        const options: AudioEnvelope = {
          fadeIn: Math.max(0, Math.min(clipDur, num(args, 'fadeIn') ?? 0)),
          fadeOut: Math.max(0, Math.min(clipDur, num(args, 'fadeOut') ?? 0)),
          duckDb: Math.max(-60, Math.min(0, num(args, 'duckDb') ?? -12)),
          attack: Math.max(0, Math.min(clipDur, num(args, 'attack') ?? Math.min(0.15, clipDur))),
          release: Math.max(0, Math.min(clipDur, num(args, 'release') ?? Math.min(0.5, clipDur))),
          cues: dedupedCues,
          speech: validSpeech
        };
        const volume = scoreEnvelope(found.clip, options);
        editComp(found.comp, current => ({ ...current, clips: current.clips.map(c => c.id === found.clip.id ? { ...c, keyframes: { ...c.keyframes, volume } } : c) }));
        return done('Editable gain automation applied: scene dynamics, fades and speech ducking. This changes loudness, not musical tempo or instrumentation.', { clipId: found.clip.id, keyframes: volume.length });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'inspect_clip_frames': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media' || assets.get(found.clip.source.assetId)?.kind !== 'video') return fail('Supply a video clipId.');
      const { clip, comp } = found;
      const total = Math.ceil(clip.duration * comp.fps);
      const first = num(args, 'fromFrame') ?? 0;
      const defaultStride = total > 6 ? Math.max(1, Math.floor(total / 6)) : Math.max(1, Math.round(comp.fps));
      const stride = num(args, 'strideFrames') ?? defaultStride;
      const textOnly = bool(args, 'textOnly') || bool(args, 'omitImages') || false;
      if (!Number.isInteger(first) || first < 0 || !Number.isInteger(stride) || stride < 1) return fail('Frame cursor and stride must be nonnegative/positive integers.');
      if (first >= total) return done('Frame review reached the clip end.', { images: [], nextFrame: null, totalFrames: total, textOnly });
      const frames = Array.from({ length: 6 }, (_, i) => first + i * stride).filter(n => n < total);
      const asset = assets.get(found.clip.source.assetId)!;
      const duration = asset.duration;
      const sourceFps = asset.fps || comp.fps;
      const times = frames.map(n => Math.max(0, Math.min(duration - 1 / sourceFps, sourceTimeAt(clip, clip.start + n / comp.fps))));
      const next = frames[frames.length - 1] + stride;
      const timelineTimes = frames.map(n => round(clip.start + n / comp.fps));
      const aspect = asset.width && asset.height ? `${asset.width}x${asset.height}` : 'unknown';
      const framingNotes = `Resolution: ${aspect}, Clip duration: ${round(clip.duration)}s (${total} frames at ${comp.fps}fps). Sampled times: [${timelineTimes.join(', ')}]s.`;
      // Fast path: text-only scan needs no ffmpeg/base64 round-trip. It records the
      // same frame receipts instantly, so long clips never stall the turn.
      if (textOnly) {
        return done(`Fast frame scan (no images): ${framingNotes} Review framing/subject/negative space from these timestamps; request images only for the one 5–12s batch needing roto points or precise behind-subject placement.`, {
          frames,
          timelineTimes,
          times,
          totalFrames: total,
          strideFrames: stride,
          nextFrame: next < total ? next : null,
          textOnly: true,
          omitImageBlocks: true,
          framing: framingNotes,
        });
      }
      try {
        const result = await api.analysisFrames(found.clip.source.assetId, times);
        return done(`Actual source images mapped to clip frames. ${framingNotes}`, {
          ...result,
          frames,
          timelineTimes,
          nextFrame: next < total ? next : null,
          totalFrames: total,
          strideFrames: stride,
          framing: framingNotes,
        });
      } catch (error) {
        // Image extraction failed (missing ffmpeg, unreadable frame) — never brick the
        // turn over it. Record the same timestamp scan receipt text-only and disclose.
        return done(`Frame images unavailable (${errorText(error)}). Timestamp scan recorded instead: ${framingNotes} Request images again only for the batch needing roto points.`, {
          frames,
          timelineTimes,
          times,
          totalFrames: total,
          strideFrames: stride,
          nextFrame: next < total ? next : null,
          textOnly: true,
          omitImageBlocks: true,
          imageError: errorText(error),
          framing: framingNotes,
        });
      }
    }
    case 'inspect_source_frames': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Supply a video clipId.');
      if (!Array.isArray(args.times) || args.times.some(t => typeof t !== 'number' || !Number.isFinite(t))) return fail('Supply source timestamps.');
      const textOnly = bool(args, 'textOnly') || bool(args, 'omitImages') || false;
      if (textOnly) {
        return done('Fast source scan (no images): timestamps recorded. Request images only for the active 5–12s batch.', {
          times: args.times,
          assetId: found.clip.source.assetId,
          textOnly: true,
          omitImageBlocks: true,
        });
      }
      try {
        const result = await api.analysisFrames(found.clip.source.assetId, args.times as number[]);
        return done('Actual source frame images, ordered by the returned source timestamps.', result);
      }
      catch (error) {
        return done(`Frame images unavailable (${errorText(error)}). Timestamp scan recorded instead; request images again only for the batch needing roto points.`, {
          times: args.times,
          assetId: found.clip.source.assetId,
          textOnly: true,
          omitImageBlocks: true,
          imageError: errorText(error),
        });
      }
    }
    case 'save_storyboard': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const knownIds = new Set<string>([...assets.keys(), ...project.items.map(i => i.id), ...project.comps.map(c => c.id)]);
      const problem = storyboardContentError(Array.isArray(args.scenes) ? (args.scenes as StoryboardSceneInput[]) : [], comp.fps, compDuration(comp), knownIds);
      if (problem) return fail(problem);
      const scenes: NonNullable<Comp['storyboard']> = (args.scenes as Record<string, unknown>[]).map(raw => {
        const row = raw as Args;
        const refs = Array.isArray(row.refs) ? (row.refs as unknown[]).filter((r): r is string => typeof r === 'string') : undefined;
        return { start: row.start as number, end: row.end as number, intent: row.intent as string, visual: row.visual as string, audio: row.audio as string, evidence: row.evidence as string, ...(refs?.length ? { refs } : {}) };
      });
      editComp(comp, current => ({ ...current, storyboard: scenes.sort((a, b) => a.start - b.start) }));
      return done('Clean minimalist pro storyboard saved (5–12s batches, visual improvement thinking + sound design per beat). Generate reference stills for key beats, import them, and re-save with their asset IDs in refs. Execute beat by beat: finish one batch fully before starting the next.', { scenes });
    }
    case 'add_media_behind_subject': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      const asset = assets.get(str(args, 'assetId') ?? '');
      if (!found || !asset || !['image', 'video'].includes(asset.kind)) return fail('Supply a masked clipId and an imported image/video assetId.');
      if (asset.kind === 'video' && asset.duration < found.clip.duration) return fail('The inserted video must cover the whole clip duration. Trim the shot first.');
      try {
        const result = mediaBehindSubject(found.comp, found.clip.id, asset.id);
        editComp(found.comp, () => result.comp);
        return done('Original background, inserted media and masked foreground are separate editable layers. Adjust inserted media transform and keyframes, then review occlusion.', { mediaId: result.mediaId, foregroundId: result.foregroundId, backgroundId: result.backgroundId });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'depth_occlusion_clip': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media' || assets.get(found.clip.source.assetId)?.kind !== 'video') return fail('Supply a video clipId.');
      const { comp, clip } = found;
      if (comp.tracks.find(t => t.id === clip.trackId)?.locked || clip.reverse || clip.hold !== null || clip.speed !== 1) return fail('Depth requires an unlocked forward clip at normal speed.');
      const threshold = num(args, 'depthPlane') ?? 0.5, softness = num(args, 'softness') ?? 0.03;
      if (threshold <= 0 || threshold >= 1 || softness < 0 || softness > 0.25) return fail('Depth plane must be between 0 and 1; softness must be 0–0.25.');
      try {
        const asset = assets.get(found.clip.source.assetId);
        const actualFps = (asset?.fps && Number.isFinite(asset.fps) && asset.fps > 0 ? asset.fps : comp.fps);
        const result = await depthOcclusion(found.clip.source.assetId, clip.in, clip.duration, actualFps, threshold, softness, signal);
        const liveComp = host.history.current().comps.find(c => c.id === comp.id);
        const live = liveComp?.clips.find(c => c.id === clip.id);
        if (signal?.aborted || !live || JSON.stringify(live) !== JSON.stringify(clip) || liveComp?.tracks.find(t => t.id === live.trackId)?.locked) return fail('Clip changed during depth inference; cached result was not attached.');
        editComp(liveComp!, current => ({ ...current, clips: current.clips.map(c => c.id === clip.id ? { ...c, rotoMatte: result.matte, rotoCorrections: [] } : c) }));
        return done('Near-depth foreground matte attached. Use add_media_behind_subject or add_text_behind_subject to restore the background and insert a layer. Depth is relative, not metres, and is not a hair alpha matte. Review edges and temporal flicker.', { frames: result.frames, clipId: clip.id, depthPlane: threshold, softness });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'online_research': {
      const query = str(args, 'query');
      if (!query) return fail('Supply a search query.');
      const limit = num(args, 'limit') ?? 6;
      const folderName = str(args, 'folderName') ?? `Research: ${query}`;
      const gatherMedia = bool(args, 'gatherMedia') ?? false;
      const maxMedia = num(args, 'maxMedia') ?? 3;

      try {
        const results = await api.webSearch(query, limit);
        if (!results.length) {
          return done(`No search results found for "${query}". Try different keywords.`, { query, results: [] });
        }

        let gatheredAssets: Asset[] = [];
        let targetFolderId: string | null = null;

        if (gatherMedia) {
          targetFolderId = findOrCreateFolder(project, commit, folderName);
          const candidateMediaUrls: string[] = [];

          for (const item of results.slice(0, 3)) {
            try {
              const scraped = await api.webScrape(item.url, 2000);
              for (const img of scraped.images) {
                if (candidateMediaUrls.length < maxMedia && !candidateMediaUrls.includes(img)) {
                  candidateMediaUrls.push(img);
                }
              }
              for (const vid of scraped.videos) {
                if (candidateMediaUrls.length < maxMedia && !candidateMediaUrls.includes(vid)) {
                  candidateMediaUrls.push(vid);
                }
              }
            } catch (scrapeErr) {
              console.warn(`Could not scrape ${item.url} for media:`, scrapeErr);
            }
          }

          for (const mUrl of candidateMediaUrls) {
            try {
              const dl = await api.mediaDownload(mUrl, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
              const imported = await host.importMedia([dl.path], targetFolderId);
              if (imported[0]) gatheredAssets.push(imported[0]);
            } catch (dlErr) {
              console.warn(`Could not download gathered media from ${mUrl}:`, dlErr);
            }
          }
        }

        const gatherNote = gatheredAssets.length
          ? ` Automatically gathered and organized ${gatheredAssets.length} asset(s) into project folder "${folderName}".`
          : '';
        const summary = `Found ${results.length} web research result(s) for "${query}".${gatherNote}`;
        return done(summary, {
          query,
          folderName,
          folderId: targetFolderId,
          gatheredAssets: gatheredAssets.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
          results,
          insights: results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n'),
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'scrape_web_page': {
      const url = str(args, 'url');
      if (!url) return fail('Supply a web page URL.');
      const maxChars = num(args, 'maxChars') ?? 4000;
      try {
        const result = await api.webScrape(url, maxChars);
        const mediaNote = result.images.length || result.videos.length
          ? ` Found ${result.images.length} image(s) and ${result.videos.length} video link(s).`
          : '';
        return done(`Scraped "${result.title || url}".${mediaNote}`, {
          url: result.url,
          title: result.title,
          text: result.text,
          images: result.images,
          videos: result.videos,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'read_file': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a file path.');
      const startLine = num(args, 'startLine');
      const endLine = num(args, 'endLine');
      try {
        const res = await api.fsReadFile(path, startLine, endLine);
        const shownLines = res.totalLines > 0 ? (res.endLine - res.startLine + 1) : 0;
        return done(`Read ${res.path} (${shownLines} line(s) shown of ${res.totalLines} total, ${res.sizeBytes} bytes).`, {
          path: res.path,
          content: res.content,
          totalLines: res.totalLines,
          startLine: res.startLine,
          endLine: res.endLine,
          sizeBytes: res.sizeBytes,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'write_file': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a file path.');
      const content = typeof args.content === 'string' ? args.content : '';
      const overwrite = bool(args, 'overwrite') ?? true;
      try {
        const res = await api.fsWriteFile(path, content, overwrite);
        return done(`Wrote ${res.lines} line(s) (${res.bytesWritten} bytes) to ${res.path}.`, {
          path: res.path,
          lines: res.lines,
          bytesWritten: res.bytesWritten,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'replace_file_content':
    case 'edit_file': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a file path.');
      const oldString = typeof args.oldString === 'string' ? args.oldString : (typeof args.targetContent === 'string' ? args.targetContent : '');
      const newString = typeof args.newString === 'string' ? args.newString : (typeof args.replacementContent === 'string' ? args.replacementContent : '');
      if (!oldString) return fail('Supply oldString (target text to replace).');
      const allowMultiple = bool(args, 'allowMultiple') ?? false;
      try {
        const res = await api.fsEditFile(path, oldString, newString, allowMultiple);
        return done(`Replaced ${res.replacements} occurrence(s) in ${res.path} (file now has ${res.totalLines} lines).`, {
          path: res.path,
          replacements: res.replacements,
          totalLines: res.totalLines,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'list_directory': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a directory path.');
      const recursive = bool(args, 'recursive');
      const maxDepth = num(args, 'maxDepth');
      const limit = num(args, 'limit');
      try {
        const res = await api.fsListDirectory(path, recursive, maxDepth, limit);
        return done(`Listed ${res.totalFound} entries in ${res.path}.`, {
          path: res.path,
          entries: res.entries,
          totalFound: res.totalFound,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'glob_search': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a base directory path.');
      const pattern = str(args, 'pattern');
      if (!pattern) return fail('Supply a glob pattern.');
      const limit = num(args, 'limit');
      try {
        const res = await api.fsGlobSearch(path, pattern, limit);
        return done(`Found ${res.totalMatches} match(es) for pattern "${res.pattern}" in ${res.basePath}.`, {
          basePath: res.basePath,
          pattern: res.pattern,
          matches: res.matches,
          totalMatches: res.totalMatches,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'grep_search': {
      const path = str(args, 'path');
      if (!path) return fail('Supply a directory path to search.');
      const query = str(args, 'query');
      if (!query) return fail('Supply a search query.');
      const filePattern = str(args, 'filePattern');
      const maxMatches = num(args, 'maxMatches');
      try {
        const res = await api.fsGrepSearch(path, query, filePattern, maxMatches);
        return done(`Found ${res.totalMatches} matching line(s) for "${res.query}" in ${path}.`, {
          query: res.query,
          matches: res.matches,
          totalMatches: res.totalMatches,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'bash':
    case 'run_command': {
      const command = str(args, 'command');
      if (!command) return fail('Supply a shell command.');
      const cwd = str(args, 'cwd');
      const timeoutSecs = num(args, 'timeoutSecs');
      try {
        const res = await api.fsRunCommand(command, cwd, timeoutSecs);
        const statusNote = res.exitCode === 0 ? 'succeeded (exit code 0)' : `finished with exit code ${res.exitCode}`;
        const outputSummary = res.stdout.trim() || res.stderr.trim() || '(no output)';
        return done(`Command ${statusNote} in ${res.durationMs}ms.\nOutput:\n${outputSummary.slice(0, 2000)}`, {
          command,
          cwd,
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          durationMs: res.durationMs,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'web_search': {
      return runTool(host, 'online_research', args, signal);
    }
    case 'web_fetch': {
      return runTool(host, 'scrape_web_page', args, signal);
    }
    case 'download_online_media': {
      const url = str(args, 'url');
      if (!url) return fail('Supply an online media URL.');
      const mediaType = str(args, 'mediaType');
      const filename = str(args, 'filename');
      const resolution = str(args, 'resolution');
      const asReference = bool(args, 'asReference') ?? false;
      const startTime = str(args, 'startTime');
      const endTime = str(args, 'endTime');
      const noAudio = bool(args, 'noAudio') ?? bool(args, 'withoutSound') ?? false;
      const crop = str(args, 'crop');
      const folderName = str(args, 'folderName');
      let targetFolderId = str(args, 'targetFolderId');

      try {
        if (folderName && !targetFolderId) {
          targetFolderId = findOrCreateFolder(project, commit, folderName);
        }

        const downloaded = await api.mediaDownload(
          url,
          mediaType,
          filename,
          resolution,
          startTime,
          endTime,
          noAudio,
          crop,
        );
        const imported = await host.importMedia([downloaded.path], targetFolderId);
        const asset = imported[0];
        if (!asset) {
          return fail(`Media was downloaded to ${downloaded.path} but could not be imported into Helios.`);
        }

        let referenceResult = null;
        if (asReference && asset.kind === 'video') {
          try {
            referenceResult = await api.refsIngest(downloaded.path, filename || asset.name, `Reference downloaded from ${url}`);
            if (host.setReference && referenceResult?.id) {
              host.setReference(referenceResult.id);
            }
          } catch (refError) {
            console.warn('Could not ingest as reference:', refError);
          }
        }

        const folderMsg = targetFolderId ? ` inside folder "${folderName || targetFolderId}"` : '';
        const trimMsg = (startTime || endTime) ? ` (trimmed ${startTime || '0'}-${endTime || 'end'})` : '';
        const audioMsg = noAudio ? ' [video-only / no sound]' : '';
        const cropMsg = crop ? ` [cropped: ${crop}]` : '';

        return done(
          `Downloaded and imported "${asset.name}" (${asset.kind}, asset ID: ${asset.id})${folderMsg}${trimMsg}${audioMsg}${cropMsg}. Ready to place on timeline or use in storyboard.`,
          {
            assetId: asset.id,
            asset,
            path: downloaded.path,
            title: downloaded.title,
            mediaType: downloaded.mediaType,
            bytes: downloaded.bytes,
            folderId: targetFolderId,
            reference: referenceResult,
          }
        );
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'create_project_guideline': {
      const name = str(args, 'name');
      if (!name) return fail('Supply a guideline name.');
      let notes = str(args, 'notes');
      if (!notes) return fail('Supply guideline notes covering hook structure, visual rules, pacing, and audio design.');
      let palette = list(args, 'palette');
      const pack = str(args, 'pack');
      const sourceAssetId = str(args, 'sourceAssetId');
      const makeActive = bool(args, 'makeActive') !== false;

      if (pack === 'crimson' || name.toLowerCase().includes('crimson') || name.toLowerCase().includes('motion design')) {
        if (!palette || !palette.length) {
          palette = ['#14080B', '#2A080F', '#8B0021', '#FBF7F5'];
        }
        if (!notes.includes('1 idea per frame')) {
          notes = `${notes}\n\nCrimson Motion Direction Rules:\n1. One idea per frame. Motion follows meaning. Always leave a hold (at least 1.5–2s).\n2. 5–7s visual beats (Build -> Transform -> Explain -> Hold).\n3. Layer stack: Background plate -> rear title (behind subject) -> subject cutout (roto) -> front frosted glass card -> captions.\n4. Sound: Voice leads; music bed 18–24 dB below speech; tactile clicks and sweeps.`;
        }
      }

      let sourcePath: string | null = null;
      if (sourceAssetId) {
        const asset = assets.get(sourceAssetId);
        if (asset) sourcePath = asset.path;
      }

      try {
        const ref = await api.refsSaveGuideline(name, notes, palette, pack, sourcePath);
        if (makeActive && host.setReference) {
          host.setReference(ref.id);
        }
        const brief = await api.refsBrief(ref.id);
        return done(
          `Project guideline "${ref.name}" created and activated for this video project. Its rules are now loaded in the AI context.`,
          {
            id: ref.id,
            name: ref.name,
            pack: ref.pack,
            palette: ref.palette,
            brief: brief || notes,
          }
        );
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'local_media_capabilities':
      return done('Configured direct model adapters; configured does not mean verified.', { capabilities: await api.localMediaStatus() });
    case 'install_local_model':
      try { return done('Model download started. It continues as a background job; generation requires successful installation.', { jobId: await api.localMediaInstall(str(args, 'task') ?? '') }); }
      catch (error) { return fail(errorText(error)); }
    case 'generate_local_media':
      try {
        const jobId = await api.localMediaGenerate(args);
        // Unless wait is explicitly false, wait up to 360s for video generation, 90s for images/audio, and auto-import
        if (bool(args, 'wait') !== false) {
          const defaultTimeout = args.task === 'video' ? 360000 : 90000;
          const timeout = typeof args.timeout === 'number' ? Math.min(args.timeout, 600000) : defaultTimeout;
          const start = Date.now();
          while (Date.now() - start < timeout) {
            await new Promise(resolve => setTimeout(resolve, 800));
            const jobs = await api.jobsList();
            const job = jobs.find(j => j.id === jobId);
            if (job) {
              if (job.status === 'done') {
                const res = job.result as { path?: string } | null;
                if (res?.path) {
                  const imported = await host.importMedia([res.path]);
                  if (imported.length > 0) {
                    const asset = imported[0];
                    return done(`Generated and imported local media "${asset.name}" (asset ID: ${asset.id}). Ready to place on timeline or attach to storyboard scene refs.`, {
                      jobId,
                      assetId: asset.id,
                      assets: imported,
                      path: res.path
                    });
                  }
                }
                return done('Generated media ready', { jobId, result: job.result });
              } else if (job.status === 'error' || job.status === 'cancelled') {
                return fail(`Generation ${job.status}: ${job.message}`);
              }
            }
          }
        }
        return done('Generation started. Poll generation_job; import only after it finishes.', { jobId });
      } catch (error) { return fail(errorText(error)); }
    case 'generation_job': {
      const job = (await api.jobsList()).find(entry => entry.id === str(args, 'jobId'));
      if (!job || !['generation', 'model'].includes(job.kind)) return fail('Generation or model download job not found.');
      return done(job.message, { job });
    }
    case 'import_generated_media': {
      const job = (await api.jobsList()).find(entry => entry.id === str(args, 'jobId'));
      if (!job || job.kind !== 'generation' || job.status !== 'done') return fail('Wait for a successful generation job before importing.');
      const result = job.result as { path?: string } | null;
      if (!result?.path) return fail('The completed job has no output.');
      const imported = await host.importMedia([result.path]);
      if (!imported.length) return fail('The generated artifact was not imported. Resolve the import failure before claiming it is available on the timeline.');
      return done('Generated artifact imported. Use place_clip with this asset ID and the storyboard range.', { assets: imported });
    }
    case 'rotoscope_clip': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Select a video clip by clipId.');
      const { comp, clip } = found;
      if (clip.name === 'Original background') return fail('This is a background plate layer under a subject cutout. Applying Roto to it would remove the background and make the video black. Apply Roto to the foreground layer instead.');
      const asset = assets.get(found.clip.source.assetId);
      if (!asset || asset.kind !== 'video') return fail('Roto requires video media.');
      if (comp.tracks.find(t => t.id === clip.trackId)?.locked) return fail('Unlock the clip track before applying Roto.');
      if (clip.reverse || clip.hold !== null || clip.speed !== 1) return fail('Roto currently requires a forward clip at normal speed.');
      try {
        const chosenEngine = str(args, 'engine') ?? (await api.settingsGet()).localRotoEngine ?? 'rvm';
        if (!['rvm', 'sam2-vitmatte'].includes(chosenEngine)) return fail('Choose rvm or sam2-vitmatte.');
        const engine = chosenEngine as 'rvm' | 'sam2-vitmatte';
        const model = engine === 'rvm' ? await api.matteModel() : { id: 'sam2.1-vitmatte-experimental', path: '' };
        if (!model) return fail('Install Robust Video Matting in Model Center first.');
        const supplied = Array.isArray(args.points) ? args.points : clip.rotoCorrections ?? [];
        const points = supplied.map(raw => { const row = raw as Args; return { at: num(row, 'at') ?? 0, x: num(row, 'x') ?? -1, y: num(row, 'y') ?? -1, mode: str(row, 'mode') === 'exclude' ? 'exclude' as const : 'include' as const, kind: 'click' as const, radius: 0.035, softness: 0.5 }; });
        const actualFps = (asset.fps && Number.isFinite(asset.fps) && asset.fps > 0 ? asset.fps : comp.fps);
        const result = await rotoscope(asset.id, { from: clip.in, seconds: clip.duration, fps: actualFps, modelPath: model.path, model: model.id, engine, points, signal });
        validateRotoResult(result);
        const live = host.history.current().comps.find(entry => entry.id === comp.id)?.clips.find(item => item.id === clip.id);
        if (!live || live.in !== clip.in || live.duration !== clip.duration || live.speed !== clip.speed || live.reverse !== clip.reverse || JSON.stringify(live.source) !== JSON.stringify(clip.source)) return fail('The clip changed during inference; the cached matte was not attached.');
        commit(current => updateComp(current, comp.id, entry => ({ ...entry, clips: entry.clips.map(item => {
          if (item.id !== clip.id || item.in !== clip.in || item.duration !== clip.duration || item.speed !== clip.speed || item.reverse !== clip.reverse || JSON.stringify(item.source) !== JSON.stringify(clip.source)) return item;
          return { ...item, rotoMatte: result.matte };
        }) })));
        const attached = host.history.current().comps.find(c => c.id === comp.id)?.clips.find(c => c.id === clip.id);
        if (attached?.rotoMatte !== result.matte) return fail('The matte was generated but its timeline attachment could not be confirmed. Do not claim Roto was applied.');
        return done('Subject matte generated and attachment verified. Review the cutout; a duplicate original background underneath can make isolated Roto appear unchanged until you insert text/media between the layers.', { clipId: clip.id, frames: result.frames, model: model.id, previewSupported: true, meanSubjectCoverage: result.subjects.reduce((sum, s) => sum + s.cover, 0) / result.frames, visualQualityVerified: false });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'analyze_clip_speech': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Supply a media clipId.');
      try {
        const transcript = await api.transcribeAsset(found.clip.source.assetId, str(args, 'language') ?? 'auto');
        return done('Source transcript obtained; no subtitle layers were created.', { transcript, sourceIn: found.clip.in, sourceOut: sourceOut(found.clip), timelineStart: found.clip.start, speed: found.clip.speed, reverse: found.clip.reverse });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'podcast_cut': {
      // Speaker-aware reframe: who talks when (transcript + diarization) crossed with
      // where everybody sits (face boxes from inspect_clip_frames) becomes hard cuts
      // and punch-ins on one undo step. The audio bed is never razored.
      const picked = pickComp(project, args);
      const byId = str(args, 'clipId') ? findClipIn(project, str(args, 'clipId') as string) : null;
      const fromSelection = !byId ? host.selection().map((id) => findClipIn(project, id)).find((entry) => entry && entry.clip.source.type === 'media' && assets.get(entry.clip.source.assetId)?.kind === 'video') : null;
      let found = byId ?? fromSelection ?? null;
      if (!found && picked) {
        const candidates = picked.clips.filter((clip) => clip.enabled && clip.source.type === 'media' && assets.get(clip.source.assetId)?.kind === 'video');
        const longest = [...candidates].sort((a, b) => b.duration - a.duration)[0];
        if (longest) found = { comp: picked, clip: longest };
      }
      if (!found || found.clip.source.type !== 'media') return fail('Point podcast_cut at a video clip: clipId, a selection, or the longest video clip is used.');
      const { comp, clip } = found;
      if (clip.source.type !== 'media') return fail('Point podcast_cut at a video clip.');
      const assetId = clip.source.assetId;
      const asset = assets.get(assetId);
      if (!asset || asset.kind !== 'video') return fail('Podcast cut needs a video clip.');
      if (clip.reverse || clip.hold !== null || clip.speed !== 1) return fail('Flatten the clip first: podcast cut needs forward footage at normal speed.');
      if (comp.tracks.find((track) => track.id === clip.trackId)?.locked) return fail('Unlock the clip track before the podcast cut.');

      // People: reported by eye, or tracked by machine when the person tracker
      // is installed and nobody handed boxes over.
      const rawPeople = Array.isArray(args.people) ? args.people as Args[] : [];
      const tracks: PersonTrack[] = [];
      let trackedBy: string | null = null;
      if (!rawPeople.length && (bool(args, 'autoTrack') ?? true)) {
        try {
          const status = await api.localMediaStatus();
          if (!status.tasks.some((row) => row.task === 'person-track' && row.configured)) {
            return fail('Supply people first: inspect_clip_frames (images on) across the clip, then report each visible person as {id?, label?, speaker?, boxes:[{at, x, y, width, height}]} with at in source seconds and boxes in 0..1 frame units, ~2 samples per second — or install the person tracker in Settings › Local media and re-run with autoTrack.');
          }
          const auto = await trackPeopleAsset(assetId, { from: clip.in, seconds: clip.duration, fps: 3, signal });
          for (const track of auto.tracks) tracks.push({ id: track.id, boxes: track.boxes });
          trackedBy = auto.model;
        } catch (error) { return fail(errorText(error)); }
      }
      if (!tracks.length && !rawPeople.length) {
        return fail('Supply people first: inspect_clip_frames (images on) across the clip, then report each visible person as {id?, label?, speaker?, boxes:[{at, x, y, width, height}]} with at in source seconds and boxes in 0..1 frame units, ~2 samples per second. One sample per person is enough when nobody moves.');
      }
      for (const [index, raw] of rawPeople.entries()) {
        const boxes = (Array.isArray((raw as Args).boxes) ? (raw as Args).boxes as Args[] : []).map((entry) => ({
          at: num(entry as Args, 'at') ?? NaN,
          box: {
            x: num(entry as Args, 'x') ?? NaN,
            y: num(entry as Args, 'y') ?? NaN,
            width: num(entry as Args, 'width') ?? NaN,
            height: num(entry as Args, 'height') ?? NaN,
          },
        }));
        if (!boxes.length || boxes.some((sample) => ![sample.at, sample.box.x, sample.box.y, sample.box.width, sample.box.height].every(Number.isFinite) || sample.box.width <= 0 || sample.box.height <= 0)) {
          return fail(`Person ${index + 1}: every box needs finite at, x, y, width and height in frame units.`);
        }
        tracks.push({
          id: str(raw as Args, 'id') || `person-${index}`,
          label: str(raw as Args, 'label') ?? undefined,
          speaker: num(raw as Args, 'speaker'),
          boxes: [...boxes].sort((a, b) => a.at - b.at),
        });
      }

      let transcript;
      try {
        transcript = await api.transcribeAsset(assetId, str(args, 'language') ?? 'auto');
      } catch (error) { return fail(`The cut needs words to cut on: transcription failed (${errorText(error)}).`); }
      if (!transcript.words.length) return fail('The transcript came back empty — nothing to cut on.');
      // Words arrive in source seconds; the plan runs on the timeline (speed is 1).
      const shift = clip.start - clip.in;
      const inRange = transcript.words.filter((word) => word.start >= clip.in - 0.5 && word.end <= clip.in + clip.duration * clip.speed + 0.5);
      if (!inRange.length) return fail('No transcript words fall inside this clip’s source range.');
      const timelineWords = inRange.map((word) => ({ ...word, start: word.start + shift, end: word.end + shift }));

      const mode = str(args, 'mode') === 'move' ? 'move' as const : 'cut' as const;
      const minShot = Math.min(4, Math.max(0.5, num(args, 'minShot') ?? 1.0));
      const maxZoom = Math.min(4, Math.max(1, num(args, 'maxZoom') ?? 2.2));
      const nameTags = bool(args, 'nameTags') ?? true;
      const castArg = Array.isArray(args.cast) ? args.cast as Args[] : [];
      const cast: CastEntry[] = [
        ...castArg.map((entry) => ({ person: str(entry, 'person') ?? '', speaker: num(entry, 'speaker') })).filter((entry) => entry.person),
        ...tracks.filter((track) => track.speaker !== undefined).map((track) => ({ person: track.id, speaker: track.speaker as number })),
      ];
      const { turns, attributed } = speakerTurns(timelineWords);
      const plan = planShots({
        turns, tracks,
        start: clip.start, end: clipEnd(clip),
        aspect: comp.width / Math.max(1, comp.height),
        cast, options: { minShot, maxZoom, cutaways: bool(args, 'cutaways') ?? true },
      });
      if (!plan.shots.length) return fail('The planner found no shots — check the people boxes and transcript range.');
      const applied = applyPodcastCut(comp, clip, plan, tracks, { mode, maxZoom, nameTags });
      if (!applied.ok) return fail(applied.error);
      editComp(comp, () => applied.comp);

      const review = [
        trackedBy ? `Faces by machine (${trackedBy}): eyeball one single per person — a wrong track punches the wrong face.` : 'Review the singles at 2x: a wrong box punches the wrong face — fix boxes, re-run.',
        plan.unmappedSpeakers.length ? `Speakers without faces (${plan.unmappedSpeakers.join(', ')}) stayed wide: pass cast:[{person, speaker}] to place them.` : null,
        !transcript.diarized ? 'Transcript is not diarized (one voice assumed; cuts follow speech activity). Save a Deepgram key and re-run for true who-speaks-what.' : null,
      ].filter((line): line is string => !!line);
      return done(`Podcast ${mode === 'cut' ? 'cut' : 'reframe'}: ${applied.segments} ${applied.segments === 1 ? 'segment' : 'segments'}, ${plan.shots.length} shots, audio untouched. ${review[0]}`, {
        mode, segments: applied.segments,
        shots: plan.shots, warnings: plan.warnings, review,
        markers: applied.markers, newClips: applied.newClips,
        attributed, diarized: transcript.diarized ?? false,
        unmappedSpeakers: plan.unmappedSpeakers,
        trackedBy,
      });
    }
    case 'track_people': {
      // Machine eyes for the podcast cut: RF-DETR Nano finds every person and
      // ByteTrack keeps their identities while they move. Needs the person
      // tracker installed in Settings › Local media; needs no GPU.
      const picked = pickComp(project, args);
      const byId = str(args, 'clipId') ? findClipIn(project, str(args, 'clipId') as string) : null;
      const fromSelection = !byId ? host.selection().map((id) => findClipIn(project, id)).find((entry) => entry && entry.clip.source.type === 'media' && assets.get(entry.clip.source.assetId)?.kind === 'video') : null;
      let found = byId ?? fromSelection ?? null;
      if (!found && picked) {
        const candidates = picked.clips.filter((clip) => clip.enabled && clip.source.type === 'media' && assets.get(clip.source.assetId)?.kind === 'video');
        const longest = [...candidates].sort((a, b) => b.duration - a.duration)[0];
        if (longest) found = { comp: picked, clip: longest };
      }
      if (!found || found.clip.source.type !== 'media') return fail('Point track_people at a video clip: clipId, a selection, or the longest video clip is used.');
      const { clip } = found;
      if (clip.source.type !== 'media') return fail('Point track_people at a video clip.');
      const asset = assets.get(clip.source.assetId);
      if (!asset || asset.kind !== 'video') return fail('Person tracking needs a video clip.');
      if (clip.reverse || clip.hold !== null || clip.speed !== 1) return fail('Flatten the clip first: tracking needs forward footage at normal speed.');
      const from = Math.min(Math.max(0, num(args, 'from') ?? clip.in), Math.max(0, (asset.duration ?? clip.in + clip.duration) - 0.5));
      const seconds = Math.min(Math.max(0.5, num(args, 'seconds') ?? clip.duration), 300);
      try {
        const result = await trackPeopleAsset(clip.source.assetId, { from, seconds, fps: Math.min(5, Math.max(1, num(args, 'fps') ?? 3)), signal });
        const people = result.tracks.map((track) => ({
          id: track.id,
          boxes: track.boxes.map((sample) => ({ at: sample.at, x: sample.box.x, y: sample.box.y, width: sample.box.width, height: sample.box.height })),
        }));
        return done(`Tracked ${result.tracks.length} ${result.tracks.length === 1 ? 'person' : 'people'} (${result.model}, ${result.frames} frames). Pass people straight into podcast_cut; add label/speaker per person when you know names.`, {
          people, model: result.model, frames: result.frames, detail: summarizePersonTracks(result.tracks),
        });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'create_stick_figure': {
      const comp=pickComp(project,args);if(!comp)return fail('Choose a composition.');
      const motion=str(args,'motion')||'walk';if(!['idle','walk','wave'].includes(motion))return fail('Motion must be idle, walk, or wave.');
      try{const figure=makeStickFigure(comp.width,comp.height,comp.fps,motion as import('./stickFigure').FigureMotion,num(args,'duration')??5,str(args,'color')||'#ffffff',num(args,'thickness')??12);
      commit(current=>({...current,comps:[...current.comps,figure],activeCompId:figure.id,openCompIds:[...current.openCompIds,figure.id]}));host.setSelection([]);return done('Created editable native shape layers with transform keyframes',{compId:figure.id,clipIds:figure.clips.map(c=>c.id)});}catch(error){return fail(String(error));}
    }
    case 'generate_selection_sound': {
      const comp=pickComp(project,args);if(!comp)return fail('Choose a composition.');
      const kind=str(args,'kind')||'whoosh';if(!['whoosh','impact','chime','pop','riser'].includes(kind))return fail('Choose whoosh, impact, chime, pop, or riser.');
      try{const result=generateSelectionSound(comp,list(args,'clipIds').length?list(args,'clipIds'):host.selection(),kind as import('./types').SfxKind,num(args,'gainDb')??-9);
      editComp(comp,()=>result.comp);host.setSelection(result.ids);return done('Local procedural accents added on new audio tracks; original audio preserved',{clipIds:result.ids});}catch(error){return fail(String(error));}
    }
    case 'list_effects':
      return done('Native effects with preview and export support', { effects: AVAILABLE_EFFECTS.map(effect=>({id:effect.id,name:effect.label,category:effect.group,parameters:getEffectSchema(effect.id,effect.group).params,curves:effect.id==='curves'||effect.id==='lumetri-color'})) });
    case 'edit_effect': {
      const found=findClipIn(project,str(args,'clipId')||'');
      if(!found)return fail('Unknown clipId.');
      if(found.comp.tracks.find(t=>t.id===found.clip.trackId)?.locked)return fail('The clip track is locked.');
      const clip=normalizeEffectClip(found.clip), action=str(args,'action')||'add';
      const instance=str(args,'instanceId'), previous=clip.appliedEffects?.find(f=>f.id===instance);
      const definition=AVAILABLE_EFFECTS.find(e=>e.id===(str(args,'effectId')||previous?.effectId));
      if(action!=='remove'&&action!=='toggle'&&!definition)return fail('Effect is not available. Call list_effects.');
      if(action!=='add'&&!previous)return fail('Unknown effect instanceId.');
      let stack=[...(clip.appliedEffects||[])];
      if(action==='remove')stack=stack.filter(f=>f.id!==instance);
      else if(action==='toggle')stack=stack.map(f=>f.id===instance?{...f,enabled:bool(args,'enabled')??!f.enabled}:f);
      else if(action==='add'||action==='update'||action==='reset'){
        const effect=action==='add'||action==='reset'?createAppliedEffect(definition!):{...previous!,params:{...previous!.params}};
        if(action==='reset')effect.id=previous!.id;
        const params=record(args,'params')||{};
        for(const [key,value] of Object.entries(params)){
          const parameter=getEffectSchema(effect.effectId,effect.category).params.find(p=>p.id===key);
          if(!parameter){if((effect.effectId==='curves'?['rTable','gTable','bTable','aTable']:effect.effectId==='lumetri-color'?['rTable','gTable','bTable']:[]).includes(key)&&typeof value==='string'){
            const values=value.trim().split(/\s+/).map(Number);if(values.length<2||values.length>256||values.some(v=>!Number.isFinite(v)||v<0||v>1))return fail('Curve tables need 2–256 finite values in [0,1].');
            effect.params[key]=value;continue;
          }return fail('Unknown parameter '+key);}
          if(parameter.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<(parameter.min??-Infinity)||value>(parameter.max??Infinity)))return fail('Parameter out of range: '+key);
          if(parameter.type==='boolean'&&typeof value!=='boolean')return fail('Expected boolean: '+key);
          if(parameter.type==='color'&&(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value)))return fail('Expected hex color: '+key);
          if(parameter.type==='select'&&!parameter.options?.some(o=>o.value===value))return fail('Invalid choice: '+key);
          effect.params[key]=value as number|string|boolean;
        }
        stack=action==='add'?[...stack,effect]:stack.map(f=>f.id===instance?effect:f);
      }else return fail('Use add, update, reset, toggle, or remove.');
      editComp(found.comp,current=>({...current,clips:current.clips.map(c=>c.id===clip.id?{...clip,appliedEffects:stack}:c)}));
      return done('Effect stack updated',{effects:stack});
    }
    case 'list_learned_skills': {
      const query=(str(args,'query')||'').toLowerCase();
      const skills=await api.learningLoad();
      return done('Reviewed local skill library',{skills:skills.filter(s=>s.status==='Available'&&(s.scope==='personal'||s.projectName===project.name)&&(!query||(s.name+' '+s.tags.join(' ')).toLowerCase().includes(query))).slice(0,8).map(s=>({id:s.id,name:s.name,durations:s.durations,evidence:s.evidence,limitations:s.limitations}))});
    }
    case 'apply_learned_skill': {
      const skill=(await api.learningLoad()).find(s=>s.id===str(args,'skillId')&&s.status==='Available'&&(s.scope==='personal'||s.projectName===project.name));
      const asset=assets.get(str(args,'mediaId')||'');
      if(!skill||!asset)return fail('Choose an available reviewed skill and valid media.');
      if(asset.path===skill.reference.source)return fail('Choose different target footage for adaptation.');
      const comp=newComp({name:'Learned: '+skill.name,width:skill.reference.width,height:skill.reference.height,fps:skill.reference.fps});
      let program:Program;
      try{program=adaptRhythmProgram(skill.durations,asset.id,comp.fps,asset.duration);}catch(error){return fail(String(error));}
      if(asset.duration<skill.durations.reduce((a,b)=>a+b,0))return fail('Target footage is too short.');
      const result=runProgram(project,assets,comp,program);if(!result.ok)return fail(result.error);
      commit(current=>({...current,comps:[...current.comps,result.comp],activeCompId:comp.id,openCompIds:[...current.openCompIds,comp.id]}));
      return done('Applied reviewed skill as an editable composition',{compId:comp.id});
    }

    case 'create_custom_tool': {
      const name = str(args, 'name');
      const description = str(args, 'description');
      if (!name || !description) return fail('create_custom_tool requires a name and description');
      const ops = Array.isArray(args.opsTemplate) ? (args.opsTemplate as Op[]) : [];
      if (!ops.length) return fail('create_custom_tool requires a nonempty opsTemplate array of operations');
      const params = (Array.isArray(args.params) ? args.params : []) as CustomToolParam[];
      const promptGuide = str(args, 'promptGuide');
      const existing = await loadCustomTools();
      const created = createCustomTool({ name, description, params, opsTemplate: ops, promptGuide, author: 'ai' }, existing);
      if (created.error || !created.tool) return fail(created.error || 'Failed to create tool');
      const updated = [...existing.filter(t => t.name.toLowerCase() !== created.tool!.name.toLowerCase()), created.tool];
      await saveCustomTools(updated);
      registerCustomRecipe(customToolToRecipe(created.tool));
      return done(`Created custom tool “${created.tool.name}”. Saved persistently; available to any AI model via call_custom_tool or apply_recipe.`, { tool: created.tool });
    }

    case 'list_custom_tools': {
      const query = (str(args, 'query') || '').toLowerCase();
      const tools = await loadCustomTools();
      setCustomRecipes(tools.map(customToolToRecipe));
      const filtered = tools.filter(t => !query || (t.name + ' ' + t.description + ' ' + (t.promptGuide || '')).toLowerCase().includes(query));
      return done(`Found ${filtered.length} custom tools`, { tools: filtered });
    }

    case 'call_custom_tool': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to edit');
      const name = str(args, 'name');
      if (!name) return fail('call_custom_tool requires the name of the tool to execute');
      const tools = await loadCustomTools();
      const norm = name.trim().toLowerCase();
      const tool = tools.find(t => t.name.toLowerCase() === norm);
      if (!tool) return fail(`No custom tool named “${name}” found. Call list_custom_tools to see available tools.`);
      const inputArgs = record(args, 'args') || {};
      const merged: Record<string, unknown> = {};
      for (const p of tool.params) {
        if (p.default !== undefined) merged[p.name] = p.default;
      }
      Object.assign(merged, inputArgs);
      const substituted = substituteTemplate(tool.opsTemplate, merged, comp, assets);
      if (substituted.error) return fail(substituted.error);
      const program: Program = { compId: comp.id, label: tool.name, ops: substituted.ops };
      const result = runProgram(project, assets, comp, program);
      if (!result.ok) {
        await recordToolUsage(tool.name, false, result.error);
        return fail(`Tool “${tool.name}” failed: ${result.error}`);
      }
      const summary = `${tool.name}: ${describeDiff(result.diff)}`;
      if (bool(args, 'preview')) {
        return done(`preview — ${summary}`, { preview: true, diff: result.diff, warnings: result.warnings });
      }
      await recordToolUsage(tool.name, true, summary);
      const next = result.comp;
      host.history.commit((current) => updateComp(current, comp.id, () => next), `AI Tool: ${tool.name}`);
      return done(summary, { diff: result.diff, warnings: result.warnings, newClips: result.diff.newClips });
    }

    case 'update_custom_tool': {
      const name = str(args, 'name');
      if (!name) return fail('update_custom_tool requires the name of the tool to update');
      const existing = await loadCustomTools();
      const patch: Partial<CustomTool> = {};
      if (args.description !== undefined) patch.description = str(args, 'description');
      if (args.params !== undefined && Array.isArray(args.params)) patch.params = args.params as CustomToolParam[];
      if (args.opsTemplate !== undefined && Array.isArray(args.opsTemplate)) patch.opsTemplate = args.opsTemplate as Op[];
      if (args.promptGuide !== undefined) patch.promptGuide = str(args, 'promptGuide');
      const updated = updateCustomTool(name, patch, existing);
      if (updated.error || !updated.tool) return fail(updated.error || 'Failed to update tool');
      const nextList = existing.map(t => t.id === updated.tool!.id ? updated.tool! : t);
      await saveCustomTools(nextList);
      registerCustomRecipe(customToolToRecipe(updated.tool));
      return done(`Updated custom tool “${updated.tool.name}”. Changes persisted.`, { tool: updated.tool });
    }

    case 'delete_custom_tool': {
      const name = str(args, 'name');
      if (!name) return fail('delete_custom_tool requires the name of the tool to delete');
      const existing = await loadCustomTools();
      const norm = name.trim().toLowerCase();
      const remaining = existing.filter(t => t.name.toLowerCase() !== norm);
      if (remaining.length === existing.length) return fail(`Custom tool “${name}” not found`);
      await saveCustomTools(remaining);
      setCustomRecipes(remaining.map(customToolToRecipe));
      return done(`Deleted custom tool “${name}”`);
    }
    case 'get_project':
      return { ok: true, ...aiContext(project, assets, host.selection()) };

    case 'ask_user': {
      const question = str(args, 'question');
      if (!question) return fail('ask_user needs a question');
      const options = list(args, 'options').slice(0, 6);
      const answer = await host.ask({ question, options, context: str(args, 'context') ?? null });
      return done(`asked: ${question.slice(0, 60)}`, { answer });
    }

    case 'get_comp': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to read');
      return { ok: true, ...compDetail(project, assets, comp) };
    }

    case 'apply_edit': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to edit');
      const ops = Array.isArray(args.ops) ? (args.ops as Op[]) : [];
      if (ops.length === 0) return fail('an edit needs at least one operation');
      const program: Program = { compId: comp.id, label: str(args, 'label'), ops };
      const result = runProgram(project, assets, comp, program);
      if (!result.ok) {
        // Nothing was committed, so the model gets a precise reason and can correct one operation.
        return fail(`${result.error} (operation ${result.at + 1} of ${ops.length})`);
      }
      const summary = `${program.label ?? 'edit'}: ${describeDiff(result.diff)}`;
      if (bool(args, 'preview')) {
        return done(`preview — ${summary}`, { preview: true, diff: result.diff, warnings: result.warnings });
      }
      const next = result.comp;
      host.history.commit((current) => updateComp(current, comp.id, () => next), `AI: ${program.label ?? 'edit'}`);
      return done(summary, { diff: result.diff, warnings: result.warnings, newClips: result.diff.newClips });
    }

    case 'list_recipes':
      return { ok: true, recipes: recipeCatalogue() };

    case 'apply_recipe': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to edit');
      const name = str(args, 'name');
      if (!name) return fail('apply_recipe needs the name of a recipe');
      const recipe = findRecipe(name);
      if (!recipe) return fail(`there is no recipe called "${name}" — call list_recipes to see them`);
      const params = record(args, 'params') ?? {};
      const built = buildRecipe({ project, assets, comp, params }, recipe);
      if ('error' in built) return fail(built.error);
      const result = runProgram(project, assets, comp, built.program);
      if (!result.ok) return fail(`${recipe.name} would not apply cleanly: ${result.error}`);
      const summary = `${recipe.name}: ${describeDiff(result.diff)}`;
      if (bool(args, 'preview')) {
        return done(`preview — ${summary}`, { preview: true, diff: result.diff, warnings: result.warnings, ops: built.program.ops.length });
      }
      const next = result.comp;
      host.history.commit((current) => updateComp(current, comp.id, () => next), `AI: ${recipe.name}`);
      return done(summary, { diff: result.diff, warnings: result.warnings });
    }

    case 'create_comp': {
      const preset = COMP_PRESETS.find((item) => item.id === str(args, 'preset'));
      const width = num(args, 'width') ?? preset?.width ?? 1920;
      const height = num(args, 'height') ?? preset?.height ?? 1080;
      const comp = newComp({ name: str(args, 'name') ?? 'Comp', width: Math.round(clamp(width, 16, 8192)), height: Math.round(clamp(height, 16, 8192)), fps: clamp(num(args, 'fps') ?? 30, 1, 240) });
      let next = comp;
      let cursor = 0;
      for (const mediaId of list(args, 'mediaIds')) {
        const asset = assets.get(mediaId);
        if (!asset) continue;
        const clips = clipsForSource(project, assets, { type: 'media', assetId: mediaId }, { start: cursor, videoTrack: tracksOf(next, 'video')[0].id, audioTrack: tracksOf(next, 'audio')[0].id });
        if (!clips.length) continue;
        next = placeClips(next, clips, 'overwrite');
        cursor += clips[0].duration;
      }
      const open = bool(args, 'open') !== false;
      commit((current) => ({
        ...current,
        comps: [...current.comps, next],
        activeCompId: open ? next.id : current.activeCompId,
        openCompIds: open ? [...current.openCompIds, next.id] : current.openCompIds,
      }));
      return done(`Created comp “${next.name}” (${next.width}×${next.height}, ${next.fps} fps)${cursor ? ` with ${list(args, 'mediaIds').length} clips` : ''}`, { compId: next.id });
    }

    case 'update_comp': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to change');
      const preset = COMP_PRESETS.find((item) => item.id === str(args, 'preset'));
      const patch: Partial<Comp> = {};
      const name_ = str(args, 'name');
      if (name_) patch.name = name_;
      const width = num(args, 'width') ?? preset?.width;
      const height = num(args, 'height') ?? preset?.height;
      if (width) patch.width = Math.round(clamp(width, 16, 8192));
      if (height) patch.height = Math.round(clamp(height, 16, 8192));
      const rate = num(args, 'fps');
      if (rate) patch.fps = clamp(rate, 1, 240);
      if (!Object.keys(patch).length) return fail('nothing to change');
      editComp(comp, (current) => ({ ...current, ...patch }));
      return done(`Comp “${patch.name ?? comp.name}” is now ${patch.width ?? comp.width}×${patch.height ?? comp.height} at ${patch.fps ?? comp.fps} fps`, { compId: comp.id });
    }

    case 'open_comp': {
      const comp = project.comps.find((item) => item.id === str(args, 'compId'));
      if (!comp) return fail('no comp with that id');
      host.history.view((current) => ({ ...current, activeCompId: comp.id, openCompIds: current.openCompIds.includes(comp.id) ? current.openCompIds : [...current.openCompIds, comp.id] }));
      return done(`Opened “${comp.name}”`, { compId: comp.id });
    }

    case 'create_item': {
      const kind = ITEM_KINDS[str(args, 'kind') ?? ''];
      if (!kind) return fail('unknown item kind');
      const comp = pickComp(project, args);
      const item = newItem(kind, { width: num(args, 'width') ?? comp?.width ?? 1920, height: num(args, 'height') ?? comp?.height ?? 1080 }, { name: str(args, 'name'), color: str(args, 'color'), duration: num(args, 'duration') });
      let placedOn: string | null = null;
      commit((current) => {
        let next = { ...current, items: [...current.items, item] };
        if (bool(args, 'place') && comp) {
          const at = playhead.get();
          const target = aboveTrack(comp, at, at + item.duration);
          placedOn = trackLabel(target.comp, target.track.id);
          const clips = clipsForSource(next, assets, { type: 'item', itemId: item.id }, { start: at, videoTrack: target.track.id, audioTrack: tracksOf(target.comp, 'audio')[0]?.id ?? null });
          next = updateComp(next, comp.id, () => placeClips(target.comp, clips, 'overwrite'));
        }
        return next;
      });
      return done(`Created ${ITEM_LABEL[kind]} “${item.name}”${placedOn ? ` and placed it on ${placedOn}` : ''}`, { itemId: item.id });
    }

    case 'update_item': {
      const item = project.items.find((entry) => entry.id === str(args, 'itemId'));
      if (!item) return fail('no item with that id');
      const patch: Partial<ProjectItem> = {};
      const name_ = str(args, 'name');
      const color = str(args, 'color');
      const duration = num(args, 'duration');
      if (name_) patch.name = name_;
      if (color && isHexColor(color)) patch.color = color.toUpperCase();
      if (duration) patch.duration = clamp(duration, 0.1, 24 * 3600);
      commit((current) => ({ ...current, items: current.items.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry)) }));
      return done(`Updated “${patch.name ?? item.name}”`, { itemId: item.id });
    }

    case 'create_folder': {
      const folder = { id: uid(), name: str(args, 'name') ?? 'Folder', parentId: str(args, 'parentId') ?? null };
      const moving = new Set(list(args, 'ids'));
      commit((current) => ({
        ...current,
        folders: [...current.folders, folder].map((entry) => (moving.has(entry.id) ? { ...entry, parentId: folder.id } : entry)),
        comps: current.comps.map((comp) => (moving.has(comp.id) ? { ...comp, folderId: folder.id } : comp)),
        items: current.items.map((item) => (moving.has(item.id) ? { ...item, folderId: folder.id } : item)),
        media: current.media.map((ref) => (moving.has(ref.assetId) ? { ...ref, folderId: folder.id } : ref)),
      }));
      return done(`Created folder “${folder.name}”${moving.size ? ` with ${moving.size} items` : ''}`, { folderId: folder.id });
    }

    case 'delete_project_items': {
      const ids = new Set(list(args, 'ids'));
      if (!ids.size) return fail('no ids given');
      const force = bool(args, 'force') === true;
      const counts = usage(project);
      const used = [...ids].filter((id) => (counts.get(id) ?? 0) > 0);
      if (used.length && !force) return fail(`${used.length} of these are used on a timeline — pass force: true to delete them and their clips`);
      commit((current) => {
        const comps = current.comps
          .filter((comp) => !ids.has(comp.id))
          .map((comp) => ({ ...comp, clips: comp.clips.filter((clip) => !((clip.source.type === 'media' && ids.has(clip.source.assetId)) || (clip.source.type === 'comp' && ids.has(clip.source.compId)) || (clip.source.type === 'item' && ids.has(clip.source.itemId)))) }));
        return {
          ...current,
          comps: comps.length ? comps : [newComp({ name: 'Comp 1' })],
          items: current.items.filter((item) => !ids.has(item.id)),
          media: current.media.filter((ref) => !ids.has(ref.assetId)),
          folders: current.folders.filter((folder) => !ids.has(folder.id)),
          activeCompId: comps.some((comp) => comp.id === current.activeCompId) ? current.activeCompId : (comps[0]?.id ?? null),
          openCompIds: current.openCompIds.filter((id) => comps.some((comp) => comp.id === id)),
        };
      });
      return done(`Removed ${ids.size} item${ids.size === 1 ? '' : 's'} from the project`);
    }

    case 'import_media': {
      const paths = list(args, 'paths');
      if (!paths.length) return fail('no paths given');
      const imported = await host.importMedia(paths);
      if (!imported.length) return fail('none of those files could be imported');
      return done(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`, { media: imported.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind, duration: round(asset.duration) })) });
    }

    case 'add_tracks': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const kind = str(args, 'kind') === 'audio' ? 'audio' : 'video';
      const count = Math.round(clamp(num(args, 'count') ?? 1, 1, 20));
      const result = addTracks(comp, kind, count);
      editComp(comp, () => result.comp);
      return done(`Added ${count} ${kind} track${count === 1 ? '' : 's'}`, { tracks: result.ids.map((id) => trackLabel(result.comp, id)) });
    }

    case 'update_track': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const track = resolveTrack(comp, str(args, 'track'));
      if (!track) return fail('no track with that name');
      const patch: Partial<Track> = {};
      for (const key of ['locked', 'hidden', 'muted', 'solo', 'targeted'] as const) {
        const value = bool(args, key);
        if (value !== undefined) patch[key] = value;
      }
      const name_ = str(args, 'name');
      if (name_) patch.name = name_;
      editComp(comp, (current) => updateTrack(current, track.id, patch));
      return done(`${trackLabel(comp, track.id)}: ${Object.entries(patch).map(([key, value]) => `${key} ${value}`).join(', ') || 'unchanged'}`);
    }

    case 'delete_tracks': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const ids = bool(args, 'onlyEmpty') ? emptyTracks(comp) : list(args, 'tracks').map((ref) => resolveTrack(comp, ref)?.id).filter((id): id is string => !!id);
      if (!ids.length) return fail('no tracks matched');
      editComp(comp, (current) => deleteTracks(current, ids));
      return done(`Deleted ${ids.length} track${ids.length === 1 ? '' : 's'}`);
    }

    case 'place_clip': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const source = record(args, 'source');
      if (!source) return fail('source is required');
      const mediaId = str(source, 'mediaId');
      const nestedId = str(source, 'compId');
      const itemId = str(source, 'itemId');
      let clipSource: ClipSource | null = null;
      if (mediaId) {
        if (!assets.get(mediaId)) return fail('no media with that id');
        clipSource = { type: 'media', assetId: mediaId };
      } else if (nestedId) {
        if (!project.comps.some((item) => item.id === nestedId)) return fail('no comp with that id');
        if (wouldCycle(project, comp.id, nestedId)) return fail('that would nest a comp inside itself');
        clipSource = { type: 'comp', compId: nestedId };
      } else if (itemId) {
        if (!project.items.some((item) => item.id === itemId)) return fail('no item with that id');
        clipSource = { type: 'item', itemId };
      }
      if (!clipSource) return fail('source needs mediaId, compId or itemId');
      const noAudio = bool(args, 'noAudio') ?? bool(args, 'withoutSound') ?? false;
      const audioOnly = bool(args, 'audioOnly') ?? false;
      const include = audioOnly ? 'audio' : noAudio ? 'video' : (str(args, 'include') ?? 'both');
      const info = sourceInfo(project, assets, clipSource);
      let target = comp;
      let videoTrack: string | null = null;
      let audioTrack: string | null = null;
      if (info.hasVideo && include !== 'audio') {
        const resolved = trackFor(target, str(args, 'track') ?? 'V1', 'video');
        if (!resolved) return fail('video track not found');
        target = resolved.comp;
        videoTrack = resolved.track.id;
      }
      if (info.hasAudio && include !== 'video') {
        const resolved = trackFor(target, str(args, 'audioTrack') ?? 'A1', 'audio');
        if (!resolved) return fail('audio track not found');
        target = resolved.comp;
        audioTrack = resolved.track.id;
      }
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      const clips = clipsForSource(project, assets, clipSource, { start, videoTrack, audioTrack, in: num(args, 'in'), duration: num(args, 'duration') });
      if (!clips.length) return fail('nothing to place (check include and the tracks)');

      const volume = num(args, 'volume');
      if (volume !== undefined) {
        for (const c of clips) {
          c.volume = volume;
        }
      }

      const crop = str(args, 'crop');
      if (crop) {
        const cLower = crop.toLowerCase().trim();
        for (const c of clips) {
          if (c.source.type === 'media') {
            if (cLower === '9:16' || cLower === 'vertical') {
              c.mask = { shape: 'rectangle', x: 0.21875, y: 0, width: 0.5625, height: 1, points: [], feather: 0, inverted: false };
            } else if (cLower === '1:1' || cLower === 'square') {
              c.mask = { shape: 'rectangle', x: 0.21875, y: 0, width: 0.5625, height: 1, points: [], feather: 0, inverted: false };
            } else if (cLower === '4:5') {
              c.mask = { shape: 'rectangle', x: 0.1, y: 0, width: 0.8, height: 1, points: [], feather: 0, inverted: false };
            }
          }
        }
      }

      const mode = str(args, 'mode') === 'insert' ? 'insert' : 'overwrite';
      editComp(comp, () => placeClips(target, clips, mode));
      host.setSelection(clips.map((clip) => clip.id));
      const soundTag = include === 'video' ? ' [video-only]' : include === 'audio' ? ' [audio-only]' : '';
      return done(`${mode === 'insert' ? 'Inserted' : 'Placed'} ${info.name}${soundTag} at ${timecode(start, fps(comp))} on ${clips.map((clip) => trackLabel(target, clip.trackId)).join(' + ')}`, { clipIds: clips.map((clip) => clip.id), duration: round(clips[0].duration) });
    }

    case 'add_text': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const text = str(args, 'text');
      if (!text) return fail('text is required');
      const preset = (['title', 'kinetic', 'lower-third', 'caption'] as const).find((item) => item === str(args, 'preset')) ?? 'title';
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      const duration = clamp(num(args, 'duration') ?? (preset === 'caption' ? 2.5 : 3), 0.1, 3600);
      const source = textSource(preset, { text, subtitle: str(args, 'subtitle'), color: str(args, 'color'), style: str(args, 'style') ?? project.captionStyle, vertical: bool(args, 'vertical') });
      const target = trackFor(comp, str(args, 'track'), 'video') ?? aboveTrack(comp, start, start + duration);
      const clip = newClip({ trackId: target.track.id, start, duration, source });
      const x = num(args, 'x');
      const y = num(args, 'y');
      if (x !== undefined || y !== undefined) clip.transform = { ...clip.transform, x: x ?? 0, y: y ?? 0 };
      editComp(comp, () => placeClips(target.comp, [clip], 'overwrite'));
      host.setSelection([clip.id]);
      return done(`${presetLabel(preset)} “${text}” at ${timecode(start, fps(comp))} on ${trackLabel(target.comp, target.track.id)}`, { clipId: clip.id });
    }

    case 'add_captions': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const cues = (Array.isArray(args.cues) ? args.cues : []).filter((cue): cue is { start: number; end: number; text: string } =>
        !!cue && typeof cue === 'object' && typeof (cue as Args).start === 'number' && typeof (cue as Args).end === 'number' && typeof (cue as Args).text === 'string' && (cue as { end: number }).end > (cue as { start: number }).start);
      if (!cues.length) return fail('no usable cues');
      const style = str(args, 'style') ?? project.captionStyle;
      const first = Math.min(...cues.map((cue) => cue.start));
      const last = Math.max(...cues.map((cue) => cue.end));
      const target = trackFor(comp, str(args, 'track'), 'video') ?? aboveTrack(comp, first, last);
      const clips = cues.map((cue) => newClip({ trackId: target.track.id, start: Math.max(0, cue.start), duration: Math.max(0.1, cue.end - cue.start), source: textSource('caption', { text: cue.text, style }) }));
      editComp(comp, () => placeClips(target.comp, clips, 'overwrite'));
      return done(`Added ${clips.length} captions on ${trackLabel(target.comp, target.track.id)}`, { clipIds: clips.map((clip) => clip.id) });
    }

    case 'add_sound_effect': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const kind = (['whoosh', 'impact', 'chime', 'pop', 'riser'] as const).find((item) => item === str(args, 'kind'));
      if (!kind) return fail('unknown sound effect');
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      const source: ClipSource = { type: 'sfx', kind };
      const duration = sourceInfo(project, assets, source).length;
      const target = trackFor(comp, str(args, 'track'), 'audio') ?? freeTrack(comp, 'audio', start, start + duration, 0);
      const clip = newClip({ trackId: target.track.id, start, duration, source, volume: clamp(num(args, 'volume') ?? 0.7, 0, 8) });
      editComp(comp, () => placeClips(target.comp, [clip], 'overwrite'));
      return done(`${kind} at ${timecode(start, fps(comp))} on ${trackLabel(target.comp, target.track.id)}`, { clipId: clip.id });
    }

    case 'add_voiceover': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const text = str(args, 'text');
      if (!text) return fail('there is no script to read');
      const mode = str(args, 'language') ?? 'auto';
      let asset: Asset;
      try {
        asset = await host.speak(text, str(args, 'voice') ?? null, mode, str(args, 'name'));
      } catch (error) {
        return fail(errorText(error));
      }
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      // The take was made a moment ago, so its length comes from the import, not the asset
      // map the turn started with.
      const duration = Math.max(0.1, asset.duration);
      const source: ClipSource = { type: 'media', assetId: asset.id };
      const target = trackFor(comp, str(args, 'track'), 'audio') ?? freeTrack(comp, 'audio', start, start + duration, 0);
      const clip = newClip({ trackId: target.track.id, start, duration, source, volume: clamp(num(args, 'volume') ?? 1, 0, 8) });
      editComp(comp, () => placeClips(target.comp, [clip], 'overwrite'));
      return done(
        `Voice-over at ${timecode(start, fps(comp))} on ${trackLabel(target.comp, target.track.id)} (${duration.toFixed(1)}s)`,
        { clipId: clip.id, assetId: asset.id },
      );
    }

    case 'update_clip': {
      const clipId = str(args, 'clipId');
      const found = clipId ? findClipIn(project, clipId) : null;
      if (!found) return fail('no clip with that id');
      const { comp } = found;
      let next = comp;
      const changes: string[] = [];
      const track = str(args, 'track');
      const start = num(args, 'start');
      if (track || start !== undefined) {
        const resolved = track ? trackFor(next, track, comp.tracks.find((item) => item.id === found.clip.trackId)?.kind ?? 'video') : null;
        if (track && !resolved) return fail('track not found');
        if (resolved) next = resolved.comp;
        const ids = bool(args, 'moveLinked') === false ? [found.clip.id] : next.clips.filter((item) => item.id === found.clip.id || (found.clip.linkId && item.linkId === found.clip.linkId)).map((item) => item.id);
        const shift = resolved ? tracksOf(next, resolved.track.kind).findIndex((item) => item.id === resolved.track.id) - tracksOf(next, resolved.track.kind).findIndex((item) => item.id === found.clip.trackId) : 0;
        const moved = moveClips(next, ids, (start ?? found.clip.start) - found.clip.start, { video: shift, audio: shift }, 'overwrite');
        if (!moved) return fail('the clip cannot move there');
        next = moved.comp;
        changes.push(`moved to ${timecode(start ?? found.clip.start, fps(comp))}${resolved ? ` on ${trackLabel(next, resolved.track.id)}` : ''}`);
      }
      const inPoint = num(args, 'in');
      if (inPoint !== undefined) {
        const clip = next.clips.find((item) => item.id === found.clip.id);
        if (clip) {
          const capped = clamp(inPoint, 0, Math.max(0, limit(clip) - clip.duration * clip.speed));
          next = { ...next, clips: next.clips.map((item) => (item.id === clip.id ? { ...item, in: capped } : item)) };
          changes.push(`source in ${timecode(capped, fps(comp))}`);
        }
      }
      const duration = num(args, 'duration');
      if (duration !== undefined) {
        const clip = next.clips.find((item) => item.id === found.clip.id);
        if (clip) {
          next = trimEdge(next, clip.id, 'out', clip.start + Math.max(0.01, duration), 'normal', limit, { minDuration: 1 / fps(comp) });
          changes.push(`duration ${timecode(next.clips.find((item) => item.id === clip.id)?.duration ?? duration, fps(comp))}`);
        }
      }
      const speed = num(args, 'speed');
      const reverse = bool(args, 'reverse');
      if (speed !== undefined || reverse !== undefined) {
        const clip = next.clips.find((item) => item.id === found.clip.id);
        if (clip) {
          next = setSpeed(next, [clip.id], { speed: speed ?? clip.speed, reverse, maintainPitch: bool(args, 'maintainPitch'), limit });
          changes.push(`${speed !== undefined ? `speed ${Math.round((speed ?? 1) * 100)}%` : ''}${reverse !== undefined ? ` reverse ${reverse}` : ''}`.trim());
        }
      }
      const patch: Partial<Clip> = {};
      const volume = num(args, 'volume');
      if (volume !== undefined) {
        patch.volume = clamp(volume, 0, 8);
        changes.push(`volume ${round(gainToDb(patch.volume))} dB`);
      }
      const enabled = bool(args, 'enabled');
      if (enabled !== undefined) {
        patch.enabled = enabled;
        changes.push(enabled ? 'enabled' : 'disabled');
      }
      const clipLabel = 'label' in args ? (args.label === null ? null : (str(args, 'label') as Clip['label'])) : undefined;
      if (clipLabel !== undefined) {
        patch.label = clipLabel;
        changes.push(`label ${clipLabel ?? 'none'}`);
      }
      const adjustment = bool(args, 'adjustment');
      if (adjustment !== undefined) {
        patch.adjustment = adjustment;
        changes.push(adjustment ? 'adjustment layer' : 'normal layer');
      }
      const channels = str(args, 'channels') as Clip['channels'] | undefined;
      if (channels) {
        patch.channels = channels;
        changes.push(`channels ${channels}`);
      }
      const enhance = bool(args, 'enhanceSpeech');
      if (enhance !== undefined) {
        patch.enhanceSpeech = enhance;
        changes.push(enhance ? 'Enhance Speech on' : 'Enhance Speech off');
      }
      if ('audioType' in args) patch.audioType = args.audioType === null ? null : (str(args, 'audioType') as Clip['audioType']);
      if ('hold' in args) {
        patch.hold = args.hold === null ? null : (num(args, 'hold') ?? null);
        changes.push(patch.hold === null ? 'frame hold off' : `frame hold at ${timecode(patch.hold, fps(comp))}`);
      }
      const name_ = str(args, 'name');
      if (name_) patch.name = name_;
      const transform = record(args, 'transform');
      if (transform) {
        const base = next.clips.find((item) => item.id === found.clip.id)?.transform ?? DEFAULT_TRANSFORM;
        const merged: Transform = { ...base };
        for (const key of ['x', 'y', 'scale', 'rotation', 'opacity', 'cropLeft', 'cropTop', 'cropRight', 'cropBottom'] as const) {
          const value = num(transform, key);
          if (value !== undefined) merged[key] = value;
        }
        const fit = str(transform, 'fit');
        if (fit === 'fit' || fit === 'fill') merged.fit = fit;
        patch.transform = merged;
        changes.push('transform');
      }
      const effects = record(args, 'effects');
      if (effects) {
        const base = next.clips.find((item) => item.id === found.clip.id)?.effects ?? DEFAULT_EFFECTS;
        const merged: Effects = { ...base };
        for (const key of ['brightness', 'contrast', 'saturation', 'blur', 'hue', 'invert'] as const) {
          const value = num(effects, key);
          if (value !== undefined) merged[key] = value;
        }
        for (const key of ['flipH', 'flipV'] as const) {
          const value = bool(effects, key);
          if (value !== undefined) merged[key] = value;
        }
        patch.effects = merged;
        changes.push('effects');
      }
      const text = record(args, 'text');
      if (text) {
        const clip = next.clips.find((item) => item.id === found.clip.id);
        if (clip?.source.type === 'text') {
          const preset = (['title', 'kinetic', 'lower-third', 'caption'] as const).find((item) => item === str(text, 'preset')) ?? clip.source.preset;
          patch.source = {
            ...clip.source,
            text: str(text, 'text') ?? clip.source.text,
            subtitle: typeof text.subtitle === 'string' ? text.subtitle : clip.source.subtitle,
            preset,
            color: isHexColor(str(text, 'color')) ? (str(text, 'color') as string).toUpperCase() : clip.source.color,
            style: str(text, 'style') ?? clip.source.style,
            vertical: bool(text, 'vertical') ?? clip.source.vertical,
          };
          changes.push('text');
        }
      }
      if (Object.keys(patch).length) next = { ...next, clips: next.clips.map((item) => (item.id === found.clip.id ? { ...item, ...patch } : item)) };
      if (!changes.length) return fail('nothing to change');
      editComp(comp, () => next);
      return done(`${clipName(project, assets, found.clip)}: ${changes.filter(Boolean).join(', ')}`, { clipId: found.clip.id });
    }

    case 'delete_clips': {
      const ids = list(args, 'clipIds');
      const found = ids.map((id) => findClipIn(project, id)).filter((entry): entry is { comp: Comp; clip: Clip } => !!entry);
      if (!found.length) return fail('none of those clips exist');
      const comp = found[0].comp;
      const targets = bool(args, 'includeLinked') === false ? found.map((entry) => entry.clip.id) : comp.clips.filter((clip) => found.some((entry) => entry.clip.id === clip.id || (entry.clip.linkId && clip.linkId === entry.clip.linkId))).map((clip) => clip.id);
      editComp(comp, (current) => removeClips(current, targets, bool(args, 'ripple') === true));
      return done(`Deleted ${targets.length} clip${targets.length === 1 ? '' : 's'}${bool(args, 'ripple') ? ' and closed the gap' : ''}`);
    }

    case 'split_clips': {
      const comp = pickComp(project, args);
      const at = num(args, 'time');
      if (!comp) return fail('there is no comp');
      if (at === undefined) return fail('time is required');
      const tracks = list(args, 'tracks').map((ref) => resolveTrack(comp, ref)?.id).filter((id): id is string => !!id);
      const before = comp.clips.length;
      editComp(comp, (current) => razor(current, at, tracks.length ? tracks : null));
      const after = host.history.current().comps.find((item) => item.id === comp.id)?.clips.length ?? before;
      return done(`Cut at ${timecode(at, fps(comp))} (${after - before} new clip${after - before === 1 ? '' : 's'})`);
    }

    case 'remove_range': {
      const comp = pickComp(project, args);
      const start = num(args, 'start');
      const end = num(args, 'end');
      if (!comp) return fail('there is no comp');
      if (start === undefined || end === undefined || end <= start) return fail('start and end are required, end after start');
      const tracks = list(args, 'tracks').map((ref) => resolveTrack(comp, ref)?.id).filter((id): id is string => !!id);
      const mode = str(args, 'mode') === 'lift' ? 'lift' : 'extract';
      editComp(comp, (current) => removeRange(current, start, end, mode, tracks.length ? tracks : null));
      return done(`${mode === 'lift' ? 'Lifted' : 'Extracted'} ${timecode(start, fps(comp))}–${timecode(end, fps(comp))}`);
    }

    case 'nest_clips': {
      const ids = list(args, 'clipIds');
      const first = ids.map((id) => findClipIn(project, id)).find((entry) => entry);
      if (!first) return fail('none of those clips exist');
      const result = nestClips(project, first.comp.id, ids, str(args, 'name') ?? 'Nested Comp');
      if (!result) return fail('those clips could not be nested');
      host.history.commit(() => result.project, label);
      return done(`Nested ${ids.length} clips into “${str(args, 'name') ?? 'Nested Comp'}”`, { compId: result.compId, clipIds: result.clipIds });
    }

    case 'link_clips': {
      const ids = list(args, 'clipIds');
      const first = ids.map((id) => findClipIn(project, id)).find((entry) => entry);
      if (!first) return fail('none of those clips exist');
      const linked = bool(args, 'linked') !== false;
      editComp(first.comp, (current) => setLinked(current, ids, linked));
      return done(linked ? `Linked ${ids.length} clips` : `Unlinked ${ids.length} clips`);
    }

    case 'group_clips': {
      const ids = list(args, 'clipIds');
      const first = ids.map((id) => findClipIn(project, id)).find((entry) => entry);
      if (!first) return fail('none of those clips exist');
      const grouped = bool(args, 'grouped') !== false;
      editComp(first.comp, (current) => setGrouped(current, ids, grouped));
      return done(grouped ? `Grouped ${ids.length} clips` : 'Ungrouped');
    }

    case 'set_caption_style': {
      const style = str(args, 'style');
      if (!style) return fail('style is required');
      const applyToAll = bool(args, 'applyToAll') !== false;
      let touched = 0;
      commit((current) => ({
        ...current,
        captionStyle: style,
        comps: applyToAll
          ? current.comps.map((comp) => ({
              ...comp,
              clips: comp.clips.map((clip) => {
                if (clip.source.type !== 'text' || clip.source.preset !== 'caption') return clip;
                touched++;
                return { ...clip, source: { ...clip.source, style } };
              }),
            }))
          : current.comps,
      }));
      return done(`Caption style ${style}${applyToAll ? ` applied to ${touched} captions` : ' set as the default'}`);
    }

    case 'add_marker': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const at = num(args, 'time') ?? playhead.get();
      const marker = { id: uid(), time: Math.max(0, at), name: str(args, 'name') ?? '', color: isHexColor(str(args, 'color')) ? (str(args, 'color') as string) : '#3FB950' };
      editComp(comp, (current) => ({ ...current, markers: [...current.markers, marker].sort((a, b) => a.time - b.time) }));
      return done(`Marker at ${timecode(marker.time, fps(comp))}${marker.name ? ` — ${marker.name}` : ''}`, { markerId: marker.id });
    }

    case 'set_in_out': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const inPoint = 'in' in args ? (args.in === null ? null : (num(args, 'in') ?? null)) : comp.inPoint;
      const outPoint = 'out' in args ? (args.out === null ? null : (num(args, 'out') ?? null)) : comp.outPoint;
      editComp(comp, (current) => ({ ...current, inPoint, outPoint }));
      return done(`In ${inPoint === null ? 'cleared' : timecode(inPoint, fps(comp))}, Out ${outPoint === null ? 'cleared' : timecode(outPoint, fps(comp))}`);
    }

    case 'set_playhead': {
      const at = num(args, 'time');
      if (at === undefined) return fail('time is required');
      playhead.seek(Math.max(0, at));
      const comp = pickComp(project, args);
      return done(`Playhead at ${timecode(Math.max(0, at), comp ? fps(comp) : 30)}`);
    }

    case 'undo': {
      const steps = Math.round(clamp(num(args, 'steps') ?? 1, 1, 50));
      for (let index = 0; index < steps; index++) host.history.undo();
      return done(`Undid ${steps} step${steps === 1 ? '' : 's'}`);
    }

    case 'add_transition': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const track = resolveTrack(comp, str(args, 'track'));
      const at = num(args, 'time');
      const kind = str(args, 'kind') as TransitionKind | undefined;
      if (!track) return fail('track not found');
      if (at === undefined || !kind) return fail('time and kind are required');
      const duration = clamp(num(args, 'duration') ?? 1, 1 / fps(comp), 600);
      const next = addTransition(comp, track.id, at, kind, duration);
      if (next.transitions.length === comp.transitions.length && !next.transitions.some((item) => !comp.transitions.includes(item))) return fail('no edit point near that time on that track');
      editComp(comp, () => next);
      const added = next.transitions[next.transitions.length - 1];
      return done(`${kind} on ${trackLabel(comp, track.id)} at ${timecode(at, fps(comp))}`, { transitionId: added?.id });
    }

    case 'remove_transitions': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const ids = new Set(list(args, 'ids'));
      editComp(comp, (current) => ({ ...current, transitions: current.transitions.filter((item) => !ids.has(item.id)) }));
      return done(`Removed ${ids.size} transition${ids.size === 1 ? '' : 's'}`);
    }

    case 'set_keyframes': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      const property = str(args, 'property') as KeyframedProperty | undefined;
      if (!found) return fail('no clip with that id');
      if (!property || !(property in EMPTY_KEYFRAMES)) return fail('unknown property');
      const keys: Keyframe[] = (Array.isArray(args.keyframes) ? args.keyframes : [])
        .map((entry) => {
          const key = entry as Args;
          const time = num(key, 'time');
          const value = num(key, 'value');
          if (time === undefined || value === undefined) return null;
          const easing = (['linear', 'hold', 'ease'] as const).find((item) => item === str(key, 'easing')) ?? 'linear';
          return { time: Math.max(0, time), value, easing: easing as Easing };
        })
        .filter((key): key is Keyframe => !!key)
        .sort((a, b) => a.time - b.time);
      editComp(found.comp, (current) => ({ ...current, clips: current.clips.map((clip) => (clip.id === found.clip.id ? { ...clip, keyframes: { ...clip.keyframes, [property]: keys } } : clip)) }));
      return done(keys.length ? `${keys.length} ${property} keyframes on ${clipName(project, assets, found.clip)}` : `Cleared ${property} keyframes`);
    }

    case 'set_mask': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found) return fail('no clip with that id');
      const raw = record(args, 'mask');
      let mask: Mask | null = null;
      if (raw) {
        const shape = (['rectangle', 'ellipse', 'polygon'] as const).find((item) => item === str(raw, 'shape'));
        if (!shape) return fail('mask.shape must be rectangle, ellipse or polygon');
        const points = (Array.isArray(raw.points) ? raw.points : [])
          .map((point) => (Array.isArray(point) && point.length >= 2 && point.every((value) => typeof value === 'number') ? ([point[0], point[1]] as [number, number]) : null))
          .filter((point): point is [number, number] => !!point);
        if (shape === 'polygon' && points.length < 3) return fail('a polygon mask needs at least three points');
        mask = { shape, x: num(raw, 'x') ?? 0, y: num(raw, 'y') ?? 0, width: num(raw, 'width') ?? 1, height: num(raw, 'height') ?? 1, points, feather: Math.max(0, num(raw, 'feather') ?? 0), inverted: bool(raw, 'inverted') === true };
      }
      editComp(found.comp, (current) => ({ ...current, clips: current.clips.map((clip) => (clip.id === found.clip.id ? { ...clip, mask } : clip)) }));
      return done(mask ? `${mask.shape} mask on ${clipName(project, assets, found.clip)}` : 'Mask removed');
    }

    case 'add_shape': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const shape = (['rectangle', 'ellipse', 'polygon'] as const).find((item) => item === str(args, 'shape'));
      if (!shape) return fail('shape must be rectangle, ellipse or polygon');
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      const duration = clamp(num(args, 'duration') ?? STILL_DEFAULT, 0.1, 3600);
      const source: ClipSource = {
        type: 'shape', shape,
        sides: Math.round(clamp(num(args, 'sides') ?? 5, 3, 64)),
        fill: 'fill' in args && args.fill === null ? null : (isHexColor(str(args, 'fill')) ? (str(args, 'fill') as string).toUpperCase() : '#3D7BFF'),
        stroke: isHexColor(str(args, 'stroke')) ? (str(args, 'stroke') as string).toUpperCase() : null,
        strokeWidth: Math.max(0, num(args, 'strokeWidth') ?? 0),
        width: clamp(num(args, 'width') ?? comp.width / 3, 1, 65536),
        height: clamp(num(args, 'height') ?? comp.height / 3, 1, 65536),
        cornerRadius: Math.max(0, num(args, 'cornerRadius') ?? 0),
      };
      const target = trackFor(comp, str(args, 'track'), 'video') ?? aboveTrack(comp, start, start + duration);
      const clip = newClip({ trackId: target.track.id, start, duration, source });
      clip.transform = { ...clip.transform, x: num(args, 'x') ?? 0, y: num(args, 'y') ?? 0 };
      editComp(comp, () => placeClips(target.comp, [clip], 'overwrite'));
      host.setSelection([clip.id]);
      return done(`${shape} on ${trackLabel(target.comp, target.track.id)} at ${timecode(start, fps(comp))}`, { clipId: clip.id });
    }

    case 'frame_hold': {
      const ids = list(args, 'clipIds');
      const first = ids.map((id) => findClipIn(project, id)).find((entry) => entry);
      if (!first) return fail('none of those clips exist');
      const at = num(args, 'time') ?? playhead.get();
      const mode = str(args, 'mode') === 'insert' ? 'insert' : 'add';
      if (mode === 'insert') {
        const length = clamp(num(args, 'length') ?? 2, 0.1, 3600);
        editComp(first.comp, (current) => insertFrameHold(current, first.clip.id, at, length));
        return done(`Inserted a ${length}s frame hold at ${timecode(at, fps(first.comp))}`);
      }
      editComp(first.comp, (current) => addFrameHold(current, ids, at));
      return done(`Frame hold from ${timecode(at, fps(first.comp))}`);
    }

    case 'detect_scenes': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('detect_scenes needs a media clip');
      const asset = assets.get(found.clip.source.assetId);
      if (!asset) return fail('that clip has no media');
      const sensitivity = clamp(num(args, 'sensitivity') ?? 0.6, 0, 1);
      const cuts = await api.detectScenes(asset.id, found.clip.in, sourceOut(found.clip), sensitivity);
      const times = cuts
        .map((sourceTime) => found.clip.start + (sourceTime - found.clip.in) / found.clip.speed)
        .filter((at) => at > found.clip.start + 0.05 && at < clipEnd(found.clip) - 0.05);
      if (!times.length) return done('No scene changes found');
      if (str(args, 'action') === 'markers') {
        editComp(found.comp, (current) => ({ ...current, markers: [...current.markers, ...times.map((at) => ({ id: uid(), time: at, name: 'Scene', color: '#4EA3FF' }))].sort((a, b) => a.time - b.time) }));
        return done(`Added ${times.length} scene markers`);
      }
      editComp(found.comp, (current) => times.reduce((comp, at) => razor(comp, at, null, [found.clip.id]), current));
      return done(`Cut ${times.length} scene changes`);
    }

    case 'normalize_audio': {
      const ids = list(args, 'clipIds');
      const peakDb = num(args, 'peakDb') ?? -1;
      const results: string[] = [];
      for (const id of ids) {
        const found = findClipIn(project, id);
        if (!found || found.clip.source.type !== 'media') continue;
        const asset = assets.get(found.clip.source.assetId);
        if (!asset?.hasAudio) continue;
        const peak = await api.audioPeak(asset.id, found.clip.in, sourceOut(found.clip));
        if (!Number.isFinite(peak)) continue;
        const gain = clamp(10 ** ((peakDb - peak) / 20), 0, 8);
        host.history.commit((current) => updateComp(current, found.comp.id, (comp) => ({ ...comp, clips: comp.clips.map((clip) => (clip.id === id ? { ...clip, volume: gain } : clip)) })), label);
        results.push(`${clipName(project, assets, found.clip)} ${round(gainToDb(gain))} dB`);
      }
      return results.length ? done(`Normalized to ${peakDb} dB: ${results.join(', ')}`) : fail('no clips with sound to normalize');
    }

    case 'create_motion_graphic': {
      const comp = pickComp(project, args);
      if (!comp) return fail('No composition found.');
      const template = str(args, 'template') || 'lower-third';
      const title = str(args, 'title') || 'HELIOS MOTION';
      const subtitle = str(args, 'subtitle') || '';
      const accentColor = str(args, 'accentColor') || '#38bdf8';
      const metric = str(args, 'metric') || '+340%';
      const badge = str(args, 'badge') || '';
      const html = str(args, 'html') || undefined;
      const css = str(args, 'css') || undefined;
      const js = str(args, 'js') || undefined;
      const duration = num(args, 'duration') ?? 4.0;
      const start = num(args, 'start');
      const track = str(args, 'track');
      const asNestedComp = bool(args, 'asNestedComp') ?? true;

      try {
        const result = createMotionGraphicComp(project, {
          template,
          title,
          subtitle,
          accentColor,
          metric,
          badge,
          html,
          css,
          js,
          duration,
          start,
          track,
          asNestedComp,
          targetCompId: comp.id,
        });

        host.history.commit(() => result.project, label);
        host.setSelection([result.newClipId]);

        const targetCompUpdated = result.project.comps.find((c) => c.id === result.targetCompId);
        const trackName = targetCompUpdated ? trackLabel(targetCompUpdated, result.trackId) : result.trackId;

        return done(
          `Created ${result.bundle.template} motion graphic "${title}" on ${trackName} at ${result.start}s (${result.duration}s)${asNestedComp ? ` inside comp "${result.mogrtComp?.name}"` : ''}.`,
          {
            clipId: result.newClipId,
            compId: result.mogrtComp?.id,
            targetCompId: result.targetCompId,
            track: result.trackId,
            start: result.start,
            duration: result.duration,
            template: result.bundle.template,
            title: result.bundle.title,
            html: result.bundle.html,
            css: result.bundle.css,
            js: result.bundle.js,
          }
        );
      } catch (error) {
        return fail(errorText(error));
      }
    }

    default:
      return fail(`Helios has no tool called ${name}`);
  }
}

/** A short line for the chat's tool list. */
export const toolTitle = (name: string) => name.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

export { sourceTimeAt };
