import { describe, expect, it } from 'vitest';
import { ease, EASE_NAMES } from '../src/motion/anim';
import { TIMING } from '../src/motion/kit/common';

const MEASURED = ['house', 'settle', 'emphasized', 'rise', 'push', 'creep', 'snap-settle', 'resolve', 'card-zoom'] as const;

describe('measured eases (reference films)', () => {
  it('are named eases that start at 0 and land at 1', () => {
    for (const name of MEASURED) {
      expect(EASE_NAMES).toContain(name);
      expect(ease(name, 0)).toBeCloseTo(0, 5);
      expect(ease(name, 1)).toBeCloseTo(1, 5);
    }
  });
  it('have their measured shape: entrances front-loaded, the creep slow, the push symmetric-ish', () => {
    expect(ease('house', 0.25)).toBeGreaterThan(0.5);
    expect(ease('rise', 0.2)).toBeGreaterThan(0.7);
    expect(ease('settle', 0.3)).toBeGreaterThan(0.7);
    expect(ease('creep', 0.5)).toBeLessThan(0.15);
    expect(ease('push', 0.5)).toBeGreaterThan(0.4);
    expect(ease('push', 0.5)).toBeLessThan(0.6);
  });
  it('timing tokens are in seconds at 30 fps', () => {
    expect(TIMING.pop.scale).toBeCloseTo(4 / 30, 6);
    expect(TIMING.hoverLift.in + TIMING.hoverLift.hold + TIMING.hoverLift.out).toBeCloseTo(36 / 30, 6);
    expect(TIMING.typing.field).toBe(30);
  });
});
