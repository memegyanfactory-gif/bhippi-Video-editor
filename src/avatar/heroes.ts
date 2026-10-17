// The hero cast: eleven more looks for the avatar, each drawn on the same skeleton as Heli (so
// every animation in poses.ts plays for all of them) but with its own head, suit, cape or quiver,
// eyes and hands. A hero is a `Hero`: a handful of drawing functions that get the sprite's `Kit`
// (the buffer, the palette of whoever is being drawn, the outline-stamping `part`) — sprite.ts owns
// the buffer and calls them in order: back → legs → torso → head → face → arms → props.
//
// Palette keys are reused by meaning, so Settings › Avatar can recolour every piece:
//   hair* = the mask / cowl / helmet / hair · skin* = the face (or the faceplate) · coat* = the suit
//   shirt* = its second colour · sleeve/cuff/glove = arms and hands · pants, shoe = legs and boots
//   fur* = the cape · accent* = the emblem and trim · band* = a belt, strap or headband.
//
// None of the names are anyone's trademark: these are original characters in the spirit of the
// heroes people love, not copies.

import type { Buf, Colours, Eyes, Mouth, Pose, Prop } from './sprite';

export type HeroId = 'spider' | 'bat' | 'jester' | 'butler' | 'ironclad' | 'brute' | 'synth' | 'archer' | 'patriot' | 'panther' | 'chakra';

type Palette = Partial<Record<string, string>>;
export type HeroSlot = { id: string; label: string; keys: [string, number][] };

/** What heroes.ts needs from sprite.ts, passed in so the two files never import each other's values. */
export type Kit = {
  readonly main: Buf;
  /** The palette of the hero being drawn right now. */
  readonly C: Colours;
  part: (draw: (b: Buf) => void, outline?: number) => void;
  colour: (hex: string) => number;
  shade: (b: Buf, base: number, light: number, dark: number, cx: number, cy: number, rx: number, ry: number) => void;
  strand: (b: Buf, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r0: number, r1: number, c: number) => void;
  eyeBox: (ox: number, oy: number, eyes: Eyes, look: -1 | 0 | 1, right: boolean) => void;
  mouth: (x0: number, hy: number, mouth: Mouth, colour?: number) => void;
  CX: number;
  FEET_Y: number;
  COAT: readonly number[];
};

export type Hero = {
  info: { name: string; title: string };
  look: Palette;
  slots: HeroSlot[];
  /** Arm thickness, hand radius and leg width, in art pixels. */
  armW?: number;
  fist?: number;
  legW?: number;
  /** Flies when it travels (poses use the hovering stance). */
  flies?: boolean;
  back?: (k: Kit, bx: number, ty: number, hx: number, hy: number, pose: Pose) => void;
  torso: (k: Kit, bx: number, ty: number, pose: Pose) => void;
  head: (k: Kit, hx: number, hy: number, pose: Pose) => void;
  face: (k: Kit, hx: number, hy: number, pose: Pose) => void;
};

// ── shared drawing helpers ────────────────────────────────────────────────

const faceShape = (b: Buf, hx: number, hy: number, c: number, jaw = 7.4) => {
  b.ellipse(hx, hy + 0.5, 9, 7, c);
  b.ellipse(hx, hy + 3.2, jaw, 6, c);
};

/** Pixels of an ellipse above `bottom` (a cap of hair or a helmet dome). */
const cap = (b: Buf, cx: number, cy: number, rx: number, ry: number, bottom: number, c: number) => {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    if (y + 0.5 >= bottom) continue;
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) b.set(x, y, c);
    }
  }
};

/** Draws over what is already there only (so ink never spills past a silhouette). */
const ink = (b: Buf, x0: number, y0: number, x1: number, y1: number, c: number) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let s = 0; s <= steps; s++) {
    const x = Math.floor(x0 + ((x1 - x0) * s) / steps);
    const y = Math.floor(y0 + ((y1 - y0) * s) / steps);
    if (b.at(x, y)) b.set(x, y, c);
  }
};

const ears = (b: Buf, hx: number, hy: number, c: number, shadow: number) => {
  b.ellipse(hx - 9.5, hy + 2, 1.8, 2.4, c);
  b.ellipse(hx + 9.5, hy + 2, 1.8, 2.4, c);
  b.set(hx - 10, hy + 2, shadow);
  b.set(hx + 9, hy + 2, shadow);
};

/** A torso: `paint` picks the colour of each pixel (r = row from the collar, dx = column from the centre line, h = half-width). */
const trunk = (b: Buf, bx: number, ty: number, widths: readonly number[], paint: (r: number, dx: number, h: number) => number) => {
  widths.forEach((h, r) => {
    for (let x = bx - h; x < bx + h; x++) b.set(x, ty + r, paint(r, x - bx, h));
  });
};

const neck = (b: Buf, bx: number, ty: number, c: number, shadow = c) => {
  b.rect(bx - 2, ty - 2, 4, 3, c);
  b.rect(bx - 2, ty - 2, 4, 1, shadow);
};

/** Cape behind the body: from the shoulders, flaring out; `flare` 0 hangs, 2 is blown wide. Scalloped hem when `points`. */
function drawCape(k: Kit, bx: number, ty: number, pose: Pose, points: number, collar = false) {
  const C = k.C;
  const air = Math.max(pose.legL[1], pose.legR[1]) > 1 || pose.armL[1] < -5 || pose.armR[1] < -5;
  const sway = pose.sway ?? 0;
  const flare = pose.cape ?? (air ? 2 : Math.abs(sway) > 0.7 ? 1 : 0);
  const hem = Math.min(ty + 17, k.FEET_Y - 2);
  const len = hem - ty;
  k.part((b) => {
    for (let r = -1; r <= len; r++) {
      const t = Math.max(0, r) / len;
      const half = 6.5 + t * (3 + flare * 2);
      const drift = -sway * t * 3 + (flare > 1 ? 3 * t : 0) * (sway >= 0 ? -1 : 1);
      const x0 = Math.round(bx - half + drift);
      const x1 = Math.round(bx + half + drift);
      for (let x = x0; x < x1; x++) {
        // The scalloped hem: points hang lower than the notches between them.
        if (points && r >= len - 2) {
          const u = ((x - x0) / (x1 - x0)) * points;
          if (r > len - Math.round(Math.abs(u - Math.floor(u) - 0.5) * 4)) continue;
        }
        const edge = x === x0 || x === x1 - 1;
        b.set(x, ty + r, edge ? C.furShadow : r < 3 ? C.furLight : t > 0.5 && x > bx ? C.furShadow : C.fur);
      }
    }
    if (collar) {
      b.tri(bx - 9, ty - 1, bx - 4, ty - 1, bx - 9, ty - 9, C.fur);
      b.tri(bx + 9, ty - 1, bx + 4, ty - 1, bx + 9, ty - 9, C.fur);
      b.line(bx - 8, ty - 2, bx - 8, ty - 8, C.furLight);
      b.line(bx + 8, ty - 2, bx + 8, ty - 8, C.furLight);
    }
  }, C.hairOutline);
}

// ── eyes ──────────────────────────────────────────────────────────────────

type Slit = { w: number; h: number; sl: number; fill: number; edge: number; dx?: number; dy?: number };

