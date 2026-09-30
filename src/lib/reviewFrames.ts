// Where to look, and what to measure, when reviewing an edit (review_frames in aiTools.ts).
//
// The films that scored well were made in a render → look → fix loop: frames at the moments
// something happens (a cut, a graphic landing, a click, a sound cue), strips 0.06 s apart across
// every join, and a few numbers the critics measured by hand (how light the frame is, the same
// phrase on screen twice, cuts off the beat, cues nobody can hear under the music, an end card
// that leaves too soon). This file picks the moments and does the measuring, as plain arithmetic
// over the project; aiTools.ts renders the frames and tiles them into one contact sheet.
import { clipEnd, tracksOf } from './timeline';
import type { Clip, Comp, Project } from './types';
import type { QaLayer } from './production';

export type Moment = { at: number; why: string };
export type Finding = { at: number | null; kind: 'dark' | 'repeated-phrase' | 'off-beat' | 'quiet-cue' | 'short-end'; what: string; fix: string };

const round = (value: number) => Math.round(value * 100) / 100;
/** Two moments closer than this show the same frame. */
const SAME = 0.08;
/** Spacing of the frames across a join, as in the films' own join checks. */
export const JOIN_STEP = 0.06;

const visibleVideo = (comp: Comp) => new Set(tracksOf(comp, 'video').filter((track) => !track.hidden).map((track) => track.id));

/** Clips that are graphics or words landing on the frame (not footage). */
const isGraphic = (project: Project, clip: Clip) => {
  const source = clip.source;
  if (source.type === 'text' || source.type === 'motion' || source.type === 'html' || source.type === 'scene3d' || source.type === 'shape') return true;
  return source.type === 'comp' && !!project.comps.find((comp) => comp.id === source.compId)?.name.startsWith('[Motion]');
};

/** Cut times on the picture: where one clip ends and another starts on a visible video track. */
export function cutTimes(comp: Comp, from = 0, to = Infinity): number[] {
  const tracks = visibleVideo(comp);
  const clips = comp.clips.filter((clip) => clip.enabled && tracks.has(clip.trackId));
  const cuts = new Set<number>();
  for (const clip of clips) {
    const end = clipEnd(clip);
    if (clips.some((other) => other !== clip && other.trackId === clip.trackId && Math.abs(other.start - end) < 1 / Math.max(1, comp.fps))) cuts.add(round(end));
  }
  return [...cuts].filter((t) => t > from && t < to).sort((a, b) => a - b);
}

/** The sound cues of a motion scene placed on the comp, directly or one layered comp down, in timeline seconds. */
function sceneCues(project: Project, comp: Comp): Moment[] {
  const out: Moment[] = [];
  const add = (clip: Clip, offset: number) => {
    if (clip.source.type !== 'motion') return;
    for (const cue of clip.source.scene.cues ?? []) {
      const at = offset + clip.start + (cue.at - clip.in) / Math.max(0.01, clip.speed);
      if (at >= offset + clip.start && at < offset + clipEnd(clip)) out.push({ at: round(at), why: `cue ${cue.sound}` });
    }
  };
  for (const clip of comp.clips) {
    if (!clip.enabled) continue;
    add(clip, 0);
    if (clip.source.type === 'comp') {
      const nested = project.comps.find((item) => item.id === (clip.source as { compId: string }).compId);
      // A nested clip's time maps through its holder: holder start minus holder in point.
      for (const inner of nested?.clips ?? []) if (inner.enabled) add(inner, clip.start - clip.in);
    }
  }
  return out;
}

/**
 * The moments worth a frame: each graphic as it lands (0.4 s in), each cut just after it, every
 * sound cue, every marker, and the last frame. Close moments merge; past `limit` they are thinned
 * evenly, cuts and cues first to stay.
 */
export function eventMoments(project: Project, comp: Comp, from: number, to: number, limit = 24): Moment[] {
  const tracks = visibleVideo(comp);
  const all: (Moment & { rank: number })[] = [];
  for (const cut of cutTimes(comp, from, to)) all.push({ at: round(cut + 0.03), why: 'cut', rank: 0 });
  for (const cue of sceneCues(project, comp)) all.push({ ...cue, rank: 0 });
  for (const clip of comp.clips) {
    if (!clip.enabled || !tracks.has(clip.trackId) || !isGraphic(project, clip)) continue;
    const at = round(Math.min(clip.start + 0.4, clipEnd(clip) - 0.05));
    const name = clip.name ?? (clip.source.type === 'text' ? clip.source.text : clip.source.type);
    all.push({ at, why: `lands: ${name.slice(0, 28)}`, rank: 1 });
  }
  for (const marker of comp.markers) all.push({ at: round(marker.time), why: `marker${marker.name ? `: ${marker.name.slice(0, 24)}` : ''}`, rank: 1 });
  const lastFrame = round(to - 1 / Math.max(1, comp.fps));
  all.push({ at: lastFrame, why: 'last frame', rank: 0 });
  const inRange = all.filter((moment) => moment.at >= from && moment.at <= to).sort((a, b) => a.at - b.at || a.rank - b.rank);
  const merged: typeof inRange = [];
  for (const moment of inRange) {
    const last = merged[merged.length - 1];
    if (last && moment.at - last.at < SAME) { if (!last.why.includes(moment.why)) last.why = `${last.why} + ${moment.why}`; continue; }
    merged.push({ ...moment });
  }
  if (merged.length <= limit) return merged.map(({ at, why }) => ({ at, why }));
  const keep = [...merged].sort((a, b) => a.rank - b.rank || a.at - b.at);
  const chosen = new Set(keep.filter((moment) => moment.rank === 0).slice(0, limit));
  const rest = keep.filter((moment) => !chosen.has(moment));
  const stride = rest.length / Math.max(1, limit - chosen.size);
  for (let i = 0; chosen.size < limit && i < rest.length; i += Math.max(1, stride)) chosen.add(rest[Math.floor(i)]);
  return [...chosen].sort((a, b) => a.at - b.at).map(({ at, why }) => ({ at, why }));
}

