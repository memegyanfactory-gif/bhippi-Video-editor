# Bhippi motion engine

This is the reference for `src/motion/`, a GPU compositor for After Effects-grade motion design
inside Bhippi. The plan it implements, and the reference film it was measured against, are in
[MOTION-DESIGN-MASTER-PLAN.md](MOTION-DESIGN-MASTER-PLAN.md).

## How it fits into Bhippi

A motion scene is a clip like any other. Its source type is
`{ type: 'motion', scene: MotionScene, title?, frames? }`, declared in `src/lib/types.ts` and
mirrored as `ClipSource::Motion` in `src-tauri/src/project.rs`.

```
MotionScene (JSON on the clip)
   │  evaluateScene(scene, t)          src/motion/evaluate.ts   pure TS, unit-tested
   ▼
ResolvedFrame: per layer matrix (2D or camera-projected 3D), opacity, masks, effect params,
               motion-blur sub-frame matrices, depth-sorted draw order
   │  MotionRenderer.renderScene(…)     src/motion/gl/renderer.ts   WebGL2
   ▼
per layer: content (footage / text / shape / solid / procedural / precomp)
           → masks → effect stack → placement (+ motion blur) → track matte → backdrop blur
           → blend mode onto the accumulator; adjustment layers filter what is below
   │
   ├─ Preview: src/editor/MotionLayer.tsx
   │    One shared off-screen renderer; each clip copies its frame to its own canvas.
   │    Videos run beside the playhead and park exactly when paused.
   └─ Export: src/motion/exportFrames.ts
        Off-screen, frame-exact: every video is sought, every matte frame loaded.
        Frames are written as a PNG sequence with alpha to the mogrt frame folder.
        FFmpeg overlays them like any picture (render/video.rs `html_frames`).
```

Preview and export run the same renderer code, so what you see is what exports.

- **Before export**, `App.tsx` calls `renderMotionScenesForExport` right after the HTML graphics pass.
- **A motion clip that has no rendered frames** exports nothing. It never falls back to a flattened stand-in.
- **Single frames** (the QA contact sheet, storyboard cards) go through `renderMotionStill` and
  `renderHtmlStill` first. They render only the frames those moments need, so a frame export
  shows the graphics.

## Layered motion comps (`src/lib/motionStack.ts`)

A scene the AI or the Graphics tab places opens as a "[Motion] …" comp with **one clip per
layer**, each on its own track, bottom to top, the way After Effects shows a comp. The user opens
the comp and moves, trims, hides, deletes, restacks or restyles any layer. A precomp layer
("Shot as card") gets its own layered comp; double-clicking its clip opens it.

- **One clip per layer.** Each layer clip is an ordinary `motion` clip. Its scene holds its own
  layer (`scene.stack.own`) plus hidden `ref` copies of what that layer needs to draw alone:
  its parents, its matte and the camera. The scene JSON carries everything, so neither the project
  format nor Rust changes.
- **Drawn as one scene.** `stackGroups` fuses the layer clips of consecutive video tracks back
  into one scene. Mattes, parents, frosted-glass backdrops, blend and adjustment layers and the 3D
  camera therefore work across clips exactly as the template built them. A fused stack and the
  original scene render pixel-identical (checked on the GPU for every media-free template).
- **Where fusion is used.** The Compositor draws a group at its bottom track's place and puts an
  invisible hit box over each layer, so clicking a title selects its clip. The export renders a
  group as one stand-in clip, with its layer clips switched off in the export copy. The preview
  cache plans groups too.
