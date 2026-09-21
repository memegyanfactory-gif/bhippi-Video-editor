import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));
import { beatGrid, detectBeats, estimateTempo, nearestBeatAfter, onsetEnvelope, snapTimesToBeats } from '../src/lib/beats';
import { BUCKETS_PER_SECOND, type Peaks } from '../src/lib/peaks';

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
