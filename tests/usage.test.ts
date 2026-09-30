import { beforeEach, describe, expect, it } from 'vitest';
import * as usage from '../src/lib/usage';

describe('provider usage snapshots', () => {
  beforeEach(() => usage.clear());

  it('keeps Codex token usage visible when no quota windows are reported', () => {
    usage.recordTokens('codex', 'gpt-5', 1200, 340);
    const snapshot = usage.forProvider('codex');
    expect(snapshot?.tokens).toEqual({ input: 1200, output: 340 });
    expect(usage.standing(snapshot)).toBe('unknown');
  });
});

// OpenCode on a free model was refused once ("overloaded", no reset time) and the meter said
// "OpenCode is out" forever after, through every turn that worked.
describe('a refusal without a reset time', () => {
  beforeEach(() => usage.clear());
  it('shares account quotas while keeping each model’s token counts separate', () => {
    const now = Date.now();
    usage.recordTokens('codex', 'model-a', 12800000, 26100, now);
    usage.recordTokens('codex', 'model-b', 1000, 200, now);
    usage.recordAccountLimits('codex', { used: 0.13, resetsAt: now / 1000 + 5000 }, null, now, 'Weekly · all models', '');
    expect(usage.forProvider('codex', 'model-a')?.tokens?.input).toBe(12800000);
    expect(usage.forProvider('codex', 'model-b')?.tokens?.input).toBe(1000);
    expect(usage.worst(usage.forProvider('codex', 'model-b')).used).toBe(0.13);
    expect(usage.forProvider('codex', 'new-model')?.tokens).toBeUndefined();
    expect(usage.forProvider('codex', 'new-model')?.session?.used).toBe(0.13);
    expect(usage.forProvider('claude', 'model-b')).toBeNull();
  });

  it('holds the provider out only briefly', () => {
    const now = Date.now();
    usage.recordExhausted('opencode', 'opencode/big-pickle', null, now);
    const snapshot = usage.forProvider('opencode');
    expect(usage.standing(snapshot, now)).toBe('exhausted');
    expect(usage.standing(snapshot, now + usage.REFUSAL_HOLD_MS + 1000)).toBe('unknown');
  });

  it('is cleared by the next turn that answers', () => {
    usage.recordExhausted('opencode', 'opencode/big-pickle', null);
    usage.recordTokens('opencode', 'opencode/big-pickle', 66, 13175);
    expect(usage.standing(usage.forProvider('opencode'))).toBe('exhausted');
    usage.recordSuccess('opencode');
    expect(usage.standing(usage.forProvider('opencode'))).toBe('unknown');
  });

  it('heals the stuck snapshot older builds saved', () => {
    const stuck = {
      providerId: 'opencode', model: 'opencode/big-pickle', status: 'rejected', session: { used: 1, resetsAt: null },
      weekly: null, plan: null, tokens: { input: 66, output: 13175 }, at: 1790153623003, exhaustedUntil: null,
    };
    expect(usage.standing(stuck)).toBe('exhausted');
    expect(usage.standing(usage.heal(stuck))).toBe('unknown');
  });

  it('keeps a real spent window until it rolls over', () => {
    const now = Date.now();
    const resetsAt = Math.round(now / 1000) + 3600;
    usage.record('claude', 'opus', { status: 'rejected', sessionUsed: 1, sessionResetsAt: resetsAt, weeklyUsed: 0.4, weeklyResetsAt: null, at: now });
    const snapshot = usage.forProvider('claude');
    expect(usage.standing(snapshot, now)).toBe('exhausted');
    expect(usage.standing(snapshot, (resetsAt + 5) * 1000)).toBe('ok');
  });
});

