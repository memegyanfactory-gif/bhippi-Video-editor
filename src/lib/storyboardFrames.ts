// Pictures for storyboard cards.
//
// A card shows one of two things. For footage that is already cut (a footage storyboard, or a
// blueprint scene whose shot is on the timeline) the honest picture is the edit itself: a frame
// rendered from the timeline at the scene's middle — instant, no GPU. For a scene that exists only
// on paper, a concept frame from the local image model, prompted from the scene, the plan's style
// and the brand kit, at the comp's own aspect, with one seed per comp so the frames look like one
// video.
//
// Frames are made one at a time through a queue (the image model would otherwise be asked for a
// dozen images at once), and each finished frame is written into the *current* project for that
// one scene — the old viewer wrote back a copy of the whole scene list taken when the button was
// pressed, so every frame that finished overwrote the ones before it.

import { useSyncExternalStore } from 'react';
import { brandedPrompt, type BrandKit } from './brandKit';
import { api, errorText } from './ipc';
import { jobsStore } from './jobsStore';
import { clipEnd, tracksOf } from './timeline';
import type { Asset, Comp, Project } from './types';
import { renderHtmlStill } from './htmlFrames';
import { renderMotionStill } from '../motion/exportFrames';

/** What a card is about, in either storyboard shape. */
export type CardScene = { start: number; end: number; title?: string; intent: string; visual: string; prompt?: string; thumbnail?: string };

/** The comp's scenes, from its blueprint (from scratch) or its storyboard (footage). */
export function cardScenes(comp: Comp): { source: 'blueprint' | 'storyboard'; scenes: CardScene[] } {
  const blueprint = comp.videoBlueprint?.scenes ?? [];
  if (blueprint.length) {
    return {
      source: 'blueprint',
      scenes: blueprint.map((scene) => ({ start: scene.start, end: scene.end, title: scene.title, intent: scene.narration, visual: scene.visual, prompt: scene.visualPrompt, thumbnail: scene.thumbnail })),
    };
  }
  return { source: 'storyboard', scenes: (comp.storyboard ?? []).map((scene) => ({ start: scene.start, end: scene.end, title: scene.title, intent: scene.intent, visual: scene.visual, thumbnail: scene.thumbnail })) };
}

/** SDXL's native sizes (about one megapixel, multiples of 64), nearest the comp's aspect. */
const SDXL_SIZES: [number, number][] = [[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344], [1536, 640], [640, 1536]];
export function frameSize(comp: Pick<Comp, 'width' | 'height'>): { width: number; height: number } {
  const aspect = comp.width / Math.max(1, comp.height);
  const [width, height] = SDXL_SIZES.reduce((best, size) => (Math.abs(Math.log(size[0] / size[1] / aspect)) < Math.abs(Math.log(best[0] / best[1] / aspect)) ? size : best));
  return { width, height };
}

/** One seed per comp, so every concept frame of a video shares its look. */
export function styleSeed(compId: string): number {
  let hash = 2166136261;
  for (const char of compId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2147483647;
}

const NEGATIVE = 'text, words, letters, captions, subtitles, watermark, logo, signature, UI, frame border, split screen, collage, blurry, low quality, deformed hands, extra fingers, distorted face';

/** The prompt for a scene's concept frame. */
export function conceptPrompt(scene: CardScene, comp: Comp, kit: BrandKit | null): { prompt: string; negative: string } {
  const style = comp.videoBlueprint?.style;
  const shape = comp.height > comp.width ? 'vertical 9:16 composition' : comp.width === comp.height ? 'square composition' : 'widescreen composition';
  const look = [
    style?.lighting && `${style.lighting} lighting`,
    style?.palette?.length && `colour palette ${style.palette.slice(0, 4).join(', ')}`,
  ].filter(Boolean).join(', ');
  const subject = (scene.prompt || scene.visual || scene.intent).trim();
  const base = `cinematic storyboard still, ${shape}, ${subject}${look ? `, ${look}` : ''}, consistent art direction, film still, detailed`;
  return kit ? brandedPrompt(kit, base, NEGATIVE, 'image') : { prompt: base, negative: NEGATIVE };
}

/** Whether the timeline has picture at `time` — then the card shows the edit, not a concept. */
export function hasPictureAt(comp: Comp, time: number): boolean {
  const video = new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));
  return comp.clips.some((clip) => clip.enabled && video.has(clip.trackId) && clip.source.type !== 'sfx' && time >= clip.start && time < clipEnd(clip));
}

