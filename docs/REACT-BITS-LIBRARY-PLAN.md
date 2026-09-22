# React Bits library for Helios AI — plan

Date: 2026-09-22. Status: implemented in this pass (see `docs/REACT-BITS-LIBRARY.md` for the reference).

## Why

React Bits (reactbits.dev) is a catalogue of 205 animated UI pieces: 32 text animations, 38 animations,
45 components, 33 micro-interactions and 57 backgrounds. Helios had a thin translation of it
(`src/lib/reactbits.ts`): entrance keyframes for text clips (`add_text style:"rb-*"`), ambient gradient
backgrounds for colour mattes, and six card treatments. The AI could name a few ids in `add_text`, but it
could not browse the library, could not place a React Bits piece as a real motion graphic, and most of the
catalogue (components, micro-interactions, the newer text and background pieces) did not exist at all.

The goal: the whole React Bits catalogue, basic to advanced, translated into things Helios can render
deterministically (preview and export show the same frame for the same time), discoverable and usable by
the AI through its tools, and documented in the system prompt.

## Constraints that shape the design

- A motion graphic is an `html` clip (`html`, `css`, optional GSAP `js`). The preview scrubs it with CSS
  variables (`--elapsed`, `--duration`, `--progress`, `--u`); the export rasterises the DOM per frame
  through an SVG `foreignObject` (`src/lib/htmlFrames.ts`). So: paused CSS animations driven by negative
  delays, no `backdrop-filter`, no external resources (`url(http…)`, web fonts, `<img src=http…>`), no
  WebGL/canvas. React Bits' WebGL/OGL/three pieces are re-expressed with gradients, SVG and CSS.
- Pointer-driven pieces (cursors, hovers, drags, toggles) become scripted "moments": the interaction plays
  itself on the clip's timeline, in causal order, once.
- Randomness (scramble glyphs, particle scatter, glitch slices) is seeded from the copy so preview and
  export agree.
- The house style is Crimson. React Bits pieces default to the Crimson tokens (dark red field, warm white,
  one red accent) and accept `theme` / `accentColor` overrides.
- The canvas is 1920 wide for landscape and 1080 wide for portrait (`mogrtCanvas`); everything is
  designed at 1920 and scaled by `--u`.

## Deliverables

1. **Library** `src/lib/rbx/`
   - `core.ts` — types (`Bit`, `BitProp`, `BitContext`), themes, the shared stage CSS (`.rbx`, slots,
     type scale, glass card, helper keyframes), seeded RNG, text splitters (words, letters, glyph stacks
     for scramble/decrypt/ASCII/shuffle), prop readers, SVG helpers.
   - `text.ts` (32), `animations.ts` (38), `components.ts` (45), `micro.ts` (33), `backgrounds.ts` (57):
     one builder per official React Bits entry, each with id, name, level (basic / intermediate /
     advanced), what it does on the web, how Helios renders it for video, when to use it, typed props with
     defaults, an example, a default length and layout.
   - `index.ts` — registry, `findBit` (accepts `split-text`, `rb-split`, `Split Text`), `listBits`
     (category / level / query), `describeBit` (props + a ready-to-copy `create_motion_graphic` call),
     `buildReactBitsGraphic` (one bit, or a background plus layered bits, each with its own layout, start
     offset and end), `reactBitsIndex()` for the system prompt.
2. **Tools**
   - New `react_bits` tool: `list` (filters), `describe`, `search`. Read-only, allowed in every phase.
   - `create_motion_graphic`: `template: "react-bits"` (or any bit id), `bit`, `props`, `background`,
     `layers`, `theme`. Frame QA gets the union box of the information layers.
   - `add_text` keeps the `rb-*` entrance shortcut; the legacy catalogue gains the missing 8 animations and
     17 backgrounds so `RB: <Background>` mattes and `rb-*` ids cover the whole official list.
3. **Renderer parity**: `HtmlMotionLayer` and `htmlFrames` size React Bits graphics on the comp canvas
   like Crimson templates; the frame renderer copies the extra CSS properties the library relies on
   (`background-clip`, `-webkit-text-fill-color`, `-webkit-text-stroke`, `perspective`, `mask-*` …).
4. **System prompt** (`src-tauri/prompts/copilot.md`): a React Bits section — when to reach for it versus
   Crimson templates, how to browse and place pieces, the parity rules, a compact index by category.
5. **Tests** `tests/reactBitsLibrary.test.ts`: the registry matches the official catalogue counts, ids are
   unique and resolvable, every bit builds with defaults and with its example, output is scrub-safe (paused
   animations, `--elapsed`), export-safe (no `backdrop-filter`, no external URLs), boxes stay inside the
   frame, compositions layer correctly, the tools answer, the phase gate lets `react_bits` through.
6. **Docs** `docs/REACT-BITS-LIBRARY.md`: the reference for people.

## Order of work

core → text → animations → components → micro → backgrounds → index → motionGraphics/aiTools/ai-tools.json
→ editWorkflow gate → HtmlMotionLayer/htmlFrames → copilot.md → legacy reactbits.ts + app.css → tests →
typecheck + vitest → docs.
