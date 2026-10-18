import { describe, expect, it, vi } from 'vitest';
import { addChannel, addClip, newChannel, newEffect, newSong, parseSteps, setNotes, updateInsert, updatePattern } from '../src/music/model';
import { EFFECT_SPECS, INSTRUMENT_SPECS, type InstrumentType, type MusicProject, type Note } from '../src/music/types';
import {
  TempoMap, analyseBuffer, automationRange, automationValueAt, encodeWav, expandAudioClips, expandEvents, renderSong, tempoMapFor,
} from '../src/music/engine';
import { planAutomation, sampleAutomation, TEMPO_RANGE } from '../src/music/engine/automation';
import { EFFECTS } from '../src/music/engine/effects';
import { MixerGraph } from '../src/music/engine/graph';
import { INSTRUMENTS } from '../src/music/engine/instruments';
import { Performer } from '../src/music/engine/performer';

// 120 bpm, 4 steps per beat → one step is 0.125 s.
const STEP = 0.125;
const note = (id: string, key: number, start: number, length = 1, extra: Partial<Note> = {}): Note => ({ id, key, start, length, velocity: 0.8, ...extra });

/** A song with a kick channel, the pattern's notes set, seeded. */
function kickSong(steps = 'x---x---x---x---', bpm = 120) {
  let song: MusicProject = { ...newSong('t', bpm), seed: 1234 };
  const kick = newChannel(song, 'drum', { drum: 'kick' });
  song = addChannel(song, kick);
  const patternId = song.patterns[0].id;
  song = setNotes(song, patternId, kick.id, parseSteps(steps, kick.rootKey));
  return { song, kick, patternId };
}

