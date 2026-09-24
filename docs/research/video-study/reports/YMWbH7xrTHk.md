# Workly: SaaS explainer by Solair (YMWbH7xrTHk)

*Video-study report, 2026-09-25. 28 s, 30 fps, 1920×1080, 837 frames. Frames are 1-based: f1 is 0.000 s,
so t = (f − 1) / 30. Pixel values are at 1080p unless marked @720.*

**Sources**
- The running notes are `out/YMWbH7xrTHk/notes.md`.
- Kit output: `analysis.md` and `analysis.json`, which holds the per-frame camera and audio RMS.
- Earlier fits: `measured_moves.json` and `measured_moves2.json`. Only fits with rmse ≤ 0.05 are used here.
- Three new measurements, made for this report at full 1080p from the source MP4:
  - `measure_breathe.py` → `measured_breathe.json`: tracking, stroke weight and scale for f140–207.
  - `measure_folder.py` → `measured_folder.json`: folder birth, recentre, drag, the hidden blurred cut and focus, f262–400.
  - `measure_sweep.py` → `measured_sweep.json`: a space–time map of the colour sweep, f205–275.
- 20 individual frames were checked by eye: f86, 153, 158, 214, 240, 273, 362, 365, 369, 391, 404, 436, 472, 514, 522, 560, 598, 662, 700, 740 and 749.

---

## 1. What the film is

The film is a 28-second, music-only SaaS explainer for a fictional "AI workspace" called Workly. It
has no voice-over: the auto-captions contain only `[music]`, plus a misheard vocal chop at 12.6–13.1 s.
All of the storytelling is done by type and UI.

The film runs as one continuous light-UI world:
1. Problem: a pile of chat pills and "Can't keep up?".
2. Promise: "Meet your new AI workspace".
3. Hero object: a glass folder.
4. Product: the folder is dropped into an app window, then "Built-in", "Business analytics" and a dashboard.
5. AI: a sparkle-star wipe into a real-3D phone with satin ribbons, then "Chat / With our / AI Bot".
6. Payoff: "No more chaos." and a notification constellation.
7. Brand: the "Workly" wordmark and "Turn messages into action.", then a dip to black.

**How it feels cut-free.** The kit found 7 "shots", but at least 8 real hard swaps are hidden inside
something else:

| Where a cut hides | Frames |
|---|---|
| A 1-frame full-colour field (the invert flash) | f151, f157 |
| A shrink or slam of type | f208 "Meet", f404 "Built-in", f640 "No more chaos." |
| **A full-frame defocus** | f366, not detected by the kit |
| A full-frame wipe | f520 |
| An empty frame after a whip | f744 |

This is the film's main directing lesson: **never show a cut, disguise every one.**

The palette is monochrome blue: `#2b43fd` violet-blue, `#2b70fd` blue, `#2ab0fd` sky, plus near-black
type on grey-white. Type is SF-Pro-like (Inter is the OFL match).

The film uses a single house ease, measured four times (§4).

---

## 2. Beat-by-beat breakdown

"Measured" means taken from this study's scripts. Everything else comes from the notes, cross-checked
against frames.

