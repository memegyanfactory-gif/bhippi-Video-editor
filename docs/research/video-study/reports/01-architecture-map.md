# 01 · Architecture map for the motion-graphics upgrade

Mapped on 2026-09-24 against the working tree of `feat/motion-engine`. Many of the files cited have uncommitted changes (see §I), so line numbers are for the tree as it stands today. It answers one question: **where exactly does each planned upgrade plug in, and what does it have to respect?** Read `00-bhippi-brief.md` first; it covers what the engine can do.

Each section gives file:line references, followed by the constraints that matter. The step lists are at the end, in **Integration recipes**.

---

## 0. Ten facts that shape the plan

1. **A motion scene is opaque JSON to Rust.**
   - `ClipSource::Motion { scene: serde_json::Value, title, frames }` is at `src-tauri/src/project.rs:467-473`.
   - New *motion layer types* (shape groups, character, lottie, svg, image sequence) therefore need **no Rust and no project-format change**.
   - A new *ClipSource variant* does need one (`scene3d`, a frame-sequence clip). `project_save` deserialises a typed `Project` (`src-tauri/src/lib.rs:1990`), so an unknown `type` makes every autosave fail.
2. **Every vector is Canvas2D.**
   - Shapes, text and masks are rasterised on a canvas (`src/motion/gl/raster.ts`) and uploaded as textures.
   - Shapes are re-rasterised and re-uploaded **every frame** with no cache (`renderer.ts:193-197`). Text has a glyph-signature cache (`renderer.ts:173-188`).
3. **The GL layer can only draw full-screen passes and one textured quad** (`gl/core.ts:233` `pass`, `:248` `place`). It has no mesh, vertex-buffer or instancing path. Extrusion, particles and meshes need a new draw path or must be pre-rendered.
4. **Expressions cannot see other layers.** The globals are `time`, `value`, `thisComp{width,height,duration}`, `wiggle`, `loopOut` and so on (`src/motion/expr.ts:273-369`). There is no `thisComp.layer()`. Rigs, IK, follow-path and particles need native constructs.
5. **The only image-sequence path is the roto matte** (`MatteSequence`, `src/motion/sources.ts:14`; `src/motion/host.ts:12-31`). A footage layer plays one video or one still.
6. **The tool catalogue is one JSON file.**
   - `src/lib/ai-tools.json` holds 148 tools, about 163 KB serialised.
   - Rust compiles it in (`ai_tools.rs:19`) and sends it **in full on every native turn** (`chat.rs:392`). TS executes it (`aiTools.ts:580+`).
   - A tool that runs longer than 180 s must be added to the Rust timeout list (`ai_tools.rs:194-200`).
7. **The guards run outside the tool code.**
   - `allowTool` (`permissions.ts:61`) and `EditWorkflow.before` (`editWorkflow.ts:414`) run in `App.tsx:632-650`, before `runTool`.
   - Custom-tool steps pass the same checks through `host.guard` (`aiTools.ts:506`, wired at `App.tsx:668-672`).
8. **Python workers share one runner.**
   - `local_media::run` (`local_media.rs:28-78`) is hard-wired to `python <worker> <request.json>`.
   - Progress is JSON lines on stdout. Cancel kills the child.
   - It has **no timeout and no process-tree kill**.
   - `tools::find_tool` would **not** find Blender in `C:\Program Files\Blender Foundation\…` unless it is on PATH (`tools.rs:75-136`).
9. **Export writes a PNG sequence.**
   - Motion scenes are rendered to `work/mogrt/<clip>-<ulid>/%05d.png` (`src/motion/exportFrames.ts:41-72`).
   - FFmpeg overlays the sequence (`render/video.rs:352-363`, `html_frames`).
   - `paths.work` is **wiped at every startup** (`lib.rs:2895`), so it must never hold a Blender render you want to keep.
10. **A layered comp gives every layer its own clip and track.**
    - `explodeScene` (`src/lib/motionStack.ts:68`) runs on every `create_motion_scene` unless `nest:false` (`motionTools.ts:524-532`).
    - A character with 40 parts must **not** be 40 layers. Make it one layer, or one precomp, with an internal part tree.

---

## A. Shape rendering pipeline

### A1. Scene model (`src/motion/types.ts`)

