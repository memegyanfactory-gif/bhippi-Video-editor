# Native AI toolkit: review before merge

**Branch** `native-ai-toolkit` (worktree `D:\Bhippi-toolkit`), reviewed at `c3913f3` and fixed on the
branch up to `7021070`: 59 commits over main `576f73e` (13 from this review), 104 files, about
13,200 lines added. Plan: [NATIVE-AI-TOOLKIT-PLAN.md](NATIVE-AI-TOOLKIT-PLAN.md); checklist:
`todos/todo-native-ai-toolkit.md`.

**Verdict: ready to merge into main**, with three things for you first (details in "Merging"):

1. Commit or stash the main folder's own uncommitted work. Eight files overlap with the branch.
2. Merge while no AI turn is running, then restart the app (`npm run dev`) so the Rust side is
   rebuilt. The frontend reloads on its own and would otherwise call commands the running binary
   does not have.
3. Run the smoke checks under "Try it" in the real app. Everything below passes its tests and
   headless-browser runs, but the recipe chain has not yet been run in the app with a real capture,
   a real song and the real review.

I found and fixed 12 problems on the branch, each in its own commit. The most serious: the
capture's file server was open to any web page on the machine, a `swap` in `sound_the_motion`
doubled every swapped sound, a recipe film for another product came out branded as Bhippi, and
Hindi (or any non-Latin) lyrics were dropped without a word. After the fixes the full vitest suite
and the Rust library tests pass (numbers under "Tests").

The toolkit follows the rules you set: frontier models get no gate and no template push, the only
refusal is for guided models, recipes vary per film, and everything the engine makes lands as
layered "[Motion]" comps.

## What was built

