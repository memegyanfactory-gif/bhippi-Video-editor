# J6A7JcbkWvM · WasteProtection AI SaaS launch (ObiN Studio)

*Video study, 2026-09-25. 73.4 s (2202 frames), 30 fps, 1280×720 source, music only (no voice-over).
The primary source is the saved frame-by-frame pass (`out/J6A7JcbkWvM/notes.md`). I checked its key
claims on 20 individual frames and took new measurements of three signature moves
(`measure_signature.py`, `measure_hover.py`, `measure_header.py`, `fits2.py`). I also ran the earlier
analyst's `measure_moves.py`: its logo-ring, map→card and phone series are usable, but its "Arlo" track
is not (see §4.3).*

**Conventions used throughout:**
- Frames are 1-based: f1 is t = 0, and t = (f − 1)/30.
- **Pixels are @720 (the source resolution) unless marked @1080** (×1.5). H = frame height.
- Beziers are `cubic-bezier(x1, y1, x2, y2)` fitted to the normalised travel, with x1 and x2 held in
  [0, 1]. "rmse" is the fit error on the normalised curve. f50 and f90 are the frames needed to reach
  50 % and 90 % of the travel.

---

## 1. What the film is

**What it is.** This is a launch film for "WasteProtection", an AI waste-management SaaS with a
dashboard, route maps, IoT bins, and an assistant called "Arlo". It is carried by music, with no VO,
and by type: every section opens with a giant word or a typed line and then proves it on product UI.
It is **long for the genre** (73 s, 17 shots split by 16 detected cuts, mean shot 4.3 s), yet it feels continuous
because most beat changes are transitions inside a shot: type-through, pans, whips, morphs, and
shockwave wipes.

**Two worlds.** The plan files this film as "dark AI". About **43 % of the runtime is the light UI
world**, so the style pack has to cover both.

| World | Share | Frames |
|---|---|---|
| Dark violet mesh (near-black with drifting violet and lilac blobs) | ≈ 57 % | f1–385, f908–1052, f1163–1561, f1837–2162 |
| Light lavender UI world (`#efedf2`, lilac corner glows, purple gradient stage) | ≈ 43 % | f386–907, f1053–1162 (map card on white), f1562–1836, f2163–2202 (end card) |

**How the runtime splits by mode.**
- **UI and devices** take about 50 %: the dashboard walkthrough, the map, the chat box, the phone, and the skeleton UI.
- **Kinetic type** takes about 30 %: typing, type-through, glyph converge, the three giant-type pans, and word assembles.
- **Brand motifs** take about 20 %: the sparkle, the waveform, the photo grid, the pill wall, the globe and the logo.

**Structure (a feature-tour launch).**
1. Claim (typed).
2. "Built for real-world operations".
3. "Powered by AI".
4. Name reveal (giant type → ring title).
5. Product proof on the dashboard (≈ 17 s).
6. Problem: alerts on the map, then "But what happens next?".
7. The AI assistant (Arlo: chat, then waveform).
8. Mobile alerts (SmartOps).
9. Collaboration.
10. Industries (photos).
11. "More than software".
12. Feature tag wall and "Track what Matters".
13. CTA with the globe.
14. URL.
15. Logo build and an inverted end card.

### 1.1 What I checked (20 frames plus measurements)

