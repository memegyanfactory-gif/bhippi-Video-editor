# Native AI toolkit: what the AIs built for themselves, built into Bhippi

**Goal.** Every AI that made a premium film for Bhippi first built its own tools: an animation
engine, a way to run and capture the real app, audio analysis, sound design, frame review. Opus
spent about 20% of its 96-minute run just rebuilding the interface, plus more on audio and its
engine, before the first scene. A small model cannot build these at all. This plan builds them into
Bhippi as native tools, so:

- **any model** makes the same film by calling a few tools and filling in words and timing;
- a run costs **far fewer tokens** (no engine, capture or analysis code written per film);
- everything lands as **layers the user can open and edit**, never a flat video;
- strong models keep full freedom (their own renderer through `mediaSource: "render"`).

This plan is the toolkit view. The engine work itself is specified item by item in
[MOTION-ENGINE-UPGRADE-PLAN.md](MOTION-ENGINE-UPGRADE-PLAN.md) (U-numbers below); the master plan
from the five reference films (MOTION-ENGINE-MASTER-PLAN.md, being written) will add the full
building-block catalogue, which feeds the template list in Phase 4.

## Evidence: what the AIs built, and what Bhippi has

From the six from-scratch films (Opus's 80/100 launch film, the 84/100 15 s film, and the five
reference films; code in `Documents\Bhippi\Film lab\*` and the Opus backup):

| Built by the AI | Films | Bhippi today | Native tool to build |
|---|---|---|---|
| Its own animation engine (`eng.py`, `film.js`, `comp.js`, WebGL + `post.glsl`) | 6/6 | Strong GL engine (`src/motion`), 26–44 ms/frame with DOF + motion blur; but UI screens are one flat precomp, no camera aimed at parts, no ready-made film scenes | UI parts in 3D, part-targeting camera, adaptive blur, templates (Phases 3–4) |
| Frame review: contact sheets, event-time frames, join strips, luma stats (`tile.py`, `sheet.py`, `keysheet.py`, `lumstats.py`, `review.py`) | 6/6 | `run_frame_qa`, `inspect_clip_frames`, `judge_edit` (`src/lib/judge.ts`) | `review_frames` + measured checks (Phase 1) |
| Audio analysis: beat grid, onsets, vocal isolation, word timing on sung lines (`beatgrid.py`, `onsets.py`, `analyze_audio.py`, Opus `center.py`) | 5/6 | `analyze_music_beats` (`src/lib/beats.ts`), `analyze_clip_speech` (`src-tauri/src/transcribe.rs`); sung lines mistimed or missed | `analyze_song` (Phase 1) |
| Running the real app outside Tauri and capturing it with states at 4× (`tauri_mock.js`, `cdp.mjs`, `capture.mjs`, `session.mjs`, `mockdata.mjs`) | 4/6 | `capture_product_ui` (`src/lib/uiScreenTools.ts`, `src-tauri/src/ui_screen.rs`): one 2× screenshot, no states | `capture_app_session` + demo mode + part library (Phase 2) |
| Sound design and mix (`bhippi_sfx.py`, `mix.py`, `music_bed.py`, Opus `sfx.py` with 98 events) | 4/6 | `add_sound_effect`, `search_sfx`, `compose_music`, `level_audio` (`src/lib/sfx.ts`, `sfxLevels.ts`); effects not tied to the animation, 2/3 of cues inaudible in the critique | Auto-sound on motion cues (Phase 5) |
| Fake footage and media to fill the UI's bins and monitor (`make_footage.py`, `gen_footage.py`, `derive_assets.py`) | 3/6 | None | Demo media pack (Phase 2) |
| Logo as a glass or light material (`make_sdf.py`) | 1/6 | `liquid-glass` effect; no logo-to-shape step | Logo SDF material (Phase 4) |
| Numbered fix patches (`patch1..13.py`, `p01..p08`) | 3/6 | n/a: this is the render → look → fix loop | Built into the recipes (Phase 6) |

