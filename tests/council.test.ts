import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({ api: { mediaDownload: vi.fn(), freeMediaSearch: vi.fn() }, errorText: (e: unknown) => String(e), fileSrc: (p: string) => p }));

import { api } from '../src/lib/ipc';
import { COUNCIL, SEAT_TOOLS, councilReview, describeReview, rightsOf, roleForTool, type CouncilRole } from '../src/lib/council';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { newClip, newProject, textSource, tracksOf, type AssetMap } from '../src/lib/timeline';
import { ROAST_TOOL_NAMES, type RoastEvent, type RoastState } from '../src/lib/roast/types';
import type { Asset, Clip, Comp, Project } from '../src/lib/types';

const asset = (id: string, name: string, over: Partial<Asset> = {}): Asset => ({
  id, name, path: `C:/media/${name}`, kind: 'video', duration: 120, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac',
  size: 1, importedAt: '', thumbnail: null, filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false, ...over,
});

/** A comp with a talking head on V1 for `seconds`, plus whatever clips `extra` adds. */
function setup(seconds: number, extra: (ids: { v1: string; v2: string; a1: string; a2: string }) => Clip[] = () => [], assets: Asset[] = []) {
  const project = newProject('council');
  const head = asset('head', 'talking head.mp4');
  const all = [head, ...assets];
  const map: AssetMap = new Map(all.map((a) => [a.id, a]));
  project.media = all.map((a) => ({ assetId: a.id, folderId: null, offline: false }));
  const comp = project.comps[0];
  const [v1, v2] = tracksOf(comp, 'video').map((t) => t.id);
  const [a1, a2] = tracksOf(comp, 'audio').map((t) => t.id);
  comp.clips = [newClip({ trackId: v1, start: 0, duration: seconds, source: { type: 'media', assetId: 'head' } }), ...extra({ v1, v2, a1, a2 })];
  return { project, assets: map, comp };
}

const notesOf = (review: ReturnType<typeof councilReview>, member: CouncilRole) => review.notes.filter((note) => note.member === member);
/** The comp made a planned production (the user asked for a produced video): taste rules hold it. */
const produced = <T extends { comp: { production?: unknown } }>(value: T): T => { value.comp.production = { phase: 'editing', mode: 'footage', gates: {} }; return value; };

describe('the council', () => {
  it('has five seats, each with a brief a worker can run under', () => {
    expect(COUNCIL.map((m) => m.id)).toEqual(['animator', 'researcher', 'audio', 'director', 'comedian']);
    for (const member of COUNCIL) expect(member.brief).toContain(`Council seat: THE ${member.name.toUpperCase()}`);
    expect(roleForTool('find_free_media')).toBe('researcher');
    expect(roleForTool('create_motion_scene')).toBe('animator');
    expect(roleForTool('score_audio_clip')).toBe('audio');
    expect(roleForTool('layout_clip')).toBe('director');
    expect(roleForTool('get_comp')).toBeNull();
    // The Comedian leads the @funny planning, meme and receipt tools.
    expect(roleForTool('apply_roast_edl')).toBe('comedian');
    expect(SEAT_TOOLS.comedian.size).toBeGreaterThan(0);
    for (const name of SEAT_TOOLS.comedian) expect(ROAST_TOOL_NAMES).toContain(name);
  });

  it('knows which downloads are licence-clear, watermarked or someone else\'s upload', () => {
    expect(rightsOf('https://www.pexels.com/video/123/').tier).toBe('free');
    expect(rightsOf('https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg').tier).toBe('free');
    expect(rightsOf('https://images-assets.nasa.gov/image/x~orig.jpg').tier).toBe('free');
    expect(rightsOf('https://www.shutterstock.com/video/clip-1').tier).toBe('watermarked');
    expect(rightsOf('https://media.gettyimages.com/id/1/photo.jpg').tier).toBe('watermarked');
    expect(rightsOf('https://www.youtube.com/watch?v=abc').tier).toBe('social');
    expect(rightsOf('https://example.com/cat.jpg').tier).toBe('unknown');
    // A look-alike host is not the library.
    expect(rightsOf('https://notpexels.com/x.jpg').tier).toBe('unknown');
  });
});

