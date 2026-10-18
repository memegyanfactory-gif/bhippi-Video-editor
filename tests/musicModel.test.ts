import { describe, expect, it } from 'vitest';
import {
  addChannel, addClip, newChannel, newSong, noteFromJson, normalizeSong, parseNoteText, parseSteps, setNotes, songLengthSteps, stepString, toggleStep,
} from '../src/music/model';
import { stepsPerBar } from '../src/music/types';

describe('step strings', () => {
  it('parses hits, accents, ghosts and ratchets', () => {
    const notes = parseSteps('X-x-o-r-R-------', 36);
    expect(notes.map((n) => n.start)).toEqual([0, 2, 4, 6, 8]);
    expect(notes[0].velocity).toBe(1);
    expect(notes[2].velocity).toBeLessThan(0.5);
    expect(notes[3].ratchet).toBe(2);
    expect(notes[4].ratchet).toBe(3);
    expect(notes.every((n) => n.key === 36 && n.length === 1)).toBe(true);
  });

  it('ignores spaces and bar lines, reads digits as velocity, holds with _', () => {
    const notes = parseSteps('x--- | 9--- 1_--', 40);
    expect(notes.map((n) => n.start)).toEqual([0, 4, 8]);
    expect(notes[1].velocity).toBe(1);
    expect(notes[2].length).toBe(2);
  });

  it('round-trips through stepString', () => {
    for (const text of ['X---x---x---x---', 'x-o-x-o-x-o-x-o-', 'x_______--------', 'r--R--x-X-------', '----------------']) {
      expect(stepString(parseSteps(text, 60), text.length), text).toBe(text);
    }
    expect(stepString(parseSteps('x---x---x---x---x---', 60), 20)).toBe('x---x---x---x---|x---');
  });

  it('shows off-grid notes as *', () => {
    expect(stepString([{ id: 'a', key: 60, start: 1.5, length: 1, velocity: 0.8 }], 4)).toBe('-*--');
  });
});

describe('note text', () => {
  it('reads keys, chords, lengths, velocities and flags', () => {
    const { notes, errors } = parseNoteText('C4 0 4 100; E4+G4 4 2 90\nA3 8 1 slide p0.5 r2');
    expect(errors).toEqual([]);
    expect(notes.length).toBe(4);
    expect(notes[0]).toMatchObject({ key: 60, start: 0, length: 4 });
    expect(notes[0].velocity).toBeCloseTo(100 / 127);
    expect(notes[1].start).toBe(4);
    expect(notes[2].start).toBe(4);
    expect([notes[1].key, notes[2].key]).toEqual([64, 67]);
    expect(notes[3]).toMatchObject({ key: 57, slide: true, probability: 0.5, ratchet: 2 });
  });

  it('reports what it cannot read instead of guessing', () => {
    const { notes, errors } = parseNoteText('H9 0 4; C4 x 4; C4 0 -1; D4 0 2 80');
    expect(notes.length).toBe(1);
    expect(notes[0].key).toBe(62);
    expect(errors).toEqual(['H9 0 4', 'C4 x 4', 'C4 0 -1']);
  });

  it('defaults length to one step and velocity to 0.8', () => {
    const { notes } = parseNoteText('C4 3');
    expect(notes[0]).toMatchObject({ start: 3, length: 1, velocity: 0.8 });
  });

  it('reads loose JSON notes', () => {
    expect(noteFromJson({ key: 'C#4', start: 2, length: 3, velocity: 64 })).toMatchObject({ key: 61, start: 2, length: 3 });
    expect(noteFromJson({ note: 62, step: 1 })).toMatchObject({ key: 62, start: 1, length: 1 });
    expect(noteFromJson({ key: 'zz', start: 0 })).toBeNull();
    expect(noteFromJson('C4')).toBeNull();
    expect(noteFromJson({ key: 60, start: 0, length: 0 })).toBeNull();
  });
});

