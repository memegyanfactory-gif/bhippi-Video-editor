// The avatar in the user's hand: a body hanging from the exact point the mouse grabbed, simulated
// as a weight (its centre of mass) on a slightly springy rod from that grip. It behaves like a
// playground swing: moving or shaking the mouse swings it — as high as a swing goes, never over the
// top — and only winding the mouse round in fast circles takes it right round the cursor, as fast
// as the circles go. A hard yank stretches it a little; a throw leaves with the body's real velocity
// and spin. Pure, so it is tested (tests/avatarSwing.test.ts).

export type Vec = { x: number; y: number };

export type Swing = {
  /** Where the grip is (the pointer), and where it was last step. */
  pivot: Vec;
  /** The centre of mass, and where it was one sub-step ago (Verlet). */
  bob: Vec;
  prevBob: Vec;
  /** The rod: grip → centre of mass in the body's own (unrotated) frame, and its rest length. */
  arm: Vec;
  rest: number;
  /** Body rotation, radians (screen coordinates: positive turns clockwise), and its rate. */
  angle: number;
  spin: number;
  /** The sub-step length the last step used, for velocities. */
  h: number;
  /** How far the pointer has been winding round (radians, signed, fading ~1.3/s): circles, not shakes. */
  winding: number;
  /** The pointer's last direction of travel, for the winding. */
  heading: number | null;
};

export type SwingOptions = {
  /** px/s². The avatar's own gravity, so held and falling feel the same. */
  gravity: number;
  /** Air drag per second on the swing (0 swings for ever; 1.1 settles a grabbed toy in a few seconds). */
  drag?: number;
  /** How hard the rod pulls back to its length per sub-step (1 = rigid). */
  stiffness?: number;
  /** Friction at the grip, per second: damps the body turning about the hand (not its travel with it). */
  friction?: number;
  /** Gravity on the body while held, times `gravity`: a heavier swing needs a real wind-up to go over the top. */
  heft?: number;
};

const len = (v: Vec) => Math.hypot(v.x, v.y);
const MIN_ARM = 10;
/** Sub-steps per second: a fast mouse can move far in one frame; small steps keep it stable. */
const RATE = 480;
/** px/s the body may reach (a flick can spike the pointer). */
const MAX_SPEED = 7000;

/**
 * Starts holding: `pointer` is the grip, `com` the body's centre of mass on screen and `angle` its
 * rotation now (degrees). The body neither jumps nor turns at the grab; the physics takes it from
 * there.
 */
export function startSwing(pointer: Vec, com: Vec, angleDeg: number): Swing {
  const a = (angleDeg * Math.PI) / 180;
  // The grip → centre-of-mass vector as the body is posed now, back into the body's own frame.
  const world = { x: com.x - pointer.x, y: com.y - pointer.y };
  let arm = { x: world.x * Math.cos(-a) - world.y * Math.sin(-a), y: world.x * Math.sin(-a) + world.y * Math.cos(-a) };
  // Grabbed at (almost) its centre: hang it from just above, so it still has a way to swing.
  if (len(arm) < MIN_ARM) arm = { x: 0, y: MIN_ARM };
  const rest = len(arm);
  // The centre of mass: the grip plus the rod as the body is turned now (the body's own centre, unless that was the grip).
  const bob = { x: pointer.x + arm.x * Math.cos(a) - arm.y * Math.sin(a), y: pointer.y + arm.x * Math.sin(a) + arm.y * Math.cos(a) };
  return { pivot: { ...pointer }, bob, prevBob: { ...bob }, arm, rest, angle: a, spin: 0, h: 1 / RATE, winding: 0, heading: null };
}

/** The body rotation that puts its centre of mass where the rod points. */
function bodyAngle(s: Swing): number {
  const d = { x: s.bob.x - s.pivot.x, y: s.bob.y - s.pivot.y };
  return Math.atan2(d.y, d.x) - Math.atan2(s.arm.y, s.arm.x);
}

/** Unwraps `next` to the turn nearest `prev`, so spinning past ±180° is counted, not reversed. */
function unwrap(prev: number, next: number): number {
  let out = next;
  while (out - prev > Math.PI) out -= Math.PI * 2;
  while (out - prev < -Math.PI) out += Math.PI * 2;
  return out;
}

/** How high a swing goes without winding: past this it would go over the top (radians from hanging). */
const SWING_LIMIT = (100 * Math.PI) / 180;
/** The winding (radians) at which circling the mouse takes it over the top: a full turn, kept up (it fades). */
const WOUND = Math.PI * 2.6;
/** Pointer speeds below this (px/s) are too slow to count as circling. */
const CIRCLE_SPEED = 340;

/**
 * Tracks the pointer circling: the turn of its direction of travel between frames, summed and
 * fading over half a second or so. Circles add up one way; a shake reverses (a half turn each
 * time, which is not counted) and a straight move does not turn at all.
 */
function wind(s: Swing, pointer: Vec, dt: number) {
  const dx = pointer.x - s.pivot.x;
  const dy = pointer.y - s.pivot.y;
  s.winding *= Math.exp(-dt * 1.3);
  if (Math.hypot(dx, dy) / dt < CIRCLE_SPEED) return;
  const heading = Math.atan2(dy, dx);
  if (s.heading !== null) {
    let turn = heading - s.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    if (Math.abs(turn) < 1.4) s.winding += turn;
  }
  s.heading = heading;
}

