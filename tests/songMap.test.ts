import { describe, expect, it } from 'vitest';
import { alignLyrics, cutPoints, detectHits, matchWords, normWord, parseLyrics, sectionsOf, trustedMatches } from '../src/lib/songMap';
import { BUCKETS_PER_SECOND, type Peaks } from '../src/lib/peaks';

const LYRICS = `[Intro – Spoken, deep male voice, sparse beat, pauses]
An editor…
with a producer inside.
Connect your AI…
and watch it work.

[Verse 1 – Sung, groove kicks in]
Bring your Claude, bring your GPT,
Gemini, local, hand it the key (hand it the key)`;

/** What an engine hears on a song: most spoken words, sung lines half missed or misheard. */
const HEARD = [
  { text: 'An', start: 2.96, end: 3.1 }, { text: 'editor', start: 3.2, end: 3.7 },
  { text: 'with', start: 5.76, end: 5.9 }, { text: 'a', start: 6.08, end: 6.15 }, { text: 'producer', start: 6.32, end: 6.7 }, { text: 'inside.', start: 6.72, end: 7.2 },
  { text: 'Connect', start: 9.1, end: 9.5 }, { text: 'your', start: 9.55, end: 9.7 }, { text: 'AI', start: 9.75, end: 10.2 },
  { text: 'and', start: 11.6, end: 11.75 }, { text: 'watch', start: 11.8, end: 12.1 }, { text: 'it', start: 12.15, end: 12.25 }, { text: 'work', start: 12.3, end: 12.8 },
  // Verse: "Claude" heard as "chlord", the GPT line lost, then half of the next line.
  { text: 'bring', start: 17.0, end: 17.2 }, { text: 'chlord', start: 17.4, end: 17.8 },
  { text: 'hand', start: 22.1, end: 22.3 }, { text: 'it', start: 22.35, end: 22.45 }, { text: 'the', start: 22.5, end: 22.6 }, { text: 'key', start: 22.65, end: 23.0 },
];

describe('lyrics', () => {
  it('reads sections from bracketed headers and drops blank lines', () => {
    const lines = parseLyrics(LYRICS);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toEqual({ text: 'An editor…', section: 'Intro' });
    expect(lines[4].section).toBe('Verse 1');
  });

  it('matches words despite punctuation, case and small mishearings', () => {
    expect(normWord("Bhippi's")).toBe('bhippis');
    const matched = matchWords(['bring', 'your', 'claude', 'hand', 'it', 'the', 'key'], ['bring', 'chlord', 'hand', 'it', 'the', 'key']);
    expect(matched[0]).toBe(0);
    expect(matched[3]).toBe(2);
    expect(matched[6]).toBe(5);
  });
});

describe('aligning lyrics to what was heard', () => {
  const lines = parseLyrics(LYRICS);
  const { lines: aligned, heardShare } = alignLyrics(lines, HEARD, 30);
  const all = aligned.flatMap((line) => line.words);

  it('keeps the engine times for every word it heard', () => {
    const producer = all.find((word) => word.text === 'producer')!;
    expect(producer).toMatchObject({ start: 6.32, heard: true });
    expect(aligned[0]).toMatchObject({ start: 2.96, section: 'Intro' });
  });

  it('gives every lyric word a time, in order, inside the song', () => {
    expect(all.every((word) => Number.isFinite(word.start) && word.end > word.start && word.start >= 0 && word.end <= 30)).toBe(true);
    for (let i = 1; i < all.length; i++) expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].start - 1e-6);
  });

  it('places the words it missed between their heard neighbours', () => {
    const gpt = all.find((word) => word.text === 'GPT')!;
    expect(gpt.heard).toBe(false);
    expect(gpt.start).toBeGreaterThan(17.4);
    expect(gpt.start).toBeLessThan(22.1);
    // The echo "(hand it the key)" is sung after the heard "hand it the key", before the song ends.
    const lastKey = all.filter((word) => word.text === 'key').pop()!;
    expect(lastKey.start).toBeGreaterThan(23);
  });

  it('says how much of the lyric was heard', () => {
    expect(heardShare).toBeGreaterThan(0.5);
    expect(heardShare).toBeLessThan(1);
  });

  it('turns lines into sections and cut points', () => {
    const sections = sectionsOf(aligned, 30);
    expect(sections.map((section) => section.name)).toEqual(['Intro', 'Verse 1']);
    expect(sections[0].end).toBe(sections[1].start);
    const bars = [0, 2.4, 4.8, 7.2, 9.6, 12, 14.4, 16.8, 19.2, 21.6];
    const cuts = cutPoints(sections, aligned, bars);
    expect(cuts).toContain(16.8);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});

describe('hits', () => {
  it('finds the sharp transients in a waveform, spaced apart', () => {
    const seconds = 4;
    const buckets = seconds * BUCKETS_PER_SECOND;
    const data = new Uint8Array(buckets * 2);
    for (let i = 0; i < buckets; i++) { data[i * 2] = 20; data[i * 2 + 1] = 12; }
    const at = [0.5, 1.5, 2.5, 3.5];
    for (const t of at) { const i = Math.round(t * BUCKETS_PER_SECOND); data[i * 2] = 250; data[i * 2 + 1] = 200; }
    const hits = detectHits({ data, buckets } as Peaks);
    expect(hits).toHaveLength(4);
    hits.forEach((hit, index) => expect(Math.abs(hit - at[index])).toBeLessThan(0.05));
  });
});

describe('placing what was not heard', () => {
  it('never anchors on a short word alone', () => {
    // "in" of "Plug it in" must not anchor on the "in" of "Captions in motion" far later.
    const lyric = ['plug', 'it', 'in', 'and', 'the', 'screen', 'captions', 'and', 'motion'];
    const matched = [-1, -1, 0, 3, -1, -1, -1, -1, 1];
    expect(trustedMatches(lyric, matched)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, 1]);
    expect(trustedMatches(['hand', 'it', 'the', 'key'], [4, 5, 6, 7])).toEqual([4, 5, 6, 7]);
  });

  it('starts an unheard section on the drop and its other lines on bar lines', () => {
    const lines = parseLyrics('[Intro]\nAn editor with a producer inside\n[Verse]\nBring your Claude bring your GPT\nGemini local hand it the key');
    const heard = [{ text: 'An', start: 3, end: 3.2 }, { text: 'editor', start: 3.3, end: 3.8 }, { text: 'with', start: 5.8, end: 6 }, { text: 'a', start: 6.05, end: 6.1 }, { text: 'producer', start: 6.3, end: 6.7 }, { text: 'inside', start: 6.8, end: 7.2 }];
    const bars = Array.from({ length: 12 }, (_, i) => Math.round(i * 2.424 * 1000) / 1000);
    const { lines: aligned } = alignLyrics(lines, heard, 30, [], { bars, drops: [16.8], phrases: [0, 9.7, 19.4] });
    const verse = aligned.filter((line) => line.section === 'Verse');
    expect(verse[0].start).toBe(16.8);
    expect(bars.some((bar) => Math.abs(bar - verse[1].start) < 0.01)).toBe(true);
  });
});
