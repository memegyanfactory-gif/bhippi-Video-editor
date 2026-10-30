// What the voice-over asks of the music. Reads the composition's speech clips (lib/cleanup.ts
// speechClips), their waveform levels (peaks) and transcripts when they are cached, and answers
// where the voice talks and pauses, how fast it speaks, what it is about and the tempo and mood a
// bed under it should have. Plain arithmetic over data Bhippi already keeps: no audio decoding.
import { speechClips } from '../../lib/cleanup';
import type { Transcript, TranscriptWord } from '../../lib/ipc';
import { BUCKETS_PER_SECOND, type Peaks } from '../../lib/peaks';
import { clipEnd, type AssetMap } from '../../lib/timeline';
import type { Comp } from '../../lib/types';

export type Range = { start: number; end: number };

export const MOODS = ['uplifting', 'inspiring', 'corporate', 'tech', 'calm', 'warm', 'sad', 'tense', 'dark', 'mysterious', 'playful', 'energetic', 'epic', 'romantic'] as const;
export type Mood = (typeof MOODS)[number];

export type VoiceBrief = {
  /** Speech clips read. */
  clips: number;
  /** Where the voice starts and ends on the timeline, seconds. */
  start: number;
  end: number;
  /** Where something is being said (word gaps under 0.35 s joined), timeline seconds. */
  speech: Range[];
  /** Breaths and beats between phrases (at least 0.6 s) inside the voice span: where music can speak. */
  pauses: Range[];
  /** Share of the voice span that is talking, 0–1. */
  talkShare: number;
  words: number;
  /** Words per minute of talking time; null without a transcript. */
  wpm: number | null;
  language: string | null;
  /** The first words of the transcript, for the brief. */
  excerpt: string;
  mood: Mood;
  /** 0–1: how driving the bed should be. */
  energy: number;
  /** A tempo that sits under this delivery. */
  bpm: number;
};

/** Gaps shorter than this between loud buckets are still one phrase. */
const JOIN_GAP = 0.35;
/** A pause the music may fill. */
const MIN_PAUSE = 0.6;
/** Quieter than this (dBFS rms) counts as not talking. */
const FLOOR_DB = -38;

/** Words of each mood (stems; matched at word starts). The mood with the most hits wins. */
const MOOD_WORDS: Record<Mood, string[]> = {
  uplifting: ['happy', 'joy', 'celebrat', 'win', 'success', 'bright', 'amazing', 'awesome', 'great', 'best', 'love it', 'excit', 'smile', 'fun', 'yay', 'congrat'],
  inspiring: ['dream', 'believe', 'journey', 'future', 'hope', 'change', 'possible', 'achiev', 'goal', 'grow', 'inspir', 'never give', 'rise', 'purpose', 'mission', 'vision'],
  corporate: ['business', 'company', 'team', 'client', 'customer', 'solution', 'service', 'product', 'brand', 'market', 'strategy', 'revenue', 'partner', 'platform', 'enterprise', 'growth'],
  tech: ['ai', 'software', 'app', 'code', 'data', 'digital', 'cloud', 'feature', 'update', 'launch', 'device', 'tech', 'algorithm', 'robot', 'automat', 'model'],
  calm: ['relax', 'breath', 'calm', 'peace', 'gentle', 'slow', 'quiet', 'meditat', 'sleep', 'rest', 'mindful', 'nature', 'soft', 'chill', 'mellow', 'lazy', 'study', 'rain'],
  warm: ['family', 'home', 'friend', 'together', 'kind', 'care', 'thank', 'community', 'cozy', 'remember', 'story', 'grandm', 'heart'],
  sad: ['sad', 'loss', 'lost', 'die', 'death', 'grief', 'miss', 'alone', 'lonely', 'tear', 'cry', 'pain', 'sorry', 'goodbye', 'tragic', 'broke'],
  tense: ['danger', 'risk', 'warn', 'threat', 'crisis', 'urgent', 'attack', 'scam', 'hack', 'problem', 'fail', 'mistake', 'crash', 'collapse', 'deadline'],
  dark: ['murder', 'crime', 'kill', 'evil', 'horror', 'blood', 'war', 'dark', 'victim', 'prison', 'corrupt', 'conspir'],
  mysterious: ['secret', 'myster', 'unknown', 'strange', 'hidden', 'discover', 'ancient', 'legend', 'theory', 'unexplain', 'weird', 'what if'],
  playful: ['funny', 'lol', 'joke', 'silly', 'crazy', 'prank', 'meme', 'weird flex', 'oops', 'haha', 'cute', 'game', 'play'],
  energetic: ['fast', 'power', 'go', 'now', 'let\'s', 'hype', 'sport', 'workout', 'run', 'speed', 'fire', 'insane', 'level up', 'beast', 'push'],
  epic: ['epic', 'legend', 'hero', 'battle', 'empire', 'history', 'king', 'conquer', 'massive', 'giant', 'ultimate', 'destiny', 'glory'],
  romantic: ['love', 'romant', 'kiss', 'wedding', 'together forever', 'darling', 'beautiful', 'heart'],
};