| Claim in the notes | Verdict | Evidence |
|---|---|---|
| Feathered typing, purple → white (f1–51) | **Confirmed, refined.** Characters arrive dim purple at the leading edge (a 2–3 char feather). A bright-purple band 5–8 chars wide rides behind the caret, and the chars *behind* the band fall back to dim purple. **The whole word snaps to white in one frame** about 6 f after its last char ("Advanced": typed f12–18, white at f23). There is a white block caret | f20 + a per-column colour profile of f3–33 |
| Type-through (f91–100) | Confirmed | f95: big purple "ilt fo" with feathered edges erases the white line from its left |
| Dot-wave terrain (f120–150) | Confirmed. A perspective dot lattice, blue → magenta (`#8a38cf`) with a white crest glow (`#f6f1ff`) | f140, f163 |
| Scattered glyph converge (f153–175) | Confirmed. Glyphs are spread over the whole frame, white, one random offset per glyph | f163 |
| Giant type pan "150 → 25 px/f expo-out" (f201–307) | **Wrong shape and numbers.** It is a *landing* (308 → 11 px/f in 46 f) on top of a slow drift, then an **S-curve hop** to the next word (peak 180 px/f), then a second landing. The cap height is **411 px = 0.57 H** (the notes' "~330 px" is close to the x-height, 308 px) | §4.1 |
| UI assemble + callouts (f386–421) | **Confirmed and measured.** It is not a time stagger across parts. The header leads by 3.3 f, and the sidebar and body share one clock, with the body travelling 1.2× further. The header content also *widens* from the centre | §4.1, f392, f416 |
| Row hover-lift "scale ~1.04", repeating on each row (f561–630) | **Corrected.** The lift is **×1.088** and starts at f555. **Only row C001 lifts and veils the others.** Rows C002–C006 get plain cursor passes, with no lift and no veil, in a quick sweep of about 5 f/row (not 16–18 f) | §4.1, f572, f603, per-row detail |
| Route draw-on (f913–947) | Confirmed. The white polyline is **≈ 12 px@720** thick (the notes say 6 px) | f935, f1050 |
| Pulse → red (f978–1052) | Confirmed. Red core `#b1001d` with violet halo rings | f1050 |
| Chat prompt stack (f1301–1358) | Confirmed. The history lines shrink *and* fade with age (3 lines above the box) | f1360 |
| Sparkle + sine strands (f1353–1472) | Confirmed. Two strand bundles: 3 white and 6–8 violet, echo copies over a white dashed line | f1360, f1462 |
| Phone notifications (f1501–1540) | Confirmed. The previous banner sits narrower and behind the new one; the phone occludes the giant word | f1530 |
| Photo grid → sparkle morph (f1761–1788) | Confirmed. At f1773 the rotated squares sprout star tips | f1773 |
| Logo build "circle r 3 → 30" (f2026–2167) | **Numbers wrong.** The ring grows **r 4.5 → 73.5 px@720 in 22 f** (f2034–2056) | f2046 + the earlier analyst's `logo_series` |

---

## 2. Beat-by-beat breakdown

| # | Frames | Time | Beat | What happens | Into the next beat |
|---|---|---|---|---|---|
| 1 | f1–90 | 0:00.0–3.0 | **Typed claim** | "The Advanced Waste Management Platform" types word by word on a dark violet mesh. The line shrinks as it grows (cap 40 → 26 px) so its width stays constant; there is a block caret | Type-through |
| 2 | f91–108 | 3.0–3.6 | **Type-through** | The next line, in purple at 2.3×, slides R→L through a feathered window and erases the white line from its left edge (10 f). Then "Built for real - world operations" resolves word by word from faint ghosts (8 f) | In-shot |
| 3 | f101–157 | 3.3–5.2 | **Dot-wave** | The ground darkens to black. A particle dot-wave terrain rises and brightens from the bottom. The line holds with a slow shrink and fades out over f145–157 | In-shot |
| 4 | f153–200 | 5.1–6.6 | **"Powered by AI"** | Glyphs scattered across the frame converge (≈ 18 f) and settle with a small baseline jitter. The line holds, shrinking about 5 % | Giant type crosses the fading line |
| 5 | f201–307 | 6.7–10.2 | **Giant type pan** | "Introducing" lands (308 → 11 px/f), drifts, then hops (S-curve, peak 180 px/f) to a translucent-gradient "WasteProtection". It zooms out fast at f301–306 | Zoom-out into the wide title |
| 6 | f308–385 | 10.2–12.8 | **Ring title** | A glow-ring shockwave (r 250 → off-frame in 6 f). The title scales 1.6 → 1 over 13 f. An orbit ring grows. A z-field of glass icon tiles dollies outward, then the field cranes up with an ease-in | Hard cut |
| 7 | f386–457 | 12.8–15.2 | **"All In One Integrated System"** | Light world. A pill label, headline words at a 4 f stagger, the **dashboard assemble** (§4.1), and two **callout magnifiers** at f411 over a veiled dashboard. Crane up with an ease-in | Hard cut (exit into the cut) |
| 8 | f458–548 | 15.2–18.3 | **Walkthrough: navigate** | Close-up on a purple gradient stage. A purple arrow cursor glides to the sidebar and clicks "Bins Pickup" (f512). **Page swap**: the title backspaces while the new one types (≈ 6 f), and the rows cascade at 1 f/row. The camera reframes (f513–530) | In-shot |
| 9 | f549–640 | 18.3–21.3 | **Walkthrough: focus** | **Hover-lift** on C001 (×1.088, the others veiled), then a quick cursor sweep down C002–C006 (≈ 5 f/row, f597–630) with no lift. Slow push-in, 1.00 → 1.075 → 1.17 | In-shot |
| 10 | f641–737 | 21.3–24.6 | **Routes** | Click "Routes", page swap (rows collapse bottom→top at 1 f/row). The cursor scans a row with an **underline trail**, and the camera follows it to the map | Hard cut |
| 11 | f738–907 | 24.6–30.2 | **"Unified Platform"** | Grey studio with window-light streaks. The dashboard enters with a **purple bezel plus two stacked plates** that collapse into it. A **magnifier band** pans in parallax. "Unified" and "Platform" blur in and close the gap. Whip right to white, then a **3-screen stack** (1.0/0.82/0.68) slides in. The background grades white → violet → near-black | Hard cut |
| 12 | f908–1052 | 30.2–35.1 | **Dark map** | Roads revealed by an expanding soft circle (22 f). Markers pop (0 → 1.1 → 1, 4 f). The **route draws on** (26 f). Tooltips grow from their pointer tips (7 f). **Pulse rings** turn from purple to **red** at f1046 | In-shot |
| 13 | f1053–1162 | 35.1–38.7 | **"But what happens next?"** | The map shrinks into a card (1269 → 874 px wide in 5 f) and 4 violet alert cards slide out from behind it. Words converge from both frame edges. The card collapses into a glow dot, and a **glow-ring light wipe** expands (17 f, ease-in) | Cut to black (music break) |
| 14 | f1163–1273 | 38.7–42.4 | **"Arlo"** | A giant violet word lands (149 → 2 px/f) and whips out (15 f, ease-in). The dark-glass **chat prompt box** slides in (defocus → focus) and the camera pans along it | 1 f black dip |
| 15 | f1274–1352 | 42.4–45.1 | **Chat** | The wide prompt box. The question types in **word chunks (≈ 5 chars/f)**. **Submit**: the question slides up into a fading, shrinking history, and the next question appears whole, every 15–16 f | In-shot |
| 16 | f1353–1472 | 45.1–49.1 | **AI waveform** | A concave 4-point sparkle arcs in spinning, grows to about 90 % H, rotates 45° and shrinks back. A dashed line draws out, and **sine-wave echo strands** grow along it and sweep across | Giant type |
| 17 | f1473–1561 | 49.1–52.0 | **SmartOps** | Giant "SmartOps". A **whip-cut at peak speed** (f1487) switches the background. A phone rises *in front of* the word, and **iOS banners stack** every ≈ 16 f. A skeleton dashboard pushes up over the phone | Hard cut |
| 18 | f1562–1617 | 52.0–53.9 | **Collaboration** | A skeleton UI with **named multiplayer cursors** ("Operator 1/2"), a progress-bar fill and card sweeps | In-shot |
| 19 | f1617–1760 | 53.9–58.6 | **Industries** | Four violet tiles fly in from the corners into a 2×2 grid and fill with photos through a duotone. The hero tile swaps (8 f). **Pill labels grow from dots while typing** ("Diverse industries", "1,000+ bins", "20% Reduction") and later un-type | In-shot |
| 20 | f1761–1836 | 58.7–61.2 | **"More than Software"** | The grid rotates 45° and **morphs into the sparkle** (spin overshoot +30°, 60 → 250 px). The sparkle becomes a translucent background shape; "It's a Smarter way" | Hard cut |
| 21 | f1837–1920 | 61.2–64.0 | **Tag wall + "Track what Matters"** | 3 rows of bevelled glass capsules in an alternating marquee, zooming out fast (×0.36 width in 28 f). The words assemble from different heights. A **tilted dashboard** (rotX ≈ −25°) rises with giant outlined words behind it | Hard cut |
| 22 | f1921–1982 | 64.0–66.0 | **CTA** | Outlined shield; "Get started with WasteProtection" word by word; a **dotted 3D globe** rises; an orbit ring | Hard cut |
| 23 | f1983–2025 | 66.1–67.5 | **URL** | "Visit WasteProtection.com" shrinks continuously (38 → 22 px over 40 f) | Hard cut (music break) |
| 24 | f2026–2162 | 67.5–72.0 | **Logo build** | Dot → white ring (r 4.5 → 73.5 px in 22 f) → violet shield strokes on and turns white → the mark slides left while the wordmark is revealed from behind a mask → the tracking collapses | Cut |
| 25 | f2163–2202 | 72.1–73.4 | **End card** | Inverted: off-white `#faf9fe`, black "W P®" slides together (4 f). Hold 1.3 s | — |

---

## 3. Technique catalogue

"Bhippi today" is judged against `src/motion/types.ts` and the kit as they stand:
- **Yes**: buildable with today's scene JSON.
- **Partly**: buildable by hand-keying, or with a gap.
- **No**: not buildable.

| # | Frames | Technique | AE build | Bhippi today | Pillar |
|---|---|---|---|---|---|
| T1 | f1–90 | **Typing with a feathered bright band and a 1-frame snap to white.** Block caret (4 f on / 4 f off); the line scales down to hold its width as words arrive | Text animators: an opacity range selector (ramp shape, smoothness 3) sweeping by index + a fill-colour range with offset (the band); hold keys for the snap; a scale key per word; the caret as a shape with a blink expression | **Partly.** Animators with `smoothness` and `fillColor`/`fillAmount` can build the feather and the band by hand. There is no caret, no snap preset and no fit-to-width | P2 |
| T2 | f91–100 | **Type-through transition.** The new line (2.3× → 1×, purple) slides through a feathered window while the old line is wiped from its left in step (10 f) | Two feathered rect masks keyed together; a scale key | **Yes** by hand (masks with `feather` + keys); no preset | P4 (NEW `type-through`) |
| T3 | f101–108 | **Ghost → white word resolve**, 1 word/f | Opacity/fill animator by word | **Yes** (`cascade {by:'word', dimTo, brightenAfter}`) | — |
| T4 | f101–200 | **Dot-wave terrain.** A perspective dot lattice, noise-displaced, blue → magenta with a white crest streak, rising and brightening over 50 f | Trapcode Form (layer grid about 200×40, Fractal Field displacement, a low camera) or Plexus; Deep Glow | **No.** `dots` is a flat grid. A 2.5D hack is possible: `dots` on a `threeD` plane at rotX ≈ 75° + `wave-warp` + `glow` | P5 `dot-wave` (as a shader, §7.2) |
| T5 | f153–175 | **Scattered glyph converge.** Every glyph starts at its own random off-frame offset and eases home in ≈ 18 f; a baseline jitter settles by f175 | Position animator with an Expression or Wiggly selector (a random vector per char) | **Partly.** `randomize` shuffles the *order*, but every unit shares one position delta. There is no per-unit random offset | P2 (NEW `scatter`) |
| T6 | f201–307, f1164–1216, f1473–1545 | **Giant-type pan** (cap 0.57 H). A landing ease on top of a constant drift, then an S-hop to the next word, then a whip exit. The second word has a lilac → violet gradient at about 70 % opacity. **No motion blur** | A huge text layer; position keys with about 90 % influence; a drift null; a Gradient Overlay style | **Yes** by hand: text + cubic-bezier keys + a parent null for the drift, with the gradient through a track matte. No template | Kit (NEW `giant-type-pan`), P2 gradient fill |
| T7 | f301–321 | **Zoom-out into the wide title, glow-ring shockwave** (a soft lilac donut, blur about 60 px, r 250 → off-frame in 6 f); title 1.6× → 1× over 13 f, expo-out | Ellipse stroke + Fast Blur + scale keys | **Partly** (a radial-gradient ellipse whose stops form a donut, + scale keys + `gaussian`) | P5 `glow-ring` |
| T8 | f314–345 | **Orbit ring**: a 1 px white ring at 15 % grows r 40 → 330 | Ellipse stroke + scale | **Yes** | — |
| T9 | f314–385 | **Glass icon-tile z-field.** Rounded tiles (r 12) with a 1 px white rim at 15 % and Lucide-style line icons, dolly outward with parallax, then an **ease-in crane-up exit** (2 → 30 px/f) into a hard cut | 3D layers + a camera | **Partly.** `threeD` + `camera` work; icons are emoji or letters | P1 Lucide, P4 parallax fields |
| T10 | f386–410 | **UI assemble** (measured, §4.1). The header leads by 3.3 f and rises in 13 f; the sidebar takes 23 f; the body takes 24 f and travels **1.2× further** on the same clock; the header's content **widens from the centre** (+180 px). **The cut lands mid-move** | The UI precomp split into part precomps, each with its own position keys; the header children's position scaled from the centre | **Partly** (one footage/shape layer per part, keyed by hand; no part map) | P3 `assemble` (params in §7) |
| T11 | f389–405 | **Headline word pops at a 4 f stagger** (black Medium line, then a violet Bold line); the sub-copy follows word by word | Text animator by word | **Yes** (`cascade {by:'word', stagger: 0.133}`) | — |
| T12 | f411–421 | **Callout magnifier.** A violet 2 px stroke box (r 16) with a white fill holds a 1.6× copy of a UI element, placed *outside* the dashboard edge. The rest is veiled with about 50 % white plus a blur. The callout text **re-types** at 1 char/f | A duplicated precomp, masked and scaled; a white solid with a mask hole | **Partly** by hand. `demo-callouts` draws dashed boxes, not magnifiers | P3 `callout` |
| T13 | f449–457, f369–384 | **Ease-in crane exit into a hard cut** | Position expo-in + motion blur | **Yes** | — |
| T14 | f481–530 | **Cursor glide → click → page swap.** The title backspaces while the new title types (≈ 6 f); rows cascade top→bottom at 1 f/row; the camera reframes (zooms out and pans, 17 f) | Precomp states; source-text keys | **Partly** (keyed by hand; the `dock-cursor` pattern gives the path) | P3 `click`, `state` |
| T15 | f555–591 | **Row hover-lift** (measured). ×1.088 about a point near the cursor, a white card with a shadow, a radial lilac glow `#d5aafd` near the cursor, and the checkbox and code turning violet. The other rows are veiled and blurred to **32 % detail**. **Row 1 only** | A duplicate of the row, scaled, with a drop shadow; a white veil and a blur adjustment underneath | **Partly** (a masked duplicate footage + `drop-shadow` + a veil solid, by hand) | P3 `hover-lift` |
| T16 | f689–736 | **Underline trail + follow-cam.** A 1.5 px violet line grows under the row behind the cursor, and the camera follows the cursor to the map | Trim path linked to the cursor x; camera parented | **Partly** (the trim is keyed by hand to the cursor; there is no follow) | P3 `highlight {style:'underline-follow'}`, `camera.follow` |
| T17 | f738–760 | **Plate-stack bezel.** The dashboard enters with a violet bezel and two stacked plates (`#b98ef0`, `#8a4be0`) offset about 50 px up-left, which collapse into the frame over 15 f | Duplicated solids with offset keys | **Yes** by hand | P3 `device: 'plate-stack'` (NEW) |
| T18 | f749–770 | **Magnifier band**: a full-width loupe (1 px violet rules, 70 % white) with the enlarged stat row panning *faster* than the dashboard | A masked, scaled duplicate with its own pan | **Partly** | P3 `callout {shape:'band'}` |
| T19 | f769–825 | **Blur-in words + gap-close** ("Unified" "Platform", bold italic, lilac → violet gradient) | Per-word position/blur | **Yes**, apart from the gradient (track matte) | P2 gradient fill |
| T20 | f817–907 | **Whip right into white + a 3-screen stack** (scales 1.0/0.82/0.68, offset 200 px, soft shadows, flat planes). The background grades white → violet → near-black | Position expo-in; 3 layers; a gradient ramp | **Yes** by hand | Kit |
| T21 | f908–935 | **Radial map reveal**: roads appear only inside an expanding soft circle (22 f) while the camera zooms out and rotates 2° | A feathered ellipse mask keyed on expansion | **Yes** (mask + `feather`). There is no map asset | P3 `map` kind |
| T22 | f913–980 | **Marker pops** (0 → 1.1 → 1 in ≈ 4 f, staggered 2–4 f), **route draw-on** (a ≈ 12 px white polyline, 26 f, drawn from the truck backwards, even speed, ease-out end), **tooltips** that grow from their pointer tips (7 f, expo-out, no overshoot), and bin progress arcs | Trim paths; scale from an anchor | **Yes** by hand (`path` + `trimEnd`, `back-out` scale keys, shapes + text) | P3 `draw`, `pop`, `tooltip` |
| T23 | f978–1052 | **Pulse rings.** Concentric rings grow r 0 → 170 in 15 f, then breathe with a period of about 30 f. The colour turns **purple → red `#b1001d`** at f1046 | Ellipses + repeater; scale/opacity/colour keys | **Partly** (`ellipse` + `repeat` + keys; `fill` is not animatable, so the colour change needs a crossfade or `tint` keys) | P3 `pulse {colorTo}` |
| T24 | f1053–1066 | **Map → card + alert cards from behind.** Width 1269 → 874 in 5 f, then a slow group shrink (1.0 → 0.8 over 60 f). Four translucent violet cards slide out about 80 px with a 2 f stagger | A precomp with a rounded mask and scale; cards layered below | **Partly** (`frame-to-card` is crimson-styled; by hand, yes) | Kit |
| T25 | f1066–1137 | **Converging words**: each word enters from *its* frame edge and closes into one line | Per-word position keys | **Partly** (`cascade.from` is shared by all units, so one layer per word) | P2 (per-unit `from`) |
| T26 | f1129–1148 | **Collapse to a glow dot + glow-ring light wipe**: the card goes 0.6 → 0 in 3 f (ease-in); a soft donut grows r 30 → off-frame in 17 f, accelerating | Scale keys; ellipse + blur | **Partly** | P5 `glow-ring`, P4 (NEW `glow-ring-wipe`) |
| T27 | f1210–1273 | **Chat prompt box**: dark glass (`#1a1424` at about 85 %, r 24, a lighter 1 px top edge, a violet bottom glow line), sparkle icon, "Add attachment", "0/1000", round send button `#b03efa`. It slides in under the fading word, defocus → focus, and the camera pans along it | Shape layers + camera | **Yes** by hand (`glassCard`, `backdrop`, blur keys) | P3 `chat` kind |
| T28 | f1301–1358 | **Chunk typing + submit stack.** About 5 chars/f. On submit the question lifts about 16 px and becomes a history line; each older line is smaller and fainter (≈ 70/45/20 %); the next question appears whole in 1–2 f; interval 15–16 f | Source-text keys; per-line transforms | **Partly** (`reveal` + per-line keys) | P3 NEW `submit` |
| T29 | f1353–1437 | **Sparkle fly-in**: an arc with a decaying spin (about 20°/f), grows to about 90 % H, rotates 45°, shrinks back (12 f, ease-in) | Shape + motion path | **Partly** (`star` has straight edges; there is no motion-path tangent) | P1 bezier + auto-orient |
| T30 | f1438–1472 | **AI waveform**: a dashed line (dash 8 / gap 6, 2 px) trims on; 2 bundles of 1 px sine strands (echo copies, phase-staggered, amplitude 20 → 120) grow along it and sweep across | 3D Stroke / Stroke + Echo, or a Repeater with a time offset | **Partly** (a sampled sine `path` + `repeat` + `dash` + `trimEnd`; animating the amplitude means keying points) | P1 `wiggle-path`, P5 `echo` |
| T31 | f1485–1492 | **Whip-cut at peak velocity**: 63, 95, 168 \| 168, 95, 63 px/f, with the background switching on the fastest frame | Position ease-in/out across the cut | **Yes** by hand | P4 `whip {cutAtPeak}` |
| T32 | f1488–1545 | **Phone in front of the giant word + an iOS notification stack.** Each banner pops (scale 0.6 → 1 + rise, 5 f); the previous one goes to 95 %, moves up behind and dims; interval about 16 f | Precomps | **Partly** (rects + text + `backdrop` by hand; no device frame) | P3 `phone-lock` + NEW `notify` |
| T33 | f1545–1561 | **Push**: the next UI rises over the phone (16 f, ease-out) | Position keys | **Yes** | — |
| T34 | f1562–1617 | **Multiplayer cursors** with white name pills drift over a skeleton UI; a progress-bar fill | Cursor precomps with wiggle | **Partly** (shapes + `wiggle`; one cursor per layer) | P3 NEW `cursors[]`, `fill` |
| T35 | f1617–1648 | **Corner tiles → 2×2 grid → photos** (13 f, ease-out) via a crossfade through a violet duotone | Solids + footage + a colour overlay | **Yes** (footage + a rect mask with `radius` + `duotone`) | — |
| T36 | f1649–1760 | **Hero swap + pill label typed out of a dot.** The dot grows into a pill while the text types (about 1 char per 1.5 f); later it un-types and collapses | Rect size keys + a typewriter | **Partly** (rect `size` keys + `reveal`, by hand) | Kit `label-pill` |
| T37 | f1761–1812 | **Grid → diamond → sparkle morph** with a +30° spin overshoot (60 → 250 px). The sparkle then scales to fill the frame as a 30 % background shape | Shape morph (different vertex counts) | **No** | P1 morph, P4 `shape-wipe` |
| T38 | f1837–1865 | **Pill-tag marquee wall.** Bevelled glass capsules (an inner dark core, a light rim, a glow) in 3 rows with alternating marquee directions; the wall zooms out ×0.36 in 28 f, expo-out | Shape layers + bevel styles + an offset expression | **Partly** (no inner shadow or bevel; the marquee by expression) | P1 styles |
| T39 | f1866–1905 | **Word assemble from different heights** ("Track what Matters") with blur, 6 f apart | Per-word keys | **Partly** (one layer per word) | P2 |
| T40 | f1873–1920 | **Tilted dashboard** (rotX ≈ −25°) rises and de-tilts, with giant outlined words at about 20 % behind it in parallax | 3D layer + camera | **Yes** (`threeD`, `camera`, text `stroke`) | — |
| T41 | f1921–1982 | **Dotted 3D globe** (dotted continents, magenta rim light, scanlines) rises under "Get started"; orbit ring | Element 3D / C4D / stock | **No** | P7 globe preset or P6 sphere |
| T42 | f1983–2025 | **Continuous shrink of the URL line** (38 → 22 px over 40 f) | Scale keys | **Yes** | — |
| T43 | f2026–2100 | **Logo build.** Dot → ring (r 4.5 → 73.5 in 22 f) → shield stroke draw-on → violet to white; **mask-slide** wordmark (the mark goes left in 5 f, and "Protection" then "Waste" slide out from behind it) | Ellipse + trim paths + a mask anchored at the ring | **Partly** (ring and mask-slide by hand; the shield needs an SVG path) | P1 SVG, `brand-logo-sting` |
| T44 | f2155–2167 | **Tracking collapse → inverted end card**; "W P" slides together in 4 f | Tracking animator | **Yes** | — |
| T45 | throughout | **Animated mesh-gradient grounds** (3–4 drifting blobs), hard ground switches at cuts, a camera that never stops (drift 1–6 px/f) | 4-Color Gradient + wiggle; a camera drift null | **Partly** (`aurora`, `radial-glow` and `light-leak` exist; there is no N-blob mesh) | P5 (NEW `mesh-gradient` procedural) |

---

## 4. Measured motion grammar

### 4.1 The three signature moves (NEW measurements)

The methods:
- **Pan**: phase correlation on a Sobel edge image. The flat letters give the LK camera in `analyze.py` almost no corners, so it dropped f269–285 and f201–208.
- **Assemble**: template matching against the settled f410, plus tracking of the saturated "Ask Arlo" button.
- **Hover-lift**: ECC stabilisation on the sidebar and header, a multi-scale template match of row C001, and Laplacian detail on rows C003–C006.

| Move | Frames (dur) | Travel / range | Bezier (x1, y1, x2, y2) | rmse | f50 / f90 | Notes |
|---|---|---|---|---|---|---|
| **A1 Giant type landing** ("Introducing") | f201–247 (46 f) | 2376 px (1.86 W); speed **308 → 215 → 169 → 140 → 120 … → 11 px/f** | **(0.047, 0.343, 0.187, 0.859)** | 0.0006 | 8 / 30 | y2 < 1 means the move lands *moving*. **AE form:** a 1943 px key move with `(0.058, 0.519, 0.254, 1)` + a constant **9.5 px/f** drift (rmse **0.76 px**). @1080: 2914 px + 14.3 px/f |
| **A2 Word-to-word hop** | f247–306 (59 f) | 4281 px (3.3 W); 11 → **180 px/f at f276** → ≈ 20 | **(0.627, 0.085, 0.336, 0.862)** | 0.0013 | 30 / 45 | A symmetric S (accelerating over 29 f, decelerating over 30 f). The velocity is continuous across the words, which reads as one camera travelling a line of type. Then a zoom-out accelerating to ×0.88/f (f302–306, ORB) into the wide title |
| A3 "Arlo" landing (from peak) | f1168–1199 (31 f) | 599 px; 149 → 2 px/f | (0.064, 0.471, 0.185, 0.905) | 0.0003 | 5 / 18 | The same grammar, settling almost to a stop (2 px/f) |
| A4 "Arlo" whip exit | f1199–1214 (15 f) | 477 px; 2 → 128 px/f (153 at f1215) | (0.613, 0.128, 0.899, 0.415) | 0.0003 | 13 / 15 | Ease-in, still accelerating at the cut |
| A5 SmartOps whip-cut | f1485–1492 (7 f) | 63, 95, **168 \| 168**, 95, 63, 46 px/f | — | — | — | Symmetric; the background switch sits on the fastest frame |
| **B1 Header rise** (search + "Ask Arlo") | f389–402 (13 f) | 137 px (0.19 H) | **(0.055, 0.519, 0.22, 0.918)** | 0.0005 | 2 / 8 | Leads the sidebar by **3.3 f** (3.2–3.5 over the move). It also fades in: first detected at f389 |
| B2 Header widen (Ask Arlo x) | f389–412 (23 f) | +180 px outward (the search bar goes left, "Welcome" goes 74 px left) | (0.361, 0.344, 0.0, 0.938) | 0.011 | 6 / 13 | The header content starts clustered at about 0.6× its final spread and opens to full width |
| **B3 Sidebar rise** | f386–409 (23 f) | 324 px (0.45 H) | **(0.232, 0.253, 0.0, 1.0)** | 0.013 | 4 / 11 | Already moving at the cut (18 px/f at f387). The speed has two peaks (63 px/f at f389, 23 at f393–394). A free fit gives (0.199, 0.108, 0.0, 1.057), rmse 0.010 |
| B4 Body rise (stat cards, table, map) | f386–410 (24 f) | 353 px (0.49 H) | (0.226, 0.222, 0.004, 1.0) | 0.016 | 5 / 11 | **The same clock as the sidebar**, with a travel ratio of 1.09 → 1.22 × sidebar: the stagger is by amplitude, not time. The table header, row 1 and the map move identically |
| B5 Headline words | f389, 393, 397, **401, 405** | 4 f stagger | — | — | — | "Integrated"/"System" measured (the violet components appear at f401 and f405) |
| **C1 Row lift, scale in** | f555–564 (9 f) | ×1.000 → **1.088** (+4 px x, pivot near the cursor) | (0.623, 0.493, 0.506, 0.832) | 0.0088 | 5 / 8 | Close to linear in the middle (AE easy-ease gives rmse 0.044). The scale step is 0.002, so treat it as "9 f, soft ends" |
| C2 Row hold | f564–583 (19 f) | ×1.086–1.088 | — | — | — | |
| C3 Row lift, scale out | f583–591 (8 f) | 1.086 → 1.000 | **(0.287, 0.0, 0.67, 1.0)** | 0.0067 | 4 / 7 | ≈ AE easy-ease (0.333, 0, 0.667, 1) |
| **C4 Veil in** (rows C003–C006) | f559–571 (12 f) | detail 100 % → **32 %** | (0.105, 0.0, 1.0, 0.972) | 0.026 | 7 / 12 | **Lags the lift by 4 f.** An S-ramp (the detail measure is noisy) |
| C5 Veil out | f571–581 (10 f) | 32 % → 95 % | ≈ linear (rmse 0.061) | — | 6 / 10 | **Ends 2 f before the row starts to drop**: the focus is released first |
| C6 Camera during the hover | f552–595, then f620–640 | scale 1.000 → 1.075 (slow), then → 1.17 | — | — | — | The camera never stops |

### 4.2 Other numbers (earlier analyst's series, refitted, and observations)

| Token | Value | Evidence |
|---|---|---|
| Logo ring grow | r **4.5 → 73.5 px in 22 f** (f2034–2056), fit (0.382, 0.268, 0.197, 0.8), rmse 0.0037, f50 8, f90 17 | `measure_moves.json` `logo_series` |
| Map → card | Width **1269 → 874 px in 5 f** (f1052–1057), then 535 px by f1071 (after f1060 the series mixes the slow group scale-down with the alert cards, so it is not fitted) | `card_width_series` |
| Phone rise | Top edge 448 → 325 px over f1494–1511, fit (0.253, 0.631, 0.724, 0.845), rmse 0.0017 (partial: the phone keeps rising) | `phone_series` |
| Typing | 1 char/f, a 2–3 char feathered edge, a 5–8 char bright band, and a **1-frame snap to white** about 6 f after the word's last char. "Platform" appears in one frame (f51) | Column profile f3–33 |
| Chunk typing | 55 chars in about 11 f (≈ 5 chars/f) | Notes |
| Pop-in (map markers) | 0 → 1.1 → 1 in about 4 f, stagger 2–4 f | Notes |
| Tooltip | Scale from the pointer tip, 7 f, expo-out, no overshoot | Notes |
| Glow ring | 6 f (title reveal, f308–313); 17 f accelerating (light wipe, f1131–1148) | Notes; the ring series in `measure_moves.py` is too noisy to fit |
| Row cascade on a page swap | 1 f/row in (top→bottom), 1 f/row out (bottom→top); stat cards 2 f | Notes |
| **Stack cadence** | Chat submits every 15–16 f and notifications about every 16 f. That is **≈ 0.53 s, about 1.2 beats**: not locked to the beat | Notes + §6 |
| **List sweep** | After the lift, the cursor passes rows C002 → C005 at f605, f611, ~f616 and ~f619: **≈ 5 f/row**. The notes' own range, f609–630 for C003–C006, agrees; their "every 16–18 f" does not | `hover_lift.json` per-row detail peaks |
| Holds | The camera drifts 1–6 px/f through every hold. End card 1.3 s | Notes, measured drift |

### 4.3 About `measure_moves.py`

It runs (exit 0). Its `arlo_track` runs phase correlation on a *violet mask*, which returns 0 on many
frames: the mask includes static violet background pixels. The resulting "bezier (0.395, 6.957, 0.931,
−11.15)" is meaningless. The edge-image tracker in `measure_signature.py` replaces it (A3/A4 above). Its
logo, map-card and phone series are fine.

