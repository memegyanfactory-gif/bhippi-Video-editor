// Two looks, taken apart frame by frame and written down as something the editor can build.
//
// A pack is not a filter. It is the set of decisions a film already made — its palette, how big
// its type is, what its surfaces are made of, how things arrive and leave, and which arrangements
// of the frame it uses again and again. `docs/reference-style.md` is the reading; this is the
// same thing in a form the layout engine, the brand and the motion system can consume.
//
// Sources, watched at 4 fps through the openings and 1 frame per 10 s throughout:
//   · crimson-brief — *If You ONLY Watch One Motion Design Video, Make It This…*
//   · aflow-glass  — *[motion graphics] hi, aflow. — identity film*
import type { Brand } from './brand';
import type { CurveName } from './motion';
import type { SlotName } from './layout';

/** What a surface in this look is made of. Each maps to a way of drawing, not a preset name. */
export type Material =
  /** Flat fill, a hairline border, a soft shadow. The reference brief's cards. */
  | 'card'
  /** Small filled capsule with a label in it. */
  | 'pill'
  /** Translucent, with a specular highlight and a light that travels its edge. */
  | 'glass'
  /** A sphere: gradient interior, highlight up-left, contact shadow under. */
  | 'orb'
  /** Thin construction lines and arcs, drawn as if setting out the frame. */
  | 'line'
  /** Light with no object: bloom, flare, a beam. */
  | 'bloom';

/** One arrangement of the frame this look uses repeatedly. */
export type Scene = {
  name: string;
  about: string;
  seconds: number;
  /** What is in it, in the order it arrives. `after` is seconds from the scene's start. */
  parts: { kind: string; slot?: SlotName; move: string; after: number; material?: Material }[];
};

