# Motion engine audit: how close can Bhippi get to a premium product launch film?

Date: 2026-09-30. Scope: `src/motion` (scene format, evaluator, GPU renderer, effects, UI screen compiler, template kit, sequences, export), the AI tools that drive it (`src/lib/ai-tools.json`, `src/lib/motionTools.ts`, `src/lib/uiScreenTools.ts`, `src-tauri/src/ui_screen.rs`), the prompt section "MOTION ENGINE" (`src-tauri/prompts/copilot.md:127-153`) and the playbooks (`src/lib/motionDirection.ts`).

The target look is a premium launch film. The camera starts close on a real piece of the app. A labelled cursor clicks, and text types in time with the voice. The window then pulls back and tilts in 3D with depth of field and motion blur, comes apart into panels, and ends on a logo lockup and an end card.

---

## 0. Summary

**The core is strong.** It is an After Effects-style compositor with keyframes, bezier and measured eases, expressions, 3D layers, a camera with point of interest and aperture, parenting, mattes, 17 blend modes, adjustment layers, about 40 effects, live typing and a UI-screen compiler. It renders identically in preview and export, and it is fast. On an RTX 3080, a 1080p frame with a tilted UI plane, a moving camera, DOF, 16-sample motion blur and a grain/vignette finish renders in about **26-44 ms**.

**The gaps sit between the parts rather than inside them.**

- The UI screen is a *flattened precomp* with its own 2D "zoom". It never meets the scene camera.
- DOF is one blur value per layer, so a tilted window cannot go soft along its far edge.
- Focus does not follow the camera.
- The cursor has no label.
- UI "states" are whole pages, not per-part variants.
- The real-product capture is one flat screenshot whose parts the model has to eyeball off a grid.
- None of the 45 templates is a product-demo camera shot. Only 3 use a camera, 0 use DOF, and 1 uses type-on.

Premium shots are *possible* today in a hand-written raw scene. They are not *reachable* for the AI without expert JSON authoring, and the first attempt falls into traps (see §2.3).

---

## 1. Capability map (what exists, with file:line)

### 1.1 Scene model and evaluation