describe('switching providers and models', () => {
  beforeEach(() => usage.clear());
  it('keeps completed tokens through account refreshes and automatic model selection', () => {
    usage.recordTokens('codex', 'gpt', 100, 20, 100);
    usage.recordAccountLimits('codex', { used: 0.13, resetsAt: null }, null, 200, 'Weekly', '');
    expect(usage.forProvider('codex')?.tokens).toEqual({ input: 100, output: 20 });
    usage.recordTokens('codex', null, 30, 5, 300);
    usage.recordAccountLimits('codex', { used: 0.14, resetsAt: null }, null, 400, 'Weekly', '');
    expect(usage.all().find((row) => row.account)?.tokens).toEqual({ input: 30, output: 5 });
    expect(usage.forProvider('codex', 'unseen')?.tokens).toBeUndefined();
    expect(usage.forProvider('codex', 'unseen')?.session?.used).toBe(0.14);
  });
  it('never relabels one model’s tokens or limits as another model', () => {
    usage.record('claude', 'opus', { status: 'allowed', sessionUsed: 0.9, sessionResetsAt: null, weeklyUsed: null, weeklyResetsAt: null });
    usage.recordTokens('claude', 'opus', 100, 50);
    usage.recordTokens('claude', 'sonnet', 20, 5);
    expect(usage.forProvider('claude', 'opus')?.tokens).toEqual({ input: 100, output: 50 });
    expect(usage.forProvider('claude', 'sonnet')?.session).toBeNull();
    expect(usage.usageLabel(usage.forProvider('claude', 'sonnet'))).toBe('25 tokens');
    expect(usage.forProvider('codex', 'opus')).toBeNull();
    expect(usage.forProvider('claude', 'haiku')).toBeNull();
    expect(usage.usageLabel(null)).toBe('Usage unavailable');
  });
  it('clears a refusal only on the model that answered', () => {
    usage.recordExhausted('opencode', 'a', null);
    usage.recordExhausted('opencode', 'b', null);
    usage.recordSuccess('opencode', 'b');
    expect(usage.standing(usage.forProvider('opencode', 'a'))).toBe('exhausted');
    expect(usage.standing(usage.forProvider('opencode', 'b'))).toBe('unknown');
  });
  it('does not make old limits fresh when new tokens arrive or logs reopen', () => {
    usage.record('claude', 'opus', { status: 'allowed', sessionUsed: 0.2, sessionResetsAt: null, weeklyUsed: null, weeklyResetsAt: null, at: 100 });
    usage.recordTokens('claude', 'opus', 300, 30, 300);
    usage.recordTokens('claude', 'opus', 100, 10, 200);
    usage.record('claude', 'opus', { status: 'allowed', sessionUsed: 0.1, sessionResetsAt: null, weeklyUsed: null, weeklyResetsAt: null, at: 50 });
    expect(usage.forProvider('claude', 'opus')).toMatchObject({ limitsAt: 100, tokensAt: 300, tokens: { input: 300, output: 30 }, session: { used: 0.2 } });
  });
  it('migrates provider-only storage to the original model and ignores malformed readings', () => {
    const row = { providerId: 'codex', model: 'gpt', at: 10, status: 'reported', tokens: { input: 20, output: 2 }, session: null, weekly: null, plan: null, exhaustedUntil: null };
    const decoded = usage.decodeSnapshots(JSON.stringify({ codex: row, broken: { providerId: 2 }, invalid: { ...row, providerId: 'other', session: { used: 'bad' }, tokens: { input: -2, output: 1 } } }));
    expect(decoded[JSON.stringify(['codex', 'gpt'])]?.tokens).toEqual({ input: 20, output: 2 });
    expect(decoded[JSON.stringify(['other', 'gpt'])]?.session).toBeNull();
    expect(decoded[JSON.stringify(['other', 'gpt'])]?.tokens).toBeNull();
    expect(Object.keys(decoded)).toHaveLength(2);
  });
});

describe('reset windows and conversation totals', () => {
  beforeEach(() => usage.clear());
  it('an expired session cannot hide a weekly limit that is still exhausted', () => {
    const now = Date.now();
    usage.record('claude', 'opus', { status: 'allowed', sessionUsed: 1, sessionResetsAt: now / 1000 - 1, weeklyUsed: 1, weeklyResetsAt: now / 1000 + 3600 });
    expect(usage.worst(usage.forProvider('claude', 'opus'), now).window).toBe('weekly');
    expect(usage.standing(usage.forProvider('claude', 'opus'), now)).toBe('exhausted');
  });
  it('all expired readings become unknown instead of displaying a fabricated 0%', () => {
    const now = Date.now();
    usage.record('claude', 'opus', { status: 'allowed', sessionUsed: 1, sessionResetsAt: now / 1000 - 1, weeklyUsed: null, weeklyResetsAt: null });
    expect(usage.standing(usage.forProvider('claude', 'opus'), now)).toBe('unknown');
    expect(usage.usageLabel(usage.forProvider('claude', 'opus'), now)).toBe('Usage unavailable');
  });
  it('sums only measured completed turns for the selected provider and model', () => {
    const turn = (id: string, providerId: string, model: string, status = 'done', inputTokens = 10): usage.UsageTurn => ({ turnId: id, providerId, model, status, usage: { inputTokens, outputTokens: 2 } });
    const turns = [turn('a', 'codex', 'gpt'), turn('a', 'codex', 'gpt'), turn('b', 'claude', 'gpt'), turn('c', 'codex', 'other'), turn('d', 'codex', 'gpt', 'streaming'), { ...turn('e', 'codex', 'gpt'), usage: null }];
    expect(usage.summarizeTurns(turns, 'codex', 'gpt')).toEqual({ input: 10, output: 2, reported: 1, missing: 1 });
    expect(usage.summarizeTurns(turns, 'codex', null).reported).toBe(2);
  });
});
