# AI Crew Plan: better videos at a lower cost

Goal: whatever the user asks for (2D characters, 3D characters, documentary, meme edit, motion
graphics, a normal edit, a SaaS ad), Bhippi's AI makes it properly, on every provider, using the
library the project already has. It should cost far fewer tokens than it does today.

## Where we are (measured 2026-09-26)

One OpenCode (big-pickle) SaaS-ad session:

| Measure | Value |
|---|---|
| Steps | 218 |
| Tokens | 24.6 M (23.9 M of them re-sent context) |
| Tokens before any work | ~100 K per step |
| Failed tool calls | 27 of 216 (12.5 %) |
| Compactions | 5 in 24 min; the 5th hung and the turn never finished |

Why:

1. **Everything, every step.** The 49 KB `prompts/copilot.md` and all 190 tools (~58 K tokens)
   go to every provider on every round (`chat.rs:356-475`, `mcp.rs:57-63`). Nothing is routed by
   genre, subsetted or cached.
2. **Huge results.**
   - MCP results are never shortened (`mcp.rs:340-351`).
   - `get_comp`, `get_motion_scene`, `list_motion_templates` and transcript words come back whole.
   - Re-reading an unchanged comp costs the full size again.
3. **Weak models break schemas.** Loose `type: object` params and quoted numbers produce retry
   loops, as seen in `animate_character`.
4. **The library is not used.** The AI has to discover knowledge by calling `list_*` tools.
   - The 9-film reference study (`docs/research/video-study`) is never read at runtime.
   - `src/lib/stylePacks.ts` is only used by tests.
   - The reference guides reset on restart.
   - `copilot.md:100` names the 3 built-in rigs instead of the character library.
   - There is no documentary, 3D-promo or plain-edit playbook.
5. **No judge.**
   - QA is deterministic rules: the council (`council.ts`), `run_frame_qa` and pacing.
   - Nobody scores the result against the brief.
   - The model can end a turn without `verify_edit_workflow` (`chat.rs:787-792`).
   - `visualQualityVerified` is hard-coded `false` (`editWorkflow.ts:513`).
6. **Cost is invisible.**
   - There is no per-project token ledger.
   - OpenCode's per-step usage is overwritten, not summed (`transcript.rs:316`).
   - `recordTokens` overwrites the last turn's totals instead of adding to them.
   - Subagent tokens are never recorded.
   - Subagents' `max_rounds` is ignored (`subagent.rs:131`), so each can run 120 rounds.

## The crew

Four roles, all running inside the existing turn loop. Only the vision judgement costs model
tokens; every other check is deterministic and free.

| Role | Job | How |
|---|---|---|
| **Token Council** | Keep one project's spend low and visible | A per-project ledger and a budget per phase. It dedupes redundant reads, trims tool results and routes tools. It can say "stop re-reading, use what you have". Deterministic, no LLM. |
| **Director** | The product must be good | Owns the brief → storyboard → blueprint. Picks the genre playbook and reference. Rejects a plan that does not match the brief. At plan time, runs **parallel proposals → critique → vote**. |
| **Editor** | Every frame is right | Renders frames at every beat and at 2 fps around cuts. Runs pixel checks (safe area, collisions, blank or flat frames, black edges, text legibility, contrast). Writes a fix list per frame. Does not let the Director finish until the frame score passes. |
| **Judge** | Final score of the output against the brief | Score 0–100 from a rubric: deterministic metrics plus one vision pass over a contact sheet. Below the threshold, the notes go back to the Director and the loop starts again, capped by the Token Council. |

**Debate protocol (plan stage only; that is where it pays off):**

1. Spawn 3 proposal subagents in parallel. Each gets a different angle (story-first,
   motion-first, product-first), a small model, and a hard cap of 8 rounds and a fixed token
   budget.
2. Each proposal is scored on the same rubric. The proposals are then shown to each other once
   for critique.
3. Each seat votes. The majority wins, and a tie goes to the Director. The winning storyboard is
   executed as a blueprint.
4. The Judge scores the finished edit.
   - A score below the threshold (default 80) sends the Judge's notes back.
   - At most 2 re-loops before the loop stops with the score and notes shown to the user.

## Phases

Each phase ships on its own and is measured on the benchmark from Phase 6: tokens per finished
video, tool error rate, judge score.

### Phase 0: Stop the failures (reliability) — done
- [x] `animate_character` and `create_character` handle quoted numbers, a second copy of the
      same character, and `acc` sent as an object.
