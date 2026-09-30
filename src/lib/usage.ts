// What each provider has left, kept per provider.
//
// Nothing here is guessed. A provider reports where it stands against its plan while a turn is
// running — Claude Code and Codex both do — and a turn that fails on a rate limit says when it
// resets. Those two facts are all this stores, per provider, with the time they were learned. A
// provider that has never been used shows an empty ring and says so, because inventing a number
// for it would be worse than admitting we do not know yet.
//
// It survives a restart, so switching back to a provider shows what was last true of it rather
// than starting blank.

export type Window = {
  /** 0..1 of the allowance spent. */
  used: number;
  /** Unix seconds when the window rolls over, if the provider said. */
  resetsAt: number | null;
};

export type Snapshot = {
  providerId: string;
  /** The model the numbers were learned under; plans differ by model. */
  model: string | null;
  /** The provider's own word for where things stand — `allowed`, `rejected`, and so on. */
  status: string;
  session: Window | null;
  weekly: Window | null;
  /**
   * One figure with no window named. Some providers — and every reading recovered from an older
   * transcript — say only "you are this far through your plan", and a meter that ignored that
   * would sit blank next to a message stating the number.
   */
  plan: Window | null;
  /** Completed-turn request totals, separate from account quota and context occupancy. */
  tokens?: { input: number; output: number } | null;
  tokensAt?: number;
  limitsAt?: number;
  /** Provider account quota, shared across its models; token readings remain model-specific. */
  account?: boolean;
  sessionLabel?: string;
  weeklyLabel?: string;
  /** Unix milliseconds when this was learned. */
  at: number;
  /** Set when a turn was actually refused for a limit, with when it frees up. */
  exhaustedUntil: number | null;
};

export type Standing = 'unknown' | 'ok' | 'warn' | 'high' | 'exhausted';

const KEY = 'bhippi.usage.v2';
const LEGACY_KEY = 'bhippi.usage.v1';
const keyFor = (providerId: string, model: string | null) => JSON.stringify([providerId, model?.trim() || null]);

/**
 * How long a refusal that named no reset time keeps a provider marked out. Free and shared models
 * refuse with "overloaded" or a bare 429 that clears in minutes; without a bound, one such turn
 * painted the provider red for good.
 */
export const REFUSAL_HOLD_MS = 10 * 60_000;

/**
 * Older builds recorded a refusal as a spent session window with no reset time, which no later
 * turn could clear for providers that never report windows (OpenCode, Gemini, Antigravity). Those
 * fabricated windows are dropped on load; a real reading always carries a reset time.
 */
export function heal(snapshot: Snapshot): Snapshot {
  const fabricated = (window: Window | null) => window !== null && window.used >= 1 && window.resetsAt === null;
  if (snapshot.status !== 'rejected' || !fabricated(snapshot.session)) return snapshot;
  return { ...snapshot, status: 'reported', session: null };
}

/** Validate persisted readings: malformed storage must never put NaN on a meter. */
export function decodeSnapshots(raw: string | null): Record<string, Snapshot> {
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Record<string, Snapshot> = {};
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Snapshot;
    if (typeof row.providerId !== 'string' || !row.providerId || !Number.isFinite(row.at)) continue;
    const readWindow = (value: Window | null): Window | null => value && Number.isFinite(value.used)
      ? { used: Math.max(0, Math.min(1, value.used)), resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null } : null;
    const tokens = row.tokens && validTokens(row.tokens.input, row.tokens.output) ? row.tokens : null;
    const model = typeof row.model === 'string' ? row.model.trim() || null : null;
    result[keyFor(row.providerId, model)] = heal({ ...row, model, tokens,
      status: typeof row.status === 'string' ? row.status : 'reported',
      session: readWindow(row.session), weekly: readWindow(row.weekly), plan: readWindow(row.plan),
      exhaustedUntil: Number.isFinite(row.exhaustedUntil) ? row.exhaustedUntil : null,
      limitsAt: Number.isFinite(row.limitsAt) ? row.limitsAt : row.at,
      tokensAt: Number.isFinite(row.tokensAt) ? row.tokensAt : row.at,
    });
  }
  return result;
}

const load = (): Record<string, Snapshot> => {
  try {
    return decodeSnapshots(window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY));
  } catch {
    return {};
  }
};

let snapshots = load();
const listeners = new Set<() => void>();

const save = () => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshots));
  } catch {
    // A machine with storage switched off still gets the live numbers, just not across restarts.
  }
  for (const listener of listeners) listener();
};

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** An explicit model never borrows another model's usage. Automatic selection uses the latest. */
export const forProvider = (providerId: string | null | undefined, model?: string | null): Snapshot | null => {
  if (!providerId) return null;
  const selected = model ? snapshots[keyFor(providerId, model)] ?? null
    : all().find((item) => item.providerId === providerId && !item.account) ?? all().find((item) => item.providerId === providerId) ?? null;
  const account = snapshots[keyFor(providerId, null)];
  if (!account?.account || (selected && !selected.account && (selected.limitsAt ?? 0) > (account.limitsAt ?? 0))) return selected;
  return { ...account, ...selected, tokens: selected?.tokens, tokensAt: selected?.tokensAt, model: model ?? selected?.model ?? null, session: account.session, weekly: account.weekly, plan: account.plan, sessionLabel: account.sessionLabel, weeklyLabel: account.weeklyLabel, limitsAt: account.limitsAt, account: true };
};

