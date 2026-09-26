# Characters plugin: plan v3 (2D + 3D, quality first)

This plan replaces the "good enough" 3D pass with a production pipeline. It is written against a real audit of the current characters, not assumptions.

## 1. Audit of what we have (26 Sep)

Range-of-motion renders from Blender: `docs/character-studio/3d/renders/rom-*.png`.

| Area | Problem | Cause |
| --- | --- | --- |
| Head turn, look up | Mouth tears open, face smears | Automatic (bone-heat) weights give the jaw and lower face to the neck bone |
| Look down | Nose and chin collapse into the neck | Same; no rigid head region, no neck gradient |
| Shoulders, arms up | Deltoid pinches, T-shirt bulges | Single-bone shoulder, no twist bones, no corrective shapes |
| Body "slim", "chunky" | The whole model is squashed or stretched | Implemented as a non-uniform scale |
| Faces | No blink, smile, talk or brows | No face rig or shape keys |
| Animation | Stiff, robotic arcs; poses like the wave were wrong | Moves are hand-coded curves, not motion data |
| Hair | One style per body | Only two styles were built |
| UI | Dark list of controls, no pictures | Built as a debugging panel, not a product |

## 2. Quality bar (what "done" means)

- A reviewer cannot find a deformation artifact in the ROM test at 100% zoom: head ±70° yaw, ±40° pitch, arms up and forward, full squat, fists, wide stance.
- Motion comes from real animation data (mocap or keyframed by animators). No hand-typed sine waves for body motion.
- Every body shape, age and outfit combination passes the same ROM test.
- Faces can blink, smile, frown, raise brows and lip-sync (visemes) without breaking the head.
- The plugin looks like a product: thumbnails everywhere, rendered from the real characters.

## 3. Pipeline v3

### 3.1 Skeleton standard

- Rig every base with one **standard humanoid skeleton**. Bone names and rest orientations match the widely used humanoid layout that Quaternius, Mixamo and UE mannequins all map to: hips, spine ×3, neck, head, clavicle, upper arm, forearm, hand, fingers ×3, thigh, calf, foot, toe.
- Add twist bones (upper arm, forearm, thigh) to stop candy-wrapper twisting.
- Add a jaw bone and eye bones.
- One skeleton for every body means one animation library plays on every character.

### 3.2 Weights: rule-based, then verified

Bone-heat alone is not good enough. For each base:

1. **Region masks** from anatomy landmarks.
   - The head, including jaw, face, ears and skull, is 100% head.
   - The jaw ring (under the chin to the ears) is split between head and jaw.
   - The neck gets a smooth head-to-chest gradient along its length.
2. **Limbs:** bone heat, then normalise to the two nearest chain bones and smooth three times. Finger weights are restricted to their own finger chain.
3. **Twist distribution:** the forearm twist gets 0 at the elbow and 1 at the wrist, with the same idea on the upper arm.
4. **Corrective shape keys**, driven by the joint angle, for the shoulder raise, elbow bend, knee bend and hip flex.
5. **Garments** take their weights from the body, then are smoothed. The skin under clothes is hidden (already done with the coverage mask).

### 3.3 Body shapes, ages and bases

Real sculpted shape keys on the same topology, not scaling:

- **Build:** slim, average, heavy, muscular.
- **Height:** short, average, tall. The skeleton is re-fitted per blend.
- **Age:**
  - kid (6–10) and teen as sculpted proportion targets: a bigger head, shorter limbs and a rounder face;
  - elder: posture, jowls, thinner limbs.
- **Face shapes** such as a round or long face, jaw width, nose size and eye size, so presets don't all share one face.

At export, either:

- **(a)** blend-shape morph targets plus bone re-fit at runtime; or
- **(b)** a baked GLB per common combination.

Start with (b) for reliability (about 0.8 MB each) and move to (a) once the re-fit is proven.

### 3.4 Face rig

