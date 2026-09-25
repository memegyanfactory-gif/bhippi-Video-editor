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
  /** Token totals for providers (such as Codex) that do not expose plan windows. */
  tokens?: { input: number; output: number } | null;
  /** Unix milliseconds when this was learned. */
  at: number;
  /** Set when a turn was actually refused for a limit, with when it frees up. */
  exhaustedUntil: number | null;
};

export type Standing = 'unknown' | 'ok' | 'warn' | 'high' | 'exhausted';

const KEY = 'bhippi.usage.v1';

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

const load = (): Record<string, Snapshot> => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Snapshot>) : {};
    return Object.fromEntries(Object.entries(parsed).map(([id, snapshot]) => [id, heal(snapshot)]));
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

export const forProvider = (providerId: string | null | undefined): Snapshot | null =>
  (providerId ? snapshots[providerId] : null) ?? null;

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
  const held = snapshots[providerId];
  const at = delta.at ?? Date.now();
  if (held && held.at > at) return;
  const existing = held;
  const window = (used: number | null, resetsAt: number | null, previous: Window | null): Window | null => {
    if (used === null) return previous;
    return { used: Math.max(0, Math.min(1, used)), resetsAt: resetsAt ?? previous?.resetsAt ?? null };
  };
  snapshots[providerId] = {
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
    at,
    // Anything arriving means the provider is answering, so a past refusal is over.
    exhaustedUntil: null,
  };
  save();
}

/** Keeps Codex and other CLI providers useful even when they do not expose quota windows. */
export function recordTokens(providerId: string, model: string | null, input: number, output: number) {
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return;
  const existing = snapshots[providerId];
  snapshots[providerId] = {
    providerId,
    model: model ?? existing?.model ?? null,
    status: existing?.status ?? 'reported',
    session: existing?.session ?? null,
    weekly: existing?.weekly ?? null,
    plan: existing?.plan ?? null,
    tokens: { input: Math.round(input), output: Math.round(output) },
    at: Date.now(),
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
  const until = parseReset(resetsAt) ?? Math.round((now + REFUSAL_HOLD_MS) / 1000);
  const existing = snapshots[providerId];
  snapshots[providerId] = {
    providerId,
    model: model ?? existing?.model ?? null,
    status: 'rejected',
    // The provider's own windows are kept as they were; the refusal lives in `exhaustedUntil`.
    session: existing?.session ?? null,
    weekly: existing?.weekly ?? null,
    plan: existing?.plan ?? null,
    tokens: existing?.tokens ?? null,
    at: now,
    exhaustedUntil: until,
  };
  save();
}

/** A turn finished without a fault: whatever refusal was on record is over. */
export function recordSuccess(providerId: string) {
  const existing = snapshots[providerId];
  if (!existing || (existing.status !== 'rejected' && existing.exhaustedUntil === null)) return;
  snapshots[providerId] = { ...heal(existing), status: existing.status === 'rejected' ? 'reported' : existing.status, exhaustedUntil: null };
  save();
}

export function clear(providerId?: string) {
  if (providerId) delete snapshots[providerId];
  else snapshots = {};
  save();
}

/** `2026-09-19T14:00:00Z`, `in 3 hours`, `3d` — providers phrase this every which way. */
export function parseReset(value: string | null): number | null {
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
  return seconds ? Math.round(Date.now() / 1000) + amount * seconds : null;
}

/** The worse of the two windows: what the ring shows. */
export function worst(snapshot: Snapshot | null): { used: number; window: 'session' | 'weekly' | 'plan' | null; resetsAt: number | null } {
  if (!snapshot) return { used: 0, window: null, resetsAt: null };
  const session = snapshot.session?.used ?? -1;
  const weekly = snapshot.weekly?.used ?? -1;
  if (session < 0 && weekly < 0) {
    // No window named: whatever single figure we were given is the reading.
    return snapshot.plan
      ? { used: snapshot.plan.used, window: 'plan', resetsAt: snapshot.plan.resetsAt }
      : { used: 0, window: null, resetsAt: null };
  }
  if (weekly >= session) return { used: weekly, window: 'weekly', resetsAt: snapshot.weekly?.resetsAt ?? null };
  return { used: session, window: 'session', resetsAt: snapshot.session?.resetsAt ?? null };
}

export function standing(snapshot: Snapshot | null, now = Date.now()): Standing {
  if (!snapshot) return 'unknown';
  if (snapshot.exhaustedUntil && snapshot.exhaustedUntil * 1000 > now) return 'exhausted';
  const { used, window } = worst(snapshot);
  // A refusal whose hold has run out is history, not a standing: only a live hold (above) or a
  // window the provider itself reported spent (below) says "out".
  if (!window) return 'unknown';
  // A window whose reset time has passed has rolled over, whatever it read before.
  const { resetsAt } = worst(snapshot);
  if (resetsAt && resetsAt * 1000 <= now) return 'ok';
  if (used >= 0.995) return 'exhausted';
  if (used >= 0.9) return 'high';
  if (used >= 0.75) return 'warn';
  return 'ok';
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
