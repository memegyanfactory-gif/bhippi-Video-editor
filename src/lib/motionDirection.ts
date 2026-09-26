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
      { name: 'Wish', seconds: [0, 3], what: 'CU of the hero dreaming: prayer hands, fists up, a scheming tap. A slow push-in.', how: 'create_character (dome-kid) close and large; actions think → celebrate; camera scale 0.93→1' },
      { name: 'World', seconds: [3, 9], what: 'Wide: the hero is small in a flat set that reacts to him (sliders push, a curve bends); clones act staggered.', how: 'several create_character layers, staggered actions (hop, point, type); the set as shape layers' },
      { name: 'Turn', seconds: [9, 20], what: 'A palette-swap cut into "play mode": the world breaks, he leaps and runs.', how: 'create_motion_sequence with palette-swap-cut; leap, run with to; drawn FX (add_fx speed-lines, burst)' },
      { name: 'Low point', seconds: [20, 32], what: 'Flashlight CU: facepalm, a deep breath, sad eyes, a blink, then determination.', how: 'facepalm → expression sad → expression determined; light-shafts overlay; white-out out' },
      { name: 'Payoff', seconds: [32, 45], what: 'He catches the thing he wanted and hugs it; god rays burst, white-out.', how: 'celebrate + add_fx light-shafts / glow-ring / confetti-pop; white-out transition' },
    ],
    look: ['Flat fills, no outline on the hero, no grain on characters; static grain on backgrounds.', 'Almond eyes with a star catchlight; replacement mouths.', 'Colour inside the light, silhouette outside it.'],
    timing: [...COMMON_TIMING, 'The character is on twos (step 2); camera, UI and FX on ones.', 'Idles are dead holds of 15–20 f broken by 2–3-drawing bursts (the idle action), never sine breathing.', 'Anticipation scales with mass: hop 2 f, leap 3 f, a heavy strike 6 f.', 'Blink: half, closed, closed, half, then a rounder open (automatic).'],
    rules: ['One action at a time per character; stagger crowds.', 'Every big action has anticipation and a squash on landing (hop, leap).', 'Lip-sync every spoken line (lip_sync_character).', 'Hands never cross the face when raised.'],
    tools: ['create_character', 'animate_character', 'lip_sync_character', 'list_character_actions', 'create_motion_sequence', 'add_fx'],
    eases: ['house', 'settle', 'expo-in'],
    features: ['character', 'particles'],
    pacing: { swapGap: [1.5, 6], entrance: [2, 24] },
    gaps: ['Only three base characters so far (dome-kid, shape-buddy, flat-corporate); custom rigs from a drawing come later.', 'Mouths come from word timings (not phonemes yet); Rhubarb lip sync is a later add-on.'],
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
    ],
    tools: ['list_drawn_styles', 'create_motion_scene', 'update_motion_scene', 'create_motion_sequence', 'search_icons', 'svg_to_shape', 'analyze_music_beats', 'snap_cuts_to_beats', 'run_frame_qa'],
    eases: ['sine-in-out', 'expo-out', 'expo-in', 'cubic-in-out'],
    features: ['drawing', 'effects.riso', 'effects.halftone', 'scene.cues', 'link'],
    // Measured: montage shots 3–12 f at 24 fps (0.125–0.5 s), story holds up to ~5 s; pops 2–3 drawings, writing ~7–15 f; cut-paper cards on the beat.
    pacing: { swapGap: [0.12, 5], entrance: [3, 30], beatSync: 0.6 },
    gaps: ['True 3D paper craft (Film 2\'s cubes) is 2D here: use render_3d_scene for a real stop-motion set, or the bot item on twos.', 'Hands holding the note paper (Film 5) are not drawn yet: use a cut-out photo of a hand or the note alone.'],
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
