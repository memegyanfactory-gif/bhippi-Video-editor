# Motion upgrade: progress tracker (started 25 Sep 2026)

This is a live record of what's done and what's left in the plan in
[docs/REFERENCE-FILMS-PLAN.md](docs/REFERENCE-FILMS-PLAN.md). It is updated after every item.

**Overall: study, plan, Phase 0 and Phase A are done ✅ (Helios now renders real 3D in headless Blender). Phase B (the SaaS unlock) is next. Phases B–D have not started.**

| Stage | Status |
|---|---|
| Study of the 9 films + reports + plan | ✅ Done |
| Blender headless proofs (2 rounds) | ✅ Done |
| **Phase 0: quick fixes** | ✅ Done (6 of 6), all tests green |
| **Phase A: foundations** | ✅ Done (6 of 6), all tests green |
| Phase B: the SaaS unlock | ⬜ Not started |
| Phase C: 2.5D, characters, full Blender | ⬜ Not started |
| Phase D: beyond | ⬜ Not started |

---

## ✅ Done

### Study (24–25 Sep)
- 9 films downloaded; 12,094 frames analysed frame by frame by 9 agents.
- 9 per-film reports, a codebase map and a research/licence report, in `docs/research/video-study/reports/`.
- The plan: `docs/REFERENCE-FILMS-PLAN.md` (revision 2).
- Two Blender 5.2 headless proofs, in `docs/research/video-study/blender_proof/`.

### Phase 0: quick fixes
1. ✅ **Camera depth of field now works.** It was dead code: the settings were computed but never drawn.
   - A camera with `aperture` + `focus` now blurs 3D layers by their distance from the camera.
   - New `dof {band, near, far, max}` keeps a depth band sharp and weights the near and far sides separately.
   - Files: `src/motion/evaluate.ts` (`defocusSigma`, `projectedScale`, per-layer `defocus`), `src/motion/gl/renderer.ts`, `src/motion/types.ts`.
   - Tests: `tests/motionDof.test.ts` (5 pass). Checked on the GPU in the Motion Lab: near and far cards blur, the focused card stays sharp, and the band keeps both sharp.
2. ✅ **Sound effects fixed.**
   - `add_sound_effect` and `generate_selection_sound` accept all 12 kinds; they used to reject 6.
   - New real **`click`** sound, a synthesised UI click. Motion cues marked `click` used to play a pop.
   - Files: `src-tauri/src/project.rs`, `sfx.rs`, `sfx_library.rs`, `src/lib/types.ts` (`SFX_KINDS`), `aiTools.ts`, `motionTools.ts`, `editor.ts`, `sfxLevels.ts`, `timeline.ts`, `ai-tools.json`.
   - Tests: Rust `sfx` + `sfx_library` (16 pass).
3. ✅ **Tempo detection fixed.** A beat must now divide the bar. That removes the triplet mistake where 90 BPM music read as 120.
   - Checked on the films' real audio:

     | Film | Before | Now | Correct |
     |---|---|---|---|
     | aflow | 120 | 89.5 | 90 |
     | WasteProtection | 183.5 | 135.1 | 134 |
     | Virgil | 114.8 | 114.8 | unchanged, correct |

   - File: `src/lib/beats.ts`. Tests: `tests/beats.test.ts` (12 pass). The new test fails on the old code.
4. ✅ **Measured timing built in.**
   - 9 new named eases from the films: `house`, `settle`, `emphasized`, `rise`, `push`, `creep`, `snap-settle`, `resolve`, `card-zoom`.
   - A `TIMING` token table (pop-in, panel, hover-lift, push, exit, snaps, typing speeds, logo slide, voice-over lead…).
   - The AI prompt now tells the AI about the eases and camera depth of field.
   - Files: `src/motion/anim.ts`, `src/motion/types.ts`, `src/motion/kit/common.ts`, `src-tauri/prompts/copilot.md`.
   - Tests: `tests/motionEaseMeasured.test.ts` (3 pass).
