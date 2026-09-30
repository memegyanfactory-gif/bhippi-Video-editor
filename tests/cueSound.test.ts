import { describe, expect, it, vi } from 'vitest';
import { cueLevel, cuePlacements, loudestDb, motionCues, musicDbOver, placedSounds, SFX_LOUDEST_DB, UNDER_MUSIC_DB, type TimelineCue } from '../src/lib/cueSound';
import { explodeScene } from '../src/lib/motionStack';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import type { Peaks } from '../src/lib/peaks';
import { quietCues } from '../src/lib/reviewFrames';
import { SFX_GAIN_DB } from '../src/lib/sfxLevels';
import { newClip, newProject, tracksOf, updateComp } from '../src/lib/timeline';
import { SFX_KINDS, type Asset, type Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

/** A waveform at 100 buckets a second whose rms byte is `level(t)` (0..1 of full scale). */
function waveform(seconds: number, level: (t: number) => number): Peaks {
  const buckets = Math.round(seconds * 100);
  const data = new Uint8Array(buckets * 2);
  for (let i = 0; i < buckets; i++) {
    data[i * 2 + 1] = Math.round(level(i / 100) * 255);
    data[i * 2] = Math.min(255, data[i * 2 + 1] * 2);
  }
  return { data, buckets };
}

const db = (value: number) => 20 * Math.log10(value);
/** The song: quiet (−26 dB) for 4 s, then a chorus at −8 dB. */
const song = waveform(20, (t) => (t < 4 ? 10 ** (-26 / 20) : 10 ** (-8 / 20)));

vi.mock('../src/lib/peaks', async (original) => ({ ...(await original<typeof import('../src/lib/peaks')>()), loadPeaks: vi.fn(async () => song) }));

const scene = (duration: number, cues: MotionScene['cues'], layers: MotionScene['layers'] = []): MotionScene => ({ version: 1, width: 1920, height: 1080, duration, layers, ...(cues ? { cues } : {}) });

describe('the level arithmetic', () => {
  it('reads the loudest 10 ms of a stretch, in dBFS', () => {
    expect(loudestDb(song, 0, 1)).toBeCloseTo(-26, 0);
    expect(loudestDb(song, 3.5, 4.5)).toBeCloseTo(-8, 0);
    expect(loudestDb(waveform(1, () => 0), 0, 1)).toBeNull();
  });

  it('sets a cue 6 dB under the music peak at its moment, whatever the sound\'s own level', () => {
    for (const kind of ['click', 'whoosh', 'glass_tick', 'key_click'] as const) {
      const level = cueLevel(kind, -20);
      expect(level.against).toBe('music');
      expect(level.levelDb).toBeCloseTo(-20 - UNDER_MUSIC_DB, 1);
      expect(level.gainDb).toBeCloseTo(-26 - SFX_LOUDEST_DB[kind], 1);
      // The critique's buried cues were 20-30 dB under: these pass review_frames' check with room.
      expect(quietCues([{ at: 1, name: kind, db: level.levelDb }], () => -20)).toEqual([]);
    }
    // A typing bed sits lower and a sub higher; offsetDb moves every cue.
    expect(cueLevel('typing', -20).levelDb).toBeCloseTo(-29, 1);
    expect(cueLevel('sub', -20).levelDb).toBeCloseTo(-23, 1);
    expect(cueLevel('click', -20, 3).levelDb).toBeCloseTo(-23, 1);
  });

  it('never clips: a cue that wants more than its headroom is capped and says so', () => {
    const level = cueLevel('click', -3);
    expect(level.capped).toBe(true);
    expect(level.gainDb).toBeCloseTo(0.5, 1);
    // A sample's own peak sets its ceiling.
    expect(cueLevel('click', -3, 0, { loudestDb: -20, peakDb: -6 }).gainDb).toBeCloseTo(5, 1);
    expect(cueLevel('click', -20).capped).toBe(false);
  });

  it('keeps the seasoning level where no music plays, or the music is near silent', () => {
    expect(cueLevel('whoosh', null)).toMatchObject({ gainDb: SFX_GAIN_DB.whoosh, against: 'no-music' });
    expect(cueLevel('whoosh', -60).against).toBe('no-music');
  });

  it('reads the music through its clip: in point, speed, gain and volume keyframes', () => {
    const project = newProject();
    const comp = project.comps[0];
    const [a1] = tracksOf(comp, 'audio');
    // Source 3.5 s sits at timeline 2.5 s: the chorus arrives at timeline 3 s.
    const clip = { ...newClip({ trackId: a1.id, start: 1, in: 2, duration: 10, source: { type: 'media', assetId: 'song' } }), volume: 0.5 };
    const beds = [{ clip, peaks: song }];
    expect(musicDbOver(beds, 1.5, 1.8)).toBeCloseTo(-26 + db(0.5), 0);
    expect(musicDbOver(beds, 3.2, 3.5)).toBeCloseTo(-8 + db(0.5), 0);
    expect(musicDbOver(beds, 20, 21)).toBeNull();
    const ducked = { ...clip, keyframes: { ...clip.keyframes, volume: [{ time: 0, value: 0.25, easing: 'linear' as const }] } };
    expect(musicDbOver([{ clip: ducked, peaks: song }], 3.2, 3.5)).toBeCloseTo(-8 + db(0.25), 0);
  });
});

describe('where the cues are', () => {
  it('maps a loose scene\'s cues through its clip, typing beds included, and keeps to the range', () => {
    const project = newProject();
    const comp = project.comps[0];
    const [v1] = tracksOf(comp, 'video');
    const typed = { id: 't', type: 'text', text: { text: 'Make a launch film', type: { cps: 20, at: 0.5 } } } as never;
    const clip = newClip({ trackId: v1.id, start: 10, in: 1, duration: 3, source: { type: 'motion', scene: scene(4, [{ at: 0.5, sound: 'click' }, { at: 1.2, sound: 'whoosh' }, { at: 3.5, sound: 'pop' }], [typed]), title: 'Chat' } });
    comp.clips = [clip];
    const cues = motionCues(project, comp);
    // 0.5 s is before the in point; 1.2 → 10.2; the typing bed (0.5 s) too; 3.5 → 12.5.
    expect(cues.map((cue) => [cue.sound, cue.at])).toEqual([['whoosh', 10.2], ['pop', 12.5]]);
    const fromStart = { ...clip, in: 0 };
    comp.clips = [fromStart];
    const all = motionCues(project, comp);
    expect(all.map((cue) => cue.sound)).toEqual(['click', 'typing', 'whoosh']);
    expect(all.find((cue) => cue.sound === 'typing')!.duration).toBeCloseTo(0.9, 2);
    expect(motionCues(project, comp, 10.3, 11).map((cue) => cue.sound)).toEqual(['click', 'typing']);
    expect(motionCues(project, comp, 11, 12).map((cue) => cue.sound)).toEqual(['whoosh']);
  });

  it('reads a layered [Motion] comp once, through the nested clip that holds it, with its precomps', () => {
    const project = newProject();
    const comp = project.comps[0];
    const inner = scene(2, [{ at: 0.4, sound: 'glass' }]);
    const layers = [
      { id: 'bg', type: 'solid', color: '#111' },
      { id: 'card', type: 'solid', color: '#fff' },
      { id: 'pre', type: 'precomp', scene: inner, offset: 1 },
    ] as MotionScene['layers'];
    const exploded = explodeScene(scene(4, [{ at: 0.2, sound: 'whoosh' }, { at: 2, sound: 'click' }], layers), { name: '[Motion] Card', fps: 30 });
    const holder = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 5, duration: 4, source: { type: 'comp', compId: exploded.comp.id } });
    comp.clips = [holder];
    project.comps.push(exploded.comp, ...exploded.nested);
    const cues = motionCues(project, comp);
    // Three layer clips, but each cue once: whoosh 5.2, the precomp's glass at 5 + 1 + 0.4, click 7.
    expect(cues.map((cue) => [cue.sound, Math.round(cue.at * 100) / 100])).toEqual([['whoosh', 5.2], ['glass', 6.4], ['click', 7]]);
  });

  it('turns cues into clips: risers end on the hit, swaps and skips choose the film\'s sound', () => {
    const cues: TimelineCue[] = [
      { at: 1, sound: 'riser', from: 'Dive' },
      { at: 1.6, sound: 'impact', from: 'Dive' },
      { at: 2, sound: 'click', from: 'Chat' },
      { at: 2.5, sound: 'typing', duration: 5, from: 'Chat' },
      { at: 3, sound: 'whoosh', from: 'Chat' },
    ];
    const placed = cuePlacements(cues, { swap: { click: 'cursor_tap' }, skip: ['whoosh'] });
    expect(placed.map((p) => p.kind)).toEqual(['riser', 'impact', 'cursor_tap', 'typing']);
    const riser = placed[0];
    expect(riser.start).toBe(1);
    expect(riser.start + riser.duration).toBeCloseTo(1.6, 6);
    expect(riser.in + riser.duration).toBeCloseTo(2, 6); // the last 0.6 s of its build
    expect(riser.loud[1]).toBeCloseTo(1.6, 6);
    expect(placed[3].duration).toBe(2); // a typing bed is as long as the sound is
  });
});

