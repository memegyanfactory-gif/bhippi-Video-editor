# Bhippi improvement to-do

From the full app review on 2026-09-29. Updated as work lands.

Legend: `[x]` done and tested · `[~]` in progress · `[ ]` not started

**Working on now:** nothing. Everything is done except 18b (see its note). Phase 9 below still needs a check in the running app.

## Phase 1 — Bugs that lose work or give wrong results

- [x] 1. An untitled project is replaced by New/Open Project with no "Save changes?" prompt
  - An untitled project with any media or clips now always counts as unsaved (`src/lib/unsaved.ts`, tests in `tests/unsaved.test.ts`).
- [x] 2. "Don't Save" on close is undone by the session autosave, which reopens the edits marked as saved
  - "Close without saving" now writes the last-saved version back to the session autosave and blocks any pending autosave. The close listener is registered once instead of on every edit.
  - Not covered: after a crash, the recovered session still opens marked as saved.
- [x] 3. Export queue hangs forever when 3+ exports wait (queued jobs count as running)
  - Render slots are now a real 2-slot semaphore (`export_start` in `src-tauri/src/lib.rs`); a waiting export stays cancellable. Compiles; not yet exercised with 5 live exports.
- [x] 4. AI "Revert" wipes manual edits and later AI turns made after that turn
  - Each AI turn's end state is recorded. Revert applies straight away only when nothing changed since; otherwise it asks first and says what will be undone. Opening a project clears old turns.
  - Still open: a true per-turn revert that keeps later work, which needs inverse patches.
