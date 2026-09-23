import { describe, expect, it } from 'vitest';
import { formatTranscript, timelineWords, toLines, transcriptFileName, withoutSoloSpeaker } from '../src/lib/transcriptText';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Transcript, TranscriptWord } from '../src/lib/ipc';
import type { Asset } from '../src/lib/types';

const w = (text: string, start: number, end = start + 0.3, speaker?: number): TranscriptWord => ({ text, start, end, ...(speaker !== undefined ? { speaker } : {}) });

describe('transcript lines', () => {
  it('groups words into lines at pauses and keeps punctuation attached', () => {
    const lines = toLines([w('Hello', 0), w(',', 0.3), w('world', 0.4), w('.', 0.7), w('Next', 2.0), w('line', 2.3)]);
    expect(lines.map((line) => line.text)).toEqual(['Hello, world.', 'Next line']);
    expect(lines[1].start).toBe(2.0);
  });

  it('breaks long speech at a sentence end, and hard-breaks a run-on', () => {
    const long = Array.from({ length: 30 }, (_, i) => w(i === 14 ? 'end.' : 'word', i * 0.3));
    const lines = toLines(long);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].text.endsWith('end.')).toBe(true);
  });

  it('labels speakers only when there is more than one', () => {
    expect(withoutSoloSpeaker([w('a', 0, 0.2, 0), w('b', 0.3, 0.5, 0)]).every((word) => word.speaker === undefined)).toBe(true);
    const two = toLines(withoutSoloSpeaker([w('Hi', 0, 0.2, 0), w('there', 0.3, 0.5, 1)]));
    expect(two.map((line) => line.speaker)).toEqual([0, 1]);
  });

  it('formats with timecodes one line each, without them as paragraphs', () => {
    // "two." ends at 0.6 s; "Three" at 1.5 s is past the 0.8 s pause that starts a new line.
    const lines = toLines([w('One', 0), w('two.', 0.3), w('Three', 1.5), w('Four', 5)]);
    expect(formatTranscript(lines, { timestamps: true, fps: 30, title: 'Talk' })).toBe('Talk\n\n[00:00:00:00] One two.\n[00:00:01:15] Three\n[00:00:05:00] Four\n');
    // Without timecodes, a short pause stays in the paragraph; a long one starts the next.
    expect(formatTranscript(lines, { timestamps: false, fps: 30 })).toBe('One two. Three\n\nFour\n');
  });

  it('makes a safe file name', () => {
    expect(transcriptFileName('what: I do?')).toBe('what I do — transcript.txt');
    expect(transcriptFileName('')).toBe('transcript — transcript.txt');
  });
});

describe('the timeline view', () => {
  it('reads a jump-cut talking head as the finished cut, in timeline time', () => {
    const project = newProject();
    const comp = project.comps[0];
    const a1 = tracksOf(comp, 'audio')[0].id;
    const asset = { id: 'th', name: 'talk.mp4', kind: 'video', hasAudio: true, missing: false, duration: 60, width: 1920, height: 1080 } as Asset;
    // Source: "keep this" at 1-2 s, "cut this" at 3-4 s, "and this" at 5-6 s.
    const transcript = { assetId: 'th', provider: 'test', language: 'en', text: '', diarized: false, words: [w('keep', 1, 1.4), w('this', 1.5, 1.9), w('cut', 3, 3.4), w('this', 3.5, 3.9), w('and', 5, 5.4), w('this', 5.5, 5.9)] } as Transcript;
    // The edit keeps 1-2 s and 5-6 s back to back from timeline 0.
    comp.clips = [
      newClip({ trackId: a1, start: 0, duration: 1, in: 1, source: { type: 'media', assetId: 'th' } }),
      newClip({ trackId: a1, start: 1, duration: 1, in: 5, source: { type: 'media', assetId: 'th' } }),
    ];
    const words = timelineWords(comp, new Map([['th', asset]]), new Map([['th', transcript]]));
    expect(words.map((word) => word.text)).toEqual(['keep', 'this', 'and', 'this']);
    expect(words[2].start).toBeCloseTo(1);
  });
});
