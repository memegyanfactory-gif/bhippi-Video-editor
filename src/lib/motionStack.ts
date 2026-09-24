// Layered motion comps. A motion scene opens as a comp with one clip per layer, each on its own
// track (Stage, Title left, Subject, Phrase…), the way After Effects shows a comp's layers: each
// one can be moved, trimmed, hidden, deleted, restacked or restyled on its own.
//
// It still draws as one scene. The layer clips of consecutive tracks are fused back into a single
// MotionScene (`stackGroups`) that the GPU renderer draws in one pass, so everything that needs
// the layers together — track mattes, parents, frosted-glass backdrops, blend and adjustment
// layers, the 3D camera — works exactly as the template built it. Where a clip cannot be fused (a
// transition, an NLE effect, mask or crop, a reversed or held clip) it draws on its own, with
// hidden `ref` copies of its parent, matte and camera so it still lands in the right place.
//
// Where a clip sits and how fast it runs become the layer's Start Time and Time Stretch; its
// Motion properties (position, scale, rotation, opacity and their keyframes) become the layer's
// `frame`. Everything lives in the clip's scene JSON, so the project format does not change.
import { uid } from './editor';
import { valueAt } from './keyframes';
import { clipEnd, compDuration, newClip, newComp, newTrack, tracksOf } from './timeline';
import type { Clip, Comp, Easing, Keyframe, LabelColor, Project } from './types';
import type { Ease, Key, Layer, MotionScene, Prop, Vec } from '../motion/types';

type MotionSource = Extract<Clip['source'], { type: 'motion' }>;
export type LayerClip = Clip & { source: MotionSource };

/** A clip that is one layer of a layered motion comp. */
export const isLayerClip = (clip: Clip): clip is LayerClip => clip.source.type === 'motion' && !!clip.source.scene.stack;

/** The layers a layer clip stands for (one, unless an older scene put several in one clip). */
export function ownLayers(scene: MotionScene): Layer[] {
  const own = scene.stack ? new Set(scene.stack.own) : null;
  return scene.layers.filter((layer) => !layer.ref && (!own || own.has(layer.id)));
}

/** A readable name for a layer: its name, the start of its text, or its id. */
export function layerTitle(layer: Layer): string {
  const text = layer.type === 'text' ? (layer.text.text ?? layer.text.spans?.map((span) => span.text).join('') ?? '').replace(/\s+/g, ' ').trim() : '';
  return (layer.name?.trim() || text.slice(0, 32) || layer.id).slice(0, 48);
}

const LABEL: Partial<Record<Layer['type'], LabelColor>> = { text: 'lavender', shape: 'cerulean', footage: 'iris', procedural: 'forest', solid: 'forest', precomp: 'mango', null: 'tan', camera: 'tan' };

/** The layers `layer` needs beside it to draw right on its own: its parents, its matte (and theirs), the camera when it is 3D. */
function supportIds(scene: MotionScene, layer: Layer): Set<string> {
  const byId = new Map(scene.layers.map((entry) => [entry.id, entry]));
  const out = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || id === layer.id || out.has(id)) return;
    const found = byId.get(id);
    if (!found) return;
    out.add(id);
    add(found.parent);
    add(found.matte?.layer);
  };
  add(layer.parent);
  add(layer.matte?.layer);
  if (layer.threeD || [...out].some((id) => byId.get(id)?.threeD)) for (const entry of scene.layers) if (entry.type === 'camera') add(entry.id);
  return out;
}

export type ExplodedLayer = { layerId: string; clipId: string; trackId: string; compId: string; name: string; type: Layer['type']; start: number; end: number };
export type Exploded = { comp: Comp; nested: Comp[]; layers: ExplodedLayer[] };

/**
 * Opens `scene` into a layered comp: one video track and one clip per layer, bottom to top, each
 * clip spanning the layer's in/out. A precomp layer's own layers go to a nested layered comp it
 * points at (`comp`), so "Shot as card" opens like any other comp. A scene background colour
 * becomes a solid layer at the bottom.
 */
