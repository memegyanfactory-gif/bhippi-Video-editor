// A song mapped for editing: every word of the user's lyrics with its time, the lines and sections,
// the beats and bars, the hits worth animating on and the cut points (analyze_song in aiTools.ts).
//
// Speech engines hear sung lines badly: in the 29 Sep launch film Deepgram heard "chlord" and
// "Gentlemen, I love", and whole chorus lines came back empty. Every film that timed words to a
// song well did the same thing by hand: take the lyrics the user gave, match them to what the
// engine heard, and place the words it missed between the ones it caught. That is what this does,
// as plain deterministic arithmetic, so any model gets exact word times in one call.
import { onsetEnvelope, type BeatAnalysis, type MusicStructure } from './beats';
import { BUCKETS_PER_SECOND, type Peaks } from './peaks';

export type HeardWord = { text: string; start: number; end: number };
/** `heard`: the engine caught this word; otherwise it was placed between the words around it. */
export type SongWord = { text: string; start: number; end: number; heard: boolean };
export type SongLine = { text: string; section: string | null; start: number; end: number; words: SongWord[] };
export type SongSection = { name: string; start: number; end: number };
export type LyricLine = { text: string; section: string | null };

export type SongMap = {
  bpm: number;
  beats: number[];
  bars: number[];
  phrases: number[];
  drops: number[];
  stops: number[];
  /** Transients worth a visual accent (a hit, a snare, a pluck), strongest first capped, in time order. */
  hits: number[];
  sections: SongSection[];
  lines: SongLine[];
  /** Share of lyric words the engine heard (0-1): how far to trust the placed ones. */
  heardShare: number;
  /** Where cuts land well: section starts, line starts and bar lines, merged and in order. */
  cuts: number[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A word as compared: lower case, letters and digits only ("Bhippi's" and "bhippis" match). */
export const normWord = (word: string) => word.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/**
 * The lyric lines and the sections they belong to. A line in square brackets names a section
 * ("[Verse 1 – Sung, groove kicks in]" is the section "Verse 1"); blank lines are dropped.
 */
export function parseLyrics(lyrics: string): LyricLine[] {
  const out: LyricLine[] = [];
  let section: string | null = null;
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].split(/\s[–—-]\s|[,:]/)[0].trim() || header[1].trim();
      continue;
    }
    out.push({ text: line, section });
  }
  return out;
}

/** The words of a lyric line as sung: echoes in brackets are words too, punctuation is not. */
const lyricWords = (text: string) => text.replace(/[()]/g, ' ').split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter((word) => normWord(word).length > 0);

/** 0-1 likeness of two normalised words: 1 when equal, by edit distance otherwise. */
function likeness(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** How close two words must be to count as the same sung word ("chlord" is not "chord"; "gonna" is "gona"). */
const MATCH = 0.72;

/**
 * For each lyric word, the index of the heard word it matches, or -1: a global alignment
 * (Needleman-Wunsch) that rewards like words and lets either side skip, since engines both miss
 * sung words and invent words from the music.
 */
export function matchWords(lyric: string[], heard: string[]): number[] {
  const n = lyric.length;
  const m = heard.length;
  const SKIP_LYRIC = -0.6;
  const SKIP_HEARD = -0.4;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up (skip lyric), 3 left (skip heard)
  for (let i = 1; i <= n; i++) { score[i][0] = i * SKIP_LYRIC; move[i][0] = 2; }
  for (let j = 1; j <= m; j++) { score[0][j] = j * SKIP_HEARD; move[0][j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const like = likeness(lyric[i - 1], heard[j - 1]);
      const diagonal = score[i - 1][j - 1] + (like >= MATCH ? 1 + like : -1.5);
      const up = score[i - 1][j] + SKIP_LYRIC;
      const left = score[i][j - 1] + SKIP_HEARD;
      // On a tie, skip the later lyric word: a repeated phrase ("hand it the key (hand it the key)")
      // is heard on its first, louder singing more often than on the echo.
      if (diagonal > up + 1e-9 && diagonal >= left) { score[i][j] = diagonal; move[i][j] = 1; }
      else if (up >= left) { score[i][j] = up; move[i][j] = 2; }
      else { score[i][j] = left; move[i][j] = 3; }
    }
  }
  const matched = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = move[i][j];
    if (step === 1) {
      if (likeness(lyric[i - 1], heard[j - 1]) >= MATCH) matched[i - 1] = j - 1;
      i--; j--;
    } else if (step === 2) i--;
    else j--;
  }
  return matched;
}

/** Seconds a sung word needs, by its length: used to place words the engine missed. */
const wordSeconds = (word: string) => 0.12 + 0.055 * normWord(word).length;

