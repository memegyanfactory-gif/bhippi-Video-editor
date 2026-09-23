// AI tools for the motion engine (src/motion): build AE-grade motion scenes from templates or
// raw layer JSON, inspect and patch them, and learn a style from a reference film.
import { MOTION_TEMPLATES, findTemplate } from '../motion/kit';
import type { KitContext } from '../motion/kit/common';
import type { FootageSource, Layer, MotionScene } from '../motion/types';
import { EFFECT_TYPES, validateScene } from '../motion/validate';
import { keyTimes } from '../motion/anim';
import { clamp, timecode } from './editor';
import { api, errorText, fileSrc } from './ipc';
import { freeTrack, newClip, placeClips, sourceTimeAt, tracksOf, type AssetMap } from './timeline';
import type { Clip, ClipSource, Comp, Project, ToolResult } from './types';

type Args = Record<string, unknown>;

export const MOTION_TOOLS = new Set(['list_motion_templates', 'create_motion_scene', 'get_motion_scene', 'update_motion_scene', 'analyze_reference_video', 'save_style_profile', 'track_motion']);
/** Read-only / planning motion tools, allowed in any production phase. */
export const MOTION_READ_TOOLS = new Set(['list_motion_templates', 'get_motion_scene', 'analyze_reference_video', 'save_style_profile']);

