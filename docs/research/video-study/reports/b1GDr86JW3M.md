# b1GDr86JW3M · "Virgil" SaaS launch (Sebastian, 37 s): video study

*2026-09-25. Finished from the saved frame-by-frame pass (`out/b1GDr86JW3M/notes.md`), the saved move fits
(`measured_moves.json`), 16 verification sheets of 8–17 frames each, three constrained refits, three new
measurements and a beat-grid analysis of `audio.wav`. Companion to
[REFERENCE-FILMS-PLAN.md](../../../REFERENCE-FILMS-PLAN.md) §3.2.*

**Source tags used below.**

| Tag | Meaning |
|---|---|
| **[V]** | Verified on the frames in this pass |
| **[M]** | Saved fit that is clean (rmse ≤ 0.01, no parameter on its bound) |
| **[R]** | Refit in this pass: x1, x2 ∈ [0, 1] and y1, y2 ∈ [−0.5, 1.5] |
| **[N]** | New measurement in this pass |
| **[notes]** | Taken from the notes only |

**Units.**
- f = frame at 29.97 fps. Frame 1 is t = 0.
- px are at 1080p.
- σ is a gaussian sigma. Bhippi's `gaussian-blur` `blurriness` is **2σ** (`gl/effects.ts:119` passes
  0.5 × blurriness to `blur(sigma)`).

---

## 1. What the film is

- **Product.** A 37 s launch film for **Virgil**, an AI investor-relations / fund-diligence SaaS.
- **Sound.** Music only. There is no voice-over; the "Heat" captions are ASR noise.
- **Shape.** One continuous camera world with only **4 hard cuts** (f250, f315, f349, f799), plus **3 cuts
  hidden inside motion** that the kit's cut detector missed: f50 zoom-through, f127 whip and f171 defocus cut-in.
- **Two colour worlds.** A white/sage LIGHT world states the problem. A slate DARK world shows the product.
  - The switch to dark is a hard cut **on the music drop** (f250).
  - The switch back to light is **not a cut**. The camera trucks across a world-space gradient while a
    glass orb flies (f401–467).
  - The last dark → white switch is a **star-wake wipe** that lands the logo as the music stops.

**The story, as type.**
1. "Too many [search questions] · Too little time" (problem, light).
2. The product UI answers (dark).
3. "From weeks to seconds" (the orb).
4. "Collaborate · Tag · Invite" (features on UI).
5. "Trusted sources · AI-Powered Investor Relations" (proof and positioning, dark).
6. The VIRGIL logo on white.

**What makes it world-class.**
1. **Every piece of type either becomes UI or comes out of UI.** A search bar drops into a chat field; the
   field's text collapses into an orb; the orb eats letters and streams new ones out; a sparkle becomes the
   typing caret.
2. **One continuity object** (the teal glass orb, later the magenta sparkle) carries the eye across 7 beats.
3. **Orientation locks first, then position and scale glide** (§4). Every arrival reads "snap, then float".
4. **Depth of field everywhere.** Words and UI rack-focus against each other, confetti is blurred by
   depth, and tilted UI planes defocus.
5. **Music structure drives the edit.**
   - The 4-bar intro is the problem.
   - The drop is the product.
   - The breakdown is the positioning line.
   - The final swell and stop are the logo.

---

## 2. Beat-by-beat breakdown

**How to read the Bar·beat column.**
- The grid is fitted from 101 of the 115 post-drop onsets (§6): **115.0 bpm**, 8th-note period 0.2608 s,
  drop at t = 8.340 s.
- 1 beat = 15.6 f and 1 bar = 62.5 f.
- The intro is 4 bars, labelled i1–i4. Bar 1 is the drop.
- The tempo is constant from t = 0: every intro onset sits on a half-beat of this grid within 15 ms.

| # | Frames | t (s) | Bar·beat | Beat | Technique IDs (§3) |
|---|---|---|---|---|---|
| 1 | 1–49 | 0.00–1.60 | i1 | "Too" holds. "many" cascades in one char per 2 f, dropping from about 0.5 cap-height with blur, then dissolves right to left. The whole line drifts, then **shrinks away**: height ×0.40 in 4–5 f, accelerating [N] | V1, V2 |
| 2 | 50–80 | 1.63–2.64 | i1·4 (+2 f) | **Hidden cut.** A huge blurred search bar arrives from the lens (≈2.5× → 1.29× at f52 → 1.13× at f54 → 1.0 at about f58) [V]. It types "Provide a geographic breakdown" [V]. The right side fades to white | V2, V3, V4 |
| 3 | 81–125 | 2.67–4.14 | i2 | More bars stack below (6–12 f apart, accelerating). The plane scrolls up with ease-in, rolls to about −8°, gains perspective and DOF, then whips | V5 |
| 4 | 126–170 | 4.17–5.64 | **i3·1** (+1 f) | **Hidden cut** inside the whip. "questions" arrives huge at **−23.6°** and settles in 4–5 f [R]. Some chars pop in late. Sage gradient fill. Slow pull-out, then a blur-up exit | V6, V7 |
| 5 | 171–204 | 5.67–6.77 | i3·4 (−2 f) | **Hidden cut.** "Too little" cuts in defocused: σ 7.5 → 3.4 in 1 f, then linear to 0 by f180 [M]. It zooms out and slides left | V8 |
| 6 | 205–249 | 6.81–8.28 | i4·2 (+1 f) | "time" appears (dark teal) as **neumorphic relief rings** ripple out from centre in 3–4 f [V]. The earlier words go pale. The camera **pushes into the central disc** over 9 f, on a rising high-band riser | V9, V10 |
| 7 | 250–280 | 8.31–9.31 | **1·1 (drop)** | **Hard cut 0.8 f before the drop onset.** Dark slate world with grid and sage glow. The "Marketing Presentation" card flies in: top-edge tilt −37° → 0 with 95% in 6 f; scale 1.5× → 1.0 exponentially with 95% in 16 f [R]. Heavy motion blur, and the right 40% alpha-faded. The progress bar fills about 10 → 45%, linear | V11, V12, V4 |
| 8 | 281–304 | 9.34–10.11 | 1·3 | **Pull-back reveal.** The card is a row of a "Diligence Checklist" modal sliding in from the right (8 f, blurred). The row snaps into its slot with a horizontal smear (f290–296) [V] | V13, V14 |
| 9 | 305–314 | 10.14–10.44 | 1·4.5 | **Whip-out.** The panel tilts in 3D. Defocus σ 0 → 4.1, ease-in, 11 f [M] | V15 |
| 10 | 315–348 | 10.48–11.58 | **2·1** (+1.6 f) | **Hard cut.** A dark glass-bezel search pill whips in: roll 13.3° → −1.8° overshoot at +5 f → 0.9° [R]; y lands in 2 f; x reaches 95% in 10 f [M]; σ 3.4 → 0 over 12 f [M]. Types "…of Fund I." at 1 char/f | V16 |
| 11 | 349–371 | 11.61–12.35 | 2·3.3 (a 16th) | **Hard cut.** The bar hovers over a white "Virgil Chat" window rising in perspective, **drops into the message field** (UI match-move), then a lavender focus ring pulses [V] | V17, V18 |
| 12 | 372–400 | 12.38–13.31 | 2·4.7 | **Tracking collapse.** The line (787 px) squeezes to 54 px about its centre in 13 f, ease-in [M]. A teal glass orb is born at f384 [V] and grows | V19, V20 |
| 13 | 401–467 | 13.35–15.55 | 3·2.6 → 4·3 | The window slides away as the camera trucks right (about 105 px/f). White 1 px lines with dot heads draw on (one yellow dot). The **orb leaves on an S path trailing a soft pale-blue ribbon** [V]. The background passes **dark → grey → white** in world space. The truck lands on "From weeks" (21 f ease-out) [M] | V21, V22, V23 |
| 14 | 468–530 | 15.58–17.65 | 4·3 | "to" **crashes in** over "weeks" (1.3× → 1, blur → 0, 4 f) as "From weeks" fades right to left. The orb arcs down, **eats "o" then "t"**, frosts and grows, then sharpens into a dark-teal glass **"S" badge**. A glass bezel ring scales out and fades (f497–515) [V] | V24, V25, V26 |
| 15 | 531–576 | 17.68–19.19 | 5·3 | The orb **coin-flips** to edge-on. "seconds" **streams out of it** at 1 char/f. The right edge overshoots +56% (f538), then the tracking settles over 13 f [M values] [V] | V27 |
| 16 | 577–607 | 19.22–20.22 | 6·2 | The orb **rolls right through "seconds", erasing letters as it passes**, then shrinks to a dot (f584) [V]. The blurred "Collaborators (2)" panel rises in strong perspective | V25, V28 |
| 17 | 608–656 | 20.25–21.86 | 6·4 | "Collaborate" rack-focuses in (σ 13 → 0 over 20 f, near-linear) [M]. The "Doug Douglass" row card is dragged by an outlined grab hand, **tilting about +8–10°** with motion blur, and drops at f656 [V] | V28, V29 |
| 18 | 657–720 | 21.89–23.99 | 7·3 | A pale-blue selection ring appears on the dropped row. The camera scrolls and tilts. "Tag" focuses in, bottom-left. The "@Jane…" note card is dragged in. The UI stays soft (DOF) [V] | V28, V29, V18 |
| 19 | 721–741 | 24.02–24.69 | **8·3** | **Camera push to "Invite"**: ×2.44 in 25 f, ease-in-out [M]. The hand clicks with a 2 f press dip | V30 |
| 20 | 742–798 | 24.73–26.60 | 8·4.4 | The glossy green check-sphere badge and "User invited" focus in over 5 f. A **confetti shower falls from the top edge** in 3 colours, tumbling in 3D with depth blur [V]. Exit: defocus σ 0 → 4.1, 12 f [M] | V31, V32 |
| 21 | 799–848 | 26.63–28.26 | **9·4** | **Hard cut.** The "Data Room" app screenshot sits in perspective and focus-pulls over 16 f [M], then pans left. **"Trusted" types in** with wide → tight tracking while its hue sweeps violet → red [V][N] | V33, V34, V7 |
| 22 | 849–920 | 28.29–30.66 | 10·4.8 | A huge defocused pointing hand enters from the near plane and clicks "Needs Approval". The pill flashes pink, then pops green "Approved" at about 1.5× [V]. "sources" types in (coral → red) | V35, V34 |
| 23 | 921–954 | 30.70–31.80 | 11·4 | A **magenta 4-point sparkle** sweeps across as a wipe, spinning about +14.5°/f, and shrinks from 481 → 98 px in 8 f, nearly linear, to sit beside "AI" [M] | V36 |
| 24 | 955–992 | 31.83–33.07 | **12·2** | The **sparkle becomes the typing caret**: "AI-Powered" at about 0.8 char/f; the line reflows and "AI" shrinks [V]. Idle Y-flip about every 30 f | V37 |
| 25 | 993–1058 | 33.10–35.27 | 12·4.5 → 13 | "Investor Relations" types in random-ish order with tracking tighten (lavender → violet gradient); the star lands at f1005. **Drums drop out at f1003 (bar 13)** [N]. The star grows, spins and exits right | V38, V37 |
| 26 | 1059–1082 | 35.30–36.07 | 13·4.9 → 14·2 | **Star-wake wipe.** A huge star returns from bottom-right, dragging a soft **white wake** that erases the letters. The wake covers the frame 0 → 99% over f1068–1082 with an ease-in [N], revealing the VIRGIL logo already at rest. A **sub-bass swell** peaks f1067–1071 [N] | V39 |
| 27 | 1083–1117 | 36.10–37.24 | — | **End card, 35 f (1.17 s), in digital silence**: the music stops at f1083 [N] | V40 |