describe('song operations', () => {
  it('toggles a step on and off', () => {
    let song = newSong('t');
    song = addChannel(song, newChannel(song, 'drum', { drum: 'kick' }));
    const channel = song.channels[0];
    const pattern = song.patterns[0];
    song = toggleStep(song, pattern.id, channel, 4);
    expect(song.patterns[0].notes[channel.id].map((n) => n.start)).toEqual([4]);
    expect(song.patterns[0].notes[channel.id][0].key).toBe(channel.rootKey);
    song = toggleStep(song, pattern.id, channel, 4);
    expect(song.patterns[0].notes[channel.id]).toEqual([]);
  });

  it('sorts notes it sets', () => {
    let song = newSong('t');
    song = addChannel(song, newChannel(song, 'synth'));
    const id = song.channels[0].id;
    song = setNotes(song, song.patterns[0].id, id, [{ id: 'b', key: 64, start: 4, length: 1, velocity: 1 }, { id: 'a', key: 60, start: 0, length: 1, velocity: 1 }]);
    expect(song.patterns[0].notes[id].map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('measures the song by its last clip, at least a bar', () => {
    let song = newSong('t');
    expect(songLengthSteps(song)).toBe(16);
    song = addClip(song, { trackIndex: 0, start: 16, length: 48, offset: 0, kind: 'pattern', patternId: song.patterns[0].id });
    expect(songLengthSteps(song)).toBe(64);
    expect(songLengthSteps({ ...song, timeSig: [3, 4] })).toBe(64);
    expect(stepsPerBar({ timeSig: [3, 4], stepsPerBeat: 4 })).toBe(12);
    expect(stepsPerBar({ timeSig: [6, 8], stepsPerBeat: 4 })).toBe(12);
  });

  it('grows the track list for a clip past the end', () => {
    let song = newSong('t');
    song = addClip(song, { trackIndex: 20, start: 0, length: 16, offset: 0, kind: 'pattern', patternId: song.patterns[0].id });
    expect(song.playlist.tracks.length).toBe(21);
  });

  it('starts with a master limiter, 16 inserts and 16 tracks', () => {
    const song = newSong('t', 100);
    expect(song.bpm).toBe(100);
    expect(song.mixer.inserts.length).toBe(17);
    expect(song.mixer.inserts[0].effects.map((e) => e.type)).toEqual(['limiter']);
    expect(song.playlist.tracks.length).toBe(16);
  });
});

describe('normalizeSong', () => {
  it('refuses what is not a song', () => {
    expect(normalizeSong(null)).toBeNull();
    expect(normalizeSong('x')).toBeNull();
    expect(normalizeSong({})).toBeNull();
    expect(normalizeSong({ channels: [] })).toBeNull();
  });

  it('mends junk into a usable song', () => {
    const song = normalizeSong({ channels: [], patterns: [], bpm: 5, swing: 3, stepsPerBeat: 99, timeSig: [0, 99], playlist: {}, mixer: {}, view: { activePatternId: 'gone' } })!;
    expect(song.bpm).toBe(20);
    expect(song.swing).toBe(1);
    expect(song.stepsPerBeat).toBe(16);
    expect(song.timeSig).toEqual([1, 32]);
    expect(song.patterns.length).toBe(1);
    expect(song.view.activePatternId).toBe(song.patterns[0].id);
    expect(song.mixer.inserts.length).toBe(17);
    expect(song.playlist.tracks.length).toBe(16);
    expect(song.playlist.clips).toEqual([]);
    expect(song.automations).toEqual([]);
    expect(song.version).toBe(1);
  });

  it('clamps an absurd tempo and keeps a good song as it was', () => {
    expect(normalizeSong({ channels: [], patterns: [], bpm: 5000 })!.bpm).toBe(999);
    const good = newSong('keep', 133);
    const again = normalizeSong(good)!;
    expect(again.bpm).toBe(133);
    expect(again.name).toBe('keep');
    expect(again.patterns[0].id).toBe(good.patterns[0].id);
    expect(again.seed).toBe(good.seed);
  });
});