/** Masked eyes: glowing slits or big lenses that squint, widen, arc and close with the eye state. */
function slitEyes(k: Kit, hx: number, hy: number, eyes: Eyes, o: Slit) {
  const ey = hy - 0.5 + (o.dy ?? 0);
  const left = hx - 5 - (o.dx ?? 0);
  const right = hx + 4.5 + (o.dx ?? 0);
  k.part((b) => {
    for (const d of [-1, 1] as const) {
      const ex = d < 0 ? left : right;
      const outer = ex + d * o.w;
      const inner = ex - d * o.w;
      let h = o.h;
      let sl = o.sl;
      let down = 0;
      const winking = eyes === 'wink' && d > 0;
      if (eyes === 'wide') { h = o.h * 1.5; sl = o.sl * 0.3; }
      else if (eyes === 'angry' || eyes === 'focus') { h = o.h * 0.8; sl = o.sl * 1.8; }
      else if (eyes === 'squeeze') { h = 1.4; sl = o.sl * 0.4; }
      else if (eyes === 'down') { h = o.h * 0.6; down = 1; }
      else if (eyes === 'up') down = -1;
      if (eyes === 'blink' || eyes === 'sleep' || winking) {
        b.line(outer, ey + 1 + (eyes === 'sleep' ? 1 : 0), inner, ey + 1 + (eyes === 'sleep' ? 1 : 0), o.fill);
      } else if (eyes === 'happy') {
        b.line(outer, ey + 1.5, ex, ey - 1, o.fill);
        b.line(ex, ey - 1, inner, ey + 1.5, o.fill);
      } else if (eyes === 'dizzy') {
        b.line(outer, ey - 2, inner, ey + 2, o.fill);
        b.line(outer, ey + 2, inner, ey - 2, o.fill);
      } else {
        const c = ey + down;
        const tyo = c - h / 2 - sl;
        const tyi = c - h / 2 + sl;
        const byo = c + h / 2 - sl * 0.3;
        const byi = c + h / 2 + sl * 0.5;
        b.tri(outer, tyo, inner, tyi, inner, byi, o.fill);
        b.tri(outer, tyo, inner, byi, outer, byo, o.fill);
      }
    }
  }, o.edge);
}

/** Painted-on white eyeballs under a mask's eye holes, so ordinary eyes read against dark cloth. */
function eyeHoles(k: Kit, hx: number, hy: number) {
  const x0 = Math.round(hx);
  const eyeY = Math.round(hy - 2);
  for (const ox of [x0 - 5.5, x0 + 5.5]) k.main.ellipse(ox, eyeY + 3, 3.2, 3.8, k.C.white);
}

/** Ordinary eyes and mouth, as on Heli. */
function plainFace(k: Kit, hx: number, hy: number, pose: Pose, blush = true) {
  const x0 = Math.round(hx);
  const eyeY = Math.round(hy - 2);
  if (blush && pose.blush) for (const x of [x0 - 9, x0 - 8, x0 + 7, x0 + 8]) k.main.set(x, hy + 4, k.C.blush);
  k.eyeBox(x0 - 7, eyeY, pose.eyes, pose.look, false);
  k.eyeBox(x0 + 3, eyeY, pose.eyes, pose.look, true);
  k.mouth(x0, Math.round(hy), pose.mouth);
}

// ── the cast ──────────────────────────────────────────────────────────────

const HAIR: [string, number][] = [['hair', 0], ['hairLight', 0.3], ['hairShine', 0.65], ['hairShadow', -0.12], ['hairDeep', -0.3], ['hairOutline', -0.6]];
const FACE: HeroSlot = { id: 'skin', label: 'Skin', keys: [['skin', 0], ['skinShadow', -0.1]] };
const EYES: HeroSlot = { id: 'eyes', label: 'Eyes', keys: [['iris', 0]] };
const CAPE: HeroSlot = { id: 'cape', label: 'Cape', keys: [['fur', 0], ['furLight', 0.3], ['furShadow', -0.2]] };

/** Webb — red-and-blue web-slinger in a full mask: lenses that squint, a web on the suit, wrist shooters. */
const spider: Hero = {
  info: { name: 'Webb', title: 'A wall-crawling web-slinger: thwips web lines to every panel and swings across the editor.' },
  look: {
    hairOutline: '#14151f', hair: '#d4202f', hairLight: '#ee4a56', hairShine: '#ff9aa0', hairShadow: '#a61622', hairDeep: '#6a0f19',
    skin: '#d4202f', skinShadow: '#a61622', coat: '#d4202f', coatShadow: '#a61622', sleeve: '#d4202f', cuff: '#4b4f66',
    shirt: '#2748c4', shirtShadow: '#1c3390', pants: '#2748c4', pantsShadow: '#1c3390', shoe: '#d4202f', shoeLight: '#ee4a56', sole: '#1c3390',
    accent: '#14151f', accentLight: '#6a1f2c', accentDark: '#0b0c12', blush: '#d4202f',
  },
  slots: [
    { id: 'mask', label: 'Mask & suit', keys: [...HAIR, ['skin', 0], ['skinShadow', -0.25], ['coat', 0], ['coatShadow', -0.25], ['sleeve', 0], ['shoe', 0], ['shoeLight', 0.25]] },
    { id: 'blue', label: 'Blue panels', keys: [['shirt', 0], ['shirtShadow', -0.25], ['pants', 0], ['pantsShadow', -0.25], ['sole', -0.25]] },
    { id: 'web', label: 'Web & emblem', keys: [['accent', 0], ['accentDark', -0.4]] },
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.coat, C.coatShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        const flank = r >= 2 && Math.abs(dx + 0.5) > h - 3.4;
        const blue = r >= 8 || flank;
        if (dx === h - 1 && r > 1) return blue ? C.shirtShadow : C.coatShadow;
        return blue ? C.shirt : C.coat;
      });
      // The web: arcs across the chest and a spine, and the black spider on the chest.
      for (const [row, sag] of [[3, 1], [6, 1.5], [9, 2]] as const) for (let dx = -8; dx <= 7; dx++) ink(b, bx + dx, ty + row + Math.abs(dx + 0.5) * 0.12 * sag, bx + dx, ty + row + Math.abs(dx + 0.5) * 0.12 * sag, C.accentLight);
      for (let r = 6; r <= 10; r++) ink(b, bx - 1, ty + r, bx - 1, ty + r, C.accentLight);
      b.rect(bx - 1, ty + 2, 2, 4, C.accent);
      for (const s of [-1, 1] as const) {
        const x = s < 0 ? bx - 2 : bx + 1;
        b.set(x + s, ty + 1, C.accent); b.set(x + 2 * s, ty, C.accent);
        b.set(x + s, ty + 3, C.accent); b.set(x + 2 * s, ty + 3, C.accent); b.set(x + 3 * s, ty + 2, C.accent);
        b.set(x + s, ty + 5, C.accent); b.set(x + 2 * s, ty + 6, C.accent); b.set(x + 3 * s, ty + 7, C.accent);
      }
    }, C.accentDark);
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      faceShape(b, hx, hy, C.hair, 7.6);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy, 10, 9);
      // Web lines on the mask: spokes from the nose and rings round it.
      for (const [x1, y1] of [[-9, -2], [-8, 6], [-4, 9], [4, 9], [8, 6], [9, -2], [-6, -6], [6, -6]] as const) ink(b, hx, hy + 3, hx + x1, hy + y1, C.hairDeep);
      ink(b, hx - 0.5, hy - 7, hx - 0.5, hy + 3, C.hairDeep);
      for (const [rx, ry] of [[4.5, 3.4], [8.2, 6.4]] as const) {
        for (let a = 0; a < 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          ink(b, hx + Math.cos(ang) * rx, hy + 3 + Math.sin(ang) * ry, hx + Math.cos(ang) * rx, hy + 3 + Math.sin(ang) * ry, C.hairDeep);
        }
      }
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    // Two big white lenses, slanted over the nose, with a dark rim.
    slitEyes(k, hx, hy, pose.eyes, { w: 4, h: 4.6, sl: 1.4, fill: k.C.white, edge: k.C.hairOutline, dx: 0.5 });
  },
};

