# Local media and assisted editing implementation plan

## Acceptance rule
An installed model is not a working integration. Each supported task must produce a real artifact, import it, place it on the intended timeline range, survive save/reopen, and export correctly. Unavailable models must report unavailable, never substitute a procedural effect while claiming inference.

## 1. Repair the existing Roto path
- Grant scoped access to installed weights and extracted frames; propagate packing errors.
- Give every run its own immutable output, avoiding stale frames and collisions between shots.
- Share the inference path with the AI tool, expose progress, preserve undo.
- Preserve floating model output as 16-bit alpha and a lossless master. Add a browser-compatible preview separately.
- Bind matte time to source time, including trims, speed, reverse and frame holds.
- Apply the same editable corrections in preview and export, with include/exclude, brush softness and frame ranges.
- Verify a real model run and composited export before claiming Roto works end to end.

## 2. Establish analysis before editing
- Obtain existing word timestamps or transcribe missing speech without creating visible subtitles automatically.
- Inspect shots using bounded batches of actual frame images; use dense frame indexing when needed without filling a language model prompt with every frame.
- Persist a concise storyboard with source/timeline ranges, evidence, intent, visual actions, sound cues and dependencies.
- Preserve spoken repetitions and distinguish source words from duplicated transcription windows.
- Require tools to report what was observed versus proposed. A filename is not visual understanding.

## 3. Local model execution and settings
- Dedicated Local Media settings: Image, Video, Audio/Music, Roto, Depth and 3D.
- Isolated specialist Python runtime, JSON job protocol, progress, cancellation, disk checks, GPU memory scheduling and explicit errors.
- Pin checkpoint revisions, verify downloads, show model-specific license and hardware requirements.
- Capability states: unavailable, installable, installed, verified; installation alone never means verified.
- Direct runtimes only, no ComfyUI dependency. Existing chat providers remain the editing planner.

## 4. Generation and timeline tools
- Image: text-to-image, transparent icon workflow, image edit/inpainting, structural conditioning and upscale.
- Video: image-to-video, text-to-video, masked editing and endpoint-conditioned transition only when supported by the chosen model.
- Audio: music and sound effects with duration, scene cue sheet, fades, ducking, loudness and beat alignment; never promise exact musical structure from a text prompt alone.
- 3D: image-to-mesh, explicit supported format, camera/light placement and actual rendering into the composition. Gaussian splats and meshes require different importers.
- Tools validate capability, inputs, dimensions, durations and timeline destinations. Return asset IDs and job IDs, not invented paths.

## 5. Advanced Roto comparison
- Benchmark SAM 2.1 segmentation/tracking plus generated trimaps and ViTMatte refinement against RVM on identical footage.
- Test hair, motion blur, holes, thin objects, spill, occlusion/re-entry and temporal flicker; include alpha reference metrics where ground truth exists and human review otherwise.
- Track correction time, runtime, VRAM and failure rate. Segmentation masks are not production alpha mattes.
- Review SAM 3.1 separately. Keep MatAnyone2 and VideoMaMa restricted until intended commercial use is permitted; review CorridorKey separately.
- Keep existing Roto available until a replacement demonstrates improvement. Preserve straight/premultiplied alpha and color management.

## 6. Verification and rollout
- Test real inference for each advertised adapter, actual imports, timeline edits, cancellation and exported pixels/audio.
- Reopen saved projects, undo generated insertions, handle missing models and offline checkpoints.
- Profile playback with effects and Roto rather than clamping elapsed playback time to disguise stalls.
- Maintain an explicit implementation ledger. Catalog screenshots are references, not evidence of available runtimes or commercial rights.

## Initial audit
Existing RVM weights are present. SAM/ViTMatte and generation runtimes are absent. Roto access grants and error propagation are missing; AI has no Roto tool. Existing correction and preview paths need further work. No comparative model benchmark has been completed.

## Implementation ledger — 19 September 2026

### Implemented and checked
- Dedicated Settings → Local Media downloads for SDXL, Wan text-to-video, Stable Audio Open, SAM 2.1 and ViTMatte. Shared SDXL weights support image generation, image-to-image and masked image replacement adapters. Download status refreshes automatically; duplicate downloads are refused. Completed external SDXL installation is discovered without restarting the app.
- AI capability, installation, generation, job status and completed-artifact import tools. No arbitrary worker actions or output paths are accepted from the AI. Input images are resolved from imported asset IDs.
- Transcript retrieval without creating captions; actual image evidence returned over native chat and MCP; sequential frame-review cursor handles source trim, speed, reverse and hold. Sampling is explicitly different from reviewing every frame.
- Concise timed storyboards persist in the composition and appear in chat with clickable scene times. Storyboards are clearly labeled plans.
- One-step editable background/title/Roto-foreground construction, with animated title and preserved source timing.
- Editable music/SFX gain cues, fades and transcript-driven speech ducking. Existing gain automation is multiplied. This does not synthesize tempo changes or guarantee musical quality.
- RVM runtime/asset access repaired; immutable matte runs; lossless 16-bit alpha master and separate browser preview; real FFmpeg pixel regression passed.
- SAM 2.1 + ViTMatte installed, ran on six actual frames using CUDA, and retained segmentation/trimap/alpha outputs. RVM remains the default. Matched-input comparison is only a smoke test, not evidence of superior human mattes.
- Roto brush drag, radius, softness, per-frame correction clearing and undo. Preview prefetches bounded matte frames and avoids per-frame CPU readback of decoded video.
- Genuine subtitle repetitions retained while overlapping duplicate timing windows are filtered; audible audio clips drive transcript placement.

### Running download
SDXL official fp16 safetensors are downloading in the background. SHA256 is checked against official repository metadata. Completed chunks remain resumable. Do not stop this download at the user's request. A watcher exposes byte progress to Settings; the model is not marked installed until verified.

### Not yet completed — do not advertise as available
- Actual SDXL image/edit/inpaint output review and timeline/export acceptance; checkpoint download is still in progress.
- Actual Wan and Stable Audio inference; their adapters exist but weights/output validation remain outstanding. Stable Audio's gated access requires authorized model access.
- Image-to-video, endpoint-conditioned video transitions, temporally coherent masked video editing, ControlNet/depth/upscale adapters, dedicated music composition models.
- Image-to-3D generation, mesh/splat import, scene camera/lighting and rendering. No 3D generator is exposed as a working tool.
- SAM 3.1 runtime/license review and quality benchmark. MatAnyone2/VideoMaMa stay restricted; CorridorKey requires separate integration review.
- Roto quality suite for hair, blur, holes, fine objects, spill, occlusion/re-entry and temporal flicker; ground-truth alpha metrics and manual correction time.
- Measured interactive playback profiling and UI review of newly added controls. Passing code/export tests does not prove every machine or shot plays smoothly.

### Verification so far
Frontend suite: 146 passed, one optional example skipped. Native suite: 114 passed, two opt-in tests skipped. Production UI build and native checks passed with the settings-progress additions. Real CUDA tracked-Roto and real RVM WASM inference have both run. Generation adapters must remain labeled unverified until actual successful inference.

### Completion order
1. Finish Settings download management and verify the current background transfer remains active.
2. Finish the SDXL download, run deterministic image/edit/masked-edit samples, import and export their timeline placements.
3. Install and validate video/audio models subject to actual access and hardware constraints; test cancellation and output timing.
4. Add dedicated image-to-video and masked-video adapters with their own input contracts and real outputs.
5. Add image-to-mesh runtime plus a real scene renderer before exposing any 3D tool.
6. Run the Roto quality suite and measured playback profiling. Only promote a replacement when evidence supports it.
