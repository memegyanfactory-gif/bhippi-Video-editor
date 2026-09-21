# Todo: Full masterpiece edit in 5-12s batches

- [x] Check editing_workflow_status and active comp state (get_comp)
- [x] Transcribe spoken clips with analyze_clip_speech to map speech to timeline
- [x] Fast frame inspection in batches (inspect_clip_frames textOnly:true, one clip at a time)
- [x] Check local_media_capabilities (SDXL, Wan video, SAM2/ViTMatte, Depth, Audio)
- [x] Cut video per transcript, remove gaps/fillers, rearrange if needed (pro-chunk-edit/tighten)
- [x] Delete bad parts and lock clean 5-12s narrative beats
- [x] Save clean minimalist pro-level storyboard 5-12s scenes with visual/audio/evidence
- [ ] Generate local images/PNGs per scene (SDXL, chroma green for overlays) and import assetIds
- [ ] Generate local Wan video (≤5s) for hero motion + green-screen motion graphics
- [ ] Add transitions, roto/depth per cut clip and adjust placement properly
- [ ] Add text-behind-subject and images behind subject with depth occlusion
- [ ] Add on-screen kinetic text + lower-thirds with 12-principles animation (keyframes/easing)
- [ ] Add advanced motion graphics (MOGRT) with hold, stagger, follow-through
- [ ] Sound design: music bed + SFX, ducking, crossfades, overlap for masterpiece feel
- [ ] Verify final timeline (get_comp + verify_edit_workflow) and report output
