// The @funny tools wired end to end (docs/FUNNY-MODE-PLAN.md §3): the catalogue, the permission
// and council maps agree with the roast modules, and a roast built through runTool — beat sheet,
// a full plan in one step, Edit DNA, the council — lands on the timeline the way the brief says.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));

import catalogue from '../src/lib/ai-tools.json';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { allowTool } from '../src/lib/permissions';
import { councilReview, roleForTool } from '../src/lib/council';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import { ROAST_READ_TOOLS, ROAST_TOOLS, memeLookup, primeMemeCache } from '../src/lib/roast/tools';
import { ROAST_TOOL_NAMES, type RoastEvent } from '../src/lib/roast/types';
import type { Asset, Comp, Project } from '../src/lib/types';

const asset = (id: string, kind: Asset['kind'], seconds: number, over: Partial<Asset> = {}): Asset => ({
  id, name: `${id}.${kind === 'image' ? 'png' : 'mp4'}`, path: `C:/${id}`, kind, duration: seconds, width: 1920, height: 1080, fps: 30, hasAudio: kind !== 'image', videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '2026-01-01', thumbnail: null, filmstrip: null, waveform: null, proxy: null, preview: 'native', missing: false, peaks: null, ...over,
});

/** A 60 s host shot on V1 with the rest of a new project's tracks empty, behind a minimal tool host. */
function fixture() {
  let project: Project = newProject();
  const comp = project.comps[0];
  const host = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, in: 0, duration: 60, source: { type: 'media', assetId: 'host' } });
  project = { ...project, comps: [{ ...comp, clips: [host] }], activeCompId: comp.id };
  const assets = new Map<string, Asset>([asset('host', 'video', 60), asset('meme', 'video', 4), asset('person', 'image', 0, { width: 800, height: 1200 })].map((a) => [a.id, a]));
  const toolHost = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } },
    assets: () => assets, selection: () => [], setSelection: vi.fn(), importMedia: vi.fn(), ask: vi.fn(), speak: vi.fn(),
  } as unknown as ToolHost;
  return { toolHost, host, comp: () => project.comps[0] as Comp, project: () => project, assets };
}

beforeEach(() => invoke.mockReset());

describe('the @funny catalogue', () => {
  const names = new Set((catalogue as { tools: { name: string }[] }).tools.map((tool) => tool.name));

  it('lists exactly the contract tools, each routed to a roast module', () => {
    expect([...ROAST_TOOLS].sort()).toEqual([...ROAST_TOOL_NAMES].sort());
    for (const name of ROAST_TOOL_NAMES) expect(names.has(name), name).toBe(true);
  });

  it('lets the read-only tools run in Plan only and holds every edit back', () => {
    for (const name of ROAST_TOOL_NAMES) {
      expect(allowTool('plan', name).ok, name).toBe(ROAST_READ_TOOLS.has(name));
    }
  });

  it('gives every roast tool a council seat', () => {
    for (const name of ROAST_TOOL_NAMES) expect(roleForTool(name), name).not.toBeNull();
    expect(roleForTool('place_sfx')).toBe('audio');
    expect(roleForTool('cutout_image')).toBe('animator');
    expect(roleForTool('search_memes')).toBe('comedian');
  });
});

describe('a roast built through runTool', () => {
  it('saves a beat sheet, applies a whole plan in one step and measures it', async () => {
    const { toolHost, comp } = fixture();
    const beats = await runTool(toolHost, 'save_beat_sheet', { beats: [
      { id: 'b1', start: 0, end: 6, text: 'tum dono ka combo kachre ke dibbe mein zeher', kinds: ['setup', 'punchline'], intent: 'poison', echo: ['zeher'], punchAt: 5.8 },
      { id: 'b2', start: 6, end: 14, text: 'ek actual donkey', kinds: ['quote'], intent: 'exposed' },
    ] });
    expect(beats.ok).toBe(true);
    const events: Partial<RoastEvent>[] = [
      { move: 'meme_cutaway', assetId: 'meme', at: 5.9, duration: 2.2, why: 'zeher → a poisoned-kheer death scene echoes the word', memeId: 'in-sooryavansham-zeher-wali-kheer', beatId: 'b1' },
      { move: 'keyword_pop', text: 'ZEHER', style: 'memeImpact', at: 3, duration: 1.4, why: '' },
      { move: 'zoom_punch', scale: 125, at: 9, duration: 2, why: '' },
      { move: 'side_cutout', assetId: 'person', side: 'left', at: 12, duration: 3, why: 'the target appears beside the host as the quote lands' },
      { move: 'emoji_pop', emoji: '💀', at: 16, duration: 1.2, why: '' },
      { move: 'sfx', cue: { kind: 'boom' }, at: 20, duration: 1, why: '' },
    ];
    const applied = await runTool(toolHost, 'apply_roast_edl', { events });
    expect(applied.ok, JSON.stringify((applied as { error?: string }).error)).toBe(true);
    const roast = comp().roast;
    expect(roast?.edl?.events).toHaveLength(6);
    expect(roast?.applied?.length).toBe(6);
    const roastClips = comp().clips.filter((clip) => clip.name?.startsWith('roast:'));
    expect(roastClips.length).toBeGreaterThanOrEqual(6);

    const dna = await runTool(toolHost, 'edit_dna', {});
    expect(dna.ok).toBe(true);
    expect((dna as unknown as { dna: { memes: number } }).dna.memes).toBe(1);
  });

  it('puts the Comedian on the council for a roast, and it blocks a meme with no reason', async () => {
    const { toolHost, comp, project, assets } = fixture();
    await runTool(toolHost, 'apply_roast_edl', { events: [{ move: 'keyword_pop', text: 'BRO', style: 'roundedPop', at: 2, duration: 1, why: '' }] });
    const review = councilReview(project(), assets, comp());
    expect(review.seats).toContain('comedian');
    // A meme placed without a why is refused before it is applied, so the review never sees one.
    const refused = await runTool(toolHost, 'apply_roast_edl', { events: [{ move: 'meme_cutaway', assetId: 'meme', at: 4, duration: 2, why: '' }] });
    expect(refused.ok).toBe(false);
  });
});

describe('the Comedian’s meme lookup', () => {
  it('fetches the library facts for every meme a plan places', async () => {
    invoke.mockImplementation(async (command: string, args: { id: string }) => (command === 'memes_get' && args.id === 'm1'
      ? { id: 'm1', name: 'Husky dance', verified: true, firstSeen: '2025-10-01' }
      : null));
    const comp = { roast: { edl: { version: 1, compId: 'c', style: 'funny', events: [{ id: 'e1', move: 'meme_cutaway', assetId: 'a', memeId: 'm1', at: 1, duration: 2, why: 'x' }] } } } as unknown as Comp;
    await primeMemeCache(comp);
    expect(memeLookup('m1')).toEqual({ name: 'Husky dance', verified: true, firstSeen: '2025-10-01' });
    expect(memeLookup('unknown')).toBeUndefined();
  });
});
