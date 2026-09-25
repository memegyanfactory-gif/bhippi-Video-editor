// import_lottie (docs/REFERENCE-FILMS-PLAN.md P11, C4): a user's Lottie file (.json, or .lottie)
// placed as a motion scene. The common subset converts into real, editable layers
// (src/motion/lottie/convert.ts); files that use anything else render frame by frame into a PNG
// sequence instead (render.ts), so every file plays. User-supplied files only: LottieFiles has no
// sanctioned API and forbids redistribution, so Helios neither searches nor bundles them.
import { unzipSync, strFromU8 } from 'fflate';
import { lottieToScene } from '../motion/lottie/convert';
import type { Layer, MotionScene, Vec } from '../motion/types';
import { api, errorText, fileSrc } from './ipc';
import type { ToolResult } from './types';
import type { MotionToolContext } from './motionTools';

type Args = Record<string, unknown>;
type Run = (name: string, args: Args, ctx: MotionToolContext) => Promise<ToolResult>;
type J = Record<string, unknown>;

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);

/** The animation JSON of a .json Lottie or the first animation inside a .lottie (a zip). */
export function readLottie(bytes: Uint8Array): J {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((f) => /^animations\/.+\.json$/i.test(f)) ?? Object.keys(files).find((f) => f.endsWith('.json') && !/manifest/i.test(f));
    if (!name) throw new Error('the .lottie file has no animation inside');
    return JSON.parse(strFromU8(files[name])) as J;
  }
  return JSON.parse(strFromU8(bytes)) as J;
}

export async function runLottieTool(args: Args, ctx: MotionToolContext, run: Run): Promise<ToolResult> {
  const comp = ctx.pickComp(ctx.project, args);
  if (!comp) return fail('There is no composition to place the animation in.');
  let path = str(args, 'path');
  const assetId = str(args, 'assetId');
  if (!path && assetId) path = ctx.assets.get(assetId)?.path;
  if (!path) return fail('Give the Lottie file the user supplied: a .json or .lottie path or its assetId. (Helios cannot fetch from LottieFiles: download it there and import the file.)');
  let json: J;
  try {
    json = readLottie(new Uint8Array(await (await fetch(fileSrc(path))).arrayBuffer()));
  } catch (error) {
    return fail(`That is not a readable Lottie file: ${errorText(error)}`);
  }
  if (!Array.isArray(json.layers) || !json.w || !json.h) return fail('That JSON is not a Lottie animation (no layers or size).');
  const lw = Number(json.w);
  const lh = Number(json.h);
  const width = num(args, 'width') ?? Math.min(comp.width * 0.6, (comp.height * 0.6 * lw) / lh);
  const scale = width / lw;
  const at: Vec = Array.isArray(args.at) ? (args.at as Vec) : [comp.width / 2, comp.height / 2];
  const mode = str(args, 'mode') ?? 'auto';
  const conversion = lottieToScene(json);
  const native = mode === 'native' || (mode === 'auto' && conversion.unsupported.length === 0);
  let layer: Layer;
  let how: string;
  if (native) {
    layer = { id: 'lottie', name: conversion.name, type: 'precomp', scene: conversion.scene, transform: { position: at, scale: Math.round(scale * 1e4) / 100 } };
    how = `converted into ${conversion.scene.layers.length} editable layer(s)${conversion.unsupported.length ? ` (approximating: ${conversion.unsupported.join(', ')})` : ''}`;
  } else {
    const screen = `lottie_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    let rendered;
    try {
      // Rendered at the size it plays, so it stays sharp. (lottie-web loads only when needed: it touches the DOM as it loads.)
      const { renderLottieFrames } = await import('../motion/lottie/render');
      rendered = await renderLottieFrames(json, (bytes, name) => api.uiScreenSave(screen, name, bytes), { scale: Math.min(4, Math.max(0.25, scale)), fps: Math.min(60, comp.fps) });
    } catch (error) {
      return fail(`The animation could not be rendered: ${errorText(error)}`);
    }
    layer = {
      id: 'lottie', name: conversion.name, type: 'footage', fit: 'contain', size: [rendered.width, rendered.height],
      source: { sequence: { dir: rendered.dir, fps: rendered.fps, frames: rendered.frames, start: 1, digits: 5, ext: 'png', ...(args.loop === true ? { loop: true } : {}) }, kind: 'image', width: rendered.width, height: rendered.height },
      transform: { position: at, scale: Math.round((scale / Math.min(4, Math.max(0.25, scale))) * 1e4) / 100 },
    } as Layer;
    how = `rendered to ${rendered.frames} frames with alpha (it uses ${conversion.unsupported.join(', ')}, which the native layers cannot reproduce exactly)`;
  }
  const clipId = str(args, 'clipId');
  if (clipId) {
    const updated = await run('update_motion_scene', { clipId, addLayers: [{ ...layer, id: str(args, 'id') ?? `lottie-${Date.now().toString(36)}`, ...(num(args, 't') ? { startTime: num(args, 't'), in: num(args, 't') } : {}) }], fit: false }, ctx);
    if (!updated.ok) return updated;
    return done(`Added "${conversion.name}" to the scene: ${how}.`, { ...updated, native, unsupported: conversion.unsupported });
  }
  const duration = num(args, 'duration') ?? conversion.scene.duration;
  const scene: MotionScene = { version: 1, width: comp.width, height: comp.height, duration, layers: [layer] };
  const placed = await run('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start: num(args, 'start') ?? 0, title: str(args, 'title') ?? conversion.name, duration, fit: false, useBrand: false, sfx: false }, ctx);
  if (!placed.ok) return placed;
  return done(`${placed.summary} "${conversion.name}" ${how}.`, { ...placed, native, unsupported: conversion.unsupported });
}
