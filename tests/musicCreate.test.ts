import { describe, expect, it } from 'vitest';
import { newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Transcript } from '../src/lib/ipc';
import type { Asset, Comp, Project } from '../src/lib/types';
import { newSong } from '../src/music/model';
import { aceCaption, aceLyrics, normalizeKey, prosePrompt, songBrief, tagLyrics } from '../src/music/create/brief';
import { limitPeaks, peaksOf } from '../src/music/create/master';
import { createSong, pickEngine, STUDIO_ENGINE, type CreateDeps, type EngineInfo } from '../src/music/create/run';
import { placeTake, takeInStudio } from '../src/music/create/tool';
import { bpmForDelivery, moodOfText, voiceBrief } from '../src/music/create/voice';
import type { SongTake } from '../src/music/types';

const asset = (id: string, duration: number): Asset => ({
  id, name: id, path: `C:/${id}.wav`, kind: 'audio', duration, width: 0, height: 0, fps: null, hasAudio: true, videoCodec: null, audioCodec: 'pcm', size: 1, importedAt: '', thumbnail: null,
  filmstrip: null, waveform: null, peaks: null, proxy: null, preview: 'native', missing: false,
});

/** A comp with a 20 s narration on A1 starting at 1 s, and its transcript: words every 0.4 s with a 2 s pause at 9 s. */
function narrated(): { comp: Comp; assets: Map<string, Asset>; transcripts: Map<string, Transcript> } {
  const base = newComp({ name: 'Edit' });
  const a1 = tracksOf(base, 'audio')[0];
  const clip = newClip({ trackId: a1.id, start: 1, duration: 20, source: { type: 'media', assetId: 'vo' }, audioType: 'dialogue' });
  const comp: Comp = { ...base, clips: [clip] };
  const text = 'our team built a future where every dream and every goal is possible we believe in growth and change';
  const words = text.split(' ').flatMap((word, i) => {
    const start = i < 12 ? i * 0.4 : 8 + 2 + (i - 12) * 0.4;
    return [{ text: word, start, end: start + 0.3 }];
  });
  return { comp, assets: new Map([['vo', asset('vo', 20)]]), transcripts: new Map([['vo', { assetId: 'vo', provider: 'test', language: 'en', words, text }]]) };
}

describe('reading the voice-over', () => {
  it('finds the talking, the pauses, the pace, the language and the mood', () => {
    const { comp, assets, transcripts } = narrated();
    const voice = voiceBrief(comp, assets, () => null, transcripts)!;
    expect(voice).not.toBeNull();
    expect(voice.start).toBeCloseTo(1, 3);
    expect(voice.end).toBeCloseTo(1 + 10 + 6 * 0.4 + 0.3, 3);
    expect(voice.pauses).toHaveLength(1);
    expect(voice.pauses[0].start).toBeCloseTo(1 + 11 * 0.4 + 0.3, 3);
    expect(voice.language).toBe('en');
    expect(voice.mood).toBe('inspiring');
    expect(voice.wpm).toBeGreaterThan(150);
    expect(voice.excerpt.startsWith('our team')).toBe(true);
  });

  it('reads the levels when there is no transcript, and nothing when no clip speaks', () => {
    const { comp, assets } = narrated();
    // Loud for the first 5 s of the source, then silent.
    const data = new Uint8Array(2000 * 2);
    for (let b = 0; b < 500; b++) { data[b * 2] = 200; data[b * 2 + 1] = 120; }
    const voice = voiceBrief(comp, assets, () => ({ data, buckets: 2000 }), new Map())!;
    expect(voice.speech).toHaveLength(1);
    expect(voice.end).toBeCloseTo(6, 1);
    expect(voice.wpm).toBeNull();
    const music: Comp = { ...comp, clips: comp.clips.map((c) => ({ ...c, audioType: 'music' as const })) };
    expect(voiceBrief(music, assets, () => null, new Map())).toBeNull();
  });

  it('a faster read wants a faster pulse, inside the mood', () => {
    expect(bpmForDelivery('corporate', 190)).toBeGreaterThan(bpmForDelivery('corporate', 120));
    expect(bpmForDelivery('calm', 400)).toBeLessThanOrEqual(76 + 14);
    expect(moodOfText('the murder in the dark prison').mood).toBe('dark');
  });
});

