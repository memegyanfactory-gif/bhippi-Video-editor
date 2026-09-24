import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));
import { beatGrid, detectBeats, estimateTempo, nearestBeatAfter, nearestDownbeat, onsetEnvelope, snapCutsToBeats, snapTimesToBeats } from '../src/lib/beats';
import { BUCKETS_PER_SECOND, type Peaks } from '../src/lib/peaks';
import { clipEnd, newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Comp } from '../src/lib/types';

/** Deterministic pseudo-noise in [-1, 1) — a plain LCG so every run sees the same "recording". */
const noise = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };
};

/** `seconds` of clicks every `period` seconds: a 30 ms burst (peak 240, rms 200) over a quiet floor. */
const clicks = (seconds: number, period: number, seed = 7): Peaks => {
  const buckets = Math.round(seconds * BUCKETS_PER_SECOND);
  const data = new Uint8Array(buckets * 2);
  const next = noise(seed);
  for (let index = 0; index < buckets; index++) {
    data[index * 2] = Math.round(20 + 6 * next());
    data[index * 2 + 1] = Math.round(10 + 4 * next());
  }
  const burst = Math.round(0.03 * BUCKETS_PER_SECOND);
  for (let time = 0; time < seconds; time += period) {
    const first = Math.round(time * BUCKETS_PER_SECOND);
    for (let index = first; index < Math.min(buckets, first + burst); index++) {
      data[index * 2] = 240;
      data[index * 2 + 1] = 200;
    }
  }
  return { data, buckets };
};

const silence = (seconds: number): Peaks => {
  const buckets = Math.round(seconds * BUCKETS_PER_SECOND);
  return { data: new Uint8Array(buckets * 2), buckets };
};

describe('beat detection', () => {
  it('finds 120 BPM clicks and puts every beat on a click', () => {
    const result = detectBeats(clicks(20, 0.5));
    expect(Math.abs(result.bpm - 120)).toBeLessThanOrEqual(1.5);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.beats.length).toBeGreaterThanOrEqual(36);
    expect(result.duration).toBe(20);
    for (const beat of result.beats) {
      const nearest = Math.round(beat / 0.5) * 0.5;
      expect(Math.abs(beat - nearest)).toBeLessThanOrEqual(0.025);
    }
    // Every fourth beat, starting from one of the first four.
    expect(result.downbeats.length).toBeGreaterThanOrEqual(9);
    expect(result.beats.indexOf(result.downbeats[0])).toBeLessThan(4);
    expect(result.downbeats[1] - result.downbeats[0]).toBeCloseTo(2, 1);
  });

  it('resolves a tempo whose period is not a whole number of buckets', () => {
    const result = detectBeats(clicks(20, 0.64516));
    expect(Math.abs(result.bpm - 93)).toBeLessThanOrEqual(2);
    for (const beat of result.beats) {
      const nearest = Math.round(beat / 0.64516) * 0.64516;
      expect(Math.abs(beat - nearest)).toBeLessThanOrEqual(0.025);
    }
  });

  it('analyses only the requested range and reports times in source seconds', () => {
    const result = detectBeats(clicks(30, 0.5), { start: 10, end: 20 });
    expect(result.duration).toBeCloseTo(10, 6);
    expect(Math.abs(result.bpm - 120)).toBeLessThanOrEqual(1.5);
    expect(result.beats[0]).toBeGreaterThanOrEqual(10);
    expect(result.beats[result.beats.length - 1]).toBeLessThan(20);
  });

  it('snaps to beats within tolerance and leaves the rest alone', () => {
    const { beats } = detectBeats(clicks(20, 0.5));
    const snapped = snapTimesToBeats([1.02, 1.3], beats, 0.08);
    expect(snapped[0].snapped).toBeCloseTo(1.0, 2);
    expect(snapped[0].delta).toBeCloseTo(-0.02, 2);
    expect(snapped[1].snapped).toBeNull();
    expect(snapTimesToBeats([1], [], 0.1)).toEqual([{ time: 1, snapped: null, delta: 0 }]);

    expect(nearestBeatAfter(beats, 1.02)).toBeCloseTo(1.5, 2);
    expect(nearestBeatAfter(beats, 1.0)).toBeCloseTo(1.0, 2);
    expect(nearestBeatAfter(beats, 1.0, 0.2)).toBeCloseTo(1.5, 2);
    expect(nearestBeatAfter(beats, 100)).toBeNull();
  });

  it('is not confident about silence or noise', () => {
    const quiet = estimateTempo(onsetEnvelope(silence(20)), BUCKETS_PER_SECOND);
    expect(quiet.confidence).toBeLessThan(0.2);
    const hiss = clicks(20, Infinity, 3);
    const noisy = estimateTempo(onsetEnvelope(hiss), BUCKETS_PER_SECOND);
    expect(noisy.confidence).toBeLessThan(0.2);
    expect(detectBeats(silence(20)).beats).toEqual([]);
    expect(detectBeats(silence(0)).beats).toEqual([]);
  });

  it('phase-locks a grid to the clicks', () => {
    const envelope = onsetEnvelope(clicks(10, 0.5));
    const grid = beatGrid(envelope, BUCKETS_PER_SECOND, 120);
    expect(grid.phase).toBe(0);
    expect(grid.beats.length).toBe(20);
    expect(grid.score).toBeGreaterThan(0.5);
    // The same clicks read from 0.2 s in: the phase moves to 30 buckets to stay on them.
    expect(beatGrid(envelope.subarray(20), BUCKETS_PER_SECOND, 120).phase).toBe(30);
  });
});