/** The nearest time in sorted `times` within `window` of `t`, or `t`. */
function snapTo(times: number[], t: number, window: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) { const mid = (low + high) >> 1; if (times[mid] < t) low = mid + 1; else high = mid; }
  const candidates = [times[low - 1], times[low]].filter((value): value is number => value !== undefined && Math.abs(value - t) <= window);
  return candidates.sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0] ?? t;
}

/**
 * The user's lyric lines with a time for every word: heard words keep the engine's times; missed
 * ones are placed between their heard neighbours. A run of missed words that shares a line with
 * the next heard word ends just before it (singers lead into it); a run sharing a line with the
 * previous one follows it; whole lines nobody heard share the gap in proportion to their length.
 * Placed word starts snap to a nearby hit when `hits` are given.
 */
export function alignLyrics(lines: LyricLine[], heard: HeardWord[], duration: number, hits: number[] = [], grid: SongGrid = { bars: [], drops: [], phrases: [] }): { lines: SongLine[]; heardShare: number } {
  const flat: { text: string; line: number }[] = [];
  lines.forEach((line, index) => { for (const word of lyricWords(line.text)) flat.push({ text: word, line: index }); });
  const times: ({ start: number; end: number; heard: boolean } | null)[] = new Array(flat.length).fill(null);
  const matched = trustedMatches(flat.map((word) => normWord(word.text)), matchWords(flat.map((word) => normWord(word.text)), heard.map((word) => normWord(word.text))));
  const opens = new Set(lines.flatMap((line, index) => (index === 0 || line.section !== lines[index - 1].section ? [index] : [])));
  let lastHeard = -Infinity;
  matched.forEach((index, at) => {
    // A heard word must come after the one before it: the alignment is monotonic, times should be too.
    if (index >= 0 && heard[index].start >= lastHeard) {
      times[at] = { start: heard[index].start, end: Math.max(heard[index].end, heard[index].start + 0.05), heard: true };
      lastHeard = heard[index].start;
    }
  });

  let at = 0;
  while (at < flat.length) {
    if (times[at]) { at++; continue; }
    let stop = at;
    while (stop < flat.length && !times[stop]) stop++;
    const before = at > 0 ? times[at - 1] : null;
    const after = stop < flat.length ? times[stop] : null;
    const from = before ? before.end + 0.04 : 0;
    const to = after ? after.start - 0.04 : duration;
    placeRun(flat, times, at, stop, from, Math.max(from, to), before ? flat[at - 1].line : null, after ? flat[stop].line : null, hits, grid, opens);
    at = stop;
  }

  const out: SongLine[] = lines.map((line) => ({ text: line.text, section: line.section, start: 0, end: 0, words: [] }));
  flat.forEach((word, index) => {
    const time = times[index]!;
    out[word.line].words.push({ text: word.text, start: round(time.start), end: round(time.end), heard: time.heard });
  });
  for (const line of out) {
    line.start = line.words[0]?.start ?? 0;
    line.end = line.words[line.words.length - 1]?.end ?? line.start;
  }
  const heardCount = times.filter((time) => time?.heard).length;
  return { lines: out.filter((line) => line.words.length), heardShare: flat.length ? round(heardCount / flat.length) : 0 };
}

/** Where unheard lines may start: bar lines; a section opens on a drop nearby, or else a phrase line. */
export type SongGrid = { bars: number[]; drops: number[]; phrases: number[] };

/** Short, common words that match anywhere in a song: never an anchor on their own. */
const COMMON = new Set(['your', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'they', 'them', 'then', 'there', 'their', 'into', 'just', 'like', 'will', 'were', 'been', 'over', 'every']);

/**
 * The matches safe to anchor times on. A short or common word ("in", "it", "your") matches almost
 * anywhere, and one wrong anchor squeezes everything around it (the real song's "Plug it in"
 * anchored on the "in" of "Captions in motion", 36 s later): such a word counts only when a
 * neighbour matched the heard word next to it too.
 */
export function trustedMatches(lyric: string[], matched: number[]): number[] {
  return matched.map((index, at) => {
    if (index < 0) return -1;
    if (lyric[at].length >= 4 && !COMMON.has(lyric[at])) return index;
    const withBefore = at > 0 && matched[at - 1] >= 0 && matched[at - 1] === index - 1;
    const withAfter = at + 1 < matched.length && matched[at + 1] >= 0 && matched[at + 1] === index + 1;
    return withBefore || withAfter ? index : -1;
  });
}

