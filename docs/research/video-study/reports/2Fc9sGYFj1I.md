# 2Fc9sGYFj1I · "Modern Motion Vol.1" (Motion Design School): AE + Blender

Study date 2026-09-25. Sources:
- **Frame-by-frame notes:** [out/2Fc9sGYFj1I/notes.md](../out/2Fc9sGYFj1I/notes.md), from the earlier analyst.
- **Analyser output:** [analysis.md](../out/2Fc9sGYFj1I/analysis.md), giving the shots, moves, VO words and onsets.
- **Visual check:** 9 frames reviewed for this report.
- **Measurements:** `measure_moves.py` was run for the first time here. Its output is in the scratchpad and the numbers are quoted below.
- **Blender proof 2:** [blender_proof/proof2.py](../blender_proof/proof2.py), with its inputs and outputs in
  [blender_proof/p2/](../blender_proof/p2/) and the contact sheet at [blender_proof/proof2_sheet.jpg](../blender_proof/proof2_sheet.jpg).

Frame numbers `f` are 1-based at the upload's **15 fps**, so t = (f−1)/15. The AE comp in the screen capture also reads
"15,00 fps" (f929), so the film was most likely *authored* at 15 fps, not just uploaded at it.

---

## 1. What the film is

A 90 s promo for a webinar course. A male voice-over drives the whole thing, over a steady music bed. The pitch is
"fusing Blender's modelling with After Effects' new Advanced 3D renderer".

**Structure.**

| Time | Beat |
|---|---|
| 0–10 s | Three hero 3D vignettes: a crystal, a "fruit" assemblage, then the title "Modern Motion Vol.1" |
| 10–58 s | Tutorial screen captures (Blender modelling, AE Advanced 3D) intercut with the hero renders, ending on a 3×2 grid of all six scenes swapping from 2D concept art to 3D render |
| 58–79 s | UI captures, then "FIRST LESSON FREE" over a dimmed collage |
| 79–83 s | Card zoom into the '4' scene, which explodes into the title letters dropping into place |
| 83–90 s | MDS script logo write-on, then the "Enroll now" card |

**Key production finding** (confirmed on f379 and f929 for this report):
- **Blender was used for modelling**, and very likely for animation blocking: grey-shaded Blender playblasts of the pile
  and '4' assembling appear in the f1080–1172 collage.
- **The hero frames are rendered by After Effects' Advanced 3D renderer.** The evidence:
  - glTF imports (`crystal_v2.gltf` + `.bin` in the project panel);
  - the "Model Settings" dialog;
  - the "Advanced 3D" and "Draft 3D" viewer switches;
  - the Super3D primitive panel;
  - extruded AE shape layers (the kintsugi "M" is `Shape Layer 19` parented to `Null 129`).
- **The crystal's per-facet iridescence** comes from a hand-made gradient comp, **`Custom_HDRI`**, used as the
  environment light and reflected by a glossy faceted mesh.

**Consequence for Bhippi:** the look class is **real-time rasteriser + image-based light + soft shadows + DOF + a
painterly post**, not path tracing. EEVEE is the natural analogue, and proof 2 shows EEVEE can do all of it,
including the glass.

## 2. Shot breakdown (tagged)

Tags:
- **AE-3D** is rendered by AE Advanced 3D. Models come from Blender glTF, Super3D primitives or extruded AE shapes.
- **BLENDER** is Blender itself on screen (UI capture or playblast).
- **2D** is flat AE layers.
- **CAP** is a screen capture of a UI.

| # | Frames | Time | Content | Tag |
|---|---|---|---|---|
| 1 | 1–53 | 0.0–3.5 | Faceted crystal spinning on blue; glossy spheres spiral with true occlusion. Chalk doodle loops write on. Animated gradient frame border | AE-3D (crystal modelled in BLENDER) + 2D doodles/border |
| 2 | 54–97 | 3.5–6.4 | Morph by scale-through from a shared pivot (f48–58). Green "fruit" assemblage (twig, ginkgo leaf, glass slice, ball) with a shape-cycling block (f63–88). Card-zoom reveal out (f89–96) | AE-3D (leaf modelled in BLENDER, f537–596) |
| 3 | 98–150 | 6.5–10.0 | Purple cyclorama title. Mixed-material letters tumble in (f99–128). Flat "Ae × blender" lockup (f113–121) | AE-3D + 2D lockup |
| 4 | 151–220 | 10.0–14.6 | Blender: crystal modelled from a cube with loop cuts | BLENDER CAP |
| 5 | 221–275 | 14.7–18.3 | Balanced stack rebuilds into a pile (f236–256). Background crossfades green → pink/yellow. Small primitives pop on top (f257–268) | AE-3D (motion likely blocked in BLENDER) |
| 6 | 276–347 | 18.3–23.1 | AE: glTF crystal in Draft 3D, Super3D panel, spheres placed | AE-3D CAP |
| 7 | 348–377 | 23.1–25.1 | AE comp: crystal lit by the gradient env, orbit guides | AE-3D CAP |
| 8 | 378–426 | 25.1–28.3 | AE: comp tabs `Custom_HDRI`, `sc1_env`; spiral keyframing. Diagonal hard wipe out (f425–428) | AE-3D CAP + 2D wipe |
| 9 | 427–487 | 28.4–32.4 | Montage: stack → pile, pile explodes into the '4' scene (camera orbit ~60°), wipes #2 and #3 | AE-3D + 2D wipes |
| 10 | 488–497 | 32.5–33.1 | Title reassembles, fast | AE-3D |
| 11 | 498–536 | 33.1–35.7 | Fly-through (zoom ×1.36 in 10 f) into the pink floating scene; ribbon folds into the "M" | AE-3D |
| 12 | 537–596 | 35.7–39.7 | Blender: ginkgo leaf modelled over the 2D concept | BLENDER CAP |
| 13–14 | 597–687 | 39.7–45.7 | AE: fruit timeline; pile on transparency; live gradient-material change | AE-3D CAP |
| 15 | 688–880 | 45.8–58.6 | AE '4' scene, then the **3×2 grid of loops**: builds f752–762, swaps 2D concept → 3D f795–820, holds | CAP → 2D grid of AE-3D loops |
| 16 | 881–956 | 58.7–63.7 | Grid exits; glTF import dialog; **magenta marker annotations** f926–956 | AE-3D CAP + 2D |
| 17 | 957–1190 | 63.7–79.3 | AE 4-up views; extruded "M". **FIRST LESSON / FREE** over a dimmed collage (concept timelapse, AE, Blender). **Card zoom** f1173–1180 into the '4' scene exploding | CAP + BLENDER playblast + 2D + AE-3D |
| 18 | 1191–1247 | 79.3–83.1 | **Letters drop** into the title; lockup build; slow drift | AE-3D + 2D |
| 19 | 1248–1350 | 83.1–90.0 | MDS brush-script logo write-on (17 f), then "Enroll now at: motiondesign.school" | 2D |

