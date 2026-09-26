// Shorts from a long video: the moments picked from the transcript become their own comps, one
// per short, in a "Shorts" folder — cut from the source, reframed for the chosen screen (9:16 or
// 16:9) so the speaker stays in shot, given a hook title, punch-ins and captions, and named with
// their rating ("Short 1 _ 8.4★") so the best one is first. Everything after that (motion
// graphics, sound, music, frame QA) is the normal edit, done on each short's comp.
//
// The model does the judging — it has read the transcript and looked at the frames — and hands
// over each short as source-time segments with a score. This file turns that into comps, as pure
// functions over plain data so every rule here is testable without a running editor.
import { uid } from './editor';
import { buildWatchfiwnCues, generateProjectSubtitles, wordsOnTimeline } from './subtitlesEngine';
import type { TranscriptWord } from './ipc';
import { newClip, newComp, placeClips, textSource, tracksOf } from './timeline';
import type { Asset, Clip, Comp, Keyframe } from './types';

export type ShortOrientation = 'portrait' | 'landscape';

export const SHORT_FRAMES: Record<ShortOrientation, { width: number; height: number; label: string }> = {
  portrait: { width: 1080, height: 1920, label: 'Portrait 9:16 (Reels, Shorts, TikTok)' },
  landscape: { width: 1920, height: 1080, label: 'Landscape 16:9 (YouTube, X, LinkedIn)' },
};

/** The two answers the format question offers, in order. */
export const SHORT_FORMAT_OPTIONS = [SHORT_FRAMES.portrait.label, SHORT_FRAMES.landscape.label];

/** Reads an answer (a button label or anything the user typed) as an orientation. */
export function orientationFromAnswer(answer: string): ShortOrientation | null {
  const text = answer.toLowerCase();
  if (/portrait|vertical|9\s*[:x/]\s*16|reels?\b|tiktok|shorts?\b|stor(y|ies)/.test(text)) return 'portrait';
  if (/landscape|horizontal|wide|16\s*[:x/]\s*9|youtube/.test(text)) return 'landscape';
  return null;
}

/**
 * Whether the user's own request already names the screen. Stricter than reading an answer:
 * "make shorts" or "reels" alone is the request, not a choice of frame, so it still asks.
 */
export function orientationStated(message: string): ShortOrientation | null {
  const text = message.toLowerCase();
  const portrait = /\b(portrait|vertical)\b|\b9\s*[:x/]\s*16\b/.test(text);
  const landscape = /\b(landscape|horizontal)\b|\b16\s*[:x/]\s*9\b/.test(text);
  return portrait === landscape ? null : portrait ? 'portrait' : 'landscape';
}

/** Where the model tells us a short comes from and why it is worth making. */
export type ShortSpec = {
  title: string;
  /** 0–10: how strong a short this is (hook, standalone sense, payoff, shareability). */
  score: number;
  /** Source-time ranges, in the order they play. Several ranges cut out the waffle between. */
  segments: { start: number; end: number }[];
  /** On-screen hook for the first seconds. */
  hook?: string;
  reason?: string;
  /** Where the subject sits in the source picture (0..1), when no face track is available. */
  focus?: { x: number; y: number };
};

/** Stored on each short's comp: its plan, so later turns know what it is and edit it as planned. */
export type ShortInfo = {
  rank: number;
  score: number;
  title: string;
  hook: string | null;
  reason: string | null;
  orientation: ShortOrientation;
  assetId: string;
  segments: { start: number; end: number }[];
  createdAt: number;
};

/** A face seen in the source over time: centres in 0..1 of the source picture, `t` source seconds. */
export type FaceSample = { t: number; x: number; y: number; width: number; height: number };
export type FaceTrackLike = { id: number; frames: FaceSample[] };

export const MIN_SHORT_SECONDS = 5;
export const MAX_SHORT_SECONDS = 180;
export const MAX_SHORTS = 12;

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** "Short 1 _ 8.4★" — rank first so the Project panel lists the best one on top. */
export const shortName = (rank: number, score: number) => `Short ${rank} _ ${clamp(score, 0, 10).toFixed(1)}★`;

/**
 * Cleans a short's ranges: inside the source, in play order, overlaps merged, each range eased
 * out to the word it cuts into so no word is clipped. Returns why the short is unusable instead.
 */
