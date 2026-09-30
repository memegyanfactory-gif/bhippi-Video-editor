# Launch-film learnings: what to teach Bhippi's AI

Date: 2026-09-30. This turns three film experiments into a recipe that Bhippi's AI can follow, and drafts the text that carries it into the app. The engine work it needs is in `docs/plans/MOTION-ENGINE-UPGRADE-PLAN.md`.

**Sources** (all read in full):

| Short name | What it is | Where |
|---|---|---|
| **Study** | How Claude Opus made the 80/100 "Meet Bhippi" film: renderer, UI kit, scene recipes, sync | `docs/research/opus-launch-film-study.md` |
| **Walkthrough** | The same run step by step: every render, look and fix loop, the mistakes, the time split | `docs/research/opus-launch-film-walkthrough.md` |
| **Audit** | What Bhippi's motion engine (`src/motion`) can and cannot do today | `docs/research/motion-engine-audit.md` |
| **15s notes** | An independent 15 s film of the same song opening, and its maker's notes (v1 and v2) | `C:\Users\aayus\Documents\Bhippi\Film lab\bhippi-15s\BUILD_NOTES.md` |
| **Crit 1 / Crit 2** | Two scored critiques of the 15 s film against the 80/100 film's first 15 s (76 vs 77, then 84 vs 77) | `...\bhippi-15s\critique-round1.md`, `critique-round2.md` |
| **Crimson** | A parallel film-lab study (a 15 s explainer, 75/100) with a 44-block catalogue | `docs/research/film-lab/crimson-explainer.md` |

I also checked the evidence frames myself (`crit2_side_by_side.jpg`), probed both 15 s MP4s (1920x1080, 30 fps, 450 frames, 15.000 s each), and read the maker's staging tools (`tauri_mock.js` 61 lines, `stage_data.js` 88, `capture.mjs` 204, `film.js` 1,008, `post.py` 302).

---

## 0. The short version

Three runs made the same kind of film. They scored very differently.

| Run | How it was made | Time and effort | Score |
|---|---|---|---|
| **Opus, full song** | Its own Python 2.5D renderer. 328 UI part textures rebuilt from the app's CSS at 4x, one texture per state. 23 scenes, each checked on contact sheets. | One free turn at max effort. The Bhippi trace records 96 min of wall time; about 55 min of it was the UI kit, the engine and the scene loop. | **80/100** (its 0–15 s stretch: **77**) |
| **15 s film** | The real Bhippi React UI booted in headless Chrome with a Tauri stand-in, driven as a pure function of time. numpy post: depth of field, bloom, grain, exposure. | Two rounds with a scored critique between them. | v1 **76**, v2 **84** |
| **Bhippi pipeline** | Plan, gather, edit at medium effort. Gather made 10 still PNG "plates" in about a minute. Edit used the built-in templates (`create_motion_scene`). | Medium effort, three short phases. | **10/100** |

The engine is not the reason for the gap. The audit measured it at 26–44 ms a frame with a tilted UI plane, a moving camera, depth of field and 16-sample motion blur (Audit §1.7). The gap comes from five things. The two good films had all five, and the 10/100 run had none:

1. **The real product, in many states.** Both good films show Bhippi's own UI, sharp at 4x, changing state on the frame of each click (139 composer states in the Opus film). The 10/100 run had still plates.
2. **A camera that moves through the product.** Close on one part, then a pull-back to the whole window tilted in 3D, with motion blur on fast moves. No built-in template does this (Audit §1.6: 0 product-demo templates, 0 with depth of field).
3. **Timing to the word and the beat.** Every hero action lands on a measured word onset. Cuts land on bars, and repeated actions land on eighths or sixteenths.
4. **A render, look, fix loop.** Opus rendered 36 contact sheets and read 59 images. Every scene got about 1.6 looks and one fix (Walkthrough §8). The 15 s film gained 8 points from one critique round.
5. **Time and budget to do 1 to 4.** 20% of the Opus run went into the UI kit and 33% into building and checking scenes. The 10/100 run spent about a minute gathering.

The lessons below are written so they can be taught: a working process (§2), timing rules (§3), look parameters (§4), scene patterns (§5), joins (§6), sound (§7), review gates (§8) and traps (§9). §10 drafts the text that puts them into the app.

---

## 1. Ten lessons, with the evidence

1. **Show the real product doing the real thing.** Both good films were built on the real UI. Opus rebuilt each component from the app's own compiled CSS, class names and source copy (Study §2.1). The 15 s maker booted the real React app from the Vite server with staged data (15s notes §2). Critique 1 ranked "the real product, crisp, in many states" as the reason the old film read better, and Crimson calls it "the highest-value capability to own" (Crimson §4.4).
2. **One texture (or live element) per state, swapped on the frame of the action.** Typing is one state per character. A slider has five eased in-betweens per snap. A row goes need, key being typed, saving, ready (Study §2.2). A click only reads as a click when its target changes on that frame.
3. **Every hero action lands on a word.** The Opus film lands provider arrivals, the four "Ready" flips and the plug on sung word onsets (Study §4.2). The 15 s film starts each word's reveal 35 ms before its onset, and Critique 1 scored its sync 9/10 against 7 for the older film, whose typing "trails the voice".
4. **Legibility beats craft.** The 15 s v1 had the better camera, type and sync, yet lost (76 vs 77) because it was too dark (mean luma 21/255) and its "it works" beat was about 10 px text. Fixing exposure (luma 21 → 55) and holding the camera on the work list at 3.2x (cap height about 28 px) were two of the three biggest gains in v2 (15s notes, round 2).
5. **Say each phrase once.** v1 showed the same line up to three times: headline, monitor title and caption pill. Removing the repeats was one of the three fixes Critique 1 expected to move the score most.
6. **Light the whole film as one, and keep it bright enough.** Target mean luma 45–60 on a dark film, and a 98th percentile of 200 or more on UI shots (Crit 1, fix 1). A light stage (the Opus film, about 173) reads on any phone. Glow presets must not bloom white UI: a glow at threshold 0.75 washed a white UI to grey in the audit's own test (Audit §2.3).
7. **Motion blur by screen speed, not by guess.** Opus hand-picked 1, 2 to 4, or 8 samples per time range. The 15 s maker found that 2 or 3 samples ghost 1 px UI text into double images. One sample per 1.6 px of streak (2 to 48) fixed it. A whip at 180° smeared for 12 frames. At 120° over 0.29 s it was sharp at landing (Crit 2).
8. **Moves must land and hold.** Critique 2's remaining faults were a pull-back that never settles (sharp for 3 frames before the fade), a send that is a smear, and two competing moves in one 0.25 s window. Every move needs a sharp landing and a readable hold.
9. **The loop is where quality comes from.** Opus looked at frames chosen at the moments of action, named the fault in one line, patched, and looked again (Walkthrough §8). It judged from stills only, and missed the 1x-render bug once when it did not scan automatically. A scored critic with measured numbers (luma, cap height, word onsets, cue levels) gave the 15 s film +8 in one round.
10. **Bespoke renderers are expensive and not editable.** The Opus film is 23 flat MP4s: nothing can be changed in Bhippi afterwards, and the timeline was lost because the project was never saved (Walkthrough §0). Crimson took 4,450 lines of code and 4.3 hours. The same films as engine blocks would be about 12 beats of parameters (Crimson §6.1). The recipe has to live in Bhippi's tools, not in each model's head.

