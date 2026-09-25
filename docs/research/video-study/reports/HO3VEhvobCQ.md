# HO3VEhvobCQ · "What is Motion Design School?" (character film, **marked very important**)

*Video study, 2026-09-25. 73 s, 24 fps, 1920×1080, 1,752 frames, 27 shots. This report builds on the earlier
frame-by-frame pass (`out/HO3VEhvobCQ/notes.md`, all 110 sheets) and the whole-frame ones/twos pass
(`ones_twos.txt`). It adds character-only measurements; the scripts are listed in §4.0. The film is Bhippi's
character-animation reference. Bhippi has no character system today (only `create_stick_figure`), so
§7 is the main deliverable: a corrected design for plan P8.*

---

## 1. What the film is

**About 64 s of continuous hand-drawn character narrative, then a 5.5 s student montage, then a logo.**
- **Story.** A bald pink hero in a blue hoodie wants to animate. He enters a world built out of animation
  software. He falls through a dark world, is chased by a polygon monster and faces his fears with a
  flashlight. He wakes in a pastel dreamscape among other "discipline" characters, and he is given a glowing
  cube (the course), which bursts into light.
- **Montage.** Fourteen student-work shots of 5–17 f each.
- **Logo.** A green brush-script "Motion design school" writes on over dark `#2b2a3b`.

**How it was made.** The characters are **frame-by-frame cel animation** composited in After Effects. It is
not a rig, and five things show it:
- shapes change non-rigidly between drawings (the interlaced fingers at f20–24);
- the full-body turn at f503–511 is redrawn view by view;
- the hands balloon in perspective as he runs at the camera (f441–448);
- limb widths change from drawing to drawing;
- each drawing is held for 2 f (twos).

**What After Effects adds** is the world:
- the UI panels and the camera zoom;
- grain textures, and light cones used as mattes;
- palette-swap cuts, gradient colour cycling and god rays;
- the logo write-on.

**Why it matters for Bhippi.** The film sets the bar for *timing and acting*. That means:
- anticipation that scales with mass;
- extreme 1-frame stretches;
- holds, then fast moves;
- the face as replacement drawings;
- light as a graphic matte.

Almost all of that grammar is reachable with a principled rig. The drawing itself (redrawn turnarounds and
perspective) is not; see §7.6.

## 2. Beat-by-beat breakdown

In the table, s = seconds and f = frames. "Char" is the character's exposure, measured on the character
only (§4.1).

| # | Frames | Time | Beat | Camera and staging | Character technique |
|---|---|---|---|---|---|
| 1 | f1–68 | 0.00–2.83 | CU. The hero dreams of animating: prayer hands, then fists up, then a scheming finger-tap | Centred, symmetric CU. Slow push-in (scale 0.926 over the shot). Pink gradient background with static grain | Blink f8–12. The head dips 80 px (anticipation), holds 6 f, snaps up on 1 f and overshoots. Finger-tap on twos. **Char 69% twos** |
| 2 | f69–220 | 2.83–9.17 | Inside the "animation software": clones of the hero push sliders, stretch along the timeline and bend the ease curve. The line-rig puppet reacts | Locked wide shot. The UI world is a flat set. The hero is tiny (about 265 px tall at 720p, 8–9 heads) | Crowd of one: 3–4 clones act at once, each staggered. The UI reacts to contact (gradients swap; the ease line becomes a bezier). Pen thrown on an arc. **Hop: 2 f anticipation, 1 f take-off, 7 f hang, 2 f stretched fall.** Char 40–60% ones (fast pushes) |
| 3 | f221–480 | 9.17–20.0 | Cut on the "space" hit to **play mode** (black background, white hero with black outline). The ribbon bucks him off. Zoom-out to a dark software world. The world breaks into teeth. The monster chases him | Palette-swap cut. Zoom-out f263–288 (0.64×). The world transforms around a character who stays put on screen | Landing: 2 f contact + 6 f squash. Leap: 3 f crouch, 1 f take-off smear (elongation 5.5), 1.7× fall stretch, 0.55× squash. Run with a counter-lean direction change. **Char 68% twos, 21% ones** (the whole-frame figure was 91% ones) |
| 4 | f481–575 | 20.0–23.96 | Worm's-eye fall through a lavender sky | Low angle; purple wires as depth cues | Redrawn turn from back to front, **with a hand hiding the face on the swap frame**. Float on 3s and 4s. Scared → resigned → scream (replacement face) |
| — | f576–614 | 23.96–25.54 | Noise dissolve (4 f) to a **black hold of 36 f** | | |
| 5 | f615–687 | 25.58–28.63 | **Flashlight CU**: facepalm, deep breath, a firefly passes, sad eyes, blink, determination | The flashlight flickers (dim 2 f, off 2 f, on 7 f, off 2 f, on). The beam wedge also works as a matte | Colour inside the beam, silhouette outside it. Snap blink (2 f closed). Eye replacements: closed, side-glance, puppy, wide, determined. Char 44% twos |
| 6 | f688–764 | 28.63–31.83 | Wide cave. A silhouette sneaks forward; the beam lights the ground yellow. At f742–764 the beam turns back onto him | Deep blue backlight, stippled red ground, dark foreground rock frame | **Light matte.** The beam is at once a white wedge in the air, a red→yellow swap on the ground and a colour reveal on the hero. Sneak walk at about 12 f per step. Drawn ripples at his feet |
| 7 | f765–810 | 31.83–33.75 | Top-down CU. A hand plunges into black liquid among red "clip" cards and pulls out a glowing orb on a string | Top-down | Drawn FX: red splash strokes and concentric ripple arcs on ones. The string goes taut and yanks the hand |
| 8 | f811–951 | 33.75–39.63 | He is dragged, then stretched in a tug-of-war, then **disintegrates into flakes** | Layered parallax wipe to black, then a **74 f black hold** | Extreme diagonal stretch; flakes blow away |
| 9 | f952–1008 | 39.63–42.0 | POV wake-up through an eyelid aperture | Almond aperture on twos: opens 8 f, closes to a slit 8 f, snaps open 4 f. Defocus and double image | |
| 10 | f1009–1191 | 42.0–49.63 | ECU eye (star catchlight) tracks the puppet's kicking leg; he sits up in the pastel dreamscape | ECU into a continuous move to a wide. The foreground blob parallaxes | Idle is mostly **dead holds of 15–20 f** with 2–3-drawing bursts |
| 11 | f1192–1486 | 49.63–61.92 | Cast of discipline characters, then a propeller giant, then the cube drops on a string and the hero catches and hugs it | Wide line-up: one action at a time, staggered | Pill creature loops every 13 f on threes. Red giant: 6 f anticipation, 1 f strike, then a smug head swap. Purple giant: a 12 f crouch plus a 4 f hold, a spinning-disc smear, and a stretched exit with legs trailing (drag). The hero ducks, shields his eyes, reaches and hugs |
| 12 | f1487–1535 | 61.92–63.96 | CU hug: blissful face, head turn to peer inside, **god rays burst** | CU | The head turn is a roll of the flat dome (about 70°) plus features sliding, as 3 keys on twos. Rays widen on twos |
| — | f1536–1542 | 63.96–64.25 | White-out, 7 f | | |
| 13–26 | f1543–1674 | 64.25–69.75 | Student montage, 14 shots of 5–17 f | Hard cuts; 8 of 13 land within 2 f of an audio onset | Mixed styles (cel, C4D, live action with HUD). An ink squirt wipes to the next shot |
| 27 | f1675–1752 | 69.75–73.0 | Logo write-on (15 f), then a hold of 63 f | Static | |

## 3. Technique catalogue

