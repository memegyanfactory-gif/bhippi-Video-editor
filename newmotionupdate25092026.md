# Motion upgrade: progress tracker (started 25 Sep 2026)

This is a live record of what's done and what's left in the plan in
[docs/REFERENCE-FILMS-PLAN.md](docs/REFERENCE-FILMS-PLAN.md). It is updated after every item.

**Overall: study, plan, Phase 0, Phase A and Phase B are done ✅. Phase C is in progress (C1 soft 2.5D forms ✅, C2 characters ✅ (first version), C3 Blender pipeline ✅; C4 Lottie import next). Phase D has not started.**

| Stage | Status |
|---|---|
| Study of the 9 films + reports + plan | ✅ Done |
| Blender headless proofs (2 rounds) | ✅ Done |
| **Phase 0: quick fixes** | ✅ Done (6 of 6), all tests green |
| **Phase A: foundations** | ✅ Done (6 of 6), all tests green |
| **Phase B: the SaaS unlock** | ✅ Done (4 of 4), all tests green |
| **Phase C: 2.5D, characters, full Blender** | 🟡 3 of 4 done (C1–C3) |
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

### Phase B: the SaaS unlock
- B1 ✅ **Living UI screens.** The AI builds a product screen and acts on it the way the SaaS films do.
  - **Where screens come from:**
    - **8 ready-made kinds:** search, chat, dashboard, table, form, phone lock-screen notifications, kanban, pricing. They use the brand's accent and font, in light or dark.
    - **The AI's own HTML:** any element marked `data-part="name"` becomes a moving part.
    - **The user's real product:** `capture_product_ui {url}` screenshots it in headless Edge or Chrome at 2× and shows the AI the picture with a grid; the AI marks the parts. Any screenshot in the library works too.
  - **What the screen can do (14 actions):**
    - type into fields (30 cps, with the placeholder until the first key), retype scripts;
    - click (a press dip and a ripple), hover, hover-lift (×1.088, 9/19/8 frames, list neighbours dim to 32%), sweep a list;
    - select, highlight, pulse, focus;
    - count a number in its own format ($12,400 → $48,250), tooltips, notifications;
    - assemble (parts fly in nearest the centre first), drag, page states (cut, fade or slide);
    - zoom (a camera push into any part, and back out).
  - A cursor glides between targets on the house ease; clicks, ticks, typing beds, blips and whooshes are laid automatically (or `sfx:"none"` for music-only films).
  - Frames: browser (with address bar), phone, laptop, glass card, or none; a tilted 3D plane with `place.tilt`; rise, scale or fade entrance.
  - **How it works:** the HTML is rasterised once in the webview at 2× (the bundled fonts are inlined): the screen without its parts, one picture per part, and a part map of boxes, nesting, list groups and text styles. The actions compile to plain engine keyframes in one precomp, so preview and export match and it opens as a layered `[Motion]` comp. `update_ui_screen` recompiles new actions instantly and only re-renders pictures when the look changes.
  - Files:
    - new `src/motion/ui/` (`spec.ts`, `compile.ts`, `raster.ts`, `kinds.ts`, `demo.ts`), `src/lib/uiScreenTools.ts`, `src-tauri/src/ui_screen.rs` (`ui_screen_save`, `ui_capture`);
    - `fonts.ts` (`embeddedFontCss`), `htmlFrames.ts`, `motionTools.ts`, `ipc.ts`, `lib.rs`, `permissions.ts`, `editWorkflow.ts`, `council.ts`, `motionDirection.ts` (SaaS playbook), `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`, the Motion Lab (`lab.ui()`).
  - Tests:
    - `tests/uiScreen.test.ts` (16: compiler timing and keys, states, devices, number formats, every kind, create and update through the tool);
    - Rust `ui_screen` (3, including a real Edge capture).
    - **Full suite: 1,193 TypeScript and 292 Rust tests pass.**
  - **Checked on the GPU** in the Motion Lab:
    - the dashboard demo: typing, counting, a row sweep, a click with a tooltip, a push into a card and back;
    - all 8 kinds, including a dark tilted dashboard, the phone lock screen and a kanban drag;
    - a real capture of linear.app, animated from marked parts. The push centres the target exactly.
  - Rasterising takes 85–250 ms per screen.
  - **Fixed along the way:** a hover-lift now dims only the lifted item's list neighbours, not every part.
