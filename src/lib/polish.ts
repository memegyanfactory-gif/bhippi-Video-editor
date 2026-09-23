// The polish pass's eyes. What `run_frame_qa` measures on a comp at each sampled moment: every
// motion-scene layer where it rests (nested "[Motion]" comps followed down, the holder clip's
// transform applied), HTML graphics, titles and captions, footage or stills reduced to a card or a
// picture-in-picture, and the rotoscoped subject. And, from the rendered contact frames, whether a
// frame reads as blank: mostly flat white (a light stage covering everything), empty black, or one
// flat colour.
import { layerTitle, stackGroups } from './motionStack';
import { htmlLayerInfo } from './htmlLayers';
import { animated } from './keyframes';
import { placement } from './editor';
import { fileSrc } from './ipc';
import { clipEnd, sourceTimeAt, tracksOf, type AssetMap } from './timeline';
import { textBox, type QaLayer } from './production';
import type { Clip, Comp, Project } from './types';
import { entryBounds } from '../motion/evaluate';
import { evaluateMeasured } from '../motion/measure';
import type { Layer, MotionScene } from '../motion/types';

type Box = { x: number; y: number; width: number; height: number };
type RotoSubjects = { at: number; x: number; y: number; width: number; height: number; cover: number }[];
export type QaSources = { rotoSubjects: (runId: string) => Promise<RotoSubjects | null> };

const FULL = 0.9;
const REST_STEP = 1 / 15;

/** Clip transform at `t` as a map from the clip's own frame (fractions) to its parent's. */
function holderMap(clip: Clip, t: number): (box: Box) => Box {
  const scale = animated(clip, 'scale', t, clip.transform.scale) / 100;
  const x = animated(clip, 'x', t, clip.transform.x);
  const y = animated(clip, 'y', t, clip.transform.y);
  return (box) => ({ x: 0.5 + x + (box.x - 0.5) * scale, y: 0.5 + y + (box.y - 0.5) * scale, width: box.width * scale, height: box.height * scale });
}

/** Whether a layer draws under a cut-out subject in the same scene (text "behind" the presenter). */
function underSubject(scene: MotionScene, index: number): boolean {
  return scene.layers.slice(index + 1).some((layer) => layer.type === 'footage' && (layer.source.cutout || !!layer.source.matte || (layer.effects ?? []).some((effect) => effect.type === 'subject-reveal')));
}

/**
 * The layers of `scene` that rest on screen at scene time `t` — at least half opaque and not
 * moving — as boxes in fractions of the scene. Entrances and exits in flight are not judged;
 * frame-sized pictures (stages, plates, a full-frame shot) and 3D layers are not either.
 */
export function restingLayerBoxes(scene: MotionScene, t: number, fps = 30): { layer: Layer; box: Box; behind: boolean }[] {
  const now = evaluateMeasured(scene, t, fps);
  const before = evaluateMeasured(scene, Math.max(0, t - REST_STEP), fps);
  const matteSources = new Set(scene.layers.map((layer) => layer.matte?.layer).filter(Boolean));
  const out: { layer: Layer; box: Box; behind: boolean }[] = [];
  now.layers.forEach((entry, index) => {
    const layer = entry.layer;
    if (!entry.active || entry.opacity < 0.5 || layer.hidden || layer.ref || layer.threeD || layer.adjustment || matteSources.has(layer.id)) return;
    if (layer.type === 'null' || layer.type === 'camera' || layer.type === 'procedural' || ((layer.type === 'solid' || layer.type === 'footage') && !layer.size)) return;
    const box = entryBounds(entry.matrix, entry.size);
    const prior = before.layers[index] ? entryBounds(before.layers[index].matrix, before.layers[index].size) : null;
    if (!box || !prior) return;
    if (Math.abs(box.x - prior.x) > 3 || Math.abs(box.y - prior.y) > 3 || Math.abs(box.width - prior.width) > 3 || Math.abs(box.height - prior.height) > 3) return;
    if (box.width >= scene.width * FULL && box.height >= scene.height * FULL) return;
    out.push({ layer, box: { x: box.x / scene.width, y: box.y / scene.height, width: box.width / scene.width, height: box.height / scene.height }, behind: layer.type === 'text' && underSubject(scene, index) });
  });
  return out;
}

