// Who is speaking, where they sit, and what the frame should do about it.
//
// A podcast cut is three understandings composed: the transcript says *when*
// someone speaks (and, with diarization, *who*), the person tracks say *where*
// everybody sits, and the shot planner turns those into cuts and reframes. This
// file is all three plus the geometry, as pure functions over plain data — no
// models run here, so every decision is testable with synthetic boxes.
//
// Where the inputs come from:
//   · words — `analyze_clip_speech`. Deepgram diarizes (`speaker` per word);
//     Whisper and offline engines do not, and then every word is unattributed.
//   · people — the assistant's own eyes: `inspect_clip_frames` shows the frame,
//     and it reports each visible person as boxes in frame units (0..1). A
//     single-speaker track can also come from a roto pass's subject boxes.
//   · names — whoever the user says they are; first appearances get markers
//     and, when asked, lower-thirds.
//
// What the planner assumes, stated plainly because it matters:
//   · Speaker ids are arbitrary per file (0, 1, …). They are matched to faces by
//     an explicit `cast` list when given, else left-to-right order of first
//     appearance. A speaker with no face keeps the wide shot — never a guess.
//   · One camera. Singles and two-shots are digital punch-ins (crop by zoom),
//     so `maxZoom` caps how far in we go before the picture turns to mush.
//   · Masks do not track moving people — a mask is a static rect — so overlap
//     is solved by going wider, not by cutting someone out. Roto mattes (for
//     graphics behind a subject) are a separate, already existing tool.
import type { TranscriptWord } from './ipc';
import { uid } from './editor';
import {
  clipEnd,
  freeTrack,
  newClip,
  placeClips,
  razor,
  textSource,
} from './timeline';
import type { Clip, Comp, Easing, Keyframe, Marker } from './types';

/** A box in frame units, 0..1, origin top-left — the same units layout.ts uses. */
export type FaceBox = { x: number; y: number; width: number; height: number };
export type FaceSample = { at: number; box: FaceBox };

/** One person, sampled a few times a second. `at` is *source* seconds. */
export type PersonTrack = {
  id: string;
  /** Display name for markers and lower-thirds, when known. */
  label?: string;
  /** Deepgram speaker id this person is, when the cast is known. */
  speaker?: number;
  boxes: FaceSample[];
};

export type SpeakerTurn = {
  /** Deepgram speaker id, or null when the words are unattributed. */
  speaker: number | null;
  start: number;
  end: number;
  words: number;
  /** True when nobody knows who this is — cut on activity, not identity. */
  uncertain: boolean;
};

export type ShotKind = 'wide' | 'single' | 'two';

export type Shot = {
  start: number;
  end: number;
  kind: ShotKind;
  /** People in frame, empty for wide. */
  personIds: string[];
  /** Why, for the report the assistant reads back. */
  reason: string;
};

/** A punch-in as clip transform values: offsets in frame fractions, scale in percent. */
export type Reframe = { x: number; y: number; scale: number };

export type PlanOptions = {
  /** Do not cut faster than this; strobing reads as a glitch, not energy. */
  minShot?: number;
  /** Cut this far after speech starts — a hair late feels live, early feels jumpy. */
  reactionDelay?: number;
  /** Brief listener cutaways inside long turns (needs 2+ visible people). */
  cutaways?: boolean;
  /** Never zoom past this or the picture turns to mush. */
  maxZoom?: number;
  /** Headroom above a face as a fraction of the face height. */
  headroom?: number;
};

export const PLAN_DEFAULTS: Required<PlanOptions> = {
  minShot: 1.0,
  reactionDelay: 0.12,
  cutaways: true,
  maxZoom: 2.2,
  headroom: 0.35,
};

// ── speaker turns ────────────────────────────────────────────────────────────

/**
 * Words in, turns out. Same-speaker runs merge across short pauses; a silence
 * longer than `silenceGap` ends the turn even mid-speaker; a run shorter than
 * `minTurn` folds into its neighbour (an interjection, not a turn).
 * Unattributed words still cut usefully: the turns become speech-activity
 * spans for wide/punch-in work rather than identity cuts.
 */