describe('the Animator', () => {
  it('advises on a plain edit, and holds a planned production, with no designed motion, frame by frame', () => {
    const plain = setup(12);
    const advice = notesOf(councilReview(plain.project, plain.assets, plain.comp, ['animator']), 'animator').find((note) => note.at?.[0] === 0);
    expect(advice?.severity).toBe('fix');
    const { project, assets, comp } = produced(setup(12));
    const review = councilReview(project, assets, comp, ['animator']);
    const dead = notesOf(review, 'animator').find((note) => note.at?.[0] === 0);
    expect(dead?.severity).toBe('block');
    expect(dead?.text).toContain('360 frames');
    expect(review.verdicts.animator).toBe('holds');
    expect(review.frames).toEqual([0, 360]);
  });

  it('signs off when a graphic lands at least every 3 s', () => {
    const { project, assets, comp } = setup(12, ({ v2 }) => [0, 3, 6, 9].map((start) => newClip({ trackId: v2, start, duration: 2.8, source: textSource('title', { text: `Beat ${start}`, style: 'rb-split' }) })));
    const review = councilReview(project, assets, comp, ['animator']);
    expect(notesOf(review, 'animator').filter((n) => n.severity !== 'note')).toEqual([]);
    expect(review.motionDensity).toBeGreaterThan(0.9);
  });

  it('calls out a title that just sits there and motion that moves linearly', () => {
    const { project, assets, comp } = setup(4, ({ v2, v1 }) => [
      newClip({ trackId: v2, start: 0, duration: 4, source: textSource('title', { text: 'Static' }) }),
      newClip({ trackId: v1, start: 4, duration: 2, source: { type: 'media', assetId: 'head' }, keyframes: { x: [], y: [], rotation: [], opacity: [], volume: [], scale: [{ time: 0, value: 100, easing: 'linear' }, { time: 2, value: 110, easing: 'linear' }] } }),
    ]);
    const texts = notesOf(councilReview(project, assets, comp, ['animator']), 'animator').map((n) => n.text);
    expect(texts.some((t) => t.includes('"Static"') && t.includes('sits still'))).toBe(true);
    expect(texts.some((t) => t.includes('moves linearly'))).toBe(true);
  });
});

describe('the Director', () => {
  it('sees a jump cut, a locked-off shot and an almost-centred title', () => {
    const { project, assets, comp } = setup(5, ({ v1, v2 }) => [
      newClip({ trackId: v1, start: 5, duration: 9, in: 5, source: { type: 'media', assetId: 'head' } }),
      newClip({ trackId: v2, start: 1, duration: 2, source: textSource('title', { text: 'Nearly', style: 'rb-split' }), transform: { fit: 'fit', x: 0.015, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 } }),
    ]);
    const texts = notesOf(councilReview(project, assets, comp, ['director']), 'director').map((n) => n.text);
    expect(texts.some((t) => t.startsWith('Jump cut at 5.0 s'))).toBe(true);
    expect(texts.some((t) => t.includes('locked-off 9.0 s shot'))).toBe(true);
    expect(texts.some((t) => t.includes('29 px off centre'))).toBe(true);
  });

  it('is happy when the second side of a cut is punched in', () => {
    const punched = { fit: 'fit' as const, x: 0, y: 0, scale: 114, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 };
    const { project, assets, comp } = setup(5, ({ v1 }) => [newClip({ trackId: v1, start: 5, duration: 5, in: 5, source: { type: 'media', assetId: 'head' }, transform: punched })]);
    expect(notesOf(councilReview(project, assets, comp, ['director']), 'director').some((n) => n.text.startsWith('Jump cut'))).toBe(false);
  });
});

