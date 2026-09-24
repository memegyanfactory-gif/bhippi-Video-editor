// Edit DNA of a timeline: the measured shape of an edit (docs/FUNNY-MODE-PLAN.md §3.7).
//
// The two reference roasts were read as cuts, events, sound effects and music over time; this
// reads a comp the same way straight from its clips, so a plan can be judged before anything is
// rendered and the Comedian seat can point at the exact dead zone. What counts:
//   cuts    – edges of the host (the lowest video track with footage on it), plus edges of
//             full-frame cutaways above it (a meme or receipt replaces the whole picture);
//   events  – anything that happens on top of the host: clips the roast executor made
//             (`roast:<id> …`), text / HTML / motion / shape clips and picture-in-picture above
//             the host, and zoom / shake / whip keyframe motion on host clips;
//   static  – the longest host-only stretch with no cut and no event starting or ending.
// Numbers per minute are per 60 s bin; a shorter last bin is scaled to a per-minute rate.

import { placement } from '../editor';
import { clipEnd, compDuration, tracksOf, type AssetMap } from '../timeline';
import type { Clip, Comp, KeyframedProperty, Project, Track } from '../types';
import type { DnaBand, DnaFinding, EditDna, TimedSpan } from './types';

// ─── Shared roast naming (the executor, the validator and this file agree on these) ───────────

/** Tracks the roast executor makes, by role. Video ones sit above the host in this order. */
export const ROAST_TRACK = {
  bg: 'Roast BG',
  grade: 'Roast Grade',
  memesBg: 'Memes BG',
  memes: 'Memes',
  cards: 'Roast Cards',
  text: 'Roast Text',
  fx: 'Roast FX',
  sfx: 'SFX',
  music: 'Music',
  memeAudio: 'Memes',
} as const;

/** Every clip the executor creates is named `roast:<eventId> <label>`. */
export const ROAST_PREFIX = 'roast:';

/** The event id a roast clip was made for, or null for any other clip. */
export function roastIdOf(clip: Pick<Clip, 'name'>): string | null {
  const match = clip.name ? /^roast:(\S+)/.exec(clip.name) : null;
  return match ? match[1] : null;
}

const VIDEO_ROAST_NAMES: ReadonlySet<string> = new Set([ROAST_TRACK.bg, ROAST_TRACK.grade, ROAST_TRACK.memesBg, ROAST_TRACK.memes, ROAST_TRACK.cards, ROAST_TRACK.text, ROAST_TRACK.fx]);

/** Whether a video track is one the roast executor owns (never the host). */
export const isRoastVideoTrack = (track: Track) => track.kind === 'video' && VIDEO_ROAST_NAMES.has(track.name.trim());

const isPicture = (clip: Clip) => clip.source.type === 'media' || clip.source.type === 'comp' || clip.source.type === 'item';

/** An opaque rectangle at least the frame's size, centred: a solid backdrop (a meme fitted on black). */
const isSolid = (clip: Clip, comp: Comp) => {
  const source = clip.source;
  if (source.type !== 'shape' || source.shape !== 'rectangle' || !source.fill || source.cornerRadius > 0) return false;
  const t = clip.transform;
  return t.opacity >= 99.5 && Math.abs(t.rotation) <= 0.5 && Math.abs(t.x) < 1e-3 && Math.abs(t.y) < 1e-3
    && source.width * (t.scale / 100) >= comp.width - 0.5 && source.height * (t.scale / 100) >= comp.height - 0.5;
};

/**
 * The host track: the lowest visible video track with footage on it that is not one of the
 * roast tracks (a background placed under the host must not become the host).
 */
export function hostTrackOf(comp: Comp, assets?: AssetMap): Track | undefined {
  return tracksOf(comp, 'video').find((track) => !track.hidden && !isRoastVideoTrack(track)
    && comp.clips.some((clip) => clip.trackId === track.id && clip.enabled && isPicture(clip) && !roastIdOf(clip)
      && (clip.source.type !== 'media' || assets?.get(clip.source.assetId)?.kind !== 'audio')));
}

