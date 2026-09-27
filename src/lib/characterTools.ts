// create_character / animate_character / lip_sync_character / list_character_actions / list_characters
// (docs/REFERENCE-FILMS-PLAN.md P8, C2). The AI works in scene pixels and seconds; this module turns
// that into the character's own space (origin between the feet) and places or edits the layer.
import { ACTIONS, CHARACTER_FEET, CHARACTER_KINDS, EXPRESSIONS, STUDIO_KIND, type CharacterAction, type CharacterData, type CharacterKind, type StudioSpec } from '../motion/character/types';
import { loadStudio, presetCharacters, savedCharacters, saveToLibrary, studioHeight } from '../motion/character/studio';
import { characterActionDuration, RIGS } from '../motion/character/pose';
import type { Layer, MotionScene, Vec } from '../motion/types';
import type { TranscriptWord } from './ipc';
import type { ToolResult } from './types';
import type { MotionToolContext } from './motionTools';

type Args = Record<string, unknown>;
type Run = (name: string, args: Args, ctx: MotionToolContext) => Promise<ToolResult>;

const fail = (error: string): ToolResult => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** `over` laid onto `base`, nested objects merged (a look tweak keeps the rest of the character). */
const merge = (base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Record<string, unknown>, v) : v;
  return out;
};

/** One line on who a library character is, so the AI can cast by look. */
export function describeCharacter(spec: StudioSpec): string {
  const o = spec as Record<string, unknown>;
  const part = (key: string) => (isObj(o[key]) ? (o[key] as Record<string, unknown>) : {});
  const hair = part('hair');
  const wear = ['top', 'outer', 'bottom', 'shoes'].map((k) => part(k)).filter((w) => w.kind && w.kind !== 'none').map((w) => `${w.color ?? ''} ${w.kind}`.trim());
  const extras = Array.isArray(o.acc) ? (o.acc as string[]).join(', ') : '';
  return [
    [o.age, o.body === 'fem' ? 'feminine' : o.body === 'masc' ? 'masculine' : o.body, o.build, o.species === 'skeleton' ? 'skeleton' : null, o.shape && o.shape !== 'classic' ? `${o.shape} shape` : null].filter(Boolean).join(' '),
    hair.style ? (hair.style === 'bald' ? 'bald' : `${hair.color ?? ''} ${hair.style} hair`.trim()) : '',
    wear.length ? `wears ${wear.join(', ')}` : '',
    extras ? `extras: ${extras}` : '',
    typeof o.skin === 'string' ? `skin ${o.skin}` : '',
  ].filter(Boolean).join('; ');
}

/** The user's request names a built-in rig (or its style), so it may be used. */
const RIG_ASKED = /dome[\s-]?(kid|head)|shape[\s-]?buddy|flat[\s-]?corporate|built[\s-]?in (rig|character)|googly/i;

/** A library character by name: the user's saved ones first, then the room's examples. */
async function findLibraryCharacter(name: string): Promise<{ spec: StudioSpec; from: 'saved' | 'example' } | null> {
  const key = name.trim().toLowerCase();
  const saved = savedCharacters().find((c) => c.name?.toLowerCase() === key);
  if (saved) return { spec: saved, from: 'saved' };
  const example = (await presetCharacters()).find((c) => c.name?.toLowerCase() === key);
  return example ? { spec: example, from: 'example' } : null;
}

const CASTING = 'Cast from the library first: the user\'s saved characters (made in the Characters window), then the examples. Use create_character {"character":"<name>"}, with `look` for small changes (clothes in brand colours, a hat). Only when nothing in the library fits a specific request, design a new one with `spec` in the same format (save:true adds it to the library). The built-in rigs (dome-kid, shape-buddy, flat-corporate) are only for when the user asks for that style.';
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const str = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const num = (args: Args, key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);