5. ✅ **`bleed` flag.** `bleed: true` on a layer means "runs off the frame on purpose" (a giant word panning past). The safe-area fitter and frame QA leave it alone, and the AI prompt explains it.
   - Files: `src/motion/types.ts`, `src/motion/safeArea.ts`, `src/lib/polish.ts`. Test added in `tests/motionSafeArea.test.ts`.
6. ✅ **Docs and full verification.**
   - `docs/MOTION-ENGINE.md` is corrected: depth of field is documented as real now, plus the new eases, `TIMING` and `bleed`.
   - The @funny `place_sfx` schema includes `click`.
   - **Full test run: 1,125 TypeScript tests and 284 Rust tests pass; the typecheck is clean.**

### Phase A: foundations
- A1 ✅ **Image-sequence footage.** `source.sequence {dir, fps, frames, first, start, digits, ext, loop}` plays a numbered PNG/JPG/WebP run as footage, the way headless-Blender renders come back.
  - It composites like any footage: 3D, mattes, effects, blend modes.
  - Preview prefetches the next frames and shows the nearest one while loading; export waits for the exact frame; memory is capped at 160 frames.
  - Files: `src/motion/types.ts`, `sources.ts` (`sequenceIndex`, `sequenceFile`), `host.ts`, `validate.ts`, `lab/lab.ts`, `editor/MotionLayer.tsx`, `lib/previewCache.ts`.
  - Tests: `tests/motionSequence.test.ts` (4 pass). **Checked on the GPU:** our transparent Blender Cycles render composites over a Helios background with type on top, and frames advance.
- A2a ✅ **Vector engine core: shape trees.** `shape.groups` = AE-style shape groups:
  - SVG path data (M L H V C S Q T A Z, relative and absolute; arcs become beziers), rect/ellipse/polygon/star and nested groups;
  - per-group transform (anchor, position, scale, rotation, opacity); fill/stroke inheritance;
  - gradient fills and **gradient strokes**; even-odd holes; per-path trim (draw-on);
  - strokes scale with the group (like AE).
  - **Static shapes are rasterised once and cached** (they were redrawn every frame).
  - Validation gives the AI clear errors, and the AI prompt teaches it.
  - Files: new `src/motion/vector/path.ts` and `shapes.ts`; `types.ts`, `gl/raster.ts`, `gl/renderer.ts`, `evaluate.ts`, `validate.ts`.
  - Tests: `tests/motionVector.test.ts` (9 pass, incl. a real Lucide icon path and arc-built circles). All 267 motion tests pass.
  - **Checked on the GPU:** a gradient card with an icon drawing on with a gradient stroke, an even-odd ring, a legacy shape.
- A2b ✅ **Icons + SVG import.**
  - **2,114 Lucide line icons** (ISC licence) as vectors: `{kind:'icon', icon:'shield-check', iconSize, color, position}`. They are expanded to real paths when the AI builds the scene, so scenes never depend on the library. They load lazily and can draw on with trim.
  - New AI tools:
    - `search_icons` finds icons by words;
    - `svg_to_shape` turns any SVG logo or illustration (Illustrator/Figma exports: classes, groups, transforms, gradients, rect/circle/ellipse/line/poly, `<use>`) into a shape tree.
  - Both are read-only and allowed in every phase.
  - **Bug fixed along the way:** the path parser now reads packed arc flags (`a2 2 0 012 2`) and compact numbers (`.5.5`) the way icon sets write them. All 8,610 icon elements parse inside their 24-unit box.
  - Files: new `src/motion/vector/svg.ts` and `icons.ts`; `motionTools.ts`, `permissions.ts`, `editWorkflow.ts`, `ai-tools.json`, `types.ts`, `validate.ts`, `copilot.md`; `package.json` (+`lucide`).
  - Tests: `tests/motionSvgIcons.test.ts` (5), `tests/motionIconsAll.test.ts` (every icon). **Full suite: 1,145 TypeScript tests pass.**
  - **Checked on the GPU:** 6 icon tiles scale in staggered, and their icons draw on with gradient strokes (the WasteProtection look).