| Phase | What it is | Main files | Tests |
|---|---|---|---|
| 0 Safety | Guided models are refused a `render` scene, with the template alternative; guided Quick edits are never paused for leaving the scope; a video asked for at Low or Medium effort gets a one-click suggestion of more thinking (it never changes anything by itself) | `modelProfile.ts` `guidedRefusal`, `editWorkflow.ts` `scopeGate`, `workflowRoute.ts` `filmEffortHint`, `ChatPanel.tsx` | guidedTier, quickScope, workflowRoute |
| 1.1 `analyze_song` | Beats, bars, 4-bar phrases, drops, hits, your lyrics with a time for every word (the lead vocal is pulled out first so sung lines are heard), lines, sections, cut points; saved as a research note | `songMap.ts`, `vocal.rs`, `transcribe_asset {vocal}` in `lib.rs` | songMap 11, Rust vocal 4 |
| 1.2 `review_frames` | Frames at every cut, landing, cue, marker and the last frame, plus 6-frame join strips 0.06 s apart, tiled into contact sheets; measured checks: murky frames, a phrase twice, off-beat cuts, buried cues, a rushed end card, reading size, the mix at -16 LUFS / -1 dBTP. `judge_edit`'s audio seat gets the mix findings too | `reviewFrames.ts`, `polish.ts` `contactSheet`, `mix_loudness` in `lib.rs` | reviewFrames 10, cueSound (mix), Rust e2e mix |
| 2 `capture_app_session` | Our own DevTools client drives headless Chrome or Edge; Bhippi's real interface boots on a stand-in for its backend that answers from your real state; steps click, hover, type (a picture per typed character), key, wait, eval, capture; resolution and font checks; `@composer`-style part names; identical sessions reused (the part library); `demo:true` fills an empty timeline, bin and chat from a demo media pack FFmpeg makes on first use | `cdp.rs`, `app_capture.rs`, `appCapture.ts`, `demo_pack.rs`, `demoProject.ts` | appCapture, demoProject 15, Rust app_capture 8, cdp 2, demo_pack 3 |
| 3 Engine | Captured parts as 3D layers in a window null, a camera that lands on a part and pulls back tilted, named cursors with click rings, per-part states with `set`, adaptive motion blur (2-48 samples by measured streak, half-float accumulation), per-layer shutter, coplanar layers kept in stack order | `kit/productDemo.ts`, `motion/blur.ts`, `evaluate.ts`, `gl/*`; tool `create_product_demo` | productDemo 20, productDemoTool 5, motionAdaptiveBlur 8 |
| 4 Templates | product-demo, window-explode, type-on-voice, fly-through-word, word-land, label-pill, slam-tilt, whip-pan, match-grow, logo-lockup, end-card, connect-hub, glass-mark; joins camera-match, glow-handoff, flash-bridge (in sequences and as overlay templates); finish presets launch-light and launch-dark as one editable "Finish" layer (`update_motion_scene {finish}`); typing on the voice (per-character times, rich spans, a gliding re-centre) | `kit/kineticTemplates.ts`, `kit/filmTemplates.ts`, `motion/joins.ts`, `motion/finish.ts`, `motion/text.ts`, `sequence.ts` | motionKitKinetic 43, filmTemplates 11, motionJoins 8, motionFinish 7, motionTyping, templateExamples |
| 4.x Render passes | A strong model's own render can arrive as transparent passes (PNG runs, ProRes 4444 or WebM with alpha) named in a manifest; `attach_production_asset {passes}` stacks them as a layered "[Motion] … passes" comp, one track per pass; a flat file still attaches by assetId | `renderPasses.ts`, `render_passes.rs`, `production.ts` | renderPasses 11, Rust render_passes 6 |
| 5 Sound | `sound_the_motion` puts a sound on every motion cue, its loudest 10 ms about 6 dB under the music's at that moment, never clipping; the UI sound set key_click, send_pop, soft_whoosh, glass_tick, cursor_tap as procedural built-ins; the final mix check | `cueSound.ts`, `sfx.rs`, `sfxLevels.ts` | cueSound 17, sfxLibrary, Rust sfx |
| 6 Recipes | `build_edit_from_brief {recipe}` for launch-film, product-demo, identity-film, kinetic-explainer, fluid-saas: capture, song map, one layered "[Motion]" film cut on the bars, song or composed score, sounded cues, finish layer, review with the safe fixes applied, storyboard. Films vary by `style.variant`, stage, palette and cadence; the same brief gives the same plan | `filmRecipes.ts`, `aiTools.ts` `buildFilmFromRecipe`, `GUIDED_BRIEF` | filmRecipes 9, filmRecipeBuild 2 |
| 7 Teach and measure | Five film playbooks for `motion_guide` (templates offered, a `vary` list per film), routing from the film's name, five seed brain skills written once, the "Premium films" prompt line; the benchmark kit (films, rubric, procedure, `scripts/film-bench.ts`) | `motionDirection.ts`, `toolRouter.ts`, `brain.rs`, `prompts/skills/*`, `docs/benchmark/*` | motionDirection, toolRouter, filmBench 9, Rust brain |

Registration is complete for all six new tools (`analyze_song`, `review_frames`,
`capture_app_session`, `create_product_demo`, `sound_the_motion` and the recipe arguments of
`build_edit_from_brief`): schema, case, label, permissions, workflow lists and test-runner class,
with the benchmark gate raised by dated comments (44,650).

## Try it

In the app, with a project open (Auto-edit permission). Tools can be asked for by name in the chat.

**Phase 0**
- Set Settings, model tier to Guided (or pick a small model) and ask for a video blueprint with a
  scene you "render yourself". The blueprint is refused and the reply names generate, download or
  existing plus `build_edit_from_brief`. On a frontier model the same blueprint saves.
- At Medium effort, type "make a 40 s launch video for my app": a hint offers Max (or the highest
  level the model has). Nothing changes until you click it.

