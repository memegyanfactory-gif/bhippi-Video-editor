import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));

import { MEME_TOOLS, TREND_INSTRUCTION, memeEntryFrom, memeIdFrom, memeProblems, runMemeTool, stringList } from '../src/lib/roast/memes';
import { COMIC_INTENTS, ROAST_TOOL_NAMES, type MemeEntry, type RoastToolContext } from '../src/lib/roast/types';
import { newProject } from '../src/lib/timeline';
import type { Asset, Project } from '../src/lib/types';
import specs from '../src/lib/roast/specs/memes.json';

function fixture() {
  let project = newProject();
  const asset = { id: 'asset_meme', name: 'clip-0.mp4', path: 'C:/Memes/media/oggy/clip-0.mp4', kind: 'video', duration: 3.5 } as Asset;
  const importFiles = vi.fn(async () => [asset]);
  const ctx: RoastToolContext = {
    project,
    assets: new Map(),
    commit: (change) => { project = change(project); },
    editComp: vi.fn(),
    pickComp: vi.fn(),
    current: () => project,
    importFiles,
  };
  return { ctx, importFiles, project: () => project as Project };
}

const entry = (over: Partial<MemeEntry> = {}): MemeEntry => ({
  id: 'oggy-jack-juice',
  name: 'Oggy Jack juice',
  aliases: ['mera juice kahan gaya'],
  origin: { kind: 'cartoon', title: 'Oggy and the Cockroaches' },
  meaning: 'Jack drinks the juice and asks where it went; used for obvious denial.',
  useWhen: ['someone asks where something went that they took'],
  dontUseWhen: [],
  emotion: ['clueless'],
  intent: ['clueless', 'denial'],
  formats: [{ type: 'clip', query: 'ytsearch3:oggy jack juice meme', hasAudio: true }],
  region: 'IN',
  trendScore: 0.6,
  sources: [{ url: 'https://knowyourmeme.com/memes/x' }],
  safety: {},
  verified: true,
  ...over,
});

beforeEach(() => invoke.mockReset());

