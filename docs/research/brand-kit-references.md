# Brand Kit Research: References, Taxonomy, Archetypes

Research date: 2026-09-22. Purpose: give Bhippi engineers a complete picture of what a professional brand kit / brand design system contains, what rules each section states (with numbers where sources give them), how each section applies to video, and a catalogue of 16 distinct brand-style archetypes with concrete values that can be hardcoded as presets and used by the AI copilot to generate brand kits. The machine-readable companion is `brand-kit-archetypes.json` (same folder).

How this maps to the existing code: `src/lib/brand.ts` already has `Brand { palette{accent, ink, surface, text, muted, accentAlt}, fonts{display, body, mono}, type{hook..caption as % of frame height}, radius, shadow, motion{entrance, exit, emphasis, beat}, captionStyle }` with curves from `src/lib/motion.ts` (`entrance`, `exit`, `overshoot`, `standard`) and `TIMING.quick/normal/slow`. The archetype JSON uses the shape requested by the task; the obvious mapping is `colors.bg -> palette.ink`, `colors.accent2 -> palette.accentAlt`, `motion.easing -> a new CurveName or a raw cubic-bezier`, `motion.enter/exit/hold -> beat-derived timings`, `layout.safeMargin -> title-safe inset`.

---

## Part A: Brand kit taxonomy

A complete kit has four layers. Every professional checklist reviewed (Frontify, KOTA, Confetti, Dribbble's branding-package guide, Brandkit.com, the ui8 BrandKit products) converges on the same skeleton; the video-specific layer is what the video style guides (Adventist Health, WashU, PTC, Parmonic, IdeaRocket, Puritano) add.

### A0. Layer map

| Layer | Sections | Where the ui8 BrandKit product puts it |
|---|---|---|
| Foundation (strategy) | Brand core, positioning, personality, values, voice & tone, governance, AI rules | "Brand Principles" doc |
| Identity (expression) | Logo system, colour system, typography, iconography, illustration, graphic devices/patterns, photography, layout/grid, motion, sound | Logo System, Color System, Type System, Grid System, Icon & Image Library |
| Application (execution) | Digital & social, stationery, presentation, packaging, signage/environment, merch, video | Templates, social media & email kits, component library |
| Delivery | Brand book, brand wiki/portal, asset library, tokens | "Full Brand Book", "Brand Wiki" |

### A1. Brand core / principles

Contents (Frontify, Confetti): mission, vision, values (3–5, each with a one-line "what it looks like in practice"), positioning statement ("For [audience] who [need], [Brand] is the [category] that [differentiation]"), audience, price-value position, 3–4 personality traits described behaviourally, 1–2 archetypes, and "what the brand is NOT". Frontify frames the whole document around four questions: *What is approved? When should it be used? What should be avoided? Who can approve exceptions?*

Video application: the core decides pacing (calm vs. energetic), the default intro/outro treatment, whether humour is allowed in captions, and the music brief. It should be encoded as the archetype's `character`, `voice.tone`, `motion.intensity`, and `audio.music`.

### A2. Logo system

Contents (Frontify, KOTA, Confetti, JHM, KareemStudio, ui8 BrandKit "Logo System": Logo Guidelines, Logo Construction Breakdown, Spacing Guidelines, Color Pairing, Sample Logo Applications):

- Variants: primary lockup, horizontal, stacked/vertical, symbol/mark only, wordmark only, app icon, favicon, monochrome, reversed (for dark backgrounds), single-colour, greyscale.
- Construction: the mark drawn on a unit grid; every Dribbble shot reviewed shows this (Luban 5.2x / 4.2x / 2.1x, Unlok 3.2x / 3x / 2.2x, Capway 7x / 6x / 0.5x, Bumble 2x / 3x / 4x at -45°, Senda 4.2x, Fastep 4x / 0.5x, Bridze on a 6px grid with a ½px stroke, Opteam 2x / 0.5x). ui8 BrandKit specifies mark-to-wordmark gap as `.3x` of mark width.
- Clear space (exclusion zone): expressed as a ratio of a repeating logo element, never fixed px/mm. Unit X = x-height of the wordmark (gold standard), or cap height, or a distinct symbol dimension. Multipliers: compact digital 1.0×, standard corporate 1.5×, premium/luxury 2.0× (KareemStudio). Real examples: Johns Hopkins Medicine uses the height of the capital "H"; Adventist Health uses "the size of the largest leaf in the brand symbol". Print adds a 3 mm (0.125 in) buffer to trim (guillotine tolerance ±1.5 mm).
- Minimum size: separate values for print (mm/in) and digital (px). Typical: 20 mm print / 60 px digital (Brandy HQ); 80 px primary, 24 px icon-only (Inkbot); JHM: 1.5 in horizontal, 1.25 in vertical, below which the name is set in type instead.
- Colour pairing: which logo version goes on which background (light, dark, photo, brand colour); International Motors: lockup 50–100 % of the format's shortest side, symbol 20–40 %.
- Misuse: no stretching, rotating, recolouring, effects (drop shadow, glow, outline), placing on busy imagery, or breaking clear space.
- Co-branding: partner logos at equal visual weight, a 1-pt divider at 30 % black (or 0.5 pt), divider height 150 % of logo height, match x-height or cap-height; only one institutional logo per frame (WashU).

Video application: logo bug (watermark) in a corner at 5–10 % of canvas width, 30–60 % opacity (sources range 20–70 %), always inside title-safe, never over titles or transitions (Puritano: "lower-right during content, never during titles"). End card logo 1/4 to 1/3 of frame width (Adventist Health: 480 px ≤ width ≤ 640 px at 1920×1080). Logo animation ("spark" / bumper) uses the full-colour version on a flat background; PTC: every video ends with an animated bumper, starting with one is discouraged because the first 3 s decide retention. Slack: keep the logo's original proportions when animating.

### A3. Colour system

Contents (Confetti, Frontify, ColorArchive, ui8 BrandKit "Color Library & Styles": Full Color Palette Styles, Detailed Color Shades, Gradient System, Color Pairing; Premium Brand Guidelines: Full Color Palette, Primary/Secondary/Tertiary, Color Pairing Guide, Greyscale System, Sample Color Combinations):

- Primary palette (2–3 colours), secondary/supporting palette, neutrals/functional (backgrounds, dividers, text), status colours (success, warning, error, info).
- Every colour given as HEX, RGB, CMYK, Pantone (RAL for signage); dark-mode adaptations.
- Shade ramps: 50–900 (Tailwind style) or 0–100 (Radix style), 500 = the brand colour; ui8 BrandKit ships 8 named hues × 50–900 (e.g. Primary 500 `#383AD2`, Grey 50 `#F2F2F0`, Coral Reef 500 `#FF7F65`, Turquoise 500 `#47EBEB`, Rajah 500 `#FCC188`, Indigo 500 `#7042D2`, Blue 500 `#202AB9`, Red 500 `#F63D68`).
- Token layers: primitive (`color.blue.500 = #3B82F6`) → semantic/alias (`color.action.primary = {color.blue.500}`, categories: surface, text, border, action, status, icon; state suffixes `.default/.hover/.pressed/.disabled`) → component (`button.background.primary`). Rule: semantic names never contain hue words, so a rebrand only changes primitives.
- Proportion: 60 / 30 / 10 (dominant / secondary / accent); the accent loses impact if overused.
- Gradients: a named gradient system (BrandKit shows a "Brand Purple" `#4648FF` → peach primary gradient, plus Black `#010109` and White `#F2F2F0`).
- Accessibility: WCAG AA 4.5:1 for normal text, 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold); AAA 7:1 / 4.5:1; logos and decorative text exempt. Publish a matrix of approved foreground/background pairs.

Video application: all overlay text must meet AA contrast against moving footage, so give every archetype a `text` on `bg`/`surface` pair that passes and add a scrim or card when footage is unpredictable. The 60/30/10 rule maps to background/card/accent in lower thirds and end cards. Colour grading LUTs should be part of the kit (Puritano: "apply brand color LUTs across all footage"); `imagery.grade` in the JSON carries the direction.

### A4. Typography system

Contents (Confetti, Frontify, cieden, Typography Master, ui8 BrandKit "Type System": Modular Type Scale, Typeface Breakdown, Typography Pairing Guide, Typography Best Practices, Sample Typography Applications):

- Primary (display/headline), secondary (body), functional (data, legal), fallback/system fonts, licensing.
- Weight hierarchy (Light/Regular/Medium/SemiBold/Bold), casing rules, letter-spacing per size, line-height per size.
- Modular scale ratios: minor second 1.067, major second 1.125, minor third 1.2, major third 1.25 (dense UI), perfect fourth 1.333 (editorial/marketing), augmented fourth 1.414, perfect fifth 1.5 (hero/editorial), golden 1.618 (luxury/display). Base 16 px. Body line-height 1.4–1.7 (1.5–1.65 typical), display 1.1–1.2, tight tracking on large display type. ui8 BrandKit's display ramp: Display XXL 112 px / LH 100 % / tracking -4 %; XL 96 px / 100 % / -4 %; Large 88 px / 100 % / -4 %; Medium 72 px / 110 % / -4 %; Small 64 px / 110 % / -3 %; each in Light, Medium, Bold. Its type-style panel lists sizes 240, 120, 96, 80, 72 (size/line-height 100).
- Weight pairing convention: body 400, subheads 500, headings 600–700.
- Minimum sizes for packaging/legal text.

