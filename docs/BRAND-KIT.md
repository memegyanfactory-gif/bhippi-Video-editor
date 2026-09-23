# Brand kits

A brand kit is the identity a project is edited to. It lives in Settings → Brand kit (user level, in
`settings.json` under `brandKits`), each project points at one (`activeBrandKitId` in the project),
and everything that decides a look reads it: Crimson templates, React Bits pieces (theme `brand`),
text clips, generation prompts, the voice-over voice and the system prompt. Code: `src/lib/brandKit/`.

## What a kit holds

Identity (name, tagline, description, industry, audience, values, style archetype) · Logos (role,
imported asset or inline SVG, embedded data URL for export, clear space, min size, placement, do-nots) ·
Colours (semantic tokens with usage, gradients, contrast pairs, rules; DaisyUI / Open Props provenance) ·
Typography (display / heading / body / caption / mono with weight, tracking, case; the % scale; rules) ·
Voice (tone, personality, use / avoid, samples, caption rules) · Motion (easing, enter / exit / hold /
stagger, intensity, transitions, principles, preferred React Bits pieces and Crimson templates,
Animate.css moments, Open Props ease) · Imagery (style, iconography, grade, prompt prefix / suffix,
negative prompt) · Layout (safe margin, logo bug, lower third, captions, radius, aspects) · Audio
(music, tempo, sfx, TTS voice) · Social (intro, outro, end card, hashtags) · Assets · Notes.

## Starting points

- The house look (Crimson), 16 style archetypes (minimal-mono, bold-startup, playful-pastel,
  luxury-serif, tech-gradient, editorial-magazine, retro-print, organic-earth, corporate-trust,
  cinematic-dark, neon-cyber, warm-craft, fintech-navy, sport-energy, wellness-calm, kids-bright —
  researched and contrast-validated, see `docs/research/`), and 16 reference kits rebuilt from public
  brand boards (`ref-luban`, `ref-capway`, `ref-unlok`, `ref-hurst`, `ref-realest`, `ref-bridze`,
  `ref-fisgo`, `ref-senda`, `ref-fastep`, `ref-tracko`, `ref-regrow`, `ref-lunchlane`, `ref-fewtech`,
  `ref-kozymart`, `ref-wodex`, `ref-sherly-moore`).
- The 35 DaisyUI themes as colour sections (real oklch → hex values).

## AI tools

`list_brand_kits`, `get_brand_kit {id?, section?}`, `list_brand_archetypes {group?, query?}`,
`create_brand_kit {style, daisyTheme?, brandName, tagline, …, voice{}, motion{}, imagery{}, …}`,
`update_brand_kit {id?, section, patch}`, `delete_brand_kit`, `set_active_brand_kit {id|null, scope}`,
`apply_brand_kit {restyle}` (retints existing Crimson / React Bits graphics and text clips),
`brand_kit_prompt {kind, prompt?}`, `render_brand_board`, `import_brand_logo {path, role}`,
`export_brand_kit`, `import_brand_kit {json}`. Reads are allowed in every production phase.

Choosing a kit: the project pointer wins, then the user default, then the only kit there is. When
none is active the prompt context still lists every kit (`brandKits`), and the AI picks one before
making graphics with `set_active_brand_kit {"auto": true}` (only / best match for the project / default
/ most recent) or `{"query": "<brand or industry words>"}`; every brand tool also accepts `query`
instead of an id.

Automatic use: `create_motion_graphic` themes React Bits pieces with the kit and gives Crimson templates
the kit's accent and type (`useBrand:false` or another `theme` opts out); `add_text` defaults to the
kit's text colour; `generate_local_media` prefixes prompts with the imagery rules and negatives;
`synthesize_speech_voiceover` prefers the kit's voice. The system prompt receives a compact `brandKit`
context object (never the raw kit or logo bytes).

## Settings panel

Kit list with default / this-project badges; New from archetype (optionally DaisyUI colours), Import /
Export JSON, Duplicate, Delete; the editor with every section and a live brand-board preview (the same
HTML the `render_brand_board` tool places on the timeline); "Use for this project" and "Make default".

## Export notes

Logos: inline SVG survives export as markup; raster logos are embedded as data URLs once when imported.
Fonts resolve by installed family name in both preview and export, so typography is restricted to
system-safe families (`SYSTEM_FONTS` in `src/lib/brandKit/build.ts`).

## The guideline (2026-09-23)

Every kit carries a detailed **guideline** (`src/lib/brandKit/guideline.ts`, type `BrandGuideline`): colour usage and the stage,
a type scale in px at 1080p, motion timing/easing/travel, **signature moves keyed frame by frame at 30 fps** (title-in,
word-cascade, title-out, lower-third-in/out, stat-count, emphasis, logo-sting, transition, end-card, caption-pop,
background-drift), layouts per aspect ratio with zones (fractions of the frame), scene recipes and dos/don'ts.
`guidelineOf(kit)` derives it from the tokens; the AI tailors it per video with `update_brand_kit {"section":"guideline"}`
(moves, layouts and recipes merge by id; colours and type always follow the tokens; `{"guideline": null}` resets).
Settings → Brand kit → Guideline draws all of it, moves as filmstrips with their key tables.

**In the motion engine** (`src/motion/kit/brandify.ts`, `brandTemplates.ts`):
- `brand-title`, `brand-lower-third`, `brand-stat`, `brand-panel`, `brand-logo-sting`, `brand-end-card`, `brand-transition`
  render the guideline's moves in its layout zones and type scale.
- Every other template is built with the brand font and then **brandified**: Crimson's warm reds (and the procedural
  backgrounds' red defaults) move onto a lightness ramp built from the brand colours, fonts become the brand's, `*-out` / `*-in`
  eases and text cascade timing become the brand's. The brand's own colours are never remapped.
- `create_motion_scene` / `update_motion_scene`, the Motion panel and the inspector all build in the active kit;
  scenes keep `scene.brand` (a snapshot) so rebuilds stay on brand. `useBrand:false` keeps the house look.

**AI tools**: `get_brand_guideline`, `extract_brand_from_url` (colours/fonts/logos off a website via the Rust
`web_page_source` command), `check_brand_compliance` (off-palette colours, off-brand fonts, unbranded scenes),
`import_brand_logo {"url"|"svg"}`. The system prompt's PLAN step 3b makes the AI settle the brand and write this video's
guideline before scripting; the "Product / SaaS video from a link" playbook covers an empty timeline.

Verify visually in the Motion Lab: the `brand-*`, `house-ribbon*` scenes in `src/motion/lab/scenesBrand.ts`.