describe('meme tool arguments', () => {
  it('search_memes sends the request the Rust side expects', async () => {
    const { ctx } = fixture();
    invoke.mockResolvedValue([{ entry: entry(), score: 12.5, reasons: ['echo "juice": said in the clip'] }]);
    const result = await runMemeTool('search_memes', { query: 'juice', echo: 'juice, mera juice', intent: 'clueless', limit: 99, format: 'clip' }, ctx);
    expect(invoke).toHaveBeenCalledWith('memes_search', {
      request: { query: 'juice', echo: ['juice', 'mera juice'], intent: 'clueless', format: 'clip', limit: 30, includeUnverified: false },
    });
    if (!result.ok) throw new Error(result.error);
    const hits = result.hits as { id: string; reasons: string[]; formats: { index: number; cached: boolean }[] }[];
    expect(hits[0].id).toBe('oggy-jack-juice');
    expect(hits[0].formats).toEqual([{ index: 0, type: 'clip', hasAudio: true, cached: false }]);
    expect(result.summary).toContain('dontUseWhen');
  });

  it('search_memes refuses an unknown intent, format or region without asking Rust', async () => {
    const { ctx } = fixture();
    expect((await runMemeTool('search_memes', { intent: 'laugh' }, ctx)).ok).toBe(false);
    expect((await runMemeTool('search_memes', { format: 'video' }, ctx)).ok).toBe(false);
    expect((await runMemeTool('search_memes', { region: 'US' }, ctx)).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refresh_meme_trends passes force and queries, filters, and says to save before use', async () => {
    const { ctx } = fixture();
    invoke.mockResolvedValue({
      fetchedAt: '2026-09-24T10:00:00Z', cached: false, counts: { kym: 1, klipy: 1 }, problems: ['reddit r/memes: HTTP 403 (json), HTTP 429 (rss)'], libraryHits: ['moye-moye'],
      candidates: [
        { name: 'Abuse Goblin', provider: 'kym', url: 'https://knowyourmeme.com/memes/abuse-goblin', explainer: 'A webcomic goblin.', score: 0.95333 },
        { name: 'They love me', provider: 'klipy clips', url: 'https://klipy.com/clips/they-love-me' },
      ],
    });
    const result = await runMemeTool('refresh_meme_trends', { force: true, queries: ['Dhurandhar meme'], provider: 'kym' }, ctx);
    expect(invoke).toHaveBeenCalledWith('memes_refresh', { force: true, queries: ['Dhurandhar meme'] });
    if (!result.ok) throw new Error(result.error);
    expect(result.candidates).toEqual([{ name: 'Abuse Goblin', provider: 'kym', url: 'https://knowyourmeme.com/memes/abuse-goblin', explainer: 'A webcomic goblin.', score: 0.95 }]);
    expect(result.total).toBe(2);
    expect(String(result.instruction)).toContain(TREND_INSTRUCTION);
    expect(String(result.instruction)).toContain('Powered by KLIPY');
    expect(result.summary).toContain('HTTP 403');
  });

  it('save_meme fills the contract defaults and validates before saving', async () => {
    const { ctx } = fixture();
    const bad = await runMemeTool('save_meme', { name: 'Tiny', meaning: 'short', useWhen: [], sources: [], intent: ['laugh'] }, ctx);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected a failure');
    for (const part of ['30 characters', 'useWhen', 'sources', 'laugh']) expect(bad.error).toContain(part);
    expect(invoke).not.toHaveBeenCalled();

    invoke.mockImplementation(async (command: string, args?: { entry?: MemeEntry }) => (command === 'memes_save' ? args?.entry : undefined));
    const good = await runMemeTool('save_meme', {
      name: 'Mera juice kahan gaya!',
      meaning: 'Jack drinks the juice and asks where it went; used for obvious denial.',
      useWhen: 'denial, taking something',
      sources: ['https://knowyourmeme.com/memes/x'],
      intent: ['denial'],
      region: 'in',
      formats: [{ type: 'clip', query: 'ytsearch3:oggy jack juice', in: 1, out: 4, transcript: 'mera juice kahan gaya' }],
    }, ctx);
    if (!good.ok) throw new Error(good.error);
    const saved = (invoke.mock.calls[0][1] as { entry: MemeEntry }).entry;
    expect(invoke.mock.calls[0][0]).toBe('memes_save');
    expect(saved).toMatchObject({
      id: 'mera-juice-kahan-gaya', region: 'IN', useWhen: ['denial', 'taking something'], dontUseWhen: [], aliases: [],
      origin: { kind: 'other', title: 'Mera juice kahan gaya!' }, trendScore: 0.5, verified: true, safety: {},
      formats: [{ type: 'clip', query: 'ytsearch3:oggy jack juice', in: 1, out: 4, transcript: 'mera juice kahan gaya' }],
    });
    expect(saved.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(good.memeId).toBe('mera-juice-kahan-gaya');
  });

  it('get_meme_media fetches, imports into Memes and records commentary provenance', async () => {
    const { ctx, importFiles, project } = fixture();
    invoke.mockResolvedValue({
      path: 'C:/Memes/media/oggy/clip-0.mp4', memeId: 'oggy-jack-juice', format: 0, kind: 'video', in: 0, out: 3.5, sourceIn: 1, sourceOut: 4.5,
      hasAudio: true, duration: 3.5, cached: false,
      provenance: { url: 'https://www.youtube.com/watch?v=abc', title: 'Oggy juice', provider: 'commentary', license: 'commentary', credit: 'Some channel', memeId: 'oggy-jack-juice' },
    });
    const result = await runMemeTool('get_meme_media', { memeId: 'oggy-jack-juice', in: 1, out: 4.5, formatType: 'clip' }, ctx);
    expect(invoke).toHaveBeenCalledWith('memes_fetch_media', { request: { id: 'oggy-jack-juice', formatType: 'clip', in: 1, out: 4.5, force: false } });
    expect(importFiles).toHaveBeenCalledWith(['C:/Memes/media/oggy/clip-0.mp4'], 'Memes');
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ assetId: 'asset_meme', memeId: 'oggy-jack-juice', in: 0, out: 3.5, hasAudio: true, sourceIn: 1, sourceOut: 4.5 });
    const record = project().provenance?.asset_meme;
    expect(record).toMatchObject({ url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com', tier: 'social', license: 'commentary', provider: 'commentary', credit: 'Some channel' });
  });

  it('get_meme_media checks its arguments first', async () => {
    const { ctx } = fixture();
    expect((await runMemeTool('get_meme_media', {}, ctx)).ok).toBe(false);
    expect((await runMemeTool('get_meme_media', { memeId: 'x', in: 4, out: 2 }, ctx)).ok).toBe(false);
    invoke.mockImplementation(async (command: string) => {
      if (command === 'memes_fetch_media') throw 'no meme "x" in the library';
    });
    const missing = await runMemeTool('get_meme_media', { memeId: 'x' }, ctx);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('expected a failure');
    expect(missing.error).toContain('no meme');
  });
});

describe('meme helpers', () => {
  it('derives ids, lists and problems', () => {
    expect(memeIdFrom('Déjà vu — Moye Moye!!')).toBe('deja-vu-moye-moye');
    expect(memeIdFrom('मोये मोये')).toBe('');
    expect(stringList(' a, b ,a\nc ')).toEqual(['a', 'b', 'c']);
    expect(stringList(['x', 3, ' y '])).toEqual(['x', 'y']);
    expect(memeProblems(entry())).toEqual([]);
    expect(memeProblems(entry({ id: 'Bad Id', formats: [{ type: 'clip' }] })).join(' ')).toMatch(/kebab-case.*url or a yt-dlp query/);
    expect(memeEntryFrom({ entry: { name: 'X', verified: false } }).lastVerified).toBeUndefined();
  });
});

describe('meme contract stays in step', () => {
  it('the tool specs name exactly the meme tools, and their intents are COMIC_INTENTS', () => {
    const names = specs.map((spec) => spec.name).sort();
    expect(names).toEqual([...MEME_TOOLS].sort());
    for (const name of names) expect(ROAST_TOOL_NAMES).toContain(name);
    const search = specs.find((spec) => spec.name === 'search_memes');
    const save = specs.find((spec) => spec.name === 'save_meme');
    expect((search?.input_schema.properties as unknown as Record<string, { enum?: string[] }>).intent.enum).toEqual([...COMIC_INTENTS]);
    expect((save?.input_schema.properties as unknown as Record<string, { items?: { enum?: string[] } }>).intent.items?.enum).toEqual([...COMIC_INTENTS]);
  });

  it('memes.rs keeps the same COMIC_INTENTS list', () => {
    const rust = readFileSync(new URL('../src-tauri/src/memes.rs', import.meta.url), 'utf8');
    const block = rust.match(/pub const COMIC_INTENTS: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? '';
    expect([...block.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([...COMIC_INTENTS]);
  });
});