/** Dusk — a cowled night vigilante: pointed ears, white slits, a grey suit, a scalloped cape and a yellow bat on the chest. */
const bat: Hero = {
  info: { name: 'Dusk', title: 'A caped night vigilante: pointed cowl, scalloped cape, a batarang for every cut.' },
  look: {
    hairOutline: '#08090d', hair: '#1d2028', hairLight: '#3a3f50', hairShine: '#6a7090', hairShadow: '#12141a', hairDeep: '#07080b',
    skin: '#f0c9a6', skinShadow: '#d9a883', coat: '#6b7385', coatShadow: '#4a5163', sleeve: '#6b7385', cuff: '#1d2028', glove: '#1d2028',
    shirt: '#6b7385', shirtShadow: '#4a5163', pants: '#6b7385', pantsShadow: '#4a5163', shoe: '#1d2028', shoeLight: '#3a3f50', sole: '#07080b',
    fur: '#1d2028', furLight: '#3a4a78', furShadow: '#0d0f14', accent: '#f5c518', accentLight: '#fff2a0', accentDark: '#b8860b', blush: '#f0c9a6',
  },
  slots: [
    { id: 'cowl', label: 'Cowl & gloves', keys: [...HAIR, ['cuff', 0], ['glove', 0], ['shoe', 0], ['shoeLight', 0.35], ['sole', -0.5]] },
    { id: 'suit', label: 'Suit', keys: [['coat', 0], ['coatShadow', -0.25], ['sleeve', 0], ['shirt', 0], ['shirtShadow', -0.25], ['pants', 0], ['pantsShadow', -0.25]] },
    CAPE,
    { id: 'emblem', label: 'Emblem & belt', keys: [['accent', 0], ['accentLight', 0.5], ['accentDark', -0.3]] },
    FACE,
  ],
  back(k, bx, ty, _hx, _hy, pose) { drawCape(k, bx, ty, pose, 4); },
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.coat, C.coatShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => (dx === h - 1 && r > 1 ? C.coatShadow : r >= 9 ? C.coatShadow : C.coat));
      // Chest: pec line, then the yellow oval with the black bat.
      b.ellipse(bx, ty + 4.5, 3.6, 2.4, C.accent);
      for (const [dx, dy] of [[-2, 3], [1, 3], [-3, 4], [-2, 4], [-1, 4], [0, 4], [1, 4], [2, 4], [-3, 5], [-1, 5], [0, 5], [2, 5]] as const) b.set(bx + dx, ty + dy, C.hairDeep);
      b.set(bx - 3, ty + 3, C.accentLight);
      // The utility belt and its buckle and pouches.
      b.rect(bx - 8, ty + 8, 16, 2, C.accentDark);
      b.rect(bx - 8, ty + 8, 16, 1, C.accent);
      b.rect(bx - 1, ty + 8, 2, 2, C.accentLight);
      b.rect(bx - 6, ty + 9, 2, 2, C.accentDark);
      b.rect(bx + 4, ty + 9, 2, 2, C.accentDark);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      faceShape(b, hx, hy, C.skin, 7.2);
      // The cowl: everything from the nose up and round the cheeks; the jaw and mouth stay bare.
      b.recolour(C.skin, C.hair, (x, y) => y + 0.5 < hy + 3.4 || (Math.abs(x + 0.5 - hx) > 6.2 && y + 0.5 < hy + 7.5));
      b.tri(hx - 9, hy - 4, hx - 3, hy - 7, hx - 9.5, hy - 16, C.hair);
      b.tri(hx + 9, hy - 4, hx + 3, hy - 7, hx + 9.5, hy - 16, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 4, 10, 10);
      // A hard brow, and a jaw with a little chin.
      for (let x = hx - 8; x <= hx + 7; x++) if (b.at(x, hy - 3) === C.hair) b.set(x, hy - 3, C.hairShadow);
      b.rect(hx - 1, hy + 9, 2, 1, C.skinShadow);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    slitEyes(k, hx, hy, pose.eyes, { w: 3, h: 2.4, sl: 1.3, fill: k.C.white, edge: k.C.hairOutline, dx: 0.5 });
    k.mouth(Math.round(hx), Math.round(hy), pose.mouth);
  },
};

/** Mirth — a cackling prankster: chalk-white face, green hair, a wide red grin that never closes, a purple coat. */
const jester: Hero = {
  info: { name: 'Mirth', title: 'A cackling prankster in purple with a grin that never stops — and neither does the laughing.' },
  look: {
    hairOutline: '#0e3a16', hair: '#35b84b', hairLight: '#7ee06a', hairShine: '#c8ffb0', hairShadow: '#238a35', hairDeep: '#145c24',
    skin: '#f5f2ea', skinShadow: '#d9d4c6', blush: '#ff9c98', mouth: '#c8102e', tongue: '#ff6f7d', iris: '#2a8a3c',
    coat: '#6a2fa0', coatShadow: '#46207a', sleeve: '#7a3fb4', cuff: '#46207a', glove: '#5e2a8c',
    shirt: '#2f9e44', shirtShadow: '#1f6f2f', pants: '#3f2a66', pantsShadow: '#2b1c4a', shoe: '#2a2332', shoeLight: '#e8e4f2', sole: '#111018',
    accent: '#ff8a1f', accentLight: '#ffc07a', accentDark: '#b85a00',
  },
  slots: [
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'coat', label: 'Coat', keys: [['coat', 0], ['coatShadow', -0.3], ['sleeve', 0.08], ['cuff', -0.3], ['glove', -0.1]] },
    { id: 'vest', label: 'Vest', keys: [['shirt', 0], ['shirtShadow', -0.3]] },
    { id: 'shirt', label: 'Shirt & tie', keys: [['accent', 0], ['accentLight', 0.4], ['accentDark', -0.3]] },
    { id: 'pants', label: 'Trousers', keys: [['pants', 0], ['pantsShadow', -0.3]] },
    { id: 'grin', label: 'Grin', keys: [['mouth', 0]] },
    FACE, EYES,
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.skin, C.skinShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        if (dx === h - 1 && r > 1) return C.coatShadow;
        return r === 10 ? C.coatShadow : C.coat;
      });
      // The open coat shows a green vest over an orange shirt, with a floppy tie.
      for (let r = 0; r < 9; r++) {
        b.rect(bx - 3, ty + r, 6, 1, r < 2 ? C.accent : C.shirt);
        if (r >= 2) { b.set(bx - 3, ty + r, C.shirtShadow); b.set(bx + 2, ty + r, C.shirtShadow); }
        b.set(bx - 4, ty + r, C.coatShadow);
        b.set(bx + 3, ty + r, C.coatShadow);
      }
      b.rect(bx - 1, ty + 1, 2, 5, C.accentDark);
      b.set(bx - 1, ty + 1, C.accentLight);
      // A flower on the lapel and a card in the pocket.
      b.set(bx + 5, ty + 2, C.white); b.set(bx + 6, ty + 2, C.white); b.set(bx + 5, ty + 3, C.accentLight);
      b.rect(bx - 6, ty + 6, 2, 2, C.white);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      faceShape(b, hx, hy, C.skin, 7.2);
      b.ellipse(hx, hy + 8.2, 4.2, 2.3, C.skin);
      // Wild green hair swept back, with a few spikes standing up.
      cap(b, hx, hy - 6, 10.8, 6.4, hy - 3.6, C.hair);
      b.rect(hx - 11, hy - 6, 2, 7, C.hair);
      b.rect(hx + 9, hy - 6, 2, 7, C.hair);
      for (const [x0, w, tx, ty2] of [[-9, 5, -12, -17], [-5, 5, -7, -19], [-1, 5, 1, -20], [3, 5, 8, -18], [6, 4, 13, -14]] as const) b.tri(hx + x0, hy - 8, hx + x0 + w, hy - 8, hx + tx, hy + ty2, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 7, 11, 8);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.05);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    const C = k.C;
    const x0 = Math.round(hx);
    const eyeY = Math.round(hy - 2);
    // Dark painted sockets round bright eyes: the stare.
    for (const ox of [x0 - 5, x0 + 5]) {
      k.main.ellipse(ox + 0.5, eyeY + 3, 4.6, 4.8, k.colour('#2a1a40'));
      k.main.ellipse(ox + 0.5, eyeY + 3, 3.2, 3.8, C.white);
    }
    k.eyeBox(x0 - 7, eyeY, pose.eyes, pose.look, false);
    k.eyeBox(x0 + 3, eyeY, pose.eyes, pose.look, true);
    // The grin is painted on: wide, scarred up to the cheeks, open when he laughs.
    const m = (x: number, y: number, c: number = C.mouth) => k.main.set(x0 + x, Math.round(hy) + 5 + y, c);
    const open = pose.mouth === 'laugh' || pose.mouth === 'shout' || pose.mouth === 'open' || pose.mouth === 'o' || pose.mouth === 'tongue';
    for (const s of [-1, 1] as const) {
      const edge = s < 0 ? -7 : 6;
      m(edge, -1); m(edge + s, -2); m(edge + 2 * s, -3);
      m(edge - s, 0); m(edge - 2 * s, 1);
    }
    if (open) {
      for (let x = -5; x <= 4; x++) { m(x, 1); m(x, 3); }
      for (let x = -4; x <= 3; x++) m(x, 2, C.mouth);
      for (let x = -4; x <= 3; x += 1) m(x, 1, C.white);
      for (let x = -3; x <= 2; x++) m(x, 2, C.hairDeep);
      m(-1, 2, C.tongue); m(0, 2, C.tongue); m(-2, 2, C.tongue); m(1, 2, C.tongue);
      m(-6, 2); m(5, 2);
    } else {
      for (let x = -5; x <= 4; x++) m(x, 1);
      for (let x = -4; x <= 3; x++) m(x, 2, C.white);
      for (let x = -5; x <= 4; x++) m(x, 3);
    }
  },
};

