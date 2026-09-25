// create_character / animate_character / lip_sync_character / list_character_actions
// (docs/REFERENCE-FILMS-PLAN.md P8, C2). The AI works in scene pixels and seconds; this module turns
// that into the character's own space (origin between the feet) and places or edits the layer.
import { ACTIONS, CHARACTER_FEET, CHARACTER_KINDS, EXPRESSIONS, type CharacterAction, type CharacterData, type CharacterKind } from '../motion/character/types';
import { RIGS } from '../motion/character/pose';
import type { Layer, MotionScene, Vec } from '../motion/types';
import type { TranscriptWord } from './ipc';
import type { ToolResult } from './types';
import type { MotionToolContext } from './motionTools';

type Args = Record<string, unknown>;
type Run = (name: string, args: Args, ctx: MotionToolContext) => Promise<ToolResult>;

const fail = (error: string): ToolResult => ({ ok: false, error });
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);

export const ACTION_HELP: Record<(typeof ACTIONS)[number], string> = {
  idle: 'dead holds broken by small 2–3-drawing bursts (MDS idles), for `duration`',
  wave: 'a hand wave beside the head (hand: left|right)',
  point: 'point at `to` [x, y] (scene px) and look there',
  look: 'look (eyes and head) toward `to` [x, y]',
  hop: 'a small hop: 2 f crouch, 1 f take-off, 7 f hang, 2 f stretched fall, 6 f squash',
  leap: 'a big leap forward by `to` px: 3 f crouch, smear take-off, 1.7× fall stretch, 0.55× squash',
  walk: 'walk by `to` px (or to [x, y]) at 14 f a step',
  sneak: 'a crouched sneak walk, 12 f a step',
  run: 'run by `to` px, 6 f a step, leaning 21°',
  celebrate: 'dip, arms up, a small hop, happy eyes, grin',
  shrug: 'hands out, head tilt, unsure face',
  nod: 'nod yes',
  shake: 'shake the head no',
  facepalm: 'hand to face, head down, eyes closed',
  surprise: 'a take: anticipation squash, pop up stretched, arms out, wide eyes, "o" mouth',
  think: 'hand to chin, looking up',
  type: 'hands tapping a keyboard in front',
  talk: 'mouth shapes for `text` over `duration`, or timed `words` (lip_sync_character fills these from the voice-over)',
  expression: 'hold a face from now on: normal, happy, sad, wide, determined, closed, unsure, side',
  turn: 'roll the head toward `amount` -1 (left) … 1 (right)',
};

/** The standing height of a base character in its own px (feet to the top of the head). */
export const standingHeight = (kind: CharacterKind) => RIGS[kind].neck + RIGS[kind].head[1] * (kind === 'shape-buddy' ? 0.35 : 1.0);

/** Converts actions written in scene px to the character's own px (origin between the feet). */
export function toCharacterSpace(actions: Args[], at: Vec, scalePercent: number, offset = 0): CharacterAction[] {
  const k = 100 / scalePercent;
  return actions.map((raw) => {
    const action = { ...(raw as unknown as CharacterAction) };
    action.t = (typeof raw.t === 'number' ? raw.t : 0) - offset;
    if (['walk', 'sneak', 'run', 'leap'].includes(action.do)) {
      if (Array.isArray(raw.to)) action.to = ((raw.to as number[])[0] - at[0]) * k;
      else if (typeof raw.to === 'number') action.to = (raw.to as number) * k;
    } else if (Array.isArray(raw.to)) {
      const to = raw.to as number[];
      action.to = [(to[0] - at[0]) * k, (to[1] - at[1]) * k];
    }
    if (Array.isArray(raw.words)) action.words = (raw.words as { t: number; end: number; w: string }[]).map((w) => ({ ...w, t: w.t - offset, end: w.end - offset }));
    return action;
  });
}

