// Alpha tools for @funny (docs/FUNNY-MODE-PLAN.md §3.4): cut a person out of a photo or a frame,
// find faces over time, and key a green-screen host — the pieces the side_cutout, head_paste,
// host_on_bg and keyword_pop-behind moves stand on.
//
//   cutout_image      BiRefNet (MIT) in the media Python → RGBA PNG, optional sticker stroke and
//                     shadow → imported into the "Cutouts" bin.        (src-tauri/src/cutout.rs)
//   detect_faces      YuNet (MIT, CPU) + IoU tracking → FaceTrack[] in source seconds.
//   key_green_screen  FFmpeg samples, Rust measures the chroma-green backdrop; host clips that are
//                     mostly green get the `keylight` effect (the same AppliedEffect edit_effect
//                     makes, so preview and export both render it), in one undo step.
import { invoke } from '@tauri-apps/api/core';
import { createAppliedEffect, getEffectSchema } from '../effectFilters';
import { AVAILABLE_EFFECTS } from '../effectsCatalog';
import { normalizeEffectClip } from '../effectState';
import type { AppliedEffect, Asset, Clip, Comp, Project, ToolResult } from '../types';
import type { FaceTrack, RoastToolContext } from './types';

type Args = Record<string, unknown>;

export const ALPHA_TOOLS = new Set(['cutout_image', 'detect_faces', 'key_green_screen']);

// ─── Rust commands ────────────────────────────────────────────────────────────────────────────

export type CutoutBox = { x: number; y: number; width: number; height: number };

export type CutoutResult = {
  path: string;
  width: number;
  height: number;
  /** The subject in the source frame, 0–1 fractions. */
  bbox: CutoutBox;
  /** Share of the source frame the subject covers. */
  coverage: number;
  /** Where the PNG's top-left sits in source pixels (negative when the canvas was padded). */
  offset?: { x: number; y: number } | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  strokePx?: number | null;
  model?: string | null;
  device?: string | null;
  greenScreen?: boolean | null;
  seconds?: number | null;
};

export type CutoutRequest = {
  path: string;
  /** Source seconds, for a video. */
  time?: number;
  model?: 'general' | 'portrait';
  stroke?: boolean;
  /** Stroke thickness when the cut-out is shown 1080 px tall (default 8). */
  strokePx?: number;
  shadow?: boolean;
  /** [x, y, width, height] in frame fractions: cut out only what is inside (one of several people). */
  region?: [number, number, number, number];
  choke?: number;
  crop?: boolean;
  out?: string;
};

export type KeylightParams = { screenColor: string; screenGain: number; screenBalance: number; despill: number };

export type GreenReport = {
  greenShare: number;
  samples: { t: number; border: number; full: number; green: boolean }[];
  keyColor: [number, number, number] | null;
  screenExcess: number | null;
  screenExcessLow: number | null;
  keylight: KeylightParams | null;
  spans: [number, number][];
  warnings: string[];
};

export const cutoutImage = (request: CutoutRequest) => invoke<CutoutResult>('cutout_image', request);
export const detectFaces = (request: { path: string; start?: number; end?: number; fps?: number }) => invoke<FaceTrack[]>('detect_faces', request);
export const detectGreenScreen = (request: { path: string; start?: number; end?: number; samples?: number }) => invoke<GreenReport>('detect_green_screen', request);

// ─── Keylight ─────────────────────────────────────────────────────────────────────────────────

const hex2 = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');

/**
 * The `keylight` effect for a backdrop of `keyColor` ([r, g, b] 0–255 or "#rrggbb"), built the way
 * edit_effect builds it (catalogue defaults, then params clamped to the schema). Pass the params
 * detect_green_screen suggests; without them the catalogue defaults apply.
 */
export function keylightEffect(keyColor: [number, number, number] | string, params: Partial<Omit<KeylightParams, 'screenColor'>> = {}): AppliedEffect {
  const definition = AVAILABLE_EFFECTS.find((effect) => effect.id === 'keylight');
  if (!definition) throw new Error('The keylight effect is not in the rendered catalogue.');
  const effect = createAppliedEffect(definition);
  const color = typeof keyColor === 'string' ? keyColor : `#${keyColor.map(hex2).join('')}`;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('keyColor must be [r, g, b] or #rrggbb');
  effect.params.screenColor = color.toLowerCase();
  const schema = getEffectSchema('keylight', definition.group).params;
  for (const [key, value] of Object.entries(params)) {
    const parameter = schema.find((entry) => entry.id === key);
    if (!parameter || parameter.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) continue;
    effect.params[key] = Math.round(Math.min(parameter.max ?? value, Math.max(parameter.min ?? value, value)));
  }
  return effect;
}

