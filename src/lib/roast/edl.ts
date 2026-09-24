// The roast EDL: checking a plan of comedy moves and applying it to a comp in one step
// (docs/FUNNY-MODE-PLAN.md §3.2 steps 5–6).
//
// `validateEdl` is a dry run: it checks the plan (asset and clip ids, times, a reason on every
// meme, a matte under host_on_bg, no two full-frame cutaways at once, sounds not overused), runs
// it on the comp — pure functions, so nothing is touched — and reads the Edit DNA of the result,
// dead zones included. `applyEdl` does the same and hands back the edited comp with the plan,
// what each event made and the DNA stored on `comp.roast`. Applying a plan again first takes back
// what the same event ids made before, so it never doubles up.

import { clipEnd } from '../timeline';
import type { AssetMap } from '../timeline';
import type { Comp, Project } from '../types';
import { deadZones, roastIdOf, timelineDna } from './dna';
import { cueFor, hostClipAt, isMatted, MOVE_KINDS, MOVE_SPECS, runMove, undoApplied } from './moves';
import { CARD_TEMPLATES, FUNNY_BAND, FX_TEMPLATES, ROAST_TEXT_STYLES, type AppliedEvent, type EdlReport, type RoastEdl, type RoastEvent, type RoastMoveKind, type SfxCue } from './types';

export type ApplyOptions = {
  /** Take back every event applied before, not only those with the same ids (a new plan). */
  replace?: boolean;
  /** Beat times, timeline seconds: music_sting snapping and the DNA's on-beat share. */
  beats?: number[];
  /** Downbeats, timeline seconds; stings prefer them. */
  downbeats?: number[];
};

export type ApplyResult = { comp: Comp; applied: AppliedEvent[]; report: EdlReport };

const round = (value: number) => Math.round(value * 1000) / 1000;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Where the comp ends, not counting clips a roast plan made (so re-applying never moves it). */
export function roastLimit(comp: Comp): number {
  return comp.clips.reduce((end, clip) => (roastIdOf(clip) ? end : Math.max(end, clipEnd(clip))), 0);
}

/** The next free `e<n>` id. */
export function nextEventId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`e${n}`)) n++;
  return `e${n}`;
}

/**
 * Events as the model wrote them, made into RoastEvents: ids given where missing (`e1`, `e2`…),
 * `at` / `duration` filled from the move's defaults (a bleep from its word, a receipt from its
 * clip), `why` defaulted to "". Anything that cannot be an event is an error.
 */
export function normalizeEvents(raw: unknown, options: { taken?: Iterable<string>; assets?: AssetMap } = {}): { events: RoastEvent[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const errors: string[] = [];
  const events: RoastEvent[] = [];
  const taken = new Set(options.taken ?? []);
  const given = new Set<string>();
  // Ids the model chose are reserved first, so a generated one never collides with a later event.
  const chosen = new Set(list.map((entry) => (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? ((entry as { id: string }).id).trim() : '')).filter(Boolean));
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`event ${index + 1} is not an object`);
      return;
    }
    const value = { ...(entry as Record<string, unknown>) };
    const move = value.move as RoastMoveKind;
    if (!MOVE_KINDS.includes(move)) {
      errors.push(`event ${index + 1}: unknown move "${String(value.move)}" (one of ${MOVE_KINDS.join(', ')})`);
      return;
    }
    let id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : '';
    if (id && given.has(id)) {
      errors.push(`event ${index + 1}: duplicate id "${id}"`);
      return;
    }
    if (!id) id = nextEventId([...taken, ...given, ...chosen]);
    given.add(id);
    if (move === 'bleep') {
      if (!finite(value.at) && finite(value.from)) value.at = value.from;
      if (!finite(value.duration) && finite(value.from) && finite(value.to)) value.duration = value.to - value.from;
    }
    if (!finite(value.at)) {
      errors.push(`${id} (${move}): at (timeline seconds) is required`);
      return;
    }
    if (!finite(value.duration) || value.duration <= 0) {
      const asset = move === 'receipt' && typeof value.assetId === 'string' ? options.assets?.get(value.assetId) : undefined;
      const inPoint = finite(value.in) ? value.in : 0;
      value.duration = asset?.kind === 'video' ? Math.max(0.5, Math.min(60, asset.duration - inPoint)) : MOVE_SPECS[move].seconds;
    }
    value.id = id;
    value.at = round(value.at as number);
    value.duration = round(value.duration as number);
    value.why = typeof value.why === 'string' ? value.why.trim() : '';
    events.push(value as unknown as RoastEvent);
  });
  return { events, errors };
}

