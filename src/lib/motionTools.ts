// AI tools for the motion engine (src/motion): build AE-grade motion scenes from templates or
// raw layer JSON, inspect and patch them, and learn a style from a reference film.
import { CRIMSON_SLOTS, describeSlots, missingSlots, resolveTemplateId, slotsFor } from './templateSlots';
import { exampleCall, thumbnailUrl } from './templateExamples';
import { CRIMSON_TEMPLATES } from './motionGuide';
import { fixSummary, fixTemplateArgs, toHex } from './templateFix';
import type { Adjustment } from './templateEval';
import { MOTION_TEMPLATES, findTemplate } from '../motion/kit';
import type { KitContext } from '../motion/kit/common';
import { brandifyScene, buildInBrand } from '../motion/kit/brandify';
import { currentMotionBrand } from './brandKit/activeStore';
import type { MotionBrand } from './brandKit/motionBrand';
import type { FootageSource, Layer, MotionScene } from '../motion/types';
import { EFFECT_TYPES, validateScene } from '../motion/validate';
import { expandIcons, searchIcons, unknownIcons } from '../motion/vector/icons';
import { drawnCatalog } from '../motion/ink/catalog';
import { motionReport } from '../motion/arcs';
import { svgToShape } from '../motion/vector/svg';
import { playbook, playbookIndex } from './motionDirection';
import { findPack, packCatalogue } from './stylePacks';
import { cameraLayer, PRESETS_3D, renderScene, scene3dRequest, trackLayers, type CameraFile, type ObjectsFile, type Render3DResult } from './blender3d';
import { buildUiScene, runUiScreenTool } from './uiScreenTools';
import { describePlan, planPanelLayout } from './panelLayout';
import { loadCaptureManifest, loadRecording, type CaptureManifest, type Recording } from './appCapture';
import { buildDemoTemplate } from '../motion/kit/productDemo';
import { runCharacterTool } from './characterTools';
import { runLottieTool } from './lottieTools';
import { GENERIC_TARGET, pacingReport, type PacingTarget } from './pacing';
import { summarizeProfile, type MotionProfile } from './referenceMotion';
import { applyFinish, carryFinish, readFinish } from '../motion/finish';
import { FX_HELP, FX_KINDS, fxLayers, type FxKind, type FxOptions } from '../motion/fx';
import { evaluateMeasured } from '../motion/measure';
import { entryBounds } from '../motion/evaluate';
import { compileSequence, TRANSITION_HELP, TRANSITION_KINDS, type SeqBeat, type SeqTransition, type TransitionKind } from '../motion/sequence';
import { keyTimes } from '../motion/anim';
import { clamp, SFX_LENGTH, timecode } from './editor';
import { api, errorText, type Transcript, type TranscriptWord, fetchFile } from './ipc';
import { timelineWords } from './transcriptText';
import { hasWordRefs, resolveWordTimes } from './wordTimes';
import { sfxClipFields, sfxTrack } from './sfxLevels';
import { cueLevel, cuePlacements, isMusicClip, motionCues, musicDbOver, placedSounds, typingCues, type MusicBed, type PlacedSound } from './cueSound';
import { loadPeaks } from './peaks';
import { clipEnd, compDuration, freeTrack, newClip, placeClips, sourceTimeAt, tracksOf, type AssetMap } from './timeline';
import { explodeScene, isLayerClip, isLayeredComp, layeredCompScene, logicalScene, ownLayers, restack, splitMotionComps, stackLossy } from './motionStack';
import { fitToSafeArea, layoutIssues, safeMargins, type LayoutIssue } from '../motion/safeArea';
import { SFX_KINDS, type Clip, type ClipSource, type Comp, type Project, type SfxKind, type ToolResult } from './types';

type Args = Record<string, unknown>;

export const MOTION_TOOLS = new Set(['list_motion_templates', 'create_motion_scene', 'get_motion_scene', 'update_motion_scene', 'analyze_reference_video', 'save_style_profile', 'track_motion', 'nest_motion_scenes', 'split_motion_layers', 'search_icons', 'svg_to_shape', 'motion_guide', 'list_drawn_styles', 'check_motion_arcs', 'render_3d_scene', 'list_3d_presets', 'create_ui_screen', 'update_ui_screen', 'list_ui_kinds', 'capture_product_ui', 'create_product_demo', 'layout_panels', 'create_motion_sequence', 'list_transitions', 'add_fx', 'check_pacing', 'create_character', 'animate_character', 'lip_sync_character', 'list_character_actions', 'list_characters', 'import_lottie', 'sound_the_motion']);
/** What create_product_demo passes on to the demo's template, besides the capture it loads. */
const DEMO_PARAMS = ['duration', 'shots', 'actions', 'cursors', 'stage', 'tilt', 'explode', 'variant', 'settle', 'base', 'at', 'slam', 'depth', 'spread', 'blur', 'lifts', 'from', 'autoCursor'];
/** Read-only / planning motion tools, allowed in any production phase. */
export const MOTION_READ_TOOLS = new Set(['list_motion_templates', 'get_motion_scene', 'analyze_reference_video', 'save_style_profile', 'search_icons', 'svg_to_shape', 'motion_guide', 'list_drawn_styles', 'check_motion_arcs', 'list_3d_presets', 'list_ui_kinds', 'list_transitions', 'check_pacing', 'list_character_actions', 'list_characters']);

export type MotionToolContext = {
  project: Project;
  assets: AssetMap;
  commit: (change: (current: Project) => Project) => void;
  editComp: (comp: Comp, change: (current: Comp) => Comp) => void;
  pickComp: (project: Project, args: Args) => Comp | undefined;
  current: () => Project;
  setReference?: (id: string | null) => void;
  /** The active brand kit for the engine; every scene is built in it (null: the house Crimson look). */
  brand?: MotionBrand | null;
  /** Ends with the AI turn: long waits (a Blender render) stop waiting, the job carries on. */
  signal?: AbortSignal;
  /** What the user asked this turn (empty when unknown), for choices that are theirs to make. */
  prompt?: string;
};

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const obj = (args: Args, key: string) => (args[key] && typeof args[key] === 'object' && !Array.isArray(args[key]) ? (args[key] as Args) : undefined);

function findClip(project: Project, id: string): { clip: Clip; comp: Comp } | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((entry) => entry.id === id);
    if (clip) return { clip, comp };
  }
  return null;
}

/** Face point (canvas px) from the roto run's subject box nearest `sourceTime`. */
async function faceFromRoto(clip: Clip, sourceTime: number, width: number, height: number): Promise<[number, number] | null> {
  if (!clip.rotoMatte) return null;
  const runId = clip.rotoMatte.replace(/[\\/]+matte\.[a-z0-9]+$/i, '').split(/[\\/]/).pop() ?? '';
  try {
    const roto = await api.rotoRead(runId);
    const boxes = roto?.subjects.filter((s) => s.cover > 0.01) ?? [];
    if (!boxes.length) return null;
    const box = boxes.reduce((best, s) => (Math.abs(s.at - sourceTime) < Math.abs(best.at - sourceTime) ? s : best));
    // The face sits about a fifth of the way down a talking-head silhouette.
    return [(box.x + box.width / 2) * width, (box.y + box.height * 0.18) * height];
  } catch {
    return null;
  }
}

/**
 * Turns footage references in template params into FootageSources: `{ clipId }` (a timeline clip:
 * its asset, its source time at the scene start, its roto matte), `{ assetId }` or `{ asset }`.
 */
function footageFrom(value: unknown, ctx: MotionToolContext, sceneStart: number): FootageSource | unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Args;
  if (typeof v.clipId === 'string') {
    const found = findClip(ctx.project, v.clipId);
    if (!found || found.clip.source.type !== 'media') return value;
    const asset = ctx.assets.get(found.clip.source.assetId);
    return {
      asset: found.clip.source.assetId,
      kind: asset?.kind === 'image' ? 'image' : 'video',
      // Its real shape, so a template sizes its card to the picture instead of cropping it to 16:9.
      ...(asset?.width && asset?.height ? { width: asset.width, height: asset.height } : {}),
      in: sourceTimeAt(found.clip, sceneStart),
      speed: found.clip.speed,
      ...(found.clip.rotoMatte ? { matte: found.clip.rotoMatte } : {}),
      ...(v.cutout !== undefined ? { cutout: !!v.cutout } : {}),
    } satisfies FootageSource;
  }
  if (typeof v.assetId === 'string' && !('asset' in v)) {
    const asset = ctx.assets.get(v.assetId);
    const { assetId, ...rest } = v;
    return { asset: assetId, kind: asset?.kind === 'image' ? 'image' : 'video', ...(asset?.width && asset?.height ? { width: asset.width, height: asset.height } : {}), ...rest };
  }
  return value;
}

function resolveParams(params: Args, ctx: MotionToolContext, sceneStart: number): Args {
  const out: Args = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) out[key] = value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entry = { ...(item as Args) };
        for (const [k, v] of Object.entries(entry)) entry[k] = footageFrom(v, ctx, sceneStart);
        return footageFrom(entry, ctx, sceneStart);
      }
      return item;
    });
    else out[key] = footageFrom(value, ctx, sceneStart);
  }
  return out;
}

/**
 * The clean plate the magic eraser swapped in beside the subject: a "Clean plate background"
 * clip on the same comp that is on screen at the scene start, with its source time there.
 */
function cleanPlateFor(ctx: MotionToolContext, comp: Comp, sceneStart: number): FootageSource | null {
  const live = ctx.project.comps.find((c) => c.id === comp.id) ?? comp;
  const plate = live.clips.find((clip) => clip.source.type === 'media' && (clip.name ?? '').toLowerCase().includes('clean plate') && clip.start <= sceneStart + 1e-3 && clip.start + clip.duration > sceneStart);
  if (!plate || plate.source.type !== 'media') return null;
  const asset = ctx.assets.get(plate.source.assetId);
  if (!asset) return null;
  return { asset: asset.id, kind: asset.kind === 'image' ? 'image' : 'video', in: sourceTimeAt(plate, sceneStart), speed: plate.speed };
}

function summarizeScene(scene: MotionScene) {
  const layerInfo = (layer: Layer): Record<string, unknown> => {
    const keyed: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (!value || typeof value !== 'object') return;
      if (keyTimes(value as never).length) { keyed.push(`${path}@${keyTimes(value as never).map((t) => t.toFixed(2)).join('/')}`); return; }
      if ('expr' in (value as object)) { keyed.push(`${path}=expr`); return; }
      if (Array.isArray(value)) return;
      for (const [k, v] of Object.entries(value as Args)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(layer.transform, 'transform');
    (layer.effects ?? []).forEach((effect, i) => visit(effect, `effects[${i}](${effect.type})`));
    return {
      id: layer.id, type: layer.type, name: layer.name,
      ...(layer.in !== undefined ? { in: layer.in } : {}), ...(layer.out !== undefined ? { out: layer.out } : {}),
      ...(layer.parent ? { parent: layer.parent } : {}), ...(layer.threeD ? { threeD: true } : {}),
      ...(layer.matte ? { matte: layer.matte } : {}), ...(layer.blend && layer.blend !== 'normal' ? { blend: layer.blend } : {}),
      ...(layer.type === 'text' ? { text: layer.text.text ?? layer.text.spans?.map((s) => s.text).join('') } : {}),
      effects: (layer.effects ?? []).map((e) => e.type),
      animated: keyed,
      ...(layer.type === 'precomp' ? { layers: layer.scene.layers.map(layerInfo) } : {}),
    };
  };
  return { width: scene.width, height: scene.height, duration: scene.duration, template: scene.template?.id, cues: scene.cues, layers: scene.layers.map(layerInfo) };
}

/** Sets `value` at a dotted path ("transform.position", "effects.0.radius", "text.cascade.times"). */
function setPath(target: Args, path: string, value: unknown): boolean {
  const parts = path.split('.').filter(Boolean);
  let cursor: Args = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = Array.isArray(cursor) ? (cursor as unknown[])[Number(key)] : cursor[key];
    if (next === undefined || next === null) {
      const created: Args = /^\d+$/.test(parts[i + 1]) ? ([] as unknown as Args) : {};
      if (Array.isArray(cursor)) (cursor as unknown[])[Number(key)] = created; else cursor[key] = created;
      cursor = created;
    } else if (typeof next === 'object') cursor = next as Args;
    else return false;
  }
  const last = parts[parts.length - 1];
  if (value === null) { if (Array.isArray(cursor)) (cursor as unknown[]).splice(Number(last), 1); else delete cursor[last]; }
  else if (Array.isArray(cursor)) (cursor as unknown[])[Number(last)] = value;
  else cursor[last] = value;
  return true;
}

