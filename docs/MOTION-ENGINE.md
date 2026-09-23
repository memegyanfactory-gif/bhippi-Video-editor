# Helios motion engine

This is the reference for `src/motion/`, a GPU compositor for After Effects-grade motion design
inside Helios. The plan it implements, and the reference film it was measured against, are in
[MOTION-DESIGN-MASTER-PLAN.md](MOTION-DESIGN-MASTER-PLAN.md).

## How it fits into Helios

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

## Scene model (`src/motion/types.ts`)

AE conventions throughout:

- **Units:** scene pixels, origin top-left, +y down, +z away from the viewer.
- **Angles, opacity, time:** degrees; opacity 0–100; seconds from the clip start.
- **Layer order:** layers are listed bottom to top.

Any animatable value (`Prop`) takes one of three forms:

- A literal: `12` or `[960, 540]`.
- Keyframes: `{ k: [{ t, v, ease }] }`. The `ease` of a key shapes the segment that starts at it.
  - Named eases: `expo-out`, `back-out`, `spring`, and the other names in `EASE_NAMES`.
  - Or CSS-style cubic-bezier control points: `[x1, y1, x2, y2]`.
- An expression: `{ expr, v?, k? }`, in a safe interpreter (`src/motion/expr.ts`). No `eval`.
  - It supports `wiggle`, `loopOut`/`loopIn` (cycle, pingpong, offset), `valueAtTime`, `linear`, `ease`, `easeIn`, `easeOut`, `clamp`, seeded `random`/`gaussRandom`/`noise`, `posterizeTime`, `Math.*`, vector maths with broadcasting, `var` statements and the ternary operator.
  - A broken expression returns the property's own value, as AE does.

### Layer types

| Type | Draws |
|---|---|
| `footage` | Video or still, `fit` cover/contain/none. `source.matte` is the Roto matte. `cutout: true` uses it as alpha. |
| `solid` | A colour. |
| `procedural` | One of `crimson-stage`, `radial-glow`, `linear-gradient`, `hex-field`, `grid`, `light-rails`, `noise`, `light-leak`, `dots`, `aurora`. |
| `shape` | rect, ellipse, polygon, star, path, line. Has fill or gradient, stroke, dash, trim paths (`trimStart`/`trimEnd`/`trimOffset`) and a repeater. |
| `text` | Plain text or rich `spans` (script accent word, italic, colour, strike-through). See **Text** below. |
| `null` | Nothing. A parent for other layers. |
| `camera` | AE one- or two-node camera: `zoom`, `pointOfInterest`, `focus`, `aperture`. |
| `precomp` | A nested scene, with `offset`/`speed`, up to 6 deep. |

**Text layers** also take:

- **`cascade`:** a timed entrance per char, word or line. Units start at the `times` you give (usually from the transcript) or at `delay` plus `stagger`. It supports a dim-to-bright stage and an exit.
- **`animators`:** AE range selectors (start/end/offset, shapes, smoothness, randomise) driving position, scale, rotation, opacity, blur, tracking, fill colour and skew.
- **`counter`:** a rolling number.
- **`reveal`:** a typewriter reveal.

### Settings every layer has

- **Timing and rigging:** `in`/`out`, `parent`, `threeD`.
- **Transform:** anchor, position, scale, rotation, rotationX/Y, opacity, skew.
- **Compositing:** `blend` (17 W3C modes), `matte` { layer, mode: alpha / alpha-inverted / luma / luma-inverted }, `hidden`.
- **Masks:** `masks[]` of rect (rounded), ellipse or path, with add/subtract/intersect, feather, expansion and invert.
- **`effects[]`:** the effect stack; every numeric param can be animated.
- **`motionBlur`:** set per layer. The scene's `motionBlur` sets the samples and shutter angle.
- **`backdrop`:** frosted glass that blurs what is behind the layer.
- **`adjustment`:** makes the layer an adjustment layer.

### Effects

These are in `src/motion/gl/effects.ts`. Every one exports exactly as it previews.

- **Glow and blur:** glow (single or deep, three-scale), halation, gaussian / directional / zoom / lens blur.
- **Colour:** chromatic aberration, RGB split, vignette, grain, tint, duotone, black & white, brightness-contrast, hue-saturation, levels, exposure, invert, fill, radial gradient overlay.
- **Shadow and edges:** drop shadow, stroke (outside/centre/inside), matte choke.
- **Stylise and distort:** mosaic, pixel sort, displacement, turbulent displace, wave warp, lens distortion, light leak, liquid glass.

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
| `get_motion_scene` / `update_motion_scene` | Read a scene, then edit it: rebuild from template params, patch any property by path, add or remove layers, retime. |
| `track_motion` | OpenCV Lucas–Kanade point or planar tracking (`workers/point_track.py`, command `point_track_start`). It can write the track as keyframes on a scene layer. |
| `analyze_reference_video` | Measures a film: cuts, shot histogram, hook density, palette, contact sheets as images. Built on `refs_ingest`. |
| `save_style_profile` | Stores the profile as the project's active guideline. `builtin: "motion-designer-explainer"` is the measured reference. |

- **`reveal_subject`** now defaults to the cell reveal. The old tile grid is still available as `style: "cubes"`.
- **`erase_subject_clip`** refuses a clean-plate range that crosses a scene cut.
- **Frame QA** checks overlay scenes against the subject's face.

## Editing by hand

When a motion clip is selected, the Properties panel shows a Motion inspector
(`src/panels/MotionInspector.tsx`) with:

- template params and a Rebuild button
- motion blur samples and shutter angle
- the layer list, with blend mode, motion blur, visibility and effect toggles per layer
- the raw scene JSON, validated when you apply it

## Checking your work

- **Unit tests:**
  - `tests/motionEngine.test.ts`: easing, keyframes, expressions, 3D, parenting, text engine.
  - `tests/motionTools.test.ts`: validation and the tools.
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
