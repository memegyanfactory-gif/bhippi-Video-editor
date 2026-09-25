# P0Ns0rphILY · "Motion Tricks with Emanuele Colombo" (Motion Design School promo)

*2026-09-25. This report finishes the study the first analyst started. Their frame-by-frame notes
(`out/P0Ns0rphILY/notes.md`) and their scripts `measure/m2…m8, fit_eases.py` are the primary source.
On top of those, this pass adds:*

- *new measurements on the full-resolution frames (`measure/*.py`, listed in §4);*
- *6 full-res frames and 12 contact or verification sheets, examined by eye;*
- *a shader-level review of [REFERENCE-FILMS-PLAN.md](../../../REFERENCE-FILMS-PLAN.md) §3.8 and §4 P6.*

**Material.** 574 frames at 15 fps (the upload; the source was probably 30 fps), 1920×1080, 38.27 s,
male VO over a music bed. Frame numbers are 1-based, and t = (f − 1)/15.

**Reproducing the measurements.** Put the full-res frames in `out/P0Ns0rphILY/fullres/`:

```
ffmpeg -i src/P0Ns0rphILY.mp4 -fps_mode passthrough -start_number 1 out/P0Ns0rphILY/fullres/f_%05d.png
```

`measure/common.py` also pulls missing frames on demand.

---

## 1. What the film is

**The film.** A 38 s course promo in which one designer's tricks make flat After Effects layers read
as 3D. They are shown on a small cast of googly-eyed shape characters in a pastel-pink world:

- a teal ball;
- a violet "jelly" cube;
- an orange cyclops ball.

**Three layers run at once:**

1. **Tutorial language.** A black macOS cursor drags a bounding box, bends a bezier smile with blue
   vertex squares, and scales in a wireframe cube helper. It draws dotted motion paths with keyframe
   squares, and finally sits in a mock of the AE UI with a timeline.
2. **The payoff.** The finished soft "inflated" look snaps in over the helper graphics, on a hard
   switch.
3. **The pun.** AE itself becomes the world:
   - the layer duration bars become extruded slabs;
   - the keyframe icons become 3D prisms (◆ = linear key, ⧗ = easy-ease key);
   - the decoration after TRICKS in the title is those same icons.

**The user's note ("looks 3D but is 2D visually") is right, and the measurements sharpen it.** The
film is mostly built from **cheats, not geometry**:

- The **eyes are flat cards** that never travel to the limb.
- The **rim light is an inner glow** laid over a four-corner colour field.
- The **tumbling cube is a feathered square with one sliding shadow band.**
- **Sphere → cube is a hard swap** hidden at the moment the face is edge-on.
- The **depth of field is hand-keyed** as a focus *band*.

Only a few shots use genuine 3D projection:

- the checker sphere (a CC Sphere-style wrap with a true meridian terminator);
- the cylinders of the exploded view;
- the slab tunnel (AE 3D layers and a camera flying through, with a vanishing point).

**What this means for Bhippi.** A `solid2_5d` engine should reproduce *this cheat vocabulary*. It
should not be a physically correct mini-renderer, which would look *different* from the reference
(§7).

---

## 2. Beat-by-beat breakdown

VO words are the auto-captions. Obvious ASR errors are corrected in brackets. The picture **leads**
the matching words by 0–1.4 s:

- "3D look" is spoken at 9.14 s; the jelly cube lands at 8.6 s.
- "arcs" is spoken at 11.54 s; the arcs are drawn from 10.13 s.
- "character animation" is spoken at 16.9 s; the limbs sprout at 15.9 s.

| # | Frames | Time (s) | What happens | VO |
|---|---|---|---|---|
| 1 | 1–41 | 0.00–2.67 | **Title zoom-out** from 538% with a rack focus (sharp by f9–10). The 2nd O of MOTION is a **checker/violet sphere spinning** about a near-vertical axis (f9–f32). At f29–31 it becomes a torus as a **hole opens from the centre**. The 1st O is a ball character that blinks (f20) and then also becomes a torus (f37–41). The subtitle is revealed by a **mask sliding right → left** (f17–36). | "Welcome to Motion [Tricks]" (0.34–1.88) |
| 2 | 41–49 | 2.67–3.20 | Hold of 0.53 s. The letter gradients keep drifting in hue. | "take your animation to the next level" (2.30–3.86) |
| 3 | 49–61 | 3.20–4.00 | **Whip up and out**: exponential ease-in, velocity ×1.4 per frame. The cursor rises from the bottom (f60–64). | |
| 4 | 65–91 | 4.27–6.00 | **AE tutorial.** The cursor drags a bounding box and a checker-filled ellipse grows 134 → 617 px (f76–83) with its handles. It turns flat pink, and a bezier smile path with 3 blue vertices appears (f86–91). | "we start by addressing the visual elements of your [animations]" |
| 5 | 92–112 | 6.07–7.40 | **Hard switch to the finished look**: a teal ball with a white smile and closed eyes, **9% squash-pop** (settles in 3 f). At f103 comes a **1-frame 15% squash hit** that swaps the face to googly eyes; rosy cheeks follow. | |
| 6 | 113–129 | 7.47–8.53 | A **wireframe cube helper** scales in with overshoot. The eyes translate up 0.24 r, then **flip about X like a card**: height ×0.58 at f127, a thin line at f128, gone at f129. The ball dips 166 px and returns. The shading never moves. | "and how to give them a 3D look and feel" (8.0–9.9) |
| 7 | 130–152 | 8.60–10.07 | At f130 the ball is **swapped for the jelly cube in one frame**, while the face is edge-on. The swap is disguised by a **twist/bow-tie warp** (f131–135) with bending wireframe edges. The eyes slide back up (f136–139). The cube and helper drop out with an ease-in (f145–152). | |
| 8 | 153–215 | 10.13–14.27 | **Arcs.** The cursor draws a dotted motion path with frame ticks and keyframe squares. The cube enters huge (near the lens) and **tumbles ≈360° in 16 f** down its arc while receding 2.8×. The ball **rolls** along its arc: the eye card spins in Z at about the no-slip rate, flips edge-on and hides for 3 f. The orange ball arcs in and they stack. | "we'll work on arcs and make sure your animations are flowing smoothly" (9.98–13.82) |
| 9 | 216–232 | 14.33–15.47 | **Squash cascade** down the stack. The box pops into a flared trapezoid with curved edges (bend). The orange ball opens one eye (the eyelid is a circle wipe). | "to top it off" |
| 10 | 233–256 | 15.53–17.00 | The box **card-flips** about Y with a white trapezoid **light cone** behind it. **Rubber-hose arms and legs** sprout (navy, round caps). The body yaws about 40° (front and side faces swap). | "…dive into advanced character animation" (15.08–17.18) |
| 11 | 257–307 | 17.07–20.40 | **Run cycle in place, an exact 12-frame loop.** A parallax world: blurred pink hills, clouds, grass. **Fly-bys** go from huge and blurred to sharp to small and blurred (a focus band). | "learning new hacks that will help you add more layer[s] of complexity" |
| 12 | 308–320 | 20.47–21.27 | **Cut** on a navy foot wiping the lens. **Exploded view**: the limbs become cylinders (a lit lavender cap or a flat navy cap) and the hands and feet become spheres. They fly out in z while the head stretches toward camera. Pull back into an app window. | "…to your projects" |
| 13 | 321–352 | 21.33–23.40 | **AE-like UI mock** with the ball in the viewer, DOF props (capsule, clover, cube corner, gradient sphere) and face changes on squash. A slow push-out (1.14 → 1.0). | "as always you'll have tons of [assignments] to explore" |
| 14 | 353–406 | 23.47–27.00 | The camera **tilts down into the timeline.** The bars become **extruded slabs** and the key icons become **two-tone prisms**, with the jelly-cube character. From f394, a **hyperspace fly-through**: slabs stretch to a vanishing point, with heavy motion blur. | "…and new tricks that will get you the most of your animation" (26.1–28.1) |
| 15 | 407–423 | 27.07–28.13 | **Cut** to a squashed close-up of the ball, which pulls back and settles (1.17 → 1.0). A **rack defocus** of the whole scene (f414–420) while a huge violet ring enters **from in front of the lens** (f421). | |
| 16 | 424–460 | 28.20–30.60 | **Portal.** The old scene survives only inside the **counter of the O** and shrinks to a dot by f427. **ENROLL NOW** pulls back 585% → 100% (f424–446), then holds while the hue drifts. | (VO ends 28.1; [Music] 29.86) |
| 17 | 461–574 | 30.67–38.20 | **Hard cut** to the end card "motiondesign.school" (violet), sharp. DOF-blurred props drift and rotate: a cube corner, a torus tilting 70° → 50°, a capsule spinning at a constant 15.4°/s, a glossy sphere over a big orange sphere. The music fades out. | |

---

## 3. Technique catalogue: every fake-3D trick

Each entry gives the **frames**, **what it is**, the **AE build** (the most likely one, inferred
from the pixels), **the math**, and the **Bhippi status** today. "NEW" marks something this report
proposes.

### T1 · Checker hemisphere spin (f9–f32)

**What it is.** A sphere painted half with the AE transparency checker and half solid violet.

- **The checker is a true lat/long grid.** The rows converge at a pole that is tilted about 20°, and
  the squares compress toward the limb.
