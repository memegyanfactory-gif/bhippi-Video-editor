// React Bits motion engine for Helios.
//
// React Bits (reactbits.dev) is a catalogue of animated text, backgrounds, cursor
// interactions and cards for the web. None of it runs in a video export — it needs
// a DOM, a pointer and rAF — so this file is a Helios-native translation of the
// whole catalogue into primitives the engine already understands:
//
//   TEXT       -> per-word / per-letter entrance keyframes (`rb-*`), scrub-safe the
//                 same way `cap-*` is: paused animations driven by negative delays,
//                 so the preview shows exactly the frame for the playhead. Export
//                 degrades to the nearest libass entrance (`exportBase`) — the Rust
//                 side needs no change because unknown presets already fall back to
//                 a fade (see `entrance()` in src-tauri/src/caption_styles.rs).
//   MOTION     -> clip-level moves and overlays. Pointer-driven pieces (magnet,
//                 cursors, trails) become deterministic auto-paths (orbit / float /
//                 pulse) so the export can match the preview. Each entry names the
//                 nearest `motion.ts` move.
//   BACKGROUNDS-> ambient loop layers. Preview is a layered-gradient div running
//                 one of five shared loops; export is the same look frozen into a
//                 `4-color-gradient` (a rendered effect), which is the documented
//                 parity rule: backgrounds animate in preview, hold as a still
//                 grade in export.
//   CARDS      -> lower-third / title recipes: a preset plus a move plus a card
//                 CSS treatment for the preview.
//
// How to use it without any schema migration:
//
//   - Text clips carry an optional motion suffix in their `style` field:
//       "Hormozi+rb-scramble"  (caption keeps Hormozi, entrance becomes scramble)
//       "rb-decrypted"         (title / kinetic / lower-third: bare motion id)
//     See `parseRbStyle()`; Overlay and StyledCaption honour it.
//   - A color-matte clip named "RB: Aurora" (or any background label) renders the
//     animated background layer in the Compositor preview.
//   - The assistant names these ids in `add_text(style=...)` and in clip names;
//     see src/lib/ai-tools.json.

import type { CSSProperties } from 'react';

export type RbCategory = 'text' | 'motion' | 'background' | 'card';
export type RbUnit = 'word' | 'letter' | 'clip' | 'layer';
export type BgLoop = 'drift' | 'spin' | 'pulse' | 'rain' | 'shimmer';

export type RbDef = {
  /** Full id, e.g. `rb-scramble`. */
  id: string;
  label: string;
  category: RbCategory;
  about: string;
  use: string;
  unit: RbUnit;
  /** Seconds for one unit's entrance. */
  duration: number;
  /** Seconds between units. */
  stagger: number;
  intensity: number;
  /** CSS keyframe this entrance runs (declared in src/styles/app.css). */
  keyframe: string;
  /** Nearest libass entrance for export: pop | rise | blur | fade | type | glitch ... */
  exportBase: string;
  /** Nearest motion.ts move, so planners can stage it without knowing this file. */
  move: string;
};

export type RbBackground = {
  id: string;
  label: string;
  about: string;
  use: string;
  colors: [string, string, string, string];
  loop: BgLoop;
  /** 0..1 extra grain/vignette baked into the preview layer. */
  grain: number;
};

export type RbCard = {
  id: string;
  label: string;
  about: string;
  use: string;
  /** Which text preset the card is built on. */
  preset: 'title' | 'lower-third' | 'caption';
  move: string;
  /** Preview treatment class suffix (`rb-card-<treatment>`). */
  treatment: 'spotlight' | 'tilt' | 'bento' | 'glass' | 'pixel' | 'swap';
};

// ── text entrances (the full React Bits text catalogue) ──────────────────────

const T = (
  id: string, label: string, about: string, use: string,
  extra: Partial<Pick<RbDef, 'unit' | 'duration' | 'stagger' | 'intensity' | 'keyframe' | 'exportBase' | 'move'>> = {},
): RbDef => ({
  id: `rb-${id}`,
  label,
  category: 'text',
  about,
  use,
  unit: 'word',
  duration: 0.32,
  stagger: 0.06,
  intensity: 1,
  keyframe: `rb-${id}`,
  exportBase: 'pop',
  move: 'rise',
  ...extra,
});