/** The scenes a comp draws at its own time `t`: fused layer stacks, and motion clips drawn alone. */
function scenesAt(project: Project, comp: Comp, t: number): { scene: MotionScene; time: number; group: string }[] {
  const out: { scene: MotionScene; time: number; group: string }[] = [];
  const groups = stackGroups(project, comp);
  const grouped = new Set(groups.flatMap((group) => group.clips.map((clip) => clip.id)));
  for (const group of groups) if (t >= group.start && t < group.end) out.push({ scene: group.scene, time: t, group: group.key });
  const visible = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  for (const clip of comp.clips) {
    if (!clip.enabled || grouped.has(clip.id) || !visible.has(clip.trackId) || clip.source.type !== 'motion' || t < clip.start || t >= clipEnd(clip)) continue;
    const scene = clip.source.scene;
    out.push({ scene, time: Math.max(0, Math.min(scene.duration - 1e-3, sourceTimeAt(clip, t))), group: clip.id });
  }
  return out;
}

/** Picture box of a media clip at `t` in fractions of the comp, or null when it fills the frame. */
function pictureBox(clip: Clip, width: number, height: number, comp: Comp, t: number): Box | null {
  const transform = { ...clip.transform, x: animated(clip, 'x', t, clip.transform.x), y: animated(clip, 'y', t, clip.transform.y), scale: animated(clip, 'scale', t, clip.transform.scale) };
  const place = placement(transform, width, height, comp.width, comp.height);
  const keepW = 1 - (clip.transform.cropLeft + clip.transform.cropRight) / 100;
  const keepH = 1 - (clip.transform.cropTop + clip.transform.cropBottom) / 100;
  const box = {
    x: (place.left + (clip.transform.cropLeft / 100) * place.width) / comp.width,
    y: (place.top + (clip.transform.cropTop / 100) * place.height) / comp.height,
    width: (place.width * keepW) / comp.width,
    height: (place.height * keepH) / comp.height,
  };
  // A picture that fills (or overfills) the frame is the frame, not a card on it.
  if (box.width >= FULL && box.height >= FULL) return null;
  if (box.x <= 0.005 && box.y <= 0.005 && box.x + box.width >= 0.995 && box.y + box.height >= 0.995) return null;
  return box;
}

const BACKGROUND = /background|backdrop|gradient|wallpaper|texture|\bbg\b/i;

/**
 * Everything QA measures on `comp` at `times`: one entry per thing per sampled moment (its box at
 * that moment), plus the HTML graphics, titles and captions with their windows.
 */
