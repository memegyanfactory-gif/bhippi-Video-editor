# The animated UI library (React Bits and friends), rebuilt for video

Bhippi AI can place any of these as a motion graphic that animates in the preview and exports as
rendered frames. Every piece is deterministic HTML/CSS: paused animations scrubbed by time, seeded
randomness, no WebGL, no backdrop-filter, no external files. Code: `src/lib/rbx/`.

| Source | Pieces | Ids | What it is |
| --- | --- | --- | --- |
| React Bits (reactbits.dev) | 205 | plain (`split-text`, `magic-bento`, `aurora`) | 32 text animations, 38 animations, 45 components, 33 micro-interactions, 57 backgrounds — the full official catalogue |
| Animate.css | 97 | `ac-*` | every entrance / exit / attention animation, scraped keyframes |
| Open Props | 54 | `op-*` | 23 animations, 30 gradient backgrounds, a shadow demo; plus the token tables (easings, colours, fonts, sizes, borders) |
| Magic UI | 50+ | `mu-*` | marquee, bento, beams, meteors, sparkles, tickers, orbits, mockups, buttons, terminal, globe… |
| Aceternity UI | 50+ | `ace-*` | aurora, beams, boxes, lamp, spotlight, vortex, wavy, cards, carousels, tabs, timelines, forms… |
| Uiverse-style elements | 40+ | `uv-*` | buttons, loaders, switches, checkboxes, inputs, cards, tooltips, CSS patterns |

## For the AI

- Browse: `react_bits {"action":"list","category":"text","source":"react-bits"}` — filters category, level,
  source, query. `react_bits {"action":"describe","id":"count-up"}` gives props with defaults and a
  ready-to-copy call.
- Place one: `create_motion_graphic {"template":"react-bits","bit":"decrypted-text","title":"…","props":{…},"layout":"centre-card","duration":4}`.
- Compose: `{"template":"react-bits","background":"aurora","layers":[{"bit":"split-text","props":{"text":"…"},"at":0.3},{"bit":"uv-neon-button","layout":"lower-third","at":1.4,"until":5}]}`.
- Themes: `crimson` (default), `dark`, `light`, `mono`, `ember`, or `brand` — the active brand kit (the
  default whenever a kit is active). `accentColor` retints.
- Text shortcut: `add_text style:"rb-<id>"` for a cheaper per-word entrance on a plain text clip.

## For people

- Preview and export share one contract: the preview sets `--elapsed`, the frame renderer
  (`src/lib/htmlFrames.ts`) renders the same DOM at every frame. Backgrounds animate in the export too.
- Galleries use gradient placeholder tiles labelled from `rows`; put real footage on its own clip.
- Fonts are system families; Inter falls back to Segoe UI / Arial.
- Pointer-driven pieces play a scripted moment once (a cursor arrives, presses, the control responds).
- Adding a piece: a `bit({...})` in the right file with id, category, level, about, video, use, props,
  example, seconds, layout, tags and a `build(props, ctx)` returning `{ html, css }`. Tests in
  `tests/reactBitsLibrary.test.ts`, `tests/rbxExtAnimate.test.ts`, `tests/rbxExtMore.test.ts` check
  every piece builds on landscape and portrait canvases and stays export-safe.
