// One short "Hint:" line for a tool call that failed, telling the model what works.
//
// Small and free models repeat the same few mistakes (an empty list_directory, an edit_file without
// its path, one huge brain_remember). Two sources: a static table seeded from the failures mined out
// of real traces, and lessons the brain learned from past turns (`brain_tool_lessons`, where a fix
// that followed a failure was recorded). A hint only ever rides along on an error: it never changes
// the result's status and a successful call never gets one.
import { invoke } from '@tauri-apps/api/core';

export type ToolLesson = { tool: string; error: string; fix: string; count: number };

/** A hint's longest length, so it stays one line in the model's context. */
export const HINT_MAX = 200;

type StaticHint = { tool: string | null; match: RegExp; hint: string };

// Each hint is true of the tool's current code (aiTools.ts and the brain commands).
const STATIC_HINTS: StaticHint[] = [
  { tool: 'list_directory', match: /Supply a directory path/i, hint: 'pass path: an absolute folder (the project "AI Work" folder is a good start); optional recursive, maxDepth, limit.' },
  { tool: 'analyze_song', match: /Give the song assetId or clipId/i, hint: 'pass assetId or clipId of the music (get_comp lists them), or attach the song to the plan first.' },
  { tool: 'edit_file', match: /Supply a file path|Supply oldString/i, hint: 'edit_file takes path, oldString (text to replace), newString, and optional allowMultiple.' },
  { tool: 'edit_file', match: /Target string to replace was not found/i, hint: 'read_file the file again and copy oldString exactly, whitespace included.' },
  { tool: 'edit_file', match: /appears \d+ times/i, hint: 'add surrounding lines to oldString so it is unique, or set allowMultiple: true.' },
  { tool: 'read_file', match: /Supply a file path/i, hint: 'read_file takes path (absolute), with optional startLine and endLine.' },
  { tool: 'write_file', match: /Supply a file path/i, hint: 'write_file takes path and content (overwrite defaults to true).' },
  { tool: 'brain_remember', match: /keep one entry under/i, hint: 'save several brain_remember calls, one short fact each, instead of one long entry.' },
  { tool: 'brain_save_skill', match: /write the procedure|\(body\)/i, hint: 'pass body: numbered steps, the tools and settings that worked, and the pitfalls.' },
  { tool: 'brain_save_skill', match: /needs a name/i, hint: 'pass name: a short kebab-case skill name (brain_save_skill takes name, description, body).' },
  { tool: 'brain_load_skill', match: /needs the skill name/i, hint: 'pass name: the exact skill name from your skills list.' },
  { tool: 'call_custom_tool', match: /requires the name/i, hint: 'pass name (the custom tool\'s name from list_custom_tools) and its inputs inside args.' },
  { tool: 'tool_help', match: /No tool "/i, hint: 'pass name: an exact tool name from your catalogue.' },
  { tool: 'save_video_blueprint', match: /Split .*batches/i, hint: 'cut the long scene into several scenes of 5-12 s, one per narrative beat.' },
  { tool: 'save_video_blueprint', match: /is not a template/i, hint: 'use a brand-* or engine template name from the error for mogrt.template.' },
  { tool: 'build_edit_from_brief', match: /Give \d+.*beats/i, hint: 'pass beats as an array of objects, each with text and optional kind, kicker, subtitle, points, value.' },
  { tool: 'create_ui_screen', match: /unknown type/i, hint: 'use only the action types listed in the error for actions[].type.' },
  { tool: 'create_ui_screen', match: /needs an id and box/i, hint: 'give every part an id and box [x, y, w, h] in screenshot CSS pixels.' },
  { tool: 'seamless_transition', match: /No cut on/i, hint: 'call get_comp, then give the exact time where one clip ends and the next begins.' },
  { tool: 'update_track', match: /no track with that name/i, hint: 'call get_comp to see the track names, then pass one exactly.' },
  { tool: 'attach_production_asset', match: /Give sceneIndex/i, hint: 'pass sceneIndex (0-based, from the blueprint) or kind "music", plus the assetId.' },
  { tool: 'open_comp', match: /no comp with that id/i, hint: 'call get_comp and use a compId it lists.' },
  { tool: 'update_clip', match: /nothing to change/i, hint: 'pass clipId plus at least one property whose value differs from the clip\'s now.' },
  { tool: null, match: /Supply a (video|media) clipId/i, hint: 'pass clipId of a clip on the timeline (get_comp lists them); it must hold video or sound.' },
  { tool: 'get_motion_scene', match: /Supply clipId/i, hint: 'pass clipId of a motion comp clip on the timeline (get_comp lists them).' },
  { tool: 'place_clip', match: /no media with that id/i, hint: 'use the assetId of media already in the project (get_comp or the bin), not a path or name.' },
];

/** Lowercase, with numbers, ids and quoted names flattened so one failure matches its repeats. */
export function normalizeError(error: string): string {
  return error
    .toLowerCase()
    .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '#')
    .replace(/[a-z]:\\[^\s]*|\/[^\s]*\/[^\s]*/g, '#')
    .replace(/\b[0-9a-f]{8,}\b/g, '#')
    .replace(/\d+(?:[.:]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const left = new Set(a.split(/\W+/).filter(Boolean));
  const right = new Set(b.split(/\W+/).filter(Boolean));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size);
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The learned fix for this tool and error, most-seen first, when the error is close enough. */
export function learnedHint(tool: string, error: string, lessons: readonly ToolLesson[]): string | null {
  const wanted = normalizeError(error);
  let best: { score: number; lesson: ToolLesson } | null = null;
  for (const lesson of lessons) {
    if (lesson.tool !== tool || !lesson.fix) continue;
    const score = similarity(wanted, normalizeError(lesson.error));
    if (score < 0.6) continue;
    if (!best || score > best.score || (score === best.score && lesson.count > best.lesson.count)) best = { score, lesson };
  }
  return best ? oneLine(best.lesson.fix) : null;
}

/** The static hint for this tool and error, if one is seeded. */
export function staticHint(tool: string, error: string): string | null {
  const found = STATIC_HINTS.find((entry) => (entry.tool === null || entry.tool === tool) && entry.match.test(error));
  return found?.hint ?? null;
}

const clipHint = (hint: string) => (hint.length > HINT_MAX ? `${hint.slice(0, HINT_MAX - 1)}…` : hint);

/** "Hint: …" for a failed call, or null. A learned lesson beats the seeded table. */
export function hintFor(tool: string, error: string, lessons: readonly ToolLesson[] = cached ?? []): string | null {
  const text = learnedHint(tool, error, lessons) ?? staticHint(tool, error);
  return text ? `Hint: ${clipHint(text)}` : null;
}

/** `error` with its hint on a new line, unless it has one already or there is none. */
export function withHint(tool: string, error: string, lessons?: readonly ToolLesson[]): string {
  if (/\nHint: /.test(error)) return error;
  const hint = hintFor(tool, error, lessons);
  return hint ? `${error}\n${hint}` : error;
}

const REFRESH_MS = 5 * 60_000;
let cached: ToolLesson[] | null = null;
let loadedAt = 0;
let loading: Promise<ToolLesson[]> | null = null;

/**
 * The brain's learned lessons, fetched at most every few minutes. A missing command or any failure
 * leaves the static table as the only source (an empty list), silently.
 */
export function loadLearnedLessons(now: number = Date.now()): Promise<ToolLesson[]> {
  if (cached && now - loadedAt < REFRESH_MS) return Promise.resolve(cached);
  if (loading) return loading;
  loading = Promise.resolve()
    .then(() => invoke<{ lessons?: ToolLesson[] }>('brain_tool_lessons'))
    .then((reply) => {
      const lessons = (Array.isArray(reply?.lessons) ? reply.lessons : []).filter((lesson) => lesson && typeof lesson.tool === 'string' && typeof lesson.error === 'string' && typeof lesson.fix === 'string');
      cached = lessons;
      loadedAt = now;
      return lessons;
    })
    .catch(() => {
      // Retry later, not on every failure.
      cached = cached ?? [];
      loadedAt = now;
      return cached;
    })
    .finally(() => { loading = null; });
  return loading;
}

/** The lessons already loaded (none before the first load), so a failing call never waits on the brain. */
export function cachedLessons(): readonly ToolLesson[] {
  return cached ?? [];
}

/** Test hook: forget the cache. */
export function resetLessonCache() {
  cached = null;
  loadedAt = 0;
  loading = null;
}
