import { describe, expect, it } from 'vitest';
import { correctedAlpha } from '../src/lib/rotoCorrections';
import type { RotoCorrection } from '../src/lib/types';
const point: RotoCorrection = { at: 1, mode: 'exclude', kind: 'brush', x: 0.5, y: 0.5, radius: 0.2, softness: 0.5 };
describe('editable Roto alpha', () => {
  it('does not erase the subject in other frames', () => {
    expect(correctedAlpha(1, 50, 50, 100, 100, 0, 25, [point])).toBe(1);
    expect(correctedAlpha(1, 50, 50, 100, 100, 1, 25, [point])).toBe(0);
    expect(correctedAlpha(1, 50, 50, 100, 100, 1.04, 25, [point])).toBe(1);
  });
  it('supports include strokes and feathered edges', () => {
    expect(correctedAlpha(0, 50, 50, 100, 100, 1, 25, [{ ...point, mode: 'include' }])).toBe(1);
    const feather = correctedAlpha(1, 65, 50, 100, 100, 1, 25, [point]);
    expect(feather).toBeGreaterThan(0); expect(feather).toBeLessThan(1);
    expect(correctedAlpha(1, 0, 0, 100, 100, 1, 25, [point])).toBe(1);
  });
});