**Screen time:**

| Kind | Time |
|---|---|
| Hero 3D renders | ≈ 27 s |
| UI/tutorial captures | ≈ 45 s |
| Pure 2D (supers, logo, end card) | ≈ 9 s |
| Grid | ≈ 9 s |
| Blender-rendered hero frames | **None** |

## 3. Technique catalogue

"Bhippi status" refers to the engine as described in `00-bhippi-brief.md` and the pillars in `REFERENCE-FILMS-PLAN.md` §4.

| # | Technique | Frames | How it is built (AE/Blender) | Bhippi status |
|---|---|---|---|---|
| 1 | **Gradient-environment iridescent crystal** | 1–53, 348–424 | glTF faceted mesh; glossy metallic material; the `Custom_HDRI` gradient comp as the environment light in Advanced 3D | None today. **Reproduced in Blender** by proof 2 (a), with EEVEE and Cycles → P7 preset `crystal-gradient-env` |
| 2 | Glossy spheres spiralling with true occlusion | 1–53 | Super3D sphere primitives keyed on a spiral in AE 3D | P7 (objects + orbit keys). A 2.5D fake is possible with P6 |
| 3 | Chalk doodle loops | 13–53, 63–88 | Shape + trim paths + roughen edges; ~3 px @1280 | Partly: trim paths exist; roughen and bezier paths are P1 |
| 4 | **Animated gradient frame border** | hero shots, 1178–1247 | 4-colour gradient on a full-frame solid with an inverted inner mask, angle animated. ~20 px @1080: purple / pink / yellow | None as an effect. Stroke gradients are unsupported → NEW `gradient-border` effect (S) |
| 5 | Morph by scale-through on a shared pivot + background crossfade | 48–58, 236–241, 433–440 | Old object spins faster and scales to 0 over 5 f while the new one scales up from the same point over 5 f; background crossfade 6 f | Possible by hand (keys + crossfade); template-able (P4) |
| 6 | **Card zoom reveal** | 89–96, 1173–1180 | Next shot's precomp scales ~29% → 100% in 8 f, expo-out, no shadow | Possible by hand (precomp + scale); no packaged transition → P4 |
| 7 | **Letters tumble-drop into a title** | 98–128, 1191–1214 | Extruded letters of mixed materials fall tumbling, land with one bounce while righting, micro-bounce, settle; 1–2 f stagger; contact shadows; DOF | None (no 3D extrusion). **Keyed version proven in Blender** by proof 2 (d) → P7 `letters-drop` |
| 8 | Flat per-character lockup ("Ae × blender") | 113–121, 1205–1213 | AE text animator: tile pop with overshoot, "×" rotate-in, wordmark chars drop and rotate at 1 f stagger; 8 f in all | **Exists**: text `cascade` by char with position/rotation/scale from-values and a back ease |
| 9 | Painted cyclorama + **window gobo** + haze + strong DOF | 98–150, 1191–1247, 257–275 | Background plate or 3D cyc; 4-pane window light on the back wall; haze streaks | Background plate possible. **Cyc + camera-invisible gobo occluder proven** in proof 2 (d). Haze still to do |
| 10 | **Painterly post filter** | every hero render | Brush/crumpled-paper texture, smeared edges (oil/Kuwahara-like), fine grain | Grain exists. NEW `painterly` effect (P5) |
| 11 | Hard diagonal wipe | 425–428, 459–460, 477–487 | AE Linear Wipe at ~−50°, 0 feather, 4 f; can be layered over a 3D camera move | By hand with a keyed mask; no packaged transition → P4 |
| 12 | 3D camera orbit / fly-through with DOF | 453–464, 498–513 | AE 3D camera | Needs P7 (2.5D camera works on planes only) |
| 13 | Shape-cycling element | 63–88 | Layer swap every 1–2 f, or shape keys | P7 (visibility keys per object) |
| 14 | **Grid of live loops**, 2D concept → 3D swap | 752–892 | 6 precomps in a 3×2 grid (640×540 centre crops). Hard pops 1 per 2 f in scattered order; swaps 1 per 5 f in reading order; reverse exit | By hand with precomps; NEW `grid-of-loops` template (P4) |
| 15 | Tutorial language: dimmed UI collage + **marker annotations** | 926–956, 1047–1190 | Screen captures at ~50% black. Magenta `#d62bd6` round-cap stroke ~6 px @1080, written on in 2–5 f, unwritten in 2–3 f | Footage + trim paths exist; a roughened "marker" preset is P1. Pin to 3D objects with `objects2d.json` (proof 2) |
| 16 | Super revealed by a sliding panel | 1047–1058 | White Montserrat ExtraBold ~150 px cap height, clipped by the leading edge of a collage panel sliding in: 1590 px in 5 f, decelerating | Track matte + keys exist; Montserrat must be bundled (P2) |
| 17 | Brush-script logo write-on | 1248–1265 | Stroke write-on along the script paths, 17 f | Partly (trim on polylines); P1 (SVG import + trim) |
| 18 | Material / colour morph | 236–241, 672 | Colour keys on materials; live gradient change | P7 (material keys) |
| 19 | Pile explode / disassemble | 453–464, 1178–1190 | Keyed or simulated | P7 physics, with the **bake-once rule** from §7 |

## 4. Measured grammar

At 15 fps. "rms" is the fit error of a cubic-bezier to the normalised curve.