describe('sound_the_motion', () => {
  function harness(project: Project) {
    let current = project;
    const assets = new Map<string, Asset>([['song', { id: 'song', name: 'Meet Bhippi.mp3', peaks: 'song-peaks.bin' } as Asset]]);
    const ctx = {
      get project() { return current; },
      assets,
      commit: (change: (p: Project) => Project) => { current = change(current); },
      editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
      pickComp: (p: Project) => p.comps[0],
      current: () => current,
    } as unknown as MotionToolContext;
    return { ctx, get: () => current };
  }

  function film(music = true) {
    const project = newProject();
    const comp = project.comps[0];
    const [v1] = tracksOf(comp, 'video');
    const [a1] = tracksOf(comp, 'audio');
    const motion = newClip({ trackId: v1.id, start: 2, duration: 4, source: { type: 'motion', scene: scene(4, [{ at: 0.5, sound: 'click' }, { at: 2.5, sound: 'whoosh', note: 'panel in' }]), title: 'Demo' } });
    const song1 = { ...newClip({ trackId: a1.id, start: 0, duration: 20, source: { type: 'media', assetId: 'song' } }), audioType: 'music' as const };
    comp.clips = music ? [motion, song1] : [motion];
    return project;
  }

  it('places each cue\'s sound on the SFX track, 6 dB under the song where it plays', async () => {
    const { ctx, get } = harness(film());
    const result = await runMotionTool('sound_the_motion', {}, ctx) as { ok: boolean; cues: { kind: string; at: number; gainDb: number; against: string }[]; summary: string };
    expect(result.ok).toBe(true);
    const comp = get().comps[0];
    const sounds = comp.clips.filter((clip) => clip.source.type === 'sfx');
    expect(sounds.map((clip) => [(clip.source as { kind: string }).kind, clip.start])).toEqual([['click', 2.5], ['whoosh', 4.5]]);
    expect(comp.tracks.find((track) => track.id === sounds[0].trackId)!.name).toBe('SFX');
    // The click lands in the quiet intro (−26 dB), the whoosh in the chorus (−8 dB).
    expect(db(sounds[0].volume) + SFX_LOUDEST_DB.click).toBeCloseTo(-32, 0);
    expect(db(sounds[1].volume) + SFX_LOUDEST_DB.whoosh).toBeCloseTo(-14, 0);
    expect(sounds[1].name).toContain('panel in');
    expect(result.summary).toContain('6 dB under');
  });

  it('re-levels the sounds already there instead of doubling them, so it can run again', async () => {
    const { ctx, get } = harness(film());
    await runMotionTool('sound_the_motion', {}, ctx);
    const first = get().comps[0].clips.filter((clip) => clip.source.type === 'sfx').map((clip) => clip.id);
    const again = await runMotionTool('sound_the_motion', { offsetDb: 2 }, ctx) as { ok: boolean; summary: string };
    expect(again.ok).toBe(true);
    const sounds = get().comps[0].clips.filter((clip) => clip.source.type === 'sfx');
    expect(sounds.map((clip) => clip.id)).toEqual(first);
    expect(db(sounds[0].volume) + SFX_LOUDEST_DB.click).toBeCloseTo(-30, 0);
    expect(placedSounds(get(), get().comps[0])).toHaveLength(2);
    expect(again.summary).toContain('0 placed');
  });

  it('without music, each cue keeps its default level and the reply says so', async () => {
    const { ctx, get } = harness(film(false));
    const result = await runMotionTool('sound_the_motion', {}, ctx) as { ok: boolean; summary: string };
    expect(result.ok).toBe(true);
    const click = get().comps[0].clips.find((clip) => clip.source.type === 'sfx')!;
    expect(db(click.volume)).toBeCloseTo(SFX_GAIN_DB.click, 0);
    expect(result.summary).toContain('no music');
  });

  it('fails plainly when nothing on the timeline carries cues', async () => {
    const { ctx } = harness(newProject());
    const result = await runMotionTool('sound_the_motion', {}, ctx) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('add_sound_effect');
  });
});

describe('the UI sound set', () => {
  it('is in the kind list with a level for every kind', () => {
    for (const kind of ['key_click', 'send_pop', 'soft_whoosh', 'glass_tick', 'cursor_tap'] as const) {
      expect(SFX_KINDS).toContain(kind);
      expect(SFX_GAIN_DB[kind]).toBeLessThan(-10);
    }
    for (const kind of SFX_KINDS) expect(SFX_LOUDEST_DB[kind], kind).toBeLessThan(0);
  });
});