/** The clip with `effect` as its keylight: an existing keylight instance is updated in place. */
export function withKeylight(clip: Clip, effect: AppliedEffect): Clip {
  const normal = normalizeEffectClip(clip);
  const stack = normal.appliedEffects ?? [];
  const existing = stack.find((entry) => entry.effectId === 'keylight');
  const next = existing
    ? stack.map((entry) => (entry.id === existing.id ? { ...entry, enabled: true, params: { ...entry.params, ...effect.params } } : entry))
    : [...stack, effect];
  return { ...normal, appliedEffects: next };
}

// ─── Tool plumbing ────────────────────────────────────────────────────────────────────────────

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const bool = (args: Args, key: string) => (typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function findClip(project: Project, id: string): { clip: Clip; comp: Comp } | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((entry) => entry.id === id);
    if (clip) return { clip, comp };
  }
  return null;
}

/** Source seconds a clip reads: [in, in + duration × speed). */
const sourceRange = (clip: Clip): [number, number] => [clip.in, clip.in + clip.duration * Math.max(0.01, clip.speed)];

function region(args: Args): [number, number, number, number] | undefined {
  const value = args.region;
  if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) return value as [number, number, number, number];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const box = value as Args;
    const parts = [num(box, 'x'), num(box, 'y'), num(box, 'width'), num(box, 'height')];
    if (parts.every((v) => v !== undefined)) return parts as [number, number, number, number];
  }
  return undefined;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────────────────────

async function cutoutTool(args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  let asset: Asset | undefined;
  let time = num(args, 'time');
  let path = str(args, 'path');
  const clipId = str(args, 'clipId');
  if (clipId) {
    const found = findClip(ctx.project, clipId);
    if (!found || found.clip.source.type !== 'media') return fail('clipId must name a media clip.');
    asset = ctx.assets.get(found.clip.source.assetId);
    if (time === undefined) {
      const [first, last] = sourceRange(found.clip);
      time = (first + last) / 2;
    }
  } else if (str(args, 'assetId')) {
    asset = ctx.assets.get(str(args, 'assetId') as string);
    if (!asset) return fail('Unknown assetId.');
  }
  if (asset) {
    if (asset.kind !== 'image' && asset.kind !== 'video') return fail('cutout_image needs an image or a video.');
    path = asset.path;
    if (asset.kind === 'video') time = Math.min(Math.max(0, time ?? asset.duration / 2), Math.max(0, asset.duration - 0.05));
    else time = undefined;
  }
  if (!path) return fail('Give assetId, clipId or path.');
  const model = str(args, 'model');
  if (model && model !== 'general' && model !== 'portrait') return fail('model is general or portrait.');
  if (ctx.signal?.aborted) return fail('Cancelled.');
  let result: CutoutResult;
  try {
    result = await cutoutImage({
      path,
      time,
      model: model as CutoutRequest['model'],
      stroke: bool(args, 'stroke'),
      strokePx: num(args, 'strokePx'),
      shadow: bool(args, 'shadow'),
      region: region(args),
      choke: num(args, 'choke'),
      crop: bool(args, 'crop'),
    });
  } catch (error) {
    return fail(`Cutout failed: ${errorText(error)}`);
  }
  const imported = await ctx.importFiles([result.path], 'Cutouts');
  const png = imported[0];
  if (!png) return fail(`The cut-out was written to ${result.path} but could not be imported.`);
  const look = [result.strokePx ? `${result.strokePx.toFixed(1)} px white stroke` : null, bool(args, 'shadow') ? 'drop shadow' : null].filter(Boolean).join(' + ');
  return done(
    `Cut out ${asset?.name ?? path}${time !== undefined ? ` at ${time.toFixed(2)} s` : ''} with BiRefNet ${result.model?.replace('birefnet-', '') ?? ''}: ${result.width}×${result.height} PNG${look ? ` (${look})` : ''}, subject covers ${(result.coverage * 100).toFixed(0)}% of the frame${result.greenScreen ? ', green screen despilled' : ''}. Imported as ${png.id} in the Cutouts bin — place it with side_cutout or place_clip, and look at it before relying on the edge.`,
    { assetId: png.id, bbox: result.bbox, path: result.path, width: result.width, height: result.height, coverage: result.coverage, offset: result.offset ?? null, strokePx: result.strokePx ?? 0, model: result.model ?? null, greenScreen: result.greenScreen ?? false },
  );
}