/** The moment a card shows: the middle of its scene. */
export const cardTime = (scene: Pick<CardScene, 'start' | 'end'>) => scene.start + Math.max(0, scene.end - scene.start) / 2;

/** `project` with one scene's picture set — the blueprint's scene or the storyboard's, whichever the comp uses. */
export function withCardThumbnail(project: Project, compId: string, index: number, path: string): Project {
  return {
    ...project,
    comps: project.comps.map((comp) => {
      if (comp.id !== compId) return comp;
      if (comp.videoBlueprint?.scenes?.length) {
        return { ...comp, videoBlueprint: { ...comp.videoBlueprint, scenes: comp.videoBlueprint.scenes.map((scene, i) => (i === index ? { ...scene, thumbnail: path } : scene)) } };
      }
      return { ...comp, storyboard: (comp.storyboard ?? []).map((scene, i) => (i === index ? { ...scene, thumbnail: path } : scene)) };
    }),
  };
}

/**
 * `project` with one scene's hand-made picture: the PNG as its thumbnail and, for a sketch, the
 * vector document that stays editable (`sketch: null` drops it, e.g. when a photo replaces it).
 */
export function withCardPicture(project: Project, compId: string, index: number, patch: { thumbnail: string; sketch?: unknown }): Project {
  const apply = <T extends object>(scene: T): T => {
    const next: Record<string, unknown> = { ...scene, thumbnail: patch.thumbnail };
    if (patch.sketch === null) delete next.sketch;
    else if (patch.sketch !== undefined) next.sketch = patch.sketch;
    return next as T;
  };
  return {
    ...project,
    comps: project.comps.map((comp) => {
      if (comp.id !== compId) return comp;
      if (comp.videoBlueprint?.scenes?.length) {
        return { ...comp, videoBlueprint: { ...comp.videoBlueprint, scenes: comp.videoBlueprint.scenes.map((scene, i) => (i === index ? apply(scene) : scene)) } };
      }
      return { ...comp, storyboard: (comp.storyboard ?? []).map((scene, i) => (i === index ? apply(scene) : scene)) };
    }),
  };
}

// ── the queue ───────────────────────────────────────────────────────────────

export type FrameKind = 'edit' | 'concept';
export type CardState = { status: 'queued' | 'working'; kind: FrameKind; progress: number } | { status: 'error'; kind: FrameKind; error: string };

/** What the queue needs from the app. */
export type FrameHost = {
  project: () => Project;
  commit: (change: (current: Project) => Project, label: string) => void;
  /** Where rendered edit frames are written (the app's thumbnails folder). */
  framePath: (name: string) => string;
  kit: () => BrandKit | null;
  /** The project's media, for drawing motion scenes into edit frames (without it they are left out). */
  assets?: () => Asset[];
};

type Task = { key: string; compId: string; index: number; kind: FrameKind; host: FrameHost };

const states = new Map<string, CardState>();
const queue: Task[] = [];
let running = false;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((listener) => listener());
};
const keyOf = (compId: string, index: number) => `${compId}:${index}`;

/** Waits for a background job to finish, reporting its progress. */
function awaitJob(id: string, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const job = jobsStore.get(id);
      if (!job) return false;
      onProgress(job.progress);
      if (job.status === 'done') {
        const path = (job.result as { path?: string } | null)?.path;
        if (path) resolve(path);
        else reject(new Error('the image model finished without an image'));
        return true;
      }
      if (job.status === 'error' || job.status === 'cancelled') {
        reject(new Error(job.message || `the image job was ${job.status}`));
        return true;
      }
      return false;
    };
    if (check()) return;
    const stop = jobsStore.subscribe(() => { if (check()) stop(); });
  });
}