**Phase 1**
- Import "Meet Bhippi.mp3" and ask: `analyze_song {assetId, lyrics: "<the lyric sheet>"}`. Expect
  about 99 BPM, the verse on the 16.8 s drop, every lyric word timed (placed ones marked `*`), and a
  "Song map - …" research note. Try a Hindi lyric too: the words are timed, not dropped.
- On any finished edit: `review_frames {}`, then `review_frames {at: "joins"}`. Expect one or two
  contact sheets and the measured lines (dark frames, repeated phrase, off-beat cuts, buried cues,
  end card, mix loudness).

**Phase 2**
- `capture_app_session {name: "composer", demo: true, steps: [{do: "capture", part: "window", selector: "body"}, {do: "type", selector: "@field", text: "Cut this to the beat", part: "composer", partSelector: "@composer"}, {do: "capture", part: "send", selector: "@send"}, {do: "capture", part: "timeline", selector: "@timeline"}]}`.
  Expect about 24 pictures at 3x in `AI Work/ui-parts/composer`, a contact sheet, no issues. Call it
  again: it returns at once (the part library). This is the check for the file-server fix: in dev the
  thumbnails and waveforms in the captured bins must still load.
- A web product: the same with `url: "https://…"` and CSS selectors.

**Phase 3**
- `create_product_demo {capture: "composer", shots: [{at: 0, focus: "composer"}, {at: 2.4, wide: true}], actions: [{at: 0.35, type: "composer", until: 1.5, cursor: "you"}, {at: 1.8, click: "send", cursor: "bhippi"}]}`.
  Open the "[Motion] Product demo" comp: every part, state, cursor and the camera are layers.
- `create_product_demo {capture: "composer", template: "window-explode", at: 0.3, slam: 1.8}`.

**Phase 4**
- `list_motion_templates`, then for example `create_motion_scene {template: "type-on-voice", params: {text: "An editor with a producer inside."}}` and `create_motion_scene {template: "connect-hub", params: {providers: ["Claude", "GPT", "Gemini"]}}`.
- `create_motion_sequence` with `transitions: ["camera-match", "glow-handoff", "flash-bridge"]`.
- `update_motion_scene {clipId, finish: "launch-dark"}`: one "Finish" layer appears; rebuild the
  template from the Properties panel and the finish stays.
- Render passes: put `passes.json` and two PNG runs (`backdrop/00001.png…`, `text/00001.png…`) in AI
  Work/Output, plan a blueprint with a `render` scene on a frontier model, then
  `attach_production_asset {sceneIndex: 0, passes: "<path>/passes.json"}`: a "[Motion] Scene 1 …
  passes" comp with one track per pass.

**Phase 5**
- After any motion scene over music: `sound_the_motion {}`, then `sound_the_motion {swap: {click: "cursor_tap"}, skip: ["typing"]}`. Each cue has one sound, set against the music; the typing is gone.
- `add_sound_effect {kind: "send_pop"}` and the other four UI sounds.
- `review_frames {}` on an edit with music: the mix line at -16 LUFS / -1 dBTP.

**Phase 6** (the main check before shipping)
- On a guided model: "Make a 15 s launch film for Bhippi to Meet Bhippi" and let it call
  `build_edit_from_brief {recipe: "launch-film", capture: "bhippi", song: "<asset>", lyrics: "…", beats: [{text: "An editor with a producer inside", kind: "hook"}, {text: "Cut this to the beat", kind: "demo"}, {text: "Connect your AI", kind: "connect", points: ["Claude", "GPT", "Gemini"]}, {text: "Bhippi", kind: "logo", subtitle: "The AI video editor"}, {text: "Edit at the speed of thought", cta: "Try it free"}]}`.
  Expect one "[Motion] launch-film film" comp, the song laid under it, cue sounds on SFX tracks, a
  Finish layer, contact sheets in the reply and a storyboard. It can take several minutes (the
  capture and the transcription); the model now waits for it.
