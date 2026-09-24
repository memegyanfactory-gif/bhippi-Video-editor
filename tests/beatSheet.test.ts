import { describe, expect, it } from 'vitest';
import { beatCounts, echoCandidates, foldWord, isProfane, normalizeBeatSheet, profanityIn, punchlineEnd, type Word } from '../src/lib/roast/beatSheet';

const words = (spec: [string, number, number][]): Word[] => spec.map(([text, start, end]) => ({ text, start, end }));

describe('profanityIn', () => {
  it('finds Hinglish in Roman and Devanagari, English, and YouTube’s placeholder', () => {
    const found = profanityIn(words([
      ['bhai', 0, 0.3], ['yeh', 0.3, 0.5], ['chutiya', 0.5, 1.0], ['hai', 1.0, 1.2],
      ['भोसड़ीके', 1.3, 1.9], ['गांडू', 2.0, 2.4], ['लौड़ा', 2.5, 2.9],
      ['what', 3.0, 3.2], ['the', 3.2, 3.3], ['fucking', 3.3, 3.7], ['hell', 3.7, 4.0],
      ['[', 4.1, 4.15], ['__', 4.15, 4.5], [']', 4.5, 4.55], ['kya', 4.6, 4.8],
      ['[__]', 5.0, 5.4], ['BC,', 5.5, 5.7], ['madarchod!', 5.8, 6.3],
    ]));
    expect(found.map((span) => span.word)).toEqual(['chutiya', 'भोसड़ीके', 'गांडू', 'लौड़ा', 'fucking', '[ __ ]', '[ __ ]', 'BC,', 'madarchod!']);
    expect(found[0]).toMatchObject({ start: 0.5, end: 1.0 });
    // The split placeholder spans from "[" to "]".
    expect(found[5]).toMatchObject({ start: 4.1, end: 4.55 });
  });

  it('leaves everyday words alone', () => {
    for (const word of ['ganda', 'gandagi', 'chod', 'chutney', 'kutta', 'saala', 'dikh', 'assemble', 'गंदा', 'छोड़', 'German']) expect(isProfane(word), word).toBe(false);
  });

  it('reads stretched and variant spellings', () => {
    expect(isProfane('gaaaandu')).toBe(true);
    expect(isProfane('Chutiye')).toBe(true);
    expect(isProfane('चुतिया')).toBe(true);
    expect(isProfane('बहनचोद')).toBe(true);
    expect(foldWord('लौड़ा')).toBe(foldWord('लोडा'));
  });
});

describe('echoCandidates', () => {
  it('keeps the concrete words of a Hinglish line and adjacent pairs', () => {
    expect(echoCandidates('Dhruv ek German shepherd hai')).toEqual(['dhruv', 'german', 'shepherd', 'german shepherd']);
    expect(echoCandidates('mera juice kahan gaya')).toEqual(['juice']);
    expect(echoCandidates('jaise kachre ke dibbe mein zeher daal diya')).toEqual(['kachre', 'dibbe', 'zeher', 'daal', 'zeher daal']);
  });

  it('reads Devanagari with its vowel signs and drops Hindi function words', () => {
    expect(echoCandidates('मेरा जूस कहां गया')).toEqual(['जूस']);
    expect(echoCandidates('वो एक जर्मन शेफर्ड है')).toEqual(['जर्मन', 'शेफर्ड', 'जर्मन शेफर्ड']);
  });
});

describe('punchlineEnd', () => {
  const said = words([['hypocrisy', 3.0, 3.5], ['ka', 3.5, 3.6], ['Olympic', 3.6, 4.0], ['gold', 4.0, 4.3], ['medal', 4.3, 4.72], ['haha', 4.8, 5.2], ['next', 6.1, 6.3]]);
  it('is the end of the last real word in the beat, ignoring laughter after it', () => {
    expect(punchlineEnd({ start: 3, end: 5.3 }, said)).toBe(4.72);
  });
  it('falls back to punchAt, then to the beat end, without words', () => {
    expect(punchlineEnd({ start: 3, end: 5.3, punchAt: 5 }, [])).toBe(5);
    expect(punchlineEnd({ start: 3, end: 5.3 }, [])).toBe(5.3);
  });
});

describe('normalizeBeatSheet', () => {
  it('sorts, trims overlaps, makes ids unique and keeps only known kinds and intents', () => {
    const { sheet, errors, warnings } = normalizeBeatSheet({
      beats: [
        { id: 'b2', start: 5, end: 9, text: 'Dhruv ek German shepherd hai', kinds: ['punchline'], intent: 'Fake Sad' },
        { id: 'b1', start: 1, end: 6, text: 'setup line', kinds: ['setup', 'nonsense'], intent: 'not-an-intent' },
        { id: 'b2', start: 10, end: 12, text: 'phir', kinds: [] },
        { start: 20, end: 19, kinds: ['setup'] },
      ],
    }, 'comp1');
    expect(errors).toHaveLength(1);
    expect(sheet.compId).toBe('comp1');
    expect(sheet.beats.map((beat) => [beat.id, beat.start, beat.end])).toEqual([['b1', 1, 5], ['b2', 5, 9], ['b2-2', 10, 12]]);
    expect(sheet.beats[0].kinds).toEqual(['setup']);
    expect(sheet.beats[0].intent).toBeUndefined();
    expect(sheet.beats[1].intent).toBe('fake-sad');
    expect(sheet.beats[2].kinds).toEqual(['filler']);
    expect(sheet.beats[1].echo).toContain('german shepherd');
    expect(warnings.some((line) => line.includes('nonsense'))).toBe(true);
    expect(warnings.some((line) => line.includes('Duplicate beat id'))).toBe(true);
  });

  it('fills punchAt and profanity from the words and counts kinds', () => {
    const said = words([['yeh', 0.2, 0.4], ['banda', 0.4, 0.8], ['chutiya', 0.9, 1.4], ['hai', 1.4, 1.6], ['lol', 1.7, 2.0]]);
    const { sheet } = normalizeBeatSheet([{ start: 0, end: 2.1, kinds: ['punchline'], text: 'yeh banda chutiya hai' }], 'c', said);
    const beat = sheet.beats[0];
    expect(beat.punchAt).toBe(1.6);
    expect(beat.profanity).toEqual([{ start: 0.9, end: 1.4, word: 'chutiya' }]);
    expect(beat.kinds).toEqual(['punchline', 'profanity']);
    expect(beatCounts(sheet)).toEqual({ punchline: 1, profanity: 1 });
  });

  it('reports an empty sheet', () => {
    expect(normalizeBeatSheet({ beats: [] }, 'c').errors).toEqual(['The beat sheet has no beats.']);
  });
});