export const ACTION_HELP: Record<(typeof ACTIONS)[number], string> = {
  idle: 'rest with subtle breathing and weight shifts for `duration` (built-in rigs use stylized held poses)',
  wave: 'a hand wave beside the head (hand: left|right)',
  point: 'point at `to` [x, y] (scene px) and look there',
  look: 'look (eyes and head) toward `to` [x, y]',
  hop: 'a small hop with crouch, takeoff, airborne arc, soft landing and recovery',
  leap: 'a big leap forward by `to` px, with anticipation and landing recovery',
  walk: 'walk by `to` px (or to [x, y]), with alternating foot contacts and arm swing',
  sneak: 'a crouched sneak walk with careful, low footfalls',
  run: 'run by `to` px with forward lean, quicker strides and airborne phases',
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
  turn: 'turn toward `amount` -1 (left) … 1 (right)',
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

/** A number, or a string that is one ("1.5", " 2 "): some models quote every value inside an array. */
const toNum = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const n = Number(v.trim().replace(/s$/i, ''));
  return Number.isFinite(n) ? n : undefined;
};
const toVec = (v: unknown): unknown => (Array.isArray(v) ? v.map((x) => toNum(x) ?? x) : toNum(v) ?? v);
/** An array the model may have sent as a JSON string. */
const parsed = (v: unknown): unknown => {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v;
  try { return JSON.parse(v); } catch { return v; }
};

/**
 * Actions as the model sent them, made into what the checker and the rig expect: quoted numbers
 * become numbers, `at`/`time`/`start` stand in for a missing `t`, `action` for a missing `do`.
 */
export function normalizeActions(value: unknown): Args[] {
  const list = parsed(value);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const a: Args = isObj(parsed(item)) ? { ...(parsed(item) as Args) } : {};
    if (a.t === undefined) a.t = a.at ?? a.time ?? a.start;
    if (a.do === undefined && typeof a.action === 'string') a.do = a.action;
    if (typeof a.do === 'string') a.do = a.do.trim().toLowerCase();
    if (typeof a.expression === 'string') a.expression = a.expression.trim().toLowerCase();
    for (const key of ['t', 'duration', 'amount']) if (a[key] !== undefined) a[key] = toNum(a[key]) ?? a[key];
    if (a.to !== undefined) a.to = toVec(parsed(a.to));
    const words = parsed(a.words);
    if (Array.isArray(words)) a.words = words.map((w) => (isObj(w) ? { ...w, t: toNum(w.t) ?? w.t, end: toNum(w.end) ?? w.end } : w));
    delete a.at; delete a.time; delete a.start; delete a.action;
    return a;
  });
}

/** A spec or look as the model sent it, made into the library format (`acc` is a list, numbers are numbers). */
export function normalizeSpec(value: unknown): Record<string, unknown> | null {
  const spec = parsed(value);
  if (!isObj(spec)) return null;
  const out: Record<string, unknown> = { ...spec };
  if (out.acc !== undefined) {
    const flat = (v: unknown): string[] => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.flatMap(flat) : isObj(v) ? Object.values(v).flatMap(flat) : []);
    out.acc = [...new Set(flat(out.acc))];
  }
  if (out.height !== undefined) out.height = toNum(out.height) ?? out.height;
  return out;
}