- [x] **Schema-guided argument repair for every tool and every provider** (`argRepair.ts`,
      applied where a tool call first arrives in `App.tsx`):
  - quoted numbers and booleans become real values;
  - a JSON string where an object or array is expected is parsed;
  - a single value where an array is expected is wrapped;
  - an `enum` is matched without regard to case.
- [x] Character errors show the expected shape with an example. Not done: "did you mean" for
      unknown keys.
- [x] The prompt names `list_characters` and the library, not the three built-in rigs.
- [x] Subagents respect `max_rounds` (a `ChatRequest.max_rounds` cap).
- [x] CLI stall: a CLI silent for 8 min with no tool running is ended (it used to be 20 min).

### Phase 1: Token Council (cost) — done
- [x] **Result budget on every path, including MCP**, with compact views:
  - transcripts go out as `timed` lines, about 6× smaller;
  - `get_comp` sends one line per storyboard beat and a blueprint summary (`plan:true` for the
    whole plan) and never sends image data — this also shrinks every turn's context;
  - `list_motion_templates` sends the menu only, with params when queried by id;
  - `get_motion_scene` template params drop rasters and other blobs.
- [x] **Read dedupe** (`readDedupe.ts`): an unchanged repeat read within 8 calls gets a one-line
      "Unchanged". A third ask in a row gets the full body again.
- [x] **Ledger per project** (`tokenLedger.ts`):
  - every finished turn is recorded, subagents included;
  - OpenCode steps are summed, with the cache counted;
  - the model sees `context.tokenBudget` (spent against a soft 3 M budget, with advice).
- [x] **Budgets:**
  - project-level advice at 75 % and 100 %;
  - in-turn step marks at 60 and 100 calls tell the model to wrap up.
