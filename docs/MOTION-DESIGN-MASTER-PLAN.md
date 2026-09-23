# Helios motion design master plan

Written 2026-09-23. This plan makes Helios edit at the level of the reference
video *"If You ONLY Watch One Motion Design Video, Make It This…"* (11:44,
1280×720, 29.97 fps; local copy in `~/Downloads`). That video was cut and
animated in After Effects. The goal is that Helios, driven by its AI, produces
that kind of edit from a user's own footage, and exports exactly what the
preview shows.

## Status: built 2026-09-23

The engine is documented in [MOTION-ENGINE.md](MOTION-ENGINE.md).

| Phase | State |
|---|---|
| 0 · Reference intelligence | **Built.** `analyze_reference_video` measures cuts, shot histogram, hook density and palette, and returns the contact sheets as images. `save_style_profile` saves a profile, and `builtin: "motion-designer-explainer"` loads the §1.3 numbers. The audio/SFX timing pass is not built. |
| 1 · GPU render core | **Built, with a different architecture from §3.1** (see below). WebGL2 renders motion scenes identically in preview and export: PSNR 47 dB between a preview frame and its exported frame, which is JPEG-noise level. Keyframes take bezier and named eases plus AE expressions. Also built: 17 blend modes, track mattes, masks, parenting, 3D layers with camera, and motion blur. |
| 2 · Matte FX | **Built.** `subject-reveal`, `matte-fill` and `matte-edge-glow`. `reveal_subject` defaults to the cell reveal, and the eraser refuses clean plates across scene cuts. MatAnyone and ProPainter are not added; the existing RVM, SAM2 and LaMa are used. |
| 3 · Typography | **Built.** Per-glyph animators with range selectors, word-timed cascades (dim-to-bright), rich spans (script accent, italic, colour, strike), counters and a typewriter reveal. |
| 4 · 2.5D and camera | **Built.** 3D layers, a one- or two-node camera and depth sorting. Depth of field is approximated per layer with blur keyed to depth, not a true lens pass. |
| 5 · Effects | **Built.** 34 effects, all identical in preview and export. |
| 6 · Motion kit | **Built.** 20 templates covering T1–T27. Each was checked visually in landscape and portrait, and 145 template tests pass. |
| 7 · Tracking | **Built.** OpenCV Lucas–Kanade point and planar (similarity) tracking, which can be applied to scene layers. Stabilisation, corner pin and CoTracker are not built. |
| 8 · Pro UX | **Partial.** A Motion inspector: template params with rebuild, layers with blend/motion-blur/visibility/effect toggles, scene motion blur, and raw JSON. A Graphics-tab template browser. No graph editor or per-property keyframe curve UI yet. |
| 9 · AI director | **Built.** Six motion tools plus `track_motion`, a MOTION ENGINE section in the copilot prompt, and frame QA covering overlay scenes. |

**How the architecture differs from §3.1.** The plan put the whole NLE onto one WebGPU graph. What was built instead:

- WebGL2 runs the engine. It is universal in WebView2.
- The engine is hosted as a clip type, `{ type: 'motion' }`. The FFmpeg exporter composites these clips as PNG sequences that the same renderer produced.
- The rest of the NLE keeps its existing DOM preview and FFmpeg export, so nothing that already worked had to change.
- Moving plain NLE clips onto the engine remains a later step.

---

Frame sheets used for this analysis are in `docs/research/motion-reference/`.
They are git-ignored because they are third-party frames.

- `reveal_01..03.jpg`: every frame of the first 1.2 s
- `open_*.jpg`: 0–12 s at 5 fps
- `all_*.jpg`: the whole video, one frame every 2 s
- `b_*.jpg`: dense bursts on the individual techniques
- `cuts.txt`: hard-cut times

---

## 1. What the reference actually does

### 1.1 The opening shot, frame by frame (0:00.000–0:02.000)

This is the shot the user called out. At 29.97 fps:

| Frames | Time | What is on screen | How it was built in AE |
|---|---|---|---|
| 0–2 | 0.00–0.07 s | Empty room: mic, plant, laptop, wall. No person. The plate is blurred and desaturated, with a slow push-in. | **Clean plate.** The presenter was painted out of the first frame (Content-Aware Fill or a still plate), then Camera Lens Blur and Hue/Sat were applied to the plate. |
| 3 | 0.10 s | One small red glowing square appears where the face will be. | The reveal **seed**, placed at the face centre. |
| 3–11 | 0.10–0.37 s | The squares multiply outward from the face. Each square shows the real footage with a strong red tint and glow. The blocks only exist inside the person's silhouette. | **Roto matte, quantized to a mosaic grid.** Each grid cell turns on at a time set by its distance from the seed. A cell is only visible where the subject's alpha is present. The effect is Mosaic on the matte, plus Tint/Fill, plus Glow. |
| 6 | 0.20 s | "Motion" slides in from the left, going from blurred to sharp with a soft white glow. | Text layer: blur 20→0, x offset, opacity 0→100, Glow. |
| 12–19 | 0.40–0.63 s | The reveal front runs **top to bottom** down the torso and hands. The leading edge is solid red, the blocks behind it are tinted, and a few stray blocks spill past the contour. | The cell delay is radial distance plus a vertical gradient term plus noise. The edge cells get the fill colour. |
| 13 | 0.43 s | "Design" enters from the right. | Mirrored text animation. |
| 18–21 | 0.60–0.70 s | The red cools to natural colour, the mosaic resolves into the fine matte, and the background comes into focus. | Per-cell tint decay. Mosaic size goes to 0, which gives the full-resolution matte. Plate blur goes to 0. |
| 20–35 | 0.67–1.17 s | The presenter talks. His hand passes **in front of** "Motion", so the words sit **between the plate and the person**. | Layer sandwich: plate, then title, then roto subject. |
| 22 / 26 / 31 | 0.73 / 0.87 / 1.03 s | "is", "not" and "difficult" appear one word at a time, synced to speech. Each word blurs in and starts dim, then brightens. | Words keyed to the transcript. A text animator with a range selector runs per word. |
| ~54–60 | 1.8–2.0 s | The whole frame shrinks into a rounded card with a shadow, over a black-to-crimson gradient. | The comp is pre-composed and scaled down. It gets a rounded mask, a drop shadow and a stroke, on a gradient background. |
| 2.2–3.0 s | | The card flies off left. A wall of UI screenshots flies in from depth with motion blur. Kinetic words land on top ("You", "Great", "Still manual…"). | 3D layers, a camera move and motion blur. |

**Why it looks expensive:** four separate systems act on one shot.

1. A clean plate.
2. A subject matte that is also used as an *animated* matte, not just a cut-out.
3. Typography in depth between the plate and the subject.
4. A camera move, blur, glow and grade.

Every system has its own easing, and each one ends as the next begins. Helios
today can do each piece roughly on its own (RVM roto, LaMa clean plate,
text-behind-subject, a tile-grid `cubes-reveal`). It cannot make the matte
itself animate. It also has no glow, motion blur or 3D in export, and the pieces
do not share one timeline of eases.

The current `reveal_subject` (`src/lib/aiTools.ts:3158`) fades the subject's
opacity in while an opaque tile grid falls across the *whole frame*
(`src/lib/motionGuide.ts:396`). The reference does something different: the
mosaic is cut from the subject's own alpha, is seeded from the face, is tinted,
and resolves to the fine matte.

### 1.2 Technique catalogue (with timestamps)

Every technique below needs a first-class Helios feature.

| # | Technique | Where | AE recipe | Helios today |
|---|---|---|---|---|
| T1 | Clean plate + subject sandwich | 0:00, 0:32 "45 Sec", 5:32 "FIRST BATCH", 10:32 "12917 AED", 11:10 "2026" | Content-Aware Fill or plate; roto; text between | Partial: `erase_subject_clip`, `add_text_behind_subject` |
| T2 | Matte-driven mosaic reveal (cells seeded at the face, flowing top to bottom, red tint that cools off) | 0:00.1–0:00.7 | Mosaic + Fill + Glow on the matte, cell delay from distance | **No.** `cubes-reveal` is a frame-wide tile wipe. |
| T3 | Matte fill wipe (silhouette filled solid crimson, rising, then dissolving into the footage) | 1:38, 1:50 (Prem Sagar cut-outs) | Fill effect on the roto layer, a gradient wipe, a crossfade | No |
| T4 | Roto cut-out on a gradient stage with callout leader lines (dot, line, glass pill label) | 1:38–1:53 | Shape layers with Trim Paths, a null-parented label | Partial (static cards) |
| T5 | Frame-to-card (the full frame shrinks into a rounded card with shadow and stroke) | 0:01.8, 0:20→0:22 ("50 Videos" becomes a YouTube page), 0:28 | Precomp with scale, rounded mask, drop shadow | No (no rounded mask or shadow in export) |
| T6 | 3D card wall / UI collage with camera dolly and motion blur | 0:02–0:05, 0:05.4 grid assemble | 3D layers, camera, motion blur | No |
| T7 | Kinetic type: blur-in per word, dim-to-bright, sans + handwritten script accent ("taste", "scared", "later", "to write"), italic emphasis | 0:16, 0:36, 0:38, 2:14 | Text animators, two fonts | Partial (captions, rbx in HTML only) |
| T8 | Sentence over a blurred, darkened talking head, keywords in red, strike-through that swaps words | 6:44, 7:28, 8:16 | Adjustment layer blur, text animator, shape strike | Partial (no strike/swap, no keyword colour animation) |
| T9 | Hex-grid chapter roadmap ("5 Stages"): beveled hex field, icons pop in, camera flies into one hex | 0:53, 2:04, 4:02, 5:38, 6:48, 9:26 | Shape repeater + bevel, 3D camera | No (recurring navigation device) |
| T10 | Glass teaching card: frosted panel, list items write on, sub-lines type out | 2:48–3:45 ("Pillar 1–5") | Shapes + backdrop blur + text animators | Partial (`teaching-card`, HTML, no backdrop blur in export) |
| T11 | Ribbon title: a glowing ribbon draws a sine path and the title types along it | 2:38 "5 Pillars of Design" | Trim Paths on a stroke with glow | Partial (`ribbon-title`) |
| T12 | Numbered lanes: baseline ticks, vertical light rails, big digits with floor reflection, camera trucks lane to lane | 5:40–6:32 | Repeater, reflection, 3D camera | Partial (`numbered-lanes`, flat) |
| T13 | Diamond-badge list beside a PiP | 4:10–4:34 | Shapes + text animators | Partial |
| T14 | Node tree (cards joined by connectors that draw on) | 4:36–4:48 | Trim Paths | Partial (`connected-map`) |
| T15 | Split-screen rules panel (subject left, black panel with crimson flare right, numbered pills) | 9:48–10:12 | Precomp crop + shapes | Partial (`side-panel`) |
| T16 | Stat badges with count-up (150K+, $907M→$1B+) | 0:50–0:53 | Slider expression, number text | Partial (`stat-chart`, no count-up rolling) |
| T17 | Dock icon bar with an animated cursor that clicks | 0:30–0:32 | Shapes + cursor path | Partial (`cursor-demo`) |
| T18 | Screen recording double-exposed over a face, lens vignette | 1:06–1:08 | Screen blend mode, vignette | **No blend modes** |
| T19 | Zoom-blur tunnel transition through a wall of thumbnails | 8:19–8:21 | CC Radial Fast Blur on a scaled grid | No |
| T20 | Grade switch for emphasis (warm to B&W on a beat) | 0:32.8 | Adjustment layer cut | Partial (adjustment layer, no preset toggle on beat) |
| T21 | Stylised b-roll: crimson/teal duotone, heavy halation and bloom, handheld blur | 0:15–0:18, 0:38 | Lumetri + Deep Glow + CC | Partial (grade yes, bloom/halation no) |
| T22 | Effect showcases: pixel sort, Deep Glow, liquid glass | 0:06–0:15 | Plugins | No |
| T23 | Social-proof mocks (YouTube card, analytics chart) floating on the stage | 2:00, 7:38–7:54 | Precomp + shapes | Partial |
| T24 | App-demo walkthrough with dashed callout boxes and captions ("Agent gives choices to proceed") | 8:24–9:12 | Shapes + text | Partial |
| T25 | Side-by-side comparison cards | 9:14–9:20 | Precomp layout | Partial (`comparison`) |
| T26 | Punch-in jump cuts on the talking head (100%→~115% with a grade change) | throughout | Scale on cut | Yes (`layout_clip`, keyframes) |
| T27 | Big type behind the subject, partly occluded by head and mic | 0:32, 5:32, 10:32, 11:10 | T1 | Partial |