| Capability | Status | Where |
|---|---|---|
| Layer types: footage (video/image/PNG sequence, roto matte, cutout), solid, procedural (13 kinds), particles (10 presets), form (soft 2.5D solids), character, drawing, shape (full vector tree), text, null, camera, precomp | Yes | `src/motion/types.ts:400-423`; procedural kinds `types.ts:319`; particles `particles.ts:8`; forms `form.ts:11-13` |
| Keyframes with named eases, including eases measured on films (`house`, `settle`, `emphasized`, `rise`, `push`, `creep`, `snap-settle`, `resolve`, `card-zoom`), cubic-bezier, spatial arcs (`arc`, `through`), per-axis eases | Yes | `types.ts:19-48` |
| Expressions: `wiggle`, `loopOut`, `linear`/`ease`, `posterizeTime`, `valueAtTime`, `random`, `thisComp` (no cross-layer `thisComp.layer()` references) | Yes | `src/motion/expr.ts:1-10, 275-337` |
| Cross-layer links (a layer follows another's position, scale, rotation or opacity with a delay) | Yes | `types.ts:376`, `evaluate.ts:166-188` |
| Parenting (any depth, cycle-safe; the camera can be parented, so a rotating null gives an orbit) | Yes | `evaluate.ts:220-243`, camera parent `evaluate.ts:261-270` |
| 3D layers: position z, rotationX/Y/Z, scale z; runs of 3D layers depth-sorted back to front | Yes | `evaluate.ts:190-217` (order: translate → Z → Y → X → skew → scale → anchor), sort `evaluate.ts:378-391` |
| Camera: zoom (FOV), two-node point of interest, one-node "look ahead", roll, parentable (orbit, dolly, truck); animatable | Yes | `types.ts:415-421`, `evaluate.ts:246-284` |
| Camera orientation (pan/tilt without a POI) | Only via POI or parent null | `evaluate.ts:273` (a one-node camera looks straight down +z; its own rotationX/Y are ignored) |
| Depth of field: `aperture`, `focus`, `dof {band, near, far, max}` | Yes, **one blur value per layer** (from the layer centre's depth) | `evaluate.ts:53-60, 355-360`; blur applied `gl/renderer.ts:328-337` |
| Autofocus (focus follows the POI or a layer) | **No**. Focus defaults to `zoom` and stays there | `evaluate.ts:279` |
| Motion blur: per-layer flag, scene `samples` (≤32, default 8) and `shutter` (default 180°); transform-only sub-frames (camera moves included for 3D layers) | Yes | `types.ts:365, 435`; `evaluate.ts:334-352`; accumulation `gl/renderer.ts:351-355` |
| Motion blur of content that changes *inside* a layer (precomp internals, typing, scrolling) | No (the content is rendered once per frame, then placed N times) | `gl/renderer.ts:343-356` |
| Masks (rect, ellipse, path; add/subtract/intersect; feather, expansion) and track mattes (alpha, luma, inverted) | Yes | `types.ts:81-95, 358`; `gl/renderer.ts:300-307, 416-429` |
| Blend modes (17), adjustment layers, frosted `backdrop` blur | Yes | `types.ts:55-60, 367-369`; `gl/renderer.ts:403-453, 460-473` |
| Precomps (nest depth 6), time offset and speed | Yes, **always flattened to a 2D texture** (no "collapse transformations": child 3D layers never share the parent camera) | `gl/renderer.ts:290-293` |
| Lights, shading of 3D layers, cast shadows, reflections | **No** (the Blender route covers real 3D) | none in `src/motion`; Blender: `ai-tools.json:7152` |
| Time remap, layer start time and time stretch | Yes | `types.ts:330, 384-385` |

### 1.2 Effects (`validate.ts:13-18`, implementation `gl/effects.ts:113-280`)

glow (deep, three radii), gaussian-blur, **lens-blur (the same gaussian, `effects.ts:117-119`, no bokeh)**, directional-blur, zoom-blur, chromatic-aberration, rgb-split, vignette, grain (animated), tint, duotone, black-white, brightness-contrast, hue-saturation, levels, exposure, invert, fill, drop-shadow (layer space), stroke, halation, mosaic, pixel-sort, displacement, turbulent-displace, wave-warp, lens-distortion, light-leak, liquid-glass, radial-gradient-overlay, matte-choke, subject-reveal, matte-fill, matte-edge-glow, inner-shadow, inner-glow, bevel, gradient-overlay, riso, halftone. Every numeric parameter can be animated (`evaluate.ts:93-103`).

**Pipeline precision:** RGBA8 premultiplied render targets (`gl/core.ts:4, 117`). Glows, blurs and dark gradients can band.

### 1.3 Text (`types.ts:113-221`, `src/motion/text.ts`)

- Per-glyph animators with range selectors: char, word or line; position, scale, rotation, opacity, blur, tracking, fill, skew (`types.ts:114-140`).
- Cascades timed per unit from the transcript, with dim-to-bright karaoke and an ordered exit (`types.ts:147-161`).
- **Live typing** `text.type`: cps, word chunks, a type/backspace/wait script, a feathered edge, a coloured front, bar or block caret with blink (`types.ts:202-221`, `text.ts:192, 230`).
- Retype morph (`text.ts:211-220`), scatter-converge, counters (`text.ts:73-75`), strike-throughs, rich spans, animatable line spacing.
- Voice sync: any time in a new scene can be `{word:'ROI', mode:'lead'|'land'|'finish'}`, resolved against the timeline transcript (`motionTools.ts` around 876-883).
- Text re-rasterises at the density it lands on screen (capped at 4×; `gl/renderer.ts:42-58, 195-215`), so it stays crisp under a camera push. This was confirmed visually at 3.3×.
- Not available: 3D per-character (the glyphs animate in the layer plane only) and extruded type (Blender only).
- Fonts: 9 bundled families (`fonts.ts:9`), plus whatever the brand kit loads.

### 1.4 UI screens (`src/motion/ui/*`)

| Feature | Status | Where |
|---|---|---|
| Screen from AI-written static HTML/CSS with `data-part` elements (nested), rasterised per part at 2× via SVG foreignObject; each part becomes its own image layer | Yes | `ui/spec.ts:56-100`, `ui/raster.ts:1-5, 155-217` |
| Screen from a screenshot with parts marked by box (cut out; typed fields painted clean) | Yes, **single state only** | `ui/raster.ts:97-152` (`states: [state]` at line 152) |
| Ready-made kinds: search, chat, dashboard, table, form, notifications, kanban, pricing | Yes | `ui/kinds.ts:39-178` |
| Actions: type, type-script, click (glide, press, ripple), hover/cursor, hover-lift, sweep, select, highlight/pulse/focus, count, tooltip, notify, assemble, drag, state (cut/fade/slide), zoom | Yes | `ui/spec.ts:14-42`, compiled `ui/compile.ts:162-349` |
| Cursor: arrow, hand or dot; enters from off-screen; glides on the house ease; press squash; hides after the last action | Yes | `ui/compile.ts:70-87, 416-440` |
| **Labelled cursor** (name tag), multiple cursors, custom cursor art | **No** | `ui/compile.ts:70-87` |
| Click ring pulse | A ripple ellipse, yes | `ui/compile.ts:188-205` |
| States | **Whole-screen pages only** (each a precomp shown in a time window); no per-part variants such as button off/on or menu open | `ui/spec.ts:74`, `ui/compile.ts:388-414` |
| Device frames: browser (with URL), phone, laptop, glass-card, none | Yes | `ui/compile.ts:22-68` |
| Placement: width share, position, enter rise/scale/fade, exit; `tilt: [rx, ry]` | Yes, but **tilt is static numbers** (not keyed) | `ui/compile.ts:442-477` |
| "Zoom" into a part | Yes, but it is **2D scale plus anchor of the precomp**, not a camera | `ui/compile.ts:457-466` |
| Motion blur on the screen, cursor or parts | Not set by the compiler | `ui/compile.ts:474-479` |
| Sound cues for UI events (click, tick, typing bed, whoosh) | Yes | throughout `ui/compile.ts` |
| Output | One `ui-screen` precomp layer (+ optional stage solid) inside a scene tagged `template: ui-screen` | `lib/uiScreenTools.ts:84-102` |

### 1.5 Real-product capture

- `capture_product_ui` runs headless Edge or Chrome `--screenshot` at 2× in a fresh profile (so no login), with a 60 s timeout. It returns a PNG and a gridded JPEG preview for the model (`src-tauri/src/ui_screen.rs:80-117`, `lib/uiScreenTools.ts:52-79, 125-135`).
- It has no DOM access: no element boxes, no selectors, no states, no scripted clicks or typing.
- The model reads part boxes off a 100 px grid by eye.

### 1.6 Templates (built with `vite-node`-equivalent bundling and inspected, 2026-09-30)

There are 45 engine templates (`kit/index.ts:48`): 7 brand, subject-reveal, 6 stage, 8 overlay, 10 story, 13 fun/fx, 10 drawn.

| Feature used | Count | Templates |
|---|---|---|
| Camera layer | 3 | hex-roadmap, numbered-lanes, card-wall-3d |
| 3D layers | 7 | the above + frame-to-card, social-card, fx-money-rain, fx-confetti |
| Motion blur | 18 | mostly stage and overlay |
| Camera aperture (DOF) | **0** | none |
| Live type-on | **1** | brand-logo-sting |
| UI screen / product demo | **0** | `dock-cursor` and `cursor` are 2D icon docks, not an app |

Relevant pieces that already exist:

- `brand-logo-sting`, `brand-end-card` and `brand-title`.
- The `cursor-demo` HTML template (in `create_motion_graphic`, not the engine).
- `zoom-tunnel`.
- Sequence transitions (`sequence.ts:20-24`): zoom-through, blur-bridge, z-recede, card-zoom-reveal, truck and 23 more.

`create_motion_sequence {layout:"world"}` moves a **2D null**, not a camera (`sequence.ts:375`).

### 1.7 Render, export, quality and speed

- **Parity.** One renderer serves the preview and the export (`gl/renderer.ts:1-3`, `exportFrames.ts:1-3`). Export renders each motion clip, or each fused layer stack, off-screen to a straight-alpha PNG sequence that FFmpeg overlays (`exportFrames.ts:42-81, 151-182`). Frames are frame-exact: every video is sought and every matte loaded (`prepareExact`).
- **Preview differences.** While playing, preview renders at reduced scale and **drops motion blur when quality < 0.75** (`src/editor/MotionLayer.tsx:143`). Scrubbing and export include it.
- **Measured** in the Motion Lab at `http://localhost:5199/motion-lab.html` (headless Chromium, ANGLE on RTX 3080). The scene was the demo UI compiled by `compileUi`, made `threeD` with keyed tilt, a camera dolly/POI move, aperture 25-60, 16-sample motion blur, a type-on title and a grain + vignette adjustment layer:
  - UI rasterisation (HTML → 1 base + 13 part PNGs): **~290 ms**
  - 1080p render with motion blur: **26-44 ms/frame**; without: 7-46 ms (the first frame is warm-up)
  - 2160p (scale 2): **~61 ms/frame**
  - PNG encode of a 1080p frame: **~60-70 ms** (the app pipelines it on workers), so encoding, not the GPU, bounds export
  - A 15 s film at 30 fps (450 frames): about 15-20 s of GPU plus encode, **under a minute**

---

## 2. How the AI builds a scene today

### 2.1 Template path (the default)

The flow is `list_motion_templates` → `list_motion_templates {query:id}` for the slots → `create_motion_scene {template, params, start}` (`motionTools.ts:786-806, 808-923`). Along the way:

- `fixTemplateArgs` repairs weak-model params.
- `buildInBrand` applies the brand kit.
- Word refs resolve to transcript times, and icons expand.
- `validateScene` runs (structure only).
- `fitToSafeArea` pulls 2D type and panels inside the frame; 3D and `bleed` layers are exempt (`safeArea.ts:71`).
- `explodeScene` turns the scene into a layered "[Motion]" comp, one clip per layer.

Freedom is limited to each template's slots: words, times, colours, a few layout switches. For UI there is `create_ui_screen` (kind + content, or HTML, or a screenshot + parts, plus timed actions, `place` and `cursor`), and `create_motion_sequence` joins beats (`{template}`, `{ui}`, `{scene}`) with transitions.

### 2.2 Raw scene path

`create_motion_scene {scene}` accepts any `MotionScene` (`motionTools.ts:866-871`), brandified if a kit is active. `update_motion_scene` then allows `patches` by dotted path, `addLayers`, `removeLayers`, `retime` and `scene` field replacement.

In principle this is **near-total freedom**: the whole of `types.ts`, including cameras, DOF, motion blur, mattes, adjustment layers and expressions.

In practice there are four limits:

1. **A UI screen cannot be declared inside a raw scene.** There is no `ui` layer type. The model must call `create_ui_screen` and then patch that comp (for example add a camera, set `threeD` or key the tilt on `ui-screen`), or copy the compiled precomp with its raster paths into its own scene.
2. **Coordinates are the model's problem.** To aim the camera at the "send button" it must compute the part centre × the precomp's scale and anchor tracks (which the compiler keys itself for `zoom`) → comp px → the 3D target.
3. **Validation is structural** (`validate.ts:51-117`). Nothing catches "the glow blows out a white UI", "focus is 3 m behind the subject" or "the typed title sits on top of the window".
4. The playbooks (`motionDirection.ts`) describe product-launch and ui-walkthrough beats only in terms of `create_ui_screen` and `text.type`. They carry no camera recipe (`motionDirection.ts:280-317`).

### 2.3 What happened when we hand-built the target shot (the audit's own test)

About 40 lines of raw JSON over the compiled demo UI produced a credible tilted, pulled-back window with a typed field, click ripple, counting number and tooltip. It took two tries, and these were the pitfalls:

- A glow adjustment layer (threshold 0.75) washed the whole white UI into a grey haze. Premium "finish" needs presets that know light UIs.
- The opening close-up (camera at 0.35× distance) was **completely defocused**, because focus stays at `zoom` while the camera moves. There is no autofocus.
- At the end of the pull-back the *whole* tilted window was equally soft. The far edge was no softer than the near edge (per-layer DOF).
- The UI compiler's own `zoom` (precomp scale 48 → 96 %) stacked on top of the scene camera. There are two "cameras" to reconcile.
- The shadow is a layer-space drop shadow that tilts with the window. It does not fall on a floor.
- The close-up (≈3.3× on the UI) was acceptably sharp. Live text is crisp, and the baked part PNGs are slightly soft; `resolution: 3` would fix them.

---

## 3. Gaps for a premium launch film

Ordered by impact on the look. Each gap gives why it matters and where it goes.

### G1. The UI screen should live in the scene's 3D space
**Why:** the signature shots are the camera flying *between* parts of the app, panels separating into depth, and the window tilting while parts lift off it. Today the whole app is one flat texture (`gl/renderer.ts:290-293`; compiler output `ui/compile.ts:474-477`), so parts can never have depth or parallax.
**Where:**
- (a) An `explode` / `depth` option in `compileUi` that emits the base and parts as top-level `threeD` footage layers parented to a `ui-root` null, with per-part z (`ui/compile.ts:353-414`, plus the "screen in the comp" block at 442-479).
- Or (b) a general AE "collapse transformations" flag on precomps: in `evaluate.ts:worldMatrices`, evaluate the child layers with the parent's world matrix and the *outer* camera. The renderer would then draw them in the outer depth sort instead of `renderScene` into a texture.
- (a) is smaller and keeps `motionStack` explode behaviour simple.

### G2. A real camera for UI shots, plus UI camera actions
**Why:** "start close on one piece, then pull back to the whole window tilted in 3D" is the core move. The compiler's `zoom` is a 2D scale (`ui/compile.ts:457-466`), `tilt` is static (`ui/spec.ts:89`, `compile.ts:472-477`), and nothing turns on motion blur.
**Where:**
- New `UiAction`s in `ui/spec.ts:14-42`: `{type:'camera', t, target?: part, distance?, tilt?: [rx,ry], orbit?, duration, ease}` and `{type:'pull-back'}`.
- `compileUi` emits a `camera` layer with POI keys aimed at part centres, which it already knows (`centre(p)`).
- Set `motionBlur: true` on the screen, parts and cursor, and a scene `motionBlur` default.

### G3. Per-pixel depth of field
**Why:** a tilted window sharp at the focus line and melting toward the far corner is the "expensive lens" read. `defocusSigma` uses only the layer centre's depth (`evaluate.ts:355-360`), and the renderer blurs the whole layer uniformly (`gl/renderer.ts:328-337`).
**Where:**
- In `evaluate.ts`, return the depths at the four corners, not just the centre.
- Add a variable-radius blur pass in `gl/effects.ts` / `gl/shaders.ts`. The CoC per fragment comes from the plane equation of the placed quad; it is a mip-chain or two-radius lerp blur, placed after `content()` in `gl/renderer.ts`.
- A cheaper fallback is to split tilted layers into strips with a stepped sigma.
- Optionally add bokeh-shaped highlights to `lens-blur` (today it is a gaussian, `effects.ts:117-119`).

### G4. Autofocus
**Why:** without it every close-up camera move is soft unless the model hand-keys `focus` (as observed).
**Where:** the camera type `types.ts:415-421`: `focus: 'poi' | {layer: id}`, plus `dof.pull` (seconds of lag for a rack focus). Resolve it in `cameraAt` (`evaluate.ts:279`) as the distance from the eye to the POI or to the layer centre.

### G5. Labelled cursor and richer cursor
**Why:** the reference's cursor carries a name tag ("Bhippi AI", a collaborator), pulses a ring on the click and sometimes hands over to a second cursor. Today it is arrow, hand or dot only (`ui/compile.ts:70-87`).
**Where:**
- `ui/spec.ts:78`: `cursor.label {text, color, side}`, `cursor.ring` (a ring pulse separate from the part ripple) and `cursors: [...]` with per-action `by`.
- `compileUi` cursor block `416-440`: the label as a parented shape + text layer.

### G6. Per-part states
**Why:** "the send button turns on, the model menu opens, the chat box goes from empty to typed to sent" are part swaps. They should not be page changes. States are whole screens today (`ui/spec.ts:74`, `compile.ts:388-414`), and screenshot mode supports only `main` (`ui/raster.ts:152`).
**Where:**
- HTML: allow `data-part="send" data-state="on"` variants (siblings with the same part name). `raster.ts` rasterises each variant.
- A new action `{type:'set', target, state, transition:'cut'|'fade'|'morph'}` compiles to crossfaded footage layers in the same slot (`compile.ts` parts map, 108-121).
- Screenshot mode: `parts[].states: [{id, screenshot|box}]`.

### G7. DOM-aware capture of the real app
**Why:** to show Bhippi itself (or any product) as named, cut-out, stateful pieces. The current capture is one pixel screenshot with guessed boxes (`ui_screen.rs:80-117`). Boxes off by 10-20 px make cut-out parts visibly misaligned, and there is no login or local-state support.
**Where:**
- A new `capture_product_ui` mode driven over Chrome DevTools Protocol (`--remote-debugging-port`, or a small Node/Playwright script shipped with the app). It would:
  - navigate
  - optionally run a script of clicks and typing to reach states
  - return element boxes for requested selectors, roles or text, plus per-element screenshots, per state
- Return the result as `parts` for `rasterizeShot`, so no eyeballing is needed.
- For Bhippi's own UI the Vite dev server (`localhost:5199`) already serves the real React UI, which a headless browser can drive.
- Keep the foreignObject HTML path for AI-written screens. It cannot load external images or non-bundled fonts (`raster.ts:46-66`).

### G8. A product-demo template family
**Why:** the model reaches premium only through templates. None of the 45 is a UI camera shot (§1.6).
**Where:** a new `kit/productTemplates.ts` registered in `kit/index.ts:48`:

| Template | What it does |
|---|---|
| `product-demo` | UI spec + camera path close → pull-back + cursor + type synced to words + finish |
| `headline-typeon` | a VO-synced block-caret headline with edge/front colour |
| `fly-through-letter` | a giant word as a track matte, the camera pushes through the counter of a letter into the app |
| `window-explode` | depends on G1: panels separate in z with stagger and DOF |
| `logo-lockup` | mark draws on, wordmark slides from behind the mark; extends `brand-logo-sting` |
| `end-card` | already `brand-end-card` |

Each should accept `{word:…}` times.

### G9. A cinematic finish preset
**Why:** the 80/100 film applied the same finish to every scene: motion blur, soft bloom, grain, vignette and a warm backdrop. Hand-built finishes go wrong (the glow blowout above).
**Where:** a scene-level `finish?: {preset:'cinematic-light'|'cinematic-dark', bloom, grain, vignette, halation, warmth}` in `types.ts:427-450`. It expands to an adjustment layer (`gl/renderer.ts:460-473`) with thresholds tuned so white UI does not bloom, and turns on `motionBlur` for moving layers. Expose it as a `create_motion_scene` / `create_motion_sequence` arg.

### G10. Grounding for 3D layers: contact shadow, reflection, light sweep
**Why:** a tilted window floating over a backdrop reads as "3D" only with a soft shadow on the floor and a moving specular sheen. Drop shadow is in layer space (`ui/compile.ts:478`), and there are no lights.
**Where:**
- A `contact-shadow` effect computed in comp space from the projected quad (`gl/renderer.ts`, after `place`).
- A `sheen` / `specular-sweep` effect keyed to the layer's rotation (a `gradient-overlay` variant in `gl/effects.ts:251-260`).
- Real lights stay out of scope; `render_3d_scene` covers hero objects.

### G11. Motion blur completeness
**Why:** whip pans and fast pulls stutter at 8 samples. Blur of content that changes inside a precomp (the UI scrolling or zooming inside its own precomp) is missing.
**Where:**
- Samples adaptive to screen-space velocity in `evaluateScene` (`evaluate.ts:334-340`).
- An opt-in "temporal" precomp blur: render precomp content at N sub-times and average (`gl/renderer.ts:290-293`, cost N×).
- Easier: G1 removes most of the need, because parts become top-level layers.

### G12. A 3D camera path for sequences
**Why:** "the background never cuts; the camera travels" is implemented as a 2D null truck (`sequence.ts:375`). A premium film flies in z between beats laid out in depth.
**Where:** `sequence.ts` gets a `layout:"space"` that places beats as `threeD` precomps at z positions and keys a real camera + POI with `push` / `creep→snap-settle` eases.

### G13. Raw-scene ergonomics for UI and targets
**Why:** the model must hand-compute part coordinates and cannot declare a UI inside a raw scene (§2.2).
**Where:**
- In `create_motion_scene` (`motionTools.ts:866-896`), expand `{type:'ui-screen', ui:{…create_ui_screen args}}` pseudo-layers at build time, the way icons are expanded (`expandIcons`).
- Accept `pointOfInterest: {layer:'ui', part:'send'}` and `position: {near:{layer, part}, distance}` references, resolved to numbers before validation.

### G14. Render precision
**Why:** dark launch backdrops, bloom and heavy DOF band in 8-bit (`gl/core.ts:117`).
**Where:**
- In `gl/core.ts:acquire`, use RGBA16F targets when `EXT_color_buffer_float` is present.
- Dither when presenting or reading back (`gl/renderer.ts:486, 498-500`).
- Export stays 8-bit PNG, which is fine once dithered.

### G15. Guidance drift (cheap fixes)
- `motionDirection.ts:72` still says "capture_product_ui … is coming", although it is implemented (`uiScreenTools.ts:125`).
- The `product-launch` and `ui-walkthrough` playbooks (`motionDirection.ts:280-317`) list features `text.type` / `text.counter` only. They should name `camera`, `aperture` + autofocus, `motionBlur`, and the new templates.
- `copilot.md:137, 150` gives the raw vocabulary but no worked camera example for a UI pull-back.

---

## 4. Risks

### Performance
- The GPU cost is low on this machine (§1.7). On integrated GPUs the watch points are these:
  - `MAX_TEXTURE_SIZE` 8192 caps precomp density: a 2880 px UI canvas can reach only 2.8× (`gl/renderer.ts:57`), which softens close-ups.
  - Per-pixel DOF (G3) and temporal precomp blur (G11) multiply fill cost.
  - Motion blur re-evaluates the whole scene per sample (`evaluate.ts:338-340`), which matters for 100-150-layer templates such as `zoom-tunnel`.
- Exploding UI parts into top-level layers (G1) raises layer counts (the demo has 23 layers inside its precomp). It removes one full-screen precomp pass per frame, though.
- Export is bound by PNG encoding (about 60-70 ms/frame at 1080p), not by the GPU. 4K doubles or triples it.
- The UI raster runs once per spec change (~0.3 s). The per-part-state rasterising in G6 multiplies part PNGs, so it needs a cap.

### Editability
- Everything proposed stays inside `MotionScene`, so it remains keyframes the user can open, move and restyle in the layered "[Motion]" comp. That is the reason to prefer it over the custom Python `render` source, which the 80/100 film used and which yields unrecoverable flat frames.
- `update_ui_screen` rebuilds the whole scene from the spec (`uiScreenTools.ts:141-160`). Layer patches the AI or user made inside the UI comp (an added camera, a keyed tilt) are **likely lost** on the next UI update. The camera and finish must therefore be spec fields (G2, G9), not after-the-fact patches.
- Collapse transformations (G1b) would complicate `lib/motionStack.ts` (per-layer clips, `ref` copies of cameras and parents, `motionStack.ts:57`). The compiler-level explode (G1a) avoids that.
- `fitToSafeArea` ignores 3D layers (`safeArea.ts:71`), which is correct for flythroughs. Nothing, though, checks that the camera frames the UI or that a close-up is legible. Frame QA (`run_frame_qa`) must render these shots and read them.

### Export parity
- It is structurally guaranteed: the same `MotionRenderer` and `prepareExact` path (`exportFrames.ts:67-69`). Two caveats:
  - Playback preview drops motion blur below quality 0.75 (`MotionLayer.tsx:143`) and renders at reduced scale, so a user judging the blur look during playback sees less than the export.
  - Straight-alpha 8-bit PNGs overlaid by FFmpeg can fringe on soft DOF edges over bright footage. A full-frame opaque stage avoids this.
- The foreignObject UI raster depends on the webview's HTML renderer and bundled fonts (`raster.ts:46-66`). Captures depend on the installed Edge or Chrome. Both are fixed at build time (PNGs are saved), so preview and export agree, but rebuilds on another machine may differ.
- For the Blender route (`render_3d_scene`, Blender 5.2 is installed), the engine camera follows Blender's (`syncCamera`), but Cycles "final" renders are about 3 s a frame. They should be kept for hero objects, not the UI.

---

## 5. Suggested build order

1. **G2 + G4 + G9**: a UI camera action with autofocus and a finish preset. This gives the "close → pull back → tilted window" shot within weeks, with editable layers.
2. **G1a**: exploded UI parts in 3D. Window-apart, parallax and part lifts in depth.
3. **G5 + G6**: labelled cursor and per-part states. This is the Bhippi-demo storytelling.
4. **G7**: DOM-aware capture, including of Bhippi's own UI at `localhost:5199` and in the packaged app.
5. **G8**: the product template family, built on 1-4, then the playbook and prompt updates (G15).
6. **G3, G10, G11, G12, G14**: per-pixel DOF, grounding, blur completeness, a 3D sequence camera and 16F precision. This is the quality ceiling.

Validation: rebuild one scene from the 80/100 film with each step in the Motion Lab (`window.lab.put` / `lab.frame`), and compare contact sheets side by side at the same timestamps.