export function checkActions(actions: Args[]): string | null {
  for (const [i, a] of actions.entries()) {
    if (!(ACTIONS as readonly string[]).includes(a.do as string)) return `actions[${i}].do must be one of ${ACTIONS.join(', ')}.`;
    if (typeof a.t !== 'number') return `actions[${i}] needs t (seconds from the scene start).`;
    if (a.do === 'expression' && !(EXPRESSIONS as readonly string[]).includes(a.expression as string)) return `actions[${i}].expression must be one of ${EXPRESSIONS.join(', ')}.`;
  }
  return null;
}

/** Words said between `from` and `to` (timeline seconds), made scene-relative to `sceneStart`. */
export function wordsIn(words: TranscriptWord[], from: number, to: number, sceneStart: number) {
  return words.filter((w) => w.end > from && w.start < to).map((w) => ({ t: w.start - sceneStart, end: w.end - sceneStart, w: w.text }));
}

type CharacterLayer = Layer & { type: 'character' };

function findCharacter(scene: MotionScene, id?: string): CharacterLayer | null {
  for (const layer of scene.layers) {
    if (layer.type === 'character' && (!id || layer.id === id)) return layer;
    if (layer.type === 'precomp') { const inner = findCharacter(layer.scene, id); if (inner) return inner; }
  }
  return null;
}

const staticVec = (value: unknown, fallback: Vec): Vec => (Array.isArray(value) ? (value as Vec) : value && typeof value === 'object' && 'k' in (value as object) ? ((value as { k: { v: Vec }[] }).k[0]?.v ?? fallback) : fallback);
const staticNum = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : value && typeof value === 'object' && 'k' in (value as object) ? ((value as { k: { v: number }[] }).k[0]?.v ?? fallback) : fallback);

