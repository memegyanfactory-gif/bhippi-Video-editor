import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

// The Characters window's own scripts, loaded the way the editor loads them: onto `window`.
const store = new Map<string, string>();
const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
const fakeWindow: Record<string, unknown> = { addEventListener: () => undefined, localStorage };
fakeWindow.parent = fakeWindow;
Object.assign(globalThis, { window: fakeWindow, localStorage });
for (const file of ['shared.js', 'engine2d.js', 'motion2d.js', 'presets2d.js']) {
  new Function('window', 'localStorage', 'location', readFileSync(`public/characters/${file}`, 'utf8'))(fakeWindow, localStorage, { origin: 'null' });
}

import { drawStudioCharacter, presetCharacters, studioParams } from '../src/motion/character/studio';
import { actionDuration, characterActionDuration, poseAt, sampleStudioMotion } from '../src/motion/character/pose';
import type { CharacterData } from '../src/motion/character/types';
import { validateScene } from '../src/motion/validate';
import { evaluateScene } from '../src/motion/evaluate';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { normalizeSpec } from '../src/lib/characterTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

function harness(prompt = '') {
  let current: Project = newProject();
  const ctx = {
    get project() { return current; },
    assets: new Map(),
    commit: (change: (p: Project) => Project) => { current = change(current); },
    editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
    pickComp: (p: Project) => p.comps[0],
    current: () => current,
    prompt,
  } as unknown as MotionToolContext;
  return { ctx, get: () => current };
}

async function sceneOf(ctx: MotionToolContext, clipId: string): Promise<MotionScene> {
  return ((await runMotionTool('get_motion_scene', { clipId, full: true }, ctx)) as unknown as { scene: MotionScene }).scene;
}

type Made = { ok: boolean; error?: string; summary?: string; clipId?: string; layerId?: string };