- **Only the violet half is shaded.** The checker is flat apart from a specular blob at the top
  right, and that blob stays put while the sphere spins: the light is world-locked.
- **The boundary changes behaviour halfway through:**
  - *f9–f21:* it is a clean half-ellipse, a meridian, so this part is a genuine rotation;
  - *f22–f28:* it becomes an **S-curve**. No great circle can project to an S-curve, so the second
    half is a **wipe that is slanted in texture space** (a diagonal edge in the flat texture),
    wrapped onto the sphere *while* it spins.

**AE build.**
1. A flat comp: checker plus a violet solid, with an animated diagonal linear wipe.
2. **CC Sphere** with *Rotation Y* animated and *Rotation X/Z* tilted about 20°, plus its shading.
3. A spec highlight that is not rotated with the sphere.

**The math.** Let θ be the angle between the checker pole and the view axis, with the rotation axis
in the image plane:

- **visible checker fraction** F = (1 + cos θ)/2, so θ = arccos(2F − 1);
- the **terminator crosses the horizontal centre line** at x/r = ±cos θ: the half-ellipse has
  x-radius **r·|cos θ|** and y-radius r.

**Measured** (`checker_run.py`, `spin_fit.py`; prior `m2_checker_sphere.py` agrees within 3–5°):

| Frame | 9 | 12 | 15 | 18 | 19 | 22 | 23 | 24 | 25 | 26 | 28 | 29 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Edge x/r | 0.045 | 0.12 | 0.32 | 0.68 | — | −0.84 | −0.42 | 0.07 | 0.42 | 0.65 | — | — |
| θ (deg) | −87 | −83 | −71 | −47 | −28 | +32 | +65 | +94 | +115 | +131 | +153 | +158 |

- **Speed:** 1°/f at f10, 10°/f at f18, a peak of 20–33°/f (300–500°/s) through f19–f24, and 5°/f at
  f29.
- **Fit:** θ = −90° → **~170° by f32.5**, cubic-bezier **(0.77, 0.04, 0.43, 0.93)**, rmse 1.5°.
  - This is a long wind-up, a whip through face-on, and a softer settle.
  - The prior analyst's area-only fit is (0.73, 0.21, 0.52, 0.96), ending at 156° by f29.7, with an
    rms of 4°.

**Bhippi status.** Not possible today: there is no sphere projection and no spherical texture
mapping. `solid2_5d` surface decals (§7) would cover it.

### T2 · Sphere → torus "O" (f29–f31, f37–f41)

**What it is.** A hole opens at the centre of the violet sphere: it is barely visible at f30, about
0.35 r at f31, and at full counter size a few frames later. The spec and rim stay continuous. The
same happens to the eye ball (f37–41): the eyes close first, then the hole grows.

**AE build.** A circle mask (subtract) growing from the centre, with an inner shadow/bevel on the new
edge. Alternatively, a swap to the letter O hidden behind the growing hole.

**The math.** A torus with major radius R and tube radius ρ (outer radius R + ρ = 1) is a sphere
when R = 0. The hole appears when R > ρ, i.e. **hole radius = R − ρ = 2R − 1**. Animating R from 0
to R_O gives exactly this "hole from the centre".

**Bhippi status.** Only a flat version is possible, with an animated ellipse mask in subtract mode
plus a feather. The shading of the inner wall is missing. An SDF torus would cover it.

### T3 · Soft rim-lit sphere shading (every sphere; measured at f105)

**What it is.** **Not Lambert.** The darkest area is *inside* the disc, at about (0.3, −0.4) r, and
the body **brightens toward the limb in every direction** by 15–35 L*.

- The limb carries a **hue that depends on direction**: mint at the top left, sky at the top right,
  blue at the bottom left, green-teal at the bottom right.
- There is a broad soft **specular blob** at the top right.
- A white **back-glow** of about 1.5–2 r sits behind the ball.
- **AO halos** darken the body around the eyes.
- f311 shows the construction directly: an outer disc whose colour is the rim colour, plus a
  **smaller, blurred, darker core disc offset downward**.

**AE build.**
1. A circle with a **4-Color Gradient**.
2. **Inner Glow** in the rim colours, large (about 15–20% of r).
3. A blurred dark ellipse (the core), offset down.
4. A blurred white ellipse (the spec).
5. **Outer Glow**: white, large.
6. Small blurred dark ellipses under the eyes (AO).

**The math**, fitted by least squares over every body pixel of the f105 ball (`shade_fit.py`,
rmse 4.3 L*), with n the sphere normal and the view along +z:

```
L*(n) = 40.9 + 35.4·√(1 − n_z) − 7.5·n_x + 20.0·n_y
```

- The **rim term dominates**: √(1 − n_z) rises early, which is why the whole outer half is lifted.
- The **directional term is a screen-space gradient on n.xy**, pointing to 111° (top, slightly left)
  with 21 L* per unit. It is *not* n·L with a z component.
- **Specular:** a Gaussian blob in normal space centred at (0.28, 0.52), peak +19.7 L*, half-max
  radius 0.26 r.
- **Hue field** (medians of the outer ring):

  | Quadrant | Colour |
  |---|---|
  | TL | `#83c8c7` |
  | TR | `#76b6cc` |
  | BL | `#3088b2` |
  | BR | `#2d7f85` |
  | Core | `#215d69` |

- **Back-glow profile (L*):** 97.5 at 1.05 r, 96.5 at 1.2 r, 94.9 at 1.4 r, 91 at 1.9 r, then the
  background (89) at about 2.5 r.

**Bhippi status.** Only as a stack of about 5 shape layers: a radial-gradient ellipse, a blurred
core, a blurred spec and a `glow`. That breaks "one layer, not forty" (fact 10) and cannot rotate. It
is the `look:'soft-rim'` of the new primitive (§7.3).

### T4 · Eye decal = a flat card, not a surface decal (turn f113–129; roll f164–182)

**What it is.** This is the main correction to the plan. The eyes **never slide to the limb.**

- **The turn** (f113–129, `eyes_rot.py`):
  - First a **pure translation** up by 0.24 r (f114–118). The eye height stays at 0.44 r, so there
    is no foreshortening.
  - Then a **card flip about X**: the height goes 0.44 → 0.255 (f127) → about 0.05 (f128) → hidden
    (f129).
  - Meanwhile the eye centroid only reaches **−0.19 to −0.21 r**.
  - If the eyes were on the surface, a height ratio of 0.58 would put them at latitude 55°, which is
    y = −0.82 r.
- **The roll** (f164–182, `roll_spin.py`): the eye pair **stays at the ball's centre** (offset
  < 0.09 r).
  - It **spins in Z at 19–32°/f**, against a no-slip rate v/r of 15–36°/f (ratio 0.9–1.4).
  - It flattens edge-on *through the centre* (aspect 0.43 → 0.13), is hidden for 3 frames
    (f175–177), and reappears at the centre.

**AE build.** The eyes precomp is a **3D layer parented to the ball's centre null**, with its anchor
pushed back so it rotates on a short arm. Rotation X/Y is keyed for the turn; Z rotation is linked
to the path distance for the roll. The body layer is untouched.

**The math.**
- A card on an arm of length a·r, rotated by φ, projects to **y = −a·r·sin φ** with height
  **h = h₀·cos φ**, and is culled when cos φ < 0.
- The measured f127 point (y = −0.21 r at cos φ = 0.58) gives **a ≈ 0.26**.
- Roll: **θ_z = s/r**, with s the arc length travelled.

**Bhippi status.** Possible today as 2D keyframes: position.y = −a·r·sin φ and scale.y = cos φ, or a
`threeD` layer with rotationX and an anchor z. There is no helper, so the AI would have to derive
this. It becomes the `decals[].mode:'card'` of §7.

### T5 · Swap at occlusion, disguised by a twist (f129 → f130)

**What it is.** A kind change with no morph at all.

- At f129 the face card is edge-on and hidden, so the ball is a featureless sphere.
- At f130 the layer is replaced by the jelly cube (one frame).
- For 5 frames the cube is **twisted into a bow tie** (left and right edges pinched, f131–135) while
  the wireframe edges bend, which reads as a fast yaw.
- The eyes then flip back in (f136–139).

**AE build.** Two layers cut on the same frame. A **Twist or Bezier Warp** on the cube settles 30° →
0 over 0.33 s.

**The math.** Twist about the vertical axis: **p′ = R_y(k·p.y)·p**, where k decays to 0 with the
same ease as the settle. The swap time is chosen where the **decal visibility cos φ = 0**, so the
silhouettes of both kinds are "blank".

**Bhippi status.** Swapping two layers is possible. There is no twist deformer on shapes, although
`wave-warp` and `displacement` exist.

### T6 · Jelly cube tumble (f158–f176)

**What it is.** A soft, rounded, **feathered** violet square:

- edges feathered over about 4–6% of its size;
- **edges lighter lavender** (an inner glow), `#c8b4fb` against a core of `#7772f2`;
- one **darker, blurred inner band** (the "shadowed face") that slides **bottom → top** once per 90°:
  - f160 bottom, f163 middle, f166 top, f169 flat (no band);
  - f170 bottom, f172 middle, f174–175 top.

**Faces alternate light and dark** (fixed per-face tones, not lit). The silhouette stretches only to
**w/h ≈ 0.78–0.80, i.e. about 1.25×**, where a real cube at 45° would reach 1.41×.

