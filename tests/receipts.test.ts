import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock('../src/lib/ipc', () => ({
  api: { jobsList: vi.fn(), jobCancel: vi.fn() },
  errorText: (e: unknown) => String(e),
}));

import { invoke } from '@tauri-apps/api/core';
import { api } from '../src/lib/ipc';
import { dnaFromReport, findReceipts, measureFileDna, measureFileReport, RECEIPT_TOOLS, receiptDownload, runReceiptTool, type FileDnaReport, type ReceiptSearch } from '../src/lib/roast/receipts';
import type { RoastToolContext } from '../src/lib/roast/types';
import specs from '../src/lib/roast/specs/receipts.json';
import aiTools from '../src/lib/ai-tools.json';

const ctx = {} as RoastToolContext;

const search: ReceiptSearch = {
  candidates: [
    { url: 'https://www.youtube.com/watch?v=7Dhp7JERS8w', title: 'Dhruv Rathee Exposes BJP IT Cell', channel: 'Learn By KK Create', start: 3739.86, end: 3742.46, text: 'मोदी से अच्छा एक गधा बेटर', score: 0.899 },
    { url: 'https://www.youtube.com/watch?v=7Dhp7JERS8w', title: 'Dhruv Rathee Exposes BJP IT Cell', channel: 'Learn By KK Create', start: 33.78, end: 36.46, text: 'मोदी से अच्छा एक गधा बेटर है।', score: 0.96 },
  ],
  searched: [
    { id: '7Dhp7JERS8w', url: 'https://www.youtube.com/watch?v=7Dhp7JERS8w', title: 'Dhruv Rathee Exposes BJP IT Cell', channel: 'Learn By KK Create', duration: 4761, captions: 'hi-orig', cached: false, best: 0.96, skipped: null },
    { id: 'zjxBXw2O5N8', url: 'https://www.youtube.com/watch?v=zjxBXw2O5N8', title: 'Sign language', channel: 'MBM News', duration: 2457, captions: null, cached: false, best: null, skipped: 'no captions in the wanted languages' },
  ],
  notes: ['YouTube rate-limited caption requests 2× (HTTP 429); they were retried with backoff.'],
  rateLimited: 2,
};

const report: FileDnaReport = {
  path: 'D:/vids/a.mp4',
  duration: 643.254,
  cuts: [0.52, 1.44, 3.42],
  cutsPerMinute: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  medianShot: 2.67,
  longestStatic: { start: 440.92, end: 643.254, seconds: 202.334 },
  greenShare: 0.7317,
  audio: { musicCoverage: 0.8357, sfxHits: [12.1], sfxPerMinute: [4, 1, 5, 1, 0, 1, 1, 4, 0, 0, 1], sfxRate: 1.679, onBeat: 0.2561, onBeatChance: 0.2279, cutsInMusic: 82, tempo: 105.47, beats: 1076, device: 'cuda' },
  notes: ['onBeat 0.26 vs 0.23 by chance (82 cuts inside music, tempo 105 BPM).'],
  timings: { video: 22, separate: 23, analyse: 3, total: 51 },
};

beforeEach(() => vi.clearAllMocks());

