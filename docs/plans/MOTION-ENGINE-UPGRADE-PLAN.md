# Motion engine upgrade plan: launch films as editable layers, for any strong model

Date: 2026-09-30. Status: proposal. No code has been changed.

**Goal.** Bhippi's own engine (`src/motion`) and pipeline should make a product launch film as good as the 80/100 "Meet Bhippi" film, and as good as its 84/100 15-second rebuild, **as editable layers**. It should do this for any strong model, in one normal production run. Today the same brief through Bhippi's pipeline scored **10/100**.

**Evidence** (details and numbers in `docs/research/launch-film-learnings.md`):

| Tag | Source |
|---|---|
| [Study] | `docs/research/opus-launch-film-study.md`: how the 80/100 film was built |
| [Walk] | `docs/research/opus-launch-film-walkthrough.md`: the run step by step, loops, mistakes, time split |
| [Audit] | `docs/research/motion-engine-audit.md`: the engine today, gaps G1–G15 |
| [15s] | `C:\Users\aayus\Documents\Bhippi\Film lab\bhippi-15s\BUILD_NOTES.md`: the independent 15 s film (v1, v2) |
| [C1], [C2] | `...\bhippi-15s\critique-round1.md` (76 vs 77), `critique-round2.md` (84 vs 77) |
| [Crimson] | `docs/research/film-lab/crimson-explainer.md`: a parallel 15 s film and its 44-block catalogue |
| [Learn] | `docs/research/launch-film-learnings.md`: the recipe, and drafts for the playbook, skill and prompt |

---

## 0. Why the pipeline scored 10 and the free runs scored 80 and 84

The engine itself is not the bottleneck. It renders a tilted UI plane under a moving camera with depth of field and 16-sample motion blur in 26–44 ms a frame at 1080p [Audit §1.7], and a 15 s film exports in under a minute. What differs is what the model fed it, and how it worked:

| # | Cause | 80/84 runs | 10/100 run | Items that fix it |
|---|---|---|---|---|
| C1 | **No real product in states** | 328 part textures at 4x from the app's CSS, one per state [Study §2.2]; or the live React UI staged in Chrome [15s §2] | 10 still PNG plates | U0.1, U1.1–U1.4 |
| C2 | **No camera through the product** | Keyed `[x, y, s, rx, ry]` camera, close → pull-back → tilted window, exploded panels [Study §3.5–3.6] | Templates: 0 product-demo templates, 0 with DOF, 3 with a camera [Audit §1.6] | U2.1–U2.5, U3.x |
| C3 | **No word-level sync** | Vocal isolated, word onsets measured; every hero action on a word, cuts on bars [Study §4] | Template slots on phrase times | U5.1–U5.2, U3.x |
| C4 | **No render-look-fix loop** | 36 contact sheets, 59 image reads, about one fix per scene [Walk §8]; one scored critique = +8 [C2] | Structural QA only; `judge_edit` has no measure of light, reading size or sync (`src/lib/judge.ts`) | U0.3, U0.5 |
| C5 | **No time or budget to do it** | Max effort, one turn of 96 min wall [Walk §0]; ignored an "Over budget" note at 206 M tokens [Walk step 1] | Medium effort; gather in about a minute; 3 M-token soft budget (`src/lib/tokenLedger.ts:13`) that tells the model to stop | U0.2 |
| C6 | **Stills stood in for scenes** | Every scene an animated render | Still plates on the timeline | U0.1 |
| C7 | **Recipes live in the model's head** | 1,800 lines of scene code [Study §0]; Crimson 4,450 lines [Crimson §0] | A weaker plan cannot reach them through template slots | U3.x, U0.4 |

The plan closes C4–C6 first, because they are cheap and a strong model can already do a lot with the engine when it is asked to look at its frames. Then it gives the engine the three things no model can build inside a Bhippi turn: **the real UI in states (C1), a product camera and cursors (C2), and the recipes as templates (C7)**.

---

## 1. Principles

1. **Editable layers only.** Everything lands in `MotionScene` (`src/motion/types.ts`), so it opens as a layered "[Motion]" comp. No Python renderer, no flat MP4 scenes. The 80/100 film's 23 flat MP4s could not be changed afterwards, and were lost unsaved [Walk §0].
2. **Spec fields, not patches.** `update_ui_screen` rebuilds the scene from its spec and drops layers patched in afterwards [Audit §4]. The camera, cursors, states and finish must be fields of the UI spec or template params.
3. **Measure, never guess.** Part boxes come from the DOM, action times from the beat map, focus from the camera target, motion-blur samples from screen speed.
4. **Defaults carry the craft.** A model that writes no numbers still gets blur-in entrances, warm shadows, cursor rings, a landing hold and a safe finish.
5. **Pure functions of time.** Any frame renders alone and repeatably. The engine already is one (`evaluate.ts`); UI capture and states must be too.
6. **The loop is part of the tool.** Building a scene returns frames at its event times, so a model that does not think to look still sees them.

---

## 2. Priority list

Size: **S** = up to 3 days, **M** = 1–2 weeks, **L** = 2–4 weeks, for one engineer. Risk is the chance the item slips or causes regressions.