describe('expandEvents (pattern mode)', () => {
  it('places notes by step at the song tempo, sorted by time', () => {
    const { song, kick } = kickSong();
    const events = expandEvents(song, { mode: 'pattern' });
    expect(events.map((e) => e.step)).toEqual([0, 4, 8, 12]);
    expect(events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(events.every((e) => e.channelId === kick.id && e.velocity === 0.78 && e.key === kick.rootKey)).toBe(true);
    expect(events[0].duration).toBeCloseTo(STEP, 6);
  });

  it('follows the tempo', () => {
    const { song } = kickSong('x---x---x---x---', 60);
    expect(expandEvents(song, { mode: 'pattern' }).map((e) => e.time)).toEqual([0, 1, 2, 3]);
  });

  it('delays odd steps by swing × step × 0.5, and a channel swing overrides the song swing', () => {
    const { song, kick } = kickSong('xxxx------------');
    const swung = expandEvents({ ...song, swing: 0.5 }, { mode: 'pattern' });
    const shift = 0.5 * STEP * 0.5;
    expect(swung.map((e) => +(e.time - e.step * STEP).toFixed(6))).toEqual([0, shift, 0, shift]);
    const own = { ...song, swing: 0.5, channels: song.channels.map((c) => ({ ...c, swing: 0 })) };
    expect(expandEvents(own, { mode: 'pattern' }).every((e) => Math.abs(e.time - e.step * STEP) < 1e-9)).toBe(true);
    const only = { ...song, swing: 0, channels: song.channels.map((c) => (c.id === kick.id ? { ...c, swing: 1 } : c)) };
    expect(expandEvents(only, { mode: 'pattern' })[1].time).toBeCloseTo(STEP + STEP * 0.5, 6);
  });

  it('rolls probability from the seed and the note id, the same every time', () => {
    const { song, kick, patternId } = kickSong('----------------');
    const notes = Array.from({ length: 64 }, (_, i) => note(`n${i}`, 36, i, 1, { probability: 0.5 }));
    const dense = updatePattern(setNotes(song, patternId, kick.id, notes), patternId, (p) => ({ ...p, bars: 4 }));
    const a = expandEvents(dense, { mode: 'pattern' }).map((e) => e.noteId);
    expect(expandEvents(dense, { mode: 'pattern' }).map((e) => e.noteId)).toEqual(a);
    expect(a.length).toBeGreaterThan(16);
    expect(a.length).toBeLessThan(48);
    const other = expandEvents({ ...dense, seed: 99 }, { mode: 'pattern' }).map((e) => e.noteId);
    expect(other).not.toEqual(a);
    const never = setNotes(dense, patternId, kick.id, notes.map((n) => ({ ...n, probability: 0 })));
    expect(expandEvents(never, { mode: 'pattern' })).toHaveLength(0);
    const always = setNotes(dense, patternId, kick.id, notes.map((n) => ({ ...n, probability: 1 })));
    expect(expandEvents(always, { mode: 'pattern' })).toHaveLength(64);
  });

  it('retriggers ratchets inside the note, slightly shortened', () => {
    const { song, kick, patternId } = kickSong('----------------');
    const ratcheted = setNotes(song, patternId, kick.id, [note('r', 36, 0, 3, { ratchet: 3 })]);
    const events = expandEvents(ratcheted, { mode: 'pattern' });
    expect(events.map((e) => e.step)).toEqual([0, 1, 2]);
    expect(events[0].duration).toBeCloseTo(STEP * 0.85, 6);
  });

  it('skips muted notes and zero velocity', () => {
    const { song, kick, patternId } = kickSong('----------------');
    const quiet = setNotes(song, patternId, kick.id, [note('a', 36, 0, 1, { mute: true }), note('b', 36, 1, 1, { velocity: 0 }), note('c', 36, 2)]);
    expect(expandEvents(quiet, { mode: 'pattern' }).map((e) => e.noteId)).toEqual(['c']);
  });

  it('honours channel mute and solo', () => {
    const base = kickSong();
    const { patternId } = base;
    let song = base.song;
    const snare = newChannel(song, 'drum', { drum: 'snare' });
    song = setNotes(addChannel(song, snare), patternId, snare.id, parseSteps('----x-------x---', snare.rootKey));
    const ids = (s: MusicProject) => [...new Set(expandEvents(s, { mode: 'pattern' }).map((e) => e.channelId))];
    expect(ids(song)).toHaveLength(2);
    const muted = { ...song, channels: song.channels.map((c) => (c.id === snare.id ? { ...c, mute: true } : c)) };
    expect(ids(muted)).toEqual([song.channels[0].id]);
    const solo = { ...song, channels: song.channels.map((c) => (c.id === snare.id ? { ...c, solo: true } : c)) };
    expect(ids(solo)).toEqual([snare.id]);
  });

  it('transposes pitched channels by master pitch, not drums', () => {
    const base = kickSong();
    const { patternId } = base;
    let song = base.song;
    const lead = newChannel(song, 'synth');
    song = setNotes(addChannel(song, lead), patternId, lead.id, [note('l', 60, 0)]);
    const events = expandEvents({ ...song, masterPitch: 3 }, { mode: 'pattern' });
    expect(events.find((e) => e.channelId === lead.id)?.key).toBe(63);
    expect(events.find((e) => e.channelId !== lead.id)?.key).toBe(36);
    expect(expandEvents({ ...song, masterPitch: 0.5 }, { mode: 'pattern' }).find((e) => e.channelId === lead.id)?.key).toBe(60.5);
  });

  it('glides slide notes from the previous note', () => {
    const base = kickSong();
    const { patternId } = base;
    let song = base.song;
    const bass = newChannel(song, 'bass808');
    song = setNotes(addChannel(song, bass), patternId, bass.id, [note('a', 36, 0, 4, { slide: true }), note('b', 43, 4, 4, { slide: true }), note('c', 48, 8, 4)]);
    const events = expandEvents(song, { mode: 'pattern' }).filter((e) => e.channelId === bass.id);
    expect(events.map((e) => e.slide)).toEqual([false, true, false]);
    expect(events[1].slideFromKey).toBe(36);
    expect(events[0].slideFromKey).toBeUndefined();
  });

  it('plays a pattern several times with loops and cuts to a range', () => {
    const { song } = kickSong();
    expect(expandEvents(song, { mode: 'pattern', loops: 2 }).map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(expandEvents(song, { mode: 'pattern', loops: 2, from: 8, to: 20 }).map((e) => e.step)).toEqual([8, 12, 16]);
  });
});

describe('expandEvents (song mode)', () => {
  it('loops a pattern shorter than its clip', () => {
    const { song, patternId } = kickSong('x---------------');
    const arranged = addClip(song, { trackIndex: 0, start: 0, length: 48, offset: 0, kind: 'pattern', patternId });
    expect(expandEvents(arranged).map((e) => e.step)).toEqual([0, 16, 32]);
  });

  it('starts a clip part-way into its pattern with offset, and cuts at the clip end', () => {
    const { song, patternId } = kickSong('x-------x-------');
    const offset = addClip(song, { trackIndex: 0, start: 16, length: 24, offset: 8, kind: 'pattern', patternId });
    expect(expandEvents(offset).map((e) => e.step)).toEqual([16, 24, 32]);
    const short = addClip(song, { trackIndex: 0, start: 0, length: 8, offset: 0, kind: 'pattern', patternId });
    expect(expandEvents(short).map((e) => e.step)).toEqual([0]);
  });

  it('honours playlist track mute / solo and clip mute', () => {
    const { song, patternId } = kickSong('x---------------');
    let arranged = addClip(addClip(song, { trackIndex: 0, start: 0, length: 16, offset: 0, kind: 'pattern', patternId }), { trackIndex: 1, start: 16, length: 16, offset: 0, kind: 'pattern', patternId });
    expect(expandEvents(arranged).map((e) => e.step)).toEqual([0, 16]);
    const tracks = (mute: number[], solo: number[]) => arranged.playlist.tracks.map((t, i) => ({ ...t, mute: mute.includes(i), solo: solo.includes(i) }));
    expect(expandEvents({ ...arranged, playlist: { ...arranged.playlist, tracks: tracks([0], []) } }).map((e) => e.step)).toEqual([16]);
    expect(expandEvents({ ...arranged, playlist: { ...arranged.playlist, tracks: tracks([], [0]) } }).map((e) => e.step)).toEqual([0]);
    arranged = { ...arranged, playlist: { ...arranged.playlist, clips: arranged.playlist.clips.map((c, i) => (i === 0 ? { ...c, muted: true } : c)) } };
    expect(expandEvents(arranged).map((e) => e.step)).toEqual([16]);
  });

  it('cuts to a step range', () => {
    const { song, patternId } = kickSong();
    const arranged = addClip(song, { trackIndex: 0, start: 0, length: 32, offset: 0, kind: 'pattern', patternId });
    expect(expandEvents(arranged, { from: 16, to: 24 }).map((e) => e.step)).toEqual([16, 20]);
  });

  it('follows tempo automation', () => {
    const { song, patternId } = kickSong('x---------------');
    // One automation holding 150 bpm: a step is now 0.1 s.
    const value = (150 - TEMPO_RANGE.min) / (TEMPO_RANGE.max - TEMPO_RANGE.min);
    let arranged: MusicProject = { ...song, automations: [{ id: 'tempo', name: 'Tempo', target: { kind: 'tempo' }, points: [{ t: 0, v: value }] }] };
    arranged = addClip(addClip(arranged, { trackIndex: 0, start: 0, length: 64, offset: 0, kind: 'automation', automationId: 'tempo' }), { trackIndex: 1, start: 0, length: 32, offset: 0, kind: 'pattern', patternId });
    const map = tempoMapFor(arranged, 'song', 64);
    expect(map.timeAt(16)).toBeCloseTo(16 * (60 / (150 * 4)), 6);
    expect(map.stepAt(map.timeAt(10.5))).toBeCloseTo(10.5, 5);
    expect(expandEvents(arranged).map((e) => +e.time.toFixed(6))).toEqual([0, 1.6]);
    expect(new TempoMap(song, 64).timeAt(16)).toBeCloseTo(2, 9);
  });
});

describe('expandAudioClips', () => {
  const withClip = (extra = {}) => addClip(newSong('a', 120), { trackIndex: 0, start: 16, length: 16, offset: 4, kind: 'audio', assetId: 'a1', gain: -6, fadeIn: 0.5, fadeOut: 0.25, ...extra });

  it('works out time, duration, sample offset, gain and fades', () => {
    const [clip] = expandAudioClips(withClip());
    expect(clip).toMatchObject({ assetId: 'a1', time: 2, step: 16, clipStart: 16, duration: 2, fadeIn: 0.5, fadeOut: 0.25 });
    expect(clip.offset).toBeCloseTo(0.5, 9);
    expect(clip.gain).toBeCloseTo(Math.pow(10, -6 / 20), 9);
  });

  it('trims to a range, advancing the sample offset and spending the fade-in', () => {
    const [clip] = expandAudioClips(withClip(), { from: 24, to: 28 });
    expect(clip.time).toBe(3);
    expect(clip.duration).toBe(0.5);
    expect(clip.offset).toBeCloseTo(1.5, 9);
    expect(clip.fadeIn).toBe(0);
    expect(clip.fadeOut).toBe(0);
  });

  it('skips muted clips and clips on muted tracks', () => {
    expect(expandAudioClips(withClip({ muted: true }))).toHaveLength(0);
    const song = withClip();
    expect(expandAudioClips({ ...song, playlist: { ...song.playlist, tracks: song.playlist.tracks.map((t, i) => ({ ...t, mute: i === 0 })) } })).toHaveLength(0);
  });
});

describe('automation', () => {
  const curve = (points: Array<{ t: number; v: number; curve?: 'hold' | 'linear' | 'smooth' | 'exp' }>) => ({ points });

  it('interpolates linearly and holds the ends', () => {
    const a = curve([{ t: 0, v: 0 }, { t: 16, v: 1 }]);
    expect(automationValueAt(a, 8)).toBe(0.5);
    expect(automationValueAt(a, -4)).toBe(0);
    expect(automationValueAt(a, 99)).toBe(1);
    expect(automationValueAt(curve([]), 3)).toBe(0);
  });

  it('shapes each segment by its starting point\'s curve', () => {
    expect(automationValueAt(curve([{ t: 0, v: 0.2, curve: 'hold' }, { t: 8, v: 1 }]), 7.9)).toBe(0.2);
    expect(automationValueAt(curve([{ t: 0, v: 0.2, curve: 'hold' }, { t: 8, v: 1 }]), 8)).toBe(1);
    const smooth = curve([{ t: 0, v: 0, curve: 'smooth' }, { t: 8, v: 1 }]);
    expect(automationValueAt(smooth, 4)).toBeCloseTo(0.5, 9);
    expect(automationValueAt(smooth, 2)).toBeCloseTo(0.15625, 9);
    const exp = curve([{ t: 0, v: 0, curve: 'exp' }, { t: 8, v: 1 }]);
    expect(automationValueAt(exp, 4)).toBeCloseTo((Math.exp(1.5) - 1) / (Math.exp(3) - 1), 9);
    expect(automationValueAt(exp, 4)).toBeLessThan(0.5);
  });

  it('copes with unsorted points and out-of-range values', () => {
    expect(automationValueAt(curve([{ t: 8, v: 2 }, { t: 0, v: -1 }]), 4)).toBe(0.5);
    expect(automationValueAt(curve([{ t: 0, v: 5 }]), 1)).toBe(1);
  });

  it('maps 0–1 onto the target\'s real range', () => {
    let song = newSong('a');
    const channel = newChannel(song, 'synth');
    song = addChannel(song, channel);
    song = updateInsert(song, 1, (i) => ({ ...i, effects: [{ ...newEffect('delay'), id: 'fx1' }] }));
    expect(automationRange(song, { kind: 'insert', insert: 1, param: 'volume' })).toEqual({ min: -60, max: 6 });
    expect(automationRange(song, { kind: 'insert', insert: 1, param: 'width' })).toEqual({ min: 0, max: 2 });
    expect(automationRange(song, { kind: 'channel', channelId: channel.id, param: 'cutoff' })).toEqual({ min: 20, max: 20000 });
    expect(automationRange(song, { kind: 'channel', channelId: channel.id, param: 'volume' })).toEqual({ min: 0, max: 1.25 });
    expect(automationRange(song, { kind: 'effect', insert: 1, effectId: 'fx1', param: 'feedback' })).toEqual({ min: 0, max: 0.95 });
    expect(automationRange(song, { kind: 'effect', insert: 1, effectId: 'fx1', param: 'sync' })).toEqual({ min: 0, max: 7, quant: 1 });
    expect(automationRange(song, { kind: 'tempo' })).toEqual(TEMPO_RANGE);
  });

  it('samples clips into real values at a step', () => {
    let song = newSong('a');
    song = { ...song, automations: [{ id: 'v', name: 'Fader', target: { kind: 'insert', insert: 2, param: 'volume' }, points: [{ t: 0, v: 0 }, { t: 16, v: 1 }] }] };
    song = addClip(song, { trackIndex: 0, start: 16, length: 16, offset: 0, kind: 'automation', automationId: 'v' });
    const plan = planAutomation(song);
    expect(sampleAutomation(plan, 8)).toEqual([]);
    expect(sampleAutomation(plan, 24)[0].value).toBeCloseTo(-60 + 0.5 * 66, 9);
    expect(sampleAutomation(plan, 32)[0].value).toBeCloseTo(6, 9);
  });
});

/** Reads the 16-bit samples of a WAV. */
const pcm16 = (wav: Uint8Array) => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return Array.from({ length: (wav.length - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
};

describe('encodeWav', () => {
  const source = { channels: [new Float32Array([0, 0.5, 1, -1, 2]), new Float32Array([0, -0.5, 0, 0, -3])], sampleRate: 44100 };

  it('writes a RIFF header for 16-bit stereo', () => {
    const wav = encodeWav(source);
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(5 * 2 * 2);
    expect(wav.length).toBe(44 + 5 * 2 * 2);
  });

  it('interleaves, scales, clamps and keeps silence silent', () => {
    const s = pcm16(encodeWav(source));
    expect(s[0]).toBe(0);
    expect(s[1]).toBe(0);
    expect(s[2]).toBeGreaterThan(16380);
    expect(s[2]).toBeLessThan(16388);
    expect(s[3]).toBeLessThan(-16380);
    expect(s[3]).toBeGreaterThan(-16388);
    expect(s[4]).toBeGreaterThan(32764);
    expect(s[6]).toBeLessThan(-32764);
    expect(s[9]).toBeLessThan(-32764);
  });

  it('dithers with a seeded generator, so a bounce is repeatable', () => {
    const quiet = { channels: [new Float32Array(2000).fill(0.3)], sampleRate: 48000 };
    expect(Array.from(encodeWav(quiet))).toEqual(Array.from(encodeWav(quiet)));
    const values = new Set(pcm16(encodeWav(quiet)));
    expect(values.size).toBeGreaterThan(1);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
  });

  it('writes 24-bit samples little-endian', () => {
    const wav = encodeWav({ channels: [new Float32Array([0.5, -0.5, 0])], sampleRate: 48000 }, 24);
    const view = new DataView(wav.buffer);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint16(32, true)).toBe(3);
    expect(wav.length).toBe(44 + 9);
    const sample = (i: number) => {
      const v = wav[44 + i * 3] | (wav[45 + i * 3] << 8) | (wav[46 + i * 3] << 16);
      return v & 0x800000 ? v - 0x1000000 : v;
    };
    expect(sample(0)).toBeCloseTo(4194304, -1);
    expect(sample(1)).toBeCloseTo(-4194304, -1);
    expect(sample(2)).toBe(0);
  });
});

const sine = (hz: number, amplitude: number, seconds: number, sampleRate = 44100) => Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate));

describe('analyseBuffer', () => {
  it('measures peak, RMS, loudness and correlation of a stereo sine', () => {
    const tone = sine(1000, 0.5, 3);
    const result = analyseBuffer({ channels: [tone, tone], sampleRate: 44100 });
    expect(result.peakDb).toBeCloseTo(-6.02, 1);
    expect(result.rmsDb).toBeCloseTo(-9.03, 1);
    expect(result.lufs).toBeGreaterThan(-6.6);
    expect(result.lufs).toBeLessThan(-5.4);
    expect(result.correlation).toBeCloseTo(1, 3);
    expect(result.clipped).toBe(false);
    expect(result.windows).toHaveLength(3);
    for (const w of result.windows) expect(w).toBeCloseTo(-9.03, 1);
  });

  it('reports silence, clipping and phase', () => {
    const silent = analyseBuffer({ channels: [new Float32Array(44100), new Float32Array(44100)], sampleRate: 44100 });
    expect(silent.peakDb).toBe(-120);
    expect(silent.lufs).toBe(-70);
    expect(silent.correlation).toBe(1);
    expect(silent.bands).toEqual({ sub: 0, low: 0, lowMid: 0, mid: 0, high: 0 });
    const hot = analyseBuffer({ channels: [new Float32Array(1000).fill(1)], sampleRate: 44100 });
    expect(hot.clipped).toBe(true);
    expect(hot.peakDb).toBeCloseTo(0, 6);
    const tone = sine(500, 0.4, 1);
    const flipped = analyseBuffer({ channels: [tone, tone.map((v) => -v)], sampleRate: 44100 });
    expect(flipped.correlation).toBeCloseTo(-1, 3);
  });

  it('lists a loud second then a silent one in the windows', () => {
    const loud = sine(220, 0.5, 1);
    const both = new Float32Array(88200);
    both.set(loud);
    const result = analyseBuffer({ channels: [both], sampleRate: 44100 });
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0]).toBeCloseTo(-9.03, 1);
    expect(result.windows[1]).toBe(-120);
  });

  it('puts a tone\'s energy in its band', () => {
    const bandOf = (hz: number) => {
      const b = analyseBuffer({ channels: [sine(hz, 0.5, 1)], sampleRate: 44100 }).bands;
      const top = Object.entries(b).sort((x, y) => y[1] - x[1])[0];
      return { name: top[0], share: top[1], total: Object.values(b).reduce((a, c) => a + c, 0) };
    };
    for (const [hz, name] of [[30, 'sub'], [120, 'low'], [800, 'lowMid'], [3500, 'mid'], [12000, 'high']] as const) {
      const hit = bandOf(hz);
      expect(hit.name).toBe(name);
      expect(hit.share).toBeGreaterThan(0.5);
      expect(hit.total).toBeCloseTo(1, 6);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The registries are complete, and a permissive fake of the Web Audio API lets the real engine code
// (instruments, effects, mixer graph, performer, offline bounce) run end to end in Node: it cannot
// judge the sound, but it catches a thrown error, a bad routing call or a wrong time in any path.

type Fake = any;

function fakeNode(initial: Record<string, unknown> = {}): Fake {
  const props = new Map<PropertyKey, unknown>(Object.entries(initial));
  return new Proxy(function () { /* callable */ }, {
    get(_target, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 0;
      if (!props.has(key)) props.set(key, fakeNode());
      return props.get(key);
    },
    set(_target, key, value) {
      props.set(key, value);
      return true;
    },
    apply: () => fakeNode(),
  });
}

const fakeBuffer = (channels: number, length: number, sampleRate: number) => ({
  numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
  getChannelData: () => new Float32Array(length), copyToChannel: () => undefined,
});

function fakeContext(sampleRate = 44100, length = 44100) {
  return fakeNode({
    sampleRate, currentTime: 0, outputLatency: 0, baseLatency: 0,
    createBuffer: (channels: number, len: number, rate: number) => fakeBuffer(channels, len, rate),
    startRendering: async () => fakeBuffer(2, length, sampleRate),
  });
}

/** A song using every instrument and effect, with sends, a sidechain, automation and an audio clip. */
function fullSong(): MusicProject {
  let song: MusicProject = { ...newSong('full', 128), seed: 7 };
  const patternId = song.patterns[0].id;
  const drums = [['kick', 'x---x---x---x---'], ['snare', '----x-------x---'], ['clap', '----x-------x--r'], ['hat', 'x-x-x-x-x-x-x-x-'], ['openhat', '------x-------x-'], ['tom', '------------x---'], ['rim', '--x-------x-----'], ['cowbell', 'x---------------'], ['crash', 'x---------------'], ['ride', '--x---x---x---x-'], ['shaker', 'xxxxxxxxxxxxxxxx'], ['perc', '-x--------x-----']] as const;
  for (const [drum, steps] of drums) {
    const c = newChannel(song, 'drum', { drum });
    song = setNotes(addChannel(song, c), patternId, c.id, parseSteps(steps, c.rootKey));
  }
  const melodic: InstrumentType[] = ['synth', 'fm', 'bass808', 'pluck', 'pad', 'organ', 'keys', 'noise', 'sampler'];
  for (const instrument of melodic) {
    const c = newChannel(song, instrument, instrument === 'sampler' ? { sampleAssetId: 'asset-1', rootKey: 60 } : instrument === 'fm' ? { params: { algorithm: 4, feedback: 0.3 } } : {});
    song = setNotes(addChannel(song, c), patternId, c.id, [
      note(`${instrument}-1`, 48, 0, 4), note(`${instrument}-2`, 55, 4, 4, { slide: true, ratchet: 2 }), note(`${instrument}-3`, 60, 8, 2, { pan: -0.5, fine: 10 }), note(`${instrument}-4`, 64, 12, 4, { probability: 0.8 }),
    ]);
  }
  const effects = Object.keys(EFFECT_SPECS) as Array<keyof typeof EFFECT_SPECS>;
  song = updateInsert(song, 1, (i) => ({ ...i, sends: [{ to: 2, level: 0.5 }, { to: 3, level: 1, sidechain: true }], effects: effects.map((t) => ({ ...newEffect(t), id: `fx-${t}` })) }));
  song = updateInsert(song, 3, (i) => ({ ...i, effects: [{ ...newEffect('sidechain'), id: 'duck' }] }));
  song = updateInsert(song, 2, (i) => ({ ...i, width: 1.4, pan: 0.2, invert: true, volume: -3 }));
  song = {
    ...song,
    automations: [
      { id: 'a-fx', name: 'delay', target: { kind: 'effect', insert: 1, effectId: 'fx-delay', param: 'feedback' }, points: [{ t: 0, v: 0 }, { t: 32, v: 1 }] },
      { id: 'a-vol', name: 'vol', target: { kind: 'insert', insert: 2, param: 'volume' }, points: [{ t: 0, v: 1 }, { t: 32, v: 0.5, curve: 'smooth' }] },
      { id: 'a-ch', name: 'cutoff', target: { kind: 'channel', channelId: song.channels[12].id, param: 'cutoff' }, points: [{ t: 0, v: 0.2 }, { t: 32, v: 0.9 }] },
      { id: 'a-send', name: 'send', target: { kind: 'send', insert: 1, to: 2 }, points: [{ t: 0, v: 0.2 }, { t: 32, v: 1 }] },
      { id: 'a-tempo', name: 'tempo', target: { kind: 'tempo' }, points: [{ t: 0, v: 0.4 }, { t: 32, v: 0.5 }] },
    ],
  };
  for (const [i, id] of ['a-fx', 'a-vol', 'a-ch', 'a-send', 'a-tempo'].entries()) song = addClip(song, { trackIndex: 1 + i, start: 0, length: 32, offset: 0, kind: 'automation', automationId: id });
  song = addClip(song, { trackIndex: 0, start: 0, length: 32, offset: 0, kind: 'pattern', patternId });
  song = addClip(song, { trackIndex: 7, start: 8, length: 16, offset: 0, kind: 'audio', assetId: 'asset-1', gain: -3, fadeIn: 0.1, fadeOut: 0.1 });
  return { ...song, channels: song.channels.map((c, i) => (i < 12 ? { ...c, insert: 1 } : c)) };
}

describe('the registries', () => {
  it('have one player per instrument and one effect per effect type', () => {
    expect(Object.keys(INSTRUMENTS).sort()).toEqual(Object.keys(INSTRUMENT_SPECS).sort());
    expect(Object.keys(EFFECTS).sort()).toEqual(Object.keys(EFFECT_SPECS).sort());
  });
});

describe('the engine against a fake Web Audio API', () => {
  it('plays every instrument and drum piece', () => {
    const ctx = fakeContext();
    const song = fullSong();
    const sample = fakeBuffer(1, 44100, 44100);
    for (const channel of song.channels) {
      const handle = INSTRUMENTS[channel.instrument](ctx, fakeNode(), { time: 1, duration: 0.5, key: channel.rootKey, velocity: 0.8, pan: 0.1, fine: 5, slideFromKey: 50, seed: 3 }, channel, song, sample as unknown as AudioBuffer);
      expect(handle.end).toBeGreaterThan(1);
      handle.stopAt(1.2);
      handle.stopAt(0.5);
    }
    // A sampler without its sample stays silent instead of throwing.
    const sampler = song.channels.find((c) => c.instrument === 'sampler')!;
    expect(INSTRUMENTS.sampler(ctx, fakeNode(), { time: 1, duration: 1, key: 60, velocity: 1, pan: 0, fine: 0 }, sampler, song).end).toBe(1);
  });

  it('creates and retunes every effect', () => {
    const ctx = fakeContext();
    const song = fullSong();
    for (const type of Object.keys(EFFECT_SPECS) as Array<keyof typeof EFFECT_SPECS>) {
      const fx = EFFECTS[type](ctx, {}, song);
      fx.set({ ...Object.fromEntries(EFFECT_SPECS[type].params.map((p) => [p.name, p.max])) }, 2, song);
      fx.set({}, undefined, song);
      fx.sync?.(1);
      fx.setSource?.(true);
      fx.dispose();
    }
  });

  it('builds, updates and automates the mixer graph', () => {
    const ctx = fakeContext();
    const song = fullSong();
    const graph = new MixerGraph(ctx, song, { meters: true });
    expect(graph.channelInput(song.channels[0].id)).not.toBeNull();
    expect(graph.meters()).toHaveLength(song.mixer.inserts.length);
    const edited = updateInsert(song, 1, (i) => ({ ...i, mute: true, effects: [...i.effects].reverse().slice(1), sends: [{ to: 1, level: 1 }, { to: 2, level: 0.3 }] }));
    graph.update({ ...edited, channels: edited.channels.slice(1) });
    graph.update(song, { reset: true });
    graph.sync(0);
    for (const target of [
      { kind: 'channel', channelId: song.channels[0].id, param: 'volume' }, { kind: 'channel', channelId: song.channels[0].id, param: 'pan' },
      { kind: 'insert', insert: 2, param: 'volume' }, { kind: 'insert', insert: 2, param: 'pan' }, { kind: 'insert', insert: 2, param: 'width' },
      { kind: 'effect', insert: 1, effectId: 'fx-delay', param: 'feedback' }, { kind: 'send', insert: 1, to: 2 }, { kind: 'tempo' },
    ] as const) graph.automate(target, 0.5, 1);
    graph.dispose();
  });

  it('performs every event of the song, with stealing, legato and choke', () => {
    const ctx = fakeContext();
    const song = fullSong();
    const graph = new MixerGraph(ctx, song);
    const performer = new Performer(ctx, graph, new Map([['asset-1', fakeBuffer(2, 44100, 44100) as unknown as AudioBuffer]]), song);
    const events = expandEvents(song);
    expect(events.length).toBeGreaterThan(50);
    for (const ev of events) expect(performer.note(ev, ev.time + 1)).not.toBeNull();
    for (const clip of expandAudioClips(song)) performer.audioClip(clip, clip.time + 1);
    performer.stopAll(3);
  });

  it('bounces a song with stems and a beat grid', async () => {
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(_channels: number, length: number, sampleRate: number) {
        return fakeContext(sampleRate, length);
      }
    });
    const song = fullSong();
    const result = await renderSong(song, { stems: true, tail: 1, loadSample: async () => fakeBuffer(1, 4410, 44100) as unknown as AudioBuffer });
    vi.unstubAllGlobals();
    const map = tempoMapFor(song, 'song', 32);
    expect(result.duration).toBeCloseTo(map.timeAt(32), 6);
    expect(result.master.length).toBe(Math.ceil((result.duration + 1) * 44100));
    expect(result.stems?.has(1)).toBe(true);
    expect(result.stems?.has(0)).toBe(false);
    expect(result.beats).toHaveLength(8);
    expect(result.downbeats).toHaveLength(2);
    expect(result.beats[0]).toBe(0);
    expect(result.downbeats[1]).toBeCloseTo(map.timeAt(16), 6);
  });
});
