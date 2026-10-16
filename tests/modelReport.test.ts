import { describe, expect, it } from 'vitest';
import { faultSummary, formatPercent, phaseLabel, sortByRecentUse, unsuitableRows, type ModelReportRow } from '../src/settings/modelReport';

const row = (over: Partial<ModelReportRow>): ModelReportRow => ({
  model: 'm', providerId: 'p', tier: 'full', turns: 1, toolCalls: 0, failedCalls: 0, failRate: 0, identicalRetries: 0, emptyArgFailures: 0,
  faults: {}, zeroToolTurns: 0, verifiedTurns: 0, avgToolCalls: 0, lastUsed: 0, phases: [], topFailingTools: [], verdict: 'good', reason: '', ...over,
});

describe('model report helpers', () => {
  it('sorts by recent use without mutating', () => {
    const rows = [row({ model: 'a', lastUsed: 1 }), row({ model: 'b', lastUsed: 9 }), row({ model: 'c', lastUsed: 9, turns: 5 })];
    expect(sortByRecentUse(rows).map((r) => r.model)).toEqual(['c', 'b', 'a']);
    expect(rows[0].model).toBe('a');
  });
  it('picks the unsuitable models', () => {
    expect(unsuitableRows([row({ model: 'a' }), row({ model: 'b', verdict: 'not suitable' })]).map((r) => r.model)).toEqual(['b']);
  });
  it('formats rates, faults and phases', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.004)).toBe('<1%');
    expect(formatPercent(0.857)).toBe('86%');
    expect(faultSummary({ unknown: 1, empty_answer: 8 })).toBe('8× no answer, 1× error');
    expect(phaseLabel('plan-ready')).toBe('plan ready');
    expect(phaseLabel('none')).toBe('no phase');
  });
});
