// The beat sheet: what each sentence of a roast recording is doing (docs/FUNNY-MODE-PLAN.md §3.2
// step 2). The model labels sentences — setup, punchline, quote, profanity… — and this checks and
// tidies what it wrote before it is kept on the comp, then fills in what the transcript already
// knows: when a punchline's last word ends, which words are profane (for the bleep move), and
// which concrete words a meme could echo back ("zeher", "juice", "German shepherd").
//
// Transcripts of Hinglish recordings arrive in Devanagari, in Roman, or mixed, and YouTube's own
// captions replace a censored word with "[ __ ]"; every helper here reads all three.

import type { TranscriptWord } from '../ipc';
import { COMIC_INTENTS, type Beat, type BeatKind, type BeatSheet, type ComicIntent, type TimedSpan } from './types';

/** A word with timeline times (subtitlesEngine.wordsOnTimeline / transcriptText.timelineWords). */
export type Word = Pick<TranscriptWord, 'text' | 'start' | 'end'>;

export const BEAT_KINDS: readonly BeatKind[] = ['setup', 'punchline', 'claim', 'quote', 'reference', 'question', 'emotion', 'callback', 'profanity', 'cta', 'filler'];

export type BeatSheetCheck = { sheet: BeatSheet; errors: string[]; warnings: string[] };

// ─── Text normalisation ───────────────────────────────────────────────────────────────────────

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * One spelling per word: lower case, no punctuation; Roman repeated letters collapsed
 * ("gaandu" → "gandu", "fuuuck" → "fuck"); Devanagari without nukta, with chandrabindu as
 * anusvara and long ū/ī/au as their short forms ("लौड़ा" → "लोडा"), since transcripts vary.
 */
export function foldWord(text: string): string {
  let word = text.normalize('NFC').toLowerCase().replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
  if (DEVANAGARI.test(word)) {
    word = word
      .replace(/ड़/g, 'ड').replace(/ढ़/g, 'ढ').replace(/ज़/g, 'ज').replace(/फ़/g, 'फ')
      .replace(/़/g, '')
      .replace(/ँ/g, 'ं')
      .replace(/ू/g, 'ु').replace(/ी/g, 'ि').replace(/ौ/g, 'ो');
    return word;
  }
  return word.replace(/(\p{L})\1+/gu, '$1');
}

// ─── Profanity ────────────────────────────────────────────────────────────────────────────────

/** Whole words that are always profane (folded on load). Kept to what YouTube's ad review reacts to. */
const PROFANE_WORDS = foldedSet([
  // English
  'fuck', 'fck', 'fuk', 'fcuk', 'shit', 'bulshit', 'bitch', 'cunt', 'dick', 'dickhead', 'whore', 'slut', 'pusy', 'bastard', 'ashole', 'arsehole', 'wtf',
  // Hinglish, Roman
  'bc', 'mc', 'bsdk', 'bkl', 'mkc', 'bkc', 'mkb', 'tmkc', 'gandu', 'gand', 'lund', 'loda', 'lode', 'lodu', 'lauda', 'laude', 'lawda', 'lawde', 'randi', 'harami', 'jhant', 'jhatu', 'choot', 'kutiya', 'tate',
  // Devanagari (folded)
  'गांड', 'गांडू', 'लंड', 'लौड़ा', 'लोडा', 'लौड़े', 'लोडे', 'लोडू', 'रंडी', 'हरामी', 'झांट', 'झाटू', 'चूत', 'कुतिया',
]);

/** Prefixes that are profane in any inflection ("chutiye", "madarchodo", "fucking"); folded on load. */
const PROFANE_STEMS = [
  'fuck', 'motherf', 'bulshit', 'bitch', 'ashole', 'bastard',
  'chutiy', 'chutia', 'chutya', 'bhosd', 'bhosad', 'madarch', 'maderch', 'madharch', 'madarjat',
  'benchod', 'bhenchod', 'behenchod', 'bahenchod', 'behnchod', 'bahanchod', 'bhanchod', 'betichod', 'haramkh', 'haramz', 'randw', 'chodu',
  'चुतिय', 'चूतिय', 'भोसड', 'मादरचोद', 'भेनचोद', 'बहनचोद', 'बहेनचोद', 'भैनचोद', 'बेनचोद', 'बेटीचोद', 'हरामखोर', 'हरामज़ाद', 'फ़क',
].map(foldWord);