**AE build.**
1. A rounded rectangle with inner glow and feather.
2. A blurred dark rectangle whose position and height are keyframed per quarter turn.
3. Scale Y and position.

This is a 2D cheat, not six faces.

**The math.** For a cube pitching by θ about screen X (orthographic):

- visible face heights are **s·|cos θ|** and **s·|sin θ|**;
- the face boundary sits at a fraction **sin θ/(sin θ + cos θ)** of the silhouette height;
- the silhouette height is **s(|cos θ| + |sin θ|)**.

The band positions give **≈360° in 16 f (f160 → f176, 1.07 s, ≈22°/f ≈ 340°/s)**, with face-on
moments near f160, f164, f169 and f173–176. At the same time the cube falls down its arc and recedes
**2.8×** (silhouette height 725 → 257 px).

**Bhippi status.** It can be faked with 2–3 shape layers and masks. There is no rounded-box
primitive with per-face tones.

### T7 · Motion-path arcs, auto-orient and rolling (f153–f215)

**What it is.** AE's motion-path display is re-drawn as art:

- a dotted pink curve whose **dots are per-frame samples**, so their spacing *is* the speed;
- **blue keyframe squares** with tangent handles.

Objects travel on these arcs: the ball rolls (T4), the cube tumbles (T6), and the orange ball lands
on the stack.

**AE build.** Position keys with spatial bezier tangents; the path is shown or traced by an animated
Trim Paths on a copy. Auto-Orient is off for the ball (the roll is driven separately) and partly on
for the cube.

**The math.**
- Segment i is a spatial cubic with points P0 = p_i, P1 = p_i + out_i, P2 = p_{i+1} + in_{i+1} and
  P3 = p_{i+1}.
- The temporal ease e(t) is applied to **arc length**: s = e·L_i, and u = u(s) comes from a
  lookup table.
- Auto-orient: rot = atan2(P′(u).y, P′(u).x) + offset.
- Roll: θ_z = s_total/r.

**Bhippi status.** Not possible: there are no spatial tangents on position (map A6) and no
auto-orient. Plan P1 adds both.

### T8 · Squash-and-stretch pops (f92–96, f103–110, f216–228, f407–412)

**Measured** (`m6_squash.py`, confirmed):

| Event | Frames | Sequence | Settles |
|---|---|---|---|
| Pop | f92–f96 | w/h 0.99 → **1.093** → 1.064 → 1.00 → 0.99 | **3 f (0.2 s)** |
| Face-swap hit | f103–f110 | **1-frame 1.176** (h −15%) → 1.00 → 0.976 → **0.969** (3% stretch) → 0.986 | f110 (**7 f**) |

In the stack cascade the box pops into a flared trapezoid with curved top and bottom: a bend
deformer.

**AE build.** Scale keyframes, and CC Bend It or a Bezier Warp for the trapezoid.

**Bhippi status.** Scale keys are possible. There is no bend deformer.

### T9 · Rubber-hose character, body flex, run loop (f239–f307)

**What it is.**
- **Legs:** navy `#303276` capsules about 55 px thick at full res, with a single soft bend. The near
  foot is lighter blue (`#3750a4`), a depth cue.
- **Arms:** navy two-segment capsules that swing opposite the legs.
- **Body:** the jelly box, which **flexes from a rectangle to a flared trapezoid** with a curved
  bottom at every step.
- **Cyclops:** the orange ball on top bobs with overlap (follow-through).

**Run cycle.** An **exact 12-frame loop (0.80 s)**. The leg L−R signal repeats identically at f263,
f275, f287 and f299 (`run_cycle.py`). The body dips once per step, so there are **6 f per step
(0.40 s = 150 steps/min, close to the ~144–148 bpm bed)**.

**AE build.** A rubber-hose rig (Duik/RubberHose) with `loopOut('cycle')`, and CC Bend It on the
body.

**Bhippi status.** Not possible. There is only `create_stick_figure`, and no rubber-hose limbs
(plan P8).

### T10 · Depth fly-bys with a focus *band* (f257–f292; also the UI shots and the end card)

**What it is.** The blue ball flies from in front of the lens to far behind the character.

**The blur is V-shaped, not monotonic** (`dof_flyby2.py`; the prior `m8_flyby_dof.py` agrees):

| Frame | 261 | 262 | 263–267 | 268 | 269–270 |
|---|---|---|---|---|---|
| Projected radius r (px) | 444 | 344 | 273 → 123 | 93 | 67–63 |
| Edge σ (px) | 30 | 9 | **≈1 (sharp)** | 5 | 10–17 |

It is **sharp over a 2.2× range of scale** and blurs on either side. The near side ramps about
**2× faster** than the far side:

- **near:** σ ≈ 40·(r/r_near − 1), with r_near ≈ 273 px;
- **far:** σ ≈ 24·(1 − r/r_far), with r_far ≈ 123 px.

A single thin-lens V fits badly (rmse 13 px), so **this is hand-keyed Gaussian blur, not camera
DOF**.

**AE build.** Gaussian or Camera Lens Blur keyframes per layer, roughly following depth.

**The math.** Proposed model: for a layer at view depth z, define z_n < z_f as the edges of the
sharp band:

```
σ(z) = k_near·max(0, z_n/z − 1) + k_far·max(0, 1 − z_f/z)
```

Since screen scale ∝ 1/z, z_n/z is just s/s_n. The thin lens is the special case z_n = z_f.

**Bhippi status.** **Not possible.** The camera layer has `focus` and `aperture` (`types.ts:262`),
and `cameraAt` evaluates them (`evaluate.ts:193`), but **no renderer code reads them.** Camera DOF
is a no-op today. Blur can be keyed by hand with `gaussian-blur`, and kit templates already do that
(`overlayTemplates.ts:350`).

### T11 · Exploded cylinders (f309–f316; full res at f311)

**What it is.** The limbs become cylinders:

- **end cap:** a lit lavender radial-gradient ellipse (`#f5d0f5` → `#a878ee`) when it faces the key
  light, or a **flat navy** disc (`#332d6b`) when it doesn't;
- **body:** the hull of the two cap ellipses, with a **gradient along the axis** from navy near the
  cap to greyish lavender at the far end.

The hands and feet become T3 spheres. The head ball is **stretched along its flight** (w/h 0.79).
The parts fly out in z. The near foot disc crossing the lens stays sharp.

**AE build.** Per limb: two ellipses and a 4-point hull shape (or a thick round-cap stroke), with a
gradient ramp along the axis. The z-scatter is done with 3D layers and a camera push.

**The math.**
- Cap ellipse semi-axes: **R** and **R·|a_z|**, where a is the cylinder's unit axis in view space.
  The measured ratio 0.85 means a tilt of 32° from face-on.
- The visible cap is the one with a_z > 0.
- Silhouette (orthographic) = the convex hull of both cap ellipses, i.e. the two outer tangent lines.

**Bhippi status.** Can be faked with shapes, but the hull must be computed by hand. The primitive
covers it.

### T12 · Extruded timeline slabs, keyframe prisms, hyperspace (f353–f406; full res at f387, f401)

**What it is.**
- **Slabs** (teal `#3c9bb8`/`#52b3c6`, violet `#595fe0`/`#8a8bec`, pink `#f39880`, orange `#fb8a17`):
  genuine perspective boxes. The front face is a blurred jelly core with light edges, and the side
  face is lighter.
- **Octahedra** ("◆"): hard **two-tone** facets, white `#f8f8f8` (lit) and dark grey (unlit).
- **Double cones** ("⧗"): a pale periwinkle upper cone over a saturated violet lower cone.
- **Hyperspace, f394–f406:** the camera flies *along* the slabs. They stretch into wedges converging
  on a vanishing point near (900, 520), with strong directional motion blur. A teal sphere passes
  the lens.

**AE build.** AE 3D layers (extruded shape layers in the Cinema 4D/Advanced 3D renderer, or six
solids per box), a 3D camera fly-through, and motion blur.

**The math.** Real perspective: project the 8 box corners with the camera and draw up to 3 faces
whose normals face the camera. The per-face tone is fixed, plus an edge glow. **An orthographic
ray-cast inside a layer quad cannot produce these converging wedges** (§7.1).

**Bhippi status.** Each face could be a `threeD` solid layer (6 per slab, which breaks fact 10), and
there is no per-face shading. Plan P7 (Blender) or a perspective `solid2_5d` would cover it.

### T13 · Through-the-O portal (f414–f446)

**What it is.** The plan has this reversed. It is **the previous scene** that is seen through the
counter of the O.

1. f414–f420: the whole ball scene **rack-defocuses** (7 f).
2. f421: a huge violet ring enters **from in front of the lens**: the O of NOW at 5.85×.
3. From f424 the old scene is visible **only inside the counter**, and it **shrinks independently to
   a dot by f427** (faster than the O), leaving the pink background.
4. ENROLL NOW pulls back to rest.

**AE build.** The previous scene is precomped and track-matted by the O's counter (a circle, or the
glyph's inner contour). The precomp's scale is keyed to 0. The text layer's scale goes 585% → 100%.

**The math.**
- Scale **585% → 100% over f424–f446 (1.47 s)**, cubic-bezier **(0.123, 1.0, 0.517, 1.0)**, rmse
  0.0027 in scale-% space. It starts at full speed and lands with a long settle.
