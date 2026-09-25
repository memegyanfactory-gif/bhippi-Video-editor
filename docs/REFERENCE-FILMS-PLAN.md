# Reference films → Bhippi: the plan

*2026-09-25, revision 2. Built from a frame-by-frame study of nine reference films the user picked, the
nine per-film reports, an online research report and two headless-Blender proofs run on this machine.
Companion to [WORLD-CLASS-PLAN.md](WORLD-CLASS-PLAN.md), which stays binding (especially §7, what NOT to
do), and to [MOTION-ENGINE.md](MOTION-ENGINE.md).*

**The goal.** From chat alone, a user can make any of these nine films in Bhippi:

- If the timeline has footage, the AI builds on it.
- If it doesn't (a SaaS explainer, a launch film, a brand film), the AI builds everything from vector shapes,
  type, UI mock-ups, characters, particles and headless-Blender 3D.
- Any tool that's missing gets built. Blender runs headless whenever real 3D is the right answer.

**The per-film reports** are in [docs/research/video-study/reports/](research/video-study/reports/). Each
one has a beat-by-beat breakdown, a technique catalogue with the After Effects build, measured motion
grammar, the design system, sound, what Bhippi needs, a recreate recipe and a top-10 list. This plan is
the synthesis. Where it and a report disagree, the report has the frame-level evidence.

---

## 0. The short version

**The nine films, in five families:**

| Family | Films |
|---|---|
| SaaS explainer / launch, light UI world | Workly (YMWbH7xrTHk), Virgil (b1GDr86JW3M), Limelight (lhG6p7xtkPE) |
| Dark "AI" launch, violet glass world | Solair agency reel (luoDI5Bo0w0), WasteProtection (J6A7JcbkWvM) |
| Brand identity film, orb world, part 3D | aflow (xBZzVNi_4Xw) |
| Character narrative, cel animation | Motion Design School (HO3VEhvobCQ) |
| 2D that reads as 3D | Motion Tricks (P0Ns0rphILY) |
| Stylised 3D, modelled in Blender and rendered in AE's Advanced 3D | Modern Motion (2Fc9sGYFj1I) |

**What Bhippi lacks, in order of impact:**

1. **UI mock-ups as living, targetable scenes.** In every SaaS film the product UI is the hero, and it is
   always acted on: typed into, clicked, rows lifted, assembled, zoomed into one part, tilted in 3D with depth
   of field.
2. **Continuous camera direction.** In the SaaS films the *background never cuts*; only the foreground swaps.
   - Limelight: about 15 swaps in 65 s.
   - Solair: about 11 cuts hidden inside 3–8 f ease-in exits.

   A **continuity object** (a dot, orb or sparkle) carries the eye from beat to beat and ends as the logo.
3. **A real vector engine.** Beziers, shape groups, SVG/icon import, array morphs, gradient strokes, layer
   styles and a raster cache. Today a shape is one straight-segment polygon, redrawn every frame.
4. **Type craft:**
   - tracking breathe and slams;
   - a colour front behind the caret;
   - retype/condense morphs and scatter-converge;
   - inline pills and avatars inside a line;
   - per-pixel gradient fills;
   - word timing anchored to the voice-over;
   - bundled OFL fonts, because only system fonts are available today.
5. **Headless Blender** for what 2D can't fake. **Proven on this machine** (§5): glass orbs, gradient-lit
   crystals, device heroes, extruded type, cross-engine mattes.
6. **A character system**:
   - rigs animated on twos with ones for accents;
   - an action library built on measured timing charts;
   - a face kit and lip sync;
   - light mattes and socket parenting.

   Bhippi has a stick figure today.
7. **Soft 2.5D "form" objects** (Motion Tricks): rim-lit analytic shapes traced with camera rays, card
   decals, swap-when-hidden, depth-band blur.
8. **Music structure.** Find the 16th-note grid first. World changes land on phrase lines; cuts go on the
   16th pickup, with the motion landing on the beat. Films with voice-over tick most UI events;
   music-only films stay silent.
9. **Measured direction knowledge** (§2) served as genre playbooks on demand, plus pacing QA.

**Bugs found on the way:**
- **Camera depth of field is dead code.** `focus`/`aperture` are computed (`evaluate.ts:193`) but never read
  by `renderer.ts`.
- **`add_sound_effect`** rejects 6 of the 11 kinds its schema lists.
- **The `click` cue** plays as `pop`.
- **Tempo detection** likely reads 90 BPM tracks with dotted-8th figures as 120 (the study kit did).

**How long.**
- Phase 0 quick fixes take days.
- Phases A–C take about **12–14 weeks** of focused work, less with packages run in parallel. The character
  system alone is 6–8 weeks.
- Everything is sequenced behind the WORLD-CLASS-PLAN P4/P5 packages that own the tool and runtime files
  (§6).

**How we'll know.** Each film gets a golden recreation: a 10–15 s piece that must pass frame QA, pacing QA
against its measured profile, and the council, and that the user signs off side by side with the reference.

---

## 1. How the study was done

- **Material.**
  - The films were downloaded at the best 1080p stream. J6A7 is 720p at source; the two MDS promos are
    15 fps uploads.
  - Everything third-party stays git-ignored in `docs/research/video-study/`. Only the kit, the reports and
    the Blender proof scripts are tracked.
- **The kit, [analyze.py](research/video-study/analyze.py).** From **12,094 frames** it produces:
  - every frame at 1280×720, and 760 frame-by-frame sheets;
  - overview sheets;
  - per-frame diff, moving area and global camera (LK + RANSAC);
  - cuts, palettes, and motion bursts with inferred easing;
  - audio onsets and tempo;
  - caption word timings.
- **Known weaknesses of the kit:**
  - It only detects colour-jump cuts, so it misses foreground swaps and cuts hidden in near-black or blur.
  - Its tempo reads 90 BPM dotted-8th music as 120 (a triplet alias).
  - Its frame diff counts camera and FX motion, so it can't measure character exposure.

  The reports measured around all three.
- **Agents.**
  - Nine analysts each worked through every sheet of one film and saved running notes (142 KB).
  - The account's spend limit stopped them, so nine "finisher" agents wrote the reports from those notes.
    They also checked about 20 frames each at full resolution and took new measurements with OpenCV
    tracking and bezier fits (rmse reported).
  - An architecture agent mapped the codebase ([01-architecture-map.md](research/video-study/reports/01-architecture-map.md)).
  - A research agent checked every licence and library online ([02-research.md](research/video-study/reports/02-research.md)).
- **Statistics discipline.** Onsets are dense (2–5/s), so "within ±2 f of an onset" is 29–90% likely by
  chance.
  - Sync is claimed only against that baseline, or on a detected beat grid.
  - Measured bezier curves are quoted with their fit error.
  - Fits that ran into the parameter limits were thrown out.

---

## 2. What the films teach: the measured grammar

### 2.1 Timing tokens (these become `kit/common.ts` defaults and genre-pack overrides)

f = frames at 30 fps unless noted. Limelight is 25 fps, MDS 24 fps, and the MDS promos are 15 fps uploads.
Curves are cubic-bezier.

