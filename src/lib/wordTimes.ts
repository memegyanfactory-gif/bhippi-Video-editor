// Word-anchored timing for motion scenes: anywhere a scene holds a time, the AI may write
// `{ word: "ROI", mode: "land" }` and it becomes the scene second that word is spoken on the
// timeline (from the cached transcripts), with the offsets the reference films measured:
// headlines lead the word by 0.56 s, payoffs land on it, typed lines finish 0.3 s before it ends.
import type { MotionScene } from '../motion/types';
import { TIMING } from '../motion/kit/common';
import type { TranscriptWord } from './ipc';

export type WordRef = { word: string; mode?: 'lead' | 'land' | 'finish' | 'end'; offset?: number; nth?: number };

const isRef = (v: unknown): v is WordRef => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as WordRef).word === 'string' && Object.keys(v as object).every((k) => ['word', 'mode', 'offset', 'nth'].includes(k));
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

/** True when a scene uses any word reference (so the caller only loads transcripts when needed). */
export function hasWordRefs(value: unknown): boolean {
  if (isRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasWordRefs);
  if (value && typeof value === 'object') return Object.values(value).some(hasWordRefs);
  return false;
}

/** The timeline seconds of a word (a phrase matches consecutive words), the `nth` match at or after `from` − 2 s. */
export function findWord(words: TranscriptWord[], ref: WordRef, from: number): { start: number; end: number } | null {
  const target = ref.word.split(/\s+/).map(norm).filter(Boolean);
  if (!target.length) return null;
  const hits: { start: number; end: number }[] = [];
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((w, k) => norm(words[i + k].text) === w)) hits.push({ start: words[i].start, end: words[i + target.length - 1].end });
  }
  if (!hits.length) return null;
  const after = hits.filter((h) => h.start >= from - 2);
  const list = after.length ? after : hits;
  return list[Math.min(list.length - 1, Math.max(0, (ref.nth ?? 1) - 1))];
}

/**
 * Replaces every `{word…}` in the scene with scene seconds (the scene starts at `sceneStart` on the
 * timeline). Returns the words it could not find instead of guessing.
 */
export function resolveWordTimes(scene: MotionScene, words: TranscriptWord[], sceneStart: number): { scene: MotionScene; missing: string[] } {
  const missing: string[] = [];
  const walk = (value: unknown): unknown => {
    if (isRef(value)) {
      const hit = findWord(words, value, sceneStart);
      if (!hit) { missing.push(value.word); return 0; }
      const mode = value.mode ?? 'land';
      const at = mode === 'lead' ? hit.start - TIMING.voice.headlineLead
        : mode === 'finish' ? hit.end - TIMING.voice.typedFinishEarly
        : mode === 'end' ? hit.end
        : hit.start;
      return Math.max(0, at + (value.offset ?? 0) - sceneStart);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return { scene: walk(scene) as MotionScene, missing: [...new Set(missing)] };
}
