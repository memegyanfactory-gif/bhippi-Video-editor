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

export type Line = { start: number; end: number; text: string; speaker?: number };

/** A pause at least this long starts a new line. */
const PAUSE = 0.8;
/** Lines break after a sentence end once they are this long, and anywhere past twice it. */
const SOFT_CHARS = 70;

/** Words grouped into lines at pauses, sentence ends and speaker changes. */
export function toLines(words: TranscriptWord[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (const word of words) {
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
      current = { start: word.start, end: word.end, text, speaker: word.speaker };
    } else {
      current.text = /^[,.!?;:…%)\]]/.test(text) ? `${current.text}${text}` : `${current.text} ${text}`;
      current.end = word.end;
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
  return wordsOnTimeline(comp, assets, byAsset).map((word) => ({ text: word.word, start: word.start, end: word.end }));
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
  return speakers.size > 1 ? words : words.map((word) => ({ text: word.text, start: word.start, end: word.end }));
}