function findLayer(scene: MotionScene, id: string): Layer | null {
  for (const layer of scene.layers) {
    if (layer.id === id) return layer;
    if (layer.type === 'precomp') {
      const inner = findLayer(layer.scene, id);
      if (inner) return inner;
    }
  }
  return null;
}

const SFX_MAP: Record<string, SfxKind> = Object.fromEntries(SFX_KINDS.map((kind) => [kind, kind]));

/** Places the scene's SFX cues on free audio tracks. */
function placeCues(comp: Comp, scene: MotionScene, start: number): { comp: Comp; ids: string[] } {
  let next = comp;
  const ids: string[] = [];
  for (const cue of [...(scene.cues ?? []), ...typingCues(scene)]) {
    const kind = SFX_MAP[cue.sound];
    if (!kind) continue;
    const at = Math.max(0, start + cue.at);
    const duration = Math.max(0.05, Math.min(SFX_LENGTH[kind], cue.duration ?? SFX_LENGTH[kind]));
    const target = sfxTrack(next, at, at + duration);
    const source: ClipSource = { type: 'sfx', kind };
    // Cues are seasoning under the voice (−14…−20 dB), named for what they mark.
    const clip = newClip({ trackId: target.track.id, start: at, duration, source, ...sfxClipFields(kind, cue.note ?? scene.template?.id) });
    next = placeClips(target.comp, [clip], 'overwrite');
    ids.push(clip.id);
  }
  return { comp: next, ids };
}

export const MOTION_FOLDER = 'AI Motion';

/**
 * Adds layered "[Motion]" comps (explodeScene's comp and its precomps) to the project, filed in
 * the AI Motion bin (made when missing), without placing them anywhere: a render delivered in
 * passes (renderPasses.ts) waits there until the edit nests it.
 */
export function fileMotionComps(project: Project, comps: Comp[]): Project {
  if (!comps.length) return project;
  const folderId = project.folders.find((f) => f.name === MOTION_FOLDER && f.parentId === null)?.id ?? `folder_${comps[0].id}`;
  const folders = project.folders.some((f) => f.id === folderId) ? project.folders : [...project.folders, { id: folderId, name: MOTION_FOLDER, parentId: null }];
  return { ...project, folders, comps: [...project.comps, ...comps.map((c) => ({ ...c, folderId: c.folderId ?? folderId }))] };
}

/**
 * Where a motion clip's scene time 0 sits on a given comp's timeline: its own start, plus the
 * start of the nested-comp clip that holds it when it lives in a "[Motion]" comp.
 */
export function sceneOriginIn(project: Project, clip: Clip, owner: Comp, timelineCompId: string): number {
  // Where the clip's scene time 0 falls on its own comp (a layer clip may have been trimmed or moved).
  const origin = clip.start - clip.in / Math.max(1e-6, clip.speed);
  if (owner.id === timelineCompId) return origin;
  const parent = project.comps.find((c) => c.id === timelineCompId);
  const holder = parent?.clips.find((c) => c.source.type === 'comp' && c.source.compId === owner.id);
  return holder ? holder.start + (origin - holder.in) / Math.max(1e-6, holder.speed) : origin;
}

/** Keeps the nested-comp clips that hold a motion comp as long as its scene. */
function syncHolders(project: Project, owner: Comp, duration: number): Project {
  if (!owner.name.startsWith('[Motion]')) return project;
  return {
    ...project,
    comps: project.comps.map((c) => (c.clips.some((clip) => clip.source.type === 'comp' && clip.source.compId === owner.id)
      ? { ...c, clips: c.clips.map((clip) => (clip.source.type === 'comp' && clip.source.compId === owner.id ? { ...clip, duration } : clip)) }
      : c)),
  };
}

/** The first video track above every track that has a picture during [start, end). */
function trackAbove(comp: Comp, start: number, end: number) {
  const video = tracksOf(comp, 'video');
  let top = -1;
  video.forEach((track, index) => {
    if (comp.clips.some((clip) => clip.trackId === track.id && clip.enabled && clip.start < end && clip.start + clip.duration > start)) top = index;
  });
  return freeTrack(comp, 'video', start, end, Math.max(0, top + 1));
}

// ───────────────────────── style profiles ─────────────────────────

export const MOTION_DESIGNER_EXPLAINER_PROFILE = `STYLE PROFILE — Motion Designer Explainer (measured from the reference "If You ONLY Watch One Motion Design Video", 11:44)

CADENCE
· Hook: 0–15 s is a montage — a new visual every 0.5–2 s (subject reveal → frame-to-card → 3D card wall + kinetic words → effect showcases).
· Hard cuts average one per 6.6 s (106 in 704 s: 23 under 1.5 s, 39 of 1.5–4 s, 22 of 4–8 s, 20 over 8 s), but a graphic lands every 2–6 s on the talking head; never more than ~15 s of bare talking head.
· A chapter device returns at every topic change: the hex roadmap ("5 STAGES") with the current stage lit, camera flying into it.
· Teaching happens full-screen on the crimson stage: glass cards whose items write on as they are spoken (60–70 s sections are fine there).

LOOK
· Stage: near-black oxblood top, glowing crimson floor. Accents crimson #b0142f / hot #ff1f3d / pink #ff8a9a, white type with a soft glow.
· Talking head graded warm amber; b-roll crimson/teal duotone or pink with halation and grain; one black-and-white grade hit per emphasis beat.
· Depth in every shot: plate → graphics → subject. Big numbers and titles sit BEHIND the presenter (roto + clean plate). Cards are frosted glass with 1 px light rims and soft shadows.

TYPE
· One bold, tightly tracked geometric sans for everything; one handwritten script word per phrase as the accent ("taste", "scared", "later"); italic for spoken emphasis; key phrase in the accent colour.
· Words land one at a time on the transcript timing: blur-in + slide + fade, then dim-to-bright.

MOTION GRAMMAR
· Entrances: blur + slide/scale + fade on expo-out (back-out for pops), 60–120 ms staggers. Exits: faster, expo-in. Nothing moves linearly. Motion blur on every fast move.
· Frame-to-card transitions: the full frame shrinks to a rounded card on the stage before the next idea.
· Every graphic event has a sound: whoosh on moves, pop/click on lands, riser into reveals, impact on the hook.

TEMPLATE MAP (create_motion_scene)
hook → subject-reveal (+ frame-to-card); montage → card-wall-3d; chapter → hex-roadmap; list/teaching → glass-teaching-card or diamond-list-pip; categories → numbered-lanes; relationships → node-tree; person → cutout-stage; numbers → stat-badges or big-number-behind; software → dock-cursor or demo-callouts; comparison → comparison-pair; quote/emphasis → blurred-sentence; transition → zoom-tunnel; title → ribbon-title; b-roll line → stylized-broll; emphasis grade → grade-hit; rules → split-rules-panel; social proof → social-card.`;

function cadenceFromCuts(cuts: number[], seconds: number) {
  const sorted = [...cuts].sort((a, b) => a - b);
  const bounds = [0, ...sorted, seconds];
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]).filter((d) => d > 0.05);
  const bucket = (lo: number, hi: number) => shots.filter((d) => d >= lo && d < hi).length;
  const median = shots.length ? [...shots].sort((a, b) => a - b)[Math.floor(shots.length / 2)] : seconds;
  return {
    shots: shots.length,
    meanShot: shots.length ? seconds / shots.length : seconds,
    medianShot: median,
    histogram: { under1_5: bucket(0, 1.5), from1_5to4: bucket(1.5, 4), from4to8: bucket(4, 8), over8: bucket(8, Infinity) },
    hookCuts: sorted.filter((t) => t < 15).length,
  };
}

