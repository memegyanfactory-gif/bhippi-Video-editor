// Completed Bhippi turns, deduplicated by id so reopening a transcript cannot spend twice.
// These are measured tokens from this app, not an account bill or external CLI history.
import type { Usage } from './types';

export type UsageRecord = { turnId: string; providerId: string; model: string | null; input: number; output: number; at: number };
const KEY = 'bhippi.usage.history.v1';
const listeners = new Set<() => void>();

function load(): UsageRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((row): row is UsageRecord => row && typeof row.turnId === 'string' && typeof row.providerId === 'string'
      && (row.model === null || typeof row.model === 'string') && Number.isFinite(row.input) && row.input >= 0 && Number.isFinite(row.output) && row.output >= 0 && Number.isFinite(row.at)) : [];
  } catch { return []; }
}
let records = load();
export const usageHistory = {
  get: () => records,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function recordUsageTurn(turnId: string, providerId: string, model: string | null, usage: Usage, at = Date.now()) {
  if (!turnId || !providerId || !Number.isFinite(at) || !Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens) || usage.inputTokens < 0 || usage.outputTokens < 0) return;
  const existing = records.find((row) => row.turnId === turnId);
  if (existing) return;
  records = [...records, { turnId, providerId, model, input: Math.round(usage.inputTokens), output: Math.round(usage.outputTokens), at }];
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* Keep live counts when storage is unavailable. */ }
  listeners.forEach((listener) => listener());
}

export type UsageRange = 'today' | 'week' | 'month' | 'all';
export function usageSummary(rows: readonly UsageRecord[], range: UsageRange, providerId = '', model = '', now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const since = range === 'today' ? midnight.getTime() : range === 'week' ? now - 7 * 86400000 : range === 'month' ? now - 30 * 86400000 : 0;
  const filtered = rows.filter((row) => row.at >= since && row.at <= now && (!providerId || row.providerId === providerId) && (!model || row.model === model));
  const groups = new Map<string, { providerId: string; model: string | null; input: number; output: number; turns: number; at: number }>();
  let input = 0, output = 0;
  for (const row of filtered) {
    input += row.input; output += row.output;
    const key = JSON.stringify([row.providerId, row.model]);
    const previous = groups.get(key);
    groups.set(key, { providerId: row.providerId, model: row.model, input: (previous?.input ?? 0) + row.input, output: (previous?.output ?? 0) + row.output, turns: (previous?.turns ?? 0) + 1, at: Math.max(row.at, previous?.at ?? 0) });
  }
  return { input, output, turns: filtered.length, groups: [...groups.values()].sort((a, b) => b.input + b.output - a.input - a.output) };
}
