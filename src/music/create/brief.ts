// The song brief: what a person (or a model) asks for — a description, a genre, vocals or not,
// lyrics, a length, maybe a voice-over to sit under — turned into what each music model was
// trained to read. ACE-Step 1.5 wants a caption of style tags (genre, mood, instruments, timbre,
// production; BPM and key go in their own fields, never in the caption) and lyrics with section
// tags; ElevenLabs, MiniMax and Lyria read prose. The section plan is timed in bars at the chosen
// tempo, so a song made for a video lands its build and its lift where the edit needs them.
import { describeVoice, moodOfText, MOODS, type Mood, type VoiceBrief } from './voice';

export type Vocals = 'none' | 'female' | 'male' | 'duet' | 'auto';
/** `song`: a finished track with its own melody (and vocals when asked). `score`: a bed under a voice-over. */
export type SongPurpose = 'song' | 'score';

export type Genre = {
  id: string;
  name: string;
  /** Caption tags in ACE-Step's vocabulary; the cloud prompts read them too. */
  tags: string[];
  bpm: [number, number];
  minor: boolean;
  /** The voice a sung version gets when the request does not say. */
  voice: 'female' | 'male';
  /** The studio template for the offline engine. */
  template: string;
};

export const GENRES: Genre[] = [
  { id: 'pop', name: 'Pop', tags: ['modern pop', 'catchy hook', 'bright synths', 'punchy drums', 'polished production'], bpm: [100, 120], minor: false, voice: 'female', template: 'pop' },
  { id: 'edm', name: 'EDM', tags: ['edm', 'festival', 'supersaw leads', 'sidechained pads', 'big build-up', 'euphoric drop'], bpm: [124, 128], minor: true, voice: 'female', template: 'house' },
  { id: 'house', name: 'House', tags: ['deep house', 'four-on-the-floor', 'groovy bassline', 'warm chords', 'club mix'], bpm: [120, 126], minor: true, voice: 'female', template: 'house' },
  { id: 'hiphop', name: 'Hip-hop', tags: ['hip-hop', 'boom bap', 'dusty drums', 'sampled keys', 'deep bass'], bpm: [86, 96], minor: true, voice: 'male', template: 'beat' },
  { id: 'trap', name: 'Trap', tags: ['trap', 'hard 808', 'rolling hi-hats', 'dark bells', 'heavy low end'], bpm: [136, 150], minor: true, voice: 'male', template: 'trap' },
  { id: 'phonk', name: 'Phonk', tags: ['drift phonk', 'cowbell melody', 'distorted 808', 'memphis vocal chops', 'aggressive'], bpm: [130, 145], minor: true, voice: 'male', template: 'trap' },
  { id: 'lofi', name: 'Lo-fi', tags: ['lofi hip hop', 'jazzy chords', 'vinyl crackle', 'mellow', 'soft drums', 'tape saturation'], bpm: [72, 88], minor: false, voice: 'female', template: 'lofi' },
  { id: 'rnb', name: 'R&B', tags: ['contemporary r&b', 'smooth', 'lush keys', 'groovy bass', 'silky'], bpm: [70, 95], minor: true, voice: 'female', template: 'lofi' },
  { id: 'rock', name: 'Rock', tags: ['rock', 'electric guitars', 'driving drums', 'bass guitar', 'energetic', 'live band'], bpm: [110, 140], minor: false, voice: 'male', template: 'pop' },
  { id: 'indie', name: 'Indie folk', tags: ['indie folk', 'acoustic guitar', 'warm', 'organic', 'handclaps', 'heartfelt'], bpm: [90, 115], minor: false, voice: 'female', template: 'corporate' },
  { id: 'cinematic', name: 'Cinematic', tags: ['cinematic orchestral', 'strings', 'french horns', 'epic percussion', 'emotional build', 'film score'], bpm: [70, 100], minor: true, voice: 'female', template: 'cinematic' },
  { id: 'trailer', name: 'Epic trailer', tags: ['epic trailer music', 'hybrid orchestral', 'taiko drums', 'braams', 'choir', 'massive impacts'], bpm: [80, 100], minor: true, voice: 'female', template: 'cinematic' },
  { id: 'corporate', name: 'Corporate', tags: ['uplifting corporate', 'bright piano', 'plucked synths', 'light drums', 'positive', 'clean mix'], bpm: [100, 118], minor: false, voice: 'female', template: 'corporate' },
  { id: 'ambient', name: 'Ambient', tags: ['ambient', 'atmospheric pads', 'evolving textures', 'soft piano', 'spacious reverb'], bpm: [60, 80], minor: false, voice: 'female', template: 'ambient' },
  { id: 'synthwave', name: 'Synthwave', tags: ['synthwave', 'retro 80s', 'analog synths', 'gated reverb drums', 'neon', 'nostalgic'], bpm: [95, 115], minor: true, voice: 'male', template: 'pop' },
  { id: 'afrobeats', name: 'Afrobeats', tags: ['afrobeats', 'afro-pop', 'log drums', 'shakers', 'syncopated percussion', 'sunny guitar'], bpm: [100, 112], minor: false, voice: 'male', template: 'afrobeats' },
  { id: 'reggaeton', name: 'Reggaeton', tags: ['reggaeton', 'dembow rhythm', 'latin pop', 'warm synths', 'perreo'], bpm: [88, 98], minor: true, voice: 'male', template: 'afrobeats' },
  { id: 'desi', name: 'Desi pop', tags: ['indian pop', 'bollywood', 'tabla', 'sitar', 'dhol', 'modern production'], bpm: [90, 110], minor: true, voice: 'female', template: 'pop' },
  { id: 'jazz', name: 'Jazz', tags: ['smooth jazz', 'upright bass', 'brushed drums', 'jazz piano', 'saxophone'], bpm: [80, 130], minor: false, voice: 'female', template: 'lofi' },
  { id: 'piano', name: 'Piano ballad', tags: ['piano ballad', 'emotional', 'grand piano', 'soft strings', 'intimate'], bpm: [64, 80], minor: false, voice: 'female', template: 'ambient' },
  { id: 'dnb', name: 'Drum & bass', tags: ['drum and bass', 'liquid dnb', 'breakbeats', 'reese bass', 'atmospheric'], bpm: [170, 176], minor: true, voice: 'female', template: 'dnb' },
  { id: 'techno', name: 'Techno', tags: ['techno', 'driving kick', 'hypnotic', 'acid synth', 'dark warehouse'], bpm: [128, 136], minor: true, voice: 'male', template: 'techno' },
  { id: 'country', name: 'Country', tags: ['modern country', 'acoustic and electric guitars', 'pedal steel', 'storytelling', 'warm'], bpm: [90, 120], minor: false, voice: 'male', template: 'corporate' },
  { id: 'kids', name: 'Playful', tags: ['playful', 'quirky', 'pizzicato strings', 'ukulele', 'glockenspiel', 'whistling', 'fun'], bpm: [110, 125], minor: false, voice: 'female', template: 'corporate' },
];
export const GENRE_MAP = new Map(GENRES.map((g) => [g.id, g]));

