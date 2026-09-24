# Helios today: what the motion engine and the AI can already do

Brief for the video-study agents (2026-09-24). The full references are `docs/MOTION-ENGINE.md` (the engine),
`src/motion/types.ts` (the scene model) and `docs/WORLD-CLASS-PLAN.md` (the roadmap). Read those when
a question needs more than this page.

## The product

Helios is a Tauri desktop video editor (React + TypeScript front end, Rust back end, Python workers in
`src-tauri/workers/`). The user edits by chatting with an AI agent that calls about 133 tools
(`src/lib/ai-tools.json`, implemented in `src/lib/aiTools.ts`, `src/lib/motionTools.ts` and in Rust).
The goal is that the user types something like "make a 30 s SaaS launch video for my app" and gets
a film at the level of the reference videos. If there is footage on the timeline, the AI uses it.
If there isn't (a pure SaaS explainer), the AI has to build everything from shapes, text, icons, UI
mock-ups, 3D and generated assets.

## The motion engine (`src/motion/`)

- **What it is:** a WebGL2 compositor in After Effects terms. The same code draws the preview and the export.
- **Scene:** a `MotionScene` is JSON: `{ width, height, duration, background, layers[], motionBlur, cues[] }`.
  - Layers are listed bottom to top.
  - Units are pixels, with the origin at the top left. Angles are in degrees, opacity runs 0–100 and time is in seconds.
- **Animatable values:** any value can be a literal, keyframes `{k:[{t,v,ease}]}` or an expression `{expr}`.
  - Eases: linear, hold, sine, cubic, quart, expo, back, elastic-out, bounce-out, spring, or cubic-bezier `[x1,y1,x2,y2]`.
  - Expressions: wiggle, loopOut/loopIn, valueAtTime, linear/ease, random/noise, posterizeTime.
- **Layer types:**
  - `footage`: video or image, with an optional roto matte and cut-out.
  - `solid`.
  - `procedural`: crimson-stage, radial-glow, linear-gradient, hex-field, grid, light-rails, noise, light-leak, dots, aurora.
  - `shape`:
    - Kinds: rect, ellipse, polygon, star, path, line.
    - Paint: a fill or a linear/radial gradient, stroke, dash and trim paths.
    - A repeater makes copies with a cumulative offset.
    - Paths are point lists with straight segments. `curve:true` rounds corners into quadratics. There are **no bezier handles**, no compound paths or holes, and no SVG path import.
    - Points can be keyframed, which gives a crude morph when the point counts match.
    - Shapes are rasterised with Canvas2D and uploaded as textures.
  - `text`:
    - Per-glyph engine with AE-style range-selector animators (position, scale, rotation, opacity, blur, tracking, fill, skew).
    - `cascade` (a timed per-char/word/line entrance with an exit), `counter` (a rolling number) and `reveal` (a typewriter).
    - Rich spans.
  - `null`: a parent for other layers.
  - `camera`: AE one- or two-node camera with depth of field.
  - `precomp`: a nested scene, up to 6 deep.
- **Per layer:**
  - Timing and rigging: in/out, parent, threeD (a 2.5D planar layer in camera space, like AE 3D layers).
  - Transform: anchor, position, scale, rotation, rotationX/Y, opacity, skew.
  - Compositing: 17 blend modes and a track matte (alpha, luma and inverted).
  - Masks: rect, ellipse or path, with feather and expansion.
  - Motion blur, frosted-glass `backdrop` blur and adjustment layers.
  - `startTime`/`timeScale`.
- **Effects (34):**
  - Glow and blur: glow, gaussian, directional, zoom and lens blur, halation.
  - Colour: chromatic aberration, rgb-split, vignette, grain, tint, duotone, b&w, brightness-contrast, hue-sat, levels, exposure, invert, fill, radial gradient overlay.
  - Shadow and edges: drop shadow, stroke, matte choke.
  - Stylise and distort: mosaic, pixel sort, displacement, turbulent displace, wave warp, lens distortion, light leak, liquid glass.
  - Matte FX: subject-reveal, matte-fill, matte-edge-glow.
- **Not in the engine:**
  - Shape structure: bezier path editing, shape groups (several paths in one layer with nested transforms), merge paths, offset paths, round corners on paths, twist or zig-zag operators, path morphing between different shapes, gradient strokes.
  - Animation and effects: puppet pins or bones, IK, particles, text on a path.
  - Import and 3D: Lottie/SVG import, true 3D meshes inside the motion engine, a 3D extrusion of shapes or text.
- **Templates:** 20 in `src/motion/kit/`, plus brand, fun and overlay variants:
  - `subject-reveal`, `hex-roadmap`, `glass-teaching-card`, `ribbon-title`, `numbered-lanes`, `diamond-list-pip`, `node-tree`
  - `frame-to-card`, `card-wall-3d`, `cutout-stage`, `split-rules-panel`, `stat-badges`, `dock-cursor`
  - `blurred-sentence`, `zoom-tunnel`, `social-card`, `demo-callouts`, `comparison-pair`, `grade-hit`, `big-number-behind`, `stylized-broll`

  They follow one motion grammar: blur + slide + fade entrances on expo-out, faster exits, motion blur on fast moves, and a sound cue on every event.
- **Layered comps:** an AI-made scene opens as "[Motion]" comps with one timeline clip per layer, which the user can move and restyle.
- **Safe area:** 5% at the sides and 6% top and bottom. It is judged where each layer rests and fitted automatically.

## Other graphics systems in Helios

- **HTML motion graphics ("[MOGRT]" / Crimson system, `create_motion_graphic`):** the AI writes HTML/CSS/JS, which is rendered frame by frame to PNG and composited. It has a library of 205 React Bits components plus Animate.css, Magic UI and Aceternity (`react_bits`), and 290 remotion-kit.com preset briefs (`remotion_kit`).
- **`create_stick_figure`:** a basic stick-figure tool. This is the only "character" capability.
- **Brand kits:** 13 tools that give palette, type, logo and archetype. `brandify.ts` puts templates on brand.
- **3D:** `src/lib/scene3d.ts` is an *unfinished, untracked* three.js scene model (primitives, text, model, lights, materials, camera with DOF). Its comments mention a Blender bridge `workers/blender_bridge.py`, but **that file and the runtime do not exist.** In effect, Helios has **no Blender integration and no real 3D today.** Blender 5.2 is installed on the dev machine at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- **Media generation:** local image and video generation models, TTS voiceover, free stock search (`find_free_media`), online research and scraping.
- **Audio:**
  - SFX library with `add_sound_effect`, whose cue types are whoosh, impact, chime, pop, riser and click.
  - `analyze_music_beats`, `snap_cuts_to_beats`, `level_audio`.
- **QA:** `run_frame_qa` renders frames and flags off-frame elements, safe-area problems, collisions and blank frames. `consult_council` has four AI reviewers.
- **Reference analysis:** `analyze_reference_video` measures cuts, shot lengths, palette and contact sheets. It measures **no** motion curves or easing, no per-element timing and no audio sync.
- **Tracking:** `track_motion` (OpenCV LK point/planar tracks).

## The bar

The user wants to be able to make every one of the 9 reference videos in Helios by chatting with the
AI. Anything the engine or the AI can't do yet is a gap for the plan. Treat Blender (headless:
`blender -b -P script.py`) as available to the plan for anything that needs real 3D.