/** Base tempo and drive per mood; the delivery's pace moves the tempo from here. */
const MOOD_FEEL: Record<Mood, { bpm: number; energy: number }> = {
  uplifting: { bpm: 112, energy: 0.65 }, inspiring: { bpm: 100, energy: 0.55 }, corporate: { bpm: 104, energy: 0.5 }, tech: { bpm: 110, energy: 0.55 },
  calm: { bpm: 76, energy: 0.2 }, warm: { bpm: 88, energy: 0.35 }, sad: { bpm: 72, energy: 0.2 }, tense: { bpm: 96, energy: 0.6 }, dark: { bpm: 84, energy: 0.5 },
  mysterious: { bpm: 86, energy: 0.35 }, playful: { bpm: 116, energy: 0.6 }, energetic: { bpm: 124, energy: 0.85 }, epic: { bpm: 90, energy: 0.8 }, romantic: { bpm: 80, energy: 0.3 },
};

/** The mood a text reads as (corporate when nothing stands out). */
export function moodOfText(text: string): { mood: Mood; hits: number } {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: Mood = 'corporate';
  let bestHits = 0;
  for (const mood of MOODS) {
    let hits = 0;
    for (const word of MOOD_WORDS[mood]) {
      let at = lower.indexOf(` ${word}`);
      while (at >= 0) { hits++; at = lower.indexOf(` ${word}`, at + 1); }
    }
    if (hits > bestHits) { best = mood; bestHits = hits; }
  }
  return { mood: best, hits: bestHits };
}

/**
 * The tempo for a bed under speech at `wpm`. Relaxed reads (under ~130 wpm) want a slower pulse,
 * brisk explainers (170+) a faster one; the mood sets the centre, the pace moves it by up to ±14.
 */
export function bpmForDelivery(mood: Mood, wpm: number | null): number {
  const base = MOOD_FEEL[mood].bpm;
  if (wpm === null) return base;
  const shift = Math.max(-14, Math.min(14, (wpm - 150) * 0.35));
  return Math.round(base + shift);
}

const merge = (ranges: Range[], gap = 0): Range[] => {
  const out: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start - last.end <= gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
};

/** A word in a source file, on the timeline through a clip (null when the clip does not play it). */
function wordOnTimeline(word: TranscriptWord, clip: { start: number; duration: number; in: number; speed: number }): Range | null {
  const speed = clip.speed || 1;
  const start = clip.start + (word.start - clip.in) / speed;
  const end = clip.start + (word.end - clip.in) / speed;
  if (end <= clip.start || start >= clip.start + clip.duration) return null;
  return { start: Math.max(clip.start, start), end: Math.min(clip.start + clip.duration, end) };
}

/**
 * The voice-over of `comp`, or null when nothing on its audio tracks is speech. `peaksOf` gives an
 * asset's waveform levels and `transcripts` the cached transcripts by asset id; either may be
 * missing for a clip (then that clip is read from the other, or counted as talking throughout).
 */
