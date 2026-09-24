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
} as const;

const C = Object.fromEntries(Object.entries(PALETTE).map(([key, hex]) => [key, rgb(hex)])) as Record<keyof typeof PALETTE, number>;
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
function part(draw: (b: Buf) => void, outline: number = C.outline) {
  scratch.clear();
  draw(scratch);
  const src = scratch.data;
  const dst = main.data;
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
  if (pose.blush) for (const x of [x0 - 9, x0 - 8, x0 + 7, x0 + 8]) main.set(x, hy + 4, C.blush);
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
    b.ellipse(hx - (dx / len) * 1.8, hy - (dy / len) * 1.8, 1.5, 1.5, C.coatShadow);
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
        // The Helios sun on the lid, brighter while a page loads.
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

/** Props drawn between the torso and the hands (held in front, hands on top). */
const MID_PROPS = new Set<Prop['kind']>(['laptop', 'mixer', 'flipbook', 'clip']);

/** Renders a pose into the shared buffer and returns its pixels (RGBA, ART_W×ART_H). */
export function renderPose(pose: Pose): Uint8ClampedArray<ArrayBuffer> {
  main.clear();
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
  drawPack(bx, ty);
  if (pose.armLBack) arm('L');
  if (pose.armRBack) arm('R');
  drawLegs(pose, ty);
  drawTorso(bx, ty);
  part((b) => drawHair(b, hx, hy, pose.sway ?? 0), C.hairOutline);
  part((b) => drawHead(b, hx, hy), C.hairOutline);
  drawBand(hx, hy);
  drawFace(hx, hy, pose);
  drawGear(hx, hy, pose.gear ?? []);
  for (const prop of props) if (MID_PROPS.has(prop.kind)) drawProp(prop, hands, bx);
  if (!pose.armLBack) arm('L');
  if (!pose.armRBack) arm('R');
  for (const prop of props) if (!MID_PROPS.has(prop.kind)) drawProp(prop, hands, bx);
  return new Uint8ClampedArray(main.data.buffer.slice(0));
}

/** Where a hand ends up in art pixels, for effects that start at the hand (sparks, notes). */
export function handPoint(pose: Pose, which: 'l' | 'r'): [number, number] {
  const drop = pose.sit ? SIT_DROP[pose.sit] : 0;
  const ty = TORSO_Y + pose.y + drop;
  const bx = CX + pose.lean;
  return which === 'l' ? [bx - 7 + pose.armL[0], ty + 2 + pose.armL[1]] : [bx + 6 + pose.armR[0], ty + 2 + pose.armR[1]];
}

/** Paints a pose onto a canvas that is ART_W×ART_H pixels. */
export function paint(ctx: CanvasRenderingContext2D, pose: Pose) {
  ctx.putImageData(new ImageData(renderPose(pose), ART_W, ART_H), 0, 0);
}
