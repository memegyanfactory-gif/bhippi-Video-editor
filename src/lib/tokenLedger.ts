// Token Council, rule 2: every project keeps a running bill.
//
// The usage ring (usage.ts) answers "how much of my plan is left"; this answers "what has this
// video cost so far". Each finished turn (subagents too) adds its tokens to the open project's
// ledger. The model sees the total and the soft budget in its context, and is told to finish
// with what it has instead of re-reading once the budget is being eaten.
//
// Kept outside the project history on purpose: an undo must not un-spend tokens.

const KEY = 'bhippi.ledger.v1';

/** One video's soft budget. A 40 s ad measured ~25 M tokens before the council; the target is 3 M. */
export const PROJECT_BUDGET = 3_000_000;

export type LedgerEntry = {
  input: number;
  output: number;
  turns: number;
  byProvider: Record<string, { input: number; output: number; turns: number }>;
  updatedAt: number;
};

type Ledger = Record<string, LedgerEntry>;

function load(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

function save(ledger: Ledger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    // Storage full or blocked: the ledger is advisory, the edit goes on.
  }
}

/** The ledger key for a project: its folder, or one bucket for unsaved work. */
export const projectKey = (folder: string | null | undefined) => (folder && folder.trim() ? folder.trim().toLowerCase() : 'unsaved');

export function recordTurn(project: string, providerId: string, input: number, output: number) {
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return;
  const ledger = load();
  const entry = ledger[project] ?? { input: 0, output: 0, turns: 0, byProvider: {}, updatedAt: 0 };
  const row = entry.byProvider[providerId] ?? { input: 0, output: 0, turns: 0 };
  entry.byProvider[providerId] = { input: row.input + Math.round(input), output: row.output + Math.round(output), turns: row.turns + 1 };
  ledger[project] = { ...entry, input: entry.input + Math.round(input), output: entry.output + Math.round(output), turns: entry.turns + 1, updatedAt: Date.now() };
  save(ledger);
}

export function ledgerFor(project: string): LedgerEntry | null {
  return load()[project] ?? null;
}

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} K` : String(n));

/** What the model is told about this project's spend (context.tokenBudget). */
export function ledgerBrief(project: string) {
  const entry = ledgerFor(project);
  const spent = entry ? entry.input + entry.output : 0;
  const share = spent / PROJECT_BUDGET;
  const advice = share >= 1
    ? 'Over budget: no more exploratory reads or re-reads; make only the edits still missing, run one QA pass, verify and stop.'
    : share >= 0.75
      ? 'Most of the budget is spent: finish with what you have; re-read only what an edit changed.'
      : 'Spend tokens on the edit, not on re-reading: read the comp once per batch of edits, and query templates by id.';
  return { spent: short(spent), budget: short(PROJECT_BUDGET), turns: entry?.turns ?? 0, advice };
}
