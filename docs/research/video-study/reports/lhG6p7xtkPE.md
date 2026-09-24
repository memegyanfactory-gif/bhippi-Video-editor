# Limelight (lhG6p7xtkPE): video-study report

*2026-09-25. Burnwe for Limelight: a SaaS explainer, 65.04 s, 25 fps, 1920×1080, with voice-over and music.*

**Sources.**
- The frame-by-frame notes in `out/lhG6p7xtkPE/notes.md`.
- 18 frames re-checked by eye: f4, f17, f239, f283, f328, f359, f364, f438, f440, f442, f577, f591, f935, f1030, f1042, f1052, f1110 and f1276.
- `out/lhG6p7xtkPE/measure.py`, which writes `measure.json`. Everything is reproducible with
  `.media-venv/Scripts/python measure.py`.

**Conventions.**
- f is the 1-based frame number, and t = (f − 1)/25.
- Pixels are at 1080p. The kit's frames are 720p, scaled ×1.5.
- Angles use Helios's sign convention and its default 50 mm camera (`DEFAULT_ZOOM_RATIO`, `src/motion/evaluate.ts:48`).
- The top-left "Video Created by burnwe" badge was masked out of every measurement.

**What matters most**

1. **The background never cuts, but the foreground does, about 15 times.** The kit counted 4 shots because it
   only sees colour jumps. The film's continuity comes from an unbroken lavender world plus bridges: the
   cursor, the dot, z-recede and scale cuts. It does not come from having few cuts.
2. **One curve runs the camera: "creep, snap, settle".** A slow ease-in, then about 60% of the travel in 2
   frames, then a long expo-out. It is used for:
   - the dashboard tilt-in;
   - the push into the chart: `cubic-bezier(0.943, 0.026, 0, 0.998)`, rmse 0.003;
   - the logo's move to the corner;
   - the z-recede.
3. **The cursor is one object for the whole middle of the film.** It starts as a UI toggle knob (96 px),
   shrinks into the 40 px cursor, ticks the inline pills, then grows into the 100 px logo dot that the
   brackets converge on.
4. **Text and voice-over follow three different rules:**
   - Headlines **lead** the voice-over by a median of 0.56 s.
   - Payoffs (the counter, the chart spike, the wordmark, the "hundreds" block) **land on the word**, within ±0.2 s.
   - Typed lines are **paced to the spoken phrase**. They start within 0.4 s of the first word and finish 0.28–0.32 s before the last word.
5. **A layer of UI ticks is frame-synced.** 18 of 25 on-screen UI events have a click transient under 4 ms
   within ±1.5 f. By chance you would expect 8.4.

---

## 1 What the film is

A 65 s product explainer for a B2B influencer-marketing platform. It follows the classic SaaS arc:

| Act | Time | What happens |
|---|---|---|
| Hook | 0–5.8 s | The stat |
| Problem | 5.8–13 s | Research hell |
| Question | 13–16.8 s | "What if…" |
| Reveal | 16.8–23 s | Logo and positioning line |
| Features | 23–53 s | Discover, storefront, bulk proposals, campaigns, CRM, analytics |
| ICP proof | 53–58 s | |
| CTA and logo | 58–65 s | |

**How it's built.**
- There is **no illustration and no character.** It is made of real-looking product UI:
  - a LinkedIn feed with stock talking-head video playing inside a post;
  - a creator list, a search bar, a Gmail inbox, analytics, CRM tables and storefront cards;
  - kinetic type with inline face-pile pills.
- Everything sits in a **near-white lavender world** with drifting diagonal window-light shafts and a
  periwinkle glow at the bottom.
- The voice-over is dense: 156 words in 60.2 s, about **155 wpm**.
- The picture changes on nearly every clause, but it never "cuts" in the sense of the whole frame changing:
  - The background plate runs continuously from f1 to about f1550, where it fades to white.
  - The kit detected only 3 cuts (at f146, f1011 and f1330). There are about **15 foreground swaps**:
    f146, f239, f327, f421, f625, f719, f813, f912, f979, f1011, f1064, f1236, f1330, f1380, f1446 and f1512.
  - The mean foreground shot is about 4.3 s.

**Motion character.**
- Almost nothing floats in slowly. Elements pop hard (1–2 f) or snap (2-frame velocity spikes inside
  1–1.5 s moves), then settle with long expo-out tails.
- Micro-staggers of 1–2 f run on every repeated element.
- A camera drifts or pushes at 0.1–1% per frame during every hold.

The style is "real UI, directed like a camera operator", not "motion graphics on UI".

---

## 2 Beat-by-beat breakdown

The VO column paraphrases the caption words.

| # | Frames | t (s) | VO | Picture and motion | Way in |
|---|---|---|---|---|---|
| 1 | 1–64 | 0.00–2.56 | "It's no secret that B2B influencer marketing…" | A phone-shaped frosted card holds a LinkedIn post (**stock video playing**). It rises 373 px (expo-out) and focus-pulls σ 24 → 0. The post's video wipes open top-down (f8–12). **"B2B" hard-pops on f19**, and "Influencer / Marketing" slides up f20–32. Reaction emoji pop with a **1 f stagger** (f21–23). The keyword colour sweeps to blue f45–55. The feed scrolls one post (f53–64, 12 f ease-in-out) | Opens from white; the bg fades in over f1–2 |
| 2 | 65–145 | 2.56–5.80 | "…offers the highest ROI for brands today" | The whole layout pushes left (ease-in, f65–80). Three glass stat cards arrive: ROI bars growing, an engagement **counter 0 → 5.3% linear over 24 f landing on "ROI"**, and a Target list. The camera drifts, then an accelerating tilt-up (f133–145) runs into the cut | World push |
| 3 | 146–238 | 5.80–9.52 | "But managing even one collaboration can be frustrating" | A creator list. Rows settle like an accordion (index-proportional travel, 10–12 f). The black-dot cursor hovers each row, and a red "Not Fit" pill pops at its end (f160, f176, f180, each with a UI tick). The list steps up one row per reject (5–8 f) | Hard cut 0.16 s before "but" |
| 4 | 239–326 | 9.52–13.04 | "…due to endless research, dozens of emails and unclear results" | A lone search bar. The query types at 54–75 cps, with a skeleton result bar every 2 f. A "noise" collage slides in from three sides (analytics strip, mail inbox rising 14 f, email-row card). **Backspace and retype ×3** (deleting at 100–125 cps). It exits by pulling back ×0.9 with blur (f321–326) | **Cursor bridge** (f238 → 239) |
| 5 | 327–420 | 13.04–16.80 | "But what if you could manage hundreds of partnerships at once?" | "What if you / could manage" lands with a tracking and scale settle (6–8 f). Below it: an empty pill → arrow → a face-pile pill that fills with a 1 f stagger. **Z-recede** (f355–361): the block shrinks to about 0.6, rises and blurs into a ghost. "hundreds of [pill] / [pill] partnerships / at once → ? ○ ○ ●" **pops on "hundreds"** (f362) and rises in 13 f. Blue checks pop into the pills (f377, f390). **The ● toggle knob slides, shrinks into the cursor** (f380–394), ticks the pills, then flies to the centre, growing (f396–420) | Cut 0.24 s before "but"; z-recede |
| 6 | 421–468 | 16.80–18.72 | "Introducing Limelight" | **The brackets converge on the dot** (spread 1125 → 144 px in 13 f). The mark shrinks to 59% and slides left while "Limelight" **slides out from behind it** (f436–447, landing on "Limelight"). A slow push, then the logo snaps to the top-left (f457–472) | The dot is the logo dot |
| 7 | 469–576 | 18.72–23.04 | "the first B2B influencer partnership platform, making brands go viral on demand" | The dashboard window whips in from the right (1–2 f, settled by f477). The tagline lines rise 20 px and fade in over 4 f each, with a 7 f stagger (f469, f476, f483). A text swap at f529–537. Constant drift and push | Snap whip-in |
| 8 | 577–718 | 23.04–28.76 | "With Limelight quickly discover and match with the top verified B2B creators…" | **Snap tilt-in to 3D**: rotY −25°, rotX −16.6°, ×1.44 (f577–612). The cursor clicks "Creators", then a **hard in-app page swap** (f625). The tilted page scrolls with a push, and the cursor visits "Add to Campaign". It falls away (4 f whip, f714–718) | Snap |
| 9 | 719–812 | 28.76–32.48 | "…easily connect and collaborate with one click on their storefronts" | The storefront card straightens from a 3D tilt (7 f ease-out). Its gradient header **types** "Easily connect & collaborate" at 1 char/f. A push-in. Click (f797): label → spinner → check (f797–812). The card shrinks ×0.45 in 3 f | 3D straighten |
| 10 | 813–911 | 32.52–36.40 | "…or send bulk proposals in seconds, avoiding ghosted DMs" | A three-row marquee wall of person cards, rows in opposite directions (linear). Click (f851): the dark button swaps to indigo "Proposals sent" in 1 f. Indigo check circles pop and a check stroke draws, spreading with a 6/6/4 f stagger | Hard-ish cut |
| 11 | 912–1010 | 36.44–40.40 | "Need specific creators for a campaign? Launch a live creator campaign" | A typed headline with **depth-of-field chips** (size and blur encode z; a huge blurred "Branding" in the foreground). The camera trucks. Swap (f979) to "Live Creator Campaign" with a defocused green "ACTIVE" in the foreground | Soft swap |
| 12 | 1011–1063 | 40.40–42.52 | "…and let them come to you" | **Punch-in cut ×3** on the same card. Four avatars pop along its edge (2–3 f stagger), then **collapse into a face-pile** (×0.45, arcs, 2 f stagger) with a **+3 → +10 counter at 1 step per frame** | Scale cut |
| 13 | 1064–1213 | 42.52–48.52 | "Our creator CRM automates onboarding, budgeting and tracking and centralizes all communications and workflows" | **Pull-back cut ×⅓** to the CRM window, then a drift. A 3D swing with a 1.6× push (f1100–1112) while the **stat cards lift off in z** with separated shadows. The title "Centralizes all" appears, and line 2 types over the tilted UI. Exit f1209–1214 | Scale cut |
| 14 | 1214–1329 | 48.52–53.16 | "Plus it offers real-time analytics to measure ROI and channels like LinkedIn" | A thin ⊗ rotates 45° into ⊕ (6 f) on "plus". Hard cut to analytics (f1236). **Snap push ×1.47** (f1246–1269). **The line chart draws** (45 f), and its spike tops out on "ROI". A tilt down to the table, then a row-highlight wipe (3 f) | Icon morph + cut |
| 15 | 1330–1379 | 53.16–55.12 | "…and quickly identifies your ICPs" | A pure type card that drifts | Cut on "and" |
| 16 | 1380–1445 | 55.20–57.76 | "…who are engaging with creator content" | A portrait and three lead cards at different depths. They arrive 1.3 → 1.0 in 3–4 f, then parallax-drift | Scale settle |
| 17 | 1446–1511 | 57.80–60.40 | "Time to unlock your most valuable growth channel" | A typed line over a **defocused settings UI** used as texture. Line 2 in blue rises over 2 f | Soft cut |
| 18 | 1512–1626 | 60.44–65.04 | "…with Limelight" | Logo mark alone. A wordmark mask-slide (f1521–1528), then a **3.9 s hold**. The glow fades to white (f1550–1600) and the tracking relaxes about 2% | Cut 0.28 s before "with" |