export function checkActions(actions: Args[]): string | null {
  for (const [i, a] of actions.entries()) {
    if (!(ACTIONS as readonly string[]).includes(a.do as string)) return `actions[${i}].do must be one of ${ACTIONS.join(', ')}.`;
    if (typeof a.t !== 'number') return `actions[${i}] needs t: the start in scene seconds, as a number (e.g. {"t": 1.5, "do": "${String(a.do)}"}).`;
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

function layerIds(scene: MotionScene, into = new Set<string>()): Set<string> {
  for (const layer of scene.layers) {
    into.add(layer.id);
    if (layer.type === 'precomp') layerIds(layer.scene, into);
  }
  return into;
}

const staticVec =(value: unknown, fallback: Vec): Vec => (Array.isArray(value) ? (value as Vec) : value && typeof value === 'object' && 'k' in (value as object) ? ((value as { k: { v: Vec }[] }).k[0]?.v ?? fallback) : fallback);
const staticNum = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : value && typeof value === 'object' && 'k' in (value as object) ? ((value as { k: { v: number }[] }).k[0]?.v ?? fallback) : fallback);

export async function runCharacterTool(name: string, args: Args, ctx: MotionToolContext, run: Run, words: (compId?: string) => Promise<TranscriptWord[]>): Promise<ToolResult> {
  switch (name) {
    case 'list_character_actions': {
      const saved = savedCharacters().map((c) => c.name);
      const examples = (await presetCharacters()).map((c) => c.name);
      return done(`Library characters: ${saved.length ? `saved ${saved.join(', ')}; ` : 'none saved yet; '}examples ${examples.join(', ') || '(the library could not be loaded)'} (list_characters describes each). ${CASTING} Every character takes the same actions: place one with create_character, then animate_character with timed actions (scene seconds, scene px). Library characters use smooth motion or their saved 24/12 fps cadence; built-in rigs default to on twos. Blinks are automatic.`, {
        library: { saved, examples }, builtIn: CHARACTER_KINDS, characters: CHARACTER_KINDS, actions: ACTIONS.map((a) => ({ do: a, what: ACTION_HELP[a] })), expressions: EXPRESSIONS,
      });
    }

    case 'list_characters': {
      const saved = savedCharacters();
      const examples = await presetCharacters();
      const query = str(args, 'query')?.toLowerCase();
      const row = (spec: StudioSpec) => ({ name: spec.name, look: describeCharacter(spec) });
      const pick = (list: StudioSpec[]) => list.map(row).filter((r) => !query || `${r.name} ${r.look}`.toLowerCase().includes(query));
      const full = args.full === true;
      return done(`The user's character library: ${saved.length} saved, ${examples.length} examples${examples.length ? '' : ' (the examples could not be loaded)'}. ${CASTING}`, {
        saved: full ? saved : pick(saved),
        examples: full ? examples : pick(examples),
        builtIn: CHARACTER_KINDS,
        specFormat: 'name, age (kid|teen|adult|senior), body (masc|fem|neutral), build (slim|average|round), shape (classic|noodle|chunky|tall|tiny), skin, face {shape, eyes, eyeColor, brows, nose, mouth, facialHair}, hair {style, color}, top/outer/bottom/shoes {kind, color, pattern?}, acc [...], stance, optional motion2d {timing: smooth|film|drawn, energy: 0.35–1.6, secondary: 0–1.5, ink: boolean}. full:true returns every spec to copy from.',
      });
    }

    case 'create_character': {
      const comp = ctx.pickComp(ctx.project, args);
      if (!comp) return fail('There is no composition to place the character in.');
      const wanted = str(args, 'character');
      // A library character (by name), a new design (spec), or a built-in rig.
      let spec: StudioSpec | null = null;
      let from = '';
      const givenSpec = normalizeSpec(args.spec);
      const look = normalizeSpec(args.look);
      if (givenSpec) {
        spec = givenSpec as StudioSpec;
        if (wanted && !spec.name) spec.name = wanted;
        from = 'new design';
      } else if (wanted && !(CHARACTER_KINDS as readonly string[]).includes(wanted)) {
        const found = await findLibraryCharacter(wanted);
        if (!found) {
          const names = [...savedCharacters().map((c) => c.name), ...(await presetCharacters()).map((c) => c.name)].filter(Boolean);
          return fail(`No character "${wanted}" in the library. Library: ${names.join(', ') || '(empty)'}; built-in rigs: ${CHARACTER_KINDS.join(', ')}. Or design one with spec.`);
        }
        spec = found.spec;
        from = found.from === 'saved' ? 'saved character' : 'library example';
      }
      if (spec && look) spec = merge(spec, look) as StudioSpec;
      if (spec && args.save === true) {
        if (!spec.name) return fail('Give the new character a name (spec.name) to save it to the library.');
        await saveToLibrary(spec);
      }
      // The built-in rigs are a style of their own: used when the user asks for them, never
      // instead of the characters they made (or the library's examples).
      if (!spec && ctx.prompt && !RIG_ASKED.test(ctx.prompt)) {
        const saved = savedCharacters().map((c) => c.name);
        const examples = (await presetCharacters()).map((c) => c.name);
        if (saved.length || examples.length) {
          return fail(`Cast from the user's character library instead of the built-in ${wanted ?? 'dome-kid'} rig (the user did not ask for that style): ${saved.length ? `saved ${saved.join(', ')}; ` : ''}examples ${examples.join(', ')}. Call list_characters to see how each looks, then create_character {"character":"<name>"} (look for small changes). Design a new one with spec only when nothing fits a specific request.`);
        }
      }
      const kind = spec ? STUDIO_KIND : ((wanted ?? 'dome-kid') as CharacterKind);
      const raw = normalizeActions(args.actions);
      const bad = checkActions(raw);
      if (bad) return fail(bad);
      const at: Vec = Array.isArray(args.at) ? (args.at as Vec) : [comp.width / 2, comp.height * 0.9];
      const height = num(args, 'height') ?? comp.height * 0.5;
      if (spec) await loadStudio();
      const scale = Math.round((height / (spec ? studioHeight(spec) : standingHeight(kind as CharacterKind))) * 10000) / 100;
      const label = spec ? String(spec.name ?? 'Character') : kind;
      const character: CharacterData = {
        kind,
        ...(spec ? { spec } : {}),
        ...(!spec && args.palette && typeof args.palette === 'object' ? { palette: args.palette as CharacterData['palette'] } : {}),
        actions: toCharacterSpace(raw, at, scale),
        ...(num(args, 'step') !== undefined ? { step: num(args, 'step') as 1 | 2 | 3 } : spec ? {} : { step: 2 as const }),
        ...(str(args, 'expression') ? { expression: str(args, 'expression') as CharacterData['expression'] } : {}),
        ...(num(args, 'facing') === -1 ? { facing: -1 } : {}),
      };
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'library';
      let id = str(args, 'id') ?? `char-${spec ? slug : kind}`;
      const who = spec ? `${label} (${from})` : kind;
      const clipId = str(args, 'clipId');
      if (clipId) {
        // A second copy of the same character (a twin, a crowd) gets the next free id rather than
        // failing the scene's unique-id check.
        const got = await run('get_motion_scene', { clipId, full: true }, ctx);
        const scene = (got as { scene?: MotionScene }).scene;
        if (scene) {
          const taken = layerIds(scene);
          const base = id;
          for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        }
      }
      const layer: Layer = { id, name: str(args, 'name') ?? label, type: 'character', transform: { anchor: [...CHARACTER_FEET], position: at, scale }, character };
      if (clipId) {
        const updated = await run('update_motion_scene', { clipId, addLayers: [layer], fit: false }, ctx);
        if (!updated.ok) return updated;
        return done(`Added ${who} "${id}" to the scene, feet at [${at.map(Math.round).join(', ')}], ${Math.round(height)} px tall, with ${raw.length} action(s). Animate it with animate_character {"clipId":"${clipId}","layerId":"${id}","actions":[…]}.`, { ...updated, layerId: id });
      }
      const last = character.actions!.reduce((m, a) => Math.max(m, a.t + characterActionDuration(character, a)), 0);
      const duration = num(args, 'duration') ?? Math.max(3, last + 1);
      const layers: Layer[] = [];
      if (str(args, 'stage')) layers.push({ id: 'stage', name: 'Stage', type: 'solid', color: str(args, 'stage')! });
      layers.push(layer);
      const scene: MotionScene = { version: 1, width: comp.width, height: comp.height, duration, layers };
      const placed = await run('create_motion_scene', { ...(args.compId ? { compId: args.compId } : {}), scene, start: num(args, 'start') ?? 0, title: str(args, 'title') ?? `Character · ${label}`, duration, fit: false, useBrand: false }, ctx);
      if (!placed.ok) return placed;
      return done(`${placed.summary} The character, ${who}, is layer "${id}"; animate it with animate_character {"clipId":"${(placed as { clipId?: string }).clipId}","layerId":"${id}","actions":[…]}, and lip_sync_character for the voice-over.`, { ...placed, layerId: id });
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
        const raw = normalizeActions(args.actions);
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