/** Barnaby — the perfect butler: swept-back silver hair, a moustache, white gloves, a tailcoat and bow tie. */
const butler: Hero = {
  info: { name: 'Barnaby', title: 'The perfect butler: silver moustache, white gloves, a tray, and impeccable manners.' },
  look: {
    hairOutline: '#5a5f6e', hair: '#d8dbe3', hairLight: '#f4f5f9', hairShine: '#ffffff', hairShadow: '#aeb3c0', hairDeep: '#868c9b',
    skin: '#f0c9a6', skinShadow: '#d9a883', coat: '#24242e', coatShadow: '#14141c', sleeve: '#2d2d38', cuff: '#ffffff', glove: '#ffffff',
    shirt: '#f4f5f9', shirtShadow: '#cdd4e4', pants: '#6b7080', pantsShadow: '#4c5060', shoe: '#14141c', shoeLight: '#5a5f78', sole: '#000000',
    accent: '#8c92a6', accentLight: '#c9d2e3', accentDark: '#5a5f78',
  },
  slots: [
    { id: 'hair', label: 'Hair & moustache', keys: HAIR },
    { id: 'coat', label: 'Tailcoat', keys: [['coat', 0], ['coatShadow', -0.3], ['sleeve', 0.05], ['shoe', 0]] },
    { id: 'shirt', label: 'Shirt & gloves', keys: [['shirt', 0], ['shirtShadow', -0.15], ['cuff', 0], ['glove', 0]] },
    { id: 'vest', label: 'Waistcoat', keys: [['accent', 0], ['accentLight', 0.4], ['accentDark', -0.3]] },
    { id: 'pants', label: 'Trousers', keys: [['pants', 0], ['pantsShadow', -0.25]] },
    FACE, EYES,
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.shirt, C.shirtShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => (dx === h - 1 && r > 1 ? C.coatShadow : C.coat));
      // The tailcoat opens on a white shirt front and a grey waistcoat.
      for (let r = 0; r < 10; r++) {
        const w = r < 4 ? 3 : 4;
        b.rect(bx - w, ty + r, w * 2, 1, r < 3 ? C.shirt : C.accent);
        b.set(bx - w - 1, ty + r, C.coatShadow);
        b.set(bx + w, ty + r, C.coatShadow);
      }
      b.rect(bx - 1, ty, 2, 2, C.shirt);
      // Bow tie.
      b.rect(bx - 3, ty + 1, 2, 2, C.hairDeep);
      b.rect(bx + 1, ty + 1, 2, 2, C.hairDeep);
      b.rect(bx - 1, ty + 1, 2, 1, C.accentDark);
      for (const r of [4, 6, 8]) b.set(bx, ty + r, C.white);
      // A watch chain.
      b.line(bx + 2, ty + 6, bx + 3, ty + 4, C.badge);
      b.set(bx + 2, ty + 7, C.badge);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      faceShape(b, hx, hy, C.skin, 7);
      // A full head of swept-back silver hair, with a sharp side parting and neat sideburns.
      cap(b, hx, hy - 5.5, 10, 6.2, hy - 4.2, C.hair);
      b.rect(hx - 10, hy - 5, 2, 6, C.hair);
      b.rect(hx + 8, hy - 5, 2, 6, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 6, 10, 7);
      ink(b, hx - 3, hy - 10, hx - 2, hy - 5, C.hairDeep);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.0);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    const C = k.C;
    const x0 = Math.round(hx);
    plainFace(k, hx, hy, pose, false);
    // Bushy brows and a curled moustache above the mouth.
    for (const [a, b] of [[-8, -3], [2, 7]] as const) for (let x = a; x <= b; x++) k.main.set(x0 + x, Math.round(hy) - 3, C.hairShadow);
    const y = Math.round(hy) + 4;
    for (let x = -4; x <= 3; x++) k.main.set(x0 + x, y, C.hair);
    for (let x = -3; x <= 2; x++) k.main.set(x0 + x, y + 1, C.hairShadow);
    k.main.set(x0 - 5, y - 1, C.hair);
    k.main.set(x0 + 4, y - 1, C.hair);
  },
};

/** Ferrox — powered armour in red and gold: a glowing arc in the chest, shining eye slits, palm blasters. */
const ironclad: Hero = {
  info: { name: 'Ferrox', title: 'Red-and-gold powered armour: boot jets, glowing chest reactor, palm blasts.' },
  flies: true,
  armW: 3.8,
  fist: 2.4,
  look: {
    hairOutline: '#2a0508', hair: '#c8222e', hairLight: '#ff5a5f', hairShine: '#ffc1c1', hairShadow: '#8c1620', hairDeep: '#5a0c14',
    skin: '#ecc04a', skinShadow: '#b98a1c', coat: '#c8222e', coatShadow: '#8c1620', sleeve: '#c8222e', cuff: '#d9a82e', glove: '#ecc04a',
    shirt: '#ecc04a', shirtShadow: '#b98a1c', pants: '#b81f2b', pantsShadow: '#7c121c', shoe: '#c8222e', shoeLight: '#ff5a5f', sole: '#d9a82e',
    accent: '#7df3ff', accentLight: '#ffffff', accentDark: '#2aa6c0', blush: '#ecc04a',
  },
  slots: [
    { id: 'armour', label: 'Red armour', keys: [...HAIR, ['coat', 0], ['coatShadow', -0.3], ['sleeve', 0], ['pants', 0], ['pantsShadow', -0.3], ['shoe', 0], ['shoeLight', 0.35]] },
    { id: 'gold', label: 'Gold plating', keys: [['skin', 0], ['skinShadow', -0.25], ['cuff', -0.05], ['glove', 0], ['shirt', 0], ['shirtShadow', -0.25], ['sole', -0.05]] },
    { id: 'core', label: 'Reactor & eyes', keys: [['accent', 0], ['accentDark', -0.35]] },
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.shirtShadow, C.hairDeep);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        const plate = r >= 1 && r <= 5 && Math.abs(dx + 0.5) < h - 1.2;
        if (dx === h - 1 && r > 1) return plate ? C.shirtShadow : C.coatShadow;
        if (r === 8 || r === 9) return C.shirt;
        return plate ? C.shirt : C.coat;
      });
      // Gold shoulders; the arc reactor, ringed and bright.
      b.rect(bx - 9, ty, 3, 3, C.shirt);
      b.rect(bx + 6, ty, 3, 3, C.shirt);
      b.set(bx - 9, ty, C.hairShine); b.set(bx + 6, ty, C.hairShine);
      b.ellipse(bx, ty + 3.4, 2.7, 2.7, C.accentDark);
      b.ellipse(bx, ty + 3.4, 1.9, 1.9, C.accent);
      b.ellipse(bx, ty + 3.4, 0.9, 0.9, C.accentLight);
      b.rect(bx - 1, ty + 9, 2, 1, C.accent);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      faceShape(b, hx, hy, C.hair, 7.8);
      // The faceplate: gold from the brow to the chin, narrowing to the jaw.
      b.recolour(C.hair, C.skin, (x, y) => {
        const dx = Math.abs(x + 0.5 - hx);
        const dy = y + 0.5 - hy;
        return dy > -3.6 && dx < 6.4 - Math.max(0, (dy - 3) * 0.4);
      });
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 1, 10, 9);
      b.recolour(C.skin, C.skinShadow, (x, y) => x + 0.5 > hx + 3.2 && y + 0.5 > hy + 1.5);
      b.rect(hx - 1, hy - 7, 2, 4, C.hairShadow);
      b.rect(hx - 2, hy + 6, 4, 1, C.hairDeep);
      b.set(hx - 4, hy - 1, k.colour('#fff3b0'));
      b.set(hx - 3, hy - 2, k.colour('#fff3b0'));
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    slitEyes(k, hx, hy, pose.eyes, { w: 3, h: 2.2, sl: 1.2, fill: k.colour('#e8ffff'), edge: k.C.accentDark, dx: 0.5 });
  },
};

