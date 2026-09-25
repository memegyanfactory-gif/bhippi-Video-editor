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
};

export type TurnOutcome = {
  provider: string;
  model: string | null;
  prompt: string;
  elapsedMs: number;
  stopped: boolean;
  faultKind: string | null;
  verified: boolean | null;
  tools: TurnToolSummary[];
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

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
  const result = outcome.faultKind
    ? `fault: ${outcome.faultKind}`
    : outcome.stopped
      ? 'stopped by user'
      : outcome.verified === true
        ? 'workflow verified'
        : outcome.verified === false
          ? 'workflow unverified'
          : 'done';
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
