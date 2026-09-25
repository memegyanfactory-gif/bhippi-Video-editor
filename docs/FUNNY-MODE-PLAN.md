# @funny — the roast / meme edit mode

Plan written 2026-09-24. It comes from taking two finished roast videos apart frame by frame, measuring them, and comparing what they do with what Bhippi can do today.

- **A: Meme Gyan, "The Unbelievable Reason Behind Dhruv Rathee's Controversy"** (youtu.be/Q8n797PcA4Q; 10:43, 1080p50). The user recorded it on green screen and an editor did the rest.
- **B: Thugesh, "Anjali Arora's Ramayan Is a Joke!"** (youtu.be/DqpJrA0EAXo; 12:00, 1080p50, about 790K views in a day). This is the professional bar.

How they were read:
- Frames at 2 fps (1,286 + 1,439 frames) with every scene cut marked.
- ffmpeg scene detection.
- Demucs split into voice and music/SFX stems.
- Onset detection on the music/SFX stem, and beat tracking.
- Beat-vs-cut alignment against a random baseline.
- YouTube Hindi auto-captions as the transcript.

---

## 1. What the two editors actually did

### 1.1 The numbers

| | A: Meme Gyan | B: Thugesh | What @funny should aim for |
|---|---|---|---|
| Scene cuts | 95, **all before 7:21** | 224 | — |
| Cuts per minute, minutes 1–6 | 17, 12, 16, 17, 13, 10 | 20, 25, 28, 21, 30, 26 | 20–30 in the first 3 minutes, and never below 12 |
| Median shot | 2.66 s | 2.30 s | 2–2.5 s |
| Longest stretch with no edit | **3 min 22 s** (7:21 to the end, untouched green screen) | Long stretches only when a source clip is the evidence (a 45 s press-conference segment) | No host-only stretch over 8 s without a visual event |
| Music | A bed under **84 %** of the runtime, about 13 dB below the voice | Present only **20 %** of the time: stingers under cutaways and bits | Stingers first; an optional bed at −20 LU under speech |
| Cuts landing on the beat (±70 ms) while music plays | 30 % (chance is 24 %), so not synced | **60 %** (chance is 34 %), so deliberately cut on the beat | 60 % or more |
| SFX-like transients (a floor; the detector is conservative) | 18 in total, about 1.7 per minute | 81, about 6.8 per minute; 8–13 per minute in minutes 1–6 | 6–12 per minute in high-energy sections |
| Green screen | **Never keyed.** 73 % of all frames, and 100 % after 7:21, show a raw green background | The host is cut out and placed on solid colours, clips and FX on purpose | Always key, then use the matte |
| Text on the host | None | Keyword pops, text behind the subject, labels, a CTA | 1–3 stressed words every 10–20 s |

### 1.2 Video A: what worked (keep this)

A was researched properly. The editor went and got the receipts:
- Dhruv's podcast with KK Creates, including split-screen shots.
- His own video, with an Aditya Dhar label.
- The AI-generated Dhurandhar stills, marked "REPRESENTATIONAL".
- The Rahul Gandhi press conference ("Hi Seema, kabhi Sweety, kabhi Saraswati" / "She is a Brazilian model").
- RSS leader photos.
- A Modi rally clip.
- A mocked-up ChatGPT screen reading "DHURANDHAR SCRIPT DEDE".

The memes work because of **literal echo**: the meme repeats a word or idea the host has just said. Several of them also carry their own famous audio (the chase and juice clips are Hindi meme dubs), so the meme's words finish the host's thought.

