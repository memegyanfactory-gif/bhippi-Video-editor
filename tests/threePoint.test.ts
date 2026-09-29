import { describe, expect, it } from 'vitest';
import { fitToFillSpeed, threePointEdit } from '../src/lib/timeline';

const frame = 1 / 30;
const source = { in: 5, out: 9 };

describe('three-point editing', () => {
  it('uses the playhead with no timeline marks', () => {
    expect(threePointEdit({ in: null, out: null }, 12, source, 60, frame)).toEqual({ start: 12, in: 5, duration: 4, note: null });
  });
  it('starts at the timeline In', () => {
    expect(threePointEdit({ in: 20, out: null }, 12, source, 60, frame)).toMatchObject({ start: 20, in: 5, duration: 4 });
  });
  it('fills the timeline In→Out from the source In', () => {
    expect(threePointEdit({ in: 20, out: 22 }, 12, source, 60, frame)).toMatchObject({ start: 20, in: 5, duration: 2, note: null });
    expect(threePointEdit({ in: 20, out: 30 }, 12, source, 60, frame)).toMatchObject({ start: 20, duration: 10 });
  });
  it('fills less, and says so, when the source runs out', () => {
    const edit = threePointEdit({ in: 20, out: 30 }, 12, source, 6, frame);
    expect(edit.duration).toBe(6);
    expect(edit.note).toMatch(/runs out 4\.00 s/);
  });
  it('back-times from the timeline Out', () => {
    expect(threePointEdit({ in: null, out: 30 }, 12, source, 60, frame)).toMatchObject({ start: 26, in: 5, duration: 4 });
    // Too close to the start: the head is trimmed so it still ends at Out.
    expect(threePointEdit({ in: null, out: 1 }, 12, source, 60, frame)).toMatchObject({ start: 0, in: 8, duration: 1 });
  });
  it('fit to fill plays the source range across the timeline range', () => {
    expect(fitToFillSpeed({ in: 20, out: 22 }, source)).toBe(2);
    expect(fitToFillSpeed({ in: null, out: 22 }, source)).toBeNull();
  });
});

describe('reverse match frame', () => {
  it('finds where a source frame plays, through speed and reverse, nearest the playhead first', async () => {
    const { whereSourcePlays, newComp, newClip, tracksOf } = await import('../src/lib/timeline');
    const comp = newComp({ name: 'T' });
    const [v1] = tracksOf(comp, 'video');
    const media = { type: 'media', assetId: 'a' } as const;
    const plain = newClip({ id: 'plain', trackId: v1.id, start: 10, duration: 4, in: 2, source: media });
    const fast = newClip({ id: 'fast', trackId: v1.id, start: 30, duration: 2, in: 2, speed: 2, source: media });
    const back = newClip({ id: 'back', trackId: v1.id, start: 50, duration: 4, in: 2, reverse: true, source: media });
    const hits = whereSourcePlays({ ...comp, clips: [plain, fast, back] }, 'a', 3, 31);
    expect(hits.map((hit) => [hit.clip.id, hit.time])).toEqual([['fast', 30.5], ['plain', 11], ['back', 53]]);
    expect(whereSourcePlays({ ...comp, clips: [plain] }, 'a', 9, 0)).toEqual([]);
  });
});
