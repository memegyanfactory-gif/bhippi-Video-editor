# Helios — World-Class Plan

*Chief architect's synthesis, 2026-09-24. Branch `feat/motion-engine`. Inputs: 7 subsystem audits (export, agent, motion, timeline, playback, visual QA, craft, platform). Every bug below survived adversarial verification. The severity shown is the **verified** severity. Claims that were refuted are listed in §8 so nobody chases them.*

---

## 1. Executive summary

### Where Helios stands

No other shipping product combines these three things:

- a bring-your-own-model agent (Claude CLI/API, OpenAI-compatible, Gemini, Ollama, plus Helios as an MCP server);
- a real Premiere-style NLE with transactional edit programs;
- an After-Effects-class WebGL2 motion engine that uses the same code for preview, export and a render-and-measure QA pass.

Adobe's assistant organises bins. Descript, Captions and Riverside have agents but only shallow motion design. Runway and Seedance return pixels, not editable structure. The architecture already carries a real moat.

The weak points are at the seams, not the core:

- The export pre-render can hang silently and can **delete the user's source footage**.
- Preview and export disagree in at least six concrete ways.
- A shared `.helios` file can **run arbitrary PowerShell** on open.
- The Anthropic API provider fails on every tool turn.
- The QA loop measures boxes that were guessed instead of pixels that were drawn, and the model never actually sees its contact frames.

### The five things that matter most

1. **Exports you can trust.**
   - Fix now: no silent hangs (per-stage deadlines, abort, named stall reasons); never delete or overwrite inputs; non-ASCII profile paths work; fix every known preview≠export divergence.
   - Then ship the **Export Certificate**, which answers the owner's open complaint with proof.
2. **Close the RCE.**
   - Now: graphic JS from an opened project is quarantined until the user consents.
   - Within two weeks: graphics run in a sandboxed iframe and privileged IPC is capability-gated.
3. **Make the agent loop reliable on every provider.** This covers Anthropic adaptive thinking and thinking-block replay, MCP/CLI turns that are not killed at 20 minutes, real subagents, QA images that reach the model, a sensible output-token cap, and result-size caps.
4. **Give QA a director's eye.**
   - Stop false positives the model cannot clear (full-frame HTML, 9:16 margin mismatch).
   - Stop false negatives (Crimson templates collapse into the top third of 9:16 frames; transforms are ignored).
   - Make `verify` depend on a *clear* QA result, then measure what is drawn (alpha bboxes, contrast, readability).
   - Guard it with an **eval harness** so craft regressions fail CI.
5. **Table stakes plus moat inventions.**
   - Table stakes: transcript editing with filler/retake removal (**Word Anchors**), neural speech enhancement, semantic media search, localization.
   - Moat, only Helios can do these: **Point & Say**, the **negative-space layout solver**, **signal expressions**, **linked multi-aspect masters**, and the **motion critic**.

### The export complaint, "make sure it actually exports what is in preview"

Every concrete divergence the audit found, and its fix:

| # | Divergence | Fix (package) |
|---|---|---|
| 1 | File › Export Frame drops every motion scene and turns HTML cards into white titles | P7 item 9 |
| 2 | Motion clips: preview stretches the scene and ignores mask/crop/flip; export fits it and applies them | P1 item 7 |
| 3 | Custom/legacy HTML in 9:16 and 1:1: preview is top-aligned, export is letterboxed and centred | P1 item 6 |
| 4 | Preview text-texture cache shows stale alignment/stroke/shadow; export is correct | P1 item 4 |
| 5 | MediaBank shares one `<video>` per file, so a jump cut inside a motion comp puts removed footage in the export | P1 item 5 |
| 6 | Concurrent proxy transcodes corrupt the preview proxy while export reads the original (this happens on **every** non-native import with sound) | P6 item 3 |
| 7 | Non-ASCII Windows profile: motion/HTML export fails on frame 0 | P6 item 2 |
| 8 | The pre-render hang itself | P1 items 1–2 |

---

## 2. Fix now (critical + high, plus cheap mediums)

Format for each entry: **Problem → Root cause → Fix → Verify → Effort.** Package numbers refer to §9 / `work_packages`.

### 2.1 Export pipeline and preview/export parity