| # | Frames (s) | What happens | Timing, eases, staggers | Audio (RMS per frame, `analysis.json`) |
|---|---|---|---|---|
| 1 | f1–96 (0–3.2) | **Chat-pill pile.** Pills A–F pop in tilted and stack; a sky-blue dot (≈64 px) hops onto each new top pill; the pile bleeds off the frame edges | See the pop-in breakdown below the table | Music bed from f6 (RMS about 0.15). Pops are not separable from the music |
| 2 | f88–147 (2.9–4.9) | **World scroll** (a tilt-up) carries the pile off the bottom; "Can't keep up?" arrives from the top. The background cross-fades `#ededed` → `#ffffff` over f124–128: a scene change without a cut | Pile scroll eases **in** over f88–125 (0.942, 0.07, 0.826, 1.115; rmse 0.043). The headline scroll eases **out** over f118–145, 27 f (0.121, 0.842, 0.645, 0.996; rmse 0.003), peaking at 37 px/f near f118. Text fades 20 → 100% over f118–124 | Bed continues |
| 3 | f147–156 (4.9–5.2) | **Tracking opens and the invert flash.** Tracking opens (measured). Over f151–156 the frame goes full `#1b5bfe` with white type. The dot drops to bottom centre and **squashes** (about 54×44 @720 on f153) | Tracking goes 0 → **+0.166 em** over f147–156 (0.296, 0.183, 0.191, 0.935; rmse 0.015); 90% open by f153. Stroke/cap-height ratio steps **on twos** inside the flash: 0.100 (f151–152), 0.121 (f153–154), 0.156 (f155–156). That is about Light → Regular → Semibold | **Music stop:** RMS 0.01–0.05 from f145 to f174 (1 s), against a 0.15 bed. Isolated transients at **f151** (flash on) and **f157** (flash off) frame it exactly |
| 4 | f157–203 (5.2–6.8) | **"Breathe."** Back to white. The tracking is held wide for 10 f, then closes; the line then scales up. The dot exits left (f157–163) | Hold at +0.166 em over f157–166. **Close** over f166–181 (0.32, −0.05, 0.01, 1.05; rmse 0.002 on width 869 → 651 px); 90% by f175. **Scale-up ×1.18** over f181–195 (0.724, 0.139, 0.043, 1.018; rmse 0.004); peak at f186, 90% by f190. The weight stays **constant** at stroke/cap 0.123–0.126 (about Regular) | Music returns at **f175** as the tracking settles |
| 5 | f204–207 (6.8–6.9) | **Shrink-swap.** The headline drops to 0.72× in 3 f, then a hard swap to "Meet" at f208 | 3 f ease-in | Hit at **f207** (RMS 0.48) |
| 6 | f208–257 (6.9–8.5) | **Type, colour sweep, converge.** "Meet" appears whole, then **1 char/f** to "Meet your new" (f217). The layer drifts right about 15 px/f while typing (x0 426 → 636 px). "AI workspace" pops in at f223 (2 f fade) and the gap closes. A light-blue colour front runs through the line (§3, T9) | Converge: 27 f, left edge 636 → 402 px, **(0.276, 0.056, 0, 1.051); rmse 0.006**, peak 38 px/f at f227, 90% by f237 | Loud stretch f229–246 |
| 7 | f258–282 (8.6–9.4) | **Split and birth.** The line scales 1.39×; "Meet your new" slides left and "AI workspace" is pushed off right and fades (f276–278). A **folder unfolds in the gap**. A hand cursor rises from the bottom edge (f272–281, about 9 f, ease-out) | Split: 12–14 f (0.673, 0.13, 0.618, 0.976; rmse 0.016); scale (0.675, 0.036, 0.802, 1.179; rmse 0.035). Folder width 297 → 485 px in 5 f (**0, 0.206, 0, 0.842; rmse 0.012**). Height 140 → 477 px in 5 f at a nearly constant 80 px/f, then a hard stop (f271–276). Aspect goes 2.1:1 → 1:1 | Mini-stop f258–262, then a **hit at f263** (0.58) |
| 8 | f282–351 (9.4–11.7) | **Folder hero.** A slow push (width 526 → 571 px, f281–299). "Meet your new" exits left with a fade (f300–306). The **camera recentres** on the folder. The front doc lifts about 80 px out of the pocket (f305–325); a second doc peeks (f330–340). The cursor presses: the folder shrinks **6.7%** and rises (f332–342) | Recentre: 36 f, cx 1528 → 1043 px, **(0.139, −0.086, 0.124, 1.154); rmse 0.011** (an earlier fit gave 0.219, 0.051, 0, 1.056; rmse 0.009). Peak 57 px/f at f303, 90% by **f317** | Press is loud (f331–342, 0.48) |
| 9 | f352–372 (11.7–12.4) | **Blur-bridge cut** (not a zoom pull-back). The world accelerates upward with no scale change (folder width steady at 531 px). One frame of full defocus. A **hidden cut at f366** to a wider framing, where the folder is 0.56× inside a rotX-tilted app window. The move continues upward and decelerates; focus returns | Drag: expo-in, velocity 0.7 → 29 px/f (f352–362) → 64–73 px/f (f363–364). Blur **on in 1 f** (f363): Laplacian 65 → 0.8. Blur is σ ≈ 10 px (10–90% edge width 23–28 px), isotropic (a zoom blur would lower the radial/tangential gradient ratio; instead it rises from 1.33 to 1.6–2.0). Held f363–369, sharp by **f373**. After the cut, camera dy goes −58 → −4 px/f over f368–380 (ease-out, about 10 f) | **Second music stop:** RMS 0.01–0.03 from f349 to f379. The whole transition happens in silence |
| 10 | f373–402 (12.4–13.4) | **Drop and glow.** The folder shrinks and fades into the drop zone (f385–388). The zone swaps to "Select a file / or / Drag and drop a file here". A periwinkle **inner glow** blooms from the window edges (edge `#c4d2fd`, centre `#faf9fe`); the window then tilts further away (f399–403, ease-in) | Glow: up 6 f, hold 4 f, down 6 f (f386–402) | Riser over f380–388, then **re-entry at f389** (0.23 → 0.33) under the glow |
| 11 | f403–427 (13.4–14.2) | **"Built-in" slam.** Hard swap, a slow pull-out, then scale to zero. Gradient fill `#1963e9` → `#a8cff5` left to right; mesh background | Slam **1.29× → 1.07× → 1.0** over f404–406. Pull-out to 0.74× by f424. Exit 1.0 → 0.45 → gone over f425–427 (3 f ease-in) | Loud; peak at f408 |
| 12 | f428–452 (14.2–15.1) | **"Business analytics"** types in about 1–1.5 char/f; each new char fades grey → black over about 2 f (f436 confirmed) | Left-anchored, drifting to its centred rest | Loud |
| 13 | f453–504 (15.1–16.8) | **Dashboard rise.** The headline recolours to a blue gradient and rises to the top. A dashboard (BankDash, from the Figma community) slides up; satellite cards (a phone "Transactions" panel, a "Sales report" donut) move at their own speeds (parallax). A violet 4-point sparkle appears at the top-left corner of the dashboard (f469–480) and grows slowly | Slide: 20 f, 478 px, **(0.086, 0.042, 0.083, 0.905); rmse 0.003**, 65% of the travel in the first 6 f, peak 77 px/f at f461. The headline fades out f475–480 | **Loudest bed** f463–468 (0.56) |
| 14 | f505–528 (16.8–17.6) | **Star wipe → 3D ribbon hand-off.** The star grows about **×1.22 per frame** (tip radius 60 → 159 px over f506–511) around its resting point. By f520 it covers **only 39%** of the frame. A **violet 3D ribbon** sweeping across the lens completes the cover (67% at f521, 87% at f522), then swings away to reveal the phone scene | About 14 f to the hand-off | Hit at f527–531 (**0.64**, the film's peak) on the phone reveal |
| 15 | f529–590 (17.6–19.6) | **3D phone.** A blue-silver iPhone-style phone (rotZ about −15°), chat UI on screen, blue satin ribbons with a white back, huge soft blue spheres, a grey studio. The camera orbits and pushes; the ribbons unfurl, then retract (f577–592). The star returns as a small sparkle flying top-right (f532–546). The bot bubble grows in (f583–588) | Slow | Loud |
| 16 | f591–639 (19.7–21.3) | **Staircase lines.** "Chat / With our / AI Bot" slide in from the left, grey → black, each line indented further. The phone straightens (rotZ about −5°) and slides right. "Yes, send it." appears on screen (f609–617). The lines **collapse vertically (leading → 0) in 3 f** (f637–639) | **2 f line stagger** (f591, 593, 595), about 10 f each. The existing fits are unusable (rmse 0.18–0.28) | |
| 17 | f640–688 (21.3–22.9) | **"No more chaos."** Hard swap. "No more" in a gradient band `#104d7a` → `#1c7dc4`; "chaos." black. Two thin **gradient-stroke rings** (`#89bcf5`, about 3 px) drift. A continuous pull-back comes in two surges (f640–646 and f665–672, LK estimate). The headline fades out over f677–681 | | Loud at f662–678 |
| 18 | f660–733 (22.0–24.4) | **Notification constellation.** White cards (bell icon `#2368d9`, "New Notification" plus a body line) enter from the edges over **blurred** dashboards (defocus about 6–8 px), with slow parallax drift | Float about 0.5 px/f | |
| 19 | f729–744 (24.3–24.8) | **Whip.** Everything accelerates up and off, then a cut to an empty frame at f744 | **15 f expo-in**: velocity ×1.25–1.5 per frame, 29 → 56 → 105 → **164 px/f** (f737–743), about 600 px in total. Cards stay **sharp** at 56 px/f (f740), so there is little or no motion blur | Loud at f728–738 |
| 20 | f745–774 (24.8–25.8) | **"Workly."** Rises 258 px while fading in and saturating lavender → royal `#0023ff` | Rise: 44 f, **(0.044, 0.419, 0.044, 0.991); rmse 0.004**, 90% by f765. Saturation: 8 f (0.72, 1.309, 0.328, 0.944; rmse 0.008), full by f754 | |
| 21 | f775–812 (25.8–27.0) | **Tagline** "Turn messages into action." enters word by word, grey → `#454446`, and drifts up toward the wordmark (gap 180 → 104 px) | **1 f per word**, each fading about 6 f | |
| 22 | f813–837 (27.1–27.9) | **Dip to black** over 10 f (roughly linear), then 16 f of black | | The music keeps playing under the black and only fades in the last 6 f (RMS 0.14 → 0.09) |

**Beat 1 pop-in breakdown.**
- **Scale:** 30 → 100% in 3–4 f (bubble B, f21–24).
- **Rotation:** each pill levels out in 4–7 f, overshoots by 1–2.3° (7–11% of its tilt), and has settled within 13 f.
  - Bubble A: −15° → 0 over f8–15 (0.436, 0.278, 0, 1.167; rmse 0.038), then a −1° dip over f16–19.
  - Bubble C: −20.9° → 0 over f48–52, then +2.3° at f55, settled by f61.
- **Stagger:** pills arrive at f8, f21, f47, f63, f82 and f95.
- **Pile drift:** the pile drifts down about 2–3 px/f.
- **Bubble E** (f82–88) tilts and drops like a rigid body.
- **The dot's hops** are 10–15 f arcs.

---

## 3. Technique catalogue

Each technique gives the frames, what happens at the frame level, how an After Effects artist would
build it, and what Helios can do today.

**T1. Tilted pill pop-in** (f8–61)
- **What happens:** a pill appears at 25–40% scale, 50–60% opacity and −15 to −25° tilt. It reaches
  full scale in 3–4 f, levels out its rotation in 4–7 f, overshoots by 7–11%, and settles by 13 f. Bubble D
  also squashes along x for 2 f (reads as a slight Y-turn).
- **AE build:** a shape layer (rounded rect, roundness = h/2) with its text parented to it. Scale keys at
  0/3/4 f; rotation keys with a small overshoot key; anchor at the pill's lower-left so it "hinges".
- **Helios today:** yes, by hand (`shape` rect with radius, `text` parented, keys). There is no template.

**T2. Pile with world scroll** (f1–147)
- **What happens:** pills stack and overlap. The whole stack drifts down 2–3 px/f and then accelerates
  off the bottom as the camera tilts up to the headline. Bubble E lands at an angle, like a physics object.
- **AE build:** all pills under a null. The null's y is keyed with an ease-in into an ease-out for the
  headline; the pills are keyed individually.
- **Helios today:** partly. It is possible with a `null` parent and keys. However, `safeArea.ts` would pull
  the deliberately bleeding pills back inside the safe area: "type never bleeds" (safeArea.ts:137), so
  today it needs `fit:false` for the whole scene.

**T3. Hopping continuity dot** (f33–163)
- **What happens:** a 64 px sky-blue `#2ab0fd` dot hops in 10–15 f arcs onto whichever pill is on top. On
  the flash it is white and **squashed** (about 1.2 : 0.8, f153). It exits left at f157–163.
- **AE build:** a separate-dimensions arc: x linear, y ease-out up then ease-in down. Scale keys give the
  squash on landing, with the anchor at the bottom.
- **Helios today:** partly. It works by hand with the `dock-cursor` "separate dimensions" trick; there are
  no spatial tangents and no "land on layer X" helper.

**T4. Background colour cross-fade as a scene change** (f124–128)
- **What happens:** `#ededed` → `#ffffff` in 5 f while the headline scrolls in.
- **AE build:** two solids, opacity keys.
- **Helios today:** yes. `solid.color` is not animatable, so it takes two solids.

**T5. Invert flash in a music stop** (f147–157)
- **What happens:**
  - Tracking opens +0.166 em over 9 f.
  - The frame goes full `#1b5bfe` with white type for 6 f.
  - The weight steps Light → Regular → Semibold **on twos** inside the flash.
  - It sits inside a 1 s music drop-out, with accent transients on the on and off frames.
- **AE build:** a solid plus a duplicate white text layer trimmed to 6 f, with three weight duplicates
  trimmed to 2 f each (or a variable font's weight axis on hold keys). Tracking comes from a Text Animator.
- **Helios today:** yes, by hand. Three `text` layers with different `weight` values and `in`/`out`; a
  tracking animator.

**T6. Breathe: tracking closes, then scale** (f157–203)
- **What happens:**
  - Tracking holds for 10 f, then closes in 15 f on the house ease.
  - Then the line scales ×1.18 over 14 f, with its peak velocity in the middle.
  - **The weight does not change here** (measured).
- **AE build:** a Text Animator tracking key and a scale key.
- **Helios today:** yes. A tracking animator plus `transform.scale` keys. **No variable-font axis is needed
  for Workly.**

**T7. Shrink-swap** (f204–208)
- **What happens:** the line goes to 0.72× in 3 f and is hard-swapped for the next word on the next frame.
  The audio hit is on the swap.
- **AE build:** scale keys (ease-in) and a layer trim.
- **Helios today:** yes.

**T8. Typewriter on a drifting layer** (f208–217, f429–440)
- **What happens:**
  - "Meet" appears whole, then 1 char/f.
  - The layer drifts right about 15 px/f while typing, so the final two-phrase line lands centred.
  - "Business analytics" runs at about 1–1.5 char/f, with each new char fading grey → black over 2 f.
- **AE build:** Source Text keys or a Text Animator (opacity 0, range end keyed); position keys on the layer.
- **Helios today:** yes. `reveal` keys, or `cascade {by:'char', stagger:1/30, duration:2/30, from:{opacity:0}}`.

**T9. Colour front with hand-off** (f210–267, measured)
- **What happens:**
  - A light-blue `#3b9ae1` front fills the line from the **left**: at 0.67 → 6.4 chars over f210–216
    (0.217, −0.093, 0, 0.952; rmse 0.027). It trails the caret by 4–8 chars.
  - It stalls, then advances 0.42 char/f over f229–241. Everything behind it **stays blue**; this is not a
    wake that settles.
  - At f242–243 the blue **snaps off** in 2 f. At f247 "workspace" lights blue in 1 f. From f253 to f267 the
    blue **recedes** rightwards off the end of the line.
  - The front's edge is 1–2 chars wide and falls **inside** glyphs: the "y" is half blue on f214, which
    makes it a per-pixel gradient.
  - The second phrase has its own static dark gradient (`#0b294e` → `#184e74` → `#1b84aa`).
- **AE build:** duplicate the text layer, fill it light blue, and reveal the duplicate with a feathered
  rectangle mask (or a Gradient Ramp through a track matte). Keying the mask's left and right edges gives
  the fill, the snap-off, the relight and the recede.
- **Helios today:** partly. A `fillColor` animator with keyed `start`/`end` and `smoothness` does it **per
  glyph** (text.ts:259–270 mixes each glyph's colour). There is no per-pixel edge inside a glyph. A masked
  duplicate text layer, filled blue, with a rect mask whose `box` and `feather` are keyed, does it per pixel
  **today**.

**T10. Phrase pop and converge** (f223–250)
- **What happens:** the second phrase appears with a 2 f fade, then the gap closes over 27 f on the house
  ease and the whole line re-centres.
- **AE build:** position keys.
- **Helios today:** yes.

**T11. Split with an object born in the gap** (f258–282)
- **What happens:**
  - The line scales 1.39× and splits in 12–14 f (ease-in-out).
  - A blue rect appears at 297×140 px and unfolds to a square: width on a strong ease-out, height at a
    linear 80 px/f with a hard stop, 5 f in all.
  - A glass doc card is already inside it.
  - The right phrase is pushed off-frame and fades.
- **AE build:** a rectangle's Size keys (width and height on separate curves), the folder precomp masked
  to the rectangle, and position keys on the phrases.
- **Helios today:** partly. Shape `size` keys work and the folder parts are shapes with `backdrop`.
  **Icons are missing** (chat-bubble, thumbs-up, gear): there are no vector icons (P1).

**T12. Glass folder hero** (f282–351)
- **What happens:**
  - A blue back panel `#1c60d7` sits inside a pale tile `#dfe9f8` about 17 px @720 wide.
  - Three white doc cards fan out inside, with indigo line icons.
  - A **frosted front pocket** with a white-to-blue gradient (`#a5c3ee` → `#639ce5`) and strong backdrop blur.
  - A white label "Raw client data / Folder" and a gear icon.
  - Docs peek out (80 px lift) and drop back. A press shrinks the folder 6.7%.
- **AE build:** a precomp. The pocket is a shape with CC Frosted Glass or a blurred copy of the docs used
  as a track matte; the docs are keyed.
- **Helios today:** partly. `backdrop` blur, gradient shapes, masks and parenting all exist. The icons and
  bezier corners do not.

**T13. Outlined hand cursor** (f272–391)
- **What happens:** a white-filled hand with a `#022da6` stroke. It rises from the bottom edge in 9 f
  (ease-out), sits on the label, presses, and "grabs" for the drag.
- **AE build:** a vector cursor with position keys and a scale press.
- **Helios today:** partly. There is an arrow `path` cursor (`dock-cursor`); **no hand glyph** exists
  (straight-segment paths only).

**T14. Blur-bridge match cut** (f352–373, measured)
- **What happens:**
  - The world accelerates upward (expo-in) with no scale change.
  - At peak speed, a σ ≈ 10 px isotropic defocus switches on **in one frame** (f363).
  - Three frames later (f366), a hidden cut swaps to a wider framing where the object is 0.56× and sits
    inside a tilted app window. The upward travel continues and decelerates over about 10 f.
  - Focus snaps back over f369–373.
  - All of this happens inside a music drop-out.
  - It reads as a violent pull-back, but it is a cut.
- **AE build:** two precomps. Precomp A's position is keyed on expo-in, with a Gaussian Blur of about 20
  (Helios `blurriness` 20 = σ 10) keyed on at one frame. Precomp B has the same blur, held, then keyed off.
  Precomp B's position continues A's velocity and then eases out. Cut on a blurred frame.
- **Helios today:** yes, by hand: two `precomp` layers, `gaussian-blur` keys, `in`/`out`. There is **no
  named transition**, and the P4 list lacks it.

**T15. Perspective app window with a drop-zone state swap** (f366–403)
- **What happens:**
  - A white window with a 2 px `#95bffa` stroke. The top edge is about 0.80× the bottom edge's width, so
    rotX is about 30–35° with a 50 mm-equivalent camera.
  - A BankDash sidebar and a dashed drop zone. The folder drops in and the zone swaps its content.
  - The window tilts further away on the exit.
- **AE build:** a 3D layer (a precomp of the UI) and a camera; the zone content swaps by opacity.
- **Helios today:** partly. `threeD`, `rotationX` and `camera` exist. The UI content is not native: it
  needs HTML (`create_motion_graphic`) or a screenshot. This is P3.

**T16. Inner-glow "accepted" pulse** (f386–402)
- **What happens:** a periwinkle glow blooms inwards from the window edges while the centre stays white:
  6 f up, 4 f hold, 6 f down. It lands on the music re-entry.
- **AE build:** Inner Glow as a layer style, or a feathered inverted mask on a periwinkle solid.
- **Helios today:** partly. A `radial-glow` procedural (inner `#faf9fe`, outer `#c4d2fd`) masked to the
  window with opacity keys works. There is no inner-glow layer style (P1 has it).

**T17. Scale slam, pull-out and scale-to-zero** (f403–427)
- **What happens:** 1.29 → 1.07 → 1.0 over 2 f; a slow drift to 0.74× over 19 f; out in 3 f.
- **AE build:** scale keys.
- **Helios today:** the slam yes; the gradient fill **no**.

**T18. Gradient type** (f403–470, f640–681)
- **What happens:**
  - "Built-in": `#1963e9` → `#a8cff5`, left to right.
  - "Business analytics" recolours black → a blue gradient as it rises.
  - "No more" has a band `#104d7a` → `#1c7dc4` → `#104d7a`.
  - "Workly" fades and saturates lavender `#b4b8f0` → `#0023ff`.
- **AE build:** Gradient Ramp plus Set Matte, or a Gradient Overlay layer style.
- **Helios today:** **no** for a per-pixel gradient. It can be approximated per glyph with `fillColor`
  animators. The Workly saturation is **yes** (`tint` or `hue-saturation` keys, or `fillColor`).

**T19. Dashboard rise with parallax satellites** (f453–504)
- **What happens:** a 20 f slide-up with 65% of the travel in 6 f. Satellite cards sit in 2–3 depth layers
  with soft shadows and move at their own speeds. The dashboard scales up about 3% during the hold.
- **AE build:** a UI precomp; each satellite card on its own position curve (or a 3D camera push).
- **Helios today:** partly. It works with image planes, but there is no generated dashboard (P3) and no
  parallax helper (P4).

**T20. Sparkle-star grow and zoom wipe, handed off to a 3D ribbon** (f469–528)
- **What happens:**
  - A 4-point star with **concave curved sides**, violet `#4240fe`, appears at the dashboard's corner.
  - It grows slowly, then ×1.22/f.
  - It never covers the frame by itself (39% at f520). A 3D ribbon in the **same violet** passes the lens
    and completes the cover. This is a colour-matched 2D → 3D hand-off.
- **AE build:** a shape star with Pucker/Bloat set to concave, scale on expo-in; the 3D render cut in
  underneath on a frame where the ribbon fills the lens.
- **Helios today:** partly. The `star` shape has straight edges only; concave sides need beziers (P1).
  Exponential scale works with keys or `{expr}`. The ribbon needs Blender (P7).

**T21. Real-3D phone with satin ribbons** (f520–600)
- **What happens:** an iPhone-style phone with the chat UI on its screen. Double-sided ribbons, blue front
  `#0035b6` with a satin highlight and a white back, unfurl, wave and retract. Large gradient spheres
  `#3f93f4` → `#91c1f6` sit in a grey studio `#ebecef`; the camera orbits slowly.
- **AE build:** made in C4D or Blender (not AE); the screen UI is comped or projected.
- **Helios today:** **no**. This needs P7 `device-hero` with ribbons.

**T22. Staircase lines, then leading collapse** (f591–640)
- **What happens:** three lines slide in from the left with a 2 f stagger, about 10 f each, grey → black,
  resting 2% from the left edge (a deliberate bleed). Out: line spacing → 0 in 3 f, then a hard swap.
- **AE build:** a Text Animator by line (position and opacity) with an offset; Line Spacing keyed for the
  collapse.
- **Helios today:** the entrance yes (`cascade {by:'line', stagger:2/30}`). The collapse **no**
  (`lineHeight` is static); it can be faked with three by-line animators with y deltas. The safe-area fit
  would move the lines.

**T23. Gradient-stroke rings with a two-surge pull-back** (f640–688)
- **What happens:** two r ≈ 450 px circles with 3 px `#89bcf5` strokes that fade along their length; the
  camera pulls back.
- **AE build:** ellipse strokes with Gradient Stroke (or a trim with a feathered mask); a camera or null
  scale.
- **Helios today:** partly. Ellipse strokes and trim exist; **gradient strokes** do not (P1).

**T24. Notification constellation with depth of field** (f660–733)
- **What happens:**
  - White cards with radius about 21 px, a near-invisible shadow, a blue outline bell icon, a semibold
    title and a regular body.
  - A frosted translucent card with grain.
  - Blurred dashboards behind, defocus about 6–8 px; slow parallax.
- **AE build:** 3D layers with camera depth of field, or per-layer Camera Lens Blur.
- **Helios today:** partly. Per-layer `gaussian-blur` works. The bell icon is missing (P1), and blur is not
  driven by depth (P4).

**T25. Expo-in whip to an empty frame** (f729–744)
- **What happens:** 15 f of acceleration, reaching 164 px/f on the last frame, no visible motion blur, then
  a cut to an empty frame.
- **AE build:** a null's position on an expo-in curve.
- **Helios today:** yes.

**T26. Wordmark rise with fade-saturate, then a word-stagger tagline and a dip to black** (f745–837)
- **Numbers:** the rise and saturation are as §4; the tagline staggers 1 f per word; the dip is 10 f.
- **AE build:** position keys, a fill/tint key, a Text Animator by word, and a black solid.
- **Helios today:** yes.

**T27. Soft mesh background** (f404 onward)
- **What happens:** a `#eeeeef` base with blue-grey blobs `#c2d2e8`–`#b6cce7` in the corners, drifting
  slowly.
- **AE build:** 4-Colour Gradient, or blurred ellipses.
- **Helios today:** partly. `aurora` and `radial-glow` exist; there is no multi-blob mesh procedural.

---

## 4. Measured motion grammar

Only fits with rmse ≤ 0.05 are listed as curves. M1, M2 and M3 are this report's new scripts; mm1 and
mm2 are the earlier `measured_moves*.json` files.

| Token | Workly value | Frames | cubic-bezier | rmse | Source |
|---|---|---|---|---|---|
| **House ease** (layout, camera and type moves) | ≈ **(0.25, 0, 0, 1)**. A 3–5 f soft start, then a long settle; 90% done at 40–50% of the duration. Sample points: 0.45 at t = 0.2, 0.67 at t = 0.3, 0.87 at t = 0.5 | 4 moves, 15–36 f | Folder recentre (0.219, 0.051, 0, 1.056) and (0.139, −0.086, 0.124, 1.154); converge (0.276, 0.056, 0, 1.051); tracking close (0.32, −0.052, 0.011, 1.049) | 0.009 / 0.011 / 0.006 / 0.002 | mm1, M2, M3, M1 |
| UI panel slide-up | 20 f, 478 px, 65% in 6 f, peak 77 px/f on frame 2 | f459–479 | (0.086, 0.042, 0.083, 0.905) | 0.003 | mm2 |
| World scroll | Ease-in over 37 f, then ease-out over 27 f; peak about 37 px/f | f88–145 | (0.942, 0.07, 0.826, 1.115), then (0.121, 0.842, 0.645, 0.996) | 0.043 / 0.003 | mm2, mm1 |
| Split / scale-up (a "snap" in the middle) | 12–14 f, symmetric | f258–272, f181–195 | (0.673, 0.13, 0.618, 0.976); (0.724, 0.139, 0.043, 1.018) | 0.016 / 0.004 | mm1, M1 |
| Wordmark rise | 44 f, 258 px, 90% by 20 f | f745–789 | (0.044, 0.419, 0.044, 0.991) | 0.004 | mm2 |
| Wordmark fade-saturate | 8 f | f746–754 | (0.72, 1.309, 0.328, 0.944) | 0.008 | mm2 |
| Tracking open (into the flash) | 0 → +0.166 em (AE tracking about +166) in 9 f | f147–156 | (0.296, 0.183, 0.191, 0.935) | 0.015 | M1 |
| Tracking hold, then close | Hold 10 f; close +0.166 → 0 em in 15 f | f157–181 | House ease | 0.002 | M1 |
| Weight | Stroke/cap-height ratio: 0.160 before the flash (≈ Semibold); 0.100 / 0.121 / 0.156 on twos inside the flash; 0.125 after (≈ Regular), constant f157–207 | f140–207 | Steps | — | M1 |
| Pill pop-in | Scale 30 → 100% in 3–4 f; rotation level in 4–7 f; overshoot 7–11% of the tilt (1–2.3°); settled ≤ 13 f | f8–61 | Rotation (0.436, 0.278, 0, 1.167) | 0.038 | mm1 |
| Object birth | Width 297 → 485 px in 5 f on a strong ease-out; height at a linear 80 px/f with a hard stop | f271–276 | Width (0, 0.206, 0, 0.842) | 0.012 | M2 |
| Press | −6.7% scale and rises about 75 px, 10 f | f332–342 | — | — | M2 |
| Blur-bridge cut | Blur on in 1 f, σ ≈ 10 px; cut 3 f later; sharp 7 f after the cut; new framing 0.56×; post-cut ease-out about 10 f | f352–380 | Drag is expo-in (velocity roughly doubles every 2 f) | — | M2 + analysis.json |
| Scale slam | 1.29 → 1.07 → 1.0 in 2 f, then 0.74× over 19 f, out in 3 f | f404–427 | — | — | mm2 |
| Shape wipe | ×1.22/f; covers 39% by f520; a 3D ribbon completes it | f505–522 | Exponential | — | mm1 + mm2 |
| Whip | 15 f expo-in, velocity ×1.25–1.5 per frame, 164 px/f on the last frame, no motion blur | f729–743 | — | — | analysis.json |
| Typewriter | 1 char/f; per-char fade 2 f ("Business analytics"); the colour front trails the caret by 4–8 chars | f208–217, f429–440 | Front: (0.217, −0.093, 0, 0.952) | 0.027 | M3 |
| Staggers | Pills 13–26 f apart; lines 2 f; tagline words 1 f; phrase pop 2 f | — | — | — | Notes + frames |
| Holds | Folder hero about 2.3 s; "Built-in" 0.7 s; wordmark and tagline about 2.2 s | — | — | — | — |
| Dip to black | 10 f dip, 16 f black; music still playing | f813–837 | Linear | — | Notes |

**Fits rejected** (rmse > 0.05):
- all pill-scale fits (0.17–0.29);
- `pullback_zoom_folder_width` (0.085), replaced by M2;
- chat-line slides (0.18–0.28);
- `notif_whip_out_y` (0.269), replaced by the per-frame camera dy;
- `star_wipe_tip_radius` (0.22), for which the raw samples are used;
- `dashboard_slide_up_y` in mm1 (0.258), where the mm2 fit is used instead.

---

## 5. Design system

**Palette** (sampled at 1080p with `sample_colors.py` and `sample_text.py`)

| Role | Hex |
|---|---|
| Pile background, then UI background | `#ededed`, then `#ffffff`; window world `#efefef` |
| Mesh background | Base `#eeeeef`; blobs `#c2d2e8`, `#b6cce7`, `#dfe5ed` |
| Violet-blue (pills B/C/E, star, cards) | `#2b43fd`, `#4240fe`, `#312fed` |
| Blue (pill A, flash) | `#2b70fd`, `#1b5bfe` |
| Sky (dot, sweep front) | `#2ab0fd`, `#3b9ae1` |
| Folder | Back `#1c60d7`; pocket `#a5c3ee` → `#639ce5`; label `#1d52c0` |
| Glow / window stroke | `#c4d2fd` / `#95bffa` |
| Type | Near-black `#0c0c0c`–`#101828`; navy on white pills about `#1e3a8a`; grey tagline `#454446` |
| Gradients | "Built-in" `#1963e9` → `#a8cff5`; "No more" `#104d7a` → `#1c7dc4`; "workspace" `#184e74` → `#1b84aa`; "Workly" `#0023ff` |
| 3D scene | Ribbon `#0035b6` with a white back; spheres `#3f93f4` → `#91c1f6`; studio `#ebecef`; bot bubble `#1e56d4` |
| Dashboard accents (BankDash) | `#1717ed`, `#18d2c9`, `#e300e6` |

**Type**
- The original is SF Pro Display. The closest OFL match is **Inter** (variable, with an opsz axis); use
  **Inter Tight** for display lines.
- Weights: pills Semibold (600); headlines Regular/Medium (400–500); "Workly" Bold (700).
- Cap heights at 1080p:
  - "Can't keep up?" 74 px (about 102 px type), 89 px after the scale-up;
  - "Built-in" about 160 px at rest;
  - "No more chaos." about 78 px;
  - "Workly" about 90 px.
- Tracking is 0 at rest; it only moves as an effect (+0.166 em).

**Radii**
- Pills are fully round (r = h/2; h ≈ 175 px).
- Folder tile about 18 px; inner panel about 14 px.
- Notification cards about 21 px.
- App window about 15 px; drop zone about 8 px, 2 px dashed `#c9c9c9`.

**Shadows and glass**
- Shadows are almost absent. Cards use about `0 8px 24px rgba(20,40,120,.08)`. The folder has a pale
  blue tile halo instead of a drop shadow.
- Glass: a frosted pocket with backdrop blur of about 20 px and a white → blue gradient; one frosted
  translucent notification card with grain.

**UI style**
- Flat light product UI (BankDash-like), thin 1–2 px periwinkle strokes and outline icons.
- Depth comes from blur and scale, not from shadows.
- **Deliberate bleeds:** pills off the frame edges, "Chat" 2% from the left edge, split phrases pushed off-frame.

---

## 6. Sound design (inferred)

**Music**
- A single upbeat electronic track. The kit's tempo estimate is 72.8 bpm, which is probably half-time:
  onsets come about every 0.2 s.
- It includes a vocal chop at 12.6–13.1 s (the captions misheard it as "Make it down").
- There is no voice-over.
- The music keeps playing under the fade to black and only fades in the last 6 f, so there is no final hit.

**Structure** (per-frame RMS; this is stronger evidence than onset matching, which is at chance here:
4.05 onsets/s gives about a 49% chance of hitting ±2 f)
1. **Two music stops carry the two biggest transitions.**
   - f145–174 (1.0 s): the invert flash. The flash is framed by two isolated transients at **f151** and
     **f157**, and the music re-enters at f175 exactly as the tracking settles.
   - f349–379 (1.0 s): the drag, the blur-bridge cut and the focus return all play in silence. A riser runs
     over f380–388, and the **re-entry at f389** lands under the glow pulse.
2. **Hits on swaps:** f207 (0.48) on the "Meet" shrink-swap; f263 (0.58, after a 4 f mini-stop) on the split.
3. **The loudest moments are reveals:** the dashboard rise (f463–468, 0.56); the 3D phone (f527–531, 0.64,
   the film's peak); the notification constellation (f662–678).

**Likely SFX**
- Soft pops on the pill landings. f9 and f50 have peaks, but they can't be separated from the music.
- A tick/click on the flash on and off.
- A whoosh on the shrink-swap and on the whip (f728–738).
- A UI click on the folder press (f331).
- A riser into the drop and a glassy "accept" swell under the glow.
- An impact on "Built-in".

This is inference from RMS; nothing was isolated.

---

## 7. What Helios needs

The plan's pillars already cover most of this film. The items below reconcile it and add only what
the plan lacks.

### 7.1 Engine schema (`src/motion/types.ts`)

| Change | Why (technique) | Plan status |
|---|---|---|
| `LayerCommon.bleed?: boolean`: `safeArea.ts` skips the layer, and `run_frame_qa` treats it as a waiver | T2, T11, T22. Deliberate bleeds are part of the style; "type never bleeds" (safeArea.ts:137) would move them | **Missing** |
| `TextAnimator.fill?: 'glyph' \| 'pixel'`: with `'pixel'`, the selector's soft edge (`smoothness`) becomes a per-pixel horizontal mask across glyphs, so `fillColor` fronts can stop mid-letter. This reuses the existing keyed `start`/`end`/`offset` in char units, which follow re-centring text; a pixel-offset gradient would not | T9. Also covers Virgil and WasteProtection gradient fronts | The plan has `fill?: Paint` with a px `offset`. Keep it for static gradients (T18) and **add** this for fronts |
| `TextLayerData.lineHeight?: Prop<number>` (or `TextAnimator.props.leading`) | T22 leading collapse | **Missing** (P2 only has tracking collapse) |
| `TextLayerData.weight?: Prop<number>`, stepped on hold keys, until P2 axes land | T5, which steps on twos inside the flash | P2 `axes` covers it. **Correction:** Workly's breathe needs no weight axis |
| `ProceduralKind += 'mesh'`, params `{bg, blobs:[{color, at, r, drift}]}` | T27. Also the Virgil and Solair mesh worlds | **Missing** (§2.2 lists "drifting mesh blobs", but no pillar builds them) |
| `scene.transitions[] += {type:'blur-bridge', at, out:[ids], in:[ids], dir, sigma≈10, holdF≈6, settleF≈10, scale}` | T14 | **Missing** from P4's 15 transitions |
| `scene.guide.roles += {as:'hopper', onto:layerId, arcF:10–15, squash:[1.2, 0.8]}`: lands on the top edge of the target layer at `t` | T3 | P4 guide exists; this role is **missing** |
| `cues[].sound += 'tick' \| 'music-stop'`, where `music-stop {at, until}` ducks the music bed to silence | §6. The film's main audio device | P9 lacks stop-time |
| Kit `TIMING.ease.house = [0.25, 0, 0, 1]`, `TIMING.pop = {scale:[3,4], settle:13, rotOvershoot:0.1}`, `TIMING.blurBridge`, `TIMING.whip = {f:15, growth:1.3}` | §4 | P10 exists; these values are **new or corrected** |

### 7.2 Templates (`src/motion/kit/`)

| Template | What it does | Parameters |
|---|---|---|
| `chat-pile-hook` | T1–T3 | `messages[]`, `palette`, `hopper:true`, `scrollTo:"headline"` |
| `flash-breathe-headline` | T5–T7 | `text`, `flashColor`, `trackingOpen:0.166`, `scaleUp:1.18` |
| `type-sweep-split` | T8–T11 | `lead`, `tail`, `sweepColor`, `object:{precomp\|ui}` |
| `blur-bridge-drop` | T14–T16 | `from`, `into:{ui}`, `glow` |
| `word-slam` | T17 | Slam, pull-out and scale-out, with a gradient fill |
| `staircase-lines` | T22 | With a `leading-collapse` exit |
| `ring-orbit-headline` | T23 | |
| `notification-constellation` | T24 | Built on P3 cards and P4 parallax |
| `wordmark-tagline` | T26 | |
| `shape-wipe` | T20 | From P4; add a `handoff:{color}` param so a Blender render can take over the cover |

### 7.3 AI tools and knowledge

- `motion_guide {topic:"saas-explainer"}` (P10) should carry these rules:
  - **the Workly beat map** (§2);
  - **"disguise every cut"**, with the five hiding places from §1;
  - **"put the two biggest transitions in music stops"**;
  - **one house ease for everything**, and snaps only for slams and pops;
  - **"depth from blur and scale, not shadows"**;
  - deliberate bleeds.
- `create_ui_screen` (P3) needs these kinds: `chat-pill`, `folder-card` (glass pocket, docs, label; parts
  `doc[n]`, `pocket`, `label`), `app-dropzone` (states `empty` / `accepted`), `notification`, and
  `dashboard`. The dashboard should be a generated BankDash-like layout; the BankDash file itself can't be
  bundled.
- Pacing QA (P10) should read the §4 tokens with Workly as a profile.

### 7.4 Assets

- **Fonts:** Inter / Inter Tight variable (OFL, from P2).
- **Icons:** Lucide (from P1): `bell`, `settings`, `upload`, `message-square-text`, `thumbs-up`,
  `sparkle`, and a hand pointer (Lucide `pointer`). The concave sparkle should be a P1 bezier asset.
- **Glass-card style preset** for the folder and the frosted card.

### 7.5 Blender (P7)

Beat 15 needs P7's `device-hero` preset extended with ribbons:
- **Ribbons:** a curve with a width bevel and a two-sided material (satin blue front `#0035b6`, white back).
  Unfurl and retract by animating the curve's `bevel_factor_start` / `bevel_factor_end`.
- **Spheres:** two or three large ones with a soft gradient emission.
- **Studio world** `#ebecef`.
- **Camera:** a slow orbit and push.
- **Screen:** textured from a P3 chat UI **image sequence**, so the bot bubble animates.
- **New param `introWipe:{color:"#4240fe", fromCover:0.4}`:** the first frames sweep a ribbon across the
  lens in the wipe colour. That makes the 2D star → 3D hand-off (T20) automatic.
- **Render:** EEVEE draft, Cycles final. It comes back as a `sequence` footage layer (plan A1).

---

## 8. Recreate recipe: the best 10 s (f146–445, 4.83–14.83 s)

**Why this stretch.** It is the densest craft in the film, it contains both music stops, and it needs
no 3D:
- flash → breathe → shrink-swap;
- type with a colour front → converge → split → folder birth;
- folder hero → **blur-bridge cut** → app window → glow pulse;
- "Built-in" slam → "Business analytics".

**Suggestion for the plan's golden beat (§6.3).** The golden beat for Workly (pile → app window) stops at
12.4 s. Extend it to f1–405 (13.5 s, still within the 15 s limit) so that it includes the blur-bridge
and the slam.

**Ordered tool calls.** NEW marks a tool or field from the plan or from §7.

1. `create_brand_kit` / `set_active_brand_kit`: the §5 palette and Inter.
2. `motion_guide {topic:"saas-explainer", beat:"problem→meet→hero→feature"}` (**NEW**, P10).
3. Music: import the track, then `analyze_music_beats`. Place the two stop windows at scene 0.0–1.0 s and
   6.77–7.77 s, either as `cues` `music-stop` (**NEW**) or by hand with `level_audio` / keyframes on the
   music clip.
4. `create_ui_screen {kind:"folder-card", parts:["back","doc1","doc2","doc3","pocket","label","gear"]}`
   (**NEW**, P3).
5. `create_ui_screen {kind:"app-dropzone", device:"browser", states:["empty","accepted"]}` (**NEW**, P3).
6. `create_motion_scene`, with the raw scene sketched below. Today it can be built with the per-glyph
   front and hand-made transitions, `fit:false`. With §7 it becomes `bleed`, `fill:'pixel'`,
   `blur-bridge` and `mesh`.
7. `add_sound_effect` on the cues. Until P9, this is limited to its 5 accepted kinds:
   - click at 0.167 s and 0.367 s (flash on and off);
   - whoosh at 2.0 s (shrink-swap);
   - pop at 2.57 s (phrase);
   - impact at 3.9 s (split);
   - click at 6.2 s (press);
   - riser at 7.8 s;
   - chime at 8.1 s (glow);
   - impact at 8.6 s ("Built-in").
8. `run_frame_qa`, with bleeds waived through `bleed` (**NEW**), then pacing QA against the Workly tokens
   (**NEW**, P10), then `consult_council`.

**MotionScene sketch.** Times are scene seconds, so f146 = 0 and t = (f − 146) / 30. Colours come from §5.

```jsonc
{ "version": 1, "width": 1920, "height": 1080, "duration": 10.0, "background": "#ffffff",
  "motionBlur": { "samples": 8, "shutter": 180 },
  "cues": [ {"at":0.167,"sound":"tick"}, {"at":0.367,"sound":"tick"},           // "tick" NEW (use click today)
            {"at":-0.03,"sound":"music-stop","until":0.93},                     // NEW
            {"at":2.0,"sound":"whoosh"}, {"at":2.57,"sound":"pop"}, {"at":3.9,"sound":"impact"},
            {"at":6.2,"sound":"click"}, {"at":6.77,"sound":"music-stop","until":7.77},
            {"at":7.8,"sound":"riser"}, {"at":8.1,"sound":"chime"}, {"at":8.6,"sound":"impact"} ],
  "transitions": [                                                              // NEW (P4 + blur-bridge)
    { "type":"blur-bridge", "at":7.333, "out":["folderHero"], "in":["appWorld"],
      "dir":[0,-1], "sigma":10, "blurOnAt":7.233, "sharpAt":7.567, "scale":0.56 } ],
  "layers": [
    { "id":"mesh", "type":"procedural", "kind":"mesh", "in":8.6,                  // NEW kind (aurora today)
      "params":{"bg":"#eeeeef","blobs":[{"color":"#c2d2e8","at":[0.05,0.95],"r":0.45,"drift":0.02},
                                         {"color":"#dfe5ed","at":[0.95,0.05],"r":0.4,"drift":0.02}]} },
    { "id":"flash", "type":"solid", "color":"#1b5bfe", "in":0.167, "out":0.367 },

    // Beat 3-5: one line, three weights on twos inside the flash, then Regular.
    // hdPre (0-0.167): weight 600, #0c0c0c, tracking 0 -> 16.6 from 0.033 to 0.333 on
    // [0.3,0.18,0.19,0.94] (the flash layers share that animator, so tracking keeps opening under the flash)
    { "id":"hdLight", "type":"text", "in":0.167, "out":0.233, "text":{ "text":"Can’t keep up?",
      "font":"Inter", "weight":300, "size":102, "color":"#ffffff", "align":"center",
      "animators":[{ "by":"char","start":0,"end":100,"props":{"tracking":16.6}}] },
      "transform":{"position":[960,540]} },
    // hdRegularFlash (0.233-0.3, weight 400) and hdSemiFlash (0.3-0.367, weight 600): same line, white
    { "id":"headline", "type":"text", "in":0.367, "out":2.067, "text":{ "text":"Can’t keep up?",
      "font":"Inter", "weight":400, "size":102, "color":"#0c0c0c", "align":"center",
      "animators":[{ "by":"char","start":0,"end":100,
        "props":{"tracking":{"k":[{"t":0.0,"v":16.6,"ease":"hold"},{"t":0.667,"v":16.6,"ease":[0.25,0,0,1]},
                                  {"t":1.167,"v":0}]}}}] },                      // tracking in 1/100 em
      "transform":{"position":[960,540],
        "scale":{"k":[{"t":1.167,"v":100,"ease":[0.72,0.14,0.04,1.02]},{"t":1.633,"v":118,"ease":"hold"},
                      {"t":1.933,"v":118,"ease":"cubic-in"},{"t":2.033,"v":85}]}} },

    // Beat 6: type + colour front + converge (the front is a keyed range selector)
    { "id":"lead", "type":"text", "in":2.067, "out":5.333, "text":{ "text":"Meet your new",
      "font":"Inter", "weight":400, "size":100, "color":"#101828", "align":"left",
      "reveal":{"k":[{"t":2.067,"v":0.31,"ease":"linear"},{"t":2.367,"v":1}]},   // "Meet" whole, then 1 char/f
      "animators":[{ "by":"char", "fill":"pixel", "smoothness":1.5,                // "fill" NEW ('glyph' today)
        "start":0, "end":{"k":[{"t":2.067,"v":0,"ease":"hold"},{"t":2.1,"v":5,"ease":[0.22,0,0,0.95]},{"t":2.3,"v":50,"ease":"hold"},
                               {"t":2.733,"v":50,"ease":"linear"},{"t":3.167,"v":85,"ease":"hold"},
                               {"t":3.2,"v":0}]},
        "props":{"fillColor":"#3b9ae1","fillAmount":100} }] },
      "transform":{"position":{"k":[{"t":2.067,"v":[426,540],"ease":"linear"},      // drift ~15 px/f while typing
                                    {"t":2.567,"v":[636,540],"ease":[0.25,0,0,1]},  // converge (house ease)
                                    {"t":3.467,"v":[402,540],"ease":"linear"},
                                    {"t":3.733,"v":[395,540],"ease":[0.67,0.13,0.62,0.98]},  // split
                                    {"t":4.2,"v":[214,540]}]},
                   "scale":{"k":[{"t":3.733,"v":100,"ease":[0.67,0.04,0.8,1.18]},{"t":4.133,"v":139}]},
                   "opacity":{"k":[{"t":5.133,"v":100},{"t":5.333,"v":0}]}} },
    { "id":"tail", "type":"text", "in":2.567, "out":4.4, "bleed":true,            // "bleed" NEW
      "text":{ "text":"AI workspace", "font":"Inter", "weight":400, "size":100, "color":"#184e74" /* P2 fill: gradient */,
               // same fillColor front: "workspace" lights at 3.367 (1 f), recedes rightwards 3.567-4.033
               "animators":[{ "by":"char","fill":"pixel","smoothness":1.5,"end":100,
                 "start":{"k":[{"t":3.333,"v":100,"ease":"hold"},{"t":3.367,"v":25,"ease":"hold"},
                               {"t":3.567,"v":25,"ease":"linear"},{"t":4.033,"v":100}]},
                 "props":{"fillColor":"#3b9ae1","fillAmount":100} }] },
      "transform":{"opacity":{"k":[{"t":2.567,"v":0},{"t":2.633,"v":100},{"t":4.333,"v":100},{"t":4.4,"v":0}]},
                   "position":{"k":[{"t":2.567,"v":[1305,540],"ease":[0.25,0,0,1]},{"t":3.467,"v":[1010,540],"ease":"linear"},
                                {"t":3.733,"v":[1010,540],"ease":[0.67,0.13,0.62,0.98]},{"t":4.333,"v":[1700,540]}]}} },

    // Beat 7-8: the folder is born in the gap (P3 ui layer; a precomp of shapes + backdrop today)
    { "id":"folderHero", "type":"ui", "in":4.167, "out":7.333,                    // NEW layer type (P3)
      "ui":{ "source":{"asset":"folder-card"},
             "actions":[ {"t":5.3,"type":"lift","target":"doc1","z":80},
                         {"t":6.2,"type":"click","target":"label"} ],
             "cursor":{"style":"hand","color":"#022da6"} },
      "masks":[{"shape":"rect","radius":14,
        "box":{"k":[{"t":4.167,"v":[-148,-70,297,140],"ease":[0,0.21,0,0.84]},{"t":4.333,"v":[-243,-238,485,477]}]}}],
      "transform":{"position":{"k":[{"t":5.1,"v":[1528,552],"ease":[0.25,0,0,1]},{"t":6.3,"v":[1043,676]},
                                    {"t":6.867,"v":[1038,551],"ease":"expo-in"},{"t":7.3,"v":[1038,320]}]},
                   "scale":{"k":[{"t":4.333,"v":100,"ease":"linear"},{"t":4.933,"v":108}]}},
      "effects":[{"type":"gaussian-blur","blurriness":{"k":[{"t":7.2,"v":0,"ease":"hold"},{"t":7.233,"v":20}]}}] },

    // Beat 9-10: the wider world after the hidden cut (tilted app window + drop zone + glow)
    { "id":"cam", "type":"camera", "zoom":2667 },
    { "id":"appWorld", "type":"ui", "in":7.333, "out":8.6, "threeD":true,          // NEW (P3)
      "ui":{ "source":{"asset":"app-dropzone"},
             "actions":[ {"t":7.967,"type":"state","to":"accepted"},
                         {"t":8.0,"type":"pulse","target":"window","color":"#c4d2fd"} ] },
      "transform":{"rotationX":{"k":[{"t":7.333,"v":32,"ease":"hold"},{"t":8.433,"v":32,"ease":"cubic-in"},{"t":8.567,"v":45}]},
                   "position":{"k":[{"t":7.333,"v":[960,860,0],"ease":[0.07,0.57,0,0.88]},{"t":7.8,"v":[960,540,0]}]}},
      "effects":[{"type":"gaussian-blur","blurriness":{"k":[{"t":7.433,"v":20,"ease":"cubic-in-out"},{"t":7.567,"v":0}]}}] },

    // Beat 11: slam (gradient fill needs P2)
    { "id":"builtIn", "type":"text", "in":8.6, "out":9.367, "text":{ "text":"Built-in",
      "font":"Inter", "weight":500, "size":225,
      "fill":{"gradient":{"kind":"linear","stops":[[0,"#1963e9"],[1,"#a8cff5"]]}} },  // NEW (P2 fill: Paint)
      "transform":{"position":[960,540],
        "scale":{"k":[{"t":8.6,"v":129,"ease":"linear"},{"t":8.633,"v":107,"ease":"linear"},
                      {"t":8.667,"v":100,"ease":[0.31,0.75,0.26,1]},{"t":9.267,"v":74,"ease":"expo-in"},{"t":9.367,"v":0}]}} },

    // Beat 12: per-char typewriter with a grey→black fade
    { "id":"biz", "type":"text", "in":9.433, "text":{ "text":"Business analytics", "font":"Inter",
      "weight":500, "size":100, "color":"#0c0c0c", "align":"left",
      "cascade":{"by":"char","delay":9.433,"stagger":0.028,"duration":0.067,"from":{"opacity":0}} },  // 1-1.5 char/f
      "transform":{"position":{"k":[{"t":9.433,"v":[320,540],"ease":[0.25,0,0,1]},{"t":10.0,"v":[472,540]}]}} }
  ] }
```

**What already works today** (per glyph, with `fit:false`):
- all the type beats, the flash, the breathe, the slam, the typewriter and the cascade;
- the blur-bridge, as two precomps, blur keys and `in`/`out`;
- the glow, as a `radial-glow` layer with opacity keys, masked to the window.

**What does not work today:**
- the per-pixel front and the gradient type (P2);
- the folder icons, the hand cursor and the concave star (P1);
- the UI as parts and actions (P3);
- the `mesh` background, `bleed` and stop-time cues (§7).

---

## 9. Top 10 improvements, ranked

| # | Improvement | Size | Why first |
|---|---|---|---|
| 1 | **Fix the TIMING tokens and add Workly's house ease (0.25, 0, 0, 1).** Four measured moves agree on it (rmse 0.002–0.011) | S | Every template's feel, for one line of data. The plan currently cites Workly for a (0.6, 0, 0.4, 1) push, which Workly contradicts |
| 2 | **`blur-bridge` transition** (P4 addition): expo-in drag, 1 f blur on at σ 10, a cut under the blur, continued velocity, focus back in about 4 f | S–M | This is the film's signature, and every piece of it exists today; it only needs naming and a helper |
| 3 | **Per-pixel text fill:** `TextAnimator.fill:'pixel'` for fronts, plus P2 `fill: Paint` for static gradients | M | T9 and T18 appear in 5 beats of this film and in 4 other films |
| 4 | **`bleed` layer flag** in the safe area and QA | S | Without it, the fitter will "fix" the pile, the split and the staircase, and destroy the style |
| 5 | **P3 UI kinds `folder-card`, `app-dropzone`, `notification`, `dashboard`**, with lift, click, state and pulse actions and a hand cursor | L | The hero objects of beats 7–18 |
| 6 | **`chat-pile-hook` template plus the guide `hopper` role**: measured pop-in, rotation overshoot, landing squash, world scroll | M | The hook, which the golden beat starts with |
| 7 | **Music stop-time cue plus accent ticks** (P9 addition) | S | The film's main audio device, which the plan misses |
| 8 | **`mesh` procedural background** with drifting blobs | S | Beats 11–22, and the plan's own §2.2 look tokens |
| 9 | **Animatable `lineHeight` and stepped `weight`** (ahead of P2 axes) | S | Leading collapse (T22) and flash weights (T5) |
| 10 | **Blender `device-hero` + ribbons with `introWipe` colour hand-off** (P7) | L | Beats 14–15; the one part 2D can't fake |