describe('the Audio Guru', () => {
  it('holds a long produced cut with no music (a plain edit may be dry), and flags a bed at full level with no ducking', () => {
    const dry = setup(20);
    expect(notesOf(councilReview(dry.project, dry.assets, dry.comp, ['audio']), 'audio')[0].severity).toBe('fix');
    const bare = produced(setup(20));
    expect(notesOf(councilReview(bare.project, bare.assets, bare.comp, ['audio']), 'audio')[0].severity).toBe('block');
    const bed = asset('bed', 'music bed.mp3', { kind: 'audio', width: 0, height: 0 });
    const loud = setup(20, ({ a1, a2 }) => [
      newClip({ trackId: a1, start: 0, duration: 20, source: { type: 'media', assetId: 'head' } }),
      newClip({ trackId: a2, start: 0, duration: 20, source: { type: 'media', assetId: 'bed' } }),
    ], [bed]);
    const notes = notesOf(councilReview(loud.project, loud.assets, loud.comp, ['audio']), 'audio');
    expect(notes.some((n) => n.severity === 'block')).toBe(false);
    expect(notes.some((n) => n.text.includes('full level under the voice'))).toBe(true);
    expect(notes.some((n) => n.text.includes('starts and stops hard'))).toBe(true);
  });

  it('hears graphic entrances that land in silence', () => {
    const { project, assets, comp } = setup(10, ({ v2 }) => [2, 6].map((start) => newClip({ trackId: v2, start, duration: 2, source: textSource('title', { style: 'rb-split' }) })));
    comp.production = null;
    const notes = notesOf(councilReview(project, assets, comp, ['audio']), 'audio');
    expect(notes.some((n) => n.text.includes('2 of 2 graphic entrances land in silence'))).toBe(true);
  });
});

describe('the Researcher', () => {
  it('holds a watermarked file on the timeline and asks for credits', () => {
    const stock = asset('stock', 'city-skyline.mp4');
    const cc = asset('cc', 'river.jpg', { kind: 'image' });
    const { project, assets, comp } = setup(4, ({ v1 }) => [newClip({ trackId: v1, start: 4, duration: 3, source: { type: 'media', assetId: 'stock' } })], [stock, cc]);
    project.provenance = {
      stock: { url: 'https://www.shutterstock.com/video/1', host: 'shutterstock.com', tier: 'watermarked', license: null, at: 0 },
      cc: { url: 'https://live.staticflickr.com/r.jpg', host: 'live.staticflickr.com', tier: 'free', license: 'CC BY 2.0', credit: '"River" by Ana, CC BY 2.0', attributionRequired: true, at: 0 },
    };
    const notes = notesOf(councilReview(project, assets, comp, ['researcher']), 'researcher');
    expect(notes[0]).toMatchObject({ severity: 'block' });
    expect(notes[0].text).toContain('watermarked');
    expect(notes.some((n) => n.severity === 'note' && n.text.includes('"River" by Ana'))).toBe(true);
  });
});

