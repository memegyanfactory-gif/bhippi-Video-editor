import { describe, expect, it } from 'vitest';
import { drawingClock, separate, trimPoly, polyLength, wobble } from '../src/motion/ink/core';
import { itemGeometry, type GeoEnv } from '../src/motion/ink/geometry';
import { drawDrawing, lookPalette, penPosition, placeItems } from '../src/motion/ink/draw';
import { drawingProblems } from '../src/motion/ink/validate';
import { drawnCatalog, EXAMPLE_LAYER, KIND_HELP } from '../src/motion/ink/catalog';
import { ITEM_KINDS, LOOKS, type DrawItem, type DrawingData } from '../src/motion/ink/types';
import { MOTION_TEMPLATES, findTemplate } from '../src/motion/kit';
import { DRAWN_TEMPLATES } from '../src/motion/kit/drawnTemplates';
import { validateScene } from '../src/motion/validate';
import { compileSequence, TRANSITION_KINDS } from '../src/motion/sequence';
import { defaultSize } from '../src/motion/evaluate';
import type { Layer, MotionScene } from '../src/motion/types';

const env = (over: Partial<GeoEnv> = {}): GeoEnv => ({ t: 1, index: 3, seed: 7, pal: lookPalette({ look: 'crayon', items: [] }), w: 400, h: 300, ...over });

/** The minimal params each kind needs to draw something. */
const minimal = (kind: DrawItem['kind']): DrawItem => {
  switch (kind) {
    case 'line': case 'trail': case 'constellation': return { kind, points: [0, 0, 100, 40, 200, 10] };
    case 'path': case 'icon': return { kind, d: 'M0 0 L24 0 L24 24 Z' };
    case 'write': return { kind, text: 'hello', from: 0 };
    case 'trace': case 'cloud-points': return { kind, spikes: [0.5] };
    case 'ripples': return { kind, start: 0 };
    default: return { kind };
  }
};

