// What a brand kit has learned from references (`/train`, docs/TRAIN-AND-TEMPLATES-PLAN.md Part A):
// short rules in areas (pacing, colour, type…), each with the sources that taught it, a
// confidence that grows when references agree, and measured values where there are any, so code
// can use them and not only the prompt. The kit keeps learning without bloating: near-duplicates
// merge, a newer measured value replaces an older one (kept in history), and each area and the
// whole kit are capped, dropping the least confident first.
import type { BrandKit } from './types';

export type LearningArea = 'pacing' | 'color' | 'type' | 'layout' | 'motion' | 'captions' | 'audio' | 'voice' | 'do' | 'dont';
export const LEARNING_AREAS: LearningArea[] = ['pacing', 'color', 'type', 'layout', 'motion', 'captions', 'audio', 'voice', 'do', 'dont'];
export const AREA_LABEL: Record<LearningArea, string> = { pacing: 'Pacing', color: 'Colour', type: 'Type', layout: 'Layout', motion: 'Motion', captions: 'Captions', audio: 'Audio', voice: 'Voice', do: 'Do', dont: "Don't" };

/** Measured numbers or lists a learning carries (cut every 1.8 s, a palette, a caption style id…). */
export type LearningValue = Record<string, number | string | string[]>;

export type KitLearning = {
  id: string;
  area: LearningArea;
  /** One short rule, in the kit's words: "Cuts every 1.5–2 s; faster in hooks". */
  text: string;
  value?: LearningValue;
  /** The training sources that taught it (more than one: references agreed). */
  sourceIds: string[];
  /** 0–1: grows as more references agree; the prompt carries the most confident first. */
  confidence: number;
  status: 'active' | 'off';
  addedAt: string;
  updatedAt: string;
};

export type TrainingSource = {
  id: string;
  kind: 'video' | 'link' | 'image' | 'website' | 'timeline' | 'file';
  /** What the user gave: a file name, a URL, "Comp 1 (timeline)". */
  label: string;
  /** Where it is: a path, URL or reference-library id. */
  ref?: string;
  addedAt: string;
};

/** What a brand kit carries beyond its tokens. Optional so older kits read as untrained. */
export type KitTraining = { learnings?: KitLearning[]; sources?: TrainingSource[]; learningHistory?: KitLearning[]; /** Opt-in: offer to learn from the user's corrections to AI edits (lib/correctionLearning.ts). */ learnFromCorrections?: boolean };
export type TrainedKit = BrandKit & KitTraining;

const PER_AREA = 8;
const TOTAL = 60;
const HISTORY = 50;

const uid = () => `learn-${Math.random().toString(36).slice(2, 10)}`;
const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9#.%\s-]/g, ' ').split(/\s+/).filter((word) => word.length > 2));

/** How much two rules say the same thing (word overlap, 0–1). */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/** A learning as it arrives from a training: area, text, and optionally measured values. */
export type NewLearning = { area: LearningArea; text: string; value?: LearningValue; confidence?: number };

/**
 * `kit` with what `source` taught it. A rule that says what one already says (same area, similar
 * words) strengthens that one instead of adding another; a measured value for the same key in the
 * same area replaces the older one, which goes to history.
 */
