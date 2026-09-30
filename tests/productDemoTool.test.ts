import { describe, expect, it, vi } from 'vitest';

const AI_WORK = 'C:/Projects/Film/AI Work';
const typed = 'Cut this';
const manifest = {
  key: 'k1', url: 'http://127.0.0.1:5199/', width: 1920, height: 1080, scale: 3, issues: [], dir: `${AI_WORK}/ui-parts/bhippi-demo`,
  parts: [
    { part: 'window', state: 'idle', file: 'window__idle.png', boxCss: [0, 0, 1920, 1080], pixels: [5760, 3240] },
    ...Array.from({ length: typed.length + 1 }, (_, i) => ({ part: 'composer', state: `t${String(i).padStart(2, '0')}`, file: `composer__t${String(i).padStart(2, '0')}.png`, boxCss: [10, 894, 430, 122], pixels: [1290, 366], typed: typed.slice(0, i) })),
    { part: 'send', state: 'idle', file: 'send__idle.png', boxCss: [395, 971, 32, 32], pixels: [96, 96] },
    { part: 'timeline', state: 'idle', file: 'timeline__idle.png', boxCss: [825, 644, 1000, 404], pixels: [3000, 1212] },
  ],
};
const read = vi.fn(async (path: string) => (path === `${AI_WORK}/ui-parts/bhippi-demo/manifest.json` ? new Response(JSON.stringify(manifest)) : new Response('not here', { status: 404 })));

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), storageInfo: vi.fn(async () => ({ categories: [{ id: 'ai-work', folder: 'AI Work', path: AI_WORK, exists: true, bytes: 0 }] })) },
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  fileSrc: (p: string) => p,
  fetchFile: (path: string) => read(path),
}));

import { captureFolder } from '../src/lib/appCapture';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { logicalScene } from '../src/lib/motionStack';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import { keysAt } from '../src/motion/anim';
import type { Key, Vec } from '../src/motion/types';

function harness(project: Project) {
  let current = project;
  const ctx: MotionToolContext = {
    get project() { return current; },
    assets: new Map(),
    commit: (change) => { current = change(current); },
    editComp: (comp, change) => { current = updateComp(current, comp.id, change); },
    pickComp: (p) => p.comps[0],
    current: () => current,
  } as MotionToolContext;
  return { ctx, get: () => current };
}

const call = {
  capture: 'bhippi-demo',
  shots: [{ at: 0, focus: 'composer' }, { at: 3, wide: true }],
  actions: [{ at: 0.4, type: 'composer', until: 1.2, cursor: 'you' }, { at: 1.8, click: 'send', cursor: 'bhippi' }],
  cursors: ['you', 'bhippi'],
  start: 2,
};

describe('create_product_demo', () => {
  it('names capture folders the way the capture does', () => {
    expect(captureFolder('Bhippi composer / typing')).toBe('Bhippi-composer---typing');
    expect(captureFolder('///')).toBe('session');
  });

  it('loads the capture by name and places a layered [Motion] comp with its sounds', async () => {
    const h = harness(newProject());
    const result = await runMotionTool('create_product_demo', call, h.ctx) as unknown as { ok: boolean; summary: string; compId: string; clipId: string; sfxClipIds: string[]; moments: number[]; layers: { layerId: string }[] };
    expect(result.ok).toBe(true);
    expect(read).toHaveBeenCalledWith(`${AI_WORK}/ui-parts/bhippi-demo/manifest.json`);
    const project = h.get();
    const comp = project.comps.find((c) => c.id === result.compId)!;
    expect(comp.name).toBe('[Motion] Product demo');
    const scene = logicalScene(project, comp)!;
    // One layer per track: the window, each part's states, the cursors, the camera.
    expect(result.layers.length).toBe(scene.layers.length);
    expect(scene.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['window', 'window@idle', 'composer@t08', 'send@idle', 'cursor-you', 'cursor-bhippi-arrow', 'camera']));
    expect(scene.template?.id).toBe('product-demo');
    // The pictures come from the capture's own folder.
    const picture = scene.layers.find((l) => l.id === 'composer@t08');
    expect(picture?.type === 'footage' && picture.source.path).toBe(`${AI_WORK}/ui-parts/bhippi-demo/composer__t08.png`);
    // Placed at 2 s on the timeline, with typing and click sounds, and the moments to look at.
    const holder = project.comps[0].clips.find((c) => c.id === result.clipId)!;
    expect(holder.start).toBe(2);
    expect(result.sfxClipIds.length).toBeGreaterThanOrEqual(2);
    expect(result.moments).toEqual([2.05, 3.85, 5.05]);
    expect(result.summary).toContain('review_frames {"times":[2.05, 3.85, 5.05]}');
  });

  it('rebuilds with new times and keeps the capture', async () => {
    const h = harness(newProject());
    const placed = await runMotionTool('create_product_demo', call, h.ctx) as unknown as { clipId: string; compId: string };
    const updated = await runMotionTool('update_motion_scene', { clipId: placed.clipId, params: { shots: [{ at: 0, focus: 'composer' }, { at: 4.2, wide: true }] } }, h.ctx);
    expect(updated.ok).toBe(true);
    const scene = logicalScene(h.get(), h.get().comps.find((c) => c.id === placed.compId)!)!;
    const camera = scene.layers.find((l) => l.id === 'camera')!;
    const k = (camera.transform!.position as { k: Key<Vec>[] }).k;
    // The pull-back now lands at 4.2 s: the camera is still travelling at 3.5.
    expect(keysAt(k, 3.5)[2]).not.toBeCloseTo(keysAt(k, 4.2)[2], 0);
    expect(keysAt(k, 4.2)[2]).toBeCloseTo(-(1920 * (2666.7 / 1920)) / 0.84, 0);
    const got = await runMotionTool('get_motion_scene', { clipId: placed.clipId }, h.ctx) as unknown as { templateParams: { capture: string } };
    expect(got.templateParams.capture).toContain('pictures of 4 parts');
  });

  it('comes through create_motion_scene too, and as the window-explode move', async () => {
    const h = harness(newProject());
    const viaScene = await runMotionTool('create_motion_scene', { template: 'product-demo', params: { capture: 'bhippi-demo', shots: [{ at: 0, wide: true }] } }, h.ctx);
    expect(viaScene.ok).toBe(true);
    const explode = await runMotionTool('create_product_demo', { capture: 'bhippi-demo', template: 'window-explode', at: 0.3, slam: 2.4 }, h.ctx) as unknown as { ok: boolean; compId: string; summary: string };
    expect(explode.ok).toBe(true);
    expect(explode.summary).toContain('Window explode');
    expect(logicalScene(h.get(), h.get().comps.find((c) => c.id === explode.compId)!)!.template?.id).toBe('window-explode');
  });

  it('says what to fix: a capture that is not there, a part it does not have', async () => {
    const h = harness(newProject());
    const missing = await runMotionTool('create_product_demo', { capture: 'nothing' }, h.ctx);
    expect(missing.ok).toBe(false);
    expect((missing as { error: string }).error).toContain(`${AI_WORK}/ui-parts/nothing/manifest.json`);
    const wrong = await runMotionTool('create_product_demo', { capture: 'bhippi-demo', shots: [{ at: 0, focus: 'menu' }] }, h.ctx);
    expect(wrong.ok).toBe(false);
    expect((wrong as { error: string }).error).toMatch(/no part "menu".*window, composer, send, timeline/);
  });
});
