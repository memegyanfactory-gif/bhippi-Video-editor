// The avatar, drawn pixel by pixel.
//
// There are no image files: the character is built from parts (hair, face, coat, arms, legs,
// props) into a 64×80 buffer, every part with its own one-pixel outline so overlapping limbs stay
// readable, then scaled up with nearest-neighbour sampling. A `Pose` is a handful of numbers
// (where the hands are, which eyes, which mouth, what is held), so every animation in poses.ts is
// just a function from time to a pose, and a new one never needs new art.
//
// The character: a chibi producer with a mane of flame-gold hair (brown-outlined, lit from the
// upper left), a teal headband, big glossy eyes, a lab coat over a teal shirt, a navy backpack and
// teal-soled trainers. Round glasses, headphones, a beret or an animator's visor go on for the
// council seat that is working.
//
// The same skeleton wears five other looks (CHARACTERS): a tabby cat, a woman with long auburn
// hair, a genie out of a lamp floating on a wisp of smoke, a floppy-eared puppy and a bearded
// senior dev in a hoodie. Each is a palette swap (LOOKS) plus its own head, hair and torso, so
// every animation plays for all of them.

export const ART_W = 64;
/** Rows below the ground line leave room for legs dangling over an edge. */
export const ART_H = 80;
/** The column the body is centred on (between pixels CX-1 and CX) and the row the soles rest on. */
export const CX = 32;
export const FEET_Y = 70;
/** Face centre row, coat collar row, and roughly the top of the tallest spike of hair. */
export const HEAD_Y = 38;
export const TORSO_Y = 51;
export const HAIR_TOP = 13;
/** The cat stands lower: the row its ear tips reach. */
export const CAT_TOP = 30;

/** A packed ABGR pixel from `#rrggbb` or a computed `rgb(…)`/`rgba(…)` (a clip's real colour); unreadable or see-through colours fall back to a clip blue. */
const rgb = (css: string): number => {
  let r = 0x6f;
  let g = 0xa8;
  let b = 0xff;
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(css.trim());
  if (hex) {
    const value = parseInt(hex[1], 16);
    r = (value >> 16) & 255;
    g = (value >> 8) & 255;
    b = value & 255;
  } else if (fn && (fn[4] === undefined || Number(fn[4]) > 0.1)) {
    r = Number(fn[1]);
    g = Number(fn[2]);
    b = Number(fn[3]);
  }
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};

export const PALETTE = {
  outline: '#221a30',
  hairOutline: '#8e3510',
  hair: '#ffab2e',
  hairLight: '#ffd052',
  hairShine: '#fff2a6',
  hairShadow: '#ee8420',
  hairDeep: '#c75a16',
  skin: '#ffdcc1',
  skinShadow: '#f3b894',
  blush: '#ff9c98',
  white: '#ffffff',
  pupil: '#1c1f40',
  iris: '#2e3a73',
  band: '#2fb9b1',
  bandLight: '#78e3d7',
  bandDark: '#1b7d85',
  coat: '#f8f9fd',
  coatShadow: '#cdd4e4',
  sleeve: '#eef1f8',
  shirt: '#33b4ae',
  shirtShadow: '#228387',
  pants: '#2d3560',
  pantsShadow: '#212646',
  shoe: '#262c4c',
  shoeLight: '#4d5a88',
  sole: '#2fb9b1',
  pack: '#2a3154',
  packLight: '#414c7c',
  badge: '#ffc23d',
  mouth: '#6a1f2e',
  tongue: '#ff6f7d',
  steel: '#c9d2e3',
  steelDark: '#8792a8',
  frame: '#1c1f40',
  /** The band just short of the hand on each arm. */
  cuff: '#cdd4e4',
  /** Fur for the animals; the genie's smoke; unused by Heli. */
  fur: '#ffab2e',
  furLight: '#ffd052',
  furShadow: '#ee8420',
  /** A character's own detail colour: ears, stripes, trim, a lanyard. */
  accent: '#2fb9b1',
  accentLight: '#78e3d7',
  accentDark: '#1b7d85',
  nose: '#ff7f9a',
} as const;

export type Character = 'heli' | 'cat' | 'woman' | 'genie' | 'puppy' | 'senior';

export const CHARACTERS: { id: Character; name: string; title: string }[] = [
  { id: 'heli', name: 'Heli', title: 'The pixel producer — flame hair, lab coat, backpack.' },
  { id: 'cat', name: 'Miso', title: 'An orange tabby on four paws: struts, loafs, swats and naps curled up.' },
  { id: 'woman', name: 'Nova', title: 'Long auburn hair, a flower clip and a pink dress.' },
  { id: 'genie', name: 'Jinn', title: 'A genie out of the lamp, floating on a wisp of smoke.' },
  { id: 'puppy', name: 'Biscuit', title: 'A floppy-eared puppy with a wagging tail.' },
  { id: 'senior', name: 'Sudo', title: 'A bearded senior dev: browline glasses, hoodie, lanyard.' },
];

/** Each character's palette, over Heli's. */
const LOOKS: Record<Character, Partial<Record<keyof typeof PALETTE, string>>> = {
  heli: {},
  cat: {
    hairOutline: '#5a2a10', skin: '#fff1dc', skinShadow: '#f1d9bb',
    fur: '#f39a3d', furLight: '#ffc26e', furShadow: '#d4772a', accentDark: '#b0561b', accent: '#ff9fb2',
    sleeve: '#f39a3d', cuff: '#d4772a', pants: '#f39a3d', pantsShadow: '#d4772a',
    shoe: '#fff1dc', shoeLight: '#ffffff', sole: '#f1d9bb', band: '#e5484d', bandDark: '#a82a35', nose: '#ff7f9a', iris: '#3f9a4a',
  },
  woman: {
    hairOutline: '#2a1210', hair: '#8a3f2c', hairLight: '#b35a3c', hairShine: '#e39a74', hairShadow: '#6a2c20', hairDeep: '#461b14',
    coat: '#e8628f', coatShadow: '#bf4470', sleeve: '#f07aa2', cuff: '#bf4470', shirt: '#e8628f',
    pants: '#3b2a4a', pantsShadow: '#2a1d36', shoe: '#bf4470', shoeLight: '#ff9cbd', sole: '#7a2446',
    mouth: '#b8325a', accent: '#ffd166', accentLight: '#fff1b8', accentDark: '#e0a82e',
  },
  genie: {
    hairOutline: '#1d1840', hair: '#262040', hairLight: '#3f3868', hairShine: '#6d63a8', hairShadow: '#1b1732', hairDeep: '#110e22',
    skin: '#5fb0f0', skinShadow: '#3f8ed6', blush: '#b58cff',
    coat: '#d8344a', coatShadow: '#a3223a', sleeve: '#5fb0f0', cuff: '#ffc23d',
    fur: '#d4ebff', furLight: '#f4faff', furShadow: '#9cc4ee', accent: '#8a4fd8', accentLight: '#b98cff', accentDark: '#5e2fa8',
  },
  puppy: {
    hairOutline: '#4a2c16', skin: '#fff3e2', skinShadow: '#f2dcc0',
    fur: '#e8b77a', furLight: '#f7d4a0', furShadow: '#c98f52', accent: '#8a5a36', accentLight: '#a8744a', accentDark: '#5f3b20',
    sleeve: '#e8b77a', cuff: '#c98f52', pants: '#e8b77a', pantsShadow: '#c98f52',
    shoe: '#fff3e2', shoeLight: '#ffffff', sole: '#f2dcc0', band: '#3c7be0', bandDark: '#23519e', nose: '#2a1d1d',
  },
  senior: {
    hairOutline: '#3e4250', hair: '#b9bcc6', hairLight: '#d9dce4', hairShine: '#f2f3f7', hairShadow: '#8f94a2', hairDeep: '#6b7080',
    skin: '#f3c9a6', skinShadow: '#e0a883',
    coat: '#434b5e', coatShadow: '#2f3545', sleeve: '#4b5468', cuff: '#2f3545',
    pants: '#3e5f8a', pantsShadow: '#2e4868', shoe: '#e8ebf2', shoeLight: '#ffffff', sole: '#9aa3b5',
    accent: '#e5484d', accentLight: '#ffffff', accentDark: '#2d7fd3',
  },
};

type Key = keyof typeof PALETTE;
type Colours = Record<Key, number>;
const build = (id: Character, own: Partial<Record<Key, string>> = {}) =>
  Object.fromEntries(Object.entries({ ...PALETTE, ...LOOKS[id], ...own }).map(([key, hex]) => [key, rgb(hex)])) as Colours;
const COLOURS = Object.fromEntries((Object.keys(LOOKS) as Character[]).map((id) => [id, build(id)])) as Record<Character, Colours>;