export function addLearnings(kit: TrainedKit, source: Omit<TrainingSource, 'id' | 'addedAt'> & { id?: string }, incoming: NewLearning[], now = new Date().toISOString()): { kit: TrainedKit; added: number; strengthened: number; replaced: number; sourceId: string } {
  const sourceId = source.id ?? `src-${Math.random().toString(36).slice(2, 10)}`;
  let learnings = [...(kit.learnings ?? [])];
  let history = [...(kit.learningHistory ?? [])];
  let added = 0;
  let strengthened = 0;
  let replaced = 0;
  for (const item of incoming) {
    const text = item.text.trim();
    if (!text || !LEARNING_AREAS.includes(item.area)) continue;
    const same = learnings.find((learning) => learning.area === item.area && similarity(learning.text, text) >= 0.6);
    if (same) {
      learnings = learnings.map((learning) => (learning === same ? {
        ...learning,
        sourceIds: [...new Set([...learning.sourceIds, sourceId])],
        confidence: Math.min(1, learning.confidence + 0.15),
        value: item.value ? { ...learning.value, ...item.value } : learning.value,
        updatedAt: now,
      } : learning));
      strengthened++;
      continue;
    }
    const keys = Object.keys(item.value ?? {});
    const superseded = keys.length ? learnings.filter((learning) => learning.area === item.area && learning.value && keys.some((key) => key in learning.value!)) : [];
    if (superseded.length) {
      history = [...superseded, ...history].slice(0, HISTORY);
      learnings = learnings.filter((learning) => !superseded.includes(learning));
      replaced += superseded.length;
    }
    learnings.push({ id: uid(), area: item.area, text, value: item.value, sourceIds: [sourceId], confidence: Math.max(0.1, Math.min(1, item.confidence ?? 0.5)), status: 'active', addedAt: now, updatedAt: now });
    added++;
  }
  // Caps: the least confident (then oldest) go first, per area and overall.
  const rank = (a: KitLearning, b: KitLearning) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt);
  const kept: KitLearning[] = [];
  for (const area of LEARNING_AREAS) kept.push(...learnings.filter((learning) => learning.area === area).sort(rank).slice(0, PER_AREA));
  learnings = kept.sort(rank).slice(0, TOTAL);
  const sources = [...(kit.sources ?? []).filter((entry) => entry.id !== sourceId), { ...source, id: sourceId, addedAt: now }];
  return { kit: { ...kit, learnings, sources, learningHistory: history, updatedAt: now }, added, strengthened, replaced, sourceId };
}

/** Undoes one training: what only that source taught goes; what others also taught just loses it. */
export function forgetSource(kit: TrainedKit, sourceId: string): TrainedKit {
  const learnings = (kit.learnings ?? [])
    .map((learning) => (learning.sourceIds.includes(sourceId) ? { ...learning, sourceIds: learning.sourceIds.filter((id) => id !== sourceId), confidence: Math.max(0.1, learning.confidence - 0.15) } : learning))
    .filter((learning) => learning.sourceIds.length > 0);
  return { ...kit, learnings, sources: (kit.sources ?? []).filter((entry) => entry.id !== sourceId) };
}

/** Turns one learning on or off, edits its words, or deletes it (`patch` null). */
export function updateLearning(kit: TrainedKit, id: string, patch: Partial<Pick<KitLearning, 'text' | 'status' | 'area'>> | null): TrainedKit {
  const learnings = patch === null
    ? (kit.learnings ?? []).filter((learning) => learning.id !== id)
    : (kit.learnings ?? []).map((learning) => (learning.id === id ? { ...learning, ...patch, updatedAt: new Date().toISOString() } : learning));
  return { ...kit, learnings };
}

/**
 * What the AI reads: the active learnings, most confident first, grouped by area, within `budget`
 * characters (so a well-trained kit never crowds out the prompt).
 */
export function learningsBrief(kit: TrainedKit, budget = 1200): string[] {
  const active = (kit.learnings ?? []).filter((learning) => learning.status === 'active').sort((a, b) => b.confidence - a.confidence);
  const lines: string[] = [];
  let used = 0;
  for (const learning of active) {
    const line = `${AREA_LABEL[learning.area]}: ${learning.text}${learning.sourceIds.length > 1 ? ` (${learning.sourceIds.length} references agree)` : ''}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length;
  }
  return lines;
}

/** A measured value the kit learned (the most confident active learning that has it), for code paths. */
export function learnedValue(kit: TrainedKit, area: LearningArea, key: string): LearningValue[string] | undefined {
  return (kit.learnings ?? [])
    .filter((learning) => learning.status === 'active' && learning.area === area && learning.value && key in learning.value)
    .sort((a, b) => b.confidence - a.confidence)[0]?.value?.[key];
}