export function voiceBrief(comp: Comp, assets: AssetMap, peaksOf: (assetId: string) => Peaks | null, transcripts: Map<string, Transcript>): VoiceBrief | null {
  const clips = speechClips(comp).filter((clip) => {
    const asset = clip.source.type === 'media' ? assets.get(clip.source.assetId) : undefined;
    return !!asset && (asset.kind === 'audio' || asset.hasAudio);
  });
  if (!clips.length) return null;
  const floor = 10 ** (FLOOR_DB / 20) * 255;
  const step = 1 / BUCKETS_PER_SECOND;
  const talking: Range[] = [];
  const spoken: string[] = [];
  let words = 0;
  let language: string | null = null;
  for (const clip of clips) {
    const assetId = (clip.source as { assetId: string }).assetId;
    const transcript = transcripts.get(assetId);
    const placed = (transcript?.words ?? []).map((word) => ({ word, at: wordOnTimeline(word, clip) })).filter((each): each is { word: TranscriptWord; at: Range } => !!each.at);
    if (placed.length) {
      words += placed.length;
      spoken.push(placed.map((each) => each.word.text).join(' '));
      language ??= transcript?.language || null;
      talking.push(...placed.map((each) => each.at));
      continue;
    }
    const peaks = peaksOf(assetId);
    if (!peaks) { talking.push({ start: clip.start, end: clipEnd(clip) }); continue; }
    const speed = clip.speed || 1;
    let from: number | null = null;
    const steps = Math.ceil(clip.duration / step - 1e-9);
    for (let index = 0; index < steps; index++) {
      const t = clip.start + index * step;
      const source = clip.reverse ? clip.in + (clipEnd(clip) - t) * speed : clip.in + (t - clip.start) * speed;
      const bucket = Math.floor(source * BUCKETS_PER_SECOND);
      const loud = bucket >= 0 && bucket < peaks.buckets && peaks.data[bucket * 2 + 1] > floor;
      if (loud && from === null) from = t;
      if (!loud && from !== null) { talking.push({ start: from, end: t }); from = null; }
    }
    if (from !== null) talking.push({ start: from, end: clipEnd(clip) });
  }
  const speech = merge(talking, JOIN_GAP).filter((r) => r.end - r.start > 0.08);
  if (!speech.length) return null;
  const start = speech[0].start;
  const end = speech[speech.length - 1].end;
  const pauses: Range[] = [];
  for (let i = 1; i < speech.length; i++) if (speech[i].start - speech[i - 1].end >= MIN_PAUSE) pauses.push({ start: speech[i - 1].end, end: speech[i].start });
  const talkSeconds = speech.reduce((sum, r) => sum + r.end - r.start, 0);
  const wpm = words >= 8 && talkSeconds > 2 ? Math.round(words / (talkSeconds / 60)) : null;
  const text = spoken.join(' ').replace(/\s+/g, ' ').trim();
  const { mood, hits } = moodOfText(text);
  const chosen: Mood = hits ? mood : wpm !== null && wpm > 175 ? 'energetic' : 'corporate';
  const pace = wpm === null ? 0 : Math.max(-0.2, Math.min(0.2, (wpm - 150) / 150));
  return {
    clips: clips.length, start, end, speech, pauses,
    talkShare: Math.min(1, talkSeconds / Math.max(0.001, end - start)),
    words, wpm, language, excerpt: text.slice(0, 600),
    mood: chosen, energy: Math.max(0, Math.min(1, MOOD_FEEL[chosen].energy + pace)), bpm: bpmForDelivery(chosen, wpm),
  };
}

/** One line for people and models: "62 s of narration, 158 wpm, English, reads as inspiring → 103 BPM". */
export function describeVoice(brief: VoiceBrief): string {
  const span = Math.round(brief.end - brief.start);
  const pace = brief.wpm ? `, ${brief.wpm} wpm` : '';
  const lang = brief.language ? `, language ${brief.language}` : '';
  return `${span} s of voice-over (${Math.round(brief.talkShare * 100)}% talking, ${brief.pauses.length} pauses${pace}${lang}), reads as ${brief.mood} → about ${brief.bpm} BPM`;
}
