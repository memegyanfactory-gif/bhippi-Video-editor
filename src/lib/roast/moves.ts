// The comedy moves (docs/FUNNY-MODE-PLAN.md §3.5): each roast EDL event turned into timeline
// clips, keyframes and automation with the defaults measured from the two reference videos.
//
// Every move is a pure function over the comp, built from the same primitives the editor's tools
// use (placeClips, textSource, keyframes, addTransition, textBehindSubject, motion templates, the
// SFX and card builders) — never by calling a tool. What a move makes is recorded so the plan can
// be applied again without doubling anything:
//   - every clip it creates is named `roast:<eventId> <label>` and listed in `clipIds`;
//   - keyframes it writes on clips it did not make (the host's zoom, shake, whip, ducks) are
//     listed with their times, and a whip's transition by id.
// Clips go on named lanes above the host, bottom to top: Roast Grade, Memes BG, Memes, Roast
// Cards, Roast Text, Roast FX (and Roast BG below the host); sound on SFX, Music and Memes.

import { findStyle } from '../captionStyles';
import { textBehindSubject } from '../behindSubject';
import { clamp, dbToGain, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, uid } from '../editor';
import { insertTrackBelow } from '../fillBackground';
import { EMPTY_KEYFRAMES, shiftKeys, valueAt } from '../keyframes';
import { addTracks, addTransition, clipEnd, MIN_DURATION, newClip, placeClips, removeClips, sourceInfo, sourceTimeAt, textSource, tracksOf, updateTrack, type AssetMap } from '../timeline';
import type { Asset, Clip, ClipSource, Comp, Keyframe, KeyframedProperty, Project, Track } from '../types';
import { findTemplate } from '../../motion/kit';
import type { MotionScene } from '../../motion/types';
import { validateScene } from '../../motion/validate';
import { buildRoastCard } from './cards';
import { hostTrackOf, ROAST_PREFIX, ROAST_TRACK, roastIdOf } from './dna';
import { sfxClip, type SfxClipOptions } from './sfx';
import { CARD_TEMPLATES, FX_TEMPLATES, ROAST_TEXT_STYLES, type AppliedEvent, type CardTemplateId, type Fit, type MovePayload, type RoastEvent, type RoastMoveKind, type SfxCue } from './types';

// ─── Per-move facts ───────────────────────────────────────────────────────────────────────────

export type MoveSpec = {
  /** Seconds on screen when the plan gives none. */
  seconds: number;
  /** Outside these the validator warns (the reference videos' range for the move). */
  bounds: [number, number];
  /** A written reason is required (memes, receipts, cutouts: the Comedian checks relevance). */
  needsWhy?: boolean;
  /** Replaces the whole picture; two of these may not overlap. */
  fullFrame?: boolean;
};

export const MOVE_SPECS: Record<RoastMoveKind, MoveSpec> = {
  meme_cutaway: { seconds: 2, bounds: [0.6, 4], needsWhy: true, fullFrame: true },
  receipt: { seconds: 6, bounds: [1, 60], needsWhy: true, fullFrame: true },
  side_cutout: { seconds: 3, bounds: [0.8, 8], needsWhy: true },
  host_on_bg: { seconds: 3, bounds: [0.5, 30] },
  keyword_pop: { seconds: 1.4, bounds: [0.4, 4] },
  emoji_pop: { seconds: 1.2, bounds: [0.3, 3] },
  sticker: { seconds: 2.5, bounds: [0.5, 6] },
  overlay_fx: { seconds: 3, bounds: [0.5, 10] },
  card: { seconds: 4, bounds: [1, 10] },
  title_card: { seconds: 3, bounds: [1, 6], fullFrame: true },
  cta: { seconds: 4, bounds: [1, 8] },
  zoom_punch: { seconds: 1.2, bounds: [0.15, 6] },
  shake: { seconds: 0.2, bounds: [0.05, 1.5] },
  whip: { seconds: 0.15, bounds: [0.05, 1] },
  bw_freeze: { seconds: 2, bounds: [0.3, 6] },
  label: { seconds: 2, bounds: [0.3, 10] },
  head_paste: { seconds: 2, bounds: [0.3, 10] },
  bleep: { seconds: 0.4, bounds: [0.05, 3] },
  music_sting: { seconds: 4, bounds: [0.5, 30] },
  sfx: { seconds: 1, bounds: [0.05, 10] },
};

export const MOVE_KINDS = Object.keys(MOVE_SPECS) as RoastMoveKind[];

/** Whoosh-type sounds lead the entry they mark by a couple of frames. */
const LEAD = -0.08;

/** The sound a move makes when the plan does not say (null: silent). A meme with sound of its own needs none. */
export function defaultSfx(event: RoastEvent, assets: AssetMap): SfxCue | null {
  switch (event.move) {
    case 'meme_cutaway': {
      const asset = assets.get(event.assetId);
      const ownSound = !!asset && asset.kind !== 'image' && asset.hasAudio && event.keepAudio !== false;
      return ownSound ? null : { kind: 'boom' };
    }
    case 'side_cutout': case 'sticker': case 'card': case 'title_card': return { kind: 'swish', offset: LEAD };
    case 'whip': return { kind: 'swish', offset: -0.1 };
    case 'keyword_pop': case 'emoji_pop': return { kind: 'pop' };
    case 'cta': return { kind: 'ding' };
    case 'shake': return { kind: 'impact' };
    case 'bw_freeze': return { kind: 'scratch' };
    case 'bleep': return { kind: 'bleep' };
    default: return null;
  }
}

/** The cue an event plays: its own, its move's default, or none (`sfx: null`). */
export const cueFor = (event: RoastEvent, assets: AssetMap): SfxCue | null => (event.sfx === null ? null : event.sfx ?? defaultSfx(event, assets));

// ─── Working state ────────────────────────────────────────────────────────────────────────────

export type MoveEnv = {
  project: Project;
  assets: AssetMap;
  /** Where the comp ends (roast clips excluded): moves clamp to it. */
  limit: number;
  /** Beat and downbeat times, timeline seconds (music_sting snapping). */
  beats?: number[];
  downbeats?: number[];
};

export type MoveResult = { comp: Comp; applied: AppliedEvent; warnings: string[]; errors: string[] };

type Work = {
  comp: Comp;
  event: RoastEvent;
  env: MoveEnv;
  start: number;
  end: number;
  applied: AppliedEvent;
  warnings: string[];
  errors: string[];
};

const EPS = 1e-6;
const RAMP = 0.01;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const frame = (comp: Comp) => 1 / Math.max(1, comp.fps);

/** `roast:e3 meme` — the executor's clip name. */
export const roastName = (eventId: string, label: string) => `${ROAST_PREFIX}${eventId} ${label}`.trim();

const busy = (comp: Comp, trackId: string, start: number, end: number) => comp.clips.some((clip) => clip.trackId === trackId && clip.start < end - EPS && clipEnd(clip) > start + EPS);

const VIDEO_RANK: Record<string, number> = { [ROAST_TRACK.grade]: 0, [ROAST_TRACK.memesBg]: 1, [ROAST_TRACK.memes]: 2, [ROAST_TRACK.cards]: 3, [ROAST_TRACK.text]: 4, [ROAST_TRACK.fx]: 5 };

function named(comp: Comp, trackId: string, name: string): { comp: Comp; track: Track } {
  const next = updateTrack(comp, trackId, { name });
  return { comp: next, track: next.tracks.find((track) => track.id === trackId) as Track };
}