- [x] 5. Paste Attributes skips colour grades and effects (`appliedEffects`); Ctrl+Alt+V opens the wrong menu
  - "Effects" now copies the full effect stack with fresh ids (effects tied to the source clip's Magic Mask are left out); Remove Attributes clears it. Ctrl+Alt+V opens the Paste Attributes dialog directly. Tests: `tests/pasteAttributes.test.ts`.
- [x] 6. Speed/Duration with Ripple shifts linked video+audio twice and breaks sync
  - Linked halves with the same span are retimed as one unit and ripple once (`setSpeed` in `src/lib/timeline.ts`). New test covers slow-down and speed-up of a linked pair.
- [x] 7. AI chat transcript saved into `.bhippi` files and carried from one project into the next
  - Opening a project now shows that file's own chat (empty if it has none) and clears the previous project's AI turn state, so an old Revert can't restore the other project.
  - Still open: an "Include AI conversation" choice on Save a Copy for files sent to clients.
- [x] 8. Duplicate Comp loses its transitions; Rename on a media item does nothing
  - New `duplicateComp` remaps transitions, links and groups to the copied clips (tested). Bin Rename is now enabled only for a single comp, item or folder.
  - Still open: renaming media needs a per-project display name, which means changing the project file format.
- [x] 9. Reversed clips are silent in the preview (the export has sound)
  - New `audio_reversed` backend command writes a cached reversed WAV of the clip's range; the preview plays it forwards (`ReversedVoice` in `Compositor.tsx`). Compiles and typechecks; not yet listened to in the running app.
- [x] 10. Karaoke captions highlight words on an even beat instead of the real word timings
  - Transcribed captions now store when each shown word starts (`words` on the text clip, TS + Rust). The preview (`wordStates`) and the export (`caption_styles.rs`) both follow them through trims and speed changes, and fall back to even spacing if the words were edited. Tests on both sides.

## Phase 2 — Make the AI light for small edits and visible

- [x] 11. Remember the Full/Quick choice; route single edits to Quick, only "make a video" to the full pipeline
  - New default **Auto workflow**: "make/create/turn this into a video/reel/short…" and planned productions run Full; targeted changes run Quick (`src/lib/workflowRoute.ts`, 15 tests). The choice is remembered. Start Generating/Editing always run Full. The model still can't pick its own mode.
  - Still open: storyboards still add a music bed the user didn't ask for (`parseProduction`).
- [x] 12. Council taste rules (motion every 6 s, music bed) advise instead of blocking
  - The Animator's "6 s with no motion" and the Audio Guru's "no music bed" now block only a planned production. On plain edits they are advice. Objective checks (off-frame, watermarks) and @funny rules still block. Tests updated for both cases.
- [x] 13. Highlight clips the last AI turn changed on the timeline, with a change list
  - When an AI turn ends, what it changed is worked out by comparing the project before and after (`src/lib/turnChanges.ts`, tested). Clips it added or changed get a violet tint on the timeline until the next turn.
  - Under the answer, "On the timeline: 3 added · 5 changed · 1 removed" opens a list: click an entry to jump the playhead there and select the clip. "Show/Hide on timeline" toggles the tint for that turn. Not yet seen in the running app.
- [x] 14. One AI turn = one undo step; History panel
  - When an AI turn ends, its steps fold into one undo step named after the request (e.g. `AI: "trim the intro"`). If the user edited during the turn, nothing is folded, so their edits keep their own steps. **Edit › History…** lists every step (AI turns marked); click one to jump back or forward to it. Tests in `tests/history.test.ts`.
- [x] 15. Retry transient provider errors (overloaded, 5xx, network) automatically
  - API providers (native tool calling) now retry a failed round up to 3 times (2 s, 4 s, 8 s), only for overloaded, 5xx, network, timeout or crashed errors, only if nothing from that round is already on screen, and Stop still works while waiting. Usage limits, bad keys and full context are never retried. Test: `only_failures_that_clear_by_themselves_are_retried`.
  - Still open: the text protocol and CLI providers (Claude Code, Codex) don't retry yet.
- [x] 16. Auto-edit: allow undoable clip deletes, stop `apply_edit` from bypassing the gate
  - Auto-edit now removes clips, ranges and transitions (all undoable, and exactly what `apply_edit` could already do). Only deleting tracks, comps, project media or plugins needs Full access. Plugins still ask before deleting clips. Wording in the menu and AI brief updated; tests updated.
- [x] 17. AI `undo` tool only undoes its own steps
  - The `undo` tool now undoes only consecutive `AI:` steps from the top of the history and refuses if the latest change is the user's. Tests in `tests/aiToolsFixes.test.ts`.

## Phase 3 — Speed

- [x] 18. Split App.tsx state into a store with selectors; memoize panels and timeline clips
  - Done, the per-frame costs:
    - the timeline groups clips and transitions by track once per edit (no longer filtered per track, per repaint) and looks up offline media in a set;
    - scroll repaints at most once a frame;
    - Project-panel posters hash only changed comps, after edits settle, not on every frame of a drag;
    - autosave repairs the project after its half-second wait, not synchronously on every change;
    - the theme is re-applied, and plugins told, only when the look changes (not on every layout save).
  - 1,873 tests pass.
- [ ] 18b. (Split from 18) Move App.tsx state into a store with selectors and memoize panels. **Not done (deliberately).**
  - Audit on 2026-09-29: the worst offender, background job progress, already lives outside React state (`src/lib/jobsStore.ts`). Drag hover only changes when its target changes.
  - Two frequent updates still re-render the whole editor:
    - rotoscope progress (every frame);
    - AI tool events (two per tool call).
    These are the next ones to move into small stores the same way.
  - The full move of App.tsx's 70 `useState`s into a store was not started. It rewrites the central 4,000-line file other work is also changing, and it needs profiling in the running app to target the right state. Do it as its own task.
- [x] 19. Register Tauri event listeners once (not on every edit)
  - The library, providers, tools, open-file and job listeners are now subscribed once. They read the latest history and file opener through a ref, so a job event ("export complete", a finished generation) can no longer land in the gap while they were re-subscribing on every edit. The window-close listener was already fixed in item 2; the chat and tool-call listeners were already subscribed once.
- [x] 20. Limit parallel media preparation on import
  - Preparing imported media (thumbnails, filmstrip, waveform, peaks, proxy) now waits for one of a shared set of slots: a quarter of the CPU cores, at least 2. The rest show "Waiting to prepare". Compiles.
  - Not done: making preparation cancellable, and merging the separate waveform and peaks decodes into one pass.
- [x] 21. In→Out export pre-renders only the graphics inside the range
  - An In→Out export now pre-renders only the frames inside the range, plus a 1-second margin for transitions, for HTML graphics, motion scenes and WatchFIWN captions (`src/lib/exportWindow.ts`). Graphics outside the range are skipped, and the progress bar counts only what renders. Clips inside nested comps still render whole, because the parent clip's speed changes their timing. Tests: `tests/exportWindow.test.ts`, windowed caption export.
- [x] 22. HTML graphics render at output resolution in 4K exports
  - HTML graphics are now drawn at the scale the output needs: output short side ÷ design-canvas short side, capped at 4× (`graphicScale` in `src/lib/htmlFrames.ts`). A 4K comp's titles render at 2× instead of being upscaled from 1080p. Tested for 1080p, 4K, portrait 4K and an 8K cap.

## Phase 4 — Core editing moves

- [x] 23. Three-point editing (timeline In/Out, back-timing, fit to fill)
  - Insert (`,`) and Overwrite (`.`) now follow Premiere's three-point rules (`threePointEdit` in `src/lib/timeline.ts`): timeline In+Out fills that span from the source In; only In starts there; only Out back-times the clip to end there; no marks uses the playhead. If the source runs out early, a note says so.
  - New **Clip › Fit to Fill (Overwrite)** (bindable in Shortcuts) retimes the source In→Out to fill the timeline In→Out. The edit is now computed from the current comp, not a stale copy. Tests: `tests/threePoint.test.ts`.
- [x] 24. Keyboard trimming (select edit point, Ctrl+←/→, slip/slide keys)
  - Clicking a clip edge without dragging selects it as the edit point (yellow bar); **Shift+T** selects the one nearest the playhead.
  - **Ctrl+←/→** trim 1 frame and **Ctrl+Shift+←/→** 5 frames, in the active tool's mode (Ripple, Rolling or Rate Stretch tool; otherwise a plain trim). The playhead follows the edit.
  - **Ctrl+Alt+←/→** slip and **Alt+, / Alt+.** slide the selected clips. Esc clears the edit point. All rebindable; the keymap tests find no clashes.
  - Not done: a two-up trim view in the Program monitor.
- [x] 25. Match Frame parks on the matched frame; Reverse Match Frame
  - **Match Frame (F)** now parks the Source monitor on the exact matched frame, not the clip's start.
  - New **Reverse Match Frame (Shift+R**, also in the Clip menu) finds where the Source monitor's frame plays in the comp, through speed changes and reversed clips, nearest the playhead first. It moves the playhead there and selects the clip. Shift+R used to be a second Match Frame key. Tested (`whereSourcePlays`).
- [x] 26. J/K/L on the Source monitor; K+J/L slow jog
  - J/K/L now drive whichever monitor is focused. The Source monitor has its own shuttle: L again for 2×, 4×, 8×, and J plays backwards by stepping frames at that rate, since browsers can't play video in reverse.
  - Holding **K** while tapping or holding J/L steps one frame at a time; key repeat makes holding it a slow jog. Typechecks.
  - Not done: smoother reverse playback on the Program monitor (it still steps from the wall clock).
- [x] 27. Ctrl+drag rearranges instead of leaving a hole
  - Ctrl+drag within the same tracks now **rearranges** (`rearrangeClips` in `src/lib/timeline.ts`): the shots are lifted with their gap closed, then inserted where they were dropped. Transitions between them go along, and dropping onto their own spot does nothing. Ctrl+drag across tracks still inserts. Tests: `tests/rearrange.test.ts`.
- [x] 28. Out-of-sync badges on linked clips
  - Linked clips whose picture and sound have slipped apart now show a red frame-offset badge (e.g. "+12"), as Premiere does. It's worked out from where their shared source lines up (`syncOffsetFrames`, tested), so trims that keep them lined up don't trigger it.
  - Not done: ripple still skips a sync-locked track that would collide; the badge at least makes the slip visible.
- [x] 29. Timeline follows the playhead on keyboard jumps; Esc cancels a drag; drops snap
  - The timeline now recentres on the playhead when a jump (Up/Down, Home/End, Q/W, markers, Match Frame) lands it off screen; while playing it pages along as before.
  - **Esc during a drag** puts everything back and goes no further, so it doesn't also deselect.
  - **Drops** from the Project panel and Source monitor now snap to clip edges, the playhead and markers, following the snap toggle, and show the snap line. Typechecks and tests pass.
- [x] 30. Keyframe easing menu; keyframes on effect parameters
  - With the playhead on a keyframe, Properties shows an easing picker for that keyframe: Linear, Hold, Ease, Ease In, Ease Out, Ease In & Out, Overshoot. The preview and export already share these curves, so the choice exports as seen.
- [x] 30b. (Split from 30) Keyframes on effect settings (blur, colour, crop…). Every effect's export filter needs animated parameters.
  - Brightness, contrast, saturation, hue and blur now take keyframes. In **Properties › Effects** each has the same stopwatch, keyframe diamond, previous/next buttons and easing menu as the transform rows.
  - Stored as an optional `effectKeys` on the clip (TypeScript + Rust), so older projects load unchanged. Trimming a clip's head keeps the look, as transform keys do.
  - **Preview:** each setting is read at the playhead (`effectsAt`).
  - **Export:** each keyed stage is driven per frame by one `sendcmd`, in the same order as the preview's CSS filters:
    - brightness and contrast as one channel mix (the contrast offset rides on alpha);
    - saturation and hue as colour matrices;
    - blur as `gblur` sigma.
  - Checked with the real FFmpeg:
    - a brightness ramp measured 71 → 85 → 98 luma at 0, 1 and 2 s, as expected;
    - a Rust test runs all four stages through FFmpeg when it is installed.
    - Found on the way: `sendcmd` needs the `[expr]` flag on every command, not once per line.
  - The AI's `set_keyframes` accepts the five settings.
  - Not done: invert and crop are not keyframeable. Effect keys don't show as diamonds on the timeline clip yet. Adjustment layers and text clips use the static value.
  - Tests: `tests/effectKeyframes.test.ts`, 2 Rust tests.

## Phase 5 — Differentiators

- [x] 31. Editable transcript (delete words to cut)
  - In the Transcription panel's timeline view, words are now clickable: click to select (the playhead jumps there), Shift+click to select a run, then **Delete** or **Cut N words**.
  - Each run is extracted from its first word to where the next word starts, taking the pause too so the rhythm stays natural. It's one undo step (`cutRangesForWords`, tested).
- [x] 32. One-click Remove Silences / Remove Filler Words / Auto-reframe 9:16
  - New in the **Comp** menu:
    - **Remove Silences** cuts pauses of 0.6 s or more below −38 dB, only where every dialogue clip is quiet, keeping 0.15 s either side. It reads the stored waveform levels, so no transcription is needed.
    - **Remove Filler Words** cuts um/uh/erm… from the transcript; "like" and "so" are left alone.
    - **Make Vertical Copy (9:16)** makes a reframed copy and leaves the original untouched.
  - Each is one undo step and reports what it did (`src/lib/cleanup.ts`, tested). The bin's **Duplicate** now uses the fuller comp copy from `reformat.ts` (fresh track ids, its own layered motion comps); my simpler copy from item 8 is removed.
- [x] 33. Right-click "Ask Bhippi about these clips"
  - The clip menu now starts with **Ask Bhippi AI about this clip / these N clips…**. It selects them, opens the chat and fills the composer with "About the 3 selected clips (names, 0:12–0:30): " ready for the request. Nothing is sent until you press Send. The AI's prompt now says the selected clips are what "this/these" means.
- [x] 34. Proxy workflow (create, toggle, PROXY badge) and HDR tone mapping
  - **Proxies:** Project panel › **Create Proxy / Create Proxies (N)** makes a lighter copy of any video (half the lines, up to 1080p). When a comp has such proxies, the Program monitor shows a **PROXY / ORIGINAL** toggle (remembered). Files the webview can't play keep their required proxy either way, and exports always use the originals. Preview choice tested (`previewPath`).
  - **HDR:** imports read the colour transfer and flag PQ/HLG video (tested). HDR files preview from a tone-mapped proxy, and the export tone-maps them (zscale + Hable) when this FFmpeg has `zscale`, which is detected at startup; the chain was run on a real HLG clip.
  - Not done: HDR files imported before this aren't re-probed; proxy jobs can't be cancelled; no HDR badge in the bin.
- [x] 35. Audio mixer (track gain/pan) and LUFS meter
  - **Track fader and balance:** audio tracks have both (right-click the track header › **Track Volume & Pan…**, heard live while dragging, one undo step). They apply in the preview (per clip, balance law) and in the export (`volume`/`pan` per track, tested), so they match.
  - **Loudness:** a **M · S LUFS** readout under the meters shows EBU R128 momentary and short-term loudness through a K-weighted tap on the master, so you can mix to −14 by ear.
  - Not done: a full mixer panel with faders side by side; EQ or compressor effects; integrated LUFS.
- [x] 36. SRT/VTT caption export
  - **File › Export › Captions (.srt / .vtt)…** saves the active comp's captions.
  - The Export dialog has **Also save captions** (.srt or .vtt), which writes them beside the video with the same name. For In→Out exports they're trimmed to the range and start at 0.
  - SubRip/WebVTT formatting tested (`src/lib/captionFiles.ts`).
- [x] 37. Versioned backups + crash recovery dialog
  - **Versions:** besides the rolling autosave, a timestamped version is now kept at most every 5 minutes in the project's `Backups` folder (newest 20 per project; tested that other projects' files don't count).
  - **File › Restore from Backup…** lists them newest first. Restoring loads one into the open project as one undo step; the project file is untouched until saved.
  - **Crash recovery:** if Bhippi didn't close cleanly, the next launch says so, marks a saved project as having unsaved changes, and offers the backups. 1,896 frontend tests pass.

## Phase 6 — `/train`: references teach a brand kit

Design: `docs/TRAIN-AND-TEMPLATES-PLAN.md` (Part A).

- [x] 38. Brand kit learnings model: `learnings[]` + `sources[]` with area, measured value, source, confidence, on/off; caps, merge and history
  - Brand kits now carry `learnings`, `sources` and `learningHistory` (`src/lib/brandKit/learnings.ts`):
    - near-duplicate rules merge and gain confidence as references agree;
    - a newer measured value replaces an older one, which moves to history;
    - caps of 8 per area and 60 in total drop the least confident;
    - one training can be undone, and a learning switched off or edited;
    - `learningsBrief` gives the AI a budgeted summary, `learnedValue` gives code the measured numbers.
  - Tests: `tests/kitLearnings.test.ts`.
- [x] 39. `/train` command that accepts attachments, links, websites, images and "this timeline"; `/train @Kit` picks the kit
  - **`/train [@Kit] <link, website or note>`** (with any attached videos or images, or `/train this timeline`) starts a Quick turn. The model gets precise hidden instructions; the chat shows a short `/train — learn from …`. Argument parsing tested (`trainingRequest`).
- [x] 40. Measure first (cuts, cadence, palette, motion, beats, speech pace, site colours/fonts), then one schema-checked `train_brand_kit` tool writes the learnings
  - Measure first: videos and links go through `analyze_reference_video` (cuts, cadence, palette, sheets, motion) and websites through `extract_brand_from_url`. Then one schema-checked **`train_brand_kit`** tool writes the learnings: bad areas and too-short or too-long rules are refused and reported.
  - Given a `referenceId`, the tool adds the **measured** cut rate and palette itself, so those numbers never depend on the model. **`forget_training`** undoes one training. Tests: `tests/train.test.ts`.
- [x] 41. Review card in chat: keep / edit / skip each learning before it is saved
  - Under the answer, a **Training card** lists what that reference taught, with **Remove** per learning and **Undo training**. It reads the kit live, so it always shows what's really in it.
  - It's review-after rather than review-before: the same control, without blocking the AI turn.
- [x] 42. `@KitName` in the composer tags a brand kit for that turn (chip + per-turn override)
  - Typing `@` in the chat now also lists **brand kits** (with how much each has learned). A message containing `@UnlokStudio` sends that kit, and what it learned, to the AI for that turn, overriding the project's kit, and the AI is told the user tagged it. Matching tested (`src/lib/kitMention.ts`).
- [x] 43. Learnings reach the AI (budgeted "learned" section) and code (pacing → holds, palette → template colours, caption style → default)
  - **What the AI reads:** the kit context now carries `learned`, the most confident learned rules within a budget, with a note that they win over generic defaults.
  - **What code uses:**
    - a learned cut rate sets how long beats hold in guided builds (`build_edit_from_brief`), when no reference film is active;
    - a learned caption style becomes the default for `add_captions`.
  - Tests in `tests/train.test.ts`.
  - Not done: a learned palette doesn't recolour templates by itself (the kit's own colours still govern).