describe('the Comedian', () => {
  /** A @funny plan: one punchline landing at 5.0 s (setup 2–4.2 s). */
  function roast(comp: Comp, events: RoastEvent[], extra: Partial<RoastState> = {}) {
    comp.roast = {
      beatSheet: { version: 1, compId: comp.id, beats: [
        { id: 'b0', start: 2, end: 4.2, text: 'usne kachre ke dibbe mein', kinds: ['setup'] },
        { id: 'b1', start: 4.2, end: 5, text: 'zeher daal diya', kinds: ['punchline'], intent: 'poison', echo: ['zeher', 'ज़हर'], punchAt: 5 },
      ] },
      edl: { version: 1, compId: comp.id, style: 'funny', events },
      ...extra,
    };
  }
  const meme = (id: string, at: number, memeId: string, why: string, beatId?: string): RoastEvent => ({ id, move: 'meme_cutaway', assetId: `asset-${memeId}`, memeId, at, duration: 1.5, why, ...(beatId ? { beatId } : {}) });
  const library: Record<string, { name: string; verified: boolean; firstSeen?: string }> = {
    death: { name: 'Amitabh death scene', verified: true, firstSeen: '2019-01-01' },
    husky: { name: 'Dancing husky', verified: true, firstSeen: '2026-09-01' },
    rumour: { name: 'Some new trend', verified: false },
  };

  it('sits only on a comp with a @funny plan', () => {
    const { project, assets, comp } = setup(20);
    const review = councilReview(project, assets, comp);
    expect(review.seats).not.toContain('comedian');
    expect(notesOf(review, 'comedian')).toEqual([]);
    expect(describeReview(review)).not.toContain('Comedian');
    expect(describeReview(councilReview(project, assets, comp, ['comedian']), ['comedian'])).toContain('Comedian sits out');
    roast(comp, []);
    expect(councilReview(project, assets, comp).seats).toContain('comedian');
  });

  it('holds a meme with no why and an unverified meme, and fixes an early landing and a repeat', () => {
    const { project, assets, comp } = setup(20);
    roast(comp, [
      meme('e1', 4.6, 'death', 'He says zeher; the death scene says it back.', 'b1'),
      meme('e2', 12, 'death', ''),
      meme('e3', 16, 'rumour', 'Everyone is posting it.'),
    ]);
    const review = councilReview(project, assets, comp, ['comedian'], { meme: (id) => library[id] });
    const notes = notesOf(review, 'comedian');
    const find = (text: string) => notes.find((note) => note.text.includes(text));
    expect(find('e2 at 12.0 s has no why')?.severity).toBe('block');
    expect(find('"Some new trend" at 16.0 s is unverified')?.severity).toBe('block');
    expect(find('e1 lands at 4.60 s, 0.40 s before the punchline ends (5.00 s)')).toMatchObject({ severity: 'fix', at: [4.6, 5] });
    expect(find('"Amitabh death scene" is used 2 times')?.severity).toBe('fix');
    expect(review.verdicts.comedian).toBe('holds');
    expect(describeReview(review, ['comedian'])).toContain('Comedian HOLDS THE CUT');
    // Without the library the verified check is skipped, not failed.
    expect(notesOf(councilReview(project, assets, comp, ['comedian']), 'comedian').some((note) => note.text.includes('unverified'))).toBe(false);
  });

  it('blocks an Indian meme in a video for a global audience, unless it crossed over', () => {
    const { project, assets, comp } = setup(20);
    roast(comp, [meme('e1', 5.1, 'death', 'He says poison; the death scene says it back.', 'b1'), meme('e2', 12, 'wow', 'The ad is over the top; "just looking like a wow".')], { audience: { audience: 'global', confidence: 0.9, signals: [], source: 'detected' } });
    const facts: Record<string, { name: string; verified: boolean; region: 'IN' | 'global'; crossover?: boolean }> = {
      death: { name: 'Amitabh death scene', verified: true, region: 'IN' },
      wow: { name: 'Just looking like a wow', verified: true, region: 'IN', crossover: true },
    };
    const notes = notesOf(councilReview(project, assets, comp, ['comedian'], { meme: (id) => facts[id] }), 'comedian');
    expect(notes.find((note) => note.text.includes('"Amitabh death scene" at 5.1 s is an Indian meme'))?.severity).toBe('block');
    expect(notes.some((note) => note.text.includes('Just looking like a wow') && note.text.includes('Indian meme'))).toBe(false);
    // The same plan for an Indian audience is fine.
    comp.roast!.audience = { audience: 'IN', confidence: 1, signals: [], source: 'user' };
    expect(notesOf(councilReview(project, assets, comp, ['comedian'], { meme: (id) => facts[id] }), 'comedian').some((note) => note.text.includes('is an Indian meme'))).toBe(false);
  });

  it('asks for restraint: memes on most lines, memes back to back, a meme on the setup, zooms every second', () => {
    const { project, assets, comp } = setup(60);
    const beats = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, start: i * 6, end: i * 6 + 5, text: `line ${i}`, kinds: ['punchline' as const], punchAt: i * 6 + 5 }));
    comp.roast = {
      beatSheet: { version: 1, compId: comp.id, beats: [{ id: 's', start: 50, end: 55, text: 'so here is the thing about my landlord', kinds: ['setup'] }, ...beats] },
      edl: { version: 1, compId: comp.id, style: 'funny', events: [
        ...beats.slice(0, 6).map((beat, i) => meme(`m${i}`, beat.punchAt, `meme${i}`, 'the joke', beat.id)),
        meme('late', 52, 'setupmeme', 'the joke'),
        meme('crowd', 36.8, 'crowdmeme', 'the joke'),
        { id: 'z1', move: 'zoom_punch', at: 10, duration: 0.3, why: '' },
        { id: 'z2', move: 'zoom_punch', at: 12, duration: 0.3, why: '' },
      ] },
    };
    const notes = notesOf(councilReview(project, assets, comp, ['comedian']), 'comedian');
    expect(notes.find((note) => note.text.includes('memes for 9 lines'))?.severity).toBe('fix');
    expect(notes.some((note) => note.text.includes('Two memes 0.3 s apart'))).toBe(true);
    expect(notes.find((note) => note.text.includes('lands in the middle of a setup'))?.severity).toBe('fix');
    expect(notes.some((note) => note.text.includes('Zooms at 10.0 s and 12.0 s'))).toBe(true);
    expect(notes.some((note) => note.text.includes('Two memes') && note.text.includes('apart'))).toBe(true);
  });

  it('finds a meme\'s punchline by time when it has no beat id, and lets one on the word pass', () => {
    const { project, assets, comp } = setup(20);
    roast(comp, [meme('e1', 5.1, 'husky', 'German shepherd → the dancing husky.'), meme('e2', 4.5, 'death', 'zeher → the death scene.')]);
    const notes = notesOf(councilReview(project, assets, comp, ['comedian'], { meme: (id) => library[id] }), 'comedian');
    expect(notes.some((note) => note.text.includes('e1 lands'))).toBe(false);
    expect(notes.some((note) => note.text.includes('e2 lands at 4.50 s'))).toBe(true);
  });

  it('reviews only the applied events whose clips are still on the timeline', () => {
    const { project, assets, comp } = setup(20);
    const kept = comp.clips[0].id;
    roast(comp, [meme('e1', 4.6, 'death', 'zeher → death scene.', 'b1'), meme('e2', 12, 'husky', '')], { applied: [{ eventId: 'e1', clipIds: [kept] }, { eventId: 'e2', clipIds: ['deleted-by-the-user'] }] });
    const notes = notesOf(councilReview(project, assets, comp, ['comedian']), 'comedian');
    expect(notes.some((note) => note.text.includes('e1 lands'))).toBe(true);
    expect(notes.some((note) => note.text.includes('no why'))).toBe(false);
  });

  it('holds a host-only dead zone and reads the rest of the Edit DNA against the band', () => {
    const { project, assets, comp } = setup(20);
    roast(comp, []);
    const notes = notesOf(councilReview(project, assets, comp, ['comedian']), 'comedian');
    const dead = notes.find((note) => note.text.includes('of host with no cut'));
    expect(dead).toMatchObject({ severity: 'block', at: [0, 20] });
    expect(notes.filter((note) => note.text.includes('Dead zone')).length).toBe(0);
  });

  it('hears the same sound more than 3 times, and a bed that runs through the punchline', () => {
    const { project, assets, comp } = setup(20, ({ a2 }) => [
      ...[1, 6, 9, 13].map((start) => newClip({ trackId: a2, start, duration: 0.9, source: { type: 'sfx', kind: 'whoosh' } })),
      newClip({ trackId: a2, start: 14, duration: 1, source: { type: 'sfx', kind: 'pop' } }),
    ]);
    const bed = asset('bed', 'lofi bed.mp3', { kind: 'audio', width: 0, height: 0 });
    project.media.push({ assetId: 'bed', folderId: null, offline: false });
    assets.set('bed', bed);
    const [, , a3] = tracksOf(comp, 'audio').map((t) => t.id);
    const music = newClip({ trackId: a3 ?? tracksOf(comp, 'audio')[0].id, start: 0, duration: 20, source: { type: 'media', assetId: 'bed' }, audioType: 'music', volume: 0.1 });
    comp.clips.push(music);
    roast(comp, []);
    const texts = () => notesOf(councilReview(project, assets, comp, ['comedian']), 'comedian').map((note) => note.text);
    expect(texts().some((t) => t.startsWith('The whoosh sound plays 4 times'))).toBe(true);
    expect(texts().some((t) => t.includes('pop sound'))).toBe(false);
    expect(texts().some((t) => t.startsWith('The music runs through the punchline at 5.0 s'))).toBe(true);
    // Dropped out 0.5 s before the word and back after it: the joke has its space.
    music.keyframes = { ...music.keyframes, volume: [{ time: 0, value: 0.1, easing: 'linear' }, { time: 4.4, value: 0.1, easing: 'linear' }, { time: 4.5, value: 0.01, easing: 'linear' }, { time: 5.3, value: 0.01, easing: 'linear' }, { time: 5.5, value: 0.1, easing: 'linear' }] };
    expect(texts().some((t) => t.includes('runs through the punchline'))).toBe(false);
  });
});