export async function runCharacterTool(name: string, args: Args, ctx: MotionToolContext, run: Run, words: (compId?: string) => Promise<TranscriptWord[]>): Promise<ToolResult> {
  switch (name) {
    case 'list_character_actions':
      return done(`Characters: ${CHARACTER_KINDS.join(', ')} (original designs). Place one with create_character, then animate_character with timed actions (scene seconds, scene px). The rig moves on twos like the MDS film; blinks are automatic.`, {
        characters: CHARACTER_KINDS, actions: ACTIONS.map((a) => ({ do: a, what: ACTION_HELP[a] })), expressions: EXPRESSIONS,
      });

    case 'create_character': {
      const comp = ctx.pickComp(ctx.project, args);
      if (!comp) return fail('There is no composition to place the character in.');
      const kind = (str(args, 'character') ?? 'dome-kid') as CharacterKind;
      if (!CHARACTER_KINDS.includes(kind)) return fail(`No character "${kind}". Characters: ${CHARACTER_KINDS.join(', ')}.`);
      const raw = Array.isArray(args.actions) ? (args.actions as Args[]) : [];
      const bad = checkActions(raw);
      if (bad) return fail(bad);
      const at: Vec = Array.isArray(args.at) ? (args.at as Vec) : [comp.width / 2, comp.height * 0.9];
      const height = num(args, 'height') ?? comp.height * 0.5;
      const scale = Math.round((height / standingHeight(kind)) * 10000) / 100;
      const character: CharacterData = {
        kind,
        ...(args.palette && typeof args.palette === 'object' ? { palette: args.palette as CharacterData['palette'] } : {}),
        actions: toCharacterSpace(raw, at, scale),
        step: (num(args, 'step') as 1 | 2 | 3 | undefined) ?? 2,
        ...(str(args, 'expression') ? { expression: str(args, 'expression') as CharacterData['expression'] } : {}),
        ...(num(args, 'facing') === -1 ? { facing: -1 } : {}),
      };
      const id = str(args, 'id') ?? `char-${kind}`;
      const layer: Layer = { id, name: str(args, 'name') ?? kind, type: 'character', transform: { anchor: [...CHARACTER_FEET], position: at, scale }, character };
      const clipId = str(args, 'clipId');
      if (clipId) {
        const updated = await run('update_motion_scene', { clipId, addLayers: [layer], fit: false }, ctx);
        if (!updated.ok) return updated;
        return done(`Added ${kind} "${id}" to the scene, feet at [${at.map(Math.round).join(', ')}], ${Math.round(height)} px tall, with ${raw.length} action(s). Animate it with animate_character {"clipId":"${clipId}","layerId":"${id}","actions":[…]}.`, { ...updated, layerId: id });
      }
      const last = character.actions!.reduce((m, a) => Math.max(m, a.t + (a.duration ?? 1.5)), 0);
      const duration = num(args, 'duration') ?? Math.max(3, last + 1);
      const layers: Layer[] = [];
      if (str(args, 'stage')) layers.push({ id: 'stage', name: 'Stage', type: 'solid', color: str(args, 'stage')! });
      layers.push(layer);
      const scene: MotionScene = { version: 1, width: comp.width, height: comp.height, duration, layers };
      const placed = await run('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start: num(args, 'start') ?? 0, title: str(args, 'title') ?? `Character · ${kind}`, duration, fit: false, useBrand: false }, ctx);
      if (!placed.ok) return placed;
      return done(`${placed.summary} The character is layer "${id}"; animate it with animate_character {"clipId":"${(placed as { clipId?: string }).clipId}","layerId":"${id}","actions":[…]}, and lip_sync_character for the voice-over.`, { ...placed, layerId: id });
    }

    case 'animate_character':
    case 'lip_sync_character': {
      const clipId = str(args, 'clipId');
      if (!clipId) return fail('Give the clipId of the scene holding the character.');
      const got = await run('get_motion_scene', { clipId, full: true }, ctx);
      const scene = (got as { scene?: MotionScene }).scene;
      if (!got.ok || !scene) return fail(`${clipId} is not a motion scene.`);
      const layer = findCharacter(scene, str(args, 'layerId'));
      if (!layer) return fail('No character layer in that scene (create_character first).');
      const at = staticVec(layer.transform?.position, [scene.width / 2, scene.height / 2]);
      const scale = staticNum(layer.transform?.scale, 100);
      let actions: CharacterAction[];
      if (name === 'lip_sync_character') {
        // Where the scene starts on the timeline, so the words line up with its own clock.
        const holder = ctx.project.comps.flatMap((c) => c.clips).find((c) => c.id === clipId);
        const start = num(args, 'sceneStart') ?? (holder ? holder.start - holder.in / (holder.speed || 1) : 0);
        const from = num(args, 'from') ?? 0;
        const to = num(args, 'to') ?? scene.duration;
        const said = wordsIn(await words(str(args, 'compId')), start + from, start + to, start);
        if (!said.length) return fail('No transcribed words in that range: transcribe the voice-over first (the words drive the mouth).');
        actions = [...(layer.character.actions ?? []).filter((a) => a.do !== 'talk'), { t: said[0].t, do: 'talk', words: said, duration: said[said.length - 1].end - said[0].t }];
      } else {
        const raw = Array.isArray(args.actions) ? (args.actions as Args[]) : [];
        const bad = checkActions(raw);
        if (bad) return fail(bad);
        if (!raw.length) return fail('Give actions: [{t, do, …}] (list_character_actions).');
        const converted = toCharacterSpace(raw, at, scale);
        actions = args.replace === true ? converted : [...(layer.character.actions ?? []), ...converted];
      }
      actions.sort((a, b) => a.t - b.t);
      const updated = await run('update_motion_scene', { clipId, patches: [{ layer: layer.id, path: 'character.actions', value: actions }], fit: false }, ctx);
      if (!updated.ok) return updated;
      const talk = actions.find((a) => a.do === 'talk');
      return done(name === 'lip_sync_character' ? `Lip-synced "${layer.id}" to ${talk?.words?.length ?? 0} spoken words.` : `"${layer.id}" now has ${actions.length} action(s): ${actions.map((a) => `${a.do}@${a.t.toFixed(2)}`).join(', ')}.`, { ...updated, actions: actions.length });
    }
  }
  return fail(`Unknown character tool ${name}.`);
}
