import { describe, expect, it } from 'vitest';
import { captionCues, toSrt, toVtt } from '../src/lib/captionFiles';
import { newClip, newComp, textSource, tracksOf } from '../src/lib/timeline';

function comp() {
  const base = newComp({ name: 'T' });
  const [, v2] = tracksOf(base, 'video');
  const caption = (start: number, text: string) => newClip({ trackId: v2.id, start, duration: 1.5, source: textSource('caption', { text }) });
  return { ...base, clips: [caption(3725.25, 'Second line'), caption(1, 'First line'), newClip({ trackId: v2.id, start: 5, duration: 1, source: textSource('title', { text: 'Not a caption' }) })] };
}

describe('caption files', () => {
  it('writes SubRip with comma milliseconds and numbered cues, captions only', () => {
    expect(toSrt(captionCues(comp()))).toBe('1\n00:00:01,000 --> 00:00:02,500\nFirst line\n\n2\n01:02:05,250 --> 01:02:06,750\nSecond line\n');
  });
  it('writes WebVTT with a header and dot milliseconds', () => {
    expect(toVtt(captionCues(comp()))).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nFirst line\n\n01:02:05.250 --> 01:02:06.750\nSecond line\n');
  });
  it('clips to an In→Out range and starts it at zero', () => {
    expect(captionCues(comp(), { start: 1.5, end: 2 })).toEqual([{ start: 0, end: 0.5, text: 'First line' }]);
  });
});
