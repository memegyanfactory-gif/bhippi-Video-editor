import { describe, expect, it } from 'vitest';
import { liveSpeedText, speedupsText, strataMeasuredText, tuneJobFor, tunedText, wordsPerSecond } from '../src/lib/llmSpeed';
import type { Job } from '../src/lib/types';

const job = (patch: Partial<Job>): Job => ({ id: 'j', kind: 'model', label: 'Tuning Qwen3.6 35B A3B for this PC', status: 'running', progress: 0, message: '', result: null, cancellable: true, ...patch });

describe('speeds in words', () => {
  it('turns tokens into words at three quarters', () => {
    expect(wordsPerSecond(51)).toBe(38);
    expect(wordsPerSecond(0.2)).toBe(1);
  });

  it('shows the live writing and reading speeds, and nothing when nothing was measured', () => {
    expect(liveSpeedText({ decodeTokensPerSecond: 51, prefillTokensPerSecond: 1450 })).toBe('Writing 38 words/s · Reading 1,450 tokens/s');
    expect(liveSpeedText({ decodeTokensPerSecond: 51, prefillTokensPerSecond: null })).toBe('Writing 38 words/s');
    expect(liveSpeedText({ decodeTokensPerSecond: null, prefillTokensPerSecond: null })).toBeNull();
    expect(liveSpeedText(null)).toBeNull();
  });

  it('reads the tuned result as the screen promises', () => {
    expect(tunedText({ decodeTokensPerSecond: 51, prefillTokensPerSecond: 1450 })).toBe('Tuned: 38 words/s writing · 1,450 tokens/s reading');
  });

  it('lists the speed-ups that are on', () => {
    expect(speedupsText({ speedups: ['Expert cache', 'MTP', 'Prompt cache'] })).toBe('Speed-ups on: Expert cache, MTP, Prompt cache');
    expect(speedupsText({ speedups: [] })).toBeNull();
    expect(speedupsText(null)).toBeNull();
  });

  it('shows what Strata measured on this PC', () => {
    expect(strataMeasuredText({ decodeTokensPerSecond: 20, prefillTokensPerSecond: null })).toBe('Writing 15 words/s');
    expect(strataMeasuredText(undefined)).toBeNull();
  });
});

describe('tuning jobs', () => {
  it('finds the running tuning job of a model, else its newest', () => {
    const done = job({ id: 'a', status: 'done' });
    const running = job({ id: 'b' });
    const other = job({ id: 'c', label: 'Tuning gpt-oss 20B for this PC' });
    const download = job({ id: 'd', kind: 'install', label: 'Tuning Qwen3.6 35B A3B for this PC' });
    expect(tuneJobFor([done, running, other, download], 'Qwen3.6 35B A3B')?.id).toBe('b');
    expect(tuneJobFor([done, other], 'Qwen3.6 35B A3B')?.id).toBe('a');
    expect(tuneJobFor([other], 'Qwen3.6 35B A3B')).toBeUndefined();
  });
});
