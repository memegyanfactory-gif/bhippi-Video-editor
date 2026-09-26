import { describe, expect, it } from 'vitest';
import { LOCAL_MODELS, assess, formatMinutes, machineCeiling, recommend, speedFactor } from '../src/lib/modelAdvisor';
import type { HardwareInfo } from '../src/lib/ipc';

const machine = (vramMb: number | null, ramGb = 32, name = 'NVIDIA GeForce RTX 4070', computeCap: number | null = 8.9): HardwareInfo => ({
  os: 'windows', architecture: 'x86_64', threads: 16, cpu: 'Test CPU', ramGb, diskFreeGb: 500,
  gpus: [name], adapters: [{ name, vramMb }],
  nvidia: vramMb == null ? [] : [{ name, vramMb, computeCap }],
});
const model = (task: string) => LOCAL_MODELS.find((m) => m.task === task)!;

describe('model advisor', () => {
  it('refuses every local model without an NVIDIA card', () => {
    const amd: HardwareInfo = { ...machine(null), gpus: ['AMD Radeon RX 7900 XTX'], adapters: [{ name: 'AMD Radeon RX 7900 XTX', vramMb: 24576 }] };
    for (const m of LOCAL_MODELS) expect(assess(m, amd).fit).toBe('no');
    expect(assess(model('image'), amd).reasons[0]).toContain('not an NVIDIA card');
    expect(recommend('video', amd)).toBeNull();
    expect(machineCeiling('video', amd).quality).toBe(0);
  });

  it('refuses a model that does not fit in VRAM or RAM', () => {
    expect(assess(model('video-wan22'), machine(8 * 1024)).fit).toBe('no');
    expect(assess(model('video-wan22'), machine(24 * 1024, 16)).fit).toBe('no');
  });

  it('marks a squeezed model as slow and a roomy one as great', () => {
    expect(assess(model('image'), machine(12 * 1024)).fit).toBe('great');
    expect(assess(model('image-flux'), machine(12 * 1024)).fit).toBe('slow');
    expect(assess(model('video-wan22'), machine(24 * 1024, 64, 'NVIDIA GeForce RTX 4090')).fit).toBe('great');
  });

  it('recommends the best model that runs acceptably, never a slow one', () => {
    expect(recommend('video', machine(12 * 1024))?.task).not.toBe('video-wan22');
    expect(recommend('video', machine(24 * 1024, 64, 'NVIDIA GeForce RTX 4090'))?.task).toBe('video-wan22');
    expect(recommend('image', machine(8 * 1024, 16))?.task).toBe('image');
    expect(recommend('image', machine(24 * 1024, 64, 'NVIDIA GeForce RTX 4090'))?.task).toBe('image-flux');
  });

  it('warns when the download will not fit on disk', () => {
    const full = { ...machine(24 * 1024, 64), diskFreeGb: 10 };
    expect(assess(model('video-wan22'), full).diskShort).toBe(true);
    expect(recommend('video', full)).toBeNull();
  });

  it('ranks older cards slower', () => {
    expect(speedFactor('NVIDIA GeForce GTX 1080', 6.1)).toBeGreaterThan(speedFactor('NVIDIA GeForce RTX 3060', 8.6));
    expect(speedFactor('Unknown card', 8.9)).toBe(2);
    expect(formatMinutes([0.1, 0.2])).toBe('6–12 s');
    expect(formatMinutes([2, 4])).toBe('2–4 min');
  });
});