/** A genre named in free text ("a sad lofi beat with rain" → lofi). */
export function genreInText(text: string): Genre | null {
  const lower = text.toLowerCase();
  const words: [RegExp, string][] = [
    [/\blo-?fi\b/, 'lofi'], [/\bphonk\b/, 'phonk'], [/\btrap\b/, 'trap'], [/\bdrill\b/, 'trap'], [/\bhip[- ]?hop\b|\brap\b|\bboom[- ]?bap\b/, 'hiphop'], [/\br&b\b|\brnb\b/, 'rnb'],
    [/\bedm\b|\bfestival\b|\bdubstep\b/, 'edm'], [/\bhouse\b/, 'house'], [/\btechno\b/, 'techno'], [/\bdnb\b|drum (and|&|n) bass/, 'dnb'], [/\bsynthwave\b|\bretrowave\b|\b80s\b/, 'synthwave'],
    [/\btrailer\b|\bepic\b/, 'trailer'], [/\bcinematic\b|\borchestra|\bfilm score\b/, 'cinematic'], [/\bcorporate\b|\bexplainer\b|\bpresentation\b/, 'corporate'],
    [/\bambient\b|\bmeditat|\bchill ?out\b/, 'ambient'], [/\bafro/, 'afrobeats'], [/\breggaeton\b|\blatin\b/, 'reggaeton'], [/\bbollywood\b|\bdesi\b|\bhindi\b|\bpunjabi\b|\bindian\b/, 'desi'],
    [/\bjazz/, 'jazz'], [/\bpiano\b|\bballad\b/, 'piano'], [/\bcountry\b/, 'country'], [/\brock\b|\bguitar band\b|\bpunk\b|\bmetal\b/, 'rock'], [/\bfolk\b|\bacoustic\b|\bindie\b/, 'indie'],
    [/\bkids\b|\bplayful\b|\bquirky\b|\bcartoon\b/, 'kids'], [/\bpop\b/, 'pop'],
  ];
  for (const [re, id] of words) if (re.test(lower)) return GENRE_MAP.get(id) ?? null;
  return null;
}

