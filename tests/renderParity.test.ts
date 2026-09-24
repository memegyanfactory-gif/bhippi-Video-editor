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
// Text rasters are counted; layout runs for real with a fixed advance per character.
const rasters = vi.hoisted(() => ({ text: 0 }));
vi.mock('../src/motion/gl/raster', async () => {
  const { layoutText } = await vi.importActual<typeof import('../src/motion/text')>('../src/motion/text');
  return {
    CanvasCache: class { clear() {} },
    textFrame: (data: Parameters<typeof layoutText>[0], t: number, ctx: Parameters<typeof layoutText>[3]) => layoutText(data, t, (text) => text.length * 30, ctx),
    rasterText: (_cache: unknown, _key: string, _data: unknown, frame: { width: number; height: number }, density: number) => { rasters.text++; return { width: frame.width * density, height: frame.height * density }; },
    rasterShape: () => ({ canvas: { width: 1, height: 1 }, pad: 0 }),
    rasterMasks: () => ({ width: 1, height: 1 }),
  };
});
// The playhead hooks subscribe to a store with no server snapshot: a server render reads them plainly.
vi.mock('../src/lib/playhead', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/playhead')>()), usePlayhead: () => 0, usePlaying: () => false, useRate: () => 1 }));
// A server render runs no effects, so the graphic's GSAP timeline is never built.
vi.mock('gsap', () => ({ default: {} }));
vi.mock('../src/lib/ipc', () => ({ api: { mogrtFramesBegin: async (id: string) => `frames/${id}`, frontendCrash: async () => undefined }, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import React from 'react';
import { renderToString } from 'react-dom/server';
import { CompLayers } from '../src/editor/Compositor';
import { HtmlMotionLayer } from '../src/editor/HtmlMotionLayer';
import { ProgramMonitor, shouldStep } from '../src/editor/ProgramMonitor';
import { correctionsOnFrame } from '../src/editor/RotoPreview';
import { correctedAlpha } from '../src/lib/rotoCorrections';
import { renderMotionScenesForExport, renderMotionStill } from '../src/motion/exportFrames';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Project, RotoCorrection } from '../src/lib/types';
import { identity } from '../src/motion/math';
import { MediaBank } from '../src/motion/sources';
import type { ResolvedLayer } from '../src/motion/evaluate';
import type { Layer, MotionScene } from '../src/motion/types';

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
  rasters.text = 0;
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
      bank: { fps: 30 },
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

describe('text texture cache', () => {
  /** A real renderer on a fake GL: enough to run a layer's content path. */
  function textRenderer() {
    const renderer = Object.create(RealRenderer.prototype) as InstanceType<typeof RealRenderer>;
    Object.assign(renderer, {
      incomplete: 0,
      canvases: { clear: () => undefined },
      uploads: new Map(),
      textCache: new WeakMap(),
      textSignatures: new Map(),
      gl: { maxTexture: 8192, upload: (_source: unknown, existing?: object) => existing ?? {}, acquire: (w: number, h: number) => ({ w, h, tex: {} }), pass: () => undefined, release: () => undefined, deleteTexture: () => undefined },
    });
    return renderer;
  }
  const draw = (renderer: InstanceType<typeof RealRenderer>, text: object) => {
    const layer = { id: 'title', type: 'text', text } as unknown as Layer;
    const scene = { width: 1920, height: 1080, duration: 2, layers: [layer] } as unknown as MotionScene;
    const L = { layer, index: 0, active: true, size: [600, 200], matrix: identity(), blurMatrices: [], opacity: 1, is3D: false, depth: 0, masks: [], effects: [], time: 1 } as unknown as ResolvedLayer;
    (renderer as unknown as { content: (...args: unknown[]) => unknown }).content(scene, {}, L, 1, 0, 30);
  };

  it('re-rasters when a two-line layer is realigned, and only then', () => {
    const renderer = textRenderer();
    const left = { text: 'a much longer first line\nshort', size: 60, align: 'left' };
    draw(renderer, left);
    draw(renderer, left);
    expect(rasters.text).toBe(1);
    draw(renderer, { ...left, align: 'center' });
    expect(rasters.text).toBe(2);
  });

  it('re-rasters an edit the glyphs do not show (a new stroke colour)', () => {
    const renderer = textRenderer();
    const dark = { text: 'Title', size: 60, stroke: { color: '#000', width: 4 } };
    draw(renderer, dark);
    draw(renderer, { ...dark, stroke: { color: '#fff', width: 4 } });
    expect(rasters.text).toBe(2);
  });
});

/** Just enough of a <video> for the media bank: seeks land a tick later, play/pause flip `paused`. */
class FakeVideo {
  muted = false; playsInline = false; preload = ''; crossOrigin = ''; src = '';
  readyState = 4; videoWidth = 1920; videoHeight = 1080; duration = 100;
  paused = true; seeking = false; playbackRate = 1;
  private time = 0;
  private listeners = new Map<string, Set<() => void>>();
  get currentTime() { return this.time; }
  set currentTime(value: number) {
    this.time = value;
    this.seeking = true;
    setTimeout(() => { this.seeking = false; this.emit('seeked'); }, 0);
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type: string, listener: () => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener); }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  removeAttribute() {}
  load() {}
  emit(type: string) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
}

describe('media bank', () => {
  let videos: FakeVideo[] = [];
  beforeEach(() => {
    videos = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('document', { createElement: () => { const video = new FakeVideo(); videos.push(video); return video; } });
  });
  afterEach(() => { vi.useRealTimers(); });

  const bank = () => new MediaBank({ resolve: (source) => ({ url: `media/${(source as { asset: string }).asset}.mp4`, kind: 'video' }), matte: async () => null });
  /** One file cut in two and rippled closed: plate 0–5 s reads source 0–5, plate~2 5–9 s reads source 6–10. */
  const razored = { width: 1920, height: 1080, duration: 9, layers: [
    { id: 'plate', type: 'footage', in: 0, out: 5, source: { asset: 'a', in: 0 } },
    { id: 'plate~2', type: 'footage', in: 5, out: 9, startTime: -1, source: { asset: 'a', in: 0 } },
  ] } as unknown as MotionScene;

  it('leaves a shared video on the frame the layer on screen needs, not the next piece', async () => {
    const b = bank();
    const ready = b.prepareExact(razored, 4.7, { presented: false });
    await vi.advanceTimersByTimeAsync(10);
    await ready;
    expect(videos).toHaveLength(1);
    expect(videos[0].currentTime).toBeCloseTo(4.7, 6);
    expect(b.frame({ asset: 'a' } as never, 4.7)).not.toBeNull();
    // Past the cut the second piece is on screen and takes the video.
    const later = b.prepareExact(razored, 5.2, { presented: false });
    await vi.advanceTimersByTimeAsync(10);
    await later;
    expect(videos[0].currentTime).toBeCloseTo(6.2, 6);
  });

  it('gives no frame for a moment the video is not on', async () => {
    const b = bank();
    const ready = b.prepareExact(razored, 2, { presented: false });
    await vi.advanceTimersByTimeAsync(10);
    await ready;
    expect(b.frame({ asset: 'a' } as never, 2)).not.toBeNull();
    expect(b.frame({ asset: 'a' } as never, 2.5)).toBeNull();
    videos[0].currentTime = 3;
    expect(b.frame({ asset: 'a' } as never, 3)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(b.frame({ asset: 'a' } as never, 3)).not.toBeNull();
  });

  it('pauses videos no one asked for lately', () => {
    const b = bank();
    b.syncPreview(razored, 1, true, 1);
    expect(videos[0].paused).toBe(false);
    vi.advanceTimersByTime(200);
    b.pauseIdle(500);
    expect(videos[0].paused).toBe(false);
    vi.advanceTimersByTime(400);
    b.pauseIdle(500);
    expect(videos[0].paused).toBe(true);
  });

  it('gives up on footage that never loads', async () => {
    const b = bank();
    vi.stubGlobal('document', { createElement: () => { const video = new FakeVideo(); video.readyState = 0; videos.push(video); return video; } });
    const ready = expect(b.prepareExact(razored, 1)).rejects.toThrow('footage media/a.mp4 did not load in 20 s');
    await vi.advanceTimersByTimeAsync(20_000);
    await ready;
  });

  it('gives up on a roto matte that never arrives', async () => {
    const b = new MediaBank({ resolve: () => ({ url: 'media/a.mp4', kind: 'video' }), matte: () => new Promise(() => undefined) });
    const matted = { width: 1920, height: 1080, duration: 4, layers: [{ id: 'plate', type: 'footage', source: { asset: 'a', matte: 'roto/a' } }] } as unknown as MotionScene;
    const ready = expect(b.prepareExact(matted, 1, { presented: false })).rejects.toThrow('roto/a did not load in 20 s');
    await vi.advanceTimersByTimeAsync(20_000);
    await ready;
  });
});

describe('HTML graphic placement', () => {
  /** The inline style of the graphic's design canvas as the preview renders it. */
  const canvasStyle = (stageW: number, stageH: number, template?: string) => {
    const html = renderToString(React.createElement(HtmlMotionLayer, { source: { html: '<b>Title</b>', template }, time: 0, clipStart: 0, clipDuration: 4, stageW, stageH }));
    return /class="mgt-canvas" style="([^"]*)"/.exec(html)?.[1] ?? '';
  };

  it('letterboxes a fixed 1920×1080 graphic in a tall comp, as the export fits it', () => {
    const style = canvasStyle(1080, 1920);
    expect(style).toContain('top:656.25px');
    expect(style).toContain('left:0');
    expect(style).toContain('scale(0.5625)');
  });

  it('fills a landscape comp with a fixed graphic unchanged', () => {
    const style = canvasStyle(1920, 1080);
    expect(style).toContain('top:0');
    expect(style).toContain('scale(1)');
  });
});

describe('motion clip placement', () => {
  /** The program's layers for one motion clip in a comp of the given size, as markup. */
  function program(width: number, height: number, fields: Partial<Clip>, scene: MotionScene) {
    const comp = newComp({ name: 'c', width, height });
    const v1 = tracksOf(comp, 'video')[0].id;
    comp.clips = [newClip({ trackId: v1, start: 0, duration: 4, source: { type: 'motion', scene } as Clip['source'], ...fields })];
    const project = { ...newProject(), comps: [comp] };
    return renderToString(React.createElement(CompLayers, { project, assets: new Map(), offline: new Set<string>(), playing: false, rate: 1, quality: 1, comp, time: 1, stageW: width, stageH: height, depth: 0 }));
  }
  const boxOf = (html: string) => /class="layer motion-layer"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? '';

  it('fits a landscape scene into a tall comp, centred, as the export places its frames', () => {
    const style = boxOf(program(1080, 1920, {}, emptyScene()));
    expect(style).toContain('left:0');
    expect(style).toContain('top:656.25px');
    expect(style).toContain('width:1080px');
    expect(style).toContain('height:607.5px');
  });

  it('masks, crops and flips a layer clip drawing on its own', () => {
    const scene = { width: 1080, height: 1920, duration: 4, stack: { id: 's', own: ['a'] }, layers: [{ id: 'a', type: 'solid', color: '#fff' }] } as unknown as MotionScene;
    const mask = { shape: 'rectangle', x: 0.1, y: 0.1, width: 0.5, height: 0.5, points: [], feather: 0, inverted: false };
    const html = program(1080, 1920, { mask: mask as unknown as Clip['mask'], effects: { ...newClip({ trackId: 't', start: 0, duration: 1, source: { type: 'motion', scene } as Clip['source'] }).effects, flipH: true } }, scene);
    const style = boxOf(html);
    expect(style).toContain('clip-path:inset(');
    expect(style).toContain('width:1080px');
    expect(html).toMatch(/class="layer-inner" style="[^"]*mask-image:url/);
    expect(html).toMatch(/class="layer-fill" style="transform:scale\(-1, 1\)"/);
  });
});

