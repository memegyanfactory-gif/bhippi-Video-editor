# Todo: Full pro batched edit per Crimson guideline

- [x] Check editing_workflow_status and read active comp state
- [x] Transcribe dialogue clip speech (analyze_clip_speech)
- [x] Fast textOnly frame inspection in 5-12s batches
- [x] Check local_media_capabilities (SDXL/Wan/Roto/Depth/Audio)
- [x] Rough cut plan: cuts per transcript, remove gaps, rearrange
- [x] Apply batched rough cut (pro-chunk-edit/tighten via apply_edit)
- [x] Save clean minimalist pro storyboard in 5-12s batches
- [ ] Generate local image assets scene by scene (SDXL deep prompts) - BLOCKED GPU busy
- [ ] Generate local video cutaways + green-screen motion assets (Wan) - BLOCKED GPU busy
- [x] Roto batch1 + depth plan per cut clip and behind-subject placement
- [ ] Key green-screen assets and place as motion graphics overlays - BLOCKED no asset GPU busy
- [x] Add transitions + kinetic text + lower-thirds with animation principles
- [x] Add advanced motion graphics (MOGRT) per storyboard beats
- [x] SFX mix done; Music bed BLOCKED no music media + Stable Audio needs HF login
- [x] Verify final comp with get_comp + verify_edit_workflow - BLOCKED storyboard refs GPU busy