/**
 * A video lane named `name` free over [start, end): an existing one, else a new track in the
 * roast order above the host (an empty unnamed track right there is taken over rather than
 * adding another). `above` asks for one higher than that track (a matted host copy over text).
 */
export function videoLane(comp: Comp, name: string, start: number, end: number, above?: string): { comp: Comp; track: Track } {
  const video = tracksOf(comp, 'video');
  const aboveIndex = above ? video.findIndex((track) => track.id === above) : -1;
  const same = video.map((track, index) => ({ track, index })).filter(({ track, index }) => track.name.trim() === name && index > aboveIndex);
  const free = same.find(({ track }) => !track.locked && !track.hidden && !busy(comp, track.id, start, end));
  if (free) return { comp, track: free.track };
  let anchorIndex: number;
  if (same.length) anchorIndex = same[same.length - 1].index;
  else if (above && aboveIndex >= 0) anchorIndex = aboveIndex;
  else {
    const host = hostTrackOf(comp);
    const rank = VIDEO_RANK[name] ?? 99;
    anchorIndex = host ? video.findIndex((track) => track.id === host.id) : 0;
    video.forEach((track, index) => {
      const other = VIDEO_RANK[track.name.trim()];
      if (other !== undefined && other < rank && index > anchorIndex) anchorIndex = index;
    });
  }
  anchorIndex = Math.max(0, anchorIndex);
  const nextUp = video[anchorIndex + 1];
  if (nextUp && !nextUp.name.trim() && !nextUp.locked && !nextUp.hidden && !comp.clips.some((clip) => clip.trackId === nextUp.id)) return named(comp, nextUp.id, name);
  const added = addTracks(comp, 'video', 1, video[anchorIndex]?.id);
  return named(added.comp, added.ids[0], name);
}

/** An audio lane named `name` free over [start, end): an existing one, an empty unnamed track past the last used one, or a new track. */
export function audioLane(comp: Comp, name: string, start: number, end: number): { comp: Comp; track: Track } {
  const audio = tracksOf(comp, 'audio');
  const existing = audio.find((track) => track.name.trim().toLowerCase() === name.toLowerCase() && !track.locked && !busy(comp, track.id, start, end));
  if (existing) return { comp, track: existing };
  const lastUsed = audio.reduce((max, track, index) => (comp.clips.some((clip) => clip.trackId === track.id) ? index : max), -1);
  const empty = audio.find((track, index) => index > lastUsed && !track.name.trim() && !track.locked && !comp.clips.some((clip) => clip.trackId === track.id));
  if (empty) return named(comp, empty.id, name);
  const added = addTracks(comp, 'audio', 1);
  return named(added.comp, added.ids[0], name);
}

/** The Roast BG lane: directly under the host clip's track. */
function bgLane(comp: Comp, hostTrackId: string, start: number, end: number): { comp: Comp; track: Track } {
  const video = tracksOf(comp, 'video');
  const below = video[video.findIndex((track) => track.id === hostTrackId) - 1];
  if (below && below.name.trim() === ROAST_TRACK.bg && !below.locked && !busy(comp, below.id, start, end)) return { comp, track: below };
  const inserted = insertTrackBelow(comp, hostTrackId);
  return named(inserted.comp, inserted.trackId, ROAST_TRACK.bg);
}

const isPicture = (clip: Clip) => clip.source.type === 'media' || clip.source.type === 'comp' || clip.source.type === 'item';

/** The host clip on screen at `time` (or `clipId`), allowing a quarter second of slack at a gap. */
export function hostClipAt(comp: Comp, time: number, assets: AssetMap, clipId?: string): Clip | undefined {
  if (clipId) return comp.clips.find((clip) => clip.id === clipId);
  const host = hostTrackOf(comp, assets);
  if (!host) return undefined;
  const clips = comp.clips.filter((clip) => clip.trackId === host.id && clip.enabled && isPicture(clip) && !roastIdOf(clip));
  const inside = clips.find((clip) => clip.start <= time + EPS && clipEnd(clip) > time + EPS);
  if (inside) return inside;
  const near = clips.map((clip) => ({ clip, gap: Math.min(Math.abs(clip.start - time), Math.abs(clipEnd(clip) - time)) })).sort((a, b) => a.gap - b.gap)[0];
  return near && near.gap <= 0.25 ? near.clip : undefined;
}

/** Whether a clip shows only its subject: a roto matte, or a keyer applied. */
export const isMatted = (clip: Clip) => !!clip.rotoMatte || !!clip.appliedEffects?.some((effect) => effect.enabled && ['keylight', 'linear-color-key', 'extract'].includes(effect.effectId));

/**
 * The host's voice under [start, end): audio linked to the host's picture or marked dialogue;
 * failing that, the lowest audio track with speech-like clips (a separately recorded voice).
 */
export function dialogueClips(comp: Comp, start: number, end: number): Clip[] {
  const host = hostTrackOf(comp);
  const hostLinks = new Set(comp.clips.filter((clip) => clip.trackId === host?.id && clip.linkId).map((clip) => clip.linkId));
  const tracks = new Map(comp.tracks.map((track) => [track.id, track]));
  const candidates = comp.clips.filter((clip) => {
    const track = tracks.get(clip.trackId);
    return track?.kind === 'audio' && clip.enabled && !roastIdOf(clip) && clip.source.type !== 'sfx' && clip.audioType !== 'music' && clip.audioType !== 'sfx'
      && !/^(SFX|Music|Memes)\b/i.test(track.name.trim()) && clip.start < end - EPS && clipEnd(clip) > start + EPS;
  });
  const linked = candidates.filter((clip) => (clip.linkId && hostLinks.has(clip.linkId)) || clip.audioType === 'dialogue');
  if (linked.length) return linked;
  const audio = tracksOf(comp, 'audio');
  const lowest = candidates.map((clip) => audio.findIndex((track) => track.id === clip.trackId)).sort((a, b) => a - b)[0];
  return candidates.filter((clip) => audio.findIndex((track) => track.id === clip.trackId) === lowest);
}

// ─── Small builders ───────────────────────────────────────────────────────────────────────────

const clipById = (w: Work, id: string) => w.comp.clips.find((clip) => clip.id === id);

function place(w: Work, clips: Clip[]) {
  w.comp = placeClips(w.comp, clips, 'overwrite');
  for (const clip of clips) if (w.comp.clips.some((item) => item.id === clip.id)) w.applied.clipIds.push(clip.id);
}

function patchClip(w: Work, id: string, change: (clip: Clip) => Clip) {
  w.comp = { ...w.comp, clips: w.comp.clips.map((clip) => (clip.id === id ? change(clip) : clip)) };
}

/**
 * Writes keyframes on a clip: existing keys of `property` inside [from, to] (clip-local) give way.
 * Keys on clips this event did not make are recorded so a re-apply removes exactly them.
 */
function writeKeys(w: Work, clipId: string, property: KeyframedProperty, from: number, to: number, keys: Keyframe[]) {
  const clip = clipById(w, clipId);
  if (!clip) return;
  const written = keys.map((key) => ({ ...key, time: round(clamp(key.time, 0, clip.duration)) }));
  const kept = clip.keyframes[property].filter((key) => key.time < from - EPS || key.time > to + EPS);
  patchClip(w, clipId, (current) => ({ ...current, keyframes: { ...current.keyframes, [property]: [...kept, ...written].sort((a, b) => a.time - b.time) } }));
  if (w.applied.clipIds.includes(clipId)) return;
  const keysOut = (w.applied.keys ??= []);
  const entry = keysOut.find((item) => item.clipId === clipId && item.property === property);
  const times = written.map((key) => key.time);
  if (entry) entry.times = [...new Set([...entry.times, ...times])];
  else keysOut.push({ clipId, property, times });
}