function foldedSet(words: string[]): Set<string> {
  return new Set(words.map(foldWord));
}

const isCensorMark = (text: string) => /^\[?\s*_{2,}\s*\]?$/.test(text.trim());

/** Whether one word is profane (Roman, Devanagari or a caption's "[ __ ]"). */
export function isProfane(text: string): boolean {
  if (isCensorMark(text)) return true;
  const word = foldWord(text);
  if (!word) return false;
  return PROFANE_WORDS.has(word) || PROFANE_STEMS.some((stem) => word.startsWith(stem));
}

/**
 * The profane words among `words`, with their spans. YouTube's "[ __ ]" placeholder counts, also
 * when the captions split it into "[", "__", "]".
 */
export function profanityIn(words: Word[]): (TimedSpan & { word: string })[] {
  const found: (TimedSpan & { word: string })[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const text = word.text.trim();
    if (text === '[' && words[index + 1] && /^_{2,}$/.test(words[index + 1].text.trim())) {
      const close = words[index + 2]?.text.trim() === ']' ? words[index + 2] : words[index + 1];
      found.push({ start: word.start, end: close.end, word: '[ __ ]' });
      index += close === words[index + 2] ? 2 : 1;
      continue;
    }
    if (isProfane(text)) found.push({ start: word.start, end: word.end, word: isCensorMark(text) ? '[ __ ]' : text });
  }
  return found;
}

// ─── Echo words ───────────────────────────────────────────────────────────────────────────────