**E1. The export hang: silent, endless "Rendering", and Cancel does nothing** *(high; the user's open report)*
- **Problem.** On 2026-09-23 motion target 1/15 wrote frames 00000–00362 and then stopped. No log, and the app stayed alive (autosaves continued). Cancel only sets an abort flag that is checked between frames. The window stays "running" with no Close button.
- **Root cause, honestly stated.** The trigger is unknown. The two candidates are the raw-body Tauri invoke (`mogrt_frame_write` via the WebView2 custom protocol) and the PNG worker pool. What *is* certain is that nothing on this path has a deadline:
  - `pngEncoder.ts:123` `room()` races the in-flight promises forever.
  - `close()` awaits `allSettled` *before* `pool.close()`, so a single failure also hangs.
  - `prepareExact`, `writer.pixels` and `api.mogrtFrameWrite` are unbounded.
  - `renderProgress.cancel()` only aborts the signal.
- **Fix (P1).**
  - Per-stage deadlines: encode 30 s, IPC write 30 s, `prepareExact` 20 s. Each timeout sets a named failure, e.g. `frame 363: mogrt_frame_write gave no answer in 30 s`.
  - `room()` also wakes on abort and on first failure.
  - `close()` terminates the pool first on failure/abort, then waits at most 5 s.
  - Thread `signal` through `openFrameWriter` from all four callers.
  - Add a heartbeat in `renderProgress` (`lastProgressAt`, stage, frame). RenderWindow shows "No progress for 20 s: waiting on <stage> for frame N".
  - Log the stall table through the existing `api.frontendCrash` channel. Phase 1 replaces this with a proper `export_log`.
- **Structural follow-up (Phase 1, §4A).** Move frames off the raw-body invoke onto a loopback HTTP sink. That is exactly the path the parity harness uses, and the harness does not hang.
- **Verify.**
  - New `tests/pngEncoder.test.ts` with fake timers covers three cases: `mogrtFrameWrite` never resolves → `pixels()` or `finish()` rejects with the named message within the deadline; a worker that never replies → the same; abort mid-flight → `close()` returns within 5 s.
  - Manual: run the parity harness with an injected stall and confirm the window shows the stage and Cancel closes it.
- **Effort.** S–M.

**E2. Exporting onto a source file deletes it** *(high, data loss; P6)*
- **Problem.** A comp named like its source, exported to the same folder, gives FFmpeg `Output same as Input` → `Err` → `export_start` runs `remove_file(output)` and the original footage is gone. If the paths differ only in case, `-y` truncates the source instead. Real paths that trigger this: "Untitled project/Exports/Comp 1.mp4" re-imported and re-exported; and running Render and Replace twice.
- **Root cause.**
  - `lib.rs:2082-2090` validates only the extension.
  - `lib.rs:2158-2161` deletes whatever sits at the output path on failure.
- **Fix.**
  - Canonicalize the output and every `-i` input in the plan (compare case-insensitively on Windows) and refuse on a match.
  - Render to `<stem>.helios-part.<ext>` and rename it over the target on success.
  - On failure, delete only the part file.
- **Verify.** Rust unit test: a plan whose input equals the output is refused. Integration: a failed export leaves an existing file at the target byte-identical.
- **Effort.** S.

**E3. Non-ASCII user profile: motion/HTML export and QA stills fail** *(high; P6)*
- **Problem and root cause.** The full frame-folder path travels in the `x-mogrt-dir` HTTP header.
  - `new Headers` throws on CJK characters.
  - `HeaderValue::to_str()` rejects `é`.
- **Fix.**
  - Send only the ASCII leaf `{safe}-{ulid}`.
  - Rust validates it against `[A-Za-z0-9_-]{1,96}` and joins it under `paths.work/mogrt`. This also drops the two `canonicalize()` calls per frame.
  - Update the parity harness mock.
- **Verify.** A Rust unit test with a work root containing `张伟` writes a frame; leaf traversal (`..`) is refused; the parity harness still exports.
- **Effort.** S.

**E4. Concurrent derive storms corrupt preview proxies** *(high; P6)*
- **Problem.**
  - `library_list`, which runs on every `helios://library` event, re-spawns `prepare_media` for every asset with audio and no peaks.
  - Each import therefore runs 3 derives at once, and 3 libx264 encodes write the same `proxies/{id}.mp4`. This was verified: the result was corrupt, with 30 of 900 frames decodable.
  - `derived_ok` passes because the file is non-empty. The preview plays garbage while the export uses the original.
  - When peaks can never be produced, the derive loops forever.
- **Fix.**
  - Make `library_list` read-only: move the backfill into the once-per-launch startup pass via `needs_derive`.
  - Add a `preparing: Mutex<HashSet<String>>` guard with a drop guard.
  - Encode the proxy to `{id}.part.mp4` and rename on success.
  - When FFmpeg is missing, keep the existing `preview` instead of setting it to "failed".
  - Merge only the derived fields into the current slot, and only when the path is unchanged.
- **Verify.** Rust test: calling `prepare_media` twice for the same id spawns one job. Manual: importing an HEVC .mov with sound creates one "Preparing" job and a proxy that decodes cleanly (`ffmpeg -v error -i proxy -f null -` shows no errors).
- **Effort.** S–M.

**E5. WebGL contexts are never released; a lost context is never recovered** *(medium; P1)*
- **Problem.** `GL.dispose()` never calls `WEBGL_lose_context`, and `gl.lost` is sticky. This was reproduced along the storyboard and QA-still path (15+ stills between garbage collections). The shared preview renderer is evicted and motion scenes go blank until restart. `pixels()` on a lost context reads zeros.
- **Fix.**
  - `loseContext()` in `dispose()`.
  - `renderMotionStill` creates a renderer lazily, only when some target has indices.
  - One renderer per export for all targets.
  - `draw()` sets `incomplete=1` when lost; `pixels()` throws `GPU context lost`.
  - `MotionLayer` and `previewCache` drop and rebuild a lost renderer, bump a generation counter so the bank listener re-subscribes, and clear the cached frames.
- **Verify.** Extend the audit's Chromium harness (`ctx.mjs`) into `tests/` or a script: 30 `renderMotionStill` calls leave the preview not lost; a forced `loseContext` on the preview recovers on the next draw.
- **Effort.** S.

**E6. Export Frame (Ctrl+Shift+E) drops motion and HTML** *(medium, cheap; P7)*
- **Fix.** Prepare the project the way QA does: `renderHtmlStill(await renderMotionStill(project, comp.id, [at], assets), comp.id, [at])`.
- **Verify.** A frame exported from a `[Motion]` comp contains the scene (the parity harness can compare it against the QA still).
- **Effort.** XS.

**E7. Motion clip geometry differs between preview and export** *(medium; P1)*
- **Fix.** The Compositor `'motion'` case uses `placement()` with the resting transform (`restingClip` values for layer clips), `maskStyle`, flip and `clipPath`, exactly like the default case, so it matches `video.rs place()`.
- **Verify.** A vitest/DOM check of the computed box for a layer clip with a rectangle mask plus `flipH`, and for a scene whose aspect differs from the comp.
- **Effort.** S.

**E8. Custom/legacy HTML is top-aligned in preview and centred in export (9:16, 1:1)** *(high; P1)*
- **Fix.** For fixed-canvas graphics, the preview uses the export's Fit rule: `scale=min(W/1920,H/1080)`, centred.
- **Verify.** In a 1080×1920 comp, a custom graphic's canvas top is 656 px in both preview (DOM measure) and export (a still from the parity harness).
- **Effort.** XS.

**E9. Stale preview text textures** *(medium, cheap; P1)*
- **Fix.** Reuse a text texture only when `cached.data === layer.text`, and add `g.x,g.y` to the signature.
- **Effort.** XS.

**E10. MediaBank shares one element per file and ignores the requested time** *(medium; P1)*
- **Fix.**
  - Active layers (`in<=t<out`) claim elements first; a lookahead entry never re-seeks an element an active layer is using at a different time.
  - `frame(source, time)` returns null (so the layer counts as incomplete) when `|currentTime-time| > 0.5/fps`.
  - A second pooled element per URL is Phase 2 (media manager).
- **Verify.** A unit test with a razored footage layer and a jump cut: at `t = cut - 0.3` the active layer's element is at `tA`.
- **Effort.** S.

### 2.2 Security and data integrity

**S1. Script inside an HTML graphic runs with full IPC, so opening a shared `.helios` file is RCE** *(critical)*
- **Problem.** `source.js` runs via `new Function` in the main webview (preview `HtmlMotionLayer.tsx:63`, export `htmlFrames.ts:116`). It can call `fs_run_command` (pwsh, no checks), `fs_write_file`, `open_path`, and read any file through the unscoped `asset` protocol.
- **Fix now (P7 + P6).**
  - In `openProjectFile` (the only path for external files: double-click, drag-drop, Open, Recent), move every non-empty `html.js` to `quarantinedJs`.
  - Show a single confirm dialog: "This project contains N motion-graphic scripts from another source. Run them?" Restore on consent.
  - The session autosave (`current.json`) is not quarantined.
  - Rust `ClipSource::Html` gains `quarantined_js: Option<String>` so the field round-trips.
- **Fix next (Phase 1, §4B).**
  - Run graphics in `<iframe sandbox="allow-scripts" srcdoc>` with postMessage seek/capture, in both preview and export.
  - A per-turn capability token for `fs_run_command`, `fs_write_file`, `fs_edit_file` and `open_path`.
  - Asset-protocol allow-list.
  - Drop `'unsafe-eval'`.
- **Verify.** Open a crafted file whose clip calls `__TAURI_INTERNALS__.invoke('fs_run_command',…)` with a harmless command that writes a marker file. No marker appears until consent. After Phase 1, no marker appears even after consent, because the iframe has no IPC.
- **Effort.** Stopgap S; full fix L.

**S2. `settings_save` replaces all settings and erases backend writes** *(medium, cheap; P6 + P7)*
- **Problem.** Disabled providers come back on and the speech program path is lost.
- **Fix.**
  - Rust: hold the lock across write and store, and emit `helios://settings` after backend-side writes.
  - Frontend: refresh from `api.settingsGet()` after `providerSetEnabled` and `speechLocate`.
  - Phase 1: a `settings_patch` merge model (§4D).
- **Verify.** Disable a provider, then zoom the timeline, then refresh providers: it stays disabled.
- **Effort.** S.

**S3. Child processes survive timeout, cancel and exit** *(medium; P5)*
- **Fix now.** `run_command` uses `kill_on_drop(true)` and, on timeout, `taskkill /T /F /PID` before returning "timed out and was stopped".
- **Phase 1.** A Job Object for tool children only (NOT the Helios process: the updater installer must be allowed to break away).
- **Effort.** S.

**S4. `web_scrape` panics on non-ASCII pages, and the invoke never settles, so the AI turn hangs** *(high; P5)*
- **Fix.** Use `capped()` in `extract_clean_text`; use `to_ascii_lowercase` in `extract_attribute`.
- **Verify.** Rust tests with an em dash at byte 4000, and `<img alt="İİİ" src="/görsel.jpg">`.
- **Effort.** XS.

**S5. Save/Save As moves files before validating** *(low, cheap; P6)*
- **Fix.** Run `sanitize` and `validate_shape` on a clone before any transfer.
- **Effort.** XS.

**S6. Asset protocol truncates paths at `#`** *(medium, cheap; P6)*
- **Problem.** `Ep #12.mp4` never previews, but exports.
- **Fix.** Delete the post-decode `?`/`#` truncation and fix the test.
- **Effort.** XS.

**S7. Autosave, library list and project open run on the UI thread** *(medium; P6)*
- **Fix.**
  - `library_list` becomes async, with the stat in `spawn_blocking` *outside* the library mutex.
  - `project_save` and `project_file_read`/`write` run async via `off_ui_thread`.
  - A save-generation guard stops an older snapshot being renamed over a newer one.
  - `autosave_backup` avoids the double clone.
- **Effort.** S–M.

### 2.3 Agent runtime

**A1. The Anthropic API fails on every tool turn** *(critical; P5)*
- **Problem.**
  - Budget thinking is always sent. It is rejected with a 400 on Opus 5/5.5, Sonnet 5, Fable 5/5.1 and Opus 4.7/4.8, so round 0 fails.
  - On 4.6 and Haiku 4.5, round 2 fails because thinking blocks, with their signatures, are never replayed.
- **Fix.**
  - Per-family thinking config in `effort.rs`, per the current API reference:
    - **Adaptive** `thinking:{type:"adaptive"}` plus `output_config:{effort}` for Fable 5/5.1, Opus 5/5.5, Opus 4.6/4.7/4.8, Sonnet 5 and Sonnet 4.6. Opus 5.5 and Fable accept omitting `thinking`; Opus 4.7/4.8 need adaptive set explicitly.
    - **Budget** only for Haiku 4.5 and older. Never send `output_config.effort` to Sonnet 4.5 or Haiku 4.5.
    - `xhigh` exists only on 4.7+. The 4.6 family supports `low/medium/high/max`.
  - Set `display:"summarized"` so the UI thinking stream is not empty. The default is `omitted` on the 4.7+/5 family.
  - Capture `thinking` and `redacted_thinking` blocks, including `signature_delta`, as a new `Delta::ThinkingBlock`. Store them on `Message.thinking_blocks` and replay them first, unchanged, in the assistant turn.
  - Never use forced `tool_choice` any/tool (Opus 5.5 and Fable 5.1 reject it).
- **Verify.** `request_body` unit tests per family: no `budget_tokens` for claude-opus-5; the replayed assistant turn starts with its thinking block. A live smoke test is a 3-tool turn on claude-opus-5 and on claude-haiku-4-5.
- **Effort.** M.

**A2. MCP/CLI turns are hard-killed at 20 minutes of wall clock** *(high; P5)*
- **Problem.** Confirmed in the user's `chat.json`: a turn was killed at 1210 s mid-polish, and the fault message was mislabelled "no output".
  - The bridge read timeout (950 s) is shorter than the tool timeouts (1800 s / 24 h).
  - Codex allows 120 s per tool; Gemini's default is about 10 min.
- **Fix.**
  - Add a `ToolActivity {in_flight, last_activity}` handle that `Counted::call` updates.
  - In `cli.rs`, when running MCP: no wall-clock cap (or several hours); tick every 5 s; count the CLI as idle only when nothing is in flight *and* both the last line and the last activity are older than the budget. Report the wall-clock case with its own message.
  - `BRIDGE_READ_TIMEOUT` becomes `None` or at least 1860 s.
  - Codex `tool_timeout_sec=1860`; Gemini `timeout:1_860_000`.
- **Verify.** Unit test of the idle decision function. Manual: an `ask_user` left pending for 25 minutes still completes.
- **Effort.** M.

**A3. Subagents always run the offline regex parser, `wait` returns "subagent finished", and Stop never reaches them** *(high; P6)*
- **Fix.**
  - `AppState.turns` stores a `TurnHandle{stop, row, model}`.
  - `chat_spawn_subagent` resolves the parent's provider and refuses if the parent turn is gone or the provider is Builtin.
  - One stop channel is shared by the subagent's turn loop and its executor.
  - `stop_children(parent)` is called from `chat_stop` and when the parent turn ends.
  - The reply and tool count are stored and returned by `wait`, `wait_all` and `status`.
  - Only unfinished entries count toward `MAX_SUBAGENTS`, and `cleanup()` runs on spawn.
- **Verify.** Rust unit tests on `Supervisor`: `stop_children` signals the right entries, and `wait` returns the stored reply.
- **Effort.** M.

**A4. The model never sees `run_frame_qa`'s contact frames** *(high; P4 + P5)*
- **Problem.** The frames are PNGs, and both `chat.rs:503` and `mcp.rs:120` forward only JPEG. Also, any run with issues asks for more than 4 images, is rejected, and returns a false "blank frames were not checked".
- **Fix.**
  - Accept png, jpeg and webp and pass the real mime type (P5).
  - `wanted.slice(0,4)` with issue frames first, and a separate try/catch with an honest note (P4).
- **Verify.** A Rust unit test in `chat.rs`/`mcp.rs` that a png data URL survives. A vitest of the `wanted` selection (13 still times plus 1 issue gives 4 or fewer paths).
- **Effort.** S.

**A5. 4096-token output cap and no `max_tokens` handling** *(high; P5)*
- **Problem.** `save_storyboard` for normal-length footage cannot fit.
- **Fix.**
  - For native tool turns, set `max_tokens` about 32k, clamped per model: 4.6+/5 up to 128k with streaming; Haiku 4.5 64k; legacy 3.x models 4096–8192. Raise the Anthropic HTTP timeout to match.
  - `message_delta` stores the stop reason; `message_stop` emits Usage and then `Done{reason}`.
  - On `MaxTokens`, calls whose args are not objects get an explicit "your output was cut off at the token limit" error, and are not run.
- **Verify.** Parser unit test (usage is emitted before Done). A `native()` unit test with a truncated tool call.
- **Effort.** S–M.

**A6. Full-mode guard refuses the documented motion-comp forms** *(medium; P4)*
- **Fix.**
  - Check `ALWAYS_TOOLS` before the compId check.
  - The scope covers every comp reachable through comp-source clips; comp ids are accepted as `clipId`.
  - Refusal messages name the working form.
- **Verify.** Add the audit's reproduction to `tests/editWorkflowPhases.test.ts`: all 6 refused calls now pass.
- **Effort.** S.

**A7. `verify_edit_workflow` passes after a QA run that reported issues** *(medium; P4)*
- **Fix.**
  - `record()` stores the issue list.
  - `verify` fails when unwaived issues remain.
  - Waivers `acceptedQaIssues:[{kind,a,reason}]` are read in `before()`; `blank-frame` can never be waived.
- **Effort.** S.

**A8. Tool results are unbounded** *(medium; P4 + P5)*
- **Fix.**
  - `run_command` keeps only the tail, about 12 KB per stream (P4).
  - `read_file` with no range stops at 400 lines or 64 KB and returns `truncated` (P5).
  - A backstop in `chat.rs` shortens long string fields when a result exceeds 48 KB (P5).
- **Effort.** S.

### 2.4 Layered motion comps (P2)

**M1. A nested precomp falls back to its stale explode-time scene when any inner clip cannot be fused** *(high)*
- **Problem.** A crop, effect, transition or dropped image in "Shot as card" silently discards every nested edit, in both preview and export.
- **Fix.** Build the inner scene from the live comp:
  - each cached group becomes a sub-precomp;
  - each enabled layer clip that is not in a group becomes a precomp of `standaloneScene()` with its clip timing;
  - report the dropped NLE-only attributes (`lossy`) through `get_motion_scene`.
  - Never fall back to `layer.scene` while the comp exists. Do not use `logicalScene()` for this.
- **Verify.** The audit's `precomp.test.ts`, moved to `tests/motionStack.test.ts`: after `cropLeft:10` the inner title keeps `in=1`.
- **Effort.** M.

**M2. `update_motion_scene` in/out patches are ignored, and `in > out` deletes the layer clip and its track** *(medium)*
- **Fix.**
  - `validateScene` rejects `out<=in` and `in>=duration`.
  - `restack(…, before?)` retimes clips whose logical in/out changed, even under `'keep'`.
  - Explode never silently drops a layer that already has clips.
- **Effort.** S–M.

**M3. Expression `inPoint`/`outPoint` are in a different clock from `time`** *(low, cheap)*
- **Fix.** Pass them on the layer clock (`layerTime`). Standalone scenes keep the logical window.
- **Effort.** XS.

**M4. 9:16 margin mismatch** *(medium)*
- **Problem.** The fitter uses 5%/6% while QA uses social-safe margins (12% top, 18% bottom, 6% sides), so rebuilt scenes fail QA forever.
- **Fix.**
  - `SafeOptions.margin` accepts per-side values and defaults by orientation.
  - `safeMargin()` in `motionTools` returns `undefined` unless `safeMargin` was passed.
  - Add 1080×1920 test cases.
- **Effort.** S.

### 2.5 Visual QA and templates (P3)

**V1. Crimson info templates collapse into the top ~30% of 9:16 frames and the top 56% of 1:1** *(high)*
- **Problem.** QA judges the landscape box, and the connected-map connectors miss their cards.
- **Fix.**
  - Wrap the non-plate content of the 7 affected templates in a centred 16:9 design band: `top:calc(50% - 540px*var(--u)); height:calc(1080px*var(--u))`.
  - Remap `box` into the band.
  - Real portrait layouts follow in Phase 2.
- **Verify.** New vitest: every `CRIMSON_TEMPLATES` id at 1080×1920 and 1920×1920 returns a box inside the safe area, and every `top:` value parses inside it.
- **Effort.** S–M.

**V2. Full-frame HTML graphics make QA impossible to clear** *(medium)*
- **Fix.** Skip boxes that are missing or cover at least 90% of the frame, after the holder transform, for direct and nested HTML. This mirrors `restingLayerBoxes`.
- **Effort.** XS.

**V3. QA ignores clip transforms and caption style position** *(medium)*
- **Fix.**
  - Map HTML boxes through `holderMap(clip,t)`, sampled per QA time.
  - Nested MOGRT comps compose the holder with the inner clip and include every HTML clip, not just the first.
  - `textBox` uses `findStyle(style).posY` for styled captions.
- **Effort.** S.

**V4. Legacy MOGRT templates render placeholder copy and an invented "+340%"** *(medium)*
- **Fix.**
  - Empty defaults with conditional elements; never a default metric.
  - The accent comes from the brand or Crimson tokens.
  - Drop `backdrop-filter`, which does not survive export.
  - The default template becomes `crimson-lower-third`.
  - The `aiTools` side is in P4.
- **Effort.** S.

### 2.6 AI tools and craft (P4)

**C1. `snap_cuts_to_beats` opens 1–4-frame black gaps at every snapped butt cut** *(high)*
- **Fix.**
  - Treat butt cuts as rolling edits: `trimEdge(next, clipId, 'out', T, 'rolling', limit, {alone:true, minDuration:0.2})`.
  - Read neighbours from the live `next`, not the stale snapshot.
  - Linked audio stays put, so the cut becomes a short J/L split rather than a hole.
  - Fix the tool text.
- **Verify.** New `tests/snapCuts.test.ts`: beats at cut ±0.1 leave no V1 gap, and linked audio is unchanged.
- **Effort.** S.

**C2. `podcast_cut` punch-ins show black bands and crop heads** *(high)*
- **Problem.** `fitWindow` treats the source as square.
- **Fix.**
  - Pass `sourceAspect`.
  - Use `r=aspect/sourceAspect`; the cover window is `wMax=min(1,r)`, `hMax=min(1,1/r)`.
  - `y=(0.5-cy)/h` with the true h.
  - When the subject cannot be covered within `maxZoom`, return null and stay wide.
  - Set `transform.fit='fit'`.
  - Apply the plan to the *live* comp, re-read after the awaits; refuse if the clip changed.
- **Verify.** `tests/reframe.test.ts` projects results through `placement()` for 16:9→16:9 (including a face at y 0.05), 9:16→9:16 and 16:9→9:16. The window must stay inside [0,1]² and contain the subject box.
- **Effort.** S–M.

**C3. `level_audio` overwrites user edits made during its awaits** *(medium)*
- **Fix.** Use per-clip patch updaters.
- **Effort.** XS.

**C4. `typed_decision` presents word-overlap arithmetic as a calibrated judge** *(medium)*
- **Fix.** Remove the tool: the catalogue entry, the handler and the tool tests. Keep the helpers or delete them.
- **Effort.** XS.

**C5. `scrape_web_page` image URLs are stripped** *(medium)*
- **Fix.** Rename the result key `images` → `imageUrls`.
- **Effort.** XS.

**C6. `pro-chunk-edit` claims work it does not do and satisfies both verify receipts** *(medium)*
- **Fix.**
  - Make the description honest.
  - Remove the unused param and the video-kind transition.
  - Take it out of the `proVisual`/`soundPass` receipts.
  - Previews earn no receipts.
- **Effort.** XS.

**C7. Contradictory instructions** *(medium)*
- **Fix.**
  - Phase-aware `workflowInstruction` and `retryNote`.
  - `parseBeat` accepts engine and brand template ids.
  - Label the `copilot.md` verb map as `create_motion_graphic` ids, with the engine equivalents.
  - The Start-editing kickoff text lives in App.tsx (P7).
- **Effort.** S.

**C8. `layout_clip` portrait slots violate the safe area and report the wrong free side** *(medium)*
- **Fix.** Compute the slots from `placement()` and the asset aspect so they land inside the social safe area. In portrait, `free` is top or bottom.
- **Effort.** S.

**C9. `set_keyframes` silently erases animation on unparseable entries** *(low, cheap)*
- **Fix.** Validate per index, accept numeric strings, and clear only on an explicit `[]`.
- **Effort.** XS.

### 2.7 Timeline and editor UX (P7)

**T1. Pasting into a different comp puts every clip on A1** *(high)*
- **Problem.** Picture clips land on an audio track, which fails `validate_shape`, so **every autosave, Ctrl+S and export fails**. Nest cycles are possible, and `groupId`s are kept.
- **Fix.**
  - The clipboard stores `{clip, kind, index}` taken from the source comp.
  - Remap `groupId`.
  - Skip cycle-forming comp clips with a toast.
  - Backstop: `healComp` moves wrong-kind clips to the correct kind at the same index.
- **Verify.** New `tests/timelinePaste.test.ts` using a pure `pasteClips()` extracted into `timeline.ts`.
- **Effort.** S.

**T2. `removeRange` on chosen tracks slides sync-locked tracks onto clips and heal deletes them** *(medium, cheap)*
- **Fix.** `rippleTracks` on tracks not occupied by the range.
- **Effort.** XS.

**T3. Ctrl+click on a clip body adds an opacity/volume key, and gain edits then stop working** *(medium, one line)*
- **Fix.** Delete `Timeline.tsx:434`.
- **Effort.** XS.

**T4. Shortcut dispatch** *(medium, cheap)*
- **Problem.** Ctrl+Shift+X cuts clips, and 9 chords can never fire.
- **Fix.** Exact modifier sets, plus `event.code` for Slash and Digit keys.
- **Effort.** XS.

**T5. Q/W swapped** *(medium, cheap)*
- **Fix.** Trim the edge by whether the playhead is inside a clip.
- **Effort.** XS.

**T6. Nesting a non-contiguous selection deletes the unselected clips in between** *(medium, cheap)*
- **Fix.** Use `freeTrack`.
- **Effort.** XS.

**T7. Transitions cannot be deleted, and Ripple Delete on a gap does nothing** *(medium, cheap)*
- **Fix.** Handle transition deletion before the empty-selection guard, and wire `closeGap`/`gapAt`.
- **Effort.** XS.

**T8. Properties Start/Source In bypass placement rules** *(medium)*
- **Fix.** Route through `moveClips`/`slipClip`, starting from the gesture base.
- **Effort.** S.

**T9. AI edits made during a drag are undone by snapshot previews** *(medium)*
- **Fix.**
  - `history.commit` during a gesture rebases: it updates `pending` and `present`, and the gesture stays open.
  - `preview(fn(present, start))`.
  - Timeline previews rebuild from `start`.
- **Effort.** S–M.

**T10. Dragging audio slightly into the video rows spawns new tracks; mismatched linked pairs lose the move** *(low, cheap)*
- **Fix.** Clamp the shift in the UI.
- **Effort.** XS.

**T11. The unsupported-effect check runs after minutes of pre-render** *(low, cheap)*
- **Fix.** Call `prepareEffectExport` first in `startExport`.
- **Effort.** XS.

---

## 3. Phased roadmap

### Phase 1: this week. Stability, export correctness, data integrity

| Item | Mechanism | Files | Acceptance | Effort | Deps |
|---|---|---|---|---|---|
| 1.1 Land the seven fix-now packages | See §9 | disjoint sets | `npx tsc -b --pretty false` clean; every package's tests green; parity harness export of the user's 15-target project completes | — | — |
| 1.2 Loopback frame sink (step 1 of §4A) | `mogrt_frames_begin` starts a tokio `TcpListener` on 127.0.0.1:0 with a per-export token and returns `{url, token}`. `openFrameWriter` PUTs `${url}/${index}` with `AbortSignal.timeout(30000)`. Keep `mogrt_frame_write` as a fallback for one release. | lib.rs, pngEncoder.ts, ipc.ts, parity.tsx | 3 consecutive exports of the 15-target project with no stall; harness and app use the same path | M | P1, P6 |
| 1.3 `export_log` command and export telemetry | Async `export_log(level,msg,data)` writes to helios.log through tracing. The export start/item/stall table is logged. | lib.rs, pngEncoder.ts, App.tsx | a forced stall writes a stage table to helios.log | S | P1 |
| 1.4 Graphics sandbox and capability tokens (§4B) | iframe `sandbox="allow-scripts"` srcdoc with a gsap bootstrap; postMessage seek/snapshot; part bounding boxes for picking; a per-turn token checked in `fs_run_command`, `fs_write_file`, `fs_edit_file` and `open_path`; asset allow-list (library paths, storage root, app data, project folder); remove `'unsafe-eval'` | HtmlMotionLayer.tsx, htmlFrames.ts, lib.rs, safe_asset.rs, system_tools.rs, tauri.conf.json | the malicious-project test writes no marker even after consent; the HTML parity harness is unchanged (SSIM ≥ 0.99) | L | S1 stopgap |
| 1.5 `export_check` preflight | Rust `plan()` runs with placeholder `HtmlFrames`, plus output folder and extension checks, before `renderProgress.start` | lib.rs, render.rs, App.tsx | a bad effect or missing media is reported in under 1 s | S | — |
| 1.6 Frame-folder cleanup | Remove the `HtmlFrames.dir` folders after the job ends (done, error or cancel), and the `-still` dirs after `export_frame` | lib.rs, aiTools.ts | `work/mogrt` is empty after an export | S | E2 |
| 1.7 Durable JSON | `write_json`: write, `sync_all`, rename, keep `.bak`. `read_json` falls back to `.bak` and emits a warning. Apply to roto.json, ref.json and `project_doc_write`. | store.rs, refs.rs, bundle.rs | kill -9 during a write leaves a valid file | S | — |
| 1.8 Settings patch model (§4D) | `settings_patch(patch)` merges under the lock and emits `helios://settings`; App listens | lib.rs, settings.rs, App.tsx, ipc.ts, settings panels | the S2 scenarios pass without refresh hacks | M | S2 |
| 1.9 Job Object supervisor | A kill-on-close job for tool children (ffmpeg, python, yt-dlp, whisper, MCP). The updater installer is spawned outside it (`CREATE_BREAKAWAY_FROM_JOB`). | tools.rs, local_media.rs, mcp_client.rs, updater.rs, Cargo.toml (windows-sys JobObjects) | closing Helios mid-export leaves no ffmpeg.exe; in-app update still installs | M | S3 |
| 1.10 Project format contract | `#[serde(flatten)] extra` on Project, Comp, Clip and Track. A TS fixture writer plus a Rust round-trip test. Resolve `scene3d` (add the variant or delete it). | project.rs, types.ts, tests | the fixture round-trips byte-equal as a `Value` | S | — |
| 1.11 `validateProject` in the frontend | Port `validate_comp` and the `nests()` checks. `healComp` repairs what can be repaired; autosave errors show a persistent banner, not a single toast. | timeline.ts, history.ts, App.tsx | a random-op fuzz never yields a project that `project_save` rejects | M | T1 |
| 1.12 Matte razor pieces | `LayerCommon.pieceOf`, set in `fuse`; the renderer, safeArea, polish and MotionLayer resolve the active piece | types.ts (motion), motionStack.ts, renderer.ts, safeArea.ts, polish.ts, MotionLayer.tsx | a razor on the matte clip keeps the title matted after the cut | M | P1, P2, P3 merged |

### Phase 2: next 2–4 weeks. Quality

**2.1 Director's-eye QA loop.** Mechanisms:
- **(a) Measure what was drawn.** `renderHtmlStill` and `renderMotionStill` return per-clip PNG paths. `polish.ts` computes the alpha bbox and coverage mask (alpha > 0.1 on a 192×108 downsample) and maps them through a shared `clipFrameMap` (placement plus the holder chain). Those boxes replace `source.box`, `textBox` and `spec.box` in `frameQa`. The geometric path is a fallback only.
- **(b) Contrast.** Render the frame without the graphic, take the glyph mask from its alpha, compute the WCAG ratio against the 90th-percentile worst surround, and raise `low-contrast` below 4.5 (or below 3 for large text). Auto-fixes: a scrim, shadow or boxed caption.
- **(c) Readability and pacing** (pure `production.ts` functions): words/s > 3.2, cap height < 2.2% (< 4% in 9:16), static holds > 6 s, strobe cuts < 0.4 s.
- **(d) Convergence.** Issue fingerprints kept in `production.qa.history`. Each run reports new, persisted and fixed issues. After 2 rounds a persisted issue escalates to the user. `run_frame_qa {fix:true}` runs deterministic fixers (refit, transform-fit, `fillBackground`, caption lane moves).
- **(e) One JPEG contact sheet** with timecodes burned in and QA boxes drawn, sent as a single image.
- **(f) Loudness and colour.** Audio-only mix loudness (integrated LUFS, true peak) and ΔE2000 jumps between adjacent shots.

Files: polish.ts, production.ts, new visualMetrics.ts, htmlFrames.ts, exportFrames.ts, aiTools.ts, editWorkflow.ts, render/audio.rs.

Acceptance:
- On the golden set, the QA false-positive rate is 0 on known-good fixtures.
- Recall is ≥ 90% on seeded defects (planted overlaps, low contrast, blank frames, black edges).
- The median polish pass converges in 3 or fewer runs.

Effort: L. Depends on Phase 1.

**2.2 Craft and prompt upgrades.**
- **`craftRules.ts`** as the single source of truth for SFX offsets and levels, caption limits per aspect, hook windows, holds and music-bed dB. Generate the `{{RULES}}` sections of `copilot.md` from it. Tool defaults and the eval scorer import it.
- **Phase-scoped prompt sections and a phase-scoped tool list.** ai-tools.json gains a `phase` tag. `build_request` filters to the current phase and always keeps the read tools.
- **Prompt caching** for the Anthropic API. The render order is tools → system → messages. Put `cache_control` on the last tool and on a frozen system block. Move `{{CONTEXT}}` into the first user message, or into a mid-conversation system message on models that support it. Use compact JSON. Verify with `cache_read_input_tokens > 0` from round 2 on.
- **Retry on transient 429/529/5xx/network errors** inside the turn (4 attempts, backoff, `retry-after`) when nothing has streamed yet.
- **A lenient id resolver** (`resolveClipRef`/`resolveCompRef` with a candidate list) and numeric/boolean string coercion.
- **Rust-side JSON-schema validation** of tool args in `run_call`, plus a vitest that fails on schema properties the handler never reads.
- **Speech-aware tools:** condensed transcript lines with pause markers; `find_speech_trims` (silences, fillers including Hindi, retakes via n-gram similarity); a `tighten-speech` recipe; a `splitEdit` op; `add_captions {fromTranscript, platform}`.
- **Playbooks** (`get_playbook`), generated from the eval golden projects.
- **Stable-prefix discipline and the `num_ctx` estimate for Ollama.**

Acceptance: tokens per round on the Anthropic path down ≥ 60%; zero "cut off" faults on a 10-minute storyboard; eval score up.

Effort: L.

**2.3 Eval harness** (`tests/eval/`, `scripts/eval-score.ts`).
- About 8 golden projects: a vertical talking head with retakes, a YouTube explainer, a two-person podcast, product-from-URL, a branded demo, a music montage, and a Hindi/Hinglish talking head.
- Checked-in transcripts, beats and roto fixtures.
- Replay mode (recorded tool traces through `runTool` with a FakeHost) runs in CI. A live nightly runs against the Claude CLI and the Anthropic API.
- The scorer measures: hook metrics, dead-air ratio, cuts inside words (must be 0), empty V gaps (must be 0), caption CPS and cue length, graphic coverage per point, SFX density and level, LUFS/TP from ffmpeg ebur128, brand compliance, blank frames, preview/export SSIM, and an LLM-judge rubric over JPEG sheets.
- Results go to `eval/scores.tsv` per commit, with CI thresholds.

Acceptance: every §2 bug that has a behavioural symptom has a golden check that would have caught it.

Effort: L.

**2.4 Playback performance.**
- A memoised `<TimelineClip>` and a gesture store for the move ghost.
- `useSyncExternalStore` selectors for history.
- ProgramMonitor splits structure from per-frame work: React re-renders only when the active clip set changes, and a single rAF loop pushes transforms and opacity, `MotionLayer.draw`, the HTML seek and roto.
- Autosave serialisation moves to a Worker and is skipped while playing.
- The resource monitor moves to in-process `sysinfo` plus NVML (no PowerShell).
- Proxy policy: build a proxy when width > 1920, bitrate > 25 Mbps, or GOP > 2 s; add an audio-only `.m4a` for MediaVoice.
- **mediaManager.ts** with leases, a per-URL multi-instance pool, a global decoder budget and `retain()`. This replaces the MediaBank sharing and background-decode fixes.
- Scrub responsiveness: show cached stills while dragging and settle 150 ms after release.

Acceptance: a 4-layer 1080p comp with 2 motion scenes plays with < 2% dropped frames on the reference machine; drag latency < 16 ms with 300 caption clips; the playhead cadence is a steady 30 Hz.

Effort: L.

**2.5 Remaining medium bugs** (§6 checklist): undo scoping, reversed/held layer keyframes, a HTML `clip.in` length field, the black-edge check for opaque motion stages, a keymap table.

### Phase 3: inventions that make Helios #1

These were chosen from the study and merged with the subsystem proposals. Each item gives the mechanism, files, acceptance criteria, effort and dependencies.

1. **Export Certificate**
   - Pitch: every export proves it matches the preview frame for frame.
   - Mechanism:
     - After `render.rs` finishes, decode K frames: qaTimes, every clip boundary, and the midpoint of each stack group.
     - Render the same times through the preview compositor. Move `parity.tsx` into a hidden in-app route, or capture it with `CapturePreview`.
     - Compute SSIM per 32 px tile, map failing tiles to the clips under them, and bisect by disabling suspects on the prepared copy.
     - Tool: `verify_export`. The export dialog shows a green or red badge.
   - Files: parity.tsx, render/e2e.rs, render.rs, exportFrames.ts, htmlFrames.ts, motionStack.ts, previewCache.ts, polish.ts.
   - Acceptance: tile SSIM ≥ 0.98 on the golden set; seeded divergences (the six from §1) are each localised to the right clip.
   - Effort: M. Depends on Phase 1 parity fixes and 1.2.
2. **Word Anchors and transcript editing**
   - `Clip.anchor` and `Layer.anchor` = `{assetId, wordIndex, edge, offset}`.
   - editProgram ops: `cut_words`, `remove_fillers`, `remove_pauses`, `remove_retakes`.
   - A resolver re-times anchored clips and word cascades in the same commit.
   - An editable TranscriptPanel (strike and restore).
   - Files: transcribe.rs, transcriptText.ts, editProgram.ts, timeline.ts, motion/text.ts, subtitlesEngine.ts, TranscriptPanel.tsx.
   - Acceptance: deleting a sentence leaves 0 cuts inside words, every anchored caption and title follows its word, and undo is a single step.
   - Effort: L. Depends on 2.2 speech tools.
3. **Point & Say**
   - An object-ID pass in `MotionRenderer` writes layer index and clip hash to RGBA8.
   - DOM clips contribute their `placement` boxes.
   - Overlay strokes become structured chat context: an arrow becomes x/y keyframes, a circle picks a target, a rectangle is a keep-out region.
   - Files: renderer.ts, evaluate.ts, Overlay.tsx, ProgramMonitor.tsx, sketch.ts, chat.
   - Acceptance: a click resolves the correct layer in a 3-deep nested stack in ≥ 99% of test clicks; an arrow produces a path within 2% of the drawn one.
   - Effort: M.
4. **Negative-space layout solver** (also absorbs `layout.ts` Occupancy and the Phase-2 safe-area single source)
   - An occupancy grid from roto mattes (32×18), face tracks, caption/text boxes and the safe area.
   - Choose a slot with a hysteresis cost and emit eased keyframes.
   - Runs at create time and on `covers-subject`/`caption-collision` issues.
   - Files: polish.ts, production.ts, safeArea.ts, coverage.ts, personTracks.ts, roto.ts, anim.ts, motionTools.ts, layout.ts.
   - Acceptance: 0 covers-subject or caption-collision issues on the golden set with no model intervention.
   - Effort: L. Depends on 2.1a.
5. **Motion critic**
   - Built on `evaluateMeasured` at 60 Hz. Checks velocity discontinuities, entrance clutter, hold before exit, reading rate and text contrast, and compares against the brand motion tokens.
   - Output: new QaIssue kinds with suggested fixes.
   - Files: measure.ts, evaluate.ts, polish.ts, production.ts, brandKit.
   - Acceptance: critic scores correlate (Spearman ≥ 0.6) with designer rankings on 40 graphics.
   - Effort: M.
6. **Signal expressions**
   - `beat()`, `beatPhase()`, `audio.rms/band`, `word.*`, `speaker.box`, `subject.box`.
   - Signals are baked into `scene.signals` as Float32/base64, so export stays deterministic.
   - Files: expr.ts, evaluate.ts, types.ts, validate.ts, beats.ts, peaks.ts, audioEnvelope.ts, personTracks.ts.
   - Acceptance: preview and export produce identical frames (certificate pass); a karaoke highlight lands within 1 frame of word onset.
   - Effort: M.
7. **Linked multi-aspect masters**
   - A derived comp `{masterId, aspect, overrides}`.
   - `derive()` reframes footage with the corrected `frameFor`, re-lays out graphics with the solver, and reflows captions.
   - User patches are re-applied after each re-derivation.
   - Files: reframe.ts, personTracks.ts, safeArea.ts, motionStack.ts, layout.ts, history.ts, types.ts.
   - Acceptance: editing the 16:9 master updates 9:16 and 1:1 with QA clear, and manual per-format tweaks survive.
   - Effort: L. Depends on 3.4.
8. **Edit Multiverse**
   - `fork_variants` builds N comp copies. Scoped subagents (after A3) run with a comp-scope guard in ToolExecutor.
   - Output: a 5 s contact reel grid, then promote one, or batch-export all.
   - Files: subagent.rs, ai_tools.rs, editProgram.ts, history.ts, aiTools.ts, exportFrames.ts.
   - Acceptance: 3 variants built in parallel with no cross-comp writes; each is independently undoable.
   - Effort: M. Depends on A3.
9. **Taste memory**
   - Tag AI commits. Detect undo within 30 s, parameter corrections within 10 minutes, and deletions.
   - Keep per-tool median priors, add a "your preferences" prompt block and default arguments, and make them editable in the Learning workspace.
   - Files: history.ts, actionLogger.ts, ideagraph.ts, learning.ts, LearningWorkspace.tsx, aiTools.ts.
   - Acceptance: after 5 simulated sessions of the same correction, the agent's defaults match the correction.
   - Effort: M.
10. **Table stakes, delivered as Helios-grade features**
    - **Neural speech enhancement:** a DeepFilterNet or Resemble-Enhance worker in the Python job harness, exposed as a rendered effect.
    - **Semantic media search:** a local CLIP/SigLIP frame-embedding index, a transcript index and an audio-tag index, with a `search_media` tool.
    - **Reflowing localization:** translate captions and text layers, dub via speech.rs, time-fit with Word Anchors, and re-typeset with the solver. Indian languages first.
    - **Real stabiliser and colour match:** ffmpeg vidstab two-pass plus a Lab histogram match, added to RENDERED_EFFECTS.
    - Effort: L each.

Honourable mentions for Phase 3b: the idle polish daemon (S; a quick win once 2.1 lands), continuity guard for jump cuts (M), Edit DNA style distance (L), retention forecast (L), recipe by demonstration (L), motion cloning by analysis-by-synthesis (XL).

---

## 4. Architecture changes worth making

**A. Export frame transport: streaming instead of PNG-per-IPC**
- Today: readPixels → worker PNG encode (about 50 ms per 1080p frame) → raw-body Tauri invoke → one file per frame.
- Migration:
  1. A loopback HTTP sink with per-request timeouts (Phase 1.2).
  2. The sink becomes a pipe: `mogrt_frames_begin` spawns `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r fps -i pipe:0 -c:v ffv1 -pix_fmt bgra target.mkv`, and JS POSTs the RGBA straight from `pixels()`. `video.rs html_frames` reads `-ss first/fps -i target.mkv`.
  3. Static-span dedup: `staticSpans(scene,t0,t1)` in evaluate.ts from keyframe, expression and footage analysis. Skip identical frames; the concat demuxer handles the runs. The user's avatar clip: frames 100–362 were byte-identical.
  4. Render only what is shown: in/out windows via the compClocks walk, skip hidden or fully occluded targets, and render the bbox region only with an x/y offset in `RenderedFrames`.
- Each step is gated by the Export Certificate on the golden set.

**B. A trust boundary for untrusted content**
- A sandboxed graphics runtime: an opaque-origin iframe driven by a postMessage protocol that carries `{elapsed, progress, duration, u}` and returns snapshots and part boxes.
- A capability-gated privileged IPC: a per-turn token minted after `allowTool` and stored in `AppState.turns`.
- An asset-protocol allow-list.
- A build.rs AppManifest command list.
- The CSP without `unsafe-eval`.

**C. One GPU timeline renderer for preview, export and QA** (the long-term fix for parity)
1. `demux.worker.ts` (mp4box.js) and `decoderPool.ts` (WebCodecs, prefer-hardware, frame-accurate seek, LRU budget).
2. Grow `renderer.ts` into a TimelineRenderer that lowers a comp at time t into layers, using the `motionStack` idea: media clips become VideoFrame footage layers, transforms become matrices, CSS filters become shader effects, masks use `rasterMasks`, transitions are two-input passes, roto goes through `uMatte`.
3. Run it in a render worker via `transferControlToOffscreen`.
4. Export uses the same renderer and a VideoEncoder (or the pipe from A); Rust only muxes and mixes audio.
5. An AudioWorklet mixer with an AudioContext master clock.
- Keep the DOM compositor as a fallback. Migrate comp by comp behind a flag, and flip the default only when the certificate is green on the whole golden set.

**D. Settings and persistence**
- Patch-and-event settings.
- Durable writes with fsync and `.bak`.
- Compact `current.json`.
- Saves run in the background with a generation guard.
- `prepare_media` merges fields rather than overwriting the asset.

**E. Process supervision**
- One Job Object for tool children.
- `run_cancellable(program, args, cancel, idle)` for yt-dlp, whisper, piper and run_command.
- An idle timeout on every streaming download.
- Signed updates (Ed25519 over `version|sha256|size`) and pinned model hashes.

**F. Agent loop**
- A stable cacheable prefix.
- Phase-scoped tools.
- Thinking-block persistence.
- Transient retry.
- Result caps and old-round summarisation.
- One shared project-mutation mutex across executors.
- Subagents get their own turn ids.

---

## 5. Metrics and the quality bar, release over release

| Area | Metric | Bar for "world's best" |
|---|---|---|
| Export trust | Certificate pass rate on the golden set; tile SSIM | 100% pass, SSIM ≥ 0.98 |
| Export reliability | Silent stalls (watchdog count) per 100 exports; source-file incidents | 0 and 0 |
| Export speed | Pre-render seconds per output second (15-target project) | ≥ 3× faster than today after §4A steps 2–4 |
| Stability | crash.log entries per session; hang.log entries; autosave failures | < 0.05 / 0 / 0 |
| Agent reliability | Golden-set task completion (AgenticVBench-style rubric); turns killed by timeout; guard refusals per turn; retries recovered | ≥ 70% completion; 0 kills; < 1 refusal per turn |
| Agent cost | Input tokens per round; cache hit ratio; rounds per production | −60% tokens; cache reads ≥ 70% |
| Craft | Cuts inside words; V gaps; caption CPS ≤ 17; hook visual by 1.5 s; LUFS −14±1, TP ≤ −1 dBTP; brand compliance | 0 / 0 / 100% / 100% / 100% / 100% |
| QA quality | False positives on known-good fixtures; recall on seeded defects; median polish rounds to clear | 0 / ≥ 90% / ≤ 3 |
| Judge | LLM rubric (hook, pacing, legibility, hierarchy, on-brand) 1–5 | ≥ 4.2 average, never regressing > 0.2 |
| Playback | Dropped frames (1080p, 4 layers + 2 motion); playhead cadence; drag latency; scrub settle | < 2%; steady 30 Hz; < 16 ms; < 150 ms |
| Security | Malicious-project test; privileged IPC reachable from graphic JS | pass; none |

All of these live in `eval/scores.tsv` per commit. CI fails on a regression beyond the thresholds. The release notes quote the deltas.

---

## 6. Medium and low confirmed bugs (checklist)

Included in the fix-now packages:
- [ ] Export Frame drops motion/HTML (P7)
- [ ] Motion clip geometry parity (P1)
- [ ] Stale text textures (P1)
- [ ] MediaBank lookahead and frame-time mismatch (P1)
- [ ] Motion footage decoding after its scene leaves or after Stop (P1)
- [ ] 30 Hz playhead gate jitter; use a tolerance, never `carry -= UI_STEP` (P1)
- [ ] Downscaled-preview remount on play/pause (P1)
- [ ] Roto corrections per-pixel loop over all frames (P1)
- [ ] WebGL context release and recovery (P1)
- [ ] update_motion_scene in/out ignored or deleting (P2)
- [ ] Expression inPoint/outPoint clock (P2)
- [ ] 9:16 fitter margins (P2)
- [ ] Full-frame HTML QA (P3)
- [ ] QA ignores transforms and caption posY (P3)
- [ ] Legacy MOGRT placeholder copy (P3 + P4)
- [ ] Black-edge check treats opaque motion stages as transparent (P3, low)
- [ ] Guard refuses motion-comp forms (P4)
- [ ] verify ignores QA issues (P4)
- [ ] level_audio stale snapshot (P4)
- [ ] typed_decision (P4)
- [ ] scrape image URLs (P4)
- [ ] pro-chunk-edit receipts (P4)
- [ ] Contradictory instructions (P4 + P7)
- [ ] layout_clip portrait slots (P4)
- [ ] set_keyframes silent clear (P4)
- [ ] Unbounded tool results (P4 + P5)
- [ ] Child processes on timeout (P5)
- [ ] settings_save overwrite (P6 + P7)
- [ ] `#` in asset paths (P6)
- [ ] Save As moves before validating (P6)
- [ ] Sync commands on the UI thread (P6)
- [ ] removeRange sync-lock collisions (P7)
- [ ] Ctrl+click keyframes (P7)
- [ ] Shortcut chords (P7)
- [ ] Q/W swap (P7)
- [ ] nestClips deletion (P7)
- [ ] Transition delete and gap ripple (P7)
- [ ] Properties Start field (P7)
- [ ] AI edits lost during a drag (P7)
- [ ] Audio drag into video rows (P7)
- [ ] Late effect check (P7)

Deferred to Phase 1/2 (not in the packages):
- [ ] Matte razor/duplicate pieces (`pieceOf`) (Phase 1.12)
- [ ] Motion keyframes on reversed or held layer clips: add `frame.local` plus `frameAt` (Phase 2)
- [ ] HTML layer clips ignore `clip.in` after a razor: add a `length` field on the html source (Phase 2, low)
- [ ] `undo` tool acts on the global stack and never reports labels: add `amend()`/`top()` in history, fold helper commits, stop at user steps (Phase 2)
- [ ] `roto_matte_frame` JSON array on the UI thread: move to a raw body (Phase 2)
- [ ] Unbounded parse caches, per-call global allocations and prototype names in expr.ts (Phase 2)
- [ ] Preview cache described as "RAM" is actually GPU-backed: size it from VRAM (Phase 2)

---

## 7. Risks, and what NOT to do

**Environment rules**
- **Never `cargo fmt` this repo.** Never start or stop the desktop app, or build into `src-tauri/target/release`, from agents. Use a scratch `CARGO_TARGET_DIR` for test builds.

**Agent runtime**
- **Do not send `budget_tokens`** to any 4.6+ or 5-family model.
- Do not send `output_config.effort` to Sonnet 4.5 or Haiku 4.5.
- Do not use forced `tool_choice` any/tool on Opus 5.5 or Fable 5.1.
- Replay thinking blocks unchanged and append-only. Never edit earlier turns, because preserved thinking rejects edited history for new accounts.

**Processes**
- **Do not put the Helios process itself in a kill-on-close Job Object.** It kills the update installer 600 ms after launch. Put tool children in the job and give the installer breakaway.

**QA and workflow**
- **Do not make verify demand zero QA issues without waivers.** The geometric QA flags intended designs, such as behind-subject titles and the cube reveal. `blank-frame` stays unwaivable.
- **Do not fall back to `logicalScene()`** in `compScene` (it drops timeline moves). Do not demote precomps to plain comp clips (it loses the card's 3D, mask and shadow).
- **Do not queue AI commits during a user gesture.** The AI then reads stale state. Rebase instead.

**Playback**
- **Do not use `carry -= UI_STEP`** in the playhead gate while `elapsed = carry` (it double-counts wall time). Use a 4 ms tolerance.
- **Do not key MediaBank elements by layer id** (it doubles decoding in the common in-sync case). Pool by distinct time.

**Timeline**
- **Do not change `moveClips`' null-on-impossible contract.** The AI tools and tests rely on it. Clamp in the UI.

**Tools and templates**
- **Do not "fix" typed_decision with a softer description.** Remove it. Re-add it only if a real model backs it.
- **Do not rewrite all Crimson templates** before the band fix ships. Portrait-native layouts are Phase 2, and must be validated by the new geometry tests.

**Big refactors**
- **Do not big-bang the WebCodecs/GPU timeline migration.** Put it behind a flag, migrate per comp, and let the certificate decide.
- **Do not run the graphics sandbox without a picking plan.** `data-hl` parts leave the parent DOM, so part boxes must come over postMessage.
- **Do not skip the loopback transport step** because timeouts "fixed" the hang. Timeouts only name the stall; the transport removes the suspect.

**Parallel work**
- Two packages that need the same file must merge, never race. The §9 file sets are disjoint on purpose; soft dependencies are listed per package.

**Scope creep**
- Phase 3 inventions depend on Phase 1 parity plus the Phase 2 QA and eval work. Starting them early builds on an unmeasured base.

## 8. Refuted claims (do not chase)

- The HTML graphics stage stalls when the window is minimised (rAF keeps running; "Run in background" only collapses the in-app dialog).
- HTML rendered at 30 fps juddering versus the preview (the preview is not per-display-frame either).
- A second stack in one comp from paste (the starting state is unreachable).
- The media decoder is retained without bound (the owners are singletons, nothing grows without bound).
- A stalled model download never cancels (reqwest 0.12 keepalive detects the dead connection).
- The blank-frame check ignores content (the light brand stage is intentionally flagged).
- The WebGL context leak during a *long export* (garbage collection keeps up; the reachable path is the storyboard/QA still path, which is fixed in E5).

## 9. Parallel work packages

Seven packages with disjoint file sets:

| Package | Scope |
|---|---|
| P1 | Render engine, export pre-render and preview parity (frontend) |
| P2 | Layered motion comps and safe area |
| P3 | Visual QA and HTML templates |
| P4 | AI tools, workflow guard and prompts |
| P5 | Agent runtime (Rust) and process hygiene |
| P6 | Backend export safety, data integrity and IPC |
| P7 | Editor UX, timeline and app shell |

Soft dependencies (each package still compiles and ships alone):
- P7 `quarantinedJs` ↔ P6 Rust field. Without P6, the field is dropped on save, which is still safe.
- P4 QA images ↔ P5 PNG forwarding. Both are needed for the model to see frames.
- P4 `LAYOUT_RULES` text ↔ P2 margin constants (landscape 5% sides / 6% top-bottom; portrait 6% sides / 12% top / 18% bottom).
- P3 legacy/custom box ↔ P1 letterbox. Each is consistent with the export on its own.

Public signatures that must not change:
- `renderMotionScenesForExport`
- `renderMotionGraphicsForExport`
- `renderMotionStill`
- `renderHtmlStill`
- `restack` (new parameters optional only)
- `history.preview` (extra parameter optional)
- `EditWorkflow.verify(project, assets)`

---

## Appendix A. Market study (2026-09-24)

### Landscape

State of AI video editing, September 2026. Research done 2026-09-24; Helios capabilities checked in D:\Helios on branch feat/motion-engine.

1) AI agents are now built into every major editor, but they mostly run existing features. Examples:
- Descript Underlord runs whole workflows (rough cut, filler removal, B-roll, Studio Sound, Eye Contact, translation and dubbing, video from slides) from one prompt, and works on the transcript rather than the timeline (descript.com/blog/article/descript-season-6-meet-underlord; help.descript.com Underlord beta).
- Riverside Co-Creator is a chat editing and repurposing agent: clips, show notes, thumbnails, clean audio (riverside.com/co-creator; prnewswire chat-based editing launch).
- Captions/Mirage has chat editing plus AI Edit (zooms, B-roll, SFX), eye contact, denoise, dubbing into more than 30 languages, and AI twins (captions.ai; en.wikipedia.org/wiki/Captions_(app)).
- Adobe's Firefly AI Assistant (public beta April 2026, added to Premiere in June 2026) runs multi-step jobs across Creative Cloud apps. Inside Premiere it only sorts bins, renames clips, finds interview questions and adds markers (blog.adobe.com 2026/04/15 and 2026/04/27; techcrunch.com 2026/06/18). After Effects 26.5 adds an experimental Assistant that writes and fixes expressions and organises projects (cgchannel.com 2026/09).
- Canva AI 2.0 (April 2026) has background agentic tasks.

2) The big NLEs compete on media understanding plus generative patching:
- Premiere 26: Generative Extend, Media Intelligence search (visuals, sounds, transcripts), Object Masking, Enhance Speech, Auto Reframe, Color Match, a Generative Media panel, and a new Color mode (helpx.adobe.com Premiere what's new; nofilmschool.com adobe-generative-media-tool).
- DaVinci Resolve 21 (final release June 2026): IntelliScript builds a cut from a screenplay, IntelliSearch, a voice model from 10 seconds of audio, CineFocus, UltraSharpen, Motion Deblur, Face Age and Face Reshaper, Fairlight Animator (audio drives parameters), OGraf/Lottie support, and Bezier and loop keyframing (newsshooter.com 2026/04/13; blackmagicdesign.com).
- Final Cut Pro 12 (January 2026): transcript and visual natural-language search and beat detection. Reviewers call the search unreliable (support.apple.com/102825; larryjordan.com).

3) Generation is being folded into editors:
- CapCut ships Dreamina Seedance 2.0/2.5: video and audio from a prompt, image or reference video, clips up to 15 s (techcrunch.com 2026/03/26).
- Runway Gen-4.5 plus Aleph 2.0 edits a single keyframe and carries the change through the video (therundown.ai; alphasignal.ai).
- Google Vids gives free Veo 3.1 generation, Lyria music and directable avatars (blog.google; 9to5google.com 2026/04/02).
- Kapwing puts Veo and Sora generations on the timeline.
- Adobe's Firefly video editor partners with Kling 3.0.

