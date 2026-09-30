---
name: kinetic-explainer-beats
description: Make a voice-over explainer where words land on their onsets and real product cards land on the beat, each named by a pill. Load for kinetic explainers, motion-design explainers and the crimson look.
version: 1.0.0
---

# Kinetic explainer: words on the voice, cards on the beat

motion_guide {topic:"kinetic-explainer"} has the numbers. The crimson explainer went from 68 to 75 in one
round by copying the reference's structure beat by beat and fixing the craft slips below.

## 1. Measure
1. analyze_clip_speech on the voice-over (analyze_song when it is sung): every word's onset.
2. analyze_music_beats: the drop and the bars. Put the product's name on the drop.
3. With a reference: analyze_reference_video, and write its hook as a beat list with rests ("0.25 first
   word, 0.46 pop, 1.02 shrink, rest to 1.6").

## 2. Plan at most five points in 15 s
Hook → shrink into a centred card and rest → the mark on the drop → three to five points (each at least
1.5 s: a card, its title, its pill) → end card. A script with eight features needs a longer film or three
of them; the engine cannot fix density.

## 3. Build
1. Cards from the real app: capture_app_session (Bhippi's parts, or a url). Capture in a dark theme for a
   dark film, or a white panel doubles the frame's light.
2. Each point: slam-tilt {media, title, label} on its bar, or word-land {text, words} with a card of your
   own; label-pill {label, attach} beside the thing it names; whip-pan or match-grow into the next point.
3. The mark: glass-mark {landing:"land", at: the drop} on empty space, never flying through content.
4. The end: end-card {backdrop: the film's cards, beats: the jingle's beats}.
5. Pick the field, the emphasis style and the joins from the brand and the reference, not the defaults.

## 4. Look and fix
review_frames after each point. The faults the critic found:
1. A hero mark smeared across the frame: clear the frame first; the mark appears at final size 3 frames
   before the beat, opaque in 2, blur at most 4 px.
2. Pills never read in full: words from 0.10 s after the body, a 0.6 s readable hold.
3. Title on title ("SoMusic"): the next title lands only after the last has left.
4. Busy windows (three layers entering or leaving in 3-5 frames): stagger by 4-6 frames.
5. An orphan pill after its card left: it leaves with its owner.
6. A white capture in a dark film: relight or recapture.
7. A card that lands and then sits: while it holds, something in it acts (a field types, a row lifts, a
   number counts); create_ui_screen {screenshot, parts, actions} cuts the capture into parts that can.

## 5. Finish
sound_the_motion (one sound per event, no ticks on words or pills); update_motion_scene finish for the
grade; judge_edit; fix the top three; save.
