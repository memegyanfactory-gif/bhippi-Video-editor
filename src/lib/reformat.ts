// Changing a comp's shape — landscape to portrait, square, 4:5 — the way Premiere's "Auto Reframe
// Sequence" and CapCut's ratio switch do: the frame changes, and everything in it is made to work
// in the new frame instead of being left where a 16:9 edit put it.
//
//   · Footage that filled the old frame fills the new one (cropped to the centre), fits inside it
//     with bars, or fits over a blurred, darkened copy of itself — the social-video standard.
//   · Motion graphics built from a template are rebuilt at the new canvas, so a vertical frame gets
//     the vertical design (stacked type, social safe area) rather than a squeezed 16:9 one. Scenes
//     with no template have their layers carried across proportionally and pulled into the safe area.
//   · Text, shapes and footage placed in a layout keep their place as fractions of the frame; the
//     frame QA pass (run_frame_qa) is what checks them afterwards.
import { AVAILABLE_EFFECTS } from './effectsCatalog';
import { createAppliedEffect } from './effectFilters';
import { mogrtCanvas } from './motionGraphics';
import { isLayeredComp, logicalScene, restack } from './motionStack';
import { findTemplate } from '../motion/kit';
import { buildInBrand } from '../motion/kit/brandify';
import { fitToSafeArea } from '../motion/safeArea';
import { isAnimated, isExpression } from '../motion/anim';
import type { Layer, MotionScene, Prop, Vec } from '../motion/types';
import { uid } from './editor';
import { newTrack, tracksOf } from './timeline';
import type { AppliedEffect, Clip, Comp, Project } from './types';

export type Orientation = 'landscape' | 'portrait' | 'square';

export type FramePreset = {
  id: string;
  label: string;
  /** "16:9", "9:16" … */
  ratio: string;
  width: number;
  height: number;
  orientation: Orientation;
  /** What it is for, as editors pick it. */
  use: string;
};

/** Frame shapes in real use, each at its common delivery resolution (higher tiers via `scaleTo`). */
export const FRAME_PRESETS: FramePreset[] = [
  { id: 'landscape-16-9', label: 'Landscape', ratio: '16:9', width: 1920, height: 1080, orientation: 'landscape', use: 'YouTube, TV, presentations' },
  { id: 'portrait-9-16', label: 'Portrait', ratio: '9:16', width: 1080, height: 1920, orientation: 'portrait', use: 'Reels, TikTok, Shorts, Stories' },
  { id: 'square-1-1', label: 'Square', ratio: '1:1', width: 1080, height: 1080, orientation: 'square', use: 'Instagram and LinkedIn feed' },
  { id: 'vertical-4-5', label: 'Vertical feed', ratio: '4:5', width: 1080, height: 1350, orientation: 'portrait', use: 'Instagram and Facebook feed (most screen space)' },
  { id: 'portrait-3-4', label: 'Portrait 3:4', ratio: '3:4', width: 1080, height: 1440, orientation: 'portrait', use: 'Instagram profile grid, Pinterest' },
  { id: 'classic-4-3', label: 'Classic', ratio: '4:3', width: 1440, height: 1080, orientation: 'landscape', use: 'Retro and archival looks, iPad' },
  { id: 'cinema-2-39', label: 'Cinemascope', ratio: '2.39:1', width: 1920, height: 804, orientation: 'landscape', use: 'Film look, trailers' },
  { id: 'ultrawide-21-9', label: 'Ultrawide', ratio: '21:9', width: 2560, height: 1080, orientation: 'landscape', use: 'Ultrawide monitors, cinematic banners' },
];

/** Resolution tiers: the short side of the frame. */
export const RESOLUTION_TIERS = [
  { short: 720, label: 'HD 720' },
  { short: 1080, label: 'Full HD 1080' },
  { short: 1440, label: 'QHD 1440' },
  { short: 2160, label: '4K 2160' },
];

export const orientationOf = (width: number, height: number): Orientation =>
  Math.abs(width - height) <= Math.max(width, height) * 0.02 ? 'square' : width > height ? 'landscape' : 'portrait';

