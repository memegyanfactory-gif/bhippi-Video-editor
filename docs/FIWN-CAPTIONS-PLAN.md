# WatchFIWN caption styles, imported faithfully

Plan, 2026-09-29. Tracked in `docs/IMPROVEMENT-TODO.md` (Phase 8). Source: the WatchFIWN site at `D:\FIWN` (read-only; nothing there is changed).

## Why Bhippi's captions look worse than FIWN's today

FIWN has **139 caption presets**: 81 "flat" styles and 58 **dynamic** styles that draw through their own Canvas2D engines. Bhippi's import (`scripts/import-fiwn-caption-styles.mjs`) keeps names and colours but loses most of what makes them good:

| What FIWN does | What Bhippi does today |
| --- | --- |
| 58 dynamic layouts (hype-drop, candy-pop, flash-card, emoji-burst, chrome-jelly, glass-caption, marker-swipe, neon-tube, vhs-track, ink-script… plus 19 motion-graphics presets) with keyword emphasis, hero words, FX painters, stickers, cards, hand-drawn marks | Flattened to plain typography; `dynamicLayout` is not imported at all |
| Real fonts: Inter, Space Grotesk, Archivo Black, Anton, Bebas Neue, Syne, Fredoka, Bungee, Bangers, JetBrains Mono… | Mapped to Windows fonts: most become Segoe UI; Anton, Bebas and Bangers become Impact |
| About 40 entrance poses with 9 easings (overshoot, spring, elastic, bounce…), per word or letter, starting on each word's spoken time | 21 names re-done with different maths, one fixed ease, staggered from the caption start |
| Real vertical gradients, blurred drop shadows, rounded boxes and chips, `pixel3d`, `maxLines`, caption cards with audio waves | Gradient averaged to one colour; hard shadow; radius ignored; several fields dropped |
| One renderer for preview and export (Canvas2D), so export = preview | Preview (CSS) and export (libass ASS) are two different implementations that disagree |

The import also reads an old checkout (`C:/Work/VSCode/FIWN`), so one preset (`dynFlyingType`) is missing.

## The approach: use FIWN's own renderer

FIWN's caption code is pure, time-based Canvas2D with no DOM or app state. Its dynamic engine is unit-tested under Node. So instead of re-implementing styles, Bhippi uses the same code:

1. **Vendor the renderer** into `src/lib/fiwn/`:
   - the dynamic engine (`dynamic-captions.js`, `dynamic-presets-2.js`, `caption-layout-kit.js`, `caption-motion-kit.js`, `flying-type-caption.js`);
   - the flat renderer extracted from `engine.js` `drawSubtitle`;
   - the parts of `motion.js` it needs (easings, entrance/exit/loop presets).
   
   Add type definitions, and remove the few couplings to FIWN's editor state.
2. **Rewrite the import script** to keep each style whole: the full style, its animation, `dynamicLayout` and motion knobs. It reads FIWN's own categories, defaults to `D:\FIWN`, and derives simple fields only for the fallback.
3. **Preview:** captions draw on a canvas with that renderer, fed the clip's real word timings (start and end; word end times are added to transcription and caption clips).
4. **Export:** caption clips render as frame sequences with alpha through the existing frame pipeline (`exportFrames.ts` → `frame_sink.rs`), only where a caption is on screen. The export then matches the preview exactly. The libass path stays as a fast draft fallback.
5. **Fonts bundled offline:**
   - Add Anton, Archivo Black, Bebas Neue, Space Grotesk, Syne, Fredoka, Cinzel, Bungee, Playfair Display, Audiowide, Bangers, Permanent Marker, Silkscreen, JetBrains Mono and Great Vibes. All are OFL, except Permanent Marker, which is Apache-2.0.
   - Substitute open fonts for the three macOS-only faces (Avenir Next, Chalkboard SE, Snell Roundhand).
   - The libass fallback gets the same font files.
6. **AI can use them well:** a short "look" and "when to use" line per style and per dynamic layout (energy, genre, sample words), listed to the AI and exposed through the caption tools. The Subtitles tab shows every style live, with its real animation.
7. **Parity tests:** preview frame vs export frame per style family, plus a port of FIWN's dynamic-caption tests.

Estimate: about 7–9 working days. Motion-text caption templates (`caption-templates.js`, 22 more) are about 2 more days, as a follow-up.

## Risks

- Frame-rendering captions for long videos costs export time. It is limited to spans where a caption is visible, and settled frames are reused.
- Emoji stickers need Segoe UI Emoji (present on Windows 10/11).
- Adding fonts grows the app by roughly 1–3 MB.