describe('the character library in the editor', () => {
  it('reads the saved characters first and the room examples after', async () => {
    store.set('bhippi.characters.v3', JSON.stringify([{ name: 'Aayush', age: 'adult', body: 'masc', hair: { style: 'messy', color: '#1D1A1A' }, top: { kind: 'hoodie', color: '#F6A623' } }]));
    const { ctx } = harness('make a character video');
    const listed = await runMotionTool('list_characters', {}, ctx) as unknown as { saved: { name: string; look: string }[]; examples: { name: string }[]; summary: string };
    expect(listed.saved.map((c) => c.name)).toEqual(['Aayush']);
    expect(listed.saved[0].look).toContain('hoodie');
    expect(listed.examples).toHaveLength(20);
    expect(listed.summary).toContain('library first');
    const kids = await runMotionTool('list_characters', { query: 'kid' }, ctx) as unknown as { examples: { name: string }[] };
    expect(kids.examples.length).toBeGreaterThan(0);
    expect(kids.examples.length).toBeLessThan(20);
    expect(((await presetCharacters())[0] as { name: string }).name).toBe('Mira');
  });

  it('casts a library character by name, with look changes, and it validates', async () => {
    const { ctx } = harness('make a character video');
    const made = await runMotionTool('create_character', { character: 'aayush', look: { top: { color: '#E4574C' } }, height: 600, actions: [{ t: 0.2, do: 'wave' }, { t: 1, do: 'walk', to: 1400 }] }, ctx) as Made;
    expect(made.error).toBeUndefined();
    expect(made.summary).toContain('Aayush (saved character)');
    const scene = await sceneOf(ctx, made.clipId!);
    const layer = scene.layers.find((l) => l.id === made.layerId) as { character: CharacterData };
    expect(layer.character.kind).toBe('studio');
    expect((layer.character.spec as { top: { kind: string; color: string } }).top).toEqual({ kind: 'hoodie', color: '#E4574C' });
    expect(validateScene(scene)).toEqual([]);
    const example = await runMotionTool('create_character', { character: 'Priya', clipId: made.clipId }, ctx) as Made;
    expect(example.error).toBeUndefined();
    expect(example.summary).toContain('library example');
  });

  it('refuses a built-in rig the user did not ask for, and names the library instead', async () => {
    const refused = await runMotionTool('create_character', { character: 'dome-kid' }, harness('create a character motion style video').ctx) as Made;
    expect(refused.error).toContain('library');
    expect(refused.error).toContain('Aayush');
    const asked = await runMotionTool('create_character', { character: 'dome-kid' }, harness('use the dome-kid character').ctx) as Made;
    expect(asked.error).toBeUndefined();
    const missing = await runMotionTool('create_character', { character: 'Gandalf' }, harness('x').ctx) as Made;
    expect(missing.error).toContain('Mira');
  });

  it('designs a new character only from a spec, and can save it to the library', async () => {
    const made = await runMotionTool('create_character', { spec: { name: 'Robo Chef', age: 'adult', top: { kind: 'shirt', color: '#F5F1E8' }, acc: ['tophat'] }, save: true }, harness('a robot chef character').ctx) as Made;
    expect(made.error).toBeUndefined();
    expect(JSON.parse(store.get('bhippi.characters.v3')!).map((c: { name: string }) => c.name)).toContain('Robo Chef');
  });

  it('takes the calls a weaker model actually sends: quoted numbers, a twin of the same character, acc as an object', async () => {
    const { ctx } = harness('make a character video');
    const made = await runMotionTool('create_character', { character: 'Kai', at: [660, 975], height: 540, duration: 4 }, ctx) as Made;
    expect(made.error).toBeUndefined();
    // big-pickle (OpenCode) quoted every number inside the actions array.
    const animated = await runMotionTool('animate_character', { clipId: made.clipId, layerId: 'char-kai', replace: true, actions: [{ do: 'wave', duration: '1', t: '0.2' }, { do: 'talk', duration: '1.8', t: '1.35' }, { do: 'turn', amount: '-0.5', t: '3.25' }, { at: 2, do: 'Walk', to: ['900', '975'] }] }, ctx) as Made;
    expect(animated.error).toBeUndefined();
    const twin = await runMotionTool('create_character', { character: 'Kai', clipId: made.clipId, at: [1220, 975], facing: -1 }, ctx) as Made;
    expect(twin.error).toBeUndefined();
    expect(twin.layerId).toBe('char-kai-2');
    const scene = await sceneOf(ctx, made.clipId!);
    const kai = scene.layers.find((l) => l.id === 'char-kai') as { character: CharacterData };
    expect(kai.character.actions!.map((a) => [a.do, a.t])).toEqual([['wave', 0.2], ['talk', 1.35], ['walk', 2], ['turn', 3.25]]);
    expect(kai.character.actions!.find((a) => a.do === 'turn')!.amount).toBe(-0.5);
    expect(validateScene(scene)).toEqual([]);
    expect(normalizeSpec({ name: 'Kai', height: '1', acc: { item: { item: ['capback', 'headphones'] } } })).toEqual({ name: 'Kai', height: 1, acc: ['capback', 'headphones'] });
    const designed = await runMotionTool('create_character', { spec: { name: 'Kai', age: 'teen', height: '1', acc: { item: ['capback', 'headphones'] } }, actions: [] }, ctx) as Made;
    expect(designed.error).toBeUndefined();
    const drawn = (await sceneOf(ctx, designed.clipId!)).layers.find((l) => l.type === 'character') as { character: CharacterData };
    expect((drawn.character.spec as { acc: string[] }).acc).toEqual(['capback', 'headphones']);
    const bad = await runMotionTool('animate_character', { clipId: made.clipId, layerId: 'char-kai', actions: [{ do: 'wave', t: 'soon' }] }, ctx) as Made;
    expect(bad.error).toContain('"t": 1.5');
  });

  it('turns the shared actions into the room engine pose: walk in profile, wave, talk', () => {
    const data: CharacterData = { kind: 'studio', spec: { name: 'x' }, step: 1, blink: false, actions: [{ t: 0, do: 'walk', to: -300 }, { t: 3, do: 'wave' }, { t: 5, do: 'talk', text: 'hello there friend' }] };
    const walking = studioParams(data, poseAt(data, 0.5), 0.5);
    expect(walking.pose).toBeDefined();
    expect(walking.yaw).toBeLessThan(-1);
    expect(studioParams(data, poseAt(data, 3.4), 3.4).pose).toBeDefined();
    const mouths = new Set([5.1, 5.3, 5.5, 5.7, 5.9].map((t) => studioParams(data, poseAt(data, t), t).mouthOpen));
    expect(mouths.size).toBeGreaterThan(1);
  });

  it('uses the same complete studio sample for rendering, scrubbing and repeat seeks', () => {
    const data: CharacterData = { kind: 'studio', spec: { name: 'x', motion2d: { timing: 'smooth', energy: 1.2, secondary: 0.8 } }, actions: [{ t: 0, do: 'wave', hand: 'left' }, { t: 2.6, do: 'hop' }] };
    const before = JSON.stringify(data);
    const frame = sampleStudioMotion(data, 0.8);
    expect(frame?.pose).toBeDefined();
    expect(studioParams(data, poseAt(data, 0.8), 0.8)).toEqual(frame);
    for (const t of [3.3, 0, 2.7, 0.2, 8]) sampleStudioMotion(data, t);
    expect(sampleStudioMotion(data, 0.8)).toEqual(frame);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('defaults new studio animation to smooth timing and retains explicitly saved drawing holds', () => {
    const data: CharacterData = { kind: 'studio', spec: { name: 'x' }, actions: [{ t: 0, do: 'wave' }] };
    expect(sampleStudioMotion(data, 10 / 30)).not.toEqual(sampleStudioMotion(data, 11 / 30));
    expect(sampleStudioMotion({ ...data, step: 1 }, 0.301)).not.toEqual(sampleStudioMotion({ ...data, step: 1 }, 0.305));
    for (const timing of ['film', 'drawn'] as const) {
      const directed = { ...data, spec: { name: 'x', motion2d: { timing } } };
      expect(sampleStudioMotion(directed, 0.101)).toEqual(sampleStudioMotion(directed, 0.110));
    }
    for (const step of [2, 3] as const) {
      for (let f = 0; f < 90; f += step) {
        const held = sampleStudioMotion({ ...data, step }, f / 30);
        for (let offset = 1; offset < step; offset++) expect(sampleStudioMotion({ ...data, step }, (f + offset) / 30)).toEqual(held);
      }
    }
    expect(characterActionDuration(data, { t: 0, do: 'wave' })).toBeGreaterThan(actionDuration({ t: 0, do: 'wave' }));
    expect(characterActionDuration({ ...data, step: 2 }, { t: 0, do: 'wave' })).toBe(actionDuration({ t: 0, do: 'wave' }));
  });

  it('treats blink=true as automatic blinking and keeps deliberate closed-eye expressions', () => {
    const data: CharacterData = { kind: 'studio', spec: { name: 'x' }, blink: true };
    const openness = Array.from({ length: 240 }, (_, f) => poseAt(data, f / 30).eyes);
    expect(Math.max(...openness)).toBe(1);
    expect(Math.min(...openness)).toBeLessThan(0.2);
    expect(poseAt({ ...data, blink: false }, 1).eyes).toBe(1);
    expect(poseAt({ ...data, blink: false, expression: 'closed' }, 1).eyes).toBe(0);
  });

  it('preserves timeline travel distances across consecutive actions and applies the root once', () => {
    const data: CharacterData = { kind: 'studio', spec: { name: 'x' }, actions: [{ t: 1, do: 'walk', duration: 2, to: -300 }, { t: 4, do: 'walk', duration: 1, to: 100 }] };
    expect(poseAt(data, 0).x).toBe(0);
    expect(poseAt(data, 3.5).x).toBeCloseTo(-300);
    expect(poseAt(data, 6).x).toBeCloseTo(-200);
    const scene: MotionScene = { version: 1, width: 1920, height: 1080, duration: 7, layers: [{ id: 'studio', type: 'character', character: data, transform: { position: [500, 900], scale: 50 } }] };
    const start = evaluateScene(scene, 0).layers[0].matrix;
    const end = evaluateScene(scene, 6).layers[0].matrix;
    expect(end[12] - start[12]).toBeCloseTo(-100);
    expect(scene.layers[0].transform?.position).toEqual([500, 900]);
  });

  it('draws a library character onto a canvas context', () => {
    let fills = 0;
    const noop = () => undefined;
    const ctx = new Proxy({}, {
      get: (_t, key) => (key === 'fill' ? () => { fills++; } : key === 'createPattern' || key === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const data: CharacterData = { kind: 'studio', spec: { name: 'Mira', age: 'teen', body: 'fem', hair: { style: 'ponytail', color: '#E07B2E' } }, actions: [{ t: 0, do: 'wave' }] };
    expect(drawStudioCharacter(ctx, data, 0.4, 1)).toBe(true);
    expect(fills).toBeGreaterThan(50);
  });

  it('reuses held drawings at export density and invalidates in-place appearance and action edits', () => {
    const engine = fakeWindow.CharEngine as { render: (...args: unknown[]) => string };
    const render = vi.spyOn(engine, 'render');
    const noop = () => undefined;
    const ctx = new Proxy({}, { get: (_t, key) => key === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop, set: () => true }) as unknown as CanvasRenderingContext2D;
    const data: CharacterData = { kind: 'studio', spec: { name: 'Cache invalidation', skin: '#DDA37D' }, step: 2, actions: [{ t: 0, do: 'wave', hand: 'right' }] };
    try {
      drawStudioCharacter(ctx, data, 0.4, 1);
      const original = render.mock.results[0].value;
      drawStudioCharacter(ctx, JSON.parse(JSON.stringify(data)), 0.42, 2);
      expect(render).toHaveBeenCalledTimes(1);
      data.spec!.skin = '#654321';
      drawStudioCharacter(ctx, data, 0.4, 1);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render.mock.results[1].value).toContain('#654321');
      expect(render.mock.results[1].value).not.toBe(original);
      data.actions![0].hand = 'left';
      drawStudioCharacter(ctx, data, 0.4, 1);
      expect(render).toHaveBeenCalledTimes(3);
      expect(render.mock.results[2].value).not.toBe(render.mock.results[1].value);
      data.spec!.motion2d = { ink: false };
      drawStudioCharacter(ctx, data, 0.4, 1);
      expect(render).toHaveBeenCalledTimes(4);
      expect(render.mock.results[3].value).not.toBe(render.mock.results[2].value);
    } finally { render.mockRestore(); }
  });

  it('evicts old generated drawings during a long playback instead of retaining its entire history', () => {
    const engine = fakeWindow.CharEngine as { render: (...args: unknown[]) => string };
    const render = vi.spyOn(engine, 'render').mockReturnValue('<path d="M0 0L1 1" fill="none"/>');
    const noop = () => undefined;
    const ctx = new Proxy({}, { get: () => noop, set: () => true }) as unknown as CanvasRenderingContext2D;
    const data: CharacterData = { kind: 'studio', spec: { name: 'Bounded playback cache' }, actions: [{ t: 0, do: 'idle', duration: 60 }] };
    try {
      for (let i = 0; i < 80; i++) drawStudioCharacter(ctx, data, i / 30, 1);
      const afterPlayback = render.mock.calls.length;
      drawStudioCharacter(ctx, data, 79 / 30, 2);
      expect(render).toHaveBeenCalledTimes(afterPlayback);
      drawStudioCharacter(ctx, data, 0, 1);
      expect(render).toHaveBeenCalledTimes(afterPlayback + 1);
    } finally { render.mockRestore(); }
  });
});
