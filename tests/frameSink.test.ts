import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Export frames go to the app's loopback frame sink over HTTP (frame_sink.rs), and to the
// `mogrt_frame_write` invoke only when the sink cannot be reached.
const ipc = vi.hoisted(() => ({ mogrtFrameWrite: vi.fn(), frontendCrash: vi.fn(), frameSink: vi.fn() }));
vi.mock('../src/lib/ipc', () => ({ api: ipc, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

/** Encoder workers that answer every frame with a tiny PNG. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  postMessage(message: { id: number; ping?: boolean }) {
    queueMicrotask(() => this.onmessage?.({ data: message.ping ? { id: message.id, ok: true } : { id: message.id, png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer } }));
  }
  terminate() {}
}

const px = () => new Uint8ClampedArray(4);
const fetchMock = vi.fn();

/** A fresh copy of the writer, so each test asks for the sink anew. */
async function writerFor(dir: string) {
  vi.resetModules();
  const { openFrameWriter } = await import('../src/lib/pngEncoder');
  return openFrameWriter(dir);
}

beforeEach(() => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 6 });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  ipc.mogrtFrameWrite.mockReset();
  ipc.mogrtFrameWrite.mockResolvedValue(undefined);
  ipc.frameSink.mockReset();
  ipc.frameSink.mockResolvedValue({ url: 'http://127.0.0.1:5123', token: 'secret' });
});

afterEach(() => vi.unstubAllGlobals());

describe('the export frame sink', () => {
  it('PUTs each frame to the sink under its folder name, with the token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const writer = await writerFor('C:\\Users\\张伟\\AppData\\work\\mogrt\\clip_7-abc');
    await writer.pixels(3, 1, 1, px());
    await writer.finish();
    await writer.close();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5123/frame/clip_7-abc/3');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'x-bhippi-token': 'secret' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(ipc.mogrtFrameWrite).not.toHaveBeenCalled();
  });

  it('falls back to the invoke for good when the sink cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const writer = await writerFor('C:/work/mogrt/clip-1');
    await writer.pixels(0, 1, 1, px());
    await writer.finish();
    await writer.pixels(1, 1, 1, px());
    await writer.finish();
    await writer.close();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ipc.mogrtFrameWrite.mock.calls.map((call) => call[1])).toEqual([0, 1]);
  });

  it('uses the invoke when there is no sink', async () => {
    ipc.frameSink.mockRejectedValue(new Error('the frame sink could not start'));
    const writer = await writerFor('C:/work/mogrt/clip-2');
    await writer.pixels(0, 1, 1, px());
    await writer.finish();
    await writer.close();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ipc.mogrtFrameWrite).toHaveBeenCalledTimes(1);
  });

  it('fails the frame when the sink refuses it, rather than writing it somewhere else', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const writer = await writerFor('C:/work/mogrt/clip-3');
    await writer.pixels(0, 1, 1, px());
    await expect(writer.finish()).rejects.toThrow('frame 0: the frame sink answered 403');
    await writer.close();
    expect(ipc.mogrtFrameWrite).not.toHaveBeenCalled();
  });
});
