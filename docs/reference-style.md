# The reference style, read frame by frame

Source: *If You ONLY Watch One Motion Design Video, Make It This…* — 1280×720, 30 fps, 11m 45s.
Frames sampled at 4 fps across the hook and 1 frame per 10 s across the whole film.

## The hook, beat by beat (0 – 3 s)

| Time | What happens |
| --- | --- |
| 0.00 | A blurred, desaturated plate of the room. No subject yet. |
| 0.25 | **Motion** lands in white, oversized, with a red bloom behind where the subject will be. |
| 0.50 | The subject pops in **between the two words** — *Motion* left of his head, *Design* right — trailing a red echo of himself. He is cut out: the words sit behind him. |
| 0.75 | He settles; the echo dissipates; the second line begins — *is*. |
| 1.00 | *is not difficult* completes, one word at a time, each grey before it turns white. |
| 1.75 | The whole frame — subject, words and all — **scales down into a rounded card**, revealing a deep red field behind it. |
| 2.50 | The card keeps shrinking as a montage of small rounded UI cards flies in around it. |
| 2.75 | A statement in big white type over the montage: *Unnecessarily Complex*. |

Three things make that hook work, and all three are mechanisms, not decoration: the subject is
separated from his background so type can pass behind him; the type arrives a word at a time
rather than as a block; and the reveal is one continuous scale, not a cut.

## The visual system

- **Colour.** A deep maroon that is nearly black, a crimson mid, and white type. One accent, used
  everywhere. Talking-head footage is left warm and unfiltered against it.
- **Background.** A vertical gradient with a soft horizontal light band low in the frame, drifting.
- **Cards.** Rounded rectangles, a hairline lighter border, a dark red fill, generous inner
  padding. Screenshots sit in the same card shape with a shadow under them.
- **Pill labels.** Small red pills with white text, naming the thing on screen — *Deep Glow*,
  *Liquid Glass*, *Pixel Sorter*, *Flow*. They sit under or beside the card they name.
- **Lists.** A red numbered badge, a term, and a line of explanation; items stagger in.
- **Section titles.** Full-bleed white type, a word at a time, with the odd word set in italic
  serif for emphasis — *It **used** to take time*.
- **Picture in picture.** When a graphic owns the frame, the speaker shrinks to a rounded
  thumbnail in a corner.
- **Hexagons.** A honeycomb motif for the roadmap sections, also used as icon containers.
- **Numbers.** Occasionally enormous — *1 2 3* on a perspective floor, *12917 AED*.

## Layout, which is the part Helios gets wrong today

Nothing in that film ever lands on top of anything else. Type sits **beside** the speaker, on the
side he is not occupying; when a card owns the middle, the type moves to the edge; when two things
must share the frame, one becomes small and goes to a corner. The frame is treated as a set of
slots with one occupant each.

Helios currently places graphics at whatever position it is told, with no notion of what is
already there — which is how a title and three caption styles ended up stacked on the same pixels.
That is the first thing to fix, and it is what `src/lib/layout.ts` is for.

---

# The second reference: *hi, aflow. — identity film*

1280×720, 30 fps, 46 s. A different problem entirely: no speaker, no captions, nothing to explain.
Everything is carried by material and light.

## The arc

| Time | What happens |
| --- | --- |
| 0 – 4 s | A glass orb grows from a point on black, thin white arcs setting it out like a construction drawing. It collapses back to a point. |
| 4 – 7 s | The point falls as a long streak of light — motion blur doing the work of an animation. |
| 7 – 12 s | A cluster of orbs at many sizes, translucent and overlapping, with a flare where they meet. |
| 12 – 16 s | The frame floods blue, then white. The next scene is already there when it clears. |
| 16 – 26 s | A lavender field: spheres and thin glass panels tumbling, a browser window rendered as frosted glass, a big orange orb dragged with selection handles and a Bézier path drawn with its handles showing. |
| 26 – 36 s | Black again. Translucent panels arranged in a ring around a glowing core on a reflective floor, turning. |
| 36 – 43 s | A beam standing on a phone drawn in line art, light rays out of it, then a soft illustrated landscape in the same blues. |
| 43 – 46 s | White. The wordmark, small and centred. |

## What it is made of

- **Glass and orbs.** A gradient interior, a specular highlight up and left, a contact shadow
  under, and small coloured flecks suspended inside. Edges catch light and a shine travels them.
- **Construction lines.** Hairline arcs and Bézier handles, left visible — the film shows its own
  setting-out.
- **Light as a transition.** Nothing cuts. A bloom grows until it owns the frame, and recedes onto
  the next scene.
- **One warm accent.** An orange orb against all that blue, used perhaps three times in 46 s.
- **Palette.** Near-black `#05060F` → royal blue `#3B4FE0` → lavender → white.

## What this means for Helios

Two packs now exist in `src/lib/stylePacks.ts`, each with its palette, type scale, materials,
curves and the scenes it uses. `crimson-brief` is for explainers with a speaker in them;
`aflow-glass` is for identity and product work with nobody on screen. They are data, so a recipe
can build from them and the assistant can choose between them without inventing a look.