| Token | Value | Evidence |
|---|---|---|
| Shot length | 19 detected shots, mean 4.74 s. Hero vignettes 2.6–4.1 s; UI captures 2–15.6 s | analysis.md |
| **Card zoom** | ~29% → 100% width in **8 f (0.53 s)**. f1174→1181 widths @720p: 632, 863, 1019, 1127, 1199, 1246, 1271, 1279. Fit **cubic-bezier(0.15, 0.46, 0.43, 1.0)**, rms 0.0003. The remaining gap shrinks ×0.71, 0.64, 0.63, 0.59, 0.53… per frame (expo-out) | `measure_moves` card2 |
| Card reveal #1 | Width 20% → 40% → 55% → 80% → 100% over f90–96 (6 f, 0.4 s); the next shot already plays inside | notes |
| Diagonal wipe | 4 f (0.27 s), hard edge at ~−50°, top-right → bottom-left | notes |
| Sliding-panel super | 1590 px in 5 f (0.33 s), decelerating (~318 px/f average) | notes |
| **Letters drop** | Cascade f1191–1214 (23 f, 1.5 s). **Stagger 1–2 f (0.07–0.13 s)**: M f1193–95, o f1195, t f1199–1203, i f1203, V/o/l/1 f1197–1213, "Modern" f1204–1214 | notes |
| Torus "o" landing | Contact at f1194. It **bounces while righting itself**: rises ~75 px @1080 to its apex at f1199 (5 f), lands at f1202 (3 f), blips at f1205 (1 f), rests at f1206. So: one bounce (up 0.33 s, down 0.2 s), one micro-bounce, overshoot settled in 2–3 f | `measure_moves` torus cy |
| Lockup build | 8 f (0.53 s): tile pop 2 f with overshoot; "×" +1 f; wordmark chars at 1 f stagger over 5 f | notes |
| Morph scale-through | Out 5 f, in 5 f, background crossfade 6 f | notes |
| Grid | Build: 1 tile per 2 f, scattered order, hard pops. Swap: 1 tile per 5 f in reading order. Exit: 1 per ~2 f, reversed | notes |
| Hero camera | **Shot 1:** push-in scale 0.99 → 1.12 over 3 s, rise 68 px @1080, dy fits cubic-bezier(0.65, 0, 0.41, 0.90) (rms 0.025). **Title drift:** scale 1.0 → 0.982 and rise 31.5 px over 3.7 s, ease-out (≈(0.18, 1, 0, 1), rough fit). **Fly-through:** zoom ×1.36 + pan (171, 146) px in 10 f, ease-out | `measure_moves` cam_* |
| Crystal spin | Linear. Autocorrelation repeats at 16–17 f (1.1 s); the eyeball estimate was ~3 s/rev. Treat as **3–6.5 s per revolution** | `measure_moves` autocorr |
| Annotation strokes | Write-on 2–5 f, hold, unwrite or fade 2–3 f | notes |
| Logo write-on / end card | 17 f (1.13 s) / static hold 3.8 s | notes |
| Ease habit | Most hero moves read ease-out (fast start, long settle), per analysis.md. The Motion Tools panel shows influence sliders **11 / 89** (f1002–1046), a strongly asymmetric AE ease. The exact reading is uncertain | f1002–1046 |
| Text vs VO | **Title leads its VO by 2.3 s** (f98 vs "modern motion" at 8.84 s). FIRST LESSON leads by 0.8 s; FREE leads by 0.9 s. The end card trails "enroll now…" by ~6 s (it is a static tail) | caption timings |

**Letters-drop recipe at 30 fps**, derived from the table and used in proof 2 (d):
- **Stagger:** 3 f (0.1 s).
- **Fall:** 0.42 s on ease-in-quad `(0.11, 0, 0.5, 0)`.
- **Bounce:** 0.12–0.33 s up on ease-out-quad `(0.5, 1, 0.89, 1)`, then down on ease-in-quad. The micro-bounce is 0.06 + 0.06 s.
- **Righting rotation:** from the tumble to upright over fall + 0.2 s on back-out `(0.34, 1.56, 0.64, 1)`.
- **Landing squash:** 1.07 / 0.86 → 1 over 0.14 s, expo-out.

## 5. Design system

**Palette (per scene, from analysis.md):**

| Scene | Colours |
|---|---|
| Crystal | `#2e95e9` / `#4db7f1`, with accents `#f1db61` and `#ee88cd` |
| Fruit | `#9de555` / `#8adb40`, `#dfbe9b`, `#9036e1` |
| Title | `#6714c7` / `#3f06a3` / `#1d056f` / `#5b0cbd` / `#37069b`, with `#d2b544` and `#af55cb` |
| Stack / pile | `#f1e054` / `#f2d880` / `#ec86cf` / `#ecb8ac` |
| '4' / pink | `#ec95cf` / `#de77c7` / `#c85acd` / `#993fd9` |
| End | `#000000` / `#111111`, MDS green `#35c384` |
| Marker | `#d62bd6` |
| Frame border | Approximately purple `#9b4df0` / pink `#f3a3d8` / yellow `#f2d45c`, drifting around the frame |

**Rule:** one saturated background family per scene, with pastel, candy-coloured objects on it.

**Materials** ("stylised PBR", every one lit by a soft environment):
- glossy plastic with one soft specular highlight;
- gradient plastic, where the gradient comes from the env light;
- frosted glass with opaque white stripes;
- clear refractive glass with a pink tint;
- kintsugi ribbon "M" (lavender/pink with gold crack inlays);
- purple diamond-checker slab;
- barked wood log with ring end-grain;
- speckled lavender stone;
- matte clay;
- env-reflecting metallic crystal;
- a neon-tube "M" (a bevelled curve);
- a tape roll.

**Lighting:**
- a gradient **environment light as the key look**, plus soft contact shadows;
- a **window gobo on the back wall**;
- light streaks in haze on the floor and wall;
- very shallow DOF.

AE was set to ACES/Raw at 16 bpc (viewer footer, f1002+).

**Type:**
- supers in **Montserrat ExtraBold**, white, ~150 px cap height @1080;
- the end card in a small geometric sans (Rubik/Montserrat-like) at ~22 px cap height;
- brand marks (Ae tile, Blender logo) kept flat and 2D over the 3D;
- 3D letters are **individually modelled, chunky, rounded, each in a different material**.

**Frame:** a ~20 px @1080 animated gradient border on the hero shots.

**Post:** a painterly filter plus fine grain on every hero render.

## 6. Sound