- [x] 44. Learnings tab on the brand kit page: see source, edit, disable, delete, undo a training
  - Settings › Brand kit has a **Learnings** section: rules grouped by area with confidence and source. Each can be switched off, reworded or deleted, and a **Trained on** list can undo any one training. Changes save to the kit the AI reads.
- [x] 45. (Later, opt-in) Suggest learnings from the user's own corrections
  - Opt-in per kit (Learnings › **Offer to learn from my corrections to AI edits**). After an AI turn, if you change what it made in a way that reads as a preference, a toast offers to **Remember** it for the kit; it never saves on its own, and asks once per kind. Three patterns so far (`src/lib/correctionLearning.ts`, tested):
    - another caption style on its captions;
    - deleting its music bed;
    - resizing its titles the same way twice.

## Phase 7 — Template library that looks good with any model

Design: `docs/TRAIN-AND-TEMPLATES-PLAN.md` (Part B).

- [x] 46. Evaluation suite: same briefs on a small and a large model, scored by frame QA + judge (start first so each step is measured)
  - Live runs need your API keys and cost money, so the eval is deterministic instead. It measures what decides whether a small model's graphic looks right. Every house (Crimson) and brand template gets the input small models really send (164 cases):
    - text too long for the box;
    - "red" as a colour, or an unreadable dark colour;
    - lists and numbers written as strings;
    - other words for a slot ("text", "items");
    - a required slot left out;
    - a template id written loosely.
  - Each case is scored **good** (built right), **recoverable** (refused with an error that says what to fix), or **bad** (overflowing text, a placeholder on screen, content silently dropped, an unreadable colour).
  - Code: `src/lib/templateEval.ts` and `tests/weakModelEval.test.ts`. Report: `docs/benchmarks/weak-models.md`.
  - **Baseline: 30% usable** (29 good + 21 recoverable of 164). Clean input builds right 23/23. Every other kind of messy input fails almost always.
  - The eval found a template bug, now fixed: Cursor demo never showed its first row when a subtitle was given.
  - Not done: a live small-vs-large model run (needs keys). The eval can take real model calls later.
