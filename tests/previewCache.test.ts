import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { cacheScale, cacheSpans, FrameStore, frameDistance, hashString, pickNext, planComp, sceneKeyOf, type CacheEntry, type PlanClip } from '../src/lib/previewCache';
import { newClip, newComp, tracksOf } from '../src/lib/timeline';
import type { Asset, Clip } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

const scene = (over: Partial<MotionScene> = {}): MotionScene => ({ width: 1920, height: 1080, duration: 4, layers: [], ...over } as unknown as MotionScene);
const footageScene = (asset: string) => scene({ layers: [{ id: 'f', type: 'footage', source: { asset } }] } as unknown as Partial<MotionScene>);
const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, name: id, path: `C:/media/${id}.mp4`, kind: 'video', duration: 30, width: 1920, height: 1080, fps: 30, hasAudio: false, videoCodec: 'h264', audioCodec: null,
  size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false, ...over,
} as Asset);

function comp(clips: (Partial<Clip> & { scene?: MotionScene })[]) {
  const c = newComp({ name: 'c', fps: 30 });
  const v1 = tracksOf(c, 'video')[0].id;
  c.clips = clips.map(({ scene: s, ...fields }) => newClip({ trackId: v1, start: 0, duration: 1, source: { type: 'motion', scene: s ?? scene() } as Clip['source'], ...fields }));
  return c;
}

const entry = (key: string, frame: number, bytes = 100): CacheEntry => ({ key, frame, bitmap: null, width: 5, height: 5, bytes, scale: 0.5, lastUsed: 0 });