/** Whether a picture clip replaces the whole frame (a cutaway), from its static transform. */
export function isFullFrame(clip: Clip, comp: Comp, assets?: AssetMap, project?: Project): boolean {
  if (!clip.enabled || clip.adjustment || clip.mask || clip.rotoMatte) return false;
  if (clip.appliedEffects?.some((effect) => effect.enabled && /key|extract/i.test(effect.effectId))) return false;
  if (clip.transform.opacity < 99.5 || Math.abs(clip.transform.rotation) > 0.5) return false;
  let width = comp.width;
  let height = comp.height;
  const source = clip.source;
  if (source.type === 'media') {
    const asset = assets?.get(source.assetId);
    if (asset?.kind === 'audio') return false;
    if (asset?.width && asset.height) {
      width = asset.width;
      height = asset.height;
    }
  } else if (source.type === 'item') {
    const item = project?.items.find((entry) => entry.id === source.itemId);
    if (item?.kind === 'adjustment-layer' || item?.kind === 'transparent-video') return false;
  } else if (source.type !== 'comp') return false;
  const place = placement(clip.transform, width, height, comp.width, comp.height);
  const t = clip.transform;
  const left = place.left + (t.cropLeft / 100) * place.width;
  const right = place.left + place.width - (t.cropRight / 100) * place.width;
  const top = place.top + (t.cropTop / 100) * place.height;
  const bottom = place.top + place.height - (t.cropBottom / 100) * place.height;
  const slack = 0.5;
  return left <= slack && top <= slack && right >= comp.width - slack && bottom >= comp.height - slack;
}

// ─── Measuring ────────────────────────────────────────────────────────────────────────────────

const MOTION_PROPS: KeyframedProperty[] = ['x', 'y', 'scale', 'rotation'];
/** Keyframe motion closer than this is one event (a punch-in and its release, a shake). */
const MOTION_GAP = 2;
/** A cut and a beat within this many seconds are on the beat (the study's ±70 ms). */
const BEAT_WINDOW = 0.07;

export type DnaOptions = {
  /** Beat times (timeline seconds) of the music; enables `onBeat`. */
  beats?: number[];
  /** Resolves item sources (colour mattes vs adjustment layers) for the full-frame test. */
  project?: Project;
};

/** The pieces the numbers are made from, for the validator and QA (dead zones, event list). */
export type DnaTrace = {
  host: Track | undefined;
  duration: number;
  cutTimes: number[];
  events: (TimedSpan & { label: string })[];
  /** Spans where a full-frame cutaway covers the host. */
  cutaways: TimedSpan[];
  /** Host-only spans with no cut and no event edge, longest first. */
  statics: TimedSpan[];
};

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** Sorted, de-duplicated times (within half a frame). */
function uniqueTimes(times: number[], tolerance: number): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (const time of sorted) if (!out.length || time - out[out.length - 1] > tolerance) out.push(time);
  return out;
}

/** Counts per 60 s bin; a shorter last bin is scaled up to a per-minute rate. */
export function perMinute(times: number[], duration: number): number[] {
  const bins = Math.max(1, Math.ceil(duration / 60 - 1e-9));
  const counts = new Array<number>(bins).fill(0);
  for (const time of times) {
    if (time < 0 || time > duration + 1e-9) continue;
    counts[Math.min(bins - 1, Math.floor(time / 60))]++;
  }
  const lastLength = duration - (bins - 1) * 60;
  if (lastLength > 1e-6 && lastLength < 60 - 1e-6) counts[bins - 1] = round((counts[bins - 1] * 60) / lastLength, 2);
  return counts;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function union(spans: TimedSpan[]): TimedSpan[] {
  const sorted = [...spans].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const out: TimedSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end + 1e-6) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

/** Motion spans of a clip's x/y/scale/rotation keyframes (timeline seconds), merged across properties. */
function motionSpans(clip: Clip): TimedSpan[] {
  const segments: TimedSpan[] = [];
  for (const property of MOTION_PROPS) {
    const keys = [...clip.keyframes[property]].sort((a, b) => a.time - b.time);
    for (let index = 1; index < keys.length; index++) {
      if (Math.abs(keys[index].value - keys[index - 1].value) < 1e-6) continue;
      segments.push({ start: clip.start + keys[index - 1].time, end: clip.start + keys[index].time });
    }
  }
  segments.sort((a, b) => a.start - b.start);
  const merged: TimedSpan[] = [];
  for (const span of segments) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + MOTION_GAP) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged.map((span) => ({ start: Math.max(clip.start, span.start), end: Math.min(clipEnd(clip), span.end) }));
}

const isAudioTrackNamed = (track: Track | undefined, pattern: RegExp) => !!track && track.kind === 'audio' && pattern.test(track.name.trim());

