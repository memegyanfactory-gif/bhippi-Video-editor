import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaBank } from '../src/motion/sources';
import type { FootageSource, MotionScene } from '../src/motion/types';
import { meterSettled } from '../src/editor/ToolsAndMeters';
import { explodeScene, motionScenesAt, stackGroups } from '../src/lib/motionStack';
import { newClip, newComp, newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

// ───────────────────────── image sequences in the media bank ─────────────────────────

type FakeBitmap = { width: number; height: number; close: ReturnType<typeof vi.fn>; url: string };

describe('image-sequence frames', () => {
  let fetched: string[] = [];
  let bitmaps: FakeBitmap[] = [];
  /** Decodes still waiting to be let through (each resolves its fetch). */
  let held: (() => void)[] | null = null;
  let size = 1000;

  beforeEach(() => {
    fetched = [];
    bitmaps = [];
    held = null;
    size = 1000;
    vi.useFakeTimers({ toFake: ['performance'] });
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      const response = { ok: true, blob: async () => ({ url }) };
      if (!held) return Promise.resolve(response);
      return new Promise((resolve) => held!.push(() => resolve(response)));
    });
    vi.stubGlobal('createImageBitmap', async (blob: { url: string }) => {
      const bitmap: FakeBitmap = { width: size, height: size, close: vi.fn(), url: blob.url };
      bitmaps.push(bitmap);
      return bitmap;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const seq = { dir: 'D:/film/s01/stage', fps: 30, frames: 300 };
  const source = { sequence: seq } as unknown as FootageSource;
  const scene = { version: 1, width: 1920, height: 1080, duration: 10, layers: [{ id: 'stage', type: 'footage', source }] } as unknown as MotionScene;
  const bank = () => new MediaBank({ resolve: () => null, matte: async () => null, file: (path) => `asset://${path}` });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('decodes a frame into a bitmap off the page, and draws every frame of a sequence into one texture slot', async () => {
    const b = bank();
    await b.prepareExact(scene, 1);
    const first = b.frame(source, 1)!;
    expect(first.image).toBe(bitmaps[0]);
    expect(first.key).toBe('asset://D:/film/s01/stage/00031.png');
    expect(first.approximate).toBeUndefined();
    await b.prepareExact(scene, 2);
    const second = b.frame(source, 2)!;
    expect(second.key).toBe('asset://D:/film/s01/stage/00061.png');
    // Same slot, new content: the renderer refills one texture instead of allocating one per frame.
    expect(second.slot).toBe(first.slot);
    expect(second.slot).toBe('seq:D:/film/s01/stage/00001.png');
  });

  it('stands a neighbouring frame in while the exact one loads, marked approximate, and asks for the exact one', async () => {
    const b = bank();
    await b.prepareExact(scene, 1);
    const listener = vi.fn();
    b.listen(listener);
    held = [];
    const stand = b.frame(source, 1 + 1 / 30)!;
    expect(stand.approximate).toBe(true);
    expect(stand.key).toBe('asset://D:/film/s01/stage/00031.png');
    expect(fetched.at(-1)).toBe('asset://D:/film/s01/stage/00032.png');
    // Its arrival is a frame someone was waiting for, not a change to every picture.
    held.splice(0).forEach((release) => release());
    await settle();
    expect(listener).toHaveBeenCalledWith(false);
    expect(b.frame(source, 1 + 1 / 30)!.approximate).toBeUndefined();
    b.notify();
    expect(listener).toHaveBeenLastCalledWith(true);
  });

  it('drops the least recently used decoded frames past the memory budget, never the ones in use', async () => {
    size = 4096; // 64 MB a frame: eight fill the 512 MB budget
    const b = bank();
    for (let i = 0; i < 8; i++) await b.prepareExact(scene, i / 30);
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 0)).toBe(true);
    vi.advanceTimersByTime(1000);
    // The first frame is drawn again just now: it stays while older ones go.
    expect(b.frame(source, 0)!.approximate).toBeUndefined();
    await b.prepareExact(scene, 8 / 30);
    await b.prepareExact(scene, 9 / 30);
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    expect(bitmaps[1].close).toHaveBeenCalled();
    // A frame asked for again after it went is decoded afresh.
    const before = fetched.length;
    await b.prepareExact(scene, 1 / 30);
    expect(fetched.length).toBe(before + 1);
  });

  it('keeps every frame of a picture still being prepared, however much it holds', async () => {
    size = 8192; // 256 MB a frame: two already exceed the budget
    const wide = { ...scene, layers: [0, 1, 2].map((n) => ({ id: `pass${n}`, type: 'footage', source: { sequence: { ...seq, dir: `D:/film/s01/pass${n}` } } })) } as unknown as MotionScene;
    const b = bank();
    await b.prepareExact(wide, 1);
    expect(bitmaps).toHaveLength(3);
    expect(bitmaps.some((bitmap) => bitmap.close.mock.calls.length)).toBe(false);
    for (let n = 0; n < 3; n++) expect(b.frame({ sequence: { ...seq, dir: `D:/film/s01/pass${n}` } } as unknown as FootageSource, 1)!.approximate).toBeUndefined();
  });

  it('frees a frame that finishes decoding after the bank let it go', async () => {
    const b = bank();
    held = [];
    const ready = b.prepareExact(scene, 1);
    b.dispose();
    held.splice(0).forEach((release) => release());
    await ready;
    await settle();
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0].close).toHaveBeenCalled();
  });

  it('loads through an <img> where the webview cannot decode a bitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 360;
      crossOrigin = '';
      decoding = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) { setTimeout(() => this.onload?.(), 0); }
    }
    vi.stubGlobal('Image', FakeImage);
    const b = bank();
    await b.prepareExact(scene, 1);
    const picture = b.frame(source, 1)!;
    expect(picture.image).toBeInstanceOf(FakeImage);
    expect(picture.width).toBe(640);
    expect(fetched).toHaveLength(0);
  });
});