/** "16:9", "9:16", "2.39:1" … — the nearest named ratio, else the reduced fraction. */
export function aspectLabel(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  const named = FRAME_PRESETS.find((preset) => Math.abs(preset.width / preset.height - ratio) < 0.012);
  if (named) return named.ratio;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / d}:${Math.round(height) / d}`;
}

/** A frame preset's shape at a resolution tier (the short side), kept even for 4:2:0 video. */
export function scaleTo(preset: Pick<FramePreset, 'width' | 'height'>, short: number): { width: number; height: number } {
  const factor = short / Math.min(preset.width, preset.height);
  const even = (value: number) => Math.max(16, Math.round((value * factor) / 2) * 2);
  return { width: even(preset.width), height: even(preset.height) };
}

/** The same frame turned on its side (16:9 ⇄ 9:16). */
export const swapped = (size: { width: number; height: number }) => ({ width: size.height, height: size.width });

export const presetOf = (width: number, height: number): FramePreset | undefined =>
  FRAME_PRESETS.find((preset) => Math.abs(preset.width / preset.height - width / Math.max(1, height)) < 0.012);

// ─── Reformatting ────────────────────────────────────────────────────────────────────────────

/**
 * What happens to footage that filled the old frame:
 *   · `fill` — crops to fill the new frame from the centre (Premiere's default for a new ratio);
 *   · `blur` — fits the whole picture over a blurred, darkened copy that fills the frame;
 *   · `fit`  — fits the whole picture with bars;
 *   · `keep` — leaves footage as it is (only the frame and the graphics change).
 */
export type ReformatMode = 'fill' | 'blur' | 'fit' | 'keep';

export type ReformatReport = {
  footage: number;
  blurred: number;
  rebuilt: string[];
  carried: string[];
  skipped: string[];
};

const near = (a: number, b: number, slack = 0.5) => Math.abs(a - b) <= slack;

/**
 * Footage that fills the frame: at least full scale and centred all the way through, uncropped.
 * Punch-in and push keyframes (scale ≥ 100, small drifts) are the edit's own moves and stay; they are
 * relative to the fit, so they work the same after fill. Layout pieces (PiP, split halves, a reduced
 * card) are left alone.
 */
function fullFrame(clip: Clip): boolean {
  const t = clip.transform;
  const scales = [t.scale, ...clip.keyframes.scale.map((key) => key.value)];
  const offsets = [t.x, t.y, ...clip.keyframes.x.map((key) => key.value), ...clip.keyframes.y.map((key) => key.value)];
  return scales.every((value) => value >= 98) && offsets.every((value) => Math.abs(value) <= 0.12)
    && Math.abs(t.rotation) <= 5 && t.cropLeft + t.cropRight + t.cropTop + t.cropBottom === 0;
}

function effect(effectId: string, params: Record<string, number>): AppliedEffect | null {
  const def = AVAILABLE_EFFECTS.find((entry) => entry.id === effectId);
  if (!def) return null;
  const base = createAppliedEffect(def);
  return { ...base, params: { ...base.params, ...params }, stackOnly: true };
}

/** A position-like prop with `map` applied to every value (static, keyframed or expression). */
function mapVec(prop: Prop<Vec> | undefined, map: (v: Vec) => Vec): Prop<Vec> | undefined {
  if (prop === undefined) return prop;
  if (Array.isArray(prop)) return map(prop as Vec);
  if (isAnimated(prop)) return { ...prop, k: prop.k.map((key) => ({ ...key, v: map(key.v as Vec) })) } as Prop<Vec>;
  if (isExpression(prop)) return { ...prop, ...(prop.v !== undefined ? { v: map(prop.v as Vec) } : {}), ...(prop.k ? { k: prop.k.map((key) => ({ ...key, v: map(key.v as Vec) })) } : {}) } as Prop<Vec>;
  return prop;
}

/**
 * A scene with no template carried to a new canvas: top-level layers keep their place as a fraction
 * of the frame, frame-sized layers (stages, plates, cover footage) take the new frame's size, and
 * whatever then rests outside the safe area is moved (and if need be shrunk) back inside it.
 */
export function carryScene(scene: MotionScene, width: number, height: number): MotionScene {
  const sx = width / scene.width;
  const sy = height / scene.height;
  const frameSized = (size?: Vec) => !size || (near(size[0], scene.width, 2) && near(size[1], scene.height, 2));
  const layers = scene.layers.map((layer): Layer => {
    if (layer.threeD || layer.type === 'camera') return layer;
    const next = { ...layer } as Layer & { size?: Vec };
    if (!layer.parent) next.transform = { ...layer.transform, position: mapVec(layer.transform?.position, (v) => [v[0] * sx, v[1] * sy, ...v.slice(2)] as Vec) };
    if ((layer.type === 'solid' || layer.type === 'procedural' || layer.type === 'particles' || layer.type === 'footage') && frameSized((layer as { size?: Vec }).size)) {
      if ((layer as { size?: Vec }).size) next.size = [width, height];
      // A frame-sized layer anchored at the old centre is re-centred on the new one.
      if (!layer.parent) next.transform = { ...next.transform, position: mapVec(layer.transform?.position, (v) => [v[0] * sx, v[1] * sy, ...v.slice(2)] as Vec), anchor: mapVec(layer.transform?.anchor, (v) => [v[0] * sx, v[1] * sy, ...v.slice(2)] as Vec) };
    }
    return next;
  });
  return fitToSafeArea({ ...scene, width, height, layers }).scene;
}

/** A scene at a new canvas: rebuilt from its template (in its brand) when it has one, carried otherwise. */
export function rescene(scene: MotionScene, width: number, height: number): { scene: MotionScene; rebuilt: boolean } {
  const spec = scene.template ? findTemplate(scene.template.id) : undefined;
  if (spec && scene.template) {
    try {
      const built = buildInBrand(spec, { width, height }, scene.template.params, scene.brand?.snapshot ?? null);
      return { scene: { ...built, template: scene.template, ...(scene.brand ? { brand: scene.brand } : {}) }, rebuilt: true };
    } catch {
      // A template that cannot build at this shape falls back to carrying the layers across.
    }
  }
  return { scene: carryScene(scene, width, height), rebuilt: false };
}

/** How many comps use `compId` as a clip. */
function holders(project: Project, compId: string): number {
  return project.comps.reduce((sum, comp) => sum + comp.clips.filter((clip) => clip.source.type === 'comp' && clip.source.compId === compId).length, 0);
}

/**
 * The comp `compId` at `size`, with its footage re-fitted by `mode` and its motion graphics made for
 * the new shape. Returns the new project and what was done, for the undo label and the AI's report.
 */
export function reformatComp(project: Project, compId: string, size: { width: number; height: number }, mode: ReformatMode = 'fill'): { project: Project; report: ReformatReport } {
  const report: ReformatReport = { footage: 0, blurred: 0, rebuilt: [], carried: [], skipped: [] };
  const comp = project.comps.find((entry) => entry.id === compId);
  if (!comp) return { project, report };
  const width = Math.round(Math.min(8192, Math.max(16, size.width)));
  const height = Math.round(Math.min(8192, Math.max(16, size.height)));
  let next: Comp = { ...comp, width, height };
  const canvas = mogrtCanvas({ width, height });

  // Footage.
  const videoTracks = new Set(tracksOf(comp, 'video').map((track) => track.id));
  const blurCopies: Clip[] = [];
  next = {
    ...next,
    clips: next.clips.map((clip) => {
      if (!videoTracks.has(clip.trackId)) return clip;
      if (clip.source.type === 'motion') {
        const { scene, rebuilt } = rescene(clip.source.scene, canvas.width, canvas.height);
        (rebuilt ? report.rebuilt : report.carried).push(clip.source.title ?? clip.name ?? 'motion scene');
        return { ...clip, source: { ...clip.source, scene, frames: undefined } };
      }
      if (mode === 'keep' || clip.source.type !== 'media' || clip.adjustment || !fullFrame(clip)) return clip;
      report.footage++;
      if (mode === 'fill') return { ...clip, transform: { ...clip.transform, fit: 'fill' } };
      if (mode === 'fit') return { ...clip, transform: { ...clip.transform, fit: 'fit' } };
      // blur: the picture fits; a muted copy under it fills, blurred and darkened.
      const blur = effect('gaussian-blur', { blurriness: 60 });
      const dim = effect('hue-saturation', { masterLightness: -28, masterSaturation: -10 });
      blurCopies.push({
        ...clip,
        id: uid(),
        name: `${clip.name ?? 'Footage'} · blurred fill`,
        linkId: null,
        volume: 0,
        keyframes: { ...clip.keyframes, volume: [] },
        transform: { ...clip.transform, fit: 'fill', scale: 104 },
        appliedEffects: [blur, dim].filter((fx): fx is AppliedEffect => fx !== null),
        magicMasks: [],
        rotoMatte: null,
      });
      return { ...clip, transform: { ...clip.transform, fit: 'fit' } };
    }),
  };
  if (blurCopies.length) {
    // Each track of footage gets its blurred fills on a new track right under it, so copies from
    // different tracks never collide and each fill sits beneath its own picture.
    const tracks = [...next.tracks];
    const clips = [...next.clips];
    for (const sourceTrack of [...new Set(blurCopies.map((clip) => clip.trackId))]) {
      const track = { ...newTrack('video'), name: 'Blurred fill' };
      tracks.splice(Math.max(0, tracks.findIndex((entry) => entry.id === sourceTrack)), 0, track);
      clips.push(...blurCopies.filter((clip) => clip.trackId === sourceTrack).map((clip) => ({ ...clip, trackId: track.id })));
    }
    next = { ...next, tracks, clips };
    report.blurred = blurCopies.length;
  }

  let result: Project = { ...project, comps: project.comps.map((entry) => (entry.id === compId ? next : entry)) };

  // Layered "[Motion]" comps placed in this one take the new shape too — unless another comp also uses them.
  const nested = [...new Set(next.clips.flatMap((clip) => (clip.source.type === 'comp' && videoTracks.has(clip.trackId) ? [clip.source.compId] : [])))];
  for (const id of nested) {
    const inner = result.comps.find((entry) => entry.id === id);
    if (!inner || !isLayeredComp(inner)) continue;
    if (holders(result, id) > 1) {
      report.skipped.push(`${inner.name} (used in more than one comp)`);
      continue;
    }
    const base = logicalScene(result, inner);
    if (!base) continue;
    const { scene, rebuilt } = rescene(base, canvas.width, canvas.height);
    const resized: Project = { ...result, comps: result.comps.map((entry) => (entry.id === id ? { ...entry, width: canvas.width, height: canvas.height } : entry)) };
    result = restack(resized, id, scene, rebuilt ? 'scene' : 'keep', 0, base);
    (rebuilt ? report.rebuilt : report.carried).push(inner.name);
  }
  return { project: result, report };
}

/** One line for the undo label, the toast and the AI. */
export function describeReformat(report: ReformatReport, mode: ReformatMode): string {
  const parts: string[] = [];
  if (report.footage) parts.push(`${report.footage} full-frame clip${report.footage === 1 ? '' : 's'} ${mode === 'fill' ? 'cropped to fill' : mode === 'fit' ? 'fitted with bars' : 'fitted over a blurred fill'}`);
  if (report.rebuilt.length) parts.push(`${report.rebuilt.length} motion graphic${report.rebuilt.length === 1 ? '' : 's'} rebuilt for the new shape`);
  if (report.carried.length) parts.push(`${report.carried.length} carried across and kept in the safe area`);
  if (report.skipped.length) parts.push(`left as they were: ${report.skipped.join(', ')}`);
  return parts.length ? parts.join('; ') : 'nothing inside needed changing';
}