export function speakerTurns(
  words: TranscriptWord[],
  opts: { minTurn?: number; silenceGap?: number } = {},
): { turns: SpeakerTurn[]; attributed: boolean } {
  const minTurn = opts.minTurn ?? 0.9;
  const silenceGap = opts.silenceGap ?? 1.4;
  const sorted = [...words]
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .sort((a, b) => a.start - b.start);
  const attributed = sorted.some((word) => word.speaker !== undefined && word.speaker !== null);
  const runs: SpeakerTurn[] = [];
  for (const word of sorted) {
    const speaker = word.speaker ?? null;
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker && word.start - last.end <= silenceGap) {
      last.end = Math.max(last.end, word.end);
      last.words += 1;
    } else {
      runs.push({ speaker, start: word.start, end: word.end, words: 1, uncertain: speaker === null });
    }
  }
  // Fold interjections: a sub-second run between two runs joins its predecessor;
  // runs of one voice separated only by a pause become one turn, while true
  // silences keep them apart.
  const turns: SpeakerTurn[] = [];
  const extend = (prev: SpeakerTurn, run: SpeakerTurn) => {
    prev.end = Math.max(prev.end, run.end);
    prev.words += run.words;
    if (prev.speaker === null && run.speaker !== null) prev.speaker = run.speaker;
    prev.uncertain = prev.speaker === null;
  };
  for (const run of runs) {
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === run.speaker && run.start - prev.end <= silenceGap) {
      extend(prev, run);
      continue;
    }
    if (prev && run.end - run.start < minTurn && prev.speaker !== run.speaker) {
      extend(prev, run);
      continue;
    }
    turns.push({ ...run });
  }
  return { turns, attributed };
}

// ── person tracks ────────────────────────────────────────────────────────────

function lerpBox(a: FaceBox, b: FaceBox, t: number): FaceBox {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

/** Where a person is at source time `t`: interpolated, or null when unknown. */
export function trackAt(track: PersonTrack, t: number): FaceBox | null {
  const boxes = track.boxes;
  if (!boxes.length) return null;
  if (t <= boxes[0].at) return boxes[0].at - t < 2 ? { ...boxes[0].box } : null;
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    if (t >= a.at && t <= b.at) {
      if (b.at - a.at < 1e-9) return { ...a.box };
      return lerpBox(a.box, b.box, (t - a.at) / (b.at - a.at));
    }
  }
  const last = boxes[boxes.length - 1];
  return t - last.at < 2 ? { ...last.box } : null;
}

/** Everybody visible at `t`, left to right, ignoring specks. */
export function peopleAt(tracks: PersonTrack[], t: number): { track: PersonTrack; box: FaceBox }[] {
  return tracks
    .map((track) => ({ track, box: trackAt(track, t) }))
    .filter((entry): entry is { track: PersonTrack; box: FaceBox } => !!entry.box && entry.box.width > 0.02 && entry.box.height > 0.02)
    .sort((a, b) => a.box.x - b.box.x);
}

const area = (box: FaceBox) => Math.max(0, box.width) * Math.max(0, box.height);

function overlapRatio(a: FaceBox, b: FaceBox): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? (x * y) / smaller : 0;
}

/**
 * Whether one person can hold a single: nobody else may cover much of them, or
 * the punch-in frames two faces and reads as a mistake.
 */
export function isolable(person: FaceBox, others: FaceBox[]): boolean {
  return others.every((other) => overlapRatio(person, other) < 0.25);
}

// ── framing geometry ─────────────────────────────────────────────────────────

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function unionBox(boxes: FaceBox[]): FaceBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The punch-in for `subject` at `aspect` (the comp's width/height, e.g. 16/9 or
 * 9/16) on footage of `sourceAspect` (default: the same as the comp).
 *
 * The window keeps the comp's aspect, centres the subject with headroom above
 * and a thirds bias, clamps inside the source, and never zooms past `maxZoom`.
 * Returns null when even the widest legal window cannot hold the subject —
 * then the caller stays wide.
 */
