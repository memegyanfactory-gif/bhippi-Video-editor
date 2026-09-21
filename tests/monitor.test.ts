import { describe, expect, it } from 'vitest';
import { clampPct, isCriticalJob, sparkPoints } from '../src/components/ResourceMonitor';

describe('live monitor helpers', () => {
  it('clamps bar math instead of drawing garbage', () => {
    expect(clampPct(42)).toBe(42);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(Number.NaN)).toBe(0);
  });

  it('treats long expensive jobs as critical, quick ones as not', () => {
    expect(isCriticalJob({ kind: 'export' })).toBe(true);
    expect(isCriticalJob({ kind: 'generation' })).toBe(true);
    expect(isCriticalJob({ kind: 'model' })).toBe(true);
    expect(isCriticalJob({ kind: 'transcribe' })).toBe(false);
    expect(isCriticalJob({ kind: 'media' })).toBe(false);
  });

  it('draws sparkline points inside the viewBox', () => {
    expect(sparkPoints([], 60, 16)).toBe('');
    const points = sparkPoints([0, 50, 100], 60, 16).split(' ');
    expect(points).toHaveLength(3);
    expect(points[0]).toBe('0.0,16.0');
    expect(points[2]).toBe('60.0,0.0');
  });
});
