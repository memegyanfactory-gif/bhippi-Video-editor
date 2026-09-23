import { describe, expect, it } from 'vitest';
import { MAX_HOLD, readClocks, registerClock, stepPlayhead } from '../src/lib/masterClock';

const tick = 1 / 30;

describe('master clock', () => {
  it('runs on the wall clock when no media is playing', () => {
    expect(stepPlayhead(2, tick, 1, 0, [])).toEqual({ next: 2 + tick, held: 0 });
  });

  it('waits for media that is starting instead of running ahead of it', () => {
    // The first play: every element is cold. The old wall clock moved on regardless, the audio
    // fell past its resync threshold and got seeked, and the sound cut in and out.
    let at = { next: 5, held: 0 };
    for (let i = 0; i < 10; i++) at = stepPlayhead(at.next, tick, 1, at.held, [{ priority: 2, starting: true }]);
    expect(at.next).toBe(5);
    expect(at.held).toBeCloseTo(10 * tick);
  });

  it('follows the playing media, preferring audio to picture', () => {
    const step = stepPlayhead(5, tick, 1, 0.2, [{ priority: 1, time: 5.02 }, { priority: 2, time: 5.03 }]);
    expect(step).toEqual({ next: 5.03, held: 0 });
  });

  it('follows playing media even while another element is still starting', () => {
    expect(stepPlayhead(5, tick, 1, 0, [{ priority: 2, starting: true }, { priority: 2, time: 5.03 }]).next).toBe(5.03);
  });

  it('never steps backwards while playing forwards', () => {
    expect(stepPlayhead(5, tick, 1, 0, [{ priority: 2, time: 4.98 }]).next).toBe(5);
  });

  it('ignores media that is far from the playhead (it is being resynced)', () => {
    expect(stepPlayhead(5, tick, 1, 0, [{ priority: 2, time: 9 }]).next).toBeCloseTo(5 + tick);
  });

  it('gives up waiting on media that never starts, once, not every MAX_HOLD', () => {
    const stuck = [{ priority: 2, starting: true as const }];
    let at = { next: 1, held: 0 };
    let steps = 0;
    while (at.next === 1 && steps < 200) {
      at = stepPlayhead(at.next, tick, 1, at.held, stuck);
      steps++;
    }
    expect(steps * tick).toBeGreaterThanOrEqual(MAX_HOLD);
    expect(steps * tick).toBeLessThan(MAX_HOLD + 2 * tick);
    // From here it keeps moving: it does not freeze again for another MAX_HOLD.
    const before = at.next;
    for (let i = 0; i < 30; i++) at = stepPlayhead(at.next, tick, 1, at.held, stuck);
    expect(at.next).toBeCloseTo(before + 30 * tick);
    // And media that starts again takes over and clears the hold.
    expect(stepPlayhead(at.next, tick, 1, at.held, [{ priority: 2, time: at.next + 0.01 }]).held).toBe(0);
  });

  it('leaves reverse and shuttle-back play on the wall clock', () => {
    expect(stepPlayhead(5, tick, -2, 0, [{ priority: 2, time: 5.5 }]).next).toBeCloseTo(5 - 2 * tick);
  });

  it('accepts a proportionally larger gap when fast-forwarding', () => {
    expect(stepPlayhead(5, tick, 4, 0, [{ priority: 2, time: 6.5 }]).next).toBe(6.5);
  });

  it('registers and unregisters element readings', () => {
    const stop = registerClock(() => ({ priority: 2, time: 3 }));
    const silent = registerClock(() => null);
    expect(readClocks()).toEqual([{ priority: 2, time: 3 }]);
    stop();
    silent();
    expect(readClocks()).toEqual([]);
  });
});
