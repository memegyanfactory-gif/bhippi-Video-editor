import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a), convertFileSrc: (p: string) => p }));

import { hintFor, loadLearnedLessons, normalizeError, resetLessonCache, withHint, HINT_MAX } from '../src/lib/toolLessons';

beforeEach(() => { invoke.mockReset(); resetLessonCache(); });

describe('static hints', () => {
  it('names what works for the mined top failures', () => {
    expect(hintFor('list_directory', 'Supply a directory path.', [])).toMatch(/^Hint: pass path/);
    expect(hintFor('brain_remember', 'keep one entry under 600 characters; split it or make it denser', [])).toMatch(/several brain_remember/);
    expect(hintFor('edit_file', 'Supply a file path.', [])).toMatch(/oldString/);
    expect(hintFor('update_track', 'no track with that name', [])).toMatch(/get_comp/);
    expect(hintFor('inspect_clip_frames', 'Supply a video clipId.', [])).toMatch(/clipId/);
  });

  it('adds nothing for an unknown failure, and never doubles a hint', () => {
    expect(hintFor('list_directory', 'disk exploded', [])).toBeNull();
    expect(withHint('read_file', 'weird', [])).toBe('weird');
    const once = withHint('read_file', 'Supply a file path.', []);
    expect(once).toMatch(/\nHint: /);
    expect(withHint('read_file', once, [])).toBe(once);
  });

  it('keeps every hint one short line', () => {
    const long = [{ tool: 'x', error: 'bad thing 3', fix: 'a '.repeat(300), count: 1 }];
    const hint = hintFor('x', 'bad thing 9', long)!;
    expect(hint.length).toBeLessThanOrEqual(HINT_MAX + 6);
    expect(hint).not.toMatch(/\n/);
  });
});

describe('learned lessons', () => {
  const lessons = [
    { tool: 'place_clip', error: 'no media with that id: m_8f3a1c2d', fix: 'use ids from get_comp', count: 2 },
    { tool: 'place_clip', error: 'no media with that id: m_8f3a1c2d', fix: 'use the assetId from the bin', count: 9 },
  ];

  it('matches by tool and normalised error, preferring the most seen', () => {
    expect(normalizeError('Scene 3: audio needs 40 chars (12 chars)')).toBe(normalizeError('Scene 7: audio needs 90 chars (1 chars)'));
    expect(hintFor('place_clip', 'no media with that id: m_11aa22bb', lessons)).toBe('Hint: use the assetId from the bin');
    expect(hintFor('trim_clip', 'no media with that id', lessons)).toBeNull();
  });

  it('loads through the brain command, caches it, and falls back silently', async () => {
    invoke.mockResolvedValue({ lessons });
    expect(await loadLearnedLessons(1000)).toHaveLength(2);
    await loadLearnedLessons(2000);
    expect(invoke).toHaveBeenCalledTimes(1);
    await loadLearnedLessons(1000 + 6 * 60_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    resetLessonCache();
    invoke.mockRejectedValue(new Error('unknown command'));
    expect(await loadLearnedLessons()).toEqual([]);
  });
});
