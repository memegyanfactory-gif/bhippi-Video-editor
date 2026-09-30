---
name: product-demo-real-app
description: Show a product doing one real job, from the typed ask to the result, as a camera through the real app made of editable layers. Load for product demos, feature films, app previews and "show it working".
version: 1.0.0
---

# Product demo: one real job in the real app

motion_guide {topic:"product-demo"} has the beats and the look. The white SaaS film did this with 3,000
lines of its own capture and render code; here it is a few calls. Your own scenes or renderer can replace
any step.

## 1. Choose the job and time it
1. One task, shown whole: ask → work → result → the result in use. Write the prompt as the user would type
   it (about five words).
2. analyze_song on the music (or analyze_music_beats): the drop and the snares. The send lands on a snare,
   the result on the drop.

## 2. Capture the product in its states
1. capture_app_session {name, steps}. For Bhippi leave out url and use its parts (@composer @field @send
   @chat @messages @timeline @program @project); demo:true fills an empty project with footage, a music
   bed and a chat. For another product give url and CSS selectors.
2. Steps, in order: capture the empty input; type the prompt into it (typing is captured per character);
   capture the send button; click it; wait; capture the chat and the result panel in their new states.
3. Read the sheet: no broken image, placeholder, local path or tiny part. Recapture what fails.

## 3. Build the camera through it
1. create_product_demo {capture, shots, actions, cursors}:
   - shots: close on the input (fill 0.7), close on the conversation, wide on the drop (the tilted window),
     close on the result. Use centre: true where the part must sit dead centre.
   - actions: {type: "@field", words: [...]} from the beat map, {click: "@send"} on the snare,
     {set: {part, state}} for each panel that changes.
   - cursors: "you" for the ask, the product's own cursor for the work.
2. create_product_demo moves the camera and swaps captured pictures; nothing inside a part moves. Where
   the result must build on screen (rows filling, a chart drawing, a card growing), cut that part with
   create_ui_screen {screenshot, parts, actions} (assemble, sweep, count) or rebuild it in HTML, and cut
   it into the demo.
3. A label-pill names the result (2-5 words); zoom-through into the result playing, camera-match back.
4. logo-lockup or end-card for the name.

## 4. Look and fix
1. review_frames: every click frame (the target changes state on it), every landing (sharp for 10 frames),
   the joins. Text meant to be read needs a 26 px cap height: move the shot closer, never shrink the plan.
2. One fault, one fix, look again.

## 5. Finish
1. update_motion_scene {finish:"launch-light"} on white; the product's dark theme takes "launch-dark".
2. sound_the_motion {swap: {"click":"cursor_tap","whoosh":"soft_whoosh"}}: key clicks under the typing, a
   pop on send, every cue heard over the music.
3. judge_edit, fix the top three, save.

## Traps
- A cursor tag can cover the words it points at: check the click frames.
- Close-ups slide toward the window's inside by default; centre: true for the literal framing.
- Two things changing at once reads as noise: one action per shot.
- A camera over still pictures for more than about 2 s is a slideshow: something inside the frame moves.