### 4.4 The grammar in one paragraph

**How things arrive.** Everything *lands* rather than stops: a strong ease-out (about
`(0.05, 0.5, 0.2, 1)`) sits on top of a slow constant drift, so the frame is never still.

**How the camera changes subject.** It moves between subjects with a symmetric S-hop, about 60 f,
peaking at mid-hop, and velocity is continuous across hand-offs. Exits are ease-in, and the cut lands
at peak speed.

**UI moves.** The UI assembles on one clock: the header leads by about 3 f, and the body parts differ by
amplitude (1.2×), not by delay. Focus moves (lift, veil, callout) are 8–12 f and nearly linear, the
veil trails the lift by about 4 f, and it releases before the lift does.

**Repetition.** Stacked events (chat submits, notifications) run on a cadence of about 16 f that ignores
the beat; list sweeps are much faster, at about 5 f/row. Type is never static: it types, shrinks to fit,
snaps colour, or pans.

---

## 5. Design system

### 5.1 Colour

The colours are sampled from the verified frames (medians of the most saturated pixels) and the shot palettes.

| Role | Hex |
|---|---|
| Dark ground | `#000000`, `#07030d`, `#0c0c0c` (logo), `#0c0b10` / `#0d0b12` (map) |
| Dark mesh blobs | `#390070` (top-left violet), `#462e69` (dusty lilac, bottom-right), `#5c486f` (grey-lilac sweep) |
| Bright violet mesh | `#4d0099`–`#5100a3`, `#6506ca` |
| Light ground | `#efedf2`, `#e5e3e7` (studio), `#f6f3f9`; lilac corner glow `#e2c0fc`; purple stage gradient `#b064f7` → `#9b4df0`; end card `#faf9fe` |
| **Accent (house violet)** | **`#7300f6`–`#7c00ff`**: "Integrated System", the giant "Arlo" and the cursor. It is more saturated than Tailwind violet-600 |
| Lilac ramp | `#efd4ff` (the light end of "Introducing"), `#a266f9` (sparkle), `#9f64f0` (SmartOps), `#936ad7` (typing band), `#8d2cf1` (the violet end of "WasteProtection") |
| UI accents | Send button `#b03efa`, lift glow `#d5aafd`, the "Diverse" pill and photo borders `#8a27eb`–`#8d26f0` |
| Alert | Pulse core `#b1001d`; alert cards `#826196` (a translucent `#6b3fa0`/`#4a1d7a` over the map) |
| Dot-wave | Magenta `#8a38cf`, blue `#3a6cff`, crest `#f6f1ff` |
| Notification glass | `#c2c3f7` (lavender frosted) |
| Text | `#ffffff` on dark; `#000000`/`#0b0b0f` on light; placeholder `#a8a0b8` |

