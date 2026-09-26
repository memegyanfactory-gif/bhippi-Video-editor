# Drawn styles: a hand-made motion library for any AI

Goal: any AI working in Bhippi can make films that look like five reference films. They are
risograph worlds, a pen that draws the world, pencil and crayon sketchbooks, cut-paper
collage, and a neural "scope" panel. The AI works with one library of looks, drawable motifs,
characters, transitions and templates, plus a playbook that tells it how to use them.

Everything is data (JSON in the scene), drawn per frame from a seed. So:
- the preview, a scrub and the export are identical;
- no code is evaluated;
- any AI (or a person) can write it, read it back and edit it.

## 1. What the films are, frame by frame

Five films, 3,012 frames, all 1:1. Contact sheets of every frame and stats on how much each frame
changed from the one before were made (`ffmpeg`, then a per-frame mean absolute difference at
180 px).

### Film 1: "Riso worlds" (28 s, 24 fps, 672 frames, mostly on ones)
- **Paper.** Warm off-white paper (#efe9df) with faint fibre grain. Every picture is three or four riso inks
  (blue #2f6fb0, fluorescent pink #ff48b0, yellow #ffe800, violet/indigo #3a3a9a). Each ink is a
  halftone dot screen at its own angle. The inks are multiplied onto the paper, and each ink is
  slightly out of register (a few px), so colours fringe at the edges.
- **Ripples.** Frames 1–36 start from a single indigo dot in the centre. Ink-drawn rings grow out of it: a
  ring reaches full size in about 4–5 frames, a new one starts every 4 frames, and the rings thin
  as they grow. Short curved "sound" arcs drift in from a corner.
- **Iris.** Frames 37–48: a disc opens out of the dot (0 → full in 4 f) onto a riso "world" (a koi pond),
  holds about 7 f and closes back into the dot in 3 f.
- **Accelerating montage.** Frames 109–400: full-frame worlds with the dot kept in the centre: owl, bell, lighthouse, wolf,
  telephone, record player, frog moon… A world holds 12 f, then 6 f, then 3 f: the montage
  accelerates. Frames 337–384: the same worlds again, re-inked in a new ink set (palette swap) with a
  thin ring pulsing around the centre dot.
- **Mandala.** Frames 385–425: every world shrinks into a small disc on concentric rings (a radial "mandala"
  grid). The grid then re-inks to a single blue ink and collapses back into the dot over about 15 f.
- **Two dots.** Frames 433–552: a pink dot enters with a halftone glow from a corner. Blue and pink dots each emit
  rings; where the rings cross, small yellow sparks appear; a halftone flower blooms between
  them.
- **Duotone cuts.** Frames 553–576: worlds again as pink/violet duotones, 3 f each.
- **Starfield.** Frames 577–624: a deep indigo starfield, grainy and noisy; the two dots orbit each
  other while many small ringed dots gather.
- **End card.** Frames 625–672: on the paper, "opus 5" writes itself on in a rounded hand, about 2 f per letter.
  Then "claude" writes on under it, about 1.5 f per letter. It holds, fades out over 4 f, and
  leaves the dot.

### Film 2: "Two cubes" (3.4 s, 25 fps, stop-motion look)
- Two soft-shadowed orange cube creatures and a pencil, on a warm tabletop, with a slightly jerky
  stop-motion cadence (on twos with holds).
- One creature draws the other as a thin pencil outline. The outline fills in and becomes a solid
  creature.
- Faces switch between `^ ^`, `> <` and dot eyes.

### Film 3: "Scope" (13 s, 30 fps)
- Split screen: live footage on the left (a device, a hand, a fruit fly composited in AR). On the
  right, a black panel with a glowing, colour-coded point-cloud "brain" and two thin signal traces
  below it (mint and peach).
- A trace spikes in 1 frame and decays over about 8 f; the brain lights up (orange/pink regions)
  in sync with the spikes.

### Film 4: "The pen draws the world" (49.6 s, 24 fps; 40% of frames held, mostly on twos)
- **Look.** A coloured-pencil / crayon storybook: sky bands filled with hatched crayon strokes,
  flat hills, a dark ink outline with slight wobble, and paper tooth everywhere.
- **The pen.** A big dip-pen nib (a wooden handle with a steel ferrule) is always in frame, and it draws
  whatever appears.
- **Construction.** Frames 49–150: blue construction lines on graph paper (guide circles, a centre
  cross), with crosshatched scribbles at the edges. The nib then draws the creature's outline stroke by
  stroke, following the nib tip exactly. Fill is crayon hatching swept diagonally across the
  shape in about 5 frames. Then legs, arms and eyes are added.
- **Sparkle.** A sparkle star pops above the head with little radiating ticks.
- **Faces.** Faces are replaced instantly: dots, `^ ^`, `> <`, closed `– –`, spiral eyes (dizzy).
- **Torn-paper wipe.** Frames 47, 259, 889–906: a jagged torn paper edge sweeps across in about 6 f, revealing
  the next world.
- **Constellation.** Frames 339–438: the nib connects stars into a figure of the creature; lines draw
  on; stars flash with rays.
- **Generative sketchbook.** Frames 439–484: rose curve, nautilus spiral, snowflake,
  spider web, Lissajous and dandelion, each drawn by the nib on its own felt-coloured ground (teal,
  violet, green, plum, navy). Each shows for 5 f, then repeats at 2–3 f.
- **Squash and stretch.** Frames 485–600: the creature falls, loses a leg (a separate piece), and the pen redraws
  it; squash and stretch on the landing.
- **Final world.** Frames 900–1189: back to day. The pen adds details one by one (butterfly, flowers,
  paper boat, kite, cloud, rainbow), each popping with a small spark. "opus 5" is written by hand
  on a torn paper label.

### Film 5: "What do you love?" (28 s, 24 fps, 47% held frames = on twos)
- **Look.** Cut-paper collage:
  - every shape has a torn white paper border;
  - fills are felt-marker streak textures;
  - some parts are cut from newspaper or sheet music (printed-line textures inside a shape);
  - backgrounds are felt/crayon-streaked flat colours.
- **Hand lettering.** The note paper is lined, and the text is hand-written in blue.
- **Word montage.** The words cut on a strict grid: every 12 frames = 0.5 s = 120 BPM ("words",
  "music", "the sea", "trees", "dogs", "bread", "rain", "math", "the stars", "octopus", "tea",
  "flowers", "cats").
  - Every card pops on its first 2 frames, drawn slightly larger with radiating tick lines around
    it, then settles.
  - The word writes itself on in a rounded hand over about 6–8 f.
- **Characters.** A girl in a window and a sun-sprite (a circle with 12 torn-paper tentacle rays
  and a face). Paper planes leave dashed trails.
- **Boil.** Everything boils at 12 drawings a second.

## 2. What Bhippi already has, and what it lacks

The GPU motion engine (`src/motion/`) already does:
- AE-style layers and keyframes, eases and expressions;
- masks and track mattes, blend modes, precomps;
- a sequence builder with 27 transitions;
- Canvas2D particles and characters;
- shape trees with trim paths;
- bundled fonts, including **Caveat** (a hand).

It has no:
- print media (halftone, riso plates, misregistration, paper);
- hand-drawn media (wobble, boil, hatching, crayon, torn paper);
- on-twos timing;
- pen tool that follows a line as it draws;
- generative line motifs;
- hand-written text that writes on;
- torn-paper or iris-from-a-dot transitions;
- direction for any of the above.

## 3. The library (what gets built)

### 3.1 `drawing` layer (`src/motion/ink/`)

A new layer type: `{type:'drawing', drawing: DrawingData}`. Like `particles`, it is drawn with
Canvas2D per frame and uploaded as a texture, so it composites like any layer: masks, mattes,
blend, 3D, effects.

```jsonc
{ "type": "drawing", "drawing": {
  "look": "riso",            // riso | crayon | ink | pencil | cut-paper | felt | flat | scope
  "inks": ["#2f6fb0", "#ff48b0", "#ffe800"],   // riso plates / look palette
  "paper": "#efe9df",        // null = transparent (overlay on footage)
  "step": 2,                 // on twos: the drawing changes every 2 frames (24 fps)
  "boil": 1.2,               // px of line wobble re-seeded each step
  "seed": 7,
  "items": [ /* DrawItem[] */ ] } }
```

- **Items.** Each item has `kind`, placement (`at`, `size`, `rotation`, `scale`, `opacity`, all animatable `Prop`s),
  `in`/`out`, colours (`fill`, `stroke`, `width`), and a riso plate (`ink`: index).
- **Motion verbs** on every item:
  - `draw`: 0→1, the stroke draws on and the pen can follow its tip;
  - `fillIn`: 0→1, the fill sweeps on as hatching or a wipe;
  - `pop`: a time; the item appears big with burst ticks for 2 steps, then settles;
  - `wiggle`.
- **Item kinds.** There are six families:
  - **Primitives:** `circle`, `ellipse`, `rect`, `polygon`, `star`, `line`, `path` (SVG d), `blob`
    (seeded organic shape), `icon` (any of the 2,114 Lucide icons, as hand-drawn paths).
  - **Motifs** (Films 1, 4, 5): `ripples`, `rose`, `spiral`, `snowflake`, `web`, `lissajous`,
    `dandelion`, `sparkle` (an 8-point star with ticks), `burst` (radiating ticks), `constellation`,
    `stars`, `waves`, `hills`, `sun`, `moon`, `cloud`, `flower`, `tree`, `grass`, `rain`,
    `planet`, `heart`, `trail` (dashed flight line).
  - **Characters:** `bot` (the cube creature: faces dots/happy/squint/closed/dizzy/wide;
    arms, legs, squash) and `sprite` (the sun-sprite with tentacle rays, face and cheeks).
    Faces are keyed with `faces: [{t, face}]`.
  - **Type:** `write`, hand-lettered text (Caveat or any font) that writes itself on, letter by
    letter, with a sweeping stroke clip; `note`, lined note paper with a torn edge.
  - **Tools:** `pen` (dip nib, pencil or brush) follows the tip of whatever is being drawn and
    rests between strokes; `construction` draws guide lines, circle and cross on graph paper.
  - **Scope** (Film 3): `trace` (a signal line with spikes at given times, 1 f rise, 8 f decay)
    and `cloud` (a glowing point cloud whose regions light up on the spikes).

### 3.2 Looks (the medium)

Looks are rendered per item, then per frame:

- **`riso`:** Items go to ink plates, and each plate's coverage is drawn in grey.
  - The GPU screens each plate into halftone dots at its own angle and pitch.
  - Each plate is offset by `misregister` px, with a per-step `tremor`.
  - Plates are multiplied onto the paper, with low-frequency mottling and fibre grain.
  - The screen is pinned to the page so it never swims (the kit's rule).
- **`crayon`:** fills are clipped bundles of semi-transparent hatch strokes (angle jitter, a
  2-tone mix), outlines in dark ink with wobble, and paper tooth.
- **`ink`:** pressure-shaped contours with boil, no fill texture.
- **`pencil`:** several faint interrupted passes and graphite grain.
- **`cut-paper`:** a torn white paper rim (jagged offset outline) under every shape, a felt
  streak texture in the fill, a soft contact shadow, and an optional `print` texture (newsprint
  lines or music staff) inside.
- **`felt`:** flat colour with directional marker streaks (the backgrounds of Film 5 and Film 4's
  sketchbook).
- **`flat`:** clean fills (for mixing).
- **`scope`:** additive neon strokes on dark, with glow.

### 3.3 `riso` and `halftone` effects (for any layer, footage included)

- **`riso`** (GPU): splits a layer's colour into 2–4 inks. It solves the multiply decomposition
  per pixel, then screens, misregisters, mottles and multiplies onto the paper. With it, any
  footage, logo or shape can be printed like Film 1.
- **`halftone`:** a single-ink dot screen by luminance.

### 3.4 Templates (`kit/drawnTemplates.ts`, used by `create_motion_scene`)

| id | from | does |
|---|---|---|
| `riso-ripple-open` | Film 1 | dot → ripple rings → iris into a riso world → close back to the dot |
| `riso-world` | Film 1 | one full-frame riso vignette: `sunrise`, `night`, `pond`, `bloom`, `sea`, `garden`, `cosmos`, `orbit`, or your own items |
| `riso-montage` | Film 1 | N worlds cut on an accelerating schedule (12 → 6 → 3 f) with the centre dot, optional palette swap |
| `pen-draws` | Film 4 | construction lines → pen outlines a subject (bot, icon or SVG path) → crayon hatch fill → sparkle pop |
| `sketchbook` | Film 4 | generative motifs drawn by the pen on felt grounds, cut every N frames |
| `constellation` | Film 4 | the pen joins stars into a figure (points or an icon's outline) |
| `paper-words` | Film 5 | a beat montage of cut-paper cards: icon + hand-written word, pop + ticks, on twos, at the music's BPM |
| `paper-note` | Film 5 | a hand holds up lined note paper; the question writes itself on |
| `hand-title` | Films 1, 4 | a title writes itself on by hand, with the dot(s), holds, fades |
| `scope-panel` | Film 3 | a dark data panel: glowing cloud + spike traces synced to times |

### 3.5 Transitions (sequence builder)

- **`paper-tear`:** a torn edge sweeps across in about 6 f (Film 4).
- **`iris-dot`:** the next beat opens out of a dot (Film 1).

### 3.6 Direction: the AI-facing half

- **`motion_guide {topic:'hand-made'}`:** a new playbook with every timing measured above:
  - on twos (and when not to use them);
  - pop in 2 steps;
  - write-on at 2 f per letter;
  - montage acceleration 12 → 6 → 3;
  - cuts on 12 f at 120 BPM;
  - torn wipe in 6 f;
  - riso ink sets and their overlap colours;
  - the knockout rule;
  - one medium per film.
- **`list_drawn_styles`:** the full catalogue as data. It lists looks, ink sets, item kinds with
  their params, motifs, characters and faces, templates and transitions, so an AI can build its own
  drawings from parts, not only from templates.
- **Validation:** unknown kinds, looks, faces and inks come back as clear errors.
- **Prompt:** `copilot.md` teaches the `drawing` layer in one paragraph and points to the tool and
  the guide.
- **Doc:** `docs/DRAWN-STYLES.md` is the human reference.

### 3.7 Checks

- **Unit tests:**
  - every item kind draws something;
  - drawings are deterministic;
  - on-twos quantisation;
  - the pen follows the tip;
  - the write-on letter count;
  - validation;
  - every template at landscape and portrait (the existing kit tests pick them up);
  - the playbook cites only things that exist.
- **GPU check:** Motion Lab contact sheets of each template in headless Chromium, compared by eye
  with the reference frames.

## 3.8 Working with the Character Studio (branch `claude/busy-tesla-hcf401`)

Another agent is building a 2.5D rigged Character Studio: 360° turns, look-at, and hand-inked
brush-stroke lines with boil on twos, so far as prototypes in `docs/character-studio/`. The two
pieces share craft, so they share code rather than duplicating it:

- **Shared primitives.** `src/motion/ink/core.ts` is the hand-made primitive layer:
  - `drawingClock` (ones, twos, threes and the drawing index);
  - `wobble` (boil re-seeded per drawing);
  - `ribbon` (pressure/brush-width outlines);
  - `tornEdge`, `noise1`/`noise2`, `rng`/`hash`;
  - `separate` (riso ink split).

  Character renderer v2 can draw its outlines through `ribbon` + `wobble` with the same boil
  seed, so a character boils in step with a drawn world.
- **Look parity.** A `drawing` layer's `look` and `step`/`boil` are the knobs a character layer
  should honour too. A character placed in a riso or crayon world then reads as the same medium.
  The Character Studio can take `look` from the drawing it stands in.
- **Placement.** Characters stay their own `character` layer (rig, poses, lip sync). The drawing
  layer's simple `bot` and `sprite` are one-liners for mascots in the hand-made films, not a
  second rig.

## 4. Order of work

1. Plan (this doc) ✅
2. `ink/` core: rng/noise, wobble/boil, hatch, torn edge, paper, on-twos clock, the item model and
   its evaluation.
3. Item kinds: primitives, motifs, characters, write, pen, construction, scope.
4. Looks and the GPU riso compositor for `drawing` layers; the `riso` and `halftone` effects.
5. Engine wiring: types, validate, evaluate (size), renderer, measure/safe area.
6. Templates and transitions.
7. AI tools, playbook, prompt, docs.
8. Tests, Motion Lab sheets, fixes.