const MOOD_TAGS: Record<Mood, string[]> = {
  uplifting: ['uplifting', 'happy', 'bright'], inspiring: ['inspiring', 'hopeful', 'building'], corporate: ['confident', 'positive', 'modern'], tech: ['futuristic', 'clean', 'innovative'],
  calm: ['calm', 'relaxing', 'gentle'], warm: ['warm', 'heartfelt', 'intimate'], sad: ['melancholic', 'sad', 'reflective'], tense: ['tense', 'suspenseful', 'urgent'],
  dark: ['dark', 'ominous', 'brooding'], mysterious: ['mysterious', 'curious', 'intriguing'], playful: ['playful', 'cheeky', 'bouncy'], energetic: ['energetic', 'driving', 'hype'],
  epic: ['epic', 'powerful', 'triumphant'], romantic: ['romantic', 'tender', 'dreamy'],
};

/** What a bed under narration must be, from the voice-over research: instrumental, room in the voice's band, no lead. */
const SCORE_TAGS = ['instrumental', 'background music', 'underscore', 'sparse arrangement', 'no vocals', 'subtle melody', 'leaves room for voice-over'];
const SCORE_AVOID = ['vocals', 'singing', 'busy lead melody', 'harsh high end', 'loud solos'];
const PRODUCTION_TAGS = ['professionally mixed and mastered', 'high fidelity', 'wide stereo'];

export type SongRequest = {
  /** The person's own words: what the song is, any details. */
  prompt: string;
  genre?: string;
  mood?: string;
  vocals?: Vocals;
  /** Lyrics to sing; untagged stanzas get [Verse] / [Chorus] tags. */
  lyrics?: string;
  /** ISO code of the lyrics' language (en, hi, es…). */
  language?: string;
  seconds?: number;
  bpm?: number;
  /** "A minor", "C# major". */
  key?: string;
  purpose?: SongPurpose;
  /** The voice-over this must support, from voiceBrief. */
  voice?: VoiceBrief | null;
  /** Where the music starts on the timeline (so the voice's times can be read in song time). */
  start?: number;
  title?: string;
};

export type Section = {
  /** ACE-Step's tag word: Intro, Verse, Pre-Chorus, Chorus, Bridge, Build, Breakdown, Outro. */
  name: string;
  /** A short modifier for the tag ("soft piano", "full band"). */
  feel: string;
  start: number;
  seconds: number;
  bars: number;
  /** Lyrics lines sung in it (none for an instrumental). */
  lines: string[];
};

export type SongBrief = {
  title: string;
  purpose: SongPurpose;
  instrumental: boolean;
  vocals: Exclude<Vocals, 'auto'>;
  genre: Genre;
  mood: Mood;
  /** Caption tags for ACE-Step (comma-joined), also the backbone of the prose prompts. */
  tags: string[];
  avoid: string[];
  bpm: number;
  keyscale: string;
  seconds: number;
  language: string;
  sections: Section[];
  /** The lyrics as sent to a model that sings them (section tags, one line per sung line). */
  lyrics: string;
  /** True when lyrics were given; false lets a model that can write its own do so. */
  hasLyrics: boolean;
  /** One line on what the voice-over asked for, when there was one. */
  voiceNote: string | null;
};

