import { describe, expect, it } from 'vitest';
import { buildShortComp, fillSize, normalizeSegments, offsetFor, orientationFromAnswer, shortName, subjectPath, SHORT_FORMAT_OPTIONS } from '../src/lib/shorts';
import { tracksOf } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

const asset = { id: 'a1', name: 'talk.mp4', path: 'C:/talk.mp4', kind: 'video', duration: 600, width: 1920, height: 1080, hasAudio: true } as Asset;
const words = [
  { text: 'Nobody', start: 10.0, end: 10.4 },
  { text: 'tells', start: 10.4, end: 10.7 },
  { text: 'you', start: 10.7, end: 10.9 },
  { text: 'this.', start: 10.9, end: 11.5 },
  { text: 'Here', start: 30.0, end: 30.3 },
  { text: 'is', start: 30.3, end: 30.5 },
  { text: 'why.', start: 30.5, end: 31.0 },
];

describe('shorts naming and format', () => {
  it('names a short by rank and rating', () => {
    expect(shortName(1, 7.84)).toBe('Short 1 _ 7.8★');
    expect(shortName(3, 10)).toBe('Short 3 _ 10.0★');
  });

  it('reads the format answer in plain words, labels or Hinglish', () => {
    expect(orientationFromAnswer(SHORT_FORMAT_OPTIONS[0])).toBe('portrait');
    expect(orientationFromAnswer(SHORT_FORMAT_OPTIONS[1])).toBe('landscape');
    expect(orientationFromAnswer('vertical please')).toBe('portrait');
    expect(orientationFromAnswer('16:9')).toBe('landscape');
    expect(orientationFromAnswer('no idea')).toBeNull();
  });
});

describe('segments', () => {
  it('never cuts a word in half and merges overlapping ranges', () => {
    const result = normalizeSegments([{ start: 10.2, end: 20 }, { start: 19.5, end: 30.4 }], 600, words);
    if ('error' in result) throw new Error(result.error);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].start).toBeLessThanOrEqual(10.0);
    expect(result.segments[0].end).toBeGreaterThanOrEqual(30.5);
  });

  it('refuses a short that is too short or too long', () => {
    expect('error' in normalizeSegments([{ start: 0, end: 3 }], 600)).toBe(true);
    expect('error' in normalizeSegments([{ start: 0, end: 300 }], 600)).toBe(true);
  });
});

describe('framing', () => {
  it('puts the face where it should be without exposing a picture edge', () => {
    const { pw, ph } = fillSize(1920, 1080, 1080, 1920);
    expect(pw).toBeCloseTo(3.16, 2);
    expect(ph).toBeCloseTo(1, 5);
    // A face on the right third lands in the middle of the tall frame.
    const at = offsetFor(pw, ph, 0.7, 0.4, 0.5, 0.4);
    expect(0.5 + at.x + (0.7 - 0.5) * pw).toBeCloseTo(0.5, 3);
    // A face at the far edge cannot pull the picture off the frame.
    expect(Math.abs(offsetFor(pw, ph, 1, 0.5).x)).toBeLessThanOrEqual((pw - 1) / 2 + 1e-9);
  });

  it('follows the face that is on screen most', () => {
    const path = subjectPath([
      { id: 1, frames: [{ t: 12, x: 0.1, y: 0.1, width: 0.05, height: 0.05 }] },
      { id: 2, frames: [{ t: 12, x: 0.6, y: 0.2, width: 0.2, height: 0.3 }, { t: 13, x: 0.62, y: 0.2, width: 0.2, height: 0.3 }] },
    ], 10, 20);
    expect(path).toHaveLength(2);
    expect(path[0].x).toBeCloseTo(0.7, 5);
  });
});

describe('a short comp', () => {
  it('is cut, reframed, punched in, hooked and captioned in the chosen frame', () => {
    const { comp } = buildShortComp({
      asset,
      spec: { title: 'Why nobody tells you', score: 8.44, segments: [{ start: 9.9, end: 20 }, { start: 29.9, end: 40 }], hook: 'Nobody tells you this' },
      rank: 1, orientation: 'portrait', fps: 30, words, faces: [], captionStyle: null, captions: true, folderId: 'f1',
    });
    expect(comp.name).toBe('Short 1 _ 8.4★');
    expect([comp.width, comp.height]).toEqual([1080, 1920]);
    expect(comp.folderId).toBe('f1');
    const v1 = tracksOf(comp, 'video')[0].id;
    const footage = comp.clips.filter((clip) => clip.trackId === v1);
    expect(footage).toHaveLength(2);
    expect(footage[1].start).toBeCloseTo(10.1, 3);
    expect(footage[0].transform.fit).toBe('fill');
    // Alternate parts punch in, and every part pushes in slowly.
    expect(footage[1].transform.scale).toBeGreaterThan(footage[0].transform.scale);
    expect(footage[0].keyframes.scale.length).toBe(2);
    expect(comp.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'kinetic')).toBe(true);
    expect(comp.clips.some((clip) => clip.source.type === 'text' && clip.source.preset === 'caption')).toBe(true);
    expect(comp.markers).toHaveLength(1);
    expect(comp.short?.score).toBe(8.4);
    expect(comp.short?.orientation).toBe('portrait');
  });
});

describe('whether the request already chose the screen', () => {
  it('asks unless portrait or landscape is named outright', async () => {
    const { orientationStated } = await import('../src/lib/shorts');
    expect(orientationStated('make shorts from this video')).toBeNull();
    expect(orientationStated('make 5 reels')).toBeNull();
    expect(orientationStated('make vertical shorts')).toBe('portrait');
    expect(orientationStated('shorts in 16:9 please')).toBe('landscape');
  });
});
