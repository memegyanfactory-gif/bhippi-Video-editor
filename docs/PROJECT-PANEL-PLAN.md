# Project panel — Premiere Pro parity plan

Goal: the Project panel (bin) should look and behave like Premiere Pro's, starting with the
per-kind **badges** on thumbnails (footage shows film + waveform, a comp shows the sequence mark).

## Research — what Premiere does

Sources: Adobe Help "Customize Project panel views" / "Customize Icon View", PremiumBeat
"Premiere Pro Tips: Project Panel", PremiumBeat "Hover Scrub", ProVideo Coalition on the 24.4
label/badge update, plus the reference screenshot.

**Icon View tile**
- 16:9 thumbnail, dark well behind it, 1px rounded corners; selection = blue outline around the whole tile.
- **Badges, bottom-right inside the thumbnail**, small (≈14px) square glyphs on a dark chip:
  - Footage with video + audio → **filmstrip** badge + **waveform** badge.
  - Video only → filmstrip. Audio only → waveform (thumbnail is the waveform itself).
  - Still image → image badge. Graphic / text → graphic badge.
  - Sequence (our comp) → **sequence badge** (the stacked-tracks/nodes glyph), no A/V pair.
  - Multicam / merged / nested get their own badge (future for us).
- Badges are **white when unused**, **blue/tinted when the item is used in a sequence**
  (older builds: orange). Hover the badge → tooltip "Used N times"; click it → menu listing each
  comp + timecode where the clip is used, choosing one opens it there.
- Under the thumbnail: **label-colour swatch** (small square) · name (ellipsis) · duration right-aligned.
- **Hover scrub**: moving the pointer left→right across the thumbnail scrubs from media start to end
  (no audio). Clicking a tile shows a thin scrub bar with a playhead under the thumbnail; J/K/L
  play, I/O set in/out there, shown as a yellow in/out range.
- Poster frame: "Set Poster Frame" from the current scrub position.
- Panel menu → **Thumbnails**, **Badges**, **Label colour** on/off toggles; sort icons dropdown.

**List View**
- Name column starts with a small **kind icon** (clip, sequence, bin, still, audio, graphic).
- Columns: Label, Frame Rate, Media Start, Media End, Media Duration, Video Info, Audio Info,
  Video Usage, Audio Usage, Path — sortable, reorderable, toggleable via Metadata Display.
- Bins expand in place with a disclosure triangle (tree), not only by navigating in.

**Other**
- Freeform View (drag tiles anywhere, storyboard); bottom bar: List / Icon / Freeform,
  size slider, Sort Icons, Automate to Sequence, Find, New Bin, New Item, Clear.

## Where we are

`src/panels/ProjectPanel.tsx` + `.tile*` / `.bin*` in `src/styles/app.css`.
- Icon + list views, size slider, folders (3D), search, rename, comp posters, status overlays — done.
- Badges: **missing**. Only a gold `N×` text chip bottom-right for usage.
- No label colour on bin items (`LabelColor` exists on clips only), no hover scrub, no list sorting,
  no kind-icon consistency between icon and list views, no badge click → locations.
- Data already available: `asset.kind`, `asset.hasAudio`, `usage(project)` counts, comp tracks.

## Plan

### Phase 1 — Badges (the screenshot ask)
1. New `BinBadges` component in `ProjectPanel.tsx`; one source of truth `badgesFor(entry)` returning
   `('video' | 'audio' | 'still' | 'comp' | 'graphic' | 'item')[]`:
   - media video + `hasAudio` → `video, audio`; video without audio → `video`; audio → `audio`;
     image → `still`; comp → `comp`; HTML/motion comp → `graphic`; items → `item`.
2. Custom inline-SVG glyphs matching Premiere's shapes (filmstrip with sprocket holes, 3-bar
   waveform, sequence nodes/tracks mark) — lucide has no exact equivalents; keep them in a small
   `src/components/binGlyphs.tsx`.
3. CSS `.tile-badges` bottom-right, 2px gap, each badge 16×14 on `rgba(0,0,0,.65)` chip, white
   glyph; `.used` state tints glyph `var(--blue)`. Remove the gold `N×` chip (usage moves into the
   badge tooltip). Hide badges in `compact` size only if smaller than ~70px.
4. Reuse the same glyphs as the kind icon in List View's Name column so both views agree.

### Phase 2 — Tile layout parity
5. Tile meta row: label swatch (8×8) · name · duration (timecode, right) — matching the screenshot.
6. Add `label: LabelColor | null` to `Comp`, `ProjectItem`, `MediaRef`, `Folder` (Rust `project.rs`
   serde default `None` for old projects); item context menu → Label ›; swatch colour from the
   existing clip label palette. Clips dropped on the timeline inherit the bin label.
7. Selection styling: 2px blue outline around thumbnail+meta, no fill (Premiere look); hover lightens.

### Phase 3 — Interaction parity
8. Hover scrub on video tiles: pointer x → time; use the existing preview/proxy frame strip
   (`strip-tile` sprite) if present, else fall back to the thumbnail. Comps scrub their poster only.
9. Selected-tile scrub bar with playhead; I/O set in/out stored per asset for the next drag
   (DragPayload already carries `in`/`duration`).
10. Badge click → popover "Used in": comp name + timecode per use; click opens the comp and seeks.
    Needs a `usageLocations(project, id)` helper beside `usage()` in `lib/timeline.ts`.
11. Set Poster Frame from the scrub position (comps and video).

### Phase 4 — List View parity
12. Columns: Name (kind icon + label swatch), Label, Frame Rate, Media Start, Media End, Duration,
    Video Info, Audio Info, Usage, Path. Click header to sort (asc/desc arrow), persist per project.
13. Folders expand inline with a disclosure triangle (tree rows, indented).
14. Panel menu toggles: Thumbnails / Badges / Label colour; sort dropdown in the footer for Icon View.

### Phase 5 — Later
15. Freeform View (storyboard), Automate to Sequence, multicam/merged badges.

## Verification
- Unit test `badgesFor` for each entry kind (video+audio, video-only, audio, still, comp, HTML comp, item).
- Extend `tests/projectBinThumb.test.ts` for badge rendering + used state.
- Visual check in the running app against the reference screenshot: footage tile shows film +
  waveform, comp tile shows the sequence mark, both turn blue once used.
