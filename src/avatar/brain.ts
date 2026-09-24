// What the avatar should act out, decided from what Helios AI is doing. Pure functions, so the
// mapping and the timeline diff are tested without a DOM (tests/avatar.test.ts).

import { roleForTool, type CouncilRole } from '../lib/council';
import type { Clip, Project } from '../lib/types';

/**
 * What the chat is doing, as something the avatar can act out: the long activities a tool call
 * stands for while it runs, plus the chat's own states — thinking, writing the reply (`talk`),
 * waiting on the user's answer (`ask`), running a command (`tinker`).
 */
export type ActivityKind = 'research' | 'mix' | 'direct' | 'draw' | 'polish' | 'think' | 'talk' | 'ask' | 'tinker';
export type Activity = { kind: ActivityKind; role: CouncilRole | null };

const POLISH = new Set(['run_frame_qa', 'check_brand_compliance', 'verify_edit_workflow', 'consult_council', 'apply_brand_kit']);
const MAKING = new Set(['generate_local_media', 'import_generated_media', 'install_local_model', 'render_brand_board']);
const LOOKING = new Set([
  'get_comp', 'get_project', 'editing_workflow_status', 'list_recipes', 'list_effects', 'list_motion_templates', 'get_motion_scene', 'read_file',
  'write_file', 'edit_file', 'list_directory', 'glob_search', 'grep_search', 'local_media_capabilities', 'list_brand_kits', 'get_brand_kit',
  'get_brand_guideline', 'list_custom_tools', 'list_subagents', 'wait_subagent', 'spawn_subagent',
]);
const ASKING = new Set(['ask_user']);
const TINKERING = new Set(['run_command']);

/** Every tool name the avatar acts out by name (the council's seats aside), for the catalogue check in tests. */
export const ACTED_TOOLS: ReadonlySet<string> = new Set([...POLISH, ...MAKING, ...LOOKING, ...ASKING, ...TINKERING]);

/** The activity a tool call is acted out as while it runs; null when only its result matters (timeline edits). */
export function activityForTool(name: string): Activity | null {
  if (POLISH.has(name)) return { kind: 'polish', role: null };
  const role = roleForTool(name);
  if (role === 'researcher') return { kind: 'research', role };
  if (role === 'audio') return { kind: 'mix', role };
  if (role === 'director') return { kind: 'direct', role };
  if (role === 'animator') return { kind: 'draw', role };
  if (MAKING.has(name)) return { kind: 'draw', role: 'animator' };
  if (ASKING.has(name)) return { kind: 'ask', role: null };
  if (TINKERING.has(name)) return { kind: 'tinker', role: null };
  if (LOOKING.has(name)) return { kind: 'think', role: null };
  return null;
}

/**
 * A step a CLI provider takes by itself (its own web search, file read, command) — the rows the
 * chat lists under the reply. `verb` is the lower-cased verb the chat shows: searched, fetched,
 * read, edited, wrote, ran, tested, planned, used.
 */
export function activityForStep(verb: string, title = ''): Activity | null {
  const web = /\b(web|https?:|www\.|search the web|google|bing)\b/i.test(title);
  switch (verb.toLowerCase()) {
    case 'searched': return web ? { kind: 'research', role: 'researcher' } : { kind: 'research', role: null };
    case 'fetched': return { kind: 'research', role: 'researcher' };
    case 'read': return { kind: 'research', role: null };
    case 'edited': case 'wrote': return { kind: 'draw', role: null };
    case 'ran': case 'tested': return { kind: 'tinker', role: null };
    case 'planned': return { kind: 'think', role: null };
    default: return null;
  }
}

export type ClipDiff = {
  compId: string | null;
  /** Brand-new clips. */
  added: string[];
  removed: string[];
  /** Splits: the new right-hand piece, and the clip it was cut from. */
  cuts: { id: string; from: string }[];
  moved: string[];
  /** Trimmed, retimed, re-framed, re-levelled… */
  changed: string[];
};

const sourceKey = (clip: Clip) => {
  const source = clip.source;
  switch (source.type) {
    case 'media': return `m:${source.assetId}`;
    case 'comp': return `c:${source.compId}`;
    case 'item': return `i:${source.itemId}`;
    case 'text': return `t:${source.text}`;
    default: return source.type;
  }
};

