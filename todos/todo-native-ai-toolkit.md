# Todo: Native AI toolkit, phase by phase

Plan: docs/plans/NATIVE-AI-TOOLKIT-PLAN.md. Code is built in a separate worktree
(D:\Bhippi-toolkit, branch `native-ai-toolkit`) so the running dev server and the film-lab
agents capturing it are not disturbed; it is merged into main when a phase is done and tested.

Legend: [ ] to do · [~] in progress · [x] done

Rule from you (applies to every phase): the toolkit is offered, never forced. Strong models keep full
freedom (raw scenes, their own renderer, their own ideas); recipes and templates vary with the
reference's style so films never come out the same.

## Phase 0: keep weaker models safe ✅ (commit on native-ai-toolkit)
- [x] 0.1 A guided model is refused a `render` scene, with the template alternative (src/lib/modelProfile.ts `guidedRefusal`); strong models keep it
- [x] 0.2 A guided model is never paused for going outside a Quick edit's scope (src/lib/editWorkflow.ts `scopeGate`, tier passed from App.tsx)
- [x] 0.3 The composer suggests more thinking effort (Max when offered) when a video is asked for at Low or Medium; a suggestion with a one-click button, nothing changes on its own (src/lib/workflowRoute.ts `filmEffortHint`, ChatPanel)
- [x] Tests: 35 passed (new: render refusal, guided scope, effort hint); type check clean

## Phase 1: see and hear ✅
- [x] 1.1 `analyze_song` (commit 41877f5): beats, bars, phrases, drops, hits, your lyrics with a time for every word, lines, sections, cut points; saved as a research note. New `vocal.rs` pulls the lead vocal out before transcription so sung lines are heard. On the real "Meet Bhippi" song: 98.95 BPM, verse 1 on the 16.80 s drop (hand-measured 16.815), "Meet" at 33.79 (34.05). Review fix 1034740: lyrics in every script are words (a Hindi lyric was dropped whole); c936b17: not a read-only tool, since it saves on the plan
- [x] 1.2 `review_frames` (commit 5b47cfe): frames at every cut, graphic landing, sound cue, marker and the last frame, plus 6-frame strips 0.06 s apart across the joins, tiled into contact sheets; measured checks: murky frames, the same phrase twice, cuts off the beat, cues buried under the music, a rushed end card, reading size. 9 tests; full suite 1997 passed
- [x] Tests for 1.1: 10 song-map tests, 4 Rust vocal tests, full suite 1987 passed (the only other failure is a line-ending artifact of the worktree checkout, passes in main)

## Phase 2: the real product, alive ✅ (commit 9d4ca4e; demo media pack merged in 1832c4c)
- [x] 2.1 `capture_app_session`: own DevTools client (cdp.rs) drives headless Chrome/Edge; Bhippi's real UI boots on a backend stand-in; steps click, hover, type (captured per character), key, wait, eval, capture; every part checked for resolution (the 1x bug) and fonts (the serif fallback); clips follow the page scroll. Named parts @composer @field @send @pills @menu @chat @messages @timeline @program @source @project. End to end on the real UI: no page errors, composer typing + send + pills + timeline at 3x in 3.4 s. Review fix 46e0886: the file server now runs only for Bhippi's own interface and only its origin may read it (it answered any page with `*`)
- [x] 2.2 Demo mode: the stand-in answers from your real app state (providers, settings, library, open project), with onboarding, tour and updates switched off
- [x] 2.2b Demo media pack for an empty library (merge 1832c4c, tk/demo-media): FFmpeg makes seven pieces on demand (four clips, a still, a mark PNG, a 20 s 96 bpm bed, ~920 KB, nothing in git), each derived like a real import; `capture_app_session {demo:true}` fills only an empty timeline, bin or chat with a 20 s demo edit cut on the bars. 15 demoProject tests, 3 Rust demo_pack tests (one through real FFmpeg)
- [x] 2.3 Part library: an identical session (same app version, steps, size, scale) is reused instantly from AI Work/ui-parts/<name>
- [x] Tests: 8 capture tests incl. 4 driving a real browser (states differ, exact 3x size, scroll-safe crops, missing element named); backend 393 passed; frontend all passing (two tests time out only under full machine load, pass alone)