export function normalizeSegments(
  segments: { start: number; end: number }[],
  sourceDuration: number,
  words: TranscriptWord[] = [],
): { segments: { start: number; end: number }[] } | { error: string } {
  const usable = segments
    .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({ start: clamp(s.start, 0, sourceDuration), end: clamp(s.end, 0, sourceDuration) }))
    .filter((s) => s.end - s.start >= 0.3);
  if (!usable.length) return { error: 'no usable segment (each needs start < end inside the source, in seconds)' };
  // Never cut a word in half: a boundary inside a word moves to that word's edge, with a breath.
  const sorted = [...words].filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start).sort((a, b) => a.start - b.start);
  const eased = usable.map((s) => {
    let { start, end } = s;
    const first = sorted.find((w) => w.end > start + 0.02);
    if (first && first.start < start && start - first.start < 1.2) start = first.start;
    const last = [...sorted].reverse().find((w) => w.start < end - 0.02);
    if (last && last.end > end && last.end - end < 1.2) end = last.end;
    return { start: round(clamp(start - 0.06, 0, sourceDuration)), end: round(clamp(end + 0.12, 0, sourceDuration)) };
  });
  // Merge ranges that overlap or nearly touch, keeping the order they were given.
  const merged: { start: number; end: number }[] = [];
  for (const s of eased) {
    const prev = merged[merged.length - 1];
    if (prev && s.start <= prev.end + 0.05 && s.start >= prev.start) prev.end = Math.max(prev.end, s.end);
    else merged.push({ ...s });
  }
  const total = merged.reduce((sum, s) => sum + s.end - s.start, 0);
  if (total < MIN_SHORT_SECONDS) return { error: `only ${total.toFixed(1)} s long — a short needs at least ${MIN_SHORT_SECONDS} s` };
  if (total > MAX_SHORT_SECONDS) return { error: `${total.toFixed(1)} s long — keep a short under ${MAX_SHORT_SECONDS} s` };
  return { segments: merged };
}

/**
 * The subject's position through a source range: the face that is on screen most (by size and
 * time) inside it, as centre samples. Empty when no face was seen there.
 */
export function subjectPath(tracks: FaceTrackLike[], start: number, end: number): { t: number; x: number; y: number }[] {
  let best: { weight: number; frames: FaceSample[] } | null = null;
  for (const track of tracks) {
    const frames = track.frames.filter((f) => f.t >= start - 0.05 && f.t <= end + 0.05);
    const weight = frames.reduce((sum, f) => sum + f.width * f.height, 0);
    if (frames.length && (!best || weight > best.weight)) best = { weight, frames };
  }
  if (!best) return [];
  // Eyes sit a little above the box centre; framing on them reads as "on the face".
  return best.frames.map((f) => ({ t: f.t, x: f.x + f.width / 2, y: f.y + f.height * 0.42 })).sort((a, b) => a.t - b.t);
}

/** Median of a list (the middle value is steadier than the mean against a stray detection). */
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The picture's size as fractions of the frame with `fit: 'fill'` at `scale` percent. */
export function fillSize(sourceW: number, sourceH: number, frameW: number, frameH: number, scale = 100) {
  const k = Math.max(frameW / sourceW, frameH / sourceH) * (scale / 100);
  return { pw: (sourceW * k) / frameW, ph: (sourceH * k) / frameH };
}

/**
 * The clip offset (transform x/y, fractions of the frame) that puts source point (fx, fy) at frame
 * point (tx, ty), without ever pulling a picture edge into the frame.
 */
export function offsetFor(pw: number, ph: number, fx: number, fy: number, tx = 0.5, ty = 0.5) {
  const x = clamp(tx - 0.5 - (fx - 0.5) * pw, -(pw - 1) / 2, (pw - 1) / 2);
  const y = clamp(ty - 0.5 - (fy - 0.5) * ph, -(ph - 1) / 2, (ph - 1) / 2);
  return { x: round(x, 4), y: round(y, 4) };
}

type BuildInput = {
  asset: Asset;
  spec: ShortSpec;
  rank: number;
  orientation: ShortOrientation;
  fps: number;
  words: TranscriptWord[];
  faces: FaceTrackLike[];
  captionStyle: string | null;
  captions: boolean;
  folderId: string | null;
};

/**
 * One short as a comp: the segments back to back on V1/A1, reframed, alternately punched in with a
 * slow push, a hook title over the opening and captions from the transcript.
 */
