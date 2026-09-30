# Motion engine master plan: from the film lab to a ready-made, layered engine

Date: 2026-09-30. Status: plan. No source code was changed and no film was rendered for it.

**The goal, in the owner's words.** The AI should have things already built, so it spends fewer tokens and the
output is even better. Everything the engine makes should be layers, so the user can open any layer and edit it or
do whatever they want. Ready-made pieces are **offered, never forced**: frontier providers (Claude Code, Codex) keep
full freedom to build their own way, and lesser models get the ready-made path.

**What this plan builds on.** Most of the first wave is already written on the branch `native-ai-toolkit` (worktree
`D:\Bhippi-toolkit`, reviewed at `7021070`, 59 commits over main `576f73e`, about 13,200 lines, not yet merged, not
yet run end to end in the app). This plan marks what that branch already does, with its files, and plans only what
is still missing. Paths marked **branch:** are in `D:\Bhippi-toolkit`; unmarked paths are on main in
`D:\Bhippi Video editor`.

**Evidence** (all read in full for this plan; `LAB` = `C:\Users\aayus\Documents\Bhippi\Film lab`):

| Tag | Source |
|---|---|
| [Study] | `docs/research/opus-launch-film-study.md`: how Opus built the 80/100 "Meet Bhippi" film |
| [Walk] | `docs/research/opus-launch-film-walkthrough.md`: the run step by step, its 37 look-fix loops and its mistakes |
| [Audit] | `docs/research/motion-engine-audit.md`: the engine on main, gaps G1–G15 |
| [Learn] | `docs/research/launch-film-learnings.md`: the launch-film recipe and gates |
| [Upgrade] | `docs/plans/MOTION-ENGINE-UPGRADE-PLAN.md`: the U-numbered engine items |
| [TK-Plan], [TK-Review] | `docs/plans/NATIVE-AI-TOOLKIT-PLAN.md`, `docs/plans/NATIVE-AI-TOOLKIT-REVIEW.md` |
| [15s] | `LAB\bhippi-15s\BUILD_NOTES.md`, `critique-round1.md`, `critique-round2.md` |
| [Crimson] | `docs/research/film-lab/crimson-explainer.md` (the harvest), `LAB\crimson-explainer\BUILD_NOTES.md`, `critique-round1.md` |
| [Glass] | `LAB\glass-identity\BUILD_NOTES.md`, `critique-round1.md`, `renderer\timeline3.js`, `renderer\shaders\glass3.frag`, `mark\make_sdf3.py`, `tools\sat_paths.mjs`; review sheets in `docs/research/film-lab/glass-identity-sheets/` |
| [White] | `LAB\white-saas\BUILD_NOTES.md`, `critique-round1.md`, `notes\`, `tools\`, `film\lib.js`, `film\scene.js`, `film\timeline.js`, `capture\session.mjs` |
| [Gather] | `Research/Launch gathering/asset-handoff.md` and `Research/Bhippi-launch/source-notes.md`: what Bhippi's own GATHER phase handed to EDIT for the launch brief |

Film letters used throughout: **L** = the Opus 80/100 launch film (full song), **S** = the 15 s launch film,
**C** = crimson-explainer, **G** = glass-identity, **W** = white-saas.

---

## 1. Executive summary

### 1.1 Every score

Scores are the critics' 0–100 rubric (ten criteria, 0–10 each). "Maker" is the film's own self-score, which ran
2 to 17 points above the critics every time.

| Film | Imitates | v1 | v2 | Reference | Maker (v1 / v2) | State |
|---|---|---|---|---|---|---|
| L: Opus "Meet Bhippi" launch film, 106 s | Relume launch promo (eQLi_t0X1ZE) | **80**; its 0–15 s stretch **77** | n/a | not scored | n/a | Finished in one 96-min turn as 23 flat MP4s. The timeline was never saved and was lost [Walk §0]. |
| S: bhippi-15s | Relume launch promo, judged against L's 0–15 s | **76** | **84** | 77 (L's stretch, the comparator) | 83 / 86 | Finished, two rounds [15s]. |
| C: crimson-explainer | "If You ONLY Watch One Motion Design Video…" (Crimson Brief) | **68** | **75** | **80** | 78 / 77 | Finished, two rounds, fully harvested [Crimson]. |
| G: glass-identity | "hi, aflow." glass identity | **66** (the on-disk critique, a second pass, says 65) | rendered, **unscored** | **84** (on-disk pass: 86) | 82 / 78 | v2 exists (`LAB\Renders\glass-identity-v2.mp4`) but was never scored. Its harvest was cut off after four review sheets; this plan harvests it (§3). |
| W: white-saas | "Workly" white-background SaaS film | **69** (on-disk critique: 67) | **none** | **82** (on-disk: 80) | 83 / n/a | Critique only. A round 2 was started (new captures `capture\plates_r2` 14:01–14:05, `film\timeline.js` and `scene.js` rewritten 14:15–14:17, test stills `render\stills_r2a`) and stopped before any render. This plan harvests it (§3). |
| Manus-style "apple-launch" | Manus launch film (`LAB\apple-launch\ref\manus.mp4`) | **unfinished** | | | | Only a reference study: 14 stills, 7 sheets, two helper scripts. No plan, no film. |
| fluid-saas | pastel design-canvas SaaS film | **unfinished** | | | | Only reference frames (489 files in `LAB\fluid-saas\ref`). No plan, no film. |
| Bhippi's own pipeline, same launch brief | Relume launch promo | **10** | | | | plan → gather → edit at medium effort; GATHER made still plates, EDIT used built-in templates [Upgrade §0]. |

Where two numbers exist for G and W, the first is the score stated in the brief for this plan and the second is the
critique file on disk; both files note an earlier review pass. The difference (1–2 points) is itself a finding: critic scores need
two critics or a calibration set before they gate anything (§8).

### 1.2 What the experiments proved

1. **The engine was never the bottleneck; the ingredients and the process were.** Bhippi's GL engine renders a tilted
   UI plane with a moving camera, depth of field and 16-sample motion blur in 26–44 ms a frame [Audit §1.7]. The
   same brief went from 10/100 in the pipeline to 76–84 when a model was free to gather the right ingredients and
   look at its frames.
2. **The real product in many states is the biggest single ingredient.** Every film that showed Bhippi (L, S, C, W)
   built the real UI one picture per state: 328 parts at 4x [Study §2.2], the live React app staged with data
   [15s §2], 51 real tool calls through the app's own executor [Crimson §2.1], four capture passes at DPR 2–4 [White §3].
   The 10/100 run had still plates.
3. **One scored critique round is worth about +7 to +8 points.** S went 76 → 84 and C went 68 → 75 after one round
   each. G's v2 answered all ten fixes of its critique (the maker estimates 78) but was never scored.
4. **The films lose points on the same measurable faults.** Too dark or a dark UI mass (S v1 luma 21; W 37% of frames
   over 30% dark), text too small to read (S v1 work list at 10 px), the same phrase twice (S v1), busy 3–5 frame
   windows where several things move at once (C, S, W), moves that never land sharp (S v2), sound 20–30 dB under the
   song (S v2), a misspelled brand for 1.9 s (G v1). All of these can be measured before a critic sees the film.
5. **Most of every free run went into tools that are not film-specific.** Opus spent 20% on the UI kit and 33% on
   scenes [Walk §1]; crimson wrote 4,454 lines in 4.3 h [Crimson App.]; W, S and G each built a capture rig or a
   renderer, an audio analyser, a sound synthesiser and review tools. The same crimson film as blocks is about
   12 beats of parameters [Crimson §6.1].
6. **Every good film was a pure function of time with one clock** (cue tables `cues.json`, `timeline.json`,
   `words_film.json`), so any frame rendered alone and every fix re-rendered only its frames. Bhippi's evaluator
   already works this way (`src/motion/evaluate.ts`), which is why the blocks can live in it as layers.
7. **Two film kinds need something the 2D compositor does not have.** G's look is refractive 3D glass with
   dispersion, a floor and light floods; G's maker wrote a GPU raymarcher for it. W's look needs a light UI on a
   white set, and Bhippi has no light theme [White §6, 12:43]. Both are called out as decisions in §4 and §8.

### 1.3 Where things stand

- **Done on the branch (not merged):** `analyze_song`, `review_frames`, `capture_app_session` with a demo world,
  `create_product_demo` (parts as 3D layers, a part camera, named cursors, per-part states, window explode),
  adaptive motion blur and per-layer shutter, 13 templates, three joins, two finish presets, render passes,
  `sound_the_motion`, five one-call recipes, playbooks, seed skills and a benchmark kit [TK-Review].
- **Still missing** (the rest of this plan): the pipeline fixes that caused the 10/100 (motion-first gather, budget
  advice, whole-film check, assembly safety), a measured critic, scripted AI turns and per-frame capture of the live
  app, the templates that tell Bhippi's own story (ask-and-work, timeline-build, state reveal, dive into the monitor),
  camera path smoothing and autofocus in the engine, light as a layer (sheen, key light, floods), time refs to beats,
  music re-editing, and a decision on 3D glass.
- Of the **105 building blocks** in §3: 30 are done on the branch, 7 exist on main, 34 exist in part and 34 are
  missing.

### 1.4 Top recommendations

1. Merge the branch (after the owner's three steps in [TK-Review]), then close the pipeline causes first: motion-first
   gather, no "stop looking" budget advice, a whole-film check, save and verify after every step (Phase 0).
2. Make the loop measure what the critics measured (Phase 1). It is the cheapest source of points.
3. Capture the app doing real work (scripted AI turns, the monitor playing per frame, a light film theme) and ship a
   pre-captured Bhippi part pack, so no film rebuilds the UI (Phase 2).
4. Ship the Bhippi-story templates and the engine pieces they need (Phases 3–4), then light, sound and the glass
   decision (Phases 5–7).
5. Benchmark the four finished films inside Bhippi, blind, with the same rubric; targets per film in §7.3.

---

## 2. Why the free Opus films beat Bhippi's pipeline

Each row is one cause, with the evidence on both sides, what the branch already closes and what is still open.

| # | Cause | The free films | Bhippi's pipeline (10/100) | Closed on the branch? | Still needed |
|---|---|---|---|---|---|
| 1 | The real product, alive, in states | 328 part textures at 4x, one per state [Study §2.2]; the live React UI with a Tauri stand-in [15s §2, White §3, Crimson §2.1] | 10 still PNG plates [Upgrade §0]; a GATHER handoff for the same brief in the repo lists 13 stills and one MP4 for 14 scenes [Gather] | Yes for capture: `capture_app_session` (branch: `src-tauri/src/app_capture.rs`, `src/lib/appCapture.ts`) | Scripted AI turns, per-frame live panels, a light film theme, a pre-captured part pack (§5.2) |
| 2 | The app was shown doing real work | Bhippi's own executor ran 51 tool calls (C) and 8 `place_clip` calls (W) on staged demo data; the film shows the edit it really made | GATHER ruled "must not fabricate application behavior"; provider rows showed "not signed in"; two captures were identical [Gather] | No | An honest staging rule and a `turn` capture step (§4.3, §6.3) |
| 3 | A camera through the product | Keyed `[x, y, s, rx, ry]` camera: close on a part, pull back to the tilted window, explode on the drop [Study §3.5–3.6] | 0 product-demo templates, 0 with DOF [Audit §1.6] | Yes: `create_product_demo` (branch: `src/motion/kit/productDemo.ts`) | Path smoothing, autofocus in the engine, a dive into a part (§4.2) |
| 4 | Timing to the word and the beat | Vocal isolated, words force-aligned, hero actions on word onsets, cuts on bars, small events on snares [Study §4] | Template slots on phrase times | Yes for measurement: `analyze_song` (branch: `src/lib/songMap.ts`, `src-tauri/src/vocal.rs`) | `{bar}`/`{beat}`/`{snare}` time refs and live binding (§4.1) |
| 5 | Render, look, fix | 37 loops, 36 sheets, 59 image reads in one run [Walk §8]; G iterated the whole film more than 20 times [Glass §3]; W rendered 13 versions [White §6] | Structural QA only; `judge_edit` has no light, reading size or sync measure (`src/lib/judge.ts`) | In part: `review_frames` (branch: `src/lib/reviewFrames.ts`) | The measured gates and a critic seat (§4.8, §6) |
| 6 | Whole-film judgement | G rendered a 540p preview of the whole film and judged its motion: it found the static middle [Glass §6, 06:59]; W cut sheets from the encoded MP4 and found a ghosted frame at a cut [White §6, 13:36] | Never happens. L itself never watched its film or ran a full-film check [Walk §8] | No | A whole-film pass with motion energy, light per second and join strips (§6.2) |
| 7 | Time and budget | One free turn of 96 min at max effort; ignored an "Over budget" note [Walk §0, step 1] | Medium effort; a 3 M-token soft budget that says "stop" (`src/lib/tokenLedger.ts:13, 68`) | In part: a one-click effort hint (branch: `src/lib/workflowRoute.ts` `filmEffortHint`) | Budget advice that never says "stop looking" (§6.1) |
| 8 | Stills stood in for scenes | Every scene an animated render | Still plates on V1 [Upgrade §0]; the repo's GATHER handoff: 13 stills and one 8.6 s MP4 of captured states for 14 scenes [Gather] | No | Motion-first gather; animated render scenes only (§6.3) |
| 9 | The recipes lived in the model's head | 1,800 lines of scenes (L), 4,454 lines (C), a raymarcher (G), a film page (W) | A weaker plan cannot reach them through template slots | Largely: 13 templates, 5 recipes, playbooks (branch: `kit/kineticTemplates.ts`, `kit/filmTemplates.ts`, `src/lib/filmRecipes.ts`) | The Bhippi-story templates (§5.1) |
| 10 | One lit world, one material | Warm stages with grain (L), exposure and saturation-weighted bloom (S), one glass material (G), a white set with pale glows (W) | Template looks, a glow that washes white UI grey [Audit §2.3] | In part: two finish presets (branch: `src/motion/finish.ts`) | Sheen, key light, floods, more stages and presets, the glass decision (§4.5) |
| 11 | Sound tied to the picture | 98 events on the frames of their actions (L); 53 CC0 cues anchored by kind (C); cues read from the film's own clock (G, W) | Effects not tied to the animation | Yes: `sound_the_motion` (branch: `src/lib/cueSound.ts`) | Music re-edit, pan with the move, in-key glass (§5.4) |
| 12 | Assembly and saving | L lost the song on A1 once and lost the whole timeline because it was never saved [Walk §9–10] | The same traps exist | No: `src/lib/editProgram.ts:121` still ignores `op.track` for audio on main and on the branch | Track-true audio placing, an error on "nothing changed", a checkpoint per phase (§6.3) |

**Notes on the causes.**

- *Cause 2 is new in this plan.* The free films were honest: the edit on screen is the one Bhippi's executor really
  made on a demo project. A GATHER handoff for this brief took "do not fabricate" to mean "do not stage", so it handed EDIT static
  screens with "not signed in" statuses. The rule should forbid invented UI and invented claims, and allow the real
  app performing a scripted task on demo data (§6.3).
- *What the free films did not need.* L used no bloom, no vignette and no animated grain [Study §0]. S and G used
  bloom only on saturated colour. The quality came from the product, the timing, the camera, the loop and one
  consistent light, not from heavy effects.
- *Cost.* The free runs are expensive and not editable: L is 23 flat MP4s; C cost about 4.3 hours and 4,454 lines;
  W took three sittings (the first two cut off by usage limits). Blocks bring the cost down only if they carry the
  craft, which is why §3 records every parameter the films used.

---

## 3. The building-block catalogue

Every technique the five finished films used, deduplicated across them. This is the list the engine should own so a
model chooses and fills instead of coding.

**How to read it.**
- **Films**: how many of the five finished films used the block, and which (L S C G W). Blocks borrowed from a
  reference that no film built are noted as such.
- **Status**: **Branch** = a ready-made piece exists on `native-ai-toolkit` (file given; paths relative to
  `D:\Bhippi-toolkit`); **Main** = exists on main; **Partial** = the parts exist but a model would still hand-author
  the look or timing (the gap is named); **Missing** = the engine cannot do it (the file it belongs in is named).
- **Value**: for Bhippi's users making product, launch, explainer and identity films, at fewer tokens.

**Totals.** 105 blocks: 30 Branch, 7 Main, 34 Partial, 34 Missing.

### 3.1 Capture and the real product

| ID | Block | Films | What it does | Parameters the films used | Status | Value |
|---|---|---|---|---|---|---|
| CAP-1 | Real app with a backend stand-in and a demo world | 3/5 S C W (L rebuilt the UI from the compiled CSS instead) | Boots Bhippi's real React UI in headless Chrome or Edge with a fake Tauri bridge (invoke, events, asset protocol) answered from a staged "world": project, clips, providers, licence, chat | World: 1 project, 6–22 clips, 4–6 providers, a chat log; media served over a local file server with Range | **Branch**: `src-tauri/src/app_capture.rs`, `src-tauri/src/cdp.rs`, `src/lib/appCapture.ts` (`bhippiAnswers`, `standinSource`) | Very high: every UI card in C and W came from it |
| CAP-2 | Parts per state at 3–4x with DOM boxes | 4/5 L S C W | Captures each named part alone (solo visibility, layout unchanged) in each state, transparent, with its CSS box, so scenes aim by name | DPR 3–4 (L 4, W 2–4); part origin ≥ 40 px (the 1x bug); `document.fonts.ready` + 300 ms; small-render scan (content < 45% of texture) | **Branch**: same files; `@composer`-style part names; resolution and font checks | Very high |
| CAP-3 | Typing, one picture per character | 3/5 L C W | Types into the real field and captures every keystroke state | L 139 composer states; C 34 at 3x; W 47 at DPR 4 with 26.8 ± 7 ms per key, +12 ms at spaces, +70 ms at full stops | **Branch**: `type` step with `part`/`partSelector` in `src/lib/appCapture.ts` | High |
| CAP-4 | Scripted AI turn executed by the app | 3/5 C W (S staged the finished chat state) | Plays both sides of an AI turn on demo data: the user types and sends; the stand-in streams thinking and issues real tool calls that Bhippi's own executor runs on its own timeline; each turn state is captured | C: 51 calls (`place_clip` ×20, `add_marker` ×13, `add_sound_effect` ×13…); W: `start`, thinking 3 words at a time, `get_comp`, 8 `place_clip`, reply, `done` | **Missing**: steps today are click, hover, type, key, wait, eval, capture (`src/lib/appCapture.ts:14-18`). Add a `turn` step in `appCapture.ts` and `app_capture.rs` | Very high: "the edit Bhippi really performed" was C's and W's best originality mark |
| CAP-5 | Live panel captured frame by frame | 3/5 S C W | Records a panel over time at film frame rate: the Program monitor playing the edit, the playhead, timecodes, meters | W pass C: monitor at DPR 3 for every film frame 8.8–12.4 s; C: 37 monitor frames at 15 fps; S: timecodes and scrub head at film time | **Missing**: a `play {selector, from, to, fps}` step, plus a deterministic UI clock (`window.__bhippiClock`) read by the app's animated components [Upgrade U1.2] | High: it is how the payoff (UI-9) is made |
| CAP-6 | Demo media pack | 3/5 S C W | Footage, thumbnails, filmstrips, waveform peaks in Bhippi's own formats so bins, timeline and monitor look alive | W: 6 clips from `public/wallpapers` with a sub-pixel move; S v2: nine real Mixkit clips (procedural filler lost points [15s crit 1]) | **Branch**: `src-tauri/src/demo_pack.rs`, `src/lib/demoProject.ts` (`demo:true`). Gap: W's payoff was "one near-still wallpaper"; the pack needs footage with real motion and cut points | High |
| CAP-7 | Capture theme and relight | 3/5 C S W | Makes a capture belong to the film's light: CSS override at capture, or relight a white stage dark by known-background matte | C: stage luma 227 → 28 by `out = F + (1 − a)(D − B)`; W: Bhippi has no light theme, so 37% of frames were over 30% dark | **Partial**: `eval` can inject CSS; no named theme option and no light film theme (`src/styles/themes.css` has dark themes only [White §6]) | High for light films |
| CAP-8 | Resolution tied to camera zoom | 3/5 L S W | Rasterise what the camera sees at the size it is seen; mipmaps when minified | S: raster boost K = pow2 ≥ 0.92·zoom ("the single biggest quality win"); L: 4x parts with 6 mip levels; W: zoom by layout, never `scale()` | **Partial**: stills get mipmaps (branch: `src/motion/gl/renderer.ts:171`); the demo holds zoom to what the capture supports and says so (branch: `kit/productDemo.ts` ~357, 469); no automatic re-capture at 4x | Medium-high |
| CAP-9 | Part library cache | lesson from L (8 full re-renders cost 10.8 min) | Captured parts are reused by later films; unchanged states are never re-captured | Keyed by app version, steps, size and scale | **Branch**: `captureKey` in `src/lib/appCapture.ts`. Gap: keyed by steps, not by what the project shows [TK-Review] | High (tokens and minutes) |

### 3.2 UI moves (what the product does on screen)

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| UI-1 | Per-part state swap on the action frame | 4/5 L S C W | A button, field or row changes state on the frame of the click; "a click only reads when its target changes on that frame" | Send glows 0.18 s before the click; composer empties after; rows need → typing → saving → ready | **Branch** for captures: `DemoAction.set`, pressed states (`kit/productDemo.ts`). Main's `create_ui_screen` still switches whole pages (`src/motion/ui/spec.ts:74`) | Very high |
| UI-2 | Ordered state reveal | 4/5 L S C W | A panel fills in the order it was made: stacked captures revealed clip by clip or row by row | L `wipe_post`: rows left → right with a 24 px soft edge; C: 18 cuts at 6.60 + 0.052·k as clip-path insets, razor flash e^(−t/0.07); W: landing ring + glow cooling over 0.42 s | **Missing**: a `reveal {target, order, edge}` action in `kit/productDemo.ts` and `src/motion/ui/spec.ts`; masks exist (`src/motion/types.ts` masks) | High: this is how you show an edit happening |
| UI-3 | Part lift-out | 3/5 L C W | A row or card lifts forward out of its panel while what is behind dims and blurs | W: translateZ 140·zoom, rotateX −3°, behind blurs 9 px and dims 42%, 0.9 px accent edge and 44 px glow; C: rotateX 28° → 0, pulse +3% on beats, header dim 90%; L: +1.2% scale, z −10, shadow | **Partial**: parts are 3D layers (branch), no `lift` action | Medium-high |
| UI-4 | Box-to-box morphing crop | 2/5 W C | A rounded window travels from one element's box to another's (composer → conversation card → whole window) with its shadow following | W: `inset(... round r)` from the composer box to a 262 px card, inOutCubic 0.36 s, radius 16 → 14; card height eased 0.2 s to each streamed state | **Missing**: masks are keyable but nothing drives them from part boxes; add `morph-crop` in `kit/productDemo.ts` | High for light and white films |
| UI-5 | Exploded window | 1/5 L (+ the launch-film recipe) | The window's panels float apart in depth, then slam back on the drop | Depths back +520, header +300, chat −420, program +120, props +300, project −170, tools −70, timeline −280, meters +170, status −110; spread 7.5%; orbit to s 0.64, rx 15, ry −33; aperture 7 × explode; slam in the last 0.43 s on cubic-in; warm flash 0.55 | **Branch**: `window-explode` (`kit/productDemo.ts`) | Medium |
| UI-6 | Real control driven through its states | 2/5 L S | A control the words name is operated on the beats | L: popover opens 0.16 s, scale 0.94 → 1, rise 10 px; slider snaps on 3 beats, 5 eased in-betweens each (u 0.35, 0.62, 0.82, 0.94, 1.0), cursor follows the knob; S: chips light on the snare 0.1 s apart | **Partial**: `set` and `hover` actions (branch); no in-between states generator | Medium |
| UI-7 | Live data in the UI | 2/5 L S | Waveforms, meters and level bars driven by the real song | S: waveform 250 buckets/s; meters with 150 dB/s release and 1 s peak hold from 5 ms peaks; L: bars from the song's RMS at 60 Hz | **Missing**: no audio-driven property in `src/motion/expr.ts` or `types.ts` | Medium |
| UI-8 | Streamed text into a growing panel | 2/5 W S | The reply streams in and its card grows to fit, so the empty panel is never on screen | W: card bottom = message bottom + 26 px, eased 0.2 s per streamed state, 0.34 s when the list opens | **Missing** (needs CAP-4 captures and UI-4) | Medium |
| UI-9 | Dive into the monitor: the payoff | 3/5 W S L | The camera flies into the Program monitor until its picture fills the frame, landing on a downbeat as the AI's own edit cuts; then the edit plays full frame | W: zoom 1920/707 = 2.716, rotations to 0, land on bar 7 (9.818 s), swap to a DPR-3 capture above zoom 1.55, warm bloom 42%; S: monitor flashes each new shot for 0.155 s; L S22: the finished film playing in the real window | **Missing** (needs CAP-5 and JOIN-2) | High: W's critic called it the film's signature |

### 3.3 Camera and depth

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| CAM-1 | Keyed 3D camera over a UI group | 5/5 L S W G (C: per-card 3D in a drifting world group) | Keys `[target x, y, zoom, rx, ry]`; zoom is a dolly, keyed in log space | `dz = D(1 − 1/Z)`; perspective f 1500 at z −1500 (L), CSS perspective 2000 px (S) | **Branch** for captures: `cameraFor` and camera stations (`kit/productDemo.ts` ~160, 444–521). Main's UI compiler zoom is a 2D scale (`src/motion/ui/compile.ts:457-466`) | Very high |
| CAM-2 | Close on a part, pull back to the tilted window | 3/5 L S W | The core product move | L S02: 3.55 → 2.75 → 2.55 on the composer, 1.75 (rx 2, ry 5) up the chat, 0.84 (rx 5, ry −9) over 1.4 s; S: 3.0 → 0.86 in 1.8 s with a 25° swing; land 10 frames sharp, ≤ 1% drift | **Branch**: `DemoShot` with `focus` or `wide` | Very high |
| CAM-3 | Continuous-velocity camera path | 2/5 S G (W drifted on noise) | Chained moves never stop dead between keys | S: Gaussian low-pass of the sampled path, 13 taps, σ 55 ms (15 ms around a whip); G: monotone cubic Hermite (Fritsch–Butland) keys, `SP()` in `renderer\timeline3.js:58-71` | **Missing**: eases are per segment (`src/motion/anim.ts`); add a `smooth` key interpolation | High |
| CAM-4 | Breath and slow push on holds | 5/5 | No hold is ever dead | S: ±5 px, ±0.25° at 0.3 Hz; C: world drift ±5/±4 px, ±0.25°; W: glow centres drift ±3–7% at 0.14–0.18 Hz; L, W, G end cards push 3–5% | **Partial**: `wiggle` (`src/motion/expr.ts`), the demo's 1.2%/s push (branch: `kit/productDemo.ts:503`); no camera field | High: dead holds cost points in S v1, W and G v1 |
| CAM-5 | Autofocus | 2/5 S G | Focus follows the target, with an optional lag for a rack | S: focus f = D/Z; G: focus on the mark, aperture 0.065 | **Partial**: the demo writes focus keys itself (branch); the engine has no `focus: 'poi'` or `focus: {layer}` (`src/motion/evaluate.ts` `cameraAt`) | High |
| CAM-6 | Per-pixel depth of field on tilted planes | 4/5 L S G (W faked it with a masked blurred twin) | A tilted window is sharp at the focus line and softens toward the far edge | S: depth per pixel from the camera homography, blur stack σ {1.2, 2.6, 5, 9, 16, 24}, tent blend, clamp 22 px; L: `coc = 0.5·aperture·f·abs(invz − 1/focus)` | **Missing** [Upgrade U4.2]: corner depths in `evaluate.ts`, a CoC stack in `src/motion/gl/effects.ts` and `gl/shaders.ts` | Medium-high |
| CAM-7 | Near-plane safety | 2/5 S L | No corner of a plane passes behind the camera | S: every corner w ≥ 0.04 (3.9x at 40° yaw broke frames; 3.4x, 28°, 10° is safe) | **Partial**: the demo eases its tilt when a corner nears the camera (branch: `kit/productDemo.ts:452-459`); no clamp or report in the engine | Medium |
| CAM-8 | Rack focus under a line | 3/5 S W C | The world softens and dims while a line sits over it | S: +3.2–4.2 px blur and 32–42% dim, in 0.3 s, out 0.28 s; W: whole-shot blur 16 → 0 px over 0.42 s after the drop; C: plate blur 12 → 0 over 0–0.30 s | **Partial**: blur and brightness keys exist; no preset | Medium |
| CAM-9 | Orbit round a hero with parallax | 3/5 G L C | A slow turn round the subject with things at depth giving parallax | G: yaw 0 → −40° by 8.7 s, crane +12°, distance ×0.81, beads at depth; C end card: cards far behind at 26%, blur 8–13, rotateY ±18° | **Partial**: camera parenting and `card-wall-3d` (`src/motion/kit/overlayTemplates.ts:1198`) | Medium |
| CAM-10 | Framing solver | 1/5 G (every critique found safe-area misses in S, C, W) | Simulates every element's screen position through the camera move and keeps it title-safe and clear of the subject | G `tools\sat_paths.mjs` prints each bead's screen position and size over time; `sat_search.mjs` searches orbits scoring title-safe, clearance and side | **Missing**: `src/motion/safeArea.ts` ignores 3D layers (line 71); add a projected check | Medium-high |

### 3.4 Cursors

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| CUR-1 | Named multiplayer cursors | 3/5 L S W | One cursor per actor tells the story: You, Bhippi, each AI with its logo | Tag at (+14, +25), right of the tip; constant screen size 1.6–1.8x; arcs ±0.08–0.12; press −14% (0.05/0.22 s); ring 16 → 86 px over 0.5 s at (1 − u)·0.9; dwell 55 ms; jitter ±2 px at 1.3 Hz; W: ring scale 1 → 3.6 | **Branch**: cursors in `kit/productDemo.ts` (~80, 526–680), marks in `src/lib/providerMarks.ts`. Main has one unlabelled cursor (`src/motion/ui/compile.ts:70-87`) | Very high |
| CUR-2 | Role-tagged worker cursors | 2/5 S L | Several Bhippi cursors (Cut, Titles, Sound) build the edit; each parks inside what it built | Tag bottom ≤ y 970, never over a label (a v1 frame read "Titles ditor…"); overlay shutter 72° | **Missing**: needs SCN-2 and a tag-overlap check | Medium-high |

### 3.5 Type

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| TXT-1 | Word lands on the voice | 5/5 | Each word is readable on its syllable | S: reveal 35 ms early; opacity 0.16 s, blur 18 → 0 over 0.35 s, rise 0.24 em over 0.5 s, scale 1.035 → 1; exit blur 16 px over 0.28–0.35 s; C: rise 34 px, blur 16 → 0, scale 1.06; W: rise 46–60 px, blur 10 → 0 | **Branch**: `word-land` (`kit/kineticTemplates.ts`) on main's `TextCascade` and `{word}` refs (`src/motion/types.ts:147-161`, `src/lib/motionTools.ts`) | Very high |
| TXT-2 | Colour arrival | 4/5 C W S L | A word arrives in one colour and settles in another | C: grey (138,131,131) → white (247,243,241) over t0 + 0.07…0.36; W: arrives Bhippi blue, cools to ink over ~0.7 s; S: keyword gradients (#A6D4FF → #2D8CEB, #FFD08A → #FF6A12) | **Partial**: `dimTo` dims opacity, not colour (`src/motion/text.ts:289-291`); add a per-unit colour ramp | High, cheap |
| TXT-3 | Type-on on word onsets | 3/5 L W C | A line types from each word's onset, gliding to its new centre | 46–66 ms per character; caret 4×62 px, 1.65 Hz at 58% duty, solid 0.35 s after a key; re-centre over 7 frames 22 ms apart | **Branch**: `TypeOn.times`, `recenter` (`src/motion/types.ts`, `text.ts`), `type-on-voice` | High |
| TXT-4 | Fly through a letter | 2/5 L S | The camera plunges through a letter into the next scene | L: zoom exp(ln 270·(0.35u + 0.65u^2.2)) over 1.0 s, pixelate 36 → 1 px over 0.44 s, zoom blur 0.07; S: scale 1 → 8 in 0.36 s quart-in, ember flash peak 0.46 | **Branch**: `fly-through-word` | High (best transition in S and L per both critiques) |
| TXT-5 | Hero lines staggered beside a device | 2/5 W C | Short lines, one per beat, stepped beside a product card | W: "Bring / your own / AI." at 122 px, line height 1.1, indent 52 px per line, one line per soft beat; C: "Connect / your *AI*" left of the providers | **Missing** as a layout | Medium |
| TXT-6 | Tracking flash | 1/5 W (from the Workly reference) | The line turns white and tracks out inside a full-frame colour flash | 3–6 frames; tracking −0.038 → +0.10 em; the critic asked for 6 frames, centred, royal blue #2B4BF2 → #5A82F1 | **Missing**: tracking animator exists, no template | Medium |
| TXT-7 | Line splits to admit an object | 1/5 W (Workly reference) | The line parts on a beat and the logo springs into the gap | W: parts in 0.36 s; logo springs 2.0 Hz, damping 0.48, from −120°, blur 8 → 0 in 0.28 s; the pushed word always travels 70 px further so they never touch | **Missing** | Medium-high (end cards) |
| TXT-8 | Emphasis spans | 3/5 C S L | Italic serif or a colour for the key word | C: Fraunces italic ~16% larger; L: "producer" in molten #ff2d1a → #ffb347 | **Main**: `TextSpan` (`src/motion/types.ts:163`) | Medium |
| TXT-9 | Glyph anchors | 2/5 L G | Other layers attach to a measured glyph: inside a stem, the dot of an i | L: anchor inside the stem of the "d" (9 px wide); G: dotless "Bhıppı" with the measured tittles as glass beads that pop 1 → 1.6 → 1 on kicks | **Partial**: `fly-through-word` measures a counter letter internally | Medium |
| TXT-10 | Reading-hold rules | 4/5 S C W L | Text holds long enough to read, once | Phrase holds past its last word; pill words readable ≥ 0.6 s; brand name sharp ≥ 0.35 s; one copy of each phrase; cap height ≥ 26 px at 1080p | **Partial**: `label-pill` and `end-card` holds, `review_frames` repeated-phrase (branch: `src/lib/reviewFrames.ts:113`); no general `minHold` in `src/motion/validate.ts` | High |

### 3.6 Components

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| CMP-1 | Product card | 3/5 C W L | A capture in a rounded card that lands with a spring and a turn, then catches one sheen | C: radius 12–22 px, rim 1.5 px rgba(255,92,110,.42), glow 34 px, shadow 0 34px 90px; spring 2.2 Hz ζ 0.62 from 0.86; rotateY −38° → 0 through 1900 px; blur 12 → 0 over 0.24 s; one sheen 0.55 s. Used 12 times in C's 15 s | **Partial**: `slam-tilt` is one card move (branch); no general card with sheen | High |
| CMP-2 | Label pill | 3/5 C S L | Names what is on screen | 42 px tall, radius 21, fill #e7233e → #c3122c; springs 2.8 Hz ζ 0.6 from 0.78; words 0.10 s later, 0.03–0.05 s apart; holds ≥ 0.6 s; attaches to a layer | **Branch**: `label-pill` (`kit/kineticTemplates.ts`). Gap: attaches to a rectangle, not to a moving layer | High |
| CMP-3 | Soft warm shadows | 4/5 L W C G | Shadows that read soft on light stages | L: warm brown (70,40,20), alpha 0.24–0.34, blur 24–70, offset +26 px; W: `0 46px 80px -22px rgba(16,24,48,.40)` + `0 16px 30px -12px …28`, as its own layer so it follows a morphing crop; G: coloured shadow of light through glass | **Partial**: drop-shadow (main), `cardShadow` in `launch-light` (branch: `src/motion/finish.ts`); no contact shadow on a floor [Audit G10] | Medium-high |
| CMP-4 | Landing accent | 5/5 | Any landing gets a small ring, glow or pop | S: ripple 5 → 31 px in 0.42 s, ember glow decaying 2.2/s; L: green ring 20 → 140 px, 3.5% pop; W: 2 px ring + 30 px glow cooling 0.42 s; C: badge ring ×3.4 over 0.45 s; G: ripple of light through the mark | **Partial**: `ripple-rings`, `glow-ring` (main), per-template rings (branch); no one `landing` helper for any layer | High |
| CMP-5 | Hub and spoke | 4/5 L S C G | "Connect your AI" without a word | L: tiles on their words 0.2 s apart, wires 0.28–0.32 s, 3 pulses per wire 0.42 s apart, hub pulses on beats, squeeze into the centre behind a flash; G does the same beat as light: beads charge and dive into the slot | **Branch**: `connect-hub` (`kit/filmTemplates.ts`) | High |
| CMP-6 | Drop into slots | 2/5 C L | Items arc in from off-frame and land in a panel's slots | C: 0.42 s flights on `out3`, stagger 0.085, scale 2.1 → 1, spin (−24 + 7i)° → 0, blur 6 → 0, spring 3.2 Hz ζ 0.45; L: cards fly from corners 0.30 s, 1.35 → 0.16, land on 0.16 s steps | **Missing**: `Key.arc` exists (`src/motion/types.ts:39-45`), no template | Medium |
| CMP-7 | Keycaps | 1/5 L | Keys rise on the bar and are pressed on the word and on its echo | Rise 420 px; 10 px press; ring flattened to 0.55; 60 px smear; the timeline reverts on the same frame | **Missing** | Low-medium |

### 3.7 Scene templates (whole moves)

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| SCN-1 | Ask and work | 4/5 L S C W | The story beat: the user types a short prompt, sends it on a snare, and Bhippi's work reads on screen | Type ~5 words at ~22 chars/s; press 0.92 → 1 on the snare; the bubble springs up at a 60–72° shutter (a 180° shutter smeared it into a "barcode" in S v2); hold on the work list at cap height ≥ 26 px; steps tick 0.25 s apart; light the hold (panel background −30%, key light on the list, 3% push) | **Partial**: possible with `create_product_demo` actions; the `ask-and-work` template is not built [TK-Review] | Very high: its absence capped S's story score |
| SCN-2 | Timeline build | 4/5 L S C W | The edit happens: clips land on the beat grid while the monitor shows each new shot | S: spring 4.4 Hz ζ 0.6 from 22 px above, scaleX 0.6 → 1, ember outline decaying 2.2/s, ripple 5 → 31 px; monitor flashes each shot 0.155 s; W: landings on eighths; L: 23 clips at 52 ms steps; C: 18 razor reveals | **Missing**: `timeline-build` is not built [TK-Review] | Very high: Bhippi's own product moment |
| SCN-3 | Hook with a subject pop | 1/5 C | A talking-head hook: words either side of the head, the subject pops between them with a converging echo, holds, shrinks to a centred card, rests, parks as a PiP on a word | Echo ±96 px converging over 0.26 s, burning off 0.56–0.80 s; shrink with (0.45, 0, 0.12, 1) to scale 0.37; park at scale 0.20 over 0.54 s | **Partial**: `subject-reveal` (`src/motion/kit/subjectReveal.ts`), `frame-to-card` (`kit/overlayTemplates.ts:1178`); no echo-converge, rest or park | Medium-high (explainers) |
| SCN-4 | Card slam on a bar | 3/5 C S L | A card lands hard on a bar, then dollies | Scale 1.32 → 1, rotateX 26° → 13°, blur 18 → 0 in 0.22 s | **Branch**: `slam-tilt` | Medium |
| SCN-5 | Rise out of | 2/5 C (W's reference) | A card rises out of another while the parent settles lower | rotateX 34° → 0, +356 px, spring from 0.8 | **Missing** | Low-medium |
| SCN-6 | Contrast beat | 1/5 L | "Most AI hands you a clip": a cool grey stage and one grey clip, then the product grabs it and the stage warms | Grey clip luma mix 0.75; morph into the first V1 clip 0.32 s | **Missing** (the cool stage exists in the demo) | Medium (story) |
| SCN-7 | Logo lockup and end card | 5/5 | The brand lands and holds | Mark 0.86 → 1, blur 10 → 0 in 0.34 s; wordmark +0.08 s from −50/−70 px; tagline word by word; CTA +0.70 s clicked; backdrop of the film's own shots at 26%, blur 8–13; heartbeat on beats; push 3.5–4.5%; name sharp ≥ 0.35 s; picture fade over the last 8 frames | **Branch**: `logo-lockup`, `end-card` (`kit/kineticTemplates.ts`), `glass-mark` (`kit/filmTemplates.ts`) | Very high |
| SCN-8 | Presenter character | 1/5 C | Bhippi's library character talks with real lip sync, celebrates on beats, jumps between layers | C captured 243 PNGs of a generic talk loop; the critic wanted real lip sync | **Partial**: `character` layer and `lip_sync_character` (main); no beat-locked poses or jump along an arc | Medium |
| SCN-9 | Light as an event | 3/5 L S G | Light itself is the action: a window powers on, a pool opens, colour runs through the mark | L: 260 px smoothstep front from 24% brightness and 25% saturation, warm rim [1.0, 0.72, 0.45]·0.22; S: prologue pool, 70% dark outside, breathing on snares; G: ember front from the top slot over 0.52 s with a white-gold edge | **Missing** (needs LGT-3) | Medium-high |
| SCN-10 | Card montage round a hero card | 1/5 (C's reference; C lacked it) | Small cards fly in round a resting card | Defaults are the Crimson Brief's own | **Main**: `card-wall-3d` (`kit/overlayTemplates.ts:1198`) | Medium |

### 3.8 Joins

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| JOIN-1 | Camera match | 2/5 L S | The next scene opens on exactly the camera the last one ended on | L: S02 → S03 at [960, 520, 0.84, 5, −9] | **Branch**: `camera-match` (`src/motion/joins.ts`, `sequence.ts`) | High |
| JOIN-2 | Plunge into the next subject | 2/5 L W | The camera pushes into the part the next scene opens on (or until a part fills the frame) | L: S06 ends on the composer at 2.6x, S07 is the composer; W: the monitor dive (UI-9) | **Missing**: `plunge` [Upgrade U3.9] in `src/motion/sequence.ts` | High |
| JOIN-3 | Whip | 4/5 L S C W | One pan across the cut | 0.3–0.46 s on expo-in; 120° shutter, 7–8 frames, landing sharp; C: exit 1150–1400 px, blur 12–16 | **Branch**: `whip-pan`, per-layer `shutter` (`src/motion/types.ts`); main has `whip` | Medium |
| JOIN-4 | Glow point handoff | 2/5 L G | A light point becomes the next scene's element | L: the send glow grows 60 → 320 px, then contracts 300 → 90 px into the mark | **Branch**: `glow-handoff` | Medium-high |
| JOIN-5 | Flash bridge | 4/5 L W C G | A flash hides a hard change on a drop | Warm white (1.0, 0.97, 0.92) at 0.5–0.9 on cubic-in, mirror decay; W: 3–6 frames of full-frame brand colour | **Branch**: `flash-bridge` (warm). Gap: a coloured flash with tracked type (TXT-6) | Medium |
| JOIN-6 | Light flood white-out | 1/5 G | Light grows until it owns the frame on a transient, then recedes through a hole that opens from the subject outward | Flood owns the frame on the clap at 10.80; 14 shards 0.5–0.9 px wide, brightness 0.25–0.55, plus 56 dark dust specks, only in the blue part of the flood; hole radius by spline −0.12 → 0.17 → 0.60 → 1.45 over 0.95 s, softness 0.09 | **Missing** | High for identity films |
| JOIN-7 | Blur bridge | 3/5 L W S | Out as a blur and desaturation, in from a blur | L: out 10 px + 80% desaturation, in from 8 px; W: defocus into cuts 0 → 14 px (inQuad) | **Main**: `blur-bridge` (`src/motion/sequence.ts`) | Low |
| JOIN-8 | Morph instead of a cut | 2/5 G W | One shape becomes the next | G: sphere → disc → ring as an iris over 0.75 s; W: composer box → card (UI-4) | **Partial**: vector `morphTo` (main); box morph and 3D morph missing | Medium-high |
| JOIN-9 | Match-grow cut | 1/5 C | A PiP grows until an anchor in it lands on the same anchor in the next shot, which crossfades in around it | Grow 0.28 s on (0.55, 0, 0.12, 1); crossfade 0.10 s; scale solved from measured anchors | **Branch**: `match-grow` | Medium |
| JOIN-10 | Recede | 1/5 C | The hero recedes before the next lands on an empty field | ×0.76, blur 10, fade, 0.22 s | **Main**: `z-recede` | Low |
| JOIN-11 | One move at a time | 3/5 S C W (every critique) | No two competing moves in one 0.25 s window; heroes land on empty space | Stagger exits 4–6 frames; clear the frame, then land at final size 3 frames early, opaque in 2 frames, blur ≤ 4 px; never a mark over 500 px across content | **Missing**: a rule in the sequence compiler (`src/motion/sequence.ts`) and a gate (REV-3) | High: C's and S's remaining faults were all this |

### 3.9 Light, material and finish

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| LGT-1 | Finish presets | 5/5 | One grade for the whole film, as one editable layer | Dark (S v2): +0.7 EV linear, shoulder knee 0.45 ceiling 0.80, gamma 0.85, bloom on saturated colour (threshold 0.7, knee 0.2, strength 0.32), vignette 10%, grain σ 0.011, dither. Light (L): static grain 1.1/255, no bloom, no vignette. Crimson (C): bloom soft knee 0.42 ×0.36 warm, CA ±0.0011, vignette 0.16·r^2.4, mid-tone grain 0.003–0.008. Studio (G): ACES, 7-level bloom, CA 1.2 px at corners, grain 0.010, 1-LSB dither | **Branch**: `launch-light`, `launch-dark` (`src/motion/finish.ts`). Gap: crimson, studio and white-clean looks | High |
| LGT-2 | Sheen (specular sweep) | 4/5 C S G W | A soft highlight crosses a card, window or logo once | 105–115°, 0.55 s, screen blend, 10% white; S on the snare at 4.45 and 12.55 s; G: a strip light band 13.4–14.3 s with a ±0.055 dispersion fringe; W: glint on the logo on the hit | **Partial**: a sheen shape inside `glass-mark` only (branch: `kit/filmTemplates.ts:241`); no effect for any layer [Audit G10] | High, cheap |
| LGT-3 | Key light | 3/5 S L G | A soft light pool that follows a point or part | S v2: warm radial, screen blend, re-placed every frame, strength 0.25 × clamp(1.7/Z, 0.42, 1), moved onto the work list for the chat hold; G: painted key light sweeping 128° → 80° | **Missing**: no light layer in `src/motion/types.ts` | High (legibility) |
| LGT-4 | Flares and streaks | 2/5 G C | A four-point star with an anamorphic streak at a point; comet streaks with a hot head | G: star size 0.16–0.22; streak core 3.4 px Gaussian, two-scale halo, head 5× core; C: flash e^(−t/0.06) × 0.72 + ring 1.6 → 10.6 over 0.55 s | **Partial**: `burst-flash` (`kit/funTemplates.ts:358`), `glow-ring` | Medium |
| LGT-5 | Glass logo, 2D | 3/5 L S C | A logo as glass: bevel from the blurred alpha, inner glow, refraction, halo | Materials ember, clear, frosted, tinted | **Branch**: `glass-mark` (`kit/filmTemplates.ts:83-130`) | High |
| LGT-6 | Mark rig for split marks | 3/5 C S G | A multi-part logo lands shut on a beat, clacks, thinks and beats | Halves 62–75° → 0 exactly on the beat; clack −9°·e^(−7u)·sin 26u; think 7–10° apart turning 48°/s; heartbeat +6° on beats; appear 3 frames early at 1.15×, opaque in 2 frames; hide while > 30° open (C's "bowl" frames) | **Partial**: `landing: "swing"` and `clack` for Bhippi's vector mark (branch: `kit/filmTemplates.ts`); no automatic split of any logo PNG by connected components | Medium-high |
| LGT-7 | Stages | 5/5 | The living backdrop every beat sits on | Light cream #F7F5F1 → #EDE9E3 with a highlight; peach #FCE8DB with 16/80 px hairlines; cool grey; dark ember #0b0605 → #2c1208; crimson field with two breathing corner glows (±12% at 1.1–1.3 rad/s), a drifting band, a top shade, 28 motes and world drift; W's white set #eff2f7 with pale-blue corner glows drifting on noise; G's navy studio with a lavender backlight panel and a glossy floor fading into haze | **Partial**: light/grid/cool/dark (branch: `kit/productDemo.ts:296-304`), light/peach/dark (`kit/filmTemplates.ts`), `crimson-stage` (main: `src/motion/gl/procedural.ts:27`, `kit/common.ts:107`). Missing: breathing and drifting glows, band, the white set, the studio floor | High |
| LGT-8 | Motes and bokeh | 2/5 C G | Air in the frame | C: 28 motes 8–54 px rising 10–44 px/s; G: 64 motes with analytic circle of confusion | **Main**: `bokeh`/`dust` particles (`src/motion/particles.ts:8`) | Low-medium |
| LGT-9 | Construction hairlines | 2/5 G L (the Workly reference too) | Arcs, guides, handles and boxes that draw on in a layer's plane: the film shows its own setting-out | G: arcs with trim and start angle, square handles 0.011–0.013, 0.8–1.15 px lines with a 1 px RGB fringe; L: selection box with corner handles | **Partial**: shape trim paths (`src/motion/gl/raster.ts:216`); no preset | Medium |
| LGT-10 | One lit world | 3/5 S C W | Keep the whole film bright enough and lit as one | Mean luma 45–60 on a dark film; 98th percentile ≥ 200 on UI shots; no jump > 2× the running mean; dark-UI share ≤ 30% per second (W measured 0.44–0.56) | **Partial**: `dark` finding (branch: `src/lib/reviewFrames.ts:107`); no luma jump or dark share | High |
| LGT-11 | Precision: saturation bloom, float targets, dither | 3/5 S G W | No banding in dark gradients or pale glows | S: bloom weight 0.25 + 0.75·sat; G: float32 accumulation, 1-LSB dither; W: grain strength 2 at encode because x264 flattened the dither (38% flat 3×3 blocks → 13%) | **Partial**: half-float accumulation for motion blur (branch: `src/motion/gl/core.ts`); full RGBA16F targets and dither missing [Upgrade U4.3] | Medium |
| LGT-12 | Floor, caustics, coloured shadow | 1/5 G | A glossy floor reflecting the subject and fading into haze; light through glass casting a coloured shadow | Floor 0.12 below, reflectance 0.25, glossy blur 0.035, fade 1.4–6.5 units; card shadow offset (0.30, −0.46), blur 0.26, a hot caustic spot | **Missing** | Medium (identity films) |

### 3.10 3D material hero (the glass-identity film's own blocks)

Harvested from `LAB\glass-identity` for this plan (its harvest was cut off).

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| MAT-1 | Logo to a smooth distance field | 1/5 G | Turns a logo PNG into a signed distance field whose edges are smooth enough to light as glass | v3: marching squares at alpha 0.5 with sub-pixel crossings, one closed loop per part, resampled every 0.5 px, smoothed along the arc with σ 5 px, exact point-to-segment distance within ±52 px (`mark\make_sdf3.py`); raster fields made scratch-like streaks on the walls | **Missing** | Medium-high (needed by MAT-2) |
| MAT-2 | Refractive 3D glass logo | 2/5 G (L reused a Blender glass render) | The real mark as extruded, bevelled, refractive glass with dispersion, drawn in a designer's "illustrated" look | Extrude h 0.14, bevel r 0.07; IOR 1.5 with dispersion `3.0·4200·(1/λ² − 1/550²)`; Beer–Lambert absorption (blue σ (5, 2.4, 0.2) after the critique); up to 3 internal events; a painted body keyed to the 2D field (rim to core gradient, bevels lit by direction, a caustic line 0.036 inside the edge); 32 samples per pixel for motion blur, DOF, AA and dispersion together | **Partial**: the Blender route `render_3d_scene` (main: `src/lib/ai-tools.json`) and render passes (branch: `src/lib/renderPasses.ts`) can deliver it as layers; nothing native | Medium-high |
| MAT-3 | Shape morphs in 3D | 1/5 G | A sphere becomes a ring as an iris; the ring is scored and cut into the two Cs; an ember becomes the B | Iris: inner radius −0.08 → 0.605 over 3.45–4.20 s, quartic-out with the first 10% eased in; the score groove deepens only once the ring is complete (a straight mix pinched into V-notches) | **Missing** | Medium |
| MAT-4 | Satellites and dives | 1/5 G | Flecks leave the orb and orbit at depth; three of them ("your AI") charge, dive through the slot and land with a ripple through the mark | Orbits R 1.2–3.0 at 0.04–0.09 rad/s; charge 0.30 s, star 0.17, flight 0.40 s on a quadratic Bézier, landings on "con-NECT", "YOUR", "A-I" (8.96, 9.16, 9.52 s); ripple radius 0.45 + 2.0t, amount 1.1e^(−t/0.32) | **Missing** | Medium |

### 3.11 Sound and sync

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| SND-1 | Beat grid, bars, drops, sections | 5/5 | The clock every film hung its cuts on | L: 99.030 BPM, phase 0.456 s, residual < 5 ms by exhaustive search; W: 98.96 BPM refined to transients within ±90 ms; G: 98.7 BPM + pluck and chord-change onsets | **Branch**: `analyze_song` (`src/lib/songMap.ts`) | Very high |
| SND-2 | Vocal isolation and lyric alignment | 5/5 (word times); 2/5 isolated the vocal (L S) | A time for every sung or spoken word | Centre mask sim^10, 140–7500 Hz; the lyric sheet's words with the vocal's times; C corrected Whisper onsets > 40 ms off to the 10 ms RMS envelope | **Branch**: `src-tauri/src/vocal.rs`, `alignLyrics` (`src/lib/songMap.ts:148`) | Very high |
| SND-3 | Beat and snare time refs | 3/5 S L W | Scenes say "on the next snare" or "bar 7", not a number | S: snares on every second beat at 1.058 + 1.2114·k; L: `bar(m) = 0.456 + (3 + 4m)·0.60588` | **Partial**: bars and hits are in the song map; scenes only take `{word}` refs (`src/lib/motionTools.ts`) | High |
| SND-4 | One live clock | 4/5 G W C S | Animation keys stay bound to words and beats when the audio edit changes | G `audio\cues.json` → `timeline3.js`; W `film\timeline.json` read by the audio builder; C `words_film.json` | **Missing**: refs are resolved once at build time | High |
| SND-5 | Music re-edit | 4/5 C G W S | Fit the song to the film: bar-aligned splices hidden under transients, a reverse swell into the drop, a filtered break, a jump to the sung tag | W: splice 4 ms before a snare, 16 beats later, 8 ms equal-power crossfade, chroma loop check (cosine 0.85–0.93); G: splice 20 ms before a clap; C: reverse swell from the drop's own first 0.9 s, break low-passed 12 kHz → 500 Hz, jingle bar with a +2 dB shelf | **Missing** | High: every 15 s film re-edited the song |
| SND-6 | Put a word on a beat | 1/5 C | Cut a voice-over into phrases in its silences and place it so a named word lands on a named beat | Silence < −45 dB, 8 ms joins, `atempo 1.06`, a 0.30 s pre-lap | **Missing** | Medium |
| SND-7 | A sound on every motion cue, set against the song | 5/5 | Every UI event is heard | L: 98 events; S v2 fix: −10 to −12 dB relative for ticks, −6 for the send click; branch rule: loudest 10 ms about 6 dB under the music at that moment | **Branch**: `sound_the_motion` (`src/lib/cueSound.ts`) | High |
| SND-8 | Sound kit | 5/5 | The sounds themselves | UI set (key click, send pop, soft whoosh, glass tick, cursor tap); G: struck glass from bar partials 1 : 2.756 : 5.404 : 8.933 in the song's key; STFT band-swept whooshes; a riser cut dead on the drop; C: razor run of 18 snips at −24 dB; sub booms | **Partial**: 5 UI sounds (branch: `src-tauri/src/sfx.rs`) and CC0 search (main); in-key glass, band-swept whoosh and razor run missing | Medium-high |
| SND-9 | Anchor by kind, pan with the move | 3/5 C G W | Hits on their onset, whooshes on their peak, risers ending on the hit; panned with the move | C: onset = first point within 12 dB of the peak; G: whooshes panned from each bead's screen side to the centre | **Partial**: risers are trimmed onto their hit (branch fix `28aec2f`); no pan | Medium |
| SND-10 | Master | 5/5 | Loudness and dynamics that suit the film | −16 LUFS / −1 dBTP (S, G); −14 LUFS (C, W); ducking 30/280 ms up to −7 dB (C); G's critic asked for LRA 6–8 LU on a delicate film (v2: 7.3) | **Partial**: mix check in `review_frames`, export loudness (`src-tauri/src/render.rs`); no LRA target by film kind | Medium |

### 3.12 Review and workflow

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| REV-1 | Frames at event times, join strips | 5/5 | Look where something happens, and across every cut | 4–9 frames at clicks, flips, landings and both sides of cuts; 6-frame strips 0.06 s apart | **Branch**: `review_frames` (`src/lib/reviewFrames.ts`, `src/lib/polish.ts` contact sheets). Gap: cuts inside one motion sequence are not stripped [TK-Review] | Very high |
| REV-2 | Whole-film motion preview | 4/5 G W C S (L never did, a named mistake [Walk §10]) | Watch the whole film as motion and measure it | G: 540p preview of the whole film at 46 ms/frame (21 s), 5–10 fps sheets; motion energy = mean absolute frame difference at 240 px per second, compared with the reference's (0.7–1.2 on slow turns); W: sheets cut from the encoded MP4 itself | **Missing** | Very high |
| REV-3 | Measured gates | 4/5 S C W G | The faults critics found, measured first | Reading size (cap ≥ 26 px); landing sharpness (≥ 10 frames within 10% of the still, mean abs. Laplacian); luma per second and 98th percentile; dark share; luma jump; busy transitions; orphan labels; logo half-open; stepped or ghosted copies on fast moves; tags in the safe area; audible cues; loudness; small-part scan | **Partial**: dark, repeated-phrase, off-beat, quiet-cue, short-end, mix (branch: `src/lib/reviewFrames.ts:14`); the rest missing | Very high |
| REV-4 | Scored critic round | 4/5 S C G W | Score on the ten-criterion rubric, fix the top three, score again | +8 (S), +7 (C) in one round; fixes listed with time ranges and numbers | **Partial**: rubric and critic prompt (branch: `docs/benchmark/rubric.md`); not wired into `judge_edit` (`src/lib/judge.ts` unchanged) [Upgrade U0.5] | Very high |
| REV-5 | Reference study | 5/5 | Read the reference as stills and write its moves | 2–4 fps over the film, 10–30 fps over the hook and each transition, full-resolution frames of signature moments (G pulled its white-out at full size to build the shards) | **Main**: `analyze_reference_video`. Gap: 30 fps transition runs are not produced by default | Medium |
| REV-6 | Re-render only what changed | 4/5 C W G L | A fix re-renders its frames, not the film | C re-rendered frames 231–267; W frames 348–450 (33 s) and one frame (203); G re-encoded from a lossless master in 16 s | **Partial**: the evaluator is pure (`src/motion/evaluate.ts`); export renders whole clips (`src/motion/exportFrames.ts`) | Medium |
| REV-7 | Save and verify the assembly | 1/5 L (a loss, not a technique) | Every committed step is saved and checked | L lost the song on A1 (audio `place` ignored its track) and 30 of 31 caption moves "changed nothing" unnoticed | **Missing**: `src/lib/editProgram.ts:121` passes the first audio track whatever `op.track` says; main autosaves the session every half second (`src/App.tsx` ~559, 1230–1251) but there is no named checkpoint per phase and no error for a bulk edit that changed nothing | Very high |

### 3.13 Rendering

| ID | Block | Films | What it does | Parameters | Status | Value |
|---|---|---|---|---|---|---|
| RND-1 | Adaptive motion blur | 5/5 | Samples by on-screen streak; a lower shutter on text and cursors | One sample per 1.6 px of streak, 2–48 (S); C: 2–64 with ≤ 4 px between copies; 120° on whips, 60–72° on moving text; linear-light accumulation | **Branch**: `src/motion/blur.ts`, `blurSamplesAt` in `evaluate.ts`, layer `shutter` in `types.ts`, half-float targets in `gl/core.ts` | High |
| RND-2 | Half-resolution sub-frames | 1/5 L | Blurred sub-frames render at half size | At ≥ 6 samples, sub-frames at half resolution, the average upscaled | **Missing**: `src/motion/gl/renderer.ts` | Medium (speed) |
| RND-3 | Pure function of time | 5/5 | Any frame renders alone, in any order | | **Main**: `src/motion/evaluate.ts` | Foundation |
| RND-4 | A strong model's own render as layers | none of the films (they had no way) | A frontier model that renders its own scene delivers transparent passes that stack as a layered comp | Manifest of passes: PNG runs, ProRes 4444 or WebM with alpha | **Branch**: `src/lib/renderPasses.ts`, `src-tauri/src/render_passes.rs`, `attach_production_asset {passes}` | High (keeps frontier freedom editable) |

### 3.14 What the catalogue says

- **The highest-value missing blocks** are the ones that show Bhippi at work: CAP-4 (scripted AI turn), CAP-5
  (live panel per frame), UI-2 (ordered reveal), UI-9 (dive into the monitor), SCN-1 (ask and work), SCN-2
  (timeline build); and the review blocks REV-2, REV-3, REV-4, REV-7. None of them is exotic.
- **Cheap wins**: TXT-2 colour arrival, LGT-2 sheen, CMP-4 landing helper, TXT-10 hold rules, JOIN-11 one move at a
  time, SND-3 beat refs. Each is days, not weeks, and each fixed a named fault in a critique.
- **The expensive, film-specific end** is the 3D glass family (MAT-1–4, JOIN-6, LGT-12). It matters for identity
  films; §4.5 and §8 treat it as a decision.

---

## 4. Engine architecture changes still needed

### 4.0 Principles

1. **Offered, never forced.** Every block is a shortcut. A frontier model may write a raw `MotionScene`, patch any
   layer, or render its own scene and deliver it in passes (branch: `src/lib/renderPasses.ts`). No gate checks
   *how* a film was made; gates check what it looks like (light, reading size, animation present, saved). Guided
   models get the recipes (branch: `src/lib/filmRecipes.ts`) and the refusal of `render` scenes (branch:
   `src/lib/modelProfile.ts` `guidedRefusal`).
2. **Layers only.** Everything lands in `MotionScene` (`src/motion/types.ts`) and opens as a layered "[Motion]" comp
   (`src/lib/motionStack.ts`). A render a model makes itself arrives as passes, one layer per pass.
3. **Spec fields, not patches.** A rebuild must not lose edits. Today `update_ui_screen` rebuilds from its spec and
   drops layers patched in afterwards [Audit §4]. Cameras, cursors, states, finish and light must be fields of the
   template or spec, and user edits must survive a rebuild (§4.1, overrides).
4. **Measure, never guess.** Part boxes from the DOM, times from the song map, focus from the target, blur samples
   from the streak, safe areas from the projected layout.
5. **Defaults carry the craft.** A model that writes no numbers still gets the films' numbers (§3).
6. **Pure functions of time.** Any frame renders alone and repeatably, including captured UI time (§4.3).
7. **No LUTs by default.** Finish presets use exposure, tone, bloom, vignette and grain only; a LUT is added only when
   the user's message asks (standing rule).

### 4.1 Scene format

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **Time refs beyond words**: `{bar: m, beat?: n}`, `{beat: n}`, `{snare: 'next', after}`, `{grid: 'eighth' or 'sixteenth', after}`, `{drop: k}`, `{cue: 'name'}`, resolved from the song map | SND-3; every film cut on bars and put small events on snares | `src/lib/motionTools.ts` (beside the `{word}` resolver), `src/lib/songMap.ts` (branch), `src/motion/types.ts` | `{word}` only |
| **Live time binding**: keep the ref on the key (`t: {word:'Bhippi', offset: -0.035}`) and re-resolve when the audio moves, instead of resolving once | SND-4 (G, W, C built one clock by hand) | `src/motion/types.ts` (`Key.t` may be a ref), `src/motion/anim.ts`, `src/lib/motionTools.ts`, a re-resolve pass on audio edits in `src/lib/editProgram.ts` | No |
| **A parts registry on the scene**: `scene.parts = {name: {layer, box, states}}` written by the demo and UI compilers, so any layer can target `{part: 'send'}` for position, point of interest, focus, attach or cursor | CAM-1, CAM-5, CMP-2 attach, CUR-1; [Audit G13] | `src/motion/types.ts`, `src/motion/kit/productDemo.ts` (branch), `src/motion/ui/compile.ts`, resolver in `src/lib/motionTools.ts` | The demo knows its parts internally; not exposed |
| **Style tokens on the scene**: `scene.style = {palette, stage, type, cadence}` read by every template in a sequence, so beats share one world | LGT-7, LGT-10 ("light the film as one", C lesson 6) | `src/motion/types.ts`, `src/motion/kit/common.ts`, `src/motion/sequence.ts`; recipes already pass style (branch: `src/lib/filmRecipes.ts` `FilmStyle`) | In recipes only |
| **Overrides that survive a rebuild**: every generated layer gets a stable id and a `from: {template, slot}`; user and AI patches are stored as overrides by id and re-applied after a template or UI rebuild | Principle 3; the owner's "open any layer and edit it" | `src/motion/kit/index.ts`, `src/lib/motionTools.ts` (`update_motion_scene`), `src/lib/uiScreenTools.ts`, `src/panels/MotionInspector.tsx`, `src/lib/motionStack.ts` | Finish survives rebuild (branch fix `b5f85fa`); nothing else |
| **A light layer kind**: `{type: 'light', kind: 'key' or 'pool' or 'sweep', at: part or point, radius, strength, color}` drawn as a screen-blend adjustment over the layers below | LGT-3, SCN-9 | `src/motion/types.ts`, `src/motion/gl/renderer.ts`, `src/motion/gl/effects.ts` | No |
| **A 3D material layer (decision, §4.5)**: `{type: 'glass3d', sdf, material, extrude, bevel}` or the Blender route through passes | MAT-1–4 | `src/motion/types.ts`, `src/motion/gl/*` or `src/lib/renderPasses.ts` (branch) | Passes only |
| **Minimum holds as data**: text, pill and card layers carry `minHold`; `validate` reports a hold that is too short | TXT-10 | `src/motion/types.ts`, `src/motion/validate.ts` | Per template only |

### 4.2 Camera and depth

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **Autofocus**: camera `focus: 'poi'`, `{layer}` or `{part}`, plus `dof.pull` seconds of lag for a rack | CAM-5; the audit's own close-up was fully defocused [Audit §2.3] | `src/motion/types.ts` (camera), `src/motion/evaluate.ts` `cameraAt` | The demo keys focus itself |
| **Smooth paths**: a `smooth` interpolation (monotone cubic through keys, Fritsch–Butland) and an optional `smooth: σ` low-pass on camera layers | CAM-3 | `src/motion/anim.ts`, `src/motion/keys.ts`, `src/motion/evaluate.ts` | No |
| **Breath**: `camera.breath = {px, deg, hz}` and a hold push (`hold: {push: 0.03}`), off when the camera is moving | CAM-4 | `src/motion/types.ts`, `src/motion/evaluate.ts` | Demo breathes its holds |
| **Near-plane clamp and report**: evaluate every 3D quad's corners; clamp or warn when w < 0.04 | CAM-7 | `src/motion/evaluate.ts`, `src/motion/validate.ts` | Demo reduces its tilt |
| **Per-pixel depth of field** on tilted planes [Upgrade U4.2] | CAM-6 | `src/motion/evaluate.ts` (corner depths), `src/motion/gl/effects.ts`, `gl/shaders.ts`, `gl/renderer.ts` | No |
| **Fill-frame zoom to a part**: a camera helper that solves the dolly at which a part fills the frame (W's 1920/707) and lands on a time ref | UI-9, JOIN-2 | `src/motion/kit/productDemo.ts` (branch), `src/motion/joins.ts` (branch) | Close-ups use a `fill` fraction |
| **Projected safe area and framing check**: project every layer through the camera over a range; report title-safe misses, overlaps with a named subject, and tags below y 970 | CAM-10, CUR-2 | `src/motion/safeArea.ts` (today skips 3D at line 71), new `src/lib/framingCheck.ts`, used by `review_frames` | No |

### 4.3 UI parts with states, and capture

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **One part model for every UI source**: AI-written HTML screens and kinds (`create_ui_screen`) compile to the same 3D part layers with states as captures do, so they get the camera, cursors and state swaps too; `data-state` variants in HTML | UI-1; [Audit G1, G6] | `src/motion/ui/spec.ts`, `ui/raster.ts`, `ui/compile.ts`; share `partsToLayers` with `src/motion/kit/productDemo.ts` (branch) | Captures only |
| **New UI actions**: `reveal {target, order: 'clips' or 'rows' or rects, edge, flash}`, `lift {target, z, dimBehind, blurBehind, edge}`, `morph-crop {from, to, radius, shadow}`, `snap {control, levels, beats}` (with in-between states), `stream {target, words}`, `play {target, clip, from, to}` | UI-2, UI-3, UI-4, UI-6, UI-8, UI-9 | `src/motion/kit/productDemo.ts` (branch) `DemoAction`, `src/motion/ui/spec.ts` | `click`, `hover`, `type`, `set` |
| **Scripted AI turn in capture**: a `turn` step that types and sends in the real composer, then drives the stand-in's event bus (start, streamed thinking, tool calls run by Bhippi's own executor, streamed reply, done) and captures each state | CAP-4 | `src/lib/appCapture.ts` (branch) `parseSteps`, `src-tauri/src/app_capture.rs` (branch), `src/lib/demoProject.ts` (branch) | No |
| **Per-frame capture of live panels**: a `play` step that seeks the app's own playhead to each film frame and captures a selector; meters and waveforms fed from the song | CAP-5, UI-7 | `src/lib/appCapture.ts`, `src-tauri/src/app_capture.rs` (branch) | No |
| **A deterministic UI clock**: `window.__bhippiClock` read (when present) by the components the films animate: the mark's states, shimmer, status circles, meters, playhead, stream ring | CAP-5; [Upgrade U1.2] | `src/chat/BhippiMark.tsx`, `src/chat/Activity.tsx`, `src/editor/ToolsAndMeters.tsx`, `src/lib/playhead.ts`. A reviewed `src/` change, made on a branch, never while an AI turn runs in the live app | No |
| **A capture-only light film theme** and a `theme` option on `capture_app_session` | CAP-7; W lost points for dark UI on a white film. Decision in §8: a real light theme or a capture-only one | `src/styles/themes.css`, `src/lib/appCapture.ts` | `eval` can inject CSS |
| **Re-capture at the zoom used**: when a demo's shot needs more than the capture's scale, re-capture that part at 4x (or tile past 8192 px) instead of holding the zoom back | CAP-8; [Upgrade U1.4] | `src/motion/kit/productDemo.ts`, `src/lib/appCapture.ts` (branch) | Holds zoom and reports |
| **Part library keyed by content**: add a hash of the world (project, chat, clips) to the cache key | CAP-9 | `src/lib/appCapture.ts` `captureKey` (branch) | Keyed by version and steps |

### 4.4 Text animators

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **Colour ramp per unit**: `colorFrom` and `colorAfter` on cascades (grey → white, accent → ink), in linear light | TXT-2 | `src/motion/types.ts` `TextCascade`, `src/motion/text.ts` (today `dimTo` dims opacity, lines 289–291) | Word-land approximates it |
| **Line split**: a glyph-offset animator that opens a gap at a word index and pushes neighbours, for an object to land in | TXT-7 | `src/motion/text.ts`, `src/motion/types.ts` | No |
| **Tracking flash preset**: tracking animator + colour field, 3–6 frames | TXT-6, JOIN-5 | `src/motion/kit/kineticTemplates.ts` (branch) | No |
| **Glyph anchors as refs**: `{glyph: {layer, index, where: 'stem' or 'counter' or 'tittle'}}` usable by other layers | TXT-9 | `src/motion/text.ts` (measure), `src/lib/motionTools.ts` (resolver) | Inside `fly-through-word` only |
| **Staggered hero lines layout** | TXT-5 | `src/motion/kit/kineticTemplates.ts` (a `stagger` layout on `word-land`) | No |
| **Dark type on bright or HDR fields**: composite text after tone mapping so thin dark strokes stay dark (G's tagline "read purple" until it did) | G v2 fix 9 | `src/motion/gl/renderer.ts` (text after the finish layer when flagged) | No |

### 4.5 Materials and light

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **Sheen effect** on any layer: `{type: 'sheen', at, duration, angle, width, intensity, dispersion}`, clipped to the layer's alpha | LGT-2 | `src/motion/gl/effects.ts`, `src/motion/types.ts`, `src/motion/validate.ts` | Shape inside `glass-mark` |
| **Light layer** (key, pool, sweep) from §4.1 | LGT-3, SCN-9 | as §4.1 | No |
| **Flare and streak primitives**: a star flare (4 points + anamorphic streak) at a point or part; a comet streak along a path with a hot head | LGT-4, MAT-4 | `src/motion/gl/effects.ts` or shape presets in `src/motion/fx.ts` | No |
| **Contact shadow** computed in comp space from a layer's projected quad | CMP-3 [Audit G10] | `src/motion/gl/renderer.ts` | No |
| **Stages with life**: breathing and drifting glows (noise-driven centres), a drifting band, world drift, the white set with pale corner glows, a studio floor that fades into haze | LGT-7 | `src/motion/gl/procedural.ts`, `src/motion/kit/common.ts` `stage()` | Static stages |
| **Split any logo into parts**: connected components of the alpha (grown 3 px, softened 1.2 px, sharing one centre), so any multi-part mark gets the mark rig | LGT-6 | new asset step beside `import_brand_logo` in `src/lib/aiTools.ts`; `src/motion/kit/filmTemplates.ts` (branch) | Bhippi's vector mark only |
| **The glass decision (MAT-1–4, JOIN-6, LGT-12).** Option A, native: a `glass3d` layer that raymarches an extruded SDF of the logo with the painted-glass shading of G v2, accumulating its samples into the engine's motion-blur samples. G's lesson: shader compile time went from 301 s to 35–50 s only after every loop count became a uniform and each object was shaded at one call site. Option B, Blender: `render_3d_scene` renders the glass mark as passes (beauty, glow, shadow) that stack as layers through render passes | Identity films; G scored 66 on v1 with a strong renderer, so the material alone does not win | A: new `src/motion/gl/sdf.ts`, `src/motion/gl/glass.frag`-style shader in `gl/shaders.ts`, an SDF builder (port of `make_sdf3.py`) in `src-tauri/src/`. B: `src/lib/ai-tools.json` `render_3d_scene`, `src/lib/renderPasses.ts` (branch) | B works today in principle |

Recommendation: ship Option B first (it exists and stays editable per pass), measure it in the benchmark's glass film,
and build Option A only if B's look or speed fails (§7, Phase 7).

### 4.6 Transitions

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| `plunge`: push into a named part of the outgoing beat until it fills the frame; the next beat opens on that part | JOIN-2, UI-9 | `src/motion/sequence.ts`, `src/motion/joins.ts` (branch) | No |
| `flood`: light grows until it owns the frame on a time ref, with optional shards and dust, then recedes through a hole opening from the next scene's subject outward | JOIN-6 | `src/motion/joins.ts`, `src/motion/sequence.ts` | No |
| `color-flash`: a full-frame brand-colour flash of 3–6 frames that can carry tracked type, cutting hard out | JOIN-5, TXT-6 | `src/motion/joins.ts` | Warm flash only |
| `morph-crop`: the outgoing beat's crop box travels to the incoming beat's box | UI-4, JOIN-8 | `src/motion/sequence.ts` | No |
| `rise-out-of`: the incoming card rises out of a part of the outgoing one | SCN-5 | `src/motion/sequence.ts` | No |
| **One move at a time**: the compiler staggers exits and entrances so no more than two layers enter or leave in any 0.25 s, and a hero lands only on a clear frame; it reports what it moved | JOIN-11 | `src/motion/sequence.ts` | No |
| **Joins inside a sequence get strip review**: `cutTimes` learns the cuts of a motion sequence | REV-1 | `src/lib/reviewFrames.ts` (branch) `cutTimes` | Named as open in [TK-Review] |

### 4.7 Finish

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| Presets `crimson-dark`, `studio-glass` and `white-clean` beside `launch-light` and `launch-dark`, with the films' numbers (LGT-1) | Three of the five films used a finish the two presets do not cover | `src/motion/finish.ts` (branch) | Two presets |
| Full RGBA16F targets through bloom and DOF, then dither on present and readback [Upgrade U4.3] | LGT-11 | `src/motion/gl/core.ts`, `gl/renderer.ts` | Float accumulation for blur only |
| Banding guard at encode: a light temporal grain option when the film has pale gradients (W measured 38% flat 3×3 blocks without it) | LGT-11 | `src-tauri/src/render.rs`, `src-tauri/src/render/codec.rs` | No |
| Keyable finish over time (bloom rising into a flood, exposure per shot) documented and exposed in `update_motion_scene {finish}` | LGT-1, JOIN-6 | `src/motion/finish.ts`, `src/lib/motionTools.ts` | Static per film |

### 4.8 Rendering speed, review and export parity

| Change | Why (blocks) | Files | On the branch |
|---|---|---|---|
| **Whole-film motion preview**: render the whole film at 540p with motion blur, sheets at 5–10 fps, and per-second motion energy, luma, 98th percentile and dark share | REV-2, LGT-10 | `src/lib/reviewFrames.ts` (branch), `src/motion/exportFrames.ts` | No |
| **Measured gates** listed in REV-3 | REV-3 | `src/lib/reviewFrames.ts`, `src/lib/judge.ts`, `src/lib/production.ts` `QaIssue.kind` | Six findings |
| **Half-resolution sub-frames** when samples ≥ 6 | RND-2 | `src/motion/gl/renderer.ts` | No |
| **Render only what changed**: cache rendered frames by scene hash and frame; re-export only changed ranges | REV-6 | `src/motion/exportFrames.ts`, `src-tauri/src/render.rs` | No |
| **A "look" preview mode**: playback preview keeps motion blur at half resolution instead of dropping it below quality 0.75 | Parity [Audit §4] | `src/editor/MotionLayer.tsx:143` | No |
| **Parity test**: a frame rendered by the review path and by the export path must match within a small tolerance, for a scene with blur, DOF and a finish | Parity | `tests/`, `src/motion/exportFrames.ts` | No |
| **Layer budget**: cull zero-opacity state layers and off-screen parts before drawing; cap state variants per part and warn | Performance of UI-1 at hundreds of layers | `src/motion/evaluate.ts`, `src/motion/gl/renderer.ts` | Hidden variants at opacity 0 |

---

## 5. The ready-made kit still to ship

The model should build a film by **choosing and filling**: pick a template, give it words, times (or time refs),
parts and a style, look at the frames it returns, fix one thing. It stays free to write a raw scene or render its
own passes. Crimson rebuilt this way is about 12 beats of parameters instead of 4,454 lines [Crimson §6.1].

**The contract every piece keeps** (so a model can rely on it):
- takes words, time refs, part names, style tokens and a `variant`; never needs pixel coordinates;
- returns editable layers, its event times (for `review_frames`), its sound cues (for `sound_the_motion`) and notes
  on anything it had to change (a zoom held back, a hold lengthened);
- records `template: {id, params}` so it can be rebuilt, and keeps overrides across rebuilds (§4.1);
- offers a `vary` list so two films come out different [TK-Plan Phase 7].

### 5.1 Templates

Already on the branch (13): `product-demo`, `window-explode`, `type-on-voice`, `fly-through-word`, `word-land`,
`label-pill`, `slam-tilt`, `whip-pan`, `match-grow`, `logo-lockup`, `end-card`, `connect-hub`, `glass-mark`; joins
`camera-match`, `glow-handoff`, `flash-bridge`; five recipes [TK-Review].

Still to ship, in priority order:

| Template | What it makes | Blocks | Films | Priority |
|---|---|---|---|---|
| `ask-and-work` | The user types a short prompt in the real composer, sends on a snare, the work list ticks at a readable size under a key light | SCN-1, CAP-3, CAP-4, UI-1, LGT-3, CUR-1 | L S C W | 1 |
| `timeline-build` | Clips land on the beat grid with springs and glows; role-tagged Bhippi cursors; the monitor flashes each shot | SCN-2, UI-2, CUR-2, CMP-4 | L S C W | 1 |
| `payoff-dive` | Dive into the monitor on a downbeat; the AI's edit plays full frame, cutting on beats; pull back to show it is Bhippi | UI-9, CAP-5, JOIN-2 | W S L | 1 |
| `state-reveal` | A panel fills in the order the AI made it: clip by clip, row by row, with razor flashes | UI-2 | L S C W | 2 |
| `product-card` | Any capture as a card that springs in turning, then catches a sheen; a label pill attached to it | CMP-1, LGT-2, CMP-2 | C W L | 2 |
| `lift-out` | A row or card lifts out of its panel while the rest dims and blurs | UI-3 | L C W | 2 |
| `conversation-card` | The composer's box morphs into a card of the conversation that grows as the reply streams | UI-4, UI-8, CAP-4 | W S | 2 |
| `hero-lines` | Short staggered lines beside a product card, one per beat, arriving in the accent and cooling to ink | TXT-5, TXT-2 | W C | 2 |
| `split-lockup` | End card where the line parts on a beat and the logo springs into the gap | TXT-7, SCN-7 | W | 2 |
| `hook-pop` | Talking-head hook: words either side of the head, subject pops with a converging echo, shrink, rest, park as a PiP | SCN-3 | C | 3 |
| `drop-into-slots` | Items arc into a panel's slots and hand over to its own pictures | CMP-6 | C L | 3 |
| `control-snap` | A control the words name, driven through its states on the beats | UI-6 | L S | 3 |
| `color-flash` | A 3–6 frame brand-colour flash carrying tracked type | TXT-6, JOIN-5 | W | 3 |
| `light-sweep` | A window powers on under a travelling light front; or a pool opens round one object | SCN-9, LGT-3 | L S G | 3 |
| `contrast-beat` | "Most tools give you X": a cool grey stage and one grey result, then the product takes it and the stage warms | SCN-6 | L | 3 |
| `rise-out-of`, `keycaps` | The monitor rises out of the timeline; keycaps pressed on a word and its echo | SCN-5, CMP-7 | C L | 4 |
| `glass-orb`, `flood-reveal`, `construction-lines` | Identity-film pieces: a glass orb that opens into the mark; a light flood with shards that recedes onto the card; hairline setting-out | MAT-2–4, JOIN-6, LGT-9 | G | 4 (after the glass decision) |

Each gets a Motion Lab scene in `src/motion/lab/`, a vitest build test, a `templateExamples.ts` entry and a line in
the matching playbook (branch: `src/lib/motionDirection.ts`). The recipes (branch: `src/lib/filmRecipes.ts`) switch
to the new templates for their `demo`, `feature` and `end` moments once they exist.

### 5.2 A UI part library for Bhippi, and for any product

**The Bhippi part pack.** Captured once per app version, shipped or built on first use, so no film spends 20% of its
time on the UI again [Walk §1]. Built by a script (`scripts/build-part-pack.ts`) that runs `capture_app_session`
against the demo world (`src/lib/demoProject.ts`, branch) and writes a versioned manifest; `create_product_demo
{capture: "bhippi:<part>"}` loads it by name.

| Part | States |
|---|---|
| Composer | empty; typing (per character for the prompts the playbooks use, and on demand for any prompt); send hot; sent; working (the ember stream) |
| Chat | user bubble; thinking streaming; work list rows (running → tick) for Plan, Gather, Cut, Polish; reply streaming; edits card ("8 changes on the timeline", list closed and open, Undo turn) |
| Model picker and effort | closed; open; each provider picked; Thinking levels with in-betweens |
| Permission popover | Plan only, Auto-edit, Full access; hover states |
| Providers settings | row need → key being typed → saving → ready, for each provider with its real logo |
| Timeline | empty; clip by clip on V1; titles on V2/V3; music on A1; SFX on A2/A3; beat markers; the playhead at film time |
| Program monitor | any clip range playing, one picture per film frame; a title over it |
| Bin | empty; tiles landing; thumbnails and filmstrips |
| Meters and waveforms | driven by the film's song |
| Brand kit | swatches one by one; frames taking the look |
| Toasts | export finished; connected; undo |
| Cursors and tags | You, Bhippi, Bhippi · waiting, Claude, GPT, Gemini, Local, Grok, Kimi (branch: `src/lib/providerMarks.ts`) |

**For any product.**
- `capture_app_session {url}` with CSS selectors (branch). Add a part finder: list candidate parts by DOM role and
  size (buttons, inputs, cards, rows, panels) with suggested names, so a model does not guess selectors.
- Logged-in products: an explicit `profileDir` or cookie file the user provides; never the default browser profile
  [Upgrade §10].
- A "product world" option: answer a web app's own API calls from a JSON fixture by request interception, the same
  idea as Bhippi's stand-in, for demos without real accounts.
- Products with no web app: the UI kinds (`src/motion/ui/kinds.ts`: search, chat, dashboard, table, form,
  notifications, kanban, pricing) gain parts and states, so an AI-written UI animates like a capture (§4.3).

### 5.3 Textures and light

- **Stages** (LGT-7): light cream, peach grid, cool grey, dark ember, crimson field (breathing glows, band, motes,
  world drift), white set with pale corner glows, navy studio with a backlight panel and a floor fading into haze,
  lavender field. Each takes the brand palette.
- **Light pack**: sheen, key light, pool, power-on sweep, flares, comet streaks, flood with shards and dust, bokeh
  motes (existing particles), warm flash, glow point.
- **Glass**: the four 2D materials (branch: `glass-mark`) plus, after the decision, the 3D glass mark.
- **Shadows**: warm brown soft shadow, two-layer card shadow, contact shadow.
- **Finish**: five presets (§4.7). No LUTs unless the user asks.

### 5.4 Sound

- **Done on the branch**: `sound_the_motion`, five UI sounds, the mix check (branch: `src/lib/cueSound.ts`,
  `src-tauri/src/sfx.rs`, `src/lib/reviewFrames.ts`).
- **Still to ship**:
  - `music_reedit {bars, swell, break, tag}`: bar-aligned splices placed 4–20 ms before a transient with an 8 ms
    equal-power crossfade and a chroma loop check; a reverse swell built from the drop; a filtered break; a jump to a
    sung tag for the end card (SND-5). Files: beside `analyze_music_beats` in `src/lib/aiTools.ts`, audio work in
    `src-tauri/src/` (a new `music_edit.rs`).
  - `place_word_on_beat {word, beat, trimGaps, tempo, prelap}` for voice-overs (SND-6).
  - Sounds: struck glass in the song's key (bar partials), a band-swept whoosh panned with the move, a riser that cuts
    dead on the drop, a razor snip run, a glass tock, a sub boom (SND-8, SND-9). Files: `src-tauri/src/sfx.rs`,
    `src/lib/cueSound.ts`.
  - Mastering by film kind: LRA 6–8 LU for identity and delicate films, 3–4 LU for product films, −16 LUFS and
    −1 dBTP by default (SND-10). Files: `src-tauri/src/render.rs`.

---

## 6. How the AI should work

### 6.1 The loop inside Bhippi, with budgets

The order every good film followed [Learn §2], with the tools that now exist or are planned. Shares are of the
film's working time; "looks" are sheet or frame reviews.

| # | Phase | What the AI does | Tools | Done when | Share | Budget |
|---|---|---|---|---|---|---|
| 1 | Frame | Ask the size in one line, recommending the reference's shape | `choose_comp_size` | Comp exists | 1% | 1 question |
| 2 | Measure | Beats, bars, drops, snares, every word | `analyze_song` (branch) | A song map note | 5% | 1–2 calls |
| 3 | Study | The reference as stills, its moves written in one line each, recast in the brand | `analyze_reference_video` | 4–8 moves to borrow | 5% | 1–3 sheets |
| 4 | Plan | One scene per line; each a real product moment that shows the words; times, parts, states, camera, join, sounds; one idea per 1.5 s | `save_storyboard`, `save_video_blueprint` | Storyboard saved | 10% | |
| 5 | Kit | Load the part pack or capture what is missing, with states and a scripted turn; check the sheet | `capture_app_session` (branch) | Every state the storyboard names exists and passed the scan | 10% | 1 sheet per capture |
| 6 | Build | A scene per beat: a template, or raw for a frontier model | templates, `create_product_demo`, `create_motion_sequence`, raw scenes, render passes | The scene renders | 20% | |
| 7 | Look and fix | Frames at the moments of action; name the fault in one line; change one thing; look again | `review_frames` (branch) | The sheet shows the storyboard | 20% | ≥ 1 look per scene, ≤ 3 fix rounds |
| 8 | Joins and whole film | Strips across every join; the whole-film motion preview with its measures (§6.2) | `review_frames {at: "joins"}`, the whole-film check | No hard cut, no black frame, no gate failing | 10% | 1 pass per assembly |
| 9 | Sound | A sound on every cue, set against the song; music re-edit if the film is shorter than the song | `sound_the_motion` (branch), `music_reedit` | Every cue audible; −16 LUFS / −1 dBTP | 5% | |
| 10 | Critic | Score on the rubric with measured numbers; fix the top three; score again | `judge_edit` with the critic seat | Target met, or three rounds done | 10% | ≤ 3 rounds |
| 11 | Save and verify | After every committed step: re-read the comp, confirm the diff, checkpoint | `get_comp`, `verify_edit_workflow`, the checkpoint | Saved, verified | continuous | |

**Effort and budgets.**
- A premium film asks for High or Max effort; the branch already shows a one-click suggestion and never changes
  anything by itself (branch: `src/lib/workflowRoute.ts` `filmEffortHint`).
- `src/lib/tokenLedger.ts` gets a budget by production kind (premium film ceiling 25 M, explainer 6 M, others 3 M
  [Upgrade U0.2]) and its advice never says "stop" about looking at frames; it keeps "no re-reads of unchanged
  things". With the kit in place the target for a 15 s premium film is **≤ 10 M tokens and ≤ 30 min active time**
  for a frontier model (the free L run took 96 min; C took about 4.3 h).
- Guided models do not run this loop by hand: a recipe runs phases 2–9 in one call and applies the safe fixes
  `review_frames` names (branch: `buildFilmFromRecipe` in `src/lib/aiTools.ts`). Target ≤ 15 min.

### 6.2 The whole-film check

Run after every assembly and before the critic. It is what L never did and what found G's static middle and W's
ghosted cut frame.

- Render the whole film at 540p with motion blur (the export renderer, not the preview).
- Sheets at 2 fps for the whole film and 10 fps round every join and hero moment.
- Per second: mean luma, 98th percentile, dark share (luma < 60), motion energy (mean absolute frame difference at
  240 px), and luma jumps above 2× the running mean.
- Across the film: every join strip; busy windows (three or more layers entering or leaving in 0.25 s); the reading
  size and hold of every text layer meant to be read; the landing sharpness after every camera move; stepped or ghosted copies on fast moves; tags and caps in
  the safe area; one copy of each phrase; the brand name's hold; cue audibility; loudness.
- Output: one report with times and fixes, in the same shape as the critiques (keep-list, then fixes with time
  ranges and numbers), and the contact sheets.

Files: `src/lib/reviewFrames.ts` (branch), `src/motion/exportFrames.ts`, `src/lib/judge.ts`. It is required by
`verify_edit_workflow` (`src/lib/aiTools.ts`) for motion productions.

### 6.3 Pipeline changes

| Change | What | Files | Acceptance |
|---|---|---|---|
| **Motion-first route** [Upgrade U0.1] | A production whose scenes are motion scenes gathers a kit (captures with states, a song map), not pictures of scenes. `finish_gathering` refuses until every storyboard scene's parts and the song map exist | `src/lib/editWorkflow.ts`, `src/lib/production.ts`, `src/lib/types.ts`, `src-tauri/prompts/copilot.md` (pipeline section) | A blueprint with three motion scenes cannot finish gathering without its captures and song map |
| **Stills never stand in for scenes** | `verify_edit_workflow` refuses a motion production when still images cover more than 10% of V1 with no motion scene over them | `src/lib/aiTools.ts` (`verify_edit_workflow`) | A comp whose V1 is 80% stills fails and names the clips |
| **Render scenes are real animated clips** | A `render` scene accepts a video or passes with motion: frame differences above a threshold across its length, and its duration within one frame of the scene's. A still attached to a render scene is refused with the reason | `src/lib/production.ts` `attachMedia` (branch), `src/lib/renderPasses.ts` (branch), `attach_production_asset` in `src/lib/aiTools.ts` | A PNG attached to a render scene is refused; a 4 s MP4 with motion is accepted |
| **Honest staging** | GATHER may stage a demo world and have the real app perform a scripted task on it (CAP-4); it may not invent UI, statuses or claims. Replace the rule that led to "must not fabricate application behavior" with this line | `src-tauri/prompts/copilot.md`, the gather playbooks in `src/lib/motionDirection.ts` | The launch brief's GATHER produces a captured turn, not static screens with "not signed in" |
| **Whole-film check required** (§6.2) | EDIT and POLISH cannot verify without a whole-film check after the last timeline change | `src/lib/editWorkflow.ts`, `src/lib/aiTools.ts` | `verify_edit_workflow` names the missing check |
| **Save after every step** | A named checkpoint (project file and backup) after each committed phase and each committed AI timeline edit; audio `place` honours `op.track` (today `src/lib/editProgram.ts:121` uses the first audio track); a bulk edit that changes nothing answers `ok: false`; results name removed clip ids | `src/lib/editProgram.ts`, the commit path in `src/App.tsx`, `src/lib/history.ts` | Placing audio on A3 leaves A1's song; a no-op transform fails; after an AI commit the project file on disk holds the new clips |
| **A critic seat for films** [Upgrade U0.5] | `judge_edit` scores premium films on the ten-criterion rubric with the measured numbers, and returns keep-lists and fixes with times | `src/lib/judge.ts`, the council, `docs/benchmark/rubric.md` (branch) | On S v1 and v2 it lands within ±4 of 76 and 84 |
| **Budget advice** (§6.1) | By production kind; never "stop looking" | `src/lib/tokenLedger.ts` | `tokenBudgetFor({kind: 'launch-film'})` returns 25 M and advice without "stop" |
| **Recipes close the loop** | A recipe film runs the whole-film check and its join strips (today its internal cuts are not stripped) | `src/lib/aiTools.ts` `buildFilmFromRecipe` (branch), `src/lib/reviewFrames.ts` (branch) | A recipe's reply includes join strips at its own cuts |

### 6.4 Frontier and guided paths, side by side

| | Frontier (Claude Code, Codex, other full-tier models) | Guided (smaller models) |
|---|---|---|
| Templates | Offered in `list_motion_templates` and the playbooks; never required | The recipe picks them |
| Raw scenes and patches | Allowed, with the overrides that survive rebuilds | Allowed but not suggested |
| Own renderer | Allowed; delivered as passes (branch: render passes) or one file | Refused, with the template alternative (branch: `guidedRefusal`) |
| The loop | Phases 1–11, the AI's own judgement between looks | Inside the recipe; safe fixes applied automatically |
| Gates | Outcome gates only (§6.3) | The same gates |

---

## 7. Phased roadmap

Size: **S** up to 3 days, **M** 1–2 weeks, **L** 2–4 weeks, for one engineer. Risk is the chance of slipping or
regressions. All engine work happens on a branch or worktree, never in the running app's folder while an AI turn runs.

### 7.1 Phases

| Phase | Items | Size | Risk | Depends on | Acceptance tests |
|---|---|---|---|---|---|
| **A. Merge the toolkit** | The owner's three steps in [TK-Review] (commit the main folder's work, merge with no turn running, restart); the "Try it" smoke checks in the real app; update the branch's `docs/benchmark/films.json` (white-saas baseline 69, the critique file says 67; add `glass-identity-v2.mp4` as a second glass baseline; mark apple-launch and fluid-saas "no baseline"); fix the recipe join strips (REV-1 gap) | S | Medium (8 overlapping files) | none | Every smoke check in [TK-Review] passes in the app; `npx vitest run` and `cargo test -p bhippi --lib` pass on main; round 0 of the benchmark (§7.3) is scored |
| **0. Pipeline** | Motion-first route; stills refused as scenes; render scenes must be animated; honest staging; save after every step (audio track fix, no-op errors, checkpoints); budget by kind (§6.3) | M | Low | A | The tests in §6.3; a replay of the launch brief at High effort ends GATHER with captures and a song map, has no still on V1, and the project file on disk holds the timeline after EDIT |
| **1. Measure** | Whole-film check (§6.2); the missing gates (REV-3); the critic seat (REV-4); join strips inside sequences | M | Medium (calibration) | A | On the existing renders the gates find what the critics found by eye: S v1 dark (luma 20.4) and a repeated phrase at 4.5–4.8 s; S v2 no landing at 13.05–13.70 s and quiet cues at 1.06, 2.27, 8.33 s; C v2 busy windows at 8.70, 10.00, 12.40 s, the orphan pill 10.95–11.25 s and the half-open mark at 1.57–1.64 s; W dark share above 0.30 at 5–6 s and 9–10 s and stepped text at 11.03–11.20 s; G v1 flat motion (0.8–1.0) at 5–9 s and a still end card (0.15–0.3). The critic seat scores S v1, S v2, C v1 and C v2 within ±4 of 76, 84, 68 and 75 |
| **2. Capture and the part pack** | CAP-4 `turn` step; CAP-5 `play` step and the UI clock; CAP-7 theme option; CAP-8 re-capture at zoom; CAP-9 content key; the Bhippi part pack (§5.2); part finder; product world | L | Medium (the clock touches several `src/` components) | A | One call captures the composer typing a prompt, the send, the work list ticking, the edits card, the timeline filled by Bhippi's own executor, and 3 s of the monitor playing at 30 fps; two captures of one state are byte-identical; the shipped `dist/` contains no stand-in code (a build test greps its marker); the pack builds in ≤ 5 min |
| **3. Engine core** | Scene format (§4.1: time refs, live binding, parts registry, style tokens, overrides, `minHold`); camera (§4.2: autofocus, smooth paths, breath, near-plane clamp, fill-frame zoom, framing check); one UI part model and the new actions (§4.3); text (§4.4: colour ramp, line split, glyph anchors, hero lines); the one-move-at-a-time guard | L | Medium-high (`evaluate.ts` and `text.ts` are shared by every template) | 1 (to look), 2 (for capture-driven actions) | A 4-key camera path has no frame with zero speed between keys; `{snare: 'next', after: 10.5}` resolves to 10.750 on "Meet Bhippi"; moving the song 0.5 s moves every bound key 0.5 s; a user's patch on a template layer survives a rebuild; an HTML screen with `data-state` compiles to part layers with a camera and cursors like a capture; a close-up with `focus: 'poi'` is sharp (Laplacian within 10% of pinhole); every existing template test still passes |
| **4. Templates** | The priority 1–3 templates of §5.1; joins `plunge`, `color-flash`, `morph-crop`, `rise-out-of`; recipes and playbooks updated to use them | L | Medium | 2, 3 | Each template renders from a one-line call, opens as layers, passes the Phase 1 gates, and has a Motion Lab scene and a build test; a launch-film recipe film uses `ask-and-work`, `timeline-build` and `payoff-dive` |
| **5. Light and finish** (parallel with 4) | Sheen; light layer; flares and streaks; contact shadow; stages with life; logo split; finish presets `crimson-dark`, `studio-glass`, `white-clean`; RGBA16F and dither; encode grain; per-pixel DOF; half-resolution sub-frames; render only what changed; look preview; parity test | L | Medium-high (per-pixel DOF is high) | 3 (light layer) | White UI under `launch-dark` keeps whites ≥ 230 with bloom under 3/255 on white pixels; a 1080p gradient shows no run of identical values over 40 px; a sheen crosses a card in its keyed window; a 30° plane blurs increasingly from the focus line; the 15 s benchmark exports in ≤ 2 min; review and export frames match |
| **6. Sound and music** (parallel) | `music_reedit`; `place_word_on_beat`; new sounds (struck glass in key, band-swept whoosh, riser, razor run, tock, sub); pan with the move; mastering by film kind | M | Low-medium | A | W's music edit (song 12.45 → 19.218 then 28.911 → 37.143) is rebuilt by one call with the splice within 5 ms of the snare's transient and no audible click; G's splice 20 ms before the clap likewise; a delicate film masters at −16 LUFS with LRA 6–8 LU |
| **7. The glass decision** | Spike Option B (the Blender glass mark as passes in the identity recipe) and score it; build Option A (MAT-1–4, JOIN-6 flood, LGT-12 floor) only if B fails its target | S spike, then L | High | 5, benchmark round 2 | B: an identity film with a Blender glass mark delivered as layered passes reaches its target (§7.3). A (if built): the SDF passes a hard specular test with no wall streaks (G's `mark\sdf_sigma_compare.png` method); the shader compiles in ≤ 60 s; a 1080p frame at 16 samples renders in ≤ 1 s on the RTX 3080 |
| **8. Benchmark rounds** | Round 0 after A, round 1 after Phase 1, round 2 after Phase 4, round 3 after Phase 7 | S per round | none | as listed | §7.3 |

Phases 0, 1, 2 and 6 can start together after A. Phases 3 → 4 are the critical path.

### 7.2 Sizes at a glance

| Phase | Weeks (one engineer) |
|---|---|
| A | 1 |
| 0 | 1–2 |
| 1 | 2–3 |
| 2 | 3–4 |
| 3 | 3–4 |
| 4 | 4 |
| 5 | 3–4 (parallel with 4) |
| 6 | 2–3 (parallel) |
| 7 | 1 (spike) + 4–6 if Option A |

### 7.3 The benchmark: rebuild the four 15 s films inside Bhippi

**The films.** The four finished films, each with its own brief, inputs and reference as the free runs had them
(branch: `docs/benchmark/films.json`):

| Film | Reference | Free-run baseline | Reference score |
|---|---|---|---|
| Launch film (bhippi-15s) | Relume launch promo; comparator L's 0–15 s (77) | 84 (v2), 76 (v1) | 77 (comparator) |
| crimson-explainer | Crimson Brief | 75 (v2), 68 (v1) | 80 |
| glass-identity | "hi, aflow." | 66 (v1); v2 to be scored in round 0 | 84 |
| white-saas | Workly | 69 (v1) | 82 |

apple-launch and fluid-saas are left out: they have no finished free film to compare against. The branch's
benchmark kit lists six films; round 0 uses these four and records the other two as optional.

**Rules.**
1. Made in Bhippi with its own tools, through its normal production pipeline. No external renderer except a frontier
   model's own passes attached through `attach_production_asset {passes}`, which must open as layers. No imports of
   the free films' renders or captures.
2. Every picture on V1 is a motion comp, a capture used inside one, real footage, or declared render passes. A script
   checks the saved project (branch: `scripts/film-bench.ts` gains this check).
3. Editability check: a person changes one word, moves one cursor's final park and switches the finish preset, in
   under 2 minutes, and re-exports.
4. Three tiers, as in the branch's kit: Opus at Max (frontier), one mid model on the full tier, one small model on
   the guided tier. Record tokens, active minutes, looks and fixes.
5. Scoring: the same rubric (branch: `docs/benchmark/rubric.md`, ten criteria, /100). Two blind critics, averaged,
   who see the new film beside the free film and the reference without knowing which is which; the Phase 1 gates are
   reported beside the score. A round is a regression if a film scores lower than the round before or costs more
   than 10% more tokens or minutes.

**Targets per film.**

| Film | Round 1 (after Phases 0–1) | Round 2 (after Phases 2–4) | Round 3, frontier (the target) | Round 3, mid | Round 3, guided |
|---|---|---|---|---|---|
| Launch film | ≥ 70 | ≥ 82 | **≥ 86** (beats v2's 84) | ≥ 80 | ≥ 72 |
| crimson-explainer | ≥ 65 | ≥ 76 | **≥ 80** (matches its reference) | ≥ 74 | ≥ 68 |
| glass-identity | ≥ 55 | ≥ 65 | **≥ 76 with Option B, ≥ 80 with Option A** (v1: 66) | ≥ 70 | ≥ 64 |
| white-saas | ≥ 65 | ≥ 76 | **≥ 80** (v1: 69; reference 82) | ≥ 75 | ≥ 68 |

**Cost targets** for round 3: frontier ≤ 10 M tokens and ≤ 30 min active per film; guided ≤ 15 min; the editability
check passes on every film. The free runs' costs are the ceiling: L 96 min, C about 4.3 h and 4,454 lines, W three
sittings.

**Why these numbers.** Round 1 can recover a lot without new engine features because the route, the budget and the
loop were most of the 10/100 gap [Upgrade §9 M0]. Round 2 adds the real product at work, which every critique ranked
first. Round 3 needs light, sound and, for glass, a material. The glass targets are lower because its free film had
a custom raymarcher and still scored 66 on v1.

---

## 8. Risks and open questions

**Risks**

| Risk | Why it matters | Mitigation |
|---|---|---|
| Critic scores drift | The same films got 65 or 66 (G), 67 or 69 (W), reference 84 or 86 (G) from different passes; makers over-scored by 2 to 17 points | Two critics averaged, calibrated on the scored films; the measured gates reported beside every score; no score gates a merge on its own |
| Every film looks alike | Recipes and templates could flatten style | Style tokens and `variant` per film (branch recipes already vary); frontier models are never pushed to templates; originality is one of the ten criteria and is watched across rounds |
| Staging shades into faking | A demo world could be read as a user's real data or a claim | The app must really perform what is shown; demo data is labelled as a demo project; no invented statuses, numbers or competitor claims; the licence stand-in never ships (build test) |
| Glass in the engine | A raymarcher is a new renderer inside the engine; G's first shader took 301 s to compile on D3D | Option B first; Option A only if B misses its target; loop counts as uniforms, one call site per object |
| Performance | Hundreds of state layers, 48 blur samples, per-pixel DOF | Cull zero-opacity and off-screen layers, cap variants, half-resolution sub-frames, render only what changed; export of the 15 s film ≤ 2 min is an acceptance test |
| Capture fragility | A UI change breaks the part pack | Keyed by version and content; rebuilt by script; font and small-render checks fail loudly |
| The live app | Bhippi runs from this repo with Vite hot reload; an engine edit mid-turn breaks the turn | All work on branches or worktrees; merge only with no turn running; restart after Rust changes [TK-Review] |
| Merge overlap | Eight files overlap between the branch and the main folder's uncommitted work | The owner commits main's work first; hunks checked separately in [TK-Review] |
| Sound never heard | Every maker mixed by measurement; the critiques still found cues inaudible or a tail choked | Measured cue audibility and loudness (done); an open question below on a listening step |
| Rebuild versus edits | A user edit and a later template rebuild can disagree | Overrides win for the properties the user changed; conflicts are reported, not silently dropped |
| Longer films | All scored films are 15 s; L's 106 s film was dense in places | Pacing checks (one idea per 1.5 s, cadence) in the whole-film check; a 60 s film in a later benchmark round |

**Open questions for the owner**

1. **A light theme for Bhippi.** W lost points because the product is dark on a white film. Ship a real light theme,
   allow a capture-only film theme, or keep the dark UI and compose it as cards on light stages?
2. **Glass: Blender passes or a native raymarcher?** This plan recommends trying Blender passes first.
3. **Finish the two unfinished labs?** apple-launch (Manus style) and fluid-saas have a recipe and a playbook on the
   branch but no free film to validate them. Run them, or keep those recipes marked unvalidated?
4. **A listening step.** Add an audio critic model, or ask the user to listen once before export?
5. **Staging rule wording.** Confirm the honest staging line (§6.3): the real app performing a scripted task on a demo
   project is allowed; invented UI, statuses and claims are not.
6. **Budget ceiling.** Is 25 M tokens acceptable as the ceiling for a premium film (with ≤ 10 M as the target), and
   should the effort suggestion stay a suggestion?
7. **Critic in the product.** Should the film critic seat run automatically on every premium film, or only when asked
   (it costs a render and a model call)?

---

## Appendix A. The four benchmark films as blocks

What each film needs, by block ID, and which of those blocks are still missing or partial. This is the shortest way
to see what each phase buys.

**Launch film (bhippi-15s).** Prologue: the playhead is born in a light pool (SCN-9, LGT-3). "An editor…": words land
on the voice (TXT-1, TXT-2) and the camera pulls back to the tilted window (CAM-2, CAM-3, CAM-4). "…with a producer
inside": fly through a letter (TXT-4). "Connect your AI": hub and spoke (CMP-5). The ask: the prompt typed and sent,
the work list at a readable size (SCN-1, CAP-3, CAP-4, LGT-3). "…and watch it work": the timeline builds with worker
cursors while the monitor flashes each shot (SCN-2, CUR-2, UI-2, CAP-5, UI-7 meters). End: the mark swings shut on
the snare (LGT-6, SCN-7). Finish `launch-dark` (LGT-1), sound on every cue (SND-7).
*Still missing or partial:* SCN-9, LGT-3, CAM-3, CAM-4, TXT-2, SCN-1, CAP-4, SCN-2, CUR-2, UI-2, CAP-5, UI-7, LGT-6.

**crimson-explainer.** Crimson field with world drift (LGT-7, CAM-4). Hook: subject pop with converging echo, shrink,
rest, park (SCN-3). Drop: the mark lands shut on the beat, clacks, thinks (LGT-6). Providers wired into the mark
(CMP-5) with product cards (CMP-1) and a pill (CMP-2). Files drop into slots (CMP-6). The composer types and sends
(SCN-1, CAP-3). Timeline slams on bar 3 and fills clip by clip with razor flashes (SCN-4, UI-2). The monitor rises
out of the timeline (SCN-5). Music and SFX strips lift out and pulse (UI-3, CMP-4). Match-grow into the Characters
window and the presenter jumps out (JOIN-9, SCN-8). End card with a heartbeat mark and the film's own cards behind
(SCN-7). Finish `crimson-dark` (LGT-1). Voice placed so "Bhippi" lands on the drop; the song re-cut to the film
(SND-6, SND-5). One move at a time (JOIN-11).
*Still missing or partial:* LGT-7, CAM-4, SCN-3, LGT-6, CMP-1, CMP-6, SCN-1, UI-2, SCN-5, UI-3, CMP-4, SCN-8, the
`crimson-dark` preset, SND-6, SND-5, JOIN-11.

**glass-identity.** A point of light blooms into a glass orb with flecks inside a drawn construction "eye" (MAT-2,
LGT-9, LGT-4). The orb opens as an iris into the ring, which is scored and cut into the Cs; the ember becomes the B on
"producer" (MAT-3). The camera orbits over a reflective floor (CAM-9, LGT-12). Three beads charge and dive into the
slot on "con-NECT", "YOUR", "A-I" (MAT-4). The mark turns orange from the slot down (SCN-9). A white flood with shards
takes the frame on the clap and recedes onto the card (JOIN-6). The wordmark lands with its i-dots as beads on the
kicks (TXT-9); a sheen crosses the mark (LGT-2). Finish `studio-glass` (LGT-1). The song spliced under a clap, struck
glass in key, a breathing master (SND-5, SND-8, SND-10).
*Still missing or partial:* all MAT blocks, LGT-9, LGT-4, CAM-9, LGT-12, SCN-9, JOIN-6, TXT-9, LGT-2, the
`studio-glass` preset, SND-5, SND-8, SND-10. This is why its targets depend on Phase 7.

**white-saas.** White set with pale corner glows that drift (LGT-7). The real composer floats up and types the prompt
key by key; a cursor presses Send (CAP-3, CUR-1). The composer's box morphs into a card of the conversation while the
thinking streams (UI-4, UI-8, CAP-4). "Bring / your own / AI." staggered beside the card, arriving blue and cooling
to ink (TXT-5, TXT-2). A blue flash with tracked type on the drop (JOIN-5, TXT-6). The edit happens: clips land on
eighths (SCN-2), shown as light floating cards rather than a dark full-frame window (CMP-1, as its critic asked). The
edits card lifts off (UI-3). The crop opens out to the whole editor and the camera dives into the monitor on bar 7
as the AI's edit cuts (UI-4, UI-9, CAP-5). The window drops away; the line splits and the logo springs in (TXT-7).
Finish `white-clean` with banding grain (LGT-1, LGT-11). The song cut by 4 bars under a snare (SND-5). A light film
theme or light cards (CAP-7).
*Still missing or partial:* LGT-7, UI-4, UI-8, CAP-4, TXT-5, TXT-2, TXT-6, SCN-2, CMP-1, UI-3, UI-9, CAP-5, TXT-7,
the `white-clean` preset, LGT-11, SND-5, CAP-7.

## Appendix B. Scores and costs of the free runs, for reference

| Film | Rounds | Time | Own code | Renders | Notable costs |
|---|---|---|---|---|---|
| L | 1 turn | 96.2 min | ~1,800 lines of scenes, a 634-line engine, 328 UI parts | 23 scenes, 3,192 frames in ~640 s on 22 workers | 20% UI kit, 11% waiting on part re-renders, timeline lost unsaved [Walk] |
| S | 2 | two sessions (plus one cut off) | film page ~1,000 lines, `post.py` ~300, a staging rig | r1–r6, r7–r10; 3,716 world captures | 4× render cost for dense motion blur [15s §5] |
| C | 2 | about 4.3 h | 4,454 lines | 2,758 samples per 450 frames, ~70 s render + ~5 min post | 52 SFX auditioned by spectrogram, 19 kept [Crimson §2.4] |
| G | v1 + v2 (v2 unscored) | four sessions, two cut off by usage limits | a WebGL raymarcher (861–1,111-line shader), three SDF builders | 32 spp, 263–295 s per film; 540p preview in 21 s | shader compile 301 s until restructured to 35–50 s [Glass R2.2] |
| W | v1 (v2 started, not rendered) | three sittings, two cut off by usage limits | a capture harness, a film page (685-line `scene.js`), SFX synth | 13 full renders, 124–199 s each on three Edge workers | a frame ghosted across a cut for seven renders before a full-frame-rate sheet caught it [White §6] |