| Token | Value | Evidence |
|---|---|---|
| **House ease** (SaaS light) | **(0.25, 0, 0, 1)**. The folder "recentre" is this fast-start ease-out, not an ease-in-out | Four Workly moves agree (rmse ≤ 0.011) |
| **Settle** (dark AI) | expo-out: each frame keeps about **84–85%** of the remaining distance. (0.187, 0.368, 0.123, 0.981) over 43 f | Solair card stack (rmse 0.003); Virgil card scale ×0.843/f |
| **Panel / card entrance** | Material 3 "emphasized-decelerate" **(0.05, 0.7, 0.1, 1)** for position and tilt. **Split settle:** orientation lands in about 6 f, scale in about 16 f. Softer starts also occur | Virgil card (tilt 6 f / scale 16 f); Limelight phone rise (0.149, 0.844, 0.113, 0.98) over 33 f with blur σ 24 → 0 (rmse 0.0009); Workly dashboard (0.086, 0.042, 0.083, 0.905) over 20 f |
| **Assemble** (UI parts rise) | Stagger **by distance, not by delay**. Parts share one clock and farther parts travel farther (body 1.2× the sidebar). Header leads by 3.3 f and rises in 13 f; body 24 f | WasteProtection |
| **Pop-in** | Full scale in **3–4 f**. Overshoot shows in rotation, 7–11% of the tilt. Pop squash 9%, settling in 3 f. A hit is a 1 f 15% squash that settles in 7 f | Workly bubbles; Motion Tricks |
| **Hover-lift** | ×1.088: **9 f in, 19 f hold, 8 f out**. Other rows dim to 32% detail, starting 4 f after the lift. The cursor then sweeps the remaining rows at about 5 f per row | WasteProtection (only row 1 lifts) |
| **Sibling stagger** | Rows and chars 1 f; words 2–4 f; cards and widgets 2 f | Several films |
| **Camera push** | Ease-in-out, about easeInOutCubic. For example the Virgil "Invite" push, 25 f, (0.57, 0, 0.41, 0.98) | Virgil |
| **Creep, snap, settle** | Two keys: (1.0, 0.093, 0.856, 0.033), then (0.079, 0.602, 0.182, 0.958). Limelight's dashboard tilt-in: rotY −25°, rotX −16.6°, ×1.44 over 35 f | Limelight |
| **Long truck** | Linear, with an expo-out tail | Virgil, 100 f |
| **Zoom-out reveal** | 538% → 100% over 2.67 s (0.155, 0.195, 0.006, 1), rmse 0.0011; 585% → 100% over 1.47 s (0.123, 1, 0.517, 1); 26 f (0.39, 0.03, 0, 1.04) | Motion Tricks; MDS |
| **Wordmark rise** | 28–44 f (0.044, 0.419, 0.044, 0.991), rmse 0.004 | Workly |
| **Exit / whip** | **3–14 f ease-in, speed ×1.4 per frame.** Some whips carry no motion blur; some cut at peak speed | Solair, Motion Tricks, Workly, WasteProtection |
| **One-frame snaps** | Zoom-out to about 0.3×, punch-in 1.4×, button press 0.66×. Scale cuts: ×3 punch-in, then pull-back | Solair (7 snaps set its rhythm); Limelight |
| **Slam** | 1.29× → 1.07 → 1.0 in 2 f; or tracking −150 → 0 in 3 f on a sub hit | Workly "Built-in"; Solair "Boom" |
| **Tracking breathe** | Opens +0.166 em in 9 f, holds 10 f, closes in 15 f, then a ×1.18 scale-up over 14 f. The *weight* doesn't breathe | Workly |
| **Typewriter** | **30 chars/s for UI fields**; about **12–13 chars/s for text read along with the voice-over**; word-chunks (~5 chars/f) for long prompts. Newest char fades over 2–3 f, or a soft edge up to 8 chars. The accent-colour front trails the caret by 4–8 chars and either holds about 30 f and snaps off (Workly) or settles in about 4 f (Solair) | Workly, Virgil, Solair, WasteProtection |
| **Retype / condense morph** | The new sentence overwrites the old one left to right; changed letters flash the accent; the line re-centres | Solair (not random glyphs) |
| **Focus pull** | **10–20 f, linear in σ**, peak σ 3–13 px | Virgil |
| **Blur-bridge** | Blur switches on in 1 f (σ ≈ 10 px); a **hidden cut 3 f later** to a 0.56× framing; focus is back about 7 f after the cut | Workly f363–373 |
| **Zoom-through** | The old element recedes ×0.3 in 4 f; the new one arrives from the lens, 2.5× → 1.0 with blur, in 7 f | Virgil |
| **Card zoom reveal** | 6–8 f, (0.15, 0.46, 0.43, 1) | Modern Motion |
| **Shape wipe, outward** | The Virgil star grows *linearly*; its white wake covers the frame 0 → 99% in 14 f (0.659, −0.072, 0.787, 1.085). The Workly star covers only 39%, then a violet 3D ribbon finishes the wipe | Virgil, Workly |
| **Logo-resolve, inward** | The brand star arrives *from the lens* and shrinks into the logo: 595 → 87 px in 15 f, spinning 145° over 43 f (0.162, 0.495, 0.117, 1.005); purple → white in 11 f | Solair |
| **Logo mask-slide** | **10–11 f.** The mark slides ease-in-out (0.635, 0.177, 0.109, 0.977) and shrinks to 0.59; the word comes out expo-out (0.032, 0, 0.072, 0.816). Brackets converge 1125 → 144 px in 13 f (0.134, 0.793, 0.264, 0.957), rmse 0.0003 | Limelight |
| **Giant type pan** (@720p) | **Land:** 308 → 11 px/f over 46 f (0.058, 0.519, 0.254, 1) plus a 9.5 px/f drift. **Hop** to the next word: 59 f, peak 180 px/f (0.627, 0.085, 0.336, 0.862). **Land** again. Letters are 0.57 of frame height | WasteProtection |
| **Spinner wind-up** | Rotation 1.7 → 17.8 °/f (×1.16 per frame) while the radius shrinks 453 → 238 px. Tiles round into dots in 8 f and light up in 4 f | Solair |
| **Portal accelerando** | Loops of **3-3-2-2-2-1-1-1 sixteenths** (dotted 8ths → 8ths → 16ths at 90 BPM). Each loop is the *same constant-speed camera move, cut shorter* | aflow |
| **White-out / black breath** | White-out 7–13 f; black breath 12 f before a drop; narrative black holds 36–74 f | aflow, MDS |
| **End card** | Hold 1.2–3.9 s. It may be silent (Virgil). The music fades at −10 dB/s | Several films |
| **Structure** | **SaaS light:** background never cuts; foreground swaps every 3–5 s. **Dark AI:** cuts hidden in 3–8 f ease-in exits. **Brand and character:** shots of 2.4–3.7 s. **Montage:** 5–17 f per shot | All films |
| **Text vs voice-over** | **Three classes:** headlines *lead* the word (median 0.56 s); payoffs (counter, chart spike, wordmark) *land on* the word (±0.2 s); typed lines *finish* 0.3 s before the last word. UI state changes land 0–4 f after the spoken noun; word pops 0–8 f after (median +4) | Limelight, Solair |
| **VO budget** | About 150 words per minute. The music bed sits about 10 dB under the voice | Motion Tricks, research |
| **Music** | **Find the 16th-note grid first.** World changes go on 4-bar phrase lines (aflow: all 3 big events within 2 f, 1.25% chance each). **Cut on the 16th pickup; land the motion on the beat** (aflow: motion accents 6/9 on beats, p ≈ 0.003). Virgil: 115 BPM, 7/8 transitions on beats (p ≈ 0.005). The drop switches worlds. WasteProtection (134 BPM) and MDS cut at chance | aflow, Virgil |
| **UI sound** | With voice-over, a frame-synced tick on most UI events (Limelight 18/25, against 8.4 by chance); clicks on onsets (Solair 6/6). Music-only films have no UI sound effects (Virgil). Loudness −14 LUFS / −1 dBTP | Limelight, Solair, Virgil |

**Character tokens.** MDS, 24 fps, measured on the character only:
- **Exposure.** Drawings are 32% ones, 50% twos, 14% threes, 4% fours. By screen time: 17 / 53 / 22 / 9.
  - The hero is on **twos in close-ups *and* in action**. Ones appear only on 1–3 f accents; threes and fours
    on floats and idles.
  - Dead holds of 5 f or more are 31% of the hero's active time.
- **Blink:** 4 f (half, closed, closed, half) plus a rounder overshoot opening drawing. A snap blink is 2 f
  closed.
- **Anticipation scales with mass**: 2 f for a hop, up to 12 f plus a 4 f hold for a giant's take-off.
- **Hop:** crouch 2, take-off 1, hang 7, fall 2, contact 2, squash 6. The fall stretches 1.24×.
- **Leap:** crouch 3, a 1 f stretched take-off, air 8, stretch 4 (height about 1.7×, width about 0.6×, area
  kept), contact 2, squash 2 (height 0.55×).
- **Run:** *not* a cycle. 5–8 f per step on twos, a lean of about 21°, and a 13 f lean-back brake before
  reversing.
- **Idle loops:** 12–13 f on threes, 4 drawings.
- **Walk:** the standard is 12 f per step. Motion Tricks' run is an exact 12 f loop, 6 f per step.
- **Light flicker:** dim 2, off 2, on 7, off 2, on.
- **Grain** is a static texture on *backgrounds only*. Characters carry none.

### 2.2 Look tokens (genre style packs)

| Genre | Background | Surfaces | Type | Accent devices |
|---|---|---|---|---|
| SaaS light (Workly, Limelight, Virgil light) | Near-white or lavender `#eef0f6`–`#dde3f3`, drifting mesh-gradient blobs, soft diagonal light shafts. Virgil light is white/sage | Frosted glass cards, radius 24–32 px @1080, very soft large bluish shadow | Inter-like grotesk; dark `#1d1d1f` plus one accent (Limelight `#1d7cc9`–`#1d86cc`); keyword in the accent or a gradient keyword fill | Cursor as a black dot (Limelight, 40 px) or hand; face-pile pills; check pops; a hopping continuity dot |
| Dark AI (Solair, WasteProtection) | Near-black violet `#07030d`–`#0c0c0c` + violet mesh blobs; concentric thin rings. Virgil dark is **slate `#232C33`** with a faint grid | Glass cards with a 1 px white 8–15% rim and inner glow | Solair: solid white type with an accent lead. WasteProtection: violet → lilac gradients | **4-point concave sparkle** as the AI glyph, wipe and logo; glow rings; neon capsule CTA |
| Brand orb film (aflow) | Black → navy → lavender → white; an illustrated finale | Hero orb = **frosted white shell with a blue core**, or a flat-decal "iris" orb. Only the secondary bubbles are iridescent | Small bold oblique wordmark; the full stop is the orb | Star glints, lens rings, echo trails, white-outs |
| MDS character | Flat pastel gradients or black, with a static grain *on backgrounds only* | Flat fills, no outlines, thin interior lines; light cones as mattes | Brush-script logo write-on | Palette-swap cuts, noise dissolves, drawn FX |
| Motion Tricks (2.5D) | Flat pastel pink `#f8d2d6` | **Rim-bright** soft forms with a 4-colour hue field; card-decal faces; depth-band blur | Rounded heavy geometric sans with per-letter gradients, bevel and inner glow | Googly-eye shape characters; tutorial overlays (boxes, bezier handles, dotted motion paths) |
| Modern Motion (stylised 3D) | Painted cyclorama, window gobo, haze, strong DOF | Glossy plastic, frosted glass, kintsugi; the crystal is lit by a **hand-made gradient environment** | Montserrat ExtraBold supers; flat 2D lockups | Animated gradient frame border, hard diagonal wipes, grid of loops |

### 2.3 Recurring techniques, and Bhippi today