- **Mix.** Voice-over-led and continuous: the VO runs from 0.48 s to 87.1 s. The music bed sits at a steady −20 to −22 dBFS
  RMS in every 10 s window. The analyser's tempo is 74.9 bpm (likely a 150 bpm feel).
- **End card.** It is **music only**: the mid band drops 34 dB after the VO ends.
- **Possible SFX.** High-band (4–12 kHz) peaks of **+20 to +24 dB** over the median sit on:
  - the Ae × blender pop (f113–121);
  - the pile explosion (f453–464);
  - wipe #3;
  - the grid's 2D → 3D swaps;
  - the letters landing;
  - the logo write-on.

  These are consistent with whoosh/pop accents, but hi-hats reach the same level, so SFX are **not confirmed**.
- **Sync is weaker than it looks.** 16/18 cuts and 31/34 moves start within 2 f of an onset. With 408 onsets in 90 s
  (4.5/s), chance alone gives about 70% for a ±2 f window, so the sync is only modestly above chance. The edit follows
  the **VO phrases** (text leads the words, see §4) more than the beat.
- **For a Bhippi rebuild:** a VO-led bed, pops on each letter landing (cue times come from the keyed landing times),
  a soft whoosh on card zooms and wipes, and a music-only end card.

## 7. The Bhippi ↔ Blender pipeline: corrections and additions to plan §4 P7 / §5

Everything below was measured on this machine: Blender 5.2.0 LTS, RTX 3080, OptiX. The GPU was 28–39% busy with other
processes, so the timings are conservative. The full numbers are in the Appendix and on
[proof2_sheet.jpg](../blender_proof/proof2_sheet.jpg).

**7.1 Gradient environment (the `Custom_HDRI` trick): proven, with three conditions.**

1. **The bands must vary with azimuth.**
   - A vertical (latitude-only) gradient turns every side facet the same colour (sheet row a, "env B").
   - The working env ([env_A_bands.png](../blender_proof/p2/env_A_bands.png), 2048×1024 sRGB PNG) has pink → yellow → cyan
     → magenta → orange → sky bands running **around the horizon**, tilted 0.35 with elevation.
   - It also has a bright zenith (`#e9fbff`), a **dark ground** (`#18202b`, which is what makes the downward facets
     dark slate as in the reference) and two soft white "softbox" hotspots.
   - Bhippi can render this image itself with its `linear-gradient` procedural at 2:1. That is the exact analogue of the
     `Custom_HDRI` comp.
   - It can be animated by keying the world Mapping node's Z rotation (supported in proof2.py) or with an image sequence.
2. **Material.**
   - The specified metallic 0.7 / roughness 0.2 reads **milky and pastel**. The 30% diffuse share of a white base picks up
     the averaged environment.
   - **Metallic 1.0 / roughness 0.15 / white base / world strength 1.4** reproduces the reference. It gives per-facet
     colour that changes as the crystal spins, gradient splits inside facets, dark downward facets, bright tip facets
     and coloured chamfer lines.
   - The chamfer lines come from a 1-segment bevel of 0.012 m. Use **flat shading**.
   - A tinted base (e.g. pink) tints every facet, so keep it white and art-direct with the env.
3. **Colour management: use `view_transform = 'Standard'`, not AgX.** AgX visibly desaturates brand colours.
   `scene3d.ts` defaults `toneMapping: 'aces'`; for stylised/brand looks the Blender path should map to **Standard**
   (`linear`).

**Timings at 960×540:**

| Engine | Steady | First frame |
|---|---|---|
| EEVEE 32 spp | 0.21–0.23 s/f | 1.0–1.24 s |
| Cycles 64 spp | 0.55–0.57 s/f | 0.70–0.74 s |

Both engines give the look. EEVEE is final-quality for this preset.

**7.2 EEVEE glass is fixable. §5's "Glass/thin-film: Dark" is wrong.**

- **The cause.** `Material.use_raytrace_refraction` defaults to **False** in 5.2, so EEVEE refracts only the world probe.
  Proof 1 set `scene.eevee.use_raytracing = True` but not the material flag.
- **The fix:** `material.use_raytrace_refraction = True`, `material.thickness_mode = 'SPHERE'` (use `'SLAB'` for thin
  sheets), `material.surface_render_method = 'DITHERED'`, `scene.eevee.use_raytracing = True`,
  `scene.eevee.ray_tracing_method = 'SCREEN'`.
  - The result is close to Cycles (sheet row b, b1).
  - A sphere light probe at the orb (b2) adds nothing visible.
  - `BLENDED` glass (b3) and `PROBE` tracing (b4) are noisy and dark. Reject both.
- **The limit.** Screen-space refraction only sees what is on screen, so glass over empty transparent film refracts the
  world colour. Set the world to roughly the colour of the Bhippi background (b6) when the glass sits over empty space.
- **The cost:**

  | Resolution | Draft-fix | Proof-1 settings |
  |---|---|---|
  | 540p | 0.43–0.57 s/f | 0.30 s/f |
  | 1080p | 0.73 s/f | 0.58 s/f (+26%) |

**7.3 An EEVEE contact shadow on transparent film works (§5 said "No").**
- **The floor material:** `Diffuse(white)` → `Shader to RGB` → `RGB to BW` → `Map Range` [0, lit = 0.5] → [0.6, 0]
  × a **radial fade** (`Texture Coordinate.Object` → `Vector Math LENGTH` → smoothstep Map Range 0.55r → r, r = 3.5 m)
  → Mix(`Transparent BSDF`, black `Emission`).
- **Settings:** `surface_render_method = 'BLENDED'` and `floor.visible_shadow = False`.
- **With `DITHERED` it fails.** Alpha comes out a constant 0.64 whatever `lit` is: EEVEE Next evaluates dithered
  transparency in the depth prepass, where there is no lighting, so Shader-to-RGB reads 0.
- **Without the radial fade,** the light fall-off toward the horizon reads as a grey shadow band.
- **The result** is a softer, lighter shadow than Cycles' shadow catcher. It is fine for drafts. Keep Cycles'
  `is_shadow_catcher` for finals.

**7.4 Render tiers, with real 1080p numbers (§4 P7 item 5 and §5 estimated 4–5 s/f for Cycles).**

Original `request.json` at 1920×1080. Frames 1/15/30/45; "steady" is the mean of 15/30/45.

