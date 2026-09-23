import { makeStickFigure } from './stickFigure';
import { describeUncovered, newlyUncovered, uncoveredSpans } from './coverage';
import { fillBackground } from './fillBackground';
import { binIds, describeMoved, organizeBin } from './binOrganize';
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
import { storyboardContentError, videoBlueprintContentError, type StoryboardSceneInput, type VideoBlueprintSceneInput } from './editWorkflow';
import { createMotionGraphicComp, mogrtCanvas } from './motionGraphics';
import { CRIMSON_GUIDELINE_NOTES, CRIMSON_PALETTE, templateCatalogue, templateSpec, type MogrtLayout } from './motionGuide';
import { describeBit, findBit, isReactBitsTemplate, libraryCounts, listBits, type ReactBitsLayer } from './rbx';
import { BRAND_KIT_TOOLS, activeBrandKit, runBrandKitTool } from './brandKitTools';
import { brandKitTheme, brandedPrompt } from './brandKit';
import { advance, attachAsset, frameQa, gatherReport, newProduction, planScenes, qaTimes, textBox, type QaIssue, type QaLayer } from './production';
import { detectBeats, snapTimesToBeats } from './beats';
import { loadPeaks } from './peaks';
import { animated } from './keyframes';
import { queryFrameAtlas, buildWanCinematicPrompt, FRAME_ATLAS_TAXONOMY } from './frameAtlas';
import { evaluateTypedDecision, type TypedQuestion } from './typedDecisions';
// Runs Helios AI's tool calls against the live project. Every tool is one undo step labelled
// "AI: …", so a turn can be stepped back or reverted whole. The catalogue the models see is
// src/lib/ai-tools.json; this file is the other half of that contract.
import catalog from './ai-tools.json';
import { MOTION_TOOLS, runMotionTool } from './motionTools';
import { SFX_GAIN_DB, sfxClipFields, sfxTrack } from './sfxLevels';
import { overlayBox } from '../motion/validate';
import { defaultSize, evaluateScene } from '../motion/evaluate';
import { layoutText } from '../motion/text';
import { clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, gainToDb, isHexColor, presetLabel, STILL_DEFAULT, timecode, uid } from './editor';
import type { History } from './history';
import { api, errorText } from './ipc';
import { describe as describeDiff, runProgram, type Op, type Program } from './editProgram';
import { buildRecipe, findRecipe, recipeCatalogue, registerCustomRecipe, setCustomRecipes } from './recipes';
import {
  loadCustomTools, saveCustomTools, createCustomTool, updateCustomTool,
  substituteTemplate, customToolToRecipe, recordToolUsage, customToolKind, substituteStepArgs, setCustomToolEnv,
  type CustomTool, type CustomToolParam, type ToolStep,
} from './customTools';
import { EASINGS, EMPTY_KEYFRAMES } from './keyframes';
import { playhead } from './playhead';
import {
  addFrameHold, addTracks, addTransition, audible, clipEnd, clipName, clipsForSource, compDuration, COMP_PRESETS, deleteBinEntries, deleteTracks, emptyTracks, freeTrack, insertFrameHold, ITEM_LABEL, moveClips,
  newClip, newComp, newItem, nestClips, placeClips, razor, removeClips, removeRange, resolveTrack, setGrouped, setLinked, setSpeed, sourceInfo, sourceLimit, sourceOut, sourceTimeAt, textSource,
  tracksOf, trackLabel, transitionWindow, trimEdge, updateComp, updateTrack, usage, wouldCycle, type AssetMap,
} from './timeline';
import type { Asset, Clip, ClipSource, Comp, Easing, Effects, ItemKind, Keyframe, KeyframedProperty, Mask, Production, ProductionBeat, ProductionShot, Project, ProjectItem, Settings, Track, TrackKind, Transform, TransitionKind, ToolResult, VideoBlueprint, VideoBlueprintAsset, VideoBlueprintScene } from './types';

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
  /** The current app settings (brand kits live there) and how to persist a change to them. */
  settings?: () => Settings;
  saveSettings?: (next: Settings) => Promise<Settings>;
  turnId?: string;
  /**
   * The checks a direct call from the model goes through before it runs — the user's permission
   * mode and the edit workflow's phase gate — returning why a call is refused, or null. A steps
   * tool runs each step through this, so saving calls in a tool never gets around them.
   */
  guard?: (name: string, args: Record<string, unknown>) => string | null;
  /** Tells the edit workflow a call ran, as it is told about direct calls. */
  record?: (name: string, args: Record<string, unknown>, result: ToolResult) => void;
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
  return {
    id: comp.id,
    name: comp.name,
    size: `${comp.width}x${comp.height}`,
    fps: comp.fps,
    duration: round(compDuration(comp)),
    inPoint: comp.inPoint,
    outPoint: comp.outPoint,
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
    blueprint: comp.videoBlueprint ?? null,
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

/**
 * The root "Generated" folder AI-made media files into, so generations never
 * scatter across the project root. Idempotent: returns the existing one when
 * the user (or an earlier turn) already made it.
 */
export function generatedFolderId(project: Project, commit: (change: (current: Project) => Project) => void): string {
  const existing = project.folders.find((folder) => folder.name === 'Generated' && !folder.parentId);
  if (existing) return existing.id;
  const id = uid();
  commit((current) => (current.folders.some((folder) => folder.id === id || (folder.name === 'Generated' && !folder.parentId))
    ? current
    : { ...current, folders: [...current.folders, { id, name: 'Generated', parentId: null }] }));
  return project.folders.find((folder) => folder.name === 'Generated' && !folder.parentId)?.id ?? id;
}

const ITEM_KINDS: Record<string, ItemKind> = {
  color_matte: 'color-matte', black_video: 'black-video', transparent_video: 'transparent-video', bars_and_tone: 'bars-and-tone', adjustment_layer: 'adjustment-layer', countdown: 'countdown',
};

// ───────────────────────────── the executor ─────────────────────────────

const SHOT_KINDS = new Set(['video', 'image', 'download', 'scrape', 'existing', 'voiceover', 'music', 'sfx']);
const MOGRT_LAYOUTS = new Set(['fullscreen', 'side-panel-right', 'side-panel-left', 'lower-third', 'behind-subject', 'pip-footage', 'top-right', 'top-left', 'centre-card']);

/** The per-beat production fields of a scene row, validated; problems are collected, not thrown. */
function parseBeat(row: Args, n: number, knownIds: Set<string>, problems: string[]): ProductionBeat {
  const beat: ProductionBeat = {};
  if (typeof row.title === 'string' && row.title.trim()) beat.title = row.title.trim().slice(0, 60);
  if (Array.isArray(row.shots)) {
    beat.shots = (row.shots as unknown[]).slice(0, 8).map((raw, j): ProductionShot => {
      const shot = (raw && typeof raw === 'object' ? raw : {}) as Args;
      const kind = SHOT_KINDS.has(String(shot.kind)) ? (String(shot.kind) as ProductionShot['kind']) : 'video';
      const out: ProductionShot = { kind, status: 'pending' };
      for (const key of ['script', 'prompt', 'negativePrompt', 'url', 'query', 'folderName', 'note'] as const) {
        if (typeof shot[key] === 'string' && (shot[key] as string).trim()) out[key] = (shot[key] as string).trim().slice(0, 2000);
      }
      if (typeof shot.seconds === 'number' && Number.isFinite(shot.seconds)) out.seconds = clamp(shot.seconds, 1, 12);
      if (typeof shot.assetId === 'string' && shot.assetId.trim()) {
        if (!knownIds.has(shot.assetId.trim())) problems.push(`Scene ${n} shot ${j + 1}: assetId "${shot.assetId}" is not imported; never invent ids.`);
        else { out.assetId = shot.assetId.trim(); out.status = 'ready'; }
      }
      if (kind === 'video') {
        if ((out.script ?? '').length < 12) problems.push(`Scene ${n} shot ${j + 1}: a text-to-video shot needs a script (≥12 chars: what happens in these 5–7 s).`);
        if ((out.prompt ?? '').length < 20) problems.push(`Scene ${n} shot ${j + 1}: a text-to-video shot needs a generation prompt (≥20 chars: subject, action, setting, lens, light).`);
        if (out.seconds === undefined) out.seconds = 6;
        else if (out.seconds < 3 || out.seconds > 8) problems.push(`Scene ${n} shot ${j + 1}: text-to-video shots are 5–7 s (got ${out.seconds}); split longer beats into several shots.`);
      }
      if (kind === 'image' && (out.prompt ?? '').length < 20) problems.push(`Scene ${n} shot ${j + 1}: an image shot needs a generation prompt (≥20 chars).`);
      if ((kind === 'download' || kind === 'scrape') && !out.url && !out.query) problems.push(`Scene ${n} shot ${j + 1}: a ${kind} shot needs a url or a query.`);
      if (kind === 'existing' && !out.assetId) problems.push(`Scene ${n} shot ${j + 1}: an existing shot needs the imported assetId.`);
      return out;
    });
  }
  const mogrt = row.mogrt && typeof row.mogrt === 'object' ? (row.mogrt as Args) : null;
  if (mogrt === null && row.mogrt === null) beat.mogrt = null;
  else if (mogrt) {
    const template = typeof mogrt.template === 'string' ? mogrt.template.trim() : '';
    if (!templateSpec(template) && !['lower-third', 'kinetic-title', 'stat-callout', 'feature-badge', 'social-callout', 'custom'].includes(template)) problems.push(`Scene ${n}: mogrt.template "${template}" is not a template; choose from ${templateCatalogue().split('\n').map((line) => line.slice(2).split(' ')[0]).join(', ')}.`);
    beat.mogrt = {
      template,
      layout: MOGRT_LAYOUTS.has(String(mogrt.layout)) ? (String(mogrt.layout) as MogrtLayout) : undefined,
      headline: typeof mogrt.headline === 'string' ? mogrt.headline.slice(0, 120) : undefined,
      kicker: typeof mogrt.kicker === 'string' ? mogrt.kicker.slice(0, 60) : undefined,
      rows: Array.isArray(mogrt.rows) ? (mogrt.rows as unknown[]).filter((r): r is string => typeof r === 'string').slice(0, 6) : undefined,
      metric: typeof mogrt.metric === 'string' ? mogrt.metric.slice(0, 24) : undefined,
      accent: typeof mogrt.accent === 'string' && isHexColor(mogrt.accent) ? mogrt.accent : undefined,
      cameraMove: typeof mogrt.cameraMove === 'string' ? mogrt.cameraMove.slice(0, 40) : undefined,
      durationSeconds: typeof mogrt.durationSeconds === 'number' ? clamp(mogrt.durationSeconds, 1, 30) : undefined,
    };
  }
  const transition = row.transition && typeof row.transition === 'object' ? (row.transition as Args) : null;
  if (transition && typeof transition.kind === 'string') beat.transition = { kind: transition.kind.slice(0, 40), duration: typeof transition.duration === 'number' ? clamp(transition.duration, 0.05, 3) : undefined, onBeat: transition.onBeat === true };
  if (Array.isArray(row.sfx)) beat.sfx = (row.sfx as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 6);
  if (typeof row.framing === 'string' && row.framing.trim()) beat.framing = row.framing.trim().slice(0, 120);
  return beat;
}

/** The plan-level production record from a save call, keeping the phase of an existing one. */
function parseProduction(args: Args, mode: Production['mode'], existing: Production | null | undefined, problems: string[]): Production {
  const fields: Partial<Production> = {};
  const research = record(args, 'research');
  if (research) {
    const sources = Array.isArray(research.sources) ? (research.sources as unknown[]).slice(0, 20).flatMap((raw) => {
      const item = (raw && typeof raw === 'object' ? raw : {}) as Args;
      return typeof item.url === 'string' && item.url.trim() ? [{ title: typeof item.title === 'string' ? item.title.slice(0, 160) : item.url.slice(0, 160), url: item.url.trim(), note: typeof item.note === 'string' ? item.note.slice(0, 300) : undefined }] : [];
    }) : [];
    const facts = Array.isArray(research.facts) ? (research.facts as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
    fields.research = { query: typeof research.query === 'string' ? research.query.slice(0, 200) : undefined, sources, facts, folderName: typeof research.folderName === 'string' ? research.folderName.slice(0, 80) : undefined };
  }
  const brief = record(args, 'brief');
  if (brief) fields.brief = { goal: typeof brief.goal === 'string' ? brief.goal.slice(0, 300) : undefined, audience: typeof brief.audience === 'string' ? brief.audience.slice(0, 120) : undefined, platform: typeof brief.platform === 'string' ? brief.platform.slice(0, 40) : undefined, aspect: typeof brief.aspect === 'string' ? brief.aspect.slice(0, 10) : undefined, targetSeconds: typeof brief.targetSeconds === 'number' ? clamp(brief.targetSeconds, 5, 3600) : undefined };
  if (typeof args.script === 'string' && args.script.trim()) fields.script = args.script.trim().slice(0, 20000);
  const music = record(args, 'music');
  if (music) {
    const source = ['generate', 'download', 'existing', 'none'].includes(String(music.source)) ? (String(music.source) as NonNullable<Production['music']>['source']) : 'generate';
    fields.music = { source, prompt: typeof music.prompt === 'string' ? music.prompt.slice(0, 600) : undefined, url: typeof music.url === 'string' ? music.url.slice(0, 600) : undefined, assetId: typeof music.assetId === 'string' ? music.assetId : undefined, status: typeof music.assetId === 'string' ? 'ready' : 'pending' };
    if (source === 'generate' && !fields.music.prompt) problems.push('music.prompt is required when music.source is "generate" (mood, instrumentation, tempo range, no vocals).');
    if (source === 'download' && !fields.music.url) problems.push('music.url is required when music.source is "download".');
  } else if (!existing?.music) {
    fields.music = { source: 'generate', prompt: 'Restrained electronic ambient bed, warm low-mid body, simple minor-key pulse, soft percussive detail, no vocals, 88–108 BPM', status: 'pending' };
  }
  if (typeof args.guideline === 'string' && args.guideline.trim()) fields.guideline = args.guideline.trim().slice(0, 80);
  if (typeof args.todoPath === 'string' && args.todoPath.trim()) fields.todoPath = args.todoPath.trim().slice(0, 200);
  // A `done` production is a finished pipeline, not one still being planned — merging onto it
  // would keep it stuck showing the old run's gates forever. Saving a plan after that means a
  // new task, so it starts a fresh production instead of reopening the old one.
  if (existing && existing.phase !== 'planning' && existing.phase !== 'done') {
    return { ...existing, ...fields, mode, music: fields.music ?? existing.music, updatedAt: Date.now() };
  }
  return newProduction(mode, fields);
}

/** Tools that produce media; with a `sceneIndex` their result attaches to the plan by itself. */
const MEDIA_TOOLS = new Set(['generate_local_media', 'import_generated_media', 'download_online_media', 'scrape_videos', 'synthesize_speech_voiceover', 'erase_subject_clip']);

const resultAssetId = (result: ToolResult): string | null => {
  const r = result as Record<string, unknown>;
  if (typeof r.assetId === 'string') return r.assetId;
  for (const key of ['assets', 'imported', 'downloaded']) {
    const list = r[key];
    if (Array.isArray(list) && list.length && list[0] && typeof (list[0] as { id?: unknown }).id === 'string') return (list[0] as { id: string }).id;
  }
  const asset = r.asset as { id?: unknown } | undefined;
  if (asset && typeof asset.id === 'string') return asset.id;
  return null;
};

/** Records a gathered asset on the production plan when the call named its scene (or is the voice-over). */
function attachGathered(host: ToolHost, name: string, args: Args, result: ToolResult): string | null {
  const assetId = resultAssetId(result);
  if (!assetId) return null;
  const project = host.history.current();
  const comp = pickComp(project, args);
  if (!comp?.production) return null;
  const sceneIndex = Number.isInteger(args.sceneIndex) ? (args.sceneIndex as number) : null;
  const shotIndex = Number.isInteger(args.shotIndex) ? (args.shotIndex as number) : null;
  const kind = name === 'synthesize_speech_voiceover' ? 'voiceover' : name === 'erase_subject_clip' ? 'video' : typeof args.kind === 'string' ? args.kind : args.task === 'audio' ? 'music' : args.task === 'image' ? 'image' : args.task === 'video' ? 'video' : name === 'download_online_media' || name === 'scrape_videos' ? 'download' : null;
  let target: { sceneIndex: number; shotIndex?: number | null; kind?: string | null } | null = null;
  if (sceneIndex !== null) target = { sceneIndex, shotIndex, kind };
  else if (kind === 'voiceover' || kind === 'music') {
    const scenes = planScenes(comp);
    const index = kind === 'voiceover' ? scenes.findIndex((scene) => (scene.shots ?? []).some((shot) => shot.kind === 'voiceover' && !shot.assetId)) : -1;
    target = index >= 0 ? { sceneIndex: index, kind } : kind === 'music' ? { sceneIndex: -1, kind: 'music' } : null;
  }
  if (!target) return null;
  const attached = attachAsset(comp, target, assetId);
  if (!attached) return null;
  let next = attached.comp;
  // The blueprint's own manifest mirrors the shot so the viewer's badge moves too.
  if (next.videoBlueprint && (kind === 'voiceover' || sceneIndex !== null)) {
    next = { ...next, videoBlueprint: { ...next.videoBlueprint, assets: next.videoBlueprint.assets.map((entry) => (
      (kind === 'voiceover' && entry.kind === 'voiceover' && !entry.assetId) || (sceneIndex !== null && entry.sceneIndex === sceneIndex && !entry.assetId)
        ? { ...entry, assetId, status: 'ready' as const } : entry)) } };
  }
  host.history.commit((current) => updateComp(current, comp.id, () => next), 'AI: attach asset to plan');
  return attached.attached;
}

// ── custom tools ───────────────────────────────────────────────────────────

/** Every tool name Helios executes: what a steps tool may call. */
export const KNOWN_TOOLS: ReadonlySet<string> = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));