/** Everything `timelineDna` counts, with the times behind each number. */
export function traceDna(comp: Comp, assets?: AssetMap, options: DnaOptions = {}): DnaTrace {
  const duration = compDuration(comp);
  const tolerance = 0.5 / Math.max(1, comp.fps);
  const host = hostTrackOf(comp, assets);
  const video = tracksOf(comp, 'video');
  const hostIndex = host ? video.findIndex((track) => track.id === host.id) : -1;
  const above = new Set(video.filter((track, index) => index > hostIndex && !track.hidden).map((track) => track.id));
  const enabled = comp.clips.filter((clip) => clip.enabled);

  const points: number[] = [];
  const cutaways: TimedSpan[] = [];
  for (const clip of enabled) {
    if (host && clip.trackId === host.id && isPicture(clip)) points.push(clip.start, clipEnd(clip));
    else if (above.has(clip.trackId) && ((isPicture(clip) && isFullFrame(clip, comp, assets, options.project)) || (!clip.adjustment && !clip.mask && isSolid(clip, comp)))) {
      points.push(clip.start, clipEnd(clip));
      cutaways.push({ start: clip.start, end: clipEnd(clip) });
    }
  }
  const cutTimes = uniqueTimes(points, tolerance).filter((time) => time > tolerance && time < duration - tolerance);

  // Events: a roast event is one event however many clips it made; other overlays count per clip.
  const events: (TimedSpan & { label: string })[] = [];
  const byRoastId = new Map<string, TimedSpan & { label: string }>();
  const videoIds = new Set(video.filter((track) => !track.hidden).map((track) => track.id));
  for (const clip of enabled) {
    if (!videoIds.has(clip.trackId)) continue;
    const id = roastIdOf(clip);
    if (id) {
      const span = byRoastId.get(id);
      if (span) {
        span.start = Math.min(span.start, clip.start);
        span.end = Math.max(span.end, clipEnd(clip));
      } else byRoastId.set(id, { start: clip.start, end: clipEnd(clip), label: clip.name ?? id });
      continue;
    }
    const overlay = clip.source.type === 'text' || clip.source.type === 'html' || clip.source.type === 'motion' || clip.source.type === 'shape' || clip.source.type === 'scene3d';
    if (above.has(clip.trackId) && !clip.adjustment && (overlay || (isPicture(clip) && !isFullFrame(clip, comp, assets, options.project)))) {
      events.push({ start: clip.start, end: clipEnd(clip), label: clip.name ?? clip.source.type });
    }
  }
  events.push(...byRoastId.values());
  if (host) {
    for (const clip of enabled) {
      if (clip.trackId !== host.id) continue;
      for (const span of motionSpans(clip)) events.push({ ...span, label: `motion on ${clip.name ?? 'host'}` });
    }
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end);

  // Static spans: between consecutive cuts / event edges, where the host is what is on screen.
  const edges = uniqueTimes([0, duration, ...cutTimes, ...events.flatMap((event) => [event.start, event.end])].map((time) => Math.min(duration, Math.max(0, time))), tolerance);
  const covered = union(cutaways);
  const statics: TimedSpan[] = [];
  for (let index = 1; index < edges.length; index++) {
    const span = { start: edges[index - 1], end: edges[index] };
    const mid = (span.start + span.end) / 2;
    if (covered.some((cover) => mid >= cover.start && mid < cover.end)) continue;
    statics.push(span);
  }
  statics.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  return { host, duration, cutTimes, events, cutaways: covered, statics };
}

/** Host-only stretches longer than `maxSeconds`, in timeline order (the validator's dead zones). */
export function deadZones(comp: Comp, maxSeconds: number, assets?: AssetMap, options: DnaOptions = {}): TimedSpan[] {
  return traceDna(comp, assets, options).statics.filter((span) => span.end - span.start > maxSeconds + 1e-6).sort((a, b) => a.start - b.start);
}