export function explodeScene(scene: MotionScene, options: { name: string; fps: number; width?: number; height?: number }, depth = 0): Exploded {
  const base = newComp({ name: options.name, width: options.width ?? scene.width, height: options.height ?? scene.height, fps: options.fps });
  const audio = base.tracks.filter((track) => track.kind === 'audio').slice(0, 1);
  const taken = new Set(scene.layers.map((layer) => layer.id));
  let backgroundId = 'background';
  while (taken.has(backgroundId)) backgroundId += '-fill';
  const layers: Layer[] = scene.background ? [{ id: backgroundId, name: 'Background', type: 'solid', color: scene.background }, ...scene.layers] : scene.layers;
  const full: MotionScene = { ...scene, background: null, layers };
  const stackId = uid();
  const frame = 1 / Math.max(1, options.fps);
  const tracks: Comp['tracks'] = [];
  const clips: Clip[] = [];
  const nested: Comp[] = [];
  const listing: ExplodedLayer[] = [];
  full.layers.forEach((layer) => {
    const start = Math.min(Math.max(0, layer.in ?? 0), Math.max(0, full.duration - frame));
    const end = Math.min(full.duration, layer.out ?? full.duration);
    if (end - start < frame / 2 && layer.type !== 'camera' && layer.type !== 'null') return;
    const own = { ...layer } as Layer;
    delete own.in;
    delete own.out;
    const title = layerTitle(layer);
    if (layer.type === 'precomp' && own.type === 'precomp' && depth < 6) {
      const inner = explodeScene(layer.scene, { name: `${options.name} · ${title}`, fps: options.fps }, depth + 1);
      nested.push(inner.comp, ...inner.nested);
      own.comp = inner.comp.id;
      listing.push(...inner.layers);
    }
    const support = supportIds(full, layer);
    const clipScene: MotionScene = {
      version: 1,
      width: full.width,
      height: full.height,
      duration: full.duration,
      ...(full.motionBlur ? { motionBlur: full.motionBlur } : {}),
      ...(full.seed !== undefined ? { seed: full.seed } : {}),
      ...(full.template ? { template: full.template } : {}),
      // The brand snapshot is large: the bottom clip carries it for rebuilds, the rest name the kit.
      ...(full.brand && !clips.length ? { brand: full.brand } : {}),
      stack: { id: stackId, own: [layer.id] },
      layers: full.layers.flatMap((entry) => (entry.id === layer.id ? [own] : support.has(entry.id) ? [{ ...entry, hidden: true, ref: true } as Layer] : [])),
    };
    const track = { ...newTrack('video'), name: title };
    tracks.push(track);
    const clip = newClip({ trackId: track.id, start, in: start, duration: Math.max(frame, end - start), source: { type: 'motion', scene: clipScene, title }, name: title, label: LABEL[layer.type] ?? 'mango' });
    clips.push(clip);
    listing.push({ layerId: layer.id, clipId: clip.id, trackId: track.id, compId: base.id, name: title, type: layer.type, start, end: start + clip.duration });
  });
  if (!tracks.length) tracks.push(newTrack('video'));
  return { comp: { ...base, tracks: [...tracks, ...audio], clips, sourceVideo: tracks[0].id, sourceAudio: audio[0]?.id ?? null }, nested, layers: listing };
}

/** Every comp of a layered stack: the comp and, recursively, the precomp comps its layers point at. */
export function stackComps(project: Project, compId: string, seen = new Set<string>()): Comp[] {
  if (seen.has(compId)) return [];
  seen.add(compId);
  const comp = project.comps.find((entry) => entry.id === compId);
  if (!comp) return [];
  const inner = comp.clips.flatMap((clip) => (isLayerClip(clip) ? ownLayers(clip.source.scene).flatMap((layer) => (layer.type === 'precomp' && layer.comp ? [layer.comp] : [])) : []));
  return [comp, ...inner.flatMap((id) => stackComps(project, id, seen))];
}

/** Whether a comp is a layered motion comp: it holds layer clips (the user may have added other pictures beside them). */
export function isLayeredComp(comp: Comp): boolean {
  const video = new Set(tracksOf(comp, 'video').map((track) => track.id));
  return comp.clips.some((clip) => video.has(clip.trackId) && isLayerClip(clip));
}

/** A layered comp's layer clips, bottom track first, then by start. */
function layerClipsOf(comp: Comp): LayerClip[] {
  const order = new Map(tracksOf(comp, 'video').map((track, index) => [track.id, index]));
  return comp.clips.filter((clip): clip is LayerClip => isLayerClip(clip) && order.has(clip.trackId))
    .sort((a, b) => order.get(a.trackId)! - order.get(b.trackId)! || a.start - b.start);
}

/**
 * A layered comp read back as the one scene it stands for, in each layer's own time (a layer's
 * in/out are its clip's in point and length, whatever it was moved to): what the AI patches and
 * what a template rebuild replaces. Precomp layers carry their own comp's scene. Null without layers.
 */
