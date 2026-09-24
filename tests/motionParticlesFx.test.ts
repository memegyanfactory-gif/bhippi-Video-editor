import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { PARTICLE_PRESETS, particlesAt } from '../src/motion/particles';
import { FX_HELP, FX_KINDS, fxLayers } from '../src/motion/fx';
import { validateScene } from '../src/motion/validate';
import { proceduralUniforms } from '../src/motion/gl/procedural';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Layer, MotionScene } from '../src/motion/types';

const size: [number, number] = [1920, 1080];

describe('particles', () => {
  it('are a pure function of seed and time: the same frame twice is identical, another seed differs', () => {
    for (const preset of PARTICLE_PRESETS) {
      const data = { preset, at: [960, 540], start: 0.1 };
      const a = particlesAt(data, size, 0.6);
      expect(particlesAt(data, size, 0.6), preset).toEqual(a);
      if (a.length > 3) expect(particlesAt({ ...data, seed: 99 }, size, 0.6)).not.toEqual(a);
    }
  });

  it('continuous presets keep a steady population; bursts are empty before they fire and gone after', () => {
    const dust = [2, 5, 9].map((t) => particlesAt({ preset: 'dust', count: 60 }, size, t).length);
    for (const n of dust) expect(n).toBeGreaterThan(40);
    expect(particlesAt({ preset: 'confetti-burst', start: 1 }, size, 0.5)).toEqual([]);
    expect(particlesAt({ preset: 'confetti-burst', start: 1 }, size, 1.3).length).toBeGreaterThan(80);
    expect(particlesAt({ preset: 'confetti-burst', start: 1 }, size, 5)).toEqual([]);
    expect(particlesAt({ preset: 'confetti', duration: 1 }, size, 8)).toEqual([]);
  });

  it('confetti bursts upward then gravity pulls it down', () => {
    const early = particlesAt({ preset: 'confetti-burst', at: [960, 800], seed: 3 }, size, 0.25);
    const late = particlesAt({ preset: 'confetti-burst', at: [960, 800], seed: 3 }, size, 1.6);
    const meanY = (list: { y: number }[]) => list.reduce((m, p) => m + p.y, 0) / list.length;
    expect(meanY(early)).toBeLessThan(800);
    expect(meanY(late)).toBeGreaterThan(meanY(early));
  });

  it('a particles layer validates; a bad preset is named', () => {
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 2, layers: [{ id: 'p', type: 'particles', particles: { preset: 'sparkle' } }] };
    expect(validateScene(scene)).toEqual([]);
    expect(validateScene({ ...scene, layers: [{ id: 'p', type: 'particles', particles: { preset: 'fireworks' } } as unknown as Layer] }).join(' ')).toContain('particles need a preset');
  });

  it('new procedurals get their own shader kind', () => {
    expect(proceduralUniforms('mesh-gradient', {}, 0, size).uKind).toBe(10);
    expect(proceduralUniforms('light-shafts', {}, 0, size).uKind).toBe(11);
    expect(proceduralUniforms('dot-wave', {}, 0, size).uKind).toBe(12);
    expect(proceduralUniforms('aurora', {}, 0, size).uKind).toBe(9);
  });
});

describe('drawn FX', () => {
  const base: MotionScene = { version: 1, width: 1920, height: 1080, duration: 4, layers: [
    { id: 'bg', type: 'solid', color: '#000' },
    { id: 'card', type: 'shape', transform: { position: { k: [{ t: 0, v: [300, 540] }, { t: 1, v: [1600, 540] }] } }, shape: { shape: 'rect', size: [300, 200], fill: '#fff' } },
  ] };

  it('every kind builds valid layers with help text', () => {
    for (const kind of FX_KINDS) {
      const made = fxLayers({ kind, t: 0.5, at: [900, 500], target: 'card' }, base, () => ({ x: 100, y: 100, width: 300, height: 200 }));
      expect(typeof made, kind).toBe('object');
      if (typeof made === 'string') continue;
      const layers = [...base.layers];
      for (const { layer, below, above } of made.layers) {
        const i = layers.findIndex((l) => l.id === (below ?? above));
        if (i >= 0) layers.splice(above ? i + 1 : i, 0, layer); else layers.push(layer);
      }
      expect(validateScene({ ...base, layers }), kind).toEqual([]);
      expect(FX_HELP[kind]).toBeTruthy();
    }
  });

  it('echo trails the target with delayed, fainter linked copies below it', () => {
    const made = fxLayers({ kind: 'echo', target: 'card', copies: 3, delay: 0.1, decay: 0.5 }, base);
    if (typeof made === 'string') throw new Error(made);
    expect(made.layers.map((l) => l.below)).toEqual(['card', 'card', 'card']);
    const far = made.layers[0].layer;
    expect(far.id).toBe('card-echo3');
    expect(far.link?.find((l) => l.prop === 'position')?.delay).toBeCloseTo(0.3);
    expect(far.link?.find((l) => l.prop === 'opacity')?.multiply).toBeCloseTo(0.125);
  });

  it('needs a target (or box) where it wraps or trails one', () => {
    expect(fxLayers({ kind: 'echo' }, base)).toContain('target');
    expect(fxLayers({ kind: 'gradient-border' }, base)).toContain('target');
  });
});

describe('add_fx', () => {
  function harness(project: Project) {
    let current = project;
    const ctx = {
      get project() { return current; },
      assets: new Map(),
      commit: (change: (p: Project) => Project) => { current = change(current); },
      editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
      pickComp: (p: Project) => p.comps[0],
      current: () => current,
    } as unknown as MotionToolContext;
    return { ctx, get: () => current };
  }

  it('lays a confetti pop over the timeline, then adds a glint into that scene', async () => {
    const { ctx } = harness(newProject());
    const pop = await runMotionTool('add_fx', { kind: 'confetti-pop', start: 3, at: [960, 700] }, ctx) as { ok: boolean; clipId: string; error?: string };
    expect(pop.error).toBeUndefined();
    const glint = await runMotionTool('add_fx', { kind: 'star-glint', clipId: pop.clipId, t: 0.4, at: [960, 400] }, ctx) as { ok: boolean; error?: string; summary: string };
    expect(glint.error).toBeUndefined();
    expect(glint.summary).toContain('star-glint');
    const listing = await runMotionTool('add_fx', {}, ctx) as unknown as { kinds: unknown[] };
    expect(listing.kinds).toHaveLength(FX_KINDS.length);
  });
});