describe('the brief', () => {
  it('a score under a voice-over is instrumental, timed to the voice, with a lift after it ends', () => {
    const { comp, assets, transcripts } = narrated();
    const voice = voiceBrief(comp, assets, () => null, transcripts)!;
    const brief = songBrief({ prompt: 'warm startup story', voice });
    expect(brief.purpose).toBe('score');
    expect(brief.instrumental).toBe(true);
    expect(brief.seconds).toBeCloseTo(Math.round((voice.end + 2.5) * 10) / 10, 1);
    expect(brief.tags).toEqual(expect.arrayContaining(['instrumental', 'underscore', 'no vocals']));
    expect(aceLyrics(brief)).toBe('[Instrumental]');
    // Sections cover the length without gaps, on bars.
    const end = brief.sections.at(-1)!;
    expect(end.start + end.seconds).toBeCloseTo(brief.seconds, 1);
    for (let i = 1; i < brief.sections.length; i++) expect(brief.sections[i].start).toBeCloseTo(brief.sections[i - 1].start + brief.sections[i - 1].seconds, 1);
    expect(brief.sections.some((s) => s.name === 'Build')).toBe(true);
    expect(prosePrompt(brief, { prompt: 'warm startup story' })).toContain('voice-over');
  });

  it('a sung song keeps the lyrics and their form; tempo and key stay out of the caption', () => {
    const lyrics = 'Driving down the coast tonight\nWindows down and hearts alight\n\nWe are young and we are free\nSinging loud just you and me\n\nMiles behind us fading slow\nOnly forward roads we know\n\nWe are young and we are free\nSinging loud just you and me';
    const brief = songBrief({ prompt: 'summer pop anthem, bright guitars', vocals: 'female', lyrics, seconds: 90, bpm: 118, key: 'g' });
    expect(brief.instrumental).toBe(false);
    expect(brief.hasLyrics).toBe(true);
    expect(brief.genre.id).toBe('pop');
    expect(brief.bpm).toBe(118);
    expect(brief.keyscale).toBe('G major');
    expect(aceCaption(brief)).not.toMatch(/bpm|G major/i);
    expect(aceCaption(brief)).toContain('female vocals');
    expect(aceLyrics(brief).match(/\[Chorus\]/g)).toHaveLength(2);
    expect(brief.sections.filter((s) => s.lines.length).length).toBe(4);
  });

  it('tags untagged stanzas, and leaves tagged lyrics alone', () => {
    expect(tagLyrics('a\nb\n\nc\nd\n\na\nb')).toBe('[Verse]\na\nb\n\n[Verse]\nc\nd\n\n[Chorus]\na\nb'.replace('[Verse]\na\nb', '[Chorus]\na\nb'));
    expect(tagLyrics('[Intro]\nhey')).toBe('[Intro]\nhey');
    expect(normalizeKey('f#m')).toBe('F# minor');
    expect(normalizeKey('Bb major')).toBe('Bb major');
    expect(normalizeKey('H')).toBeNull();
  });

  it('a prompt that asks for no vocals stays instrumental', () => {
    expect(songBrief({ prompt: 'lofi beat with rain, instrumental' }).instrumental).toBe(true);
    expect(songBrief({ prompt: 'a rap song about coffee' }).instrumental).toBe(false);
  });
});

const engine = (id: string, extra: Partial<EngineInfo> = {}): EngineInfo => ({ id, label: id, ready: true, vocals: true, writesLyrics: false, exactLength: true, maxSeconds: 240, local: false, ...extra });

describe('choosing the engine', () => {
  const all = [engine('ace-step', { local: true }), engine('elevenlabs', { writesLyrics: true }), engine('fal-minimax', { writesLyrics: true, exactLength: false }), STUDIO_ENGINE];
  it('beds go to the free local model, sung songs to the best singer, lyric-less songs to a model that writes them', () => {
    expect(pickEngine(all, songBrief({ prompt: 'corporate bed', purpose: 'score' })).id).toBe('ace-step');
    expect(pickEngine(all, songBrief({ prompt: 'pop song', vocals: 'male', lyrics: '[Verse]\nla la' })).id).toBe('elevenlabs');
    expect(pickEngine([all[0], all[2], STUDIO_ENGINE], songBrief({ prompt: 'pop song', vocals: 'male' })).id).toBe('fal-minimax');
    expect(pickEngine([STUDIO_ENGINE], songBrief({ prompt: 'ambient', vocals: 'none' })).id).toBe('studio');
  });
  it('refuses what cannot work, saying what to do', () => {
    expect(() => pickEngine([all[0], STUDIO_ENGINE], songBrief({ prompt: 'pop song', vocals: 'female' }))).toThrow(/lyrics/);
    expect(() => pickEngine(all, songBrief({ prompt: 'pop', vocals: 'female', lyrics: 'x' }), 'studio')).toThrow(/cannot sing/);
    expect(() => pickEngine([{ ...all[1], ready: false, reason: 'no key' }], songBrief({ prompt: 'x' }), 'elevenlabs')).toThrow(/no key/);
  });
});

