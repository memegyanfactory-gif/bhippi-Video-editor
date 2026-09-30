# Film lab: crimson-explainer

Date: 2026-09-30.

**The experiment.** Claude Opus, at max effort, made a 15-second Bhippi explainer that imitates the "Crimson Brief" reference ("If You ONLY Watch One Motion Design Video, Make It This…", 11m45s). It did not use Bhippi's motion engine. It wrote its own HTML/CSS compositor, drove it with headless Chrome, and finished the frames in numpy.

**What this document is for.** It reconstructs how the film was made, then turns every technique into a building block that Bhippi's engine (`src/motion`) should own. The AI can then make this film again from editable layers, at a fraction of the tokens, and a user can open any layer and change it.

| | file |
|---|---|
| Version 1 (critic: 68/100) | `C:\Users\aayus\Documents\Bhippi\Film lab\Renders\crimson-explainer-v1.mp4` |
| Version 2 (scored here) | `C:\Users\aayus\Documents\Bhippi\Film lab\Renders\crimson-explainer-v2.mp4` |
| Maker's folder, notes, round-1 critique | `C:\Users\aayus\Documents\Bhippi\Film lab\crimson-explainer\` (`BUILD_NOTES.md`, `critique-round1.md`) |
| Reference | `%APPDATA%\com.bhippi.videoeditor\refs\01m3h9tvjssvz8jmycz72y4f34\ref.json` → `Downloads\If You ONLY Watch One Motion Design Video, Make It This....mp4` |
| My review sheets | `docs/research/film-lab/crimson-explainer-sheets/` (v2 at 10 fps, v2 key frames at half resolution, the reference at 10 fps and every 2 s over 0–120 s, spectrograms). The `ref_*` files are git-ignored. |

---

## 0. Summary

- **Scores.** Version 2 scores **75/100** on the critic's rubric. Version 1 scored 68 and the reference scores 80. The maker estimated 77 for itself.
- **What moved the score.** The hook now follows the reference beat for beat, and the drop is a clean hero frame. Pills read. The white Characters stage is gone. The title collisions are gone. There is sound from frame 0.
- **What still costs points:**
  - It shows eight features in about 12 s of voice-over.
  - The presenter is a cartoon on a generic talk loop.
  - Three transition windows are busy for 3–5 frames (8.70 s, 10.00 s, 12.40 s).
  - The mark's half-open "bowl" shape shows for 3 frames before each landing.
  - One label pill is left floating on its own (10.9–11.2 s).
- **How it was made.** It took about 4.3 h of wall clock (round 1: 00:34–03:25, round 2: 03:36–04:58). The maker wrote about **4,450 lines of bespoke code**:
  - a 1,060-line DOM compositor
  - a Tauri shim that boots the real React UI in a plain browser, plus a "world" builder
  - scripted UI and character captures
  - a numpy post stage
  - a VO editor, a music re-editor, an SFX fetcher and auditioner, and a mixer
- **Coverage in Bhippi today.** **44 building blocks** fall out of this film:
  - 10 already exist in Bhippi's engine, some of them because the kit was itself modelled on this very reference: word cascades with dim-to-bright, text behind the subject, `card-wall-3d`, whip and recede transitions, `{word}` timing, edge glow, ducking and loudness.
  - 25 exist in part. Among them are `subject-reveal`, `frame-to-card`, the `crimson-stage` procedural, `node-tree`, `capture_product_ui`, the grain, glow and chromatic-aberration effects, and the `character` layer.
  - 9 are missing.
- **Most valuable blocks to add:**
  1. Real-app capture, scripted and DOM-aware, with part states. This produced every card in the film.
  2. A **product card + label pill** pair, with a sheen and "attach to" behaviour.
  3. A **finish preset** with adaptive motion blur.
  4. A **mark rig** (split a logo into parts, then open, clack, think and pulse on beats).
  5. A **hub-and-wires** integration template.
  6. A **UI state-reveal** (a timeline or panel fills in the order the AI made it).
  7. Audio tools that place a word on a beat and re-cut a song to the film.

---

## 1. Score: version 2 against the reference

Method: the critic's rubric and its ten criteria, 0–10 each.

What I looked at:
- **Version 2:** all 150 frames at 10 fps (`v2_10fps_*.jpg`), 24 half-resolution key frames at every transition and hero moment (`v2_keyframes_*.jpg`), and the per-frame mean luma.
- **The reference:** 0–15 s at 10 fps and 0–120 s every 2 s.
- **Both:** EBU R128 loudness and spectrograms.

I also checked the problem frames the critic listed for version 1.

| Criterion | v1 (critic) | **v2** | Ref | Evidence for v2 |
|---|---|---|---|---|
| Premium look and light | 7 | **7.5** | 8 | The Characters stage is now dark crimson: luma 28–39 through 10.0–11.5 s, where v1 measured 88–99. Grain is lighter and bitrate fell from 42 to 29.5 Mb/s. The glass mark, rims and bloom are rich. Against that, the grey hook plate (luma 74–80) is a blurred editor, not a room, and reads as a smear. The Program monitor's aurora and the white composer are the only true highlights. |
| Faithfulness | 7 | **8** | 10 | The hook now matches the reference: plate → first word at 0.27 → pop-in with red echo at 0.46 → second word → hold to 1.02 → one shrink into a **centred** card → rest → park bottom-left on "Just connect". Pills are filled crimson at 42 px. Two things are still missing: the reference's *second hook line* under the first ("is not difficult"), and the montage of small cards flying in around the shrunk card (ref 2.5–5 s). The presenter is a cartoon, not a cut-out person. |
| Camera and depth | 7 | **7.5** | 7 | 3D Y-rotations on every card landing, a tilted timeline slam, and whips. The world drift keeps holds alive. It is still "cards on a plane" with no real depth of field between layers. The 11.4 s whip (heavy blur) and the 5.1 s whip are honest camera but ugly stills. |
| Typography | 7 | **8** | 8 | No stacked titles anywhere. "Music" sits left and "Sound effects" is centred. Inter 610 with Fraunces italic accents lands grey→white word by word. "and even" is still small (84 px against 118–150 px), and the tagline is 68 px. The hook words no longer strobe. |
| Sync | 8.5 | **8.5** | 7 | The drop (1.668), the slam (6.516), "music" (8.941) and the jingle (12.577) all land on the frame. Word onsets drive every title. The 18 razor flashes run 0.052 s apart on a 30 fps grid, which means some cuts share a frame. |
| Clarity | 6.5 | **7.5** | 8 | Every pill reads in full for 0.58–0.68 s. The composer prompt is legible (6.1 s). The dark Characters stage reads. Eight features still ride on about 12 s of VO, with music and SFX at about 0.45 s each. Provider version text and panel labels are tiny at 1080p. |
| Transitions and flow | 6.5 | **7.5** | 8 | The drop is now clean: the card has already rested and the mark lands beside it. The single move into "All automatically." works. Three moments stay busy. At **8.70–8.80 s** the monitor flies up blurred while "Music" lands blurred and the strip rises tilted. At **10.00–10.10 s** the SFX strip leaves, an empty badge ring lingers and a blurred thumbnail whips in. At **12.40 s** the editor recedes, the title leaves and Kai drops, all at once. |
| Polish | 6 | **7** | 7.5 | The v1 smears, empty pills, grey block and cropped Kai are fixed. New or remaining issues: for 3 frames before each landing (1.57–1.64 s and 12.48–12.55 s) the mark's halves, rotated ±62–75°, form a "U"/bowl that reads as a broken logo. The "Animated characters" pill stays alone in empty space after the window whips off (10.95–11.25 s). An orphan ring hangs at the top right at 10.05 s. |
| Originality | 7.5 | **7.5** | 7 | This is unchanged and is still the film's best idea. The edit it shows is one Bhippi really performed through its own tool executor. The mark "thinks" and clacks, and Kai jumps out of the real Characters window. |
| Audio | 7 | **7.5** | 7 | Sound starts at frame 0 (first 0.25 s: −31.6 dB RMS; v1: −81 dB). A CC0 recorded kit replaced the synth SFX, with 53 cues against 87. Loudness is −14.1 LUFS, −0.9 dBTP, LRA 1.1 LU. The reference's first 15 s measure −14.2 LUFS and LRA 1.2 LU, so dynamics match. The spectrogram shows full band to about 16 kHz and a dense broadband wall from 11.3 to 12.5 s (break, riser and impact). The mix was levelled by measurement and never heard. |
| **Overall** | **68** | **75** | **80** | The criteria sum to 76.5. As the critic did for version 1 (sum 70 → 68), I take a little off for the unheard mix and the busy frames. |