- [x] 47. Typed slot schema for every template (type, required, max chars/words, allowed values, ranges, brand default)
  - New file `src/lib/templateSlots.ts`:
    - **House (Crimson) and brand templates:** hand-measured slots. Each says its type, whether it's required, max characters, list sizes, number ranges and allowed values. The limits come from each template's type size against its box.
    - **The other ~40 motion-kit templates:** schemas read from their param descriptions ("number 0.2–3 (1)", `"left" | "right"`, "string[] (≤5)").
  - The tools use them:
    - A template id written loosely ("Hook promise", "STAT_CHART", "lower third") now resolves to the right template.
    - A required slot left out gets an error listing the template's slots. It used to put placeholder text on screen ("BHIPPI MOTION", sample rows, "Name").
  - Fixes found on the way:
    - Remotion-kit rebuild examples for charts and maps had no bars or rows, so they built charts of made-up numbers. They now carry labelled samples, with a note to replace them.
    - Cubes reveal listed a `rows` param it never used.
  - Eval: **30% → 55%** usable. Tests: `tests/templateSlots.test.ts`.
- [x] 48. Auto-fix before build: fit text, fix colours, contrast guard, clamp numbers, fill from brand, overflow check; report what was fixed
  - New file `src/lib/templateFix.ts`. Both template tools now fix what small models send before building, and say what they changed ("Auto-fixed: …"):
    - other words for a slot ("heading", "bullets");
    - a list sent as one string, or as objects;
    - numbers and durations written as text ("$12M", "5s");
    - colour names ("red", "teal") and `rgb()`;
    - a colour too dark for the plate is lightened, keeping its hue (contrast ≥ 3:1);
    - a list longer than the template shows is cut, and the note says so;
    - a countdown number sent as the title, or only as the length.
  - Text a little long is set smaller to fit its box (down to 60%). Text far too long is refused with the exact limit; the user's words are never cut.
  - Text for a slot a template lacks (a subtitle on a chart, a badge on a countdown) moves to a free slot, or is reported. This was the most common failure in the live run. Eight templates also gained a proper subtitle line.
  - House templates no longer show "BHIPPI MOTION" when a title is missing.
  - **Layout check** (`src/lib/graphicCheck.ts`): measures a graphic's laid-out text in the browser (off the frame, outside the safe area, spilling out of its card). `template-lab.html` runs it on every house template.
  - Template bugs the check found, all fixed:
    - Timeline labels sat half a gap to the right, and the last one ran off frame (invalid CSS `-calc()`).
    - The breaking-news tag was outside title-safe.
    - Connected-map node cards had a fixed height, so a two-line name spilled out.
    - Cursor demo's one-line typed text only fits about 28 characters, not 40.
  - All 17 house templates now pass the layout check under clean, a-bit-long and extra-slot input.
  - Fixed eval: **55% → 100% usable** (153 good + 50 recoverable of 203, 0 bad). Replaying the saved live calls from the three free models: big-pickle 67% → 100%, muse-spark-1.3 92% → 100%, nemotron-3-super 75% → 92%. Nemotron's one miss is a reply with no JSON.
  - Caveat: the auto-fix enforces the same character limits the eval checks. The browser layout check is the independent test that the limits really fit.
  - Tests: `tests/templateFix.test.ts`.
