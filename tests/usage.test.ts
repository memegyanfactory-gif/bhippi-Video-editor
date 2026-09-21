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
