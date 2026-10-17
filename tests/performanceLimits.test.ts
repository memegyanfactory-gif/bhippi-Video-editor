import { describe, expect, it } from 'vitest';
import { memoryReadout, snapLimit, threadsReadout } from '../src/lib/modelFit';

describe('Settings › Performance readouts', () => {
  it('shows the threads and memory the default 75% allows', () => {
    expect(threadsReadout(16, 75)).toBe('Up to 12 of 16 threads');
    expect(memoryReadout(64, 75)).toBe('Up to 48 of 64 GB');
  });

  it('keeps at least one thread and shows a decimal only when needed', () => {
    expect(threadsReadout(2, 25)).toBe('Up to 1 of 2 threads');
    expect(threadsReadout(1, 100)).toBe('Up to 1 of 1 thread');
    expect(memoryReadout(31.9, 60)).toBe('Up to 19.1 of 31.9 GB');
  });

  it('falls back to the share while the hardware is unknown', () => {
    expect(threadsReadout(null, 75)).toBe('75% of the processor');
    expect(memoryReadout(null, 50)).toBe('50% of the memory');
  });

  it('snaps the slider to steps of five between 25 and 100, 75 by default', () => {
    expect(snapLimit(undefined)).toBe(75);
    expect(snapLimit(null)).toBe(75);
    expect(snapLimit(3)).toBe(25);
    expect(snapLimit(63)).toBe(65);
    expect(snapLimit(400)).toBe(100);
  });
});
