// Media warm-up for the Program monitor: everything a clip needs, fetched and decoded a while
// before the playhead reaches it — further ahead than the Compositor's own 1.5 s preroll.
//
// - Video: an element opened and parked on the clip's first frame (lib/mediaPool.ts primeMedia),
//   only where the pool holds none for that file, so the pool's hand-over rules are untouched.
// - Stills: decoded (img.decode) so the <img> the Compositor mounts at the cut paints at once.
// - Roto: the first matte PNGs of the clip (RotoPreview's shared cache).
// - Motion scenes: their videos, stills and matte frames opened on the live renderer's bank
//   (only videos no scene on screen is using); their frames come from lib/previewCache.ts.
// What is ready (or still loading) is reported to the preview cache for the Timeline's bar.
import { primeMedia } from '../lib/mediaPool';
import { fileSrc } from '../lib/ipc';
import { previewCache, sceneTimeAt, type WarmSpan } from '../lib/previewCache';
import { clipEnd, sourceTimeAt, transitionWindow, type AssetMap } from '../lib/timeline';
import type { Clip, Comp } from '../lib/types';
import { canPreview, mediaSrc } from './Compositor';
import { warmMotionScene } from './MotionLayer';
import { prefetchRotoMatte } from './RotoPreview';

/** How far ahead of the playhead media is warmed. */
export const WARM_AHEAD = 10;
/** Motion scenes are opened on the live bank only this close to their cut (it holds few videos). */
const MOTION_AHEAD = 3;

type Warmed = { span: WarmSpan; key: string };
const warmed = new Map<string, Warmed>();

const decoded = new Map<string, Promise<boolean>>();
function decodeImage(url: string): Promise<boolean> {
  let hit = decoded.get(url);
  if (hit) { decoded.delete(url); decoded.set(url, hit); return hit; }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  hit = img.decode().then(() => true, () => false);
  decoded.set(url, hit);
  // The decoded bitmap lives as long as its <img>: keep the most recent few dozen.
  while (decoded.size > 48) decoded.delete(decoded.keys().next().value!);
  return hit;
}

/** When a clip first shows: its start, or earlier when a transition borrows handles before it. */
function appearsAt(comp: Comp, clip: Clip): number {
  let at = clip.start;
  for (const transition of comp.transitions) {
    if (transition.toClip !== clip.id) continue;
    const window = transitionWindow(comp, transition);
    if (window) at = Math.min(at, window.start);
  }
  return at;
}

let reportTimer = 0;
function report() {
  if (reportTimer) return;
  reportTimer = window.setTimeout(() => {
    reportTimer = 0;
    previewCache.setWarm([...warmed.values()].map((entry) => entry.span));
  }, 100);
}

/**
 * Warms every clip of `comp` that shows between `time` and `time + WARM_AHEAD`. Cheap to call
 * often: work already started for a clip is not repeated.
 */
export function warmAhead(comp: Comp, assets: AssetMap, time: number, enabled = true) {
  if (!enabled) {
    if (warmed.size) { warmed.clear(); report(); }
    return;
  }
  const hidden = new Set(comp.tracks.filter((track) => track.hidden || track.kind !== 'video').map((track) => track.id));
  const seen = new Set<string>();
  for (const clip of comp.clips) {
    if (!clip.enabled || hidden.has(clip.trackId)) continue;
    const appears = appearsAt(comp, clip);
    const end = clipEnd(clip);
    if (end <= time || appears > time + WARM_AHEAD) continue;
    const source = clip.source;
    if (source.type === 'motion') {
      if (appears > time && appears - time < MOTION_AHEAD) warmMotionScene(source.scene, sceneTimeAt(clip, source.scene.duration, appears), assets);
      continue;
    }
    if (source.type !== 'media') continue;
    const asset = assets.get(source.assetId);
    if (!canPreview(asset) || !asset) continue;
    const from = Math.max(time, appears);
    const sourceTime = Math.max(0, sourceTimeAt(clip, from));
    const matte = asset.kind === 'video' && !clip.name?.toLowerCase().includes('background') ? clip.rotoMatte ?? null : null;
    const key = `${asset.kind === 'image' ? fileSrc(asset.path) : mediaSrc(asset)}|${matte ?? ''}|${appears > time ? sourceTime.toFixed(2) : 'live'}`;
    seen.add(clip.id);
    const known = warmed.get(clip.id);
    if (known?.key === key) { known.span.start = appears; known.span.end = end; continue; }
    const entry: Warmed = { key, span: { start: appears, end, ready: false } };
    warmed.set(clip.id, entry);
    const jobs: Promise<boolean>[] = [];
    if (asset.kind === 'image') jobs.push(decodeImage(fileSrc(asset.path)));
    else {
      // A clip already on screen has its own element; one that is coming gets one parked.
      if (appears > time) jobs.push(primeMedia('video', mediaSrc(asset), sourceTime));
      if (matte) jobs.push(prefetchRotoMatte(matte, sourceTime, 20));
    }
    void Promise.all(jobs).then(() => {
      // Ready once tried: a file that cannot load is the Compositor's to report, not the bar's.
      if (warmed.get(clip.id) === entry) { entry.span.ready = true; report(); }
    });
  }
  for (const id of [...warmed.keys()]) if (!seen.has(id)) warmed.delete(id);
  report();
}