| Config | Steady s/f | First frame | 300 frames (10 s @30) |
|---|---|---|---|
| Cycles 64 spp, OptiX + OptiX denoise | **3.46** | 3.67 | 17 min |
| Cycles 64 + `render.use_persistent_data` | **3.22** (−7%) | 3.35 | 16 min |
| Cycles 32 spp | **2.21** | 2.70 | 11 min |
| EEVEE 32 (proof-1 settings; glass dark) | **0.58** | 1.56 | 3 min |
| EEVEE 32 draft fix (glass + shadow floor) | **0.73** | 1.78 | 3.7 min |

- **Cycles 32 vs 64** at frame 30: PSNR **35.8 dB**, with differences only in the glass and shadow noise.
- **Persistent data** changes nothing visible (53.7 dB).
- **Recommended tiers:**
  - **Draft:** EEVEE at half resolution, about 0.2 s/f.
  - **Final for opaque, env-lit or screen-space-glass looks** (this whole film): EEVEE at full resolution, 32–64 spp.
  - **Final for heavy glass, caustics-like refraction or the shadow catcher over a Bhippi background:** Cycles 32 spp
    with persistent data.
- **The film itself ran at 15 fps.** A `fps: 15` "stylised 3D" option halves render cost and matches the look; conform
  to 30 by frame doubling.

**7.5 Overheads: make the worker persistent.**
- Each Blender process costs **2.0–2.3 s** (startup + quit), measured as wall time minus script time over 60+ runs.
- The first EEVEE frame adds **0.8–9 s** of shader compile. It varies with the driver's shader cache: new material
  variants such as BLENDED or probes hit 8–9 s.
- The Cycles first frame adds only 0.2–0.5 s.
- For interactive drafts, keep **one Blender process alive** and feed it requests over stdin. That saves ~3–11 s per
  request. Keep the one-shot `-b -P` form for finals.

**7.6 Physics: bake cheaply, never re-simulate, and prefer keys for titles (§4 P7 item 1 "drop-bounce = rigid body bake").**
- **Speed.** A rigid body bake is almost free: **0.02–0.03 s** for 5 convex-hull letters over 75 frames, with 10
  substeps and 10 iterations, via `bpy.ops.ptcache.bake_all(bake=True)` in background mode.
- **It doesn't make a title.** 4–5 of 5 letters **topple** onto their faces, so the word is unreadable (sheet row d).
  The reference letters end **upright in a line**, so its drop is keyed (or simulated, then keyed to a target).
  **`letters-drop` should be a keyed drop-bounce computed by Bhippi** (§4 recipe; `req_d_keyed.json`). That is exact
  and deterministic. Rigid body stays for "pile" and "explode" chaos (shots 5, 9, 17).
- **It is not repeatable across processes.** The same request run in separate Blender processes gave **3 divergent
  results in 14 runs**:
  - transforms were identical to frame 12, then split at first contact (f13);
  - positions differed by up to **0.60 m** at f75, with 14% of pixels changed (max 205/255);
  - the trigger is **kinematic (animated) release keys + multithreaded evaluation**;
  - with **`blender -b -t 1`** it was **17/17 identical**; without kinematic keys, **15/15 identical**.
- **The rule:** bake once in a dedicated `-t 1` pass, persist the per-frame transforms (`physics.json`, keyed by the
  scene hash) and render from keys. Never re-simulate per render chunk or per re-render.
- **`bpy.ops.rigidbody.bake_to_keyframes` fails headless.** Its internal `anim.keyframe_insert_by_name` poll needs a UI
  context. A manual freeze works: key location and rotation per frame from the recorded matrices and unlink the objects
  from the rigid body world. It takes 0.01 s, and renders match the live sim within the EEVEE noise floor (max 4/255
  on 0.39% of pixels).
- **EEVEE is not bit-exact across runs.** Identical scenes differ by up to 3/255 on about 0.3% of pixels, so compare
  renders with a tolerance.

**7.7 Passes: multilayer EXR (§4 P7 item 2).**
- **Blender 5.2 API:** set `image_settings.media_type = 'MULTI_LAYER_IMAGE'` (new in 5.x) **before**
  `file_format = 'OPEN_EXR_MULTILAYER'`.
- **Multipart output.** The file is written **multipart** (flags 0x1400, one part per pass, long names). Any Bhippi EXR
  reader must support multipart. Proof 2 ships a pure-Python reader ([exr_peek.py](../blender_proof/p2/exr_peek.py),
  NONE/ZIPS/ZIP) because the venv has no OpenEXR.
- **Passes by engine:**
  - **Cycles:** Combined, Depth (always float32, even at half), Mist, **Object Index**, Shadow Catcher, CryptoObject00–02
    (depth 6), plus automatic "Noisy Image" and "Noisy Shadow Catcher" parts from the denoiser.
  - **EEVEE:** Combined, Depth, Mist, Cryptomatte. **There is no Object Index** (the flag is silently ignored).
  - **Use Cryptomatte as the portable per-object matte.** Its manifest is in the header, e.g.
    `{"orb":"e24638c3",…}`.
- **Enabling Cycles' Shadow Catcher pass removes the shadow from Combined.** Floor alpha went from 71 to 0. Leave it off
  unless Bhippi multiplies the pass back in.
- **One render, several files.** Run `bpy.ops.render.render(write_still=False)`, then
  `bpy.data.images['Render Result'].save_render(path, scene=scene)` once per format. Each save costs 0.04–0.26 s, and the
  object pixels are identical to `write_still` (max diff 1/255).
- **Size per 960×540 frame:**

  | Output | Size |
  |---|---|
  | PNG | 0.39 MB |
  | Cycles EXR, half/ZIP | 4.46 MB |
  | Cycles EXR, float/ZIP | 12.3 MB |
  | Cycles EXR, half/DWAA | 2.74 MB |
  | EEVEE EXR, half/ZIP | 2.0 MB |

  At 1080p that is about ×4, so ~18 MB/frame, or **5 GB per 10 s**. Make passes **opt-in and per pass** (Depth +
  CryptoObject at depth 2 is enough for occlusion mattes), with DWAA and no noisy passes.

**7.8 Camera sync: add per-object projection to camera.json.**
- `objects2d.json` gives every object's per-frame projected position (`world_to_camera_view` → px, y down, depth in m).
- It is cheap and lets Bhippi pin 2D callouts, marker circles (technique 15) and SFX cues to 3D objects without
  rebuilding a 3D camera layer.
