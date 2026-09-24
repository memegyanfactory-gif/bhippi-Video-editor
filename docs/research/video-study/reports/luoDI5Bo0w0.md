# luoDI5Bo0w0 · Solair agency reel (dark AI world)

*Video study, 2026-09-25. 41.4 s, 30 fps, 1920×1080, with voice-over. The primary source is the saved
frame-by-frame pass (`out/luoDI5Bo0w0/notes.md`). I checked its key claims on 10 composite strips (84
down-scaled frames in all) and took two new measurements (`m_ring.py`, `m_audio.py`). The fits are
cubic-beziers from `bezfit.py`.*

**Conventions used throughout:**
- Frames are 1-based: f1 is t = 0, and t = (f − 1)/30.
- Pixels are at 1080p unless marked "@720". The measurements were taken on 1280×720 frames and are ×1.5 at 1080p.
- "rms" is the error of the normalised bezier fit.

---

## 1. What the film is

**What it is.** Solair (solairmotion.com) is a motion studio. This is its own reel, pitching "short,
attention-grabbing explainer videos" to SaaS founders. It is VO-led, at about 80 spoken words in 41 s, and
the whole film sits on one near-black violet ground.

**How the runtime splits.** There are three modes:

| Mode | Share of runtime | Frames |
|---|---|---|
| Kinetic type | ≈ 35 % | f1–60, f120–207, f545–583, f782–956, f1006–1076 |
| UI and devices | ≈ 46 % | the tablet homepage, tile wall, portfolio card stack, glass dashboard, process device, review cards |
| Brand | ≈ 20 % | the tile→logo morph, the CTA capsule, the end card |

**Structure.**
1. A hook question.
2. The problem: a UI walkthrough nobody watches.
3. The attention claim.
4. The brand reveal, at 11.7 s (28 % of the runtime).
5. Proof: the portfolio.
6. The process: one device, one state per spoken noun.
7. Speed and clarity claims.
8. Social proof.
9. The CTA question, then the CTA capsule.
10. The end card.

**What makes it world-class:**
- **Transitions instead of cuts.** Nearly every change is a transition that carries the eye. Type becomes UI, UI becomes a logo, and the logo becomes a card stack.
- **Seven one-frame "snaps".** Each is a state change within one frame, followed by an eased settle.
- **One exponential settle curve** used everywhere (§4).
- **Clicks that land on click sounds.**
- **UI state changes that land 1–4 frames after the spoken noun.**

**Cuts.** The shot detector found only 3 cuts (4 shots, "mean shot 10.35 s"), because every shot shares
the same near-black ground. Counted by eye there are **11 hard cuts**: f61, f120, f165, f208, f480, f545,
f584, f782, f1005, f1006 and f1149. That makes the average shot about 3.5 s. Seven of them (f61, f120,
f165, f545, f584, f782 and f1005) hide behind an ease-in exit of 3–8 f on the outgoing shot.

## 2. Beat-by-beat breakdown

