# Film benchmark rubric

The ten criteria the film-lab critics scored the from-scratch films on (the crimson explainer and
glass identity critiques; `docs/research/film-lab/crimson-explainer.md` §1), written down so every
round and every critic scores the same way. Each criterion is 0–10 in half points; the film's score is
their sum, out of 100. A critic may take off up to 2 more points for faults no criterion catches (an
unheard mix, a run of busy frames) and must say why, as the crimson critic did (sum 76.5, scored 75).

The card keys are in brackets; `scripts/film-bench.ts` reads them.

| # | Criterion | What it asks |
|---|---|---|
| 1 | Premium look and light [`look`] | Does every frame look expensive: lighting design, material, exposure, one lit world from start to end? |
| 2 | Faithfulness to the reference [`faithfulness`] | Does it use the reference's grammar (its structure, rests, moves, palette, pace) and recast it in Bhippi, rather than copying its content or ignoring it? |
| 3 | Camera and depth [`camera`] | Real camera moves through space, depth of field where layers separate, motion blur that reads as speed, moves that land. |
| 4 | Typography and type animation [`type`] | One family used well, readable sizes, landings on the words, no collisions, one copy of each phrase. |
| 5 | Sync to voice and beat [`sync`] | Hero actions on word onsets, cuts on bars, small events on snares, measured frame by frame. |
| 6 | Clarity [`clarity`] | Does a viewer get what Bhippi is and does, at phone size, in one watch? |
| 7 | Transitions and flow [`flow`] | Hidden cuts, one move at a time, even energy, no dead holds and no crowded seconds. |
| 8 | Polish [`polish`] | No artifacts, ghosting, aliasing, broken UI, orphans, safe-area misses or misspelled brand. |
| 9 | Originality [`originality`] | A product-native idea, not only a template or a shot-for-shot copy. |
| 10 | Audio [`audio`] | The right music, placed well; every cue audible and one per event; -16 LUFS (±1), true peak ≤ -1 dBTP. |

## Anchors

Scores the critics actually gave, so a new critic can place a film against them.

| Criterion | About 6 | About 7.5 | About 9 |
|---|---|---|---|
| look | crimson v1's white Characters stage doubling the frame's light (7 with the rest rich) | crimson v2: a rich field and glass mark, one grey plate that reads as a smear | the aflow reference (9.5): one milky illustrated material, restrained light |
| faithfulness | glass v1 after 3.5 s (6.5): the grammar drifts to a jelly logo sting | crimson v2 (8): the hook beat for beat; the second hook line and the card montage missing | a reference itself (10) |
| camera | glass v1 (6): locked centre frame for 6.8 s, one turn | crimson v2 (7.5): tilts, a slam, whips; cards on a plane, no real depth | the 15 s film v2 (8): a crane, a pull-back, a tamed whip; one final wide that never lands |
| type | glass v1 (5): the brand spelled "Bhıppı" for 1.9 s, an 18 px tagline | crimson v1 (7): good landings, a title landing on a title | crimson v2 (8), the 15 s v2 (8): one copy of each phrase, clean landings |
| sync | the earlier Opus film's first 15 s (7): typing trails the voice | glass v1 (8): every event on a word or onset except the key morph | the 15 s v2 (9): every word on its syllable, checked frame by frame |
| clarity | crimson v1 (6.5): pills rarely readable in full, eight features in 12 s | crimson v2 (7.5): every pill reads for 0.6 s; still a list of eight | the 15 s v2 (8): ask → work → result reads end to end, but nobody is seen asking |
| flow | the 15 s v1 handover (about 7): a blurred mark on grey for 18 frames | crimson v2 (7.5): three windows busy for 3–5 frames | the aflow reference (9.5): light does every change |
| polish | crimson v1 (6): stepped ghosts, empty pills, a cropped presenter | the 15 s v2 (7): a smeared bubble, cursors parked off the edit | the Crimson Brief reference (7.5) is the top the film lab saw; 9 means no fault in any still |
| originality | a template used as given | crimson (7.5): the real edit Bhippi performed, the mark that thinks | an idea only this product could have |
| audio | crimson v1 (7): 87 cues, busy and never auditioned | glass v1 (7.5): a smart edit, a correct master, a gap the picture does not bridge | the right song, every cue heard on laptop speakers, a master at -16 LUFS / -1 dBTP |

Film totals on this scale: crimson v1 68, crimson v2 75, glass identity v1 66, the Crimson Brief reference
80, the aflow reference 84. The 15 s launch film's 76 (v1) and 84 (v2) were scored on the launch variant
(real product UI instead of faithfulness; look, product UI and story counted double over 130, then
calibrated to 77 for the Opus film's first 15 s); round 0 of the benchmark re-scores it on this scale.

## How a critic works

The critiques that moved the films the most measured before they judged. Every critic does the same, for
every film, from the blind folder only (never `key.json`, never `runs.json`).

1. **Frames.** Decode the whole film at 1920x1080. Sheets every 0.5 s and every 0.1 s (10 fps) in 3 s
   blocks; frames at -2 frames, the onset and +3 frames around every word the voice or song says; frame by
   frame across every cut and every hero moment. The same sheets for the reference's matching stretch.
2. **Light.** Mean luma (0–255) every 0.5 s and the 98th percentile of the UI shots. A dark film should sit
   at 45–60; no shot twice as bright as the one before.
3. **Reading size.** The cap height of every line a viewer must read (26 px or more at 1080p) and how long
   it is readable.
4. **Sharpness.** Mean absolute Laplacian over each landing: a move lands when 10 frames sit within 10% of
   the shot's still frames.
5. **Sound.** `ffmpeg -af ebur128` for integrated loudness, LRA and true peak; each cue's level against the
   music's 100 ms RMS around it; a spectrogram.
6. **Score.** Fill the card (`blind/Fxx.card.json` copied to `scores/<critic>/Fxx.json`): the ten scores,
   the deduction and why. Beside it write `Fxx.md`: the verdict in three lines, the table with a note per
   criterion, what to keep, and the top fixes, most impactful first, each with its time range, what is wrong
   now and a fix with numbers.

## The critic prompt

Paste this into a fresh session (Claude Opus at its highest effort, with ffmpeg and Python available),
one session per critic, opened in the round's `blind` folder:

> You are a harsh creative director scoring short product films for Bhippi, an AI video editor, blind. The
> films are `F01.mp4` … in this folder; each `Fxx.card.json` names the film's brief and its reference. You
> do not know who or what made any film, and you must not try to find out. Score the films that share a
> reference in one sitting, against that reference, on the ten criteria in `rubric.md` (0–10 in half
> points; the anchors there are the scale). Measure before you judge: sheets at 0.5 s and 10 fps, frames
> around every spoken word, frame by frame across every cut; mean luma and its 98th percentile; the cap
> height of text a viewer must read; the sharpness of each landing; loudness, true peak and each cue's
> level against the music. Take off up to 2 points for faults no criterion catches, and say why. For each
> film write `scores/<your name>/Fxx.json` (the card, filled) and `Fxx.md` (verdict, the table with a note
> per criterion, what to keep, the top fixes with time range, what is wrong now and a fix with numbers).