## Phase 3: engine: parts in 3D, part camera, cursors, blur ✅ (merge 1cd8199, tk/engine-demo)
- [x] 3.1 UI parts as 3D layers (a window null holding every captured part as its own footage layer; coplanar layers keep stack order, parallel planes sort by distance; mipmaps for stills)
- [x] 3.2 Camera that targets a part (one-node camera at a fill fraction, log-space dolly without overshoot, focus follows, tilted pull-back; close-ups slide toward the window's inside, `centre: true` for the literal framing)
- [x] 3.3 Named cursors with click rings (you, bhippi, claude, gpt, gemini, local or custom; 0.25 arcs, 14% press dip, 16 to 86 px ring, constant screen size)
- [x] 3.4 Adaptive motion blur (per-stretch samples 2 to 48 from the measured streak, half-float accumulation), per-layer shutter
- [x] 3.5 Per-part states + `set` action (clicks show the pressed state 0.2 s, typing word by word from the capture's `typed` text)
- [x] Tool `create_product_demo` (layered [Motion] comp with SFX, rebuilds from its params) and templates product-demo / window-explode
- [x] Tests: productDemo 20, productDemoTool 5, motionAdaptiveBlur 8; Rust app_capture 7 (incl. per-character typing in a real browser)

## Phase 4: ready-made scenes (mostly done; ask-and-work and timeline-build still to build)
- [x] product-demo · window-explode (merge 1cd8199, tk/engine-demo)
- [x] type-on-voice · fly-through-word · logo-lockup · end-card · kinetic pieces (word-land, label-pill, slam-tilt, whip-pan, match-grow) (merge 782ca1d, tk/kinetic; engine: per-character type `times`, rich spans, gliding re-centre)
- [x] connect-hub · glass-mark · joins (camera-match, glow-handoff, flash-bridge) · finish presets (launch-dark, launch-light as one editable Finish layer via `update_motion_scene {finish}`) (merge 65572d1, tk/joins-finish)
- [ ] ask-and-work · timeline-build
- [x] 4.x Render scenes (a strong model's own renderer) delivered in passes (backdrop, UI, text, cursor) as separate transparent layers, so they stay editable (merge c7cf3cf, tk/render-passes): `attach_production_asset {passes}` reads a passes manifest, unpacks alpha videos (ProRes 4444, WebM via libvpx) to PNG runs with the new `render_pass_frames` command, and files a layered "[Motion] … passes" comp, one track per pass; a flat render still attaches by assetId
- [x] Tests: motionKitKinetic 43, motionTyping +4, templateExamples +1, motionJoins 8, motionFinish 7, filmTemplates 11, renderPasses 11; Rust render_passes 5

## Phase 5: sound follows the picture
- [x] 5.1 Auto-sound on motion cues, relative to the song's loudness (merge e633bae, tk/sound): `sound_the_motion` places every cue's sound with its loudest 10 ms ~6 dB under the music's at that moment, never clipping (capped cues named with the fix); re-levels instead of doubling; layered comps keep their scene's cues. Review fix 28aec2f: a `swap` re-sounds the laid cue instead of doubling it, `skip` silences it, a laid riser is trimmed onto its hit
- [x] 5.2 UI sound set: key_click, send_pop, soft_whoosh, glass_tick, cursor_tap as procedural built-ins
- [x] 5.3 Final mix -16 LUFS / -1 dBTP: `mix_loudness` measures the soundtrack as the export renders it; review_frames checks it by default and judge_edit's audio seat gets the findings
- [x] Tests: cueSound 15, sfxLibrary updated (24 kinds); Rust UI-set and loudest-table tests plus an end-to-end FFmpeg mix test

## Phase 6: one-call recipes for smaller models ✅ (merge 28b6360, tk/recipes)
- [x] launch-film · product-demo · identity-film · kinetic-explainer · fluid-saas recipes in the guided build: src/lib/filmRecipes.ts plans a film from words and moments (hook, statement, demo, feature, explode, connect, fly, logo, end), the same every time; cuts on the song's bars (or the recipe's tempo), sung words timed into the templates, the drop on a cut or a slam, joins and finish per recipe; films vary by style.variant, stage, palette and cadence. `build_edit_from_brief {recipe}` chains capture → analyze_song → one layered "[Motion]" comp → song or score → sound_the_motion → finish layer → review_frames with safe fixes only → storyboard; a failed step is named and the film still lands. GUIDED_BRIEF names the recipes (and, since c3913f3, says the one call replaces building a premium film scene by scene; since 972564b, that `capture` shows the real app); nothing added for frontier models. Review fix a3f3064: `logo` (default the brand kit's); Bhippi's mark, cursor and name only in a Bhippi film, another product gets its logo or its initial and its own cursor
- [x] Tests: filmRecipes 9, filmRecipeBuild 2 (the whole chain through runTool). Not yet run in the real app (a real capture, a real song, the score, review contact sheets)

## Phase 7: teach and measure (built; the benchmark round is yours to run) (merge 4e82cf0, tk/teach)
- [x] Playbooks, brain skills, prompt text from the learnings: five motion_guide topics (launch-film, product-demo, identity-film, kinetic-explainer, fluid-saas) with shared FILM_TIMING/FILM_RULES and optional `templates` (offered) and `vary`; toolRouter FILM_SIGNALS routes a named film to its playbook; five seed brain skills written once by brain.rs `seed_skills` (a deleted seed stays deleted, a patched one is kept); copilot.md "Premium films" line and the "Living product UI" bullet now on capture_app_session + create_product_demo
- [x] Benchmark kit: docs/benchmark (README procedure, films.json with six films, rubric.md, lyrics input) and scripts/film-bench.ts (plan, record, blind, score; `node scripts/film-bench.ts`, Node ≥ 22.18)
- [ ] Benchmark: rebuild the six films in Bhippi with three models (round 0 needs you: the real app, three models, critic sessions)
- [x] Tests: motionDirection 5, toolRouter +1, filmBench 9, Rust brain +2 (seeds)

## Review ✅ (docs/plans/NATIVE-AI-TOOLKIT-REVIEW.md; branch head 7021070)
- [x] Adversarial review of the whole branch: 12 fixes, each its own commit on native-ai-toolkit: the capture file server (46e0886), render-pass unpack deleting a folder (df8c9aa), 180 s timeouts on the long toolkit calls (38a7a04), sound_the_motion swap/skip/riser (28aec2f), non-Latin lyrics (1034740), analyze_song permission (c936b17), film routing on ordinary words (58ba77c), finish lost on inspector rebuilds (b5f85fa), guided brief on capture (972564b), recipe films branded as Bhippi for other products (a3f3064), playbook wording on render passes (6c34695), slim entries cut mid-word (0fac0c6, test 7021070)
- [x] Tests: tsc clean; full vitest 2183 passed, 2 skipped, 0 failed (216 files, 1 skipped); Rust 410 passed, 0 failed, 19 ignored
- [x] Verdict: ready to merge after you commit the main folder's own uncommitted work (8 files overlap) and restart the app after merging (new Rust commands and sound kinds); smoke checks for the real app are in the review
- [ ] Real-app smoke run of the recipe chain, a Bhippi capture in dev, and render passes (yours; listed in the review under "Try it")
- [ ] Housekeeping: builder Vite servers on 5231, 5311, 5317 and the folders D:\Bhippi-tk-demo-media, -joins-finish, -kinetic

## Log
- 06:43 Session restarted (the overnight run ended at ~06:05). Resumed the reference lab (crimson done; glass-identity + white-saas building).
- Phase 0 ✅ (06431e1), Phase 1 ✅ (41877f5 analyze_song, 5b47cfe review_frames), all on branch native-ai-toolkit in D:\Bhippi-toolkit. Starting Phase 2.
- 07:17 Phase 2 ✅ (9d4ca4e capture_app_session). Restarted the dev server on 5199 (it was down after the restart; the film agents use it).
- 07:25 You asked to finish with multiple agents: run wf_4891f337-0b6 started. Six builders in parallel (A engine + product demo, B kinetic templates, C joins/finish/glass/hub, D render passes, E sound, F demo media), each in its own worktree D:/Bhippi-tk-<name> on branch tk/<name>; then an integrator merges into native-ai-toolkit; then G recipes + H teaching; then a final integration and an adversarial review (docs/plans/NATIVE-AI-TOOLKIT-REVIEW.md). The integrators tick this list as phases land.
- 11:15 Integrated the six builders into native-ai-toolkit, in order: tk/engine-demo (1cd8199), tk/kinetic (782ca1d), tk/joins-finish (65572d1), tk/render-passes (c7cf3cf), tk/sound (e633bae), tk/demo-media (1832c4c, head). Conflicts were additive (template lists, MOTION_TOOLS, lib.rs modules and commands, imports, the capture reply); the benchmark gate is now 44,575 (worst brief saas-characters-drawn at 44,555: create_product_demo, update_motion_scene finish and the joins, the UI sound enums, sound_the_motion). Full vitest 2154 passed, 2 skipped, 0 failed (213 files); Rust 406 passed, 0 failed, 19 ignored. Phases 3 and 5 and 2.2b done; Phase 4 left with ask-and-work and timeline-build. Builder worktrees removed from git (branches kept); the kinetic, joins-finish and demo-media folders still hold files because their builders' Vite servers (5311, 5317, 5231) were left running.
- 11:58 Integrated tk/recipes (28b6360) and tk/teach (4e82cf0) into native-ai-toolkit; both merged clean. Then c3913f3 (head): the guided brief now says a premium film is the one build_edit_from_brief {recipe} call, since teach's new copilot.md line says to build scene by scene (frontier prompts unchanged). Benchmark gate 44,650 (worst brief saas-characters-drawn at 44,626; the raise is teach's "Premium films" line, recipes add nothing per step). Full vitest 2176 passed, 2 skipped, 0 failed (216 files, 1 skipped); Rust 408 passed, 0 failed, 19 ignored. Phases 6 and 7 built; the benchmark round and real-app runs of the recipe chain are still to do. Builder worktrees tk/recipes and tk/teach removed (branches kept).
- 12:50 Adversarial review done (docs/plans/NATIVE-AI-TOOLKIT-REVIEW.md). 12 fixes committed on native-ai-toolkit (46e0886 … 0fac0c6, plus test 7021070), each pinned by a test except the timeout list, the inspector rebuild and the playbook wording. Full vitest 2183 passed, 2 skipped, 0 failed; Rust 410 passed, 0 failed, 19 ignored; tsc clean. Ready to merge once the main folder's uncommitted work is committed; restart the app after the merge.
- 14:18 You said to stop at three reference films to save time: apple-launch and fluid-saas are skipped. The lab (run wf_548b8c3d-e1f) is finishing glass-identity (v2 rendered; re-checking, then harvest) and white-saas (critique, v2, harvest), then writes docs/plans/MOTION-ENGINE-MASTER-PLAN.md (built on the toolkit already done) and Film lab\Renders\README.md.
- 14:26 You said no more second versions: the lab is stopped (white-saas stays at v1, glass-identity v2 stays unscored). One agent is now writing docs/plans/MOTION-ENGINE-MASTER-PLAN.md and Film lab\Renders\README.md from what exists.
- 14:50 Master plan done: docs/plans/MOTION-ENGINE-MASTER-PLAN.md (8 sections, 105 building blocks: 30 on the toolkit branch, 7 on main, 34 partial, 34 missing) and Film lab\Renders\README.md.