export function frameFor(subject: FaceBox, aspect: number, opts: { maxZoom?: number; headroom?: number; pad?: number; sourceAspect?: number } = {}): Reframe | null {
  const maxZoom = opts.maxZoom ?? PLAN_DEFAULTS.maxZoom;
  const headroom = opts.headroom ?? PLAN_DEFAULTS.headroom;
  const pad = opts.pad ?? 1.35;
  const sourceAspect = opts.sourceAspect ?? aspect;
  // Faces are the top of heads: air above, chins out of the gutter. When the
  // subject is too tall for the aspect (a close-up in a wide frame), shrink the
  // padding before giving up — but never crop into the face itself.
  for (const shrink of [1, 0.82, 0.64, 0.5]) {
    const p = 1 + (pad - 1) * shrink;
    const h = headroom * shrink;
    const tall: FaceBox = {
      x: subject.x - subject.width * ((p - 1) / 2),
      y: subject.y - subject.height * h,
      width: subject.width * p,
      height: subject.height * (p + h),
    };
    const framed = fitWindow(tall, aspect, sourceAspect, maxZoom);
    if (framed) return framed;
  }
  return null;
}

/**
 * The window onto the source, in source units (0..1 on both axes), that shows
 * `tall` at the comp's aspect. The comp sees a window whose width/height in
 * source units is `aspect / sourceAspect`; at scale 100 a fitted ('fit') source
 * spans `min(1, sourceAspect / aspect)` of the comp's width, so a window `w`
 * wide needs a zoom of 1 / (w × that).
 */
function fitWindow(tall: FaceBox, aspect: number, sourceAspect: number, maxZoom: number): Reframe | null {
  const eps = 1e-6;
  const r = aspect / sourceAspect;
  const wMax = Math.min(1, r);
  const hMax = Math.min(1, 1 / r);
  const pw0 = Math.min(1, sourceAspect / aspect);
  let w = Math.min(wMax, tall.width);
  let h = w / r;
  if (h < tall.height) {
    h = Math.min(hMax, tall.height);
    w = h * r;
  }
  // A window past the source's edges shows bands; one smaller than the subject crops it.
  if (w < 1e-3 || h < 1e-3 || w > wMax + eps || h > hMax + eps) return null;
  if (w < tall.width - eps || h < tall.height - eps) return null;
  let zoom = 1 / (w * pw0);
  if (zoom > maxZoom + 1e-9) {
    // Too far: widen to the zoom cap and check the window still fits the source and the subject.
    zoom = maxZoom;
    w = 1 / (zoom * pw0);
    h = w / r;
    if (w > wMax + eps || h > hMax + eps) return null;
  }
  const cx = clamp01(tall.x + tall.width / 2);
  // Thirds bias: faces sit a touch above centre, the way an operator frames.
  const cy = clamp01(tall.y + tall.height * 0.42);
  const left = Math.min(Math.max(cx - w / 2, 0), Math.max(0, 1 - w));
  const top = Math.min(Math.max(cy - h / 2, 0), Math.max(0, 1 - h));
  const centreX = left + w / 2;
  const centreY = top + h / 2;
  // Clip transform semantics (see placement in editor.ts): the offset is a
  // fraction of the comp, and the window's centre lands on the comp's centre.
  return {
    x: Math.round(((0.5 - centreX) / w) * 10000) / 10000,
    y: Math.round(((0.5 - centreY) / h) * 10000) / 10000,
    scale: Math.round(100 * zoom * 100) / 100,
  };
}

/** The wide: everybody in, or the full frame when nobody is found. */
export function wideFrame(people: FaceBox[], aspect: number, opts: { maxZoom?: number; headroom?: number; sourceAspect?: number } = {}): Reframe {
  if (!people.length) return { x: 0, y: 0, scale: 100 };
  return frameFor(unionBox(people), aspect, { ...opts, pad: 1.2 }) ?? { x: 0, y: 0, scale: 100 };
}

// ── the shot planner ─────────────────────────────────────────────────────────

export type CastEntry = { person: string; speaker?: number; label?: string };

export type PlanInput = {
  turns: SpeakerTurn[];
  tracks: PersonTrack[];
  /** Timeline span of the footage being cut. */
  start: number;
  end: number;
  /** Comp aspect (width/height). Vertical comps favour singles over wides. */
  aspect: number;
  /** Explicit speaker→person mapping; positional guesswork otherwise. */
  cast?: CastEntry[];
  options?: PlanOptions;
};