---

## 2. The working process (teach this first)

This is the order both good films followed, with the time each step deserves in a 15–30 s film. Opus spent 7% on audio, 11% on storyboard and source research, 20% on the UI kit, 33% on building and checking scenes, and 12% on the final render done in parallel with sound (Walkthrough §1).

| # | Step | What to do | Done when |
|---|---|---|---|
| 1 | **Frame** | Ask the size in one line and recommend the reference's shape. | The comp exists. |
| 2 | **Measure the audio** | Loudness and energy per bar give the sections (spoken intro, drop, dip, chorus). Fit the beat grid on spectral flux (Opus: 99.03 BPM, phase 0.456 s, residual under 5 ms), confirm with `analyze_music_beats`, and write down `beat(n)` and `bar(m)`. Get one time per word: `analyze_clip_speech`, and for sung parts isolate the vocal first (centre mask) or transcribe short windows. Keep the *timings*, correct the *words* from the lyric sheet. Note where the snares fall (the 15 s song snaps on every second beat, off the downbeat). | A beat map: every word, bar, drop and snare with its time. Save it with `save_beat_sheet`. |
| 3 | **Study the reference as stills** | 2 fps, 8x6 labelled sheets, read them all. Write its moves in one line each (stage, cursors with tags, caption pill, a word that grows, a zoom through a letter, UI building itself), then recast each in the brand. Check the reference is the video the user named. | A list of 4–8 moves to borrow. |
| 4 | **Plan one scene per line** | Cut on bars; start mid-bar only when a sung line does. For each line pick **a real product moment that literally shows the words** ("turn it up" = the Thinking slider to Maximum; "every call is up to you" = the permission menu; "hands you a clip" = one grey clip). Cap density at one idea per 1.5 s. Save it as the storyboard, not only in your head. | `save_storyboard` / `save_video_blueprint` with times, the product moment, the camera move, the join and the sounds. |
| 5 | **Build the UI kit** | Capture each component from the real app (or rebuild it from the app's CSS and source copy) at 3–4x on a transparent background, **one picture per state**. Measure part boxes from the DOM; never read them off a grid by eye. Check every batch on a sheet *and* with an automatic scan (content bbox under 45% of the texture in both axes means it rendered small). Render all display type with the browser, never with PIL. | Every state the storyboard needs exists and passed the scan. |
| 6 | **Build a scene** | Planes in 3D under a keyed camera, cursors with name tags, eased moves, motion blur on fast moves, blur-in entrances, soft shadows (§4, §5). Every action time comes from the beat map. | The scene renders. |
| 7 | **Look** | Render 4–9 frames **at the moments something happens** (a click, a flip, a landing, both sides of a cut), not evenly spaced. Read the sheet. | You looked. |
| 8 | **Fix** | Name the defect in one line ("the push-in frames the wrong spot"), make one targeted change, re-render the same times. Two looks per scene is normal. | The sheet shows what the storyboard says. |
| 9 | **Joins** | After all scenes exist, render strips at 0.06 s spacing across every cut. | No visible hard cut, no black frame, no pop. |
| 10 | **Sound** | Place a cue on the frame of every UI event (Opus: 98 events plus 16 transition accents) at a level relative to the song's local loudness (§7). | Every cue is audible on laptop speakers. |
| 11 | **Assemble safely and save** | Place, then re-read the comp and check the diff did what you asked (Opus lost the song on A1 once, and 30 of 31 caption moves "changed nothing" without being noticed). Save after every committed step. | `get_comp` shows the song on A1 and every scene where planned. The project is saved. |
| 12 | **Critic pass** | Score the whole film with the rubric in §8, fix the top three items, score again. | The score passes, or three rounds are done. |

**What to avoid in the loop:** re-rendering every part for a small change (8 full re-renders cost Opus 10.8 min), writing diagnostics into the production folder (one overwrote the part manifest), and judging motion only from stills. Watch one playback of each scene at export quality before calling it done.

---

## 3. Timing rules

| Layer | Rule | Examples |
|---|---|---|
| Section changes | On a **bar** | Opus: `bar(6)` = 16.815 s drop, `bar(13)` = 33.78 reveal |
| Mid-section cuts | On the **start of a sung or spoken line** | 22.0, 29.40, 37.40 |
| Hero actions | On the **word onset** (from the transcript) | four cursors arrive on "Claude", "GPT", "Gemini", "local"; the plug lands on "in" |
| Typed or blurred-in words read with the voice | Reveal starts **35 ms before** the onset; the word is readable on its syllable | 15 s film, every word |
| Headlines in explainers | Lead the spoken word by about 0.56 s (existing `COMMON_TIMING`); in launch films sung to music, land on the syllable instead | |
| Repeated actions | On **grid subdivisions**: eighths (0.303 s at 99 BPM) for cards, sixteenths (0.15 s) for tiles and clip drops | plan cards dealt on eighths; bin tiles on sixteenths |
| Echoes in the song | Get a **second hit** | "(hand it the key)" flips all four rows; "(undo)" presses Ctrl+Z again |
| Snares and backbeats | Carry small events: a flare, a sheen, a send, the logo click | 15 s film: send 10.75, whip 11.961, logo 14.384 |
| Drops | Slam, flash and heavy blur on the downbeat; the build before it accelerates (`cubic-in`) | exploded window slams back together in the last 0.43 s |
| Holds | Never dead: a 3–4% slow push, a halo pulse on the bar, chips lighting on a snare | 15 s v2 fixed two dead holds this way (+14% push over 1.7 s) |
| Cadence | Something new every 1.5–3 s; inside a scene, something moves every 0.3–1 s | |
| One move at a time | Never two competing moves in one 0.25 s window (Crit 2 fix 1d) | mark darts *after* the bubble lands |
| Readable holds | A phrase holds until its last word is spoken; the payoff wide holds 10 frames sharp with at most 1% drift; the brand name is sharp for at least 0.35 s before any fade; the picture fades only over the last 8 frames | Crit 1 fix 6, Crit 2 fix 3 |
| Cascades | No faster than about one item per 50 ms, and only as a flurry; a grid of events reads better on sixteenths | Opus S14 cascaded 23 clips at 52 ms steps: "a flurry, not a grid" |
| Exits | Faster than entrances: 0.2–0.35 s on an ease-in | |

---

## 4. Look parameters

### 4.1 Camera

- **Keys, not zooms.** Key the camera as `[target x, target y, scale, rx, ry]` (Opus `cam_view`). Typical values: establishing tilted window `s 0.84, rx 5, ry -9`; pre-drop orbit `s 0.64, rx 15, ry -33`; drop slam `s 0.90, rx 0, ry 0`; close-ups `s 1.85–3.55`. Tilt stays within 2–9° except on drops.
- **Zoom is a dolly.** Move the camera, do not scale the layer: `dz = D(1 − 1/Z)`, so perspective grows as you close in. Key zoom in log space so its speed reads constant (15 s film).
- **Smooth the whole path.** Chained eases stop dead between segments. Low-pass the path (Gaussian, σ 55 ms; 15 ms around a whip). Add a handheld breath: ±5 px, ±0.25° at 0.3 Hz.
- **Stay in front of the camera.** At 3.9x with a 40° yaw a window corner passed behind the camera plane and the renderer broke. Keep every corner at w ≥ 0.04 (15 s v2: 3.4x, 28° yaw, 10° pitch).
- **Aim at parts, not at guesses.** Push-in targets come from measured part boxes (Opus fixed S05 by aiming at the key field's panel point).
- **Close-ups need pixels.** Rasterise the UI at the size it is seen: power-of-two raster boost (K ≥ 0.92·zoom) was the 15 s film's biggest quality win.

### 4.2 Eases (Opus's brand curves; Bhippi names in brackets)

| Role | Cubic-bezier | Bhippi |
|---|---|---|
| Anything arriving | (0.16, 1, 0.3, 1) | `expo-out`, or the array |
| Camera glides, cursor travel, state interpolation | (0.65, 0, 0.35, 1) | `cubic-in-out` / the app's `--ease-swing` |
| Slow drifts, crossfades, pull-backs | (0.37, 0, 0.63, 1) | `sine-in-out` |
| Exits, whips out | (0.7, 0, 0.84, 0) | `expo-in` |
| Into a drop or flash | (0.32, 0, 0.67, 0) | `cubic-in` |
| Slam | (0.05, 0.7, 0.1, 1) | array |
| Chips, stamps, CTA pop | back-out 1.70158 | `back-out` |
| Whip (15 s film) | (0.7, 0, 0.15, 1) | array |

### 4.3 Entrances, depth and shadows

- **Every entrance blurs in:** blur 8–14 px → 0, scale 0.90–0.94 → 1, rise 10–30 px, over 0.3–0.45 s (34 call sites in the Opus film).
- **Word entrances (15 s film):** opacity 0 → 1 in 0.16 s (`cubic-out`), blur 18 → 0 px in 0.35 s (`quart-out`), rise 0.24 em in 0.5 s (`expo-out`), scale 1.035 → 1. Exit: blur 0 → 16 px and fade over 0.28–0.35 s (`cubic-in`).
- **Soft shadows under every card:** colour warm brown `(70, 40, 20)`, never black; alpha 0.24–0.34; blur 24–70; offset about +26 px for a whole window. They read as soft on cream.
- **Depth of field only where layers truly separate:** the exploded window (aperture 7 × explode amount) and a receding window (8 × recede). Everything else is pinhole. Cursors, glows, shadows and toasts never take DOF. In a dark film, rack focus: blur the world 3.2–4.2 px and dim it 32–42% while a line sits over it.

### 4.4 Motion blur

- Shutter 180° by default. **120° on whips, 60–72° on moving text, bubbles and cursors** (a 330 px bubble rise at 180° turned the prompt into "a vertical barcode", Crit 2).
- Samples from screen speed: none under 5 px of streak; otherwise one per 1.6 px, 2 to 48. Keep the whip to about 7–8 frames, landing sharp.
- The cursors and the landing clip stay out of the camera's blur.

### 4.5 Finish

| Film | Recipe |
|---|---|
| **Light stage** (the Opus film) | Cream `#F7F5F1 → #EDE9E3` with a soft highlight, or peach `#FCE8DB` with 16 px/80 px hairlines; static grain 1.1/255 so gradients do not band; no bloom, no vignette. Warm-white flashes `(1.0, 0.97, 0.92)` at joins and drops. A cool grey stage only for the "other AI" contrast. |
| **Dark stage** (15 s v2) | Background radial `#121419 → #090a0d`; +0.7 EV in linear light, then a hue-preserving shoulder (knee 0.45, ceiling 0.80), then display gamma 0.85; vignette 10% (not 22%); saturation-weighted bloom (threshold 0.7, knee 0.2, strength 0.32, weight 0.25 + 0.75·sat) so white type barely glows; a soft key light on the window plane (warm radial, screen blend, 0.25 × clamp(1.7/Z, 0.42, 1)); grain σ 0.011, luminance-shaped; dither to 8 bits. Keep 0–0.5 s as the one low-key moment. |
| **Both** | One or two genuinely bright beats (an ember flash through the word, peak 0.46, decay 0.11 s; a warm halo as the mark wakes). A 105° specular sheen across the window on a snare. |

### 4.6 Type

- One family (Inter at optical size 32, weight 620, tracking −0.038 em in the 15 s film; the app's own fonts in the Opus film). The keyword in the brand colour: "editor" in the editor's blue gradient `#A6D4FF → #2D8CEB`, "producer" in ember `#FFD08A → #FF6A12` (the product's own colour code: blue is your move, ember is the AI at work).
- Headline sizes 150/132/112/90 px at 1080p. Cap top at y ≥ 130 (title safe).
- Typed lines re-centre as they grow, smoothed over 7 frames. Caret 4x62 px, blink 1.65 Hz at 58% duty, solid for 0.35 s after each key.

---

## 5. Scene patterns

Each pattern names where it came from, the parameters, and what reads. §10.4 maps them to templates.

### P1. Type-on to the voice
- Per-word typing that **starts on each word's onset**, 46–66 ms per character (Opus S01), or word blur-ins 35 ms early (15 s film).
- Assert the plan against the data: the character count must equal the typing events (it caught an off-by-one in Opus's first run).
- Two cursors can share the line: "You" types the first half, "Bhippi" flies in on an arc (−0.12) and finishes it, then drag-selects the key word (0.26 s, `cubic-in-out`) with a 5% pop.

### P2. Fly through a word into the product
- The best transition in both films (Crit 1 and 2).
- Opus: zoom `s = exp(ln 270 · (0.35u + 0.65u^2.2))` over 1.0 s, anchored inside the stem of a letter (measured from the DOM); the rest of the line fades in 0.16 s; the next scene shows through the letters, pixelated 36 → 1 px over 0.44 s; zoom blur 0.07 at the peak. The next scene starts in the same close-up, so the letter "opens" onto the app.
- 15 s film: scale 1 → 8 over 0.36 s (`quart-in`) about the lens axis, blur 0 → 10 px, an ember flash as the camera passes through.

### P3. Close on a part, then pull back to the tilted window
- The core product move. Opus S02 keys: `3.55 → 2.75 → 2.55` on the composer, glide up the chat to `1.75, rx 2, ry 5`, then out to `0.84, rx 5, ry −9` over 1.4 s (`cubic-in-out`, 8 motion-blur samples).
- The app works while the camera moves: timeline rows wipe in left to right with a 24 px soft edge, footage fades into the monitor.
- 15 s film: 1.8 s, 3.0x → 0.86x with a 25° swing; the lights come up; a sheen crosses the window on a snare.
- Land it: 10 frames sharp with ≤1% drift before anything else happens.

### P4. Named cursors as the narrator
- One cursor per actor: **You** (blue), **Bhippi** (ember, the mark as avatar), and one per AI provider with its real logo. Role tags (*Cut*, *Titles*, *Sound*) when several Bhippi cursors work at once.
- Tag at (+14, +25) × scale, to the **right of the tip at the tip's height**; tag bottom ≤ y 970; never over a label (a frame check found "Titles ditor…" in v1).
- Constant screen size (1.6–1.8x), not shrinking with the camera.
- Paths on arcs (±0.08–0.12 of the segment); arrive on `expo-out`, travel on `cubic-in-out`; idle jitter ±2 px at 1.3 Hz; a parked cursor bobs 3–5 px.
- Press: scale −14% as a bump (0.05 s in, 0.22 s out). Ring: 16 → 86 px over 0.5 s, opacity (1 − u)·0.9, in the actor's colour. Dwell 55 ms on a target before moving on.
- **The target changes state on the click frame.** Send glows 0.18 s before the click; the composer empties after it; a bubble rises (with a spring, and a low shutter).
- The final park of every cursor is **inside the thing it built**, not in a margin (Crit 2 fix 3c).

### P5. Exploded window on the pre-drop
- Re-cut the window into 9 panels. Depth offsets: back +520, header +300, chat −420, program +120, props +300, project −170, tools −70, timeline −280, meters +170, status −110. Spread each panel out by 7.5% of its distance from the centre.
- Explode over 1.5 s (`cubic-in-out`), hold, slam back together in the last 0.43 s (`cubic-in`) onto the drop. Orbit to `s 0.64, rx 15, ry −33`, then `0.90, 0, 0` on the drop. Aperture 7 × explode. Warm flash 0.55 on the downbeat. Motion blur 6 on the slam.
- The first version was "too subtle": deepen the offsets and double the orbit before you think it is enough.

### P6. Items arrive on their words, and flip on the echo
- Provider rows: each cursor arrives on its name; each row lifts (+1.2%, −10 z, a shadow) while its cursor is there. All four flip to Ready on the echo's words (25.07, 25.31, 25.55, 25.82): a 3.5% pop and a green ring 20 → 140 px.
- The whole panel wobbles slowly (`rx 3 + 1.2 sin 0.7t`, `ry −5 + 2 sin(0.45t + 1)`), so it is never dead still.

### P7. Connect your AI (hub and spoke / constellation)
- The hub (the product mark) pops in (`back-out`). Provider marks from the app's own `ProviderLogo.tsx` fly in on "Connect", 0.2 s apart. Wires draw in 0.28–0.32 s. Light pulses travel along the wires (three per wire, 0.42 s apart). The mark wakes with its own "thinking" motion; green "connected" dots pop.
- Exit: everything squeezes into the centre behind a flash, or the providers collapse into the mark with a low shutter so the mark stays sharp (Crit 2 fix 6).

### P8. The ask and the work (the story beat)
- Frame the composer. Type a prompt of about five words ("Cut this to the beat.") at about 22 characters a second, with a tick per keystroke group. Press Send on a snare (a 0.92 → 1 press and the click sound). The bubble rises with a spring.
- Hold the camera on the conversation at a zoom where the work list's cap height is **at least 26 px**. Let two or three steps tick about 0.25 s apart ("Plan ✓", "Gather ✓", "Cut…").
- Light the hold: pull the panel background down about 30% (text-to-background contrast from 2.3:1 to 4:1), move the key light onto the work list, and add a slow 3% push. This was the flattest shot in v2.

### P9. The edit happens on the timeline
- Clips land on the beat grid: a spring (4.4 Hz, ζ 0.6) from 22 px above, scale-x 0.6 → 1, an ember outline glow decaying at 2.2/s, a ripple ring 5 → 31 px in 0.42 s. The program monitor flashes each new shot (0.155 s) and then plays it.
- Clips cascade in on sixteenths; beat markers drop onto the ruler in a 35 ms stagger; later clips ripple left after a cut (0.12–0.46 s, `expo-out`).
- Keep the monitor in frame while the clips drop (Crit 2 fix 5): the drops are the verb, the monitor is the result.
- Use real footage. Procedural filler reads as filler (Crit 1 fix 5).

### P10. A real control driven through its states
- Opus S07: the cursor opens the Thinking popover (0.16 s, scale 0.94 → 1, rising 10 px); the knob snaps through three levels **on the beats**, each playing five eased in-betweens; the cursor follows the knob position; the camera pushes 1.38x onto the popover.
- Use the same idea for any control the words name: a permission menu hovered then chosen, a brand kit's swatches answering one by one 0.15 s apart.

### P11. Glow point to logo, lockup and end card
- On Send, the composer sinks (blur 16) and the send button becomes an additive glow point that grows 60 → 320 px while the stage goes dark. That point becomes the logo.
- The mark lands on its word or snare; the wordmark lands 0.08–0.16 s later from −50 to −70 px with blur 14 → 0; the subline lands word by word on the transcript times.
- A mark with parts (Bhippi's halves) swings shut on the snare with one warm flash; hide it while it is more than 30° open (Crimson lesson 3).
- End card: lockup, tagline 0.36 s later, CTA pill (`back-out`) 0.70 s later, a cursor clicks the CTA, a continuous 3% push. **The name is sharp for at least 0.35 s** before any fade. The picture fades only over the last 8 frames.

### P12. Contrast beat
- "Most AI hands you a clip": a cool grey stage, a generic prompt, a plain cursor, one desaturated clip (luma mix 0.75) landing on the word "clip". Then the product cursor grabs it, it becomes the first clip, the timeline builds, and the stage warms from cool to light.

### P13. Light as an event
- Power-on sweep: a 260 px smoothstep front crosses every window layer from 24% brightness and 25% saturation to full, with a warm rim `[1.0, 0.72, 0.45]·0.22`.
- Prologue pool: a light pool around one object (the playhead) with up to 70% darkness outside, opening over 2.6 s and breathing on snares.

### P14. Keycaps and physical metaphors
- Ctrl and Z keycaps rise 420 px on the bar and are pressed on "undo" and again on the echo: a 10 px press, a flattened ring, a 60 px horizontal smear; the timeline reverts on the same frame; a "reverted" chip pops.

---

## 6. Joins (hide every cut)

| Join | How | Where |
|---|---|---|
| **Camera match** | The outgoing scene ends on exactly the camera state the next one starts on | Opus S02 → S03 at `[960, 520, 0.84, 5, −9]` |
| **Plunge into the next subject** | End by pushing into the part the next scene opens on | S06 ends on the composer at 2.6x; S07 is the composer |
| **Whip** | 0.3–0.46 s on `expo-in`, 8 samples, 120° shutter, landing sharp | x +1000 or y +700 px |
| **Light point becomes the next scene** | A send glow becomes the logo | S07 → S08 |
| **Flash bridge** | Warm white 0.5–0.9 at drops, then decay; a mirror flash opens the next scene | 16.815, 62.862 |
| **Blur bridge** | Out as a 10 px blur plus desaturation; in from an 8 px blur | S12 → S13 |
| **Fly through a word** | P2 | S01 → S02; 15 s film at 7.1 s |
| **Hard fade to a clean field** | Only before the end card, 0.15 s | 15 s v2 at 13.70–13.85 |

Check every join on a strip of 6 frames 0.06 s apart.

---

## 7. Sound

- A cue on the frame of every UI event: typing sliced to the typing length (80 ms fade), click, pop, tick, swish, glass, sub. Transition accents: whooshes on joins, risers into drops, shimmer on the logo.
- **Set levels relative to the song's local loudness, not in absolute dB.** In v2 most cues sat 20–30 dB under the song's local RMS and were inaudible (Crit 2): ticks −53.6 dB under a −25.6 dB song. Targets relative to the song's 100 ms RMS: ticks −10 to −12 dB (+4 dB shelf at 4 kHz), provider pops −8 dB with a 2 dB duck of the song, send click −6 dB, work-list ticks −8 dB, clip drops −9 dB.
- Loudness −16 LUFS integrated, true peak −1 dBTP (the song alone was +0.4 dBTP). Listen on laptop speakers.
- One sound per visual event; no ticks on words or pills.
- Build the cues from the scene's own action times (the choreography), as one stem.

---

## 8. Review gates and the critic rubric

### 8.1 Gates checked by measurement (every draft)

| Gate | Target | Source |
|---|---|---|
| Mean luma | 45–60 on a dark film (light stage films sit near 170); no jump above 2x the running mean between shots | Crit 1; Crimson lesson 6 |
| Bright UI shots | 98th percentile ≥ 200 | Crit 1 |
| Reading size | Any text meant to be read has a cap height ≥ 26 px at 1080p while it is meant to be read | Crit 1 fix 2 |
| One copy | No phrase on screen twice at once (headline, monitor title, caption) | Crit 1 fix 3 |
| Word sync | Every revealed word is readable within ±50 ms of its onset | Crit 1 method |
| Landings | After every camera move, ≥ 10 frames with sharpness (mean abs. Laplacian) within 10% of the shot's still frames | Crit 2 method |
| End card | Brand name sharp ≥ 0.35 s before any fade | Crit 1 fix 6 |
| Title safe | Cap tops ≥ 108 px from the top at 1080p; tags ≥ 110 px from the bottom | Crit 1 fix 10, Crit 2 fix 3 |
| No broken product states | No broken-image tile, placeholder, local path or dev text in any capture | Crit 1 fix 4; Study §2.5 |
| Audible cues | Every cue ≥ −12 dB relative to the song's local 100 ms RMS | Crit 2 fix 4 |
| Loudness | −16 ± 1 LUFS, ≤ −1 dBTP | Crit 1 fix 7 |
| Parts | No part texture whose content is under 45% of its size in both axes | Walkthrough §5 |

### 8.2 The rubric the critiques used (reuse it for `judge_edit` on launch films and for the benchmark)

Ten criteria, 0–10 each:

1. Premium look and lighting (**counts double**)
2. Real product UI used well (**counts double**)
3. Camera motion and depth (DOF, motion blur)
4. Typography and type animation
5. Sync to voice and beat
6. Storytelling: does a viewer get what the product is? (**counts double**)
7. Transitions and flow
8. Polish: artifacts, aliasing, safe areas, jank
9. Originality
10. Audio

The weighted total is out of 130. It is calibrated so that the Opus film's 0–15 s stretch scores **77** and the 15 s v2 scores **84**. Every critique lists what to keep and the top fixes, most impactful first, each with the time range, what is wrong now, and a fix with numbers.

---

## 9. Traps (what went wrong, and the rule that prevents it)

| Trap | Cost | Rule |
|---|---|---|
| A negative screenshot clip made Chrome render 32 parts at 1x; missed on a sheet | About 7 min, a wasted re-render | Put parts at page origin 40 px or more; scan every render automatically |
| A sans font fell back to serif over `file://` | A re-render | Declare fonts with absolute URLs; check `document.fonts` and look for a serif on the first sheet |
| Full re-render of 220–328 parts for each small change | 10.8 min | Cache by content hash |
| Parallel workers read half-written cache files | 2 crashes | Atomic writes (temp file, then rename); retry reads |
| Sprite cache keys built from floats wrote a new PNG per frame | Disk | Quantise sprite parameters |
| Audio `place` ops in `apply_edit` ignored their track and overwrote the song on A1 | An undo, a lost −1 dB trim | Place audio with `place_clip {audioOnly, audioTrack}`; treat any "−N clips" in a preview as a blocker |
| A bulk caption transform answered "nothing changed" twice, unnoticed | 30 of 31 captions never moved | Read the diff; assert that something changed |
| The project was never saved after assembly | The whole timeline was lost | Save after every committed step |
| A chat bubble at a 180° shutter smeared into stripes | The worst half-second of v2 | Low shutter on moving text |
| A camera corner crossed the near plane | Random polygon artifacts | Keep every corner in front of the camera |
| The same phrase in three places | −points for polish and typography | One copy on screen |
| Too dark | −8 or more | Exposure gate |
| The ask is never seen | Storytelling capped at 8 | Type the prompt and press Send on screen |
| Judging only stills | Pacing and ghosting unknown | One playback per scene at export quality |

---

## 10. How these lessons enter the app

Five channels, each with a draft ready to paste. The engine features these drafts point to (named cursors, UI camera, per-part states, capture with states, finish presets, new templates) are the upgrade plan's items; until they land, the drafts name today's stand-ins in `gaps`.

| Channel | File | What it carries | When the model sees it |
|---|---|---|---|
| **Playbook** | `src/lib/motionDirection.ts` (`PLAYBOOKS`) | Beats, look, timing, rules, tools, eases, features, pacing and gaps for launch films | `motion_guide {topic:"launch-film"}`, and in `toolset.playbook` when the genre is detected |
| **Brain skill** | A `SKILL.md` saved with `brain_save_skill` (seeded once), loaded with `brain_load_skill` | The working process of §2 as a procedure, with the loop and the traps | When a launch or product film starts; scored by turn outcome in `brain.rs` |
| **Prompt text** | `src-tauri/prompts/copilot.md`, MOTION ENGINE section (under `<!-- only: saas motion -->`) and the pipeline section | A short route for "a film that shows the product", pointing at the playbook and the skill | Every turn in those genres |
| **Template and compiler defaults** | `src/motion/ui/compile.ts`, `src/motion/kit/*`, `src/motion/types.ts` | The numbers of §4, so a model that writes no parameters still gets them | Always |
| **Judge and critic** | `src/lib/judge.ts`, the council | The gates of §8.1 and the rubric of §8.2 | `run_frame_qa`, `judge_edit` |

### 10.1 Playbook draft (paste into `PLAYBOOKS` in `src/lib/motionDirection.ts`)

Every tool, ease, effect and feature named here exists today, so it passes `tests/motionDirection.test.ts` as written. When the upgrade plan's items land, update `how`, `features` and `gaps` (the plan lists which item changes which line).

```ts
  {
    id: 'launch-film',
    title: 'Product launch film to music (the real app, a camera through it, cursors as narrators)',
    use: 'A 15–110 s launch or feature film set to a song or a voice-over that shows the user’s real product being used: Bhippi’s own “Meet Bhippi” film (80/100) and its 15 s rebuild (84/100). Plan one scene per sung or spoken line; each scene is a real product moment that literally shows the words.',
    films: ['Meet Bhippi launch film (Opus, 80/100)', 'Meet Bhippi 15 s rebuild (84/100)', 'Relume launch film (reference)'],
    beats: [
      { name: 'Open', seconds: [0, 3], what: 'The product’s own object is born (a playhead, a caret on a light stage) or a line types on; named cursors enter. Nothing is ever a black or static frame for more than 0.5 s.', how: 'text.type with a bar caret, or a UI part from create_ui_screen; slow camera drift; tick on the first snares' },
      { name: 'First line', seconds: [3, 5.5], what: 'The first line lands word by word on the voice (reveal 35 ms before each onset) in the product’s colour code; the camera then pulls back from one part to the whole window, tilted 5°/−9° at 0.84×.', how: 'text.cascade with {word} times from analyze_clip_speech; create_ui_screen, then a camera layer keyed close → wide (see gaps); motionBlur on the glide' },
      { name: 'Fly through a word', seconds: [5.5, 8.5], what: 'The key word is selected by a cursor, grows, and the camera flies through one of its letters into the product; the next scene shows through the letter.', how: 'the word as a text track matte over the next scene, scale keyed on an accelerating curve (0.35u + 0.65u^2.2), mosaic 36 → 1 px, zoom-blur at the peak; or create_motion_sequence with zoom-through' },
      { name: 'Connect', seconds: [8.5, 10.5], what: 'Provider marks fly in on their names, wires draw to the product mark, pulses run along them on the next word, the mark wakes.', how: 'shape groups (svg_to_shape of the real logos), stroke trim for the wires, a dot moving along each wire, back-out pops; pop cues' },
      { name: 'Ask and work', seconds: [10.5, 13], what: 'The prompt is typed in the real composer (about 5 words), sent on a snare, and the steps tick 0.25 s apart at a readable size (cap height ≥ 26 px); then the timeline fills clip by clip on the beat grid while the monitor flashes each new shot.', how: 'create_ui_screen type + click actions; camera hold at 2.2–3.2× on the work list; clips landing with a spring on sixteenths; tick and pop cues' },
      { name: 'Payoff and lockup', seconds: [13, 15], what: 'The whole product at work, sharp for at least 10 frames; then a clean field, the mark lands on the snare with one warm flash, the name is sharp for ≥ 0.35 s; the picture fades only over the last 8 frames.', how: 'camera pull-back that lands, then brand-logo-sting or brand-end-card; glass + sub cues on the snare' },
    ],
    look: [
      'The real product UI, pixel-sharp at every zoom (parts rasterised at 3–4×), changing state on the frame of each action. Never a mock-up, a stock UI or a still plate standing in for a scene.',
      'Light stage: cream #F7F5F1 → #EDE9E3 with a soft highlight, or peach #FCE8DB with 16/80 px hairlines, static grain; a dark ember stage only for reveals; a cool grey stage only for the “other tools” contrast.',
      'Dark stage: lift it — mean luma 45–60, UI shots with a 98th percentile ≥ 200; bloom only saturated colour (threshold ~0.7) so white UI never glows; vignette ≤ 10%.',
      'Soft warm-brown shadows (alpha 0.24–0.34, blur 24–70) under every card and window; depth of field only where layers truly separate.',
      'The product’s own colour code carries meaning (in Bhippi: blue = your move, ember = the AI at work); one type family; keyword in colour.',
    ],
    timing: [
      ...COMMON_TIMING,
      'Scene changes on bars; mid-section cuts on the start of a sung or spoken line; hero actions on word onsets; repeated actions on eighths or sixteenths; echoes in the song get a second hit; small events (flares, sheens, the send, the logo click) on the snares.',
      'Words read with the voice land on the syllable: the reveal starts 35 ms before the onset (opacity 0.16 s, blur 18 → 0 over 0.35 s, rise 0.24 em). Typing: 46–66 ms per character from the word’s onset.',
      'Camera: keys of [target, zoom, rx, ry]; establishing 0.84× at 5°/−9°, close-ups 1.85–3.55×, pre-drop orbit 0.64× at 15°/−33°; glides on [0.65,0,0.35,1], arrivals on [0.16,1,0.3,1], exits on expo-in. Zoom is a dolly keyed in log space; tilts stay within 2–9° except on drops.',
      'Entrances: blur 8–14 px → 0, scale 0.90–0.94 → 1, rise 10–30 px over 0.3–0.45 s.',
      'Motion blur: 180° shutter; 120° on whips (7–8 frames, landing sharp); 60–72° on moving text, bubbles and cursors; more samples the faster the move (one per ~1.6 px of streak).',
      'Every move lands: 10 frames sharp with ≤ 1% drift before the next thing happens; never two competing moves in one 0.25 s window.',
      'Holds breathe: a 3–4% push, a pulse on the bar, chips lighting on a snare. No dead hold longer than ~1 s.',
      'End card: brand name sharp ≥ 0.35 s before any fade; picture fade over the last 8 frames only.',
    ],
    rules: [
      'Each scene is a real product moment that shows the line’s words (turn it up = the effort slider to Maximum; every call is up to you = the permission menu). Plan it in the storyboard with its times before building.',
      'Show the ask: type the prompt and press Send on screen before the product works.',
      'Named cursors tell the story: You, the product, each AI provider with its real logo. Tags right of the tip, never over a label; constant screen size; the final park inside the thing they built. The target changes state on the click frame.',
      'Say each phrase once: never the same words in a headline, a monitor title and a caption at the same time.',
      'Hide every cut: camera-state match, a plunge into the next subject, a whip, a light point that becomes the next scene, a warm flash on a drop, or a fly-through a word.',
      'Build, then look: after every scene render frames at the moments of action (clicks, landings, both sides of each cut), name the fault in one line, fix it, look again. Check joins on 0.06 s strips.',
      'Every UI event has a sound on its frame, set relative to the song’s local loudness (ticks −10 to −12 dB, clicks −6 dB); master −16 LUFS, −1 dBTP.',
      'Check every capture for broken images, placeholders, local paths and dev text before it goes in.',
      'Save the project after every committed timeline step; read every diff (an audio place can land on the wrong track; a bulk transform can change nothing).',
    ],
    tools: ['analyze_clip_speech', 'analyze_music_beats', 'save_beat_sheet', 'save_storyboard', 'capture_product_ui', 'create_ui_screen', 'update_ui_screen', 'create_motion_scene', 'update_motion_scene', 'get_motion_scene', 'create_motion_sequence', 'list_transitions', 'svg_to_shape', 'add_sound_effect', 'snap_cuts_to_beats', 'check_pacing', 'run_frame_qa', 'judge_edit'],
    eases: ['expo-out', 'cubic-in-out', 'sine-in-out', 'expo-in', 'cubic-in', 'back-out', 'push'],
    features: ['text.type', 'text.cascade', 'camera.aperture', 'camera.dof', 'link', 'bleed', 'scene.cues', 'effects.drop-shadow', 'effects.zoom-blur', 'effects.directional-blur', 'effects.mosaic', 'effects.grain', 'effects.exposure'],
    pacing: { swapGap: [0.6, 3], entrance: [4, 14], beatSync: 0.7, readingWps: 3.5 },
    gaps: [
      'Named cursors: create_ui_screen has one unlabelled cursor. Until cursors take labels, add each tag as a shape + text pair that follows the cursor with link: [{prop:"position", from:"<cursor layer>"}], and a second cursor as its own layer with keyed positions.',
      'UI camera: create_ui_screen’s zoom is a 2D scale and its tilt is static. For the close → pull-back, build the screen with its final actions first, then add a camera layer and set threeD on the screen with update_motion_scene (addLayers, patches). Key focus by hand at every camera key (there is no autofocus yet). Do not call update_ui_screen afterwards: it rebuilds the scene and drops those layers.',
      'Part states: a screen state is a whole page. For a button that turns on or a composer that fills, use a second state with transition "cut" timed to the click, or draw the changing text live with a type action.',
      'Capturing the real product: capture_product_ui is one flat screenshot with no states; mark part boxes carefully off its grid, or rebuild the component in HTML from the app’s real CSS and copy (create_ui_screen html with data-part names) at resolution 3.',
      'No cinematic finish preset yet: add one adjustment layer with grain (small) and, on dark films only, exposure; never glow a white UI.',
    ],
  },
```

**Related edits in the same file:**
- `saas-explainer.gaps` (line 72) still says `capture_product_ui` "is coming". Replace it with: `'capture_product_ui gives one flat screenshot; mark part boxes off its grid, or rebuild the screen from the product’s CSS. Per-part states and DOM boxes are not available yet.'`
- `product-launch` and `ui-walkthrough`: add `'camera.aperture'`, `'camera.dof'` and `'scene.cues'` to `features`, and to `rules` add: `'For a launch film set to a song, or any film that shows the product in depth, use motion_guide {topic:"launch-film"}.'`

### 10.2 Brain skill draft

Save it once with `brain_save_skill {name:"launch-film-render-look-fix", description:…, body:…}`, or ship it as a seed skill that `brain.rs` copies into `skills/` on first run (the plan's item U0.4). It is scored by turn outcome like any skill.

```markdown
---
name: launch-film-render-look-fix
description: Make a product launch film that shows the real app, timed to a song or voice-over, and check every scene on frames before moving on. Load for launch films, product demos to music, "make it motion graphic and use the real UI".
version: 1.0.0
---

# Launch film: measure, plan, build, look, fix

Use motion_guide {topic:"launch-film"} for the numbers. This is the procedure.

## 1. Measure before planning (about 10% of the time)
- analyze_clip_speech on the song or voice-over. For sung parts, transcribe short windows or an isolated vocal; keep the timings, correct the words from the lyric sheet.
- analyze_music_beats: bars, drops, the snare pattern. Write the beat map with save_beat_sheet: every word, bar, drop and snare with its time.

## 2. Plan one scene per line (about 10%)
- For each line pick a real product moment that literally shows the words. Name the part, its states, the camera move (from → to), the cursors (who clicks what, when), the join into the next scene and the sounds.
- Cap density at one idea per 1.5 s. Save the storyboard with the times.

## 3. Build the kit (about 20%)
- Capture or rebuild every part the storyboard needs, one picture per state, at 3–4×. Measure boxes; never guess them.
- Look at every batch on a sheet. Reject: tiny content in a big picture, a serif fallback, broken images, placeholders, local paths.

## 4. Build and look, scene by scene (about 35%)
For each scene:
1. Build it with its times from the beat map.
2. Render 4–9 frames at the moments something happens (click, flip, landing, both sides of each cut). Use run_frame_qa with explicit times.
3. Write the fault in one line. Typical: the push-in frames the wrong spot; the depth is too subtle; ghosting on a fast move; cursors overlap; a part runs off frame; text too small to read; two things move at once.
4. Change only that, render the same times again.
Two looks per scene is normal. Do not start the next scene with a known fault in this one.

## 5. Joins and sound (about 15%)
- Frames 0.06 s apart across every join: no hard cut, no black frame, no pop.
- A sound on the frame of every UI event, set against the song's local loudness (ticks −10 to −12 dB, clicks −6 dB). Master −16 LUFS, −1 dBTP.

## 6. Assemble, save, criticise (about 10%)
- After every timeline commit: get_comp, check the song is still on A1 and the diff changed what you asked. Save.
- judge_edit. Fix its top three items. Judge again (up to three rounds).
- Gates: mean luma 45–60 on dark films; readable text ≥ 26 px cap height; one copy of each phrase; every move lands sharp for 10 frames; brand name sharp ≥ 0.35 s; cues audible.

## Traps
- An audio place in apply_edit can land on A1 and replace the song: use place_clip with audioTrack.
- A bulk change that answers "nothing changed" did nothing.
- update_ui_screen rebuilds the scene: add cameras and finish after the last UI change, or as spec fields.
- 180° shutter on moving text smears it: lower the shutter for text, bubbles and cursors.
- Never leave the project unsaved at the end of the turn.
```

### 10.3 Prompt text (paste into `src-tauri/prompts/copilot.md`)

**A.** In the MOTION ENGINE section, as a new bullet after **Living product UI** (under the existing `<!-- only: saas -->` marker):

```markdown
- **A film that shows the product** (a launch film to a song, a feature film, "use the real UI"): call `motion_guide {topic:"launch-film"}` and `brain_load_skill {name:"launch-film-render-look-fix"}` first. The film is the real product being used: one scene per line, each a real product moment that shows the words, built from captured parts with their states (never still plates standing in for scenes). A camera moves through the product (close on a part → pull back to the tilted window), named cursors act (You, Bhippi, each AI with its logo), and every action lands on a word or a beat from the beat map. After each scene, render frames at the moments of action with `run_frame_qa {times}`, fix the one thing that is wrong, and look again before the next scene. The film is judged on light, reading size, one copy of each phrase, sharp landings and audible sound, not only on overlaps.
```

**B.** In the pipeline section, after the GATHER bullets (the motion-first route; the guard change itself is plan item U0.1):

```markdown
- **Motion films that show the product** (the plan's scenes are motion scenes over captured UI, not footage): GATHER builds the kit, not pictures of scenes. It captures every UI part and state the storyboard names (`capture_product_ui`, or `create_ui_screen` html from the app's real CSS), measures the words and beats into the beat map, and checks each capture on a sheet. A still image may be a texture inside a scene (a screenshot, a logo); it is never the scene. EDIT builds each scene as an animated motion scene on the beat map and runs the look-and-fix loop per scene.
```

### 10.4 Template and compiler defaults

These put §4's numbers where no model has to remember them. File names are from the audit; the plan gives the work.

| Default | Value | Where |
|---|---|---|
| UI part resolution | 3 (4 when a camera zoom above 2.5× is keyed) | `src/motion/ui/spec.ts` `resolution`, `raster.ts` |
| UI entrance | blur 10 → 0, scale 0.92 → 1, rise 20 px, 0.38 s, `expo-out` | `ui/compile.ts` placement (442–479) |
| Screen shadow | warm brown `rgb(70,40,20)`, alpha 0.3, blur 60, offset (0, 26) | `ui/compile.ts:478` |
| Cursor | press −14% (0.05/0.22 s), ring 16 → 86 px over 0.5 s, arcs ±0.1, idle jitter 2 px, constant screen size | `ui/compile.ts` cursor block (416–440) |
| Motion blur on UI | on for the screen, parts and cursor; scene shutter 180°, 72° on text layers | `ui/compile.ts` (474–479), `types.ts` scene `motionBlur` |
| Word entrance preset | opacity 0.16 s, blur 18 → 0 over 0.35 s, rise 0.24 em over 0.5 s, scale 1.035 → 1, lead 35 ms | `src/motion/text.ts` cascade presets |
| Typing | 46–66 ms per character from a word onset; caret 1.65 Hz at 58% duty, solid 0.35 s after a key | `text.ts` `type` |
| Light stage | cream gradient + highlight + static grain 1.1/255 | `kit/common.ts` `stage()` |
| Flash bridge | warm white `(1.0, 0.97, 0.92)`, 0.5–0.9, decay 0.18–0.28 s | `sequence.ts` transitions |
| Glow on light UI | off by default; bloom threshold ≥ 0.7 and saturation-weighted when on | the finish preset (plan U4.1) |

### 10.5 Judge and critic text

For `judge.ts` `genreChecks`, a launch-film genre (or extend `saas` when the plan has a song and UI scenes). This is a skeleton: the checks' bodies, the `'launch'` member of `Genre` and its `MOTION_TARGET` (0.85) are plan item U0.5.

```ts
    case 'launch':
      return [
        ['the real product UI carries most scenes (ui-screen or captured parts)', /* share of scene time with a ui-screen or capture layer ≥ 0.6 */],
        ['a camera moves through the product (a camera layer with 2+ keys in a UI scene)', /* … */],
        ['the ask is shown (a type action followed by a click on the same screen)', /* … */],
        ['no still image stands in for a scene (image clips on V1 ≤ 10% of the film)', /* … */],
        ['an end card with the brand name held ≥ 0.35 s', /* … */],
      ];
```

For the council critic seat (a prompt, used by `judge_edit` on launch films and by the benchmark): "Score the film on the ten criteria of the launch-film rubric (look, product UI, camera, type, sync, story, flow, polish, originality, audio), 0–10 each; look, product UI and story count double. Measure before you judge: mean luma and the 98th percentile per second, the cap height of the text a viewer must read, the frame each word becomes readable against its onset, the sharpness of each landing, and each cue's level against the song's local loudness. List what to keep, then the top fixes, most impactful first, each with its time range, what is wrong now and a fix with numbers."