const STOPWORDS = foldedSet([
  // English
  'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'about', 'into', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'we', 'us', 'you', 'i', 'me', 'my', 'your', 'his', 'her', 'their', 'our', 'so', 'just', 'very', 'really', 'not', 'no', 'yes', 'yeah', 'ok', 'okay', 'what', 'why', 'how', 'when', 'where', 'who', 'which', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'like', 'also', 'then', 'than', 'there', 'here', 'all', 'some', 'any', 'one', 'more', 'most', 'much', 'many', 'only', 'even', 'still', 'too', 'if', 'because', 'get', 'got', 'going', 'gonna', 'know', 'think', 'say', 'said', 'see', 'look', 'well', 'now', 'guys', 'people', 'thing', 'things',
  // Hinglish, Roman (folded: repeated letters collapsed)
  'hai', 'hain', 'ho', 'tha', 'thi', 'the', 'tho', 'toh', 'ki', 'ka', 'ke', 'ko', 'se', 'me', 'mein', 'main', 'mai', 'mei', 'hum', 'ham', 'tum', 'ap', 'yeh', 'ye', 'woh', 'wo', 'vo', 'voh', 'kya', 'kyu', 'kyun', 'kyon', 'nahi', 'nahin', 'nai', 'na', 'bhi', 'aur', 'or', 'par', 'pe', 'jo', 'jab', 'tab', 'ek', 'kuch', 'kuchh', 'sab', 'bas', 'abhi', 'phir', 'fir', 'ab', 'bhai', 'yar', 'matlab', 'jaise', 'waise', 'kaise', 'kaisa', 'kitna', 'apna', 'apne', 'apni', 'unka', 'uska', 'iska', 'unke', 'uske', 'iske', 'unki', 'uski', 'iski', 'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'hota', 'hoti', 'hote', 'hua', 'hui', 'hue', 'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'gaye', 'diya', 'liya', 'kar', 'karna', 'kiya', 'karke', 'karta', 'karte', 'wala', 'wali', 'wale', 'hi', 'ji', 'han', 'haan', 'acha', 'are', 'arey', 'oye', 'isko', 'usko', 'inko', 'unko', 'ne', 'tak', 'is', 'us', 'in', 'un', 'ki', 'lekin', 'magar', 'agar', 'toh', 'wahi', 'yahi', 'aisa', 'aise', 'waisa', 'kaun', 'kahan', 'yaha', 'yahan', 'waha', 'wahan', 'hoga', 'hogi', 'honge', 'sakta', 'sakte', 'sakti', 'chahiye', 'bol', 'bola', 'bole', 'bolo', 'dekh', 'dekho', 'dekhiye', 'log', 'logo', 'logon', 'cheez', 'chiz',
  // Devanagari (folded)
  'है', 'हैं', 'हो', 'था', 'थि', 'थे', 'तो', 'कि', 'का', 'के', 'को', 'से', 'में', 'मैं', 'मै', 'मे', 'हम', 'तुम', 'आप', 'यह', 'ये', 'वह', 'वो', 'क्या', 'क्यों', 'क्यो', 'नहिं', 'नहि', 'ना', 'भि', 'और', 'पर', 'जो', 'जब', 'तब', 'एक', 'कुछ', 'सब', 'बस', 'अभि', 'फिर', 'अब', 'भाई', 'भाइ', 'यार', 'मतलब', 'जैसे', 'वैसे', 'कैसे', 'कैसा', 'अपना', 'अपने', 'अपनि', 'उसका', 'इसका', 'उनका', 'उसके', 'इसके', 'उनके', 'मेरा', 'मेरि', 'मेरे', 'तेरा', 'तेरि', 'तेरे', 'होता', 'होति', 'होते', 'हुआ', 'हुइ', 'हुए', 'रहा', 'रहि', 'रहे', 'गया', 'गइ', 'गए', 'गये', 'दिया', 'लिया', 'कर', 'करना', 'किया', 'करके', 'करता', 'करते', 'वाला', 'वालि', 'वाले', 'हि', 'जि', 'हां', 'हाँ', 'अरे', 'ने', 'तक', 'इस', 'उस', 'इन', 'उन', 'लेकिन', 'पे', 'अगर', 'वहि', 'यहि', 'ऐसा', 'ऐसे', 'कौन', 'कहां', 'यहां', 'वहां', 'होगा', 'सकता', 'सकते', 'चाहिए', 'चाहिये', 'बोल', 'बोला', 'देखो', 'लोग', 'लोगों', 'चीज',
]);

