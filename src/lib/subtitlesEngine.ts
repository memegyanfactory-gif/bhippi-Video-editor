// WatchFIWN subtitle generation & cue management engine for Bhippi.
// Integrates transcription, cue chunking algorithms, and layer positioning from WatchFIWN.
import { addTracks, audible, clipEnd, newClip, textSource, tracksOf } from './timeline';
import type { TranscriptWord } from './ipc';
import type { Asset, Clip, Comp, Track } from './types';

export const SUBTITLE_LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['hi', 'Hindi (हिंदी)'],
  ['hinglish', 'Hinglish (Hindi in English script)'],
  ['es', 'Spanish (Español)'],
  ['fr', 'French (Français)'],
  ['de', 'German (Deutsch)'],
  ['pt', 'Portuguese (Português)'],
  ['it', 'Italian (Italiano)'],
  ['nl', 'Dutch (Nederlands)'],
  ['ru', 'Russian (Русский)'],
  ['ja', 'Japanese (日本語)'],
  ['ko', 'Korean (한국어)'],
  ['zh-CN', 'Chinese (Simplified 简体中文)'],
  ['zh-TW', 'Chinese (Traditional 繁體中文)'],
  ['ar', 'Arabic (العربية)'],
  ['tr', 'Turkish (Türkçe)'],
  ['pl', 'Polish (Polski)'],
  ['uk', 'Ukrainian (Українська)'],
  ['vi', 'Vietnamese (Tiếng Việt)'],
  ['th', 'Thai (ไทย)'],
  ['id', 'Indonesian (Bahasa Indonesia)'],
  ['ms', 'Malay (Bahasa Melayu)'],
  ['fil', 'Filipino (Tagalog)'],
  ['sv', 'Swedish (Svenska)'],
  ['no', 'Norwegian (Norsk)'],
  ['da', 'Danish (Dansk)'],
  ['fi', 'Finnish (Suomi)'],
  ['cs', 'Czech (Čeština)'],
  ['el', 'Greek (Ελληνικά)'],
  ['he', 'Hebrew (עברית)'],
  ['ro', 'Romanian (Română)'],
  ['hu', 'Hungarian (Magyar)'],
  ['bg', 'Bulgarian (Български)'],
  ['bn', 'Bengali (বাংলা)'],
  ['ta', 'Tamil (தமிழ்)'],
  ['te', 'Telugu (తెలుగు)'],
  ['mr', 'Marathi (मराठी)'],
  ['gu', 'Gujarati (ગુજરાતી)'],
  ['kn', 'Kannada (ಕನ್ನಡ)'],
  ['ml', 'Malayalam (മലയാളം)'],
  ['pa', 'Punjabi (ਪੰਜਾਬੀ)'],
  ['ur', 'Urdu (اردو)'],
  ['fa', 'Persian (فارسی)'],
  ['sw', 'Swahili (Kiswahili)'],
  ['af', 'Afrikaans'],
  ['ca', 'Catalan (Català)'],
  ['hr', 'Croatian (Hrvatski)'],
  ['sk', 'Slovak (Slovenčina)'],
  ['sl', 'Slovenian (Slovenščina)'],
  ['sr', 'Serbian (Српски)'],
  ['lt', 'Lithuanian (Lietuvių)'],
  ['lv', 'Latvian (Latviešu)'],
  ['et', 'Estonian (Eesti)'],
];

export const POPULAR_SUBTITLE_LANGS = ['en', 'hi', 'hinglish', 'es', 'te', 'ta', 'ar', 'zh-CN', 'pt', 'fr', 'de', 'ja'];

export const subtitleLangLabel = (code: string) => {
  const hit = SUBTITLE_LANGUAGES.find(([c]) => c === code || c.split('-')[0] === String(code).split('-')[0]);
  return hit ? hit[1] : code;
};

