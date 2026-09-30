---
name: launch-film-render-look-fix
description: Make a launch film that shows the real app, timed to a song or voice-over, and check every scene on frames before moving on. Load for launch films, feature films to music, "use the real UI", "Meet <product>" films.
version: 1.0.0
---

# Launch film: measure, plan, capture, build, look, fix

motion_guide {topic:"launch-film"} has the numbers (camera keys, eases, finish, cursor sizes). This is the
order the two best films (80/100 and 84/100) were made in, with the share of time each step deserved.
The templates named here are shortcuts; your own scenes, or your own renderer delivered in passes, follow
the same steps.

## 1. Measure (about 10%)
1. analyze_song {assetId, lyrics} on the song: beats, bars, drops, hits and a time for every sung word.
   Keep its timings; correct the words from the lyric sheet. For a voice-over, analyze_clip_speech.
2. Write the beat map with save_beat_sheet: every word, bar, drop and snare with its time. Everything
   later reads these numbers.

## 2. Plan one scene per line (about 10%)
1. For each sung or spoken line pick a real product moment that literally shows the words ("turn it up" =
   the effort slider to Maximum). Name the part, its states, the camera move (from → to), the cursors (who
   clicks what, when), the join into the next scene and the sounds.
2. At most one idea per 1.5 s. Cut on bars; start mid-bar only where a line does. Save it
   (save_storyboard or save_video_blueprint) with the times.

## 3. Capture the kit (about 20%)
1. capture_app_session with steps that put every part in every state the storyboard needs (type into the
   composer, open a menu, press send, fill the timeline); demo:true fills an empty Bhippi project.
2. Read the contact sheet it returns. Reject a part with tiny content, a serif fallback, a broken image,
   a placeholder, a local path or dev text; recapture it.

## 4. Build and look, scene by scene (about 35%)
For each scene:
1. Build it with the times from the beat map: create_product_demo {capture, shots, actions, cursors} for a
   camera through the product; type-on-voice, fly-through-word, connect-hub, label-pill, glass-mark,
   logo-lockup or end-card for the other beats; or your own scene.
2. review_frames on its range: frames at every click, landing and cut.
3. Write the fault in one line. Typical: the push-in frames the wrong spot; the depth is too subtle (double
   it); ghosting on a fast move; cursors overlap; a tag covers a label; text under 26 px cap height; two
   things move at once; a move never lands sharp.
4. Change only that; review the same range again. Two looks per scene is normal. Do not start the next
   scene with a known fault in this one.

## 5. Joins, finish and sound (about 15%)
1. Join the scenes (create_motion_sequence transitions camera-match, glow-handoff, flash-bridge, whip,
   zoom-through), then review_frames {at:"joins"}: no hard cut, no black frame, no pop.
2. update_motion_scene {finish:"launch-light"} on a light stage or "launch-dark" on a dark one.
3. sound_the_motion: every cue heard over the song. The master is checked by review_frames (-16 LUFS,
   -1 dBTP).

## 6. Assemble, save, criticise (about 10%)
1. After every timeline commit, get_comp: the song still on its track, every scene where planned. Save.
2. judge_edit; fix its top three items; judge again, up to three rounds.
3. Gates: mean luma 45-60 on a dark film; readable text at 26 px cap height or more; one copy of each
   phrase; every move sharp for 10 frames; the name sharp 0.35 s before any fade; cues audible.

## Traps
- A render at the wrong scale looks fine on one sheet: trust capture_app_session's resolution check.
- An audio place can land on the song's track and replace it: read every diff.
- A bulk change that answers "nothing changed" did nothing.
- A 180-degree shutter smears moving text into stripes: 60-72 degrees on text, bubbles and cursors.
- A scene you render yourself (mediaSource "render") lands flat unless you deliver it in passes:
  attach_production_asset {passes} with backdrop, product, text, cursor and glow as alpha layers.
- Never end the turn with the project unsaved.