export type CutPlan = {
  shots: Shot[];
  /** Speakers seen with no face to put them in. */
  unmappedSpeakers: number[];
  /** People never heard (or never mapped): they still get reaction shots. */
  silentPeople: string[];
  warnings: string[];
  attributed: boolean;
};

const labelOf = (track: PersonTrack): string => track.label ?? track.id;

function speakerPerson(speaker: number | null, visible: { track: PersonTrack; box: FaceBox }[], cast: CastEntry[]): PersonTrack | null {
  if (speaker === null) return null;
  const named = cast.find((entry) => entry.speaker === speaker);
  if (named) return visible.find((entry) => entry.track.id === named.person)?.track ?? null;
  // Positional fallback: Nth voice to Nth face, left to right — reported, never silent.
  return visible[speaker]?.track ?? null;
}

/**
 * Turns and faces in, shots out. The rules, in order:
 *   1. Silence is wide. Nobody to show, nothing to punch.
 *   2. One visible person is a single, held through short gaps.
 *   3. A floor-holder gets the single when isolable, the two-shot with their
 *      neighbour when not, wide when faceless.
 *   4. Crossfire (quick alternating turns) stays wide — cutting there strobes.
 *   5. Long turns borrow a brief listener cutaway, then return.
 *   6. Nothing shorter than `minShot` survives; crumbs join their neighbour.
 */
