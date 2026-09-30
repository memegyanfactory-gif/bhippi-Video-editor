import type { PermissionMode } from './permissions';
import { clipsNearScope, type QuickScope } from './quickScope';
import { makeStickFigure } from './stickFigure';
import { describeUncovered, newlyUncovered, uncoveredSpans } from './coverage';
import { fillBackground } from './fillBackground';
import { binIds, describeMoved, organizeBin } from './binOrganize';
import { textBehindSubject, mediaBehindSubject } from './behindSubject';
import { depthOcclusion } from './depth';
import { scoreEnvelope, type AudioEnvelope } from './audioEnvelope';
import { rotoscope, rotoscopeLong, type LongRotoResult } from './roto';
import { validateRotoResult } from './rotoValidation';
import { generateSelectionSound } from './generateSound';
import { AVAILABLE_EFFECTS } from './effectsCatalog';
import { createAppliedEffect, getEffectSchema } from './effectFilters';
import { applyPodcastCut, planShots, speakerTurns, type CastEntry, type PersonTrack } from './reframe';
import { summarizePersonTracks, trackPeopleAsset } from './personTracks';import { normalizeEffectClip } from './effectState';
import { adaptRhythmProgram } from './learning';
import { storyboardContentError, videoBlueprintContentError, type StoryboardSceneInput, type VideoBlueprintSceneInput } from './editWorkflow';
import { createMotionGraphicComp, mogrtCanvas } from './motionGraphics';
import { CRIMSON_GUIDELINE_NOTES, CRIMSON_PALETTE, CRIMSON_TEMPLATES, templateCatalogue, templateSpec, type MogrtLayout } from './motionGuide';
import { CRIMSON_SLOTS, describeSlots, missingSlots, resolveTemplateId } from './templateSlots';
import { fitScales, fixSummary, fixTemplateArgs, listOf } from './templateFix';
import { graphicCall } from './addGraphic';
import { checkGraphic, issuesText, refit } from './graphicCheckRun';
import { describeBit, findBit, isReactBitsTemplate, libraryCounts, listBits, type ReactBitsLayer } from './rbx';
import { BRAND_KIT_TOOLS, activeBrandKit, runBrandKitTool } from './brandKitTools';
import { brandKitTheme, brandedPrompt, motionBrandFromKit } from './brandKit';
import { advance, attachAsset, frameQa, gatherReport, newProduction, planScenes, qaTimes, type QaIssue } from './production';
import { detectBeats, musicStructure, snapCutsToBeats } from './beats';
import { buildSongMap, songMapMarkdown, type HeardWord } from './songMap';
import { loadPeaks } from './peaks';
import { bhippiAnswers, captureKey, parseSteps, resolveSelector, sheetParts, standinSource } from './appCapture';
import { cutTimes, darkFinding, eventMoments, JOIN_STEP, joinStrips, mixFindings, offBeatCuts, quietCues, repeatedPhrases, shortEnd, timelineOf, type CueLevel, type Finding, type Moment } from './reviewFrames';
import { builtInLoudestDb, isMusicClip, loudestDb, musicDbOver, type MusicBed } from './cueSound';
import { animated } from './keyframes';
import { queryFrameAtlas, buildWanCinematicPrompt, FRAME_ATLAS_TAXONOMY } from './frameAtlas';
import { COUNCIL, councilMember, councilReview, describeReview, isCouncilRole, rightsOf, withProvenance, type CouncilNote, type CouncilRole, type Provenance } from './council';
// Runs Bhippi AI's tool calls against the live project. Every tool is one undo step labelled
// "AI: …", so a turn can be stepped back or reverted whole. The catalogue the models see is
// src/lib/ai-tools.json; this file is the other half of that contract.
import catalog from './ai-tools.json';
import { repairArgs } from './argRepair';
import { inferGenres, judge, JUDGE_ROUNDS, PASS_MARK } from './judge';
import { ANGLES, debate, parseProposal } from './director';
import { GENRE_TOOLS, PLAYBOOK_FOR, routeTools, type Genre } from './toolRouter';
import { MOTION_TOOLS, runMotionTool } from './motionTools';
import { ROAST_TOOLS, memeLookup, primeMemeCache, runRoastTool } from './roast/tools';
import { isRoastCardTemplate } from './roast/cards';
import { CARD_TEMPLATES } from './roast/types';
import { MOTION_TEMPLATES, findTemplate } from '../motion/kit';
import { SFX_GAIN_DB, sfxClipFields, sfxTrack } from './sfxLevels';
import { blankFinding, boxContrast, collectQaLayers, contactSheet, frameStats, MIN_TEXT_CONTRAST } from './polish';
import { renderMotionStill } from '../motion/exportFrames';
import { renderHtmlStill } from './htmlFrames';
import { clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, gainToDb, isHexColor, placement, presetLabel, STILL_DEFAULT, timecode, uid } from './editor';
import { safeFor } from './layout';
import { aspectLabel, describeReformat, duplicateComp, FRAME_PRESETS, orientationOf, reformatComp, RESOLUTION_TIERS, scaleTo, type ReformatMode } from './reformat';
import { autoLayout, captionBand, fillCell, pipBox, splitCells, type SplitLayout } from './splitScreen';
import type { History } from './history';
import { api, errorText, type ComposedScore, type PlateSpec, type ScoreMood, type ScoreSpec, type Transcript } from './ipc';
import { BEAT_KINDS, planBuild, SCORE_MOODS, type BriefBeat } from './guidedBuild';
import { bpmFromText, moodFromText, placeMusicBed, placePlate } from './builtinMedia';
import { cloudPrefs, genApi, pickModel, usableConnectors, type GenPlan, type GenPlanItem } from './cloudGen';
import { describe as describeDiff, runProgram, type Op, type Program } from './editProgram';
import { buildRecipe, findRecipe, recipeCatalogue, registerCustomRecipe, setCustomRecipes } from './recipes';
import {
  loadCustomTools, saveCustomTools, createCustomTool, updateCustomTool,
  substituteTemplate, customToolToRecipe, recordToolUsage, customToolKind, substituteStepArgs, setCustomToolEnv,
  type CustomTool, type CustomToolParam, type ToolStep,
} from './customTools';
import { EASINGS, EFFECT_KEYED, EMPTY_KEYFRAMES } from './keyframes';
import { playhead } from './playhead';
import {
  addFrameHold, addTracks, addTransition, audible, clipEnd, clipName, clipsForSource, compDuration, COMP_PRESETS, COMP_SIZE_OPTIONS, deleteBinEntries, frameSizeFromText, deleteTracks, emptyTracks, freeTrack, insertFrameHold, ITEM_LABEL, moveClips,
  newClip, newComp, newItem, nestClips, placeClips, razor, removeClips, removeRange, resolveTrack, setGrouped, setLinked, setSpeed, sourceInfo, sourceLimit, sourceOut, sourceTimeAt, textSource,
  tracksOf, trackLabel, transitionWindow, trimEdge, updateComp, updateTrack, usage, wouldCycle, type AssetMap,
} from './timeline';
import { findStyle } from './captionStyles';
import { learnedValue } from './brandKit/learnings';
import { parseRbStyle } from './reactbits';
import { SFX_KINDS } from './types';
import type { Asset, Clip, ClipSource, Comp, Easing, EffectKeyProperty, Effects, ItemKind, Keyframe, KeyframedProperty, Mask, Production, ProductionBeat, ProductionShot, Project, ProjectItem, Settings, Track, TrackKind, Transform, TransitionKind, ToolResult, VideoBlueprint, VideoBlueprintAsset, VideoBlueprintScene } from './types';
import { playbook } from './motionDirection';
import { PLUGIN_TOOLS, runPluginAiTool } from '../plugins/aiTools';
import { findGenerator, findPlugin, pluginStore } from '../plugins/store';
import { COLOR_TOOLS, LUT_REFUSAL, runColorTool } from './colorTools';
import { asksForLut, turnPrompt } from './turnPrompts';
import { GENERIC_TARGET, pacingReport } from './pacing';
import { buildShortComp, MAX_SHORTS, normalizeSegments, orientationFromAnswer, orientationStated, SHORT_FORMAT_OPTIONS, SHORT_FRAMES, type ShortOrientation, type ShortSpec } from './shorts';
import { detectFaces } from './roast/alpha';

/** Tells the model a file search stopped at its budget, so "0 found" is not "not there". */
const truncatedNote = (truncated: boolean | undefined) =>
  truncated ? ' The search stopped early (too many files) — narrow the base path and search again.' : '';

/** How much of a command's stdout (and of its stderr) a result carries: the last 12 KB. */
const OUTPUT_TAIL_BYTES = 12 * 1024;

/** The last 12 KB of a command's output, and how many bytes were cut from its head. */
function outputTail(text: string): { text: string; cut: number } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= OUTPUT_TAIL_BYTES) return { text, cut: 0 };
  // A cut through a multi-byte character decodes as U+FFFD; drop it rather than show it.
  return { text: new TextDecoder().decode(bytes.subarray(bytes.length - OUTPUT_TAIL_BYTES)).replace(/^�+/, ''), cut: bytes.length - OUTPUT_TAIL_BYTES };
}

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
  /** Puts a question to the editor and waits for the answer; the card goes away if `signal` aborts. */
  /** `turnId`: the turn asking, so the host can show the question in that turn's own chat. */
  ask: (question: { question: string; options: string[]; context: string | null }, signal?: AbortSignal, turnId?: string) => Promise<string>;
  /** The assistant's permission mode; Full access answers its own questions. */
  permission?: () => PermissionMode;
  /** Sets the active project reference guideline. */
  setReference?: (id: string | null) => void;
  /** The current app settings (brand kits live there) and how to persist a change to them. */
  settings?: () => Settings;
  saveSettings?: (next: Settings) => Promise<Settings>;
  turnId?: string;
  /**
   * A plugin test's scratch host (testRunner.ts): tools make no new transcriptions, track nothing
   * heavy and ask nothing, so a test is quick and free and still exercises the tool.
   */
  testing?: boolean;
  /**
   * The checks a direct call from the model goes through before it runs — the user's permission
   * mode and the edit workflow's phase gate — returning why a call is refused, or null. A steps
   * tool runs each step through this, so saving calls in a tool never gets around them.
   */
  guard?: (name: string, args: Record<string, unknown>) => string | null;
  /** Tells the edit workflow a call ran, as it is told about direct calls. */
  record?: (name: string, args: Record<string, unknown>, result: ToolResult) => void;
  /**
   * Shows the cloud generation plan card and waits for the editor: the plan they approved
   * (possibly edited, items skipped), or null when they cancel or the turn ends.
   */
  approveGeneration?: (plan: GenPlan, signal?: AbortSignal) => Promise<GenPlan | null>;
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

/**
 * The screen the user picked for this turn's shorts (choose_shorts_format), so create_shorts never
 * asks twice. Keyed by turn; a few recent turns are kept.
 */
const shortsFormats = new Map<string, ShortOrientation>();

/**
 * Asks portrait or landscape. Always a real question — even in Full access, because it is the
 * user's call which screen their shorts are for — unless the request already said which.
 */
async function askShortsFormat(host: ToolHost, args: Args, turnId: string | undefined, signal?: AbortSignal): Promise<ShortOrientation | null> {
  // Asked once per AI turn. A call from a plugin has no turn, so nothing is remembered for it:
  // each call says its orientation (or asks).
  const key = turnId ?? host.turnId ?? '';
  const stated = typeof args.orientation === 'string' ? orientationFromAnswer(args.orientation) : null;
  if (stated) {
    if (key) shortsFormats.set(key, stated);
    return stated;
  }
  const known = key ? shortsFormats.get(key) : undefined;
  if (known) return known;
  const fromPrompt = orientationStated(turnPrompt(turnId ?? host.turnId));
  let chosen = fromPrompt;
  if (!chosen) {
    const answer = await host.ask({
      question: 'Which screen should the shorts be made for?',
      options: SHORT_FORMAT_OPTIONS,
      context: 'Every short is cut, reframed and animated for this frame shape.',
    }, signal, turnId ?? host.turnId);
    chosen = orientationFromAnswer(answer);
  }
  if (chosen && key) {
    shortsFormats.set(key, chosen);
    while (shortsFormats.size > 16) shortsFormats.delete(shortsFormats.keys().next().value!);
  }
  return chosen;
}

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });

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
const numbers = (args: Args, key: string): number[] => (Array.isArray(args[key]) ? (args[key] as unknown[]).filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []);
/**
 * The answers an ask_user offers, however the model sent them: an array of strings or of
 * `{label}` objects, a JSON array in a string, or one string with an answer per line (or split by
 * `|`, `;` or commas). Bullets and numbering are dropped; at most six, no repeats.
 */
export function askOptions(value: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        // Not JSON after all; split it as text below.
      }
    }
    if (!items.length && text) {
      const lines = text.split(/\r?\n/);
      const split = lines.length > 1 ? lines : text.split(/\s*[|;]\s*/);
      const commas = text.split(/\s*,\s*/);
      items = split.length > 1 ? split : commas.length > 1 && commas.length <= 6 && commas.every((part) => part.length <= 40) ? commas : [text];
    }
  }
  const labels = items.map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (item && typeof item === 'object') {
      const found = ['label', 'text', 'value', 'title', 'option', 'answer'].map((key) => (item as Args)[key]).find((field) => typeof field === 'string' || typeof field === 'number');
      return found === undefined ? '' : String(found);
    }
    return '';
  });
  const clean = labels.map((label) => label.replace(/^\s*(?:[-*•]|\d+[.)]|[a-f][.)])\s+/i, '').trim()).filter(Boolean);
  return [...new Set(clean)].slice(0, 6);
}

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
  if (source.type === 'html') Object.assign(summary, source.plugin ? { pluginClip: { plugin: source.plugin.id, generator: source.plugin.generator, params: source.plugin.params }, title: source.title } : { html: true, title: source.title, hasGsap: !!source.js });
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
export function compDetail(project: Project, assets: AssetMap, comp: Comp, plan = false, only?: ReadonlySet<string>) {
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
    clips: [...comp.clips].filter((clip) => !only || only.has(clip.id)).sort((a, b) => a.start - b.start).map((clip) => clipSummary(project, assets, comp, clip)),
    ...(only ? { clipsShown: `${comp.clips.filter((clip) => only.has(clip.id)).length} of ${comp.clips.length}: the Quick edit's scope and what sits beside it. get_comp reads the rest.` } : {}),
    transitions: comp.transitions.map((transition) => {
      const window = transitionWindow(comp, transition);
      return { id: transition.id, kind: transition.kind, track: trackLabel(comp, transition.trackId), at: window ? round(window.at) : null, duration: round(transition.duration), alignment: transition.alignment, fromClip: transition.fromClip, toClip: transition.toClip };
    }),
    markers: comp.markers.map((marker) => ({ id: marker.id, time: round(marker.time), name: marker.name || undefined })),
    // The plan in full is often most of a comp (and cards may carry image data); every read
    // re-sent it. By default each beat is one line; `plan: true` returns it whole, minus images.
    storyboard: plan ? (comp.storyboard ?? []).map((card) => ({ ...card, thumbnail: undefined, sketch: undefined })) : storyboardDigest(comp),
    blueprint: plan || !comp.videoBlueprint ? comp.videoBlueprint ?? null : blueprintDigest(comp.videoBlueprint),
  };
}

const clip = (text: string | undefined, max: number) => (!text ? undefined : text.length > max ? `${text.slice(0, max - 1)}…` : text);

function storyboardDigest(comp: Comp) {
  return (comp.storyboard ?? []).map((card) => ({ start: round(card.start), end: round(card.end), intent: clip(card.intent, 90), visual: clip(card.visual, 140) }));
}

function blueprintDigest(blueprint: NonNullable<Comp['videoBlueprint']>) {
  return {
    title: blueprint.title,
    status: blueprint.status,
    scenes: blueprint.scenes.length,
    assets: blueprint.assets.length,
    note: 'get_comp {"plan":true} returns the storyboard and blueprint in full.',
  };
}