---

## 3. Technique catalogue

**Bhippi status key.**
- **Today**: works with an existing field.
- **By hand**: possible with keyframes and effects, but there is no helper and the AI would have to derive every key.
- **Partial**: some of it works.
- **No**: cannot be done.

The pillar in brackets is the plan's home for the fix.

| ID | Technique | Frames | Description | AE build | Bhippi status |
|---|---|---|---|---|---|
| V1 | Per-char cascade in, **reverse** per-char exit | 9–48 | 1 char per 2 f in, from +0.5 cap-height, slight rotation and blur. Exit right → left about 6 f per char | Text animator Position/Rotation/Opacity/Blur, range selector Offset keyed; a second animator for the exit with the range reversed | **Partial.** `cascade` in: yes. Reverse-order exit: no (P2 `exit.order`) |
| V2 | **Zoom-through hidden cut** | 44–58 | Old: ease-in shrink ×0.40 in 4–5 f + fade; per-frame height ratios 0.96, 0.91, 0.88, 0.84, 0.61 [N]. New: arrives from the lens ≈2.5× → 1.0; 50% in 2 f, 95% in 10 f [M]; heavy blur. **No overlap frame**: the switch is a cut at f50 | Scale keys with exponential ease-in; cut; new layer Scale 250 → 100 easy-ease-out; Camera Lens Blur keyed | **By hand** (scale + `gaussian-blur` keys). P4 `zoom-through` |
| V3 | **Soft typewriter, long feather** | 52–80 | About 2 chars/f for the first 11 chars, then **exactly 1 char/f** [V]. The newest ~8–10 chars ramp up in opacity (pale → sage), so the soft edge is about 8 f long. It is **not** an accent-colour wake | Opacity animator, Range Start keyed 1 char/f, Smoothness ≈ 800% | **Partial.** `reveal` has a 1-char edge (`text.ts:275-278`). A `TextAnimator` with keyed `start` + `smoothness: 8` does it today. P2 `TypeOn.feather`, `script` |
| V4 | **Edge alpha fade** into the background | 52–130, 250–300 | Bars and cards dissolve over their right ~40% | Linear-gradient track matte or feathered mask | **Today** (`masks[].feather`, or a luma `matte` from a `linear-gradient` procedural) |
| V5 | UI stack scroll with roll, perspective and DOF, accelerating into a whip | 81–125 | The stack is one tilted 3D plane; bars leaving the focus band defocus | 3D layers in a null, camera, DOF, motion blur | **Partial.** `threeD`, `camera`, `motionBlur` work, but **camera `focus`/`aperture` are never rendered**: they are evaluated at `evaluate.ts:193` and never read in `gl/`. Per-layer blur keys by hand. P4 DOF |
| V6 | **Whip arrival with match-rotation** | 126–136 | Rotation −23.6° → ≈0 with 95% in 4 f; `quart-out` over 8 f fits to rmse 0.018 [R]. Scale, blur and per-char fill-in finish over about 10 f | Rotation/Scale keys, Directional Blur, CC Force Motion Blur | **By hand** (keys + `directional-blur` + `motionBlur`). P4 `whip` |
| V7 | **Gradient type fill**, static or hue-sweeping | 126–170, 827–882, 993+ | Sage left → pale right ("questions"). "Trusted": violet `#8E47DB` (f828) → red/plum `#CB3845`→`#A43F79` (f836) [N] | Gradient Ramp as fill + Colorama or a hue key | **Partial.** A per-glyph ramp via `TextAnimator` `fillColor` + `shape: ramp-up`. `fillColor` is a static string, so there is no hue-over-time beyond 2 colours via `fillAmount`. P2 `fill: Paint` |
| V8 | Cut in **defocused**, then focus pull | 171–180 | σ 7.5 → 3.4 in 1 f, then linear 0.37 σ/f to 0 [M] | Lens Blur keyed | **Today** (`gaussian-blur` `blurriness` 15 → 7 → 0) |
| V9 | **Neumorphic relief-ring ripple** | 205–240 | White embossed concentric rings grow from a disc behind "time" in 3–4 f, expo-out, then drift. Soft grey shading, white highlights | Ellipse shape layers + Bevel & Emboss + Inner/Drop Shadow, or CC Ripple Pulse on a displacement map | **No.** No bevel or inner shadow (P1 layer styles). A `relief-rings` procedural would be exact (**NEW**, §7) |
| V10 | **Push into a disc → cut on the drop** | 241–250 | Scale-up into the central disc over 9 f, ease-in, with the text shrinking to centre. The cut is on the drop | Camera dolly keys; cut placed on the drop marker | **By hand.** `snap_cuts_to_beats` snaps to onsets; there is no drop detection (P9) |
| V11 | **3D card fly-in with split settle** | 250–269 | Tilt: 95% in 6 f, 2.5% overshoot, fits the plan's (0.05, 0.7, 0.1, 1) to rmse 0.055. **Scale**: 1.51× → 1, exponential ×0.843/f (τ 5.9 f), 95% in 16 f [R]. Extreme motion blur on the trailing side | 3D layer, separate Rotation and Scale keys with different influence, motion blur 360° | **By hand.** Needs `threeD` + two key sets. The card itself needs P3 `ui` |
| V12 | Progress-bar fill | 257–280 | About 10 → 45%, linear | Trim Paths or Scale X | **Today** (rect `scale` or `trimEnd`) |
| V13 | **Pull-back to parent** (detail → it's a row of a bigger panel) | 281–296 | The camera pulls back while the panel slides in behind; the card becomes row 1 | Parent the card to the panel, then camera dolly-out | **No helper.** Not in P4's transition list (**NEW** `pull-back-to-parent`) |
| V14 | Snap into slot with horizontal smear | 290–296 | A 1–2 f streak, then settle about 5 f | Directional Blur spike keyed on 2 frames | **Today** (`directional-blur` `length` keys) |
| V15 | Whip-out: 3D tilt + defocus, ease-in | 300–314 | Blur σ (0.764, 0.212, 0.488, 0.9) rmse 0.024 over 11 f | rotY keys ease-in, Lens Blur up | **By hand.** P4 `whip` |
| V16 | Dark **glass-bezel pill** whip-in with roll overshoot | 315–331 | Roll 13.3° → −1.8° (21.8% overshoot at +5 f) → 0.9° [R]; y 95% in 2 f; x (0.261, 0.825, 0.586, 0.977) rmse 0.001 [M] | Two rotation keys (overshoot key + settle key) | **By hand.** P3 `ui` dark-glass search |
| V17 | **Drop into field** (UI match-move) | 349–356 | The floating bar lands exactly on the chat input and becomes it | Parent to the window, keyed to match the input box | **No helper.** P3 UiAction lacks `drop-into` (**NEW**) |
| V18 | Focus-ring / selection-ring glow pulse | 357–372, 657–664 | Lavender `#DCE2F9` ring (about 12 px) grows and fades; pale-blue ring on the dropped row | Stroke + Glow on a shape matching the element | **By hand.** P3 `highlight/pulse` |
| V19 | **Tracking collapse into a point → object** | 372–385 | Width 787 → 54 px, **centre-anchored**, (0.676, −0.102, 0.845, 0.744) rmse 0.004 [M]; flat for the first 3 f; the orb is born on the last frame | Tracking animator (centre-aligned text collapses to centre), then the orb appears | **Partial.** The Bhippi tracking animator is **left-anchored and in px** (`text.ts:271`), while layer `tracking` is in 1/100 em (`text.ts:118`). It needs a compensating `position` animator of (n−1)/2 × tracking. P2 preset `collapse-to-point`, P4 `collapse-into` |
| V20 | **Glass orb continuity object** | 384–584 | A teal refractive sphere whose environment reflections change as it moves; later a dark-teal glass "S" coin | Element 3D or a C4D render, or a CC Sphere fake | **No.** P6 `solid2_5d` glass/coin, or P7 `glass-orb` |
| V21 | Trim-path lines with dot heads, parallax | 401–448 | 1 px white lines draw on; dot caps; one yellow `#F2C94C` dot | Shape strokes, Trim End keyed, dot as a separate ellipse | **Today** (`shape` line + `trimEnd` + `ellipse`) |
| V22 | **Orb on an S path with a trailing ribbon** | 401–467 | A soft pale-blue `#D3E5FD` ribbon, thicker near the camera (tapered), whose trim end = the orb | Stroke along the motion path (Trapcode 3D Stroke or Trim Paths), orb on Auto-Orient | **No.** There is no follow-path and no taper; expressions cannot see other layers. P4 `guide.path/trail`, P1 `taper` |
| V23 | **World-space gradient truck** (world switch without a cut) | 401–467 | A dark → white gradient laid across a canvas about 3× the frame width. The camera trucks about 105 px/f, then lands with an ease-out over 21 f | A big gradient solid in 3D space + camera truck | **By hand** (`linear-gradient` procedural with a large `size` + camera keys). P4 world layout |
| V24 | Word crash replacement | 471–476 | "to" 1.3× → 1, blur → 0 in 4 f over "weeks"; "From weeks" fades right → left | Scale/blur keys + an opacity range | **Today** |
| V25 | **Object eats letters** (a moving wipe head) | 477–494, 577–584 | Letters vanish where the orb passes; the orb then shrinks to a dot | Track matte whose edge is parented to the orb, or a range selector Start from the orb's x via an expression | **By hand only if keys are hand-matched.** The link needs cross-layer reference (fact 4). **NEW** `links`, or P4 guide role `wipe` |
| V26 | Orb → badge with a bezel-ring pulse | 495–515 | Frosted → sharp "S" decal; a pale glass ring scales out and fades | Pre-rendered 3D + a stroked ellipse scale/opacity | **Partial.** Ring: today. Orb and decal: P6 or P7 |
| V27 | **Coin flip + letters stream out** (reverse of V19) | 531–551 | Chars at 1 char/f; right edge 1006 → 1432 px (f538, +56%) → 1279 px by f551 | Tracking animator keyed with overshoot; orb rotY | **Partial.** `cascade` + tracking animator keys; no origin at a layer (**NEW** `cascade.origin`), no coin (P6) |
| V28 | **Rack focus word ↔ UI** | 604–722 | "Collaborate" σ 13 → 0 over 20 f, near-linear [M]; the focus shifts to the panel at f628; "Tag" focus-in, then out | Camera DOF, focus distance keyed | **By hand** (per-layer blur keys). DOF is not rendered (V5) |
| V29 | **Drag with lag tilt + grab cursor** | 610–656 | The card follows an outlined grab hand, tilting +8–10° while moving, motion-blurred, then 0° on drop [V] | Parent the card to the cursor; rotation from velocity (expression) | **No.** P3 `drag {lag}` |
| V30 | **Camera push to a CTA + click** | 716–741 | ×2.44 in 25 f, (0.569, −0.007, 0.407, 0.984) rmse 0.007 [M]; 2 f press dip | Camera dolly, cursor scale dip | **By hand.** P3 `camera.push`, `click` |
| V31 | Success sphere + **confetti shower with DOF** | 742–790 | Glossy green check sphere focuses in over 5 f. Confetti **falls from the top edge** (not a radial burst): flat rectangles `#628F7D` / `#153940` / `#42846B` + pale blue; near pieces huge and blurred | Particular or CC Particle World with DOF | **No.** P5 `particles` confetti; needs a `top-edge` shower emitter and depth → DOF |
| V32 | Defocus + scale-up exit | 786–798 | σ 0 → 4.1 over 12 f (0.674, 0.727, 0.092, 0.608) [M] | Lens Blur + Scale keys | **Today** |
| V33 | App screenshot in perspective, focus pull, pan | 799–832 | Rotated in Y and X, σ 3.4 → 0 over 16 f [M] | 3D layer + camera | **By hand.** P3 `screenshot` source |
| V34 | **Type-on with per-char wide → tight tracking + hue sweep** | 827–882 | About 1 char/f; each char appears spaced wide and tightens; the hue drifts over about 8 f | Tracking + Opacity animators with Offset; Colorama | **Partial** (per-char tracking needs a range-selector `tracking` with a soft edge). P2 `TypeOn`, `fill` |
| V35 | Click → state pop | 869–882 | Grey pill → green "Approved", about 1.5× pop, pink ring flash | Precomp state swap + scale overshoot | **No.** P3 `click` + `state` |
| V36 | **Brand sparkle fly-in**, spin + shrink to icon | 921–944 | Concave 4-point star; spin about +14.5°/f, constant; size 481 → 98 px in 8 f, near-linear then a hard stop | Shape star with inner roundness; rotation/scale keys | **Partial.** The `star` shape has a fixed 0.45 inner ratio and straight sides (`raster.ts:158`). P1 bezier path / sparkle icon |
| V37 | **Glyph as typing caret** + idle Y-flip | 955–1008 | The star rides the typing edge (about 0.8 char/f) and occludes the newest glyph | Star position from `sourceRectAtTime` of the text (expression) | **No.** P2 `caret: 'glyph:<id>'` |
| V38 | Random-order type-in + tracking tighten | 993–1008 | "Investor Relations" chars appear out of order at about 0.7 f stagger | Range selector with Randomize Order | **Partial** (`TextAnimator.randomize` exists; `cascade` has no random order) |
| V39 | **Star-wake wipe** to a new world | 1059–1082 | The star crosses bottom-right → top-left, growing about +65 px/f (linear). **Its white wake, not the star, covers the frame**: 0 → 99% in 14 f, (0.659, −0.072, 0.787, 1.085) rmse 0.009 [N] | A thick feathered stroke on the star's path with Stroke Width keyed up, used as a matte for the white layer | **No.** P4 `shape-wipe` assumes the glyph itself covers the frame; this needs a `wake` variant (**NEW**) |
| V40 | Static end card in silence | 1083–1117 | 35 f hold; the logo is already at rest when revealed | — | **Today** |

---

## 4. Measured motion grammar

### 4.1 The numbers

- Eases are CSS cubic-beziers over the stated window. A curve with a parameter pinned to a bound is not
  quoted as a curve.
- "Bhippi ease" is the best built-in `EaseName` (`src/motion/anim.ts`) with its rmse.

| Move | Frames (dur) | From → to | Curve | rmse | Bhippi ease | Tag |
|---|---|---|---|---|---|---|
| Old item recedes (zoom-through) | 44–49 (5 f) | height ×1 → ×0.40, fading | Accelerating: per-frame ×0.96, 0.91, 0.88, 0.84, 0.61 | — | `expo-in` | [N] |
| New item from the lens (zoom-through) | 50–62 (12 f) | ≈2.5× → 1.0 (bar shadow y 810 → 668 px) | (0.098, 0.657, 0.168, 0.843); 50% at 2 f, 95% at 10 f | 0.005 | `expo-out` | [M] |
| Search typing | 52–76 | 29 chars | About 2 chars/f for the first 6 f, then 1.0 char/f; about 8-char opacity feather | — | linear `start` | [V] |
| "questions" whip arrival: rotation | 127–135 (8 f) | −23.6° → −1.4° (rest) | (0.379, 1.331, 0.691, 0.885); remaining angle halves each frame (×0.61, 0.56, 0.47, 0.36) | 0.005 | **`quart-out`** 0.018 | [R] |
| "Too little" focus pull | 170–180 (10 f) | σ 7.5 → 0 | 55% in the first frame, then linear 0.37 σ/f | — | `hold`+`linear` | [M values] |
| Card fly-in: top-edge tilt | 250–269 (19 f) | −37.4° → 0.2° | (0.136, 1.399, 0.558, 0.945); 95% at 6 f, 2.5% overshoot | 0.005 | `expo-out` 0.057; plan's (0.05, 0.7, 0.1, 1) 0.055 | [M] |
| Card fly-in: scale | 250–269 (19 f) | 1.51× → 1.0 (682 → 453 px height) | **(0.153, 0.559, 0.521, 0.914)**; exponential ×0.843/f, τ = 5.9 f; 95% at 16 f | 0.003 | `cubic-out` 0.057 (plan's curve: 0.199) | [R] |
| Card check-icon y (drift) | 251–269 (18 f) | 368 → 426 px | (0.202, 0.232, 0.407, 0.851) | 0.001 | near-linear | [M] |
| Panel whip-out defocus | 303–314 (11 f) | σ 0 → 4.1 | (0.764, 0.212, 0.488, 0.9) | 0.024 | `ease-in` | [M] |
| Dark bar whip-in: roll, one curve | 317–331 (14 f) | 13.3° → 0.9°, 21.8% overshoot at +5 f | (0.176, **1.5**, 0.206, 1.257), bound hit | 0.018 | spring(12, 0.55) 0.134 | [R] |
| Dark bar whip-in: roll, **as two keys** | 317–322 / 322–331 | 13.3° → −1.8° / −1.8° → 0.9° | key 1: `cubic-out` (rmse 0.025); key 2: (0.207, −0.098, 0.528, 0.91) | 0.003 | `cubic-out` + ease-in-out | [R] |
| Dark bar whip-in: left end x | 318–331 (13 f) | 46 → 326 px | (0.261, 0.825, 0.586, 0.977); 95% at 10 f | 0.001 | `quart-out`-like | [M] |
| Dark bar whip-in: centre y | 316–331 | 311 → 514 px | 50% at 1 f, 95% at 2 f, 9.7% overshoot | — | `back-out` | [M values] |
| Dark bar focus-in | 316–328 (12 f) | σ 3.4 → 0 | Near-linear | — | `linear` | [M values] |
| Tracking collapse | 372–385 (13 f) | width 787 → 54 px | (0.676, −0.102, 0.845, 0.744); flat 3 f, 50% at 11 f | 0.004 | `cubic-in` | [M] |
| Camera truck landing | 446–467 (21 f) | "From" x 1744 → 486 px | (0.449, 0.794, 0.747, 0.971): the **tail** of a 100 f linear truck (f391–491) at about 105 px/f | ≈0 | `sine-out` | [M] |
| "seconds" stream + tracking settle | 531–551 (20 f) | right edge 1006 → 1432 (+56%, f538) → 1279 px | Two phases: 7 f expand at 1 char/f, 13 f settle | — | key 1 linear, key 2 `cubic-out` | [M values] |
| "Collaborate" focus pull | 606–626 (20 f) | σ 13.1 → 0 | Near-linear (50% at 8 f) | — | `linear` | [M values] |
| Drag lag tilt | 636–656 | 0 → +8–10° → 0 | Tilt tracks drag velocity | — | — | [V] |
| Invite push-in (scale) | 716–741 (25 f) | button width ×2.44 | (0.569, −0.007, 0.407, 0.984); 50% at 13 f | 0.007 | `cubic-in-out` | [M] |
| Invite push-in (x, y) | 716–741 | x 1303 → 938, y 628 → 445 | (0.608, −0.078, 0.469, 0.913), (0.588, 0.132, 0.484, 0.967) | 0.007, 0.004 | `cubic-in-out` | [M] |
| "User invited" exit defocus | 786–798 (12 f) | σ 0 → 4.1 | (0.674, 0.727, 0.092, 0.608) | 0.031 | — | [M] |
| Data Room focus pull | 799–815 (16 f) | σ 3.4 → 0 | Near-linear | — | `linear` | [M values] |
| Sparkle shrink to icon | 932–940 (8 f) | 481 → 98 px | Near-linear (−39…−68 px/f), hard stop | — | `linear` | [M values] |
| Sparkle spin | 930–940 | about 0 → 108° | Constant about 14.5°/f, then snaps to rest | — | `linear` | [M values] |
| "AI-Powered" type-on | 955–965 | 8 chars | About 0.8 char/f; the caret leads | — | — | [V] |
| **Star-wake wipe: white coverage** | 1068–1082 (14 f) | 0 → 98.7% of the frame | **(0.659, −0.072, 0.787, 1.085)**; 4% after 4 f, then about +12%/f | 0.009 | `sine-in` 0.057 | [N] |
| Star-wake: star size | 1060–1074 | sqrt(area) 65 → 958 px (edge-clipped) | About +65 px/f, **linear**. The per-frame ratio falls ×1.38 → ×1.03, so it is not exponential | — | `linear` | [N] |
| End-card hold | 1082–1117 | 35 f = 1.17 s | In silence | — | — | [N] |

### 4.2 The grammar in six rules

These are Virgil's defaults.

1. **Orientation locks first; position and scale glide.**
   - Card: tilt 95% at 6 f vs scale at 16 f.
   - "questions": rotation 4 f vs scale/blur about 10 f.
   - Dark bar: y 2 f vs x 10 f.

   In AE terms, the rotation keys are about 2.5× shorter than the scale keys on the same arrival. The
   plan's single "UI entrance" token cannot express this.
2. **Arrivals are exponential, not bezier-S.** The remaining distance shrinks by a constant factor per frame:
   - **×0.84/f** for scale and depth (τ ≈ 6 f);
   - **×0.5/f** for whip rotations.
3. **Overshoot lives on rotation, not on position or scale.**
   - The dark bar's roll overshoots 22%, and the card tilt 2.5%.
   - Scales never overshoot, except the "Approved" pop.
4. **Focus pulls are linear in σ over 10–20 f.** The "cut in defocused" variant does 55% in the first frame.
   - Peak σ is 3–13 px at 1080p, i.e. `gaussian-blur` `blurriness` 7–26 in Bhippi.
5. **Accelerating exits and whips run 10–14 f, ease-in, with defocus to σ ≈ 4.** The next shot enters already
   rotated and blurred: hidden cuts at f50, f127 and f171.
6. **Typing runs at 1 char/f (30 cps).**
   - The first word bursts at about 2 chars/f.
   - The soft edge is about 8 chars.
   - In the dark world, each char arrives with extra tracking that settles in about 13 f.

---

## 5. Design system

### 5.1 Palette

Hexes were sampled from the frames [N] unless tagged [notes].

**LIGHT world (problem, and features on UI)**

| Role | Hex |
|---|---|
| Background | `#FFFFFF`, with drifting mesh blobs: sage `#DFE9E4` bottom-left, ice-blue `#E6F0F4` bottom-right |
| Ink | "little" `#242424`, "Too" `#626262` (de-emphasised word = the grey step) |
| Sage-teal type ramp, dark → light | `#15373D` (logo) · `#173439` ("time") · `#3A5754` ("seconds") · `#56796F` ("Collaborate", [notes]) · `#6F8F85` → `#C8D5D0` ("questions" gradient, [notes]) · `#8AA39B` (placeholder text and search icon, [notes]) |
| Ribbon | `#D3E5FD` |
| Focus ring | `#DCE2F9` |
| Selection ring | `#CFE6F5` [notes] |
| Badge green | `#418C6B` |
| "Approved" green | `#1F9A42` |
| Alert red (check icon, dots) | `#F22531` |
| Yellow accent dot | `#F2C94C` [notes] |
| Confetti | `#628F7D`, `#153940`, `#42846B`, pale blue `#CFE0FF` [notes] |

**DARK world (product proof)**

| Role | Hex |
|---|---|
| Background | Slate `#232C33`–`#273138`. This is **blue-grey slate, not near-black violet** |
| Grid | 1 px lines only about 2–3 levels above the bg (≈4–6% white), 130 px pitch at the f990 zoom, small plus marks at crossings; it is world-space and scales with the camera |
| Glow behind the hero element | Sage radial, edge `#2E3C41` → core ≈ `#4E6664` [notes]; slowly drifting |
| AI glyph | Magenta `#B658BD` ("AI-Powered", sparkle) |
| "Trusted" | Violet `#8E47DB` (f828) → red `#CB3845` / plum `#A43F79` (f836) |
| "sources" | Coral `#E18668` → red `#DC5358` |
| "Investor" | Lavender `#D7B0F6` |
| "Relations" | `#B27BEC` → `#8E48DD` |

### 5.2 Type

These are visual IDs, so confirm by A/B against the f200 and f836 crops.

| Use | Look | OFL stand-ins |
|---|---|---|
| Display (all story words) | Light/regular **geometric sans**, round o, single-storey q, **slant-cut t terminals**; Gilroy-like | **Outfit**, **Urbanist** or **Lexend**. Pick one per brand; don't mix |
| Search placeholder | The same family at SemiBold, sage | — |
| UI screens | Neutral grotesk; the chat field is **italic** | **Inter** (regular, semibold, italic) |
| Logo | Custom V (heavy left stroke + sage triangle flag) + semibold wide geometric caps "IRGIL" | Montserrat SemiBold for comps only; the real logo is an SVG |

### 5.3 Shape language

- **Light search bar.** Rounded rect with radius ≈ 30% of its height (not a full capsule). Long soft neutral
  shadow: blur about 60 px, y about 15–20 px, about 15% black.
- **UI cards and modals.** Radius ≈ 10% of card height (about 12–16 px at UI scale). A 1 px hairline
  border, and almost no shadow in the dark world.
- **Dark search bar.** Full capsule, white, with a **translucent bezel ring about 10 px wide at about 35% white**.
- **Pills.** Full capsule ("Needs Approval", "Approved").
- **Badges.** Spheres (glass orb, glossy check sphere).
- **Confetti.** Sharp-cornered rectangles, 2:1–3:1.

### 5.4 Depth and light rules

- **Light world:** shadows plus DOF, no glow.
- **Dark world:** glow plus grid, no shadows.
- **Both worlds:** the right 40% of any hero UI **fades into the background**, so UI never ends in a hard
  edge on the right.

---

## 6. Sound design

### 6.1 Structure measured from `audio.wav` [N]

| Section | Frames | What happens | Level |
|---|---|---|---|
| Intro, 4 bars | f1–249 | Sparse tonal plucks, 22% onset coverage. High band (5–12 kHz) rises **+16 dB** from −51 dB (f1–80) to −35 dB (f241–249): a riser into the drop | RMS −17…−20 dBFS |
| **Drop** | 8.340 s = f250.9 | Steady 8th-note groove at **115.0 bpm** (101/115 onsets on the grid, mean residual 3.6 ms). 16th pickups at the same bar positions every bar | RMS **−11.5 dBFS** (+8 dB) |
| **Breakdown** | bar 13, about f1003 | High band −30 dB and low band −35 dB: the drums drop out under "Investor Relations" | — |
| **Sub swell** | f1057, peak f1067–1071 | Low band (<150 Hz) +40 dB, around the bar-14 downbeat (f1064), under the star wake | — |
| **Hard stop** | f1083 | Below −40 dB, then −70 to −95 dB. **The logo holds in silence** | — |

**No separate SFX layer is detectable.**
- The high band follows the hi-hat pattern through the whips (f303–315) and the click (f740).
- Nothing spikes at the click frames.
- There is no bright transient under the typing (the intro high band stays at −51 dB).
- The film is music-only. Its "sound design" is edit-to-music structure, not cues.

### 6.2 Cuts vs music, calibrated

**All 4 hard cuts sit on onsets, but that is weak evidence.**
- 45% of all frames are within ±2 f of an onset by chance; after the drop it is **56%**.
- So 4/4 is p ≈ 0.04–0.1. The notes' "4/4 = real" overstates it.

**Beat positions are the stronger evidence.** A beat is 15.6 f, so a ±2.4 f window is hit 37% of the time by
chance.

| Frame | Event | Beat position |
|---|---|---|
| f50 | Zoom-through | i1 beat 4 (+2.4 f) |
| **f127** | Whip arrival | **i3 beat 1 (+1 f)** |
| f171 | Defocus cut-in | i3 beat 4 (−1.8 f) |
| f205 | Rings pop | i4 beat 2 (+1 f) |
| **f250** | Hard cut | **the drop** |
| f315 | Hard cut | bar 2 beat 1 (+1.6 f) |
| f349 | Hard cut | bar 2 beat 3 + a 16th (on a 16th pickup onset, off the quarter grid) |
| f799 | Hard cut | bar 9 beat 4 (−0.9 f) |

- **7 of 8 transitions land on quarter-note beats, p ≈ 0.005.** The events were chosen after looking, so
  treat this as strong but not conclusive.
- **Hidden cuts in the intro are on the beat**, including the whip arrival on the intro bar-3 downbeat.

**Hard claims.**
- **The dark world starts on the drop.** The cut leads the onset by 0.8 f.
- **The positioning line sits in the breakdown.**
- **The logo resolves as the music stops.**

**Move starts inside shots are loose.** They fall within ±2.5 f of a beat or an 8th about as often as chance
(64% on an 8th grid of 7.8 f). Don't teach move-level beat sync.

### 6.3 For Bhippi

- This film argues for a **`sfx: 'music-only'` style-pack mode**, the opposite of P9's "every UI action
  emits a cue".
- The music analysis must return a **bar/beat grid, drop, breakdown and stop**, not just onsets.

---

## 7. What Bhippi needs

### 7.1 Already covered by the plan

These are used by this film; see REFERENCE-FILMS-PLAN §4:

- **P2:** `TypeOn` (`feather`, `script`, `caret: 'glyph:<id>'`), `fill: Paint`, `cascade.exit.order`,
  the `collapse-to-point` / `expand-from-point` presets.
- **P3:** the `ui` layer, `UiAction`s (`type`, `click`, `drag {lag}`, `highlight/pulse`, `state`), hand cursor,
  `camera.push`.
- **P4:** `scene.guide` (`path`, `trail`, roles `cursor | caret | wipe`), transitions (`zoom-through`, `whip`,
  `collapse-into`, `shape-wipe`), depth-driven blur, world layout.
- **P5:** `particles` confetti.
- **P6:** `solid2_5d` `sphere | coin`, `look: 'glass' | 'glossy'`, decals.
- **P7:** `glass-orb`.
- **P9:** drops and downbeats.
- **P10:** `motion_guide`, `TIMING`.

### 7.2 Corrections and additions, in `src/motion/types.ts` terms

**1. DOF: wire the existing fields; don't add `scene.dof`.**
- `camera.focus` and `camera.aperture` are already in the type (`types.ts:262`) and evaluated
  (`evaluate.ts:193`), but nothing in `gl/` reads them.
- P4's proposed `scene.dof` would create a second, competing API.
- Instead, implement per-`threeD`-layer circle-of-confusion blur from the existing camera fields:
  σ = aperture × |z − focus| / z. Add `LayerCommon.dof?: boolean` as the opt-out.
- Rack focus = keys on `camera.focus`. Size M.

**2. Text tracking anchor and units.**
- Today `TextAnimator.props.tracking` is **px, left-anchored** (`text.ts:271`), but
  `TextLayerData.tracking` is **1/100 em** (`text.ts:118`). The AI will get one of them wrong.
- Add `TextAnimator.trackingAnchor?: 'start' | 'center' | 'end'`, defaulting to the layer's `align`, and move
  animator tracking to 1/100 em.
- `collapse-to-point` then becomes one animator. Size S.

**3. Cross-layer links (the AE pick-whip).** Expressions cannot see other layers (map fact 4), and four of
Virgil's signature moves need exactly that:
- letters eaten by the orb;
- "seconds" emerging from the orb;
- the ribbon trim following the orb;
- the caret riding the text.

The proposed field:

```ts
// LayerCommon += 
links?: { to: string /* 'transform.position' | 'text.animators.0.start' | 'masks.0.box' | 'shape.trimEnd' */;
          from: { layer: string; prop: 'position.x' | 'position.y' | 'position' | 'scale' | 'rotation' | 'progress'; map?: [number, number, number, number] } }[];
```

- Resolve it in `evaluate.ts` in dependency order (topological, cycle = validation error).
- P4's `guide.roles` should compile down to `links`, so the guide is sugar, not a special case.
- **Reconcile with P2.** The plan cites inline spans for "Virgil's orb eating letters". That is the wrong
  tool: eating is a moving matte or range edge driven by the orb's x, not an inline object in the text.
- Size M.

**4. `TextCascade` additions.**
- `order?: 'forward' | 'reverse' | 'random'` for the entrance too (P2 has it only on `exit`).
- `origin?: { layer: string } | Vec`: units start at a point or layer and slide to their slots ("seconds" from
  the orb).

Size S.

**5. `ProceduralKind += 'relief-rings'`.**
- Params: `{ rings: number; radii: Prop<Vec>; width; light: Vec; color; highlight; shadow }`.
- A shader lights a height field of concentric bevelled rings (V9).
- It is cheaper and more exact than P1 bevel styles on an ellipse repeater, and it doubles as the WasteProtection
  and Solair ring backdrop.

Size S.

**6. UI additions on top of P3.**
- `UiAction += { type: 'drop-into'; source: string /* layer id */; target: string; t; duration? }` (V17).
- `ui.style.edgeFade?: { side: 'right' | 'left' | 'bottom'; width: number }` (V4, a genre token).
- A `grab` cursor state while dragging, and `press` depth for clicks: measured 2 f.

**7. Transitions on top of P4.**
- `pull-back-to-parent` (V13): the camera pulls back while the parent UI slides in, and the detail becomes
  one of its parts.
- `wake-wipe` (V39): a guide glyph drags a feathered stroke whose width grows until it covers the frame. The
  stroke is the matte for the incoming scene. Coverage ease is (0.659, −0.072, 0.787, 1.085) over about 14 f.

**Fix the `zoom-through` spec to the measurement.**
- The old element: ease-in shrink ×0.4 over 4–5 f plus fade.
- **A hidden cut, with no overlap frame.**
- The new element: 2.5× → 1 with 50% at 2 f and 95% at 10 f.

**8. `particles` confetti preset on top of P5.**
- `emitter: 'top-edge'` (a shower) as well as `point` (a burst).
- Colours from the brand kit.
- `z` spread feeding item 1's DOF.
- Per-piece 3D tumble.

**9. Timing tokens (P10 `TIMING`).** Add:
- `settle.orientation` = 4–6 f, `settle.scale` = 16 f (the split settle);
- `arrival.decay` = 0.84/f;
- `whip.arrivalRotation` = `quart-out` over 8 f from about −24°;
- `focusPull` = linear σ over 10–20 f, with the `cutInDefocused` variant (55% in the first frame);
- `type.burst` = 2 chars/f for the first word;
- `endCard.silence` = true for launch films.

**10. Reference analysis (P10 worker). Add:**
- **hidden-cut detection:** a content-identity switch inside a motion burst (the kit found 5 shots; there are
  8 shots and 7 edits);
- **σ curves** (`blur_sigma_series` already works);
- a **working typing-rate detector** (the kit's measured the bar's right edge, not the text);
- **constrained fits with key splitting at extrema:** an overshoot becomes two keys, as an animator would
  key it; a single bezier either hits its bounds or smooths the overshoot away;
- the **bar/beat grid** from onsets (the fit used here: search period and phase, then least squares).

### 7.3 Templates

These are NEW, in `kit/`. Each is one scene with a guide.

| Template | Beats | Params |
|---|---|---|
| `search-stack-whip` | 2–4 | Typing bars that stack, tilt, gain DOF and whip into a word | `queries[]`, `word`, `theme` |
| `word-ripple-push` | 5–6 | A phrase plus relief rings, then a push into the disc ending on a cut | `phrase`, `accentWord` |
| `ui-card-to-panel` | 7–9 | Card fly-in (split settle), pull-back to parent, whip-out | `card`, `panel` UI assets |
| `field-to-orb` | 10–13 | A bar drops into a field, its text collapses into the guide orb, and the orb flies on a path with a ribbon across a world gradient | — |
| `orb-word-swap` | 14–16 | "From X to Y": crash-replace, the orb eats letters, becomes a badge, coin-flips, streams the new word, then eats it on exit | — |
| `rack-focus-feature` | 17–18 | A word plus a UI action with the focus moving between them | — |
| `cta-push-confetti` | 19–20 | — | — |
| `sparkle-caret-line` | 23–25 | — | — |
| `wake-wipe-logo` | 26–27 | — | — |

All of them build on P3 and P4. The first three can ship earlier with today's keys.

### 7.4 AI knowledge

`motion_guide {topic:"product-launch"}` gets a **Virgil chapter**:
- **Beat recipe:** problem hook in a light world (4 bars) → drop cut to the dark product world → a continuity
  object carries the promise line → 2–3 features on the UI with rack focus → proof → AI glyph line in the
  breakdown → logo on the stop, in silence.
- **Rules:**
  - Type becomes UI, or comes out of UI.
  - One continuity object.
  - Hide cuts inside whips and zooms on quarter beats.
  - Hard cuts only for world switches.
  - Orientation first, scale later.
  - Every UI plane is tilted and depth-blurred.
  - The right edges of UI fade out.
  - No SFX when the music carries it.

### 7.5 Assets

- **Fonts** (P2 bundle): Outfit or Urbanist (display), Inter (UI).
- **Icons** (P1 Lucide, ISC): `search`, `check`, `sparkle`/`sparkles`, `hand`, `grab`, `mouse-pointer-2`,
  `circle-check`, `upload`, `x`, `chevron-down`.
- **Shapes:** the concave 4-point sparkle, as a P1 bezier path.
- **Blender presets** (P7). Draft EEVEE for layout, Cycles for finals.
  - `glass-orb`: a teal-tinted refractive sphere with an optional glyph decal and a coin mode (flattened
    cylinder, rotY key). Render it **along the guide path in camera space**, so the environment reflections
    slide as in the film. A turntable sprite is the cheaper fallback.
  - `check-sphere`: a glossy green sphere with an embossed check.
  - Optional: `relief-rings` as a clay render if the shader in item 5 is deferred.
  - Everything else in this film is 2D.

---

## 8. Recreate recipe: the best 10 s (f250–549, "dark card → field collapses into orb → to seconds")

Scene t = 0 is f250, on the drop; t = (f − 250) / 29.97. This is also the plan's §6.3 golden beat without the
intro.

### 8.1 Tool calls

- **Exists** means it works today.
- **NEW** means the plan adds it.
- **NEW (here)** means this report adds it.

| # | Call | Status |
|---|---|---|
| 1 | `motion_guide {topic:"product-launch", beat:"dark-act"}` | NEW (P10) |
| 2 | `analyze_music_beats {clip}`, which returns `grid {bpm:115, t0:8.340}` and `sections [{kind:"drop", t:8.34}, {kind:"breakdown", t:33.4}, {kind:"stop", t:36.1}]` | exists; the grid and sections are NEW (P9) |
| 3 | `create_ui_screen {kind:"card", theme:"light-on-dark", content:{title:"Marketing Presentation", icon:"alert-check", progress:0.1}}` | NEW (P3) |
| | `create_ui_screen {kind:"checklist", content:{title:"Diligence Checklist", rows:[…]}}` | NEW (P3) |
| | `create_ui_screen {kind:"search", theme:"dark-glass"}` | NEW (P3) |
| | `create_ui_screen {kind:"chat", brand:"virgil"}` | NEW (P3) |
| 4 | `create_3d_scene {preset:"glass-orb", params:{tint:"#457E82", decal:"S", coinAt:9.38}}` and `render_3d_scene {quality:"draft"}` | NEW (P7); or P6 `solid2_5d`, no render |
| 5 | `create_motion_scene {scene: …}` (§8.2) | exists; NEW fields marked |
| 6 | `snap_cuts_to_beats {clips:[this], to:"beats"}` for the internal cuts at 2.17 s and 3.30 s | exists |
| 7 | `run_frame_qa` + pacing QA against §4 | exists; pacing is NEW (P10) |
| 8 | `consult_council {seats:["animator","director"]}` | exists |
| — | **No `add_sound_effect`**: music-only style | — |

### 8.2 MotionScene sketch (JSONC)

Eases are the measured ones. `// NEW` marks fields that are not in `types.ts` today.

```jsonc
{
  "version": 1, "width": 1920, "height": 1080, "duration": 10, "background": "#232C33",
  "motionBlur": { "samples": 12, "shutter": 180 },
  "guide": { "layer": "orb", "path": "orbPath", "trail": { "layer": "ribbon", "taper": [1.0, 0.45] },          // NEW (P4)
             "roles": [ { "t": 7.57, "as": "wipe", "target": "wordTo" } ] },
  "transitions": [                                                                                        // NEW (P4)
    { "type": "whip", "at": 1.835, "duration": 0.334, "out": "panel", "in": "darkBar", "arrivalRotation": 13.3 },
    { "type": "drop-into", "at": 3.303, "source": "darkBar", "target": "chat#message" },                  // NEW (here)
    { "type": "collapse-into", "at": 4.071, "duration": 0.434, "text": "prompt", "into": "orb", "ease": [0.676,-0.102,0.845,0.744] }
  ],
  "layers": [
    { "id": "cam", "type": "camera", "zoom": 1800,
      "pointOfInterest": { "k": [ { "t": 4.705, "v": [960,540,0], "ease": "linear" },                   // 100 f truck ≈105 px/f
                                  { "t": 6.540, "v": [3130,540,0], "ease": [0.449,0.794,0.747,0.971] },
                                  { "t": 7.241, "v": [3500,540,0] } ] },
      "focus": { "k": [ { "t": 0, "v": 1800 } ] }, "aperture": 18 },                                     // exists, but render wiring is NEW (§7 item 1)
    { "id": "grid", "type": "procedural", "kind": "grid", "threeD": true, "size": [5760,1080], "out": 6.0,
      "params": { "bg": "#232C33", "color": "#FFFFFF0E", "spacing": 130, "line": 1 } },
    { "id": "world", "type": "procedural", "kind": "linear-gradient", "threeD": true, "size": [5760,1080], "in": 4.5,
      "transform": { "position": [2880,540,0] },
      "params": { "from": "#232C33", "via": "#9EA3A8", "to": "#FFFFFF", "angle": 90 } },                  // dark→white in world space (V23)
    { "id": "glow", "type": "procedural", "kind": "radial-glow", "out": 3.3,
      "params": { "inner": "#4E6664", "outer": "#232C3300", "radius": 0.45 } },
    { "id": "card", "type": "ui", "threeD": true, "motionBlur": true, "out": 1.535,                       // NEW layer type (P3)
      "ui": { "source": { "asset": "ui/marketing-card" }, "style": { "edgeFade": { "side": "right", "width": 0.4 } },  // edgeFade NEW (here)
              "actions": [ { "t": 0.2, "type": "count", "target": "#progress", "to": 45, "duration": 1.0 } ] },
      "transform": {
        "rotationY": { "k": [ { "t": 0, "v": -35, "ease": [0.136,1.399,0.558,0.945] }, { "t": 0.634, "v": 0 } ] },  // tilt: 95% at 6 f
        "rotation":  { "k": [ { "t": 0, "v": -8,  "ease": [0.136,1.399,0.558,0.945] }, { "t": 0.634, "v": 0 } ] },
        "scale":     { "k": [ { "t": 0, "v": 151, "ease": [0.153,0.559,0.521,0.914] }, { "t": 0.634, "v": 100 } ] }  // scale: 95% at 16 f
      } },
    { "id": "panel", "type": "ui", "threeD": true, "in": 1.034, "out": 2.169,
      "ui": { "source": { "asset": "ui/diligence-checklist" } },
      "transitionIn": { "type": "pull-back-to-parent", "child": "card", "part": "row:1", "duration": 0.5 },   // NEW (here)
      "effects": [ { "type": "gaussian-blur", "blurriness": { "k": [ { "t": 1.835, "v": 0, "ease": [0.764,0.212,0.488,0.9] }, { "t": 2.135, "v": 8.2 } ] } } ] },  // σ 0→4.1
    { "id": "darkBar", "type": "ui", "threeD": true, "motionBlur": true, "in": 2.169, "out": 3.537,
      "ui": { "source": { "asset": "ui/search-dark-glass" },
              "actions": [ { "t": 2.30, "type": "type", "target": "#q", "text": "…breakdown of Fund I.", "cps": 30 } ] },
      "transform": { "rotation": { "k": [ { "t": 2.236, "v": 13.3, "ease": "cubic-out" },               // key 1: overshoot at +5 f
                                          { "t": 2.402, "v": -1.8, "ease": [0.207,-0.098,0.528,0.91] },  // key 2: settle 9 f
                                          { "t": 2.703, "v": 0.9 } ] } },
      "effects": [ { "type": "gaussian-blur", "blurriness": { "k": [ { "t": 2.169, "v": 6.8, "ease": "linear" }, { "t": 2.570, "v": 0 } ] } } ] },
    { "id": "chat", "type": "ui", "threeD": true, "in": 3.303, "out": 5.8,
      "ui": { "source": { "asset": "ui/virgil-chat" },
              "actions": [ { "t": 3.57, "type": "pulse", "target": "#message", "color": "#DCE2F9" } ] } },
    { "id": "prompt", "type": "text", "in": 3.537, "out": 4.505, "parent": "chat",
      "text": { "text": "Summarize the investor type breakdown of Fund I.", "font": "Inter", "italic": true, "weight": 400,
                "size": 30, "color": "#2B2F33", "align": "center",
                "animators": [ { "props": { "tracking": { "k": [ { "t": 4.071, "v": 0, "ease": [0.676,-0.102,0.845,0.744] },
                                                                  { "t": 4.505, "v": -100 } ] } },          // 1/100 em (NEW unit)
                                 "trackingAnchor": "center" } ] } },                                          // NEW (here); today: add position +(n−1)/2·tracking
    { "id": "orbPath", "type": "shape", "hidden": true, "in": 5.0, "out": 7.6,
      "shape": { "shape": "path", "curve": true, "points": [1100,560, 1500,300, 2100,700, 2700,420, 3380,300, 3470,470] } },
    { "id": "ribbon", "type": "shape", "threeD": true, "in": 5.0, "out": 8.2,
      "shape": { "shape": "path", "curve": true, "points": [1100,560, 1500,300, 2100,700, 2700,420, 3380,300, 3470,470],
                 "stroke": "#D3E5FD", "strokeWidth": 70, "cap": "round", "taper": { "start": 1, "end": 0.45 } },   // taper NEW (P1)
      "links": [ { "to": "shape.trimEnd", "from": { "layer": "orb", "prop": "progress", "map": [0,1,0,100] } } ],       // NEW (here)
      "effects": [ { "type": "gaussian-blur", "blurriness": 6 } ] },
    { "id": "orb", "type": "footage", "in": 4.471, "out": 10,
      "source": { "sequence": { "dir": "3d/glass-orb", "fps": 29.97, "frames": 166 } },                    // NEW (P7 FootageSource.sequence)
      "follow": { "path": "orbPath", "progress": { "k": [ { "t": 5.038, "v": 0, "ease": "linear" },       // NEW (P4 guide/path)
                                                         { "t": 7.241, "v": 0.93, "ease": [0.449,0.794,0.747,0.971] },
                                                         { "t": 7.574, "v": 1 } ] } },
      "transform": { "scale": { "k": [ { "t": 4.471, "v": 20 }, { "t": 5.0, "v": 45 }, { "t": 8.141, "v": 75 }, { "t": 8.742, "v": 60 } ] } } },
    { "id": "fromWeeks", "type": "text", "in": 6.2, "out": 7.6,
      "text": { "text": "From weeks", "font": "Outfit", "weight": 300, "size": 120, "color": "#111111",
                "animators": [ { "by": "char", "shape": "ramp-down", "smoothness": 3,
                                 "start": { "k": [ { "t": 7.374, "v": 100 }, { "t": 7.608, "v": 0 } ] }, "props": { "opacity": 0 } } ] } },
    { "id": "wordTo", "type": "text", "in": 7.374, "out": 8.2,
      "text": { "text": "to", "font": "Outfit", "weight": 300, "size": 120, "color": "#111111" },
      "transform": { "scale": { "k": [ { "t": 7.374, "v": 130, "ease": "quart-out" }, { "t": 7.508, "v": 100 } ] } },
      "effects": [ { "type": "gaussian-blur", "blurriness": { "k": [ { "t": 7.374, "v": 14, "ease": "quart-out" }, { "t": 7.508, "v": 0 } ] } } ],
      "matte": { "layer": "eatMask", "mode": "alpha" } },
    { "id": "eatMask", "type": "shape", "hidden": true, "in": 7.374, "out": 8.2,
      "shape": { "shape": "rect", "size": [2000, 400], "fill": "#FFFFFF" },
      "links": [ { "to": "transform.position", "from": { "layer": "orb", "prop": "position.x", "map": [0,1920,1000,2920] } } ] },  // NEW (here): mask edge rides the orb
    { "id": "ring", "type": "shape", "in": 8.242, "out": 8.842, "parent": "orb",
      "shape": { "shape": "ellipse", "size": [120,120], "fill": null, "stroke": "#DEEAEA", "strokeWidth": 14 },
      "transform": { "scale": { "k": [ { "t": 8.242, "v": 60, "ease": "expo-out" }, { "t": 8.742, "v": 160 } ] },
                     "opacity": { "k": [ { "t": 8.642, "v": 100 }, { "t": 8.842, "v": 0 } ] } } },
    { "id": "seconds", "type": "text", "in": 9.376,
      "text": { "text": "seconds", "font": "Outfit", "weight": 300, "size": 120, "color": "#3A5754",
                "cascade": { "by": "char", "stagger": 0.0334, "duration": 0.2, "ease": "cubic-out",
                             "origin": { "layer": "orb" },                                                    // NEW (here)
                             "from": { "opacity": 0, "blur": 6 } },
                "animators": [ { "props": { "tracking": { "k": [ { "t": 9.376, "v": 0 }, { "t": 9.610, "v": 30, "ease": "cubic-out" }, { "t": 10.04, "v": 0 } ] } },
                                 "trackingAnchor": "start" } ] } }                                            // +56% right-edge overshoot → settle 13 f
  ],
  "cues": []                                                                                                  // music-only style: no SFX
}
```

### 8.3 What still has to be keyed by hand after the NEW fields land

- The glass orb's refraction (Blender).
- The coin flip at 9.38 s (a Blender action, or P6 `solid.rotation3`).
- The depth-blurred window rising at 3.30 s. The P3 `ui` layer covers it once DOF is wired.

---

## 9. Top 10 improvements

The first five unlock the most of this film per unit of work.

| # | Improvement | Size | Unlocks |
|---|---|---|---|
| 1 | **Wire camera DOF**: circle-of-confusion blur per `threeD` layer from the existing `camera.focus` / `aperture`, and drop P4's duplicate `scene.dof` | M | V5, V28, V31, and every tilted UI plane. Rack focus becomes one key track |
| 2 | **Cross-layer `links`** (a pick-whip) evaluated in dependency order; P4 guide roles compile to it | M | V22, V25, V27, V37: orb ribbon, letter eating, stream-out, caret |
| 3 | **Tracking animator: 1/100 em units + `trackingAnchor`**, with `collapse-to-point` / `expand-from-point` presets | S | V19, V27, V34, and the Workly and Solair tracking slams |
| 4 | **Split-settle timing tokens** (orientation 4–6 f vs scale 16 f; exponential ×0.84/f; whip rotation `quart-out` over 8 f; linear σ focus pulls) in `kit/common.ts` `TIMING`, replacing the single "UI entrance" bezier | S | Every arrival in the film; fixes §2.1 of the plan |
| 5 | **Music structure in `analyze_music_beats`**: a bar/beat grid (the period+phase fit used here), drop, breakdown and stop; anchors `t:{drop:1}` / `{section:"stop"}`; a `sfx:"music-only"` style mode | S | The world switch on the drop, the logo on the stop in silence, hidden cuts on beats |
| 6 | **P3 `ui` layer with `drop-into`, `drag {lag}`, `click → state`, `pulse`, and `edgeFade`** | L | V11–V18, V29, V30, V33, V35 |
| 7 | **Transitions as data**: `zoom-through` (hidden cut; corrected numbers), `whip` with match-rotation, `pull-back-to-parent`, `wake-wipe` | M | V2, V6, V13, V15, V39 |
| 8 | **Text fill paint with animated hue/stops** + `cascade.order` (in and out) + `cascade.origin` | S–M | V1, V7, V34, V38 |
| 9 | **Glass orb / coin / check sphere**: P6 `solid2_5d` glass + coin for preview, P7 `glass-orb` along the camera-space path for finals | M (P6) / L (P7) | V20, V26, V27, V31 |
| 10 | **`relief-rings` procedural + P5 confetti `top-edge` shower with z-spread** | S + M | V9, V31 |

---

## Appendix A. Corrections to REFERENCE-FILMS-PLAN.md for this film

| Where | Plan says | Measured |
|---|---|---|
| §1 | "Virgil cuts: 4/4 against 45%" as proof of sync | After the drop, chance is 56%, so 4/4 is only p ≈ 0.04–0.1. The strong evidence is **beat position**: 7 of 8 transitions (including 3 hidden intro cuts) are on quarter beats, p ≈ 0.005, plus the drop, breakdown and stop alignment |
| §2.1 UI entrance | 12–20 f, ≈ (0.05, 0.7, 0.1, 1), "Virgil card fly-in 18–19 f" | That curve fits the card's **tilt** (rmse 0.055) but not its **scale** (rmse 0.199). Scale is exponential ×0.843/f, (0.153, 0.559, 0.521, 0.914), 95% at 16 f. A split-settle token is needed |
| §2.1 Camera push/settle | Ease-in-out (0.6, 0, 0.4, 1), "Virgil truck settle 21 f" | The Invite push is ease-in-out (confirmed). The truck is a **100 f linear cruise + 21 f ease-out landing**, not ease-in-out |
| §2.1 Typewriter | Newest char over 2–3 f, accent-colour wake | Virgil: 1 char/f after a 2 chars/f burst; an **opacity feather of about 8 chars**; no accent colour. Dark world: a per-char tracking settle instead |
| §2.1 Focus pull | 3–15 f, blur peak about 20 px; "Too little" 3 f | 10–20 f, **linear in σ**, peak σ 3–13 px (`blurriness` 7–26). "Too little" does 55% in the first frame and is fully sharp at 10 f |
| §2.1 Zoom-through | 7 f | Arrival confirmed (95% at 10 f, most in 2–7 f). Add that it is a **hidden cut with no overlap**, and the old element's shrink is **ease-in** |
| §2.1 Shape wipe | ×1.25/f exponential, "Virgil f1059–1081" | Virgil's star grows about linearly (+65 px/f). **The white wake covers the frame**, not the star: an ease-in over 14 f |
| §2.2 SaaS light | Lavender `#eef0f6`–`#dde3f3`, accent blue/indigo, Inter-like | Virgil light: white + sage/ice-blue mesh blobs, a sage-teal ramp, and a geometric (Gilroy-like) display face. No blue |
| §2.2 SaaS dark | Near-black violet `#07030d`–`#0c0c0c` | Virgil dark: **slate `#232C33`**, sage glow, world grid. The violet/magenta is only in type and the sparkle |
| §2.3 T4 | "camera DOF exist" | The `focus`/`aperture` fields exist but are **never rendered** |
| §3.2 step 2 | "rotation −20 → 0 in 11 f" | −23.6° → 0 with 95% in **4 f** (`quart-out` over 8 f). About 10 f is the whole settle (scale, blur, late chars) |
| §3.2 step 7 | "confetti burst" | A **shower from the top edge** |
| §3.2 omissions | — | The dark → white switch is a **world-gradient camera truck**, not a cut. The orb eats letters twice (f477 and f577, the second being the exit into Collaborate). The breakdown carries "Investor Relations". The end card sits in **silence**. Right-edge UI fades. Neumorphic relief rings (in no T-row or pillar). T6 (tracking type-on) belongs in §3.2 "Needs" |
| §3.2 rebuild | "dark act, 10 s" uses zoom-through + confetti + drop snap | Those beats are 23 s apart. `snap_cuts_to_beats {at:"drop"}` is not marked NEW, and today it snaps to onsets only. Use the contiguous f250–549 recipe in §8 |
| §4 P2 | Inline spans for "Virgil's orb eating letters" | Eating is a matte or range edge driven by the orb, so it needs cross-layer `links` (§7.2 item 3), not inline spans |
| §4 P4 | New `scene.dof` | Wire the existing camera fields instead |
| §4 P9 | Every UI action emits a cue | This reference is music-only. Add a style-pack switch |

## Appendix B. Method notes

- **Verification.** 16 labelled sheets from `out/b1GDr86JW3M/frames/` at the frames listed in §2, plus a type
  crop sheet and a typing-rate strip.
- **Refits.** Scripts are in the session scratchpad, not tracked. They reuse `measure_moves.py`'s
  `bez_y_at_x` with bounds x ∈ [0, 1] and y ∈ [−0.5, 1.5].
  - **Card scale:** f250 is blur-inflated, so its value is extrapolated from the exponential tail (ratio
    0.843/f).
  - **"questions" rotation:** re-measured from f127 with a looser threshold for the blurred frames. The rest
    angle is the f133–140 mean (−1.4°), since per-char fade-in biases the principal axis.
  - **Dark-bar roll:** starts at f317; f316 is the streak frame.
- **New measurements.**
  - Star-wake white coverage: lum > 225 and saturation < 40.
  - Magenta star sqrt(area): OpenCV hue 135–165.
  - "Too many" dark-pixel extent.
  - Palette: medians of the top 3–20% ink pixels per ROI.
  - Grid pitch: column-profile peaks.
  - Audio: STFT band energies per frame; an 8th-grid fit over the post-drop onsets.
- **Unreliable saved fits, not used as curves:**
  - "questions" width and centre x (the extent picks up blur and ghost letters);
  - sparkle centre x (object switch at f940);
  - drag tilt (edge noise);
  - "Tag" σ;
  - typing rate (measured the bar's edge);
  - card check-icon x (y1 on bound).
