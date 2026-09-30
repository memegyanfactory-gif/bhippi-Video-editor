import { describe, expect, it } from 'vitest';
import { recordUsageTurn, usageHistory, usageSummary, type UsageRecord } from '../src/lib/usageHistory';
describe('usage history', () => {
  it('replayed or duplicated completion events count once', () => {
    recordUsageTurn('dedup-turn', 'codex', 'gpt', { inputTokens: 100, outputTokens: 20 });
    recordUsageTurn('dedup-turn', 'codex', 'gpt', { inputTokens: 100, outputTokens: 20 });
    expect(usageHistory.get().filter((row) => row.turnId === 'dedup-turn')).toHaveLength(1);
  });
  it('filters dates and providers without mixing identical model names', () => {
    const now = new Date(2026, 8, 30, 12).getTime();
    const row = (turnId: string, providerId: string, at: number): UsageRecord => ({ turnId, providerId, model: 'same', input: 100, output: 20, at });
    const rows = [row('a', 'codex', now), row('b', 'claude', now), row('c', 'codex', now - 10 * 86400000)];
    expect(usageSummary(rows, 'week', 'codex', 'same', now)).toMatchObject({ input: 100, output: 20, turns: 1 });
    expect(usageSummary(rows, 'all', '', '', now).groups).toHaveLength(2);
    expect(usageSummary(rows, 'today', '', '', now).turns).toBe(2);
  });
});
