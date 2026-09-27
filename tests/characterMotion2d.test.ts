import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StudioSpec } from '../src/motion/character/types';

type Vec3 = [number, number, number];
type Action = { do: string; t: number; duration?: number; to?: number | [number, number]; hand?: string; expression?: string; words?: { t: number; end: number; w: string }[] };
type Frame = {
  t: number; yaw: number; headYaw: number; headPitch: number; blink: number; mouthOpen: number; mouthWeight: number; expr?: string;
  root: { x: number; y: number };
  pose: { hands: Vec3[]; poles: Vec3[]; feet: Vec3[]; hipDrop: number; headRoll: number; hairSwing: number; squash: number; handKinds: string[] };
};
type Rig = { H: number; hw: number; hipY: number; legLen: number };
type Engine = { defaults(): StudioSpec; rigFor(s: StudioSpec): Rig; render(s: StudioSpec, a: Frame | Record<string, unknown>): string; ik3(s: Vec3, t: Vec3, upper: number, lower: number, pole: Vec3): { joint: Vec3; end: Vec3 } };
type Motion = {
  ACTIONS: { id: string; duration: number }[];
  duration(a: string | Action): number;
  sample(s: StudioSpec, o: { t: number; actions?: Action[]; stance?: string; seed?: number; blink?: boolean | number; step?: number; motion?: { timing?: string; energy?: number; secondary?: number } }): Frame;
  sampleTime(t: number, timing?: string, step?: number): number;
  stepTime(t: number, direction: number, timing?: string): number;
  blend(a: Frame, b: Frame, weight: number): Frame;
};
const isolated: Record<string, unknown> = {};
for (const file of ['engine2d.js', 'motion2d.js', 'presets2d.js']) new Function('window', readFileSync(`public/characters/${file}`, 'utf8'))(isolated);
const E = isolated.CharEngine as Engine;
const M = isolated.CharMotion as Motion;
const examples = (isolated.CharPresets as { EXAMPLES: StudioSpec[] }).EXAMPLES;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const allFinite = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(allFinite) : v && typeof v === 'object' ? Object.values(v).every(allFinite) : true;

