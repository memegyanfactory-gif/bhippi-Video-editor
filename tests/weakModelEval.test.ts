// The weak-model template eval (src/lib/templateEval.ts): every house and brand template fed the
// input small models send, scored on what it builds. The floor below only ever goes up.
// BENCH_WRITE=1 npx vitest run tests/weakModelEval.test.ts  rewrites docs/benchmarks/weak-models.md.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evalCases, reportMarkdown, scoreCase, summarize } from '../src/lib/templateEval';
import { runCase as run } from './evalHost';

/** The share of cases a small model gets to a good graphic (at once, or after one clear error). */
const FLOOR = 1;

describe('weak-model template eval', () => {
  it('scores every template against the input small models send', async () => {
    const cases = evalCases();
    expect(cases.length).toBeGreaterThan(120);
    const scored = [];
    for (const c of cases) scored.push(scoreCase(c, await run(c)));
    const report = summarize(scored);
    if (process.env.BENCH_WRITE) writeFileSync('docs/benchmarks/weak-models.md', reportMarkdown(report, 'Weak-model template eval'));
    console.log(`weak-model eval: ${Math.round(report.score * 100)}% usable — ${report.good} good, ${report.recoverable} recoverable, ${report.bad} bad of ${report.total}`);
    // Clean input must always build right: the control.
    expect(report.byProfile.clean.bad, reportMarkdown(report, 'eval')).toBe(0);
    expect(report.score).toBeGreaterThanOrEqual(FLOOR);
  }, 120_000);
});