/** Words of a sentence, in order, keeping Devanagari vowel signs attached to their letters. */
function tokens(text: string): string[] {
  return text.normalize('NFC').split(/[^\p{L}\p{M}\p{N}'’]+/u).map((token) => token.replace(/^['’]+|['’]+$/g, '')).filter(Boolean);
}

const isContent = (token: string) => {
  const folded = foldWord(token);
  if (!folded || STOPWORDS.has(folded) || /^\p{N}+$/u.test(folded)) return false;
  // Roman words under three letters are almost always function words or abbreviations.
  return DEVANAGARI.test(folded) ? [...folded].length >= 2 : folded.length >= 3;
};

/**
 * Concrete words a meme could repeat back: the content words of `text` (English and Hinglish
 * stopwords removed, Devanagari aware), then pairs of adjacent content words ("German shepherd").
 * Lower-cased Roman, original Devanagari; no duplicates.
 */
export function echoCandidates(text: string): string[] {
  const words = tokens(text);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const key = foldWord(value.replace(/\s+/g, ''));
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  };
  const shown = (token: string) => (DEVANAGARI.test(token) ? token : token.toLowerCase());
  const content = words.map(isContent);
  words.forEach((token, index) => content[index] && add(shown(token)));
  words.forEach((token, index) => index > 0 && content[index] && content[index - 1] && add(`${shown(words[index - 1])} ${shown(token)}`));
  return out;
}

// ─── Timing ───────────────────────────────────────────────────────────────────────────────────

/** Whether a word is spoken inside a beat (its middle falls in it). */
const inBeat = (word: Word, beat: Pick<Beat, 'start' | 'end'>) => {
  const mid = (word.start + word.end) / 2;
  return mid >= beat.start - 1e-6 && mid <= beat.end + 1e-6;
};

/** Laughter, fillers and bare punctuation after the joke do not count as its last word. */
const TRAILING = /^(ha)+$|^(he)+$|^(hm+|um+|uh+|ah+|haha\w*|lol)$|^\p{P}+$/u;

/**
 * When a punchline lands: the end of the beat's last real word (a meme cuts in 0–100 ms after
 * it). Falls back to `punchAt` or the beat's end when no word is known.
 */
export function punchlineEnd(beat: Pick<Beat, 'start' | 'end'> & { punchAt?: number }, words: Word[]): number {
  const inside = words.filter((word) => inBeat(word, beat) && word.text.trim());
  const spoken = inside.filter((word) => !TRAILING.test(foldWord(word.text) || word.text.trim()));
  const last = (spoken.length ? spoken : inside).reduce<Word | null>((best, word) => (!best || word.end > best.end ? word : best), null);
  return last ? last.end : beat.punchAt ?? beat.end;
}

// ─── Validation ───────────────────────────────────────────────────────────────────────────────

const INTENT_ALIASES: Record<string, ComicIntent> = { 'fake sad': 'fake-sad', fakesad: 'fake-sad', 'plot twist': 'plot-twist', plottwist: 'plot-twist', hypocrite: 'hypocrisy', cheat: 'cheating', lying: 'lie', liar: 'lie', proudly: 'proud', fear: 'scared', angry: 'rage', anger: 'rage', surprise: 'shock', shocked: 'shock', confused: 'confusion', goodbye: 'bye', rich: 'money' };

function intentOf(value: unknown): ComicIntent | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  if ((COMIC_INTENTS as readonly string[]).includes(key)) return key as ComicIntent;
  return INTENT_ALIASES[key] ?? INTENT_ALIASES[key.replace(/-/g, ' ')];
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()) : []);
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Checks and tidies a beat sheet the model wrote: beats sorted by start, overlaps trimmed, ids
 * unique, kinds and intents from the fixed vocabularies. With `words` (timeline times) it also
 * fills `punchAt` on punchlines, the profanity spans (adding the `profanity` kind) and the echo
 * words when the model left them out. Errors mean a beat was unusable and was dropped.
 */
