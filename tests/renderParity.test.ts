import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Export renderers are counted, not run: a real one needs WebGL2.
const made = vi.hoisted(() => ({ renderers: 0, disposed: 0 }));
vi.mock('../src/motion/gl/renderer', () => ({
  MotionRenderer: class {
    bank = { prepareExact: async () => undefined, dispose: () => undefined };
    constructor() { made.renderers++; }
    pixels() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; }
    dispose() { made.disposed++; }
  },
}));
vi.mock('../src/lib/pngEncoder', () => ({
  openFrameWriter: async () => ({ pixels: async () => undefined, canvas: async () => undefined, finish: async () => undefined, close: async () => undefined }),
}));
vi.mock('../src/lib/ipc', () => ({ api: { mogrtFramesBegin: async (id: string) => `frames/${id}`, frontendCrash: async () => undefined }, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { renderMotionScenesForExport, renderMotionStill } from '../src/motion/exportFrames';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

const { MotionRenderer: RealRenderer } = await vi.importActual<typeof import('../src/motion/gl/renderer')>('../src/motion/gl/renderer');

const emptyScene = (): MotionScene => ({ width: 1920, height: 1080, duration: 1, layers: [] } as unknown as MotionScene);

/** A project whose first comp has `count` short motion clips one after another. */
function motionProject(count: number): Project {
  const project = newProject();
  const comp = project.comps[0];
  const v1 = tracksOf(comp, 'video')[0].id;
  comp.clips = Array.from({ length: count }, (_, i) => newClip({ trackId: v1, start: i, duration: 0.1, source: { type: 'motion', scene: emptyScene(), title: `m${i}` } as Clip['source'] }));
  return project;
}

beforeEach(() => {
  made.renderers = 0;
  made.disposed = 0;
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('WebGL context lifecycle', () => {
  it('uses one renderer for every motion target of an export', async () => {
    const project = motionProject(3);
    const out = await renderMotionScenesForExport(project, project.comps[0].id, []);
    expect(made.renderers).toBe(1);
    expect(made.disposed).toBe(1);
    expect(out.comps[0].clips.every((clip) => clip.source.type === 'motion' && !!clip.source.frames)).toBe(true);
  });

  it('makes no renderer for a still with no motion on screen', async () => {
    const project = motionProject(2);
    await renderMotionStill(project, project.comps[0].id, [5.5], []);
    expect(made.renderers).toBe(0);
    await renderMotionStill(project, project.comps[0].id, [0.05, 1.05], []);
    expect(made.renderers).toBe(1);
    expect(made.disposed).toBe(1);
  });

  it('refuses to read pixels from a lost context', () => {
    const renderer = Object.create(RealRenderer.prototype) as InstanceType<typeof RealRenderer>;
    Object.assign(renderer, { gl: { lost: true, gl: { isContextLost: () => false } } });
    expect(() => renderer.pixels(emptyScene(), 0)).toThrow('GPU context lost while rendering motion frames');
    // Lost during the frame: the zeros it read back are not a frame either.
    let lost = false;
    Object.assign(renderer, {
      renderScene: () => ({ w: 1, h: 1, tex: null }),
      gl: { lost: false, gl: { isContextLost: () => lost }, acquire: () => ({ w: 1, h: 1 }), pass: () => undefined, read: () => { lost = true; return new Uint8Array(4); }, releaseAll: () => undefined },
    });
    expect(() => renderer.pixels(emptyScene(), 0)).toThrow('GPU context lost');
  });

  it('counts a draw on a lost context as incomplete', () => {
    const renderer = Object.create(RealRenderer.prototype) as InstanceType<typeof RealRenderer>;
    Object.assign(renderer, { incomplete: 0, gl: { lost: true } });
    renderer.draw(emptyScene(), 0);
    expect(renderer.incomplete).toBe(1);
  });
});
