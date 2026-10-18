import { describe, expect, it } from 'vitest';
import {
  CHORDS, chordFrom, chordKeys, chordQuality, inScale, noteName, parseChordName, parseNote, parseRoot, pitchName, PROGRESSIONS, romanChord, scaleDegree, SCALE_NAMES, SCALES, snapToScale, splitProgression, voiceLead,
} from '../src/music/theory';

describe('notes', () => {
  it('reads note names and numbers', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('F#3')).toBe(54);
    expect(parseNote('Bb2')).toBe(46);
    expect(parseNote('c-1')).toBe(0);
    expect(parseNote('G9')).toBe(127);
    expect(parseNote(61)).toBe(61);
    expect(parseNote('62')).toBe(62);
    expect(parseNote('A')).toBe(69);
    expect(parseNote('H4')).toBeNull();
    expect(parseNote('')).toBeNull();
    expect(parseNote(NaN)).toBeNull();
  });

  it('clamps into MIDI range', () => {
    expect(parseNote(300)).toBe(127);
    expect(parseNote(-5)).toBe(0);
    expect(parseNote('C12')).toBe(127);
  });

  it('round-trips every key through its name', () => {
    for (let key = 0; key <= 127; key++) expect(parseNote(noteName(key)), noteName(key)).toBe(key);
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(pitchName(13)).toBe('C#');
  });

  it('reads roots', () => {
    expect(parseRoot('F#')).toBe(6);
    expect(parseRoot('Eb')).toBe(3);
    expect(parseRoot('A minor')).toBe(9);
    expect(parseRoot(14)).toBe(2);
    expect(parseRoot('nope')).toBeNull();
  });
});

describe('scales', () => {
  it('has 24 well-formed scales', () => {
    expect(SCALE_NAMES.length).toBe(24);
    for (const name of SCALE_NAMES) {
      const steps = SCALES[name];
      expect(steps[0], name).toBe(0);
      expect([...steps].sort((a, b) => a - b), name).toEqual(steps);
      expect(new Set(steps).size, name).toBe(steps.length);
      expect(steps[steps.length - 1], name).toBeLessThan(12);
    }
  });

  it('knows what is in key and snaps to it', () => {
    expect(inScale(60, 0, 'major')).toBe(true);
    expect(inScale(61, 0, 'major')).toBe(false);
    expect(inScale(70, 9, 'minor')).toBe(false); // A# in A minor
    expect(snapToScale(61, 0, 'major')).toBe(60); // ties go down
    expect(snapToScale(66, 0, 'major')).toBe(65);
    expect(snapToScale(60, 0, 'major')).toBe(60);
  });

  it('walks scale degrees across octaves', () => {
    expect(scaleDegree(0, 'major', 0, 4)).toBe(60);
    expect(scaleDegree(0, 'major', 2, 4)).toBe(64);
    expect(scaleDegree(0, 'major', 7, 4)).toBe(72);
    expect(scaleDegree(0, 'major', -1, 4)).toBe(59);
    expect(scaleDegree(9, 'minor', 4, 4)).toBe(76);
  });
});