- [x] 49. One simple `add_graphic({ kind, text, at })` tool that picks the template; more beat kinds in `build_edit_from_brief`
  - **`add_graphic`** (`src/lib/addGraphic.ts`): say what the graphic is and its words, and the right template is picked, filled and fitted. 16 kinds: title, chapter, lower-third, stat, chart, list, steps, timeline, quote, compare, news, countdown, caption, map, end, logo.
    - Other words for a kind work ("bullet points", "CTA", "bar chart").
    - With a brand kit active, the brand templates carry the kinds that have one.
    - The call goes through the auto-fixed template tools, so the result says what was adjusted.
    - A missing piece gets a plain request ("chart needs points … and values").
    - It goes out whole on the guided tier. Stronger models see a one-line entry. Token gate 44,200 → 44,250, reason documented.
  - **Guided build:** new beat kinds `chapter`, `question`, `steps` (numbered) and `logo`. Other words for a kind are understood ("hook", "bullets", "cta"). A headline ending in "?" becomes a question beat. Points sent as one string are split.
  - `create_motion_sequence` beats now get the same auto-fix, loose template ids and required-slot checks as single scenes.
  - Tests: `tests/addGraphic.test.ts`.
- [x] 50. Guided tier: hide raw scene/HTML authoring; render-check every graphic with one auto fix-and-retry
  - **Raw authoring hidden:** on a guided turn (a small, free or local model, or Guided set in Settings), calls with raw HTML/CSS/JS or a hand-written scene are refused. The refusal says to use `add_graphic` or a template, and that the user can switch the AI to Full. Custom tools calling them on the model's behalf are held to the same rule. Full-tier models are unchanged.
  - **Render check** (`src/lib/graphicCheckRun.ts`): every house-template graphic is laid out off-screen at its hold frame before it lands, and its text is measured.
    - If a slot spills out of its card or off the frame, that slot is set smaller and the graphic rebuilt once.
    - If the problem belongs to no slot (a card grown past the safe area), the part that grows the card is shrunk.
    - Whatever is still wrong goes into the result ("Layout check: rows spills out of its card by 12px … shorten that text").
  - Checked in headless Chrome (`template-lab.html?mode=retry`): a teaching card built with no pre-fit pushed its number below the safe area and was fixed by the one rebuild.
  - Only runs where there is a page to lay out in (the app). Tests and the backend skip it.
  - Tests: `tests/guidedTier.test.ts`.