export type MotionToolContext = {
  project: Project;
  assets: AssetMap;
  commit: (change: (current: Project) => Project) => void;
  editComp: (comp: Comp, change: (current: Comp) => Comp) => void;
  pickComp: (project: Project, args: Args) => Comp | undefined;
  current: () => Project;
  setReference?: (id: string | null) => void;
};

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, summary, ...data });
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
      in: sourceTimeAt(found.clip, sceneStart),
      speed: found.clip.speed,
      ...(found.clip.rotoMatte ? { matte: found.clip.rotoMatte } : {}),
      ...(v.cutout !== undefined ? { cutout: !!v.cutout } : {}),
    } satisfies FootageSource;
  }
  if (typeof v.assetId === 'string' && !('asset' in v)) {
    const asset = ctx.assets.get(v.assetId);
    const { assetId, ...rest } = v;
    return { asset: assetId, kind: asset?.kind === 'image' ? 'image' : 'video', ...rest };
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

const SFX_MAP: Record<string, 'whoosh' | 'impact' | 'chime' | 'pop' | 'riser'> = { whoosh: 'whoosh', impact: 'impact', chime: 'chime', pop: 'pop', riser: 'riser', click: 'pop' };

/** Places the scene's SFX cues on free audio tracks. */
function placeCues(comp: Comp, scene: MotionScene, start: number): { comp: Comp; ids: string[] } {
  let next = comp;
  const ids: string[] = [];
  for (const cue of scene.cues ?? []) {
    const kind = SFX_MAP[cue.sound];
    if (!kind) continue;
    const at = Math.max(0, start + cue.at);
    const duration = kind === 'riser' ? 2 : 1.2;
    const target = freeTrack(next, 'audio', at, at + duration, 0);
    const source: ClipSource = { type: 'sfx', kind };
    const clip = newClip({ trackId: target.track.id, start: at, duration, source, volume: kind === 'riser' ? 0.35 : 0.55, name: `SFX ${kind}${cue.note ? ` · ${cue.note}` : ''}` });
    next = placeClips(target.comp, [clip], 'overwrite');
    ids.push(clip.id);
  }
  return { comp: next, ids };
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
    const response = await fetch(fileSrc(path));
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

// ───────────────────────── the tools ─────────────────────────

export async function runMotionTool(name: string, args: Args, ctx: MotionToolContext): Promise<ToolResult> {
  const { project } = ctx;
  switch (name) {
    case 'list_motion_templates': {
      const query = str(args, 'query')?.toLowerCase();
      const specs = MOTION_TEMPLATES.filter((spec) => !query || `${spec.id} ${spec.label} ${spec.use} ${spec.technique}`.toLowerCase().includes(query));
      return done(`${specs.length} motion template${specs.length === 1 ? '' : 's'}. Build one with create_motion_scene {"template":"<id>","params":{…},"start":<s>}. Footage params accept {"clipId":"…"} (asset, source time and roto matte are filled in) or {"assetId":"…"}.`, {
        templates: specs.map((spec) => ({ id: spec.id, label: spec.label, technique: spec.technique, use: spec.use, params: spec.params, seconds: spec.seconds, fullFrame: spec.fullFrame })),
        effects: EFFECT_TYPES,
      });
    }

    case 'create_motion_scene': {
      const comp = ctx.pickComp(project, args);
      if (!comp) return fail('There is no composition to place the scene in.');
      const start = Math.max(0, num(args, 'start') ?? 0);
      const kit: KitContext = { width: comp.width, height: comp.height };
      const accent = str(args, 'accent');
      if (accent) kit.palette = { accent };
      let scene: MotionScene;
      const templateId = str(args, 'template');
      if (templateId) {
        const spec = findTemplate(templateId);
        if (!spec) return fail(`No motion template "${templateId}". Templates: ${MOTION_TEMPLATES.map((s) => s.id).join(', ')}.`);
        const raw = obj(args, 'params') ?? {};
        const params = resolveParams(raw, ctx, start);
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
          scene = spec.build(kit, params);
        } catch (error) {
          return fail(`The ${templateId} template could not be built: ${errorText(error)}`);
        }
      } else {
        const rawScene = obj(args, 'scene');
        if (!rawScene) return fail('Give a template id (list_motion_templates) or a raw scene {version:1,width,height,duration,layers:[…]}.');
        scene = { version: 1, width: comp.width, height: comp.height, ...(rawScene as object) } as MotionScene;
      }
      const duration = clamp(num(args, 'duration') ?? scene.duration, 1 / comp.fps, 600);
      scene = { ...scene, duration: Math.max(scene.duration, duration) };
      const problems = validateScene(scene);
      if (problems.length) return fail(`The scene is not valid: ${problems.slice(0, 8).join(' ')}`);
      const title = str(args, 'title') ?? findTemplate(templateId ?? '')?.label ?? 'Motion scene';
      const placed = trackAbove(comp, start, start + duration);
      const clip = newClip({ trackId: placed.track.id, start, duration, source: { type: 'motion', scene, title }, name: title });
      let next = placeClips(placed.comp, [clip], 'overwrite');
      let sfx: string[] = [];
      if (args.sfx !== false && scene.cues?.length) {
        const cued = placeCues(next, scene, start);
        next = cued.comp;
        sfx = cued.ids;
      }
      ctx.editComp(comp, () => next);
      return done(`${title} placed at ${timecode(start, comp.fps)} for ${duration.toFixed(2)} s on its own track above the footage${sfx.length ? `, with ${sfx.length} sound cue${sfx.length === 1 ? '' : 's'}` : ''}. Preview and export use the same GPU renderer. Check it with inspect_clip_frames, then retime or restyle with update_motion_scene.`, {
        clipId: clip.id, sfxClipIds: sfx, scene: summarizeScene(scene),
      });
    }

    case 'get_motion_scene': {
      const found = findClip(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'motion') return fail('Supply the clipId of a motion scene clip.');
      const scene = found.clip.source.scene;
      return done(`${found.clip.source.title ?? 'Motion scene'}: ${scene.layers.length} layers, ${scene.duration.toFixed(2)} s${scene.template ? `, built from ${scene.template.id}` : ''}.`, {
        summary: summarizeScene(scene),
        ...(args.full === true ? { scene } : {}),
        ...(scene.template ? { templateParams: scene.template.params } : {}),
      });
    }

    case 'update_motion_scene': {
      const found = findClip(project, str(args, 'clipId') ?? '');
      if (!found || found.clip.source.type !== 'motion') return fail('Supply the clipId of a motion scene clip.');
      const { clip, comp } = found;
      const source = found.clip.source;
      let scene: MotionScene = JSON.parse(JSON.stringify(source.scene));
      const changes: string[] = [];
      const params = obj(args, 'params');
      if (params) {
        const templateId = scene.template?.id;
        const spec = templateId ? findTemplate(templateId) : undefined;
        if (!spec) return fail('This scene was not built from a template; patch its layers instead.');
        const merged = { ...(scene.template?.params ?? {}), ...resolveParams(params, ctx, clip.start) };
        scene = spec.build({ width: scene.width, height: scene.height }, merged);
        changes.push(`rebuilt ${templateId} with ${Object.keys(params).join(', ')}`);
      }
      const replacement = obj(args, 'scene');
      if (replacement) { scene = { ...scene, ...(replacement as object) } as MotionScene; changes.push('replaced the scene'); }
      for (const id of Array.isArray(args.removeLayers) ? (args.removeLayers as unknown[]).filter((v): v is string => typeof v === 'string') : []) {
        const before = scene.layers.length;
        scene.layers = scene.layers.filter((layer) => layer.id !== id);
        if (scene.layers.length < before) changes.push(`removed ${id}`);
      }
      for (const raw of Array.isArray(args.addLayers) ? (args.addLayers as unknown[]) : []) {
        const entry = raw as Args;
        const layer = (entry.layer ?? entry) as Layer;
        if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string') return fail('addLayers entries are layers (or {layer, above|below}) with an id.');
        const anchorId = (entry.above ?? entry.below) as string | undefined;
        const index = anchorId ? scene.layers.findIndex((l) => l.id === anchorId) : -1;
        if (index >= 0) scene.layers.splice(entry.above ? index + 1 : index, 0, layer);
        else scene.layers.push(layer);
        changes.push(`added ${layer.id}`);
      }
      for (const raw of Array.isArray(args.patches) ? (args.patches as unknown[]) : []) {
        const patch = raw as Args;
        const path = typeof patch.path === 'string' ? patch.path : '';
        if (!path) return fail('Each patch needs a path (e.g. "transform.position" or "effects.0.radius").');
        const target = typeof patch.layer === 'string' ? findLayer(scene, patch.layer) : (scene as unknown as Layer);
        if (!target) return fail(`No layer "${String(patch.layer)}" in the scene.`);
        if (!setPath(target as unknown as Args, path, patch.value)) return fail(`Could not set ${path}.`);
        changes.push(`${patch.layer ?? 'scene'}.${path}`);
      }
      const retime = num(args, 'retime');
      if (retime && retime > 0 && retime !== 1) {
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
      if (!changes.length) return fail('Nothing to change: give params, patches, addLayers, removeLayers, retime or scene.');
      const problems = validateScene(scene);
      if (problems.length) return fail(`The edited scene is not valid: ${problems.slice(0, 8).join(' ')}`);
      const duration = retime ? clip.duration * retime : Math.max(clip.duration, Math.min(scene.duration, clip.duration));
      ctx.editComp(comp, (current) => ({ ...current, clips: current.clips.map((c) => (c.id === clip.id ? { ...c, duration, source: { ...source, scene, frames: undefined } } : c)) }));
      return done(`Updated ${source.title ?? 'the motion scene'}: ${changes.join('; ')}.`, { clipId: clip.id, summary: summarizeScene(scene) });
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
      return done(
        `Reference "${reference.name}" measured: ${reference.seconds.toFixed(0)} s, ${cadence.shots} shots (mean ${cadence.meanShot.toFixed(1)} s, median ${cadence.medianShot.toFixed(1)} s), ${cadence.hookCuts} cuts in the first 15 s, palette ${reference.palette.slice(0, 6).join(' ')}. ` +
        'The contact sheets follow (the opening at 4 fps, then the whole film). Study them: the hook, where graphics sit, type, colour, transitions and which motion templates each moment maps to (list_motion_templates). Then call save_style_profile with the profile so every later edit follows it.',
        { referenceId: reference.id, cadence, palette: reference.palette, sheets: reference.sheets, images },
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
        const sceneT = (at: number) => toTimeline(at) - motion.start;
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
  };
  return runMotionTool('create_motion_scene', { template: templateId, params, start }, ctx);
}