| # | Technique | Seen in | Bhippi today | Pillar |
|---|---|---|---|---|
| T1 | **Continuity object** (dot, orb or sparkle) carries the eye and becomes cursor, caret or logo | 6 of 9 films | No | P4 |
| T2 | **Type ↔ UI match** (line snaps into a pill or field; field text collapses into an orb) | Solair, Virgil | No | P2, P4 |
| T3 | **Living UI**: typing, clicks, hover-lift, assemble, page swap, drag, callout magnifier, counters, chart draw, notifications, named cursors | All SaaS | Partly (`dock-cursor`, `stat-badges`) | P3 |
| T4 | **Tilted UI planes + depth of field**, z-lifted cards, rack focus | All SaaS | Partly. `threeD` works; **camera DOF is dead code** | P3, P4 |
| T5 | **Typing** (colour front, caret, soft edge, backspace/retype, retype-condense, scatter-converge, snap-to-white) | 7 of 9 | Partly (`reveal`, `cascade`) | P2 |
| T6 | **Tracking breathe / slam / collapse**; variable weight (MDS promos) | Workly, Solair, Virgil | Partly (animators) | P2 |
| T7 | **Inline pills and avatars in type**, targetable | Limelight | No | P2 |
| T8 | **Gradient type fill** (keyword gradients, a moving colour front, hue drift) | 5 of 9 | No (solid colour only) | P2 |
| T9 | **Transitions**: zoom-through, whip (cut at peak), blur-bridge, z-recede, type-through, card zoom, cursor-bridge, scale cuts, one-frame snaps | All | Keyed by hand only | P4 |
| T10 | **Brand-glyph wipes**: outward (star + wake) and inward logo-resolve | Workly, Virgil, Solair | No | P4 |
| T11 | **Logo builds**: mask-slide, bracket converge, trim write-on, circle → mark, monogram collapse | Limelight, WasteProtection, MDS | Partly (`brand-logo-sting`) | P1, P4 |
| T12 | **Particles**: confetti falling with DOF, twinkles, dust, flakes | Virgil, aflow, MDS | No | P5 |
| T13 | **Light**: star glints, god rays, lens rings, light columns, echo trails, smears, glow-ring shockwaves, dot-wave terrain, mesh gradients | aflow, WasteProtection, Solair, MDS | Partly | P5 |
| T14 | **Array morphs**: tiles → capsules → dots → spinner; squares → sparkle | Solair, WasteProtection | No | P1 |
| T15 | **2.5D forms**: rim-lit spheres, cylinders, tumbling cubes (cheated), card decals, swap-when-hidden, extruded slabs | Motion Tricks | No | P6 |
| T16 | **Real 3D**: device hero with ribbons, crystal, sphere bouquet, panel tunnel, letters drop, 3D cursor, globe | Workly, aflow, Modern Motion, Solair, WasteProtection | **No** (scene3d is dead code) | P7 |
| T17 | **Character acting**: rigs on twos, principles, face, light mattes | MDS, Motion Tricks | No (stick figure) | P8 |
| T18 | **Edit rhythm**: phrase-line world switches, 16th-pickup cuts, accelerando loops, breaths, UI ticks | aflow, Virgil, Limelight | Partly (`snap_cuts_to_beats`) | P9, P10 |

---

## 3. Film by film

A short version of each report: what the film is, what Bhippi needs, and the golden beat. NEW marks a tool
or field this plan adds. The full recreate recipes, with tool calls and scene JSON, are in each report's §8.

### 3.1 Workly: SaaS explainer, light (YMWbH7xrTHk, Solair, 28 s)

**The beats** ([report](research/video-study/reports/YMWbH7xrTHk.md)):
1. **Chat-bubble pile hook.** Pills pop in over 3–4 f, and a blue continuity dot hops from bubble to bubble.
2. **Headline.** The world scrolls up to "Can't keep up?". A 6 f blue invert flash sits *inside a 1-second
   music drop-out*.
3. **Tracking breathe.** The weight only steps, on twos, inside the flash.
4. **Colour front.** "Meet your new AI workspace" types with a colour front; the phrases split, and a
   **folder is born in the gap** in 5 f.
5. **Blur-bridge.** A cursor drags the folder, then a **blur-bridge hidden cut** (f366) into a perspective
   app window, followed by a drop and a glow pulse.
6. **Dashboard.** The "Built-in" slam, then "Business analytics" types in and the dashboard rises with
   parallax satellite cards.
7. **Star wipe into 3D.** The star wipe covers 39% of the frame and a violet 3D ribbon finishes it, revealing
   a **real 3D phone with satin ribbons**.
8. **Chat headline.** "Chat / With our / AI Bot" in a staircase, then the line spacing collapses.
9. **Constellation.** "No more chaos." with rings, and a notification constellation.
10. **Close.** A whip (no motion blur), the "Workly" rise, the tagline, and a dip to black.

**Needs:** T1, T3, T4, T5, T6, T8, T10 and T16. Plus:
- a blur-bridge transition;
- a mesh-gradient background;
- animatable line height;
- a **per-layer `bleed` flag**, because the film puts type off-frame on purpose and the safe-area fitter
  would "fix" it.

**Golden:** f1–300: bubble pile, headline, breathe, type split, folder.

### 3.2 Virgil: SaaS launch, light ↔ dark (b1GDr86JW3M, Sebastian, 37 s, music only)

**The beats** ([report](research/video-study/reports/b1GDr86JW3M.md)):
1. **Hook.** Per-char "Too many" cascades in and out in reverse, then a **zoom-through** into a search bar.
2. **Whip.** The search bars stack and whip into "questions", which settles 95% in 4 f.
3. **Rings, then the drop.** "Too little time" sets off neumorphic rings; the camera pushes into the disc and
   cuts **on the drop** to the slate dark world.
4. **Dark world.** A card lands with a split settle (tilt 6 f, scale 16 f); a checklist is revealed by
   zoom-out.
5. **The orb.** The search bar drops into a chat field, and its **text collapses by tracking into a glass
   orb**. The orb flies an S path trailing a ribbon; "From weeks **to** seconds" follows, and the orb eats
   letters, becomes an "S" badge, coin-flips and streams "seconds" out.
6. **Collaboration.** Rack-focus words and drag-and-drop cards with lag tilt.
7. **Invite.** A 25 f push to "Invite", then confetti **falling from the top edge** with DOF.
8. **Close.** Dark → white is a **camera truck across a gradient**, not a cut. "Trusted sources" in a
   gradient; a **sparkle star rides the typing edge as the caret**; the star's white wake wipes to a
   **silent** end card.

**Music.** 115 BPM; 7 of 8 transitions land on beats (p ≈ 0.005). The film carries no UI sound effects.

**Needs:**
- T2, T3, T4, T5, T9, T10, T12;
- **cross-layer links**: one layer's value drives another's (the ribbon follows the orb, letters vanish under
  the orb, the star rides the caret);
- the split-settle token;
- working camera DOF;
- a music-only sound mode.

**Golden:** 8.3–18.7 s: card fly-in, checklist, bar into field, collapse into orb, ribbon, "to seconds".

### 3.3 Limelight: SaaS explainer, UI + stock video (lhG6p7xtkPE, Burnwe, 65 s, 25 fps)

**The film** ([report](research/video-study/reports/lhG6p7xtkPE.md)). A lavender world whose **background
never cuts**; about 15 foreground swaps.
- **The dot.** A 40 px black-dot cursor **becomes the logo dot**. Brackets converge 1125 → 144 px in 13 f,
  and the wordmark slides out from behind the mark in 10–11 f.
- **Cursor-bridged swaps.** The dot holds its exact screen position.
- **Headlines.** Inline face-pile pills inside the lines. **Z-recede:** the old block drops to about 0.65 and
  blurs, and the new one pops sharp and rises in 13 f.
- **UI.** Real-looking UI with **stock video inside a post**. A creep-snap-settle dashboard tilt, a ×3
  punch-in scale cut, counters and a chart spike landing *on* the VO word.
- **Sound.** A **UI tick on 18 of 25 UI events.**

**Needs:**
- T1, T3, T4, T5, T7 and T11 (the mark is doable today, from L-corners and a circle);
- `attach` a layer to a UI part (video inside the UI);
- word timing with lead, land and span anchors;
- scale cuts;
- the UI tick layer.

**Golden:** list rejects, "What if…" face-pile type, dot → logo converge and slide.

### 3.4 Solair: agency reel, dark AI (luoDI5Bo0w0, 41 s)

**The film** ([report](research/video-study/reports/luoDI5Bo0w0.md)):
- **Words land.** Giant words with echo ghosts, a **one-frame zoom-out punch** into rings and sparkles.
- **Device.** A tablet with a 3D extruded cursor, then a one-frame snap zoom.
- **Tile wall.** A type → pill snap over a tile wall, with clicks and ripples.
- **Signature morph:** tiles → capsules → dots → a **spinner that winds up** (1.7 → 17.8 °/f) → the brand
  star **arrives from the lens and shrinks into the logo** (logo-resolve).
- **Portfolio.** A card stack whose client card holds a small star wipe (the client's logo, not a wipe of
  the frame).
- **Widgets and device.** Glass widgets fly in; **one device changes state on each VO noun**, 0–4 f after the
  word.
- **Type morph.** A **retype/condense morph** (not random glyphs), a teleprompter push line with the camera
  following the caret, review cards from the lens, and a capsule CTA.

**Rhythm.** About 11 hard cuts, hidden in 3–8 f ease-in exits (×1.4 per frame), and seven one-frame snaps.
All 6 clicks land on onsets. "Boom" is a +14 dB sub hit.

**Needs:**
- T2, T3, T5, T9, T10 (inward), T13 and T14 (**P1 array morph**);
- the settle token;
- presets for the one-frame snaps;
- a click on the press frame;
- a 3D cursor (a P7 asset or a P6 form).

**Golden:** tile wall clicks, tiles → dots → spinner, star logo-resolve.

### 3.5 WasteProtection: AI SaaS launch (J6A7JcbkWvM, ObiN Studio, 73 s, 134 BPM, cuts at chance)

**The film** ([report](research/video-study/reports/J6A7JcbkWvM.md)):
- **Open.** Feathered typing with a block caret; a **type-through** transition; a **dot-wave terrain**;
  scattered glyphs converging.
- **Giant type.** Land, hop to the next word, land; the letters are 0.57 of frame height.
- **Icons.** A glow ring and a z-field of Lucide-style icon tiles.
- **The light UI world** (about 43% of the film):
  - staggered-by-distance **assemble** and **callout magnifiers**;
  - a **hover-lift** on row 1 while the other rows dim, then the cursor sweeps rows 2–6;
  - page swaps with titles that backspace and retype;
  - a route drawn on a map, marker pops, pulses turning red;
  - the map shrinks into a card while alerts pop out.
- **Chat.** A chat prompt with word-chunk typing and a fading history.
- **AI signal.** Sparkle fly-through, then sine-wave echo strands.
- **Phone and cursors.** A phone notification stack; **named multiplayer cursors** on a skeleton UI.
- **Photo grid.** It morphs to a sparkle.
- **Close.** A marquee pill wall, a globe, and a logo build: circle, shield stroke, mask-slide, monogram.

