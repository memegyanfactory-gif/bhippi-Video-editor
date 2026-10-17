// How local-model speeds are put into words: live speeds of the running model, the "Tuned:" line,
// the list of speed-ups that are on, and how a tuning job is found among the jobs. Only what was
// measured is claimed; a token is about three quarters of a word.
import type { Job } from './types';
import type { LlmRunning, LlmTuning, StrataSpeedCheck } from './modelLibrary';

/** Words a second from tokens a second (a word is about 1.33 tokens). */
export const wordsPerSecond = (tokensPerSecond: number): number => Math.max(1, Math.round(tokensPerSecond * 0.75));

const group = (value: number): string => Math.round(value).toLocaleString('en-US');

/** "Writing 38 words/s · Reading 1,450 tokens/s", or null when nothing was measured yet. */
export const liveSpeedText = (running: Pick<LlmRunning, 'decodeTokensPerSecond' | 'prefillTokensPerSecond'> | null | undefined): string | null => {
  if (!running) return null;
  const parts: string[] = [];
  if (running.decodeTokensPerSecond && running.decodeTokensPerSecond > 0) parts.push(`Writing ${wordsPerSecond(running.decodeTokensPerSecond)} words/s`);
  if (running.prefillTokensPerSecond && running.prefillTokensPerSecond > 0) parts.push(`Reading ${group(running.prefillTokensPerSecond)} tokens/s`);
  return parts.length ? parts.join(' · ') : null;
};

/** "Tuned: 38 words/s writing · 1,450 tokens/s reading". */
export const tunedText = (tuning: Pick<LlmTuning, 'decodeTokensPerSecond' | 'prefillTokensPerSecond'>): string =>
  `Tuned: ${wordsPerSecond(tuning.decodeTokensPerSecond)} words/s writing · ${group(tuning.prefillTokensPerSecond)} tokens/s reading`;

/** "Speed-ups on: Expert cache, MTP, Prompt cache", or null when none are on. */
export const speedupsText = (running: Pick<LlmRunning, 'speedups'> | null | undefined): string | null =>
  running && running.speedups && running.speedups.length ? `Speed-ups on: ${running.speedups.join(', ')}` : null;

/** What a Strata size measured on this PC after its first start, in words; null when there is no reading. */
export const strataMeasuredText = (check: Pick<StrataSpeedCheck, 'decodeTokensPerSecond' | 'prefillTokensPerSecond'> | undefined): string | null => {
  if (!check) return null;
  return liveSpeedText({ decodeTokensPerSecond: check.decodeTokensPerSecond, prefillTokensPerSecond: check.prefillTokensPerSecond });
};

/** The tuning job of a model: the running one, else the newest finished one. */
export const tuneJobFor = (jobs: Job[], modelName: string): Job | undefined => {
  const label = `Tuning ${modelName} for this PC`;
  const mine = jobs.filter((job) => job.kind === 'model' && job.label === label);
  return mine.find((job) => job.status === 'running') ?? mine[mine.length - 1];
};
