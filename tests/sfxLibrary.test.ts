import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/lib/ipc', () => ({ api: {}, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { invoke } from '@tauri-apps/api/core';
import { dbToGain, SFX_LENGTH } from '../src/lib/editor';
import { SFX_GAIN_DB } from '../src/lib/sfxLevels';
import { kindOfId, resolveSfxCues, runSfxTool, sfxClip, SFX_KINDS, SFX_TOOLS } from '../src/lib/roast/sfx';
import { ROAST_SFX_KINDS, type RoastEvent, type RoastToolContext, type SfxEntry } from '../src/lib/roast/types';
import { newClip, newProject, tracksOf, updateComp } from '../src/lib/timeline';
import type { Asset, Comp, Project } from '../src/lib/types';
import specs from '../src/lib/roast/specs/sfx.json';

const invokeMock = vi.mocked(invoke);

const entry = (fields: Partial<SfxEntry> & Pick<SfxEntry, 'id' | 'name'>): SfxEntry => ({ tags: [], aliases: [], kind: 'sample', ...fields });
const builtin = (kind: string, name: string): SfxEntry => entry({ id: `sfx-proc-${kind}`, name, kind: 'procedural', proceduralKind: kind, provider: 'builtin', duration: 1 });
const asset = (id: string, path: string, duration = 0.8): Asset => ({ id, name: path.split(/[\\/]/).pop() ?? id, path, kind: 'audio', duration } as Asset);

function fixture(assets: Asset[] = []) {
  let project: Project = newProject();
  const commits: number[] = [];
  const importFiles = vi.fn(async (paths: string[]) => paths.map((path, index) => asset(`imported-${index}`, path)));
  const ctx: RoastToolContext = {
    get project() { return project; },
    assets: new Map(assets.map((a) => [a.id, a])),
    commit: (change) => { commits.push(1); project = change(project); },
    editComp: (comp, change) => { commits.push(1); project = updateComp(project, comp.id, change); },
    pickComp: (p) => p.comps[0],
    current: () => project,
    importFiles,
  };
  return { ctx, importFiles, commits, comp: () => project.comps[0] };
}

// A block body: a function returned from beforeEach would run as a cleanup hook.
beforeEach(() => {
  invokeMock.mockReset();
});

describe('the SFX kinds', () => {
  it('include the six @funny kinds with lengths and levels', () => {
    expect(SFX_KINDS).toHaveLength(11);
    for (const kind of ROAST_SFX_KINDS) {
      expect(SFX_KINDS).toContain(kind);
      expect(SFX_LENGTH[kind]).toBeGreaterThan(0);
      expect(SFX_GAIN_DB[kind]).toBeLessThanOrEqual(-14);
    }
    expect(SFX_LENGTH).toMatchObject({ boom: 1.2, scratch: 0.5, bleep: 0.8, swish: 0.35, ding: 1.5, glitch: 0.4 });
    expect(kindOfId('sfx-proc-boom')).toBe('boom');
    expect(kindOfId('sfx-proc-kazoo')).toBeNull();
    expect(kindOfId('fs-1')).toBeNull();
  });

  it('match the tool catalogue', () => {
    expect(new Set(specs.map((spec) => spec.name))).toEqual(SFX_TOOLS);
    const place = specs.find((spec) => spec.name === 'place_sfx')!;
    expect((place.input_schema.properties as unknown as Record<string, { enum?: string[] }>).kind.enum).toEqual(SFX_KINDS);
  });
});