**Needs:** almost all of P2–P5.
- UiAction additions: `pop`, `tooltip`, `focus`, `tour`, `submit`, `notify`, `fill`.
- Named cursors.
- Scatter-converge and snap-to-white typing.
- Type-through, and a whip that cuts at peak speed.
- `dot-wave` and `mesh-gradient` as **fragment shaders**, not particles.

**Golden:** dashboard assemble, callouts, click, page swap, row-1 hover-lift, cursor sweep.

### 3.6 aflow: brand identity film (xBZzVNi_4Xw, **marked important**, 47 s, 90 BPM)

**The film** ([report](research/video-study/reports/xBZzVNi_4Xw.md)). The brand hero is **an orb**: a frosted
white shell with a blue core, or a flat-decal "iris" orb. It is the full stop of "aflow." and the whole film
is its journey.
1. Vesica "eye" circles draw on by trim, and the orb's flat decals slide across it.
2. The marble rises with a light trail.
3. The **drop-1 cut lands on a 4-bar phrase line**, onto a sphere bouquet with a star glint.
4. An echo-capsule rise, a white-out, then **portal-ring loops cut shorter each time** in 16ths
   (3-3-2-2-2-1-1-1).
5. Lavender space: bubbles, shards and a refracting bubble.
6. **Orb as pen tool**: the circle fills with a gradient and gets a bounding box, then a flat → 3D
   match-transform.
7. The orb drops onto a glowing horizon. There is **no squash**: a linear fall, a 10 f settle, landing
   **0.2 f from the phrase line**.
8. A **ring of UI cards (flat planes, so 2.5D-able)** is lifted one by one.
9. A panel tunnel (sweeps at about the 8th-note rate, not beat-locked), then a phone with a light fountain.
10. The logo arrives by the world resolving around it; the end card.

About **27% of the runtime needs Blender**; 37% looks 3D.

**Rules learned.** Big world changes go on phrase lines. Cut on the 16th pickup; land the motion on the beat.

**Needs:**
- **a brand-kit hero object**, plus a continuity planner;
- a portal-accelerando template driven by the tempo grid;
- echo, smear and star-glint effects;
- Blender presets:
  - `pearl-core-orb` and `iris-orb` (varying thin-film where iridescence is wanted);
  - `sphere-bouquet`;
  - `panel-tunnel`;
  - `device-light-fountain`;
