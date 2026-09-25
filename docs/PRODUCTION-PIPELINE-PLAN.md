# Bhippi production pipeline — plan and status

Written 2026-09-22. This is the plan for making Bhippi AI behave like a producer
and an editor: plan first, gather second, edit third, polish last, with the user
pressing a button between each phase. It also covers the Crimson motion-graphic
system, the magic eraser, beat-aware sound, and the rebuilt system monitor.

## What was wrong (measured, not guessed)

| Finding | Where | Effect on the user |
|---|---|---|
| Every tool call except three timed out at 60 s on the Rust side | `src-tauri/src/ai_tools.rs` `CALL_TIMEOUT` | Video generation (waits up to 6 min) and `ask_user` (waits for a human) failed with "Bhippi did not respond" while the frontend kept working. The model then improvised. |
| Generation and download tools were always allowed | `src/lib/editWorkflow.ts` `preparation` set | The model generated media during planning, before any script or shot list existed. |
| Blueprint asset status never advanced | nothing writes `status: 'ready'` | The "0/N assets ready" badge was permanently 0; the user could not see progress. |
| HTML motion graphics export as one static white title | `project.rs` `Graphic::from_clip`, `video.rs` `role()` | Every animated card, chart or panel became a centred white line of text in the MP4. |
| Keyframe easing was linear / hold / smoothstep only | `keyframes.ts`, `render.rs` | Nothing could feel weighted or dynamic. |
| No video inpainting | `workers/` | Text behind the subject showed the original subject ghost through gaps; no clean plate. |
| No beat detection, no loudness leveling | `src/lib`, `src-tauri/src` | Cuts and graphics could not land on the beat; dialogue and music levels were guesses. |
| Crimson guideline was four sentences | `aiTools.ts` `create_project_guideline` | The reference HTML guides the user supplied were not in the product. |
| System monitor showed CPU + RAM + a process list | `src/components/ResourceMonitor.tsx` | No GPU, no VRAM, no storage bar, no progress bars on jobs. |

## The pipeline (what the AI does now)

```
PLAN ──[Start generating]──▶ GATHER ──[Start editing]──▶ EDIT ──▶ POLISH ──▶ DONE
```

1. **PLAN** — `editing_workflow_status`, `get_comp`, transcribe and scan existing
   footage, `online_research` (facts + source links), `query_frame_atlas`,
   write the script, break it into 5–7 s shots, decide per shot whether it is
   generated (text-to-video with its own short prompt), downloaded/scraped,
   or existing footage, decide the motion graphic for the beat, the transition,
   the SFX, the music. Save with `save_video_blueprint` (from scratch) or
   `save_storyboard` (existing footage) — both now carry `research`, `script`,
   `music` and per-scene `shots` / `mogrt` / `transition` / `sfx`. The turn ends.
   Generation, download and timeline tools are refused in this phase.
2. **Start generating** button (chat) → phase `gathering`, message sent.
3. **GATHER** — voice-over, `generate_local_media` per shot (5–7 s, one shot
   per call, `sceneIndex` attaches the result to the plan automatically),
   `download_online_media` / `scrape_videos` into `Research: …` folders, music.
   Every asset lands in the plan manifest with a real asset id and status
   `ready`. `finish_gathering` checks that every scene has its media and
   ends the phase. Timeline tools are still refused. The turn ends.
4. **Start editing** button → phase `editing`, message sent.
5. **EDIT** — `execute_blueprint` (scratch) or the storyboard (footage); cuts
   with `apply_recipe` / `apply_edit`; `level_audio` (dialogue −16 LUFS,
   music bed 20 dB under); `analyze_music_beats` + `snap_cuts_to_beats`;
   `seamless_transition` on beats; `rotoscope_clip` → `erase_subject_clip`
   (clean plate) → `add_text_behind_subject` with the erased plate;
   `layout_clip` (presenter 55 % side, panel on the other side, PiP);
   `create_motion_graphic` with the Crimson templates; SFX on events.
6. **POLISH** — `run_frame_qa` samples frames, reports every overlap between
   graphics/text and the subject or captions, and returns contact sheets for
   the model to look at; the model fixes them; `verify_edit_workflow` now
   requires the QA receipt.

## Work items

### A. Pipeline core (frontend + prompt)
- [x] `types.ts`: `Production` record on the comp (phase, gates, research,
      script, music, manifest), richer scene fields, new easings.
