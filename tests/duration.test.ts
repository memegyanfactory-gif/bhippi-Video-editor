import { describe, expect, it } from 'vitest';
import { addStretch, formatDuration } from '../src/lib/duration';

describe('formatDuration', () => {
  it('rolls seconds into minutes, minutes into hours, hours into days', () => {
    expect(formatDuration(3140)).toBe('3.1s');
    expect(formatDuration(9990)).toBe('9.9s');
    expect(formatDuration(42_400)).toBe('42s');
    expect(formatDuration(59_999)).toBe('59s');
    expect(formatDuration(60_000)).toBe('1m 00s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatDuration(10_468_000)).toBe('2h 54m');
    expect(formatDuration(10_360_000)).toBe('2h 52m');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(97_200_000)).toBe('1d 3h');
  });

  it('drops the tenths for a clock that ticks once a second', () => {
    expect(formatDuration(3140, { tenths: false })).toBe('3s');
    expect(formatDuration(125_000, { tenths: false })).toBe('2m 05s');
  });

  it('never shows a negative or broken time', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });
});

describe('addStretch', () => {
  it('adds only the time between start and end', () => {
    expect(addStretch(0, 1_000, 4_000)).toBe(3_000);
    expect(addStretch(3_000, 10_000, 12_500)).toBe(5_500);
  });

  it('adds nothing when the clock ran backwards', () => {
    expect(addStretch(2_000, 5_000, 4_000)).toBe(2_000);
  });
});