Video application: type is measured as % of frame height (Bhippi already does this in `TypeScale`); WashU's lower third uses up to 77 px name in SemiBold, title in Light at 1080p (~7 % of height). Captions: 64–88 px on 1080×1920 (7–9 % of frame height), bold sans, white or yellow with a 3–4 px dark stroke or box. Never animate character-by-character (Slack), keep text legible at all times, hold on screen long enough to read twice aloud (Adventist Health, Epidemic Sound).

### A5. Iconography

Contents (ONS, Material, Bigeye, Confetti): grid size (24 px with 2 px padding; ONS small 16 / medium 32 / large 64), stroke weight (2 px at 24 px; ONS 1 / 1.5 / 3 px), corner radius (2 px default, 2–4 px friendly), terminal style (round/square), outline vs filled, keyline shapes (circle, square, rectangle, diagonal) for equal optical weight, colour rules (single colour, tints), sizes, SVG/PNG export.

Video application: icons animate as strokes drawing on or shapes scaling from 0.8→1.0; keep stroke width constant while scaling (scale the group, not the stroke).

### A6. Illustration & graphic devices

Contents (Confetti, Number Analytics, Bynder): style (flat, outline, textured, 3D), line weight, corner treatment, fill style, colour limits, composition rules, subjects, what the style is not, 6–12 reference moodboard images. Graphic devices/supergraphics/patterns: how the mark is cropped, repeated, or used as a container; Dribbble shots show halftone dot fields (Luban), 3D inflated marks (Capway, Senda, Regrow, Fastep), duotone silhouettes (Regrow), grid overlays (Bridze, Tracko).

Video application: the graphic device is the transition (mark wipe, ribbon, portal) and the background texture behind cards.

### A7. Photography & imagery

Contents (Snapper, Confetti, Illinois, Squareshot): subjects & casting, composition (symmetry, negative space, focal length), lighting (natural/studio, high-key/low-key, key at 45°), colour treatment (saturated / muted / monochrome / duotone / brand-colour accents), location & props, wardrobe (solid colours caption better), editing/grade rules, 6–12 on-brand vs off-brand pairs with annotations. Premium Brand Guidelines organises this as Full Image Library, Image Categories, Image Guidelines (page types "Imagery / Portraits", "Imagery / Gallery").

Video application: `imagery.style`, `imagery.grade` and `imagery.promptPrefix/negativePrompt` in the JSON drive both LUT direction and AI generation prompts (Frontify lists "AI rules: approved prompt structures, tone parameters, visual style rules, guardrails" as a section of modern guidelines).

### A8. Layout, grid & spacing

Contents (Confetti, ui8 BrandKit "Grid System" with spacer tokens 8–96 px): column grids per format, gutters, a base spacing unit (4/8 px), margins, alignment, hierarchy order (brand name → product → claim), safe zones.

Video application: broadcast safe areas. EBU R95 (2017): action safe = 3.5 % inset, graphics safe = 5 % inset per edge (i.e. 93 % / 90 % of frame). Adventist Health: action safe 95 % (1824×1026), title safe 90 % (1728×972) at 1080p, no captions/titles/credits in the outer "no zone". BBC subtitles: central 90 % vertically, 75 % horizontally. Social 9:16 (1080×1920): UI overlays consume ~180–380 px top, ~350–380 px bottom, 40–60 px left, 120 px right (action button column); Instagram in-feed view crops to 90 % vertical height, Reels view scales 110 %; keep a 4:5 centre for Reels-safe and 1:1 centre for feed-safe. YouTube end screens occupy the last 5–20 s (15–20 s recommended), up to 4 elements, usable zones = right third and lower centre, video must be ≥ 25 s.

### A9. Motion system

Contents (everything.design, Atlassian, IBM Carbon, Material 3, Open University, International Motors, Dawn, Klarna/Slack/Indeed examples): principles (3–4 words), timing tokens, easing tokens, choreography/stagger, logo animation (intro/outro, loop/non-loop), typography in motion, transitions, UI motion, graphic elements, audio alignment, accessibility, prohibited techniques.

Numbers:
- Duration: micro-interactions 50–150 ms (Atlassian) / 70–110 ms (Carbon fast-01/02) / 50–100 ms (Material short); transitions 150–400 ms (Atlassian), 150–240 ms (Carbon moderate), 250–300 ms (Material medium); large moves 400–700 ms (Carbon slow), 450–500 ms (Material long); avoid navigation > 600 ms (Dawn); social loops 2–3 s; GIFs stop after one loop / 5 s (Indeed, everything.design). Human motion perception ~230 ms (70–700 ms).
- Easing: Atlassian ease-out bold `cubic-bezier(0,0.4,0,1)`, ease-in-out bold `(0.4,0,0,1)`, ease-in practical `(0.6,0,0.8,0.6)`, ease-out practical `(0.4,1,0.6,1)`. Carbon productive standard `(0.2,0,0.38,0.9)`, entrance `(0,0,0.38,0.9)`, exit `(0.2,0,1,0.9)`; expressive standard `(0.4,0.14,0.3,1)`, entrance `(0,0,0.3,1)`, exit `(0.4,0.14,1,1)`. Material 3 emphasized `(0.2,0,0,1)`, emphasized-decelerate `(0.05,0.7,0.1,1)`, emphasized-accelerate `(0.3,0,0.8,0.15)`, standard-decelerate `(0,0,0,1)`, standard-accelerate `(0.3,0,1,1)`. International Motors: accelerating `(0.9,0,1,1)`, decelerating `(0,0,0.1,1)`, standard `(0.4,0,0.1,1)`, expressive `(0.9,0,0.1,1)`, linear for loops/data. Open University: 24 fps, 3-frame easing handles at 100/50 (ease in), 80/60 (ease in/out, default for text), 50/100 (ease out); motion always moves "forwards, up and through".
- Personality → motion mapping (Dawn): premium = slower, refined, subtle; playful = bouncy, energetic, exaggerated; calm/wellness = fluid, slow; tech = sharp, fast; corporate = precise, minimal.
- Prohibitions seen in real guides: no animated gradients, no stretching shapes or type, no motion blur (Klarna); no character-by-character text, no flashy wipes (Slack); no motion behind text, loops stop after a brief time (Indeed); no flashing/strobe, no text filters like drop shadow/glow/stroke on video type (Adventist Health).

Video application: lower thirds on screen 3–6 s (5–7 s for two lines, up to 10 s for facts), fade or subtle slide in/out matched to tone; change what is on screen every 10–15 s (Adventist Health); intro bumper ≤ 3 s or skip it; end card 5–20 s. Bhippi `motion.entrance/exit/emphasis` + `beat` map directly; the JSON adds `enter/exit/hold/stagger` in seconds.

### A10. Voice & tone

Contents (Mailchimp, Frontify, Confetti, LinkedIn/Grammarly summaries): 3–4 voice attributes each framed "we are X but not Y" (Mailchimp: plainspoken, genuine, translators, dry humour — "weird but not inappropriate, smart but not snobbish"); voice is constant, tone shifts with the reader's emotional state and channel; "we say / we don't say" pairs (3 examples each); vocabulary lists (use / avoid); style conventions (sentence case vs title case, contractions, second person); a worked example of one idea in three contexts; rules for negative situations; a personality spectrum slider (e.g. Friendly & Wholesome ↔ Corporate & Professional).

Video application: on-screen copy is spoken, not read — short sentences, write for the ear, read aloud and time it (Adventist Health). Every Dribbble kit reviewed ships 2-line taglines in the pattern "[problem] / [we resolve it]" ("Talk happens fast / We keep it smart", "Fast payments / Zero drama", "Data is a puzzle / We make it clear"); the JSON `voice.samples` follow that pattern so the copilot can generate title cards in-voice.

### A11. Sound

Contents (DLMDD, Listen, SoundOut): sonic logo 1–5 s (most 2–3 s, 3–5 notes, used as bookends), jingle 10–15 s, brand track/anthem (full length), brand voice (VO casting: age, gender, attitude, accent), UX sounds 1–3 s, approved music genres and tempo ranges, mix levels, SFX palette. Tempo bands used by libraries: very slow < 60, slow 60–90, medium 90–110, upbeat 110–140, fast 140–160 BPM; lo-fi 90–110; chill/study 70–90; workout 120–150; corporate 60–140.

Video application: `audio.music`, `audio.tempo`, `audio.sfx` in the JSON; the sonic logo plays over the end-card bumper; beat-sync cuts to the tempo band.

### A12. Applications & templates