### 1.3 Style profile (numbers to encode, not vibes)

- **Structure.**
  - 0:00–0:15 is a hook montage with a new visual every 0.5–2 s.
  - The hex roadmap (T9) returns at every chapter: 0:53, 2:04, 4:02, 5:38, 6:48 and 9:26.
  - Long full-graphic sections carry the teaching: 2:38–3:45 (67 s), 4:10–4:48, 5:40–6:32 and 8:24–9:20.
- **Cadence.** Scene detection finds 106 hard cuts in 704 s, so the mean hard-cut shot is 6.6 s. The distribution is 23 shots under 1.5 s, 39 of 1.5–4 s, 22 of 4–8 s and 20 over 8 s. Most visual changes are not cuts, though: overlays land every 2–6 s on the talking head. The talking head rarely runs more than about 15 s without a graphic.
- **Palette.**
  - Stage: near-black oxblood at the top, glowing crimson at the bottom.
  - Accents: crimson, pink highlight, white type with a soft glow.
  - Talking head: warm amber and orange.
  - B-roll: crimson/teal duotone or pink.
- **Type.**
  - One neutral geometric sans, bold and tightly tracked, for everything.
  - A handwritten script for exactly one accent word per phrase.
  - Italic for spoken emphasis, red for the key phrase.
  - Words enter one at a time on speech, with a blur-in plus a dim-to-bright change.
- **Motion.** Almost everything enters with blur + slide + fade on an expo-out ease, and exits with blur + fade, faster than it entered. Cards and hexes move with motion blur. Nothing moves linearly.
- **Depth.** There are at least three layers per shot: plate or stage, then graphics, then subject or foreground. Cards cast soft shadows and have 1 px light strokes.

**Not yet measured:** audio. The next pass should run onset detection to time
the whooshes, clicks and risers against graphic events (see Phase 0).

---

## 2. The gap, in one table