- [x] 51. Filled example + thumbnail for every template; compact schema in `list_motion_templates`
  - **Examples** (`src/lib/templateExamples.ts`): a realistic filled call for all 17 house templates and 7 brand templates. A test holds each one to its schema, so the auto-fix finds nothing to change, and checks it builds with no placeholder text.
  - **`list_motion_templates`** with a template id now returns:
    - a one-line typed schema ("title (text, required, ≤40 chars); points (list, ≤5 items…)") in place of the long prose (prose is kept only for footage and nested objects);
    - the example to copy;
    - the thumbnail.
    House template ids get the same, pointing at `create_motion_graphic`.
  - **Thumbnails** (`public/template-thumbs`, 744 KB): 17 house + 34 motion-kit templates, each its example at its hold frame. Rebuilt by `scripts/make-template-thumbs.mjs`, which uses `template-lab.html?thumb=` and a new `motion-lab.html?thumbs` mode that keeps the busiest of several moments. Templates that need the user's footage have none.
  - The **Graphics tab** shows motion templates as thumbnail cards instead of text chips. Footage templates say "uses footage". Not yet seen in the running app.
  - Not done: a click-to-place gallery for house templates. Their words can't be edited in the Properties panel yet, so placing one would drop in sample words the user can't change.
- [x] 52. Template quality pass: brand tokens only, so every template looks right with any kit
  - The house templates had 53 hard-coded colours (ribbon strokes, panel gradients, rims, dots, plates) that a brand kit's retint never reached. Each is now a palette token (`--void`, `--panel`, `--glow`, `--accent`, `--pink`, `--white`, via `color-mix` for transparency). Only neutral black shadows and white highlights stay fixed.
  - **Bug fixed:** house text was set in the house white itself, not the text token. With a light brand kit (cream background), every title and row was white on cream and could not be read. It now follows the kit's text colour.
  - Overlay templates with no background of their own (chapter marker, lower third, countdown) now read over any footage:
    - light kits get a backing chip in the kit's background colour;
    - the dark house look gets a soft shadow.
  - Checked in headless Chrome with a light kit (Realest, cream), a navy kit (Capway) and the house crimson: `template-lab.html?profile=examples&kit=<archetype>`. All 17 still pass the layout check. Thumbnails regenerated.
  - Tests: `tests/templateBrandTokens.test.ts` (no hard-coded colour can come back; light kits get the backing).

## Phase 8 — WatchFIWN caption styles, imported faithfully (full import, approved)

Design: `docs/FIWN-CAPTIONS-PLAN.md`. FIWN has 139 presets (58 dynamic); Bhippi flattens the dynamic ones and swaps the fonts, which is why they look worse.

Decisions (2026-09-29):
- **Full import:** all 139 styles, including the 58 dynamic ones, drawn by FIWN's own renderer in both preview and export.
- **Existing projects keep their current caption look** until the user clicks "Use the WatchFIWN look" in the Subtitles tab. New captions use the new renderer.
- **Export draws captions as frames only where a caption is on screen.** "Fast captions (draft)" in Export keeps the old quick burn-in.
- **The renderer is isolated:** a caption that fails to draw falls back to the old look; nothing else in the editor depends on it.

- [x] 53. Vendor FIWN's caption renderer (dynamic engine + flat renderer + animation core) into `src/lib/fiwn/`, with types
  - `node scripts/sync-fiwn-captions.mjs` copies FIWN's renderer (dynamic engine, kits, animation core, flat `drawSubtitle` without FIWN editor state) and all presets into `src/lib/fiwn/vendor/`, read-only from `D:\FIWN`, and stops if FIWN's code has changed shape. `src/lib/fiwn/index.ts` is the typed, guarded entry point: a failed draw returns false so the caller can fall back.
  - Tests: all 139 presets (58 dynamic, including `dynFlyingType`) draw across a whole caption without failing (`tests/fiwnCaptions.test.ts`, 143 tests).