/** Only ops tools become recipes; a steps tool has no edit program to build. */
const asRecipes = (tools: CustomTool[]) => tools.filter((tool) => customToolKind(tool) === 'ops').map(customToolToRecipe);

/**
 * Loads the saved tools at startup: ops tools become recipes, and the list is cached so every
 * turn's context can name them (customToolsBrief). Before this they were only found by a model
 * that happened to call list_custom_tools — a tool made in one session was invisible in the next.
 */
export async function warmCustomTools(env: { dataDir: string; ffmpeg?: string | null }) {
  const sep = env.dataDir.includes('\\') ? '\\' : '/';
  setCustomToolEnv({ workDir: `${env.dataDir}${sep}agent-workspace`, ffmpeg: env.ffmpeg, windows: sep === '\\' });
  const tools = await loadCustomTools();
  setCustomRecipes(asRecipes(tools));
  return tools;
}

/** How deep custom tools may call custom tools, so two that call each other cannot loop forever. */
const MAX_TOOL_NESTING = 4;
let toolNesting = 0;

/** A step's result, trimmed for the summary the model reads back. */
const stepLine = (index: number, step: ToolStep, result: ToolResult) =>
  `${index + 1}. ${step.tool}${step.about ? ` (${step.about})` : ''}: ${result.ok ? (result.summary ?? 'done').split('\n')[0].slice(0, 220) : `FAILED — ${result.error}`}`;

/**
 * Runs a steps tool: each call in order through runTool, so every step gets the same checks,
 * phase rules and plan bookkeeping as a direct call. Stops at the first failure unless the step
 * says continueOnError.
 */