/** A Canvas2D stand-in that accepts every call (drawDrawing runs without a DOM). */
function fakeCtx() {
  const calls: string[] = [];
  const target: Record<string, unknown> = { canvas: { width: 100, height: 100 } };
  const ctx = new Proxy(target, {
    get(obj, key: string) {
      if (key in obj) return obj[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (key === 'createPattern') return () => null;
      return (...args: unknown[]) => { calls.push(key); void args; };
    },
    set(obj, key: string, value) { obj[key] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('ink core', () => {
  it('holds the drawing on twos and counts drawings', () => {
    expect(drawingClock(0.05, 2, 24)).toEqual({ t: 0, index: 0 });
    expect(drawingClock(1 / 24 + 0.001, 2, 24).t).toBe(0);
    expect(drawingClock(2 / 24 + 0.001, 2, 24)).toEqual({ t: 2 / 24, index: 1 });
    expect(drawingClock(0.3, 1, 24).t).toBe(0.3);
  });
  it('trims polylines by length and boils deterministically', () => {
    const p = [0, 0, 100, 0, 100, 100];
    expect(polyLength(trimPoly(p, 150))).toBeCloseTo(150);
    expect(wobble(p, 2, 5)).toEqual(wobble(p, 2, 5));
    expect(wobble(p, 2, 5)).not.toEqual(wobble(p, 2, 6));
  });
  it('separates colours into riso inks', () => {
    const inks = ['#2f6fb0', '#ff48b0', '#ffe800'];
    const purple = separate('#6a3a8c', inks);
    expect(purple[0]).toBeGreaterThan(0.3);
    expect(purple[1]).toBeGreaterThan(0.3);
    expect(purple[2]).toBeLessThan(0.3);
    const yellow = separate('#ffe800', inks);
    expect(yellow[2]).toBeGreaterThan(0.9);
  });
});

describe('ink geometry', () => {
  it('every item kind draws something', () => {
    for (const kind of ITEM_KINDS) {
      if (kind === 'pen' || kind === 'group') continue;
      const g = itemGeometry(minimal(kind), env());
      expect(g.marks.length + g.dots.length + g.texts.length, kind).toBeGreaterThan(0);
      for (const mk of g.marks) for (const v of mk.pts) expect(Number.isFinite(v), `${kind} point`).toBe(true);
    }
  });
  it('writes letters at cps', () => {
    const g = itemGeometry({ kind: 'write', text: 'opus 5', from: 0, cps: 12 }, env({ t: 0.25 }));
    expect(g.texts[0].shown).toBeCloseTo(3);
  });
  it('switches faces on their keys', () => {
    const at = (t: number) => itemGeometry({ kind: 'bot', faces: [{ t: 0, face: 'dots' }, { t: 1, face: 'happy' }] }, env({ t })).marks.filter((m) => m.role === 'detail');
    expect(at(0.5)[0].kind).toBe('fill');
    expect(at(1.5)[0].kind).toBe('stroke');
  });
});

describe('drawing placement', () => {
  const data: DrawingData = {
    look: 'crayon', step: 2, boil: 1,
    items: [
      { id: 'a', kind: 'circle', at: [200, 200], size: 100, draw: { k: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } },
      { kind: 'star', at: [500, 200], size: 80, pop: 0.5 },
      { kind: 'pen', follow: ['a'], rest: [900, 100] },
    ],
  };
  it('is deterministic and holds between drawings', () => {
    const a = placeItems(data, [1000, 600], 0.30);
    const b = placeItems(data, [1000, 600], 0.30);
    const c = placeItems(data, [1000, 600], 0.30 + 1 / 48);
    expect(a.placed[0].geo.marks[0].pts).toEqual(b.placed[0].geo.marks[0].pts);
    expect(c.placed[0].geo.marks[0].pts).toEqual(a.placed[0].geo.marks[0].pts);
  });
  it('draws on with a tip the pen sits on', () => {
    const { placed, pens, clock } = placeItems(data, [1000, 600], 0.5);
    const circle = placed[0];
    expect(circle.tip).not.toBeNull();
    const pos = penPosition(pens[0], placed, new Map(), clock.t);
    expect(pos.drawing).toBe(true);
    expect(pos.x).toBeCloseTo(circle.tip!.x);
    const after = placeItems(data, [1000, 600], 3);
    const rest = penPosition(after.pens[0], after.placed, new Map(), after.clock.t);
    expect(rest.drawing).toBe(false);
    expect(rest.x).toBeCloseTo(900);
  });
  it('pops: hidden before, big with ticks for two drawings, then at rest', () => {
    const at = (t: number) => placeItems(data, [1000, 600], t).placed.find((p) => p.it.kind === 'star');
    expect(at(0.4)).toBeUndefined();
    expect(at(0.5)!.burst).toBe(true);
    expect(at(0.5 + 2 / 24)!.burst).toBe(true);
    expect(at(0.5 + 4 / 24)!.burst).toBe(false);
    expect(at(1)!.m[0]).toBeCloseTo(1);
  });
  it('paints every look without throwing', () => {
    for (const look of LOOKS) {
      const main = fakeCtx();
      const plates = [fakeCtx(), fakeCtx(), fakeCtx()];
      const d: DrawingData = { ...(EXAMPLE_LAYER.drawing as DrawingData), look, inks: ['#2f6fb0', '#ff48b0', '#ffe800'] };
      drawDrawing({ main: main.ctx, plates: look === 'riso' ? plates.map((p) => p.ctx) : undefined }, d, [1920, 1080], 2.3, 0.5);
      expect(main.calls.length + plates.reduce((n, p) => n + p.calls.length, 0), look).toBeGreaterThan(10);
    }
  });
});

describe('drawing validation and catalogue', () => {
  it('accepts the example and rejects mistakes clearly', () => {
    expect(validateScene({ version: 1, width: 1920, height: 1080, duration: 3, layers: [EXAMPLE_LAYER as unknown as Layer] })).toEqual([]);
    const bad = drawingProblems({ look: 'oil' as never, items: [{ kind: 'dragon' as never }, { kind: 'bot', faces: [{ t: 0, face: 'angry' as never }] }, { kind: 'pen', follow: ['ghost'] }, { kind: 'line' }] }, 'x');
    expect(bad.join('\n')).toMatch(/look must be one of/);
    expect(bad.join('\n')).toMatch(/kind must be one of/);
    expect(bad.join('\n')).toMatch(/face one of/);
    expect(bad.join('\n')).toMatch(/pen follows "ghost"/);
    expect(bad.join('\n')).toMatch(/needs points/);
  });
  it('documents every kind and names only real templates and transitions', () => {
    for (const kind of ITEM_KINDS) expect(KIND_HELP[kind]?.what, kind).toBeTruthy();
    const cat = drawnCatalog();
    for (const id of cat.templates) expect(findTemplate(id), id).toBeTruthy();
    for (const t of Object.keys(cat.transitions)) expect(TRANSITION_KINDS as readonly string[]).toContain(t);
    expect(DRAWN_TEMPLATES.every((s) => MOTION_TEMPLATES.includes(s))).toBe(true);
  });
  it('sizes a drawing layer to the scene or its own size', () => {
    const scene = { version: 1, width: 1280, height: 720, duration: 1, layers: [] } as MotionScene;
    expect(defaultSize(scene, { id: 'd', type: 'drawing', drawing: { look: 'flat', items: [] } } as Layer, 0)).toEqual([1280, 720]);
    expect(defaultSize(scene, { id: 'd', type: 'drawing', drawing: { look: 'flat', size: [300, 200], items: [] } } as Layer, 0)).toEqual([300, 200]);
  });
});

describe('drawn templates', () => {
  for (const spec of DRAWN_TEMPLATES) {
    it(`${spec.id} builds a valid scene at landscape and portrait`, () => {
      for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
        const scene = spec.build({ width, height }, {});
        expect(validateScene(scene), `${spec.id} ${width}x${height}`).toEqual([]);
        expect(scene.duration).toBeGreaterThan(0.4);
        expect(scene.layers.some((l) => l.type === 'drawing')).toBe(true);
      }
    });
  }
  it('paper-tear compiles into a valid sequence', () => {
    const beat = (world: string) => ({ scene: findTemplate('riso-world')!.build({ width: 1280, height: 720 }, { world }) });
    const seq = compileSequence({ width: 1280, height: 720, beats: [beat('night'), beat('sea')], transitions: [{ kind: 'paper-tear' }] } as never);
    expect(validateScene(seq.scene)).toEqual([]);
    expect(JSON.stringify(seq.scene)).toContain('"tear"');
  });
});