- B2 ✅ **Camera director and motion transitions.** A whole film flows as ONE scene instead of cutting between clips.
  - **`create_motion_sequence`** builds beats into one layered comp. A beat is a template, a UI screen (`ui`), a raw scene or an existing motion clip.
  - **27 transitions** (`list_transitions`), with the films' measured timings:
    - cut, dissolve, push, slide, whip (motion-blurred, cut at the peak), zoom-through;
    - **blur-bridge** (1 f on, cut 3 f later, 7 f back), **z-recede** (0.65 + blur; the new beat pops and rises in 13 f), card-zoom-reveal;
    - shape-wipe (circle, square, rounded, star, diamond; `mode:"in"` = logo resolve), iris, diagonal wipe, noise dissolve;
    - white-out (7–13 f), black-breath (12 f), palette-swap cut, eyelids;
    - scale-cut, snap punch, snap zoom-out, snap press, swap-when-hidden (edge-on with a twist), collapse-into a point, spin, glitch, light leak;
    - truck.
  - **World layout:** the beats sit on one canvas (row, column, zigzag or grid) and a camera trucks between them on the house ease, so **the background never cuts** (the SaaS rule).
  - **Continuity guide:** a dot, orb, sparkle or ring travels from beat to beat (Workly, Virgil, aflow), and can stay as the logo dot.
  - Beats' sound cues move with them, and each transition adds its whoosh, swish, shimmer, impact or sub.
  - **Cross-layer links** (engine): `link: [{prop, from, delay, offset, multiply}]` makes a layer follow another layer's position, scale, rotation or opacity, `delay` behind. Uses: trails, echoes, followers. Links survive layered comps.
  - Files: new `src/motion/sequence.ts`, `src/motion/keys.ts` (shared key tracks); `motionTools.ts`, `uiScreenTools.ts` (`buildUiScene`), `evaluate.ts` (`linkedTransform`), `types.ts`, `validate.ts`, `motionStack.ts`, `permissions.ts`, `editWorkflow.ts`, `council.ts`, `motionDirection.ts`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`, Motion Lab (`lab.seq()`).
  - Tests: `tests/motionTransitions.test.ts` (10: every kind valid, timing, blur-bridge frames, persistent wipe mattes, world camera, guide, the tool end to end, links). **Full suite: 1,203 TypeScript tests pass.**
  - **Checked on the GPU:** all 16 transitions mid-flight, the wipes (a star growing out, a circle "in" logo resolve, diagonal), and a zigzag world with an orb guide.
  - **Fixed along the way** (found on the GPU):
    - wipe mattes ended with their transition, so the beat vanished afterwards; they now persist;
    - the diagonal wipe left a strip uncovered;
    - the noise matte was dark red instead of black-to-white;
    - the whip's blur was too short to see.
- B3 ✅ **Particles, light and drawn FX.**
  - **A new `particles` layer** with 10 presets: confetti (falling with flutter and 3D-ish flips), confetti-burst, sparkle (twinkling four-point stars), dust, bokeh, speed lines, snow, embers, burst lines, ripple rings.
    - Every particle is a **closed-form function of seed and time** (drag, gravity, flutter, spin, twinkle), so any frame (preview, scrub, export) is identical.
    - Continuous presets keep a steady population; bursts fire once.
  - **3 new shader procedurals:** `mesh-gradient` (4 drifting colour blobs), `light-shafts` (god rays; a transparent overlay by default), `dot-wave` (a dot-lattice wave terrain).
  - **`add_fx`, 18 one-call accents:** confetti pop and rain, sparkles, burst, ripple, **star glint** (an 8-spike lens star), glow ring, speed lines, comic "!" marks, a **moving gradient border** around any layer, an **echo trail** (built on B2's links), plus ambient dust, bokeh, snow, embers, light shafts, mesh gradient, dot wave.
    - It drops into an existing scene (`clipId`), or onto the timeline as its own overlay; the overlay form gets its sound (pop, shimmer, glass, chime, whoosh).
  - Files: new `src/motion/particles.ts`, `src/motion/fx.ts`; `types.ts`, `evaluate.ts`, `gl/renderer.ts`, `gl/shaders.ts`, `gl/procedural.ts`, `validate.ts`, `safeArea.ts`, `polish.ts`, `coverage.ts`, `MotionInspector.tsx`, `motionTools.ts`, `council.ts`, `motionDirection.ts`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests: `tests/motionParticlesFx.test.ts` (9: determinism, population, gravity, validation, shader ids, every FX kind valid, echo links, the tool end to end). **Full suite: 1,212 TypeScript tests pass.**
  - **Checked on the GPU:** all 14 FX groups rendered.
  - **Fixed along the way:** the star glint drew only one spike, because leaf shapes don't rotate on their own; each spike is now a group.
  - *Still to do from P5 (later):* smear, painterly (Kuwahara), flakes that disintegrate a layer.
- B4 ✅ **Reference analysis and pacing QA.**
  - **`analyze_reference_video` measures motion** with a new worker (`reference_motion.py`, on the media Python):
    - cuts and **hidden cuts** (blur-bridge, white-out, black, whip);
    - **foreground swaps** (the content changes while the background stays);
    - moves with **cubic-bezier eases fitted** to their progress and matched to Helios's named eases;
    - the camera track and how much the camera moves;
    - animation on twos;
    - the audio, run through the app's own fixed tempo code, with **cuts on the beat compared with chance**.
  - It returns a headline, the numbers and a **`pacingTarget`** (±25% of what was measured).
  - **Checked on the real films:** Workly's camera moves fit `house` (the ease originally measured from Workly), and the worker finds its blur-bridge at 17.3 s and something new every 2.5 s. Virgil's include `push` (measured from Virgil). About 6 s per film.
  - **`check_pacing`** (and advice in `run_frame_qa {genre}`) scores an edit against a genre's measured pacing (every playbook now has one) or a reference target:
    - swap cadence;
    - entrance speed;
    - reading holds (words ÷ 3.3 + 0.4 s);
    - typing speed by purpose (fields ~30 cps, read-along 12–13 cps);
    - cuts on the beat against chance.
  - Files: new `src-tauri/workers/reference_motion.py`, `src-tauri/src/ref_motion.rs`, `src/lib/referenceMotion.ts`, `src/lib/pacing.ts`, `tests/fixtures/` (Workly's real profile and peaks); `motionTools.ts`, `aiTools.ts`, `motionDirection.ts` (pacing targets), `ipc.ts`, `lib.rs`, `permissions.ts`, `editWorkflow.ts`, `council.ts`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests: `tests/pacing.test.ts` (6, including Workly's real measurement). **Full suite: 1,218 TypeScript and 292 Rust tests pass.**
  - **Fixed along the way:**
    - on a white-background film every cut read as a white-out; a flash must now stand out from its surroundings;
    - moving-area energy fitted most moves as "linear"; camera travel is now used when the camera moves;
    - a triple cut from one transition counted three times.
- **Phase B: complete ✅** (B1–B4).

### Phase C: depth and characters
- C1 ✅ **`form` layer: soft 2.5D objects** (the Motion Tricks "looks 3D but is 2D" look), drawn live on the GPU.
  - **9 kinds:** sphere, capsule, cylinder, rounded box, torus, coin, slab, prism, cone. Each is a signed-distance shape, sphere-traced in a shader with a small perspective.
  - **Motion:** a keyed 3D `orientation` (tumbling cubes), squash and stretch with volume kept (bouncy balls), and a **real morph** between kinds (a sphere opening into a torus).
  - **5 looks:** soft-rim (the measured formula), jelly, two-tone, glossy, glass-fake. Plus a four-colour hue field and checker, stripe, dot or band patterns.
  - It is instant in the preview and exports the same; no Blender needed.
  - Files: new `src/motion/form.ts`; `gl/shaders.ts` (`FORM_FS`), `gl/renderer.ts`, `types.ts`, `evaluate.ts`, `validate.ts`, `MotionInspector.tsx`, `motionDirection.ts`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests: `tests/motionForm.test.ts` (4). **Full suite: 1,222 TypeScript tests pass.**
  - **Checked on the GPU:**
    - all 9 kinds;
    - the 4 other looks;
    - the hue field and a checker;
    - the sphere→torus morph in 5 steps;
    - a tumbling rounded cube next to a bouncing jelly ball with squash on contact.
  - **Fixed along the way:** a turned cube's corners were clipped; the layer box now fits the object's full diagonal.
  - *Later:* card decals (faces and eyes riding the turning object).
- C2 ✅ **Character system: first version** (for the MDS film you marked very important).
  - **A new `character` layer.** A pure pose solver turns timed actions into a pose. It is posterised **on twos** like the MDS film, while the camera and FX stay on ones.
  - Drawing is Canvas2D:
    - **rubber-hose limbs bent by two-bone IK**;
    - almond, googly or dot eyes with lids and a **star catchlight**;
    - **replacement mouths**.
  - **3 original characters:** `dome-kid` (flat dome head, hoodie with drawstrings, noodle arms), `shape-buddy` (a round creature with googly eyes), `flat-corporate` (an office worker with a tie). Palettes can be recoloured (brand colours on the hoodie).
  - **20 actions, measured on the MDS film:**
    - **hop** (2 f crouch, 1 take-off, 7 hang, 2 f fall stretched ×1.24, contact 2, squash ×0.83 for 6);
    - **leap** (3 f crouch, smear take-off, 1.7× fall stretch, 0.55× squash);
    - walk (14 f a step), sneak (12 f), run (6 f, leaning 21°);
    - wave, point and look (aimed at scene points), celebrate, shrug, nod, shake, facepalm, **surprise** (a take);
    - think, type, **talk** (mouth shapes from words), expression, turn;
    - **idle as dead holds with 2–3-drawing bursts** (not sine breathing).
  - **Automatic blinks** use the measured half/closed/closed/half + rounder-open drawing.
  - 8 expressions: normal, happy, sad, wide, determined, closed, unsure, side.
  - Walks, hops and leaps **move the layer**, so a character never walks off its own canvas.
  - **Tools:** `create_character`, `animate_character`, `lip_sync_character` (the voice-over's transcribed words drive the mouth), `list_character_actions`. There is also a new **`character-explainer` playbook** in `motion_guide`.
  - Files: new `src/motion/character/` (`types.ts`, `pose.ts`, `draw.ts`), `src/lib/characterTools.ts`; `types.ts`, `evaluate.ts`, `gl/renderer.ts`, `validate.ts`, `MotionInspector.tsx`, `motionTools.ts`, `motionDirection.ts`, `permissions.ts`, `editWorkflow.ts`, `council.ts`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests: `tests/motionCharacter.test.ts` (9: twos, the hop chart, walking distance and facing, the blink drawing, expressions and visemes, IK, validation, layer travel, the tools). **Full suite: 1,231 TypeScript tests pass.**
  - **Checked on the GPU:**
    - all 3 characters in 6 poses;
    - a performance: the kid walks in, waves, talks, is surprised and celebrates; the office worker points, shrugs and facepalms; the buddy hops and turns happy.
  - **Fixed along the way** (found on the GPU):
    - raised arms covered the face;
    - a walking character left its canvas;
    - a left-facing character pointed the wrong way.
  - *Still to come for characters (C2b):*
    - more characters, and custom rigs from a drawing;
    - Rhubarb phoneme lip sync;
    - head turns with 3/4 views;
    - light-matte pairs (colour inside a beam, silhouette outside);
    - props in hands (sockets);
    - secondary motion (drawstrings, hair).
- C3 ✅ **Blender pipeline, round two.**
  - **Camera sync.** After a render, the motion engine gets a camera that moves exactly like Blender's. `pxPerMetre` is chosen so a 3D layer at the camera target's depth keeps its size.
    - **Checked with a real orbit render:** a green 3D marker placed at a cube's world position stays locked on the cube for the whole move.
  - **Object tracks.** `track: ["cube"]` gives a `track-cube` null on the object's screen centre. Labels, rings and glints parented to it follow the 3D object.
  - **Real product UI in 3D.** Blender objects can now be image-textured `plane`s and invisible `empty` pivots.
    - `device-hero {screenImage}` puts a UI screen (from `create_ui_screen` or a `capture_product_ui` capture) on a 3D laptop or phone. Checked with the captured linear.app page.
    - New **`card-ring`**: outward-facing UI cards with solid backs, spinning (the Virgil/aflow carousel).
    - New **`sphere-bouquet`**: glossy spheres in brand colours that drop in, settle and float (aflow's drop world).
  - **Settings › Local media › 3D renders (Blender)** shows whether Blender was found and its version, with "Choose Blender" and "Find automatically".
  - Files: `blender_bridge.py` (image material, plane, empty), `blender.rs` (kinds, image check), `src/lib/blender3d.ts` (presets, `withPxPerMetre`, `cameraLayer`, `trackLayers`), `motionTools.ts`, `LocalMediaSettings.tsx`, `ai-tools.json`, `copilot.md`, `MOTION-ENGINE.md`.
  - Tests: `tests/blender3d.test.ts` (+3). **Full suite: 1,234 TypeScript and 292 Rust tests pass**, and the real-Blender test passes.
  - **Fixed along the way:** the card ring's side cards faced inward and showed mirrored UI; they now face outward with solid backs.
  - *Later:* a persistent Blender worker (no start-up per render), render passes, turning a UI screen into a textured card automatically.

## ⏳ Remaining

### Phase C: depth and characters (weeks 6–14)
- C4 ⬜ Lottie import.

### Phase D (later)
- AI-generated characters, 3D workspace panel, AI in-betweening research.

---

## Notes
- Phase 0 and Phase A are committed and pushed to `main` (commit 5acfbcf, 25 Sep 2026). Later phases will be committed as they finish.
- Tests are run after each item. The desktop app is never started or stopped, and nothing is built into `target/release`.