/** `hex` mixed towards white (amount > 0) or black (amount < 0). */
const tint = (hex: string, amount: number) => {
  const value = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `#${[(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * One colour the user can change on a character (Settings › Avatar): the swatch sets the first
 * palette key, and the rest follow as lighter or darker shades of it, so the shading still reads.
 */
export type ColourSlot = { id: string; label: string; keys: [Key, number][] };
const HAIR: [Key, number][] = [['hair', 0], ['hairLight', 0.3], ['hairShine', 0.65], ['hairShadow', -0.12], ['hairDeep', -0.3], ['hairOutline', -0.6]];
const SKIN: ColourSlot = { id: 'skin', label: 'Skin', keys: [['skin', 0], ['skinShadow', -0.1]] };
const EYES: ColourSlot = { id: 'eyes', label: 'Eyes', keys: [['iris', 0]] };
export const COLOUR_SLOTS: Record<Character, ColourSlot[]> = {
  heli: [
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'band', label: 'Headband', keys: [['band', 0], ['bandLight', 0.4], ['bandDark', -0.3], ['sole', 0]] },
    { id: 'coat', label: 'Coat', keys: [['coat', 0], ['coatShadow', -0.15], ['sleeve', -0.03], ['cuff', -0.15]] },
    { id: 'shirt', label: 'Shirt', keys: [['shirt', 0], ['shirtShadow', -0.3]] },
    { id: 'pants', label: 'Trousers', keys: [['pants', 0], ['pantsShadow', -0.25]] },
    { id: 'shoe', label: 'Shoes', keys: [['shoe', 0], ['shoeLight', 0.25]] },
    SKIN, EYES,
  ],
  cat: [
    { id: 'fur', label: 'Fur', keys: [['fur', 0], ['furLight', 0.3], ['furShadow', -0.14], ['sleeve', 0], ['cuff', -0.14], ['pants', 0], ['pantsShadow', -0.14]] },
    { id: 'stripes', label: 'Stripes', keys: [['accentDark', 0], ['hairOutline', -0.5]] },
    { id: 'cream', label: 'Chest & paws', keys: [['skin', 0], ['skinShadow', -0.06], ['shoe', 0], ['sole', -0.06]] },
    { id: 'collar', label: 'Collar', keys: [['band', 0], ['bandDark', -0.3]] },
    { id: 'nose', label: 'Nose & ears', keys: [['nose', 0], ['accent', 0.25]] },
    EYES,
  ],
  woman: [
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'dress', label: 'Dress', keys: [['coat', 0], ['coatShadow', -0.2], ['sleeve', 0.12], ['cuff', -0.2], ['shirt', 0]] },
    { id: 'pants', label: 'Leggings', keys: [['pants', 0], ['pantsShadow', -0.25]] },
    { id: 'shoe', label: 'Shoes', keys: [['shoe', 0], ['shoeLight', 0.35], ['sole', -0.35]] },
    { id: 'accent', label: 'Belt & flower', keys: [['accent', 0], ['accentLight', 0.55], ['accentDark', -0.15]] },
    SKIN, EYES,
  ],
  genie: [
    { id: 'skin', label: 'Skin', keys: [['skin', 0], ['skinShadow', -0.15], ['sleeve', 0]] },
    { id: 'vest', label: 'Vest', keys: [['coat', 0], ['coatShadow', -0.2]] },
    { id: 'sash', label: 'Sash', keys: [['accent', 0], ['accentLight', 0.3], ['accentDark', -0.3]] },
    { id: 'smoke', label: 'Smoke', keys: [['fur', 0], ['furLight', 0.5], ['furShadow', -0.15]] },
    { id: 'hair', label: 'Topknot', keys: [['hair', 0], ['hairLight', 0.15], ['hairShine', 0.35], ['hairShadow', -0.2], ['hairDeep', -0.45]] },
    EYES,
  ],
  puppy: [
    { id: 'fur', label: 'Fur', keys: [['fur', 0], ['furLight', 0.3], ['furShadow', -0.14], ['sleeve', 0], ['cuff', -0.14], ['pants', 0], ['pantsShadow', -0.14]] },
    { id: 'ears', label: 'Ears', keys: [['accent', 0], ['accentLight', 0.2], ['accentDark', -0.3]] },
    { id: 'muzzle', label: 'Muzzle & paws', keys: [['skin', 0], ['skinShadow', -0.06], ['shoe', 0], ['sole', -0.06]] },
    { id: 'collar', label: 'Collar', keys: [['band', 0], ['bandDark', -0.3]] },
    EYES,
  ],
  senior: [
    { id: 'hair', label: 'Hair & beard', keys: HAIR },
    { id: 'hoodie', label: 'Hoodie', keys: [['coat', 0], ['coatShadow', -0.25], ['sleeve', 0.05], ['cuff', -0.25]] },
    { id: 'pants', label: 'Jeans', keys: [['pants', 0], ['pantsShadow', -0.25]] },
    { id: 'shoe', label: 'Shoes', keys: [['shoe', 0], ['shoeLight', 0.5], ['sole', -0.3]] },
    SKIN, EYES,
  ],
};

/** The colour a slot starts with, before the user changes it. */
export const slotDefault = (id: Character, slot: ColourSlot): string => ({ ...PALETTE, ...LOOKS[id] } as Record<Key, string>)[slot.keys[0][0]];

/** Applies the user's colours (Settings.avatarColors: character → slot → #rrggbb) to every drawing from now on. */
export function setAvatarColours(all: Record<string, Record<string, string>> | null | undefined) {
  for (const id of Object.keys(LOOKS) as Character[]) {
    const own: Partial<Record<Key, string>> = {};
    for (const slot of COLOUR_SLOTS[id]) {
      const hex = all?.[id]?.[slot.id];
      if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
      for (const [key, amount] of slot.keys) own[key] = tint(hex, amount);
    }
    COLOURS[id] = build(id, own);
  }
}
/** The palette of the character being drawn right now (renderPose picks it). */
let C: Colours = COLOURS.heli;
const colour = (hex: string) => rgb(hex);

export type Eyes = 'open' | 'blink' | 'happy' | 'squeeze' | 'angry' | 'wide' | 'down' | 'up' | 'sleep' | 'dizzy' | 'wink' | 'focus';
export type Mouth = 'smile' | 'open' | 'laugh' | 'flat' | 'o' | 'shout' | 'grin' | 'tongue' | 'wavy' | 'cat';
export type Gear = 'glasses' | 'headphones' | 'beret' | 'visor' | 'clown-nose';

export type Prop =
  | { kind: 'scissors'; open: number }
  | { kind: 'cloth'; phase: number }
  | { kind: 'clip'; x: number; y: number; color: string; tilt?: number }
  | { kind: 'laptop'; glow: number }
  | { kind: 'clapper'; open: number }
  | { kind: 'pencil' }
  | { kind: 'flipbook'; page: number }
  | { kind: 'mixer'; phase: number }
  | { kind: 'wrench' }
  | { kind: 'magnifier' };

export type Pose = {
  /** Whole body up/down (negative is up), art pixels. */
  y: number;
  headX: number;
  headY: number;
  /** Torso shift sideways (leaning into a run or a shove). */
  lean: number;
  /** Where the pupils point: -1 left, 0 ahead, 1 right. */
  look: -1 | 0 | 1;
  eyes: Eyes;
  mouth: Mouth;
  /** Hands relative to their shoulders. */
  armL: [number, number];
  armR: [number, number];
  /** Arms drawn behind the torso (wind-ups, hands behind the back). */
  armLBack?: boolean;
  armRBack?: boolean;
  /** A raised index finger (the "no no" wag, a point, a framing gesture). */
  finger?: 'L' | 'R' | 'both';
  /** A thumb up on that hand. */
  thumb?: 'L' | 'R';
  /** Feet: sideways offset and lift off the ground. */
  legL: [number, number];
  legR: [number, number];
  /** On the edge of a panel with the legs dangling, or cross-legged on the floor. */
  sit?: 'edge' | 'floor';
  /** Hair swept by motion: -1 blown left … 1 blown right. */
  sway?: number;
  blush?: boolean;
  gear?: Gear[];
  props?: Prop[];
  /** Who is wearing the pose; Heli when unset. */
  character?: Character;
  /** The genie going to sleep in its lamp: 1 the smoke streams into the spout, 2 the last wisp, 3 inside. Other characters ignore it. */
  lamp?: 1 | 2 | 3;
  /** Asleep in the lamp and breathing out: the lid lifts and a puff leaves the spout. */
  snore?: boolean;
  /**
   * The puppy's kennel at bedtime: its centre column, the row it stands on, and how it sits with
   * the body — behind it, held in front, set down behind it, or with the puppy inside, where only
   * the doorway shows it. Other characters ignore it.
   */
  kennel?: { x: number; y: number; stage: 'behind' | 'held' | 'placed' | 'inside' };
  /** Miso on four paws: its posture, legs and tail (see CatPose). Only the cat reads it. */
  cat?: CatPose;
};

/** How the cat holds itself: up on all fours, sitting, a loaf, curled asleep, mid-stretch, mid-leap, or scruffed. */
export type CatBody = 'stand' | 'sit' | 'loaf' | 'curl' | 'stretch' | 'leap' | 'hang';
/** The tail: pointing at `a` degrees (0 straight back, 90 straight up, negative down) with a hook at the tip, or wrapped round the paws. */
export type CatTail = { a: number; curl?: number } | { wrap: true; flick?: number };
export type CatPose = {
  body: CatBody;
  /**
   * The legs, near front, far front, near back, far back. Standing: how far each foot is forward
   * and lifted off the ground. Leaping or scruffed: where each paw is from its shoulder or hip.
   */
  paws?: [number, number][];
  /** The near front paw up off the ground, this far from its shoulder: a swat, a wave, typing, washing. */
  raise?: [number, number];
  /** Claws out on the raised paw. */
  claws?: boolean;
  tail: CatTail;
  /** Ears laid back: running, cross, scruffed. */
  earsBack?: boolean;
  /** Curled up, the body swells a pixel on each breath. */
  breath?: number;
  /** A clip carried in the mouth, and how far it is lowered (0 in the mouth … 1 at the paws). */
  carry?: { color: string; drop: number };
  /** Set out in front of it: a laptop to type on, a mixer, a sketch pad. */
  desk?: 'laptop' | 'mixer' | 'pad';
  deskPhase?: number;
};

export const REST: Pose = {
  y: 0, headX: 0, headY: 0, lean: 0, look: 0, eyes: 'open', mouth: 'smile',
  armL: [-2, 7], armR: [2, 7], legL: [0, 0], legR: [0, 0], blush: true, gear: [], props: [],
};

// ── the pixel buffer ───────────────────────────────────────────────────────

class Buf {
  readonly data = new Uint32Array(ART_W * ART_H);
  clear() { this.data.fill(0); }
  at(x: number, y: number) { return x >= 0 && y >= 0 && x < ART_W && y < ART_H ? this.data[y * ART_W + x] : 0; }
  set(x: number, y: number, c: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < ART_W && y < ART_H) this.data[y * ART_W + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = Math.floor(y); j < Math.floor(y) + Math.round(h); j++) for (let i = Math.floor(x); i < Math.floor(x) + Math.round(w); i++) this.set(i, j, c);
  }
  /** Pixels whose centres fall inside the ellipse; half-integer centres stay symmetric. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }
  /** A one-pixel ring: the ellipse minus the one inside it. */
  ring(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const outer = (dx / rx) ** 2 + (dy / ry) ** 2 <= 1;
        const inner = (dx / (rx - 1)) ** 2 + (dy / (ry - 1)) ** 2 <= 1;
        if (outer && !inner) this.set(x, y, c);
      }
    }
  }
  tri(ax: number, ay: number, bx: number, by: number, qx: number, qy: number, c: number) {
    const edge = (x0: number, y0: number, x1: number, y1: number, x: number, y: number) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    const area = edge(ax, ay, bx, by, qx, qy);
    if (area === 0) return;
    for (let y = Math.floor(Math.min(ay, by, qy)); y <= Math.ceil(Math.max(ay, by, qy)); y++) {
      for (let x = Math.floor(Math.min(ax, bx, qx)); x <= Math.ceil(Math.max(ax, bx, qx)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = edge(bx, by, qx, qy, px, py) / area;
        const w1 = edge(qx, qy, ax, ay, px, py) / area;
        const w2 = edge(ax, ay, bx, by, px, py) / area;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.set(x, y, c);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number, width = 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      if (width <= 1) this.set(x, y, c);
      else this.ellipse(x, y, width / 2, width / 2, c);
    }
  }
  /** Replaces one colour with another where `test` holds. */
  recolour(from: number, to: number, test: (x: number, y: number) => boolean) {
    for (let y = 0; y < ART_H; y++) for (let x = 0; x < ART_W; x++) if (this.data[y * ART_W + x] === from && test(x, y)) this.data[y * ART_W + x] = to;
  }
}

const main = new Buf();
const scratch = new Buf();

/** Draws one part into scratch, then stamps its outline and its pixels onto the sprite. */
function part(draw: (b: Buf) => void, outline: number = C.outline, into: Buf = main) {
  scratch.clear();
  draw(scratch);
  const src = scratch.data;
  const dst = into.data;
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < ART_W; x++) {
      if (src[y * ART_W + x]) continue;
      if (scratch.at(x - 1, y) || scratch.at(x + 1, y) || scratch.at(x, y - 1) || scratch.at(x, y + 1)) dst[y * ART_W + x] = outline;
    }
  }
  for (let i = 0; i < src.length; i++) if (src[i]) dst[i] = src[i];
}

// ── the character ──────────────────────────────────────────────────────────

/** How far a sitting body drops: on an edge the seat lands on the ground line; on the floor the crossed legs do. */
const SIT_DROP = { edge: FEET_Y - 1 - (TORSO_Y + 10), floor: FEET_Y - 4 - (TORSO_Y + 10) } as const;

/**
 * The mane: tapered, curling flames around a round mass — angle (degrees, 0 = right, -90 = up),
 * length, base width, curl (tips bend clockwise when positive). Big ones first, the ones between
 * them after, so the silhouette reads as layered tufts.
 */
const SPIKES: [deg: number, length: number, width: number, curl: number][] = [
  [-94, 10.5, 6, 0.28], [-66, 10, 6, 0.34], [-122, 9.5, 6, 0.2], [-38, 8.5, 5.5, 0.36], [-150, 8.5, 5.5, 0.12],
  [-12, 7, 5, 0.38], [-174, 7, 5, 0.02], [14, 5.5, 4.5, 0.42], [164, 5.5, 4.5, -0.12], [38, 4, 4, 0.4], [142, 4, 4, -0.2],
  [-80, 6.5, 4.5, 0.3], [-108, 6.5, 4.5, 0.24], [-52, 6, 4, 0.34], [-136, 6, 4, 0.18],
];
/** Where the light comes from: the upper left. */
const LIGHT = { x: -0.55, y: -0.83 };

function drawHair(b: Buf, hx: number, hy: number, sway: number) {
  const mx = hx;
  const my = hy - 6;
  const rx = 13;
  const ry = 10.5;
  const streaks: [number, number, number, number, boolean][] = [];
  SPIKES.forEach(([deg, length, width, curl], index) => {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    const bend = curl + sway * 0.18 * Math.max(0, -dy + 0.3);
    const x0 = mx + (rx - 3.5) * dx;
    const y0 = my + (ry - 3.5) * dy;
    const x2 = x0 + dx * (length + 2) + px * bend * length;
    const y2 = y0 + dy * (length + 2) + py * bend * length;
    const x1 = x0 + dx * length * 0.6;
    const y1 = y0 + dy * length * 0.6;
    const at = (t: number): [number, number] => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const [x, y] = at(t);
      const r = (width / 2) * (1 - t) ** 0.9 + 0.3;
      b.ellipse(x, y, r, r, C.hair);
    }
    // A lit streak on the side of the big tufts facing the light, from the root halfway out.
    if (index >= 7 || dx * LIGHT.x + dy * LIGHT.y < -0.5) return;
    const lit = px * LIGHT.x + py * LIGHT.y > 0 ? 1 : -1;
    const [sx, sy] = at(0.08);
    const [ex, ey] = at(0.5);
    const off = width * 0.2 * lit;
    streaks.push([sx + px * off, sy + py * off, ex + px * off * 0.5, ey + py * off * 0.5, dx * LIGHT.x + dy * LIGHT.y > 0.55]);
  });
  b.ellipse(mx, my, rx, ry, C.hair);
  // Tone: a lit cap on the upper left of the mass, shadow on the far side, deepest at the bottom.
  b.recolour(C.hair, C.hairLight, (x, y) => {
    const ox = (x + 0.5 - mx) / rx;
    const oy = (y + 0.5 - my) / ry;
    return ox * LIGHT.x + oy * LIGHT.y > 0.35 && ox * ox + oy * oy < 0.8;
  });
  b.recolour(C.hair, C.hairShadow, (x, y) => {
    const ox = (x + 0.5 - mx) / rx;
    const oy = (y + 0.5 - my) / ry;
    return ox * -LIGHT.x + oy * -LIGHT.y > 0.62;
  });
  b.recolour(C.hairShadow, C.hairDeep, (x, y) => (y + 0.5 - my) / ry > 0.55 && Math.abs(x + 0.5 - mx) > 8.5);
  for (const [x0, y0, x1, y1, shine] of streaks) {
    // Only hair pixels take the streak, so it never spills past the silhouette.
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(x0 + ((x1 - x0) * s) / steps);
      const y = Math.floor(y0 + ((y1 - y0) * s) / steps);
      const here = b.at(x, y);
      if (here === C.hair || here === C.hairShadow) b.set(x, y, shine ? C.hairShine : C.hairLight);
    }
  }
  // Separations between the tufts: short dark strokes from the rim of the mass inwards.
  for (const deg of [-80, -108, -52, -136, -25, -162]) {
    const a = (deg * Math.PI) / 180;
    for (let k = 0; k < 3; k++) b.set(mx + (rx - 1.5 - k) * Math.cos(a), my + (ry - 1.5 - k) * Math.sin(a), C.hairDeep);
  }
  // The crown shine.
  for (const [dx, dy] of [[-6, -9], [-5, -9], [-4, -10], [-7, -8], [-3, -10]] as const) if (b.at(mx + dx, my + dy + 4)) b.set(mx + dx, my + dy + 4, C.hairShine);
}

function drawHead(b: Buf, hx: number, hy: number) {
  // Ears peek out under the hair.
  b.ellipse(hx - 9.5, hy + 2, 1.8, 2.4, C.skin);
  b.ellipse(hx + 9.5, hy + 2, 1.8, 2.4, C.skin);
  b.set(hx - 10, hy + 2, C.skinShadow);
  b.set(hx + 9, hy + 2, C.skinShadow);
  // A round face: full cheeks, narrowing to a soft chin.
  b.ellipse(hx, hy + 0.5, 9, 7, C.skin);
  b.ellipse(hx, hy + 3.2, 7.4, 6, C.skin);
  // Side locks over the temples and small tufts below the band.
  b.tri(hx - 10.5, hy - 5, hx - 6.5, hy - 5, hx - 9.8, hy + 1.5, C.hair);
  b.tri(hx + 10.5, hy - 5, hx + 6.5, hy - 5, hx + 9.8, hy + 1.5, C.hair);
  b.tri(hx - 7, hy - 5, hx - 3, hy - 5, hx - 5.5, hy - 2.2, C.hair);
  b.tri(hx + 2.5, hy - 5, hx + 6.5, hy - 5, hx + 5.5, hy - 2.5, C.hair);
  // Hair shades the brow.
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < ART_W; x++) {
      if (b.at(x, y) === C.skin && (b.at(x, y - 1) === C.hair || b.at(x, y - 1) === C.hairShadow)) b.set(x, y, C.skinShadow);
      else if (b.at(x, y) === C.hair && b.at(x, y + 1) === C.skin) b.set(x, y, C.hairShadow);
    }
  }
}

/** The teal headband, bowed to the curve of the head, with a small sun badge. */
function drawBand(hx: number, hy: number) {
  part((b) => {
    for (let x = hx - 11; x < hx + 11; x++) {
      const edge = Math.abs(x + 0.5 - hx);
      const dip = edge > 8.5 ? 1 : 0;
      const top = hy - 7 + dip;
      b.set(x, top, C.bandLight);
      b.set(x, top + 1, C.band);
      b.set(x, top + 2, C.bandDark);
    }
    b.rect(hx + 2, hy - 7, 2, 2, C.badge);
    b.set(hx + 2, hy - 7, C.white);
  }, C.pupil);
}

/** One eye in a 4×6 box whose top-left is (ox, oy). */
function eyeBox(ox: number, oy: number, eyes: Eyes, look: -1 | 0 | 1, right: boolean) {
  const px = (x: number, y: number, c: number) => main.set(ox + x, oy + y, c);
  const shape = [[1, 2], [0, 3], [0, 3], [0, 3], [0, 3], [1, 2]];
  const closedArc = (row: number, up: boolean) => {
    px(0, row + (up ? 1 : 0), C.pupil);
    px(1, row + (up ? 0 : 1), C.pupil);
    px(2, row + (up ? 0 : 1), C.pupil);
    px(3, row + (up ? 1 : 0), C.pupil);
  };
  switch (eyes) {
    case 'blink': for (let x = 0; x < 4; x++) px(x, 3, C.pupil); px(right ? 4 : -1, 2, C.pupil); return;
    case 'sleep': closedArc(3, false); return;
    case 'happy': closedArc(2, true); px(right ? 4 : -1, 4, C.pupil); return;
    case 'wink': if (right) { px(0, 1, C.pupil); px(1, 2, C.pupil); px(2, 3, C.pupil); px(1, 4, C.pupil); px(0, 5, C.pupil); return; } break;
    case 'squeeze': {
      const s = right ? -1 : 1;
      const base = right ? 3 : 0;
      px(base, 1, C.pupil); px(base + s, 2, C.pupil); px(base + 2 * s, 3, C.pupil); px(base + s, 4, C.pupil); px(base, 5, C.pupil);
      return;
    }
    case 'dizzy':
      for (const [x, y] of [[0, 1], [1, 2], [2, 3], [3, 4], [3, 1], [2, 2], [1, 3], [0, 4]]) px(x, y, C.pupil);
      return;
  }
  const dx = eyes === 'wide' ? 0 : look;
  const top = eyes === 'down' || eyes === 'focus' ? 2 : 0;
  const bottom = eyes === 'up' ? 4 : 5;
  if (eyes === 'wide') {
    // Surprised: a white eye with a small pupil.
    shape.forEach(([a, b], y) => { for (let x = a; x <= b; x++) px(x, y, y === 0 || y === 5 || x === a || x === b ? C.pupil : C.white); });
    px(1 + (right ? 1 : 0), 2, C.pupil); px(1 + (right ? 1 : 0), 3, C.pupil);
    return;
  }
  for (let y = top; y <= bottom; y++) {
    const [a, b] = shape[y];
    for (let x = a; x <= b; x++) px(x + dx, y, y >= 4 ? C.iris : C.pupil);
  }
  if (eyes === 'down' || eyes === 'focus') for (let x = 0; x < 4; x++) px(x + dx, top - 1, C.pupil);
  // Catch-lights keep the eye alive: a big one high on the light side, a small one low opposite.
  const hi = top + (eyes === 'up' ? 0 : 1);
  px(1 + dx, hi, C.white);
  if (top === 0) { px(2 + dx, hi, C.white); px(1 + dx, hi + 1, C.white); }
  if (bottom >= 4) px(3 + dx - (right ? 0 : 1), bottom - 1, C.white);
  if (eyes === 'angry' || eyes === 'focus') {
    // Brows slanting down towards the nose.
    for (let x = -1; x <= 4; x++) px(x, right ? (x <= 1 ? -1 : -2) : (x <= 1 ? -2 : -1), C.hairDeep);
  }
}

function drawFace(hx: number, hy: number, pose: Pose) {
  const x0 = Math.round(hx);
  const eyeY = Math.round(hy - 2);
  if (pose.blush && pose.character !== 'senior') for (const x of [x0 - 9, x0 - 8, x0 + 7, x0 + 8]) main.set(x, hy + 4, C.blush);
  eyeBox(x0 - 7, eyeY, pose.eyes, pose.look, false);
  eyeBox(x0 + 3, eyeY, pose.eyes, pose.look, true);
  const m = (x: number, y: number, c: number = C.mouth) => main.set(x0 + x, Math.round(hy) + 5 + y, c);
  switch (pose.mouth) {
    case 'smile': m(-2, 0); m(-1, 1); m(0, 1); m(1, 0); break;
    case 'cat': m(-3, 0); m(-2, 1); m(-1, 0); m(0, 0); m(1, 1); m(2, 0); break;
    case 'flat': for (let x = -2; x <= 1; x++) m(x, 1); break;
    case 'o': m(-1, 0); m(0, 0); m(-2, 1); m(1, 1); m(-1, 2); m(0, 2); m(-1, 1, C.tongue); m(0, 1, C.tongue); break;
    case 'wavy': m(-3, 1); m(-2, 0); m(-1, 1); m(0, 0); m(1, 1); m(2, 0); break;
    case 'tongue': m(-2, 0); m(-1, 1); m(0, 1); m(1, 0); m(1, 1, C.tongue); m(1, 2, C.tongue); break;
    case 'grin':
      for (let x = -3; x <= 2; x++) { m(x, 0); m(x, 2); }
      m(-3, 1); m(2, 1); for (let x = -2; x <= 1; x++) m(x, 1, C.white);
      break;
    case 'open':
      for (let x = -2; x <= 1; x++) m(x, 0);
      m(-2, 1); m(1, 1); m(-1, 1, C.tongue); m(0, 1, C.tongue); m(-1, 2); m(0, 2);
      break;
    case 'shout':
      for (let x = -2; x <= 1; x++) { m(x, 0); m(x, 3); }
      m(-3, 1); m(2, 1); m(-3, 2); m(2, 2);
      for (let x = -2; x <= 1; x++) { m(x, 1); m(x, 2, C.tongue); }
      break;
    case 'laugh':
      for (let x = -3; x <= 2; x++) m(x, 0);
      m(-3, 1); m(2, 1); for (let x = -2; x <= 1; x++) m(x, 1);
      m(-2, 2); m(1, 2); m(-1, 2, C.tongue); m(0, 2, C.tongue);
      m(-1, 3); m(0, 3);
      break;
  }
}

function drawGear(hx: number, hy: number, gear: Gear[]) {
  if (gear.includes('beret')) {
    part((b) => {
      b.ellipse(hx - 2, hy - 13, 10, 3.8, colour('#c83a3a'));
      b.ellipse(hx - 4, hy - 14, 5.5, 1.6, colour('#e25757'));
      b.rect(hx - 2, hy - 18, 2, 2, colour('#c83a3a'));
    });
  }
  if (gear.includes('visor')) {
    // A green eyeshade brim clipped under the headband.
    part((b) => {
      b.ellipse(hx - 0.5, hy - 4, 8.5, 2.2, colour('#3ecf8e'));
      b.rect(hx - 8, hy - 5, 15, 1, colour('#8ff5c4'));
      b.rect(hx - 6, hy - 3, 11, 1, colour('#23996a'));
    });
  }
  if (gear.includes('clown-nose')) {
    // The Comedian's red nose, sitting between the eyes and the mouth, with a glint.
    part((b) => {
      b.ellipse(hx - 0.5, hy + 2.5, 2.2, 2, colour('#e23b3b'));
      b.set(hx - 1, hy + 1, colour('#ff9c9c'));
    });
  }
  if (gear.includes('headphones')) {
    part((b) => {
      const band = colour('#3a3350');
      for (let t = 0; t <= 60; t++) {
        const a = Math.PI + (t / 60) * Math.PI;
        b.ellipse(hx + Math.cos(a) * 11.5, hy + 1 + Math.sin(a) * 15, 1.2, 1.2, band);
      }
      b.ellipse(hx - 11, hy + 2, 2.6, 3.8, colour('#b57bff'));
      b.ellipse(hx + 11, hy + 2, 2.6, 3.8, colour('#b57bff'));
      b.set(hx - 12, hy, colour('#e0c4ff'));
      b.set(hx + 10, hy, colour('#e0c4ff'));
    });
  }
  if (gear.includes('glasses')) {
    // Big round frames that fill the face, touching at the bridge; a glint on each lens.
    const x0 = Math.round(hx);
    const cy = Math.round(hy - 2) + 3;
    main.ring(x0 - 5, cy, 4.3, 4.3, C.frame);
    main.ring(x0 + 5, cy, 4.3, 4.3, C.frame);
    main.set(x0 - 1, cy - 1, C.frame);
    main.set(x0, cy - 1, C.frame);
    main.set(x0 - 10, cy - 1, C.frame);
    main.set(x0 + 9, cy - 1, C.frame);
    for (const lens of [x0 - 5, x0 + 5]) {
      main.set(lens + 2, cy - 3, colour('#d8f1ff'));
      main.set(lens + 3, cy - 2, colour('#d8f1ff'));
    }
  }
}

/** The backpack, peeking out behind the left of the coat. */
function drawPack(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 11, ty + 2, 6, 9, C.pack);
    b.rect(bx - 10, ty + 1, 4, 1, C.pack);
    b.rect(bx - 11, ty + 2, 5, 2, C.packLight);
    b.rect(bx - 11, ty + 6, 3, 3, C.packLight);
    b.set(bx - 10, ty + 7, C.badge);
  });
}

function drawLegs(pose: Pose, torsoY: number) {
  const hip = torsoY + 10;
  const bx = CX + pose.lean;
  if (pose.sit === 'floor') {
    // Cross-legged: knees out to the sides, feet tucked in at the front.
    part((b) => {
      b.ellipse(bx, hip + 1.5, 12.5, 2.8, C.pants);
      b.rect(bx - 11, hip + 2, 22, 1, C.pantsShadow);
      for (const [x, flip] of [[bx - 11, 1], [bx + 6, -1]] as const) {
        b.rect(x, hip + 2, 5, 2, C.shoe);
        b.rect(x, hip + 4, 5, 1, C.sole);
        b.set(flip > 0 ? x + 1 : x + 3, hip + 2, C.shoeLight);
      }
    });
    return;
  }
  // Left leg columns CX-5…CX-3 and right CX+2…CX+4 mirror each other around the centre line.
  const legs = [[CX - 5, pose.legL, -2], [CX + 2, pose.legR, 0]] as const;
  part((b) => {
    if (pose.sit === 'edge') {
      // On an edge: thighs towards the viewer, shins and shoes dangling over it.
      for (const [x0, [dx], out] of legs) {
        b.rect(x0, hip, 3, 2, C.pants);
        for (let y = hip + 2; y <= hip + 6; y++) b.rect(x0 + (y > hip + 4 ? dx : 0), y, 3, 1, C.pants);
        b.rect(x0 + dx + out, hip + 7, 5, 2, C.shoe);
        b.rect(x0 + dx + out, hip + 9, 5, 1, C.sole);
        b.set(x0 + dx + (out ? 1 : 3), hip + 7, C.shoeLight);
      }
      return;
    }
    for (const [x0, [dx, lift], out] of legs) {
      const sole = FEET_Y - 1 - lift + Math.min(0, pose.y);
      const bottom = sole - 3;
      for (let y = hip; y <= bottom; y++) {
        const off = Math.round((dx * (y - hip)) / Math.max(1, bottom - hip));
        b.rect(x0 + off, y, 3, 1, y === bottom ? C.pantsShadow : C.pants);
      }
      b.rect(x0 + dx + out, sole - 2, 5, 2, C.shoe);
      b.rect(x0 + dx + out, sole, 5, 1, C.sole);
      b.set(x0 + dx + (out ? 1 : 3), sole - 2, C.shoeLight);
    }
  });
}

/** Coat half-widths per row from the collar down (symmetric: columns bx-h … bx+h-1). */
const COAT = [5, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9];

function drawTorso(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 2, ty - 2, 4, 3, C.skin);
    b.rect(bx - 2, ty - 2, 4, 1, C.skinShadow);
    COAT.forEach((h, r) => {
      b.rect(bx - h, ty + r, h * 2, 1, r === COAT.length - 1 ? C.coatShadow : C.coat);
      if (r > 1) b.set(bx + h - 1, ty + r, C.coatShadow);
    });
    // The open coat: a teal shirt (a V of skin at the neck), lapel edges, trousers between the flaps.
    for (let r = 0; r < COAT.length; r++) {
      const shirt = r < 8 ? (r === 0 ? C.skin : r === 1 ? C.shirtShadow : C.shirt) : C.pants;
      b.rect(bx - 2, ty + r, 4, 1, shirt);
      if (r === 1) b.rect(bx - 1, ty + r, 2, 1, C.skin);
      if (r < 8) { b.set(bx - 3, ty + r, C.coatShadow); b.set(bx + 2, ty + r, C.coatShadow); }
    }
    // Strap of the backpack over the left shoulder; the sun badge and a pen on the chest.
    for (let r = 0; r < 6; r++) b.set(bx - 5, ty + r, C.pack);
    b.rect(bx + 4, ty + 3, 2, 2, C.badge);
    b.set(bx + 4, ty + 3, C.hairShine);
    b.set(bx - 6, ty + 5, colour('#2d7fd3'));
    b.set(bx - 6, ty + 6, colour('#2d7fd3'));
    b.rect(bx - 7, ty + 7, 3, 1, C.coatShadow);
  });
}

function drawArm(shoulderX: number, shoulderY: number, [dx, dy]: [number, number], finger: boolean, thumb: boolean, side: -1 | 1) {
  const hx = shoulderX + dx;
  const hy = shoulderY + dy;
  part((b) => {
    b.line(shoulderX, shoulderY, hx, hy, C.sleeve, 3.4);
    // The cuff, a shade darker, just short of the hand.
    const len = Math.hypot(dx, dy) || 1;
    b.ellipse(hx - (dx / len) * 1.8, hy - (dy / len) * 1.8, 1.5, 1.5, C.cuff);
    b.ellipse(hx, hy, 2.1, 2.1, C.skin);
    if (finger) { b.set(hx, hy - 2, C.skin); b.set(hx, hy - 3, C.skin); b.set(hx, hy - 4, C.skin); }
    if (thumb) { b.set(hx - side, hy - 2, C.skin); b.set(hx - side, hy - 3, C.skin); b.set(hx - side, hy - 4, C.skin); }
  });
  return [hx, hy] as const;
}

/** A film clip: sprocketed frame, a little landscape inside tinted with the clip's colour. */
function drawClip(b: Buf, x: number, y: number, color: string) {
  const frame = colour('#2a2f4a');
  b.rect(x, y, 16, 11, frame);
  for (let i = 1; i < 16; i += 3) { b.set(x + i, y + 1, C.white); b.set(x + i, y + 9, C.white); }
  const sky = colour(color);
  b.rect(x + 1, y + 3, 14, 5, sky);
  b.tri(x + 1, y + 8, x + 6, y + 3.5, x + 11, y + 8, colour('#3fae6b'));
  b.tri(x + 6, y + 8, x + 11, y + 4.5, x + 15, y + 8, colour('#2e8f58'));
  b.set(x + 6, y + 4, C.white);
  b.set(x + 12, y + 4, colour('#ffe27a'));
}

function drawProp(prop: Prop, hands: { l: readonly [number, number]; r: readonly [number, number] }, bx: number) {
  const [rx, ry] = hands.r;
  const [lx, ly] = hands.l;
  switch (prop.kind) {
    case 'scissors':
      part((b) => {
        // Two blades from a pivot: wide open, or snapped shut with just a sliver between them.
        const spread = 0.6 + prop.open * 3.4;
        b.line(rx + 3, ry, rx + 12, ry - spread, C.steel, 1.6);
        b.line(rx + 3, ry, rx + 12, ry + spread, C.steelDark, 1.6);
        b.set(rx + 11, ry - spread, C.white);
        b.ring(rx - 0.5, ry - 2.5, 2.2, 2.2, colour('#e5484d'));
        b.ring(rx - 0.5, ry + 2.5, 2.2, 2.2, colour('#e5484d'));
        b.set(rx + 3, ry, C.pupil);
      });
      break;
    case 'cloth':
      part((b) => {
        const sway = Math.round(Math.sin(prop.phase * Math.PI * 2) * 1.5);
        b.rect(rx - 3, ry - 2, 7, 5, colour('#8fdcff'));
        b.tri(rx - 3, ry + 3, rx + 4, ry + 3, rx + sway, ry + 8, colour('#8fdcff'));
        b.line(rx - 3, ry, rx + 3, ry, colour('#d4f3ff'));
        b.line(rx - 1, ry + 3, rx + sway, ry + 6, colour('#5fb7e8'));
      });
      break;
    case 'clip':
      part((b) => drawClip(b, prop.x, prop.y, prop.color));
      break;
    case 'laptop':
      part((b) => {
        // The lid seen from behind (silver, a glowing sun logo) over the lap.
        const base = Math.max(ly, ry) + 7;
        b.rect(bx - 7, base - 9, 14, 9, colour('#c3cad8'));
        b.rect(bx - 7, base - 9, 14, 1, colour('#e6eaf2'));
        b.rect(bx + 5, base - 8, 2, 8, colour('#a3abbd'));
        // The Bhippi sun on the lid, brighter while a page loads.
        const glow = prop.glow > 0.5 ? C.hairShine : C.hairLight;
        b.rect(bx - 2, base - 6, 3, 3, glow);
        for (const [dx, dy] of [[-2, -1], [2, -1], [0, -3], [0, 1]] as const) b.set(bx - 1 + dx, base - 5 + dy, glow);
        b.rect(bx - 8, base, 16, 2, colour('#6b7389'));
        b.rect(bx - 8, base, 16, 1, colour('#8a92a8'));
      });
      break;
    case 'clapper':
      part((b) => {
        b.rect(rx - 1, ry - 3, 10, 7, colour('#2b2b33'));
        for (let x = 0; x < 10; x += 3) b.rect(rx - 1 + x, ry - 1, 1, 4, C.white);
        const lift = prop.open * 5;
        for (let i = 0; i <= 9; i++) b.set(rx - 1 + i, ry - 4 - (lift * i) / 9, i % 3 === 0 ? C.white : colour('#2b2b33'));
        for (let i = 0; i <= 9; i++) b.set(rx - 1 + i, ry - 5 - (lift * i) / 9, i % 3 === 1 ? C.white : colour('#2b2b33'));
      });
      break;
    case 'pencil':
      part((b) => {
        b.line(rx + 3, ry - 5, rx - 2, ry + 2, colour('#ffc23d'), 2);
        b.set(rx + 4, ry - 6, colour('#ff8fa3'));
        b.set(rx - 3, ry + 3, C.pupil);
      });
      break;
    case 'flipbook':
      part((b) => {
        // A spiral notepad; the running figure on the page changes with every flip.
        // An orange-backed sketch pad, so it reads against the white coat.
        const x = lx - 3;
        const y = ly - 9;
        b.rect(x - 1, y, 13, 11, colour('#ff7a45'));
        b.rect(x, y + 1, 11, 9, colour('#fff4cf'));
        for (let i = 0; i < 12; i += 2) b.set(x + i, y, C.steelDark);
        b.rect(x, y + 9, 11, 1, colour('#e6d6a8'));
        const ink = colour('#8a8fa8');
        const f = Math.floor(prop.page) % 2;
        const fx = x + 5 + (Math.floor(prop.page) % 4 < 2 ? 0 : 1);
        b.set(fx, y + 2, ink);
        b.set(fx, y + 3, ink); b.set(fx, y + 4, ink);
        b.set(fx - 1, y + 3, ink); b.set(fx + 1, y + 4 - f, ink);
        b.set(fx - 1, y + 5 + f, ink); b.set(fx - 1 - f, y + 6, ink);
        b.set(fx + 1, y + 5, ink); b.set(fx + 1 + (1 - f), y + 6, ink);
        if (Math.floor(prop.page * 2) % 2) b.tri(x + 7, y + 1, x + 11, y + 1, x + 11, y + 5, C.coatShadow);
      });
      break;
    case 'mixer':
      part((b) => {
        const top = Math.max(ly, ry) + 1;
        b.rect(bx - 11, top, 22, 6, colour('#2f2f3a'));
        b.rect(bx - 11, top, 22, 1, colour('#4a4a5a'));
        const knobs = ['#e5484d', '#3ecf8e', '#ffc23d', '#4fb3ff'];
        knobs.forEach((k, i) => { b.set(bx - 9 + i * 3, top + 2, colour(k)); b.set(bx - 9 + i * 3, top + 4, colour('#6b6b80')); });
        for (let i = 0; i < 4; i++) {
          const level = Math.max(1, Math.round(2.5 + Math.sin(prop.phase * 6 + i * 1.7) * 2));
          b.rect(bx + 2 + i * 2, top + 5 - level, 1, level, colour(level > 3 ? '#e5484d' : level > 2 ? '#ffc23d' : '#3ecf8e'));
        }
      });
      break;
    case 'wrench':
      part((b) => {
        b.line(rx, ry, rx + 5, ry - 6, C.steel, 2);
        b.rect(rx + 4, ry - 9, 4, 2, C.steel);
        b.set(rx + 5, ry - 9, 0);
      });
      break;
    case 'magnifier':
      part((b) => {
        b.line(rx, ry, rx + 2, ry - 2, colour('#7a5230'), 2);
        b.ellipse(rx + 5, ry - 5, 3.5, 3.5, C.steelDark);
        b.ellipse(rx + 5, ry - 5, 2.5, 2.5, colour('#bfe6ff'));
        b.set(rx + 4, ry - 7, C.white);
      });
      break;
  }
}

// ── the other characters ───────────────────────────────────────────────────

/** Lights the upper left of a round mass and shades its far side, the way the mane is lit. */
function shade(b: Buf, base: number, light: number, dark: number, cx: number, cy: number, rx: number, ry: number) {
  b.recolour(base, light, (x, y) => {
    const ox = (x + 0.5 - cx) / rx;
    const oy = (y + 0.5 - cy) / ry;
    return ox * LIGHT.x + oy * LIGHT.y > 0.45 && ox * ox + oy * oy < 0.75;
  });
  b.recolour(base, dark, (x, y) => ((x + 0.5 - cx) / rx) * -LIGHT.x + ((y + 0.5 - cy) / ry) * -LIGHT.y > 0.6);
}

/** A stroke along a quadratic curve whose radius goes from r0 to r1 (tails, a topknot, smoke). */
function strand(b: Buf, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r0: number, r1: number, c: number) {
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const r = r0 + (r1 - r0) * t;
    b.ellipse((1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2, r, r, c);
  }
}

/** Skin just under hair takes a shadow, and hair just over skin darkens, as on Heli's brow. */
function browShadow(b: Buf) {
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < ART_W; x++) {
      if (b.at(x, y) === C.skin && (b.at(x, y - 1) === C.hair || b.at(x, y - 1) === C.hairShadow)) b.set(x, y, C.skinShadow);
    }
  }
}

/** The cat: pointed ears with pink insides, cheek fluff, tabby stripes and a cream muzzle. */
function drawCatHead(b: Buf, hx: number, hy: number, sway: number, earsBack = false) {
  const tip = Math.round(sway);
  if (earsBack) {
    // Laid back and out to the sides: cross, scruffed, or running flat out.
    b.tri(hx - 10, hy - 1, hx - 3.5, hy - 7.5, hx - 14.5, hy - 9 + tip, C.fur);
    b.tri(hx + 10, hy - 1, hx + 3.5, hy - 7.5, hx + 14.5, hy - 9 - tip, C.fur);
  } else {
    b.tri(hx - 10.5, hy - 2, hx - 2.5, hy - 7.5, hx - 8.5 + tip, hy - 15, C.fur);
    b.tri(hx + 10.5, hy - 2, hx + 2.5, hy - 7.5, hx + 8.5 + tip, hy - 15, C.fur);
  }
  b.ellipse(hx, hy + 0.5, 10.5, 8.5, C.fur);
  b.tri(hx - 9, hy + 1, hx - 7, hy + 6, hx - 12.5, hy + 5, C.fur);
  b.tri(hx + 9, hy + 1, hx + 7, hy + 6, hx + 12.5, hy + 5, C.fur);
  shade(b, C.fur, C.furLight, C.furShadow, hx, hy, 11, 9);
  if (earsBack) {
    b.tri(hx - 9, hy - 3, hx - 5, hy - 6.5, hx - 12, hy - 7.5, C.accent);
    b.tri(hx + 9, hy - 3, hx + 5, hy - 6.5, hx + 12, hy - 7.5, C.accent);
  } else {
    b.tri(hx - 8.5, hy - 5.5, hx - 4.5, hy - 7.5, hx - 7.8 + tip, hy - 12, C.accent);
    b.tri(hx + 8.5, hy - 5.5, hx + 4.5, hy - 7.5, hx + 7.8 + tip, hy - 12, C.accent);
  }
  for (const x of [hx - 4, hx - 1, hx + 2]) { b.set(x, hy - 7, C.accentDark); b.set(x, hy - 6, C.accentDark); }
  b.set(hx - 1, hy - 5, C.accentDark);
  for (const x of [hx - 10, hx - 9, hx + 8, hx + 9]) b.set(x, hy + 1, C.accentDark);
  b.ellipse(hx, hy + 5.5, 4.5, 2.8, C.skin);
}

/** The puppy: a round tan head with a tuft on top and a cream muzzle; the ears come after. */
function drawPuppyHead(b: Buf, hx: number, hy: number) {
  b.ellipse(hx, hy + 0.5, 10, 8.5, C.fur);
  b.tri(hx - 2.5, hy - 7, hx + 2.5, hy - 7, hx - 1, hy - 11.5, C.fur);
  shade(b, C.fur, C.furLight, C.furShadow, hx, hy, 10, 9);
  b.ellipse(hx, hy + 5.5, 5, 3, C.skin);
}

/** Floppy ears hanging over the sides of the head, swinging with the motion. */
function drawPuppyEars(hx: number, hy: number, sway: number) {
  part((b) => {
    for (const s of [-1, 1]) {
      b.ellipse(hx + s * 8.5, hy - 5.5, 3.2, 2.5, C.accent);
      b.ellipse(hx + s * 10.5 + sway, hy + 1.5, 3, 6.5, C.accent);
      b.ellipse(hx + s * 10 + sway, hy + 0.5, 1.1, 3.8, C.accentLight);
    }
  }, C.hairOutline);
}

/** A tail behind the body: the cat's long curl with a dark tip, the puppy's short wagging one. */
function drawTail(pose: Pose, bx: number, ty: number, kind: 'cat' | 'puppy') {
  const wag = Math.abs(Math.round(pose.legL[0] + pose.armR[1] + pose.headY)) % 2 ? 1 : -1;
  part((b) => {
    if (kind === 'cat') {
      strand(b, bx + 5, ty + 9, bx + 15, ty + 9, bx + 12 + wag, ty - 2, 1.5, 1.2, C.fur);
      b.ellipse(bx + 12 + wag, ty - 2, 1.5, 1.5, C.accentDark);
      b.set(bx + 13 + wag, ty + 4, C.accentDark);
      b.set(bx + 14, ty + 7, C.accentDark);
    } else {
      strand(b, bx + 4, ty + 8, bx + 11, ty + 8, bx + 10 + wag * 2, ty + 1, 1.8, 1.1, C.fur);
      b.ellipse(bx + 10 + wag * 2, ty + 1, 1.3, 1.3, C.skin);
    }
  }, C.hairOutline);
}

/** A round body in fur, a cream belly, and a collar with a gold bell or tag. */
function drawFurBody(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 3, ty - 2, 6, 3, C.fur);
    COAT.forEach((h, r) => {
      b.rect(bx - h + 1, ty + r, (h - 1) * 2, 1, C.fur);
      if (r > 0) b.set(bx + h - 2, ty + r, C.furShadow);
    });
    b.ellipse(bx, ty + 6.5, 3.5, 4, C.skin);
    b.rect(bx - 4, ty, 8, 1, C.band);
    b.rect(bx - 1, ty + 1, 2, 2, C.badge);
    b.set(bx - 1, ty + 1, C.hairShine);
    b.set(bx, ty + 2, C.bandDark);
  });
}

/** Nova's long hair, behind the head and shoulders, drifting with the motion. */
function drawLongHair(hx: number, hy: number, sway: number) {
  part((b) => {
    b.ellipse(hx, hy - 3, 12, 10, C.hair);
    const drift = (t: number) => Math.round(-sway * t * 2.5);
    for (let y = hy; y <= hy + 17; y++) {
      const t = (y - hy) / 17;
      const half = Math.round(12 - t * 2);
      b.rect(hx - half + drift(t), y, half * 2, 1, C.hair);
    }
    for (const x of [-10, -7, 4, 7]) b.tri(hx + x + drift(1), hy + 18, hx + x + 3 + drift(1), hy + 18, hx + x + 1.5 + drift(1), hy + 20.5, C.hair);
    b.recolour(C.hair, C.hairShadow, (x) => x + 0.5 > hx + 7);
    for (const x of [hx - 9, hx + 8]) b.line(x, hy + 4, x + drift(1), hy + 17, C.hairDeep);
  }, C.hairOutline);
}

/** Nova's face under a rounded crown, a fringe with a few longer strands and locks framing the jaw. */
function drawWomanHead(b: Buf, hx: number, hy: number) {
  b.ellipse(hx, hy + 0.5, 9, 7, C.skin);
  b.ellipse(hx, hy + 3.2, 7.4, 6, C.skin);
  for (let y = hy - 15; y <= hy - 3; y++) {
    for (let x = hx - 12; x < hx + 12; x++) {
      const dx = x + 0.5 - hx;
      const fringe = hy - 4 + ([-6, -5, 1, 2].includes(x - hx) ? 1 : 0);
      if ((dx / 11.5) ** 2 + ((y + 0.5 - (hy - 5)) / 8.5) ** 2 <= 1 && y <= fringe) b.set(x, y, C.hair);
    }
  }
  b.rect(hx - 11, hy - 5, 3, 11, C.hair);
  b.rect(hx + 8, hy - 5, 3, 11, C.hair);
  b.tri(hx - 11, hy + 6, hx - 8, hy + 6, hx - 10, hy + 9, C.hair);
  b.tri(hx + 8, hy + 6, hx + 11, hy + 6, hx + 10, hy + 9, C.hair);
  browShadow(b);
  shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 5, 11.5, 8.5);
  for (let dx = -7; dx <= -2; dx++) {
    const y = hy - 11 + (dx < -5 ? 1 : 0);
    if (b.at(hx + dx, y)) b.set(hx + dx, y, C.hairShine);
  }
}

/** A white flower with a gold heart, clipped into Nova's hair. */
function drawFlower(hx: number, hy: number) {
  part((b) => {
    b.ellipse(hx + 7, hy - 8, 2.3, 2.3, colour('#fff6fb'));
    b.rect(hx + 6, hy - 9, 2, 2, C.accent);
    b.set(hx + 6, hy - 9, C.accentLight);
  }, C.hairOutline);
}

/** A dress: fitted top, gold belt, flared skirt with pleats, and a pendant at the neckline. */
function drawDress(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 2, ty - 2, 4, 3, C.skin);
    b.rect(bx - 2, ty - 2, 4, 1, C.skinShadow);
    const rows = [5, 6, 6, 6, 6, 6, 6, 7, 8, 9, 10, 10, 10];
    rows.forEach((h, r) => {
      b.rect(bx - h, ty + r, h * 2, 1, r === 6 ? C.accent : r === rows.length - 1 ? C.coatShadow : C.coat);
      if (r > 0 && r !== 6) b.set(bx + h - 1, ty + r, C.coatShadow);
    });
    b.rect(bx - 2, ty, 4, 1, C.skin);
    b.rect(bx - 1, ty + 1, 2, 1, C.skin);
    b.set(bx, ty + 2, C.accent);
    b.rect(bx - 1, ty + 6, 2, 1, C.accentLight);
    for (const x of [-5, -2, 1, 4]) for (let r = 8; r < 12; r++) b.set(bx + x + (r > 9 ? Math.sign(x + 0.5) : 0), ty + r, C.coatShadow);
  });
}

/** The genie: a bald blue dome, pointed ears, a floating topknot and a little goatee. */
function drawGenieHead(b: Buf, hx: number, hy: number, sway: number) {
  b.tri(hx - 8.5, hy - 1, hx - 8.5, hy + 3.5, hx - 13, hy - 3, C.skin);
  b.tri(hx + 8.5, hy - 1, hx + 8.5, hy + 3.5, hx + 13, hy - 3, C.skin);
  b.ellipse(hx, hy - 0.5, 9, 8.5, C.skin);
  b.ellipse(hx, hy + 3.2, 7.4, 6, C.skin);
  b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * -LIGHT.x + ((y + 0.5 - hy) / 9) * -LIGHT.y > 0.78);
  b.ellipse(hx, hy - 9.5, 3, 2.2, C.hair);
  strand(b, hx, hy - 10, hx + 5 - sway * 2, hy - 16, hx + 7 - sway * 3, hy - 12, 2, 0.8, C.hair);
  b.set(hx - 1, hy - 11, C.hairShine);
  b.set(hx + 2, hy - 13, C.hairLight);
  b.rect(hx - 2, hy - 8, 4, 1, C.cuff);
  b.tri(hx - 2.5, hy + 8.5, hx + 2.5, hy + 8.5, hx, hy + 12.5, C.hair);
  for (const [dx, dy] of [[-5, -4], [-4, -5], [-3, -6], [-2, -6]] as const) b.set(hx + dx, hy + dy, colour('#bfe3ff'));
}

/** A red vest open over a bare blue chest, gold trim, and a purple sash knotted at the hip. */
function drawVest(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 2, ty - 2, 4, 3, C.skin);
    b.rect(bx - 2, ty - 2, 4, 1, C.skinShadow);
    COAT.forEach((h, r) => {
      b.rect(bx - h, ty + r, h * 2, 1, r >= 8 ? C.accent : C.coat);
      if (r >= 8) return;
      const open = r < 2 ? 2 : 3;
      b.rect(bx - open, ty + r, open * 2, 1, C.skin);
      b.set(bx + open - 1, ty + r, C.skinShadow);
      b.set(bx - open - 1, ty + r, C.cuff);
      b.set(bx + open, ty + r, C.cuff);
      b.set(bx + h - 1, ty + r, C.coatShadow);
    });
    b.rect(bx - 8, ty + 8, 16, 1, C.accentLight);
    b.rect(bx + 3, ty + 9, 2, 4, C.accentDark);
    b.set(bx + 5, ty + 12, C.accentDark);
  });
}

/** Below the sash the genie is a wisp of smoke, pouring out of the spout of a gold lamp. */
function drawSmoke(pose: Pose, torsoY: number) {
  const hip = torsoY + 9;
  const bx = CX + pose.lean;
  if (pose.sit) {
    // Sitting, the smoke pools under it (on the floor) or trails over the edge.
    part((b) => {
      if (pose.sit === 'floor') {
        b.ellipse(bx, hip + 3, 11.5, 3, C.fur);
        b.ellipse(bx + 5, hip + 3.5, 4, 1.6, C.furShadow);
        b.ellipse(bx - 5, hip + 2, 4, 1.2, C.furLight);
      } else {
        strand(b, bx, hip + 1, bx + 3, hip + 6, bx - 1 + pose.legL[0], hip + 10, 6, 1.2, C.fur);
        b.recolour(C.fur, C.furShadow, (x) => x + 0.5 > bx + 3);
      }
    });
    return;
  }
  const lift = Math.max(pose.legL[1], pose.legR[1]);
  const foot = FEET_Y - 1 - lift + Math.min(0, pose.y);
  const lx = bx - 1 + Math.round((pose.legL[0] - pose.legR[0]) * 0.8);
  const spout: [number, number] = [lx + 8, foot - 5];
  part((b) => {
    strand(b, spout[0], spout[1], bx + 14, (spout[1] + hip) / 2 - 1, bx + 1, hip + 1, 1, 6, C.fur);
    b.recolour(C.fur, C.furShadow, (x, y) => x + 0.5 > bx + 3 + (y - hip) * 0.3);
    b.recolour(C.fur, C.furLight, (x, y) => x + 0.5 < bx - 2 && y < hip + 5);
    for (const [dx, dy] of [[4, 5], [5, 6], [6, 7], [-2, 3], [-1, 4]] as const) if (b.at(bx + dx, hip + dy)) b.set(bx + dx, hip + dy, C.furLight);
  });
  const gold = colour('#ffc23d');
  const goldLight = colour('#ffe58a');
  const goldDark = colour('#c98a1a');
  part((b) => {
    b.ellipse(lx, foot - 2, 5, 2.2, gold);
    b.rect(lx - 2, foot, 4, 1, goldDark);
    b.line(lx + 4, foot - 2, spout[0], spout[1], gold, 1.6);
    b.ring(lx - 6, foot - 3, 2, 2, gold);
    b.rect(lx - 2, foot - 5, 4, 1, goldLight);
    b.set(lx - 1, foot - 6, goldLight);
    b.rect(lx - 4, foot - 3, 2, 1, goldLight);
    b.rect(lx - 3, foot - 1, 7, 1, goldDark);
  });
}

/** The genie asleep: only its lamp stands on the floor, drawn larger, with the smoke going in or puffing out. */
function drawSleepingLamp(pose: Pose) {
  const gold = colour('#ffc23d');
  const goldLight = colour('#ffe58a');
  const goldDark = colour('#c98a1a');
  const cx = CX - 2;
  const foot = FEET_Y - 1;
  const tip: [number, number] = [cx + 13, foot - 9];
  // The smoke behind the lamp: a wide swirl pouring into the spout, then a thin last wisp.
  if (pose.lamp === 1 || pose.lamp === 2) {
    part((b) => {
      if (pose.lamp === 1) strand(b, cx + 2, TORSO_Y - 4, cx + 24, foot - 24, tip[0], tip[1], 4.5, 1, C.fur);
      else strand(b, cx + 16, foot - 24, cx + 20, foot - 14, tip[0], tip[1], 2.6, 1, C.fur);
      b.recolour(C.fur, C.furShadow, (x) => x + 0.5 > cx + 17);
      b.recolour(C.fur, C.furLight, (x, y) => x + 0.5 < cx + 13 && y < foot - 16);
    });
  }
  const lid = pose.snore ? 1 : 0;
  part((b) => {
    b.ring(cx - 9, foot - 6, 2.5, 2.5, gold);
    b.line(cx + 6, foot - 5, tip[0], tip[1], gold, 2);
    b.ellipse(cx, foot - 5, 8, 3.6, gold);
    b.rect(cx - 3, foot - 2, 6, 1, gold);
    b.rect(cx - 4, foot - 1, 8, 1, goldDark);
    b.rect(cx - 2, foot - 9, 4, 1, goldDark);
    b.ellipse(cx, foot - 10 - lid, 3.6, 1.4, gold);
    b.rect(cx - 1, foot - 12 - lid, 2, 1, goldLight);
    b.recolour(gold, goldDark, (x, y) => y + 0.5 > foot - 3.5 || (x + 0.5 > cx + 5 && y + 0.5 > foot - 6));
    b.recolour(gold, goldLight, (x, y) => x + 0.5 < cx - 1 && x + 0.5 > cx - 6 && y + 0.5 < foot - 6 && y + 0.5 > foot - 8);
  });
  if (pose.lamp === 3 && pose.snore) {
    part((b) => {
      b.ellipse(tip[0] + 3, tip[1] - 4, 2, 1.6, C.fur);
      b.set(tip[0] + 1, tip[1] - 2, C.fur);
      b.set(tip[0] + 2, tip[1] - 5, C.furLight);
    });
  }
}

const kennelBuf = new Buf();
/** The kennel's doorway; the one colour a puppy inside shows through. */
const KENNEL_DOOR = colour('#24171a');

/** A little red kennel seen from the front: plank walls, a slate gable roof, a name plate and an arched door. */
function drawKennel(b: Buf, cx: number, bottom: number) {
  const wall = colour('#d9573f');
  const wallLight = colour('#ef7c5e');
  const wallDark = colour('#a93b2c');
  const roof = colour('#3f4a78');
  const roofLight = colour('#5b6aa6');
  const roofDark = colour('#2c3458');
  const top = bottom - 14;
  b.tri(cx - 16.5, top + 1.5, cx + 16.5, top + 1.5, cx, top - 13, roof);
  b.tri(cx - 11.5, top + 1.5, cx + 11.5, top + 1.5, cx, top - 8, wall);
  b.rect(cx - 12, top, 24, 15, wall);
  for (let y = top + 4; y < bottom; y += 4) b.rect(cx - 12, y, 24, 1, wallDark);
  b.recolour(wall, wallLight, (x, y) => x + 0.5 < cx - 8 && y > top);
  b.recolour(wall, wallDark, (x) => x + 0.5 > cx + 8);
  b.recolour(roof, roofLight, (x, y) => x + 0.5 < cx && y < top - 2);
  b.recolour(roof, roofDark, (x, y) => x + 0.5 > cx + 2 || y >= top);
  b.rect(cx - 3, top - 5, 6, 2, colour('#fff1c9'));
  b.set(cx - 3, top - 5, C.white);
  b.rect(cx - 8, bottom - 7, 16, 8, wallDark);
  b.ellipse(cx, bottom - 7, 8, 6, wallDark);
  b.rect(cx - 7, bottom - 7, 14, 8, KENNEL_DOOR);
  b.ellipse(cx, bottom - 7, 7, 5, KENNEL_DOOR);
}

/**
 * Lays the kennel over the sprite. With the puppy inside, the house hides it — nothing of it shows
 * in the kennel's columns except through the doorway.
 */
function stampKennel(cx: number, inside: boolean) {
  const k = kennelBuf.data;
  const d = main.data;
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < ART_W; x++) {
      const i = y * ART_W + x;
      if (k[i]) { if (!inside || k[i] !== KENNEL_DOOR) d[i] = k[i]; }
      else if (inside && ((x >= cx - 17 && x <= cx + 16 && y >= FEET_Y - 16) || y > FEET_Y)) d[i] = 0;
    }
  }
}

// ── the cat, on four paws ──────────────────────────────────────────────────
//
// Miso is drawn side-on, facing right (the engine mirrors it), with its round face turned to the
// viewer so the eyes and mouth read: a body, a haunch, four legs with cream paws, a ringed tail.

type CatFrame = { bx: number; hx: number; hy: number; shoulder: [number, number]; foot: [number, number]; ground: number };

/** Where the cat's head, near front shoulder and near front paw are in a pose (art pixels). */
function catFrame(pose: Pose, cat: CatPose): CatFrame {
  const bx = CX - 3 + pose.lean;
  const P = cat.paws ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
  const sy = FEET_Y + pose.y;
  const hX = pose.headX;
  const hY = pose.headY;
  switch (cat.body) {
    case 'stand': {
      const by = 56 + pose.y;
      const ground = FEET_Y + Math.min(0, pose.y);
      return { bx, hx: bx + 13 + hX, hy: by - 9 + hY, shoulder: [bx + 10, by + 2], foot: [bx + 8 + P[0][0], ground - P[0][1]], ground };
    }
    case 'sit': return { bx, hx: bx + 5 + hX, hy: sy - 25 + hY, shoulder: [bx + 5, sy - 10], foot: [bx + 5 + P[0][0], sy], ground: sy };
    case 'loaf': return { bx, hx: bx + 11 + hX, hy: sy - 14 + hY, shoulder: [bx + 9, sy - 4], foot: [bx + 10, sy], ground: sy };
    case 'curl': return { bx, hx: bx + 8 + hX, hy: sy - 9 + hY, shoulder: [bx + 5, sy - 3], foot: [bx + 4, sy], ground: sy };
    case 'stretch': return { bx, hx: bx + 13 + hX, hy: sy - 12 + hY, shoulder: [bx + 8, sy - 3], foot: [bx + 17, sy], ground: sy };
    case 'leap': {
      const by = 54 + pose.y;
      const Q = cat.paws ?? LEAP_PAWS;
      return { bx, hx: bx + 14 + hX, hy: by - 7 + hY, shoulder: [bx + 8, by + 2], foot: [bx + 8 + Q[0][0], by + 2 + Q[0][1]], ground: FEET_Y };
    }
    case 'hang': {
      const Q = cat.paws ?? HANG_PAWS;
      return { bx, hx: CX + hX, hy: 31 + hY, shoulder: [CX + 4 + hX, 42], foot: [CX + 4 + hX + Q[1][0], 42 + Q[1][1]], ground: FEET_Y };
    }
  }
}

const LEAP_PAWS: [number, number][] = [[7, 5], [5, 5], [-7, 6], [-5, 6]];
const HANG_PAWS: [number, number][] = [[0, 5], [0, 5], [-1, 6], [1, 6]];

const isFur = (c: number) => c === C.fur || c === C.furLight || c === C.furShadow;

/** A leg from its joint down to a cream paw: flat on the ground, or round in the air. */
function catLeg(b: Buf, x0: number, y0: number, x1: number, y1: number, fur: number, round = false) {
  b.line(x0, y0, x1, y1 - 1.5, fur, 3.2);
  if (round) b.ellipse(x1, y1 - 1, 2, 2, C.skin);
  else b.ellipse(x1 + 0.5, y1 - 1.2, 2.4, 1.3, C.skin);
}

/** The ringed tail from its root: pointing up, back or down, or wrapped along the ground towards `reach`. */
function catTail(b: Buf, x0: number, y0: number, tail: CatTail, ground: number, reach: number, bend = -5) {
  let pts: [number, number, number, number, number, number];
  if ('wrap' in tail) {
    pts = [x0, y0, x0 + bend, ground + 1, x0 + reach, ground - 1.5 - (tail.flick ?? 0)];
  } else {
    const a = (tail.a * Math.PI) / 180;
    const dx = -Math.cos(a);
    const dy = -Math.sin(a);
    const curl = tail.curl ?? 0;
    // The perpendicular bends the tip towards the head for a positive curl: the question-mark tail.
    pts = [x0, y0, x0 + dx * 8 + dy * curl * 3, y0 + dy * 8 - dx * curl * 3, x0 + dx * 14 - dy * curl * 5, y0 + dy * 14 + dx * curl * 5];
  }
  strand(b, ...pts, 2, 1.5, C.fur);
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * pts[0] + 2 * (1 - t) * t * pts[2] + t * t * pts[4],
    (1 - t) ** 2 * pts[1] + 2 * (1 - t) * t * pts[3] + t * t * pts[5],
  ];
  for (const t of [0.42, 0.64, 0.86]) { const [x, y] = at(t); b.ellipse(x, y, 1.2, 1.2, C.accentDark); }
}

/** Tabby stripes: short dark strokes down from the top edge of the fur at each column. */
function tabby(b: Buf, columns: number[]) {
  for (const x of columns) {
    let y = 0;
    while (y < ART_H && !isFur(b.at(x, y))) y++;
    for (let k = 1; k <= 3; k++) {
      const sx = x - (k === 3 ? 1 : 0);
      if (isFur(b.at(sx, y + k))) b.set(sx, y + k, C.accentDark);
    }
  }
}

/** A round body of fur, lit from the upper left, cream underneath, with its stripes. */
function catBody(b: Buf, blobs: [number, number, number, number][], cream: (x: number, y: number) => boolean, stripes: number[]) {
  for (const [x, y, rx, ry] of blobs) b.ellipse(x, y, rx, ry, C.fur);
  b.recolour(C.fur, C.skin, cream);
  const [x, y, rx, ry] = blobs[0];
  shade(b, C.fur, C.furLight, C.furShadow, x, y, rx, ry);
  tabby(b, stripes);
}

/** What the cat works at, set out on the ground in front of it. */
function drawDesk(kind: NonNullable<CatPose['desk']>, hx: number, ground: number, phase: number) {
  const x = hx + 6;
  part((b) => {
    if (kind === 'laptop') {
      // Side-on: the keyboard flat on the ground, the screen tilted up towards the cat, glowing.
      b.rect(x, ground - 2, 14, 2, colour('#8a92a8'));
      b.rect(x, ground - 2, 14, 1, colour('#c3cad8'));
      b.line(x + 13, ground - 2, x + 10, ground - 13, colour('#6b7389'), 2);
      const glow = phase > 0.5 ? C.hairShine : colour('#bfe6ff');
      for (let k = 3; k < 10; k += 2) b.set(x + 11 - Math.round(k * 0.27) - 1, ground - 2 - k, glow);
    } else if (kind === 'mixer') {
      b.rect(x, ground - 5, 14, 5, colour('#2f2f3a'));
      b.rect(x, ground - 5, 14, 1, colour('#4a4a5a'));
      ['#e5484d', '#3ecf8e', '#ffc23d'].forEach((k, i) => b.set(x + 2 + i * 3, ground - 3, colour(k)));
      for (let i = 0; i < 3; i++) {
        const level = Math.max(1, Math.round(2 + Math.sin(phase * 6 + i * 1.7) * 1.5));
        b.rect(x + 10 + i, ground - 1 - level, 1, level, colour(level > 2 ? '#ffc23d' : '#3ecf8e'));
      }
    } else {
      b.rect(x, ground - 2, 12, 2, colour('#fff4cf'));
      b.rect(x - 1, ground - 1, 14, 1, colour('#ff7a45'));
      const ink = colour('#8a8fa8');
      for (let i = 0; i < 4; i++) b.set(x + 2 + i * 2 + (Math.floor(phase) % 2), ground - 2, ink);
    }
  });
}

function drawCat(pose: Pose, cat: CatPose) {
  const f = catFrame(pose, cat);
  const { bx, hx, hy, ground: gy } = f;
  const P = cat.paws ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
  const far = C.furShadow;
  const wrap = 'wrap' in cat.tail;
  const sy = FEET_Y + pose.y;
  let curled = false;
  switch (cat.body) {
    case 'stand': {
      const by = 56 + pose.y;
      part((b) => {
        catTail(b, bx - 11, by - 2, cat.tail, gy, 12);
        catLeg(b, bx + 5, by + 2, bx + 5 + P[1][0], gy - P[1][1], far);
        catLeg(b, bx - 6, by + 2, bx - 6 + P[3][0], gy - P[3][1], far);
      }, C.hairOutline);
      part((b) => catBody(b, [[bx, by, 12.5, 6.5], [bx - 8, by + 1.5, 4.5, 5]], (x, y) => y + 0.5 > by + 3.5 && x + 0.5 > bx - 3, [bx - 7, bx - 3, bx + 1, bx + 5]), C.hairOutline);
      part((b) => {
        catLeg(b, bx - 9, by + 4, bx - 9 + P[2][0], gy - P[2][1], C.fur);
        if (!cat.raise) catLeg(b, bx + 8, by + 3, bx + 8 + P[0][0], gy - P[0][1], C.fur);
      }, C.hairOutline);
      break;
    }
    case 'sit':
      part((b) => {
        if (!wrap) catTail(b, bx - 9, sy - 5, cat.tail, gy, 0);
        catLeg(b, bx + 2, sy - 11, bx + 2 + P[1][0], sy - P[1][1], far);
      }, C.hairOutline);
      part((b) => {
        catBody(b, [[bx - 4, sy - 6.5, 7.5, 6.5], [bx + 2.5, sy - 12, 5.5, 8]], (x, y) => x + 0.5 > bx + 4 && y + 0.5 > sy - 17, [bx - 8, bx - 5, bx - 2]);
        b.ellipse(bx + 0.5, sy - 1.3, 3.5, 1.5, C.fur);
        b.rect(bx + 2, sy - 2, 2, 2, C.skin);
      }, C.hairOutline);
      part((b) => {
        if (wrap) catTail(b, bx - 10, sy - 3, cat.tail, gy, 11);
        if (!cat.raise) catLeg(b, bx + 5, sy - 10, bx + 5 + P[0][0], sy - P[0][1], C.fur);
      }, C.hairOutline);
      break;
    case 'loaf':
      if (!wrap) part((b) => catTail(b, bx - 11, sy - 6, cat.tail, gy, 0), C.hairOutline);
      part((b) => catBody(b, [[bx, sy - 6, 13, 6.5]], (x, y) => y + 0.5 > sy - 3 && x + 0.5 > bx + 2, [bx - 8, bx - 4, bx, bx + 4]), C.hairOutline);
      part((b) => {
        if (wrap) catTail(b, bx - 12, sy - 3, cat.tail, gy, 14);
        if (!cat.raise) b.ellipse(bx + 10.5, sy - 1.2, 3, 1.4, C.skin);
      }, C.hairOutline);
      break;
    case 'curl': {
      const breath = cat.breath ?? 0;
      part((b) => catBody(b, [[bx - 2, sy - 7 - breath * 0.5, 13.5, 7.5 + breath * 0.5]], () => false, [bx - 10, bx - 6, bx - 2, bx + 2]), C.hairOutline);
      curled = true;
      break;
    }
    case 'stretch':
      part((b) => {
        catTail(b, bx - 12, sy - 13, cat.tail, gy, 0);
        catLeg(b, bx - 3, sy - 8, bx - 3, sy, far);
        catLeg(b, bx + 6, sy - 3, bx + 15, sy, far);
      }, C.hairOutline);
      part((b) => catBody(b, [[bx - 6, sy - 11, 7.5, 6], [bx + 4, sy - 6, 7.5, 4.5]], (x, y) => y + 0.5 > sy - 4 && x + 0.5 > bx, [bx - 9, bx - 5, bx - 1]), C.hairOutline);
      part((b) => {
        catLeg(b, bx - 7, sy - 8, bx - 7, sy, C.fur);
        catLeg(b, bx + 8, sy - 3, bx + 17, sy, C.fur);
      }, C.hairOutline);
      break;
    case 'leap': {
      const by = 54 + pose.y;
      const Q = cat.paws ?? LEAP_PAWS;
      part((b) => {
        catTail(b, bx - 13, by - 1, cat.tail, gy, 0);
        catLeg(b, bx + 6, by + 2, bx + 6 + Q[1][0], by + 2 + Q[1][1], far, true);
        catLeg(b, bx - 7, by + 2, bx - 7 + Q[3][0], by + 2 + Q[3][1], far, true);
      }, C.hairOutline);
      part((b) => catBody(b, [[bx, by, 14, 5.5]], (x, y) => y + 0.5 > by + 2.5 && x + 0.5 > bx - 4, [bx - 8, bx - 4, bx, bx + 4]), C.hairOutline);
      part((b) => {
        catLeg(b, bx - 9, by + 2, bx - 9 + Q[2][0], by + 2 + Q[2][1], C.fur, true);
        if (!cat.raise) catLeg(b, bx + 8, by + 2, bx + 8 + Q[0][0], by + 2 + Q[0][1], C.fur, true);
      }, C.hairOutline);
      break;
    }
    case 'hang': {
      // Held by the scruff: seen from the front, hanging below the head, legs and tail dangling.
      const Q = cat.paws ?? HANG_PAWS;
      part((b) => catTail(b, hx - 1, 56, cat.tail, gy, 0), C.hairOutline);
      part((b) => catBody(b, [[hx - 0.5, 47, 6.5, 10]], (x, y) => ((x + 0.5 - (hx - 0.5)) / 3.5) ** 2 + ((y + 0.5 - 49) / 6) ** 2 <= 1, []), C.hairOutline);
      part((b) => {
        ([[hx - 5, 42], [hx + 4, 42], [hx - 5, 54], [hx + 4, 54]] as const).forEach(([x0, y0], i) => catLeg(b, x0, y0, x0 + Q[i][0], y0 + Q[i][1], C.fur, true));
      }, C.hairOutline);
      break;
    }
  }
  part((b) => drawCatHead(b, hx, hy, pose.sway ?? 0, cat.earsBack), C.hairOutline);
  drawFace(hx, hy, pose);
  drawFaceExtras('cat', hx, hy, pose.eyes);
  drawGear(hx, hy, pose.gear ?? []);
  // Asleep: the tail comes round the front and ends under the chin, a paw tucked beside it.
  if (curled) part((b) => { b.ellipse(bx + 3, gy - 1.3, 2.6, 1.3, C.skin); catTail(b, bx - 15, sy - 6, cat.tail, gy, 30, 2); }, C.hairOutline);
  if (cat.carry) {
    const top = Math.round(hy + 7 + cat.carry.drop * (gy - 11 - (hy + 7)));
    const color = cat.carry.color;
    part((b) => drawClip(b, hx - 2, top, color));
  }
  if (cat.desk) drawDesk(cat.desk, hx, gy, cat.deskPhase ?? 0);
  if (cat.raise) {
    const [sx, sy0] = f.shoulder;
    const px = sx + cat.raise[0];
    const py = sy0 + cat.raise[1];
    part((b) => {
      b.line(sx, sy0, px, py, C.fur, 3.2);
      b.ellipse(px, py, 2.2, 2.2, C.skin);
      if (cat.claws) for (const [dx, dy] of [[2, -2], [3, 0], [2, 2]] as const) b.set(px + dx, py + dy, C.white);
    }, C.hairOutline);
  }
}

/** Sudo: short grey hair receding at the temples, a few messy tufts, a full grey beard. */
function drawSeniorHead(b: Buf, hx: number, hy: number) {
  b.ellipse(hx, hy + 0.5, 9, 7, C.skin);
  b.ellipse(hx, hy + 3.2, 7.4, 6, C.skin);
  // The beard: jaw and chin below the cheeks, a little fuller than the face, sideburns up the sides.
  b.ellipse(hx, hy + 7, 7, 4.8, C.skin);
  b.recolour(C.skin, C.hair, (x, y) => {
    const dy = y + 0.5 - hy;
    const dx = Math.abs(x + 0.5 - hx);
    return dy >= 5 || (dx >= 7.5 && dy >= 0) || (dy >= 4 && dx >= 4.5);
  });
  b.recolour(C.hair, C.hairShadow, (x, y) => y + 0.5 - hy >= 9.5 || (x + 0.5 > hx + 4.5 && y + 0.5 - hy >= 4));
  b.ellipse(hx - 9.5, hy + 1, 1.8, 2.4, C.skin);
  b.ellipse(hx + 9.5, hy + 1, 1.8, 2.4, C.skin);
  b.set(hx - 10, hy + 1, C.skinShadow);
  b.set(hx + 9, hy + 1, C.skinShadow);
  for (let y = hy - 12; y <= hy - 4; y++) {
    for (let x = hx - 11; x < hx + 11; x++) {
      const dx = Math.abs(x + 0.5 - hx);
      const receding = y >= hy - 5 && dx > 2.5 && dx < 7.5;
      if ((dx / 10) ** 2 + ((y + 0.5 - (hy - 4)) / 6.5) ** 2 <= 1 && !receding) b.set(x, y, C.hair);
    }
  }
  b.rect(hx - 10, hy - 5, 2, 5, C.hair);
  b.rect(hx + 8, hy - 5, 2, 5, C.hair);
  b.ellipse(hx - 2, hy - 10, 4, 1.8, C.hair);
  browShadow(b);
  shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 6, 10, 6.5);
}

/** A slate hoodie with the hood bunched at the neck, a kangaroo pocket and a lanyard badge. */
function drawHoodie(bx: number, ty: number) {
  part((b) => {
    b.rect(bx - 2, ty - 2, 4, 3, C.skin);
    b.rect(bx - 2, ty - 2, 4, 1, C.skinShadow);
    COAT.forEach((h, r) => {
      b.rect(bx - h, ty + r, h * 2, 1, r === COAT.length - 1 ? C.coatShadow : C.coat);
      if (r > 1) b.set(bx + h - 1, ty + r, C.coatShadow);
    });
    b.rect(bx - 6, ty - 1, 3, 2, C.sleeve);
    b.rect(bx + 3, ty - 1, 3, 2, C.sleeve);
    b.rect(bx - 3, ty, 6, 1, C.sleeve);
    b.rect(bx - 1, ty, 2, 1, C.skin);
    b.rect(bx - 5, ty + 7, 10, 3, C.coatShadow);
    b.rect(bx - 4, ty + 7, 8, 1, C.sleeve);
    b.line(bx - 4, ty + 1, bx - 2, ty + 3, C.accent);
    b.line(bx + 3, ty + 1, bx + 1, ty + 3, C.accent);
    b.rect(bx - 2, ty + 3, 4, 3, C.accentLight);
    b.rect(bx - 2, ty + 3, 4, 1, C.accentDark);
    b.set(bx - 2, ty + 5, C.steelDark);
  });
}

/** What goes on the face after the eyes and mouth: noses, whiskers, lashes, brows, glasses. */
function drawFaceExtras(who: Character, hx: number, hy: number, eyes: Eyes) {
  const x0 = Math.round(hx);
  const y0 = Math.round(hy);
  const eyeY = Math.round(hy - 2);
  const set = (x: number, y: number, c: number) => main.set(x0 + x, y0 + y, c);
  switch (who) {
    case 'cat':
      for (let x = -2; x <= 1; x++) set(x, 2, C.nose);
      set(-1, 3, C.nose); set(0, 3, C.nose);
      for (const s of [-1, 1]) {
        const at = (k: number) => (s < 0 ? -9 - k : 8 + k);
        for (let k = 0; k < 4; k++) { set(at(k), 3 - (k > 1 ? 1 : 0), C.hairOutline); set(at(k), 5 + (k > 1 ? 1 : 0), C.hairOutline); }
      }
      break;
    case 'puppy':
      for (let x = -2; x <= 1; x++) set(x, 2, C.nose);
      set(-1, 3, C.nose); set(0, 3, C.nose);
      set(-1, 2, colour('#7a6a70'));
      break;
    case 'woman':
      if (!['blink', 'sleep', 'happy', 'squeeze', 'dizzy'].includes(eyes)) { main.set(x0 - 8, eyeY, C.pupil); main.set(x0 + 7, eyeY, C.pupil); }
      break;
    case 'genie':
      if (eyes !== 'angry' && eyes !== 'focus') for (let x = 0; x <= 4; x++) { main.set(x0 - 8 + x, eyeY - 2, C.hair); main.set(x0 + 3 + x, eyeY - 2, C.hair); }
      for (const [x, y] of [[-12, 2], [-13, 3], [-12, 4], [-11, 3]] as const) set(x, y, C.cuff);
      break;
    case 'senior': {
      // Browline glasses: a heavy top bar, a thin grey rim underneath.
      const rim = colour('#8792a8');
      for (const [a, b] of [[-9, -2], [2, 8]] as const) {
        for (let x = a; x <= b; x++) { main.set(x0 + x, eyeY - 1, C.frame); main.set(x0 + x, eyeY + 6, rim); }
        for (let y = 0; y <= 5; y++) { main.set(x0 + a, eyeY + y, rim); main.set(x0 + b, eyeY + y, rim); }
        main.set(x0 + b - 1, eyeY, colour('#d8f1ff'));
      }
      main.set(x0 - 1, eyeY, C.frame); main.set(x0, eyeY, C.frame);
      break;
    }
  }
}

/** Props drawn between the torso and the hands (held in front, hands on top). */
const MID_PROPS = new Set<Prop['kind']>(['laptop', 'mixer', 'flipbook', 'clip']);

/** Renders a pose into the shared buffer and returns its pixels (RGBA, ART_W×ART_H). */
export function renderPose(pose: Pose): Uint8ClampedArray<ArrayBuffer> {
  const who = pose.character ?? 'heli';
  C = COLOURS[who];
  main.clear();
  if (who === 'genie' && pose.lamp) {
    drawSleepingLamp(pose);
    return new Uint8ClampedArray(main.data.buffer.slice(0));
  }
  if (who === 'cat' && pose.cat) {
    drawCat(pose, pose.cat);
    return new Uint8ClampedArray(main.data.buffer.slice(0));
  }
  const drop = pose.sit ? SIT_DROP[pose.sit] : 0;
  const ty = TORSO_Y + pose.y + drop;
  const bx = CX + pose.lean;
  const hx = CX + pose.headX + pose.lean;
  const hy = HEAD_Y + pose.y + pose.headY + drop;
  const shoulderL = [bx - 7, ty + 2] as const;
  const shoulderR = [bx + 6, ty + 2] as const;
  const hands = { l: [shoulderL[0] + pose.armL[0], shoulderL[1] + pose.armL[1]] as const, r: [shoulderR[0] + pose.armR[0], shoulderR[1] + pose.armR[1]] as const };

  const fingerL = pose.finger === 'L' || pose.finger === 'both';
  const fingerR = pose.finger === 'R' || pose.finger === 'both';
  const props = pose.props ?? [];
  const arm = (which: 'L' | 'R') => which === 'L'
    ? drawArm(shoulderL[0], shoulderL[1], pose.armL, fingerL, pose.thumb === 'L', -1)
    : drawArm(shoulderR[0], shoulderR[1], pose.armR, fingerR, pose.thumb === 'R', 1);
  const sway = pose.sway ?? 0;
  const kennel = who === 'puppy' ? pose.kennel : undefined;
  if (kennel) {
    kennelBuf.clear();
    part((b) => drawKennel(b, kennel.x, kennel.y), C.outline, kennelBuf);
    if (kennel.stage !== 'held') stampKennel(kennel.x, false);
  }
  // Behind the body: Heli's backpack, a tail, or Nova's long hair.
  if (who === 'heli') drawPack(bx, ty);
  else if (who === 'cat' || who === 'puppy') drawTail(pose, bx, ty, who);
  else if (who === 'woman') drawLongHair(hx, hy, sway);
  if (pose.armLBack) arm('L');
  if (pose.armRBack) arm('R');
  if (who === 'genie') drawSmoke(pose, ty);
  else drawLegs(pose, ty);
  switch (who) {
    case 'heli': drawTorso(bx, ty); break;
    case 'cat': case 'puppy': drawFurBody(bx, ty); break;
    case 'woman': drawDress(bx, ty); break;
    case 'genie': drawVest(bx, ty); break;
    case 'senior': drawHoodie(bx, ty); break;
  }
  switch (who) {
    case 'heli':
      part((b) => drawHair(b, hx, hy, sway), C.hairOutline);
      part((b) => drawHead(b, hx, hy), C.hairOutline);
      drawBand(hx, hy);
      break;
    case 'cat': part((b) => drawCatHead(b, hx, hy, sway), C.hairOutline); break;
    case 'puppy':
      part((b) => drawPuppyHead(b, hx, hy), C.hairOutline);
      drawPuppyEars(hx, hy, sway);
      break;
    case 'woman':
      part((b) => drawWomanHead(b, hx, hy), C.hairOutline);
      drawFlower(hx, hy);
      break;
    case 'genie': part((b) => drawGenieHead(b, hx, hy, sway), C.hairOutline); break;
    case 'senior': part((b) => drawSeniorHead(b, hx, hy), C.hairOutline); break;
  }
  drawFace(hx, hy, pose);
  drawFaceExtras(who, hx, hy, pose.eyes);
  // Sudo's own glasses stay on; the round research pair would sit on top of them.
  drawGear(hx, hy, (pose.gear ?? []).filter((gear) => !(who === 'senior' && gear === 'glasses')));
  for (const prop of props) if (MID_PROPS.has(prop.kind)) drawProp(prop, hands, bx);
  if (kennel?.stage === 'held') stampKennel(kennel.x, false);
  if (!pose.armLBack) arm('L');
  if (!pose.armRBack) arm('R');
  for (const prop of props) if (!MID_PROPS.has(prop.kind)) drawProp(prop, hands, bx);
  if (kennel?.stage === 'inside') stampKennel(kennel.x, true);
  return new Uint8ClampedArray(main.data.buffer.slice(0));
}

/** Where a hand ends up in art pixels, for effects that start at the hand (sparks, notes). */
export function handPoint(pose: Pose, which: 'l' | 'r'): [number, number] {
  // The cat works with its near front paw.
  if (pose.cat && pose.character === 'cat') {
    const f = catFrame(pose, pose.cat);
    return pose.cat.raise ? [f.shoulder[0] + pose.cat.raise[0], f.shoulder[1] + pose.cat.raise[1]] : f.foot;
  }
  const drop = pose.sit ? SIT_DROP[pose.sit] : 0;
  const ty = TORSO_Y + pose.y + drop;
  const bx = CX + pose.lean;
  return which === 'l' ? [bx - 7 + pose.armL[0], ty + 2 + pose.armL[1]] : [bx + 6 + pose.armR[0], ty + 2 + pose.armR[1]];
}

/** Paints a pose onto a canvas that is ART_W×ART_H pixels. */
export function paint(ctx: CanvasRenderingContext2D, pose: Pose) {
  ctx.putImageData(new ImageData(renderPose(pose), ART_W, ART_H), 0, 0);
}