/** Volume automation: gain × `gain` over [start, end] (timeline) with 10 ms ramps either side. */
function duck(w: Work, clip: Clip, start: number, end: number, gain: number) {
  const current = clipById(w, clip.id) ?? clip;
  const base = (local: number) => valueAt(current.keyframes.volume, local) ?? current.volume;
  const a = start - current.start;
  const b = end - current.start;
  const keys: Keyframe[] = [];
  if (a - RAMP > EPS) keys.push({ time: a - RAMP, value: base(a - RAMP), easing: 'linear' });
  keys.push({ time: Math.max(0, a), value: base(Math.max(0, a)) * gain, easing: 'linear' });
  keys.push({ time: Math.min(current.duration, b), value: base(Math.min(current.duration, b)) * gain, easing: 'linear' });
  if (b + RAMP < current.duration - EPS) keys.push({ time: b + RAMP, value: base(b + RAMP), easing: 'linear' });
  writeKeys(w, current.id, 'volume', Math.max(0, a - RAMP), Math.min(current.duration, b + RAMP), keys);
}

function duckDialogue(w: Work, start: number, end: number, gain: number): number {
  const clips = dialogueClips(w.comp, start, end);
  for (const clip of clips) duck(w, clip, start, end, gain);
  return clips.length;
}

/** A caption-preset text clip in a catalogue style (keyword pops, labels, captions). */
function textClip(trackId: string, start: number, duration: number, text: string, style: string | null, name: string, color?: string): Clip {
  return newClip({ trackId, start, duration, source: textSource('caption', { text, style, color }), name });
}

/** Where a caption style anchors its text (percent from the top); transform y shifts from it. */
const anchorY = (style: string | null) => (findStyle(style)?.posY ?? 91) / 100;

/** Scale 0 → overshoot → rest over `seconds` (the pop entrance), in absolute percent. */
const popKeys = (rest: number, seconds = 0.12): Keyframe[] => [
  { time: 0, value: 0, easing: 'ease-out' },
  { time: seconds / 2, value: rest * 1.08, easing: 'ease-in-out' },
  { time: seconds, value: rest, easing: 'linear' },
];