describe('the Researcher on a roast', () => {
  function receiptComp() {
    const clip = asset('rcpt', 'podcast clip.mp4');
    const { project, assets, comp } = setup(10, ({ v2 }) => [newClip({ trackId: v2, start: 10, duration: 4, source: { type: 'media', assetId: 'rcpt' } })], [clip]);
    project.provenance = { rcpt: { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com', tier: 'social', license: null, at: 0 } };
    return { project, assets, comp };
  }
  const receipt: RoastEvent = { id: 'e3', move: 'receipt', assetId: 'rcpt', at: 10, duration: 4, why: 'He says it himself.', provenance: [{ url: 'https://www.youtube.com/watch?v=abc', title: 'The podcast', provider: 'youtube' }] };

  it('accepts a sourced receipt as commentary and lists it for the description', () => {
    const { project, assets, comp } = receiptComp();
    comp.roast = { edl: { version: 1, compId: comp.id, style: 'funny', events: [receipt] } };
    const notes = notesOf(councilReview(project, assets, comp, ['researcher']), 'researcher');
    expect(notes.some((n) => n.text.includes('youtube.com upload'))).toBe(false);
    expect(notes.find((n) => n.text.includes('used as commentary'))).toMatchObject({ severity: 'note' });
    expect(notes.find((n) => n.text.includes('used as commentary'))?.text).toContain('The podcast');
  });

  it('still flags the same clip outside a roast, a receipt with no source, and any watermark', () => {
    const plain = receiptComp();
    expect(notesOf(councilReview(plain.project, plain.assets, plain.comp, ['researcher']), 'researcher').some((n) => n.severity === 'fix' && n.text.includes('youtube.com upload'))).toBe(true);
    const unsourced = receiptComp();
    unsourced.comp.roast = { edl: { version: 1, compId: unsourced.comp.id, style: 'funny', events: [{ ...receipt, provenance: undefined }] } };
    const notes = notesOf(councilReview(unsourced.project, unsourced.assets, unsourced.comp, ['researcher']), 'researcher');
    expect(notes.some((n) => n.text.includes('receipt e3 at 10.0 s has no source'))).toBe(true);
    expect(notes.some((n) => n.text.includes('youtube.com upload'))).toBe(true);
    const stock = receiptComp();
    stock.project.provenance = { rcpt: { url: 'https://www.shutterstock.com/video/1', host: 'shutterstock.com', tier: 'watermarked', license: null, at: 0 } };
    stock.comp.roast = { edl: { version: 1, compId: stock.comp.id, style: 'funny', events: [receipt] } };
    expect(notesOf(councilReview(stock.project, stock.assets, stock.comp, ['researcher']), 'researcher')[0]).toMatchObject({ severity: 'block' });
  });
});

describe('council tools', () => {
  function host(project: Project, assets: AssetMap) {
    let current = project;
    return {
      history: { current: () => current, commit: (change: (p: Project) => Project) => { current = change(current); } },
      assets: () => assets, selection: () => [], setSelection: vi.fn(), importMedia: vi.fn(), ask: vi.fn(), speak: vi.fn(),
      get project() { return current; },
    } as unknown as ToolHost & { project: Project };
  }

  it('consult_council reports each seat in its own words', async () => {
    const { project, assets } = produced(setup(12));
    const result = await runTool(host(project, assets), 'consult_council', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('The council holds the cut');
    expect(result.summary).toContain('Animator HOLDS THE CUT');
    expect((result.verdicts as Record<string, string>).animator).toBe('holds');
  });

  it('download_online_media refuses a stock preview and records where a file came from', async () => {
    const { project, assets } = setup(2);
    const h = host(project, assets);
    const refused = await runTool(h, 'download_online_media', { url: 'https://www.istockphoto.com/video/x' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('Researcher');
    vi.mocked(api.mediaDownload).mockResolvedValue({ path: 'C:/dl/wave.mp4', title: 'wave', mediaType: 'video', sourceUrl: '', bytes: 1 } as never);
    vi.mocked(h.importMedia).mockResolvedValue([asset('wave', 'wave.mp4')]);
    const ok = await runTool(h, 'download_online_media', { url: 'https://videos.pexels.com/video-files/1/wave.mp4' });
    expect(ok.ok).toBe(true);
    expect(h.project.provenance?.wave).toMatchObject({ tier: 'free', host: 'videos.pexels.com' });
  });

  it('find_free_media searches with licences and downloads the picks with their credit', async () => {
    const { project, assets } = setup(2);
    const h = host(project, assets);
    vi.mocked(api.freeMediaSearch).mockResolvedValue([
      { title: 'Moon', url: 'https://images-assets.nasa.gov/m~orig.jpg', page: 'https://images.nasa.gov/details/m', thumbnail: null, kind: 'image', provider: 'NASA', license: 'Public domain (NASA)', licenseUrl: null, creator: null, attributionRequired: false, attribution: 'Moon — NASA', width: 4000, height: 3000, duration: null },
      { title: 'Crater', url: 'https://live.staticflickr.com/c.jpg', page: 'https://flickr.com/c', thumbnail: null, kind: 'image', provider: 'Openverse', license: 'CC BY 2.0', licenseUrl: null, creator: 'Bo', attributionRequired: true, attribution: '"Crater" by Bo', width: 2000, height: 1500, duration: null },
    ]);
    const listed = await runTool(h, 'find_free_media', { query: 'moon', kind: 'image' });
    expect(listed.ok && (listed.results as unknown[]).length).toBe(2);
    vi.mocked(api.mediaDownload).mockResolvedValue({ path: 'C:/dl/c.jpg', title: 'c', mediaType: 'image', sourceUrl: '', bytes: 1 } as never);
    vi.mocked(h.importMedia).mockResolvedValue([asset('crater', 'c.jpg', { kind: 'image' })]);
    const got = await runTool(h, 'find_free_media', { query: 'moon', download: true, pick: [1] });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.summary).toContain('Credit required: "Crater" by Bo');
    expect(h.project.provenance?.crater).toMatchObject({ tier: 'free', license: 'CC BY 2.0', attributionRequired: true, provider: 'Openverse' });
    expect(h.project.folders.some((f) => f.name === 'Research: moon')).toBe(true);
  });
});