describe('shared expressive 2D motion', () => {
  it('uses no wall clock, DOM, animation loop or random state', () => {
    const source = readFileSync('public/characters/motion2d.js', 'utf8');
    expect(source).not.toMatch(/performance\.now|Date\.now|Math\.random|requestAnimationFrame|document\./);
  });

  it.each(examples.map((spec) => [String(spec.name), spec] as const))('renders every move with finite geometry for %s', (_name, spec) => {
    const original = JSON.stringify(spec);
    for (const action of M.ACTIONS) {
      const sampled = M.sample(spec, { t: action.duration * .47, actions: [{ do: action.id, t: 0 }], seed: 81 });
      expect(allFinite(sampled)).toBe(true);
      const svg = E.render(spec, { ...sampled, id: 'motion-qa' });
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain('<path');
      expect(svg).not.toContain('<filter');
    }
    expect(JSON.stringify(spec)).toBe(original);
  });

  it('reproduces a seeked frame exactly after arbitrary intervening samples and renders', () => {
    const spec = examples[0], options = { t: 1.185, seed: 91, actions: [{ do: 'wave', t: .4 }, { do: 'talk', t: .8 }] };
    const before = M.sample(spec, options);
    const svg = E.render(spec, { ...before, id: 'seek' });
    for (const t of [19, 0, 7.83, .1]) E.render(spec, M.sample(spec, { t }));
    expect(M.sample(spec, options)).toEqual(before);
    expect(E.render(spec, { ...M.sample(spec, options), id: 'seek' })).toBe(svg);
  });

  it('eases all action entrances and exits back to the underlying stance', () => {
    const spec = E.defaults();
    for (const action of M.ACTIONS.filter(a => !['turn', 'idle'].includes(a.id))) {
      const actions = [{ do: action.id, t: 1, duration: action.duration }];
      for (const t of [1, 1 + action.duration]) {
        const plain = M.sample(spec, { t }), animated = M.sample(spec, { t, actions });
        expect(animated.pose).toEqual(plain.pose);
      }
      const first = M.sample(spec, { t: 1.0001, actions }), rest = M.sample(spec, { t: 1.0001 });
      first.pose.hands.forEach((h, i) => expect(distance(h, rest.pose.hands[i])).toBeLessThan(.001));
    }
  });

  it('supports interrupted pose blends without moving the captured first frame', () => {
    const spec = examples[0], from = M.sample(spec, { t: 1, actions: [{ do: 'wave', t: 0 }] }), to = M.sample(spec, { t: 1, actions: [{ do: 'think', t: 0 }] });
    expect(M.blend(from, to, 0)).toEqual(from);
    expect(M.blend(from, to, 1)).toEqual(to);
    const half = M.blend(from, to, .5);
    expect(half.pose.hands[1][0]).toBeCloseTo((from.pose.hands[1][0] + to.pose.hands[1][0]) / 2, 10);
    expect(M.blend(from, to, .5)).toEqual(half);
  });

  it('keeps takeoff and landing poses continuous inside hops and leaps', () => {
    for (const spec of examples) for (const move of ['hop', 'leap']) {
      const d = M.duration(move), actions = [{ do: move, t: 0 }];
      for (const boundary of [.2, .73]) {
        const a = M.sample(spec, { t: boundary * d - 1e-6, actions });
        const b = M.sample(spec, { t: boundary * d + 1e-6, actions });
        a.pose.hands.forEach((h, i) => expect(distance(h, b.pose.hands[i])).toBeLessThan(.01));
        expect(Math.abs(a.pose.hipDrop - b.pose.hipDrop)).toBeLessThan(.01);
        expect(Math.abs(a.pose.squash - b.pose.squash)).toBeLessThan(.001);
        expect(Math.abs(a.headPitch - b.headPitch)).toBeLessThan(.001);
        expect(Math.abs(a.pose.hairSwing - b.pose.hairSwing)).toBeLessThan(.001);
        expect(Math.abs(a.root.y - b.root.y)).toBeLessThan(.01);
      }
    }
  });

  it('releases saved peace, pocket and crossed arms into full-body actions, then restores them', () => {
    const original = examples[0];
    for (const stance of ['peace', 'pocket', 'cross']) for (const move of ['walk', 'run', 'sneak', 'hop', 'leap']) {
      const spec = { ...original, stance }, neutral = { ...original, stance: 'relaxed' }, d = M.duration(move), actions = [{ do: move, t: 0 }];
      for (const phase of [.35, .55]) {
        const active = M.sample(spec, { t: phase * d, actions }), relaxed = M.sample(neutral, { t: phase * d, actions });
        expect(active.pose.hands).toEqual(relaxed.pose.hands);
        expect(active.pose.poles).toEqual(relaxed.pose.poles);
        expect(active.pose.handKinds).toEqual(relaxed.pose.handKinds);
        expect(E.render(spec, { ...active, id: 'stance-motion' })).not.toMatch(/NaN|Infinity|undefined/);
      }
      expect(M.sample(spec, { t: 0, actions }).pose).toEqual(M.sample(spec, { t: 0 }).pose);
      expect(M.sample(spec, { t: d, actions }).pose).toEqual(M.sample(spec, { t: d }).pose);
    }
  });

  it('keeps a foot in contact throughout walking and sneaking without changing leg lengths', () => {
    for (const spec of examples) for (const move of ['walk', 'sneak']) {
      const r = E.rigFor(spec), upper = r.legLen * .505, lower = r.legLen * .49;
      for (let t = .4; t < 2.3; t += .083) {
        const frame = M.sample(spec, { t, actions: [{ do: move, t: 0, duration: 3 }] });
        expect(frame.pose.feet.some(f => Math.abs(f[1] + 16) < 1e-8)).toBe(true);
        frame.pose.feet.forEach((foot, i) => {
          expect(foot[1]).toBeLessThanOrEqual(-16);
          const hip: Vec3 = [(i ? 1 : -1) * r.hw * .5, r.hipY + frame.pose.hipDrop + 8, 0];
          expect(distance(hip, foot)).toBeLessThan(upper + lower);
          const solved = E.ik3(hip, foot, upper, lower, [0, 0, 1]);
          expect(distance(hip, solved.joint)).toBeCloseTo(upper, 7);
          expect(distance(solved.joint, solved.end)).toBeCloseTo(lower, 7);
          expect(distance(solved.end, foot)).toBeLessThan(1e-7);
        });
      }
    }
  });

  it('solves degenerate and overextended IK targets without invalid joints', () => {
    for (const target of [[0, 0, 0], [0, 900, 0], [0, 0, 90]] as Vec3[]) {
      const solved = E.ik3([0, 0, 0], target, 50, 40, [0, 0, 1]);
      expect(allFinite(solved)).toBe(true);
      expect(distance([0, 0, 0], solved.joint)).toBeCloseTo(50, 7);
      expect(distance(solved.joint, solved.end)).toBeCloseTo(40, 7);
    }
  });

  it('stores travel separately, accumulates completed moves, and returns jumps to the ground', () => {
    const spec = E.defaults(), actions = [{ do: 'walk', t: 0, duration: 2, to: 200 }, { do: 'run', t: 3, duration: 1, to: -50 }];
    expect(M.sample(spec, { t: 5, actions }).root).toEqual({ x: 150, y: 0 });
    const jump = [{ do: 'hop', t: 1, duration: 1.35 }];
    expect(M.sample(spec, { t: 1.6, actions: jump }).root.y).toBeLessThan(-50);
    expect(M.sample(spec, { t: 2.5, actions: jump }).root.y).toBe(0);
    const frame = M.sample(spec, { t: 1.6, actions: jump });
    expect(E.render(spec, { ...frame, id: 'root' })).toBe(E.render(spec, { ...frame, root: { x: 500, y: 900 }, id: 'root' }));
  });

  it('separates smooth, film and drawn timing and preserves explicit legacy cadence', () => {
    expect(M.sampleTime(.237, 'smooth')).toBe(.237);
    expect(M.sampleTime(.237, 'film')).toBe(5 / 24);
    expect(M.sampleTime(.237, 'drawn')).toBe(2 / 12);
    expect(M.sampleTime(.237, 'drawn', 1)).toBe(.237);
    expect(M.sampleTime(.237, 'smooth', 2)).toBe(3 / 15);
    expect(M.sampleTime(.237, 'smooth', 3)).toBe(2 / 10);
    const spec = { ...E.defaults(), motion2d: { timing: 'drawn' as const } };
    expect(M.sample(spec, { t: .18 })).toEqual(M.sample(spec, { t: .22 }));
  });

  it('steps relative to the visible held drawing and round-trips smooth frames', () => {
    expect(M.stepTime(.16, 1, 'film')).toBe(4 / 24);
    expect(M.stepTime(.16, -1, 'film')).toBe(2 / 24);
    expect(M.stepTime(.13, 1, 'drawn')).toBe(2 / 12);
    expect(M.stepTime(.13, -1, 'drawn')).toBe(0);
    for (const [timing, fps] of [['film', 24], ['drawn', 12], ['smooth', 60]] as const) {
      expect(M.stepTime(0, -1, timing)).toBe(0);
      for (const index of [1, 3, 29, 71]) {
        const t = index / fps;
        expect(M.stepTime(t, 1, timing)).toBe((index + 1) / fps);
        expect(M.stepTime(t, -1, timing)).toBe((index - 1) / fps);
        expect(M.stepTime(M.stepTime(t, 1, timing), -1, timing)).toBe(t);
      }
    }
    expect(M.stepTime(.13, 1)).toBe(9 / 60);
  });

  it('has continuous eyelid closure, respects blink preferences, and resets held expressions', () => {
    const spec = E.defaults(), frames = Array.from({ length: 500 }, (_, i) => M.sample(spec, { t: i / 100, blink: true }));
    expect(frames.some(f => f.blink > .05 && f.blink < .95)).toBe(true);
    expect(frames.some(f => f.blink === 0)).toBe(true);
    expect(M.sample(spec, { t: 3, blink: .37 }).blink).toBe(.37);
    const actions = [{ do: 'expression', t: 0, expression: 'closed' }, { do: 'expression', t: 1, expression: 'normal' }];
    expect(M.sample(spec, { t: .5, actions, blink: false }).blink).toBe(1);
    expect(M.sample(spec, { t: 1.5, actions, blink: false }).blink).toBe(0);
  });

  it('follows absolute word timestamps and lasts through the final spoken word', () => {
    const spec = E.defaults(), talk = { do: 'talk', t: 2, words: [{ t: 2.5, end: 3.1, w: 'Hello' }, { t: 5, end: 6.1, w: 'again' }] };
    expect(M.duration(talk)).toBeCloseTo(4.1);
    expect(M.sample(spec, { t: 4, actions: [talk] }).mouthOpen).toBe(0);
    expect(M.sample(spec, { t: 5.3, actions: [talk] }).mouthOpen).toBeGreaterThan(0);
    const fading = M.sample(spec, { t: 2.05, actions: [talk] });
    expect(fading.mouthOpen).toBeGreaterThanOrEqual(0);
    expect(fading.mouthWeight).toBeGreaterThan(0);
    expect(fading.mouthWeight).toBeLessThan(1);
  });

  it('uses geometric, stable ink and shows partial blink and head roll in SVG', () => {
    const spec = E.defaults(), frame = M.sample(spec, { t: .9, actions: [{ do: 'wave', t: 0 }], blink: .45 });
    const svg = E.render(spec, { ...frame, id: 'ink' });
    expect(svg).not.toContain('feTurbulence');
    expect(svg).toContain('scale(1 0.550)');
    expect(svg).toContain('rotate(');
    expect(E.render(spec, { ...frame, drawing: 3, id: 'ink' })).toBe(E.render(spec, { ...frame, drawing: 91, id: 'ink' }));
  });
});