- The prior analyst's camera-z fit is (0.61, 0.72, 0.55, 1.02), rmse 0.0023.

**Bhippi status.** Possible by hand, with a circle mask on a precomp, keyframed scale and a track
matte. There is no "glyph counter as a matte" helper (plan P4 `through-the-letter-counter`).

### T14 · Inflated gradient type with hue drift (f1–f64, f424–f460; full res at f45)

**What it is.**
- **Letterforms:** a heavy geometric sans (Gilroy/Sofia Pro Heavy class).
- **Fill:** a **vertical 2-stop gradient per line**.
  - MOTION: `#c59afb` at the top → `#ac66f6` at the bottom.
  - TRICKS: `#c37df6` → `#9b3df0`.
  - The bluer letters run `#9371fb` → `#523bfa`.
- **Hue band:** it **slides horizontally**. Neighbouring letters drift in *opposite* directions (the
  I goes 269° → 279° while the T goes 251° → 244° over 8 f), so it is a moving band, about
  ±1.2°/f = **15–18°/s**, within a hue range of 241°–279°.
- **Relief:** mostly **flat**. There is a thin light rim of about 4–6 px on 50 px stems, a few
  specular glints, and AO in the counters.
- **The O's are tube-shaded (torus):** here the bevel size is about half the stroke width.
- **Drop shadow:** a **warm peach-pink**, not grey. It measures `#f9d1c3` 4 px under a stem, against
  a background of `#fde6e7` (about −6 L*), and fades by about 30 px.
- **Background:** a radial light centre, `#fce7e7` → `#f8d2d6` at the edges.