| Time | The host says | What the edit cuts to |
|---|---|---|
| 0:20 | "…jaise kachre ke dibbe mein zeher daal diya" (poison) | Sooryavansham's poisoned-kheer scene, Amitabh Bachchan (0:21.5) |
| 0:33 | "Dhruv ek German shepherd hai" | The dancing husky meme (0:37) |
| 1:28 | "AC wale room mein script likh raha tha" | Black card reading "LEKIN BHAI USKE ROOM MAI AAP KYA KAR RAHE THE" with a fading troll face, then Harsh Beniwal's camcorder "REC" clip, "Samajh rahe ho na?" (1:30) |
| 3:03 | "hypocrisy ka Olympic gold medal" | The Dictator race-cheating clip (3:07) |
| 4:30 | "India mein baith ke karega toh chhid jaayega" (he'd get a beating) | A CID chase clip with its Hindi meme dub "ae ruk oye pakad…", labelled "*DHRUV" (4:33.5) |
| 4:51 | "tum toh Germany mein baithe the" | Oggy's Jack lounging with juice, with its Hindi meme dub "maza aa raha hai… mera juice kahan gaya" (4:55) |
| 5:33 | "wow kya ladka hai, very handsome boy" | The host's own face pasted onto a film hero's intro shot (5:41) |
| 6:23 | "hum toh chhote log hain" | The host's face pasted onto CarryMinati in his studio |

Two other devices:
- **Creator audio as meme.** CarryMinati clips are dropped in for their famous lines (0:56, 1:14, 2:48, 6:01).
- **Word-by-word captions only on the receipts.** They appear on podcast quotes ("MODI SE ACHCHA EK GADHA BETTER HAI / EK ACTUAL DONKEY"), never on the host.

The cold open is a 4-second montage:
1. Three creator clips, 0.5 s each, in small cards on black.
2. A cut-out photo of the target next to "YOU ARE THE REASON / I LOVE INDIA!".
3. The podcast wide shot.
4. A black flash, then the host.

### 1.3 Video A: what held it back (fix this)

1. **The green screen was never keyed.** The host sits on flat chroma green for the whole video. That is the main reason it looks amateur next to B.
2. **The edit stops at 7:21.** The last 3 m 22 s is one untouched shot of the host (100 % green frames, zero cuts) while the music bed plays on. Editor fatigue is exactly what automation removes.
3. **The host is static.** There are no punch-ins, no zooms, no shake, no text, no overlays. All the energy comes from cutaways, so every host shot is dead air.
4. **Inserts sit on plain black.** Most clips are shown as small rounded cards or pillarboxed verticals on black. That reads as cheap.
5. **SFX are almost absent** (about 1.7 per minute), and cuts are not beat-synced.
6. **The music bed runs under everything.** A constant bed flattens comedy, because the punchline has no silence to land in.

### 1.4 Video B: the professional grammar

This is how Thugesh uses alpha and cutouts, adds text and effects, and times it all.

**The host is rotoscoped (alpha), so he can be put in front of anything.**
- He appears in front of a meme clip, with a 🫡 emoji (1:29.5).
- He is cut out onto pure green with a drop shadow, making himself a meme template (6:22, 6:22.8).
- He is shown in B&W inside a burning frame when the moment turns dramatic (5:12.8).
- A huge "ALRIGHT" sits behind him while "HOW MANY RAMAYANS" is in front (0:00.8).

**Other people are cut out and placed beside him.**
- The producer: a still cutout, bottom-left, next to the poster card (0:08.6).
- Anjali Arora as Sita: bottom-right (0:24.8).
- A shocked-face man: bottom-right (6:27).
- An actor: bottom-left under a poster (9:59.5).
- Anjali Arora dancing: a **video** cutout, sliding in with motion blur and dancing next to him (6:52.5, 6:52).

**Props are placed in the foreground.**
- A broadcast camera (8:58.5).
- A bundle of press microphones, turning his desk into a press conference (6:48.5).

**Text: short keywords, never full subtitles.**
- Yellow condensed caps with a heavy black stroke ("HOW MANY RAMAYANS").
- White rounded ExtraBold with a soft shadow ("GENIUNELY", "anjali arora").
- A fiery "COMMENT DOWN BELOW" on a red glow (11:47).

**Stickers and emoji.**
- A 🫡 emoji.
- A pink heart sticker reading "NO HATE", as a disclaimer (6:18).
- A circular disc sticker of the film (11:13.5).

**Overlay FX.**
| Effect | Time |
|---|---|
| Money rain | 1:41 |
| Fire embers with a red grade | 4:23 |
| Anime speed lines | 5:03.8, 7:45 |
| Hearts and sparkle burst | 8:28.5 |
| A heavenly spotlight beam | 9:47–9:52 |
| A smoke "?" question mark | 0:01.2 |

**Cards.**
- Posters with a white border and shadow.
- Torn-paper THEN / NOW comparison cards (5:03.8).
- A vertical phone clip as picture-in-picture (2:28).
- A news-article card beside a reaction-meme video (9:53).
- A Google/IMDb fact strip sliding in at the bottom ("…has a runtime of 2h 54m", 10:31).
- An Instagram profile card (11:48).

**Meme images.** The "can I copy your homework" format over a film still, then a circular zoom highlight on a face (10:41–10:44).

**Grades.** B&W for fake-sad or serious beats (11:02–11:04).

**Transitions and camera.**
- Whip or motion-blur transitions between a clip and the host (6:48).
- The host alternates wide and punched-in framings across jump cuts.
- A fast push-in on a reaction.

**Sound.**
- Music appears as short stingers under the bits, and cuts land on its beat.
- SFX mark every entry and pop.

**Evidence clips run long when they are the joke.**
- The trailer, a 45 s press-conference panel (6:45–7:30) and a 26 s interview (8:29–8:55) play with their own audio.
- Vertical sources get a blurred fill (9:15).

**What B has that A lacks:** alpha everywhere, events on top of the host, keyword text, SFX density, and music used as punctuation rather than wallpaper. What A has that B also has: research-driven receipts and memes that echo the words.

---

## 2. What Bhippi has today, and the gaps

Bhippi already has most of the pieces:
- **Transcription:** word-level (`src-tauri/src/transcribe.rs`: Deepgram, then whisper.cpp, then Groq, then OpenAI).
- **Web research and download:** `web_media.rs` (yt-dlp, scraping, trimming, cropping), plus `find_free_media` (Openverse, Commons, NASA).
- **Mattes and keying:**
  - Video roto: `roto.ts` RVM and `tracked_roto.py` SAM2.
  - `behindSubject.ts` puts text or media behind the subject.
  - The `keylight`, `linear-color-key` and `extract` effects render.
- **Tracking:** `track_people` (RF-DETR + ByteTrack) and `track_motion`.
- **Audio:** `beats.ts` (tempo and beat grid), `level_audio`, and ducking (`audioEnvelope.ts`).
- **Text and motion:** 80 caption styles, React Bits and Animate.css entrances, the GL motion engine with a `wiggle()` expression, and `frame_hold`.
- **Orchestration:** subagents (`subagent.rs`, up to 6 per turn) and the council (`council.ts`, 4 seats).

Gaps for this style:

| Gap | Today |
|---|---|
| `@` does not select a mode | `@name` only attaches a *reference film* (`ChatPanel.tsx`, the mention list; `refs.rs`; `ref_guides.rs` GUIDES has 2 entries). There is no edit-style mode. |
| No meme knowledge | No meme database, no trend research, no GIF/meme/clip search. The Researcher seat actively discourages social media. |
| No SFX library | `sfx.rs` has 5 procedural sounds (whoosh, impact, chime, pop, riser). No vine boom, bruh, record scratch, laugh, and so on. |
| No still-image cutout | Downloaded photos of people cannot be cut out. |
| Roto too short for a talking head | The `rotoscope_clip` tool is documented as "up to 30s" (`roto.ts` itself allows 300 s). A 10-minute host shot needs chunked full-length matting. |
| Green screen is not auto-detected or auto-keyed | — |
| No comedy moves | No camera shake, speed ramp, whip, emoji sticker, overlay-FX pack, tracked character label, article or fact card, head-paste, or bleep. |
| Beat snapping is buggy | `snap_cuts_to_beats` opens black gaps at butt cuts (WORLD-CLASS-PLAN C1). |
| No pacing guard | Nothing stops a 3-minute dead zone, the thing that sank A's second half. |

---

## 3. The design

### 3.1 `@funny` is a style tag, not a reference

The idea is a small **style registry** (`src/lib/styles.ts`). A style bundles:
- a brief (the grammar in §1.4 written as rules and numbers)
- a persona
- a council seat
- target numbers for the edit (its Edit DNA)
- which tools are allowed
- default recipes

`@funny` is the first style. Later ones could be `@documentary` or `@hype`.

**Chat.** In `ChatPanel.tsx`, the `mention` hits list shows styles, marked "style", above references. Picking one sets `editStyle: 'funny'` and shows a chip. `/style funny` goes in `commands.ts`.

**Context.** `App.tsx getContext()` adds `editStyle`. `chat.rs build_request()` prepends `prompts/styles/funny.md`, using the existing `ChatRequest.persona` path. This is not a reference guide, so the `ref_guides.rs` test count stays at 2.

**Council.** A fifth seat, **Comedian** (`council.ts`), whose `block` findings gate `verify_edit_workflow`. It checks:
- **Timing:** a meme lands at the punchline word's end, +0–150 ms, never before the setup finishes.
- **Relevance:** every meme carries a written "why", checked against the meme's meaning and its "don't use when" notes.
- **Repetition:** no meme twice; the same SFX at most 3 times per video.
- **Freshness:** at least 30 % of memes from the last 90 days.
- **Dead zones:** no host-only stretch over 8 s.
- **Density:** the cut and event curve stays inside the Edit DNA band.
- **Audio:** the punchline word is audible, with the bed ducked 12 dB or more.

**Offline assistant.** `offline.rs` maps "funny / roast / meme edit" to the style, so the offline assistant degrades gracefully.

### 3.2 The roast pipeline, on top of PLAN → GATHER → EDIT → POLISH

```
record ─► 1 INGEST ─► 2 BEAT SHEET ─► 3 RESEARCH (parallel subagents) ─► 4 ASSET PREP ─► 5 ROAST EDL ─► 6 ASSEMBLE ─► 7 POLISH + QA
```

**1. INGEST**
- Transcribe with word timings. Hinglish: keep both Devanagari and Roman forms.
- Diarize if there are guests.
- **Auto-detect the green screen:** chroma dominance at the frame borders, the same test that found 73 % of frames green in A. Then key it with keylight plus spill suppression.
- Or run **full-length chunked roto** on the host shot, cached once per asset. The matte feeds every later move.
- Tighten silences and ums with jump cuts, alternating the host framing between 100 % and 112–130 % at each jump.

**2. BEAT SHEET** (LLM, chunked transcript to JSON). Label each sentence as one of:
- setup
- punchline
- claim that needs proof
- quote of the target
- a named person, film or event
- rhetorical question
- emotion spike (shock, sad, flex, cringe)
- callback
- literal-echo candidate (a concrete noun or verb a meme could repeat)
- profanity

Each gets entities and a "comic intent": betrayal, exposed, chase, clueless, fake-sad, hype, cringe, and so on.

**3. RESEARCH**, as 2–3 subagents in parallel:
- **Receipts researcher** does what A's editor did by hand.
  - For each claim or quote: find the target's actual video. Use yt-dlp `ytsearch`, then the channel's uploads.
  - **Find the exact moment** by searching the video's captions for the quoted words, then download just that section (`--download-sections`).
  - For people, films and events: get photos, posters and news articles. Capture the article headline as a card (hidden webview) with the key line highlighted. Pull Wikipedia/IMDb facts for fact strips.
- **Meme researcher:** the §3.3 meme brain, run for this video's beats and topic.
- **Sound designer:** picks SFX and stingers per beat from §3.5.

**4. ASSET PREP**
- Cut out still photos of people (§3.4).
- Roto video inserts that will be composited: the dancing-cutout move.
- Detect heads and faces for head-paste.
- Normalise vertical clips (blurred fill) and loudness.

**5. ROAST EDL.** One JSON plan: a list of `{in, out, move, params, assets, sfx, text, why, alternates[3], provenance}`. Before anything touches the timeline, it is validated against the Edit DNA and for no collisions and safe-area.

**6. ASSEMBLE.** A deterministic executor turns each move into existing tools (`place_clip`, `add_text`, `layout_clip`, `set_keyframes`, `add_sound_effect`, `edit_effect`, `add_media_behind_subject`, …) in **one undo step**. It follows the `apply_edit` batch pattern, so the tool catalogue does not grow by 20 entries: there is one `roast_move` tool plus `apply_roast_edl`.

**7. POLISH + QA**
- Beat-snap cuts inside music (after fixing C1).
- Level: dialogue at −16 LUFS, stingers ducked, SFX at −14 to −20 dB.
- Render QA frames at every event.
- Comedian seat review.
- An Edit-DNA report comparing the result with the target band.

### 3.3 The meme brain: research recent memes, and use them for what they mean

The database is `Documents/Bhippi/Memes/memes.db` (SQLite plus media files). Each entry has:
- **Identity:** `name`, `aliases` (English, Hinglish, Devanagari).
- **Origin:** film/show/creator plus the timestamp.
- **Meaning:** `meaning`, `use_when`, `dont_use_when`.
- **Tags:** `emotion`, `intent`.
- **Formats:** clip, image, template, sound or sticker, each with `{url, local_path, in, out, has_audio, transcript}`.
- **Context:** `region` (IN or global), `first_seen`, `trend_score` (decays), `last_verified`.
- **Sources:** KYM, Wikipedia, Reddit thread.
- **Flags:** `safety` (religious, political, NSFW).
- **Search:** a text embedding of meaning + transcript + tags.

**Seed pack.** About 150 evergreen Indian and global entries, curated once and verified. Examples:
- The kinds A used: the death-scene clip, the dancing husky, Oggy's Jack, The Dictator race, "uske room mai…", CarryMinati lines.
- Classics: Hera Pheri, "Khel khatam", "Moye moye", the Panchayat chai line, the Dhurandhar spy templates, "Just looking like a wow", vine boom, "emotional damage", and similar.

**Trend refresh.** Weekly, and again at the start of every `@funny` edit. Sources:
- Know Your Meme newsfeed RSS and the trending page.
- Reddit (r/IndianDankMemes, r/dankmemes, r/memes, top of the week; needs an app key).
- YouTube search via yt-dlp ("meme template", "trending meme India") plus YouTube trending in Comedy.
- Imgflip `get_memes` (top templates, free).
- KLIPY trending GIFs, clips (short, with sound), memes and stickers.
- GIPHY trending stickers (optional key).
- Myinstants India trending, for sound names (it refuses bots, so treat it as best-effort).

**Learning a new meme's meaning** (what "uses them according to their references" means). For each new candidate, the researcher reads its KYM, wiki or Reddit explainer and writes `meaning / use_when / dont_use_when`. It downloads one or two canonical formats and **transcribes the clip**. That is how Bhippi knows "mera juice kahan gaya" is *said* in the Oggy clip's meme dub. Anything it cannot explain from a source is marked `unverified` and never auto-placed.

**Matching a beat to a meme:**
1. Retrieve the top 10 by embedding (beat intent + words).
2. Add a boost for literal echo: the meme's transcript or name shares a word with the punchline, the device that makes A funny.
3. Add a boost for topic memes (e.g. Dhurandhar clips on a Dhurandhar topic).
4. An LLM re-ranks and must write *why* it fits. It rejects any candidate whose `dont_use_when` matches.
5. Keep 3 alternates.

**In the UI:**
- A **Memes** panel shows the library with trending on top and a "why" on each placed meme.
- Every placed meme clip has a **Swap** chip that cycles through the alternates.

### 3.4 Alpha: cutting out the main character

- **The host:**
  - Auto-key when the backdrop is green.
  - Otherwise run full-length RVM roto in chunks, e.g. 30 s windows with a 1 s overlap and cross-faded mattes, lifting the tool's 30 s limit. The matte is cached against the asset hash.
  - This one matte enables: text behind the host, the host in front of any clip or colour (with a drop shadow and optional white sticker stroke), the host on flat green as a meme template, and B&W or burning-frame treatments.
- **People in photos:** a new `workers/cutout.py` using **BiRefNet** (MIT licence; ONNX on the GPU). Not RMBG-2.0, whose licence is non-commercial. The output PNG gets the "sticker" look: a 6–10 px white stroke, a soft shadow, and slide/pop entry with overshoot and a whoosh.
- **People in video clips:** the existing SAM2 tracked roto, so a clip of the target dancing can sit next to the host.
- **Head-paste** (A's "handsome boy" and CarryMinati bits):
  - A MediaPipe face mesh (Apache-2.0) tracks the meme character's head.
  - The host's head cutout, taken from a chosen frame of the host's own footage, is pasted and tracked on top, with slight scale and rotation follow.
  - The cheap look is the joke, and it avoids InsightFace's non-commercial face-swap models.

### 3.5 Comedy moves (`roast_move`)

Each move is deterministic, with defaults taken from §1. Every move has a built-in SFX slot.

| Move | What it does | Built from |
|---|---|---|
| `meme_cutaway` | A full-frame meme clip or still at the punchline end, 0.6–4 s, with its own audio. The host is ducked or cut. Entry by hard cut or whip. | place_clip, add_transition, volume |
| `receipt` | The target's own clip, trimmed to the quote, with word-by-word captions (only here, as in A) and an optional "*NAME" label. | download (sections), captions |
| `side_cutout` | A cut-out person slides in beside the host (bottom-left or right) with stroke and shadow, and leaves on the next beat. | cutout, layout_clip, keyframes |
| `host_on_bg` | The host is matted in front of a clip, image, solid colour or chroma green. | matte, mediaBehindSubject |
| `keyword_pop` | 1–3 stressed words; scale 0 → 1.08 → 1 in 120 ms. Styles: Meme Impact (yellow, black stroke, Impact), Rounded Pop (white ExtraBold with a soft shadow), and **text behind the host**. | add_text, textBehindSubject |
| `emoji_pop` / `sticker` | Large emoji (Noto Color Emoji, OFL) or stickers ("NO HATE" heart, disc badge) with a wobble in. | add_shape / image, keyframes |
| `overlay_fx` | Money rain, speed lines, hearts burst, embers with a red grade, spotlight beam, confetti, smoke "?". Built as **procedural motion-engine templates**, so no stock licences are needed. | src/motion/kit |
| `card` | A poster, article headline, THEN/NOW torn cards, a fact strip, or a social profile card. White border, shadow, slide in. | motion graphic templates |
| `zoom_punch` / `shake` / `whip` | Punch 112–140 % on emphasis, a slow dramatic push with vignette, a 3–6 frame shake on impact, whip blur between shots. | set_keyframes, wiggle(), new whip transition |
| `bw_freeze` | Desaturate and freeze with a record scratch, or a sad violin under B&W. | frame_hold, grade |
| `label` | A "*DHRUV" label tracked onto a person in a meme clip. | track_people + text |
| `head_paste` | See §3.4. | face mesh + cutout |
| `bleep` | Profanity gets a bleep plus an emoji or blur over the mouth. Options: keep / bleep / mute. Useful for monetisation; A's captions already show YouTube censoring. | transcript + SFX |
| `cold_open` | A 3–5 s montage of the best receipts and memes, then a title card with a cut-out photo of the target. | the above |
| `cta` | "COMMENT DOWN BELOW" fire text, subscribe, profile card. | add_text / cards |

### 3.6 Sound

**SFX library.** `Documents/Bhippi/SFX`, as a sampled library alongside `sfx.rs` procedural sounds.
- About 150 tagged sounds, curated once from **Freesound CC0**: vine boom, bruh, record scratch, dun-dun-dunnn, sad violin, anime wow, airhorn, laugh, crickets, cash register, ding, swish/whoosh, pop, glitch, and similar.
- A `search_sfx` tool with an optional user Freesound key, CC0 filter.
- Myinstants-style names are used as search aliases only. Those files are user uploads of copyrighted audio, so they are not shipped.

**Placement rules.**
- Every visual entry gets a sound: a whoosh for slides, a pop for stickers and text, a boom for a punchline freeze.
- The same sound at most 3 times per video.
- In high-energy minutes, 6–12 per minute.

**Music.**
- Stingers under cutaways and bits, cut on the downbeat. Coverage around 20–35 %, like B.
- If there is a bed, it sits at −20 LU under speech and **drops out for 0.3–0.6 s before a punchline**, so the joke lands in space.
- Default music is royalty-free (YouTube Audio Library, Pixabay, incompetech credits already handled in `Research/`), to avoid Content ID claims.

### 3.7 Edit DNA: measure, don't guess

A new `edit_dna` analyser. It ports this study's scripts: scene cuts, Demucs stems, transient SFX count, music coverage, beat-cut alignment, green-screen share, and longest dead zone. It runs on:
- (a) any reference the user drops in, to add it as a target band;
- (b) Bhippi's own `@funny` output, before it is handed back.

The Comedian seat reads its report.

---

## 4. Build order

| # | Package | Main files | Size |
|---|---|---|---|
| 0 | **Foundations**: the style registry and `@funny` tag, `funny.md` brief, Comedian seat; fix C1 beat-snap gaps; green-screen auto-detect and key; chunked full-length roto | `ChatPanel.tsx`, `commands.ts`, `App.tsx`, `chat.rs`, `prompts/styles/funny.md`, `styles.ts`, `council.ts`, `beats.ts`, `roto.ts` | M |
| 1 | **Asset libraries**: sampled SFX library and `search_sfx`; procedural overlay-FX templates; emoji and sticker pack; Meme Impact, Rounded Pop, Label and Fire CTA text styles | `sfx.rs` (+ `sfx_library.rs`), `free_media.rs` (Freesound), `src/motion/kit/*`, `caption-styles.json` | M |
| 2 | **Meme brain**: `memes.rs` (DB and providers: KLIPY, GIPHY, Imgflip, KYM RSS, Reddit, yt-dlp search), refresh job, meaning writer, embed and match, Memes panel with Swap | `src-tauri/src/memes.rs`, `src/panels/MemesPanel.tsx`, `src/lib/roast/match.ts` | L |
| 3 | **Receipts**: yt-dlp search, caption quote-finder, section download, article-card capture, fact strips | `web_media.rs`, `src/lib/roast/receipts.ts` | M |
| 4 | **Cutouts**: BiRefNet still cutout, sticker stroke, head-paste with face mesh | `workers/cutout.py`, `workers/face_mesh.py`, `src/lib/roast/cutout.ts` | M |
| 5 | **Moves and executor**: `roast_move`, `apply_roast_edl`, EDL validator, whip transition, shake, bleep | `src/lib/roast/moves.ts`, `roastEdl.ts`, `ai-tools.json`, `aiTools.ts` | L |
| 6 | **Pipeline**: beat sheet, research subagents, assembly and polish, `edit_dna` report | `src/lib/roast/beatSheet.ts`, `dna.ts`, `editWorkflow.ts`, `subagent.rs` | M |
| 7 | **Evaluation**: run on real raw recordings, compare Edit DNA with B, compare against A where the same raw footage exists, and have the user rate every meme's relevance | `tests/roast*.test.ts`, a harness like the parity harness | ongoing |

Packages 1, 3 and 4 do not depend on each other and can run in parallel after 0. Package 5 needs 1 and 4; package 6 needs everything.

---

## 5. Risks and decisions

- **Rights.**
  - Meme and receipt clips are short commentary use, which is how both channels operate; B's description claims fair use. So `@funny` needs a "commentary" rights tier that the Researcher seat allows, instead of blocking social media.
  - Keep provenance on every asset and auto-write a credits/sources block for the description.
  - Keep meme clips short, and default the music to royalty-free.
- **APIs have moved.**
  - The **Tenor API was shut down on 30 June 2026**, so don't build on it.
  - GIPHY now charges beyond a small beta key.
  - KLIPY is free with a test key (100 calls/hour) and requires "Powered by KLIPY" attribution.
  - Freesound's API is free only for non-commercial use, so ship a curated CC0 pack and treat live search as bring-your-own-key.
- **Model licences.** Use BiRefNet (MIT) and MediaPipe (Apache-2.0). Avoid RMBG-2.0 (CC BY-NC) and InsightFace inswapper (non-commercial).
- **Trends go stale in weeks.** That is why the refresh runs at the start of every `@funny` job, and why `trend_score` decays.
- **Hinglish.** Transcripts arrive in Devanagari. Matching needs transliteration both ways, and alias fields hold both scripts.

## 6. Status: built 2026-09-25

Everything in §3 and §4 is built and wired. §2 describes Bhippi before this work.

**How to use it.** Type `@funny` in the chat (or pick it from the `@` list, or `/style funny`). A chip shows the style is on; `/style off` or its × turns it off. The AI then follows `src-tauri/prompts/styles/funny.md`, and so do the workers it spawns. The five-seat council includes the Comedian, which blocks the finish on a meme with no reason, an unverified meme, or a dead zone over 8 s.

**Where things are**

| Piece | Files |
|---|---|
| Contract (every shared shape and id) | `src/lib/roast/types.ts` |
| Style tag, brief, Comedian seat | `src/lib/styles.ts`, `src/chat/ChatPanel.tsx`, `src/chat/commands.ts`, `src-tauri/src/chat.rs`, `src-tauri/prompts/styles/funny.md`, `src/lib/council.ts` |
| Meme brain (library, search, trend refresh, media fetch) | `src-tauri/src/memes.rs`, `src/lib/roast/memes.ts`, `src/settings/MemesSettings.tsx`, seeds in `src-tauri/resources/memes/` (98 Indian, 72 global) |
| Sound (6 new synthesized hits, SFX library and search) | `src-tauri/src/sfx.rs`, `src-tauri/src/sfx_library.rs`, `src/lib/roast/sfx.ts`, seed `src-tauri/resources/sfx/seed.json` (138 sounds) |
| Receipts and file Edit DNA | `src-tauri/src/receipts.rs`, `src-tauri/workers/edit_dna.py`, `src/lib/roast/receipts.ts` |
| Alpha (photo cutouts, faces, green key, long roto) | `src-tauri/src/cutout.rs`, `src-tauri/workers/cutout.py`, `src-tauri/workers/face_track.py`, `src/lib/roast/alpha.ts`, `src/lib/roto.ts` (`rotoscopeLong`) |
| Beat sheet, 20 moves, EDL executor, timeline DNA | `src/lib/roast/beatSheet.ts`, `moves.ts`, `edl.ts`, `dna.ts`, `plan.ts` |
| Graphics | `src/motion/kit/funTemplates.ts` (7 FX), `src/lib/roast/cards.ts` (8 cards plus the emoji sticker), the "Meme" category in `src/lib/caption-styles.json` |
| Routing | `src/lib/roast/tools.ts` → `aiTools.ts`; 15 tools in `ai-tools.json` |

**Measured on the reference videos**
- `edit_dna` on the file reproduces the §1.1 cut counts exactly, and the audio numbers within a few points.
- `find_receipt` found "Modi se achcha ek gadha better hai" (score 0.96) and "Hi Seema, kabhi Sweety, kabhi Saraswati" (0.96) from YouTube captions.
- `key_green_screen` found 0.72 of video A's frames green (1.0 after 7:21), and on video B only its 6:22–6:24 bit.
- Search on the seeds ranks the right meme first for "zeher", "juice", "chase" and "German shepherd".

**Not yet exercised, or limited**
- **In the app:** the whole pipeline is tested in vitest and cargo, and its parts were run on real media. A complete `@funny` edit has not yet been run inside the app with a provider.
- **Long roto:** chunked `rotoscopeLong` is unit-tested but has not run in the webview. RVM there is single-threaded, so a 10-minute host shot may take tens of minutes.
- **KLIPY and GIPHY:** built against their docs and untested live (no keys). Keys are read from the OS credential store (the Settings › Memes panel that set them has been removed).
- **Myinstants:** sounds download through the system `curl`, because the site refuses the app's HTTP client. Its files are copyrighted uploads, so they are tagged and skipped unless `allowCopyrighted` is set.
- **Emoji on export:** colour emoji export only through the HTML sticker (`emoji_pop`, the bleep's mouth cover). Emoji typed into an ordinary text clip export as flat outlines (libass).

## Sources (trend and API research)

- Tenor API shutdown: [PixlRun](https://pixlrun.com/tenor-api-shutdown/), [iTechPost](https://www.itechpost.com/articles/236523/20260701/google-shuts-down-tenor-gif-api-forcing-changes-x-discord-more.htm), [AgentDeals](https://agentdeals.dev/tenor-alternatives)
- KLIPY: [developers](https://klipy.com/developers), [API overview](https://klipy.com/api-overview), [Clips API](https://docs.klipy.com/clips-api), [GitHub](https://github.com/KLIPY-com/Klipy-GIF-API)
- GIPHY: [docs](https://developers.giphy.com/docs/api/), [pricing change](https://dev.to/giorgi_khachidze_ab9ac4ad/giphys-gif-api-is-no-longer-free-heres-what-you-need-to-know-l7h)
- Imgflip: [API](https://imgflip.com/api)
- Freesound: [APIv2 overview](https://freesound.org/docs/api/overview.html), [FAQ](https://freesound.org/help/faq/)
- Know Your Meme: [trending](https://trending.knowyourmeme.com/trending), [RSS](https://rss.app/en/rss-feed/know-your-meme-rss-feed)
- Myinstants India: [index](https://www.myinstants.com/en/index/in/)
- Indian meme trends 2026: [Trending Us](https://www.trendingus.com/trending-memes-india/), [Meme Marketing Agency](https://mememarketingagency.com/15-most-trending-indian-memes/), [NapoleonCat](https://napoleoncat.com/blog/trending-memes/)