- **The clip drives its layer.** Where a clip sits and how fast it runs become the layer's
  `startTime` and `timeScale` (AE's Start Time and Time Stretch). Its Motion properties and
  their keyframes become `frame`, applied after the parent chain and the camera. Scale and
  rotation turn about the layer's own centre.
- **Clips that draw on their own.** A clip with an NLE effect, mask, crop or transition, or one
  that is reversed or held, is not fused. It draws alone through `standaloneScene`.
- **Editing the stack.** `logicalScene` reads a comp back as one scene. `restack` writes an
  edited scene back layer by layer. Each layer keeps its clip, its track (lock, visibility,
  order) and the user's moves. Precomps write into the comps they already have.
- **Older comps.** Single-clip "[Motion]" comps split in place when opened (`splitMotionComps`,
  also the `split_motion_layers` tool). The comp keeps its id, so the timeline clips that hold it
  are unchanged.
- **Limit.** A precomp's comp draws from its layers only while every picture in it is a layer
  clip. Otherwise it falls back to the scene stored on the precomp layer.
- **When the split happens.** A single-clip comp is split the moment it becomes the timeline on
  screen: from the bin, a double-click, an already-open tab, a project opening on it, or the
  assistant.
- **HTML graphics too.** "[MOGRT]" comps (`src/lib/htmlLayers.ts`) open the same way.
  - **What becomes a layer:** every animated element (Crimson's `a` class), plate and line art,
    plus any block that paints outside those. Layers are named after what they show; a root
    background becomes "Background".
  - **How a layer shows only itself:** each layer clip carries the whole graphic, and CSS scoped to
    its own copy (`data-hl-show`) shows only its part. Clicking the part in the monitor selects
    that clip.
  - **Export:** an untouched graphic renders once, as a whole. A changed one renders layer by
    layer.

## Safe area (`src/motion/safeArea.ts`)

Type, panels and cards must rest inside the editor's safe area: 5% at the sides and 6% top and
bottom (`lib/layout.ts` `SAFE`).

- **Judged at rest.** A layer is judged where it rests: on screen, at least half opaque and not
  moving. Entrances from off frame are therefore fine.
- **Clusters move together.** Layers that overlap where they rest (a panel and its words) form one
  cluster, and a cluster moves as one.
- **Fitting.** `fitToSafeArea` moves every informational cluster back inside, and shrinks it if
  it is too big. The move is applied at the top parent. `create_motion_scene` and
  `update_motion_scene` run it unless `fit: false`.
- **Left alone.** Full-frame layers, full-width bands (not type) and 3D layers bleed by design.
- **Measuring.** `evaluateMeasured` (`src/motion/measure.ts`) lays text out the way the renderer
  does, without the GPU.

## Scene model (`src/motion/types.ts`)

AE conventions throughout:

- **Units:** scene pixels, origin top-left, +y down, +z away from the viewer.
- **Angles, opacity, time:** degrees; opacity 0–100; seconds from the clip start.
- **Layer order:** layers are listed bottom to top.
- **Cross-layer links:** `link: [{prop, from, delay?, offset?, multiply?}]` makes a layer's position, scale, rotation or opacity follow another layer's keyed value, `delay` seconds behind. Uses: trails, echo copies, a label riding a card. Links are resolved in `evaluate.ts` (`linkedTransform`), and layered comps carry link sources as `ref` copies.

Any animatable value (`Prop`) takes one of three forms:

- A literal: `12` or `[960, 540]`.
- Keyframes: `{ k: [{ t, v, ease }] }`. The `ease` of a key shapes the segment that starts at it.
  - Named eases: `expo-out`, `back-out`, `spring`, and the other names in `EASE_NAMES`.
  - Or CSS-style cubic-bezier control points: `[x1, y1, x2, y2]`.
  - Measured on the reference films ([REFERENCE-FILMS-PLAN.md](REFERENCE-FILMS-PLAN.md) §2.1): `house` (SaaS entrances), `settle` (dark-AI settle), `emphasized` (panels), `rise` (wordmarks), `push` (camera push onto a target), `creep` then `snap-settle` (two-key camera move), `resolve` (a glyph shrinking into the logo), `card-zoom`. The matching durations are the `TIMING` tokens in `kit/common.ts`.
- An expression: `{ expr, v?, k? }`, in a safe interpreter (`src/motion/expr.ts`). No `eval`.
  - It supports `wiggle`, `loopOut`/`loopIn` (cycle, pingpong, offset), `valueAtTime`, `linear`, `ease`, `easeIn`, `easeOut`, `clamp`, seeded `random`/`gaussRandom`/`noise`, `posterizeTime`, `Math.*`, vector maths with broadcasting, `var` statements and the ternary operator.
  - A broken expression returns the property's own value, as AE does.

### Layer types

| Type | Draws |
|---|---|
| `footage` | Video or still, `fit` cover/contain/none. `source.matte` is the Roto matte. `cutout: true` uses it as alpha. `source.sequence {dir, fps, frames, first?, start?, digits?, ext?, loop?}` plays a numbered image sequence (`dir/00001.png`…), e.g. a headless-Blender render with alpha: an LRU of 160 frames, preview prefetch, exact frames on export. |
| `solid` | A colour. |
| `procedural` | One of `crimson-stage`, `radial-glow`, `linear-gradient`, `hex-field`, `grid`, `light-rails`, `noise`, `light-leak`, `dots`, `aurora`. |
| `shape` | rect, ellipse, polygon, star, path, line. Has fill or gradient, stroke, dash, trim paths (`trimStart`/`trimEnd`/`trimOffset`) and a repeater. **Shape trees** (`shape.groups`, src/motion/vector/): AE-style groups of `path` items (SVG path data with beziers and arcs), rect/ellipse/polygon/star, nested `group`s with their own transform, `fill`/`stroke` (colour or gradient `Paint`, gradient points in the item's own space; strokes scale with the group), `fillRule: evenodd` for holes, per-path trim. Static shapes are rasterised once and cached. Icons: `{kind:'icon', icon}` (Lucide, expanded to paths when a scene is built). **Arrays:** `{kind:'array', item, count, layout:{type:grid|ring|line…}, morph:{to, t, stagger}, opacityRamp}` repeat one item and move every copy between two layouts (tiles → dots → spinner). **Morphs:** any leaf with `morphTo` + `morphT` blends into another shape (arc-length resampled, rotation-matched). **Path operators** on a group: `ops: [{op:'merge', mode:union|subtract|intersect|xor}, {op:'offset', amount, join}, {op:'round-corners', radius}]` (Clipper2 via clipper2-ts, Boost licence), all animatable. |
| `text` | Plain text or rich `spans` (script accent word, italic, colour, strike-through). See **Text** below. |
| `null` | Nothing. A parent for other layers. |
| `camera` | AE one- or two-node camera: `zoom`, `pointOfInterest`. **Depth of field:** `aperture` (px, 0 = off) and `focus` (px from the camera, default the zoom) blur every 3D layer by its circle of confusion (`defocusSigma` in evaluate.ts; the renderer blurs the layer's content). `dof {band, near, far, max}` keeps a depth band sharp and weights the near and far sides. |
| `precomp` | A nested scene, with `offset`/`speed`, up to 6 deep. |
| `drawing` | A hand-made picture ([DRAWN-STYLES.md](DRAWN-STYLES.md)): looks riso, crayon, ink, pencil, cut-paper, felt, flat and scope. Items include primitives, generative motifs, bot and sprite characters with faces, hand-writing, the pen that follows the line and scope traces. They draw on, fill in and pop, and boil on twos. Riso prints on the GPU in halftone plates with misregistration. |

**Text layers** also take:

- **`cascade`:** a timed entrance per char, word or line. Units start at the `times` you give (usually from the transcript) or at `delay` plus `stagger`. It supports a dim-to-bright stage and an exit.
- **`animators`:** AE range selectors (start/end/offset, shapes, smoothness, randomise) driving position, scale, rotation, opacity, blur, tracking, fill colour and skew.
- **`counter`:** a rolling number.
- **`reveal`:** a typewriter reveal.
- **`type`:** live typing (`at`, `cps`, `chunk`, `script` of type/backspace/wait, `fadeIn`, `edge`, `front {color, chars|hold|settle}`, `caret` bar/block with blink). Only what is typed is laid out, so centred lines re-centre.
- **`retype`:** the new text overwrites the old left to right; changed letters flash.
- **`scatter`:** glyphs converge from seeded random offsets and turns.
- **`lineSpacing`** (animatable %) and cascade `exit.order` (`reverse`, `random`).
- **Fonts:** Inter, Manrope, Plus Jakarta Sans, Sora, Outfit, Montserrat, Fraunces, Caveat and Archivo are bundled (OFL, `src/fonts/bundled.css`); export waits for every face a scene uses (`ensureFonts`).
- **Word timing:** in `create_motion_scene`, any time may be `{word, mode: lead|land|finish|end, offset, nth}`, resolved from the comp's transcripts (`src/lib/wordTimes.ts`).

### Settings every layer has

- **Timing and rigging:** `in`/`out`, `parent`, `threeD`.
- **Transform:** anchor, position, scale, rotation, rotationX/Y, opacity, skew.
- **Layout:** `bleed: true` marks a layer that runs off the frame on purpose; the safe-area fitter and frame QA leave it alone.
- **Compositing:** `blend` (17 W3C modes), `matte` { layer, mode: alpha / alpha-inverted / luma / luma-inverted }, `hidden`.
- **Masks:** `masks[]` of rect (rounded), ellipse or path, with add/subtract/intersect, feather, expansion and invert.
- **`effects[]`:** the effect stack; every numeric param can be animated.
- **`motionBlur`:** set per layer. The scene's `motionBlur` sets the samples and shutter angle.
- **`backdrop`:** frosted glass that blurs what is behind the layer.
- **`adjustment`:** makes the layer an adjustment layer.

**Sound cues** (`scene.cues`): every procedural sound, including the SaaS/brand kit (tick, key, typing, glass, shimmer, sub, blip). Each cue is placed at its real length (or its `duration`), and text with `type` gets a typing bed for as long as it types.

### Effects

These are in `src/motion/gl/effects.ts`. Every one exports exactly as it previews.

- **Glow and blur:** glow (single or deep, three-scale), halation, gaussian / directional / zoom / lens blur.
- **Colour:** chromatic aberration, RGB split, vignette, grain, tint, duotone, black & white, brightness-contrast, hue-saturation, levels, exposure, invert, fill, radial gradient overlay.
- **Shadow and edges:** drop shadow, stroke (outside/centre/inside), matte choke.
- **Stylise and distort:** mosaic, pixel sort, displacement, turbulent displace, wave warp, lens distortion, light leak, liquid glass.
- **Print:** `riso` (any layer separated into 1–4 riso inks, halftone-screened, misregistered, on paper) and `halftone` (one ink by darkness). See [DRAWN-STYLES.md](DRAWN-STYLES.md).
- **Layer styles** (inside the layer's alpha, AE's Layer Styles): `inner-shadow` (size, distance, direction, color, opacity, choke), `inner-glow`, `bevel` (size, depth, angle, altitude, highlight/shadow colours: the inflated soft-3D look), `gradient-overlay` (up to 4 `stops`, angle, scale, `offset` to sweep, `repeat` for a moving band, blend normal/soft-light/multiply/screen).

**Matte FX** read the footage layer's roto matte:

- **`subject-reveal`:** the reference opening. Matte-quantised cells switch on from a seed at the face and cascade down the body. Each cell is born hot in the fill colour, cools to the footage and resolves to the fine matte, with bloom.
- **`matte-fill`:** a silhouette fill that wipes on, then dissolves into the footage.
- **`matte-edge-glow`:** a glow along the subject's edge.

## Templates (`src/motion/kit/`)

`MOTION_TEMPLATES` in `kit/index.ts` lists each template with:

- its id and label
- the technique ids it covers (T1…T27 from the plan)
- when to use it
- its params
- its typical length
- whether it fills the frame

Builders return `MotionScene`s in the reference's motion grammar: blur + slide + fade entrances on
expo-out, faster exits, motion blur on fast moves, and sound cues on every event.

| File | Templates |
|---|---|
| `subjectReveal.ts` | `subject-reveal`: the hook, with an optional frame-to-card move |
| `stageTemplates.ts` | `hex-roadmap`, `glass-teaching-card`, `ribbon-title`, `numbered-lanes`, `diamond-list-pip`, `node-tree` |
| `overlayTemplates.ts` | `frame-to-card`, `card-wall-3d`, `cutout-stage`, `split-rules-panel`, `stat-badges`, `dock-cursor` |
| `storyTemplates.ts` | `blurred-sentence`, `zoom-tunnel`, `social-card`, `demo-callouts`, `comparison-pair`, `grade-hit`, `big-number-behind`, `stylized-broll` |

`kit/common.ts` holds the shared grammar: `headline`, `glassCard`, `stage`, `enter`, `inHoldOut`,
the effect helpers, and `unit(ctx)`, which scales every size to the canvas's short side.

## AI tools (`src/lib/motionTools.ts`)

| Tool | Does |
|---|---|
| `list_motion_templates` | The catalogue with params. |
| `create_motion_scene` | Builds a template, or accepts a raw scene, and places it on its own track above the footage. Sound cues go on audio tracks. Footage params take `{clipId}`, which fills in the asset, source time and roto matte. `subject-reveal` finds the face (from the roto subject box) and the clean plate (from the eraser) itself. |
| `get_motion_scene` / `update_motion_scene` | Read a scene (a layered comp lists every layer with its clip id), then edit it: rebuild from template params, patch any property by path, add or remove layers, retime. On a layered comp the edit is written back layer by layer. The id can be the comp, the clip that holds it on the timeline, any layer clip, or a single scene clip. |
| `nest_motion_scenes` / `split_motion_layers` | Put loose scenes into layered comps, and open older single-clip comps into layers in place. |
| `track_motion` | OpenCV Lucas–Kanade point or planar tracking (`workers/point_track.py`, command `point_track_start`). It can write the track as keyframes on a scene layer. |
| `analyze_reference_video` | Measures a film: cuts, shot histogram, hook density, palette, contact sheets as images. Built on `refs_ingest`. |
| `save_style_profile` | Stores the profile as the project's active guideline. `builtin: "motion-designer-explainer"` is the measured reference. |
| `import_lottie` | User-supplied Lottie files only (.json or a .lottie zip via fflate; LottieFiles forbids search and bundling). `src/motion/lottie/convert.ts` turns the common subset into editable layers: shape groups with paths, rects and ellipses (as paths that start and run the way Lottie's do, so trims match), keyed transforms with each key's bezier as the ease, fills, strokes, linear and radial gradients, trim paths (offset in degrees → percent), merge paths, solids, nulls, precomps, parenting, in and out points and start offsets. Shape content around 0,0 is shifted into the layer with its anchor. It lists what it cannot reproduce (animated paths, masks, mattes, text, images, effects, expressions, time remap, repeaters, stars, skew, 3D, blend modes); in `auto` mode those files render frame by frame with lottie-web's light canvas build (MIT, no eval: CSP-safe) into a PNG sequence with alpha (`render.ts`). Checked side by side with lottie-web: the converted test file matches frame for frame. |
| `character` layer / `create_character`, `animate_character`, `lip_sync_character`, `list_character_actions` | Rigged flat characters (`src/motion/character/`). `pose.ts` is a pure, closed-form solver: timed actions → a pose, posterised to twos. The actions follow the MDS film's measured charts: hop 2/1/7/2 + contact 2 + squash 6; leap 3/1/8/4 with a 1.7× fall and 0.55× squash; walk 14 f, sneak 12 f and run 6 f a step with a 21° lean; blinks half/closed/closed/half plus a rounder open; idles as dead holds with bursts; and wave, point, look, celebrate, shrug, nod, shake, facepalm, surprise, think, type, talk, expression and turn. `draw.ts` draws with Canvas2D: rubber-hose limbs by two-bone IK, almond, googly or dot eyes with lids and a star catchlight, and replacement mouths (visemes from word timings). Walks, hops and leaps move the layer (`evaluate.ts`), so the character never leaves its box. Three original characters: dome-kid, shape-buddy, flat-corporate. |
| `form` layer (engine) | Soft 2.5D objects (`src/motion/form.ts`, `FORM_FS`): signed-distance shapes (sphere, capsule, cylinder, rounded box, torus, coin, slab, prism, cone) are sphere-traced in the layer quad by a narrow perspective camera. They are turned by their own keyed `orientation`, squashed and stretched with volume kept, and can morph into another kind with a real SDF blend. Looks: soft-rim (L = a + b·√(1 − n_z) + c·(n_xy · light)), jelly, two-tone, glossy, glass-fake, plus a four-colour hue field and object-space patterns. The layer box is the object's diagonal, so any orientation fits. |
| `analyze_reference_video` (motion profile) / `check_pacing` | `workers/reference_motion.py` runs on the media Python (OpenCV, NumPy), started by `ref_motion.rs`. It measures cuts, and hidden cuts under a blur, white or black flash, or whip; a flash must stand out from its surroundings. It also measures foreground swaps (the content changes while the palette stays) and moves with a fitted cubic-bezier matched to Bhippi's named eases. The fit is exact against camera travel and a proxy against moving area. Plus a camera track, animation on twos, and the audio as peaks in the app's format, so `beats.ts` finds the tempo. `src/lib/referenceMotion.ts` summarises it: a tempo grid, cuts on the beat against chance, and a `pacingTarget` at ±25%. `src/lib/pacing.ts` (`check_pacing`, and as advice in `run_frame_qa`) scores an edit against a genre's playbook `pacing` or a reference target: swap cadence, entrances, reading holds, typing speed by purpose, and cuts on the beat. Measured on Workly, the camera moves fit `house`, and the blur-bridge at 17.3 s was found. |
| `add_fx` | Drawn accents (`src/motion/fx.ts`) as ordinary layers: confetti pop and rain, sparkles, burst, ripple, star glint, glow ring, speed lines, "!" marks, a moving gradient border around a layer or box, an echo trail (copies with delayed `link`s under a moving layer), and ambient dust, bokeh, snow, embers, light shafts, mesh gradient and dot wave. With `clipId` it adds into that scene; otherwise it places an overlay at `start`. **Particles** (`src/motion/particles.ts`, layer type `particles`) are closed-form: each particle's spawn, drag, gravity, flutter, spin and twinkle is a function of the seed and the time, drawn with Canvas2D, so every frame is repeatable. **New procedurals**: `mesh-gradient`, `light-shafts` (a transparent overlay when there is no `bg`) and `dot-wave`. |
| `list_transitions` / `create_motion_sequence` | Beats joined into one scene (`src/motion/sequence.ts`). Each beat (a template, a UI screen, a raw scene or an existing motion clip) is a precomp that starts playing as it comes into view. There are 27 transition kinds as keyframes on the beats' precomp layers, plus mattes and overlays. Overlapping kinds start the next beat half a transition early. Wipe mattes stay for the rest of the beat, and their end state reveals it all. Measured timings: blur-bridge is 1 f on, cut 3 f later, 7 f back; white-out 7–13 f; black-breath 12 f; z-recede pop-and-rise 13 f. `layout: world` parents the beats to a `world` null on one canvas (row, column, zigzag or grid) and trucks it on the house ease, so the background never cuts; other kinds jump the camera at the cut. The `guide` is a dot, orb, sparkle or ring on top that travels between stops. Beats' cues are shifted and transitions add their own. Check it in the Motion Lab with `lab.seq()`. |
| `list_ui_kinds` / `create_ui_screen` / `update_ui_screen` | Living product UI (`src/motion/ui/`). The screen's HTML is either a ready-made kind from `kinds.ts` (search, chat, dashboard, table, form, notifications, kanban, pricing) or the AI's own markup with `data-part` names. `raster.ts` rasterises it once in the webview, through the foreignObject path with the bundled fonts inlined, at 2×. That gives the screen without its parts, a picture per part (children left out, a 24 px margin for shadows) and a part map: boxes, nesting, list groups, radius, and the text style of fields the engine types into. The pictures go to `Generated/UI screens/` (`ui_screen_save`). `compile.ts` turns the actions into keyframes inside one precomp: device chrome (browser, phone, laptop, glass card), a footage layer per part parented like the DOM, live text for typing (the field's text is the placeholder) and counters (format kept), ripples, outlines, tooltips and notifications, states as precomps (cut, fade or slide), a cursor gliding on the house ease with a press dip, and the camera push as the precomp's anchor and scale. Hover-lift is 9 f in, 19 f hold and 8 f out at ×1.088, with the part's list siblings dimmed to 32%. Cues: click, tick, typing, blip, pop, whoosh. The scene keeps `template: ui-screen` with the spec and part map, so `update_ui_screen` recompiles new actions without re-rendering. The user's own product works through screenshots. `capture_product_ui` screenshots a URL at 2× in headless Edge or Chrome (`ui_capture`) and shows the AI the picture with a 100 px grid. The AI marks `parts` by box, and `create_ui_screen {screenshot, parts}` cuts them out. Fields that are typed into are painted clean with the surrounding colour, and the slots of dragged or assembled parts are filled. Any picture in the library works the same way (`assetId`). Check it in the Motion Lab with `lab.ui()`. |
| `list_3d_presets` / `render_3d_scene` | Real 3D from the user's own Blender, run headless (`src-tauri/src/blender.rs`, worker `workers/blender_bridge.py`, GPL, run as a separate program). A preset (`src/lib/blender3d.ts`: pearl-core-orb, crystal-gradient-env, device-hero, logo-extrude, letters-drop) or a raw scene of primitives, crystals and extruded text with material presets, a colour or hand-made gradient world, studio lights and a keyed camera. Keys use the engine's eases, mapped 1:1 onto bezier F-curve handles. The render is a PNG sequence with alpha in the project's `3D renders/` folder, placed as a `source.sequence` footage layer. `camera.json` gives the camera per frame in engine pixels; `objects2d.json` gives each object's screen box per frame. Draft is EEVEE (about 0.7 s a 1080p frame); final is Cycles on the GPU (about 3 s). Blender is found through the `blenderPath` setting (Settings › Local media › 3D renders), `$BLENDER`, PATH, or the install folders. **Camera sync:** `camera.json` becomes a motion-engine camera (`cameraLayer`), and `pxPerMetre` is chosen so that a 3D layer at the camera target's depth keeps its size. It was checked with a marker locked on a Blender cube through an orbit. `objects2d.json` gives `track-<id>` nulls (`trackLayers`). Objects can be `plane` (UV 0–1, upright) with an `image` material for real UI screens, or an invisible `empty` pivot. More presets: `card-ring` (outward-facing image cards with solid backs, spinning) and `sphere-bouquet`. |

- **`reveal_subject`** now defaults to the cell reveal. The old tile grid is still available as `style: "cubes"`.
- **`erase_subject_clip`** refuses a clean-plate range that crosses a scene cut.
- **Frame QA** (`run_frame_qa`, `src/lib/polish.ts`) is the polish pass. It covers the whole
  timeline or the in/out selection. It measures:
  - every motion layer where it rests, including inside nested "[Motion]" comps
  - HTML graphics, titles and captions
  - reduced footage cards
  - the roto subject

  It reports anything off the frame or outside the safe area, graphics over the face, collisions
  and black edges. From rendered frames with the graphics drawn in, it also reports blank frames:
  flat white, empty black, or one flat colour.
- **Background plate.** Over a background plate on the timeline, full-frame brand templates get
  `background: "none"`. A light brand stage covering the plate reads as a blank white frame.

## Editing by hand

When a layer clip is selected, the Properties panel shows that layer: its words, colour, blend,
motion blur, effects and JSON. The template params rebuild the whole stack.

When a single motion clip is selected, the Properties panel shows a Motion inspector
(`src/panels/MotionInspector.tsx`) with:

- template params and a Rebuild button
- motion blur samples and shutter angle
- the layer list, with blend mode, motion blur, visibility and effect toggles per layer
- the raw scene JSON, validated when you apply it

## Checking your work

- **Unit tests:**
  - `tests/motionEngine.test.ts`: easing, keyframes, expressions, 3D, parenting, text engine.
  - `tests/motionTools.test.ts`: validation and the tools.
  - `tests/motionStack.test.ts`: split, fuse, retime and restack of layered comps.
  - `tests/motionSafeArea.test.ts`: the safe-area check and fitter, over every template.
  - `tests/motionKit*.test.ts`: every template at landscape and portrait.
  - `render::tests::motion_scenes_export_*`: the FFmpeg side.
- **Motion Lab** (`motion-lab.html`, dev only). Run `npx vite --port 1437`, then open
  `http://localhost:1437/motion-lab.html?media=http://127.0.0.1:8765` with a CORS file server
  serving test media. `window.lab.sheet(scene, times, scale, cols)` renders contact sheets and
  `window.lab.timing(scene, t, scale)` measures frame cost. The scenes live in
  `src/motion/lab/scenes*.ts`.
- **Performance:** measured in Chromium, on this machine's GPU, at 1280×720.
  - The subject-reveal hook takes about 45 ms per frame at full resolution and about 25 ms at half preview resolution. That includes 8-sample motion blur on the card and three-level glows.
  - Settled text is not re-rasterised.

## Limits and next steps

- **Shared video elements:** footage is decoded through `<video>` elements, one per file. Two layers showing the same file at different times share one element. WebCodecs decoding would lift that limit and speed up export.
- **Low-resolution mattes:** the roto matte preview sequence is 512 px wide. The reveal and cut-outs upsample it. A guided-filter refinement against the footage would sharpen hair.
- **No vector corner pin:** planar tracks drive position, scale and rotation only, not a corner pin.
- **Text is rasterised:** text is drawn with Canvas2D per glyph (cached when static). Very large type under a strong camera push is re-rasterised at the density it needs.