async function imageDataUrl(path: string): Promise<string | null> {
  try {
    const response = await fetchFile(path);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result.replace(/^data:image\/[a-z]+;/, 'data:image/jpeg;') : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ───────────────────────── layered motion comps ─────────────────────────

type MotionSource = Extract<ClipSource, { type: 'motion' }>;

/** The safe margin a call asks for (one fraction for every side), else undefined: the fitter then uses the editor's safe area for the frame's orientation. */
const safeMargin = (args: Args): number | undefined => {
  const asked = num(args, 'safeMargin');
  return asked === undefined ? undefined : clamp(asked, 0, 0.2);
};

/** What `id` points at: a layered motion comp (by comp, holder clip or any layer clip), or a single motion scene clip. */
function resolveMotion(project: Project, id: string): { kind: 'stack'; comp: Comp } | { kind: 'clip'; clip: Clip; comp: Comp } | null {
  if (!id) return null;
  const found = findClip(project, id);
  if (found && isLayerClip(found.clip)) return { kind: 'stack', comp: found.comp };
  if (found?.clip.source.type === 'motion') return { kind: 'clip', ...found };
  const compId = found?.clip.source.type === 'comp' ? found.clip.source.compId : project.comps.some((c) => c.id === id) ? id : null;
  const inner = compId ? project.comps.find((c) => c.id === compId) : undefined;
  if (!inner) return null;
  if (isLayeredComp(inner)) return { kind: 'stack', comp: inner };
  const clip = inner.clips.find((c) => c.source.type === 'motion');
  return clip ? { kind: 'clip', clip, comp: inner } : null;
}

/** A layered comp's layers as the AI reads them: where each clip is, on which track, whether it shows. */
function layerListing(project: Project, comp: Comp): Record<string, unknown>[] {
  const video = tracksOf(comp, 'video');
  return comp.clips.filter(isLayerClip).flatMap((clip) => ownLayers(clip.source.scene).map((layer) => {
    const index = video.findIndex((track) => track.id === clip.trackId);
    const inner = layer.type === 'precomp' && layer.comp ? project.comps.find((c) => c.id === layer.comp) : undefined;
    return {
      layerId: layer.id, clipId: clip.id, name: clip.name ?? layer.name ?? layer.id, type: layer.type, track: `V${index + 1}`,
      start: Math.round(clip.start * 1000) / 1000, end: Math.round(clipEnd(clip) * 1000) / 1000,
      ...(!clip.enabled || video[index]?.hidden ? { hidden: true } : {}),
      ...(layer.type === 'text' ? { text: layer.text.text ?? layer.text.spans?.map((s) => s.text).join('') } : {}),
      ...(inner ? { precompCompId: inner.id, precompLayers: layerListing(project, inner).map((entry) => `${String(entry.name)} (${String(entry.layerId)})`) } : {}),
    };
  }));
}

function describeLayout(issues: LayoutIssue[]): string {
  return `Outside the safe area: ${issues.slice(0, 6).map((issue) => `${issue.names.join(' + ')}${issue.offFrame ? ' (partly off the frame)' : ''} by ${Object.entries(issue.overflow).filter(([, v]) => v > 0).map(([side, v]) => `${v}px ${side}`).join(', ')} at ${issue.at.toFixed(2)} s`).join('; ')}.`;
}

function fitReport(fit: ReturnType<typeof fitToSafeArea> | null, margin: number | undefined): string {
  if (!fit) return '';
  const sides = safeMargins(fit.scene, margin);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const moved = fit.moved.length ? ` Moved inside the safe area (${pct(sides.top)} top, ${pct(sides.bottom)} bottom, ${pct(sides.left)} left, ${pct(sides.right)} right): ${fit.moved.map((m) => `${m.names.join(' + ')} (${m.dx >= 0 ? '+' : ''}${m.dx}, ${m.dy >= 0 ? '+' : ''}${m.dy} px${m.scale < 1 ? `, ×${m.scale}` : ''})`).join('; ')}.` : '';
  return `${moved}${fit.remaining.length ? ` ${describeLayout(fit.remaining)}` : ''}`;
}

/** A brand stage so light it reads as a blank white frame (the Organic Earth linen, for one). */
function lightStageNote(scene: MotionScene): string {
  const stage = scene.layers.find((layer) => layer.id === 'brand-stage' && layer.type === 'shape');
  if (!stage || stage.type !== 'shape') return '';
  const colours = stage.shape.gradient?.stops.map(([, c]) => c) ?? (stage.shape.fill ? [stage.shape.fill] : []);
  const light = colours.filter((c) => /^#[0-9a-f]{6}/i.test(c)).map((c) => [1, 3, 5].reduce((sum, i) => sum + parseInt(c.slice(i, i + 2), 16), 0) / (3 * 255));
  if (!light.length || light.reduce((a, b) => a + b, 0) / light.length < 0.8) return '';
  return ' Its brand stage is a light, nearly flat gradient that reads as a blank white frame on screen: over footage use background "none" with a designed background plate under it (fill_background, or a generated gradient), and look at it in run_frame_qa.';
}

/** Clip on screen for all of [from, to) whose name says it is a background plate (not a clean plate of the room). */
function backgroundPlate(ctx: MotionToolContext, comp: Comp, from: number, to: number): string | null {
  const visible = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  for (const clip of comp.clips) {
    if (!clip.enabled || !visible.has(clip.trackId) || clip.start > from + 0.05 || clipEnd(clip) < to - 0.05) continue;
    const name = clip.name ?? (clip.source.type === 'media' ? ctx.assets.get(clip.source.assetId)?.name : clip.source.type === 'comp' ? ctx.project.comps.find((c) => c.id === (clip.source as { compId: string }).compId)?.name : null) ?? '';
    if (/background|backdrop|gradient|wallpaper|texture|\bbg\b|\bplate\b/i.test(name) && !/clean plate/i.test(name)) return name;
  }
  return null;
}

type SceneEdit = { scene: MotionScene; changes: string[]; retime: number | null; rebuilt: boolean; fitNote: string };

const FINISH_HELP = 'finish is "launch-light", "launch-dark" or {preset, exposure?, bloom?, vignette?, grain?, cardShadow?, shadowColor?}; "none" takes it off.';

/** Applies update_motion_scene's params / scene / removeLayers / addLayers / patches / retime to a copy of `base`, then keeps it inside the safe area. */
function editScene(base: MotionScene, args: Args, ctx: MotionToolContext, sceneStart: number): SceneEdit | { error: string } {
  let scene: MotionScene = JSON.parse(JSON.stringify(base));
  const changes: string[] = [];
  let rebuilt = false;
  const params = obj(args, 'params');
  if (params) {
    const templateId = scene.template?.id;
    const spec = templateId ? findTemplate(templateId) : undefined;
    if (!spec) return { error: 'This scene was not built from a template; patch its layers instead.' };
    const merged = { ...(scene.template?.params ?? {}), ...resolveParams(params, ctx, sceneStart) };
    const brand = args.useBrand === false ? null : ctx.brand ?? scene.brand?.snapshot ?? null;
    // A rebuild keeps the scene's finish (and the user's changes to it).
    scene = carryFinish(scene, buildInBrand(spec, { width: scene.width, height: scene.height }, merged, brand));
    changes.push(`rebuilt ${templateId} with ${Object.keys(params).join(', ')}`);
    rebuilt = true;
  }
  const replacement = obj(args, 'scene');
  if (replacement) { scene = { ...scene, ...(replacement as object) } as MotionScene; changes.push('replaced the scene'); rebuilt = true; }
  for (const id of Array.isArray(args.removeLayers) ? (args.removeLayers as unknown[]).filter((v): v is string => typeof v === 'string') : []) {
    const before = scene.layers.length;
    scene.layers = scene.layers.filter((layer) => layer.id !== id);
    if (scene.layers.length < before) changes.push(`removed ${id}`);
  }
  for (const raw of Array.isArray(args.addLayers) ? (args.addLayers as unknown[]) : []) {
    const entry = raw as Args;
    const layer = (entry.layer ?? entry) as Layer;
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string') return { error: 'addLayers entries are layers (or {layer, above|below}) with an id.' };
    const anchorId = (entry.above ?? entry.below) as string | undefined;
    const index = anchorId ? scene.layers.findIndex((l) => l.id === anchorId) : -1;
    if (index >= 0) scene.layers.splice(entry.above ? index + 1 : index, 0, layer);
    else scene.layers.push(layer);
    changes.push(`added ${layer.id}`);
  }
  if (args.finish !== undefined) {
    const finish = readFinish(args.finish);
    if (!finish) return { error: FINISH_HELP };
    scene = applyFinish(scene, finish);
    changes.push(finish === 'none' ? 'took the finish off' : `finished with ${finish.preset} (the "finish" layer)`);
  }
  for (const raw of Array.isArray(args.patches) ? (args.patches as unknown[]) : []) {
    const patch = raw as Args;
    const path = typeof patch.path === 'string' ? patch.path : '';
    if (!path) return { error: 'Each patch needs a path (e.g. "transform.position" or "effects.0.radius").' };
    const target = typeof patch.layer === 'string' ? findLayer(scene, patch.layer) : (scene as unknown as Layer);
    if (!target) return { error: `No layer "${String(patch.layer)}" in the scene. Layers: ${scene.layers.map((l) => l.id).join(', ')}.` };
    if (!setPath(target as unknown as Args, path, patch.value)) return { error: `Could not set ${path}.` };
    changes.push(`${patch.layer ?? 'scene'}.${path}`);
  }
  const retime = num(args, 'retime');
  const stretching = !!retime && retime > 0 && retime !== 1;
  if (stretching) {
    const stretch = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stretch);
      if (!value || typeof value !== 'object') return value;
      const out: Args = {};
      for (const [k, v] of Object.entries(value as Args)) out[k] = (k === 't' || k === 'at' || k === 'in' || k === 'out' || k === 'delay' || k === 'stagger' || k === 'duration') && typeof v === 'number' ? v * retime : k === 'times' && Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x * retime : x)) : stretch(v);
      return out;
    };
    scene = { ...(stretch(scene) as MotionScene), width: scene.width, height: scene.height, version: 1 };
    changes.push(`retimed ×${retime}`);
  }
  if (!changes.length) return { error: 'Nothing to change: give params, patches, addLayers, removeLayers, finish, retime or scene.' };
  const problems = validateScene(scene);
  if (problems.length) return { error: `The edited scene is not valid: ${problems.slice(0, 8).join(' ')}` };
  const fit = args.fit === false ? null : fitToSafeArea(scene, { margin: safeMargin(args) });
  return { scene: fit ? fit.scene : scene, changes, retime: stretching ? retime : null, rebuilt, fitNote: fitReport(fit, safeMargin(args)) };
}

/** update_motion_scene on a layered comp: edit the scene its layers stand for, then write it back layer by layer. */
function updateStack(comp: Comp, args: Args, ctx: MotionToolContext): ToolResult {
  const base = logicalScene(ctx.project, comp);
  if (!base) return fail('That comp has no motion layers.');
  const holder = ctx.project.comps.flatMap((c) => c.clips).find((clip) => clip.source.type === 'comp' && clip.source.compId === comp.id);
  const edit = editScene(base, args, ctx, holder?.start ?? 0);
  if ('error' in edit) return fail(edit.error);
  const timing = edit.rebuilt || edit.retime ? 'scene' : 'keep';
  ctx.commit((current) => {
    const restacked = restack(current, comp.id, edit.scene, timing, 0, base);
    const after = restacked.comps.find((c) => c.id === comp.id);
    // A scene that got longer or shorter takes the clips that hold it along.
    return after && Math.abs(edit.scene.duration - base.duration) > 1e-3 ? syncHolders(restacked, after, compDuration(after)) : restacked;
  });
  const after = ctx.current().comps.find((c) => c.id === comp.id) ?? comp;
  return done(`Updated "${comp.name}": ${edit.changes.join('; ')}. Its layers keep their clips, tracks and the user's timing and Motion changes${timing === 'scene' ? ' (clips nobody moved take the new timing)' : ''}.${edit.fitNote}`, { compId: comp.id, layers: layerListing(ctx.current(), after), outline: summarizeScene(edit.scene) });
}

// ───────────────────────── the tools ─────────────────────────

/** Words spoken on a comp's timeline, from the transcripts already cached for its media. */
async function compWords(comp: Comp, ctx: MotionToolContext): Promise<TranscriptWord[]> {
  const ids = [...new Set(comp.clips.flatMap((clip) => (clip.source.type === 'media' ? [clip.source.assetId] : [])))];
  if (!ids.length) return [];
  let cached: Transcript[] = [];
  try { cached = await api.transcriptsCached(ids); } catch { return []; }
  return timelineWords(comp, ctx.assets, new Map(cached.map((t) => [t.assetId, t])));
}

/** An update's added layers, patches and replacement scene with their icons expanded to paths. */
async function withIcons(args: Args): Promise<Args> {
  const probe: MotionScene = { version: 1, width: 1, height: 1, duration: 1, layers: [] };
  const expandLayers = async (layers: unknown[]) => (await expandIcons({ ...probe, layers: layers as Layer[] })).layers;
  const out: Args = { ...args };
  if (Array.isArray(args.addLayers)) {
    const raw = args.addLayers as ({ layer?: Layer } | Layer)[];
    const plain = raw.map((entry) => ('layer' in entry && entry.layer ? entry.layer : entry) as Layer);
    const expanded = await expandLayers(plain);
    out.addLayers = raw.map((entry, i) => ('layer' in entry && entry.layer ? { ...entry, layer: expanded[i] } : expanded[i]));
  }
  if (Array.isArray(args.patches)) {
    out.patches = await Promise.all((args.patches as { value?: unknown }[]).map(async (patch) => {
      const value = patch.value as { groups?: unknown } | undefined;
      if (!value || typeof value !== 'object') return patch;
      const shape = 'groups' in value ? value : null;
      if (!shape) return patch;
      const [layer] = await expandLayers([{ id: 'p', type: 'shape', shape } as Layer]);
      return { ...patch, value: (layer as Layer & { type: 'shape' }).shape };
    }));
  }
  if (args.scene && typeof args.scene === 'object') out.scene = await expandIcons(args.scene as MotionScene);
  return out;
}

/**
 * A template's params as the model reads them: image data and other long blobs (a UI screen's
 * raster, an embedded SVG) are left out — they cost thousands of tokens on every read and the
 * model edits through the other params anyway.
 */
function paramsForModel(params: unknown, depth = 0): unknown {
  if (typeof params === 'string') return params.startsWith('data:') || params.length > 4000 ? `[${params.length} bytes omitted]` : params;
  if (Array.isArray(params)) return depth > 6 ? '[…]' : params.map((item) => paramsForModel(item, depth + 1));
  if (params && typeof params === 'object') {
    if (depth > 6) return '{…}';
    const captured = (value: unknown) => (value && typeof value === 'object' && Array.isArray((value as { parts?: unknown }).parts) ? value as { name?: string; parts: { part: string }[] } : null);
    return Object.fromEntries(Object.entries(params as Record<string, unknown>).map(([key, value]) => {
      const capture = key === 'capture' ? captured(value) : null;
      if (capture) return [key, `[capture "${capture.name ?? ''}": ${capture.parts.length} pictures of ${new Set(capture.parts.map((p) => p.part)).size} parts, kept]`];
      return [key, key === 'raster' ? '[raster omitted]' : paramsForModel(value, depth + 1)];
    }));
  }
  return params;
}

