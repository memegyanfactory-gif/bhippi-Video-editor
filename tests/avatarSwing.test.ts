import { describe, expect, it } from 'vitest';
import { releaseOf, startSwing, stepSwing, swingDegrees, swingStretch, type Vec } from '../src/avatar/swing';

const G = { gravity: 2600 };
const FRAME = 1 / 60;
/** Runs `seconds` of frames with the pointer at `at(t)`. */
function run(start: Vec, com: Vec, seconds: number, at: (t: number) => Vec, angle = 0) {
  const s = startSwing(start, com, angle);
  let min = Infinity;
  let max = -Infinity;
  for (let t = FRAME; t <= seconds + 1e-9; t += FRAME) {
    stepSwing(s, at(t), FRAME, G);
    const deg = swingDegrees(s);
    min = Math.min(min, deg);
    max = Math.max(max, deg);
    expect(Number.isFinite(s.bob.x) && Number.isFinite(s.bob.y)).toBe(true);
    expect(swingStretch(s)).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(swingStretch(s)).toBeGreaterThanOrEqual(-0.15 - 1e-9);
  }
  return { s, min, max };
}

describe('the avatar in the hand', () => {
  it('neither jumps nor turns at the grab, and hangs straight below a still grip', () => {
    const grip = { x: 400, y: 300 };
    const s = startSwing(grip, { x: 400, y: 352 }, 0);
    expect(s.bob).toEqual({ x: 400, y: 352 });
    expect(swingDegrees(s)).toBeCloseTo(0, 6);
    const { s: after } = run(grip, { x: 400, y: 352 }, 3, () => grip);
    expect(Math.abs(swingDegrees(after))).toBeLessThan(2);
  });

  it('swings down from where it was grabbed: held by the feet it ends up hanging upside down', () => {
    const grip = { x: 400, y: 300 };
    // Grabbed below its centre of mass (the feet), nudged off balance.
    const { s } = run(grip, { x: 401, y: 256 }, 7, () => grip);
    expect(Math.abs(Math.abs(swingDegrees(s) % 360) - 180)).toBeLessThan(12);
  });

  it('swings with a shake of the mouse, and keeps swinging for a moment after it stops', () => {
    const { min, max, s } = run({ x: 400, y: 300 }, { x: 400, y: 352 }, 1.5, (t) => ({ x: 400 + Math.sin(t * Math.PI * 2 * 3) * 60, y: 300 }));
    expect(max - min).toBeGreaterThan(40);
    const still = { x: s.pivot.x, y: s.pivot.y };
    const swinging: number[] = [];
    for (let i = 0; i < 20; i++) { stepSwing(s, still, FRAME, G); swinging.push(swingDegrees(s)); }
    expect(Math.max(...swinging) - Math.min(...swinging)).toBeGreaterThan(5);
  });

  it('moving or shaking the mouse swings it like a playground swing, and never takes it over the top', () => {
    const shakes = [
      (t: number) => ({ x: 400 + Math.sin(t * Math.PI * 2 * 5) * 40, y: 300 }),
      (t: number) => ({ x: 400 + Math.sin(t * Math.PI * 2 * 7) * 80, y: 300 + Math.cos(t * Math.PI * 2 * 3) * 30 }),
      (t: number) => ({ x: 400 + (Math.floor(t * 60) % 2 ? 70 : -70), y: 300 }),
      (t: number) => ({ x: 400 + Math.min(t, 0.3) * 1800, y: 300 }),
      (t: number) => ({ x: 400, y: 300 + Math.sin(t * Math.PI * 2 * 6) * 60 }),
    ];
    for (const [i, at] of shakes.entries()) {
      const { min, max } = run(at(0), { x: at(0).x, y: at(0).y + 52 }, 2, at);
      // Side to side it swings; straight up and down a hanging swing only bobs, as a real one does.
      if (i < 4) expect(max - min).toBeGreaterThan(10);
      expect(Math.max(Math.abs(min), Math.abs(max))).toBeLessThan(180);
    }
  });

  it('goes right round the cursor when the mouse circles fast enough, and not when it circles slowly', () => {
    const circle = (turnsPerSecond: number) => (t: number) => ({ x: 400 + Math.cos(t * Math.PI * 2 * turnsPerSecond) * 40, y: 300 + Math.sin(t * Math.PI * 2 * turnsPerSecond) * 40 });
    const fast = run({ x: 440, y: 300 }, { x: 440, y: 352 }, 3, circle(2.5));
    expect(Math.abs(swingDegrees(fast.s))).toBeGreaterThan(360);
    const slow = run({ x: 440, y: 300 }, { x: 440, y: 352 }, 3, circle(0.2));
    expect(slow.max - slow.min).toBeLessThan(90);
  });

  it('throws with the body\'s real velocity and spin', () => {
    const { s } = run({ x: 200, y: 300 }, { x: 200, y: 352 }, 0.3, (t) => ({ x: 200 + t * 1500, y: 300 }));
    const thrown = releaseOf(s);
    // It leaves fast, in the direction of the throw (the body trails the hand a little on the springy grip).
    expect(thrown.velocity.x).toBeGreaterThan(300);
    // Dragged right, the body trails behind and swings: it leaves turning.
    expect(Math.abs(thrown.spin)).toBeGreaterThan(20);
  });

  it('stays stable when the pointer jumps about', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    run({ x: 500, y: 400 }, { x: 500, y: 452 }, 2, () => ({ x: 200 + rand() * 1200, y: 100 + rand() * 700 }));
  });
});