/** Six frames 0.06 s apart across each of the first `joins` cuts: what a viewer sees happen at a join. */
export function joinStrips(comp: Comp, from: number, to: number, joins = 4): Moment[][] {
  return cutTimes(comp, from, to).slice(0, joins).map((cut) =>
    [-2, -1, 0, 1, 2, 3].map((k) => ({ at: round(Math.max(from, Math.min(to - 0.01, cut + k * JOIN_STEP))), why: k === 0 ? `cut ${cut.toFixed(2)}` : `${k > 0 ? '+' : ''}${(k * JOIN_STEP).toFixed(2)}` })));
}

/** A frame too dark to read: the 15 s film's first cut averaged 8% brightness where the reference sat near 68%. */
export function darkFinding(at: number, mean: number): Finding | null {
  if (mean >= 0.16) return null;
  return { at, kind: 'dark', what: `the frame is only ${Math.round(mean * 100)}% bright on average: it reads as murky on a phone`, fix: 'lift the exposure: a lighter backdrop or stage, a key light on the subject, brighter UI, or less vignette' };
}

/** The same words on screen twice at once (a title over its own caption, a doubled layer). */
export function repeatedPhrases(layers: QaLayer[], times: number[]): Finding[] {
  const words = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const t of times) {
    const onScreen = layers.filter((layer) => (layer.kind === 'text' || layer.kind === 'caption') && t >= layer.from && t < layer.to + 1e-3);
    const counts = new Map<string, number>();
    for (const layer of onScreen) {
      const phrase = words(layer.name);
      if (phrase.split(' ').length < 2) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
    for (const [phrase, count] of counts) {
      if (count < 2 || seen.has(phrase)) continue;
      seen.add(phrase);
      out.push({ at: t, kind: 'repeated-phrase', what: `"${phrase}" is on screen ${count} times at once`, fix: 'keep one copy: drop the caption under a title that says the same, or the duplicate layer' });
    }
  }
  return out;
}

/** How far the picture cuts sit from the beat: cuts more than `tolerance` off it are listed. */
export function offBeatCuts(cuts: number[], beats: number[], tolerance = 0.07): Finding[] {
  if (!beats.length) return [];
  const sorted = [...beats].sort((a, b) => a - b);
  const nearest = (t: number) => sorted.reduce((best, beat) => (Math.abs(beat - t) < Math.abs(best - t) ? beat : best), sorted[0]);
  const off = cuts.map((cut) => ({ cut, delta: cut - nearest(cut) })).filter((item) => Math.abs(item.delta) > tolerance);
  if (!off.length) return [];
  const worst = off.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
  return [{ at: worst.cut, kind: 'off-beat', what: `${off.length} of ${cuts.length} cut(s) land more than ${Math.round(tolerance * 1000)} ms off the beat (worst ${Math.round(worst.delta * 1000)} ms at ${worst.cut.toFixed(2)} s)`, fix: 'snap_cuts_to_beats, or move those cuts onto the nearest beat or the 16th before it' }];
}

export type CueLevel = { at: number; name: string; db: number };

/** Sound cues that sit so far under the music at their moment that nobody hears them (the 15 s film: two-thirds 20-30 dB under). */
export function quietCues(cues: CueLevel[], musicDbAt: (t: number) => number | null, margin = 12): Finding[] {
  const quiet = cues.filter((cue) => { const music = musicDbAt(cue.at); return music !== null && cue.db < music - margin; });
  if (!quiet.length) return [];
  return [{ at: quiet[0].at, kind: 'quiet-cue', what: `${quiet.length} of ${cues.length} sound cue(s) sit more than ${margin} dB under the music at their moment (first: "${quiet[0].name}" at ${quiet[0].at.toFixed(2)} s): they cannot be heard`, fix: 'raise those cues, or duck the music around them (score_audio_clip), so each lands about 6 dB under the music peak' }];
}

/** An end card must hold: the last words or graphic should land at least `hold` seconds before the end. */
export function shortEnd(project: Project, comp: Comp, duration: number, hold = 1.5): Finding | null {
  const tracks = visibleVideo(comp);
  const lands = comp.clips.filter((clip) => clip.enabled && tracks.has(clip.trackId) && isGraphic(project, clip) && clipEnd(clip) >= duration - 0.05).map((clip) => clip.start);
  if (!lands.length) return null;
  const last = Math.max(...lands);
  if (duration - last >= hold) return null;
  return { at: round(last), kind: 'short-end', what: `the end card lands ${(duration - last).toFixed(1)} s before the end: too short to read`, fix: `hold it at least ${hold} s: start it earlier or extend the edit` };
}

/** Where a clip's source second `t` sits on the timeline, or null when outside the clip. */
export const timelineOf = (clip: Clip, source: number): number | null => {
  const t = clip.start + (source - clip.in) / Math.max(0.01, clip.speed);
  return t >= clip.start && t <= clipEnd(clip) ? t : null;
};
