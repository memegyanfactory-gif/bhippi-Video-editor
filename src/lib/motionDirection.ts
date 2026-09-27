// Motion direction playbooks: how the reference films the user picked are built, as data the AI
// pulls with `motion_guide {topic}` instead of carrying it in every prompt. Numbers are the ones
// measured frame by frame (docs/REFERENCE-FILMS-PLAN.md §2 and the per-film reports); every tool,
// ease and feature named here is checked to exist by tests/motionDirection.test.ts.
import type { PacingTarget } from './pacing';

export type Beat = { name: string; seconds: [number, number]; what: string; how: string };
export type Playbook = {
  id: string;
  title: string;
  /** When to use it. */
  use: string;
  /** Films it was measured on. */
  films: string[];
  beats: Beat[];
  look: string[];
  timing: string[];
  rules: string[];
  /** Tools the recipe calls. */
  tools: string[];
  /** Named eases the recipe uses. */
  eases: string[];
  /** Engine features to reach for (dotted names). */
  features: string[];
  /** What check_pacing holds an edit in this genre to (measured on the films). */
  pacing?: PacingTarget;
  /** What the engine cannot do yet for this genre, and the stand-in to use meanwhile. */
  gaps?: string[];
};

const COMMON_TIMING = [
  'Pop-in: full scale in 3–4 frames, then 2–4 frames of rotation/scale settle (6–8 f in all).',
  'UI panel/card entrance 12–20 f on `emphasized`: orientation lands in ~6 f, scale settles in ~16 f.',
  'Sibling stagger: chars/rows 1 f, words 2–4 f, cards 2 f; UI parts assemble by distance on one clock.',
  'Camera push onto a target 25 f on `push`; a two-key move is `creep` then `snap-settle`.',
  'Exits are faster than entrances: 3–14 f on `expo-in` (speed ×1.4 per frame).',
  'Typing: 30 cps in UI fields, 12–13 cps for lines read with the voice-over; word chunks for long AI prompts.',
  'Text vs voice-over: headlines lead the spoken word by ~0.56 s ({word, mode:"lead"}); payoffs land on it ("land"); typed lines finish 0.3 s early ("finish").',
  'End card holds 1.2–3.9 s.',
];

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'saas-explainer',
    title: 'SaaS explainer (light UI world)',
    use: 'A product explained over its UI with a voice-over: Workly, Limelight, Virgil light scenes.',
    films: ['Workly (Solair)', 'Limelight (Burnwe)', 'Virgil light world'],
    beats: [
      { name: 'Hook', seconds: [0, 4], what: 'The pain in miniature: a pile of chat bubbles, a search that types and retypes, a list being rejected.', how: 'shape groups (rounded rect pills) popping on `house`, a continuity dot hopping between them; text.type with script backspace/retype cycles' },
      { name: 'Question', seconds: [4, 7], what: 'One headline ("Can\'t keep up?") in open space; tracking breathe or a 6 f invert flash.', how: 'text with tracking animator, lineSpacing, gradient-overlay colour front' },
      { name: 'Meet', seconds: [7, 11], what: '"Meet your new …" types; the phrases split and the product mark or hero UI object is born in the gap.', how: 'text.type + split via two text layers; array/morph or icon for the object; blur-bridge (defocus → hidden cut) into the app' },
      { name: 'Features ×3–5', seconds: [11, 24], what: 'Each feature is the real UI acted on: typing in fields, a click, a row lifting, a chart drawing on, a counter landing on the spoken number.', how: 'create_ui_screen (a kind or your HTML with data-part names): type, click, hover-lift, sweep, count, zoom into the part, place.tilt for a tilted plane; time each action to the spoken word' },
      { name: 'Proof', seconds: [24, 27], what: 'Notifications, a face-pile, a stat constellation drifting in depth.', how: 'create_ui_screen kind notifications (phone) with assemble + notify; shape cards with inner-shadow/inner-glow, camera aperture for depth, parallax drift' },
      { name: 'Logo', seconds: [27, 30], what: 'The continuity dot becomes the logo dot; the wordmark slides out from behind the mark (10–11 f).', how: 'shape groups for the mark (svg_to_shape), mask-slide on `rise`, tick + glass cue' },
    ],
    look: [
      'Near-white lavender background (#eef0f6–#dde3f3) with drifting soft blobs and faint diagonal light shafts.',
      'Frosted cards, radius 24–32 px at 1080p, very soft big bluish shadows; one accent (blue/indigo) + the keyword in it.',
      'Inter / Manrope / Plus Jakarta Sans; dark #1d1d1f text.',
    ],
    timing: [...COMMON_TIMING, 'The background never cuts; the foreground swaps every 3–5 s. Build the film as one create_motion_sequence {layout:"world"} (the camera trucks between beats) or with blur-bridge / z-recede transitions, and a guide dot that carries the eye.'],
    rules: [
      'One continuity object (a dot, orb or sparkle) carries the eye across beats and ends as the logo.',
      'Every UI event gets a tick (tick/click cues); typing gets its bed automatically.',
      'Never show a static UI: something is always being typed, clicked, lifted, drawn or pushed into.',
      'Keep type on safe area unless it is meant to bleed (bleed: true).',
    ],
    tools: ['create_motion_sequence', 'create_ui_screen', 'update_ui_screen', 'list_ui_kinds', 'create_motion_scene', 'update_motion_scene', 'search_icons', 'svg_to_shape', 'add_sound_effect', 'analyze_music_beats', 'snap_cuts_to_beats', 'run_frame_qa'],
    eases: ['house', 'emphasized', 'push', 'rise', 'expo-in'],
    features: ['shape.groups', 'text.type', 'text.retype', 'text.counter', 'effects.gradient-overlay', 'effects.inner-shadow', 'camera.aperture', 'bleed'],
    pacing: { swapGap: [2, 5], entrance: [6, 36] },
    gaps: ['Capturing the user’s own live product UI (capture_product_ui) is coming; meanwhile rebuild the screen in HTML from a screenshot, or use a kind.'],
  },
  {
    id: 'ai-launch',
    title: 'AI product launch (dark violet glass world)',
    use: 'A launch film for an AI product, often music-only: Solair, WasteProtection, Virgil dark.',
    films: ['Solair agency reel', 'WasteProtection (ObiN)', 'Virgil dark world'],
    beats: [
      { name: 'Typed open', seconds: [0, 4], what: 'A block caret types the promise with a feathered purple edge; the line shrinks to keep its width.', how: 'text.type {edge, front, caret:"block"}, camera pull-back' },
      { name: 'Giant type', seconds: [4, 8], what: '"Introducing <Name>" as giant letters (0.57 of frame height) the camera lands on, hops across, lands again.', how: 'text layer + camera position keys: land on `settle`, hop on [0.627,0.085,0.336,0.862]; bleed: true' },
      { name: 'Signature morph', seconds: [8, 12], what: 'A wall of tiles rounds into dots, gathers into a spinner that winds up, and the brand sparkle arrives from the lens and shrinks into the logo.', how: 'array {layout grid → morph ring, stagger}, item size/radius keys, layout.rotation on expo-in, shape morphTo star; `resolve` ease' },
      { name: 'Product', seconds: [12, 24], what: 'Glass dashboards fly in, prompt boxes type, notifications stack, named cursors collaborate.', how: 'shape cards with inner-glow + backdrop blur, text.type chunk:"word" for prompts, icons in glass tiles drawing on' },
      { name: 'CTA / logo', seconds: [24, 30], what: 'Neon capsule button with radar rings; logo builds (circle draws, mark strokes on, wordmark slides).', how: 'shape groups with trim, array ring of capsule outlines, glass + shimmer cues' },
    ],
    look: [
      'Near-black violet (#07030d–#0c0c0c) with violet mesh blobs and thin concentric rings.',
      'Glass cards: 1 px white 8–15% rim, inner glow, backdrop blur.',
      'The 4-point concave sparkle is the AI glyph, the wipe and the logo.',
      'Type white with an accent lead (Solair) or violet → lilac gradients (WasteProtection).',
    ],
    timing: [...COMMON_TIMING, 'Settle on `settle` (each frame keeps ~85% of the remaining distance, 43 f).', 'Seven one-frame snaps give Solair its rhythm: zoom-out to 0.3×, punch-in 1.4×, button press 0.66×.', 'Hide ~11 cuts behind 3–8 f ease-in exits.'],
    rules: [
      'Music-only films: no UI ticks; cut on the 16th before the beat, land motion on the beat, change worlds on the drop.',
      'The sparkle appears at least three times: as icon, as wipe, as logo.',
      'Glow sparingly: one bloom per scene, on the lead word or the hero object.',
    ],
    tools: ['create_motion_scene', 'update_motion_scene', 'search_icons', 'analyze_music_beats', 'snap_cuts_to_beats', 'run_frame_qa'],
    eases: ['settle', 'resolve', 'expo-in', 'emphasized'],
    features: ['shape.groups', 'kind:array', 'morphTo', 'text.type', 'text.retype', 'text.scatter', 'effects.inner-glow', 'effects.gradient-overlay', 'backdrop'],
    pacing: { swapGap: [0.8, 3], entrance: [3, 24] },
  },
  {
    id: 'brand-identity-film',
    title: 'Brand identity film (hero object journey)',
    use: 'A brand film built around one hero object from the brand kit (aflow\'s orb): identity reveals, launches of a brand.',
    films: ['aflow — identity film'],
    beats: [
      { name: 'Birth', seconds: [0, 3], what: 'The hero object is born inside a construction (two circles drawing on by trim = an eye).', how: 'shape groups with stroke trim, flat decals sliding on the object (fake rotation)' },
      { name: 'Rise', seconds: [3, 6], what: 'It shrinks to a marble and rises with a light trail through falling streaks; energy builds on a riser.', how: 'shape trail, riser cue, camera push' },
      { name: 'Drop world', seconds: [6, 12], what: 'On the drop (a phrase line): a new world of glossy spheres and a star glint; white-out to the next act.', how: 'snap_cuts_to_beats {grid:"phrase"}; real glossy spheres with render_3d_scene (preset pearl-core-orb, or a raw scene of sphere objects with pearl/glass materials) composited under 2D glints' },
      { name: 'Portal accelerando', seconds: [12, 16], what: 'Ring zoom loops cut shorter each time in sixteenths (3-3-2-2-2-1-1-1).', how: 'one constant-speed camera move, cut at 16th-note times from analyze_music_beats' },
      { name: 'Product world', seconds: [16, 30], what: 'The object becomes the cursor/pen: draws a circle, which turns 3D; UI windows tilt.', how: 'shape trim following the object, 3D layers + camera' },
      { name: 'Logo by world-resolve', seconds: [30, 40], what: 'The final world clears around the wordmark, which is already there; the opening circles return as a bookend.', how: 'layer opacity/blur resolve around a static wordmark' },
    ],
    look: ['Black → navy → lavender → white; the hero object\'s material and colour lead every act.', 'Star glints, lens rings, echo trails, white-outs.'],
    timing: [...COMMON_TIMING, 'Big world changes land on 4-bar phrase lines (all three in aflow within 2 frames).', 'Cut on the 16th pickup before the beat; motion accents land on the beat.', 'White-out 7–13 f; a 12 f black breath before a drop.'],
    rules: ['Only the hero object and one accent colour carry across acts.', 'Let the logo arrive last and small; the world does the talking.'],
    tools: ['create_motion_scene', 'create_motion_sequence', 'add_fx', 'render_3d_scene', 'list_3d_presets', 'analyze_music_beats', 'snap_cuts_to_beats', 'get_brand_kit'],
    eases: ['rise', 'house', 'expo-in'],
    features: ['shape.groups', 'effects.bevel', 'effects.glow', 'camera.aperture'],
    pacing: { swapGap: [2, 8], entrance: [6, 44], beatSync: 0.5 },
    gaps: ['Blender is optional: when list_3d_presets says it is not installed, fake orbs with radial-gradient ellipses + bevel + glow. 3D card rings with UI decals and sphere bouquets come in the full Blender pass (plan C3); build them from raw render_3d_scene objects meanwhile.'],
  },
  {
    id: 'kinetic-type',
    title: 'Kinetic typography',
    use: 'Any text-led beat: headlines, taglines, statements over the voice-over.',
    films: ['Workly', 'Solair', 'Virgil', 'Limelight', 'WasteProtection'],
    beats: [
      { name: 'Land', seconds: [0, 1], what: 'Words land with a 3–4 f pop or type in at 12–13 cps with a colour front.', how: 'text.cascade by word (stagger 2–4 f) or text.type' },
      { name: 'Hold', seconds: [1, 2.5], what: 'A slow push or drift; the keyword in the accent colour or a sweeping gradient band.', how: 'gradient-overlay {repeat, offset keys}, slow scale drift' },
      { name: 'Leave', seconds: [2.5, 3], what: 'Exit faster than the entrance: z-recede to ~0.65 with blur, a whip, or letters dissolving in reverse.', how: 'cascade.exit {order:"reverse"}, scale + blur keys on expo-in' },
    ],
    look: ['One family per film; weight contrast (Light ↔ SemiBold) instead of many fonts.', 'Keyword in the accent colour; everything else near-black or white.'],
    timing: COMMON_TIMING,
    rules: ['Headlines lead the spoken word; never let text arrive after the word.', 'Retype instead of replacing when one sentence becomes another (text.retype).', 'Scatter only for "AI" moments; it reads as noise elsewhere.'],
    tools: ['create_motion_scene', 'update_motion_scene'],
    eases: ['house', 'settle', 'expo-in'],
    features: ['text.cascade', 'text.type', 'text.retype', 'text.scatter', 'text.lineSpacing', 'effects.gradient-overlay', 'form', 'form.morph', 'form.squash'],
    pacing: { swapGap: [0.4, 2], entrance: [2, 12] },
  },
  {
    id: '2.5d-tricks',
    title: '2D that reads as 3D (Motion Tricks)',
    use: 'Playful, soft, inflated looks: bouncy shape characters, inflated type, fake-3D objects.',
    films: ['Motion Tricks (Emanuele Colombo)'],
    beats: [
      { name: 'Inflated title', seconds: [0, 3], what: 'Heavy rounded type with a per-letter gradient, top-left highlight, pink drop shadow, zooming out from 538%.', how: 'text + gradient-overlay + bevel + inner-glow + coloured drop-shadow; scale keys on [0.155,0.195,0.006,1]' },
      { name: 'Shape characters', seconds: [3, 12], what: 'Balls and cubes with googly eyes squash, stretch and bounce along dotted arcs.', how: 'ellipse/rect shape groups with bevel; pop squash 9% settle 3 f; hit squash 15% settle 7 f; 12 f run loop' },
      { name: 'Morphs', seconds: [12, 18], what: 'Sphere → torus (a hole opening), sphere → cube (a 1-frame swap while the face is hidden, disguised by a twist).', how: 'group ops merge subtract with an animated inner ellipse; morphTo for outlines' },
      { name: 'Depth', seconds: [18, 30], what: 'Props drift in depth: sharp across a band, blurred nearer and farther.', how: '3D layers + camera aperture with dof.band' },
    ],
    look: ['Flat pastel pink (#f8d2d6); rim-bright soft forms; violet/teal/orange props.'],
    timing: [...COMMON_TIMING, 'Run cycle: exact 12 f loop, 6 f per step.', 'Exit whip ×1.4 speed per frame.'],
    rules: ['Keep the light from one direction (bevel angle ~120°) on everything.', 'Blur by depth band, not by size.'],
    tools: ['create_motion_scene', 'update_motion_scene'],
    eases: ['house', 'expo-in', 'settle'],
    features: ['effects.bevel', 'effects.inner-glow', 'effects.gradient-overlay', 'ops.merge', 'morphTo', 'camera.dof'],
    pacing: { swapGap: [2, 5], entrance: [6, 30] },
    gaps: ['Card decals on forms (faces and eyes riding a turning object) are not built yet; place eyes as shape layers parented to the form layer.'],
  },
  {
    id: 'character-explainer',
    title: 'Character explainer (the MDS film)',
    use: 'A story told by a character: a hero who reacts, walks, hops, talks and meets other characters in flat, colour-blocked worlds.',
    films: ['Motion Design School character film'],
    beats: [
      { name: 'Wish', seconds: [0, 3], what: 'CU of the hero dreaming: prayer hands, fists up, a scheming tap. A slow push-in.', how: 'create_character with a character from the user’s library (list_characters) close and large; actions think → celebrate; camera scale 0.93→1' },
      { name: 'World', seconds: [3, 9], what: 'Wide: the hero is small in a flat set that reacts to him (sliders push, a curve bends); clones act staggered.', how: 'several create_character layers, staggered actions (hop, point, type); the set as shape layers' },
      { name: 'Turn', seconds: [9, 20], what: 'A palette-swap cut into "play mode": the world breaks, he leaps and runs.', how: 'create_motion_sequence with palette-swap-cut; leap, run with to; drawn FX (add_fx speed-lines, burst)' },
      { name: 'Low point', seconds: [20, 32], what: 'Flashlight CU: facepalm, a deep breath, sad eyes, a blink, then determination.', how: 'facepalm → expression sad → expression determined; light-shafts overlay; white-out out' },
      { name: 'Payoff', seconds: [32, 45], what: 'He catches the thing he wanted and hugs it; god rays burst, white-out.', how: 'celebrate + add_fx light-shafts / glow-ring / confetti-pop; white-out transition' },
    ],
    look: ['Flat fills, no outline on the hero, no grain on characters; static grain on backgrounds.', 'Almond eyes with a star catchlight; replacement mouths.', 'Colour inside the light, silhouette outside it.'],
    timing: [...COMMON_TIMING, 'The character is on twos (step 2); camera, UI and FX on ones.', 'Idles are dead holds of 15–20 f broken by 2–3-drawing bursts (the idle action), never sine breathing.', 'Anticipation scales with mass: hop 2 f, leap 3 f, a heavy strike 6 f.', 'Blink: half, closed, closed, half, then a rounder open (automatic).'],
    rules: ['One action at a time per character; stagger crowds.', 'Every big action has anticipation and a squash on landing (hop, leap).', 'Lip-sync every spoken line (lip_sync_character).', 'Hands never cross the face when raised.'],
    tools: ['list_characters', 'create_character', 'animate_character', 'lip_sync_character', 'list_character_actions', 'create_motion_sequence', 'add_fx'],
    eases: ['house', 'settle', 'expo-in'],
    features: ['character', 'particles'],
    pacing: { swapGap: [1.5, 6], entrance: [2, 24] },
    gaps: ['Cast from the user’s character library (list_characters: their saved characters, then the examples); the built-in rigs (dome-kid, shape-buddy, flat-corporate) only when that style is asked for. Custom rigs from a drawing come later.', 'Mouths come from word timings (not phonemes yet); Rhubarb lip sync is a later add-on.'],
  },
  {
    id: 'hand-made',
    title: 'Hand-made films: riso, the pen draws, cut paper, scope',
    use: 'A film that looks made by hand and printed: riso-printed worlds, a pen drawing the world in crayon, a beat-cut cut-paper montage, a sketchbook of generative drawings, a neural scope panel. Brand intros, love letters, explainers with a mascot, music pieces.',
    films: ['Riso worlds (Kevin Ngo / Opus 5, 672 f)', 'The pen draws the world (1,189 f)', 'What do you love? (672 f, cut paper)', 'Two cubes (stop-motion)', 'Fly scope (split screen)'],
    beats: [
      { name: 'Seed', seconds: [0, 1.5], what: 'One dot on paper. Ink rings grow out of it every 4 f and thin as they go; the sound arrives with them.', how: 'create_motion_scene riso-ripple-open (or a drawing layer with a ripples item), shimmer cue' },
      { name: 'Open', seconds: [1.5, 2.2], what: 'The first world opens out of the dot in 4 f, holds ~7 f and closes back into it in 3 f — a promise of what is coming.', how: 'riso-ripple-open mode disc; or the iris transition with at = the dot' },
      { name: 'Build', seconds: [2.2, 8], what: 'Worlds cut under the fixed centre dot, holding 12 f, then 6, then 3 — the montage accelerates. Then the same worlds return re-inked (palette swap) with a ring pulsing round the dot.', how: 'riso-montage (holds, swapInks); keep the dot as the continuity object' },
      { name: 'Make', seconds: [8, 16], what: 'The pen draws the hero: construction lines, outline stroke by stroke with the pen on the tip, crayon hatching sweeping the fill in (5–8 f), eyes last, a sparkle pops. Faces switch instantly (dots → happy).', how: 'pen-draws (subject bot, sprite, a motif, an icon or your SVG path); sketchbook for a burst of generative drawings; constellation to join ideas' },
      { name: 'List', seconds: [16, 22], what: 'One cut-paper card per beat (12 f at 120 BPM): the object and the mascot pop in two big drawings with burst ticks, the word writes itself underneath in ~7 f.', how: 'paper-words {words, bpm from analyze_music_beats}; paper-note for a question' },
      { name: 'Sign', seconds: [22, 26], what: 'The name writes itself on at 2 f a letter over the two dots, holds, fades in 4 f, leaving the dot.', how: 'hand-title (riso or crayon look)' },
    ],
    look: [
      'Riso: warm paper #efe9df; 2–4 inks from one set (classic = blue #2f6fb0, fluorescent pink #ff48b0, yellow #ffe800, indigo #3b2f8f); halftone at ~5 px pitch, plates 2–4 px out of register; colours are overprints, never gradients of RGB.',
      'Crayon storybook: sky in hatched pastel bands, flat hills, dark pressure line with a slight wobble, paper tooth; the big wooden dip-pen nib always in frame.',
      'Cut paper: every shape on a torn white rim with a soft shadow, felt-marker streaks in fills, newsprint or sheet music cut into some parts, felt-streaked flat grounds (a new colour per card), hand lettering in a rounded marker hand.',
      'Scope: black panel beside footage (a third of the frame), glowing point cloud, mint and peach traces.',
      'One medium per film (or per act): do not mix riso with crayon in one shot unless it is a deliberate world change.',
    ],
    timing: [
      'Frame rate 24. Drawn looks run on twos (step 2: 12 drawings a second, 40–47% of frames held); riso worlds can run on ones.',
      'Boil ~1 px re-drawn every drawing; paper texture and the halftone screen never move (pinned to the page).',
      'Pop: 2 drawings at ~116% with burst ticks, 1 at 105%, then rest (Film 5).',
      'Hand-writing: 2 f a letter (12 cps) for names and titles; a word under a card finishes in ~7 f.',
      'Ripple rings: a new ring every 4 f, each grows over ~0.9 s and thins; the iris opens in 4 f and closes in 3 f.',
      'Montage acceleration: 12 f → 6 f → 3 f per world; cuts on the beat (12 f = 120 BPM) for cut-paper cards.',
      'Pen: draws at an even speed (sine-in-out over the whole outline), fill hatching sweeps in 5–8 f after the outline closes, eyes go in last; faces switch with no in-between.',
      'Paper tear: 6 f from edge to edge.',
    ],
    rules: [
      'Keep one continuity object (the centre dot, the mascot, the pen) through every cut — it is what makes a montage read as one film.',
      'Bright over dark prints muddy unless it knocks out: the riso look knocks out by default; use overprint only for deliberate mixes.',
      'Give colours, not ink maths: the riso look separates any colour into the inks. Stay inside one ink set per act; swap the set for the palette-swap repeat.',
      'Hold the drawing: on twos the picture changes every other frame, so fast camera moves strobe — move the items, not a camera.',
      'The pen follows what is drawing (draw keyframes or write items). Give it a rest point off the subject, top right.',
      'Word cards: one idea per card, one object per card, the word short enough to write in 7 f.',
      'Print any footage or logo into the same world with the riso or halftone effect instead of pasting it in clean.',
      'Sound: a tick per cut in montages, pop on each card, key/swish while the pen draws, glass on the sparkle, typing under hand-writing (cues come with the templates).',
      // Solid drawing (Toniko Pantoja, "How to keep your 2D animation consistent and solid"):
      'Build from primitives: a character is spheres and boxes first (the bot, the sprite, blob), details on a second pass; the construction item shows the build.',
      'Layout first: before keying, write the character\'s positions and size for the whole shot (a layout: start, middle, end). Size changes only when it comes toward or goes away from the camera.',
      'Things move on arcs: give travelling keys an "arc" (0.2–0.35) or a "through" point; straight lines are for UI, wipes and machines.',
      'Spacing: out of a pose it accelerates, holds speed, then decelerates into the next pose (ease). A throw or a bounce is linear across and eased up and down: easeAxes ["linear", "sine-in-out"].',
      'A head or body turning front → side: the protruding part (nose, snout) travels a circle seen from above, so its steps get tighter toward the side view; favour the side view in the in-betweens, never split the distance evenly (it flattens the snout).',
      'Reuse, don\'t redraw: keep one drawing of the character and transform it (place and trace), so proportions never drift; change the face by keys, not by drawing a new head.',
      'Flip test: run check_motion_arcs after every animated scene and fix what it flags (straight, even-spacing, jump, size-drift) before showing it.',
    ],
    tools: ['list_drawn_styles', 'check_motion_arcs', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'search_icons', 'svg_to_shape', 'analyze_music_beats', 'snap_cuts_to_beats', 'run_frame_qa'],
    eases: ['sine-in-out', 'expo-out', 'expo-in', 'cubic-in-out'],
    features: ['drawing', 'effects.riso', 'effects.halftone', 'scene.cues', 'link'],
    // Measured: montage shots 3–12 f at 24 fps (0.125–0.5 s), story holds up to ~5 s; pops 2–3 drawings, writing ~7–15 f; cut-paper cards on the beat.
    pacing: { swapGap: [0.12, 5], entrance: [3, 30], beatSync: 0.6 },
    gaps: ['True 3D paper craft (Film 2\'s cubes) is 2D here: use render_3d_scene for a real stop-motion set, or the bot item on twos.', 'Hands holding the note paper (Film 5) are not drawn yet: use a cut-out photo of a hand or the note alone.'],
  },
  {
    id: 'documentary',
    title: 'Documentary / explainer edit (story from footage and research)',
    use: 'A story told from interviews, archival or researched footage: a narrator or subject carries it, b-roll proves every claim.',
    films: ['Vox-style explainers', 'Johnny Harris map stories', 'long-form YouTube documentaries'],
    beats: [
      { name: 'Cold open', seconds: [0, 8], what: 'The most surprising line or image first, before any title; the question the film answers.', how: 'analyze_clip_speech → pick the strongest sentence; place it first with a slow push-in (set_keyframes scale 100→106) and a low drone bed' },
      { name: 'Title', seconds: [8, 11], what: 'A calm title card or lower-third title over b-roll; no flashy entrances.', how: 'brand-title or kinetic-type template with exit, 12–20 f entrance on `emphasized`' },
      { name: 'Context', seconds: [11, 40], what: 'Who, where, when: lower thirds on every new speaker, a map or date card for every jump in place or time.', how: 'brand-lower-third per speaker (name + role), create_motion_scene map/date cards, b-roll over every claim (find_free_media, scrape_videos)' },
      { name: 'Turn', seconds: [40, 70], what: 'The complication: evidence on screen (documents, quotes, numbers) as the narrator says it.', how: 'quote cards (glass-teaching-card), brand-stat counting to the spoken number, add_text_behind_subject for emphasis, archival treatment (color_grade desaturate + grain)' },
      { name: 'Resolution', seconds: [70, 90], what: 'The answer and why it matters; the subject on camera, music resolves.', how: 'hold the interview longer (5–8 s shots), music swell on the last line, a clean end card' },
    ],
    look: ['Natural grade, gentle contrast; archival footage marked by a different treatment, never mixed silently.', 'Sans-serif lower thirds with generous padding; one accent colour for dates and numbers.', 'Every claim has something on screen proving it: b-roll, a document, a map, a number.'],
    timing: ['Calmer than ads: b-roll shots 3–6 s, interview holds 5–10 s.', 'Lower thirds 4–5 s, in on the first word the speaker says.', 'J-cuts: the next speaker\'s voice starts 8–12 f before the picture changes.', 'Music ducks ~12 dB under speech and breathes up in pauses longer than 1.5 s.'],
    rules: ['Never cut a speaker mid-word (analyze_clip_speech word times).', 'Credit every source (the council Researcher checks licences).', 'No meme-style effects or whooshes unless the user asks: restraint reads as trust.', 'Cover every jump cut in an interview with b-roll or a 110% punch-in.'],
    tools: ['analyze_clip_speech', 'find_free_media', 'scrape_videos', 'online_research', 'create_motion_scene', 'color_grade', 'add_text_behind_subject', 'level_audio', 'split_clips', 'place_clip', 'run_frame_qa'],
    eases: ['emphasized', 'settle'],
    features: ['text.counter', 'effects.grain'],
    pacing: { swapGap: [3, 7], entrance: [10, 24], readingWps: 3 },
  },
  {
    id: '3d-promo',
    title: '3D product promo (hero object, camera moves, light)',
    use: 'A product or logo shown as a 3D hero: orbiting camera, light sweeps, exploded views, a clean end card.',
    films: ['Apple product films', 'Modern Motion 3D promos'],
    beats: [
      { name: 'Reveal', seconds: [0, 3], what: 'The hero emerges from darkness: a rim light sweeps across its edge.', how: 'render_3d_scene with a device/logo preset, camera dolly-in, light sweep; or generate_cloud_media for a photoreal plate' },
      { name: 'Orbit', seconds: [3, 8], what: 'A slow 30–60° orbit showing the form; one headline beside it.', how: 'render_3d_scene camera orbit; kinetic-type headline on the empty side (layout: object left, text right)' },
      { name: 'Details ×3', seconds: [8, 18], what: 'Macro close-ups of three features, each with a thin callout line and a label.', how: 'render_3d_scene close camera per detail; create_motion_scene callout lines drawing on (trim paths) + labels' },
      { name: 'Exploded / in use', seconds: [18, 24], what: 'Parts separate in depth, or the object in its world.', how: 'depth layers with parallax (create_motion_sequence world layout) or generated in-context shot' },
      { name: 'End card', seconds: [24, 28], what: 'The hero small, name, one line, CTA.', how: 'brand-end-card; logo sting with a glint cue' },
    ],
    look: ['Dark or pure-white seamless stage; one key light, one rim light, soft floor reflection.', 'Thin 1–2 px callout lines, small caps labels, lots of empty space.', 'Colour only from the product and one accent.'],
    timing: ['Camera moves are slow and continuous (ease `push` over 2–4 s); never a static hold longer than 2 s.', 'Detail shots 2.5–3.5 s each; cuts on beat or hidden inside a light sweep.', 'Text enters after the camera settles, 6–10 f later.'],
    rules: ['One hero object per shot.', 'Hide cuts in light flashes, whip pans or the object filling the frame.', 'Sub hit + shimmer on the reveal and the logo.'],
    tools: ['list_3d_presets', 'render_3d_scene', 'generate_cloud_media', 'create_motion_scene', 'create_motion_sequence', 'add_fx', 'analyze_music_beats', 'snap_cuts_to_beats', 'add_sound_effect', 'run_frame_qa'],
    eases: ['push', 'settle', 'emphasized'],
    features: ['camera.aperture', 'effects.glow'],
    pacing: { swapGap: [2, 4], entrance: [8, 24], beatSync: 0.6 },
  },
  {
    id: 'product-launch',
    title: 'Product launch ad (hook, problem, product, proof, offer, CTA)',
    use: 'A short paid-social or launch ad for an app or SaaS: 20–45 s, hook in the first 2 s, a clear offer and CTA.',
    films: ['Performance ads for SaaS and apps', 'launch videos with a founder VO'],
    beats: [
      { name: 'Hook', seconds: [0, 2.5], what: 'A pattern interrupt: the pain as a visual joke or a bold claim in huge type.', how: 'kinetic-type or a character reacting (create_character surprise/facepalm); a hit on the first frame' },
      { name: 'Problem', seconds: [2.5, 7], what: 'The pain in the viewer\'s world: piles of work, a clock, a boss.', how: 'characters or UI chaos (create_ui_screen notifications), fast 1–1.5 s swaps' },
      { name: 'Product', seconds: [7, 11], what: 'The product arrives as the answer: logo + one line.', how: 'brand-logo-sting or a morph from the problem object; whoosh + shimmer' },
      { name: 'How it works ×3', seconds: [11, 24], what: 'Three steps, each shown in the real UI, each one short sentence.', how: 'create_ui_screen with type/click/sweep actions timed to the voice-over words' },
      { name: 'Proof', seconds: [24, 28], what: 'A number that lands on the spoken word ("10 hours → 10 minutes").', how: 'brand-stat counter, before/after split' },
      { name: 'Offer + CTA', seconds: [28, 35], what: 'Price anchor, the free offer, a button being clicked, urgency.', how: 'brand-end-card with the CTA; a cursor clicking a "Download" button; hold 2–3 s' },
    ],
    look: ['Brand kit colours; one accent for the key words.', 'Big type (headline ≥ 7% of frame height), max 6 words on screen.', 'Captions always on (sound-off viewing).'],
    timing: ['Something new every 1–2.5 s in the first 7 s, then 2–4 s.', 'Headlines lead the spoken word by ~0.5 s.', 'End card holds ≥ 2 s.'],
    rules: ['The first frame is never black or a logo.', 'Say the offer on screen and in voice.', 'Every scene ties to a spoken line; no filler visuals.'],
    tools: ['create_ui_screen', 'create_character', 'animate_character', 'create_motion_scene', 'create_motion_sequence', 'add_captions', 'add_fx', 'add_sound_effect', 'check_pacing', 'run_frame_qa'],
    eases: ['house', 'emphasized', 'expo-in'],
    features: ['text.type', 'text.counter'],
    pacing: { swapGap: [1, 3.5], entrance: [4, 18], readingWps: 3.5 },
  },
  {
    id: 'ui-walkthrough',
    title: 'UI walkthrough / product demo',
    use: 'Showing how software is used step by step: tutorials, onboarding, feature demos.',
    films: ['Linear, Arc and Notion feature videos'],
    beats: [
      { name: 'Goal', seconds: [0, 3], what: 'What we will do, in one line over the app.', how: 'kinetic-type over a blurred screen (create_ui_screen, then blur)' },
      { name: 'Steps', seconds: [3, 30], what: 'Each step: zoom to the part, cursor moves and clicks, the result appears, a short label.', how: 'create_ui_screen per step with zoom-into-part + click + type actions; step number badge (1/4)' },
      { name: 'Result', seconds: [30, 35], what: 'The finished state full screen, a satisfying reveal.', how: 'zoom out to the whole UI, confetti-pop or glint on success' },
    ],
    look: ['The UI is the hero: crisp, large (zoom 150–250% on the part in use), gentle drop shadow on a soft background.', 'Cursor always visible with click ripples.'],
    timing: ['Cursor moves 0.4–0.8 s with ease-in-out; clicks land on a tick sound.', 'Hold each result 1–1.5 s so it can be read.', 'Typing at 30 cps in fields.'],
    rules: ['One action per shot; never show two things changing at once.', 'Zoom in before small UI; nothing smaller than 2.5% of frame height stays on screen.', 'Labels name the action in 2–4 words.'],
    tools: ['create_ui_screen', 'update_ui_screen', 'list_ui_kinds', 'capture_product_ui', 'add_text', 'add_fx', 'add_sound_effect', 'run_frame_qa'],
    eases: ['emphasized', 'push'],
    features: ['text.type'],
    pacing: { swapGap: [2, 5], entrance: [6, 20] },
  },
  {
    id: 'normal-edit',
    title: 'Footage edit (talking head, vlog, podcast, event)',
    use: 'Editing the user\'s own footage into a tight, watchable video: cut the dead air, keep attention, clean sound.',
    films: ['Top YouTube talking-head and vlog edits'],
    beats: [
      { name: 'Hook', seconds: [0, 5], what: 'The strongest line from anywhere in the footage, moved to the start.', how: 'analyze_clip_speech → apply_recipe hook, or place the best sentence first' },
      { name: 'Body', seconds: [5, 60], what: 'Tight cuts on sentences; punch-ins every 6–10 s; b-roll or a graphic on every list, number or place.', how: 'apply_recipe tighten + punch-ins; add_text for key words; find_free_media b-roll; captions' },
      { name: 'Outro', seconds: [60, 70], what: 'A clean close: the call to action, end screen space.', how: 'brand-end-card or a simple text + music swell' },
    ],
    look: ['Natural colour, faces well exposed (inspect_color, color_grade only for balance unless asked).', 'Captions in the chosen style, never covering the face.', 'Punch-ins 108–115%, framed on the eyes.'],
    timing: ['Remove silences > 0.4 s and filler words; keep breaths that carry meaning.', 'A visual change every 4–8 s (punch-in, b-roll, graphic).', 'Music −18 to −22 dB under voice, ducked.'],
    rules: ['Never cut mid-word.', 'Keep the speaker\'s best takes; cut repeats.', 'Level the voice first (level_audio / normalize_audio).'],
    tools: ['analyze_clip_speech', 'apply_recipe', 'list_recipes', 'remove_range', 'split_clips', 'set_keyframes', 'add_captions', 'find_free_media', 'level_audio', 'normalize_audio', 'color_grade', 'run_frame_qa'],
    eases: ['settle'],
    features: [],
    pacing: { swapGap: [3, 8], entrance: [6, 18] },
  },
  {
    id: 'meme-edit',
    title: 'Meme / comedy edit',
    use: 'A funny edit: reaction memes, sound gags, zooms and captions timed to the joke (the @funny style adds the full roast pipeline).',
    films: ['Indian and US meme pages', 'reaction compilations'],
    beats: [
      { name: 'Setup', seconds: [0, 3], what: 'The situation, played straight, with a caption stating it.', how: 'caption in a bold meme style, the clip at normal speed' },
      { name: 'Beat', seconds: [3, 6], what: 'The punchline: a freeze, a zoom, a meme cut-in, a sound gag exactly on the word.', how: 'frame_hold + snap zoom; search_memes / find_memes_online for the reaction; add_sound_effect on the frame' },
      { name: 'Escalation', seconds: [6, 20], what: 'Each next beat bigger than the last; callbacks to earlier jokes.', how: 'roast_move / save_beat_sheet (in @funny), cutout_image stickers' },
    ],
    look: ['Bold white captions with black outline; meme images full frame or as stickers.', 'Saturated, punchy; fast zooms.'],
    timing: ['The gag lands on the exact frame of the word (±1 f).', 'Silence 4–8 f before the punchline makes it hit.', 'No joke longer than 3 s without a new beat.'],
    rules: ['Memes must fit the audience\'s country and be verified (the council Comedian checks).', 'One joke per beat; never explain the joke.', 'Mute music under the punchline sound.'],
    tools: ['search_memes', 'find_memes_online', 'get_meme_media', 'frame_hold', 'set_keyframes', 'add_sound_effect', 'cutout_image', 'add_captions', 'consult_council'],
    eases: ['expo-in'],
    features: [],
    pacing: { swapGap: [1, 3], entrance: [2, 8] },
  },
  {
    id: 'sound',
    title: 'Sound design for motion',
    use: 'Before placing sounds on any motion film.',
    films: ['All nine'],
    beats: [],
    look: [],
    timing: ['UI tick on most UI events in voice-over films (Limelight 18/25); clicks land on the press frame.', 'Music bed ~10 dB under the voice; end cards fade at −10 dB/s; loudness −14 LUFS, −1 dBTP.', 'Sub hit under a slam ("Boom" was +14 dB).'],
    rules: ['Music-only films: no UI sounds at all.', 'Glass on glints, shimmer on logo resolves, sub on slams and drops, riser into a drop, typing under typed text (automatic).', 'World changes on phrase lines or the drop: analyze_music_beats, then snap_cuts_to_beats {grid:"phrase"}.'],
    tools: ['add_sound_effect', 'analyze_music_beats', 'snap_cuts_to_beats', 'level_audio'],
    eases: [],
    features: ['scene.cues'],
  },
];

/** A playbook by id, or null. */
export function playbook(id: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

/** The topics, one line each. */
export function playbookIndex(): { id: string; title: string; use: string }[] {
  return PLAYBOOKS.map(({ id, title, use }) => ({ id, title, use }));
}
