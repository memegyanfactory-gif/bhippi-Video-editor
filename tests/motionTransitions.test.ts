import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { compileSequence, normalizeTransition, TRANSITION_HELP, TRANSITION_KINDS, type SeqBeat } from '../src/motion/sequence';
import { validateScene } from '../src/motion/validate';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { planBuild, SCORE_MOODS } from '../src/lib/guidedBuild';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Key, Layer, MotionScene, Vec } from '../src/motion/types';

const beat = (name: string, duration = 2): SeqBeat => ({
  name,
  scene: { version: 1, width: 1920, height: 1080, duration, layers: [{ id: 'bg', type: 'solid', color: '#123456' }, { id: 't', type: 'text', text: { text: name } }], cues: [{ at: 0.5, sound: 'pop' }] },
});
const byId = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id)!;
const keys = <T>(prop: unknown) => ((prop as { k?: Key<T>[] }).k ?? []);

describe('motion sequences', () => {
  it('every transition kind compiles to a valid scene, with help text', () => {
    for (const kind of TRANSITION_KINDS) {
      const { scene } = compileSequence({ width: 1920, height: 1080, beats: [beat('a'), beat('b')], transitions: [kind] });
      expect(validateScene(scene), kind).toEqual([]);
      expect(TRANSITION_HELP[kind]).toBeTruthy();
    }
  });

  it('times beats: an overlapping kind starts the next beat half a transition early, a hard kind at the cut', () => {
    const dissolve = compileSequence({ width: 1920, height: 1080, beats: [beat('a'), beat('b'), beat('c')], transitions: [{ kind: 'dissolve', duration: 0.6 }, 'blur-bridge'] });
    expect(dissolve.cuts).toEqual([2, 3.7]);
    expect(dissolve.starts).toEqual([0, 1.7, 3.7]);
    expect(dissolve.duration).toBe(5.7);
    const b = byId(dissolve.scene, 'beat-2') as Layer & { type: 'precomp' };
    expect(b.offset).toBe(1.7);
    expect(b.in).toBe(1.7);
    expect(byId(dissolve.scene, 'beat-1').out).toBe(2.3);
    // Beats' own cues move with them.
    expect(dissolve.scene.cues?.filter((c) => c.sound === 'pop').map((c) => c.at)).toEqual([0.5, 2.2, 4.2]);
  });

  it('blur-bridge: blur on in 1 frame, cut 3 frames later, back in about 7', () => {
    const { scene, cuts } = compileSequence({ width: 1920, height: 1080, beats: [beat('a'), beat('b')], transitions: ['blur-bridge'] });
    const T = cuts[0];
    const a = byId(scene, 'beat-1');
    const blurA = keys<number>((a.effects![0] as unknown as { blurriness: unknown }).blurriness);
    expect(blurA.map((k) => k.v)).toEqual([0, 48]);
    expect(blurA[1].t).toBeCloseTo(T - 3 / 30, 3);
    expect(a.out).toBe(T);
    const blurB = keys<number>((byId(scene, 'beat-2').effects![0] as unknown as { blurriness: unknown }).blurriness);
    expect(blurB[1].t).toBeCloseTo(T + 7 / 30, 3);
  });

  it('wipes keep their matte for the rest of the beat, right above it', () => {
    const { scene } = compileSequence({ width: 1920, height: 1080, beats: [beat('a'), beat('b'), beat('c')], transitions: [{ kind: 'shape-wipe', glyph: 'star' }, { kind: 'shape-wipe', mode: 'in' }] });
    const ids = scene.layers.map((l) => l.id);
    const b = byId(scene, 'beat-2');
    expect(b.matte?.mode).toBe('alpha');
    expect(ids.indexOf(b.matte!.layer)).toBe(ids.indexOf('beat-2') + 1);
    expect(byId(scene, b.matte!.layer).out).toBeUndefined();
    expect(byId(scene, 'beat-3').matte?.mode).toBe('alpha-inverted');
  });

  it('world layout: beats sit apart on one canvas and a camera null trucks between them', () => {
    const { scene, cuts } = compileSequence({ width: 1920, height: 1080, layout: 'world', beats: [beat('a'), beat('b'), beat('c')], background: '#eef0f6' });
    expect(scene.layers.map((l) => l.id)).toEqual(['background', 'world', 'beat-1', 'beat-2', 'beat-3']);
    const gap = Math.round(1920 * 0.12);
    expect(byId(scene, 'beat-2').parent).toBe('world');
    expect(byId(scene, 'beat-2').transform!.position).toEqual([1920 + gap + 960, 540]);
    const world = keys<Vec>(byId(scene, 'world').transform!.position);
    expect(world.map((k) => k.v)).toEqual([[0, 0], [-(1920 + gap), 0], [-(1920 + gap), 0], [-2 * (1920 + gap), 0]]);
    expect(world[1].t).toBeCloseTo(cuts[0] + 0.45, 3);
  });

  it('the guide travels to each stop at its beat time and fades after the last', () => {
    const { scene, starts } = compileSequence({ width: 1920, height: 1080, beats: [beat('a'), beat('b')], transitions: ['cut'], guide: { shape: 'dot', stops: [{ beat: 0, at: [100, 100], t: 0.5 }, { beat: 1, at: [900, 500], t: 0.5 }] } });
    const guide = byId(scene, 'guide');
    const pos = keys<Vec>(guide.transform!.position);
    expect(pos[pos.length - 1]).toMatchObject({ t: starts[1] + 0.5, v: [900, 500] });
    expect(keys<number>(guide.transform!.opacity).map((k) => k.v)).toEqual([100, 0]);
  });

  it('defaults: a dissolve between cuts, a truck in a world; strings are kinds', () => {
    expect(normalizeTransition(undefined, 'cuts').kind).toBe('dissolve');
    expect(normalizeTransition(undefined, 'world').kind).toBe('truck');
    expect(normalizeTransition('whip', 'cuts')).toEqual({ kind: 'whip', duration: 0.36 });
  });
});

