# Training brand kits from references, and templates that work for every model

Plan for two asks, 2026-09-29. Items are tracked in `docs/IMPROVEMENT-TODO.md` (Phases 6 and 7).

## What exists today (build on it, don't duplicate it)

| Piece | Where | What it does | Gap |
| --- | --- | --- | --- |
| Reference films | `src-tauri/src/refs.rs`, `ref_motion.rs`, `motionTools.ts` `analyze_reference_video` / `save_style_profile` | Measures cuts, cadence, 6-colour palette, contact sheets, motion/ease profile; stores prose notes in a global library | Never reaches a brand kit; type, layout and captions are only prose |
| Brand kits | `src/lib/brandKit/*`, `brandKitTools.ts` | Identity, colours, type, voice, motion, layout, assets, a derived guideline | No learnings, sources or history; `notes` and `assets` are not sent to the AI |
| Slash commands | `src/chat/commands.ts` | `/ref`, `/shorts`… run before send | Commands can't receive attachments |
| @-mentions | `ChatPanel.tsx` mention menu | Styles (`@funny`) and references | Brand kits can't be tagged; no per-turn kit override |
| Brain / Learning | `brain.rs`, `learning.ts` | Global memory with caps and dedup; cut-rhythm skills with review | Not per kit |
| Weak-model path | `modelProfile.ts` (guided tier), `build_edit_from_brief`, `guidedBuild.ts` | Fixed beat shapes on 5 brand templates | Only 7 beat kinds; other templates have prose-only params, no validation or auto-fix |

## Part A — `/train`: references teach a brand kit

### How it works for the user

1. `/train` in the chat, with anything attached or pasted: a video file, a YouTube/Instagram/TikTok link, images, a website, or `this timeline` (the current comp).
   Optional kit: `/train @Unlok <link>`. Without one, it trains the project's active kit (and asks when there is none).
2. Bhippi studies it and posts a **review card**: "Learned 9 things from <source>", grouped (Pacing, Colour, Type, Layout, Motion, Captions, Audio, Voice, Do / Don't), each with Keep / Edit / Skip.
3. Kept learnings are saved into the kit with their source. The kit page gets a **Learnings** tab: list, edit, disable, delete, see where each came from, undo a training.
4. In any chat, `@Unlok` tags the kit for that turn (a chip on the message). The AI then follows that kit and its learnings, even if the project's active kit is another one.

### How it works inside

- **Model:** `BrandKit.learnings: KitLearning[]` and `BrandKit.sources: TrainingSource[]`.
  - `KitLearning = { id, area, text, value?, sourceIds, confidence, status: 'active' | 'off', addedAt, uses }`.
  - `value` holds measured numbers where there are any (cut every 1.8 s, palette hexes, words per minute, title size ratio), so code can use them, not just the prompt.
- **Measure first, then describe.** Code measures what it can:
  - existing refs ingest: cuts, cadence, palette, contact sheets;
  - motion profile: moves and eases;
  - music beats;
  - speech pace from the transcript;
  - for websites: colours and fonts from `extract_brand_from_url`.
  
  The model then reads the sheets and writes the qualitative learnings through one schema-checked tool, `train_brand_kit`. Weak models only fill the prose around numbers that already exist.
- **Keeps learning without bloating:**
  - a cap per area and in total (following the caps in `brain.rs`);
  - merge near-duplicates;
  - a newer measured value replaces an older one for the same thing, and the old one is kept in history;
  - confidence rises when two references agree.
- **Into the prompt:** `brandKitContext` gets a budgeted "learned" section: the top learnings ranked by confidence and by relevance to the video type. Measured values also feed code paths directly:
  - pacing → `planBuild` holds and cut cadence;
  - palette → template colours;
  - caption style → the default caption preset.
- **Optional, later:** propose learnings from the user's own corrections. For example, "you resized every AI title to ~70% — remember that for Unlok?". These always need a click to keep.

## Part B — a template library that looks good with any model

1. **A typed slot schema for every template.** It covers Crimson HTML, motion-engine and React Bits templates. Each slot has a type, required flag, max characters/words, allowed values, number ranges and a default taken from the brand kit. One source generates both the tool schema and the validator.
2. **Auto-fix before building:**
   - fit overlong text (wrap, shrink to fit, then shorten, with a note saying so);
   - replace invalid colours with brand colours;
   - swap text colour to pass contrast (4.5:1);
   - clamp numbers;
   - fill missing slots from brand defaults;
   - check text overflow inside cards as well as off-frame.
   
   The tool reports what it fixed, instead of failing or silently dropping values.
3. **One simple graphic tool for small models:** `add_graphic({ kind, text…, at })`.
   - Kinds: title, stat, list, quote, lower-third, compare, steps, timeline, callout, chart, CTA, end card.
   - It picks the template from the brand kit, its learnings and the frame shape.
   - The same beat kinds are added to `build_edit_from_brief`.
4. **A filled example and a thumbnail per template.** `list_motion_templates` returns a compact schema plus example for small models.
5. **The guided tier stays on safe tools.** Raw scene and HTML authoring are hidden. Every graphic gets a quick render check (blank, overflow, off-frame), with one automatic fix-and-retry.
6. **A template quality pass:** every template uses brand tokens only (type scale, spacing, colours), so it looks right with any kit.
7. **An evaluation suite:**
   - the same briefs run through a small model and a large one;
   - scored by frame QA and the judge;
   - pass rates recorded in `docs/benchmarks/`, so "works on small models" is measured, not hoped for.

## Order

A1 data model → A2 `/train` command with attachments → A3 measure + `train_brand_kit` tool + review card → A4 `@kit` tagging and per-turn override → A5 learnings in the prompt and code paths → A6 Learnings tab.
B1 slot schemas → B2 auto-fix → B3 `add_graphic` → B5 guided tier → B4 examples → B6 quality pass → B7 evals (start B7 early so each step is measured).
