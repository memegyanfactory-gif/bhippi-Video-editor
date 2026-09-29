# Todo: AI turns: right mode, scoped Quick edits, work that stays in the project

Why: on 29 Sep an Opus 5.5 turn was sent to Quick edit (the "Carry on" text has no "make video"
words), skipped the whole pipeline and built the film in AppData with its own tools, where
nothing showed in the Project panel. Provider tools stay open; the fix is routing, scope and visibility.

Legend: [ ] to do · [~] in progress · [x] done

## 0. Protect the interrupted Opus run
- [x] Back up agent-workspace\meet (23 rendered scenes S01–S23, scripts, UI crops) and the Claude session log → Documents\Bhippi\4\AI Work\meet-opus-2026-09-29 (271 MB)
- [x] Found: Opus had finished all 23 scenes and copied them, named, to Documents\Bhippi\Untitled project\Renders\Meet Bhippi (plus film\out\placement.json with each scene's start and length)
- [ ] You: import that folder and place the scenes by placement.json (not done automatically: the app is closed and it is your project)

## 1. The right mode for every turn ✅
- [x] Continue button / model handover / retry keep the workflow of the turn they continue (src/lib/workflowRoute.ts, ChatPanel `routeSignals`)
- [x] Auto routing reads the situation: annotation → Quick; production under way / "make a video" → Full; brief or reference link on an empty (or audio-only) comp → Full
- [x] Each assistant turn remembers its workflow (`mode`); a "Full workflow" / "Quick edit" chip shows on the answer
- [x] Tests: 23 routing tests pass (incl. the exact 29 Sep "Carry on" case); type check clean

## 2. The agent works inside the project ✅
- [x] New project storage folder "AI Work" (storage.rs `Category::AiWork`, src/lib/storage.ts)
- [x] Claude Code / Codex / other CLIs start in <project>\AI Work (lead turn and its subagents), not AppData\agent-workspace. The CLI's own tools stay fully open
- [x] The prompt tells the agent: scratch in "AI Work", finished pieces in "AI Work\Output"
- [x] Project panel: new files in "AI Work\Output" come into an "AI Work" bin as they appear (checked every 4 s while a turn runs + at turn end; waits until a render stops growing; never re-adds a file you removed). src/lib/aiWork.ts
- [x] Tests: providers 125 ✓, backend chat/storage/subagent 35 ✓ + new workspace test ✓, frontend 31 ✓, type check clean

## 3. Quick edit = a scoped job ✅
- [x] Scope packet (src/lib/quickScope.ts): comp, clip ids, time range, whether a motion scene is in it. Built from monitor annotations and/or clips picked on the timeline
- [x] Right-click a clip → "Ask Bhippi AI about this clip" now attaches a scope chip to the composer (⌖ name · track · timecode, removable). A scoped message routes to Quick
- [x] Slim context for Quick (`quickContext`): only the scope's clips + neighbours within 2 s and the media they use; no storyboard, reference film, other brand kits or playbook; compact brand kit; compact brain (5 skills, 2 recalls)
- [x] Slim prompt for Quick: pipeline, crew, council, shorts, product-video and Remotion sections dropped (`<!-- workflow: … -->` markers in copilot.md). Motion Engine / Crimson / React Bits kept only when the scope holds a motion scene (or there is no scope). Prompt: 51.7K → 14.3K chars (73% smaller), 33K with a motion scene
- [x] Soft scope guard: the first edit of a clip outside the scope is paused with the reason; the same call again goes through (the model says why). Clips the turn made itself are always fine. Reads never paused
- [x] Every turn's trace records its workflow, whether it was scoped, and the context size
- [x] Tests: 5 new scope tests, 2 new prompt-gate tests, benchmark mirror updated. Full frontend suite 1969 ✓ before the fix (only the benchmark tripped, now ✓); backend 45 ✓; type check clean

## 4. A running turn is never lost ✅
- [x] The chat is saved every 5 s while a turn is writing (it used to be saved only after the turn ended, so closing mid-turn lost the whole answer)
- [x] A turn cut off by closing reopens as "Stopped", with its words, steps, workflow and a note: "Bhippi closed while this answer was being written… Continue carries on"
- [x] The provider's session id is kept on the turn (Claude Code session_id, Codex thread_id, Gemini session_id)
- [x] Closing while the AI works asks first: "Bhippi AI is still working", with Stop and close or Cancel. Stopping keeps what was done, then the usual unsaved-changes question
- [x] Continue on a cut-off Claude turn resumes the same Claude Code session (`--resume <id>`), with its full memory of what it read, ran and wrote
- [x] Tests: providers 127 ✓ (session id once, resume flag only for a real id and only for Claude), backend 32 ✓, reopen tests ✓, type check clean

## 5. Strong models work inside the pipeline ✅
- [x] New blueprint source `mediaSource: "render"`: a scene the agent makes with its own renderer (like Opus's Python engine) is planned like any other, rendered while gathering into AI Work\Output, then attached to its scene. A custom renderer now runs inside plan → Start generating → gather → Start editing, not around it
- [x] Plan reminder: a Full-workflow turn that works 10 minutes with no plan saved is told once (as a Bhippi note on its next tool result, never posing as you) to save the plan and end the turn, so the storyboard and Start button appear. Limit: an agent working only with its own shell tools reads it at its next Bhippi tool call
- [x] Tests: render scenes validate and must say what they render; reminders never pose as the user; benchmark gate kept at 44,250 (my additions trimmed to fit, limit not raised)

## 6. Ship ✅
- [x] Full test suites green: frontend 1975 passed / 0 failed (200 files), type check clean, Rust workspace 382 + 127 passed / 0 failed
- [x] Committed and pushed to main (origin)

## Log
- 22:10 Bhippi closed on its own; the orphan Opus render (python) is still running. Backup done. Starting step 1.
- 22:14 Step 1 done: routing fixed, mode chip added, tests + type check green. Starting step 2 (Work folder).
- ~22:20 Step 2 done: CLI runs in <project>\AI Work, finished renders show up in the Project panel. Starting step 3 (scoped Quick edits).
- 22:33 Step 3 done: Quick edits are scoped (timeline pick / annotation), get a 73% smaller prompt and a slim context, and are paused once before touching other clips. Starting step 4 (never lose a running turn).
- 22:38 Step 4 done: chat saved during turns, close asks first, a cut-off Claude turn resumes its own session. Starting step 5.
- 22:46 Step 5 done: render scenes in the pipeline, plan reminder. All suites green; committed and pushed to main.