- [x] **Prompt caching** for the Anthropic API (and OpenCode Zen's Claude models):
      `cache_control` on the last tool, the system prompt and the newest message.

### Phase 2: Routing and knowledge (use the library) — done
- [x] **Genre router** (`toolRouter.ts`): `saas`, `motion`, `character2d`, `3d`,
      `documentary`, `meme`, `edit`, `shorts`. It reads the message, the recent asks and
      @funny.
- [x] **Prompt by genre:** instead of splitting `copilot.md` into files, its sections and bullets
      carry `<!-- only: … -->` gates (`chat.rs gate_genres`). An edit drops ~12 KB of the 50 KB
      prompt.
- [x] **Tool subsets:** the core tools plus the genre's tools go out whole; every other tool is
      a one-liner with `tool_help`.
  - The subsets are phase-aware: plan tools are slim while editing, edit tools slim while
    planning.
  - The same set is used on the native, text and MCP paths.
- [x] **Knowledge with the brief:** the genre's playbook (beats, look, timing, rules, gaps)
      arrives in `context.toolset.playbook`. A drawn look (riso, sketch, paper) gets the
      hand-made playbook.
- [x] **Missing playbooks:** documentary, 3d-promo, product-launch, ui-walkthrough,
      normal-edit, meme-edit.
- [x] `stylePacks.ts` is reachable as `motion_guide {topic:"pack:<id>"}`. The active reference
      survives a restart.

### Phase 3: The crew (quality) — done
- [x] **`judge_edit`** (`judge.ts`): scores 0–100 on six weighted criteria:
  - every frame clean (the Editor's pass);
  - the council signs off;
  - pacing against the genre's playbook;
  - every storyboard beat on screen;
  - designed motion density for the genre;
  - the genre's must-haves.

  The pass mark is 80. It is measured from the timeline, so it is free and repeatable. The
  contact frames go to the model for taste. There is **no separate vision model** yet
  (see Next).
- [x] **The Editor's frame pass** checks two new things: text too small to read on a phone
      (`small-text`), and text that melts into its background on the rendered frame
      (`low-contrast`, luminance spread inside the text box).
- [x] **The verify gate** needs a current Judge verdict at 80 or more on productions.
      `visualQualityVerified` is now real.
  - An edit turn that changed the timeline but ended unverified gets **one automatic finishing
    round** (ChatPanel), never two.
- [x] **Plan-stage debate** (`director.ts`, `propose_storyboards`):
  - three capped subagents work in parallel (story-first, motion-first, product-first) with
    4 rounds each, a tiny toolset and the brief inline;
  - the Director, Animator and Story seats critique every proposal;
  - majority vote, and the Director breaks a tie.
- [x] **Re-loop control:** `JUDGE_ROUNDS = 3` (two re-loops). After that, verify passes with the
      score told to the user.

### Phase 4: Genre production lines — done
Each genre has a playbook (its blueprint skeleton, sent with the brief), its tool group, and
must-haves the Judge checks (`genreChecks`):
- **2D character:**
  - a character on screen;
  - every character acts (2+ timed actions);
  - spoken lines lip-synced;
  - cast from the library.
- **SaaS:**
  - the product UI in use (`create_ui_screen`);
  - a CTA end card in the last 20 %;
  - the brand on screen;
  - product-launch pacing.
- **Documentary:** lower thirds, b-roll from 3+ sources, calm pacing (3–7 s swaps).
- **Motion:** 2+ motion scenes, animated type.
- **3D:** a 3D render or scene on the timeline.
- **Meme:** memes or reaction media placed (the meme tools work outside @funny too).
- **Edit:** captions for speech, a music bed or sound design.
- **Shorts:** vertical frame, captions.

### Phase 5: Provider parity — done
- [x] **Contract test** (`every_transport_sends_the_same_toolset`): native, text and MCP send
      the same tools whole and the rest slim. Argument repair runs for every provider.
- [x] **Text-only CLIs** get `frameNotes` (each rendered frame in words: brightness, flat share,
      what is on screen) with frame QA and the Judge.
- [x] **Quirks table** (below).

### Phase 6: Benchmark — done
- [x] **Golden briefs** in `tests/briefs/golden.json`, one per genre (9 briefs).
- [x] **Regression gate** (`tests/benchmark.test.ts`): no brief's per-step overhead may pass
      44 K tokens. `BENCH_WRITE=1` rewrites `docs/benchmarks/latest.md`.
- [x] **Real-run report:** `node scripts/session-report.mjs [--last N]` shows steps, tokens,
      failure rate, the heaviest tools and the Judge's scores from OpenCode's own records. A
      headless LLM runner needs a live provider, so real runs are measured this way.
- [x] **Turn traces, every provider:** each AI turn writes `traces/<project>/<turn>.jsonl` in the
      app data folder (`src-tauri/src/trace.rs`, `src/lib/turnTrace.ts`): the routed toolset,
      every tool call (time, status, size, argRepair / readDedupe hits, guard and permission
      refusals), the Judge's scores and the turn's tokens. `session-report.mjs --bhippi [--last N]`
      reports on them. Settings → Brain → Keep turn traces turns it off.

## Provider quirks

| Provider path | How tools arrive | Images to the model | Notes |
|---|---|---|---|
| Claude Code, Codex, OpenCode (MCP) | MCP `tools/list` with the turn's toolset (`--full=`) | MCP image blocks (≤ 6) | The CLI runs its own loop and may compact on its own (OpenCode hung in its compaction once). Arguments are repaired on arrival. |
| Grok CLI, Antigravity (text) | Compact catalogue in the prompt, slim lines for the rest | None: `frameNotes` text instead | Tool blocks are parsed from the reply; 120-round cap. |
| Cloud APIs, local servers (native) | `tools` array per request, toolset applied | Inline, ≤ 6 per round | Anthropic gets prompt caching; others rely on the server. |
| Weak models (e.g. big-pickle) | any | any | Quote numbers inside arrays and wrap lists as objects: `argRepair` fixes both. |

## Progress log

- **2026-09-26:** Phase 0 done; Phases 1 and 2 partly done (see the git history for the details).
- **2026-09-27:** Phases 1–6 completed.
  - Overhead per step, before any work: ~69 K tokens (whole prompt and catalogue) became
    31–42 K in the edit phase, 39–55 % less (`docs/benchmarks/latest.md`).
  - Baseline real run, before these changes: 184 steps, 20.9 M tokens, 114 K per step, 12.8 %
    failed calls (`ses_f2299b8c5ffeXLEHjeEJUserry`).

## Next
- Measure a real production after these changes with `scripts/session-report.mjs`. That shows
  tokens per video, the error rate and the Judge's score.
- Shorten the core tools' own descriptions, the rest of the per-step cost (~18 K tokens).
- An independent vision judge: a small vision model scoring the contact sheet, optional and
  budgeted.
- The Editor's still-missing checks: near-duplicate frames (dead motion) and a subject cut off at
  the frame edge.
- "Did you mean" for unknown argument keys.

## Targets

| Metric | Before | Now | Target |
|---|---|---|---|
| Tokens per step before work | ~69–100 K | 31–42 K (edit phase) | ≤ 30 K |
| Tokens per finished 40 s video | ~21–25 M | measure the next run | ≤ 3 M |
| Tool error rate | 12.8 % | measure the next run (repair covers the observed failures) | ≤ 2 % |
| Turns ending unverified | common | one automatic finishing round, then verify or report | 0 |
| Judge score, golden briefs | none | scored on every production | ≥ 80 on every genre |
