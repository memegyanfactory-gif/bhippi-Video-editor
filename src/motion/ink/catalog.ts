// The drawn-styles catalogue the AI reads (list_drawn_styles): everything it can put in a
// `drawing` layer, with the params of each part and a worked example. Kept next to the code and
// checked by tests/motionInk.test.ts, so it never names something that does not exist.
import { FACES, ITEM_KINDS, LOOKS, PEN_TOOLS, PRINTS, type ItemKind, type Look } from './types';
import { INK_SETS, WORLDS, FELT_GROUNDS } from './library';

export const LOOK_HELP: Record<Look, string> = {
  riso: 'Risograph print (Film 1): items separate into 1–4 ink plates, each screened into halftone dots at its own angle, slightly out of register, multiplied onto grained paper. Any colour you give is split into the inks automatically (or set `ink`). Bright over dark knocks out automatically; `overprint: true` multiplies instead.',
  crayon: 'Coloured pencil / crayon storybook (Film 4): fills are diagonal crayon hatching over a light wash, outlines a pressure-shaped dark line, paper tooth. `fillIn` sweeps the hatching on.',
  ink: 'Clean ink line (Film 4 generative pages): pressure ribbons, flat fills, gentle boil.',
  pencil: 'Graphite sketch: several faint interrupted passes per line, light hatching, paper tooth.',
  'cut-paper': 'Cut-paper collage (Film 5): every shape sits on a torn white paper rim with a soft contact shadow, fills carry felt-marker streaks, `print` adds newsprint/music/grid inside. Felt-streaked ground.',
  felt: 'Felt-tip marker (Films 4 and 5 grounds): flat colour with directional marker streaks.',
  flat: 'Clean vector fills — for mixing with other layers and for mattes.',
  scope: 'Neural scope (Film 3): additive neon lines and glowing dots on a dark panel.',
};

type KindHelp = { what: string; params?: string };
export const KIND_HELP: Record<ItemKind, KindHelp> = {
  circle: { what: 'circle in the box' }, ellipse: { what: 'ellipse filling the box' }, rect: { what: 'rectangle', params: 'radius' },
  polygon: { what: 'regular polygon', params: 'sides' }, star: { what: 'star', params: 'sides, inner (0.45)' },
  line: { what: 'polyline', params: 'points [x0,y0,x1,y1,…] layer px' }, path: { what: 'SVG path fitted into the box', params: 'd, box?' },
  blob: { what: 'seeded organic shape', params: 'rough (0.35), seed' }, icon: { what: 'any Lucide icon, inked in the look (search_icons)', params: 'icon' },
  ripples: { what: 'rings growing out of a dot, thinning as they go (Film 1)', params: 'period (s between rings, 4/24), life (s), start, count, stroke, fill (the dot; null = none)' },
  rose: { what: 'rose curve r = cos(nθ)', params: 'n (4 = 8 petals), turns' }, spiral: { what: 'nautilus golden spiral with chambers', params: 'turns (2.6)' },
  snowflake: { what: 'six-arm dendritic snowflake', params: 'sides' }, web: { what: 'spider web', params: 'sides (spokes 12), count (rings 9)' },
  lissajous: { what: 'Lissajous figure', params: 'ratio [a, b] (3:2)' }, dandelion: { what: 'dandelion clock on a stem', params: 'count (seeds)' },
  sparkle: { what: 'eight-point star with ticks (Film 4)', params: 'sides, inner' }, burst: { what: 'radiating tick lines', params: 'sides (rays)' },
  constellation: { what: 'stars joined by lines (draw it on)', params: 'points, edges' },
  stars: { what: 'star field in the box, twinkling each drawing', params: 'count, fill, fill2' }, waves: { what: 'stacked sine waves (fill makes bands)', params: 'count, colors, rough' },
  hills: { what: 'layered rolling hills, back to front', params: 'colors, rough' }, sun: { what: 'sun disc with wavy rays', params: 'sides (rays)' },
  moon: { what: 'moon with craters' }, cloud: { what: 'bumpy cloud' }, flower: { what: 'flower', params: 'sides (petals), fill, fill2 (centre)' },
  tree: { what: 'tree: trunk (fill2) and crown (fill)' }, grass: { what: 'grass blades along the box bottom', params: 'count' },
  rain: { what: 'falling rain', params: 'count, start' }, planet: { what: 'planet with a ring', params: 'fill, fill2, stroke (ring)' },
  heart: { what: 'heart' }, trail: { what: 'dashed flight trail (paper plane)', params: 'points' },
  bot: { what: 'the cube creature (Films 2 and 4): body, stubby arms, legs, replaceable face', params: 'faces [{t, face}], legs (4), arms (true), fill' },
  sprite: { what: 'the sun-sprite mascot (Film 5): round body, tentacle rays swaying, face and cheeks', params: 'faces, sides (rays 12), cheeks' },
  write: { what: 'hand-lettered text that writes itself on letter by letter (Caveat by default)', params: 'text, fontSize, font, fill, from (s), cps (12 = 2 f a letter), align' },
  note: { what: 'lined note paper with a torn top edge (Film 5)' },
  pen: { what: 'the drawing tool: follows the tip of whatever is drawing on or being written, glides between strokes, rests at `rest`', params: 'tool (nib | pencil | brush | crayon), follow (item ids), rest [x, y], size' },
  construction: { what: 'graph paper, a guide circle, a centre cross and wavy guides in pale blue (Film 4)' },
  tear: { what: 'a region swept in from the left to a jagged torn edge; a matte for the paper-tear transition', params: 'progress 0→1, fill' },
  trace: { what: 'signal trace: spikes rise in 1 frame and decay (Film 3)', params: 'spikes (s), window (s), decay (s), colors' },
  'cloud-points': { what: 'glowing point-cloud "brain" in three lobes that flares on each spike (Film 3)', params: 'spikes, count, colors' },
  group: { what: 'children laid out in the group box (top-left 0,0), moved as one', params: 'items' },
};