async function runStepsTool(host: ToolHost, tool: CustomTool, params: Record<string, unknown>, comp: Comp | null, signal?: AbortSignal, turnId?: string): Promise<ToolResult> {
  if (toolNesting >= MAX_TOOL_NESTING) return fail(`Custom tools are nested ${MAX_TOOL_NESTING} deep; “${tool.name}” was not run. Check for tools that call each other.`);
  const steps = tool.steps ?? [];
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const results = { byName: {} as Record<string, unknown>, prev: null as unknown };
  const lines: string[] = [];
  toolNesting++;
  try {
    for (const [index, step] of steps.entries()) {
      if (signal?.aborted) return fail(`“${tool.name}” stopped before step ${index + 1}: the AI turn ended.\n${lines.join('\n')}`);
      const stepArgs = substituteStepArgs(step.args, params, host.history.current().comps.find((c) => c.id === comp?.id) ?? comp, results, runId);
      const refused = host.guard?.(step.tool, stepArgs) ?? null;
      const result: ToolResult = refused ? { ok: false, error: `refused — ${refused}` } : await runTool(host, step.tool, stepArgs, signal, turnId);
      if (!refused) host.record?.(step.tool, stepArgs, result);
      results.byName[String(index)] = result;
      if (step.as) results.byName[step.as] = result;
      results.prev = result;
      lines.push(stepLine(index, step, result));
      if (!result.ok && !step.continueOnError) {
        const summary = `stopped at step ${index + 1} (${step.tool}): ${result.error}`;
        await recordToolUsage(tool.name, false, summary);
        return { ok: false, error: `Tool “${tool.name}” ${summary}\nSteps run:\n${lines.join('\n')}\nFix the tool with update_custom_tool, or finish the job with direct calls.`, steps: lines };
      }
    }
  } finally {
    toolNesting--;
  }
  const summary = `${tool.name} ran ${steps.length} step${steps.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
  await recordToolUsage(tool.name, true, summary.slice(0, 300));
  return done(summary, { steps: lines, results: results.byName });
}

/**
 * Frames an edit left without a full picture, as a note for the model — "zoom out" on a shot with
 * nothing behind it renders black at the edges, and nothing else would tell it so.
 */
function coverageNote(host: ToolHost, name: string, args: Args, before: Project): string | null {
  if (name === 'fill_background') return null;
  const after = host.history.current();
  if (after === before) return null;
  const comp = pickComp(after, args);
  const previous = comp && before.comps.find((entry) => entry.id === comp.id);
  if (!comp || !previous) return null;
  try {
    const assets = host.assets();
    const fresh = newlyUncovered(uncoveredSpans(before, assets, previous), uncoveredSpans(after, assets, comp));
    return fresh.length ? describeUncovered(fresh, comp, after, assets) : null;
  } catch {
    return null;
  }
}

/**
 * Files what an AI call just added to the bin (imports, downloads, generations, motion-graphic
 * comps) into its category folder, so the bin never fills up with loose cards and clips. Only new
 * top-level entries move; an entry the call put in a folder, or one the user filed, stays put.
 */
function fileNewEntries(host: ToolHost, before: Project) {
  const after = host.history.current();
  if (after === before) return;
  const known = binIds(before);
  const fresh = new Set([...binIds(after)].filter((id) => !known.has(id)));
  if (!fresh.size) return;
  const { project, moved } = organizeBin(after, host.assets(), fresh);
  if (moved.length) host.history.commit(() => project, 'AI: file into folders');
}

export async function runTool(host: ToolHost, name: string, rawArgs: unknown, signal?: AbortSignal, turnId?: string): Promise<ToolResult> {
  const before = host.history.current();
  const inner = await runToolInner(host, name, rawArgs, signal, turnId);
  if (inner.ok) fileNewEntries(host, before);
  const note = inner.ok ? coverageNote(host, name, rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Args) : {}, before) : null;
  const result: ToolResult = note && inner.ok ? { ...inner, summary: `${inner.summary ?? 'done'}\n⚠ ${note}`, uncoveredFrames: true } : inner;
  if (result.ok && MEDIA_TOOLS.has(name)) {
    const args: Args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Args) : {};
    try {
      const attached = attachGathered(host, name, args, result);
      if (attached) return { ...result, summary: `${result.summary ?? 'done'} Attached to the plan: ${attached}.`, attachedTo: attached };
    } catch (error) {
      return { ...result, summary: `${result.summary ?? 'done'} (not attached to the plan: ${errorText(error)})` };
    }
  }
  return result;
}

async function runToolInner(host: ToolHost, name: string, rawArgs: unknown, signal?: AbortSignal, turnId?: string): Promise<ToolResult> {
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

  // The motion engine: AE-grade scenes from templates or layer JSON, and reference style profiles.
  if (MOTION_TOOLS.has(name)) {
    return runMotionTool(name, args, { project, assets, commit, editComp, pickComp, current: () => host.history.current(), setReference: host.setReference });
  }

  // Brand kits: read in any phase, written through the host's settings callbacks.
  if (BRAND_KIT_TOOLS.has(name)) {
    return runBrandKitTool(host, name, args, { project, comp: pickComp(project, args) ?? null, commit, folderFor: (folder) => findOrCreateFolder(project, commit, folder) });
  }

  switch (name) {
    case 'spawn_subagent': {
      const task = str(args, 'task');
      const labelText = str(args, 'label') || 'Subagent';
      if (!task) return fail('task is required');
      const parentTurnId = turnId ?? host.turnId ?? '';
      try {
        const result = await api.chatSpawnSubagent({
          parentTurnId,
          task,
          label: labelText,
          model: str(args, 'model') ?? undefined,
          maxRounds: num(args, 'maxRounds') ?? undefined,
        });
        return done(`Spawned subagent "${labelText}"`, { subagentId: result.subagentId, label: labelText });
      } catch (err) {
        return fail(errorText(err));
      }
    }
    case 'wait_subagent': {
      const subagentId = str(args, 'subagentId') ?? undefined;
      const parentTurnId = !subagentId ? (turnId ?? host.turnId ?? '') : undefined;
      try {
        const res = await api.chatWaitSubagent(subagentId, parentTurnId);
        return done(res.result ?? 'Subagent finished', res);
      } catch (err) {
        return fail(errorText(err));
      }
    }
    case 'list_subagents': {
      const parentTurnId = turnId ?? host.turnId ?? '';
      try {
        const subagents = await api.chatListSubagents(parentTurnId);
        return done(`Active subagents: ${subagents.length}`, { subagents });
      } catch (err) {
        return fail(errorText(err));
      }
    }
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
      const beatProblems: string[] = [];
      const scenes: NonNullable<Comp['storyboard']> = (args.scenes as Record<string, unknown>[]).map((raw, i) => {
        const row = raw as Args;
        const refs = Array.isArray(row.refs) ? (row.refs as unknown[]).filter((r): r is string => typeof r === 'string') : undefined;
        return { ...parseBeat(row, i + 1, knownIds, beatProblems), start: row.start as number, end: row.end as number, intent: row.intent as string, visual: row.visual as string, audio: row.audio as string, evidence: row.evidence as string, ...(refs?.length ? { refs } : {}) };
      });
      const production = parseProduction(args, 'footage', comp.production, beatProblems);
      if (beatProblems.length) return fail(beatProblems.slice(0, 8).join(' ') + (beatProblems.length > 8 ? ` Plus ${beatProblems.length - 8} more.` : ''));
      editComp(comp, current => ({ ...current, storyboard: scenes.sort((a, b) => a.start - b.start), production }));
      const report = gatherReport({ ...comp, storyboard: scenes, production });
      return done(production.phase === 'plan-ready'
        ? `Plan saved: ${scenes.length} scenes, ${report.total} shot(s) to gather, music ${production.music?.source ?? 'none'}. The plan is now waiting for the user — END YOUR TURN with a short summary (script spine, shots, graphics, music). Do not generate media or edit the timeline; the user presses Start generating.`
        : `Plan updated (${production.phase} phase): ${scenes.length} scenes, ${report.ready}/${report.total} shots ready.`, { scenes, production });
    }
    case 'save_video_blueprint': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const script = str(args, 'script');
      if (!script || script.trim().length < 20) return fail('Supply the full narration script (20+ chars).');
      const rawScenes = Array.isArray(args.scenes) ? (args.scenes as VideoBlueprintSceneInput[]) : [];
      const knownIds = new Set<string>([...assets.keys(), ...project.items.map(i => i.id), ...project.comps.map(c => c.id)]);
      const problem = videoBlueprintContentError(rawScenes, knownIds);
      if (problem) return fail(problem);
      const beatProblems: string[] = [];
      const scenes: VideoBlueprintScene[] = [...rawScenes]
        .sort((a, b) => a.start - b.start)
        .map((raw, i) => {
          const row = raw as Args;
          const scene: VideoBlueprintScene = {
            ...parseBeat(row, i + 1, knownIds, beatProblems),
            start: row.start as number,
            end: row.end as number,
            narration: ((row.narration as string) ?? '').trim(),
            visual: ((row.visual as string) ?? '').trim(),
            mediaSource: row.mediaSource as VideoBlueprintScene['mediaSource'],
            audio: ((row.audio as string) ?? '').trim(),
            status: 'pending',
          };
          if (typeof row.visualPrompt === 'string' && row.visualPrompt.trim()) scene.visualPrompt = row.visualPrompt.trim();
          if (typeof row.mediaUrl === 'string' && row.mediaUrl.trim()) scene.mediaUrl = row.mediaUrl.trim();
          if (typeof row.assetId === 'string' && row.assetId.trim()) scene.assetId = row.assetId.trim();
          return scene;
        });
      const narratorRaw = record(args, 'narrator');
      const narrator: NonNullable<VideoBlueprint['narrator']> = {};
      if (narratorRaw) {
        const voice = str(narratorRaw, 'voice');
        const mode = str(narratorRaw, 'mode');
        const speed = num(narratorRaw, 'speed');
        if (voice) narrator.voice = voice;
        if (mode) narrator.mode = mode;
        if (speed !== undefined) narrator.speed = Math.min(2, Math.max(0.5, speed));
      }
      const rawAssets = Array.isArray(args.assets) ? (args.assets as Args[]) : [];
      const assets_: VideoBlueprintAsset[] = rawAssets.slice(0, 60).map((raw, i) => {
        const kind = ['voiceover', 'image', 'video', 'audio', 'download'].includes(String(raw.kind)) ? String(raw.kind) as VideoBlueprintAsset['kind'] : 'image';
        const entry: VideoBlueprintAsset = {
          kind,
          description: String(raw.description ?? `Asset ${i + 1}`).slice(0, 500),
          status: 'pending',
        };
        if (typeof raw.prompt === 'string' && raw.prompt.trim()) entry.prompt = raw.prompt.trim().slice(0, 2000);
        if (typeof raw.url === 'string' && raw.url.trim()) entry.url = raw.url.trim();
        if (Number.isInteger(raw.sceneIndex) && (raw.sceneIndex as number) >= 0 && (raw.sceneIndex as number) < scenes.length) entry.sceneIndex = raw.sceneIndex as number;
        return entry;
      });
      // The voice-over is always asset zero so execution starts with narration.
      if (!assets_.some(a => a.kind === 'voiceover')) {
        assets_.unshift({ kind: 'voiceover', description: 'Full-script voice-over narration', prompt: script.trim(), status: 'pending' });
      }
      const styleRaw = record(args, 'style');
      const style: NonNullable<VideoBlueprint['style']> = {};
      if (styleRaw) {
        if (Array.isArray(styleRaw.palette)) {
          const palette = (styleRaw.palette as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8);
          if (palette.length) style.palette = palette;
        }
        if (typeof styleRaw.typography === 'string' && styleRaw.typography.trim()) style.typography = styleRaw.typography.trim().slice(0, 300);
        if (typeof styleRaw.lighting === 'string' && styleRaw.lighting.trim()) style.lighting = styleRaw.lighting.trim().slice(0, 300);
      }
      const blueprint: VideoBlueprint = {
        title: str(args, 'title') ?? comp.name,
        script: script.trim(),
        narrator,
        scenes,
        assets: assets_,
        style,
        status: 'ready',
        updatedAt: Date.now(),
      };
      const production = parseProduction(args, 'scratch', comp.production, beatProblems);
      if (beatProblems.length) return fail(beatProblems.slice(0, 8).join(' ') + (beatProblems.length > 8 ? ` Plus ${beatProblems.length - 8} more.` : ''));
      editComp(comp, current => ({ ...current, videoBlueprint: blueprint, production }));
      const total = scenes.reduce((sum, s) => sum + ((s.end as number) - (s.start as number)), 0);
      const report = gatherReport({ ...comp, videoBlueprint: blueprint, production });
      return done(production.phase === 'plan-ready'
        ? `Blueprint saved: ${scenes.length} scenes, ${round(total)}s total, ${report.total} shot(s) to gather, music ${production.music?.source ?? 'none'}. The plan is now waiting for the user — END YOUR TURN with a short summary (script, shots, graphics, music). Do not generate media or edit the timeline; the user presses Start generating.`
        : `Blueprint updated (${production.phase} phase): ${scenes.length} scenes, ${report.ready}/${report.total} shots ready.`, { blueprint, production });
    }
    case 'execute_blueprint': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const blueprint: VideoBlueprint | null | undefined = comp.videoBlueprint;
      if (!blueprint || !Array.isArray(blueprint.scenes) || !blueprint.scenes.length) return fail('No video blueprint saved on this comp. Call save_video_blueprint first.');
      const scenes = blueprint.scenes;
      const manifest = blueprint.assets ?? [];
      const importedIds = new Set<string>([...assets.keys()]);
      const missing = scenes.filter(s => {
        const id = typeof s.assetId === 'string' ? s.assetId : null;
        if (s.mediaSource === 'existing') return !id || !importedIds.has(id);
        return false;
      });
      if (missing.length) return fail(`${missing.length} scene(s) reference existing assets that are not imported. Import them (or switch those scenes to generate/download) before executing.`);
      const script = blueprint.script;
      const checklist = [
        `1. Voice-over: synthesize_speech_voiceover with the full blueprint script (${script.length} chars)${blueprint.narrator?.voice ? ` using voice ${blueprint.narrator.voice}` : ''}, autoPlace into the Generated folder.`,
        ...scenes.map((s, i) => `${i + 2}. Scene ${i + 1} (${s.start}s–${s.end}s, ${s.mediaSource}): ${s.mediaSource === 'generate' ? `generate_local_media with the scene visualPrompt` : s.mediaSource === 'download' ? `download_online_media for ${s.mediaUrl ?? 'the scene URL'}` : `place existing asset ${s.assetId}`} — narration: "${s.narration.slice(0, 80)}".`),
        `${scenes.length + 2}. Wait for ALL ${manifest.length} manifest assets to be imported into the Generated folder.`,
        `${scenes.length + 3}. Assembly: place voice-over on A1, visual clips scene-by-scene on V1/V2, add motion graphics + transitions + music bed with ducking, then verify_edit_workflow.`,
      ];
      editComp(comp, current => ({ ...current, videoBlueprint: current.videoBlueprint ? { ...current.videoBlueprint, status: 'executing' } : current.videoBlueprint }));
      return done(`Executing blueprint "${blueprint.title ?? comp.name}": ${scenes.length} scenes, ${manifest.length} manifest assets. Follow the checklist in order — voice-over first, then ALL visuals/downloads, and only then assemble the timeline.`, { checklist, scenes, manifest, script });
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

        const gatheredAssets: Asset[] = [];
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
    case 'typed_decision': {
      try {
        const state = (args.state as Record<string, unknown> | string) ?? str(args, 'premise') ?? '';
        const dType = str(args, 'type') || str(args, 'mode');
        if (!['choice', 'score', 'noul'].includes(dType || '')) {
          return fail("Supply type: 'choice', 'score', or 'noul'.");
        }

        let question: TypedQuestion;
        if (dType === 'choice') {
          const rawCriteria = Array.isArray(args.criteria) ? args.criteria : Array.isArray(args.choices) ? args.choices : Array.isArray(args.options) ? args.options : [];
          const criteria = rawCriteria.map(String);
          if (!criteria.length) return fail('Choice question requires criteria or choices array.');
          question = {
            type: 'choice',
            instructions: str(args, 'instructions') || str(args, 'premise') || 'Choose the best option',
            criteria,
            temperature: num(args, 'temperature'),
          };
        } else if (dType === 'score') {
          const rawLevels = Array.isArray(args.levels) ? args.levels : Array.isArray(args.rubric) ? args.rubric : [];
          if (!rawLevels.length) return fail('Score question requires levels or rubric array.');
          const levels = rawLevels.map((l: unknown, idx: number) => {
            if (typeof l === 'string') {
              return { level: idx + 1, label: l };
            }
            const row = l as { level?: number; label?: string; description?: string };
            return {
              level: Number(row.level ?? idx + 1),
              label: String(row.label ?? ''),
              description: row.description ? String(row.description) : undefined,
            };
          });
          question = {
            type: 'score',
            instructions: str(args, 'instructions') || str(args, 'premise') || 'Score relevance',
            levels,
            minScore: num(args, 'minScore'),
            maxScore: num(args, 'maxScore'),
          };
        } else {
          const prop = str(args, 'proposition') || str(args, 'condition');
          if (!prop) return fail('Noul question requires a proposition or condition string.');
          question = {
            type: 'noul',
            proposition: prop,
            threshold: num(args, 'threshold'),
          };
        }

        const decision = evaluateTypedDecision(state, question);
        let summary = '';
        if (decision.type === 'choice') {
          summary = `Decided: "${decision.choice}" (Confidence: ${(decision.confidence * 100).toFixed(1)}%).`;
        } else if (decision.type === 'score') {
          summary = `Score: ${decision.score} (best level: ${decision.bestLevel} - "${decision.bestLabel}").`;
        } else {
          summary = `Condition: ${decision.conditionMet ? 'Met' : 'Unmet'} (P(true): ${(decision.probability * 100).toFixed(1)}%).`;
        }

        return done(summary, { decision });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'query_frame_atlas': {
      try {
        const mood = str(args, 'mood');
        const shotSize = str(args, 'shotSize');
        const lighting = str(args, 'lighting');
        const tone = str(args, 'tone');
        const search = str(args, 'search');
        const applyAsGuideline = bool(args, 'applyAsGuideline') ?? false;

        const result = queryFrameAtlas({ mood, shotSize, lighting, tone, search });

        let guidelineId: string | undefined;
        if (applyAsGuideline && result.matches[0]) {
          const top = result.matches[0];
          const guidelineNotes = [
            `FRAME ATLAS STYLING: ${top.title} (${top.shot.toUpperCase()})`,
            `LIGHTING: ${result.stylingDirectives.lighting}`,
            `COMPOSITION: ${result.stylingDirectives.composition}`,
            `CAMERA MOVEMENT: ${result.stylingDirectives.cameraMovement}`,
            `COLOR TONE: ${result.stylingDirectives.colorTone}`,
            `TAGS: ${top.tags.join(', ')}`,
            top.notes ? `ANALYSIS NOTES: ${top.notes}` : '',
          ].filter(Boolean).join('\n');

          const guide = await api.refsSaveGuideline(
            `Frame Atlas: ${top.title}`,
            guidelineNotes,
            result.recommendedPalette,
            'frame-atlas'
          );
          guidelineId = guide.id;
          host.setReference?.(guide.id);
        }

        const summary = `Queried Frame Atlas library. Found ${result.matches.length} matching cinematic frame references (top: "${result.matches[0]?.title || 'Standard'}"). Recommended palette: ${result.recommendedPalette.join(', ')}.${guidelineId ? ' Applied and activated as project guideline.' : ''}`;

        return done(summary, {
          matches: result.matches,
          recommendedPalette: result.recommendedPalette,
          stylingDirectives: result.stylingDirectives,
          guidelineId,
          taxonomySample: {
            shotSizes: FRAME_ATLAS_TAXONOMY.shotSize,
            lightingPatterns: FRAME_ATLAS_TAXONOMY.lightPatterns,
            cameraMovements: FRAME_ATLAS_TAXONOMY.movementEvidence,
          },
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'synthesize_speech_voiceover': {
      const script = str(args, 'script');
      if (!script) return fail('Supply narration script text for voiceover synthesis.');
      const requestedVoice = str(args, 'voice');
      const autoPlace = bool(args, 'autoPlace') !== false;
      const startTime = Math.max(0, num(args, 'startTime') ?? 0);
      const customTrackId = str(args, 'trackId');
      const name = str(args, 'name') || `Voiceover: ${script.slice(0, 30).trim()}`;

      try {
        const currentSettings = typeof api.settingsGet === 'function' ? await api.settingsGet().catch(() => null) : null;
        const settingsVoice = currentSettings?.speech?.voice;
        const settingsMode = currentSettings?.speech?.voiceMode || 'auto';
        const requestedMode = str(args, 'mode');
        const mode = (requestedMode && requestedMode !== 'auto') ? requestedMode : (settingsMode !== 'auto' ? settingsMode : 'natural');

        const status = await api.speechStatus();
        // Precedence: the tool argument, then the active brand kit's voice, then Settings, then the first installed voice.
        let voice = requestedVoice || activeBrandKit(host, project)?.audio.voice || settingsVoice;

        if (!status?.piper?.found) {
          try {
            await api.modelDownload('piper-runtime');
          } catch (dlErr) {
            console.warn('Could not auto-download piper-runtime:', dlErr);
          }
        }

        if (!voice) {
          const installedVoices = await api.speechVoices().catch(() => []);
          const firstVoice = installedVoices[0];
          if (firstVoice) {
            voice = firstVoice.id;
          } else {
            try {
              await api.modelDownload('piper-en-ryan');
              voice = 'piper:piper-en-ryan';
            } catch {
              voice = 'piper:piper-en-ryan';
            }
          }
        }

        const asset = await api.speechGenerate(script, voice, mode, name);
        if (!asset || !asset.id) {
          return fail('Speech synthesis produced no audio asset.');
        }

        // Always register the generated voiceover into project.media inside the "Generated" folder
        const targetFolder = generatedFolderId(project, commit);
        commit(p => (p.media.some(ref => ref.assetId === asset.id)
          ? p
          : { ...p, media: [...p.media, { assetId: asset.id, folderId: targetFolder, offline: false }] }));

        let placedClipId: string | undefined;
        if (autoPlace) {
          const comp = project.comps[0];
          if (comp) {
            const audioTracks = tracksOf(comp, 'audio');
            let targetTrack = customTrackId ? audioTracks.find(t => t.id === customTrackId) : audioTracks[0];
            if (!targetTrack) {
              const newTrk: Track = {
                id: uid(),
                kind: 'audio',
                name: 'Voiceover',
                locked: false,
                hidden: false,
                muted: false,
                solo: false,
                targeted: true,
                syncLock: true,
                height: 48,
              };
              commit(p => updateComp(p, comp.id, c => ({ ...c, tracks: [...c.tracks, newTrk] })));
              targetTrack = newTrk;
            }

            const clipDuration = asset.duration || 5;
            const clip = newClip({
              trackId: targetTrack.id,
              start: startTime,
              in: 0,
              duration: clipDuration,
              source: { type: 'media', assetId: asset.id },
            });

            commit(p => updateComp(p, comp.id, c => ({
              ...c,
              clips: [...c.clips, clip],
            })));
            placedClipId = clip.id;
          }
        }

        const summary = `Synthesized speech voiceover "${asset.name}" (${asset.duration?.toFixed(1) || '?'}s).${placedClipId ? ` Placed on audio track at ${startTime.toFixed(1)}s.` : ' Ready in project library.'}`;

        return done(summary, {
          assetId: asset.id,
          assetName: asset.name,
          duration: asset.duration,
          placedOnTimeline: Boolean(placedClipId),
          clipId: placedClipId,
          startTime,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'scrape_videos': {
      const url = str(args, 'url');
      if (!url) return fail('Supply a webpage or social media URL to scrape videos from.');
      const shouldDownload = bool(args, 'download') !== false;
      const maxVideos = Math.min(Math.max(1, num(args, 'maxVideos') ?? 5), 20);
      const folderName = str(args, 'folderName') || `Scraped Videos: ${url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}`;
      const crop = str(args, 'crop');
      const noAudio = bool(args, 'noAudio') ?? false;

      try {
        const scraped = await api.webScrape(url, 4000);
        let candidateVideos = scraped.videos || [];

        const lowerUrl = url.toLowerCase();
        const isPlatformSelf = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')
          || lowerUrl.includes('instagram.com') || lowerUrl.includes('tiktok.com')
          || lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')
          || lowerUrl.includes('vimeo.com') || lowerUrl.includes('reddit.com')
          || lowerUrl.includes('fb.watch') || lowerUrl.includes('facebook.com')
          || lowerUrl.includes('pinterest.com') || lowerUrl.includes('pin.it')
          || lowerUrl.includes('streamable.com');

        if (isPlatformSelf && !candidateVideos.includes(url)) {
          candidateVideos = [url, ...candidateVideos];
        }

        if (!candidateVideos.length) {
          return done(`Scraped "${scraped.title || url}", but found no video sources or embeds.`, {
            url,
            title: scraped.title,
            videosFound: 0,
            videos: [],
            importedAssets: [],
          });
        }

        const selectedVideos = candidateVideos.slice(0, maxVideos);

        if (!shouldDownload) {
          return done(
            `Scraped ${candidateVideos.length} video link(s) from "${scraped.title || url}" (showing first ${selectedVideos.length}).`,
            {
              url,
              title: scraped.title,
              videosFound: candidateVideos.length,
              videos: selectedVideos,
              importedAssets: [],
            }
          );
        }

        const targetFolderId = findOrCreateFolder(project, commit, folderName);
        const importedAssets: Asset[] = [];
        const failedDownloads: { url: string; error: string }[] = [];

        for (const vUrl of selectedVideos) {
          try {
            const dl = await api.mediaDownload(
              vUrl,
              'video',
              undefined,
              undefined,
              undefined,
              undefined,
              noAudio,
              crop
            );
            const imported = await host.importMedia([dl.path], targetFolderId);
            if (imported[0]) {
              importedAssets.push(imported[0]);
            }
          } catch (dlErr) {
            failedDownloads.push({ url: vUrl, error: errorText(dlErr) });
          }
        }

        const successCount = importedAssets.length;
        const failCount = failedDownloads.length;
        const failNote = failCount > 0 ? ` (${failCount} failed to download)` : '';
        const summary = `Scraped and imported ${successCount} video(s) from "${scraped.title || url}" into project folder "${folderName}"${failNote}. Ready to place on timeline or attach to storyboard scene refs.`;

        return done(summary, {
          url,
          title: scraped.title,
          folderName,
          folderId: targetFolderId,
          videosFound: candidateVideos.length,
          downloadedCount: successCount,
          importedAssets: importedAssets.map((a) => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
            duration: a.duration,
            path: a.path,
          })),
          failedDownloads: failedDownloads.length ? failedDownloads : undefined,
        });
      } catch (error) {
        return fail(errorText(error));
      }
    }
    case 'scrape_web_page': {
      const url = str(args, 'url');
      if (!url) return fail('Supply a web page URL.');
      const maxChars = num(args, 'maxChars') ?? 4000;
      const downloadVideos = bool(args, 'downloadVideos') ?? false;
      if (downloadVideos) {
        return runTool(host, 'scrape_videos', args, signal, turnId);
      }
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
        let imported: Asset[];
        try {
          imported = await host.importMedia([downloaded.path], targetFolderId);
        } catch (importError) {
          return fail(`Downloaded to ${downloaded.path}, but Helios could not import it: ${errorText(importError)}. The source probably served a page or a stub instead of the media — try another URL or source.`);
        }
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
          palette = [...CRIMSON_PALETTE];
        }
        if (!notes.includes('CRIMSON MOTION DIRECTION')) {
          notes = `${notes}

${CRIMSON_GUIDELINE_NOTES}

Templates:
${templateCatalogue()}`;
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
    case 'local_media_capabilities': {
      const capabilities = await api.localMediaStatus();
      const disableLocalGeneration = await api.settingsGet().then((s) => s.disableLocalGeneration ?? true).catch(() => true);
      return done(
        disableLocalGeneration
          ? 'Configured direct model adapters; configured does not mean verified. Local image/video generation is turned OFF in Settings (Local Media) — plan every shot as either real footage to find online (online_research / download_online_media / scrape_videos) or, for a topic with nothing real to find, an animated explainer built with create_motion_graphic. Local audio generation (music) is unaffected.'
          : 'Configured direct model adapters; configured does not mean verified.',
        { capabilities, disableLocalGeneration },
      );
    }
    case 'install_local_model':
      try { return done('Model download started. It continues as a background job; generation requires successful installation.', { jobId: await api.localMediaInstall(str(args, 'task') ?? '') }); }
      catch (error) { return fail(errorText(error)); }
    case 'generate_local_media':
      {
        // The active brand kit's imagery rules frame every generation prompt (image, edit, inpaint, video).
        const brandForGen = activeBrandKit(host, project);
        if (brandForGen && typeof args.prompt === 'string' && args.prompt.trim()) {
          const branded = brandedPrompt(brandForGen, args.prompt, typeof args.negative_prompt === 'string' ? args.negative_prompt : undefined, args.task === 'video' ? 'video' : 'image');
          args.prompt = branded.prompt;
          args.negative_prompt = branded.negative;
        }
      }
      try {
        if (args.task === 'video') {
          // Strictly enforce maximum 5.0 seconds duration (at 16 fps, max 81 frames)
          const rawFrames = typeof args.frames === 'number' ? args.frames : 81;
          const clamped = Math.min(Math.max(5, rawFrames), 81);
          args.frames = Math.floor((clamped - 1) / 4) * 4 + 1;
          args.seconds = Math.min(typeof args.seconds === 'number' ? args.seconds : 5, 5);

          // If structured prompt parts are provided, format them into a deep cinematic prompt
          if (args.subject) {
            const wanSpec = buildWanCinematicPrompt({
              subject: String(args.subject),
              background: args.background ? String(args.background) : undefined,
              foreground: args.foreground ? String(args.foreground) : undefined,
              cameraMovement: args.cameraMovement ? String(args.cameraMovement) : undefined,
              lighting: args.lighting ? String(args.lighting) : undefined,
              colorTone: args.colorTone ? String(args.colorTone) : undefined,
              shotSize: args.shotSize ? String(args.shotSize) : undefined,
              mood: args.mood ? String(args.mood) : undefined,
              extraPrompt: args.prompt ? String(args.prompt) : undefined,
            });
            args.prompt = wanSpec.prompt;
            args.negative_prompt = args.negative_prompt
              ? `${String(args.negative_prompt)}, ${wanSpec.negativePrompt}`
              : wanSpec.negativePrompt;
          }
        }
        const jobId = await api.localMediaGenerate(args);
        // Unless wait is explicitly false, wait up to 1800s (30m) for video generation, 300s for images/audio, and auto-import
        if (bool(args, 'wait') !== false) {
          const defaultTimeout = args.task === 'video' ? 1800000 : 300000;
          const timeout = typeof args.timeout === 'number' ? Math.max(args.timeout, defaultTimeout) : defaultTimeout;
          const start = Date.now();
          while (Date.now() - start < timeout) {
            await new Promise(resolve => setTimeout(resolve, 800));
            const jobs = await api.jobsList();
            const job = jobs.find(j => j.id === jobId);
            if (job) {
              if (job.status === 'done') {
                const res = job.result as { path?: string } | null;
                if (res?.path) {
                  const imported = await host.importMedia([res.path], generatedFolderId(project, commit));
                  if (imported.length > 0) {
                    const asset = imported[0];
                    return done(`Generated and imported local media "${asset.name}" (asset ID: ${asset.id}) into the Generated folder. Ready to place on timeline or attach to storyboard scene refs.`, {
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
        return done(`Generation in progress as background job ${jobId}. It will be automatically imported into the "Generated" folder in the project area as soon as it finishes.`, { jobId });
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
      const imported = await host.importMedia([result.path], generatedFolderId(project, commit));
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
      try{const result=generateSelectionSound(comp,list(args,'clipIds').length?list(args,'clipIds'):host.selection(),kind as import('./types').SfxKind,num(args,'gainDb')??SFX_GAIN_DB[kind as import('./types').SfxKind]);
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
      const steps = Array.isArray(args.steps) ? (args.steps as ToolStep[]) : [];
      const params = (Array.isArray(args.params) ? args.params : []) as CustomToolParam[];
      const promptGuide = str(args, 'promptGuide');
      const existing = await loadCustomTools();
      const created = createCustomTool({ name, description, params, opsTemplate: ops, steps, promptGuide, author: 'ai' }, existing, KNOWN_TOOLS);
      if (created.error || !created.tool) return fail(created.error || 'Failed to create tool');
      const tool = created.tool;
      await saveCustomTools([...existing, tool]);
      if (customToolKind(tool) === 'ops') registerCustomRecipe(customToolToRecipe(tool));
      const how = customToolKind(tool) === 'steps' ? `${tool.steps!.length}-step tool` : 'timeline tool';
      return done(`Created ${how} “${tool.name}” and saved it; it is listed to every AI model on every turn. Run it now with call_custom_tool (preview: true first to see the calls it will make).`, { tool });
    }

    case 'list_custom_tools': {
      const query = (str(args, 'query') || '').toLowerCase();
      const tools = await loadCustomTools();
      setCustomRecipes(asRecipes(tools));
      const filtered = tools.filter(t => !query || (t.name + ' ' + t.description + ' ' + (t.promptGuide || '')).toLowerCase().includes(query));
      return done(`Found ${filtered.length} custom tools`, { tools: filtered.map((tool) => ({ ...tool, kind: customToolKind(tool) })) });
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
      const missing = tool.params.filter((p) => p.required && (merged[p.name] === undefined || merged[p.name] === '')).map((p) => p.name);
      if (missing.length) return fail(`Tool “${tool.name}” needs ${missing.join(', ')}`);
      if (customToolKind(tool) === 'steps') {
        if (bool(args, 'preview')) {
          // What each step would be called with; results of earlier steps are only known when it runs.
          const planned = (tool.steps ?? []).map((step, index) => ({ step: index + 1, tool: step.tool, args: substituteStepArgs(step.args, merged, comp, { byName: {}, prev: null }, 'preview') }));
          return done(`preview — ${tool.name} would make ${planned.length} call(s); nothing was run`, { preview: true, planned });
        }
        return runStepsTool(host, tool, merged, comp, signal, turnId);
      }
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
      if (args.steps !== undefined && Array.isArray(args.steps)) patch.steps = args.steps as ToolStep[];
      if (args.promptGuide !== undefined) patch.promptGuide = str(args, 'promptGuide');
      const updated = updateCustomTool(name, patch, existing, KNOWN_TOOLS);
      if (updated.error || !updated.tool) return fail(updated.error || 'Failed to update tool');
      const nextList = existing.map(t => t.id === updated.tool!.id ? updated.tool! : t);
      await saveCustomTools(nextList);
      setCustomRecipes(asRecipes(nextList));
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
      setCustomRecipes(asRecipes(remaining));
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
      commit((current) => deleteBinEntries(current, [...ids]));
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
      const brandForText = activeBrandKit(host, project);
      const source = textSource(preset, { text, subtitle: str(args, 'subtitle'), color: str(args, 'color') ?? (brandForText ? brandKitTheme(brandForText).fg : undefined), style: str(args, 'style') ?? project.captionStyle, vertical: bool(args, 'vertical') });
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
      const target = trackFor(comp, str(args, 'track'), 'audio') ?? sfxTrack(comp, start, start + duration);
      // Default level sits under the voice; an explicit volume still wins.
      const clip = newClip({ trackId: target.track.id, start, duration, source, ...sfxClipFields(kind, str(args, 'note') ?? str(args, 'name'), num(args, 'volume') !== undefined ? clamp(num(args, 'volume')!, 0, 8) : undefined) });
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
          const easing = EASINGS.find((item) => item === str(key, 'easing')) ?? 'linear';
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


    case 'attach_production_asset': {
      const comp = pickComp(project, args);
      if (!comp?.production) return fail('No production plan on this comp. Save the plan first.');
      const assetId = str(args, 'assetId') ?? '';
      if (!assets.has(assetId)) return fail('assetId is not an imported asset; use the id a generation, download or import returned.');
      const sceneIndex = num(args, 'sceneIndex');
      const kind = str(args, 'kind') ?? null;
      const target = kind === 'music' ? { sceneIndex: -1, kind } : sceneIndex === undefined ? null : { sceneIndex: Math.floor(sceneIndex), shotIndex: num(args, 'shotIndex') ?? null, kind };
      if (!target) return fail('Give sceneIndex (0-based) or kind "music".');
      const attached = attachAsset(comp, target, assetId);
      if (!attached) return fail('That scene or shot is not in the plan.');
      editComp(comp, () => attached.comp);
      const report = gatherReport(attached.comp);
      return done(`Attached ${assets.get(assetId)?.name ?? assetId} to ${attached.attached}. Gathered ${report.ready}/${report.total}.${report.missing.length ? ` Still missing: ${report.missing.slice(0, 6).join('; ')}.` : ' Everything is gathered — call finish_gathering.'}`, { ready: report.ready, total: report.total, missing: report.missing });
    }

    case 'finish_gathering': {
      const comp = pickComp(project, args);
      if (!comp?.production) return fail('No production plan on this comp.');
      if (comp.production.phase !== 'gathering') return fail(`The production is in the ${comp.production.phase} phase; finish_gathering only closes the gathering phase.`);
      const report = gatherReport(comp);
      const force = bool(args, 'acceptMissing') === true;
      if (report.missing.length && !force) return fail(`${report.missing.length} planned shot(s) still have no asset: ${report.missing.slice(0, 8).join('; ')}. Generate or download them (pass sceneIndex so they attach), retry a failed one with a simpler prompt, or — only if the user agrees — call again with acceptMissing: true and say what was dropped.`);
      const jobs = await api.jobsList();
      const running = jobs.filter((job) => job.status === 'running' && (job.kind === 'generation' || job.kind === 'media' || job.kind === 'speech'));
      if (running.length) return fail(`${running.length} generation job(s) are still running (${running.map((job) => job.label).join(', ')}). Wait for them (generation_job / import_generated_media), then finish.`);
      editComp(comp, current => ({ ...current, production: current.production ? { ...advance(current.production, 'gathered'), updatedAt: Date.now() } : current.production }));
      return done(`Gathering finished: ${report.ready}/${report.total} shots ready${report.missing.length ? `, ${report.missing.length} dropped` : ''}. END YOUR TURN now with a short list of what was gathered (asset names per scene, voice-over, music). The user presses Start editing.`, { ready: report.ready, total: report.total, dropped: report.missing });
    }

    case 'run_frame_qa': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const duration = compDuration(comp);
      if (duration <= 0) return fail('The timeline is empty; nothing to check.');
      const step = clamp(num(args, 'step') ?? 1.5, 0.25, 10);
      const times = Array.isArray(args.times) ? (args.times as unknown[]).filter((t): t is number => typeof t === 'number' && t >= 0 && t < duration).slice(0, 60) : qaTimes(comp, duration, step);
      const layers: QaLayer[] = [];
      const videoTracks = new Set(comp.tracks.filter((t) => t.kind === 'video' && !t.hidden).map((t) => t.id));
      const frameAspect = comp.width / Math.max(1, comp.height);
      for (const clip of comp.clips) {
        if (!clip.enabled || !videoTracks.has(clip.trackId)) continue;
        const from = clip.start;
        const to = clip.start + clip.duration;
        const name = clip.name ?? clip.id;
        if (clip.source.type === 'html') {
          layers.push({ clipId: clip.id, name, kind: 'graphic', box: clip.source.box ?? { x: 0, y: 0, width: 1, height: 1 }, from, to });
        } else if (clip.source.type === 'comp') {
          const child = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
          const inner = child?.clips.find((c) => c.source.type === 'html');
          const box = inner && inner.source.type === 'html' ? inner.source.box : null;
          if (child && (inner || child.name.startsWith('[MOGRT]'))) layers.push({ clipId: clip.id, name, kind: 'graphic', box: box ?? { x: 0, y: 0, width: 1, height: 1 }, from, to });
        } else if (clip.source.type === 'motion') {
          const box = overlayBox(clip.source.scene, (scene, t) => evaluateScene(scene, t, { sizeOf: (layer, time) => (layer.type === 'text' ? ((f) => [f.width, f.height] as [number, number])(layoutText(layer.text, time, (text, font) => text.length * (parseFloat(font.split('px')[0].split(' ').pop() ?? '64') || 64) * 0.55)) : defaultSize(scene, layer, time)) }));
          if (box) layers.push({ clipId: clip.id, name, kind: 'graphic', box, from, to });
        } else if (clip.source.type === 'text') {
          const box = textBox(clip, comp);
          if (box) layers.push({ clipId: clip.id, name: `${presetLabel(clip.source.preset)} "${clip.source.text.slice(0, 24)}"`, kind: clip.source.preset === 'caption' ? 'caption' : 'text', box, from, to });
        } else if (clip.source.type === 'media' && clip.rotoMatte && !(clip.name ?? '').toLowerCase().includes('background')) {
          const runId = clip.rotoMatte.replace(/[\\/]+matte\.[a-z0-9]+$/i, '').split(/[\\/]/).pop() ?? '';
          const cache = runId ? await api.rotoRead(runId).catch(() => null) : null;
          const asset = assets.get(clip.source.assetId);
          if (cache && cache.subjects.length && asset) {
            const srcAspect = asset.width / Math.max(1, asset.height);
            for (const t of times) {
              if (t < from || t >= to) continue;
              const source = clip.in + (t - clip.start) * clip.speed;
              let best = cache.subjects[0];
              for (const s of cache.subjects) if (Math.abs(s.at - source) < Math.abs(best.at - source)) best = s;
              if (best.cover < 0.01) continue;
              const scale = animated(clip, 'scale', t, clip.transform.scale) / 100;
              const tx = animated(clip, 'x', t, clip.transform.x);
              const ty = animated(clip, 'y', t, clip.transform.y);
              const picW = scale * Math.min(1, srcAspect / frameAspect);
              const picH = scale * Math.min(1, frameAspect / srcAspect);
              layers.push({ clipId: clip.id, name: `subject (${asset.name})`, kind: 'subject', box: { x: 0.5 + tx - picW / 2 + best.x * picW, y: 0.5 + ty - picH / 2 + best.y * picH, width: best.width * picW, height: best.height * picH }, from: t, to: t + 1e-3 });
            }
          }
        }
      }
      const issues: QaIssue[] = frameQa(comp, layers, times);
      const hasSubject = layers.some((l) => l.kind === 'subject');
      // Contact frames for the model's own eyes: the worst moments first, then an even spread.
      const wanted = [...new Set([...issues.slice(0, 4).map((i) => i.at), ...times.filter((_, i) => i % Math.max(1, Math.ceil(times.length / 4)) === 0)])].slice(0, 6);
      let images: string[] = [];
      let frameTimes: number[] = [];
      if (bool(args, 'images') !== false && wanted.length) {
        try {
          const dir = await api.mogrtFramesBegin('qa');
          const paths: string[] = [];
          for (const [i, t] of wanted.entries()) paths.push(await api.exportFrame(project, comp.id, t, `${dir}/qa-${String(i).padStart(2, '0')}.png`));
          images = await api.chatReadImages(paths);
          frameTimes = wanted;
        } catch (error) {
          images = [];
          frameTimes = [];
          void error;
        }
      }
      if (comp.production) editComp(comp, current => ({ ...current, production: current.production ? { ...(current.production.phase === 'editing' ? advance(current.production, 'polishing') : current.production), qa: { at: Date.now(), sampled: times.length, issues: issues.length, clear: issues.length === 0 }, updatedAt: Date.now() } : current.production }));
      const worst = issues.slice(0, 12).map((i) => `${timecode(i.at, fps(comp))} ${i.kind}: "${i.a}" vs "${i.b}" (${Math.round(i.overlap * 100)}%). ${i.suggestion}`);
      return done(issues.length
        ? `Frame QA sampled ${times.length} frames and found ${issues.length} issue(s). Fix them, then run again until clear. ${hasSubject ? '' : 'No subject track was available (rotoscope_clip gives one), so only graphic-vs-graphic and safe-area checks ran. '}${worst.join(' ')}`
        : `Frame QA sampled ${times.length} frames: no overlaps, every graphic inside the safe area.${hasSubject ? '' : ' (No subject track — rotoscope_clip a speaker clip for subject-aware checks.)'} Look at the contact frames for anything geometry cannot see (contrast, reading time), then verify_edit_workflow.`,
        { issues, sampled: times.length, times: frameTimes, images, layers: layers.filter((l) => l.kind !== 'subject').length, subjectTracked: hasSubject });
    }

    case 'organize_bin': {
      const { project: organized, moved } = organizeBin(project, assets);
      if (!moved.length) return done('The bin is already organised: nothing loose to file.', { moved: [] });
      commit(() => organized);
      return done(`Filed ${moved.length} bin entr${moved.length === 1 ? 'y' : 'ies'}: ${describeMoved(moved)}.`, { moved });
    }

    case 'fill_background': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const from = num(args, 'start') ?? 0;
      const to = num(args, 'end') ?? Infinity;
      const spans = uncoveredSpans(project, assets, comp, from, to);
      if (!spans.length) return done(`Nothing to fill: the picture already fills the frame${num(args, 'start') !== undefined || num(args, 'end') !== undefined ? ' in that range' : ' everywhere on this comp'}.`, { filled: [] });
      const result = fillBackground(project, assets, comp.id, spans, { source: str(args, 'source'), color: str(args, 'color') });
      if ('error' in result) return fail(result.error);
      commit(() => result.project);
      const lines = result.filled.map((entry) => `${entry.start.toFixed(2)}–${entry.end.toFixed(2)}s on ${entry.track}: ${entry.what}`);
      const left = uncoveredSpans(result.project, assets, result.project.comps.find((entry) => entry.id === comp.id) ?? comp);
      return done(`Filled ${result.filled.length} span${result.filled.length === 1 ? '' : 's'} behind the picture:\n${lines.join('\n')}${left.length ? `\nStill uncovered: ${describeUncovered(left, comp, result.project, assets)}` : '\nThe frame is now covered everywhere.'}`, { filled: result.filled, stillUncovered: left });
    }

    case 'layout_clip': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found) return fail('Supply the clipId of the footage to reframe.');
      const { clip, comp } = found;
      const portrait = comp.height > comp.width;
      const slot = str(args, 'slot') ?? 'left-55';
      const SLOTS: Record<string, { scale: number; x: number; y: number }> = portrait
        ? { 'left-55': { scale: 62, x: 0, y: -0.19 }, 'right-55': { scale: 62, x: 0, y: 0.19 }, 'top-55': { scale: 62, x: 0, y: -0.19 }, 'bottom-55': { scale: 62, x: 0, y: 0.19 }, 'pip-bottom-right': { scale: 36, x: 0.28, y: 0.26 }, 'pip-bottom-left': { scale: 36, x: -0.28, y: 0.26 }, 'pip-top-right': { scale: 36, x: 0.28, y: -0.26 }, 'pip-top-left': { scale: 36, x: -0.28, y: -0.26 }, 'centre-small': { scale: 72, x: 0, y: 0 }, full: { scale: 100, x: 0, y: 0 } }
        : { 'left-55': { scale: 56, x: -0.2, y: 0 }, 'right-55': { scale: 56, x: 0.2, y: 0 }, 'top-55': { scale: 56, x: -0.2, y: 0 }, 'bottom-55': { scale: 56, x: 0.2, y: 0 }, 'pip-bottom-right': { scale: 34, x: 0.3, y: 0.28 }, 'pip-bottom-left': { scale: 34, x: -0.3, y: 0.28 }, 'pip-top-right': { scale: 34, x: 0.3, y: -0.28 }, 'pip-top-left': { scale: 34, x: -0.3, y: -0.28 }, 'centre-small': { scale: 72, x: 0, y: 0 }, full: { scale: 100, x: 0, y: 0 } };
      const target = SLOTS[slot];
      if (!target) return fail(`slot must be one of ${Object.keys(SLOTS).join(', ')}.`);
      const animate = bool(args, 'animate') !== false;
      const at = clamp((num(args, 'at') ?? clip.start) - clip.start, 0, Math.max(0, clip.duration - 0.05));
      const moveSeconds = clamp(num(args, 'duration') ?? 0.66, 0.1, 3);
      const until = num(args, 'until');
      const back = until !== undefined ? clamp(until - clip.start, at + moveSeconds, clip.duration) : null;
      const fromScale = animated(clip, 'scale', clip.start + at, clip.transform.scale);
      const fromX = animated(clip, 'x', clip.start + at, clip.transform.x);
      const fromY = animated(clip, 'y', clip.start + at, clip.transform.y);
      const keys = (from: number, to: number): Keyframe[] => {
        if (!animate) return [];
        const list: Keyframe[] = [{ time: at, value: from, easing: 'ease-out' }, { time: at + moveSeconds, value: to, easing: 'hold' }];
        if (back !== null) list.push({ time: back, value: to, easing: 'ease-out' }, { time: Math.min(clip.duration, back + moveSeconds), value: from, easing: 'linear' });
        return list;
      };
      editComp(comp, current => ({ ...current, clips: current.clips.map((c) => (c.id !== clip.id ? c : {
        ...c,
        transform: animate ? c.transform : { ...c.transform, scale: target.scale, x: target.x, y: target.y },
        keyframes: animate ? { ...c.keyframes, scale: keys(fromScale, target.scale), x: keys(fromX, target.x), y: keys(fromY, target.y) } : c.keyframes,
      })) }));
      const free = slot.startsWith('left') || slot.endsWith('left') ? 'right' : slot.startsWith('right') || slot.endsWith('right') ? 'left' : 'centre';
      return done(`${clip.name ?? clip.id} reframed to ${slot} (scale ${target.scale}%)${animate ? ` with a ${moveSeconds}s ease-out move at ${timecode(clip.start + at, fps(comp))}${back !== null ? ` returning at ${timecode(clip.start + back, fps(comp))}` : ''}` : ''}. The ${free} side is free for a side-panel / teaching-card (layout side-panel-${free === 'centre' ? 'right' : free}).`, { clipId: clip.id, slot, transform: target, freeSide: free });
    }

    case 'seamless_transition': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const time = num(args, 'time');
      if (time === undefined) return fail('time (timeline seconds of the cut) is required.');
      const style = str(args, 'style') ?? 'push';
      const track = trackFor(comp, str(args, 'track') ?? 'V1', 'video');
      if (!track) return fail('track must be a video track like V1.');
      const seconds = clamp(num(args, 'duration') ?? (style === 'zoom-punch' ? 0.35 : style === 'occluder' ? 0.7 : 0.4), 0.1, 2);
      const tolerance = 0.5 / fps(comp) + 0.02;
      const on = comp.clips.filter((c) => c.trackId === track.track.id && c.enabled);
      const outgoing = on.find((c) => Math.abs(c.start + c.duration - time) <= tolerance) ?? null;
      const incoming = on.find((c) => Math.abs(c.start - time) <= tolerance) ?? null;
      if (!outgoing && !incoming) return fail(`No cut on ${trackLabel(comp, track.track.id)} at ${timecode(time, fps(comp))}. Give the exact time where one clip ends and the next begins.`);
      let next = comp;
      const scaleKeys = (clip: Clip, from: number, to: number, atLocal: number, ease: Easing): Keyframe[] => {
        const kept = clip.keyframes.scale.filter((k) => k.time < atLocal - 1e-6 || k.time > atLocal + seconds + 1e-6);
        const added: Keyframe[] = [{ time: atLocal, value: from, easing: ease }, { time: atLocal + seconds, value: to, easing: 'hold' }];
        return [...kept, ...added].sort((a, b) => a.time - b.time);
      };
      const punch = style === 'zoom-punch' ? 12 : 6;
      const withScale = (id: string, keys: (clip: Clip) => Keyframe[]) => { next = { ...next, clips: next.clips.map((c) => (c.id === id ? { ...c, keyframes: { ...c.keyframes, scale: keys(c) } } : c)) }; };
      if (style === 'push' || style === 'zoom-punch' || style === 'blur-push') {
        if (outgoing) withScale(outgoing.id, (c) => scaleKeys(c, c.transform.scale, c.transform.scale + punch, Math.max(0, c.duration - seconds), 'ease-in'));
        if (incoming) withScale(incoming.id, (c) => scaleKeys(c, c.transform.scale + punch, c.transform.scale, 0, 'ease-out'));
        if (outgoing && incoming) next = addTransition(next, track.track.id, time, style === 'push' ? 'push-left' : 'cross-zoom', seconds, tolerance);
      } else if (style === 'occluder') {
        // A red glass card sweeps across the cut: the plate changes while it covers the frame.
        const built = createMotionGraphicComp({ ...project, comps: project.comps.map((c) => (c.id === next.id ? next : c)) }, { template: 'ribbon-title', title: str(args, 'title') ?? '', kicker: str(args, 'kicker') ?? '', duration: seconds * 2, start: Math.max(0, time - seconds), targetCompId: comp.id, asNestedComp: true, canvas: mogrtCanvas(comp) });
        next = built.project.comps.find((c) => c.id === comp.id) ?? next;
        commit(() => built.project);
      } else if (style === 'cut') {
        // Nothing but the sound below.
      } else return fail('style must be push, zoom-punch, blur-push, occluder or cut.');
      if (style !== 'occluder') editComp(comp, () => next);
      let sfxId: string | null = null;
      if (bool(args, 'whoosh') !== false) {
        const source: ClipSource = { type: 'sfx', kind: style === 'occluder' ? 'riser' : 'whoosh' };
        const length = sourceInfo(project, assets, source).length;
        const start = Math.max(0, time - 0.25);
        const latest = host.history.current().comps.find((c) => c.id === comp.id) ?? next;
        const free = sfxTrack(latest, start, start + length);
        const sfx = newClip({ trackId: free.track.id, start, duration: length, source, ...sfxClipFields(source.kind, `${style} transition`) });
        editComp(latest, () => placeClips(free.comp, [sfx], 'overwrite'));
        sfxId = sfx.id;
      }
      return done(`${style} transition at ${timecode(time, fps(comp))} on ${trackLabel(comp, track.track.id)}: ${outgoing ? `outgoing ${outgoing.name ?? outgoing.id} pushes ${punch}%` : ''}${incoming ? `, incoming ${incoming.name ?? incoming.id} settles from ${punch}%` : ''}${sfxId ? ', whoosh 0.25 s before the cut' : ''}. Keyframes use ease-in/ease-out so the move is weighted; it exports.`, { outgoingId: outgoing?.id ?? null, incomingId: incoming?.id ?? null, sfxClipId: sfxId, seconds });
    }

    case 'analyze_music_beats': {
      const comp = pickComp(project, args);
      let asset: Asset | undefined;
      const clipRef = str(args, 'clipId');
      if (clipRef) {
        const found = findClipIn(project, clipRef);
        if (found?.clip.source.type === 'media') asset = assets.get(found.clip.source.assetId);
      }
      if (!asset && str(args, 'assetId')) asset = assets.get(str(args, 'assetId') ?? '');
      if (!asset && comp?.production?.music?.assetId) asset = assets.get(comp.production.music.assetId);
      if (!asset) return fail('Give the music assetId or clipId (or attach the music to the plan first).');
      if (!asset.peaks) return fail(`${asset.name} has no waveform analysis yet; wait for its import to finish, then retry.`);
      const peaks = await loadPeaks(asset.peaks);
      if (!peaks) return fail('The waveform data could not be read.');
      const analysis = detectBeats(peaks, { start: num(args, 'start'), end: num(args, 'end'), minBpm: num(args, 'minBpm'), maxBpm: num(args, 'maxBpm') });
      if (comp?.production && (!comp.production.music?.assetId || comp.production.music.assetId === asset.id)) {
        editComp(comp, current => ({ ...current, production: current.production ? { ...current.production, music: { ...(current.production.music ?? { source: 'existing' as const }), assetId: asset!.id, status: 'ready', bpm: analysis.bpm, beats: analysis.beats.slice(0, 4000) }, updatedAt: Date.now() } : current.production }));
      }
      return done(`${asset.name}: ${analysis.bpm.toFixed(1)} BPM (confidence ${(analysis.confidence * 100).toFixed(0)}%), ${analysis.beats.length} beats over ${analysis.duration.toFixed(1)} s, downbeats every 4. Beat times are source seconds; snap_cuts_to_beats maps them to the timeline through the music clip.`, { assetId: asset.id, bpm: analysis.bpm, confidence: analysis.confidence, beats: analysis.beats.slice(0, 64), beatCount: analysis.beats.length, downbeats: analysis.downbeats.slice(0, 32) });
    }

    case 'snap_cuts_to_beats': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const tolerance = clamp(num(args, 'tolerance') ?? 0.12, 0.02, 0.5);
      let beats: number[] = Array.isArray(args.beats) ? (args.beats as unknown[]).filter((b): b is number => typeof b === 'number') : [];
      if (!beats.length) {
        const music = comp.production?.music;
        const musicClip = music?.assetId ? comp.clips.find((c) => c.enabled && c.source.type === 'media' && c.source.assetId === music.assetId) : undefined;
        if (!music?.beats?.length || !musicClip) return fail('No beats known: run analyze_music_beats on the music (placed on the timeline) first, or pass beats as timeline seconds.');
        beats = music.beats.map((b) => musicClip.start + (b - musicClip.in) / musicClip.speed).filter((t) => t >= 0);
      }
      const videoTracks = comp.tracks.filter((t) => t.kind === 'video' && !t.locked);
      const only = Array.isArray(args.clipIds) ? new Set((args.clipIds as unknown[]).filter((id): id is string => typeof id === 'string')) : null;
      const minFrame = 1 / fps(comp);
      const changes: { clipId: string; name: string; edge: 'start' | 'end'; from: number; to: number }[] = [];
      let next = comp;
      for (const track of videoTracks) {
        const clips = next.clips.filter((c) => c.trackId === track.id && c.enabled).sort((a, b) => a.start - b.start);
        clips.forEach((clip, i) => {
          if (only && !only.has(clip.id)) return;
          const overlay = clip.source.type !== 'media';
          const prev = clips[i - 1];
          const after = clips[i + 1];
          const startSnap = snapTimesToBeats([clip.start], beats, tolerance)[0];
          if (startSnap.snapped !== null && Math.abs(startSnap.delta) > minFrame && clip.start > 1e-6) {
            const delta = startSnap.snapped - clip.start;
            const prevEnd = prev ? prev.start + prev.duration : 0;
            if (startSnap.snapped >= prevEnd - 1e-6 && clip.duration - delta > 0.2) {
              const moved = overlay ? { ...clip, start: startSnap.snapped } : { ...clip, start: startSnap.snapped, in: Math.max(0, clip.in + delta * clip.speed), duration: clip.duration - delta };
              next = { ...next, clips: next.clips.map((c) => (c.id === clip.id ? moved : c)) };
              changes.push({ clipId: clip.id, name: clip.name ?? clip.id, edge: 'start', from: clip.start, to: startSnap.snapped });
              clip = moved;
            }
          }
          if (!overlay) {
            const end = clip.start + clip.duration;
            const endSnap = snapTimesToBeats([end], beats, tolerance)[0];
            if (endSnap.snapped !== null && Math.abs(endSnap.delta) > minFrame) {
              const nextStart = after ? after.start : Infinity;
              const newDuration = endSnap.snapped - clip.start;
              if (endSnap.snapped <= nextStart + 1e-6 && newDuration > 0.2) {
                next = { ...next, clips: next.clips.map((c) => (c.id === clip.id ? { ...c, duration: newDuration } : c)) };
                changes.push({ clipId: clip.id, name: clip.name ?? clip.id, edge: 'end', from: end, to: endSnap.snapped });
              }
            }
          }
        });
      }
      if (!changes.length) return done(`Every cut is already within ${Math.round(tolerance * 1000)} ms of a beat (${beats.length} beats).`, { changes: [], beats: beats.length });
      editComp(comp, () => next);
      return done(`${changes.length} edge(s) moved onto beats (±${Math.round(tolerance * 1000)} ms): ${changes.slice(0, 8).map((c) => `${c.name} ${c.edge} ${timecode(c.from, fps(comp))}→${timecode(c.to, fps(comp))}`).join('; ')}. Media clips were trimmed, overlays moved; gaps may have opened — check get_comp.`, { changes, beats: beats.length });
    }

    case 'level_audio': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const target = clamp(num(args, 'targetLufs') ?? -16, -30, -8);
      const bedDb = clamp(num(args, 'musicBedDb') ?? -20, -40, 0);
      const only = Array.isArray(args.clipIds) ? new Set((args.clipIds as unknown[]).filter((id): id is string => typeof id === 'string')) : null;
      const audioTracks = new Set(comp.tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
      const musicAsset = comp.production?.music?.assetId ?? null;
      const rows: { clipId: string; name: string; role: 'voice' | 'music' | 'sfx'; measured: number; targetLufs: number; gainDb: number; truePeakDb: number }[] = [];
      let next = comp;
      for (const clip of comp.clips) {
        if (!clip.enabled || !audioTracks.has(clip.trackId) || clip.source.type !== 'media') continue;
        if (only && !only.has(clip.id)) continue;
        const asset = assets.get(clip.source.assetId);
        if (!asset || !(asset.hasAudio || asset.kind === 'audio')) continue;
        const name = (clip.name ?? asset.name).toLowerCase();
        const role: 'voice' | 'music' | 'sfx' = clip.audioType === 'sfx' ? 'sfx' : clip.audioType === 'music' || asset.id === musicAsset || /music|bed|score|soundtrack/.test(name) ? 'music' : 'voice';
        if (role === 'sfx') continue;
        const from = Math.max(0, clip.in);
        const to = Math.min(asset.duration || from + clip.duration * clip.speed, from + Math.min(120, clip.duration * clip.speed));
        let measured: { integratedLufs: number; truePeakDb: number };
        try { measured = await api.audioLoudness(asset.id, from, to); } catch (error) { return fail(`Loudness of ${asset.name} could not be measured: ${errorText(error)}`); }
        if (measured.integratedLufs <= -69) continue;
        const wanted = role === 'music' ? target + bedDb : target;
        const gainDb = clamp(wanted - measured.integratedLufs, -30, 24);
        const volume = clamp(10 ** (gainDb / 20), 0, 8);
        next = { ...next, clips: next.clips.map((c) => (c.id === clip.id ? { ...c, volume, audioType: c.audioType ?? (role === 'music' ? 'music' : 'dialogue') } : c)) };
        rows.push({ clipId: clip.id, name: clip.name ?? asset.name, role, measured: Math.round(measured.integratedLufs * 10) / 10, targetLufs: wanted, gainDb: Math.round(gainDb * 10) / 10, truePeakDb: Math.round(measured.truePeakDb * 10) / 10 });
      }
      if (!rows.length) return fail('No dialogue or music clips with audio on the audio tracks to level.');
      editComp(comp, () => next);
      const hot = rows.filter((r) => r.truePeakDb + r.gainDb > -1);
      return done(`Levelled ${rows.length} clip(s): dialogue to ${target} LUFS, music bed ${bedDb} dB under it. ${rows.map((r) => `${r.name} (${r.role}) ${r.measured}→${r.targetLufs} LUFS, ${r.gainDb >= 0 ? '+' : ''}${r.gainDb} dB`).join('; ')}.${hot.length ? ` ${hot.length} clip(s) may now peak above −1 dBTP; keep them or lower gain slightly.` : ''} Next: score_audio_clip on the music with the speech ranges to duck it a further 3–5 dB under dense phrases.`, { rows });
    }

    case 'erase_subject_clip': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Supply the clipId of a rotoscoped video clip.');
      const { clip, comp } = found;
      if (!clip.rotoMatte) return fail('That clip has no subject matte yet: run rotoscope_clip on it first, then erase.');
      if (clip.source.type !== 'media') return fail('The clip is not a video.');
      const asset = assets.get(clip.source.assetId);
      if (!asset || asset.kind !== 'video') return fail('The clip is not a video.');
      const runId = clip.rotoMatte.replace(/[\\/]+matte\.[a-z0-9]+$/i, '').split(/[\\/]/).pop() ?? '';
      if (!runId) return fail('The matte path is not a Helios roto run.');
      const start = Math.max(0, clip.in);
      const end = start + clip.duration * clip.speed;
      const mode = str(args, 'mode') === 'per-frame' ? 'per-frame' : 'clean-plate';
      // One static plate cannot span two shots: a median across a cut blends both rooms.
      if (mode === 'clean-plate') {
        const cuts = await api.detectScenes(asset.id, start, end, 0.6).catch(() => [] as number[]);
        const inside = cuts.filter((t) => t > start + 0.15 && t < end - 0.15);
        if (inside.length) {
          const at = inside.map((t) => timecode(clip.start + (t - start) / clip.speed, fps(comp))).join(', ');
          return fail(`This clip crosses ${inside.length} scene cut${inside.length === 1 ? '' : 's'} (timeline ${at}); a single clean plate would blend the shots. Split the clip at the cut${inside.length === 1 ? '' : 's'} (split_clips), rotoscope and erase each shot separately, or pass mode "per-frame".`);
        }
      }
      let jobId: string;
      try {
        jobId = await api.eraseStart({ assetId: asset.id, runId, start, end, dilate: num(args, 'dilate'), mode, refine: bool(args, 'refine') });
      } catch (error) {
        return fail(errorText(error));
      }
      const deadline = Date.now() + 30 * 60 * 1000;
      let path: string | null = null;
      let cleanPlate: string | null = null;
      while (Date.now() < deadline) {
        if (signal?.aborted) return fail('The turn ended while the eraser was running; the job continues in the background — import it with import_generated_media.');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = (await api.jobsList()).find((j) => j.id === jobId);
        if (!job) continue;
        if (job.status === 'done') { const res = job.result as { path?: string; cleanPlate?: string } | null; path = res?.path ?? null; cleanPlate = res?.cleanPlate ?? null; break; }
        if (job.status === 'error' || job.status === 'cancelled') return fail(`Eraser failed: ${job.message || job.status}`);
      }
      if (!path) return fail('The eraser is still running after 30 minutes; import its result later with import_generated_media.');
      const imported = await host.importMedia([path], generatedFolderId(project, commit));
      const erased = imported[0];
      if (!erased) return fail('The erased plate was rendered but could not be imported.');
      let replaced: string | null = null;
      if (bool(args, 'replaceBackground') !== false && clip.groupId) {
        const live = host.history.current().comps.find((c) => c.id === comp.id);
        const background = live?.clips.find((c) => c.groupId === clip.groupId && c.id !== clip.id && (c.name ?? '').toLowerCase().includes('background') && c.source.type === 'media');
        if (background && live) {
          editComp(live, current => ({ ...current, clips: current.clips.map((c) => (c.id === background.id ? { ...c, source: { type: 'media', assetId: erased.id }, in: Math.max(0, c.in - start), name: 'Clean plate background', rotoMatte: null, rotoCorrections: [] } : c)) }));
          replaced = background.id;
        }
      }
      return done(`Subject erased from ${asset.name} (${mode}): clean plate ${erased.name} imported into Generated${replaced ? ' and swapped in as the "Original background" layer, so anything between the layers now sits truly behind the person' : '. Use add_media_behind_subject / add_text_behind_subject on the roto clip, then replace the "Original background" layer with this asset (update_clip source)'}. Check hair edges and shadows at 100%.`, { assetId: erased.id, assets: imported, path, cleanPlate, replacedBackgroundClipId: replaced, runId });
    }

    case 'reveal_subject': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found) return fail('Supply the clipId of the subject (rotoscoped) clip.');
      const { clip, comp } = found;
      const requested = str(args, 'style');
      if (requested !== 'wipe' && requested !== 'cubes') {
        // The reference reveal: cells cut from the subject's own matte, seeded at the face.
        if (!clip.rotoMatte) return fail(`Run rotoscope_clip on ${clip.id} first: the reveal is cut from the subject's matte.`);
        const at = num(args, 'at') ?? clip.start;
        const seconds = clamp(num(args, 'duration') ?? 2.4, 0.8, 12);
        return runMotionTool('create_motion_scene', {
          template: 'subject-reveal',
          start: at,
          duration: Math.min(seconds, Math.max(0.5, clip.start + clip.duration - at)),
          title: 'Subject reveal',
          compId: comp.id,
          params: { subject: { clipId: clip.id }, ...(Array.isArray(args.title) ? { title: args.title } : { title: [] }), ...(typeof args.phrase === 'string' ? { phrase: args.phrase } : { phrase: '' }), cardAt: null, duration: seconds },
        }, { project, assets, commit, editComp, pickComp, current: () => host.history.current(), setReference: host.setReference });
      }
      const style = requested === 'wipe' ? 'wipe' : 'cubes';
      const seconds = clamp(num(args, 'duration') ?? 1.2, 0.4, 3);
      const at = clamp((num(args, 'at') ?? clip.start) - clip.start, 0, Math.max(0, clip.duration - seconds));
      const opacity: Keyframe[] = [{ time: at, value: 0, easing: 'ease-out' }, { time: at + seconds * 0.6, value: clip.transform.opacity || 100, easing: 'hold' }];
      const scale: Keyframe[] = [{ time: at, value: clip.transform.scale * 1.04, easing: 'ease-out' }, { time: at + seconds, value: clip.transform.scale, easing: 'hold' }];
      editComp(comp, current => ({ ...current, clips: current.clips.map((c) => (c.id === clip.id ? { ...c, keyframes: { ...c.keyframes, opacity, scale: c.keyframes.scale.length ? c.keyframes.scale : scale } } : c)) }));
      let overlayId: string | null = null;
      if (style === 'cubes') {
        const live = host.history.current();
        const built = createMotionGraphicComp(live, { template: 'cubes-reveal', title: 'Reveal', duration: seconds + 0.2, start: clip.start + at, targetCompId: comp.id, asNestedComp: true, canvas: mogrtCanvas(comp) });
        commit(() => built.project);
        overlayId = built.newClipId;
      }
      return done(`${style} reveal on ${clip.name ?? clip.id} at ${timecode(clip.start + at, fps(comp))}: the subject fades and settles in over ${seconds}s${overlayId ? ' while a grid of tiles falls away top to bottom above it' : ''}. Both parts export (opacity/scale keyframes + rendered tiles).`, { clipId: clip.id, overlayClipId: overlayId, seconds });
    }

    case 'react_bits': {
      const id = str(args, 'id');
      const action = str(args, 'action') || (id ? 'describe' : 'list');
      if (action === 'describe') {
        const bit = findBit(id);
        if (!bit) return fail(`No React Bits piece called "${id ?? ''}". Browse with react_bits {"action":"list","category":"text"} or {"action":"search","query":"…"}.`);
        return done(`${bit.name} — ${bit.category}, ${bit.level}. ${bit.use}`, describeBit(bit));
      }
      const category = str(args, 'category');
      const level = str(args, 'level');
      const query = str(args, 'query');
      const source = str(args, 'source');
      const bits = listBits({ category, level, query, source });
      const counts = libraryCounts();
      return done(
        `${bits.length} piece${bits.length === 1 ? '' : 's'}${source ? ` from ${source}` : ''}${category ? ` in ${category}` : ''}${level ? ` (${level})` : ''}${query ? ` matching "${query}"` : ''}. Library: ${Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(', ')}.`,
        { bits, usage: 'react_bits {"action":"describe","id":"<id>"} for props and a ready-to-copy call; place with create_motion_graphic {"template":"react-bits","bit":"<id>","title":"…","props":{…}} or compose {"template":"react-bits","background":"aurora","layers":[{"bit":"split-text","props":{"text":"…"},"at":0.3}]}.' },
      );
    }

    case 'remotion_kit': {
      // Loaded on first use: the catalogue is ~0.5 MB of preset briefs.
      const kit = await import('./remotionKit');
      const id = str(args, 'id');
      const action = str(args, 'action') || (id ? 'describe' : 'list');
      if (action === 'describe') {
        const preset = kit.findPreset(id);
        if (!preset) return fail(`No Remotion Kit preset called "${id ?? ''}". Browse with remotion_kit {"action":"search","query":"…"} or {"action":"list","category":"intro"}.`);
        return done(`${preset.name} — ${preset.category}, ${preset.width}x${preset.height}, ${preset.seconds}s. ${preset.description}`, kit.describePreset(preset));
      }
      const category = str(args, 'category');
      const query = str(args, 'query');
      const orientation = str(args, 'orientation');
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(290, Math.round(args.limit))) : undefined;
      const presets = kit.listPresets({ category, query, orientation, limit }).map(kit.presetSummary);
      const counts = kit.remotionKitCounts();
      return done(
        `${presets.length} Remotion Kit preset${presets.length === 1 ? '' : 's'}${category ? ` in ${category}` : ''}${orientation ? ` (${orientation})` : ''}${query ? ` matching "${query}"` : ''}. Marketplace: ${Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(', ')}.`,
        { presets, usage: 'remotion_kit {"action":"describe","id":"<id>"} for the brief (copy, palette, fonts, timing) and a rebuild plan with a ready-to-adapt create_motion_graphic call.' },
      );
    }

    case 'create_motion_graphic': {
      const comp = pickComp(project, args);
      if (!comp) return fail('No composition found.');
      const template = str(args, 'template') || 'lower-third';
      const title = str(args, 'title') || 'HELIOS MOTION';
      const subtitle = str(args, 'subtitle') || '';
      // Crimson and React Bits keep their own accent when none is given; the legacy set falls back to sky in the builder.
      const accentColor = str(args, 'accentColor') || undefined;
      const bit = str(args, 'bit') || undefined;
      const props = record(args, 'props') ?? undefined;
      const theme = str(args, 'theme') || undefined;
      // The active brand kit colours React Bits pieces and Crimson templates unless the caller opts out.
      const brand = bool(args, 'useBrand') === false ? null : activeBrandKit(host, project);
      const backgroundArg = args.background;
      const background = typeof backgroundArg === 'string' && backgroundArg.trim() ? backgroundArg : backgroundArg && typeof backgroundArg === 'object' && !Array.isArray(backgroundArg) && typeof (backgroundArg as Args).bit === 'string' ? ({ bit: (backgroundArg as Args).bit as string, props: record(backgroundArg as Args, 'props') } as ReactBitsLayer) : undefined;
      const layers = Array.isArray(args.layers)
        ? (args.layers as unknown[]).filter((item): item is Args => !!item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Args).bit === 'string').map((item): ReactBitsLayer => ({
          bit: item.bit as string,
          props: record(item, 'props'),
          layout: MOGRT_LAYOUTS.has(String(item.layout)) ? (String(item.layout) as MogrtLayout) : undefined,
          at: num(item, 'at'),
          until: num(item, 'until'),
        }))
        : undefined;
      const metric = str(args, 'metric') || '+340%';
      const badge = str(args, 'badge') || '';
      const html = str(args, 'html') || undefined;
      const css = str(args, 'css') || undefined;
      const js = str(args, 'js') || undefined;
      const duration = num(args, 'duration');
      const start = num(args, 'start');
      const track = str(args, 'track');
      const asNestedComp = bool(args, 'asNestedComp') ?? true;
      const kicker = str(args, 'kicker') || undefined;
      const rows = Array.isArray(args.rows) ? (args.rows as unknown[]).filter((r): r is string => typeof r === 'string').slice(0, 6) : undefined;
      const values = Array.isArray(args.values) ? (args.values as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(0, 6) : undefined;
      const accentWord = str(args, 'accentWord') || undefined;
      const activeIndex = num(args, 'activeIndex');
      const layout = MOGRT_LAYOUTS.has(String(args.layout)) ? (String(args.layout) as MogrtLayout) : undefined;
      const cameraMove = (['none', 'push-in', 'travel'] as const).find((item) => item === str(args, 'cameraMove'));
      const reactBits = isReactBitsTemplate(template) && !templateSpec(template);
      if (template !== 'custom' && !templateSpec(template) && !reactBits && !['lower-third', 'kinetic-title', 'stat-callout', 'feature-badge', 'social-callout'].includes(template)) return fail(`Unknown template "${template}". Crimson templates:\n${templateCatalogue()}\nReact Bits: template "react-bits" with bit/props or layers — browse with react_bits {"action":"list"}.`);

      try {
        const result = createMotionGraphicComp(project, {
          template,
          title,
          subtitle,
          kicker,
          rows,
          values,
          accentWord,
          activeIndex,
          layout,
          cameraMove,
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
          bit,
          props,
          background,
          layers,
          theme,
          brand,
          targetCompId: comp.id,
          canvas: mogrtCanvas(comp),
        });

        host.history.commit(() => result.project, label);
        host.setSelection([result.newClipId]);

        const targetCompUpdated = result.project.comps.find((c) => c.id === result.targetCompId);
        const trackName = targetCompUpdated ? trackLabel(targetCompUpdated, result.trackId) : result.trackId;

        const spec = templateSpec(result.bundle.template);
        const hint = spec?.wantsSplit ? ` Reframe the footage beside it: layout_clip {"clipId": <footage>, "slot": "${(layout ?? 'side-panel-right') === 'side-panel-left' ? 'right-55' : 'left-55'}", "at": ${result.start}}.` : '';
        const what = reactBits ? `React Bits (${[background && (typeof background === 'string' ? background : background.bit), ...(layers?.map((l) => l.bit) ?? (bit ? [bit] : template !== 'react-bits' ? [template] : []))].filter(Boolean).join(' + ')})` : result.bundle.template;
        return done(
          `Created ${what} motion graphic "${title}" on ${trackName} at ${result.start}s (${result.duration}s)${asNestedComp ? ` inside comp "${result.mogrtComp?.name}"` : ''}. It animates in the preview and exports as rendered frames.${hint}`,
          {
            clipId: result.newClipId,
            compId: result.mogrtComp?.id,
            targetCompId: result.targetCompId,
            track: result.trackId,
            start: result.start,
            duration: result.duration,
            template: result.bundle.template,
            title: result.bundle.title,
            layout: result.bundle.layout ?? layout ?? null,
            box: result.bundle.box ?? null,
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