function placeRun(
  flat: { text: string; line: number }[], times: ({ start: number; end: number; heard: boolean } | null)[],
  at: number, stop: number, from: number, to: number, lineBefore: number | null, lineAfter: number | null, hits: number[],
  grid: SongGrid, opens: Set<number>,
) {
  // Split the run: words on the previous heard word's line, whole unheard lines, words on the next heard word's line.
  let head = at;
  while (head < stop && lineBefore !== null && flat[head].line === lineBefore) head++;
  let tail = stop;
  while (tail > head && lineAfter !== null && flat[tail - 1].line === lineAfter) tail--;
  const need = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += wordSeconds(flat[i].text); return s; };
  const span = Math.max(0, to - from);
  const total = need(at, stop);
  // When the gap is too short for the words at their natural pace, squeeze them all evenly.
  const scale = total > span && total > 0 ? span / total : 1;
  const lay = (a: number, b: number, start: number) => {
    let t = start;
    for (let i = a; i < b; i++) {
      const length = Math.max(0.08, wordSeconds(flat[i].text) * scale);
      const snapped = hits.length && scale === 1 ? snapTo(hits, t, 0.12) : t;
      const s = Math.max(t - 0.12, Math.min(snapped, to));
      times[i] = { start: s, end: Math.max(s + 0.05, s + length * 0.92), heard: false };
      t = s + length;
    }
  };
  if (scale < 1) { lay(at, stop, from); return; }
  const headNeed = need(at, head);
  const tailNeed = need(tail, stop);
  lay(at, head, from);
  lay(tail, stop, to - tailNeed);
  // Whole unheard lines share what is left between, in proportion to their length, with a breath between lines.
  const middleFrom = from + headNeed + 0.2;
  const middleTo = to - tailNeed - 0.2;
  if (tail > head) {
    const lineIds = [...new Set(flat.slice(head, tail).map((word) => word.line))];
    const needs = lineIds.map((id) => need(flat.findIndex((word) => word.line === id), flat.findLastIndex((word) => word.line === id) + 1));
    const room = Math.max(0, middleTo - middleFrom);
    const spare = Math.max(0, room - needs.reduce((sum, value) => sum + value, 0));
    const gap = lineIds.length > 1 ? spare / lineIds.length : spare / 2;
    let t = middleFrom + (lineIds.length > 1 ? 0 : gap);
    let free = middleFrom;
    lineIds.forEach((id, index) => {
      const first = flat.findIndex((word) => word.line === id);
      const last = flat.findLastIndex((word) => word.line === id) + 1;
      // Sung lines start on the grid: a section's first line on a drop or phrase line nearby, any
      // other on the nearest bar line, as long as it still fits before what comes after it.
      const latest = middleTo - needs.slice(index).reduce((sum, value) => sum + value, 0);
      // A section after a gap opens on the first drop within reach (the music announces it), else a phrase line.
      const drop = opens.has(id) ? grid.drops.find((time) => time >= free && time <= latest && time - t <= 10) : undefined;
      const opener = drop ?? (opens.has(id) ? snapTo(grid.phrases, t, 4) : t);
      // Otherwise the bar line nearest the proposed time among those where the line still fits.
      const target = Math.min(Math.max(t, free), latest);
      const bar = grid.bars.filter((time) => time >= free && time <= latest && Math.abs(time - target) <= 1.3).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      const snapped = opener !== t ? opener : bar ?? t;
      const start = snapped >= free && snapped <= latest ? snapped : Math.min(Math.max(t, free), Math.max(free, latest));
      lay(Math.max(first, head), Math.min(last, tail), start);
      free = start + needs[index] + 0.1;
      t = Math.max(start + needs[index] + gap, free);
    });
  }
}

/**
 * The transients worth a visual accent: onset peaks well above their surroundings, at least
 * `minGap` seconds apart, the strongest `limit` kept (returned in time order).
 */
export function detectHits(peaks: Peaks, options: { minGap?: number; limit?: number; start?: number } = {}): number[] {
  const hz = BUCKETS_PER_SECOND;
  const envelope = onsetEnvelope(peaks);
  const n = envelope.length;
  if (!n) return [];
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) { sum += envelope[i]; sq += envelope[i] * envelope[i]; }
  const mean = sum / n;
  const deviation = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const threshold = mean + 2.2 * deviation;
  const minGap = Math.max(1, Math.round((options.minGap ?? 0.12) * hz));
  const found: { at: number; strength: number }[] = [];
  for (let i = 1; i + 1 < n; i++) {
    const value = envelope[i];
    if (value < threshold || value < envelope[i - 1] || value < envelope[i + 1]) continue;
    const last = found[found.length - 1];
    if (last && i - last.at < minGap) { if (value > last.strength) found[found.length - 1] = { at: i, strength: value }; continue; }
    found.push({ at: i, strength: value });
  }
  const limit = options.limit ?? 400;
  const kept = found.length > limit ? [...found].sort((a, b) => b.strength - a.strength).slice(0, limit) : found;
  const start = options.start ?? 0;
  return kept.map((hit) => round(start + hit.at / hz)).sort((a, b) => a - b);
}