/** What a cue sounds like, for counting repeats: its library id, asset or kind. */
const cueKey = (cue: SfxCue) => cue.id ?? cue.assetId ?? cue.kind ?? '?';

const spanOf = (event: RoastEvent) => (event.move === 'bleep' ? { start: event.from, end: event.to } : { start: event.at, end: event.at + event.duration });

/**
 * The plan's own mistakes, before anything runs: bad ids, times outside the comp, missing
 * reasons, a host_on_bg without a matte, two cutaways at once, one sound used too often.
 * `kept` are events of the plan already on the comp that stay: they count for overlaps and
 * repeats, but their own problems are not this plan's.
 */
export function checkEdl(comp: Comp, assets: AssetMap, events: RoastEvent[], kept: RoastEvent[] = []): { errors: string[]; warnings: string[]; badIds: Set<string> } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const badIds = new Set<string>();
  const limit = roastLimit(comp);
  const clipIds = new Set(comp.clips.map((clip) => clip.id));
  const fail = (event: RoastEvent, message: string) => {
    errors.push(`${event.id} (${event.move}): ${message}`);
    badIds.add(event.id);
  };
  const needAsset = (event: RoastEvent, id: string | undefined, field: string) => {
    if (!id) fail(event, `${field} is required`);
    else if (!assets.has(id)) fail(event, `${field} ${id} is not in the project`);
  };
  const needClip = (event: RoastEvent, id: string | undefined, field: string) => {
    if (id && !clipIds.has(id)) fail(event, `${field} ${id} is not on this comp`);
  };
  for (const event of events) {
    const spec = MOVE_SPECS[event.move];
    if (!spec) {
      fail(event, 'unknown move');
      continue;
    }
    if (spec.needsWhy && !event.why?.trim()) fail(event, 'why is required: one sentence on why this is funny here');
    if (!(event.at >= 0) || event.at >= limit) fail(event, `at ${event.at}s is outside the comp (0–${round(limit)} s)`);
    else if (event.move !== 'sfx' && event.at + event.duration > limit + 0.05) warnings.push(`${event.id} (${event.move}): runs past the end of the comp; it will be shortened`);
    if (event.duration < spec.bounds[0] || event.duration > spec.bounds[1]) warnings.push(`${event.id} (${event.move}): ${event.duration}s is outside ${spec.bounds[0]}–${spec.bounds[1]} s`);
    switch (event.move) {
      case 'meme_cutaway': case 'receipt': case 'side_cutout': case 'music_sting':
        needAsset(event, event.assetId, 'assetId');
        break;
      case 'host_on_bg': {
        if (event.bgAssetId) needAsset(event, event.bgAssetId, 'bgAssetId');
        else if (!event.color) fail(event, 'bgAssetId or color is required');
        needClip(event, event.hostClipId, 'hostClipId');
        const host = hostClipAt(comp, event.at, assets, event.hostClipId);
        if (!host) fail(event, 'no host clip at that time');
        else if (!isMatted(host)) fail(event, `the host clip ${host.name ?? host.id} has no roto matte or key (key_green_screen / rotoscope_clip first)`);
        break;
      }
      case 'keyword_pop': {
        if (!(ROAST_TEXT_STYLES as readonly string[]).includes(event.style)) fail(event, `style must be one of ${ROAST_TEXT_STYLES.join(', ')}`);
        if (!event.text?.trim()) fail(event, 'text is required');
        else if (event.text.trim().split(/\s+/).length > 3) warnings.push(`${event.id} (keyword_pop): "${event.text}" is more than 3 words; keyword pops are 1–3 stressed words`);
        if (event.position === 'behind' && !hostClipAt(comp, event.at, assets)?.rotoMatte) fail(event, 'text behind the host needs a roto matte on the host clip');
        break;
      }
      case 'card':
        if (!(CARD_TEMPLATES as readonly string[]).includes(event.template)) fail(event, `template must be one of ${CARD_TEMPLATES.join(', ')}`);
        break;
      case 'overlay_fx':
        if (!(FX_TEMPLATES as readonly string[]).includes(event.fx)) fail(event, `fx must be one of ${FX_TEMPLATES.join(', ')}`);
        break;
      case 'title_card':
        if (event.photoAssetId) needAsset(event, event.photoAssetId, 'photoAssetId');
        break;
      case 'head_paste':
        needAsset(event, event.headAssetId, 'headAssetId');
        if (!event.path?.length) fail(event, 'path is required (detect_faces on the meme clip)');
        break;
      case 'zoom_punch': case 'shake': case 'whip': case 'bw_freeze':
        needClip(event, event.clipId, 'clipId');
        if (event.move !== 'whip' && !hostClipAt(comp, event.at, assets, event.clipId)) fail(event, 'no host clip at that time');
        break;
      case 'bleep':
        if (!finite(event.from) || !finite(event.to) || event.to <= event.from) fail(event, 'from < to (timeline seconds of the word) is required');
        break;
      case 'sfx':
        if (!event.cue || (!event.cue.kind && !event.cue.id && !event.cue.assetId)) fail(event, 'cue needs kind, id or assetId');
        break;
      default:
        break;
    }
    const cue = cueFor(event, assets);
    if (event.move === 'sfx' && event.cue?.assetId) needAsset(event, event.cue.assetId, 'cue.assetId');
    if (cue?.assetId && event.move !== 'sfx') needAsset(event, cue.assetId, 'sfx.assetId');
  }

  // Two full-frame cutaways cannot both be on screen.
  const fresh = new Set(events.map((event) => event.id));
  const plan = [...kept, ...events];
  const cutaways = plan.filter((event) => MOVE_SPECS[event.move]?.fullFrame).map((event) => ({ event, ...spanOf(event) })).sort((a, b) => a.start - b.start);
  for (let index = 1; index < cutaways.length; index++) {
    for (let before = index - 1; before >= 0; before--) {
      const a = cutaways[before];
      const b = cutaways[index];
      if (b.start >= a.end - 0.01 || (!fresh.has(a.event.id) && !fresh.has(b.event.id))) continue;
      const culprit = fresh.has(b.event.id) ? b.event : a.event;
      errors.push(`${b.event.id} (${b.event.move}) overlaps ${a.event.id} (${a.event.move}) at ${round(b.start)}–${round(Math.min(a.end, b.end))}s; two full-frame cutaways cannot play at once`);
      badIds.add(culprit.id);
    }
  }

  // The same sound more than three times a video wears thin (the Comedian's repetition rule).
  const uses = new Map<string, number>();
  for (const clip of comp.clips) if (!roastIdOf(clip) && clip.source.type === 'sfx') uses.set(clip.source.kind, (uses.get(clip.source.kind) ?? 0) + 1);
  for (const event of plan) {
    const cue = event.move === 'sfx' ? event.cue : cueFor(event, assets);
    if (cue) uses.set(cueKey(cue), (uses.get(cueKey(cue)) ?? 0) + 1);
  }
  for (const [key, count] of uses) if (count > 3) warnings.push(`the "${key}" sound is used ${count} times; keep any one sound to 3 a video`);

  // A meme used twice reads as a mistake.
  const memes = new Map<string, string[]>();
  for (const event of plan) if (event.move === 'meme_cutaway') memes.set(event.memeId ?? event.assetId, [...(memes.get(event.memeId ?? event.assetId) ?? []), event.id]);
  for (const [key, ids] of memes) if (ids.length > 1) warnings.push(`the meme ${key} is used ${ids.length} times (${ids.join(', ')}); never repeat a meme`);
  return { errors, warnings, badIds };
}