const KEYSCALE = /^([A-G])([#b]?)\s*(major|minor|maj|min|m)?$/i;
const MAJOR_KEYS = ['C major', 'G major', 'D major', 'F major', 'A major', 'E major', 'Bb major', 'Eb major'];
const MINOR_KEYS = ['A minor', 'E minor', 'D minor', 'C minor', 'G minor', 'F# minor', 'B minor', 'F minor'];

/** "am", "C#", "Bb minor" → "A minor", "C# major", "Bb minor"; null when it is not a key. */
export function normalizeKey(key: string | undefined): string | null {
  const match = KEYSCALE.exec((key ?? '').trim());
  if (!match) return null;
  const quality = (match[3] ?? 'major').toLowerCase();
  return `${match[1].toUpperCase()}${match[2]} ${quality === 'minor' || quality === 'min' || quality === 'm' ? 'minor' : 'major'}`;
}

const hash = (s: string): number => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const unique = (list: string[]) => [...new Set(list.map((t) => t.trim()).filter(Boolean))];

/** Stanzas tagged the way ACE-Step and MiniMax read them: a stanza that repeats is the chorus. */
export function tagLyrics(lyrics: string): string {
  const text = lyrics.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (/^\s*\[[^\]]+\]\s*$/m.test(text)) return text;
  const stanzas = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const s of stanzas) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1);
  let verse = 0;
  return stanzas.map((s, i) => {
    const repeated = (counts.get(s.toLowerCase()) ?? 0) > 1;
    if (repeated) return `[Chorus]\n${s}`;
    if (stanzas.length >= 3 && i === stanzas.length - 1 && verse >= 2) return `[Bridge]\n${s}`;
    verse++;
    return `[Verse]\n${s}`;
  }).join('\n\n');
}

/** Section lines from tagged lyrics: [{name, lines}]. */
function lyricBlocks(tagged: string): { name: string; lines: string[] }[] {
  const blocks: { name: string; lines: string[] }[] = [];
  for (const raw of tagged.split('\n')) {
    const line = raw.trim();
    const tag = /^\[([^\]]+)\]$/.exec(line);
    if (tag) blocks.push({ name: tag[1].split(/\s*[-:]\s*/)[0].trim(), lines: [] });
    else if (line) (blocks.at(-1) ?? (blocks.push({ name: 'Verse', lines: [] }), blocks[0])).lines.push(line);
  }
  return blocks;
}

type Shape = { name: string; feel: string; weight: number };

/** The arrangement for a length: short cues are one idea, long songs get the whole form. */
function songShape(seconds: number, instrumental: boolean): Shape[] {
  const v = instrumental ? 'main theme' : 'vocals enter';
  if (seconds <= 25) return [{ name: 'Intro', feel: 'hook teaser', weight: 1 }, { name: 'Chorus', feel: 'full energy', weight: 4 }, { name: 'Outro', feel: 'button ending', weight: 1 }];
  if (seconds <= 50) return [{ name: 'Intro', feel: 'establish groove', weight: 1 }, { name: 'Verse', feel: v, weight: 3 }, { name: 'Chorus', feel: 'full energy', weight: 3 }, { name: 'Outro', feel: 'clean ending', weight: 1 }];
  if (seconds <= 110) return [
    { name: 'Intro', feel: 'establish groove', weight: 1 }, { name: 'Verse', feel: v, weight: 2 }, { name: 'Pre-Chorus', feel: 'rising', weight: 1 }, { name: 'Chorus', feel: 'full energy', weight: 2 },
    { name: 'Verse', feel: 'variation', weight: 2 }, { name: 'Chorus', feel: 'bigger', weight: 2 }, { name: 'Outro', feel: 'clean ending', weight: 1 },
  ];
  return [
    { name: 'Intro', feel: 'establish groove', weight: 1 }, { name: 'Verse', feel: v, weight: 2 }, { name: 'Pre-Chorus', feel: 'rising', weight: 1 }, { name: 'Chorus', feel: 'full energy', weight: 2 },
    { name: 'Verse', feel: 'variation', weight: 2 }, { name: 'Pre-Chorus', feel: 'rising', weight: 1 }, { name: 'Chorus', feel: 'bigger', weight: 2 },
    { name: 'Bridge', feel: 'breakdown, stripped back', weight: 2 }, { name: 'Chorus', feel: 'final, biggest', weight: 2 }, { name: 'Outro', feel: 'clean ending', weight: 1 },
  ];
}

