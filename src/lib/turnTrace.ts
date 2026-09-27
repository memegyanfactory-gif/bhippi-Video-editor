// Turn traces: every event inside an AI turn, written to one JSONL file per turn
// (src-tauri/src/trace.rs keeps them). The brain remembers that a turn failed; a trace says which
// call failed, with what, after how long, and what the turn cost — on every provider.
// `node scripts/session-report.mjs --bhippi` reads them back.
//
// Writes are buffered and batched so tracing never slows a tool call; a failed write is dropped
// silently, like the ledger: a trace is a diagnostic, never a reason for an edit to fail.

import { api } from './ipc';

/** Longest string kept from an argument or a result; the rest is replaced by its length. */
const MAX_TEXT = 400;
/** Deepest nesting and widest array/object kept from an argument. */
const MAX_DEPTH = 4;
const MAX_ITEMS = 24;
const FLUSH_LINES = 20;
const FLUSH_MS = 1500;
/** Argument names whose values are never written: keys, tokens and the like. */
const SECRET = /key|token|secret|password|passwd|authorization|cookie|credential/i;

export type TraceEvent = { ev: string } & Record<string, unknown>;

type Pending = { project: string | null; lines: (TraceEvent & { t: number })[]; timer: ReturnType<typeof setTimeout> | null };

let config: { enabled: () => boolean; project: () => string | null } = { enabled: () => true, project: () => null };
const pending = new Map<string, Pending>();

/** Where traces go and whether they are kept; App wires this to the settings and the open project. */
export function configureTrace(next: { enabled: () => boolean; project: () => string | null }) {
  config = next;
}

/**
 * A value made safe and small for a trace: secrets redacted, long text cut to its length, deep or
 * wide structures trimmed. Pure, so the same call always traces the same way.
 */
export function clip(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}… (${value.length} chars)` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[${value.length} items]` : '{…}';
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map((item) => clip(item, depth + 1));
    return value.length > MAX_ITEMS ? [...kept, `… ${value.length - MAX_ITEMS} more`] : kept;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, MAX_ITEMS)) out[key] = SECRET.test(key) ? '[redacted]' : clip(item, depth + 1);
  if (entries.length > MAX_ITEMS) out['…'] = `${entries.length - MAX_ITEMS} more keys`;
  return out;
}

/** Size of a value as JSON, for "which tools are heaviest" without keeping the value. */
export function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Records one event for a turn. The project is fixed by the turn's first event. */
export function trace(turnId: string, event: TraceEvent) {
  if (!turnId || !config.enabled()) return;
  let turn = pending.get(turnId);
  if (!turn) {
    turn = { project: config.project(), lines: [], timer: null };
    pending.set(turnId, turn);
  }
  turn.lines.push({ t: Date.now(), ...event });
  if (event.ev === 'turn_end' || turn.lines.length >= FLUSH_LINES) void flushTrace(turnId, event.ev === 'turn_end');
  else if (!turn.timer) turn.timer = setTimeout(() => void flushTrace(turnId), FLUSH_MS);
}

/** Writes what a turn has buffered; `done` forgets the turn afterwards. */
export async function flushTrace(turnId: string, done = false) {
  const turn = pending.get(turnId);
  if (!turn) return;
  if (turn.timer) clearTimeout(turn.timer);
  turn.timer = null;
  const lines = turn.lines;
  turn.lines = [];
  if (done) pending.delete(turnId);
  if (!lines.length) return;
  await api.traceAppend(turn.project, turnId, lines).catch(() => undefined);
}

/** The Judge's verdict from a judge_edit result, without its frames. */
function judgeOf(result: Record<string, unknown>) {
  if (typeof result.score !== 'number') return undefined;
  return { score: result.score, pass: result.pass, round: result.round, fixes: clip(result.fixes) };
}

/** The trace line for one finished tool call. */
export function toolEvent(input: {
  name: string;
  callId: string;
  sentArgs: unknown;
  args: unknown;
  result: { ok: boolean; summary?: unknown; error?: unknown; guardBlocked?: boolean; unchanged?: boolean } & Record<string, unknown>;
  reply: { unchanged?: boolean } & Record<string, unknown>;
  permitted: boolean;
  ms: number;
  changedProject: boolean;
}): TraceEvent {
  const { result } = input;
  const status = result.ok ? 'done' : !input.permitted ? 'denied' : result.guardBlocked ? 'blocked' : 'failed';
  const argsJson = JSON.stringify(input.args ?? null);
  return {
    ev: 'tool',
    name: input.name,
    callId: input.callId,
    status,
    ms: input.ms,
    // argRepair mended the call's JSON types before it ran.
    repaired: JSON.stringify(input.sentArgs ?? null) !== argsJson,
    // readDedupe answered with a one-line "unchanged" note instead of the full body.
    deduped: Boolean(input.reply.unchanged) && !result.unchanged,
    changedProject: input.changedProject,
    argsChars: argsJson?.length ?? 0,
    // What the model received: a deduped read costs its one-line note, not the body it replaced.
    resultChars: sizeOf(input.reply),
    args: clip(input.args),
    ...(result.ok ? { summary: clip(String(result.summary ?? 'done')) } : { error: clip(typeof result.error === 'string' ? result.error : JSON.stringify(result.error) ?? String(result.error)) }),
    ...(input.name === 'judge_edit' && result.ok ? { judge: judgeOf(result) } : {}),
  };
}