- A2c ✅ **Arrays + morphs.**
  - `{kind:'array'}` repeats one item on a grid, ring or line, and morphs every copy between two layouts with a stagger. The item's own size and radius can animate (tiles round into dots), and an opacity ramp gives spinner tails.
  - Any leaf can `morphTo` a different shape: arc-length resampling with rotation and winding matched.
  - Files: `src/motion/vector/shapes.ts` (`layoutSlots`, `arrayCopies`, `morphPaths`), `types.ts`, `icons.ts`, `validate.ts`, docs, prompt.
  - Tests: 5 new in `tests/motionVector.test.ts` (14 pass).
  - **Checked on the GPU: Solair's signature move from one shape layer.** A tile grid rounds into dots, gathers into a ring with a stagger, then the ring tightens and winds up spinning with a fading tail.
- A2d ✅ **Path operators.** Group `ops`:
  - `merge` (union, subtract, intersect, xor);
  - `offset` (grow or shrink, round/miter/bevel joins);
  - `round-corners`.

  They run over the group's children before painting, like AE's Merge Paths, Offset Paths and Round Corners, and all are animatable.
  - Uses `clipper2-ts` (Boost licence). `clipper2-js` was tried first but its negative offsets are wrong, so it was removed.
  - Files: new `src/motion/vector/pathOps.ts`; `shapes.ts`, `types.ts`; `package.json`.
  - Tests: `tests/motionPathOps.test.ts` (4 pass, with exact union/subtract/intersect areas).
  - **Checked on the GPU:** a disc hollowing into a ring (the Motion Tricks sphere→torus in 2D), a star rounding, a square and a circle fusing with a growing outline.
- A2e ✅ **Layer styles.** New effects:
  - `bevel`: the inflated soft-3D look;
  - `inner-shadow`: recessed or neumorphic UI;
  - `inner-glow`;
  - `gradient-overlay`: up to 4 stops, any angle, a sweeping `offset`, and `repeat` for moving colour bands.

  All are animatable and export exactly as they preview.
  - Files: `src/motion/gl/shaders.ts` (3 new shaders), `effects.ts`, `types.ts`, `validate.ts`, docs, prompt.
  - **Checked on the GPU:** the Motion Tricks inflated gradient title from plain text, a recessed search pill, and a colour band sweeping through "Meet your new AI workspace" (the Workly look). **Full suite: 1,154 tests pass.**