export function logicalScene(project: Project, comp: Comp, depth = 0): MotionScene | null {
  const clips = layerClipsOf(comp);
  if (!clips.length || depth > 6) return null;
  const seen = new Set<string>();
  const layers: Layer[] = [];
  for (const clip of clips) {
    for (const layer of ownLayers(clip.source.scene)) {
      if (seen.has(layer.id)) continue; // a razor piece of a layer already read
      seen.add(layer.id);
      let own = { ...layer, in: clip.in, out: clip.in + clip.duration * clip.speed } as Layer;
      if (own.type === 'precomp' && own.comp) {
        const inner = project.comps.find((entry) => entry.id === (own as { comp?: string }).comp);
        const innerScene = inner ? logicalScene(project, inner, depth + 1) : null;
        if (innerScene) own = { ...own, scene: innerScene } as Layer;
      }
      layers.push(own);
    }
  }
  const withTemplate = clips.find((clip) => clip.source.scene.template)?.source.scene;
  const withBrand = clips.find((clip) => clip.source.scene.brand)?.source.scene;
  const first = clips[0].source.scene;
  return {
    version: 1,
    width: comp.width,
    height: comp.height,
    duration: Math.max(first.duration, ...layers.map((layer) => layer.out ?? 0)),
    ...(first.motionBlur ? { motionBlur: first.motionBlur } : {}),
    ...(first.seed !== undefined ? { seed: first.seed } : {}),
    ...(withTemplate?.template ? { template: withTemplate.template } : {}),
    ...(withBrand?.brand ? { brand: withBrand.brand } : {}),
    layers,
  };
}

/**
 * Writes `scene` back into the layered comp `compId`, keeping what the user made of it: a layer
 * that is still there keeps its clip (id, track, Motion properties, effects, on/off) and its
 * track (lock, visibility, name, place in the stack); `timing: 'keep'` also keeps where the clip
 * sits and how long it is, `'scene'` re-times clips nobody moved to the scene's in/out. New layers
 * get a track right above the layer below them; layers gone lose their clip and, when empty,
 * their track. Precomp layers write into the comps they already have.
 */
export function restack(project: Project, compId: string, scene: MotionScene, timing: 'keep' | 'scene', depth = 0): Project {
  const comp = project.comps.find((entry) => entry.id === compId);
  if (!comp || depth > 6) return project;
  const fresh = explodeScene(scene, { name: comp.name, fps: comp.fps, width: comp.width, height: comp.height });
  const oldClips = layerClipsOf(comp);
  const stackId = oldClips[0]?.source.scene.stack?.id ?? fresh.comp.clips.find(isLayerClip)?.source.scene.stack?.id ?? uid();
  const byLayer = new Map<string, LayerClip[]>();
  for (const clip of oldClips) for (const layer of ownLayers(clip.source.scene)) byLayer.set(layer.id, [...(byLayer.get(layer.id) ?? []), clip]);
  let next = project;
  const freshTracks = new Map(fresh.comp.tracks.map((track) => [track.id, track]));
  const clips: Clip[] = comp.clips.filter((clip) => !isLayerClip(clip));
  const keptTracks = new Set<string>();
  const added: { track: Comp['tracks'][number]; below: string | null }[] = [];
  let below: string | null = null;
  const dropNested = new Set<string>();
  for (const freshClip of fresh.comp.clips as LayerClip[]) {
    const layerId = freshClip.source.scene.stack!.own[0];
    let clipScene: MotionScene = { ...freshClip.source.scene, stack: { id: stackId, own: [layerId] } };
    const olds = byLayer.get(layerId) ?? [];
    // A precomp that already has its comp writes into it; the comp explode just made is dropped.
    const ownFresh = ownLayers(clipScene)[0];
    const oldPrecomp = olds.map((clip) => ownLayers(clip.source.scene)[0]).find((layer) => layer?.type === 'precomp' && layer.comp && next.comps.some((entry) => entry.id === layer.comp));
    if (ownFresh?.type === 'precomp' && ownFresh.comp && oldPrecomp?.type === 'precomp' && oldPrecomp.comp) {
      dropNested.add(ownFresh.comp);
      next = restack(next, oldPrecomp.comp, ownFresh.scene, timing, depth + 1);
      const target = oldPrecomp.comp;
      clipScene = { ...clipScene, layers: clipScene.layers.map((layer) => (layer.id === layerId && layer.type === 'precomp' ? { ...layer, comp: target } : layer)) };
    }
    if (!olds.length) {
      const track = freshTracks.get(freshClip.trackId)!;
      added.push({ track, below });
      clips.push({ ...freshClip, source: { ...freshClip.source, scene: clipScene } });
      below = track.id;
      continue;
    }
    olds.forEach((old, index) => {
      keptTracks.add(old.trackId);
      const untouched = old.start === old.in && old.speed === 1;
      const retime = timing === 'scene' && index === 0 && untouched;
      clips.push({
        ...old,
        source: { ...old.source, scene: clipScene, title: freshClip.source.title, frames: undefined },
        name: freshClip.name,
        ...(retime ? { start: freshClip.start, in: freshClip.in, duration: freshClip.duration } : {}),
      });
    });
    below = olds[olds.length - 1].trackId;
  }
  // Tracks: the old order, less the tracks that emptied, with each new layer's track above the layer below it.
  const gone = new Set(oldClips.map((clip) => clip.trackId).filter((id) => !keptTracks.has(id) && !clips.some((clip) => clip.trackId === id)));
  let tracks = comp.tracks.filter((track) => !gone.has(track.id));
  for (const { track, below: under } of added) {
    const at = under ? tracks.findIndex((entry) => entry.id === under) + 1 : 0;
    tracks = [...tracks.slice(0, at), track, ...tracks.slice(at)];
  }
  // The comps explode made for precomps that wrote into their existing comps, with everything under them.
  const freshOnly = { ...project, comps: fresh.nested };
  const dropped = new Set([...dropNested].flatMap((id) => stackComps(freshOnly, id).map((entry) => entry.id)));
  const nested = fresh.nested.filter((entry) => !dropped.has(entry.id));
  // Precomp comps of layers that are gone go with them.
  const stillReferenced = new Set(clips.flatMap((clip) => (isLayerClip(clip) ? ownLayers(clip.source.scene).flatMap((layer) => (layer.type === 'precomp' && layer.comp ? [layer.comp] : [])) : [])));
  const orphaned = new Set(oldClips.flatMap((clip) => ownLayers(clip.source.scene).flatMap((layer) => (layer.type === 'precomp' && layer.comp && !stillReferenced.has(layer.comp) ? stackComps(next, layer.comp).map((entry) => entry.id) : []))));
  const folderId = comp.folderId;
  return {
    ...next,
    comps: [
      ...next.comps.filter((entry) => !orphaned.has(entry.id)).map((entry) => (entry.id === comp.id ? { ...entry, tracks, clips } : entry)),
      ...nested.map((entry) => ({ ...entry, folderId })),
    ],
  };
}