/** A complete, valid drawing layer: the pen draws a bot on graph paper, it fills in, blinks happy and a sparkle pops. */
export const EXAMPLE_LAYER = {
  id: 'drawn', type: 'drawing',
  drawing: {
    look: 'crayon', paper: '#f2ecdf', step: 2, boil: 1.1,
    items: [
      { kind: 'construction', opacity: { k: [{ t: 0, v: 100 }, { t: 1.8, v: 100 }, { t: 2.2, v: 0 }] } },
      { id: 'hero', kind: 'bot', at: [960, 600], size: 480, fill: '#ec8452', draw: { k: [{ t: 0.2, v: 0, ease: 'sine-in-out' }, { t: 1.8, v: 1 }] }, fillIn: { k: [{ t: 1.8, v: 0 }, { t: 2.1, v: 1 }] }, faces: [{ t: 0, face: 'closed' }, { t: 2.1, face: 'dots' }, { t: 2.5, face: 'happy' }] },
      { kind: 'sparkle', at: [960, 290], size: 130, pop: 2.4 },
      { kind: 'write', text: 'hello', at: [960, 930], fontSize: 110, from: 2.6 },
      { kind: 'pen', tool: 'nib', follow: ['hero'], rest: [1500, 300] },
    ],
  },
};

export function drawnCatalog() {
  return {
    layer: '{"type":"drawing","drawing":{look, inks?, paper?, step?, boil?, seed?, items:[…]}} — a whole hand-made picture as one layer; it composites like any layer (masks, mattes, blend, 3D, effects).',
    looks: LOOKS.map((id) => ({ id, what: LOOK_HELP[id] })),
    drawing: {
      inks: 'colours (riso: the 1–4 plates, printed in order; others: the palette)',
      paper: 'ground colour; omit/null = transparent over what is below',
      step: 'frames per drawing at `fps` (24): 2 = on twos (Films 4, 5), 1 = smooth (Film 1)',
      boil: 'px of line wobble re-drawn every drawing (0 = still)',
      'pitch, misregister, tremor, angles': 'riso screen: dot pitch px (5), plate offset px (3), per-drawing jitter px, screen angles',
      tooth: 'paper tooth / felt streaks on the ground (true)',
      size: 'layer size [w, h] (the scene by default)',
    },
    item: {
      common: 'kind, id, at [x,y] (centre, layer px), size (number | [w,h]), rotation, scale (% or [sx,sy] for squash), opacity 0–100, in/out (s), fill, fill2, stroke (null = none), width, ink (riso plate index or coverage list), overprint, seed',
      motion: 'draw 0→1 (outline draws on; the pen follows), fillIn 0→1 (fill sweeps on; defaults to follow draw), pop (s: two big drawings with burst ticks, then rest — Film 5), progress (tear), wobble (extra boil px), hatchAngle. Any number may be keyed {k:[{t,v,ease}]} or an expression.',
      arcs: 'any keyed at/position [x, y] travels a curve with "arc" (0.2–0.35, + bows left of travel) or "through" [x, y] on the key that starts the move; "easeAxes" ["linear", "sine-in-out"] eases each axis on its own (a throw: steady across, eased up and down). check_motion_arcs flags straight moves, even spacing, jumps and size drift.',
      print: `cut-paper texture inside a shape: ${PRINTS.join(', ')}`,
      rim: 'cut-paper torn rim px (5)',
    },
    kinds: ITEM_KINDS.map((kind) => ({ kind, ...KIND_HELP[kind] })),
    faces: FACES,
    penTools: PEN_TOOLS,
    inkSets: Object.entries(INK_SETS).map(([id, set]) => ({ id, ...set })),
    worlds: WORLDS,
    feltGrounds: FELT_GROUNDS,
    effects: {
      riso: '{type:"riso", inks?:[…1–4 colours], paper?:colour, pitch:5, misregister:3, tremor:0.6, step:2, angle:15, amount:100} — prints ANY layer (footage, logo, text) as riso inks',
      halftone: '{type:"halftone", color:"#1d1b22", paper?:colour, pitch:5, angle:15, amount:100} — one-ink dot screen by darkness',
    },
    templates: ['riso-world', 'riso-ripple-open', 'riso-montage', 'pen-draws', 'sketchbook', 'constellation', 'paper-words', 'paper-note', 'hand-title', 'scope-panel'],
    transitions: { 'paper-tear': 'torn paper edge sweeps across in 6 f (Film 4)', iris: 'with at = the dot: the next world opens out of it (Film 1)' },
    direction: 'Read motion_guide {topic:"hand-made"} before planning: measured timings (on twos, 2-drawing pops, 2 f a letter, 12→6→3 montage, 12 f cuts at 120 BPM, 6 f tears) and the rules.',
    example: EXAMPLE_LAYER,
  };
}
