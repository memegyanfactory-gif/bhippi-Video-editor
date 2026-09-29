// Captions out as files: SubRip (.srt) and WebVTT (.vtt), from a comp's caption clips. For uploads
// (YouTube, Vimeo and every social site take SRT) and for players, next to an export or on their own.
import { clipEnd } from './timeline';
import type { Comp } from './types';

export type CaptionCue = { start: number; end: number; text: string };

/**
 * The comp's captions as cues, in time order: every enabled caption clip, clipped to `range`
 * and shifted so the range starts at 0 (an In→Out export's captions line up with its video).
 */
export function captionCues(comp: Comp, range?: { start: number; end: number } | null): CaptionCue[] {
  const from = range?.start ?? 0;
  const to = range?.end ?? Infinity;
  return comp.clips
    .filter((clip) => clip.enabled && clip.source.type === 'text' && clip.source.preset === 'caption' && clipEnd(clip) > from && clip.start < to)
    .map((clip) => ({ start: Math.max(clip.start, from) - from, end: Math.min(clipEnd(clip), to) - from, text: (clip.source as { text: string }).text.trim() }))
    .filter((cue) => cue.text && cue.end - cue.start > 0.01)
    .sort((a, b) => a.start - b.start);
}

const stamp = (seconds: number, separator: ',' | '.') => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
};

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}\n`).join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}\n`).join('\n')}`;
}