- **Axis mapping to Blender:**
  - `scene3d.ts` is +Y up with the camera looking down −Z, so the bridge maps (x, y, z)ₛ → (x, −z, y) in Blender.
  - Proof 1's Blender → motion-engine camera mapping still holds.

**7.9 Presets to add or change in §4 P7 item 6:**
- `crystal-gradient-env` (above).
- `letters-drop` (keyed, with an optional `physics: "pile"`).
- **`cyclorama`**, with a `window-gobo`. The gobo is proven: a spot (radius 0.03 m, cone wider than the window, 80°)
  plus a camera-invisible 2×2 window-frame occluder 1.2 m from the light (`visible_camera = False` still casts in
  EEVEE).
  - **Penumbra rule:** penumbra = r × (d_wall − d_occluder) / d_occluder must be smaller than the bar-shadow width. A
    0.12 m radius washed the panes out.
  - **Haze** (world Principled Volume, density 0.035) lifts the image but shows no shafts and a faint tile grid, so it
    is **not ready**.
- Material set `stylised-mix`: plastic, gradient plastic, frosted-stripe glass, kintsugi, checker, wood, stone, clay.
- The **painterly** look belongs in Bhippi (P5), not Blender. The film applies it to the whole frame, 2D included.

**7.10 Caching.**
- Hash the request minus `out`, plus the frame list, and store the renders under `<project>/3D/<hash>/`.
- The physics bake has its own hash and file.
- Keying the environment rotation changes every frame, so the hash must include animation.
- Proof 1's rule stands: never use `work/`.

## 8. Recreate recipe: the letters-drop title (6 s)

Target: shot 18, 1:19–1:23. Tools marked **NEW** don't exist yet.

**Tool calls**
1. `create_3d_scene` (**NEW**). The preset `letters-drop` expands into the scene below:
   ```json
   {"preset": "letters-drop", "text": "Modern Motion", "secondLine": "Vol.1", "materials": "stylised-mix",
    "world": {"kind": "cyclorama", "color": "#5b0cbd", "gobo": "window-2x2"},
    "animation": {"mode": "keyed", "stagger": 0.1, "fall": 0.42, "bounce": [0.33, 0.2], "micro": 0.06, "tumble": 35},
    "camera": {"lens": 50, "fstop": 2.8, "drift": {"scale": 0.982, "rise": 31, "ease": [0.18, 1, 0, 1]}}}
   ```
2. `render_3d_scene {quality: "draft"}` (**NEW**): EEVEE at half resolution, about 0.2 s/f, 36 s for 180 frames. The AI
   places the sequence at once.
3. `render_3d_scene {quality: "final", engine: "eevee", samples: 64}` (**NEW**): about 0.6–0.8 s/f at 1080p, about
   2.5 min. Use Cycles 32 only if the glass "M" and "V" need true refraction over empty space.
4. `create_motion_scene` with the MotionScene below: the 3D sequence, the flat lockup, the gradient border, the
   painterly filter and grain.
5. `add_sound_effect`, a `pop` on each letter's landing time (taken from the keyed landing times), and `run_frame_qa`
   at t = 1.0, 2.5 and 5.5 s.

**3D scene JSON sketch** (scene3d.ts shape; `// NEW` marks additions to the model). The worker lowers it to a proof-2
request such as [req_d_keyed_gobo2.json](../blender_proof/p2/req_d_keyed_gobo2.json).
```jsonc
{
  "version": 1, "name": "Modern Motion title", "duration": 6,
  "environment": { "preset": "none", "background": "transparent", "intensity": 0.5,
    "world": { "kind": "cyclorama", "color": "#5b0cbd", "wallY": 3.0, "fillet": 1.2 },            // NEW
    "gobo": { "kind": "window", "cols": 2, "rows": 2, "bar": 0.09, "at": [-1.8, 3.0, 1.4] } },    // NEW
  "render": { "engine": "eevee", "samples": 64, "toneMapping": "linear", "motionBlur": false,
    "fps": 30,                                                                                    // NEW (15 for the film's cadence)
    "eevee": { "raytracing": true, "glass": "raytrace-refraction" } },                            // NEW
  "materials": [
    { "id": "kintsugi", "preset": "kintsugi" },                                                   // NEW preset
    { "id": "tape", "preset": "soft-plastic", "color": "#6fbf3a" },
    { "id": "candy-yellow", "preset": "soft-plastic", "color": "#ffcf3a" },
    { "id": "glass-lilac", "preset": "glass", "color": "#d9c8ff", "transmission": 1, "roughness": 0.04 }
  ],
  "objects": [
    { "id": "M", "kind": "text-extrude", "params": { "text": "M", "font": "Montserrat-ExtraBold", "size": 0.9, "depth": 0.15, "bevel": 0.02 },   // NEW kind
      "materialId": "kintsugi", "position": [-2.2, 0, 0], "rotation": [0, 0, 0],
      "animation": { "drop": { "t0": 0.0, "fall": 0.42, "from": 2.2, "tumble": [30, -15, 20] } } },                                            // NEW: expands to keys
    { "id": "o1", "kind": "torus", "params": { "radius": 0.28, "tube": 0.14 }, "materialId": "tape",
      "animation": { "drop": { "t0": 0.1, "fall": 0.42, "from": 2.2, "tumble": [80, 0, 0] } } },
    "… t, i (stick + ball dot), o (candy torus), n, V (glass), o, l, 1, and the small 'Modern' row at stagger 0.07 …"
  ],
  "camera": { "mode": "free", "position": [0, -6.6, 1.25], "lookAt": [0, 0, 0.45], "focalLength": 50,
              "fStop": 2.8, "depthOfField": true, "focusDistance": 6.6,
              "animation": { "position.y": [{ "time": 0, "value": -6.6 }, { "time": 6, "value": -6.3, "easing": "ease-out" }] } },
  "lights": [
    { "id": "key", "kind": "area", "position": [-2.5, -4, 3.5], "target": [0, 0, 0.4], "intensity": 500, "width": 3, "height": 3 },
    { "id": "fill", "kind": "area", "position": [3, -3, 1.5], "target": [0, 0, 0.4], "intensity": 220, "color": "#c9b8ff" },
    { "id": "rim", "kind": "area", "position": [0, 2.2, 3.5], "target": [0, 0, 0.3], "intensity": 350, "color": "#ff9ee8" },
    { "id": "window", "kind": "spot", "position": [-4.5, 0.5, 4.2], "target": [-1.8, 3.0, 1.4], "intensity": 3200, "angle": 80, "radius": 0.03 }
  ],
  "outputs": { "png": true, "passes": ["depth", "cryptomatte"], "objects2d": true }                                                           // NEW
}
```
The positions above are in Blender's Z-up frame, as in the proof. `drop` expands to the §4 keys: fall on ease-in-quad,
bounce 0.33 s up and 0.2 s down, micro-bounce 0.06 + 0.06 s, back-out righting over fall + 0.2 s, and the landing
squash.