// ───────────────────────── clip Motion properties → the layer's frame ─────────────────────────

const EASE: Record<Easing, Ease> = { linear: 'linear', hold: 'hold', ease: 'sine-in-out', 'ease-in': 'cubic-in', 'ease-out': 'cubic-out', 'ease-in-out': 'quart-in-out', overshoot: 'back-out' };

function keyed(keys: Keyframe[], rest: number, at: (local: number) => number, map: (value: number) => number): Prop<number> {
  if (!keys.length) return map(rest);
  return { k: [...keys].sort((a, b) => a.time - b.time).map((key) => ({ t: at(key.time), v: map(key.value), ease: EASE[key.easing] ?? 'linear' })) };
}

/**
 * A layer clip's Motion properties as the layer's `frame`, or null when they are at rest. `at`
 * turns a keyframe's clip-local time into the time the layer's scene is evaluated at.
 */
export function frameOf(clip: Clip, width: number, height: number, at: (local: number) => number): NonNullable<Layer['frame']> | null {
  const t = clip.transform;
  const k = clip.keyframes;
  const frame: NonNullable<Layer['frame']> = {};
  if (t.x || t.y || k.x.length || k.y.length) {
    if (!k.x.length && !k.y.length) frame.offset = [t.x * width, t.y * height];
    else {
      const times = [...new Set([...k.x, ...k.y].map((key) => key.time))].sort((a, b) => a - b);
      frame.offset = {
        k: times.map((time): Key<Vec> => ({
          t: at(time),
          v: [(valueAt(k.x, time) ?? t.x) * width, (valueAt(k.y, time) ?? t.y) * height],
          ease: EASE[([...k.x, ...k.y].find((key) => key.time === time)?.easing) ?? 'linear'],
        })),
      };
    }
  }
  if (t.scale !== 100 || k.scale.length) frame.scale = keyed(k.scale, t.scale, at, (v) => v);
  if (t.rotation || k.rotation.length) frame.rotation = keyed(k.rotation, t.rotation, at, (v) => v);
  if (t.opacity !== 100 || k.opacity.length) frame.opacity = keyed(k.opacity, t.opacity, at, (v) => v);
  return Object.keys(frame).length ? frame : null;
}

// ───────────────────────── fusing a comp's layer clips into one scene ─────────────────────────

/**
 * Whether a layer clip can draw as part of its stack. The things only the timeline can do to a
 * picture — its transitions, effects, masks and crops, reverse and frame holds — draw it on its own.
 */