- The same call for another product without `capture` or `logo` (and no brand kit): no Bhippi mark,
  cursor or name anywhere; with `logo: "<your logo asset>"` the logo is cast in glass.

**Phase 7**
- `motion_guide {topic: "launch-film"}` (and product-demo, identity-film, kinetic-explainer,
  fluid-saas); `brain_load_skill {name: "launch-film-render-look-fix"}`.
- `node scripts/film-bench.ts plan round-0`, then follow `docs/benchmark/README.md`.

## What I fixed

| Commit | Problem | Fix |
|---|---|---|
| `46e0886` Capture file server | The capture's localhost server ran for every capture, a web product's included, and answered with `Access-Control-Allow-Origin: *`: while a capture ran, the captured site or any tab in any browser on the machine could read files under the app data and storage folders (by port scan) | The server runs only when Bhippi itself is captured, allows only the dev server's origin (the bundled interface is same-origin), and opens a file only after the path check |
| `df8c9aa` Render-pass unpack | `render_pass_frames` deleted the whole `<name>_frames` folder beside whatever video path it was given | It clears and counts only the numbered PNG run it writes |
| `38a7a04` Tool timeouts | `analyze_song`, `capture_app_session`, `create_product_demo` and `build_edit_from_brief` fell under the 180 s default. A recipe film easily runs longer, so the model heard "Bhippi did not respond" while the film was still being built, and a small model retries into a second film | All four join the 30-minute list |
| `28aec2f` sound_the_motion | Laid cue sounds were matched only by the kind about to be placed: `swap` left the old sound and added the new (every swapped cue played twice), `skip` left laid sounds playing, a laid riser was never trimmed onto its hit | A cue's sound is found by its own kind or the swapped one; a swap re-sounds it, a skip takes it off (and says so), a riser gets the trim a fresh one gets |
| `1034740` Song map scripts | `normWord` kept only a-z and 0-9, so a Hindi (any non-Latin) lyric became empty words and `analyze_song` dropped it silently; closing vowel signs were trimmed too | Letters, digits and marks of every script count; only Latin accents are taken off |
| `c936b17` analyze_song permission | Listed as read-only, so Plan-only mode and plugins ran it without asking, though it writes the beat grid onto the plan and a research note (like `analyze_music_beats`, which is not read-only) | Removed from the read-only list; `review_frames` and `capture_app_session` still look |
| `58ba77c` Film routing | "to the song" sent any montage cut to music to the launch-film playbook; "brand identity" colours opened the identity film, a "demo reel" the product demo, a "real product" shot the launch film; "song" also listed the launch-film seed skill for every music edit | Film signals are names of films only ("brand identity film", "demo video", "real app"); tests pin the ordinary asks to their old playbooks |
| `b5f85fa` Finish on rebuild | The Properties panel's template "Rebuild" dropped the Finish layer (the tool path kept it) | Both inspector rebuilds carry the finish |
| `972564b` Guided brief | Told small models the recipe "captures the app", but it only does with `capture` | The line says how: `capture` ("bhippi", or a capture_app_session name) |
| `a3f3064` Recipe branding | A recipe film for another product showed Bhippi's mark (glass-mark and connect-hub fall back to it), clicked with the "Bhippi" cursor, and an end card with no known name read "Bhippi" | `build_edit_from_brief` takes `logo` (default the brand kit's; Bhippi's when it films Bhippi). Bhippi's mark and cursor appear only in a Bhippi film; other products get their logo, or a lettered lockup and their initial in the hub (`connect-hub hub:"none"`), their own named cursor, and their name on the card |
| `6c34695` Playbook wording | The launch-film playbook said a strong model's own render "is delivered in passes", read as a requirement | It offers passes and says one finished file attaches too |
| `0fac0c6` Slim entries | The slim entries of `review_frames` and `capture_app_session` were cut mid-word at 72 characters | Each opens with a short first sentence |

