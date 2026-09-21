import { describe, expect, it } from 'vitest';
import { scoreEnvelope, type AudioEnvelope } from '../src/lib/audioEnvelope';
import { newClip } from '../src/lib/timeline';
import { valueAt } from '../src/lib/keyframes';

const clip = newClip({ trackId: 'audio', source: { type: 'media', assetId: 'music' }, start: 10, duration: 10, volume: 0.5 });
const options: AudioEnvelope = { fadeIn: 1, fadeOut: 2, cues: [], speech: [], duckDb: -20, attack: 0.2, release: 0.5 };
describe('scene score automation', () => {
  it('fades without shifting or replacing the source', () => {
    const keys = scoreEnvelope(clip, options);
    expect(valueAt(keys, 0)).toBe(0); expect(valueAt(keys, 1)).toBe(0.5);
    expect(valueAt(keys, 9)).toBeCloseTo(0.25, 3); expect(valueAt(keys, 10)).toBe(0);
    expect(clip.keyframes.volume).toEqual([]);
  });
  it('ducks real speech ranges in timeline time and holds between nearby words', () => {
    const keys = scoreEnvelope(clip, { ...options, speech: [{ start: 12, end: 13 }, { start: 13.2, end: 14 }] });
    expect(valueAt(keys, 2)).toBeCloseTo(0.05, 4);
    expect(valueAt(keys, 3.1)).toBeCloseTo(0.05, 4);
    expect(valueAt(keys, 4.5)).toBeCloseTo(0.5, 4);
    expect(valueAt(keys, 1.9)).toBeCloseTo(0.275, 3);
  });
  it('combines existing volume automation with crescendo cues', () => {
    const original = { ...clip, keyframes: { ...clip.keyframes, volume: [{ time: 0, value: 0.2, easing: 'linear' as const }, { time: 10, value: 0.6, easing: 'linear' as const }] } };
    const keys = scoreEnvelope(original, { ...options, fadeIn: 0, fadeOut: 0, cues: [{ time: 10, gainDb: -20 }, { time: 20, gainDb: 0 }] });
    expect(valueAt(keys, 5)).toBeCloseTo(0.22, 3);
    expect(valueAt(keys, 10)).toBeCloseTo(0.6, 3);
  });
  it('rejects invalid cues instead of silently moving them', () => {
    expect(() => scoreEnvelope(clip, { ...options, cues: [{ time: 3, gainDb: 0 }] })).toThrow();
    expect(() => scoreEnvelope(clip, { ...options, speech: [{ start: 13, end: 12 }] })).toThrow();
  });
  it('names the bad cue index and the clip range so one retry fixes all', () => {
    // Clip spans 10–20s: cue 0 is outside, cue 1 has a bad gain.
    const error = (() => { try { scoreEnvelope(clip, { ...options, cues: [{ time: 3, gainDb: 0 }, { time: 12, gainDb: 99 }, { time: 14, gainDb: 0 }] }); return ''; } catch (e) { return String(e); } })();
    expect(error).toContain('cue 0');
    expect(error).toContain('cue 1');
    expect(error).toContain('10–20s');
  });
  it('names a duplicated cue timestamp', () => {
    expect(() => scoreEnvelope(clip, { ...options, cues: [{ time: 12, gainDb: 0 }, { time: 12, gainDb: -6 }] })).toThrow('12s appears twice');
  });
});