export async function collectQaLayers(project: Project, assets: AssetMap, comp: Comp, times: number[], sources: QaSources): Promise<QaLayer[]> {
  const layers: QaLayer[] = [];
  const visible = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  const rotoCache = new Map<string, Promise<RotoSubjects | null>>();
  const frameAspect = comp.width / Math.max(1, comp.height);
  // Motion stacks and scenes drawn directly on this comp.
  for (const t of times) {
    for (const { scene, time, group } of scenesAt(project, comp, t)) {
      for (const { layer, box, behind } of restingLayerBoxes(scene, time, comp.fps)) {
        layers.push({ clipId: group, group, name: layerTitle(layer), kind: layer.type === 'text' ? 'text' : 'graphic', box, from: t, to: t + 1e-3, behind });
      }
    }
  }
  for (const clip of comp.clips) {
    if (!clip.enabled || !visible.has(clip.trackId)) continue;
    const from = clip.start;
    const to = clipEnd(clip);
    const name = clip.name ?? clip.id;
    if (clip.source.type === 'html') {
      // The layers of one opened graphic are designed together, not a collision.
      const stack = htmlLayerInfo(clip.source)?.stack;
      layers.push({ clipId: stack ? `html:${stack}` : clip.id, ...(stack ? { group: `html:${stack}` } : {}), name, kind: 'graphic', box: clip.source.box ?? { x: 0, y: 0, width: 1, height: 1 }, from, to });
    } else if (clip.source.type === 'text') {
      const box = textBox(clip, comp);
      if (box) layers.push({ clipId: clip.id, name: `${clip.source.preset} "${clip.source.text.slice(0, 24)}"`, kind: clip.source.preset === 'caption' ? 'caption' : 'text', box, from, to });
    } else if (clip.source.type === 'comp') {
      const child = project.comps.find((c) => c.id === (clip.source as { compId: string }).compId);
      if (!child) continue;
      const html = child.clips.find((c) => c.source.type === 'html');
      if (html && html.source.type === 'html') {
        const map = holderMap(clip, from);
        layers.push({ clipId: clip.id, name, kind: 'graphic', box: map(html.source.box ?? { x: 0, y: 0, width: 1, height: 1 }), from, to });
        continue;
      }
      for (const t of times) {
        if (t < from || t >= to) continue;
        const childTime = sourceTimeAt(clip, t);
        const map = holderMap(clip, t);
        for (const { scene, time, group } of scenesAt(project, child, childTime)) {
          for (const { layer, box, behind } of restingLayerBoxes(scene, time, comp.fps)) {
            layers.push({ clipId: clip.id, group: `${clip.id}/${group}`, name: `${layerTitle(layer)} (${child.name})`, kind: layer.type === 'text' ? 'text' : 'graphic', box: map(box), from: t, to: t + 1e-3, behind });
          }
        }
      }
    } else if (clip.source.type === 'media') {
      const asset = assets.get(clip.source.assetId);
      if (!asset || asset.kind === 'audio') continue;
      const label = asset.name.replace(/\.[a-z0-9]+$/i, '');
      // A reduced picture is a card on the frame: it must sit inside it like any graphic.
      if (!BACKGROUND.test(`${clip.name ?? ''} ${asset.name}`)) {
        for (const t of times) {
          if (t < from || t >= to) continue;
          const box = pictureBox(clip, asset.width, asset.height, comp, t);
          if (box) layers.push({ clipId: clip.id, name: `${label} card`, kind: 'picture', box, from: t, to: t + 1e-3 });
        }
      }
      if (clip.rotoMatte && !(clip.name ?? '').toLowerCase().includes('background')) {
        const runId = clip.rotoMatte.replace(/[\\/]+matte\.[a-z0-9]+$/i, '').split(/[\\/]/).pop() ?? '';
        if (!runId) continue;
        if (!rotoCache.has(runId)) rotoCache.set(runId, sources.rotoSubjects(runId).catch(() => null));
        const subjects = await rotoCache.get(runId)!;
        if (!subjects?.length) continue;
        const srcAspect = asset.width / Math.max(1, asset.height);
        for (const t of times) {
          if (t < from || t >= to) continue;
          const source = clip.in + (t - clip.start) * clip.speed;
          let best = subjects[0];
          for (const s of subjects) if (Math.abs(s.at - source) < Math.abs(best.at - source)) best = s;
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
  return layers;
}

export type FrameStats = { white: number; dark: number; flat: number; mean: number };

/**
 * How a rendered frame reads, from a 96×54 thumbnail of it: the share of flat near-white pixels
 * (bright and colourless), of near-black ones, and of pixels within a hair of the median
 * brightness (one flat colour).
 */
export async function frameStats(path: string): Promise<FrameStats | null> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('frame did not load'));
      img.src = `${fileSrc(path)}${fileSrc(path).includes('?') ? '&' : '?'}qa=${Date.now()}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 54;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 96, 54);
    const { data } = context.getImageData(0, 0, 96, 54);
    const lum: number[] = [];
    let white = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum.push(l);
      if (l >= 0.85 && Math.max(r, g, b) - Math.min(r, g, b) <= 0.12) white++;
      if (l <= 0.03) dark++;
    }
    const n = lum.length;
    const sorted = [...lum].sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    const flat = lum.filter((l) => Math.abs(l - median) <= 0.035).length;
    return { white: white / n, dark: dark / n, flat: flat / n, mean: lum.reduce((a, b) => a + b, 0) / n };
  } catch {
    return null;
  }
}

/** The blank-frame finding for a frame's stats, or null when it reads as a picture. */
export function blankFinding(stats: FrameStats): { what: string; share: number } | null {
  if (stats.white >= 0.55) return { what: `${Math.round(stats.white * 100)}% of the frame is flat near-white — it reads as a blank white screen (a light stage or panel covering the background, or no background at all)`, share: stats.white };
  if (stats.dark >= 0.92) return { what: `${Math.round(stats.dark * 100)}% of the frame is black — an empty frame`, share: stats.dark };
  if (stats.flat >= 0.9) return { what: `${Math.round(stats.flat * 100)}% of the frame is one flat colour — nothing designed behind or on it`, share: stats.flat };
  return null;
}
