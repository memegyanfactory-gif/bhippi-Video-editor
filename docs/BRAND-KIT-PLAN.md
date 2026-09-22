# Brand Kit + design-library expansion — the plan

Date: 2026-09-22. Companion to `docs/REACT-BITS-LIBRARY-PLAN.md` (the 205-piece React Bits library, done).
Status 2026-09-23: implemented — see `docs/BRAND-KIT.md` and `docs/REACT-BITS-LIBRARY.md` for the reference. Magic UI, Aceternity and Uiverse are curated video-relevant subsets (50+ / 50+ / 40+ pieces), not the complete catalogues.

## What the user asked for

1. A **Brand Kit** system in the Settings panel: the user builds a brand kit for their product (logo,
   colours, typography, voice, motion, imagery, layout, audio, social), in many different styles, and
   every AI provider can use it while editing a video or making a motion graphic. References: the ui8
   "Brandkit design system" product and Dribbble "full branding kit" shots (Kuban, Capway, Unlok, Hurst,
   Realest, Bridze, Fisgo.ai, Senda, Fastep, Tracko, Regrow, Lunchlane, Fewtech, Kozymart, Wodex, Sherly).
2. **Tools for everything**: the AI must be able to list, read, create, update, delete, activate and
   apply brand kits, and everything it builds must read the active kit.
3. **More libraries in the core**: Open Props (CSS variable system: colours, fonts, sizes, shadows,
   easings, animations, gradients), DaisyUI (35 semantic themes), Uiverse.io (HTML/CSS elements:
   buttons, loaders, cards, toggles, checkboxes, patterns), Animate.css (entrance / exit / attention
   animations), Magic UI and Aceternity UI (shadcn + Framer Motion components) — scraped, hardcoded,
   and usable both by the animation library and the brand kit.

## What exists (from the code reconnaissance)

- `src/lib/brand.ts` — a dead-code `Brand` model (palette, fonts, type scale, radius, shadow, motion,
  captionStyle) with `deriveBrand`, `brandVars` (CSS variables) and `brandSummary` (prompt line). The kit
  extends it rather than replacing it.
- Settings persist through `api.settingsSave(whole)` → Rust `settings_save` → `settings.json`. The Rust
  `Settings` struct is strict; `layout: Option<serde_json::Value>` is the precedent for an opaque,
  UI-owned blob. **One Rust line** adds `brand_kits: Option<Value>`.
- The project is a strict serde struct too; `sanitize()` in `timeline.ts` whitelists fields. A per-project
  pointer `activeBrandKitId` costs four small edits (types, newProject, sanitize, project.rs).
- The system prompt receives the whole `context` object as JSON (`{{CONTEXT}}`); `App.tsx` already adds
  `reference` next to `aiContext(...)`. Adding `brandKit` there needs no Rust change.
- Fonts resolve by installed family name only (preview CSS + libass `\fn`). Typography must use
  system-safe families; HTML graphics may inline `@font-face` later.
- Exportable HTML graphics cannot fetch files: logos must be inline `<svg>` or `data:` URLs. There is no
  file→data-URL helper yet; `fetch(fileSrc(path))` is the proven primitive.
- Tools: append to `src/lib/ai-tools.json` + a `case` in `runToolInner`; read-only tools go in
  `ALWAYS_TOOLS` (`editWorkflow.ts`). Host callbacks (like `setReference`) are the precedent for
  mutating settings from a tool.

## Architecture

