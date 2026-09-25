# 02 · Research: fact-checking and de-risking the reference-films plan

*2026-09-25. This checks the technology and licence choices in [REFERENCE-FILMS-PLAN.md](../../../REFERENCE-FILMS-PLAN.md)
(§4 pillars, §5 Blender proof, §7 licences) against primary sources and against tests run on this
machine. It also surveys the state of the art. It changes nothing in the plan or in the source code. Corrections are listed at the end.*

**How it was checked.**
- Every web claim links to its source.
- Claims marked **[measured]** come from tests run here on 2026-09-25:
  - A Canvas2D variable-font test page in Chromium 153. The installed WebView2 runtime is 153.0.4234.48 (read from the registry), so it is the same engine Tauri uses.
  - API probes against the installed Blender 5.2.0 LTS (`blender -b --factory-startup -P probe.py`).
  - A timed run of Rhubarb 1.14.0 on a 28.2 s SAPI voice-over.
  - Byte-level scans and sizes of npm tarballs (min/gzip sizes measured with esbuild + gzip).
- This is engineering due diligence, not legal advice. The two licence items marked **ask counsel** below deserve a lawyer's look before shipping.

---

## 1. Licences the plan relies on

### 1.1 Blender (GPL)

| Question | Finding |
|---|---|
| Can a proprietary app launch the unmodified official `blender.exe` as a separate process? | **Yes.** The GPL FAQ treats programs that talk through exec, pipes or command-line arguments as separate programs forming an *aggregate*. The exception is when "the semantics of the communication are intimate enough, exchanging complex internal data structures" ([GPL FAQ, MereAggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)). Blender's FAQ: full freedom exists if your product "operates outside of Blender" and "uses no Blender source code or API calls (including Python API)" ([Blender FAQ](https://www.blender.org/support/faq/)). A JSON request file plus a PNG sequence back is arm's-length. |
| **But: the bridge script** | `blender_bridge.py` calls `bpy`. Blender: scripts using the Python API "have to be made available licensed as GNU GPL" when shared or published ([Blender FAQ](https://www.blender.org/support/faq/); [License](https://www.blender.org/about/license/)). The GPL FAQ reasons the same way: an interpreted program that uses an interpreter's *bindings* to GPL facilities "must be released in a GPL-compatible way" ([GPL FAQ, IfInterpreterIsGPL](https://www.gnu.org/licenses/gpl-faq.html#IfInterpreterIsGPL)). **Bhippi ships this script, so it must carry a GPL-compatible licence** (e.g. `SPDX-License-Identifier: GPL-3.0-or-later`). It must never import proprietary Bhippi modules. The plan misses this. |
| In-app download of the official portable zip | **Fine.** If Bhippi fetches it straight from `download.blender.org`, Bhippi is not distributing Blender at all. If Bhippi ever mirrors it, then for official releases "it's sufficient to provide information that forwards to the sources at blender.org" ([Blender FAQ](https://www.blender.org/support/faq/)). The current file is `blender-5.2.2-windows-x64.zip`, **404 MB**, published 2026-09-15, with a published `.sha256` ([release dir](https://download.blender.org/release/Blender5.2/), [sha256](https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256)). Verify the hash after download. |
| Trademark | You may say "Requires Blender" or "Rendered with Blender". **Do not put the Blender logo in Bhippi UI without permission**: "Only in exceptional cases permission will be granted to use the logo on commercial products" ([Blender logo policy](https://www.blender.org/about/logo/)). |

### 1.2 Lucide (ISC, and not only ISC)
- The LICENSE file holds **two** licences. The main one is ISC ("Copyright (c) 2026 Lucide Icons and Contributors"). Icons derived from Feather are **MIT** ("Copyright (c) 2013-present Cole Bemis") ([LICENSE](https://github.com/lucide-icons/lucide/blob/main/LICENSE)). Ship both notices.
- **[measured]** `lucide-static@1.48.0` (2026-09-24) has **2,118 icons**, not "about 1,500".
  - `icon-nodes.json` is 776 KB (96 KB gz). `tags.json` (269 KB) is useful for `search_icons` ([npm](https://www.npmjs.com/package/lucide-static)).
  - The icons are **stroked** paths (stroke-width 2, round caps and joins) and use SVG **arc** commands. The SVG parser must handle arcs, and extruding an icon (P7) needs stroke-to-path first (see §5).

### 1.3 Rhubarb Lip Sync (MIT; ships third-party notices)
- **Licence.** Rhubarb itself is MIT. It bundles components under other permissive licences: Boost (BSL), CMU PocketSphinx and sphinxbase (BSD-2 variants), the CMU acoustic model (BSD-2 variant), Flite (BSD-like), libogg and libvorbis (BSD-3), WebRTC (BSD-3), utf8proc (MIT + Unicode), and "Where Am I?" (WTFPL) ([LICENSE.md](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/LICENSE.md)). All are compatible with a proprietary app, **but each notice must ship**.
- **Windows binary.** v1.14.0 (2025-04-03) ships `Rhubarb-Lip-Sync-1.14.0-Windows.zip` at 87 MB ([release](https://github.com/DanielSWolf/rhubarb-lip-sync/releases/tag/v1.14.0)). v1.11 moved the Windows build to 64-bit.
- **[measured] Minimal redistributable.** `rhubarb.exe` (2.7 MB) + `res/sphinx` (86.5 MB, mostly the 53 MB acoustic model and the 26 MB language model) = about 89 MB on disk, **70 MB zipped**. The `tests/` (55 MB) and `extras/` folders are not needed.
- **[measured] Speed.** On a 28.2 s SAPI voice-over on this machine (32 threads):

  | Recogniser | Time | Real-time factor | Mouth cues |
  |---|---|---|---|
  | `-r pocketSphinx` | 6.1 s | 4.6× | 158 |
  | `-r phonetic` | 2.5 s | 11× | 160 |
  | pocketSphinx with the transcript (`-d`) | 6.5 s | — | — |

  PocketSphinx is English-only. The phonetic recogniser is language-independent but "usually less precise" ([README](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/README.adoc)). The output shapes are A–F plus G, H and X, as TSV, XML, JSON or DAT.

### 1.4 JS/WASM libraries named in the plan

| Library | Licence | Version / last release | Size **[measured]** | Status |
|---|---|---|---|---|
| polygon-clipping | MIT | 0.15.7, 2023-12-18 | 29 KB min / 9.3 KB gz | Quiet since 2023; polygons only ([repo](https://github.com/mfogel/polygon-clipping)) |
| flubber | MIT | 0.4.2, **2018-03-01** | 53.5 KB / 18.3 KB gz | Unmaintained but stable ([repo](https://github.com/veltman/flubber)) |
| vtracer | MIT (crate: MIT OR Apache-2.0) | crate 0.6.5 (2026-08-29); PyPI 0.6.15 | — | Active ([repo](https://github.com/visioncortex/vtracer), [crate](https://crates.io/crates/vtracer), [PyPI](https://pypi.org/project/vtracer/)). The **Rust crate fits Tauri directly** |
| lottie-web | MIT | 5.13.0, 2025-05-21; repo last push 2025-09 | light_canvas: 203 KB / 54.6 KB gz | Maintenance slowing ([repo](https://github.com/airbnb/lottie-web)) |
| ThorVG (`@thorvg/lottie-player`, `@thorvg/webcanvas`) | MIT | 1.1.2, 2026-09-18 | WASM 250–900 KB (lite gl: 274 KB / 119 KB gz; full sw: 619 KB / 275 KB gz) | Very active ([repo](https://github.com/thorvg/thorvg)) |

### 1.5 Illustration and 3D asset libraries

| Source | Licence | Gotcha |
|---|---|---|
| Open Peeps | CC0 ("Free for commercial and personal use under CC0 License") ([site](https://www.openpeeps.com/)) | — |
| Humaaans | CC0 ([site](https://www.humaaans.com/)) | **Take it from humaaans.com, not Blush.** Blush-hosted versions of the same collections are under the Blush licence: "You can't re-sell, or re-distribute Blush Illustrations… can't compile Illustrations… to replicate a similar or competing service" ([Blush licence](https://blush.design/license)) |
| Open Doodles | CC0 ("No need to credit, license, or anything") ([site](https://www.opendoodles.com/)) | Same Blush caveat |
| Poly Haven | CC0 ([licence](https://polyhaven.com/license)) | **The API has its own terms.** When you surface content through the live API you must "make it clear to your users where that content comes from" (e.g. "Powered by Poly Haven"), and "All API calls must be made with a unique 'Referer' header or user-agent that matches your software name" ([API ToS](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)). Scraping the website is prohibited |
| ambientCG | CC0 1.0; bundling raw files is explicitly allowed ([licence](https://docs.ambientcg.com/license/)) | — |
| Kenney | CC0 ([support](https://kenney.nl/support)) | Don't resell the assets as a standalone pack. Bundling inside a product is fine |

### 1.6 Fonts (all OFL and all variable, but no `wdth` axis)
From the `google/fonts` `METADATA.pb` files, and **[measured]** latin-subset variable WOFF2 sizes from Fontsource:

| Family | Licence | Axes (range) | Latin WOFF2 |
|---|---|---|---|
| [Inter](https://github.com/google/fonts/blob/main/ofl/inter/METADATA.pb) | OFL | opsz 14–32, wght 100–900 (+ italic file) | 48 KB (wght) |
| [Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/METADATA.pb) | OFL | wght 200–800 | 25 KB |
| [Plus Jakarta Sans](https://github.com/google/fonts/blob/main/ofl/plusjakartasans/METADATA.pb) | OFL | wght 200–800 (+ italic) | 27 KB |
| [Sora](https://github.com/google/fonts/blob/main/ofl/sora/METADATA.pb) | OFL | wght 100–800 | 34 KB |
| [Outfit](https://github.com/google/fonts/blob/main/ofl/outfit/METADATA.pb) | OFL | wght 100–900 | 32 KB |
| [Montserrat](https://github.com/google/fonts/blob/main/ofl/montserrat/METADATA.pb) | OFL | wght 100–900 (+ italic) | 38 KB |
| [Fraunces](https://github.com/google/fonts/blob/main/ofl/fraunces/METADATA.pb) | OFL | SOFT 0–100, WONK 0–1, opsz 9–144, wght 100–900 | 121 KB (all axes) |
| [Caveat](https://github.com/google/fonts/blob/main/ofl/caveat/METADATA.pb) | OFL | wght **400–700** only | 75 KB |

- None of the Google Fonts `OFL.txt` files declares a Reserved Font Name. Subsetting and WOFF2 conversion therefore need no renaming ([OFL](https://openfontlicense.org/)).
- **None of the eight has a `wdth` (or `slnt`) axis**, yet the plan's `axes: {wght, wdth, slnt}` depends on them.
- OFL families that do have `wdth` ([Google Fonts metadata](https://github.com/google/fonts/tree/main/ofl)):
  - **Mona Sans** and **Hubot Sans** (wdth 75–125, wght 200–900);
  - **Archivo** (wdth 62–125);
  - **Bricolage Grotesque** (opsz, wdth 75–100, wght);
  - **Anybody** (wdth 50–150);
  - **Instrument Sans**, **Open Sans**;
  - **Roboto Flex** (13 axes incl. wdth, slnt, GRAD; 326 KB latin).
- **libass does not handle variable fonts.**
  - The issue "libass doesn't know how to handle OpenType Variable Fonts" is open. libass ignores variations and uses only the default instance; the workaround is splitting into static fonts ([libass #386](https://github.com/libass/libass/issues/386), [#584](https://github.com/libass/libass/issues/584)).
  - The libass Changelog through 0.17.5 has no variable-font entry ([Changelog](https://github.com/libass/libass/blob/master/Changelog)).
  - FreeType reads WOFF2 only when built with Brotli (2.10.2+) ([Phoronix](https://www.phoronix.com/news/FreeType-2.10.2-Released)).
  - **So caption fonts for FFmpeg/libass must be static TTF instances**, e.g. generated at build time with fontTools `varLib.instancer` ([docs](https://fonttools.readthedocs.io/en/latest/varLib/instancer.html)), not the variable WOFF2 files.

### 1.7 LottieFiles
- **The Lottie Simple License.** Free animations may be used commercially, modified and published in "products and services", with no attribution required. Its restrictions:
  - it prohibits "compile or scrape animations to create a competing service";
  - it prohibits "redistribute as standalone animation files";
  - it prohibits "resell the original animation files";
  - it tells users to "always check the specific license on each animation page" ([LottieFiles help](https://help.lottiefiles.com/animation-licensing-basics-); [licence page](https://lottiefiles.com/page/license)).
- **There is no public API.** LottieFiles staff, 2026-08-28: "At the moment, we don't offer a public API for searching or accessing free LottieFiles animations, and we're unable to share any plans or timeline" ([forum](https://forum.lottiefiles.com/t/free-animations-via-api/8367)). An unauthenticated `graphql.lottiefiles.com` endpoint exists and third-party tools call it ([example](https://github.com/b1rdmania/claude-lottie-skill/blob/main/SKILL.md)), but it is unsanctioned.
- **Verdict:**
  - An in-app LottieFiles search box is **not OK**: it is unsanctioned API use and close to "compile or scrape".
  - Bundling LottieFiles animations is **not OK**: that is redistribution as standalone files.
  - Importing a user-downloaded `.json`/`.lottie` and rendering it into the user's video **is OK**: the user is the licensee.
  - The plan's "user-supplied files only until checked" becomes "user-supplied files only".
- **Bundle-safe Lottie sources:**
  - Noto Animated Emoji is **CC BY 4.0**: bundle it with attribution ([site](https://googlefonts.github.io/noto-emoji-animation/), [google/fonts #7011](https://github.com/google/fonts/issues/7011)).
  - useAnimations is **CC BY, not MIT** as some listings claim ([LICENSE](https://raw.githubusercontent.com/useAnimations/react-useanimations/master/LICENSE)).
  - Lordicon's free tier forbids redistribution and requires credit ([Lordicon](https://lordicon.com/docs/license/free)).

**RECOMMENDATION (1).**
- **Blender.** Keep "separate process, official unmodified build, download from blender.org, verify SHA-256". Add three things:
  - license `blender_bridge.py` GPL-3.0-or-later and keep it free of Bhippi imports;
  - no Blender logo in the UI;
  - keep the request protocol a documented JSON schema.
- **Rhubarb.** Make it an **optional 70 MB download**, not a bundled binary. Show its NOTICE list in About › Licences.
- **Fonts.** Ship the eight OFL families. **Add one `wdth` family** (Mona Sans, or Archivo for more range) so "breathe" can use width. Generate **static TTF instances for libass**.
- **Lucide.** Show the ISC and MIT notices.
- **Poly Haven.** Show "Powered by Poly Haven" wherever API results appear, and send a `User-Agent: Bhippi/<ver>`.
- **Illustration packs.** Source from the original CC0 downloads only, never from Blush.
- **Lottie.** No LottieFiles search or bundling. Offer Noto Animated Emoji (CC BY) as the bundled Lottie set.

---

## 2. Lottie: renderers, CSP and what a native converter must handle

### 2.1 lottie-web and eval
- **[measured]** A scan of `lottie-web@5.13.0/build/player`:

  | Build | `eval(` calls | Size |
  |---|---|---|
  | full builds (`lottie`, `_canvas`, `_svg`, `_html`, `_worker`) | exactly **one** each: the expression compiler, `eval('[function _expression_function(){' + val + …` in `initiateExpression` | — |
  | **`lottie_light_canvas.min.js`** | **zero** (also no `new Function`) | 203 KB / 54.6 KB gz |
  | `lottie_light.min.js` | zero | — |
  | `lottie_light_html.min.js` | zero | — |

  ESM and CJS copies of the light builds ship under `build/player/esm` and `build/player/cjs`.
- **So "expressions only" is correct**, and a no-eval build exists: import `lottie-web/build/player/esm/lottie_light_canvas.min.js`.
- **Effects are almost absent on canvas.** **[measured]** The full canvas build registers only the Transform effect (`registerEffect(35, CVTransformEffect)`); the light canvas build registers none. The SVG build registers Tint, Fill, Stroke, Tritone, Levels, Drop Shadow, Matte3, Gaussian Blur and Transform. Airbnb's matrix agrees: Gaussian blur and drop shadow on Web Canvas are "❔", and **Merge Paths are ⛔ on every web renderer** ([supported features](https://github.com/airbnb/lottie/blob/master/supported-features.md)).
- **Deterministic frames.**
  - `goToAndStop(value, isFrame=true)` renders synchronously.
  - `rendererSettings: { context, clearCanvas }` draws into your own 2D context.
  - Wait for the `DOMLoaded` / `data_ready` / `loaded_images` events before the first seek.
  - `setSubframe(false)` snaps to whole frames ([README](https://github.com/airbnb/lottie-web#readme)).
  - Text layers also need their fonts loaded (`document.fonts`) first.

### 2.2 ThorVG (WASM)
- **Features.** Per the [ThorVG Lottie support wiki](https://github.com/thorvg/thorvg/wiki/Lottie-Support):
  - shapes, gradients, all mask modes incl. expansion;
  - alpha and luma mattes;
  - text with range selectors and text-on-path;
  - time remap, slots;
  - trim, repeater, offset path, pucker-bloat, round corners, zigzag.
- **Effects.** v1.0 added GaussianBlur, DropShadow, Stroke, Fill, Tint and Tritone layer effects ([v1.0 post](https://www.thorvg.org/post/thorvg-v1-0-a-new-generation-released)).
- **Expressions without JS eval.** They run in **JerryScript compiled into the WASM** ([source tree](https://github.com/thorvg/thorvg/tree/main/src/loaders/lottie/jerryscript)), with about 75% expression coverage (wiki). **[measured]** The `@thorvg/lottie-player` and `@thorvg/webcanvas` JS glue contains no `eval(` and no `new Function`. Only `'wasm-unsafe-eval'` is needed, and Bhippi's CSP already has it ([01-architecture-map §I3](01-architecture-map.md)).
- **Gaps.** **[measured, source]** `tvgLottieParser.cpp` logs "MergePath(mm) is not supported yet" and "Twist(tw) is not supported yet" ([parser](https://github.com/thorvg/thorvg/blob/main/src/loaders/lottie/tvgLottieParser.cpp)). 3D layers and cameras are not supported.
- **Presets** ([README](https://www.npmjs.com/package/@thorvg/lottie-player)):
  - `sw`, `gl`, `wg`: full, with expressions, jpg/png/webp and fonts, about 600–650 KB;
  - `sw-lite`, `gl-lite`, `wg-lite`: no fonts, no expressions, PNG only, about 250–300 KB.
- **API.** The player has `seek(frame)` and `totalFrame`. `@thorvg/webcanvas` offers a lower-level Canvas / Animation API that draws into a given canvas.
- **Speed.**
  - ThorVG claims about 1.8× faster CPU rendering than competing engines, and more than 150% GPU gain over v0.15 ([v1.0 post](https://www.thorvg.org/post/thorvg-v1-0-a-new-generation-released)).
  - The maintainers say matte-heavy files are "computationally expensive to render with software engine" and recommend the GPU backends ([dotlottie-web #563](https://github.com/LottieFiles/dotlottie-web/discussions/563)).
  - LottieFiles' own `dotlottie-web` is ThorVG plus Rust. **[measured]** Its glue has one wasm-bindgen `new Function(...)` shim, so under a no-`unsafe-eval` CSP prefer the `@thorvg/*` packages.

### 2.3 What a native Lottie → MotionScene converter must handle

Sources: the [Lottie docs: values](https://lottiefiles.github.io/lottie-docs/values/), [layers](https://lottiefiles.github.io/lottie-docs/layers/) and [shapes](https://lottiefiles.github.io/lottie-docs/shapes/), and the [LAC spec (work in progress)](https://lottie.github.io/lottie-spec/latest/).

**Paths**
- `sh.ks` uses the fields `v`, `i`, `o`, `c`.
- **`i`/`o` tangents are relative to their vertex** ("along the in tangents relative to the corresponding v").
- The plan's `PathVertex [x,y,inX,inY,outX,outY]` must say "relative" for the "maps 1:1" claim to hold.
- `rc` has roundness. `el` is an ellipse. `sr` is a star/polygon with inner and outer roundness.

**Groups**
- `gr` holds a `tr`: anchor, position, scale in %, rotation in degrees, skew and skew-axis, opacity in %.

**Render order**
- Shapes stack.
- **Modifiers apply to the shapes above them in the same group** ("Modifiers process their siblings").

**Paint**
- `fl` has a fill rule `r`.
- `st` has `lc`, `lj`, `ml` and dashes `d` (dash and gap alternate).
- `gf`/`gs` gradients:
  - `t`: 1 is linear, 2 is radial;
  - `s`/`e` are the start and end points; `h`/`a` are highlight length and angle;
  - `g.p` is the colour-stop count;
  - `g.k` is `[offset,r,g,b]×p` followed by optional `[offset,alpha]` pairs;
  - colours are 0–1 floats.

**Modifiers**
- `tm` trim: `s`/`e` 0–100, `o` in degrees, `m` simultaneous vs individually.
- `rp` repeater: `c`, `o`, composite, `tr` with `so`/`eo` start/end opacity.
- `rd` round corners.
- **`mm` merge (modes 1–5)**: no web runtime renders it, so the native path-ops pass is the *only* way to honour it.
- `op` offset path, `pb` pucker-bloat, `tw` twist, `zz` zigzag.

**Layers**
- `ty`: 0 precomp (with `tm` time-remap), 1 solid, 2 image, 3 null, 4 shape, 5 text, 13 camera.
- `ip`, `op`, `st`, `sr` (time stretch), `parent` (by `ind`), `ao` (auto-orient), `ddd` (3D), `bm` (blend modes).

**Masks**
- `masksProperties` with mode (add, subtract, intersect, lighten, darken, difference), `pt`, `o`, `x` (expansion), `inv`.

**Mattes**
- `tt`: alpha, alpha-inverted, luma, luma-inverted.
- `td` marks the matte layer. By default the matte is the layer *above*. Newer files use `tp` (matte parent).

**Keyframes**
- `t`, `s`, and legacy `e`.
- `i`/`o` easing with **per-dimension x/y arrays**.
- `h:1` means hold.
- `ti`/`to` spatial tangents on position.
- Separated position (`p.s:true` with `x`/`y`).

**Text**
- The document keyframes `t.d.k`, animators `t.a` with range selectors, text path `t.p`.
- Embedded glyphs (`chars`) or `fonts`.

**Also**
- effects `ef`, markers, and expressions (`x` strings).

**RECOMMENDATION (2).**
- **Native converter first.** It covers shapes, modifiers incl. merge via the P1 path ops, masks, mattes and text.
- **Fallback rasteriser: switch from lottie-web to ThorVG.**
  - Use `@thorvg/webcanvas`, or `@thorvg/lottie-player`'s `gl`/`sw` preset.
  - ThorVG renders expressions (in WASM, CSP-safe), effects, luma mattes and text.
  - lottie-web's light canvas renders none of the effects and no expressions.
- **Keep `lottie_light_canvas` (54.6 KB gz) as a second fallback only if needed.**
- **Never ship a full lottie-web build** once `unsafe-eval` is removed.
- **Gate imports.** A per-file "feature report" (merge? twist? 3D? expressions?) decides between native and rasterised.

---

## 3. Blender 5.x headless

### 3.1 EEVEE in background mode on Windows
- **It works.** The §5 proof ran EEVEE with `-b` on this desktop: 4.0 s for the first frame, then 0.25 s per frame. The manual adds: "**Headless rendering is not supported on headless Windows systems**", and EEVEE is GPU-only with no multi-GPU support ([EEVEE limitations](https://docs.blender.org/manual/en/latest/render/eevee/limitations/limitations.html)).
  - So never launch EEVEE jobs from a Windows service or session 0, or over a GPU-less RDP session.
  - Cycles (CUDA/OptiX/CPU) has no such limit.
- **[measured]** Blender 5.2's `--help` confirms `--gpu-backend opengl|vulkan` (a useful fallback switch) and `--gpu-device` (Vulkan only).
- **5.2 adds `gpu.init()`** to initialise the GPU backend in `--background` ([5.2 Python API](https://developer.blender.org/docs/release_notes/5.2/python_api/)). **[measured]** Calling `gpu.*` in `-b` without it raises "requires the gpu module to be initialized".
- **Shadow catcher is Cycles-only.** It is documented under Cycles object settings ([manual](https://docs.blender.org/manual/en/latest/render/cycles/object_settings/object_data.html)). **[measured]** `Object.is_shadow_catcher` exists in the API but EEVEE ignores it, as the proof saw.
  - The standard EEVEE draft substitute: a floor material of Diffuse → **Shader to RGB** → ColorRamp → alpha, with blended transparency, on transparent film ([artisticrender](https://artisticrender.com/how-to-create-a-shadow-catcher-with-eevee-in-blender/)).
- **Glass is dark in EEVEE, and that is expected.**
  - EEVEE ray tracing is screen-space: "only what is inside the view can be considered", "Only one refraction event is correctly modeled", "Blended materials are not compatible with raytracing" ([limitations](https://docs.blender.org/manual/en/latest/render/eevee/limitations/limitations.html)).
  - **[measured]** The 5.2 API has `Material.use_raytrace_refraction`, `thickness_mode`, `surface_render_method`, and `scene.eevee.use_raytracing` / `ray_tracing_method`.
  - The proof set only the scene flag. The material flag plus a visible backdrop is needed for any refraction: over transparent film there is nothing on screen to refract.
  - EEVEE glass stays a draft look. That confirms the plan's decision.

### 3.2 Cycles, OptiX and denoising
- **Driver floor.** "The minimum driver version for OptiX is now **575**" in 5.2 ([5.2 Cycles](https://developer.blender.org/docs/release_notes/5.2/cycles/)). Detect this, and fall back to CUDA plus OIDN.
- **Flicker.** Per-frame denoising (OptiX or OIDN) processes each frame alone and can **flicker** in animation ([artisticrender](https://artisticrender.com/how-to-denoise-an-animation-in-blender-using-temporal-denoising/)).
  - **[measured]** `bpy.ops.cycles.denoise_animation` exists in 5.2. It needs vector passes plus stored denoising data (`view_layer.cycles.denoising_store_passes`), and temporal denoising is OptiX-based ([BlenderNation](https://www.blendernation.com/2022/01/10/optix-temporal-denoising-support-added-to-blender-3-1-alpha/)).
  - A cheaper mitigation for the short motion-graphics shots Bhippi renders: more samples with adaptive sampling, plus `denoising_use_gpu` (OIDN on GPU).
- **Persistent data.** `render.use_persistent_data = True` keeps the BVH and textures between animation frames ([commit](https://projects.blender.org/blender/blender/commit/50782df42)). It is a cheap speedup for the "final" tier.

### 3.3 Command line (from the installed 5.2 `--help`) **[measured]**
- **Recommended form:** `blender -b --factory-startup --python-exit-code 1 -P bridge.py -- req.json`.
  - `--python-exit-code` makes Python exceptions fail the process, so the Rust runner sees the error.
  - Cycles options go after `--`, e.g. `-- --cycles-device OPTIX`.
- "**Arguments are executed in the order they are given**". For example, `--render-frame` before `-o` renders to the wrong path.
- `-b` disables audio.
- `--factory-startup` ignores user preferences, so the script must set `compute_device_type` and call `get_devices()` itself. The proof does this.

### 3.4 Python API changes (4.4 → 5.2)
- **Slotted actions (4.4).** `action.fcurves`, `groups` and `id_root` became "backward-compatible legacy API… **will be removed in Blender 5.0**" ([4.4 notes](https://developer.blender.org/docs/release_notes/4.4/python_api/)).
- **5.0 removed it:** "The legacy `Action` API has been removed… use the convenience functions in `bpy_extras.anim_utils`"; the `action_group` parameter became `group_name` ([5.0 notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)). **[measured]** In 5.2, `hasattr(action, "fcurves")` is **False**. `anim_utils` offers `action_get_channelbag_for_slot`, `action_ensure_channelbag_for_slot`, `animdata_get_channelbag_for_assigned_slot` and `action_get_first_suitable_slot`.
  - The proof's `ad.action.fcurves if hasattr(…)` branch is dead code on 5.x.
  - Its hand-rolled `layers → strips → channelbag(slot)` walk works. Replace it with `anim_utils.animdata_get_channelbag_for_assigned_slot(ad)`.
- **Other 5.0 breaks** ([5.0 notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)):
  - `scene.node_tree` was **removed**; use `scene.compositing_node_group`. **[measured]**: `hasattr(scene, "node_tree")` is False.
  - The File Output node lost `file_slots`, `layer_slots` and `base_path`; it now has `directory`, `file_name` and `file_output_items`.
  - Render passes were renamed ("`Z` to `Depth`", "`IndexMA` to `Material Index`").
  - `scene.use_nodes` and `world.use_nodes` are deprecated for 6.0. The proof log already warns about `Material.use_nodes` and `World.use_nodes`.
  - The engine id is `BLENDER_EEVEE`, which was `BLENDER_EEVEE_NEXT` ([5.0 EEVEE](https://developer.blender.org/docs/release_notes/5.0/eevee/)).
  - 5.2 removed EEVEE's Fast GI "Far Thickness" ([5.2 EEVEE](https://developer.blender.org/docs/release_notes/5.2/eevee/)).
- **Multilayer EXR [measured].** In 5.2, `image_settings.file_format = 'OPEN_EXR_MULTILAYER'` **fails** unless you first set `image_settings.media_type = 'MULTI_LAYER_IMAGE'`. The media types are IMAGE, MULTI_LAYER_IMAGE and VIDEO.
  - Cryptomatte object, material and asset passes exist (depth 6 by default), as do `use_pass_z`, `use_pass_mist`, `use_pass_object_index`, `use_pass_vector` and the Cycles `use_pass_shadow_catcher`.
  - The WebView cannot decode EXR. Either convert in Rust with the `exr` crate (BSD-3, [crate](https://crates.io/crates/exr)), or write mattes as 16-bit PNG through the compositor File Output node.
- **Rigid-body bake, headless [measured].**
  - `bpy.ops.rigidbody.object_add()` then `bpy.ops.ptcache.bake_all(bake=True)` ran in `-b` without context overrides. `point_cache.is_baked` was True.
  - A cube dropped from z=5 read 5.0, 1.943, 0.5, 0.5 at frames 1, 20, 40, 60.
  - `bpy.ops.rigidbody.bake_to_keyframes` also exists. The plan's `letters-drop` is feasible.
- **Grease Pencil v3 [measured].**
  - `bpy.types.GreasePencil` *is* v3 in 5.x. The old annotation types were renamed to `Annotation` ([5.0 notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)); v3 arrived in 4.3 with the legacy GP API removed ([4.3 GP](https://developer.blender.org/docs/release_notes/4.3/grease_pencil/)).
  - This worked in `-b`: `gp = bpy.data.grease_pencils.new(...)`; `layer = gp.layers.new("L")`; `dr = layer.frames.new(1).drawing`; `dr.add_strokes([4])`; then set `points[i].position` and `radius`.
  - The Line Art modifier exists as `GreasePencilLineartModifier`.

**RECOMMENDATION (3).**
- **Build `blender_bridge.py` against 5.2 LTS only**, with a version gate. Use:
  - `anim_utils` channelbags;
  - `compositing_node_group`;
  - `media_type` before EXR formats;
  - `gpu.init()` only if the script needs the `gpu` module;
  - `--python-exit-code 1`.
- **Draft tier (EEVEE):**
  - the Shader-to-RGB shadow catcher;
  - `use_raytrace_refraction` on glass;
  - never run from a service.
- **Final tier (Cycles):**
  - OptiX if the driver is ≥575, else CUDA;
  - OIDN-on-GPU with adaptive sampling;
  - `use_persistent_data`;
  - `denoise_animation` (temporal) only when flicker is visible.
- **Matte passes.** Emit them as PNG through the File Output node, and keep EXR optional.

---

## 4. 2D character rigging and AI character animation

### 4.1 Skeletal and mesh runtimes

| Runtime | Licence | Fit for Bhippi |
|---|---|---|
| Spine runtimes (`@esotericsoftware/spine-webgl` 4.3.13) | Spine Runtimes Licence: integration requires a Spine Editor licence, and products must require "each user… obtain their own Spine Editor license" ([licence](https://en.esotericsoftware.com/spine-runtimes-license)) | **Red flag. Don't use** |
| Live2D Cubism Web | Proprietary SDK licence (repo is not OSI) ([repo](https://github.com/Live2D/CubismWebFramework)) | Don't use |
| DragonBonesJS | MIT; last push 2026-01; editor effectively abandoned; `dragonbones-pixi` last published 2018 ([repo](https://github.com/DragonBones/DragonBonesJS)) | Only as a file-format reader, if ever |
| Rive runtime (`@rive-app/canvas`/`webgl2` 2.43.1) | MIT runtimes ([docs](https://rive.app/docs/runtimes/getting-started), [rive-wasm](https://github.com/rive-app/rive-wasm)) | Content must be authored in Rive's proprietary editor. Useful only as "import a `.riv`", not as an AI-generated rig format |
| PixiJS 8.21 (`MeshRope`, `MeshPlane`) | MIT ([repo](https://github.com/pixijs/pixijs)) | A second renderer; conflicts with the "one Canvas2D/GL engine" design |

- **Conclusion:** the plan's in-house `character.ts` is the right call.
  - It reuses the tested `twoBone` IK.
  - It keeps one engine, deterministic export and no licence exposure.
- **Rubber-hose.** Battle Axe's Rubberhose (the AE reference tool) is "Rigged animation, but simplified… not Mathematically perfect IK. Because IK usually looks like a robot", with a "realism" control and extra bend points ([Rubberhose](https://www.battleaxe.co/rubberhose)).
  - Implementation: a constant-length hose between shoulder and wrist bends into a circular arc. Solve arc length L over chord d for the arc's sagitta. Then draw one tapered bezier stroke.
  - It is pure maths, so it goes in `character.ts`.
- **Walks.** The standard teaching walk is a 24-frame cycle at 24 fps, which is **12 frames per step**. Contacts fall at frames 1, 13 and 25, downs at 4 and 16, passings at 7 and 19, and push-offs at 10 and 22. The same notes put a 12-frame cycle (6 f per step) in run or very-fast-walk territory ([Monmouth animation notes](https://animation.monmouth.edu/instruct/animation/walk-cycle/)). The MDS sneak happened to be 12 f per step. Keep 12 f as the *normal* walk default and make sneak slower.

### 4.2 AI and LLM character animation, 2024–2026

| System | What it is | Local and licence-safe? |
|---|---|---|
| **Meta AnimatedDrawings** | Detects, segments and rigs a drawn figure, then retargets BVH motion. "code, model weights, and Amateur Drawings dataset is released under the MIT license" ([repo](https://github.com/facebookresearch/AnimatedDrawings)) | **Yes.** The best licence-safe base for "animate a drawing" (P8 stage 2) |
| **ToonCrafter** (SIGGRAPH Asia 2024) | Generative cartoon interpolation. Apache-2.0. 512×320, up to 16 frames, about 24–27 GB VRAM; community fp16 about 10–12 GB ([repo](https://github.com/Doubiiu/ToonCrafter)) | Runs on a 10–12 GB GPU in fp16; low resolution. Research track only |
| **ToonComposer** (2025) | Keyframe sketches → cartoon video on Wan 2.1-I2V-14B. Weights MIT. **About 57 GB VRAM** for 480p × 61 frames ([repo](https://github.com/TencentARC/ToonComposer)) | **Not local** on consumer GPUs |
| **LTX-2** (the local LTX pipeline) | Multi-keyframe conditioning. LTX-2 Community Licence: entities with **≥ $10M revenue need a paid licence**. Derivatives must carry the licence ([LICENSE](https://huggingface.co/Lightricks/LTX-2/blob/main/LICENSE)) | OK for small users. **Flag in the UI** if Bhippi downloads the weights |
| **OmniLottie** (CVPR 2026) | Text/image/video → Lottie JSON. Code Apache-2.0; 4B weights 8.46 GB built on **Qwen2.5-VL-3B (`qwen-research` licence)**. Its **MMLottie-2M** training set is **CC BY-NC-SA** and was "collected from… LottieFiles, IconScout, Flaticon, Iconfont, and Icons8" ([repo](https://github.com/OpenVGLab/OmniLottie), [dataset](https://huggingface.co/datasets/OmniLottie/MMLottie-2M), [Qwen card](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct)) | **No.** Non-commercial base model plus scraped NC data. Read the ideas only |
| Keyframer (Apple), LogoMotion, MoVer | LLM → CSS/JS animation for SVG ([Keyframer](https://machinelearning.apple.com/research/keyframer)). Visually grounded code synthesis for logos ([LogoMotion](https://arxiv.org/abs/2405.07065)). A first-order-logic **motion verification DSL** in an LLM generate-and-check loop ([MoVer, ACM TOG 2025](https://doi.org/10.1145/3731209)) | Ideas, not dependencies. MoVer is the closest research to Bhippi's pacing QA |
| Products | Vyond Go (prompt → editable character explainer; 4,000-char prompts, about 2 min output) ([Vyond](https://www.vyond.com/product/vyond-go/)). Rive's in-editor AI agent writes keyframes and Luau scripts ([rivemasterclass](https://www.rivemasterclass.com/blog/build-dynamic-particles-system-scripting-ai-agent-rive)). Adobe Animate went into **maintenance mode** on 2026-02-04 after a cancelled shutdown ([TechCrunch](https://techcrunch.com/2026/02/04/after-backlash-adobe-cancels-adobe-animate-shutdown-and-puts-app-on-maintenance-mode)) | Competitive context |

A curated index of in-betweening papers is kept at [Awesome-2D-Animation](https://github.com/MarkMoHR/Awesome-2D-Animation).

**RECOMMENDATION (4).**
- **Stage 1:** in-house rig solver, with rubber-hose arcs and 12 f/step walks.
- **Stage 2 "animate a drawing":** AnimatedDrawings (MIT) as a Python worker, with vtracer to vectorise the result.
- **In-betweening:** ToonCrafter fp16 as an opt-in research worker only.
- **Never** Spine, Live2D, OmniLottie weights or LottieFiles-trained models.
- **Rhubarb only for non-TTS audio.** Bhippi TTS already has phoneme timings. Pass the transcript with `-d`.

---

## 5. Vector ops in JS (and Rust)

| Need | Option | Licence | Size **[measured]** | Notes |
|---|---|---|---|---|
| Booleans + offset, polygons | **Clipper2** (`clipper2-js` 1.2.4) | **BSL-1.0** (permissive) | 69.9 KB min / **19.5 KB gz** | One library does union/diff/intersect/xor, **offsetting** (`InflatePaths`, round/miter joins) and simplification ([npm](https://www.npmjs.com/package/clipper2-js), [Clipper2](https://github.com/AngusJohnson/Clipper2)). Pure TS, so it runs in vitest |
| Booleans, polygons | polygon-clipping 0.15.7 | MIT | 29 KB / 9.3 KB gz | No offsetting; last release 2023. Successor [polyclip-ts](https://github.com/luizbarboza/polyclip-ts) (MIT, 2024) |
| Booleans that **keep beziers**, stroke-to-path, dash, trim | **Skia PathKit** (`pathkit-wasm` 1.0.0) | BSD-3 | WASM 324 KB / **135 KB gz** (glue has no eval) | Skia's PathOps: `op`, `simplify`, `stroke`, `dash`, `trim`, `transform` ([docs](https://skia.org/docs/user/modules/pathkit/)). The npm build is stale (2022), though the Skia code is maintained |
| Everything Skia | CanvasKit 0.42.0 | BSD-3 | WASM 7.3 MB / **2.9 MB gz** | **Not worth bundling for path ops.** Only worth it if Bhippi swapped its whole Canvas2D rasteriser ([npm](https://www.npmjs.com/package/canvaskit-wasm)) |
| Booleans on curves | Paper.js core 0.12.18 | MIT | 208 KB / 70 KB gz | Known robustness failures on small or near-degenerate beziers ([#1074](https://github.com/paperjs/paper.js/issues/1074)); global scope |
| Morphs | flubber 0.4.2 | MIT | 53.5 KB / 18.3 KB gz | 2018. The algorithm (arc-length resample + rotation alignment) is about 200 lines. Reimplement it in `src/motion/vector/`, as the plan implies |
| Morphs (avoid) | GSAP MorphSVG | GSAP "Standard" licence | — | **Prohibited use:** tools "that allow users to build visual animations without code" competing with Webflow ([GSAP licence](https://gsap.com/community/standard-license/)). **Red flag for Bhippi** |
| Path parse / normalise | svgpath 2.6.0 | MIT | 13.6 KB / 5 KB gz | `abs()`, `unarc()`, `unshort()`, transforms ([repo](https://github.com/fontello/svgpath)) |
| Arc length / resample | svg-path-properties 2.1.0; bezier-js 6.1.4 | ISC; MIT | 8.2 KB gz; 8.4 KB gz | `getPointAtLength`; `length()`, `getLUT()`, `offset()` ([svg-path-properties](https://github.com/rveciana/svg-path-properties), [bezier-js](https://github.com/Pomax/bezierjs)) |
| SVG import normalisation | **usvg** 0.48.1 (Rust) | Apache-2.0 OR MIT | — | Resolves CSS, `<use>`, transforms and gradients into a simple path tree ([crate](https://crates.io/crates/usvg)). It fits `import_media` in Rust. The JS alternative is SVGO 4.1.0 (MIT): 805 KB / 195 KB gz browser build ([repo](https://github.com/svg/svgo)) |
| Curve maths in Rust | kurbo 0.13.1 | Apache-2.0 OR MIT | — | Arc length, offset, stroke expansion ([crate](https://crates.io/crates/kurbo)) |

**RECOMMENDATION (5).**
- **Render-time path ops** (merge, offset, round corners, repeater) stay pure TS in `src/motion/vector/`.
- **Merge and offset: Clipper2** on beziers flattened adaptively at the output resolution. At 0.25 px tolerance the raster is identical, and Clipper2 does booleans and offsets in one library of about 20 KB gz.
- **PathKit (135 KB gz WASM, lazy-loaded)** only for operations whose *output must stay editable bezier*:
  - "bake merge to path";
  - stroke-to-path for extruding Lucide icons in P7;
  - dash-to-path.
- **SVG import** normalises in Rust with usvg and sends `ShapeItem` JSON to the UI.
- **Skip** CanvasKit, Paper.js and GSAP.

---

## 6. Variable fonts in Canvas2D (WebView2 / Chromium 153)

**[measured]** A test page ran in Chromium 153 (Playwright; the local WebView2 is 153.0.4234.48). It used Inter (wght) and Archivo (wdth) as `FontFace`s from data URLs:

| Mechanism | Result |
|---|---|
| `ctx.font = "573 80px InterV"` with a `FontFace` registered as `weight: '100 900'` | **Works, continuously.** Width of "Workly breathe": 100 → 536.3, 450 → 579.7, 573 → 590.1, 650 → 596.6, 900 → 622.4. Ink coverage differs between 450 and 451, so interpolation is per unit. **wght breathe needs nothing extra** |
| `ctx.fontStretch` | **Keywords only** (9 steps). Setting `'87%'` is silently ignored and the value stays `'condensed'`. `ultra-condensed` and `ultra-expanded` clamp to Archivo's 62 and 125. MDN: "percentage values are not supported" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fontStretch)). A `font` shorthand with `87%` is also ignored |
| `ctx.fontVariationSettings` | **Does not exist.** It is still a proposal ([whatwg/html #3571](https://github.com/whatwg/html/issues/3571)) |
| `new FontFace(name, src, { variationSettings: '"wdth" 62' })` | **Works.** Archivo measured 321.1 at wdth 62 and 627.9 at wdth 125. It has been supported since Chrome 140 (BCD 8.1.3; [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FontFace/variationSettings)). Each value needs its own registered face, so animate by **quantising** (e.g. 1 wdth unit) and caching faces |
| `ctx.letterSpacing` | Works (Chrome 99+) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing)). Tracking slams can use it natively |

- **Any axis, continuously, with shaping:** `harfbuzzjs` 1.6.2 (MIT).
  - `setVariations({wdth: 87.3, wght: 612})`, then `shape()`, then `glyphToPath()`, drawn with `Path2D` ([repo](https://github.com/harfbuzz/harfbuzzjs)).
  - **[measured]** `harfbuzz.wasm` is 434 KB (175 KB gz), and the glue has no eval.
- **Pure-JS alternative:** opentype.js 2.0.0 (MIT) with its new `VariationManager`: 245 KB / 67 KB gz ([repo](https://github.com/opentypejs/opentype.js)). It is less complete on shaping.
- Browser support dates come from [@mdn/browser-compat-data 8.1.3](https://github.com/mdn/browser-compat-data): canvas `letterSpacing`, `fontStretch` and `fontKerning` from Chrome 99; `FontFace.variationSettings` and `@font-face font-variation-settings` from Chrome 140.

**RECOMMENDATION (6).**
- **Weight:** animate `wght` through `ctx.font`'s numeric weight. Keep the glyph cache keyed on the numeric weight.
- **Other axes:**
  - `wdth`, `opsz`, `SOFT`, `WONK`, GRAD on the text layer: use cached `FontFace`s with `variationSettings`, quantised.
  - Or, when an axis animates every frame, render that span through harfbuzzjs glyph paths.
- **Bundle one wdth family** (Mona Sans or Archivo).
- **Test `opsz`.** Canvas has no `font-optical-sizing` property, so Inter's opsz auto-application must be tested before the plan relies on it.

---

## 7. State of the art, 2025–2026: AI motion graphics and SaaS explainers

### 7.1 Four camps

**1. Code-first generators**
- **Remotion Agent Skills** (Jan 2026): coding agents write React/Remotion videos ([Remotion docs](https://www.remotion.dev/docs/ai/claude-code)).
- **Hera**: prompt → "editable" motion graphics, templates, API ([hera.video](https://hera.video/)).
- Research:
  - **Code2Video** (Planner / Coder / Critic agents over Manim) ([arXiv](https://arxiv.org/abs/2510.01174));
  - **MG-Gen** (a single image → layered HTML → per-layer animation scripts → video, keeping text readable) ([arXiv](https://arxiv.org/abs/2504.02361)).
- Quality is good for kinetic type and charts. Camera language and continuity are weak. No product checks pacing numerically.

**2. Design-tool-native AI**
- **Figma Motion** (Config, 2026-06-24): a timeline and keyframes on the canvas; the Figma agent can generate motion; exports CSS, JSON, React, MP4, WebM, animated SVG ([Figma blog](https://www.figma.com/blog/introducing-figma-motion/), [CMSWire](https://www.cmswire.com/digital-experience/figma-launches-code-layers-motion-at-config-2026/)).
- **LottieFiles Motion Copilot 2.0**: builds shapes, text, gradients, layers and eased keyframes from prompts, plus an MCP for Claude and Cursor ([blog](https://lottiefiles.com/blog/working-with-lottie-animations/introducing-motion-copilot-on-lottie-creator)).
- **Jitter** (Figma import → Lottie/MP4, audio tracks) ([Jitter](https://jitter.video/product/)).
- **Rive** AI agent (above).

**3. Screen-recording polishers**
- **Screen Studio**: auto-zoom toward actions, cursor smoothing.
- **Clueso** and **Trupeer**: recording → scripted voice-over, auto-zoom, captions ([ngram comparison](https://www.ngram.com/blog/clueso-vs-screen-studio), [Clueso](https://www.clueso.io/features/screen-recorder), [Trupeer](https://www.trupeer.ai/video)).
- Real UI, but only recorded pixels: no restyling, no z-lift, no match-cuts.

**4. Screenshot → animated mockup**
- **Pexo** stages a screenshot and renders it with Sora 2, Kling or Veo ([Pexo](https://pexo.ai/create/animated-mockups)).
- **AppLaunchFlow** and **Rotato**: 3D device mockups with motion presets ([AppLaunchFlow](https://www.applaunchflow.com/3d-mockup-animation-generator), [Rotato](https://rotato.app/)).
- Generative video makes the camera cinematic, but UI text and layout are not controllable frame to frame.

### 7.2 Where Bhippi can leap ahead
1. **The real product DOM as a targetable scene** (P3 `capture_product_ui` with part maps). None of the four camps drives camera, cursor and z-lift from DOM boxes of the user's own app. MG-Gen's image → layered-HTML step is a good fallback for plain screenshots.
2. **Measured pacing as a checkable contract.** The §2.1 tokens plus pacing QA are what MoVer shows in research: generate, verify predicates, refine ([MoVer](https://doi.org/10.1145/3731209)). No shipping product verifies timing against a reference profile.
3. **One timeline for footage, 2D motion, UI, characters and Blender 3D**, local, offline and brand-kit-aware. Code-first tools render only; design tools have no NLE.
4. **Continuity-object camera direction** (P4). The reference films' defining trait is missing from every generator surveyed.
5. **Reference-film analysis → style profile** (P10). No surveyed product ingests a reference film to set its defaults.

**RECOMMENDATION (7).**
- **Position Bhippi against Hera, Remotion and Figma Motion on continuity and pacing verification**, not on "prompt → video".
- **Borrow MoVer's idea.** Express pacing and spatial checks as predicates over the scene JSON, so the council gets pass/fail facts.

---

## 8. SaaS explainer conventions from professional sources vs the plan's §2.1

| Topic | Pro sources | Plan §2.1 | Verdict |
|---|---|---|---|
| Length | Homepage 60–90 s, social 30–45 s, ads 15–60 s, onboarding 2–3 min. 50–65% engagement under 1 min (Wistia, via **Solair**, the studio behind two reference films) ([Solair](https://solairmotion.com/blog/saas-explainer-video-length)). Homepage and landing-page demos also 60–90 s ([Moonb](https://www.moonb.io/blog/saas-product-demo-video)) | Films 28–73 s; goldens 10–15 s | Consistent. Genre packs should default to **30–45 s social / 60–90 s homepage** |
| Beat structure | Hook → problem → solution → (proof) → one CTA. Hook 0–8 s. "A viewer offered three next steps usually takes none" ([Biteable](https://biteable.com/blog/explainer-video-script-template/), [Solair](https://solairmotion.com/blog/saas-explainer-video-length)) | P10 recipe: hook → problem → reveal → 3–5 features → proof → CTA | Matches. Solair says **one hero feature**, and proof "compresses to a single line". Cap features at 1 hero + 2 secondary for ≤ 45 s |
| VO pace | About **150 words per 60 s** (130–160 wpm) ([Solair](https://solairmotion.com/blog/saas-explainer-video-length); [Boords](https://boords.com/script-timer)) | Text leads VO by 0.3–1.0 s | Add a **2.5 words/s budget** to `motion_guide` |
| Easy Ease | Speed 0, influence 33.33% on both sides ([Adobe: speed](https://helpx.adobe.com/after-effects/using/speed.html); [Creative COW](https://creativecow.net/forums/thread/easy-ease/)). The AE → CSS mapping is `x1 = inflA/100, y1 = speedA·x1…` ([gist](https://gist.github.com/tannerhodges/d87732de9e7bd75b02ba53a11a5df7c1)), so Easy Ease = **cubic-bezier(0.333, 0, 0.667, 1)** | Camera push measured about (0.6, 0, 0.4, 1) | The films are *steeper* than Easy Ease. The measured push ≈ Penner **easeInOutCubic (0.65, 0, 0.35, 1)** ([easings.net](https://easings.net/)). Flow ships 25 Penner-based presets ([aescripts Flow](https://aescripts.com/flow/)). Name the token `easeInOutCubic` and do **not** default to Easy Ease |
| Entrances | Material 3 `emphasized-decelerate` = **cubic-bezier(0.05, 0.7, 0.1, 1)**; long durations 450–600 ms ([M3 tokens source](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)) | Panel entrance ≈ (0.05, 0.7, 0.1, 1), 12–20 f (400–667 ms) | **An exact match** to M3's token. Strong validation |
| Exits | M3 `emphasized-accelerate` = (0.3, 0, 0.8, 0.15), with shorter durations | Exits 8–14 f ease-in, faster than entrances | Consistent. Use M3's curve as the default exit token |
| Pops | M3 short4 / medium1 = 200–250 ms | 6–8 f (200–267 ms) with 6–10% overshoot | Consistent. easeOutBack is (0.34, 1.56, 0.64, 1) ([easings.net](https://easings.net/)) |
| Logo / camera expo-out | easeOutExpo = **(0.16, 1, 0.3, 1)** ([easings.net](https://easings.net/)) | Blender proof used (0.16, 1, 0.3, 1) | Same curve |
| Typing speed | A typing "word" is 5 characters, and fast general users average about 40 wpm ([Wikipedia WPM](https://en.wikipedia.org/wiki/Words_per_minute)). That is **≈ 3.3 chars/s** for real typing | **30 cps** (1 char/frame) | The films type about 9× faster than humans *on purpose*: the viewer reads the result, not the keystrokes. Keep 30 cps for UI fields. When the typed text is the message (read along with VO), use **≈ VO rate ≈ 12–13 cps** |
| Loudness / mix | YouTube normalises to **−14 LUFS** and "only turns loud content down", with a −1 dBTP true-peak limit ([Critical Listening Lab](https://www.criticallisteninglab.com/en/learn/loudness/youtube)). Auto-ducking "Reduce By… often around −18 dB to −24 dB"; music under dialogue at about −18 to −25 dB ([Pixflow](https://pixflow.net/blog/audio-mixing-premiere-pro/)). SFX sync "on that exact frame", or deliberately early or late for effect ([SFX Engine](https://sfxengine.com/blog/sound-effects-for-animation)). Research: generative SFX for motion graphics ([MoSound, CHI 2026](https://doi.org/10.1145/3772318.3791162)) | P9 lists SFX kinds, no levels | **Add a mix spec to P9:** −14 LUFS / −1 dBTP master, VO-keyed ducking of about −18 dB, SFX under VO except deliberate hits |
| End card | — | 1.2–3.9 s | No authoritative pro norm found. Keep the measured range |

**RECOMMENDATION (8).** Add these named tokens to `TIMING`:
- `emphasizedDecelerate` (0.05, 0.7, 0.1, 1);
- `emphasizedAccelerate` (0.3, 0, 0.8, 0.15);
- `easeInOutCubic` for camera;
- `easeOutExpo` for wordmarks and logos;
- `easeOutBack` for pops.

Also:
- add VO budget and loudness rules to the genre packs;
- make typewriter `cps` purpose-dependent (UI fill 30 cps; read-along ≈ VO rate).

---

## Decisions table

| Decision | Recommended option | Alternatives | Licence risk |
|---|---|---|---|
| Invoke Blender | Official 5.2 LTS `blender.exe`, separate process, JSON protocol, `--python-exit-code 1` | Bundle Blender (no); Blender-as-a-module `bpy` wheel (links GPL into process, no) | Low, **if** the bridge script is GPL and there is no logo use |
| Get Blender | In-app download from download.blender.org (404 MB zip) + SHA-256 check; Detect button | Ask user to install; winget/MSI | Low |
| Blender F-curve access | `bpy_extras.anim_utils` channelbag helpers | Manual layers/strips walk (works) | None |
| 3D draft glass/shadow | EEVEE + material `use_raytrace_refraction` + Shader-to-RGB shadow floor | Hide floor (plan) | None |
| 3D final denoise | Cycles, OIDN GPU + adaptive sampling; OptiX if driver ≥575; temporal only on flicker | OptiX per-frame (plan); SID add-ons | None |
| Lottie fallback rasteriser | **ThorVG** (`@thorvg/webcanvas` / `lottie-player` gl or sw) | lottie-web `lottie_light_canvas` (no expressions, no effects); dotlottie-web (has `new Function` shim) | None (MIT) |
| Lottie sources | User-supplied files; bundle Noto Animated Emoji (CC BY 4.0) | LottieFiles search (**no**: no API, licence), useAnimations (CC BY), Lordicon (no redistribution) | **High** for LottieFiles search or bundling |
| Path booleans + offset | **Clipper2** (`clipper2-js`) on adaptively flattened paths | polygon-clipping / polyclip-ts; Paper.js | Low (BSL-1.0) |
| Editable bezier ops, stroke-to-path | Skia **PathKit** WASM, lazy | CanvasKit (2.9 MB gz); kurbo in Rust | None (BSD-3) |
| Morph | In-house arc-length resample + rotation alignment (flubber method) | flubber (2018); GSAP MorphSVG (**no**) | **High** for GSAP; none otherwise |
| SVG import | usvg (Rust) → ShapeItem JSON | SVGO (195 KB gz) + svgpath in TS | None |
| Icons | Lucide 1.48 (2,118 icons), `icon-nodes.json` + `tags.json` | Tabler (MIT), Phosphor (MIT) | Low (ISC + MIT notices) |
| Variable-font animation | `ctx.font` numeric weight; cached `FontFace.variationSettings` for other axes; harfbuzzjs for continuous any-axis | CanvasKit Paragraph `fontVariations` (7 MB) | None |
| Bundled fonts | The 8 OFL families + **Mona Sans or Archivo** (wdth); static TTF instances for libass | Roboto Flex (326 KB) | Low (OFL; include licence) |
| Caption fonts (libass) | Static instances via fontTools instancer | Variable files (**libass ignores axes**) | None |
| Character rig runtime | In-house `character.ts` (twoBone IK, hose arcs) | Spine (**per-user licence**), Live2D (proprietary), Rive (editor-bound), DragonBones (stale) | **High** for Spine/Live2D |
| Lip sync | TTS phonemes; Rhubarb 1.14 as a 70 MB optional download, with `-d transcript` | Bundle Rhubarb (89 MB); phonetic mode for non-English | Low (MIT + BSD notices) |
| Animate-a-drawing | Meta AnimatedDrawings (MIT) worker + vtracer | OmniLottie (**no**) | Low; **High** for OmniLottie |
| AI in-betweening | ToonCrafter fp16 opt-in research worker | ToonComposer (57 GB), LTX-2 keyframes (≥ $10M revenue clause) | Low (Apache-2.0); LTX-2 medium |
| Illustration parts | Open Peeps / Humaaans / Open Doodles from original sites (CC0); Kenney (CC0) | Blush versions (**no redistribution**) | Low; **High** via Blush |
| 3D assets | Poly Haven / ambientCG (CC0) with "Powered by Poly Haven" + UA header on API use | Sketchfab (per-model licences) | Low |
| Vectorise raster | vtracer **Rust crate** in Tauri | PyPI vtracer; potrace (**GPL**, no) | None |

---

## Corrections to REFERENCE-FILMS-PLAN.md

| § | What's wrong | Fix |
|---|---|---|
| §4 P1 Icons | "Lucide (ISC, about 1,500 icons)" | 2,118 icons in v1.48.0. ISC **plus MIT** for Feather-derived icons: ship both notices. The icons are strokes with arcs, so the parser needs `unarc` and extrusion needs stroke-to-path |
| §4 P1 Rendering | "merge through a bundled polygon clipper (`polygon-clipping`, MIT)" | Prefer **Clipper2** (BSL-1.0, about 20 KB gz), which also does `offset`. polygon-clipping has no offsetting and no release since 2023 |
| §4 P1 Schema | `PathVertex` in/out ambiguity; "Lottie maps 1:1" | State that in/out tangents are **relative to the vertex** (Lottie's convention), or the converter must convert |
| §4 P1 Rendering | Morph "(the `flubber` approach, MIT)" | Fine, but flubber dates from 2018. Implement in-house. **Never** GSAP MorphSVG (licence prohibits visual animation builders) |
| §4 P1 SVG import | `svgToShape()` parses paths, groups, transforms and fills in TS | Normalise with **usvg** in Rust (CSS, `<use>`, gradients, transforms), then map to `ShapeItem` |
| §4 P2 Variable fonts | Assumes the bundled families support `wdth`/`slnt` | None of the 8 has `wdth` or `slnt`; Caveat's wght is only 400–700. **Add Mona Sans or Archivo** |
| §4 P2 Variable fonts | Implies Canvas2D can animate axes directly | wght: yes, continuously via `ctx.font`. wdth: `fontStretch` is **keyword-only**. `ctx.fontVariationSettings` doesn't exist. Use cached `FontFace({variationSettings})` (Chrome 140+) or harfbuzzjs glyph paths |
| §4 P2 libass | "written to a fonts dir that libass/FFmpeg captions can see" (the variable WOFF2 files) | libass ignores variable axes and needs a Brotli FreeType for WOFF2. Write **static TTF instances** (fontTools instancer) |
| §4 P7.2 Worker | Maps easing via `action.fcurves` (the proof's first branch) | That API was removed in 5.0. Use `bpy_extras.anim_utils` channelbags. Also: `scene.node_tree` → `compositing_node_group`; set `media_type='MULTI_LAYER_IMAGE'` before EXR; passes renamed (`Z` → `Depth`) |
| §4 P7.2 / §7 Licences | Blender row: "Fine: run as a separate program" | Also: **`blender_bridge.py` must be GPL-licensed** (it uses bpy and Bhippi distributes it). No Blender logo without permission |
| §4 P7.3 | "one-click download of the official portable zip" | Add: 404 MB, verify the published SHA-256, pin 5.2 LTS (5.2.2 is current), and run `blender -b` only from the interactive session (EEVEE: "not supported on headless Windows systems") |
| §4 P7.3 Command | `run_program(blender, ["-b","--factory-startup","-P",script,"--",req])` | Add `--python-exit-code 1`. Keep argument order (options before `-P`). Allow `--gpu-backend opengl` as a retry |
| §4 P7.5 / §5 | Final tier "Cycles OptiX … OptiX denoiser" | OptiX needs **driver ≥575** (5.2); fall back to CUDA. Per-frame denoise can flicker, so prefer OIDN-GPU with adaptive sampling, and `denoise_animation` (temporal) when needed. Enable `use_persistent_data` |
| §4 P7.5 / §5 | EEVEE: "no shadow catcher… hide it, or use a holdout"; "glass dark" | Draft shadow via a **Shader-to-RGB** floor material. Glass needs material `use_raytrace_refraction` plus a visible backdrop, and stays a draft look (screen-space, single refraction) |
| §4 P7.6 | `import_3d_model {polyhaven:id}` (CC0 = fine) | Poly Haven **API terms**: show "Powered by Poly Haven" near results, and send a unique User-Agent |
| §4 P8 Face | "Rhubarb Lip Sync (MIT)" | MIT plus BSD/Boost/WTFPL third-party notices. 89 MB (70 MB zipped) minimal install, so make it an optional download. Measured 4.6× real-time (pocketSphinx), 11× (phonetic). Pass `-d transcript` |
| §4 P8 / §2.1 | "A sneak walk takes about 12 f per step" used as the walk default | 12 f/step at 24 fps is the **standard** teaching walk (a 24-frame cycle). Make sneak slower by default; keep 12 f as the MDS measurement |
| §4 P8 CC0 libraries | "e.g. Open Peeps" | Add Humaaans and Open Doodles (CC0) and Kenney (CC0). **Source from the original sites, not Blush** (Blush licence forbids redistribution) |
| §4 P8 Stage 2 | "vectorise (vtracer, MIT)" / "the local LTX pipeline" | Use the vtracer **Rust crate** (MIT/Apache). Add Meta **AnimatedDrawings (MIT)** as the licence-safe auto-rig. LTX-2 licence requires a paid licence for entities with ≥ $10M revenue. ToonComposer needs about 57 GB VRAM. **OmniLottie is not licence-safe** |
| §4 P9 | No loudness or mix targets | Add −14 LUFS integrated / −1 dBTP, music ducking −18 to −24 dB under VO, and frame-exact SFX sync to the action |
| §4 P10 / §2.1 | Camera push "about cubic-bezier(0.6, 0, 0.4, 1)" without a named reference; typewriter 30 cps as a universal default | Name the tokens (`easeInOutCubic` (0.65, 0, 0.35, 1); M3 `emphasizedDecelerate` for panels, which is an exact match; M3 `emphasizedAccelerate` for exits). Make `cps` purpose-dependent (UI fill 30; read-along ≈ 12–13 cps ≈ 150 wpm). Add a 150 words/min VO budget |
| §4 P11 Lottie | "No expressions… Unsupported features are rasterised through a bundled lottie-web canvas renderer" | lottie-web canvas has **no merge paths and no layer effects**, and the full build uses `eval`. Use **ThorVG** as the fallback (expressions in WASM via JerryScript, effects, luma mattes, CSP-safe). If lottie-web is used at all, only `lottie_light_canvas` (0 eval, 54.6 KB gz). Neither renders merge paths or twist, so the native converter must |
| §4 P11 LottieFiles | "licence must be checked before offering in-app search" | Checked: **no public API** (staff, 2026-08-28), and the licence forbids compiling or scraping and standalone redistribution. **No in-app search, no bundling**; user-supplied files only. Bundle Noto Animated Emoji (CC BY 4.0) instead |
| §7 Licence table | Missing or incorrect rows | Add GSAP (prohibited use), Spine and Live2D (not usable), Blush (no redistribution), OmniLottie (NC base and data), LTX-2 (revenue clause), useAnimations (CC BY, not MIT), Noto Animated Emoji (CC BY 4.0), Poly Haven API attribution, the GPL bridge script, and the Blender trademark |