/** The Edit DNA of a comp, read from its clips. `onBeat` needs `options.beats`; `greenShare` is file-only. */
export function timelineDna(comp: Comp, assets?: AssetMap, options: DnaOptions = {}): EditDna {
  const trace = traceDna(comp, assets, options);
  const { duration, cutTimes, events } = trace;
  const edges = [0, ...cutTimes, duration];
  const shots = edges.slice(1).map((time, index) => time - edges[index]).filter((length) => length > 1e-6);
  const longest = trace.statics[0] ?? { start: 0, end: 0 };

  const trackById = new Map(comp.tracks.map((track) => [track.id, track]));
  const audible = comp.clips.filter((clip) => clip.enabled && trackById.get(clip.trackId)?.kind === 'audio' && !trackById.get(clip.trackId)?.muted);
  const sfx = audible.filter((clip) => clip.source.type === 'sfx' || clip.audioType === 'sfx' || isAudioTrackNamed(trackById.get(clip.trackId), /^SFX\b/i));
  const music = union(audible
    .filter((clip) => clip.audioType === 'music' || isAudioTrackNamed(trackById.get(clip.trackId), /^Music\b/i))
    .map((clip) => ({ start: clip.start, end: clipEnd(clip) })));
  const musicSeconds = music.reduce((sum, span) => sum + Math.min(span.end, duration) - Math.max(0, span.start), 0);

  let onBeat: number | null = null;
  if (options.beats?.length && music.length) {
    const inMusic = cutTimes.filter((time) => music.some((span) => time >= span.start && time <= span.end));
    if (inMusic.length) onBeat = round(inMusic.filter((time) => options.beats?.some((beat) => Math.abs(beat - time) <= BEAT_WINDOW)).length / inMusic.length, 3);
  }

  // Memes: distinct cutaways on the Memes tracks (a blur-filled meme is one meme, not two clips).
  const memeTracks = new Set(comp.tracks.filter((track) => track.kind === 'video' && (track.name.trim() === ROAST_TRACK.memes)).map((track) => track.id));
  const memeKeys = new Set(comp.clips.filter((clip) => clip.enabled && memeTracks.has(clip.trackId) && isPicture(clip)).map((clip) => roastIdOf(clip) ?? clip.id));
  // Text: a receipt's word-by-word captions are one text event; other text clips count each.
  const textKeys = new Set(comp.clips.filter((clip) => clip.enabled && clip.source.type === 'text' && trackById.get(clip.trackId)?.kind === 'video').map((clip) => roastIdOf(clip) ?? clip.id));

  return {
    duration: round(duration),
    cuts: cutTimes.length,
    cutsPerMinute: perMinute(cutTimes, duration),
    medianShot: round(median(shots)),
    longestStatic: { start: round(longest.start), end: round(longest.end), seconds: round(longest.end - longest.start) },
    eventsPerMinute: perMinute(events.map((event) => event.start), duration),
    sfxPerMinute: perMinute(sfx.map((clip) => clip.start), duration),
    musicCoverage: duration > 0 ? round(musicSeconds / duration) : 0,
    onBeat,
    memes: memeKeys.size,
    textEvents: textKeys.size,
    greenShare: null,
  };
}

// ─── Judging ──────────────────────────────────────────────────────────────────────────────────