### Data (`src/lib/brandKit/`)
- `types.ts` — `BrandKit` (extends `Brand`): identity (name, tagline, description, industry, audience,
  values, style archetype), `logos[]` (role, assetId/path, inline svg, cached dataUrl, clear space, min
  size, placement, on light/dark, do-nots), `colors` (semantic tokens with usage, gradients, contrast pairs,
  rules, DaisyUI theme / Open Props hue provenance), `typography` (display/heading/body/caption/mono
  typefaces with weight, tracking, casing; scale; rules), `voiceGuide` (tone, personality, use/avoid,
  samples, language, caption rules), `motionGuide` (easing, enter/exit/hold/stagger, intensity,
  transitions, principles, preferred React Bits pieces and Crimson templates, Animate.css moments, Open
  Props ease), `imagery` (style, photography, illustration, iconography, grade, prompt prefix/suffix,
  negative prompt, keywords, avoid), `layout` (safe margin, grid, logo bug, lower third, captions, radius,
  aspects, rules), `audio` (music, tempo, sfx, TTS voice, rules), `social` (platforms, intro, outro, end
  card, hashtags, rules), `assets[]`, notes. `BrandKitDoc = { kits, activeId }`.
- `archetypes.ts` — 16 hardcoded style archetypes (from `docs/research/brand-kit-archetypes.json`,
  scraped from ui8 / Dribbble / brand-guideline sources): Minimal Mono, Bold Startup, Playful Pastel,
  Luxury Serif, Tech Gradient, Editorial Magazine, Retro Print, Organic Earth, Corporate Trust, Cinematic
  Dark, Neon Cyber, Warm Craft, Fintech Navy, Sport Energy, Wellness Calm, Kids Bright — plus the Dribbble
  reference kits as named presets.
- `daisyThemes.ts` — the 35 DaisyUI themes as semantic token sets (primary, secondary, accent, neutral,
  base-100/200/300, info, success, warning, error and their `-content` pairs, radius, border), each
  convertible into a kit's colour section.
- `openProps.ts` (in `src/lib/rbx/ext/`) — Open Props tokens: hue scales, gradients, shadows, easings,
  font stacks/sizes/weights, sizes, borders, and the animation set; emitted as CSS variables for graphics.
- `build.ts` — `newBrandKit(archetype | daisyTheme | overrides)`, `mergeBrandKit(kit, patch)`,
  `validateBrandKit`, `brandKitTheme(kit)` (React Bits theme), `brandKitCrimson(kit)` (accent, fonts),
  `brandKitCaptionColor`, `brandKitPrompt(kit)` (imagery rules for generation), `brandKitVars(kit)` (CSS
  vars incl. the older `brandVars`), `brandKitSummary(kit)` / `brandKitContext(kit)` (compact object for
  the system prompt, never the raw kit), `brandBoard(kit)` (an HTML brand board graphic: logo, palette
  swatches, type samples, lower-third mock, motion sample), import/export JSON.
- `logoData.ts` — `assetDataUrl(path)` (fetch → FileReader, cached) so raster logos can be embedded in
  exportable graphics; inline SVG preferred.

### Persistence
- `Settings.brandKits: BrandKitDoc | null` (TS) + `brand_kits: Option<serde_json::Value>` (Rust). Merged
  in `App.tsx` startup and saved with the settings pattern.
- `Project.activeBrandKitId: string | null` — travels with the `.helios` file; resolves as
  `project.activeBrandKitId ?? settings.brandKits.activeId`.

### Settings UI (`src/settings/BrandKitSettings.tsx`, tab "Brand kit")
- Kit list with active marker, New (from archetype / from DaisyUI theme / blank / duplicate), Import JSON,
  Export JSON, Delete.
- Editor with sections (Identity, Logos, Colours, Typography, Voice, Motion, Imagery, Layout, Audio, Social,
  Assets, Notes). Logo upload through the file dialog → `importMedia` into a "Brand" folder; SVG paste box;
  colour token rows with hex pickers and roles; gradient editor; typeface pickers restricted to system-safe
  families; motion sliders with a live sample; imagery prompt fields; layout pickers; audio (music, tempo,
  sfx, TTS voice from installed voices); social; notes.
- Live **brand board preview** rendered from `brandBoard(kit)` through `HtmlMotionLayer`.
- "Set active for this project" and "Default for new projects".