/** Brutus — a giant green bruiser: a wide barrel chest, heavy brow, torn purple shorts, big fists. */
const brute: Hero = {
  info: { name: 'Brutus', title: 'A giant green bruiser: leaps whole panels, smashes clips, roars when he wins.' },
  armW: 5.4,
  fist: 3.4,
  legW: 4,
  look: {
    hairOutline: '#07060a', hair: '#1e1a24', hairLight: '#3a3446', hairShine: '#5c5470', hairShadow: '#14111a', hairDeep: '#0a080e',
    skin: '#68b840', skinShadow: '#4a9230', blush: '#68b840', iris: '#7fe04a', mouth: '#3a1a20',
    coat: '#68b840', coatShadow: '#4a9230', sleeve: '#68b840', cuff: '#4a9230',
    shirt: '#6a3fa8', shirtShadow: '#4a2a7c', pants: '#68b840', pantsShadow: '#4a9230', shoe: '#5aa636', shoeLight: '#88d060', sole: '#3a7a22',
  },
  slots: [
    { id: 'skin', label: 'Skin', keys: [['skin', 0], ['skinShadow', -0.25], ['coat', 0], ['coatShadow', -0.25], ['sleeve', 0], ['cuff', -0.25], ['pants', 0], ['pantsShadow', -0.25], ['shoe', -0.05], ['shoeLight', 0.25], ['sole', -0.3]] },
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'shorts', label: 'Shorts', keys: [['shirt', 0], ['shirtShadow', -0.3]] },
    EYES,
  ],
  torso(k, bx, ty) {
    const C = k.C;
    const widths = [8, 10, 11, 11, 11, 11, 10, 10, 9, 10, 10];
    k.part((b) => {
      b.rect(bx - 3, ty - 3, 6, 4, C.skin);
      trunk(b, bx, ty, widths, (r, dx, h) => {
        if (r >= 8) return dx === h - 1 ? C.shirtShadow : C.shirt;
        if (dx === h - 1 && r > 1) return C.coatShadow;
        return C.coat;
      });
      // Pecs, and the ladder of abs; a torn strap of shirt over the shoulder.
      for (let dx = -8; dx <= 7; dx++) if (Math.abs(dx + 0.5) > 1.5) ink(b, bx + dx, ty + 4 + (Math.abs(dx + 0.5) > 5 ? 0 : 1), bx + dx, ty + 4 + (Math.abs(dx + 0.5) > 5 ? 0 : 1), C.coatShadow);
      ink(b, bx - 1, ty + 1, bx - 1, ty + 7, C.coatShadow);
      for (const r of [5, 7]) { ink(b, bx - 4, ty + r, bx - 2, ty + r, C.coatShadow); ink(b, bx + 1, ty + r, bx + 3, ty + r, C.coatShadow); }
      for (let r = 8; r <= 10; r++) b.set(bx - 3 + (r % 2), ty + r, C.shirtShadow);
      b.rect(bx - 9, ty + 8, 3, 1, C.shirtShadow);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      b.ellipse(hx, hy + 0.5, 9.4, 7.2, C.skin);
      b.ellipse(hx, hy + 3.6, 8.4, 6.4, C.skin);
      // Low, heavy hair: a flat mass with a ragged fringe and a few spikes.
      cap(b, hx, hy - 6, 10.6, 6, hy - 3.2, C.hair);
      for (const [x0, tx, ty2] of [[-8, -12, -14], [-4, -7, -17], [0, 2, -17], [4, 9, -16]] as const) b.tri(hx + x0, hy - 8, hx + x0 + 5, hy - 8, hx + tx, hy + ty2, C.hair);
      for (const x of [-7, -4, -1, 3, 6]) b.tri(hx + x, hy - 4, hx + x + 3, hy - 4, hx + x + 1.5, hy - 2, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 7, 11, 7);
      // A square jaw and a heavy brow ridge.
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.05);
      b.rect(hx - 8, hy - 3, 16, 1, C.skinShadow);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    const x0 = Math.round(hx);
    // Always a scowl under the brows, whatever the eyes do.
    plainFace(k, hx, hy, { ...pose, eyes: pose.eyes === 'open' ? 'angry' : pose.eyes, mouth: pose.mouth === 'smile' ? 'flat' : pose.mouth }, false);
    for (const dx of [-3, 2]) k.main.set(x0 + dx, Math.round(hy) + 9, k.C.white);
  },
};

/** Axiom — an android sage: a red face, a golden gem on the brow, a green-and-gold suit and a billowing gold cape. */
const synth: Hero = {
  info: { name: 'Axiom', title: 'An android sage who hovers in a golden cape, mind-gem blazing, calm as the end of a render.' },
  flies: true,
  look: {
    hairOutline: '#3a0a10', hair: '#a82c36', hairLight: '#d9525a', hairShine: '#ff9a9a', hairShadow: '#82202a', hairDeep: '#5a141c',
    skin: '#c8363f', skinShadow: '#9a2430', blush: '#c8363f', iris: '#fff7cc', mouth: '#5a141c',
    coat: '#2f9e5a', coatShadow: '#1f7040', sleeve: '#2f9e5a', cuff: '#f0c030', glove: '#c8363f',
    shirt: '#f0c030', shirtShadow: '#c8982a', pants: '#2f9e5a', pantsShadow: '#1f7040', shoe: '#d8a82e', shoeLight: '#fff0a0', sole: '#a07a18',
    fur: '#f0c030', furLight: '#fff0a0', furShadow: '#c8982a', accent: '#ffe040', accentLight: '#ffffff', accentDark: '#c8982a',
  },
  slots: [
    { id: 'skin', label: 'Skin', keys: [['skin', 0], ['skinShadow', -0.25], ['glove', 0], ['hair', -0.1], ['hairLight', 0.15], ['hairShine', 0.4], ['hairShadow', -0.3], ['hairDeep', -0.45], ['hairOutline', -0.65]] },
    { id: 'suit', label: 'Suit', keys: [['coat', 0], ['coatShadow', -0.3], ['sleeve', 0], ['pants', 0], ['pantsShadow', -0.3]] },
    { id: 'gold', label: 'Gold trim', keys: [['shirt', 0], ['shirtShadow', -0.2], ['cuff', 0], ['shoe', 0], ['shoeLight', 0.5], ['sole', -0.25]] },
    CAPE,
    { id: 'gem', label: 'Mind gem', keys: [['accent', 0], ['accentDark', -0.25]] },
    EYES,
  ],
  back(k, bx, ty, _hx, _hy, pose) { drawCape(k, bx, ty, { ...pose, cape: pose.cape ?? 1 }, 0, true); },
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.skin, C.skinShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        const v = r < 4 && Math.abs(dx + 0.5) < 3.6 - r * 0.6;
        if (v) return C.skin;
        if (dx === h - 1 && r > 1) return C.coatShadow;
        return r >= 9 ? C.shirt : C.coat;
      });
      // Gold shoulder bands, a gold chest seam and belt.
      b.rect(bx - 8, ty, 4, 2, C.shirt);
      b.rect(bx + 4, ty, 4, 2, C.shirt);
      for (let r = 3; r < 9; r++) { b.set(bx - 1, ty + r, C.shirt); b.set(bx, ty + r, C.shirtShadow); }
      b.rect(bx - 7, ty + 8, 14, 1, C.shirt);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      faceShape(b, hx, hy, C.skin, 7.2);
      // A smooth bald dome, a shade darker on top, and the glowing gem on the brow.
      b.recolour(C.skin, C.hair, (_x, y) => y + 0.5 < hy - 4.2);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 4, 9, 4);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.0);
      b.ellipse(hx, hy - 5.6, 2, 2.2, C.accent);
      b.set(hx - 1, hy - 6.5, C.accentLight);
      b.set(hx, hy - 4.5, C.accentDark);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    // Calm, unblinking pale eyes; a small steady mouth.
    slitEyes(k, hx, hy, pose.eyes, { w: 2.4, h: 3.6, sl: 0.3, fill: k.C.iris, edge: k.C.hairDeep, dx: 0.5 });
    k.mouth(Math.round(hx), Math.round(hy), pose.mouth);
  },
};