describe('create_motion_sequence', () => {
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

  it('builds beats from templates and raw scenes into one layered comp', async () => {
    const { ctx, get } = harness(newProject());
    const result = await runMotionTool('create_motion_sequence', {
      beats: [{ template: 'glass-teaching-card', params: { term: 'Churn', definition: 'Customers who leave' }, hold: 2.5 }, { scene: { duration: 2, layers: [{ id: 'x', type: 'solid', color: '#fff' }] }, name: 'White' }],
      transitions: ['z-recede'], background: '#0f1117', start: 1, title: 'Explainer',
    }, ctx) as { ok: boolean; error?: string; starts: number[]; cuts: number[] };
    expect(result.error).toBeUndefined();
    expect(result.cuts[0]).toBeCloseTo(3.5, 3);
    expect(get().comps.some((c) => c.name === '[Motion] Explainer')).toBe(true);
  });

  it('builds every mood of a guided brief (build_edit_from_brief\'s plan) without an error', async () => {
    const brief = [
      { text: 'Edit video with AI' }, { text: 'Type what you want. Watch it happen.' }, { text: 'faster first cut', value: 10, suffix: 'x' },
      { text: 'What you get', points: ['Motion graphics', 'Music on the beat', 'Captions'] }, { text: 'Jane Doe', kind: 'lower-third' as const, subtitle: 'Founder' },
      { text: '“It edits like a pro”', kind: 'quote' as const }, { text: 'Try Bhippi free', cta: 'bhippi.com' },
    ];
    for (const mood of SCORE_MOODS) {
      const plan = planBuild(brief, { mood });
      const { ctx, get } = harness(newProject());
      const result = await runMotionTool('create_motion_sequence', { beats: plan.beats.map((b) => ({ template: b.template, params: b.params, hold: b.hold, name: b.name })), transitions: plan.transitions, sfx: true, title: 'Guided build' }, ctx) as { ok: boolean; error?: string; starts: number[]; cuts: number[]; clipId?: string };
      expect(result.error, mood).toBeUndefined();
      expect(result.starts, mood).toHaveLength(brief.length);
      expect(result.clipId, mood).toBeTruthy();
      expect(get().comps.some((c) => c.name === '[Motion] Guided build'), mood).toBe(true);
    }
  });

  it('refuses unknown transitions and empty beats', async () => {
    const { ctx } = harness(newProject());
    const bad = await runMotionTool('create_motion_sequence', { beats: [{ scene: { duration: 1, layers: [] } }, { scene: { duration: 1, layers: [] } }], transitions: ['teleport'] }, ctx) as { ok: boolean; error: string };
    expect(bad.error).toContain('teleport');
    const empty = await runMotionTool('create_motion_sequence', { beats: [{}] }, ctx) as { ok: boolean; error: string };
    expect(empty.error).toContain('template, ui, scene or clipId');
  });
});

describe('cross-layer links', () => {
  it('a follower trails its leader by the delay, with an offset; scale and opacity multiply', async () => {
    const { evaluateScene } = await import('../src/motion/evaluate');
    const scene: MotionScene = {
      version: 1, width: 1000, height: 1000, duration: 2,
      layers: [
        { id: 'dot', type: 'solid', color: '#fff', size: [10, 10], transform: { position: { k: [{ t: 0, v: [0, 0], ease: 'linear' }, { t: 1, v: [100, 0] }] }, opacity: { k: [{ t: 0, v: 100, ease: 'linear' }, { t: 1, v: 0 }] } } },
        { id: 'trail', type: 'solid', color: '#fff', size: [10, 10], link: [{ prop: 'position', from: 'dot', delay: 0.25, offset: [0, 20] }, { prop: 'opacity', from: 'dot', delay: 0.25, multiply: 0.5 }] },
      ],
    };
    expect(validateScene(scene)).toEqual([]);
    const frame = evaluateScene(scene, 0.75);
    const trail = frame.layers.find((l) => l.layer.id === 'trail')!;
    // Leader at 0.5 s: x = 50; the trail is centred there, 20 px lower.
    expect(trail.matrix[12]).toBeCloseTo(50 - 5, 3);
    expect(trail.matrix[13]).toBeCloseTo(20 - 5, 3);
    expect(trail.opacity).toBeCloseTo(0.25, 3);
    expect(validateScene({ ...scene, layers: [scene.layers[0], { ...scene.layers[1], link: [{ prop: 'position', from: 'ghost' }] }] }).join(' ')).toContain('link from "ghost"');
  });
});
