import { describe, expect, it } from 'vitest';
import { drawFiwnCaption, fiwnStyle, FIWN_STYLE_IDS, isDynamicStyle, type FiwnCue } from '../src/lib/fiwn';

/** A canvas that accepts every call and records the text drawn (no real canvas in Node). */
function recordingCanvas() {
  const drawn: string[] = [];
  const gradient = { addColorStop() {} };
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, filter: 'none', font: '10px sans-serif', lineWidth: 1 };
  const ctx: unknown = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: String(text).length * 12, actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 8 });
      if (key === 'fillText' || key === 'strokeText') return (text: string) => { drawn.push(String(text)); };
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient' || key === 'createPattern') return () => gradient;
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === 'getLineDash') return () => [];
      if (key === 'isPointInPath') return () => false;
      if (key === 'canvas') return { width: 1920, height: 1080 };
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as CanvasRenderingContext2D, drawn };
}

const cue: FiwnCue = {
  start: 1,
  end: 4,
  text: 'This changes everything you know',
  words: [
    { word: 'This', start: 1.0, end: 1.3 },
    { word: 'changes', start: 1.3, end: 1.8 },
    { word: 'everything', start: 1.9, end: 2.6 },
    { word: 'you', start: 2.7, end: 2.9 },
    { word: 'know', start: 3.0, end: 3.6 },
  ],
};

describe('WatchFIWN captions', () => {
  it('brings every FIWN preset, dynamic ones included', () => {
    expect(FIWN_STYLE_IDS.length).toBeGreaterThanOrEqual(139);
    const dynamic = FIWN_STYLE_IDS.filter((id) => isDynamicStyle(fiwnStyle(id)!));
    expect(dynamic.length).toBeGreaterThanOrEqual(58);
    expect(fiwnStyle('dynFlyingType')).toBeDefined();
    expect(fiwnStyle('no-such-style')).toBeUndefined();
  });

  it('keeps FIWN\'s real fonts and animation instead of substitutes', () => {
    const fonts = new Set(FIWN_STYLE_IDS.map((id) => fiwnStyle(id)!.font));
    expect(fonts.has('Inter')).toBe(true);
    expect([...fonts].some((font) => /Anton|Bebas|Space Grotesk|Archivo Black/.test(font))).toBe(true);
    expect(FIWN_STYLE_IDS.some((id) => fiwnStyle(id)!.anim?.ease === 'overshoot')).toBe(true);
  });

  it.each(FIWN_STYLE_IDS)('draws %s across the whole caption without failing', (id) => {
    const style = fiwnStyle(id)!;
    const { ctx, drawn } = recordingCanvas();
    for (const time of [1.0, 1.05, 1.5, 2.0, 2.8, 3.5, 3.95, 4.0]) {
      expect(drawFiwnCaption(ctx, cue, time, 1920, 1080, style)).toBe(true);
    }
    // It put words on the frame (letter-by-letter styles draw pieces of them).
    expect(drawn.join('').replace(/\s/g, '').length).toBeGreaterThan(0);
  });

  it('draws nothing outside the caption\'s time', () => {
    const { ctx, drawn } = recordingCanvas();
    expect(drawFiwnCaption(ctx, cue, 0.5, 1920, 1080, fiwnStyle(FIWN_STYLE_IDS[0])!)).toBe(true);
    expect(drawn).toEqual([]);
  });

  it('reports failure instead of throwing, so the caller can fall back', () => {
    const broken = { save() {}, restore() {} } as unknown as CanvasRenderingContext2D;
    const quiet = console.warn;
    console.warn = () => undefined;
    try {
      expect(drawFiwnCaption(broken, cue, 2, 1920, 1080, fiwnStyle(FIWN_STYLE_IDS[0])!)).toBe(false);
    } finally {
      console.warn = quiet;
    }
  });
});

describe('captions handed to the WatchFIWN renderer', () => {
  it('carry the real word timings on the timeline, or none when the words were edited', async () => {
    const { fiwnCue } = await import('../src/lib/fiwn');
    const graphic = { id: 'c', text: 'make it pop', subtitle: '', start: 10, duration: 3, preset: 'caption' as const, color: '#FFFFFF', wordStarts: [10, 11.2, 11.5], wordEnds: [10.4, 11.4, 12.1] };
    expect(fiwnCue(graphic)).toEqual({ start: 10, end: 13, text: 'make it pop', words: [
      { word: 'make', start: 10, end: 10.4 }, { word: 'it', start: 11.2, end: 11.4 }, { word: 'pop', start: 11.5, end: 12.1 },
    ] });
    // Older captions have starts only: each word runs until the next begins.
    expect(fiwnCue({ ...graphic, wordEnds: undefined }).words?.map((word) => word.end)).toEqual([11.2, 11.5, 13]);
    // Edited text no longer matches the timings: FIWN spreads the words itself.
    expect(fiwnCue({ ...graphic, text: 'make it pop now' }).words).toBeUndefined();
  });
});