/** Dart — a sharpshooting archer: a purple domino mask, bare arms with bracers, a quiver of arrows and a bow. */
const archer: Hero = {
  info: { name: 'Dart', title: 'A sharpshooting archer in a purple mask: never misses a clip, shoots from any panel.' },
  look: {
    hairOutline: '#4a3208', hair: '#c79a3a', hairLight: '#e8c060', hairShine: '#fbe9a0', hairShadow: '#a67a22', hairDeep: '#7a5614',
    skin: '#f3c9a6', skinShadow: '#e0a883', coat: '#6a3fb0', coatShadow: '#46288a', sleeve: '#f3c9a6', cuff: '#4a3a78', glove: '#3a2f5e',
    shirt: '#2a2540', shirtShadow: '#1a1630', pants: '#2c2848', pantsShadow: '#1e1a34', shoe: '#3a2f5e', shoeLight: '#6a58a0', sole: '#1e1a34',
    accent: '#7a4fd0', accentLight: '#a98bff', accentDark: '#4a2a90', band: '#6b4a2a', bandLight: '#9a7040', bandDark: '#4a3018',
  },
  slots: [
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'vest', label: 'Vest', keys: [['coat', 0], ['coatShadow', -0.3], ['shirt', 0], ['shirtShadow', -0.3]] },
    { id: 'mask', label: 'Mask & trim', keys: [['accent', 0], ['accentLight', 0.3], ['accentDark', -0.3], ['cuff', 0], ['glove', -0.1]] },
    { id: 'pants', label: 'Trousers & boots', keys: [['pants', 0], ['pantsShadow', -0.3], ['shoe', 0], ['shoeLight', 0.4], ['sole', -0.3]] },
    { id: 'quiver', label: 'Quiver', keys: [['band', 0], ['bandLight', 0.3], ['bandDark', -0.3]] },
    FACE, EYES,
  ],
  back(k, bx, ty) {
    const C = k.C;
    // A leather quiver slung behind the right shoulder, arrows poking out with white fletching.
    k.part((b) => {
      b.line(bx + 7, ty + 9, bx + 10, ty - 1, C.band, 4);
      b.line(bx + 7, ty + 8, bx + 9, ty + 1, C.bandLight, 1);
      for (const [x, y] of [[bx + 9, ty - 5], [bx + 11, ty - 4], [bx + 13, ty - 5]] as const) {
        b.line(x - 1, y + 5, x, y, C.steel, 1);
        b.rect(x - 1, y - 1, 2, 2, C.white);
      }
    }, C.bandDark);
  },
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.skin, C.skinShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        if (Math.abs(dx + 0.5) > h - 1.5 && r < 7) return C.shirt;
        if (dx === h - 1 && r > 1) return C.coatShadow;
        return r >= 8 ? C.shirt : C.coat;
      });
      // A bullseye on the chest, and the quiver strap across it.
      b.ring(bx, ty + 4.5, 3, 3, C.accentLight);
      b.ellipse(bx, ty + 4.5, 1.3, 1.3, C.accentLight);
      b.line(bx + 5, ty, bx - 5, ty + 9, C.band, 1.5);
      b.rect(bx - 8, ty + 8, 16, 1, C.cuff);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      faceShape(b, hx, hy, C.skin, 7.2);
      // Short, swept blond hair with a few spikes.
      cap(b, hx, hy - 6, 10.4, 6.2, hy - 4, C.hair);
      b.rect(hx - 10, hy - 6, 2, 5, C.hair);
      b.rect(hx + 8, hy - 6, 2, 5, C.hair);
      for (const [x0, tx, ty2] of [[-8, -9, -14], [-4, -4, -16], [0, 3, -16], [4, 9, -13]] as const) b.tri(hx + x0, hy - 8, hx + x0 + 5, hy - 8, hx + tx, hy + ty2, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 7, 11, 8);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.0);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    const C = k.C;
    const x0 = Math.round(hx);
    const eyeY = Math.round(hy - 2);
    // The domino mask, pointed at the temples, with white eye holes.
    k.part((b) => {
      b.rect(x0 - 10, eyeY - 1, 20, 7, C.accent);
      b.tri(x0 - 10, eyeY - 1, x0 - 10, eyeY + 3, x0 - 14, eyeY - 3, C.accent);
      b.tri(x0 + 10, eyeY - 1, x0 + 10, eyeY + 3, x0 + 14, eyeY - 3, C.accent);
      b.set(x0 - 10, eyeY - 1, 0); b.set(x0 + 9, eyeY - 1, 0);
      b.rect(x0 - 10, eyeY - 1, 20, 1, C.accentLight);
    }, C.accentDark);
    eyeHoles(k, hx, hy);
    plainFace(k, hx, hy, pose);
  },
};

/** Valor — a star-spangled soldier: a winged blue cowl with an A, a star on the chest, stripes below, red gauntlets. */
const patriot: Hero = {
  info: { name: 'Valor', title: 'A star-spangled shield-slinger: winged cowl, stars and stripes, a shield that always comes back.' },
  look: {
    hairOutline: '#0c1838', hair: '#2c4fa0', hairLight: '#4a74d4', hairShine: '#9ab8ff', hairShadow: '#1c367a', hairDeep: '#142658',
    skin: '#f3c9a6', skinShadow: '#e0a883', coat: '#2c4fa0', coatShadow: '#1c367a', sleeve: '#2c4fa0', cuff: '#c8222e', glove: '#c8222e',
    shirt: '#c8222e', shirtShadow: '#8c1620', pants: '#243f86', pantsShadow: '#182c60', shoe: '#8c1620', shoeLight: '#c8222e', sole: '#4a0a10',
    accent: '#ffffff', accentLight: '#ffffff', accentDark: '#c9d2e3', band: '#7a4a22', bandLight: '#a8703a', bandDark: '#4a2c12',
  },
  slots: [
    { id: 'blue', label: 'Blue suit & cowl', keys: [...HAIR, ['coat', 0], ['coatShadow', -0.3], ['sleeve', 0], ['pants', -0.1], ['pantsShadow', -0.35]] },
    { id: 'red', label: 'Red stripes & gauntlets', keys: [['shirt', 0], ['shirtShadow', -0.3], ['cuff', 0], ['glove', 0], ['shoe', -0.1], ['shoeLight', 0.3], ['sole', -0.5]] },
    { id: 'star', label: 'Star & wings', keys: [['accent', 0], ['accentLight', 0], ['accentDark', -0.2]] },
    { id: 'belt', label: 'Belt', keys: [['band', 0], ['bandLight', 0.3], ['bandDark', -0.3]] },
    FACE, EYES,
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.skin, C.skinShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => {
        const stripe = r >= 5 && r <= 8;
        if (dx === h - 1 && r > 1) return stripe ? (r % 2 ? C.accentDark : C.shirtShadow) : C.coatShadow;
        if (stripe) return r % 2 ? C.accent : C.shirt;
        return r >= 9 ? C.band : C.coat;
      });
      // A white star on the chest.
      for (const [dx, dy] of [[0, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [-1, 3], [0, 3], [1, 3], [-1, 4], [1, 4]] as const) b.set(bx + dx - 0, ty + dy, C.accent);
      b.rect(bx - 1, ty + 9, 2, 2, C.badge);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      faceShape(b, hx, hy, C.skin, 7.2);
      cap(b, hx, hy - 5, 9.8, 6, hy - 3.6, C.hair);
      // The cowl runs down over the ears and under the jaw line.
      b.recolour(C.skin, C.hair, (x, y) => (Math.abs(x + 0.5 - hx) > 7.6 && y + 0.5 < hy + 4) || y + 0.5 < hy - 3.6);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 4, 10, 8);
      // The white A on the brow, and a wing at each temple.
      for (const [dx, dy] of [[-1, -8], [0, -8], [-2, -7], [1, -7], [-2, -6], [-1, -6], [0, -6], [1, -6], [-2, -5], [1, -5]] as const) b.set(hx + dx, hy + dy, C.accent);
      b.tri(hx - 9.5, hy - 4, hx - 9.5, hy - 1, hx - 13, hy - 8, C.accent);
      b.tri(hx + 9.5, hy - 4, hx + 9.5, hy - 1, hx + 13, hy - 8, C.accent);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.0);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) { plainFace(k, hx, hy, pose); },
};