**Verdict.** Version 2 is a clearly better film than version 1. Its first three seconds are now close to the reference and its end card is its cleanest stretch.

It stays below the reference for three reasons:
- It is a product teaser wearing a talking-head grammar. The reference's own notes say the look is "the wrong look for a product film" without a speaker.
- It packs a list of eight into 12 s.
- Its presenter is a cartoon on a generic talk loop.

The remaining craft faults are all 3–5 frame windows. Section 5 lists how to remove them.

---

## 2. How the film was made (reconstruction)

### 2.1 Pipeline, in the order it ran

| # | Step | Tool (maker's folder) | What it produced |
|---|---|---|---|
| 1 | **Study the reference** | ffmpeg | 240 frames at 2 fps over 0–120 s and 120 frames at 10 fps over 0–12 s, tiled into sheets; 11 stills; `ref.json` notes. The written reading is in BUILD_NOTES §1. |
| 2 | **Transcribe** | `transcribe.py` (faster-whisper small.en, word timestamps), `vo_probe.py` | Word onsets. Where Whisper was more than 40 ms off, the onset was corrected against a 10 ms RMS envelope (e.g. "Bhippi" 10.90 → 10.69 s). |
| 3 | **Beat grid** | `beatgrid.py` | 99.00 BPM (bar 2.4242 s), by comb-scoring a kick + spectral-flux onset envelope. |
| 4 | **VO edit** | `r2_vo_edit.py` | Nine phrases from the ElevenLabs "Liam" VO (src 9.40–23.10 s), cut inside silences below −45 dB, with 8 ms equal-power joins and `atempo=1.06`. A 0.30 s pre-lap is inserted between "weapon," and "Bhippi". The whole edit is placed so "Bhippi" starts **exactly on the music drop at 1.668 s**. Output is `words_film.json`, every word's film time. **These numbers are the constants at the top of `comp2/comp.js`.** |
| 5 | **Music bed** | `r2_music_bed.py` | A reverse swell from 0.000 to 1.668 s, then outro groove bars 1–4 from 1.668. Details are in §2.4. |
| 6 | **Footage for the fake project** | `gen_footage.py` | Six clips made from Bhippi's bundled CC0 wallpapers, with thumbnails, filmstrips and waveform peaks in Bhippi's own format (`src/lib/peaks.ts`). |
| 7 | **Boot the real UI with no desktop shell** | `tools/node/tauri_mock.js`, `fileserver.mjs` (port 5288), `build_world.py` | A fake `__TAURI_INTERNALS__` with invoke, callbacks, events (honouring unlisten, for StrictMode) and the asset protocol. A "world" JSON supplies an active licence, settings, a project "Northern Trip", a library, four connected providers and the Quick-edit workflow. |
| 8 | **Make the app do a real edit** | `tools/node/sc_edit.mjs` (puppeteer-core + Chrome) | Types the prompt into the real composer and captures 34 typing states at 3x. Presses Enter. Streams an assistant reply over `bhippi://chat`. Issues **51 real tool calls** over `bhippi://tool-call`: `place_clip` ×20, `add_marker` ×13, `add_text`, `add_captions`, `add_sound_effect` ×13, `update_clip` and others. The app's own executor runs them. Screenshots are taken at every stage at 2x, along with the Providers tab and the Program monitor scrubbed through the AI's title (37 frames at 15 fps, through the app's own `playhead` module). |
| 9 | **Presenter** | `sc_char.mjs`, `sc_charui.mjs` on `public/characters/room2d.html` | Kai, restyled with the wardrobe's own swatches. Talk, Wave and Celebrate are captured at 30 fps and 3x on a transparent background (85 + 73 + 85 PNGs) by seeking the page's own scrubber. The whole Characters window playing Wave is captured too (73 frames at 1.5x), plus the same window with the stage empty. |
| 10 | **Derived assets** | `prep_assets.py`, `prep_assets2.py`, `prep_echo.py`, `r2_plate.py`, `r2_darkstage.py` | Details are in §2.3. |
| 11 | **Compose** | `comp2/comp.js` + `comp.css` | Every layer is built once. `render(t)` sets each layer's transform, opacity, blur, mask and src as a **pure function of film time**. `seek(t)` renders, waits for image decodes and two animation frames. |
| 12 | **Render** | `render.mjs`, `r2_render.ps1` (4 Chrome workers) | Each frame first asks `window.samples(t)` how many sub-frame samples it needs. That frame's samples are then taken as PNG screenshots across a 180° shutter. 2,758 samples for 450 frames; about 70 s per full render. |
| 13 | **Post** | `r2_post.py` (4 processes, about 5 min) | Linear-light average of the samples, bloom, chromatic aberration, vignette and grain. Details are in §2.3. |
| 14 | **Sound design and mix** | `r2_sfx_fetch.py`, `r2_sfx_audition.py`, `r2_mix.py` | 52 CC0 candidates were fetched from Openverse/Freesound and "auditioned" by envelope, attack, bandwidth and spectrogram, because the session had no audio out. 19 were kept. 53 cues were placed on the compositor's own times, then mixed and loudness-normalised in two passes. |
| 15 | **Encode** | `r2_encode.py` | x264 slow, CRF 18, 40 Mb/s VBV cap, High@4.1, tune film, aq-mode 3, BT.709 tags through x264-params. AAC 320k, faststart, exactly 15 s. |
| 16 | **Review loop** | `keysheet.py`, `postsheet.py`, `r2_review.py`, `sync_check.py` | Sheets at half resolution (every 3rd frame), full-resolution key frames, 10 fps sheets of every encode, a hook-vs-reference sheet, problem frames v1 vs v2, and per-stem sync checks (strongest attack within ±120 ms). |

### 2.2 Shot by shot (film seconds, from `comp2/comp.js`)

The global layers sit under every shot.

- **Field.** A vertical gradient: `#0a0203 → #120305 (30%) → #2a060b (52%) → #5d0b17 (74%) → #8f1224 (90%) → #a8182d`.
- **Corner glows.** Two 1500×1100 pink-crimson radial glows at the bottom corners. They breathe ±12% at 1.1–1.3 rad/s and drift ±90 px on smooth noise.
- **Light band.** A 2800×560 band at y 1020 that drifts ±260 px.
- **Top shade.** A 380 px darkening at the top.
- **Motes.** 28 seeded bokeh motes, 8–54 px, rising 10–44 px/s and twinkling. Half are blurred 2–7 px.
- **World drift.** Everything that floats sits in a "world" group that drifts ±5 px / ±4 px and ±0.25°. It holds still otherwise, and pushes in 4.5% over the end card.

| t | Shot / beat | Layers and moves (parameters) |
|---|---|---|
| **0.00–1.02** | **Hook: room + presenter + words** | **Plate** (`plate2`): rack focus 0–0.30 s (blur 12→0 px, brightness 0.78→0.88); slow push, scale 1.12→1.085 over 0–1.1 s, plus 26 px lateral drift. **Red bloom**: 1500×1300 radial, screen-blended at (960,560). It is already at 40% at frame 0, swells to 100% over 0.3–0.9, adds a Gaussian pulse (σ 0.12 s) as Kai lands, and dims 30% during the shrink. **Words**: "My secret" right-aligned to x=772 and "weapon" from x=1150, at 126 px, y 290, with a dark bed plus a soft glow (`.hooktext`). They land on VO onsets 0.272, 0.385 and 0.593. **Kai**: head at (960,350), scale 0.58, a ping-pong Talk loop (drawings 10–74 at 30 fps). He pops at **0.46 s**: a top-down mask wipe over 0.18 s, scale 1.16→1 on a spring (3.2 Hz, ζ 0.5), a 10 px drop, and a crimson rim glow. **Echo**: two crimson silhouettes of his alpha (blur 3 px, `rgb(255,34,58)`, screen) start at −96/+96 px. They converge over 0.26 s and burn off from 0.56 to 0.80 s. **Frame pre-push**: 1→1.025 over 0.3–1.02 s. |
| **1.02–1.62** | **Shrink into a centred card** | One move with bezier (0.45, 0, 0.12, 1), a gentle gather and a long settle. Scale 1.025→0.37, centre (960,540)→(960,712). The corner radius grows to 24 screen px. The hairline rim, red glow and shadow fade in over 1.12–1.55 s. The words ride inside the card. |
| **1.568–2.30** | **Drop: mark lockup** | **Mark**: the glossy logo split into B, left half and right half. It appears 3 frames early (1.568) at 1.15×280 px, is opaque in 2 frames and has blur of 4 px or less. Its halves shut from 62° to 0° on an ease-in **exactly at 1.668**. After the beat it clacks: open(u) = −9°·e^(−7u)·sin 26u, size 1 + 0.06·e^(−8u)·cos 20u. The B springs 0.62→1 (3 Hz, ζ 0.5). The lockup sits at (742,312). **Wordmark** "Bhippi", 150 px, weight 700, letters landing at 1.70 + 0.035·i and leaving from 2.16. **Flash**: a 2× frame radial, e^(−t/0.06) × 0.72, centred on the mark. **Ring**: 200 px, scale 1.6→10.6 over 0.55 s, opacity 0.85→0. **Card kick**: y + 6·e^(−9u)·sin 30u, scale −1.2%. |
| **2.26–2.80** | **Card parks as the PiP** | inOut to (250,918), scale 0.20, on "Just connect". The hook words leave from 2.20. The mark travels to the hub (800,548), size 280→196, over 2.26–2.70 s. |
| **2.43–3.98** | **"Connect your *AI*"**: providers wired into the mark | **Four real Providers rows** (864×96 capture, ×0.84) at x=1393, y = 378/474/570/666. Each starts at t0 = 2.52 + 0.11·i: x from +760 px with `out` over 0.5 s, a spring (2.2 Hz, ζ 0.62) from scale 0.86, rotateY −38°→0 through 1900 px perspective, and blur 12→0 over 0.24 s. A sheen sweeps it at t0 + 0.3. **Wires**: cubic Béziers from the hub to each row, drawn by stroke-dashoffset over t0 + 0.14…0.42, with a node dot at the end. **Light**: dots run from each row into the mark on a 0.42 s loop, starting on "providers" (3.189 − 0.1 + 0.05·i). The Claude row pulses (Gaussian, σ 0.18 s, +4% scale, rim glow up). **Mark "thinking"**: halves 7±3° apart, turning 48°/s, plus an 8% pulse on "providers". **Type**: "Connect" / "your *AI*" (128 px, with AI in Fraunces italic at 150 px) on the left. **Pill** "Bring your own AI" at (1393,752) from 2.76 s, words 0.04 s apart. **Scene**: push 1→1.035; it exits left 1150 px with blur 12 on an ease-in over 3.68–3.98 s (the whip). |
| **3.80–5.28** | **"Upload your files"** | **Project panel** (633×873 capture, ×0.78) from x 1960→1330, with `out` over 0.55 s, rotateY −40°→−6°, a spring (2 Hz) and blur 14→0. **Five thumbnails** fly on quadratic Béziers from off-frame top-left. Each starts at ts = 3.96 + 0.085·i and moves over 0.42 s with `out3`, scaling 2.1→1 and spinning (−24 + 7i)°→0 with blur 6→0. They land with a spring (3.2 Hz, ζ 0.45) from 1.18× and hand over to the panel's own thumbnails, which are uncovered at landing. **Pill** "Project files" from 4.08 s. **Exit**: 1400 px left, blur 16, over 4.96–5.28 s. |
| **4.96–6.58** | **"Describe the *edit* you want."** | **Composer card** (1326×402 capture, ×0.88) enters from x 2400→1000 (inOut 4.96–5.28), rotateY −34°→0. **Typing**: 34 real typing captures advance every 0.0305 s from 5.17 s, so the prompt types in 1.03 s. **Send**: a press at 6.29 (−1.8%), and an orange ring scaling 0.5→4 over 0.21 s. **Working state**: six real "working" captures at 20 fps from 6.33. Scene push 3.5%. The words exit at 6.28. The scene zooms out ×1.5 with blur 18 over 6.40–6.58 into the slam. |
| **6.44–7.72** | **Bar 3 (6.516): timeline slam, "Bhippi cuts the *footage*"** | **Timeline card** (2003×873 capture, ×0.84 × 0.92). Over 0.22 s it goes scale 1.32→1, rotateX 26°→13°, rotateY −14°→−6° and blur 18→0, then dollies x 1010→930. **V1** is revealed clip by clip: 18 cuts at 6.60 + 0.052·k, as clip-path insets over the "finished" capture. A white-hot razor line at each cut decays e^(−t/0.07) and scales Y 1.3→1. **Pill** "18 cuts, on the beat" 6.66–7.72. |
| **7.70–8.80** | **"adds motion graphics"** | **Program monitor** card (2140×1067 capture, ×0.6) rises out of the timeline: y 760→404 with `out` over 0.42 s, rotateX 34°→0, a spring from scale 0.8. It plays the real monitor scrub (33 captures at 15 fps) of the AI's title "CHASING LIGHT" and a Hormozi caption. The **V3/V4 rows wipe in** on the timeline over 7.94–8.36 s. The timeline settles lower (×0.86, rotateX +9°). "Motion" / "graphics" land on the left. **Pill** "Titles, captions, Kai" is attached under the monitor (y = monitor bottom + 38 px) and leaves with it. |
| **8.66–9.38** | **Bar 4 (8.941): "Music"** | **A1 strip**: the ruler + A1 row cropped from the final timeline (1688×184, ×0.94). It lifts out from y 900→456, rotateX 28°→0, and pulses +3% with a red glow on the three beats from 8.941. "Music" is 150 px on the left and exits from 9.13 s over 0.12 s. The timeline behind shrinks 12% and rises 22 px, and its header is dimmed to 90%. |
| **9.18–10.02** | **"Sound effects"** | **SFX strip** (A2/A3 crop) rises to y 424. The A2/A3 rows wipe in on the timeline over 9.25–9.62 s. **Four badges** pop at 9.29 / 9.47 / 9.62 / 9.74 s (spring 3.2 Hz, ζ 0.42, scale 0.2→1, a ring expanding ×3.4 over 0.45 s), each on a different sound. "Sound effects" is centred at 128 px. One **pill** "Music + 13 sound effects" covers 8.84–9.86 s. The timeline recedes over 9.86–10.24 s. |
| **9.88–11.06** | **"and even animated characters": match cut into the real Characters window** | **Match cut**: the PiP, already tinted crimson, whips back from x −260 with the `whip` ease (0.55, 0, 0.12, 1) and blur 10. It grows so that *its* Kai lands exactly on the window's Kai. The scale 0.2465 was measured from head anchors and heights in both captures. The window then **crossfades in around him** over 0.10 s (10.16–10.26). **Window**: 2880×1620 capture, ×0.42, relit dark (§2.3), playing Wave. "and even" is 84 px and "animated characters" 118 px, centred at the top. **Pill** "Animated characters" 10.34–11.26 s. **Kai jumps out at 10.70**: his head travels an arc from the window to (1590,424) over 0.34 s, lifted 120 px at mid-point, with a spring scale (2.6 Hz) to 0.40. He plays Celebrate drawings 0–12, then an arms-up pump between drawings 32 and 36 with the top on every beat. Two crimson echoes trail at (90,70) and (170,140) px and fade over 0.1–0.5 s. The stage is swapped for the empty stage at 10.70. The **window whips off right** over 10.85–11.03 s (1750 px, rotateY −18°, blur 18). |
| **11.38–12.50** | **"All *automatically*."** | **Finished editor** (3840×2160 capture, ×0.36) enters from x −820→960 over 11.38–11.72 s (`out`), rotateY 22°→0, blur 10→0. So the camera "keeps panning" the way the window left. It then pushes 6% with a small 3D tilt over 11.8–12.3 s. A dark radial scrim sits behind the line. "All" is 156 px and "automatically." 176 px Fraunces italic. Kai stays as the continuous foreground element. **Exit**: the title rises out from 12.26 s. The editor recedes ×0.76 with blur 10 and fades over 12.28–12.50 s. Kai drops 700 px over 12.28–12.50 s. |
| **12.477–15.00** | **Jingle downbeat 12.577: end card** | **Mark** at (960,356), 350 px, the same landing (1.15×, 2-frame fade-in, blur ≤4, halves 75°→0 on the downbeat), then a clack of −10°·e^(−6u)·sin 24u. **Heartbeat**: on the jingle's next three beats (every 0.606 s) the halves part +6° and clack shut, with +1.8% size and a glow lift. A masked **specular sheen** crosses the mark over 13.25–13.95 s. **Backdrop**: six real cards drift far behind at 26% opacity, blur 8–13 px, rotateY ±18°, with parallax drift. **Type**: "Meet **Bhippi.**" (150 px) and "The AI video editor" (68 px, grey (120,112,112) → (226,220,218)) land on the sung syllables 12.654 … 14.354. **Camera**: the world pushes in 4.5% over 12.62–15.0 s. |

### 2.3 Techniques and their parameters

**Motion vocabulary.** Every move is one of these:

| Name | Definition | Used for |
|---|---|---|
| `out` | cubic-bezier (0.16, 1, 0.3, 1) | weighted arrival: fast start, long settle; most entrances |
| `out3` | (0.33, 1, 0.68, 1) | file arcs |
| `inOut` | (0.65, 0, 0.35, 1) | parks, pushes |
| `whip` | (0.55, 0, 0.12, 1) | gather then snap: whips, match-cut grow |
| `in` | (0.5, 0, 0.9, 0.35) | exits, pre-beat approach |
| `exit` | (0.4, 0, 0.8, 0.55) | prompt word exits |
| `shrink` | (0.45, 0, 0.12, 1) | the hook's frame-to-card |
| damped spring | f = 2–3.2 Hz, ζ = 0.42–0.62 | every landing with overshoot |
| "clack" | −A·e^(−k·u)·sin(ω·u) | a damped sine after a shut |

**Word landing** (`wordState`). It runs per word at the VO onset t0:
- opacity: in over (t0 − 0.04, t0 + 0.12) with `out`
- rise: 34 px, over (t0 − 0.04, t0 + 0.30)
- blur: 16→0 over (t0 − 0.04, t0 + 0.20)
- scale: 1.06→1
- colour: grey (138,131,131) → white (247,243,241) over t0 + 0.07…0.36
- exit: 0.24 s with the `exit` ease, rising 26 px and blurring +12 px
- type: Inter at weight 610 and tracking −0.038em; emphasis words in Fraunces italic 380 set about 16% larger
- glow: drop-shadow 9 px white at 28% plus 26 px crimson at 22%

**Label pill** (`applyPill`, `.pill`):
- **Look:** 42 px tall (3.9% of the frame), radius 21, gradient `#e7233e → #c3122c`, Inter 600 at 22 px white, a 1 px top highlight, a 22 px red glow and a 26 px drop shadow.
- **Body:** springs in (2.8 Hz, ζ 0.6) from scale 0.78, fades in over 0.10 s, de-blurs from 6 px, and rises 14 px.
- **Words:** reveal from 0.10 s after the pill starts, 0.03–0.05 s apart, each over 0.12 s (rising 7 px and de-blurring 4 px).
- **Exit:** 0.16 s ease-in.
- **Attachment:** it can ride another layer, positioned relative to the monitor.

**Card** (`card`, `.card`):
- **Frame:** radius 12–22 px, `box-shadow: 0 0 0 1.5px rgba(255,92,110,.42), 0 0 34px rgba(255,28,52,.38), 0 34px 90px rgba(0,0,0,.62)`.
- **Landing:** a spring from scale 0.86–0.9, rotateY −34…−40° → 0 through a 1900 px perspective, blur 12–14→0 over 0.24–0.26 s, and opacity in over 0.12–0.14 s.
- **Sheen:** one 0.55 s sweep (a 115° gradient at 10% white, screen-blended) after it lands.

**Progressive state reveal.** Several app captures are stacked in one card: before, after cuts, after captions, after SFX, after Kai. Each later state is revealed with `clip-path: inset()` over its rows, in the order the AI made it: V1 clip by clip, then V3/V4, then A2/A3, then V2. This turns five screenshots into a timeline that "fills as the AI edits".

**Mark rig.**
- **Split:** the logo is split with a flood fill of connected components on its alpha: the B island, the left half-ring and the right half-ring. Each mask is grown 3 px, softened 1.2 px and normalised, so the parts re-assemble seamlessly.
- **Motion:** the halves rotate ±open° about the centre and part by 0.9·open px. This is Bhippi's own `BhippiMark.tsx` grammar: open while thinking, swing shut when done.
- **States:** land (open → 0 on a beat), clack (damped sine), think (7–10° apart, turning 48°/s), heartbeat (+6° on a beat) and sheen (a masked gradient sweep).

**Flash + shockwave.** The flash is a radial at twice the frame size, screen-blended and placed on the landing point, decaying e^(−t/0.06). The ring is a 3 px border with inner and outer glow, scaling ×1.6 → ×10.6 over 0.55 s with `out`.

**Echo.** The subject's alpha is blurred 3 px and filled `rgb(255,34,58)`. Two copies are screen-blended, offset ±96 px (hook) or (90,70) / (170,140) px (jump). They converge over 0.24–0.4 s and burn off. The first try (a 22 px mosaic) read as a jagged rim and was dropped.

**Match cut by measured anchors.** The maker measured the head anchor and height of Kai in the cut-out (1733 px tall) and in the window capture (1017 px at ×0.42). The PiP's end transform is solved so that both Kais coincide. The target window then crossfades in around the subject in 0.10 s.

**Relighting a UI capture** (`r2_darkstage.py`).
- The Characters window was captured twice: with Kai, and with the stage empty (the known background B).
- **Matte:** Kai is matted by a = max(hard diff > 8 eroded 2 px, the luminance coverage of his dark outline).
- **New background D:** crimson `(46,12,21)` → `(82,18,34)` with v^1.3, a soft light behind him, the lilac floor turned into a pool of light, and the dark ink turned light.
- **Composite:** `out = F + (1 − a)·(D − B)`.
- **Result:** the stage mean luma fell from 227 to 28.

**Hook plate** (`r2_plate.py`). The finished editor is cropped around the monitor and timeline, blurred 24 px, desaturated to 42% and tone-lifted 0.10 + 0.90·x^0.58 into a mid-grey "room" (mean luma 95). A soft radial falloff and a vertical lift finish it.

**Adaptive motion blur** (`window.samples`).
1. Render the shutter's open and close instants (±0.25 frame at 180°).
2. Take the on-screen box of every visible image, word, card, pill and ring.
3. Take the largest corner travel d.
4. samples = ceil(d / (4 px + 0.6 × the layer's own CSS blur)), clamped to 2–64.

The result was 2,758 samples for 450 frames: median 2, 49 frames at 16 or more, and a maximum of 63 (the editor whip). A fixed 24 still showed ghost copies on whips and rings.

**Post** (`r2_post.py`):
- Linear-light (γ 2.2) average of the samples.
- Bloom: soft-knee luminance threshold (0.42, width 0.5, squared) at ¼ resolution, two Gaussian radii (3 px at ¼, 6 px at ⅛), added back ×0.36 with a warm tint (1, 0.78, 0.80).
- Radial chromatic aberration: R ×1.0011, B ×0.9989 about the centre.
- Vignette: 1 − 0.16·r^2.4.
- Grain: generated at half resolution, 2 px clumps, amplitude 0.003–0.008 weighted to mid-tones. Per-pixel grain had cost 86 Mb/s.

**Determinism.** Every layer is a pure function of t, so any frame renders alone. Fixes re-rendered only frames 231–267, twice.

### 2.4 Sound, reconstructed

| Layer | How | Parameters |
|---|---|---|
| VO | ElevenLabs "Liam" source, nine segments, silences trimmed, `atempo 1.06`, a 0.30 s pre-lap | "My" lands at 0.272 and "Bhippi" exactly at 1.668 (the drop). Everything after is keyed to `words_film.json`. The VO fades out 12.40–12.53 before the sung jingle. |
| Music | "Meet Bhippi.mp3", 99 BPM | **Reverse swell** 0–1.668 s, built from the drop's own first 0.9 s through a synthetic 2.2 s noise reverb. It is reversed, its envelope flattened by its own 60 ms RMS and reshaped to 0.22 + 0.78·u^1.7, with a 20 ms fade-in, so it is in key and audible from frame 0. **Groove bars 1–4** (song 91.32–101.02 s) are placed at 1.668 + n·bar. Each join is snapped to the measured transient (±40 ms, cut 6 ms early, 8 ms crossfade). **Break**: two beats at 11.365, low-passed 12 kHz→500 Hz with gain falling to 0.45. **Jingle bar** "Meet Bhippi, the AI video editor" (song 33.76 s) at 12.577, with a +2 dB high shelf at 10 kHz and `aexciter` (6–18 kHz). |
| SFX | 19 CC0 recordings (Openverse → Freesound), 53 cues | **Anchoring**: hits are anchored on their measured onset (the first point within 12 dB of the peak), whooshes on their envelope peak (where the move is fastest), and reverse whooshes and risers on their end. **Pan**: whooshes are panned with the camera move. **Big hits**: drop = whoosh + boom (−8 dB) + sub (−14) + glass ting (−24); slam = reverse whoosh ending on 6.516 + thump (−9); jingle = reverse riser (its last 1.1 s) + cinematic impact (−7) + ting. **Razor run**: 18 snips, three single transients cut from one recording, at −24 dB. **Others**: pops pitched up a scale for the provider rows (0/2/4/7 semitones) and the files; four different sounds for the four SFX badges; a boing as Kai jumps; a click on Send; a typing bed. |
| Mix | numpy + ffmpeg | **Music**: −5 dB bed, ducked up to −7 dB by an envelope follower on the VO (30 ms attack, 280 ms release). It rises to 0 dB for the jingle from 12.45 s. **SFX**: dips −3 dB under the voice. **VO**: +1.5 dB. **Master**: two-pass `loudnorm` to −14 LUFS / −1 dBTP. The delivered file measures −14.1 LUFS, −0.9 dBTP, LRA 1.1. |
| Sync check | `sync_check.py` | Music bars −6/−6/−4 ms; VO onsets −8/−6/−5 ms; SFX hits within 5 ms of the picture's numbers. |

---

## 3. Building-block catalogue

The key for the "Exists?" column:
- **yes**: the engine can already do it with a template or an effect.
- **partly**: the pieces exist, but the AI would still have to hand-author the look or timing.
- **no**: the engine cannot do it.

Values are for "making films like this for Bhippi users (product explainers, talking-head explainers) with fewer tokens".

### 3.1 Scenes and templates

| # | Name | Kind | What it does | Parameters | Exists? | Value |
|---|---|---|---|---|---|---|
| T1 | **crimson-field** (stage preset) | asset-library / template | The living backdrop: gradient, two breathing corner glows, a drifting low light band, a top shade and rising bokeh motes, plus a global "world drift" of ±5 px / ±0.25°. | `palette` (void, oxblood, crimson, hot), `band {y, drift, intensity}`, `glows {breathe, drift}`, `motes {count 28, size 8–54, rise 10–44 px/s}`, `drift {px 5, deg 0.25}` | **partly**: the `crimson-stage` procedural exists (`src/motion/gl/procedural.ts:27`, `kit/common.ts:107` `stage()`). There is a `bokeh`/`dust` particle preset (`particles.ts:8`) and `wiggle` expressions (`expr.ts`). No band drift, no breathing glows and no "world drift" group convention. | **high**: every beat of this look sits on it; one layer instead of about 35. |
| T2 | **hook-subject-pop** (talking-head hook) | template | Plate with rack focus and red bloom. The first words land either side of the subject's head. The subject pops in *between* them with a converging red echo, holds, shrinks into a centred card, rests, then parks as a PiP on a word. | `subject` (footage+matte, a PNG sequence, **or a character layer**), `plate`, `words: {text, at}[]` with a `side`/gap around the head, `popAt`, `echo {offset 96, converge 0.26, burn 0.34, color}`, `holdUntil`, `card {scale 0.37, y 712, ease shrink}`, `restUntil`, `park {corner, scale 0.2, at}` | **partly**: `subject-reveal` (`kit/index.ts:29`, `kit/subjectReveal.ts`) does the plate, words behind the subject, a phrase and `cardAt`. Its reveal is the "cells" style, it has no rest-then-park, and it has no character subject. `frame-to-card` (`kit/overlayTemplates.ts:1178`) has exits left/up/push/none but no "park to corner". | **high**: the reference's single most important trick, and v2's biggest score gain. |
| T3 | **frame-to-card → rest → park** | camera / template option | One continuous scale of the whole frame into a rounded card with rim and glow. It rests through a beat, then parks as a PiP that can later **whip back** and grow (see T13). | `at`, `duration 0.6`, `ease [0.45,0,0.12,1]`, `card {scale, center, radius 24}`, `rest`, `park {corner, scale, at, duration 0.54}`, `return {at, to}` | **partly**: `frame-to-card` has no rest/park/return. `diamond-list-pip` has a static PiP (`kit/stageTemplates.ts:878`). | **high** |
| T4 | **product-card** | template (component) | A real UI capture in a rounded card (hairline crimson rim, red glow, deep shadow) that lands with a spring, a Y-rotation through perspective and a blur-in, then gets one specular sheen. Named by a pill (T5). | `media` (image or sequence), `size`, `from {x, ry −38, scale 0.86, blur 12}`, `spring {2.2 Hz, ζ 0.62}`, `sheenAt`, `rim {color, width 1.5}`, `glow`, `shadow`, `pill {text, side, gap}` | **partly**: the pieces are there: shape radius, `stroke`, `glow`, `drop-shadow` (`common.ts:103-124`), 3D layers, and the `back-out`/`spring` eases. `demo-callouts` frames a screenshot (`storyTemplates.ts:1019`). There is **no sheen effect** (audit G10) and no single "card" component. | **high**: used 12 times in 15 s. |
| T5 | **label-pill** | template (component) / text-animator | The reference's filled crimson label. The body pops, its words reveal 0.10 s later and 0.05 s apart, and it holds at least 0.6 s. It can be **attached** to another layer (it rides the monitor). | `text`, `at`, `out`, `attachTo {layer, anchor: 'below' \| 'right'…, gap 38}`, `size 42 px`, `fill [#e7233e, #c3122c]`, `stagger 0.05`, `minHold 0.6` | **partly**: pills exist inside `cutout-stage` callouts, `split-rules-panel` and `demo-callouts` captions. Cross-layer `link` exists (`types.ts:376`). There is no standalone attachable pill and no "min readable hold" rule. | **high**: the critique's #2 fix; cheap to build. |
| T6 | **word-land (grey→white)** | text-animator | Each word lands on its spoken time: rise 34 px, de-blur 16 px, scale 1.06→1, grey for a beat then white. Exits rise 26 px with blur. Emphasis words are in italic serif. | `times` or `{word}` refs, `rise`, `blur`, `scale`, `dimColor`, `whiteAfter 0.07–0.36`, `exit {at, dur 0.24, rise 26}`, `spans` (italic serif) | **yes, approximately**: `TextCascade` with `from {position, blur, scale}`, `dimTo`/`brightenAfter` and `exit` (`types.ts:147-161`), `TextSpan` italic/font (`types.ts:163`), `{word}` voice sync (motionTools), and the `headline()` helper (`kit/common.ts:136`). `dimTo` dims *opacity* (`text.ts:289-291`), which reads as grey only on a dark field; a true grey→white colour ramp needs a `fillColor` animator. | **medium**: it exists; add a named preset `crimson-land` (and a colour mode for `dimTo`) so the AI does not tune it. |
| T7 | **text-behind-subject** | template option | Words sit either side of the head and pass behind the cut-out. | `gap` around the head, `layer order` | **yes**: `subject-reveal` title words and `big-number-behind` (`storyTemplates.ts:1062`), plus the `add_text_behind_subject` tool. | medium |
| T8 | **mark-rig** (split logo + open/clack/think/heartbeat) | template + asset tool | Splits a logo into its connected parts. Lands it with the halves shutting exactly on a beat, then a damped clack. "Thinks" while waiting (parts apart and turning). Pulses on beats. Specular sheen. Lockup with a wordmark whose letters land on the spoken word. | `logo` (asset), `parts` (auto by connected components, or given), `beat`, `openDeg 62–75`, `clack {amp 9–10, decay 6–7, freq 24–26}`, `think {gap 7–10, spin 48°/s}`, `heartbeats: t[]`, `size 280–350`, `lockup {wordmark, side, letterStagger 0.035}`, `sheenAt` | **no**: `brand-logo-sting` (`kit/brandTemplates.ts:389`) is a simple ident, and nothing splits a logo into parts. Shape `morphTo` exists for vector logos. | **high** for Bhippi's own films and any brand with a multi-part mark. **Fix:** hide the mark while its halves are more than 30° open, which removes v2's "bowl" frames. |
| T9 | **hub-connect** (integrations) | template | Rows or cards fly in staggered on the right, Bézier wires draw from a central hub (a logo) to each, and light dots travel along the wires on a spoken word. The row being named pulses. | `hub` (layer/asset), `rows: {media \| text, icon?}[]`, `stagger 0.11`, `wireDraw 0.28`, `flowAt {word}`, `flowLoop 0.42`, `pulse {row, at}`, `side` | **partly**: `node-tree` (`stageTemplates.ts:1071`) draws lines to a central node. Trim paths (`types.ts:239-242`) exist. There is **no "dot along a path"** (it needs an expression). | **high**: "connect your X / works with Y" is in every SaaS explainer. |
| T10 | **drop-into-slots** | template | N thumbnails fly in on arcs from off-frame, spinning and shrinking, land in a panel's slots with a spring and hand over to the panel's own picture. | `panel` (media), `slots: [x,y,w,h][]`, `items: media[]`, `from`, `stagger 0.085`, `flight 0.42`, `scale 2.1→1`, `spin`, `land spring` | **partly**: `Key.arc`/`through` spatial arcs exist (`types.ts:39-45`); no template. | medium |
| T11 | **ui-state-reveal** (a panel fills in the order it was made) | UI-kit capability | Stacked captures of one panel at successive states, each revealed with rect wipes in a given order (clip by clip, row by row), with a razor flash on each new edge. | `states: {media, reveal: {rect, at, dur}[] \| 'clips' \| 'rows'}[]`, `flash {color, decay 0.07}` | **no**: UI states are whole pages switched by `state` (cut/fade/slide) (`ui/spec.ts:40`); masks exist (`types.ts:81`). Needs per-part states (audit G6). | **high**: this is how you show *an edit happening* in Bhippi, and of any "watch it fill" SaaS moment. |
| T12 | **part-lift-out** | UI-kit capability | Crop one row or part out of a panel and lift it forward (rotateX 28°→0, rising), pulse it on beats, and dim what is behind it. | `target` part/rect, `to {y, scale}`, `pulse: t[]`, `dimBehind 0.9` | **no**: parts exist in `create_ui_screen`, but the whole screen is one flattened precomp (audit G1). `hover-lift` (×1.088) is the nearest relative. | medium-high |
| T13 | **match-grow cut** | transition | A small card whips back and grows so that a named anchor inside it lands exactly on the same anchor in the next shot, which crossfades in around it. | `from` layer, `to` layer, `anchorFrom`/`anchorTo` (points or measured boxes), `dur 0.28`, `ease whip`, `crossfade 0.10` | **no**: 28 sequence transitions exist (`sequence.ts:20-24`), including `card-zoom-reveal`, `collapse-into` and `swap-when-hidden`, but none aligns anchors. | medium: elegant, and it hides a hard scene change. |
| T14 | **slam-tilt** | camera | A card slams in on a bar: scale 1.32→1, rotateX 26°→13°, blur 18→0 over 0.22 s, then dollies. | `at` (beat), `from {scale, rx, ry, blur}`, `dur 0.22`, `dolly` | **partly**: `snap-punch` and `scale-cut` transitions and `TIMING.slam` (`kit/common.ts:63`) exist, plus 3D layers; no named camera move. | medium |
| T15 | **rise-out-of** | camera / transition | A card rises out of another card (rotateX 34°→0, y +356 px, spring) while the parent settles lower. | `parent`, `child`, `dur 0.42`, `rx 34` | **partly**: raw keys only. | low-medium |
| T16 | **whip-pan between scenes** | transition | The outgoing scene exits 1150–1400 px with blur 12–16 on an ease-in, and the incoming one enters from the opposite side with a Y-rotation, so the two read as one pan. | `dir`, `dur 0.30–0.34`, `blur`, `ry` | **yes**: `whip` and `push` in `TRANSITION_KINDS` (`sequence.ts:20`); `seamless_transition`. | low (exists) |
| T17 | **hero-editor recede** | transition | The hero picture recedes (×0.76, blur 10, fade) *before* the next hero lands on an empty field. | `dur 0.22` | **yes**: `z-recede` (`sequence.ts`). | low |
| T18 | **end-card with defocused backdrop and a heartbeat mark** | template | The mark lands on the downbeat, the words land on sung syllables, the film's own pieces drift far behind (26% opacity, blur 8–13, ±18° rotateY, parallax), the mark pulses on the next beats, and the camera pushes 4.5%. | `mark` (T8), `title`, `tagline`, `times`, `backdrop: media[]`, `beats`, `push 0.045` | **partly**: `brand-end-card` (audit §1.6) and `card-wall-3d` (a dolly with far cards defocused). The backdrop-of-own-pieces and the heartbeat are missing. | medium-high: every film ends on one. |
| T19 | **badge-hits** | template | Round badges with an icon pop on each hit time along a strip, each with an expanding ring and a distinct sound. | `hits: {t, x, icon, sound}[]`, `ring {scale 3.4, dur 0.45}` | **partly**: `stat-badges` (count-up badges), `add_fx ripple`/`glow-ring`, and the `ripple-rings` particles. | low-medium |
| T20 | **card montage around the hook card** | template | Small cards fly in around the shrunk hook card while it keeps shrinking, with a statement over them (reference 2.5–5 s). **Missing from this film.** | `images`, `words`, `headline` | **yes**: `card-wall-3d` (`overlayTemplates.ts:1198`), whose defaults are the reference's own words. | high (it exists; the maker did not have it) |

### 3.2 Effects

| # | Name | Kind | What it does | Parameters | Exists? | Value |
|---|---|---|---|---|---|---|
| E1 | **sheen / specular sweep** | effect | A soft diagonal highlight sweeps across a card or a masked logo once. | `at`, `dur 0.55`, `angle 105–115°`, `width`, `intensity 0.10–0.85`, `blend screen` | **no**: audit G10; `gradient-overlay` could approximate it with keys (`gl/effects.ts:251`). | **high**: cheap, and on every card. |
| E2 | **echo-converge** | effect | Two coloured silhouettes of the layer's alpha start offset either side and snap together, then burn off. | `offset 96`, `count 2`, `color`, `blur 3`, `converge 0.26`, `burn 0.34`, `blend screen` | **partly**: `add_fx echo` gives trailing copies (`lib/aiTools`), `matte-fill` and the `link` delay copies (`types.ts:376`). None converges. | medium-high: the hook's signature. |
| E3 | **flash + shockwave** | effect / template | A radial screen flash (e^(−t/0.06)) plus an expanding glowing ring, centred on a layer. | `at`, `center` (layer), `flash 0.72–0.85`, `ring {size 200, scale 1.6→10.6, dur 0.55}` | **partly**: the `burst-flash` template (`kit/funTemplates.ts:358`), `add_fx glow-ring`, `ripple-rings`. | medium |
| E4 | **razor-flash** | effect | A white-hot vertical line with a red glow at a cut position, decaying in 0.07 s. | `x`, `height`, `decay 0.07`, `color` | **no** | low-medium (part of T11) |
| E5 | **finish preset "cinematic-dark"** | effect (scene-level) | Linear-light soft-knee bloom (threshold 0.42, ×0.36 warm), radial chromatic aberration (±0.0011), vignette (0.16·r^2.4) and mid-tone grain (0.003–0.008, 2 px clumps), in one switch. | `bloom {threshold, gain, tint}`, `ca`, `vignette`, `grain {amount, size}` | **partly**: `glow`, `halation`, `chromatic-aberration`, `vignette` and `grain` effects exist (`types.ts:100-111`); **no preset** (audit G9). The audit notes a glow at threshold 0.75 washed out a white UI. | **high** |
| E6 | **adaptive motion blur** | effect (renderer) | Samples per frame from the measured screen-space travel (≤4 px between copies, more tolerance on already-blurred layers), 2–64, averaged in linear light. | `shutter 180`, `maxGap 4 px`, `min 2`, `max 64` | **partly**: per-layer motion blur, samples ≤32, fixed per scene (`types.ts:435`, `evaluate.ts:334-352`); audit G11 asks for velocity-adaptive samples. | **high**: fixed 6–24 samples left visible ghost copies on whips and rings in both rounds. |
| E7 | **red rim / crimson drop-glow on a cut-out** | effect | A 12–18 px crimson outer glow plus a 1.5–2 px light rim on a cut-out subject. | `glow`, `rim` | **yes**: `matte-edge-glow`, `glow`, `stroke` (`types.ts:107`). | low |
| E8 | **header dim / scrim behind a line** | effect | A local darkening behind type or over a panel's busy region. | `shape`, `opacity` | **yes**: shapes with gradients, masks. | low |

### 3.3 UI kit, capture and characters

| # | Name | Kind | What it does | Parameters | Exists? | Value |
|---|---|---|---|---|---|---|
| U1 | **capture-app-session** (scripted, DOM-aware, stateful) | workflow / UI-kit | Boots the real product (Bhippi's own UI at `localhost:5199` with a mocked shell and a fake project "world", or any URL). Runs a script of clicks, typing and **real tool calls**. Returns per-state screenshots, part boxes by selector or role, and typing frames at 3x. | `url`, `world` (project, providers, licence), `script: [{type, text} \| {click, selector} \| {toolCall, name, args} \| {capture, name, selectors}]`, `scale 2–3`, `theme` / `cssOverrides` | **partly**: `capture_product_ui` is a static 2x screenshot with a 100 px grid and no DOM, states or script (`src-tauri/src/ui_screen.rs:80-117`; audit G7). The maker built this from scratch (`tauri_mock.js`, `build_world.py`, `sc_edit.mjs`, 51 tool calls). | **very high**: every card in the film came from this. It is also the only way to show "Bhippi really did this edit". |
| U2 | **typing into a real field** | UI-kit | A typed prompt as a live text layer over a captured field (or a sequence of real typing captures), with a cursor press on Send, a ring and a "working" state. | `target`, `text`, `cps` (the film typed 107 chars in 1.03 s), `send {at, ring}`, `workingState` | **partly**: the `type`/`click` actions and live text over screenshot parts (`ui/spec.ts:14-20, 52`); no "working" state swap for a part. | medium-high |
| U3 | **per-part states** | UI-kit | A part swaps variants (a Send button to a stop button, an empty composer to a working one, a panel before and after) by cut, fade or wipe. | `parts[].states`, `{type:'set', target, state, transition}` | **no**: whole pages only (`ui/spec.ts:74`, `ui/raster.ts:152`; audit G6). | high |
| U4 | **restage/relight a capture** | asset tool | Swap a UI region's background for a themed one using a known-background difference matte, turning dark ink light. | `capture`, `emptyCapture`, `rect`, `background {gradient, light pool}`, `inkInvert` | **no**, and it is better avoided: capture with a CSS override or a dark theme instead (U1 `cssOverrides`). | medium: a stop-gap only. |
| U5 | **defocused product "room" plate** | asset-library | A backdrop made from the product itself: crop, blur 24, desaturate to 42%, tone-lift to mid-grey, soft falloff. | `source`, `blur`, `saturation`, `lift {black 0.10, gamma 0.58}` | **partly**: `gaussian-blur`, `hue-saturation` and `levels` effects exist; no preset. | low-medium |
| U6 | **character as presenter** | template / character | Bhippi's own library character (Kai) talks, waves, celebrates and jumps out of a window, drawn live by the engine. | `character` (studio spec), actions `talk/wave/celebrate`, `lipSync {words}`, `onBeat` pose pump, `jump {from, to, arc 120, spring 2.6 Hz}` | **partly**: the `character` layer with `STUDIO_KIND` draws library characters in the engine (`character/types.ts:10-16`); `animate_character`, `lip_sync_character`. **Missing**: beat-locked poses, a "jump between layers" action, and a character as the subject of T2. The maker instead captured 243 PNGs through the room's scrubber and ran a generic talk loop. | **high**: real lip-sync would fix v2's weakest point (a cartoon with a generic mouth loop). |

### 3.4 Audio

| # | Name | Kind | What it does | Parameters | Exists? | Value |
|---|---|---|---|---|---|---|
| A1 | **word timing, envelope-corrected** | audio / workflow | Whisper word onsets, snapped to the nearest energy rise when more than 40 ms off, exposed as a word track that animations bind to (`{word:'providers', +0.12}`). | `tolerance 0.04`, `envelope 10 ms` | **partly**: `analyze_clip_speech` word timestamps and `{word, mode}` time refs exist (audit §1.3); no envelope correction. | high |
| A2 | **place-word-on-beat** (VO edit to the music) | audio tool | Cut a VO into phrases inside silences, trim gaps, speed up (pitch kept), then place it so a named word lands on a named beat. Optionally insert a pre-lap pause. | `word`, `beat` (bar N or t), `trimGaps ≥0.05 s`, `silence −45 dB`, `tempo 1.06`, `prelap {after, seconds}` | **partly**: `podcast_cut`, `remove_range`, `snap_cuts_to_beats` (which moves *cuts* to beats, not a word). | high |
| A3 | **music re-edit to film** | audio tool | Choose bars from a song and join them on measured transients (6 ms early, 8 ms crossfade). Add a reverse swell built from the drop, a filtered break, and a sung tag as the end card. | `bars: {filmT, songFrom, songTo}[]`, `swell {from, to, shape}`, `break {at, lp 12k→500}`, `tag {songT, at, shelf}` | **partly**: `analyze_music_beats` and `compose_music` (with risers); no re-cut of an existing song. | high |
| A4 | **SFX anchored by kind** | audio tool | Place library sounds so the audible onset (hits), the peak (whooshes, on the fastest frame) or the end (reverse whooshes, risers) sits on the picture's time, panned with the move. Taken from the scene's own cue list. | `anchor: onset \| peak \| end`, `pan {from, to}`, `db` | **partly**: `search_sfx`/`place_sfx` (Openverse/Freesound CC0), and scene `cues` (`types.ts:439`). `place_sfx` anchors at the file start and does not pan. | medium-high |
| A5 | **one-hit-per-event rule and a cue budget** | workflow | At most one SFX per visual event, no ticks on words or pills, and a razor run as quiet single transients. | `maxPerSecond`, `min gap` | **no**: a QA rule. | medium |
| A6 | **ducking and loudness** | audio | Music ducked by a VO envelope follower (30/280 ms, up to −7 dB), SFX −3 dB under the voice, two-pass −14 LUFS / −1 dBTP. | as listed | **yes**: `level_audio` and `score_audio_clip` ducking (`lib/aiTools.ts:1131`); `normalize_audio`. | low (exists) |

### 3.5 Workflow

| # | Name | Kind | What it does | Exists? | Value |
|---|---|---|---|---|---|
| W1 | **beat map as the single source of truth** | workflow | One table of VO words × bars × picture events × pills × SFX. The motion scene, the mix and the QA all read the same numbers. | **partly**: `save_beat_sheet`, `save_storyboard`, and scene `cues`. | high |
| W2 | **reference hook study** | workflow | 10 fps over the first 3–12 s and 2 fps over 120 s, written as a beat list ("0.25 first word, 0.50 pop-in…"). | **yes**: `analyze_reference_video`, `ref.json` notes. | medium |
| W3 | **transition-busy QA** | workflow / QA | Flags frames where three or more layers are entering or leaving at once, pills whose words are not all visible for 0.6 s, orphan pills (target gone), leftover rings, and logos rendered in a "half-open" pose. | **partly**: `run_frame_qa` (safe areas, collisions, blank frames) and `check_pacing` (text hold). None of these specific checks exists. | high: every remaining v2 fault is one of these. |
| W4 | **deterministic per-frame re-render** | workflow | Re-render only the frames a fix touches. | **yes**: the engine is a pure evaluator (`evaluate.ts`). | — |

---

## 4. Lessons

1. **A structure copied beat by beat beats a structure paraphrased.** Round 1 compressed the hook to 1.6 s and crashed the logo into it (68). Round 2 copied the reference's order and rests (word → pop → second word → hold → shrink to a *centred* card → *rest* → park) and gained the most points. Templates should encode the rests, not only the moves.
2. **Timing fixes clarity more than size does.** The pills did not need to be bigger. They needed their words from 0.10 s after the body and a 0.6 s readable hold. A `minHold` rule in the pill component and in `check_pacing` would have prevented it.
3. **Heroes land on empty space.** Both "crashes" in v1 were a big mark flying *through* content. The fix is a rule: clear the frame first, then appear at final size 3 frames before the beat, opaque in 2 frames, blur ≤4 px, never over 500 px over content. The mark-rig template should enforce it, and hide the part-open "bowl" pose.
4. **Show the real product doing the real thing.** The strongest beats (the typed prompt, the timeline filling, the monitor title) come from the real UI driven through its real tool executor. It cost the maker a Tauri shim, a world builder and 51 scripted tool calls. For Bhippi this is the highest-value capability to own (U1).
5. **Measured motion blur, not guessed.** Fixed sample counts ghost on whips and waste time on holds. The displacement-based sampler (≤4 px between copies) solved it in one pass.
6. **Light the whole film as one.** A single white capture (the Characters stage) doubled frame luma and broke the look. Captures need a theme or CSS override at capture time, or a relight step. A frame-luma QA should flag jumps above about 2× the running mean.
7. **Audio by measurement is possible but capped.** Anchoring hits on the onset, whooshes on the peak and risers on the end got every hit within 5 ms. The mix was still never heard. A listening pass (or an audio critic model) is the missing step.
8. **Density is a script problem, not a motion problem.** Eight features in 12 s of VO forced 0.45 s beats. The engine cannot fix that. The planner should cap features at about one per 1.5 s, or pick three.
9. **The cost of bespoke.** About 4,450 lines of code and about 4.3 h went into this film. A block-based rebuild (§6) would be about 12 beats of parameters. Most of the maker's time went into the capture rig, the compositor and the audio tools. None of these is film-specific.

---

## 5. What would make the output better next time

On the film itself, in order of impact:

1. **Cut the list to five beats** (connect, describe, it edits, characters, end card), or lengthen the film to 20 s. Give each beat at least 1.5 s so music and SFX get real time.
2. **Add the reference's second hook line** under "My secret weapon" (for example "is Bhippi", landing word by word) before the shrink. Also add the **card montage** (`card-wall-3d`) around the resting card at about 2.5 s, as the reference does.
3. **Make the presenter speak.** Either use a real cut-out presenter (roto + `subject-reveal`), or draw Kai live with `lip_sync_character` on the actual VO words instead of a generic talk loop. Stop the mouth during the 0.7 s pause.
4. **Hide the mark while it is more than 30° open.** Let it appear already near-shut, which removes the "bowl" frames at 1.57 s and 12.48 s.
5. **Clean the three busy windows.** At 8.70 s, let the monitor leave fully before "Music" lands. At 10.00 s, retire the SFX strip, its rings and the badge ring before the PiP returns. At 12.40 s, stagger the editor recession and Kai's drop by 4–6 frames.
6. **Give orphan pills an owner.** Let "Animated characters" follow Kai (attachTo) or leave with the window.
7. **Make the hook plate a real room.** A defocused photographic studio (or a Bhippi office still) would do it; a blurred editor reads as grey mush.
8. **Audition the mix by ear**, or with a second model listening. Thin the razor run to every other cut.
9. **Bump small UI text.** Capture cards at 3x and crop tighter (provider versions, panel labels).

On the engine and the process:

1. **A block-based plan.** Build it as `create_motion_sequence` beats from the templates in §3 (outline in §6), with the beat map (W1) generated from the VO and the music first.
2. **A QA pass** that runs W3 checks on every draft (busy transitions, pill holds, orphans, luma jumps, logo pose) before any human or critic sees it.
3. **Render with the finish preset (E5) and adaptive blur (E6)** so no film hand-rolls post.

---

## 6. What to add, in build order

Each item names where it would go. It builds on the audit's G-numbers (`docs/research/motion-engine-audit.md`).

| Priority | Add | Kind | Where | Unlocks |
|---|---|---|---|---|
| 1 | **`capture_app_session`**: a scripted, DOM-aware capture with states, part boxes, typing frames and real tool calls against a mocked shell and world. Bhippi's own UI comes first. | workflow / UI-kit | A new mode of `capture_product_ui` (`src-tauri/src/ui_screen.rs`), driving Chrome/Edge over CDP. The maker's `tauri_mock.js` + `build_world.py` are a working prototype of the Bhippi-self case. | U1, U2, U3, T4, T11, T12; audit G7 |
| 2 | **`product-card` + `label-pill` components** with `sheen`, spring landing and `attachTo`, and a `minHold` rule | template + effect | `kit/overlayTemplates.ts` (or a new `kit/productTemplates.ts`), the `sheen` effect in `gl/effects.ts`; the pill as a shape + text pair with `link` | T4, T5, E1 |
| 3 | **Finish preset + adaptive motion blur** | effect / renderer | `MotionScene.finish` (`types.ts:427`), velocity-adaptive samples in `evaluate.ts:334-352`, linear-light accumulation in `gl/renderer.ts` | E5, E6; audit G9, G11 |
| 4 | **`hook-subject-pop`**: extend `subject-reveal` with `echo:'converge'`, `rest`, `park`, and a character or PNG-sequence subject | template | `kit/subjectReveal.ts`, `frame-to-card` options in `kit/overlayTemplates.ts:1178` | T2, T3, E2 |
| 5 | **`mark-rig`** + a `split_logo_parts` asset tool (connected components → part layers with a shared centre) | template + asset tool | `kit/brandTemplates.ts` (beside `brand-logo-sting`), `import_brand_logo` | T8, T18 |
| 6 | **`hub-connect`** and **`drop-into-slots`** | template | `kit/stageTemplates.ts` (beside `node-tree`); an expression or helper for "a dot along a path" | T9, T10 |
| 7 | **`ui-state-reveal`** and **`part-lift-out`** | UI-kit | `ui/spec.ts` actions `{type:'reveal', target, order}` and `{type:'lift-out', target}`, on per-part states (G6) and exploded parts (G1a) | T11, T12, E4 |
| 8 | **Audio: `align_word_to_beat`, `music_reedit`, `place_sfx {anchor, pan}`** | audio tool | beside `snap_cuts_to_beats`, `analyze_music_beats`, `place_sfx` | A1–A4 |
| 9 | **`match-grow`** transition and **`slam-tilt`** / **`rise-out-of`** camera moves | transition / camera | `sequence.ts` `TRANSITION_KINDS`; camera recipes in `motionDirection.ts` | T13, T14, T15 |
| 10 | **QA checks**: busy transitions, pill hold, orphan labels, luma jumps, logo half-open | workflow | `run_frame_qa` / `check_pacing` | W3 |
| 11 | **`crimson-field` stage preset** with band, breathing glows, motes and world drift, plus an **end-card backdrop of the film's own pieces** | asset-library / template | `kit/common.ts` `stage()`; `brand-end-card` | T1, T18 |

### 6.1 The same film as blocks (illustrative outline)

This is what the AI would write once the blocks exist: about 12 beats of parameters instead of 1,060 lines of compositor. Every layer stays openable in the layered "[Motion]" comp.

```
capture_app_session  { target:'bhippi-self', world:'northern-trip', script:[type prompt, send, toolCalls…], capture:['providers','project','composer*','timeline@states','monitor@0..2.4s','characters'] }
align_word_to_beat   { word:'Bhippi', beat:'drop', prelap:{after:'weapon', seconds:0.3} }
music_reedit         { bars:[groove 1–4 from drop], swell:{0,'drop'}, break:{bar5, beats:2}, tag:{'Meet Bhippi', at:'bar5+2beats'} }
create_motion_sequence { layout:'world', stage:'crimson-field', finish:'cinematic-dark', beats:[
  { template:'hook-subject-pop', params:{ subject:{character:'Kai', lipSync:true}, words:[{My secret},{weapon}], echo:'converge', card:{rest:'drop'}, park:{corner:'bottom-left', at:{word:'Just'}} } },
  { template:'mark-rig', params:{ logo:'bhippi', beat:'drop', lockup:'Bhippi', then:{ to:'hub' } } },
  { template:'hub-connect', params:{ hub:'mark', rows:capture.providers, flowAt:{word:'providers'}, pill:'Bring your own AI', title:['Connect','*your AI*'] } },
  { template:'drop-into-slots', params:{ panel:capture.project, items:clips, pill:'Project files', title:['Upload','your files'] }, transition:'whip' },
  { ui:{ screenshot:capture.composer, actions:[type prompt @ {word:'describe'}, click send, set working] }, pill:null, title:['Describe the *edit*','you want.'] },
  { template:'ui-state-reveal', params:{ panel:capture.timeline, order:['V1 clips','V3/V4','A2/A3','V2'], slam:'bar3', pills:[…] } },
  … characters (match-grow), 'All *automatically*' (hero card), end-card { mark:'mark-rig', backdrop:'own-pieces', heartbeat:'jingle beats' } ] }
place_sfx_from_cues  { anchorByKind:true, budget:'one per event' }
run_frame_qa         { checks:['busy-transition','pill-hold','orphan','luma-jump','logo-pose'] }
```

---

## Appendix: numbers measured for this review

- **v2 file:** 1920×1080, 30 fps, 15.000 s, H.264 at 29.5 Mb/s; AAC 325 kb/s.
- **v2 loudness:** −14.1 LUFS integrated, −0.9 dBTP, LRA 1.1 LU; first 0.25 s at −31.6 dB RMS.
- **Reference loudness (0–15 s):** −14.2 LUFS, LRA 1.2 LU, peak −1.2 dBFS.
- **v2 mean luma every 0.5 s** (0–255, from 480-px frames): 74, 77, 80, 31, 39, 29, 35, 36, 26, 35, 35, 32, 37, 29, 36, 42, 44, 46, 44, 40, 28, 34, 39, 38, 43, 28, 36, 41, 41, 42.
  - The largest step is at 1.1 s, the grey plate giving way to the crimson field. That step is by design and matches the reference's own plate-to-field change.
  - There is no spike in the Characters section.
- **Maker's effort:**
  - About 4.3 h wall clock over two rounds.
  - 4,454 lines across tools and compositor, of which `comp2/comp.js` is 1,059.
  - 243 character PNGs and about 200 UI captures.
  - 2,758 render samples.
  - 53 SFX cues from 19 CC0 sounds (52 auditioned).
