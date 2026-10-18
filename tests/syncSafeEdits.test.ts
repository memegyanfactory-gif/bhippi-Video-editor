import { describe, expect, it } from 'vitest';
import { addFrameHold, clipEnd, closeGap, newClip, newComp, removeClips, setSpeed, slideClip, slipClip, trimEdge, trimToPlayhead, tracksOf } from '../src/lib/timeline';
import type { Clip, Comp } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;
const limit = () => 1000;
const at = (comp: Comp, id: string) => comp.clips.find((clip) => clip.id === id) as Clip;

function comp(build: (v: string[], a: string[]) => Clip[]): Comp {
  const base = newComp({ name: 'Test' });
  return { ...base, clips: build(tracksOf(base, 'video').map((track) => track.id), tracksOf(base, 'audio').map((track) => track.id)) };
}

describe('ripple edits keep sync-locked tracks together', () => {
  it('will not close a gap a sync-locked track cannot close', () => {
    let b!: Clip, b2!: Clip;
    const before = comp(([v1], [a1]) => [
      newClip({ trackId: v1, start: 0, duration: 5, source: media }),
      (b = newClip({ trackId: v1, start: 8, duration: 4, source: media, linkId: 'b' })),
      (b2 = newClip({ trackId: a1, start: 8, duration: 4, source: media, linkId: 'b' })),
      newClip({ trackId: a1, start: 4, duration: 3.5, source: media }),
    ]);
    const after = closeGap(before, before.clips[0].trackId, 6);
    expect(at(after, b.id).start).toBe(at(after, b2.id).start);
    expect(after).toBe(before);
  });

  it('limits a ripple trim to what every sync-locked track can close', () => {
    let a!: Clip, b!: Clip, b2!: Clip;
    const before = comp(([v1], [a1]) => [
      (a = newClip({ trackId: v1, start: 0, duration: 10, source: media })),
      (b = newClip({ trackId: v1, start: 10, duration: 4, source: media, linkId: 'b' })),
      (b2 = newClip({ trackId: a1, start: 10, duration: 4, source: media, linkId: 'b' })),
      newClip({ trackId: a1, start: 2, duration: 7, source: media }),
    ]);
    const after = trimEdge(before, a.id, 'out', 6, 'ripple', limit);
    expect(at(after, b.id).start).toBeCloseTo(at(after, b2.id).start);
    expect(clipEnd(at(after, a.id))).toBeCloseTo(9);
  });

  it('keeps the halves after a ripple-deleted L-cut in sync', () => {
    let v1c!: Clip, a1c!: Clip, v2!: Clip, a2!: Clip;
    const before = comp(([v1], [a1]) => [
      (v1c = newClip({ trackId: v1, start: 0, duration: 4, source: media, linkId: 'one' })),
      (a1c = newClip({ trackId: a1, start: 0, duration: 5, source: media, linkId: 'one' })),
      (v2 = newClip({ trackId: v1, start: 4, duration: 4, source: media, linkId: 'two' })),
      (a2 = newClip({ trackId: a1, start: 5, duration: 4, source: media, linkId: 'two' })),
    ]);
    const after = removeClips(before, [v1c.id, a1c.id], true);
    expect(at(after, v2.id).start).toBeCloseTo(0);
    expect(at(after, a2.id).start - at(after, v2.id).start).toBeCloseTo(1);
  });

  it('keeps sync when a ripple speed change cannot close up on every track', () => {
    let a!: Clip, b!: Clip, b2!: Clip;
    const before = comp(([v1], [a1]) => [
      (a = newClip({ trackId: v1, start: 0, duration: 10, source: media })),
      (b = newClip({ trackId: v1, start: 10, duration: 4, source: media, linkId: 'b' })),
      (b2 = newClip({ trackId: a1, start: 10, duration: 4, source: media, linkId: 'b' })),
      newClip({ trackId: a1, start: 2, duration: 7, source: media }),
    ]);
    const after = setSpeed(before, [a.id], { speed: 2, ripple: true, limit });
    expect(at(after, b.id).start).toBeCloseTo(at(after, b2.id).start);
  });
});

describe('linked pairs are edited once', () => {
  it('Q trims a linked clip once, not once per targeted track', () => {
    let v!: Clip;
    const before = comp(([v1], [a1]) => [
      (v = newClip({ trackId: v1, start: 0, duration: 10, source: media, linkId: 'x' })),
      newClip({ trackId: a1, start: 0, duration: 10, source: media, linkId: 'x' }),
    ]);
    const tracks = [...new Set(before.clips.map((clip) => clip.trackId))];
    const after = trimToPlayhead(before, tracks, 4, 'previous', true, limit, 1 / 30);
    expect(at(after, v.id).duration).toBeCloseTo(6);
    expect(at(after, v.id).in).toBeCloseTo(4);
    expect(after.clips.every((clip) => Math.abs(clip.duration - 6) < 1e-6)).toBe(true);
  });

  it('slip leaves a linked partner on a locked track alone', () => {
    let v!: Clip, a!: Clip;
    const base = comp(([v1], [a1]) => [
      (v = newClip({ trackId: v1, start: 0, duration: 4, source: media, linkId: 'x', in: 2 })),
      (a = newClip({ trackId: a1, start: 0, duration: 4, source: media, linkId: 'x', in: 2 })),
    ]);
    const locked = { ...base, tracks: base.tracks.map((track) => (track.id === a.trackId ? { ...track, locked: true } : track)) };
    const after = slipClip(locked, v.id, 1, limit);
    expect(at(after, v.id).in).toBeCloseTo(3);
    expect(at(after, a.id).in).toBeCloseTo(2);
  });
});

describe('frames and keyframes', () => {
  it('lands a speed change on a whole frame', () => {
    let clip!: Clip;
    const before = comp(([v1]) => [(clip = newClip({ trackId: v1, start: 0, duration: 1, source: media }))]);
    const after = setSpeed(before, [clip.id], { speed: 0.7, limit });
    const frames = at(after, clip.id).duration * before.fps;
    expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-6);
  });

  it('slide keeps the first frame of a reversed clip before', () => {
    let p!: Clip, c!: Clip;
    const before = comp(([v1]) => [
      (p = newClip({ trackId: v1, start: 0, duration: 5, source: media, in: 10, reverse: true })),
      (c = newClip({ trackId: v1, start: 5, duration: 3, source: media, in: 20 })),
      newClip({ trackId: v1, start: 8, duration: 5, source: media, in: 0 }),
    ]);
    const after = slideClip(before, c.id, 1, limit);
    const moved = at(after, p.id);
    // A reversed clip's first frame is its source out point.
    expect(moved.in + moved.duration * moved.speed).toBeCloseTo(p.in + p.duration * p.speed);
  });

  it('rate stretch rescales effect keyframes with the clip', () => {
    let clip!: Clip;
    const before = comp(([v1]) => [(clip = newClip({ trackId: v1, start: 0, duration: 4, source: media, effectKeys: { brightness: [{ time: 2, value: 1 }] } as Clip['effectKeys'] }))]);
    const after = trimEdge(before, clip.id, 'out', 8, 'stretch', limit);
    expect(at(after, clip.id).effectKeys?.brightness?.[0].time).toBeCloseTo(4);
  });

  it('Add Frame Hold leaves clips on locked tracks alone', () => {
    let clip!: Clip;
    const base = comp(([v1]) => [(clip = newClip({ trackId: v1, start: 0, duration: 4, source: media }))]);
    const locked = { ...base, tracks: base.tracks.map((track) => ({ ...track, locked: true })) };
    expect(addFrameHold(locked, [clip.id], 2)).toBe(locked);
  });
});