export async function runMotionTool(name: string, args: Args, ctx: MotionToolContext): Promise<ToolResult> {
  const { project } = ctx;
  switch (name) {
    case 'motion_guide': {
      const topic = str(args, 'topic');
      if (!topic) return done('Motion direction playbooks (measured on pro reference films) and style packs (whole looks taken apart frame by frame). Call motion_guide {topic} before planning that kind of film, or {topic:"pack:<id>"} for a look.', { topics: playbookIndex(), stylePacks: packCatalogue() });
      if (topic.startsWith('pack:')) {
        const pack = findPack(topic.slice(5));
        if (!pack) return fail(`No style pack "${topic.slice(5)}". Packs: ${packCatalogue().map((p) => p.id).join(', ')}.`);
        return done(`${pack.name}: ${pack.about} Build its scenes with its palette, type sizes, materials and moves.`, pack as unknown as Record<string, unknown>);
      }
      const book = playbook(topic);
      if (!book) return fail(`No playbook "${topic}". Topics: ${playbookIndex().map((p) => p.id).join(', ')}; style packs: ${packCatalogue().map((p) => `pack:${p.id}`).join(', ')}.`);
      const part = str(args, 'part');
      const data = part && part in book ? { [part]: book[part as keyof typeof book] } : book;
      return done(`${book.title} — ${book.use} Follow its beats, timing and rules; use the eases and features it names.`, data as Record<string, unknown>);
    }

    case 'create_ui_screen':
    case 'update_ui_screen':
    case 'list_ui_kinds':
    case 'capture_product_ui':
      return runUiScreenTool(name, args, ctx, runMotionTool);

    case 'create_product_demo': {
      // The real product in action (kit/productDemo.ts): a capture_app_session capture made into a
      // camera shot of layers. The camera lands on parts and pulls back to the tilted window,
      // named cursors click and type, each part changes state on its frame, and the window can
      // come apart and slam back. Placed exactly as create_motion_scene places a scene.
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the demo in.');
      // A recording (record_app_scene: the app moving, one video) or a capture (capture_app_session: still parts in states).
      const given = args.recording ?? args.capture;
      const fromRecording = args.recording !== undefined;
      let manifest: CaptureManifest | null = null;
      let recording: Recording | null = null;
      if (fromRecording) {
        if (given && typeof given === 'object' && typeof (given as Recording).video === 'string') recording = given as Recording;
        else if (typeof given === 'string' && given.trim()) {
          try { recording = await loadRecording(given); } catch (error) { return fail(errorText(error)); }
        } else return fail('Give recording: the name of a record_app_scene recording (its folder in AI Work/recordings), or its recording.json path.');
      } else if (given && typeof given === 'object' && Array.isArray((given as CaptureManifest).parts)) manifest = given as CaptureManifest;
      else if (typeof given === 'string' && given.trim()) {
        try { manifest = await loadCaptureManifest(given); } catch (error) { return fail(errorText(error)); }
      } else return fail('Give recording (a record_app_scene recording: the app moving, its own menus and typing playing inside the window) or capture (a capture_app_session session of still parts), by name.');
      const template = str(args, 'template') === 'window-explode' ? 'window-explode' : 'product-demo';
      const start = Math.max(0, num(args, 'start') ?? 0);
      const params: Args = Object.fromEntries(DEMO_PARAMS.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
      if (recording) params.recording = { name: typeof given === 'string' ? given : recording.name, dir: recording.dir, video: recording.video, width: recording.width, height: recording.height, scale: recording.scale, fps: recording.fps, duration: recording.duration, parts: recording.parts, events: recording.events };
      else if (manifest) params.capture = { name: typeof given === 'string' ? given : manifest.dir.split(/[\\/]/).pop(), dir: manifest.dir, width: manifest.width, height: manifest.height, scale: manifest.scale, parts: manifest.parts.map(({ part, state, file, boxCss, pixels, typed }) => ({ part, state, file, boxCss, pixels, ...(typed !== undefined ? { typed } : {}) })) };
      params.fps = comp.fps;
      let built: ReturnType<typeof buildDemoTemplate>;
      try {
        built = buildDemoTemplate(template, { width: comp.width, height: comp.height, ...(ctx.brand ? { brand: ctx.brand } : {}) }, params);
      } catch (error) {
        const known = recording ? `Measured parts: ${Object.keys(recording.parts).join(', ') || 'none'} (record_app_scene parts:[{part, selector}] measures more).`
          : `Parts: ${[...new Set(manifest!.parts.map((part) => `${part.part} (${manifest!.parts.filter((p) => p.part === part.part).length} state${manifest!.parts.filter((p) => p.part === part.part).length === 1 ? '' : 's'})`))].join(', ')}.`;
        return fail(`${errorText(error)} ${known}`);
      }
      const { scene, notes } = built;
      const title = str(args, 'title') ?? (template === 'window-explode' ? 'Window explode' : 'Product demo');
      const placed = await runMotionTool('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start, title, duration: scene.duration, fit: false, useBrand: false, sfx: args.sfx !== false }, ctx);
      if (!placed.ok) return placed;
      const data = placed as ToolResult & { clipId: string; compId: string; sfxClipIds: string[]; layers: { layerId: string; name: string }[] };
      // The moments worth a look: where the camera lands, every click, the slam.
      const shots = Array.isArray(args.shots) ? (args.shots as { at?: unknown }[]).map((shot) => shot?.at) : [];
      const clicks = [
        ...(Array.isArray(args.actions) ? (args.actions as { at?: unknown; click?: unknown }[]).filter((action) => action?.click !== undefined).map((action) => action.at) : []),
        ...(recording ? recording.events.filter((event) => event.kind === 'click').map((event) => event.t - (num(args, 'from') ?? 0)) : []),
        ...(Array.isArray(args.lifts) ? (args.lifts as { at?: unknown }[]).map((lift) => (typeof lift?.at === 'number' ? lift.at + 0.5 : undefined)) : []),
      ];
      const slam = template === 'window-explode' ? args.slam : (args.explode as { slam?: unknown } | undefined)?.slam;
      const moments = [...new Set([...shots, ...clicks, slam].filter((t): t is number => typeof t === 'number' && t >= 0 && t < scene.duration).map((t) => Math.round((start + Math.min(t + 0.05, scene.duration - 0.05)) * 100) / 100))].sort((a, b) => a - b).slice(0, 9);
      const byPart = new Map<string, number>();
      for (const layer of scene.layers) if (layer.type === 'footage') { const part = layer.id === 'live' ? 'live recording' : layer.id.startsWith('lift-') ? `${layer.id.slice(5)} lifted` : layer.id.split('@')[0]; byPart.set(part, (byPart.get(part) ?? 0) + 1); }
      const cursors = scene.layers.filter((layer) => layer.type === 'null' && layer.id.startsWith('cursor-') && !layer.id.endsWith('-clicks')).map((layer) => (layer.name ?? layer.id).replace(/^Cursor · /, ''));
      return done(
        `${title} placed at ${timecode(start, comp.fps)} for ${scene.duration.toFixed(2)} s as the layered comp "[Motion] ${title}" (${MOTION_FOLDER} bin): ${scene.layers.length} layers, each a clip on its own track — the window and its parts (${[...byPart].map(([part, n]) => (n > 1 ? `${part} ×${n}` : part)).join(', ')}), ${cursors.length ? `cursor${cursors.length === 1 ? '' : 's'} ${cursors.join(', ')}, ` : ''}the camera${data.sfxClipIds.length ? `, with ${data.sfxClipIds.length} sound cue${data.sfxClipIds.length === 1 ? '' : 's'} on the SFX track` : ''}.${notes.length ? ` Adjusted: ${notes.join('; ')}.` : ''} Look at it with review_frames${moments.length ? ` {"times":[${moments.join(', ')}]}` : ''}; change it with update_motion_scene {"clipId":"${data.clipId}","params":{…}} (shots, actions, cursors, stage, tilt, ${recording ? 'lifts, from' : 'explode'} rebuild it; the ${recording ? 'recording' : 'capture'} is kept).`,
        { clipId: data.clipId, compClipId: data.clipId, compId: data.compId, sfxClipIds: data.sfxClipIds, moments, notes, layers: data.layers.map(({ layerId, name: layerName }) => ({ layerId, name: layerName })) },
      );
    }

    case 'add_fx': {
      const kind = str(args, 'kind') as FxKind | undefined;
      if (!kind || !FX_KINDS.includes(kind)) return done(`Give a kind. FX: ${FX_KINDS.map((k) => `${k} (${FX_HELP[k]})`).join('; ')}.`, { kinds: FX_KINDS.map((k) => ({ kind: k, does: FX_HELP[k] })) });
      const options = { ...args, kind } as unknown as FxOptions;
      const clipId = str(args, 'clipId');
      if (clipId) {
        const got = await runMotionTool('get_motion_scene', { clipId, full: true }, ctx);
        const scene = (got as { scene?: MotionScene }).scene;
        if (!got.ok || !scene) return fail(`${clipId} is not a motion scene; leave clipId out to lay the FX over the timeline at "start".`);
        const bounds = (layerId: string, t: number) => {
          const entry = evaluateMeasured(scene, t).layers.find((l) => l.layer.id === layerId);
          return entry ? entryBounds(entry.matrix, entry.size) : null;
        };
        const made = fxLayers(options, scene, bounds);
        if (typeof made === 'string') return fail(made);
        const updated = await runMotionTool('update_motion_scene', { clipId, addLayers: made.layers, fit: false }, ctx);
        if (!updated.ok) return updated;
        return done(`Added ${kind} (${made.layers.map((l) => l.layer.id).join(', ')}) to the scene at ${num(args, 't') ?? 0} s.${made.cues.length ? ` Sound it with add_sound_effect ${made.cues.map((c) => c.sound).join(', ')} on the timeline at the scene start + ${made.cues[0].at} s.` : ''}`, { ...updated, layers: made.layers.map((l) => l.layer.id) });
      }
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the FX in.');
      const base: MotionScene = { version: 1, width: comp.width, height: comp.height, duration: 1, layers: [] };
      const made = fxLayers({ ...options, t: 0 }, base);
      if (typeof made === 'string') return fail(made);
      const longest = Math.max(0.5, ...made.layers.map((l) => (typeof l.layer.out === 'number' ? l.layer.out : num(args, 'duration') ?? 4)));
      const scene: MotionScene = { ...base, duration: longest, layers: made.layers.map((l) => l.layer), ...(made.cues.length ? { cues: made.cues } : {}) };
      return runMotionTool('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start: num(args, 'start') ?? 0, title: str(args, 'title') ?? kind, duration: longest, fit: false, useBrand: false, sfx: args.sfx !== false }, ctx);
    }

    case 'import_lottie':
      return runLottieTool(args, ctx, runMotionTool);

    case 'create_character':
    case 'animate_character':
    case 'lip_sync_character':
    case 'list_character_actions':
    case 'list_characters':
      return runCharacterTool(name, args, ctx, runMotionTool, async () => {
        const comp = ctx.pickComp(project, args);
        return comp ? compWords(comp, ctx) : [];
      });

    case 'check_pacing': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to check.');
      const genre = str(args, 'genre');
      const book = genre ? playbook(genre) : null;
      if (genre && !book) return fail(`No genre "${genre}". Genres: ${playbookIndex().map((p) => p.id).join(', ')}.`);
      const target: PacingTarget = { ...(book?.pacing ?? GENERIC_TARGET), ...((obj(args, 'target') as PacingTarget | undefined) ?? {}) };
      const beats = Array.isArray(args.beats) ? (args.beats as unknown[]).filter((b): b is number => typeof b === 'number') : undefined;
      const report = pacingReport(project, comp, target, beats);
      return done(`${report.summary}${genre ? ` (genre ${genre})` : args.target ? ' (reference target)' : ' (generic target; pass genre or a reference pacingTarget)'}`, { checks: report.checks, ok: report.ok, target });
    }

    case 'list_transitions':
      return done(`${TRANSITION_KINDS.length} motion transitions for create_motion_sequence (between beats inside one scene; for cuts between footage clips use add_transition / seamless_transition, or lay the flash-bridge / glow-handoff templates over the cut). Give {kind, duration?, direction?, glyph?, mode?, at?, to?, size?, strength?, color?, twist?}.`, { transitions: TRANSITION_KINDS.map((kind) => ({ kind, does: TRANSITION_HELP[kind] })) });

    case 'create_motion_sequence': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the sequence in.');
      const list = Array.isArray(args.beats) ? (args.beats as Args[]) : [];
      if (list.length < 1 || list.length > 24) return fail('Give 1–24 beats: each {template, params} (list_motion_templates), {ui: {…create_ui_screen args}}, {scene}, or {clipId} of an existing motion clip.');
      const start = Math.max(0, num(args, 'start') ?? 0);
      const brand = args.useBrand === false ? null : ctx.brand ?? null;
      const background = typeof args.background === 'string' ? args.background : null;
      const beats: SeqBeat[] = [];
      for (const [i, beat] of list.entries()) {
        let scene: MotionScene | null = null;
        const namedBeat = str(beat, 'template');
        const templateId = namedBeat ? resolveTemplateId(namedBeat, MOTION_TEMPLATES) ?? namedBeat : namedBeat;
        try {
          if (templateId) {
            const spec = findTemplate(templateId);
            if (!spec) return fail(`beats[${i}]: no motion template "${templateId}".`);
            // Each beat's params fixed as create_motion_scene fixes them (templateFix.ts).
            const slots = slotsFor(spec.id, spec.params);
            const fixed = slots ? fixTemplateArgs(spec.id, slots, obj(beat, 'params') ?? {}) : null;
            if (slots && fixed?.error) return fail(`beats[${i}]: ${fixed.error} Its params: ${describeSlots(slots)}.`);
            const raw = fixed?.args ?? obj(beat, 'params') ?? {};
            const missingBeat = slots ? missingSlots(slots, raw) : [];
            if (slots && missingBeat.length) return fail(`beats[${i}]: ${spec.id} needs ${missingBeat.join(' and ')} in params. Its params: ${describeSlots(slots)}.`);
            const params = resolveParams(raw, ctx, start);
            // Over the sequence's own background the beats draw no stage of their own.
            if (background && 'background' in spec.params && raw.background === undefined) params.background = 'none';
            const kit: KitContext = { width: comp.width, height: comp.height, ...(brand ? { brand, font: brand.fonts.display } : {}) };
            scene = buildInBrand(spec, kit, params, brand);
          } else if (obj(beat, 'ui')) {
            const built = await buildUiScene(obj(beat, 'ui')!, ctx, comp);
            if (typeof built === 'string') return fail(`beats[${i}] (ui): ${built}`);
            scene = built;
          } else if (obj(beat, 'scene')) {
            scene = { version: 1, width: comp.width, height: comp.height, ...(obj(beat, 'scene') as object) } as MotionScene;
            if (brand) scene = brandifyScene(scene, brand);
          } else if (str(beat, 'clipId')) {
            const got = await runMotionTool('get_motion_scene', { clipId: str(beat, 'clipId'), full: true }, ctx);
            scene = (got as { scene?: MotionScene }).scene ?? null;
            if (!scene) return fail(`beats[${i}]: ${str(beat, 'clipId')} is not a motion scene.`);
          } else return fail(`beats[${i}] needs template, ui, scene or clipId.`);
        } catch (error) {
          return fail(`beats[${i}] could not be built: ${errorText(error)}`);
        }
        scene = await expandIcons(scene);
        const problems = validateScene(scene);
        if (problems.length) return fail(`beats[${i}] is not valid: ${problems.slice(0, 5).join(' ')}`);
        const hold = num(beat, 'hold') ?? num(beat, 'duration');
        if (hold && hold > scene.duration) scene = { ...scene, duration: hold };
        beats.push({ scene, name: str(beat, 'name') ?? str(beat, 'title') ?? (templateId ? findTemplate(templateId)?.label : obj(beat, 'ui') ? 'UI screen' : undefined), ...(hold ? { hold } : {}) });
      }
      const transitions = Array.isArray(args.transitions) ? (args.transitions as (SeqTransition | TransitionKind)[]) : [];
      const bad = transitions.map((t) => (typeof t === 'string' ? t : t?.kind)).filter((k) => !TRANSITION_KINDS.includes(k as TransitionKind));
      if (bad.length) return fail(`Unknown transition${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}. See list_transitions.`);
      const layout = args.layout === 'world' ? 'world' : 'cuts';
      const guide = obj(args, 'guide') as Parameters<typeof compileSequence>[0]['guide'] | undefined;
      const compiled = compileSequence({ width: comp.width, height: comp.height, beats, transitions, layout, world: obj(args, 'world') as never, background, guide, sfx: args.sfx !== false });
      const title = str(args, 'title') ?? 'Motion sequence';
      const placed = await runMotionTool('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene: compiled.scene, start, title, duration: compiled.duration, fit: false, useBrand: false, sfx: args.sfx !== false }, ctx);
      if (!placed.ok) return placed;
      return done(`${placed.summary} ${beats.length} beat${beats.length === 1 ? '' : 's'} in one ${layout === 'world' ? 'world (the camera trucks between them; the background never cuts)' : 'scene'}; beats start at ${compiled.starts.map((t) => (start + t).toFixed(2)).join(', ')} s (timeline) and cut at ${compiled.cuts.map((t) => (start + t).toFixed(2)).join(', ')} s.`, { ...placed, starts: compiled.starts.map((t) => Math.round((start + t) * 1000) / 1000), cuts: compiled.cuts.map((t) => Math.round((start + t) * 1000) / 1000) });
    }

    case 'list_3d_presets': {
      let status: Awaited<ReturnType<typeof api.blenderStatus>> | null = null;
      try { status = await api.blenderStatus(); } catch { status = null; }
      return done(`${PRESETS_3D.length} 3D presets rendered in headless Blender${status?.found ? ` (${status.version ?? 'Blender'} found)` : ' — Blender is NOT installed on this machine: ' + (status?.hint ?? 'install Blender 4.2+ from blender.org')}. Render one with render_3d_scene {"preset":"<id>","params":{…},"start":<s>}; or write a raw scene (objects of kind box/rounded-box/sphere/icosphere/torus/cylinder/cone/capsule/crystal/text/floor, material presets plastic/glass/frosted/pearl/metal/gem/clay/emission/flat, world colour or gradient, camera with keys). Draft (EEVEE, ~0.7 s/frame) first; quality "final" (Cycles GPU, ~3 s/frame) for the export.`, {
        blender: status, presets: PRESETS_3D.map(({ id, label, use, params, seconds }) => ({ id, label, use, params, seconds })),
      });
    }

    case 'render_3d_scene': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the render in.');
      const start = Math.max(0, num(args, 'start') ?? 0);
      let jobId = str(args, 'jobId');
      const title = str(args, 'title') ?? '3D render';
      if (!jobId) {
        const quality = str(args, 'quality') === 'final' ? 'final' : 'draft';
        const duration = clamp(num(args, 'duration') ?? 4, 0.1, 60);
        // Full comp size and rate, so the render drops straight in.
        const frame = { width: comp.width, height: comp.height, fps: Math.round(comp.fps), duration };
        let request;
        try {
          request = scene3dRequest({ preset: str(args, 'preset'), params: obj(args, 'params'), scene: obj(args, 'scene') as never }, frame, quality);
        } catch (error) { return fail(errorText(error)); }
        const step = num(args, 'step');
        if (step) request.step = Math.max(1, Math.round(step));
        try {
          jobId = await api.blenderRenderStart(request, title);
        } catch (error) { return fail(`Blender could not start: ${errorText(error)}`); }
      }
      // Wait for the job; the turn ending stops the wait, not the render.
      const deadline = Date.now() + clamp(num(args, 'waitMinutes') ?? 20, 0.1, 120) * 60_000;
      let render: Render3DResult | null = null;
      while (Date.now() < deadline) {
        if (ctx.signal?.aborted) return fail(`The turn ended while Blender was rendering; the job continues. Place it later with render_3d_scene {"jobId":"${jobId}"}.`);
        const job = (await api.jobsList()).find((entry) => entry.id === jobId);
        if (!job) return fail(`No render job ${jobId}.`);
        if (job.status === 'done') { render = job.result as unknown as Render3DResult; break; }
        if (job.status === 'error' || job.status === 'cancelled') return fail(`The 3D render ${job.status === 'cancelled' ? 'was cancelled' : `failed: ${job.message}`}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!render?.dir) return fail(`Blender is still rendering (job ${jobId}); place it later with render_3d_scene {"jobId":"${jobId}"}.`);
      // Blender's camera as a motion-engine camera (3D layers then sit in the render's space), and nulls on tracked objects.
      const extras: Layer[] = [];
      const readJson = async <T,>(path?: string): Promise<T | null> => { if (!path) return null; try { return (await (await fetchFile(path)).json()) as T; } catch { return null; } };
      if (args.syncCamera !== false) { const cam = await readJson<CameraFile>(render.camera); if (cam?.frames?.length) extras.push(cameraLayer(cam)); }
      const track = Array.isArray(args.track) ? (args.track as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (track.length) { const objects = await readJson<ObjectsFile>(render.objects2d); if (objects?.frames?.length) extras.push(...trackLayers(objects, track)); }
      const scene = renderScene(render, comp, title, extras);
      if (args.place === false) return done(`3D render ready: ${render.frames} frame(s) in ${render.dir}. Add "layer" to any motion scene (update_motion_scene addLayers) to composite it.`, { render, layer: scene.layers[0], jobId });
      const placed = await runMotionTool('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start, title, duration: scene.duration, fit: false, sfx: false, useBrand: false }, ctx);
      if (!placed.ok) return placed;
      return done(`${placed.summary} The 3D frames (${render.frames}, with alpha) came from headless Blender; camera.json and objects2d.json beside them give the camera and each object's screen box per frame, so 2D layers (glints, callouts, UI) can track it. Re-render the same scene with quality "final" for the export.`, { ...placed, render, layer: scene.layers[0], jobId });
    }

    case 'search_icons': {
      const query = str(args, 'query');
      if (!query) return fail('Give a query, e.g. "shield", "chart", "user plus", "sparkle".');
      const names = await searchIcons(query, Math.min(60, Math.max(1, num(args, 'limit') ?? 24)));
      return done(names.length ? `${names.length} Lucide icon${names.length === 1 ? '' : 's'}. Use one in a shape layer: {"kind":"icon","icon":"<name>","iconSize":120,"color":"#fff","position":[x,y]} inside shape.groups.` : 'No icon matches; try a simpler word.', { icons: names });
    }

    case 'svg_to_shape': {
      let svg = str(args, 'svg');
      const path = str(args, 'path');
      if (!svg && path) {
        try {
          const response = await fetchFile(path);
          if (!response.ok) return fail(`Could not read ${path}.`);
          svg = await response.text();
        } catch (error) { return fail(`Could not read ${path}: ${errorText(error)}`); }
      }
      if (!svg || !/<svg[\s>]/i.test(svg)) return fail('Give an SVG file path or svg markup.');
      const fitArg = Array.isArray(args.fit) ? (args.fit as number[]) : null;
      const result = svgToShape(svg, { fit: fitArg && fitArg.length >= 2 ? [fitArg[0], fitArg[1]] : undefined, color: str(args, 'color') });
      if (!result.groups.length) return fail('The SVG draws nothing the engine can read (no paths or shapes).');
      return done(`${result.groups.length} vector path${result.groups.length === 1 ? '' : 's'}, ${Math.round(result.bounds[0])}×${Math.round(result.bounds[1])} px. Place it as a shape layer: {"type":"shape","shape":{"shape":"path","groups":<groups>,"bounds":<bounds>}} — then trim its strokes, animate groups, or recolour paths.`, { groups: result.groups, bounds: result.bounds });
    }

    case 'check_motion_arcs': {
      // The flip test: dot-to-dot paths of every moving layer and named drawing item.
      const target = resolveMotion(project, str(args, 'clipId') ?? str(args, 'compId') ?? '');
      if (!target) return fail('Supply clipId: a "[Motion]" comp clip on the timeline, one of its layer clips, the comp id itself, or a motion scene clip.');
      const scene = target.kind === 'stack' ? logicalScene(project, target.comp) : (target.clip.source as MotionSource).scene;
      if (!scene) return fail('That comp has no motion layers.');
      const report = motionReport(scene);
      return done(`${report.summary}${report.issues.length ? ' Fix each with update_motion_scene patches (arc, through, ease, easeAxes on the key that starts the move), then run it again.' : ''}`, {
        issues: report.issues,
        paths: report.tracks.map((tr) => ({ target: tr.target, from: tr.points[0]?.map(Math.round), to: tr.points[tr.points.length - 1]?.map(Math.round) })),
      });
    }

    case 'list_drawn_styles': {
      const part = str(args, 'part');
      const catalog = drawnCatalog() as Record<string, unknown>;
      const data = part && part in catalog ? { [part]: catalog[part] } : catalog;
      return done('The drawn-styles library (docs/DRAWN-STYLES.md): hand-made looks as one `drawing` layer — riso print, crayon, ink, pencil, cut paper, felt, scope — with motifs, characters, hand-writing, the pen tool and transitions. Use a template (create_motion_scene {template:"pen-draws"|"paper-words"|…}) or write your own drawing layer from these parts (see example), and read motion_guide {topic:"hand-made"} for the timing and rules.', data);
    }

    case 'list_motion_templates': {
      const query = str(args, 'query')?.toLowerCase();
      const exact = query ? MOTION_TEMPLATES.filter((spec) => spec.id.toLowerCase() === query) : [];
      const specs = exact.length ? exact : MOTION_TEMPLATES.filter((spec) => !query || `${spec.id} ${spec.label} ${spec.use} ${spec.technique}`.toLowerCase().includes(query));
      // The whole catalogue with every param set is ~22 KB; a model re-reads it each round. The
      // list is the menu; params come with a narrow query (a template id, or a word matching few).
      const detailed = !!query && specs.length <= 8;
      // A house (Crimson) template asked for by id or name: its schema and example, for create_motion_graphic.
      const house = query ? CRIMSON_TEMPLATES.filter((spec) => spec.id === query || (!exact.length && `${spec.id} ${spec.label}`.toLowerCase().includes(query))).slice(0, 4) : [];
      // Compact: one line of typed slots (templateSlots.ts); the prose only for footage and nested objects.
      const described = (spec: (typeof MOTION_TEMPLATES)[number]) => {
        const slots = slotsFor(spec.id, spec.params) ?? {};
        const complex = Object.fromEntries(Object.entries(spec.params).filter(([name]) => slots[name]?.kind === 'any'));
        return { id: spec.id, label: spec.label, technique: spec.technique, use: spec.use, slots: describeSlots(Object.fromEntries(Object.entries(slots).filter(([name]) => !(name in complex)))), ...(Object.keys(complex).length ? { params: complex } : {}), ...(exampleCall(spec.id) ? { example: exampleCall(spec.id) } : {}), ...(thumbnailUrl(spec.id) ? { thumbnail: thumbnailUrl(spec.id) } : {}), seconds: spec.seconds, fullFrame: spec.fullFrame };
      };
      return done(`${specs.length} motion template${specs.length === 1 ? '' : 's'}${house.length ? ` and ${house.length} house template${house.length === 1 ? '' : 's'} (create_motion_graphic)` : ''}. ${detailed ? 'Copy an example and change its words; ' : 'Params are listed when you query a template id (list_motion_templates {"query":"<id>"}). '}Build one with create_motion_scene {"template":"<id>","params":{…},"start":<s>}. Footage params accept {"clipId":"…"} (asset, source time and roto matte are filled in) or {"assetId":"…"}.`, {
        templates: specs.map((spec) => (detailed ? described(spec) : { id: spec.id, label: spec.label, use: spec.use, seconds: spec.seconds })),
        ...(house.length ? { house: house.map((spec) => ({ id: spec.id, label: spec.label, use: spec.use, tool: 'create_motion_graphic', slots: describeSlots(CRIMSON_SLOTS[spec.id]), example: exampleCall(spec.id), thumbnail: thumbnailUrl(spec.id), seconds: spec.seconds })) } : {}),
        ...(detailed ? { effects: EFFECT_TYPES } : {}),
      });
    }

    case 'create_motion_scene': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the scene in.');
      const start = Math.max(0, num(args, 'start') ?? 0);
      // The active brand kit drives every scene unless the call opts out with useBrand:false.
      const brand = args.useBrand === false ? null : ctx.brand ?? null;
      const kit: KitContext = { width: comp.width, height: comp.height, ...(brand ? { brand, font: brand.fonts.display } : {}) };
      const accent = str(args, 'accent');
      if (accent) kit.palette = { accent: toHex(accent) ?? accent };
      let scene: MotionScene;
      let fixNotes: string[] = [];
      let fixAdjustments: Adjustment[] = [];
      // An id written loosely ("Brand title", "BRAND_TITLE") is read as the template it names.
      const namedTemplate = str(args, 'template');
      const templateId = namedTemplate ? resolveTemplateId(namedTemplate, MOTION_TEMPLATES) ?? namedTemplate : namedTemplate;
      let plateNote = '';
      // The demo templates build from a capture on disk: create_product_demo loads it first.
      if (templateId === 'product-demo' || templateId === 'window-explode') {
        return runMotionTool('create_product_demo', { ...(args.capture !== undefined ? { capture: args.capture } : {}), ...(obj(args, 'params') ?? {}), template: templateId, start, ...(args.compId ? { compId: args.compId } : {}), ...(str(args, 'title') ? { title: str(args, 'title') } : {}), ...(args.sfx === false ? { sfx: false } : {}) }, ctx);
      }
      if (templateId) {
        const spec = findTemplate(templateId);
        if (!spec) return fail(`No motion template "${templateId}". Templates: ${MOTION_TEMPLATES.map((s) => s.id).join(', ')}.`);
        // What a weaker model sends, made into what the template takes (templateFix.ts); text a
        // template needs and was not given is asked for, never drawn as a placeholder.
        const slots = slotsFor(spec.id, spec.params);
        const fixed = slots ? fixTemplateArgs(spec.id, slots, obj(args, 'params') ?? {}) : null;
        if (slots && fixed?.error) return fail(`${fixed.error}${fixSummary(fixed.notes)} Its params: ${describeSlots(slots)}.`);
        fixNotes = fixed?.notes ?? [];
        fixAdjustments = fixed?.adjustments ?? [];
        const raw = fixed?.args ?? obj(args, 'params') ?? {};
        const missing = slots ? missingSlots(slots, raw) : [];
        if (slots && missing.length) return fail(`${spec.id} needs ${missing.join(' and ')} in params. Its params: ${describeSlots(slots)}.`);
        const params = resolveParams(raw, ctx, start);
        // Over a designed background plate a full-frame brand template draws no stage of its own:
        // its light, flat brand stage covered the plate and read as a blank white frame.
        if ('background' in spec.params && raw.background === undefined) {
          const plate = backgroundPlate(ctx, comp, start, start + (num(args, 'duration') ?? spec.seconds));
          if (plate) {
            params.background = 'none';
            plateNote = ` It sits over the background plate "${plate}", so it draws no stage of its own (background "none").`;
          }
        }
        // The subject reveal wants a face and a clean plate: find both when the AI did not.
        if (templateId === 'subject-reveal' || templateId === 'big-number-behind') {
          const subjectRef = raw.subject as Args | undefined;
          const found = subjectRef && typeof subjectRef.clipId === 'string' ? findClip(project, subjectRef.clipId) : null;
          if (found && !found.clip.rotoMatte) return fail(`Run rotoscope_clip on ${found.clip.id} first: ${templateId} is cut from the subject's matte.`);
          if (found && templateId === 'subject-reveal' && !params.face) {
            const face = await faceFromRoto(found.clip, sourceTimeAt(found.clip, start), comp.width, comp.height);
            if (face) params.face = face;
          }
          if (found && !params.plate && found.clip.source.type === 'media') {
            const plate = cleanPlateFor(ctx, found.comp, start);
            if (plate) params.plate = plate;
          }
        }
        try {
          scene = buildInBrand(spec, kit, params, brand);
        } catch (error) {
          return fail(`The ${templateId} template could not be built: ${errorText(error)}`);
        }
      } else {
        const rawScene = obj(args, 'scene');
        if (!rawScene) return fail('Give a template id (list_motion_templates) or a raw scene {version:1,width,height,duration,layers:[…]}.');
        scene = { version: 1, width: comp.width, height: comp.height, ...(rawScene as object) } as MotionScene;
        if (brand) scene = brandifyScene(scene, brand);
      }
      const duration = clamp(num(args, 'duration') ?? scene.duration, 1 / comp.fps, 600);
      scene = { ...scene, duration: Math.max(scene.duration, duration) };
      // Times written as {word:"…"} land where the voice-over says it (transcripts of the comp's media).
      if (hasWordRefs(scene)) {
        const words = await compWords(comp, ctx);
        if (!words.length) return fail('The scene times text to spoken words ({word:…}) but no clip on this comp has a transcript yet: transcribe the voice-over first.');
        const resolved = resolveWordTimes(scene, words, start);
        if (resolved.missing.length) return fail(`These words are not in the timeline transcript: ${resolved.missing.map((w) => `"${w}"`).join(', ')}. Use the exact spoken words.`);
        scene = resolved.scene;
      }
      // Icons become plain paths now, so the saved scene never depends on the icon library.
      const missingIcons = await unknownIcons(scene);
      if (missingIcons.length) return fail(`Unknown icon name${missingIcons.length > 1 ? 's' : ''}: ${missingIcons.join(', ')}. Find names with search_icons.`);
      scene = await expandIcons(scene);
      const problems = validateScene(scene);
      if (problems.length) return fail(`The scene is not valid: ${problems.slice(0, 8).join(' ')}`);
      // Type, panels and cards rest inside the safe area: the frame is the design's boundary.
      const fit = args.fit === false ? null : fitToSafeArea(scene, { margin: safeMargin(args) });
      if (fit) scene = fit.scene;
      const title = str(args, 'title') ?? findTemplate(templateId ?? '')?.label ?? 'Motion scene';
      const nest = args.nest !== false;
      const placed = trackAbove(comp, start, start + duration);
      // Everything the AI builds lives in its own comp ("[Motion] title", in the AI Motion bin),
      // opened into layers — one clip per layer on its own track, as After Effects shows a comp —
      // and the timeline gets one nested clip the user can move, trim or open.
      const exploded = nest ? explodeScene(scene, { name: `[Motion] ${title}`, fps: comp.fps, width: comp.width, height: comp.height }) : null;
      const clip = exploded
        ? newClip({ trackId: placed.track.id, start, duration, source: { type: 'comp', compId: exploded.comp.id }, name: exploded.comp.name, label: 'mango' })
        : newClip({ trackId: placed.track.id, start, duration, source: { type: 'motion', scene, title }, name: title, label: 'mango' });
      let next = placeClips(placed.comp, [clip], 'overwrite');
      let sfx: string[] = [];
      if (args.sfx !== false && scene.cues?.length) {
        const cued = placeCues(next, scene, start);
        next = cued.comp;
        sfx = cued.ids;
      }
      if (exploded) {
        ctx.commit((current) => {
          const folderId = current.folders.find((f) => f.name === MOTION_FOLDER && f.parentId === null)?.id ?? `folder_${exploded.comp.id}`;
          const folders = current.folders.some((f) => f.id === folderId) ? current.folders : [...current.folders, { id: folderId, name: MOTION_FOLDER, parentId: null }];
          return { ...current, folders, comps: [...current.comps.map((c) => (c.id === comp.id ? next : c)), ...[exploded.comp, ...exploded.nested].map((c) => ({ ...c, folderId }))] };
        });
      } else ctx.editComp(comp, () => next);
      const layers = exploded?.layers.filter((layer) => layer.compId === exploded.comp.id) ?? [];
      return done(`${title} placed at ${timecode(start, comp.fps)} for ${duration.toFixed(2)} s${brand ? ` in the "${brand.name}" brand (colours, fonts, eases and timing from its guideline)` : ''}${exploded ? ` as the layered comp "${exploded.comp.name}" (${MOTION_FOLDER} bin): ${layers.length} layer${layers.length === 1 ? '' : 's'} — ${layers.map((layer) => layer.name).join(', ')} — each a clip on its own track, so the user can open it and move, trim, hide or restyle any layer${exploded.nested.length ? ` (precomps open as their own layered comps)` : ''}` : ''}, on its own track above the footage${sfx.length ? `, with ${sfx.length} sound cue${sfx.length === 1 ? '' : 's'} on the SFX track (sound_the_motion sets them against the music)` : ''}.${plateNote}${fitReport(fit, safeMargin(args))}${lightStageNote(scene)} Preview and export use the same GPU renderer. Check it with run_frame_qa (it now renders motion graphics into the contact frames); change it with update_motion_scene {"clipId":"${clip.id}"} — params rebuild the template, patches edit a layer by its id.${fixSummary(fixNotes)}`, {
        ...(fixAdjustments.length ? { adjustments: fixAdjustments } : {}),
        clipId: clip.id, compClipId: clip.id, compId: exploded?.comp.id ?? comp.id, sfxClipIds: sfx,
        layers: exploded?.layers.map(({ layerId, clipId, compId, name, type, start: from, end }) => ({ layerId, clipId, compId, name, type, start: from, end })) ?? [],
        outline: summarizeScene(scene),
      });
    }

    case 'sound_the_motion': {
      // Phase 5.1: a sound on every motion cue, each set against the music where it plays, so the
      // clicks and whooshes the picture asks for are heard (cueSound.ts has the arithmetic).
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('Choose a composition.');
      const from = Math.max(0, num(args, 'start') ?? 0);
      const to = num(args, 'end') ?? Infinity;
      if (!motionCues(project, comp, from, to).length) return fail('No motion cues in that range: no motion scene there carries sound cues (templates and UI screens do). Place sounds by hand with add_sound_effect.');
      const swapArg = obj(args, 'swap') ?? {};
      const swap: Partial<Record<string, SfxKind>> = Object.fromEntries(Object.entries(swapArg).flatMap(([cue, kind]) => (SFX_KINDS.includes(kind as SfxKind) ? [[cue, kind as SfxKind]] : [])));
      const skip = Array.isArray(args.skip) ? (args.skip as unknown[]).filter((kind): kind is string => typeof kind === 'string') : [];
      const offsetDb = clamp(num(args, 'offsetDb') ?? 0, -12, 12);
      // The music's waveform buckets, loaded before anything is changed.
      const beds: MusicBed[] = [];
      for (const clip of comp.clips) {
        if (clip.source.type !== 'media') continue;
        const asset = ctx.assets.get(clip.source.assetId);
        if (!asset?.peaks || !isMusicClip(comp, clip, asset.name)) continue;
        const peaks = await loadPeaks(asset.peaks);
        if (peaks) beds.push({ clip, peaks });
      }
      type Row = { clipId: string; at: number; kind: SfxKind; gainDb: number; against: 'music' | 'no-music'; capped: boolean; existing: boolean };
      const rows: Row[] = [];
      let silenced = 0;
      ctx.commit((current) => {
        const top = current.comps.find((c) => c.id === comp.id);
        if (!top) return current;
        const cues = motionCues(current, top, from, to);
        const placements = cuePlacements(cues, { swap, skip });
        const placed = placedSounds(current, top);
        const taken = new Set<string>();
        // The sound already on a cue (create_motion_scene lays each scene's cues): the kind it
        // plays now, or the one the cue asked for before this film swapped it.
        const onCue = (kinds: string[], at: number) => placed.find((sound) => !taken.has(sound.clip.id) && kinds.includes(sound.kind) && Math.abs(sound.at - at) < 0.06);
        // Changes to those sounds, by comp; null takes one off.
        const changes = new Map<string, Map<string, Partial<Clip> | null>>();
        const change = (sound: PlacedSound, patch: Partial<Clip> | null) => changes.set(sound.compId, (changes.get(sound.compId) ?? new Map()).set(sound.clip.id, patch));
        let next = top;
        for (const placement of placements) {
          const level = cueLevel(placement.kind, musicDbOver(beds, placement.loud[0], placement.loud[1]), offsetDb);
          const volume = clamp(10 ** (level.gainDb / 20), 0, 8);
          const row = { at: Math.round(placement.start * 100) / 100, kind: placement.kind, gainDb: level.gainDb, against: level.against, capped: level.capped };
          const there = onCue([placement.kind, placement.cue], placement.start);
          if (there) {
            taken.add(there.clip.id);
            // Re-levelled, never doubled: a swapped cue's sound becomes the new one, and a riser
            // laid whole is trimmed so its top meets the hit, as a fresh one would be.
            const swapped = there.kind !== placement.kind;
            const resound = swapped || placement.kind === 'riser';
            change(there, {
              volume,
              ...(resound ? { source: { type: 'sfx' as const, kind: placement.kind }, in: placement.in, duration: placement.duration } : {}),
              ...(swapped ? { name: sfxClipFields(placement.kind, placement.note).name } : {}),
            });
            rows.push({ ...row, clipId: there.clip.id, existing: true });
            continue;
          }
          const target = sfxTrack(next, placement.start, placement.start + placement.duration);
          const clip = newClip({ trackId: target.track.id, start: placement.start, in: placement.in, duration: placement.duration, source: { type: 'sfx', kind: placement.kind }, ...sfxClipFields(placement.kind, placement.note, volume) });
          next = placeClips(target.comp, [clip], 'overwrite');
          rows.push({ ...row, clipId: clip.id, existing: false });
        }
        // A skipped cue is left silent: the sound already on it goes too.
        for (const cue of cues) {
          if (!skip.includes(cue.sound)) continue;
          const there = onCue([cue.sound, swap[cue.sound] ?? cue.sound], Math.max(0, cue.at));
          if (!there) continue;
          taken.add(there.clip.id);
          change(there, null);
          silenced++;
        }
        const apply = (c: Comp) => {
          const edits = changes.get(c.id);
          if (!edits) return c;
          return { ...c, clips: c.clips.flatMap((clip) => {
            if (!edits.has(clip.id)) return [clip];
            const patch = edits.get(clip.id);
            return patch ? [{ ...clip, ...patch } as Clip] : [];
          }) };
        };
        return { ...current, comps: current.comps.map((c) => apply(c.id === top.id ? next : c)) };
      });
      const offNote = silenced ? ` ${silenced} sound${silenced === 1 ? ' on a skipped cue' : 's on skipped cues'} taken off.` : '';
      if (!rows.length) return silenced ? done(`Every cue in that range was skipped.${offNote}`, { cues: rows, silenced }) : fail('Every cue in that range was skipped.');
      const added = rows.filter((row) => !row.existing).length;
      const capped = rows.filter((row) => row.capped);
      const unscored = rows.filter((row) => row.against === 'no-music').length;
      const kinds = [...new Set(rows.map((row) => row.kind))].map((kind) => {
        const of = rows.filter((row) => row.kind === kind);
        return `${kind} ×${of.length} (${Math.min(...of.map((row) => row.gainDb))} to ${Math.max(...of.map((row) => row.gainDb))} dB)`;
      });
      return done(
        `Sounded ${rows.length} motion cue${rows.length === 1 ? '' : 's'}: ${added} placed on the SFX track, ${rows.length - added} already there set to their new level. ${beds.length ? `Each sits about 6 dB under the music's peak at its moment` : 'There is no music on this timeline, so each keeps its default level under the voice; run this again once the music is in'}: ${kinds.join(', ')}.${capped.length ? ` ${capped.length} could not get that loud without clipping (first at ${timecode(capped[0].at, comp.fps)}): duck the music under them with score_audio_clip.` : ''}${beds.length && unscored ? ` ${unscored} play where no music does and keep their default level.` : ''}${offNote} Change one like any clip; review_frames checks they are heard.`,
        { cues: rows, ...(silenced ? { silenced } : {}) },
      );
    }

    case 'layout_panels': {
      // The stacked-screenshots fix (panelLayout.ts): the scene's resting pictures and cards get
      // slots that never overlap, each keeping its shape, applied as update_motion_scene patches.
      const ref = str(args, 'clipId') ?? str(args, 'compId') ?? '';
      const target = resolveMotion(project, ref);
      if (!target) return fail('Supply clipId: a "[Motion]" comp clip on the timeline, one of its layer clips, the comp id itself, or a motion scene clip.');
      const scene = target.kind === 'stack' ? layeredCompScene(project, target.comp) ?? logicalScene(project, target.comp) : (target.clip.source as MotionSource).scene;
      if (!scene) return fail('That comp has no motion layers.');
      const arrangement = str(args, 'arrangement');
      const plan = planPanelLayout(scene, {
        at: num(args, 'at'),
        layers: Array.isArray(args.layers) ? (args.layers as unknown[]).filter((id): id is string => typeof id === 'string') : undefined,
        arrangement: arrangement === 'row' || arrangement === 'column' || arrangement === 'grid' || arrangement === 'feature' ? arrangement : 'auto',
        gap: num(args, 'gap'),
        margin: num(args, 'safeMargin'),
      });
      if (typeof plan === 'string') return fail(plan);
      const skipped = plan.skipped.length ? ` Left alone: ${plan.skipped.join('; ')}.` : '';
      if (!plan.patches.length) return done(`The ${plan.panels.length} panel(s) resting at ${plan.at} s already sit in their ${plan.arrangement} slots: nothing to move.${skipped}`, { arrangement: plan.arrangement, panels: plan.panels });
      const updated = await runMotionTool('update_motion_scene', { ...(target.kind === 'stack' ? { compId: target.comp.id } : { clipId: target.clip.id }), patches: plan.patches, fit: false }, ctx);
      if (!updated.ok) return updated;
      return done(`Laid out ${plan.panels.length} panel(s) as a ${plan.arrangement} at ${plan.at} s, each its own shape, none on another, inside the safe area: ${describePlan(plan)}. Entrances and exits keep their motion, shifted to the new places.${skipped} Check it with review_frames, or run it again with another arrangement (row, column, grid, feature).`,
        { arrangement: plan.arrangement, at: plan.at, panels: plan.panels, patches: plan.patches.length });
    }

    case 'get_motion_scene': {
      const target = resolveMotion(project, str(args, 'clipId') ?? str(args, 'compId') ?? '');
      if (!target) return fail('Supply clipId: a "[Motion]" comp clip on the timeline, one of its layer clips, the comp id itself, or a motion scene clip.');
      if (target.kind === 'stack') {
        const scene = logicalScene(project, target.comp);
        if (!scene) return fail('That comp has no motion layers.');
        const layers = layerListing(project, target.comp);
        const drawn = layeredCompScene(project, target.comp) ?? scene;
        const layout = layoutIssues(drawn, { margin: safeMargin(args) });
        // Timeline-only edits inside a precomp's comp that its precomp layer cannot draw.
        const lossy = stackLossy(project, target.comp);
        return done(`"${target.comp.name}": ${layers.length} layer clip${layers.length === 1 ? '' : 's'} (${layers.map((layer) => layer.name).join(', ')}), ${scene.duration.toFixed(2)} s${scene.template ? `, built from ${scene.template.id}` : ''}.${layout.length ? ` ${describeLayout(layout)}` : ' Everything rests inside the safe area.'}${lossy.length ? ` Not drawn in the precomp: ${lossy.join('; ')}.` : ''} Edit a layer with update_motion_scene patches by its layerId, or its clip on the comp's timeline.`, {
          compId: target.comp.id,
          layers,
          outline: summarizeScene(scene),
          layout,
          ...(lossy.length ? { lossy } : {}),
          ...(args.full === true ? { scene } : {}),
          ...(scene.template ? { templateParams: paramsForModel(scene.template.params) } : {}),
        });
      }
      const scene = (target.clip.source as MotionSource).scene;
      return done(`${(target.clip.source as MotionSource).title ?? 'Motion scene'}: ${scene.layers.length} layers, ${scene.duration.toFixed(2)} s${scene.template ? `, built from ${scene.template.id}` : ''}. It is one clip; split_motion_layers opens it into a clip per layer.`, {
        outline: summarizeScene(scene),
        ...(args.full === true ? { scene } : {}),
        ...(scene.template ? { templateParams: paramsForModel(scene.template.params) } : {}),
      });
    }

    case 'update_motion_scene': {
      const target = resolveMotion(project, str(args, 'clipId') ?? str(args, 'compId') ?? '');
      if (!target) return fail('Supply clipId: a "[Motion]" comp clip on the timeline, one of its layer clips, the comp id itself, or a motion scene clip.');
      if (target.kind === 'stack') return updateStack(target.comp, await withIcons(args), ctx);
      const { clip, comp } = target;
      const source = clip.source as MotionSource;
      const edit = editScene(source.scene, await withIcons(args), ctx, clip.start);
      if ('error' in edit) return fail(edit.error);
      const { scene, changes, retime } = edit;
      const duration = retime ? clip.duration * retime : Math.max(clip.duration, Math.min(scene.duration, clip.duration));
      ctx.commit((current) => {
        const edited = { ...current, comps: current.comps.map((c) => (c.id === comp.id ? { ...c, clips: c.clips.map((entry) => (entry.id === clip.id ? { ...entry, duration, source: { ...source, scene, frames: undefined } } : entry)) } : c)) };
        return syncHolders(edited, comp, clip.start + duration);
      });
      return done(`Updated ${source.title ?? 'the motion scene'}: ${changes.join('; ')}.${edit.fitNote}`, { clipId: clip.id, outline: summarizeScene(scene) });
    }

    case 'analyze_reference_video': {
      let path = str(args, 'path');
      const assetId = str(args, 'assetId');
      if (!path && assetId) path = ctx.assets.get(assetId)?.path;
      if (!path) return fail('Give the reference as a local file path or an imported assetId (download it first with download_online_media when it is a URL).');
      let reference;
      try {
        reference = await api.refsIngest(path, str(args, 'name') ?? null, str(args, 'notes') ?? null);
      } catch (error) {
        return fail(`Could not read the reference: ${errorText(error)}`);
      }
      const cadence = cadenceFromCuts(reference.cuts, reference.seconds);
      const images = (await Promise.all(reference.sheets.slice(0, 3).map(imageDataUrl))).filter((url): url is string => !!url);
      // The motion profile (hidden cuts, swaps, fitted eases, camera, tempo) needs the media Python; without it the sheets still stand.
      let motion: (ReturnType<typeof summarizeProfile> & { hiddenCuts: number; cuts: MotionProfile['cuts']; twosShare: number }) | null = null;
      let motionNote = '';
      if (args.motion !== false) {
        try {
          const jobId = await api.referenceMotionStart(path, num(args, 'maxSeconds'));
          const deadline = Date.now() + 5 * 60_000;
          while (Date.now() < deadline && !ctx.signal?.aborted) {
            const job = (await api.jobsList()).find((j) => j.id === jobId);
            if (job?.status === 'done') {
              const res = job.result as { profile?: string; peaks?: string | null } | null;
              const profile = res?.profile ? ((await (await fetchFile(res.profile)).json()) as MotionProfile) : null;
              let peaks = null;
              if (res?.peaks) { const bytes = new Uint8Array(await (await fetchFile(res.peaks)).arrayBuffer()); peaks = { data: bytes, buckets: Math.floor(bytes.length / 2) }; }
              if (profile) motion = { ...summarizeProfile(profile, peaks), hiddenCuts: profile.hiddenCuts, cuts: profile.cuts, twosShare: profile.twosShare };
              break;
            }
            if (job && (job.status === 'error' || job.status === 'cancelled')) { motionNote = ` (No motion profile: ${job.message}.)`; break; }
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        } catch (error) {
          motionNote = ` (No motion profile: ${errorText(error)}.)`;
        }
      }
      return done(
        `Reference "${reference.name}" measured: ${reference.seconds.toFixed(0)} s, ${cadence.shots} shots (mean ${cadence.meanShot.toFixed(1)} s, median ${cadence.medianShot.toFixed(1)} s), ${cadence.hookCuts} cuts in the first 15 s, palette ${reference.palette.slice(0, 6).join(' ')}. ` +
        (motion ? `Motion: ${motion.headline} Hold the edit to it with check_pacing {"target": <pacingTarget>}. ` : motionNote) +
        'The contact sheets follow (the opening at 4 fps, then the whole film). Study them: the hook, where graphics sit, type, colour, transitions and which motion templates each moment maps to (list_motion_templates). Then call save_style_profile with the profile (include the motion numbers) so every later edit follows it.',
        { referenceId: reference.id, cadence, palette: reference.palette, sheets: reference.sheets, images, ...(motion ? { motion } : {}) },
      );
    }

    case 'save_style_profile': {
      const builtin = str(args, 'builtin');
      const profileText = builtin === 'motion-designer-explainer' ? MOTION_DESIGNER_EXPLAINER_PROFILE : str(args, 'profile');
      if (!profileText) return fail('Give the profile text (cadence, look, type, motion grammar, template map), or builtin: "motion-designer-explainer".');
      const name = str(args, 'name') ?? (builtin ? 'Motion Designer Explainer' : 'Reference style');
      const palette = Array.isArray(args.palette) ? (args.palette as unknown[]).filter((c): c is string => typeof c === 'string') : ['#0b0204', '#2a0610', '#b0142f', '#ff1f3d', '#ff8a9a', '#ffffff'];
      try {
        const ref = await api.refsSaveGuideline(name, profileText, palette, 'motion', null);
        ctx.setReference?.(ref.id);
        return done(`Style profile "${ref.name}" saved and made the project's active guideline; it is in the AI context from now on. Plan beats with its template map and cadence.`, { id: ref.id, name: ref.name });
      } catch (error) {
        return fail(errorText(error));
      }
    }

    case 'track_motion': {
      const found = findClip(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'media') return fail('Supply the clipId of the video clip to track.');
      const { clip, comp } = found;
      const asset = ctx.assets.get(found.clip.source.assetId);
      if (!asset || asset.kind !== 'video') return fail('Tracking needs a video clip.');
      const points = (Array.isArray(args.points) ? (args.points as unknown[]) : []).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
      const region = Array.isArray(args.region) && args.region.length === 4 && (args.region as unknown[]).every((v) => typeof v === 'number') ? (args.region as [number, number, number, number]) : null;
      if (!points.length && !region) return fail('Give points [[x, y], …] and/or a region [x, y, w, h] as fractions of the frame at the start time.');
      const from = Math.max(clip.start, num(args, 'start') ?? clip.start);
      const to = Math.min(clip.start + clip.duration, num(args, 'end') ?? clip.start + clip.duration);
      if (to - from < 0.1) return fail('The range to track is too short.');
      const sourceFrom = sourceTimeAt(clip, from);
      const seconds = (to - from) * clip.speed;
      const rate = clamp(num(args, 'fps') ?? Math.min(30, asset.fps ?? comp.fps), 5, 60);
      type Sample = { at: number; x: number; y: number; confidence: number; scale?: number; rotation?: number };
      type Tracks = { fps: number; from: number; points: { samples: Sample[] }[]; planar: { samples: Sample[] } | null };
      let tracks = null as Tracks | null;
      try {
        const jobId = await api.pointTrackStart(asset.id, sourceFrom, seconds, rate, points, region);
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const job = (await api.jobsList()).find((j) => j.id === jobId);
          if (!job) continue;
          if (job.status === 'done') { tracks = (job.result as unknown as { tracks: Tracks } | null)?.tracks ?? null; break; }
          if (job.status === 'error' || job.status === 'cancelled') return fail(`Tracking failed: ${job.message || job.status}`);
        }
      } catch (error) {
        return fail(errorText(error));
      }
      if (!tracks) return fail('Tracking did not finish in 10 minutes.');
      const toTimeline = (at: number) => clip.start + (at - clip.in) / Math.max(1e-6, clip.speed);
      const weak = tracks.points.map((t, i) => ({ i, low: t.samples.filter((s) => s.confidence < 0.5).length })).filter((t) => t.low > 0);
      // Optionally drive a motion-scene layer: position (+ scale/rotation for a planar track).
      const apply = obj(args, 'apply');
      let applied = '';
      if (apply && typeof apply.motionClipId === 'string' && typeof apply.layer === 'string') {
        const target = findClip(ctx.current(), apply.motionClipId);
        if (!target || target.clip.source.type !== 'motion') return fail('apply.motionClipId is not a motion scene clip.');
        const motion = target.clip;
        const source = motion.source as Extract<ClipSource, { type: 'motion' }>;
        const scene: MotionScene = JSON.parse(JSON.stringify(source.scene));
        const layer = findLayer(scene, apply.layer);
        if (!layer) return fail(`No layer "${apply.layer}" in that scene.`);
        const which = typeof apply.point === 'number' ? apply.point : 0;
        const planar = apply.planar === true && !!tracks.planar;
        const samples = planar ? tracks.planar!.samples : tracks.points[which]?.samples;
        if (!samples?.length) return fail('There is no such track to apply.');
        const offset = Array.isArray(apply.offset) ? (apply.offset as number[]) : [0, 0];
        const step = Math.max(1, Math.round(samples.length / 240));
        const picked = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
        const origin = sceneOriginIn(ctx.current(), motion, target.comp, comp.id);
        const sceneT = (at: number) => toTimeline(at) - origin;
        layer.transform = {
          ...(layer.transform ?? {}),
          position: { k: picked.map((s) => ({ t: sceneT(s.at), v: [s.x * scene.width + (offset[0] ?? 0), s.y * scene.height + (offset[1] ?? 0)] })) },
          ...(planar ? {
            scale: { k: picked.map((s) => ({ t: sceneT(s.at), v: 100 * (s.scale ?? 1) })) },
            rotation: { k: picked.map((s) => ({ t: sceneT(s.at), v: s.rotation ?? 0 })) },
          } : {}),
        };
        ctx.editComp(target.comp, (current) => ({ ...current, clips: current.clips.map((c) => (c.id === motion.id ? { ...c, source: { ...source, scene, frames: undefined } } : c)) }));
        applied = ` Layer "${apply.layer}" of ${source.title ?? 'the motion scene'} now follows ${planar ? 'the planar track (position, scale, rotation)' : `point ${which}`} with ${picked.length} keyframes.`;
      }
      return done(`Tracked ${tracks.points.length} point${tracks.points.length === 1 ? '' : 's'}${tracks.planar ? ' and a plane' : ''} over ${timecode(from, comp.fps)}–${timecode(to, comp.fps)} at ${rate} fps.${weak.length ? ` Low confidence on point${weak.length === 1 ? '' : 's'} ${weak.map((w) => w.i).join(', ')} for ${weak.map((w) => w.low).join('/')} samples (occlusion or motion blur) — check those frames.` : ''}${applied}`, {
        tracks: {
          fps: tracks.fps,
          points: tracks.points.map((t) => t.samples.map((s) => ({ t: toTimeline(s.at), x: s.x, y: s.y, c: s.confidence }))),
          planar: tracks.planar?.samples.map((s) => ({ t: toTimeline(s.at), x: s.x, y: s.y, scale: s.scale, rotation: s.rotation, c: s.confidence })) ?? null,
        },
      });
    }

    case 'nest_motion_scenes': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition.');
      const result = nestLooseMotionScenes(ctx.current(), comp.id);
      if (!result.count) return done('Every motion scene in this comp is already inside its own comp.');
      ctx.commit(() => result.project);
      return done(`Moved ${result.count} motion scene${result.count === 1 ? '' : 's'} into their own layered "[Motion]" comps (${MOTION_FOLDER} bin), one clip per layer; the timeline keeps one nested clip each, same place and length.`, { count: result.count });
    }

    case 'split_motion_layers': {
      const ids = [str(args, 'compId'), ...(Array.isArray(args.compIds) ? (args.compIds as unknown[]).filter((v): v is string => typeof v === 'string') : [])]
        .filter((id): id is string => !!id)
        .map((id) => { const found = findClip(project, id); return found?.clip.source.type === 'comp' ? found.clip.source.compId : id; });
      const result = splitMotionComps(ctx.current(), ids);
      if (!result.split.length) return done(`Nothing to split: ${result.skipped.length ? result.skipped.join('; ') : 'every "[Motion]" comp already shows its layers.'}`, { split: [] });
      ctx.commit(() => result.project);
      return done(`Opened ${result.split.length} motion comp${result.split.length === 1 ? '' : 's'} into layers: ${result.split.map((entry) => `"${entry.name}" (${entry.layers} layers)`).join(', ')}. Each layer is now a clip on its own track; the timeline clips that hold them are unchanged and they draw exactly as before.${result.skipped.length ? ` Skipped: ${result.skipped.join('; ')}.` : ''}`, { split: result.split });
    }
  }
  return fail(`Unknown motion tool ${name}.`);
}


/** The footage param a template cannot do without, when it has one. */
export const TEMPLATE_FOOTAGE: Record<string, string> = {
  'subject-reveal': 'subject',
  'frame-to-card': 'footage',
  'cutout-stage': 'subject',
  'split-rules-panel': 'footage',
  'blurred-sentence': 'footage',
  'big-number-behind': 'subject',
  'stylized-broll': 'footage',
  'grade-hit': 'footage',
};

/**
 * Places a template by hand (the Graphics tab): at `start`, with the selected clip as its footage
 * when the template takes some. Same path as the AI's create_motion_scene.
 */
export async function placeTemplateByHand(options: { history: { current: () => Project; commit: (change: (current: Project) => Project, label?: string) => void }; assets: AssetMap; templateId: string; start: number; selectedClipId?: string | null }): Promise<ToolResult> {
  const { history, assets, templateId, start, selectedClipId } = options;
  const params: Args = {};
  const key = TEMPLATE_FOOTAGE[templateId];
  if (key && selectedClipId) params[key] = { clipId: selectedClipId };
  if (key && !selectedClipId && key !== 'footage') return fail(`Select the ${key === 'subject' ? 'rotoscoped subject' : 'footage'} clip on the timeline first.`);
  const project = history.current();
  const ctx: MotionToolContext = {
    project,
    assets,
    commit: (change) => history.commit(change, 'Motion Template'),
    editComp: (comp, change) => history.commit((current) => ({ ...current, comps: current.comps.map((c) => (c.id === comp.id ? change(c) : c)) }), 'Motion Template'),
    pickComp: (p) => p.comps.find((c) => c.id === p.activeCompId) ?? p.comps[0],
    current: () => history.current(),
    brand: currentMotionBrand(project),
  };
  return runMotionTool('create_motion_scene', { template: templateId, params, start }, ctx);
}

/**
 * Moves every motion scene sitting directly on a comp's timeline into its own layered "[Motion]"
 * comp (one clip per layer), leaving a nested clip at the same place, length, track, in point and
 * speed. Layer clips and scenes already nested are left alone.
 */
export function nestLooseMotionScenes(project: Project, compId: string): { project: Project; count: number } {
  const comp = project.comps.find((c) => c.id === compId);
  if (!comp) return { project, count: 0 };
  const created: Comp[] = [];
  const clips = comp.clips.map((clip) => {
    if (clip.source.type !== 'motion' || isLayerClip(clip)) return clip;
    const title = clip.source.title ?? clip.name ?? 'Motion scene';
    const exploded = explodeScene(clip.source.scene, { name: `[Motion] ${title}`, fps: comp.fps, width: comp.width, height: comp.height });
    created.push(exploded.comp, ...exploded.nested);
    // The nested comp's time is the scene's time, so the clip keeps its in point and speed.
    return { ...clip, source: { type: 'comp' as const, compId: exploded.comp.id }, name: exploded.comp.name, label: 'mango' as const };
  });
  if (!created.length) return { project, count: 0 };
  const folderId = project.folders.find((f) => f.name === MOTION_FOLDER && f.parentId === null)?.id ?? `folder_${created[0].id}`;
  const folders = project.folders.some((f) => f.id === folderId) ? project.folders : [...project.folders, { id: folderId, name: MOTION_FOLDER, parentId: null }];
  return {
    project: { ...project, folders, comps: [...project.comps.map((c) => (c.id === compId ? { ...c, clips } : c)), ...created.map((c) => ({ ...c, folderId: c.folderId ?? folderId }))] },
    count: clips.filter((clip, i) => clip !== comp.clips[i]).length,
  };
}
