// Bhippi AI's colour tools: it looks at the graded frame (inspect_color) and grades with the Color
// Studio (color_grade). The frames come from the export renderer, so what it measures is exactly
// what the viewer will get; the statistics are the same the Histogram panel draws.
//
// LUTs are the user's call: a LUT is added, changed or removed only when the user's message for
// the turn asks for one (turnPrompts.ts). Everything else the AI does with wheels, bars and curves.

import { curvePoints, GRADE_CONTROL_MAP, GRADE_CONTROLS, HUE_CURVES, type ColorParams } from './colorGrade';
import { autoBalance, colorStats, describeStats, type ColorStats } from './colorScopes';
import { createAppliedEffect } from './effectFilters';
import { EFFECT_MAP } from './effectsCatalog';
import { renderHtmlStill } from './htmlFrames';
import { api, errorText, fileSrc } from './ipc';
import { availableLuts, importCube, lutName, resolveLut, syncProjectLuts } from './luts';
import { effectScope } from './magicMask';
import { playhead } from './playhead';
import { asksForLut } from './turnPrompts';
import { clipEnd, updateComp, type AssetMap } from './timeline';
import type { AppliedEffect, Clip, Comp, Project, ToolResult } from './types';
import { renderMotionStill } from '../motion/exportFrames';

export const COLOR_TOOLS: ReadonlySet<string> = new Set(['inspect_color', 'color_grade']);

type Args = Record<string, unknown>;
export type ColorToolContext = {
  project: Project;
  assets: AssetMap;
  commit: (change: (current: Project) => Project) => void;
  current: () => Project;
  pickComp: (project: Project, args: Args) => Comp | undefined;
  /** The user's message for this turn: LUT changes need it to ask for one. */
  prompt: string;
};

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const LUT_KEYS = ['lutId', 'lutAmount', 'lutStage'];
export const LUT_REFUSAL = 'LUTs are applied only when the user asks for one. Grade with the wheels, primary bars, curves and Color Slice instead — or ask the user whether they want a LUT.';

function findClip(project: Project, clipId: string): { comp: Comp; clip: Clip } | null {
  for (const comp of project.comps) {
    const clip = comp.clips.find((entry) => entry.id === clipId);
    if (clip) return { comp, clip };
  }
  return null;
}

/** The Color Studio on a clip that grades the whole picture (the first one), if any. */
export function studioOf(clip: Clip, instanceId?: string): AppliedEffect | undefined {
  return (clip.appliedEffects ?? []).find((fx) => fx.effectId === 'lumetri-color' && (instanceId ? fx.id === instanceId : effectScope(clip, fx).kind === 'whole'));
}

/** The params of a grade that differ from neutral — what the grade actually does. */
export function gradeSummary(params: ColorParams): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const control of GRADE_CONTROLS) {
    const value = params[control.id];
    if (typeof value === 'number' && Math.abs(value - control.defaultValue) > 1e-6) out[control.id] = value;
  }
  for (const key of HUE_CURVES) if (typeof params[key] === 'string' && params[key]) out[key] = params[key] as string;
  for (const key of ['rTable', 'gTable', 'bTable']) if (typeof params[key] === 'string' && params[key]) out[key] = '(custom curve)';
  if (typeof params.lutId === 'string' && params.lutId) {
    out.lutId = params.lutId;
    out.lut = lutName(params.lutId) ?? 'missing';
    out.lutStage = params.lutStage === 'input' ? 'input' : 'output';
  }
  return out;
}

