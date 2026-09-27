# 2D character animation upgrade

## Goal

Make the existing customizable 2D characters feel deliberately animated: readable poses, fluid arcs, anticipation, weight, follow-through and clean individual drawings. Retain the shared character library and wardrobe. The 3D studio is outside this change. This is a rigged animation upgrade; it does not promise unique artist-drawn artwork for every intermediate pose.

## Audit

- The room holds the entire viewport at 12 fps by default, including cursor following and turns.
- Gesture selection and stance changes snap. Wave and gait depend on page uptime instead of action-local time.
- Leg lengths are recalculated from target distance each frame. Feet have no clear contact/swing phase.
- A folded sine in the timeline solver prevents one foot from alternating correctly.
- Head roll is supplied but never drawn; blinks are binary and secondary motion is weak.
- Ink regenerates random contours and a full-character displacement filter every drawing. A preliminary 60-frame sample took about 39 ms per ink render versus 9 ms clean, before browser paint.
- Timeline rendering discards much of the original pose and maps different actions to the same stance. Room, timeline and export use different timing/style.

## Implementation sequence

### 1. Shared deterministic motion

Create `public/characters/motion2d.js` with pure time-based sampling. The input is the character, timeline time, timed actions and optional 2D settings. The output includes body-local hand and foot targets, bend directions, head rotation, eyelid closure, hair lag, body compression and root position. No live spring state, wall clock or random frame noise may influence seeking/export. Action curves use local time and blend into and out of the resting pose.

Build expressive idle, wave, hop/leap, walk/run/sneak, talk and celebration first. Preserve the existing action vocabulary and distinguish pointing, thinking, shrugging, facepalm, typing, surprise, head gestures and turning. Use anticipation, contact, recovery and restrained overshoot where they support the action. Energy and secondary-motion controls change amplitude with safe bounds.

### 2. Renderer and drawing quality

Consume the sampled pose before inverse kinematics. Use stable limb lengths and reachable targets. Draw head roll, partial eyelid closure and delayed hair motion. Keep artwork identity and wardrobe intact. Keep contour texture stable and remove the noisy full-frame filter from the normal animation path. Preserve legacy static rendering calls for thumbnails and other consumers.

### 3. Animation workbench

Add a Motion tab with labeled action previews and saved character settings: Smooth, 24 fps and 12 fps timing; energy; secondary motion; clean/drawn line style. Add play/pause, restart, loop, playback speed, scrub and previous/next drawing controls. Onion skin shows adjacent drawings only while paused. Blend interrupted previews and pose changes. Export the displayed pose as the still image rather than silently resetting it to time zero.

Separate transport from drawing cadence. Keep controls and camera input responsive, stop animation while the page is hidden, and respect reduced-motion preferences with paused initial playback. Keep the stage large by placing motion settings in the existing inspector and collapsing identity controls. Settings survive saved-character round trips through both studios.

### 4. Timeline and export parity

Load the same motion module in the editor. Forward the complete sampled pose to the renderer. Apply root movement exactly once, accounting for the engine-to-layer scale. Respect existing explicit `step: 1|2|3`; new studio characters use their saved timing preference. Keep built-in rigs compatible, fixing only verified gait/blink defects. Match line style without relying on unsupported SVG filters.

### 5. Verification and review

- Determinism: the same character/action/time gives the same pose after arbitrary seeks.
- Continuity: action entrances, exits and interrupted gestures have bounded position changes.
- Gait: left/right feet alternate, grounded phases remain grounded, and limb geometry stays finite.
- Coverage: all twenty examples render across representative actions, rotations and body proportions.
- Parity: preview and timeline share sampling, cadence, hand selection and root movement.
- UI: inspect playback, pause, looping, scrubbing, frame stepping, onion skin, turntable, wardrobe and saved settings in the browser; inspect a narrow layout.
- Performance: compare representative sampling/rendering costs and check browser errors. Report actual observations rather than guaranteeing a universal frame rate.
- Run focused animation tests, type checking and the production build. Review the scoped diff and preserve other agents' changes.

## Completion record

Implemented and verified on 2026-09-27.

### Delivered

- A shared deterministic sampler for the existing action vocabulary, with eased pose envelopes, jump anticipation/recovery, alternating contact/swing gait, gradual blinks, speech motion and secondary hair/clothing motion.
- Fixed-length limb solving, head roll, stable contour geometry and an inexpensive normal ink path. Full-body actions release peace/pockets/crossed-arm resting poses and blend back afterwards.
- A Motion inspector with 12 quick previews, saved cadence/energy/follow-through/contour settings, play/pause, loop, speed, scrubbing, accurate previous/next drawing and paused onion skins.
- Captured-pose blending for interrupted actions and loop seams. Pausing freezes an in-progress blend and pointer tracking. The still-image export samples the current displayed pose.
- Shared studio/timeline sampling and root placement, backward-compatible explicit cadence overrides, and bounded drawing/XML/geometry caches. Tool descriptions now explain library timing correctly.
- Hidden-page suspension plus explicit host visibility messages for CSS-hidden 2D iframes; the 3D engine was not changed. Narrow layout, visible keyboard focus and reduced-motion defaults are included.

### Verification

- `npm run test:ui`: 155 files passed; 1,465 tests passed, 1 skipped. This includes 34 shared-motion regressions, 13 library integration tests, 11 legacy-character tests and 3 canvas-cache tests.
- `npm run build`: passed (TypeScript and production bundle). Existing ONNX eval, mixed Tauri imports and large-bundle warnings remain.
- Scoped ESLint, syntax checks for the three edited character scripts, and `git diff --check`: passed.
- Browser inspection at 1280 × 720 and a narrow viewport with 375 px usable content width. No horizontal overflow after the responsive correction; no application console warnings/errors observed.
- Browser controls verified for pause, action selection, scrub, held-frame stepping and two neighboring onion-skin drawings. Contact sheets reviewed jump phases and character poses. Independent geometry checks across all 20 presets and maximum gait energy found planted-foot vertical error below 0.2 engine pixels in the sampled cases.
- The live room displayed approximately 5 ms drawing-generation/DOM-update cost in a local spot check. This excludes browser paint and is not a universal frame-rate promise. Repeated held drawings reuse bounded timeline caches.
- Review fixture: `docs/character-studio/2d-motion-review.html`. Studio screenshot: `docs/character-studio/2d-upgrade-preview.png`.

### Boundaries and remaining limitations

- This remains rigged 2D/2.5D animation, not individually illustrated anime cels. No drawing editor, artist-authored replacement frames or automated anime generation was added.
- Foot contacts stay grounded vertically, but arbitrary eased world-space travel can still slide horizontally; perfect stride-to-distance foot locking is a future refinement.
- The Add to project button still exports a transparent still PNG. Animated character layers use the existing timeline action workflow and shared renderer. Timeline/export parity has automated sampling/canvas coverage; a full native video-encode run was not performed in this pass.
- Saved-character data and unrelated workspace changes were preserved. No commit, publication or 3D redesign was performed.