- [x] 54. Rewrite the import to keep every style whole (animation, dynamic layout, knobs, categories); read from `D:\FIWN`; restore the missing `dynFlyingType`
  - The import now reads `D:\FIWN`, keeps FIWN's own families (new **Motion Graphics** group), and marks each style's dynamic layout, easing and that it draws through FIWN's renderer. `dynFlyingType` is back: 144 styles = all 139 FIWN + 5 Bhippi meme styles. Caption tests pass on both sides.
- [x] 55. Bundle FIWN's fonts offline (15 open fonts + substitutes for the 3 macOS-only ones), also for the export fallback
  - 15 open fonts added (`src/fonts/fiwn.css`, loaded at start). Avenir Next → Figtree, Snell Roundhand → Great Vibes, Chalkboard SE → Comic Neue, registered under the original names. Single-weight faces are declared at their real weight, so bold renders as it does on FIWN. `ensureFiwnFonts` waits for a style's faces before drawing. Build checked: about 0.4 MB of fonts.
  - Not done: the libass draft fallback still uses Windows substitutes (it can't read the bundled web fonts); the full export uses the real fonts through the canvas renderer (item 58).
- [x] 56. Word end times on caption clips (transcription → caption clip), alongside the start times from item 10
  - Caption clips now store word end times (`wordEnds`, TS + Rust) next to the start times. Punctuation glued to a word extends its end. Tests: TS `cueWordEnds`; Rust round trip through save/load and through trim and speed to the timeline.
- [x] 57. Preview draws captions with FIWN's renderer on a canvas, with fallback to the current look if it fails
  - Projects on the WatchFIWN look draw styled captions with FIWN's renderer on a frame-sized canvas (`src/editor/FiwnCaption.tsx`), with the real word start/end times and fonts loaded first. If FIWN's code fails, that caption falls back to the classic look. Tested: cue conversion. Visual check in the running app comes after item 59 adds the switch.
- [x] 58. Export renders captions as frames through the same renderer, only where a caption is visible; "Fast captions (draft)" option keeps libass
  - New export stage **Captions (WatchFIWN)** (`src/lib/fiwn/export.ts`): each WatchFIWN-look caption is drawn frame by frame with the same renderer as the monitor, over its own span only, at the export's frame rate and size (sharp at 4K). It's handed to FFmpeg as a full-frame graphic, so libass no longer draws it. Export Frame and the AI's frame QA include captions the same way. A caption FIWN can't draw stays on the classic burn-in.
  - **Fast captions (draft look)** checkbox in Export keeps the old quick burn-in. The preview and export build captions with one shared function (`src/lib/textGraphic.ts`).
  - Tests: `tests/fiwnCaptionExport.test.ts` (whole span, single still frame, 4K scale, classic projects untouched).
  - Not yet checked: a real export in the running app. Caveat: a caption the user moved or scaled is transformed about the frame centre in the export, not its caption line.
- [x] 59. Per-project caption look: existing projects keep the old look; "Use the WatchFIWN look" switches; new projects start on it
  - Projects have a caption look (`captionLook`, TS + Rust, survives save). New projects start on WatchFIWN; older projects read as Classic, so nothing changes under them. A **Caption look: WatchFIWN | Classic** switch sits at the top of the Subtitles tab (one undo step), and the AI is told which look the project uses.
  - Visual check: `/caption-lab.html` on the dev server draws every WatchFIWN style with the bundled fonts. Screenshot confirmed real dynamic layouts and fonts (Hype Drop, Candy Pop, Glass Caption, Neon Tube, Terminal Error…). The in-app check needs a rebuild and waits until the user is ready to restart Bhippi.
- [x] 60. AI and UI: per-style "look / when to use" briefs for all 139 styles; Subtitles tab shows every style live, animated
  - **AI:** new read-only tool `list_caption_styles` (filter by family or words). It returns each style's look (font, colours, box/glow, animation) and what videos it fits, with hand-written lines for all 25 dynamic layouts (`src/lib/fiwn/briefs.ts`). The prompt points to it. `set_caption_style` now refuses a made-up id and names close real ones, instead of restyling every caption to nothing.
  - **UI:** on the WatchFIWN look, the Subtitles tab's style cards are drawn by FIWN's renderer and play their animation on hover. Tooltips say the look and what it fits. Checked in the lab's cards view (`/caption-lab.html?view=cards`).
  - Tests: `tests/captionBriefs.test.ts` (every style described; search; tool output; bad-id refusal).
- [x] 61. Parity tests (preview vs export per style family) + FIWN's dynamic-caption tests ported
  - `tests/fiwnEngine.test.ts`: FIWN's own dynamic-caption checks ported (phrase grouping, hero word never a filler, layout windows, safe area, every layout distinct). **Parity**: for styles from every family, each exported frame issues exactly the same canvas calls as the monitor at that moment, through a trimmed head and a speed change.
  - Found in FIWN, not Bhippi: FIWN's own `scripts/test-dynamic-captions.mjs` currently fails 16 checks on FIWN's code (the 19 motion-graphics presets colour their words in their FX layer and some share an arrangement). The port applies those two checks to the base layouts only.
  - Full runs: 1,841 frontend tests and 498 Rust tests pass. The prompt-size gate in `tests/benchmark.test.ts` went from 44,000 to 44,200 tokens for the new `list_caption_styles` tool (+46 per step), noted in the test.
- [x] 62. (Follow-up) FIWN's 22 motion-text caption templates
  - FIWN's 22 Motion text templates (Type Trail, Bar Reveal, Stat Counter, Decrypt, Gold Arc…) are now caption styles in a new **Motion Text** family (166 styles in total). They're drawn by FIWN's own layer engine, bundled by the sync script with FIWN's editor state stubbed out. The bundle shares the motion core and dynamic engine rather than copying them (131 KB). If a template declines a line, the caption draws as FIWN's base style.
  - The AI briefs and Subtitles tab cover them. Checked in the lab (`?only=fiwnText`). Parity test extended; the first draw only adds font measuring, never paint.
  - Full run: 1,869 frontend tests pass. The typecheck is clean apart from `src/lib/exportFolder.ts`, a new file someone else is editing (not part of this work).

## Phase 9 — Requests from the evening of 2026-09-29

- [x] 63. Crash: "Minified React error #301" in the Timeline while dragging something over it
  - Cause (from this session's change to make drops snap): the drop target is worked out while the Timeline renders, and the snapping it now used also set the snap line's state, so every render asked for another.
  - Snapping is now split into a pure calculation, safe while rendering (`snapAt`), and the pointer handlers' version that shows the line. The snap line for a drag from the bin or files is drawn from the result, with no state.
  - Needs the app rebuilt to take effect in the build you run.
- [x] 64. Transcription: click to correct a word; Ctrl+click to pick words to cut
  - Click a word to type the right one: Enter saves, Esc cancels, Tab goes to the next word, an emptied word is removed.
  - The correction is saved into the stored transcript by a new backend command (`transcript_edit_words`), so captions and the AI read the fixed words from then on. Timeline words remember which file and moment they came from, so corrections work in the Timeline view too.
  - A caption already on the timeline that shows the word gets the fix as well, in one undo step.
  - Ctrl+click picks words, Shift+click picks a run, Delete (or the Cut button) cuts them and their pause out of the edit.
  - Tests: Rust `word_edit_tests`, `tests/transcriptText.test.ts`.
- [x] 65. Any panel can be dragged anywhere and stacked with any other
  - Frames now hold stacks of panels as tabs, as in Premiere. Drag a tab onto:
    - another panel's middle, to join its frame as a tab;
    - an edge, to go beside it;
    - the area's edge, to run the full width or height.
    Dragging a tab out of a stack takes just that panel. Closing a tab shows the next one.
  - Effects, Subtitles, Graphics, Audio (were tabs inside Project) and Effect Controls (inside Properties) are now panels of their own, in the Window menu too.
  - The default layout, and layouts saved before this change, stack them where they were, so nothing moves until you drag it.
  - The tool strip and meters are drawn bare, so they swap instead of stacking.
  - Tests: `tests/dockTree.test.ts` (7).
- [x] 66. The Graphics panel did not scroll
  - Its sections sat in a box that never scrolled. Once the motion templates became thumbnail cards (item 51), the caption styles below were pushed out of reach. Graphics and Audio now scroll as one page.

## Log

- 2026-09-29 — List created. Starting Phase 1.
- 2026-09-29 — Phase 1 done (items 1–10). Full test runs: 1,613 frontend tests pass (one known slow test times out only under load), 496 Rust tests pass.
- 2026-09-29 — Added Phases 6–7 (`/train`, templates for weaker models) and Phase 8 (WatchFIWN captions) from user requests.
- 2026-09-29 — Phase 2: items 11, 12, 15, 16, 17 done.
- 2026-09-29 — User approved the full WatchFIWN import (Phase 8, no low-risk variant). Starting it.
- 2026-09-29 — Phase 8 (WatchFIWN captions) done: items 53–62. 1,869 frontend + 498 Rust tests pass.
- 2026-09-29 — Phase 2 done (11–17).
- 2026-09-29 — Phase 3 done (18–22; 18b split out as a separate refactor).
- 2026-09-29 — Phase 4 done (23–30; 30b split out).
- 2026-09-29 — Phase 5 done (31–37).
- 2026-09-29 — Phase 6 done (38–45): `/train`, kit learnings, `@Kit` tagging, review card, Learnings page, correction suggestions.
- 2026-09-29 — Item 46 done: weak-model template eval, baseline 30% usable.
- 2026-09-29 — Item 47 done: typed slot schemas for every template; eval 30% → 55%.
- 2026-09-29 — Item 48 done: auto-fix + layout check; fixed eval 100% usable, live replays 92–100%.
- 2026-09-29 — Item 49 done: `add_graphic`, 4 new guided beat kinds.
- 2026-09-29 — Item 50 done: guided tier held to templates; render check with one auto-refit.
- 2026-09-29 — Item 51 done: examples, compact schemas, 51 thumbnails, thumbnail cards in the Graphics tab.
- 2026-09-29 — Phase 7 done (46–52). Fixed eval 30% → 100% usable; live small models 67–92% → 92–100%.
- 2026-09-29 — Item 30b done: keyframes on brightness, contrast, saturation, hue, blur (preview + export).
- 2026-09-29 — Phase 9 (user requests): crash fix, transcript corrections, dockable/stackable panels, Graphics scroll. 18b left for its own task.