| Capability | Needed for | Helios now (file) |
|---|---|---|
| One renderer for preview **and** export | Everything; today many effects are preview-only | DOM/CSS preview (`src/editor/Compositor.tsx`) and FFmpeg `filter_complex` export (`src-tauri/src/render.rs`). Only 15 effects export (`src/lib/effectSupport.ts`). |
| Blend modes | T18, glows, light leaks | None |
| Track mattes (alpha/luma/inverted) | T2, T3, T5, text fills | None (per-clip roto matte only) |
| Multiple animated masks, rounded rects, feather | T5, T10, T15 | One static mask per clip |
| Keyframes on any property, bezier handles, graph editor | Every animation | 6 properties, fixed easings (`src/lib/keyframes.ts`) |
| Parenting / nulls | T4, T12, T14 | 2D: none |
| 3D layers + camera + depth of field | T6, T9, T12 | `src/lib/scene3d.ts` untracked and unwired |
| Motion blur (shutter) | T6, T9, T12, every fly-in | None |
| Real effects (glow, zoom blur, chromatic aberration, grain, halation, pixel sort, glass) | T19–T22 | Placeholders in `src/lib/effectsCatalog.ts` |
| Matte-driven effects | T2, T3 | None |
| Text animators (range selectors, per-glyph blur/offset/opacity, two-font styling) | T7, T8, T11, T16 | Captions + ASS; full animators only inside HTML graphics |
| Point / planar / face tracking, stabilisation | Callouts that follow a person, screen replacement | Person boxes only (`src-tauri/workers/person_track.py`) |
| Reference-driven style | "Make all my edits like this" | Crimson rulebook is hand-written (`src/lib/motionGuide.ts`) |

The first row is the root cause. Until preview and export are the same GPU
program, every other feature has to be written twice (CSS and FFmpeg) and will
still drift apart.

---

## 3. Architecture

### 3.1 One GPU render graph for preview and export

```
                ┌──────────────── Project (types.ts) ────────────────┐
                │ comps → layers → {source, transform3D, masks[],    │
                │ matte, blend, effects[], text animators, parent}   │
                └───────────────┬─────────────────────────────────────┘
                                │ evaluate(t)  (pure TS, deterministic)
                                ▼
                     Render graph for frame t
      (nodes: decode, text, shape, precomp, effect, matte, blend, camera)
                                │
                     WebGPU executor (WGSL)
                  ┌─────────────┴─────────────┐
            Preview: canvas               Export: offscreen
         (rAF, masterClock.ts)     (step t = n/fps, readback-free
                                    VideoEncoder → mux; audio via FFmpeg)
```

- **Evaluation** is pure TypeScript: `evaluate(project, compId, t) → RenderGraph`. It resolves keyframes, expressions, parenting, the camera, text layout and visibility. It has no DOM. It is unit-testable and shared by preview, export, thumbnails and frame QA.
- **Execution** is WebGPU with WGSL shaders. WebView2 on Windows is Chromium and ships WebGPU (D3D12). WKWebView supports it on current macOS. At startup the app runs a capability check. If the check fails, it falls back to today's DOM preview and FFmpeg export and shows a warning. No project is ever unexportable.
- **Decoding:** WebCodecs `VideoDecoder`, fed by an MP4 demuxer (mp4box.js). This gives frame-exact, seek-safe frames as GPU textures (`importExternalTexture`). Long-GOP sources get an all-intra proxy (FFmpeg, background job, existing jobs store) so scrubbing stays instant. This also retires the "never seek playing elements" workarounds in preview (see `src/lib/masterClock.ts`).
- **Export** steps time exactly, never in real time:
  - Render each frame and feed the GPU texture to WebCodecs `VideoEncoder` (H.264/HEVC/AV1, hardware).
  - Mux with a JS muxer (Mediabunny or mp4-muxer).
  - Mix audio with the existing FFmpeg audio graph (`src-tauri/src/render/audio.rs`) and mux it in with FFmpeg `-c copy`.
  - ProRes 4444 with alpha falls back to piping raw RGBA frames to FFmpeg through a Tauri binary channel.
- **Migration:** keep the FFmpeg exporter as the reference. Parity tests render the same project both ways and compare frames (PSNR ≥ 40 dB on features both paths support). Features only the GPU path supports mark the project "GPU export required".

### 3.2 Layer model v2 (`src/lib/types.ts` + `src-tauri/src/project.rs`)

```ts
interface Layer {                     // replaces the render-relevant parts of Clip
  transform: { anchor: Vec3; position: Vec3; scale: Vec3; rotation: Vec3 /*x,y,z*/; opacity: number };
  is3D: boolean;
  parentId?: string;                  // any layer, including a Null
  blend: BlendMode;                   // normal | add | screen | multiply | overlay | softLight | colorDodge | lighten | darken | difference | hue | color | luminosity
  matte?: { layerId: string; mode: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted' };
  masks: Mask[];                      // path (bezier) | rect(radius) | ellipse; mode add|subtract|intersect; feather; expansion; opacity; all animatable
  effects: EffectInstance[];          // ordered stack, every param animatable
  motionBlur: boolean;
  text?: TextLayer;                   // §3.4
  props: Record<string, Animatable>;  // property path → value | keyframes | expression
}
type Animatable<T = number | Vec2 | Vec3 | Color> =
  | { value: T }
  | { keys: Keyframe<T>[] }           // bezier in/out tangents (AE speed+influence), spatial tangents for position, hold
  | { expr: string; base?: T };       // sandboxed: time, value, wiggle, loopOut, linear, ease, valueAtTime, index, thisComp.layer()
```