---

## 3 Technique catalogue

**How to read the Helios status column:**
- **Today**: a template or tool covers it.
- **By hand**: the engine can express it in a raw `create_motion_scene`, but no template or guide teaches it, and the AI doesn't know to do it.
- **NEW**: it needs something the engine doesn't have. The pillar it belongs to is given in brackets.

| # | Technique | Frames | What it is (measured) | AE build | Helios status |
|---|---|---|---|---|---|
| L1 | Continuous lavender world | all | Vertical gradient `#e9ecf5` → `#cdd4f0`, a periwinkle radial glow at the bottom, and soft diagonal window-light shafts (about 60°) drifting slowly. It never cuts, and fades to white at the end | Gradient solid, radial glow, and 3–5 heavily blurred white strips at 60° with slow position wiggle, at 20–40% opacity | Gradient and glow **today** (`linear-gradient`, `radial-glow`). Shafts are **NEW**: procedural `light-shafts` (P5, S) |
| L2 | Card rise + focus pull + fade | 1–35 | Rise 373 px, `cubic-bezier(0.149, 0.844, 0.113, 0.98)`. Opacity 0 → 100 in about 5 f. Gaussian σ 24 → 0 px, halving about every 2.5 f | Position keys with an expo-out graph; Camera Lens Blur keyed; opacity | **By hand** (keys + `gaussian-blur` `blurriness` 48 → 0). The curve isn't a token (P10) |
| L3 | **Video inside a UI part** | 2–64 | A stock talking-head video playing inside the post frame, revealed by a top-down wipe (f8–12) while already playing | Footage precomp, rounded-rect mask, parented to the card, with a wipe mask | **By hand** (footage + rect `mask` with `radius`, positioned manually). Auto part geometry is **NEW** (P3; see §7 `attach`) |
| L4 | Hard-pop word + slide-up line + colour sweep | 19–55 | "B2B" fully visible in 1 f (no fade) with a UI tick. The second line rises in 12 f. Keyword fill goes dark → azure over 10 f, sweeping | Text Animator Fill Colour with the range-selector offset keyed | **Today** (`animators[].props.fillColor` + `offset`) |
| L5 | Micro-pop staggers | 21–23, 377–390, 869–885, 1018–1024 | Emoji 1 f apart; checks 2 f; avatars 2–3 f; select-checks 6/6/4 f. Each pops from 0 in 2–3 f | Scale keys with a layer offset sequence | **By hand**. A stagger helper for non-text layers is **NEW** (P10 token) |
| L6 | Counter landing on the word | 80–104 | 0 → 5.3% linear over 24 f, ending 0.04 s before "ROI" | Slider-driven source text | `counter` **today**. Landing on a word is **NEW** (`TimeRef` with `edge:'end'`, §7) |
| L7 | World push / camera drift | 65–80, holds | The layout slides as one world (ease-in), then drifts 0.5–1.5 px/f during holds | Parent to a null; wiggle-free linear drift | **By hand** (null parent). World layout is P4 |
| L8 | Accordion row settle | 146–157 | Row gaps converge from uneven to uniform; travel is proportional to row index; 10–12 f ease-out | Per-row position keys with offset | **By hand**. P3 `assemble` |
| L9 | Status pill pops on hover | 160–220 | A red "Not Fit" pill (icon + label on pale red) pops in 2 f at the row end when the cursor arrives, with a UI tick within ±1.2 f | A pill precomp with scale/opacity keys | **NEW** UI action `status` (P3, §7) |
| L10 | **Cursor-bridged cut** | 238 → 239 | The foreground swaps while the 40 px dot stays put. The swap falls at the dot's **velocity minimum** (2 px/f, against 9–22 px/f 5–8 f before and after) | The cursor on the top layer across two precomps; cut under it | **By hand** in one scene. As a rule plus transition it's **NEW** (P4 `cursor-bridge`, refined in §7) |
| L11 | Typing field with retype cycles | 240–311 | Types at 54–75 cps, backspaces at 100–125 cps, three query cycles, a skeleton result bar every 2 f, a blinking caret | Source-text typewriter + Text Animator; hand-keyed backspace | `reveal` can't change strings. P2 `script` (NEW) |
| L12 | "Noise" collage | 258–326 | Greyed analytics strip from the top, mail inbox from the bottom (14 f ease-out), email card from the right. Exit: pull-back ×0.9 + blur in 6 f | Three precomps with offset keys | **By hand**. UI assets are P3 |
| L13 | Tracking + scale settle on kinetic type | 327–333 | "W hat if you" lands with wide tracking that tightens, from slightly larger scale, in 6–8 f. The face-pile avatars slide in 1 f apart | Tracking and scale animators with offset | **Today** (`cascade.from.tracking/scale`). The pill row is by hand |
| L14 | **Z-recede exit → pop-rise entrance** | 355–375 | Old block, ease-in: width 1.0 → 0.90 (f359) → 0.70 → 0.65 (f361); rises 224 px; blurs; ends as a ghost of about 0.6 at about 30% opacity. **New block pops sharp** at f362, 147 px below its rest position with loose tracking, and rises in 13 f expo-out (no scale-in) | Scale/position/blur keys with a snap graph; tracking animator on the new block | **By hand**. P4 `z-recede` exists as an idea but has the wrong numbers (§7.1) |
| L15 | **Inline face-pile pills in type** | 356–392 | Pills at the end of line 1 and start of line 2 hold 6–7 overlapping portraits and an empty check slot. The cursor ticks them, and a blue check pops in 2 f | Separate precomps hand-placed in gaps made with spaces | **NEW** (P2 `inline`, refined in §7 so pills are targetable and move with the animators) |
| L16 | **Continuity dot** (knob → cursor → logo) | 380–421 | The toggle knob (96 px) slides right f380–388, shrinks to the 40 px cursor while arcing up (f388–394), ticks the pills, dives and returns, grows 40 → 81 px on the way to the centre (f410–420), and becomes the 100 px logo dot at f421 | One shape layer with a position path and size keys | **By hand** in one scene. Across beats it's **NEW** (P4 `guide` with size per role, §7) |
| L17 | **Brackets converge on the dot** | 421–434 | Two L-corners (72×118 px) move **horizontally only**, spread 1125 → 144 px, `cubic-bezier(0.134, 0.793, 0.264, 0.957)`, 50% at 1.6 f. The dot drops 100 → 81 px in 1 f, then to 73 | Two shape layers with position keys | **By hand** (the L-corners are straight-segment `path` points; **no P1 needed**). The template `dot-logo-converge` is **NEW** |
| L18 | **Wordmark mask-slide** | 435–447, 1521–1528 | The mark scales to 59% (8 f) and slides left 266 px (11 f, ease-in-out). The word emerges from behind the mark's right edge, whose leading edge follows expo-out (10 f), with letters trailing and motion blur on f438. The lockup ends centred | A track matte at the mark edge; a word slide; per-letter position offset | **By hand** (keyed rect `mask`); `brand-logo-sting` is only partial. Worth a helper (P4) |
| L19 | **Snap tilt-in to a 3D UI plane** | 577–612 | rotY 0 → −25.0°, rotX 0 → −16.6°, rotZ +1.8°, ×1.44, centre (−439, +194) px. Creep 14 f → **2 f snap** → 21 f settle | A 3D layer with Easy Ease at 90–100% influence and motion blur | **By hand** (`threeD`, cubic-bezier keys). The UI is only a picture (P3). A `snap` token is **NEW** |
| L20 | In-app page swap + tilted scroll + clicks | 591–718 | A click on the sidebar, then a hard content swap (like a real app), then a scroll inside the tilted window with a push | A precomp swap + scroll keys | **NEW** (P3 `click`, `state`, `scroll`) |
| L21 | 3D straighten entrance | 719–725 | The card enters tilted and straightens (rotX/Y → 0) in 7 f ease-out | 3D rotation keys | **By hand** |
| L22 | **Button state machine** | 797–812 | Label → spinner → check icon; dark → indigo `#4337c9` "Proposals sent" swap in 1 f | Precomp with hold keys | **NEW** UI action `button` (P3, §7) |
| L23 | Marquee wall + spreading selection | 813–911 | Three rows in opposite directions at a constant 6–10 px/f. Indigo circles pop, then the check stroke draws (4 f) | Offset rows with `loopOut`; trim paths | Marquee **by hand** (`loopOut`); `select` is P3 |
| L24 | **Depth-of-field chips** | 912–1010 | Tag chips at different z: size and blur encode depth; a huge defocused foreground element | 3D layers + camera DOF | Camera DOF **today**. Per-layer depth blur is P4 `scene.dof` |
| L25 | **Scale cuts** (punch-in / pull-back) | 1011, 1064 | A hard cut to the same card at ×3, then a hard cut back to the full window at ×⅓ | Cut + scale | **NEW** transition `scale-cut` (P4, S) |
| L26 | **Avatar collapse → face-pile + rolling count** | 1018–1053 | Avatars pop along the card edge; then each shrinks ×0.45 and arcs into a stack (2 f stagger); a "+N" chip counts +3 → +10 at 1 step per frame | Per-avatar position/scale keys; slider text | **NEW** UI action `stack` (P3). The counter is **today** |
| L27 | **Z-lifted stat cards** | 1100–1152 | In a tilted window, four stat cards separate from the surface: the shadow is a flat `#d7d7d7` slab offset about 60 px down (blur about 8 px) on `#f3f3f3` | 3D layers with z offset + drop shadow | P3 `lift` (planned); the numbers are in §5 |
| L28 | Icon morph ⊗ → ⊕ | 1214–1220 | A thin 1.5 px ring icon scales up from 0.8 while the × rotates 45° (6 f ease-out), on "plus" | Rotation key | **Today** |
| L29 | **Snap push + line-chart write-on** | 1236–1293 | Push ×1.47 with `cubic-bezier(0.943, 0.026, 0, 0.998)` (60% in 2 f). The line draw takes 45 f with `cubic-bezier(0.641, 0.219, 0.078, 0.978)`. The spike is drawn in the ease-out tail and tops out on "ROI" | Trim paths on the line plus a mask on the area fill | **By hand** (`path` + `trimEnd` + keyed rect `mask`). P3 `draw` |
| L30 | Row-highlight wipe | 1318–1320 | A pale-blue row background wipes left → right in 3 f | Rect mask | **By hand** |
| L31 | Arrive-from-camera settle + parallax | 1380–1445 | The comp scales 1.3 → 1.0 in 3–4 f, then layers drift at depth-dependent rates | Camera push + 3D layers | **By hand**. P4 parallax fields |
| L32 | Defocused UI as texture | 1446–1511 | A settings screen blurred and faded behind the typed CTA | Gaussian blur + opacity | **Today** (`gaussian-blur`) |
| L33 | End card | 1512–1626 | The mask-slide again, a 98 f hold, the glow fades out, tracking relaxes 2% | | **By hand** |