/** Shadowpaw — a stealthy panther king: a black cat-eared mask with sharp white eyes, a silver necklace, silver claws. */
const panther: Hero = {
  info: { name: 'Shadowpaw', title: 'A stealthy panther king in a black vibranium suit: silent pounces, claws out.' },
  look: {
    hairOutline: '#000000', hair: '#17181f', hairLight: '#2d303c', hairShine: '#5a5f78', hairShadow: '#0f1016', hairDeep: '#07080c',
    skin: '#4a2f22', skinShadow: '#331f16', blush: '#4a2f22', coat: '#17181f', coatShadow: '#0b0c12', sleeve: '#2a2d3c', cuff: '#c9d2e3', glove: '#17181f',
    shirt: '#242633', shirtShadow: '#14151c', pants: '#17181f', pantsShadow: '#0b0c12', shoe: '#14151c', shoeLight: '#3a3d52', sole: '#c9d2e3',
    accent: '#d8dfef', accentLight: '#ffffff', accentDark: '#8e99b8',
  },
  slots: [
    { id: 'suit', label: 'Suit & mask', keys: [...HAIR, ['coat', 0], ['coatShadow', -0.4], ['sleeve', 0.05], ['pants', 0], ['pantsShadow', -0.4], ['shoe', 0], ['shoeLight', 0.3], ['glove', 0], ['shirt', 0], ['shirtShadow', -0.4]] },
    { id: 'silver', label: 'Silver necklace & claws', keys: [['accent', 0], ['accentLight', 0.5], ['accentDark', -0.3], ['cuff', 0], ['sole', 0]] },
  ],
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.coat, C.coatShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => (dx === h - 1 && r > 1 ? C.coatShadow : (r > 1 && r < 7 && Math.abs(dx + 0.5) < h - 3) ? C.shirt : C.coat));
      // The silver necklace in a V, with an arrowhead on the chest.
      for (let i = 0; i <= 4; i++) { b.set(bx - 5 + i, ty + i, C.accent); b.set(bx + 4 - i, ty + i, C.accent); }
      b.set(bx - 1, ty + 5, C.accentLight); b.set(bx, ty + 5, C.accentLight);
      b.rect(bx - 1, ty + 6, 2, 2, C.accentDark);
      b.rect(bx - 8, ty + 8, 16, 1, C.accentDark);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      faceShape(b, hx, hy, C.hair, 7.4);
      // Two short cat ears.
      b.tri(hx - 9, hy - 4, hx - 3.5, hy - 7, hx - 8.5, hy - 14, C.hair);
      b.tri(hx + 9, hy - 4, hx + 3.5, hy - 7, hx + 8.5, hy - 14, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 3, 10, 10);
      // A sheen along the brow and the nose.
      for (let x = -7; x <= 6; x++) ink(b, hx + x, hy - 4 + Math.abs(x + 0.5) * 0.15, hx + x, hy - 4 + Math.abs(x + 0.5) * 0.15, C.hairLight);
      ink(b, hx - 0.5, hy + 1, hx - 0.5, hy + 6, C.hairLight);
      b.set(hx - 1, hy + 7, C.hairDeep); b.set(hx, hy + 7, C.hairDeep);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    slitEyes(k, hx, hy, pose.eyes, { w: 3.2, h: 2.2, sl: 1.5, fill: k.C.white, edge: k.C.hairOutline, dx: 0.5 });
  },
};

/** Vayuveer — a golden desi hero: long black hair, a headband with a sun gem, a gold tunic with a chakra on the chest and a red sash. */
const chakra: Hero = {
  info: { name: 'Vayuveer', title: 'A golden desi hero with a chakra on his chest who spins into a whirlwind and flies.' },
  flies: true,
  look: {
    hairOutline: '#050407', hair: '#1b1620', hairLight: '#3a3040', hairShine: '#6a5a80', hairShadow: '#120e16', hairDeep: '#0a080e',
    skin: '#d49a68', skinShadow: '#b87a4a', blush: '#e08a6a', coat: '#f2b01e', coatShadow: '#c98a10', sleeve: '#f2b01e', cuff: '#c8222e',
    shirt: '#c8222e', shirtShadow: '#8c1620', pants: '#b3202c', pantsShadow: '#7c121c', shoe: '#f2b01e', shoeLight: '#ffe08a', sole: '#a8760a',
    accent: '#2a6fd4', accentLight: '#8fc0ff', accentDark: '#16408a', band: '#ffd23d', bandLight: '#fff0a0', bandDark: '#c89212',
  },
  slots: [
    { id: 'hair', label: 'Hair', keys: HAIR },
    { id: 'tunic', label: 'Golden tunic', keys: [['coat', 0], ['coatShadow', -0.25], ['sleeve', 0], ['shoe', 0], ['shoeLight', 0.5], ['sole', -0.35]] },
    { id: 'sash', label: 'Sash & cuffs', keys: [['shirt', 0], ['shirtShadow', -0.3], ['cuff', 0]] },
    { id: 'pants', label: 'Trousers', keys: [['pants', 0], ['pantsShadow', -0.3]] },
    { id: 'chakra', label: 'Chakra', keys: [['accent', 0], ['accentLight', 0.5], ['accentDark', -0.3]] },
    { id: 'band', label: 'Headband', keys: [['band', 0], ['bandLight', 0.4], ['bandDark', -0.25]] },
    FACE, EYES,
  ],
  back(k, _bx, _ty, hx, hy, pose) {
    const C = k.C;
    const sway = pose.sway ?? 0;
    // Long hair falling behind the shoulders.
    k.part((b) => {
      b.ellipse(hx, hy - 3, 11, 9, C.hair);
      for (let y = hy; y <= hy + 14; y++) {
        const t = (y - hy) / 14;
        const half = Math.round(11 - t * 3);
        b.rect(hx - half + Math.round(-sway * t * 2.5), y, half * 2, 1, C.hair);
      }
      b.recolour(C.hair, C.hairShadow, (x) => x + 0.5 > hx + 6);
    }, C.hairOutline);
  },
  torso(k, bx, ty) {
    const C = k.C;
    k.part((b) => {
      neck(b, bx, ty, C.skin, C.skinShadow);
      trunk(b, bx, ty, k.COAT, (r, dx, h) => (dx === h - 1 && r > 1 ? C.coatShadow : r >= 9 ? C.shirt : C.coat));
      // The red sash across the chest, from the left shoulder to the right hip.
      b.line(bx - 6, ty, bx + 6, ty + 9, C.shirt, 2.2);
      b.line(bx - 6, ty + 1, bx + 5, ty + 9, C.shirtShadow, 1);
      // A V of skin at the throat, and the blue chakra wheel with spokes.
      b.rect(bx - 1, ty, 2, 1, C.skin);
      b.ellipse(bx + 2, ty + 4.5, 3, 3, C.accentDark);
      b.ellipse(bx + 2, ty + 4.5, 2.1, 2.1, C.accent);
      for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) b.set(bx + 2 + dx, ty + 4 + dy, C.accentLight);
      b.set(bx + 2, ty + 4, C.badge);
      b.rect(bx - 8, ty + 9, 16, 1, C.shirtShadow);
    });
  },
  head(k, hx, hy) {
    const C = k.C;
    k.part((b) => {
      ears(b, hx, hy, C.skin, C.skinShadow);
      faceShape(b, hx, hy, C.skin, 7.2);
      // Side-parted black hair framing the face, with a golden headband and a sun gem.
      cap(b, hx, hy - 5.5, 10.6, 6.6, hy - 3.8, C.hair);
      b.rect(hx - 11, hy - 6, 3, 9, C.hair);
      b.rect(hx + 8, hy - 6, 3, 9, C.hair);
      k.shade(b, C.hair, C.hairLight, C.hairShadow, hx, hy - 6, 11, 8);
      ink(b, hx - 2, hy - 11, hx - 3, hy - 4, C.hairDeep);
      b.rect(hx - 10, hy - 7, 20, 2, C.band);
      b.rect(hx - 10, hy - 7, 20, 1, C.bandLight);
      b.rect(hx - 10, hy - 6, 20, 1, C.bandDark);
      b.ellipse(hx, hy - 6.4, 1.8, 1.8, C.shirt);
      b.set(hx - 1, hy - 7, C.accentLight);
      b.recolour(C.skin, C.skinShadow, (x, y) => ((x + 0.5 - hx) / 9) * 0.55 + ((y + 0.5 - hy) / 9) * 0.83 > 1.0);
    }, C.hairOutline);
  },
  face(k, hx, hy, pose) {
    const C = k.C;
    const x0 = Math.round(hx);
    plainFace(k, hx, hy, pose);
    // A neat moustache.
    const y = Math.round(hy) + 4;
    for (let x = -3; x <= 2; x++) k.main.set(x0 + x, y, C.hairShadow);
    k.main.set(x0 - 4, y + 1, C.hairShadow);
    k.main.set(x0 + 3, y + 1, C.hairShadow);
  },
};

