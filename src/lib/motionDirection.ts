// Motion direction playbooks: how the reference films the user picked are built, as data the AI
// pulls with `motion_guide {topic}` instead of carrying it in every prompt. Numbers are the ones
// measured frame by frame (docs/REFERENCE-FILMS-PLAN.md §2 and the per-film reports); every tool,
// ease, feature and template named here is checked to exist by tests/motionDirection.test.ts.
//
// The five film playbooks (launch-film, product-demo, identity-film, kinetic-explainer, fluid-saas)
// carry what the premium films taught (docs/research/launch-film-learnings.md, the film-lab
// reports). Their templates are offered, never required: a model that writes its own scenes or
// renders its own frames follows the same beats, timing and rules.
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
  /** Ready-made templates and joins that fit (list_motion_templates, list_transitions): shortcuts, not a requirement. */
  templates?: string[];
  /** What to take from the reference and the brand for each film, so two films of this kind never come out alike. */
  vary?: string[];
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

// What every premium film shared (docs/research/launch-film-learnings.md §3, §8): the timing and
// the review gates the critics measured, whichever renderer made the frames.
const FILM_TIMING = [
  'Section changes on bars; mid-section cuts on the start of a sung or spoken line; hero actions on word onsets (analyze_song times every word, bar and hit); repeated actions on eighths or sixteenths; small events (a flare, a sheen, a send, the logo click) on the snares; an echo in the song gets a second hit.',
  'Words read with the voice: the reveal starts 35 ms before the onset so the word is readable on its syllable (opacity 0.16 s, blur 18 → 0 over 0.35 s, rise 0.24 em). Typing 46–66 ms a character from the word onset; a typed prompt about 22 characters a second.',
  'Entrances blur in: blur 8–14 px → 0, scale 0.90–0.94 → 1, rise 10–30 px over 0.3–0.45 s on expo-out. Exits are faster: 0.2–0.35 s on expo-in.',
  'Every move lands: at least 10 frames sharp with ≤ 1% drift before the next thing happens; never two competing moves in one 0.25 s window.',
  'Holds breathe (a 3–4% push, a pulse on the bar, chips lighting on a snare); no dead hold longer than about 1 s; something new every 1.5–3 s, at most one idea per 1.5 s.',
  'Motion blur: 180° shutter; 120° on whips (7–8 frames, landing sharp); 60–72° on moving text, bubbles and cursors, or they smear into stripes.',
  'The brand name is sharp at least 0.35 s before any fade; the picture fades only over the last 8 frames.',
];

