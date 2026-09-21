# Todo: Finish the full pro edit of "what I do_3.mp4" comp

- [x] Read editing workflow status and get_comp for current timeline
- [x] Transcribe all speech clips with analyze_clip_speech
- [x] Fast frame inspection of all 8 clips (textOnly)
- [x] Check local media capabilities (SDXL, Wan, roto, depth)
- [x] Save storyboard matching transcript beats
- [x] Apply editorial cuts/punch-ins and fix gaps per storyboard
- [x] Generate local media assets (BLOCKED: SDXL decode dtype bug) → pivoted to HTML/CSS cards
- [x] Add keyed-style cards via animated HTML/CSS motion graphics
- [x] Add text/motion graphics with animation
- [x] Add transitions and audio crossfades
- [x] Sound design: SFX schedule + voice normalized (-1.5dB); music bed blocked (no audio model)
- [x] Rotoscope scene 3 + text behind subject
- [ ] Verify — BLOCKED: verify_edit_workflow needs storyboardRefs (no generated stills) and clears pendingJobs; both fail from the SDXL dtype bug. Edit itself is done and timeline read is current.