export function fusable(comp: Comp, clip: Clip): clip is LayerClip {
  if (!isLayerClip(clip) || !clip.enabled || clip.adjustment || clip.hold !== null || clip.reverse || !(clip.speed > 0) || clip.mask) return false;
  const t = clip.transform;
  if (t.cropLeft || t.cropTop || t.cropRight || t.cropBottom) return false;
  const e = clip.effects;
  if (e.blur || e.brightness || e.contrast || e.hue || e.invert || e.saturation !== 100 || e.flipH || e.flipV) return false;
  if (clip.appliedEffects?.some((effect) => effect.enabled)) return false;
  return !comp.transitions.some((transition) => transition.fromClip === clip.id || transition.toClip === clip.id);
}

/** Consecutive video tracks of a comp whose clips draw as one scene; `owner` maps each fused layer id to its clip. */
export type StackGroup = { key: string; trackIds: string[]; clips: LayerClip[]; start: number; end: number; scene: MotionScene; owner: Map<string, string> };

/** `lossy`: what the precomps drawn in it leave out (see `compScene`). */
type Cached = { deps: Map<string, Comp>; groups: StackGroup[]; lossy: string[] };
type Alone = { deps: Map<string, Comp>; scene: MotionScene; lossy: string[] };
const groupCache = new WeakMap<Comp, Cached>();
const standaloneCache = new WeakMap<Clip, Alone>();

const fresh = (project: Project, deps: Map<string, Comp>) => [...deps].every(([id, comp]) => project.comps.find((entry) => entry.id === id) === comp);

/** The fused groups of a comp (memoised on the comp and the precomp comps it reads). */
export function stackGroups(project: Project, comp: Comp): StackGroup[] {
  return groupsOf(project, comp, new Set()).groups;
}

function groupsOf(project: Project, comp: Comp, visiting: Set<string>): Cached {
  const hit = groupCache.get(comp);
  if (hit && fresh(project, hit.deps)) return hit;
  if (visiting.has(comp.id)) return { deps: new Map(), groups: [], lossy: [] };
  visiting.add(comp.id);
  const deps = new Map<string, Comp>();
  const groups: StackGroup[] = [];
  const lossy: string[] = [];
  let run: { trackIds: string[]; clips: LayerClip[] } | null = null;
  const close = () => {
    if (run?.clips.length) groups.push(fuse(project, comp, run, deps, visiting, lossy));
    run = null;
  };
  for (const track of tracksOf(comp, 'video')) {
    if (track.hidden) continue;
    const clips = comp.clips.filter((clip) => clip.trackId === track.id && clip.enabled);
    if (!clips.length) continue;
    if (clips.every((clip) => fusable(comp, clip))) {
      run ??= { trackIds: [], clips: [] };
      run.trackIds.push(track.id);
      run.clips.push(...(clips as LayerClip[]).sort((a, b) => a.start - b.start));
    } else close();
  }
  close();
  visiting.delete(comp.id);
  const entry = { deps, groups, lossy };
  groupCache.set(comp, entry);
  return entry;
}

/** The fused group that draws the whole of a comp's picture, if one does. */
function wholeGroup(comp: Comp, groups: StackGroup[]): StackGroup | null {
  const picture = tracksOf(comp, 'video').filter((track) => !track.hidden && comp.clips.some((clip) => clip.trackId === track.id && clip.enabled));
  return groups.length === 1 && picture.every((track) => groups[0].trackIds.includes(track.id)) ? groups[0] : null;
}

/** What the timeline does to a clip of a precomp's comp that the precomp's scene cannot: crop, effects, a mask, transitions. */
function notDrawn(comp: Comp, clip: Clip): string[] {
  const t = clip.transform;
  const e = clip.effects;
  const out: string[] = [];
  if (t.cropLeft || t.cropTop || t.cropRight || t.cropBottom) out.push('crop');
  if (e.blur || e.brightness || e.contrast || e.hue || e.invert || e.saturation !== 100 || e.flipH || e.flipV || clip.appliedEffects?.some((effect) => effect.enabled)) out.push('effects');
  if (clip.mask) out.push('mask');
  if (clip.adjustment) out.push('adjustment');
  if (comp.transitions.some((transition) => transition.fromClip === clip.id || transition.toClip === clip.id)) out.push('transitions');
  // A plain scene's Motion properties move the whole picture, which only the timeline does.
  if (!isLayerClip(clip) && frameOf(clip, 1, 1, (local) => local)) out.push('Motion properties');
  return out;
}