export function recordAccountLimits(providerId: string, session: Window | null, weekly: Window | null, at: number, sessionLabel: string, weeklyLabel: string) {
  const key = keyFor(providerId, null);
  if (!Number.isFinite(at) || (snapshots[key]?.limitsAt ?? 0) > at) return;
  snapshots[key] = { providerId, model: null, status: 'reported', session, weekly, plan: null, at, limitsAt: at, tokens: snapshots[key]?.tokens, tokensAt: snapshots[key]?.tokensAt, exhaustedUntil: null, account: true, sessionLabel, weeklyLabel };
  save();
}

export const all = (): Snapshot[] => Object.values(snapshots).sort((a, b) => b.at - a.at);

/** Records what a provider said mid-turn. */
export function record(providerId: string, model: string | null, delta: {
  status: string;
  sessionUsed: number | null;
  sessionResetsAt: number | null;
  weeklyUsed: number | null;
  weeklyResetsAt: number | null;
  /** A figure the provider gave without naming a window. */
  planUsed?: number | null;
  /** When it was said, for a reading replayed from the transcript. */
  at?: number | null;
}) {
  // A reading older than the one already held would make the meter go backwards.
  const key = keyFor(providerId, model);
  const held = snapshots[key];
  const at = delta.at ?? Date.now();
  if (!Number.isFinite(at) || (held && (held.limitsAt ?? held.at) > at)) return;
  const existing = held;
  const window = (used: number | null, resetsAt: number | null, previous: Window | null): Window | null => {
    if (used === null || !Number.isFinite(used)) return previous;
    // A new reading must not inherit the reset time of a window that already rolled over.
    const previousReset = previous?.resetsAt && previous.resetsAt * 1000 > at ? previous.resetsAt : null;
    return { used: Math.max(0, Math.min(1, used)), resetsAt: resetsAt ?? previousReset };
  };
  snapshots[key] = {
    providerId,
    model,
    status: delta.status,
    session: window(delta.sessionUsed, delta.sessionResetsAt, existing?.session ?? null),
    weekly: window(delta.weeklyUsed, delta.weeklyResetsAt, existing?.weekly ?? null),
    // Only kept when neither window was named, so a full reading always wins over a bare figure.
    plan: delta.sessionUsed === null && delta.weeklyUsed === null
      ? window(delta.planUsed ?? null, null, existing?.plan ?? null)
      : null,
    tokens: existing?.tokens ?? null,
    at: Math.max(at, held?.at ?? 0), limitsAt: at, tokensAt: existing?.tokensAt,
    // A rejected limit report is not proof that a previous refusal is over.
    exhaustedUntil: delta.status === 'rejected' ? existing?.exhaustedUntil ?? null : null,
  };
  save();
}

/** Keeps Codex and other CLI providers useful even when they do not expose quota windows. */
export function recordTokens(providerId: string, model: string | null, input: number, output: number, at = Date.now()) {
  if (!validTokens(input, output) || !Number.isFinite(at)) return;
  const key = keyFor(providerId, model);
  const existing = snapshots[key];
  if (existing && (existing.tokensAt ?? existing.at) > at) return;
  snapshots[key] = {
    ...existing,
    providerId,
    model,
    status: existing?.status ?? 'reported',
    session: existing?.session ?? null,
    weekly: existing?.weekly ?? null,
    plan: existing?.plan ?? null,
    tokens: { input: Math.round(input), output: Math.round(output) },
    at: Math.max(at, existing?.at ?? 0), tokensAt: at, limitsAt: existing?.limitsAt,
    exhaustedUntil: existing?.exhaustedUntil ?? null,
  };
  save();
}

/**
 * Records that a turn was refused because the allowance is gone. `resetsAt` is whatever the
 * provider said, which may be a date, a duration or nothing at all.
 */
export function recordExhausted(providerId: string, model: string | null, resetsAt: string | null, now = Date.now()) {
  // A refusal that names no time is held briefly rather than forever: the next turn that works
  // (see `recordSuccess`) or the hold running out, whichever is first, clears it.
  const until = parseReset(resetsAt, now) ?? Math.round((now + REFUSAL_HOLD_MS) / 1000);
  const key = keyFor(providerId, model);
  const existing = snapshots[key];
  if (existing && (existing.limitsAt ?? existing.at) > now) return;
  snapshots[key] = {
    providerId,
    model,
    status: 'rejected',
    // The provider's own windows are kept as they were; the refusal lives in `exhaustedUntil`.
    session: existing?.session ?? null,
    weekly: existing?.weekly ?? null,
    plan: existing?.plan ?? null,
    tokens: existing?.tokens ?? null,
    at: Math.max(now, existing?.at ?? 0), limitsAt: now, tokensAt: existing?.tokensAt,
    exhaustedUntil: until,
  };
  save();
}

