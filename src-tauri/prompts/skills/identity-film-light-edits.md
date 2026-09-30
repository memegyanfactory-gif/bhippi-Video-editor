---
name: identity-film-light-edits
description: Make an identity film or logo reveal where the mark is one material (glass, light) and light, not cuts, carries every scene change. Load for identity films, brand films, logo reveals and glass logos.
version: 1.0.0
---

# Identity film: the mark as a material, light does the editing

motion_guide {topic:"identity-film"} has the beats and the look. The glass identity film scored 66 in its
first critique with an excellent renderer; every point it lost is a rule below.

## 1. Read the mark and the music
1. get_brand_kit (colours, logo, fonts); svg_to_shape on the logo so its parts can move.
2. analyze_song: the plucks, the phrase lines and the drop. Big changes land on phrase lines or the drop;
   morphs land on an audible accent.

## 2. Plan five acts
Birth (a light point, a flare, construction arcs) → Build (the mark assembles) → Meaning (the mark acts
out the product's own sentence) → Flood (light owns the frame and recedes onto the lockup) → Lockup.
Write each act's time and the accent it lands on.

## 3. Build
1. glass-mark {material, landing, stage, wordmark, tagline, taglineTimes, beats} gives the mark as glass
   and light, the lockup and the heartbeat. The material follows the brand: ember, clear, frosted, tinted,
   or no glass at all for a flat brand.
2. Morphs between parts: morphTo with morphT keys over 0.6-0.75 s. Never in 3 frames: that strobes.
3. The meaning beat: connect-hub {layout:"ring", exit:"collapse"} or your own paths; things that travel
   must be at least 40 px wide with their path drawn first, and each landing pulses the mark.
4. Scene changes: create_motion_sequence joins white-out, glow-handoff, flash-bridge; the next scene is
   already there when the light recedes.
5. For true refraction, render_3d_scene with a glass preset and lay the 2D light over it.

## 4. Look and fix
review_frames after each act. The faults the critic found, in order of cost:
1. The name misspelled while it assembles (a dotless "i"): land missing parts as faint outlines first.
2. A morph that snaps in 3 frames: stretch it to 0.6-0.75 s.
3. Glass that reads as opaque candy: lighten the body toward its edges, put something behind it to refract.
4. A meaning beat too small to read at phone size: double it, push the camera about 15%.
5. Lopsided energy (a flat 3 s, then four events in 1 s): spread the events; the lockup holds with a 4%
   push and the sheen crossing twice, the last still at most 0.7 s.

## 5. Finish
sound_the_motion (glass on glints, shimmer on the resolve, sub on the drop); judge_edit; save.