### 5.2 Type

- **Inter** (OFL) throughout, in weights 400, 500, 600 and 700. It is the dashboard font too. The final lockup is Inter Bold.
- **Giant type:** cap height **411 px@720 = 0.57 H**. That is an Inter font size of about **565 px@720 (0.78 H), or 848 px@1080**. The x-height is 308 px.
- **Other sizes:**
  - Ring title: SemiBold, about 46 px@720 (69 @1080).
  - Light headline: Medium, about 40 px (60 @1080), with a Bold violet second line.
  - Sub-copy: about 11 px (16 @1080), grey.
  - Chat prompt: about 22 px.
  - URL: 38 → 22 px.
- **Gradient words:**
  - "WasteProtection" in the pan runs lilac → violet, left → right, at about 70 % opacity.
  - "Introducing" runs white → lilac, top → bottom.
  - "Unified Platform" is bold italic, lilac → violet.
- **Outlined type:** giant stroked words at about 20 % behind the tilted dashboard, and the outlined shield.

### 5.3 Radii @1080 (×1.5 from the source)

| Element | Radius |
|---|---|
| Dashboard panel, chat box | 36 |
| Map card | 48 |
| Photo tiles | 36–42 (3–4.5 px violet border) |
| Callout box | 24 (3 px stroke) |
| Glass icon tiles, alert cards | 15–18 |
| iOS notification | about 24 |
| Pills, capsules, send button | full |