const minuteLabel = (index: number) => `minute ${index + 1}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Length of bin `index` of an edit `duration` seconds long. */
const binLength = (index: number, duration: number) => Math.min(60, Math.max(0, duration - index * 60));

/**
 * Where an edit falls outside a band, most serious first. `block` stops hand-back (a dead zone,
 * an unkeyed green screen); `fix` is a clear miss the edit should correct; `note` is advice.
 */
export function compareDna(dna: EditDna, band: DnaBand): DnaFinding[] {
  const findings: DnaFinding[] = [];
  const { longestStatic } = dna;
  if (longestStatic.seconds > band.maxStaticSeconds) {
    findings.push({
      metric: 'longestStatic', severity: 'block',
      message: `Dead zone: ${round(longestStatic.seconds, 1)} s of host with no cut or event (${clock(longestStatic.start)}–${clock(longestStatic.end)}); the band allows ${band.maxStaticSeconds} s. Add a zoom punch, keyword pop, cutaway or jump cut inside it.`,
      at: { start: longestStatic.start, end: longestStatic.end },
    });
  }
  if (dna.greenShare !== null && dna.greenShare > 0.02) {
    findings.push({ metric: 'greenShare', severity: dna.greenShare > 0.2 ? 'block' : 'fix', message: `${Math.round(dna.greenShare * 100)} % of frames show an unkeyed green backdrop; key the host (key_green_screen) and put it on a background.` });
  }
  // Only bins at least 20 s long are judged; a short tail says little about pace.
  const judged = (index: number) => binLength(index, dna.duration) >= 20;
  dna.cutsPerMinute.forEach((count, index) => {
    if (!judged(index)) return;
    if (index < 3 && count < band.cutsPerMinuteEarly[0]) {
      findings.push({ metric: 'cutsPerMinute', severity: 'fix', message: `${minuteLabel(index)}: ${count} cuts; the opening minutes want ${band.cutsPerMinuteEarly[0]}–${band.cutsPerMinuteEarly[1]}.`, at: { start: index * 60, end: index * 60 + binLength(index, dna.duration) } });
    } else if (index >= 3 && count < band.cutsPerMinuteFloor) {
      findings.push({ metric: 'cutsPerMinute', severity: 'fix', message: `${minuteLabel(index)}: ${count} cuts, below the floor of ${band.cutsPerMinuteFloor} a minute.`, at: { start: index * 60, end: index * 60 + binLength(index, dna.duration) } });
    } else if (index < 3 && count > band.cutsPerMinuteEarly[1]) {
      findings.push({ metric: 'cutsPerMinute', severity: 'note', message: `${minuteLabel(index)}: ${count} cuts, busier than the ${band.cutsPerMinuteEarly[1]} a minute the reference peaks at.` });
    }
  });
  if (dna.cuts > 0 && dna.medianShot > band.medianShot[1]) {
    findings.push({ metric: 'medianShot', severity: 'fix', message: `Median shot ${round(dna.medianShot, 2)} s; aim for ${band.medianShot[0]}–${band.medianShot[1]} s.` });
  } else if (dna.cuts > 0 && dna.medianShot < band.medianShot[0]) {
    findings.push({ metric: 'medianShot', severity: 'note', message: `Median shot ${round(dna.medianShot, 2)} s is quicker than the ${band.medianShot[0]} s the reference holds; make sure punchlines still get room.` });
  }
  const thinEvents = dna.eventsPerMinute.map((count, index) => ({ count, index })).filter(({ count, index }) => judged(index) && count < band.eventsPerMinuteFloor);
  if (thinEvents.length) {
    findings.push({ metric: 'eventsPerMinute', severity: 'fix', message: `Few on-screen events in ${thinEvents.map(({ count, index }) => `${minuteLabel(index)} (${count})`).join(', ')}; the floor is ${band.eventsPerMinuteFloor} a minute (keyword pops, zooms, cutouts, cards).` });
  }
  // A file measured without voice/music separation has no audio numbers to judge (they read as 0).
  if (dna.audioMeasured === false) {
    findings.push({ metric: 'musicCoverage', severity: 'note', message: `Sound was not measured${dna.notes?.length ? ` (${dna.notes[0]})` : ''}; only the picture is judged.` });
  } else {
    const sfxMinutes = dna.sfxPerMinute.filter((_, index) => judged(index));
    if (sfxMinutes.length) {
      const mean = sfxMinutes.reduce((sum, count) => sum + count, 0) / sfxMinutes.length;
      if (mean < band.sfxPerMinute[0]) findings.push({ metric: 'sfxPerMinute', severity: 'fix', message: `${round(mean, 1)} sound effects a minute; every entry and pop wants one (${band.sfxPerMinute[0]}–${band.sfxPerMinute[1]} a minute).` });
      else if (mean > band.sfxPerMinute[1]) findings.push({ metric: 'sfxPerMinute', severity: 'fix', message: `${round(mean, 1)} sound effects a minute is cluttered; keep to ${band.sfxPerMinute[0]}–${band.sfxPerMinute[1]}.` });
    }
    if (dna.musicCoverage > band.musicCoverage[1]) {
      findings.push({ metric: 'musicCoverage', severity: 'fix', message: `Music under ${Math.round(dna.musicCoverage * 100)} % of the runtime reads as a constant bed, which flattens punchlines; use stingers under bits (${Math.round(band.musicCoverage[0] * 100)}–${Math.round(band.musicCoverage[1] * 100)} %).` });
    } else if (dna.musicCoverage < band.musicCoverage[0]) {
      findings.push({ metric: 'musicCoverage', severity: 'note', message: `Music under ${Math.round(dna.musicCoverage * 100)} % of the runtime; stingers under cutaways and bits usually cover ${Math.round(band.musicCoverage[0] * 100)}–${Math.round(band.musicCoverage[1] * 100)} %.` });
    }
    if (dna.onBeat !== null && dna.onBeat < band.onBeatFloor) {
      findings.push({ metric: 'onBeat', severity: 'fix', message: `${Math.round(dna.onBeat * 100)} % of cuts inside music land on a beat; aim for ${Math.round(band.onBeatFloor * 100)} % or more (snap cuts to beats).` });
    }
  }
  if (dna.duration >= 60 && dna.memes === 0) findings.push({ metric: 'memes', severity: 'note', message: 'No meme cutaways yet.' });
  if (dna.duration >= 60 && dna.textEvents === 0) findings.push({ metric: 'textEvents', severity: 'note', message: 'No keyword text on the host; 1–3 stressed words every 10–20 s.' });
  const rank = { block: 0, fix: 1, note: 2 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
