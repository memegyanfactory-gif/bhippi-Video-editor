// One-click clean-ups for talking-head edits: cut the silences (from the audio levels Bhippi already
// keeps for waveforms, so no transcription is needed) and the filler words (from the transcript).
// Both return timeline ranges to extract, latest first, so each cut leaves the earlier ones where
// they were and the whole clean-up is one undo step.
import { BUCKETS_PER_SECOND, type Peaks } from './peaks';
import { audible, clipEnd, type AssetMap } from './timeline';
import type { TranscriptWord } from './ipc';
import type { Clip, Comp } from './types';

export type Range = { start: number; end: number };

/** Hesitations nobody means to say. "like", "you know" and "so" are left alone: they are often meant. */
const FILLERS = new Set(['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'ah', 'ahh', 'hmm', 'mm', 'mhm']);

/** Which of `words` are filler words. */
export function fillerIndices(words: TranscriptWord[]): Set<number> {
  const out = new Set<number>();
  words.forEach((word, index) => {
    if (FILLERS.has(word.text.toLowerCase().replace(/[^a-z]/g, ''))) out.add(index);
  });
  return out;
}

export type SilenceOptions = {
  /** Quieter than this (dBFS, rms) counts as silence. */
  thresholdDb?: number;
  /** Only pauses at least this long are cut, seconds. */
  minSilence?: number;
  /** Kept either side of a cut so words are not clipped, seconds. */
  pad?: number;
};
export const SILENCE_DEFAULTS: Required<SilenceOptions> = { thresholdDb: -38, minSilence: 0.6, pad: 0.15 };

/** Clips whose sound is speech: audible media on audio tracks (music and effects are not speech). */
export function speechClips(comp: Comp): Clip[] {
  return comp.clips.filter((clip) => {
    if (!clip.enabled || clip.source.type !== 'media' || clip.audioType === 'music' || clip.audioType === 'sfx') return false;
    const track = comp.tracks.find((item) => item.id === clip.trackId);
    return !!track && track.kind === 'audio' && audible(comp, track);
  });
}

/**
 * The pauses to cut, on the timeline: stretches where every speech clip playing is quieter than
 * the threshold for at least `minSilence`, less `pad` either side. Only time covered by speech
 * counts — a stretch of B-roll with no dialogue is never cut.
 */
export function silentRanges(comp: Comp, assets: AssetMap, peaksOf: (assetId: string) => Peaks | null, options: SilenceOptions = {}): Range[] {
  const { thresholdDb, minSilence, pad } = { ...SILENCE_DEFAULTS, ...options };
  const floor = 10 ** (thresholdDb / 20) * 255;
  const step = 1 / BUCKETS_PER_SECOND;
  const covered: Range[] = [];
  const voiced: Range[] = [];
  for (const clip of speechClips(comp)) {
    const assetId = (clip.source as { assetId: string }).assetId;
    const peaks = peaksOf(assetId);
    if (!assets.get(assetId) || !peaks) continue;
    covered.push({ start: clip.start, end: clipEnd(clip) });
    const speed = clip.speed || 1;
    // Walk the clip in timeline steps; mark where it has sound.
    let from: number | null = null;
    const steps = Math.ceil(clip.duration / step - 1e-9);
    for (let index = 0; index < steps; index++) {
      // Counted, not summed: adding up 0.01 s steps drifts.
      const t = clip.start + index * step;
      const source = clip.reverse ? clip.in + (clipEnd(clip) - t) * speed : clip.in + (t - clip.start) * speed;
      const bucket = Math.floor(source * BUCKETS_PER_SECOND);
      const loud = bucket >= 0 && bucket < peaks.buckets && peaks.data[bucket * 2 + 1] > floor;
      if (loud && from === null) from = t;
      if (!loud && from !== null) { voiced.push({ start: from, end: t }); from = null; }
    }
    if (from !== null) voiced.push({ start: from, end: clipEnd(clip) });
  }
  const quiet = subtract(merge(covered), merge(voiced));
  return quiet
    .filter((range) => range.end - range.start >= minSilence)
    .map((range) => ({ start: range.start + pad, end: range.end - pad }))
    .filter((range) => range.end - range.start > 0.05)
    .sort((a, b) => b.start - a.start);
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end + 1e-6) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function subtract(base: Range[], minus: Range[]): Range[] {
  const out: Range[] = [];
  for (const range of base) {
    let pieces = [range];
    for (const cut of minus) {
      pieces = pieces.flatMap((piece) => {
        if (cut.end <= piece.start || cut.start >= piece.end) return [piece];
        return [{ start: piece.start, end: cut.start }, { start: cut.end, end: piece.end }].filter((part) => part.end - part.start > 1e-6);
      });
    }
    out.push(...pieces);
  }
  return out;
}
