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
