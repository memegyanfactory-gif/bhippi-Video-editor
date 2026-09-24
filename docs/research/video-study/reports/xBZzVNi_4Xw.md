# xBZzVNi_4Xw: "hi, aflow." brand identity film

*Video study report, 2026-09-25. **The user marked this film IMPORTANT.***

- **Source:** `out/xBZzVNi_4Xw/src/xBZzVNi_4Xw.mp4`. It runs 46.47 s: 1394 frames at 30 fps, 1920×1080, music only.
- **Primary source:** the previous analyst's frame-by-frame notes (`out/xBZzVNi_4Xw/notes.md`), plus `analysis.md`, `measure_moves.json` and `measure_pen.json`.

**What this pass added:**
1. **Frame checks.** I verified the key claims on **20 frames** (f8, 45, 64, 170, 246, 262, 398, 402, 445, 631, 647, 665, 714, 715, 880, 955, 1020, 1060, 1200 and 1216), shown as 4 contact montages. I also used the analyst's existing `hires/drop_crops.png` (f805–818) and the Blender `proof_sheet.jpg`.
2. **Numeric re-tracking** of the pen loop, the portal rings and the drop. This needed no extra viewing.
3. **A new audio beat grid** from `audio.wav`: multi-band spectral flux, autocorrelation, and a circular fit of the tatum.

**Conventions:**
- Frames are 1-based: f1 is t = 0.000, and frame f shows t = (f−1)/30.
- Pixels are at 1080p unless stated.
- Musical positions are written as DAW `bar.beat.sixteenth`, all 1-based. For example, `6.1.3` is the "&" of beat 1 in bar 6.

---

## 1. What the film is

**The idea.** A 47-second identity film for "aflow". The brand is a **blue orb**: the full stop of the wordmark `aflow.`. The film is that orb's journey through a sequence of worlds, and the wordmark appears only in the last 7 s.
- There is no copy, no voice-over and no UI text to read.
- The film is a **continuity-object film**: the orb is in every shot except the final illustration. Each shot's exit sets up the next shot's entrance:
  - it flies *into the lens*, and the next frame is its own blue;
  - it flies *into the light*, and the frame whites out;
  - it shoots up out of frame, and the next shot has it rising from below.
- The orb has **four material states:**
  1. **"Iris":** saturated blue, glossy, with flat decals sliding across it (act 1).
  2. **"Pearl":** a frosted white shell with a glowing blue core (the drop, the echo capsule, the ring).
  3. **"Capsule":** stretched into a white pill by its own echo trail.
  4. **"Light column":** the echo trail becomes a pillar of light (the tunnel).

  At the end it becomes the periwinkle full stop of the wordmark. The palette tokens are in §5.

**The music.** One track at exactly 90.0 BPM. At 30 fps that gives a **beat of 20 frames, a 16th of 5 frames, a bar of 80 frames and a 4-bar phrase of 320 frames** (10.67 s). The three biggest world changes sit exactly on the three phrase lines inside the music (§6).

**How it is made.** I classified each shot from the frames I checked (§2 has the per-shot table). The film is **not mostly real 3D.**

| Class | Frames | Share of runtime | Shots |
|---|---|---|---|
| 2D (After Effects shape/solid work) | 599 f | **43 %** | rise and streaks, echo capsule and white-out, UI world (flat part), horizon drop, illustrated logo world, end card |
| 2.5D (flat layers in a 3D camera, fake-3D sphere) | 274 f | **20 %** | iris orb in the vesica, portal-ring dolly loops, flat→3D match transform |
| 3D-rendered look | 521 f | **37 %** | sphere bouquet, lavender space, UI-card ring, panel tunnel, phone light fountain |
| …of which truly needs a renderer (refraction, curved translucent occlusion, volumetrics) | 378 f | 27 % | bouquet, lavender space, tunnel, phone |

- The 3D shots are the "drop" worlds, the big moments. The 2D/2.5D shots carry the identity: the orb, the lens, the pen, the drop and the logo.
- Every 3D shot has **2D light work layered on top** (star glints, lens rings, echo trails and bloom).

**Why it matters for Helios.** This is the template for a **brand identity film generator**. A brand kit gains a *hero object*. A music track sets the phrase structure. A fixed act grammar (birth, rise, drop-world, product, platform, resolve, logo) is filled with 2D templates and headless-Blender presets. §7 specifies it.

---

## 2. Beat-by-beat breakdown (with beat numbers)

**Bar numbering.** Bar 1 beat 1 falls at t = 0.231 s (f7.9). Bar *n*'s downbeat is at frame 7.9 + 80(*n*−1). The drops are at **bar 3** (f168) and **bar 11** (f808). Phrase lines are at bars 3, 7, 11 and 15.

**Build classes:** 2D = After Effects shapes and solids; 2.5D = flat layers in a 3D camera, or a fake sphere; 3D = rendered.

| # | Frames (time) | Bars | What happens | Build |
|---|---|---|---|---|
| 1 | f1–67 (0.0–2.2 s) | intro, bar 1 | Black. Two large circles (Ø ≈ 690 px, 2 px stroke with an RGB fringe) **draw on by a chasing trim** (f1–17) and form a **vesica "eye"**. The orb is its iris. It appears at f3 as a 12 px dot and grows to **Ø 545 px (0.50 H) by f63**: a slow push that speeds up from f55. Flat decals (teal disc, white disc, pink dot, white pill) **slide and foreshorten** across it (the sphere turns about 90°). A white rim crescent grows on the right (f49–64). The circles erase and rotate away (f55–67). | 2.5D |
| 2 | f63–165 (2.1–5.5 s) | bars 1–2 (riser) | **Fall-away.** Ø 545 → 65 px in 25 f and down to 0.94 H. The decals fade and the orb becomes a "pearl" marble. The background lifts to navy `#070613`. The marble **rises with a tapered comet trail** (f81+) through 1 px vertical speed streaks. Blurred blue light bands flicker from f140 as energy builds. The orb speeds up at f161–165. | 2D |
| 3 | f166–242 (5.5–8.0 s) | **bar 3 = DROP 1** (cut −1.9 f) | **Sphere bouquet.** About 14 glossy spheres (matte gradient, clear thin-film bubbles, dark navy with a rim, cyan, a pink pearl) sit on a dark plate. A 4-point **star glint** with an anamorphic streak sits top-centre, with a V light cone behind. There is a slow push (×1.04) and parallax drift. At f225–242 the camera **tilts up 0.5 H in 17 f (ease-in) while the spheres defocus to bokeh**; the glint stays sharp. | **3D** + 2D glint |
| 4 | f243–351 (8.1–11.7 s) | cut on 3.4.4, the pickup to bar 4 | Blue sky gradient. The orb **shoots up in 4 f** and lands on the bar-4 downbeat (f247). It leaves an **echo capsule** of about 3 orb copies merged into a white pill, which compresses into the orb (f249–274) and fades (f275–280). The orb floats with a **jelly wobble** (3–5 % non-uniform scale, rotating axis). It drifts toward the camera while a light source top-right floods with bloom and rays. A **volumetric shadow wedge** streams behind the orb (f329–351). The orb **flies into the light** (shrinks to 12 px in 14 f). | 2D |
| 5 | f352–385 (11.7–12.8 s) | bar 5 | **White-out.** 13 f of pure white (f352–364), then a lavender world fades up over about 20 f. A small **lens crosshair** (ring + full-width horizontal line + short vertical line) sits top-centre. | 2D |
| 6 | f386–485 (12.8–16.2 s) | 5.4.1 → 7.1.1 | **Portal-ring accelerando.** A navy ring with a gradient-faded stroke and a white bloom core **dollies at constant speed toward the lens**. The loop restarts on the 16th grid in the rhythm **3-3 · 2-2-2 · 1-1-1 → downbeat**. There are flash frames with faint white panels, and the nested rings multiply (2 → 5). Detail in §6. | 2.5D + edit |
| 7 | f486–578 (16.2–19.2 s) | **bar 7** (cut −1.8 f) | **Lavender space.** Blue gradient spheres, a two-tone orange "planet", **tumbling glass shards**, a big iridescent bubble, a sunburst and an anamorphic arc. The camera trucks left→right with a roll of −11°. The orb recedes into the bubble (it refracts), leaves a light-cone trail and shoots up-right. An orange UI card slides across the bottom (f548–556), foreshadowing the next world. | **3D** |
| 8 | f579–622 (19.3–20.7 s) | cut 8.1.3 → pop on 8.2.1 | **UI world.** Soft lavender with a huge defocused purple sphere as a depth anchor. The orb enters from the left **with a smear** in 3 f and settles with about 5 % overshoot. A frosted **glass browser window pops**: width 37 % → 100 % in 10 f. Its title bar **flickers through the palette** (orange → red → white → the brand gradient). The orb glides into the window as the "cursor". | 2D |
| 9 | f623–713 (20.8–23.8 s) | bars 8–9 | **Orb as pen tool.** The orb loops a circle (Ø ≈ 414 px) in 40 f. A 1 px stroke trims on behind it and anchor dots pop at the quadrants. It is a **momentum loop**: fast across the top, slowest at the bottom right on the **bar-9 downbeat** (f646–651), fast to close. At f665 the circle **fills with an orange gradient and an 8-handle bounding box**, and the orb zips out with a smear. It swoops back, grows 2.4× with 10–15 % squash along its travel, and sinks into the disc. | 2D |
| 10 | f714→715 (23.8 s) | 9.4.2 | **Flat → 3D match transform** in one frame. The flat disc becomes a shaded sphere (pale yellow → orange → red terminator, with white rim and glint streaks). The bounding box becomes a **wireframe cube**, and the window swings into perspective (about 20°). The cube draws off (trims) over f720–728. | 2.5D |
| 11 | f715–791 (23.8–26.4 s) | bar 10 | A 3D hold with a slow drift while the orb bobs. At f783–791 the **orb flies into the lens** (Ø 226 → 1131 px in 8 f, hard ease-in) and its blue fills the frame. | 2.5D |
| 12 | f792–848 (26.4–28.3 s) | cut 10.4.2 → **impact 11.1.1** | **Black breath**, 12 f. The orb **drops as a white capsule** (h/w 2.0) onto a glowing horizon line. **Impact on the bar-11 downbeat (+0.2 f) = DROP 2** (+11 dB). The trail retracts, the orb rebounds 0.55 × Ø and touches again, then settles in 10 f **with no horizontal squash**. The line breathes. | 2D |
| 13 | f849–991 (28.3–33.0 s) | crane on 11.3.1 | The camera **cranes from horizon level to a ¾ view** and pushes in (scene ×4 in 16 f, ease-out). A **ring of about 6 UI cards** (textured planes) stands around the orb on a platform lit by its violet light pool. Slow orbit, then pull-back (×0.5 in 15 f), revealing an outer ring of about 12 dark slabs. The cards **lift off one by one** (stagger 4–8 f, about 10 f each, ease-in, from 12.3.4). The orb hovers, then **shoots up as an echo column** (the rhyme of shot 4). | 3D look; the planes are 2.5D-capable |
| 14 | f992–1097 (33.0–36.5 s) | cut 13.2.2; stutter 14.3.1–14.3.3 | **Violet panel tunnel.** The camera rises with the orb on a **light column** inside cylinders of curved panels (translucent violet, black, white, curved browser windows). The panels orbit at different radii and speeds and occlude the lens as wipes. Neon arcs (pink/cyan/green) circle the base and sparkles spiral up. **Panel passes come about every 10.3 f**, about the 8th-note rate, but they are **not phase-locked** (§6). **Jump-cut stutter** on 16ths (f1088, f1094), then a white flash (f1096–1097). | **3D** |
| 15 | f1098–1199 (36.6–40.0 s) | cut 14.3.3; break | Black. A **phone lies flat with a neon rim and a volumetric "tulip" light fountain** rising from its screen, with a star glint at the tip and a sparse star field. A huge translucent **lens-ghost ring** sweeps the frame. The camera moves in **three phases**: an expo-out pull-back (×0.62 in 24 f), a linear drift, then an accelerating exit into the cut. The music breaks down to −63 dB. | **3D** + 2D glint/ghost |
| 16 | f1200–1340 (40.0–44.6 s) | free-time final hit (+1.4 f) | **Logo by world-resolve.** The wordmark `aflow.` is *already* centred when the shot starts. The illustrated dawn world clears **out of a white bloom in 16 f** while the camera tilts down. Contents: a sun with a cross flare above the wordmark, translucent circles behind it (reads as the vesica bookend), clouds, a rainbow, streaks, a teal planet horizon, a misty city, a tiny figure on a glowing path, and a coral lily unfurling bottom-right (about 15 f). Grass sways with a period of about 1.5 s. The shot holds 4.1 s. | 2D |
| 17 | f1341–1394 (44.7–46.5 s) | tail | A white **end card**. The wordmark is alone at the same size and place (10.7 % of W) and static, held for 54 f (1.8 s). | 2D |

