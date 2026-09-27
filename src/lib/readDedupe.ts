// Token Council, rule 1: a read the model already has is not sent again.
//
// A model re-reads the comp or a motion scene between almost every edit; when nothing changed the
// answer is byte-for-byte what it already holds, and on a long turn those repeats were most of
// the tokens (one 38 s ad: get_comp ×7 and get_motion_scene ×14, ~230 KB). A repeat within a few
// calls gets a one-line "unchanged" note instead. Asking again straight after that note returns
// the full body: the model's own context compaction may have dropped the earlier copy.
import type { ToolResult } from './types';

/** Reads whose whole answer is the current state of something, so a repeat can be recognised. */
export const DEDUPED_READS = new Set([
  'get_comp', 'get_project', 'get_motion_scene', 'list_motion_templates', 'list_characters', 'list_character_actions',
  'motion_guide', 'get_brand_guideline', 'get_brand_kit', 'list_brand_kits', 'list_drawn_styles', 'list_recipes', 'list_3d_presets',
]);

/** How many calls back a repeat still counts as "you just read this". */
const WINDOW = 8;

type Seen = { call: number; fingerprint: string; noted: boolean };

const keyOf = (name: string, args: unknown) => `${name} ${JSON.stringify(args ?? {})}`;

export class ReadDedupe {
  private calls = 0;
  private seen = new Map<string, Seen>();

  /** Every call passes through, reads and edits alike, so the window counts real steps. */
  pass(name: string, args: unknown, result: ToolResult): ToolResult {
    return withStepNote(this.dedupe(name, args, result), this.calls);
  }

  private dedupe(name: string, args: unknown, result: ToolResult): ToolResult {
    this.calls += 1;
    if (!DEDUPED_READS.has(name) || !result.ok) return result;
    const key = keyOf(name, args);
    const fingerprint = JSON.stringify(result);
    const before = this.seen.get(key);
    if (before && before.fingerprint === fingerprint && !before.noted && this.calls - before.call <= WINDOW) {
      this.seen.set(key, { ...before, call: this.calls, noted: true });
      const ago = this.calls - before.call;
      return {
        ok: true,
        unchanged: true,
        summary: `Unchanged since your identical ${name} ${ago === 1 ? 'one call' : `${ago} calls`} ago — use that result. (Call it once more if you no longer have it.)`,
      };
    }
    this.seen.set(key, { call: this.calls, fingerprint, noted: false });
    return result;
  }
}

/**
 * The in-turn budget. The project ledger only moves when a turn ends, so a long turn is paced by
 * its own step count: every round re-sends the whole context, and past these marks each extra
 * step costs more than the change it makes.
 */
export const STEP_MARKS: [number, string][] = [
  [60, '60 tool calls this turn. Finish the current batch of edits, then run_frame_qa and verify; skip exploratory reads.'],
  [100, '100 tool calls this turn. Stop starting new work: fix only what QA or the judge flagged, verify, and end the turn.'],
];

function withStepNote(result: ToolResult, calls: number): ToolResult {
  const mark = STEP_MARKS.find(([at]) => at === calls);
  if (!mark) return result;
  const note = `Token Council: ${mark[1]}`;
  return result.ok ? { ...result, summary: `${result.summary ?? 'done'}\n${note}`, tokenCouncil: note } : { ...result, error: `${result.error}\n${note}`, tokenCouncil: note };
}

const turns = new Map<string, ReadDedupe>();

/** The dedupe for one turn (a subagent's turn is its own). */
export function readDedupeFor(turnId: string): ReadDedupe {
  let found = turns.get(turnId);
  if (!found) {
    found = new ReadDedupe();
    turns.set(turnId, found);
    // Turns are short-lived; keep the map from growing across a long session.
    if (turns.size > 64) turns.delete(turns.keys().next().value as string);
  }
  return found;
}