function placeSfx(w: Work, cue: SfxCue, at: number, options: SfxClipOptions = {}): string | null {
  const asset = cue.assetId ? w.env.assets.get(cue.assetId) : undefined;
  if (cue.assetId && !asset) {
    w.errors.push(`sound asset ${cue.assetId} is not in the project`);
    return null;
  }
  try {
    // `at` already includes the cue's offset.
    const placed = sfxClip(w.comp, { ...cue, offset: 0 }, Math.max(0, at), asset, options);
    w.comp = placed.comp;
    const clip = clipById(w, placed.clipId);
    if (!clip) return null;
    patchClip(w, clip.id, (current) => ({ ...current, name: roastName(w.event.id, current.name ?? 'sfx') }));
    w.applied.clipIds.push(clip.id);
    return clip.id;
  } catch (error) {
    w.errors.push(`the sound could not be placed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** A picture's box when fitted into the frame at `scale` percent, in frame pixels. */
function fittedSize(comp: Comp, width: number, height: number, scale: number) {
  const fit = Math.min(comp.width / Math.max(2, width), comp.height / Math.max(2, height)) * (scale / 100);
  return { width: width * fit, height: height * fit, fit };
}

/** Whether a source's shape is far enough from the frame's that filling would crop it badly. */
const mismatched = (comp: Comp, width: number, height: number) => {
  const source = width / Math.max(1, height);
  const target = comp.width / Math.max(1, comp.height);
  return source < target * 0.8 || source > target * 1.25;
};

type HtmlSource = Extract<ClipSource, { type: 'html' }>;

/** The html payload of a card, whichever shape the card builder hands back. */
function htmlSource(value: unknown): HtmlSource | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'html' && typeof record.html === 'string') return record as HtmlSource;
  const inner = record.source as Record<string, unknown> | undefined;
  if (inner && inner.type === 'html' && typeof inner.html === 'string') return { ...(inner as HtmlSource), ...(record.box ? { box: record.box as HtmlSource['box'] } : {}) };
  if (typeof record.html === 'string') return { type: 'html', html: record.html, css: record.css as string | undefined, js: record.js as string | undefined, title: record.title as string | undefined, template: record.template as string | undefined, box: record.box as HtmlSource['box'] };
  return null;
}

// ─── The moves ────────────────────────────────────────────────────────────────────────────────

type Cutaway = Extract<MovePayload, { move: 'meme_cutaway' | 'receipt' }>;

/** A full-frame insert on the Memes lanes: filled, fitted over black, or over its own blurred copy. */
function placeCutaway(w: Work, payload: Cutaway, label: string): { fg: Clip; asset: Asset } | null {
  const asset = w.env.assets.get(payload.assetId);
  if (!asset) {
    w.errors.push(`asset ${payload.assetId} is not in the project`);
    return null;
  }
  if (asset.kind === 'audio') {
    w.errors.push(`${asset.name} is audio only; a cutaway needs a picture`);
    return null;
  }
  const source: ClipSource = { type: 'media', assetId: asset.id };
  const inPoint = Math.max(0, payload.in ?? 0);
  if (asset.kind === 'video') {
    const available = asset.duration - inPoint;
    if (available < MIN_DURATION) {
      w.errors.push(`in ${inPoint}s is past the end of ${asset.name} (${asset.duration.toFixed(2)} s)`);
      return null;
    }
    if (w.end - w.start > available + EPS) {
      w.warnings.push(`${asset.name} has only ${available.toFixed(2)} s after ${inPoint}s; shortened to that`);
      w.end = w.start + available;
    }
  }
  const { width, height } = sourceInfo(w.env.project, w.env.assets, source);
  const fit: Fit = payload.fit ?? (mismatched(w.comp, width, height) ? 'blur-fill' : 'fill');
  const duration = w.end - w.start;
  const linkId = uid();
  if (fit !== 'fill') {
    const lane = videoLane(w.comp, ROAST_TRACK.memesBg, w.start, w.end);
    w.comp = lane.comp;
    const backdrop = fit === 'blur-fill'
      // The same moment, filling the frame, blurred and darkened (fill_background's recipe).
      ? newClip({ trackId: lane.track.id, start: w.start, duration, in: inPoint, source, transform: { ...DEFAULT_TRANSFORM, fit: 'fill' }, effects: { ...DEFAULT_EFFECTS, blur: 36, brightness: -28 }, volume: 0, name: roastName(w.event.id, `${label} backdrop`) })
      : newClip({ trackId: lane.track.id, start: w.start, duration, source: { type: 'shape', shape: 'rectangle', sides: 4, fill: '#000000', stroke: null, strokeWidth: 0, width: w.comp.width, height: w.comp.height, cornerRadius: 0 }, name: roastName(w.event.id, `${label} black`) });
    place(w, [backdrop]);
  }
  const lane = videoLane(w.comp, ROAST_TRACK.memes, w.start, w.end);
  w.comp = lane.comp;
  const fg = newClip({ trackId: lane.track.id, start: w.start, duration, in: inPoint, source, transform: { ...DEFAULT_TRANSFORM, fit: fit === 'fill' ? 'fill' : 'fit' }, name: roastName(w.event.id, `${label} · ${asset.name}`), label: 'rose' });
  const keepAudio = payload.move === 'receipt' || payload.keepAudio !== false;
  const clips = [fg];
  if (keepAudio && asset.kind === 'video' && asset.hasAudio) {
    const audio = audioLane(w.comp, ROAST_TRACK.memeAudio, w.start, w.end);
    w.comp = audio.comp;
    fg.linkId = linkId;
    clips.push(newClip({ trackId: audio.track.id, start: w.start, duration, in: inPoint, source, linkId, name: roastName(w.event.id, `${label} audio`), label: 'rose' }));
  }
  place(w, clips);
  return { fg: clipById(w, fg.id) ?? fg, asset };
}

function memeCutaway(w: Work, payload: Extract<MovePayload, { move: 'meme_cutaway' }>) {
  const placed = placeCutaway(w, payload, 'meme');
  if (!placed) return;
  const { fg, asset } = placed;
  const f = frame(w.comp);
  if (payload.entry === 'whip') writeKeys(w, fg.id, 'x', 0, 4 * f, [{ time: 0, value: 0.6, easing: 'ease-out' }, { time: 4 * f, value: 0, easing: 'linear' }]);
  if (payload.entry === 'zoom') writeKeys(w, fg.id, 'scale', 0, 0.2, [{ time: 0, value: 125, easing: 'ease-out' }, { time: 0.2, value: 100, easing: 'linear' }]);
  // The host gives way: muted while the meme's own sound plays, unless the plan sets a level.
  const plays = asset.kind === 'video' && asset.hasAudio && payload.keepAudio !== false;
  const db = payload.duckHostDb ?? (plays ? -Infinity : 0);
  if (db < 0) duckDialogue(w, w.start, w.end, db <= -60 ? 0 : dbToGain(db));
  const length = w.end - w.start;
  if (length < MOVE_SPECS.meme_cutaway.bounds[0] || length > MOVE_SPECS.meme_cutaway.bounds[1]) w.warnings.push(`a meme for ${length.toFixed(2)} s; they land best at 0.6–4 s`);
}

function receipt(w: Work, payload: Extract<MovePayload, { move: 'receipt' }>) {
  const placed = placeCutaway(w, payload, 'receipt');
  if (!placed) return;
  // The target speaks: the host is silent under their words.
  duckDialogue(w, w.start, w.end, 0);
  const inPoint = Math.max(0, payload.in ?? 0);
  const words = (payload.captions === false ? [] : payload.words ?? [])
    .filter((word) => word.text?.trim() && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({ text: word.text.trim(), start: w.start + (word.start - inPoint), end: w.start + (word.end - inPoint) }))
    .filter((word) => word.end > w.start + EPS && word.start < w.end - EPS)
    .sort((a, b) => a.start - b.start);
  if (words.length) {
    const lane = videoLane(w.comp, ROAST_TRACK.text, w.start, w.end);
    w.comp = lane.comp;
    // One word at a time, each until the next is said (A's receipts): never on the host.
    const captions = words.map((word, index) => {
      const start = Math.max(w.start, word.start);
      const until = Math.min(w.end, words[index + 1]?.start ?? word.end + 0.25);
      return textClip(lane.track.id, start, Math.max(MIN_DURATION, until - start), word.text, 'roundedPop', roastName(w.event.id, `caption ${index + 1}`));
    }).filter((clip, index, all) => index === 0 || clip.start >= all[index - 1].start + MIN_DURATION);
    place(w, captions);
  }
  if (payload.label?.trim()) {
    const text = payload.label.trim().startsWith('*') ? payload.label.trim() : `*${payload.label.trim()}`;
    const lane = videoLane(w.comp, ROAST_TRACK.text, w.start, w.end);
    w.comp = lane.comp;
    const clip = textClip(lane.track.id, w.start, w.end - w.start, text.toUpperCase(), 'labelStar', roastName(w.event.id, 'label'));
    clip.transform = { ...clip.transform, x: -0.3, y: 0.22 - anchorY('labelStar') };
    place(w, [clip]);
  }
}

function sideCutout(w: Work, payload: Extract<MovePayload, { move: 'side_cutout' }>) {
  const asset = w.env.assets.get(payload.assetId);
  if (!asset || asset.kind === 'audio') {
    w.errors.push(asset ? `${asset.name} is audio only` : `asset ${payload.assetId} is not in the project`);
    return;
  }
  const comp = w.comp;
  const source: ClipSource = { type: 'media', assetId: asset.id };
  const info = sourceInfo(w.env.project, w.env.assets, source);
  // Height as a share of the frame, bottom-anchored, a 4 % margin from the side.
  const heightShare = clamp(payload.heightPct ?? 55, 10, 100) / 100;
  const base = fittedSize(comp, info.width, info.height, 100);
  const scale = (100 * heightShare * comp.height) / Math.max(1, base.height);
  const box = fittedSize(comp, info.width, info.height, scale);
  const sign = payload.side === 'left' ? -1 : 1;
  const x = sign * (0.5 - 0.04 - box.width / (2 * comp.width));
  const y = 0.5 - box.height / (2 * comp.height);
  const off = sign * (0.5 + box.width / (2 * comp.width) + 0.02);
  const lane = videoLane(w.comp, ROAST_TRACK.cards, w.start, w.end);
  w.comp = lane.comp;
  const length = w.end - w.start;
  const clip = newClip({ trackId: lane.track.id, start: w.start, duration: length, source, volume: 0, transform: { ...DEFAULT_TRANSFORM, fit: 'fit', scale: round(scale), x: round(x), y: round(y) }, name: roastName(w.event.id, `cutout · ${asset.name}`), label: 'rose' });
  place(w, [clip]);
  const enter = Math.min(0.18, length / 3);
  const leave = Math.min(0.15, length / 3);
  if (payload.enter === 'pop') {
    writeKeys(w, clip.id, 'scale', 0, length, [...popKeys(clip.transform.scale, enter), { time: length - leave, value: clip.transform.scale, easing: 'ease-in' }, { time: length, value: 0, easing: 'linear' }]);
  } else {
    writeKeys(w, clip.id, 'x', 0, length, [
      { time: 0, value: round(off), easing: 'overshoot' },
      { time: enter, value: round(x), easing: 'linear' },
      { time: length - leave, value: round(x), easing: 'ease-in' },
      { time: length, value: round(off), easing: 'linear' },
    ]);
  }
  if ((payload.stroke || payload.shadow) && !/sticker|cutout/i.test(asset.name)) w.warnings.push(`stroke and shadow are baked into the PNG by cutout_image; ${asset.name} is placed as it is`);
}

function hostOnBg(w: Work, payload: Extract<MovePayload, { move: 'host_on_bg' }>) {
  const host = hostClipAt(w.comp, w.start, w.env.assets, payload.hostClipId);
  if (!host) {
    w.errors.push(payload.hostClipId ? `no clip ${payload.hostClipId}` : 'no host clip at that time');
    return;
  }
  if (!isMatted(host)) {
    w.errors.push(`the host clip ${host.name ?? host.id} has no roto matte or key; run key_green_screen or rotoscope_clip first`);
    return;
  }
  const start = Math.max(w.start, host.start);
  let end = Math.min(w.end, clipEnd(host));
  let source: ClipSource;
  let label: string;
  let inPoint = 0;
  if (payload.bgAssetId) {
    const asset = w.env.assets.get(payload.bgAssetId);
    if (!asset || asset.kind === 'audio') {
      w.errors.push(asset ? `${asset.name} is audio only` : `asset ${payload.bgAssetId} is not in the project`);
      return;
    }
    source = { type: 'media', assetId: asset.id };
    label = `bg · ${asset.name}`;
    inPoint = Math.max(0, payload.in ?? 0);
    if (asset.kind === 'video' && end - start > asset.duration - inPoint + EPS) {
      w.warnings.push(`${asset.name} is shorter than the span; the background ends early`);
      end = start + Math.max(MIN_DURATION, asset.duration - inPoint);
    }
  } else if (payload.color) {
    source = { type: 'shape', shape: 'rectangle', sides: 4, fill: payload.color.toUpperCase(), stroke: null, strokeWidth: 0, width: w.comp.width, height: w.comp.height, cornerRadius: 0 };
    label = `bg · ${payload.color}`;
  } else {
    w.errors.push('host_on_bg needs bgAssetId or color');
    return;
  }
  const lane = bgLane(w.comp, host.trackId, start, end);
  w.comp = lane.comp;
  place(w, [newClip({ trackId: lane.track.id, start, duration: end - start, in: inPoint, source, volume: 0, transform: { ...DEFAULT_TRANSFORM, fit: 'fill' }, name: roastName(w.event.id, label) })]);
}

function keywordPop(w: Work, payload: Extract<MovePayload, { move: 'keyword_pop' }>) {
  const text = payload.text.trim();
  const length = w.end - w.start;
  const style = payload.style;
  if (payload.position === 'behind') {
    // Text behind the matted host: the text on Roast Text, the host's matted copy above it.
    const host = hostClipAt(w.comp, w.start, w.env.assets);
    if (!host || !host.rotoMatte || host.source.type !== 'media') {
      w.errors.push('text behind the host needs a roto matte on the host clip (rotoscope_clip)');
      return;
    }
    const start = Math.max(w.start, host.start);
    const end = Math.min(w.end, clipEnd(host));
    const piece: Clip = { ...host, id: uid(), start, duration: end - start, in: sourceTimeAt(host, start), keyframes: shiftKeys(host.keyframes, start - host.start), linkId: null, groupId: null };
    const hostTrack = w.comp.tracks.find((track) => track.id === host.trackId) as Track;
    let layered: ReturnType<typeof textBehindSubject>;
    try {
      layered = textBehindSubject({ ...w.comp, tracks: [hostTrack], clips: [piece], transitions: [] }, piece.id, text, payload.color ?? '#FFFFFF');
    } catch (error) {
      w.errors.push(error instanceof Error ? error.message : String(error));
      return;
    }
    const foreground = layered.comp.clips.find((clip) => clip.id === layered.foregroundId) as Clip;
    const textLane = videoLane(w.comp, ROAST_TRACK.text, start, end);
    w.comp = textLane.comp;
    const title = textClip(textLane.track.id, start, end - start, text, style, roastName(w.event.id, `keyword · ${text}`), payload.color);
    title.transform = { ...title.transform, y: round(0.45 - anchorY(style)), scale: 160 };
    place(w, [title]);
    writeKeys(w, title.id, 'scale', 0, 0.12, popKeys(160));
    const fgLane = videoLane(w.comp, ROAST_TRACK.text, start, end, textLane.track.id);
    w.comp = fgLane.comp;
    place(w, [{ ...foreground, id: uid(), trackId: fgLane.track.id, volume: 0, groupId: null, name: roastName(w.event.id, 'host over keyword') }]);
    return;
  }
  const lane = videoLane(w.comp, ROAST_TRACK.text, w.start, w.end);
  w.comp = lane.comp;
  const clip = textClip(lane.track.id, w.start, length, text, style, roastName(w.event.id, `keyword · ${text}`), payload.color);
  const y = payload.position === 'top' ? 0.2 : payload.position === 'bottom' ? 0.8 : 0.5;
  clip.transform = { ...clip.transform, y: round(y - anchorY(style)) };
  place(w, [clip]);
  writeKeys(w, clip.id, 'scale', 0, 0.12, popKeys(100));
}

/**
 * One big emoji with a wobble in. It is an html sticker, not a text clip: text exports through
 * libass, which draws emoji as flat outlines, while the html rasteriser keeps their colour.
 */
function emojiPop(w: Work, payload: Extract<MovePayload, { move: 'emoji_pop' }>) {
  card(w, 'roast-sticker-badge', {
    text: payload.emoji, shape: 'emoji', size: clamp(payload.sizePct ?? 16, 3, 60) / 100,
    x: clamp(payload.x ?? 0.78, 0, 1), y: clamp(payload.y ?? 0.28, 0, 1),
  }, `emoji ${payload.emoji}`);
}

/** The title card's params: the photo by path and asset id (prepareRoastCardImages inlines either). */
export function titleCardParams(event: Pick<Extract<MovePayload, { move: 'title_card' }>, 'text' | 'accent'>, photo?: Pick<Asset, 'id' | 'path'>): Record<string, unknown> {
  return { text: event.text, ...(event.accent ? { accent: event.accent } : {}), ...(photo ? { photo: photo.path, photoAssetId: photo.id } : {}) };
}

/** The sticker card's params. */
export function stickerParams(event: Extract<MovePayload, { move: 'sticker' }>): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ text: event.text, shape: event.shape ?? 'heart', color: event.color, x: event.x, y: event.y }).filter(([, value]) => value !== undefined));
}

/** A card graphic (html template) on the Roast Cards lane; the card animates itself. */
function card(w: Work, template: CardTemplateId, params: Record<string, unknown>, label: string, start = w.start, end = w.end) {
  let built: unknown;
  try {
    built = buildRoastCard(template, params, w.comp);
  } catch (error) {
    w.errors.push(`the ${template} card could not be built: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const source = htmlSource(built);
  if (!source) {
    w.errors.push(`the ${template} card builder returned no graphic`);
    return;
  }
  const lane = videoLane(w.comp, ROAST_TRACK.cards, start, end);
  w.comp = lane.comp;
  place(w, [newClip({ trackId: lane.track.id, start, duration: end - start, source: { ...source, template: source.template ?? template }, name: roastName(w.event.id, label), label: 'mango' })]);
}

function overlayFx(w: Work, payload: Extract<MovePayload, { move: 'overlay_fx' }>) {
  if (!(FX_TEMPLATES as readonly string[]).includes(payload.fx)) {
    w.errors.push(`unknown overlay "${payload.fx}"; one of ${FX_TEMPLATES.join(', ')}`);
    return;
  }
  const spec = findTemplate(payload.fx);
  if (!spec) {
    w.errors.push(`the ${payload.fx} template is not in the motion kit yet`);
    return;
  }
  const length = w.end - w.start;
  let scene: MotionScene;
  try {
    scene = spec.build({ width: w.comp.width, height: w.comp.height, ...(payload.tint ? { palette: { accent: payload.tint } } : {}) }, { duration: length, ...(payload.tint ? { tint: payload.tint } : {}) });
  } catch (error) {
    w.errors.push(`the ${payload.fx} template could not be built: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  scene = { ...scene, duration: Math.max(scene.duration, length) };
  const problems = validateScene(scene);
  if (problems.length) {
    w.errors.push(`the ${payload.fx} scene is not valid: ${problems.slice(0, 3).join(' ')}`);
    return;
  }
  const lane = videoLane(w.comp, ROAST_TRACK.fx, w.start, w.end);
  w.comp = lane.comp;
  place(w, [newClip({ trackId: lane.track.id, start: w.start, duration: length, source: { type: 'motion', scene, title: spec.label }, name: roastName(w.event.id, `fx · ${payload.fx.replace(/^fx-/, '')}`), label: 'mango' })]);
}

function zoomPunch(w: Work, payload: Extract<MovePayload, { move: 'zoom_punch' }>) {
  const host = hostClipAt(w.comp, w.start, w.env.assets, payload.clipId);
  if (!host) {
    w.errors.push(payload.clipId ? `no clip ${payload.clipId}` : 'no host clip at that time');
    return;
  }
  const a = clamp(w.start - host.start, 0, host.duration);
  const b = clamp(w.end - host.start, a, host.duration);
  if (b - a < MIN_DURATION) {
    w.errors.push('the zoom falls outside the host clip');
    return;
  }
  const base = valueAt(host.keyframes.scale, a) ?? host.transform.scale;
  const target = base * (clamp(payload.scale ?? 125, 101, 200) / 100);
  const f = frame(w.comp);
  const keys: Keyframe[] = payload.ease === 'slow'
    // A slow dramatic push over the beat, back on the next frame after it.
    ? [{ time: a, value: base, easing: 'ease-in-out' }, { time: Math.max(a + f, b - f), value: round(target), easing: 'hold' }, { time: b, value: base, easing: 'linear' }]
    // Snap in over two frames, hold, snap back at the end.
    : [{ time: a, value: base, easing: 'ease-out' }, { time: Math.min(b, a + 2 * f), value: round(target), easing: 'hold' }, { time: b, value: base, easing: 'linear' }];
  writeKeys(w, host.id, 'scale', a, b, keys);
}

/** A deterministic 0..1 sequence from a string (mulberry32 over its hash): the same event shakes the same way. */
function seeded(seed: string): () => number {
  let state = 0;
  for (let index = 0; index < seed.length; index++) state = (Math.imul(state ^ seed.charCodeAt(index), 2654435761) + index) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shake(w: Work, payload: Extract<MovePayload, { move: 'shake' }>) {
  const host = hostClipAt(w.comp, w.start, w.env.assets, payload.clipId);
  if (!host) {
    w.errors.push(payload.clipId ? `no clip ${payload.clipId}` : 'no host clip at that time');
    return;
  }
  const f = frame(w.comp);
  const frames = Math.round(clamp(payload.frames ?? 5, 2, 30));
  const a = clamp(w.start - host.start, 0, host.duration);
  const b = clamp(a + frames * f, a, host.duration);
  const intensity = clamp(payload.intensityPx ?? 14, 1, 200);
  const random = seeded(w.event.id);
  const baseX = valueAt(host.keyframes.x, a) ?? host.transform.x;
  const baseY = valueAt(host.keyframes.y, a) ?? host.transform.y;
  const xs: Keyframe[] = [];
  const ys: Keyframe[] = [];
  const count = Math.max(1, Math.round((b - a) / f));
  for (let index = 0; index <= count; index++) {
    // Offsets decay to rest; pixels are of the comp frame, stored as a share of its width/height.
    const decay = 1 - index / count;
    const time = a + ((b - a) * index) / count;
    xs.push({ time, value: round(baseX + (random() * 2 - 1) * decay * (intensity / w.comp.width)), easing: 'linear' });
    ys.push({ time, value: round(baseY + (random() * 2 - 1) * decay * (intensity / w.comp.height)), easing: 'linear' });
  }
  xs[xs.length - 1].value = baseX;
  ys[ys.length - 1].value = baseY;
  writeKeys(w, host.id, 'x', a, b, xs);
  writeKeys(w, host.id, 'y', a, b, ys);
  // A full-frame host shows its edges when it moves: scale up just enough while it shakes, unless a zoom already animates there.
  if (!host.keyframes.scale.some((key) => key.time >= a - EPS && key.time <= b + EPS)) {
    const base = valueAt(host.keyframes.scale, a) ?? host.transform.scale;
    const cover = base * (1 + 2.2 * Math.max(intensity / w.comp.width, intensity / w.comp.height));
    writeKeys(w, host.id, 'scale', a, b, [{ time: a, value: base, easing: 'hold' }, { time: Math.min(b, a + f / 2), value: round(cover), easing: 'hold' }, { time: b, value: base, easing: 'linear' }]);
  }
  w.end = host.start + b;
}

/** A whip pan across the host cut nearest the event: out left, in from the right, 4 frames, with the cross-zoom blur. */
function whip(w: Work, payload: Extract<MovePayload, { move: 'whip' }>): number | null {
  const host = hostTrackOf(w.comp, w.env.assets);
  if (!host) {
    w.errors.push('there is no host track');
    return null;
  }
  const f = frame(w.comp);
  const tolerance = 0.5 * f + 0.02;
  const clips = w.comp.clips.filter((clip) => clip.trackId === host.id && clip.enabled && isPicture(clip)).sort((a, b) => a.start - b.start);
  const cuts: { out: Clip; in: Clip; at: number }[] = [];
  for (let index = 1; index < clips.length; index++) {
    const out = clips[index - 1];
    const incoming = clips[index];
    if (Math.abs(clipEnd(out) - incoming.start) > tolerance) continue;
    if (payload.clipId && out.id !== payload.clipId && incoming.id !== payload.clipId) continue;
    cuts.push({ out, in: incoming, at: incoming.start });
  }
  const nearest = cuts.sort((a, b) => Math.abs(a.at - w.event.at) - Math.abs(b.at - w.event.at))[0];
  if (!nearest || Math.abs(nearest.at - w.event.at) > 1) {
    w.errors.push(`no cut on the host within 1 s of ${w.event.at.toFixed(2)}s to whip across`);
    return null;
  }
  const outX = valueAt(nearest.out.keyframes.x, nearest.out.duration) ?? nearest.out.transform.x;
  const inX = valueAt(nearest.in.keyframes.x, 0) ?? nearest.in.transform.x;
  const half = Math.min(2 * f, nearest.out.duration / 2, nearest.in.duration / 2);
  writeKeys(w, nearest.out.id, 'x', nearest.out.duration - half, nearest.out.duration, [{ time: nearest.out.duration - half, value: outX, easing: 'ease-in' }, { time: nearest.out.duration, value: round(outX - 0.6), easing: 'linear' }]);
  writeKeys(w, nearest.in.id, 'x', 0, half, [{ time: 0, value: round(inX + 0.6), easing: 'ease-out' }, { time: half, value: inX, easing: 'linear' }]);
  // Clip blur cannot be animated, so the blur comes from the cross-zoom transition (as blur-push does).
  const before = new Set(w.comp.transitions.map((transition) => transition.id));
  w.comp = addTransition(w.comp, host.id, nearest.at, 'cross-zoom', 2 * half, tolerance);
  const added = w.comp.transitions.filter((transition) => !before.has(transition.id)).map((transition) => transition.id);
  if (added.length) (w.applied.transitionIds ??= []).push(...added);
  w.start = nearest.at - half;
  w.end = nearest.at + half;
  return nearest.at;
}

function bwFreeze(w: Work, payload: Extract<MovePayload, { move: 'bw_freeze' }>) {
  const host = hostClipAt(w.comp, w.start, w.env.assets, payload.clipId);
  if (!host) {
    w.errors.push(payload.clipId ? `no clip ${payload.clipId}` : 'no host clip at that time');
    return;
  }
  // A graded copy of the host over the beat, rather than a split: the host keeps its clip ids and
  // keyframes, and the copy is removed cleanly on a re-apply. It looks the same on screen.
  const start = Math.max(w.start, host.start);
  const end = Math.min(w.end, clipEnd(host));
  if (end - start < MIN_DURATION) {
    w.errors.push('the freeze falls outside the host clip');
    return;
  }
  const lane = videoLane(w.comp, ROAST_TRACK.grade, start, end);
  w.comp = lane.comp;
  const held = payload.freeze ? sourceTimeAt(host, start) : null;
  const copy: Clip = {
    ...host, id: uid(), trackId: lane.track.id, start, duration: end - start, in: sourceTimeAt(host, start), linkId: null, groupId: null, volume: 0,
    hold: held ?? host.hold, keyframes: held !== null ? { ...EMPTY_KEYFRAMES } : shiftKeys(host.keyframes, start - host.start),
    effects: { ...host.effects, saturation: 0 }, name: roastName(w.event.id, payload.freeze ? 'b&w freeze' : 'b&w'),
  };
  if (held !== null) copy.transform = { ...host.transform, scale: valueAt(host.keyframes.scale, start - host.start) ?? host.transform.scale, x: valueAt(host.keyframes.x, start - host.start) ?? host.transform.x, y: valueAt(host.keyframes.y, start - host.start) ?? host.transform.y };
  place(w, [copy]);
}

function labelMove(w: Work, payload: Extract<MovePayload, { move: 'label' }>) {
  const lane = videoLane(w.comp, ROAST_TRACK.text, w.start, w.end);
  w.comp = lane.comp;
  const length = w.end - w.start;
  const anchor = anchorY('labelStar');
  const path = (payload.path ?? []).filter((point) => [point.t, point.x, point.y].every(Number.isFinite)).sort((a, b) => a.t - b.t);
  const x0 = path[0]?.x ?? payload.x ?? 0.5;
  const y0 = path[0]?.y ?? payload.y ?? 0.3;
  const clip = textClip(lane.track.id, w.start, length, payload.text.trim(), 'labelStar', roastName(w.event.id, `label ${payload.text.trim()}`));
  clip.transform = { ...clip.transform, x: round(x0 - 0.5), y: round(y0 - anchor) };
  place(w, [clip]);
  writeKeys(w, clip.id, 'scale', 0, 0.12, popKeys(100));
  if (path.length > 1) {
    // `t` is seconds from the move's start; the label follows the person.
    writeKeys(w, clip.id, 'x', 0, length, path.map((point) => ({ time: clamp(point.t, 0, length), value: round(point.x - 0.5), easing: 'linear' as const })));
    writeKeys(w, clip.id, 'y', 0, length, path.map((point) => ({ time: clamp(point.t, 0, length), value: round(point.y - anchor), easing: 'linear' as const })));
  }
}

function headPaste(w: Work, payload: Extract<MovePayload, { move: 'head_paste' }>) {
  const asset = w.env.assets.get(payload.headAssetId);
  if (!asset || asset.kind === 'audio') {
    w.errors.push(asset ? `${asset.name} is audio only` : `asset ${payload.headAssetId} is not in the project`);
    return;
  }
  const path = (payload.path ?? []).filter((point) => [point.t, point.x, point.y, point.scale].every(Number.isFinite)).sort((a, b) => a.t - b.t);
  if (!path.length) {
    w.errors.push('head_paste needs a path (detect_faces on the meme clip)');
    return;
  }
  const source: ClipSource = { type: 'media', assetId: asset.id };
  const info = sourceInfo(w.env.project, w.env.assets, source);
  const base = fittedSize(w.comp, info.width, info.height, 100);
  // `scale` is the head's height as a share of the frame (0.25); values over 3 are percent already.
  const toScale = (value: number) => round(value > 3 ? value : (100 * value * w.comp.height) / Math.max(1, base.height));
  const length = w.end - w.start;
  const lane = videoLane(w.comp, ROAST_TRACK.cards, w.start, w.end);
  w.comp = lane.comp;
  const first = path[0];
  const clip = newClip({ trackId: lane.track.id, start: w.start, duration: length, source, volume: 0, transform: { ...DEFAULT_TRANSFORM, fit: 'fit', x: round(first.x - 0.5), y: round(first.y - 0.5), scale: toScale(first.scale), rotation: first.rotation ?? 0 }, name: roastName(w.event.id, 'head paste'), label: 'rose' });
  place(w, [clip]);
  if (path.length > 1) {
    const at = (t: number) => clamp(t, 0, length);
    writeKeys(w, clip.id, 'x', 0, length, path.map((p) => ({ time: at(p.t), value: round(p.x - 0.5), easing: 'linear' as const })));
    writeKeys(w, clip.id, 'y', 0, length, path.map((p) => ({ time: at(p.t), value: round(p.y - 0.5), easing: 'linear' as const })));
    writeKeys(w, clip.id, 'scale', 0, length, path.map((p) => ({ time: at(p.t), value: toScale(p.scale), easing: 'linear' as const })));
    if (path.some((p) => p.rotation !== undefined)) writeKeys(w, clip.id, 'rotation', 0, length, path.map((p) => ({ time: at(p.t), value: p.rotation ?? 0, easing: 'linear' as const })));
  }
}

function bleep(w: Work, payload: Extract<MovePayload, { move: 'bleep' }>, cue: SfxCue | null) {
  const from = clamp(payload.from, 0, w.env.limit);
  const to = clamp(payload.to, from, w.env.limit);
  if (to - from < 0.02) {
    w.errors.push('bleep needs to > from');
    return;
  }
  w.start = from;
  w.end = to;
  if (!duckDialogue(w, from, to, 0)) w.warnings.push('no dialogue under the bleep to mute');
  if (cue) {
    // The tone covers the word exactly (sfxClip cuts it and fades the last 5 ms).
    const id = placeSfx(w, cue, from, { duration: to - from, note: 'bleep' });
    const placed = id ? clipById(w, id) : undefined;
    if (placed && placed.duration < to - from - 0.01) w.warnings.push(`the bleep sound is ${placed.duration.toFixed(2)} s, shorter than the word`);
  }
  const cover = payload.cover ?? (payload.mouth ? 'emoji' : 'none');
  if (cover === 'none') return;
  const mouth = payload.mouth;
  if (!mouth) {
    w.warnings.push('a mouth cover needs mouth (detect_faces)');
    return;
  }
  if (cover === 'emoji') {
    card(w, 'roast-sticker-badge', {
      text: '🤐', shape: 'emoji', size: clamp(mouth.height * 1.8, 0.04, 0.4),
      x: clamp(mouth.x + mouth.width / 2, 0, 1), y: clamp(mouth.y + mouth.height / 2, 0, 1),
    }, 'mouth cover', from, to);
    return;
  }
  // Blur: a masked, blurred copy of the host over the mouth box.
  const host = hostClipAt(w.comp, from, w.env.assets);
  if (!host) {
    w.warnings.push('no host clip under the bleep to blur');
    return;
  }
  const lane = videoLane(w.comp, ROAST_TRACK.grade, from, to);
  w.comp = lane.comp;
  const start = Math.max(from, host.start);
  const end = Math.min(to, clipEnd(host));
  place(w, [{
    ...host, id: uid(), trackId: lane.track.id, start, duration: Math.max(MIN_DURATION, end - start), in: sourceTimeAt(host, start), linkId: null, groupId: null, volume: 0,
    keyframes: shiftKeys(host.keyframes, start - host.start), effects: { ...host.effects, blur: 28 },
    mask: { shape: 'ellipse', x: mouth.x, y: mouth.y, width: mouth.width, height: mouth.height, points: [], feather: 12, inverted: false },
    name: roastName(w.event.id, 'mouth blur'),
  }]);
}

function musicSting(w: Work, payload: Extract<MovePayload, { move: 'music_sting' }>) {
  const asset = w.env.assets.get(payload.assetId);
  if (!asset || asset.kind === 'image' || (asset.kind === 'video' && !asset.hasAudio)) {
    w.errors.push(asset ? `${asset.name} has no sound` : `asset ${payload.assetId} is not in the project`);
    return;
  }
  if (payload.snapToBeat) {
    const grid = w.env.downbeats?.length ? w.env.downbeats : w.env.beats ?? [];
    const nearest = grid.reduce<number | null>((best, beat) => (best === null || Math.abs(beat - w.start) < Math.abs(best - w.start) ? beat : best), null);
    if (nearest === null) w.warnings.push('no beat grid to snap the sting to (analyze_music_beats, then pass beats)');
    else if (Math.abs(nearest - w.start) <= 0.5) {
      const length = w.end - w.start;
      w.start = Math.max(0, nearest);
      w.end = w.start + length;
    }
  }
  const inPoint = Math.max(0, payload.in ?? 0);
  const available = asset.duration - inPoint;
  if (available < MIN_DURATION) {
    w.errors.push(`in ${inPoint}s is past the end of ${asset.name}`);
    return;
  }
  w.end = Math.min(w.end, w.start + available);
  const length = w.end - w.start;
  const lane = audioLane(w.comp, ROAST_TRACK.music, w.start, w.end);
  w.comp = lane.comp;
  const gain = dbToGain(clamp(payload.db ?? -12, -60, 6));
  const clip = newClip({ trackId: lane.track.id, start: w.start, duration: length, in: inPoint, source: { type: 'media', assetId: asset.id }, volume: round(gain), audioType: 'music', name: roastName(w.event.id, `sting · ${asset.name}`), label: 'forest' });
  place(w, [clip]);
  const fade = clamp(payload.fadeOut ?? 0.3, 0, length / 2);
  if (fade > 0) writeKeys(w, clip.id, 'volume', 0, length, [{ time: length - fade, value: round(gain), easing: 'linear' }, { time: length, value: 0, easing: 'linear' }]);
}

// ─── Running one event ────────────────────────────────────────────────────────────────────────

/**
 * Applies one event to `comp`. Pure: on any error the comp comes back unchanged and nothing is
 * recorded, so a plan never half-applies a move.
 */
export function runMove(comp: Comp, event: RoastEvent, env: MoveEnv): MoveResult {
  const spec = MOVE_SPECS[event.move];
  const applied: AppliedEvent = { eventId: event.id, clipIds: [] };
  if (!spec) return { comp, applied, warnings: [], errors: [`unknown move "${String(event.move)}"`] };
  const start = clamp(event.at, 0, Math.max(0, env.limit - MIN_DURATION));
  const w: Work = { comp, event, env, start, end: Math.min(env.limit, start + Math.max(MIN_DURATION, event.duration || spec.seconds)), applied, warnings: [], errors: [] };
  if (!(event.at >= 0) || event.at >= env.limit) w.errors.push(`at ${event.at}s is outside the comp (0–${env.limit.toFixed(2)} s)`);
  else if (event.at + event.duration > env.limit + 0.05 && event.move !== 'sfx' && event.move !== 'music_sting') w.warnings.push(`runs past the end of the comp; shortened to ${(w.end - w.start).toFixed(2)} s`);
  const cue = cueFor(event, env.assets);
  let sfxAt: number | null = w.start;
  if (!w.errors.length) {
    switch (event.move) {
      case 'meme_cutaway': memeCutaway(w, event); break;
      case 'receipt': receipt(w, event); break;
      case 'side_cutout': sideCutout(w, event); break;
      case 'host_on_bg': hostOnBg(w, event); break;
      case 'keyword_pop':
        if (!(ROAST_TEXT_STYLES as readonly string[]).includes(event.style)) w.errors.push(`style must be one of ${ROAST_TEXT_STYLES.join(', ')}`);
        else if (!event.text?.trim()) w.errors.push('keyword_pop needs text');
        else keywordPop(w, event);
        break;
      case 'emoji_pop':
        if (!event.emoji?.trim()) w.errors.push('emoji_pop needs an emoji');
        else emojiPop(w, event);
        break;
      case 'sticker': card(w, 'roast-sticker-badge', stickerParams(event), `sticker · ${event.text}`); break;
      case 'card':
        if (!(CARD_TEMPLATES as readonly string[]).includes(event.template)) w.errors.push(`template must be one of ${CARD_TEMPLATES.join(', ')}`);
        else card(w, event.template, { ...(event.params ?? {}), ...(event.placement ? { placement: event.placement } : {}) }, `card · ${event.template.replace(/^roast-/, '')}`);
        break;
      case 'title_card': {
        const photo = event.photoAssetId ? env.assets.get(event.photoAssetId) : undefined;
        if (event.photoAssetId && !photo) w.errors.push(`asset ${event.photoAssetId} is not in the project`);
        else card(w, 'roast-title-card', titleCardParams(event, photo), `title · ${event.text}`);
        break;
      }
      case 'cta': card(w, 'roast-cta-fire', { text: event.text }, `cta · ${event.text}`); break;
      case 'overlay_fx': overlayFx(w, event); break;
      case 'zoom_punch': zoomPunch(w, event); break;
      case 'shake': shake(w, event); break;
      case 'whip': sfxAt = whip(w, event); break;
      case 'bw_freeze': bwFreeze(w, event); break;
      case 'label':
        if (!event.text?.trim()) w.errors.push('label needs text');
        else labelMove(w, event);
        break;
      case 'head_paste': headPaste(w, event); break;
      case 'bleep': bleep(w, event, cue); sfxAt = null; break;
      case 'music_sting': musicSting(w, event); sfxAt = w.start; break;
      case 'sfx':
        if (!event.cue || (!event.cue.kind && !event.cue.id && !event.cue.assetId)) w.errors.push('sfx needs a cue with kind, id or assetId');
        else placeSfx(w, event.cue, w.start + (event.cue.offset ?? 0));
        sfxAt = null;
        break;
      default: w.errors.push(`unknown move "${String((event as { move: unknown }).move)}"`);
    }
  }
  if (!w.errors.length && cue && sfxAt !== null) placeSfx(w, cue, sfxAt + (cue.offset ?? 0));
  if (w.errors.length) return { comp, applied: { eventId: event.id, clipIds: [] }, warnings: w.warnings, errors: w.errors };
  return { comp: w.comp, applied: w.applied, warnings: w.warnings, errors: [] };
}

/** Takes back what one applied event made: its clips, the keyframes it wrote, its transitions. */
export function undoApplied(comp: Comp, entry: AppliedEvent): Comp {
  const own = new Set(entry.clipIds);
  for (const clip of comp.clips) if (roastIdOf(clip) === entry.eventId) own.add(clip.id);
  let next = own.size ? removeClips(comp, own, false) : comp;
  if (entry.keys?.length) {
    const byClip = new Map<string, { property: KeyframedProperty; times: number[] }[]>();
    for (const item of entry.keys) byClip.set(item.clipId, [...(byClip.get(item.clipId) ?? []), item]);
    next = {
      ...next,
      clips: next.clips.map((clip) => {
        const items = byClip.get(clip.id);
        if (!items) return clip;
        const keyframes = { ...clip.keyframes };
        for (const { property, times } of items) keyframes[property] = keyframes[property].filter((key) => !times.some((time) => Math.abs(time - key.time) < 1e-5));
        return { ...clip, keyframes };
      }),
    };
  }
  if (entry.transitionIds?.length) {
    const gone = new Set(entry.transitionIds);
    next = { ...next, transitions: next.transitions.filter((transition) => !gone.has(transition.id)) };
  }
  return next;
}
