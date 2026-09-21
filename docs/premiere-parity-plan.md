# Helios → Premiere Pro parity plan

Status legend: [x] done · [~] in progress · [ ] to do · (off) shown but disabled, with the reason, the way Premiere greys items that don't apply.

## 1. Core model and editing engine
- [x] Project v3: many **comps** (Premiere sequences), any number of V/A tracks, freely placed clips, linked A/V, generated items, folders, auto-migration of 0.2 projects
- [x] Clip fields: speed, reverse, maintain pitch, frame hold, interpolation, deinterlace, adjustment layer, mask, keyframes (x/y/scale/rotation/opacity/volume), label, group, audio channels, Enhance Speech, audio type
- [x] Sources: media, nested comp, item (Color Matte, Black Video, Transparent Video, Bars and Tone, Adjustment Layer, Countdown Leader), text (incl. vertical), sound effect, shape (rectangle/ellipse/polygon)
- [x] Transitions model (video + audio, center/start/end alignment, single-sided)
- [x] Engine: overwrite, insert, lift, extract, ripple delete (sync-lock aware), move across tracks, duplicate, normal/ripple/rolling trim, rate stretch, slip, slide, razor, nest, add/delete tracks, gaps, edit points, snapping targets
- [ ] Engine additions: group/ungroup, synchronize, merge clips, frame hold add/insert, paste/remove attributes, replace with clip, render-and-replace bookkeeping, keyframe editing helpers, transition placement