export type StylePack = {
  id: string;
  name: string;
  about: string;
  /** The film it was read from, so the claim can be checked. */
  source: string;
  /** Everything a brand needs except what must come from the project itself. */
  brand: Pick<Brand, 'palette' | 'fonts' | 'type' | 'radius' | 'shadow' | 'motion' | 'voice'>;
  materials: Material[];
  /** Curves this look leans on, in the order it prefers them. */
  curves: CurveName[];
  scenes: Scene[];
  /** What it is good for, so a recipe can choose sensibly. */
  suits: string[];
};

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'crimson-brief',
    name: 'Crimson Brief',
    about:
      'A dark red field with one hot accent, white type that lands a word at a time, and content held in rounded cards with red pill labels. Built for talking-head explainers where the speaker stays on screen and graphics sit beside him.',
    source: 'If You ONLY Watch One Motion Design Video, Make It This…',
    brand: {
      voice: 'Deep maroon field, one crimson accent, white type. Words land one at a time; cards carry the content; the speaker is never covered.',
      palette: {
        accent: '#E11D2E',
        accentAlt: '#FF7A59',
        ink: '#12040A',
        surface: '#2E0A12',
        text: '#FFFFFF',
        muted: '#C9A0A8',
      },
      fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      type: { hook: 11, title: 8, subtitle: 5, body: 3.6, label: 2.4, caption: 6 },
      radius: 0.022,
      shadow: 0.5,
      motion: { entrance: 'entrance', exit: 'exit', emphasis: 'overshoot', beat: 0.45 },
    },
    materials: ['card', 'pill', 'bloom'],
    curves: ['entrance', 'overshoot', 'standard', 'exit'],
    suits: ['explainer', 'talking head', 'course', 'breakdown', 'listicle'],
    scenes: [
      {
        name: 'hook',
        about:
          'The opening of the source film: a word lands either side of the speaker, who is cut out so the type passes behind him, then the whole frame scales down into a card on the red field.',
        seconds: 3,
        parts: [
          { kind: 'word', slot: 'left-half', move: 'pop', after: 0 },
          { kind: 'subject', move: 'pop', after: 0.25 },
          { kind: 'word', slot: 'right-half', move: 'pop', after: 0.3 },
          { kind: 'line', slot: 'lower-third', move: 'rise', after: 0.6 },
          { kind: 'frame', move: 'scale-into-card', after: 1.75, material: 'card' },
        ],
      },
      {
        name: 'statement',
        about: 'One line of large white type over whatever is playing, a word at a time. Used to punctuate, never to explain.',
        seconds: 2,
        parts: [{ kind: 'statement', slot: 'centre', move: 'rise', after: 0 }],
      },
      {
        name: 'card-and-label',
        about: 'A screenshot or clip in a rounded card, with a pill naming it underneath. The pill’s words reveal after the card has settled.',
        seconds: 3.5,
        parts: [
          { kind: 'card', slot: 'centre', move: 'drop-in', after: 0, material: 'card' },
          { kind: 'label', slot: 'lower-third', move: 'rise', after: 0.35, material: 'pill' },
        ],
      },
      {
        name: 'numbered-list',
        about: 'A red numbered badge, a term and a line of explanation, items staggering in down the left, with the speaker shrunk into a corner.',
        seconds: 5,
        parts: [
          { kind: 'list', slot: 'left-half', move: 'rise', after: 0, material: 'card' },
          { kind: 'thumbnail', slot: 'bottom-right', move: 'drop-in', after: 0.2, material: 'card' },
        ],
      },
      {
        name: 'beside-speaker',
        about: 'Type on the side of the frame the speaker is not using, arriving from that edge. The layout engine picks the side.',
        seconds: 3,
        parts: [{ kind: 'title', move: 'slide-beside', after: 0 }],
      },
    ],
  },

  {
    id: 'aflow-glass',
    name: 'Aflow Glass',
    about:
      'Black to royal blue to white, glass orbs and capsules with specular highlights, thin construction arcs, and light doing the transitions — a bloom washes the frame rather than a cut. Built for identity films, product openings and anything with no talking head in it.',
    source: '[motion graphics] hi, aflow. — identity film',
    brand: {
      voice: 'Glass and light on a black-to-white gradient. Shapes morph rather than cut; a bloom carries you between scenes; one warm accent against all that blue.',
      palette: {
        accent: '#3B4FE0',
        accentAlt: '#FF8A3D',
        ink: '#05060F',
        surface: '#1A1F4A',
        text: '#FFFFFF',
        muted: '#A9B0D8',
      },
      fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      type: { hook: 7, title: 5, subtitle: 3.4, body: 2.8, label: 2, caption: 5 },
      radius: 0.5,
      shadow: 0.25,
      motion: { entrance: 'gentle', exit: 'gentle', emphasis: 'overshoot', beat: 0.75 },
    },
    materials: ['glass', 'orb', 'line', 'bloom', 'card'],
    curves: ['gentle', 'entrance', 'weighted', 'linear'],
    suits: ['identity', 'product', 'logo', 'opener', 'abstract', 'no speaker'],
    scenes: [
      {
        name: 'orb-birth',
        about:
          'A single glass orb grows from a point on black, thin arcs setting it out, then collapses back to a point and falls as a streak of light.',
        seconds: 4,
        parts: [
          { kind: 'orb', slot: 'centre', move: 'pop', after: 0, material: 'orb' },
          { kind: 'guides', slot: 'full', move: 'fade-through', after: 0.1, material: 'line' },
          { kind: 'orb', slot: 'centre', move: 'fade-through', after: 2.2 },
          { kind: 'streak', slot: 'centre', move: 'rise', after: 2.6, material: 'bloom' },
        ],
      },
      {
        name: 'cluster',
        about: 'Many orbs of different sizes gathered and overlapping, lit from within, with a flare where they meet.',
        seconds: 3.5,
        parts: [
          { kind: 'cluster', slot: 'centre', move: 'drop-in', after: 0, material: 'orb' },
          { kind: 'flare', slot: 'centre', move: 'pop', after: 0.5, material: 'bloom' },
        ],
      },
      {
        name: 'light-wash',
        about: 'The frame floods to blue and then white, and the next scene is already there when it clears. The transition of the source film.',
        seconds: 1.2,
        parts: [{ kind: 'wash', slot: 'full', move: 'pop', after: 0, material: 'bloom' }],
      },
      {
        name: 'orbit-cards',
        about: 'Translucent panels arranged in a ring around a glowing point on a reflective floor, turning slowly.',
        seconds: 5,
        parts: [
          { kind: 'ring', slot: 'centre', move: 'rise', after: 0, material: 'glass' },
          { kind: 'core', slot: 'centre', move: 'pop', after: 0.3, material: 'bloom' },
        ],
      },
      {
        name: 'wordmark',
        about: 'Everything resolves to white and the mark sits small and centred, with a last breath of light behind it.',
        seconds: 3,
        parts: [
          { kind: 'wash', slot: 'full', move: 'fade-through', after: 0, material: 'bloom' },
          { kind: 'wordmark', slot: 'centre', move: 'rise', after: 0.4 },
        ],
      },
    ],
  },
];

export const findPack = (id: string) => STYLE_PACKS.find((pack) => pack.id === id.trim().toLowerCase());

/** The catalogue the assistant reads: enough to choose, not so much that it costs a fortune. */
export const packCatalogue = () =>
  STYLE_PACKS.map((pack) => ({
    id: pack.id,
    name: pack.name,
    about: pack.about,
    suits: pack.suits,
    scenes: pack.scenes.map((scene) => ({ name: scene.name, about: scene.about, seconds: scene.seconds })),
  }));

/**
 * A pack, turned into a brand for this project. The pack decides the look; the project still
 * decides the frame, and a caption style can be pinned on top.
 */
export function brandFromPack(pack: StylePack, options: { vertical?: boolean; captionStyle?: string | null } = {}): Brand {
  const scale = options.vertical
    ? (Object.fromEntries(Object.entries(pack.brand.type).map(([key, value]) => [key, Math.round(value * 1.25 * 10) / 10])) as Brand['type'])
    : pack.brand.type;
  return {
    name: pack.name,
    voice: pack.brand.voice,
    palette: pack.brand.palette,
    fonts: pack.brand.fonts,
    type: scale,
    radius: pack.brand.radius,
    shadow: pack.brand.shadow,
    motion: pack.brand.motion,
    captionStyle: options.captionStyle ?? null,
    derivedFrom: `the ${pack.name} pack, read from ${pack.source}`,
  };
}