describe('scene keys', () => {
  it('hashes deterministically and tells different text apart', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('keys a scene by its content, not its object', () => {
    const assets = new Map<string, Asset>();
    expect(sceneKeyOf(scene(), assets)).toBe(sceneKeyOf(scene(), assets));
    expect(sceneKeyOf(scene({ duration: 5 }), assets)).not.toBe(sceneKeyOf(scene(), assets));
  });

  it('changes when the media a scene resolves to changes (a proxy finished, a relink)', () => {
    const s = footageScene('a1');
    const before = sceneKeyOf(s, new Map([['a1', asset('a1')]]));
    expect(sceneKeyOf(s, new Map([['a1', asset('a1')]]))).toBe(before);
    expect(sceneKeyOf(s, new Map([['a1', asset('a1', { proxy: 'C:/proxy/a1.mp4' })]]))).not.toBe(before);
    expect(sceneKeyOf(s, new Map([['a1', asset('a1', { missing: true })]]))).not.toBe(before);
  });
});

describe('planning', () => {
  it('maps each comp frame of a motion clip to the scene frame it shows', () => {
    const c = comp([{ start: 1, duration: 1, in: 0.5 }]);
    const [clip] = planComp(c, () => 'k');
    expect(clip.first).toBe(30);
    expect(clip.frames.length).toBe(30);
    expect(clip.frames[0]).toBe(15);
    expect(clip.frames[29]).toBe(44);
  });

  it('follows speed, and holds the last scene frame past the scene end', () => {
    const [fast] = planComp(comp([{ start: 0, duration: 1, speed: 2 }]), () => 'k');
    expect([...fast.frames.slice(0, 3)]).toEqual([0, 2, 4]);
    const [long] = planComp(comp([{ start: 0, duration: 6, scene: scene({ duration: 4 }) }]), () => 'k');
    expect(long.frames[long.frames.length - 1]).toBe(120);
  });

  it('skips disabled clips, hidden tracks and non-motion clips', () => {
    const c = comp([{ start: 0 }, { start: 2, enabled: false }]);
    c.clips.push(newClip({ trackId: c.clips[0].trackId, start: 5, duration: 1, source: { type: 'text', text: 'x' } as Clip['source'] }));
    expect(planComp(c, () => 'k').length).toBe(1);
    c.tracks = c.tracks.map((track) => (track.id === c.clips[0].trackId ? { ...track, hidden: true } : track));
    expect(planComp(c, () => 'k').length).toBe(0);
  });
});

const plan = (key: string, first: number, count: number, sceneStart = 0): PlanClip => ({ clipId: key, key, scene: scene(), first, frames: Int32Array.from({ length: count }, (_, i) => sceneStart + i) });

describe('what to render next', () => {
  it('weighs frames behind the playhead three times as far', () => {
    expect(frameDistance(110, 100)).toBe(10);
    expect(frameDistance(90, 100)).toBe(30);
  });

  it('starts at the playhead and works forward through its chunk', () => {
    const p = [plan('a', 0, 60)];
    const done = new Set<number>();
    const has = (_: string, f: number) => done.has(f);
    const first = pickNext(p, has, 20, 15)!;
    expect(first.sceneFrame).toBe(20);
    done.add(20);
    expect(pickNext(p, has, 20, 15)!.sceneFrame).toBe(21);
  });

  it('prefers a clip ahead to one equally far behind', () => {
    const p = [plan('behind', 0, 10), plan('ahead', 110, 10)];
    expect(pickNext(p, () => false, 100, 15)!.clip.key).toBe('ahead');
  });

  it('skips frames it has given up on, and returns null when nothing is left', () => {
    const p = [plan('a', 0, 3)];
    expect(pickNext(p, () => false, 0, 15, (_, f) => f === 0)!.sceneFrame).toBe(1);
    expect(pickNext(p, () => true, 0)).toBeNull();
  });
});

describe('the frame store', () => {
  it('counts bytes and drops only the scenes no clip uses any more', () => {
    const store = new FrameStore();
    store.put(entry('a', 1));
    store.put(entry('a', 2));
    store.put(entry('b', 1));
    expect(store.bytes).toBe(300);
    store.put(entry('a', 1, 50));
    expect(store.bytes).toBe(250);
    expect(store.retain(new Set(['b']))).toBe(2);
    expect(store.has('a', 1)).toBe(false);
    expect(store.has('b', 1)).toBe(true);
    expect(store.bytes).toBe(100);
  });

  it('evicts the frames furthest from the playhead to make room', () => {
    const store = new FrameStore();
    for (let f = 0; f < 5; f++) store.put(entry('a', f));
    const distance = (e: CacheEntry) => Math.abs(e.frame - 1);
    expect(store.makeRoom(500, 100, 0, distance)).toBe(true);
    expect(store.has('a', 4)).toBe(false);
    expect(store.size).toBe(4);
  });

  it('refuses a frame further out than everything it holds', () => {
    const store = new FrameStore();
    for (let f = 0; f < 5; f++) store.put(entry('a', f));
    expect(store.makeRoom(500, 100, 99, (e) => e.frame)).toBe(false);
    expect(store.size).toBe(5);
  });

  it('drops frames nothing needs first', () => {
    const store = new FrameStore();
    store.put(entry('old', 0));
    store.put(entry('a', 50));
    expect(store.makeRoom(200, 100, 10, (e) => (e.key === 'old' ? Infinity : 50))).toBe(true);
    expect(store.has('old', 0)).toBe(false);
    expect(store.has('a', 50)).toBe(true);
  });
});

describe('the render bar', () => {
  it('is green where cached, yellow where not, and empty where nothing is needed', () => {
    const p = [plan('a', 10, 20)];
    const has = (_: string, f: number) => f < 10;
    expect(cacheSpans(p, has, [], 10, 50)).toEqual([
      { start: 1, end: 2, state: 'ready' },
      { start: 2, end: 3, state: 'pending' },
    ]);
  });

  it('draws nothing past what the RAM budget can hold', () => {
    const p = [plan('a', 0, 30)];
    expect(cacheSpans(p, (_, f) => f < 10, [], 10, 50, (at) => at < 20)).toEqual([
      { start: 0, end: 1, state: 'ready' },
      { start: 1, end: 2, state: 'pending' },
    ]);
  });

  it('needs both the motion frames and the warmed media where they overlap', () => {
    const p = [plan('a', 0, 20)];
    const spans = cacheSpans(p, () => true, [{ start: 1, end: 3, ready: false }, { start: 3, end: 4, ready: true }], 10, 50);
    expect(spans).toEqual([
      { start: 0, end: 1, state: 'ready' },
      { start: 1, end: 3, state: 'pending' },
      { start: 3, end: 4, state: 'ready' },
    ]);
  });
});

describe('cache scale', () => {
  it('picks the smallest scale at least as sharp as the view, capped at half size', () => {
    expect(cacheScale(400, 1920)).toBe(0.25);
    expect(cacheScale(900, 1920)).toBe(0.5);
    expect(cacheScale(3000, 1920)).toBe(0.5);
    expect(cacheScale(200, 1920)).toBe(0.125);
  });
});
