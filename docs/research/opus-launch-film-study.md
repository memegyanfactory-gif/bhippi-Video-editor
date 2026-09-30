# Study: how Claude Opus made the 80/100 "Meet Bhippi" launch film

Date: 2026-09-30. Source: the backup at `C:\Users\aayus\Documents\Bhippi\4\AI Work\meet-opus-2026-09-29`. It holds the `film\*.py` scripts, `ui\*` capture kit, contact sheets, the 23 rendered scenes and `claude-session-532fdf93.jsonl`, the session log (1,462 records, 15:02 to 16:37 UTC on 2026-09-29).

The renderer core `r3d.py` and the Chrome capture script `render.mjs` were not in the backup. Both came from an earlier launch-film session (`agent-workspace\launch_edit\`). Their full sources are quoted inside the session log (`cat r3d.py` at 15:16:42, `cat render.mjs` at 15:05:28), and every number below about them comes from those dumps. The film scripts and scene timings come from the backup files themselves.

Brief given to Opus: "see this video [Relume promo, eQLi_t0X1ZE], I have added a music with VO, make the edit according to it, make the video motion graphic and use the UI from the main product folder, go all out." Song: `Meet Bhippi.mp3`, 106.4 s, -16.2 LUFS integrated, true peak +0.4 dBFS.

---

## 0. The short version

- **Opus did not use Bhippi's motion engine.** It wrote an offline Python 2.5D renderer: 634 lines for `eng.py` plus the reused 413-line `r3d.py`. It also wrote 8 scene scripts (about 1,800 lines, 23 scenes) and a UI kit that rendered **328 part textures at 4x plus 44 window layers at 2x** in headless Chrome, using the app's own compiled CSS and fonts.
- The Bhippi app was used only for word timing (Deepgram through `analyze_clip_speech`), beat confirmation, importing media, laying 23 flat MP4s on V1 plus two SFX stems, lyric captions and frame QA.
- **Wall time was about 95 minutes.**
  - 0 to 20 min: reading, music and lyric analysis, and the reference study.
  - 20 to 41 min: the UI kit.
  - 41 min: the engine.
  - 46 to 76 min: all 23 scenes, each checked on a contact sheet.
  - 76 to 95 min: the full render, assembly, captions and the "made in Bhippi" capture.
- **Full render: 3,192 frames at 1920x1080 and 30 fps, in about 640 s** with 22 worker processes on a 32-core, 64 GB machine (about 4.8 frames per second overall).
- **What made it look premium, in order** (details in section 6):
  1. The real UI, pixel-crisp and alive through many small states.
  2. Every scene timed to a *word*, with cuts on bars.
  3. Continuous camera moves with 8-sample motion blur on every fast move.
  4. Soft shadows and blur-in entrances on every plane.
  5. Seamless scene joins made from camera state, whips and light floods.
  6. Named multiplayer cursors that click with ring pulses.
- Not what we assumed: **no vignette, no bloom, and no film-grain animation.** `vignette()` and `bloom()` are defined in `eng.py` but never called. Grain is one static noise frame (seed 7). Depth of field is used in only two scenes (S03 and S22). The finish is mostly motion blur, soft shadows, per-plane blur-ins, additive glow sprites and white or warm flashes.

---

## 1. Renderer architecture

### 1.1 Layering

```
r3d.py (core, earlier session)   camera, textures + mips, perspective warp of one plane, per-pixel DOF, compositing
eng.py (this film)               music grid, easing helpers, Part/Group, cameras, stages, sprites, cursors, render_spec, post fx
s_*.py (scenes)                  scene(t) -> {'bg', 'planes', 'cam', 'mb', 'post'}   pure function of time
scenes.py                        TABLE of (id, module, fn, start s, end s) on the song timeline
render.py                        sheet / frame / video drivers, multiprocessing Pool, ffmpeg pipes
```

A scene is a **pure function of absolute song time** `t`. No state is carried between frames. This one choice is what makes everything else possible:

- motion-blur sub-samples are just calls to `scene(t + dt)`;
- any frame can be rendered alone for a contact sheet;
- chunks of a scene render in parallel;
- one scene can render another inside itself (S01's zoom-through calls `render_spec(S02, t)`).

### 1.2 World and planes

- **World units = screen px at z=0.** The default camera is `f = 1500` at `z = -1500`, looking at (960, 540, 0), so the z=0 plane maps 1:1 to the 1920x1080 frame (`F0 = 1500.0`). x is right, y is down, z is away from the viewer.
- **A plane** is a dict:
  `{'tex', 'center': [x,y,z], 'rot': 3x3, 'size': [w,h], 'opacity', 'blur', 'order', 'blend': over|add|screen, 'dof': bool, 'post': fn(arr,x0,y0,ss), 'tint'}`.
- **Rotation order** is `rot(rx, ry, rz) = Ry @ Rx @ Rz`, in degrees: roll first, then pitch, then yaw.
- **Sorting:** planes sort by `(order, -camera_depth)`. The explicit `order` is the main layering tool. Cursors use 80 to 92, toasts 95 and 96, the window base 10. Depth only breaks ties inside one order.
- **`Group(c, s, rx, ry, rz, origin)`** maps a local 2D space (for example window CSS px) into the world. Local `(ox, oy)` sits at world `c`, scaled by `s` and rotated. `G.rect(tex, lx, ly, lw, lh, lz, lrx, lry, lrz)` places a child plane.
  - This is how a whole app window tilts in 3D while its sub-layers stay registered: chat bubbles, timeline rows and the composer.
  - It is also how cursors live "on" a tilted panel: pass `cursor(..., group=G, z=-10)`.
- **`Part`** is a Chrome-rendered texture plus its manifest box.
  - `pw, ph` is the texture size in CSS px, content plus padding.
  - `pad = max(0, 40 - box[0])` for 4x parts, because every part sits at page origin 40 px (see 2.3).
  - `put()` and `Group.part(anchor='tl'|'c')` place a part by its *content* box, ignoring the shadow padding.

### 1.3 Plane rasterisation (`r3d.render_plane`)

1. Compute the 4 corners from `center ± w/2·ex ± h/2·ey`. Move them to camera space. Clip the polygon against `NEAR = 4.0`.
2. Project with `x = W/2 + f·c.x/c.z`. The bbox gets a margin of 2 px and is clamped to the frame plus 64 px.
3. **Mip selection.**
   - Texel footprint: `px_per_texel = f·(w/tex_w) / (0.5·zmin + 0.5·zc)`.
   - Step down a mip while `px_per_texel·2^(L+1) <= 1.3`.
   - Mips are BOX-downsampled. `Texture(levels=6)` in eng, down to 32 px.
   - This is why minified UI text stays clean instead of aliasing.
4. **A single homography.** Build `K @ [u v a]`, invert it and pass it to `PIL.Image.transform(PERSPECTIVE, BILINEAR)` over the bbox only. The inverse matrix's third row also gives **1/z per pixel** (`invz`), used for per-pixel DOF.
5. Textures are **premultiplied** (`'RGBa'`) with a transparent 2-texel border (`PAD = 2`), so edges antialias and do not fringe.

### 1.4 Depth of field (`r3d.dof_layer`)

- Circle of confusion per pixel: `coc = 0.5·aperture·f·ss·|invz - 1/focus|`.
- Blur sigma: `sig = clip(coc·0.55 + extra_blur·ss, 0, 32·ss)`.
- **A blur stack, not a per-pixel kernel.** The layer is Gaussian-blurred at `SIGMAS = [0, 1, 2, 4, 8, 16, 32]` (only up to the max needed). Each pixel then blends the two neighbouring stack levels with triangular weights. The sigma map is edge-padded into the blur padding so alpha spills correctly. Padding is `min(3·sigma, 200)`.
- **The same path does "blur-in" entrances.** A plane's `blur` field adds a flat sigma. Almost every entrance uses `blur = 8…14 · (1 - ent)`: 34 call sites across all scene files.
- Camera aperture actually used:
  - **S03** exploded window: `aperture = 7.0 · ex`, with ex being the explode amount.
  - **S22** window recede: `aperture = 8.0 · recede`.
  - Everything else is pinhole. Cursors, glows, shadows and toasts pass `dof=False`.

### 1.5 Motion blur and shutter (`eng.render_spec`)

- Each scene returns `'mb'`, a sample count chosen per time range by hand.
  - 1 for static frames.
  - 2 to 4 for gentle moves.
  - **8 for whips, pull-backs and slams.** `'mb'` appears in all 21 scene returns.
- **Shutter 0.5 (180 degrees).** Sub-sample times are `dt = ((i + 0.5)/n - 0.5)·0.5/30`, which re-evaluates `scene(t + dt)` in full. Cursors, cameras and states all blur correctly.
- **The key performance trick:** when `n >= 6`, every sub-frame renders at **half resolution** (`sub_ss = 0.5`). The average is then BICUBIC-upscaled to 1080p, because the blur hides the resolution loss. `r3d.render` uses the same rule at `n >= 8`.
- `r3d.speed_samples()` can pick n automatically from a probe point's screen speed (`px_per_sample = 6`, 1 to 12 samples). **Opus did not use it** and hand-picked counts instead.

### 1.6 Compositing and post

- Planes composite premultiplied, straight into a float32 RGBA buffer (`_paste`: `over`, `add` with alpha clamped to 1, and `screen`).
- The background is `rgb = acc.rgb + bg·(1 - acc.a)`. It is a precomputed stage or a callable.
- **Per-plane post hooks** see the plane's pixels and their screen x. They are used for:
  - `wipe_post`: timeline rows revealed left to right with a 24 px soft edge;
  - the S06 "power-on" light wave (desaturate plus darken, then a 260 px smoothstep front sweeping x from -300 to 2300, with a 150 px warm rim `[1.0, 0.72, 0.45]·0.22`);
  - the S13 grey-out: luma mix 0.75 for the "other AI" clip.
- Frame post hooks actually used:

| helper | what it does | used |
|---|---|---|
| `flash(rgb, a, color)` | lerp to warm white `(1.0, 0.97, 0.92)` or `(1.0, 0.985, 0.96)` | 12 times: every drop, reveal and bridge |
| `gaussian(rgb, r)` | full-frame blur | S12 out (10 px plus 80% desaturate), S13 in (8 px), S19 in (10 px) |
| `zoom_blur(rgb, amt)` | 6-step radial scale smear | S01 zoom-through, `0.07·bump` |
| `dir_blur(rgb, dx)` | 8-tap horizontal smear | S15 Ctrl+Z hit, 60 px |
| `pixelate(rgb, block)` | box down / nearest up | S01 through-the-letter reveal, 36 px to 1 px |
| `vignette`, `bloom` | defined | **never used** |

### 1.7 Stages (backdrops), `eng.stage(kind)`, cached per kind

| stage | recipe | used for |
|---|---|---|
| `light` | vertical gradient `#F7F5F1 → #EDE9E3` plus an elliptical highlight `#FCFBF8` at (960, 380), radii 1100x700, falloff `(1-r)^2·0.6` | typed line, plan, transcript, brand, outro |
| `grid` | peach `#FCE8DB`; centre lift `#FFF3EA`; edge darken `#F7D6C3`; **vertical hairlines every 16 px (-5.5%) and every 80 px (-5%)** | the window, providers, composer close-ups |
| `cool` | `#F0EFEE → #E6E5E4`, no warmth | the "most AI hands you a clip" contrast beat |
| `dark` | `#0b0605` with a radial ember `#2c1208` at `(1-r)^2.2·0.9` | plug-in, logo reveal |

All stages add static Gaussian grain of `1.1/255` (seed 7). `stage_mix(a, b, u)` crossfades between stages. The S06 `_glow_stage(lit)` warms the dark stage with `#5a2410`, quantised to 20 steps for caching.

### 1.8 Sprites drawn in code (PIL, cached PNG)

- **Cursor arrow:** a 7-point polygon at 4x with a blurred drop shadow (offset (1.2, 2.2), blur 2.6·4), a white outline (width 3.2) and a black inner fill.
- **Other shapes:** click ring (256 px, 10 px stroke), disc, radial glow (`(1-r)^2.4`), rounded rectangle, soft shadow, selection box with corner handles, keycaps (two-tone face gradient `[255,254,252] → [240,236,231]` on a `[214,206,197]` base), plug and cable.
- **Shadows** are generated at half resolution and blurred (`blur·0.5`) for speed. Typical values: `shadow_tex(w, h, r=12, blur=40…70, alpha=0.24…0.34, color=(70, 40, 20))`. The shadow colour is **warm brown, not black**, which is why the shadows look soft on cream.

### 1.9 Performance tricks

1. **Bbox-only warps.** Each plane is transformed only over its projected bbox, and zero-opacity planes are skipped.
2. **Mip-mapped textures** and a per-process texture cache (`_TEX`) plus a part cache (`_PARTS`).
3. **Half-resolution motion-blur sub-frames** at 6 or more samples.
4. **Parallelism:** a `multiprocessing.Pool` with `min(workers·2, frames//6)` chunks. Each chunk pipes raw RGB into `ffmpeg libx264rgb -qp 0 -preset ultrafast` (lossless). The chunks are concatenated and re-encoded `libx264 -crf 14 -preset medium yuv420p +faststart`.
5. **Windows race fixes, learned the hard way:**
   - atomic cache writes (`tmp` then `os.replace`);
   - retry-on-`PermissionError` texture loads (40 tries, 50 ms apart).
6. **Cost:** static scenes run about 0.1 s per frame. Heavy 8-sample or exploded-DOF scenes run up to 0.44 s per frame per worker (S15: 145 frames in 63 s; S13: 121 frames in 8.8 s).
7. **A cache leak to avoid.** Keys built from floats (`shadow_tex(..., blur=26 - 10·press)` in the S15 keycaps) wrote a **new PNG per frame**; `cache\` holds dozens of `shadow_200x194_28_16.00…png`. Quantise sprite parameters.

### 1.10 Easing (`r3d.EASES`, cubic-bezier, bisection 28 iterations)

| name | bezier | role |
|---|---|---|
| `out` | (0.16, 1, 0.3, 1) | entrances, expo-out style (the default for anything arriving) |
| `move` | (0.65, 0, 0.35, 1) | camera glides, cursor travel, state interpolations |
| `sine` | (0.37, 0, 0.63, 1) | slow drifts, crossfades, pull-backs |
| `in` | (0.7, 0, 0.84, 0) | exits and whips out |
| `cubic-in` | (0.32, 0, 0.67, 0) | acceleration into a drop or flash |
| `emph` | (0.05, 0.7, 0.1, 1) | the plug slamming in |
| `back-out` | overshoot 1.70158 | chips, stamps, CTA pop |
| `whip` | (0.8, 0, 0.1, 1) | defined, not used |

Helpers:
- `K(t, (t0, v0, ease), (t1, v1), …)` interpolates keys for scalars or vectors. The camera is always keyed as `[cx, cy, scale, rx, ry]`.
- `ramp(t, a, b, e)` goes from 0 to 1.
- `bump(t, t0, up=0.08, down=0.3)` is a 0→1→0 pulse ('out' up, 'sine' down), used for every press, pop and pulse.
- `path_pos(t, [(t, [x, y], ease, arc)])` moves a cursor with an **arc**: a perpendicular bend of `arc·4u(1-u)` of the segment length. That is why the cursor paths curve instead of sliding in straight lines.

### 1.11 Camera models

- `cam_screen()`: the flat 1:1 camera.
- `cam_orbit(target, dist, rx, ry, roll, aperture, focus, screen_off)`: orbit a target.
- **`cam_view(cx, cy, s, rx, ry, …)`** is the workhorse: "put world point (cx, cy) at the frame centre, magnify the z=0 plane by s, orbit by pitch and yaw". It is `cam_orbit([cx, cy, 0], 1500/s, …)`. Every camera move in the film is a keyed `[cx, cy, s, rx, ry]` tuple. Typical values:
  - establishing tilted window: `s = 0.84, rx = 5, ry = -9`;
  - pre-drop orbit: `s = 0.64, rx = 15, ry = -33`;
  - drop slam: `s = 0.90, rx = 0, ry = 0`;
  - close-ups: `s = 1.85…3.55`.
- **The camera is the edit.** Scene starts and ends are camera states that match across cuts (see 3.14).

---

## 2. The UI capture pipeline

### 2.1 The key idea: rebuild, do not screenshot

Opus did **not** screenshot the running app for the scenes. It **rebuilt each UI component as HTML** using:

- the app's own compiled stylesheet `dist/assets/index-BrM4pdoF.css`;
- the real class names: `.composer`, `.composer-bar`, `.send-btn`, `.picker-trigger`, `.chip-btn`, `.pill.tone-ok`, `.toast`, `.provider-row`, `.thinking-*`;
- markup copied from the real components: `ComposerControls.tsx`, `ProvidersSettings.tsx`, `components/ui.tsx` toasts and `BrandKitSettings.tsx`;
- real copy grepped from `src/lib/permissions.ts` (e.g. "Plan only / Reads the project and answers; makes no edits");
- the provider catalogue (`crates/bhippi-providers/src/catalog.rs`);
- provider SVG paths read straight from `src/components/ProviderLogo.tsx`.

Before writing a single part, it spent about 13 minutes (15:10 to 15:23) grepping the source for exact labels, CSS rules and tokens (`--panel: #232323`, `--text: #dcdcdc`, `--blue: #2d8ceb`…).

Why rebuild: every part then exists **in every state at any resolution**, with a transparent background and nothing else on screen.

### 2.2 The generator (`ui/parts.py`, plus `parts_extra.py` and `parts_extra2.py` exec'd into it)

Python functions return HTML strings, e.g.

```
composer(pid, text, placeholder, caret, provider, effort, effort_top, perm, files, send_hot, width=420)
```

Also: `thinking(pid, fill)`, `permission(pid, chosen, hover)`, `prow(pid, key, state, keylen, saving)`, `toast()`, `plan_card(i)`, `bin_tile(i)`, `transcript(sel, cut)`, `clip_html(kind, w, h, name, thumb)`, `brandkit(default)`, `tag()`, and the display type `txt()`.

Every call is `add(html, name, pad)`, which records a shot `{'name', 'solo': '#id', 'pad'}`.

**States are enumerated in advance, one texture per state.** 328 parts in total:

| family | count | how the states were made |
|---|---|---|
| `cmp_*` composer | 139 | **one texture per typed character** for 4 prompts (`cmp_idea_00…36`, `cmp_story_00…43`, `cmp_next_00…18`, `cmp_cut_00…25`); attachments arriving one by one (`cmp_story_f1…f4`); hot send; empty with Bhippi or Claude picked; permission Plan or Auto; effort Maximum |
| `type_*` display type | 55 | the typed headline `type_l1_01…33` (one per character), wordmark light and dark, word-by-word sublines `type_sub_0…3`, `type_made_*`/`type_madew_*`, keycap labels, tagline |
| `clip_*` timeline clips | 26 | exact widths at 60 px/s, plus pre-split halves (`clip_v_hur_a`/`_b`) for the razor cut |
| `frame_*` brand frames | 18 | 6 frames x neutral, brand, named |
| `think_*` slider | 16 | **Balanced (25) to Maximum (100) with eased in-betweens**: for each of 3 snaps, fills at u = 0.35, 0.62, 0.82, 0.94, 1.0; values written to `think_fills.json` so the engine knows where the knob is |
| `prow_*` provider rows | 16 | need or ready x 4 providers, plus the key field at 4, 9, 14 … 34 dots, plus saving |
| other | 58 | tags (You, Bhippi, Bhippi-wait, Claude, GPT, Gemini, Local, with real logos), permission popover x 5 (incl. hover states), plan cards, bin, transcript (base, sel1, selrun, cut), toasts, stamp, CTA and CTA pressed, big provider tiles, flying doc and memo cards, a "generic Generate" prompt |

- **The whole window** (`ui/win.py`) reuses the earlier film's `gen_ui.py`. That is a full 1920x1040 HTML rebuild of the editor, with string replacements for this film's prompts and steps.
  - It renders **44 window layers at 2x** (`win2`): base, chat bubbles, step cards `c1card_0…4/done`, chips, timeline rows `tlV1a/b/c`, `tlAud`, `tlTitle`, tool states `razorOn`/`pointerOff`, and so on.
  - It also renders **4x crops** for close-ups (`win4`): the chat column, program panel, timeline panel and full window.
- **A special mask:** `big_producer` is the word "producer" rendered alone at scale 1 on a 3800x1200 page (so about 11.5x the headline size) to act as the zoom-through alpha matte.
- Footage textures: `eng.Video` extracts clip frames once to JPEG at 1280x720, 30 fps, and loops them in the program monitor.
- The glass logo was **not** made in this session. It reused a 120-frame Blender render ("BHIPPI mark molten glass v2", 1920x1080 RGBA), trimmed to per-frame bboxes with a 24 px margin (`cache\mark\meta.json`).

### 2.3 The renderer (`launch_edit/ui/render.mjs`, Node plus raw Chrome DevTools Protocol, no Playwright)

- Launches `chrome.exe --headless=new --remote-debugging-port=<9300..9700> --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none --allow-file-access-from-files`.
- Calls `Emulation.setDeviceMetricsOverride {width, height, deviceScaleFactor: 4}` and `setDefaultBackgroundColorOverride {a: 0}`, which gives transparent PNGs.
- Loads the page, then waits for `document.fonts.ready` plus 300 ms.
- **Per shot:**
  1. Reset `body.className`.
  2. Run the optional `setup` JS.
  3. **Solo mode:** `body.solo *{visibility:hidden}` plus `.solo-t{visibility:visible}` on the selector. Only that part is visible and the layout does not change.
  4. Measure `getBoundingClientRect` (union over matches), grow the box by `pad`, then `Page.captureScreenshot {clip: box, scale: 1}`.
- Writes `manifest.json` with `{box, cx, cy}` per part, in CSS px. An optional `measure` JS returns more rects: the window manifest records `#field`, `#send`, `#viewer`, `#chat`, `#program`, `#timeline`, `#c1card` and so on, so scenes aim cursors at real element coordinates.
- Speed: 301 to 328 shots in about 60 to 90 s.

### 2.4 How parts were measured and verified

- The engine reads each part's `box` from the manifest. `Part.pad` recovers where the content sits inside the padded texture.
- For S01, it printed content widths per typed prefix (`type_l1_17` = 459 px, `_25` = 725 px, `_33` = 930 px). It then computed the anchor **inside the stem of the "d"** in the big mask (`ANCHOR_BIG = (1490.5, 236)`, scale `K_BIG = 760/66`). Its note: "the stem of the d in producer is 9 px wide, needing about 260x zoom to fill the frame" (the code uses 270).
- It verified parts on **contact sheets** of 16 to 24 parts (`parts_sheet*.jpg`) after every render.
- **Bugs found this way, with the fixes:**
  1. **Sora fell back to a serif.** The CSS `@font-face` used `/assets/...`, which does not resolve over `file://`. Fix: re-declare Sora, Inter and Archivo with absolute `file:///D:/Bhippi%20Video%20editor/dist/assets/*.woff2` URLs.
  2. **32 parts rendered at 1x inside the 4x canvas.** Root cause: a shadow pad larger than 24 px pushed the screenshot clip origin negative, and Chrome then silently captured at 1x. It was found with an automatic scan: any PNG whose alpha bbox is under 45% of its size in both axes. Fix: parts at page origin **40 px**, and `Part.pad = 40 - box[0]`.
  3. **PIL has no raqm (no kerning).** So **all display type is rendered by Chrome**, never by PIL.

### 2.5 The one real capture

S22 "This film was made in Bhippi" is a **real `PrintWindow` capture** of the running Bhippi window after the film was assembled: 1936x1048, cropped to 1920x1032. The film's own 20 highlight frames play in its program monitor.

Opus cleaned the capture before using it:
- painted over a chat row that showed a local path;
- moved the pixel mascot off the transport;
- rebuilt the ruler ticks and two transport icons from an earlier capture;
- re-measured the monitor rectangle by thresholding (`MON = (624, 113, 744, 419)`).

---

## 3. Scene recipes as reusable patterns

All times are song seconds. The beat is `60/99.03 = 0.6059 s`, with `beat(n) = 0.456 + n·0.6059` and `bar(m) = beat(3 + 4m)`.

### 3.1 Type-on synced to the voice (S01 0.0–8.7; also S07, S09, S20)

- Per-word typing that **starts on the word onset from Deepgram**, with a per-character step of about 46 to 66 ms: `_typed(2.96, 'An ', 0.06)`, `(3.20, 'editor ', 0.066)`, `(5.76, 'with ', 0.058)`, `(6.08, 'a ', 0.06)`, `(6.32, 'producer ', 0.046)`, `(6.72, 'inside.', 0.05)`. These times equal the transcript word times.
- An `assert` checks that the character count equals the event count; it caught an off-by-one on the first run.
- **The line re-centres as it grows.** `left = 960 - smooth_w/2`, where `smooth_w` averages the typed width over the last 7 frames at 22 ms spacing. This smooths the jump per character.
- Caret: 4x62 px. It blinks at 1.65 Hz with 58% duty, and stays solid for 0.35 s after each key.
- Two cursors share the job.
  - "You" types the first half.
  - "Bhippi" flies in along an arced path (`arc = -0.12`) and **finishes the sentence** from under the line.
  - Bhippi then drags a **selection box** across "producer" (7.26 to 7.52, 'move') with a 5% `bump` pop.
- "producer" is set in the molten gradient `#ff2d1a → #ff6a1a (55%) → #ffb347`.
- Variants:
  - S20 types "Make my next video" on exact word onsets 86.89, 87.13, 87.37 and 87.61.
  - S07 and S09 type across a span (`k = (t - TY0)/(TY1 - TY0)·n`).

### 3.2 Fly through a letter into the app (S01 7.62–8.70)

1. Z0 = 7.62, Z1 = 8.62. Zoom `s = exp(ln(270)·(0.35u + 0.65u^2.2))`, which starts fast and then accelerates hard.
2. The anchor moves from the "d"-stem to the frame centre with a 'sine' ease.
3. The rest of the line fades out over 0.16 s. Cursors fade out 0.05 to 0.25 s after Z0.
4. The "producer" alpha comes from the pre-rendered 11.5x mask. A mip level is chosen, then an affine warp is applied, so it is not a scaled rasterised headline and stays razor sharp.
5. Inside the letters, the molten gradient crossfades (8.04 to 8.34, 'sine') to **a live render of the next scene** `render_spec(S02, t)`, **pixelated from 36 px blocks to 1 px** (8.06 to 8.50). The gradient spans the word's current screen extent.
6. A radial zoom blur of `0.07·bump(8.05, up 0.25, down 0.4)`.
7. S02 begins in the same composer close-up (`s = 3.55`), so the letter "opens" onto the app.

**This recipe was lifted from the reference.** Relume, 3.5 to 8 s: "Then **grows** it." The word is selected by a named cursor, grows, and pixelated imagery fills the letters.

### 3.3 Cursor demo with clicks (S02, S05, S07, S09, S11, S16, S17, S23)

- `cursor(kind, x, y, t, clicks=(…), s, group, z, order)`:
  - arrow plus a **name tag** placed at (+14, +25)·s: You (blue), Bhippi (orange), Claude, GPT, Gemini, Local, each with a real logo;
  - press: scale `1 - 0.14·bump(click, 0.05, 0.22)`;
  - ring: diameter 16 → 86 px over 0.5 s ('out'), opacity `(1-u)·0.9`, orange, or white for "You".
- Idle life: `± sin(t·1.3)·2 px` jitter. Parked cursors bob `5·sin(t·1.3 + phase)`.
- Paths use `path_pos` with 'out' arrivals, 'move' travel and arcs of ±0.08 to 0.12.
- On a click, **the target swaps state on the same frame**.
  - Composer: `cmp_cut_25` → `cmp_cut_hot` (send glow) 0.18 s before the click, then empty after the send.
  - Chat: a bubble slides up 520 px over 0.4 s.
  - The steps card ticks `c1card_0…4` at 13.12, 13.52, 13.92 and 14.32.
  - A **green connect halo** rings the picker when Claude connects (40 → 200 px over 0.9 s).
- Close-up then push: in S05 the camera pushes into the key field to `s = 1.85` (23.05 to 23.62, 'sine') while dots appear at 7 key times 23.50 … 24.34. It holds, then returns to `s = 1.0` for 25.25 s.

### 3.4 Provider rows flip on the words (S04/S05, 16.815–26.51)

- Four cursors named Claude, GPT, Gemini and Local fly in from off-screen with arcs. They **arrive on their word**: Claude at 18.59 (the transcript's "Claude"), GPT at 19.95, Gemini at 22.30 and Local at 22.90. Each row lifts (scale +1.2%, z -10, plus a shadow) while its cursor is there.
- **All four flip to "Ready" on the echo "(hand) it the key"** at 25.07, 25.31, 25.55 and 25.82: a pop of 3.5% plus a green ring 20 → 140 px. These are the transcript's word times for "it", "the" and "key".
- The whole panel is a `Group(s=1.52)` with a slow wobble `rx = 3 + 1.2·sin(0.7t)`, `ry = -5 + 2·sin(0.45t + 1)`, so it is never dead-still.
- Entry on the drop: the panel scales 1.10 → 1.00 and blurs 12 → 0 over 0.42 s. A warm flash of 0.5 decays over 0.28 s.
- A toast slides in from +420 px (25.30 to 25.72).
- Exit: a whip right (camera x 952 → 1950 over 26.05 to 26.51, 'in', 8 samples).

### 3.5 Window pull-back into 3D (S02 11.75–14.39; S12 53.30–54.20)

- Camera keys in S02 as `[cx, cy, s, rx, ry]`:

| t | cx | cy | s | rx | ry | ease to next |
|---|---|---|---|---|---|---|
| 7.80 | 236 | 878 | 3.55 | 0 | 0 | out |
| 9.30 | 236 | 872 | 2.75 | | | sine |
| 11.75 | 238 | 862 | 2.55 | | | move |
| 12.60 | 236 | 330 | 1.75 | 2 | 5 | sine |
| 12.95 | 236 | 322 | 1.72 | | | move |
| 14.391 | 960 | 520 | 0.84 | 5 | -9 | |

  So the camera starts close on the composer, glides up the chat, then **pulls back to the whole window tilted `rx 5, ry -9` at 0.84 scale**.
- While it pulls back, the app works: timeline rows wipe in left to right (`wipe_post`, 13.35 to 14.1 and 13.7 to 14.39), and footage fades into the program monitor.
- Motion blur is 8 on the glides and 3 on the drift.
- The window has a big soft shadow: `shadow_tex(1920, 1040, r=24, blur=70, alpha=0.34)`, offset +26 px.
- S12 repeats the move from the program-monitor close-up at `s = 2.30` out to `0.86, rx 4, ry -7` for the "complete" line.

### 3.6 Exploded panels (S03 14.39–16.815, the pre-drop)

- The window is re-cut into 9 panel textures from its 2x base: header, chat, program, props, project, tools, timeline, meters and status.
- Each panel gets a z-offset: `LZ = back 520, header 300, chat -420, program 120, props 300, project -170, tools -70, timeline -280, meters 170, status -110`.
- Each panel also spreads outward by `(panel centre - window centre)·0.075·ex`.
- `ex = ramp(14.45, 15.95, 'move')·(1 - ramp(16.38, DROP, 'cubic-in'))`. It explodes over 1.5 s, holds, then **slams back together in the last 0.43 s before the drop**.
- The camera orbits from `[960, 520, 0.84, 5, -9]` to `[960, 540, 0.64, 15, -33]` (16.30, 'cubic-in'), then to `[960, 520, 0.90, 0, 0]` at the drop.
- Aperture `7.0·ex` gives real depth of field between the layers.
- Motion blur is 6 on the slam. A warm flash of 0.55 fires at the drop (`bump(DROP - 0.02, 0.02, 0.18)`).
- While exploded, a status chip pops in (back-out) and a title clip appears on the timeline.
- Note: this first came out "too subtle". The fix was to deepen the z offsets, add the 2D spread and double the orbit.

### 3.7 Power-on light sweep (S06 26.51–29.40)

- The window sits on the dark stage at 0.8 scale (`rx 4, ry 7`).
- A PIL-drawn plug and cable slam in from the left: `lerp(-1100, -178, ramp(26.62, 27.41, 'emph'))`, plus a 14 px bump. It lands exactly on the sung "in" at 27.41.
- An additive orange glow expands 160 → 860 px over 0.55 s.
- A **light wave** sweeps across every window layer (27.95 to 29.10, 'sine') from 24% brightness and 25% saturation to full, with a warm rim at the front. The backdrop warms as `lit` rises.
- Exit: a warm flash of 0.55 (29.22 to 29.40, 'cubic-in') while the camera plunges into the composer (`s = 2.6`), which is exactly where S07 opens.

### 3.8 Real control, real state: the Thinking slider (S07 29.40–33.78)

- The composer sits at `s = 2.35` with a tilt that settles (`rx 6 → 2`, `ry -8 → -2 → 1.5`).
- The idea is typed over 29.57 to 31.35.
- The cursor clicks the effort chip at 31.64. The popover opens (0.16 s, scale 0.94 → 1, rising 10 px).
- The knob **snaps through 3 levels on the beats** ("turn it up"). The snaps are 32.08–32.20, 32.48–32.60 and 32.86–32.98, each playing its 5 eased in-between textures. The cursor follows the knob position read from `think_fills.json`.
- The camera pushes in to 1.38x on the popover.
- Send at 33.47: the composer sinks (blur 16) and the send button becomes an additive glow point. It drifts to the centre and grows 60 → 320 px while the stage crossfades to dark. That glow point becomes the logo reveal.

### 3.9 Logo reveal and lockup (S08 33.78–37.40; S21; S23)

- The glow contracts 300 → 90 px (33.78 to 34.1, 'out'). The Blender glass mark then plays on "Meet" (34.05), with its frames remapped to the vocal:
  - frames 0 to 12 over 34.05 to 34.45;
  - a jump to 51 to 63 over 34.45 to 34.85 (the slide into the lockup);
  - then 72% speed to frame 119.
- The wordmark lands at 34.58 to 34.95: from -70 px, blurred 14 → 0.
- The subline is **word by word on the transcript times** 34.77, 34.93, 35.25 and 35.73 ("The AI video editor.").
- An ember halo (900 px, additive) breathes on `bar(14)`. There is a slow push of +3.5%.
- Exit: a **light flood**. The camera pushes +10%, the stage goes from dark to light, and a flash of 0.85 to near-white (37.05 to 37.40, 'cubic-in') hands off to S09, which opens on a flash decaying 0.85 → 0.
- S21 lockup on "on Bhippi": scale 0.86 → 1.0 and blur 10 → 0 over 0.34 s, the wordmark 0.08 s later from -50 px.
- S23 end card:
  - lockup at 0.78 scale, 150 px up;
  - the tagline at +0.36 s;
  - the CTA pill back-out at +0.70 s;
  - the "You" cursor clicks the CTA at 103.35 (pressed texture, flattened orange ring);
  - a continuous 3% push to the end, and a 12% fade to the stage over the last 0.5 s.

### 3.10 Attachments fly into the prompt; the plan is dealt on eighths (S09 37.40–42.40)

- 4 cards (doc, memo, aurora, storm) fly from the four frame corners with rotations of ±10 to 14 degrees. Each flight is 0.30 s ('in'), shrinking 1.35 → 0.16 onto their chip slots with a sideways sine swing of 120 px. They land at 37.62, 37.78, 37.94 and 38.10, and each landing swaps the composer to `cmp_story_f1…f4`.
- The story is typed; send at 39.95. The composer drops to the bottom (`s` 2.05 → 1.25).
- Plan header at 40.20. Then **5 beat cards are dealt at 40.30, 40.60, 40.91, 41.21 and 41.51. That is a 0.303 s step, exactly an eighth note.** Each card rises from the composer (960, 930) to its slot on an arc of 90 px, scale 0.35 → 1.5, rotation ±16 → 0, landing with a 3% pop. The Bhippi cursor clicks each card down.
- Exit: the camera pushes to 1.55x with 6-sample blur.

### 3.11 Media landing in the bin, with live audio bars (S10 42.40–46.90)

- Tiles fly in from the right (x 2150, scale 2.4 → 1.46, 0.42 s 'in') onto the bin panel (tilted `ry 9 → 6`). They land at 42.72, 42.87, 43.02 and 43.17 (0.15 s apart, sixteenths), with music at 43.60 and voice at 44.80. Each landing gets an orange ring (60 → 280 px).
- A hero card on the right cycles shots, then music, then voice. The music and voice bars are **driven by the actual song RMS envelope** (`song_env()`: 60 Hz hop, normalised to the 98th percentile) and redrawn every frame.
- Exit: a vertical whip (camera y +700, 'cubic-in', 8 samples).

### 3.12 Cut on the words, snap on the beat (S11 46.90–51.20)

- A transcript panel (top, `s = 1.62`) and a timeline strip (bottom) slide in from ±400 px.
- The cursor selects a word (47.36), extends the selection over a run (47.84), then clicks Cut (48.30). The transcript swaps `tr_base → tr_sel1 → tr_selrun → tr_cut` (struck through).
- On the timeline, a blue selection follows the words. At the cut, white razor lines flash for 0.35 s, the removed segment lifts 60 px and fades, and **later clips ripple left** by the gap (0.12 to 0.46 s, 'out').
- Beat markers drop onto the ruler in a 35 ms stagger from 49.30.
- A playhead sweeps.
- The Bhippi cursor clicks on `beat(78…85)`, and three clip edges snap 6 to 12 px onto `beat(81)`, `beat(82)` and `beat(83)`.

### 3.13 Contrast beat and build (S13/S14 56.40–62.86)

- "Most AI hands you a clip":
  - cool grey stage;
  - a generic "Generate" prompt;
  - a plain untagged cursor clicks at 57.70;
  - **one grey clip** (luma mix 0.75) drops in and lands on the word "clip" at 58.42.
- "Bhippi hands you the whole timeline":
  - the Bhippi cursor swoops in and grabs the clip at 60.97;
  - the card morphs into the first V1 clip (61.10 to 61.42, 'move'; texture swap at u = 0.55; grey 0.75 → 0 as the stage warms from cool to light);
  - then **23 clips cascade onto 6 tracks at 52 ms steps** from 61.40 (each 0.14 s, scale 0.8 → 1). The code comment says "sixteenths", but a sixteenth here is 0.151 s, so this is about three per sixteenth: a flurry, not a grid.
  - The camera pulls back and tilts to `[960, 620, 0.66, 12, -22]` with a flash into the chorus drop at `bar(25) = 62.862`.

### 3.14 Scene joins (the seamless feel)

Every cut is hidden inside motion or light. There are six mechanisms:

1. **Matching camera state across the cut.** S14 ends at `[960, 620, 0.66, 12, -22]` and S15 starts at `[960, 560, 0.70, 12, -22]`. S02 ends where S03 starts, exactly `[960, 520, 0.84, 5, -9]`.
2. **Plunge into the next scene's subject.** S06 ends at the composer (`s = 2.6`), and S07 is the composer. S15 ends with the camera on the composer (`[236, 880, 2.3]`), and S16 is the composer.
3. **Whips with 8-sample blur:** S05 → S06 (x +1000), S10 → S11 (y +700), S11 → S12 (x -700), S16 → S17 (x -900).
4. **A light point becomes the next scene:** S07 send glow → S08 mark; S20 send glow → S21 lockup.
5. **Flash bridges:** warm-white flashes of 0.5 to 0.9 at the drops (16.815, 62.862), at 37.40 and at 101.638.
6. **Blur bridges:** S12 fades out as a 10 px blur plus desaturation, and S13 fades in from an 8 px blur. S19 opens from a 10 px blur.

Opus checked every join on a 6-frame strip at 0.06 s spacing across each cut (`review_cut*.jpg`).

### 3.15 Other patterns worth templating

- **Keycaps (S15 "every move you can undo"):** Ctrl and Z keycaps rise 420 px on the bar (65.28 to 65.62), are **pressed on "undo" (`beat(108)` = 65.89) and again on the echo (67.05)**, with a 10 px press, an orange ring flattened to 0.55 and a 60 px horizontal smear. The timeline row **reverts on the same frame** (`tlV1c → b → a`), and a "reverted" chip pops in.
- **Permission popover (S16):** the cursor hovers Plan, then Full, then Plan, then picks it. A waiting Bhippi cursor bobs `3·sin(2.2t)`.
- **Brand kit (S17/S18):** the swatches answer one by one (0.15 s apart, rings in each swatch's own colour). Then six frames change look (0.15 s stagger) with a **light sweep** (an additive glow crossing each frame in 0.3 s). Later they re-layout from a right-side grid to a centred grid and fly outward (radial x1.8, scale x1.6) as the exit.
- **Hub and spoke (S19 "Connect your AI"):** the Bhippi tile pops in (back-out, scale 1.9). Four provider tiles fly in on the words (83.83, 84.02, 84.22, 84.47). Orange wires draw from each tile to the hub over 0.32 s. Glow pulses travel in along the wires (3 per wire, 0.42 s apart). The hub pulses on 85.05, 85.45 and 85.85. Everything squeezes into the centre (86.10 to 86.70) behind a flash.
- **Made-in-Bhippi (S22):** the real capture flies in from z = 2600 with `ry 30 → -5` over 0.95 s. The film's highlights cycle in its monitor every 0.36 s. A statement lands word by word on eighths after `bar(38)`. The camera glides along the real timeline (`s` → 1.85) between `bar(39)` and `bar(40)`, then recedes with depth of field (`aperture 8`).

---

## 4. Syncing to the music

### 4.1 Analysis Opus did itself, before trusting any tool

1. **Vocal isolation** (`audio\center.py`):
   - STFT with N = 4096 and hop 1024 on the stereo mix;
   - centre-panned similarity `2·Re(L·R*)/(|L|²+|R|²)`, smoothed over 3 frames;
   - mask = `sim^10`, band-limited to 140–7500 Hz;
   - reconstructed by overlap-add to `vocal_est.wav`.
2. **Deepgram on the isolated vocal.** The plain mix only transcribed the spoken lines; the sung verses were missed.
   - It placed the vocal on a muted A2 track, ran `analyze_clip_speech`, then deleted the clip and the media.
   - It also cut 21 s and 47 s segments and remixed vocal plus 35% mix (`seg_36_83_voc.wav`) to recover verse 2 and the chorus. The transcript had "Tell it your story" at 38.0.
   - **Deepgram mis-hears sung lyrics** ("chlord" for Claude, "Gentlemen, I love" for "Gemini, local", "Bipy", "Lens on the beach"). Opus used the *timings* and supplied the correct words itself.
3. **Its own beat grid:**
   - spectral flux (N = 1024, hop 128 at 22.05 kHz, log magnitude, detrended by a 64-frame average);
   - an exhaustive search over BPM 98.00 to 100.00 in 0.01 steps and phase in 4 ms steps, maximising flux at beat times;
   - result: **99.030 BPM, phase 0.4560 s**;
   - a per-section residual check (median -0.005 to +0.003 s) proved the grid held for the whole song.
4. **Section energy per bar** (RMS and a low band) showed the structure:
   - intro about -25 dB;
   - **drop at 16.84** (-18 dB);
   - pre-chorus dip at 55 to 62 (-22 to -25 dB);
   - **chorus drop at 62.90** (-15 dB);
   - outro dip at 82 to 90;
   - final drop at 91.99;
   - stop at 101.69.
5. **Cross-checked with Bhippi's `analyze_music_beats`:** 98.95 BPM; drops at 16.8, 62.88, 89.53 and 91.95; stop at 101.65. It matched its own grid and noted so in the log.

### 4.2 Sync rules it followed

| layer | rule | examples |
|---|---|---|
| **Scene boundaries** | Section changes on **bars**; mid-section cuts on **lyric line starts** | `bar(6)` = 16.815, `bar(13)` = 33.78, `bar(24)`/`bar(25)` = 60.44/62.86, `bar(27, 29, 31, 33)`, `bar(37)` = 91.94, `bar(41)` = 101.64; line cuts at 22.0, 29.40, 37.40, 42.40, 46.90, 51.20, 56.40, 86.70, 90.30 |
| **Hero actions** | On the **word** (transcript onset) | provider arrivals, all four Ready flips on "it the key", plug on "in", mark on "Meet", sublines, captions on "Captions 51.39", clip lands on "clip", tiles on "Connect your AI", send on "on", lockup on "Bhippi" |
| **Repeated actions** | On the **grid subdivisions** | plan cards on eighths (0.303 s), bin tiles on sixteenths (0.15 s), statement words on eighths, beat markers and Bhippi clicks on `beat(n)`, slider snaps on beats, Ctrl+Z on `beat(108)` |
| **Echoes in the song** | Get a second hit | "(hand it the key)" → Ready flips; "(undo)" → second keypress at 67.05; "(clean and complete)" → verified stamp and export toast |
| **Drops** | Slam plus flash plus heavy blur on the downbeat; the build before it accelerates with 'cubic-in' | S03 explode then slam, S14 pull-back then flash |
| **Breathing** | Slow pushes of 3 to 4% and halo pulses on bars during holds | S08 halo on `bar(14)`, S23 push |

### 4.3 Sound design as part of sync

- `sfx.py` builds one **UI sound stem** from Bhippi's built-in SFX (`%APPDATA%\...\sfx\*-v2.wav`). It holds **98 events**, each placed on the exact frame of its on-screen action (typing beds sliced to the typing length with an 80 ms fade; click, pop, tick, swish, shimmer, glass, ding, key, sub).
  - Levels: -13 to -27 dB (typing -25, ticks -20 to -24, key hits -13). Peak 0.186.
- A second stem of 16 transition accents: whooshes -15 to -17 dB, risers -17 before both drops, shimmer -15 on the reveals.
- The song was trimmed 1 dB for headroom (from +0.4 dBFS true peak).
- **Stems instead of about 110 clip placements.** The reason was an `apply_edit` pitfall: audio `place` ops ignored their track and **overwrote the song on A1**. Opus caught it with `get_comp`, undid it, added A3 and V2 explicitly, and placed the two stems with `place_clip {audioTrack}`.

---

## 5. Working process

### 5.1 Timeline of the session (UTC)

| time | step |
|---|---|
| 15:02 | Read its memory notes (earlier launch film, engine pitfalls, "user wants real app UI and the real 3D logo"). Recovered a 23-beat plan from a project backup, because the live project had been reset. |
| 15:03 | Frame size asked (`choose_comp_size`, 16:9). Transcript of the mix. |
| 15:04 | Reference at 2 fps as 5 contact sheets (48 cells each, 0.5 s per cell). Read them all. Summary: "light stage, multiplayer cursors, growing text, a prompt box pulling in files, and the site building itself". |
| 15:06–15:16 | Vocal isolation, sung-lyric timing, the beat-grid fit, section energy. |
| 15:16 | Read `r3d.py` and decided to reuse it as the core. |
| 15:18–15:23 | Grepped the app source for the exact UI: composer, effort slider, permission modes, provider catalogue, CSS tokens, brand kit, toasts. |
| 15:26–15:42 | UI kit: parts.py, then 220, 228, 301, 321 and 328 parts, with 4 part contact sheets. Found and fixed the font fallback. |
| 15:43 | `eng.py` written in one go (then extended with `Video` and footage textures). |
| 15:47–16:17 | Scenes written in 6 batches. **Every scene was rendered as a 4- to 9-frame contact sheet and looked at before moving on** (about 30 sheet reads). |
| 16:18 | S01 full render (261 frames in 27 s), then the other 21 scenes in the background with 22 workers. |
| 16:19–16:28 | Meanwhile: the todo file, SFX stem, beat cross-check, LUFS, review-sheet tool, cut reviews, assembly script. |
| 16:30–16:35 | Import, place 23 scenes, fix the A1 overwrite, stems, 31 lyric captions. Caption style tried Glass, iOS Chip and Slate Card; position fixed through `run_frame_qa`. |
| 16:35–16:37 | Real window capture for S22, cleanup, monitor measurement, final S22 render. |

### 5.2 The self-review loop

1. Write the scene.
2. Render `sheet <S> t1…t9` at the times where something happens (not evenly spaced).
3. Read the image.
4. Write a one-line diagnosis.
5. Apply a targeted Python string patch (`assert old in s; s.replace(old, new)`).
6. Re-render the sheet.

It then reviews joins after the full render using frames decoded from the MP4s, not re-rendered, which verifies the encoded output.

**What it changed after looking at frames:**

| scene | saw | fixed |
|---|---|---|
| S01 | zoom felt linear; the reveal came too early | zoom curve to `0.35u + 0.65u^2.2`; reveal mix to 8.04–8.34; pixelation 36 → 1 over 8.06–8.50 |
| S02 | a sliver of the old composer visible; 2 s of empty glide; motion-blur ghosting on the pull-back | added the "Cut my clips on the beat." typing beat (new prompt, re-rendered parts); re-keyed the camera; retuned motion-blur ranges |
| S03 | "The window comes apart a bit too subtly" | deeper z offsets, the outward panel spread (0.075), stronger orbit (to `rx 15, ry -33`) |
| S05 | push-in framed the wrong spot; ghosting | camera target from the group's key-field point `Gp.pt(262, 186)`; cursor save-click coordinates |
| S06 | plug did not reach the window; the "off" window too dark | plug moved into window space so it meets the edge; brighter off state; warm flash exit |
| S07 | popover placement; static framing | popover anchored above the chip; camera push to 1.38x on the slider |
| S08 | wordmark overlapped the sliding mark | wordmark delayed from 34.42 to 34.58, and it now enters from -70 px instead of +40 |
| S11 | layout too small | both groups scaled 1.45/1.12 → 1.62; clips re-centred; Cut-click position |
| S12 | "Verified" stamp missing | debugged plane sizes, found the texture wrong, which led to the 1x-render root cause (2.4) |
| S13 | whole scene tiny | same 1x bug. An automatic scan found 32 affected parts; fixed globally |
| S16 | waiting cursor clipped at the edge | new park position |
| S18 | frames grid ran off the right | grid origin and spacing reduced |
| S23 | mark collided with the tagline | lockup -150 px, tagline at y 648 |
| Captions | too big and high; Glass too faint on light stages; chip box misaligned when scaled | +0.155 y offset, no scale, Slate Card style |

### 5.3 Habits worth copying into our AI workflow

- **Measure before animating.** Content widths, anchors inside glyphs and element rects come from the DOM (`measure`), and cursor targets come from the manifest. Screen positions are never guessed.
- **Assert the plan against the data** (the character count against the typing events).
- **Contact sheets at event times, not even times.** Nine frames chosen at the moments that matter caught almost every problem.
- **Scan outputs automatically** (bbox/size ratios) once one bug suggests a class of bugs.
- **Render in the background while doing the next job** (SFX, captions, assembly).
- **Verify tool side effects** (`get_comp` after `apply_edit`) and undo at once.

---

## 6. What made it look premium, ranked

1. **The real product, crisp, in many states.** Every part came from the app's own CSS and fonts at 4x. There were 139 composer states and 16 slider states, and the texture swaps on the frame of each click. Mips keep minified text clean. It reads as a real screen recording shot by a camera, not as a mock-up. *This is the biggest single difference from our output.*
2. **Word-level sync.** Every hero action lands on a transcript word onset. Cuts land on bars, repeated actions on eighths or sixteenths, and echoes get second hits. The viewer feels the edit "hearing" the song.
3. **A continuous camera with honest motion blur.** Moves go through `[cx, cy, s, rx, ry]` keys with brand easings ('out' arrive, 'move' glide, 'in' exit). There are 8 sub-frame samples at a 180-degree shutter on every fast move, and camera moves stay small (tilt 2 to 9 degrees, scale 0.84 ↔ 3.55) except on the drops.
4. **Soft depth everywhere, cheaply.** Warm-brown soft shadows sit under every card (alpha 0.24 to 0.34, blur 24 to 70). **Every entrance blurs from 8 to 14 px to sharp** while scaling 0.9 to 0.94 → 1 and rising 10 to 30 px. Real depth of field appears only where layers truly separate (S03, S22).
5. **Seamless joins.** Camera-state matches, plunges into the next subject, whips, glow-point handoffs, and flash or blur bridges on drops (3.14). No hard cuts are visible.
6. **Named multiplayer cursors as the narrator.** You, Bhippi and each AI provider have their own tag, arc paths, idle jitter, a press dip and click rings. The story ("you connect, Bhippi works") is told by who moves the mouse. Taken from the reference and made product-specific.
7. **Light, warm stages with texture.** Cream and peach gradients with 16 px/80 px hairlines, a dark ember stage for reveals, and a cool grey stage only for the "other AI" contrast. Static grain of 1.1/255 kills banding.
8. **Signature transitions borrowed from the reference, recast in the product:** the zoom through a letter into the app (Relume's "grows"), the prompt pulling in files, and the UI assembling itself.
9. **The real 3D glass mark,** reused from Blender, time-remapped to the vocal, with an ember halo.
10. **Sound on every action:** 98 UI events plus 16 transition accents, 13 to 27 dB under the song.

Why 80 and not higher (inferred from the artifacts):
- The deliverable is **23 flat MP4s**. Nothing is editable in Bhippi afterwards.
- The window was an HTML rebuild from an earlier film. The "Orbit film" project name and props panel are left over from the old film, not this project.
- Some beats are dense and fast (the 52 ms cascade, text-heavy provider rows at speed).
- There is no vignette, bloom or grain animation.
- The lyric captions are app captions on V2, not designed into the scenes.
- The glass mark was pre-existing, not made for this brief.

---

## 7. What this means for our engine

Our engine already has a head start on several of these pieces:
- **UI screens:** `src/motion/ui/spec.ts` with `data-part` parts, typed text, click with ripple, `hover-lift`, `zoom`, `state` and `drag`;
- a **3D camera with depth of field** (`type: 'camera'` with `aperture`/`focus`/`dof`);
- **scene motion blur** (`motionBlur: {samples, shutter}`);
- `threeD` layers, `typeOn` and SFX `cues`.

The gaps are in fidelity and in the recipes, not in basic primitives:

| Opus technique | our engine today | what to build |
|---|---|---|
| Parts rendered by real Chrome at **4x** with the app's compiled CSS and fonts, one texture per state | `ui/raster.ts` rasterises through **SVG foreignObject** at `resolution` 2 (default); one screenshot for captures | 4x option; a **per-part state list** (`states: {name: html}` per part, not only per page) rendered through the same path; a font-loading check (Opus hit a serif fallback) |
| Typing by texture swap per character, **on transcript word onsets** | `type` action at 30 cps from a start time | `type` with `words: [{text, at}]` from `analyze_clip_speech`; a re-centring line option |
| Named multiplayer cursors (tag, logo, arc path, idle jitter, press 14%, ring 16→86 px/0.5 s) | one cursor (`arrow | hand | dot`) | `cursors: [{id, label, color, logo}]` with actions addressed to a cursor; arc paths |
| Camera keyed as `[cx, cy, s, rx, ry]` over a **tilted UI group**, with pull-back from a part to the whole window | `zoom` action (push to a part and back) and `place.tilt` | camera paths in UI space: `{t, target | point, zoom, tilt}` keys with ease names |
| **Motion-blur samples per time range**, half-resolution sub-frames when samples ≥ 6 | scene-wide `motionBlur` | per-range samples, or auto from screen speed (`speed_samples`: 6 px per sample, 1 to 12); half-resolution sub-frames |
| Exploded window (per-panel z plus 2D spread plus aperture) that slams on the drop | not available as a recipe | an `explode` action over named panel parts: `{depths, spread: 0.075, slamAt}` |
| Through-the-letter reveal (glyph matte, zoom 270x, gradient → next scene, pixelate 36→1, zoom blur) | not available | a template taking a word, a glyph anchor measured from the DOM and the next scene |
| Blur-in entrances (8–14 px → 0) and warm soft shadows | partly (effects) | defaults for every UI part entrance |
| Flash, whip and camera-match joins between scenes | not available | join presets that read the outgoing scene's last camera state |
| Beat and word grid (99.03 BPM fit, eighths, sixteenths, echoes) | `analyze_music_beats` and speech | a sync helper that snaps action times to `{word | beat | eighth | sixteenth | bar}` |
| SFX on every action as one stem | `cues` and `sfx: 'ticks'` | emit a cue per click, type, pop and flip automatically; mix into a stem at -13 to -27 dB |

**Suggested 15 s test** (the user's next step): the intro S01 → S03 (0 to 16.8 s) is the best benchmark. In about 15 s it contains type-on to voice, the fly-through-letter, a cursor demo with clicks, the tilted pull-back and the exploded slam on the drop. Recreate it with Bhippi's engine alone, then compare against `film\out\S01–S03.mp4` frame for frame at the same song times (`review.py` style strips at 0.06 s around 7.6 to 8.7, 11.7 to 14.4 and 16.3 to 16.9).

---

## Appendix: file map

- Engine: `film\eng.py` (cameras 199–222, stages 234–273, cursor 397–432, `path_pos` 433–452, `render_spec` 489–520, post helpers 523–571, `wipe_post` 622).
- Core: `launch_edit\r3d.py` (source only in the session log, `cat r3d.py` result at 15:16:42).
- Scenes: `s_intro.py` (S01–S03 plus `window_planes`, `PANELS`), `s_verse1.py` (S04–S07), `s_reveal.py` (S08), `s_verse2.py` (S09–S12), `s_twist.py` (S13–S14), `s_chorus.py` (S15–S18), `s_outro.py` (S19–S21, S23), `s_made.py` (S22).
- Scene table: `scenes.py`. Placement: `out\placement.json`. Named clips: `Documents\Bhippi\Untitled project\Renders\Meet Bhippi\`.
- UI kit: `ui\parts.py`, `parts_extra.py`, `parts_extra2.py`, `win.py`, `jobs_*.json`, `out4\manifest.json` (328 parts), `win2\manifest.json` (44 layers plus measured element rects), `think_fills.json`, `clips.json`.
- Audio analysis: `audio\center.py`, `spec.py`, `grid.npy`; SFX: `film\sfx.py`.
- Reference sheets: `ref\sheet_0…4.jpg` (Relume promo, 2 fps).