---

## 4 Measured motion grammar

### 4.1 The four fitted moves

Each fit keeps x1 and x2 in [0, 1]. The rmse is on normalised progress.

**M1 · Phone card rise**
- **Frames:** f2–f35 as observed (f1 is blank), 33 f (1.32 s).
- **Amount:** rises 373 px observed. Extrapolated from f1, it's about 436 px.
- **Curve:** `(0.149, 0.844, 0.113, 0.980)`. Free-start fit from f1: `(0.182, 0.852, 0.086, 0.982)`.
- **rmse:** 0.0009 (free-start 0.0008).
- **How the travel builds:** 60% by f6, 75% by f8, 90% by f13, 95% by f17.
- **Blur:** σ 24/18/15/10.5/10.5/7.5/6/4.5/3/2.2/1.5 px on f2–f12, and 0 by f16. In Helios that's `blurriness` 2σ.
- **Opacity:** 0.39/0.50/0.63/0.65/1.0 on f2–f6.

**M2 · Bracket converge**
- **Frames:** f421–f434, 13 f (0.52 s).
- **Amount:** the centre-to-centre spread goes 1125 → 757 → 537 → 409 → 328 → 274 → 236 → 209 → 190 → 176 → 164 → 156 → 149 → 144 px, moving horizontally only.
- **Curve:** `(0.134, 0.793, 0.264, 0.957)`.
- **rmse:** 0.0003.
- **Notes:** 50% at f422.6. The logo's first frame is already at full spread. The dot is 100 px, drops to 81 in 1 f, and settles at 73.5.

**M3a · Wordmark: mark slides**
- **Frames:** f436–f447, 11 f.
- **Amount:** centre x 944 → 678 (−266 px).
- **Curve:** `(0.635, 0.177, 0.109, 0.977)`.
- **rmse:** 0.0015.
- **Notes:** ease-in-out, 50% at f440.3.