- **A2 vector engine: complete ✅** (A2a–A2e).
- A3 ✅ **Type engine.**
  - **Live typing:** `text.type` types at any rate (30 cps fields, 12–13 cps for text read with the voice-over, word chunks for fast prompts) and runs scripts (type → wait → backspace → retype: search frustration cycles). Only typed text is laid out, so centred lines re-centre. A feathered edge, a colour front (`chars`/`hold`/`settle`) and a bar/block caret that blinks when idle.
  - **`retype`:** Solair's left-to-right overwrite with flashing changed letters.
  - **`scatter`:** WasteProtection's converging glyphs.
  - **`lineSpacing`:** animatable; 0 collapses lines (Workly).
  - **Cascade exit `order`:** `reverse` (Virgil's "Too many") or `random`.
  - **Bundled fonts (OFL):** Inter, Manrope, Plus Jakarta Sans, Sora, Outfit, Montserrat, Fraunces, Caveat, Archivo, registered under their plain names. Export waits for every face a scene uses; the preview redraws when a font loads. Brand kits can pick them, and a website's Plus Jakarta Sans is now kept rather than swapped for Inter.
  - **Word timing:** any time in a new scene can be `{word:'ROI', mode:'lead'|'land'|'finish'}`, resolved from the comp's transcripts with the measured offsets (headline lead 0.56 s, payoff on the word, typed lines end 0.3 s early). Unknown words fail clearly.
  - Files: `src/motion/text.ts` (`typedAt`, `retypedAt`), `types.ts`, new `src/motion/fonts.ts`, `src/fonts/bundled.css`, new `src/lib/wordTimes.ts`, `motionTools.ts`, `sources.ts`, `gl/renderer.ts`, `main.tsx`, `lab/lab.ts`, `brandKit/build.ts`, docs, prompt; `package.json` (+9 font packages).
  - Tests: `tests/motionTyping.test.ts` (9), `tests/wordTimes.test.ts` (3). **Full suite: 1,166 pass.**
  - **Checked on the GPU:** a search field typing with a violet front and blinking caret, "Your customers have" → "No questions." retype mid-flash, "Powered by AI" scattering in, and all 9 fonts at weights 400/800.
  - *Follow-ups:* word timing in `update_motion_scene`; captions need static TTF copies of the bundled fonts for libass.
- A4 ✅ **Sound + music structure.**
  - **7 new synthesised sounds** (Rust): `tick` (UI), `key` (one keystroke), `typing` (a human-rhythm keyboard bed), `glass` (glint ping), `shimmer` (sparkle cloud), `sub` (sub drop for slams and drops), `blip` (data/counter). That makes 19 procedural sounds, all mastered to −1.5 dBFS true peak and levelled 14–20 dB under the voice.
  - **Motion scene cues** take every sound and play at its real length (they were cut to 1.2 s). **Typed text automatically gets a typing bed** for exactly as long as it types.
  - **Music structure:** `analyze_music_beats` now returns bars, **4-bar phrase lines** (phased to the biggest energy change), **drops** (≥ 4 dB up) and **stops**. `snap_cuts_to_beats {grid:'phrase'|'bar'|'beat'}` puts cuts on phrase lines, the aflow rule.
  - The AI prompt teaches the measured sound rules (tick UI in voice-over films, silent UI in music-only, world changes on phrases or the drop).
  - Files: `src-tauri/src/project.rs`, `sfx.rs` (7 voices), `sfx_library.rs`; `src/lib/beats.ts` (`musicStructure`), `aiTools.ts`, `motionTools.ts` (cues, `typingCues`), `types.ts`, `editor.ts`, `sfxLevels.ts`, `timeline.ts`, `ai-tools.json`, roast spec, docs, prompt.
  - Tests: Rust SFX (16 pass, every voice audible, bounded and right length); `tests/beats.test.ts` (13, incl. drop on a phrase line); `tests/motionTools.test.ts` (typing bed length). **Full suite: 1,168 TypeScript tests pass.**
- A5 ✅ **`motion_guide` tool.** Six playbooks the AI pulls on demand, so the prompt doesn't grow:
  - SaaS explainer, AI launch, brand identity film, kinetic type, 2.5D tricks, sound.
  - Each gives a beat recipe with durations, the look, measured timing, rules, the tools/eases/features to use, and honest gaps with stand-ins.
  - A test checks that every tool, ease, effect and feature a playbook cites exists.
  - The prompt tells the AI to call it before planning.
  - Files: new `src/lib/motionDirection.ts`, `motionTools.ts`, `permissions.ts`, `editWorkflow.ts`, `ai-tools.json`, `copilot.md`. Tests: `tests/motionDirection.test.ts` (3).
- A6 ✅ **Blender MVP: Helios runs Blender headless.**
  - **Bridge worker** `src-tauri/workers/blender_bridge.py` (GPL; it runs inside the user's own Blender as a separate program). It builds a scene from JSON:
    - objects: box, rounded box, sphere, icosphere, torus, cylinder, cone, capsule, faceted crystal, extruded 3D text, floor, and parenting;
    - 9 material presets: plastic, glass, frosted, pearl, metal, gem, clay, emission, flat;
    - a colour world or a **hand-made gradient environment** (the Modern Motion crystal trick), studio lights, a keyed camera with depth of field.
  - **Keys use Helios's own eases**, mapped 1:1 onto Blender bezier handles.
  - The worker writes PNG frames with alpha, plus `camera.json` (the camera per frame in motion-engine pixels) and `objects2d.json` (each object's screen box per frame, so 2D glints and callouts can track it).
  - Floor shadows: a shadow catcher in Cycles; in EEVEE a shadow-only floor (EEVEE has no catcher).
  - **Rust** `src-tauri/src/blender.rs`:
    - finds Blender from the new `blenderPath` setting, `$BLENDER`, PATH, or the install folders (the newest version wins);
    - `blender_status`;
    - `blender_render_start` checks the scene, runs as a cancellable background job holding the GPU lease, with a timeout sized to the frames, samples and engine;
    - frames go to the project's new **`3D renders/`** folder.
  - The worker runner is generalised (`local_media::run_program`: any program, a timeout, Blender's errors surfaced).
  - **AI tools:**
    - `list_3d_presets` reports whether Blender is installed;
    - `render_3d_scene` takes a preset or a raw scene, renders at draft (EEVEE, about 0.7 s a frame) or final (Cycles GPU, about 3 s) quality, waits, and places the result as a `[Motion]` comp: a sequence footage layer with alpha. If the turn ends first, `{jobId}` places the render later.
  - **5 presets** (`src/lib/blender3d.ts`): `pearl-core-orb` (aflow), `crystal-gradient-env` (Modern Motion), `device-hero` (SaaS), `logo-extrude`, `letters-drop`. The brand-film playbook now uses them.
  - Files: new `blender_bridge.py`, `blender.rs`, `src/lib/blender3d.ts`; `local_media.rs`, `storage.rs`, `settings.rs`, `lib.rs`, `ai_tools.rs`, `ipc.ts`, `motionTools.ts`, `aiTools.ts`, `permissions.ts`, `editWorkflow.ts`, `council.ts`, `motionDirection.ts`, `storage.ts`, `types.ts`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests:
    - Rust `blender` (6, plus 1 that **really renders through Blender** and checks the alpha frame and the camera and object tracks);
    - `tests/blender3d.test.ts` (6).
    - **Full suite: 1,177 TypeScript and 290 Rust tests pass; the typecheck is clean.**
  - **Checked by rendering all 5 presets in Blender 5.2.** That check found and fixed 2 problems:
    - the orb's glass read as a black ball over a dark world (it now refracts a lavender world);
    - a light-less shadow-only floor darkened the whole horizon (it now uses a top light and a tighter fade).
- **Phase A: complete ✅** (A1–A6).

## ⏳ Remaining

### Phase B: the SaaS unlock (weeks 4–7)
- B1 ⬜ UI-screen layer: product UI the AI can type into, click, lift rows in, zoom into; `create_ui_screen`, `capture_product_ui`.
- B2 ⬜ Camera director: continuity object (dot/orb/sparkle), cross-layer links, no-cut world layout, 20+ transitions.
- B3 ⬜ Particles (confetti, twinkles, flakes) + light effects (glints, echo, god rays, glow rings, gradient border).
- B4 ⬜ Reference-analysis worker + pacing QA against the measured timings.

### Phase C: depth and characters (weeks 6–14)
- C1 ⬜ `form` layer: soft 2.5D objects (the Motion Tricks look).
- C2 ⬜ Character system: rigs on twos, action library, face, lip sync, 4 original base characters (first character in about 2 weeks).
- C3 ⬜ Full Blender pipeline: more presets (card rings with UI decals, sphere bouquets, device with a live UI screen), a persistent worker, motion-engine camera auto-synced from `camera.json`, render passes, and a Blender path picker in Settings.
- C4 ⬜ Lottie import.

### Phase D (later)
- AI-generated characters, 3D workspace panel, AI in-betweening research.

---

## Notes
- Phase 0 and Phase A are committed and pushed to `main` (commit 5acfbcf, 25 Sep 2026). Later phases will be committed as they finish.
- Tests are run after each item. The desktop app is never started or stopped, and nothing is built into `target/release`.