**Principle: offered, never forced.** Every tool here is a shortcut, not a rule. Strong models keep
full freedom: raw scenes, their own renderer (`mediaSource: "render"`), their own ideas; no prompt
or gate pushes them onto a template. The one-call recipes are the reliable path for smaller models,
and even they vary per film: they take the reference's palette, stage and cadence, and choose among
several variants of each move, so two films never come out the same.

**Principle: rebuild, don't copy.** Their scripts are one-off, need Python, and output flat video.
Each tool is rebuilt natively (TypeScript in `src/lib`, `src/motion`; Rust in `src-tauri`), using
their code and the harvest reports as the specification: the settings that worked are recorded
there (motion-blur samples, type-on speed, shadow strength, camera curves).

## Phase 0 — Keep weaker models safe (2–3 days)

The two risks from the 29 Sep changes, closed before anything new ships.

| Item | Change | Files | Acceptance |
|---|---|---|---|
| 0.1 `render` only for strong models | Guided-tier turns never see `mediaSource: "render"`; the blueprint check refuses it for them with the template alternative | `src/lib/editWorkflow.ts` (`videoBlueprintContentError`), tool catalogue per tier in `src/lib/toolRouter.ts`, `src/lib/modelProfile.ts` | Guided blueprint with `render` → refused with a named template; full-tier unchanged |
| 0.2 Scope pause off for guided models | Guided Quick edits change out-of-scope clips with a note in the reply instead of a pause | `src/lib/editWorkflow.ts` (`scopeGate`), `src/App.tsx` (tier passed to the workflow) | Test: guided + out-of-scope edit → allowed and noted; full tier still paused once |
| 0.3 Effort floor for films | Launch and product films recommend High/Max effort in the composer; budget profile per U0.2 | `src/chat/ComposerControls.tsx`, `src/lib/tokenLedger.ts` | A film brief at Medium shows the recommendation |

## Phase 1 — See and hear: `analyze_song` and `review_frames` (1–2 weeks)

These two make every model's timing and self-review as good as Opus's, and everything later uses them.

**1.1 `analyze_song {assetId, lyrics?}`** — one call, stored on the asset like `analyze_music_beats`:
beats, bars, downbeats, drops and sections; onsets (the hits worth animating on); vocal isolation
(the mid/side mask Opus used: similarity^10, 140–7500 Hz) before transcription; the user's lyrics
**force-aligned** to the vocal so sung words get exact times (Opus and the 15 s film both needed
this; Deepgram alone heard "chlord"). Output: word list, line list, beat map, suggested cut points
(bars, line starts). Links U5.1, U5.2. Files: `src/lib/beats.ts`, `src-tauri/src/transcribe.rs`,
`src-tauri/src/speech.rs`, new `src/lib/songMap.ts`, tool entry in `src/lib/ai-tools.json`.
*Acceptance:* on "Meet Bhippi.mp3", beat grid within 10 ms of 99.03 BPM / 0.456 s phase; word
onsets within 60 ms of the hand-checked times for the intro and the chorus lines.

**1.2 `review_frames {range?, at?: 'events'|'joins'|seconds[]}`** — renders frames at the moments
that matter (every click, camera key, cue, both sides of every cut) as contact sheets and 0.06 s join
strips, at export quality, plus measured checks: mean light (the 15 s v1 was at luma 21 vs 173),
smallest readable text size, the same phrase on screen twice, word-onset sync error, end-card hold,
audible cues. The judge reads the same numbers. Links U0.3, U0.5. Files: `src/lib/judge.ts`,
`src/motion/exportFrames.ts`, `run_frame_qa` in `src/lib/aiTools.ts`.
*Acceptance:* catches the four defects the critics found by eye in the 15 s v1 (dark exposure,
doubled title at 4.5 s, tiny payoff text, inaudible cues).