/**
 * A precomp's layered comp as the one scene it draws today, or null when there is no such comp.
 * A comp that fuses whole is its group's scene. Otherwise each fused group and each clip that
 * draws on its own (`standaloneScene`) is a precomp of its own, bottom first, on its clip's
 * clock, so every move, trim and new layer shows. What only the timeline can draw (crops,
 * effects, masks, transitions, pictures that are not motion scenes) is left out and named in
 * `lossy`.
 */
function compScene(project: Project, compId: string, deps: Map<string, Comp>, visiting: Set<string>): { scene: MotionScene; lossy: string[] } | null {
  const inner = project.comps.find((entry) => entry.id === compId);
  if (!inner) return null;
  deps.set(inner.id, inner);
  const cached = groupsOf(project, inner, visiting);
  for (const [id, comp] of cached.deps) deps.set(id, comp);
  const duration = Math.max(1 / Math.max(1, inner.fps), compDuration(inner));
  // A precomp's layers that run to its end stay on past it, as a layer with no out point does.
  const open = (layers: Layer[]) => layers.map((layer) => (layer.out !== undefined && layer.out >= duration - 1e-6 ? ({ ...layer, out: undefined } as Layer) : layer));
  const whole = wholeGroup(inner, cached.groups);
  if (whole) return { scene: { ...whole.scene, layers: open(whole.scene.layers), width: inner.width, height: inner.height, duration }, lossy: cached.lossy };
  if (visiting.has(inner.id)) return null;
  visiting.add(inner.id);
  const lossy = [...cached.lossy];
  const where = inner.name.split(' · ').pop();
  const grouped = new Map(cached.groups.flatMap((group) => group.trackIds.map((id) => [id, group] as const)));
  const layers: Layer[] = [];
  for (const track of tracksOf(inner, 'video')) {
    if (track.hidden) continue;
    const group = grouped.get(track.id);
    if (group) {
      if (group.trackIds[0] === track.id) layers.push({ id: group.key, type: 'precomp', scene: { ...group.scene, layers: open(group.scene.layers) }, in: group.start, out: group.end });
      continue;
    }
    for (const clip of inner.clips.filter((entry) => entry.trackId === track.id && entry.enabled).sort((a, b) => a.start - b.start)) {
      const name = clip.name ?? clip.id;
      if (clip.source.type !== 'motion') {
        lossy.push(`${name}: a ${clip.source.type} clip is not drawn inside '${where}'`);
        continue;
      }
      const alone: Alone = isLayerClip(clip) ? standalone(project, clip, visiting) : { deps: new Map(), scene: clip.source.scene, lossy: [] };
      for (const [id, comp] of alone.deps) deps.set(id, comp);
      lossy.push(...alone.lossy);
      const missing = notDrawn(inner, clip);
      if (missing.length) lossy.push(`${name}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not applied inside '${where}'`);
      // The clip's clock: its in point and speed, run backwards when reversed, stopped on a held frame.
      const clock = clip.hold !== null ? { timeScale: 0, offset: -clip.hold } : clip.reverse ? { startTime: clipEnd(clip) + clip.in / clip.speed, timeScale: -clip.speed } : { startTime: clip.start - clip.in / clip.speed, timeScale: clip.speed };
      layers.push({ id: clip.id, type: 'precomp', scene: alone.scene, in: clip.start, out: clipEnd(clip), ...clock });
    }
  }
  visiting.delete(inner.id);
  const first = cached.groups[0]?.scene;
  const scene: MotionScene = {
    version: 1,
    width: inner.width,
    height: inner.height,
    duration,
    ...(first?.motionBlur ? { motionBlur: first.motionBlur } : {}),
    ...(first?.seed !== undefined ? { seed: first.seed } : {}),
    layers: open(layers),
  };
  return { scene, lossy: [...new Set(lossy)] };
}

/** Points a precomp layer at the scene its layered comp draws today (its own `scene` only when that comp is gone). */
function withComp(layer: Layer, project: Project, deps: Map<string, Comp>, visiting: Set<string>, lossy: string[]): Layer {
  if (layer.type !== 'precomp' || !layer.comp) return layer;
  const drawn = compScene(project, layer.comp, deps, visiting);
  if (!drawn) return layer;
  lossy.push(...drawn.lossy);
  return { ...layer, scene: drawn.scene };
}