const EPS = 1e-4;

/** What a tool did to the active comp's clips. */
export function diffTimeline(before: Project, after: Project): ClipDiff {
  const compId = after.activeCompId;
  const was = before.comps.find((comp) => comp.id === compId);
  const now = after.comps.find((comp) => comp.id === compId);
  const empty: ClipDiff = { compId, added: [], removed: [], cuts: [], moved: [], changed: [] };
  if (!was || !now || was === now) return empty;
  const old = new Map(was.clips.map((clip) => [clip.id, clip]));
  const cur = new Map(now.clips.map((clip) => [clip.id, clip]));
  const diff = { ...empty, added: [] as string[], removed: [] as string[], cuts: [] as { id: string; from: string }[], moved: [] as string[], changed: [] as string[] };
  const cutFrom = new Set<string>();
  for (const clip of now.clips) {
    if (old.has(clip.id)) continue;
    // A new clip that starts inside an old clip of the same source and track is the far half of a cut.
    const parent = was.clips.find((o) => cur.has(o.id) && o.trackId === clip.trackId && sourceKey(o) === sourceKey(clip) && o.start < clip.start - EPS && clip.start < o.start + o.duration - EPS);
    if (parent) {
      diff.cuts.push({ id: clip.id, from: parent.id });
      cutFrom.add(parent.id);
    } else diff.added.push(clip.id);
  }
  for (const clip of was.clips) if (!cur.has(clip.id)) diff.removed.push(clip.id);
  for (const clip of now.clips) {
    const prev = old.get(clip.id);
    if (!prev || prev === clip || cutFrom.has(clip.id)) continue;
    if (Math.abs(prev.start - clip.start) > EPS || prev.trackId !== clip.trackId) diff.moved.push(clip.id);
    // A rebuilt clip object with the same contents is not a change.
    else if (JSON.stringify(prev) !== JSON.stringify(clip)) diff.changed.push(clip.id);
  }
  return diff;
}

/** Clip ids a tool's arguments name, so the avatar can walk to them before the result is in. */
export function clipIdsIn(args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const a = args as Record<string, unknown>;
  const ids = [a.clipId, ...(Array.isArray(a.clipIds) ? a.clipIds : [])];
  return ids.filter((id): id is string => typeof id === 'string');
}

/** Lines the avatar says, by what it is doing. */
export const LINES: Record<string, string[]> = {
  research: ['Researching...', 'Finding sources', 'Checking licences', 'No watermarks!', 'Citing it'],
  mix: ['Mixing...', 'On the beat', '-16 LUFS', 'Duck the bed', 'Whoosh here'],
  direct: ['Action!', 'Centre it!', 'Push in!', 'Frame it', 'Rule of thirds'],
  draw: ['Frame by frame', 'Keyframes!', 'Ease out!', 'More motion!', 'Every frame'],
  polish: ['Polishing', 'So shiny!', 'QA pass', 'Spotless'],
  add: ['Coming through!', 'Placing it', 'Special delivery'],
  delete: ['Bye clip!', 'Out you go', 'Yeet!'],
  cut: ['Snip!', 'Clean cut'],
  push: ['Hup!', 'Scoot over'],
  tweak: ['Tweaking', 'Just so'],
  think: ['Hmm...', 'Let me see', 'Reading it'],
  tinker: ['Running it...', 'Building...', 'Beep boop'],
  ask: ['Your turn!', 'Need your answer', 'Over to you'],
  stopped: ['Stopped.', 'OK, stopping', 'Stopped!'],
  failed: ['Uh oh...', 'That failed', 'Oops...'],
  grabbed: ['AHAHAHA!', 'Haha stop!', 'Put me down!', 'Wheee!', 'I have work!', 'Hehehe!'],
  slap: ['No no no!', 'Hands off!', 'Not now!', "I'm editing!", 'Wait your turn!'],
  done: ['Done!', 'Ta-da!', 'All yours!'],
  wake: ['On it!', "Let's go!", 'Ready!'],
  poked: ['Hehe!', 'That tickles!', 'Hi!'],
  dizzy: ['Woah...', 'Ow ow ow', 'Stars...'],
};