export const HEROES: Record<HeroId, Hero> = { spider, bat, jester, butler, ironclad, brute, synth, archer, patriot, panther, chakra };
export const HERO_IDS = Object.keys(HEROES) as HeroId[];
export const isHero = (id: string | undefined): id is HeroId => !!id && id in HEROES;

// ── hero-only props (what they hold and what flows from their hands) ───────

/** Draws a hero prop; returns false for props sprite.ts draws itself. `r`/`l` are the hands. */
export function drawHeroProp(k: Kit, prop: Prop, hands: { l: readonly [number, number]; r: readonly [number, number] }, bx: number): boolean {
  const C = k.C;
  const [rx, ry] = hands.r;
  const [lx, ly] = hands.l;
  switch (prop.kind) {
    case 'boomerang':
      // A bat-winged throwing blade held by a wing; `angle` turns it as it spins.
      k.part((b) => {
        const a = (prop.angle * Math.PI) / 180;
        const x = rx + 4;
        const y = ry - 3;
        const wing = (s: number) => {
          const tx = x + Math.cos(a + s * 0.9) * 7;
          const ty = y + Math.sin(a + s * 0.9) * 7;
          b.tri(x, y, tx, ty, x + Math.cos(a + s * 0.3) * 3, y + Math.sin(a + s * 0.3) * 3, C.steelDark);
        };
        wing(-1); wing(1);
        b.ellipse(x, y, 1.4, 1.4, C.steel);
      });
      return true;
    case 'shield':
      // A round shield on the forearm: red ring, white ring, blue field and a star.
      k.part((b) => {
        const x = lx + 1;
        const y = ly - 1;
        b.ellipse(x, y, 7.6, 7.6, C.shirt);
        b.ellipse(x, y, 5.9, 5.9, C.accent);
        b.ellipse(x, y, 4.4, 4.4, C.shirt);
        b.ellipse(x, y, 3, 3, C.coat);
        for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [1, 1]] as const) b.set(Math.round(x) + dx, Math.round(y) + dy, C.accent);
        b.set(Math.round(x) - 5, Math.round(y) - 5, C.white);
      });
      return true;
    case 'bow':
      // A recurve bow held on the right hand; the left hand draws the string back by `draw`.
      k.part((b) => {
        const x = rx + 3;
        const wood = k.colour('#8a5a30');
        b.line(x, ry - 10, x + 3, ry, wood, 1.8);
        b.line(x + 3, ry, x, ry + 10, wood, 1.8);
        const pullX = x - 1 + (lx - (x - 1)) * prop.draw;
        const pullY = ry + (ly - ry) * prop.draw;
        b.line(x, ry - 10, pullX, pullY, C.white, 1);
        b.line(pullX, pullY, x, ry + 10, C.white, 1);
        if (prop.draw > 0.2) {
          b.line(pullX, pullY, x + 8, ry, C.steel, 1);
          b.tri(x + 8, ry - 1.5, x + 8, ry + 1.5, x + 11, ry, C.white);
        }
      }, C.bandDark);
      return true;
    case 'tray':
      // A silver tray held flat at the hand, with a teapot and a cup; steam rises when `steam`.
      k.part((b) => {
        const x = lx + 5;
        const y = ly - 2;
        b.ellipse(x, y + 1, 8.2, 1.4, C.steel);
        b.rect(x - 8, y, 16, 1, C.white);
        b.rect(x - 5, y - 4, 5, 4, C.white);
        b.rect(x - 6, y - 5, 7, 1, C.steelDark);
        b.rect(x - 1, y - 3, 2, 2, C.white);
        b.rect(x + 3, y - 3, 3, 3, C.white);
        b.set(x + 4, y - 2, C.hairShadow);
        if (prop.steam) { b.set(x - 3, y - 7 - (prop.steam % 2), C.steel); b.set(x + 4, y - 6 + (prop.steam % 2), C.steel); }
      }, C.pupil);
      return true;
    case 'glow': {
      // Energy gathering at a hand: web fluid, a repulsor, a claw's shine.
      const spots = prop.hand === 'both' ? [hands.l, hands.r] : prop.hand === 'L' ? [hands.l] : [hands.r];
      const outer = k.colour(prop.color);
      for (const [x, y] of spots) {
        k.main.ellipse(x + 1, y, 1.6 + prop.size, 1.6 + prop.size, outer);
        k.main.ellipse(x + 1, y, 0.8 + prop.size * 0.5, 0.8 + prop.size * 0.5, C.white);
      }
      return true;
    }
    case 'claws':
      // Three silver claws out of the right fist.
      for (const dy of [-2, 0, 2]) {
        k.main.line(rx + 2, ry + dy * 0.5, rx + 6 + prop.out * 2, ry + dy * 1.2 - 1, C.accent);
        k.main.set(Math.round(rx + 6 + prop.out * 2), Math.round(ry + dy * 1.2 - 1), C.accentLight);
      }
      return true;
    case 'card':
      // A big playing card between two fingers.
      k.part((b) => {
        const x = rx + 5;
        const y = ry - 4 - prop.flip;
        b.rect(x - 3, y - 4, 6, 8, C.white);
        b.set(x - 2, y - 3, C.mouth); b.set(x - 1, y - 3, C.mouth);
        b.set(x, y + 1, C.mouth); b.set(x - 1, y, C.mouth); b.set(x + 1, y, C.mouth);
        b.set(x + 1, y + 3, C.mouth);
      }, C.pupil);
      return true;
    case 'whirl': {
      // A spiral of wind circling the whole body.
      const col = k.colour('#e8f4ff');
      for (let i = 0; i < 3; i++) {
        const a = prop.phase * 6.28 * 2 + i * 1.57;
        const y = k.FEET_Y - 8 - i * 10;
        const half = 15 - i * 1.5;
        for (let s = -half; s <= half; s += 1) {
          const arc = Math.sin(a + s * 0.12) * 1.5;
          k.main.set(Math.round(bx + s), Math.round(y + arc), col);
        }
        k.main.set(Math.round(bx - half), Math.round(y), k.colour('#9cc4ee'));
        k.main.set(Math.round(bx + half), Math.round(y), k.colour('#9cc4ee'));
      }
      return true;
    }
    default: return false;
  }
}