| Thing | Lines | Notes |
|---|---|---|
| `EaseName` / `Ease` | 16-25 | Named eases, or a cubic-bezier `[x1,y1,x2,y2]` (temporal only) |
| `Key`, `Animated`, `Expression`, `Prop` | 28-33 | A key's `ease` shapes the segment that **starts** at it |
| `Transform` | 44-58 | anchor, position (2D/3D), scale, rotation, rotationX/Y, opacity, skew/skewAxis |
| `Mask` | 61-75 | rect / ellipse / path (straight-segment points), with mode, feather and expansion |
| `Effect`, `EffectType` | 78-87 | 34 types |
| `TextAnimator`, `TextCascade`, `TextSpan`, `TextLayerData` | 90-164 | |
| **`ShapeData`** | **166-188** | `shape: rect\|ellipse\|polygon\|star\|path\|line`, `points` as a flat `[x0,y0,…]` list, `curve` (midpoint quadratics), `gradient` (fill only), `stroke` (solid colour only), `dash`, `cap`, trim start/end/offset, `repeat` |
| `FootageSource` | 192-209 | `asset\|path`, `kind: video\|image`, in, speed, timeRemap, matte, cutout |
| `LayerCommon` | 211-253 | in/out, parent, threeD, transform, blend, matte, hidden, masks, effects, motionBlur, backdrop, adjustment, startTime/timeScale, `frame` (the layer clip's transform), `ref` |
| **`Layer` union** | **255-264** | footage, solid, procedural, shape, text, null, camera, precomp |
| `MotionScene` | 268-291 | `template {id, params}` (lets a scene be rebuilt), `brand`, `stack`, `cues` (whoosh/impact/chime/pop/riser/click) |

### A2. Evaluation (`src/motion/evaluate.ts`)

`evaluate.ts` is pure: it has no DOM and no GL.

- **`defaultSize(scene, layer, t)`** (80-108) gives each type its layer-space size.
  - A shape with `points` is sized by its **largest** x/y plus the stroke (93-99). Coordinates are assumed to be ≥ 0, so a negative point is drawn off the canvas and **clipped**.
  - SVG, Lottie and bezier imports must therefore translate the geometry to the origin, or `ShapeData` needs an explicit `bounds`.
  - `text` returns the canvas size here. The renderer and `measure.ts` supply the real text size through `sizeOf`.
- **`localTransform`** (112-133) uses AE order: T · Rz · (3D: Ry · Rx) · skew · S · T(−anchor). Parents chain in `worldMatrices` (136-159).
- **The camera** comes from `cameraAt` (162-198): the topmost active camera layer, or AE's default 50 mm.
- **`clipFrame`** (208-223) applies the transform of a layered comp's layer clip after everything else.
- **`evaluateScene`** (239-300) returns `ResolvedLayer[]` (type at 16-34).
  - `active` excludes camera and null layers (260).
  - The motion-blur sub-frames (252-254, 262-266) recompute **matrices only**. Shape points, morphs and text are sampled at the centre time, so a morphing path gets no intra-shape blur.
  - `time` for a precomp is `(lt − offset) × speed` (281). A new type with its own clock (an image sequence, Lottie) maps its time here or in the renderer.
  - Runs of 3D layers are depth-sorted (287-298).
- Hit-testing and QA use `projectPoint`, `layerBounds` and `entryBounds` (303-327).

**Where a new type's evaluation goes.**
- The type needs a `defaultSize` case: its true content box, which the safe-area and QA checks read.
- Per-type content (points, glyphs, frames) is resolved at `L.time` inside the renderer's `content()`, as `rasterShape` does today.
- A type with a solver (IK, particles, morph interpolation) should expose a **pure** resolve function beside `evaluate.ts`, so tests, QA and `measure.ts` can call it without GL. `text.ts` `layoutText` (`text.ts:178`) is the precedent.

### A3. Rasterisers (`src/motion/gl/raster.ts`)

| Function | Lines | What it does |
|---|---|---|
| `CanvasCache.get(key,w,h)` | 23-45 | Reuses one canvas per key and resets its state. OffscreenCanvas when available (12-20) |
| `canvasMeasure` | 50-60 | Caches text widths |
| `rasterText` | 67-113 | Per glyph: transform, blur filter, stroke, shadow, then strikes |
| `pathFromPoints` | 115-141 | Straight segments, or quadratics through midpoints when `curve`. **No cubic handles, no subpaths** |
| `polylineLength` | 143-149 | Length used for trim paths (straight-line approximation) |
| `shapePoints` | 151-164 | Polygon and star generation. **The star's inner radius is hard-coded to 0.45** (158) |
| **`rasterShape`** | **167-244** | Pad for the stroke and repeater (172-174); rect with `roundRect` (181-185); ellipse (186-189); path (190-194); gradient **fill** on closed paths only (195-211); **stroke is a solid colour** (216); trim paths use a `setLineDash` trick over the whole path (220-224); repeater copies (232-242) |
| `rasterMasks` | 247-290 | Path masks with straight segments only (271). Feather through `ctx.filter` blur |

**Density.** `densityOf` (`renderer.ts:33-49`) is the projected-area ratio × preview scale × 1.05, clamped to [0.08, 4] and capped at `maxTexture / max(w, h)`. Vectors stay sharp under a camera push, but a large shape at density 4 is a big canvas, re-drawn every frame.

**Where the vector upgrades land.**

- **Cubic beziers, compound paths and holes.** Replace `pathFromPoints` with a path builder over a new `ShapeData.path` format: a list of subpaths of `{v, in, out, closed}`, the Lottie/AE model, so Lottie import maps 1:1. Use `Path2D` and `fill(path, 'evenodd' | 'nonzero')`.
  - Keep `points` + `curve` as the legacy form. Validate the new form in `validate.ts`.
- **Gradient strokes.** Canvas2D can stroke with a `CanvasGradient` (`strokeStyle = grad`). Only linear and radial are possible. AE-style "along the path" gradients need per-segment drawing.
- **Round corners, offset path, merge path, twist, zig-zag.** These are geometry operators. Run them as a pure pre-pass on the bezier data (a new `src/motion/vector/*.ts`) before rasterising. Canvas2D has no boolean ops, so merge paths needs a polygon-clipping library (JS only; see §I on the CSP) or `globalCompositeOperation` tricks per group.
- **Path morphing between different shapes.** `keysAt` → `mix` (`anim.ts:115-123`) pads the shorter vector with its **last** value, which gives a crude morph. Real morphing needs pure resampling and correspondence code (equal point counts, rotation alignment) at evaluation time.
- **Text on a path.** Glyph positions come from `layoutText` (`text.ts:178-204`, `GlyphState` 16-37). Add a post-layout pass that maps each glyph's x along an arc-length-parameterised path to `(x, y, rotation)`. `rasterText` already honours per-glyph `rotation`, `dx` and `dy` (75-81).
- **Shape groups** (several paths and nested transforms in one layer). This needs `ShapeData` to become a tree: `{ groups: [{ transform, items: [path|rect|…], fill, stroke }] }`, drawn recursively with `ctx.save()`, `ctx.transform()`, `ctx.restore()`. It keeps a character or icon to **one layer** (see fact 10).
- **A cache.** Add a signature cache for shapes like the text one: key on the shape object's identity plus the resolved animated values plus density. Static icons and UI mock-ups then cost one upload.

### A4. GPU executor (`src/motion/gl/renderer.ts`)

- **`content()`** (115-237) is **the plug-in point for a new content kind**. Its `switch (layer.type)` (130-206) is followed by:
  - masks (209-216);
  - the effect stack with padding growth (218-233);
  - matte-FX inputs for footage (165-168, 225-228).

  It returns `{ target, pad, density, size }`.
- **The three ways to produce content today:**
  1. **A GL pass into a pooled target.** `solid` (131-135) and `procedural` (136-142, uniforms from `gl/procedural.ts:25-57`) work this way.
  2. **A MediaBank image.** `footage` (143-170) calls `this.bank.frame(source, time)`, uploads it and runs `FOOTAGE_FS` with `uFit`. When the frame is missing it does `incomplete++` and returns null.
  3. **Canvas2D, then `upload`, then `fromTexture`.** `text` (171-192) and `shape` (193-198) work this way.
  4. **Recursion.** `precomp` (199-203) calls `renderScene` (MAX_DEPTH 6, line 28).
- **`place()`** (240-256) draws the content quad through the layer matrix. It adds one quad per sub-frame for motion blur (249-253) and draws straight into the accumulator for plain normal-blend layers (244-246, 306-310).
- **`renderScene()`** (283-355) walks the evaluated draw order.
  - It skips hidden layers, `ref` layers and matte sources (299).
  - It handles adjustment layers (301-304, `adjust` 358-371), track mattes (314-327), the frosted backdrop (329-341) and blend modes (343-351).
- **Outputs:**
  - `draw()` (374-386) presents the frame to the preview canvas.
  - **`pixels()`** (389-403) returns straight-alpha RGBA for export and tests. It throws on a lost context.
- **Texture upload LRU:** 96 textures (68-79).

### A5. Validation of AI-written scenes (`src/motion/validate.ts`)

- These sets **must** grow with the engine:
  - `LAYER_TYPES` (7)
  - `EFFECT_TYPES` (8-13)
  - `PROCEDURALS` (15)
  - `BLENDS` (16)
- **`validateScene`** (26-68):
  - version, size and duration bounds (31-33);
  - unique ids (40-42);
  - known type (43), blend (44), in/out (45-46) and effects (47);
  - per-type checks (48-52): procedural kind, footage source, text content, shape kind, and recursion into precomps;
  - every expression parsed by `checkExpression` (53-61);
  - parent and matte references resolved (63-66).
- It does **not** check field shapes: points arrays, gradient stops and colours pass unchecked. New structured data (bezier paths, rigs, Lottie references) should get real checks here, because this is the error the AI reads back.
- **`sceneAssets`** (71-77) lists the asset ids a scene uses, for bin usage. A new type that references assets must be added here.
- **`overlayBox`** (84-105) is used by frame QA. It hard-codes which types count as "the picture" (85) and which are overlays (89).

### A6. Easing and expressions (`src/motion/anim.ts`, `src/motion/expr.ts`)

**anim.ts**
- `cubicBezier` (15-45) and `ease()` (69-106).
- `EASE_NAMES` (66) must stay in sync with `types.ts:16-24`.
- `keysAt` (136-152), `valueOf` (160-180), `num`/`vec` (182-192), `layerTime` (195-198), and the `keys()` builder (208-210).
- **Missing for AE parity:**
  - per-key in/out *influence and speed* (the graph editor);
  - spatial bezier tangents on position (motion paths);
  - roving keys;
  - separate dimensions (templates fake these with a null plus a child: `overlayTemplates.ts:1133-1163`).

  Any "easing extracted from a reference" (upgrade 6) should target the existing `[x1,y1,x2,y2]` form first. It already round-trips through validation and every tool.

**expr.ts**
- A safe interpreter: `tokenize` (37), `parse` (78), `run` (373-434), with results cached in the unbounded map at 371.
- Globals are built in `buildGlobals` (273-369).
- `ExprScope` (246-258) has no layer access. Cross-layer references would mean extending `ExprScope` and `anim.valueOf` (160-180) to carry a resolver, with evaluation ordered carefully (`worldMatrices` already resolves parents recursively, `evaluate.ts:140-157`).
- For rigs, a native `rig` evaluation step is simpler and faster than cross-layer expressions.
- WORLD-CLASS-PLAN Phase 3.6 "Signal expressions" (`docs/WORLD-CLASS-PLAN.md:599-604`) already plans `beat()`, `word.*` and `audio.rms` here. Lip-sync visemes should reuse that "baked signal" idea (`scene.signals`), so export stays deterministic.

### A7. `measure.ts` and `safeArea.ts` for new layer types

- **`evaluateMeasured`** (`measure.ts:24-36`) measures text only. Every other type goes through `defaultSize`, so a new type's `defaultSize` **is** its QA box.
- **The safe area only judges some layers.**
  - `candidates` (`safeArea.ts:68-76`) drops hidden, ref, adjustment, 3D and matte-source layers, plus `null`, `camera` and `procedural`, and full-frame `solid`/`footage`.
  - `informational` (78) is `text | footage | precomp`. **Only clusters containing one of these are moved** by `fitToSafeArea` (195-249, fixable at 163).
  - A `character`, `ui-mock` or `lottie` layer carrying information must be added to `informational`, or it is reported but never fixed.
- **The same kind of type list appears elsewhere and must be kept consistent:**
  - `polish.ts:71` (`restingLayerBoxes`, used by `run_frame_qa`);
  - `coverage.ts:35-38` (which layers paint an opaque rect, for black-edge detection);
  - `validate.ts:85, 89`.

### A8. Adding a new layer type end to end

Examples are `'character'`, `'lottie'`, `'svg'` and `'sequence'`. Every place that switches on `layer.type` (found with grep):

| # | File | Where | Why |
|---|---|---|---|
| 1 | `src/motion/types.ts` | `Layer` union 255-264 | The type |
| 2 | `src/motion/validate.ts` | `LAYER_TYPES` 7, per-type checks 48-52, `sceneAssets` 71-77, `overlayBox` 85/89 | The AI's error channel, bin usage and QA |
| 3 | `src/motion/evaluate.ts` | `defaultSize` 80-108; `time` 281 if it has its own clock | Box and clock |
| 4 | `src/motion/gl/renderer.ts` | `content()` switch 130-206 | Pixels |
| 5 | `src/motion/sources.ts` + every `MediaHost` | `footageAt` 40-53, `prepareExact` 178-198, `syncPreview` 143-170, `warm` 277-297; hosts at `host.ts:33-50`, `editor/MotionLayer.tsx:33-35`, `lib/previewCache.ts:366-368`, `motion/lab/lab.ts:12-24`, `editor/parity/parity.tsx` | Only if it loads files. Export must **wait** for its frames, or it renders holes silently (`incomplete`, renderer.ts:61) |
| 6 | `src/motion/safeArea.ts` | `candidates` 68-76, `informational` 78 | Fitting |
| 7 | `src/lib/polish.ts` | 55, 71, 77, 130, 191 | Frame QA boxes and `kind` text/graphic |
| 8 | `src/lib/coverage.ts` | 35-38 | Opaque-cover detection |
| 9 | `src/lib/motionStack.ts` | `layerTitle` 34-37, `LABEL` colours 40, `supportIds` 42-57 (if it references other layers), precomp recursion 90/158/217-222 (if it nests scenes) | Layered comps |
| 10 | `src/lib/motionTools.ts` | `summarizeScene` 124-148, `findLayer` 171-180 | What the AI reads back, and patch targets |
| 11 | `src/motion/kit/brandify.ts` | 146-157 | Brand recolouring |
| 12 | `src/panels/MotionInspector.tsx` | 78, 112-125, 231, 271 | The hand-editing UI |
| 13 | `src/lib/ai-tools.json`, `src-tauri/prompts/copilot.md:92`, `docs/MOTION-ENGINE.md` | The raw-scene vocabulary list | The AI must be told the type exists |
| 14 | Tests | `tests/motionEngine.test.ts`, `tests/motionTools.test.ts`, a Lab scene in `src/motion/lab/scenes*.ts` | |
| — | Rust | **Nothing** (the scene is a `serde_json::Value`) | Unless the type needs a native command (reading a Lottie file, rendering in Blender) |

### A9. Is there an image-sequence footage path today?

**Not for layers.** `FootageSource.kind` is `'video' | 'image'` (`types.ts:196`), and `editorMediaHost.resolve` (`host.ts:36-47`) returns one URL. Library assets are video, audio or image only (`src-tauri/src/library.rs:16-20`).

**Yes, inside the engine, for roto mattes.** It is the template to generalise:
- `MatteSequence = { fps, frames, first, frameUrl(i) }` (`sources.ts:14`).
- Loaded once per path by `host.matte` (`host.ts:12-31`). It reads `<run>/preview/%05d.png`, 1-based.
- `matteIndex` (135-137) maps time to a frame.
- Preview preloads the next 5 frames (163) and warms the next 8 (286). Export waits for the exact frame (184-195). `loadMattes` (211-230) is the bulk loader.
- The LRU keeps 128 frames (232-237). In preview, `matteFrame` falls back to the nearest loaded frame (258-270).

**At the timeline level,** `HtmlFrames { dir, fps, frames, width, height }` (`project.rs:488-498`) is overlaid by Rust `html_frames`. It is only set on the *export copy* of html and motion clips, never saved (`types.ts:83`).

**Proposal.** Add `FootageSource.sequence?: { dir, fps, frames, first?, digits? }` and resolve it through a generalised `sequenceFrame()` that shares the matte code. Blender renders, Lottie pre-renders and any PNG sequence become ordinary footage layers: 3D, mattes, effects and blend all work.

---

## B. Motion tools (`src/lib/motionTools.ts`)

### B1. Routing and context

| Item | Lines |
|---|---|
| `MOTION_TOOLS` (routing set) / `MOTION_READ_TOOLS` (declared, **used nowhere**) | 21 / 23 |
| `MotionToolContext` (`project`, `assets`, `commit`, `editComp`, `pickComp`, `current`, `setReference`, `brand`) | 25-35 |
| Dispatch from `runToolInner` (brand resolved by `activeBrandKit` → `motionBrandFromKit`) | `aiTools.ts:603-607` |
| `runMotionTool` switch | 453-730 |

### B2. `create_motion_scene` (465-553)

1. `pickComp` (466). `start` (468). Brand: `useBrand:false` turns it off (470-473). An optional `accent` override goes into `kit.palette` (472-473).
2. **Template branch** (477-509):
   - `findTemplate` (478).
   - `resolveParams` (95-109) turns every footage reference into a `FootageSource`. `footageFrom` (71-93) resolves `{clipId}` to `{asset, kind, in: sourceTimeAt, speed, matte, cutout}`.
   - A background plate is detected, and `background:"none"` is forced when the template has a `background` param (484-490).
   - `subject-reveal` and `big-number-behind` need a roto. The face comes from the roto subject box and the plate from the eraser clip (492-504).
   - `buildInBrand(spec, kit, params, brand)` (506).
3. **Raw-scene branch** (510-515): `{version:1, width, height, …rawScene}` → `brandifyScene`.
4. Duration clamp and extension (516-517) → `validateScene` (518-519) → `fitToSafeArea` unless `fit:false` (521-522).
5. **Placement:**
   - `trackAbove` (230-237) finds the first video track above every clip that has a picture in the span.
   - With `nest` (default), `explodeScene` makes a `[Motion] <title>` comp with one clip per layer, and the timeline gets one comp clip (529-532).
   - `placeClips(..., 'overwrite')` (533).
   - `placeCues` (185-201) lays SFX on audio tracks. `click` maps to `pop` (182), so the `SFX_MAP` must grow if new cue kinds are added.
   - The commit puts the new comps into the **AI Motion** bin folder (540-546).
6. The result carries `clipId`, `compId`, `sfxClipIds`, `layers[]` and `outline: summarizeScene(scene)` (548-552).

### B3. `get_motion_scene` / `update_motion_scene`

- **`resolveMotion`** (307-318) accepts a comp id, the holder clip, any layer clip, or a single-clip scene.
- **`editScene`** (372-431) applies, in order:
  1. `params` rebuild from the template (377-386);
  2. `scene` replace (387-388);
  3. `removeLayers` and `addLayers` (389-403);
  4. `patches` through `setPath` with dotted paths, where `null` deletes (151-169, 404-412);
  5. `retime`, which scales every `t`, `at`, `in`, `out`, `delay`, `stagger`, `duration` and `times` (413-425);
  6. `validateScene` (427-428) and the fit (429).

  A new structured layer type is editable by patches for free. `retime` only scales keys with those **names**, so new time-bearing fields (viseme timings, action clips) must be named accordingly or added to the list at 420.
- **Layered comps:** `updateStack` (434-449) runs `logicalScene` → edit → `restack` (a public signature that must not change; WORLD-CLASS-PLAN §9:832-839).

### B4. The other motion tools

| Tool | Lines | Notes |
|---|---|---|
| `list_motion_templates` | 456-463 | Returns **every** spec (id, label, technique, use, params, seconds, fullFrame) plus `EFFECT_TYPES`. This result grows linearly with templates, so push the AI toward `query` |
| `analyze_reference_video` | 601-619 | See §G |
| `save_style_profile` | 621-634 | `builtin:"motion-designer-explainer"` → `MOTION_DESIGNER_EXPLAINER_PROFILE` (241-264), stored by `api.refsSaveGuideline` as the active reference |
| `track_motion` | 636-708 | Polls a Rust job, then writes position/scale/rotation keys onto a scene layer (690-698) |
| `nest_motion_scenes`, `split_motion_layers` | 710-727 | |
| `TEMPLATE_FOOTAGE`, `placeTemplateByHand` | 734-766 | The Graphics tab takes the same path as the AI |

### B5. The template registry (`src/motion/kit/`)

- **`TemplateSpec`** (`kit/index.ts:12-26`) is `{ id, label, technique, use, params: Record<string,string>, seconds, fullFrame, build(ctx, params) }`.
  - **Params are free-text descriptions, not a JSON schema.** For example, `'number s (0.3) — when the shrink starts'` (`overlayTemplates.ts:1185`).
  - The AI reads them as prose, and nothing validates them. Builders must tolerate anything.
- **`MOTION_TEMPLATES`** (`index.ts:47`) = BRAND, SUBJECT_REVEAL, STAGE, OVERLAY, STORY, FUN.
  - The spec arrays are at `brandTemplates.ts:384`, `stageTemplates.ts:1087`, `overlayTemplates.ts:1176`, `storyTemplates.ts:962` and `funTemplates.ts:830`. `funTemplates.ts` is **untracked**, part of the in-flight @funny work.
- **The grammar helpers** are in `kit/common.ts`:
  - `KitContext` (19-27);
  - `unit()` (35), where 1 = 1 px at 1080p on the short side;
  - `enter` (38-42) and `inHoldOut` (45-49);
  - `glowFx`, `blurFx`, `shadowFx` (51-53) and `stage` (55-58);
  - `glassCard` (61-73), `footage` (75-77), `scene` (79-81, with an 8-sample, 180° motion-blur default) and `headline` (84-115).
- **UI mock-up precedent.** `dock-cursor` (`overlayTemplates.ts:~1040-1170`, spec 1268-1282) already builds app tiles, a tooltip pill and a cursor.
  - The cursor is a `path` shape (`ARROW` points) on a null for x, with the shape's own position for y. That is the "separate dimensions" trick (1133-1165).
  - Icons are letters or emoji (`glyph`), because there is no icon geometry.
- **Rebuild.** Scenes store `template {id, params}`, which `update_motion_scene {params}` needs (`motionTools.ts:377-386`).
- **Tests.** `motionSafeArea.test.ts:68-80` builds **every** template with generic params and **silently skips builders that throw** (74). Stage, overlay and story templates also have explicit sample params per template in `motionKit*.test.ts`.

### B6. How tool schemas are declared and dispatched

**The catalogue.**
- `src/lib/ai-tools.json` is `{version:2, tools:[{name, description, input_schema}]}`: 148 tools, about 163 KB.
- `create_motion_scene` alone is about 3.4 KB and `create_motion_graphic` about 6.5 KB.
- The file is shared by both sides.

**The Rust side (`src-tauri/src/ai_tools.rs`).**
- `CATALOGUE = include_str!("../../src/lib/ai-tools.json")` (19). A change to the file needs a Rust rebuild.
- `specs()` (35-43) and `is_known()` (45-47). `run_call` refuses names that are not in the catalogue (84-92).
- **Per-tool wait** (191-201): 1800 s for the listed long tools, 180 s by default, 24 h for `ask_user`. **Any worker-backed tool (Blender, Lottie render, reference analysis) must be listed here.**
- Every call in a turn is serialised by `gate` (161-163, 204).
- The catalogue test is at 520-521.

**How the catalogue reaches the model.**
- Native providers get the full list every round (`chat.rs:392`).
- Text-mode CLIs get `compact_catalogue()` (`ai_tools.rs:430-436`) pasted into `tools-fallback.md` (`chat.rs:332-335`).
- MCP (`mcp.rs`) serves the static catalogue. Custom tools are **not** in MCP `tools/list`; they reach the model only through context (memory note, `customToolsBrief`).

**The TS side.**
- `TOOL_SPECS` (`aiTools.ts:65-66`) and `KNOWN_TOOLS` (464), which are what a steps tool may call.
- `runTool` (562-578) adds bin filing, the coverage note and plan attachment for `MEDIA_TOOLS` (568).
- `runToolInner` (580+) routes, in order: `mcp__*` (594-601), then `MOTION_TOOLS` (604-607), `ROAST_TOOLS` (610-615), `BRAND_KIT_TOOLS` (618+), then the big switch (for example `create_stick_figure` at 2023 and `create_custom_tool` at 2089).

**The call site in `App.tsx`** (`events.toolCall` handler, about 600-717):
- `allowTool` (632), `new EditWorkflow` per turn (633-637), `workflow.before` (644), which marks a refusal as `guardBlocked`.
- `runTool` with a `synchronousHost` whose `guard`/`record` re-run the checks for custom-tool steps (660-675).
- `workflow.record` (676), then `api.chatToolResult` (716).

### B7. Permissions and the workflow guard

**`src/lib/permissions.ts`**
- `READS` (18-50) is always allowed.
- `DESTRUCTIVE` (53-59) needs Full access.
- Everything else needs Auto-edit or above (`allowTool` 61-70).
- A new read-only tool (`list_icons`, `describe_character`, `motion_guide`) belongs in `READS`.

**`src/lib/editWorkflow.ts`**
- `preparation` (98-…) holds tools allowed while planning (research, files, downloads, imports, council).
- `GATHER_TOOLS` (200-213) are refused until the user presses *Start generating*.
- `ALWAYS_TOOLS` (228-270) are reads and bookkeeping allowed in any phase. This is where `list_motion_templates`, `get_motion_scene`, `react_bits` and `remotion_kit` live.
- `before()` (414-458) checks, in order: the local-generation switch → quick mode bypass → comp binding → `phaseGate` (464-506) → timeline read → transcripts → frame scans → capabilities → storyboard.
- **Classifying a new tool:**
  - Catalogue and guide reads go in `ALWAYS_TOOLS` (and `READS`).
  - Producing a 3D render or asset before the edit is "gathering": `GATHER_TOOLS`, plus `MEDIA_TOOLS` in `aiTools.ts` so it attaches to the plan's shot.
  - Building timeline graphics is an edit tool: the default, no list needed.
- WORLD-CLASS-PLAN §6 (724) lists an open bug: **"Guard refuses motion-comp forms (P4)"**. Package P4 owns this file and has not landed.

### B8. Custom tools

- The AI can already build tools. `src/lib/customTools.ts` has:
  - two kinds, `ops` or `steps` (238);
  - `validateSteps` (216), `STEP_FORBIDDEN` (212) and `MAX_STEPS` = 40 (213);
  - `customToolsBrief` (241), which goes into the context every turn (`App.tsx:2559`);
  - `createCustomTool` / `updateCustomTool` (286 / 339);
  - persistence through `custom_tools_load`/`custom_tools_save` (`lib.rs:2182-2188`).
- Steps run through `runStepsTool` (`aiTools.ts:495-525`), with the guard at 506 and nesting capped at 4 (483).
- A `steps` tool that calls `run_command` could already drive `blender -b -P script.py -- req.json` and then `import_media`. That is a legitimate **stop-gap** for Blender, but:
  - `run_command` has a timeout and no job or progress (`system_tools.rs:544-590`, no `kill_on_drop`);
  - its output cannot be cancelled from the UI.

---

## C. AI knowledge: how the model is taught today

### C1. System-prompt assembly (`src-tauri/src/chat.rs`)

- **Sources:**
  - `PROMPT = include_str!("../prompts/copilot.md")` (40);
  - `FALLBACK_PROMPT` = tools-fallback.md (41);
  - `FUNNY_BRIEF` = prompts/styles/funny.md (43), which is untracked and in flight.
- **`build_request`** (296-335), in order:
  1. caption-style list → `{{STYLES}}` (298-302);
  2. the active edit style's brief, fenced before the "Project summary" heading (305-320);
  3. `{{CONTEXT}}` = the pretty-printed JSON context (297, 321);
  4. a council persona or style persona prefix (324-331);
  5. in text mode, the compact catalogue (332-335);
  6. history trimmed to `HISTORY_TURNS` (341).
- `build.rs` has `rerun-if-changed=prompts`. **A prompt edit is a Rust rebuild.**

### C2. `copilot.md` (144 lines, 34.6 KB, roughly 9k tokens)

| Section | Lines |
|---|---|
| Todo list first | 3-4 |
| Pipeline and phases (PLAN / GATHER / EDIT / POLISH) | 6-53 (graphics per beat: 44) |
| Council | 55-61 |
| @funny | 63-66 |
| Quick edit | 68-69 |
| **Product / SaaS video from a link** | **71-72** |
| **Crimson house direction** | **74-85** |
| **Motion engine** | **87-93**; the raw-scene layer vocabulary is at **92** |
| React Bits | 95-101 |
| Remotion Kit | 103-107 |
| Brand kit | 109-117 |
| Generation prompts | 119-120 |
| Bhippi basics, and "a job no tool does" → custom tools | 129-136 |
| `{{CONTEXT}}` | 141-144 |

### C3. The per-turn context JSON

Built in `App.tsx:2559` (`getContext`), plus the ChatPanel additions at `ChatPanel.tsx:652`:

- **`aiContext()`** (`aiTools.ts:211-250`): the project, playhead, selection, comps, media, items, folders, `activeComp` detail, and **`LAYOUT_RULES`** (253-258: layered comps, safe area, no blank frames, the polish pass). These are motion-engine rules sent every turn.
- **`reference`**: the active style profile or guideline brief (`referenceBrief`, `App.tsx:215`). It is set by `save_style_profile` and `create_project_guideline`.
- **`brandKit`** (`brandKitContext(kit)`, including the guideline: stage, type scale, timing, **moves**, recipes) and **`brandKits`**.
- **`customTools`**: `customToolsBrief()`.
- `projectFolder`, `editingWorkflow` and `workflowInstruction`.

### C4. Where motion grammar lives today

- **`copilot.md` MOTION ENGINE (87-93) and CRIMSON (74-85).** Crimson duplicates `motionGuide.ts` `CRIMSON_RULEBOOK` by hand.
- **Tool descriptions:** `create_motion_scene`, `update_motion_scene`, `create_motion_graphic` and `list_motion_templates`.
- **`list_motion_templates` results:** each spec's `use` and `params` (for example `stageTemplates.ts`, `overlayTemplates.ts:1176-1283`).
- **`MOTION_DESIGNER_EXPLAINER_PROFILE`** (`motionTools.ts:241-264`): cadence, look, type, motion grammar and the template map, activated by `save_style_profile {builtin}`.
- **`src/lib/motionGuide.ts`** holds the Crimson system for the **HTML MOGRT** path, not the GPU engine:
  - `CRIMSON` tokens (15-28), `CRIMSON_RULEBOOK` (30-44), `CRIMSON_BASE_CSS` (45);
  - `CRIMSON_TEMPLATES` (130), `buildCrimsonTemplate` (189), `CRIMSON_GUIDELINE_NOTES` (460).

  The rulebook is appended to a guideline only by `create_project_guideline` with the crimson pack (`aiTools.ts:1689-1700`).
- **Brand-kit guideline "moves":** frame-by-frame keys at 30 fps (described in copilot.md:111), rendered by the `brand-*` templates.
- **The council's Animator seat** (`src/lib/council.ts`, `consult_council`): a checklist persona.
- **The code:** `kit/common.ts` `enter`/`headline`, expo-out in, expo-in out, and blur.

### C5. Where to inject new guides and recipes, and what it costs

The always-on budget per round today is about 163 KB of tools, about 35 KB of prompt, plus the context JSON (`activeComp` detail grows with clip count). The WORLD-CLASS-PLAN Phase 2.2 (`:515-526`) plans phase-scoped tools, prompt caching (tools → system → messages) and `craftRules.ts` as the single source of truth, with a target of **−60% tokens**.

**So new knowledge should be pulled, not pushed.**

| Channel | Cost | Use it for |
|---|---|---|
| A read tool that returns a guide or recipe on demand (the pattern: `react_bits {action:"describe"}`, `remotion_kit`, `get_brand_guideline {part}`) | Only when called | The motion-direction guide, per-genre recipes (SaaS explainer, launch, brand film, character), icon and UI-kit catalogues, character action lists |
| A description in `ai-tools.json` | Every round, every provider | One-line pointers ("call `motion_guide {topic}` before …") |
| `copilot.md` | Every round. **Needs a Rust rebuild** | One short paragraph per new system, pointing at the read tool |
| Context JSON | Every round | Only state (the active style profile or brand guideline) |
| A style profile (`save_style_profile`) | Every round while active | Measured reference profiles (upgrade 6's output) |
| Template `use`/`params` text | Only in `list_motion_templates` | Per-template "when to use" |

---

## D. The Python and external-process worker pattern (the template for a Blender worker)

### D1. The canonical example: `point_track_start` (`src-tauri/src/lib.rs:1399-1440`, registered at about 3079)

- It is an **`async fn`**, so it stays off the UI thread. `watched()` (`lib.rs:2971-2983`) plus the hang watchdog (`watchdog.rs`) log any command that blocks the UI for more than 4 s.
- It validates the arguments, then reads the Python path from `Settings.local_media_python` (`settings.rs:52`) and fails clearly when it is missing (1410-1412).
- It picks the output folder: `point_track::dir(&state.tracking_root(&id), &id)` gives `<project>/Tracking/<asset>/points` (`point_track.rs:39-42`).
- **The job:** `state.jobs.start("model", label, cancellable=true)` (1416) returns its id at once (1439).
- **Inside `tauri::async_runtime::spawn`** (1420-1438):
  1. FFmpeg extracts the frames (`point_track::extract_frames`, `point_track.rs:45-66`).
  2. The worker source is **embedded** with `include_str!("../workers/point_track.py")` and written into the job folder (1425-1426), so it ships inside the exe.
  3. The request is a JSON file (1427-1428).
  4. `local_media::run(&python, &worker, &input, &job)` (1429).
  5. The result is read back from a JSON **file** (`point-tracks.json`) and validated (1431-1432).
  6. `job.done(msg, Some(json!({"tracks": …})))` or `job.fail(e)` (1434-1437).

### D2. The shared runner: `local_media::run` (`src-tauri/src/local_media.rs:28-78`)

- It spawns `tokio::process::Command::new(python)` with `[worker, request]`: stdin null, stdout and stderr piped, `kill_on_drop(true)`, and `CREATE_NO_WINDOW` (0x08000000) on Windows (30-32).
- **stderr:** the last 40 lines, with tqdm noise filtered out (36-49), become the error text (77).
- **stdout:** every line that parses as JSON calls `job.progress(value.progress.clamp(0, 0.99), value.message)`. Other lines are ignored (59-63), which is fine for Blender's chatty log.
- **Cancel:** `tokio::select!` on `job.cancel.changed()` → `child.kill()` (52-58, 68-75).
- **What it lacks:**
  - **no timeout**;
  - **no Job Object or process-tree kill** (children of python are orphaned);
  - the interpreter and argv shape are fixed.
- **GPU lease:** `local_media::acquire()` (10-15) allows one GPU job at a time. Blender with Cycles or EEVEE on the GPU **should take the lease**, or it will fight SDXL, LTX and roto for VRAM.

### D3. The job registry (`src-tauri/src/jobs.rs`)

- Event `bhippi://job` (9). The payload is `Job {id, kind, label, status: running|done|error|cancelled, progress, message, result, cancellable}` (20-33).
- About 50 finished jobs are kept (76-95).
- `start` (63), `progress` (143, which only moves forward), `done` (151), `fail` (162). Drop marks an unfinished job "Stopped unexpectedly" (185-194).
- IPC: `jobs_list`, `job_cancel`, `job_delete` (`lib.rs:2486-2496`). `job_delete` also removes outputs (`storage::remove_job_output`, storage.rs:293).
- **TS:**
  - `api.jobsList`, `api.jobCancel`, `api.jobDelete` (`src/lib/ipc.ts:521-532`) and `events.job` (`ipc.ts:586`).
  - The store is `src/lib/jobsStore.ts`.
  - The `Job.kind` union is at `src/lib/types.ts:447`.
- **UI:** the status bar shows kinds `media`, `collect`, `install`, `export` and `generation` (`App.tsx:2804-2831`, `GenerationJobsMenu.tsx`).
  - **`model` jobs, point tracking included, appear only in the ResourceMonitor** (`components/ResourceMonitor.tsx:100`).
  - A Blender job should use `generation`, or a new kind added to the status bar.

### D4. How an AI tool waits for a worker

- **Polling is the norm.**
  - `track_motion` polls `api.jobsList()` every 500 ms with a 10-minute deadline (`motionTools.ts:655-667`), and **does not cancel on abort**.
  - Generation uses 800 ms and 5 or 30 minutes (`aiTools.ts:1791-1823`).
- **The better pattern** is `roast/receipts.ts:181-197` `waitForJob`: it polls and calls `api.jobCancel` on abort. `personTracks.ts:55-67`, `roto.ts:123-135` and `depth.ts:12-22` also cancel.
- **Event-driven waits:** `storyboardFrames.ts:145-166` (`awaitJob` via `jobsStore.subscribe`).
- A Blender tool should wait through `jobsStore` or `events.job`, cancel the job on the turn's `AbortSignal`, and be in the Rust long-tool list (`ai_tools.rs:194-200`).

### D5. The other workers

All of these use `local_media::run`. The scripts are embedded with `include_str!`. `local_media.py` `execute()` (235-305) dispatches `action` to its sibling modules.

| Worker | Command | Notes |
|---|---|---|
| `local_media.py` (image, video and audio generation) | `local_media_generate` `lib.rs:1149-1219` | **sync fn** (UI-thread risk); lease; outputs to `<project>/Generated/{Images,Video,Audio}/<jobId>/` |
| `local_media.py` install | `local_media_install` 1221-1264 | Download lease; models go to `app_data/models/generation/<task>`; pip inside the worker (`_pip_install`, local_media.py:84-104) |
| `depth_media.py`, `tracked_roto.py` | `depth_start` 1266, `roto_track_start` 1311 | **sync fn** |
| `person_track.py` | `person_track_start` 1355-1396 | async |
| `magic_erase.py` | `erase_start` 1557-1645 | **sync fn**; `<project>/Clean plates/…` |
| `cutout.py`, `face_track.py` | `cutout.rs:180-260`, `327-374` | async; the result is awaited inline in the invoke |
| `edit_dna.py` | `receipts.rs:942-1013` | untracked, in flight |
| `ltx23_worker.py` | chosen in `local_media_generate` 1194-1198 | Prints plain text, so it reports no progress. The ComfyUI Python and checkpoint paths are hard-coded for this machine (`lib.rs:1160-1163`, `1012`) |

- **Worker conventions:**
  - read `sys.argv[1]` as the request;
  - print `{"progress","message"}` JSON lines with `flush=True` (`point_track.py:24-25`);
  - write the result to a file named in the request;
  - on failure, `traceback.print_exc(); sys.exit(1)`.

### D6. Finding Python and external executables

- **Python:**
  - The user picks `python.exe` in `src/settings/LocalMediaSettings.tsx:45-52, 86-99`.
  - The debug-only default is `<repo>/.media-venv/Scripts/python.exe` (`lib.rs:2862-2867`).
  - **No venv is created and no Python is bundled.** Per-feature pip installs happen inside the workers.
- **FFmpeg:** `tools::resolve` (`tools.rs:154-190`) searches `candidate_dirs` (75-136): the setting, `BHIPPI_FFMPEG`, PATH, WinGet, `C:\ffmpeg`, Program Files\ffmpeg, Scoop and Chocolatey. The Settings UI is `SettingsModal.tsx:179-220` (path field plus Detect).
- **Generic lookup:** `tools::find_tool(name, explicit)` (139-151) is used for yt-dlp and curl. **It does not scan `Program Files\Blender Foundation\Blender *`.**
  - A Blender locator needs that scan (newest version wins), a `blenderPath` setting, and a Detect button like FFmpeg's.
- **whisper.cpp and Piper:** `models::locate` (`models.rs:411-434`).
- `tauri.conf.json` has **no `externalBin`** and no bundled resources.
- **Settings are strictly typed in Rust with no `flatten`** (`settings.rs:48-50`). A new `blenderPath` must be added to Rust `Settings` **and** TS `Settings` (`src/lib/types.ts:530`), or it is dropped on the next save.

### D7. Where outputs go

- **Project storage** is `src-tauri/src/storage.rs`:
  - the layout doc is at 1-22;
  - the `Category` enum (33-49) and `relative()` (92-110) map categories to folders: Generated, Roto, Tracking, Clean plates, Renders, Exports and others;
  - the root comes from `default_root` = `Documents/Bhippi` (132) or `root()` (185), then `project_dir` (199);
  - `dir(state, Category)` (205) creates the folder; `locate` (226) finds existing output; `unique_path` (246) avoids collisions.
- **Blender output should get a Category, for example `3D`.** Keeping it under the storage root also keeps it inside the asset-protocol allow-list planned in §4B (`storage::allow_root`, `lib.rs:2890`).
- **App data** (`store.rs:8-45`): `work` (**wiped on every startup**, `lib.rs:2895`), `models`, `proxies`, `sfx` and `agent_workspace`.
- **Export frames:**
  - `mogrt_frames_begin` (`lib.rs:2094-2114`) makes `work/mogrt/<clipId>-<ulid>`;
  - `mogrt_frame_write` (2146-2156);
  - the loopback sink is `frame_sink.rs` (untracked, landed in the working tree).

---

## E. `scene3d`: what exists and what is missing

### E1. The file

- `src/lib/scene3d.ts` is 1175 lines, 64 KB.
- Commit `3a8e3f0` untracked it, and it is **excluded in `.git/info/exclude:8`**, so it does not even show as `??` in `git status`.
- The header (1-11) promises a three.js preview (`scene3dRuntime.ts`), an export (`scene3dFrames.ts`) and a Blender bridge (`workers/blender_bridge.py`). **None of the three exist.**

### E2. What the file contains (all pure TS, usable as-is)

- **Model:**
  - `Scene3dPrimitive` and `OBJECT_KINDS` (18-21): box, sphere, plane, cylinder, cone, torus, torusKnot, capsule, ring, icosahedron, text, label, model (.glb/.gltf), image, video, group, null.
  - `Scene3dMaterial` (24-50) is PBR: metalness, roughness, transmission, IOR, clearcoat, sheen, iridescence and a map. `MATERIAL_LIBRARY` is at 307.
  - `Scene3dObject` (52-75); its `params` are documented per kind at 67-72.
  - `Scene3dCamera` (78-102) is a physical camera: focal length in mm, sensor, f-stop, focus distance, blades, shutter angle, and a free or orbit mode.
  - `Scene3dLight` (105-126), `Scene3dEnvironment` (129-143) with HDRI and fog, and `Scene3dRender` (145-155) with `engine: eevee|cycles` and `samples`, which only Blender reads.
  - `Scene3d` (157-168). Units are metres, +Y is up and the camera looks down −Z (8).
- **Lens maths:** `verticalFov` 367, `focalLengthForFov` 373, `bokehParams` 383, `depthOfFieldRange` 391, `orbitPosition` 402.
- **Animation:**
  - Tracks are keyed by property path (`'position.x'`, `'orbit.azimuth'`).
  - Evaluation (`applyTracks` 432, `trackValue` 450, `evaluateScene` 466) uses the **clip** keyframe easings from `./keyframes`. That is the NLE `Easing` set, not the motion engine's `anim.ts` eases, which is a mismatch to fix.
  - Key editing is at 480-521.
- **Sanitising:** `heal*` (542-709) and `healScene` (689) make AI-written JSON safe.
- **The AI's op language:** `SceneOp` and `applySceneOps` (711-833), `describeScene` (849).
- **Presets** (876-1027): empty, product-turntable, floating-text, orbit-hero, exploded-grid, parallax-photo, neon-tunnel, glass-showcase, logo-reveal.
- **Packaging:** `createScene3dComp` (1074-1130) makes a `[3D] name` comp. Also `findSceneClip` (1132), `scene3dClipsForExport` (1148) and `replaceScene` (1167).

### E3. Wiring status

| Where | State |
|---|---|
| TS `ClipSource` | `{ type: 'scene3d'; scene: any; title? }` at `src/lib/types.ts:84` |
| `timeline.ts` `sourceInfo` | Handled at 379-380; the width and height are hard-coded to 1920×1080 |
| `council.ts:320`, `roast/dna.ts:225` | Treat it as an overlay |
| **Rust `ClipSource`** (`project.rs:397-474`) | **No `Scene3d` variant.** The enum is `#[serde(tag="type")]`, so `project_save(… project: Project)` (`lib.rs:1990`) **rejects** any project holding a scene3d clip, and every autosave fails. `project_load` returns raw JSON (`lib.rs:1982-1984`), so opening such a project works and only saving breaks |
| Rust exhaustive matches that would need arms | `project.rs:1177`, `1287`; `render/video.rs:111-112`, `258-259`; `render/audio.rs:166` |
| `package.json` | **No `three`.** The dependencies are gsap, lucide-react, marked, onnxruntime-web, dompurify, react and @tauri-apps |
| AI tools, UI and workspace | None |

WORLD-CLASS-PLAN Phase 1.10 (`:490`) already says: "*Resolve `scene3d` (add the variant or delete it)*", together with `#[serde(flatten)] extra` on Project, Comp, Clip and Track.

### E4. What a 3D path needs (two viable designs)

**1. Blender as a footage generator.** Recommended first: least new surface, and preview equals export.
- The AI writes a `Scene3d` JSON using the existing `scene3d.ts` model and ops.
- The worker renders a PNG sequence with alpha and exports the camera per frame.
- The frames come back as a **motion footage layer with `source.sequence`** (§A9).
- The camera is converted to a motion `camera` layer with position, point of interest and zoom keys, so 2D motion layers (`threeD:true`) sit in the same space.
  - Blender: Y-up in scene3d, but Blender itself is Z-up; units are metres.
  - Motion engine: pixels, +y down, +z away; `zoom` in px, the default zoom ratio is 2666.7/1920 (`evaluate.ts:48`, and `perspective` in `math.ts`).
  - The conversion must use the same sensor and focal-length maths (`scene3d.ts:367-373`).
- There is no Rust project-format change, and it works with layered comps, mattes and effects.
- The cost is render time. The preview shows the rendered frames, so the look is final.

**2. A `scene3d` clip with a three.js preview and a Blender final render.**
- It needs:
  - the Rust variant (Phase 1.10);
  - `three` in package.json;
  - a new WebGL context (browsers cap live contexts; see the comment at `exportFrames.ts:167-168`);
  - a Compositor branch;
  - an export branch (Blender frames into `HtmlFrames`);
  - a preview-cache branch;
  - a 3D workspace panel.
- It **breaks "preview = export"** unless the preview also shows Blender stills.

**The 3D workspace (design 2, or an inspector for design 1) needs:**
- a `PanelId` plus layout widths, `DEFAULT_LAYOUT`, `PANEL_MIN`, the Window menu and a shortcut. The panel recipe is in the memory note on frame coverage;
- a viewport (three.js, or Blender-rendered low-samples stills);
- an outliner and inspector driven by `applySceneOps`;
- a track editor.

---

## F. Export path for frame sequences

### F1. Motion scenes (`src/motion/exportFrames.ts`)

- **`renderMotionClipFrames`** (41-72):
  - `api.mogrtFramesBegin(clip.id)` (44) returns a dir under `work/mogrt`;
  - `openFrameWriter` (53, `lib/pngEncoder.ts`) encodes PNGs on workers and writes through the loopback sink or `mogrt_frame_write`;
  - per frame: `bank.prepareExact` (60), `renderer.pixels` (62), `writer.pixels` (64).
- **`motionClipsForExport`** (106-131) fuses layered stacks into one stand-in clip (`carrierClip` 84-95). **`withRendered`** (137-160) attaches `frames` to the export copy.
- **`renderMotionScenesForExport`** (163-191) uses **one renderer for the whole export** (167-169, because of the WebGL context cap). **`renderMotionStill`** (198-236) renders only the frames QA needs.
- These signatures must not change (WORLD-CLASS-PLAN §9:832-839): `renderMotionScenesForExport`, `renderMotionStill`, `renderHtmlStill`, `renderMotionGraphicsForExport`.

### F2. The Rust overlay

- **`HtmlFrames`** (`project.rs:488-498`).
- **`Role::Picture`** only when frames are present (`render/video.rs:111-112`). **`html_frames`** (352-363) runs `-framerate fps -start_number first -i dir/%05d.png`, then `format=rgba,setpts,fps=…`, then conform. It handles `tau < 0` lead for transitions.
- The alpha pipeline runs in `gbrap`, and the ProRes 4444 alpha output is at `render.rs:290-305`.

### F3. How to bring a Blender PNG sequence in, from best to worst

1. **As a motion footage layer** (`source.sequence`).
   - It composites inside motion scenes: camera, 3D planes, mattes, glow and blend modes.
   - Export re-renders it through the GPU into new PNGs. That is a double encode, with the §4A cost of about 50 ms per 1080p frame.
   - It needs the `sources.ts` sequence loader and `prepareExact` waits.
2. **As a new timeline `ClipSource`** (`{ type:'sequence', dir, fps, frames, width, height }`).
   - Rust reuses `html_frames` directly, with zero re-render.
   - The preview needs an image-sequence player. `RotoPreview.tsx:37-113` (`maskUrl`, `prefetchRotoMatte`) is the precedent.
   - It needs the Rust variant, `validate_comp` (`project.rs:~1287`), the Compositor, `timeline.sourceInfo` and the preview cache.
   - It is the right choice for full-frame 3D shots.
3. **As an alpha video asset** (ProRes 4444 or VP9-alpha WebM) imported as media.
   - Export likely keeps the alpha (`gbrap` chain).
   - The preview decodes through `<video>` or a proxy, and alpha in proxies and in WebView2 for ProRes is **unverified**. Treat this option as the risky one.

### F4. Frame transport notes (WORLD-CLASS-PLAN §4A, `:637-644`)

- **Step 1**, the loopback sink, has landed in the working tree (`frame_sink.rs`, `pngEncoder.ts`, `:494`).
- **Step 2** replaces PNGs with an FFV1 `.mkv` via an ffmpeg pipe. `html_frames` would then read `-ss first/fps -i target.mkv`.
  - Any new sequence consumer should read through **one** helper, so the format can switch from `%05d.png` to `.mkv` in one place.
- **Step 3**, static-span dedup, would skip identical frames. That matters for held 3D renders.
- **Step 4** renders only what is shown, the bbox region with an x/y offset in `RenderedFrames`.
- Store Blender renders in the **project** folder, never in `work/`.

---

## G. Existing assets

### G1. The SFX library

- **The 11 built-in sounds are synthesised, not recorded.**
  - `src-tauri/src/sfx.rs` makes whoosh, impact, chime, pop and riser (62-104), plus boom, scratch, bleep, swish, ding and glitch as DSP voices (242-399).
  - They are written once at startup by `ensure_all` (`sfx.rs:430`, called at `lib.rs:2858`) into `<app_data>/sfx/<kind>-v2.wav`.
  - `SfxKind::ALL` is at `project.rs:52`, with the lengths at 85-99. The TS `SfxKind` is at `src/lib/types.ts:10`.
- **The sampled catalogue** (untracked, in flight) is `src-tauri/resources/sfx/seed.json`, compiled in with `include_str!` (`sfx_library.rs:30`). It holds **138 entries**:
  - 25 procedural variants and 113 samples;
  - freesound 68 (CC0), myinstants 45 (tagged `copyrighted-source`), and the built-ins.
  - Samples download on first use to `<storage>/SFX/cache/<id>.wav`, normalised to −16 LUFS (`sfx_library.rs:36, 521, 1040-1043`).
  - Search covers English, Hinglish and Devanagari (`sfx_library.rs:1-18, 106-128`). The commands are `sfx_library_search` (802) and `sfx_library_fetch` (1022).
  - Top tags: reaction, voice, meme, suspense, impact, indian, cartoon, fail, transition. The library is **meme-oriented. It has no UI clicks, keyboard typing, soft "SaaS" swooshes, glass pings, notification sounds or data-blips**, which the SaaS and brand-film references lean on.
- **Levels:** `src/lib/sfxLevels.ts` (dB per kind at :15; sampled sounds at −10/−14, :21-24; the SFX track helper at :42).
- **Two bugs were found (verified):**
  - `add_sound_effect` accepts only 5 of the 11 kinds its schema lists (`aiTools.ts:2513`). The other 6 fail with "unknown sound effect". `generate_selection_sound` has the same limit (`aiTools.ts:2033`). The @funny `place_sfx` (`roast/sfx.ts:256`) handles all 11.
  - Motion cues allow `sound:'click'` (`types.ts:280`), but `SFX_MAP` maps click to pop (`motionTools.ts:182`). There is no click sound. `placeCues` hard-codes a cue length of 1.2 s, or 2 s for a riser (185-201).

### G2. Fonts

- **Only system fonts are available, and nothing is bundled.**
  - There is no `@fontsource` in `package.json`.
  - `public/fonts/` holds only `helvetiker_{regular,bold}.typeface.json`, a three.js typeface format that nothing references. It is probably a scene3d leftover, useful for 3D text in three.js.
  - No command enumerates the installed fonts.
- **The motion engine** uses `DEFAULT_FONT` and `SCRIPT_FONT` (`src/motion/text.ts:11-12`). `familyStack()` (48-56) adds fallbacks.
- **"System fonts only" is enforced** by:
  - `SYSTEM_FONTS`, a 21-family list (`src/lib/brandKit/build.ts:54`), with `create_brand_kit` falling back to the archetype's font (155-156) and a validation error at 340;
  - the font picker (`BrandKitSettings.tsx:511`);
  - web fonts mapped to installed ones by `systemFontFor` (`fromWebsite.ts:83-91`).
- **Export:** libass reads `%WINDIR%\Fonts` and the user fonts folder through a fontconfig file (`render.rs:562-583`).
- **Implication.** The reference videos' brand typography (geometric grotesques, display serifs) is only available if the family is installed. Bundling fonts means shipping `.woff2` in `dist` (CSP `font-src 'self' data:`), registering them with `FontFace`, and making sure the FFmpeg/libass captions path gets them too.

### G3. Icons

- `lucide-react ^0.468.0` is in `package.json` but is used **only by the app UI**, in about 50 files. Nothing in `src/lib` or `src/motion` uses it.
- **There is no icon tool.** Motion templates draw "icons" as text glyphs or emoji:
  - stat badges `icon?` (`overlayTemplates.ts:857, 936, 1259`);
  - dock `glyph` (1007, 1079);
  - hex stages (`stageTemplates.ts:141-146, 308`).
- Lucide's icons are SVG path data (24×24, stroke-based). Converting them needs the **bezier + SVG path** support from §A3. Lucide is ISC-licensed, so it is safe to embed. After that, `lucide` → `ShapeData` subpaths can become an `icon` shape kind, or a `list_icons`/`icon` param on templates.
- **SVG is not importable today (verified):**
  - `IMAGE_EXTENSIONS` = png, jpg, jpeg, webp, bmp (`src-tauri/src/library.rs:61`), and `import()` rejects anything else (212-216);
  - the motion host's image regex omits svg (`src/motion/host.ts:45`);
  - `import_brand_logo` with an SVG writes the file (`brandKitTools.ts:294-299`), then fails on import.
  - `safe_asset.rs:112` already serves `image/svg+xml`, so a `data:image/svg+xml` or `fileSrc(.svg)` footage path with `kind:'image'` would rasterise through `<img>`, but only as a flat image.

### G4. The UI library and the Remotion Kit

- **`src/lib/rbx` holds 520 HTML pieces:**
  - React Bits 205: text 32, animations 38, components 45, micro 33, backgrounds 57 (`rbx/index.ts:3, 28`);
  - extensions (`index.ts:30`): Animate.css 97, Open Props 54, Magic UI 54, Aceternity 62, Uiverse 48.
  - Each piece is a deterministic `{html, css, js}` for the **HTML MOGRT** path. It is exported frame by frame by `htmlFrames.ts`, not by the GPU engine.
- **The `react_bits` tool:** schema at `ai-tools.json:4024`, handler at `aiTools.ts:3313-3331`. You place a piece with `create_motion_graphic {template:"react-bits", bit, props}`.
  - Several pieces are SaaS UI (dock, stepper, animated-list, magic-bento, prompt-bar, pill-nav, profile-card, counters). They are the fastest route to UI mock-ups today, but they live outside the motion engine: no 3D camera, no mattes, no shared scene with engine layers.
- **The `remotion_kit` tool:** schema at `ai-tools.json:4083`, handler at `aiTools.ts:3333-3354`.
  - The presets are in `src/lib/remotionKit/presets.json` (476 KB, loaded on demand), 290 in all: full 105, title 42, chart 31, intro 26, transition 20, map 20, cta 14, social 12, lower-third 12, outro 8.
  - The preset shape is at `remotionKit/index.ts:21-38`. `helioTemplateFor` (95) maps a preset to a Bhippi template or piece.

### G5. `create_stick_figure`

- TS only: `src/lib/stickFigure.ts` (a minified 4.6 KB file). The handler is at `aiTools.ts:2023-2028` and the schema at `ai-tools.json:3338`.
- **It is not a motion scene.** It makes a new comp with **11 video tracks of NLE `shape` clips**: rectangle bones plus an ellipse head (`stickFigure.ts:23-37`). They share a `groupId`, and x, y and rotation keys are sampled every frame with linear easing.
- **Reusable parts:**
  - `twoBone(root, target, upper, lower, bend)`, an analytic two-bone IK that clamps unreachable targets (`stickFigure.ts:7-12`, tested in `tests/stickFigure.test.ts`);
  - `figurePose(t, motion, duration)` (13-21) for idle, walk and wave, with a planted foot.
- **Limits:**
  - no persistent rig, face, props or custom poses;
  - `compId` is used only for size and fps;
  - the new comp becomes the active one and nothing is placed on the timeline.
- The character system (upgrade 2) should replace this with a motion-engine `character` layer, or a rig precomp, and keep `twoBone` as the solver.

### G6. The brand kit and its motion mapping

- **Files in `src/lib/brandKit/`:** activeStore, archetypes (.ts/.json; 33 archetypes: the house look, 16 styles, 16 references), build, daisyThemes, fromWebsite, guideline, index, logoData, motionBrand, types.
- **Tools:** `BRAND_KIT_TOOLS` (`src/lib/brandKitTools.ts:33-37`) has 16 names: the 13 listed in the brief plus `get_brand_guideline`, `extract_brand_from_url` and `check_brand_compliance`.
- **The model:** `BrandKit` (`brandKit/types.ts:313-338`) holds:
  - logos with roles (16-39);
  - colours: tokens, gradients and contrast pairs (41-57);
  - typography: display, heading, body, caption and mono faces, plus a scale (59-80);
  - `motionGuide`: easing, enter, exit, hold, stagger, intensity;
  - imagery, layout, audio and social;
  - `guideline` (280-311): type scale, **moves** (frame-by-frame element keys), layouts and recipes.

  The engine view is `motionBrand.ts` (display, heading, body and caption families at :65).
- **`src/motion/kit/brandify.ts`:**
  - Crimson house colours (warm, saturation ≥ 0.15) are remapped by lightness onto a ramp from the brand's primary, accent and background (30-80).
  - Procedural background defaults are seeded (83-94).
  - Out and in eases become the brand's (100).
  - Text gets the brand fonts (display at ≥ 5.5% of the short side), stagger and enter time (108-122).
  - `buildInBrand` is at 168-172.
- **Implication for the upgrades.** New primitives should use palette roles or Crimson ramp colours so brandify can remap them. A UI-mock kit needs brand **neutral and surface** roles (card background, border, text-muted), which the Crimson→brand ramp does not model today.
- **`brandTemplates.ts`** holds 7 guideline-driven templates (385-391): brand-title, brand-lower-third, brand-stat, brand-panel, brand-logo-sting, brand-end-card, brand-transition. The logo is a `footage` layer `{asset, kind:'image'}` (319, 354).

### G7. `analyze_reference_video` today (the baseline for upgrade 6)

- **TS** (`src/lib/motionTools.ts:601-619`) calls `api.refsIngest`, then:
  - `cadenceFromCuts` (266-278): shots, mean and median shot length, a histogram (<1.5, 1.5-4, 4-8, >8 s) and cuts in the first 15 s;
  - up to 3 sheets returned as JPEG data URLs (`imageDataUrl`, 281-294);
  - the palette and sheet paths.
- **Rust:** `refs_ingest` (`lib.rs:711-739`) is an inline-awaited, **non-cancellable** job (`jobs.start("reference", …, false)`). It calls `refs::ingest` (`src-tauri/src/refs.rs:134-213`), which is all ffmpeg:
  - the opening sheet: ≤ 8 s at `fps=4, scale=320, tile=6x6` (155-170);
  - the overview sheet: 72 frames, `tile=9x8` (172-185);
  - the cuts: `select='gt(scene,0.35)'` (119-131);
  - the palette: `library::palette` (`library.rs:404`), 6 frames at 4×4 px, bucketed.
  - The output goes to `<app_data>/refs/<id>/ref.json`, plus JPGs (`refs.rs:42, 70`). `brief()` (216) is the prompt summary.
- **What it does not measure:**
  - per-element motion;
  - easing curves;
  - camera moves;
  - stagger or hold timing;
  - audio onsets or sync;
  - type size.
- **Available building blocks:**
  - **`docs/research/video-study/analyze.py`** (387 lines, OpenCV + numpy + soundfile + PIL), the study kit behind these reports:
    - per-frame luma, saturation, diff and moving-area metrics (64-114);
    - global camera dx, dy, scale and rotation from LK plus RANSAC similarity (79-111);
    - cut detection (122-134);
    - per-shot k-means palette and camera totals (143-170);
    - **"moves" with an easing classification** (ease-out, ease-in, in-out, linear, settle bounce) from the shape of the energy curve (172-210);
    - audio onsets and tempo from spectral flux (212-250);
    - cut and move ↔ onset sync (257-264);
    - caption word timings from `.json3` (267-279);
    - frame-by-frame sheets.

    It already uses the same Python deps as `point_track.py`, so it can become `workers/reference_motion.py` with the D1 pattern almost unchanged.
  - **`src-tauri/workers/edit_dna.py`** (untracked, @funny): scene cuts at 480p, cuts per minute, longest static stretch, and optional Demucs stems with music coverage, onsets and on-beat share. The result shape is at 541-552. It is run by `receipts::edit_dna_file` (`receipts.rs:942-987`).
  - **`workers/point_track.py`:** LK point and planar tracking, which can give per-element trajectories to fit bezier eases to.
- **`save_style_profile`** (`motionTools.ts:621-634`) → `refs_save_guideline` (`lib.rs:~760`, `refs.rs:78-106`). It becomes the active reference, which rides in `context.reference` every turn.

### G8. How images reach the engine

- `editorMediaHost.resolve` (`src/motion/host.ts:33-50`) resolves assets to `fileSrc(path | proxy)`.
- A raw `path` passes through as an `http(s):`, `asset:`, `data:` or `blob:` URL, or is turned into a `fileSrc`. Its kind is guessed by `/\.(png|jpe?g|webp|gif|bmp)$/` (45).
- `MediaBank.image()` (`sources.ts:110-124`) loads through `<img crossOrigin>`.
- `fileSrc` is `convertFileSrc` (`ipc.ts:605`). The asset protocol is scoped to `**` (`tauri.conf.json:40-43`) and served by `safe_asset::handle_safe_asset_request` (`lib.rs:3011-3014`).

---

## H. Tests and verification

- **The runner:** vitest in node (`vite.config.ts:11`, `tests/**/*.test.ts`). **There is no WebGL in the tests.** The GPU renderer is mocked where the export is tested (`tests/renderParity.test.ts:4-12`), so **pixels are never checked in CI.**
- **Engine and tool tests:**
  - `motionEngine.test.ts` (182 lines): easing, keyframes, expressions, 3D, parenting, text.
  - `motionTools.test.ts` (215): mocks ipc (3-7) and runs `runMotionTool` on `newProject()`.
  - `motionStack.test.ts`: split, fuse, restack.
  - `motionSafeArea.test.ts`: every template, both orientations (68-80, 84-107).
  - `motionKitStage/Overlay/Story.test.ts`: explicit params per template, landscape and portrait.
  - Also: `funTemplates.test.ts` (untracked), `stickFigure.test.ts`, `renderParity.test.ts`, `pngEncoder.test.ts`, `frameSink.test.ts`, `polish.test.ts`, `coverage.test.ts`, `brandKit*.test.ts`, `remotionKit.test.ts`, `reactBitsLibrary.test.ts`, `motionGuide.test.ts`, `motionGraphics.test.ts`, `customToolSteps.test.ts`.
- **Rust:**
  - `render::tests::motion_scenes_export_their_rendered_frames_and_nothing_without_them` (`render/tests.rs:347`);
  - the catalogue test (`ai_tools.rs:520-521`);
  - `render::e2e::parity_frames` (`e2e.rs:648-654`, `#[ignore]`, driven by `BHIPPI_PARITY`).
  - Use a scratch `CARGO_TARGET_DIR`, and **never `cargo fmt`**.
- **Motion Lab** (`motion-lab.html` → `src/motion/lab/lab.ts`):
  - The host (12-24) takes media from `?media=` (a CORS file server). Mattes are written as `"<folder>@<fps>@<frames>"`.
  - `window.lab` (98) = `{ loadUser(url), exportTest(name, fps, seconds), frame(name, t, scale), sheet(name, times, scale, cols), timing(name, t, scale, n), scenes }`.
  - **`sheet` and `frame` take a `LAB_SCENES` name** (`scenes.ts:14`), not a raw scene as MOTION-ENGINE.md says. Load raw scenes with `loadUser(url)`, which registers `user-N`.
  - Run `npx vite --port 1437`, because 1420 is the user's dev server. Playwright MCP can drive it.
  - `exportTest` runs the real export path (`pixels()` → PNG) and PUTs the frames to `<media>/upload/<name>/`.
- **Pixel verification:**
  - `renderer.pixels()` (`renderer.ts:389-403`) gives straight-alpha RGBA.
  - **The parity harness** is `export-parity.html` + `src/editor/parity/parity.tsx` (`window.parity.prepare/show`) against the Rust `parity_frames`. The bar in use is PSNR ≥ 29 dB synthetic (WORLD-CLASS-PLAN `:494`), with SSIM ≥ 0.98 planned for the Export Certificate.
  - **For the new primitives:** add Lab scenes, render golden PNGs with Playwright, and compare with a PSNR/SSIM threshold. Keep evaluation (IK, morph, text-on-path) pure so vitest can assert the geometry without a GPU.

---

## I. Risks and sequencing

### I1. Rules from WORLD-CLASS-PLAN §7 (`:761-800`) that apply

- **Never `cargo fmt`.** Never start or stop the app, or build into `src-tauri/target/release`. Use a scratch `CARGO_TARGET_DIR` (764).
- **Do not put Bhippi itself into a kill-on-close Job Object** (773). Put the tool children (Blender, Python) in a job and give the updater breakaway. Phase 1.9 (`:489`) plans the job supervisor in `tools.rs` and `local_media.rs`, and the Blender runner should be built on it.
- **Do not fall back to `logicalScene()`** in `compScene`. **Do not demote precomps** to plain comp clips (777).
- **Do not key MediaBank elements by layer id**; pool by distinct time (782). This is relevant to a sequence loader.
- **Do not big-bang the WebCodecs/GPU timeline migration** (792).
- **Two packages that need the same file must merge, not race** (797).
- **Phase 3 work depends on Phase 1 parity plus Phase 2 QA and eval** (800). The motion upgrades are Phase-3-class, so each needs Lab goldens and QA coverage from the start.
- **Public signatures that must not change** (832-839): `renderMotionScenesForExport`, `renderMotionGraphicsForExport`, `renderMotionStill`, `renderHtmlStill`, `restack` (new parameters optional only), `history.preview`, `EditWorkflow.verify(project, assets)`.

### I2. Work in flight (uncommitted on `feat/motion-engine`)

- **Landed but uncommitted:** P1, P2, P3, P6, P7 (WORLD-CLASS-PLAN `:494`) and the **@funny** mode (`docs/FUNNY-MODE-PLAN.md`, untracked).
- `git diff --stat` on the key files shows:
  - `ai-tools.json` +1117 lines, `lib.rs` +552, `motionStack.ts` +188, `aiTools.ts` +165, `project.rs` +98;
  - `sources.ts` +73, `exportFrames.ts` +66, `editWorkflow.ts` +39, `safeArea.ts` +23, `renderer.ts` +19, `types.ts` +17, `permissions.ts` +11.
- **Untracked new modules:** `frame_sink.rs`, `sfx_library.rs`, `memes.rs`, `receipts.rs`, `cutout.rs`, `free_media.rs`, `src/motion/kit/funTemplates.ts`, `src/lib/roast/`, `src/lib/council.ts`, `src/avatar/`, `prompts/styles/`, `src-tauri/resources/`, plus the workers `cutout.py`, `edit_dna.py` and `face_track.py`.
- **P4 (AI tools, workflow guard, prompts) and P5 (agent runtime, process hygiene) have not landed.** They own `ai-tools.json`, `aiTools.ts`, `editWorkflow.ts`, `copilot.md`, `chat.rs`, `ai_tools.rs` and `tools.rs`, which are exactly the files every new AI tool touches.
- **Sequencing:** commit or land the in-flight work first. Put the new tools behind P4's phase-scoped catalogue, and put the Blender runner on P5's `run_cancellable` / Job Object (WORLD-CLASS-PLAN §4E `:668-672`).

### I3. Technical constraints

- **Project and settings format.** `Settings` (`settings.rs:48-50`), `Project`, `Comp`, `Clip` and `ClipSource` have **no `flatten extra`**. Unknown fields are dropped, and unknown clip `type`s fail the save. Phase 1.10 fixes this. Until then, keep new data **inside the motion scene JSON**.
- **CSP** (`tauri.conf.json:27-38`):
  - `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`, so libraries (lottie-web, three, a polygon clipper, an icon set) must be **npm-bundled**, never loaded from a CDN.
  - §4B plans to **remove `'unsafe-eval'`**. lottie-web's expression support uses `eval`/`Function`, so use a no-expressions build or a native Lottie → MotionScene converter. HTML MOGRT scripts already rely on `new Function` (`editor/HtmlMotionLayer.tsx:67`).
  - `font-src 'self' data:`, so a bundled font must ship in `dist` or as a data URL, not through `asset:`.
  - `img-src`, `media-src` and `connect-src` allow `asset:`, so fetching PNG sequences and Lottie JSON through `fileSrc` works.
- **Performance:**
  - shapes are re-rasterised every frame (A3);
  - "70-layer scenes slow" (`renderer.ts:244-245`);
  - one clip per layer (fact 10);
  - export is PNG per frame.

  Characters and UI mock-ups must be few layers with internal structure and cached rasters.
- **GPU contention.** One GPU job at a time through the lease (`local_media.rs:10-15`). Blender must take it.
- **Python.** It is user-configured (no bundled env), and some paths are machine-specific (`lib.rs:1160-1163`). Blender ships its own Python, so the Blender worker needs **no** venv. Run with `--factory-startup` and pass the request after `--`.
- **Sync Tauri commands freeze the UI** (memory note on hang debugging; `lib.rs:832-840`). New commands must be `async fn` or `#[tauri::command(async)]`.
- **Licensing.** Blender is GPL, so call it as an external process and do not bundle it. Flag any character asset packs or icon sets without clear licences (the Researcher seat refuses watermarked or unclear media).

---

## Integration recipes

### 1. Add a new motion layer type

The worked example is `type: 'sequence'` (a PNG sequence as footage). Adapt the steps for `character`, `lottie` or `svg`.

1. **Model.** Add the variant to `Layer` in `src/motion/types.ts:255-264`, with its data type next to `ShapeData` (166-188).
   - For a file-backed type, prefer extending `FootageSource` (192-209) with `sequence?: { dir; fps; frames; first?; digits? }`. It then inherits fit, matte, cutout and timeRemap.
2. **Validate.** In `src/motion/validate.ts`:
   - add it to `LAYER_TYPES` (7);
   - add a precise per-type check next to 48-52, with messages the AI can act on;
   - include it in `sceneAssets` (71-77) and `overlayBox` (85/89).
3. **Size and clock.** Add a `defaultSize` case in `src/motion/evaluate.ts:80-108` that returns the real content box. Map its time at 281 if it runs on its own clock.
   - Put any solver (IK, morph, Lottie frame mapping) in a **pure** module beside `evaluate.ts`, and unit-test it.
4. **Pixels.** Add a `case` in `MotionRenderer.content()` (`src/motion/gl/renderer.ts:130-206`) that returns `target` and `pad`.
   - For vectors: Canvas2D through a `raster.ts` function plus a **signature cache** (copy the text pattern, 173-188).
   - For images: `this.bank.<loader>()` → `upload` → a `FOOTAGE_FS` pass.
   - When pixels are missing, do `incomplete++` and return null.
5. **Media.** For file-backed types, generalise `MatteSequence` in `src/motion/sources.ts`:
   - add a `sequence` loader: `footageAt` 40-53, `syncPreview` 143-170, `prepareExact` 178-198, `warm` 277-297, trim, and a frame getter;
   - update every `MediaHost`: `host.ts:33-50`, `MotionLayer.tsx:33-35`, `previewCache.ts:366-368`, `lab/lab.ts:12-24`, `parity/parity.tsx`.
6. **Layout and QA.**
   - `safeArea.ts` `candidates` (68-76) and `informational` (78);
   - `polish.ts:55,71,77,130,191`;
   - `coverage.ts:35-38`.
7. **Layered comps.** In `motionStack.ts`: `LABEL` (40), `layerTitle` (34-37), `supportIds` (42-57) if it references other layers, and the precomp recursion if it nests.
8. **AI surface.**
   - `summarizeScene` (`motionTools.ts:124-148`) so the AI sees the new fields;
   - `retime` keys (420) if it carries time fields with new names;
   - `brandify.ts:146-157` if it should take brand colours;
   - the vocabulary line in `copilot.md:92`, the `create_motion_scene` description in `ai-tools.json`, and `docs/MOTION-ENGINE.md`.
9. **UI.** `MotionInspector.tsx` (78, 112-125, 271) and the layer view in the Properties panel.
10. **Tests.**
    - `tests/motionEngine.test.ts` (evaluation) and `tests/motionTools.test.ts` (validation errors, patching);
    - a Lab scene in `src/motion/lab/scenes*.ts` plus a Playwright golden through `window.lab.exportTest`;
    - the parity harness if it touches footage.
11. **Rust:** nothing (the scene is a `serde_json::Value`). Only add a command if it needs native file reading or rendering (recipe 3).

### 2. Add a new AI tool

The worked example is `render_3d_scene` or `list_icons`.

1. **Schema.** Add `{name, description, input_schema}` to `src/lib/ai-tools.json`, with `additionalProperties:false` and required fields.
   - Keep the description short. It costs tokens on every round for every provider, so put the long guidance in the tool's *result*.
2. **Executor.**
   - For a motion tool: add the name to `MOTION_TOOLS` (`src/lib/motionTools.ts:21`) and a `case` in `runMotionTool` (453-730). Use `ctx.commit`/`ctx.editComp` for edits, so each call is one undo step, and return `done(summary, data)` / `fail(error)`.
   - For another tool: add a `case` in `runToolInner` (`src/lib/aiTools.ts:580+`), or a module plus a routing `if` like `ROAST_TOOLS` (610-615).
3. **Native side (if any).**
   - An `async fn` command in `src-tauri/src/lib.rs`, registered in `generate_handler!` (3043);
   - an `api.*` wrapper in `src/lib/ipc.ts` (for example 524-525);
   - if it runs longer than 180 s, add its name to the long list in `src-tauri/src/ai_tools.rs:194-200`.
4. **Permission.** Add read-only tools to `READS` (`src/lib/permissions.ts:18-50`) and deleting tools to `DESTRUCTIVE` (53-59).
5. **Phase.**
   - Reads and catalogues go in `ALWAYS_TOOLS` (`src/lib/editWorkflow.ts:228-270`).
   - Tools that plan or research go in `preparation` (98+).
   - Tools that produce media for the plan go in `GATHER_TOOLS` (200-213), plus `MEDIA_TOOLS` in `aiTools.ts` (568) so the result attaches to the shot.
   - Leave edit tools unlisted.
6. **Waiting on jobs.** Subscribe through `jobsStore` or `events.job` (or poll `api.jobsList`), and call `api.jobCancel(id)` when the turn's `AbortSignal` fires (see `roast/receipts.ts:181-197`).
7. **Teach it.** Add a one-line pointer in `copilot.md` (that needs a Rust rebuild), and optionally an entry in the avatar read list (`src/avatar/brain.ts:18`).
8. **Tests.**
   - A vitest calling `runMotionTool`/`runTool` with ipc mocked (`tests/motionTools.test.ts:3-7`);
   - the catalogue test (`ai_tools.rs:520-521`) must stay green.
   - Custom tools can already call it by name, because `KNOWN_TOOLS` is derived from the JSON.

### 3. Add a Python or external-process worker with progress and cancel

The worked example is `blender_render`.

1. **Script.** `src-tauri/workers/blender_bridge.py`:
   - read the request path from `sys.argv` after `--` (Blender's own argv);
   - build the scene from JSON;
   - print `{"progress": f, "message": m}` JSON lines with `flush=True`;
   - write the frames to `request.out` and a `result.json` (frame count, camera track per frame, errors);
   - `sys.exit(1)` with a traceback on failure.
   - `local_media::run` ignores Blender's own non-JSON log lines.
2. **Locator.**
   - Add `blender_path: Option<String>` to Rust `Settings` (`src-tauri/src/settings.rs:50+`) **and** TS `Settings` (`src/lib/types.ts:530+`).
   - Write a `find_blender()` that tries the setting, then PATH (`tools::find_tool("blender", …)`, `tools.rs:139`), then scans `%ProgramFiles%\Blender Foundation\Blender *\blender.exe` and picks the newest.
   - Add a path field plus Detect in the Settings UI, modelled on FFmpeg's in `SettingsModal.tsx:179-220`.
3. **Runner.** Generalise `local_media::run` (`local_media.rs:28-78`) into `run_program(program, args, job, timeout)`, keeping the stdout JSON-progress, stderr-tail and cancel logic. Add:
   - a wall-clock and idle timeout;
   - once Phase 1.9 lands, the tool-children Job Object, so cancel kills Blender's whole tree.
   - Call it as `blender -b --factory-startup -P <script> -- <request.json>` with `CREATE_NO_WINDOW` and `kill_on_drop(true)`.
4. **Command.** `async fn blender_render_start(state, request) -> CommandResult<String>`, copying `point_track_start` (`lib.rs:1399-1440`):
   - validate;
   - resolve the output dir under the project storage (`storage::dir(state, Category::…)`, `storage.rs:205`; add a `3D` category at 33-49 and 92-110). **Never `work/`**, which is wiped at startup;
   - take the GPU lease `local_media::acquire()` (10-15);
   - `state.jobs.start("generation", label, true)`;
   - `spawn` → write the embedded script (`include_str!`) and the request → `run_program` → read and validate `result.json` → `job.done(msg, Some(json))`.
   - Register it in `generate_handler!` (`lib.rs:3043`) and add `api.blenderRenderStart` in `src/lib/ipc.ts`.
5. **UI visibility.** Kind `generation` appears in the status bar (`App.tsx:2804-2831`). `model` jobs appear only in the ResourceMonitor. Extend `Job.kind` (`types.ts:447`) for a new kind.
6. **The AI tool** (recipe 2): wait on the job, cancel on abort, add the tool to the 1800 s list in `ai_tools.rs:194-200`, then place the result, as a `sequence` footage layer (recipe 1) or a clip.
7. **Tests.**
   - A Rust unit test for the request and result validation (like `point_track::validate`);
   - an `#[ignore]` e2e test that runs the real Blender by hand (like `render::e2e`);
   - a vitest for the TS tool with ipc mocked.

### 4. Add a motion template

1. **Builder.** Write it in the right kit file: `stageTemplates.ts` (full-frame stage), `overlayTemplates.ts` (over footage), `storyTemplates.ts`, `brandTemplates.ts`, or a new file.
   - Use the `common.ts` grammar: `unit(ctx)` sizing (35), `enter`, `inHoldOut`, `headline`, `glassCard`, `scene()` (79-81, motion blur on), and `pal(ctx)` or the brand.
   - Emit `cues` for sound. Set `template: { id, params }` so `update_motion_scene {params}` can rebuild it.
   - **Tolerate missing or odd params.** Tests build every template with generic params, and a builder that throws is skipped silently (`motionSafeArea.test.ts:74`).
2. **Spec.** Add a `TemplateSpec` (`kit/index.ts:12-26`) to that file's exported array: `id`, `label`, `technique`, a one or two sentence `use` (when to choose it), `params` as `name → 'type (default) — meaning'`, `seconds`, `fullFrame` and `build`.
   - Footage params should follow the `FOOTAGE` phrasing (`overlayTemplates.ts:1174`) so `{clipId}` resolution works (`motionTools.ts:95-109`). Add the template to `TEMPLATE_FOOTAGE` (734-743) if it needs a selected clip in the Graphics tab.
   - A new file's array must be added to `MOTION_TEMPLATES` (`kit/index.ts:47`).
3. **Brand.** Check that `buildInBrand`/`brandifyScene` (`kit/brandify.ts`) recolours it. Use palette roles, not literal hexes.
4. **Safe area.** Rest positions must sit inside `SAFE`/`SOCIAL_SAFE` (`lib/layout.ts:27-28`) in both 16:9 and 9:16. The fitter moves only informational clusters.
5. **Tests and Lab.** Add sample params to the matching `tests/motionKit*.test.ts`, run `motionSafeArea.test.ts`, and add a Lab scene (`src/motion/lab/scenes*.ts`) for a Playwright contact sheet.
6. **AI.** Nothing is required, because `list_motion_templates` reads the spec. For a key template, add it to the template map in `MOTION_DESIGNER_EXPLAINER_PROFILE` (`motionTools.ts:263-264`) or the recipe guide (recipe 5).

### 5. Teach the AI a new guide or recipe

1. **Write the knowledge as data in TS**, not in the prompt: for example `src/lib/motionDirection.ts` exporting topics such as `saas-explainer`, `product-launch`, `brand-film`, `character`, `2.5d`, `ui-mockup`. Each topic holds rules, a beat recipe, and a mapping from each beat to template or tool calls with example args.
   - This follows WORLD-CLASS-PLAN 2.2 `craftRules.ts`, one source of truth, and lets vitest check that every template id and tool name it cites exists (as `tests/motionGuide.test.ts` and `remotionKit.test.ts` do).
2. **Expose it through a read tool**, the pull channel: add `motion_guide {topic?, beat?}` to `ai-tools.json`, `READS` and `ALWAYS_TOOLS`, and return the relevant section only. Precedents are `react_bits describe`, `remotion_kit`, and `get_brand_guideline {part}`.
3. **Point to it in one line** in `copilot.md`, in the MOTION ENGINE section (87-93) or PRODUCT/SAAS (71-72): "before planning a {genre} video call `motion_guide {topic}`". Keep the always-on prompt small (C5), and rebuild Rust.
4. **For a measured style** (upgrade 6), have the analysis tool return numbers (easing curves, stagger, hold times, cut rhythm) and let `save_style_profile` store them. The profile then rides in the context `reference` every turn, which is right for *the active* style only.
5. **For the brand motion language**, write it into the kit's guideline `moves` and `recipes` (`update_brand_kit {"section":"guideline"}`, copilot.md:111). The `brand-*` templates render it exactly.
6. **Verify the model uses it.** Add a replay case to the planned eval harness (WORLD-CLASS-PLAN 2.3, `:530-539`), or at least a vitest asserting that the guide's tool and template references resolve.
