import { describe, expect, it } from 'vitest';
import { benchmarkRoto } from '../src/lib/rotoBenchmark';

describe('roto benchmark report', () => {
  it('reports empty frames and temporal box jitter without claiming matte quality', () => {
    const report = benchmarkRoto([
      { at: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.5, cover: 0.15 },
      { at: 0.04, x: 0.2, y: 0.1, width: 0.3, height: 0.5, cover: 0.15 },
      { at: 0.08, x: 0, y: 0, width: 0, height: 0, cover: 0 },
    ]);
    expect(report.frames).toBe(3);
    expect(report.emptyFrames).toBe(1);
    expect(report.boxJitter).toBeGreaterThan(0);
    expect(report.edgeCases.hair).toBe('unmeasured');
    expect(report.candidates.some((candidate) => candidate.id === 'sam3.1')).toBe(true);
  });
});