const FILM_RULES = [
  'Build, then look: after each scene run review_frames (frames at every click, landing and cut, strips across the joins), name the one fault, fix it and look again. Two looks per scene is normal; do not start the next scene with a known fault in this one.',
  'Say each phrase once: never the same words as a headline, a title inside the product and a caption at the same time.',
  'Light the film as one: mean luma 45–60 on a dark film (a light stage sits near 170), UI shots with a 98th percentile ≥ 200, no shot twice as bright as the one before; text meant to be read has a cap height ≥ 26 px at 1080p.',
  'Every event on screen has its sound on its frame, heard over the music: sound_the_motion sets each cue against the song; the master sits at −16 LUFS, −1 dBTP.',
  'Save after every committed timeline step and read each diff: an audio place can land on the song’s track, a bulk change can change nothing.',
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
    gaps: ['capture_product_ui gives one flat screenshot; for the product’s real parts in their states use capture_app_session (Bhippi itself, or a url with CSS selectors) and create_product_demo, or rebuild the screen in HTML from the product’s CSS.'],
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
    rules: ['The first frame is never black or a logo.', 'Say the offer on screen and in voice.', 'Every scene ties to a spoken line; no filler visuals.', 'For a launch film set to a song, or any film that shows the product in depth, read motion_guide {topic:"launch-film"} (or "product-demo" for one task shown whole).'],
    tools: ['create_ui_screen', 'create_character', 'animate_character', 'create_motion_scene', 'create_motion_sequence', 'add_captions', 'add_fx', 'add_sound_effect', 'check_pacing', 'run_frame_qa'],
    eases: ['house', 'emphasized', 'expo-in'],
    features: ['text.type', 'text.counter', 'camera.aperture', 'camera.dof', 'scene.cues'],
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
    rules: ['One action per shot; never show two things changing at once.', 'Zoom in before small UI; nothing smaller than 2.5% of frame height stays on screen.', 'Labels name the action in 2–4 words.', 'The real product: capture_app_session, then create_product_demo (motion_guide {topic:"product-demo"} has the film version).'],
    tools: ['create_ui_screen', 'update_ui_screen', 'list_ui_kinds', 'capture_product_ui', 'capture_app_session', 'create_product_demo', 'add_text', 'add_fx', 'add_sound_effect', 'run_frame_qa'],
    eases: ['emphasized', 'push'],
    features: ['text.type', 'camera.aperture', 'scene.cues'],
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
    id: 'launch-film',
    title: 'Launch film to a song (the real product, a camera through it, cursors as narrators)',
    use: 'A 15–110 s launch or feature film set to a song or a voice-over that shows the user’s real product being used: the “Meet Bhippi” film (80/100) and its 15 s rebuild (84/100). One scene per sung or spoken line; each scene is a real product moment that literally shows the words.',
    films: ['Meet Bhippi launch film (Opus, 80/100)', 'Meet Bhippi 15 s rebuild (v1 76, v2 84)', 'Manus 2.0 launch (reference)', 'Relume launch film (reference)'],
    beats: [
      { name: 'Open', seconds: [0, 3], what: 'The product’s own object is born (a playhead in a pool of light, a caret on a light stage) or the first line types on; named cursors enter. No black or static frame longer than 0.5 s.', how: 'type-on-voice with the words from analyze_song, or a text.type layer with a bar caret; a slow camera drift; ticks on the first snares' },
      { name: 'First line', seconds: [3, 5.5], what: 'The line lands word by word in the product’s colour code; the camera pulls back from one part to the whole window, tilted about 5°/−9° at 0.84×.', how: 'capture_app_session for the parts in their states, then create_product_demo with a close shot on the part and a wide shot; or your own camera layer over the captured parts' },
      { name: 'Fly through a word', seconds: [5.5, 8.5], what: 'A cursor selects the key word, it grows, and the camera flies through one of its letters into the product; the next scene shows through the letter.', how: 'fly-through-word {word, line, next, words}; or the word as a track matte over the next scene, scale keyed on 0.35u + 0.65u^2.2, mosaic 36 → 1 px, zoom-blur at the peak' },
      { name: 'Connect', seconds: [8.5, 10.5], what: 'Provider marks fly in on their names, wires draw to the product mark, pulses run along them on the next word, the mark wakes.', how: 'connect-hub {providers, times from analyze_song}; or shape groups (svg_to_shape of the real logos), stroke trim for the wires, back-out pops' },
      { name: 'Ask and work', seconds: [10.5, 13], what: 'The prompt (about five words) types in the real composer and is sent on a snare; the steps tick 0.25 s apart at a readable size; the timeline fills on the beat grid while the monitor flashes each shot.', how: 'create_product_demo actions: type into @field, click @send on the snare, set @timeline to its filled state; a close shot on the work list (cap height ≥ 26 px)' },
      { name: 'Payoff and lockup', seconds: [13, 15], what: 'The whole product at work, sharp for 10 frames; then a clean field, the mark lands on the snare with one warm flash, the name sharp ≥ 0.35 s; the fade only over the last 8 frames.', how: 'a wide shot that lands, then glass-mark or logo-lockup (end-card with a call to action on longer films); flash-bridge or glow-handoff into it' },
    ],
    look: [
      'The real product UI, sharp at every zoom (parts captured at 3–4×), changing state on the frame of each action: never a mock-up or a still plate standing in for a scene.',
      'Light stage: cream #F7F5F1 → #EDE9E3 with a soft highlight (the launch-light finish), or peach #FCE8DB with 16/80 px hairlines; a cool grey stage only for the “other tools” contrast.',
      'Dark stage: lift it (the launch-dark finish) to mean luma 45–60; bloom only saturated colour so white UI never glows; vignette ≤ 10%.',
      'Soft warm-brown shadows (rgb 70,40,20 at 0.24–0.34, blur 24–70) under every card and window; depth of field only where layers truly separate.',
      'The product’s own colour code carries meaning (in Bhippi: blue is your move, ember is the AI at work); one type family; the keyword in colour.',
    ],
    timing: [
      ...FILM_TIMING,
      'Camera: establishing 0.84× at 5°/−9°, close-ups 1.85–3.55×, pre-drop orbit 0.64× at 15°/−33° then 0.90× flat on the drop. Zoom is a dolly keyed in log space; tilts stay within 2–9° except on drops; glides on cubic-in-out, arrivals on expo-out, exits on expo-in.',
      'Drops: the window comes apart over about 1.5 s on the build and slams back in the last 0.43 s onto the downbeat with a warm flash.',
    ],
    rules: [
      'Each scene is a real product moment that shows the line’s words (turn it up = the effort slider to Maximum; every call is up to you = the permission menu). Plan it in the storyboard with its times before building.',
      'Show the ask: type the prompt and press Send on screen before the product works.',
      'Named cursors tell the story: You, the product, each AI provider with its real logo. Tags never over a label; the final park inside the thing they built; the target changes state on the click frame.',
      'Hide every cut: a camera-state match, a plunge into the next subject, a whip, a light point that becomes the next scene, a warm flash on a drop, or a fly-through a word.',
      ...FILM_RULES,
      'A scene you render with your own code (mediaSource "render") is delivered in passes (backdrop, product, text, cursor, glow) through attach_production_asset {passes}, so it still opens as layers.',
    ],
    tools: ['analyze_song', 'analyze_clip_speech', 'analyze_music_beats', 'save_beat_sheet', 'save_storyboard', 'capture_app_session', 'create_product_demo', 'list_motion_templates', 'create_motion_scene', 'update_motion_scene', 'get_motion_scene', 'create_motion_sequence', 'list_transitions', 'svg_to_shape', 'sound_the_motion', 'review_frames', 'judge_edit', 'attach_production_asset', 'brain_load_skill'],
    eases: ['expo-out', 'cubic-in-out', 'sine-in-out', 'expo-in', 'cubic-in', 'back-out', 'push'],
    features: ['text.type', 'text.cascade', 'camera.aperture', 'camera.dof', 'scene.cues', 'scene.finish', 'layer.shutter', 'effects.drop-shadow', 'effects.zoom-blur', 'effects.mosaic', 'effects.grain', 'effects.exposure'],
    pacing: { swapGap: [0.6, 3], entrance: [4, 14], beatSync: 0.7, readingWps: 3.5 },
    templates: ['product-demo', 'window-explode', 'type-on-voice', 'fly-through-word', 'connect-hub', 'label-pill', 'glass-mark', 'logo-lockup', 'end-card', 'flash-bridge', 'glow-handoff', 'camera-match', 'whip', 'zoom-through'],
    vary: [
      'Stage and finish from the reference: light (launch-light, cream or peach) for bright references, dark (launch-dark) for night ones, the brand kit’s colours over either.',
      'The product moments the song’s words name, not the same five every time; the capture’s parts and states follow that storyboard.',
      'The camera: tilt side, orbit and explode pattern (create_product_demo variant); a join chosen per cut.',
      'The cadence: the song’s tempo, drops and snares, and the reference’s shot length (analyze_reference_video pacingTarget).',
    ],
    gaps: [
      'Close-ups slide toward the inside of the window rather than centring the part; give the shot centre: true for the literal framing.',
      'A cursor’s tag can cover UI text: check every click frame in review_frames and move the path or the shot.',
      'No ask-and-work or timeline-build template yet: build them as create_product_demo actions (type, click, set) on a capture with the timeline empty and filled (capture_app_session {demo:true} fills an empty one).',
      'Depth of field is per layer: keep it on an exploded window and receding planes.',
    ],
  },
  {
    id: 'product-demo',
    title: 'Product demo film (one real job in the real app, on the beat)',
    use: 'A 10–30 s film that shows the product doing one real job from the ask to the result: a feature film, an app-store preview, the white SaaS film (the Workly reference rebuilt in Bhippi’s real UI). Tighter than a launch film: one task, one story, the UI large enough to read.',
    films: ['White SaaS film (film lab, Workly reference in Bhippi’s real UI)', 'Meet Bhippi launch film S02–S09 (Opus)', 'Workly (Solair, reference)'],
    beats: [
      { name: 'Ask', seconds: [0, 2.5], what: 'A macro of the real input on a clean ground; the prompt types in; the cursor presses Send on a beat.', how: 'capture_app_session {steps: type the prompt into @field, capture @send}, then create_product_demo {shots:[{focus:"@field"}], actions:[{type:"@field"}, {click:"@send"}]}' },
      { name: 'Sent', seconds: [2.5, 4.3], what: 'Pull back to the conversation: the message rises on a spring, the work steps tick 0.25 s apart; a riser builds into the drop.', how: 'a close shot on @chat; bubbles and text at a 60–72° shutter; riser cue into the drop' },
      { name: 'The drop', seconds: [4.3, 6.8], what: 'On the drop the whole window, a tilted plane, racks into focus; the results land on the beat grid (clips on eighths).', how: 'a create_product_demo wide shot with tilt and a set of @timeline to filled on the drop; or slam-tilt with the capture as its media' },
      { name: 'Result', seconds: [6.8, 9.8], what: 'The result lifted out as a floating card over the blurred app, named by a pill.', how: 'a close shot on the result part; label-pill attached to it (2–5 words)' },
      { name: 'It plays', seconds: [9.8, 12.2], what: 'Zoom through the result (the monitor, the page, the chart) into it playing full frame, then pull back to show it is the product playing it.', how: 'create_motion_sequence with zoom-through into the result and camera-match back' },
      { name: 'Name', seconds: [12.2, 15], what: 'The name lands with the sung or spoken words, the line opens to admit the logo, the tagline word by word.', how: 'logo-lockup or end-card {tagline, cta}; a glass cue on the final hit' },
    ],
    look: [
      'The UI is the hero and is read: 150–320% on the part in use; nothing meant to be read under a 26 px cap height; a white or near-white ground (#ffffff–#ededed) with soft pale accent glows.',
      'One accent (the product’s own), black or near-black type; big soft shadows under floating cards; shallow depth of field as the glue between planes.',
      'Real data in the UI: footage in the bins, a filled timeline, a chat mid-conversation (capture_app_session {demo:true}); never an empty panel, a broken image tile or a local path.',
    ],
    timing: [...FILM_TIMING, 'Cursor travel 0.4–0.8 s on arcs; a 55 ms dwell on the target; the click lands on a beat with a tick; each result holds 1–1.5 s so it can be read.'],
    rules: [
      'One task, shown whole: ask → work → result → the result in use. Every step is the real app changing state on the click frame.',
      'One action per shot; never two things changing at once.',
      'Every cursor parks inside what it built.',
      ...FILM_RULES,
    ],
    tools: ['capture_app_session', 'create_product_demo', 'capture_product_ui', 'create_ui_screen', 'analyze_song', 'analyze_music_beats', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'list_transitions', 'sound_the_motion', 'review_frames', 'judge_edit'],
    eases: ['expo-out', 'cubic-in-out', 'sine-in-out', 'expo-in', 'back-out'],
    features: ['scene.cues', 'scene.finish', 'layer.shutter', 'camera.aperture', 'effects.drop-shadow', 'effects.gaussian-blur'],
    pacing: { swapGap: [1.2, 3.5], entrance: [6, 20], beatSync: 0.6, readingWps: 3 },
    templates: ['product-demo', 'window-explode', 'slam-tilt', 'label-pill', 'logo-lockup', 'end-card', 'zoom-through', 'camera-match', 'blur-bridge', 'z-recede'],
    vary: [
      'The task: the one the brief is about, typed as the user would type it.',
      'Ground and accent from the brand kit; white for a light reference, the product’s dark theme for a dark one (create_product_demo stage).',
      'Shot sizes and the tilt side (create_product_demo shots, tilt, variant); which join takes the viewer into the result.',
    ],
    gaps: [
      'A capture without demo:true can show a broken image on a comp tile: capture Bhippi with demo:true, and check every capture’s sheet for broken images, placeholders and local paths.',
      'Another product: give capture_app_session its url and CSS selectors for the parts; Bhippi’s own parts have @names.',
    ],
  },
  {
    id: 'identity-film',
    title: 'Identity film (the mark as one material; light does the editing)',
    use: 'A 10–45 s brand or identity film around the logo itself: the mark is born, built, acts out what the product does and resolves into the lockup; scene changes are light, not cuts. The glass identity film (after “hi, aflow.”) and any logo reveal.',
    films: ['Bhippi glass identity film (film lab, round 1: 66/100)', 'aflow identity film (reference, 84/100)'],
    beats: [
      { name: 'Birth', seconds: [0, 3.5], what: 'A point of light, a four-point flare, the mark’s material born inside construction arcs, flecks drifting inside it.', how: 'glass-mark {landing:"resolve", stage:"dark"}; or shape groups with stroke trim for the arcs and a glow point; render_3d_scene for real glass' },
      { name: 'Build', seconds: [3.5, 6.5], what: 'The mark assembles from its parts on plucks or words; each morph takes 0.6–0.75 s and lands on an audible accent, never in 3 frames.', how: 'shape morphTo with morphT keys over 0.6–0.75 s on sine-in-out; svg_to_shape of the logo for its parts' },
      { name: 'Meaning', seconds: [6.5, 9.5], what: 'The mark acts out the product’s sentence: what it connects rides hairline paths into it and each landing pulses the mark; the camera pushes about 15% so it reads.', how: 'connect-hub {layout:"ring", exit:"collapse"} around the mark; a brightness pulse (+0.25 for 120 ms) on each landing' },
      { name: 'Flood', seconds: [9.5, 11.2], what: 'Light owns the frame: a colour flood or a white-out grows from the mark with 8–12 thin rays, then recedes radially onto the lockup that is already there.', how: 'create_motion_sequence joins white-out or glow-handoff; flash-bridge on the downbeat' },
      { name: 'Lockup', seconds: [11.2, 15], what: 'The complete name (never a letter or a dot missing), the tagline at a readable size, a slow 4% push, the sheen crossing twice; the last still at most 0.7 s.', how: 'glass-mark {wordmark, tagline, taglineTimes, beats}, or logo-lockup {name, tagline, words}' },
    ],
    look: [
      'Everything is one material: illustrated glass (a gradient body lit from the upper left, a crescent of light on the lower-right rim, a pale outline, a sheen, flat flecks inside), milky and light-cored, never opaque candy.',
      'Something sits behind the glass to refract (a soft gradient card, a core light); a dark navy void or a reflective floor, not a hard band.',
      'The palette from the brand: black → navy → lavender → white in the reference; one warm accent at most (ember for Bhippi).',
      'Type small and exact: the wordmark about 6% of frame height; the tagline cap height ≥ 26 px at 1080p, never faint grey on white.',
    ],
    timing: [
      ...COMMON_TIMING,
      'Big world changes land on 4-bar phrase lines or the drop; motion accents on the beat, cuts on the 16th before it.',
      'Morphs 0.6–0.75 s; white-outs 7–13 f; a 12 f black breath before a drop.',
      'Energy stays even: no flat stretch longer than 2 s and never four events inside one second; the lockup holds with a push, not a freeze.',
    ],
    rules: [
      'Light does the editing: blooms, floods and white-outs carry every scene change, and the next scene is already there when the light recedes.',
      'Spell the brand right in every frame it is on screen: a missing part (a dot, a letter) lands as a faint outline first and fills later.',
      'The meaning beat reads at phone size: things 20–40 px wide read as sparkles; double them and draw their path before they travel.',
      'Only the mark’s material and one accent carry across acts; the logo arrives complete at the end.',
      ...FILM_RULES,
    ],
    tools: ['analyze_song', 'svg_to_shape', 'get_brand_kit', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'list_transitions', 'render_3d_scene', 'list_3d_presets', 'add_fx', 'sound_the_motion', 'review_frames', 'judge_edit'],
    eases: ['sine-in-out', 'expo-out', 'rise', 'resolve', 'expo-in'],
    features: ['shape.groups', 'morphTo', 'effects.liquid-glass', 'effects.glow', 'effects.halation', 'camera.aperture', 'scene.finish', 'scene.cues'],
    pacing: { swapGap: [1.5, 5], entrance: [6, 30], beatSync: 0.6 },
    templates: ['glass-mark', 'logo-lockup', 'connect-hub', 'end-card', 'flash-bridge', 'glow-handoff', 'white-out', 'black-breath', 'zoom-through'],
    vary: [
      'The material from the mark and the brand: ember, clear, frosted or tinted glass (glass-mark material), or no glass at all (a flat decal, light lines) for a flat brand.',
      'The birth: a light point, a construction drawing or the mark swinging shut (glass-mark landing: resolve, land, swing).',
      'The meaning beat from the product’s own sentence, not always “connect”.',
      'Palette, ground and stage (dark or light) from the brand kit.',
    ],
    gaps: [
      'No logo-to-distance-field extrusion: glass-mark draws the logo as layered vector glass; for true refraction render the mark with render_3d_scene (a glass preset) and lay the 2D light over it.',
      'No mark rig yet (a logo split into parts that open, clack and think): place the parts as separate shape layers from svg_to_shape and key their rotation about the shared centre; hide the mark while its parts are more than 30° open.',
    ],
  },
  {
    id: 'kinetic-explainer',
    title: 'Kinetic explainer (words land on the voice, product cards named by pills)',
    use: 'A 15–60 s explainer led by a voice-over: each spoken point is a title landing on its words plus one product card (a real capture) that lands on the beat and is named by a pill. The crimson explainer (the Crimson Brief reference rebuilt around Bhippi): 68 → 75 in one critique round.',
    films: ['Crimson explainer (film lab, v1 68, v2 75)', 'Crimson Brief (reference, 80/100)'],
    beats: [
      { name: 'Hook', seconds: [0, 1.1], what: 'A plate with a rack focus; the first words land either side of the subject on their onsets; the subject pops in between with a converging echo and holds.', how: 'subject-reveal with a presenter cut-out, or word-land {text, words} over a stage; the echo with add_fx echo' },
      { name: 'Shrink and rest', seconds: [1.1, 1.7], what: 'The whole frame shrinks in one move into a centred card and rests there through a beat.', how: 'frame-to-card, or the plate as a card scaled 1 → 0.37 on [0.45,0,0.12,1]' },
      { name: 'Drop', seconds: [1.7, 2.4], what: 'On the drop the mark appears at final size on empty space (never flying through content): 3 frames early at 1.15×, opaque in 2 frames, then one clack.', how: 'glass-mark {landing:"land", at: the drop} or logo-lockup' },
      { name: 'Points', seconds: [2.4, 12.4], what: 'Three to five points, each owning at least 1.5 s: a real product card lands (a spring from 0.86 with a Y turn, or a slam on the bar), its title lands word by word, a pill names it and holds 0.6 s; the next point whips in.', how: 'slam-tilt {media, title, label}, word-land, label-pill {attach}; cards from capture_app_session; whip-pan or match-grow between points; connect-hub for “works with”' },
      { name: 'End card', seconds: [12.4, 15], what: 'The mark lands on the jingle’s downbeat, the name and line land on the sung syllables, the film’s own cards drift far behind, a 4.5% push.', how: 'end-card {backdrop: the film’s cards, beats}, or glass-mark with word-land' },
    ],
    look: [
      'A living field: the brand’s dark gradient (crimson #0a0203 → #a8182d in the reference) with two breathing corner glows, a drifting light band and slow motes; everything that floats drifts ±5 px.',
      'Cards: real captures in rounded frames with a hairline rim, a coloured glow and a deep shadow; one sheen after each lands.',
      'Type: one grotesque (Inter 610, tracking −0.038 em) with italic-serif accent words about 16% larger; words land grey and turn white.',
      'Pills: filled, 42 px tall, white words, a soft glow; one per point.',
      'Captures lit for the film: a white panel in a dark film doubles the frame’s light; capture it in a dark theme or grade it down.',
    ],
    timing: [
      ...FILM_TIMING,
      'Word landing: in over the onset −0.04 to +0.12 s, rise 34 px, blur 16 → 0, scale 1.06 → 1, grey → white 0.07–0.36 s after.',
      'Pill: the body springs from 0.78, its words follow 0.10 s later, 0.03–0.05 s apart, and read for at least 0.6 s before it leaves.',
      'Card landing: a spring at 2.2–3.2 Hz, ζ 0.45–0.62, a Y turn of −34…−40° → 0, blur 12–14 → 0 in 0.24 s.',
    ],
    rules: [
      'Cap the list: at most five points in 15 s, each at least 1.5 s; a script with eight features needs a longer film or three of them.',
      'Copy the reference’s structure beat by beat, rests included (word → pop → word → hold → shrink → rest → park).',
      'Heroes land on empty space: clear the frame first, then the mark appears at final size; never a mark over 500 px across content.',
      'No busy windows: never three layers entering or leaving in the same 3–5 frames; let one leave fully before the next lands.',
      'Every pill has an owner and leaves with the thing it names.',
      ...FILM_RULES,
    ],
    tools: ['analyze_song', 'analyze_clip_speech', 'analyze_reference_video', 'capture_app_session', 'list_motion_templates', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'list_transitions', 'add_fx', 'sound_the_motion', 'review_frames', 'judge_edit'],
    eases: ['expo-out', 'cubic-in-out', 'expo-in', 'spring', 'back-out'],
    features: ['text.cascade', 'scene.cues', 'scene.finish', 'layer.shutter', 'effects.glow', 'effects.grain', 'effects.vignette', 'effects.drop-shadow', 'link'],
    pacing: { swapGap: [0.6, 2.5], entrance: [3, 14], beatSync: 0.7, readingWps: 3.5 },
    templates: ['word-land', 'label-pill', 'slam-tilt', 'whip-pan', 'match-grow', 'connect-hub', 'glass-mark', 'logo-lockup', 'end-card', 'subject-reveal', 'frame-to-card', 'card-wall-3d', 'whip', 'z-recede'],
    vary: [
      'The field from the brand or the reference: crimson for the house look, the brand kit’s colours otherwise (light as well as dark).',
      'The points the voice-over actually makes, each with its own card from the real app.',
      'The join per point (whip, match-grow, z-recede, a camera match), never the same one every time; emphasis as italic serif, accent colour or bold (word-land emphasis).',
    ],
    gaps: [
      'The presenter: a real cut-out (rotoscope_clip + subject-reveal) or a library character with lip_sync_character on the real words; a generic talk loop reads as a cartoon.',
      'No state reveal of a panel filling in the order it was made: capture the panel empty and filled (capture_app_session) and wipe the filled one in with masks.',
    ],
  },
  {
    id: 'fluid-saas',
    title: 'Fluid SaaS film (a line types, cursors act on its words, the camera flies through them)',
    use: 'A 15–60 s SaaS film carried by type and one unbroken camera on a light ground: a line types on the voice, named avatar cursors arrive and select a word, the word grows and the camera flies through a letter into the next world. The Relume launch film and its 15 s Bhippi rebuilds.',
    films: ['Relume “This AI doesn’t just build your website” (reference)', 'Meet Bhippi 15 s rebuild (v2 84)'],
    beats: [
      { name: 'Line', seconds: [0, 3], what: 'The first line types on the voice in the middle of a near-white ground, each word blurring in on its onset.', how: 'type-on-voice {text, words} or word-land; a light look' },
      { name: 'Cursors', seconds: [3, 5.5], what: 'Two named cursors with avatar tags drift in on arcs from opposite corners and meet on the key word; one drag-selects it (a tinted box in 0.26 s).', how: 'two cursor layers (a shape with a text tag) keyed on arcs, the tag following with link; the selection a rect whose width is keyed' },
      { name: 'Grow', seconds: [5.5, 7], what: 'The selected word grows to fill the frame in the accent colour and the camera flies through one of its letters; the next world shows through, pixelated 36 → 1 px.', how: 'fly-through-word {word, line, next, fill:"accent", pixelate:36}' },
      { name: 'New world', seconds: [7, 12], what: 'The next line lands on a tinted ground with the keyword in the accent colour; the product (or a line drawing of it) assembles beside it in reading order.', how: 'word-land with [accent] markup; product-demo on a capture, or an svg_to_shape drawing drawn on by trim; camera-match between worlds' },
      { name: 'Name', seconds: [12, 15], what: 'The mark and name land on the last word; a slow push; the tagline word by word.', how: 'logo-lockup (light look) or end-card' },
    ],
    look: [
      'A near-white warm ground (#f1efec) that becomes one tinted world after the fly-through (pink #f8c9f5 in the reference, the brand’s tint otherwise), with faint vertical hairlines.',
      'One grotesque at a modest size (about 4% of frame height), dark #1d1d1f; the keyword in one saturated accent (magenta #d100c8 in the reference).',
      'Cursors are small arrows with round avatar tags in the actor’s colour; the selection is a thin accent box with a 10% tint.',
      'No grain, no vignette, no bloom: the light is flat and bright (the launch-light finish, or none).',
    ],
    timing: [
      ...FILM_TIMING,
      'The fly-through runs about 1 s on an accelerating curve; the next world’s mosaic resolves 36 → 1 px over 0.44 s.',
      'Cursors travel 0.6–1.2 s on arcs (±0.1 of the path) and park, bobbing 3–5 px, until they act.',
    ],
    rules: [
      'The camera never cuts: every change is a fly-through, a camera match or a blur bridge.',
      'A caption pill carries the voice only where the headline is not already saying the same words.',
      'The cursors are the narrators: each acts on a word while the voice says it.',
      ...FILM_RULES,
    ],
    tools: ['analyze_song', 'analyze_clip_speech', 'list_motion_templates', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'list_transitions', 'capture_app_session', 'create_product_demo', 'svg_to_shape', 'sound_the_motion', 'review_frames', 'judge_edit'],
    eases: ['expo-out', 'cubic-in-out', 'quart-in', 'sine-in-out', 'expo-in'],
    features: ['text.type', 'text.cascade', 'effects.mosaic', 'effects.zoom-blur', 'link', 'shape.groups', 'scene.cues'],
    pacing: { swapGap: [1, 3.5], entrance: [4, 16], beatSync: 0.6, readingWps: 3.5 },
    templates: ['type-on-voice', 'word-land', 'fly-through-word', 'label-pill', 'product-demo', 'logo-lockup', 'end-card', 'camera-match', 'blur-bridge', 'zoom-through'],
    vary: [
      'Ground and accent from the brand kit (the reference’s warm white and magenta are one choice, not the default).',
      'What the next worlds show comes from the product (a page, a timeline, a chart), not a fixed object.',
      'The cursor actors are the product’s own roles (You, the AI, a teammate); the flown-through word is the line’s keyword.',
    ],
    gaps: ['create_product_demo cursors carry a name and colour, not a photo: for an avatar picture add a small image layer that follows the cursor with link.'],
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