- [x] `editWorkflow.ts`: phase gates, receipts for gathering/QA, `verify` needs QA.
- [x] `aiTools.ts` + `ai-tools.json`: `save_video_blueprint` / `save_storyboard`
      extended; `attach_production_asset`, `finish_gathering`, `run_frame_qa`,
      `layout_clip`, `seamless_transition`, `analyze_music_beats`,
      `snap_cuts_to_beats`, `level_audio`, `erase_subject_clip`, `reveal_subject`.
- [x] Chat UI: phase stepper with **Start generating** / **Start editing**,
      live asset manifest, per-scene status.
- [x] `copilot.md` rewritten around the phases and the Crimson rulebook.
- [x] Rust `ai_tools.rs`: per-tool timeouts (ask_user waits for the human;
      generation, downloads, roto, erase, QA get 30 min).

### B. Motion graphics that export
- [x] `motionGuide.ts`: Crimson tokens, CSS system, keyframes, layout recipes
      and the rulebook text, exposed to the model as the default guideline.
- [x] `motionGraphics.ts`: Crimson templates (ribbon title, teaching card,
      connected map, numbered lanes, side panel, editorial quote, comparison,
      stat chart, roadmap, cursor demo, cubes reveal) plus the missing
      countdown / breaking-news; layout, size and position parameters.
- [x] HTML → PNG frame renderer in the webview (`htmlFrames.ts`), run before
      export; Rust export overlays the frame sequence with alpha instead of a
      static title.
- [x] Easing: ease-in, ease-out, ease-in-out, overshoot in TS and FFmpeg.

### C. Sound
- [x] `beats.ts`: onset envelope from the waveform peaks, tempo by
      autocorrelation, beat grid; `snap_cuts_to_beats`.
- [x] `audio_loudness` (EBU R128 via ffmpeg) + `level_audio`.

### D. Magic eraser
- [x] `erase` adapter (LaMa big-lama), installer, `magic_erase.py`
      (temporal-median clean plate + LaMa fill + per-frame composite),
      `erase_start` command, `erase_subject_clip` tool, behind-subject
      sandwich on the erased plate, `reveal_subject` (wipe / cubes).

### E. System monitor
- [x] `hardware.rs`: GPU utilisation, VRAM, temperature (nvidia-smi, with a
      PowerShell counter fallback), every fixed drive.
- [x] `ResourceMonitor.tsx`: RAM / GPU / Storage cards with icons and bars,
      running tools and jobs with progress bars, collapsible process list.

### F. Verification
- [x] vitest for gates, plan validation, beats, layout, templates, renderer maths.
- [x] `tsc -b`, `cargo check`, `cargo test` on the touched crates.

## Verified on 2026-09-22

| Check | Result |
|---|---|
| `npx vitest run` | 51 files, 342 tests pass (1 skipped) |
| `npx tsc -b` | clean |
| `npx eslint` on every changed file | clean |
| `cargo check -p bhippi` | clean |
| `cargo test -p bhippi --lib` | 142 pass, 2 ignored (live provider tests) |
| `cargo clippy --all-targets -D warnings` | fails on **pre-existing** dead-code lints in `mcp_client.rs`, `render.rs`, `roto.rs`, `web_media.rs`, `subagent.rs`; nothing new from this work |

## Known limits (say these to the user, do not hide them)
- The HTML frame renderer rasterises through SVG `foreignObject`: `backdrop-filter`, external images/fonts and `<video>` do not survive. The Crimson templates avoid all three; a `custom` template that uses them will export without those parts.
- `run_frame_qa` knows where the subject is only for clips that have been rotoscoped; without a matte it checks graphics against each other and the safe area, and says so.
- `reveal_subject` is opacity + scale keyframes plus the cubes overlay, not a per-pixel alpha wipe.
- The magic eraser's `clean-plate` mode assumes a mostly static camera; `per-frame` handles a moving camera slowly.
- Beat detection works from the 100 Hz waveform peaks; it is reliable for music with a clear pulse, less so for ambient beds (the tool reports its confidence).
- Rendering frames for export takes roughly 0.1–0.2 s per frame at 1080p, so a 6 s graphic adds ~20–40 s before FFmpeg starts.
- Noticed in passing (not fixed): `local_media_install` never copies `person_track.py` beside `worker.py`, so the person-track installer's import fails; the LTX 2.3 worker prints plain-text progress that the job harness ignores; several absolute `C:\Users\aayus\...` paths are hard-coded in `lib.rs` and `ltx23_worker.py`.