"Built" means how the film did it (cel = frame-by-frame drawing). "AE rig route" means how a rig-based studio
would get the same effect in After Effects (Duik Angela, RubberHose 3, Joysticks 'n Sliders, the Puppet tool).
"Bhippi" is the status today, followed by the pillar that covers the gap.

### 3.1 Character construction

| Technique | Frames | Description | Built / AE rig route | Bhippi |
|---|---|---|---|---|
| **Flat-dome head** | f1, f1488 | A wide lens or "mushroom cap", w:h ≈ 2.3:1, no outline, no hair, no nose. Ears are small ellipses at the long axis, with a darker underside crescent and a short dark line | Cel. AE: a shape layer with a Joysticks 'n Sliders head (features slide over the dome) | No (P8) |
| **Almond eyes** | f1–12, f1009 | Pointed almond whites, w:h ≈ 1.9:1. The black round pupil is about 0.45 of the almond's width and carries a **4-point star catchlight** (plus an optional dot). The lids are a flat line cutting the almond | Cel. AE: the white as a matte for the pupil, the lid as a mask shape, Duik "Blink" | No |
| **Replacement eyes** | f511, f665, f674, f685 | Closed arcs, happy arcs, round "scared" whites with tiny pupils, "puppy" eyes with big pupils and big highlights, determined eyes with a flat upper lid | Cel. AE: replacement precomp with a time-remap slider (Duik Connector) | No |
| **Mouth** | f20, f574, f1253 | A tiny v/u line; a scream (big dark arc); the red giant's graphic "L" smug mouth. **Replacements, not morphs** | Cel. AE: replacement slot | No |
| **Big 4-finger hands** | f1–68 | About 2.4 eye-widths long in the CU. Finger separation is a thin, pencil-textured dark line | Cel. AE: a hand replacement library (fist, open, point, prayer, grab) | No |
| **Oversized hoodie** | all | A round blue silhouette with a V collar and neck. Two yellow **tapered drawstrings** hang from it | Cel. AE: puppet pins for the mass; drawstrings on a Duik spring | No |
| **Noodle arms, wide culottes** | f110, f410–441 | No elbows; the arms bend like hose. The trousers are wide tapered tubes with a flare, over yellow socks and black shoes with white soles | Cel. AE: **RubberHose 3** limbs (with a width profile and a flare) | No |
| **Proportions** | f110, f236 | About 8–9 heads tall full-body. Tiny head; the legs are about half the height | — | — |
| **Style variants** | f221+, f688+ | *flat* (colour), *outline* (white fill + black 2–3 px line, "play mode"), *silhouette* (black with white eyes) | Duplicated precomps with Fill/Stroke | Partly: the `fill` and `stroke` effects exist; there is no character to apply them to |
| **Translucent overlay limb** | f1240–1256 | The red giant's arm is a lighter, semi-transparent overlay over his body | Layer opacity or blend | Partly (layer opacity) |
| **Non-biped cast** | f1250 | A pill blob, a tank robot with bezier-handle antennae, a gradient giant with a tiny head and huge legs, a writer at an easel | Cel | No; needs a generic part tree |

### 3.2 Principles as used (with the measured numbers from §4)

| Principle | Where | How it is used | AE rig route | Bhippi |
|---|---|---|---|---|
| **Anticipation** | f28, f209, f386, f1242, f1277 | **Scales with mass:** 2 f (hop), 3 f (leap), a 1 f dip + 6 f wind-up (CU gesture), about 6 f (heavy strike), 12 f + a 4 f hold (giant take-off) | Keyed poses | No |
| **Squash & stretch** | f220, f389, f398–405, f1297–1305 | Fall stretch **1.24×** (hop) to **~1.7×** (leap), width about 0.6× so area is roughly kept. Take-off smear elongation 5.5. Landing squash 0.83×, then 0.55× height | Duik Squash & Stretch; RubberHose "stretch" | No |
| **Timing, holds, then fast** | whole film | Character drawings are **mostly on twos**. Ones only on accents. 31% of the hero's active screen time is dead holds of 5 f or more | posterizeTime(12) on the rig; accents keyed on ones | Partly (`posterizeTime` per property only) |
| **Slow in / out, overshoot** | f34–60 | Snap on 1 f, overshoot of about 20 px @1080p, settle over 15–20 f | Graph editor | Yes (eases, springs) |
| **Arcs** | f193–205, f1306–1318 | The pen flies on a rotating arc; the giant's exit swoops into depth | Motion paths | Partly (no spatial tangents; P1) |
| **Follow-through, overlap, drag** | f1302–1318, drawstrings | The giant's legs trail 2–4 f behind; the drawstrings swing per drawing; the puppet's forearm flies off and returns | Duik Kleaner / Spring | No |
| **Secondary action** | f1105–1163, f645–660 | Breathing bursts during holds; a side-glance at the firefly while breathing | Layered actions | No |
| **Staging** | f1192–1486 | The cast is introduced **one action at a time, staggered**. Silhouettes stay readable even in the stipple world | Direction | Guide only |
| **Exaggeration, perspective** | f441–448 | Hands balloon to about 40% of the frame as he runs at the camera | Cel (a rig needs a per-part depth scale) | No |
| **Straight-ahead action** | f404–441 | The scramble and run are one evolving drawn run, **not a cycle** (§4.2) | Keyed, not cycled | — |
| **Take** | f419–421 | He stops mid-run into an upright "take" (arms up, 3 f hold) before reversing | Keyed pose | No |
| **Direction change** | f419–432 | A counter-lean brake of 13 f while still travelling, then a relaunch | Keyed | No |
| **Hide the view swap** | f507–509 | In the drawn turn, a hand covers the face on the swap frame | View swap behind an occluder | No; a useful rig rule |

### 3.3 Cycles, face, light, transitions, drawn FX

| Technique | Frames | Description | Built / AE rig route | Bhippi |
|---|---|---|---|---|
| Idle loop (background cast) | f1247–1290 | Pill creature: **13 f loop, 4 drawings on threes** | Cel loop / Duik walk-and-loop tools | No |
| Idle (hero) | f241–256, f1105–1163 | **Dead holds** of 16–20 f with 2–3-drawing bursts on twos. There is no sine-wave "breathing" | Holds + short keyed bursts | — |
| Run | f410–441 | 5–8 f per step on twos, forward lean ≈ 21° | Duik walk cycle (as a base) | No |
| Sneak walk | f688–741 | About 12 f per step, crouched silhouette | Duik walk cycle | No |
| Blink | f8–12, f672–673 | 4 f (half, closed, closed, half) plus a **rounder open drawing on f12** (overshoot). A snap blink is 2 f closed | Duik Blink | No |
| Head turn | f1507–1515 | 3 keys on twos: 3/4 → front-down → profile peering. Mostly a **roll of the dome + features sliding** | Joysticks 'n Sliders | No |
| Look-at | f34, f652, f1009–1040 | The pupils track the firefly and the puppet's leg | Look-at expression | No |
| **Light as a matte** | f615–687, f742–764 | One beam polygon is used 3 ways: a white wedge in the air, red→yellow on the ground, colour vs silhouette on the hero. **Graphic, not physical** (the beam lights the man holding it) | Track matte on a colour copy over a silhouette copy | Partly: track mattes + `fill` work on footage or a still today |
| Flicker | f615–628 | The whole character swaps lit ↔ silhouette for 2 f at a time | Hold keys | Partly |
| Palette-swap cut | f221 | Same layout; the world palette and the character style change on the impact frame | Duplicated comps | Partly (tint/fill + cut) |
| World breaks around a fixed character | f345–372 | Panels skew, then torn polygons, then teeth, while the hero stays in place on screen | Shape animation | Partly |
| Noise dissolve to black | f575–579 | The image gets grainier and darker; luma 187 → 144 → 75 → 23 → 11 | Noise + levels | Partly (grain + opacity) |
| Eyelid aperture | f952–975 | A feathered, noise-dithered almond mask | Mask | Partly (path masks are straight-segment only) |
| God rays → white-out | f1522–1542 | About 7 wedges widening on twos for 14 f, then a white-out of 7 f | CC Light Rays / shapes | No for rays (P5); yes for the white-out |
| Drawn FX | f771–780, f851–864, f410–441 | Splash strokes, ripple arcs on ones, ripple ellipses at the feet, flakes, speed-line streaks, a noise-blob firefly | Cel FX / Lottie | No (P5, P11) |
| UI reacts to the character | f85–165 | A push swaps a gradient; grabbing the ease line bends it into a bezier | Keyed on contact | No (needs contact events) |
| Ink-squirt wipe | f1646–1658 | Ink from a squid wipes to the next shot | Cel | No (P4) |
| Logo write-on | f1675–1689 | Brush script revealed left→right, 15 f | Trim paths / masks | Partly (P1 for beziers) |

## 4. Measured animation grammar

### 4.0 Method and files (all in `out/HO3VEhvobCQ/`)

- `ones_twos.py` → `ones_twos.txt`: whole-frame diff (the earlier pass). **It is polluted:** camera moves, FX,
  the monster and UI changes all count as new drawings.
- **`char_exposure.py` → `char_exposure.json` (new).** One character's colour mask per segment, then the
  silhouette IoU of consecutive frames after aligning their bounding boxes. A held drawing that the camera
  or its layer moves still scores about 1. `clones_exposure.py` does the same per clone in shot 2.
- `measure.py` → `measure.json`. This was written earlier but never run; it now has been.
  - M1 run and M2 leap are valid.
  - M3 (stool jump, hoodie mask) latched onto a UI element and is **invalid**; `jump_chart.py` replaces it.
- `run_steps.py` → `run_steps.json`: per-drawing leg spread, lean and ground speed for the run.
- `jump_chart.py` → `jump_chart.json`: timing charts read on ruled crops (`montage_ruled.py`) plus the M2
  numbers.
- `idle_loops.py` and `idle_loops2.py` → json: lagged self-similarity of silhouettes. A drawn cycle of P
  frames peaks at lag P.
- `palette_kmeans.py` → json: k-means palettes and grain σ (luma std after a 7×7 high-pass).
- Frames studied (as crops and strips; 4 full frames): f1, f7–12, f27–34, f110, f190–236, f384–444, f501–574,
  f615–686, f742–764, f752, f1240–1256, f1250, f1277–1317, f1488–1534.

### 4.1 Ones/twos: whole frame vs character only

Figures are % of drawings held for 1 / 2 / 3 / 4 frames, among drawings held 1–4 f.

| Segment | Whole frame (old) | **Character only (new)** | Note |
|---|---|---|---|
| S1 hero CU f2–68 | 26 / 61 / – / – | **21 / 69 / 10 / 0** | Two holds of 6 f |
| S2 clones f70–220 | 78 / 17 | 47 / 37 / 11 / 5 (union) | Per clone: A 60/33/0/7, B 40/50/10/0, C/D 42/48/10/0. Pushes are on ones; holds of 5–24 f |
| S3a landing + idle f222–262 | 91 / 9 (whole shot) | **33 / 67 / 0 / 0** | Then a 16 f dead hold |
| S3b scramble, leap, run f370–441 | ″ | **21 / 68 / 11 / 0** | The action is on **twos** |
| S4 fall f482–575 | 7 / 39 / 36 / 18 | 14 / 39 / 32 / 14 | Float on 3s and 4s |
| S5 flashlight CU f615–687 | 48 / 43 | 38 / 44 / 15 / 3 | The ones are inflated by the flicker frames f615–620 |
| S10 wake-up f1045–1191 | 85 / 10 | 52 / 40 / 6 / 2 | The ones are inflated by a camera scale move f1045–1080. After that: 2s and holds of 15–20 f |
| S11 red giant f1193–1290 | 80 / 14 (whole shot) | 42 / 26 / 11 / 21 | Static for 52 f, then the strike on ones |
| S11 teal tank | ″ | 23 / 38 / 23 / 15 | Moving holds |
| S11 purple giant idle | ″ | 0 / 33 / 67 / 0 | Threes |
| S11 purple giant fly-off f1293–1320 | ″ | 41 / 53 / 6 / 0 | The fast exit is on ones |
| S11 hero f1329–1486 | ″ | 33 / 53 / 12 / 2 | |
| S12 hug CU f1488–1522 | 7 / 73 | 20 / 60 / 20 / 0 | |
| **All characters** | | **Drawings 32 / 50 / 14 / 4. Screen time 17 / 53 / 22 / 9** | **31% of the hero's active time is dead holds of 5 f or more** |

**The rule the film follows:**
- The **character is on twos**, in close-up and in action alike.
- **Ones are accents** (take-off, snap, strike, fast exit), 1–3 frames per action.
- **Threes and fours** are for floating and idling.
- The **camera, UI, FX, monster and transitions run on ones.**

The earlier figure of "action 78–97% on ones" measured the world, not the character.

### 4.2 Cycles

- **The run (f404–441) is not a cycle.** It is 18 drawings over 36 f, with exposures
  `2,2,2,1,2,2,2,3,2,2,2,2,2,2,2,2,2,2` (twos, with one 1 and one 3 used to shift the phase). The action runs:
  - scramble on all fours (f404–409);
  - 2–3 steps left at about 21 px/f @1080p, roughly 1.9 standing heights per second (f410–417);
  - an upright take (f419–421);
  - a **counter-lean brake** (f422–431): the body leans back by 0.16–0.25 of its height while still
    travelling left, slowing from 25 to about 5 px/f;
  - a relaunch toward the camera with a forward lean of +0.38 (≈ 21°), at 18 → 60 px/f as he grows in
    perspective (f432–441).
- **Steps.** Leg-extension peaks are 5 f apart at f410→415. In the flee, the legs go from gathered (f432,
  spread 52 px) to full stride (f438, 436 px) and gathered again (f440). That gives **5–8 f per step, i.e.
  2.5–4 drawings per step on twos.** The stride is about 1.2 standing heights per step in the flee
  (perspective inflates this).
- **Sneak walk (shot 6):** about 12 f per step (from the notes; not re-measured).
- **Idle loops:**
  - Pill creature: **a 13 f loop** (lag-IoU peak 0.72 at 13, half-cycle 0.62 at 6), about 4 drawings on
    threes, centroid bob of 4 px.
  - Yellow script-writer: about a **12 f** writing loop (peak 0.71 at lag 12), on ones and twos.
  - Teal tank and purple giant: **no loop.** They do *moving holds*: bursts of 3–4 drawings on twos every
    12–15 f, with holds of 8–15 f.
  - The hero's idles are dead holds (16 f at f241–256; 15–20 f in S10) broken by 2–3-drawing bursts on twos.

### 4.3 Timing charts at 24 fps (`jump_chart.json`)

| Action | Chart (frames) | Accents on ones |
|---|---|---|
| **Hop** (small, f201–236) | Throw/turn 8, then **anticipation crouch 2** (0.95× height), **take-off 1** (extension), **rise + hang 7** (tucked, almost no vertical travel), **fall 2** (stretch **1.24×** head-to-feet), *cut on contact*, contact 2 (arms up), **squash 6**, recover 2, stand 6, dead hold 16 | Take-off, fall |
| **Leap** (fear, f386–409) | **Crouch 3 (held)**, **take-off 1** (smear: elongation 5.5, 542×98 px), air 8 (4 drawings), **fall stretch 4** (~1.7× head-to-feet, width ~0.6×; 2.3× with the arms), contact crouch 2 (0.83×), **squash 2** (0.55× height, all fours), scramble 4 | Take-off |
| **CU snap gesture** (f24–60) | Drift down 4, **dip 1** (−80 px @1080p ≈ −7% of the frame), wind-up 6 (eyes shut, fists wide and low), **snap 1** (+51 px), overshoot 6 (+15–22 px above rest), settle ~20 | Dip, snap |
| **Heavy strike** (red giant, f1242–1253) | Anticipation ~6 (squint, arm lifts), **strike 1**, settle 4 (on ones), then a **1-frame head swap** to smug and a hold | Strike, settle |
| **Heavy take-off** (purple giant, f1277–1318) | Crouch ~12 (centroid −82 px ≈ 11% of body height), **hold 4–5**, gizmo → spinning disc 4, **launch stretch 9** (≥1.4×), swoop exit 13 (scale 1 → 0.1, legs trailing 2–4 f) | The exit |
| **Head turn** (f1507–1521) | 3/4 → front-down (f1509) → peer in profile (f1513), about 70° of dome roll, on twos, then holds | — |
| **Full-body turn** (fall, f501–511) | Back → back-3/4 → 3/4 with **hand over face** (f507–509) → front (f511), on twos | — |

### 4.4 Face

- **Blink (S1).** Measured as eye-white area relative to open:
  - f8 half (78%), f9–10 closed (0%), f11 half (85%);
  - **f12 open, drawn rounder (101%)**, f13 95%, f14 100%.

  That is **4 f plus 1 overshoot drawing.**
- **Snap blink (S5, f672–673).** Closed 2 f with no half drawings, going straight into "wide" at f674. It is
  used as an accent.
- **Smug half-lid (f27–29) and closed (f30–33).** These overlap the head dip.
- **Eyelid aperture (POV, f952–975), luma on twos:** 0 → 21 → 43 → 48 (opening, 8 f), then → 41 → 21 → 18
  (slit, 8 f), then → 33 → 125 → 167 (snap open, 4 f).

### 4.5 Camera, light, transitions

- **Zoom-out f263–288.** 26 f, 1.0 → 0.636, **cubic-bezier(0.39, 0.03, 0.0, 1.04)**, fit rms 0.005. Peak
  −7.5%/f at f269.
- **CU push (S1).** Scale 0.926 across 68 f.
- **Flicker.** Dim 2, off 2, on 7, off 2, on (the luma is 16, 21, 11, 11, 22…33, 11, 11, 32).
- **Noise dissolve.** 4 f with luma roughly halving each frame, then a black hold of **36 f**. The second
  black hold is **74 f**.
- **Rays and white-out.** Rays on twos for 14 f, then a white-out of 7 f (luma 216 → 255).
- **Logo.** 15 f write-on, then a hold of 63 f.

## 5. Design and character style guide

**Palette.** Sampled on the 1080p source and by k-means.

| Role | Hex |
|---|---|
| Hero skin | `#ee8594` |
| Skin shade (ear underside, neck) | ≈ `#c46f84` |
| Hoodie | `#3200e6` |
| Drawstrings and socks | `#eae645` |
| Culottes | `#e95d71` |
| Shoes | `#07090b` (white soles) |
| Eye white | `#f5fafd` |
| Pupil | `#1a1819` |
| Interior lines | dark plum ≈ `#391e32` |
| CU background | `#f7cbcf` centre → `#f4a5c4` magenta corners (a vignette) / `#f4a9b0` on the warm side |
| Software world | `#e8acb9`, canvas `#ebe2e6`, teal `#5cb598`, purple glow `#cb7bca`, UI gradients red → yellow |
| Play mode | black `#0a0a0e`, red `#d24345`, yellow `#e9e740`, hero `#fdfdfd` with a black line |
| Fall sky | `#d0d1ee` → `#ded8ee` → `#ebd1e2`, wires `#8950b2` |
| Dark room | `#090a10`, glow `#2f274d`, beam `#cdc0e8` |
| Cave | `#060710` / `#08022b`, backlight `#0a0363` → `#2708c9`, ground `#c54047` (stippled), lit ground `#eae441`, beam `#f8f5fa` |
| Dreamscape | `#aac2eb` (top) → `#d4d8f0` → `#e8d4e6` → `#e4c7d9` (bottom) |
| Cast | red giant `#cb4c53` (arm overlay `#d57f8d`), purple giant `#5a28e8` → `#9856ca` gradient, teal `#62908e`, writer `#dfbe64` |
| Cube | `#f4f235` → `#de5d6e`, colour-cycling |
| Logo | `#42fa90` on `#2b2a3b` |

**Proportions.**
- CU head w:h ≈ 2.3:1, and the ears add about 12% to the width.
- The eyes are set wide, with a gap of about 0.4 eye-widths; the pupil is about 0.45 of the almond's width.
- In the CU the hands are about 2.4 eye-widths long.
- Full body is 8–9 heads tall, with legs about half the height. The hoodie is the widest mass.

**Line.**
- There are **no silhouette outlines.** Interior lines (fingers, creases, knees) are thin (1–2 px @720p),
  dark plum and pencil-textured (uneven, slightly broken).
- Outlines appear only as the **outline style** in play mode.

**Grain.** This corrects plan §2.2 and §3.7.
- Grain is a **static texture on backgrounds and gradients only.** On the hero, σ is 0.00 luma levels; on the
  CU background it is 5.8; on the cave ground it is 36–43 (a stipple, nearly 1-bit dither).
- The texture never re-rolls: frame-to-frame correlation is **1.00** on held frames.
- It **moves with its layer**: correlation drops to 0.60 during the push-in at f45.
- Characters are clean flat fills.

**Lighting.** Characters have no shading or cast shadows. Light is expressed through:
- style swaps (colour vs silhouette);
- beam polygons used as mattes;
- colour *replacement* of lit ground (red becomes yellow; it is not brightened);
- soft radial glow blobs behind panels;
- thin blue rim lines on dark rocks;
- rays and white-outs at the climax.

**Composition.**
- CUs are centred and symmetric.
- Wides show a small figure inside a big graphic set with generous negative space.
- The cast is shown as a frieze.

## 6. Sound

- **188 onsets** (2.58/s). The tempo estimate of 152 bpm is not meaningful for this score.
- **The narrative is story-driven, and its sync is at chance level.** The chance that a random frame lies
  within ±2 f of an onset is 0.41. The measured rates are:
  - cuts on an onset: 10/26 = 0.38;
  - motion bursts on an onset: 43/84 = 0.51.
- **The montage is mildly cut to music:** 8/13 cuts land within 2 f of an onset, against a chance of about
  0.51.
- **Story hit points:**
  - the palette-swap cut lands 2 f before the "space" onset (f223);
  - loudness follows the story. The chase and fall are loudest (1-s RMS 0.18–0.21 around f420–505). The
    flashlight CU is quiet (0.07) and the wake-up is nearly silent (0.012 at f1100). The single loudest frame
    is f1512 (0.32), when the box opens. The logo is 0.04.

  The audio was analysed numerically, not listened to, so the split between score and SFX is not verified.
- **For Bhippi:** in character films, put SFX on **action accents** (take-off, contact, flicker, splash). The
  action library should emit cue events for this. Use music for the emotional arc and duck it under quiet
  acting. Do not snap cuts to beats in narrative mode.

## 7. The Bhippi character system (corrected P8)

### 7.1 Review of plan §4 P8 as a character TD

**What the plan gets right:**
- one `character` layer with an internal part tree (not 40 layers);
- reusing `twoBone`;
- views;
- replacement mouths;
- rubber-hose limbs;
- procedural actions with principle parameters;
- rigs on twos while the camera and FX stay on ones;
- Rhubarb;
- in-house base characters.

**What is missing or wrong for this film's construction:**
1. **The skeleton is conflated with the parts.** `parts[{parent, pivot, shape}]` has no bones. Tubes, IK
   chains, sockets, springs and squash/stretch need a skeleton that parts *bind* to.
2. **There is no control layer.** The flat-dome head turn is a Joysticks 'n Sliders problem: a yaw slider
   has to slide the eyes, ears and mouth across the dome between keyed placements. `pose: joint angles` can't
   express that.
3. **Replacement sets exist only for views and mouths.** The film swaps **hands** (prayer, fist, open, grab,
   shield), **eyes** (almond, round, happy, closed, puppy, narrow) and whole **special drawings** (take-off
   smear, worm's-eye pose). Every slot must be a keyable swap.
4. **There is no per-view or per-key draw order.** Hands in front of the face (f1–19), a hand over the face
   during the turn (f507–509), arms over the box (f1509–1521).
5. **There is no clipping between parts.** Pupils must be clipped to the eye white, lids must be masks over
   the white, and a mouth interior (the tank's teeth) must be clipped to the mouth.
6. **Bendy limbs are underspecified.** `{limb, segments}` needs a **width profile** (start, mid, end), a
   flare (culottes), cuffs, a bend style (hose arc vs joint) and length preservation (RubberHose "realism").
7. **There are no deformers.** Squash/stretch must be **area-preserving along an axis** (velocity or
   explicit), about a pivot (the ground on landing, the centre in the air). It is measured at 1.24–1.7×
   stretch with width about 0.6×.
8. **There is no secondary motion.** Drawstrings, trailing legs, antennae, a cube on a string and a flying-off
   forearm need springs. They must be seekable and deterministic (§7.3).
9. **Styles are missing.** flat, outline and silhouette must be keyable (palette-swap cut, flicker).
   `style.lightMatte` as a single string cannot express the film's rule. It needs *inside style / outside
   style from a layer's alpha*, and **must not consume** the beam layer: in Bhippi a matte source is not drawn,
   yet the beam must be visible.
10. **Nothing connects the character to other layers.**
    - **Props and sockets:** a flashlight in the hand, with the beam layer parented to `torch.tip`; a cube held
      in both hands.
    - **World targets:** look at the firefly, point at a UI part, contact with the ease line.
    - Expressions can't see other layers (map fact 4), so the solver must resolve targets natively, after the
      layers they reference.
11. **The timing model is wrong.** `onTwos: {closeUp: 2, action: 1}` encodes the polluted whole-frame
    numbers. The measured rule is *step 2 everywhere, with ones on accents*, plus a per-character `phase` so
    that a cast and its clones don't all change on the same frames.
12. **There is no asset/instance split.** The clones (S2) and the cast (S11) reuse one design many times. Put
    assets on the scene (`scene.characters`) and keep instances small.
13. **Non-biped morphologies** (pill, tank, giant) need the generic tree. The biped is only a template.
14. **Foreshortening.** The film uses per-part depth (hands toward the camera). Add `depth` with a simple
    perspective scale.
15. **Detail lines.** Pencil-textured interior strokes clipped to their part, plus an optional boil. The film
    does **not** boil its holds.
16. **Lip-sync source is wrong.** "Bhippi's own TTS knows [phoneme timings]" is not true: `speech.rs` returns
    audio bytes only (Piper, ElevenLabs). The sources are listed in §7.4.
17. **The base-character naming carries IP risk.** `mds-bean`, if modelled on the MDS hero (pink bald dome,
    blue hoodie, yellow drawstrings, salmon culottes), copies their mascot. Ship an original `dome-kid` with
    its own design and default palette, and offer the look as a *style*, not the character.
18. **The effort is underestimated.** "About 3 weeks" for 4 rigs × 3–4 views + actions + lip sync + look
    kit + FX is not realistic. §9 re-stages it.

### 7.2 Corrected schema

All types below are **NEW**. They live in scene JSON, so Rust needs no change (map fact 1). Parts draw from
SVG path data through `Path2D(d)`. That is native Canvas2D, so **Stage 1 does not wait for P1**; P1's
`ShapeItem` can replace `d` later.

```ts
// MotionScene += { characters?: Record<string, CharacterAsset> }    // assets shared by instances (clones, cast)

type CharacterAsset = {
  id: string; name: string; schema: 1;
  height: number;                                   // standing height at scale 100: QA box and action distances
  palette: Record<Role, string>;                    // skin, skinShade, top, trim, bottom, socks, shoes, eyeWhite, pupil, line, mouthIn…
  bones: Bone[];                                    // skeleton (FK tree); root pivot = between the feet
  parts: Part[];                                    // drawables bound to bones
  views: Record<ViewId, ViewDef>;                   // front | 3q | side | back | 3q-back (+ mirrored) | specials ('worm', 'top')
  controls: Control[];                              // the interface actions, pose keys and the AI drive
  face: FaceDef;
  sockets: Record<string, { bone: string; at: Vec; rot?: number }>;   // hand_r, hand_l, head, chest, foot_l…
  props?: Record<string, PropDef>;                  // flashlight, phone, cube, pen…
  springs?: Spring[];                               // secondary motion
  deformers?: Deformer[];                           // squash/stretch, bend
  styles?: Record<string, StyleDef>;                // 'flat' (default) | 'outline' | 'silhouette' | custom
  poses?: Record<string, Record<string, number | Vec | string>>;     // named poses: rest, crouch, tuck, reach…
  specials?: Record<string, Record<string /*part*/, string /*d*/>>;  // hand-authored drawings a rig can't reach (smear, worm's-eye)
};
type Bone = { id: string; parent?: string; head: Vec; tail: Vec; limits?: [number, number] };
type Part = {
  id: string; bone: string; z: number;
  draw:
    | { kind: 'shape'; d: string; pivot?: Vec }                                        // rigid
    | { kind: 'tube'; chain: [string, string, string?]; width: [number, number, number];
        flare?: number; cap?: 'round' | 'flat' | 'cuff'; bend: 'hose' | 'joint'; keepLength?: number }  // rubber-hose limb
    | { kind: 'swap'; set: Record<string, string /*d*/>; initial: string };            // hands, eyes, mouths…
  paint: Role | Paint;                              // palette role → brandify recolours
  lines?: { d: string; width: number; brush?: 'clean' | 'pencil' }[];   // interior detail lines, clipped to this part
  clip?: string;                                    // clip to another part's fill (pupil→eyeWhite, lid→eyeWhite, teeth→mouth)
  opacity?: number; blend?: BlendMode;              // translucent overlay limb
  depth?: number;                                   // toward the camera: perspective scale (hands balloon)
  views?: ViewId[];
};
type ViewDef = { mirror?: ViewId; z?: Record<string, number>; hide?: string[];
                 parts?: Record<string, Partial<Part>>; bones?: Record<string, Partial<Bone>> };
type Control =
  | { id: string; kind: 'rot'; bone: string }                                            // FK
  | { id: string; kind: 'ik'; chain: [string, string, string]; bend: 1 | -1 }            // stickFigure.ts twoBone
  | { id: string; kind: 'slider'; range: [number, number];                               // Joysticks 'n Sliders
      keys: { at: number; set: Record<string /*part.prop | bone.prop*/, number | Vec> }[] }
  | { id: string; kind: 'swap'; part: string }                                           // replacement key (hold only)
  | { id: string; kind: 'z'; part: string }                                              // keyable draw-order swap
  | { id: string; kind: 'root' };                                                        // position / rotation / scale
type FaceDef = {
  eyes: { l: EyeDef; r: EyeDef };                   // eye shapes come from a swap part: almond | round | narrow | happy | closed
  catchlight: { kind: 'star4' | 'dot'; size: number; dot?: boolean };
  mouth: string;                                    // swap part id: expressions + visemes A–H, X (Rhubarb), per view
  brows?: string;
  surface: { part: string; yaw: string /*slider id*/ };   // features slide over the dome with head yaw
};
type EyeDef = { white: string; pupil: string; lidUpper: string; lidLower?: string; look: Vec /*range*/ };
type Spring = { id: string; chain: string[]; stiffness: number; damping: number; gravity?: number };
type Deformer =
  | { kind: 'squash-stretch'; target: 'root' | string[]; axis: 'velocity' | 'vertical' | number;
      preserveArea: true; pivot: 'ground' | 'center';
      auto?: { perSpeed: number; max: number; contactSquash: number } }
  | { kind: 'bend'; part: string };
type StyleDef = { fill?: Partial<Record<Role | '*', string>>; stroke?: { color: string; width: number };
                  keep?: Role[]; lines?: boolean };
// 'outline' = { fill: {'*':'#fdfdfd'}, stroke: {color:'#0a0a0e', width: 3} }
// 'silhouette' = { fill: {'*':'#0b0a10'}, keep: ['eyeWhite','pupil'], lines: false }
type PropDef = { parts: Part[]; socket: string; sockets?: Record<string, { at: Vec; rot?: number }> };

// The layer: one per character instance, however many parts
type CharacterLayer = LayerCommon & { type: 'character'; character: {
  asset: string;                                    // key into scene.characters
  palette?: Partial<Record<Role, string>>;
  view?: Prop<ViewId>; style?: Prop<string>; facing?: 1 | -1;          // hold keys
  track?: ActionClip[];                             // procedural actions (timing charts, §7.3)
  pose?: Record<string /*control*/, Prop<number | Vec | string>>;      // direct keys, layered over the track
  face?: { eyes?: Prop<string>; lids?: Prop<number>; look?: Prop<Vec> | TargetRef;
           mouth?: Prop<string> | { signal: string };                 // baked lip-sync signal
           blink?: { auto: boolean; every?: [number, number]; seed?: number } };
  targets?: Record<string, TargetRef>;
  timing?: { step: 1 | 2 | 3; accents?: 'auto' | [number, number][]; phase?: 0 | 1 };
  lights?: { layer: string; inside: string; outside: string; feather?: number }[];  // reads alpha; does not consume the layer
  props?: { id: string; prop: string; socket?: string; visible?: Prop<boolean> }[];
}};
type TargetRef = { layer: string; socket?: string; offset?: Vec };
type ActionClip = { t: TimeRef; do: string; params?: Record<string, unknown>; duration?: number;
                    speed?: number; blend?: number; mirror?: boolean; at?: TargetRef };
// LayerCommon.parent accepts 'layerId#socket' (e.g. 'hero#torch.tip'), so a beam, FX or label rides a hand.
```

**The solver**, a new pure module `src/motion/character/`, runs these steps each frame:
1. Quantise `t` by `timing` (step and phase), except inside accent ranges.
2. Actions → control curves: timing charts, cross-fade blends, direct keys layered on top.
3. FK → bone matrices.
4. IK, using `twoBone`, toward targets resolved from other layers' world matrices. Characters evaluate after
   non-characters; `validate.ts` rejects cycles.
5. Sliders → part and bone properties.
6. Springs: a fixed-step simulation from the start of the clip, memoised per frame, so it is seekable and
   deterministic.
7. Deformers.
8. Views, swaps and z → an ordered part list.
9. Styles and lights → one or two draw lists.
10. One `Path2D` draw list (clips via save/clip/restore), rasterised once per drawing and cached on the hash of
    the draw list plus the density. On twos, the raster is reused on every other frame.

**Outputs besides pixels:**
- pose-aware bounds, for `measure.ts`, `safeArea` (add to `informational`), `polish.ts` and `coverage.ts`;
- socket world matrices, for layers parented to sockets;
- contact and accent events, for SFX cues.

**Tools (all NEW).** Keep the count small; the scene JSON can inline everything.
- `create_character {template | svg, name, palette?, views?}` → the project character library.
- `animate_character {layer, actions[], face?, timing?, lights?}`.
- `pose_character {layer, t, pose | controls}`.
- `lip_sync_character {layer, audioClip, text?}`.
- `list_character_actions` (READ).
- `bake_character {layer}`: actions → keys, for hand editing in the MotionInspector.

**Asset authoring.** Import an SVG with named groups (`bone:`, `part:`, `swap:`, `view:` prefixes) through
`importCharacterSvg`. This is how the base rigs get drawn in any vector tool, and later how the AI or
vectorised images become rigs (Stage 2).

### 7.3 Action library: parameterised timing charts

Defaults are at 24 fps and come from §4. The parameters are:
- **`mass`** (light / normal / heavy) sets anticipation to **2 / 4–6 / 12 + 4 hold** f and settle to
  4 / 8 / 16 f;
- **`energy`** (0–1) sets stretch to 1 + 0.25·e (hop) … 1 + 0.7·e (fear leap);
- **`tempo`** scales every phase **except the accents, which stay at 1 f**.

Each phase declares its accent flag and its cue (for SFX).

| Action | Phases (frames) | Accents | Params | Source |
|---|---|---|---|---|
| `blink` | Half 1, closed 2, half 1, **open-overshoot 1** (+4% eye height), settle | — | kind: normal / snap (closed 2) / happy | f8–13, f672 |
| `hop` | Anticipation 2 (0.95×), take-off 1, rise + hang 4 + 3·height (tuck), fall 2 (stretch 1.25), contact 2, squash 6, recover 2, settle 6 | Take-off, fall | height, distance, mass | f209–236 |
| `leap` | Anticipation 3 (hold), **take-off smear 1** (special or S&S 5×), air 8, fall stretch 4 (1.7×, area kept), contact 2 (0.83), squash 2 (0.55), recover 4 | Take-off | energy | f386–409 |
| `snap-gesture` | Dip 1, wind-up 6 (eyes shut), snap 1, overshoot 6, settle 15–20 | Dip, snap | — | f24–60 |
| `strike` | Anticipation by mass, strike 1, settle 4 on ones, optional head swap 1, hold | Strike | mass | f1242–1253 |
| `take-off-fly` | Crouch by mass, hold 4, spin-up 4, launch stretch 9 (≥1.4×), swoop exit 13 with legs lagging 2–4 f | Exit | mass, path | f1277–1318 |
| `run` | 5–8 f per step on twos, lean 21°, bob; **turn = counter-lean brake 10–13 f**, then relaunch | — | speed, lean | f410–441 |
| `sneak` | 12 f per step, crouched, drawn ripples on each contact | — | — | shot 6 |
| `idle-hold` | Dead hold 15–20 f, then a 2–3-drawing burst (breath or weight shift) on twos, repeated with seeded jitter | — | — | S3a, S10 |
| `idle-loop` | A 12–13 f cycle of 4 drawings on threes | — | amplitude | Pill creature |
| `float` | On 3s and 4s; fingers wiggle on 2s and 3s; expression drift | — | — | S4 |
| `head-turn` | 3 keys on twos (3/4 → front-down → profile); dome roll ≤ 70° + surface slide | — | to | f1507–1515 |
| `turn-body` | View swap **on a frame where a hand occludes the face**, on twos | — | to view | f503–511 |
| `look` | Pupils to the target, then the head follows (Bhippi convention; the eye lead was not measured) | — | at | f645–660 |
| `take` | Stop, upright, arms up, hold 3 | — | — | f419–421 |
| Gestures | `facepalm`, `breathe`, `shield-eyes`, `reach-catch`, `hug-object`, `point-at`, `duck`, `scream`, `flinch` | — | at | S5, S11, S12 |

`list_character_actions` returns this table as data. The AI composes a scene from beats; it does not write
per-frame keys.

### 7.4 Lip sync

The film has no dialogue, but explainers will.

1. **Rhubarb Lip Sync (MIT)** as a worker: `rhubarb -f json --dialogFile script.txt vo.wav`. It returns
   mouth cues A–H and X, and a TTS line's script is known, which improves accuracy. It can be downloaded on
   demand like Piper and whisper (`models.rs`). The cues become `scene.signals.mouth` (baked, so export is
   deterministic) and drive `face.mouth: {signal}`.
2. **Fallback:** whisper.cpp word timings. `transcribe.rs` already runs `-oj -ojf`. Map words to phonemes with
   CMUdict, spread them across each word, then map to visemes.
3. **Optional:** ElevenLabs "with-timestamps" alignment for cloud voices. Piper alignment needs investigation.
   **No TTS path returns phoneme timings today.**
4. **Mouth sets:** 9 Rhubarb shapes × 3 views. For tiny-mouth designs like the dome-kid, collapse to 5
   (X/A closed, B, C/D open, E wide, F/G round). Mouth changes are held on twos like everything else, and never
   dropped below 2 f.

### 7.5 Base characters and the MDS look kit

**Base characters.** All original; none is a copy of the MDS hero.

1. **`dome-kid`**:
   - flat dome head, almond eyes with star catchlights, big 4-finger hands, oversized top with drawstrings,
     wide trousers, hose limbs;
   - views: front, 3q, side, back, 3q-back, plus a `worm` special;
   - 8 hands, 6 eyes, 12 mouths;
   - props: flashlight, phone, laptop, pen, cube.
2. **`rubberhose`**: noodle limbs in a 1930s-modern style (avoid Disney lookalikes).
3. **`shape-buddy`**: a googly-eyed sphere, cube and capsule, riding P6 solids.
4. **`flat-corporate`**: Humaaans-like proportions with swappable outfits.
5. **A cast kit** of non-biped templates (blob, tank, giant) that proves the generic tree.

**The MDS look kit.** Call it the "flat-grain" style pack in the product.
- **Backgrounds:** pastel gradient presets from §5.
- **Grain:** `grain {animated:false}` **on background layers only**, plus a new `stipple` mode (threshold
  dither, σ ≈ 40) for lit and dark ground.
- **Character styles:** flat, outline and silhouette.
- **The `lights[]` helper:** one beam polygon → an air wedge (screen), a ground colour swap and the character
  reveal.
- **Transitions:**
  - palette-swap cut on an impact;
  - noise dissolve (4 f, halving);
  - black breath (36–74 f);
  - eyelid aperture (8 / 8 / 4 f on twos);
  - god rays (on twos, 14 f) into a white-out (7 f);
  - the world breaking around a fixed character.
- **Drawn FX sprites (P5, P11):** foot ripples, splash strokes, ripple arcs, flakes, speed lines, a
  noise-blob firefly, "!" marks.
- **Timing:** the character on `step 2` with accents; the camera and FX on ones.

### 7.6 What rigs cannot reach: the honest bar

**Unreachable with a rig:**
- redrawn full-body turnarounds in perspective (f503–511);
- a worm's-eye body;
- hands ballooning at the camera (f441–448);
- interlaced-finger in-betweens (f20–24);
- extreme smear drawings;
- the scramble's continuously changing silhouettes;
- the disintegration of line art.

**How to approach them:**
- **Specials:** hand-authored per-asset drawings swapped in for 1–4 f, which covers the take-off smear and the
  worm pose;
- per-part `depth`;
- occluded view swaps;
- particles from the character's alpha, for flakes.

**The quality bar.** Bhippi can reach **MDS's own rigged-tutorial level**: Duik/RubberHose explainer
characters with principled timing on twos, the flat-grain look and light mattes. It cannot reach this film's
hand-drawn frames. My estimate of what a rig reproduces at "looks intended" quality is a judgement, not a
measurement:
- CU acting (S1, S5, S12): about 70–80%;
- full-body action (S2–S4): about 40–50%;
- the cast (S11): about 70%, once the cast rigs exist.

The flashlight golden (§8) sits in the reachable zone, which is why it was chosen.

**Blender Grease Pencil v3** (Blender 5.2 is installed) **helps at the edges, not at the core.**
- It is good for authoring and rendering the **drawn-FX library** headless (EEVEE):
  - splashes, ripples and rays as stroke animation;
  - the Build modifier for write-ons;
  - a Noise modifier with a stepped seed for boil;
  - the Interpolate tool for artist-made in-betweens.
- It is not good as the character system:
  - the AI can't draw strokes at this quality;
  - every change is a render round-trip;
  - it would be a second source of truth outside the motion engine.
- **Verdict:** a 2-day spike after P7, scoped to FX sprites. AI in-betweening (the LTX pipeline, or
  ToonCrafter-class models once their licences are checked) stays a gated research track.

## 8. Recreate recipe: the flashlight beat (8 s, 192 f at 24 fps)

**Shot A (0–3.0 s)** mirrors f615–687 (the CU). **Shot B (3.0–8.0 s)** mirrors f688–764 (the wide cave),
extended.

Tool calls, in order:
1. `motion_guide {topic:"character"}` (**NEW**, P10).
2. `create_character {template:"dome-kid", name:"hero", palette:{skin:"#ee8594", top:"#3200e6",
   trim:"#eae645", bottom:"#e95d71", socks:"#eae645", shoes:"#07090b"}, props:["flashlight"]}` (**NEW**).
   Recolour away from the MDS palette for real client work.
3. `create_motion_scene {title:"Torch A", scene: …A…}`: an existing tool, with a NEW layer type inside.
4. `create_motion_scene {title:"Torch B", scene: …B…}`, placed right after A (a hard cut).
5. `add_sound_effect` (existing):
   - `click` at 0.083 / 0.167 / 0.458 / 0.542 s (the flicker);
   - a soft `chime` at 1.25 s (the firefly);
   - a `whoosh` at 2.96 s (the torch swings into the lens);
   - **NEW** `water-step` SFX on each sneak contact.

   Music ducked to about −18 dB. The reference shot is the film's quietest.
6. `run_frame_qa`, with **NEW** character checks: character-only exposure, dead holds, silhouette readability.
   Then `consult_council {seats:["Animator","Director"]}`, and a side-by-side against f615–764.

**Scene A (CU).** Everything marked NEW is new. The rest exists today.

```jsonc
{ "width": 1920, "height": 1080, "fps": 24, "duration": 3.0, "background": "#090a10",
  "characters": { "hero": "@library/hero" },                                  // NEW scene asset map
  "layers": [
    { "id": "glow", "type": "procedural", "kind": "radial-glow",
      "params": { "inner": "#2f274d", "outer": "#090a10", "center": [0.6, 0.45], "radius": 0.6 },
      "effects": [ { "type": "grain", "amount": 0.25, "size": 1, "animated": false } ] },     // static grain on the background only
    { "id": "hero", "type": "character",                                        // NEW layer type
      "transform": { "position": [960, 1180], "scale": [100, 100] },
      "character": {
        "asset": "hero", "view": "front", "style": "flat",
        "timing": { "step": 2, "accents": "auto" },                             // NEW: measured rule
        "props": [ { "id": "torch", "prop": "flashlight", "socket": "hand_r" } ],
        "lights": [ { "layer": "beam", "inside": "flat", "outside": "silhouette", "feather": 2 } ],   // NEW light matte
        "track": [
          { "t": 0.00, "do": "facepalm", "duration": 0.80 },
          { "t": 0.88, "do": "breathe", "params": { "hand": "chest", "eyes": "closed" }, "duration": 0.55 },
          { "t": 1.25, "do": "look", "at": { "layer": "firefly" }, "params": { "lids": 0.5, "head": 0.25 } },
          { "t": 1.92, "do": "pose", "params": { "controls": { "arm_r.ik": [-80, -40] } }, "blend": 2 },  // torch swings: beam leaves the body
          { "t": 2.08, "do": "expression", "params": { "eyes": "puppy" } },
          { "t": 2.38, "do": "blink", "params": { "kind": "snap" } },            // 2 f closed
          { "t": 2.46, "do": "expression", "params": { "eyes": "wide" } },
          { "t": 2.92, "do": "expression", "params": { "eyes": "determined" } },
          { "t": 2.96, "do": "pose", "params": { "controls": { "arm_r.ik": [220, 120] } } }   // torch into lens (accent)
        ],
        "face": { "blink": { "auto": false } } } },
    { "id": "beam", "type": "shape", "parent": "hero#torch.tip",               // NEW socket parenting
      "shape": { "shape": "path", "points": [0, 0, -1100, -520, -1100, 380], "closed": true,
                 "gradient": { "kind": "linear", "stops": [[0, "#ffffff"], [1, "#2f274d"]], "from": [0, 0], "to": [-1100, 0] } },
      "blend": "screen", "masks": [ { "shape": "path", "points": [0,0, -1100,-520, -1100,380], "feather": 18 } ],
      "transform": { "opacity": { "k": [ {"t":0,"v":35,"ease":"hold"}, {"t":0.083,"v":0,"ease":"hold"}, {"t":0.167,"v":100,"ease":"hold"},
                          {"t":0.458,"v":0,"ease":"hold"}, {"t":0.542,"v":100,"ease":"hold"} ] } },   // flicker: dim 2, off 2, on 7, off 2, on
      "effects": [ { "type": "grain", "amount": 0.35, "size": 1, "animated": false } ] },
    { "id": "firefly", "type": "shape", "in": 1.2, "out": 2.2,
      "shape": { "shape": "ellipse", "size": [16, 16], "fill": "#f2e04a" },
      "transform": { "position": { "k": [ {"t":1.2,"v":[300,470]}, {"t":2.1,"v":[1620,380],"ease":"sine"} ] } },   // + wiggle(3,25) by expression
      "effects": [ { "type": "glow", "radius": 28, "intensity": 1.4 }, { "type": "turbulent-displace", "amount": 4, "size": 30 } ] }
  ] }
```

When the beam's opacity is 0, the `lights` rule resolves the whole character to `silhouette`. That gives the
flicker with no extra keys.

**Scene B (wide cave).** The key layers, bottom to top:
- the background: a navy → black `linear-gradient` procedural, plus a backlight wedge (a shape with gradient
  `#0a0363` → `#2708c9`) with static grain;
- `ground`: a red `#c54047` polygon with grain `amount 1.0, animated:false`. The **NEW** `stipple:true` gives
  σ ≈ 40;
- `groundLit`: a yellow `#eae441` copy of the ground, with track matte `{layer:"beamMatte", mode:"alpha"}`
  (**existing** mattes);
- `beamMatte`: a hidden copy of the beam wedge, parented to `hero#torch.tip`;
- `hero`: a `character` with `style:"silhouette"`, `lights:[{layer:"beam", inside:"flat", outside:"silhouette"}]`
  and this track:
  - `sneak` for 3.0–5.2 s, `params:{stepFrames:12}`, emitting a `contact` cue on each step;
  - `look` back at 5.2 s;
  - `turn-body` to 3q at 5.6 s (the hand occludes the face);
  - a `pose` at 5.9–6.4 s that raises the torch overhead. The beam then sweeps back over him, and the colour
    reveal runs over 6.3–7.4 s;
  - `idle-hold` to 8.0 s;
- `beam`: a visible white wedge (screen), masked to above the ground line;
- `ripples`: drawn-FX sprites at the foot sockets on each `contact` (**NEW**, P5). Existing fallback: an
  ellipse stroke with a scale and opacity key and a repeater of 2;
- `rocksFG`: dark polygons with a thin blue stroke (`#2708c9`, 2 px) for the parallax frame;
- `camera`: a slow push, scale 1.0 → 1.04 across the shot.

**What works today without P8:** a still or generated character image can already do the light-matte trick.
Stack two footage copies: the top one in colour, with track matte = beam; the bottom one with the `fill` effect
set to `#0b0a10`. The yellow ground swap and the flicker are also buildable today.

## 9. Top 10 improvements and a staged path

**Top 10.** S, M and L are the sizes used in the plan.

| # | Improvement | Size |
|---|---|---|
| 1 | `character` layer + `CharacterAsset` + pure solver: FK, `twoBone` IK, hose tubes, swaps, views with z, clipping, `Path2D(d)` rendering and a raster cache. **No P1 dependency** | L |
| 2 | Face kit: eyes built from white + pupil + star catchlight + lid masks; eye and mouth swap sets; blink generator (4 f + overshoot; snap); look-at targets | M |
| 3 | Rig timing `{step, accents, phase}`, with ones on accents only. Camera and FX stay on ones | S |
| 4 | Action library v1 (the §7.3 table, 12 actions) + `list_character_actions` + SFX cue events | M |
| 5 | Styles (flat, outline, silhouette) + **native `lights[]`** + `layer#socket` parenting (props, beams, labels) | S |
| 6 | Area-preserving squash/stretch deformer (velocity axis) + seekable springs + specials (smear drawings) | M |
| 7 | Flat-grain look kit: static background grain, `stipple` mode, pastel presets, palette-swap cut, noise dissolve, eyelid aperture, world-break helper | S |
| 8 | Rhubarb worker + mouth sets; whisper `-ojf` + CMUdict fallback; baked `signals.mouth` | M |
| 9 | Drawn-FX sprites (ripples, splash, flakes, rays, speed lines, firefly) through P5 and P11; a Grease Pencil spike for authoring them | M |
| 10 | **Character-only exposure QA.** Adopt `char_exposure.py`'s silhouette-IoU method in the P10 reference worker and pacing QA; whole-frame diffs mis-measure characters. The golden's acceptance: see "Weeks 1–2" below | S |

**Staged path.**

**Weeks 1–2: a credible first character.** This can start before P1; it needs only the P4/P5 tool-file
ordering from plan §6.1.
- *Days 1–5:*
  - types, `validate.ts`, and the solver (FK, IK, tubes, swaps, views/z, clip);
  - the renderer path and cache;
  - `dome-kid` front and 3q, authored as an SVG import;
  - a Motion Lab scene, plus vitest goldens for the tube geometry, swaps, z per view and the step quantiser.
- *Days 6–10:*
  - the face kit, timing and accents, and 8 actions (`idle-hold`, `blink`, `look`, `breathe`, `facepalm`,
    `point-at`, `hop`, `walk`/`sneak`);
  - styles, `lights[]` and sockets;
  - `create_character` and `animate_character`, and the `character` guide chapter;
  - **flashlight golden v0 (Scene A).**
- *Acceptance for the golden:*
  - character-only exposure: 50 ± 15% twos, with ones ≤ 25% of screen time;
  - blink 4 f;
  - anticipation 2–6 f by mass;
  - background grain with a frame-to-frame correlation above 0.95;
  - the light split visible for at least 1 s.

**Weeks 3–4: this film's CU level.**
- deformers, springs and specials;
- side, back and 3q-back views, and props with two-hand holds;
- `hop`, `leap`, `run` (with the turn-brake), `strike`, `take-off-fly` and the gestures;
- lip sync;
- `bake_character` and a MotionInspector panel;
- Scene B, including drawn ripples.

**Weeks 5–6: this film's rigged-level wides.**
- the cast kit (non-biped templates);
- clones as instances with phase desync;
- UI contact events, so the UI reacts to the character;
- the look-kit transitions;
- FX sprites (P5);
- QA checks for silhouettes, twinning and contact sliding.

**Weeks 7–8 and later (Stage 2):**
- base rigs 2–4;
- AI-authored assets (an LLM-written SVG part tree, or an image → vtracer → segment → auto-rig);
- the Grease Pencil FX spike;
- the gated AI-in-betweening research track.