**MotionScene JSON sketch** (1920×1080, 6 s)
```jsonc
{
  "version": 1, "width": 1920, "height": 1080, "duration": 6, "background": "#2a0870",
  "layers": [
    { "id": "title3d", "type": "footage", "fit": "cover",
      "source": { "sequence": { "dir": "<project>/3D/<hash>/", "fps": 30, "frames": 180, "digits": 5 } } },   // NEW source.sequence
    { "id": "ae-tile", "type": "shape", "in": 1.05,
      "shape": { "shape": "rect", "size": [120, 118], "radius": 18, "fill": "#00005b" },
      "transform": { "position": [840, 250],
        "scale": { "k": [{ "t": 1.05, "v": 0, "ease": [0.34, 1.56, 0.64, 1] }, { "t": 1.18, "v": 100 }] } } },
    { "id": "ae-x-blender", "type": "text", "transform": { "position": [1040, 250] },
      "text": { "text": "×  blender", "font": "Montserrat", "weight": 800, "size": 84, "color": "#ffffff",
        "cascade": { "by": "char", "delay": 1.12, "stagger": 0.067, "duration": 0.2, "ease": [0.34, 1.56, 0.64, 1],
                     "from": { "position": [0, -46], "rotation": -28, "scale": 0.4, "opacity": 0 } } } },
    { "id": "post", "type": "solid", "color": "#000000", "adjustment": true,
      "effects": [
        { "type": "painterly", "radius": 5, "paper": 0.25 },                                                    // NEW (P5)
        { "type": "grain", "amount": 0.25, "size": 1.2 },
        { "type": "gradient-border", "width": 20, "stops": ["#9b4df0", "#f3a3d8", "#f2d45c"],
          "angle": { "k": [{ "t": 0, "v": 0 }, { "t": 6, "v": 120 }] } } ] }                                    // NEW
  ],
  "cues": [ { "at": 0.42, "sound": "pop", "note": "M lands" }, { "at": 0.52, "sound": "pop" }, { "at": 1.05, "sound": "pop", "note": "Ae tile" } ]
}
```
(The Blender logo mark would be an SVG layer once P1 lands; until then, use an image footage layer.)

## 9. Top 10 improvements

| # | Size | Improvement | Why (evidence) |
|---|---|---|---|
| 1 | S | **`gradient-env` world + `crystal-gradient-env` preset**: Bhippi renders a 2:1 azimuth-band PNG (optionally animated); metallic 1 / roughness 0.15 / flat + 1-segment bevel / world ×1.4 | Proof 2 (a) reproduces the film's signature look in both engines at 0.2–0.56 s/f @540p |
| 2 | S | **Blender-path defaults**: `Standard` view for stylised looks; EEVEE glass flags whenever transmission > 0; shadow mode auto = Cycles catcher / EEVEE BLENDED shadow-only floor with a radial fade | Proof 2 (a) AgX desaturates; (b) dark glass is one flag; the EEVEE shadow floor works |
| 3 | M | **`letters-drop` as keyed drop-bounce** computed in TS, with the measured stagger, bounce, righting and squash, plus pops on the landing times | The reference ends upright and readable; rigid body topples (d) |
| 4 | S | **Physics bake-once rule**: a `-t 1` bake pass, persisted transforms keyed by scene hash, manual freeze to keys; never re-simulate | 3 of 14 multithreaded runs diverged by up to 0.6 m; `-t 1` 17/17 identical; the bake-to-keyframes op fails headless |
| 5 | M | **Persistent Blender worker + tiers**: EEVEE ½-res draft (~0.2 s/f); EEVEE full-res final for AE-Advanced-3D-class looks (0.6–0.8 s/f @1080p); Cycles 32 + persistent data (2.2–3.2 s/f) for glass/catcher finals; optional 15 fps cadence | Startup 2.0–2.3 s + EEVEE compile 0.8–9 s per process; 1080p timings in §7.4 |
| 6 | S | **`gradient-border` effect** (animated angular gradient frame) | On every hero shot of this film; impossible today because stroke gradients are unsupported |
| 7 | M | **`painterly` effect** (Kuwahara/oil + paper texture) as a frame-wide adjustment | Applied to every hero render, 2D included |
| 8 | M | **Transitions kit**: card-zoom reveal (8 f, cubic-bezier(0.15, 0.46, 0.43, 1)), hard diagonal wipe (4 f), scale-through morph (5 + 5 f), sliding-panel super reveal (5 f) | Measured in §4; each recurs 2–3 times in the film |
| 9 | S | **`objects2d.json` + camera import**, so 2D annotations, marker circles and SFX cues track 3D objects | Proof 2 writes it at no cost; the film annotates 3D objects (f926–956) |
| 10 | M | **`grid-of-loops` template** (3×2 live tiles, scattered pops at 2 f, 2D → 3D swap at 5 f, reversed exit) + **`cyclorama` world with window gobo** | f752–892; the gobo is proven with the penumbra rule (§7.9) |

Also worth doing: make EXR passes opt-in and per pass (Depth + Cryptomatte, DWAA, no noisy passes), with a multipart-capable
reader. At 1080p a full pass set is about 18 MB/frame.

---

## Appendix: proof-2 results and commands

**Commands** (from `D:\Bhippi Video editor\docs\research\video-study\blender_proof\p2`):
```
D:\Bhippi Video editor\.media-venv\Scripts\python.exe gen_requests.py          # env PNGs + every req_*.json
bash run.sh <name> [...]                                           # = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
                                                                   #   -b --factory-startup -P ..\proof2.py -- req_<name>.json
BLARGS="-t 1" bash run.sh d_rigid_t1a                              # single-threaded variant
D:\Bhippi Video editor\.media-venv\Scripts\python.exe make_sheet2.py           # ../proof2_sheet.jpg + results.json
D:\Bhippi Video editor\.media-venv\Scripts\python.exe exr_peek.py out\e_cycles\00030_half_zip.exr
```