export function buildShortComp(input: BuildInput): { comp: Comp; notes: string[] } {
  const { asset, spec, rank, orientation, fps } = input;
  const frame = SHORT_FRAMES[orientation];
  const notes: string[] = [];
  let comp = newComp({ name: shortName(rank, spec.score), width: frame.width, height: frame.height, fps });
  comp = { ...comp, folderId: input.folderId };
  const video = tracksOf(comp, 'video');
  const audio = tracksOf(comp, 'audio');
  const sourceW = asset.width > 0 ? asset.width : frame.width;
  const sourceH = asset.height > 0 ? asset.height : frame.height;
  const sourcePortrait = sourceH > sourceW;
  // A wide frame from tall footage would crop away most of the picture: fit it and fill behind.
  const fitInstead = orientation === 'landscape' && sourcePortrait;
  const portraitFrame = orientation === 'portrait';
  // Where the face should land: the upper-middle of a tall frame (captions own the lower third),
  // slightly above centre in a wide one.
  const target = portraitFrame ? { x: 0.5, y: 0.4 } : { x: 0.5, y: 0.45 };

  const clips: Clip[] = [];
  let cursor = 0;
  let followed = 0;
  spec.segments.forEach((segment, index) => {
    const duration = round(segment.end - segment.start);
    const linkId = asset.hasAudio && asset.kind === 'video' ? uid() : null;
    const punched = index % 2 === 1;
    const base = fitInstead ? 100 : punched ? 112 : 100;
    const push = fitInstead ? 0 : 4;
    const { pw, ph } = fitInstead ? { pw: 1, ph: 1 } : fillSize(sourceW, sourceH, frame.width, frame.height, base);
    const path = subjectPath(input.faces, segment.start, segment.end);
    const fallback = spec.focus ?? { x: 0.5, y: 0.4 };
    const centre = path.length ? { x: median(path.map((p) => p.x)), y: median(path.map((p) => p.y)) } : fallback;
    const rest = fitInstead ? { x: 0, y: 0 } : offsetFor(pw, ph, centre.x, centre.y, target.x, target.y);
    const keyframes = { x: [] as Keyframe[], y: [] as Keyframe[], scale: [] as Keyframe[], rotation: [] as Keyframe[], opacity: [] as Keyframe[], volume: [] as Keyframe[] };
    if (push) keyframes.scale = [{ time: 0, value: base, easing: 'ease-in-out' }, { time: duration, value: base + push, easing: 'ease-in-out' }];
    // Follow a subject that moves across the frame: a keyed pan through smoothed positions.
    const spread = path.length ? Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x)) : 0;
    if (!fitInstead && path.length >= 3 && spread > 0.08) {
      const step = Math.max(1, duration / 8);
      const keys: Keyframe[] = [];
      for (let t = 0; t <= duration + 1e-6; t += step) {
        const around = path.filter((p) => Math.abs(p.t - (segment.start + t)) <= step);
        const x = around.length ? median(around.map((p) => p.x)) : centre.x;
        keys.push({ time: round(Math.min(t, duration)), value: offsetFor(pw, ph, x, centre.y, target.x, target.y).x, easing: 'ease-in-out' });
      }
      if (keys.length >= 2) { keyframes.x = keys; followed++; }
    }
    const transform = { fit: (fitInstead ? 'fit' : 'fill') as 'fit' | 'fill', x: rest.x, y: rest.y, scale: base, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 };
    const name = `${spec.title} · part ${index + 1}`;
    if (asset.kind === 'video' || asset.kind === 'image') {
      clips.push(newClip({ trackId: video[0].id, start: round(cursor), duration, in: segment.start, source: { type: 'media', assetId: asset.id }, linkId, transform, keyframes, name }));
    }
    if (asset.hasAudio) {
      clips.push(newClip({ trackId: audio[0].id, start: round(cursor), duration, in: segment.start, source: { type: 'media', assetId: asset.id }, linkId, name, audioType: 'dialogue' }));
    }
    cursor += duration;
  });
  comp = placeClips(comp, clips, 'overwrite');
  const length = round(cursor);
  if (followed) notes.push(`follows the speaker in ${followed} part${followed === 1 ? '' : 's'}`);
  if (fitInstead) notes.push('tall footage fitted into the wide frame');

  // The hook: big type over the first seconds, in the upper band where nothing else sits.
  const hook = (spec.hook ?? '').trim();
  if (hook) {
    const hookClip = newClip({
      trackId: video[2].id,
      start: 0,
      duration: round(Math.min(3, Math.max(1.5, length * 0.25))),
      source: textSource('kinetic', { text: hook }),
      name: 'Hook',
    });
    hookClip.transform = { ...hookClip.transform, y: portraitFrame ? -0.3 : -0.32 };
    comp = placeClips(comp, [hookClip], 'overwrite');
  }

  // Captions: the transcript's words as they fall in this cut.
  if (input.captions && input.words.length) {
    const words = wordsOnTimeline(comp, new Map([[asset.id, asset]]), new Map([[asset.id, input.words]]));
    const cues = buildWatchfiwnCues(words);
    if (cues.length) {
      comp = generateProjectSubtitles(comp, { styleId: input.captionStyle, customCues: cues }).comp;
      notes.push(`${cues.length} captions`);
    }
  } else if (input.captions) notes.push('no transcript, so no captions');

  // Each join is a marker, so the edit points are easy to find.
  comp = {
    ...comp,
    markers: spec.segments.slice(1).map((_, i) => ({
      id: uid(),
      time: round(spec.segments.slice(0, i + 1).reduce((sum, s) => sum + s.end - s.start, 0)),
      name: `Cut ${i + 1}`,
      color: '#35C0FF',
    })),
    short: {
      rank,
      score: round(clamp(spec.score, 0, 10), 1),
      title: spec.title,
      hook: hook || null,
      reason: spec.reason?.trim() || null,
      orientation,
      assetId: asset.id,
      segments: spec.segments,
      createdAt: Date.now(),
    },
  };
  return { comp, notes };
}