export const RB_TEXT: RbDef[] = [
  T('split', 'Split Text', 'Characters split apart from the centre and land in place.', 'Headlines that assemble on a beat; hype hooks.', { unit: 'letter', stagger: 0.025, exportBase: 'pop', move: 'pop' }),
  T('blur', 'Blur Text', 'Words resolve out of a blur into focus.', 'Soft reveals over busy footage; intros.', { exportBase: 'blur', move: 'rise' }),
  T('circular', 'Circular Text', 'Letters set on a ring that rotates into reading position.', 'Logos, badges, stamps; channel intros.', { unit: 'letter', stagger: 0.03, duration: 0.5, exportBase: 'spin', move: 'rise' }),
  T('type', 'Text Type', 'Typewriter reveal with a blinking caret.', 'Tutorials, terminals, quotes being written.', { unit: 'letter', stagger: 0.045, exportBase: 'type', move: 'rise' }),
  T('shuffle', 'Shuffle', 'Letters shuffle like a deck before settling on the word.', 'Playful transitions; word reveals in challenges.', { unit: 'letter', stagger: 0.03, exportBase: 'glitch', move: 'pop' }),
  T('shiny', 'Shiny Text', 'A specular sheen sweeps across the word after it lands.', 'Premium titles, prices, brand names.', { exportBase: 'pop', move: 'rise' }),
  T('pressure', 'Text Pressure', 'Variable-weight pumping: words swell then relax.', 'Music beats; bold statements that breathe.', { intensity: 1.4, exportBase: 'pop', move: 'pop' }),
  T('curved-loop', 'Curved Loop', 'Text rides a gentle curve and loops side to side.', 'Banners, tickers, marquee callouts.', { duration: 1.6, stagger: 0, exportBase: 'fade', move: 'slide-beside' }),
  T('fuzzy', 'Fuzzy Text', 'Grainy static resolves into clean type.', 'Horror, mystery, lo-fi intros.', { exportBase: 'blur', move: 'fade-through' }),
  T('gradient', 'Gradient Text', 'Colour cycles across the word while it holds.', 'CTAs, channel names, anything that must glow.', { duration: 1.2, stagger: 0, exportBase: 'pop', move: 'rise' }),
  T('falling', 'Falling Text', 'Letters drop from above with a soft bounce.', 'Countdowns, lists, lyric drops.', { unit: 'letter', stagger: 0.04, exportBase: 'drop', move: 'drop-in' }),
  T('cursor', 'Text Cursor', 'A block cursor trails the typing reveal.', 'Demo captions, code walkthroughs.', { unit: 'letter', stagger: 0.05, exportBase: 'type', move: 'rise' }),
  T('decrypted', 'Decrypted Text', 'Cipher glyphs cycle then lock into the message.', 'Tech, gaming, true-crime reveals.', { unit: 'letter', stagger: 0.04, exportBase: 'glitch', move: 'pop' }),
  T('true-focus', 'True Focus', 'One word stays sharp while the rest defocuses.', 'Keywords in talking-head captions.', { exportBase: 'blur', move: 'rise' }),
  T('scroll-float', 'Scroll Float', 'Words drift upward with the scroll and settle.', 'Travel, vlogs, lyric lines.', { exportBase: 'rise', move: 'rise' }),
  T('scroll-reveal', 'Scroll Reveal', 'A mask wipes each line into view.', 'Editorial titles, testimonials.', { exportBase: 'reveal', move: 'rise' }),
  T('ascii', 'ASCII Text', 'Type flickers through ASCII before resolving.', 'Hacker aesthetic, retro gaming.', { unit: 'letter', stagger: 0.03, exportBase: 'glitch', move: 'pop' }),
  T('scrambled', 'Scrambled Text', 'Letters scramble then snap into order.', 'Hooks, quiz reveals, announcements.', { unit: 'letter', stagger: 0.035, exportBase: 'glitch', move: 'pop' }),
  T('rotating', 'Rotating Text', 'Words rotate through alternatives in place.', 'Feature lists, "we do X" statements.', { duration: 0.4, exportBase: 'spin', move: 'rise' }),
  T('glitch', 'Glitch Text', 'RGB-split glitch slices across the entrance.', 'Intros, drops, high-energy cuts.', { intensity: 1.5, exportBase: 'glitch', move: 'pop' }),
  T('scroll-velocity', 'Scroll Velocity', 'Skew follows entrance speed, then relaxes.', 'Sport, hype, fast montages.', { exportBase: 'skew', move: 'slide-beside' }),
  T('variable-proximity', 'Variable Proximity', 'Weight swells around the active word.', 'Karaoke captions, lyric highlights.', { exportBase: 'pop', move: 'pop' }),
  T('count-up', 'Count Up', 'Numbers roll up to their value on entry.', 'Stats, prices, milestones.', { duration: 0.6, stagger: 0, exportBase: 'type', move: 'rise' }),
  T('text-loop', 'Text Loop', 'Phrases cross-dissolve in a loop while held.', 'Rotating offers, multi-line hooks.', { duration: 0.5, stagger: 0, exportBase: 'fade', move: 'fade-through' }),
  T('masked-heading', 'Masked Heading', 'Oversized type wipes in behind a mask bar.', 'Cinematic titles, section headers.', { duration: 0.55, exportBase: 'reveal', move: 'slide-beside' }),
  T('particle-text', 'Particle Text', 'Letters coalesce from drifting dust.', 'Fantasy, intros, channel branding.', { unit: 'letter', stagger: 0.03, duration: 0.6, exportBase: 'blur', move: 'rise' }),
  T('split-flap', 'Split Flap', 'Departure-board flaps roll into each character.', 'Scores, dates, retro travel.', { unit: 'letter', stagger: 0.05, exportBase: 'type', move: 'rise' }),
  T('warp', 'Warp Text', 'Type bends through a wave as it lands.', 'Psychedelic, music visuals.', { intensity: 1.4, exportBase: 'stretch', move: 'pop' }),
  T('stroke', 'Stroke Text', 'Outline draws itself, then fills.', 'Elegant titles, wedding, luxury.', { duration: 0.7, exportBase: 'reveal', move: 'rise' }),
  T('depth', 'Depth Text', 'Layered extrusion gives the word thickness.', 'Sport, gaming, 3D-feel thumbnails.', { intensity: 1.3, exportBase: 'pop', move: 'pop' }),
  T('fold', 'Fold Text', 'Words unfold from a crease like paper.', 'Editorial, invitations, lookbooks.', { duration: 0.5, exportBase: 'rise', move: 'drop-in' }),
  T('echo', 'Echo Text', 'Ghost copies trail the word into place.', 'Concerts, speed, power moments.', { intensity: 1.3, exportBase: 'blur', move: 'slide-beside' }),
];