export type TimedWord = {
  start: number;
  end: number;
  word: string;
  /** The file it was spoken in and its source seconds (wordsOnTimeline). */
  origin?: { assetId: string; start: number; end: number };
};

export type SubtitleCue = {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
};

// WatchFIWN chunking thresholds
const MAX_CHARS = 42;
const MAX_DUR = 4.8;
const GAP_BREAK = 0.65;

/** How long a caption would like to be on screen, and the shortest one worth keeping. */
const MIN_CUE_SECONDS = 0.2;
const MIN_CUE_GAP = 0.04;

const uid = () => `cue-${Math.random().toString(36).slice(2, 9)}`;

function appendWord(line: string, word: string): string {
  if (!line) return word;
  // Preserve the transcriber’s wording while keeping punctuation attached to its word.
  if (/^[,.;:!?%…)}\]}]/.test(word) || /^['’]/.test(word)) return line + word;
  if (/^[({\[]$/.test(word)) return line + word; // eslint-disable-line no-useless-escape -- \[ is escaped for clarity inside the character class
  return `${line} ${word}`;
}

/**
 * When each word a cue shows starts, in seconds from the cue's start, so karaoke highlights land
 * on the word being said. Punctuation the transcriber split off is glued to its word (as
 * `appendWord` shows it) and shares that word's time. Null when the words cannot be matched up.
 */
export function cueWordOffsets(cue: SubtitleCue): number[] | null {
  if (!cue.words?.length) return null;
  const offsets: number[] = [];
  let line = '';
  for (const word of cue.words) {
    const next = appendWord(line, word.word);
    if (!line || next !== line + word.word) offsets.push(Math.round(Math.max(0, word.start - cue.start) * 1000) / 1000);
    line = next;
  }
  return offsets.length === cue.text.split(/\s+/).filter(Boolean).length ? offsets : null;
}

/** When each word a cue shows ends, in seconds from the cue's start (glued punctuation extends its word). */
export function cueWordEnds(cue: SubtitleCue): number[] | null {
  if (!cue.words?.length) return null;
  const ends: number[] = [];
  let line = '';
  for (const word of cue.words) {
    const next = appendWord(line, word.word);
    const offset = Math.round(Math.max(0, word.end - cue.start) * 1000) / 1000;
    if (!line || next !== line + word.word) ends.push(offset);
    else ends[ends.length - 1] = Math.max(ends[ends.length - 1], offset);
    line = next;
  }
  return ends.length === cue.text.split(/\s+/).filter(Boolean).length ? ends : null;
}

/**
 * Builds balanced, reader-friendly subtitle cues from word timestamps
 * using WatchFIWN's chunking algorithm.
 */
export function buildWatchfiwnCues(words: TimedWord[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cur: SubtitleCue | null = null;

  for (const w of words) {
    const active = cur;
    const startNew =
      !active ||
      active.text.length + w.word.length + 1 > MAX_CHARS ||
      ((active.words?.length ?? 0) >= 7) ||
      w.start - active.end > GAP_BREAK ||
      w.end - active.start > MAX_DUR ||
      /[.!?।]$/.test(active.text);

    if (startNew) {
      if (cur) cues.push(cur);
      cur = {
        id: uid(),
        start: w.start,
        end: w.end,
        text: w.word,
        words: [{ ...w }],
      };
    } else if (cur) {
      cur.text = appendWord(cur.text, w.word);
      cur.end = w.end;
      cur.words = cur.words ? [...cur.words, { ...w }] : [{ ...w }];
    }
  }

  if (cur) cues.push(cur);
  return cues;
}

/**
 * Generates natural subtitle cues spanning sequence audio/video clips.
 * If audio contains dialogue or markers, uses them; otherwise generates synchronized,
 * well-timed speech blocks across the composition's clips.
 */
/**
 * Lays an asset's transcript onto the timeline.
 *
 * A transcript is in *source* time, so each clip that shows part of that source contributes the
 * words inside its own range, shifted to where the clip sits and divided by its speed. That is
 * what makes captions survive cutting: razor the footage and the words follow their pictures, and
 * a clip used twice is captioned twice.
 */
export function wordsOnTimeline(
  comp: Comp,
  assets: Map<string, Asset>,
  transcripts: Map<string, TranscriptWord[]>,
): TimedWord[] {
  const out: TimedWord[] = [];
  const placed = new Set<string>();
  const hasAudioClips = comp.clips.some(clip => clip.source.type === 'media' && comp.tracks.some(track => track.id === clip.trackId && track.kind === 'audio'));
  for (const clip of comp.clips) {
    if (!clip.enabled || clip.hold !== null || clip.source.type !== 'media') continue;
    const track = comp.tracks.find((item) => item.id === clip.trackId);
    // The audible side of a linked pair supplies the words. Preserve legacy video-only
    // compositions, but never caption a muted audio partner via its video duplicate.
    if (!track || (hasAudioClips ? track.kind !== 'audio' || !audible(comp, track) : track.kind !== 'video' || track.muted || track.hidden)) continue;
    const asset = assets.get(clip.source.assetId);
    const words = transcripts.get(clip.source.assetId);
    if (!asset || !words?.length) continue;

    const speed = clip.speed || 1;
    const sourceStart = clip.in;
    const sourceEnd = clip.in + clip.duration * speed;
    const recent: { text: string; start: number; end: number }[] = [];
    for (const word of [...words].sort((a, b) => a.start - b.start || a.end - b.end)) {
      const clean = word.text.trim().replace(/\s+/g, ' ');
      if (!clean || !Number.isFinite(word.start) || !Number.isFinite(word.end)) continue;
      // Some providers occasionally return the same token twice at the same timestamp.
      // Keep genuinely repeated speech, but collapse an exact replay within one frame.
      if (word.end <= word.start) continue;
      while (recent.length && recent[0].end < word.start - 0.08) recent.shift();
      const duplicate = recent.some(prior => prior.text === clean.toLocaleLowerCase()
        && Math.abs(prior.start - word.start) < 0.08 && Math.abs(prior.end - word.end) < 0.08
        && (Math.min(prior.end, word.end) - Math.max(prior.start, word.start)) / Math.min(prior.end - prior.start, word.end - word.start) > 0.8);
      if (duplicate) continue;
      recent.push({ text: clean.toLocaleLowerCase(), start: word.start, end: word.end });
      const middle = (word.start + word.end) / 2;
      if (middle < sourceStart || middle >= sourceEnd) continue;
      const at = clip.start + (word.start - sourceStart) / speed;
      const until = clip.start + (word.end - sourceStart) / speed;
      const identity = JSON.stringify([asset.id, clean, word.start, word.end, Math.round(at * 1000)]);
      if (placed.has(identity)) continue;
      placed.add(identity);
      out.push({
        word: clean,
        start: Math.max(clip.start, Math.round(at * 1000) / 1000),
        end: Math.min(clipEnd(clip), Math.max(at + 0.04, Math.round(until * 1000) / 1000)),
        origin: { assetId: asset.id, start: word.start, end: word.end },
      });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Every distinct asset the comp gets sound from — what needs transcribing, once each. */
export function assetsToTranscribe(comp: Comp, assets: Map<string, Asset>): Asset[] {
  const seen = new Map<string, Asset>();
  const hasAudioClips = comp.clips.some(clip => clip.source.type === 'media' && comp.tracks.some(track => track.id === clip.trackId && track.kind === 'audio'));
  for (const clip of comp.clips) {
    if (!clip.enabled || clip.source.type !== 'media') continue;
    const track = comp.tracks.find((item) => item.id === clip.trackId);
    if (!track || (hasAudioClips ? track.kind !== 'audio' || !audible(comp, track) : track.muted || track.hidden)) continue;
    const asset = assets.get(clip.source.assetId);
    if (asset && asset.hasAudio && !asset.missing) seen.set(asset.id, asset);
  }
  return [...seen.values()];
}

/**
 * Finds or inserts the topmost video track in the composition so subtitles
 * render reliably above all video footage, adjustment layers, and effects.
 */
export function ensureTopSubtitleTrack(comp: Comp): { comp: Comp; track: Track } {
  const videoTracks = tracksOf(comp, 'video');

  // Look for existing track dedicated to subtitles
  const existing = videoTracks.find(
    (t) => t.name.toLowerCase().includes('subtitle') || t.name.toLowerCase().includes('caption'),
  );

  if (existing) {
    return { comp, track: existing };
  }

  const newTrackName = `V${videoTracks.length + 1} Subtitles`;
  const { comp: next } = addTracks(comp, 'video', 1);
  const created = tracksOf(next, 'video').slice(-1)[0] ?? next.tracks[0];
  created.name = newTrackName;

  return { comp: next, track: created };
}

export type GenerateSubtitlesResult = {
  comp: Comp;
  track: Track;
  count: number;
  cues: SubtitleCue[];
};

/**
 * Puts a set of cues on a caption track at the top of the comp, in the chosen WatchFIWN style,
 * replacing whatever was on that track before.
 */
export function generateProjectSubtitles(
  comp: Comp,
  options: {
    styleId?: string | null;
    customCues?: SubtitleCue[];
  } = {},
): GenerateSubtitlesResult {
  const { styleId = null, customCues } = options;

  // Captions must be what was actually said. Cues come from a transcript (or an imported .SRT);
  // with none, the caller is told so rather than handed invented lines.
  const cues = customCues ?? [];

  // 2. Ensure top subtitle track
  const { comp: withTrack, track: subTrack } = ensureTopSubtitleTrack(comp);

  // 3. Clear old captions from this subtitle track if regenerating
  const cleanedClips = withTrack.clips.filter((clip) => clip.trackId !== subTrack.id);

  // 4. One clip per cue, and no cue may run into the one after it.
  //
  // Two clips overlapping on a track is a broken comp, and the backend then refuses to save
  // the *whole project* — one bad caption used to cost every later autosave. The old
  // `Math.max(0.2, …)` was the cause: a word shorter than 0.2 s was padded out past the next
  // cue's start. The floor is still applied, but only as far as there is room for it.
  const ordered = [...cues].sort((a, b) => a.start - b.start);
  const newClips: Clip[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const cue = ordered[index];
    const next = ordered[index + 1];
    const wanted = Math.max(MIN_CUE_SECONDS, cue.end - cue.start);
    const room = next ? Math.max(0, next.start - cue.start) : Number.POSITIVE_INFINITY;
    const duration = Math.min(wanted, room);
    // Two cues that start at the same moment: the second one wins, as the later edit does.
    if (duration < MIN_CUE_GAP) continue;
    newClips.push(
      newClip({
        trackId: subTrack.id,
        start: cue.start,
        duration,
        source: textSource('caption', {
          text: cue.text,
          style: styleId ?? undefined,
          words: cueWordOffsets(cue),
          wordEnds: cueWordEnds(cue),
        }),
      }),
    );
  }

  const updatedComp: Comp = {
    ...withTrack,
    clips: [...cleanedClips, ...newClips],
  };

  return {
    comp: updatedComp,
    track: subTrack,
    count: newClips.length,
    cues,
  };
}

/**
 * Updates all subtitle / caption clips in a composition to use the selected WatchFIWN style.
 */
export function applyStyleToAllCaptions(comp: Comp, styleId: string): Comp {
  return {
    ...comp,
    clips: comp.clips.map((clip) => {
      if (clip.source.type === 'text' && clip.source.preset === 'caption') {
        return {
          ...clip,
          source: {
            ...clip.source,
            style: styleId,
          },
        };
      }
      return clip;
    }),
  };
}
