import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ mogrtFrameWrite: vi.fn(), frontendCrash: vi.fn() }));
vi.mock('../src/lib/ipc', () => ({ api: ipc, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { openFrameWriter } from '../src/lib/pngEncoder';
import { renderProgress } from '../src/lib/renderProgress';

/** How the fake encoder workers answer a frame: after `delay` ms, or never. */
let reply: { mode: 'answer' | 'never' | 'messageerror'; delay: number } = { mode: 'answer', delay: 10 };
const spawned: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  constructor() { spawned.push(this); }
  postMessage(message: { id: number; ping?: boolean }) {
    if (message.ping) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true } })); return; }
    if (reply.mode === 'never') return;
    setTimeout(() => {
      if (this.terminated) return;
      if (reply.mode === 'messageerror') this.onmessageerror?.({});
      else this.onmessage?.({ data: { id: message.id, png: new ArrayBuffer(8) } });
    }, reply.delay);
  }
  terminate() { this.terminated = true; }
}

const never = () => new Promise<void>(() => undefined);
/** A frame's pixels, owned by the writer once queued. */
const px = () => new Uint8ClampedArray(4);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  // Six cores: four encoder workers, five frames in flight.
  vi.stubGlobal('navigator', { hardwareConcurrency: 6 });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  reply = { mode: 'answer', delay: 10 };
  spawned.length = 0;
  ipc.mogrtFrameWrite.mockReset();
  ipc.frontendCrash.mockReset();
  ipc.frontendCrash.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('frame writer deadlines', () => {
  it('fails a frame whose disk write never answers', async () => {
    ipc.mogrtFrameWrite.mockImplementation(never);
    const writer = await openFrameWriter('dir');
    await writer.pixels(0, 1, 1, px());
    const finished = expect(writer.finish()).rejects.toThrow('frame 0: mogrt_frame_write gave no answer');
    await vi.advanceTimersByTimeAsync(30_100);
    await finished;
    await writer.close();
  });

  it('fails a frame whose encoder never replies, and replaces that worker', async () => {
    reply = { mode: 'never', delay: 0 };
    ipc.mogrtFrameWrite.mockResolvedValue(undefined);
    const writer = await openFrameWriter('dir');
    await writer.pixels(0, 1, 1, px());
    const finished = expect(writer.finish()).rejects.toThrow('PNG encoder gave no answer');
    await vi.advanceTimersByTimeAsync(30_000);
    await finished;
    expect(spawned.filter((worker) => worker.terminated)).toHaveLength(1);
    expect(spawned).toHaveLength(5);
    await writer.close();
  });

  it('fails the frames of a worker whose reply cannot be read', async () => {
    reply = { mode: 'messageerror', delay: 10 };
    ipc.mogrtFrameWrite.mockResolvedValue(undefined);
    const writer = await openFrameWriter('dir');
    await writer.pixels(0, 1, 1, px());
    const finished = expect(writer.finish()).rejects.toThrow('messageerror');
    await vi.advanceTimersByTimeAsync(10);
    await finished;
    await writer.close();
  });

  it('lets close() return soon after a cancel with five frames in flight', async () => {
    ipc.mogrtFrameWrite.mockImplementation(never);
    const controller = new AbortController();
    const writer = await openFrameWriter('dir', undefined, controller.signal);
    for (let i = 0; i < 4; i++) await writer.pixels(i, 1, 1, px());
    // The fifth frame waits for room, which a cancel must end.
    const fifth = expect(writer.pixels(4, 1, 1, px())).rejects.toThrow('export cancelled');
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await fifth;
    let closed = false;
    void writer.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closed).toBe(true);
    await expect(writer.finish()).rejects.toThrow('export cancelled');
  });

  it('keeps the first failure and still closes when the other frames are stuck', async () => {
    ipc.mogrtFrameWrite.mockImplementationOnce(() => Promise.reject(new Error('disk full'))).mockImplementation(never);
    const writer = await openFrameWriter('dir');
    for (let i = 0; i < 4; i++) await writer.pixels(i, 1, 1, px());
    const fifth = expect(writer.pixels(4, 1, 1, px())).rejects.toThrow('disk full');
    await vi.advanceTimersByTimeAsync(10);
    await fifth;
    await expect(writer.finish()).rejects.toThrow('disk full');
    let closed = false;
    void writer.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closed).toBe(true);
  });

  it('reports which frames are encoding and being written', async () => {
    ipc.mogrtFrameWrite.mockImplementation(never);
    const seen: string[] = [];
    const writer = await openFrameWriter('dir', undefined, undefined, (frames) => seen.push(frames.map((f) => `${f.index}:${f.stage}`).join(',')));
    await writer.pixels(7, 1, 1, px());
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual(['7:encode', '7:write']);
    const finished = expect(writer.finish()).rejects.toThrow('mogrt_frame_write');
    await vi.advanceTimersByTimeAsync(30_000);
    await finished;
    expect(seen.at(-1)).toBe('');
    await writer.close();
  });
});

describe('render window stall watchdog', () => {
  afterEach(() => renderProgress.close());

  it('says what is stuck after 20 s without progress and logs it once', async () => {
    renderProgress.start(['scenes', 'encoding'], 100, null);
    renderProgress.item('Channel avatar bug', 3, 15, 100);
    renderProgress.frame(12);
    renderProgress.inflight([{ index: 14, stage: 'write' }, { index: 13, stage: 'encode' }]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(renderProgress.get().stall).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(renderProgress.get().stall).toBe('No progress for 20 s: waiting on motion 3/15 "Channel avatar bug" for frame 13 (PNG encode)');
    expect(renderProgress.stalledFor()).toBeGreaterThanOrEqual(20_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renderProgress.get().stall).toMatch(/^No progress for 50 s/);
    expect(ipc.frontendCrash).toHaveBeenCalledTimes(1);
    expect(ipc.frontendCrash.mock.calls[0][0]).toBe('export stall');
    expect(JSON.parse(ipc.frontendCrash.mock.calls[0][1])).toMatchObject({ stage: 'motion 3/15 "Channel avatar bug"', frame: 13 });
    renderProgress.frame(13);
    expect(renderProgress.get().stall).toBeNull();
  });

  it('lets a cancelled render that does not stop be closed after 6 s', async () => {
    renderProgress.start(['scenes', 'encoding'], 100, null);
    renderProgress.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(renderProgress.get().abandoned).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renderProgress.get()).toMatchObject({ status: 'running', abandoned: true });
    renderProgress.close();
    // The render finally giving up must not reopen the window.
    renderProgress.finish('cancelled');
    expect(renderProgress.get().open).toBe(false);
  });

  it('stops watching once the render ends', async () => {
    renderProgress.start(['encoding'], 0, null);
    renderProgress.finish('done', { output: 'out.mp4' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renderProgress.get().stall).toBeNull();
    expect(ipc.frontendCrash).not.toHaveBeenCalled();
  });
});