describe('createSong', () => {
  const mastered = { wav: new Uint8Array([1]), duration: 30, lufs: -14, peakDb: -1.1, gainDb: 3, beats: { bpm: 100, confidence: 0.9, beats: [0, 0.6], downbeats: [0], duration: 30 } };
  const deps = (over: Partial<CreateDeps> = {}): CreateDeps & { calls: string[] } => {
    const calls: string[] = [];
    let n = 0;
    return {
      calls,
      engines: async () => [engine('ace-step', { local: true }), engine('elevenlabs', { writesLyrics: true }), STUDIO_ENGINE],
      runLocal: async (r) => { calls.push(`local ${r.seconds} ${r.lyrics}`); return 'C:/raw.flac'; },
      startCloud: async (r) => { calls.push(`cloud ${r.engine} ${r.instrumental}`); return `job${++n}`; },
      jobs: async () => [{ id: 'job1', status: 'done', message: '', result: { path: 'C:/a.mp3' } }, { id: 'job2', status: 'failed', message: 'quota', result: null }],
      renderStudio: async () => new ArrayBuffer(8),
      readFile: async (path) => { calls.push(`read ${path}`); return new ArrayBuffer(8); },
      master: async (_raw, options) => { calls.push(`master ${options.purpose} ${options.seconds}`); return mastered; },
      saveWav: async (name) => `C:/${name}.wav`,
      importAudio: async (path) => asset(path, 30),
      sleep: async () => undefined,
      ...over,
    };
  };

  it('makes a mastered, imported take with its grid from the local model', async () => {
    const d = deps();
    const result = await createSong({ prompt: 'calm corporate bed', purpose: 'score', seconds: 30, bpm: 100 }, d);
    expect(result.engine.id).toBe('ace-step');
    expect(result.takes).toHaveLength(1);
    expect(result.takes[0]).toMatchObject({ bpm: 100, lufs: -14, purpose: 'score', instrumental: true, beats: [0, 0.6] });
    expect(d.calls).toEqual(['local 30 [Instrumental]', 'read C:/raw.flac', 'master score 30']);
  });

  it('waits for cloud jobs, keeps the takes that worked and reports the rest', async () => {
    const d = deps();
    const result = await createSong({ prompt: 'pop song about summer', vocals: 'female', engine: 'elevenlabs', takes: 2 }, d);
    expect(result.takes).toHaveLength(1);
    expect(result.notes.join(' ')).toMatch(/1 take\(s\) failed: elevenlabs: quota/);
    expect(d.calls.filter((c) => c.startsWith('cloud'))).toEqual(['cloud elevenlabs false', 'cloud elevenlabs false']);
  });
});

describe('mastering maths', () => {
  it('the limiter holds the ceiling and leaves quiet audio alone', () => {
    const n = 4800;
    const loud = new Float32Array(n).map((_, i) => Math.sin(i / 7) * 1.6);
    const quiet = new Float32Array(n).map((_, i) => Math.sin(i / 7) * 0.2);
    const pcm = { channels: [loud, quiet.slice()], sampleRate: 48000 };
    limitPeaks(pcm, 0.89);
    expect(Math.max(...pcm.channels[0].map(Math.abs))).toBeLessThanOrEqual(0.8901);
    const calm = { channels: [quiet.slice(), quiet.slice()], sampleRate: 48000 };
    limitPeaks(calm, 0.89);
    expect(calm.channels[0]).toEqual(quiet);
  });
  it('levels come out at 100 buckets a second', () => {
    const pcm = { channels: [new Float32Array(48000).fill(0.5), new Float32Array(48000).fill(0.5)], sampleRate: 48000 };
    const peaks = peaksOf(pcm);
    expect(peaks.buckets).toBe(100);
    expect(peaks.data[0]).toBe(Math.round(0.5 * 255));
  });
});

describe('takes in the studio and on the video', () => {
  const take: SongTake = { id: 't1', assetId: 'song', title: 'Theme', engine: 'ace-step', engineLabel: 'ACE', createdAt: 0, prompt: 'p', summary: 's', purpose: 'score', instrumental: true, bpm: 100, keyscale: 'C major', seconds: 24, lufs: -14, beats: [0, 0.6], downbeats: [0] };

  it('lands in the playlist at its own tempo, a step per sixteenth', () => {
    const song = takeInStudio(newSong('S', 120), take);
    expect(song.bpm).toBe(100);
    const clip = song.playlist.clips.at(-1)!;
    expect(clip).toMatchObject({ kind: 'audio', assetId: 'song', start: 0, length: 160 });
    expect(song.playlist.tracks[clip.trackIndex].name).toContain('Theme');
  });

  it('on the timeline it is ducked under each phrase of the voice', () => {
    const { comp, assets, transcripts } = narrated();
    const voice = voiceBrief(comp, assets, () => null, transcripts)!;
    const project: Project = { ...newProject('Film'), comps: [comp], activeCompId: comp.id, openCompIds: [comp.id] };
    const laid = placeTake(project, comp.id, take, voice);
    const clip = laid.project.comps[0].clips.find((c) => c.id === laid.clipId)!;
    expect(clip.audioType).toBe('music');
    const keys = clip.keyframes.volume;
    expect(keys.length).toBeGreaterThan(4);
    const at = (t: number) => keys.reduce((best, k) => (Math.abs(k.time - t) < Math.abs(best.time - t) ? k : best)).value;
    // Under the first phrase it is about 10 dB down from where it sits in the long pause.
    expect(at(3) / at(1 + 4.7 + 1)).toBeLessThan(0.45);
  });
});