async function facesTool(args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  let asset: Asset | undefined;
  let start = num(args, 'start');
  let end = num(args, 'end');
  const clipId = str(args, 'clipId');
  if (clipId) {
    const found = findClip(ctx.project, clipId);
    if (!found || found.clip.source.type !== 'media') return fail('clipId must name a media clip.');
    asset = ctx.assets.get(found.clip.source.assetId);
    const [first, last] = sourceRange(found.clip);
    start ??= first;
    end ??= last;
  } else {
    asset = ctx.assets.get(str(args, 'assetId') ?? '');
  }
  if (!asset) return fail('Give assetId or clipId of a video or image.');
  if (asset.kind !== 'video' && asset.kind !== 'image') return fail('detect_faces needs a video or an image.');
  const fps = Math.min(30, Math.max(1, num(args, 'fps') ?? 10));
  let clamped = false;
  if (asset.kind === 'video') {
    start = Math.max(0, start ?? 0);
    end = Math.min(asset.duration, end ?? Math.min(asset.duration, start + 10));
    if (end - start > 3600 / fps) {
      end = start + 3600 / fps;
      clamped = true;
    }
    if (end <= start) return fail('The span is empty.');
  }
  if (ctx.signal?.aborted) return fail('Cancelled.');
  let tracks: FaceTrack[];
  try {
    tracks = await detectFaces(asset.kind === 'video' ? { path: asset.path, start, end, fps } : { path: asset.path });
  } catch (error) {
    return fail(`Face detection failed: ${errorText(error)}`);
  }
  const lines = tracks.map((track) => {
    const first = track.frames[0];
    const last = track.frames[track.frames.length - 1];
    const cx = track.frames.reduce((sum, f) => sum + f.x + f.width / 2, 0) / track.frames.length;
    const cy = track.frames.reduce((sum, f) => sum + f.y + f.height / 2, 0) / track.frames.length;
    return `face ${track.id}: ${track.frames.length} samples ${first.t.toFixed(1)}–${last.t.toFixed(1)} s, around (${cx.toFixed(2)}, ${cy.toFixed(2)}), ${(first.height * 100).toFixed(0)}% of the frame tall`;
  });
  const where = asset.kind === 'video' ? ` over ${start?.toFixed(1)}–${end?.toFixed(1)} s at ${fps} fps${clamped ? ' (span shortened to 3600 frames)' : ''}` : '';
  return done(
    `${tracks.length} face track${tracks.length === 1 ? '' : 's'} in ${asset.name}${where} (YuNet). Coordinates are frame fractions, t is source seconds, mouth is the mouth-corner midpoint — ready for head_paste paths and bleep covers.${lines.length ? `\n${lines.join('\n')}` : ''}`,
    { assetId: asset.id, start: start ?? null, end: end ?? null, fps, tracks },
  );
}

type GreenTarget = { clip: Clip; comp: Comp; asset: Asset };

