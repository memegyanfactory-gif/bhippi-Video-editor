// Brand kits come in from places that do not share the BrandKit types: an AI tool call (some
// providers send every list as {"item": [...]} and every number as a string), a pasted JSON file,
// a settings file an older Bhippi or a coding agent wrote. `repairKit` fits such a value to the
// shape of a known-good kit, so every reader can trust the types (a string where a list belongs
// used to take the whole Brand kit panel down).
//
// Only what disagrees with the shape changes: a value that fits is kept as the same object, so a
// kit that needed nothing comes back identical (===) and React memos stay stable.

import { normalizeGradients } from './gradients';
import { LEARNING_AREAS, type KitLearning, type TrainingSource } from './learnings';
import type { BrandAsset, BrandColorToken, BrandKit, BrandLogo, ColorRole } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim());

/** List fields read one entry per line (their sentences hold commas); every other list is comma separated. */
const LINE_LISTS = new Set(['rules', 'samples', 'principles', 'captionRules', 'endCard', 'doNots', 'photography', 'dos', 'donts']);
const ROLES = new Set<ColorRole>(['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'success', 'warning', 'error', 'info', 'neutral', 'custom']);
/** The kit's guideline has its own checks (guideline.ts: refineGuideline, guidelineOf). */
const OWN_READERS = new Set(['guideline']);
/** Fields whose type allows null ("none set"). */
const NULLABLE = new Set(['animateCss', 'openPropsEase', 'daisyTheme', 'openPropsHue', 'voice', 'voiceMode', 'captionStyle', 'assetId', 'path', 'svg', 'dataUrl']);

const LOGO: BrandLogo = { id: '', role: 'primary', assetId: null, path: null, svg: null, dataUrl: null, clearSpace: 1, minSize: 64, placement: 'bottom-right', on: 'any', doNots: [] };
const ASSET: BrandAsset = { id: '', kind: 'other', name: '', assetId: null, path: null, tags: [], notes: '' };
const LEARNING: KitLearning = { id: '', area: 'do', text: '', sourceIds: [], confidence: 0.5, status: 'active', addedAt: '', updatedAt: '' };
const SOURCE: TrainingSource = { id: '', kind: 'file', label: '', addedAt: '' };
const SOURCE_KINDS = new Set(['video', 'link', 'image', 'website', 'timeline', 'file']);

function parseJson(text: string): unknown {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `value` with every {"item": [...]} list inside it made a plain list, at any depth: the shape
 * code that has its own checks (the guideline) then sees lists where it expects them.
 */
export function unwrapToolLists(value: unknown): unknown {
  const v = unwrapList(value);
  if (Array.isArray(v)) {
    const out = v.map(unwrapToolLists);
    return v === value && out.every((item, i) => item === v[i]) ? value : out;
  }
  if (!isRecord(v)) return v;
  let out: Record<string, unknown> | null = null;
  for (const [key, inner] of Object.entries(v)) {
    const next = unwrapToolLists(inner);
    if (next !== inner) (out ??= { ...v })[key] = next;
  }
  return out ?? v;
}

/** {"item": [...]} (or "items"), the way XML-style tool calls carry a list. */
function unwrapList(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && (keys[0] === 'item' || keys[0] === 'items')) {
    const inner = value[keys[0]];
    return Array.isArray(inner) ? inner : [inner];
  }
  return value;
}

/** A list from whatever carried it, or undefined when it is not one. */
function asList(value: unknown, key: string): unknown[] | undefined {
  let v = unwrapList(value);
  if (typeof v === 'string') {
    const parsed = parseJson(v);
    if (Array.isArray(parsed)) v = parsed;
    else return v.split(LINE_LISTS.has(key) ? /\n/ : /[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return Array.isArray(v) ? v : undefined;
}

type Ctx = { issues: string[] };

/** `value` fitted to `shape` (a known-good value of the same field). */
function fit(value: unknown, shape: unknown, key: string, path: string, ctx: Ctx): unknown {
  if (value === undefined) return shape;
  if (value === null && NULLABLE.has(key)) return null;
  // A nullable field (audio.voice, colors.daisyTheme) or one the shape does not have: nothing to fit.
  if (shape === undefined || shape === null) return value;

  if (Array.isArray(shape)) {
    const sample = shape[0];
    // A range written as text ("118-124 BPM") carries its numbers in order.
    const text = unwrapList(value);
    const list = typeof sample === 'number' && typeof text === 'string' && !parseJson(text) ? (text.match(/\d+(?:\.\d+)?/g) ?? []) : asList(value, key);
    if (!list) {
      ctx.issues.push(`${path} must be a list`);
      return shape;
    }
    let out: unknown[];
    if (typeof sample === 'number') {
      out = list.map((item) => (typeof item === 'number' ? item : typeof item === 'string' && item.trim() ? Number(item) : NaN));
      if (out.some((n) => !Number.isFinite(n as number)) || out.length !== shape.length) {
        ctx.issues.push(`${path} must be ${shape.length} numbers`);
        return shape;
      }
    } else if (isRecord(sample)) {
      out = list.filter(isRecord).map((item, i) => fit(item, sample, key, `${path}[${i}]`, ctx));
    } else {
      // A list of words or lines (or an empty default, which is always one in a kit).
      out = list.flatMap((item) => (typeof item === 'string' ? (item.trim() ? [item] : []) : typeof item === 'number' || typeof item === 'boolean' ? [String(item)] : []));
    }
    return out.length === list.length && list === value && out.every((item, i) => item === list[i]) ? value : out;
  }

  if (isRecord(shape)) {
    let v = value;
    if (typeof v === 'string') {
      const parsed = parseJson(v);
      if (isRecord(parsed)) v = parsed;
    }
    if (!isRecord(v)) {
      ctx.issues.push(`${path} must be an object`);
      return shape;
    }
    let out: Record<string, unknown> | null = v === value ? null : { ...v };
    for (const field of Object.keys(shape)) {
      const next = fit(v[field], shape[field], field, `${path}.${field}`, ctx);
      if (next !== v[field]) {
        out ??= { ...v };
        out[field] = next;
      }
    }
    return out ?? v;
  }

  if (typeof shape === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
    ctx.issues.push(`${path} must be a number`);
    return shape;
  }
  if (typeof shape === 'string') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    ctx.issues.push(`${path} must be text`);
    return shape;
  }
  if (typeof shape === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    ctx.issues.push(`${path} must be true or false`);
    return shape;
  }
  return value;
}

/** A saved gradient that already reads as `g` (key order aside: the backend sorts keys). */
function sameGradient(g: { name: string; angle: number; stops: string[]; usage: string }, saved: unknown): boolean {
  return isRecord(saved) && saved.name === g.name && saved.angle === g.angle && saved.usage === g.usage && Array.isArray(saved.stops) && saved.stops.length === g.stops.length && g.stops.every((stop, i) => stop === (saved.stops as unknown[])[i]);
}

function fitTokens(value: unknown, shape: BrandColorToken[], ctx: Ctx): BrandColorToken[] {
  const list = asList(value, 'tokens');
  if (!list) {
    ctx.issues.push('colors.tokens must be a list');
    return shape;
  }
  let changed = list !== value;
  const out = list.flatMap((item, i): BrandColorToken[] => {
    if (!isRecord(item) || !isHex(item.hex)) {
      ctx.issues.push(`colors.tokens[${i}] has no 6-digit hex`);
      changed = true;
      return [];
    }
    const token: BrandColorToken = {
      name: typeof item.name === 'string' && item.name.trim() ? item.name : `Colour ${i + 1}`,
      hex: item.hex.trim(),
      role: ROLES.has(item.role as ColorRole) ? (item.role as ColorRole) : 'custom',
      usage: typeof item.usage === 'string' ? item.usage : '',
    };
    if (token.name !== item.name || token.hex !== item.hex || token.role !== item.role || token.usage !== item.usage) {
      changed = true;
      return [{ ...item, ...token }];
    }
    return [item as BrandColorToken];
  });
  // Too few usable colours to draw with: the kit keeps the ones it had.
  if (out.length < 4) {
    ctx.issues.push('colors.tokens needs at least 4 colours with a 6-digit hex');
    return shape;
  }
  return changed ? out : (value as BrandColorToken[]);
}

function fitRecords<T extends { id: string }>(value: unknown, sample: T, key: string, ctx: Ctx, idPrefix: string): T[] | undefined {
  const list = asList(value, key);
  if (!list) {
    ctx.issues.push(`${key} must be a list`);
    return undefined;
  }
  let changed = list !== value;
  const out = list.flatMap((item, i): T[] => {
    if (!isRecord(item)) {
      changed = true;
      return [];
    }
    let fitted = fit(item, sample, key, `${key}[${i}]`, ctx) as T;
    if (!fitted.id) fitted = { ...fitted, id: `${idPrefix}_${i}_${Math.random().toString(36).slice(2, 8)}` };
    if (fitted !== item) changed = true;
    return [fitted];
  });
  return changed ? out : (value as T[]);
}

/**
 * `raw` fitted to the shape of `base` (a well-formed kit: the kit before an edit, or a fresh kit in
 * the same style). Returns the kit — the same object when nothing needed repair — and a readable
 * line for every value that could not be used as given.
 */
export function repairKit(raw: Record<string, unknown>, base: BrandKit): { kit: BrandKit; issues: string[] } {
  const ctx: Ctx = { issues: [] };
  let out: Record<string, unknown> | null = null;
  const set = (field: string, next: unknown) => {
    if (next === raw[field]) return;
    out ??= { ...raw };
    out[field] = next;
  };
  const shape = base as unknown as Record<string, unknown>;
  for (const field of Object.keys(shape)) {
    if (OWN_READERS.has(field)) continue;
    if (field === 'colors') {
      const colors = fit(raw.colors, { ...base.colors, tokens: undefined, gradients: undefined }, 'colors', 'colors', ctx) as Record<string, unknown>;
      const source = isRecord(raw.colors) ? raw.colors : {};
      const tokens = fitTokens(source.tokens ?? base.colors.tokens, base.colors.tokens, ctx);
      const gradients = source.gradients === undefined ? base.colors.gradients : normalizeGradients(unwrapList(source.gradients));
      const sameGradients = Array.isArray(source.gradients) && gradients.length === source.gradients.length && gradients.every((g, i) => sameGradient(g, (source.gradients as unknown[])[i]));
      const next = colors === source && tokens === source.tokens && sameGradients ? colors : { ...colors, tokens, gradients: sameGradients ? source.gradients : gradients };
      set('colors', next);
    } else if (field === 'logos') {
      set('logos', raw.logos === undefined ? base.logos : fitRecords(raw.logos, LOGO, 'logos', ctx, 'logo') ?? base.logos);
    } else if (field === 'assets') {
      set('assets', raw.assets === undefined ? base.assets : fitRecords(raw.assets, ASSET, 'assets', ctx, 'asset') ?? base.assets);
    } else {
      set(field, fit(raw[field], shape[field], field, field, ctx));
    }
  }
  // What /train added (optional on every kit): lists of learnings and of the references they came from.
  const fitLearnings = (field: 'learnings' | 'learningHistory') => {
    if (raw[field] === undefined) return;
    const list = fitRecords(raw[field], LEARNING, field, ctx, 'learn');
    const kept = (list ?? []).filter((learning) => learning.text.trim() && (LEARNING_AREAS as string[]).includes(learning.area) && (learning.status === 'active' || learning.status === 'off'));
    set(field, list && kept.length === list.length ? list : kept);
  };
  fitLearnings('learnings');
  fitLearnings('learningHistory');
  if (raw.sources !== undefined) {
    const list = fitRecords(raw.sources, SOURCE, 'sources', ctx, 'source');
    const kept = (list ?? []).map((source) => (SOURCE_KINDS.has(source.kind) ? source : { ...source, kind: 'file' as const }));
    set('sources', list && kept.every((source, i) => source === list[i]) ? list : kept);
  }
  return { kit: (out ?? raw) as unknown as BrandKit, issues: ctx.issues };
}
