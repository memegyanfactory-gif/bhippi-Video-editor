// What the chat is doing right now, kept from the bus's events — the avatar's one source of truth.
//
// The character never runs ahead of the chat or lags behind it: it acts out whatever this says
// the chat is doing at this moment (the newest tool call running, else a step the CLI is taking
// by itself, else writing the reply, else thinking), and nothing at all once the chat has
// stopped. A stopped turn stays closed: a chunk, a step or a tool result already in flight from it
// is ignored, and so is everything from the council workers it had put to work. Pure — no DOM,
// the clock passed in — so it is tested in tests/avatar.test.ts.

import { activityForStep, type Activity, type ActivityKind } from './brain';
import type { AvatarEvent, TurnOutcome } from './bus';
import type { CouncilRole } from '../lib/council';

/** What the character should be doing; `key` changes only when the work visibly changes. */
export type Desire = { kind: ActivityKind; role: CouncilRole | null; key: string };

type ToolEnd = Extract<AvatarEvent, { type: 'tool-end' }>;

/** What an event changed, as far as the character is concerned. */
export type Change =
  | { type: 'none' }
  /** The chat went from idle to working. */
  | { type: 'started' }
  /** The last live turn closed: finished, stopped by the user, or failed. */
  | { type: 'ended'; outcome: TurnOutcome }
  /** A call that finished changed the timeline. */
  | { type: 'edited'; event: ToolEnd };

/** A turn that has said nothing for this long, with no call running, is presumed gone. */
export const TURN_STALE_MS = 150_000;
/** The reply counts as being written for this long after its last chunk. */
export const WRITING_MS = 1_200;
/** A CLI step with no word for this long is presumed finished. */
const STEP_STALE_MS = 60_000;

type Call = { turnId: string; activity: Activity | null; order: number };
type Step = { turnId: string; activity: Activity | null; seen: number; order: number };

/** A council worker's turn id is `<lead turn id>:sub:<id>` (subagent.rs). */
const isWorkerOf = (turnId: string, lead: string) => turnId.startsWith(`${lead}:sub:`);

const desire = (activity: Activity): Desire => ({ kind: activity.kind, role: activity.role, key: `${activity.kind}|${activity.role ?? ''}` });
const NONE: Change = { type: 'none' };

export class ChatMirror {
  /** Live turns, by when each last said anything. */
  private turns = new Map<string, number>();
  private calls = new Map<string, Call>();
  private steps = new Map<string, Step>();
  private closed = new Set<string>();
  /** Leads the user stopped: their workers are closed with them. */
  private stoppedLeads = new Set<string>();
  private writingAt = -Infinity;
  private order = 0;

  apply(event: AvatarEvent, now: number): Change {
    const wasBusy = this.busy(now);
    const { turnId } = event;
    if (event.type === 'turn' && !event.busy) {
      this.close(turnId, event.outcome === 'stopped');
      return wasBusy && !this.busy(now) ? { type: 'ended', outcome: event.outcome ?? 'done' } : NONE;
    }
    if (this.isClosed(turnId)) {
      // Late news from a turn that has ended: a call it started still reports back, but nothing it says is acted out.
      if (event.type === 'tool-end') this.calls.delete(event.callId);
      return NONE;
    }
    this.turns.set(turnId, now);
    switch (event.type) {
      case 'chat':
        if (event.what === 'writing') this.writingAt = now;
        break;
      case 'step':
        if (event.done) this.steps.delete(event.id);
        else this.steps.set(event.id, { turnId, activity: activityForStep(event.verb, event.title), seen: now, order: ++this.order });
        break;
      case 'tool-start':
        this.calls.set(event.callId, { turnId, activity: event.activity, order: ++this.order });
        // A tool call means the reply is not being written just now.
        this.writingAt = -Infinity;
        break;
      case 'tool-end':
        this.calls.delete(event.callId);
        if (event.ok && event.diff) return { type: 'edited', event };
        break;
    }
    return wasBusy ? NONE : { type: 'started' };
  }

  /** Whether Helios AI is at work: a call running, or a live turn that spoke recently. */
  busy(now: number): boolean {
    for (const [id, seen] of this.turns) {
      if (now - seen > TURN_STALE_MS && ![...this.calls.values()].some((call) => call.turnId === id)) this.turns.delete(id);
    }
    return this.calls.size > 0 || this.turns.size > 0;
  }

  /** What the chat is doing at `now`, as something to act out; null when it is doing nothing. */
  desired(now: number): Desire | null {
    let call: Call | null = null;
    for (const entry of this.calls.values()) if (entry.activity && (!call || entry.order > call.order)) call = entry;
    if (call?.activity) return desire(call.activity);
    let step: Step | null = null;
    for (const [id, entry] of this.steps) {
      if (now - entry.seen > STEP_STALE_MS) this.steps.delete(id);
      else if (entry.activity && (!step || entry.order > step.order)) step = entry;
    }
    if (step?.activity) return desire(step.activity);
    if (!this.busy(now)) return null;
    if (now - this.writingAt < WRITING_MS) return desire({ kind: 'talk', role: null });
    return desire({ kind: 'think', role: null });
  }

  isClosed(turnId: string): boolean {
    if (this.closed.has(turnId)) return true;
    for (const lead of this.stoppedLeads) if (isWorkerOf(turnId, lead)) return true;
    return false;
  }

  private close(turnId: string, stopped: boolean) {
    const gone = (id: string) => id === turnId || (stopped && isWorkerOf(id, turnId));
    this.closed.add(turnId);
    if (stopped) this.stoppedLeads.add(turnId);
    for (const id of [...this.turns.keys()]) if (gone(id)) { this.turns.delete(id); this.closed.add(id); }
    for (const [id, call] of [...this.calls]) if (gone(call.turnId)) this.calls.delete(id);
    for (const [id, step] of [...this.steps]) if (gone(step.turnId)) this.steps.delete(id);
    if (!this.calls.size && !this.turns.size) this.writingAt = -Infinity;
    // Keep the memory of closed turns bounded.
    if (this.closed.size > 500) this.closed = new Set([...this.closed].slice(-250));
    if (this.stoppedLeads.size > 100) this.stoppedLeads = new Set([...this.stoppedLeads].slice(-50));
  }
}