- **Logs:** `p2/logs/<name>.txt`.
- **Wall times:** `p2/logs/walls.jsonl`.
- **Per-run data:** `p2/out/<name>/result.json`, which has per-frame times, build, bake and saves.
- **Consolidated results:** `p2/results.json`.
- **Scripts:** [proof2.py](../blender_proof/proof2.py) (the worker, extended from `blender_bridge_proof.py`, which is
  unchanged), `gen_requests.py`, `run.sh`, `exr_peek.py`, `make_sheet2.py`, `peek.py`.

**Results.** s/f is per frame. "1st" includes shader or kernel compile. Wall is the whole Blender process.

| Test | Engine / settings | Size | s/f steady | 1st | Wall | Outcome |
|---|---|---|---|---|---|---|
| a_cycles | Cycles 64, gem m0.7 r0.2, env A ×1.0, Standard | 960×540 | 0.552 | 0.736 | 4.8 s | Per-facet colour, but milky and pastel |
| a_cycles_m1r15_s14 | Cycles 64, **m1.0 r0.15, env ×1.4** | 960×540 | 0.562 | 0.701 | 4.7 s | **Matches the reference look** |
| a_eevee(_m1r15_s14) | EEVEE 32, raytracing on | 960×540 | 0.216 / 0.233 | 1.24 / 1.01 | 4.4 / 3.5 s | Same look as Cycles |
| a_eevee_envB | Vertical-only gradient | 960×540 | 0.210 | 1.03 | 3.6 s | **Fails**: side facets all one colour |
| a_eevee_agx | AgX view | 960×540 | 0.214 | 1.09 | 3.6 s | Desaturated |
| b0_baseline | EEVEE 32, proof-1 settings | 960×540 | 0.304 | 1.40 | 4.6 s | Glass dark |
| b1_rt_refraction | + `use_raytrace_refraction`, SPHERE, DITHERED | 960×540 | 0.574 | 2.58 | 7.3 s | **Glass correct** |
| b2_rt_probe | b1 + sphere probe | 960×540 | 0.429 | 9.02 | 11.7 s | No visible gain |
| b3_blended / b4_probe | BLENDED glass / PROBE tracing | 960×540 | 0.304 / 0.394 | 8.5 / 1.8 | – | Noisy, dark: rejected |
| b5_draft_full | b2 + shadow-only floor (BLENDED, lit 0.5, strength 0.6, r 3.5) | 960×540 | 0.451 | 5.44 | 8.2 s | **Glass + contact shadow on alpha** |
| b7_floor_dithered_* | Shadow-only floor, DITHERED | 960×540 | – | 1.2–1.4 | – | Fails: alpha 0.64 everywhere |
| c_cycles32 | Cycles 32 OptiX + denoise | 1920×1080 | **2.213** | 2.696 | 11.7 s | PSNR 35.8 dB vs 64 spp |
| c_cycles64 | Cycles 64 | 1920×1080 | **3.455** | 3.665 | 16.5 s | Reference |
| c_cycles64_persist | + `use_persistent_data` | 1920×1080 | **3.218** | 3.350 | 15.3 s | −7%, 53.7 dB |
| c_eevee32 | EEVEE 32, proof-1 settings | 1920×1080 | **0.584** | 1.563 | 5.8 s | Glass dark |
| c_eevee32_draftfix | EEVEE 32 + glass fix + shadow floor + probe | 1920×1080 | **0.733** | 1.784 | 6.5 s | Draft-quality glass + shadow |
| d_rigid_run1/2… | EEVEE 32; 5 letters CONVEX_HULL, 10 substeps/10 iterations, kinematic release every 3 f | 960×540 | 0.25–0.29 | 0.83–1.30 | 3.5–4.6 s | **Bake 0.02–0.03 s / 75 f**; letters topple; **3 of 14 runs diverge** (from f13, ≤ 0.60 m) |
| d_rigid_t1* | Same, `blender -b -t 1` | 960×540 | ~0.25 | ~0.84 | 3.5 s | 17/17 identical (sha d88cfc…) |
| d_rigid_nokin_* | No kinematic keys, staggered heights | 960×540 | ~0.26 | ~1.05 | 3.9 s | 15/15 identical (sha 9d6a9b…) |
| d_rigid_bake2keys | Manual freeze to keys (the op fails headless) | 960×540 | 0.247 | 0.866 | 3.3 s | Freeze 0.01 s; matches the live sim (max 4/255 on 0.39% of pixels) |
| d_keyed | Keyed drop-bounce, 0.1 s stagger | 960×540 | 0.264 | 1.05 | 3.7 s | **Readable, exact title** |
| d_keyed_gobo2(_haze) | + window gobo (spot r 0.03, cone 80°, occluder 1.2 m) / + world volume | 960×540 | 0.236 / 0.270 | 1.05 / 1.12 | 3.4 / 3.6 s | Gobo reads like the reference; haze not ready |
| e_cycles | Cycles 64 + Z, Mist, IndexOB, Crypto ×3, Shadow Catcher pass; 1 render → 4 files | 960×540 | 1.164 (single frame) | – | 3.9 s | Multipart EXR: 10 parts; PNG 0.39 MB, half/ZIP 4.46 MB, float/ZIP 12.3 MB, half/DWAA 2.74 MB |
| e_eevee | EEVEE 32 + same passes | 960×540 | 1.511 (single frame) | – | 4.0 s | 6 parts, **no Object Index**; half/ZIP 2.0 MB |

`p2/` takes 88 MB, mostly the 1080p PNGs and the EXRs in `p2/out/`. That folder can be deleted before any commit:
`results.json`, `logs/` and the sheet keep the evidence, and `run.sh` regenerates it in a few minutes.

The multithreaded run count (14) includes run1 (sha 8ffb22…), a rerun of the run1 request (30d4089…) and a hunt run
(033ce2…). Each divergent run gave a *different* hash. The kept divergent frames are in `p2/out/d_rigid_divergent/`.