/** Sections from the lines: each starts at its first line and ends where the next begins. */
export function sectionsOf(lines: SongLine[], duration: number): SongSection[] {
  const out: SongSection[] = [];
  for (const line of lines) {
    const name = line.section ?? 'Song';
    if (out[out.length - 1]?.name !== name) out.push({ name, start: line.start, end: duration });
  }
  out.forEach((section, index) => { section.end = out[index + 1]?.start ?? duration; });
  return out;
}

/**
 * Where cuts land well, in order: section starts snapped to the nearest bar line, line starts, and
 * bar lines, with anything closer than `minGap` to an earlier, stronger point dropped.
 */
export function cutPoints(sections: SongSection[], lines: SongLine[], bars: number[], minGap = 0.4): number[] {
  const strong = sections.map((section) => (bars.length ? snapTo(bars, section.start, 0.6) : section.start));
  const ranked = [...strong, ...lines.map((line) => line.start), ...bars];
  const out: number[] = [];
  for (const t of ranked) if (!out.some((kept) => Math.abs(kept - t) < minGap)) out.push(round(t));
  return out.sort((a, b) => a - b);
}

/** Everything together, from the beat analysis, its structure, the lyrics and what the engine heard. */
export function buildSongMap(
  peaks: Peaks, analysis: BeatAnalysis, structure: MusicStructure, lyrics: string | null, heard: HeardWord[], duration: number,
): SongMap {
  const hits = detectHits(peaks);
  const lyricLines = lyrics ? parseLyrics(lyrics) : [];
  const aligned = lyricLines.length
    ? alignLyrics(lyricLines, heard, duration, hits, { bars: structure.bars, drops: structure.drops, phrases: structure.phrases })
    : { lines: heardLines(heard), heardShare: heard.length ? 1 : 0 };
  const sections = sectionsOf(aligned.lines, duration);
  return {
    bpm: round(analysis.bpm),
    beats: analysis.beats.map(round),
    bars: structure.bars.map(round),
    phrases: structure.phrases.map(round),
    drops: structure.drops.map(round),
    stops: structure.stops.map(round),
    hits,
    sections,
    lines: aligned.lines,
    heardShare: aligned.heardShare,
    cuts: cutPoints(sections, aligned.lines, structure.bars),
  };
}

/** Without lyrics: what the engine heard, grouped into lines at pauses of 0.7 s or more. */
function heardLines(heard: HeardWord[]): SongLine[] {
  const out: SongLine[] = [];
  for (const word of heard) {
    const last = out[out.length - 1];
    const entry = { text: word.text, start: round(word.start), end: round(word.end), heard: true };
    if (last && word.start - last.end < 0.7) { last.words.push(entry); last.text += ` ${word.text}`; last.end = entry.end; }
    else out.push({ text: word.text, section: null, start: entry.start, end: entry.end, words: [entry] });
  }
  return out;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;

/** The song map as a research note: what a later turn reads instead of analysing the song again. */
export function songMapMarkdown(name: string, map: SongMap): string {
  const out = [
    `# Song map: ${name}`,
    '',
    `${map.bpm} BPM · ${map.bars.length} bars · ${map.phrases.length} phrases · drops at ${map.drops.map(clock).join(', ') || 'none'} · ${Math.round(map.heardShare * 100)}% of the lyric heard by the engine (the rest placed between heard words). Times are source seconds of the song.`,
    '',
    '## Sections',
    '',
    '| Section | Start | End |',
    '|---|---|---|',
    ...map.sections.map((section) => `| ${section.name} | ${clock(section.start)} | ${clock(section.end)} |`),
    '',
    '## Lines and words',
    '',
  ];
  for (const line of map.lines) {
    out.push(`**${clock(line.start)}–${clock(line.end)}** ${line.text}`);
    out.push(`  ${line.words.map((word) => `${word.start.toFixed(2)} ${word.text}${word.heard ? '' : '*'}`).join(' · ')}`);
    out.push('');
  }
  out.push('`*` placed, not heard.', '', '## Cut points', '', map.cuts.map((t) => t.toFixed(2)).join(', '), '', '## Hits', '', map.hits.map((t) => t.toFixed(2)).join(', '), '');
  return out.join('\n');
}