| # | Time (s) | Frames | VO | Picture | Techniques (§3) |
|---|---|---|---|---|---|
| 1 | 0.00–1.97 | f1–60 | "Are you running a SaaS" | Giant words slam in right→left with echo-ghost blur; the line pans left as each word lands, and the newest word is purple, turning white. **f17→18: 1-f zoom-out to ≈0.3×** into a world of concentric rings and twinkling 4-point sparkles. "SaaS" rises (f24–27) in lavender. Holds 20 f, then a whole-world tilt-whip exit (f53–60, ease-in, 8 f) | T1, T2, T3, T4, T5 |
| 2 | 2.00–3.97 | f61–119 | "…homepage has a recorded walkthrough?" | Cut on "a" (0 f) to a tilted tablet (rotX ≈ 20°) with a Ghost-style homepage. The video card grows over 4 f, the play button pops from a dot (4 f), and the headline types at 1 char/f. A **3D extruded purple cursor** flies to the play button. **f94→95: 1-f snap zoom** (the tilt flattens, ×1.15 wide / ×1.35 high, background into depth of field). Click f101–107 (the button fills purple). Pull-back whip f117–119, then cut | T6, T7, T8, T9 |
| 3 | 3.97–5.47 | f120–164 | "No one watches those." | White Inter, centred, typed at 1 char/f with the line re-centring; "those." in coral `#e6607a`. Slow drift, then an **ease-in exit left** (4, 11, 19, 30 px/f @720), then cut | T10, T11 |
| 4 | 5.47–6.90 | f165–207 | "People have clicky attention now." | Huge left-aligned lavender type with bloom, typed while the camera tracks the caret (the caret stays at about 70 % x). The newest word glows lavender and older words go white. Blurred tiles sit close behind | T12 |
| 5 | 6.90–10.03 | f208–301 | "If you don't grab them fast, you lose them." | **f207→208 type→pill match-zoom**: the line becomes a small black capsule over a masonry wall of purple tiles (2 f blur settle). A **white glossy 3D cursor** arcs in with banking and clicks three tiles (f233, f266, f293). Each click lights its tile with a radial ripple | T13, T14, T15 |
| 6 | 10.03–12.37 | f302–372 | "At Solair," | **Signature morph**: the pill dissolves (3 f), and the tiles shrink and round into capsules, then dots, then a ring of 8 (f302–318). The dots light up to white (f318–322). The ring **winds up**, accelerating and collapsing (f318–335). A giant purple concave sparkle arrives from beyond the lens (f332–336), shrinks, spins and brightens into the logo (f337–352, rotation tail to f380). "Solair" fades and slides out from beside the mark (f350–353), landing on the spoken "Solair" (−0.4 f) | T16, T17, T18, T19 |
| 7 | 12.60–15.97 | f379–479 | "we make short, attention-grabbing explainer videos." | **Portfolio card stack**: a stepped "wallet" stack rises (f381–411) while the logo lifts and fades (f388–395). A huge neon eclipse ring fades in. The top card is pulled out (f400–420) and shows a client dashboard. The **client's own blue sparkle logo wipes the card** (f421–439), then an organic blob wipe (f440–446). The next card (Seeklab) flips up in front (f446–449, 4 f), then a third card rises and the shot cuts on its motion | T20, T21, T22, T23 |
| 8 | 15.97–18.13 | f480–544 | "You give us your business details." | Cut on "us" (+0.2 f) to an empty glass tray in 3D (rotX ≈ 40°). **Six skeleton glass widgets fly in** from the top left with a specular sheen (f482–492, stagger 2 f, 8–10 f each) and settle dim. Slow orbit. Exit f541–544: the tray flattens and shrinks (4 f), then cut | T24 |
| 9 | 18.13–19.43 | f545–583 | "Boom." | "Boom" **tracking slam** (over-condensed → normal in 3 f, +4 f after the VO word), with a sub hit. Slow scale-down, a 6 f drift down, then cut | T25 |
| 10 | 19.43–24.03 | f584–720 | "We handle the script, design, storyboard, and deliver the final video." | **One persistent device.** A portrait glass tablet swings in (rotY −35° → −5°, 16 f). The script lines write on (trim path, 1 f stagger). The Script dot turns active at +4 f. **f629→630: the device reshapes** to landscape for "design" (+1.4 f), and spec tooltips pop in. **f665→666: a 1-f angle snap** plus a 14 f ease-back for "storyboard" (+2.6 f), with a 3×3 grid of thumbnails popping row by row. At f719–720 the device becomes the "Final Video" player (+1.4 f after "final") | T26, T27, T28, T29 |
| 11 | 24.03–27.20 | f721–816 | "Fast." | A 2D hand pointer glides to the play button (14 f). **f749→750: the device alone punches in 1.4× in 1 f** (the stepper rail doesn't move), and a radial shockwave ring expands (10 f). Exit, then cut. "Fast." types with a purple lead that turns white (+3.4 f) and holds 30 f | T30, T31, T32 |
| 12 | 27.20–31.87 | f817–956 | "Two weeks max. We explain your product so clearly your customers have no questions." | Words close a 30 px gap in 2 f, purple → white over 6 f (+6 to +8 f after the VO). **Teleprompter push**: a new line types in on the right with a caret while the old line slides left and fades. **f907–919: retype morph** "We explain your product so clearly" → "Your customers have". **f937–942: condense-swap** to "No questions." | T33, T34, T35, T36 |
| 13 | 31.87–33.50 | f957–1005 | (music) | Four glass **review cards fly back from the lens** (scale 1.2–1.5× → 1, stagger about 2 f) and float with parallax. **Ease-in exit** (×1.4/f), then a 1 f hard cut to black | T37 |
| 14 | 33.50–36.70 | f1006–1101 | "Want customers who actually watch? Let's make something that sticks." | A teleprompter line, then at **f1076→1077 a CTA capsule morph**: the outline draws on from the top edge, fills, and "Get started" types beside a sparkle icon, with 3 concentric capsule echoes. **f1101→1102: a 1-f press to 0.66×** on "sticks" (+1.8 f) | T34, T38 |
| 15 | 36.70–38.27 | f1102–1148 | — | The CTA holds at 0.66→0.62× while the capsule rings expand slowly (radar, ≈0.5 %/f) | T38 |
| 16 | 38.27–41.40 | f1149–1242 | "Solair." | End card. The sparkle spins in (about 40°/f, decaying) and "Solair" types at 1 char per 1.5 f with a lavender→white wake. The URL fades in (f1154–1157). Hold until f1212, then a 7 f fade out | T39 |

## 3. Technique catalogue

"Helios today" is judged against `src/motion/types.ts` and the kit as they stand:
- **Yes**: buildable with today's scene JSON.
- **Partly**: buildable by hand-keying, or with a gap.
- **No**: not buildable.

| # | Frames | Technique | AE build | Helios today | Pillar |
|---|---|---|---|---|---|
| T1 | f2–16 | **Echo-ghost word slam.** The word enters dim purple and defocused, then whips into place with discrete ghost copies. The line pans per word | Text per word; position keys with a strong ease; CC Force Motion Blur or Echo (about 12 echoes, decay 0.8); a camera null pans | **Partly.** `scene.motionBlur {samples: 12–16, shutter: 540–720}` already gives discrete ghosts (the shutter is clamped at 720°, `evaluate.ts:250`). There is no echo *decay* and no per-word colour settle | P5 `echo`, P2 `wake` |
| T2 | f17→18 | **1-frame zoom-out punch** to ≈0.3× (estimated from the cap-height ratio), revealing the ring world; zoom-blur on the new frame | Scale hold keys; CC Radial Fast Blur on one frame | **Yes** (hold keys + `zoom-blur` keyed for 1–2 f). No preset | P4 (`type-to-ui` sibling) |
| T3 | f18–52, f350+ | **Concentric thin rings** (1 px, white 5–8 %) plus **twinkling concave 4-point sparkles** on the ring intersections; purple radial haze | Ellipse + repeater (scale); sparkle shapes with opacity wiggle | **Yes** for the rings (`ellipse` + `repeat {scale}`). **Partly** for the sparkles: `sparklePoints` in `funTemplates.ts:139` has straight edges, and curved concave edges need a dense 48–64-point path | P1, P5 `sparkle-twinkle` |
| T4 | f24, f130 | **Keyword colour.** Lavender `#b4a3f5` for the product noun, coral `#e6607a` for the negative word | Per-character fill | **Yes** (`spans[].color`) | — |
| T5 | f53–60 | **Whole-world tilt-whip exit**: ease-in, 8 f, vertical smear | Null position ease-in + directional blur | **Yes** (null + keyed `directional-blur`) | P4 `whip` |
| T6 | f61–94 | **Tilted UI mock** (rotX ≈ 20°, 3 nested 1 px bezels), headline typed at 1 char/f, video card grows 4 f, play button pops 4 f | 3D layer, typewriter, scale keys | **Partly.** `threeD` + `reveal`; the UI is a flat image or HTML | P3 |
| T7 | f61–94, f217–300 | **3D cursors**: a purple extruded bevelled arrow and a white glossy arrow. They rotate in 3D as they fly, with banking and motion blur | Element 3D / C4D render | **No** | P7 `cursor-3d` |
| T8 | f94→95 | **1-f snap zoom**: tilt flattens, card ×1.15 (w) / ×1.35 (h), background into depth of field; slow push continues | Camera keys with a hold; lens blur on background layers | **Partly.** Camera + `lens-blur` per layer by hand; no depth-driven depth of field | P4 `scene.dof` |
| T9 | f101–107, f749 | **Press state**: the play fill swaps to `#5b3fc4` for 5–6 f and the cursor dips | Fill keys | **Yes** | P3 `click` |
| T10 | f120–136 | **Centred typewriter that re-centres every character**; newest character fades in over 2 f | Typewriter animator, centre-justified | **Partly.** `reveal` doesn't re-centre | P2 `recenter` |
| T11 | f160–164, f997–1004 | **Ease-in exit, then cut**: 4, 11, 19, 30 px/f @720; review cards ×1.4/f over 7 f | Position expo-in + motion blur | **Yes** (`expo-in` keys + `motionBlur`) | — |
| T12 | f165–207 | **Giant bloom type with a caret-follow camera** (the caret stays at about 70 % x) | Typewriter + camera parented to a caret null | **Partly.** `reveal` + `glow`; the camera is keyed by hand to the text width | P2 + P4 (`follow: caret`) |
| T13 | f207→210 | **Type → UI pill match-zoom**: 1 f to ≈0.3×, pill text directionally blurred on f208, sharp by f210 | Cut + scale + directional blur | **No** template | P4 `type-to-ui` |
| T14 | f208–300 | **Masonry tile wall** (r 28 px, 40 px black gutters, fills `#3a2476`–`#5b3ec0`) with parallax against the pill, which has a black fill, a lavender top rim and an 80 px glow | Shape layers, precomp | **Partly.** One `rect` layer per tile, so 30–40 layers become 30–40 clips (map fact 10) | P1 `array` (§7) |
| T15 | f217–300 | **Cursor arcs with banking + click ripple.** 12 f flights; the tile lights to `#a99af0`, and a radial glow spreads from the click point over 6–8 f and stays lit | Motion path + auto-orient; radial gradient keys | **Partly.** The `dock-cursor` pattern has no auto-orient or banking; the ripple is keyed by hand | P1 (auto-orient), P3 `ripple` |
| T16 | f302–318 | **Tile → capsule → dot morph into a ring of 8.** Dots go from 82×106 to 56×57 px@720 (aspect 1.30 → 1.01) in 8 f, and the non-ring tiles fade | Shape size and roundness keys per tile | **Partly.** `size` and `radius` are Props per layer; there is no grid→ring layout solver and no one-layer array | P1 `array` + §3.4 `layout.morph` |
| T17 | f318–335 | **Spinner light-up and wind-up.** Dots go dim→white in 4 f. The ring spins clockwise, **accelerating ×1.16/f** from 1.7 to 17.8 °/f (105° in 17 f), while the radius **collapses** from 453 to 238 px (ease-in). Two dots stay dim as a fixed tail | Rotation and scale keys, expo-in | **Yes** today. A path circle placed at the top of a `[2R, 2R]` box + `repeat {count: 8, rotation: 45, opacityEnd}` makes a one-layer spinner; `rotation` gets `expo-in` keys | Template (§7) |
| T18 | f332–352 (tail to f380) | **Reverse shape wipe → logo** ("logo resolve"). A giant concave sparkle arrives from beyond the lens (its black concave gaps sweep in from the edges) and **shrinks ×0.85/f** from R 595 to 87 px, **spinning 145°** (120° during the shrink, a 25° tail over 28 f). Its colour goes `#5b3d8f` → white in 11 f while the bloom grows | Shape + scale/rotation keys + fill + glow | **Partly.** Dense path + keys + `fill` effect amount + `glow`; no template, and the plan's `shape-wipe` only expands | P4 (`shape-wipe` direction `in`) |
| T19 | f350–353 | **Wordmark beside the mark**: fade + ≤30 px slide in 4 f, on the spoken brand name | Mask slide | **Partly** (`brand-logo-sting`) | P1, P4 |
| T20 | f381–420 | **Wallet card stack** rises (432 px in 31 f, exponential settle); the top card is pulled out like a file (20 f ease-in-out) to show a screenshot; the camera pushes | 3D layers, screenshots | **Partly** (`threeD` rects + `footage`; no template) | Template (§7) |
| T21 | f388–480 | **Neon eclipse ring**: a 6 px `#b69cff` ring with glow over a dark sphere with a purple rim light; crossfades with the logo over 7 f | Ellipse stroke + glow | **Yes** | — |
| T22 | f421–446 | **In-card shape wipe with the client's own logo glyph** (a blue sparkle, about ×1.25/f, f424–439), then an organic blob wipe; both are confined to the card | Shape scaled inside a card track matte | **Partly.** A track matte to the card + a scaled path, by hand | P4 `shape-wipe {within}` |
| T23 | f446–449 | **Next card flips up in front** (rotX + scale, 4 f), pushing the previous one back | 3D layer keys | **Yes** | — |
| T24 | f482–540 | **Skeleton glass dashboard assembles.** Six text-free widgets (donut, profile, bars, mini bars, area chart, legend) fly in from the top left over 8–10 f with a 2 f stagger. They carry a **bright diagonal sheen while in flight** and settle dim | 3D layers, gradient overlay keyed with flight | **Partly.** `glassCard` + `threeD`; no widget geometry, no sheen style | P1 styles, P3 `assemble` |
| T25 | f545–548 | **Tracking slam**: over-condensed (tracking about −150, scaleX squash) → normal in 3 f | Tracking animator | **Yes** (animator `tracking` + `scale`) | P2 preset `slam` |
| T26 | f584–600 | **3D device swing-in** (rotY −35° → −5°, rotZ −8° → −5°, 16 f ease-out) + **trim-path write-on** of 8 text bars, 1 f stagger | 3D layer + trim paths | **Yes** (`threeD` + `trimEnd`) | — |
| T27 | f629–720 | **One device, one state per VO noun**: 1–2 f reshape (portrait → landscape), content rebuild (fade + scale 0.95 → 1, 4 f, 2 f stagger), titles retyped, stepper rail advances | Precomps switched on markers | **Partly** (keyed by hand) | P3 `states` + P2 word-anchored `t` |
| T28 | f631–665 | **Spec tooltips**: glass cards that read "Color: #9F86D1 / Radius: 24 / Shadow: Soft glow / Font: Inter / Satoshi", so the studio shows its tokens on screen | Text on glass cards | **Yes** | P3 callout kind |
| T29 | f665–680 | **1-f angle snap** (rotZ ≈ −6°, rotY ≈ +15°) + 14 f ease-back; 3×3 thumbnail grid pops row by row (4 f per card, 1 f stagger, 3 f per row) | Hold key + ease | **Yes** | P3 `assemble` |
| T30 | f723–737 | **2D hand pointer** glide (14 f ease-out) + hover | Path cursor | **Yes** (`dock-cursor` pattern) | P3 cursor `hand` |
| T31 | f749–760 | **Device-only punch-in** 1.4× in 1 f + **radial shockwave ring** from the click point (10 f, fades) | Scale hold; ring stroke scale/opacity | **Partly** (hand-keyed ring) | P3 `click {punch}`, P5 `glow-ring` |
| T32 | f782–787 | **Colour-wake typing**: each character purple, white after about 4 f | Typewriter + fill animator with offset | **Partly** | P2 `wake` |
| T33 | f821–837 | **Word gap-close**: each word enters 30 px to the right, closes the gap in 2 f, purple → white over 6 f; the line re-centres | Per-word position + fill | **Partly** (`cascade` from position; per-word colour settle is fiddly) | P2 preset |
| T34 | f857–864, f1028–1037 | **Teleprompter push**: the new line types on the right with a thin caret while the old line slides left and fades purple → dark over 4 f; the camera pans | Camera pan + opacity/fill keys | **Partly** (by hand) | P2 (add `push`) |
| T35 | f907–919 | **Retype morph** (the notes called it a scramble; **it is not random glyphs**). The new sentence overwrites the old one left→right: "We explain your product so clearly" → "Yo explain…" → "Your cusplain your product so" → "Your customers your so" → "Your customers have". Changing characters flash lavender, the tail is deleted, and the line re-centres every frame. 12 f in all (19 new chars in about 10 f, ≈2 chars/f), and the caret vanishes | Source-text keyframes per frame (or a Decoder-style preset) | **Partly.** `blurred-sentence` swaps whole words on a strike and re-centres; there is no character-level diff | P2 (add `mode: 'retype'`) |
| T36 | f937–942 | **Condense-swap**: the old line tightens (scale 0.9, tracking in, purple glow) over 3 f, then 1 empty frame, then the new line arrives tight, purple and blurred, and snaps to white and sharp in 3 f | Tracking/scale/blur/fill animators | **Yes** by hand; no preset | P2 preset |
| T37 | f957–1004 | **Review cards fly back from the lens.** Cards start 1.2–1.5× and near the camera, tilted ±10–15°; the remaining travel shrinks ×0.84/f; stagger about 2 f; parallax float; ease-in exit ×1.4/f | 3D layers + camera | **Partly.** `card-wall-3d` flies cards in *from depth*, not from the lens | Template variant |
| T38 | f1077–1147 | **Neon capsule CTA.** The outline draws on from the top edge (1 f), the fill grows over 3 f, "Get started" types with a lavender lead, and a sparkle icon spins. **1-f press to 0.66×**, then 0.62× over the hold, while 3 concentric capsule echoes expand (≈0.5 %/f) | Trim paths from the top centre; scale hold; repeater | **Partly.** `rect` radius + `trimStart/End` + `glow` + `reveal` + `repeat {scale}`; no template | Template (§7) |
| T39 | f1149–1219 | **End card**: sparkle spins in (about 40°/f, decaying), wordmark types at 1 char per 1.5 f, URL fades in; fade out over 7 f | — | **Partly** (`brand-logo-sting`, `brand-end-card`) | — |

## 4. Measured motion grammar

### 4.1 The numbers

"Fit" means the cubic-bezier from `bezfit.py`. "Obs." means frame counting from the notes, checked on the strips.

| Token | Value | Evidence |
|---|---|---|
| **House settle** (the film's one ease-out) | Remaining distance keeps **≈0.85 per frame** (0.84–0.87) after a 1–2 f ramp. That equals `expo-out` over **≈43 f** (2^(−10/43) = 0.85). As a bezier over 30 f: `cubic-bezier(0.19, 0.92, 0.44, 0.98)` | Card stack f380–411: 432 px in 31 f, fit **(0.187, 0.368, 0.123, 0.981)** rms 0.003, 50 % at 5.5 f. Review cards f966–996: fit **(0.128, 0.781, 0.323, 0.943)** rms 0.003, remaining ×0.84/f |
| **Logo resolve: size** | Tip radius **595 → 87 px** (6.8×) in **15 f** (f337–352). Radius ×0.83–0.87/f for 10 f, then settles (0.91 → 0.99). About 22× from first contact at f332 (obs.) | `m_star.json`. Linear fit **(0.33, 0.834, 0.603, 0.99)** rms 0.006, 50 % at 3.6 f. Log-scale (perceived) fit **(0.324, 0.345, 0.668, 1.025)** rms 0.005 |
| **Logo resolve: spin** | **145°** clockwise over **43 f**: 120° inside the shrink and a 25° tail over 28 f. Peak 14.2 °/f at f340–341 | Fit **(0.162, 0.495, 0.117, 1.005)** rms 0.002, 50 % at 6 f |
| **Logo resolve: colour** | Peak luma 61 → 254 in **11 f** (`#5b3d8f` → lavender → white); the bloom grows while the shape shrinks | Fit (0.679, 0.506, 0.339, 0.687) rms 0.007 (almost linear) |
| **Tile → dot morph** | Aspect 1.30 → 1.01 and width 82 → 56 px@720 in **8 f** (f310–318); the morph starts at f302 (16 f in all) | **NEW** `m_ring.py`. Aspect fit (0.0, 0.065, 0.534, 0.882), 50 % at 2.8 f. Width fit (0.236, 0.337, 0.274, 0.609) rms 0.004 |
| **Spinner light-up** | Dot luma 164 → 231 in **4 f**, linear | **NEW** `m_ring.json` |
| **Spinner wind-up** | Angular speed **1.7 → 17.8 °/f, ×1.16 per frame**; 105° in 17 f (f318–335). Ring radius **453 → 238 px**, per-frame ratio 0.997 → 0.88 (ease-in collapse). Handed to the star at f335 | **NEW**. Rotation fit **(0.585, 0.148, 0.848, 0.503)** rms 0.0002 (the first half of an expo-in). Radius fit (0.227, 0.041, 0.714, 0.219) rms 0.003 |
| **1-frame snaps** (the film's accent) | **7 in 41 s**, about one every 6 s, each followed by a 2–14 f settle: zoom-out to ≈0.3× (f17→18, f207→208), snap zoom-in ×1.15–1.35 (f94→95), device reshape (f629→630), angle snap + 14 f ease-back (f665→666), **punch-in 1.4×** (f749→750, device only), **press to 0.66×** (f1101→1102, then 0.62 over the hold) | Obs. plus strip measurements (the ratios are ±10 %) |
| **Exit before a cut** | **3–8 f ease-in** with motion blur, then a hard cut (7 of 11 cuts). Pixel steps grow **×1.4–1.7 per frame**: 4, 11, 19, 30 px/f @720 (f160–164); 3 → 32 px/f @720 over 7 f (review cards) | Obs. + `m_cards.json` (exit x steps −3, −6, −8, −11, −16, −23, −32) |
| **Pop-in** | Dot → full in **4 f** (play button f61–65, video card f61–64) | Obs. |
| **UI entrance** | Device swing **16 f** ease-out. Widgets **8–10 f**, stagger **2 f**. Design cards fade + scale 0.95 → 1 in **4 f**, stagger 2 f. Storyboard thumbnails **4 f**, stagger **1 f per card, 3 f per row**. Next card flips up in **4 f** | Obs. |
| **Card pull-out** | **20 f** ease-in-out (f400–420) | Obs. |
| **In-card sparkle wipe** | About **×1.25/f** over 15 f (f424–439), ease-in | Obs. (≈30× in 15 f) |
| **Typewriter** | **1 char/f** for body lines; **1 char per 1.5 f** for display words ("People", the end-card "Solair"). New character fades in over 2 f. Lavender lead wake 3–4 chars behind the caret, settling to white in about 4 f | Obs. |
| **Word gap-close** | Word enters **30 px** right, closes in **2 f**, purple → white over **6 f** | Obs. |
| **Tracking slam** | Over-condensed → normal in **3 f** ("Boom") | Obs. |
| **Condense-swap** | Out **3 f**, **1 empty frame**, in **3 f** (blur + tracking + purple → white) | Obs. |
| **Retype morph** | **12 f** for 34 → 19 chars: 19 new chars in about 10 f (≈2 chars/f), left→right, the old tail deleted as the new text reaches it | Obs. (strip f905–919) |
| **Click** | Press state 5–6 f. Tile ripple 6–8 f. Shockwave 10 f. Cursor flight 12–14 f along an arc with banking | Obs. |
| **Holds** | Kinetic line 20 f. Logo lockup 19 f. "Fast." 30 f. CTA question 33 f. CTA 45 f. End card 63 f + 7 f fade | Obs. |
| **Slow drift during holds** | 0.3–2 px/f; the camera never fully stops | Obs. |

### 4.2 The grammar in one paragraph

**The house move.** Everything that arrives uses one exponential settle: about 15 % of the remaining
distance per frame, like `expo-out` over 43 f. Everything that leaves accelerates at about ×1.4 per
frame for 3–8 f and is cut mid-motion.

**Snaps and holds.** Structural changes happen in one frame, then settle, with no in-betweens: scale,
device shape, camera angle, type to UI. Holds are never static.

**Hand-offs.** Morph hand-offs couple an *accelerating* outgoing move (the spinner winds up ×1.16/f and
collapses) with an *arriving* object from the lens (the star shrinks ×0.85/f). The eye never sees an
empty frame.

## 5. Design system

### 5.1 Colour

| Role | Hex |
|---|---|
| Ground | `#010002`, `#04010a`, `#0c0716` (near-black violet) |
| Haze bands | `#1b0a33`, `#241440`, `#3f2572` (top-left and right) |
| Primary violet | `#7b61ff` ("into a business."), `#8b5cf6` (type lead), `#7c5cf0` (CTA stroke), `#7a6cf5` (nav pills), `#5b3fc4` (pressed) |
| Lavender, used for the "new" and "keyword" states | `#a78bfa` (newest word, card rims), `#b4a3f5` (keyword), `#9d8cf0` (wordmark), `#b69cff` (eclipse ring), `#d9ccff` (bloom type), `#a99af0` (lit tile), `#e9e4ff` (CTA text), `#9F86D1` (the studio's own token, shown in its tooltip) |
| Negative accent | Coral `#e6607a` |
| Tile wall | `#3a2476`, `#4a2f80`, `#5b3ec0`, `#5a4a78`; highlights `#9a89e2`, `#d9c8f5` |
| Surfaces | Pill `#050308`. CTA fill `#160d33` → `#231450`. Video placeholder `#4a4850` → `#39373e`. Stack cards `#0b1020`, `#1e3354`; top card `#eef0f6` → `#cfdcf0` |
| Client blues (portfolio only) | `#2d24f0`, `#3a2cf0`, `#5b7ff0` |

### 5.2 Type

- **Inter throughout** (OFL 1.1): SemiBold 600 for headlines and "Boom"; Medium 500 for the wordmark, the CTA and the pill.
- Sizes at 1080p:
  - giant type cap height ≈ 165 px;
  - pill text ≈ 62 px in a capsule about 190 px tall;
  - wordmark ≈ 170 px;
  - body lines ≈ 60 px cap height.
- **Colour logic.** Type is **solid white**. The *newest* word or character is lavender or purple, with bloom on display type. There is no gradient type.
- **Named fonts that can't ship.** The studio's tooltips name **Satoshi** (Fontshare licence, not OFL) and **SF Pro** (Apple). Don't bundle either.
  - OFL stand-ins: **Manrope, Figtree or Plus Jakarta Sans** for Satoshi; **Inter** for SF Pro.

### 5.3 Radii at 1080p

| Element | Radius |
|---|---|
| Tiles | 28 |
| Video card | 24 |
| Glass widgets | 24 and 39 (the film's own tooltips say "Radius: 24" and "Radius: 39") |
| Portfolio stack cards | 60 |
| Pill and CTA | Full capsule |
| Review cards | About 28 |

### 5.4 Strokes and glows

| Element | Treatment |
|---|---|
| Glass rims | 1 px, white 8–12 % or lavender `#a78bfa` |
| Stack cards | 2–3 px `#a78bfa` rim |
| Rings | 1 px, white 5–8 % |
| Pill | Outer glow about 80 px, `#8b6cf0` at 40 %, plus a 1 px lavender top-edge rim light |
| CTA | 2 px `#7c5cf0` stroke with an inner glow and an outer glow about 40 px |
| Eclipse | 6 px `#b69cff` with glow |
| Sparkle | Bloom that grows as the mark shrinks |
| Glass widgets | Diagonal specular sheen, bright only while moving |

### 5.5 Motifs

- The **concave 4-point sparkle**. It appears as:
  - the open twinkles;
  - the logo;
  - the CTA icon;
  - the end card;
  - a rhyme in the client's own sparkle wipe.
- **Concentric rings and capsule echoes** (open, eclipse, CTA radar).
- **Rounded glass on near-black.**

## 6. Sound design and VO sync

**What's there.**
- A VO-led mix over a music bed of about 115 bpm (the analysis estimate; music tags at 0.65, 5.24, 12.45, 27.51, 34.06 and 39.95 s).
- 150 onsets, about 3.6/s. By chance, an event lands within ±2 f of an onset **38 %** of the time.

**Clicks carry click sounds.** All **6 clicks and presses** sit within 2 f of an onset:

| Click | Frame | Onset |
|---|---|---|
| Play button | f101 | 3.39 s (+1.7 f) |
| Tile 1 | f233 | +0.3 f |
| Tile 2 | f266 | +0.4 f |
| Tile 3 | f293 | +1.3 f |
| Device punch | f750 | +1.6 f |
| CTA press | f1102 | −0.4 f |

- The chance of that is 0.38^6 ≈ **0.3 %**.
- `m_audio.py` finds high-band (4–11 kHz) transients with a **0–1 f rise** at f237, f266, f294 and f751. Those at f266 and f294 fall in VO gaps, so they are UI click SFX, not sibilants.

**Other sounds.**
- **"Boom"** has a sub hit: the low band (< 150 Hz) rises **+14 dB** at f548–550, against +3–6 dB for other VO words. The onset is at 18.19 s, +1.8 f after the slam.
- Whooshes on the whips can't be separated from the VO sibilants with this analysis. Don't claim them.
- None of the 3 detected cuts is on an onset (0/3). Cuts follow the VO, not the beat.

**VO sync.** The caption timings are auto-captions, ±2–3 f.

| Event class | Examples (lag in frames; + means the picture is after the word) | Rule |
|---|---|---|
| **Device or UI state change** | Script dot +4, design reshape +1.4, storyboard swap +2.6, final player +1.4 | **Lands 1–4 f after the noun** (median +2) |
| **Word pop** | "Are" +1, "you" 0, "running" +3.4, "SaaS" +5, "No" +6.2, "People" +2, "Boom" +4, "Fast" +3.4, "Two" +6.4, "weeks" +7.4, "max" +8, "no questions" +3, "Want" +6.6, "who" +3.4 | **0 to +8 f, median ≈ +4 f.** Type trails the voice slightly, never leads |
| **Typed line or morph start** | "We explain…" −4.4; retype morph −6 (it straddles "your customers", ending +6); widget fly-in −5 before "business" | **Leads by 4–6 f** so that it finishes on the word |
| **Hard cut** | Tablet cut on "a" (0); glass tray on "us" (+0.2) | **On a word onset**, usually a small function word just before the noun |
| **Brand name** | Wordmark on "Solair" (−0.4); the end card is the exception at +11.6 | **On the word** |
| **Click** | Tiles land on the click SFX, not on VO words (tile 1 is −4.4 f before "grab") | **Click = SFX frame** |

## 7. What Helios needs

### 7.1 Already in the plan: build as written

| Pillar | Items |
|---|---|
| P1 | Groups, bezier paths, SVG import (for the concave sparkle logo), morph, layer styles (sheen, rim light), auto-orient motion paths |
| P2 | Bundled Inter, `type` with `wake`/`caret`/`recenter`, word-anchored `t`, `slam` preset |
| P3 | The `ui` layer, `states`, `click`/`ripple`/`assemble` actions, the `arrow-3d` and `hand` cursors |
| P4 | `type-to-ui`, `whip`, `shape-wipe`, `scene.dof`, parallax fields, and the continuity guide (the sparkle) |
| P5 | `echo`, `glow-ring`, `sparkle-twinkle` |
| P7 | The `cursor-3d` preset |
| P9 | UI click, sub boom, shimmer, typing; the `click`→`pop` bug fix |
| P10 | `motion_guide`, `TIMING`, pacing QA |

### 7.2 Missing or wrong for this film (add only these)

1. **P2: retype morph.** The film's "scramble" is a **character-level diff overwrite**. P2's
   `scramble {to, glyphs, perFrame}` (random glyphs) would look wrong. Add a mode, and add the
   teleprompter push and a caret-follow camera target.
2. **P1: one-layer `array` item** (the concrete form of §3.4's `layout.morph`).
   - It holds N rounded rects in one shape layer, with `grid`/`masonry` and `ring` layouts, a morph
     parameter with per-item stagger, per-item highlight (the clicked tiles) and a ring spin.
   - Without it the tile wall costs 30–40 layers, which become 30–40 timeline clips (map fact 10).
3. **P4: `shape-wipe` needs `direction: 'in'`** (the logo resolve: it arrives from the lens and shrinks
   ×0.85/f with a spin) and **`within: layerId`** (the wipe confined to a card, with the client's glyph).
   - The measured `rate`s are 1.25 out and 0.85 in.
4. **P4/P10: a `snap` transition token.**
   - It is a hold-key state change in one frame plus a settle curve of 2–14 f.
   - The seven presets and their scales are in §4.
   - It pairs with the **"exit then cut"** rule: a cut is hidden behind a 3–8 f ease-in exit on a shared ground (7 of 11 cuts here).
5. **P3: `click` gains `punch?: number`** (scale only the targeted device, 1 f) and
   **`ripple: 'fill' | 'shockwave'`**. Also:
   - a **stepper-rail** part kind;
   - `create_ui_screen {skeleton: true}` for text-free glass widgets (donut, bars, area chart, profile card, legend);
   - a `spec-callout` kind that prints brand tokens.
6. **P5/P1: `sheen` on glass cards, tied to motion.** The diagonal specular is bright while a layer
   moves and fades when it lands. It is a `gradient-overlay` style whose opacity follows the layer's
   speed, and the builder can key it.
7. **P7: ship `cursor-3d` as a bundled asset, not a per-project render.**
   - Render a 72-angle turntable once (purple and white variants).
   - At build time, pick the frame from the path heading.
   - Needs `FootageSource.sequence` (A1) + `timeRemap` keys written by the builder, because expressions can't see the path.
8. **P10: the VO lag policy** as defaults for word-anchored times (a `{word, offset}` default per event class). Pacing QA checks them:
   - UI states `+2 f` (range 1–4);
   - word pops `+4 f` (range 0–8);
   - typed lines `−5 f`;
   - clicks on their SFX frame.
9. **P10 `TIMING`: the house settle.** `settle: { ease: 'expo-out', frames: 43 }` (k ≈ 0.85) and
   `exit: { ease: 'expo-in', frames: 3–8 }`, alongside the §2.1 tokens.
10. **Kit templates (NEW):**
    - `kinetic-open-rings` (echo words → 1 f zoom-out into rings);
    - `type-to-pill-wall`;
    - `grid-to-spinner-to-logo` (plan);
    - `logo-resolve`;
    - `card-stack-showcase`;
    - `glass-dashboard-assemble`;
    - `device-steps`;
    - `review-cards-from-lens`;
    - `capsule-cta`;
    - `teleprompter-lines`.

### 7.3 Schema sketch (`src/motion/types.ts` terms; NEW unless noted)

```ts
// TextLayerData (P2 adds `type`; these extend it)
morph?: {                       // T35 retype, T36 condense-swap
  to: string; at: number;
  mode: 'retype' | 'scramble' | 'condense';   // retype = left→right diff overwrite, re-centres per frame
  charsPerFrame?: number;       // ≈2 measured
  flash?: string;               // '#a78bfa' on characters in flux
};
push?: { at: number; by: Vec; duration?: number /* 0.13 */; ease?: Ease; fadeTo?: string };  // T34 teleprompter

// ShapeData: one layer, N items (P1 group-based; §3.4 layout.morph)
array?: {
  count: number;
  item: { radius: Prop<number>; fills: string[] };
  grid?: { cols: number; rows: number; gap: number; masonry?: boolean; seed?: number };
  ring?: { count: number; radius: Prop<number>; dot: number; tail?: { count: number; opacity: number } };
  morph: Prop<number>;          // 0 grid → 1 ring; items outside the ring fade
  stagger?: number;             // s per item (0.033)
  spin?: Prop<number>;          // ring rotation, deg (wind-up = expo-in keys)
  highlight?: { index: number; at: number; color: string; ripple?: boolean }[];   // T15 clicked tiles
};

// P4 transition (extends the plan's shape-wipe)
{ type: 'shape-wipe'; glyph: 'sparkle' | 'blob' | `layer:${string}`; direction: 'out' | 'in';
  within?: string /* layer id: confine to a card */; rate?: number /* 1.25 out, 0.85 in */; spin?: number /* 145 */ }
{ type: 'snap'; at: number; to: Partial<Transform>; settle?: { ease: Ease; frames: number } }   // T2 T8 T29 T31 T38

// P3 UiAction (extends the plan)
| { t: TimeRef; type: 'click'; target: string; punch?: number /* 1.4 */; ripple?: 'fill' | 'shockwave' }
// FootageSource.sequence (A1) + timeRemap keys → orientation-indexed 3D cursor sprite
```

### 7.4 AI knowledge (`motion_guide {topic: 'ai-launch'}`, P10)

**Beat recipe for an agency or AI reel, 40 s.** Percentages are of the runtime.

| Beat | Share | Content |
|---|---|---|
| Hook question | 5 % | Kinetic type, then a zoom-out punch into the world |
| Problem | 10 % | UI + cursor + snap zoom |
| Claim | 7 % | Type → UI pill |
| Proof of attention | 8 % | Tile clicks |
| **Brand reveal** | at 25–30 % | The morph into the logo, landing on the spoken name |
| Portfolio | 8 % | Card stack |
| Process | 15 % | One device, a state per noun |
| Punchline | 3 % | Slam |
| Speed and clarity | 12 % | Word pops, teleprompter, retype |
| Social proof | 4 % | Review cards |
| CTA question, then capsule CTA | 10 % | |
| End card | 7 % | |

**Rules:**
- Keep one ground colour, so cuts vanish.
- Hide every cut behind an ease-in exit.
- At most one 1-frame snap per about 5 s.
- The newest word is lavender and older words are white.
- Every click has a click SFX on the press frame.
- UI state changes trail the spoken noun by 1–4 f.

### 7.5 Assets

- **Inter** (OFL, P2 bundle), plus Manrope or Figtree.
- Lucide `sparkle`, `play`, `mouse-pointer-2` and `pointer` (ISC, P1).
- The concave sparkle, as the brand SVG through `import_brand_logo` (P1). Until then, a 64-point
  superellipse |x|^0.6 + |y|^0.6 = 1 path.
- The CC0 SFX: UI click, soft whoosh, sub hit, shimmer and typing. `search_sfx {online: true}` can
  already fetch these from Freesound CC0 and Openverse.
- Portfolio screenshots from `create_ui_screen` or from the user.

### 7.6 Blender (P7)

- **Only the 3D cursors need real 3D.** The film's two cursors are:
  - an extruded arrow, bevel about 4 % of its height, glossy purple with an emissive rim;
  - a white glossy variant.
- **The render.** `render_3d_scene {preset: 'cursor-3d'}` renders a turntable (72 × 5°, 512 px RGBA, Cycles 32 spp) and ships it as an app asset.
- **Everything else is 2.5D.** The tablets, tray, cards, eclipse and glass widgets are `threeD` planes.
  Don't spend Blender time on them.

## 8. Recreate recipe: the best 10 s (f165–f480, film 5.47–15.97 s)

**What the 10 s covers:** giant bloom type → pill snap → tile wall clicks → tiles → dots → spinner wind-up →
sparkle resolve → logo → card stack.

Scene time 0 = film f165. Convert frames with t = (f − 165)/30.

**Tool calls** (after the plan ships; NEW marks tools and fields that don't exist yet):
1. `create_brand_kit {name: "Solair", colors: ["#04010a", "#7c5cf0", "#a78bfa", "#e9e4ff", "#e6607a"], fonts: ["Inter"]}`, then `import_brand_logo {path: "solair-sparkle.svg"}`. This vector import comes with P1.
2. `synthesize_speech_voiceover {text: "People have clicky attention now. If you don't grab them fast, you lose them. At Solair, we make short, attention-grabbing explainer videos."}`, then `analyze_clip_speech` for the word times.
3. `motion_guide {topic: "ai-launch", beat: "brand-reveal"}` (NEW, P10).
4. `create_ui_screen {kind: "dashboard", theme: "light"}` ×3 for the portfolio cards (NEW, P3), or `import_media` with screenshots today.
5. `create_motion_scene {scene: …}` with the sketch below (NEW fields marked). Nest it: it has 14 layers, not 40, thanks to `array`.
6. SFX:
   - `place_sfx {kind: "click", at: 7.73 / 8.83 / 9.73}` (NEW kind, P9);
   - `place_sfx {query: "soft whoosh", at: 6.85}`;
   - `place_sfx {query: "shimmer", at: 11.0}`;
   - `place_sfx {kind: "swish", at: 12.6}`.
7. Check:
   - `run_frame_qa {pacing: "ai-launch"}` (NEW pacing check: settle k, snap count, VO lags);
   - `consult_council`;
   - a side-by-side contact sheet against the reference.

```jsonc
{
  "version": 1, "width": 1920, "height": 1080, "duration": 10.5, "background": "#04010a",
  "motionBlur": { "samples": 12, "shutter": 360 },
  "cues": [
    { "at": 1.43, "sound": "whoosh", "note": "type→pill snap" },
    { "at": 2.27, "sound": "click" }, { "at": 3.37, "sound": "click" }, { "at": 4.27, "sound": "click" },
    { "at": 3.6, "sound": "riser", "note": "ends on the star at 5.57" },
    { "at": 6.2, "sound": "chime", "note": "wordmark on VO 'Solair'" },
    { "at": 7.2, "sound": "whoosh", "note": "stack rises" }
  ],
  "layers": [
    { "id": "haze", "type": "procedural", "kind": "radial-glow", "params": { "inner": "#3f2572", "outer": "#04010a", "center": [0.12, 0.08], "radius": 0.9 } },

    // A · giant typed line, camera follows the caret (P2 `type` + NEW follow)
    { "id": "pan", "type": "null", "transform": { "position": { "k": [ { "t": 0, "v": [960, 540], "ease": "linear" }, { "t": 1.43, "v": [-620, 540] } ] } } },
    { "id": "giant", "type": "text", "parent": "pan", "out": 1.433,
      "text": { "text": "People have clicky attention now", "font": "Inter", "weight": 600, "size": 230, "color": "#ffffff", "align": "left",
        "type": { "cps": 22, "wake": { "color": "#d9ccff", "chars": 6, "settle": 0.2 } } },          // P2 (plan)
      "effects": [ { "type": "glow", "radius": 36, "intensity": 0.7, "color": "#b69cff" } ] },

    // B · tile wall + morph + spinner in ONE layer (NEW P1 `array`)
    { "id": "wall", "type": "shape", "in": 1.433, "out": 5.8,
      "transform": { "position": { "expr": "wiggle(0.3, 14)", "v": [960, 540] } },
      "shape": { "shape": "rect", "size": [2400, 1500],
        "array": { "count": 36, "item": { "radius": 42, "fills": ["#3a2476", "#4a2f80", "#5b3ec0", "#5a4a78", "#9a89e2"] },
          "grid": { "cols": 8, "rows": 5, "gap": 40, "masonry": true, "seed": 7 },
          "ring": { "count": 8, "dot": 84, "tail": { "count": 2, "opacity": 45 },
                    "radius": { "k": [ { "t": 5.1, "v": 453, "ease": [0.227, 0.041, 0.714, 0.219] }, { "t": 5.667, "v": 238 } ] } },
          "morph": { "k": [ { "t": 4.567, "v": 0, "ease": [0.236, 0.337, 0.274, 0.609] }, { "t": 5.1, "v": 1 } ] },
          "stagger": 0.033,
          "spin": { "k": [ { "t": 5.1, "v": 0, "ease": [0.585, 0.148, 0.848, 0.503] }, { "t": 5.667, "v": 105 } ] },
          "highlight": [ { "index": 14, "at": 2.267, "color": "#a99af0", "ripple": true },
                         { "index": 9, "at": 3.367, "color": "#8b7cf5", "ripple": true },
                         { "index": 3, "at": 4.267, "color": "#d9c8f5", "ripple": true } ] } },
      "effects": [ { "type": "zoom-blur", "amount": { "k": [ { "t": 1.433, "v": 0.5, "ease": "expo-out" }, { "t": 1.5, "v": 0 } ] } },
                   { "type": "brightness-contrast", "brightness": { "k": [ { "t": 5.1, "v": 0, "ease": "linear" }, { "t": 5.233, "v": 60 } ] } },
                   { "type": "glow", "radius": 24, "intensity": { "k": [ { "t": 5.1, "v": 0 }, { "t": 5.233, "v": 1 } ] } } ] },

    // C · the pill: 1-frame match-zoom from the giant line (P4 `type-to-ui`)
    { "id": "pill", "type": "precomp", "in": 1.433, "out": 4.567,
      "transform": { "scale": { "k": [ { "t": 1.433, "v": 112, "ease": "expo-out" }, { "t": 1.5, "v": 100 } ] },
                     "opacity": { "k": [ { "t": 4.467, "v": 100, "ease": "linear" }, { "t": 4.567, "v": 0 } ] } },
      "effects": [ { "type": "directional-blur", "direction": 90, "length": { "k": [ { "t": 1.433, "v": 60, "ease": "expo-out" }, { "t": 1.5, "v": 0 } ] } } ],
      "scene": { "…": "capsule 1180×190 #050308, 1 px #a78bfa top rim, glow 80 px #8b6cf0 40 %, Inter 500 62 px white" } },

    // D · 3D cursor: orientation-indexed sprite (NEW: FootageSource.sequence + builder-written timeRemap; P1 auto-orient path)
    { "id": "cursor", "type": "footage", "in": 1.733, "out": 4.567, "motionBlur": true,
      "source": { "sequence": { "dir": "app:assets/cursor-3d-white", "fps": 30, "frames": 72 }, "timeRemap": { "k": [ "…builder: heading/5° per key…" ] } },
      "transform": { "position": { "k": [ "…arcs 1.733→2.267, 2.8→3.367, 3.7→4.267; 12 f flights, ease [0.19, 0.92, 0.44, 0.98]…" ] }, "bank": 15 } },   // NEW bank

    // E · the sparkle arrives from the lens and resolves into the logo (NEW P4 shape-wipe direction 'in'; buildable today by hand)
    { "id": "mark", "type": "shape", "in": 5.567,
      "shape": { "shape": "path", "size": [175, 175], "closed": true, "fill": "#5b3d8f", "points": "…64-pt superellipse |x|^0.6+|y|^0.6=1…" },
      "transform": { "position": { "k": [ { "t": 5.567, "v": [870, 520], "ease": [0.19, 0.92, 0.44, 0.98] }, { "t": 6.233, "v": [760, 545] } ] },
        "scale": { "k": [ { "t": 5.567, "v": 2200, "ease": "expo-out" }, { "t": 5.733, "v": 680, "ease": [0.33, 0.834, 0.603, 0.99] }, { "t": 6.233, "v": 100 } ] },
        "rotation": { "k": [ { "t": 5.567, "v": -40, "ease": "linear" }, { "t": 5.733, "v": 0, "ease": [0.162, 0.495, 0.117, 1.005] }, { "t": 7.167, "v": 145 } ] } },
      "effects": [ { "type": "fill", "color": "#ffffff", "amount": { "k": [ { "t": 5.733, "v": 0, "ease": [0.679, 0.506, 0.339, 0.687] }, { "t": 6.1, "v": 100 } ] } },
                   { "type": "glow", "color": "#b69cff", "radius": { "k": [ { "t": 5.733, "v": 10 }, { "t": 6.233, "v": 48 } ] }, "intensity": 1.2 } ] },
    { "id": "wordmark", "type": "text", "in": 6.167,
      "text": { "text": "Solair", "font": "Inter", "weight": 500, "size": 170, "color": "#9d8cf0" },
      "transform": { "position": { "k": [ { "t": 6.167, "v": [1070, 548], "ease": "expo-out" }, { "t": 6.3, "v": [1040, 548] } ] },
                     "opacity": { "k": [ { "t": 6.167, "v": 0, "ease": "linear" }, { "t": 6.267, "v": 100 } ] } } },
    // (mark + wordmark parented to a "lockup" null that lifts 30 px and fades 7.433→7.667)

    // F · portfolio: eclipse ring + wallet stack (NEW template card-stack-showcase; buildable today with threeD layers)
    { "id": "eclipse", "type": "shape", "in": 7.433, "shape": { "shape": "ellipse", "size": [1500, 1500], "fill": null, "stroke": "#b69cff", "strokeWidth": 9 },
      "transform": { "position": [960, 170], "opacity": { "k": [ { "t": 7.433, "v": 0 }, { "t": 7.667, "v": 100 } ] } },
      "effects": [ { "type": "glow", "radius": 40, "intensity": 1 } ] },
    { "id": "stack", "type": "precomp", "in": 7.2,
      "transform": { "position": { "k": [ { "t": 7.2, "v": [960, 1500], "ease": [0.187, 0.368, 0.123, 0.981] }, { "t": 8.233, "v": [960, 1068] } ] } },
      "scene": { "…": "4 threeD rects r 60, 3 px #a78bfa rim; card-1 = client screenshot pulled up 7.833→8.5 (ease-in-out); in-card wipe 8.567→9.133 = { type:'shape-wipe', glyph:'layer:client-logo', within:'card-1', direction:'out', rate:1.25 } (NEW); card-2 rotationX 70→0 at 9.367 over 4 f" } }
  ]
}
```

**Today's fallback, without the NEW fields:**
- Build the wall as 36 rect layers inside a `precomp`, each with keyed `size`, `radius` and `position`.
- Build the spinner with the repeater trick (T17).
- Build the cursor as a 2D path with a gradient.
- Use `pop` cues until P9 fixes `click`.
- Pass `nest: false` or a precomp so the timeline doesn't get 40 clips.

## 9. Top 10 improvements

| # | Improvement | Size | Why (this film) |
|---|---|---|---|
| 1 | **P2 `morph {mode: 'retype' \| 'condense'}` + `push` (teleprompter) + a caret-follow camera target** | M | T12, T34, T35, T36 cover a third of the film's type; the plan's random scramble is the wrong effect |
| 2 | **`logo-resolve` = `shape-wipe {direction: 'in'}`** with the measured curve (×0.85/f shrink, 145° spin with a 43 f tail, 11 f colour ramp, growing bloom) | S | The signature reveal; the plan only has the expanding wipe |
| 3 | **P1 `array` item + `grid-to-spinner-to-logo` template**: masonry → capsules → ring, light-up, wind-up at ×1.16/f with a collapsing radius | M | Makes the golden beat one layer instead of 40 clips |
| 4 | **`TIMING` tokens from this film**: settle = `expo-out` over 43 f (k 0.85); exit = expo-in 3–8 f (×1.4/f); the 7 snap presets (0.3× out, 1.15–1.4× in, 0.66× press) with 2–14 f settles | S | The whole film is one ease family; cheap and high-leverage |
| 5 | **`type-to-ui` pill snap** as a template (1 f to about 0.3×, 2 f directional-blur settle, glow pill over a wall) | S | T2/T13, the film's hook device, used twice |
| 6 | **P3 click grammar**: press state 5–6 f, ripple 6–8 f, optional device-only `punch` 1.4× + shockwave 10 f, **click SFX on the press frame** | S–M | 6/6 clicks carry a click sound (p ≈ 0.3 %) |
| 7 | **`cursor-3d` as a bundled, orientation-indexed sprite** (a one-off Blender turntable, 72 angles, two looks) + path banking | M | Both 3D cursors; no per-project render wait |
| 8 | **`card-stack-showcase` template**: wallet rise with the house settle, pull-out, in-card client-logo wipe (`within`), flip-up of the next card, eclipse ring | M | The portfolio beat, reusable for any "our work" or "integrations" moment |
| 9 | **`device-steps` template + P3 skeleton glass widgets**: one device, states on VO nouns (+1–4 f), stepper rail, 1-f angle snap + 14 f ease-back, row-by-row grid pops, sheen-while-moving | M–L | T24, T26–T29: the process section, 15 % of the film |
| 10 | **VO lag policy + pacing QA**: UI states +2 f, word pops +4 f, typed lines −5 f, cuts on the function word before the noun, clicks on SFX; checked by `run_frame_qa` | S | These are measured rules the AI can follow and QA can verify |

The next two items would be `capsule-cta` (draw-on from the top edge, 1-f press, radar echoes; **S**) and
`review-cards-from-lens` (a variant of `card-wall-3d`; **S**).

---

**Measurement files** (all in `out/luoDI5Bo0w0/`, local only):

| File | Contents |
|---|---|
| `m_star.json` | Logo resolve (earlier analyst) |
| `m_stack.json` | Card stack (earlier analyst) |
| `m_cards.json` | Review cards (earlier analyst) |
| `m_summary.py` | The fits above |
| `m_ring.py` → `m_ring.json` | **NEW**: tile→dot morph, light-up, wind-up |
| `m_audio.py` → `m_audio.json` | **NEW**: high- and low-band energy at 35 visual events |
