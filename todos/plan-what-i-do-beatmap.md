# "what I do" — beat map and execution plan (1920x1080, 30 fps, Unlok brand kit + Crimson reference structure)

Source: what I do.mp4, 76.974 s, single presenter, medium shot, monitor screen-left,
dark couch screen-right (the clean side for panels). Face sits centre — no graphic crosses it.

## Pass 1 — the cut (source seconds -> timeline seconds)
Dead air and filler removed: 8.3 s. Final runtime 68.64 s of speech + 1.76 s end-card hold = 70.40 s.

| # | source in | source out | timeline in | timeline out | line |
|---|---|---|---|---|---|
| 1 | 1.30 | 4.92 | 0.00 | 3.62 | Welcome to my channel. You've made it this far. You've clicked on, |
| 2 | 5.30 | 6.44 | 3.62 | 4.76 | my name, |
| 3 | 6.76 | 12.62 | 4.76 | 10.62 | and you're curious probably what else does Yusuf have to offer. Well, basically, I stream every single day, |
| 4 | 12.93 | 19.21 | 10.62 | 16.90 | and I've had a bunch of videos up already. Most of them are outdated because of the pace of AI. |
| 5 | 19.50 | 25.60 | 16.90 | 23.00 | It's possible now to do so many things in a new workflow that's much better than old videos. And so I'm thinking, |
| 6 | 25.92 | 33.07 | 23.00 | 30.15 | let's just stream. Let's just learn things together, and let's just discover what is possible with AI. |
| 7 | 33.70 | 36.82 | 30.15 | 33.27 | If you are actually already very familiar, |
| 8 | 37.68 | 39.06 | 33.27 | 34.65 | experienced with AI, |
| 9 | 39.46 | 47.41 | 34.65 | 42.60 | with coding, let me know. Share the things that you know because I am very interested. I'm very curious. I want to learn and improve. |
| 10 | 47.54 | 52.61 | 42.60 | 47.67 | If you're a newbie, you don't know what's going on but you're interested, also join the chat. |
| 11 | 52.74 | 59.93 | 47.67 | 54.86 | Come join the community because, hopefully, we have people from all the tiers. And that's what this community is about. |
| 12 | 59.93 | 63.77 | 54.86 | 58.70 | Just exploring things, installing repos, seeing what they do. |
| 13 | 63.77 | 69.30 | 58.70 | 64.23 | You don't know that what a repo is? It's okay. I just learned it as well. Join the chat, and you will find out. |
| 14 | 71.50 | 75.91 | 64.23 | 68.64 | Subscribe. Leave a comment. Leave a like, and let me know what you're interested in. |

Dropped: 0–1.30 head slate, the 0.48 s stall after "clicked on", the filler "and," at 36.77–37.68,
the 2.46 s dead gap at 69.30–71.61, the 1.12 s tail. Every join keeps a ~0.12 s breath so nothing clips.
No reordering — the argument already runs hook -> problem -> turn -> offer -> two audiences -> community -> CTA.

## Pass 2 — the ten beats (5–12 s each, one visual decision per beat)
1. 0.00–8.56  Hook, type behind the subject
2. 8.56–16.90 Daily streams / the archive has aged
3. 16.90–23.00 Old vs new workflow (keyed green-screen chart)
4. 23.00–30.15 Stream · Learn · Discover
5. 30.15–36.70 For the experienced (card left)
6. 36.70–42.60 "i want to learn and improve"
7. 42.60–47.67 For the beginner (card right — mirror of beat 5)
8. 47.67–54.86 All the tiers — connected map, presenter to a corner card
9. 54.86–64.23 Installing repos / what a repo is
10. 64.23–70.40 Subscribe + end card, frame scales into a card (closes the opening move)

## Execution batches (EDIT phase — one batch per pass, never all at once)
- B1 cuts: one apply_edit program, 14 keeps, then level_audio.
- B2 sound: music bed, analyze_music_beats, snap_cuts_to_beats, score_audio_clip ducking.
- B3 roto + depth: beats 1, 6, 9 (subject cutout); depth_occlusion_clip for b-roll behind shoulders.
- B4 graphics beats 1–4, then run_frame_qa.
- B5 graphics beats 5–7, then run_frame_qa.
- B6 graphics beats 8–10, end card, then run_frame_qa.
- B7 sfx + captions + final QA + verify.

## Known blockers to clear before GATHER
- Settings > Local Media: "disable local generation" is ON. Video and image shots cannot run until it is OFF.
- Magic eraser (LaMa) not installed -> no clean plate; every behind-subject graphic uses roto, not erase.
- Stable Audio Open blocked by Hugging Face access -> music is a licensed download, not a generation.