| Rank | Item | Phase | Size | Risk | Depends on | Closes |
|---|---|---|---|---|---|---|
| 1 | U0.1 Motion-first production route (no still scenes) | 0 | M | Low | – | C1, C6 |
| 2 | U0.2 Effort floor and budget profile for launch films | 0 | S | Low | – | C5 |
| 3 | U0.3 Frames at event times, returned by every scene build | 0 | S | Low | – | C4 |
| 4 | U0.5 Measured judge: light, reading size, sync, landings, sound | 0 | M | Medium | U0.3 | C4 |
| 5 | U1.1 `capture_app_session`: DOM-aware capture with part states | 1 | L | Medium | – | C1; G7 |
| 6 | U2.1 UI parts in the scene's 3D space | 2 | M | Medium | – | C2; G1a |
| 7 | U2.2 UI camera with autofocus and a smoothed path | 2 | M | Medium | U2.1 | C2; G2, G4 |
| 8 | U2.3 Named multiplayer cursors | 2 | M | Low | – | C2; G5 |
| 9 | U1.3 Per-part states in `create_ui_screen` | 1 | M | Medium | U1.1 helps | C1; G6 |
| 10 | U0.4 Playbook, skill, prompt, defaults | 0 | S | Low | – | C7 |
| 11 | U2.4 Adaptive motion blur and per-layer shutter | 2 | M | Medium | – | G11 |
| 12 | U2.5 `product-demo` template | 2 | M | Low | U2.1–U2.3 | C2, C7; G8 |
| 13 | U4.1 Cinematic finish presets (light and dark) | 4 | M | Medium | – | G9 |
| 14 | U3.2–U3.8 Launch scene templates | 3 | L | Medium | U1.3, U2.x | C7; G8 |
| 15 | U3.9 Scene joins in sequences | 3 | M | Low | U2.2 | C7 |
| 16 | U5.1 Word timing on songs (lyrics alignment) | 5 | M | Medium | – | C3 |
| 17 | U5.2 Beat map snapping and backbeats | 5 | S | Low | U5.1 | C3 |
| 18 | U5.3 Sound cues relative to the song | 5 | S | Low | – | [C2] fix 4 |
| 19 | U1.2 Bhippi-self staging (the app films itself) | 1 | M | Medium | U1.1 | C1 |
| 20 | U1.4 Resolution tied to camera zoom | 1 | S | Low | U2.2 | [15s §2] |
| 21 | U0.6 Assembly safety fixes | 0 | S | Low | – | [Walk §10] |
| 22 | U4.2–U4.4 Quality ceiling: per-pixel DOF, 16F targets, sheen, contact shadow | 4 | L | High | U2.1 | G3, G10, G14 |
| 23 | U6 Benchmark: rebuild the 15 s film | 6 | S per run | – | all above | – |

---

## 3. Phase 0: process and guidance (weeks 1–2)

The cheapest phase, and the one that attacks the 10/100 result directly. None of it touches the renderer.

### U0.1 Motion-first production route

- **Why.** The 10/100 run treated a motion film like a footage film: GATHER made 10 still plates in about a minute, and EDIT laid template scenes over them (C1, C6). The 80/100 run spent 20% of its time building the UI kit, one texture per state [Walk §1], and every scene was an animated render. Crimson reached the same conclusion: "Show the real product doing the real thing" [Crimson §4.4].
- **What changes.**
  - `src/lib/types.ts`, `src/lib/production.ts`: new `ProductionShot` kinds `ui-capture` (a part list with states) and `beat-map`. `gatherReport` counts them. A `scene` kind for motion-only scenes has no media to gather.
  - `src/lib/editWorkflow.ts`: in a production whose blueprint marks scenes as `motion` (or genre `saas`/`motion` with a song or voice-over and a product), GATHER allows `capture_product_ui` / `capture_app_session`, `create_ui_screen` rasterising, `analyze_clip_speech`, `analyze_music_beats` and `save_beat_sheet`. `finish_gathering` refuses until every storyboard scene's parts and states exist and the beat map is saved.
  - `verify_edit_workflow` (`aiTools.ts`): refuse a motion production when still images cover more than 10% of V1 time while no motion scene covers them (the "still stands in for a scene" check).
  - `src/lib/guidedBuild.ts`: new beat kinds `ui-demo`, `type-on`, `fly-through`, `connect`, `timeline-build`, `explode`, mapped to U3 templates once they exist (to `create_ui_screen` beats until then). Today's `BEAT_KINDS` has no product beat at all.
  - `src-tauri/prompts/copilot.md`: the route text from [Learn §10.3 B].
- **Size** M. **Risk** Low: it adds a route; footage productions keep today's gates.
- **Acceptance test.**
  - Vitest: a blueprint with three motion scenes and a song cannot `finish_gathering` until each scene's `ui-capture` shots and the beat map are attached; a comp whose V1 is 80% PNG stills fails `verify_edit_workflow` with a message naming the still clips.
  - Replay of the 10/100 brief (same model, same effort): GATHER ends with part captures and a beat map, not plates; no still image sits on V1 as a scene.

### U0.2 Effort floor and budget profile for launch films

- **Why.** The 80/100 run was one free turn at max effort. It spent about 55 min on the UI kit, engine and scene loop, and ignored an "Over budget" note (206 M tokens against a 3 M soft budget) [Walk step 1]. The 10/100 run was at medium effort, with a gather phase of about a minute. `tokenLedger.ts:13` sets one budget (3 M) for every video and tells the model "Over budget: no more exploratory reads … stop" (line 68). A compliant model obeys that and never runs the look-fix loop.
- **What changes.**
  - `src/lib/tokenLedger.ts`: budget by production kind: `launch-film` 25 M (the loop needs about 2 renders and reads per scene), explainer 6 M, others 3 M. The advice text keeps "no re-reads of unchanged things" but never says "stop looking at frames".
  - `src/chat/ComposerControls.tsx` and `editing_workflow_status`: when the plan is a launch film, recommend High or Maximum effort in one line with the button; do not force it. `src-tauri/src/harness.rs` `effort()` caps stay as they are.
  - `editWorkflow.ts` phase messages: per-phase time and look budgets for launch films. GATHER: capture every state and check it on a sheet. EDIT: at least one look per scene before the next scene, plus one strip per join.
- **Size** S. **Risk** Low; token cost per launch film rises, which is the point. Show the estimate in the plan summary.
- **Acceptance test.** Vitest: `tokenBudgetFor({kind:'launch-film'})` returns 25 M and advice without "stop". In a replayed launch-film run at High effort, the trace shows at least one `run_frame_qa {times}` (or U0.3 sheet) per scene and no over-budget stop before the last scene.

### U0.3 Frames at event times, returned by every scene build

