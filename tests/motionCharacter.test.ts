import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { actionDuration, poseAt, restPose, visemeAt, wordsFromText } from '../src/motion/character/pose';
import { twoBone } from '../src/motion/character/draw';
import { ACTIONS, CHARACTER_KINDS, type CharacterData } from '../src/motion/character/types';
import { standingHeight, toCharacterSpace, wordsIn } from '../src/lib/characterTools';
import { validateScene } from '../src/motion/validate';
import { evaluateScene } from '../src/motion/evaluate';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { Layer, MotionScene } from '../src/motion/types';

const kid = (actions: CharacterData['actions'], extra: Partial<CharacterData> = {}): CharacterData => ({ kind: 'dome-kid', actions, blink: false, ...extra });

describe('character pose solver', () => {
  it('holds each drawing for two frames (on twos) unless asked for ones', () => {
    const data = kid([{ t: 0, do: 'wave' }]);
    expect(poseAt(data, 10 / 30)).toEqual(poseAt(data, 11 / 30));
    expect(poseAt({ ...data, step: 1 }, 10 / 30)).not.toEqual(poseAt({ ...data, step: 1 }, 11 / 30));
  });

  it('hop follows the measured chart: crouch 0.95, hang high, fall stretched 1.24, contact squash 0.83', () => {
    const data = kid([{ t: 0, do: 'hop' }], { step: 1 });
    expect(poseAt(data, 2 / 30).squash).toBeCloseTo(0.95, 2);
    expect(poseAt(data, 8 / 30).y).toBeLessThan(-60);
    expect(poseAt(data, 11.99 / 30).squash).toBeGreaterThan(1.2);
    expect(poseAt(data, 13 / 30).squash).toBeCloseTo(0.83, 2);
    expect(poseAt(data, 30 / 30).squash).toBe(1);
    expect(actionDuration({ t: 0, do: 'hop' })).toBeCloseTo(22 / 30);
  });

  it('walks travel and keep their distance afterwards, facing the way they went', () => {
    const data = kid([{ t: 0, do: 'walk', to: -280 }]);
    const d = actionDuration({ t: 0, do: 'walk', to: -280 });
    expect(d).toBeCloseTo((4 * 14) / 30);
    expect(poseAt(data, d / 2).x).toBeLessThan(-100);
    expect(poseAt(data, d + 2).x).toBeCloseTo(-280, 0);
    expect(poseAt(data, d + 2).facing).toBe(-1);
  });

  it('blinks: half, closed, closed, half, then the rounder open', () => {
    const data: CharacterData = { kind: 'shape-buddy', seed: 3, step: 1 };
    const values = new Set<number>();
    for (let f = 0; f < 200; f++) values.add(poseAt(data, f / 30).eyes);
    expect([...values].sort()).toEqual([0, 0.5, 1, 1.05, 1.12]);
  });

  it('expressions hold from when they are set; talk shapes the mouth by word', () => {
    const data = kid([{ t: 1, do: 'expression', expression: 'sad' }, { t: 2, do: 'talk', words: [{ t: 2, end: 2.5, w: 'moon' }] }], { step: 1 });
    expect(poseAt(data, 0.5).expression).toBe('normal');
    expect(poseAt(data, 1.5).expression).toBe('sad');
    expect(poseAt(data, 1.5).mouth).toBe('sad');
    expect(poseAt(data, 2.05).mouth).toBe('M');
    expect(poseAt(data, 2.2).mouth).toBe('O');
    expect(visemeAt([{ t: 0, end: 1, w: 'fa' }], 0.1)).toBe('F');
    const spread = wordsFromText('one two three', 0, 3);
    expect(spread).toHaveLength(3);
    expect(spread[2].end).toBeLessThanOrEqual(3);
  });

  it('two-bone IK reaches reachable targets exactly and stretches toward far ones', () => {
    const { joint, end } = twoBone([0, 0], [100, 0], 70, 70, 1);
    expect(end[0]).toBeCloseTo(100, 3);
    expect(Math.hypot(joint[0], joint[1])).toBeCloseTo(70, 3);
    expect(Math.hypot(end[0] - joint[0], end[1] - joint[1])).toBeCloseTo(70, 3);
    expect(twoBone([0, 0], [500, 0], 70, 70, 1).end[0]).toBeLessThanOrEqual(140);
  });

  it('every action and character validates, and travel moves the layer (the box never clips)', () => {
    const layers: Layer[] = CHARACTER_KINDS.map((kind, i) => ({ id: `c${i}`, type: 'character', character: { kind, actions: ACTIONS.map((a, j) => ({ t: j * 0.5, do: a, ...(a === 'expression' ? { expression: 'happy' as const } : {}), ...(a === 'point' || a === 'look' ? { to: [200, -200] } : {}) })) } }));
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 12, layers };
    expect(validateScene(scene)).toEqual([]);
    const walker: MotionScene = { version: 1, width: 1920, height: 1080, duration: 5, layers: [{ id: 'w', type: 'character', transform: { position: [500, 900], scale: 50 }, character: kid([{ t: 0, do: 'walk', to: 400 }]) }] };
    const before = evaluateScene(walker, 0).layers[0].matrix[12];
    const after = evaluateScene(walker, 4.5).layers[0].matrix[12];
    expect(after - before).toBeCloseTo(200, 0);
    expect(walker.layers[0].transform!.position).toEqual([500, 900]);
    expect(restPose('flat-corporate').hands[0][1]).toBeGreaterThan(0);
  });
});

describe('character tools', () => {
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

  it('converts scene px to character px: walk targets, point targets, word times', () => {
    const [walk, point] = toCharacterSpace([{ t: 1, do: 'walk', to: [900, 1000] }, { t: 2, do: 'point', to: [700, 500] }], [500, 1000], 50);
    expect(walk.to).toBe(800);
    expect(point.to).toEqual([400, -1000]);
    const said = wordsIn([{ text: 'hi', start: 5, end: 5.3 }, { text: 'no', start: 9, end: 9.2 }], 4, 6, 4);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ t: 1, w: 'hi' });
    expect(said[0].end).toBeCloseTo(1.3, 6);
    expect(standingHeight('dome-kid')).toBeGreaterThan(300);
  });

  it('create_character places a scaled character; animate_character appends actions', async () => {
    const { ctx } = harness(newProject());
    const made = await runMotionTool('create_character', { character: 'dome-kid', at: [400, 1000], height: 500, actions: [{ t: 0.5, do: 'wave' }], stage: '#f8d2d6' }, ctx) as { ok: boolean; clipId: string; layerId: string; error?: string };
    expect(made.error).toBeUndefined();
    const more = await runMotionTool('animate_character', { clipId: made.clipId, layerId: made.layerId, actions: [{ t: 2, do: 'celebrate' }, { t: 1.2, do: 'walk', to: [800, 1000] }] }, ctx) as { ok: boolean; summary: string; error?: string };
    expect(more.error).toBeUndefined();
    expect(more.summary).toContain('wave@0.50, walk@1.20, celebrate@2.00');
    const bad = await runMotionTool('animate_character', { clipId: made.clipId, actions: [{ t: 0, do: 'moonwalk' }] }, ctx) as { error: string };
    expect(bad.error).toContain('do must be one of');
    const listing = await runMotionTool('list_character_actions', {}, ctx) as unknown as { actions: unknown[] };
    expect(listing.actions).toHaveLength(ACTIONS.length);
  });
});