describe('program monitor playback', () => {
  it('moves the playhead 29-30 times a second on a jittery 60 Hz display', () => {
    let seed = 7;
    const jitter = () => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) * 2 - 1) * 0.05; };
    let last = 0;
    let carry = 0;
    let updates = 0;
    for (let i = 1; i <= 600; i++) {
      const now = (i * 1000) / 60 + jitter();
      carry += (now - last) / 1000;
      last = now;
      if (shouldStep(carry)) { updates++; carry = 0; }
    }
    expect(updates / 10).toBeGreaterThanOrEqual(29);
    expect(updates / 10).toBeLessThanOrEqual(30);
  });

  it('keeps the layers in one wrapper whether or not the preview is downscaled', () => {
    const project = newProject();
    const props = {
      project, comp: project.comps[0], assets: new Map(), offline: new Set<string>(), history: {} as never, selection: [], onSelect: () => undefined,
      tool: 'select' as never, onTool: () => undefined, onImport: () => undefined, onMarkIn: () => undefined, onMarkOut: () => undefined, onAddMarker: () => undefined,
      onLift: () => undefined, onExtract: () => undefined, onExportFrame: () => undefined, apiRef: { current: null },
    };
    // Paused, full quality: the same element the downscaled playback render uses.
    expect(renderToString(React.createElement(ProgramMonitor, props))).toMatch(/<div class="stage-render" style="width:\d+px;height:\d+px">/);
  });
});

