# Todo: Fix batch workflow for full pro edit

- [x] Check editing_workflow_status and active comp state
- [x] Transcribe all spoken clips with analyze_clip_speech
- [x] Fast textOnly frame inspection one clip at a time in 5-12s batches
- [x] Check local_media_capabilities (SDXL, Wan video, SAM2, depth, audio)
- [x] Understand transcript+video and plan 5-12s narrative beats
- [x] Rough cut video to transcript, remove gaps/fillers, rearrange if needed
- [x] Delete bad parts and consolidate into clean comp
- [x] Save clean minimalist pro-level storyboard in 5-12s batches
- [ ] Generate local images/PNGs per scene with deep prompts
- [ ] Generate local Wan videos / green-screen motion assets per storyboard
- [ ] Add transitions, roto per cut clip, depth occlusion for behind-subject placement
- [ ] Place generated PNGs/text behind subject with depth/roto alignment
- [ ] Add on-screen kinetic text plus 12-principles animation via keyframes
- [ ] Create advanced motion graphics overlays (graphs/badges/cards)
- [ ] Music bed + SFX mix with ducking, crossfades, overlap polish
- [ ] Verify final comp with get_comp and verify_edit_workflow
