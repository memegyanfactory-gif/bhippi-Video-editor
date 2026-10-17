import { describe, expect, it } from 'vitest';
import type { QueueRow } from '../src/lib/modelLibrary';
import type { Job } from '../src/lib/types';
import { activeCount, failureText, finishedAgo, formatSpeed, formatTimeLeft, groupQueue, otherDownloads, pausedLine, progressLine, sizePair, variantLine } from '../src/settings/library/downloadsModel';

const row = (patch: Partial<QueueRow>): QueueRow => ({
  id: 'm', name: 'Model', variant: 'q4', variantLabel: 'Q4', addons: [], state: 'queued', bytesDone: 0, bytesTotal: 5e9, speed: 0, etaSeconds: null,
  error: null, thumbnailPath: null, position: null, jobId: null, finishedAt: null, ...patch,
});

const job = (patch: Partial<Job>): Job => ({ id: 'j', kind: 'model', label: 'Downloading Kokoro voices', status: 'running', progress: 0.2, message: '', result: null, cancellable: true, ...patch }) as Job;

describe('downloads page helpers', () => {
  it('puts every download in its own section, waiting ones in line order', () => {
    const groups = groupQueue([
      row({ id: 'c', state: 'queued', position: 2 }), row({ id: 'a', state: 'running' }), row({ id: 'b', state: 'queued', position: 1 }),
      row({ id: 'v', state: 'verifying' }), row({ id: 'p', state: 'paused' }), row({ id: 'f', state: 'failed' }),
      row({ id: 'old', state: 'done', finishedAt: 10 }), row({ id: 'new', state: 'done', finishedAt: 20 }),
    ]);
    expect(groups.downloading.map((r) => r.id)).toEqual(['a', 'v']);
    expect(groups.queued.map((r) => r.id)).toEqual(['b', 'c']);
    expect(groups.paused.map((r) => r.id)).toEqual(['p']);
    expect(groups.failed.map((r) => r.id)).toEqual(['f']);
    expect(groups.finished.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('formats sizes in the unit of the total', () => {
    expect(sizePair(1.2e9, 5e9)).toBe('1.2 of 5.0 GB');
    expect(sizePair(300e6, 800e6)).toBe('300 of 800 MB');
    expect(sizePair(6e9, 5e9)).toBe('5.0 of 5.0 GB');
    expect(variantLine(row({}))).toBe('Q4 · 5.0 GB');
  });

  it('says speed and time left in plain words', () => {
    expect(formatSpeed(38e6)).toBe('38 MB/s');
    expect(formatSpeed(0)).toBe('');
    expect(formatTimeLeft(30)).toBe('under a minute left');
    expect(formatTimeLeft(125)).toBe('2 min left');
    expect(formatTimeLeft(3900)).toBe('1 h 5 min left');
    expect(formatTimeLeft(null)).toBe('');
    expect(progressLine(row({ state: 'running', bytesDone: 1.2e9, speed: 38e6, etaSeconds: 100 }))).toBe('1.2 of 5.0 GB · 38 MB/s · 2 min left');
    expect(progressLine(row({ state: 'running' }))).toBe('Starting…');
    expect(progressLine(row({ state: 'verifying', bytesDone: 5e9 }))).toMatch(/Checking/);
  });

  it('tells where a paused download stopped', () => {
    expect(pausedLine(row({ bytesDone: 1.2e9 }))).toBe('Paused at 1.2 of 5.0 GB');
    expect(pausedLine(row({ bytesDone: 0 }))).toBe('Paused, nothing fetched yet');
  });

  it('gives a failure a reason in plain words', () => {
    expect(failureText(null)).toMatch(/Retry continues/);
    expect(failureText('The server said no')).toBe('The server said no.');
    expect(failureText('Not enough space on D:')).toMatch(/Free some space/);
  });

  it('lists the other installers, not the queue\'s own jobs or tuning jobs', () => {
    const rows = [row({ state: 'running', jobId: 'own' })];
    const shown = otherDownloads([job({ id: 'own', label: 'Downloading Model (Q4)' }), job({ id: 'voices' }), job({ id: 'tune', label: 'Tuning Model' }), job({ id: 'done', status: 'done' })], rows);
    expect(shown.map((j) => j.id)).toEqual(['voices']);
    expect(activeCount([row({ state: 'running' }), row({ state: 'queued' }), row({ state: 'paused' }), row({ state: 'failed' })], shown)).toBe(3);
  });

  it('says how long ago a download finished', () => {
    const now = 1_000_000_000_000;
    expect(finishedAgo(now / 1000 - 5, now)).toBe('Finished just now');
    expect(finishedAgo(now / 1000 - 300, now)).toBe('Finished 5 min ago');
    expect(finishedAgo(now / 1000 - 7200, now)).toBe('Finished 2 h ago');
    expect(finishedAgo(null, now)).toBe('Finished');
  });
});
