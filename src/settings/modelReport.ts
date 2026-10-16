/** Pure helpers for the Settings → Brain model report card (data comes from `brain_report`). */
export type ModelVerdict = 'good' | 'struggling' | 'not suitable';

export type ModelReportRow = {
  model: string;
  providerId: string;
  tier: string;
  turns: number;
  toolCalls: number;
  failedCalls: number;
  failRate: number;
  identicalRetries: number;
  emptyArgFailures: number;
  faults: Record<string, number>;
  zeroToolTurns: number;
  verifiedTurns: number;
  avgToolCalls: number;
  lastUsed: number;
  phases: { phase: string; turns: number; verifyOk: number }[];
  topFailingTools: { name: string; calls: number; failed: number }[];
  verdict: ModelVerdict;
  reason: string;
};

export const rowKey = (row: ModelReportRow) => `${row.model}|${row.providerId}|${row.tier}`;

/** Newest use first; ties by turns. Never mutates the input. */
export const sortByRecentUse = (rows: readonly ModelReportRow[]) =>
  [...rows].sort((a, b) => b.lastUsed - a.lastUsed || b.turns - a.turns || a.model.localeCompare(b.model));

export const unsuitableRows = (rows: readonly ModelReportRow[]) => rows.filter((row) => row.verdict === 'not suitable');

export const formatPercent = (rate: number) => {
  if (!Number.isFinite(rate) || rate <= 0) return '0%';
  const pct = rate * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
};

const FAULTS: Record<string, string> = {
  empty_answer: 'no answer',
  timeout: 'timeout',
  unauthenticated: 'signed out',
  rate_limited_session: 'rate limit',
  rate_limited_weekly: 'weekly limit',
  unknown: 'error',
};

export const faultSummary = (faults: Record<string, number>) =>
  Object.entries(faults).sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${count}× ${FAULTS[kind] ?? kind.replace(/_/g, ' ')}`).join(', ');

export const PHASE_LABELS: Record<string, string> = { none: 'no phase' };
export const phaseLabel = (phase: string) => PHASE_LABELS[phase] ?? phase.replace(/-/g, ' ');