// ── clip motion + interactions ───────────────────────────────────────────────

const M = (
  id: string, label: string, about: string, use: string,
  extra: Partial<Pick<RbDef, 'unit' | 'duration' | 'stagger' | 'intensity' | 'keyframe' | 'exportBase' | 'move'>> = {},
): RbDef => ({
  id: `rb-${id}`,
  label,
  category: 'motion',
  about,
  use,
  unit: 'clip',
  duration: 0.45,
  stagger: 0.07,
  intensity: 1,
  keyframe: `rb-${id}`,
  exportBase: 'fade',
  move: 'rise',
  ...extra,
});

export const RB_MOTION: RbDef[] = [
  M('animated-content', 'Animated Content', 'Whole blocks rise with stagger on entry.', 'Section reveals, feature lists.', { move: 'rise' }),
  M('fade-content', 'Fade Content', 'Slow cross-fade with a slight lift.', 'Quiet transitions, testimonials.', { exportBase: 'fade', move: 'fade-through' }),
  M('electric-border', 'Electric Border', 'A current runs around the clip edge.', 'Live badges, "new" tags, CTAs.', { duration: 1.4, stagger: 0, exportBase: 'fade', move: 'rise' }),
  M('pixel-transition', 'Pixel Transition', 'Clip resolves through chunky pixels.', 'Retro cuts, gaming edits.', { exportBase: 'fade', move: 'fade-through' }),
  M('glare-hover', 'Glare Hover', 'A diagonal sheen crosses on arrival.', 'Product cards, thumbnails.', { move: 'rise' }),
  M('magnet-lines', 'Magnet Lines', 'Field lines bend toward the subject then release.', 'Tech explainers, magnetic titles.', { duration: 0.7, exportBase: 'stretch', move: 'slide-beside' }),
  M('click-spark', 'Click Spark', 'Spark burst on the landing frame.', 'Button presses, subscribe pops.', { duration: 0.3, exportBase: 'pop', move: 'pop' }),
  M('magnet', 'Magnet', 'Clip leans toward focus, then springs back.', 'Playful cards, menu items.', { exportBase: 'pop', move: 'pop' }),
  M('pixel-trail', 'Pixel Trail', 'Blocky after-images trail fast moves.', 'Motion titles, sport graphics.', { exportBase: 'blur', move: 'slide-beside' }),
  M('cubes', 'Cubes', 'Surface breaks into tumbling cubes that reform.', 'Logo stings, transitions.', { duration: 0.8, exportBase: 'fade', move: 'fade-through' }),
  M('metallic-paint', 'Metallic Paint', 'Liquid-chrome sheen flows over the clip.', 'Premium intros, automotive.', { duration: 1.2, stagger: 0, exportBase: 'fade', move: 'rise' }),
  M('noise', 'Noise', 'Animated grain washes over the entrance.', 'Film looks, grunge, texture.', { exportBase: 'fade', move: 'fade-through' }),
  M('shape-blur', 'Shape Blur', 'Directional smear resolves into the graphic.', 'Speed ramps, whoosh moments.', { exportBase: 'blur', move: 'slide-beside' }),
  M('crosshair', 'Crosshair', 'Reticle locks on, then the graphic lands.', 'Gaming, targeting gags.', { exportBase: 'pop', move: 'pop' }),
  M('image-trail', 'Image Trail', 'Ghost frames echo the move and decay.', 'Dance, sport, dynamic lower-thirds.', { exportBase: 'blur', move: 'slide-beside' }),
  M('ribbons', 'Ribbons', 'Silk ribbons sweep the graphic in.', 'Beauty, fashion, elegance.', { duration: 0.8, exportBase: 'reveal', move: 'slide-beside' }),
  M('splash-cursor', 'Splash', 'Ink splash blooms behind the landing word.', 'Art channels, kids content.', { exportBase: 'pop', move: 'pop' }),
  M('meta-balls', 'Meta Balls', 'Blobs merge and part around the graphic.', 'Playful branding, idents.', { duration: 0.9, exportBase: 'blur', move: 'rise' }),
  M('blob-cursor', 'Blob', 'Soft blob eases the clip into place.', 'Friendly explainers, onboarding.', { move: 'rise' }),
  M('star-border', 'Star Border', 'Stardust traces the card edge on entry.', 'Awards, wins, premium offers.', { duration: 1.2, stagger: 0, exportBase: 'fade', move: 'rise' }),
  M('glow-cursor', 'Glow', 'A glow swells as the card lands (secondary action).', 'Night footage, gaming, music.', { exportBase: 'pop', move: 'pop' }),
  M('scroll-expand', 'Scroll Expand', 'Frame blooms from thumbnail to full-bleed.', 'Hook endings, reveals.', { duration: 0.75, exportBase: 'zoom-out', move: 'scale-into-card' }),
  M('elastic-mesh', 'Elastic Mesh', 'Surface wobbles like jelly and settles.', 'Comedy, bouncy branding.', { duration: 0.7, intensity: 1.4, exportBase: 'stretch', move: 'pop' }),
  M('ripple-distortion', 'Ripple Distortion', 'Water ripples radiate from the landing point.', 'Calm reveals, nature, wellness.', { duration: 0.7, exportBase: 'blur', move: 'rise' }),
  M('swarm-cursor', 'Swarm', 'Particles converge into the graphic.', 'Tech intros, futuristic titles.', { duration: 0.8, exportBase: 'blur', move: 'rise' }),
  M('halftone-reveal', 'Halftone Reveal', 'Print dots grow into the image.', 'Retro, comic, pop-art edits.', { duration: 0.6, exportBase: 'fade', move: 'rise' }),
  M('pixel-swap', 'Pixel Swap', 'Tiles flip to swap one graphic for another.', 'Before/after, comparisons.', { exportBase: 'fade', move: 'fade-through' }),
  M('cursor-grid', 'Cursor Grid', 'Grid warps around the graphic, then relaxes.', 'Tech, data, cyber edits.', { duration: 0.7, exportBase: 'stretch', move: 'rise' }),
  M('sticker-peel', 'Sticker Peel', 'Corner peels back to reveal the card.', 'Unboxings, announcements.', { duration: 0.6, exportBase: 'reveal', move: 'drop-in' }),
  M('gradual-blur', 'Gradual Blur', 'Focus racks from foreground to the graphic.', 'Cinematic titles, depth shots.', { duration: 0.6, exportBase: 'blur', move: 'rise' }),
];