describe('sfxClip (pure)', () => {
  it('places a procedural kind on an SFX track at its level', () => {
    const comp = newProject().comps[0];
    const { comp: next, clipId } = sfxClip(comp, { kind: 'boom', offset: 0.1 }, 1);
    const clip = next.clips.find((c) => c.id === clipId)!;
    expect(clip.source).toEqual({ type: 'sfx', kind: 'boom' });
    expect(clip.start).toBeCloseTo(1.1, 9);
    expect(clip.duration).toBe(1.2);
    expect(clip.volume).toBeCloseTo(dbToGain(-14), 9);
    expect(clip.audioType).toBe('sfx');
    expect(next.tracks.find((t) => t.id === clip.trackId)?.name).toBe('SFX');
    expect(comp.clips).toHaveLength(0);
    // A library id for a built-in works the same; db overrides the level.
    const byId = sfxClip(comp, { id: 'sfx-proc-ding', db: -6 }, 0);
    const ding = byId.comp.clips.find((c) => c.id === byId.clipId)!;
    expect(ding.source).toEqual({ type: 'sfx', kind: 'ding' });
    expect(ding.volume).toBeCloseTo(dbToGain(-6), 9);
  });

  it('places a sample as a media clip, louder when it is a meme sound', () => {
    const comp = newProject().comps[0];
    const bruh = asset('a1', 'C:/SFX/cache/fs-1.wav', 0.72);
    const plain = sfxClip(comp, { id: 'fs-1', assetId: 'a1' }, 2, bruh);
    const clip = plain.comp.clips.find((c) => c.id === plain.clipId)!;
    expect(clip.source).toEqual({ type: 'media', assetId: 'a1' });
    expect(clip.duration).toBe(0.72);
    expect(clip.volume).toBeCloseTo(dbToGain(-14), 9);
    expect(clip.name).toBe('SFX · Fs-1');
    const meme = sfxClip(comp, { id: 'fs-1', assetId: 'a1' }, 2, bruh, { tags: ['meme'], note: 'punchline' });
    const loud = meme.comp.clips.find((c) => c.id === meme.clipId)!;
    expect(loud.volume).toBeCloseTo(dbToGain(-10), 9);
    expect(loud.name).toBe('SFX · Fs-1 — punchline');
  });

  it('cuts a sound short with a fade, and never stacks two sounds on one track', () => {
    const comp = newProject().comps[0];
    const bleep = sfxClip(comp, { kind: 'bleep' }, 3, undefined, { duration: 0.3 });
    const clip = bleep.comp.clips.find((c) => c.id === bleep.clipId)!;
    expect(clip.duration).toBeCloseTo(0.3, 9);
    const keys = clip.keyframes.volume;
    expect(keys[keys.length - 1]).toMatchObject({ time: 0.3, value: 0 });
    expect(keys[keys.length - 2].time).toBeCloseTo(0.295, 9);
    const second = sfxClip(bleep.comp, { kind: 'swish' }, 3.1);
    const swish = second.comp.clips.find((c) => c.id === second.clipId)!;
    expect(swish.trackId).not.toBe(clip.trackId);
    expect(second.comp.clips.find((c) => c.id === bleep.clipId)).toEqual(clip);
  });

  it('refuses a cue that names nothing playable', () => {
    const comp = newProject().comps[0];
    expect(() => sfxClip(comp, { id: 'fs-9' }, 0)).toThrow(/fetch and import/);
    expect(() => sfxClip(comp, { assetId: 'nope' }, 0)).toThrow(/not given/);
    expect(() => sfxClip(comp, {}, 0)).toThrow(/needs a kind/);
  });
});