4) Short-form repurposing is commoditised:
- OpusClip ClipAnything 2.0 does multimodal moment search and virality scoring. Agent Opus makes videos end to end, and OpusClip runs a remote MCP server for Claude, ChatGPT and Cursor (opus.pro; help.opus.pro clip-anything).
- Submagic, Veed and Kapwing compete on caption styles (100+) and caption languages (120+).

5) Agent tooling around NLEs:
- MCP bridges let Claude or Codex drive Premiere, Resolve, FCP and Avid: Jumper, premiere-pro-mcp, a 1,027-tool AdobePremiereProMCP, and Cutback Selects (getjumper.io/ai-agents; github.com/ayushozha/AdobePremiereProMCP).
- HeyGen HyperFrames (Apache-2.0) renders agent-written HTML deterministically to MP4 through headless Chrome and FFmpeg (github.com/heygen-com/hyperframes). Helios' own editProgram.ts cites it.

6) Research:
- AgenticVBench (arXiv 2605.27705) has 100 real post-production tasks written by 20 experts. The best agent stack barely passes 30%, and the harness choice changes scores and failure modes a lot.
- Other work: EditDuet (SIGGRAPH 2025, a two-agent NLE editor), LAVE (IUI 2024), "Unified Agentic Video Editing Across Levels of Complexity and Creativity" (arXiv 2609.12769), a unified VideoAgent framework (June 2026), and the CineAgents benchmark (2026).
- The common message is that planning and tool calls are no longer the bottleneck. Seeing and checking what was rendered is.

