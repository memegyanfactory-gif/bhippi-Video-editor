// When a finished turn carries on by itself instead of waiting for the person to press Continue.
//
// A turn can end before the job is done for reasons that have nothing to do with the person: the
// replies kept hitting the output limit, the round cap was reached, the connection dropped, or the
// model wrote a progress report and stopped with the edit unverified or shots still to gather.
// Each of those used to leave a "press Continue" for the person. Now the chat sends the next round
// itself — a few times at most per request, and only while each round got somewhere, so a model
// that is stuck stops and the Continue button is still there as the fail-safe.

/** Automatic rounds one request gets, of every kind together, before it waits for the person. */
export const MAX_AUTO_CONTINUES = 4;
/** Automatic retries of a dropped connection, a timeout or a crashed agent per request. */
export const MAX_AUTO_RETRIES = 1;
/** Faults that clear by themselves: the same request again usually just works. */
export const TRANSIENT_FAULTS = new Set(['network', 'timeout', 'crashed']);

export type AutoKind = 'retry' | 'cut-short' | 'finish' | 'gather';

export type TurnEnd = {
  stopped: boolean;
  faultKind: string | null;
  cutShort: 'output' | 'rounds' | null;
  /** The turn's tool calls as the chat shows them. */
  runs: readonly { status: string; changedProject?: boolean }[];
  /** The edit workflow where the turn left it (`EditWorkflow.status`). */
  workflow: {
    mode?: string;
    phase?: string | null;
    structurallyVerified?: boolean;
    gather?: { ready: number; total: number; pending: string[] } | null;
  } | null;
};

/** Automatic rounds already sent for the request now running. */
export type AutoChain = { count: number; retries: number };

export const freshChain = (): AutoChain => ({ count: 0, retries: 0 });

/**
 * What the chat should send by itself after `end`, or null to wait for the person. Pure.
 *
 * A stopped turn is the person's call and never carries on. Otherwise, in order: a transient
 * fault is retried once; a turn a budget cut short carries on if any of its calls worked; a Full
 * edit that changed the timeline but was never verified gets a finishing round; a gather turn with
 * shots still pending carries on if it got any call through. A round that did nothing that worked
 * ends the chain, since another would only repeat it.
 */
export function nextAutoStep(end: TurnEnd, chain: AutoChain): AutoKind | null {
  if (end.stopped || chain.count >= MAX_AUTO_CONTINUES) return null;
  const worked = end.runs.some((run) => run.status === 'done');
  const edited = end.runs.some((run) => run.status === 'done' && run.changedProject);
  if (end.faultKind) {
    // An automatic round that failed again without getting anything through is not tried a third time.
    const progressed = chain.count === 0 || worked;
    return TRANSIENT_FAULTS.has(end.faultKind) && chain.retries < MAX_AUTO_RETRIES && progressed ? 'retry' : null;
  }
  if (end.cutShort) return worked ? 'cut-short' : null;
  const status = end.workflow;
  if (status?.mode !== 'full') return null;
  const phase = status.phase ?? null;
  // A follow-up edit of a finished production, or an edit with no production at all, is held to the
  // same finish; only the plan and gather phases end at the user's button.
  const editing = !phase || phase === 'editing' || phase === 'polishing' || phase === 'done';
  if (editing && edited && !status.structurallyVerified) return 'finish';
  if (phase === 'gathering' && (status.gather?.pending.length ?? 0) > 0 && worked) return 'gather';
  return null;
}

/** The chain after sending `kind`. */
export const advanceChain = (chain: AutoChain, kind: AutoKind): AutoChain => ({
  count: chain.count + 1,
  retries: chain.retries + (kind === 'retry' ? 1 : 0),
});

/** The opening of an automatic message: what happened, in the words the model and the transcript read. */
export function autoLead(kind: AutoKind, end: Pick<TurnEnd, 'faultKind' | 'cutShort'>): string {
  switch (kind) {
    case 'retry':
      return `[Automatic retry: the last turn failed (${end.faultKind ?? 'connection'}) before it finished.]`;
    case 'cut-short':
      return end.cutShort === 'rounds'
        ? '[Automatic continuation: the last turn reached its round limit before the request was finished.]'
        : '[Automatic continuation: the last turn kept hitting the output limit before the request was finished. Keep each reply short: split large work into several smaller tool calls.]';
    case 'finish':
      return '[Automatic finishing round: the last turn ended before verify_edit_workflow.]';
    case 'gather':
      return '[Automatic gather round: the last turn ended with shots still pending.]';
  }
}

/**
 * What stopped the job, in a line: the last call of the turn that failed, with its error. A carry-on
 * names it so the model fixes that one thing instead of redoing the phase; the warn line shows it to
 * the person. Null when nothing failed.
 */
export function lastBlocker(runs: readonly { name: string; status: string; summary?: string }[]): string | null {
  const failed = [...runs].reverse().find((run) => run.status === 'failed' && run.summary);
  if (!failed?.summary) return null;
  const said = failed.summary.replace(/\s+/g, ' ').trim();
  return `${failed.name}: ${said.length > 400 ? `${said.slice(0, 400)}…` : said}`;
}

/** Whether a message is one the chat sent by itself (it never resets the chain or counts as the request). */
export const isAutomatic = (text: string) => text.startsWith('[Automatic');