- **Keyframes on every property path.** Examples: `transform.position`, `effects.glow.radius`, `text.animators.0.range.end`, `masks.0.path`. This replaces the six fixed properties in `KeyframedProperty`. The old easing names map to bezier presets. `overshoot` becomes a real bezier plus a spring option.
- **Expressions** run in a tiny interpreter over an AST, not `eval`. They are deterministic and seeded (the seed for `wiggle` is part of the project).
- **Camera layer:** position, point of interest, zoom/FOV and depth of field (focus distance, aperture). Motion blur uses N sub-frame samples (default 8, 180° shutter), so what the preview shows is what exports.
- **Migration:** a `v1 → v2` converter. Old clips become layers with `is3D=false` and one mask. Old keyframes become bezier keys. All 64 current Vitest suites must still pass.

### 3.3 Matte FX: the subject as an animated material

This is the heart of the opening shot, so it is a dedicated module (`src/lib/matteFx/`).
Its inputs are the source frame, the subject matte (RVM, SAM2 or MatAnyone) and,
optionally, the clean plate and the face point.

The **Subject Reveal** shader (T2) works per pixel, for a grid of cells of size `s`:

```
cell      = floor(uv * res / s)
cellAlpha = matte(cellCentre)                           // quantised silhouette
delay     = k_r * |cellCentre - seed| + k_y * (cellCentre.y - seed.y)⁺ + k_n * hash(cell)
age       = t - delay                                   // seconds since this cell turned on
on        = step(0, age) * step(threshold, cellAlpha)
resolve   = smoothstep(resolveStart, resolveEnd, age)   // cell → fine matte
alpha     = mix(on * cellAlpha, matte(uv), resolve)
tint      = exp(-age / tintDecay)                       // hot at birth, cools to footage
colour    = mix(footage, fillColour, tint * fillStrength) + glow(tint)
```

- **Parameters:** cell size, seed (default: the face from the tracker, else the top of the subject box), radial and vertical weights, noise, stray-cell spill, fill colour (brand accent), tint decay, resolve window, glow radius.
- **Default preset "crimson-seed":**
  - Cells are 32 px at 1080p.
  - The reveal lasts 0.6 s.
  - The front is 60% radial and 40% top-to-bottom.
  - Tint decay is 0.12 s.
  - Glow is 24 px.
  - The plate blur runs from 18 to 0 over 0.7 s, and the scale from 104% to 100%.
- The **same shader** covers these variants:
  - T3 matte fill wipe: `s = 0`, linear front from the bottom, `fillStrength = 1` then crossfade.
  - Dissolve-out: reversed time.
  - Pixel-dust exit: cells drift upward.
  - Scan reveal: a horizontal line front.
- **Also here:** `matteEdgeGlow` (a rim light from the matte gradient), `matteStroke` (an outline sticker look), `matteShadow` (a contact shadow for cut-outs on a stage, T4), and `matteChoke/spread/feather` for cleanup.

### 3.4 Typography engine (`src/lib/typeEngine/`)

- **Layout:** Canvas2D shapes the text into glyph runs (kerning, ligatures, font fallback), with system fonts per the brand-kit rule. A glyph atlas is uploaded to the GPU and each glyph is drawn as an instanced quad. Large display text (over 200 px) uses an MSDF atlas so it stays crisp under scale.
- **Animators** work like AE's:
  - Each animator has a set of properties: position, scale, rotation, opacity, blur, tracking, fill colour, stroke and skew.
  - A range selector (start/end/offset, by character/word/line, shape square/ramp/triangle, ease high/low, randomise order) sets how much of the animator applies to each glyph.
  - The wiggly selector is included.
- **Transcript binding:** `bindToWords(transcriptWords)` sets each word's selector window from speech timing. This produces the "is… not… difficult" dim-to-bright entrance directly from `transcriptText.ts`.
- **Rich spans** within one layer: font family (sans + script), italic, colour, and a per-span entrance override.
- **Presets** (these are also what the AI calls):
  - `blur-rise`
  - `slide-blur-in`
  - `dim-to-bright-karaoke`
  - `typewriter-with-cursor`
  - `strike-and-swap` (T8)
  - `count-up` (a rolling number with a suffix formatter, T16)
  - `text-on-path` (T11)
  - `scramble`
  - `split-reveal-mask`
- **Glass & glow:** text glow uses the same bloom pass as the effect library. Text can be a matte for footage.

### 3.5 Effect library (WGSL, all export-exact)

The first wave comes straight from the reference:

- Glow / Deep Glow (multi-scale exponential falloff, threshold, tint)
- Halation
- Gaussian, directional and zoom/radial blur (T19)
- Camera lens blur (bokeh, depth-aware when a depth map exists)
- Chromatic aberration
- Vignette
- Film grain (luma-weighted, seeded)
- Duotone/tritone
- LUT (.cube)
- Black & white with a filter colour
- Light leak (procedural)
- Drop shadow and long shadow
- Stroke/outline
- Rounded corners
- Backdrop blur, for real glass cards that blur the layers below (T10)
- Liquid glass (refraction from a normal map, T22)
- Pixel sort (threshold, direction, animated, T22)
- Displacement map
- Turbulent displace
- Wave warp
- Mosaic
- RGB split glitch
- Lens distortion
- Procedural stage backgrounds:
  - crimson radial gradient
  - hex field (T9)
  - grid
  - noise
  - light rails (T12)