function fuse(project: Project, comp: Comp, run: { trackIds: string[]; clips: LayerClip[] }, deps: Map<string, Comp>, visiting: Set<string>, lossy: string[]): StackGroup {
  const primary = run.clips[0].source.scene.stack?.id ?? '';
  // Ids are per stack: two templates both have a "headline". Layers from a second stack get a suffix, references with them.
  const named = (stack: string, id: string) => (stack === primary ? id : `${id}@${stack.slice(0, 6)}`);
  const own = new Set(run.clips.flatMap((clip) => ownLayers(clip.source.scene).map((layer) => named(clip.source.scene.stack?.id ?? '', layer.id))));
  const refs = new Map<string, Layer>();
  const layers: Layer[] = [];
  const used = new Set<string>();
  const owner = new Map<string, string>();
  for (const clip of run.clips) {
    const scene = clip.source.scene;
    const stack = scene.stack?.id ?? '';
    const rename = (layer: Layer, id: string): Layer => ({
      ...layer,
      id,
      ...(layer.parent ? { parent: named(stack, layer.parent) } : {}),
      ...(layer.matte ? { matte: { ...layer.matte, layer: named(stack, layer.matte.layer) } } : {}),
    });
    const mine = new Set(ownLayers(scene).map((layer) => layer.id));
    const startTime = clip.start - clip.in / clip.speed;
    const toScene = (local: number) => startTime + local / clip.speed;
    const frame = frameOf(clip, comp.width, comp.height, (local) => clip.start + local);
    for (const layer of scene.layers) {
      const id = named(stack, layer.id);
      if (!mine.has(layer.id)) {
        // A copy for a layer whose own clip is not in this run (deleted, hidden, elsewhere).
        if (!own.has(id) && !refs.has(id)) refs.set(id, rename({ ...layer, hidden: true, ref: true } as Layer, id));
        continue;
      }
      let unique = id;
      for (let n = 2; used.has(unique); n++) unique = `${id}~${n}`;
      used.add(unique);
      owner.set(unique, clip.id);
      const from = layer.in !== undefined ? Math.max(clip.start, toScene(layer.in)) : clip.start;
      const to = layer.out !== undefined ? Math.min(clipEnd(clip), toScene(layer.out)) : clipEnd(clip);
      const placed: Layer = {
        ...withComp(rename(layer, unique), project, deps, visiting, lossy),
        in: from,
        out: Math.max(from, to),
        ...(Math.abs(startTime) > 1e-9 ? { startTime } : {}),
        ...(clip.speed !== 1 ? { timeScale: clip.speed } : {}),
        ...(frame ? { frame } : {}),
      } as Layer;
      layers.push(placed);
    }
  }
  const first = run.clips[0].source.scene;
  const start = Math.min(...run.clips.map((clip) => clip.start));
  const end = Math.max(...run.clips.map(clipEnd));
  const scene: MotionScene = {
    version: 1,
    width: comp.width,
    height: comp.height,
    duration: Math.max(1 / Math.max(1, comp.fps), end),
    ...(first.motionBlur ? { motionBlur: first.motionBlur } : {}),
    ...(first.seed !== undefined ? { seed: first.seed } : {}),
    layers: [...refs.values(), ...layers],
  };
  return { key: `${comp.id}:${run.trackIds.join(',')}`, trackIds: run.trackIds, clips: run.clips, start, end, scene, owner };
}

/**
 * The scene a layer clip draws when it is not fused (see `fusable`): its precomp layers resolved
 * to their comps and its Motion properties baked in as the layer's `frame`, in the clip's own
 * scene time. Plain motion clips come back unchanged.
 */
export function standaloneScene(project: Project, clip: Clip): MotionScene | null {
  if (clip.source.type !== 'motion') return null;
  if (!isLayerClip(clip)) return clip.source.scene;
  return standalone(project, clip, new Set()).scene;
}

function standalone(project: Project, clip: LayerClip, visiting: Set<string>): Alone {
  const hit = standaloneCache.get(clip);
  if (hit && fresh(project, hit.deps)) return hit;
  const source = clip.source;
  const deps = new Map<string, Comp>();
  const lossy: string[] = [];
  const size = project.comps.find((comp) => comp.clips.includes(clip)) ?? { width: source.scene.width, height: source.scene.height };
  const frame = frameOf(clip, size.width, size.height, (local) => clip.in + local * clip.speed);
  const mine = new Set(ownLayers(source.scene).map((layer) => layer.id));
  const scene: MotionScene = {
    ...source.scene,
    layers: source.scene.layers.map((layer) => (mine.has(layer.id) ? { ...withComp(layer, project, deps, visiting, lossy), ...(frame ? { frame } : {}) } as Layer : layer)),
  };
  const entry = { deps, scene, lossy: [...new Set(lossy)] };
  standaloneCache.set(clip, entry);
  return entry;
}

/** The fused group a clip draws in, if any. */
export function groupOfClip(project: Project, comp: Comp, clipId: string): StackGroup | undefined {
  return stackGroups(project, comp).find((group) => group.clips.some((clip) => clip.id === clipId));
}

/**
 * The scene a layered comp draws as a whole (its single group), or null when it does not fuse
 * whole. What `get_motion_scene` describes and QA measures.
 */