### 5.4 Strokes, glass and glows

- **Dark glass:**
  - The chat box: `#1a1424` at about 85 %, a lighter 1 px top edge and a thin violet under-glow line.
  - The icon tiles: a dark translucent fill, a 1.5 px white rim at 15 % and a faint violet inner glow.
- **Light glass:**
  - A white card with a very soft lilac shadow.
  - The magnifier band: 70 % white between 1.5 px violet rules.
- **Lines:**
  - Orbit rings: 1.5 px white at 15 %.
  - Route: ≈ 18 px white.
  - Underline trail: 2.25 px violet.
  - Dashed AI line: 3 px, dash 12 / gap 9.
  - Sine strands: 1.5 px.
  - Logo ring: about 4.5 px white.
- **Glows:**
  - A glow-ring donut (blur about 90 px@1080).
  - A violet bottom glow on the dark mesh.
  - The dot-wave crest bloom.
  - The pulse halo rings.
- **No grain, and no motion blur on the type.**

### 5.5 Motifs

- **The concave 4-point sparkle** is the AI glyph. It is the chat icon, a fly-in hero, a morph target, a background wipe shape, and the Ask-Arlo button icon.
- **Rings:** orbit ring, glow-ring shockwave, pulse rings, logo ring.
- **Continuity by type:** the giant word always hands its velocity to the next subject.

---

## 6. Sound design

**What's there.**
- **Music only.** There is no VO and no captions, and no separable SFX layer was identified.
- **Tempo: 134.1 bpm** (beat = 0.4475 s = **13.43 f**). 76 % of the 162 onsets sit within ±2 f of that grid.
- `analysis.md`'s "67.1 bpm" is the half-time reading.
- **Breaks:** the music thins at **37.95–39.29 s** (the glow-ring light wipe and the cut to black before "Arlo") and at **66.6–69.1 s** (the logo build).

**Sync against chance.** Onsets are dense (about 2.2/s), so an event lands within ±2 f of an onset
**29.5 %** of the time by chance.

| Event class | On onset | By chance | Binomial p | Verdict |
|---|---|---|---|---|
| Hard cuts | **6/16 = 38 %** | 29.5 % | 0.32 | Only mildly above chance. **No evidence of cutting on the beat** |
| Cuts within 2 f of the 134 bpm grid | 8/16 = 50 % | 37 % | 0.21 | Not significant |
| Motion bursts starting on an onset | 17/38 = 45 % | 29.5 % | **0.03** | Mildly significant: moves are *loosely* on the pulse |
| Headline word pops (f389–405, 4 f apart) | 2 of 5 within 2 f | — | — | A 4 f stagger can't follow a 13.4 f beat |
| Stacked UI events (chat, notifications) | Cadence ≈ 16 f | — | — | About 1.2 beats: **deliberately off-grid** |

**Rules for Bhippi.**
- For a music-only SaaS launch, the music sets the *mood and the breaks*, not the cut grid.
- Snap only the **world switches** to phrase points:
  - the cut to the dark map (f908, 1.1 f from an onset);
  - the pill wall (f1837, 1.3 f);
  - the "Arlo" section after the break.