/** A turn finished without a fault: whatever refusal was on record is over. */
export function recordSuccess(providerId: string, model?: string | null) {
  const existing = model === undefined ? forProvider(providerId) : snapshots[keyFor(providerId, model)];
  if (!existing || (existing.status !== 'rejected' && existing.exhaustedUntil === null)) return;
  snapshots[keyFor(existing.providerId, existing.model)] = { ...heal(existing), status: existing.status === 'rejected' ? 'reported' : existing.status, exhaustedUntil: null };
  save();
}

export function clear(providerId?: string) {
  if (providerId) snapshots = Object.fromEntries(Object.entries(snapshots).filter(([, row]) => row.providerId !== providerId));
  else snapshots = {};
  save();
}

/** `2026-09-19T14:00:00Z`, `in 3 hours`, `3d` — providers phrase this every which way. */
export function parseReset(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return Math.round(direct / 1000);
  const relative = /(\d+)\s*(second|minute|hour|day|week|s|min|m|h|d|w)\b/i.exec(value);
  if (!relative) return null;
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const seconds = unit.startsWith('s') ? 1
    : unit.startsWith('min') || unit === 'm' ? 60
      : unit.startsWith('h') ? 3600
        : unit.startsWith('d') ? 86400
          : unit.startsWith('w') ? 604800
            : 0;
  return seconds ? Math.round(now / 1000) + amount * seconds : null;
}

export const expired = (window: Window, now = Date.now()) => window.resetsAt !== null && window.resetsAt * 1000 <= now;

/** Only live windows compete: an expired session must not hide a still-spent weekly allowance. */
export function worst(snapshot: Snapshot | null, now = Date.now()): { used: number; window: 'session' | 'weekly' | 'plan' | null; resetsAt: number | null } {
  if (!snapshot) return { used: 0, window: null, resetsAt: null };
  const session = snapshot.session && !expired(snapshot.session, now) ? snapshot.session.used : -1;
  const weekly = snapshot.weekly && !expired(snapshot.weekly, now) ? snapshot.weekly.used : -1;
  if (session < 0 && weekly < 0) {
    // No window named: whatever single figure we were given is the reading.
    return snapshot.plan && !expired(snapshot.plan, now)
      ? { used: snapshot.plan.used, window: 'plan', resetsAt: snapshot.plan.resetsAt }
      : { used: 0, window: null, resetsAt: null };
  }
  if (weekly >= session) return { used: weekly, window: 'weekly', resetsAt: snapshot.weekly?.resetsAt ?? null };
  return { used: session, window: 'session', resetsAt: snapshot.session?.resetsAt ?? null };
}

export function standing(snapshot: Snapshot | null, now = Date.now()): Standing {
  if (!snapshot) return 'unknown';
  if (snapshot.exhaustedUntil && snapshot.exhaustedUntil * 1000 > now) return 'exhausted';
  const { used, window } = worst(snapshot, now);
  // A refusal whose hold has run out is history, not a standing: only a live hold (above) or a
  // window the provider itself reported spent (below) says "out".
  if (!window) return 'unknown';
  if (used >= 0.995) return 'exhausted';
  if (used >= 0.9) return 'high';
  if (used >= 0.75) return 'warn';
  return 'ok';
}

function validTokens(input: number, output: number) {
  return Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
}

export type UsageTurn = {
  turnId: string; providerId: string; model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  status: string;
};

/** Conversation spend is a sum of reported turn totals, never a context-window percentage. */
export function summarizeTurns(turns: readonly UsageTurn[], providerId: string | undefined, model: string | null) {
  const seen = new Set<string>();
  let input = 0, output = 0, reported = 0, missing = 0;
  for (const turn of turns) {
    if (turn.providerId !== providerId || (model && turn.model !== model) || turn.status === 'streaming' || seen.has(turn.turnId)) continue;
    seen.add(turn.turnId);
    if (!turn.usage || !validTokens(turn.usage.inputTokens, turn.usage.outputTokens)) { missing++; continue; }
    input += turn.usage.inputTokens;
    output += turn.usage.outputTokens;
    reported++;
  }
  return { input, output, reported, missing };
}

export const tokenCount = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
  : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

export function usageLabel(snapshot: Snapshot | null, now = Date.now()): string {
  const state = standing(snapshot, now);
  if (state === 'exhausted') return 'Limit reached';
  const reading = worst(snapshot, now);
  if (reading.window) return `${Math.round(reading.used * 100)}% used`;
  return snapshot?.tokens ? `${tokenCount(snapshot.tokens.input + snapshot.tokens.output)} tokens` : 'Usage unavailable';
}

/** `in 12 min`, `in 3 hr`, `in 3d` — short enough for a chip. */
export function untilText(resetsAt: number | null, now = Date.now()): string | null {
  if (!resetsAt) return null;
  const minutes = Math.round((resetsAt * 1000 - now) / 60000);
  if (minutes <= 0) return 'shortly';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} hr`;
  return `in ${Math.round(hours / 24)}d`;
}

/** `learned just now`, `2 min ago` — so a stale reading is visibly stale. */
export function agoText(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