describe('chords', () => {
  it('stacks chord keys and inversions', () => {
    expect(chordKeys(0, 'maj', 4)).toEqual([60, 64, 67]);
    expect(chordKeys(0, 'min7', 4)).toEqual([60, 63, 67, 70]);
    expect(chordKeys(0, 'maj', 4, 1)).toEqual([64, 67, 72]);
    expect(chordKeys(0, 'maj', 4, 2)).toEqual([67, 72, 76]);
    expect(chordKeys(7, '7', 3)).toEqual([55, 59, 62, 65]);
  });

  it('understands quality aliases', () => {
    expect(chordQuality('m')).toBe('min');
    expect(chordQuality('')).toBe('maj');
    expect(chordQuality('maj7')).toBe('maj7');
    expect(chordQuality('zzz')).toBeNull();
    for (const quality of Object.keys(CHORDS)) expect(chordKeys(0, quality, 4).length).toBeGreaterThanOrEqual(2);
  });

  it('reads chord names, with slash basses', () => {
    expect(parseChordName('Am7', 4)).toEqual([69, 72, 76, 79]);
    expect(parseChordName('F#m', 4)).toEqual([66, 69, 73]);
    expect(parseChordName('Bbmaj7', 4)).toEqual([70, 74, 77, 81]);
    expect(parseChordName('C/E', 4)).toEqual([52, 60, 64, 67]);
    expect(parseChordName('Hx')).toBeNull();
  });

  it('builds roman numerals in C major', () => {
    expect(romanChord('I', 0, 'major')).toEqual([60, 64, 67]);
    expect(romanChord('ii', 0, 'major')).toEqual([62, 65, 69]);
    expect(romanChord('IV', 0, 'major')).toEqual([65, 69, 72]);
    expect(romanChord('V7', 0, 'major')).toEqual([67, 71, 74, 77]);
    expect(romanChord('vi', 0, 'major')).toEqual([69, 72, 76]);
    expect(romanChord('Imaj7', 0, 'major')).toEqual([60, 64, 67, 71]);
    expect(romanChord('vii°', 0, 'major')).toEqual([71, 74, 77]);
    expect(romanChord('bVII', 0, 'major')).toEqual([70, 74, 77]);
    expect(romanChord('X', 0, 'major')).toBeNull();
  });

  it('builds roman numerals in A minor', () => {
    expect(romanChord('i', 9, 'minor')).toEqual([69, 72, 76]);
    expect(romanChord('iv', 9, 'minor')).toEqual([62, 65, 69]);
    expect(romanChord('VI', 9, 'minor')).toEqual([65, 69, 72]);
    expect(romanChord('III', 9, 'minor')).toEqual([60, 64, 67]);
    expect(romanChord('VII', 9, 'minor')).toEqual([67, 71, 74]);
    expect(romanChord('v', 9, 'minor')).toEqual([64, 67, 71]);
  });

  it('reads either form through chordFrom and splits progressions', () => {
    expect(chordFrom('vi', 0, 'major')).toEqual([69, 72, 76]);
    expect(chordFrom('Am', 0, 'major')).toEqual([69, 72, 76]);
    expect(chordFrom('nonsense', 0, 'major')).toBeNull();
    expect(splitProgression('vi-IV-I-V')).toEqual(['vi', 'IV', 'I', 'V']);
    expect(splitProgression('Am F C G')).toEqual(['Am', 'F', 'C', 'G']);
    expect(splitProgression('i, VI | III – VII')).toEqual(['i', 'VI', 'III', 'VII']);
  });

  it('every named progression reads in a major or minor key', () => {
    for (const [id, p] of Object.entries(PROGRESSIONS)) {
      const key = p.minor ? 'minor' : 'major';
      for (const symbol of splitProgression(p.chords)) expect(romanChord(symbol, 0, key), `${id}: ${symbol}`).not.toBeNull();
    }
  });
});

describe('voice leading', () => {
  it('keeps chords close to the previous one', () => {
    const c = [60, 64, 67];
    const g = voiceLead(c, [67, 71, 74]);
    const center = (keys: number[]) => keys.reduce((a, b) => a + b, 0) / keys.length;
    expect(Math.abs(center(g) - center(c))).toBeLessThan(5);
    expect(g.map((k) => k % 12).sort((a, b) => a - b)).toEqual([2, 7, 11]);
    const am = voiceLead(g, [69, 72, 76]);
    expect(Math.abs(center(am) - center(g))).toBeLessThan(5);
    expect(am.map((k) => k % 12).sort((a, b) => a - b)).toEqual([0, 4, 9]);
  });

  it('passes the first chord through', () => {
    expect(voiceLead(null, [60, 64, 67])).toEqual([60, 64, 67]);
    expect(voiceLead([], [60, 64, 67])).toEqual([60, 64, 67]);
  });
});