Where this leaves Helios. No shipping product combines:
- an agent from any provider (Claude CLI or API, OpenAI-compatible, Gemini, Ollama, plus Helios' own MCP server in src-tauri/src/mcp.rs);
- a real Premiere-style NLE with transactional edit programs (src/lib/editProgram.ts);
- an After Effects-class WebGL2 engine with expressions, 3D camera, mattes and 34 effects that export identically (src/motion; MOTION-ENGINE.md reports 47 dB PSNR between preview and export);
- local roto, depth, eraser, LTX/Wan/SDXL generation and person tracking (src-tauri/workers);
- a render-and-measure QA loop (run_frame_qa in src/lib/aiTools.ts:2867, which renders real frames through the export compositor via api.exportFrame and checks geometry in src/lib/polish.ts).

Adobe's and Blackmagic's assistants stop at project housekeeping. Descript, Captions and Riverside have agents but shallow motion design. Runway and CapCut own pixel generation but not structured, editable edits.

Helios is weak on table stakes:
- no text-based or filler editing (src/panels/TranscriptPanel.tsx is read-only);
- no neural speech enhancement (project.rs:525 is an FFmpeg high-pass, denoise and compression chain);
- no semantic library search;
- no translation or dubbing;
- stabiliser, upscale and colour-match entries in effectsCatalog.ts are placeholders that are not in RENDERED_EFFECTS (src/lib/effectSupport.ts);
- Multi-Camera is disabled in the menu (src/App.tsx:1596).

### Gap analysis

| Priority | Capability | Who has it | Helios today |
|---|---|---|---|
| must | Editing by the transcript: delete words to cut; one action removes fillers, pauses and retakes | Descript (core + Underlord), Premiere text-based editing, Resolve 21 IntelliScript, Riverside, Captions/Mirage, Kapwing, Veed | Missing. TranscriptPanel.tsx only reads, copies and jumps. No filler, silence or retake recipe exists in src/lib/recipes.ts; the recipes are tighten, punch-ins, captions, hook, music-bed, vertical and pro-chunk-edit. The AI has to work out remove_range spans itself from analyze_clip_speech word timestamps. |
| must | Neural speech enhancement and voice isolation (Studio Sound, Enhance Speech) | Adobe Enhance Speech (Premiere and Firefly video editor), Descript Studio Sound, Resolve Voice Isolation, Captions AI Denoise, Riverside | DSP only. The speech-cleanup filter is high-pass, denoise and compression in FFmpeg (src-tauri/src/project.rs:525). No neural model among the local workers, although DeepFilterNet or Resemble-Enhance would fit the existing Python job harness. |
| must | Natural-language search across the media library (visual, spoken and sound) | Premiere 26 Media Intelligence, FCP 12 Transcript and Visual Search, Resolve 21 IntelliSearch, OpusClip ClipAnything | Missing. inspect_clip_frames and inspect_source_frames look at one clip at a time. No embedding index over assets exists, so the AI cannot answer 'find the shot where she laughs' across 200 files without opening them one by one. |
| must | Long-form to shorts: find moments, score virality, batch-export vertical cuts | OpusClip (plus its MCP server), Descript, Veed AI Clips, Riverside Co-Creator, Kapwing, Submagic | Partial. There is a vertical recipe, podcast_cut with RF-DETR people tracking (src/lib/reframe.ts), and captions. There is no tool to score or pick moments and no batch export of N shorts from one source. |
| must | Translation, multilingual captions and AI dubbing | Descript, Captions/Mirage (30+ dub languages), Veed (125+ caption languages), Kapwing, HeyGen | Missing. TTS exists (Piper, ElevenLabs and OpenAI in src-tauri/src/speech.rs, including Devanagari handling), but there is no translate or dub tool and no per-language comps. |
| must | Stabilisation, colour match and auto colour that actually render | Premiere (Warp Stabilizer, Color Match, the new Color mode), Resolve (auto colour, colour match, stabiliser), FCP | Placeholders. effectsCatalog.ts lists warp-stabilizer, rolling-shutter-repair and color-stabilizer with apply:{} and detail-preserving-upscale as contrast:15. None of them is in RENDERED_EFFECTS (src/lib/effectSupport.ts), so the AI correctly cannot use them. No colour-match tool. |
| should | Generative Extend: extend a clip's head or tail with generated frames and audio | Premiere Generative Extend (Firefly), Google Vids extend, Runway | Missing. LTX 2.3, LTX 2B and Wan 2.1 are installed only as text-to-video jobs (lib.rs local_media_status). There is no image-to-video path conditioned on a clip's last frame, and no extend operation on update_clip. |
| should | Cloud frontier generation on the timeline (Veo 3.1, Kling 3, Seedance 2, Runway Gen-4.5/Aleph) | Kapwing, Premiere Generative Media panel, CapCut, Google Vids, Firefly | Missing. Video generation is local only. Cloud keys exist only for TTS (ElevenLabs and OpenAI) and LLM providers. |
| should | Voice cloning and regenerating a misspoken word in the speaker's own voice | Descript Overdub/Regenerate, Resolve 21 (voice from 10 s of audio), ElevenLabs | Only indirect: ElevenLabs voices the user already owns can be picked (speech.rs elevenlabs_voices). There is no local clone and no word-level patching of dialogue. |
| could | Eye-contact correction and face retouching | Descript Eye Contact, Captions eye contact, Resolve 21 Face Reshaper, Blemish Removal and Age Transformer | Missing. |
| should | Multicam sync and switching | Premiere, Resolve, FCP (all with audio sync); Riverside | Menu item disabled (src/App.tsx:1596). podcast_cut switches framing within one wide shot, but there is no sync of multiple angles by audio. |
| should | Assembly from a script: match takes to screenplay lines | Resolve 21 IntelliScript, Jumper and Cutback Selects over MCP | Partial. save_storyboard and save_video_blueprint plan from a script, but there is no tool that aligns transcribed takes to script lines and picks the best take. |
| could | Lottie and OGraf graphics interchange | Resolve 21 (OGraf and Lottie), AE plug-ins | Missing. Graphics come in only as Helios motion JSON or HTML templates, so Lottie files from the design world cannot be dropped in. |
| could | Review and approval: frame-accurate comments and shareable review links | Frame.io (Premiere and Resolve), Descript, Kapwing, Canva | Missing (desktop only, single user). |
| could | Publishing and scheduling with social copy | OpusClip, Riverside Co-Creator, Descript, Captions | Missing. Export only. |
| could | Avatars and lip-sync presenters | Google Vids (Veo 3.1 avatars), Captions AI twin, HeyGen, Synthesia | Missing. |
| could | Video-to-video restyle and object replacement across a shot | Runway Aleph 2.0, CapCut Seedance, Firefly | Partial. The SDXL inpaint and image-edit and the LaMa eraser (magic_erase.py) work on stills and plates. There is no temporally consistent video-to-video restyle. |
| must | UNIQUE to Helios, a strength: bring-your-own-model agent driving a full NLE AND an After Effects-class engine, both as native tools and as an MCP server | Nobody combines all three. Adobe's assistant does housekeeping; MCP bridges drive Premiere with no motion engine; HyperFrames renders HTML with no NLE. | Built: src-tauri/src/mcp.rs (per-turn token bridge); crates/helios-providers (Claude CLI and API, OpenAI-compatible, Ollama, Gemini); src/motion (WebGL2 engine: expressions in expr.ts, 3D camera, mattes, 34 effects); editProgram.ts transactional edits. |
| must | UNIQUE to Helios, a strength: QA against rendered frames, plus phase gates | No shipping competitor renders its own output and checks the geometry before declaring an edit done. | Built: run_frame_qa (aiTools.ts:2867) renders stills through api.exportFrame and checks off-frame, safe-area, overlap, subject-cover, blank-frame and black-edge problems (polish.ts, production.ts frameQa, coverage.ts). The plan, gather, edit and polish phases with user buttons live in production.ts. verify_edit_workflow requires the QA receipt. |
| must | UNIQUE to Helios, a strength: local-first matte, depth, eraser, tracking and generation | Resolve has some of this locally; everyone else is cloud-metered. | Built: SAM2 with ViTMatte, Depth Anything 3, a LaMa clean plate, RF-DETR with ByteTrack, Lucas-Kanade tracking, LTX 2.3, Wan, SDXL and Stable Audio Open (src-tauri/workers, lib.rs local_media_status). No per-credit cost. |

### Every invention proposed

#### Export Certificate (parity oracle with automatic bisection) (M)

Every export ships with proof that the MP4 matches the preview frame for frame. When it does not, Helios names the clip at fault and fixes it before the user ever sees a bad file.

- **Mechanism:** After render.rs finishes, Rust decodes K frames from the output file (ffmpeg -ss t -frames:v 1) at the qaTimes of the comp, every clip boundary and the midpoint of every motion stack group. The frontend renders the same times through the Program monitor compositor path. The code already exists as the dev-only src/editor/parity/parity.tsx harness; move it into an off-screen in-app route, or capture a hidden WebView2 with ICoreWebView2::CapturePreview. SSIM is computed per 32 px tile. Tiles below threshold are mapped to the clips covering them, using editor.placement boxes, stackGroups from motionStack.ts and previewCache.planComp. Suspects are then bisected by calling api.exportFrame on the prepared export copy with each suspect clip switched off, which gives a report such as "[Motion] Lower third, group of 5 layers, missing in export 12.4–15.0 s: frame folder empty". It is exposed as a verify_export tool and as a green or red certificate in the export dialog. The AI must get a pass before it reports the export as done.
- **Builds on:** src/editor/parity/parity.tsx, src-tauri/src/render/e2e.rs (parity_frames), src-tauri/src/render.rs, src/motion/exportFrames.ts, src/lib/htmlFrames.ts, src/lib/motionStack.ts (stackGroups), src/lib/previewCache.ts (planComp), src/lib/polish.ts (frameStats), api.exportFrame (lib.rs:2171)
- **Why it matters:** It directly closes the owner's open complaint that the export does not match the preview, and turns 'what you see is what ships' from a claim into a guarantee no NLE offers. Pros drop editors over one bad export. A certificate is a trust moat, and it also gives the agent a signal it can act on.

#### Point & Say: pixel-grounded direction on the Program monitor (M)

Click, circle or draw an arrow on the preview, then say "make this pop on the beat" or "slide it here". The agent knows exactly which layer of which clip was meant, and the arrow becomes the motion path.

- **Mechanism:** Add an object-ID pass to MotionRenderer (src/motion/gl/renderer.ts): the same placement, masks and mattes, drawn with a flat shader that writes the layer index plus the clip hash to an RGBA8 framebuffer, read back with readPixels at the pointer. DOM clips contribute their placement boxes (src/lib/editor.ts placement). Overlay.tsx gets the stroke tools of sketch.ts (path, arrow, rect, ellipse). A stroke becomes structured context attached to the chat message, for example {kind:'arrow', clipId, layerId, sceneTime, from:[x,y], to:[x,y]}. Arrows become x/y keyframes (set_keyframes, or update_motion_scene layer keys). Circles pick targets. Rectangles become keep-out or keep-in regions for the layout solver.
- **Builds on:** src/motion/gl/renderer.ts, src/motion/evaluate.ts, src/editor/Overlay.tsx, src/editor/ProgramMonitor.tsx, src/lib/sketch.ts, src/lib/editor.ts (placement), src/lib/motionStack.ts (layer clips), chat context in src/chat
- **Why it matters:** Referring to things is the biggest friction in chat editing: "the second title, no, the other one". Runway Aleph edits pixels. Premiere and Descript agents cannot see where you point. Grounded pointing on real layers makes the agent feel like a motion designer sitting next to you.

#### Word Anchors: a timeline that follows the transcript (L)

Delete a sentence in the transcript and the footage cuts. Every caption, kinetic title, lower third, B-roll insert and whoosh tied to a word moves with it, including word-timed animation inside After Effects-grade scenes.

- **Mechanism:** Add an optional anchor to Clip and to motion Layer: {assetId, wordIndex, edge:'start'|'end', offset}. Whisper word timestamps come from transcribe.rs. Add editProgram ops: cut_words(range), remove_fillers(set), remove_pauses(>ms), and remove_retakes, which detects repeated n-grams within 20 s using word-level edit distance and keeps the last take. The ops produce remove_range spans on the source-to-timeline map (timeline.ts sourceTimeAt). After the cut, a resolver re-derives every anchored clip's start and duration and every word-timed cascade in motion/text.ts from the new word times, all in the same atomic program commit. TranscriptPanel.tsx becomes editable: select, strike and restore.
- **Builds on:** src-tauri/src/transcribe.rs, src/lib/transcriptText.ts, src/lib/editProgram.ts, src/lib/timeline.ts (removeRange, sourceTimeAt), src/motion/text.ts (word cascades), src/lib/subtitlesEngine.ts, src/panels/TranscriptPanel.tsx
- **Why it matters:** It closes the biggest must-have gap (Descript-style text editing and filler removal) and goes further: in Descript, graphics are not word-anchored After Effects scenes. Talking-head and podcast creators, the largest editing market, could move over without losing Helios' motion edge.

#### Signal expressions: beat, loudness, word and speaker inside the expression language (M)

One expression instead of 400 keyframes: a glow that breathes with the bass, a karaoke highlight on the word being spoken, a lower third that follows the speaker's head, a counter that ticks on every beat.

- **Mechanism:** Extend buildGlobals in src/motion/expr.ts with beat(t), beatPhase(t), bar(t), audio.rms(t)/audio.band('low'), word.current/word.index/word.progress, speaker.box(t) and subject.box(t). To keep export deterministic, and so exportFrames.ts never decodes audio, the signals are baked into scene.signals (Float32 arrays sampled at the scene fps, stored as base64) when the scene is created or updated. Sources are beats.ts detectBeats on peaks.ts, the audioEnvelope, transcript words, personTracks.trackAt, and roto subject boxes from api.rotoRead. validate.ts checks references. The AI tools create_motion_scene and update_motion_scene gain a signals:{music, speech, speaker} option.
- **Builds on:** src/motion/expr.ts, src/motion/evaluate.ts, src/motion/types.ts, src/motion/validate.ts, src/lib/beats.ts, src/lib/peaks.ts, src/lib/audioEnvelope.ts, src/lib/personTracks.ts, src/lib/roto.ts
- **Why it matters:** Resolve 21's Fairlight Animator links audio to parameters, and AE converts audio to keyframes. Nobody lets an agent write expressions over meaning: which word, which speaker, where in the beat. This is the kind of motion that makes edits feel handcrafted. It is cheap because the engine already evaluates expressions every frame.

#### Negative-space layout solver (L)

Graphics place themselves in the free space of the frame and move away as the presenter moves, so they never cover a face, a caption or the product.

- **Mechanism:** Add a layout constraint on motion layers and HTML graphics: {avoid:['subject','faces','captions','logo'], prefer:'right-third'|'top'|..., minScale, stability}. At each sampled time (qaTimes step 1/6 s) the solver builds an occupancy grid from roto subject boxes (api.rotoRead subjects; better, the matte downsampled to 32x18), person-track face boxes, caption and text boxes (production.ts textBox) and safeArea.ts. It picks the candidate slot that maximises preference and free area minus a movement cost with hysteresis, then turns slot changes into eased x/y/scale keyframes (anim.ts eases). It runs at create time and again whenever run_frame_qa finds covers-subject or caption-collision, so those findings become fixes the agent can apply rather than reports.
- **Builds on:** src/lib/polish.ts (restingLayerBoxes), src/lib/production.ts (textBox, frameQa), src/motion/safeArea.ts, src/lib/coverage.ts, src/lib/personTracks.ts, src/lib/roto.ts, src/motion/anim.ts, src/lib/motionTools.ts
- **Why it matters:** Today QA finds collisions after the fact, and the model burns turns nudging boxes. A solver makes subject-aware layout correct by construction, which no template tool (Canva, CapCut, Submagic) or After Effects does.

#### Motion critic: measurable 'feel' lint (M)

A motion-design reviewer that scores every graphic on jerk, clutter, reading time, contrast and brand motion, with numbers the agent can drive to zero.

- **Mechanism:** Built on evaluateMeasured (src/motion/measure.ts) sampled at 60 Hz per layer. Checks:
- velocity discontinuity at keyframes: |Δv| above a threshold without a hold;
- entrance clutter: more than 3 layers starting to move within 150 ms;
- hold time before exit below 0.6 s;
- reading time: words on screen ÷ visible seconds above about 3.5 words per second, stricter when captions are also visible;
- text contrast: WCAG luminance ratio from the rendered QA still under each text box (frameStats in polish.ts extended with region stats);
- easing and duration tokens that disagree with the active brand kit's motion section (brandKit).
Reported through run_frame_qa as new issue kinds, with a suggested fix for each (for example "extend hold to 0.8 s", "switch ease to ease-out-expo").
- **Builds on:** src/motion/measure.ts, src/motion/evaluate.ts, src/lib/polish.ts, src/lib/production.ts (QaIssue), src/lib/brandKit, src/lib/aiTools.ts (run_frame_qa)
- **Why it matters:** 'After Effects-grade' is currently a vibe judged by the model from contact sheets. Numbers make quality repeatable across providers. Cheap models improve most, and AgenticVBench shows the harness moves scores more than the model does.

#### Edit DNA: a measured distance to a reference style (L)

"Make it like this video" becomes a number: Helios measures how far your cut is from the reference on 12 axes and keeps editing until the distance is small.

- **Mechanism:** Extend refs.rs ingest, which already measures cuts, cut_every and palette, into a feature vector:
- shot-length histogram;
- share of cuts on speech boundaries (cuts compared with transcript word gaps);
- punch-in rate;
- caption words per second;
- graphics per minute;
- SFX per cut;
- integrated LUFS and loudness range;
- dominant-palette ΔE;
- motion energy per second (mean absolute frame difference on low-res frames);
- hook density in the first 3 s.
For the current comp, most features come straight from the project model (clips, keyframes, transcript) and the rest from low-res rendered frames. A style_distance tool returns per-axis deltas with suggested recipes. learning.ts skills store validated vectors, so 'my channel style' becomes a reusable target. save_style_profile keeps the vector next to the prose.
- **Builds on:** src-tauri/src/refs.rs, src/lib/learning.ts, src/lib/editProgram.ts (rhythmProgram), src/lib/beats.ts, analyze_reference_video and save_style_profile in src/lib/aiTools.ts, src/lib/sfxLevels.ts, level_audio (EBU R128)
- **Why it matters:** Every competitor's 'style' is a preset. A measured objective lets the agent converge on a creator's real style, and it is the loop AgenticVBench-style evaluations reward.

#### Retention forecast lane (L)

A per-second viewer-risk curve under the timeline, calibrated on your own channel's retention data, with one-click fixes for each dip.

- **Mechanism:** Features per second:
- seconds since the last visual change (frame differences from the preview cache or low-res exportFrame);
- speech rate and silence (transcript);
- novelty (embedding distance between consecutive sentences, through the provider or a small local model);
- on-screen text load;
- face presence (person tracks);
- loudness dips (the audio envelope);
- hook events in the first 3 s.
The first model is a transparent weighted sum. Calibration: import the YouTube Studio audience-retention CSV for past videos whose Helios projects still exist, align features to the real retention curve, and fit a local logistic regression per creator (the weights are stored in the storage folder). It is drawn as a lane like CacheBar.tsx. A retention_forecast tool returns the dips with suggested recipes (punch-ins, B-roll, SFX, cut).
- **Builds on:** src/editor/CacheBar.tsx, src/lib/previewCache.ts, src/lib/audioEnvelope.ts, src/lib/personTracks.ts, src-tauri/src/transcribe.rs, src/lib/recipes.ts, src/lib/storage.ts
- **Why it matters:** OpusClip scores whole clips for virality. Nobody forecasts retention second by second on an editable timeline and closes the loop with fixes and per-creator calibration. Retention is what creators get paid on. It is honest because it starts as a transparent heuristic and says how well it is calibrated.

#### Edit Multiverse: parallel variants, compared side by side (M)

Ask for three hooks and two pacing styles. Six subagents build six real, editable cuts in parallel, and you compare their first 5 seconds side by side, or export all of them for A/B tests.

- **Mechanism:** A fork_variants tool duplicates the comp N times (create_comp plus a deep copy with new ids). It spawns subagents (subagent.rs), each scoped to one variant comp. Today subagents share one ToolExecutor and undo stack, so this needs a comp-scope guard in ToolExecutor (refuse writes outside the assigned comp) and one undo group per variant. Each subagent works through apply_edit, whose editProgram already runs against a copy and commits atomically. Helios then renders the first 5 s of each variant as a contact reel (renderMotionStill, renderHtmlStill, exportFrame) and shows a grid. Picking one promotes it; 'export all' batches the renders with suffixed names for YouTube Test & Compare or Meta A/B tests.
- **Builds on:** src-tauri/src/subagent.rs, src-tauri/src/ai_tools.rs (ToolExecutor), src/lib/editProgram.ts, src/lib/history.ts, create_comp in src/lib/aiTools.ts, src/motion/exportFrames.ts, src/lib/exportPresets.ts
- **Why it matters:** Creators already A/B test thumbnails and titles. Testing the edit itself is the next lever, and only an agent that drives a real NLE can produce many structurally different cuts cheaply and locally.

#### Taste memory from implicit feedback (M)

Helios learns your taste from what you undo and tweak, not from settings. After a week it stops adding whooshes you always delete and makes titles last as long as you keep trimming them to.

- **Mechanism:** Tag every AI-committed op in history.ts with the turn id, tool and arguments; actionLogger.ts already records AI and user actions. Detectors:
- undo within 30 s of an AI commit;
- a user edit of a parameter the AI set within 10 minutes (title duration 2.0 → 1.2, SFX gain -6 → -14);
- deletion of AI-added clips.
Aggregate per tool and parameter into local priors (the median corrected value with a confidence count). Inject a short 'your preferences' block into the system prompt, and apply the priors as defaults for omitted arguments in aiTools.ts. Explicit reviewed skills stay in learning.ts; this is the implicit layer beside them. The priors are shown and editable in LearningWorkspace.tsx.
- **Builds on:** src/lib/history.ts, src/lib/actionLogger.ts, src/lib/ideagraph.ts (TurnOutcome), src/lib/learning.ts, src/panels/LearningWorkspace.tsx, src/lib/aiTools.ts
- **Why it matters:** Every agent editor forgets your corrections. Personalisation that stays on the machine, with no training, is a strong retention moat: the longer you use Helios, the more it edits like you, and switching loses that.

#### Motion cloning by analysis-by-synthesis (XL)

Point at any motion graphic in a reference video and get an editable, brandable native scene that matches it frame for frame. It is rebuilt, not copied.

- **Mechanism:** 1. The agent inspects the reference frames (inspect_source_frames, or the analyze_reference_video sheets).
2. It proposes a MotionScene from the kit templates or remotion_kit briefs.
3. A black-box optimiser (CMA-ES in a Web Worker) tunes the numeric parameters: keyframe times and values, bezier handles, colours, blur, glyph stagger.
4. It minimises perceptual distance (SSIM plus an edge loss at 256 px) between renderMotionStill frames and the reference frames at matched times.
The engine is deterministic and off-screen, so hundreds of low-res evaluations a second are realistic on WebGL2. Output: a native scene with named parameters that brandify.ts can restyle. Limits: flat 2D, typographic and shape motion; photoreal content is out of scope, and rights are recorded as in learning.ts (the rights field).
- **Builds on:** src/motion/evaluate.ts, src/motion/gl/renderer.ts, src/motion/exportFrames.ts (renderMotionStill), src/motion/kit/*, src/lib/remotionKit, src/motion/kit/brandify.ts, src-tauri/src/refs.rs, src/lib/learning.ts
- **Why it matters:** Motion designers spend hours rebuilding looks they have seen. No tool turns a video of a graphic back into an editable After Effects-style graphic. Only possible because Helios owns a deterministic GPU engine that can be scored.

#### Recipe by demonstration (L)

Edit one chapter by hand, then say "do what I just did to every chapter". Helios generalises your actions into a reusable, parameterised tool and proves it reproduces your edit before using it.

- **Mechanism:** 1. Capture the session's user actions (actionLogger.ts) and project diffs (history.ts) over a marked range.
2. The LLM synthesises a steps or ops custom tool (customTools.ts). Absolute times are replaced by anchors: transcript words (Word Anchors), beats (beats.ts), face-track events and scene cuts (detect_scenes).
3. Validation: re-apply the tool to the original range on a copy with editProgram preview, and diff it against the user's actual result. A structural match is required before the tool is saved.
4. Apply to the other ranges, each as its own undo step, with run_frame_qa after each.
- **Builds on:** src/lib/actionLogger.ts, src/lib/history.ts, src/lib/customTools.ts, src/lib/editProgram.ts (preview and diff), src/lib/beats.ts, src/lib/personTracks.ts, create_custom_tool and run_frame_qa in src/lib/aiTools.ts
- **Why it matters:** It turns an editor's craft into automation without prompt-writing. Macros replay clicks; this generalises intent, then checks itself. Agencies making series content (podcasts, courses, episodes) would switch for it.

#### Reflowing localization (L)

One click makes Hindi, Spanish and German versions. Captions and voice are translated and dubbed, and every After Effects-grade title, lower third and chart is re-typeset so the longer text still fits the design.

- **Mechanism:** A localize tool:
1. Duplicate the comp for each language.
2. Translate captions and every text layer (motion Layer text in src/motion/types.ts, HTML graphic text via htmlLayers.ts) through the provider, keeping rich spans.
3. Dub with speech.rs (ElevenLabs multilingual or Piper) and time-fit each line: speed within ±12%, otherwise re-time the anchored graphics with Word Anchors.
4. Re-measure text with motion/text.ts and measure.ts; auto-shrink, wrap or swap slots through the layout solver and safeArea.ts.
5. Run run_frame_qa and the motion critic per language, then batch export.
The existing Devanagari and Hinglish handling in speech.rs (devanagari(), plan()) makes Indian languages a strong first target.
- **Builds on:** src-tauri/src/speech.rs, src/lib/subtitlesEngine.ts, src/motion/text.ts, src/motion/measure.ts, src/lib/htmlLayers.ts, src/motion/safeArea.ts, src/lib/aiTools.ts (run_frame_qa), src/lib/exportPresets.ts
- **Why it matters:** Competitors dub audio and translate captions, but the graphics stay in English or overflow. Complete, design-correct localisation opens global audiences for a solo creator.

#### Linked multi-aspect masters (L)

Edit once in 16:9. The 9:16, 1:1 and 4:5 versions stay live: footage reframes on the speaker, graphics re-lay themselves out, captions reflow, and your per-format tweaks are kept.

- **Mechanism:** A derived comp stores {masterId, aspect, overrides}. A derive(master, aspect) function:
- maps each clip by id;
- reframes footage with reframe.ts frameFor on person tracks (as podcast_cut does);
- re-lays out motion and HTML graphics with the layout solver and safeArea.ts (the portrait and landscape template variants already exist);
- reflows captions to the aspect's caption band.
The user's edits on a derived comp are stored as patches keyed by clip id and property, and re-applied after each re-derivation, which runs on master commit (history.ts).
- **Builds on:** src/lib/reframe.ts, src/lib/personTracks.ts, src/motion/safeArea.ts, src/lib/motionStack.ts, src/lib/layout.ts, src/lib/history.ts, src/lib/types.ts (Comp)
- **Why it matters:** Premiere's Auto Reframe crops footage but breaks graphics, and OpusClip only reframes. Every creator now publishes three to five aspect ratios. Keeping them in sync without redoing the design saves hours per video.

#### Continuity Guard for jump cuts (M)

Every talking-head cut is measured. Where the head jumps, Helios hides it with a punch-in of the right size, B-roll or a seamless push, and proves the fix by re-measuring the rendered frames.

- **Mechanism:** At each cut between segments of the same source, sample person-track face boxes (personTracks.trackAt) on both sides and compute displacement and scale ratio. Above threshold, choose one fix:
- a punch-in where the scale change is at least 12% and the face stays in the safe area (reframe.ts frameFor);
- a B-roll cover from the storyboard or library;
- seamless_transition push.
Verify by rendering the frames on either side of the cut (exportFrame) and re-measuring. Available as a recipe (continuity) and as a run_frame_qa issue kind (jump-cut).
- **Builds on:** src/lib/personTracks.ts, src/lib/reframe.ts, src/lib/recipes.ts, seamless_transition and run_frame_qa in src/lib/aiTools.ts, src/lib/production.ts
- **Why it matters:** Captions and Descript add zooms by rule. Measured, verified fixes look intentional. This is the most common talking-head defect and would be fixed automatically.

#### Idle polish daemon: spellcheck for video (S)

While you edit by hand, Helios checks what changed in the background and puts warning ticks on the timeline ruler. The agent can fix them all with one "clean up".

- **Mechanism:** After each history.ts commit, diff the comp before and after to get the dirty time spans. In idle time, the same scheduling previewCache.ts uses for warm frames, run frameQa (production.ts), uncoveredSpans (coverage.ts), the motion critic, and blankFinding on low-res stills for the dirty spans only. Findings are cached by clip hash, so unchanged spans are never checked twice. Ticks are drawn on the Timeline ruler. A fix_warnings tool hands the list to the agent with a range.
- **Builds on:** src/lib/previewCache.ts, src/lib/history.ts, src/lib/production.ts, src/lib/polish.ts, src/lib/coverage.ts, src/editor/Timeline.tsx, src/editor/CacheBar.tsx
- **Why it matters:** It makes QA a constant assistant rather than a phase the agent may skip, and it helps manual editors too. This is how human editors get used to relying on the AI.

### Positioning

Helios should not claim to be \"an editor with an AI assistant\". Adobe, Descript, CapCut and Riverside all say that, and their assistants mostly run existing features (Adobe's assistant in Premiere sorts bins and adds markers). Helios' claim: the only editor where an AI of your choice runs the whole studio, a Premiere-style NLE plus an After Effects-class GPU motion engine, on your own machine, and has to prove its work by rendering and measuring the frames it will ship.

The moat is architectural. One deterministic render stack serves three purposes:
- preview;
- export (motion scenes and HTML graphics pre-rendered by the same code; PSNR 47 dB between the two);
- QA (run_frame_qa renders through api.exportFrame).

That makes closed-loop features possible that cloud generators and legacy NLEs cannot copy quickly: the export certificate, the motion critic, Edit DNA distance, analysis-by-synthesis motion cloning, the layout solver, and taste memory from undo. Research backs the bet. AgenticVBench's best agent passes barely 30% of real post-production tasks, and the harness changes outcomes a lot, so the winner is whoever gives agents eyes, measurements and guarantees, not whoever has the most tools.

Secondary moats:
- Bring your own model (Claude CLI or API, OpenAI-compatible, Gemini, Ollama), and Helios is itself an MCP server, so it rides every frontier model release.
- Local-first roto, depth, eraser, tracking and generation: no credits, and private footage.
- Structured, editable output (layers, keyframes, expressions, word anchors), where Runway and Seedance return pixels.

Honest caveat: Helios will not win on the moat alone while table stakes are missing. The next quarter should ship editing by the transcript with filler and retake removal (Word Anchors), neural speech enhancement, semantic media search, translation and dubbing, and real stabilisation and colour match. At the same time it should ship the export certificate, which fixes the owner's open export-parity complaint and becomes the trust headline: \"What you see is what ships — certified.\"
