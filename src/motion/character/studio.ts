// Library characters in the motion engine: the Characters window's 2D room (public/characters)
// keeps the user's saved characters and 20 examples, and its engine draws any of them from a spec,
// turning in 2.5D. This module loads that engine and its shared motion sampler into the editor,
// reads the library, and draws the same expressive poses seen in the Characters window.
import { actionDuration, sampleStudioMotion } from './pose';
import { drawSvgMarkup } from './svgCanvas';
import { CHARACTER_FEET, STUDIO_KIND, STUDIO_SCALE, type CharacterData, type Mouth, type Pose, type StudioMotionFrame, type StudioSpec } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Pose inputs the room's engine takes (see public/characters/engine2d.js `render`). */
export type StudioParams = {
  t: number; yaw: number; headYaw: number; headPitch: number;
  stance?: string; walk?: boolean; mouth?: string; expr?: string; brow?: string; blink?: boolean | number;
  mouthOpen?: number;
  mouthWeight?: number;
  pose?: Record<string, unknown>;
};
type CharEngine = {
  CAT: Record<string, unknown>;
  defaults(): StudioSpec;
  render(spec: StudioSpec, a: StudioParams & { fast?: boolean; hand?: boolean; id?: string }): string;
  rigFor(spec: StudioSpec): { H: number };
};
type CharLibrary = { load(): StudioSpec[]; upsert(spec: StudioSpec): StudioSpec[]; to2D(spec: StudioSpec, defaults: StudioSpec): StudioSpec };
type StudioWindow = { CharEngine?: CharEngine; CharMotion?: { sample: (...args: unknown[]) => StudioMotionFrame }; CharPresets?: { EXAMPLES: StudioSpec[] }; BhippiChars?: CharLibrary };

const LIBRARY_KEY = 'bhippi.characters.v3';
const SCRIPTS = ['characters/shared.js', 'characters/engine2d.js', 'characters/motion2d.js', 'characters/presets2d.js'];
/** The height of a standard adult library character in its layer's own px: the borrowed rig's standing height. */
export const STUDIO_ADULT_HEIGHT = 522;
/** The room engine's adult standing height (its own units): kids, teens and seniors come out relative to it. */
const ENGINE_ADULT_HEIGHT = 650;

// Hold only a few recent drawings: timeline scrubs and held animation frames reuse the same
// geometry, while continuous playback must not retain every generated SVG indefinitely.
const MARKUP_ENTRIES = 16;
const MARKUP_BYTES = 8 * 1024 * 1024;
const markupCache = new Map<string, { svg: string; bytes: number }>();
let markupBytes = 0;
let markupRenderer: CharEngine['render'] | null = null;

function studioMarkup(engine: CharEngine, spec: StudioSpec, params: StudioMotionFrame): string {
  if (markupRenderer !== engine.render) {
    markupCache.clear();
    markupBytes = 0;
    markupRenderer = engine.render;
  }
  // Content, not object identity, catches appearance/action edits made in place. Density is
  // deliberately absent: the vector drawing can serve both preview and high-resolution export.
  const args = { ...params, hand: spec.motion2d?.ink !== false, id: 'studio-frame' };
  const key = JSON.stringify([spec, args]);
  const cached = markupCache.get(key);
  if (cached) {
    markupCache.delete(key);
    markupCache.set(key, cached);
    return cached.svg;
  }
  const svg = engine.render(spec, args);
  const bytes = (key.length + svg.length) * 2;
  if (bytes <= MARKUP_BYTES) {
    while (markupCache.size >= MARKUP_ENTRIES || markupBytes + bytes > MARKUP_BYTES) {
      const oldest = markupCache.keys().next().value;
      if (oldest === undefined) break;
      markupBytes -= markupCache.get(oldest)!.bytes;
      markupCache.delete(oldest);
    }
    markupCache.set(key, { svg, bytes });
    markupBytes += bytes;
  }
  return svg;
}

const win = (): StudioWindow | null => (typeof window === 'undefined' ? null : (window as unknown as StudioWindow));
let loading: Promise<boolean> | null = null;

/** Loads the room's engine, library helpers and examples into the editor (once). */
export function loadStudio(): Promise<boolean> {
  const w = win();
  if (!w || typeof document === 'undefined') return Promise.resolve(false);
  if (w.CharEngine && w.CharMotion && w.CharPresets && w.BhippiChars) return Promise.resolve(true);
  loading ??= (async () => {
    for (const src of SCRIPTS) {
      const ok = await new Promise<boolean>((resolve) => {
        const el = document.createElement('script');
        el.src = `/${src}`;
        el.async = false;
        el.onload = () => resolve(true);
        el.onerror = () => resolve(false);
        document.head.appendChild(el);
      });
      if (!ok) { loading = null; return false; }
    }
    return !!(w.CharEngine && w.CharMotion && w.CharPresets && w.BhippiChars);
  })();
  return loading;
}

/** The engine when it is loaded; otherwise starts loading it and returns null (the frame draws nothing yet). */
export function studioEngine(): CharEngine | null {
  const w = win();
  if (w?.CharEngine && w.CharMotion) return w.CharEngine;
  void loadStudio();
  return null;
}

/** Whether a scene (or its precomps) holds a library character, so an export waits for the engine. */
export function sceneHasStudio(layers: { type: string; character?: CharacterData; scene?: { layers: unknown[] } }[]): boolean {
  return layers.some((layer) => (layer.type === 'character' && layer.character?.kind === STUDIO_KIND) || (layer.type === 'precomp' && !!layer.scene && sceneHasStudio(layer.scene.layers as never)));
}