- Leave the UI micro-events on their own cadence (stacks about 16 f, list sweeps about 5 f/row).
- If SFX are added (P9), keep them sparse and under the music: UI clicks on the two clicks, a soft
  whoosh on the whips, a notification ding per banner, and a low shimmer on the sparkle.

---

## 7. What Bhippi needs

### 7.1 Already in the plan: build as written

| Pillar | Items this film uses |
|---|---|
| P1 | Bezier paths (the concave sparkle, the shield), SVG logo import, Lucide icons (shield-check, box, zap, message-square, archive, chart, send, fingerprint, truck, paperclip, arrow-right, sparkles), morph, layer styles (the capsule bevel and inner shadow) |
| P2 | Bundled Inter, `type {feather, wake, caret: 'block', chunk: 'word', recenter}`, gradient `fill` with an offset, the `collapse-to-point` preset |
| P3 | The `ui` layer, `states`, kinds `dashboard`/`table`/`chat`/`map`/`phone-lock`/`notification`, actions `type`/`backspace`/`click`/`hover`/`hover-lift`/`select`/`state`/`assemble`/`callout`/`highlight`/`pulse`/`draw`, the automatic cursor path, `camera.follow: "cursor"`, `camera.push` |
| P4 | `whip`, `shape-wipe` (the sparkle), parallax fields (the icon tiles), the continuity guide (the sparkle), depth blur |
| P5 | `dot-wave`, `echo`, `glow-ring` |
| P6/P7 | The dotted globe |
| P9 | UI click, typing, notification ding, soft whoosh, shimmer |
| P10 | `motion_guide {topic: 'ai-launch' / 'ui-walkthrough'}`, `TIMING`, pacing QA |

### 7.2 Missing or wrong for this film (add only these)

1. **P3 UiAction vocabulary**. The film needs 7 actions the P3 union lacks, and measured parameters on 6
   it has (the full union is in §7.3):
   - **New:**
     - `pop`: markers and badges.
     - `tooltip`: grows from the pointer tip.
     - `focus`: a standalone veil and blur of everything but the target.
     - `tour`: the cursor steps `hover` over a list at a cadence (about 5 f/row here), which
       replaces the plan's undeclared `every`.
     - `submit`: chat history stack.
     - `notify`: banner stack.
     - `fill`: progress bars and rings.
   - **Also new:** `ui.cursors[]` for named multiplayer cursors.
   - **Parameters on existing actions:**
     - `assemble` gains groups, a lead, amplitudes and a widen.
     - `hover-lift` gains scale, a veil with lag, a hold, a glow and select.
     - `callout` gains a veil, a retype and a band shape.
     - `state` gains its row choreography.
     - `pulse` gains a radius, a period and a `colorTo`.
     - `highlight` gains `underline-follow`.
2. **P3 `device: 'plate-stack'`** (a bezel plus N coloured plates offset up-left, collapsing in 15 f) and a
   `map` kind that takes `routes[]` and `markers[]`. The kind is listed in the plan; its route and marker
   data model is not.
3. **P2: `cascade.from.scatter {radius, seed, rotate?}`** for per-unit random offsets (T5). Today
   `randomize` shuffles only the order. Add **per-unit `from` sides** too, for converging words (T25).
4. **P2: the typing wake as a *band*, with a snap.** Use `wake {mode: 'band', chars: 6, dimTail: true,
   snap: 0.2}`: the whole word jumps to the base colour 6 f after its last char. Also add `fit: 'width'`,
   so the line scales down to keep its width as words arrive. The plan's `wake.settle` implies a fade;
   this film snaps.
5. **P4 camera move `type-pan`.** It lands on each word with the A1 ease plus a drift, and runs an A2
   S-hop between words with continuous velocity. It is used 3 times (Introducing, Arlo, SmartOps). Add
   `whip {cutAtPeak: true}` (T31), the **`type-through`** transition (T2) and **`glow-ring-wipe`** (T26)
   to the §4 transitions list.
6. **P5 `dot-wave` does not need the instanced particle path.** It can be a procedural *fragment shader*:
   for each pixel, loop over about 40 lattice rows, project each row's dots with a noise displacement,
   and take the nearest dot. That is O(rows) per pixel. It can land as an S item before P5's instanced
   `gl/core.ts` work. The same goes for a **`mesh-gradient`** procedural (N drifting blobs, T45).
7. **P10 `TIMING` tokens from this film** (§4):
   - `landing: {bezier: [0.058, 0.519, 0.254, 1], drift: 0.0074 W/f}`;
   - `hop: {frames: 59, bezier: [0.627, 0.085, 0.336, 0.862]}`;
   - `assemble: {leadF: 3, headerF: 13, bodyF: 23–24, amp: [1, 1.2]}`;
   - `hoverLift: {inF: 9, holdF: 19, outF: 8, scale: 1.088, veilLagF: 4, veilDetail: 0.32}`;
   - `stackCadence: 16 f` and `listSweep: 5 f/row`;
   - `wordStagger: 4 f`;
   - "cut into a move already under way" (the assemble is moving at 18 px/f on the cut frame).
8. **Corrections to REFERENCE-FILMS-PLAN §3.5 for this film:**
   - the giant-type numbers (A1/A2 replace "150 → 25 px/f expo-out");
   - `type: "page"` → `state`;
   - hover-lift on row 1 only, with a `tour` for the rest at about 5 f/row (not `every: 0.55`);
   - the film is 41 % light world.

### 7.3 Schema sketch (P3 `UiAction` for this film; NEW or extended fields are marked)

```ts
type UiAction =
  // ── in the plan, with measured defaults added ──
  | { t: TimeRef; type: 'assemble';
      groups?: string[][];              // NEW: part ids per wave, e.g. [['header','welcome'],['sidebar'],['stats','table','map']]
      lead?: number;                    // NEW: s the first group leads (0.11 = 3.3 f)
      travel?: number;                  // NEW: rise as a fraction of H for the reference group (0.45)
      amplitude?: number[];             // NEW: per-group travel multiplier ([0.42, 1, 1.2]); same clock
      duration?: number[];              // NEW: [0.43, 0.77, 0.8]
      ease?: Ease[];                    // [[0.055,0.519,0.22,0.918],[0.232,0.253,0,1],[0.226,0.222,0.004,1]]
      widen?: { part: string; from?: number /* 0.6 of final spread */; duration?: number /* 0.77 */ };
      phase?: number }                  // NEW: start the move this far in (s): "cut into motion" (0.1)
  | { t: TimeRef; type: 'type' | 'backspace'; target: string; text?: string; cps?: number /* 30 */; chunk?: 'char' | 'word' }
  | { t: TimeRef; type: 'click'; target: string; press?: number /* 2–3 f dip */ }
  | { t: TimeRef; type: 'hover' | 'select'; target: string }
  | { t: TimeRef; type: 'hover-lift'; target: string;
      scale?: number /* 1.088 */; in?: number /* 0.3 */; hold?: number /* 0.63 */; out?: number /* 0.27, easy-ease */;
      veil?: { detail?: number /* 0.32 */; white?: number /* 0.6 */; blur?: number /* px */; lag?: number /* 0.13 */; in?: number /* 0.4 */; out?: number /* 0.33 */ };
      glow?: string /* '#d5aafd', radial, near the cursor */; select?: boolean /* checkbox + accent code, persists */ }
  | { t: TimeRef; type: 'state'; to: string;
      titles?: 'retype';                                              // NEW: old backspaces while new types (≈ 6 f)
      rowsOut?: { order: 'bottom-up'; stagger: number /* 1/30 */ };  // NEW
      rowsIn?: { order: 'top-down'; stagger: number /* 1/30 */ };    // NEW
      cardsIn?: { stagger: number /* 2/30 */ } }                      // NEW
  | { t: TimeRef; type: 'callout'; target: string; zoom?: number /* 1.6 */; side?: 'left' | 'right';
      shape?: 'box' | 'band';           // NEW: band = full-width loupe with its own pan (T18)
      retype?: boolean;                 // NEW: the enlarged text re-types at 1 char/f
      veil?: number }                   // NEW: 0.5 white over the rest
  | { t: TimeRef; type: 'draw'; target: string /* route id */; duration: number /* 0.87 */; from?: 'start' | 'end'; ease?: Ease }
  | { t: TimeRef; type: 'pulse'; target: string; radius?: number /* 255 @1080 */; grow?: number /* 0.5 */;
      period?: number /* 1.0 breathe */; color?: string; colorTo?: { color: string /* '#b1001d' */; at: TimeRef } }  // NEW fields
  | { t: TimeRef; type: 'highlight'; target: string; style?: 'box' | 'sweep' | 'underline-follow' /* NEW */; color?: string }
  // ── NEW ──
  | { t: TimeRef; type: 'pop'; target: string /* 'marker:*' */; stagger?: number /* 0.1 */; overshoot?: number /* 0.1, 4 f */ }
  | { t: TimeRef; type: 'tooltip'; target: string; content: string | Record<string, unknown>; duration?: number /* 0.23, expo-out, from pointer tip */ }
  | { t: TimeRef; type: 'focus'; target: string; veil?: number; blur?: number; duration?: number }
  | { t: TimeRef; type: 'tour'; targets: string[]; every?: number /* 0.17 list sweep; 0.53 for stacks */; action?: 'hover' | 'hover-lift' }
  | { t: TimeRef; type: 'submit'; target: string; next?: string;
      history?: { max: number /* 3 */; opacity?: number[] /* [0.7, 0.45, 0.2] */; lift?: number /* 24 @1080 */; shrink?: number /* 0.9 per step */ } }
  | { t: TimeRef; type: 'notify'; app?: string; title: string; body?: string; stack?: { shrink: number /* 0.95 */; dim: number } }
  | { t: TimeRef; type: 'fill'; target: string /* progress bar | ring */; to: number /* 0–100 */; duration: number };

// ui layer additions
// cursors?: { id: string; name?: string /* pill label */; color?: string; path?: 'wander' | Vec[]; seed?: number }[];   // NEW (T34)
// device?: … | 'plate-stack';  plates?: { colors: string[]; offset: Vec /* [-75,-75] @1080 */; collapse?: number /* 0.5 */ }  // NEW (T17)
// map kind: { roads: 'procedural' | asset; routes: { id; points: Vec[]; color? }[]; markers: { id; kind: 'truck' | 'bin' | 'badge'; at: Vec; value? }[] }
```