## Phase 2 — The real product, alive: `capture_app_session` (2–3 weeks)

**2.1 `capture_app_session {url?, script}`** — runs the app (Bhippi itself, or any web product) in
headless Chrome over the DevTools protocol with a **built-in Tauri stand-in**, plays a scripted
session (type into the chat, open the model menu, click send, fill the timeline), and captures each
named part in each state at 3–4×, with measured boxes, a font check (Opus lost Sora to a serif over
`file://`) and an automatic small-render scan (Opus lost 7 minutes to parts captured at 1×). Links
U1.1, U1.2, U1.4. Files: `src-tauri/src/ui_screen.rs`, `src/lib/uiScreenTools.ts`,
`src/motion/ui/compile.ts`.

**2.2 Demo mode and media pack** — a sample project (footage in the bins, a filled timeline,
waveforms, a chat mid-conversation) so captured screens look alive without each AI faking footage.
Files: new `src/lib/demoProject.ts`, bundled media under `public/`.

**2.3 Part library cache** — captured parts are kept per app version and reused by every later
film: Bhippi's own UI is captured once, not once per video. This is the biggest token saving.

*Acceptance:* one call produces Bhippi's composer in its typing states, the model menu open and
closed, the send button pressed, and the timeline empty and filled, all crisp at 3× on a 4K zoom.

## Phase 3 — Engine: parts in 3D, a camera that targets them, cursors (3–4 weeks)

The engine changes the templates stand on, specified in the upgrade plan: UI parts as 3D layers
instead of one flat precomp (U2.1; `src/motion/ui/compile.ts:474-477`, `src/motion/gl/renderer.ts:290-293`),
a UI camera that aims at a named part with autofocus and a smoothed dolly (U2.2), named multiplayer
cursors with click rings (U2.3), adaptive motion blur and per-layer shutter (U2.4), per-part states
with a `set` action that swaps on the click frame (U1.3).
*Acceptance:* the close-up-on-the-chat → pull back to the tilted window move built from layers,
every part still editable in its "[Motion]" comp.

## Phase 4 — Ready-made scenes (3–4 weeks, overlaps Phase 3)

Each AI's signature moves become templates: layered, parameterised, with their own sound cues, so a
model picks one and fills in words and timing. First set, from the evidence so far (the master plan's
catalogue adds the rest):

- **product-demo** (camera through the real UI, cursor types and clicks, pull-back) — U2.5
- **type-on-voice** (characters land on word onsets, 46–66 ms per character)
- **fly-through-word** (zoom through a letter into the next scene)
- **window-explode** (panels float apart in depth, slam back on the drop)
- **connect-hub** (providers light up around the app), **ask-and-work**, **timeline-build**
- **logo-lockup**, **end-card**, **glass-mark** (logo → SDF → glass and light material, from the identity film)
- kinetic-explainer pieces from the crimson film: **label-pill**, **word-land**, **slam-tilt**, **whip-pan**, **match-grow cut**
- joins: **camera-match**, **glow-handoff**, **flash-bridge** (U3.9)
- finish presets **launch-light** and **launch-dark** (U4.1)

Files: `src/motion/kit/*Templates.ts`, `src/lib/motionDirection.ts` (playbooks), `list_motion_templates`.
*Acceptance:* each template renders from a one-line call, opens as editable layers, and passes `review_frames`.

**4.x Render scenes in passes.** A scene a strong model renders with its own code (`mediaSource:
"render"`) is a finished video, so today it lands as one layer. Such scenes are delivered in
passes instead: backdrop, product/UI, text, cursor and glow as separate transparent videos
(ProRes 4444 or PNG sequences with alpha) that `attach_production_asset` stacks on their own tracks
inside one "[Motion]"-style comp, with a manifest naming each pass. The user can still hide the
cursor, swap the text pass or regrade the backdrop. Files: `src/lib/production.ts`, the gather step
in `src/lib/aiTools.ts`, the `render` description in `src/lib/ai-tools.json`.