/** The user's saved characters, newest first (the Characters window's library). */
export function savedCharacters(): StudioSpec[] {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(list) ? list.filter((item) => item && typeof item.name === 'string') : [];
  } catch {
    return [];
  }
}

/** The room's example characters (loads the engine first). */
export async function presetCharacters(): Promise<StudioSpec[]> {
  await loadStudio();
  return win()?.CharPresets?.EXAMPLES ?? [];
}

/** A spec with every field the engine needs (the room's own normalising, when loaded). */
export function fullSpec(spec: StudioSpec): StudioSpec {
  const w = win();
  if (w?.BhippiChars && w.CharEngine) return w.BhippiChars.to2D(spec, w.CharEngine.defaults());
  return spec;
}

/** Saves (or replaces, by name) a character in the user's library, as the room does. */
export async function saveToLibrary(spec: StudioSpec): Promise<boolean> {
  await loadStudio();
  const lib = win()?.BhippiChars;
  if (!lib || !spec.name) return false;
  lib.upsert(spec);
  return true;
}

/** The standing height of a library character in its layer's own px (an adult is STUDIO_ADULT_HEIGHT). */
export function studioHeight(spec: StudioSpec): number {
  const engine = studioEngine();
  const h = engine ? engine.rigFor(fullSpec(spec)).H : ENGINE_ADULT_HEIGHT;
  return (h * STUDIO_ADULT_HEIGHT) / ENGINE_ADULT_HEIGHT;
}

const MOUTHS: Partial<Record<Mouth, string>> = {
  smile: 'smile', grin: 'grin', flat: 'flat', sad: 'flat', M: 'flat', o: 'open', O: 'open', A: 'open', L: 'open', scream: 'open', E: 'teeth', F: 'teeth',
};
const STANCES: Record<string, string> = {
  wave: 'wave', shrug: 'shrug', think: 'think', facepalm: 'think', celebrate: 'peace', point: 'hold', type: 'hold', surprise: 'shrug',
};

/** What the engine draws at scene time `t`; the legacy mapping is a pre-load fallback only. */
export function studioParams(data: CharacterData, pose: Pose, sceneT: number): StudioParams {
  const sampled = sampleStudioMotion(data, sceneT);
  if (sampled) return sampled;
  const step = data.step ?? 2;
  const t = step > 1 ? Math.floor(sceneT * 30 / step + 1e-6) * step / 30 : sceneT;
  const active = [...(data.actions ?? [])].sort((a, b) => a.t - b.t).filter((a) => a.do !== 'expression' && t >= a.t && t <= a.t + actionDuration(a));
  const doing = (name: string) => active.find((a) => a.do === name);
  const moving = active.find((a) => a.do === 'walk' || a.do === 'run' || a.do === 'sneak');
  // Front on by default; a set facing is a three-quarter view that way, a walk turns to profile.
  let yaw = data.facing ? data.facing * 0.45 : 0;
  if (moving) yaw = pose.facing * 1.2;
  let headYaw = pose.turn * 0.7 + pose.look[0] * 0.35;
  let headPitch = pose.look[1] * 0.12 + (pose.headDip ?? 0) * 0.01;
  const nod = doing('nod');
  if (nod) headPitch += Math.sin((t - nod.t) * Math.PI * 2 * 2.8) * 0.18;
  const shake = doing('shake');
  if (shake) headYaw += Math.sin((t - shake.t) * Math.PI * 2 * 2.8) * 0.35;
  if (pose.expression === 'side') headYaw += 0.35 * pose.facing;
  const stanceOf = [...active].reverse().find((a) => STANCES[a.do]);
  const params: StudioParams = { t: moving?.do === 'run' ? t * 2 : moving?.do === 'sneak' ? t * 0.7 : t, yaw, headYaw, headPitch };
  if (stanceOf) params.stance = STANCES[stanceOf.do];
  if (moving) params.walk = true;
  const mouth = MOUTHS[pose.mouth];
  if (mouth) params.mouth = mouth;
  if (pose.expression === 'happy' || doing('celebrate')) params.expr = 'happy';
  if (pose.expression === 'determined') params.brow = 'down';
  if (pose.expression === 'sad' || pose.expression === 'unsure' || pose.expression === 'wide' || doing('surprise')) params.brow = 'up';
  if (doing('surprise')) params.mouth = 'open';
  if (pose.eyes < 0.35 || pose.expression === 'closed' || doing('facepalm')) params.blink = true;
  return params;
}

/**
 * Draws a library character in its layer box. All articulation comes from the shared room
 * sample; evaluateScene applies its root travel once, outside the character's raster box.
 */
export function drawStudioCharacter(ctx: Ctx, data: CharacterData, sceneT: number, density: number): boolean {
  const engine = studioEngine();
  if (!engine || !data.spec) return false;
  const spec = fullSpec(data.spec);
  const params = sampleStudioMotion(data, sceneT);
  if (!params) return false;
  const svg = studioMarkup(engine, spec, params);
  ctx.save();
  ctx.scale(density, density);
  ctx.translate(CHARACTER_FEET[0], CHARACTER_FEET[1]);
  ctx.scale(STUDIO_SCALE, STUDIO_SCALE);
  drawSvgMarkup(ctx, svg);
  ctx.restore();
  return true;
}