/**
 * A bed under a voice-over: quiet under the first words, steady and sparse while the voice talks,
 * a lift into any long pause, and the full statement after the last word (if there is room).
 */
function scoreShape(seconds: number, voice: VoiceBrief | null, start: number): { name: string; feel: string; at: number }[] {
  if (!voice) return [{ name: 'Intro', feel: 'soft, minimal', at: 0 }, { name: 'Verse', feel: 'steady, sparse, supportive', at: Math.min(8, seconds * 0.15) }, { name: 'Chorus', feel: 'fuller, still restrained', at: seconds * 0.6 }, { name: 'Outro', feel: 'gentle resolve', at: Math.max(seconds - 6, seconds * 0.88) }];
  const vs = clamp(voice.start - start, 0, seconds);
  const ve = clamp(voice.end - start, 0, seconds);
  const out: { name: string; feel: string; at: number }[] = [{ name: 'Intro', feel: vs > 3 ? 'establish mood' : 'soft, minimal', at: 0 }];
  out.push({ name: 'Verse', feel: 'steady, sparse, low register under the voice', at: Math.max(vs - 0.5, Math.min(2, seconds * 0.05)) });
  // The longest pause in the middle of the voice gets a small lift.
  const pause = [...voice.pauses].filter((p) => p.end - p.start >= 1.2).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (pause) {
    const at = pause.start - start;
    const margin = Math.min(6, (ve - vs) * 0.2);
    if (at > vs + margin && at < ve - margin) {
      out.push({ name: 'Build', feel: 'brief lift in the pause', at });
      out.push({ name: 'Verse', feel: 'settle back under the voice', at: pause.end - start - 0.3 });
    }
  }
  if (seconds - ve >= 4) out.push({ name: 'Chorus', feel: 'full statement after the voice ends', at: ve + 0.2 });
  out.push({ name: 'Outro', feel: 'gentle resolve', at: Math.max(out.at(-1)!.at + 2, seconds - Math.min(6, seconds * 0.12)) });
  return out.filter((s) => s.at < seconds - 0.5).sort((a, b) => a.at - b.at);
}

/** Snaps section edges to bars and drops sections shorter than a bar. */
function timed(plan: { name: string; feel: string; at: number; lines?: string[] }[], seconds: number, bar: number): Section[] {
  const starts = plan.map((s) => Math.round(s.at / bar) * bar);
  const out: Section[] = [];
  plan.forEach((s, i) => {
    const from = i === 0 ? 0 : starts[i];
    const to = i === plan.length - 1 ? seconds : Math.min(seconds, starts[i + 1]);
    if (to - from < bar * 0.99 && i !== plan.length - 1 && !s.lines?.length) return;
    const last = out.at(-1);
    if (last && last.start + last.seconds < from - 0.01) last.seconds = from - last.start;
    out.push({ name: s.name, feel: s.feel, start: Math.round(from * 100) / 100, seconds: Math.round(Math.max(0.5, to - from) * 100) / 100, bars: Math.max(1, Math.round((to - from) / bar)), lines: s.lines ?? [] });
  });
  return out;
}

