import { describe, expect, it } from 'vitest';
import { clipFrameWindow } from '../src/lib/exportWindow';

describe('the frames an In→Out export reads', () => {
  it('reads every frame without a range', () => {
    expect(clipFrameWindow(10, 4, 30)).toEqual({ first: 0, last: 119 });
  });
  it('reads only the range, with a second of margin either side', () => {
    // Clip 10–20 s, range 14–15 s: clip time 3–6 s (with margin) → frames 90–180.
    expect(clipFrameWindow(10, 10, 30, { start: 14, end: 15 })).toEqual({ first: 90, last: 180 });
  });
  it('reads nothing when the range never shows the clip', () => {
    expect(clipFrameWindow(10, 4, 30, { start: 30, end: 40 })).toBeNull();
    expect(clipFrameWindow(10, 4, 30, { start: 0, end: 5 })).toBeNull();
  });
});

describe('HTML graphics at the output resolution', () => {
  it('draws a 4K comp\'s graphics at 2× their 1920 design canvas, not upscaled from 1080p', async () => {
    const { graphicScale } = await import('../src/lib/htmlFrames');
    const canvas = { width: 1920, height: 1080 };
    expect(graphicScale(canvas, { width: 3840, height: 2160 })).toBe(2);
    expect(graphicScale(canvas, { width: 1920, height: 1080 })).toBe(1);
    // A 1080p comp exported at 4K: the export's own scale.
    expect(graphicScale(canvas, { width: 1920, height: 1080 }, 2)).toBe(2);
    // Portrait 4K on its 1080-wide design canvas.
    expect(graphicScale({ width: 1080, height: 1920 }, { width: 2160, height: 3840 })).toBe(2);
    expect(graphicScale(canvas, { width: 7680, height: 4320 }, 2)).toBe(4);
  });
});