## 2. Timeline
- [ ] Tabs for open comps; close tab; double-click a nested comp opens it
- [ ] Track header like Premiere: source patch (V1/A1), lock, track target, sync lock, eye (video) / M · S · voice-over mic (audio), editable name, drag-to-resize height
- [ ] Track header menu: Rename, Add Track, Add Tracks…, Delete Track, Delete Tracks… (empty)
- [ ] Clips: thumbnails, waveforms, names, fx badge, speed %, label colour, disabled/offline states, linked [V]/[A] markers, transition blocks, rubber band with keyframes
- [ ] Selection: click, Shift/Ctrl add, marquee, Linked Selection toggle, Alt-click ignores link
- [ ] Drag: move (overwrite), Ctrl-drop insert, Alt-drag duplicate, change tracks, drop above V-top / below A-bottom creates a track, drop media/comps/items from the Project panel with a ghost preview
- [ ] Trim: edge drag; **Alt + edge drag stretches or squishes** (rate stretch); Ctrl + edge = ripple; tools for ripple/rolling/stretch/slip/slide
- [ ] Snap indicator line; Up/Down edit points; nudge (Alt+arrows)
- [ ] Ruler: timecode, markers (double-click to edit name/colour), In/Out, render bar, playhead; **zoom out to the whole comp**; `\` toggles fit
- [ ] Header controls: snap, linked selection, add marker, display settings (thumbnails, waveforms, fx badges, names, keyframes)
- [ ] Empty-track menu: Ripple Delete (gap), Paste, Paste Insert

## 3. Tools panel (grouped flyouts, click-and-hold like Premiere)
- [ ] Selection (V)
- [ ] Track Select Forward (A) / Backward (Shift+A)
- [ ] Ripple Edit (B) / Rolling Edit (N) / Rate Stretch (R) / Remix (off: needs Adobe's music AI)
- [ ] Razor (C)
- [ ] Slip (Y) / Slide (U)
- [ ] Pen (P): keyframes on rubber bands; pen masks in the Program monitor
- [ ] Rectangle / Ellipse / Polygon: draw shapes in the Program monitor
- [ ] Object Mask (off: needs AI tracking) / Ellipse Mask / Rectangle Mask / Pen Mask
- [ ] Hand (H) / Zoom (Z)
- [ ] Type (T) / Vertical Type: click in the Program monitor to type
- [ ] Generative Extend (off: Adobe Firefly)

## 4. Clip right-click menu (every Premiere item)
- [ ] Cut · Copy · Paste Attributes… · Remove Attributes… · Clear · Ripple Delete
- [ ] Edit Original (opens the file) · Edit Clip in Adobe Audition (off) · License (off) · Replace With Comp… (Premiere: After Effects Composition) · Replace With Clip › From Source Monitor / Match Frame / From Bin · Render and Replace… · Restore Unrendered · Restore Captions from Source Clip (off: no transcripts)
- [ ] Enable · **Unlink / Link (separate audio and video)** · Group · Ungroup · Synchronize… · Merge Clips… · Nest… · Make Subcomp · Multi-Camera (off unless multicam)
- [ ] Label › 16 colours
- [ ] Speed/Duration… (speed, duration, link, reverse, maintain pitch, ripple, interpolation) · Scene Edit Detection… (cuts / markers)
- [ ] Ignore Transcript (off: no transcripts)
- [ ] Audio Gain… (set, adjust, normalize max peak, normalize all peaks) · Audio Channels… · Auto-Tag Audio Types · Enable Enhance Speech
- [ ] Frame Hold Options… · Add Frame Hold · Insert Frame Hold Segment · Field Options… · Time Interpolation › · Scale to Frame Size · Fit to frame · Fill frame · Adjustment Layer
- [ ] Link Media… (relink) · Make Offline… · Rename… · Reveal in Project · Reveal in Explorer · Properties · Show Clip Keyframes ›

## 5. Project panel
- [ ] Right-click: Paste · **New Comp** (Premiere's "New Bin" slot) · New Folder · New Item › Comp…, Offline File…, Adjustment Layer…, Bars and Tone…, Black Video…, Color Matte…, Transparent Video…, Countdown Leader… · Import… · Find… · Reveal Project in Explorer
- [ ] Item menu: Open in Timeline / Source, Rename, Comp Settings…, Duplicate, Label, Reveal in Explorer, Link Media, Make Offline, Delete (with in-use warning)
- [ ] Icon and list views with columns (name, label, fps, start, end, duration, video/audio info, path) and sorting; folders; search; drag into folders
- [ ] Dialogs: New Comp (presets, size, fps), Color Matte (colour picker + name), Bars and Tone / Black / Transparent / Adjustment (size), Countdown Leader (duration, colour)

## 6. Monitors
- [ ] Program: multi-track compositor (nested comps, items, text, shapes, masks, effects, adjustment layers, transitions, keyframes), draggable Motion handles (move/scale/rotate), shape and mask drawing, Type tool, safe margins, zoom, lift/extract, export frame, JKL shuttle (2×/4×/8×, reverse), loop
- [ ] Source: source patching, Insert/Overwrite, Drag Video Only / Drag Audio Only, Match Frame (F)

## 7. Properties (Effect Controls)
- [ ] Transform with keyframe stopwatches (position, scale, rotation, opacity), Fill/Fit, Crop, Mask (shape, feather, invert), Effects (brightness, contrast, saturation, hue, invert, blur, flips), Speed (Adjust speed…), Audio (volume dB with keyframes, channels, Enhance Speech), Text (content, preset, style, vertical), Shape (fill, stroke, corners), Transition (kind, duration, alignment), Comp settings when nothing is selected

## 8. Effects panel
- [ ] Video Transitions (drag onto an edit point; Ctrl+D default cross dissolve), Audio Transitions (Ctrl+Shift+D constant power), Video Effects (drag onto a clip), caption styles, sound effects

## 9. Audio
- [ ] Meter right-click: Reset Indicators, Show Valleys, Show Color Gradient, Mute All Audio, Mute Source Monitor, Mute Program Monitor, Solo in Place (off, as in Premiere), 120/96/72/60/48/24 dB range, Dynamic / Static Peaks
- [ ] Smoother meter ballistics, peak hold, clip lights, valleys
- [ ] Preview per clip: channel mapping, Enhance Speech (Web Audio), volume keyframes, gain above 0 dB
- [ ] Voice-over record from the track header mic

## 10. Keyboard
- [ ] Premiere's default Windows keymap (tools, transport, marking, editing, trimming, nudging, track heights, panels), searchable shortcuts dialog

## 11. File
- [ ] New Project · New Comp · Open Project… · Open Recent › · Close Project · Save (Ctrl+S) · Save As… · Save a Copy… (`.helios`) · Revert · Import · Export › Media / Frame · unsaved-changes prompt on close · `.helios` file association

## 12. Export
- [ ] Export page like Premiere: file name and location, preset, format, resolution, frame rate, quality, range (entire / In to Out), summary, queue progress
- [~] Renderer: multi-track, nested comps, items, effects, adjustment layers, text transforms, shapes, masks, keyframes, transitions, reverse, holds, audio channels, Enhance Speech (helper agent)

## 13. Helios AI
- [~] Real tool calling for every provider: native tools for Anthropic / OpenAI-compatible / Ollama, MCP server for Claude Code / Codex / Gemini / OpenCode, text fallback for Grok / Antigravity, offline parser (helper agent)
- [ ] Frontend executor for every tool; turn-level Revert; tool rows in chat
- [ ] Tool catalogue additions for transitions, keyframes, masks, shapes, frame holds, reverse, labels, groups, audio gain/normalize, scene detection, Enhance Speech

## 14. Finish
- [ ] Styles, unit tests (engine), Rust tests, build, launch and verify each area by hand

---

# Round two: the bug list and the After Effects side

Everything below came from using the app. Checked items are done *and* verified in the running
build (mostly by driving the webview over its debugging port); `[~]` means partly done.

## 15. Timeline bugs
- [x] **Clips would not move.** The opacity/volume rubber band was an SVG covering the whole clip,
      and its `pointerdown` handler stopped propagation, so a drag never reached the move gesture.
      The band now only takes the pointer on a 9px-wide stroke along the line itself and on its
      keyframes. Verified: a clip drags, its linked audio follows, the ghost shows while dragging.
- [x] **Snap ignored the toggle mid-drag.** Moving a clip called the snapper without the event, so
      Shift could not suspend it. Snap now follows the toolbar button (and `S`), and Shift inverts
      it during a move, as in Premiere.
- [x] **Footage looked stretched.** One filmstrip image was scaled across the whole clip. Thumbnails
      are now laid out as tiles, each at the source's own aspect ratio, each showing the frame
      nearest its own moment.
- [x] **Waveforms were mushy.** The backend now writes `<id>-peaks.bin` per asset — two bytes a
      bucket (peak, rms), a hundred buckets a second — and the timeline draws it on a canvas at
      device resolution. Assets imported earlier get a peak file on next launch. The old
      `showwavespic` PNG stays as the fallback while peaks are being made.
- [x] **Playback froze for a second at every cut.** Each clip mounted its own `<video>`/`<audio>`,
      so a razor cut meant loading and seeking the same file again — and rebuilding the Web Audio
      chain. Media elements are pooled by source now, so the element already playing is handed to
      the next clip, and a clip that merely continues the previous one is not pre-rolled at all.
      Verified: 22s of playback across 3 cut points, longest freeze 70ms (one sample tick).
- [x] **Markers drew full-height lines** down the timeline. Markers are chips in the ruler now,
      like Premiere.
- [x] **The playhead could only be grabbed by its cap.** The line is draggable along its whole
      length now.
- [ ] Track-height and scroll polish pass: remember heights per track, Ctrl+wheel zoom at cursor.

## 16. Masks, alpha and effects (After Effects behaviour)
- [x] **The mask tools did nothing when clicked.** The group's slot opened on Object Mask, which
      needs Adobe's AI and is shown disabled, so the click fell on the floor. A group now opens on
      its first usable tool, clicking a disabled slot opens the flyout instead, and a mask tool
      with nothing to draw on says why rather than failing silently. A mask can also be drawn on a
      clip the playhead is not over, against the frame, as After Effects allows.
      Verified: drawing with the Rectangle Mask tool puts a real mask on the selected clip.
- [ ] Pen tool: drag for curves, edit points afterwards; expansion and opacity per mask;
      Add/Subtract/Intersect modes (feather and invert are in).
- [ ] Layer alpha: straight alpha through the chain, per-layer blend modes, track mattes
      (alpha/luma, inverted), preserve transparency — matching After Effects, in preview *and*
      export.
- [ ] Every effect accurate to its After Effects counterpart, with the preview and the renderer
      agreeing; parameters keyframable with ease/hold interpolation.
- [ ] Effect Controls panel like After Effects: per-effect header with the fx toggle and reset,
      collapsible property groups, dropdowns, checkboxes, colour pickers, a curves widget.
- [ ] Effects & Presets panel as a tree (Animation Presets, 3D Channel, Audio, Blur & Sharpen, …)
      with the info button on each entry.
- [ ] The fx search console: clean field, grouped results (Effects, then Presets), keyboard driven.

## 17. Subtitles
- [x] A Subtitles tab beside Project / Effects / Graphics / Audio.
- [x] All 80 WatchFIWN styles, each previewed in its own look. The previews were blank: a flex item
      that hides its overflow gets `min-height: 0`, and a `<button>` grid item that hides its
      overflow reports no intrinsic height in Chromium, so every card collapsed to its borders.
- [x] **Generate Subtitles now transcribes for real.** It used to write `Subtitle line 1`,
      `Subtitle line 2`… and, with no media, three invented lines about Helios. It now sends each
      sounding file once to Whisper on the user's own Groq or OpenAI key (FFmpeg cuts it to 16 kHz
      mono MP3 first), caches the transcript beside the asset, maps word timings through each
      clip's in-point and speed so captions follow their pictures through cuts, and chunks them
      with WatchFIWN's rules. With no key, the button says what to add instead of inventing text.
- [ ] Word-level karaoke timing carried into the caption clips (the words are captured; the
      renderer still paces them evenly).
- [ ] Transcribe an In/Out range, and a way to edit cues in the panel.

## 18. Chat
- [x] The double focus ring is gone: the frame around the composer is the only focus cue.
- [x] A thinking-level control, shown only for the providers whose backend passes a level through
      (Claude Code, Codex, Grok) and offering only the steps each one honours. Ported from Bhippi's
      composer: a popover with a drag-and-arrow-key rail, and at the top step the drifting particle
      field that says "this will take a while". The chip's label sits in a slot as wide as its
      widest word, so sliding it never shoves its neighbours sideways.
- [x] A permission mode — Plan only / Auto-edit / Full access — with Bhippi's list where each
      posture states what it actually does, and enforced where tool calls arrive rather than merely
      displayed: Plan only refuses every edit, Auto-edit refuses the five destructive tools, and the
      assistant is told why so it can ask.
- [x] Both popovers are placed in viewport coordinates. Anchored inside the chat column they were
      cut off by its clipped overflow, which is what the user saw.
- [x] The chat's motion comes from the same family: turns arrive from the side they belong to, the
      suggestions deal themselves out, a finished tool row flashes once and then stays still, the
      send button springs, and a streaming turn runs the same particle field as a hairline above
      the composer. All of it stops under `prefers-reduced-motion`.
- [ ] Per-provider model lists in the picker could show context and cost, as Bhippi's did.

## 20. TypeSafe
- [ ] Blocked: writing the integration needs the live API contract from docs.typesafe.ai, and
      fetching it was denied in this session. The natural first use is routing a chat request to a
      tool with typed arguments (replacing the builtin provider's hand-rolled parser), and a
      "suggest a style" judgment over the 80 caption styles. The key the user pasted is **not**
      stored anywhere yet; it was shared in plain text and should be rotated.

## 19. Notes
- Peak files and filmstrips are derived data: they live in Helios' own directory and are deleted
  with the asset. `FILMSTRIP_FRAMES` in Timeline.tsx must match `tile=12x1` in library.rs.

## 21. Chat commands, honest effort, and the look switch

1. **One table decides what "effort" means.** A new `effort.rs` in `helios-providers` is the single
   source of truth: `levels(provider, model)` returns the steps that provider *and that model*
   actually honour, and the same table drives the CLI flag, the API request bodies and the UI. A
   provider with nothing to offer returns an empty list and the control disappears rather than
   pretending.
   - Claude Code, Codex, Grok: through their CLI flags, as today.
   - Anthropic API: extended thinking, as a token budget per step, on the models that take it.
   - OpenAI-compatible API: `reasoning_effort`, on the reasoning models that take it.
   - Local runners, Gemini, OpenCode, Antigravity: nothing, so nothing is shown.
2. **Slash commands** with a grouped drop-up panel: typing `/` opens it, arrows and Enter pick,
   Esc closes. Each one does something real — `/clear`, `/compact`, `/undo`, `/revert`, `/model`,
   `/effort`, `/permission`, `/tools`, `/context`, `/providers`, `/help`.
3. **"Awesome look"**, a switch inside the thinking popover. It changes nothing but the surface:
   with it on, writing and sending carry the same particle field the top effort step uses — a trail
   behind a sent message, a comet along the streaming hairline, a glow on the turn being written.
   Off is today's plain chat. It stops under `prefers-reduced-motion` either way.

## 22. The chat becomes a workspace

Where this is going: the chat stops being a text box with a model behind it and becomes the place
the work is organised — what it can reach, what it is doing, what it has learned about this editor.

### 22.1 Small things that are missing (do first)
- [ ] Copy on a user message. Everything the assistant writes can be copied; what you wrote cannot.
- [ ] A second message while one is streaming **queues** instead of being refused, the way Claude
      Code does: it shows as pending under the composer and sends itself when the turn ends.
- [ ] The assistant can **ask a question**. A new `ask_user` tool renders a card in the transcript
      with the question and its options; picking one returns it as the tool's result, so the turn
      carries on instead of guessing. Free text allowed, and "skip" always available.

### 22.2 The bar under the composer
One row, like ChatGPT's: what this chat can reach and what it is doing right now.
- [ ] **Tools used** — a live count for the session with a menu listing them, from the tool runs
      already recorded per turn.
- [ ] **Connections** — a chip per MCP server or HTTP API this chat can reach, each with its own
      mark, added when the user adds one and remembered between sessions.
- [ ] **Agents** — "2 agents working", clicking opens the agent map: one box per agent with a
      green / red / grey light for running, failed and finished, its model, how long it ran and
      what it cost.

### 22.3 An MCP client, so it can reach anything
Helios is an MCP *server* today (CLI agents call into it). It needs to be a client too.
- [ ] Connect to a stdio or HTTP MCP server: initialize, `tools/list`, `tools/call`.
- [ ] The server list lives in settings, with its tools merged into what the assistant may call
      (the CLI agents wire their own MCP servers themselves, so this is for the API providers).
- [ ] A failed server shows as failed with its error, and never silently drops its tools.

### 22.4 Agents inside the chat
- [ ] A `spawn_agent` tool: the assistant hands a bounded task to a fresh turn with its own
      context, which streams into the agent map rather than the transcript and returns its answer
      as the tool result.
- [ ] A cap on how many run at once, and a stop button per agent — an agent the user cannot stop
      is not something to ship.

### 22.5 Learning, the way Hermes does it
Not fine-tuning — a memory and a set of procedures the model reads. Modelled on Hermes Agent's
skill memory (see Sources in the session notes): skills as files, names and summaries in the
prompt, full text loaded on demand, and a background review after a session decides what was
worth keeping.
- [ ] `<app data>/knowledge/profile.md` — how this editor works: aspect ratios, caption styles,
      pacing, naming, language. Written by the review pass, editable by hand.
- [ ] `<app data>/knowledge/skills/<name>.md` — a procedure learned from doing it: what the task
      was, the steps, the tool sequence, what went wrong the first time.
- [ ] `<app data>/knowledge/sessions.jsonl` — a digest per session, searchable, so returning to a
      project a fortnight later does not mean explaining it again.
- [ ] Tools: `recall(query)`, `remember(kind, title, body)`, `skill_view(name)`.
- [ ] A **review pass** after a turn that used tools: the same provider is asked what is worth
      keeping, and writes it through those tools. Switchable, and visible in the bar while it runs.
- [ ] Seeded from `resources/knowledge` in the bundle, so a fresh install starts with what shipped
      and then diverges per person. This is what "ships trained" honestly means: the knowledge
      travels with the app, the model does not change.

## 23. Why the AI's edits were bad, and what changed

The assistant edited by poking the timeline one call at a time — place, split, move, delete — each
committing on its own. Any wrong step left the project half-edited, and nothing checked the result
as a whole. Two products get this right in opposite ways, and both lessons are now in the code.

**HyperFrames (HeyGen)** lets an agent write one deterministic program and guarantees the output:
identical inputs, identical result. So `apply_edit` takes the *whole* edit in one call —
[src/lib/editProgram.ts](../src/lib/editProgram.ts) — runs it against a copy of the comp, checks
the invariants at the end, and commits as one undo step. A failure changes nothing and names the
operation that failed. `preview: true` returns the diff without touching the timeline, which is
how the assistant checks its own work before doing it, and how the user can approve first.

**Higgsfield** puts the craft in presets, not prompts: you pick a preset, say one sentence, and the
motion is good because the preset knows what good is. So the pacing and the numbers now live in
[src/lib/recipes.ts](../src/lib/recipes.ts) — `tighten`, `punch-ins`, `hook`, `captions`,
`music-bed`, `vertical` — each reading the project and writing a program. The assistant's job is
choosing the recipe and filling parameters, which is the part it is good at.

- [x] `apply_edit`, `list_recipes`, `apply_recipe` in the catalogue, and the prompt now tells the
      model to edit in whole edits and to prefer a recipe over improvising.
- [x] Ten tests on the interpreter and the recipes: determinism, atomic failure, the invariant
      check, warnings, and each recipe's refusal reason. One of them caught a real mistake — the
      punch-ins recipe was scaling the wrong clip, since the first *cut* is between clip one and
      two, not before clip one.
- [ ] More recipes where they earn their place: b-roll under a talking head, jump-cut tightening
      by audio level (the peak files make this possible), a reel cut down from a long take.
- [ ] Show the diff as a card in the chat, so a big edit can be approved before it lands.

## 24. Layout, brand and looks

The frame the user showed — a title with three caption samples stacked on the same pixels — was not
a rendering bug. Helios placed each graphic exactly where it was told and had no idea anything was
already there. Neither reference film ever does that, so the first work is the part that makes it
impossible.

- [x] **A layout engine** ([src/lib/layout.ts](../src/lib/layout.ts)). The frame is a safe area and
      a set of named slots, each holding one thing. Asking for a taken slot gives the nearest free
      one and says so. A subject box — where the speaker is — is treated as occupied, and a slot he
      blocks is *carved* rather than abandoned, which is how the reference film puts one word left
      of his head and one right. Vertical frames reserve more at the bottom, under the platform's
      own buttons.
- [x] **Motion as numbers** ([src/lib/motion.ts](../src/lib/motion.ts)). The twelve principles with
      what each means here, eight named curves, and moves built from them. Follow-through really
      overshoots and anticipation really pulls back — both pinned by tests. Timings and staggers so
      a list of twelve still lands inside its shot.
- [x] **A brand per project** ([src/lib/brand.ts](../src/lib/brand.ts)), derived rather than
      invented: the accent is the most colourful thing the camera saw, pushed until it carries on a
      dark field; the type scale comes from the tone of the transcript and the shape of the frame.
      `asset_palette` in Rust reads the real colours out of the footage with FFmpeg.
- [x] **Two style packs** ([src/lib/stylePacks.ts](../src/lib/stylePacks.ts)) read frame by frame
      from the two films, with palette, type, materials, curves and the scenes each one uses.
- [ ] **Materials**: glass with a travelling edge light, orbs with specular highlights, pills,
      cards with shadows, construction lines, bloom. These are what the scenes are made of.
- [ ] **Scene builders**: turn a pack's scene into an edit program, so `apply_recipe` can lay a
      hook or a numbered list down complete.
- [ ] **Subject detection and roto**, so type can pass behind the speaker as it does in the source
      film. Until then the layout engine takes a subject box from the caller and works around it.
- [ ] **The pipeline**: transcribe → cut → assemble → plan the beats → derive the brand → place the
      graphics. Each step exists or is planned; the chain is what turns them into one command.

## 25. Subject detection and roto

After Effects mattes a clip once and then lets you use it everywhere. Helios now does the same, and
the useful half of it — knowing where the person is — arrives even before the matte is applied.

**The model is Robust Video Matting**, not a photo matting model. What decides it is not edge
quality but memory: RVM takes four recurrent tensors in and hands four back, so every frame is
matted knowing what the last one looked like. A per-frame model produces an edge that crawls, and
a crawling edge is what makes roto look cheap. Measured on the reference film, the box moves by
0.047 of frame width between frames — steady enough to place type against.

- [x] The model in the catalogue (`matte-rvm`, 15 MB), downloaded on demand through the same
      system as the speech models.
- [x] `roto.rs`: FFmpeg pulls every frame of the range, the webview runs the model, each alpha
      plane comes back and is written as a PGM — the format the renderer already uses for masks,
      so no image library was needed — and FFmpeg packs them into greyscale video for compositing.
- [x] Subject boxes computed from each alpha, using only the solidly opaque pixels: a matte leaves
      a haze around the subject, and a box drawn round the haze is always too big to place type
      against. Speckle in the corners is ignored the same way.
- [x] `roto.ts` runs the model with its state carried frame to frame. Verified against the real
      film: 35 ms a frame at 512×288 on the CPU, so a minute of footage is about a minute of work.
- [x] The layout engine takes the track and keeps clear of everywhere the subject goes **across
      the whole span** a graphic is up for — otherwise the speaker walks into the title.
- [x] Two rules, not one. Without a matte the subject is a no-go area. With one he is composited
      over the graphic, so type may run *behind* him, which is exactly how the reference film sets
      *Motion* by the presenter's shoulder rather than across it.
- [ ] A Roto button in the UI with progress, and the matte used as a mask in the compositor and as
      `alphamerge` in the export.
- [ ] Refining a matte by hand — strokes to add and remove, as the roto brush allows.