Contents (Dribbble branding-package guide, Confetti, ui8 BrandKit component library: Buttons, Labels, Input Fields, Browsers, Devices & Effects, Social Mockups, email & social kits, "BG Blur" backgrounds): social profile/cover/post/story templates per platform with safe zones, email headers & signatures, presentation decks (cover, divider, content, closing), stationery (business card, letterhead), packaging with dielines, signage, merch, event, ads. Deliverables seen across the 20 Dribbble kits: wordmark, symbol, 3D mark render, app icon (all show it), construction grid, palette strip, typeface specimen, business card, credit card, phone/watch UI, social posts with taglines, poster, tote/tee/hoodie/cap/beanie/badge merch, fascia signage, stickers, shopping bag, packaging boxes.

Video application: the video template set = intro bumper, title card, chapter marker, lower third (1-, 2-, 3-tier), caption style, stat callout, quote card, split/comparison card, end card (with subscribe/next-video zones), logo bug, transition pack, LUT, music bed and SFX pack, plus 16:9 / 9:16 / 1:1 variants.

### A13. Governance & delivery

Contents (Frontify, Puritano): owners and approvers, exception process, onboarding, agency access, compliance checks, a named "brand video steward", annual review, version-controlled asset library, brand wiki/portal (BrandKit nav: Logo, Color, Type, Icons, Imagery, Grids, Effects), exportable brand book (.fig/.deck/PDF/print), technical specs (16:9 1920×1080 or 3840×2160, H.264 or ProRes 422 HQ, 24/30/60 fps, 10–24 Mbps web, 35–68 Mbps broadcast).

### A14. Accessibility (cross-cutting)

WCAG AA contrast for all text; no flashing/strobe; captions required (BBC: ≤ 37 characters per line, ≤ 2 lines, 160–180 wpm, ≥ 0.3 s per word, minimum 1.5 s gap between subtitles, break lines at punctuation, system fonts read best); graphics must not overlap the closed-caption area; transcripts; reduced-motion fallbacks (Atlassian: motion becomes instant).

---

## Part B: Reference notes per source

### B1. ui8 "BrandKit Design System" and sibling products

URL: https://ui8.net/brandkit/products/brandkit-design-system  
Access notes: WebFetch returned HTTP 403; in a real browser the page loads and then client-side redirects to the author's SlideKit 2.0 page (`/brandkit/products/slidekit-20`), so the visible HTML is Angular templates. The product data was read from the site's own JSON endpoint `https://ui8.net/api/products/brandkit-design-system` (same for `brand-guidelines-kit` and `premium-brand-guidelines`) and the preview images on `images.ui8.net` were downloaded and inspected.

Product record (BrandKit Design System, author "BrandKit", created 2025-02-18, updated 2025-11-21, $59, 340 likes, one file `BrandKit Design System.fig.zip` 98 MB, Figma only):
- Blurb: "The Ultimate Brand Design System For Figma".
- Description: "…manage all of your brand assets in a single Figma file, export them to publishable Brand Wiki's and Brand Books and also provides brand templates and tool like social media and email kits."
- Feature list: "Complete Brand Identity System", "544 Components & Styles", "Full Brand Wiki", "Premium Brand Guidelines Book", "Logo, Color, Typography, Grids", "Premium Design Standards".
- Six systems on the "Pro-Grade Brand Management" page: Logo System, Color System, Type System, Grid System, Icon & Image Library, Full Brand Book.
- Logo System page: Logo Guidelines, Logo Construction Breakdown, Spacing Guidelines, Color Pairing, Sample Logo Applications; mark built on x/y with `.3x` gap to wordmark; mark shown on black, white, brand blue, and gradient backgrounds.
- Color Library & Styles page: Full Color Palette Styles, Detailed Color Shades, Gradient System, Color Pairing; hues Primary, Grey, Coral Reef, Turquoise, Rajah, Indigo, Blue, Red at 50–900 (legible samples: Primary 50 `#C8C8FF`, 100 `#B5B6FF`, 200 `#9091FF`, 300 `#6B6DFF`, 400 `#4648FF`, 500 `#383AD2`, 600 `#2A2BA5`; Grey 50 `#F2F2F0`, 100 `#DCDDE4`, 200 `#A3A4B5`, 300 `#67697C`, 400 `#4D4F60`, 500 `#373946`, 600 `#292A36`; Coral Reef 50 `#FFE5E0` … 500 `#FF7F65`, 600 `#D86851`; Turquoise 50 `#DAFBFB` … 500 `#47EBEB`, 600 `#39BEBE`; Rajah 50 `#FFF7F0` … 500 `#FCC188`, 600 `#FBB26A`; Indigo 50 `#E7DCFF`, 100 `#D0BAFE`, 200 `#B897FE`, 300 `#A175FD`, 400 `#8952FD`, 500 `#7042D2`, 600 `#5731A7`; Blue 50 `#D4D6FA`, 100 `#A9AEF5`, 300 `#535DEC`, 400 `#2834E7`, 500 `#202AB9`, 600 `#181F8B`; Red 50 `#FDD8E1`, 100 `#FCC5D2`, 200 `#FBB1C3`, 300 `#FA8BA4`, 400 `#F86486`, 500 `#F63D68`, 600 `#C73154`).
- Type System page: Modular Type Scale, Typeface Breakdown, Typography Pairing Guide, Typography Best Practices, Sample Typography Applications; ramp Display XXL 112 / XL 96 / Large 88 / Medium 72 / Small 64 px with line-height 100–110 % and tracking -3 to -4 %, weights Light / Medium / Bold; style panel lists 240, 120, 96, 80, 72 px.
- Component Library page: Buttons, Labels, Input Fields, Browsers, Devices & Effects, Social Mockups "& much more"; button matrix of filled / outline / disabled states; "BG Blur 001" gradient backgrounds; phone and browser mockups.
- Brand Wiki: pages Logo Wiki (Our Logo, Logo Construction, Color), Color Wiki; top nav Logo, Color, Type, Icons, Imagery, Grids, Effects.
- Brand Book (sample brand "Neural", footer "Built With BrandKit™"): Primary Palette page (Brand Purple `#4648FF` 001, Black `#010109` 002, White `#F2F2F0` 003, each labelled RGB / Palette Primary / Color System), Color Combinations, Full Logo Lockup, Imagery / Portraits, Grid / Vertical Spacing (spacers 8–96 px), type specimen; page-type chips "Color | Primary", "Logo | Full Logo", "Imagery | Portraits", "Grid | Vertical".
- Copy: "Flexible & Powerful Style Libraries — our carefully crafted Figma style & component libraries allows your to update your assets quickly and easily." "Built-In Brand Book & Wiki — present your brand assets in their best light with a beautiful, exportable brand manual book and wiki."

Brand Guidelines Kit (same author, $39, 2023-11-26, 496 likes, file "Brand Presentation Kit.fig.zip", usable as Figma file, presentation, or printed book): features "Brand Principles", "Logo Guidelines", "Typography Guidelines & Examples", "Color System & Examples", "Grid System & Spacing Guides", "Photo & Image Guidelines"; description list: Logo Guidelines; Color System incl. primary and secondary palette examples; Typography System incl. type scale & usage examples; Brand Imagery Library; Brand Principles.

Premium Brand Guidelines System ($39, 2024-11-25, .fig or .deck, file "Velour & Co Brand Guidelines.zip" 1.46 GB): sample brand Velour & Co, typeface EB Garamond; Logo Library (Logo Guidelines, Logo Construction, Spacing Guidelines, Logo Color Guide, Sample Logo Applications); Image Library (Full Image Library, Image Categories, Image Guidelines); Color Library (Full Color Palette; Primary, Secondary & Tertiary; Color Pairing Guide; Greyscale System; Sample Color Combinations); palette Soft White `#F9F9F9`, Warm Grey `#E1E1DF`, Charcoal Grey `#333333`, Muted Stone `#B1B1B1`, Soft Beige `#D9D4C5`, Muted Taupe `#B5A99B`, Cool Mist Blue `#AFC3C6`, Olive `#8C8B75`; page-type labels "Logo / Application", "Imagery / Portraits", "Imagery / Gallery", "Color / Combinations"; imagery direction = duotone/grain fashion portraits on red-orange, teal and blue fields.

