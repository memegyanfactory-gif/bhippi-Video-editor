# Film benchmark: six films, three models, one blind critic

Phase 7 of `docs/plans/NATIVE-AI-TOOLKIT-PLAN.md`. The film lab made six 15 s films from scratch, each
model writing its own renderer, capture rig and sound tools. This benchmark rebuilds the same six films
inside Bhippi with three kinds of model, scores them blind on the rubric the film-lab critics used, and
counts what each film cost. It is repeatable: the same briefs, inputs, operator replies, rubric and
arithmetic every round, so two rounds can be compared and a regression is visible.

**Targets** (the mean of a tier's six films, with no film more than 5 under it):

| Tier | Model | Target |
|---|---|---|
| opus | Claude Opus at Max effort (Bhippi's full tier) | ≥ 85 |
| mid | one mid model on the full tier, the same one every round (record its id) | ≥ 78 |
| small | one small model Bhippi runs on the guided tier (a free or local model; Bhippi shows "guided") | ≥ 70 |

The from-scratch films scored 84 (the 15 s launch film, v2), 75 (crimson explainer, v2) and 66 (glass
identity, v1). Opus at 85 inside Bhippi means the toolkit now does what those runs built by hand.

**Cost** is tracked per film: tokens (input + output as the provider reports them) and minutes (active: the
sum of the AI's turn times; wall: first to last event, operator waits included). A round is a regression
when any film scores lower than the round before, or costs more than 10% more tokens or active minutes.
The free runs are the ceiling on cost: crimson took about 258 minutes and 4,450 lines of its own code,
white SaaS about 69 minutes in its second session, and the full Opus launch film 96 minutes.

## Files

| File | What it is |
|---|---|
| `films.json` | The six films: the brief every tier gets word for word, the inputs to put in the project, the reference, the playbook the film should find, and the from-scratch baseline (score, render, minutes) |
| `rubric.md` | The ten criteria, the anchors from the film-lab critiques, how a critic measures, and the critic prompt |
| `inputs/meet-bhippi-lyrics.txt` | The song's lines as the film lab transcribed them (0–40 s). Replace it with the full lyric sheet when you have it; every tier then gets the new one |
| `results/<round>.md` | Each round's published table (`score --publish`) |
| `../../scripts/film-bench.ts` | The bookkeeping: `plan`, `record`, `blind`, `score` (Node 22.18 or later runs it directly) |

## A round, step by step

A round is 18 runs (6 films × 3 tiers) plus the scoring. Keep the round folder outside the repo: the
exports are large.

### 1. Before the round

1. Build Bhippi from the commit you are measuring and write the commit in the round's notes.
2. Settings → Brain → **Keep turn traces** on. `record` reads the traces.
3. Close any other Bhippi window so no other work lands in the traces.
4. **Freeze the brain.** A model saves skills as it works, which would help later runs. Copy the brain folder
   (`%APPDATA%\com.bhippi.videoeditor\brain` on Windows) to the round folder as `brain-start`, and restore it
   before every run. Bhippi's own seed skills are in it already after one turn.
5. Plan the round:

   ```
   node scripts/film-bench.ts plan "~/Documents/Bhippi/Benchmark/2026-10-01" --models opus=claude-opus-5-5,mid=<id>,small=<id>
   ```

   This writes `runs.json` (18 runs) and `briefs/<film>.txt`.

### 2. Each run (film × tier)

1. Restore `brain-start`. Create a fresh project in `<round>/projects/<film>-<tier>` and add the film's
   `inputs` (films.json) under the names it gives.
2. Choose the tier's provider and model. Opus runs at **Max** effort; mid at **High**; the small model at
   its default. Leave Settings → General on automatic: Bhippi puts the small model on the guided tier and
   the other two on the full tier, and `record` checks that from the trace.
3. Workflow **Full**. Paste `briefs/<film>.txt` as the first message, unchanged.
4. Operate the same way every time. The only replies you may send:
   - a question about size or length: "1920x1080, 30 fps, 15 seconds."
   - a plan or storyboard to approve: "Looks good, go ahead."
   - a question about taste or content: "Your call."
   - the turn stops before the film is exported: "Continue until the film is finished and exported."
   Never point at a fault, never fix anything by hand, never name a tool or a template.
5. Stop when the model says the film is done and exported, or after 3 hours of wall time (record what exists).
6. Export 1920x1080, 30 fps, H.264 to `<round>/exports/<film>-<tier>.mp4` if the model did not.
7. Record it:

   ```
   node scripts/film-bench.ts record <round> <film> <tier> --project "<round>/projects/<film>-<tier>" --film "<round>/exports/<film>-<tier>.mp4"
   ```

   It prints tokens, minutes, failed calls and the model's own judge_edit scores, and warns when Bhippi ran
   the film on the wrong tier or effort. The model's judge_edit is not the benchmark score: it is not blind.

### 3. Blind scoring

1. Hide the tiers:

   ```
   node scripts/film-bench.ts blind <round>
   ```

   Every export, plus the film lab's from-scratch renders (the "free" films, which calibrate the critics),
   is copied to `blind/F01.mp4` … in a seeded random order with a card each; `key.json` holds the key.
   Keep `key.json` and `runs.json` away from the critics.
2. Two critics, each a fresh session with the prompt in `rubric.md`, opened in the `blind` folder with
   access to the references. A critic scores the films that share a reference in one sitting and writes
   `scores/<critic>/Fxx.json` and `Fxx.md`.
3. Where two critics are more than 8 points apart on a film, a third critic scores it; all three count.
4. Score:

   ```
   node scripts/film-bench.ts score <round> --against <previous round> --publish
   ```

   `results.md` has every film's score with its tokens and minutes, each tier's mean against its target, what
   needs a look (a split panel; a critic more than 5 points off a free film's recorded score is off
   calibration and their cards are redone), and the regressions against the previous round. `--publish`
   copies the table to `docs/benchmark/results/<round>.md`; commit it with the round's notes.

## Round 0: calibration

The first round also answers whether the critics score like the film lab's: the free renders in the blind
pool are crimson v2 (75), glass identity v1 (66), the 15 s film v2 (84, on the launch variant, so a
difference of a few points is expected there) and white SaaS v1 (never scored; round 0 gives it its
score). fluid-saas and apple-launch have no from-scratch render; their Opus runs set the bar.

## Rules that keep rounds comparable

- The same brief, inputs, operator replies and stopping rule for every tier. A brief never names a tool or
  a template: frontier models keep every freedom, including their own renderer (delivered in passes so it
  stays editable), and the guided tier uses what Bhippi offers it.
- The same mid and small models every round; a model change starts a new series and is noted in the results.
- One run per film and tier per round. A run that crashed for reasons outside the model (the app, the
  provider's outage) is rerun from scratch and noted.
- Tokens are what the provider reports to Bhippi. CLI providers that do not report usage show 0; note it and
  compare minutes only for them.