Each fix is pinned by a test (`7021070` adds the one for the slim entries), except the timeout
list, the inspector rebuild (it calls the tested `carryFinish`) and the playbook wording.

## What remains

- **Not yet run in the real app:** the recipe chain end to end (real capture, song, score, review
  and fixes); a Bhippi capture in dev after the file-server change; render passes from a real
  strong-model render; demo-pack generation on a clean machine. These are the smoke checks above.
- **Benchmark round 0** (Phase 7): three models on the six films with blind critics. Needs you.
- **ask-and-work and timeline-build** templates are not built. The launch-film playbook says how
  to make both with `create_product_demo` actions on a capture.
- **Joins inside a recipe film are not strip-reviewed.** `review_frames` finds cuts between clips
  on the timeline; a recipe film is one comp, so its beat cuts only get cue and landing frames. The
  recipe's reply lists its `cuts`, so a model can pass them as `times`. A fix would teach
  `cutTimes` the cuts of a motion sequence.
- **`judge_edit` now measures the mix of every edit** (an FFmpeg pass over the whole soundtrack,
  scored against -16 LUFS for every kind of video). It is caught if it fails, but it adds time on
  long edits and flags a -14 LUFS YouTube master. Decide if that is wanted outside films.
- **The part library is keyed** by app version, steps, size and scale, not by what the project
  shows. After the timeline changes, recapture with `reuse: false` or a new name.
- **Product-demo scenes point at the capture's PNGs by absolute path** in AI Work, so moving the
  project folder breaks them, like other generated media.
- **Skipping after a swap:** a `sound_the_motion` skip after an earlier swap finds the swapped sound
  only when the swap is repeated in the same call.
- **Housekeeping:** the builders' Vite servers are still running on ports 5231, 5311 and 5317, and
  the folders `D:\Bhippi-tk-demo-media`, `D:\Bhippi-tk-joins-finish` and `D:\Bhippi-tk-kinetic` are
  still there (their branches are kept). Stop and delete them when you like; 5199 is the main
  folder's server.
- **Not from this branch:** the classic guided build's end card (`brand-end-card`) shows the
  placeholder wordmark "MY BRAND" when no brand kit is active.

## Merging

- **Overlap with the main folder's uncommitted work:** `Cargo.lock`, `src-tauri/Cargo.toml`,
  `src-tauri/src/lib.rs`, `src/App.tsx`, `src/chat/BhippiMark.tsx`, `src/chat/ChatPanel.tsx`,
  `src/lib/ipc.ts`, `src/styles/app.css`. The hunks I checked are separate (for example, the branch
  moves the mark's paths out of `BhippiMark.tsx` while the main folder adds a "warning" dot state),
  so a merge after committing that work should need little or no hand-resolving.
- **Restart after merging.** The branch adds Rust commands (`app_session_capture`,
  `render_pass_frames`, `demo_pack_make`, `mix_loudness`), a `vocal` argument to
  `transcribe_asset`, and five sound kinds to `SfxKind`. Vite hot-reloads the new frontend into the
  running app immediately, but the old binary does not know these: the new tools fail, and a project
  holding one of the new sounds (`send_pop`…) cannot be saved or exported by the old binary.
- **Dependencies:** `tokio-tungstenite 0.24` is new (in `Cargo.lock`); no new npm packages.
- **Line endings:** files are stored LF; Git on this machine converts on checkout (autocrlf).

## Tests

At the end of the review, in `D:\Bhippi-toolkit` at `7021070`:
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run`: 216 files passed (1 skipped); 2183 tests passed, 2 skipped, 0 failed. That is
  seven more than before the review (2176): the new tests pin the fixes.
- `cargo test -p bhippi --lib` (CARGO_TARGET_DIR=D:\Bhippi-toolkit\target): 410 passed, 0 failed,
  19 ignored, including the real-browser capture tests and the FFmpeg mix test. The run takes
  about 3 minutes because one older test waits out a 180 s tool timeout.