The existing `effectsCatalog.ts` names stay. Each entry gets a real `wgsl`
implementation and a parameter schema, and `effectSupport.ts` is retired in
favour of "everything in the catalogue renders".

### 3.6 Subject, plate and tracking pipeline (Python workers, local GPU)

| Step | Current | Upgrade |
|---|---|---|
| Matte | RVM in-browser (`src/lib/roto.ts`), SAM2+ViTMatte (`src-tauri/workers/tracked_roto.py`) | Add **MatAnyone** (target-conditioned video matting with a SAM2 first-frame mask) for hair and hands. Keep RVM for fast drafts. Add BiRefNet for stills and cut-out images (T4). |
| Clean plate | Temporal median + LaMa (`src-tauri/workers/magic_erase.py`) | Add **ProPainter** (flow-guided video inpainting) for moving cameras and parallax. Keep median + LaMa for locked-off shots (fast and exact). |
| Face / seed point | none | MediaPipe Face Landmarker (web or Python). This provides the reveal seed, face-aware text placement and punch-in framing. |
| Point / planar tracking | none | **CoTracker3** point tracks, then a RANSAC homography for planar tracks (screen replacement) and to attach nulls to tracked points (callout lines that follow a hand or face). |
| Stabilisation | none | Track, smooth, then warp (as a GPU effect). |
| Optical flow | FFmpeg `minterpolate` | RAFT for flow-based retime, pixel motion blur and ProPainter input. RIFE for frame interpolation. |
| Depth | Depth Anything (`workers/depth_media.py`) | Also feed it to lens blur and to the depth-aware text-behind-subject. |
| Upscale | none | Real-ESRGAN for low-res b-roll and screenshots. |

**Licensing gate (must check before bundling).**

- ProPainter, MatAnyone (both S-Lab licence) and CoTracker (CC-BY-NC) are **non-commercial**.
- RVM is GPL-3.0.
- SAM2 and MediaPipe are Apache-2.0. LaMa is Apache-2.0.
- RAFT is BSD. RIFE is MIT. BiRefNet is MIT.

All of these are verified at install time. If Helios is sold, the
non-commercial models stay as **user-installed optional models**, downloaded by
`install_local_model` with the licence shown, never bundled. Commercial-safe
defaults are SAM2+ViTMatte, LaMa, RAFT and RIFE.

### 3.7 Motion kit v2: native graphics instead of HTML snapshots

HTML graphics (`src/editor/HtmlMotionLayer.tsx`, `src/lib/htmlFrames.ts`) are
rasterised with the SVG `foreignObject` trick. That loses backdrop blur, motion
blur, 3D and glow, and it cannot interact with the subject matte.

The Crimson templates (`src/lib/motionGuide.ts`) are therefore rebuilt as
**layer graphs**: precomps of shape, text and effect layers with keyframes.
They are generated by builders in `src/lib/motionKit/`. HTML stays as a
fallback for the rbx library.

New and rebuilt templates, each tied to a technique above:

| Template | Technique | Params |
|---|---|---|
| `subject-reveal` | T1+T2 (the opening) | clipId, title words, seed, style `crimson-seed` / `scan` / `fill-rise` |
| `frame-to-card` | T5 | target scale, corner radius, shadow, exit direction, next scene |
| `card-wall-3d` | T6 | images[], words[], camera path |
| `cutout-stage` | T3+T4 | cut-out clip or image, name, role, callouts[{anchor, text, at}] |
| `hex-roadmap` | T9 | stages[{icon,label}], active index; camera flies into the active hex |
| `glass-teaching-card` | T10 | kicker, title, items[{title, detail, at}] |
| `ribbon-title` | T11 | text, path amplitude |
| `numbered-lanes` | T12 | lanes[{title, bullets}], active; camera trucks between lanes |
| `diamond-list-pip` | T13 | items, pip clip |
| `node-tree` | T14 | nodes, edges |
| `split-rules-panel` | T15 | title, rules[], side |
| `stat-badges` | T16 | badges[{icon, value, suffix, countFrom}] |
| `dock-cursor` | T17 | icons[], clicks[{index, at}] |
| `blurred-sentence` | T8 | sentence, keywords (red), strike{from, to} |
| `zoom-tunnel` | T19 | thumbnails[], direction |
| `social-card` | T23 | platform, thumbnail, title, stats |
| `demo-callouts` | T24 | screen clip, boxes[{rect, label, at}] |
| `comparison-pair` | T25 | left/right media + labels |
| `grade-hit` | T20 | preset (bw, duotone, crush), at, duration |

Every template:

- takes brand-kit tokens
- scales with the canvas (landscape, portrait, square)
- emits SFX cue points (in, out, click, whoosh, riser)
- exposes its keyframes, so the AI or the user can retime it

---

## 4. The AI director: "make all my edits like this"

### 4.1 Reference analysis → Style Profile

The new tool `analyze_reference_video {path | url}` is allowed in the PLAN phase.
It does the same job done by hand for this document:

1. **Probe and sheets.** ffprobe, contact sheets at 0.5 fps, and dense bursts around detected events. This extends the existing `inspect_source_frames` and `detect_scenes`.
2. **Cuts and cadence.** Scene detection plus the shot-length histogram.
3. **Shot classes.** A vision model labels each shot: talking head, b-roll, full graphic, screen, cut-out stage, split.
4. **Palette.** k-means per class.
5. **Type.** The vision model describes families, weights, accent script and emphasis rules.
6. **Techniques.** The vision model tags each dense burst against the catalogue in §1.2 (T1…T27).
7. **Audio.** Onset and loudness analysis, then SFX events aligned to the graphic events (`src/lib/beats.ts`).
8. **Output.** A `StyleProfile` JSON saved as a project guideline (`create_project_guideline`) and in `docs/research/` style: cadence targets, overlay density, palette, type rules, technique vocabulary with frequencies, and the chapter device.

`save_storyboard` and `save_video_blueprint` then take `styleProfileId`.
`verify_edit_workflow` checks the edit against the profile's measurable targets:

- longest talking-head span without a graphic
- overlays per minute
- a hook of at least N events in the first 15 s
- a chapter device at each topic change

### 4.2 Built-in profile: "Motion Designer Explainer"

The built-in profile ships with the numbers from §1.3, so the user gets this
look without supplying the video every time. It extends the Crimson rulebook
rather than replacing it.

### 4.3 Beat recipes the AI can call

Recipes are higher-level than templates (`list_recipes` / `apply_recipe`
already exist). Each recipe is a small deterministic program over the new layer
model:

| Recipe | Does |
|---|---|
| `hook-subject-reveal` | Clean plate (erase_subject) → subject matte → `subject-reveal` with the first 2 spoken words as the sandwich title → the rest of the phrase word-synced → `frame-to-card` at the end of the phrase → whoosh + impact on the reveal and the card. |
| `chapter-roadmap` | `hex-roadmap` with the current chapter active, camera into the hex, match-cut to the next scene. |
| `talking-head-emphasis` | Punch-in 112% + a big number behind the subject (T27) + `grade-hit` on the stressed word. |
| `teach-list` | Switch to the stage, `glass-teaching-card`, items keyed to the transcript. |
| `person-profile` | `cutout-stage` with matte fill rise, name, and callouts keyed to the mentions. |
| `quote-over-blur` | `blurred-sentence` over the speaker, keywords from the transcript emphasis. |
| `montage-hook` | `card-wall-3d` → kinetic words → `zoom-tunnel` into the title. |

### 4.4 QA that sees what a motion designer sees

`run_frame_qa` gets technique-specific checks:

- Matte edges at 100% (a halo metric on the alpha gradient).
- Text contrast over its actual background.
- Text overlapping a face.
- Title words occluded by the subject by more than 35% (unreadable sandwich).
- Graphic density vs the profile.
- Eases: no linear moves on position/scale unless flagged.
- Motion-blur presence on fast moves.
- Frame-exact parity between the preview frame and the export frame.

---

## 5. Roadmap

Each phase ends in something the user can see and a test that locks it in. The
week estimates assume one focused engineer plus the AI.

### Phase 0: Reference intelligence (1 week)

- `analyze_reference_video` tool, `StyleProfile` type, profile storage, the built-in "Motion Designer Explainer" profile.
- Audio pass on the reference: SFX and whoosh timing vs graphic events. Fill in §1.3.
- **Done when:** running it on the reference reproduces §1.3 within ±10% on cadence, and it tags T1, T2, T5, T9 and T10 at the right timestamps.

### Phase 1: GPU render core (4 weeks), the critical path

- `src/render/`: evaluator (`evaluate.ts`), WebGPU executor, WGSL shader modules, WebCodecs decode + proxy jobs, export encoder + mux, capability fallback.
- Layer model v2 + migration. Bezier keyframes on property paths. Blend modes. Track mattes. Multiple animated masks with rounded rects. Parenting / nulls. Motion blur.
- Preview uses the executor in `ProgramMonitor.tsx`. The FFmpeg path stays as the parity oracle.
- **Done when:**
  - Every existing test passes.
  - The parity suite passes.
  - A 1080p30 comp with 8 layers and 3 effects previews in real time on the user's GPU.
  - Export is faster than real time with hardware encode.

### Phase 2: Matte FX + subject pipeline (2 weeks)

- `matteFx` module (subject reveal, fill wipe, edge glow, stroke, contact shadow).
- Face seed via MediaPipe.
- MatAnyone and ProPainter as optional installs.
- `reveal_subject` rewritten on the shader, with the old tile grid kept as `style: "tiles"`.
- **Done when:** the `hook-subject-reveal` recipe on the user's own talking-head clip matches the reference opening sheet beat for beat:
  - plate before the seed
  - seed at the face
  - top-to-bottom cascade
  - tint cools
  - the title sits behind the hand
  - frame-to-card at the phrase end

  This is judged side by side with `reveal_01..03.jpg`.

### Phase 3: Typography engine (2 weeks)