async function keyTool(args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  const minShare = Math.min(1, Math.max(0.05, num(args, 'minShare') ?? 0.5));
  const dryRun = bool(args, 'dryRun') ?? false;
  const targets: GreenTarget[] = [];
  const clipId = str(args, 'clipId');
  if (clipId) {
    const found = findClip(ctx.project, clipId);
    if (!found || found.clip.source.type !== 'media') return fail('clipId must name a video clip.');
    const asset = ctx.assets.get(found.clip.source.assetId);
    if (!asset || asset.kind !== 'video') return fail('key_green_screen needs a video clip.');
    targets.push({ ...found, asset });
  } else if (bool(args, 'all')) {
    const comp = ctx.pickComp(ctx.project, args);
    if (!comp) return fail('No composition to scan.');
    for (const clip of comp.clips) {
      if (!clip.enabled || clip.source.type !== 'media' || clip.name?.toLowerCase().includes('background')) continue;
      const asset = ctx.assets.get(clip.source.assetId);
      if (asset?.kind === 'video') targets.push({ clip, comp, asset });
    }
    if (!targets.length) return fail('That composition has no video clips.');
    if (targets.length > 200) return fail('More than 200 video clips: key them per clipId or per host asset.');
  } else {
    return fail('Give clipId, or all: true to scan every video clip of the comp.');
  }

  // One pass per asset over the span its clips read; a clip with too few samples inside that
  // span gets a pass of its own.
  const byAsset = new Map<string, GreenTarget[]>();
  for (const target of targets) byAsset.set(target.asset.id, [...(byAsset.get(target.asset.id) ?? []), target]);
  const reports = new Map<string, GreenReport>();
  const rows: { clipId: string; compId: string; assetId: string; name: string; greenShare: number; keyed: boolean; reason?: string; keyColor: [number, number, number] | null; params: KeylightParams | null }[] = [];
  const effects = new Map<string, AppliedEffect>();
  try {
    for (const [assetId, group] of byAsset) {
      if (ctx.signal?.aborted) return fail('Cancelled.');
      const asset = group[0].asset;
      const first = Math.max(0, Math.min(...group.map((t) => sourceRange(t.clip)[0])));
      const last = Math.min(asset.duration, Math.max(...group.map((t) => sourceRange(t.clip)[1])));
      const span = Math.max(0.1, last - first);
      const whole = await detectGreenScreen({ path: asset.path, start: first, end: Math.max(first + 0.1, last), samples: Math.round(Math.min(160, Math.max(12, span / 3))) });
      reports.set(assetId, whole);
      for (const target of group) {
        const [from, to] = sourceRange(target.clip);
        let inside = whole.samples.filter((sample) => sample.t >= from && sample.t < to);
        let report = whole;
        if (inside.length < 4) {
          report = await detectGreenScreen({ path: asset.path, start: from, end: Math.min(asset.duration, Math.max(from + 0.1, to)), samples: 8 });
          inside = report.samples;
        }
        const share = inside.length ? inside.filter((sample) => sample.green).length / inside.length : 0;
        const params = report.keylight ?? whole.keylight;
        const keyColor = report.keyColor ?? whole.keyColor;
        const locked = target.comp.tracks.find((track) => track.id === target.clip.trackId)?.locked;
        let reason: string | undefined;
        if (share < minShare) reason = `only ${(share * 100).toFixed(0)}% of its frames show a green backdrop`;
        else if (!params || !keyColor) reason = 'no backdrop colour could be measured';
        else if (locked) reason = 'its track is locked';
        const keyed = !reason && !dryRun;
        if (keyed && params && keyColor) effects.set(target.clip.id, keylightEffect(keyColor, params));
        rows.push({ clipId: target.clip.id, compId: target.comp.id, assetId, name: target.clip.name ?? asset.name, greenShare: share, keyed, reason: dryRun && !reason ? 'dry run' : reason, keyColor, params });
      }
    }
  } catch (error) {
    return fail(`Green-screen detection failed: ${errorText(error)}`);
  }

  if (effects.size) {
    ctx.commit((current) => ({
      ...current,
      comps: current.comps.map((comp) => comp.clips.some((clip) => effects.has(clip.id))
        ? { ...comp, clips: comp.clips.map((clip) => { const effect = effects.get(clip.id); return effect ? withKeylight(clip, effect) : clip; }) }
        : comp),
    }));
  }
  const keyed = rows.filter((row) => row.keyed).length;
  const lines = rows.map((row) => `${row.clipId} (${row.name}): greenShare ${row.greenShare.toFixed(2)} — ${row.keyed ? `keyed (Keylight ${row.params?.screenColor}, gain ${row.params?.screenGain}, balance ${row.params?.screenBalance}, despill ${row.params?.despill})` : `not keyed: ${row.reason}`}`);
  const warnings = [...new Set([...reports.values()].flatMap((report) => report.warnings))];
  return done(
    `${keyed ? `Keyed ${keyed} of ${rows.length} clip${rows.length === 1 ? '' : 's'} in one undo step` : `Nothing keyed (${rows.length} clip${rows.length === 1 ? '' : 's'} checked)`}. Keylight renders in preview and export; check a frame of each keyed clip for green fringe or holes in dark clothes, then put something behind the host (host_on_bg).${warnings.length ? ` Warnings: ${warnings.join(' ')}` : ''}\n${lines.join('\n')}`,
    { clips: rows, keyed, spans: Object.fromEntries([...reports].map(([assetId, report]) => [assetId, report.spans])) },
  );
}

/** Runs one alpha tool. */
export async function runAlphaTool(name: string, args: Args, ctx: RoastToolContext): Promise<ToolResult> {
  switch (name) {
    case 'cutout_image': return cutoutTool(args, ctx);
    case 'detect_faces': return facesTool(args, ctx);
    case 'key_green_screen': return keyTool(args, ctx);
    default: return fail(`Unknown alpha tool ${name}.`);
  }
}
