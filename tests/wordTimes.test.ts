import { describe, expect, it } from 'vitest';
import { findWord, hasWordRefs, resolveWordTimes } from '../src/lib/wordTimes';
import type { MotionScene } from '../src/motion/types';

const words = [
  { text: 'Real-time', start: 49.8, end: 50.3 }, { text: 'analytics', start: 50.3, end: 50.9 },
  { text: 'to', start: 50.9, end: 51.0 }, { text: 'measure', start: 51.0, end: 51.28 }, { text: 'ROI.', start: 51.28, end: 51.7 },
  { text: 'roi', start: 60, end: 60.4 },
];

describe('word-anchored timing', () => {
  it('finds words and phrases, ignoring case and punctuation, from the scene start on', () => {
    expect(findWord(words, { word: 'roi' }, 48)).toEqual({ start: 51.28, end: 51.7 });
    expect(findWord(words, { word: 'roi' }, 59)).toEqual({ start: 60, end: 60.4 });
    expect(findWord(words, { word: 'to measure' }, 0)).toEqual({ start: 50.9, end: 51.28 });
    expect(findWord(words, { word: 'nowhere' }, 0)).toBeNull();
  });
  it('turns {word} into scene seconds with the measured lead / land / finish', () => {
    const scene = { version: 1, width: 10, height: 10, duration: 5, layers: [
      { id: 'h', type: 'text', in: { word: 'analytics', mode: 'lead' }, text: { text: 'x', type: { at: { word: 'ROI', mode: 'finish' } } } },
      { id: 'c', type: 'text', text: { text: '1', counter: { value: { k: [{ t: { word: 'measure' }, v: 0 }, { t: { word: 'ROI', mode: 'land' }, v: 27 }] } } } },
    ] } as unknown as MotionScene;
    expect(hasWordRefs(scene)).toBe(true);
    const { scene: out, missing } = resolveWordTimes(scene, words, 48);
    expect(missing).toEqual([]);
    const h = out.layers[0] as unknown as { in: number; text: { type: { at: number } } };
    expect(h.in).toBeCloseTo(50.3 - 0.56 - 48, 6);
    expect(h.text.type.at).toBeCloseTo(51.7 - 0.3 - 48, 6);
    const keys = (out.layers[1] as unknown as { text: { counter: { value: { k: { t: number }[] } } } }).text.counter.value.k;
    expect(keys[1].t).toBeCloseTo(51.28 - 48, 6);
    expect(hasWordRefs(out)).toBe(false);
  });
  it('reports words it cannot find instead of guessing', () => {
    const scene = { version: 1, width: 10, height: 10, duration: 5, layers: [{ id: 'x', type: 'null', in: { word: 'blockchain' } }] } as unknown as MotionScene;
    expect(resolveWordTimes(scene, words, 0).missing).toEqual(['blockchain']);
  });
});