// ───────────────────────── the audio meters rest in silence ─────────────────────────

describe('audio meters', () => {
  const floor = -60;
  it('keep drawing while anything plays, even through a silent stretch', () => {
    expect(meterSettled(true, [-Infinity, -Infinity], [-Infinity, -Infinity], floor, 'dynamic')).toBe(false);
  });
  it('keep drawing while a channel reads above the floor', () => {
    expect(meterSettled(false, [-12, -Infinity], [-Infinity, -Infinity], floor, 'static')).toBe(false);
  });
  it('wait for a dynamic peak hold to drop before resting', () => {
    expect(meterSettled(false, [-Infinity, -Infinity], [-6, -Infinity], floor, 'dynamic')).toBe(false);
    expect(meterSettled(false, [-Infinity, -Infinity], [-Infinity, -Infinity], floor, 'dynamic')).toBe(true);
  });
  it('rest with a static peak hold still showing (it never moves)', () => {
    expect(meterSettled(false, [-Infinity, -Infinity], [-6, -3], floor, 'static')).toBe(true);
  });
  it('treat noise below the floor as silence', () => {
    expect(meterSettled(false, [-90, -75], [-Infinity, -Infinity], floor, 'dynamic')).toBe(true);
  });
});

describe('what plays into the audio bus', () => {
  type Node = Record<string, unknown>;
  const oscillators: Node[] = [];
  const node = (): Node => ({ connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined, gain: { value: 1, setTargetAtTime: () => undefined }, frequency: { value: 0 }, Q: { value: 0 }, threshold: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, onended: null });
  class FakeContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 48000;
    destination = node();
    createGain = node;
    createChannelSplitter = node;
    createChannelMerger = node;
    createAnalyser = node;
    createBiquadFilter = node;
    createDynamicsCompressor = node;
    createOscillator = () => { const made = node(); oscillators.push(made); return made; };
    createMediaElementSource = node;
    resume = async () => undefined;
  }
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('window', { addEventListener: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows media elements starting and stopping, so the meters wake for them', async () => {
    const audio = await import('../src/lib/audio');
    const changed = vi.fn();
    audio.onSound(changed);
    const element = Object.assign(new EventTarget(), { paused: true }) as unknown as HTMLMediaElement;
    audio.ClipChain.for(element);
    expect(audio.soundPlaying()).toBe(false);
    element.dispatchEvent(new Event('play'));
    expect(audio.soundPlaying()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    element.dispatchEvent(new Event('playing'));
    expect(changed).toHaveBeenCalledTimes(1);
    element.dispatchEvent(new Event('pause'));
    expect(audio.soundPlaying()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('counts an element already playing when it is routed, and tones and beeps while they sound', async () => {
    const audio = await import('../src/lib/audio');
    const element = Object.assign(new EventTarget(), { paused: false }) as unknown as HTMLMediaElement;
    audio.ClipChain.for(element);
    expect(audio.soundPlaying()).toBe(true);
    element.dispatchEvent(new Event('ended'));
    expect(audio.soundPlaying()).toBe(false);
    const stop = audio.startTone(1000, 0.1)!;
    expect(audio.soundPlaying()).toBe(true);
    stop();
    expect(audio.soundPlaying()).toBe(false);
    audio.beep();
    expect(audio.soundPlaying()).toBe(true);
    (oscillators.at(-1)!.onended as () => void)();
    expect(audio.soundPlaying()).toBe(false);
  });
});

// ───────────────────────── warming nested motion comps ─────────────────────────

describe('motion pictures on screen at a moment, nested comps included', () => {
  const W = 1920;
  const H = 1080;
  const scene: MotionScene = {
    version: 1, width: W, height: H, duration: 6,
    layers: [
      { id: 'stage', type: 'solid', color: '#102030' },
      { id: 'title', type: 'text', in: 1, text: { text: 'Hello', size: 80 } },
    ],
  };

  function film(): { project: Project; top: string; shot: string } {
    const base = newProject();
    const exploded = explodeScene(scene, { name: '[Motion] Shot', fps: 30 });
    const top = base.comps[0];
    // The shot runs from 2 s on the timeline, trimmed 1 s into its own time.
    const clip = newClip({ trackId: top.tracks[0].id, start: 2, in: 1, duration: 4, source: { type: 'comp', compId: exploded.comp.id } });
    const lone = newComp({ name: 'other' });
    return { project: { ...base, comps: [{ ...top, clips: [clip] }, exploded.comp, ...exploded.nested, lone] }, top: top.id, shot: exploded.comp.id };
  }

  it("finds a nested comp's fused stack at the nested comp's own time", () => {
    const { project, top, shot } = film();
    const topComp = project.comps.find((comp) => comp.id === top)!;
    const shotComp = project.comps.find((comp) => comp.id === shot)!;
    const found = motionScenesAt(project, topComp, 3.5);
    expect(found).toHaveLength(1);
    expect(found[0].scene).toBe(stackGroups(project, shotComp)[0].scene);
    expect(found[0].time).toBeCloseTo(2.5, 6);
  });

  it('finds nothing before the nested comp starts or once it has ended', () => {
    const { project, top } = film();
    const topComp = project.comps.find((comp) => comp.id === top)!;
    expect(motionScenesAt(project, topComp, 1.9)).toEqual([]);
    expect(motionScenesAt(project, topComp, 6.1)).toEqual([]);
  });

  it('gives a plain motion clip its scene time through its in point and speed', () => {
    const base = newProject();
    const top = base.comps[0];
    const clip = newClip({ trackId: top.tracks[0].id, start: 1, in: 0.5, speed: 2, duration: 2, source: { type: 'motion', scene, title: 'Shot' } as never });
    const project = { ...base, comps: [{ ...top, clips: [clip] }] };
    const found = motionScenesAt(project, project.comps[0], 1.5);
    expect(found).toHaveLength(1);
    expect(found[0].scene).toBe(scene);
    expect(found[0].time).toBeCloseTo(1.5, 6);
  });
});