### 7.4 AI knowledge (`motion_guide {topic: 'ai-launch'}`, P10)

**Beat recipe for a 60–75 s music-only AI SaaS launch.** Percentages are of the runtime.

| Beat | Share | Content |
|---|---|---|
| Typed claim → type-through → "Powered by AI" | 9 % | Dark mesh, dot-wave, glyph converge |
| Name reveal | 8 % | Giant-type pan → zoom-out → glow-ring title → icon-tile field |
| Product proof | 23 % | Light world: assemble + headline + callouts, then a walkthrough on one UI with `state`/`hover-lift`/`tour`, then a "unified" stack |
| Problem → question | 12 % | Dark map, route, pulse → red, alert cards, "But what happens next?", light wipe |
| AI feature | 14 % | Giant word → chat box → submit stack → sparkle → waveform |
| Mobile, then collaboration | 7 % | Phone plus notification stack; multiplayer cursors |
| Industries and claims | 14 % | Photo grid + typed pills → morph to sparkle → tag wall → "Track what Matters" on a tilted UI |
| CTA → URL → logo → end card | 13 % | Globe, shrinking URL, ring + shield build, mask-slide, inverted end card |

**Rules:**
- Alternate dark and light worlds at each section.
- Start every section with type, then prove it on UI.
- Keep the camera drifting through holds.
- Stack events every ~16 f and sweep lists at ~5 f/row.
- Cut into moves already under way.
- Put hard cuts on ease-in exits or at the peak of a whip.
- Lift only the row that matters, and let the others be passed over.

### 7.5 Assets

- **Inter** (OFL) through the P2 bundle.
- **Lucide** icons (ISC) as listed in §7.1.
- Photos of workers and trucks: `find_free_media` or `generate_local_media`.
- **The map:** generate stylised roads procedurally (a Voronoi or street-grid generator in the `map` kind). If
  you use OSM extracts instead, they carry the ODbL attribution requirement, so don't bundle them silently.
- **The phone:** draw it as vector shapes (a rounded body plus an island). Don't ship Apple artwork.
- **The WasteProtection shield:** an SVG via `import_brand_logo` (P1).

### 7.6 Blender (P7)

- **Only the globe needs real 3D:** a sphere with a dotted-continent emission texture, a magenta
  Fresnel rim, scanlines as a compositor overlay, and a slow rotation.
  - Render it as `render_3d_scene {preset: 'globe-dots'}`: about 150 frames, RGBA.
  - Or build it as a P6 fake sphere with a sliding dot texture.
- **Everything else is 2.5D planes:** the tilted dashboard, the screen stack, the plate stack and the icon field.

---

## 8. Recreate recipe: the dashboard walkthrough (10 s, f386–f685, film 12.83–22.83 s)

**What the 10 s covers:** the light world cuts in mid-assemble → headline words → two callouts →
crane-up → close-up → cursor to "Bins Pickup" → click → page swap → hover-lift on C001 → a quick sweep
down the rows → click "Routes" → page swap.

Scene time 0 = film f386. Convert with t = (f − 386)/30.

