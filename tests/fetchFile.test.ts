// Reading a local file whole through the asset protocol (lib/ipc.ts fetchFile): in range pieces,
// put back together, never cut short at the webview's ~4 MB.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`, invoke: vi.fn() }));

import { fetchFile } from '../src/lib/ipc';

/** A file server like tauri's asset protocol: ranges answered with at most `cap` bytes each. */
function serve(file: Uint8Array, cap = 1000 * 1024, options: { ignoreRanges?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.Range;
    calls.push(range ?? 'whole');
    if (!range || options.ignoreRanges) return new Response(file.slice(), { status: 200, headers: { 'content-type': 'video/mp4' } });
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(range)!;
    const start = Number(from);
    const end = Math.min(file.length - 1, to ? Number(to) : file.length - 1, start + cap - 1);
    return new Response(file.slice(start, end + 1), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${file.length}` } });
  }));
  return calls;
}

const fileOf = (size: number) => Uint8Array.from({ length: size }, (_, index) => (index * 31 + 7) % 251);

afterEach(() => vi.unstubAllGlobals());

describe('fetchFile', () => {
  it('reads a file far bigger than 4 MB, every byte, in order', async () => {
    const file = fileOf(9 * 1024 * 1024 + 123);
    const calls = serve(file);
    const bytes = new Uint8Array(await (await fetchFile('D:/talk.mp4')).arrayBuffer());
    expect(bytes.length).toBe(file.length);
    expect(bytes.every((value, index) => value === file[index])).toBe(true);
    expect(calls.length).toBe(Math.ceil(file.length / (1000 * 1024)));
  });

  it('asks again when a server answers with less than it was asked for', async () => {
    const file = fileOf(2_500_000);
    serve(file, 300_000);
    const bytes = new Uint8Array(await (await fetchFile('D:/a.wav')).arrayBuffer());
    expect(bytes.every((value, index) => value === file[index]) && bytes.length === file.length).toBe(true);
  });

  it('a small file is one request; a server that ignores ranges is taken whole', async () => {
    const small = fileOf(5000);
    const calls = serve(small);
    expect(new Uint8Array(await (await fetchFile('D:/s.cube')).arrayBuffer())).toEqual(small);
    expect(calls).toHaveLength(1);
    const whole = fileOf(6 * 1024 * 1024);
    serve(whole, undefined, { ignoreRanges: true });
    expect((await (await fetchFile('D:/w.mp4')).arrayBuffer()).byteLength).toBe(whole.length);
  });

  it('refuses a file over the limit before reading it, and passes errors through', async () => {
    const calls = serve(fileOf(5 * 1024 * 1024));
    await expect(fetchFile('D:/big.mp4', { maxBytes: 2 * 1024 * 1024 })).rejects.toThrow(/5 MB; at most 2 MB/);
    expect(calls).toHaveLength(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect((await fetchFile('D:/gone.mp4')).status).toBe(404);
  });
});