/** The project overview `get_project` answers with, and the context each chat turn carries. */
export function aiContext(project: Project, assets: AssetMap, selection: string[]) {
  const counts = usage(project);
  const active = project.comps.find((comp) => comp.id === project.activeCompId) ?? project.comps[0];
  return {
    project: { name: project.name, captionStyle: project.captionStyle, captionLook: project.captionLook === 'fiwn' ? 'watchfiwn (FIWN renderer: real fonts, animations, dynamic layouts)' : 'classic', activeCompId: active?.id ?? null },
    playhead: round(playhead.get()),
    selectedClipIds: selection,
    comps: project.comps.map((comp) => ({
      id: comp.id,
      name: comp.name,
      size: `${comp.width}x${comp.height}`,
      aspect: aspectLabel(comp.width, comp.height),
      orientation: orientationOf(comp.width, comp.height),
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
    frame: active ? frameBrief(active) : null,
    layoutRules: LAYOUT_RULES,
  };
}

/**
 * The project summary for a Quick edit: what the change needs, not what a production plans with.
 * The storyboard and blueprint digests stay out; with a scope (clips or annotations the user
 * pointed at) only the scope's clips and their neighbours are listed, with the media they use.
 */
export function quickContext(project: Project, assets: AssetMap, selection: string[], scope: QuickScope | null) {
  const full = aiContext(project, assets, selection);
  const active = project.comps.find((comp) => comp.id === (scope?.compId ?? project.activeCompId)) ?? project.comps[0];
  if (!active) return full;
  const only = scope ? clipsNearScope(active, scope) : undefined;
  const detail = { ...compDetail(project, assets, active, false, only), storyboard: undefined, blueprint: undefined };
  if (!only) return { ...full, activeComp: detail };
  const used = new Set(active.clips.filter((clip) => only.has(clip.id)).flatMap((clip) => (clip.source.type === 'media' ? [clip.source.assetId] : clip.source.type === 'item' ? [clip.source.itemId] : clip.source.type === 'comp' ? [clip.source.compId] : [])));
  return {
    ...full,
    comps: full.comps.filter((comp) => comp.id === active.id || used.has(comp.id)),
    media: full.media.filter((media) => used.has(media.id)),
    items: full.items.filter((item) => used.has(item.id)),
    folders: [],
    activeComp: detail,
    quickScope: scope,
  };
}

/** The active comp's frame in plain words: its shape, its safe area and what layouts suit it. */
export function frameBrief(comp: Comp) {
  const orientation = orientationOf(comp.width, comp.height);
  const safe = safeFor(comp.width, comp.height);
  const aspect = aspectLabel(comp.width, comp.height);
  const tall = comp.height / Math.max(1, comp.width) >= 1.6;
  const guidance = orientation === 'landscape'
    ? 'Wide frame: split screens sit side by side (split_screen side-by-side, 50/50 or 60/40), a 2x2 grid for four, a PiP facecam about 28% wide bottom-right; titles and side panels use the left/right thirds; captions in the lower band.'
    : tall
      ? 'Tall 9:16 frame for Reels/TikTok/Shorts: everything stacks. Split screens are top/bottom (split_screen stack: 50/50 for two people, ratio 0.4 for facecam over gameplay or B-roll), three-up for panels. Captions sit on the seam of a stack or at 60-75% of the height, 1-2 lines, at most about 81% of the width. Nothing important in the right 13% (the like/comment/share rail) or the bottom 20% (caption, handle, audio). Wide 16:9 footage either fills (crop to the speaker, focus on the face), fits over a blurred copy, or fits as a band with the space above and below used for a hook title and captions.'
      : `${aspect} feed frame: stack two pictures top/bottom or use a 2x2 grid; keep text 6% from every edge (the Instagram grid trims the sides of a 4:5).`;
  return {
    size: `${comp.width}x${comp.height}`,
    aspect,
    orientation,
    safeArea: { left: safe.left, top: safe.top, right: safe.right, bottom: safe.bottom },
    guidance,
  };
}

/** What every turn is reminded of about the frame: it is read each turn with the project. */
const LAYOUT_RULES = [
  'Motion scenes open as layered "[Motion]" comps: one clip per layer on its own track, so the user can open one and change any layer. Edit them with update_motion_scene (clipId = the comp clip, the comp or a layer clip; patches by layer id); split_motion_layers opens older single-clip ones.',
  'Know the frame before designing: `frame` gives the active comp size, aspect, orientation, safe area and the layouts that suit it. Design for that shape: a 9:16 comp is not a squeezed 16:9 one. To change the shape use update_comp {format | orientation | resolution, reframe: fill | blur | fit | keep}; it re-fits the footage and rebuilds the motion graphics for the new canvas. When the user wants a NEW comp in another shape for an edit already made ("make a portrait version", "new comp in 9:16 and adjust everything"), use create_comp {fromCompId, format | orientation, reframe}: it copies every clip, graphic, shape, caption and sound into the new comp and refits them, leaving the original as it was; never rebuild it by hand in an empty comp. For two or more pictures at once use split_screen (stacked in tall frames, side by side in wide ones).',
  'Everything rests inside the frame: panels, cards, type and reduced footage sit inside the safe area (16:9: 5% sides, 6% top/bottom; 9:16: 6% left, 13% right, 12% top, 20% bottom; 4:5, 3:4 and 1:1: 6% all round), never against or past an edge. layout_clip slots, split_screen and fitted motion scenes already do; a hand-set x/y/scale must too.',
  'No blank frames: when the project has a designed background plate (a generated gradient on V1), full-frame templates go over it with background "none" — a light brand stage covering it reads as a white screen. Reduced footage always has a designed background behind it, never flat white or black.',
  'Finish every edit with the polish pass: run_frame_qa over the range (it renders real frames with the motion graphics and reports off-frame, safe-area, blank-frame, black-edge and overlap problems), fix each at its source, run it again until clear.',
].join(' ');

// ───────────────────────────── helpers ─────────────────────────────

/**
 * The frame size `format` / `orientation` / `resolution` ask for, from `base` (the comp's current
 * size or a preset): a format id picks a shape, orientation turns the current shape (16:9 and 9:16
 * swap) or picks the standard one, resolution sets the short side.
 */
function frameFromArgs(args: Args, base: { width: number; height: number }): { width: number; height: number } {
  let shape = { width: base.width, height: base.height };
  const format = FRAME_PRESETS.find((preset) => preset.id === str(args, 'format'));
  if (format) shape = { width: format.width, height: format.height };
  const orientation = str(args, 'orientation');
  if (orientation && !format) {
    const current = orientationOf(shape.width, shape.height);
    const side = Math.min(shape.width, shape.height);
    if (orientation === 'square') shape = { width: side, height: side };
    else if (current === 'square') shape = orientation === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    else if (current !== orientation) shape = { width: shape.height, height: shape.width };
  }
  const short = num(args, 'resolution');
  if (short && RESOLUTION_TIERS.some((tier) => tier.short === short)) shape = scaleTo(shape, short);
  return shape;
}

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
 * layout_clip's slots in a tall comp, worked out from the picture's own aspect through the
 * editor's placement so each box lands inside the frame's safe area (9:16: 6% left, 13% right, 12% top, 20%
 * bottom). A tall frame stacks rather than sits side by side: left-55/right-55 are top-55/bottom-55.
 */
function portraitSlots(clip: Clip, comp: Comp, assets: AssetMap): Record<string, { scale: number; x: number; y: number }> {
  const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
  const [w, h] = asset && asset.width > 0 && asset.height > 0 ? [asset.width, asset.height] : [comp.width, comp.height];
  // The visible picture at scale 100, as fractions of the comp (crop and fit as the clip has them).
  const base = placement({ ...clip.transform, x: 0, y: 0, scale: 100 }, w, h, comp.width, comp.height);
  const bw = (base.width * (1 - (clip.transform.cropLeft + clip.transform.cropRight) / 100)) / comp.width;
  const bh = (base.height * (1 - (clip.transform.cropTop + clip.transform.cropBottom) / 100)) / comp.height;
  const margins = safeFor(comp.width, comp.height);
  const safe = { left: margins.left, top: margins.top, right: 1 - margins.right, bottom: 1 - margins.bottom };
  const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
  /** The largest picture inside the region, pushed to its `ax`/`ay` side (0 start, 0.5 centre, 1 end). */
  const fit = (x: number, y: number, width: number, height: number, ax = 0.5, ay = 0.5) => {
    const k = Math.min(width / bw, height / bh);
    const cx = x + (width - bw * k) * ax + (bw * k) / 2;
    const cy = y + (height - bh * k) * ay + (bh * k) / 2;
    return { scale: round(100 * k * 0.999, 2), x: round(cx - 0.5, 4), y: round(cy - 0.5, 4) };
  };
  const sw = safe.right - safe.left;
  const half = (safe.bottom - safe.top) * 0.55;
  const pip = { width: 0.42, height: 0.3 };
  const top = fit(safe.left, safe.top, sw, half);
  const bottom = fit(safe.left, safe.bottom - half, sw, half);
  return {
    'top-55': top, 'bottom-55': bottom, 'left-55': top, 'right-55': bottom,
    'pip-top-left': fit(safe.left, safe.top, pip.width, pip.height, 0, 0),
    'pip-top-right': fit(safe.right - pip.width, safe.top, pip.width, pip.height, 1, 0),
    'pip-bottom-left': fit(safe.left, safe.bottom - pip.height, pip.width, pip.height, 0, 1),
    'pip-bottom-right': fit(safe.right - pip.width, safe.bottom - pip.height, pip.width, pip.height, 1, 1),
    'centre-small': fit(safe.left + sw * 0.14, safe.top + (safe.bottom - safe.top) * 0.14, sw * 0.72, (safe.bottom - safe.top) * 0.72),
    // Full frame covers the frame edge to edge, so no bands show above and below a wide shot.
    full: { scale: round(100 * Math.max(1 / bw, 1 / bh), 2), x: 0, y: 0 },
  };
}

/**
 * The root "Generated" folder AI-made media files into, so generations never
 * scatter across the project root. Idempotent: returns the existing one when
 * the user (or an earlier turn) already made it.
 */
export function generatedFolderId(project: Project, commit: (change: (current: Project) => Project) => void): string {
  return rootFolderId(project, commit, 'Generated');
}

/** A root Project panel folder by name, made when missing. Idempotent like `generatedFolderId`. */
export function rootFolderId(project: Project, commit: (change: (current: Project) => Project) => void, name: string): string {
  const existing = project.folders.find((folder) => folder.name === name && !folder.parentId);
  if (existing) return existing.id;
  const id = uid();
  commit((current) => (current.folders.some((folder) => folder.id === id || (folder.name === name && !folder.parentId))
    ? current
    : { ...current, folders: [...current.folders, { id, name, parentId: null }] }));
  return project.folders.find((folder) => folder.name === name && !folder.parentId)?.id ?? id;
}

type Commit = (change: (current: Project) => Project) => void;

/** Composes a score (src-tauri/src/score.rs) and imports it into Generated. */
async function composeMusicAsset(host: ToolHost, project: Project, commit: Commit, spec: ScoreSpec, name: string): Promise<{ asset: Asset; score: ComposedScore }> {
  const score = await api.composeScore(spec, name);
  const [asset] = await host.importMedia([score.path], generatedFolderId(project, commit));
  if (!asset) throw new Error('the score was written but could not be imported');
  return { asset, score };
}

/** Renders a background plate (src-tauri/src/plates.rs) and imports it into Generated. */
async function plateAsset(host: ToolHost, project: Project, commit: Commit, spec: PlateSpec, name: string): Promise<Asset> {
  const path = await api.renderPlate(spec, name);
  const [asset] = await host.importMedia([path], generatedFolderId(project, commit));
  if (!asset) throw new Error('the plate was rendered but could not be imported');
  return asset;
}

/**
 * Fills what gathering left empty with Bhippi's own media, so no plan goes into editing with
 * nothing: missing music gets a score composed from the plan's music prompt, and every missing
 * picture shot shares one designed plate. Voice-overs and downloads that need real content are
 * left for the model. Answers what was filled.
 */
async function fillMissingWithBuiltins(host: ToolHost, project: Project, commit: Commit, comp: Comp): Promise<string[]> {
  const production = comp.production;
  if (!production) return [];
  const filled: string[] = [];
  const scenes = planScenes(comp);
  const length = Math.max(production.brief?.targetSeconds ?? 0, ...scenes.map((scene) => (scene as { end?: number }).end ?? 0)) || 30;
  const prompt = [production.music?.prompt, production.script, production.brief?.goal].filter(Boolean).join(' ');
  const mood = moodFromText(production.music?.prompt) ?? moodFromText(prompt) ?? 'energetic';
  const editLive = (change: (current: Comp) => Comp) => commit((current) => updateComp(current, comp.id, change));
  if (production.music && production.music.source !== 'none' && production.music.source !== 'existing' && !production.music.assetId) {
    try {
      const { asset, score } = await composeMusicAsset(host, project, commit, { duration: clamp(length + 1, 4, 600), bpm: bpmFromText(production.music.prompt) ?? planBuild([], { mood }).bpm, mood }, `${comp.name} score`);
      editLive((current) => (current.production ? { ...current, production: { ...current.production, music: { ...(current.production.music ?? { source: 'generate' as const }), assetId: asset.id, status: 'ready' as const, bpm: score.bpm, beats: score.beats }, updatedAt: Date.now() } } : current));
      filled.push(`music — a composed ${score.arrangement} (“${asset.name}”)`);
    } catch (error) {
      filled.push(`music could not be composed (${errorText(error)})`);
    }
  }
  const missingPictures: { scene: number; shot: number | null }[] = [];
  scenes.forEach((scene, i) => {
    const shots = scene.shots ?? [];
    const legacy = scene as { mediaSource?: string; assetId?: string };
    if (!shots.length && legacy.mediaSource && legacy.mediaSource !== 'existing' && !legacy.assetId) missingPictures.push({ scene: i, shot: null });
    shots.forEach((shot, j) => { if (!shot.assetId && (shot.kind === 'video' || shot.kind === 'image' || shot.kind === 'download' || shot.kind === 'scrape')) missingPictures.push({ scene: i, shot: j }); });
  });
  if (missingPictures.length) {
    try {
      const kit = activeBrandKit(host, project);
      const style: PlateSpec['style'] = mood === 'playful' ? 'paper' : mood === 'chill' || mood === 'corporate' ? 'gradient' : mood === 'dark' ? 'grain' : 'glow';
      const asset = await plateAsset(host, project, commit, { style, width: comp.width, height: comp.height, seconds: clamp(length + 1, 2, 120), fps: Math.round(Math.min(60, comp.fps)), colors: kit ? motionBrandFromKit(kit).gradient : [] }, `${comp.name} ${style}`);
      for (const missing of missingPictures) {
        editLive((current) => attachAsset(current, { sceneIndex: missing.scene, shotIndex: missing.shot }, asset.id)?.comp ?? current);
      }
      filled.push(`${missingPictures.length} picture shot${missingPictures.length === 1 ? '' : 's'} — a designed ${style} background plate (“${asset.name}”) to build the graphics on`);
    } catch (error) {
      filled.push(`pictures could not be rendered (${errorText(error)})`);
    }
  }
  return filled;
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
    // A beat's graphic is a Crimson HTML template (create_motion_graphic) or a brand-*/engine
    // template (create_motion_scene).
    if (!templateSpec(template) && !findTemplate(template) && !['lower-third', 'kinetic-title', 'stat-callout', 'feature-badge', 'social-callout', 'custom'].includes(template)) problems.push(`Scene ${n}: mogrt.template "${template}" is not a template; choose a brand-*/engine template (create_motion_scene): ${MOTION_TEMPLATES.map((spec) => spec.id).join(', ')}; or a Crimson HTML template (create_motion_graphic): ${templateCatalogue().split('\n').map((line) => line.slice(2).split(' ')[0]).join(', ')}.`);
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
const MEDIA_TOOLS = new Set(['generate_cloud_media', 'generate_local_media', 'import_generated_media', 'download_online_media', 'scrape_videos', 'find_free_media', 'synthesize_speech_voiceover', 'erase_subject_clip', 'get_meme_media', 'cutout_image']);

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
  const kind = name === 'synthesize_speech_voiceover' ? 'voiceover' : name === 'erase_subject_clip' ? 'video' : name === 'find_free_media' || name === 'get_meme_media' ? 'download' : name === 'cutout_image' ? 'image' : typeof args.kind === 'string' ? args.kind : args.task === 'audio' ? 'music' : args.task === 'image' ? 'image' : args.task === 'video' ? 'video' : name === 'download_online_media' || name === 'scrape_videos' ? 'download' : null;
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

/** Every tool name Bhippi executes: what a steps tool may call. */
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

/**
 * A transcript as the model reads it: every word's start time in one line ("0.00 Hi. 0.56 I'm …",
 * a "[S1]" marker where the speaker changes) instead of an object per word — the same timings at
 * about a sixth of the tokens, which a model otherwise re-reads every round.
 */
export function transcriptForModel(transcript: Transcript) {
  const speakers = transcript.diarized && new Set(transcript.words.map((w) => w.speaker ?? 0)).size > 1;
  let speaker: number | undefined;
  const parts: string[] = [];
  for (const word of transcript.words) {
    if (speakers && word.speaker !== speaker) { speaker = word.speaker; parts.push(`[S${(speaker ?? 0) + 1}]`); }
    parts.push(`${word.start.toFixed(2)} ${word.text}`);
  }
  const last = transcript.words[transcript.words.length - 1];
  return { assetId: transcript.assetId, provider: transcript.provider, language: transcript.language, words: transcript.words.length, timed: parts.join(' '), end: last ? Math.round(last.end * 100) / 100 : 0, text: transcript.text, diarized: transcript.diarized };
}

export async function runTool(host: ToolHost, name: string, sentArgs: unknown, signal?: AbortSignal, turnId?: string): Promise<ToolResult> {
  // Quoted numbers, stringified arrays and the like are mended against the schema first.
  const rawArgs = repairArgs(name, sentArgs);
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

  // A tool from an MCP server Bhippi is connected to: hand it straight back to that server.
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
    const kitForMotion = activeBrandKit(host, project);
    return runMotionTool(name, args, { project, assets, commit, editComp, pickComp, current: () => host.history.current(), setReference: host.setReference, brand: kitForMotion ? motionBrandFromKit(kitForMotion) : null, signal, prompt: turnPrompt(turnId ?? host.turnId) });
  }

  // @funny: memes, receipts, sounds, cutouts and the roast plan (src/lib/roast).
  if (ROAST_TOOLS.has(name)) {
    return runRoastTool(name, args, {
      project, assets, commit, editComp, pickComp, current: () => host.history.current(), signal,
      importFiles: (paths, folder) => host.importMedia(paths, folder ? findOrCreateFolder(host.history.current(), commit, folder) : null),
    });
  }

  // Plugins: the Plugin Maker's tools (src/plugins). They change the plugin library, never the project.
  if (PLUGIN_TOOLS.has(name)) return runPluginAiTool(name, args, KNOWN_TOOLS);

  // Colour: the Color Studio grade and the frames and scopes it is judged by (colorTools.ts).
  if (COLOR_TOOLS.has(name)) {
    return runColorTool(name, args, { project, assets, commit, current: () => host.history.current(), pickComp, prompt: turnPrompt(turnId ?? host.turnId) });
  }

  // Brand kits: read in any phase, written through the host's settings callbacks.
  if (BRAND_KIT_TOOLS.has(name)) {
    return runBrandKitTool(host, name, args, { project, comp: pickComp(project, args) ?? null, commit, folderFor: (folder) => findOrCreateFolder(project, commit, folder) });
  }

  switch (name) {
    case 'spawn_subagent': {
      const task = str(args, 'task');
      const roleArg = str(args, 'role');
      if (roleArg && !isCouncilRole(roleArg)) return fail(`role must be one of ${COUNCIL.map((member) => member.id).join(', ')}.`);
      const member = councilMember(roleArg);
      const labelText = member ? `${member.name}: ${str(args, 'label') || member.title}` : (str(args, 'label') || 'Subagent');
      if (!task) return fail('task is required');
      const parentTurnId = turnId ?? host.turnId ?? '';
      try {
        const result = await api.chatSpawnSubagent({
          parentTurnId,
          task,
          label: labelText,
          model: str(args, 'model') ?? undefined,
          maxRounds: num(args, 'maxRounds') ?? undefined,
          // A council seat works from its own brief and sees the project the lead sees.
          persona: member?.brief,
          context: aiContext(project, assets, host.selection()),
        });
        return done(`Spawned ${member ? `the ${member.name}` : 'subagent'} "${labelText}"`, { subagentId: result.subagentId, label: labelText, role: member?.id ?? null });
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
    case 'consult_council': {
      const comp = pickComp(project, args);
      if (!comp) return fail('No comp to review.');
      const wanted = str(args, 'member');
      if (wanted && wanted !== 'all' && !isCouncilRole(wanted)) return fail(`member must be all or one of ${COUNCIL.map((member) => member.id).join(', ')}.`);
      const only: CouncilRole[] | undefined = wanted && wanted !== 'all' ? [wanted as CouncilRole] : undefined;
      // The Comedian checks each placed meme against the library (verified, how fresh).
      await primeMemeCache(comp);
      const review = councilReview(project, assets, comp, only, { meme: memeLookup });
      const blocks = review.notes.filter((note) => note.severity === 'block').length;
      const fixes = review.notes.filter((note) => note.severity === 'fix').length;
      const head = blocks ? `The council holds the cut: ${blocks} blocking note(s), ${fixes} fix(es).` : fixes ? `The council wants ${fixes} fix(es) before it signs off.` : 'The council signs off.';
      return done(`${head}\n${describeReview(review, only)}`, {
        verdicts: only ? Object.fromEntries(only.map((role) => [role, review.verdicts[role]])) : review.verdicts,
        notes: review.notes,
        motionDensity: Math.round(review.motionDensity * 100) / 100,
        framesInMotion: review.frames,
        briefs: (only ?? COUNCIL.map((member) => member.id)).map((role) => ({ role, name: councilMember(role)?.name, motto: councilMember(role)?.motto })),
      });
    }
    case 'find_free_media': {
      const query = str(args, 'query');
      if (!query) return fail('Supply what to search for.');
      const kind = (['image', 'video', 'audio'] as const).find((k) => k === str(args, 'kind')) ?? 'any';
      const limit = Math.min(Math.max(1, num(args, 'limit') ?? 10), 30);
      let found;
      try {
        found = await api.freeMediaSearch(query, kind, limit);
      } catch (error) {
        return fail(`No licence-clear library answered: ${errorText(error)}. Try a simpler query, or online_research for the subject's own press material.`);
      }
      const results = found.map((item, index) => ({ index, title: item.title, kind: item.kind, provider: item.provider, license: item.license, credit: item.attributionRequired ? item.attribution : null, size: item.width && item.height ? `${item.width}×${item.height}` : null, duration: item.duration, page: item.page }));
      if (!(bool(args, 'download') ?? false)) {
        return done(`${found.length} licence-clear result(s) for "${query}". Download the best with find_free_media {"download":true,"pick":[indices]}.`, { query, results });
      }
      const picks = Array.isArray(args.pick) ? (args.pick as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < found.length) : [];
      const chosen = (picks.length ? picks.map((i) => found[i]) : found).slice(0, Math.min(Math.max(1, num(args, 'maxDownloads') ?? 3), 10));
      const folderName = str(args, 'folderName') ?? `Research: ${query}`;
      const folderId = findOrCreateFolder(project, commit, folderName);
      const imported: Asset[] = [];
      const failed: string[] = [];
      const records: Record<string, Provenance> = {};
      for (const item of chosen) {
        try {
          const dl = await api.mediaDownload(item.url, item.kind, undefined, undefined, undefined, undefined, undefined, undefined);
          const [asset] = await host.importMedia([dl.path], folderId);
          if (!asset) throw new Error('the file could not be imported');
          imported.push(asset);
          records[asset.id] = { url: item.url, host: rightsOf(item.url).host, tier: 'free', license: item.license, credit: item.attribution, attributionRequired: item.attributionRequired, provider: item.provider, page: item.page, at: Date.now() };
        } catch (error) {
          failed.push(`${item.title}: ${errorText(error)}`);
        }
      }
      if (Object.keys(records).length) commit((current) => withProvenance(current, records));
      if (!imported.length) return fail(`Nothing downloaded. ${failed.join(' · ')}`);
      const credits = chosen.filter((item) => item.attributionRequired).map((item) => item.attribution);
      return done(
        `Downloaded ${imported.length} licence-clear file(s) into "${folderName}"${failed.length ? ` (${failed.length} failed)` : ''}.${credits.length ? ` Credit required: ${credits.join(' · ')}` : ' No credit required.'}`,
        { assets: imported.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind })), assetId: imported[0].id, licenses: chosen.map((item) => ({ title: item.title, license: item.license, credit: item.attribution })), failed },
      );
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
        // The user's own work on a card (a drawn sketch, an uploaded or generated picture) survives
        // the AI re-saving the plan: carry it over from the scene that covered the same moment.
        const previous = comp.storyboard?.find((old) => Math.abs(old.start - (row.start as number)) < 0.5) ?? comp.storyboard?.[i];
        const kept = previous ? { ...(previous.thumbnail ? { thumbnail: previous.thumbnail } : {}), ...(previous.sketch ? { sketch: previous.sketch } : {}) } : {};
        return { ...kept, ...parseBeat(row, i + 1, knownIds, beatProblems), start: row.start as number, end: row.end as number, intent: row.intent as string, visual: row.visual as string, audio: row.audio as string, evidence: row.evidence as string, ...(refs?.length ? { refs } : {}) };
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
        ...scenes.map((s, i) => `${i + 2}. Scene ${i + 1} (${s.start}s–${s.end}s, ${s.mediaSource}): ${s.mediaSource === 'generate' ? `generate_local_media with the scene visualPrompt` : s.mediaSource === 'download' ? `download_online_media for ${s.mediaUrl ?? 'the scene URL'}` : s.mediaSource === 'render' ? `place the scene you rendered (AI Work/Output)` : `place existing asset ${s.assetId}`} — narration: "${s.narration.slice(0, 80)}".`),
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

          // The Researcher's order: licence-clear files first, never a watermarked stock preview.
          const rank = { free: 0, unknown: 1, social: 2, watermarked: 3 } as const;
          const ranked = candidateMediaUrls.map((mUrl) => ({ mUrl, rights: rightsOf(mUrl) })).filter((c) => c.rights.tier !== 'watermarked').sort((a, b) => rank[a.rights.tier] - rank[b.rights.tier]);
          const gatheredRecords: Record<string, Provenance> = {};
          for (const { mUrl, rights } of ranked) {
            try {
              const dl = await api.mediaDownload(mUrl, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
              const imported = await host.importMedia([dl.path], targetFolderId);
              if (imported[0]) {
                gatheredAssets.push(imported[0]);
                gatheredRecords[imported[0].id] = { url: mUrl, host: rights.host, tier: rights.tier, license: rights.license, at: Date.now() };
              }
            } catch (dlErr) {
              console.warn(`Could not download gathered media from ${mUrl}:`, dlErr);
            }
          }
          if (Object.keys(gatheredRecords).length) commit((current) => withProvenance(current, gatheredRecords));
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

        // Precedence: the tool argument, then the active brand kit's voice, then Settings. With none
        // of those the backend picks: a cloud voice when a key is saved, else Kokoro offline.
        const voice = requestedVoice || activeBrandKit(host, project)?.audio.voice || settingsVoice || null;

        if (!voice) {
          const ready = await api.speechVoices().catch(() => []);
          if (ready.length === 0) {
            // Nothing can speak yet: start the offline voice downloading so the next try works.
            const status = await api.speechStatus().catch(() => null);
            const missing = ['kokoro-runtime', 'kokoro-v1'].filter((id) => !status?.models.find((model) => model.id === id)?.installed);
            for (const id of missing) await api.modelDownload(id).catch(() => undefined);
            return fail(missing.length
              ? 'No voice is ready yet. Downloading the Kokoro offline voices now (about 350 MB) — try again once the download finishes, or add an ElevenLabs or OpenAI key in Settings › Speech & voice.'
              : 'No voice is ready yet. Add an ElevenLabs or OpenAI key, or download the Kokoro voices in Settings › Speech & voice.');
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

        const scrapedRecords: Record<string, Provenance> = {};
        for (const vUrl of selectedVideos) {
          const vRights = rightsOf(vUrl);
          if (vRights.tier === 'watermarked') {
            failedDownloads.push({ url: vUrl, error: `Researcher: ${vRights.note}` });
            continue;
          }
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
              scrapedRecords[imported[0].id] = { url: vUrl, host: vRights.host, tier: vRights.tier, license: vRights.license, page: url, at: Date.now() };
            }
          } catch (dlErr) {
            failedDownloads.push({ url: vUrl, error: errorText(dlErr) });
          }
        }
        if (Object.keys(scrapedRecords).length) commit((current) => withProvenance(current, scrapedRecords));

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
        // `imageUrls`, not `images`: the transports strip `images` as the vision payload of frame tools.
        return done(`Scraped "${result.title || url}".${mediaNote}`, {
          url: result.url,
          title: result.title,
          text: result.text,
          imageUrls: result.images,
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
        const more = res.truncated ? ` More follows: read on with startLine ${res.endLine + 1}.` : '';
        return done(`Read ${res.path} (${shownLines} line(s) shown of ${res.totalLines} total, ${res.sizeBytes} bytes).${more}`, {
          path: res.path,
          content: res.content,
          totalLines: res.totalLines,
          startLine: res.startLine,
          endLine: res.endLine,
          sizeBytes: res.sizeBytes,
          truncated: !!res.truncated,
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
        return done(`Found ${res.totalMatches} match(es) for pattern "${res.pattern}" in ${res.basePath}.${truncatedNote(res.truncated)}`, {
          basePath: res.basePath,
          pattern: res.pattern,
          matches: res.matches,
          totalMatches: res.totalMatches,
          truncated: res.truncated ?? false,
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
        return done(`Found ${res.totalMatches} matching line(s) for "${res.query}" in ${path}.${truncatedNote(res.truncated)}`, {
          query: res.query,
          matches: res.matches,
          totalMatches: res.totalMatches,
          truncated: res.truncated ?? false,
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
        // Results stay in the transcript for the rest of the turn: only the tail of a long output is kept.
        const stdout = outputTail(res.stdout);
        const stderr = outputTail(res.stderr);
        const truncated = stdout.cut > 0 || stderr.cut > 0;
        const outputSummary = stdout.text.trim() || stderr.text.trim() || '(no output)';
        return done(`Command ${statusNote} in ${res.durationMs}ms.${truncated ? ' The output was truncated to its last 12 KB; pipe it to a file and read_file a range.' : ''}\nOutput:\n${truncated ? outputSummary.slice(-2000) : outputSummary.slice(0, 2000)}`, {
          command,
          cwd,
          exitCode: res.exitCode,
          stdout: stdout.text,
          stderr: stderr.text,
          ...(stdout.cut ? { stdoutTruncated: stdout.cut } : {}),
          ...(stderr.cut ? { stderrTruncated: stderr.cut } : {}),
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
      // The Researcher's veto: a stock preview is a watermarked file, whatever the query wanted.
      const rights = rightsOf(url);
      if (rights.tier === 'watermarked') return fail(`Researcher: ${rights.note} Find it licence-clear instead — find_free_media {"query":"…"} (Openverse, Wikimedia Commons, NASA), Pexels or Pixabay — or the subject's own press kit.`);
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
          return fail(`Downloaded to ${downloaded.path}, but Bhippi could not import it: ${errorText(importError)}. The source probably served a page or a stub instead of the media — try another URL or source.`);
        }
        const asset = imported[0];
        if (!asset) {
          return fail(`Media was downloaded to ${downloaded.path} but could not be imported into Bhippi.`);
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

        commit((current) => withProvenance(current, { [asset.id]: { url, host: rights.host, tier: rights.tier, license: rights.license, at: Date.now() } }));
        const folderMsg = targetFolderId ? ` inside folder "${folderName || targetFolderId}"` : '';
        const trimMsg = (startTime || endTime) ? ` (trimmed ${startTime || '0'}-${endTime || 'end'})` : '';
        const audioMsg = noAudio ? ' [video-only / no sound]' : '';
        const cropMsg = crop ? ` [cropped: ${crop}]` : '';

        return done(
          `Downloaded and imported "${asset.name}" (${asset.kind}, asset ID: ${asset.id})${folderMsg}${trimMsg}${audioMsg}${cropMsg}. Ready to place on timeline or use in storyboard.${rights.tier === 'free' ? ` Licence: ${rights.license}.` : ` Researcher: ${rights.note}`}`,
          {
            rights: { tier: rights.tier, host: rights.host, license: rights.license },
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
        // The guideline is also a document in the project folder (Documents/Guidelines/), which the user
        // opens from the Project panel and finds in Explorer.
        const paletteLine = palette?.length ? `

**Palette:** ${palette.join(' · ')}` : '';
        const file = await Promise.resolve()
          .then(() => api.projectDocWrite('guidelines', `${ref.name} guideline`, `# ${ref.name}

${notes.trim()}${paletteLine}
`))
          .catch(() => null);
        return done(
          `Project guideline "${ref.name}" created and activated for this video project. Its rules are now loaded in the AI context.${file ? ` Saved as ${file}.` : ''}`,
          {
            id: ref.id,
            name: ref.name,
            pack: ref.pack,
            palette: ref.palette,
            brief: brief || notes,
            file,
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
        { capabilities, disableLocalGeneration, cloudGeneration: 'Cloud generators (Settings › Connectors) are separate: call cloud_generation_capabilities.' },
      );
    }
    case 'cloud_generation_capabilities': {
      const settings = host.settings?.() ?? await api.settingsGet();
      const prefs = cloudPrefs(settings);
      const rows = await genApi.connectors();
      const usable = usableConnectors(settings, rows);
      const refs = [...assets.values()].filter((asset) => asset.kind === 'image' && !asset.missing).slice(-30).map((asset) => ({ id: asset.id, name: asset.name, width: asset.width, height: asset.height }));
      if (!prefs.enabled || !usable.length) {
        return done(prefs.enabled
          ? 'Cloud generation is on but no connector has a key. Do not call generate_cloud_media; tell the editor they can connect Higgsfield, Magnific, Veo, Runway, Kling, Luma, MiniMax or fal in Settings › Connectors if they want generated clips.'
          : 'Cloud generation is OFF (Settings › Connectors). Do not call generate_cloud_media. Source real footage, use local models if enabled, or build motion graphics.', { enabled: prefs.enabled, connectors: [] });
      }
      return done(`Cloud generation ready: ${usable.map((row) => row.label).join(', ')}. Plan all clips in one generate_cloud_media call; ${prefs.confirm ? 'the editor approves them on a plan card first' : 'confirmation is off, so they run immediately'}.`, {
        enabled: true,
        confirmFirst: prefs.confirm,
        defaultVideo: prefs.defaultVideo ?? null,
        defaultImage: prefs.defaultImage ?? null,
        connectors: usable.map((row) => ({
          id: row.id, label: row.label,
          models: row.models.map((m) => ({ model: `${row.id}:${m.id}`, label: m.label, kind: m.kind, takesReferenceImage: m.modes.includes('image'), textOnlyOk: m.modes.includes('text'), durations: m.durations, aspects: m.aspects, quality: m.quality })),
        })),
        referenceImages: refs,
      });
    }
    case 'generate_cloud_media': {
      const settings = host.settings?.() ?? await api.settingsGet();
      const prefs = cloudPrefs(settings);
      if (!prefs.enabled) return fail('Cloud generation is off in Settings › Connectors. Source footage another way, or ask the editor to turn it on.');
      const rows = await genApi.connectors();
      if (!usableConnectors(settings, rows).length) return fail('No cloud generator is connected. The editor can add one in Settings › Connectors.');
      const raw = Array.isArray(args.items) ? (args.items as Args[]) : [];
      if (!raw.length) return fail('Give at least one item to generate.');
      const comp = pickComp(project, args);
      const shape = comp ? (comp.height > comp.width * 1.1 ? '9:16' : Math.abs(comp.width - comp.height) < comp.width * 0.1 ? '1:1' : '16:9') : '16:9';
      const kit = activeBrandKit(host, project);
      const planned: GenPlanItem[] = [];
      for (const [index, item] of raw.entries()) {
        const kind = item.kind === 'image' ? 'image' : 'video';
        let prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
        if (!prompt) return fail(`Item ${index + 1} has no prompt.`);
        const refIds = (Array.isArray(item.referenceAssetIds) ? item.referenceAssetIds : []).filter((id): id is string => typeof id === 'string');
        for (const id of refIds) {
          if (assets.get(id)?.kind !== 'image') return fail(`Item ${index + 1}: ${id} is not an imported image. Use IDs from cloud_generation_capabilities.referenceImages.`);
        }
        const choice = pickModel(settings, rows, kind, refIds.length > 0, typeof item.model === 'string' ? item.model : null);
        if (!choice) return fail(`No connected model makes ${kind === 'video' ? (refIds.length ? 'video from an image' : 'text-to-video') : 'images'}. Check cloud_generation_capabilities.`);
        let negative = typeof item.negativePrompt === 'string' ? item.negativePrompt : undefined;
        // The active brand kit frames generated imagery here as it does for local generation.
        if (kit) { const branded = brandedPrompt(kit, prompt, negative, kind); prompt = branded.prompt; negative = branded.negative; }
        planned.push({
          key: `${index}-${uid()}`, kind, prompt, negativePrompt: negative, referenceAssetIds: refIds.slice(0, choice.model.maxRefs),
          connector: choice.connector.id, model: choice.model.id,
          duration: kind === 'video' ? (typeof item.duration === 'number' ? item.duration : 5) : undefined,
          aspect: typeof item.aspect === 'string' ? item.aspect : shape,
          purpose: typeof item.purpose === 'string' ? item.purpose : undefined,
          sceneIndex: Number.isInteger(item.sceneIndex) ? (item.sceneIndex as number) : undefined,
        });
      }
      let plan: GenPlan = { reason: str(args, 'reason'), items: planned };
      if (prefs.confirm) {
        if (!host.approveGeneration) return fail('This chat cannot show the generation plan card; nothing was generated.');
        const approved = await host.approveGeneration(plan, signal);
        if (!approved) return done('The editor cancelled the generation plan; nothing was generated or charged. Ask what they want instead, or continue without these clips.', { cancelled: true });
        plan = approved;
      }
      const run = plan.items.filter((item) => !item.skip && item.prompt.trim());
      if (!run.length) return done('The editor skipped every item; nothing was generated.', { cancelled: true });
      const edited = run.filter((item) => planned.find((p) => p.key === item.key && (p.prompt !== item.prompt || p.model !== item.model || p.referenceAssetIds.join() !== item.referenceAssetIds.join())));
      // Every approved item starts at once — they queue on the services, not here.
      const started = await Promise.all(run.map(async (item) => {
        try {
          const jobId = await genApi.generate({ connector: item.connector, model: item.model, kind: item.kind, prompt: item.prompt, negativePrompt: item.negativePrompt, referenceAssetIds: item.referenceAssetIds, duration: item.duration, aspect: item.aspect });
          return { item, jobId, error: null as string | null };
        } catch (error) { return { item, jobId: null as string | null, error: errorText(error) }; }
      }));
      const folder = generatedFolderId(project, commit);
      const results: Record<string, unknown>[] = [];
      const pending = new Map<string, GenPlanItem>();
      for (const entry of started) {
        if (entry.jobId) pending.set(entry.jobId, entry.item);
        else results.push({ purpose: entry.item.purpose, prompt: entry.item.prompt, ok: false, error: entry.error });
      }
      const deadline = Date.now() + 35 * 60_000;
      while (pending.size && Date.now() < deadline && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const jobs = await api.jobsList();
        for (const [jobId, item] of [...pending]) {
          const job = jobs.find((entry) => entry.id === jobId);
          if (!job || job.status === 'running') continue;
          pending.delete(jobId);
          const path = (job.result as { path?: string } | null)?.path;
          if (job.status !== 'done' || !path) { results.push({ purpose: item.purpose, prompt: item.prompt, ok: false, error: job.message || job.status, jobId }); continue; }
          try {
            const [asset] = await host.importMedia([path], folder);
            results.push({ purpose: item.purpose, prompt: item.prompt, ok: true, assetId: asset?.id, name: asset?.name, model: `${item.connector}:${item.model}`, jobId });
            if (asset && item.sceneIndex !== undefined) attachGathered(host, 'generate_cloud_media', { sceneIndex: item.sceneIndex, kind: item.kind, compId: args.compId }, { ok: true, summary: '', assetId: asset.id });
          } catch (error) { results.push({ purpose: item.purpose, ok: false, error: errorText(error), jobId }); }
        }
      }
      for (const [jobId, item] of pending) results.push({ purpose: item.purpose, ok: false, error: 'Still generating as a background job; import it later with import_generated_media.', jobId });
      const made = results.filter((r) => r.ok);
      if (!made.length) return fail(`Nothing was generated: ${results.map((r) => r.error).join(' · ')}`);
      return done(
        `Generated ${made.length} of ${run.length}${results.length > made.length ? ` (${results.length - made.length} failed)` : ''} into the Generated bin${edited.length ? `; the editor changed ${edited.length} item(s) on the plan card, so follow their version` : ''}. Place them with place_clip using these asset IDs.`,
        { results, assets: made.map((r) => ({ id: r.assetId, name: r.name })) },
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
        if (engine === 'sam2-vitmatte' && clip.duration > 300) return fail('sam2-vitmatte mattes up to 300 s in one pass. Use engine rvm for a long host shot: it mattes in 30 s chunks and caches them.');
        // RVM mattes any length: clips over 30 s go in cached, resumable chunks with cross-faded overlaps.
        const long = engine === 'rvm' && clip.duration > 30;
        const result = long
          ? await rotoscopeLong(asset.id, { from: clip.in, seconds: clip.duration, fps: actualFps, modelPath: model.path, model: model.id, signal })
          : await rotoscope(asset.id, { from: clip.in, seconds: clip.duration, fps: actualFps, modelPath: model.path, model: model.id, engine, points, signal });
        validateRotoResult(result);
        const live = host.history.current().comps.find(entry => entry.id === comp.id)?.clips.find(item => item.id === clip.id);
        if (!live || live.in !== clip.in || live.duration !== clip.duration || live.speed !== clip.speed || live.reverse !== clip.reverse || JSON.stringify(live.source) !== JSON.stringify(clip.source)) return fail('The clip changed during inference; the cached matte was not attached.');
        commit(current => updateComp(current, comp.id, entry => ({ ...entry, clips: entry.clips.map(item => {
          if (item.id !== clip.id || item.in !== clip.in || item.duration !== clip.duration || item.speed !== clip.speed || item.reverse !== clip.reverse || JSON.stringify(item.source) !== JSON.stringify(clip.source)) return item;
          return { ...item, rotoMatte: result.matte };
        }) })));
        const attached = host.history.current().comps.find(c => c.id === comp.id)?.clips.find(c => c.id === clip.id);
        if (attached?.rotoMatte !== result.matte) return fail('The matte was generated but its timeline attachment could not be confirmed. Do not claim Roto was applied.');
        return done('Subject matte generated and attachment verified. Review the cutout; a duplicate original background underneath can make isolated Roto appear unchanged until you insert text/media between the layers.', { clipId: clip.id, frames: result.frames, model: model.id, ...(long ? { chunks: (result as LongRotoResult).chunks, reused: (result as LongRotoResult).reused } : {}), previewSupported: true, meanSubjectCoverage: result.subjects.reduce((sum, s) => sum + s.cover, 0) / result.frames, visualQualityVerified: false });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'analyze_clip_speech': {
      const found = findClipIn(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Supply a media clipId.');
      try {
        const transcript = await api.transcribeAsset(found.clip.source.assetId, str(args, 'language') ?? 'auto');
        return done('Source transcript obtained; no subtitle layers were created. `timed` is "<start s> <word>" in source seconds; the last word ends at `end`.', { transcript: transcriptForModel(transcript), sourceIn: found.clip.in, sourceOut: sourceOut(found.clip), timelineStart: found.clip.start, speed: found.clip.speed, reverse: found.clip.reverse });
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
      // Tracking and transcription took a while: cut the comp as it is now, and only if the clip is
      // exactly what was analysed, so nothing the user did meanwhile is thrown away.
      const liveComp = host.history.current().comps.find((entry) => entry.id === comp.id);
      const liveClip = liveComp?.clips.find((entry) => entry.id === clip.id);
      if (signal?.aborted || !liveComp || !liveClip || JSON.stringify(liveClip) !== JSON.stringify(clip) || liveComp.tracks.find((track) => track.id === liveClip.trackId)?.locked) {
        return fail('The clip changed while podcast_cut was analysing; nothing was applied. Re-run podcast_cut.');
      }
      const sourceAspect = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : undefined;
      const applied = applyPodcastCut(liveComp, liveClip, plan, tracks, { mode, maxZoom, nameTags, sourceAspect });
      if (!applied.ok) return fail(applied.error);
      editComp(liveComp, () => applied.comp);

      const review = [
        trackedBy ? `Faces by machine (${trackedBy}): eyeball one single per person — a wrong track punches the wrong face.` : 'Review the singles at 2x: a wrong box punches the wrong face — fix boxes, re-run.',
        plan.unmappedSpeakers.length ? `Speakers without faces (${plan.unmappedSpeakers.join(', ')}) stayed wide: pass cast:[{person, speaker}] to place them.` : null,
        !transcript.diarized ? 'Transcript is not diarized (one voice assumed; cuts follow speech activity). Save a Deepgram or ElevenLabs key and re-run for true who-speaks-what.' : null,
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
      const kind=str(args,'kind')||'whoosh';if(!(SFX_KINDS as readonly string[]).includes(kind))return fail(`Choose one of ${SFX_KINDS.join(', ')}.`);
      try{const result=generateSelectionSound(comp,list(args,'clipIds').length?list(args,'clipIds'):host.selection(),kind as import('./types').SfxKind,num(args,'gainDb')??SFX_GAIN_DB[kind as import('./types').SfxKind]);
      editComp(comp,()=>result.comp);host.setSelection(result.ids);return done('Local procedural accents added on new audio tracks; original audio preserved',{clipIds:result.ids});}catch(error){return fail(String(error));}
    }
    case 'list_effects':
      return done('Native effects with preview and export support. For colour grading use color_grade (the Color Studio) and check it with inspect_color.', { effects: AVAILABLE_EFFECTS.map(effect=>({id:effect.id,name:effect.label,category:effect.group,parameters:getEffectSchema(effect.id,effect.group).params.filter(p=>!p.hidden),curves:effect.id==='curves'||effect.id==='lumetri-color'})) });
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
        // A LUT on a grade is the user's call (see colorTools.ts): only when this turn's message asks.
        if(effect.effectId==='lumetri-color'&&['lutId','lutAmount','lutStage'].some(k=>k in params)&&!asksForLut(turnPrompt(turnId??host.turnId)))return fail(LUT_REFUSAL);
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

    // The long-term brain (brain.rs): memory, the user model, recall and self-written skills.
    case 'brain_remember': {
      const kind = str(args, 'kind');
      const text = str(args, 'text');
      if (!kind || !text) return fail('brain_remember needs kind ("user" or "memory") and text');
      try {
        const saved = await api.brainRemember(kind, text);
        return done(saved.updated ? 'Updated a brain entry' : 'Remembered', saved);
      } catch (error) { return fail(errorText(error)); }
    }
    case 'brain_recall': {
      const query = str(args, 'query');
      if (!query) return fail('brain_recall needs a query');
      const kinds = Array.isArray(args.kinds) ? args.kinds.filter((k): k is string => typeof k === 'string') : undefined;
      try {
        const hits = await api.brainRecall(query, num(args, 'limit'), kinds);
        return done(hits.length ? `Recalled ${hits.length} entr${hits.length === 1 ? 'y' : 'ies'}` : 'Nothing in the brain matches that yet', { hits });
      } catch (error) { return fail(errorText(error)); }
    }
    case 'brain_forget': {
      const id = str(args, 'id');
      if (!id) return fail('brain_forget needs the entry id (from brain_recall)');
      try { return done('Forgotten', await api.brainForget(id)); } catch (error) { return fail(errorText(error)); }
    }
    case 'brain_save_skill': {
      const name = str(args, 'name');
      if (!name) return fail('brain_save_skill needs a name');
      try {
        const saved = await api.brainSaveSkill({ name, description: str(args, 'description'), body: str(args, 'body'), mode: str(args, 'mode'), old: str(args, 'old'), new: str(args, 'new') });
        return done(`Skill ${saved.name} saved (v${saved.version})`, saved);
      } catch (error) { return fail(errorText(error)); }
    }
    case 'brain_load_skill': {
      const name = str(args, 'name');
      if (!name) return fail('brain_load_skill needs the skill name');
      try { return done('Skill loaded: follow its procedure', await api.brainLoadSkill(name)); } catch (error) { return fail(errorText(error)); }
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

    case 'tool_help': {
      const wanted = str(args, 'name')?.replace(/^mcp__bhippi__/, '');
      const spec = (catalog as { tools: { name: string; description: string; input_schema: unknown }[] }).tools.find((tool) => tool.name === wanted);
      if (!spec) return fail(`No tool "${wanted ?? ''}". Every tool is listed in your catalogue by name.`);
      return done(`${spec.name}: ${spec.description}`, { name: spec.name, parameters: spec.input_schema });
    }

    case 'ask_user': {
      const question = str(args, 'question');
      if (!question) return fail('ask_user needs a question');
      const options = askOptions(args.options);
      if (host.permission?.() === 'full') {
        return done(`decided without asking (Full access): ${question.slice(0, 60)}`, {
          answer: 'The editor is in Full access mode and does not want to be asked. Choose the best option yourself, carry on, and say what you chose in your reply.',
          autoDecided: true,
        });
      }
      const answer = await host.ask({ question, options, context: str(args, 'context') ?? null }, signal, turnId ?? host.turnId);
      return done(`asked: ${question.slice(0, 60)}`, { answer });
    }

    case 'get_comp': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to read');
      return { ok: true, ...compDetail(project, assets, comp, args.plan === true) };
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

    case 'choose_shorts_format': {
      const orientation = await askShortsFormat(host, args, turnId, signal);
      if (!orientation) return fail('The answer did not say portrait or landscape. Ask again with choose_shorts_format.');
      const frame = SHORT_FRAMES[orientation];
      return done(`Shorts will be ${orientation} (${frame.width}×${frame.height}).`, { orientation, width: frame.width, height: frame.height });
    }

    case 'choose_comp_size': {
      // Always a real question — even in Full access — unless the user's own message named the size:
      // the frame is the user's call and everything built after it depends on it.
      const stated = frameSizeFromText(turnPrompt(turnId ?? host.turnId));
      let size = stated;
      if (!size) {
        // The model words the question for this request and puts the likeliest shape first.
        const recommended = COMP_SIZE_OPTIONS.find((option) => option.id === str(args, 'recommended'));
        const options = recommended ? [`${recommended.label} — recommended`, ...COMP_SIZE_OPTIONS.filter((option) => option !== recommended).map((option) => option.label)] : COMP_SIZE_OPTIONS.map((option) => option.label);
        const answer = await host.ask({
          question: str(args, 'question') ?? 'What shape should this video be?',
          options,
          context: str(args, 'context') ?? 'Everything gets built for this frame, so it is worth picking before I start.',
        }, signal, turnId ?? host.turnId);
        size = frameSizeFromText(answer);
      }
      if (signal?.aborted) return fail('Cancelled.');
      if (!size) return fail('The answer did not name a frame size. Ask again with choose_comp_size.');
      const frame = { width: Math.round(clamp(size.width, 16, 8192)), height: Math.round(clamp(size.height, 16, 8192)) };
      const target = pickComp(project, args);
      let compId = target?.id;
      if (!target) {
        const created = { ...newComp({ name: str(args, 'name') ?? 'Comp 1', ...frame }), sizeChosen: true };
        compId = created.id;
        commit((current) => ({ ...current, comps: [...current.comps, created], activeCompId: created.id, openCompIds: [...current.openCompIds, created.id] }));
      } else {
        commit((current) => {
          const resized = target.width !== frame.width || target.height !== frame.height ? reformatComp(current, target.id, frame, 'fill').project : current;
          return updateComp(resized, target.id, (entry) => ({ ...entry, sizeChosen: true }));
        });
      }
      const shape = `${frame.width}×${frame.height} (${aspectLabel(frame.width, frame.height)} ${orientationOf(frame.width, frame.height)})`;
      return done(`The comp is ${shape}${stated ? ', as the request said' : ', as the user chose'}. Carry on with the task.`, { compId, width: frame.width, height: frame.height });
    }

    case 'create_shorts': {
      // The source: a clip on a timeline (its asset) or an asset id.
      const clipId = str(args, 'clipId');
      const fromClip = clipId ? findClipIn(project, clipId) : null;
      if (clipId && !fromClip) return fail('No clip with that clipId.');
      const assetId = fromClip && fromClip.clip.source.type === 'media' ? fromClip.clip.source.assetId : str(args, 'assetId');
      const asset = assetId ? assets.get(assetId) : undefined;
      if (!asset || (asset.kind !== 'video' && asset.kind !== 'audio')) return fail('Give the long video as clipId (a clip on the timeline) or assetId.');
      const rawShorts = Array.isArray(args.shorts) ? (args.shorts as Args[]) : [];
      if (!rawShorts.length) return fail('Give shorts: [{title, score, segments:[{start,end}], hook?, reason?}] — source seconds from analyze_clip_speech.');
      if (rawShorts.length > MAX_SHORTS) return fail(`At most ${MAX_SHORTS} shorts per call; keep the strongest.`);
      const orientation = await askShortsFormat(host, args, turnId, signal);
      if (!orientation) return fail('Portrait or landscape was not chosen. Call choose_shorts_format first.');
      if (signal?.aborted) return fail('Cancelled.');

      // What was said, for word-safe cuts and the captions (cached after analyze_clip_speech).
      let words: import('./ipc').TranscriptWord[] = [];
      try {
        // A plugin test makes no new transcription (it could cost): what is cached, or none.
        words = host.testing ? (await api.transcriptsCached([asset.id]))[0]?.words ?? [] : (await api.transcribeAsset(asset.id, 'auto')).words ?? [];
      } catch { /* no engine: cuts stay as given, no captions */ }

      const problems: string[] = [];
      const specs: ShortSpec[] = [];
      rawShorts.forEach((row, index) => {
        const title = typeof row?.title === 'string' && row.title.trim() ? row.title.trim().slice(0, 80) : `Short ${index + 1}`;
        const score = typeof row?.score === 'number' && Number.isFinite(row.score) ? clamp(row.score, 0, 10) : NaN;
        if (Number.isNaN(score)) { problems.push(`${title}: score must be a number 0–10`); return; }
        const segments = Array.isArray(row.segments) ? (row.segments as { start: number; end: number }[]) : typeof row.start === 'number' && typeof row.end === 'number' ? [{ start: row.start as number, end: row.end as number }] : [];
        const cleaned = normalizeSegments(segments, asset.duration, words);
        if ('error' in cleaned) { problems.push(`${title}: ${cleaned.error}`); return; }
        const focus = row.focus && typeof row.focus === 'object' ? row.focus as { x?: unknown; y?: unknown } : null;
        specs.push({
          title, score, segments: cleaned.segments,
          hook: typeof row.hook === 'string' ? row.hook.slice(0, 90) : undefined,
          reason: typeof row.reason === 'string' ? row.reason.slice(0, 400) : undefined,
          focus: focus && typeof focus.x === 'number' && typeof focus.y === 'number' ? { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) } : undefined,
        });
      });
      if (problems.length) return fail(`Fix these and call again (nothing was made): ${problems.join('; ')}.`);
      specs.sort((a, b) => b.score - a.score);

      // Faces keep the speaker in shot when the frame is cropped (YuNet on the CPU; optional).
      let faces: { id: number; frames: { t: number; x: number; y: number; width: number; height: number }[] }[] = [];
      let faceNote = '';
      if (host.testing) faceNote = ' [test] Faces were not tracked during the plugin test; each short is framed on its focus point.';
      else if (asset.kind === 'video' && bool(args, 'trackFaces') !== false) {
        const from = Math.min(...specs.flatMap((spec) => spec.segments.map((seg) => seg.start)));
        const to = Math.max(...specs.flatMap((spec) => spec.segments.map((seg) => seg.end)));
        try {
          const span = to - from;
          faces = await detectFaces({ path: asset.path, start: from, end: to, fps: span > 900 ? 1 : span > 300 ? 2 : 4 });
          faceNote = faces.length ? '' : ' No face was found, so each short is framed on its focus point (or the centre).';
        } catch (error) {
          faceNote = ` Face tracking was not available (${errorText(error)}), so each short is framed on its focus point (or the centre).`;
        }
      }
      if (signal?.aborted) return fail('Cancelled.');

      // A "Shorts" folder of its own for this batch.
      const taken = new Set(project.folders.map((folder) => folder.name.toLowerCase()));
      let folderName = str(args, 'folderName')?.trim() || 'Shorts';
      if (taken.has(folderName.toLowerCase()) && project.comps.some((c) => c.folderId === project.folders.find((f) => f.name.toLowerCase() === folderName.toLowerCase())?.id)) {
        let n = 2;
        while (taken.has(`${folderName} ${n}`.toLowerCase())) n++;
        folderName = `${folderName} ${n}`;
      }
      const existing = project.folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase() && folder.parentId === null);
      const folderId = existing?.id ?? uid();
      const sourceComp = fromClip?.comp ?? project.comps.find((c) => c.id === project.activeCompId);
      const captions = bool(args, 'captions') !== false;
      const built = specs.map((spec, index) => buildShortComp({
        asset, spec, rank: index + 1, orientation, fps: sourceComp?.fps ?? 30, words, faces,
        captionStyle: str(args, 'captionStyle') ?? project.captionStyle, captions, folderId,
      }));
      let next = host.history.current();
      next = {
        ...next,
        folders: existing ? next.folders : [...next.folders, { id: folderId, name: folderName, parentId: null }],
        comps: [...next.comps, ...built.map((entry) => entry.comp)],
      };
      // Tall footage in a wide frame is fitted; fill the bars with a blurred copy of the shot.
      for (const { comp } of built) {
        const spans = uncoveredSpans(next, assets, comp);
        if (!spans.length) continue;
        const filled = fillBackground(next, assets, comp.id, spans, { source: 'blur' });
        if (!('error' in filled)) next = filled.project;
      }
      const ids = built.map((entry) => entry.comp.id);
      next = { ...next, activeCompId: ids[0], openCompIds: [...next.openCompIds.filter((id) => !ids.includes(id)), ...ids] };
      commit(() => next);
      const frame = SHORT_FRAMES[orientation];
      const rows = built.map(({ comp, notes }, index) => {
        const spec = specs[index];
        const length = spec.segments.reduce((sum, seg) => sum + seg.end - seg.start, 0);
        return `${comp.name} — “${spec.title}”, ${length.toFixed(1)} s from ${spec.segments.map((seg) => `${seg.start.toFixed(1)}–${seg.end.toFixed(1)}`).join(' + ')}${notes.length ? ` (${notes.join(', ')})` : ''}`;
      });
      return done(
        `Made ${built.length} ${orientation} short${built.length === 1 ? '' : 's'} (${frame.width}×${frame.height}) in the “${folderName}” folder, best first, all open as tabs:\n${rows.join('\n')}.${faceNote}\n` +
        'Each is cut, reframed on the speaker, punched in on alternate parts with a slow push, with its hook and captions. Now edit every short like any video, one comp at a time (open_comp, then compId on each call): motion graphics on the key lines, sound design and a music bed (level_audio), seamless transitions at the cuts, then run_frame_qa {"compId"} on it and fix what it finds. Finish with verify_edit_workflow.',
        { folderId, orientation, shorts: built.map(({ comp }, index) => ({ compId: comp.id, name: comp.name, score: specs[index].score, title: specs[index].title, duration: Math.round(compDuration(comp) * 100) / 100 })) },
      );
    }

    case 'create_comp': {
      const preset = COMP_PRESETS.find((item) => item.id === str(args, 'preset'));
      const fromId = str(args, 'fromCompId');
      if (fromId) {
        // A new version of an existing edit: copy everything in it, then reformat the copy for its shape.
        const from = project.comps.find((comp) => comp.id === fromId || comp.name === fromId);
        if (!from) return fail(`there is no comp “${fromId}” to copy`);
        const shaped = frameFromArgs(args, preset ?? from);
        const size = { width: Math.round(clamp(num(args, 'width') ?? shaped.width, 16, 8192)), height: Math.round(clamp(num(args, 'height') ?? shaped.height, 16, 8192)) };
        const mode: ReformatMode = (['fill', 'blur', 'fit', 'keep'] as const).find((m) => m === str(args, 'reframe')) ?? 'fill';
        const resized = size.width !== from.width || size.height !== from.height;
        const rate = num(args, 'fps');
        const open = bool(args, 'open') !== false;
        let made: Comp | null = null;
        let reformatted: ReturnType<typeof reformatComp> | null = null;
        commit((current) => {
          const copied = duplicateComp(current, from.id, str(args, 'name') ?? `${from.name} ${orientationOf(size.width, size.height)}`);
          if (!copied) return current;
          reformatted = resized ? reformatComp(copied.project, copied.compId, size, mode) : null;
          const base = reformatted?.project ?? copied.project;
          const comps = base.comps.map((comp) => (comp.id === copied.compId ? (made = { ...comp, sizeChosen: true, ...(rate ? { fps: clamp(rate, 1, 240) } : {}) }) : comp));
          return { ...base, comps, activeCompId: open ? copied.compId : base.activeCompId, openCompIds: open ? [...base.openCompIds, copied.compId] : base.openCompIds };
        });
        if (!made) return fail(`could not copy “${from.name}”`);
        made = made as Comp;
        const shape = `${made.width}×${made.height} (${aspectLabel(made.width, made.height)} ${orientationOf(made.width, made.height)})`;
        const report = (reformatted as ReturnType<typeof reformatComp> | null)?.report;
        const note = report ? ` ${describeReformat(report, mode)}.` : '';
        return done(`Created comp “${made.name}” (${shape}, ${made.fps} fps) as a copy of “${from.name}” with its ${made.clips.length} clips.${note} “${from.name}” is unchanged.${resized ? ' Run run_frame_qa {"compId"} on the new comp and fix anything it finds (text or shapes near the edges, footage cropped off the subject).' : ''}`, { compId: made.id, width: made.width, height: made.height, aspect: aspectLabel(made.width, made.height) });
      }
      const shaped = frameFromArgs(args, { width: preset?.width ?? 1920, height: preset?.height ?? 1080 });
      const width = num(args, 'width') ?? shaped.width;
      const height = num(args, 'height') ?? shaped.height;
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
      return done(`Created comp “${next.name}” (${next.width}×${next.height}, ${next.fps} fps)${cursor ? ` with ${list(args, 'mediaIds').length} clips` : ' — it is empty. For a version of an existing edit in this shape (everything in it carried across and refitted), use create_comp with fromCompId instead'}`, { compId: next.id });
    }

    case 'update_comp': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp to change');
      const preset = COMP_PRESETS.find((item) => item.id === str(args, 'preset'));
      const patch: Partial<Comp> = {};
      const name_ = str(args, 'name');
      if (name_) patch.name = name_;
      const shaped = frameFromArgs(args, preset ?? comp);
      const width = num(args, 'width') ?? shaped.width;
      const height = num(args, 'height') ?? shaped.height;
      const rate = num(args, 'fps');
      if (rate) patch.fps = clamp(rate, 1, 240);
      const size = { width: Math.round(clamp(width, 16, 8192)), height: Math.round(clamp(height, 16, 8192)) };
      const resized = size.width !== comp.width || size.height !== comp.height;
      if (!Object.keys(patch).length && !resized) return fail('nothing to change');
      const mode: ReformatMode = (['fill', 'blur', 'fit', 'keep'] as const).find((m) => m === str(args, 'reframe')) ?? 'fill';
      let note = '';
      if (resized) {
        // A new shape re-fits the footage and rebuilds the motion graphics for it (lib/reformat.ts).
        note = ` ${describeReformat(reformatComp(host.history.current(), comp.id, size, mode).report, mode)}.`;
        commit((current) => reformatComp(current, comp.id, size, mode).project);
      }
      if (Object.keys(patch).length) editComp(host.history.current().comps.find((c) => c.id === comp.id) ?? comp, (current) => ({ ...current, ...patch }));
      const shape = `${size.width}×${size.height} (${aspectLabel(size.width, size.height)} ${orientationOf(size.width, size.height)})`;
      return done(`Comp “${patch.name ?? comp.name}” is now ${shape} at ${patch.fps ?? comp.fps} fps.${note}${resized ? ' Run run_frame_qa to check the new framing; a talking head cropped to fill can follow the speaker with podcast_cut mode reframe.' : ''}`, { compId: comp.id, width: size.width, height: size.height, aspect: aspectLabel(size.width, size.height) });
    }

    case 'split_screen': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const ids = list(args, 'clipIds');
      const clips = ids.map((id) => comp.clips.find((clip) => clip.id === id));
      if (ids.length < 2 || ids.length > 4 || clips.some((clip) => !clip)) return fail('Give 2–4 clipIds of video clips in this comp (the first is the top / left / main picture).');
      const found = clips as Clip[];
      const videoIds = new Set(tracksOf(comp, 'video').map((track) => track.id));
      if (found.some((clip) => !videoIds.has(clip.trackId))) return fail('Every clip must be on a video track.');
      if (new Set(found.map((clip) => clip.trackId)).size !== found.length) return fail('Put each clip on its own video track first, so they play at the same time.');
      const from = Math.max(...found.map((clip) => clip.start));
      const to = Math.min(...found.map((clip) => clipEnd(clip)));
      if (to - from < 0.1) return fail('Those clips do not play at the same time; line them up on the timeline first.');
      const wanted = (str(args, 'layout') ?? 'auto') as SplitLayout;
      if (!['auto', 'stack', 'side-by-side', 'grid', 'triple', 'pip'].includes(wanted)) return fail('layout must be auto, stack, side-by-side, grid, triple or pip.');
      const layout = wanted === 'auto' ? autoLayout(comp, found.length) : wanted;
      if (layout === 'pip' && found.length !== 2) return fail('pip takes exactly two clips: the main picture, then the inset.');
      const order = (clip: Clip) => comp.tracks.findIndex((track) => track.id === clip.trackId);
      if (layout === 'pip' && order(found[1]) < order(found[0])) return fail('The inset must be on a higher video track than the main picture.');
      const corner = str(args, 'corner') as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | undefined;
      const options = { ratio: num(args, 'ratio'), gutter: num(args, 'gutter'), corner, pipSize: num(args, 'pipSize') };
      const cells = splitCells(comp, layout, found.length, options);
      const focus = Array.isArray(args.focus) ? (args.focus as unknown[]) : [];
      const sizeOf = (clip: Clip): [number, number] => {
        if (clip.source.type === 'media') { const asset = assets.get(clip.source.assetId); if (asset?.width && asset.height) return [asset.width, asset.height]; }
        if (clip.source.type === 'comp') { const inner = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId); if (inner) return [inner.width, inner.height]; }
        if (clip.source.type === 'motion') return [clip.source.scene.width, clip.source.scene.height];
        return [comp.width, comp.height];
      };
      const transforms = new Map<string, Clip['transform']>();
      found.forEach((clip, index) => {
        const [w, h] = sizeOf(clip);
        const point = focus[index] as { x?: unknown; y?: unknown } | undefined;
        const at = { x: typeof point?.x === 'number' ? clamp(point.x, 0, 1) : 0.5, y: typeof point?.y === 'number' ? clamp(point.y, 0, 1) : 0.5 };
        const cell = layout === 'pip' && index === 1 ? pipBox(comp, w, h, cells[1].width, corner) : cells[index];
        transforms.set(clip.id, fillCell(clip.transform, w, h, comp, cell, at));
      });
      editComp(comp, (current) => ({ ...current, clips: current.clips.map((c) => {
        const transform = transforms.get(c.id);
        return transform ? { ...c, transform, keyframes: { ...c.keyframes, x: [], y: [], scale: [], rotation: [] } } : c;
      }) }));
      const caption = captionBand(comp, layout, cells);
      const shape = `${comp.width}×${comp.height} (${aspectLabel(comp.width, comp.height)})`;
      return done(`Split screen “${layout}” in the ${shape} frame for ${timecode(from, fps(comp))}–${timecode(to, fps(comp))}: ${found.map((clip, i) => `${clip.name ?? clip.id} → ${layout === 'pip' ? (i ? 'inset' : 'full frame') : `cell ${i + 1}`}`).join(', ')}. Each picture is cropped to its cell and fills it; pass focus [{x,y}] per clip (source fractions) to keep a face in frame. Next: ${caption.note}.`, { layout, cells, captionY: caption.y, range: [from, to] });
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
      // The style asked for, else the project's, else the caption style the brand kit learned.
      const learnedCaption = (() => { const kit = activeBrandKit(host, project); const value = kit ? learnedValue(kit, 'captions', 'captionStyle') : undefined; return typeof value === 'string' && findStyle(value) ? value : undefined; })();
      const style = str(args, 'style') ?? project.captionStyle ?? learnedCaption;
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
      const kind = SFX_KINDS.find((item) => item === str(args, 'kind'));
      if (!kind) return fail(`unknown sound effect; use one of ${SFX_KINDS.join(', ')}`);
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
      const result = nestClips(project, first.comp.id, ids, str(args, 'name') ?? 'New Comp');
      if (!result) return fail('those clips could not be nested');
      host.history.commit(() => result.project, label);
      return done(`Made a comp of ${ids.length} clips: “${str(args, 'name') ?? 'New Comp'}”`, { compId: result.compId, clipIds: result.clipIds });
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

    case 'list_caption_styles': {
      const { styleBriefs } = await import('./fiwn/briefs');
      const all = styleBriefs({ category: str(args, 'category'), query: str(args, 'query') });
      const limit = Math.round(clamp(num(args, 'limit') ?? 40, 1, 150));
      const styles = all.slice(0, limit).map(({ id, label, category, look, when }) => ({ id, label, category, look, when }));
      return done(`${all.length} caption style${all.length === 1 ? '' : 's'}${all.length > styles.length ? ` (first ${styles.length}; narrow with category or query)` : ''}. The project's caption look is ${project.captionLook === 'fiwn' ? 'WatchFIWN: each draws with its real fonts and animation' : 'classic: simpler typography; the user can switch to the WatchFIWN look in the Subtitles tab'}. Apply one with set_caption_style {"style":"<id>"}.`, { styles });
    }

    case 'set_caption_style': {
      const style = str(args, 'style');
      if (!style) return fail('style is required');
      // A made-up id would restyle every caption to nothing: name the closest real ones instead.
      if (!findStyle(parseRbStyle(style).base ?? style)) {
        const { styleBriefs } = await import('./fiwn/briefs');
        const near = styleBriefs({ query: style.replace(/[^a-z0-9]+/gi, ' ').trim().split(' ')[0] }).slice(0, 6).map((brief) => brief.id);
        return fail(`there is no caption style "${style}". ${near.length ? `Close ones: ${near.join(', ')}. ` : ''}See list_caption_styles for every id.`);
      }
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
      // Only the assistant's own steps, from the top of the history: an edit the user made in the
      // meantime is theirs, and the assistant's undo must never take it away.
      const labels = [host.history.steps.present, ...[...host.history.steps.past].reverse()];
      const own = labels.findIndex((label) => !label.startsWith('AI: '));
      const available = own < 0 ? labels.length : own;
      const count = Math.min(steps, available);
      if (!count) return fail(`the last change ("${host.history.steps.present}") was made by the user, not by you — it is theirs to undo. Change the project back with the edit tools instead.`);
      for (let index = 0; index < count; index++) host.history.undo();
      return done(count < steps ? `Undid ${count} of your step${count === 1 ? '' : 's'}; the step before that was the user's own edit, so it was left alone` : `Undid ${count} step${count === 1 ? '' : 's'}`);
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
      const property = str(args, 'property') as KeyframedProperty | EffectKeyProperty | undefined;
      if (!found) return fail('no clip with that id');
      // Transform and volume keys live in clip.keyframes; the Effects settings in clip.effectKeys.
      const effectKey = (EFFECT_KEYED as string[]).includes(property ?? '');
      if (!property || (!(property in EMPTY_KEYFRAMES) && !effectKey)) return fail(`unknown property; use one of ${[...Object.keys(EMPTY_KEYFRAMES), ...EFFECT_KEYED].join(', ')}`);
      if (!Array.isArray(args.keyframes)) return fail('keyframes must be an array of {time, value, easing?}; pass [] to clear');
      // Every entry parses or nothing is written: a dropped entry used to clear the property and report success.
      const numeric = (value: unknown) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN);
      const keys: Keyframe[] = [];
      for (const [i, entry] of (args.keyframes as unknown[]).entries()) {
        const key = (entry && typeof entry === 'object' ? entry : {}) as Args;
        const time = numeric(key.time);
        const value = numeric(key.value);
        if (!Number.isFinite(time) || !Number.isFinite(value)) return fail(`keyframes[${i}] needs numeric time and value (clip keyframes use {time, value, easing}, not the motion engine's {t, v, ease})`);
        const easing = key.easing === undefined ? 'linear' : EASINGS.find((item) => item === key.easing);
        if (!easing) return fail(`keyframes[${i}] has an unknown easing "${String(key.easing)}"; use one of ${EASINGS.join(', ')}`);
        keys.push({ time: Math.max(0, time), value, easing });
      }
      keys.sort((a, b) => a.time - b.time);
      editComp(found.comp, (current) => ({ ...current, clips: current.clips.map((clip) => (clip.id !== found.clip.id ? clip : effectKey ? { ...clip, effectKeys: { ...clip.effectKeys, [property]: keys } } : { ...clip, keyframes: { ...clip.keyframes, [property]: keys } })) }));
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

    case 'add_plugin_clip': {
      const comp = pickComp(project, args);
      if (!comp) return fail('there is no comp');
      const id = str(args, 'plugin');
      const name = str(args, 'generator');
      if (!id || !name) return fail('add_plugin_clip needs plugin and generator (the plugins brief lists clipGenerators).');
      const plugin = findPlugin(id);
      if (!plugin) return fail(`No plugin “${id}”.`);
      if (!plugin.enabled) return fail(`“${plugin.name}” is turned off; the user has to turn it on first.`);
      const generator = findGenerator(id, name);
      const offered = pluginStore.get().generators.filter((item) => item.plugin === id).map((item) => item.name);
      if (!generator && offered.length) return fail(`“${plugin.name}” has no clip “${name}”. It offers: ${offered.join(', ')}.`);
      const start = Math.max(0, num(args, 'start') ?? playhead.get());
      const rest = compDuration(comp) - start;
      const duration = clamp(num(args, 'duration') ?? (rest > 0.5 ? rest : 10), 0.1, 36000);
      const params = record(args, 'params') ?? {};
      const source: ClipSource = { type: 'html', html: '', title: `${plugin.name}: ${generator?.label ?? name}`, plugin: { id, generator: name, params } };
      const target = trackFor(comp, str(args, 'track'), 'video') ?? aboveTrack(comp, start, start + duration);
      const clip = newClip({ trackId: target.track.id, start, duration, source });
      editComp(comp, () => placeClips(target.comp, [clip], 'overwrite'));
      host.setSelection([clip.id]);
      const note = generator ? '' : ` “${plugin.name}” is not running yet; its page starts in the background to draw the clip.`;
      return done(`${source.title} on ${trackLabel(target.comp, target.track.id)} at ${timecode(start, fps(comp))} for ${duration.toFixed(1)} s.${note}`, { clipId: clip.id });
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

    case 'compose_music': {
      // A bespoke score (src-tauri/src/score.rs): what strong models used to script by hand.
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const mood = (SCORE_MOODS as string[]).includes(str(args, 'mood') ?? '') ? (str(args, 'mood') as ScoreMood) : moodFromText(str(args, 'mood') ?? comp.production?.music?.prompt) ?? 'energetic';
      const length = num(args, 'duration') ?? (compDuration(comp) > 0.5 ? compDuration(comp) : comp.production?.brief?.targetSeconds ?? 30);
      const bpm = num(args, 'bpm') ?? bpmFromText(str(args, 'mood')) ?? bpmFromText(comp.production?.music?.prompt) ?? planBuild([], { mood }).bpm;
      const spec: ScoreSpec = { duration: clamp(length, 2, 600), bpm, mood, ...(num(args, 'root') !== undefined ? { root: num(args, 'root')! } : {}), ...(bool(args, 'minor') !== undefined ? { minor: bool(args, 'minor')! } : {}), drops: numbers(args, 'drops'), noDrop: bool(args, 'noDrop') === true, accents: numbers(args, 'accents'), ...(num(args, 'intensity') !== undefined ? { intensity: clamp(num(args, 'intensity')!, 0, 1) } : {}) };
      let made: { asset: Asset; score: ComposedScore };
      try {
        made = await composeMusicAsset(host, project, commit, spec, str(args, 'name') ?? `${comp.name} ${mood}`);
      } catch (error) {
        return fail(`Could not compose the score: ${errorText(error)}`);
      }
      const { asset, score } = made;
      const phase = comp.production?.phase;
      const gathering = phase === 'planning' || phase === 'plan-ready' || phase === 'gathering' || phase === 'gathered';
      const place = bool(args, 'place') ?? !gathering;
      let placed = '';
      editComp(comp, (current) => {
        let next: Comp = current.production ? { ...current, production: { ...current.production, music: { ...(current.production.music ?? { source: 'generate' as const }), assetId: asset.id, status: 'ready' as const, bpm: score.bpm, beats: score.beats }, updatedAt: Date.now() } } : current;
        if (place) {
          const start = num(args, 'start') ?? 0;
          const laid = placeMusicBed(next, asset.id, start, score.duration, { db: num(args, 'db') ?? -6, name: `${asset.name}` });
          next = laid.comp;
          placed = ` Laid on the timeline from ${start.toFixed(2)} s as the music bed (clip ${laid.clipId}, ${num(args, 'db') ?? -6} dB, faded in and out); its beats are already stored, so snap_cuts_to_beats works without analysis. Balance it under any voice with level_audio.`;
        }
        return next;
      });
      return done(`Composed “${asset.name}” (${score.duration.toFixed(1)} s): ${score.arrangement}.${placed}${!place && comp.production ? ' Attached as the production\'s music.' : ''}`, { assetId: asset.id, bpm: score.bpm, beats: score.beats.slice(0, 64), downbeats: score.downbeats, drops: score.drops, placed: place });
    }

    case 'make_background': {
      // A designed, moving plate (src-tauri/src/plates.rs) instead of flat black under graphics.
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const style = (['glow', 'gradient', 'paper', 'grain'] as const).find((s) => s === str(args, 'style')) ?? 'glow';
      const brand = activeBrandKit(host, project);
      const colors = list(args, 'colors').length ? list(args, 'colors') : brand ? motionBrandFromKit(brand).gradient : [];
      const seconds = num(args, 'duration') ?? Math.max(4, compDuration(comp) || 10);
      let asset: Asset;
      try {
        asset = await plateAsset(host, project, commit, { style, width: comp.width, height: comp.height, seconds: clamp(seconds, 1, 120), fps: Math.round(Math.min(60, comp.fps)), colors }, str(args, 'name') ?? `${comp.name} ${style}`);
      } catch (error) {
        return fail(`Could not render the plate: ${errorText(error)}`);
      }
      const phase = comp.production?.phase;
      const place = bool(args, 'place') ?? !(phase === 'planning' || phase === 'plan-ready' || phase === 'gathering' || phase === 'gathered');
      let clipId: string | null = null;
      if (place) {
        const start = num(args, 'start') ?? 0;
        editComp(comp, (current) => {
          const laid = placePlate(current, asset.id, start, seconds);
          clipId = laid.clipId;
          return laid.comp;
        });
      }
      return done(`Rendered “${asset.name}” (${style}, ${comp.width}×${comp.height}, ${seconds.toFixed(1)} s)${place ? `, laid under everything on V1 (clip ${clipId}). Give full-frame brand templates background "none" so they sit on it` : ' — attach it to a scene with attach_production_asset, or place it later'}.`, { assetId: asset.id, clipId, placed: place });
    }

    case 'build_edit_from_brief': {
      // The guided build: the model writes the words and the feel; code does timing, templates,
      // transitions, sound, music and the background (guidedBuild.ts).
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      // Points sent as one string ("a, b, c") are split, as the template tools do (templateFix.ts).
      const brief = (Array.isArray(args.beats) ? args.beats : []).filter((b): b is BriefBeat => !!b && typeof b === 'object' && typeof (b as BriefBeat).text === 'string' && (b as BriefBeat).text.trim().length > 0)
        .map((b) => (b.points !== undefined && !Array.isArray(b.points) ? { ...b, points: listOf(b.points) } : b));
      if (brief.length < 1 || brief.length > 16) return fail(`Give 1–16 beats, each {text, kind?: ${BEAT_KINDS.join('|')}, kicker?, subtitle?, points?, value?, suffix?, cta?}. One idea per beat, few words.`);
      const genre = str(args, 'genre') ?? inferGenres(project, comp)[0] ?? 'motion';
      const book = playbook(PLAYBOOK_FOR[genre as Genre] ?? genre);
      const moodArg = str(args, 'mood');
      // A reference film's pacing when one is active; otherwise the cut rate the brand kit learned
      // from the user's references (/train) sets how long each beat holds at least.
      const kitForPace = activeBrandKit(host, project);
      const learnedCut = kitForPace ? learnedValue(kitForPace, 'pacing', 'cutEvery') : undefined;
      const learnedPace = typeof learnedCut === 'number' && learnedCut > 0 ? { swapGap: [Math.max(0.8, learnedCut * 0.8), learnedCut * 1.5] as [number, number] } : null;
      const plan = planBuild(brief, { mood: (SCORE_MOODS as string[]).includes(moodArg ?? '') ? (moodArg as ScoreMood) : moodFromText(moodArg ?? comp.production?.music?.prompt), bpm: num(args, 'bpm') ?? bpmFromText(comp.production?.music?.prompt), genre, pacing: book?.pacing ?? learnedPace, targetSeconds: num(args, 'targetSeconds') ?? comp.production?.brief?.targetSeconds ?? null });
      const start = num(args, 'start') ?? 0;
      const video = new Set(tracksOf(comp, 'video').map((t) => t.id));
      const hasPicture = comp.clips.some((clip) => video.has(clip.trackId) && clip.enabled);
      const notes: string[] = [];
      // 1. The graphics: one sequence, every beat a template, transitions with their own sound cues.
      const kitForMotion = activeBrandKit(host, project);
      const motionCtx = { project: host.history.current(), assets, commit, editComp, pickComp, current: () => host.history.current(), setReference: host.setReference, brand: kitForMotion ? motionBrandFromKit(kitForMotion) : null, signal, prompt: turnPrompt(turnId ?? host.turnId) };
      const sequence = await runMotionTool('create_motion_sequence', {
        compId: comp.id, start, title: str(args, 'title') ?? 'Guided build',
        beats: plan.beats.map((beat) => ({ template: beat.template, params: beat.params, hold: beat.hold, name: beat.name })),
        transitions: plan.transitions, sfx: true,
      }, motionCtx);
      if (!sequence.ok) return fail(`The graphics could not be built: ${sequence.error}`);
      const cuts = Array.isArray(sequence.cuts) ? (sequence.cuts as number[]) : [];
      const starts = Array.isArray(sequence.starts) ? (sequence.starts as number[]) : [];
      const live = host.history.current().comps.find((c) => c.id === comp.id) ?? comp;
      const seqClip = live.clips.find((clip) => clip.id === sequence.clipId);
      const length = seqClip ? seqClip.start + seqClip.duration - start : plan.seconds;
      // 2. The music: composed to this length, dropping on the chosen beat, a crash on every cut.
      let musicNote = 'music: skipped';
      if (bool(args, 'music') !== false) {
        const existing = comp.production?.music?.assetId && assets.get(comp.production.music.assetId);
        try {
          let musicId: string;
          let beats: number[] = [];
          if (existing) {
            musicId = existing.id;
            musicNote = `music: the gathered “${existing.name}”`;
          } else {
            const dropAt = plan.dropBeat !== null && starts[plan.dropBeat] !== undefined ? starts[plan.dropBeat] - start : null;
            const made = await composeMusicAsset(host, host.history.current(), commit, { duration: length + 0.5, bpm: plan.bpm, mood: plan.mood, drops: dropAt ? [dropAt] : [], noDrop: dropAt === null, accents: cuts.map((t) => t - start) }, `${comp.name} ${plan.mood}`);
            musicId = made.asset.id;
            beats = made.score.beats;
            musicNote = `music: composed ${made.score.arrangement}`;
          }
          const current = host.history.current().comps.find((c) => c.id === comp.id) ?? comp;
          editComp(current, (c) => {
            const laid = placeMusicBed(c, musicId, start, length + 0.5, { db: hasPicture ? -18 : -6 });
            return laid.comp.production ? { ...laid.comp, production: { ...laid.comp.production, music: { ...(laid.comp.production.music ?? { source: 'generate' as const }), assetId: musicId, status: 'ready' as const, bpm: plan.bpm, ...(beats.length ? { beats } : {}) } } } : laid.comp;
          });
        } catch (error) {
          notes.push(`the music could not be made (${errorText(error)}) — add one with compose_music`);
        }
      }
      // 3. The background: a designed plate when nothing else is under the graphics.
      let plateNote = 'background: over the existing picture';
      if (!hasPicture && bool(args, 'background') !== false) {
        try {
          const colors = kitForMotion ? motionBrandFromKit(kitForMotion).gradient : [];
          const asset = await plateAsset(host, host.history.current(), commit, { style: plan.plate, width: comp.width, height: comp.height, seconds: clamp(length + 0.5, 1, 120), fps: Math.round(Math.min(60, comp.fps)), colors }, `${comp.name} ${plan.plate}`);
          const current = host.history.current().comps.find((c) => c.id === comp.id) ?? comp;
          editComp(current, (c) => placePlate(c, asset.id, start, length + 0.5).comp);
          plateNote = `background: a ${plan.plate} plate`;
        } catch (error) {
          notes.push(`the background plate could not be rendered (${errorText(error)}) — run fill_background`);
        }
      }
      // 4. The plan, as a storyboard, so the edit is held to it.
      const board: NonNullable<Comp['storyboard']> = plan.beats.map((beat, i) => ({
        start: starts[i] ?? start, end: cuts[i] ?? (starts[i + 1] ?? start + length), title: beat.name, intent: brief[i].text, visual: `${beat.template} on the ${plan.plate} plate`, audio: `${plan.mood} score${plan.dropBeat === i ? ', drop' : ''}`, evidence: 'guided build',
        mogrt: { template: beat.template, headline: brief[i].text, durationSeconds: beat.hold }, transition: i > 0 ? { kind: plan.transitions[i - 1], onBeat: true } : null,
      }));
      const after = host.history.current().comps.find((c) => c.id === comp.id) ?? comp;
      editComp(after, (c) => ({ ...c, storyboard: board }));
      const table = plan.beats.map((beat, i) => `${i + 1}. ${(starts[i] ?? 0).toFixed(2)}s ${beat.template} “${beat.name}” holds ${beat.hold.toFixed(2)}s${i > 0 ? ` (in: ${plan.transitions[i - 1]})` : ''}`).join('\n');
      return done(`Built the edit from ${brief.length} beats (${length.toFixed(1)} s, ${plan.mood} at ${plan.bpm} BPM${plan.dropBeat !== null ? `, drop on beat ${plan.dropBeat + 1}` : ''}):\n${table}\n${musicNote}; ${plateNote}.${notes.length ? ` Not done: ${notes.join('; ')}.` : ''} Next: run_frame_qa, fix what it lists (change a beat's words with update_motion_scene patches or rebuild with new beats), then judge_edit and verify_edit_workflow.`, { clipId: sequence.clipId, compId: sequence.compId, starts, cuts, mood: plan.mood, bpm: plan.bpm, seconds: length });
    }

    case 'finish_gathering': {
      const comp = pickComp(project, args);
      if (!comp?.production) return fail('No production plan on this comp.');
      if (comp.production.phase !== 'gathering') return fail(`The production is in the ${comp.production.phase} phase; finish_gathering only closes the gathering phase.`);
      // Nothing the plan needs is left empty: missing music gets a composed score and missing
      // pictures a designed plate, made here, before the gate counts what is missing.
      const filled = await fillMissingWithBuiltins(host, project, commit, comp);
      const report = gatherReport(filled.length ? host.history.current().comps.find((c) => c.id === comp.id) ?? comp : comp);
      const force = bool(args, 'acceptMissing') === true;
      if (report.missing.length && !force) return fail(`${report.missing.length} planned shot(s) still have no asset: ${report.missing.slice(0, 8).join('; ')}. Generate or download them (pass sceneIndex so they attach), retry a failed one with a simpler prompt, or — only if the user agrees — call again with acceptMissing: true and say what was dropped.`);
      const jobs = await api.jobsList();
      const running = jobs.filter((job) => job.status === 'running' && (job.kind === 'generation' || job.kind === 'media' || job.kind === 'speech'));
      if (running.length) return fail(`${running.length} generation job(s) are still running (${running.map((job) => job.label).join(', ')}). Wait for them (generation_job / import_generated_media), then finish.`);
      editComp(comp, current => ({ ...current, production: current.production ? { ...advance(current.production, 'gathered'), updatedAt: Date.now() } : current.production }));
      return done(`Gathering finished: ${report.ready}/${report.total} shots ready${report.missing.length ? `, ${report.missing.length} dropped` : ''}.${filled.length ? ` Filled by Bhippi: ${filled.join('; ')}.` : ''} END YOUR TURN now with a short list of what was gathered (asset names per scene, voice-over, music). The user presses Start editing.`, { ready: report.ready, total: report.total, dropped: report.missing });
    }

    case 'run_frame_qa': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const duration = compDuration(comp);
      if (duration <= 0) return fail('The timeline is empty; nothing to check.');
      // The range under review: the whole timeline, the in/out selection, or explicit start/end.
      const selection = bool(args, 'selection') === true && comp.inPoint !== null && comp.outPoint !== null && comp.outPoint > comp.inPoint;
      const from = clamp(num(args, 'start') ?? (selection ? comp.inPoint! : 0), 0, Math.max(0, duration - 1 / fps(comp)));
      const to = clamp(num(args, 'end') ?? (selection ? comp.outPoint! : duration), from + 1 / fps(comp), duration);
      const step = clamp(num(args, 'step') ?? 1.5, 0.25, 10);
      const sampled = Array.isArray(args.times)
        ? (args.times as unknown[]).filter((t): t is number => typeof t === 'number' && t >= 0 && t < duration)
        : qaTimes(comp, duration, step, 1000).filter((t) => t >= from && t < to);
      const times = sampled.length > 48 ? sampled.filter((_, i) => i % Math.ceil(sampled.length / 48) === 0) : sampled;
      if (!times.length) return fail('Nothing to sample in that range.');
      const layers = await collectQaLayers(project, assets, comp, times, { rotoSubjects: async (runId) => (await api.rotoRead(runId))?.subjects ?? null });
      const issues: QaIssue[] = frameQa(comp, layers, times);
      // Black edges: a reduced or moved picture with nothing behind it.
      for (const span of uncoveredSpans(project, assets, comp, from, to)) {
        issues.push({ at: span.start, a: 'frame edges', b: 'nothing behind', kind: 'black-edges', overlap: 1, suggestion: `Black at the frame edges ${timecode(span.start, fps(comp))}–${timecode(span.end, fps(comp))}: fill_background {"start":${span.start.toFixed(2)},"end":${span.end.toFixed(2)}} or put a designed plate on V1.` });
      }
      // Rendered frames — motion scenes and HTML graphics drawn in, as the export draws them — for
      // the blank-frame check and for the model's own eyes.
      const frameCount = Math.round(clamp(num(args, 'frames') ?? 12, 0, 24));
      // Asked-for moments are the frames rendered; otherwise frames spread over the range.
      const asked = Array.isArray(args.times) ? times.slice(0, frameCount) : null;
      const spread = asked ?? Array.from({ length: frameCount }, (_, i) => Math.round((from + ((i + 0.5) * (to - from)) / Math.max(1, frameCount)) * 100) / 100);
      const firstIssues = [...new Set(issues.map((issue) => issue.at))].slice(0, 4);
      const stillTimes = [...new Set([...firstIssues, ...spread])].filter((t) => t >= 0 && t < duration).sort((x, y) => x - y);
      let images: string[] = [];
      let frameTimes: number[] = [];
      let renderNote = '';
      // Each rendered frame in words, for a model that cannot see images (text-protocol CLIs).
      const frameNotes: string[] = [];
      if (stillTimes.length) {
        const shots: { at: number; path: string }[] = [];
        try {
          const dir = await api.mogrtFramesBegin('qa');
          // Captions as the export draws them (the WatchFIWN look), so QA checks what ships.
          // Loaded here, not with the tool catalogue: the caption renderer is only needed for QA.
          const { renderFiwnCaptionsForExport } = await import('./fiwn/export');
          const prepared = await renderFiwnCaptionsForExport(await renderHtmlStill(await renderMotionStill(project, comp.id, stillTimes, [...assets.values()]), comp.id, stillTimes), comp.id, { times: stillTimes });
          for (const [i, t] of stillTimes.entries()) {
            const path = await api.exportFrame(prepared, comp.id, t, `${dir}/qa-${String(i).padStart(2, '0')}.png`, 540);
            shots.push({ at: t, path });
            const stats = await frameStats(path);
            const blank = stats ? blankFinding(stats) : null;
            const onScreen = [...new Set(layers.filter((layer) => layer.kind !== 'subject' && t >= layer.from && t < layer.to).map((layer) => `${layer.kind} "${layer.name}"`))];
            frameNotes.push(`${timecode(t, fps(comp))}: ${stats ? `${Math.round(stats.mean * 100)}% bright, ${Math.round(stats.flat * 100)}% one flat tone` : 'not measured'}; on screen: ${onScreen.slice(0, 6).join(', ') || 'footage only'}${blank ? ` — ${blank.what}` : ''}.`);
            if (blank) issues.push({ at: t, a: 'the frame', b: 'picture', kind: 'blank-frame', overlap: blank.share, suggestion: `${blank.what}. Put a designed background under it (a generated gradient plate on V1, or fill_background), give full-frame brand templates background "none" over that plate, and keep light full-frame stages off the timeline.` });
            // The Editor reads the type on the rendered frame: words that melt into what is behind them.
            const words = layers.filter((layer) => (layer.kind === 'text' || layer.kind === 'caption') && t >= layer.from && t < layer.to && layer.box.width > 0.03);
            const ratios = words.length ? await boxContrast(path, words.map((layer) => layer.box)) : [];
            for (const [k, ratio] of ratios.entries()) {
              if (ratio !== null && ratio < MIN_TEXT_CONTRAST) issues.push({ at: t, a: words[k].name, b: 'its background', kind: 'low-contrast', overlap: 1 - ratio / MIN_TEXT_CONTRAST, suggestion: `"${words[k].name}" is hard to read over what is behind it (contrast ${ratio.toFixed(1)}:1). Change its colour to the opposite of the background, add a stroke or shadow, or put a darker/lighter plate behind it.` });
            }
          }
        } catch (error) {
          renderNote = ` Contact frames could not be rendered (${errorText(error)}), so blank frames were not checked.`;
        }
        if (shots.length && bool(args, 'images') !== false) {
          // At most four attached: the first two problem moments, then evenly spread stills.
          const problemTimes = [...new Set(issues.map((issue) => issue.at))].filter((t) => shots.some((shot) => shot.at === t)).slice(0, 2);
          const spreadShots = shots.filter((_, i) => i % Math.max(1, Math.ceil(shots.length / 4)) === 0).map((shot) => shot.at);
          const wanted = [...new Set([...problemTimes, ...spreadShots])].slice(0, 4);
          const picked = shots.filter((shot) => wanted.includes(shot.at));
          try {
            images = await api.chatReadImages(picked.map((shot) => shot.path));
            frameTimes = picked.map((shot) => shot.at);
          } catch (error) {
            renderNote += ` Contact frames were rendered and checked for blanks but could not be attached (${errorText(error)}).`;
          }
        }
      }
      const order: Record<QaIssue['kind'], number> = { 'blank-frame': 0, 'black-edges': 1, 'covers-subject': 2, 'off-frame': 3, 'low-contrast': 4, 'caption-collision': 5, 'small-text': 6, 'graphic-overlap': 7, 'outside-safe': 8 };
      issues.sort((x, y) => order[x.kind] - order[y.kind] || x.at - y.at);
      // One line per problem, not per sampled frame: the same card off the frame for ten samples is one fix.
      const grouped = new Map<string, { issue: QaIssue; from: number; to: number; count: number }>();
      for (const issue of issues) {
        const key = `${issue.kind}|${issue.a}|${issue.b}`;
        const known = grouped.get(key);
        if (known) { known.from = Math.min(known.from, issue.at); known.to = Math.max(known.to, issue.at); known.count++; } else grouped.set(key, { issue, from: issue.at, to: issue.at, count: 1 });
      }
      const problems = [...grouped.values()];
      const hasSubject = layers.some((l) => l.kind === 'subject');
      if (comp.production) editComp(comp, current => ({ ...current, production: current.production ? { ...(current.production.phase === 'editing' ? advance(current.production, 'polishing') : current.production), qa: { at: Date.now(), sampled: times.length, issues: problems.length, clear: problems.length === 0 }, updatedAt: Date.now() } : current.production }));
      const where = `${timecode(from, fps(comp))}–${timecode(to, fps(comp))}${selection ? ' (the in/out selection)' : ''}`;
      // Pacing against the genre's measured timing (advice: it never blocks the QA gate).
      const genreBook = typeof args.genre === 'string' ? playbook(args.genre) : null;
      const pacing = pacingReport(project, comp, genreBook?.pacing ?? GENERIC_TARGET);
      const lines = problems.slice(0, 16).map(({ issue, from: first, to: last, count }) => `${timecode(first, fps(comp))}${last > first ? `–${timecode(last, fps(comp))}` : ''} ${issue.kind}: "${issue.a}"${issue.b ? ` vs "${issue.b}"` : ''}${count > 1 ? ` (${count} samples)` : ''}. ${issue.suggestion}`);
      return done(problems.length
        ? `Frame QA over ${where} sampled ${times.length} moments and rendered ${stillTimes.length} frames: ${problems.length} problem(s). Fix every one, then run it again until it is clear; an intended design (a title set behind the subject, a reveal) is instead waived in verify_edit_workflow's acceptedQaIssues with a reason.${hasSubject ? '' : ' No subject track was available (rotoscope_clip gives one), so subject coverage was not checked.'}${renderNote}\n${lines.join('\n')}\n${pacing.summary}`
        : `Frame QA over ${where} sampled ${times.length} moments and rendered ${stillTimes.length} frames: nothing off the frame or outside the safe area, no overlaps, no blank or black-edged frames.${hasSubject ? '' : ' (No subject track — rotoscope_clip a speaker clip for subject-aware checks.)'}${renderNote}${images.length ? ' Look at the contact frames for what geometry cannot judge (contrast, reading time, taste), then' : ' Then'} verify_edit_workflow. ${pacing.summary}`,
        { pacing: pacing.checks, issues: problems.map(({ issue, from: first, to: last, count }) => ({ ...issue, at: first, until: last, samples: count })), sampled: times.length, range: { start: from, end: to }, times: frameTimes, images, frameNotes, layers: layers.filter((l) => l.kind !== 'subject').length, subjectTracked: hasSubject });
    }

    case 'capture_app_session': {
      // The real product, alive: a short scripted session in a headless browser, each named part
      // captured in each state at 3x (app_capture.rs, appCapture.ts). Without a url it captures
      // Bhippi itself, from your real app state; `@composer`-style names stand for its parts.
      const { steps, problems } = parseSteps(args.steps);
      if (problems.length) return fail(`Fix the session steps: ${problems.slice(0, 6).join('; ')}.`);
      if (!steps.some((step) => step.do === 'capture' || (step.do === 'type' && step.part))) return fail('The session captures nothing: add capture steps ({do:"capture", part, selector, state}) or a type step with a part.');
      const url = str(args, 'url');
      const name = str(args, 'name') ?? (url ? url.replace(/^https?:\/\//, '').split('/')[0] : 'bhippi');
      const base = { url, name, width: num(args, 'width'), height: num(args, 'height'), scale: num(args, 'scale'), ready: str(args, 'ready') ? resolveSelector(str(args, 'ready')!) : undefined, transparent: bool(args, 'transparent'), steps };
      const info = await api.appInfo().catch(() => null);
      try {
        const manifest = await api.appSessionCapture({
          ...base,
          ...(bool(args, 'reuse') === false ? {} : { key: captureKey(base, info?.version ?? '') }),
          ...(url ? {} : { standin: standinSource(await bhippiAnswers(project, [...assets.values()])) }),
        });
        const rows = sheetParts(manifest);
        const sheet = rows.length ? await contactSheet(rows.map((row) => row.map((part) => ({ path: `${manifest.dir}/${part.file}`, label: `${part.part} · ${part.state} · ${part.pixels[0]}x${part.pixels[1]}` })))) : null;
        const partNames = [...new Set(manifest.parts.map((part) => part.part))];
        return done(
          `Captured ${manifest.parts.length} picture(s) of ${partNames.length} part(s) (${partNames.slice(0, 8).join(', ')}) at ${manifest.scale}x into ${manifest.dir}.${manifest.issues.length ? ` Check: ${manifest.issues.slice(0, 5).join('; ')}.` : ' Every part came out at full resolution and every font loaded.'} Each state is its own picture (part__state.png, with its box in manifest.json): import the ones a shot needs, or swap states on the frame a click lands.`,
          { dir: manifest.dir, url: manifest.url, scale: manifest.scale, parts: manifest.parts, issues: manifest.issues, images: sheet && bool(args, 'images') !== false ? [sheet] : [] },
        );
      } catch (error) { return fail(errorText(error)); }
    }

    case 'review_frames': {
      // The render → look → fix loop the best films were made in: frames at the moments something
      // happens and strips across the joins, tiled into contact sheets, plus the numbers the
      // critics measured by hand (reviewFrames.ts). It changes nothing.
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const duration = compDuration(comp);
      if (duration <= 0) return fail('The timeline is empty; nothing to review.');
      const from = clamp(num(args, 'start') ?? 0, 0, Math.max(0, duration - 1 / fps(comp)));
      const to = clamp(num(args, 'end') ?? duration, from + 1 / fps(comp), duration);
      const at = str(args, 'at') ?? 'both';
      const asked = Array.isArray(args.times) ? (args.times as unknown[]).filter((t): t is number => typeof t === 'number' && t >= from && t < to) : [];
      const events: Moment[] = asked.length
        ? asked.slice(0, 24).map((t) => ({ at: Math.round(t * 100) / 100, why: 'asked' }))
        : at === 'joins' ? [] : eventMoments(project, comp, from, to, clamp(num(args, 'limit') ?? 18, 4, 24));
      const strips = asked.length || at === 'events' ? [] : joinStrips(comp, from, to, clamp(num(args, 'joins') ?? 3, 1, 6));
      const moments = [...events, ...strips.flat()];
      if (!moments.length) return fail('Nothing to look at in that range: no cuts, graphics or cues. Pass times:[seconds] to choose the moments.');
      const times = [...new Set(moments.map((moment) => moment.at))].sort((a, b) => a - b);
      const layers = await collectQaLayers(project, assets, comp, times, { rotoSubjects: async (runId) => (await api.rotoRead(runId))?.subjects ?? null });
      const findings: Finding[] = [];
      let renderNote = '';
      // Geometry the frame check already measures (reading size, off-frame, overlaps), from the same layers.
      const geometry = frameQa(comp, layers, times).filter((issue) => issue.kind === 'small-text' || issue.kind === 'off-frame' || issue.kind === 'caption-collision');
      findings.push(...repeatedPhrases(layers, times));
      // Beats, when the music is known, against the picture's cuts.
      const musicClip = comp.clips.find((clip) => clip.enabled && clip.source.type === 'media' && (clip.source.assetId === comp.production?.music?.assetId || clip.audioType === 'music'));
      const beats = musicClip && comp.production?.music?.beats?.length ? comp.production.music.beats.map((beat) => timelineOf(musicClip, beat)).filter((t): t is number => t !== null) : [];
      findings.push(...offBeatCuts(cutTimes(comp, from, to), beats));
      // Sound cues against the music at their moment, from the waveform levels Bhippi keeps, on
      // the same scale sound_the_motion sets them by (cueSound.ts): each one's loudest 10 ms.
      const beds: MusicBed[] = [];
      for (const clip of comp.clips) {
        const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
        if (!asset?.peaks || !isMusicClip(comp, clip, asset.name)) continue;
        const peaks = await loadPeaks(asset.peaks);
        if (peaks) beds.push({ clip, peaks });
      }
      if (beds.length) {
        const cues: CueLevel[] = [];
        for (const clip of comp.clips) {
          if (!clip.enabled || clip.start < from || clip.start >= to) continue;
          if (clip.source.type !== 'sfx' && clip.audioType !== 'sfx') continue;
          let db: number | null = null;
          if (clip.source.type === 'media') {
            const asset = assets.get(clip.source.assetId);
            const peaks = asset?.peaks ? await loadPeaks(asset.peaks) : null;
            if (peaks) db = loudestDb(peaks, clip.in, clip.in + Math.min(0.4, clip.duration) * clip.speed);
          } else if (clip.source.type === 'sfx') {
            db = builtInLoudestDb(clip.source.kind);
          }
          if (db !== null) cues.push({ at: clip.start, name: clip.name ?? (clip.source.type === 'sfx' ? clip.source.kind : 'sound'), db: db + gainToDb(clip.volume) });
        }
        findings.push(...quietCues(cues, (t) => musicDbOver(beds, t, t + 0.3)));
      }
      // The final mix as the export renders it: about −16 LUFS integrated, peaks under −1 dBTP.
      if (args.mix !== false && comp.clips.some((clip) => clip.enabled && comp.tracks.some((track) => track.id === clip.trackId && track.kind === 'audio'))) {
        try {
          findings.push(...mixFindings(await api.mixLoudness(project, comp.id)));
        } catch (error) {
          renderNote += ` The mix could not be measured (${errorText(error)}).`;
        }
      }
      const end = shortEnd(project, comp, duration);
      if (end) findings.push(end);

      // The frames, rendered as the export draws them, then tiled: events in rows of six, each join its own row.
      const shots = new Map<number, string>();
      try {
        const dir = await api.mogrtFramesBegin('review');
        const { renderFiwnCaptionsForExport } = await import('./fiwn/export');
        const prepared = await renderFiwnCaptionsForExport(await renderHtmlStill(await renderMotionStill(project, comp.id, times, [...assets.values()]), comp.id, times), comp.id, { times });
        for (const [i, t] of times.entries()) {
          const path = await api.exportFrame(prepared, comp.id, t, `${dir}/review-${String(i).padStart(2, '0')}.png`, 360);
          shots.set(t, path);
          const stats = await frameStats(path);
          const dark = stats ? darkFinding(t, stats.mean) : null;
          if (dark) findings.push(dark);
        }
      } catch (error) {
        renderNote += ` Frames could not be rendered (${errorText(error)}), so only the measured checks ran.`;
      }
      const label = (moment: Moment) => `${timecode(moment.at, fps(comp))} ${moment.why}`;
      const rowsOf = (list: Moment[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
      const toRow = (row: Moment[]) => row.filter((moment) => shots.has(moment.at)).map((moment) => ({ path: shots.get(moment.at)!, label: label(moment) }));
      const sheets = [
        events.length ? await contactSheet(rowsOf(events, 6).map(toRow).filter((row) => row.length)) : null,
        strips.length ? await contactSheet(strips.map(toRow).filter((row) => row.length)) : null,
      ].filter((sheet): sheet is string => !!sheet);
      const images = bool(args, 'images') === false ? [] : sheets;
      // One line per darkness run, not per frame.
      const darks = findings.filter((finding) => finding.kind === 'dark');
      const measured = [...findings.filter((finding) => finding.kind !== 'dark'), ...(darks.length ? [{ ...darks[0], what: `${darks.length} of ${shots.size} frame(s) are murky-dark (first at ${timecode(darks[0].at!, fps(comp))}: ${darks[0].what})` }] : [])];
      const lines = [
        ...measured.map((finding) => `${finding.at !== null ? `${timecode(finding.at, fps(comp))} ` : ''}${finding.kind}: ${finding.what}. Fix: ${finding.fix}.`),
        ...geometry.slice(0, 8).map((issue) => `${timecode(issue.at, fps(comp))} ${issue.kind}: "${issue.a}". ${issue.suggestion}`),
      ];
      return done(
        `Reviewed ${timecode(from, fps(comp))}–${timecode(to, fps(comp))}: ${events.length} moment(s)${strips.length ? ` and ${strips.length} join strip(s) of ${strips[0].length} frames ${Math.round(JOIN_STEP * 1000)} ms apart` : ''}, in ${sheets.length} contact sheet(s).${renderNote} ${lines.length ? `${lines.length} thing(s) to fix:\n${lines.join('\n')}` : 'Nothing measured is off: no murky frames, doubled phrases, off-beat cuts, buried cues, rushed end card or a mix off −16 LUFS / −1 dBTP.'}\nNow look at the sheets for what numbers cannot judge (does each moment read, do the joins flow, is it premium), fix, and review again.`,
        { moments: moments.map((moment) => ({ at: moment.at, why: moment.why })), findings: measured, geometry: geometry.slice(0, 12), images, range: { start: from, end: to } },
      );
    }

    case 'propose_storyboards': {
      // The Director's debate: three capped proposers in parallel, then critique and a vote.
      const brief = str(args, 'brief');
      if (!brief) return fail('Give the brief: what the video is, for whom, and what it must achieve.');
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const duration = num(args, 'seconds') ?? compDuration(comp);
      if (!(duration > 0)) return fail('Give seconds (the planned length): the timeline is empty.');
      const parentTurnId = turnId ?? host.turnId ?? '';
      // What was said, in timeline seconds, so no proposer spends a round transcribing.
      const speech = comp.clips.filter((clip) => clip.enabled && clip.source.type === 'media' && assets.get(clip.source.assetId)?.kind !== 'image');
      let timed = '';
      const wordStarts: number[] = [];
      try {
        const cached = await api.transcriptsCached(speech.map((clip) => (clip.source as { assetId: string }).assetId));
        for (const transcript of cached) {
          const clip = speech.find((c) => (c.source as { assetId: string }).assetId === transcript.assetId);
          if (!clip) continue;
          const at = (t: number) => clip.start + (t - clip.in) / (clip.speed || 1);
          const words = transcript.words.filter((w) => at(w.start) >= clip.start && at(w.start) < clip.start + clip.duration);
          wordStarts.push(...words.map((w) => Math.round(at(w.start) * 100) / 100));
          timed += words.map((w) => `${at(w.start).toFixed(2)} ${w.text}`).join(' ') + '\n';
        }
      } catch {
        // No cached transcript: the proposers plan from the brief alone.
      }
      const set = routeTools(brief);
      const book = set.playbook;
      const templates = MOTION_TEMPLATES.map((spec) => `${spec.id} (${spec.seconds}s)`).join(', ');
      const task = [
        `Propose a storyboard for this video. Brief: ${brief}`,
        `Frame ${comp.width}x${comp.height}, ${duration.toFixed(1)} s long, kinds: ${set.genres.join(', ')}.`,
        timed ? `The voice-over, "<timeline seconds> <word>":\n${timed.slice(0, 6000)}` : 'No voice-over is transcribed yet.',
        book ? `Plan from this playbook (${book.title}): beats ${JSON.stringify(book.beats)}; timing ${JSON.stringify(book.timing)}; rules ${JSON.stringify(book.rules)}.` : '',
        `Motion templates you may name as mogrt: ${templates}.`,
        'Reply with ONLY a JSON object {"scenes":[…]} and nothing else. Each scene: start, end (timeline seconds, 3–12 s beats covering the whole length with no gaps), title (2–5 words), intent (≥20 chars), visual (≥120 chars: exactly what is on screen and what MOVES), audio (≥40 chars: music and the named sound effects), evidence (the quoted spoken line it illustrates, or the frame observation), mogrt ({"template":"<id>"} or null), transition.',
        'Do not call any tool that changes the project. At most one or two reads (list_characters, motion_guide) if you truly need them.',
      ].filter(Boolean).join('\n\n');
      const context = { toolset: { genres: set.genres, full: ['tool_help', 'get_comp', 'list_characters', 'motion_guide', 'list_motion_templates'] }, project: { name: project.name, comp: comp.name, size: `${comp.width}x${comp.height}`, seconds: duration } };
      let spawned: { angle: string; id: string }[];
      try {
        spawned = await Promise.all(ANGLES.map(async (angle) => ({
          angle: angle.id,
          id: (await api.chatSpawnSubagent({ parentTurnId, task, label: `Director · ${angle.id}`, maxRounds: 4, persona: angle.persona, context })).subagentId,
        })));
      } catch (error) {
        return fail(`The proposers could not start: ${errorText(error)}. Plan the storyboard yourself.`);
      }
      const replies = await Promise.all(spawned.map(async ({ angle, id }) => {
        try {
          const res = await api.chatWaitSubagent(id);
          return parseProposal(res.result ?? '', angle);
        } catch {
          return null;
        }
      }));
      const proposals = replies.filter((p): p is NonNullable<typeof p> => !!p);
      if (!proposals.length) return fail('No proposer returned a usable storyboard. Plan it yourself from the playbook.');
      const result = debate(proposals, duration, wordStarts);
      const won = proposals[result.winner];
      const lines = proposals.map((p, i) => `${i === result.winner ? '★' : '·'} ${p.angle}: ${result.tally[i]} vote(s); ${result.critiques.filter((c) => c.proposal === i).map((c) => `${c.seat} ${Math.round(c.score * 100)} (${c.notes.join('; ')})`).join(' | ')}`);
      return done(`The debate: ${proposals.length} storyboard(s) proposed in parallel, critiqued by the Director, Animator and Story seats; "${won.angle}" wins ${result.tally[result.winner]} of 3 votes.\n${lines.join('\n')}\nSave the winning scenes with save_storyboard (fix any beat a seat called thin first; borrow a stronger beat from another proposal if a seat praised it).`, {
        winner: won.angle, scenes: won.scenes, votes: result.votes, tally: result.tally, critiques: result.critiques,
        others: proposals.filter((_, i) => i !== result.winner).map((p) => ({ angle: p.angle, scenes: p.scenes.map((s) => ({ start: s.start, end: s.end, title: s.title, intent: s.intent })) })),
      });
    }

    case 'judge_edit': {
      const comp = pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      // The Editor looks first: a fresh frame pass, whose contact frames the Judge hands on.
      const frames = await runToolInner(host, 'run_frame_qa', { ...(args.compId ? { compId: args.compId } : {}), frames: num(args, 'frames') ?? 8 }, signal, turnId);
      const after = host.history.current();
      const judged = after.comps.find((c) => c.id === comp.id) ?? comp;
      const asked = Array.isArray(args.genres) ? (args.genres as unknown[]).filter((g): g is Genre => typeof g === 'string' && g in GENRE_TOOLS) : [];
      const genres = asked.length ? asked : inferGenres(after, judged);
      await primeMemeCache(judged);
      const council = councilReview(after, assets, judged, undefined, { meme: memeLookup });
      // The final mix as the export renders it (reviewFrames.ts): off −16 LUFS or over −1 dBTP is a fix for the audio seat.
      let mixNotes: CouncilNote[] = [];
      try {
        mixNotes = mixFindings(await api.mixLoudness(after, judged.id)).map((finding) => ({ member: 'audio', severity: 'fix', text: `${finding.what.charAt(0).toUpperCase()}${finding.what.slice(1)}.`, fix: finding.fix }));
      } catch {
        // A mix that cannot be measured (no sound, no FFmpeg) is scored on the rest; review_frames says why.
      }
      const review = { ...council, notes: [...council.notes, ...mixNotes] };
      const book = playbook(PLAYBOOK_FOR[genres[0]]);
      const pacing = pacingReport(after, judged, book?.pacing ?? GENERIC_TARGET);
      const issues = frames.ok && Array.isArray(frames.issues) ? (frames.issues as { kind: string; a: string; suggestion?: string }[]) : [];
      const verdict = judge({ project: after, comp: judged, review, pacing, qa: { ran: frames.ok, issues }, genres });
      const round = (judged.production?.judge?.round ?? 0) + 1;
      if (judged.production) editComp(judged, (current) => ({ ...current, production: current.production ? { ...current.production, judge: { at: Date.now(), score: verdict.score, pass: verdict.pass, round }, updatedAt: Date.now() } : current.production }));
      const table = verdict.criteria.map((c) => `${c.label}: ${Math.round(c.score * c.weight)}/${c.weight}`).join('; ');
      const next = verdict.pass
        ? 'The Judge passes it. Look at the contact frames once for taste, then verify_edit_workflow.'
        : round >= JUDGE_ROUNDS
          ? `Round ${round} of ${JUDGE_ROUNDS}: the Token Council stops the loop here. Fix what you can cheaply, verify, and tell the user the score and what is still weak.`
          : `Below ${PASS_MARK}. Director: fix these in order (only the beats named), then judge_edit again (round ${round + 1} of ${JUDGE_ROUNDS}).`;
      return done(`Judge: ${verdict.score}/100 for a ${genres.join(' + ')} video (pass mark ${PASS_MARK}). ${table}.\n${verdict.fixes.map((fix) => `- ${fix}`).join('\n')}\n${next}`, {
        score: verdict.score, pass: verdict.pass, round, criteria: verdict.criteria, fixes: verdict.fixes, genres,
        issues, images: frames.ok ? frames.images : [], times: frames.ok ? frames.times : [], frameNotes: frames.ok ? frames.frameNotes : [],
      });
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
        ? portraitSlots(clip, comp, assets)
        // Every slot rests inside the 5% safe area; the 55% slots leave a 3% gutter and a 35% column for the side panel.
        : { 'left-55': { scale: 52, x: -0.19, y: 0 }, 'right-55': { scale: 52, x: 0.19, y: 0 }, 'top-55': { scale: 52, x: -0.19, y: 0 }, 'bottom-55': { scale: 52, x: 0.19, y: 0 }, 'pip-bottom-right': { scale: 30, x: 0.3, y: 0.29 }, 'pip-bottom-left': { scale: 30, x: -0.3, y: 0.29 }, 'pip-top-right': { scale: 30, x: 0.3, y: -0.29 }, 'pip-top-left': { scale: 30, x: -0.3, y: -0.29 }, 'centre-small': { scale: 72, x: 0, y: 0 }, full: { scale: 100, x: 0, y: 0 } };
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
      const moved = `${clip.name ?? clip.id} reframed to ${slot} (scale ${target.scale}%)${animate ? ` with a ${moveSeconds}s ease-out move at ${timecode(clip.start + at, fps(comp))}${back !== null ? ` returning at ${timecode(clip.start + back, fps(comp))}` : ''}` : ''}.`;
      if (portrait) {
        // A tall frame stacks: the picture takes the top or the bottom, and the other half is free.
        const free = slot === 'full' ? 'none' : slot === 'centre-small' ? 'centre' : target.y < 0 ? 'bottom' : 'top';
        const freeNote = free === 'top' || free === 'bottom' ? ` The ${free} of the frame is free for a teaching-card or panel.` : '';
        return done(`${moved}${freeNote}`, { clipId: clip.id, slot, transform: target, freeSide: free });
      }
      const free = slot.startsWith('left') || slot.endsWith('left') ? 'right' : slot.startsWith('right') || slot.endsWith('right') ? 'left' : 'centre';
      return done(`${moved} The ${free} side is free for a side-panel / teaching-card (layout side-panel-${free === 'centre' ? 'right' : free}).`, { clipId: clip.id, slot, transform: target, freeSide: free });
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

    case 'analyze_song': {
      // One call for everything a film cut to a song needs: beats, bars, phrases, drops, hits, the
      // user's lyrics with a time for every word (songMap.ts), sections and cut points. Every
      // premium film so far built this by hand; here any model gets it in one call.
      const comp = pickComp(project, args);
      let asset: Asset | undefined;
      const clipRef = str(args, 'clipId');
      if (clipRef) {
        const found = findClipIn(project, clipRef);
        if (found?.clip.source.type === 'media') asset = assets.get(found.clip.source.assetId);
      }
      if (!asset && str(args, 'assetId')) asset = assets.get(str(args, 'assetId') ?? '');
      if (!asset && comp?.production?.music?.assetId) asset = assets.get(comp.production.music.assetId);
      if (!asset) return fail('Give the song assetId or clipId (or attach the music to the plan first).');
      if (!asset.peaks) return fail(`${asset.name} has no waveform analysis yet; wait for its import to finish, then retry.`);
      const peaks = await loadPeaks(asset.peaks);
      if (!peaks) return fail('The waveform data could not be read.');
      const analysis = detectBeats(peaks, { minBpm: num(args, 'minBpm'), maxBpm: num(args, 'maxBpm') });
      const structure = musicStructure(peaks, analysis, 0);
      const lyrics = str(args, 'lyrics')?.trim() || null;
      let heard: HeardWord[] = [];
      let hearing = '';
      if (bool(args, 'transcribe') ?? true) {
        try {
          const transcript = await api.transcribeAsset(asset.id, str(args, 'language') ?? 'auto', bool(args, 'vocal') ?? true);
          heard = transcript.words.map((word) => ({ text: word.text, start: word.start, end: word.end }));
        } catch (error) {
          hearing = ` No transcript (${errorText(error)}), so ${lyrics ? 'the lyrics are spread over the song by length only; treat word times as rough' : 'there are no words'}.`;
        }
      }
      const map = buildSongMap(peaks, analysis, structure, lyrics, heard, analysis.duration);
      if (comp?.production && (!comp.production.music?.assetId || comp.production.music.assetId === asset.id)) {
        editComp(comp, current => ({ ...current, production: current.production ? { ...current.production, music: { ...(current.production.music ?? { source: 'existing' as const }), assetId: asset!.id, status: 'ready', bpm: analysis.bpm, beats: analysis.beats.slice(0, 4000) }, updatedAt: Date.now() } : current.production }));
      }
      // Kept as a research note, so a later turn reads the map instead of analysing the song again.
      const note = await api.projectDocWrite('research', `Song map - ${asset.name}`, songMapMarkdown(asset.name, map)).catch(() => null);
      const placed = map.lines.reduce((count, line) => count + line.words.filter((word) => !word.heard).length, 0);
      return done(
        `${asset.name}: ${map.bpm} BPM, ${map.bars.length} bars, ${map.sections.length} section(s), ${map.lines.length} line(s)${lyrics ? `, ${Math.round(map.heardShare * 100)}% of the lyric heard (${placed} word(s) placed between heard ones)` : ''}, ${map.drops.length} drop(s), ${map.hits.length} hits, ${map.cuts.length} cut points.${hearing} Times are source seconds of the song: land each word's graphic on its time, cut on \`cuts\`, accent \`hits\`.${note ? ` The full map is saved as ${note}.` : ''}`,
        {
          assetId: asset.id, bpm: map.bpm, heardShare: map.heardShare, sections: map.sections, drops: map.drops, stops: map.stops,
          lines: map.lines.map((line) => ({ text: line.text, section: line.section, start: line.start, end: line.end, timed: line.words.map((word) => `${word.start.toFixed(2)} ${word.text}${word.heard ? '' : '*'}`).join(' ') })),
          cuts: map.cuts, bars: map.bars.slice(0, 96), phrases: map.phrases, hits: map.hits.slice(0, 160), hitCount: map.hits.length, beatCount: map.beats.length,
        },
      );
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
      const structure = musicStructure(peaks, analysis, num(args, 'start') ?? 0);
      return done(`${asset.name}: ${analysis.bpm.toFixed(1)} BPM (confidence ${(analysis.confidence * 100).toFixed(0)}%), ${analysis.beats.length} beats over ${analysis.duration.toFixed(1)} s, ${structure.bars.length} bars, ${structure.phrases.length} 4-bar phrases, ${structure.drops.length} drop(s)${structure.stops.length ? `, ${structure.stops.length} stop(s)` : ''}. Times are source seconds. Pro rhythm: big world changes on phrase lines or the drop, cuts on the 16th before the beat, motion landing on the beat; snap_cuts_to_beats {grid:"phrase"|"bar"|"beat"} maps them to the timeline.`, { assetId: asset.id, bpm: analysis.bpm, confidence: analysis.confidence, beats: analysis.beats.slice(0, 64), beatCount: analysis.beats.length, downbeats: analysis.downbeats.slice(0, 32), phrases: structure.phrases.slice(0, 32), drops: structure.drops, stops: structure.stops });
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
        let grid = music.beats;
        const want = str(args, 'grid');
        if (want === 'bar' || want === 'phrase') {
          // Bars and phrases come from the waveform again (the plan stores beats only).
          const musicAsset = assets.get(music.assetId!);
          const peaks = musicAsset?.peaks ? await loadPeaks(musicAsset.peaks) : null;
          if (peaks) {
            const structure = musicStructure(peaks, detectBeats(peaks));
            grid = want === 'phrase' ? structure.phrases : structure.bars;
          }
        }
        beats = grid.map((b) => musicClip.start + (b - musicClip.in) / musicClip.speed).filter((t) => t >= 0);
      }
      const only = Array.isArray(args.clipIds) ? new Set((args.clipIds as unknown[]).filter((id): id is string => typeof id === 'string')) : null;
      // Butt cuts roll as one edit point, so snapping never opens a gap (WORLD-CLASS-PLAN C1).
      const { comp: next, changes } = snapCutsToBeats(comp, beats, { tolerance, only, limit, minDuration: 0.2 });
      if (!changes.length) return done(`Every cut is already within ${Math.round(tolerance * 1000)} ms of a beat (${beats.length} beats).`, { changes: [], beats: beats.length });
      editComp(comp, () => next);
      return done(`${changes.length} edge(s) moved onto beats (±${Math.round(tolerance * 1000)} ms): ${changes.slice(0, 8).map((c) => `${c.name} ${c.edge} ${timecode(c.from, fps(comp))}→${timecode(c.to, fps(comp))}`).join('; ')}. Butt cuts rolled together (both sides move, so no gaps open); free edges trimmed, overlays moved; linked audio stays put (J/L split).`, { changes, beats: beats.length });
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
      // Measuring awaits per clip; the gains are patched onto the comp as it is then, so edits made meanwhile stay.
      const patches = new Map<string, { volume: number; audioType: 'music' | 'dialogue' }>();
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
        patches.set(clip.id, { volume, audioType: role === 'music' ? 'music' : 'dialogue' });
        rows.push({ clipId: clip.id, name: clip.name ?? asset.name, role, measured: Math.round(measured.integratedLufs * 10) / 10, targetLufs: wanted, gainDb: Math.round(gainDb * 10) / 10, truePeakDb: Math.round(measured.truePeakDb * 10) / 10 });
      }
      if (!rows.length) return fail('No dialogue or music clips with audio on the audio tracks to level.');
      editComp(comp, (current) => ({ ...current, clips: current.clips.map((c) => {
        const patch = patches.get(c.id);
        return patch ? { ...c, volume: patch.volume, audioType: c.audioType ?? patch.audioType } : c;
      }) }));
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
      if (!runId) return fail('The matte path is not a Bhippi roto run.');
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
        }, { project, assets, commit, editComp, pickComp, current: () => host.history.current(), setReference: host.setReference, brand: (() => { const kit = activeBrandKit(host, project); return kit ? motionBrandFromKit(kit) : null; })() });
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

    case 'add_graphic': {
      // One graphic from a plain kind and its words: the template is picked and filled here
      // (addGraphic.ts), then built and fitted by the template tool (auto-fix, templateFix.ts).
      const call = graphicCall({
        kind: str(args, 'kind') ?? '', text: str(args, 'text'), subtitle: str(args, 'subtitle'), kicker: str(args, 'kicker'), points: args.points ?? args.items ?? args.rows,
        values: args.values, value: args.value, prefix: str(args, 'prefix'), suffix: str(args, 'suffix'), accentWord: str(args, 'accentWord'), cta: str(args, 'cta'),
        side: str(args, 'side'), color: str(args, 'color') ?? str(args, 'accentColor'), at: num(args, 'at') ?? num(args, 'start'), duration: num(args, 'duration'),
      }, !!activeBrandKit(host, project));
      if ('error' in call) return fail(call.error);
      const made = await runTool(host, call.tool, { ...call.args, ...(str(args, 'compId') ? { compId: str(args, 'compId') } : {}) }, signal, turnId);
      return made.ok ? { ...made, summary: `${call.kind} → ${call.template}: ${made.summary}`, template: call.template } : { ...made, error: `${call.kind} (${call.template}): ${made.error}` };
    }

    case 'create_motion_graphic': {
      const comp = pickComp(project, args);
      if (!comp) return fail('No composition found.');
      // The house lower third, not the legacy one, when the model names no template. An id written
      // loosely ("Hook promise", "STAT_CHART") is read as the template it names.
      const named = str(args, 'template') || 'crimson-lower-third';
      const template = resolveTemplateId(named, [...CRIMSON_TEMPLATES, ...['lower-third', 'kinetic-title', 'stat-callout', 'feature-badge', 'social-callout', 'react-bits', 'custom', ...CARD_TEMPLATES].map((id) => ({ id }))]) ?? named;
      // What a weaker model sends, made into what the house template takes (templateFix.ts): other
      // words for a slot, lists as one string, colour names, text a little long for its box.
      const fixed = CRIMSON_SLOTS[template] && !str(args, 'html') ? fixTemplateArgs(template, CRIMSON_SLOTS[template], args, { plate: CRIMSON_PALETTE[0] }) : null;
      if (fixed?.error) return fail(`${fixed.error}${fixSummary(fixed.notes)} Its slots: ${describeSlots(CRIMSON_SLOTS[template])}.`);
      const a: Args = fixed?.args ?? args;
      // A house template shows no placeholder: its schema asks for what it needs instead.
      const title = str(a, 'title') || (CRIMSON_SLOTS[template] ? '' : 'BHIPPI MOTION');
      const subtitle = str(a, 'subtitle') || '';
      // Crimson and React Bits keep their own accent when none is given; the legacy set falls back to sky in the builder.
      const accentColor = str(a, 'accentColor') || undefined;
      const bit = str(a, 'bit') || undefined;
      const props = record(a, 'props') ?? undefined;
      const theme = str(a, 'theme') || undefined;
      // The active brand kit colours React Bits pieces and Crimson templates unless the caller opts out.
      const brand = bool(a, 'useBrand') === false ? null : activeBrandKit(host, project);
      const backgroundArg = a.background;
      const background = typeof backgroundArg === 'string' && backgroundArg.trim() ? backgroundArg : backgroundArg && typeof backgroundArg === 'object' && !Array.isArray(backgroundArg) && typeof (backgroundArg as Args).bit === 'string' ? ({ bit: (backgroundArg as Args).bit as string, props: record(backgroundArg as Args, 'props') } as ReactBitsLayer) : undefined;
      const layers = Array.isArray(a.layers)
        ? (a.layers as unknown[]).filter((item): item is Args => !!item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Args).bit === 'string').map((item): ReactBitsLayer => ({
          bit: item.bit as string,
          props: record(item, 'props'),
          layout: MOGRT_LAYOUTS.has(String(item.layout)) ? (String(item.layout) as MogrtLayout) : undefined,
          at: num(item, 'at'),
          until: num(item, 'until'),
        }))
        : undefined;
      // Never a placeholder number: a stat on screen is a claim.
      const metric = str(a, 'metric') || undefined;
      if (template === 'stat-callout' && !metric) return fail('stat-callout needs a real, verified metric (the number exactly as the source states it); without one use a title or teaching-card template.');
      const badge = str(a, 'badge') || '';
      const html = str(a, 'html') || undefined;
      const css = str(a, 'css') || undefined;
      const js = str(a, 'js') || undefined;
      const duration = num(a, 'duration');
      const start = num(a, 'start');
      const track = str(a, 'track');
      const asNestedComp = bool(a, 'asNestedComp') ?? true;
      const kicker = str(a, 'kicker') || undefined;
      const rows = Array.isArray(a.rows) ? (a.rows as unknown[]).filter((r): r is string => typeof r === 'string').slice(0, 6) : undefined;
      const values = Array.isArray(a.values) ? (a.values as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(0, 6) : undefined;
      const accentWord = str(a, 'accentWord') || undefined;
      const activeIndex = num(a, 'activeIndex');
      const layout = MOGRT_LAYOUTS.has(String(a.layout)) ? (String(a.layout) as MogrtLayout) : undefined;
      const cameraMove = (['none', 'push-in', 'travel'] as const).find((item) => item === str(a, 'cameraMove'));
      const reactBits = isReactBitsTemplate(template) && !templateSpec(template);
      if (template !== 'custom' && !templateSpec(template) && !reactBits && !isRoastCardTemplate(template) && !['lower-third', 'kinetic-title', 'stat-callout', 'feature-badge', 'social-callout'].includes(template)) return fail(`Unknown template "${template}". Crimson templates:\n${templateCatalogue()}\nReact Bits: template "react-bits" with bit/props or layers — browse with react_bits {"action":"list"}. @funny cards: ${CARD_TEMPLATES.join(', ')} (their fields in "params").`);
      // A house template never shows placeholder text: a slot it needs and was not given is asked for.
      const slots = CRIMSON_SLOTS[template];
      const missing = slots && !html ? missingSlots(slots, { title: str(a, 'title'), subtitle, kicker, rows, values, metric, badge }) : [];
      if (slots && missing.length) return fail(`${template} needs ${missing.join(' and ')}. Its slots: ${describeSlots(slots)}.`);

      try {
        const graphicOpts = {
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
          fit: fixed ? fitScales(fixed.adjustments) : undefined,
        };

        let result = createMotionGraphicComp(project, graphicOpts);
        // Render check (graphicCheckRun.ts): a house template is laid out at its hold frame; a slot
        // that spills out of its card or the frame is set smaller for one rebuild, and anything
        // still wrong is reported so the model can shorten it.
        let layoutNote = '';
        if (CRIMSON_SLOTS[template] && !html) {
          const canvas = mogrtCanvas(comp);
          const issues = await checkGraphic(result.bundle, canvas, result.duration);
          const present = Object.keys(CRIMSON_SLOTS[template]).filter((slot) => { const v = (graphicOpts as Record<string, unknown>)[slot]; return Array.isArray(v) ? v.length > 0 : !!v; });
          const again = issues?.length ? refit(graphicOpts.fit ?? {}, issues, canvas, present) : null;
          if (issues?.length && again) {
            result = createMotionGraphicComp(project, { ...graphicOpts, fit: again });
            const left = await checkGraphic(result.bundle, canvas, result.duration);
            layoutNote = left?.length ? ` Layout check: ${issuesText(left)} even after setting it smaller — shorten that text.` : ` Layout check: ${Object.keys(again).filter((slot) => again[slot] !== graphicOpts.fit?.[slot]).join(', ')} set smaller to stay inside its card and the frame.`;
          } else if (issues?.length) layoutNote = ` Layout check: ${issuesText(issues)}.`;
        }

        host.history.commit(() => result.project, label);
        host.setSelection([result.newClipId]);

        const targetCompUpdated = result.project.comps.find((c) => c.id === result.targetCompId);
        const trackName = targetCompUpdated ? trackLabel(targetCompUpdated, result.trackId) : result.trackId;

        const spec = templateSpec(result.bundle.template);
        const hint = spec?.wantsSplit ? ` Reframe the footage beside it: layout_clip {"clipId": <footage>, "slot": "${(layout ?? 'side-panel-right') === 'side-panel-left' ? 'right-55' : 'left-55'}", "at": ${result.start}}.` : '';
        const what = reactBits ? `React Bits (${[background && (typeof background === 'string' ? background : background.bit), ...(layers?.map((l) => l.bit) ?? (bit ? [bit] : template !== 'react-bits' ? [template] : []))].filter(Boolean).join(' + ')})` : result.bundle.template;
        return done(
          `Created ${what} motion graphic "${title}" on ${trackName} at ${result.start}s (${result.duration}s)${asNestedComp ? ` inside comp "${result.mogrtComp?.name}"` : ''}. It animates in the preview and exports as rendered frames.${hint}${fixSummary(fixed?.notes ?? [])}${layoutNote}`,
          {
            ...(fixed?.adjustments.length ? { adjustments: fixed.adjustments } : {}),
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
      return fail(`Bhippi has no tool called ${name}`);
  }
}

/** A short line for the chat's tool list. */
export const toolTitle = (name: string) => name.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

export { sourceTimeAt };
