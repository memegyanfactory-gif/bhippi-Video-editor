import { describe, expect, it } from 'vitest';
import { keysAt } from '../src/motion/anim';
import { motionReport } from '../src/motion/arcs';
import type { Key, Layer, MotionScene, Vec } from '../src/motion/types';

const scene = (layers: Layer[], duration = 2): MotionScene => ({ version: 1, width: 1000, height: 1000, duration, layers });
const mover = (k: Key<Vec>[]): Layer => ({ id: 'ball', type: 'solid', color: '#f00', size: [40, 40], transform: { position: { k } } } as Layer);

describe('arcs and per-axis easing', () => {
  it('a key with arc bows the path sideways and still lands on both keys', () => {
    const k: Key<Vec>[] = [{ t: 0, v: [0, 500], arc: 0.25 }, { t: 1, v: [1000, 500] }];
    expect(keysAt(k, 0)).toEqual([0, 500]);
    expect(keysAt(k, 1)).toEqual([1000, 500]);
    const mid = keysAt(k, 0.5) as number[];
    expect(mid[0]).toBeCloseTo(500);
    // Moving right on screen (+y down), "left of travel" is up: the middle rises by arc × chord.
    expect(mid[1]).toBeCloseTo(500 - 250);
  });
  it('through makes the path pass a point at the middle', () => {
    const k: Key<Vec>[] = [{ t: 0, v: [0, 0], through: [300, 400] }, { t: 1, v: [600, 0] }];
    const mid = keysAt(k, 0.5) as number[];
    expect(mid[0]).toBeCloseTo(300);
    expect(mid[1]).toBeCloseTo(400);
  });
  it('easeAxes eases each axis on its own (a throw: linear across, eased vertically)', () => {
    const k: Key<Vec>[] = [{ t: 0, v: [0, 0], easeAxes: ['linear', 'expo-out'] }, { t: 1, v: [100, 100] }];
    const v = keysAt(k, 0.25) as number[];
    expect(v[0]).toBeCloseTo(25);
    expect(v[1]).toBeGreaterThan(60);
  });
  it('plain keys are unchanged', () => {
    expect(keysAt<Vec>([{ t: 0, v: [0, 0] }, { t: 1, v: [10, 20] }], 0.5)).toEqual([5, 10]);
  });
});

describe('flip test (check_motion_arcs)', () => {
  it('flags a straight, evenly spaced move and passes an eased arc', () => {
    const bad = motionReport(scene([mover([{ t: 0, v: [100, 500], ease: 'linear' }, { t: 1.5, v: [900, 500] }])]));
    expect(bad.issues.map((i) => i.kind).sort()).toEqual(['even-spacing', 'straight']);
    const good = motionReport(scene([mover([{ t: 0, v: [100, 500], ease: 'sine-in-out', arc: 0.25 }, { t: 1.5, v: [900, 500] }])]));
    expect(good.issues).toEqual([]);
  });
  it('flags a one-frame jump', () => {
    // Steady travel, then 300 px in a single frame, then steady again.
    const r = motionReport(scene([mover([{ t: 0, v: [100, 500], ease: 'linear' }, { t: 0.75, v: [350, 520], ease: 'linear' }, { t: 0.75 + 1 / 24, v: [650, 540], ease: 'linear' }, { t: 1.6, v: [900, 560] }])]));
    expect(r.issues.some((i) => i.kind === 'jump')).toBe(true);
  });
  it('flags a drawn character that changes size as it travels, and ignores pops', () => {
    const drift = motionReport(scene([{ id: 'd', type: 'drawing', drawing: { look: 'flat', items: [{ id: 'hero', kind: 'bot', size: 200, at: { k: [{ t: 0, v: [200, 600], ease: 'sine-in-out', arc: 0.3 }, { t: 1.5, v: [800, 600] }] }, scale: { k: [{ t: 0, v: 100 }, { t: 1.5, v: 140 }] } }] } } as Layer]));
    expect(drift.issues.map((i) => i.kind)).toContain('size-drift');
    const popped = motionReport(scene([{ id: 'd', type: 'drawing', drawing: { look: 'flat', items: [{ id: 'hero', kind: 'bot', size: 200, pop: 0.5, at: { k: [{ t: 0, v: [200, 600], ease: 'sine-in-out', arc: 0.3 }, { t: 1.5, v: [800, 600] }] } }] } } as Layer]));
    expect(popped.issues.map((i) => i.kind)).not.toContain('size-drift');
  });
});