**M3b · Wordmark: mark scales**
- **Frames:** f435–f443, 8 f.
- **Amount:** height 114 → 67.5 px (×0.59).
- **Curve:** `(0.386, −0.068, 0.065, 1.001)`.
- **rmse:** 0.0106.

**M3c · Wordmark: word slides out**
- **Frames:** f437–f447, 10 f.
- **Amount:** on screen, the leading edge moves 1160 → 1284 px. Relative to the mark, the word travels about +505 px.
- **Curve:** `(0.032, 0.0, 0.072, 0.816)`.
- **rmse:** 0.0047.
- **Notes:** expo-out. The word is masked at the mark's right edge. Letters trail, and f438 shows motion blur.

**M4 · Dashboard tilt-in**
- **Frames:** f577–f612, 35 f (1.4 s).
- **Amount:** rotY 0 → −25.0°, rotX 0 → −16.6°, rotZ +1.8°, scale ×1.438, centre moves (−439, +194) px. The right edge ends at 0.78 of the left edge's height.
- **Curve, as two keys:** the first segment runs f577 → f591 and reaches 79% of the rotation (71% of the scale); the second runs f591 → f612.

  | | Segment 1 (f577 → f591) | rmse | Segment 2 (f591 → f612) | rmse |
  |---|---|---|---|---|
  | Rotation | `(1.0, 0.093, 0.856, 0.033)` | 0.0028 | `(0.079, 0.602, 0.182, 0.958)` | 0.0115 |
  | Scale | `(1.0, 0.078, 0.872, 0.0)` | 0.0040 | `(0.062, 0.272, 0.028, 0.981)` | 0.0034 |

- **Single-curve approximation:** `(0.706, 0, 0, 1)`, rmse 0.048. It's too coarse; use the two keys.
- **Notes:** the rotation creeps for 12 f, 18% → 79% happens in 2 f (f589 → f591), then an expo-out settle.

### 4.2 Supplementary checks (same script, not part of the four)

