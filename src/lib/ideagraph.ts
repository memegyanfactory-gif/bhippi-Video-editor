import { api } from './ipc';

export type BrainGaps = {
  total: number;
  areas: { name: string; count: number }[];
  gaps: string[];
  unclassified: number;
} | null;

export type BrainStatus = { status: string; gaps: BrainGaps; pending: string };

export type TurnToolSummary = {
  name: string;
  status: string;
  ms: number | null;
  changedProject: boolean;
  /** Why a failed call failed, clipped, so the brain keeps the reason and not only the count. */
  error?: string;
  /** The argument names the call carried, so the brain can learn what a working retry changed. */
  argKeys?: string[];
};

export type TurnOutcome = {
  /** The chat turn this outcome closes. */
  turnId?: string;
  provider: string;
  model: string | null;
  prompt: string;
  elapsedMs: number;
  stopped: boolean;
  faultKind: string | null;
  verified: boolean | null;
  /** The production phase when the turn started: plan turns end at a saved plan, gather turns at finish_gathering. */
  phase?: string | null;
  /** The model tier of the turn (full | guided). */
  tier?: string | null;
  tools: TurnToolSummary[];
};

/** Longest failure text kept per call. */
export const ERROR_CLIP = 200;

/** A finished tool run as the brain keeps it: status and timing, plus why it failed and which arguments it took. */
export function toolSummary(run: { name: string; status: string; ms: number | null; changedProject?: boolean; summary?: string; argKeys?: string[] }): TurnToolSummary {
  const failed = run.status === 'failed' || run.status === 'denied';
  const error = failed ? clip((run.summary ?? '').replace(/\s+/g, ' ').trim(), ERROR_CLIP) : '';
  return {
    name: run.name,
    status: run.status,
    ms: run.ms,
    changedProject: run.changedProject ?? false,
    ...(error ? { error } : {}),
    ...(run.argKeys?.length ? { argKeys: run.argKeys } : {}),
  };
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const PLAN_TOOLS = ['save_storyboard', 'save_video_blueprint', 'propose_storyboards'];

/**
 * How the turn ended, by what its phase is for (mirrors brain.rs `score`): a plan turn ends at the
 * saved plan, a gather turn at finish_gathering, and only the editing phases are held to verify.
 */
export function turnResult(outcome: TurnOutcome): string {
  if (outcome.faultKind) return `fault: ${outcome.faultKind}`;
  if (outcome.stopped) return 'stopped by user';
  if (outcome.verified === true) return 'workflow verified';
  const done = (name: string) => outcome.tools.some((tool) => tool.name === name && (tool.status === 'done' || tool.status === 'ok'));
  const planned = PLAN_TOOLS.some(done);
  const phase = outcome.phase ?? null;
  if ((phase === null || phase === 'planning') && done('finish_gathering')) return 'phase complete (gathering)';
  if ((phase === null || phase === 'planning') && planned) return 'phase complete (plan)';
  if (phase === 'plan-ready' || phase === 'gathering') {
    if (done('finish_gathering')) return 'phase complete (gathering)';
    if (planned) return 'phase complete (plan)';
    return outcome.tools.length ? 'phase incomplete (gathering)' : 'done';
  }
  return outcome.verified === false ? 'workflow unverified' : 'done';
}

/**
 * One compact episodic note per AI turn: what was asked, which tools ran with
 * what outcome, and whether the editorial workflow verified. Pure so the
 * recorded shape is unit-tested; the brain's coverage gaps then steer later turns.
 */
export function summarizeTurnOutcome(outcome: TurnOutcome): string {
  const tools = outcome.tools.length
    ? outcome.tools
        .slice(0, 12)
        .map((tool) => {
          const ms = tool.ms === null ? '' : ` ${tool.ms}ms`;
          const changed = tool.changedProject ? ' changed-project' : '';
          return `${tool.name}(${tool.status}${ms}${changed})`;
        })
        .join(', ') + (outcome.tools.length > 12 ? `, +${outcome.tools.length - 12} more` : '')
    : 'no tools';
  const result = turnResult(outcome);
  return [
    `Bhippi AI turn (${outcome.provider}${outcome.model ? `/${outcome.model}` : ''}, ${Math.round(outcome.elapsedMs)}ms): ${clip(outcome.prompt.trim() || '(empty prompt)', 200)}`,
    `Tools: ${tools}.`,
    `Result: ${result}.`,
  ].join(' ');
}

/**
 * Records one turn outcome in the native brain, which links it to its tools, topics and skills
 * and leaves nudges for the next turn. The note also goes to IdeaGraph when an `ig` is configured.
 */
export async function recordTurnOutcome(outcome: TurnOutcome) {
  return api.brainRecordTurn(outcome, summarizeTurnOutcome(outcome));
}