**What shows as layers:** templates and motion scenes (and so every recipe a smaller model uses) open
as layered "[Motion]" comps, one layer per track; captured UI becomes layers per part after Phase 3.1;
render scenes become layers per pass after 4.x.

## Phase 5 — Sound that follows the picture (1–2 weeks, parallel)

**5.1 Auto-sound** — motion scenes already carry `cues` (`src/motion/types.ts`: whoosh, click,
typing…); place a sound on every cue automatically, set against the song's local loudness so it is
heard (the critique found 2/3 of cues 20–30 dB under the music). Links U5.3.
**5.2 Sound set** — the procedural UI sounds the AIs synthesised (key clicks, send pop, whoosh,
glass tick) as a Bhippi sound pack. **5.3** Final mix at −16 LUFS, −1 dBTP (the 15 s v2 target).
Files: `src/lib/sfx.ts`, `src/lib/sfxLevels.ts`, `src-tauri/src/sfx.rs`, `sfx_library.rs`.

## Phase 6 — One-call recipes for smaller models (2 weeks)

Bhippi's guided mode already turns a small brief into a finished edit with one
`build_edit_from_brief` call (`src/lib/guidedBuild.ts`, `GUIDED_BRIEF` in `src/lib/modelProfile.ts`).
Add film recipes to it that chain the toolkit:

`capture_app_session` (or the cached part library) → `analyze_song` → template scenes placed on
words and bars → auto-sound → finish preset → `review_frames` → fix what it lists.

Recipes: **launch-film**, **product-demo**, **identity-film**, **kinetic-explainer**, **fluid-saas**
(one per reference style). The model writes the words and chooses the moments; the recipe does the
craft. Strong models get the same tools piece by piece, plus `render` for anything no template does.

## Phase 7 — Teach and measure (ongoing)

- **Teach:** the learnings (`docs/research/launch-film-learnings.md`, the film-lab harvests) as
  playbooks in `src/lib/motionDirection.ts`, brain skills, and prompt text (U0.4).
- **Benchmark:** rebuild each of the six 15 s films inside Bhippi with three models: Opus at max,
  a mid model, and a small guided model. Blind critic, same 10-point rubric.
  Targets: Opus ≥ 85, mid ≥ 78, small ≥ 70. Also track tokens and minutes per film against the
  free Opus runs, and treat a drop in either as a regression.

## Order and size

| Phase | What | Size | Depends on |
|---|---|---|---|
| 0 | Safety for weaker models | 2–3 days | — |
| 1 | `analyze_song`, `review_frames` | 1–2 weeks | — |
| 2 | `capture_app_session`, demo mode, part library | 2–3 weeks | — |
| 3 | Parts in 3D, part camera, cursors, blur | 3–4 weeks | 2 |
| 4 | Templates, joins, finish presets | 3–4 weeks | 3 (partly parallel) |
| 5 | Auto-sound, sound set, mix | 1–2 weeks | 1 |
| 6 | One-call recipes for guided models | 2 weeks | 1–5 |
| 7 | Teach and benchmark | ongoing | 6 |

Phases 0, 1 and 2 can start together; 1 and 5 are independent of the engine work.

## Risks

- **Capture fragility:** the app's UI changes break captured parts. Mitigation: parts keyed by app
  version, recaptured automatically on a version change; the font and small-render checks fail loudly.
- **Template sameness:** every film looks alike. Mitigation: templates take the reference's style
  (palette, stage, cadence from `ref.json`); strong models can still `render` their own scenes.
- **Performance of parts in 3D:** hundreds of part layers per scene. Mitigation: parts not in view are
  culled; the audit measured headroom (26–44 ms/frame with DOF and 16-sample blur).
- **Export parity:** preview and export must match. Mitigation: one renderer for both, already the case.
