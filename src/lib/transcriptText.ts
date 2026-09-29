// Transcripts as readable text: grouped into lines, placed on the timeline, formatted for copying.
//
// A transcript is words with source times (transcribe.rs). The Transcription panel shows either
// one file's words as recorded, or what is said in the edit — each audio clip's slice of its
// source, at the clip's place on the timeline — so a talking head cut into thirty pieces reads as
// the finished cut, not as the raw recording.

import type { Transcript, TranscriptWord } from './ipc';
import { wordsOnTimeline } from './subtitlesEngine';
import type { AssetMap } from './timeline';
import { timecode } from './editor';
import type { Comp } from './types';

/** A line of the transcript; `words` are its words with their place in the list `toLines` was given. */
export type Line = { start: number; end: number; text: string; speaker?: number; words: { text: string; index: number }[] };

/** A pause at least this long starts a new line. */
const PAUSE = 0.8;
/** Lines break after a sentence end once they are this long, and anywhere past twice it. */
const SOFT_CHARS = 70;

/** Words grouped into lines at pauses, sentence ends and speaker changes. */
export function toLines(words: TranscriptWord[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (const [index, word] of words.entries()) {
    const text = word.text.trim();
    if (!text) continue;
    const breakHere = current && (
      word.start - current.end >= PAUSE
      || (word.speaker !== undefined && current.speaker !== undefined && word.speaker !== current.speaker)
      || (current.text.length >= SOFT_CHARS && /[.!?…]["')\]]?$/.test(current.text))
      || current.text.length >= SOFT_CHARS * 2
    );
    if (!current || breakHere) {
      if (current) lines.push(current);
      current = { start: word.start, end: word.end, text, speaker: word.speaker, words: [{ text, index }] };
    } else {
      current.text = /^[,.!?;:…%)\]]/.test(text) ? `${current.text}${text}` : `${current.text} ${text}`;
      current.end = word.end;
      current.words.push({ text, index });
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * What is said in `comp`, in timeline time — the captions' own mapping (subtitlesEngine), so the
 * panel and the captions always agree on what is said where.
 */
export function timelineWords(comp: Comp, assets: AssetMap, transcripts: ReadonlyMap<string, Transcript>): TranscriptWord[] {
  const byAsset = new Map([...transcripts].map(([id, transcript]) => [id, transcript.words]));
  return wordsOnTimeline(comp, assets, byAsset).map((word) => ({ text: word.word, start: word.start, end: word.end, ...(word.origin ? { origin: word.origin } : {}) }));
}

/** Plain text for the clipboard or a .txt file. */
export function formatTranscript(lines: Line[], options: { timestamps: boolean; fps: number; title?: string }): string {
  const body = lines.map((line) => {
    const who = line.speaker !== undefined ? `Speaker ${line.speaker + 1}: ` : '';
    return options.timestamps ? `[${timecode(line.start, options.fps)}] ${who}${line.text}` : `${who}${line.text}`;
  });
  const text = options.timestamps ? body.join('\n') : joinParagraphs(lines, body);
  return options.title ? `${options.title}\n\n${text}\n` : `${text}\n`;
}

/** Without timecodes, lines run together into paragraphs, broken at long pauses. */
function joinParagraphs(lines: Line[], body: string[]): string {
  let out = '';
  body.forEach((text, index) => {
    if (index === 0) out = text;
    else out += lines[index].start - lines[index - 1].end >= PAUSE * 2 || lines[index].speaker !== lines[index - 1].speaker ? `\n\n${text}` : ` ${text}`;
  });
  return out;
}

/** A file name that is safe on every platform. */
export const transcriptFileName = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'transcript'} — transcript.txt`;

/** Speaker ids matter only when there is more than one voice; one speaker needs no label. */
export function withoutSoloSpeaker(words: TranscriptWord[]): TranscriptWord[] {
  const speakers = new Set(words.map((word) => word.speaker).filter((speaker) => speaker !== undefined));
  return speakers.size > 1 ? words : words.map((word) => ({ text: word.text, start: word.start, end: word.end, ...(word.origin ? { origin: word.origin } : {}) }));
}

/**
 * The timeline ranges that cutting the chosen words removes, latest first (so each cut leaves the
 * earlier ones where they were). A run of chosen words is cut from its first word's start to where
 * the next word starts, taking the pause after it too, so the edit keeps the speaker's rhythm; the
 * last words of the transcript are cut to their own end.
 */
export function cutRangesForWords(words: TranscriptWord[], chosen: ReadonlySet<number>): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let index = 0;
  while (index < words.length) {
    if (!chosen.has(index)) { index++; continue; }
    const first = index;
    while (index + 1 < words.length && chosen.has(index + 1)) index++;
    const next = words[index + 1];
    ranges.push({ start: words[first].start, end: next ? Math.max(words[index].end, next.start) : words[index].end });
    index++;
  }
  return ranges.sort((a, b) => b.start - a.start);
}

const bare = (token: string) => token.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * The caption clips of `comp` with a word the user corrected in the transcript: in each caption
 * on screen at the word's timeline time (`at`), the first word that reads `from` (ignoring case and
 * punctuation, which stays) becomes `to`. `comp` itself when no caption had it.
 */
export function correctCaptions(comp: Comp, at: number, from: string, to: string): Comp {
  const want = bare(from);
  if (!want || bare(to) === want && from.trim() === to.trim()) return comp;
  let changed = false;
  const clips = comp.clips.map((clip) => {
    if (clip.source.type !== 'text' || clip.source.preset !== 'caption' || at < clip.start - 0.05 || at > clip.start + clip.duration + 0.05) return clip;
    const tokens = clip.source.text.split(/(\s+)/);
    const index = tokens.findIndex((token) => bare(token) === want);
    if (index < 0) return clip;
    const token = tokens[index];
    const lead = /^[^\p{L}\p{N}']*/u.exec(token)?.[0] ?? '';
    const tail = /[^\p{L}\p{N}']*$/u.exec(token)?.[0] ?? '';
    tokens[index] = to.trim() ? `${lead}${to.trim()}${tail}` : '';
    changed = true;
    return { ...clip, source: { ...clip.source, text: tokens.join('').replace(/\s{2,}/g, ' ').trim() } };
  });
  return changed ? { ...comp, clips } : comp;
}