describe('roto preview corrections', () => {
  const fps = 30;
  const painted: RotoCorrection[] = Array.from({ length: 500 }, (_, i) => ({ at: 10 / fps + 0.001, x: (i % 25) / 25, y: Math.floor(i / 25) / 20, radius: 0.02, softness: 0.5, mode: i % 2 ? 'include' : 'exclude' } as RotoCorrection));

  it('leaves frames without corrections on the GPU path', () => {
    const onFrame = correctionsOnFrame();
    // No points: RotoPreview draws the matte through its filter and never calls correctedAlpha.
    expect(onFrame(painted, 200 / fps, fps)).toEqual([]);
    expect(onFrame(painted, 10 / fps, fps)).toHaveLength(500);
  });

  it('works the list out once per frame, and again when the list changes', () => {
    const onFrame = correctionsOnFrame();
    const first = onFrame(painted, 10 / fps, fps);
    expect(onFrame(painted, 10 / fps + 0.01, fps)).toBe(first);
    expect(onFrame([...painted], 10 / fps, fps)).not.toBe(first);
  });

  it('corrects frame 10 exactly as the whole list does', () => {
    const points = correctionsOnFrame()(painted, 10 / fps, fps);
    for (const [x, y] of [[0, 0], [40, 30], [99, 60], [12, 77]]) {
      expect(correctedAlpha(0.5, x, y, 100, 100, 10 / fps, fps, points)).toBe(correctedAlpha(0.5, x, y, 100, 100, 10 / fps, fps, painted));
    }
  });
});