/** The whole brief for a request. Deterministic: the same request writes the same brief. */
export function songBrief(request: SongRequest): SongBrief {
  const prompt = (request.prompt ?? '').trim();
  const voice = request.voice ?? null;
  const purpose: SongPurpose = request.purpose ?? (voice ? 'score' : 'song');
  const genre = (request.genre && (GENRE_MAP.get(request.genre) ?? genreInText(request.genre))) || genreInText(prompt) || (purpose === 'score' ? GENRE_MAP.get(voice?.mood === 'tech' ? 'synthwave' : voice?.mood === 'epic' ? 'cinematic' : voice?.mood === 'calm' || voice?.mood === 'sad' ? 'piano' : 'corporate')! : GENRE_MAP.get('pop')!);
  const moodWord = (request.mood ?? '').toLowerCase().trim();
  const mood: Mood = (MOODS as readonly string[]).includes(moodWord) ? (moodWord as Mood) : moodOfText(`${moodWord} ${prompt}`).hits ? moodOfText(`${moodWord} ${prompt}`).mood : voice?.mood ?? (genre.minor ? 'tense' : 'uplifting');
  const lyricsIn = (request.lyrics ?? '').trim();
  const wantsVocals = request.vocals && request.vocals !== 'auto' ? request.vocals !== 'none' : purpose === 'song' && (!!lyricsIn || /\b(vocal|vocals|sing|singer|sung|lyrics|rap|rapper|song about)\b/i.test(prompt)) && !/\binstrumental\b/i.test(prompt);
  const instrumental = purpose === 'score' || !wantsVocals;
  const vocals: Exclude<Vocals, 'auto'> = instrumental ? 'none' : request.vocals && request.vocals !== 'auto' && request.vocals !== 'none' ? request.vocals : /\b(male|man|guy|baritone)\b/i.test(prompt) && !/\bfemale\b/i.test(prompt) ? 'male' : /\bfemale|woman|girl\b/i.test(prompt) ? 'female' : genre.voice;

  const [lo, hi] = genre.bpm;
  const wanted = request.bpm && Number.isFinite(request.bpm) ? request.bpm : voice && purpose === 'score' ? voice.bpm : Math.round((lo + hi) / 2);
  // A bed follows the delivery but stays inside what its genre can play.
  const bpm = Math.round(clamp(wanted, request.bpm ? 50 : Math.min(lo, 60), request.bpm ? 200 : Math.max(hi, 180)));
  const seed = hash(`${prompt}|${genre.id}|${mood}`);
  const keyscale = normalizeKey(request.key) ?? (genre.minor || ['sad', 'tense', 'dark', 'mysterious', 'epic'].includes(mood) ? MINOR_KEYS : MAJOR_KEYS)[seed % 8];
  const fromVoice = voice ? Math.max(voice.end - (request.start ?? 0) + 2.5, 8) : null;
  const seconds = Math.round(clamp(request.seconds && Number.isFinite(request.seconds) ? request.seconds : fromVoice ?? (purpose === 'score' ? 60 : instrumental ? 90 : 150), 8, 600) * 10) / 10;
  const bar = (60 / bpm) * 4;

  const vocalTags = vocals === 'none' ? [] : vocals === 'duet' ? ['male and female duet vocals'] : [`${vocals === 'male' ? 'male' : 'female'} vocals`, 'clear lead vocal'];
  // Instruments and colour the person named ("with rain", "a sitar", "808s") go into the caption as they wrote them.
  const extras = prompt.split(/[,.;\n]|\bwith\b|\band\b/i).map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2 && s.length < 40 && s.split(/\s+/).length <= 5 && !/^(a|an|the|make|create|song|music|track|beat|about|for|my|i want|please|give me)\b/.test(s));
  const tags = unique([
    ...genre.tags, ...MOOD_TAGS[mood], ...extras.slice(0, 6), ...vocalTags,
    ...(purpose === 'score' ? SCORE_TAGS : instrumental ? ['instrumental'] : []), ...PRODUCTION_TAGS,
  ]).slice(0, 22);
  const avoid = purpose === 'score' ? SCORE_AVOID : instrumental ? ['vocals', 'singing'] : [];

  const tagged = instrumental ? '' : tagLyrics(lyricsIn);
  let sections: Section[];
  if (purpose === 'score') sections = timed(scoreShape(seconds, voice, request.start ?? 0), seconds, bar);
  else if (tagged) {
    // The written form decides the sections; their length is shared by the lines they hold.
    const blocks = lyricBlocks(tagged);
    const intro = blocks[0]?.name.toLowerCase() === 'intro' ? [] : [{ name: 'Intro', lines: [] as string[] }];
    const outro = blocks.at(-1)?.name.toLowerCase() === 'outro' ? [] : [{ name: 'Outro', lines: [] as string[] }];
    const all = [...intro, ...blocks, ...outro];
    const weight = (b: { lines: string[] }) => Math.max(1, b.lines.length);
    const total = all.reduce((sum, b) => sum + weight(b), 0);
    let at = 0;
    sections = timed(all.map((b) => { const s = { name: b.name, feel: '', at, lines: b.lines }; at += (weight(b) / total) * seconds; return s; }), seconds, bar);
  } else {
    const shape = songShape(seconds, instrumental);
    const total = shape.reduce((sum, s) => sum + s.weight, 0);
    let at = 0;
    sections = timed(shape.map((s) => { const out = { name: s.name, feel: s.feel, at }; at += (s.weight / total) * seconds; return out; }), seconds, bar);
  }

  const lyrics = instrumental ? '[Instrumental]' : tagged || sections.map((s) => `[${s.name}]`).join('\n\n');
  const title = (request.title ?? '').trim() || titleFrom(prompt, genre, mood);
  return {
    title, purpose, instrumental, vocals, genre, mood, tags, avoid, bpm, keyscale, seconds,
    language: (request.language ?? voice?.language ?? 'en').toLowerCase().slice(0, 3).replace(/[^a-z]/g, '') || 'en',
    sections, lyrics, hasLyrics: !!tagged, voiceNote: voice ? describeVoice(voice) : null,
  };
}

