import { describe, expect, it } from 'vitest';
import type { HardwareInfo } from '../src/lib/ipc';
import { fitOf } from '../src/lib/modelFit';
import type { LibraryView } from '../src/lib/modelLibrary';
import { statusOfSize } from '../src/settings/libraryShared';
import { pcNote, STRATA_SPEEDS } from '../src/settings/llm/StrataPanel';

const hw = (name: string, vramGb: number | null, ramGb: number | null = 64): HardwareInfo => ({
  os: 'Windows', architecture: 'x64', threads: 16, cpu: null, ramGb, diskFreeGb: 500, gpus: [],
  nvidia: vramGb == null ? [] : [{ name, vramMb: vramGb * 1024, computeCap: 8.6 }],
});

const view = (state: Partial<LibraryView['state']>): LibraryView => ({
  entry: { id: 'qwen3.8-flash-next', runtime: 'strata' } as LibraryView['entry'],
  state: { installedVariant: null, installedVariants: [], installedAddons: [], enabled: false, accepted: null, download: null, partialBytes: 0, broken: null, ...state },
  thumbnailPath: null,
});

describe('pcNote', () => {
  it('is honest about a 10 GB card: it runs, more slowly than on 12 GB', () => {
    const note = pcNote(hw('NVIDIA GeForce RTX 3080', 10), 32);
    expect(note?.tone).toBe('warn');
    expect(note?.text).toMatch(/RTX 3080 has 10 GB of video memory/);
    expect(note?.text).toMatch(/more slowly than on a 12 GB card/);
    expect(note?.text).toMatch(/^Experimental on cards under 12 GB/);
    expect(note?.text).toMatch(/Qwen3.6 35B A3B through llama.cpp/);
    expect(note?.text).toMatch(/64 GB of RAM/);
  });
  it('is good news from 12 GB and bad news under 8 GB or without a card', () => {
    expect(pcNote(hw('RTX 5070', 12), 32)?.tone).toBe('ok');
    expect(pcNote(hw('GTX 1660', 6), 32)?.tone).toBe('bad');
    expect(pcNote(hw('x', null), 32)?.text).toMatch(/No NVIDIA graphics card/);
    expect(pcNote(null, 32)).toBeNull();
  });
  it('says when no size fits the memory', () => {
    expect(pcNote(hw('RTX 5070', 12, 16), 32)?.text).toMatch(/less than any size here needs \(32 GB/);
  });
});

describe('Strata sizes', () => {
  it('shows each size on its own: one downloaded, one downloading, one not', () => {
    const state = { installedVariants: ['iq2_xs'], installedVariant: 'iq2_xs', download: { jobId: 'j', variant: 'iq3_s', addons: [], bytesDone: 1, bytesTotal: 10 } };
    const card = view(state);
    expect(statusOfSize(card, undefined, 'iq2_xs').id).toBe('ready');
    expect(statusOfSize(card, undefined, 'iq3_s').id).toBe('downloading');
    expect(statusOfSize(card, undefined, 'q2_0').id).toBe('none');
  });
  it('stops showing a download that ended', () => {
    const card = view({ download: { jobId: 'j', variant: 'q2_0', addons: [], bytesDone: 1, bytesTotal: 10 } });
    const job = { id: 'j', status: 'done' } as Parameters<typeof statusOfSize>[1];
    expect(statusOfSize(card, job, 'q2_0').id).toBe('none');
  });
  it('fits by the size the installer reports, and a 10 GB card is under the 12 GB it likes', () => {
    const size = { minVramGb: 8, recVramGb: 12, minRamGb: 48, files: [], approxBytes: 74e9 };
    const result = fitOf(size, hw('RTX 3080', 10), { runtime: 'strata', freeGb: 50 });
    expect(result.fit).toBe('ok');
    expect(result.diskShort).toBe(true);
    expect(fitOf(size, hw('RTX 3080', 10), { runtime: 'strata', freeGb: 500 }).diskShort).toBe(false);
    expect(fitOf(size, hw('GTX 1660', 6), { runtime: 'strata' }).fit).toBe('no');
    expect(fitOf(size, hw('x', null), { runtime: 'strata' }).fit).toBe('nvidia');
  });
  it('carries Strata\'s own numbers for the sizes it measured', () => {
    expect(STRATA_SPEEDS.iq2_xs).toEqual({ short: 79, long: 63, prompt: 2090 });
    expect(Object.keys(STRATA_SPEEDS).sort()).toEqual(['coder-iq1_m', 'iq2_xs', 'iq3_s', 'iq3_xxs', 'q2_0']);
  });
});