describe('find_receipt', () => {
  it('is catalogued with the arguments the handler reads', () => {
    expect(RECEIPT_TOOLS).toEqual(new Set(['find_receipt']));
    const spec = specs.find((entry) => entry.name === 'find_receipt');
    expect(spec?.input_schema.required).toEqual(['query', 'quote']);
    expect(Object.keys(spec?.input_schema.properties ?? {})).toEqual(['query', 'quote', 'maxResults', 'channel', 'lang']);
  });

  it('hands the search to receipts_find and hints the exact download_online_media call', async () => {
    vi.mocked(invoke).mockResolvedValue(search);
    const result = await runReceiptTool('find_receipt', { query: 'KK Create Dhruv Rathee podcast', quote: 'Modi se achcha ek gadha better hai', maxResults: 4.4, channel: 'KK Create' }, ctx);
    expect(invoke).toHaveBeenCalledWith('receipts_find', { query: 'KK Create Dhruv Rathee podcast', quote: 'Modi se achcha ek gadha better hai', maxResults: 4, channel: 'KK Create', lang: null });
    if (!result.ok) throw new Error(result.error);
    const candidates = result.candidates as (ReceiptSearch['candidates'][number] & { download: { url: string; startTime: string; endTime: string } })[];
    expect(candidates[0].download).toEqual({ url: 'https://www.youtube.com/watch?v=7Dhp7JERS8w', startTime: '3739.86', endTime: '3742.46' });
    expect(result.summary).toContain('download_online_media {"url":"https://www.youtube.com/watch?v=7Dhp7JERS8w","startTime":"3739.86","endTime":"3742.46"}');
    expect(result.summary).toContain('96 % "मोदी से अच्छा एक गधा बेटर है।"');
    expect(result.summary).toContain('0:33.8–0:36.5');
    expect(result.summary).toContain('Skipped: Sign language (no captions in the wanted languages)');
    expect(result.summary).toContain('rate-limited');
    expect(result.rateLimited).toBe(2);
  });

  it('uses the real argument names of download_online_media', () => {
    const download = aiTools.tools.find((tool) => tool.name === 'download_online_media');
    const properties = Object.keys(download?.input_schema.properties ?? {});
    const hint = receiptDownload(search.candidates[0]);
    for (const key of Object.keys(hint)) expect(properties).toContain(key);
  });

  it('says so when nothing matched, and checks its arguments', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...search, candidates: [], notes: ['No caption line matched the quote well enough (best 0.41; 0.50 needed).'], rateLimited: 0 });
    const none = await runReceiptTool('find_receipt', { query: 'q', quote: 'never said' }, ctx);
    if (!none.ok) throw new Error(none.error);
    expect(none.summary).toContain('No caption line matched "never said" in 1 video with captions');
    expect(none.summary).not.toContain('download_online_media');

    const missing = await runReceiptTool('find_receipt', { query: 'q' }, ctx);
    expect(missing.ok).toBe(false);
    vi.mocked(invoke).mockRejectedValue('yt-dlp is required to search YouTube');
    const broken = await runReceiptTool('find_receipt', { query: 'q', quote: 'x' }, ctx);
    expect(broken).toEqual({ ok: false, error: 'The receipt search failed: yt-dlp is required to search YouTube' });
    expect((await runReceiptTool('nope', {}, ctx)).ok).toBe(false);
  });

  it('findReceipts passes optional fields as null', async () => {
    vi.mocked(invoke).mockResolvedValue(search);
    await findReceipts({ query: 'q', quote: 'x', lang: 'hi' });
    expect(invoke).toHaveBeenCalledWith('receipts_find', { query: 'q', quote: 'x', maxResults: null, channel: null, lang: 'hi' });
  });
});

describe('measureFileDna', () => {
  it('maps the worker report onto EditDna', () => {
    const dna = dnaFromReport(report);
    expect(dna).toMatchObject({
      duration: 643.254, cuts: 3, medianShot: 2.67, greenShare: 0.7317, musicCoverage: 0.8357, onBeat: 0.2561,
      sfxPerMinute: [4, 1, 5, 1, 0, 1, 1, 4, 0, 0, 1], eventsPerMinute: [], memes: 0, textEvents: 0, audioMeasured: true,
      longestStatic: { start: 440.92, end: 643.254, seconds: 202.334 },
    });
    expect(dna.notes?.some((note) => note.includes('not measured from a file'))).toBe(true);
  });

  it('marks unmeasured audio instead of inventing numbers', () => {
    const dna = dnaFromReport({ ...report, audio: null, notes: ['Audio was not measured: Demucs is not installed'] });
    expect(dna.audioMeasured).toBe(false);
    expect(dna.onBeat).toBeNull();
    expect(dna.sfxPerMinute).toEqual([]);
    expect(dna.notes?.[0]).toContain('Demucs');
  });

  it('starts the edit_dna_file job and waits for its report', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue('job_1');
      vi.mocked(api.jobsList)
        .mockResolvedValueOnce([{ id: 'job_1', kind: 'media', label: 'Edit DNA', status: 'running', progress: 0.4, message: 'Finding cuts', result: null, cancellable: true }])
        .mockResolvedValueOnce([{ id: 'job_1', kind: 'media', label: 'Edit DNA', status: 'done', progress: 1, message: 'Edit DNA measured', result: { dna: report } as never, cancellable: true }]);
      const progress = vi.fn();
      const pending = measureFileDna('D:/vids/a.mp4', { onProgress: progress });
      await vi.advanceTimersByTimeAsync(600);
      const dna = await pending;
      expect(invoke).toHaveBeenCalledWith('edit_dna_file', { path: 'D:/vids/a.mp4', installAudio: false });
      expect(progress).toHaveBeenCalledWith(0.4, 'Finding cuts');
      expect(dna.cuts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a failed job', async () => {
    vi.mocked(invoke).mockResolvedValue('job_2');
    vi.mocked(api.jobsList).mockResolvedValue([{ id: 'job_2', kind: 'media', label: 'Edit DNA', status: 'error', progress: 0, message: 'FFmpeg could not decode the video', result: null, cancellable: true }]);
    await expect(measureFileReport('D:/broken.mp4', { installAudio: true })).rejects.toThrow('FFmpeg could not decode the video');
    expect(invoke).toHaveBeenCalledWith('edit_dna_file', { path: 'D:/broken.mp4', installAudio: true });
  });
});