/** Checks one Color Studio param the AI sent; returns why it is refused, or null. */
function checkParam(key: string, value: unknown, project: Project): string | null {
  const control = GRADE_CONTROL_MAP.get(key);
  if (control) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a number.`;
    if (value < control.min || value > control.max) return `${key} must be within ${control.min}…${control.max}.`;
    return null;
  }
  if ((HUE_CURVES as readonly string[]).includes(key)) {
    if (value === '') return null;
    if (typeof value !== 'string') return `${key} is a JSON list of [x, y] points (0–1, y 0.5 = no change), or "" to clear it.`;
    const points = curvePoints(value);
    if (!points.length || points.length > 32) return `${key} needs 1–32 [x, y] points with both values in 0–1, e.g. "[[0.05,0.5],[0.1,0.62],[0.15,0.5]]".`;
    return null;
  }
  if (['rTable', 'gTable', 'bTable'].includes(key)) {
    if (value === '') return null;
    if (typeof value !== 'string') return `${key} is space-separated values in 0–1.`;
    const values = value.trim().split(/\s+/).map(Number);
    if (values.length < 2 || values.length > 256 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return `${key} needs 2–256 space-separated values in 0–1.`;
    return null;
  }
  if (key === 'lutId') {
    if (value === '') return null;
    if (typeof value !== 'string' || !resolveLut(value)) return `Unknown LUT "${String(value)}". Available: ${availableLuts(project).map((l) => l.id).join(', ')}.`;
    return null;
  }
  if (key === 'lutStage') return value === 'input' || value === 'output' ? null : 'lutStage is "input" or "output".';
  return `Unknown Color Studio parameter ${key}. Numbers: ${GRADE_CONTROLS.map((c) => c.id).join(', ')}; curves: rTable/gTable/bTable, ${HUE_CURVES.join(', ')}; LUT: lutId, lutAmount, lutStage.`;
}

// ───────────────────────────── frames ─────────────────────────────

async function imageData(dataUrl: string, maxWidth = 360): Promise<ImageData> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the rendered frame did not decode'));
    img.src = dataUrl;
  });
  const w = Math.min(maxWidth, image.naturalWidth), h = Math.max(1, Math.round((w / image.naturalWidth) * image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, w, h);
  return context.getImageData(0, 0, w, h);
}

/** Renders the comp at `time` through the export (graphics drawn in) and returns the PNG path. */
async function renderStill(project: Project, ctx: ColorToolContext, comp: Comp, time: number, name: string): Promise<string> {
  const dir = await api.mogrtFramesBegin('color');
  const prepared = await renderHtmlStill(await renderMotionStill(project, comp.id, [time], [...ctx.assets.values()]), comp.id, [time]);
  return api.exportFrame(prepared, comp.id, time, `${dir}/${name}-${Date.now().toString(36)}.png`, 540);
}

/** The project with a clip's colour effects (and those of graded adjustments above, when asked) bypassed. */
function withoutGrade(project: Project, compId: string, clipId: string): Project {
  return updateComp(project, compId, (comp) => ({
    ...comp,
    clips: comp.clips.map((clip) => (clip.id === clipId
      ? { ...clip, appliedEffects: (clip.appliedEffects ?? []).map((fx) => (['lumetri-color', 'curves', 'levels', 'brightness-contrast', 'hue-saturation', 'color-balance-hls', 'tint', 'black-white'].includes(fx.effectId) ? { ...fx, enabled: false } : fx)) }
      : clip)),
  }));
}

function statsLine(stats: ColorStats): string {
  return `luma p1/p50/p99 ${Math.round(stats.luma.p1 * 1023)}/${Math.round(stats.luma.p50 * 1023)}/${Math.round(stats.luma.p99 * 1023)} (of 1023), clipped white ${(stats.clipped.white * 100).toFixed(1)}% black ${(stats.clipped.black * 100).toFixed(1)}%, mean saturation ${stats.saturation.mean}`;
}

// ───────────────────────────── the tools ─────────────────────────────

export async function runColorTool(name: string, args: Args, ctx: ColorToolContext): Promise<ToolResult> {
  const { project } = ctx;
  syncProjectLuts(project);

  if (name === 'inspect_color') {
    const clipId = str(args, 'clipId');
    const found = clipId ? findClip(project, clipId) : null;
    if (clipId && !found) return fail('Unknown clipId. Call get_comp for clip ids.');
    const comp = found?.comp ?? ctx.pickComp(project, args);
    if (!comp) return fail('Open a composition first.');
    let time = num(args, 'time') ?? playhead.get();
    if (found && (time < found.clip.start || time >= clipEnd(found.clip))) time = found.clip.start + found.clip.duration / 2;
    time = Math.max(0, time);
    const compare = args.compare !== false && !!found;
    try {
      const gradedPath = await renderStill(project, ctx, comp, time, 'graded');
      const paths = [gradedPath];
      if (compare) paths.push(await renderStill(withoutGrade(project, comp.id, found!.clip.id), ctx, comp, time, 'source'));
      const urls = await api.chatReadImages(paths);
      const graded = colorStats(await imageData(urls[0]));
      const source = compare && urls[1] ? colorStats(await imageData(urls[1])) : null;
      const notes = describeStats(graded);
      const studio = found ? studioOf(found.clip) : undefined;
      const images = args.images === false ? [] : urls;
      return done(
        `Rendered ${found ? `clip ${found.clip.id}` : `comp ${comp.name}`} at ${time.toFixed(2)}s through the export renderer. Graded: ${statsLine(graded)}.${source ? ` Without its colour effects: ${statsLine(source)}.` : ''} Reading: ${notes.join(' ')}${images.length ? ` Images: ${images.length === 2 ? 'first the graded frame, then the same frame without the clip\'s colour effects' : 'the graded frame'}.` : ''} The whole frame is measured, graphics included.`,
        {
          clipId: found?.clip.id ?? null,
          time,
          graded,
          source,
          notes,
          grade: studio ? { instanceId: studio.id, enabled: studio.enabled, params: gradeSummary(studio.params) } : null,
          images,
        },
      );
    } catch (error) {
      return fail(`The frame could not be rendered: ${errorText(error)}`);
    }
  }

  if (name === 'color_grade') {
    const ids = [str(args, 'clipId'), ...(Array.isArray(args.clipIds) ? args.clipIds.filter((id): id is string => typeof id === 'string') : [])].filter((id): id is string => !!id);
    if (!ids.length) return fail('Name the clip to grade: clipId (or clipIds to give several clips the same grade).');
    const targets = ids.map((id) => ({ id, found: findClip(project, id) }));
    const unknown = targets.find((t) => !t.found);
    if (unknown) return fail(`Unknown clipId ${unknown.id}.`);
    for (const { found } of targets) {
      if (found!.comp.tracks.find((track) => track.id === found!.clip.trackId)?.locked) return fail(`Clip ${found!.clip.id} is on a locked track.`);
      const kind = found!.clip.source.type;
      if (kind !== 'media' && kind !== 'item' && kind !== 'comp') return fail(`Clip ${found!.clip.id} is ${kind}; grade footage, stills, nested comps or an adjustment layer.`);
    }
    const params = (args.params && typeof args.params === 'object' && !Array.isArray(args.params) ? args.params : {}) as Record<string, unknown>;
    const lutPath = str(args, 'lutPath');
    const touchesLut = !!lutPath || LUT_KEYS.some((key) => key in params);
    if (touchesLut && !asksForLut(ctx.prompt)) return fail(LUT_REFUSAL);
    for (const [key, value] of Object.entries(params)) {
      const problem = checkParam(key, value, project);
      if (problem) return fail(problem);
    }
    const mode = str(args, 'mode') ?? 'merge';
    if (!['merge', 'replace'].includes(mode)) return fail('mode is "merge" (change only the params given) or "replace" (start the grade from neutral).');
    const auto = str(args, 'auto');
    if (auto && auto !== 'balance') return fail('auto supports "balance" (black/white points and neutral cast from the rendered frame).');

    let imported: { id: string; name: string } | null = null;
    let lutPatch: Record<string, string | number> = {};
    if (lutPath) {
      if (!/\.cube$/i.test(lutPath)) return fail('lutPath must be a .cube file.');
      try {
        const response = await fetch(fileSrc(lutPath));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const lut = importCube(await response.text(), lutPath.split(/[\\/]/).pop() ?? 'LUT.cube');
        ctx.commit((current) => ({ ...current, luts: [...(current.luts ?? []), lut] }));
        syncProjectLuts(ctx.current());
        imported = { id: lut.id, name: lut.name };
        lutPatch = { lutId: lut.id, lutAmount: typeof params.lutAmount === 'number' ? params.lutAmount : 100 };
      } catch (error) {
        return fail(`Could not import ${lutPath}: ${errorText(error)}`);
      }
    }

    // Auto balance reads the clip's own picture without its colour effects.
    let balanced: Record<string, number> = {};
    if (auto === 'balance') {
      const first = targets[0].found!;
      const time = clamp(num(args, 'time') ?? playhead.get(), first.clip.start, clipEnd(first.clip) - 1e-3);
      try {
        const path = await renderStill(withoutGrade(ctx.current(), first.comp.id, first.clip.id), ctx, first.comp, time, 'balance');
        const [url] = await api.chatReadImages([path]);
        balanced = autoBalance(await imageData(url));
      } catch (error) {
        return fail(`Auto balance could not render the frame: ${errorText(error)}`);
      }
    }

    const definition = EFFECT_MAP.get('lumetri-color')!;
    const instanceId = str(args, 'instanceId');
    const results: { clipId: string; instanceId: string; grade: Record<string, number | string> }[] = [];
    ctx.commit((current) => {
      // A state updater may run twice (React's strict mode): start the report afresh each time.
      results.length = 0;
      let next = current;
      for (const { id } of targets) {
        const where = findClip(next, id)!;
        const existing = studioOf(where.clip, instanceId);
        const base = existing && mode === 'merge' ? existing.params : createAppliedEffect(definition).params;
        // Replacing a grade never drops the user's LUT unless the user asked about LUTs.
        const keptLut = existing && mode === 'replace' && !touchesLut ? Object.fromEntries(LUT_KEYS.filter((k) => k in existing.params).map((k) => [k, existing.params[k]])) : {};
        const params2 = { ...base, ...keptLut, ...balanced, ...(params as ColorParams), ...lutPatch };
        const effect: AppliedEffect = existing ? { ...existing, enabled: true, params: params2 } : { ...createAppliedEffect(definition), params: params2 };
        results.push({ clipId: id, instanceId: effect.id, grade: gradeSummary(params2) });
        next = updateComp(next, where.comp.id, (comp) => ({
          ...comp,
          clips: comp.clips.map((clip) => {
            if (clip.id !== id) return clip;
            const stack = clip.appliedEffects ?? [];
            // A new grade goes first: the Color Studio grades the source before other effects.
            return { ...clip, appliedEffects: existing ? stack.map((fx) => (fx.id === existing.id ? effect : fx)) : [{ ...effect, stackOnly: true }, ...stack] };
          }),
        }));
      }
      return next;
    });
    const extras = [imported ? `Imported LUT “${imported.name}” (${imported.id}).` : '', auto === 'balance' ? `Auto balance set ${Object.entries(balanced).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing (already balanced)'}.` : ''].filter(Boolean).join(' ');
    return done(`Graded ${results.length} clip${results.length > 1 ? 's' : ''} in the Color Studio (one undo step). ${extras} Check the result with inspect_color {"clipId":"${results[0].clipId}"} — read the numbers and look at the frame before calling it done.`, { results, lutsAvailable: touchesLut ? availableLuts(ctx.current()).map((l) => ({ id: l.id, name: l.name })) : undefined });
  }

  return fail(`Unknown colour tool ${name}.`);
}