export function planShots(input: PlanInput): CutPlan {
  const options = { ...PLAN_DEFAULTS, ...(input.options ?? {}) };
  const { turns, tracks, start, end, cast = [] } = input;
  const warnings: string[] = [];
  const shots: Shot[] = [];
  const seenSpeakers = new Set<number>();
  const heardPeople = new Set<string>();
  const unmapped = new Set<number>();

  const push = (shot: Shot) => {
    const last = shots[shots.length - 1];
    if (last && last.kind === shot.kind && last.personIds.join() === shot.personIds.join()) {
      last.end = shot.end;
      return;
    }
    shots.push(shot);
  };

  const vertical = input.aspect < 1;
  let cursor = start;
  const relevant = turns.filter((turn) => turn.end > start && turn.start < end).sort((a, b) => a.start - b.start);

  const wideTo = (to: number, reason: string) => {
    if (to > cursor) {
      push({ start: cursor, end: to, kind: 'wide', personIds: [], reason });
      cursor = to;
    }
  };

  for (const turn of relevant) {
    const turnStart = Math.max(start, turn.start + options.reactionDelay);
    const turnEnd = Math.min(end, turn.end);
    if (turnEnd - turnStart < 0.15) continue;
    if (turn.speaker !== null) seenSpeakers.add(turn.speaker);

    const mid = (turnStart + turnEnd) / 2;
    const visible = peopleAt(tracks, mid);
    const person = speakerPerson(turn.speaker, visible, cast);

    if (!visible.length) {
      wideTo(turnEnd, 'no faces found here — kept wide; report boxes to punch in');
      continue;
    }
    if (visible.length === 1) {
      wideTo(turnStart, 'room tone before the turn');
      push({ start: turnStart, end: turnEnd, kind: 'single', personIds: [visible[0].track.id], reason: `only ${labelOf(visible[0].track)} visible` });
      cursor = turnEnd;
      if (turn.speaker !== null) heardPeople.add(visible[0].track.id);
      continue;
    }

    if (person) heardPeople.add(person.id);
    if (turn.speaker !== null && !person) {
      unmapped.add(turn.speaker);
      wideTo(turnEnd, `speaker ${turn.speaker} has no face — kept wide; tell me who is who`);
      continue;
    }

    const boxes = visible.map((entry) => entry.box);
    if (turnEnd - turnStart < 1.2 && relevant.length > 2) {
      wideTo(turnEnd, 'crossfire — cutting this fast would strobe');
      continue;
    }

    if (!person) {
      // Unattributed speech over several faces: hold whoever stands alone, else wide.
      const alone = visible.find((entry) => isolable(entry.box, boxes.filter((box) => box !== entry.box)));
      if (alone && turnEnd - turnStart >= 1.2) {
        wideTo(turnStart, 'room tone before the turn');
        push({ start: turnStart, end: turnEnd, kind: 'single', personIds: [alone.track.id], reason: `${labelOf(alone.track)} holds the frame while voices overlap` });
        cursor = turnEnd;
      } else {
        wideTo(turnEnd, 'several voices, no attribution — wide holds them all');
      }
      continue;
    }

    const me = visible.find((entry) => entry.track.id === person.id)!;
    const others = boxes.filter((box) => box !== me.box);
    wideTo(turnStart, 'room tone before the turn');
    if (isolable(me.box, others)) {
      const longTurn = options.cutaways && turnEnd - turnStart > 7 && visible.length > 1;
      const listener = longTurn ? visible.find((entry) => entry.track.id !== person.id) : undefined;
      if (listener && turnStart + 4 < turnEnd - 2) {
        const cutAt = turnStart + Math.min(5, (turnEnd - turnStart) / 2);
        const backAt = Math.min(turnEnd, cutAt + 1.5);
        push({ start: turnStart, end: cutAt, kind: 'single', personIds: [person.id], reason: `${labelOf(person)} holds the floor` });
        push({ start: cutAt, end: backAt, kind: 'single', personIds: [listener.track.id], reason: `${labelOf(listener.track)} listens` });
        if (backAt < turnEnd) push({ start: backAt, end: turnEnd, kind: 'single', personIds: [person.id], reason: `back to ${labelOf(person)}` });
      } else {
        push({ start: turnStart, end: turnEnd, kind: 'single', personIds: [person.id], reason: `${labelOf(person)} speaks` });
      }
      cursor = turnEnd;
    } else {
      // Too close to isolate: take the pair, or the room when even that crowds.
      const neighbour = nearestNeighbour(me.box, visible.filter((entry) => entry.track.id !== person.id));
      if (neighbour && overlapRatio(me.box, neighbour.box) < 0.6) {
        push({ start: turnStart, end: turnEnd, kind: 'two', personIds: [person.id, neighbour.track.id], reason: `${labelOf(person)} speaks; too close to isolate, so the pair` });
      } else {
        push({ start: turnStart, end: turnEnd, kind: 'wide', personIds: [], reason: `${labelOf(person)} speaks but the group crowds — wide keeps faces whole` });
      }
      cursor = turnEnd;
    }
  }
  wideTo(end, 'tail — hold the room');

  // Merge crumbs: nothing shorter than minShot survives a cut. A short opening
  // (room tone before the first word) joins what follows; the rest join back.
  const merged: Shot[] = [];
  for (const shot of shots) {
    const last = merged[merged.length - 1];
    if (last && shot.end - shot.start < options.minShot) {
      last.end = shot.end;
      last.reason += ` (+${shot.kind} too short to stand)`;
      continue;
    }
    merged.push({ ...shot, personIds: [...shot.personIds] });
  }
  if (merged.length > 1 && merged[0].end - merged[0].start < options.minShot) {
    const [first, ...rest] = merged;
    rest[0].start = first.start;
    rest[0].reason += ` (+opening ${first.kind} too short to stand)`;
    return finish(rest);
  }
  return finish(merged);

  function finish(final: Shot[]): CutPlan {
    // A vertical frame cannot hold a wide of several people — flag it, don't fake it.
    if (vertical && tracks.length > 1 && final.some((shot) => shot.kind === 'wide' && shot.end - shot.start > 2)) {
      warnings.push('Vertical frame with a group wide: the wide will feel distant — favour singles or switch the comp wider for the group beats.');
    }
    for (const speaker of unmapped) {
      warnings.push(`Speaker ${speaker} never matched a face — those stretches stay wide. Pass cast:[{person, speaker}] or names to fix.`);
    }
    const silent = tracks.filter((track) => !heardPeople.has(track.id));
    if (tracks.length > 1 && silent.length) {
      warnings.push(`${silent.map(labelOf).join(', ')} ${silent.length === 1 ? 'was' : 'were'} never heard — check the cast mapping before trusting the singles.`);
    }

    return {
      shots: final,
      unmappedSpeakers: [...unmapped].sort((a, b) => a - b),
      silentPeople: silent.map((track) => track.id),
      warnings,
      attributed: relevant.some((turn) => turn.speaker !== null),
    };
  }
}