**Tool calls** (after P3 ships; NEW marks tools and fields that don't exist yet):
1. `create_brand_kit {name: "WasteProtection", colors: ["#7600f6", "#a266f9", "#efedf2", "#0c0c0c", "#b1001d"], fonts: ["Inter"]}`, then `import_brand_logo {path: "wp-shield.svg"}` (vector with P1).
2. `motion_guide {topic: "ui-walkthrough"}` (NEW, P10). It returns the §4 tokens.
3. `create_ui_screen {kind: "dashboard", theme: "light", brand: "WasteProtection", content: {nav: ["Dashboard", "Bins Pickup", "Scheduler", "Operator", "Report", "IoT Devices", "Routes", "Vehicle Stats", "Drivers"], stats: [["Avg. Bin Fill Levels", "60%"], ["Bins Picked Up", "25 Bins"], ["Bin Pickup Efficiency", "99.0%"], ["Waste Collected", "1,679 T"], ["Active IoT Devices", "21"]], table: "iot-devices", map: true}, states: ["dashboard", "bins", "routes"]}` (NEW, P3). It returns `ui:wp-dashboard` with its part map.
4. `create_motion_scene {scene: …}` with the sketch below. It is one scene with two `ui` layers (the wide shot, then the close-up after a hard cut) and 9 layers in all, so about 9 clips instead of about 25.
5. SFX (optional and sparse, since the film is music-only):
   - `place_sfx {query: "soft whoosh", at: 2.1}`;
   - `place_sfx {kind: "click", at: 4.2 / 8.7}`;
   - `place_sfx {query: "typing short", at: 4.23}`;
   - `place_sfx {query: "glass tick", at: 5.63}`.
6. Check:
   - `run_frame_qa {pacing: "ai-launch"}` (NEW pacing check: assemble lead, lift in/hold/out, cadence);
   - `consult_council`;
   - a side-by-side contact sheet against f386–685.

```jsonc
{
  "version": 1, "width": 1920, "height": 1080, "duration": 10.0, "background": "#efedf2",
  "motionBlur": { "samples": 8, "shutter": 180 },                                          // for the crane exit; the type itself has no blur
  "cues": [ { "at": 2.1, "sound": "whoosh" }, { "at": 4.2, "sound": "click" }, { "at": 8.7, "sound": "click" } ],
  "layers": [
    // ── Shot A · 0–2.4 s (f386–457): wide light world ──
    { "id": "glow", "type": "procedural", "kind": "radial-glow", "out": 2.4,
      "params": { "inner": "#e2c0fc", "outer": "#efedf2", "center": [1.0, 0.95], "radius": 0.7 } },
    { "id": "crane", "type": "null", "out": 2.4,                                              // the whole layout cranes up into the cut (T13)
      "transform": { "position": { "k": [ { "t": 2.1, "v": [0, 0], "ease": "cubic-in" }, { "t": 2.4, "v": [0, -290] } ] } } },
    { "id": "pill", "type": "precomp", "parent": "crane", "out": 2.4, "transform": { "position": [960, 84] },
      "scene": { "…": "rect 330×48 radius 24, stroke #7600f6 2.25 px, Inter 500 16 px 'Waste Management Platform'" } },
    { "id": "headline", "type": "text", "parent": "crane", "out": 2.4, "transform": { "position": [960, 190] },
      "text": { "spans": [ { "text": "All In One\n", "color": "#000000", "weight": 500 }, { "text": "Integrated System", "color": "#7600f6", "weight": 700 } ],
        "font": "Inter", "size": 100, "align": "center", "lineHeight": 1.0,
        "cascade": { "by": "word", "times": [0.1, 0.233, 0.367, 0.5, 0.633], "duration": 0.33,
                     "ease": [0.055, 0.519, 0.22, 0.918], "from": { "position": [0, 30], "opacity": 0, "blur": 10 } } } },
    { "id": "dash-wide", "type": "ui", "parent": "crane", "out": 2.4,                          // NEW layer type (P3)
      "transform": { "position": [960, 700], "scale": 100 },
      "ui": { "source": { "asset": "ui:wp-dashboard" }, "device": "glass-card", "theme": "light", "state": "dashboard",
        "actions": [
          { "t": 0, "type": "assemble", "phase": 0.1,                                       // cut into a move already under way
            "groups": [ ["header", "welcome"], ["sidebar"], ["stats", "table", "map", "charts"] ],
            "lead": 0.11, "travel": 0.45, "amplitude": [0.42, 1.0, 1.2], "duration": [0.43, 0.77, 0.8],
            "ease": [ [0.055, 0.519, 0.22, 0.918], [0.232, 0.253, 0.0, 1.0], [0.226, 0.222, 0.004, 1.0] ],
            "widen": { "part": "header", "from": 0.6, "duration": 0.77 } },
          { "t": 0.833, "type": "callout", "target": "#welcome", "zoom": 1.6, "side": "left", "retype": true, "veil": 0.5 },
          { "t": 0.867, "type": "callout", "target": "stat:Avg. Bin Fill Levels", "zoom": 1.6, "side": "right", "veil": 0.5 }
        ] } },

    // ── Shot B · 2.4–10 s (f458–685): close-up on the purple stage ──
    { "id": "stage", "type": "procedural", "kind": "linear-gradient", "in": 2.4,
      "params": { "from": "#b064f7", "to": "#e8d8f6", "angle": 90 } },
    { "id": "dash", "type": "ui", "in": 2.4, "threeD": true,
      "transform": { "position": [1000, 640], "scale": 150 },
      "ui": { "source": { "asset": "ui:wp-dashboard" }, "device": "glass-card", "theme": "light",
        "cursor": { "style": "arrow", "color": "#7c00ff" },
        "actions": [
          { "t": 3.17, "type": "hover", "target": "nav/Bins Pickup" },                    // auto path: 15 f glide
          { "t": 4.2, "type": "click", "target": "nav/Bins Pickup" },
          { "t": 4.23, "type": "state", "to": "bins", "titles": "retype", "rowsIn": { "order": "top-down", "stagger": 0.033 } },
          { "t": 5.63, "type": "hover-lift", "target": "row:C001", "scale": 1.088, "in": 0.3, "hold": 0.63, "out": 0.27,
            "veil": { "detail": 0.32, "white": 0.6, "blur": 3, "lag": 0.13, "in": 0.4, "out": 0.33 },
            "glow": "#d5aafd", "select": true },
          { "t": 7.1, "type": "tour", "targets": ["row:C002", "row:C003", "row:C004", "row:C005", "row:C006"], "every": 0.17, "action": "hover" },
          { "t": 8.7, "type": "click", "target": "nav/Routes" },
          { "t": 8.77, "type": "state", "to": "routes", "titles": "retype",
            "rowsOut": { "order": "bottom-up", "stagger": 0.033 }, "cardsIn": { "stagger": 0.067 } }
        ] } },
    { "id": "cam", "type": "camera", "in": 2.4,                                              // P3 camera helpers (plan) with measured values
      "push": [ { "t": 2.4,  "target": "sidebar", "zoom": 1.0,   "duration": 0.73, "ease": "sine-out" },           // rise + slow scale
                { "t": 4.23, "target": "table",   "zoom": 0.9,   "duration": 0.57, "ease": [0.6, 0, 0.4, 1] },     // reframe after the swap
                { "t": 5.53, "target": "row:C001", "zoom": 0.967, "duration": 1.43, "ease": "linear" },            // ×1.075 slow push
                { "t": 7.8,  "target": "nav/Routes", "zoom": 1.05, "duration": 0.67, "ease": [0.6, 0, 0.4, 1] } ],
      "drift": { "px": 1.5 } }                                                               // NEW: never fully static
  ]
}
```

**Today's fallback, without P3:**
1. Build the dashboard with `create_motion_graphic` (HTML) and export 3 PNG states. Import them as footage.
2. Split the assemble into 3 footage layers (header, sidebar, body), each cropped with a rect `mask`, with
   the B1/B3/B4 position keys.
3. Build each callout from a duplicated footage layer, masked (radius 24), scaled 160, plus a stroked
   rect and a white solid veil with an inverted mask.
4. Build the hover-lift from a masked row duplicate at scale 108.8 with `drop-shadow`, plus a
   veil solid and a `gaussian` adjustment keyed with the C1–C5 timings.
5. Build the cursor as a `path` arrow in the `dock-cursor` pattern.
6. Retype the titles as text layers with `reveal` keys.
7. That is about 25 layers, so pass `nest: false` or use a precomp to avoid 25 timeline clips.

---

## 9. Top 10 improvements

| # | Improvement | Size | Why (this film) |
|---|---|---|---|
| 1 | **P3 MVP scoped to this walkthrough**: `ui` layer + part map + `assemble`/`callout`/`click`/`state`/`hover-lift`/`focus`/`tour` + the automatic cursor + `camera.push`/`follow`, with the §4 defaults | L (the MVP is M) | 17 s of product proof, and the plan's acceptance test; today it is about 25 hand-keyed layers |
| 2 | **`giant-type-pan` template / P4 `type-pan` move**: landing `(0.058, 0.519, 0.254, 1)` + drift 0.74 % W/f, S-hop `(0.627, 0.085, 0.336, 0.862)` over about 60 f, whip exit, velocity-matched hand-off, a gradient word via a matte | S | Used 3 times (Introducing, Arlo, SmartOps); the plan's numbers were wrong |
| 3 | **`TIMING` tokens from this film**: landing, hop, assemble (lead 3 f, amplitude 1.2×, header 13 f / body 23 f), hover-lift (9/19/8 f, ×1.088, veil lag 4 f, 32 %), word stagger 4 f, stack cadence 16 f, list sweep 5 f/row, logo ring 22 f | S | Cheap and high-leverage; they feed pacing QA |
| 4 | **`dot-wave` and `mesh-gradient` as fragment-shader procedurals** (no instancing needed) | S each | The opening ground and the whole dark world; unblocks them before P5's instanced path |
| 5 | **P2 `cascade.from.scatter` + per-unit `from` sides** | S | Glyph converge (T5) and converging words (T25) |
| 6 | **P2 typing: `wake {mode:'band', snap}` + `fit:'width'` + a block caret**, and the **`type-through`** transition | S–M | The opening 3.6 s; the snap-to-white is this film's signature, not a fade |
| 7 | **Ring kit**: `glow-ring` shockwave (6 f reveal / 17 f light wipe), `pulse {radius, period, colorTo}`, and the orbit ring and logo-ring build as presets | S | Rings are the film's second motif (T7, T8, T23, T26, T43) |
| 8 | **P3 `map` kind** with procedural roads, `routes[]`/`markers[]`, and the `draw`/`pop`/`tooltip`/`pulse` actions, plus the radial reveal | M | The dark-map beat (8.5 s) and the problem statement |
| 9 | **P3 `chat` and `phone-lock` kinds with `submit` and `notify` stacks**, and `ui.cursors[]` | M | The AI section (T27, T28), mobile (T32) and collaboration (T34), about 12 s |
| 10 | **Sparkle motif pack**: a P1 bezier concave sparkle, the grid → diamond → sparkle morph, `shape-wipe` with the sparkle, and an `ai-waveform` template (dashed trim + echo sine strands via a phase-offset repeater) | M | T29, T30, T37; the AI glyph that carries continuity |

The next items would be the **`plate-stack` device frame** and the **magnifier band** (S), and
`whip {cutAtPeak}` (S).

---

**Measurement files** (all in `out/J6A7JcbkWvM/`, local only):

| File | Contents |
|---|---|
| `measure_signature.py` → `measure_signature.json` | **NEW.** Pan tracker (edge phase correlation, f199–312), UI assemble template matching (f386–410), bezier fitter with x1, x2 ∈ [0, 1] |
| `measure_hover.py` → `hover_lift.json` | **NEW.** ECC-stabilised row C001 scale and per-row detail, f548–640 |
| `measure_header.py` | **NEW.** "Ask Arlo" x/y through the settle; giant-type cap height |
| `measure_sync.py` | **NEW.** Chance baseline, binomial p, 134 bpm grid, event offsets |
| `fits.py` → `fits.json`, `fits2.py` → `fits_clean.json` | **NEW.** Free and clean bezier fits, preset comparison, the ease + drift model |
| `measure_moves.py` → `measure_moves.json` | Earlier analyst's script. Its logo/map/phone series are used; the Arlo track is superseded (§4.3) |
