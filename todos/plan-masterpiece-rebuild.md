# Masterpiece rebuild — "what I do" channel intro (1920x1080, 30 fps)

## How this run avoids stalling
- Frames: one ffmpeg contact sheet of the whole source (1.5 s) + textOnly scans (instant). Images only for the ONE 5–12 s batch being roto'd/placed.
- Work in batches of one beat (5–12 s). Each EDIT batch = cut check → layout → roto/depth → behind-subject layer → graphic → sfx → mini QA. Never all beats at once.
- Todo file ticked after each real step so a stop resumes at the exact batch.

## Chunk 3 — what the video says (spine)
Hook: "Welcome… you've clicked on my name… what else does Yusuf have to offer."
Claim: I stream every single day; old uploads are outdated because of the pace of AI.
Turn: new workflows are much better → "let's just stream, learn together, discover what's possible with AI."
Two audiences: experienced ("let me know, share what you know, I want to learn and improve") / newbie ("join the chat").
Payoff: a community of all tiers — exploring, installing repos ("don't know what a repo is? I just learned it too").
CTA: subscribe, comment, like, tell me what you're interested in.
Presenter: centre-right, monitors on the left, big two-handed gestures (right side most), soft purple room, last source frame soft/pointing at lens.

## Chunk 4 — cut plan (applied in EDIT batch 0, one apply_edit program)
Already cut: head slate, stall after "clicked on", "and," stumble, 2.5 s dead air before "Subscribe".
Still to tighten (source seconds):
- 10.56–11.28 "Well, basically," → cut (B2 opens on "I stream every single day")
- 12.56–12.99 pause → leave 0.12 s
- 19.15–19.55 lead silence → leave 0.1 s
- 39.01–39.51 pause "AI, | with coding" → leave 0.12 s
- 54.40–54.91 pause "because, | hopefully" → leave 0.12 s
- 64.27–64.43 "that" stumble → cut ("You don't know what a repo is?")
- tail after "interested in." (75.85) → hold 0.4 s then end card
No reorder: the order already runs hook → problem → turn → audiences → community → CTA. ≈ 2.4 s saved (~68 s).

## Batches (current timeline seconds; shift after batch 0)
| # | Beat | Time | Framing | Graphic (Crimson #d34b55) | Generated asset |
|---|------|------|---------|---------------------------|-----------------|
| 1 | Hook | 0–8.64 | full frame, roto + depth, type BEHIND head | hook-promise behind-subject | LTX crimson smoke plate (rear) |
| 2 | Daily streams | 8.64–17.29 | presenter right 55% | teaching-card left | SDXL "LIVE" badge PNG (green key) |
| 3 | Old vs new | 17.29–24 | pip bottom-left | comparison | LTX green-screen rising bar chart (keyed) |
| 4 | Stream/learn/discover | 24–31.78 | presenter left 55% | numbered-lanes right | LTX red code-corridor cutaway 1.5 s |
| 5 | Experienced | 31.78–36.97 | presenter right 55% | teaching-card left | SDXL terminal icon PNG |
| 6 | Learn & improve | 36.97–44.03 | full frame punch-in 114% | "LEARN" behind subject (depth) + side-panel line | — |
| 7 | Beginner | 44.03–49.23 | presenter left 55% (mirror of 5) | teaching-card right | SDXL chat bubble PNG |
| 8 | All the tiers | 49.23–56.42 | pip top-left, occluder chapter | connected-map fullscreen | LTX silhouettes-at-laptops plate |
| 9 | Repos | 56.42–64.12 | presenter right 55% | terminal card → teaching-card "repo" | LTX terminal macro |
| 10 | CTA | 64.12–70.74 | full frame → end card | 3 CTA chips + ribbon-title | LTX crimson light band plate |

## Motion (12 principles, applied per graphic)
Anticipation (2-frame dip before entry) · squash & stretch on pops/chips · slow-in/slow-out (ease-out 0.6 s enters, 0.25 s exits) · overshoot + follow-through (110% → 100%) · arcs on icon flights · secondary action (pill reveals after card settles) · staging (one focal point) · timing (rows 120 ms apart) · exaggeration only on CTA · solid geometry (same card radius/border everywhere) · appeal (warm-white type, one red accent).

## Sound
Voice −16 LUFS leads. Bed (Digital Lemonade) 20 dB under, ducked 4–5 dB under dense lines, crescendo +3 dB into B3 turn and B8 chapter, drop-out 0.4 s before "discover what is possible with AI", resolve + 1.5 s fade on the end card. Whoosh 2 frames before each panel, tick per row, low impact + riser on B8, pop per CTA chip. J/L cuts across every seam.

## EDIT order
Batch 0: remove old graphics/sfx layers, tighten cuts. Batches 1–10 as above. Then level_audio → score music → beats snap → transitions → captions (optional) → run_frame_qa until clear → verify.

## Generated layers per batch (after local generation is ON)
- Green-screen motion graphics (LTX, 5–6 s, "isolated on pure solid chroma green background (#00FF00)…"), keyed with keylight #00ff00: B3 rising bar chart, B8 three glowing nodes linking, B9 terminal window typing.
- SDXL PNG cut-outs on chroma green, keyed, placed BEHIND the subject via depth: B2 "LIVE" badge, B5 terminal icon, B7 chat bubble, B10 subscribe bell.
- LTX rear plates (behind roto): B1 crimson smoke, B10 crimson light band.
- Every batch: fast_contact_sheet every:0.5 on that batch window → rotoscope_clip → depth_occlusion_clip → behind-subject layer → front card → sfx → mini QA.

## Blockers to clear before Start generating
- Settings → Local Media: switch OFF "disable local generation" (LTX + SDXL are installed but blocked).
- Stable Audio needs Hugging Face access → reuse the existing music bed.
- Magic eraser (LaMa) not installed → text-behind uses roto + depth instead of a clean plate.