function nearestNeighbour(me: FaceBox, others: { track: PersonTrack; box: FaceBox }[]): { track: PersonTrack; box: FaceBox } | null {
  let best: { track: PersonTrack; box: FaceBox } | null = null;
  let bestDist = Infinity;
  for (const entry of others) {
    const dist = Math.abs(entry.box.x + entry.box.width / 2 - (me.x + me.width / 2));
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

// ── applying the plan ────────────────────────────────────────────────────────

export type ApplyOptions = {
  /** Hard cuts between angles, or one clip with smoothed keyframed moves. */
  mode?: 'cut' | 'move';
  maxZoom?: number;
  headroom?: number;
  /** The footage's width/height; the comp's aspect when left out. */
  sourceAspect?: number;
  /** Name lower-thirds on first appearances (needs labels on the tracks). */
  nameTags?: boolean;
};

export type ApplyResult =
  | { ok: true; comp: Comp; markers: Marker[]; segments: number; newClips: string[] }
  | { ok: false; error: string };

/**
 * Cuts and reframes `clip` per `plan`, returning the edited comp. Video only —
 * the audio bed is never razored, so nothing drifts out of sync and the feel
 * stays J-cut: picture moves, sound flows. Static transforms on cut segments
 * replace any earlier punch-in there; move mode replaces x/y/scale keyframes
 * wholesale. Either way the input comp is untouched on failure.
 */
export function applyPodcastCut(
  comp: Comp,
  clip: Clip,
  plan: CutPlan,
  tracks: PersonTrack[],
  opts: ApplyOptions = {},
): ApplyResult {
  if (clip.source.type !== 'media') return { ok: false, error: 'Podcast cut needs a video clip.' };
  if (clip.reverse || clip.hold !== null || clip.speed !== 1) {
    return { ok: false, error: 'Flatten the clip first: podcast cut needs forward footage at normal speed.' };
  }
  const trackId = clip.trackId;
  const aspect = comp.width / Math.max(1, comp.height);
  const maxZoom = opts.maxZoom ?? PLAN_DEFAULTS.maxZoom;
  const headroom = opts.headroom ?? PLAN_DEFAULTS.headroom;
  const sourceAspect = opts.sourceAspect ?? aspect;
  const labels = new Map(tracks.map((track) => [track.id, track.label ?? track.id]));
  const inSpan = (shot: Shot) => shot.end > clip.start && shot.start < clipEnd(clip);

  // Face boxes are reported in *source* seconds; the shots run on the timeline.
  const toSource = (time: number) => clip.in + Math.min(Math.max(0, time - clip.start), clip.duration);

  const reframeFor = (shot: Shot): Reframe => {
    const t = toSource((shot.start + shot.end) / 2);
    const boxes = shot.personIds
      .map((id) => tracks.find((track) => track.id === id))
      .map((track) => (track ? trackAt(track, t) : null))
      .filter((box): box is FaceBox => !!box);
    if (!boxes.length) return { x: 0, y: 0, scale: 100 };
    const subject = shot.kind === 'wide'
      ? unionBox(tracks.map((track) => trackAt(track, t)).filter((box): box is FaceBox => !!box))
      : unionBox(boxes);
    return frameFor(subject, aspect, { maxZoom, headroom, sourceAspect }) ?? { x: 0, y: 0, scale: 100 };
  };

  const markersFor = (): Marker[] => {
    const seen = new Set<string>();
    const markers: Marker[] = [];
    for (const shot of plan.shots) {
      if (shot.kind !== 'single' || !shot.personIds.length) continue;
      const id = shot.personIds[0];
      if (seen.has(id) || shot.start < clip.start || shot.start >= clipEnd(clip)) continue;
      seen.add(id);
      markers.push({ id: uid(), time: Math.round(shot.start * 1000) / 1000, name: labels.get(id) ?? id, color: 'caribbean' });
    }
    return markers;
  };

  if ((opts.mode ?? 'cut') === 'move') {
    // One clip, smoothed keyframed drift through the shots — no razor at all.
    const keys: { x: Keyframe[]; y: Keyframe[]; scale: Keyframe[] } = { x: [], y: [], scale: [] };
    const ease: Easing = 'ease';
    const local = (time: number) => Math.round((time - clip.start) * 1000) / 1000;
    for (const shot of plan.shots.filter(inSpan)) {
      const frame = reframeFor(shot);
      const s = Math.max(clip.start, shot.start);
      const e = Math.min(clipEnd(clip), shot.end);
      for (const [list, value] of [[keys.x, frame.x], [keys.y, frame.y], [keys.scale, frame.scale]] as const) {
        list.push({ time: local(s), value, easing: ease });
        list.push({ time: local(e), value, easing: 'hold' });
      }
    }
    if (!keys.x.length) return { ok: false, error: 'No shots fall inside this clip.' };
    const markers = markersFor();
    return {
      ok: true,
      comp: {
        ...comp,
        markers: [...comp.markers, ...markers],
        // The windows are worked out for a fitted picture.
        clips: comp.clips.map((item) => (item.id === clip.id
          ? { ...item, transform: { ...item.transform, fit: 'fit' as const }, keyframes: { ...item.keyframes, x: keys.x, y: keys.y, scale: keys.scale } }
          : item)),
      },
      markers,
      segments: 1,
      newClips: [],
    };
  }

  // Cut mode: razor the video lineage at every shot edge, then frame each piece.
  // Audio is deliberately untouched — links are cut on the video side only.
  const edges = [...new Set(plan.shots.filter(inSpan).flatMap((shot) => [shot.start, shot.end]))]
    .filter((time) => time > clip.start + 1e-3 && time < clipEnd(clip) - 1e-3)
    .sort((a, b) => a - b);
  const assetId = (clip.source as { assetId: string }).assetId;
  const onLineage = (items: Clip[], ids: string[]) =>
    items.filter((item) => ids.includes(item.id) && item.trackId === trackId && item.source.type === 'media'
      && (item.source as { assetId: string }).assetId === assetId
      && item.start >= clip.start - 1e-6 && clipEnd(item) <= clipEnd(clip) + 1e-6);
  let next = comp;
  let lineage = [clip.id];
  for (const edge of edges) {
    const covering = next.clips.filter((item) => lineage.includes(item.id) && item.start < edge && clipEnd(item) > edge);
    if (!covering.length) continue;
    next = razor(next, edge, [trackId], covering.map((item) => item.id), false);
    lineage = onLineage(next.clips, next.clips.map((item) => item.id)).map((item) => item.id);
  }

  const segments = onLineage(next.clips, lineage);
  if (!segments.length) return { ok: false, error: 'The cut left no footage behind.' };
  const inLineage = new Set(lineage);
  const clips = next.clips.map((item) => {
    if (!inLineage.has(item.id)) return item;
    const mid = (item.start + clipEnd(item)) / 2;
    const shot = plan.shots.find((entry) => mid >= entry.start && mid < entry.end);
    const frame = shot ? reframeFor(shot) : { x: 0, y: 0, scale: 100 };
    return {
      ...item,
      transform: { ...item.transform, fit: 'fit' as const, x: frame.x, y: frame.y, scale: frame.scale },
      // A stale keyframed punch-in would fight the static frame — it goes.
      keyframes: { ...item.keyframes, x: [], y: [], scale: [], rotation: [], opacity: [] },
    };
  });

  let out: Comp = { ...next, clips };
  const created: string[] = [];
  if (opts.nameTags) {
    // First appearance per labelled person gets a 3s lower-third above the footage.
    const firsts = new Map<string, Shot>();
    for (const shot of plan.shots) {
      if (shot.kind === 'single' && shot.personIds.length && !firsts.has(shot.personIds[0])) firsts.set(shot.personIds[0], shot);
    }
    for (const [id, shot] of firsts) {
      const track = tracks.find((entry) => entry.id === id);
      if (!track?.label) continue;
      const at = Math.max(clip.start, shot.start);
      const free = freeTrack(out, 'video', at, Math.min(clipEnd(clip), at + 3));
      out = free.comp;
      const tag = newClip({
        trackId: free.track.id,
        start: at,
        duration: Math.min(3, clipEnd(clip) - at),
        source: textSource('lower-third', { text: track.label }),
      });
      out = placeClips(out, [tag], 'overwrite');
      created.push(tag.id);
    }
  }
  const markers = markersFor();
  out = { ...out, markers: [...out.markers, ...markers] };
  return { ok: true, comp: out, markers, segments: segments.length, newClips: created };
}