### AI tools (all in `ai-tools.json` + `aiTools.ts`; read-only ones in `ALWAYS_TOOLS`)
- `list_brand_kits` — kits with id, name, style, active flags, one-line summary.
- `get_brand_kit {id?, section?}` — the full kit or one section; the active one when no id.
- `list_brand_archetypes` — the 16 styles + DaisyUI themes + reference presets with palettes.
- `create_brand_kit {name, style|daisyTheme, brandName, tagline, industry, audience, overrides…}` — builds a
  complete kit from an archetype and the details given; returns the summary. Meant for "make me a brand
  kit for X" — the model fills every section.
- `update_brand_kit {id, section, patch}` — merges a section.
- `delete_brand_kit {id}`.
- `set_active_brand_kit {id, scope: project|default}`.
- `apply_brand_kit {id?, scope: graphics|captions|all, restyle: bool}` — makes the kit the project's look:
  caption style colour, default text colour, Crimson accent/fonts, React Bits theme; optionally restyles
  existing text and motion-graphic clips.
- `brand_kit_prompt {id?, kind: image|video}` — the imagery prefix/suffix/negative for generation.
- `render_brand_board {id?, start?, duration?}` — places the brand board as a motion graphic.
- `import_brand_logo {path, role}` — imports a logo file into the Brand folder and attaches it.
- Existing tools read the kit automatically: `create_motion_graphic` (Crimson accent and font, React Bits
  `theme: "brand"`), `add_text` / `add_captions` (default colour), `generate_local_media` (prompt prefix,
  negative), `synthesize_speech_voiceover` (voice), `create_project_guideline` (kit notes appended).

### System prompt
- `{{CONTEXT}}` gains `brandKit` (compact summary object) when a kit is active.
- `copilot.md` gains a "BRAND KIT" section: the kit is binding for colours, type, motion and imagery; how
  to read it (`get_brand_kit`), how to make one (`create_brand_kit` from an archetype), and that
  `theme: "brand"` on React Bits pieces and Crimson templates uses it.

### Library expansion (`src/lib/rbx/ext/`)
Every piece keeps the core contract (paused CSS choreography scrubbed by `--elapsed`, seeded randomness,
no backdrop-filter, no external resources) and registers in the same registry with a `source` field so
`react_bits` lists and describes them (filter `source`).
- `animateCss.ts` — the full Animate.css catalogue as `rbx-`-namespaced keyframes: attention seekers,
  back entrances/exits, bouncing, fading, flippers, lightspeed, rotating, specials, zooming, sliding. Usable
  as an `entrance`/`exit` prop on any card/text piece, as pieces themselves, and as `add_text` entrances.
- `openProps.ts` — Open Props animations (fade, scale, slide, shake, spin, ping, blink, float, bounce,
  pulse), easings, gradients (30), shadows, colour hue scales, font stacks; exported as tokens + CSS.
- `magicUi.ts`, `aceternity.ts` — the component catalogues rebuilt for video (marquee, bento, border beam,
  shimmer button, meteors, sparkles, number ticker, orbiting circles, retro grid, ripple, hyper text,
  box reveal, blur fade, shine border, aurora background, background beams, lamp, moving border, flip
  words, typewriter, tracing beam, vortex, wavy background, 3D card, glowing stars, …).
- `uiverse.ts` — Uiverse-style elements: buttons, loaders, cards, toggles, checkboxes, inputs, tooltips,
  patterns.
- `index.ts` registers them; tests cover counts, uniqueness, build safety.

## Order of work
1. React Bits library green (typecheck + tests). ✔ in progress
2. Brand kit types (this file's data model) → research-driven archetypes + DaisyUI themes (subagents).
3. Library expansion files (subagents, in parallel): Animate.css + Open Props; Magic UI + Aceternity;
   Uiverse. Registered by the lead.
4. Brand kit core (`build.ts`, `logoData.ts`), persistence (TS + 1 Rust line + project pointer), tools,
   prompt context, consumption hooks (motion graphics, text, generation, voice).
5. Settings UI (subagent) against the finished types and build helpers.
6. Tests, typecheck, vitest, cargo check; docs (`docs/BRAND-KIT.md`) and memory.
