import { describe, expect, it } from 'vitest';
import type { BrainNode } from '../src/lib/ipc';
import { learningCurve } from '../src/settings/brainCurve';

const turn = (i: number, ok: boolean): BrainNode => {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
  return { id: `ep-${i}`, kind: 'episode', title: `turn ${i}`, weight: 1, uses: 1, wins: ok ? 1 : 0, fails: ok ? 0 : 1, created: stamp, updated: stamp };
};

describe('learning curve', () => {
  it('compares the newest turns with the ones before them, in time order', () => {
    // 40 turns that mostly failed, then 30 that mostly worked, handed over shuffled.
    const nodes = [
      ...Array.from({ length: 40 }, (_, i) => turn(i, i % 4 === 0)),
      ...Array.from({ length: 30 }, (_, i) => turn(40 + i, i % 5 !== 0)),
    ].reverse();
    const curve = learningCurve(nodes, 7, 30);
    expect(curve.turns).toBe(70);
    expect(curve.recent).toBeCloseTo(24 / 30);
    expect(curve.earlier).toBeCloseTo(7 / 30);
    expect(curve.points).toHaveLength(7);
    expect(curve.points[0]).toMatchObject({ first: 1, last: 10 });
    expect(curve.points[6].rate).toBeGreaterThan(curve.points[0].rate);
  });

  it('ignores everything but turns and says nothing to compare when there are few', () => {
    const tool: BrainNode = { ...turn(0, true), id: 'tool:x', kind: 'tool' };
    const curve = learningCurve([tool, turn(1, true), turn(2, false)]);
    expect(curve.turns).toBe(2);
    expect(curve.recent).toBeNull();
    expect(curve.earlier).toBeNull();
    expect(curve.points).toEqual([{ first: 1, last: 2, rate: 0.5 }]);
  });
});