// ── backgrounds (ambient loops; export holds the grade as a still) ──────────

const B = (id: string, label: string, about: string, use: string, colors: RbBackground['colors'], loop: BgLoop, grain = 0.25): RbBackground =>
  ({ id: `rb-${id}`, label, about, use, colors, loop, grain });

export const RB_BACKGROUNDS: RbBackground[] = [
  B('aurora', 'Aurora', 'Slow polar ribbons drifting over dark footage.', 'Night vlogs, music beds, intros.', ['#0b1026', '#1b3a6b', '#0e7c7b', '#141b34'], 'drift', 0.3),
  B('plasma', 'Plasma', 'Charged blobs folding into each other.', 'Gaming, EDM, high-energy loops.', ['#12041f', '#4c1d95', '#db2777', '#0ea5e9'], 'drift', 0.25),
  B('particles', 'Particles', 'Dust motes drifting up through light.', 'Weddings, memorials, gentle beds.', ['#0a0a12', '#23233a', '#4a4a6a', '#101018'], 'rain', 0.4),
  B('gradient-blinds', 'Gradient Blinds', 'Soft venetian bands of colour.', 'Corporate, tech explainers.', ['#0f172a', '#1e3a8a', '#0ea5e9', '#0f172a'], 'drift', 0.15),
  B('beams', 'Beams', 'Light shafts sweeping a dark stage.', 'Concerts, speeches, reveals.', ['#050505', '#1f2937', '#f59e0b', '#111827'], 'spin', 0.2),
  B('pixel-snow', 'Pixel Snow', 'Chunky 8-bit snowfall.', 'Retro gaming, winter edits.', ['#0b1026', '#1e293b', '#94a3b8', '#e2e8f0'], 'rain', 0.35),
  B('lightning', 'Lightning', 'Electric arcs cracking through cloud.', 'Drama, sport, drops.', ['#020617', '#1e1b4b', '#7c3aed', '#38bdf8'], 'pulse', 0.3),
  B('galaxy', 'Galaxy', 'Starfield with nebula wash.', 'Space, dreams, night skies.', ['#030014', '#1a1040', '#5b21b6', '#0ea5e9'], 'drift', 0.35),
  B('dither', 'Dither', 'Ordered-dot retro gradient.', 'Vintage computing, lo-fi.', ['#101010', '#3f3f46', '#71717a', '#e4e4e7'], 'shimmer', 0.5),
  B('faulty-terminal', 'Faulty Terminal', 'Glitching phosphor scanlines.', 'Hacker, ARG, horror.', ['#001103', '#003b1f', '#00ff66', '#001103'], 'pulse', 0.45),
  B('ripple-grid', 'Ripple Grid', 'Pond ripples across a dot grid.', 'Calm tech, wellness.', ['#0c1a2b', '#155e75', '#22d3ee', '#0c1a2b'], 'drift', 0.2),
  B('dot-field', 'Dot Field', 'Breathing field of dots.', 'Minimal tech beds.', ['#0a0a0a', '#262626', '#525252', '#0a0a0a'], 'pulse', 0.2),
  B('threads', 'Threads', 'Woven fibre lines flowing.', 'Fabric, craft, fashion.', ['#171310', '#4a2c1a', '#c2703d', '#1c1410'], 'drift', 0.3),
  B('hyperspeed', 'Hyperspeed', 'Warp streaks rushing past.', 'Travel, transitions, energy.', ['#000000', '#1e1b4b', '#ffffff', '#312e81'], 'rain', 0.25),
  B('iridescence', 'Iridescence', 'Oil-slick colour shift.', 'Beauty, luxury, idents.', ['#1a0533', '#7c3aed', '#ec4899', '#22d3ee'], 'shimmer', 0.2),
  B('waves', 'Waves', 'Layered sine dunes rolling.', 'Calm beds, podcasts.', ['#082f49', '#0369a1', '#38bdf8', '#082f49'], 'drift', 0.15),
  B('grid-distortion', 'Grid Distortion', 'Perspective grid breathing.', 'Synthwave, retro drives.', ['#0d0221', '#3b0764', '#ff2fb3', '#0d0221'], 'pulse', 0.25),
  B('ballpit', 'Ballpit', 'Soft bouncing orbs.', 'Kids, playful branding.', ['#1e1b4b', '#7c3aed', '#f472b6', '#38bdf8'], 'pulse', 0.15),
  B('orb', 'Orb', 'Single glowing sphere halo.', 'Meditation, focus, premium.', ['#020617', '#0f172a', '#38bdf8', '#020617'], 'pulse', 0.2),
  B('letter-glitch', 'Letter Glitch', 'Glyph rain resolving into place.', 'Cyber, gaming intros.', ['#000000', '#052e16', '#22c55e', '#000000'], 'rain', 0.4),
  B('shape-grid', 'Shape Grid', 'Geometric tiles phasing.', 'Corporate motion beds.', ['#111827', '#1f2937', '#6b7280', '#030712'], 'shimmer', 0.2),
  B('liquid-chrome', 'Liquid Chrome', 'Molten metal flowing.', 'Luxury, automotive, awards.', ['#09090b', '#3f3f46', '#d4d4d8', '#18181b'], 'drift', 0.2),
  B('balatro', 'Balatro', 'Warped plasma card-table swirl.', 'Gaming, streams.', ['#052e2b', '#0d5c46', '#e2b93d', '#04211e'], 'spin', 0.25),
  B('aero-shards', 'Aero Shards', 'Glass shards drifting in haze.', 'Premium tech reveals.', ['#0b1220', '#334155', '#93c5fd', '#0b1220'], 'drift', 0.25),
  B('ghost-fibers', 'Ghost Fibers', 'Faint fibres curling in dark.', 'Mystery, documentary.', ['#060606', '#1c1917', '#78716c', '#060606'], 'drift', 0.35),
  B('crt-warp', 'CRT Warp', 'Curved-screen barrel glow + scanlines.', 'Retro broadcasts, archives.', ['#0a0f0a', '#1a2e1a', '#4ade80', '#000000'], 'pulse', 0.5),
  B('molten-metal', 'Molten Metal', 'Glowing cracks in cooling rock.', 'Intensity, forging, sport.', ['#0c0a09', '#7c2d12', '#f97316', '#fbbf24'], 'pulse', 0.3),
  B('gradient-waves', 'Gradient Waves', 'Broad colour surf rolling.', 'Festivals, lifestyle.', ['#1e1b4b', '#7c3aed', '#f472b6', '#facc15'], 'drift', 0.15),
  B('web-threads', 'Web Threads', 'Network mesh shimmering.', 'Data, AI, connectivity.', ['#020617', '#172554', '#38bdf8', '#020617'], 'shimmer', 0.25),
  B('topography', 'Topography', 'Contour lines breathing.', 'Outdoors, maps, docs.', ['#0c1a12', '#14532d', '#86efac', '#0c1a12'], 'drift', 0.2),
  B('light-tunnel', 'Light Tunnel', 'Neon rings rushing toward camera.', 'Intros, drops, travel.', ['#000000', '#4c1d95', '#e879f9', '#0ea5e9'], 'rain', 0.2),
  B('sliced-waves', 'Sliced Waves', 'Offset slices sliding over surf.', 'Glitch-art, fashion.', ['#111827', '#6d28d9', '#22d3ee', '#f472b6'], 'drift', 0.25),
  B('acid-squares', 'Acid Squares', 'Saturated tiles phasing hard.', 'Rave, streetwear.', ['#09090b', '#a3e635', '#ec4899', '#22d3ee'], 'pulse', 0.2),
  B('scanner', 'Scanner', 'Sweep line revealing grid.', 'Security, tech, search.', ['#020617', '#082f49', '#38bdf8', '#020617'], 'shimmer', 0.3),
  B('ferrofluid', 'Ferrofluid', 'Magnetic spikes blooming.', 'Science, premium idents.', ['#030303', '#1f2937', '#9ca3af', '#000000'], 'pulse', 0.3),
  B('lightfall', 'Lightfall', 'Waterfall of light over dark.', 'Ceremony, worship, calm.', ['#0a0a1a', '#312e81', '#e0e7ff', '#0a0a1a'], 'rain', 0.25),
  B('liquid-ether', 'Liquid Ether', 'Ethereal smoke in pastel.', 'Dreams, beauty, spa.', ['#1c1033', '#7c6bb0', '#e9c8e6', '#2b1a4d'], 'drift', 0.2),
  B('prism', 'Prism', 'Refracted light fanning out.', 'Hope, morning, clarity.', ['#0f172a', '#f8fafc', '#7dd3fc', '#c4b5fd'], 'shimmer', 0.15),
  B('dark-veil', 'Dark Veil', 'Heavy curtain folds parting.', 'Drama, reveals, luxury.', ['#050505', '#1c1917', '#44403c', '#000000'], 'drift', 0.3),
  B('light-pillar', 'Light Pillar', 'Vertical god-ray columns.', 'Sacred, memorial, epic.', ['#060913', '#1e3a8a', '#bfdbfe', '#060913'], 'pulse', 0.25),
];

