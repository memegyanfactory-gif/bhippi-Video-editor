//! The guidelines that ship with Bhippi.
//!
//! A reference is worth keeping only if what was learned from watching it is written down. These
//! are the two films taken apart frame by frame — the opening at four frames a second, then one
//! frame per ten seconds across the whole thing — turned into instructions an editor or a model
//! can act on: what the film does, in what order, with what numbers.
//!
//! They are deliberately concrete. "Punchy type" tells nobody anything; "the word lands at 0.25s,
//! the subject arrives at 0.5s between two words that pass behind him" can be built.

pub struct Guide {
    pub name: &'static str,
    /// The file it was read from, if the machine still has it.
    pub source: &'static str,
    pub notes: &'static str,
    /// The style pack in `src/lib/stylePacks.ts` this reference produced.
    pub pack: &'static str,
}

pub const GUIDES: &[Guide] = &[
    Guide {
        name: "guidline",
        source: r"C:\Users\aayus\Downloads\If You ONLY Watch One Motion Design Video, Make It This....mp4",
        pack: "crimson-brief",
        notes: r#"THE CRIMSON BRIEF — a talking-head explainer that never lets the frame go quiet.
1280x720, 30 fps, 11m45s. Read at 4 fps through the opening, 1 frame per 10s throughout.

THE HOOK, BEAT BY BEAT (0 - 3s). Copy this structure, not its words.
  0.00  A blurred, desaturated plate of the room. No subject, no type. The frame is already
        alive but out of focus, so the first word has something to land on.
  0.25  The first word lands: white, oversized, roughly a tenth of frame height, with a red
        bloom behind the spot the subject is about to occupy.
  0.50  The subject pops in BETWEEN two words - one left of his head, one right - trailing a
        red echo of himself for about 0.2s. He is cut out from his background, so the type
        passes behind him. This is the single most important trick in the film.
  0.75  He settles, the echo dissipates, the second line begins under the first.
  1.00  The second line completes one word at a time. Each word is grey for a beat, then white.
  1.75  The whole frame - subject, type and all - scales down into a rounded card, revealing
        the deep red field behind it. One continuous scale, never a cut.
  2.50  Small rounded cards fly in around it while the card keeps shrinking.
  2.75  A statement in large white type sits over the montage.

THE RULES IT KEEPS
  Type never covers the speaker. It sits beside him, on the side he is not using, or passes
  behind him where he has been separated from the background. When a card takes the middle,
  the type moves to an edge.
  One accent, used everywhere. A crimson red against a maroon so deep it is nearly black.
  Footage of people is left warm and ungraded against it.
  Nothing cuts on. Cards drop in and settle, words rise, the frame scales. A thing that leaves
  does not vanish - it fades while the next thing is already arriving.
  Words land one at a time, about 0.09s apart. A whole line appearing at once reads as a slide.
  Every graphic is named. A screenshot sits in a rounded card with a small red pill under it
  saying what it is, and the pill's words reveal after the card has settled.

THE PIECES, WITH NUMBERS
  Background: a vertical gradient from near-black to crimson, with a soft horizontal light band
  low in the frame that drifts slowly.
  Cards: rounded rectangles, corner radius about 2% of the short side, a hairline lighter
  border, dark red fill, generous inner padding, a soft shadow beneath.
  Pills: small, filled crimson, white text, about 2.5% of frame height.
  Lists: a red numbered badge, a term, and one line of explanation. Items stagger in about
  0.07s apart. The speaker shrinks to a rounded thumbnail in a corner while the list holds.
  Section titles: full-bleed white type, a word at a time, with the occasional word in italic
  serif for emphasis.
  Hexagons: a honeycomb motif for roadmap sections, also used as icon containers.
  Numbers: occasionally enormous, on a perspective floor.

WHEN TO REACH FOR IT
  A talking head explaining something: a course, a breakdown, a listicle, a review. It needs a
  speaker on screen and things to show beside them. It is the wrong look for a product film or
  an identity piece, which have nobody to sit beside."#,
    },
    Guide {
        name: "videoreference2",
        source: r"C:\Users\aayus\Downloads\[motion graphics] hi, aflow. - identity film.mp4",
        pack: "aflow-glass",
        notes: r#"AFLOW GLASS — an identity film with nobody in it, carried entirely by material and light.
1280x720, 30 fps, 46s. Read at 4 fps for the first fifteen seconds, 2.5 fps thereafter.

THE ARC
  0 - 4s    A glass orb grows from a point on black, thin white arcs setting it out like a
            construction drawing. It collapses back to a point.
  4 - 7s    The point falls as a long streak of light. Motion blur doing the work an animation
            would otherwise have to do.
  7 - 12s   A cluster of orbs at many sizes, translucent and overlapping, with a flare where
            they meet.
  12 - 16s  The frame floods blue, then white. The next scene is already there when it clears.
  16 - 26s  A lavender field: spheres and thin glass panels tumbling in space, a browser window
            rendered as frosted glass, a large orange orb dragged with selection handles, and a
            Bezier path drawn with its handles left visible.
  26 - 36s  Black again. Translucent panels arranged in a ring around a glowing core on a
            reflective floor, turning slowly.
  36 - 43s  A beam standing on a phone drawn in line art, rays coming off it, then a soft
            illustrated landscape in the same blues.
  43 - 46s  White. The wordmark, small and centred.

THE RULES IT KEEPS
  Light does the transitions. Nothing cuts: a bloom grows until it owns the frame and recedes
  onto the next scene.
  Shapes morph rather than replace each other. An orb becomes a capsule becomes a panel.
  Everything is made of glass: a gradient interior, a specular highlight up and to the left, a
  contact shadow beneath, and small coloured flecks suspended inside.
  The construction is left visible. Hairline arcs and Bezier handles stay on screen - the film
  shows its own setting-out, which is what makes it read as design rather than decoration.
  One warm accent in a cold film. An orange orb against all that blue, perhaps three times in
  46 seconds.
  It moves slowly. Around 0.75s for a major move, where the crimson film uses 0.45s.

THE PALETTE
  Near-black #05060F, royal blue #3B4FE0, lavender, white. Orange #FF8A3D as the single warm
  note. Type is small and quiet - about 5% of frame height, against 8% in the crimson film.

WHEN TO REACH FOR IT
  An identity film, a product opening, a logo reveal, anything abstract with no speaker. It
  needs objects and light rather than footage of a person. Do not use it for an explainer: it
  has no way to hold a talking head or a list of points."#,
    },
];

pub fn find(name: &str) -> Option<&'static Guide> {
    GUIDES.iter().find(|guide| guide.name == name)
}

#[cfg(test)]
mod tests {
    use super::GUIDES;

    #[test]
    fn each_guide_is_specific_enough_to_build_from() {
        assert_eq!(GUIDES.len(), 2);
        // The names are what the editor types after `/ref`, so they are part of the contract.
        assert_eq!(GUIDES.iter().map(|g| g.name).collect::<Vec<_>>(), ["guidline", "videoreference2"]);
        for guide in GUIDES {
            // A guideline without timings or measurements is a mood board, not an instruction.
            assert!(guide.notes.contains('s'), "{} should talk about time", guide.name);
            assert!(guide.notes.len() > 1200, "{} is too thin to be useful", guide.name);
            assert!(guide.notes.contains("WHEN TO REACH FOR IT"), "{} should say when it applies", guide.name);
            assert!(!guide.pack.is_empty());
            assert!(guide.source.ends_with(".mp4"));
        }
        // The two must not describe the same look.
        assert_ne!(GUIDES[0].pack, GUIDES[1].pack);
    }
}