/** Whether the pointer is winding round fast enough to take the body over the top. */
export const circling = (s: Swing): boolean => Math.abs(s.winding) >= WOUND;

/** Advances the held body `dt` seconds with the grip moved to `pointer`. */
export function stepSwing(s: Swing, pointer: Vec, dt: number, options: SwingOptions): void {
  const dtc = Math.min(Math.max(dt, 0), 0.05);
  if (dtc <= 0) return;
  const steps = Math.max(1, Math.ceil(dtc * RATE));
  const h = dtc / steps;
  const drag = options.drag ?? 1.6;
  const stiffness = options.stiffness ?? 0.55;
  const friction = options.friction ?? 4;
  const gravity = options.gravity * (options.heft ?? 2.2);
  wind(s, pointer, dtc);
  const free = circling(s);
  const from = s.pivot;
  const before = s.angle;
  let angle = s.angle;
  for (let i = 1; i <= steps; i++) {
    // The grip glides to the pointer across the sub-steps: a jump of the mouse is a fast move, not a teleport.
    const k = i / steps;
    const pivot = { x: from.x + (pointer.x - from.x) * k, y: from.y + (pointer.y - from.y) * k };
    const last = i === 1 ? from : { x: from.x + (pointer.x - from.x) * ((i - 1) / steps), y: from.y + (pointer.y - from.y) * ((i - 1) / steps) };
    const keep = Math.max(0, 1 - drag * h);
    let vx = (s.bob.x - s.prevBob.x) * keep;
    let vy = (s.bob.y - s.prevBob.y) * keep;
    if (friction > 0) {
      // Grip friction: only the turning about the hand is slowed, so the body still travels with it.
      const rx = s.bob.x - pivot.x;
      const ry = s.bob.y - pivot.y;
      const rl = Math.hypot(rx, ry) || 1;
      const tx = -ry / rl;
      const ty = rx / rl;
      const relative = (vx - (pivot.x - last.x)) * tx + (vy - (pivot.y - last.y)) * ty;
      const cut = relative * Math.min(1, friction * h);
      vx -= tx * cut;
      vy -= ty * cut;
    }
    const cap = MAX_SPEED * h;
    const speed = Math.hypot(vx, vy);
    if (speed > cap) { vx *= cap / speed; vy *= cap / speed; }
    if (!free) {
      // Like a swing's chains: it goes as high as it is pushed, up to a point, and never over the
      // top unless the hand winds it round. The swing's energy about the grip is capped there.
      const rx = s.bob.x - pivot.x;
      const ry = s.bob.y - pivot.y;
      const rl = Math.hypot(rx, ry) || 1;
      const tx = -ry / rl;
      const ty = rx / rl;
      const px = pivot.x - last.x;
      const py = pivot.y - last.y;
      const relative = ((vx - px) * tx + (vy - py) * ty) / h;
      const fromDown = Math.acos(Math.max(-1, Math.min(1, ry / rl)));
      const room = gravity * rl * (Math.cos(fromDown) - Math.cos(SWING_LIMIT));
      if (room <= 0) {
        // Past the limit: it stops rising and falls back. (Turning the positive way swings the body
        // leftward, so it is climbing when that runs against the side it is on.)
        if (relative * (rx >= 0 ? 1 : -1) < 0) { vx -= tx * relative * h; vy -= ty * relative * h; }
      } else {
        const most = Math.sqrt(2 * room);
        if (Math.abs(relative) > most) {
          const cut = (Math.abs(relative) - most) * Math.sign(relative) * h;
          vx -= tx * cut;
          vy -= ty * cut;
        }
      }
    }
    s.prevBob = { ...s.bob };
    s.bob = { x: s.bob.x + vx, y: s.bob.y + vy + gravity * h * h };
    // The rod: springy (a yank stretches it a little), never slack or long past its limits.
    const d = { x: s.bob.x - pivot.x, y: s.bob.y - pivot.y };
    const l = len(d) || 1e-6;
    let target = l + (s.rest - l) * stiffness;
    target = Math.min(s.rest * 1.3, Math.max(s.rest * 0.85, target));
    s.bob = { x: pivot.x + (d.x / l) * target, y: pivot.y + (d.y / l) * target };
    s.pivot = pivot;
    angle = unwrap(angle, bodyAngle(s));
  }
  s.h = h;
  s.spin = (angle - before) / dtc;
  s.angle = angle;
}

/** The rod's stretch now: 0 at rest, positive when yanked long, negative when squashed. */
export const swingStretch = (s: Swing): number => len({ x: s.bob.x - s.pivot.x, y: s.bob.y - s.pivot.y }) / s.rest - 1;

/** What a release throws: the centre of mass's velocity (px/s) and the body's spin (degrees/s). */
export function releaseOf(s: Swing): { velocity: Vec; spin: number } {
  const v = { x: (s.bob.x - s.prevBob.x) / s.h, y: (s.bob.y - s.prevBob.y) / s.h };
  const speed = len(v);
  const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
  // A throw keeps some of the swing's turn, not all of it: a toy tumbles, it does not whirl.
  return { velocity: { x: v.x * scale * 0.85, y: v.y * scale * 0.85 }, spin: Math.max(-720, Math.min(720, ((s.spin * 180) / Math.PI) * 0.5)) };
}

/** Degrees, for drawing. */
export const swingDegrees = (s: Swing): number => (s.angle * 180) / Math.PI;