describe('snapping cuts to beats (C1: no black gaps at butt cuts)', () => {
  /** V1: A [0,2] B [2,5] C [5,8], then D alone at [10,12]; each with linked audio on A1. Sources run 20 s from `in` 1. */
  const edit = () => {
    const base = newProject().comps[0];
    const v1 = tracksOf(base, 'video')[0];
    const a1 = tracksOf(base, 'audio')[0];
    const clips: Clip[] = [];
    for (const [id, start, duration] of [['A', 0, 2], ['B', 2, 3], ['C', 5, 3], ['D', 10, 2]] as const) {
      const source = { type: 'media' as const, assetId: `asset-${id}` };
      clips.push(newClip({ id, trackId: v1.id, start, duration, in: 1, source, linkId: `link-${id}`, name: id }));
      clips.push(newClip({ id: `${id}-audio`, trackId: a1.id, start, duration, in: 1, source, linkId: `link-${id}` }));
    }
    const comp: Comp = { ...base, clips };
    return { comp, v1: v1.id, a1: a1.id };
  };
  const limit = () => 20;
  const byId = (comp: Comp, id: string) => comp.clips.find((clip) => clip.id === id)!;
  const gaps = (comp: Comp, trackId: string) => {
    const clips = comp.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.start - b.start);
    return clips.slice(1).map((clip, i) => clip.start - clipEnd(clips[i])).filter((gap) => Math.abs(gap) > 1e-6);
  };

  it('rolls a butt cut onto a beat either side, leaving no gap and linked audio untouched', () => {
    const { comp, v1, a1 } = edit();
    // A/B cut at 2 moves late to 2.1; B/C cut at 5 moves early to 4.9.
    const { comp: next, changes } = snapCutsToBeats(comp, [2.1, 4.9], { tolerance: 0.12, limit });
    expect(changes.map((c) => [c.clipId, c.edge, c.mode, c.to])).toEqual([['B', 'start', 'roll', 2.1], ['C', 'start', 'roll', 4.9]]);
    // The only gap on V1 is the one that was always there, before D.
    expect(gaps(next, v1)).toEqual([2]);
    expect(clipEnd(byId(next, 'A'))).toBeCloseTo(2.1, 9);
    expect(byId(next, 'B').start).toBeCloseTo(2.1, 9);
    expect(byId(next, 'B').in).toBeCloseTo(1.1, 9);
    expect(clipEnd(byId(next, 'B'))).toBeCloseTo(4.9, 9);
    expect(byId(next, 'C').start).toBeCloseTo(4.9, 9);
    expect(byId(next, 'C').in).toBeCloseTo(0.9, 9);
    expect(clipEnd(byId(next, 'C'))).toBeCloseTo(8, 9);
    // The audio under the cuts did not move (a J/L split, not a hole).
    expect(next.clips.filter((clip) => clip.trackId === a1)).toEqual(comp.clips.filter((clip) => clip.trackId === a1));
  });

  it('holds a cut whose roll would run past the media, instead of opening a gap', () => {
    const { comp, v1 } = edit();
    // A's media ends exactly at its out point (in 1 + 2 s = 3 s), so its tail cannot extend to 2.1.
    const tight = (clip: Clip) => (clip.id === 'A' ? 3 : 20);
    const { comp: next, changes } = snapCutsToBeats(comp, [2.1], { tolerance: 0.12, limit: tight });
    expect(changes).toEqual([]);
    expect(next).toBe(comp);
    expect(gaps(next, v1)).toEqual([2]);
  });

  it('trims free edges beside a gap and respects `only`', () => {
    const { comp } = edit();
    const { comp: next, changes } = snapCutsToBeats(comp, [8.05, 10.05, 11.9], { tolerance: 0.12, limit });
    expect(changes.map((c) => [c.clipId, c.edge, c.mode])).toEqual([['C', 'end', 'trim'], ['D', 'start', 'trim'], ['D', 'end', 'trim']]);
    expect(clipEnd(byId(next, 'C'))).toBeCloseTo(8.05, 9);
    expect(byId(next, 'D').start).toBeCloseTo(10.05, 9);
    expect(clipEnd(byId(next, 'D'))).toBeCloseTo(11.9, 9);
    const onlyB = snapCutsToBeats(comp, [2.1, 4.9, 10.05], { tolerance: 0.12, limit, only: new Set(['B']) });
    // B's head and tail are butt cuts, so both roll; D is not listed and stays.
    expect(onlyB.changes.map((c) => c.clipId)).toEqual(['B', 'C']);
    expect(byId(onlyB.comp, 'D').start).toBe(10);
  });

  it('leaves cuts already on the beat, out of tolerance, or at zero alone', () => {
    const { comp } = edit();
    expect(snapCutsToBeats(comp, [0.05, 2.01, 5.5], { tolerance: 0.12, limit }).changes).toEqual([]);
  });
});

describe('downbeats for stingers', () => {
  it('finds the nearest bar line', () => {
    expect(nearestDownbeat(3.1, [0, 2, 4, 6])).toBe(4);
    expect(nearestDownbeat(2.9, { downbeats: [0, 2, 4, 6] })).toBe(2);
    expect(nearestDownbeat(2.9, [0, 2, 4, 6], 0.5)).toBeNull();
    expect(nearestDownbeat(1, [])).toBeNull();
  });
});