// ── cards ────────────────────────────────────────────────────────────────────

export const RB_CARDS: RbCard[] = [
  { id: 'rb-spotlight-card', label: 'Spotlight Card', about: 'Card with a light that follows the action.', use: 'Testimonials, quotes, features.', preset: 'lower-third', move: 'rise', treatment: 'spotlight' },
  { id: 'rb-tilt-card', label: 'Tilt Card', about: 'Card with a 3D lean that settles flat.', use: 'Product highlights, thumbnails.', preset: 'title', move: 'drop-in', treatment: 'tilt' },
  { id: 'rb-magic-bento', label: 'Magic Bento', about: 'Feature tiles cascading into a grid.', use: 'Lineups, pricing, recaps.', preset: 'title', move: 'rise', treatment: 'bento' },
  { id: 'rb-glass-icons', label: 'Glass Icons', about: 'Frosted-glass chips floating in.', use: 'App promos, social rows.', preset: 'lower-third', move: 'rise', treatment: 'glass' },
  { id: 'rb-pixel-card', label: 'Pixel Card', about: 'Card resolving out of pixels.', use: 'Gaming, retro branding.', preset: 'title', move: 'fade-through', treatment: 'pixel' },
  { id: 'rb-card-swap', label: 'Card Swap', about: 'Cards trading places with spring.', use: 'Comparisons, before/after.', preset: 'lower-third', move: 'slide-beside', treatment: 'swap' },
  { id: 'rb-circular-gallery', label: 'Circular Gallery', about: 'Faces orbiting a centre word.', use: 'Teams, casts, panels.', preset: 'title', move: 'rise', treatment: 'spotlight' },
  { id: 'rb-carousel', label: 'Carousel', about: 'Panels gliding through a loop.', use: 'Highlights, portfolios.', preset: 'title', move: 'slide-beside', treatment: 'swap' },
  { id: 'rb-dock', label: 'Dock', about: 'Icon row magnifying across.', use: 'App menus, tool callouts.', preset: 'lower-third', move: 'pop', treatment: 'glass' },
  { id: 'rb-flying-posters', label: 'Flying Posters', about: 'Sheets swooping into a wall.', use: 'Events, lineups, recaps.', preset: 'title', move: 'drop-in', treatment: 'tilt' },
  { id: 'rb-flowing-menu', label: 'Flowing Menu', about: 'List rows pouring in with stagger.', use: 'Menus, chapters, credits.', preset: 'lower-third', move: 'rise', treatment: 'bento' },
  { id: 'rb-infinite-menu', label: 'Infinite Menu', about: 'Endless marquee of options.', use: 'Sponsors, credits, tickers.', preset: 'lower-third', move: 'slide-beside', treatment: 'pixel' },
];