- **Shape keys:**
  - eyes: blink L and R, wide, squint;
  - brows: up, down, angry, sad;
  - mouth: smile, frown, smirk L and R, pucker (O);
  - visemes: A, E, I, O, U, MBP, FV, L;
  - jaw: jawOpen, with a mouth interior (teeth, tongue, dark cavity).
- **Eyes:** eye bones with look-at and saccades.
- Blink on a natural random timer.
- **Expressions** are named presets (happy, sad, angry, surprised, thinking, scared) built from the shape keys, so the AI says `expr: "surprised"` and nothing else.

### 3.5 Motion library

1. **Source (free, commercial use):**
   - **Quaternius Universal Animation Library, Standard.** 45 animations, CC0, including locomotion, idle, jump, emotes and interactions. It needs a one-click free download on itch.io (see §7).
   - **Later:** the Pro version (120+, a small price), Mixamo (free with an Adobe account; the user downloads FBX files), and CMU mocap BVH.
2. **Retarget in Blender** to our skeleton:
   - bake;
   - clean the root motion;
   - foot-lock contacts;
   - export one shared `motions.glb`, with clips only and no mesh.
3. **Runtime (three.js AnimationMixer):**
   - base layer clips with crossfades;
   - an additive upper-body layer for gestures;
   - IK overlays for look-at, point-at, reach and hold;
   - foot IK to the ground;
   - root motion for walk and run so feet don't slide.
4. **Our own moves** that the library lacks (wave variants, shrug, point, talk gestures, cartoon takes) are keyframed in Blender on the same rig and exported with the others. No procedural sine waves for body motion.
5. ToonKit moves become thin wrappers: `wave` means play clip `Wave` on the upper body, face the target and set `expr: "happy"`. The shot JSON the AI writes does not change.

### 3.6 Hair, wardrobe and accessories

- **Hair:** 8–10 styles per base: short, messy, buzz, side part, curly, afro, bob, long, ponytail, bun, braids, bald. Clump hair as now, plus simple secondary motion (spring bones) for long hair and ponytails.
- **Wardrobe:**
  - tops: tee, long sleeve, hoodie, sweater, shirt, tank;
  - outer: jacket, denim, leather, blazer, varsity;
  - bottoms: jeans, chinos, shorts, skirt, dress, overalls;
  - shoes: sneakers, boots, sandals, heels;
  - accessories: glasses, sunglasses, caps, beanie, hat, headphones, backpack, bag, watch, earrings, nose ring.

  Accessories are rigid-attached to bones.
- **Colours and patterns:** colour per piece plus simple patterns (stripes, checks, denim).

### 3.7 The 3D Specialist agent (quality loop)

A dedicated review agent (`.claude/agents/3d-specialist.md`) runs after every change to meshes, rigs or motions.

1. It renders the **ROM sheet** (Blender Cycles): the head yaw, pitch and roll range, arms, squat, fists and a wide stance, each base with and without clothes.
2. It renders an **animation contact sheet**: every clip at 8 evenly spaced frames, front and side, with a floor grid, which shows foot sliding and ground penetration.
3. It renders a **three.js parity sheet**: the same poses in the browser runtime, so the web result matches Blender.
4. It grades against a checklist:
   - weight artifacts;
   - intersections;
   - foot sliding;
   - silhouette appeal;
   - arcs, timing and spacing;
   - the face.

   It files concrete issues with image crops.
5. Nothing ships while the agent reports a blocking issue.

## 4. One Characters plugin, 2D and 3D

- **One CharacterSpec** drives both engines: the 2.5D engine (hand-drawn look) and the 3D engine (sculpted, rigged). A saved character has both a 2D and a 3D version automatically. Where a feature exists in only one engine, it degrades gracefully.
- **Chat commands:** `/character Name` places the character. `/character Name 2d` or `3d` forces an engine; otherwise the shot's style decides.
- **AI tools** (one set for both engines):
  - `list_characters`, `get_character`, `design_character(spec)`;
  - `list_library` (moves, expressions, camera, props, FX, wardrobe);
  - `direct_shot(script, engine)`, `preview_shot` (returns frames to look at), `export_shot`.

  The shot JSON is the same for 2D and 3D; the engine renders it.