function titleFrom(prompt: string, genre: Genre, mood: Mood): string {
  const words = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^(make|create|song|music|track|beat|about|with|that|this|the|and|for|please|want|give)$/i.test(w)).slice(0, 4);
  const name = words.length ? words.join(' ') : `${mood} ${genre.name}`;
  return name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 48);
}

// ─────────────────────────────── per model ───────────────────────────────

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** ACE-Step's caption: comma-separated tags, no tempo or key (those have their own fields). */
export const aceCaption = (brief: SongBrief): string => brief.tags.join(', ');

/**
 * ACE-Step's lyrics: section tags with a short modifier ([Chorus - full energy]); a long stack of
 * tags gets sung, so one modifier each. An instrumental is the single tag [Instrumental].
 */
export function aceLyrics(brief: SongBrief): string {
  if (brief.instrumental) return '[Instrumental]';
  if (brief.hasLyrics) return brief.lyrics;
  return brief.sections.map((s) => `[${s.name}${s.feel ? ` - ${s.feel}` : ''}]`).join('\n\n');
}

/** A prose prompt for the models that read descriptions (ElevenLabs, MiniMax, Lyria), with the timed form. */
export function prosePrompt(brief: SongBrief, request: Pick<SongRequest, 'prompt'>, limit = 1900): string {
  const parts: string[] = [];
  const ask = request.prompt.trim();
  if (ask) parts.push(ask.endsWith('.') ? ask : `${ask}.`);
  parts.push(`${brief.instrumental ? 'Instrumental' : `Song with ${brief.vocals === 'duet' ? 'male and female duet' : brief.vocals} vocals`}, ${brief.genre.name.toLowerCase()}: ${brief.tags.filter((t) => t !== 'instrumental').slice(0, 12).join(', ')}.`);
  parts.push(`${brief.bpm} BPM, ${brief.keyscale}, about ${mmss(brief.seconds)} long.`);
  if (brief.purpose === 'score') parts.push('It plays under a voice-over: keep the midrange clear for the voice, no vocals, no busy lead, restrained dynamics while the narrator talks.');
  if (brief.avoid.length) parts.push(`Avoid: ${brief.avoid.join(', ')}.`);
  parts.push(`Structure: ${brief.sections.map((s) => `${mmss(s.start)} ${s.name.toLowerCase()}${s.feel ? ` (${s.feel})` : ''}`).join('; ')}.`);
  return parts.join(' ').slice(0, limit);
}

/** MiniMax and other lyric-singing models: the tagged lyrics, or nothing so the model writes its own. */
export const sungLyrics = (brief: SongBrief): string | undefined => (brief.instrumental || !brief.hasLyrics ? undefined : brief.lyrics.slice(0, 3400));

/** One line for the result: "Corporate · inspiring · 104 BPM · C major · 1:04 · instrumental". */
export const describeBrief = (brief: SongBrief): string =>
  `${brief.genre.name} · ${brief.mood} · ${brief.bpm} BPM · ${brief.keyscale} · ${mmss(brief.seconds)} · ${brief.instrumental ? 'instrumental' : `${brief.vocals} vocals`}${brief.purpose === 'score' ? ' · voice-over bed' : ''}`;