**AE build.** Text with **Gradient Overlay** (animated offset or angle), **Bevel and Emboss**
(smooth, size about 5 px, 120°/30°; about 25 px on the O's), Inner Shadow, a coloured **Drop
Shadow**, and a light-centre radial background.

**The math.** The bevel height comes from the distance D inside the glyph:

- h = √(1 − (1 − min(D/size, 1))²), a round profile;
- n = normalize(−∇h·depth, 1);
- shade = n·l − l_z, which gives highlight = max(0, shade) and shadow = max(0, −shade).

§7.4 gives the exact pass list.

**Bhippi status.** Only the drop shadow (the `drop-shadow` effect with a colour) and a solid fill or
`fillColor` animator exist. There are no layer styles, no gradient text fill and no bevel. The
`liquid-glass` effect already derives a normal from blurred alpha (`gl/shaders.ts:405–426`), which
is the closest code to reuse.

### T15 · Title zoom-out with rack focus, and the whip-out (f1–f41, f49–f61)

**Zoom-out** (`zoom_early.py`, `zoom_fit.py`).
- The camera scale is measured with LK from f6 onward (it agrees with the sphere radius to <1%) and
  with **ECC on blurred frames for f1–f5**, where LK failed.
- The move **ramps up** (per-frame ratio 0.965 → 0.892 at f5→6) and then settles over 35 frames.
- Scale **538% → 100% over f1–f41 (2.67 s)**, cubic-bezier **(0.155, 0.195, 0.006, 1.0), rmse
  0.0011** in scale-% space. The log-scale fit gives 0.0057 and the camera-distance fit 0.0061.
- In AE terms: about 16% outgoing influence and **about 99% incoming influence**.
- 50% of the scale change is done by f8 (0.47 s) and 90% by f21 (1.33 s).
- The prior analyst *extrapolated* f2–f5 and got 6.72×. The ECC measurement shows the move was not
  at full speed at f1, so **538% is the better number.**
- The rack focus runs alongside: about 40 px of defocus at f1, sharp by f9–10.

**Whip-out.** An exponential ease-in with velocity **×1.40 per frame** (k = 5.4/s): 1.4, 3.9, 7.4 …
141.6, 177.5 px/f, and 612 px in 11 frames before the lockup leaves.
- In 30 fps terms: ×1.18 per frame.
- As a 12-frame exit it is about cubic-bezier (0.52, 0.04, 0.80, 0.16).

**Bhippi status.** Possible with a keyed camera or scale and `cubic-bezier` eases. Rack focus is only
possible as keyed blur.

### T16 · Tutorial overlays (f65–f160, f321–f368)

**What it is.** AE-UI graphics, all drawn as 1–2 px strokes with small blue squares:

- a bounding box with 8 handles;
- bezier vertex squares (3 on the smile);
- a **wireframe cube helper**: 12 edges and 8 corner dots, which turn from blue to pink at f137 and
  bend during the twist;
- motion-path dots and keyframe squares;
- a black cursor with a soft pink shadow;
- an AE-panel mock (teal-grey `#8fb3c6`/`#c0d2e0`, a ruler, a blue playhead).

**The math.** The wireframe cube is the 8 corners **projected with the same camera/rotation as the
object**, which is why it "rotates" in sync with the fake-3D content.

**Bhippi status.** Shapes and the `dock-cursor` template exist. There is no helper that attaches
overlays to a target layer (NEW `tutorial_overlay`).

### T17 · Faceted two-tone prisms (the title decoration, the timeline world)

**What it is.** An octahedron seen at 45° is 4 triangles with 2 tones:

- title: dark `#6345cb`/`#7e55cb` and lit pink `#df7cc4`/`#bf64b9`;
- 3D world: white and grey.

An hourglass is two triangles, `#778ce4` over `#5554e2`.

**The math.** Flat shading, with facet tone = step(n·l > 0). Only the facets with n_z > 0 are drawn.

**Bhippi status.** Possible as polygons today, but they don't rotate. As `kind:'octahedron'|'bicone'`
with `look:'flat-two-tone'` they would.

### T18 · Minor devices

- **Subtitle mask wipe.** It moves right → left (half-cut glyphs are visible, so it is a mask, not
  per-character typing), about 20 chars in 1.3 s, *during* the zoom.
- **Cyclops eyelid.** A circle wipe on the eye white.
- **Light cone.** A white trapezoid with soft edges behind the character (f233–240).
- **End-card props** (prior `m3`): a capsule spinning at **15.4°/s constant** (a full turn in
  23.4 s); a torus tilting 70° → 50.5° over 3.5 s (the fit on its minor/major ratio is cubic-bezier
  (0.62, 0.95, 1.0, 0.93)). They are DOF-blurred (8–12 px) while the logo stays sharp.

---

## 4. Measured grammar

At 15 fps, 1 f = 67 ms. At 30 fps, double the frame counts.

| Token | Value | How it was measured |
|---|---|---|
| Title zoom-out (camera land) | 538% → 100%, **2.67 s**, cubic-bezier **(0.155, 0.195, 0.006, 1.0)**, rmse 0.0011; 50% by 0.47 s, 90% by 1.33 s | LK scale (f6+) × ECC (f1–5); validated by the sphere radius |
| Text pull-back (portal) | 585% → 100%, **1.47 s**, **(0.123, 1.0, 0.517, 1.0)**, rmse 0.0027 | LK scale product, f424–446 |
| Exit whip | exponential ease-in, **velocity ×1.40/frame** (×1.18 at 30 fps), about 0.8 s; ≈ (0.52, 0.04, 0.80, 0.16) | LK dy |
| Sphere spin (checker) | −90° → ~170° in **1.63 s**, **(0.77, 0.04, 0.43, 0.93)**, rmse 1.5°; peak 20–33°/f | Terminator edge and area |
| Card flip (eyes hide) | 0 → 90° in **3 f (0.2 s)**, at the end of a 0.9 s look | Eye height ratio |
| Swap at occlusion | **1 f**, then a twist settle of **5 f (0.33 s)**, then the face returns in **4 f** | Contact sheet |
| Cube tumble | **≈360° in 16 f (1.07 s)**, ≈22°/f, while receding 2.8× | Band position and silhouette |
| Roll | Z-spin ≈ **1.0–1.4 × s/r** | Eye-card PCA against the centre path |
| Pop | squash w/h **1.09** at +1 f, settled in **3 f** | bbox |
| Hit | **1-frame 15% squash**, 3% stretch rebound, settled in **7 f** | bbox |
| Draw-on (ellipse) | 134 → 617 px in **8 f**, then overshoot | bbox |
| Run cycle | **12-f loop (0.80 s)**, 6 f/step, body dip and flex per step | Leg L−R autocorrelation; exact repeat |
| Focus band | sharp over a **2.2× range of scale**; near k ≈ 40 px, far k ≈ 24 px per unit of relative scale | Edge-model fits, two independent scripts |
| Rack defocus hand-off | **7 f** of blur on the old scene before the new element enters sharp from the lens | Contact sheet |
| Hue drift on type | band slides **15–18° hue/s**, range 241–279° | Per-letter hue |
| Holds | title 0.53 s before the whip; ENROLL NOW 1.0 s after landing; end card **7.6 s** | Frames |
| Picture vs VO | picture **leads** by **0–1.4 s** | Captions |
| Shots | 4 hard cuts in 38 s; everything else is continuous (morphs, swaps, pull-backs) | Kit |

**Script outputs** (in `out/P0Ns0rphILY/measure/`):

| Output | What it holds |
|---|---|
| `zoom_fit.json` | title zoom |
| `checker_sphere.json`, `spin.json` | checker spin |
| `eyes_turn.json`, `eyes_roll.json`, `roll_spin.json` | eye card turn and roll |
| `run_cycle.json` | run cycle |
| `other_fits.json` | whip-out and pull-backs |
| `dof_flyby.json` | focus band |
| `shading_105.json`, `shade_fit.json` | shading model |
| `verify_*.jpg`, `sheet_*.jpg` | overlays that show every fit |

The prior analyst's `fits.json` and `m*.json` sit alongside.

---

## 5. Design system

### Palette

| Role | Hex |
|---|---|
| Background, edges and corners | `#f8d2d6` / `#fad8d7` |
| Background, light centre | `#fce7e7`–`#fbe8e8` (a radial light centre, not a vignette) |
| Title gradient, top → bottom | `#c59afb` → `#ac66f6` (line 1); `#c37df6` → `#9b3df0` (line 2); blue letters `#9371fb` → `#523bfa` |
| Type drop shadow | peach-pink, about `#f0a6a0` multiply ~35%, distance ~10 px, softness ~30 px |
| Title prisms | `#6345cb` / `#7e55cb` (dark) · `#df7cc4` / `#bf64b9` (lit) · `#778ce4` / `#5554e2` (hourglass) · `#6b69e0` / `#3239d1` |
| Teal ball ramp | core `#215d69` → `#2a7da5` → `#479dad` → rim TL `#83c8c7`, TR `#76b6cc`, BL `#3088b2`, BR `#2d7f85`; spec `#d3e4ee`; glow `#fcf6f6` |
| Jelly cube | core `#7772f2` / `#665df2`, edge glow `#c8b4fb` / `#cfdcfb` |
| Limbs | navy `#303276`, near foot `#3750a4`, unlit cap `#332d6b`, lit cap `#f5d0f5` → `#a878ee` |
| Orange ball | `#f98042` (lit) / `#f1551f` / `#e54010` (dark) |
| Slabs | teal `#3c9bb8` / `#52b3c6`, violet `#595fe0` / `#8a8bec`, deep blue `#236da8`, pink `#f39880`, orange `#fb8a17` |
| Subtitle | `#494444` |
| End-card logo | `#4029cd` |

### Shading ramps

- **Every hero solid is "colour field × rim lift × soft spec + white back-glow"** (T3).
- **Cubes and slabs are "jelly"**: a saturated blurred core with pale edges and fixed per-face tones.
- **Prisms are flat two-tone.**

### Fonts

- **Title:** a heavy geometric sans (Gilroy/Sofia Pro Heavy class). Closest bundled OFL option from
  plan P2: **Outfit Black/ExtraBold** (circular O, flat terminals); Plus Jakarta Sans ExtraBold as a
  second choice.
- **Subtitle:** a bold grotesk in dark grey.
- **End card:** the MDS logotype.

### Depth

- DOF is used on everything except the hero and the logo.
- Hills and clouds are big blurred radial blobs.
- Focus is a band (T10).

---

## 6. Sound

- **VO-led.** A male narrator runs from 0.34 s to 28.1 s. The mid band (300 Hz–3 kHz) dominates the
  mix.
- **Music bed.** About **144–148 bpm** (tail autocorrelation; the kit said 143.6). It sits about
  **10 dB under the VO**: −31.8 dBFS alone, against −21 to −23 dBFS with the VO.
- **Steps are on the tempo.** The run cycle's 150 steps/min lands on the tempo, so the characters
  step on the beat.
- **Ending.** When the VO stops (28.1 s) the bed carries the portal. From the end-card cut (30.67 s)
  it **fades linearly in dB at −10 dB/s** to silence by about 37 s:
  −47, −58, −67, −77, −87, −97 dBFS per second.
- **No clearly separable SFX layer.** There are spectral-flux peaks near the whip (3.38 s), the cube
  entrance (10.40 s) and the tunnel (26.23 s). But at 15 fps chance sync is 69–90% (plan §1), so no
  sync claim is made.
- **For a Bhippi recreation:** soft pops on the squash hits, a whoosh on the whip and the swap, a
  riser into the portal, UI clicks under the cursor beats, and the −10 dB/s fade under the end card.

---

## 7. What Bhippi needs

### 7.1 Corrections to REFERENCE-FILMS-PLAN §3.8 and §4 P6

| Plan says | Measured | Consequence |
|---|---|---|
| "Face features slide over the disc and foreshorten near the limb" | The eyes are a **flat card on a 0.26 r arm** (turn) or **at the centre** (roll). They never reach the limb and are **hidden when edge-on**. Only the **checker** is truly spherical. | P6 needs `decal.mode:'card'` as the *default for faces*, with surface decals for textures. |
| "Cube tumbles = corner-pinned front + narrow darker side face" | The tumble cube (f158–176) is **one feathered rounded square with a sliding shadow band**, alternating face tones, and 1.25× silhouette stretch. Corner-pinned faces appear only in the card-flip (f233–240) and the body yaw (f245–252). | Add `look:'jelly'`: feathered, inner glow, per-face palette. |
| "Morph between kinds (sphere → torus → cube) by SDF blend" | Sphere → torus *is* a morph (a hole from the centre, 3 f). **Sphere → cube is a 1-frame swap at the occlusion moment plus a twist.** | Keep the parametric morphs (torus R, rounded-box radius). Add `swap:{to, when:'decal-hidden'}` and a `twist` deformer. |
| "Soft Lambert + wrap + specular dot + rim + inner glow" | **Inverse-Lambert rim ramp**: L* = 40.9 + 35.4·√(1−n_z) + 21·(n.xy·d̂₁₁₁°), a **4-corner hue field**, a **broad** spec blob (half-max 0.26 r, not a dot), a **white back-glow** of ~2 r, and **AO under decals**. | The shading model must be this ramp model (§7.3). Lambert is an option. |
| "Ray-casts the analytic primitive in the layer quad" | The slab tunnel has **true perspective** (vanishing point, fly-through). The exploded view has near-lens parts. | Use **per-pixel camera rays** over a projected screen box for `threeD` solids. Quad-local orthographic rays only for 2D solids. |
| "Fly-bys where scale and blur fall together" | The blur is **V-shaped**: sharp over a 2.2× band, near ramp about 2× the far ramp. | `scene.dof` needs a **focus band and separate near/far gains**. Also, **camera focus/aperture are unused by the renderer today.** |
| "ENROLL NOW seen through the counter of the O" | **The old scene** is seen through the O's counter while ENROLL NOW pulls back. The inner precomp shrinks to a dot independently. | Fix the P4 transition description. |
| "Per-letter diagonal gradient, pink drop shadow" | A **vertical gradient per line with a horizontally sliding hue band** (15–18°/s). A **warm peach** drop shadow. A **thin** bevel rim; tube bevel only on the O's. | The `gradient-overlay` offset must animate. The bevel needs a distance field, not blur (§7.4). |
| Missing from §3.8 | The swap-at-occlusion; squash tokens; the 12-f run loop; the AE-icon pun (bars → slabs, keys → prisms); the wireframe helper cube projected with the object's camera; the rack-defocus hand-off; the whip ×1.4/f; the zoom-in and pull-back eases; the light cone; the −10 dB/s end fade | Add to §3.8 and the golden recreation. |

**P6 also lacks:**

- squash/stretch along the motion direction in *object* space;
- deformers (bend, twist, taper) for the flexing body and the swap disguise;
- outer glow and AO as part of the primitive (one layer; fact 10);
- the `octahedron` and `bicone` kinds (the key-icon prisms);
- a motion-blur strategy (content changes with rotation3, so sub-frame matrices alone are not
  enough);
- a `defaultSize` that is the **projected silhouette box plus glow and blur padding** (QA and safe
  area read it);
- a name distinct from the existing `solid` type.

### 7.2 Corrected P6 schema

```ts
// src/motion/types.ts. Layer union += (NEW)
| { type: 'form'; form: FormData }            // "solid2_5d" in the plan; `form` avoids confusion with `solid`

type FormKind = 'sphere' | 'torus' | 'capsule' | 'cylinder' | 'cone' | 'bicone'
              | 'box' | 'slab' | 'octahedron' | 'hexprism' | 'coin';
type FormData = {
  kind: FormKind;
  size: Prop<Vec>;                         // [w, h, d] px (sphere: [2r, 2r, 2r])
  round?: Prop<number>;                    // 0..1 rounding (box/slab/cylinder); 1 = sphere-like
  hole?: Prop<number>;                     // torus/coin: 0 = sphere, 1 = full counter (major R from §3 T2)
  rotation3?: Prop<Vec>;                   // object orientation [x, y, z] deg (not the layer's)
  squash?: { amount: Prop<number>; axis?: Prop<number> /* deg on screen; default = velocity dir */ };
  deform?: { twist?: Prop<number>; bend?: Prop<number>; taper?: Prop<number> };   // deg / unit
  look?: 'soft-rim' | 'jelly' | 'flat-two-tone' | 'lambert' | 'glossy';
  paint?: {
    ramp?: string[];                       // gradient map over the shade value, dark → light (3–5 stops)
    quad?: [tl: string, tr: string, bl: string, br: string];   // 4-corner hue field in normal space
    faces?: string[];                      // per-face tones (box: 6; prism: per facet)
    capColor?: string; capLit?: [string, string];   // cylinders
  };
  shade?: { rim?: number; rimPow?: number; dir?: number /* deg, the n.xy gradient */; dirK?: number;
            spec?: { at?: Vec; k?: number; size?: number; color?: string };
            innerGlow?: { color: string; width: number };   // jelly edges
            ao?: number };                                  // under decals
  edge?: { feather?: Prop<number> /* px */ };               // jelly softness; AA otherwise
  glow?: { color: string; radius: number /* × size */; opacity?: number };   // back-glow
  decals?: FormDecal[];
  swap?: { at?: number; when?: 'decal-hidden'; to: Partial<FormData>; twist?: { deg: number; settle: number } };
};
type FormDecal = {
  id: string;
  source: { layer: string } | { checker: { cells: number; colors: [string, string] } } | { color: string };
  mode: 'card' | 'surface' | 'hemisphere';
  // card: a flat plane on an arm from the centre (the film's eyes)
  arm?: number;                            // × radius, default 0.26
  offset?: Prop<Vec>;                      // card slide in radius units, no foreshortening (the film's "look up" +0.24 r)
  rotation?: Prop<Vec>;                    // card flip / turn, deg
  // surface: tangent-plane projector at (lat, lon), rides the object's rotation3
  at?: Prop<Vec>; size?: Prop<Vec>;        // [lat, lon] deg; [w, h] in radius units
  // hemisphere: region {p·pole > 0} (the checker O); `wipe` = a slanted texture-space edge
  pole?: Prop<Vec>; wipe?: { angle: number; offset: Prop<number> };
  clip?: 'silhouette' | 'none';
};
// scene-level (NEW): shared by every form and by depth blur
// MotionScene += { light?: { dir: Vec; spec?: Vec }, dof?: { focus: number | { layer: string }; band?: [near: number, far: number]; near?: number; far?: number; max?: number } }
```

### 7.3 Shader design (one fragment pass per `form`)

**Where it runs.**
- `renderer.ts` `content()` gets a `case 'form'` that runs a GL pass into a pooled target (like
  `solid`/`procedural`).
- For a **`threeD` form** the target is the **screen-space box** of the projected bounding volume,
  plus the glow and blur pad, and `place()` draws it with an **identity matrix**. This needs a small
  special case, because the pixels are already in camera space.
- For a **2D form** it is the layer quad with orthographic rays along the layer's local z, then the
  normal `place()`.

**1. Rays.** Pixel p gives ndc = (2p.x/W − 1, 1 − 2p.y/H). World ray: ro = eye, and
rd = normalize(xyz(V⁻¹P⁻¹[ndc, 1, 1]) − eye), from `cameraAt` (`evaluate.ts:162–198`). Then move to
object space with M = T(pos)·R(rotation3)·Q(squash)·S(size/2):

```
ro_o = M⁻¹·ro,   rd_o = M⁻¹·rd   (not renormalised; t stays in world units)
```

Squash along the screen direction a: Q = R_a·diag(1+q, 1/√(1+q), 1)·R_aᵀ, which preserves volume in
the image plane.

**2. Intersection.**
- **Fast analytic paths:**
  - sphere: b = ro·rd, c = ro·ro − 1, h = b² − c, t = −b − √h;
  - capped cylinder and capsule (iq's `iCylinder`/`iCapsule`);
  - box via slabs.
- **General path:** sphere-trace an SDF from the bounding-box entry, 48–64 steps (cheap at these
  sizes).

```glsl
float sdSphere(vec3 p){ return length(p) - 1.0; }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r; }
float sdTorus(vec3 p, float R, float r){ return length(vec2(length(p.xz) - R, p.y)) - r; }
float sdCappedCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x,d.y),0.0) + length(max(d,0.0)); }
float sdCapsule(vec3 p, float h, float r){ p.y -= clamp(p.y, -h, h); return length(p) - r; }
float sdOctahedron(vec3 p){ p = abs(p); float m = p.x+p.y+p.z-1.0; vec3 q;
  if (3.0*p.x < m) q = p.xyz; else if (3.0*p.y < m) q = p.yzx; else if (3.0*p.z < m) q = p.zxy; else return m*0.57735027;
  float k = clamp(0.5*(q.z-q.y+1.0), 0.0, 1.0); return length(vec3(q.x, q.y-1.0+k, q.z-k)); }
// deformers (applied to p before the SDF; divide the step by the Lipschitz bound)
vec3 twist(vec3 p, float k){ float a = k*p.y; float c = cos(a), s = sin(a); return vec3(c*p.x - s*p.z, p.y, s*p.x + c*p.z); } // L ≈ sqrt(1+(k·R)^2)
vec3 bend (vec3 p, float k){ float a = k*p.x; float c = cos(a), s = sin(a); return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }
```

**Morphs as parameter continua,** not a generic mix. These are exact SDFs throughout:
- **sphere → torus:** R = hole·R_O, ρ = 1 − R. At hole = 0 it is exactly the sphere, and the counter
  opens from the centre (T2).
- **sphere → box:** `sdRoundBox(p, mix(vec3(1), b, m), mix(1.0, round, m))`. At m = 0 this is
  exactly |p| − 1.
- **sphere → capsule:** elongation p.y −= clamp(p.y, −h, h).
- **Anything else:** f = (1 − m)·f_a + m·f_b, which is still Lipschitz ≤ 1, so it traces safely. Or
  use `swap` (T5), which is what the film does.

**3. Coverage, antialiasing, jelly edge and glow, from one number.** While tracing, keep the closest
approach d_min (for the sphere, analytically: |ro − (ro·rd̂)rd̂| − 1). With the pixel footprint in
object units, px = t·2·tan(fov/2)/H/scale (or 1/scale in orthographic):

```
alpha = smoothstep(max(feather, 0.75*px), -max(feather, 0.75*px), d_min)   // AA; jelly when feather > px
glow  = glowOpacity * exp(-max(d_min, 0.0)^2 / (2.0*(glowRadius*0.5)^2))    // back-glow, ≈2 r reach (T3)
```

The glow is composited under the body: out = mix(glowColor·glow, body, alpha), premultiplied.

**4. Normal.** Analytic for the fast paths. Otherwise the tetrahedral 4-tap:
n = normalize(Σ k_i·f(p + ε·k_i)), with k ∈ {(1,−1,−1), (−1,−1,1), (−1,1,−1), (1,1,1)}. Transform to
view space with the inverse-transpose of M.

**5. Shading, `look:'soft-rim'` (the film's model, fitted in T3).** Everything is in view space: v is
toward the viewer and d̂ = (cos dir, sin dir).

```glsl
float rim   = sqrt(max(1.0 - n.z, 0.0));                 // measured: exponent 0.5 on (1 - n·v)
float shade = 0.409 + 0.354*rim + 0.213*dot(n.xy, dHat); // L* model / 100, dir = 111°, rmse 4.3 L*
shade      *= 1.0 - ao;                                  // AO from decal footprints: ao = aoK·exp(-dDecal²/σ²)
vec3  hue   = mix(mix(bl, br, 0.5 + 0.5*n.x), mix(tl, tr, 0.5 + 0.5*n.x), 0.5 + 0.5*n.y); // 4-corner field
vec3  base  = rampLookup(shade) * mix(vec3(1.0), hue / luma(hue), quadK);   // ramp sets value, field sets hue
float s     = specK * exp(-dot(n.xy - specAt, n.xy - specAt) / (2.0*specSize*specSize)); // blob, not a Phong dot
vec3  col   = base + s*specColor;                        // specAt = (0.28, 0.52), specSize = 0.22, +20 L* peak
```

Other looks:
- **`lambert`:** shade = clamp((n·l + w)/(1 + w)) with wrap w ≈ 0.4, plus Blinn spec, for users who
  want CG.
- **`jelly` (cube, slabs):**
  - face id = argmax(|p_o|/b); face tone = `faces[id]`;
  - face UV u,v = the other two coordinates / b;
  - edge e = 1 − max(|u|, |v|);
  - inner glow = exp(−e/w) mixed toward `innerGlow.color`;
  - core darkening = a blurred rectangle, i.e. 1 − smoothstep(0.2, 0.8, e);
  - plus `edge.feather`.
- **`flat-two-tone` (prisms):** tone = n·l > 0 ? lit : unlit, per facet (the octahedron's facet
  normals are sign(p)/√3).

**6. Decals.**
- **Surface mode** (a tangent-plane projector; foreshortening and back-face culling come for free,
  because only the front hit is sampled):

  ```glsl
  vec3 c  = vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon));   // decal centre, object space
  vec3 e1 = normalize(cross(vec3(0,1,0), c)), e2 = cross(c, e1);
  vec3 ph = normalize(p_o);                                           // hit on the unit sphere
  float facing = dot(ph, c);                                          // > cos(maxAngle) to draw
  vec2 uv = vec2(dot(ph, e1), dot(ph, e2)) / size + 0.5;              // sample decal texture if inside [0,1]
  ```

  Screen-space equivalent, in pure TS for QA and `measure.ts` (orthographic, radius r_px):
  - the decal centre projects to (C_x + r·c′_x, C_y − r·c′_y), where c′ = R(rotation3)·c;
  - it is visible iff c′_z > 0;
  - its radial size is scaled by c′_z (the limb squeeze) and its tangential size is unchanged.
- **Hemisphere mode** (the checker O): the region is p_o·pole > 0. Its screen boundary is the ellipse
  with semi-axes r and **r·|pole′_z|**, the r·cos θ terminator. `wipe` offsets the edge by a slanted
  line in (lon, lat), which is what produces the film's S-curve.
- **Card mode** (the eyes):
  - the plane is q₀ = R_card·(0, 0, arm), with normal n_c = R_card·ẑ;
  - t_c = ((q₀ − ro_o)·n_c)/(rd_o·n_c), and uv = ((hit − q₀)·e₁, (hit − q₀)·e₂)/size + 0.5;
  - draw it iff n_c·(−rd_o) > 0 (cull when facing away);
  - **clip it to the body's alpha** and composite it *over* the body with no depth test (arm < 1
    puts the card inside the sphere).

  This reproduces y = −arm·r·sin φ and h ∝ cos φ exactly.

**7. Motion blur.**
- Translation and scale: the existing sub-frame matrices work if the pass is re-run per sub-frame.
- Fast spins (the checker O at 30°/f, the cube at 22°/f): re-trace N = 4–8 sub-frames of the content
  (cost × N on a small quad).
- Or approximate with `directional-blur` along the screen velocity, for the tunnel.

**8. Order and depth.**
- A form reports its centre z for the existing 3D depth sort (`evaluate.ts:287–298`).
- Intersecting forms (slabs crossing) need a depth attachment, v2. The film never shows forms
  intersecting.

**9. Pure resolver** (`src/motion/form.ts`, NEW; fact 4 of the constraints). It returns the
projected silhouette box, visible decal boxes and z per frame, for `defaultSize`, `layerBounds`,
`safeArea`, `polish.ts`, `measure.ts` and tests, without GL.

### 7.4 Layer styles for inflated type (P1 `styles[]`)

The passes run on the layer's alpha at its density, after text rasterising and before effects:

1. **Distance field.** A **jump-flood** (JFA) distance transform D inside the alpha, log₂(size)
   passes. A blurred alpha (as `liquid-glass` does) is the wrong height field for a fixed-width
   bevel: thin stems get lower peaks and corners over-round.
2. **Bevel (smooth, inner).**
   - Height: u = clamp(D/size), h = √(1 − (1 − u)²).
   - Normal: n = normalize(vec3(−∇h·depth, 1)).
   - Light: l = (cos alt·cos ang, cos alt·sin ang, sin alt).
   - Shade: s = n·l − l.z.
   - Highlight: screen `#ffffff` at 60–75% × max(0, s).
   - Shadow: multiply `#4a2ad8` at 30–40% × max(0, −s).
   - **Film values:** size **5 px** at 1080p on about 50 px stems; the O's and tube letters use size
     ≈ **stroke/2** (about 25 px); angle 120°, altitude 30°.
   - Reuse `LIQUID_GLASS_FS`'s normal code with `uHeight` = the JFA height.
3. **Inner shadow.** An offset of the inverted alpha, blurred, multiply in deep violet: distance about
   4 px at 300°, size about 8 px, 25%.
4. **Inner glow.** e = 1 − smoothstep(0, w, D), screen in lavender, w about 6 px, for the jelly
   edges.
5. **Gradient overlay.** Angle 90° (vertical) with 2–3 stops per line. **`offset: Prop<number>`
   slides a hue band** at 15–18°/s. Alternatively `hueDrift: { range: [241, 279], speed: 16 }`.
6. **Drop shadow** (this exists): `#f0a6a0`, multiply, 35%, distance 10 px at 180°, softness 30 px.
7. **Glints.** These come free from the bevel with a gloss contour (a pow on the highlight). No extra
   pass is needed.

Cache every style pass by signature. Static type then costs one pass, which fits constraint 3.

### 7.5 Motion paths with auto-orient and roll (P1)

- **Schema.** `position.k[i]` gains `out?: Vec, in?: Vec` (spatial tangents, relative), and
  `Transform` gains `autoOrient?: boolean | { offset: number }` and `roll?: { radius: number }`
  (NEW).
- **Evaluation** (pure, `anim.ts`/`evaluate.ts`):
  1. The segment is a cubic in space.
  2. Build a 32–64 sample arc-length lookup per segment.
  3. The key's temporal ease maps time to **arc-length fraction**; this matches AE, whose speed graph
     is along the path.
  4. Auto-orient: rotation += atan2 of the tangent.
  5. Roll: rotation += (s_total/radius)·180/π. Also feed `form.rotation3` so decals and the
     hemisphere ride the roll.
- **Tutorial rendering.** `showPath: { dots: 'per-frame', keys: true, color: '#f0a0a4' }` draws the
  AE-style dotted path. Dots are sampled once per frame, so their spacing is the speed, as in the
  film.

### 7.6 Depth blur (P4 `scene.dof`)

- **Wire the camera.** `focus`/`aperture` are evaluated but unused, so this is a bug-level gap.
- **Per `threeD` layer (and per form), per frame:**
  - view depth z = −(V·world·[anchor, 1]).z;
  - σ = min(max, k_near·max(0, z_n/z − 1) + k_far·max(0, 1 − z_f/z));
  - apply as a Gaussian in the effect stack before `place()`, and grow the pad.
- **Defaults from this film:**
  - band z_f/z_n = 2.2;
  - k_near 40 px, k_far 24 px (at 1080p, scaled by density);
  - thin lens = band 1.0, k_near = k_far = aperture px.
- **Rack focus** = animating `focus`. `focus: { layer: 'hero' }` tracks a layer's z.
- **The hand-off preset** (7 f defocus of the old scene, then the new element enters sharp from the
  lens) becomes a P4 transition.

### 7.7 When to use Blender instead (P7)

| Use the `form` layer (instant, previewed, AI-iterable) | Use Blender (headless, cached renders) |
|---|---|
| Spheres, tori, capsules, cylinders, rounded boxes, slabs, prisms in the soft-rim, jelly or two-tone looks | Glass, refraction, iridescence, SSS: aflow orbs, Modern Motion crystals |
| Characters built from primitives, with card decals and rubber-hose limbs | Real inter-object occlusion and contact shadows, many intersecting objects |
| Fly-bys, focus bands, exploded views, the checker O, the portal | Extruded **logos and text with real side walls and bevels** (this film never shows any; its type is flat and bevelled) |
| Everything in this film except the dense slab tunnel | Physics (drop-bounce), complex meshes, glTF, HDRI or gradient-env lighting |

The slab tunnel (f394–406) is borderline. A perspective `form` handles it if no slabs intersect;
otherwise use a `panel-tunnel` Blender preset.

---

## 8. Recreate recipe: "visual elements → 3D look → arcs" (film 6.0–14.3 s, 8.3 s)

**Why this section.** It carries the most tricks per second:

- pop and hit squash;
- the eye-card turn and flip;
- the swap at occlusion with a twist;
- the helper cube;
- the motion path;
- the cube tumble;
- rolling;
- a landing on a stack.

**Tool calls:**

1. `apply_style_pack { pack: "motion-tricks-2.5d" }` **(NEW, P10).** Sets the palette, `scene.light`,
   `scene.dof`, the eases below and the SFX set.
2. `create_motion_scene` with the scene below. Forms, decals, `autoOrient`, `roll`, `showPath`, `dof`
   and `tutorial_overlay` are **NEW**.
3. `add_sound_effect` on the cues. Pops, whooshes and clicks exist; soft "boing" pops are NEW (P9).
4. `run_frame_qa`, then `measure_motion` (**NEW**, P10). It compares the pop (1.09 squash, 3 f), the
   tumble (≈22°/f) and the roll ratio (1.0–1.4) against §4.

```jsonc
{
  "version": 1, "width": 1920, "height": 1080, "duration": 8.3, "background": "#f8d2d6",
  "light": { "dir": [-0.36, 0.93, 0.0], "spec": [0.28, 0.52] },                        // NEW scene.light
  "dof": { "focus": { "layer": "ball" }, "band": [0.8, 1.75], "near": 40, "far": 24 },  // NEW scene.dof
  "layers": [
    { "id": "bg", "type": "procedural", "kind": "radial-glow", "params": { "inner": "#fce7e7", "outer": "#f8d2d6" } },
    { "id": "cam", "type": "camera", "zoom": 2400 },
    { "id": "eyes", "type": "precomp", "hidden": true, "scene": { "…": "googly eyes 2×(white sphere form + black glossy pupil)" } },
    { "id": "smile", "type": "precomp", "hidden": true, "scene": { "…": "white round-cap stroke arc + closed-eye arcs" } },

    { "id": "ball", "type": "form", "threeD": true, "in": 0, "out": 4.07,              // NEW layer type; becomes the cube at the swap
      "transform": { "position": { "k": [ { "t": 1.95, "v": [960, 540, 0], "ease": [0.4, 0, 0.2, 1] },
                                          { "t": 2.40, "v": [960, 706, 0], "ease": [0.3, 0, 0.2, 1] }, { "t": 2.53, "v": [960, 653, 0] },
                                          { "t": 3.60, "v": [960, 560, 0], "ease": [0.52, 0.04, 0.80, 0.16] },   // exit-exp (×1.4/f)
                                          { "t": 4.07, "v": [960, 1500, 0] } ] } },
      "form": { "kind": "sphere", "size": [480, 480, 480], "look": "soft-rim",
        "paint": { "ramp": ["#215d69", "#2a7da5", "#479dad", "#83c8c7", "#d3e4ee"],
                   "quad": ["#83c8c7", "#76b6cc", "#3088b2", "#2d7f85"] },
        "shade": { "rim": 0.354, "rimPow": 0.5, "dir": 111, "dirK": 0.213, "spec": { "at": [0.28, 0.52], "k": 0.2, "size": 0.22 }, "ao": 0.25 },
        "glow": { "color": "#ffffff", "radius": 1.9, "opacity": 0.9 },
        "squash": { "amount": { "k": [ { "t": 0.0, "v": 0 }, { "t": 0.067, "v": 0.09 }, { "t": 0.20, "v": 0, "ease": "cubic" },
                                        { "t": 0.80, "v": 0 }, { "t": 0.867, "v": 0.176 }, { "t": 0.93, "v": 0 }, { "t": 1.07, "v": -0.03 }, { "t": 1.27, "v": 0, "ease": "sine" } ] }, "axis": 90 },
        "decals": [
          { "id": "face0", "source": { "layer": "smile" }, "mode": "card", "arm": 0.26, "size": [1.2, 0.8], "clip": "silhouette" },
          { "id": "face", "source": { "layer": "eyes" }, "mode": "card", "arm": 0.26, "size": [0.9, 0.45], "clip": "silhouette",
            "offset":   { "k": [ { "t": 1.53, "v": [0, 0] }, { "t": 1.80, "v": [0, 0.24], "ease": [0.2, 0.7, 0.3, 1] },      // look up: pure slide (measured, no squeeze)
                                 { "t": 2.20, "v": [0, 0], "ease": [0.5, 0, 0.5, 1] } ] },
            "rotation": { "k": [ { "t": 2.20, "v": [0, 0, 0] }, { "t": 2.47, "v": [92, 0, 0], "ease": [0.6, 0, 1, 1] } ] } }   // flip away, hidden at 2.53
        ],
        "swap": { "when": "decal-hidden", "to": { "kind": "box", "round": 0.18, "look": "jelly" }, "twist": { "deg": 30, "settle": 0.33 } } } },   // NEW (T5)

    { "id": "helper", "type": "shape", "…": "NEW tutorial_overlay { kind:'wire-cube', target:'ball', scaleIn:{ at:1.47, overshoot:0.08 }, dots:'#5b6cf0' }" },

    { "id": "cube", "type": "form", "threeD": true, "in": 4.47, "out": 8.3,
      "form": { "kind": "box", "size": [300, 300, 300], "round": 0.18, "look": "jelly",
        "paint": { "faces": ["#7772f2", "#665df2", "#7772f2", "#665df2", "#8a8bec", "#595fe0"] },
        "shade": { "innerGlow": { "color": "#c8b4fb", "width": 0.12 } }, "edge": { "feather": 10 },
        "rotation3": { "k": [ { "t": 4.60, "v": [0, 0, 0] }, { "t": 5.67, "v": [360, 0, 0], "ease": [0.3, 0.1, 0.6, 0.95] } ] } },
      "transform": { "position": { "k": [ { "t": 4.47, "v": [960, 380, -900], "out": [0, 120, 0] },                          // NEW spatial tangents
                                          { "t": 5.67, "v": [960, 800, 0], "in": [0, -200, 0], "ease": [0.3, 0, 0.2, 1] } ] },
                     "showPath": { "dots": "per-frame", "keys": true, "color": "#f0a0a4", "drawOn": [4.13, 4.47] } } },            // NEW

    { "id": "ball2", "type": "form", "threeD": true, "in": 4.60, "out": 8.3,
      "form": { "kind": "sphere", "size": [250, 250, 250], "look": "soft-rim", "paint": { "quad": ["#83c8c7", "#76b6cc", "#3088b2", "#2d7f85"] },
        "decals": [ { "id": "eyes", "source": { "layer": "eyes" }, "mode": "card", "arm": 0.1, "size": [0.9, 0.45] } ] },
      "transform": { "position": { "k": [ { "t": 4.60, "v": [140, 420, 0], "out": [260, -160, 0] },
                                          { "t": 6.00, "v": [960, 560, 0], "in": [-220, -260, 0], "ease": [0.35, 0, 0.25, 1] } ] },
                     "roll": { "radius": 125 } } },                                                                           // NEW (≈ no-slip, T4/T7)

    { "id": "orange", "type": "form", "threeD": true, "in": 6.13,
      "form": { "kind": "sphere", "size": [120, 120, 120], "look": "soft-rim", "paint": { "ramp": ["#e54010", "#f1551f", "#f98042", "#ffd0a0"] } },
      "transform": { "position": { "k": [ { "t": 6.13, "v": [1500, 150, 0], "out": [-150, -250, 0] },
                                          { "t": 7.00, "v": [960, 380, 0], "in": [180, -300, 0], "ease": [0.5, 0, 0.3, 1] } ] } } },

    { "id": "cursor", "type": "shape", "…": "black arrow + soft pink shadow; NEW tutorial_overlay { kind:'cursor', path:[…], clicks:[1.47, 4.13] }" }
  ],
  "cues": [ { "at": 0.0, "sound": "pop" }, { "at": 0.8, "sound": "pop" }, { "at": 1.47, "sound": "click" }, { "at": 2.53, "sound": "whoosh" },
            { "at": 4.13, "sound": "click" }, { "at": 4.47, "sound": "whoosh" }, { "at": 7.0, "sound": "pop" }, { "at": 7.1, "sound": "impact" } ]
}
```

**Stop-gap with today's engine.** The same beat can be faked as follows:

- **Ball:** a radial-gradient ellipse plus blurred core, spec and glow shapes (T3's 5-layer stack),
  inside a precomp so it is one layer.
- **Eyes:** a `threeD` precomp with an anchor z and rotationX.
- **Cube:** a rounded rect with feather plus a keyed dark band.
- **Paths:** hand-keyed positions with many keys, since there are no tangents.
- **Blur:** keyed `gaussian-blur`.

It works, but costs about 25 layers, cannot roll correctly, and has no auto-orient.

---

## 9. Top 10 improvements

| # | Size | Improvement | Why this film needs it |
|---|---|---|---|
| 1 | **S** | **Wire camera `focus`/`aperture` into the renderer**: a per-3D-layer Gaussian from view z each frame, with the §7.6 focus band (near/far gains). Today the fields are dead. | Fly-bys, UI shots and end-card props all rely on DOF (T10). It also serves every SaaS film (plan T4). |
| 2 | **M** | **`form` layer v1**: sphere, torus, capsule, cylinder, rounded box, slab, octahedron, bicone. SDF/analytic tracing on a projected screen box with per-pixel camera rays; `soft-rim` / `jelly` / `flat-two-tone` looks; feathered coverage; back-glow; the pure `form.ts` resolver for QA. | T1–T3, T6, T11, T12, T17: the core of the film. |
| 3 | **S** | **Card decals** (arm, rotation, cull, clip to silhouette) first; surface and hemisphere decals second. | This is how the film does faces (T4). It is cheap, and it is what users expect from AE. |
| 4 | **S** | **Parametric morphs and `swap` at occlusion**: torus `hole`, box `round`, capsule elongation, plus the `swap {when:'decal-hidden', twist}` transition. | T2 and T5 as measured. The plan's generic SDF blend is not what the film does for sphere → cube. |
| 5 | **M** | **Layer styles via a JFA distance field**: bevel (thin rim or tube), inner shadow, inner glow, gradient overlay with an animated offset. Reuses the `liquid-glass` normal code; signature-cached. | Inflated title and ENROLL NOW (T14). Also used by Workly, Virgil and WasteProtection type. |
| 6 | **M** | **Motion paths**: spatial tangents, arc-length parameterisation, `autoOrient`, `roll {radius}`, and a `showPath` overlay with per-frame dots. | T7, plus correct rolling (T4). |
| 7 | **S** | **Measured eases as named tokens** in `kit/common.ts`: `land-long` (0.155, 0.195, 0.006, 1), `pullback-hot` (0.123, 1, 0.517, 1), `spin-whip` (0.77, 0.04, 0.43, 0.93), `exit-exp {rate:1.4/f@15}`; plus squash tokens `pop` (1.09, 3 f) and `hit` (1-f 15%, 7 f settle). | This makes the grammar reproducible by the AI without re-deriving it. |
| 8 | **M** | **Deformers on forms and shapes**: twist, bend, taper, and squash along velocity. | The body flex on every step (T9), the stack cascade (T8), the swap disguise (T5). |
| 9 | **M** | **`tutorial_overlay` helper**: bbox with handles, bezier vertex handles, wire-cube (projected with the target's camera and rotation), motion path, cursor with clicks. | The film's whole first half (T16). Also the Modern Motion and MDS tutorial language (plan T17). |
| 10 | **M** | **Portal and hand-off transitions**: `through-the-counter` (the glyph counter as a matte; the inner precomp scales independently) and `defocus-handoff` (7 f blur on the old scene, the new element from the lens). | T13, plus the plan's P4 list (with the direction corrected). |

**Next in line:**
- **(L)** Rubber-hose limbs in the P8 character system, as one layer: two-segment capsules with IK,
  the near-limb tint and a 12-f run-cycle preset (T9).
- **(S)** The end-of-film music fade token of −10 dB/s under the end card (§6).