## 5. UI plan: the Characters plugin

Mockup: see the published "Characters" UI mockup page.

**Tone:** a bright, warm studio rather than a debug panel.

- Light warm neutrals with the app's accent.
- Rounded character cards on soft stage backgrounds.
- Big, friendly thumbnails rendered from the real characters.
- Motion on hover: cards play a tiny idle loop, and wardrobe items rotate.

**Screens:**

1. **Library (home).**
   - A header: "Characters", a search box, a New character button, and a 2D/3D toggle that changes every thumbnail.
   - Filter chips: All, Mine, Presets, Kids, Adults, Elders, Recently used.
   - A card grid with a portrait thumbnail, the name, a style tag (2D, 3D, or both) and quick actions: Use in video, Edit, Duplicate.
   - An empty-state row that creates from a preset.
2. **Character editor** (full screen).
   - **Left rail:** category icons for Body, Face, Hair, Outfit, Accessories, Colours and Personality.
   - **Centre:** a stage with a turntable, a camera preset bar (full, portrait, face) and an expression strip (happy, sad, angry, surprised, thinking) that previews the face.
   - **Right panel:** thumbnail grids for the active category.
     - Every hair style, garment, accessory and body shape has a rendered thumbnail on the current character, so you see *your* character in each option.
     - Colour swatches sit under the grid.
   - **Top:**
     - the name field;
     - a 2D/3D switch (the same character);
     - Undo, Randomize and Save;
     - "Save as preset".
3. **Moves and expressions browser.**
   - A grid of animated thumbnails (a flipbook of 8 frames) of the current character doing each clip.
   - Categories: Locomotion, Gestures, Emotes, Reactions, Interactions, Cartoon takes.
   - Click to preview on the stage; drag onto the timeline of a shot.
4. **Shot builder** (for power users; the AI uses the same model).
   - The stage plus a timeline with lanes for each actor, the camera, props and FX.
   - Beats are chips with thumbnails. A script tab shows the JSON the AI writes.
5. **In the video editor.** The plugin panel lists characters as thumbnails. Dragging one into the timeline creates a character clip; double-clicking opens the editor.

**Thumbnails:**

- Rendered by the engine itself (an offscreen canvas).
- Cached per character and option, and invalidated when the character changes.
- Presets and library items ship pre-rendered at 2× for instant loading.

## 6. Phases

1. **Rig and weights v3:**
   - the standard skeleton;
   - rule-based weights;
   - twist bones and a jaw;
   - the ROM test passing with the 3D Specialist sign-off.
2. **Motion library:**
   - retarget the Quaternius Standard clips;
   - the AnimationMixer runtime with IK overlays;
   - rewire ToonKit moves to clips;
   - contact sheets reviewed.
3. **Faces:** the shape keys, expressions, blink, visemes and a mouth interior.
4. **Bodies:** build and height shape keys, kid, teen and elder bases, face-shape variety, and 20 presets across 2D and 3D.
5. **Hair and wardrobe:** the full style and garment list, accessories and patterns.
6. **Plugin UI:** the library, the editor with thumbnails, the moves browser and the shot builder, following the mockup.
7. **App integration:** the plugin panel, `/character` in chat, the AI tools, and rendering shots to video.

Each phase ends with a 3D Specialist review and screenshots sent to the owner.

## 7. Needs from the owner

- **Quaternius Universal Animation Library (Standard, free, CC0):**
  1. Open https://quaternius.itch.io/universal-animation-library.
  2. Choose Download, then "No thanks, just take me to the downloads".
  3. Download `Universal Animation Library[Standard].zip`.
  4. Commit it to the repo under `assets/third-party/quaternius/`, or share it in chat.

  itch.io requires a browser click for downloads, so it cannot be fetched from the cloud session.
- *(Optional)* the **Pro** version ($9.99, 120+ clips) for more gestures and emotes.
- *(Optional)* **Mixamo** clips (free with an Adobe account) for extra emotes; download them "without skin" as FBX files.