export function layeredCompScene(project: Project, comp: Comp): MotionScene | null {
  return wholeGroup(comp, stackGroups(project, comp)) ? compScene(project, comp.id, new Map(), new Set())?.scene ?? null : null;
}

/**
 * What the precomps a layered comp draws leave out (crops, effects, masks, transitions and
 * pictures that are not motion scenes inside their comps) and, when the comp is itself a
 * precomp's comp, what its own clips lose there. Readable notes; empty when nothing is lost.
 */
export function stackLossy(project: Project, comp: Comp): string[] {
  const nested = project.comps.some((entry) => entry.clips.some((clip) => isLayerClip(clip) && ownLayers(clip.source.scene).some((layer) => layer.type === 'precomp' && layer.comp === comp.id)));
  if (nested) return compScene(project, comp.id, new Map(), new Set())?.lossy ?? [];
  const cached = groupsOf(project, comp, new Set());
  const grouped = new Set(cached.groups.flatMap((group) => group.clips.map((clip) => clip.id)));
  const visible = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  const alone = comp.clips.filter((clip): clip is LayerClip => isLayerClip(clip) && clip.enabled && visible.has(clip.trackId) && !grouped.has(clip.id)).flatMap((clip) => standalone(project, clip, new Set()).lossy);
  return [...new Set([...cached.lossy, ...alone])];
}

/**
 * Opens "[Motion]" comps that still hold their scene as one clip into layers — one clip per layer
 * on its own track — in place: the comp keeps its id, name and bin, so the clips that nest it on
 * the timeline are untouched. Anything else the user put in the comp stays, above the layers.
 * `compIds` empty means every such comp in the project. Returns the comps it split.
 */
export function splitMotionComps(project: Project, compIds: string[] = []): { project: Project; split: { id: string; name: string; layers: number }[]; skipped: string[] } {
  const split: { id: string; name: string; layers: number }[] = [];
  const skipped: string[] = [];
  let next = project;
  const targets = compIds.length ? compIds : project.comps.filter((c) => c.name.startsWith('[Motion]')).map((c) => c.id);
  for (const id of targets) {
    const comp = next.comps.find((c) => c.id === id);
    if (!comp || isLayeredComp(comp)) continue;
    const scenes = comp.clips.filter((clip) => clip.source.type === 'motion' && clip.enabled);
    if (scenes.length !== 1) { if (compIds.length) skipped.push(`${comp.name} (holds ${scenes.length} motion clips)`); continue; }
    const legacy = scenes[0];
    if (legacy.source.type !== 'motion') continue;
    if (legacy.reverse || legacy.hold !== null || Math.abs(legacy.speed - 1) > 1e-6) { skipped.push(`${comp.name} (its clip is reversed, held or re-timed)`); continue; }
    const exploded = explodeScene(legacy.source.scene, { name: comp.name, fps: comp.fps, width: comp.width, height: comp.height });
    // Scene time t shows at comp time legacy.start + (t − legacy.in); keep every layer inside the old clip's window.
    const offset = legacy.start - legacy.in;
    const windowEnd = legacy.start + legacy.duration;
    const layerClips = exploded.comp.clips.flatMap((clip) => {
      const start = Math.max(legacy.start, clip.start + offset);
      const end = Math.min(windowEnd, clip.start + offset + clip.duration);
      if (end - start < 1e-3) return [];
      return [{ ...clip, start, in: clip.in + (start - (clip.start + offset)), duration: end - start }];
    });
    const layerTracks = exploded.comp.tracks.filter((track) => track.kind === 'video');
    const others = comp.clips.filter((clip) => clip.id !== legacy.id);
    const keptTracks = comp.tracks.filter((track) => track.kind === 'audio' || others.some((clip) => clip.trackId === track.id));
    const tracks = [...layerTracks, ...keptTracks.filter((track) => track.kind === 'video'), ...keptTracks.filter((track) => track.kind === 'audio')];
    const audio = tracks.find((track) => track.kind === 'audio') ?? exploded.comp.tracks.find((track) => track.kind === 'audio');
    const comps = next.comps.map((c) => (c.id === comp.id ? { ...comp, tracks: audio && !tracks.includes(audio) ? [...tracks, audio] : tracks, clips: [...layerClips, ...others], sourceVideo: layerTracks[0]?.id ?? comp.sourceVideo } : c));
    next = { ...next, comps: [...comps, ...exploded.nested.map((c) => ({ ...c, folderId: comp.folderId }))] };
    split.push({ id: comp.id, name: comp.name, layers: layerClips.length });
  }
  return { project: next, split, skipped };
}