async function runTask(task: Task) {
  const project = task.host.project();
  const comp = project.comps.find((entry) => entry.id === task.compId);
  const scene = comp ? cardScenes(comp).scenes[task.index] : undefined;
  if (!comp || !scene) throw new Error('that scene is no longer in the plan');
  let path: string;
  if (task.kind === 'edit') {
    const output = task.host.framePath(`storyboard-${comp.id}-${task.index}-${Date.now().toString(36)}.png`);
    const at = cardTime(scene);
    // The export draws motion scenes and HTML graphics from frames rendered here; a card is one of them.
    const assets = task.host.assets?.();
    const prepared = assets ? await renderHtmlStill(await renderMotionStill(project, comp.id, [at], assets), comp.id, [at]) : project;
    path = await api.exportFrame(prepared, comp.id, at, output, 540);
  } else {
    const { width, height } = frameSize(comp);
    const { prompt, negative } = conceptPrompt(scene, comp, task.host.kit());
    const job = await api.localMediaGenerate({ task: 'image', prompt, negative_prompt: negative, width, height, steps: 24, guidance_scale: 6, seed: styleSeed(comp.id) });
    path = await awaitJob(job, (fraction) => {
      states.set(task.key, { status: 'working', kind: task.kind, progress: fraction });
      changed();
    });
  }
  task.host.commit((current) => withCardThumbnail(current, task.compId, task.index, path), `Storyboard frame · scene ${task.index + 1}`);
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const task = queue.shift()!;
      states.set(task.key, { status: 'working', kind: task.kind, progress: 0 });
      changed();
      try {
        await runTask(task);
        states.delete(task.key);
      } catch (error) {
        states.set(task.key, { status: 'error', kind: task.kind, error: errorText(error) });
      }
      changed();
    }
  } finally {
    running = false;
  }
}

/** Queues pictures for the given cards (all of them when `indices` is omitted). */
export function requestCardFrames(host: FrameHost, compId: string, kind: FrameKind | 'auto', indices?: number[]) {
  const comp = host.project().comps.find((entry) => entry.id === compId);
  if (!comp) return;
  const scenes = cardScenes(comp).scenes;
  for (const index of indices ?? scenes.map((_, i) => i)) {
    const scene = scenes[index];
    if (!scene) continue;
    const key = keyOf(compId, index);
    const state = states.get(key);
    if (state && state.status !== 'error') continue; // already queued or working
    const chosen: FrameKind = kind === 'auto' ? (hasPictureAt(comp, cardTime(scene)) ? 'edit' : 'concept') : kind;
    states.set(key, { status: 'queued', kind: chosen, progress: 0 });
    queue.push({ key, compId, index, kind: chosen, host });
  }
  changed();
  void drain();
}

/**
 * Pictures for every card that has none, as the AI saves a plan: frames from the edit always, and
 * concept frames only when `concepts` allows (they occupy the GPU).
 */
export function fillMissingCardFrames(host: FrameHost, compId: string, concepts: boolean) {
  const comp = host.project().comps.find((entry) => entry.id === compId);
  if (!comp) return;
  const missing = cardScenes(comp).scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => !scene.thumbnail);
  const edit = missing.filter(({ scene }) => hasPictureAt(comp, cardTime(scene))).map(({ index }) => index);
  const concept = missing.filter(({ scene }) => !hasPictureAt(comp, cardTime(scene))).map(({ index }) => index);
  if (edit.length) requestCardFrames(host, compId, 'edit', edit);
  if (concepts && concept.length) requestCardFrames(host, compId, 'concept', concept);
}

/** A card's queue state right now (undefined when idle). */
export const cardStateOf = (compId: string, index: number): CardState | undefined => states.get(keyOf(compId, index));

/** A card's queue state (undefined when idle), re-rendering when it changes. */
export function useCardStates(compId: string | undefined): (index: number) => CardState | undefined {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return (index) => (compId ? states.get(keyOf(compId, index)) : undefined);
}

/** For tests. */
export function resetCardQueue() {
  queue.length = 0;
  states.clear();
  running = false;
  changed();
}