Related (search only): branddesignkit.pro "Brand Design Kit for Figma": 110+ brand guideline templates, 80+ pitch deck templates, email + signature templates, business cards, moodboards, font-pairing tool, tokens for typography, colour (base, greyscale, Tailwind-ready), spacing, stroke, radius. Dribbble branding-package guide (https://dribbble.com/resources/career/branding-package-guide): core = logo variants + submarks, palette with Pantone/CMYK/RGB, typography with sizing & spacing rules, style guide; extras = social templates, stationery, decks, illustration system, email, ads, photography guidelines, icon sets, packaging, signage, event, merch, brochures; agency $5k–$100k+, freelancer $15–$300/h.

### B2. Dribbble "full branding kit" tag

URL: https://dribbble.com/tags/full-branding-kit  
Access notes: WebFetch returned an empty document (JS-rendered). A real browser rendered the tag page; individual shot pages returned HTTP 405 "Human Verification" (Cloudflare) via fetch, popup and direct navigation, so shot descriptions/tags could not be read. Titles, designers, like/view counts came from the tag-page DOM; palettes, type, taglines and deliverables were read from each shot's full-size image on `cdn.dribbble.com` (downloaded and inspected). Hex codes are quoted only where printed in the artwork; other colours are visually approximated and marked "≈". Seed corrections: "Kuban" is **Luban** (conversational AI, not telecom); "Capway" is a B2B SaaS for fitness-coach marketing (not fintech); "Unlok" is the untitled "Fintech Wealth management Company" shot; "Hurst" is an IT managed service provider; "Fisgo.ai" is the "Fishgo" shot; "Fastep" is business consulting (not payments); "Fewtech" is "Tech Brand Identity Design"; "Kozymart" is "e-commerce modern minimalist logo"; "Sherly Moore" is "Signature Logo design for feminine brand". Three promoted video ads on the page (Charted, Solvd, Holocene) were skipped.

| # | Shot | Designer | Industry | Palette | Type | Deliverables shown | Style words |
|---|---|---|---|---|---|---|---|
| 26882347 | Luban™ – Logo & Branding for a Conversational AI Platform | Nesar U. Rahid (rahiddesigner), 120 ♥ / 20k views | conversational AI | dark brown ≈`#3B1A0E`, amber ≈`#F5A21B`, orange→cream gradient, off-white, black | geometric sans (Inter-like), sentence case | wordmark, 3D glossy "L" mark with sparkle, construction grid (5.2x / 4.2x / 2.1x), phone app screen, social posters, fleece merch, halftone dot field, waveform motif; taglines "Talk happens fast / We keep it smart", "Every call leaves a clue / We read it" | warm, premium, futuristic, tactile |
| 26902263 | Capway™ – B2B SaaS for a Fitness coach marketing agency | rahiddesigner, 113 ♥ / 25.1k | B2B SaaS / fitness coaching | navy→indigo ≈`#0B0B3B`, royal blue ≈`#2F6BFF`, sky ≈`#5DB8FF`, mint ≈`#B8F0C8`, off-white, black (palette strip printed) | "DM Sans Medium" (printed) | wordmark, 3D inflated "C" mark, palette strip, type specimen, construction grid (7x / 6x / 0.5x), tee merch, app icon, App Store rating card; taglines "You coach people / We handle the growth", "Same effort / Bigger results", "SCALE QUIETLY. PERFORM CONSISTENTLY." | confident, athletic, clean, 3D |
| 26862098 | Logo & Branding Design for a Fintech Wealth management Company (brand "Unlok") | rahiddesigner, 112 ♥ / 19.2k | fintech / wealth | orange ≈`#FF6A3D`, mint/teal ≈`#3DD6A9`, amber gradient, black, off-white | grotesque sans, sentence case | wordmark (®), app icon, construction grid (3.2x / 3x / 2.2x), credit card, tee, posters; taglines "Money has a path / We help you find it", "Let the experts trade. You enjoy life." | bold, warm, premium, editorial photo |
| 26836247 | Logo & Brand Identity Design for a IT managed service provider (brand "Hurst") | rahiddesigner, 109 ♥ / 16k | IT services | electric blue ≈`#3A2BFF`, volt yellow ≈`#F2FF00`, black, white, grey | grotesque sans; chips "Protection, Monitoring, Connected, Rapid Fix, IT Guardian, Secure" | wordmark (®), monogram mark, construction grid, business card, acrylic block, social posters; taglines "Bugs run fast / We run faster", "When systems panic / we stay calm", "Your downtime is our enemy" | high-contrast, techy, assertive |
| 27071113 | Realest™ – Branding Design for a Realestate Agent | rahiddesigner, 100 ♥ / 10.2k | real estate | mustard ≈`#E3B740`, orange-red ≈`#E9583F`, cream ≈`#F4EFE6`, forest green ≈`#2E6B4A`, sky blue ≈`#9CC0E4` (palette strip printed) | grotesque sans, sentence case | wordmark (™), R-house monogram, construction grid, keychain merch, book spines, posters, checkerboard graphic device; taglines "Say less / Buy smart", "Big step / Clear guidance", "We don't sell homes / We sell dreams" | friendly, retro-modern, colourful |
| 26823758 | Bridze™ – Logo & Brand Identity Design for a Marketing Agency | rahiddesigner, 94 ♥ / 14.7k | marketing agency | red ≈`#FF3B3B`, lavender ≈`#B9B3FF`, black, white | grotesque sans | wordmark (™), pixel "B" mark on 6 px grid with ½ px stroke, watch face, tote merch, 3D bridge render, posters; taglines "Bridge Between You & Your Best Clients", "Your audience isn't far / You just need a bridge" | punchy, geometric, pop |
| 26866222 | Bumble™ – Logo & Branding for a Business Consulting Company | rahiddesigner, 119 ♥ / 15.3k | consulting | lime ≈`#D9F99D`, forest ≈`#2F4F3A`, black, off-white (palette strip printed) | grotesque sans | wordmark (®), B-mark, construction grid (2x / 3x / 4x, -45°), jacket merch, phone screen, keychain card; taglines "Strategy is heavy / Let us lift it", "You dream big / We design the steps" | grounded, natural, strong |
| 26829975 | Logo & Branding for a Tech Business Management Software SaaS (brand "Cegria") | rahiddesigner, 115 ♥ / 19.8k | SaaS | yellow ≈`#F5C400`, olive ≈`#5C6B50`, charcoal ≈`#1E2A1F`, cream | geometric sans, sentence case | wordmark (®), C-mark, construction grid, tee, progress-ring data card, app icon; taglines "Data is heavy / We make it float", "Your goals are far / We pull them closer" | warm, optimistic, utilitarian |
| 26917957 | Opteam™ – Logo & Branding Design Collaboration SaaS Software | rahiddesigner, 125 ♥ / 17.1k | collaboration SaaS | forest green ≈`#0B5C3A`, lime ≈`#C8F53C`, black, white | condensed uppercase display + sans; "No rush. Just progress." | wordmark (®), flower-gear mark, construction grid (2x / 0.5x), app screen, business cards, posters; taglines "Same moment / Same direction", "EVERYONE ON TIME / EVERYTHING ON TRACK", "TEAM THINKS FAST / WE MOVE FASTER" | energetic, team, bold caps |
| 26925400 | Fishgo™ (Fisgo.ai) – Branding Design Generative AI Video Editing Software | rahiddesigner, 104 ♥ / 17.3k | AI video | black, cream/yellow ≈`#F6E7B0`, blue ≈`#2F5BFF`, pink ≈`#F9A8C9`, orange-red ≈`#F04E23` (palette strip printed) | condensed uppercase display; chips "AI powered, Creative, Human centric, Smart editing, Simple, Productive, Instant" | wordmark, fish/play mark, construction (3x, 135°), waveform-scissors-play graphic, app icon, social posters; taglines "AI CUTS THE VIDEO / YOU CUT THE TIME", "YOU BRING THE IDEA / WE SHAPE THE STORY" | loud, creator-economy, playful |
| 26886651 | Senda™ – Logo & Branding for a Fintech Crossborder Payment Brand | rahiddesigner, 88 ♥ / 13.3k | fintech payments | violet ≈`#6D3BFF`, black, light grey, white | grotesque sans | wordmark, S-mark, 3D glass render, construction grid (4.2x), card, watch UI, posters; taglines "Fast payments / Zero drama", "No borders / No barriers / No stress" | sleek, glassy, calm-tech |
| 27269552 | Fastep™ – Business Consulting Branding Design | rahiddesigner, 98 ♥ / 11.5k | consulting | lime ≈`#D9F542`, taupe-brown ≈`#7A6459`, sky blue ≈`#9DB7D9`, pink ≈`#F1A6C4`, black | grotesque sans; chips "Sophisticated, Momentum, Authoritative, Decisive, Precise, Borderless, Clarity" | wordmark, arrow mark, construction grid (4x / 0.5x), fascia sign, beanie pin, 3D inflated mark, posters; taglines "Business is a race, We are the shortcut", "The Power of Presence." | kinetic, editorial, blur photo |
| 26607764 | Tracko™ – Branding Kit Design For a Software Analytics Startup | rahiddesigner, 79 ♥ / 13.2k | analytics SaaS | pale blue, yellow ≈`#F7C948`, sky ≈`#4FA8FF`, royal blue ≈`#1F5BFF`, navy ≈`#1B1F4B` (palette strip printed) | "Aeonik Medium" (printed) | wordmark, pixel mark on grid, watch UI, beanie/headphones merch, posters with Rubik's-cube imagery; taglines "Markets change like storms / We are the lighthouse in the dark", "Data is a puzzle / We make it clear", "Raw data is noise / We make it music" | bright, blocky, data-playful |
| 27126014 | Regrow™ – Branding Design for a Wealth Management Fintech SaaS | rahiddesigner, 87 ♥ / 10k | fintech / wealth | named swatches Palatinate Blue, Azure, Blue Zircon, Smoke `#FFFFFF`, Fire Bush, Ruby Red (hex digits too small to read; ≈`#2A4EEA`, `#1B9BF2`, `#61F3F9`, `#FF8F1A`, `#FF0008`) | grotesque sans | wordmark (™), R-mark, construction grid, 3D render, watch UI, duotone silhouette poster, stat card "9.6K+ wealth stories regrown"; taglines "Fear less / Grow more", "Money resting? Let it Regrow." | vivid, gradient, optimistic |
| 26651006 | LUNCHLANE – Logo & Branding Design for Digital Agency Startup | Rubel Hossen (rubelgraphicx), 43 ♥ / 8.5k | digital agency | yellow ≈`#FFC300`, red ≈`#F03A2E`, navy ≈`#0B1020`, orange→yellow gradient | heavy geometric sans, uppercase | wordmark, LL mark, palette blocks, phone, fascia sign, watch; tagline "Where every launch finds its lane" | bold, corporate-startup |
| 26847272 | Tech Brand Identity Design (brand "FewTech") | Zuraij GFX, 22 ♥ / 2.2k | tech | orange ≈`#F28C28` (swatch labelled "OLIVE B7CB80", label appears wrong), black `#000000`, white | outlined geometric display wordmark | pixel-step F mark, swatches, fascia sign, badges, app icon, tee | minimal, industrial |
| 19561121 | Real Estate Logo And Full Branding Identity Design (Mathew Meraz) | Shahin Alam, 5 ♥ / 760 | real estate agent | teal ≈`#2F5D6B`, orange ≈`#F26B1D`, gold foil, dark teal | humanist sans + spaced caps | horizontal + stacked lockups, mark, concept build (M+M+window), Instagram grid, Facebook cover, Twitter header, cap merch, gold-foil mockup | classic small-business |
| 26409271 | e-commerce modern minimalist logo (Kozymart) | Shihab Uddin, 5 ♥ / 1k | retail / e-commerce | Pure Black, Dark Orange ≈`#E8541B`, Vivid Orange ≈`#FF6A1A` (named, no hex) | "JOST" (printed) | bag/K mark, fascia sign, sticker roll, shopping bag, swatch cards with copy | friendly retail |
| 27395989 | WODEX – Modern Logo / Complete Brand Kit / Brand Style Guides | Lio Craft™, 2 ♥ / 834 | energy / tech | `#FDBB01`, `#FE5106`, `#070707` (printed), yellow→orange→red gradient | italic techno display, uppercase | sunburst mark, app icon variants (dark/red/light), NFC card, business card, fascia sign, phone splash, poster "Powering What Moves The Future." | glossy, energetic |
| 26176111 | Signature Logo design for feminine brand (Sherly Moore) | Fatima tu zara, 0 ♥ / 1.1k | fashion / beauty | burgundy ≈`#7A1424`, forest ≈`#0E3B2E`, cream ≈`#E8D3B8`, silver-grey ≈`#C6D0CE` (4 diamond swatches) | monoline script signature | script logo with face line-art, gift bag, lifestyle photo overlays | luxurious, romantic, moody |

Other search hits: "Real Estate Minimalist Logo And Full Branding Kit" shots 20303044 and 20868251 by BRANDING AGENCY (pages blocked; service listings say premium branding kits include 3–4 logo concepts, palette, typography, social kit, stationery and a 24–30 page style guide, priced $150–$12,000).

Cross-shot patterns worth hardcoding: every kit shows (1) wordmark + symbol + app icon, (2) a construction grid with x-multiples, (3) a 5-swatch palette strip, (4) one named typeface with weight, (5) a 2-line problem/resolution tagline, (6) 3D or inflated renders of the mark, (7) merch and a phone/watch screen, (8) full-bleed brand-colour posters with the wordmark at very large size cropped behind a portrait.

### B3. Authoritative pages (taxonomy sources)

- Frontify, Brand Guidelines guide — https://www.frontify.com/en/guide/brand-guidelines — 10 sections: brand core, logo, colour, typography, imagery & iconography, voice & tone, social media standards, templates & applications, governance, AI & retrieval rules.
- KOTA, Brand checklist — https://kota.co.uk/blog/brand-checklist-what-should-be-included-in-a-brand-style-guide — 10 items incl. do's/don'ts, quick-reference section, physical space.
- Confetti, What to include — https://confetti.design/blog/brand-guidelines-what-to-include — 14 sections across foundation / expression / application layers with sub-bullets (used heavily in Part A).
- Brandkit.com, 5 essential rules — https://brandkit.com/asset-page/703216-what-to-include-in-brand-guidelines-5-essential-rules (search summary only).
- Dribbble branding package guide — https://dribbble.com/resources/career/branding-package-guide.
- Motion: everything.design — https://www.everything.design/blog/motion-brand-guidelines (sections, Slack/Klarna/Indeed/IBM rules, 200–300 ms micro, 2–3 s social, 5 s GIF stop); Atlassian — https://atlassian.design/foundations/motion (principles, 50–150 / 150–400 ms, four curves); IBM Carbon v10 — https://v10.carbondesignsystem.com/guidelines/motion/overview/ (productive/expressive curves, 70–700 ms tokens); Material 3 tokens — https://m3.material.io/styles/motion/easing-and-duration/tokens-specs (JS-rendered; values via search); Open University — https://brand.open.ac.uk/designer-brand-guidelines/bim-motion-principles.php (Build/Progression/Portal/Colour/Messaging, 24 fps, easing handles); International Motors — https://brand.international.com/visual-identity/supporting-elements/motion-principles (six curves, logo 50–100 % / 20–40 % of short side); Dawn — https://www.wearedawn.co.uk/insight/building-a-motion-identity/ (personality→motion table, 230 ms perception, ≤ 600 ms nav).
- Voice: Mailchimp — https://styleguide.mailchimp.com/voice-and-tone/; Frontify voice vs tone — https://www.frontify.com/en/guide/brand-voice-vs-tone-vs-personality; search summaries from LinkedIn/Grammarly/Hootsuite.
- Colour tokens: ColorArchive — https://colorarchive.org/guides/color-token-naming-guide/ ; UXPin, alwaystwisted, fourzerothree (search); 60-30-10 (Wix, UX Planet, WP Mayor); WCAG (MDN, WebAIM, UCLA brand accessibility).
- Logo rules: KareemStudio — https://www.kareemstudio.me/articles/calculating-logo-clearspace/ ; Johns Hopkins Medicine — https://brand.hopkinsmedicine.org/brand/branding-guidelines/logo-guidelines/clear-space-and-minimum-size ; Brandy HQ, Inkbot, Memphis, GridMe (search); co-branding rules from Red Hat, IFRC, GitLab, DFW (search).
- Typography: cieden — https://cieden.com/book/sub-atomic/typography/establishing-a-type-scale ; Typography Master — https://www.typographymaster.com/guide/type-scale-systems ; B12, Blake Crosley (search).
- Icons: ONS — https://service-manual.ons.gov.uk/brand-guidelines/iconography/icon-design ; Material system icons, Bigeye, designsystems.com (search).
- Photography: Snapper — https://www.snapper.studio/blog/brand-photography-style ; Illinois, Squareshot, Bettermockups (search).
- Video: Adventist Health Video Standards PDF (May 2024) — https://brand.adventisthealth.org/files/AH-Video-Brand-Standards.pdf (full text extracted: logo at start or end, clear space = largest leaf, end-card logo 1/4–1/3 width, spark animation on white with 1000×386 px clear space, lower thirds left or right inside title safe in Foundry Sterling, no text filters, action safe 95 % = 1824×1026, title safe 90 % = 1728×972, 1080p H.264 24/30/60 fps, 10–24 Mbps web / 35–68 Mbps broadcast, 9:16 UI-overlay zones, Reels 4:5 safe / feed 1:1 safe, in-feed crops to 90 %, Reels scales 110 %, palette `#003764 #00a0dd #026937 #6cc04a #e24301`, "light, bright and inspirational" lighting with key at 45°, no strobe, WCAG contrast, read text aloud twice, change visuals every 10–15 s, 1–2 min optimum length, avoid flashy transitions); WashU — https://marcomm.washu.edu/video-brand-guidelines/ (lower third IvyStyle Sans SemiBold/Light up to 77 px, one logo rule, end slate options, 16:9, ProRes 422 HQ / H.264, 4K or HD); PTC bumpers — https://www.ptc.com/en/brand-guide/ptc-animated-logo-bumpers (403; search: end with bumper, don't start with one, first 3 s critical, white or knock-out on black); Parmonic 9 elements — https://info.parmonic.com/blog/5-essential-elements-of-great-video-brand-guidelines ; IdeaRocket — https://idearocketanimation.com/15178-video_branding_guidelines/ ; Puritano — https://www.puritano.com/post/video-style-guide-for-brand-consistency-2026-guide ; Wikipedia Lower third — https://en.wikipedia.org/wiki/Lower_third (1/2/3-tier); EBU R95 — https://tech.ebu.ch/docs/r/r095.pdf (3.5 % / 5 %); BBC subtitles via Clevercast — https://www.clevercast.com/bbc-subtitling-guidelines/ ; lower-third duration (Epidemic Sound, Riverside, Storyblocks), logo bug opacity (Zight, Filmkraft, Visual Watermark), YouTube end screens (YouTube Help, Gyre, ANFX), Shorts safe zones (Poster.ly, Kreatli, YouTube Toolkit), burned-in captions (Auphonic, Blitzcut, OpenClip, Itnavideo) — all search summaries.
- Sound: DLMDD — https://dlmdd.com/article/what-is-sonic-branding/ ; Listen, SoundOut, Audiobrain (search); BPM charts (Orphiq, Soundplate).
- Colour by industry (for archetype defaults): VistaPrint, Wix, Bethany Works, LogoDesign.net (search): fintech = deep blue/green/teal; healthcare = blue + cool neutrals; luxury = black/gold/navy/charcoal; food = warm reds/oranges; wellness/eco = sage/brown/green.

---

## Part C: 16 brand style archetypes

Conventions used below (and in the JSON):
- Colour tokens: `bg` (deepest field = Bhippi `ink`), `surface` (card fill), `text`, `muted`, `primary` (main brand colour), `accent` (emphasis, ~10 %), `accent2` (rare second accent = Bhippi `accentAlt`). Verified: every `text`/`bg` pair is ≥ 11:1 and every `text`/`surface` pair ≥ 10:1 (WCAG AAA), every `muted`/`bg` pair ≥ 3.29:1. `primary`, `accent` and `accent2` are fill colours (bars, pills, highlights, gradients); on the light archetypes (Playful Pastel, Kids Bright, Wellness Calm, Warm Craft) their contrast against `bg` is below 3:1, so set `text` on top of them rather than using them as text on `bg`. `primary`/`bg` is ≥ 3:1 for every archetype except Playful Pastel (2.04), where `primary` must likewise only be used as a fill.
- Fonts are restricted to system-safe families: Inter, Segoe UI, Arial, Helvetica, Georgia, Times New Roman, Trebuchet MS, Verdana, Consolas, Courier New, Impact, Palatino, Garamond, Cambria, Candara.
- Motion: `enter`/`exit`/`hold` are seconds for a title or lower third; `stagger` is the delay between sibling elements; `intensity` maps to Bhippi `TIMING.slow/normal/quick`.
- Layout: `safeMargin` is a fraction of the short side kept clear on all edges (0.05 = title safe 90 %); positions are for 16:9, and for 9:16 the lower third moves to the caption slot and captions move to 65–75 % height.
- Grade: signed offsets in percent applied to footage (saturation, contrast, warmth), so 0 = leave the footage alone.
- Audio tempo is a BPM range.

### C1. Minimal Mono
- Character: white space, one black, one grey; the type is the design.
- Colours: bg `#FFFFFF`, surface `#F4F4F5`, text `#111111`, muted `#7A7A7F`, primary `#111111`, accent `#3B3B3F`, accent2 `#C8C8CC`. Gradient 135° `#FFFFFF → #ECECEE`.
- Type: display Helvetica 500, letter-spacing -0.03em, sentence case; heading Inter 500; body Inter 400; caption Inter 500. Scale ratio 1.25.
- Motion: easing `cubic-bezier(0.4, 0, 0.2, 1)`; enter 0.7 s, exit 0.35 s, hold 2.4 s, stagger 0.12 s; calm; transitions cut, fade.
- Imagery: monochrome or near-monochrome photography, lots of negative space, hairline icons (1.5 px at 24 px); grade saturation -40, contrast +5, warmth 0.
- Voice: precise, quiet, confident; use "simply", "exactly", numbers; avoid exclamation marks, superlatives. Samples: "Less, but better." / "One tool. Every cut." / "Made to disappear into your work."
- Layout: safe margin 0.06; logo bug bottom-right; lower third bottom-left; captions bottom-center.
- Audio: minimal piano / ambient, 60–80 BPM; sfx soft click, paper, room tone.
- Industries: architecture, design tools, premium consumer hardware.

### C2. Bold Startup
- Character: black field, electric blue, one shock of lime; big type that lands on the beat (Hurst, Bridze, Capway).
- Colours: bg `#0B0B0F`, surface `#15151C`, text `#FFFFFF`, muted `#9A9AA8`, primary `#3B5BFF`, accent `#C6FF3D`, accent2 `#FF4D6D`. Gradient 135° `#3B5BFF → #7C4DFF`.
- Type: display Inter 800, -0.04em, sentence case; heading Inter 700; body Inter 400; caption Inter 700. Ratio 1.333.
- Motion: easing `cubic-bezier(0.16, 1, 0.3, 1)`; enter 0.4, exit 0.2, hold 1.4, stagger 0.06; energetic; transitions push, whip, cut.
- Imagery: high-contrast portraits with product, 3D inflated marks, halftone fields; grade saturation +10, contrast +15, warmth -5.
- Voice: direct, punchy, a little cocky; use "we", "faster", two-line problem/solution; avoid jargon, hedging. Samples: "Bugs run fast. We run faster." / "Same effort. Bigger results." / "Ship it before lunch."
- Layout: safe 0.05; bug top-right; lower third bottom-left; captions bottom-center.
- Audio: electronic / trap-pop, 120–140 BPM; sfx whoosh, glitch tick, bass hit.
- Industries: SaaS, developer tools, fintech challengers.

### C3. Playful Pastel
- Character: candy colours on cream, rounded shapes, bouncy.
- Colours: bg `#FFF8F0`, surface `#FFFFFF`, text `#2B2438`, muted `#8E86A0`, primary `#FF8FAB`, accent `#8ED6C2`, accent2 `#FFD166`. Gradient 135° `#FFD1DC → #C9E9F6`.
- Type: display Trebuchet MS 700, -0.01em, sentence case; heading Verdana 700; body Verdana 400; caption Trebuchet MS 700. Ratio 1.25.
- Motion: easing `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot); enter 0.5, exit 0.25, hold 1.8, stagger 0.08; energetic; transitions bounce-pop, wipe, cut.
- Imagery: flat illustration with 3 px rounded strokes, soft studio photos on pastel seamless; grade saturation +15, contrast -5, warmth +10.
- Voice: warm, cheeky, encouraging; use "hey", "yay", emoji-friendly nouns; avoid sarcasm, corporate nouns. Samples: "Little wins, every day." / "Made you smile? Good." / "Tap, snack, done."
- Layout: safe 0.05; bug top-left; lower third bottom-left; captions bottom-center.
- Audio: ukulele pop / indie synth, 100–125 BPM; sfx pop, boing, chime.
- Industries: consumer apps, food & snacks, lifestyle DTC.

### C4. Luxury Serif
- Character: black, gold and bordeaux; slow, generous, serif-led (Sherly Moore, Velour & Co).
- Colours: bg `#0E0D0B`, surface `#1A1814`, text `#F3EDE2`, muted `#9C917F`, primary `#C9A961`, accent `#F3EDE2`, accent2 `#6B1F2A`. Gradient 135° `#C9A961 → #7A6032`.
- Type: display Garamond 400, +0.12em, uppercase; heading Palatino 400 italic; body Georgia 400; caption Georgia 500. Ratio 1.618. Clear space 2.0×.
- Motion: easing `cubic-bezier(0.4, 0, 0, 1)`; enter 1.0, exit 0.5, hold 3.0, stagger 0.16; calm; transitions dissolve, slow push, fade-to-black.
- Imagery: low-key editorial photography, grain, velvet textures, gold foil; grade saturation -15, contrast +20, warmth +10.
- Voice: refined, assured, spare; use "crafted", "since", "considered"; avoid slang, discounts, exclamation. Samples: "Made slowly. Worn for decades." / "The quiet mark of good taste." / "Reserved for the few."
- Layout: safe 0.07; bug bottom-center (small, centred); lower third bottom-center; captions bottom-center.
- Audio: solo cello / neo-classical piano, 60–76 BPM; sfx silk, glass, low swell.
- Industries: fashion & jewellery, hospitality, private banking.

### C5. Tech Gradient
- Character: deep navy, violet-to-cyan gradients, glass and glow (Senda, Regrow, BrandKit's own look).
- Colours: bg `#0A0E1A`, surface `#121A2E`, text `#FFFFFF`, muted `#8A93B0`, primary `#6C5CE7`, accent `#22D3EE`, accent2 `#FF7DB3`. Gradient 135° `#6C5CE7 → #22D3EE`.
- Type: display Inter 700, -0.03em, sentence case; heading Inter 600; body Inter 400; caption Inter 600. Ratio 1.333.
- Motion: easing `cubic-bezier(0.2, 0, 0, 1)`; enter 0.6, exit 0.3, hold 2.0, stagger 0.1; balanced; transitions push, glow-morph, cross-dissolve.
- Imagery: 3D glass renders, gradient mesh backgrounds ("BG Blur"), dark UI screens, duotone portraits; grade saturation +10, contrast +10, warmth -10.
- Voice: smart, optimistic, clear; use "intelligent", "seamless", "in seconds"; avoid "revolutionary", "disrupt". Samples: "Fear less. Grow more." / "No borders. No barriers. No stress." / "Your data, finally fluent."
- Layout: safe 0.05; bug top-right; lower third bottom-left; captions bottom-center.
- Audio: synthwave / future bass, 100–124 BPM; sfx shimmer, data tick, soft riser.
- Industries: AI products, cloud & data platforms, crypto/fintech.

### C6. Editorial Magazine
- Character: newsprint cream, black serif headlines, one red rule; grids you can feel.
- Colours: bg `#FAF8F4`, surface `#FFFFFF`, text `#141414`, muted `#6E6A62`, primary `#141414`, accent `#D62828`, accent2 `#1D3557`. Gradient 180° `#FAF8F4 → #EFEBE3`.
- Type: display Times New Roman 700, -0.02em, sentence case; heading Georgia 700 italic; body Inter 400; caption Inter 600 uppercase +0.08em. Ratio 1.414.
- Motion: easing `cubic-bezier(0.2, 0, 0.38, 0.9)`; enter 0.5, exit 0.3, hold 2.2, stagger 0.1; balanced; transitions hard cut, horizontal slide, rule-wipe.
- Imagery: reportage photography, black-and-white with one colour, pull quotes, oversized numerals; grade saturation -20, contrast +15, warmth 0.
- Voice: informed, witty, opinionated; use active verbs, specific nouns, a headline and a deck; avoid hype, passive voice. Samples: "The long read, cut short." / "Everything they didn't tell you about the deal." / "Chapter two: the numbers."
- Layout: safe 0.06; bug top-left; lower third bottom-left; captions bottom-center.
- Audio: jazz trio / spoken-word beds, 80–100 BPM; sfx typewriter, page turn, vinyl crackle.
- Industries: news & media, publishing, think tanks.

### C7. Retro Print
- Character: 1970s poster: cream stock, burnt orange, teal and mustard, chunky condensed caps.
- Colours: bg `#F3E9D2`, surface `#EAD9B6`, text `#2C2418`, muted `#7D6E58`, primary `#D9642B`, accent `#2F6F73`, accent2 `#E4B33C`. Gradient 135° `#D9642B → #E4B33C`.
- Type: display Impact 400, +0.02em, uppercase; heading Trebuchet MS 700; body Georgia 400; caption Trebuchet MS 700 uppercase. Ratio 1.5.
- Motion: easing `cubic-bezier(0.7, 0, 0.3, 1)` with 12 fps stepped feel for graphics; enter 0.45, exit 0.25, hold 2.0, stagger 0.09; balanced; transitions wipe, iris, cut.
- Imagery: risograph/halftone textures, misregistration, film grain, flat two-colour illustration; grade saturation -10, contrast +10, warmth +20.
- Voice: nostalgic, hearty, plain; use "good old", "handmade", "since 19xx"; avoid tech jargon, minimalism words. Samples: "Slow-brewed since your dad's first car." / "Real ink. Real paper. Real slow." / "Good things, printed loud."
- Layout: safe 0.06; bug bottom-left; lower third bottom-left; captions bottom-center.
- Audio: funk / soul / surf, 96–118 BPM; sfx film projector, stamp, tape stop.
- Industries: coffee & craft beverage, record labels, vintage retail.

### C8. Organic Earth
- Character: moss, clay and sage on linen; nothing shiny.
- Colours: bg `#F5F1E8`, surface `#E8E1D3`, text `#2E2A23`, muted `#7C7566`, primary `#5B6B4A`, accent `#B8743A`, accent2 `#8FA88C`. Gradient 135° `#5B6B4A → #8FA88C`.
- Type: display Palatino 400, 0em, sentence case; heading Georgia 400; body Inter 400; caption Inter 500. Ratio 1.25.
- Motion: easing `cubic-bezier(0.4, 0, 0.2, 1)`; enter 0.9, exit 0.45, hold 2.6, stagger 0.14; calm; transitions cross-dissolve, soft push, fade.
- Imagery: natural light, hands, soil, textiles, botanical line drawings (1.5 px); grade saturation -10, contrast -5, warmth +15.
- Voice: honest, grounded, gentle; use "grown", "small-batch", "traceable"; avoid "premium", "luxury", urgency. Samples: "From the soil, not the lab." / "Slow food for fast lives." / "Every batch has a farmer's name on it."
- Layout: safe 0.06; bug bottom-right; lower third bottom-left; captions bottom-center.
- Audio: acoustic folk / fingerpicked guitar, 70–95 BPM; sfx wind, leaves, wood.
- Industries: organic food, skincare, sustainability & outdoor.

### C9. Corporate Trust
- Character: white and navy with a clear blue; measured, orderly, unglamorous.
- Colours: bg `#FFFFFF`, surface `#F2F5F9`, text `#0F1F3D`, muted `#5B6B82`, primary `#0B3D91`, accent `#1E88E5`, accent2 `#00A98F`. Gradient 135° `#0B3D91 → #1E88E5`.
- Type: display Segoe UI 600, -0.01em, sentence case; heading Segoe UI 600; body Arial 400; caption Arial 700. Ratio 1.25. Clear space 1.5×.
- Motion: easing `cubic-bezier(0.2, 0, 0.38, 0.9)`; enter 0.6, exit 0.3, hold 2.4, stagger 0.1; balanced; transitions push, slide, fade.
- Imagery: bright office and people photography, clean infographics, 2 px line icons; grade saturation 0, contrast +5, warmth 0.
- Voice: clear, credible, respectful; use "trusted", "secure", "since", concrete figures; avoid slang, exaggeration. Samples: "Built for the long term." / "Clarity you can bank on." / "Fifty years. One promise."
- Layout: safe 0.05; bug top-right; lower third bottom-left; captions bottom-center.
- Audio: corporate uplifting piano + strings, 90–115 BPM; sfx soft whoosh, chime, click.
- Industries: banking & insurance, healthcare systems, professional services.

### C10. Cinematic Dark
- Character: near-black, blood red and amber; letterboxed, slow, wide-tracked caps.
- Colours: bg `#050507`, surface `#101014`, text `#EDEDED`, muted `#7E7E86`, primary `#C1121F`, accent `#E5C07B`, accent2 `#4A6FA5`. Gradient 180° `#050507 → #1A0A0E`.
- Type: display Inter 300, +0.25em, uppercase; heading Georgia 400; body Inter 400; caption Inter 500. Ratio 1.5.
- Motion: easing `cubic-bezier(0.4, 0, 0, 1)`; enter 1.2, exit 0.6, hold 3.2, stagger 0.18; calm; transitions dissolve, fade-to-black, slow push.
- Imagery: teal-and-orange or desaturated film grade, shallow focus, anamorphic flares, letterbox 2.39:1; grade saturation -20, contrast +25, warmth -5.
- Voice: dramatic, sparse, declarative; use short fragments, "every", "one"; avoid jokes, exclamation. Samples: "Every story has a price." / "One night. No way back." / "This is where it begins."
- Layout: safe 0.08 (letterbox-aware); bug bottom-right; lower third bottom-left; captions bottom-center.
- Audio: cinematic hybrid orchestral / drones, 60–90 BPM; sfx sub boom, braam, riser, heartbeat.
- Industries: film & streaming, gaming trailers, luxury automotive.

### C11. Neon Cyber
- Character: black-violet with magenta, cyan and acid; mono type, scanlines, glitch.
- Colours: bg `#05010D`, surface `#12082A`, text `#F5F0FF`, muted `#8C7FB3`, primary `#FF2BD6`, accent `#00F0FF`, accent2 `#B6FF00`. Gradient 135° `#FF2BD6 → #00F0FF`.
- Type: display Consolas 700, +0.06em, uppercase; heading Inter 700; body Inter 400; caption Courier New 700 uppercase. Ratio 1.333.
- Motion: easing `cubic-bezier(0.9, 0, 0.1, 1)`; enter 0.3, exit 0.15, hold 1.2, stagger 0.05; energetic; transitions glitch-cut, flash, RGB-split slide.
- Imagery: neon-lit night scenes, chromatic aberration, wireframes, HUD frames; grade saturation +30, contrast +20, warmth -20.
- Voice: terse, system-like, playful-dangerous; use "ACCESS", "LEVEL", brackets, version numbers; avoid corporate softness. Samples: "SYSTEM ONLINE." / "Press start. Break the loop." / "v2.0 // faster than you."
- Layout: safe 0.05; bug top-left; lower third bottom-left; captions bottom-center.
- Audio: synthwave / drum & bass / phonk, 128–160 BPM; sfx glitch, laser, static, UI beep.
- Industries: gaming & esports, nightlife & events, streetwear tech.

### C12. Warm Craft
- Character: terracotta and honey on oat; hand-touched, generous, human (Luban, Cegria, Kozymart).
- Colours: bg `#FBF6EE`, surface `#F1E6D6`, text `#3A2E25`, muted `#8A7B6E`, primary `#B5583A`, accent `#E0A458`, accent2 `#5A7D6A`. Gradient 135° `#B5583A → #E0A458`.
- Type: display Georgia 700, -0.01em, sentence case; heading Palatino 400; body Inter 400; caption Inter 600. Ratio 1.333.
- Motion: easing `cubic-bezier(0.25, 0.1, 0.25, 1)`; enter 0.6, exit 0.3, hold 2.2, stagger 0.1; balanced; transitions slide, dissolve, paper-wipe.
- Imagery: warm daylight, hands at work, kraft and ceramic textures, hand-drawn icons; grade saturation +5, contrast 0, warmth +20.
- Voice: friendly, proud, plain-spoken; use "we make", "by hand", first names; avoid tech buzzwords, cold precision. Samples: "Made by people who'd rather show you than tell you." / "Talk happens fast. We keep it warm." / "Come in. Stay a while."
- Layout: safe 0.05; bug bottom-left; lower third bottom-left; captions bottom-center.
- Audio: acoustic pop / handclaps / warm keys, 85–110 BPM; sfx ceramic clink, paper, kettle.
- Industries: bakeries & cafés, home goods, community services.

### C13. Fintech Navy
- Character: deep navy with royal blue and a cyan-mint data accent; precise counters and cards (Capway, Tracko, Senda).
- Colours: bg `#0A1128`, surface `#111B3D`, text `#FFFFFF`, muted `#8FA0C7`, primary `#2F6BFF`, accent `#00E0C6`, accent2 `#FFC857`. Gradient 135° `#0A1128 → #2F6BFF`.
- Type: display Inter 700, -0.03em, sentence case; heading Inter 600; body Inter 400; caption Inter 600 (tabular numerals). Ratio 1.25.
- Motion: easing `cubic-bezier(0.2, 0, 0, 1)`; enter 0.5, exit 0.25, hold 2.0, stagger 0.08; balanced; transitions push, slide-up, counter-roll.
- Imagery: dark UI screens, cards and watches, portraits on gradient fields, 3D glass marks; grade saturation +5, contrast +10, warmth -10.
- Voice: calm, exact, reassuring; use "instant", "zero fees", "protected", figures with units; avoid "get rich", vague promises. Samples: "Fast payments. Zero drama." / "Money has a path. We help you find it." / "9.6K accounts. One clear view."
- Layout: safe 0.05; bug top-right; lower third bottom-left; captions bottom-center.
- Audio: minimal tech house / soft synth pulse, 100–120 BPM; sfx coin tick, soft confirm, whoosh.
- Industries: payments & neobanks, wealth apps, analytics SaaS.

### C14. Sport Energy
- Character: black, blaze orange and volt; italic caps, speed ramps, smash cuts (Opteam, Wodex, Lunchlane).
- Colours: bg `#0D0D0D`, surface `#1A1A1A`, text `#FFFFFF`, muted `#9C9C9C`, primary `#FF3B00`, accent `#C8FF00`, accent2 `#00C2FF`. Gradient 120° `#FF3B00 → #FFB800`.
- Type: display Impact 400, +0.01em, uppercase italic; heading Arial 900 (Arial Black); body Arial 400; caption Arial 700 uppercase. Ratio 1.5.
- Motion: easing `cubic-bezier(0.16, 1, 0.3, 1)`; enter 0.3, exit 0.15, hold 1.2, stagger 0.05; energetic; transitions whip-pan, zoom-punch, smash cut, speed ramp.
- Imagery: high-shutter action, sweat and motion blur, hard rim light, stadium grain; grade saturation +20, contrast +25, warmth +5.
- Voice: commanding, motivating, short; use imperatives, "faster", "harder", numbers; avoid softness, qualifiers. Samples: "TEAM THINKS FAST. WE MOVE FASTER." / "No days off. No excuses." / "Power what moves you."
- Layout: safe 0.05; bug top-left; lower third bottom-left; captions bottom-center.
- Audio: big-beat / EDM / stadium rock, 128–150 BPM; sfx impact hit, whoosh, crowd swell, whistle.
- Industries: sportswear & fitness, energy drinks, esports and events.

### C15. Wellness Calm
- Character: eucalyptus, sand and mist; breathing-room motion, light serif.
- Colours: bg `#F6F7F4`, surface `#E9EEE8`, text `#2F3A34`, muted `#7E8A82`, primary `#5F8F7A`, accent `#C9B79C`, accent2 `#A7C4D6`. Gradient 160° `#E9EEE8 → #DCE8E1`.
- Type: display Georgia 400, +0.01em, sentence case; heading Cambria 400; body Inter 400; caption Inter 500. Ratio 1.25.
- Motion: easing `cubic-bezier(0.4, 0, 0.2, 1)`; enter 1.0, exit 0.5, hold 3.0, stagger 0.15; calm; transitions long dissolve, soft push, breathe (scale 1.00→1.03).
- Imagery: soft daylight, skin and linen, water, negative space, thin-line botanical icons; grade saturation -15, contrast -10, warmth +8.
- Voice: soothing, kind, unhurried; use "breathe", "gently", "you"; avoid urgency, medical claims, exclamation. Samples: "Start where you are." / "Ten minutes that give the day back." / "Rest is not a reward. It's the work."
- Layout: safe 0.07; bug bottom-right; lower third bottom-left; captions bottom-center.
- Audio: ambient / soft piano / nature beds, 55–75 BPM; sfx breath, water, singing bowl.
- Industries: meditation & sleep apps, spas & skincare, healthcare & therapy.

### C16. Kids Bright
- Character: primary-bright coral, sunshine and sky on white; fat rounded type, bouncy everything.
- Colours: bg `#FFFFFF`, surface `#FFF3C4`, text `#1F2A44`, muted `#6B7A99`, primary `#FF5A5F`, accent `#FFC600`, accent2 `#2BB3FF`. Gradient 135° `#FF5A5F → #FFC600`.
- Type: display Verdana 700, -0.01em, sentence case; heading Trebuchet MS 700; body Verdana 400; caption Verdana 700. Ratio 1.333; minimum body 24 px at 1080p.
- Motion: easing `cubic-bezier(0.34, 1.56, 0.64, 1)`; enter 0.45, exit 0.25, hold 2.0, stagger 0.07; energetic; transitions pop, bounce-wipe, star-iris.
- Imagery: flat bold illustration with 4 px rounded outlines, confetti shapes, real kids in bright rooms; grade saturation +20, contrast +5, warmth +10.
- Voice: enthusiastic, simple, safe; use "let's", "wow", one idea per sentence; avoid irony, fear, hard sells. Samples: "Let's build something silly!" / "Wow, you did it!" / "Snack time, story time, you time."
- Layout: safe 0.06; bug top-left; lower third bottom-left; captions bottom-center (larger, 9 % height).
- Audio: bright ukulele / toy-piano pop, 110–135 BPM; sfx boing, sparkle, giggle, pop.
- Industries: education & edtech, toys & family entertainment, children's food.

---

## Appendix: numeric defaults to hardcode

| Rule | Value | Source |
|---|---|---|
| Title safe / action safe (16:9) | 90 % / 95 % (Adventist Health); 90 % / 93 % (EBU R95 5 % / 3.5 %) | AH PDF, EBU |
| 1080p title safe box | 1728 × 972 px; action safe 1824 × 1026 px | AH PDF |
| 9:16 UI-safe box (1080×1920) | keep critical content ≥ 180–380 px from top, ≥ 350 px from bottom, ≥ 40–60 px left, ≥ 120 px right | Shorts guides, AH PDF |
| End-card logo width | 25–33 % of frame width | AH PDF |
| Logo bug | 5–10 % of canvas width, 30–60 % opacity, corner inside title safe | search consensus |
| Clear space | 1.0× / 1.5× / 2.0× x-height (compact / standard / premium) | KareemStudio |
| Minimum logo size | 60–80 px digital, 20 mm print, 24 px icon-only | Brandy HQ, Inkbot |
| Lower third on screen | 3–6 s (5–7 s two lines, ≤ 10 s facts) | Epidemic Sound, Riverside |
| Lower third type | name ~7 % frame height SemiBold, title Light | WashU (77 px @1080p) |
| Intro bumper | ≤ 3 s or none; always end with bumper | PTC |
| End screen | last 5–20 s (15–20 s recommended), ≤ 4 elements, video ≥ 25 s | YouTube |
| Shot change cadence | every 10–15 s | AH PDF |
| Captions | ≤ 37 chars/line, ≤ 2 lines, 160–180 wpm, ≥ 0.3 s/word, 1.5 s gap; 64–88 px bold sans at 1080×1920 with 3–4 px stroke | BBC, caption guides |
| Contrast | 4.5:1 text, 3:1 large text (≥ 24 px or 18.66 px bold) | WCAG AA |
| Colour proportion | 60 / 30 / 10 | design consensus |
| Type scale ratios | 1.2 dense, 1.25 UI, 1.333 marketing, 1.5 editorial, 1.618 luxury | cieden, Typography Master |
| Line height | body 1.5–1.65, display 1.1–1.2 | Typography Master |
| Icon grid | 24 px grid, 2 px stroke, 2 px radius, 2 px padding | Material / ONS |
| Micro / transition / large motion | 50–150 ms / 150–400 ms / 400–700 ms | Atlassian, Carbon |
| Social loop | 2–3 s; GIF stops after 5 s or one loop | everything.design, Indeed |
| Sonic logo / jingle / UX sound | 1–5 s (2–3 typical) / 10–15 s / 1–3 s | DLMDD |
| Tempo bands | <60 very slow, 60–90 slow, 90–110 medium, 110–140 upbeat, 140–160 fast | library convention |
