// Motion direction playbooks: how the reference films the user picked are built, as data the AI
// pulls with `motion_guide {topic}` instead of carrying it in every prompt. Numbers are the ones
// measured frame by frame (docs/REFERENCE-FILMS-PLAN.md §2 and the per-film reports); every tool,
// ease and feature named here is checked to exist by tests/motionDirection.test.ts.

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
      { name: 'Features ×3–5', seconds: [11, 24], what: 'Each feature is the real UI acted on: typing in fields, a click, a row lifting, a chart drawing on, a counter landing on the spoken number.', how: 'UI screens as layers (tilted 3D planes, camera push onto the part), cursor path, text.counter at {word, mode:"land"}, trim draw-on' },
      { name: 'Proof', seconds: [24, 27], what: 'Notifications, a face-pile, a stat constellation drifting in depth.', how: 'shape cards with inner-shadow/inner-glow, camera aperture for depth, parallax drift' },
      { name: 'Logo', seconds: [27, 30], what: 'The continuity dot becomes the logo dot; the wordmark slides out from behind the mark (10–11 f).', how: 'shape groups for the mark (svg_to_shape), mask-slide on `rise`, tick + glass cue' },
    ],
    look: [
      'Near-white lavender background (#eef0f6–#dde3f3) with drifting soft blobs and faint diagonal light shafts.',
      'Frosted cards, radius 24–32 px at 1080p, very soft big bluish shadows; one accent (blue/indigo) + the keyword in it.',
      'Inter / Manrope / Plus Jakarta Sans; dark #1d1d1f text.',
    ],
    timing: [...COMMON_TIMING, 'The background never cuts; the foreground swaps every 3–5 s. Hide cuts under a blur-bridge (blur on in 1 f, cut 3 f later, focus back in ~7 f) or a camera move.'],
    rules: [
      'One continuity object (a dot, orb or sparkle) carries the eye across beats and ends as the logo.',
      'Every UI event gets a tick (tick/click cues); typing gets its bed automatically.',
      'Never show a static UI: something is always being typed, clicked, lifted, drawn or pushed into.',
      'Keep type on safe area unless it is meant to bleed (bleed: true).',
    ],
    tools: ['create_motion_scene', 'update_motion_scene', 'search_icons', 'svg_to_shape', 'add_sound_effect', 'analyze_music_beats', 'snap_cuts_to_beats', 'run_frame_qa'],
    eases: ['house', 'emphasized', 'push', 'rise', 'expo-in'],
    features: ['shape.groups', 'text.type', 'text.retype', 'text.counter', 'effects.gradient-overlay', 'effects.inner-shadow', 'camera.aperture', 'bleed'],
    gaps: ['UI screens as living, targetable layers (click/hover-lift/assemble by name) are coming (plan P3); meanwhile build UI from shape groups + icons, or place a screenshot as footage on a 3D plane and animate parts as separate shape layers.'],
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
    tools: ['create_motion_scene', 'render_3d_scene', 'list_3d_presets', 'analyze_music_beats', 'snap_cuts_to_beats', 'get_brand_kit'],
    eases: ['rise', 'house', 'expo-in'],
    features: ['shape.groups', 'effects.bevel', 'effects.glow', 'camera.aperture'],
    gaps: ['Blender is optional: when list_3d_presets says it is not installed, fake orbs with radial-gradient ellipses + bevel + glow. 3D card rings with UI decals and sphere bouquets come in the full Blender pass (plan C3); build them from raw render_3d_scene objects meanwhile.', 'Echo trails and star glints are plan P5 effects; use glow + directional blur meanwhile.'],
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
    features: ['text.cascade', 'text.type', 'text.retype', 'text.scatter', 'text.lineSpacing', 'effects.gradient-overlay'],
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
    gaps: ['True rim-lit forms with card decals and swap-when-hidden are plan P6; use bevel + gradient-overlay meanwhile.'],
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