- **Why.** The loop that made the 80/100 film was: render 4–9 frames at the moments something happens, read them, fix one thing [Walk §8]. Today `inspect_clip_frames` returns up to six keyframes at a stride, and `run_frame_qa` takes explicit `times` but samples evenly by default. Nothing picks the moments that matter. The one defect Opus missed on a sheet (1x-rendered parts) was found only by an automatic scan [Walk §10].
- **What changes.**
  - `src/lib/motionTools.ts` (`create_motion_scene`, `update_motion_scene`) and `uiScreenTools.ts`: after a build, derive **event times** from the scene (key times of camera layers, action times of UI actions, cue times, entrance ends, the first and last 0.1 s) and return a labelled sheet of up to 9 frames rendered by the export renderer at full quality (motion blur on; preview drops it below quality 0.75, `src/editor/MotionLayer.tsx:143`). Off with `sheet: false`.
  - A new `review_frames {clipId|compId, times?, around?, strip?}` tool (`src/lib/aiTools.ts`, `ai-tools.json`): explicit times, or 6-frame strips 0.06 s apart across each cut in a range.
  - Automatic checks on each sheet, reported as text: blank frame, part content under 45% of its texture, text under 26 px cap height, frame luma jump above 2x.
- **Size** S. **Risk** Low; cost is 9 frames (under 0.5 s of GPU) per build.
- **Acceptance test.** Building the audit's demo UI scene with a camera returns 9 frames whose times include every UI action time and every camera key. `review_frames {strip:true}` on a two-scene sequence returns a 6-frame strip across the join. A deliberately tiny part texture is reported.

### U0.4 Playbook, brain skill, prompt text and defaults

- **Why.** Every number the 80/84 films used lives in bespoke code or a critique [Study, 15s, C1, C2]. `motionDirection.ts` has no launch-film playbook; its product playbooks name only `text.type`/`text.counter` [Audit G15]; `saas-explainer.gaps` still says capture "is coming" (`motionDirection.ts:72`).
- **What changes.** Paste the drafts in [Learn §10]:
  - `src/lib/motionDirection.ts`: the `launch-film` playbook, the `saas-explainer`, `product-launch` and `ui-walkthrough` edits. It passes `tests/motionDirection.test.ts` as written. `motion_guide`'s topic list in `ai-tools.json` gains `launch-film`.
  - Brain: seed `launch-film-render-look-fix` into the brain's `skills/` on first run from a bundled file (`src-tauri/src/brain.rs`: a `seed_skills()` beside `skills_dir`, copying from a resources folder only when the skill does not exist, so users' edits survive).
  - `src-tauri/prompts/copilot.md`: bullets A and B from [Learn §10.3].
  - Genre detection (`toolset.genres`): a song or voice-over plus "real UI / launch / product" routes `toolset.playbook` to `launch-film`.