**Corrections to the notes that this pass made**

- **Orb size in act 1.** The orb peaks at **545 px, not 240 px** (measured f63).
- **Pen loop speed.** The pen loop is **not constant-speed.** Tracking puts 12 / 3 / 6 / 9 o'clock at f623 / f627 / f640 / f660, closing at f663: a fast-slow-fast momentum loop. The notes had 3 o'clock at f631 and 6 at f647. Frame f631 shows the orb already at about 120°.
- **The drop has no squash** (details in §4).
- **Tunnel sweeps.** They are about 10 f apart, not 8 f, and not locked to the grid.
- **The 120-BPM tempo is wrong.** It is an alias; the track is 90 BPM (§6).

---

## 3. Technique catalogue

**Status key:**
- ✓ = Helios can do it today.
- ◐ = partly, or by hand.
- ✗ = missing.

Pillars refer to REFERENCE-FILMS-PLAN §4. **NEW** marks something this report proposes.

| ID | Technique | Frames | Description | AE / C4D / Blender build | Helios status |
|---|---|---|---|---|---|
| A1 | **Vesica "eye" by chasing trim** | 1–17 draw, 55–67 erase | Two circles (r ≈ 345 px) whose overlap frames the orb. Trim start and end both move, so the stroke *sweeps* instead of growing from a point. 2 px stroke with an RGB fringe. On exit the lines erase and the eye rotates. | AE: 2 ellipse shape layers, Trim Paths (start/end/offset keyed, easy-ease), Channel Offset/RGB split. | ✓ (`trimStart/End/Offset`, `chromatic-aberration`) |
| A2 | **Iris orb: sliding spherical decals** | 3–68 | Flat decals slide across the sphere and **foreshorten at the limb** (the pill at f64). A rim crescent grows as the "light" swings. There is no shading on the decals: a flat, graphic 3D. | AE: CC Sphere on a precomp of flat decals (Rotation Y keyed) + a rim/inner-shadow layer. C4D: sphere + toon/flat texture. | ✗. P6 `solid2_5d` sphere with `decals` (in the plan). Needs `look:'flat-glossy'` and an animatable light (NEW detail) |
| A3 | **Push-in → whip fall-away** | 3–63, 63–88 | Slow scale-up that speeds up, then a whip shrink ×0.12 in 25 f with a 3 % undershoot. Reads as falling away into a new space. | AE: scale keys with a steep velocity-graph middle. | ✓ (keys + cubic-bezier) |
| A4 | **Comet trail + speed streaks + light bands (riser visuals)** | 77–165 | White→transparent tapered trapezoid under the orb (its length grows to about 330 px). 1 px vertical streaks with chroma. Blurred vertical bands flicker in from f140. | AE: gradient shape parented to the orb; CC Particle World or repeater lines; rects + Directional Blur with flickering opacity. | ◐ (shapes, gradient, directional-blur, wiggle ✓; `speed-lines` particles ✗, P5) |
| A5 | **Hard cut into a 3D world on the drop** | 166 | The first real-3D frame arrives on the phrase-1 downbeat, 1.9 f early. | Edit. | ◐ (the edit ✓; the 3D ✗, P7 `sphere-bouquet`) |
| A6 | **Star glint** | 166–242, 1098+, 1200+ | 4-point star with a long horizontal anamorphic streak (about 400 px) and a short vertical one (about 150 px). It breathes in scale. | AE: Optical Flares or VC Starglow; or a shape star + glow + directional blur. | ✗. P5 `star-glint`. Needs NEW **object tracking** (glint follows a 3D object via `objects.json`) |
| A7 | **Tilt-up rack-defocus handoff** | 225–242 | Content slides down 0.5 H in 17 f (ease-in) while lens blur ramps 0 → about 25 px. The glint stays sharp, so the light carries the eye into the cut. | Blender camera: rotation + focus distance keys. AE: Camera Lens Blur. | ✓ in 2D (`lens-blur`, keys); in 3D via P7 camera keys |
| A8 | **Echo capsule** | 243–280, 806–808, 988–990 | The orb leaves N copies that merge into a white pill. The pill compresses into the orb and detaches as a fading column. **The motif rhymes 3 times.** | AE: Echo (time −1 f, 6–8 echoes, decay 0.8) + a rounded-rect "trail" shape keyed to the orb. | ✗ `echo` (P5); the capsule shape ✓ |
| A9 | **Jelly wobble** | 281–300, 689–704 | 3–5 % idle, 10–15 % along the travel direction. The squash axis rotates. | AE: scale expression `[100+a·sin(ωt), 100−a·sin(ωt)]` on a null rotated along the velocity. | ◐ (expressions work). NEW `wobble` helper (S) |
| A10 | **Light flood + rays + volumetric shadow wedge → fly into light → white-out** | 301–364 | The key light blooms and radiates rays. A translucent wedge streams from the orb away from the light. The orb shrinks into the source and the frame burns to white for 13 f. | AE: CC Light Rays / Trapcode Shine; gradient wedge shape; white solid. | ◐ (glow, radial-glow, solids ✓; `god-rays`, `light-cone` ✗, P5) |
| A11 | **Lens crosshair motif** | 365–485 | Small ring + full-width hairline + short vertical: the orb seen *as a lens*. | AE: shapes + glow. | ✓ |
| A12 | **Portal-ring dolly loop** | 386–485 | A ring (navy 2–3 px, **stroke fading around its circumference**, white bloom core) approaches at **constant camera speed**. 1/r falls linearly (§4), so this is perspective, not an exponential scale. Nested rings multiply per loop. **Loops 1, 2 and 6 are the same move re-trimmed** (identical radii 269/328/421/585 px on their last frames). | AE: 3D ellipse layers + camera with **linear** z keys, precomposed; the edit trims the precomp shorter each loop. | ◐ (threeD shape + camera ✓, precomp offsets ✓; **gradient stroke ✗**, P1). NEW **`portal-accelerando` template** that reads the 16th grid (S) |
| A13 | **Flash frames** | 402, 418, 442, 452, 467, 472, 481; 1096–1097 | 1–2 white frames with faint rectangles (the next world's panels) at each restart. | White solid, add blend. | ✓ |
| A14 | **Floating-shapes space** | 486–578 | Parallax spheres, tumbling frosted-glass shards (20×80 to 60×200 px), a refracting bubble, a two-tone planet, an anamorphic arc and a sunburst. The camera trucks with a roll. | C4D/Blender: glass + DOF + camera truck. | ✗. P7 `floating-shapes` (+ glass); 2.5D fallback via P6 solids + threeD planes |
| A15 | **Orb smear** | 580–585, 665–667, 715 | The orb stretches into a white capsule along its velocity for 1–3 f, then settles with about 5 % overshoot. This is stylised, not shutter blur. | AE: a stretched copy or CC Force Motion Blur; scale along the velocity. | ✗. NEW `smear` (velocity stretch) (S) |
| A16 | **Glass-window pop with palette flicker** | 586–596 | Scale 0.37 → 1.0 in 10 f with a hard ease-out and no overshoot. The title-bar colour steps orange → red → white → the brand gradient over 5 f. Frosted: white 60 %, 1 px rim, backdrop blur. | AE: shape layers, Fill with hold keys, Fast Box Blur behind. | ◐ (pop + `backdrop` ✓; **shape `fill` colour is static in the schema**, so NEW colour keys (S); a real UI layer is P3) |
| A17 | **Orb as pen tool** | 623–665 | The stroke trims on behind the orb. Anchor dots (4 px) pop at the quadrants. **Momentum-loop speed profile** (§4). On close: an instant gradient fill + an 8-handle bounding box. | AE: path + Trim End keyed to the orb's path progress (or "Create Nulls from Paths"); dots pop in 2 f; fill by hold key. | ◐ (trim ✓; the orb cannot follow a path). NEW `followPath` / `pen-draw` helper (S–M, P1) |
| A18 | **Flat → 3D match transform** | 714→715 | A one-frame swap of like-for-like shapes: the flat gradient disc becomes a shaded sphere (+20 % size), the bounding box becomes a wireframe cube, and the window swings about 20° into perspective with visible thickness. | AE: swap layers + 3D camera move; cube as 12 3D strokes. | ◐ (threeD + camera ✓; radial gradient ✓). NEW P6 `solid2_5d` `shading: 0→1` morph for the disc, and a `wireframe-box` shape helper (S) |
| A19 | **Fly into the lens (object wipe)** | 783–791 | The hero scales to the camera on a hard ease-in (8 f). Its interior colour becomes the full frame, then the cut. | AE: 3D position/scale, ease-in. | ✓ |
| A20 | **Black breath before the drop** | 792–803 | 12 f of black, then a 4 f fall, so **cut → impact = 16 f** (about a dotted 8th). | Edit. | ✓ |
| A21 | **Stretch-only drop on a horizon** | 804–818 | Linear fall at 165 px/f as a capsule (h/w 2.0). **Width constant**; the trail retracts over 3 f; rebound 0.55 Ø in 4 f; second touch; rest at +10 f, floating about 15 px above the line. | AE: rounded rect with keyed height + y; horizon = line + glow + floor gradient. | ✓ by hand. NEW `drop-bounce` preset in `kit/common.ts` (S) |
| A22 | **Crane from horizon to a ring of UI cards** | 845–991 | Cards are **flat textured planes** on a ring around the orb, lit by its violet light pool. There are an outer ring of dark slabs, an orbit, a pull-back and a lift-off stagger. | C4D/Blender, or AE 3D layers + camera + radial-gradient floor. | ◐ **today as 2.5D** (threeD footage planes + camera; no per-plane lighting). Final: P7 `ui-card-ring` |
| A23 | **Echo shoot-up exit** | 977–991 | Anticipation hover, then the orb stretches into an echo column and leaves on the cut. | As A8. | ✗ (`echo`) |
| A24 | **Panel tunnel around a light column** | 992–1087 | Curved translucent panels at several radii and speeds occlude the lens (wipes). Neon arcs orbit the base; sparkles spiral up. The camera rises with the orb. | Blender/C4D: cylinder patches, emission curves, particles, motion blur. | ✗ P7 `panel-tunnel` (scene3d has a `neon-tunnel` preset to start from) |
| A25 | **Stutter jump cuts** | 1088, 1094 | Two re-starts of the tunnel on consecutive 16ths (6 f and 4 f), then a 2 f white bloom. | Edit. | ✓ by hand; NEW grid-aware scheduling |
| A26 | **Device + volumetric light fountain** | 1098–1199 | A phone flat on its back with a neon rim. A tulip-shaped translucent volume rises from the screen with a star glint at its tip. A lens-ghost ring sweeps. Three-phase pull-back. | Blender: device mesh + volume emission shell; 2D glint and ghost. | ✗ P7 `device-light-fountain` |
| A27 | **World-resolve logo** | 1200–1216 | The wordmark does **not** animate. The illustrated world **clears out of a white bloom in 16 f** around it, the camera tilts down, a lily unfurls and grass sways. The sun and translucent circles above/behind the mark bookend the opening vesica. | AE: exposure/glow keys over illustration layers; puppet or path for the lily; wave warp for the grass. | ◐ (exposure, glow, wave-warp, parallax ✓; illustration via image generation + layer split ◐; lily path morph ✗, P1). NEW `world-resolve-logo` template (M) |
| A28 | **Tiny end-card wordmark** | 1341–1394 | Width 10.7 % of W, static, held 1.8 s. The dot is lighter periwinkle: *the orb*. | — | ✓ (`brand-end-card`) |
| A29 | **Continuity object (hero)** | all | The orb's exit sets the next entry: into lens → blue; into light → white; shoot up → rise from below; drop → horizon. | Planning. | ✗. NEW `hero` in the brand kit + a continuity planner (§5, §7) |
| A30 | **Edit rhythm: cut on the pickup, land on the beat** | 243/247, 579/586, 792/808 | Cuts sit on the off-beat 16th *before* an accent; the motion accent lands on the beat or downbeat (§6). | Editing. | ✗. NEW rhythm rules + rhythm QA |

---

## 4. Measured motion grammar

Sources:
- **M** = measured by tracking (`measure_moves.json`, `measure_pen.json`, or the re-analysis in this pass).
- **N** = the analyst's notes.
- **V** = verified in this pass's frames.

| Move | Frames | Duration | Curve (cubic-bezier, fit RMSE) | Numbers | Src |
|---|---|---|---|---|---|
| Vesica draw-on | 1–17 | 15–16 f | Easy-ease trim chase | Both trim ends move; full circles by f17 | N, V (f8 partial) |
| Iris-orb push | 3–63 | 60 f | Accelerating (ease-in) | Ø ≈ 20 → **545 px** (0.50 H); fastest in f55–63 | M, V |
| Fall-away shrink | 63–88 | 25 f | **(0.34, 0.21, 0.00, 1.19)**, rmse 0.030 | Ø 545 → 65 px (×0.12). Peak speed at f69: 134 px/f. **3 % undershoot**, then re-grows as it rises | M |
| Echo shoot-up | 243–247 | 4 f | Hard ease-out | Lands on the bar-4 downbeat; capsule compresses over 25 f, fades over 6 f | N, V |
| Jelly wobble | 281–300; 692–697 | cycle not measured | Sine | 3–5 % idle; 10–15 % when travelling fast; axis rotates | N |
| Fly into the light | 337–351 | 14 f | Ease-in | Ø to 12 px, then white-out 13 f | N |
| **Portal dolly (one loop)** | 403–417 | 14 f + cut | **Linear camera** (perspective hyperbola in screen space) | r 91 → 588 px. **Δ(1/r) = −6.6·10⁻⁴ px⁻¹ per frame, constant to ±1.5 %**, so the camera moves at constant speed. The cut comes about 2.5 f before the ring would pass the lens. Loops 1, 2 and 6 share identical end radii (the same clip re-trimmed). Loop 5 is about 20 % faster | M |
| Loop lengths | 386–485 | 16, 16, 14, 22 (10+10+2), 9, 6, 5, 5, 7 f | — | In 16ths: **3, 3, 2, 2, 2, 1, 1, 1, 2 → downbeat** | M (§6) |
| Window pop | 586–596 | 10 f | **(0.18, 0.54, 0.68, 0.99)**, rmse 0.003 | Width 375 → 1024 px (0.37 → 1.0). Peak velocity on the first frame (151 px/f), halving about every 3 f. No overshoot (the later growth is camera drift) | M |
| Title-bar palette flicker | 586–591 | 5 f | Hold keys | orange → red `#e8455f` → white → the navy/blue gradient | N, V |
| Orb entrance with smear | 580–585 | 3 f + settle | Ease-out + overshoot | x −0.02 W → 0.105 W → 0.10 W (about 5 % overshoot) | N |
| **Pen momentum loop** | 623–663 | 40 f / 360° | **(0.16, 0.70, 1.00, 0.46)**, rmse 0.008 (fast-slow-fast) | Quadrant times **4.5 / 12.5 / 20 / 3 f**. Angular speed 41°/f → **min 3.4°/f at f646–651** (the bar-9 downbeat) → 54°/f. Circle r ≈ 207 px; orb Ø ≈ 69 px | M, V |
| Fill + bounding box | 665 | 1 f | Hold | Instant | V |
| Swoop and grow | 689–704 | 15 f | Ease-in-out | Orb ×2.4, 10–15 % squash along the travel | N |
| Flat → 3D swap | 714→715 | 1 f | Hold | Sphere +20 %; window swings about 20° (width 485 → 450 px in the montage); cube trims off in 8 f | V |
| Fly into the lens | 783–791 | 8 f | **(0.82, −0.02, 1.00, 0.01)**, rmse 0.004 (≈ expo-in) | Ø 226 → 1131 px; 1/Ø falls faster each frame (accelerating dolly) | M |
| Black breath | 792–803 | 12 f (cut → impact 16 f) | — | — | N |
| **Horizon drop** | 805–818 | 3 f fall + 10 f settle | **Linear fall** (bezier ≈ linear, rmse 0) | 165 px/f. **h/w: 2.00 (807–808) → 1.28 → 1.20 → 1.07 → 1.05 (f812, rebound apex) → 1.12 → 1.22 → 1.29 (815, second fall) → 1.10 → 1.04 → 1.00 (818).** Width 163 → 160 px: **no squash**. Rebound 89 px (0.55 Ø). Rests about 15 px above the line | M, V |
| Crane to the ring | 849–864 | 16 f | Ease-out | Scene ×4, horizon → about 35–40° elevation | N |
| Orbit / pull-back | 865–896 / 897–912 | 32 f / 15 f | Linear / ease-in-out | About 10° / ×0.5 | N |
| Cards lift off | 942–975 | about 10 f each | Ease-in | Stagger 4–8 f | N |
| Tunnel panel passes | 993–1087 | about 10.3 f apart (7–15) | Continuous rotation | Rotation 1 rev per 1.5–3 s. Pass rate ≈ 8th notes (10 f), but phase-free (R = 0.36 against the 8th grid) | M |
| Stutter | 1088, 1094 | 6 f, 4 f | Cut | On consecutive 16ths | M |
| **Phone pull-back, 3 phases** | 1100–1124 / 1125–1188 / 1188–1199 | 24 f / 64 f / 11 f | **(0.08, 0.54, 0.24, 0.82)** (≈ expo-out) / linear / **(0.99, 0.29, 0.78, 0.93)** (≈ expo-in) | Rim width 1282 → 792 px (×0.62), then about 3.6 px/f, then 553 → 387 px accelerating into the cut | M |
| World-resolve | 1200–1216 (tilt to about 1250) | 16 f bloom-clear; 50 f tilt | Ease-out | Figure y 0.93 H → 0.81 H | N, V |
| Lily unfurl / grass | 1206–1220 / loop | about 15 f / period about 1.5 s | Ease-out / sine | — | N |
| End card | 1341–1394 | 54 f | Static | Wordmark 10.7 % of W | N |

**Grammar in one paragraph.**
- **Hero moves come in two speeds.** *Very* fast moves (3–8 f: shoot-ups, smears, falls, flying into the lens) sit between *floaty* holds (wobble, drift, bob).
- **The camera avoids ease-in-out.** It uses constant-velocity dollies (the portal), hard ease-out → linear drift → hard ease-in (the phone), and one-sided eases on the cranes.
- **Nothing overshoots except the hero.** The UI pops land dead (no bounce); only the orb has elastic life (a 3–5 % overshoot on arrival, wobble, rebound).
- **Exits accelerate into the cut** (fly into the lens, the phone exit, the fly into the light), so the cut lands at peak velocity.

---

## 5. Design system, and how it maps to a Helios brand kit

**Palette tokens** (from the kit's per-shot palettes plus the notes):

| Role | Tokens |
|---|---|
| Brand blue (wordmark, orb core) | `#2a4de1`, `#3a5cf0`, `#4161e1` |
| Hero dot (full stop) / orb edge | `#8a9bf0`, `#798de5`, `#8fa4ff` |
| Void / origin | `#000000`, `#03020b`, `#070613` |
| Navy (energy) | `#010311`, `#050b2e`, `#101d5c`, `#2e4cbe`, `#6787e2` |
| Sky → white (light) | `#102169`, `#263ea1`, `#8497e9`, `#b3bef2`, `#dde2f9`, `#ffffff` |
| Lavender (possibility / UI) | `#efeffb`, `#f2f4fd`, `#cec6fa`, `#b4acf6`, `#9383f2`, `#5f58aa` |
| Platform violet | `#09051e`, `#1a1154`, `#251b77`, `#3931aa`, `#4d4ad9` |
| Tunnel violet | `#0d0534`, `#150550`, `#7a5fee`, `#be96fa`, `#e4dbfb` |
| Dawn (promise) | `#e6ebfc`, `#b5c1f4`, `#8b9dea`, `#6468d9`, teal `#267cad` / `#2fbfbf` |
| Warm accents (the "made" thing) | orange gradient `#f9c56a → #ec6a5c`; 3D sphere `#fff3c4 → #f98a4b → #f0452d`; coral `#e8656a`; red-pink `#e8455f` |
| Cool accents | teal `#2ad0a8`, neon pink `#e04aa0`, cyan, green (the tunnel arcs) |

**The system.**
- **One primitive: the circle.** It appears as the orb, the vesica, the lens ring, the portal, the bubbles, the planet, the sun, and finally the full stop. The only other primitive is the **rounded rectangle** (windows, cards, capsules, panels), and the capsule is literally a *stretched circle*.
- **Light vocabulary:**
  - a 4-point star glint with an anamorphic streak;
  - a crosshair lens flare;
  - bloom and white-outs;
  - rays and a light cone;
  - a light column (the trail);
  - a light pool on the floor;
  - 1 px hairlines with an RGB fringe.
- **World arc:** black (origin) → navy (energy) → blue sky (flight) → white (light) → lavender (possibility) → lavender UI (product) → black/violet (platform) → violet (speed) → black (device) → illustrated dawn (promise) → white (brand).
  - It is a **value arc**: dark → light → dark → light, one swing per phrase.
  - Warm colour appears only for *the thing the user makes* (the orange circle/sphere).
- **Type:**
  - A lowercase geometric sans, bold, oblique about 10°, with a single-storey "a", in `#2a4de1`.
  - The full stop is a lighter periwinkle dot: the orb.
  - It is deliberately small (10.7 % of W) and never animated. **The world moves; the logo doesn't.**
- **Motion personality:**
  - The hero is alive (wobble, bob, echo, smear, rebound); everything else is calm and precise.
  - The hero *never stops moving*.
  - The UI never bounces.

**Mapping to the Helios brand kit (NEW: `BrandKit.hero`).** Today `BrandKit` has logos, colours, typography, `motionGuide` and `guideline`, but nothing that *acts*. Proposed type:

```ts
// src/lib/brandKit/types.ts (NEW)
type BrandHero = {
  shape: 'sphere' | 'capsule' | 'rounded-cube' | 'svg';        // aflow: 'sphere'
  svg?: string;                                                 // when the hero is a logo mark
  binding: { logo: 'dot' | 'o' | 'mark' | 'none' };             // aflow: the wordmark's full stop IS the hero
  colors: { core: string; shell: string; rim: string; glow: string }; // aflow: #3a5cf0, #eef1ff, #ffffff, #8fa4ff
  states: {                                                     // the looks templates may use
    iris?:    { decals: { shape: 'disc' | 'pill'; color: string; lat: number; lon: number; size: number }[] };
    pearl?:   { coreScale: number; frost: number };             // 0.6, 0.35
    capsule?: { maxStretch: number };                            // 2.0
    column?:  { color: string };                                 // light pillar
    cursor?:  { size: number };                                  // 0.064 H
  };
  material3d: 'pearl-core' | 'glass-thin-film' | 'soft-plastic' | 'chrome' | 'clay';
  motion: { wobbleIdle: number; wobbleTravel: number; echo: number; smear: boolean;
            drop: { stretch: number; rebound: number; settleFrames: number } }; // 0.04, 0.12, 6, true, {2.0, 0.55, 10}
  motifs: ('vesica' | 'lens-ring' | 'crosshair-flare' | 'star-glint' | 'light-column' | 'echo')[];
  worlds: { mood: 'origin' | 'energy' | 'flight' | 'light' | 'product' | 'platform' | 'speed' | 'device' | 'promise' | 'brand';
            bg: string[] }[];                                    // the value arc, palette-mapped
};
```

**How Helios uses it:**
- `brandify.ts` maps `hero.colors` to every 2D hero layer and to the Blender material presets. `worlds` gives each act its background.
- The hero is the continuity object every template can carry. The plan's T1 needs exactly this, and `dock-cursor` already has a cursor to swap for it.
- `binding.logo:'dot'` tells the end-card template to land the hero on the wordmark's full stop.
- `create_brand_kit` / `extract_brand_from_url` would propose a hero from the logo:
  - a dot or "o" in the wordmark → sphere;
  - a symbol → svg-extrude.

---

## 6. Sound design and beat grid

**No sound design.** The film has no SFX: every "hit" is a musical event, with no whooshes on the zooms or impacts on the drop.
- Helios's template grammar ("a sound cue on every event") must be **off by default** for brand films.
- A NEW `genre:'brand-film'` flag should set `sfx:false` in `create_motion_scene`.

**Method.**
- `audio.wav` (22.05 kHz mono) was analysed with a 1024-point STFT, hop 128, split into four bands: all, <150 Hz, 150–2500 Hz and >5 kHz.
- Spectral-flux onsets were picked (181 onsets, times window-centred).
- Autocorrelation was run per band, and the tatum fitted by circular statistics over 5.4–37.2 s.

**Result:**
- **The tatum is 0.16664 s = 5.00 frames**, with circular R = **0.992** (residual SD 3.4 ms).
- The high band's autocorrelation peaks at 0.499 s (3 tatums), but the bar-level periodicity is at **2.664 s = 16 tatums**, not at 2.0 s.
- Low-band (kick) energy concentrates on one slot per 16.

So the track is **90.0 BPM in 4/4**, with 16ths of 5 f, beats of 20 f, bars of 80 f and 4-bar phrases of 320 f.
- The **percussion figure** falls on 16th slots **1.3, 2.2, 3.1, 3.4, 4.3** (the "&" of 1, "e" of 2, beat 3, "a" of 3, "&" of 4). That is a dotted-8th **3-3-3-3-4 figure**.
- This figure is why both `analyze.py` and (almost certainly) Helios's `analyze_music_beats` report **120 BPM**: 3 tatums = 0.5 s, and the 120-BPM log-Gaussian prior in `src/lib/beats.ts` (`PRIOR_BPM = 120`) tips the choice. The full-band ACF is 0.80 at 0.5 s against 0.76 at 0.667 s, and the prior weight at 90 BPM is 0.92.
- A 120-BPM grid lines up with the bar lines only once every 3 bars. `snap_cuts_to_beats` on that grid would pull phrase-line cuts off their downbeats.

**Structure** (the RMS column is loudness per 0.1 s):

| Bars | Frames | Music | Picture |
|---|---|---|---|
| 1–2 (intro) | f8–167 | Riser: −85 → −45 dB | Vesica birth, fall-away, rise |
| **3–6 (phrase A)** | f168–487 | **Drop 1** (−45 → −36 dB), full groove | Bouquet → echo capsule → white-out → portal accelerando (the fill into bar 7) |
| **7–10 (phrase B)** | f488–807 | Groove continues (no level step) | Lavender space → UI world → pen → flat→3D → into the lens → black breath |
| **11–14 (phrase C)** | f808–1127 | **Drop 2** (−38 → −27 dB, +11 dB) | Orb impact → card ring → tunnel → stutter at 14.3.1 |
| break | f1100–1198 | Decays to −63 dB by 39.8 s (no pulse) | Phone light fountain |
| free time | f1198 | **Final hit** 39.92 s (−34 dB), off the old grid | Logo world (cut +1.4 f after the hit) |
| tail | f1200–1394 | Decay to −90 dB | Hold + end card |

**Every hard cut and every portal-loop restart against the grid.**
- *Beat #* counts beats from bar 1 beat 1 (the bar-3 downbeat = beat 8.00).
- *Δ16th* is the offset to the nearest 16th. *Δbeat* is the offset to the nearest beat.
- *Δonset* is the offset to the nearest onset: first against this pass's list, then against the kit's 174-onset list.

| Event | f | t s | Beat # | Position | Δ16th (f) | Δbeat (f) | Δonset (f) | Note |
|---|---|---|---|---|---|---|---|---|
| **Cut** | 166 | 5.500 | 7.91 | **3.1.1 downbeat (phrase A)** | −1.9 | −1.9 | −1.7 / −1.1 | Drop 1: black → bouquet |
| **Cut** | 243 | 8.067 | 11.76 | 3.4.4 ("a" of 4) | +0.1 | −4.9 | +0.1 / +0.6 | A pickup: the orb lands on 4.1.1 (f247) |
| Loop 1 start (soft) | 386 | 12.833 | 18.91 | 5.4.1 (beat 4) | −1.9 | −1.9 | −1.8 / −1.2 | The ring dolly starts out of the white |
| Loop 2 | 402 | 13.367 | 19.71 | 5.4.4 | −0.9 | −5.9 | −0.8 / −0.2 | +3 16ths |
| Loop 3 | 418 | 13.900 | 20.51 | 6.1.3 (hat) | +0.1 | −9.9 | +0.1 / +0.8 | +3 |
| Loop 4 | 432 | 14.367 | 21.21 | 6.2.2 (hat) | −0.9 | +4.1 | −0.9 / −0.2 | +3; a 22 f loop with inner flashes ↓ |
| (flash) | 442 | 14.700 | 21.71 | 6.2.4 | −0.9 | −5.9 | −0.8 / −0.3 | +2 |
| (flash) | 452 | 15.033 | 22.21 | 6.3.2 | −0.9 | +4.1 | −0.7 / −0.4 | +2 |
| Loop 5 | 454 | 15.100 | 22.31 | 6.3.2 | +1.1 | +6.1 | +1.3 / +1.6 | (same 16th as the flash) |
| Loop 6 | 463 | 15.400 | 22.76 | 6.3.4 (hat) | +0.1 | −4.8 | +0.2 / +0.5 | +2 |
| Loop 7 | 469 | 15.600 | 23.06 | 6.4.1 (beat 4) | +1.2 | +1.2 | +1.1 / −3.2 | +1 |
| Loop 8 | 474 | 15.767 | 23.31 | 6.4.2 | +1.2 | +6.2 | +1.2 / +1.8 | +1 |
| Loop 9 | 479 | 15.933 | 23.56 | 6.4.3 (hat) | +1.2 | −8.8 | +1.0 / +1.5 | +1 |
| **Cut** | 486 | 16.167 | 23.91 | **7.1.1 downbeat (phrase B)** | −1.8 | −1.8 | −2.3 / −1.2 | +2 → the portal ends; lavender space |
| **Cut** | 579 | 19.267 | 28.56 | 8.1.3 ("&" of 1, hat) | +1.2 | −8.8 | +1.2 / +1.9 | A pickup: the window pops on 8.2.1 (f586, −1.8) |
| **Cut** | 792 | 26.367 | 39.21 | 10.4.2 ("e" of 4) | −0.8 | +4.2 | −0.9 / −0.3 | A pickup: black 16 f, then the impact on 11.1.1 |
| *(impact, not a cut)* | 808 | 26.900 | 40.01 | **11.1.1 downbeat (phrase C, drop 2)** | +0.2 | +0.2 | +0.3 / +0.7 | The orb lands on the drop |
| **Cut** | 992 | 33.033 | 49.21 | 13.2.2 ("e" of 2, hat) | −0.8 | +4.2 | −0.6 / −0.3 | The echo shoot-up exits |
| Jump cut | 1088 | 36.233 | 54.01 | 14.3.1 (beat 3) | +0.2 | +0.2 | +0.3 / +1.0 | Stutter 1 |
| Jump cut | 1094 | 36.433 | 54.31 | 14.3.2 | +1.3 | +6.2 | +1.3 / +1.8 | Stutter 2 |
| **Cut** | 1098 | 36.567 | 54.51 | 14.3.3 | +0.3 | −9.7 | +0.2 / +0.9 | Stutter 3 → phone; the music breaks |
| **Cut** | 1200 | 39.967 | — | free time | — | — | +1.4 / +1.9 | On the final hit (the old grid no longer applies) |
| **Cut** | 1341 | 44.667 | — | music tail | — | — | none within 4 s | End card |

**Chance baselines, computed on the frame timeline.** The share of frames within ±2 f of:

| Target | Share of frames |
|---|---|
| some kit onset, over the whole film | **50 %** |
| some kit onset, inside the music (5.5–37 s) | **73 %** (76 % with this pass's list) |
| a 16th | 80 % |
| an 8th | 40 % |
| a beat | 20 % |
| a bar line | 5 % |
| a 4-bar phrase line | 1.25 % |

**What is and isn't synced:**
1. **Phrase lines carry the world changes: 3 of 3.** The biggest events sit on the three phrase lines inside the music, each at 1.25 % chance:
   - drop-1 cut, 3.1.1, −1.9 f;
   - lavender cut, 7.1.1, −1.8 f;
   - orb impact, 11.1.1, +0.2 f.

   Cuts *lead* the downbeat by about 2 f; the physical impact is dead on.
2. **Ordinary hard cuts are *not* on beats.** Only 2 of the 9 hard cuts are within ±2 f of a beat (22 %, against 20 % chance), and those 2 are the phrase cuts. Of the other 7:
   - two sit on the 16th pickup just before an accent (3.4.4 and 10.4.2);
   - two sit on percussion-figure slots (8.1.3 and 13.2.2);
   - one ends the 16th stutter (14.3.3);
   - two are in free time (the logo and the end card).
3. **The motion accents *are* on beats.** Of the key motion events, 6 of 9 land within ±2 f of a beat (67 % against 20 %; binomial p ≈ 0.003; the selection is mine, so treat this as strong but not conclusive):
   - orb arrival 4.1.1;
   - ring dolly start 5.4.1;
   - window pop 8.2.1;
   - slowest point of the pen loop 9.1.1;
   - impact 11.1.1;
   - crane 11.3.1.

   Off the beat: the fill f665, flat→3D f715 and lift-off f942.

   **The rule: cut on the pickup, land the motion on the beat.**
4. **The accelerando is composed, not "on onsets".** Restarts at 5.4.4 → 6.1.3 → 6.2.2 (dotted 8ths, riding the percussion figure) → 6.2.4 → 6.3.2 → 6.3.4 (8ths) → 6.4.1 → 6.4.2 → 6.4.3 (16ths) → the 7.1.1 downbeat. In 16ths that is **3-3-2-2-2-1-1-1-(2)**: a textbook drum fill, played by the edit. "Each restart on an onset" is trivially true here, because the onsets are a continuous 16th stream (80 % chance at ±2 f).
5. **The tunnel is tempo-matched but free-running.** Panel passes come about every 10.3 f (8th = 10 f), but the phase coherence is only R = 0.36. The rotation speed was chosen to *feel* like 8ths.
6. **The logo lands on a free-time final hit after a break.** The cut is +1.4 f after the transient, which is standard for a hit that should feel *caused*.

**What Helios's beat tools need** (NEW; details in §7.4):
- **tatum-first tempo:**
  1. find the 16th;
  2. choose the beat = 4 tatums unless the kick/bar periodicity says 3;
  3. choose the bar phase from the low-band kick and the RMS step-ups.
- **phrase and drop detection** (RMS step ≥ 6 dB at a bar line; a break = a fall ≥ 20 dB);
- `snap_cuts_to_beats {grid:'sixteenth', rule:'pickup'}`.

---

## 7. What Helios needs

### 7.1 A brand identity film generator (NEW, L): `create_brand_film`

**Input:**

```ts
{ kitId?: string; musicAssetId?: string; duration?: 30 | 45 | 60;
  screens?: string[] /* UI screenshots or P3 UI scenes */; tagline?: string;
  grammar?: 'orb-journey' /* this film */ | 'reveal' | 'product-hero';
  quality?: 'draft' | 'final' }
```

**Pipeline:**
1. **Music.** Run `analyze_music_beats` (fixed, §7.4) to get the tatum, bars, phrases, drops, break and final hit. If there is no music, use a library track, cut to 4-bar phrases.
2. **Act grammar → phrases** (the aflow grammar, "orb-journey"):

   | Act | Phrase | Content | Build |
   |---|---|---|---|
   | Birth | Intro, ≤ 2 bars | Hero forms inside the motif (vesica / lens), then the fall-away | 2.5D |
   | Rise | Rest of the intro | Comet trail, streaks, riser bands | 2D |
   | World A | Phrase A, drop 1 | A 3D hero world (bouquet, floating shapes) → hero transition (echo, into light, white-out) → **accelerando fill** into phrase B | 3D + 2D |
   | Product | Phrase B | Hero becomes the cursor/pen in the brand UI (P3), creates the warm shape, **flat → 3D** → into the lens → black breath (3 16ths) | 2D/2.5D |
   | Platform | Phrase C, drop 2 | Hero drops on the downbeat → UI-card ring → tunnel → **stutter** into the break | 3D |
   | Resolve | Break | Device + light fountain | 3D |
   | Logo | Final hit | World-resolve logo (hold ≥ 4 s) → end card 1.8 s, with the hero landing as the logo dot | 2D |

3. **Continuity solver.** For each cut, the hero's exit (screen position, velocity, size or "fills frame") in shot N becomes shot N+1's entry:
   - into lens → full-frame `hero.colors.core`;
   - into light → white;
   - up and out → up from below;
   - drop → horizon.
4. **Timing rules** (from §6):
   - world switches on phrase lines, with cuts −2 f;
   - other cuts on the 16th pickup before the accent they introduce;
   - accents on beats;
   - fills 3-3-2-2-2-1-1-1;
   - stutters on consecutive 16ths;
   - black breath = 16 f before the drop;
   - exits accelerate into the cut.
5. **Build:**
   - 3D shots are queued as `create_3d_scene` + `render_3d_scene` (draft at once, final in the background);
   - 2D shots use `create_motion_scene` templates carrying `hero`;
   - music is placed and SFX are off.
6. **QA:**
   - `run_frame_qa`;
   - NEW **rhythm QA**, which lists every cut as `bar.beat.16th` and flags a world change off a phrase line, or a phrase line without an event;
   - `consult_council`.

**Cost.** On the RTX 3080, Cycles 1080p takes about 4–5 s/frame (§5 of the plan). The aflow-like 3D share is 378–521 f, which is **about 30–45 min in the background**. Drafts take seconds per shot (EEVEE for opaque presets, low-sample Cycles for glass; see below).

### 7.2 Blender presets: exact specs

**Common request additions** to [blender_bridge_proof.py](../blender_proof/blender_bridge_proof.py) (all NEW):

| Addition | Spec |
|---|---|
| `world.gradientEnv` | Helios renders the shot's background gradient to a 2:1 equirect PNG; Blender lights the scene with it and shows it as the background. **Glass presets render full-frame**: on transparent film, Cycles glass refracts only the Blender world, so it cannot refract the Helios background (the proof's orb is milky on the checker). |
| `objectsJson` | Per frame, each tagged object's **projected centre, radius and depth** (px, matching `camera.json`), so the 2D glints, echo, smear and light column track the 3D orb. |
| `camera.json` gains `focusDistance`, `aperture` and `shutter` | So `threeD` 2D overlays get the same defocus and blur. |
| `view_transform: "Standard"` for brand-colour objects | AgX (the proof's default) desaturates `#2a4de1`/`#3a5cf0` emission toward white. Alternatively, keep AgX and compensate the colour in the preset. |
| Eases | Unchanged: CSS bezier → F-curve handles, as proven. Fix the latent bug: a key with `"ease": null` crashes `keyframe()`, so default it. |
| Draft tier for glass | Cycles 8 spp + OptiX denoise at ½ res, not EEVEE: EEVEE renders these spheres dark. The cost is an estimate, to be measured. |

**Preset 1: `glass-orb`, variant `pearl-core` (the hero).** The plan calls it "thin-film"; the hero is not thin-film.

| Part | Spec |
|---|---|
| Objects | `shell` sphere r 0.5 m (UV 64×32, smooth). `core` sphere r 0.30 m inside, offset (0.04, −0.03, 0.05), orbiting slowly inside (0.2 rev/s) so the blue drifts like the film's. Optional `decal` state = iris: use P6 2.5D, not Blender. |
| Shell material | Principled: base `hero.colors.shell` `#eef1ff`, Transmission 1.0, Roughness 0.30 (frosted), IOR 1.45, Coat 1.0 / 0.03, plus an inner Volume Scatter (density 1.2, anisotropy 0.3, white) for the milky shell. |
| Core material | Emission `hero.colors.core` `#3a5cf0`, strength 4 (Standard view transform). The core glows through the frost to give the white-rim / blue-centre look (f246, f809, f880). |
| Lights | Key area 2 m at (−2.5, −3, 3), 600 W `#fff4ea`. Rim area 1 m at (2, 3, 2), 800 W `#c8d4ff` (the white crescent). Fill from `gradientEnv`, strength 0.6. |
| Camera | 85 mm, f/2.8, focus on the orb. |
| Moves (params) | `float`: z sin 0.03 m, period 1.6 s. `shootUp`: z +1.5 m in 4 f, (0.05, 0.7, 0.1, 1). `intoLens`: camera dolly to 0.2 m in 8 f, (0.82, 0, 1, 0). `flyAway`: z −6 m / scale in 14 f, ease-in (0.55, 0, 1, 0.45). |
| Render | Cycles 64 spp, OptiX denoise, motion blur 0.5, full-frame. |

**Preset 2: `thin-film-bubble` (secondary spheres: bouquet, lavender space).**

| Part | Spec |
|---|---|
| Geometry | Sphere with a Solidify of 2 mm (a hollow shell). |
| Material | Principled base white, Transmission 1, Roughness 0.0, IOR 1.33. **Thin Film Thickness driven by a Noise Texture** (scale 1.5, detail 3) mapped to 250–700 nm, Thin Film IOR 1.33. A constant thickness (as in the proof's 420 nm) gives a flat tint, not the film's pink/green swirl. |
| Motion | Rotation 5°/s, so the film pattern drifts. |

**Preset 3: `sphere-bouquet`.**

| Part | Spec |
|---|---|
| Objects | 14 spheres (r 0.12–0.5 m, seeded) packed in a hemispherical bowl (cap r 1.1 m) on a `plate` (cylinder r 1.4 m, h 0.04 m). Two defocused foreground spheres for bokeh. An empty `glint` at (0, 0, 1.05) for the 2D star glint. |
| Materials, cycled from the kit | 30 % soft gradient plastic (base primary, roughness 0.45, coat 0.3); 20 % `thin-film-bubble`; 20 % dark gloss (`#101d5c`, roughness 0.15, coat 1); 15 % cyan (`#2fd0e0`, roughness 0.3); one centre pearl (`#f6e9f5`, sheen 0.5, subsurface 0.3). Plate: `#050b2e`, roughness 0.2, with a thin emissive rim. |
| Lights | Top spot (0, 0, 4), 1500 W, 30°, blend 0.4. The world has Volume Scatter density 0.015 so the **V light cone** shows. Rim area (0, 3, 1.5) `#6787e2` 600 W. Key area (−2, −2, 2.5) 300 W. World `#010311`. |
| Camera | 50 mm, f/2.0, at (0, −4.2, 1.1) looking at (0, 0, 0.45). |
| Moves | 0–1.93 s: push 4 % (y −4.2 → −4.03, sine-in-out). Each sphere drifts with noise (0.01 m, 0.3 Hz); the bottom bubble slides −0.08 m. **Tilt-up** over the last 0.57 s: target z +0.9 m, ease (0.55, 0, 1, 0.45), while the focus distance goes 4.2 → 12 m and the aperture opens to f/1.4 (spheres to bokeh). |
| 2D on top | `star-glint` tracked to `glint` (streak 400 px H / 150 px V, scale flicker 0.9–1.1 noise at 8 Hz). |
| Render | Cycles 96 spp, about 5 s/frame; 77 f ≈ 6.5 min. |

**Preset 4: `orb-horizon-ring` (merges the plan's `orb-horizon` + `ui-card-ring`; one scene, one continuous camera).**

| Part | Spec |
|---|---|
| The drop | Stays **2D** (§8 S1), because the stretch-only capsule is a 2D stylisation. The Blender scene takes over at the crane (f849). |
| Objects | `platform` disc r 3 m, `#1a1154`, roughness 0.35. `rim` torus (major 3 m, minor 4 mm), emission `#cfd8ff` 20: seen edge-on it *is* the horizon line. `orb` = `pearl-core` r 0.12 m plus a point light `#6f6cff` 800 W, radius 0.15 (it paints the light pool). `cards` ×6 `ui-card` (NEW kind): 1.6 × 1.0 m rounded plane (r 0.06), texture from `screens[]`, emission 0.6 × texture + Principled roughness 0.35, coat 0.5. They stand on radius 2.2 m, facing in, 0.1–0.3 m above the floor, with a bob of 0.02 m, period 2.5 s, phase per card. `slabs` ×12: 0.8 × 1.2 m, `#0b0820`, on radius 4 m. |
| Lights | Orb point (above). Top area `#3931aa` 200 W for sheen on the cards. World `#09051e`. |
| Camera (orbit mode), in frames from the scene start at f849 | 0: elevation 2°, radius 16 m. 0–15: **elevation 38°, radius 6.5 m, ease (0.16, 1, 0.3, 1)** (the crane). 16–47: azimuth +10°, linear. 48–63: radius 13 m, ease (0.6, 0, 0.4, 1) (the pull-back). 64–92: azimuth +2°, linear. |
| Card lift-off, frames 93–126 | Each card z +3 m in 10 f, ease (0.55, 0, 1, 0.45), seeded stagger of 4–8 f. The slabs sink 0.3 m and fade. |
| Orb exit, frames 128–141 | Hover +0.15 m, ease-in-out. At frame 139 the orb shoots up z +4 m in 3 f; the 2D echo is drawn on top. |
| Render | EEVEE is acceptable (no glass except the tiny orb); Cycles 64 spp final. 143 f ≈ 10 min. A **2.5D motion-engine version** (threeD image planes + camera + radial-gradient floor plane) is buildable today as the instant draft. |

**Preset 5: `panel-tunnel`.**

| Part | Spec |
|---|---|
| Objects | 18 `cylinder-patch` panels (NEW kind: arc 40–70°, height 0.6–1.4 m) on radii 1.2 / 1.8 / 2.6 m, stacked over z 0–12 m. |
| Panel materials | 40 % translucent violet (`#5d42bd`, transmission 0.6, roughness 0.25, alpha 0.7). 25 % black (`#030304`). 15 % white emissive (`#e4dbfb`, 1.5). 20 % curved browser windows (UI texture with traffic-light dots). |
| Panel motion | Each radius ring rotates about z at 0.33–0.67 rev/s, alternating direction. **Choose (panels per ring × rev/s) ≈ 3 passes/s = 8ths at 90 BPM**, so the passes feel on the grid. |
| Column and orb | A `column` cylinder r 0.06 m with emission `#cfd8ff` 30, fading downward (gradient along z). The orb sits at the column top, rising at 0.8 m/s. |
| Neon arcs | Bevelled curves (4 mm), emission 15, in pink `#e04aa0`, cyan `#4fd6ff` and green `#5cf2a0`, orbiting the base. |
| Sparkles | Particle icospheres (1 cm, emission) spiralling up; a 2D P5 overlay is the alternative. |
| Camera | 24 mm at r 0.6 m, looking at the column, z rising with the orb (linear 0.8 m/s), roll ±3° noise. Motion blur 0.5. |
| World | `#150550` + Volume Scatter 0.01. |
| Render | Cycles 48 spp; 106 f ≈ 8 min. The stutter is done in the edit, not in Blender. |

**Preset 6: `device-light-fountain`.**

| Part | Spec |
|---|---|
| Device | `device` (NEW kind): a rounded box 0.075 × 0.155 × 0.008 m, bevel 8 mm, `#0b0d1a`, metallic 0.6, roughness 0.25. The screen is an emissive plane (UI texture or the brand gradient). The neon rim is a rounded-rect tube with emission `#2e4cbe` 12. |
| Fountain | A revolved **tulip profile**, 0.35 m tall with a top radius of 0.12 m. Its shell is Transparent + Emission driven by Layer Weight (facing) so the petal edges glow. Inside it, Volume Emission `#bcd0ff` with density 0.8 × a vertical gradient. An empty `tip` drives the 2D star glint. |
| Camera | Elevation 55°, 35 mm. **Three-phase pull-back on the distance:** 0–24 f ×1/0.62 at (0.08, 0.54, 0.24, 0.82); 24–88 f linear, +0.45 %/f; 88–101 f ×1.45 at (0.99, 0.29, 0.78, 0.93). |
| 2D on top | Lens-ghost ring (large ellipse, stroke 30 % white, rotating 20° over 26 f); sparse star field (P5 `dust`). |
| Render | Cycles 64 spp; volumes add about 30 %. |

**Preset 7: `floating-shapes` (lavender space).**

| Part | Spec |
|---|---|
| Objects | 4–6 gradient spheres (soft plastic, palette). One two-tone planet: base `#f98a4b` with a navy terminator from a hard rim light. One large `thin-film-bubble` (r 0.6 m). 10–16 **glass shards**: boxes 0.02 × 0.08 × 0.2 m, transmission 1, roughness 0.15, tumbling 20–60°/s seeded. |
| Camera | Truck +1.2 m and roll −11° over 3 s, ease-out (0.16, 1, 0.3, 1). DOF f/2.8. |
| 2D on top | Anamorphic arc + sunburst (P5). |

### 7.3 2D / 2.5D features (the other 63 % of the film)

| Feature | For | Size |
|---|---|---|
| `echo` effect (N copies at −Δt, decay, optional capsule merge) | A8, A21, A23 | S–M (P5) |
| `smear` (velocity stretch along motion, 1–3 f) | A15 | S |
| `star-glint`, `god-rays`, `light-cone`, anamorphic arc | A6, A10, A14 | M (P5) |
| **Gradient stroke** (alpha/colour along the path length) | A12 ring fade, A1 | S–M (P1) |
| `followPath` / `pen-draw` (a layer rides a shape's trim head; anchor dots pop at vertices) | A17 | S–M (P1) |
| Colour keyframes on shape `fill`/`stroke` (hold keys) | A16 | S |
| P6 `solid2_5d` sphere: decals + animatable light + `shading 0→1` (flat → shaded) | A2, A18 | M (P6) |
| `wobble` and `drop-bounce` motion presets in `kit/common.ts` | A9, A21 | S |
| `portal-accelerando` template: one constant-speed dolly precomp, re-trimmed per loop, restarts from the 16th grid (3-3-2-2-2-1-1-1), flash frame per restart, nested ring count +1 per loop | A12, A13 | S (engine features exist) |
| `world-resolve-logo` template: generated illustration → depth layers (`cutout_image`) → parallax tilt; bloom/exposure clear in 16 f; wordmark static at 10–12 % of W; hero lands as the logo dot | A27 | M |
| `vesica-birth` template: two trim-chased circles + hero growth + fall-away | A1–A3 | S |
| 2D-over-3D handoff: a 2D layer whose position/scale come from `objects.json` (NEW `track` field) | glints, echo on 3D orb | M (P7) |

### 7.4 Beat tools

1. **`analyze_music_beats`:**
   - estimate the **tatum** first, by a circular fit;
   - return `{bpm, tatum, beats, bars, phrases, drops, breaks, finalHit}`;
   - drop the 120-BPM prior's power to override when a 4-tatum beat explains the bar periodicity;
   - add a regression test on this track's envelope (expect 90.0 ±0.1, downbeat 0.231 s).
2. **`snap_cuts_to_beats`:** NEW params `grid: 'sixteenth'|'eighth'|'beat'|'bar'|'phrase'` and `rule: 'on'|'pickup'|'lead2f'`. The plan's `{mode:"drop"}` does not exist today.
3. **Rhythm QA:** report every cut as `bar.beat.16th`; flag phrase lines with no event.

---

## 8. Recreate recipe: the best 10 s

**Which 10 s.** Bars 10.3.1 → 14.3.1: **f768–1088, 25.57–36.23 s**. That is one exact 4-bar phrase (10.67 s) and the film's best stretch:
- the orb flies into the lens;
- black breath;
- the **drop-2 impact on the downbeat**;
- the crane into the UI-card ring;
- lift-off and the echo exit;
- the panel tunnel up to the stutter.

It exercises 2D, 2.5D, Blender and beat sync together.

### 8.1 Tool calls

```text
1. analyze_music_beats {assetId:"music"}                  → NEW fields: tatum 0.1666, bpm 90, bars[], phrases[], drops[26.893]
2. get_brand_kit {section:"identity"}                      → NEW kit.hero (pearl-core, colors, motion.drop)
3. create_3d_scene {preset:"orb-horizon-ring", hero:kit.hero,            (NEW tool + preset)
     cards:[screen1..screen6], start:28.267, duration:4.767}
4. create_3d_scene {preset:"panel-tunnel", hero:kit.hero,                (NEW)
     screens:[screen2,screen5], start:33.033, duration:3.2,
     passRate:"eighth"}                                                   (NEW param, reads the beat grid)
5. render_3d_scene {sceneId:A, quality:"draft"}; render_3d_scene {sceneId:B, quality:"draft"}   (NEW)
   → place at once; queue quality:"final" in the background; drafts swap for finals when done
6. create_motion_scene {scene:S1, start:25.567, sfx:false}   // UI tail → into lens → black → 2D drop
7. create_motion_scene {scene:S2, start:28.267, sfx:false}   // Blender ring + 2D glow/echo overlays
8. create_motion_scene {scene:S3, start:33.033, sfx:false}   // Blender tunnel + stutter + flash
9. snap_cuts_to_beats {grid:"sixteenth", rule:"pickup", lockPhrases:true}   (NEW params)
10. run_frame_qa {start:25.567, end:36.233}; consult_council {member:"director"}
```

### 8.2 3D scene JSON: `orb-horizon-ring`

This is a bridge request, extending the proof's `request.json` format (Blender Z-up, metres). NEW marks everything the proof script doesn't support yet.

```jsonc
{
  "preset": "orb-horizon-ring",                               // NEW
  "out": "<project>/3d/orb-horizon-ring/<hash>",               // project folder, never work/
  "width": 1920, "height": 1080, "fps": 30, "duration": 4.767, // f849–991 (143 f)
  "engine": "cycles", "samples": 64, "view_transform": "Standard",        // NEW option
  "world": { "color": "#09051e", "strength": 0.3 },
  "objects": [
    { "id": "platform", "kind": "cylinder", "radius": 3.0, "depth": 0.04, "position": [0,0,-0.02],   // NEW kind
      "material": { "preset": "plastic", "color": "#1a1154", "roughness": 0.35, "coat": 0.2 } },
    { "id": "rim", "kind": "torus", "major": 3.0, "minor": 0.004, "position": [0,0,0.001],
      "material": { "preset": "emission", "color": "#cfd8ff", "strength": 20 } },
    { "id": "orb", "kind": "hero", "state": "pearl-core", "radius": 0.12, "position": [0,0,0.14],    // NEW kind/state
      "light": { "color": "#6f6cff", "power": 800, "radius": 0.15 },                                // NEW
      "positionKeys": [ {"t":0,"v":[0,0,0.14]}, {"t":4.267,"v":[0,0,0.14],"ease":[0.45,0,0.55,1]},
                        {"t":4.633,"v":[0,0,0.29],"ease":[0.7,0,0.84,0]}, {"t":4.733,"v":[0,0,4.3]} ],
      "track": true },                                                                               // NEW → objects.json
    { "id": "cards", "kind": "ring-array", "count": 6, "radius": 2.2, "face": "in",                 // NEW
      "item": { "kind": "ui-card", "size": [1.6,1.0], "corner": 0.06, "images": "$screens",          // NEW kind
                "material": { "preset": "ui-screen", "emission": 0.6, "roughness": 0.35, "coat": 0.5 } },
      "bob": { "amp": 0.02, "period": 2.5, "phase": "seeded" },
      "lift": { "at": 3.1, "stagger": [0.133, 0.267], "dz": 3.0, "dur": 0.333, "ease": [0.55,0,1,0.45] } },
    { "id": "slabs", "kind": "ring-array", "count": 12, "radius": 4.0, "face": "in",
      "item": { "kind": "box", "size": [0.8,0.02,1.2], "material": { "preset": "plastic", "color": "#0b0820", "roughness": 0.2 } },
      "sink": { "at": 3.1, "dz": -0.3, "dur": 1.0, "fade": true } }
  ],
  "lights": [ { "id": "top", "position": [0,0,5], "power": 200, "size": 4, "color": "#3931aa" } ],
  "camera": {
    "mode": "orbit", "target": [0,0,0.2], "lens": 50, "sensor": 36, "fstop": 2.8, "focus": "orb",   // NEW orbit mode
    "orbitKeys": [
      { "t": 0.000, "v": { "elevation": 2,  "azimuth": 0,  "radius": 16  }, "ease": [0.16,1,0.3,1] },
      { "t": 0.500, "v": { "elevation": 38, "azimuth": 0,  "radius": 6.5 }, "ease": "linear" },
      { "t": 1.567, "v": { "elevation": 38, "azimuth": 10, "radius": 6.5 }, "ease": [0.6,0,0.4,1] },
      { "t": 2.100, "v": { "elevation": 38, "azimuth": 10, "radius": 13  }, "ease": "linear" },
      { "t": 4.767, "v": { "elevation": 38, "azimuth": 14, "radius": 13  } } ] },
  "outputs": { "frames": "png-rgba", "camera": "camera.json", "objects": "objects.json" }          // NEW objects.json
}
```

### 8.3 MotionScene JSON sketches

The vocabulary is `src/motion/types.ts`; every key `ease` shapes the segment that *starts* at that key.

**S1: UI tail → into the lens → black → 2D drop** (f768–848; t = 0 at f768; duration 2.7 s):

```jsonc
{ "version": 1, "width": 1920, "height": 1080, "duration": 2.7, "background": "#000000",
  "layers": [
    { "id": "ui", "type": "footage", "source": { "asset": "<ui-world still or P3 scene>", "kind": "image" }, "out": 0.8 },
    { "id": "lens-orb", "type": "shape", "out": 0.8,
      "shape": { "shape": "ellipse", "size": [226,226],
                 "gradient": { "kind": "radial", "stops": [[0,"#3a5cf0"],[0.7,"#8fa4ff"],[1,"#eef1ff"]] } },
      "transform": { "position": [1330,470],
        "scale": { "k": [ {"t":0.500,"v":100,"ease":[0.82,-0.02,1,0.01]}, {"t":0.767,"v":500} ] } },  // Ø 226→1131 in 8 f
      "effects": [ { "type": "glow", "radius": 30, "intensity": 0.6 } ] },
    { "id": "floor", "type": "shape", "in": 1.2,
      "shape": { "shape": "rect", "size": [1920,500],
                 "gradient": { "kind": "linear", "stops": [[0,"#0a1640"],[1,"#00000000"]], "from": [0,0], "to": [0,500] } },
      "transform": { "position": [960,830] } },
    { "id": "horizon", "type": "shape", "in": 1.2,
      "shape": { "shape": "line", "points": [0,0,580,0], "stroke": "#ffffff", "strokeWidth": 2 },
      "transform": { "position": [960,578],
        "opacity": { "k": [ {"t":1.2,"v":0}, {"t":1.3,"v":100} ] } },
      "effects": [ { "type": "glow", "radius": 24, "intensity": 1.2, "color": "#5a7bff" } ] },
    { "id": "orb", "type": "shape", "in": 1.233, "motionBlur": true,
      "shape": { "shape": "rect", "radius": 80,
        "size": { "k": [ {"t":1.233,"v":[160,326],"ease":"hold"}, {"t":1.333,"v":[160,326]},           // f808 contact
                         {"t":1.367,"v":[160,209]}, {"t":1.467,"v":[160,168],"ease":"sine-in"},       // retract, apex f812
                         {"t":1.567,"v":[160,207]}, {"t":1.600,"v":[160,177]}, {"t":1.667,"v":[160,160]} ] },
        "gradient": { "kind": "radial", "stops": [[0,"#ffffff"],[0.8,"#eef1ff"],[1,"#c9d4ff"]] } },
      "transform": {
        "position": { "k": [ {"t":1.233,"v":[960,-85],"ease":"linear"},      // 165 px/f, linear
                             {"t":1.333,"v":[960,410]},                      // impact on 11.1.1 (f808)
                             {"t":1.367,"v":[960,468],"ease":"sine-out"},
                             {"t":1.467,"v":[960,400],"ease":"sine-in"},     // rebound apex, 0.55 Ø
                             {"t":1.567,"v":[960,478],"ease":"ease-out"},    // second touch (f815)
                             {"t":1.667,"v":[960,479]} ] } },                // rests ~15 px above the line
      "effects": [ { "type": "glow", "radius": 22, "intensity": 0.5 },
                   { "type": "echo", "count": 6, "dt": -0.033, "decay": 0.75, "merge": "capsule" } ] },   // NEW effect
    { "id": "core", "type": "shape", "parent": "orb", "in": 1.333,
      "shape": { "shape": "ellipse", "size": [90,90], "fill": "#3a5cf0" },
      "transform": { "opacity": { "k": [ {"t":1.333,"v":0}, {"t":1.4,"v":90} ] } },
      "effects": [ { "type": "gaussian-blur", "radius": 14 } ] }
  ] }
```

**S2: ring composite** (f849–991; t = 0 at f849; duration 4.767 s):

```jsonc
{ "version": 1, "width": 1920, "height": 1080, "duration": 4.767, "background": "#000000",
  "layers": [
    { "id": "ring3d", "type": "footage",
      "source": { "sequence": { "dir": "<project>/3d/orb-horizon-ring/<hash>", "fps": 30, "frames": 143 } } },  // NEW source.sequence
    { "id": "cam", "type": "camera", "fromFile": "<…>/camera.json" },                                       // NEW: keys from Blender
    { "id": "orb-glow", "type": "shape", "blend": "add",
      "track": { "objects": "<…>/objects.json", "id": "orb", "scaleWith": "radius" },                        // NEW 2D-on-3D tracking
      "shape": { "shape": "ellipse", "size": [140,140],
                 "gradient": { "kind": "radial", "stops": [[0,"#8fa4ffcc"],[1,"#8fa4ff00"]] } } },
    { "id": "orb-exit-echo", "type": "shape", "in": 4.6,
      "track": { "objects": "<…>/objects.json", "id": "orb" },
      "shape": { "shape": "rect", "radius": 30, "size": [60,60], "fill": "#ffffff" },
      "effects": [ { "type": "smear", "axis": "velocity", "max": 6 },                                        // NEW
                   { "type": "echo", "count": 8, "dt": -0.033, "decay": 0.8, "merge": "capsule" } ] }        // NEW
  ] }
```

**S3: tunnel + stutter + flash** (f992–1097; t = 0 at f992; duration 3.533 s). One Blender sequence, three footage layers:

```jsonc
{ "version": 1, "width": 1920, "height": 1080, "duration": 3.533,
  "layers": [
    { "id": "t1", "type": "footage", "out": 3.2,
      "source": { "sequence": { "dir": "<…>/panel-tunnel/<hash>", "fps": 30, "frames": 106 } } },  // NEW
    { "id": "t2", "type": "footage", "in": 3.2, "out": 3.4, "startTime": 0.2,      // 14.3.1: layer clock 3.0 at t 3.2 → repeats 6 f
      "source": { "sequence": { "dir": "<…>/panel-tunnel/<hash>", "fps": 30, "frames": 106 } } },
    { "id": "t3", "type": "footage", "in": 3.4, "out": 3.533, "startTime": 0.133,  // 14.3.2: clock 3.267 at t 3.4 → repeats 4 f
      "source": { "sequence": { "dir": "<…>/panel-tunnel/<hash>", "fps": 30, "frames": 106 } } },
    { "id": "flash", "type": "solid", "color": "#ffffff", "blend": "add", "in": 3.467,
      "transform": { "opacity": { "k": [ {"t":3.467,"v":40}, {"t":3.5,"v":100} ] } } }
  ] }
```

**Beat check for this recipe.**

| Event | Frame | Position | Offset |
|---|---|---|---|
| Cut to black | f792 | 10.4.2 | pickup |
| Impact | f808 | 11.1.1 | +0.2 f |
| Crane | f849 | 11.3.1 | +1.2 f |
| Lift-off | f942 | 12.3.4 | — |
| Tunnel cut | f992 | 13.2.2 | — |
| Stutters | f1088 / 1094 / 1098 | 14.3.1–14.3.3 | — |

All of these come from `analyze_music_beats` after the §7.4 fix. Nothing in S1–S3 is hand-timed once the grid is right.

---

## 9. Top 10 improvements

| # | Improvement | Why (this film) | Size |
|---|---|---|---|
| 1 | **Fix tempo detection** (tatum-first, bar and phrase phase from the kick + RMS steps). Return bars, phrases, drops, breaks and the final hit. Add a regression test on this track. | Helios would read this track as 120 BPM (a triplet alias), and every beat-driven tool would then be wrong | S |
| 2 | **`BrandKit.hero`** (shape, states, colours, 3D material, motion, motifs, worlds, logo binding) + brandify support + a continuity planner for exit → entry | The whole film is one hero object; Helios has nowhere to store it | M |
| 3 | **`portal-accelerando` template** (re-trimmed constant-speed dolly, 3-3-2-2-2-1-1-1 on the 16th grid, flash frames, nested rings) | The signature transition; every engine feature it needs exists except the grid | S |
| 4 | **P5 subset: `echo`, `smear`, `star-glint`, `god-rays`, `light-cone`** | The hero's personality (echo ×3, smear ×3) and the light vocabulary | M |
| 5 | **Blender `glass-orb` (pearl-core) + `thin-film-bubble`** with `gradientEnv`, full-frame glass rendering, the Standard view transform for brand colours, **`objects.json`**, and DOF/shutter in `camera.json` | The §5 proof's glass on alpha cannot refract Helios backgrounds; AgX shifts brand blue; 2D glints need 3D object positions | M |
| 6 | **P6 `solid2_5d` sphere** with sliding decals, an animatable light, and a `shading 0→1` flat→shaded morph; plus a `wireframe-box` helper | Act 1's iris orb and the flat→3D match transform, both 2.5D | M |
| 7 | **`orb-horizon-ring` + `ui-card-ring`** (one scene, crane from edge-on rim to ¾ view, lift-off stagger), with the 2.5D motion-engine version as the instant draft | Drop-2 phrase; the cards are planes, so a 2.5D draft works today | L |
| 8 | **`panel-tunnel`, `sphere-bouquet`, `device-light-fountain`, `floating-shapes`** presets | The 27 % of the film that needs a renderer | L |
| 9 | **`world-resolve-logo` + `vesica-birth` templates**, plus `followPath`/pen-draw, gradient strokes and colour keys on shape fills | Bookends and the pen beat: the identity-specific 2D | M |
| 10 | **`create_brand_film` generator + rhythm QA + `genre:'brand-film'`** (SFX off; cut on the pickup, land on the beat; world switches on phrase lines) | Turns all of the above into "make me a brand film like aflow" | L |

### Notes for REFERENCE-FILMS-PLAN.md (this film only; the plan was not edited)

**§1 calibration.** "aflow cuts: 89 % against 50 % by chance" uses the whole-film baseline. Inside the music the chance of being within ±2 f of an onset is **73 %**, and 8 of the 19 "cuts" are loop restarts. The real sync is phrase-level (3 of 3 at 1.25 % chance) plus the rule "cut on the pickup, land the motion on the beat" (6 of 9 against 20 %).

**§2.1:**
- **Infinite-zoom accelerando:**
  - the list omits the 22 f loop (10 + 10 + 2 with flashes);
  - the beat maths assumes 120 BPM. At the true 90 BPM (beat = 20 f), the loops are **dotted 8ths → 8ths → 16ths (3-3-2-2-2-1-1-1)**, not "1 beat → ½ → ¼";
  - each loop is a **constant-speed dolly** (1/r linear), re-trimmed, not an exponential zoom.
- **Music:** "hard cuts on downbeats" is only true for the phrase lines.
- **Character token for the aflow orb:** there is **no squash**. The width stays constant. The fall is linear at 165 px/f with h/w 2.0; the rebound is 0.55 Ø; it settles in **10 f**, not 8.

**§2.2:** The hero is a **pearl-core / iris orb**, not a clear or iridescent glass. Thin-film iridescence belongs to the secondary bubbles.

**§3.6:**
- "Tighten 16 → 5 f on the beat" → on the 16th grid.
- "Sweeps on the 8ths" → the pass rate is about 8ths, but not phase-locked.
- "Squash & stretch" → stretch-only.
- "3D ring of UI cards (true 3D)" → flat planes, 2.5D-capable.
- The rebuild's `orb-horizon-ring` preset isn't in P7's list, which has `orb-horizon` and `ui-card-ring` separately.
- `snap_cuts_to_beats {mode:"drop"}` isn't marked NEW, and `mode` does not exist.
- The act-1 orb and the flat→3D swap are 2.5D (P6), and the drop is 2D. Only about 27 % of the runtime needs Blender.
- Missing from the list:
  - smear;
  - wobble;
  - the pen momentum loop (with its measured ease);
  - the palette-flicker pop;
  - the three-phase camera;
  - the world-resolve bloom-clear;
  - the brand-film "no SFX" rule.

**§4:**
- P5 lacks `smear`.
- P6 lacks the flat→shaded morph and an animatable light.
- P7 lacks:
  - `objects.json`;
  - DOF/shutter in `camera.json`;
  - `gradientEnv` / full-frame glass;
  - the view-transform rule;
  - noise-driven thin film;
  - the `cylinder-patch`, `ring-array` and `hero` kinds;
  - orbit-mode camera keys.

**§5:**
- The "Glass/thin-film: Correct" row omits that glass on transparent film refracts only Blender's world, not the Helios background it will be composited over.
- The proof's constant 420 nm film gives a flat tint.
- AgX shifts saturated brand colours.
- `keyframe()` crashes on a key whose `ease` is null.
- EEVEE drafts are unusable for glass, so a glass draft tier needs low-sample Cycles.