/** Events of the plan already on the comp that this apply keeps (none with `replace`). */
function keptEvents(comp: Comp, edl: RoastEdl, replace: boolean): RoastEvent[] {
  const ids = new Set(edl.events.map((event) => event.id));
  return replace ? [] : (comp.roast?.edl?.events ?? []).filter((event) => !ids.has(event.id));
}

/**
 * Applies a roast EDL to `comp`, all events in order of time, and returns the edited comp with
 * the plan, what each event made and the Edit DNA stored on `comp.roast`. Pure. Events with an
 * error are left out (and listed in the report); the rest still apply. Previously applied events
 * with the same ids (with `replace`, every previously applied event) are taken back first.
 */
export function applyEdl(comp: Comp, project: Project, assets: AssetMap, edl: RoastEdl, options: ApplyOptions = {}): ApplyResult {
  const replace = !!options.replace;
  const previous = comp.roast?.applied ?? [];
  const ids = new Set(edl.events.map((event) => event.id));
  const undoIds = new Set(replace ? [...previous.map((entry) => entry.eventId), ...(comp.roast?.edl?.events ?? []).map((event) => event.id), ...ids] : ids);
  let next = comp;
  for (const id of undoIds) next = undoApplied(next, previous.find((entry) => entry.eventId === id) ?? { eventId: id, clipIds: [] });

  const kept = keptEvents(comp, edl, replace);
  const plan = [...kept, ...edl.events].sort((a, b) => a.at - b.at);
  const check = checkEdl(next, assets, edl.events, kept);
  const errors = [...check.errors];
  const warnings = [...check.warnings];
  const env = { project, assets, limit: roastLimit(next), beats: options.beats, downbeats: options.downbeats };
  const applied: AppliedEvent[] = [];
  const order = edl.events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at - b.event.at || a.index - b.index);
  for (const { event } of order) {
    if (check.badIds.has(event.id)) continue;
    const result = runMove(next, event, env);
    warnings.push(...result.warnings.map((message) => `${event.id} (${event.move}): ${message}`));
    if (result.errors.length) {
      errors.push(...result.errors.map((message) => `${event.id} (${event.move}): ${message}`));
      continue;
    }
    next = result.comp;
    applied.push(result.applied);
  }

  const dna = timelineDna(next, assets, { beats: options.beats, project });
  const zones = deadZones(next, FUNNY_BAND.maxStaticSeconds, assets, { project });
  for (const zone of zones.slice(0, 6)) warnings.push(`dead zone ${round(zone.start)}–${round(zone.end)}s (${round(zone.end - zone.start)} s of host with no cut or event; the band allows ${FUNNY_BAND.maxStaticSeconds} s)`);
  const keptApplied = replace ? [] : previous.filter((entry) => !ids.has(entry.eventId));
  next = {
    ...next,
    roast: {
      ...next.roast,
      edl: { version: 1, compId: comp.id, style: 'funny', events: plan },
      applied: [...keptApplied, ...applied],
      dna,
    },
  };
  return { comp: next, applied, report: { ok: errors.length === 0, errors, warnings, deadZones: zones, dna } };
}

/** A dry run of `applyEdl`: what would go wrong, and the Edit DNA the comp would have. */
export function validateEdl(comp: Comp, project: Project, assets: AssetMap, edl: RoastEdl, options: ApplyOptions = {}): EdlReport {
  return applyEdl(comp, project, assets, edl, options).report;
}