// ── catalogue + lookup ───────────────────────────────────────────────────────

export const RB_CATALOG: RbDef[] = [...RB_TEXT, ...RB_MOTION];

const byId = new Map<string, RbDef>(RB_CATALOG.map((def) => [def.id, def]));
const bgById = new Map<string, RbBackground>(RB_BACKGROUNDS.map((bg) => [bg.id, bg]));
const cardById = new Map<string, RbCard>(RB_CARDS.map((card) => [card.id, card]));

/** Accepts `rb-scramble`, `scramble`, any case. */
export function findRb(id: string | null | undefined): RbDef | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  return byId.get(key) ?? byId.get(key.startsWith('rb-') ? key : `rb-${key}`);
}

export function findRbBackground(id: string | null | undefined): RbBackground | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  return bgById.get(key) ?? bgById.get(key.startsWith('rb-') ? key : `rb-${key}`);
}

/** A color-matte clip named like this renders the animated background preview. */
export function rbBackgroundFromName(name: string | null | undefined): RbBackground | undefined {
  if (!name) return undefined;
  const match = name.match(/^(?:rb|reactbits|bg)\s*:\s*(.+)$/i);
  const wanted = (match ? match[1] : name).trim().toLowerCase();
  return RB_BACKGROUNDS.find((bg) =>
    bg.id === wanted || bg.id === `rb-${wanted}` || bg.label.toLowerCase() === wanted,
  );
}

