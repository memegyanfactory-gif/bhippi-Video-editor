import { describe, expect, it } from 'vitest';
import { rulerSteps, snapBox, snapTo } from '../src/editor/MonitorRulers';

describe('monitor rulers', () => {
  it('keeps labelled ticks readable at every zoom', () => {
    for (const scale of [0.05, 0.1, 0.25, 0.33, 0.5, 1, 2, 4, 8]) {
      const { major, minor } = rulerSteps(scale);
      expect(major * scale).toBeGreaterThanOrEqual(56);
      expect(major % minor).toBe(0);
      expect(minor * scale).toBeGreaterThanOrEqual(5);
    }
  });

  it('labels every 100 px of a 1080p frame at 50% and every 50 px at 200%', () => {
    expect(rulerSteps(0.5).major).toBe(200);
    expect(rulerSteps(2).major).toBe(50);
  });
});

describe('snapping', () => {
  it('snaps a guide to the nearest target within the threshold', () => {
    expect(snapTo(537, [0, 540, 1080], 6)).toEqual({ value: 540, target: 540 });
    expect(snapTo(520, [0, 540, 1080], 6)).toEqual({ value: 520, target: null });
  });

  it('snaps a moving box by its edge or centre, whichever is closest', () => {
    // A 100 px box at x=10 moved by 42 → centre sits at 102, 2 px off the 100 target.
    expect(snapBox(10, 100, 42, [100], 6)).toEqual({ shift: -2, line: 100 });
    // Right edge 10+100+85 = 195 → 5 px from 200.
    expect(snapBox(10, 100, 85, [200], 6)).toEqual({ shift: 5, line: 200 });
    expect(snapBox(10, 100, 20, [300], 6)).toBeNull();
  });
});
