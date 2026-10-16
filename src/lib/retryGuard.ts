// Stops a model repeating a call that just failed, byte for byte, in the same turn.
//
// Weak models often resend the identical arguments after an error (157 of 835 mined failures), which
// costs a round trip and teaches nothing. The second identical call is answered at once with the
// first error. The memory is per turn, bounded, and wiped whenever something succeeds that could have
// changed why the call failed (a project edit, a file written, a command run), and some tools are
// never guarded because their failure is meant to clear with time or state.

/** Tools whose failure reflects state that moves on its own, or that gate on later work. */
export const GUARD_EXEMPT = new Set([
  'verify_edit_workflow', 'judge_edit', 'run_frame_qa', 'editing_workflow_status', 'ask_user', 'run_command',
  'choose_comp_size', 'choose_shorts_format', 'spawn_subagent',
]);

/** A success from these cannot change why an earlier call failed. */
const PASSIVE = /^(get_|list_|read_|inspect_|search_|grep_|find_|check_|review_|brain_recall|tool_help|analyze_)/;

const MAX_TURNS = 12;
const MAX_CALLS = 60;

const turns = new Map<string, Map<string, string>>();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const callKey = (tool: string, args: unknown) => `${tool}\u0000${stable(args)}`;

const guarded = (tool: string) => !GUARD_EXEMPT.has(tool) && !tool.startsWith('mcp__');

/** The error this exact call already failed with this turn, or null. */
export function priorFailure(turnId: string | undefined, tool: string, args: unknown): string | null {
  if (!turnId || !guarded(tool)) return null;
  return turns.get(turnId)?.get(callKey(tool, args)) ?? null;
}

/** Notes how a call ended: remembers a failure, and forgets them all after a success that may change things. */
export function noteOutcome(turnId: string | undefined, tool: string, args: unknown, ok: boolean, changedProject: boolean, error?: string) {
  if (!turnId) return;
  if (ok) {
    if (changedProject || !PASSIVE.test(tool)) turns.get(turnId)?.clear();
    return;
  }
  if (!guarded(tool)) return;
  let memory = turns.get(turnId);
  if (!memory) {
    memory = new Map();
    turns.set(turnId, memory);
    while (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value as string);
  }
  if (memory.size >= MAX_CALLS) memory.delete(memory.keys().next().value as string);
  memory.set(callKey(tool, args), error ?? 'failed');
}

/** The result for a repeated failing call, without running it. */
export function repeatMessage(error: string): string {
  const base = error.split('\nHint: ')[0];
  return `This exact call already failed this turn: ${base}. Change the arguments (see the hint on that error) before retrying, or use a different tool.`;
}

export function resetRetryGuard() {
  turns.clear();
}