- a **fixed tempo detector**;
- `snap_cuts_to_beats` with phrase and drop anchors (NEW; `mode` doesn't exist today).

**Golden:** orb drop on the horizon landing on the phrase line, then the crane up to the card ring.

### 3.7 Motion Design School: character film (HO3VEhvobCQ, **marked very important**, 73 s, 24 fps)

**The film** ([report](research/video-study/reports/HO3VEhvobCQ.md)). One continuous hand-drawn narrative
(64 s), then a 14-shot student montage (5–17 f per shot), then a logo write-on.

**The hero.** A flattened dome head, big almond eyes, noodle arms, a huge hoodie with drawstrings; flat
fills with no outlines.

**The story.**
1. A software world whose UI reacts to clones of the hero.
2. A palette-swap cut to "play mode".
3. A polygon monster chase.
4. A fall through a pastel sky.
5. A flashlight scene where **light is a matte**: colour inside the beam, silhouette outside.
6. A splash and disintegration.
7. An eyelid-aperture wake-up.
8. A pastel cast of discipline characters, each with idle loops and one staggered action.
9. The glowing cube, god rays and a white-out.

**Measured** (character only, §2.1): on twos with ones for accents; anticipation scales with mass; the hop
and leap charts; a run with no cycle.

**The honest bar.** This is frame-by-frame cel animation. Rigs that follow the principles, animated on twos
with accents on ones, plus light mattes and drawn FX, reach **credible studio explainer** quality in this
look. They do not reach the hand-drawn in-betweens, boils and redrawn turnarounds. §4 P8 says what rigs
reach and what they don't.

**Golden:** the flashlight beat: light-matte colour reveal, acting on twos, blink, firefly, flicker.

### 3.8 Motion Tricks: 2D that reads as 3D (P0Ns0rphILY, Emanuele Colombo, 38 s, 15 fps upload)

**How each look is faked** ([report](research/video-study/reports/P0Ns0rphILY.md)):
- **Shading is rim-bright**, not Lambert: L* ≈ 40.9 + 35.4·√(1 − n_z) + 21·(n_xy toward 111°), within
  4.3 L*, with a 4-colour hue field.
- **Eyes are flat cards** on a short arm (0.26 r) that flip edge-on and hide. Only the checker "O" is truly
  sphere-mapped, and mid-spin its terminator becomes an S-curve: a slanted wipe.
- **Sphere → cube is a one-frame swap while the face is hidden**, disguised by a twist. Sphere → torus is a
  real morph.
- **The tumbling cube is cheated**: one soft square plus a sliding dark band, stretching 1.25× (a true cube
  would reach 1.41×).
- **Extruded slabs converge to a vanishing point**, which needs real camera rays.
- **Blur follows a focus band**: sharp across a 2.2× depth band, blurred nearer *and* farther.
- **The portal runs backwards**: the old scene shows inside the O while ENROLL NOW pulls back.
- **Type:** inflated gradient type (bevel, inner glow, hue drift).
- **Numbers:** the run is an exact 12 f loop; the title zoom-out is 538% → 100% over 2.67 s.

**Needs:**
- the P6 `form` layer: camera-ray traced, looks `soft-rim` / `jelly` / `two-tone`, card decals,
  swap-when-hidden;
- camera DOF with a focus band and separate near/far blur;
- SDF-based layer styles for type;
- motion paths with tangents, auto-orient, rolling and a dotted overlay.

**Golden:** a sphere with eyes rotates (the card flips), swap-when-hidden to a cube, a stack squash cascade.

### 3.9 Modern Motion: AE + Blender (2Fc9sGYFj1I, Motion Design School, 90 s, 15 fps comp)

**The workflow** ([report](research/video-study/reports/2Fc9sGYFj1I.md)):
- Blender for **modelling** (the crystal from a cube with loop cuts, a ginkgo leaf) and probably animation
  blocking.
- **All hero shots rendered in AE's Advanced 3D** from glTF imports, the Super3D primitive library and
  extruded AE shape layers.
- The crystal's iridescent facets come from a **hand-made gradient environment** reflected by a glossy
  faceted mesh.

**In Bhippi,** Blender does both the building (primitives, glTF, SVG and text extrusion) and the rendering.
Proof 2 reproduced the crystal in both engines (§5).

**The look.**
- Painted cyclorama, window gobo, haze, DOF.
- Painterly post and grain.
- An **animated gradient frame border**.
- Hard diagonal wipes; card-zoom reveals (8 f, (0.15, 0.46, 0.43, 1)).
- A grid of loops swapping from the 2D concept to the 3D render.
- Letters that drop and bounce into place.
- Marker annotations over screen captures.

**Needs:** P7 with the `crystal-gradient-env` preset, a **keyed** `letters-drop` (not a rigid body; §5),
`gradient-border` and `painterly` effects, and a transitions kit.

**Golden:** letters drop and bounce into "Modern Motion", with the flat lockup and the gradient border.

---

## 4. The build: eleven pillars

Sizes: **S** is 1–3 days, **M** about 1 week, **L** 2–3 weeks, **XL** 6–8 weeks. Every pillar follows the
integration recipes in the [architecture map](research/video-study/reports/01-architecture-map.md).

### Constraints every pillar respects

1. **New data lives inside the motion scene JSON.**
   - A motion scene is opaque JSON to Rust, so new *layer types* need no Rust and no format change.
   - New *ClipSource* variants break saves until WORLD-CLASS-PLAN Phase 1.10 lands. Nothing here needs one.
     Blender and Lottie frames come back as `sequence` footage layers.
2. **One layer, not forty.** Every scene layer becomes a timeline clip (`explodeScene`), so a character, a UI
   screen or a particle system is **one layer** with internal structure.
3. **Rasters are cached by signature**, as text is today. Shapes are currently redrawn every frame
   (`renderer.ts:193-197`).
4. **Solvers are pure and tested**: IK, morph, path ops, UI layout, particle simulation, next to
   `evaluate.ts`.
5. **Knowledge is pulled, not pushed**: guides come from read tools. `ai-tools.json` (163 KB, sent every
   round) gets one-liners only.
6. **P4 and P5 land first.** They own the tool files and the process runner. Blender runs on P5's
   `run_cancellable` plus the Job Object.
7. **Libraries are npm-bundled or Rust crates** (CSP; assume `unsafe-eval` is going away).
8. **Informational new types** (`ui`, `character`, `form`, text-bearing `particles`) are added to
   `safeArea.ts`, `polish.ts`, `coverage.ts` and `validate.ts` `overlayBox`. A per-layer
   **`bleed: true`** opts a layer out of the safe-area fit on purpose.

### Phase 0: quick fixes (days, before any pillar)

| Fix | Size | Where |
|---|---|---|
| **Make camera DOF actually render**: per-3D-layer circle-of-confusion blur from `CameraState.focus`/`aperture`, with a focus *band* and separate near/far strengths | S–M | `renderer.ts`; values from `evaluate.ts:193` |
| `add_sound_effect` / `generate_selection_sound` accept all 11 kinds; the `click` cue gets a real click | S | `aiTools.ts:2513`, `:2033`; `motionTools.ts:182` |
| **Tempo detection**: find the 16th tatum first, then beats, bars, 4-bar phrases and drops, so dotted-8th tracks don't alias to ×4/3 | S | `analyze_music_beats`; `analyze.py` |
| `TIMING` tokens + house ease + settle curve (§2.1) in `kit/common.ts` | S | kit |
| Per-layer `bleed` flag honoured by `fitToSafeArea` and QA | S | `safeArea.ts`, `polish.ts` |
| Fix `MOTION-ENGINE.md`: remove the claim that camera `focus`/`aperture` render until they do | S | docs |

### P1. Vector engine 2.0 (L)

**Schema** (`src/motion/types.ts`). `ShapeData` gains a tree; the legacy `points`/`curve` stays.

```ts
type PathVertex = [x: number, y: number, inX?: number, inY?: number, outX?: number, outY?: number];
type SubPath = { v: PathVertex[]; closed?: boolean };           // AE/Lottie model → Lottie maps 1:1
type ShapeItem =
  | { kind: 'path'; d?: string /* SVG path data */; paths?: Prop<SubPath[]> }
  | { kind: 'rect' | 'ellipse' | 'polygon' | 'star'; size?: Prop<Vec>; radius?: Prop<number>; sides?: number; innerRadius?: Prop<number> }
  | { kind: 'icon'; name: string /* Lucide */; strokeWidth?: Prop<number> }
  | { kind: 'array'; item: ShapeItem; layout: ArrayLayout; morph?: { to: ArrayLayout; t: Prop<number>; stagger?: number } }  // tiles → dots → ring
  | { kind: 'group'; items: ShapeItem[]; transform?: Transform; fill?: Paint; stroke?: Stroke; ops?: PathOp[] };
type ArrayLayout = { type: 'grid' | 'ring' | 'line' | 'masonry' | 'scatter'; count: number; spacing?: Vec; radius?: Prop<number>; itemSize?: Prop<Vec>; itemRadius?: Prop<number>; rotation?: Prop<number>; seed?: number };
type Paint = string | { gradient: { kind: 'linear' | 'radial'; stops: [number, string][]; from?: Prop<Vec>; to?: Prop<Vec>; offset?: Prop<number> } };
type Stroke = { paint: Paint; width: Prop<number>; cap?; join?; dash?: Vec; trim?: { start?; end?; offset? }; taper?: { start?: number; end?: number } };
type PathOp =
  | { op: 'round-corners'; radius: Prop<number> } | { op: 'offset'; amount: Prop<number> }
  | { op: 'merge'; mode: 'union' | 'subtract' | 'intersect' | 'xor' }
  | { op: 'twist' | 'zigzag' | 'wiggle-path' | 'pucker'; amount: Prop<number>; seed?: number }
  | { op: 'repeater'; count: number; offset: Vec; scale?: number; rotation?: number; opacityEnd?: number };
// LayerCommon += { styles?: LayerStyle[] } — built on a signed distance field of the layer alpha
type LayerStyle =
  | { style: 'inner-shadow' | 'inner-glow' | 'outer-glow'; color; opacity; distance?; angle?; size; choke? }
  | { style: 'bevel'; depth; size; angle; altitude; highlight; shadow }   // inflated type
  | { style: 'gradient-overlay'; gradient; angle; offset?: Prop<number>; blend? };
```

**Rendering.**
- `Path2D` beziers with even-odd fill and gradient strokes; recursive groups.
- **Path ops** run through **Clipper2** (booleans + offset, about 20 KB gzipped) on flattened beziers.
  Round corners and twist are in-house. Keep PathKit (135 KB gzipped WASM) in reserve for ops that must stay
  curves. Skip CanvasKit (2.9 MB).
- **Morph** by arc-length resampling with rotation alignment (in-house, the flubber approach).
- **Layer styles** as GPU passes over an SDF of the layer's alpha.
- **Signature cache**, so static icons upload once.

**SVG import.**
- `.svg` in `library.rs:61`.
- Parse with **usvg (Rust)**, which normalises transforms, `use` elements, CSS and arcs into paths, then emit
  `ShapeItem`s.
- `import_brand_logo` with an SVG then gives a real vector logo that can be trimmed, morphed and extruded
  (P7).

**Icons.** Bundle **Lucide** (2,118 icons; ISC, with the Feather-derived ones also MIT) as data, plus
`search_icons` (NEW, a read tool).

**Motion paths.** Spatial tangents on `position` keys, `autoOrient`, `roll` (no-slip rolling), and an
optional **dotted motion-path overlay** with keyframe ticks: Motion Tricks' tutorial language.

### P2. Type engine + bundled fonts (M–L)

- **Fonts:**
  - Bundle OFL fonts: Inter, Manrope, Plus Jakarta Sans, Sora, Outfit, Montserrat, Fraunces, Caveat.
    None has a width axis, so add **Mona Sans or Archivo** for `wdth`.
  - They ship as `.woff2` in `dist`, registered with `FontFace`.
  - **Static TTF instances go to the fonts dir libass reads**, because libass ignores variable fonts.
- **Canvas facts (tested in Chromium 153 = the installed WebView2):**
  - weight animates smoothly through a numeric weight in `ctx.font`;
  - `ctx.fontStretch` accepts keywords only;
  - `ctx.fontVariationSettings` doesn't exist;
  - `FontFace` `variationSettings` works.

  So `axes.wght` is animatable; `wdth` needs a `FontFace` per step.
- **Text paint:** `fill?: Paint` with a per-pixel gradient and an animatable `offset`. This covers keyword
  gradients, hue drift, and the moving colour front when combined with `type.front`.
- **Typing (`type`):**

  ```ts
  type TypeOn = {
    cps?: number;              // 30 UI fields · 12–13 VO-read · or chunk:'word'
    edge?: number;             // soft opacity edge in chars (Virgil 8)
    front?: { color; lag?: number /* chars, 4–8 */; hold?: number /* f, then snap */ } | { color; settle?: number };
    caret?: 'bar' | 'block' | 'glyph:<layerId>'; blink?: number; recenter?: boolean;
    script?: ({ type: string } | { backspace: number } | { wait: number })[];
    chunk?: 'char' | 'word';
    snapToWhite?: boolean;     // WasteProtection: typed words sit accent, then snap to base
  };
  ```
- **Morphs and entrances:**
  - `retype: { to; flash?: color }`: the left-to-right overwrite with condense (Solair);
  - `scatter: { from: 'random' | 'offscreen'; seed; duration; ease }`: glyphs converge (WasteProtection);
  - tracking `slam`, `breathe`, `collapse-to-point` and `expand-from-point` presets.

  Tracking animators use the same units as layer tracking, with a centre anchor.
- **Inline spans:** `TextSpan += { inline?: { layer?; image?; icon?; pill?; width? }; id? }`. Layout reserves
  the width. Pills are targetable by id, so a cursor can tick them.
- **Word-anchored timing:**
  - `t: { word: "ROI", mode: 'lead' | 'land' | 'span', offset? }`, resolved from the transcript;
  - defaults per class: headlines lead by 0.56 s, payoffs land ±0.2 s, typed lines finish 0.3 s early.
- **Other:** animatable `lineHeight` (Workly's line-spacing collapse); `cascade.exit.order: 'reverse' |
  'random'`.

### P3. The UI-screen layer ★ the SaaS unlock (L)

```ts
{ type: 'ui', ui: {
    source: { html: string } | { screenshot: string, parts?: UiPart[] } | { asset: string },
    device?: 'none' | 'browser' | 'phone' | 'tablet' | 'laptop' | 'glass-card', theme?: 'light' | 'dark' | 'brand',
    states?: { id: string; html?: string; patch?: Record<string, string> }[],
    actions?: UiAction[],
    cursors?: { id: string; style: 'arrow' | 'hand' | 'dot' | 'glyph:<layerId>' | 'arrow-3d'; size?: number; name?: string; color?: string }[],
    attach?: { part: string; layer: string }[],          // video/footage/other layers masked into a UI part
    sfx?: 'ticks' | 'none',                               // frame-synced UI ticks (VO films) or silent (music-only)
} }
type UiAction =   // t: number | {word…} | {beat…}
  | { t; type: 'type' | 'backspace'; target; text?; cps? } | { t; type: 'click' | 'hover' | 'select' | 'submit'; target; cursor? }
  | { t; type: 'hover-lift'; target; scale?: 1.088; dimOthers?: 0.32 }       // 9 in / 19 hold / 8 out
  | { t; type: 'sweep'; targets: string; every?: number /* f, 5 */ }          // cursor scans rows
  | { t; type: 'drag'; target; to; lag?: number } | { t; type: 'scroll'; target?; by }
  | { t; type: 'state'; to } | { t; type: 'assemble' | 'disassemble'; order?: 'distance' | 'dom' }
  | { t; type: 'callout'; target; zoom?; side? } | { t; type: 'tooltip' | 'pop' | 'notify'; target; text? }
  | { t; type: 'highlight' | 'pulse' | 'ripple' | 'focus'; target; color? } | { t; type: 'tour'; targets: string[] }
  | { t; type: 'count'; target; to; duration } | { t; type: 'draw' | 'fill'; target; duration; ease? }
  | { t; type: 'lift'; target; z };
```

**How it works.**
- The HTML is rendered deterministically (`htmlFrames.ts`) into a texture **plus a part map** (`data-part`
  boxes, as with `data-hl`).
- Actions apply DOM state per frame. The texture updates only on change.
- Parts can be promoted to sub-textures for lift, hover-lift, callout and depth of field.
- The cursor path is generated automatically between targets: arcs, a 14 f ease-out glide, a press dip.
- Named multiplayer cursors are supported.
- Camera helpers: `follow: "cursor" | "caret"` and `push: { target, t, zoom }`.

**Where UIs come from:**
1. **The AI writes the HTML.** `create_ui_screen {kind, brand, content}`. Kinds include dashboard, table,
   chat, search, form, notification, phone-lock, folder card, drop zone, social post, profile, map, kanban,
   analytics, email, checkout and pricing.
2. **The user's product.** `capture_product_ui {url}` returns screenshots **and** DOM part boxes through the
   existing Playwright/scrape path.
3. **The user's screenshots.** Part detection finds the boxes.

**Tools (NEW):** `create_ui_screen`, `capture_product_ui`, `list_ui_kinds` (READ). Actions are fields on
`create_motion_scene` / `update_motion_scene`.

### P4. Camera director + transitions (L)

- **Continuity object:**
  - `scene.guide = { layer, path?, trail?, roles: [{ t, as: 'cursor' | 'caret' | 'logo-dot' | 'wipe' | 'badge' }], size?: per role }`;
  - it persists across beats on its own top track;
  - a **continuity planner** decides where the guide goes each beat;
  - the brand kit gains `hero: { shape, material, motif }` (aflow) so every genre template can carry it.
- **Cross-layer links:** `link: { from: 'layerId.prop', map?: … }` for a trail stroke following a moving
  layer, letters hidden under a passing object, or a glyph riding the caret. Resolved in a pure pass after
  evaluation. It is not the expression engine, which can't read other layers.
- **World layout:** beats as precomps in one 2D/2.5D canvas, and a camera path between them using §2.1 moves
  (house ease, creep-snap-settle, long truck, push). This is how SaaS films never cut the background.
- **Transitions as data:**
  - `zoom-through`;
  - `whip` (ease-in ×1.4 per frame; `cutAtPeak`; optional blur);
  - **`blur-bridge`** (hidden cut under a defocus);
  - `type-to-ui`;
  - `collapse-into`;
  - `card-zoom-reveal`;
  - `shape-wipe {direction:'out'|'in' (logo-resolve), glyph, wake?}`;
  - `diagonal-hard-wipe`;
  - `z-recede` (old block to 0.65 plus blur; new block pops and rises 13 f);
  - `type-through`;
  - `palette-swap-cut`;
  - `noise-dissolve`;
  - `eyelid-aperture`;
  - `white-out` / `black-breath`;
  - `through-the-counter` (portal, either direction);
  - `swap-when-hidden {twist}`;
  - `portal-accelerando {grid}` (cut in 16ths from the tempo grid);
  - `cursor-bridge`;
  - `scale-cut {×3}`;
  - `snap {zoom-out 0.3 | punch 1.4 | press 0.66}` one-frame presets.
- **Depth of field:** wire the camera (Phase 0), then a focus band, near and far blur, and rack focus by
  animating `focus`.
- **Parallax fields:** scatter layers in z with drift (tile fields, card constellations, chip clouds).

### P5. Particles, light, FX (M)

- **`particles` layer** (GPU instanced quads, deterministic and seeded). Presets:
  - `confetti` (with `from:'top'` fall or a burst; DOF);
  - `sparkle-twinkle`, `dust`, `bokeh`, `speed-lines`;
  - `flakes` (disintegrate a layer's alpha).
- **Shader procedurals** (fragment shaders, no particles needed):
  - `dot-wave` (displaced dot-lattice terrain);
  - `mesh-gradient` (drifting blobs);
  - `light-shafts`.
- **Effects:**
  - `echo` (time echo);
  - `smear` (directional stretch on fast moves);
  - `star-glint`, `god-rays`, `glow-ring`, `light-cone`;
  - `gradient-border`;
  - `painterly` (Kuwahara);
  - `grain-texture` (a static paper grain for backgrounds).
- **Drawn-FX sprite library:** splash, ripple, burst, smoke, speed lines, "!" marks. Built as P1 vector
  sequences or user-supplied Lottie. `add_fx {kind, at}`.

### P6. `form`: 2.5D objects (M–L)

```ts
{ type: 'form', form: {
    kind: 'sphere' | 'capsule' | 'cylinder' | 'rounded-box' | 'torus' | 'coin' | 'slab' | 'prism' | 'cone',
    size: Prop<Vec>, orientation: Prop<Vec>,             // the object's own 3D rotation
    look: 'soft-rim' | 'jelly' | 'two-tone' | 'glossy' | 'glass-fake',
    palette?: { base; rim?; hue4?: [string, string, string, string] },   // the 4-colour hue field
    decals?: ({ mode: 'card'; layer | shape; arm?: number /* × r */; flip?: 'edge-on' }
            | { mode: 'mapped'; layer | image | pattern: 'checker'; at: [lat, lon]; size })[],
    swap?: { to: FormKind; at: TimeRef; twist?: number },  // swap-when-hidden
    morph?: { to: FormKind; t: Prop<number> },             // real SDF morph (sphere → torus)
    cheat?: 'band-tumble',                                 // cheated cube tumble (1.25× stretch)
} }
```

**Rendering.**
- **Traced with camera rays from the scene camera**, not a flat ray-cast in the layer quad. Long slabs then
  converge to the vanishing point, and forms sit correctly with `threeD` layers.
- Analytic intersection or SDF sphere-tracing in a fragment shader. The layer's bounds come from the
  projected bounding box.
- **`soft-rim` shading:** L* = a + b·√(1 − n_z) + c·(n_xy · lightDir), from the measured formula, plus the
  hue field.
- Card decals are billboards on an arm that flip edge-on and hide. Mapped decals use latitude/longitude with
  back-face cull.
- **Inflated type** = text + P1 `bevel` + `inner-glow` + `gradient-overlay` + drop shadow.
- **Why not Blender here:** it's instant in preview with no render queue, and it is the exact look. Blender
  is for glass, refraction and real meshes.

### P7. Headless Blender pipeline (L) ★ proven twice on this machine

**The scene model.** Revive `src/lib/scene3d.ts`:
- track it again (it is excluded in `.git/info/exclude:8`);
- switch it to the motion engine's `Ease`;
- **default the view transform to Standard**, because both AgX and the file's ACES shift brand colours;
- add:
  - kinds: `svg-extrude`, `text-extrude`, `rounded-box`, `ui-card` (a P3 screen texture), `device`,
    `ribbon`, `glTF`;
  - looks: `glass`, `pearl-core`, `frosted`, `soft-plastic`, `clay`, `metal`, `emission`, `toon-flat`,
    `painted`;
  - worlds: `studio`, **`gradient-env`**, `cyclorama` + gobo, `void`.

**The worker, `src-tauri/workers/blender_bridge.py`** (from the two proof scripts):
- builds the scene from JSON;
- maps each ease to F-curve handles exactly, through `bpy_extras.anim_utils` channelbags, because
  `action.fcurves` is gone in 5.0;
- renders PNG RGBA, with opt-in multilayer EXR (set `media_type='MULTI_LAYER_IMAGE'` first; passes are
  `Depth`, `Mist`, Cryptomatte, Cycles `IndexOB`, and the shadow-catcher pass);
- writes `camera.json` (per-frame position, point of interest, `zoom = lens/sensor × compWidth`, **DOF and
  shutter**);
- writes **`objects2d.json`**: per-object screen boxes and centres, so 2D glints and callouts track 3D
  objects;
- prints `{"progress","message"}` lines;
- runs with `--python-exit-code 1`;
- **is licensed GPL** as a separate file, because it uses Blender's Python API.

**Rust.**
- `find_blender()`: the setting, then PATH, then a Program Files scan.
- A Detect button and a `blenderPath` setting in both Rust and TS.
- `blender_render_start`, an async copy of `point_track_start`:
  - storage `Category::ThreeD`, never `work/`;
  - the GPU lease;
  - job kind `generation`;
  - on the P5 runner with timeouts and the Job Object;
  - on the 1800 s long-tool list.
- If Blender is missing, offer to download the **unmodified official portable build**.
- Run only from the user's session: EEVEE isn't supported from a service or session 0.
- OptiX needs NVIDIA driver 575 or newer; otherwise fall back to CUDA.

**Back into the edit.**
- `FootageSource.sequence`, generalised from the roto matte loader.
- `camera.json` becomes a motion `camera` layer, so `threeD` 2D layers share its space.
- Export waits for exact frames.

**Tiers** (1080p per frame, measured):

| Tier | Settings | Time |
|---|---|---|
| Draft | EEVEE, 32 samples, glass fix | 0.73 s |
| Draft (no glass) | EEVEE | 0.58 s |
| Final | Cycles, 32 samples, OptiX | 2.21 s (35.8 dB PSNR vs 64 samples) |
| Final, high | Cycles, 64 samples | 3.46 s; 3.22 s with persistent data |

EEVEE with the glass fix is a **valid final** for the opaque and toon look classes. A 10 s shot at Cycles
32 samples takes about 11 minutes, in the background.

**A persistent worker.** Each Blender process costs 2.0–2.3 s to start and quit, plus 0.8–9 s of EEVEE shader
compile. Keep one Blender alive per session and feed it jobs.

**Physics.** Bake once with `-t 1` and **freeze to keys by hand** (`bake_to_keyframes` fails headless).
Titles such as `letters-drop` are **keyed drop-bounces**, never live rigid bodies (§5).

**Limits:**
- Glass rendered on transparent film can't refract the Bhippi background it's composited over. Either render
  a background plate into Blender, or accept the tint.
- A constant thin-film thickness gives a flat tint. Vary it with noise or facing angle for real iridescence.

**Tools (NEW):** `create_3d_scene {preset|scene}`, `update_3d_scene {ops}`, `render_3d_scene {quality}`,
`list_3d_presets` (READ), `import_3d_model` (glTF; Poly Haven/ambientCG CC0 with the credit and user-agent
header Poly Haven requires).

**Presets:** `pearl-core-orb`, `iris-orb`, `glass-orb`, `sphere-bouquet`, `orb-horizon`, `ui-card-ring`,
`panel-tunnel`, `device-hero` (+ ribbons), `device-light-fountain`, `logo-extrude`, `letters-drop` (keyed),
**`crystal-gradient-env`**, `product-turntable`, `floating-shapes`, `globe-dots`, `cursor-3d`.

### P8. Character system (XL, 6–8 weeks; a credible first character in about 2)

**The asset** (from the MDS report's corrected schema):

```ts
type CharacterAsset = {
  bones: { id; parent?; pivot: Vec; length? }[];
  parts: ({ id; bone; kind: 'shape'; shape: ShapeItem } | { id; bone; kind: 'tube'; from; to; width; taper? }   // rubber hose
        | { id; bone; kind: 'swap'; set: Record<string, ShapeItem> })   // hands, mouths, special drawings
        & { z?: number; clip?: string; textureLines?: ShapeItem[] }[];
  views: Record<'front' | '3q' | 'side' | 'back', { order: string[]; swaps?: Record<string, string> }>;   // draw-order swaps in turns
  controls: { id; kind: 'rotate' | 'ik' | 'slider' | 'swap' | 'order'; targets: string[]; range? }[];
  face: { eyes: { lids; catchlights; pupils }; brows?; mouths: Record<Viseme | Expression, ShapeItem> };
  sockets: Record<string, { bone; offset: Vec }>;          // hand#R → flashlight
  springs?: { part; stiffness; damping }[];                // drawstrings, hair (secondary motion)
  deformers?: { part; kind: 'squash-stretch' | 'bend'; axis }[];
  styles?: Record<string, { palette: Record<string, string>; line?: number }>;   // e.g. 'colour' | 'silhouette'
  special?: Record<string, ShapeItem[]>;                   // hand-drawn poses: turnaround keys, smears
};
// layer
{ type: 'character', character: {
    asset: string | CharacterAsset, palette?: Record<string, string>,
    actions: { t: TimeRef; do: string; params?; duration?; blend? }[],
    timing?: { step: 1 | 2 | 3; accents?: 'auto' | TimeRef[]; phase?: number },   // twos, ones on accents
    face?: { lipSync?: { clip?: string; words?: … }; look?: Prop<Vec | string> },
    lights?: { beam: string /* layer id */; inside: string /* style */; outside: string }[],   // light matte
    parentTo?: string /* 'layerId#socket' */, view?: Prop<string>,
} }
```

**Implementation.**
- Parts draw through Canvas2D `Path2D(d)` directly, so **there's no wait on P1**.
- A pure solver, `src/motion/character.ts`, reuses the tested `twoBone` IK.
- `timing.step` posterises the rig clock while camera and FX stay on ones.
- `lights[]` renders the beam matte natively: two styles, and the beam layer stays visible.

**Actions** are parameterised by the measured charts (§2.1):
- anticipation scales with mass;
- hop and leap charts; a run with a brake (not a cycle); a 12 f walk;
- idles on threes;
- wave, point-at (IK to a layer or UI part), facepalm, look-at, react, hold, catch, hug, type, celebrate,
  shrug, talk;
- blink: 4 f with an overshoot opening, and a 2 f snap blink.

**Lip sync.**
- **Bhippi's TTS returns audio only, with no phoneme timings.** Use **Rhubarb (MIT)** as an optional 70 MB
  download: a 28 s voice-over takes 2.5 s with the phonetic recogniser, passing the transcript with `-d`.
- Or map whisper word timings to visemes.
- Write the result as baked mouth keys.

**Base characters.** Original designs, no licence risk. **Don't copy MDS's mascot.**
- `dome-kid`: flat dome head, noodle arms, hoodie;
- `rubberhose`;
- `flat-corporate`;
- `shape-buddy` (P6 forms with card eyes).

CC0 sources only from their original releases (Open Peeps; Humaaans and Open Doodles from their CC0
originals, **not Blush-hosted** copies).

**The MDS look kit:**
- flat fills, with no grain on characters;
- static grain on backgrounds;
- light-matte pairs;
- palette-swap cuts;
- drawn FX (P5);
- flicker presets (dim 2, off 2, on 7).

**Tools (NEW):** `create_character`, `animate_character`, `pose_character`, `lip_sync_character`,
`list_character_actions` (READ).

**The honest bar and what comes later.** Rigs reach "studio explainer" quality in this look, not hand-drawn
cel. For the rest:
- **Meta AnimatedDrawings (MIT)** for "animate a drawing".
- AI-designed rigs: an LLM or image → vectorise (vtracer) → segment → auto-rig.
- AI in-betweening as a research track. Watch licences (for example, LTX-2 needs a paid licence for companies
  with $10M or more in revenue).
- A Grease Pencil v3 spike.

### P9. Sound and music structure (S–M)

- **Phase 0 bugs** (above).
- **SaaS/brand pack** (synthesised + CC0): UI tick, click, typing bed (density follows `cps`), notification,
  glass ping, soft swoosh, whip, riser, drop hit, sub boom (+14 dB like "Boom"), shimmer, pop, confetti,
  success chime, error blip.
- **Modes per style pack:**
  - `sfx:'ticks'` for voice-over films: frame-synced UI ticks and a click on the press frame;
  - `sfx:'none'` for music-only films (Virgil).
- **Loudness:** −14 LUFS and −1 dBTP. The music bed sits about 10 dB under the voice; end cards fade at
  −10 dB/s.
- **Music grid** (from the fixed detector): 16ths, beats, bars, 4-bar phrases, drops, stops.
  - Templates anchor `t: {beat|bar|phrase|drop|stop}`.
  - The rule set: world changes on phrase lines and drops; cuts on the 16th pickup; motion landing on the
    beat; a portal accelerando in 16ths; silence on the end card when the music stops.

### P10. Direction layer: guides, defaults, reference analysis, QA (M)

- **`motion_guide {topic, beat?}`** (NEW, a read tool).
  - Topics: `saas-explainer`, `product-launch`, `ai-launch`, `brand-identity-film`, `character-explainer`,
    `2.5d-tricks`, `3d-promo`, `ui-walkthrough`, `kinetic-type`, `transitions`, `sound`.
  - Each returns: a beat recipe with durations, the style pack (§2.2), timing tokens (§2.1), a technique →
    tool map with example arguments, and do/don't rules.
  - The data lives in `src/lib/motionDirection.ts`, with tests that every cited tool and template exists.
  - `copilot.md` gets one line per genre.
- **Reference analysis upgrade.** `analyze_reference_video` becomes a worker (`reference_motion.py`, built
  from `analyze.py`). It adds:
  - foreground-swap and hidden-cut detection;
  - moves with fitted eases;
  - a camera track;
  - character-region ones/twos;
  - typing rates;
  - the **fixed tempo grid** and sync against the chance baseline;
  - pageable frame sheets.

  `save_style_profile` stores the numbers.
- **Pacing QA.** `run_frame_qa` compares built scenes against the active genre pack:
  - entrances, holds and shot/swap cadence;
  - text-vs-VO class;
  - cut placement on the grid.

  The Animator seat of the council gets the numbers.
- **Positioning** (research): no competitor, whether Hera, Remotion agents, Figma Motion or the
  screen-recording tools, does continuity camera direction or measured pacing checks. That is Bhippi's lane.

### P11. Lottie import (M)

- **Native converter:** `import_lottie` → MotionScene. Shapes map 1:1 onto P1 vertices. It handles
  trim, repeater, **merge paths (natively, because neither renderer does)**, gradients, masks, mattes and text.
- **Fallback for unsupported features: ThorVG WASM (MIT)** rendered into a `sequence`. It runs expressions
  inside WASM with no JS eval, and handles effects and luma mattes. Use it rather than lottie-web, whose full
  builds use `eval` and whose canvas renderer lacks merge paths and effects.
- **Licence:** LottieFiles has no public API, and its licence forbids scraping or redistributing files. So
  there is **no in-app search and no bundling**; user-supplied files only.

---

## 5. Headless Blender: what was proven on this machine

**Setup.** Blender **5.2.0 LTS** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`).
- Background start takes 2.0 s.
- RTX 3080 over OptiX and CUDA.
- Engines: `BLENDER_EEVEE`, `CYCLES`.

**Proof 1** ([blender_bridge_proof.py](research/video-study/blender_proof/blender_bridge_proof.py) +
[request.json](research/video-study/blender_proof/request.json)):

```
blender -b --factory-startup -P blender_bridge_proof.py -- request.json
```

It builds a JSON scene: a bevelled slab, a thin-film glass sphere, a metal torus, extruded text, a
shadow-catcher floor, a three-light studio, and a two-node DOF camera on cubic-bezier(0.16, 1, 0.3, 1).

- **Transparent PNGs:** yes, in both engines.
- **Progress:** `{"progress"}` lines, so it drops straight into `local_media::run`.
- **Easing:** the exported camera z moved 6500 → 5116 → 4557 → 4339 → 4250 → 4214 → 4203 → 4200 over
  frames 1–43. That is exactly the requested expo-out: **CSS cubic-bezier → F-curve handles is exact.**
- **Axis mapping:** Blender (Z-up, camera looking +Y) → engine: `x → x·s + W/2`, `z → −z·s + H/2`,
  `y → +z·s`.

**Proof 2** ([proof2.py](research/video-study/blender_proof/proof2.py); sheet
`blender_proof/proof2_sheet.jpg`, local):

| Test | Result |
|---|---|
| **Gradient-environment crystal** (the Modern Motion trick) | **Works in both engines.** Recipe: metallic **1.0**, roughness **0.15**, white base, env ×1.4, **Standard view**. The gradient bands must run *around the horizon*; a vertical-only gradient fails. At 540p: EEVEE 0.22 s/frame, Cycles 0.56 s/frame. Metallic 0.7 looks milky; AgX desaturates |
| **EEVEE glass** | **Fixed** with `material.use_raytrace_refraction = True` + SPHERE thickness + DITHERED. BLENDED glass and PROBE tracing are noisy. A **draft contact shadow** works on transparent film with a shadow-only floor (Shader to RGB, BLENDED, radial fade) |
| **1080p timings** (steady state) | Cycles 32 spp **2.21 s**; 64 spp **3.46 s**; 64 spp with persistent data 3.22 s. EEVEE 32: 0.58 s; 0.73 s with the glass fix. First frame +0.2–1.2 s |
| **Letters drop (rigid body)** | Bakes in 0.03 s, but letters **topple** (unreadable) and runs **diverge across processes** (3 of 14, from frame 13, up to 0.6 m). 17/17 identical with `-t 1`. `bake_to_keyframes` fails headless, so freeze by hand. A **keyed drop-bounce** is exact and readable, so titles use keys |
| **Multilayer EXR** | Writes in background mode once `media_type` is set (5.2), as **multipart, one part per pass**. EEVEE has no Object Index, so **Cryptomatte** is the cross-engine mask. Enabling the Cycles shadow-catcher pass removes the shadow from the combined image. 540p frame: PNG 0.39 MB; EXR 2.7–12.3 MB, so passes are opt-in |

**Decisions this settles:**
1. EEVEE with the glass fix is the draft engine, and the final engine for opaque, toon and crystal looks.
2. Cycles is the final engine for glass-hero, shadow-catcher and refraction shots.
3. Physics is baked once and stored as keys.
4. Passes are opt-in.
5. The view transform is Standard.
6. One persistent Blender worker per session.

---

## 6. Roadmap

### 6.1 Sequencing
- **Phase 0 can start today.** It touches few files and nothing that P4/P5 own, except that the SFX fix
  touches `aiTools.ts`, so coordinate.
- **Land WORLD-CLASS-PLAN P4 and P5 first** for every new tool and the Blender runner. Commit the in-flight
  P1/P2/P3/P6/P7/@funny work first.
- Packages that share files merge; they never race.
- Every pillar is gated: Lab PSNR goldens for renderer work, pure vitest for solvers, and the golden
  recreations for the whole.

### 6.2 Phases

| Phase | Weeks | Work | Size |
|---|---|---|---|
| **0: fixes** | days | Camera DOF, SFX kinds + click, tempo tatum, TIMING tokens + house ease, `bleed`, doc fix | S each |
| **A: foundations** | 1–3 | A1 `FootageSource.sequence` | S |
| | | A2 P1 core: beziers, groups, usvg SVG, Lucide, array item + morph, Clipper2 ops, SDF layer styles, raster cache | L |
| | | A3 P2 core: bundled OFL fonts + static TTFs for libass, per-pixel fills, `type` (front, caret, edge, script, chunk, snapToWhite), `retype`, `scatter`, word timing classes | M–L |
| | | A4 P9 pack + modes + music grid | M |
| | | A5 P10 `motion_guide` + style packs | M |
| | | A6 P7 MVP: bridge worker (GPL), locator, runner, `create_3d_scene`/`render_3d_scene`, presets `pearl-core-orb`, `crystal-gradient-env`, `device-hero`, `logo-extrude`, `letters-drop` (keyed) | L |
| **B: the SaaS unlock** | 4–7 | B1 P3 UI-screen layer (HTML → texture + part map, actions, cursors, attach, sfx ticks), `create_ui_screen`, `capture_product_ui` | L |
| | | B2 P4 guide + continuity planner, cross-layer links, world layout, transitions kit, DOF band, parallax | L |
| | | B3 P5 particles + shader procedurals + FX | M |
| | | B4 P10 reference worker + pacing QA | M |
| **C: depth and characters** | 6–14 | C1 P6 `form` | M–L |
| | | C2 P8 character stage 1: first character + flashlight golden at about 2 weeks; full action library, face, lip sync and 4 base characters by 6–8 weeks | XL |
| | | C3 P7 full: remaining presets, persistent worker, camera + objects2d sync, EXR/Cryptomatte, draft/final swap, cache | M |
| | | C4 P11 Lottie import (native + ThorVG fallback) | M |
| **D: beyond** | 14+ | AnimatedDrawings / AI rigs, 3D workspace panel, AI in-betweening research, Grease Pencil spike | L+ |

### 6.3 Golden recreations (the acceptance test)

For each film, a fixed prompt (with its inputs: brand kit, product URL or screenshots, VO/music) must
produce a 10–15 s piece that:
1. passes `run_frame_qa`;
2. passes **pacing QA** against that film's measured profile (±25% per token);
3. scores **≥ 4/5** from the council;
4. is **signed off by the user** side by side with the reference beat.

| Film | Golden beat | Pillars |
|---|---|---|
| Workly | Bubble pile → "Can't keep up?" → tracking breathe → type split → folder born | P2, P3, P4, P9 |
| Virgil | Card fly-in → checklist → bar into field → collapse into orb → ribbon → "to seconds" | P2, P3, P4, P5, cross-links, DOF |
| Limelight | List rejects → "What if…" face-pile type → dot → brackets → wordmark | P2, P3, P4, P9 |
| Solair | Tile-wall clicks → tiles → dots → wind-up spinner → star logo-resolve | P1, P2, P3, P4, P9 |
| WasteProtection | Assemble → callouts → click → page swap → hover-lift → sweep | P2, P3, P4 |
| aflow | Orb drop on the phrase line → crane to the card ring | P7, P5, P4, P9, brand hero |
| MDS | Flashlight beat: light matte, twos with accents, blink, flicker, firefly | P8, P5 |
| Motion Tricks | Sphere with card eyes turns → swap-when-hidden cube → squash cascade | P6, P8, P1 |
| Modern Motion | Keyed letters drop into "Modern Motion" + flat lockup + gradient border | P7, P1, P4, P5 |

### 6.4 What the user will type, and what happens

- **"Make a 30 s launch video for my app, here's the link."**
  1. `motion_guide {saas-explainer}` and `capture_product_ui {url}`.
  2. A storyboard with a continuity object from the brand hero.
  3. UI screens with actions; a world layout with the house ease, hidden swaps and a blur-bridge.
  4. Typing at 30 cps in fields and 12–13 cps for VO-read lines; headlines leading the VO by about 0.5 s and
     payoffs landing on the word.
  5. UI ticks; world changes on phrase lines; pacing QA and polish.
- **"Make an identity film for my brand like aflow."**
  1. The brand kit's hero object, then `create_3d_scene {pearl-core-orb…}`.
  2. EEVEE drafts in seconds; Cycles finals in the background.
  3. Echo, glints and a portal accelerando cut in 16ths.
  4. Big changes on phrase lines, and the logo by world-resolve.
- **"Explain our onboarding with a character."**
  1. `create_character {dome-kid, brand palette}`.
  2. Acting beats on twos with accents; lip sync from Rhubarb over the TTS voice-over.
  3. The character points at UI parts (IK to a P3 part).
- **"Do that bouncy 3D-looking thing."** P6 forms, card eyes, swap-when-hidden and inflated type, all
  instant in preview.

---

## 7. Risks, licences, honest limits

- **Character quality.** Rigs + principles + twos-with-accents reach studio-explainer quality; they don't
  reach hand-drawn cel. Say so in the product.
- **Render time.** Cycles at 1080p runs 2.2–3.5 s/frame, so a 10 s shot takes 11–17 minutes in the
  background.
  - Mitigations: EEVEE drafts (and finals where the look allows), persistent worker, hash cache,
    changed-frames-only renders.
  - Choose P6 forms whenever glass isn't needed. Blender shares the single GPU lease with generation and
    roto.
- **Tokens.** New tools add schema weight. Use one-line descriptions, `motion_guide`, and WORLD-CLASS-PLAN's
  phase-scoped catalogue.
- **Licences.** This is due diligence from [02-research.md](research/video-study/reports/02-research.md), not
  legal advice; have a lawyer look at the red flags before shipping.

  | Item | Licence | Decision |
  |---|---|---|
  | Blender | GPL | Run the unmodified official build as a separate program; offer the official download. **`blender_bridge.py` is GPL** (it uses the API): ship it as a separately licensed file. No Blender logo in the UI without permission |
  | Fonts | OFL | Inter, Manrope, Plus Jakarta Sans, Sora, Outfit, Montserrat, Fraunces, Caveat + Mona Sans or Archivo. Not Satoshi, Gilroy or SF Pro |
  | Lucide | ISC (+ MIT for Feather-derived icons) | Bundle |
  | Clipper2, ThorVG, vtracer, AnimatedDrawings, Rhubarb | Permissive (see research) | Rhubarb as an optional download |
  | Poly Haven / ambientCG | CC0 | Poly Haven's API needs a "Powered by Poly Haven" credit and a user-agent header |
  | Open Peeps | CC0 | Fine |
  | Humaaans, Open Doodles | CC0 originals only | Not the Blush-hosted copies |
  | **LottieFiles** | No public API; no scraping or redistribution | User-supplied files only |
  | GSAP MorphSVG | Forbids visual animation builders | Don't use |
  | Spine runtimes | Per-user licence | Don't use |
  | OmniLottie | Non-commercial | Don't use |
  | useAnimations | CC BY | Attribution required |
  | LTX-2 (already used locally) | Paid licence for companies with $10M+ revenue | Flag in generation settings |
  | The reference films | Third-party | Research material only, git-ignored; never ship their frames or assets |

- **Blender runtime.**
  - EEVEE is not supported from a service or session 0. Run only from the user's session.
  - OptiX needs NVIDIA driver 575 or newer.
  - Blender 5.x API changes (channelbags, `compositing_node_group`, `media_type`, renamed passes) must be
    covered by the worker's e2e test.
- **Scope creep.** Phase D doesn't start before the Phase A–C goldens pass.

---

## 8. Where things are

| What | Where |
|---|---|
| Per-film reports (9) | [reports/](research/video-study/reports/): `YMWbH7xrTHk.md` Workly · `b1GDr86JW3M.md` Virgil · `lhG6p7xtkPE.md` Limelight · `luoDI5Bo0w0.md` Solair · `J6A7JcbkWvM.md` WasteProtection · `xBZzVNi_4Xw.md` aflow · `HO3VEhvobCQ.md` MDS · `P0Ns0rphILY.md` Motion Tricks · `2Fc9sGYFj1I.md` Modern Motion |
| Capability brief, architecture map, research | [00-bhippi-brief.md](research/video-study/reports/00-bhippi-brief.md) · [01-architecture-map.md](research/video-study/reports/01-architecture-map.md) · [02-research.md](research/video-study/reports/02-research.md) |
| Study kit | [analyze.py](research/video-study/analyze.py). Known issues: colour-jump-only cuts, tempo alias, whole-frame exposure |
| Blender proofs | [blender_bridge_proof.py](research/video-study/blender_proof/blender_bridge_proof.py), [proof2.py](research/video-study/blender_proof/proof2.py), [request.json](research/video-study/blender_proof/request.json). Sheets and renders are local |
| Films, frames, notes, measurement scripts | `docs/research/video-study/{src,out}/` (**local only**, git-ignored) |

To regenerate a film's study material:

```
.media-venv/Scripts/python docs/research/video-study/analyze.py src/<id>.mp4 out/<id>
```

That takes about 10–60 s per film.
