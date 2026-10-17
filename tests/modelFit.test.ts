import { describe, expect, it } from 'vitest';
import type { HardwareInfo } from '../src/lib/ipc';
import { defaultVariant, fitOf, formatBytes, formatEta, formatGb, formatProgress, taskLabel, totalBytes, variantBytes } from '../src/lib/modelFit';

const hw = (vramGb: number | null, ramGb: number | null = 64): HardwareInfo => ({
  os: 'Windows', architecture: 'x64', threads: 16, cpu: null, ramGb, diskFreeGb: 500, gpus: [],
  nvidia: vramGb == null ? [] : [{ name: 'RTX Test', vramMb: vramGb * 1024, computeCap: 8.9 }],
});
const variant = { minVramGb: 10, recVramGb: 24, minRamGb: 48, files: [{ url: 'u', dest: 'a', bytes: 40e9 }] };

describe('fitOf', () => {
  it('is checking until the hardware is read', () => {
    expect(fitOf(variant, null).fit).toBe('checking');
  });
  it('needs NVIDIA for ComfyUI models but not for llama.cpp', () => {
    expect(fitOf(variant, hw(null), { runtime: 'comfyui' }).fit).toBe('nvidia');
    expect(fitOf(variant, hw(null), { runtime: 'llama-cpp' }).fit).toBe('slow');
  });
  it('runs well at the recommended VRAM', () => {
    expect(fitOf(variant, hw(24)).fit).toBe('great');
  });
  it('runs with a small squeeze and slowly with a big one', () => {
    expect(fitOf(variant, hw(16)).fit).toBe('ok');
    expect(fitOf(variant, hw(12)).fit).toBe('slow');
  });
  it('is too big under the minimum VRAM or RAM', () => {
    expect(fitOf(variant, hw(8)).fit).toBe('no');
    expect(fitOf(variant, hw(24, 32)).fit).toBe('no');
  });
  it('lets an LLM run mostly on the processor below its VRAM floor', () => {
    expect(fitOf(variant, hw(6), { runtime: 'llama-cpp' }).fit).toBe('slow');
  });
  it('flags a short disk without changing the verdict', () => {
    const result = fitOf(variant, hw(24), { freeGb: 41 });
    expect(result.fit).toBe('great');
    expect(result.diskShort).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/41 GB is free/);
    expect(fitOf(variant, hw(24), { freeGb: 100 }).diskShort).toBe(false);
  });
});

describe('sizes', () => {
  it('counts a shared file once', () => {
    const files = [{ url: 'u', dest: 'x', bytes: 5 }];
    expect(totalBytes({ files }, [{ files }, { files: [{ url: 'v', dest: 'y', bytes: 2 }] }])).toBe(7);
  });
  it('formats bytes', () => {
    expect(formatBytes(40.1e9)).toBe('40.1 GB');
    expect(formatBytes(812e6)).toBe('812 MB');
    expect(formatBytes(0)).toBe('0 B');
  });
  it('formats a time left', () => {
    expect(formatEta(1e9, 0)).toBeNull();
    expect(formatEta(1e9, 1e6)).toBe('about 17 min');
    expect(formatEta(1e6, 1e6)).toBe('under a minute');
  });
});

describe('labels and art', () => {
  it('words the tasks, and keeps unknown ones', () => {
    expect(taskLabel('t2va')).toBe('Text to video with sound');
    expect(taskLabel('fl2va')).toBe('First and last frame');
    expect(taskLabel('weird')).toBe('weird');
  });
});

describe('sizes in words', () => {
  it('uses the installer estimate when no files are listed', () => {
    expect(variantBytes({ files: [], approxBytes: 3e9 })).toBe(3e9);
    expect(variantBytes({ files: [{ url: 'u', dest: 'a', bytes: 5 }], approxBytes: 3e9 })).toBe(5);
    expect(variantBytes({ files: [] })).toBe(0);
  });
  it('shows free space in TB from 1000 GB', () => {
    expect(formatGb(2712)).toBe('2.7 TB');
    expect(formatGb(812)).toBe('812 GB');
    expect(formatGb(41.5)).toBe('41.5 GB');
  });
  it('words progress in the unit of the total', () => {
    expect(formatProgress(12.4e9, 40.1e9)).toBe('12.4 of 40.1 GB');
    expect(formatProgress(120e6, 812e6)).toBe('120 of 812 MB');
  });
});

describe('defaultVariant', () => {
  const big = { ...variant, default: true };
  const small = { minVramGb: 6, recVramGb: 8, minRamGb: 16, files: [{ url: 'u', dest: 'b', bytes: 5e9 }] };
  it('keeps the catalog default when it is as good as any', () => {
    expect(defaultVariant([big, small], hw(24))).toBe(big);
  });
  it('picks one that fits when the default does not', () => {
    expect(defaultVariant([big, small], hw(8, 16))).toBe(small);
  });
});