- Glyph layout, animators, range selectors, transcript binding, rich spans, presets.
- Captions render through it, which retires the libass limits for animated text.
- **Done when:** the "is not difficult", "obviously, a beginner is *going to* get ~scared~" and strike-and-swap shots are reproducible from a transcript with one tool call each.

### Phase 4: 2.5D + camera (2 weeks)

- 3D transforms, camera layer, depth of field, depth sorting, 3D motion blur.
- Wire in the parts of the untracked `src/lib/scene3d.ts` that fit (camera math, keyframe tracks). Drop the Blender bridge.
- **Done when:** `card-wall-3d`, `hex-roadmap` (camera into hex) and `numbered-lanes` (truck between lanes) render with parallax and blur in export.

### Phase 5: Effects library (3 weeks, parallel with 3–4)

- Every §3.5 effect in WGSL, with a parameter schema, presets and a test image per effect.
- **Done when:** each effect has a golden-frame test, and the reference showcase (pixel sort, deep glow, liquid glass) is reproducible.

### Phase 6: Motion kit v2 (2–3 weeks)

- The §3.7 templates as native layer graphs, brand-kit aware, with SFX cues.
- The §4.3 recipes.
- **Done when:** each template has a golden-frame test at 3 aspect ratios, and the AI can build a 60 s explainer in the reference style using only recipes.

### Phase 7: Tracking (2 weeks)

- CoTracker3 / planar / face tracking, nulls attached to tracks, stabilisation, screen replacement.
- **Done when:** a callout line stays pinned to a moving hand, and a phone screen replacement holds for 5 s without drift.

### Phase 8: Pro UX (parallel, 3 weeks)

- Layer switches (3D, motion blur, blend, matte, parent) in the timeline, an effect-controls panel with keyframe toggles, a graph editor (value and speed curves, AE influence handles) and a mask pen with bezier handles.
- **Done when:** a user can hand-build the opening shot without the AI.

### Phase 9: AI director polish (ongoing)

- Profile-aware planning.
- Technique QA.
- An automatic SFX layer from template cue points.
- A reference re-analysis loop: render → analyse own output → compare to profile → fix.

**Critical path:** 0 → 1 → 2 gives the headline shot, in about 7 weeks.
Phases 3, 4 and 5 can run in parallel after Phase 1 lands.

---

## 6. Benchmark: "Reference recreation suite"

This is a fixed set that every release must pass. The input is the user's own
footage plus the brand kit, and the output is compared side by side with the
sheets in `docs/research/motion-reference/`.

| # | Shot | Reference | Techniques |
|---|---|---|---|
| B1 | Subject reveal hook + frame-to-card | 0:00–0:03 | T1 T2 T5 T7 |
| B2 | UI card wall + kinetic words | 0:02–0:06 | T6 T7 |
| B3 | Big number behind subject + grade hit | 0:30–0:34 | T27 T20 T17 |
| B4 | Cut-out profile with callouts | 1:38–1:53 | T3 T4 |
| B5 | Hex roadmap into chapter | 0:53–0:58 | T9 |
| B6 | Ribbon title → glass pillar card | 2:38–2:58 | T10 T11 |
| B7 | Numbered lanes with camera truck | 5:40–6:10 | T12 |
| B8 | Blurred-speaker sentence with strike-and-swap → zoom tunnel | 8:15–8:22 | T8 T19 |
| B9 | Stylised b-roll with halation + script accent | 0:15–0:18 | T21 T7 |
| B10 | Split rules panel | 9:48–10:12 | T15 |

Each benchmark passes when all of these hold:

- the technique checklist is present
- no QA failures
- export frames equal preview frames
- the AI built it from a one-line brief plus the footage

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| WebGPU missing or buggy on a user's GPU driver | Capability check + existing DOM/FFmpeg path. Keep the FFmpeg exporter alive until parity is proven. |
| WebCodecs can't decode a source codec (ProRes, some HEVC) | Proxy transcode job (all-intra H.264 or ProRes→H.264) on import. |
| Model licences (ProPainter, MatAnyone, CoTracker non-commercial; RVM GPL) | Optional user-installed models with the licence shown. Commercial-safe defaults. |
| VRAM pressure (4K, many layers, motion-blur samples) | Texture pool with LRU, half-res preview toggle, adaptive motion-blur samples in preview (full in export). |
| Project format churn | Versioned schema, `v1→v2` migrator, Rust mirror (`project.rs`) updated in the same change, round-trip tests. |
| Scope creep toward "rebuild AE" | Benchmarks drive scope. A feature ships when a benchmark needs it. |

---

## 8. Immediate next steps

1. Phase 0 tool + profile (small, unblocks the AI planning in this style now).
2. Phase 1 spike (3 days): WebGPU executor that draws one video layer + one text layer + a glow, both in preview and in an exported MP4 via WebCodecs. This proves the core bet before the model migration.
3. In parallel, a cheap win on today's stack: rewrite `cubes-reveal` to mask the tiles by the subject matte and seed them from the subject box top. This is possible now as an export-time FFmpeg `alphamerge` of a quantised matte. It gets roughly 70% of B1 in days, while the shader version lands in Phase 2.