- **Size** S. **Risk** Low. Update the `gaps` lines as later items land (listed in each item's acceptance test).
- **Acceptance test.** `npm test -- motionDirection` passes; `motion_guide {topic:"launch-film"}` returns the playbook; a fresh brain has the skill; a launch-film brief's project summary carries `toolset.playbook.id === 'launch-film'`.

### U0.5 A judge that measures what the critics measured

- **Why.** `judge.ts` scores frame cleanliness, council notes, pacing, plan coverage, motion density and genre checks. None of these sees the faults that decided the 15 s film's score: mean luma 21 [C1], work-list text about 10 px [C1], the same phrase three times [C1], a send that is a smear [C2], a pull-back that never lands [C2], cues 20–30 dB under the song [C2]. One critique round with measured numbers moved the film from 76 to 84.
- **What changes.**
  - `src/lib/production.ts` `QaIssue.kind`: add `dark-film`, `luma-jump`, `repeated-phrase`, `late-word`, `no-landing`, `short-end-card`, `quiet-cue`, `broken-capture`.
  - `run_frame_qa` (`src/lib/aiTools.ts:3866`): per-second mean luma and 98th percentile; on-screen cap height of text layers (from the evaluated text layer's size × camera scale); phrase duplicates across text, captions and UI text at one time; for each transcript word shown on screen, the first frame it is readable against its onset; sharpness (mean absolute Laplacian) for 10 frames after each camera move ends; brand-name hold before the end fade; each cue's level against the song's 100 ms RMS.
  - `src/lib/judge.ts`: a `launch` genre (checks in [Learn §10.5]), `MOTION_TARGET.launch = 0.85`, and a `look` criterion (weight 15) from the measures above.
  - The council gets a critic seat for launch films using the ten-criterion rubric [Learn §8.2], returning keep-lists and numbered fixes with times.
- **Size** M. **Risk** Medium: thresholds need calibration. Calibrate on the three films scored so far (Opus 0–15 s = 77, 15 s v1 = 76, v2 = 84).
- **Acceptance test.** Run the measures on the two 15 s MP4s imported as clips: v1 is flagged `dark-film` (luma 20.4) and `repeated-phrase` (4.5–4.8 s); v2 is not flagged `dark-film` (54.6), is flagged `no-landing` at 13.05–13.70 and `quiet-cue` at 1.06, 2.27 and 8.33 s. The critic seat's score on v1 and v2 is within ±4 of 76 and 84.

### U0.6 Assembly safety fixes

- **Why.** Opus lost the song on A1 because audio `place` ops ignore their track, it lost a −1 dB trim, 30 of 31 caption moves "changed nothing" unnoticed, and the whole timeline was lost because the project was never saved [Walk §9–10]. The code confirms the first: `src/lib/editProgram.ts:120` always passes the comp's first audio track (`audioTrack: audio?.id`), whatever `op.track` says.
- **What changes.**
  - `src/lib/editProgram.ts` `place`: resolve `op.track` for audio too; add an `audioTrack` field; fail when the named track does not exist.
  - `apply_edit` results: name removed clip ids and their tracks; answer `ok: false` for a bulk op that changed nothing (with the reason).
  - Autosave after every committed AI timeline edit (the project store already backs up; make the commit path trigger it).
- **Size** S. **Risk** Low.
- **Acceptance test.** Vitest: a program placing an audio file with `track:"A3"` puts it on A3 and leaves A1's clip; a transform on no matching clips returns `ok:false`; after an AI commit the project's saved file contains the new clips.

---

## 4. Phase 1: the real product UI, in states (weeks 2–6)

### U1.1 `capture_app_session`: DOM-aware capture with part states

- **Why.** Both good films were built on per-state parts of the real UI. Opus spent 19.5 min (20%) rebuilding components from source and CSS, plus 10.8 min re-rendering them [Walk §1]. The 15 s maker built the same thing a second way: boot the Vite app in headless Chrome with a Tauri stand-in (`tools/tauri_mock.js`, 61 lines), staged data (`stage_data.js`, 88), drive scenarios and serialise states (`capture.mjs`, 204). Crimson rates it "very high: every card in the film came from this" [Crimson U1]. Today `capture_product_ui` is one Edge `--screenshot` with no DOM, no states and boxes read off a 100 px grid by eye (`src-tauri/src/ui_screen.rs:80-117`; [Audit G7]).
- **What changes.**
  - New `src-tauri/src/ui_capture.rs` (or a bundled Node script run through the existing command runner): launch Chrome/Edge headless with `--remote-debugging-port`, `--force-color-profile=srgb`, `--font-render-hinting=none`, a fresh profile, `deviceScaleFactor` 3 or 4, transparent background override. Speak CDP directly (no Playwright dependency).
  - A script language: `[{goto}, {click, selector|text|role}, {type, selector, text}, {wait, ms|selector}, {eval}, {capture, name, parts:[{id, selector|text|role, pad}]}]`. Each `capture` records a state: for each part, a solo screenshot (`body.solo *{visibility:hidden}` plus the target visible, so the layout does not move) and its DOM box; plus the base without the parts. Typing captures one state per character when asked (`type {…, perChar:true}`).
  - Safety rules learned the hard way: parts at page origin ≥ 40 px so no clip goes negative (the 1x bug [Study §2.4]); `document.fonts.ready` plus 300 ms; fail when any `document.fonts` face is unloaded; automatic scan of each PNG (content under 45% of its size in both axes = rendered small); CSS transitions off during capture; a content-hash cache so a rerun captures only changed states; diagnostics never written into the output folder.
  - `src/lib/uiScreenTools.ts`: `capture_app_session` returns `{screen: {width, height, scale}, states: [{id, base, parts: [{id, box, path, text?}]}]}` in the `UiRaster` shape (`ui/spec.ts`), so `create_ui_screen {capture: <id>}` uses it with no eyeballing. Keep `capture_product_ui` as the simple path.
  - Add it to GATHER in `editWorkflow.ts` (U0.1).
- **Size** L. **Risk** Medium: logged-in apps need a user-provided profile or cookies (support `profileDir` explicitly, never the user's default profile silently); Chrome/Edge availability is already assumed by `capture_product_ui`.
- **Acceptance test.** Against `http://localhost:5199` with the staging shim (U1.2) or any public page: a 3-state script (empty composer, typed prompt, sent) returns 3 states whose parts' boxes match `getBoundingClientRect` to ±1 px; the scan reports 0 small parts; a font removed from the page makes the call fail with the family named; a rerun with one changed state recaptures only it. `create_ui_screen {capture}` builds a scene with no box typed by the model.

### U1.2 Bhippi-self staging: the app films itself

- **Why.** Bhippi's launch films show Bhippi. The 15 s film's strongest beats (the real editor, the work list, the timeline filling, meters driven by the song) came from the real React UI with staged data [15s §1–3]; Crimson's maker made 51 real tool calls against a mocked shell [Crimson U1]. Opus instead rebuilt a 1920x1040 HTML copy of the editor, which carried a leftover "Orbit film" project name [Study §6].
- **What changes.**
  - A capture-only staging layer, loaded only into the capture browser (never the app): a Tauri IPC stand-in (the prototype is `tauri_mock.js`: `__TAURI_INTERNALS__.invoke` answered from staged data, event emitters for backend events) plus a "world" (project, comp with clips, providers, chat log, media served from a folder). Ship it as `scripts/stage/` or `src-tauri/resources/stage/`, and build worlds from the user's current project when they ask ("film this project").
  - Deterministic UI time: a `window.__bhippiClock` hook that the app's own animations (the mark's states, shimmer, status circles, meters, playhead) read instead of wall time when present, so a capture repeats exactly [15s §6]. This touches `src/` components and is its own reviewed change.
  - Licence and account values in the stand-in are fixed dummy values; the shim is never bundled into the app's web assets.
- **Size** M. **Risk** Medium (the clock hook touches many components; the shim must not become a licence bypass in shipped code). Start with the capture-only shim; add the clock hook to the five components the films used.
- **Acceptance test.** `capture_app_session {target:"bhippi-self", world:"current-project"}` captures the editor, the chat with a work list, the model picker and the timeline with the current project's clips; two captures of the same state are byte-identical; the shipped `dist/` contains no stand-in code (a build test greps for its marker).

### U1.3 Per-part states in `create_ui_screen`

- **Why.** "A click only reads when its target changes on that frame" [Learn §1.2]: Opus used 139 composer states, 16 slider states and row states need → typing → saving → ready [Study §2.2]. Today states are whole pages switched by `state` (`ui/spec.ts:40, 74`; `ui/compile.ts:388-414`), and screenshot mode supports only `main` (`ui/raster.ts:152`) [Audit G6].
- **What changes.**
  - `src/motion/ui/spec.ts`: HTML variants `data-part="send" data-state="hot"` (siblings with one part name); screenshot/capture parts get `states: [{id, path|box}]`; a new action `{t, type:'set', target, state, transition:'cut'|'fade'|'morph', duration?}`; `type` gains `perChar` to swap captured typing states instead of drawing live text.
  - `src/motion/ui/raster.ts`: rasterise each variant; cap variants per screen (default 200) and warn.
  - `src/motion/ui/compile.ts`: each part becomes a slot holding its variants as footage layers with opacity keys; a `click` on a part with a `pressed`/`hot` state swaps it automatically on the press frame.
- **Size** M. **Risk** Medium: more layers per screen (the demo already has 23); mitigated by keeping hidden variants at opacity 0 (skipped by the renderer).
- **Acceptance test.** Vitest: a spec with `send` in `idle` and `hot` compiles to two layers in one slot, with `hot` visible from the click frame; a screenshot part with 3 states rasterises 3 pictures. Motion Lab: a composer typing "Cut this to the beat." from 22 per-character states swaps one state per 45 ms.

### U1.4 Resolution tied to camera zoom

- **Why.** A 4x close-up of a 2x raster is soft. The 15 s maker called the raster boost (rasterise at K ≥ 0.92·zoom, powers of two) "the single biggest quality win" [15s §2]. Today parts default to resolution 2 (`ui/spec.ts`), live text re-rasterises to 4x (`gl/renderer.ts:42-58`), and `MAX_TEXTURE_SIZE` 8192 caps a 2880 px canvas at 2.8x (`gl/renderer.ts:57`) [Audit §4].
- **What changes.** `uiScreenTools.ts` `build`: pick part resolution from the spec's largest camera zoom (U2.2): `min(4, pow2ceil(0.92·zoom·base))`; base screen at 2 with parts at the boosted scale; tile a part over 8192 px into two textures.
- **Size** S. **Risk** Low (disk and memory; cap it).
- **Acceptance test.** A spec with a 3.3x camera close-up rasterises its target part at 4; in Motion Lab the close-up's text edge contrast matches a 1x reference crop to within 10%.

---

## 5. Phase 2: the product-demo camera and cursors (weeks 4–9)

### U2.1 UI parts in the scene's 3D space

- **Why.** The signature shots are the camera moving between parts, panels separating in depth and the window tilting while parts lift off it [Study §3.5–3.6]. Today a UI screen is one flattened precomp that never meets the scene camera (`gl/renderer.ts:290-293`) [Audit G1].
- **What changes.** `src/motion/ui/compile.ts` gains `place.space: '3d'`: emit the base and parts as top-level `threeD` footage layers parented to a `ui-root` null (the Opus `Group`: local window px → world), each part with a `z` (default 0; `depth` per part in the spec). The cursor, rings and tags parent to the same root. Keep the precomp path as the default for 2D screens. `lib/motionStack.ts` needs no change because these are ordinary layers.
- **Size** M. **Risk** Medium: layer counts rise (mitigated: one full-screen precomp pass fewer per frame [Audit §4]).
- **Acceptance test.** Motion Lab: the audit's demo UI with `space:'3d'` and a camera orbit shows parallax between two parts set 200 px apart in z; frame time at 1080p with 16-sample motion blur stays under 60 ms on the RTX 3080 test machine.

### U2.2 UI camera with autofocus and a smoothed path

- **Why.** "Close on one piece, then pull back to the whole window tilted in 3D" is the core move of both films. Today the compiler's `zoom` is a 2D scale and `tilt` is static (`ui/compile.ts:457-477`) [Audit G2]. In the audit's own test the close-up was completely defocused because focus does not follow the camera [Audit §2.3, G4]. Chained per-segment eases stop dead between segments (fixed in the 15 s film with a Gaussian low-pass, σ 55 ms) [15s §3], and a camera corner behind the near plane broke frames [15s round 2].
- **What changes.**
  - `src/motion/ui/spec.ts`: `camera: {keys: [{t, target?: part | [x, y], zoom, tilt?: [rx, ry], ease?}], smooth?: seconds, breath?: {px, deg, hz}, aperture?, focus?: 'target'}` plus a `{type:'camera'}` action for one-off pushes.
  - `compile.ts`: emit a `camera` layer. Target = the part's centre in world space. Zoom = dolly distance `D/zoom`, keyed in log space. Default eases: glide `cubic-in-out`, arrive `expo-out`. Optional low-pass of the sampled path. Clamp keys so every screen corner stays in front of the near plane (w ≥ 0.04).
  - `src/motion/types.ts` camera: `focus?: Prop<number> | 'poi' | {layer: string}`; `evaluate.ts` `cameraAt` (line 279) resolves it as the distance to the POI or layer each frame. A `dof.pull` lag gives a rack.
  - Compiler defaults (`compile.ts` 474–479): motion blur on for the screen, parts and cursor.
- **Size** M. **Risk** Medium (focus changes can alter existing templates' look: default stays `zoom` unless `'poi'` is set).
- **Acceptance test.** Motion Lab rebuild of Opus S02's camera keys (`3.55 → 2.55 → 1.75 → 0.84, rx 5, ry −9` [Study §3.5]) from a spec with 4 camera keys and no hand-typed focus: the close-up is sharp (Laplacian within 10% of a pinhole render), the far edge at 0.84 is softer than the near edge only after U4.2; the camera path has no frame where speed drops to zero between keys; a key that would put a corner behind the camera is clamped and reported.

### U2.3 Named multiplayer cursors

- **Why.** In both films the story ("you connect, Bhippi works") is told by who moves the mouse: You, Bhippi and each provider with its logo; three role-tagged Bhippi cursors building the timeline [Study §3.3, 15s §3]. Critique fixes: constant screen size, tags right of the tip and never over a label, final parks inside the edit [C1 fix 9, C2 fix 3]. Today there is one unlabelled arrow, hand or dot (`ui/compile.ts:70-87`) [Audit G5].
- **What changes.**
  - `ui/spec.ts`: `cursors: [{id, label, color, logo?: svg|asset, role?, style}]`; every action takes `by`; `cursor` stays as the single-cursor shorthand.
  - `compile.ts` cursor block (416–440): per cursor, an arrow (white keyline, soft shadow) plus a tag (shape + text, logo from `ProviderLogo`-style SVG); arc paths (`arc` ±0.1 on position keys, already supported by keys); press −14% bump (0.05/0.22 s); ring 16 → 86 px over 0.5 s at (1 − u)·0.9 opacity in the cursor's colour; idle jitter 2 px at 1.3 Hz; 55 ms dwell; screen-space constant size (the cursor layers read the camera's scale and counter-scale, or render in a screen-space group); tag placement right of the tip, flipped left near the right edge, checked against part boxes so it never covers a label.
  - A catalogue of built-in actors: `you`, `bhippi`, `claude`, `gpt`, `gemini`, `local`, with the app's real colours and marks.
- **Size** M. **Risk** Low.
- **Acceptance test.** A spec with You and Bhippi cursors, 6 actions split by `by`, compiles to two cursors with tags; at 0.86x zoom the arrows measure the same on screen as at 2x (±5%); no tag box intersects a part's text box in any sampled frame; each click frame shows the ring's first size and the target's `pressed` state.

### U2.4 Adaptive motion blur and per-layer shutter

- **Why.** Fixed sample counts ghost 1 px UI text into double images on slow moves and smear on fast ones; one sample per 1.6 px of streak (2 to 48) fixed it [15s §5]. A 180° shutter on a rising chat bubble turned its text into stripes; the fix was 60–72° on text and 120° on whips [C2]. Crimson hit the same ghosting with fixed 6–24 samples [Crimson E6]. Today samples are fixed per scene (≤32) and shutter is scene-wide (`types.ts:435`, `evaluate.ts:334-352`) [Audit G11].
- **What changes.** `evaluate.ts`: estimate each frame's largest screen displacement from the camera and moving layers (a 7x5 grid of points per 3D layer); samples = clamp(ceil(streak/1.6), 1, 48), or the scene's fixed value when set. `types.ts`: a layer `shutter?` override; UI text layers and cursors default to 72°. `gl/renderer.ts`: render sub-frames at half resolution when samples ≥ 6 (Opus's trick) and accumulate in linear light.
- **Size** M. **Risk** Medium (render time on whips: cap at 48 and at half resolution).
- **Acceptance test.** Motion Lab: a UI pan at 12 px/frame renders with at most 1.6 px between copies (no double text visible at 200% crop); a still frame renders 1 sample; a 7-frame whip lands sharp on its last frame; export time for the 15 s benchmark stays under 2 minutes.

### U2.5 `product-demo` template

- **Why.** The model reaches premium only through templates [Audit G8]; this is the one template that carries C1 + C2 together.
- **What changes.** `src/motion/kit/productTemplates.ts`, registered in `kit/index.ts:48`: params `{screen: capture|spec, beats: [{at: t|{word}, focus: part, zoom, tilt, actions: […]}], pullBack: {at, to: 'window', tilt: [5, -9], zoom: 0.84}, cursors, stage, finish}`. It writes the camera keys, cursors, states, entrance, shadow and landing holds (10 frames, ≤1% drift) from the defaults in [Learn §10.4].
- **Size** M. **Risk** Low.
- **Acceptance test.** One call with a 3-state capture, 2 beats and a pull-back produces a scene that passes U0.5's `no-landing` and reading-size checks with no numbers other than times given by the model.

---

## 6. Phase 3: the scene recipes as templates (weeks 7–12)

All in `src/motion/kit/productTemplates.ts` (registered in `kit/index.ts`), every time param accepting `{word}` refs and beat refs (U5.2), each with the defaults from [Learn §4–5]. Each gets a Motion Lab scene in `src/motion/lab/scenes*.ts` and a vitest build test. Pattern numbers refer to [Learn §5].

| Item | Template | Pattern | Why (evidence) | Key params | Size |
|---|---|---|---|---|---|
| U3.2 | `type-on-voice` | P1 | Sync scored 9/10 when every word landed on its syllable [C1]; typing that trails the voice scored 7 | `words: [{text, at}]`, `mode: type\|blur-in`, `lead 0.035`, caret, `recentre`, two cursors sharing the line, `select: word` | S |
| U3.3 | `fly-through-word` | P2 | "The strongest transition across both films" [C1, C2] | `word`, `anchor: {glyph, index}` measured from the text layer's glyph boxes, `zoom 8–270`, `curve`, `next: scene|clipId`, `pixelate 36→1`, `flash` | M |
| U3.4 | `window-explode` | P5 | The pre-drop slam; first version "too subtle" until offsets doubled [Walk loop 8] | `panels` (from capture parts), `depths` (defaults from Opus's LZ table), `spread 0.075`, `slamAt: beat`, `orbit`, `aperture 7` | M (needs U2.1) |
| U3.5 | `connect-hub` | P7 | "Bring any AI" read without a word [C1]; used in both films | `hub`, `nodes: [{logo, at}]`, `wire 0.3 s`, `pulses`, `wake`, `collapse` | M |
| U3.6 | `ask-and-work` | P8 | The story beat; its absence capped story at 8 [C2] | `composer` part, `prompt`, `cps 22`, `sendAt: snare`, `steps: [{label, at}]`, `hold zoom` chosen so cap height ≥ 26 px | S (on U2.5) |
| U3.7 | `timeline-build` | P9, P12 | "The first time the film shows an edit happening" [C2]; Crimson T11 | `clips: [{track, at, media}]`, `grid: sixteenth`, `spring 4.4 Hz ζ 0.6`, `monitorFlash`, `cursors by role`, `contrastFrom: one-clip` | M |
| U3.8 | `control-snap`, `logo-lockup`, `end-card` hold rule | P10, P11 | Slider to Maximum on the beats [Study §3.8]; name held ≥ 0.35 s [C1 fix 6] | control part + states + `snaps: beats`; mark with parts (`split_logo_parts`, Crimson T8), `shutAt: snare`, hide while > 30° open; `end-card.minHold 0.35` | M |

### U3.9 Scene joins in sequences

- **Why.** Every cut in the 80/100 film is hidden in motion or light, by six mechanisms [Study §3.14]. `sequence.ts` has 28 transitions but none reads the outgoing scene's camera state or turns a light point into the next scene, and `layout:"world"` trucks a 2D null, not a camera [Audit G12].
- **What changes.** `src/motion/sequence.ts`: `camera-match` (the incoming scene starts at the outgoing scene's last camera keys), `plunge` (push into a named part that the next scene opens on), `glow-handoff` (a named point becomes an additive glow that becomes the next scene's first layer), `flash-bridge` (warm white 0.5–0.9, mirror flash in), `whip` with U2.4 shutter 120°; `layout:"space"` with a real camera between beats in depth.
- **Size** M. **Risk** Low.
- **Acceptance test.** A two-beat sequence joined by `camera-match` has equal camera state (±0.5 px, ±0.1°) on the last frame of beat 1 and the first of beat 2; `review_frames {strip}` across each new join shows no frame with luma below 5 (no black frame).

---

## 7. Phase 4: the cinematic finish (weeks 8–12, parallel)

### U4.1 Finish presets

- **Why.** Hand-built finishes go wrong: a glow at threshold 0.75 washed a white UI to grey [Audit §2.3]; the 15 s v1 was too dark to read (luma 21) until an exposure stage, a key light and a 10% vignette brought it to 55 [15s round 2]. The Opus film's finish was mostly motion blur, soft shadows, blur-in entrances, static grain and warm flashes, with no bloom or vignette [Study §0]. [Audit G9], [Crimson E5].
- **What changes.** `src/motion/types.ts` scene `finish?: {preset: 'launch-light' | 'launch-dark' | 'none', exposure?, bloom?, vignette?, grain?, keyLight?}` expanded by `evaluate.ts` into an adjustment layer at the top (`gl/renderer.ts:460-473`):
  - `launch-light`: static grain 1.1/255, no bloom, no vignette, warm-brown shadow colour default for the scene.
  - `launch-dark`: exposure +0.7 EV in linear light, shoulder (knee 0.45, ceiling 0.80), gamma 0.85; saturation-weighted bloom (threshold 0.7, knee 0.2, strength 0.32, three radii); vignette 10%; grain σ 0.011 luminance-shaped; an optional key light following a screen point.
  - `bloom` gains a `saturationWeight` parameter in `gl/effects.ts` (today's glow is luminance only).
  - Exposed on `create_motion_scene`, `create_motion_sequence`, `create_ui_screen` and templates.
- **Size** M. **Risk** Medium (8-bit banding on dark gradients until U4.3; dither on readback).
- **Acceptance test.** The audit's white demo UI under `launch-dark`: UI whites stay ≥ 230 and do not halo (bloom contribution on white pixels < 3/255); a dark stage frame's mean luma rises into 45–60; `launch-light` frames show no 8-bit banding in a 1080p gradient (max run of identical values under 40 px).

### U4.2–U4.4 Quality ceiling (after the benchmark's first run)

| Item | Why | What | Size | Risk | Acceptance |
|---|---|---|---|---|---|
| U4.2 Per-pixel DOF on tilted planes | A tilted window sharp at the focus line and melting toward the far corner is the "expensive lens" read; today one blur per layer [Audit G3]; the 15 s film computed depth per pixel from the camera homography [15s §3] | `evaluate.ts` returns corner depths; a CoC-by-plane-equation blur stack (σ 0,1,2,4,8,16) in `gl/effects.ts`/`shaders.ts` | L | High | A plane tilted 30° shows increasing blur from focus line to far edge; cost ≤ 2x of today's DOF |
| U4.3 16-bit float targets | Dark stages, bloom and heavy DOF band in RGBA8 (`gl/core.ts:117`) [Audit G14] | RGBA16F when `EXT_color_buffer_float` exists; dither on present/readback | S | Medium | No banding in the dark finish test; export identical in size |
| U4.4 Sheen and contact shadow | A moving specular sweep and a shadow on a floor make a tilted window read as 3D [Audit G10], [Crimson E1] | `sheen` effect (105°, screen blend, keyed `at`), `contact-shadow` in comp space from the projected quad | M | Low | Sheen crosses a card in the keyed time; shadow stays on the floor as the window tilts |

---

## 8. Phase 5: sync and sound (weeks 6–10, parallel)

### U5.1 Word timing on songs: lyrics alignment

- **Why.** Deepgram on the mixed song caught only the spoken lines; Opus isolated the vocal with a centre mask, re-transcribed short windows five times, and still took three chorus lines from an old transcript and the grid [Walk §3, §10]. The 15 s maker read words off spectrograms for several passes [15s §4]. Both said: "a known script in, word times out" would replace it.
- **What changes.** `analyze_clip_speech {lyrics?: string, isolate?: 'centre'|'model'}`: a centre-mask vocal estimate (the Opus recipe: STFT 4096/1024, `sim^10`, 140–7500 Hz) before transcription; with `lyrics`, force-align the given words to the transcript's timings and the vocal's onsets (dynamic time warping on word sequences; onsets snapped to the nearest energy rise within 40 ms, Crimson A1). Implement in `src-tauri/src/speech.rs` / `transcribe.rs`.
- **Size** M. **Risk** Medium (sung vowels; report per-word confidence).
- **Acceptance test.** On `Meet Bhippi.mp3` 0–15 s with the lyric sheet: every word within 50 ms of the critique's independent onsets (An 2.97, editor 3.14, with 5.92, producer 6.31, inside 6.83, Connect 9.10, your 9.47, AI 9.71, and 12.87, watch 13.01, it 13.17, work 13.48 [C1]); on 36–83 s, "Every move" / "Every call" / "Your brand" get measured times.

### U5.2 Beat map snapping and backbeats

- **Why.** Opus fitted 99.03 BPM, phase 0.456 s by exhaustive search on spectral flux, residual under 5 ms [Walk §3.5]; the 15 s song's snares fall on every second beat, off the downbeat, and carried the film's small events [15s §4]. Scenes need times like "the eighth after bar 6" and "the next snare".
- **What changes.** `analyze_music_beats`: a fine BPM/phase fit (0.01 BPM, 4 ms), per-section residuals, and backbeat/snare labels from a high-band onset detector. Time refs in every scene and template: `{beat: n}`, `{bar: m, beat?}`, `{grid: 'eighth'|'sixteenth', after: t}`, `{snare: 'next', after: t}`, resolved in `motionTools.ts` beside `{word}` refs. `save_beat_sheet` stores the map as the single source of truth for scenes, captions and SFX [Crimson W1].
- **Size** S. **Risk** Low.
- **Acceptance test.** On the song: BPM 99.03 ± 0.03, phase within 5 ms of 0.456; the 12 snares in 0–15 s within 10 ms of the 15 s notes' table; `{snare:'next', after:10.5}` resolves to 10.750.

### U5.3 Sound cues relative to the song

- **Why.** Two-thirds of the 15 s v2's 39 cues were inaudible, 20–30 dB under the song's local level [C2]. The Opus film placed 98 events as one stem from the choreography [Study §4.3].
- **What changes.** Scene `cues` get `level: 'relative'` by default: gain = song's local 100 ms RMS + an offset per kind (tick −11 dB with a +4 dB shelf at 4 kHz, click −6, pop −8 to −9, whoosh −6 at its peak, glass −4); anchor by kind (hits on onset, whooshes on their peak, risers on their end) [Crimson A4]; a 2 dB duck of the song under dense pops; then loudness to −16 LUFS / −1 dBTP. The UI compiler emits cues for every click, keystroke group, state flip and landing.
- **Size** S. **Risk** Low.
- **Acceptance test.** The benchmark film's cues all measure ≥ −12 dB against the song's local RMS (U0.5 `quiet-cue` finds none); integrated loudness −16 ± 1 LUFS, true peak ≤ −1 dBTP.

---

## 9. The benchmark: rebuild the 15 s film inside Bhippi's engine

This is the one test that says whether the plan worked.

**Brief.** The same brief the three films had: `Meet Bhippi.mp3` from 0:00 to 0:15 (the spoken lines "An editor… with a producer inside. Connect your AI… and watch it work."), the Relume launch film as the reference, "make the video motion graphic and use the UI from the main product folder, go all out", 1920x1080 at 30 fps.

**Rules.**
1. Made through Bhippi's normal production pipeline (plan → gather → edit → polish), in the app, with its tools only. **No `run_command` renderers**, no imported MP4 or PNG-sequence scenes: every picture on the timeline is a motion scene, a UI capture used inside one, or real footage in the monitor. A script checks the saved project for this.
2. Every scene opens as a layered "[Motion]" comp. An editability check: a person changes one word of the first line and moves one cursor's final park in under 2 minutes and re-exports.
3. Effort High (the U0.2 recommendation), the launch-film budget. Run it with **two different strong models** (one Claude model and one non-Claude model the app supports), to show the recipe lives in the tools and not in one model.
4. Record wall time, tokens, number of looks (sheets or `review_frames` calls) and fixes.

**Scoring.** A blind critic using the critiques' method and rubric [Learn §8.2]: frames every 0.25 s, stills around every word onset, full-resolution checks at the moments of action, luma and sharpness measured, audio cross-correlated with the song and cues measured against its local level. Ten criteria 0–10; look, product UI and story count double (out of 130), calibrated so that the Opus film's 0–15 s = 77 and the 15 s v2 = 84. The critic sees the new film beside v2 and the Opus stretch, without knowing which is which. U0.5's measured gates are reported beside the score.

**Targets.**

| Milestone | When | Target score | Also |
|---|---|---|---|
| M0: after Phase 0 only | week 2 | **≥ 55** | Shows how much the route, the budget and the loop alone recover from 10. The engine then still lacks states, a product camera and cursors, so it will not reach 77. |
| M1: after Phases 1–2 and U4.1 | week 9 | **≥ 80** (beats the Opus stretch, 77) | All U0.5 gates pass except at most two; wall time ≤ 45 min |
| **M2: after Phase 3 and U5.x (the target)** | week 12 | **≥ 85** with the stronger model, **≥ 80** with the second model | Beats v2's 84; all gates pass; wall time ≤ 30 min; tokens ≤ 25 M; editability check passes |
| Stretch | after U4.2–U4.4 | ≥ 88 | Critique 2's estimate for v2 with its fixes applied |

If M1 misses, the critic's top fixes name which items to reopen; rerun after each fix, not after each phase.

---

## 10. Risks and open questions

- **Capture of logged-in products.** U1.1 works on Bhippi itself (staged) and on public pages. For a user's own SaaS behind a login it needs a profile or cookies the user provides explicitly. Never reuse the default browser profile silently.
- **The staging shim and the licence.** The 15 s prototype stubs the licence check. It must live only in the capture browser and never ship in the app's bundle (U1.2's acceptance test greps for it).
- **Layer counts.** Per-part states (U1.3) and 3D parts (U2.1) multiply layers. Hidden variants are skipped by the renderer; cap variants per screen and warn.
- **Token cost.** Launch films will cost more (U0.2 raises their budget about 8x). That is what the 80/100 run cost and more; the templates (Phase 3) should bring it back down, since a model then writes about 12 beats of parameters instead of 1,800 lines [Crimson §6.1].
- **Critic calibration.** U0.5's model critic must be checked against the human-reviewed scores (76, 77, 84) before its numbers gate anything.
- **Preview versus export.** Preview drops motion blur below quality 0.75 (`MotionLayer.tsx:143`). Users judging a launch film during playback will see less than the export; U0.3's sheets render at export quality.
- **Out of scope.** A Python or bespoke renderer inside Bhippi; Blender for UI (Cycles is about 3 s a frame [Audit §4]; keep it for hero objects like the glass mark); real lights and cast shadows beyond U4.4.

---

## Appendix: which gaps from the audit each item closes

| Audit gap | Item |
|---|---|
| G1 UI in the scene's 3D space | U2.1 |
| G2 UI camera | U2.2, U2.5 |
| G3 per-pixel DOF | U4.2 |
| G4 autofocus | U2.2 |
| G5 labelled cursors | U2.3 |
| G6 per-part states | U1.3 |
| G7 DOM-aware capture | U1.1, U1.2 |
| G8 product templates | U2.5, U3.2–U3.8 |
| G9 finish preset | U4.1 |
| G10 grounding, sheen | U4.4 |
| G11 motion blur completeness | U2.4 |
| G12 3D sequence camera | U3.9 |
| G13 raw-scene ergonomics | U2.1 (parts as layers), U2.2 (part targets) |
| G14 render precision | U4.3 |
| G15 guidance drift | U0.4 |
| (new) pipeline: still plates, effort, budget, loop, judge | U0.1, U0.2, U0.3, U0.5 |
| (new) assembly safety | U0.6 |
| (new) sync on songs, sound levels | U5.1–U5.3 |