describe('search_sfx and place_sfx', () => {
  it('search_sfx asks the library and lists hits with ids, licences and notes', async () => {
    const { ctx } = fixture();
    invokeMock.mockResolvedValueOnce({
      hits: [
        { entry: builtin('boom', 'Vine boom'), score: 127, reasons: ['is "vine boom"'] },
        { entry: entry({ id: 'mi-vine-boom', name: 'VINE BOOM SOUND', provider: 'myinstants', license: 'unknown', tags: ['copyrighted-source'] }), score: 90, reasons: [] },
      ],
      notes: ['Freesound skipped: no API key'],
    });
    const result = await runSfxTool('search_sfx', { query: 'vine boom', online: true, limit: 5 }, ctx);
    expect(invokeMock).toHaveBeenCalledWith('sfx_library_search', { query: 'vine boom', tags: [], online: true, limit: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect((result.hits as { id: string }[]).map((hit) => hit.id)).toEqual(['sfx-proc-boom', 'mi-vine-boom']);
    expect(result.summary).toContain('sfx-proc-boom');
    expect(result.summary).toContain('copyrighted');
    expect(result.summary).toContain('Freesound skipped');
    expect((await runSfxTool('search_sfx', {}, ctx)).ok).toBe(false);
  });

  it('place_sfx places a built-in kind in one commit without touching Rust', async () => {
    const { ctx, commits, comp } = fixture();
    const result = await runSfxTool('place_sfx', { kind: 'scratch', at: 4, note: 'freeze' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(commits).toHaveLength(1);
    const clip = comp().clips.find((c) => c.id === result.clipId)!;
    expect(clip).toMatchObject({ start: 4, duration: 0.5, source: { type: 'sfx', kind: 'scratch' }, audioType: 'sfx', name: 'SFX · Scratch — freeze' });
    expect(result.db).toBe(-20);
  });

  it('place_sfx fetches a library sample, imports it into the SFX bin once, and places it', async () => {
    const path = 'C:\\Users\\me\\Documents\\Helios\\SFX\\cache\\fs-534387.wav';
    const fetched = entry({ id: 'fs-534387', name: 'Bruh Sound Effect #1', provider: 'freesound', license: 'CC0', credit: '"Bruh" by someone (freesound.org, CC0)', tags: ['meme'], localPath: path, duration: 0.7 });
    invokeMock.mockImplementation(async (command) => (command === 'sfx_library_fetch' ? fetched : { hits: [], notes: [] }));
    const { ctx, importFiles, comp, commits } = fixture();
    const result = await runSfxTool('place_sfx', { id: 'fs-534387', at: 1.5 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(invokeMock).toHaveBeenCalledWith('sfx_library_fetch', { id: 'fs-534387', entry: null });
    expect(importFiles).toHaveBeenCalledWith([path], 'SFX');
    expect(commits).toHaveLength(1);
    const clip = comp().clips.find((c) => c.id === result.clipId)!;
    expect(clip.source).toEqual({ type: 'media', assetId: 'imported-0' });
    expect(clip.volume).toBeCloseTo(dbToGain(-10), 9);
    expect(result.credit).toContain('freesound');
    expect(result.license).toBe('CC0');

    // Already in the project (same file, other slashes): no second import.
    const again = fixture([asset('existing', path.replace(/\\/g, '/'), 0.7)]);
    const second = await runSfxTool('place_sfx', { id: 'fs-534387', at: 3 }, again.ctx);
    expect(second.ok).toBe(true);
    expect(again.importFiles).not.toHaveBeenCalled();
    if (second.ok) expect(second.assetId).toBe('existing');
  });

  it('place_sfx by query takes a strong local hit and goes online only when nothing local fits', async () => {
    invokeMock.mockResolvedValueOnce({ hits: [{ entry: builtin('boom', 'Vine boom'), score: 127, reasons: [] }], notes: [] });
    const local = fixture();
    const result = await runSfxTool('place_sfx', { query: 'धमाका', at: 2 }, local.ctx);
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('sfx_library_search', { query: 'धमाका', tags: [], online: false, limit: 5 });
    if (result.ok) expect(local.comp().clips.find((c) => c.id === result.clipId)?.source).toEqual({ type: 'sfx', kind: 'boom' });

    invokeMock.mockReset();
    const cc0 = entry({ id: 'ov-1', name: 'Sad trombone', provider: 'openverse', license: 'CC0', url: 'https://x/t.mp3' });
    const upload = entry({ id: 'mi-sad', name: 'sad trombone', provider: 'myinstants', license: 'unknown', url: 'https://x/m.mp3' });
    invokeMock
      .mockResolvedValueOnce({ hits: [], notes: [] })
      .mockResolvedValueOnce({ hits: [{ entry: upload, score: 150, reasons: [] }, { entry: cc0, score: 120, reasons: [] }], notes: [] })
      .mockResolvedValueOnce({ ...cc0, localPath: 'C:/SFX/cache/ov-1.wav', duration: 1.1 });
    const online = fixture();
    const placed = await runSfxTool('place_sfx', { query: 'sad trombone', at: 5 }, online.ctx);
    expect(placed.ok).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sfx_library_search', { query: 'sad trombone', tags: [], online: true, limit: 10 });
    // The Myinstants upload scored higher but is skipped; the CC0 one is fetched (its entry handed back).
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'sfx_library_fetch', { id: 'ov-1', entry: cc0 });
  });

  it('place_sfx explains what is missing', async () => {
    const { ctx } = fixture();
    const noTime = await runSfxTool('place_sfx', { kind: 'boom' }, ctx);
    expect(noTime.ok).toBe(false);
    const badKind = await runSfxTool('place_sfx', { kind: 'kazoo', at: 1 }, ctx);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error).toContain('glitch');
    const nothing = await runSfxTool('place_sfx', { at: 1 }, ctx);
    expect(nothing.ok).toBe(false);
    invokeMock.mockRejectedValueOnce('no sound fs-0 in the library; search_sfx first');
    const missing = await runSfxTool('place_sfx', { id: 'fs-0', at: 1 }, ctx);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('search_sfx first');
  });
});

describe('placing sounds keeps other clips alone', () => {
  it('does not move dialogue', () => {
    const base = newProject().comps[0];
    const a1 = tracksOf(base, 'audio')[0];
    const voice = newClip({ trackId: a1.id, start: 0, duration: 10, source: { type: 'item', itemId: 'x' } });
    const comp: Comp = { ...base, clips: [voice] };
    const { comp: next, clipId } = sfxClip(comp, { kind: 'ding' }, 2);
    expect(next.clips.find((c) => c.id === voice.id)).toEqual(voice);
    expect(next.clips.find((c) => c.id === clipId)?.trackId).not.toBe(a1.id);
  });
});

describe('resolveSfxCues (before the move executor)', () => {
  const event = (id: string, extra: Partial<RoastEvent>): RoastEvent => ({ id, at: 1, duration: 1, why: 'test', move: 'emoji_pop', emoji: '😂', ...extra } as RoastEvent);

  it('fetches and imports each library sample once, maps built-in ids to kinds, and leaves the rest', async () => {
    const path = 'C:/Users/me/Documents/Helios/SFX/cache/sfx-vine-boom.wav';
    invokeMock.mockImplementation(async (command, args) => {
      if (command !== 'sfx_library_fetch') throw new Error(`unexpected ${command}`);
      const id = (args as { id: string }).id;
      if (id === 'fs-missing') throw 'no sound fs-missing in the library; search_sfx first';
      return entry({ id, name: 'Vine boom (CC0)', localPath: path, provider: 'freesound', license: 'CC0' });
    });
    const { ctx, importFiles } = fixture();
    const events: RoastEvent[] = [
      event('e1', { sfx: { id: 'sfx-vine-boom', offset: 0.05 } }),
      event('e2', { move: 'sfx', cue: { id: 'sfx-vine-boom', db: -12 } } as Partial<RoastEvent>),
      event('e3', { sfx: { id: 'sfx-proc-scratch' } }),
      event('e4', { sfx: { kind: 'pop' } }),
      event('e5', { sfx: null }),
      event('e6', { sfx: { id: 'fs-missing' } }),
      event('e7', { sfx: { id: 'sfx-vine-boom', assetId: 'already' } }),
    ];
    const result = await resolveSfxCues(events, ctx);
    // One fetch for the two vine-boom cues, one for the missing one; one import.
    expect(invokeMock.mock.calls.filter(([command]) => command === 'sfx_library_fetch').map(([, args]) => (args as { id: string }).id).sort()).toEqual(['fs-missing', 'sfx-vine-boom']);
    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(importFiles).toHaveBeenCalledWith([path], 'SFX');
    const [e1, e2, e3, e4, e5, e6, e7] = result.events;
    expect(e1.sfx).toEqual({ id: 'sfx-vine-boom', offset: 0.05, assetId: 'imported-0' });
    expect(e2.move === 'sfx' && e2.cue).toEqual({ id: 'sfx-vine-boom', db: -12, assetId: 'imported-0' });
    expect(e3.sfx).toEqual({ id: 'sfx-proc-scratch', kind: 'scratch' });
    expect(e4).toBe(events[3]);
    expect(e5.sfx).toBeNull();
    expect(e6.sfx).toEqual({ id: 'fs-missing' });
    expect(e7.sfx).toEqual({ id: 'sfx-vine-boom', assetId: 'already' });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/^e6: .*fs-missing/);
    expect(result.assets.map((a) => a.id)).toEqual(['imported-0']);
    // The resolved cues place with the pure executor helper.
    const placed = sfxClip(newProject().comps[0], e1.sfx!, 1, result.assets[0]);
    expect(placed.comp.clips.find((c) => c.id === placed.clipId)?.source).toEqual({ type: 'media', assetId: 'imported-0' });
  });

  it('reuses an asset already in the project for the same file', async () => {
    const path = 'C:\\SFX\\Cache\\Bruh.wav';
    invokeMock.mockResolvedValue(entry({ id: 'bruh', name: 'Bruh', localPath: path }));
    const { ctx, importFiles } = fixture([asset('bruh-asset', 'c:/sfx/cache/bruh.wav', 0.6)]);
    const result = await resolveSfxCues([event('e1', { sfx: { id: 'bruh' } })], ctx);
    expect(importFiles).not.toHaveBeenCalled();
    expect(result.events[0].sfx).toEqual({ id: 'bruh', assetId: 'bruh-asset' });
    expect(result.problems).toEqual([]);
  });
});