| Check | Result |
|---|---|
| **Chart camera snap-push** f1246–1269 (23 f) | ×1.47. `(0.943, 0.026, 0.0, 0.998)`, rmse 0.0034. 60% of the push happens between f1256 and f1258. The M4 curve does **not** fit it (rmse 0.145): the family is the same, but each move has its own keys |
| **Line-chart write-on** f1248–1293 (45 f, 1.8 s) | `(0.641, 0.219, 0.078, 0.978)`, rmse 0.0047, 50% at f1265. It is **not** linear: the fastest part (≈ 35 px/f) is f1262–1268. The final spike (the last 12% of x) is drawn in the ease-out tail. The spike is 93% risen at f1283 = "ROI" (51.28 s). This corrects the notes' "linear, spike in 8 f" |
| **Z-recede** f352–362 | Width 1.0/0.996/0.995/0.989/0.980/0.967/0.945/0.899/0.701/0.652. Centre y −0/−2/−3/−7/−11/−18/−29/−47/−137/−224 px. Accelerating, with a 2-frame snap into the swap. The new block pops at f362 at full scale and sharp |
| **Logo → corner** f457–472 (15 f, unfitted) | x −423, y −269 px, scale ×0.76. 15% by f463, **73% by f465** (a 2-frame snap), settled by f472. Same "creep, snap, settle" family |
| **Cursor** | 40 px (27 px at 720p, stable over f229–245 and f396–410). The notes said 18–20 px, which was wrong. At the bridge (f238 → 239) its speed is 2.0 px/f; 9 px/f 8 f earlier (f231); 22 px/f 5 f later (f244) |
| **Typing rates** (from the notes' frame counts) | Search field: 54 cps (f240–253), retype 75 cps (f268–280), delete 100–125 cps. VO-paced lines: 25 cps (f720–748), 16 cps (f1153–1194), 30 cps (f1446–1466) |

### 4.3 Text vs VO

VO times are YouTube ASR word starts, accurate to about ±0.1 s. A positive lead means the picture comes before the word.

| Class | Item (frames) | Word | Lead at first frame | Lead when complete |
|---|---|---|---|---|
| Headline | "B2B" (f19) | B2B 1.60 | +0.88 | +0.88 |
| Headline | "Influencer / Marketing" (f20–32) | influencer 2.08 | +1.32 | +0.84 |
| Colour | keyword turns blue (f45–55) | influencer 2.08 | +0.32 | −0.08 |
| Headline | "What if you / could manage" (f327–333) | what 13.52 / manage 14.04 | +0.48 / +1.00 | +0.24 / +0.76 |
| Headline | "The First B2B" (f469) | first 18.96 | +0.24 | +0.08 |
| Headline | "Influencer" (f476) | influencer 19.76 | +0.76 | +0.60 |
| Headline | "Partnership / Platform" (f483–497) | partnership 20.32 | +1.04 | +0.48 |
| Headline | "Making brands" (f531) | making 21.28 | +0.08 | +0.08 |
| Headline | "go viral" (f534–537) | viral 22.16 | +0.84 | +0.72 |
| Headline | "Live Creator Campaign" (f979) | live 39.72 | +0.60 | +0.44 |
| Headline | CRM window (f1064) | CRM 43.04 | +0.52 | +0.52 |
| Headline | "Quickly identifies…" (f1330) | quickly 53.44 | +0.28 | +0.28 |
| Headline | "valuable growth channel" (f1471) | valuable 59.24 | +0.44 | +0.36 |
| **Payoff** | counter lands 5.3% (f104) | ROI 4.16 | | **+0.04** |
| **Payoff** | "hundreds…" block pops (f362) | hundreds 14.40 | **−0.04** | |
| **Payoff** | wordmark complete (f445) | Limelight 17.80 | | **+0.04** |
| **Payoff** | chart spike top (f1283) | ROI 51.28 | | **0.00** |
| **Payoff** | face-pile count lands (f1053) | you 41.88 | | −0.20 |
| **Payoff** | end wordmark complete (f1528) | Limelight 60.92 | | −0.16 |
| Logo | brackets start converging (f421) | introducing 17.12 | +0.32 | −0.20 |
| **Typed** | "Easily connect & collaborate" (f720–748) | easily 29.16 / collaborate 30.16 | +0.40 | **+0.28 before the last word** |
| **Typed** | "communications & workflows" (f1153–1194) | centralizes 46.16 / workflows 48.04 | +0.08 | **+0.32 before the last word** |
| **Typed** | "Time to unlock your most" (f1446–1466) | time 58.04 / most 58.92 | +0.24 | **+0.32 before the last word** |
| **Typed** | "Need specific creators…" (f912 →) | need 36.48 | +0.04 | (end frame not measured) |
| Cut | f146 / f327 / f1512 | but 5.96 / but 13.28 / with 60.72 | +0.16 / +0.24 / +0.28 | |

**Rules this gives (these become style-pack data):**
- **Headline lead:** a median of +0.56 s (IQR 0.28–0.88, range 0.08–1.32). A keyword line can appear up to 1 s early when it shares a card with its setup line.
- **Payoff landing:** 0 s (−0.20 to +0.04). The payoff frame *is* the word.
- **Typed lines:** start within 0–0.4 s of the first word, and finish **0.3 s before the last word starts**. The cps is whatever that takes (16–30 cps here).
- **Cuts:** 0.16–0.28 s *before* the clause's first word ("but", "with").

---

## 5 Design system

**Colours.** Values were sampled from frames (patch means and k-means of saturated pixels). The exceptions are the chip colours and the Not Fit red, which were judged by eye.

| Role | Value |
|---|---|
| Background, top → bottom | `#e9ecf5` → `#d8def6` / `#cdd4f0`; bright bands `#f0f0f0` |
| Glow behind the UI (analytics) | `#8cb5e1` → `#c0ceef` |
| End card | `#fdfdfd` |
| Headline ink | `#16171c` (samples `#13151b`–`#18171b`) |
| Accent (keywords, CTA line) | Azure `#1d7cc9`–`#1d86cc`, with a vertical gradient on keywords ("manage", "partnerships": lighter at the top) |
| UI accent 2 | Indigo `#4337c9` / `#4138c1` (Proposals button, revenue bar) |
| UI accent 3 | Cyan `#159fdd` |
| Storefront header gradient | `#2d2a7f` → `#382ea9` |
| Chart | Line `#2d70cd` (2 px), area fill `#91b3e1` → transparent |
| Glass surfaces | Window bezel `#ebebeb`; inner panel `#efefef`–`#f3f3f3`; stat card `#f4f4f4` |
| Chips | Pale lavender fill, indigo text, 1 px white rim |
| Status colours | Not Fit red on pale red; Approval orange `#d54e1d` on peach; ACTIVE green `#1fe777` |
| Cursor | Solid `#111` dot, 40 px |

**Type** (the film looks like SF Pro Display for headlines and UI):
- Use OFL substitutes only: **Inter** (400 for kinetic lines like "What if you could manage", 600–700 for statements like "Making brands", tracking −1 to −2) and **Inter Tight / Manrope SemiBold** for the wordmark.
- Sizes: the kinetic question lines ("What if you / could manage", "hundreds of…") are about 125–135 px; the statement headlines ("Making brands", the tagline) are about 90–100 px. Line height is about 1.05.
- UI text is 20–24 px inside the windows. Numbers are tabular.
- Keywords take the azure gradient fill. No glow or stroke on type, ever.

**Radii (at the framing where each appears).**

| Element | Radius |
|---|---|
| Dashboard window bezel | ≈ 66 px (measured on f577's corner) |
| Phone card | ≈ 55–65 px |
| Search field and pills | Full (a 120 px-high search pill → 60) |
| Stat and post cards | ≈ 18 px |
| Chips | ≈ 12 px |
| Avatars | Circles with a 4–6 px white ring |

**Shadows and depth.**
- **Floating UI:** large, soft and *coloured*. Under the search field it's periwinkle `#c1c8db` against the `#ced5e9` background: about 8% darker, blur about 90 px, offset y about 20 px.
- **Macro close-up:** the card's shadow reads as deep periwinkle `#72759e` (L1 at ×3 scale). Shadows are never neutral grey on the background.
- **Lifted cards inside a UI:** a hard neutral slab (`#d7d7d7` on `#f3f3f3`, about 12% black, distance about 60 px, softness about 8 px) that sells the z-lift.

**Light shafts.** Three to five soft white diagonal bands at about 60°, each 150–300 px wide, peaking about 10% brighter than the background. They drift slowly (about 0.5 px/f) and cross the whole frame behind every beat. They fade out with the glow on the end card.

**Content caution for a Helios recreation.** The film uses **real third-party UIs** (LinkedIn chrome, the Gmail inbox and logo). Helios must generate generic "social post" and "mail" kinds and never reproduce another brand's UI or logo (the §7 licence rule of the plan).

---

## 6 Sound design and VO sync

**Voice-over.**
- A single narrator, about 155 wpm, near-continuous from 0.68 s to 61.2 s.
- The longest gaps between word starts are about 1 s, at the act breaks: "results" → "but" (12.36 → 13.28),
  "once" → "introducing" (16.12 → 17.12) and "content" → "time" (57.04 → 58.04).
- Clause starts drive the picture (§4.3).

**Music and low end.**
- A music bed runs throughout. The kit's tempo estimate (77 bpm) is unverified.
- The strongest low-frequency (20–150 Hz) peaks, over the median, are:

  | Frame | Level | What happens |
  |---|---|---|
  | f424 | +13.7 dB | 3 f into the bracket converge |
  | f7 | +12.1 dB | The open |
  | f1239 | +10.1 dB | 3 f after the cut to analytics |
  | f1552 | +9.3 dB | The end-card glow fade |
  | f1284 | +8.5 dB | The chart spike on "ROI" |

  These are low **hits on the brand and payoff moments**, not on the music grid.
- The kit's "20/26 moves start on an onset" is against a chance rate of 53% (4.7 onsets/s, ±2 f). The
  excess is explained by the UI tick layer below, which is part of the onset list. It is not evidence of
  beat-cutting.

**UI tick layer** (measured in `measure.py sfx_ticks`).
- **Method.** Short broadband transients were found with a 5 kHz high-pass envelope: half-width under 14 ms, ≥ 6× the local median. There are 189 in the film.
- **Result.** For 25 on-screen UI events, 18 have a tick within ±1.5 f, against a chance mean of 8.4 (random time-shift baseline).
- **With a tick:**

  | Event | Offset (f) |
  |---|---|
  | B2B pop | +0.3 |
  | Reaction pops | 0.0 |
  | Counter lands | +0.7 |
  | Not Fit pops | −1.2 / +0.8 / +0.8 |
  | Typing start | −0.6 |
  | Collage exit | +0.4 |
  | Page swap | +0.1 |
  | Card shrink | +1.2 |
  | Proposals click | −0.1 |
  | Check pops | −0.5 / +0.5 |
  | Avatar pops | −0.3 |
  | Chart camera snap | −1.1 |
  | Row highlight | −0.4 |
  | ICP arrival | +1.2 |

- **Without one:** the logo converge, wordmark, tilt whip, storefront click (−3 f), the count landing (−2 f), the ⊗ → ⊕ morph (+2 f) and the end wordmark. The big brand moves are carried by music and low end instead.
- **The logo impact.** The strongest LF peak in the film (+13.7 dB) is at **f424**, 3 f into the bracket converge (73% of the spread closed). That's a sub impact where the dot "locks".
- **The rule:** *every UI state change gets a tick on the frame (±1 f), and brand and payoff moments get a low hit.* No whooshes were detected on the camera snaps, but a whoosh under the voice-over can't be ruled out by this method. This is P9's automatic-cue rule, but with **tick**, not pop, as the default UI sound.

---

## 7 What Helios needs

This section reconciles with the pillars and adds only what's missing. It uses the vocabulary of
`src/motion/types.ts`.

**Already covered by the plan, with no change needed:**
- P3 `ui` layer, actions `type`, `backspace`, `click`, `scroll`, `state`, `count`, `draw`, `lift`, `select` and `highlight`, plus `create_ui_screen`.
- P4 world layout, `scene.dof` and parallax fields.
- P2 bundled Inter and the `script` typing.
- P9 SaaS SFX pack.
- P10 `motion_guide` and `TIMING`.

The following are additions or corrections.

**7.a Word-anchored timing that can *land* (refines P2's "word-anchored timing").**
- The plan only offers `{word, offset}` as a start time.
- This film needs three anchor classes: lead, land and span.
- Resolve them with `timelineWords()` (`src/lib/transcriptText.ts:50`), which already returns `{text, start, end}`.

```ts
// types.ts
export type TimeRef = number
  | { word: string; nth?: number; edge?: 'start' | 'end'; offset?: number }        // anchor to a word
  | { span: [from: string, to: string]; nth?: number };                            // a spoken phrase
export type Key<T = number | Vec> = { t: number; v: T; ease?: Ease; at?: TimeRef }; // NEW `at`: t is resolved
//   from `at` at build time and re-resolved on transcript change; `t` stays the number the engine reads.
type Anchoring = { lead?: number /* headline, default 0.5 */; land?: number /* payoff, default 0 */;
                   typeFinishEarly?: number /* 0.3 */ };                               // style-pack data
// A key with `at` and `role:'payoff'` puts THIS key (the end of the move) on the word; the move's
// earlier keys shift with it. TextLayerData.type (P2's TypeOn) gains `span?: [string, string]`: cps is
// derived so the line completes `typeFinishEarly` s before the span's last word starts.
```

**7.b Inline objects that move with the type and can be targeted (refines P2 `TextSpan.inline`).**
- The plan reserves width and draws a layer at the glyph slot.
- Limelight also needs the slot to:
  1. **count as one unit for range selectors and `cascade`**, so the tracking settle ("hun dreds") moves the pill;
  2. **be addressable by a guide/cursor and by UI actions** ("tick pill 2");
  3. hold a **face-pile** without a precomp per pill.

```ts
export type TextSpan = { text: string; …; inline?: InlineObject };                   // NEW
export type InlineObject = {
  id?: string;                         // target as `<textLayerId>#<id>` (measure.ts exports its box per frame)
  layer?: string;                      // any layer (precomp/shape/footage/ui) drawn in the slot
  image?: string; icon?: string;
  pill?: { height?: number; radius?: number; fill?: string; stroke?: string; strokeWidth?: number;
           slot?: 'check' | 'none';    // leading empty circle that `select` fills with a check pop
           faces?: { images: string[]; size?: number; overlap?: number /* 0.3 */; enterStagger?: number /* 1 f */ } };
  width?: number;                      // reserved advance (px); default = pill/image width
  valign?: 'center' | 'x-height' | 'cap';
};
```

**7.c Attach any layer to a UI part (generalises P3 `parts[i].footage`).**
- One mechanism covers four things: video in a post, a face-pile in a card, a callout, and a guide targeting a part.

```ts
// LayerCommon += (NEW)
attach?: { layer: string /* a 'ui' layer */; part: string /* '#post-video' | 'row:3' | text */;
           fit?: 'cover' | 'contain' | 'none'; clip?: boolean /* part's rounded rect, default true */;
           reveal?: { kind: 'wipe-down' | 'wipe-right' | 'iris'; t: TimeRef; duration: number } };
```

- The attached layer inherits the part's box and the UI plane's full 3D transform, so a tilted dashboard
  still plays its video.
- `measure.ts` and `safeArea.ts` treat it as part of the UI layer.
- It needs `supportIds` (`motionStack.ts:42-57`), because it references another layer (map A8 row 9).

**7.d Guide roles with size, born from a UI part, and a rest-point bridge (refines P4 `scene.guide` + `cursor-bridge`).**

```ts
scene.guide = { layer: string,
  roles: { t: TimeRef; as: 'ui-part' | 'cursor' | 'caret' | 'logo-dot' | 'wipe';
           size?: number;               // NEW: 96 → 40 → 100 px in this film
           part?: string }[],           // NEW: role 'ui-part' pins it to a UI part (the toggle knob)
  path?: 'auto' | Vec[] };              // auto = arcs between targets, 14 f ease-out glides (P3)
transitions += { type: 'cursor-bridge'; at: TimeRef; guide?: string;
                 rest?: number /* frames the guide holds < 2 px/f around the swap; default 2 */ };
```

The solver must **move the swap to the guide's velocity minimum**: it measured 2 px/f against 9–22 px/f 5–8 f either side.

**7.e Two measured curves as named tokens, plus two transitions (adds to P4 and P10).**
- A single cubic-bezier can't hold the "creep, snap, settle" shape (§4.1 M4). So the P10 `TIMING` table
  should ship it as a **three-key helper**, `snap(from, to, d, {at: 0.4, mid: 0.79})`, with the M4 segment
  eases.
- For symmetric pushes, add **named eases** in `anim.ts`:
  - `'snap'` = `[0.94, 0.03, 0, 1]` (the chart push, rmse 0.003);
  - `'rise'` = `[0.15, 0.84, 0.11, 0.98]` (M1).
- **`z-recede`**, with the numbers corrected to this film:
  - Out: the old block eases in over 6 f to ×0.65 and rises 224 px with blur, ending as a ghost of about
    ×0.6 at 30% opacity.
  - In: the new block pops sharp, 150 px below its rest position, with +8 tracking, and rises in 13 f
    with `'rise'`.
  - There is no "arrival from the lens". That's Virgil's zoom-through, a different transition.
- **`scale-cut {factor: 3 | 1/3}`**: a hard cut to the same element at ×3 (punch-in) or back to the whole at ×⅓ (pull-back). This is missing from P4's list.

**7.f UI actions this film needs that P3 lacks.**

```ts
| { t: TimeRef; type: 'status'; target: string; pill: { text: string; icon?: string; tone: 'bad' | 'ok' | 'warn' } }  // "Not Fit"
| { t: TimeRef; type: 'button'; target: string; states: ('spinner' | 'check' | { label: string; fill?: string })[]; step?: number }
| { t: TimeRef; type: 'stack'; targets: string[]; into: string; scale?: number /* 0.45 */; stagger?: number /* 2 f */;
    counter?: { from: number; to: number; perFrame?: 1 } }                                                        // avatar collapse + "+N"
```

**7.g Look.**
- A procedural **`light-shafts`** kind (NEW, `gl/procedural.ts` + the shader): `{angle: 60, count: 4,
  width: [150, 300], intensity: 0.1, drift: 0.5}`. Today's kinds (`light-rails`, `aurora`, `light-leak`)
  don't produce soft diagonal window light.
- A **coloured-shadow** token in the SaaS-light style pack: shadows tinted from the background hue.

**7.h Reference analysis.** `analyze_reference_video` (P10 worker) must report **foreground swaps on a
continuous background** (a large local diff while the border and background stay put). It must not stop at
colour-jump cuts. On this film the kit reported 3 cuts against about 15 swaps, and that fed a wrong number
into the plan.

### 7.1 Corrections to REFERENCE-FILMS-PLAN.md and to the notes

| Where | Says | Measured |
|---|---|---|
| Plan §0 item 3 and §3.3 | "only 4 hard cuts in 65 s" | The kit found 4 *shots*. There are about 15 foreground swaps on a background that never cuts. The continuity comes from the bg plus bridges |
| Plan §2.1 "Logo mask-slide" | 5–8 f, ease-out | 10–11 f. The mark moves ease-in-out and **also scales to 0.59**; only the word's leading edge is expo-out; the letters trail. The brackets converge first (13 f, `(0.134, 0.793, 0.264, 0.957)`) |
| Plan §2.1 "Text vs voice-over" | leads 0.3–1.0 s | Three classes: headlines lead (median 0.56 s, up to 1.32); payoffs land on the word (±0.2 s); typed lines finish 0.3 s before the last word. A single "lead" would put every payoff early |
| Plan §2.1 "UI panel entrance" / "Focus pull" | phone "15 f" / "8 f"; the table is "at 30 fps unless noted" | These are **25 fps** frames. The rise settles over 33 f (95% at f17); blur σ 24 → 3 px in 8 f, sharp at about 14 f; opacity in 5 f |
| Plan §2.1 (missing) | | The **"creep, snap, settle"** camera curve (§4.1 M4, §4.2), used 5 times; not the `(0.6, 0, 0.4, 1)` push |
| Plan §2.2 / notes | cursor 18–20 px; ink `#1d1d1f`; accent `#2f6fd6` | Cursor **40 px**; ink `#16171c`; accent azure `#1d7cc9`–`#1d86cc` with a gradient on keywords, plus indigo `#4337c9` as the UI accent |
| Plan §3.3 "Z-recede" | "shrinks to 55%… new block arrives from the camera" | About 0.65 at the swap, a ghost of about 0.6. The new block **pops sharp and rises**; it does not arrive from the lens |
| Plan §3.3 "Rebuild" / §6.3 golden | needs "SVG import, `shape.path` beziers" (P1); golden pillars P1, P2, P3 | The mark is two straight L-corners and a circle, so it can be built **today**. P1 isn't needed. The golden needs **P2, P3, P4** (guide, z-recede, bridge) and P9 (ticks) |
| Plan §3.3 "Needs" (missing) | | T8 (gradient keyword fill), the scale-cut, the button/status/stack UI states, the frame-synced tick layer, and typing paced to the VO |
| Notes f1236–1284 | chart "linear, spike in ~8 f"; push "1.0 → 1.35 over 20 f" | Ease-in-out draw over 45 f; the spike is drawn in the tail over f1272–1293. The push is ×1.47 with 60% in 2 f |
| Notes f356–369 | new block "arrives from the camera side (large, slight blur)" | Pops at f362 at final scale and sharp (Laplacian sharpness 9.7 on its first frame) |
| Notes f1018–1046 | 5 avatars | 4 avatars plus the counter chip (f1030, f1052) |

---

## 8 Recreate recipe: the best 10 s (13.0 → 23.0 s, f326 → f576)

"What if…" → z-recede → inline face-pile pills ticked by the knob-cursor → the dot becomes the logo →
brackets converge → wordmark slide → the logo snaps to the corner → the dashboard whips in → the tagline.
This is the film's continuity signature. It extends the plan's golden beat (§6.3).

**Tool calls.** NEW marks what this plan adds.

1. `motion_guide {topic: "saas-explainer"}` (NEW, P10). Returns the SaaS-light pack: the §5 colours,
   Inter, the `rise` and `snap` eases, and the anchoring `{lead: 0.5, land: 0, typeFinishEarly: 0.3}`.
2. `create_ui_screen {kind: "dashboard", brand, content: {nav: ["Campaigns", "Inbox", "Calendar", …], cards: [...], tables: [...]}}`
   (NEW, P3). Returns asset `ui_dash`.
3. `create_motion_scene {scene: …}`. The sketch below uses scene time 0 = 13.00 s of the VO.
4. `add_sound_effect` × cues (the P9 SaaS pack: `tick` on each pill check and status change, `impact`
   at 3 f into the converge).
5. `run_frame_qa`, and the pacing check (NEW, P10) against §4.

```jsonc
// Scene time 0 = 13.00 s of the VO (f326). Pixels at 1080p. NEW = added by the plan (pillar in brackets).
{ "version": 1, "width": 1920, "height": 1080, "duration": 10, "background": "#e9ecf5",
  "motionBlur": { "samples": 8, "shutter": 180 },
  "guide": { "layer": "dot", "handoff": "logoDot", "roles": [                               // NEW (P4, §7.d)
      { "t": 2.16, "as": "ui-part", "part": "q2#toggle3", "size": 96 },
      { "t": 2.48, "as": "cursor", "size": 40 },
      { "t": 3.80, "as": "logo-dot", "size": 100 } ] },
  "layers": [
    { "id": "bg",     "type": "procedural", "kind": "linear-gradient", "params": { "from": "#e9ecf5", "to": "#d3daf2", "angle": 90 } },
    { "id": "glow",   "type": "procedural", "kind": "radial-glow", "params": { "inner": "#c7d0f4", "outer": "#e9ecf5", "center": [0.5, 1.05], "radius": 0.7 }, "blend": "multiply" },
    { "id": "shafts", "type": "procedural", "kind": "light-shafts", "params": { "angle": 60, "count": 4, "intensity": 0.1, "drift": 0.5 }, "blend": "screen" },  // NEW kind (P5)

    // "What if you / could manage": tracking + scale settle in, then z-recede (creep → 2 f snap → settle)
    { "id": "q1", "type": "text", "in": 0.04, "out": 2.4, "motionBlur": true,
      "text": { "spans": [ { "text": "What if you\ncould " }, { "text": "manage", "color": "#1d80ca" } ],   // gradient keyword fill: P2 NEW
                "font": "Inter", "weight": 400, "size": 130, "lineHeight": 1.05, "align": "center",
                "cascade": { "by": "line", "delay": 0.04, "stagger": 0.04, "duration": 0.28, "ease": [0.15, 0.84, 0.11, 0.98],
                             "from": { "tracking": 8, "scale": 104, "opacity": 0 } } },
      "transform": {
        "position": { "k": [ { "t": 1.16, "v": [960, 460], "ease": [1.0, 0.09, 0.86, 0.03] }, { "t": 1.40, "v": [960, 236], "ease": [0.08, 0.6, 0.18, 0.96] }, { "t": 1.80, "v": [960, 200] } ] },
        "scale":    { "k": [ { "t": 1.16, "v": 100, "ease": [1.0, 0.09, 0.86, 0.03] }, { "t": 1.40, "v": 65, "ease": [0.08, 0.6, 0.18, 0.96] }, { "t": 1.80, "v": 60 } ] },
        "opacity":  { "k": [ { "t": 1.16, "v": 100 }, { "t": 1.40, "v": 30 } ] } },
      "effects": [ { "type": "gaussian-blur", "blurriness": { "k": [ { "t": 1.16, "v": 0 }, { "t": 1.40, "v": 28 } ] } } ] },

    // "hundreds of [pill] / [pill] partnerships / at once → ?  ○ ○ ●": pops sharp ON "hundreds", rises 13 f
    { "id": "q2", "type": "text", "in": 1.44, "out": 3.80,                                // in = { word: "hundreds" } (NEW TimeRef, P2)
      "text": { "spans": [
          { "text": "hundreds of " },
          { "text": " ", "inline": { "id": "pill1", "pill": { "slot": "check", "faces": { "images": ["a1","a2","a3","a4","a5","a6"], "enterStagger": 0.04 } } } },  // NEW (P2, §7.b)
          { "text": "\n" },
          { "text": " ", "inline": { "id": "pill2", "pill": { "slot": "check", "faces": { "images": ["b1","b2","b3","b4","b5","b6","b7"] } } } },
          { "text": " partnerships", "color": "#1d80ca" },
          { "text": "\nat once → ?  " },
          { "text": " ", "inline": { "id": "toggle1", "pill": { "height": 96, "radius": 48, "stroke": "#16171c" } } },
          { "text": " ", "inline": { "id": "toggle2", "pill": { "height": 96, "radius": 48, "stroke": "#16171c" } } },
          { "text": " ", "inline": { "id": "toggle3", "width": 96 } } ],                 // the knob that becomes the guide
        "font": "Inter", "weight": 400, "size": 130, "align": "left",
        "cascade": { "by": "line", "delay": 1.44, "stagger": 0, "duration": 0.52, "ease": "rise",   // NEW named ease = [0.15,0.84,0.11,0.98]
                     "from": { "position": [0, 147], "tracking": 12 } } },
      "transform": { "position": [960, 560] } },

    // The guide: knob (96) → cursor (40) that ticks pill1 (2.04) and pill2 (2.56) → flies to centre growing → hands off
    { "id": "dot", "type": "shape", "in": 1.44, "out": 3.80, "shape": { "shape": "ellipse", "size": [96, 96], "fill": "#111111" },
      "transform": { "position": { "k": [
        { "t": 2.16, "v": [1518, 774] }, { "t": 2.48, "v": [1677, 676] }, { "t": 2.72, "v": [1660, 453] },
        { "t": 2.96, "v": [1427, 719] }, { "t": 3.28, "v": [1235, 980] }, { "t": 3.56, "v": [1090, 885] },
        { "t": 3.76, "v": [960, 745], "ease": "expo-in" }, { "t": 3.80, "v": [960, 562] } ] } } },   // with `guide`, P4 auto-arcs these

    // The logo: a lockup null (does the corner snap), a mark null (scale + slide), brackets, dot, masked word
    { "id": "lockup", "type": "null", "in": 3.80,
      "transform": { "position": { "k": [ { "t": 5.28, "v": [960, 540], "ease": [0.94, 0.03, 0, 1] }, { "t": 5.88, "v": [537, 271] } ] },   // the 'snap' curve (NEW name)
                     "scale":    { "k": [ { "t": 5.28, "v": 100, "ease": [0.94, 0.03, 0, 1] }, { "t": 5.88, "v": 76 } ] } } },
    { "id": "mark", "type": "null", "in": 3.80, "parent": "lockup",
      "transform": { "position": { "k": [ { "t": 4.40, "v": [0, -20], "ease": [0.635, 0.177, 0.109, 0.977] }, { "t": 4.84, "v": [-282, -13] } ] },
                     "scale":    { "k": [ { "t": 4.36, "v": 100, "ease": [0.386, -0.068, 0.065, 1.0] }, { "t": 4.68, "v": 59 } ] } } },
    { "id": "bracketTL", "type": "shape", "in": 3.80, "parent": "mark",                   // straight-segment L: works today, no P1
      "shape": { "shape": "path", "closed": true, "points": [0,0, 72,0, 72,30, 30,30, 30,118, 0,118], "fill": "#16171c" },
      "transform": { "position": { "k": [ { "t": 3.80, "v": [-563, -35], "ease": [0.134, 0.793, 0.264, 0.957] }, { "t": 4.32, "v": [-72, -35] } ] } } },  // t = { word: "introducing", offset: -0.32 } (NEW)
    { "id": "bracketBR", "type": "shape", "in": 3.80, "parent": "mark",
      "shape": { "shape": "path", "closed": true, "points": [42,0, 72,0, 72,118, 0,118, 0,88, 42,88], "fill": "#16171c" },
      "transform": { "position": { "k": [ { "t": 3.80, "v": [563, 35], "ease": [0.134, 0.793, 0.264, 0.957] }, { "t": 4.32, "v": [72, 35] } ] } } },
    { "id": "logoDot", "type": "shape", "in": 3.80, "parent": "mark",
      "shape": { "shape": "ellipse", "size": { "k": [ { "t": 3.80, "v": [100, 100], "ease": "expo-out" }, { "t": 3.84, "v": [81, 81] }, { "t": 4.32, "v": [74, 74] } ] }, "fill": "#111111" },
      "transform": { "position": { "k": [ { "t": 3.80, "v": [0, 42], "ease": "expo-out" }, { "t": 3.96, "v": [0, 0] } ] } } },   // arrives 42 px low, settles into the brackets
    { "id": "word", "type": "text", "in": 4.40, "parent": "lockup", "motionBlur": true,
      "matte": { "layer": "wordMatte", "mode": "alpha" },
      "text": { "text": "Limelight", "font": "Inter Tight", "weight": 600, "size": 120, "tracking": -2, "align": "center",
                "animators": [ { "by": "char", "shape": "ramp-down", "smoothness": 3, "props": { "tracking": 6 },
                                 "offset": { "k": [ { "t": 4.40, "v": 0 }, { "t": 4.96, "v": 100 } ] } } ] },   // trailing letters, settle
      "transform": { "position": { "k": [ { "t": 4.40, "v": [-176, 0], "ease": [0.032, 0.0, 0.072, 0.816] }, { "t": 4.84, "v": [63, 0] } ] } } },  // lands on { word: "Limelight", edge: "start" } (NEW)
    { "id": "wordMatte", "type": "shape", "in": 4.40, "parent": "mark", "hidden": true,  // left edge = the mark's right edge
      "shape": { "shape": "rect", "size": [2400, 400], "fill": "#ffffff" }, "transform": { "position": [1308, 0] } },

    // Dashboard whips in (snap), tagline lines rise 30 px in 5 f with a 7 f stagger, then swap
    { "id": "dash", "type": "ui", "in": 5.72, "threeD": true, "motionBlur": true,          // NEW layer type (P3)
      "ui": { "source": { "asset": "ui_dash" }, "device": "glass-card", "cursor": { "style": "dot" } },
      "transform": { "position": { "k": [ { "t": 5.72, "v": [2700, 600], "ease": [0.94, 0.03, 0, 1] }, { "t": 6.04, "v": [1450, 600] }, { "t": 10, "v": [1400, 600] } ] },
                     "scale": { "k": [ { "t": 5.72, "v": 100 }, { "t": 10, "v": 104 } ] } },
      "effects": [ { "type": "drop-shadow", "color": "#8f98c8", "opacity": 25, "distance": 24, "direction": 180, "softness": 90 } ] },
    { "id": "tag", "type": "text", "in": 5.72, "out": 8.24,
      "text": { "spans": [ { "text": "The First B2B\n", "weight": 700, "size": 56 }, { "text": "Influencer\n", "size": 96 },
                           { "text": "Partnership\nPlatform", "size": 96, "color": "#1d80ca" } ],
                "font": "Inter", "align": "left",
                "cascade": { "by": "line", "delay": 5.72, "stagger": 0.28, "duration": 0.2, "ease": "expo-out", "from": { "position": [0, 30], "opacity": 0 },
                             "exit": { "at": 8.12, "duration": 0.12, "stagger": 0, "to": { "position": [0, -22], "opacity": 0 } } } },
      "transform": { "position": [420, 640] } },
    { "id": "tag2", "type": "text", "in": 8.20,
      "text": { "spans": [ { "text": "Making brands\n", "weight": 600 }, { "text": "go viral", "weight": 600, "color": "#1d80ca" } ],
                "font": "Inter", "size": 96, "align": "left",
                "cascade": { "by": "line", "delay": 8.20, "stagger": 0.12, "duration": 0.16, "ease": "expo-out", "from": { "position": [0, 30], "opacity": 0 } } },
      "transform": { "position": [420, 640] } }
  ],
  "cues": [ { "at": 1.72, "sound": "click" }, { "at": 2.04, "sound": "click" }, { "at": 2.56, "sound": "click" },   // P9: must stop playing as 'pop'
            { "at": 3.92, "sound": "impact" } ] }                                                                  // low hit as the mark locks (f424)
```

**What works today** (with the NEW fields dropped). All of this uses existing `types.ts` fields:
- the background gradient and glow;
- both text blocks as plain text, including the tracking and scale settle through `cascade.from`;
- the z-recede keys and blur;
- the dot's path and the hand-off to `logoDot` at the same pixel;
- the straight-segment L-brackets and their converge;
- the lockup and mark null rig;
- the wordmark revealed by an alpha track matte parented to the mark (`matte` + `hidden`);
- the letter-trail tracking animator;
- the snap corner move, the tagline cascades and the cues.

**What needs the plan:**
- inline pills and toggles inside the text (P2);
- `at` word anchoring (P2);
- the `guide` roles and sizes, and the auto-arcs between targets (P4);
- `light-shafts` (P5);
- the `ui` dashboard (P3). Today, use an image footage layer in its place;
- the `rise` and `snap` names (P10). Their numeric beziers work today;
- `click` must stop playing as `pop` (P9).

**The parented matte works as in AE.** `renderer.ts:314-327` places the matte source with its own world
transform (parent chain included), and a matte source is never drawn itself (`:299`). So a matte rect
parented to the scaling, sliding mark keeps the reveal edge on the mark's right edge.

---

## 9 Top 10 improvements

| # | Improvement | Size | Why (this film) |
|---|---|---|---|
| 1 | **Ship the measured tokens.** `rise` `[0.15, 0.84, 0.11, 0.98]`, `snap` `[0.94, 0.03, 0, 1]`, the three-key `snap()` helper (M4 segments), the bracket-converge ease, the z-recede numbers and the staggers (1/2/2–3/4–6 f) go into `anim.ts` names and the `kit/common.ts` `TIMING`, with a SaaS-light pack that turns off the default headline glow and 0.6 s word cascade (Limelight lines enter in 4–6 f, by line, with no blur) | S | "Creep, snap, settle" is the film's camera; today's templates push with `(0.6, 0, 0.4, 1)` |
| 2 | **`TimeRef` with lead, land and span** (§7.a), resolved through `timelineWords()`, plus a pacing-QA check per class | S–M | Payoffs land on the word within ±0.04 s, headlines lead by 0.56 s, typed lines finish 0.3 s before the last word |
| 3 | **Guide object across beats**, with per-role size, a `ui-part` birth and a rest-point cursor bridge (§7.d) | M | Knob → cursor → logo dot is the spine of the reveal; the bridge cut at f239 |
| 4 | **Inline objects in text spans**: counted by the animators, targetable, and holding face-piles (§7.b) | M | "hundreds of [pill] / [pill] partnerships" are then ticked by the cursor |
| 5 | **`attach` a layer to a UI part**, inheriting its 3D transform and clip, with a wipe reveal (§7.c) | M | Stock video inside the LinkedIn post; face-piles in cards |
| 6 | **UI state actions**: `status`, `button`, `stack` + `+N` counter (§7.f) | M | Not Fit pills, spinner → check, avatar collapse |
| 7 | **Transitions `z-recede` (corrected), `scale-cut`, `cursor-bridge`**, as data (§7.e) | S–M | Three of the film's ~15 swaps; scale cuts at f1011 and f1064 |
| 8 | **SFX: a `tick` as the default UI cue**, one per UI state change within ±1 f; a low `impact` when a logo locks; fix `click → pop` (`motionTools.ts:182`) | S | 18 of 25 events tick against 8.4 by chance; a sub hit at f424 |
| 9 | **`light-shafts` procedural + coloured-shadow token** in the SaaS-light pack | S | The lavender world is on screen for 62 of 65 s |
| 10 | **Reference analyser: detect foreground swaps on a continuous background**, and fit the "snap" family (a two-segment fit when a single bezier's rmse > 0.03) | M | The kit said 4 shots against ~15 swaps; a single-bezier fit misreads the snap (rmse 0.048 against 0.003 with two keys) |