export function findRbCard(id: string | null | undefined): RbCard | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  return cardById.get(key) ?? cardById.get(key.startsWith('rb-') ? key : `rb-${key}`);
}

export const rbByCategory = (category: RbCategory): RbDef[] => RB_CATALOG.filter((def) => def.category === category);

/**
 * Splits a clip's `style` field into its base (caption style id, may be null) and an
 * optional React-Bits motion id. Forms: "Hormozi+rb-scramble", "rb-decrypted".
 */
export function parseRbStyle(style: string | null | undefined): { base: string | null; motionId: string | null } {
  if (!style) return { base: null, motionId: null };
  const parts = style.split('+').map((part) => part.trim()).filter(Boolean);
  let base: string | null = null;
  let motionId: string | null = null;
  for (const part of parts) {
    if (findRb(part)) motionId = findRb(part)!.id;
    else if (base === null) base = part;
  }
  return { base, motionId };
}

/**
 * Scrub-safe entrance style for one animated unit: the animation is paused and its
 * delay is negative playhead time, so scrubbing shows exactly the frame for the
 * moment — the same contract `cap-*` entrances keep.
 */
export function rbEntrance(motionId: string | null | undefined, delay: number, duration?: number, intensity?: number): CSSProperties {
  const def = findRb(motionId);
  if (!def) return {};
  const clamped = Math.min(2, Math.max(0.3, intensity ?? def.intensity));
  return {
    animationName: `${def.keyframe}, cap-${def.exportBase}`,
    animationDuration: `${Math.max(0.05, duration ?? def.duration)}s, ${Math.max(0.05, duration ?? def.duration)}s`,
    animationDelay: `${delay}s, ${delay}s`,
    animationPlayState: 'paused, paused',
    animationFillMode: 'both, both',
    animationTimingFunction: 'cubic-bezier(.2,.9,.3,1), cubic-bezier(.2,.9,.3,1)',
    ['--int' as string]: clamped,
  };
}