export function normalizeBeatSheet(input: { beats?: unknown } | unknown[], compId: string, words: Word[] = []): BeatSheetCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = Array.isArray(input) ? input : Array.isArray((input as { beats?: unknown })?.beats) ? ((input as { beats: unknown[] }).beats) : [];
  if (!raw.length) errors.push('The beat sheet has no beats.');
  const beats: Beat[] = [];
  raw.forEach((entry, index) => {
    const label = `beat ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${label} is not an object.`);
      return;
    }
    const value = entry as Record<string, unknown>;
    if (!finite(value.start) || !finite(value.end) || value.end <= value.start || value.start < 0) {
      errors.push(`${label} needs start < end in timeline seconds (got ${String(value.start)}–${String(value.end)}).`);
      return;
    }
    const kinds = strings(value.kinds ?? value.kind).map((kind) => kind.toLowerCase()) as BeatKind[];
    const known = kinds.filter((kind) => BEAT_KINDS.includes(kind));
    if (known.length < kinds.length) warnings.push(`${label}: dropped unknown kind(s) ${kinds.filter((kind) => !BEAT_KINDS.includes(kind)).join(', ')}.`);
    const intent = intentOf(value.intent);
    if (value.intent !== undefined && value.intent !== null && !intent) warnings.push(`${label}: intent "${String(value.intent)}" is not one of the comic intents; dropped.`);
    const beat: Beat = {
      id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : '',
      start: round(value.start),
      end: round(value.end),
      text: typeof value.text === 'string' ? value.text.trim() : '',
      kinds: [...new Set(known.length ? known : (['filler'] as BeatKind[]))],
    };
    if (!known.length) warnings.push(`${label}: no known kind; marked filler.`);
    if (intent) beat.intent = intent;
    const entities = strings(value.entities);
    if (entities.length) beat.entities = [...new Set(entities)];
    const echo = strings(value.echo);
    if (echo.length) beat.echo = [...new Set(echo)];
    if (finite(value.punchAt)) beat.punchAt = round(value.punchAt);
    if (Array.isArray(value.profanity)) {
      const spans = (value.profanity as unknown[]).filter((span): span is TimedSpan & { word: string } => !!span && typeof span === 'object' && finite((span as TimedSpan).start) && finite((span as TimedSpan).end) && (span as TimedSpan).end > (span as TimedSpan).start)
        .map((span) => ({ start: round(span.start), end: round(span.end), word: typeof span.word === 'string' ? span.word : '' }));
      if (spans.length) beat.profanity = spans;
    }
    if (typeof value.notes === 'string' && value.notes.trim()) beat.notes = value.notes.trim();
    beats.push(beat);
  });

  beats.sort((a, b) => a.start - b.start || a.end - b.end);
  // Overlaps: the earlier beat gives way, as an overwrite edit would; one buried entirely goes.
  const kept: Beat[] = [];
  for (const beat of beats) {
    const previous = kept[kept.length - 1];
    if (previous && beat.start < previous.end - 1e-6) {
      if (beat.start - previous.start < 0.05) {
        warnings.push(`Beat "${beat.text.slice(0, 40) || beat.id || beat.start}" starts where another does; merged into it.`);
        previous.end = Math.max(previous.end, beat.end);
        previous.kinds = [...new Set([...previous.kinds, ...beat.kinds])].filter((kind, _, all) => kind !== 'filler' || all.length === 1);
        previous.text = [previous.text, beat.text].filter(Boolean).join(' ');
        continue;
      }
      warnings.push(`Beats at ${previous.start}s and ${beat.start}s overlap; the first now ends at ${beat.start}s.`);
      previous.end = beat.start;
    }
    kept.push(beat);
  }

  const used = new Set<string>();
  kept.forEach((beat, index) => {
    let id = beat.id || `b${index + 1}`;
    if (used.has(id)) {
      const base = id;
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
      warnings.push(`Duplicate beat id "${base}" renamed to "${id}".`);
    }
    used.add(id);
    beat.id = id;
  });

  if (words.length) {
    for (const beat of kept) {
      const spoken = words.filter((word) => inBeat(word, beat));
      if (!beat.text && spoken.length) beat.text = spoken.map((word) => word.text.trim()).join(' ');
      if (beat.kinds.includes('punchline') && beat.punchAt === undefined) beat.punchAt = round(punchlineEnd(beat, words));
      if (!beat.profanity) {
        const profane = profanityIn(spoken);
        if (profane.length) beat.profanity = profane.map((span) => ({ ...span, start: round(span.start), end: round(span.end) }));
      }
    }
  }
  for (const beat of kept) {
    if (beat.profanity?.length && !beat.kinds.includes('profanity')) beat.kinds = [...beat.kinds.filter((kind) => kind !== 'filler'), 'profanity'];
    if (!beat.echo && beat.text && (beat.kinds.includes('punchline') || beat.kinds.includes('setup') || beat.kinds.includes('reference'))) {
      const echo = echoCandidates(beat.text);
      if (echo.length) beat.echo = echo.slice(0, 8);
    }
    if (beat.punchAt !== undefined && (beat.punchAt < beat.start - 0.5 || beat.punchAt > beat.end + 0.5)) {
      warnings.push(`Beat ${beat.id}: punchAt ${beat.punchAt}s is outside the beat (${beat.start}–${beat.end}s).`);
    }
  }
  return { sheet: { version: 1, compId, beats: kept }, errors, warnings };
}

/** Counts of beats by kind, for summaries. */
export function beatCounts(sheet: BeatSheet): Partial<Record<BeatKind, number>> {
  const counts: Partial<Record<BeatKind, number>> = {};
  for (const beat of sheet.beats) for (const kind of beat.kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}
