// Phase 6 (docs/AI-CREW-PLAN.md): the cost regression gate.
//
// For every golden brief, the overhead one step carries before any work: the system prompt the
// backend keeps for its genres (src-tauri/src/chat.rs gate_genres) plus the tool catalogue with
// the router's toolset whole and the rest slim (ai_tools.rs slim). Both are mirrored here in a few
// lines so the gate runs with the frontend suite; the Rust tests pin the real implementations.
//
// BENCH_WRITE=1 npx vitest run tests/benchmark.test.ts  rewrites docs/benchmarks/latest.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/ai-tools.json';
import { routeTools } from '../src/lib/toolRouter';
import briefs from './briefs/golden.json';

type Tool = { name: string; description: string; input_schema: unknown };
const tools = (catalog as unknown as { tools: Tool[] }).tools;
const PROMPT = readFileSync('src-tauri/prompts/copilot.md', 'utf8');

/** Mirrors ai_tools.rs `first_sentence` + `slim`. */
function slim(tool: Tool): Tool {
  const cut = tool.description.indexOf('. ');
  const first = tool.description.slice(0, Math.min(cut < 0 ? tool.description.length : cut + 1, 72));
  return { name: tool.name, description: `${first} (params: tool_help)`, input_schema: { type: 'object', additionalProperties: true } };
}

/** Mirrors chat.rs `gate_genres`. */
function gate(prompt: string, genres: string[]): string {
  const out: string[] = [];
  let pending: boolean | null = null;
  let skipping = false;
  for (const line of prompt.split(/\r?\n/)) {
    const only = line.trim().match(/^<!-- only:(.*)-->$/);
    if (only) { pending = only[1].trim().split(/\s+/).some((g) => genres.includes(g)); continue; }
    if (line.trim().startsWith('## ')) { skipping = pending === false; pending = null; }
    else if (pending !== null) { const keep = pending; pending = null; if (!keep) continue; }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

const tokens = (text: string) => Math.round(text.length / 4);
const BASELINE = tokens(PROMPT) + tokens(JSON.stringify(tools));

type Row = { id: string; genres: string[]; whole: number; prompt: number; catalogue: number; step: number; saving: number; plan: number };

function overhead(brief: string, phase: string | null) {
  const set = routeTools(brief, [], null, phase);
  const full = new Set(set.full);
  const catalogue = tokens(JSON.stringify(tools.map((tool) => (full.has(tool.name) ? tool : slim(tool)))));
  const prompt = tokens(gate(PROMPT, set.genres)) + tokens(JSON.stringify(set.playbook ?? {}));
  return { set, full, catalogue, prompt, step: prompt + catalogue };
}

/** The edit phase is where a production spends most of its steps, so it is the headline number. */
function measure(): Row[] {
  return (briefs as { id: string; brief: string; genres: string[] }[]).map(({ id, brief }) => {
    const edit = overhead(brief, 'editing');
    const plan = overhead(brief, 'planning');
    return { id, genres: edit.set.genres, whole: edit.full.size, prompt: edit.prompt, catalogue: edit.catalogue, step: edit.step, saving: Math.round((1 - edit.step / BASELINE) * 100), plan: plan.step };
  });
}

describe('benchmark: overhead per step, by kind of video', () => {
  const rows = measure();

  it('routes every golden brief to its kind of video', () => {
    for (const [i, brief] of (briefs as { genres: string[] }[]).entries()) expect(rows[i].genres).toEqual(expect.arrayContaining(brief.genres));
  });

  it('keeps every brief well under the old everything-every-step baseline', () => {
    for (const row of rows) {
      expect(row.step, `${row.id}: ${row.step} tokens vs baseline ${BASELINE}`).toBeLessThan(BASELINE * 0.75);
      // The regression gate: a change that makes any brief's step overhead grow past this fails.
      // Raised from 44,000 on 2026-09-29 for `list_caption_styles` (+46 tokens a step), the one
      // tool that lets a model choose among the 139 WatchFIWN caption styles by look and use.
      // Raised to 44,250 the same day for `add_graphic` (its one-line slim entry, ~+16 a step over
      // the gate), the one-call graphic tool that small models use instead of raw templates.
      expect(row.step, row.id).toBeLessThan(44_250);
    }
  });

  it('writes the table when asked', () => {
    if (!process.env.BENCH_WRITE) return;
    const table = [
      `# Step overhead by kind of video`,
      ``,
      `Before any work, one step used to carry the whole prompt and every tool: **~${BASELINE.toLocaleString('en')} tokens**. Measured ${new Date().toISOString().slice(0, 10)} (tokens ≈ bytes ÷ 4).`,
      ``,
      `Edit-phase steps (most of a production). Plan-phase steps shown for comparison.`,
      ``,
      `| Brief | Genres | Tools whole | Prompt | Catalogue | Per edit step | Saving | Per plan step |`,
      `|---|---|---|---|---|---|---|---|`,
      ...rows.map((r) => `| ${r.id} | ${r.genres.join(', ')} | ${r.whole} | ${r.prompt.toLocaleString('en')} | ${r.catalogue.toLocaleString('en')} | ${r.step.toLocaleString('en')} | ${r.saving}% | ${r.plan.toLocaleString('en')} |`),
      ``,
    ].join('\n');
    writeFileSync('docs/benchmarks/latest.md', table);
  });
});