/** Nearest libass entrance for export — what the burned-in caption degrades to. */
export const rbExportBase = (motionId: string | null | undefined): string => findRb(motionId)?.exportBase ?? 'fade';

/** Nearest motion.ts move, for planners that stage motion without reading this file. */
export const rbMoveFor = (motionId: string | null | undefined): string => findRb(motionId)?.move ?? 'rise';

/**
 * Preview style for an ambient background layer: four-corner colour field with a
 * slow shared loop. The export equivalent is `rbBackgroundGradient()` frozen into
 * a `4-color-gradient` effect (see below).
 */
export function rbBackgroundStyle(bg: RbBackground): CSSProperties {
  const [a, b, c, d] = bg.colors;
  return {
    backgroundImage: [
      `radial-gradient(120% 90% at 15% 10%, ${b} 0%, transparent 55%)`,
      `radial-gradient(120% 100% at 85% 15%, ${c} 0%, transparent 50%)`,
      `radial-gradient(140% 120% at 50% 100%, ${d} 0%, transparent 55%)`,
      `linear-gradient(160deg, ${a}, ${a})`,
    ].join(', '),
    backgroundSize: '130% 130%, 130% 130%, 140% 140%, 100% 100%',
    animationName: `rb-bg-${bg.loop}`,
    animationDuration: bg.loop === 'rain' ? '7s' : bg.loop === 'pulse' ? '5s' : '14s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
  };
}

/**
 * Export twin of a background: corners for a `4-color-gradient` applied effect,
 * which IS rendered by the exporter (src-tauri/src/render/video.rs). Preview
 * animates; export holds this grade as a still — the documented parity rule.
 */
export function rbBackgroundGradient(bg: RbBackground): { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string } {
  const [a, b, c, d] = bg.colors;
  return { topLeft: b, topRight: c, bottomLeft: d, bottomRight: a };
}

/**
 * Ready-to-attach applied effect giving a background clip its export grade.
 * Preview ignores it (the animated layer paints instead); export burns the
 * gradient in. Attach alongside naming the matte `RB: <Label>`.
 */
export function rbBackgroundExportEffect(bg: RbBackground): {
  id: string;
  effectId: string;
  name: string;
  category: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
} {
  const corners = rbBackgroundGradient(bg);
  return {
    id: `fx-rb-${bg.id}-${Math.random().toString(36).slice(2, 7)}`,
    effectId: '4-color-gradient',
    name: `RB ${bg.label}`,
    category: 'Generate',
    enabled: true,
    params: { ...corners, mix: 100 },
  };
}

/** One-line catalogue for prompts and debugging. */
export function rbCatalogueSummary(): string {
  const names = (defs: RbDef[]) => defs.map((def) => def.id).join(', ');
  return [
    `text(${RB_TEXT.length}): ${names(RB_TEXT)}`,
    `motion(${RB_MOTION.length}): ${names(RB_MOTION)}`,
    `backgrounds(${RB_BACKGROUNDS.length}): ${RB_BACKGROUNDS.map((bg) => bg.id).join(', ')}`,
    `cards(${RB_CARDS.length}): ${RB_CARDS.map((card) => card.id).join(', ')}`,
  ].join('\n');
}
