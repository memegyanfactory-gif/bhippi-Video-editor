// Auto-fix before a template builds (docs/TRAIN-AND-TEMPLATES-PLAN.md Part B): the input weaker
// models send, made into what the template takes, with every change reported so the model and
// the user know. Other words for a slot become the slot; a list sent as one string is split;
// numbers written as text are read; a colour by name becomes its hex, and one too dark for the
// plate is lightened; text a little too long is set smaller to fit its box; a list longer than the
// template shows is cut, saying so; text for a slot the template lacks moves to a free one. What
// cannot be fixed without changing the user's words — text far too long, a chart with fewer
// values than bars — is refused with the limit, so the next call gets it right.
import type { Adjustment } from './templateEval';
import { SLOT_ALIASES, type ListSlot, type SlotSchema, type TextSlot } from './templateSlots';

/** Text is never set smaller than this share of its design size; longer text is refused. */
export const MIN_FIT = 0.6;

const NAMED: Record<string, string> = {
  red: '#e5484d', crimson: '#dc143c', scarlet: '#ff2400', maroon: '#a0303a', burgundy: '#9f1239', orange: '#f97316', amber: '#f59e0b', yellow: '#facc15', gold: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', mint: '#6ee7b7', teal: '#14b8a6', turquoise: '#40e0d0', cyan: '#06b6d4', aqua: '#22d3ee', sky: '#38bdf8', 'sky blue': '#38bdf8',
  blue: '#3b82f6', navy: '#1e3a8a', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', lavender: '#c4b5fd', magenta: '#d946ef', fuchsia: '#d946ef', pink: '#ec4899', 'hot pink': '#ff4fa3',
  rose: '#f43f5e', coral: '#ff7f50', salmon: '#fa8072', peach: '#ffb38a', brown: '#b45309', beige: '#f5f5dc', cream: '#fff7e0', white: '#ffffff', black: '#000000', grey: '#9ca3af', gray: '#9ca3af', silver: '#c0c0c0',
};

/** #rrggbb for a hex (3 or 6 digits, with or without #), rgb(), or a colour name; null otherwise. */
export function toHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const six = /^#?([0-9a-f]{6})$/.exec(v);
  if (six) return `#${six[1]}`;
  const three = /^#?([0-9a-f]{3})$/.exec(v);
  if (three) return `#${three[1].split('').map((c) => c + c).join('')}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  const name = v.replace(/^(dark|deep|light|bright|brand)\s+/, '');
  return NAMED[v] ?? NAMED[name] ?? null;
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const lum = (hex: string) => {
  const [r, g, b] = [0, 1, 2].map((i) => { const s = channel(hex, i) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastOf = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** `hex` lightened toward white (keeping its hue) until it reads at 3:1 on `plate`. */
export function readableOn(hex: string, plate: string, ratio = 3): string {
  let out = hex;
  for (let step = 1; step <= 20 && contrastOf(out, plate) < ratio; step++) {
    const t = step / 20;
    // Near-black has no hue to keep: lift it by brightening its strongest channel first.
    out = `#${[0, 1, 2].map((i) => Math.round(channel(hex, i) + (255 - channel(hex, i)) * t * (i === maxChannel(hex) ? 1 : 0.55)).toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
}
const maxChannel = (hex: string) => [0, 1, 2].reduce((best, i) => (channel(hex, i) > channel(hex, best) ? i : best), 0);

/** A number from what a model writes: 12, "12", "$12M", "1,200", "45%". */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(value.replace(/\s/g, ''));
  return m ? Number(m[0].replace(/,/g, '')) : undefined;
}

/** Seconds from 5, "5", "5s", "5 sec", "1.5 seconds", "500ms", "0:05". */
export function toSeconds(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(v);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const n = toNumber(v);
  if (n === undefined) return undefined;
  return /ms$|millisecond/.test(v) ? n / 1000 : /m(in|inute)?s?$/.test(v) && !/ms$/.test(v) ? n * 60 : n;
}

const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ') || undefined;
  if (value && typeof value === 'object') { const o = value as Record<string, unknown>; return textOf(o.text ?? o.title ?? o.label ?? o.name); }
  return undefined;
};
/** A list from what a model sends: an array (of strings or {title, detail} objects) or one string of lines, semicolons or commas. */
export const listOf = (value: unknown): string[] | undefined => {
  // One string in an array (the tool runner wraps a string sent for an array slot) is read as the string.
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') return listOf(value[0]);
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const head = textOf(o.title ?? o.heading ?? o.label ?? o.name ?? o.text);
        const detail = textOf(o.detail ?? o.description ?? o.body ?? o.subtitle ?? o.value);
        return head && detail ? `${head} — ${detail}` : head ?? detail;
      }
      return textOf(item);
    }).filter((item): item is string => !!item);
    return items.length ? items : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim();
  // Lines, semicolons or bullets first; commas only when nothing else separates the items.
  const parts = /\n|;|•|\s\|\s/.test(v) ? v.split(/\s*(?:\n|;|•|\s\|\s)\s*/) : v.split(/\s*,\s*/);
  return parts.map((p) => p.replace(/^[-*\d.)\s]+(?=\S)/, (m) => (/^\d+[.)]\s/.test(m) || /^[-*]\s/.test(m) ? '' : m)).trim()).filter(Boolean);
};
const numbersOf = (value: unknown): number[] | undefined => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : typeof value === 'number' ? [value] : [];
  const out = raw.map(toNumber).filter((n): n is number => n !== undefined);
  return out.length ? out : undefined;
};
const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
/** Text-like slots a model sends to any template. */
const TEXT_KEYS = ['title', 'subtitle', 'kicker', 'badge', 'metric'];

export type FixResult = { args: Record<string, unknown>; adjustments: Adjustment[]; notes: string[]; error?: string };

/**
 * `input` (a template's params as the model sent them) made to fit `schema`. `plate`: the colour
 * behind the graphic, for the contrast guard. `template` names it in messages.
 */
export function fixTemplateArgs(template: string, schema: SlotSchema, input: Record<string, unknown>, opts: { plate?: string; colourKeys?: string[] } = {}): FixResult {
  const args: Record<string, unknown> = { ...input };
  const adjustments: Adjustment[] = [];
  const notes: string[] = [];
  const note = (slot: string, action: string, text: string, scale?: number) => { adjustments.push({ slot, action, ...(scale !== undefined ? { scale } : {}) }); notes.push(text); };

  // Other words for a slot become the slot, when the template has no slot by that word.
  for (const slot of Object.keys(schema)) {
    if (!empty(args[slot])) continue;
    const alias = (SLOT_ALIASES[slot] ?? []).find((word) => !(word in schema) && !empty(args[word]));
    if (!alias) continue;
    args[slot] = args[alias];
    delete args[alias];
    note(slot, 'renamed', `"${alias}" read as ${slot}`);
  }

  if (args.duration !== undefined && typeof args.duration !== 'number') {
    const seconds = toSeconds(args.duration);
    if (seconds !== undefined && seconds > 0) { note('duration', 'read', `duration "${String(args.duration)}" read as ${seconds} s`); args.duration = seconds; } else delete args.duration;
  }

  // A number the template needs as its metric ("10" for a countdown), sent as the title, or only
  // as the length of a countdown.
  if (schema.metric?.kind === 'text' && schema.metric.required && empty(args.metric)) {
    const title = textOf(args.title);
    if (title && /^[\d$€£]?[\d.,:]+[%kmb+]?$/i.test(title)) { args.metric = title; delete args.title; note('metric', 'moved', `the title "${title}" is a number, shown as the metric`); }
    else if (template === 'countdown' && typeof args.duration === 'number' && args.duration >= 1) { args.metric = String(Math.round(args.duration)); note('metric', 'filled', `counting down from ${args.metric} (the duration)`); }
  }

  for (const [slot, spec] of Object.entries(schema)) {
    const value = args[slot];
    if (empty(value)) continue;
    switch (spec.kind) {
      case 'text':
      case 'word': {
        const text = textOf(value);
        if (text === undefined) { delete args[slot]; break; }
        args[slot] = spec.kind === 'word' ? text.split(/\s+/)[0] : text;
        break;
      }
      case 'list': {
        const list = listOf(value);
        if (!list) { delete args[slot]; break; }
        if (typeof value === 'string' || (Array.isArray(value) && value.length === 1 && list.length > 1)) note(slot, 'split', `${slot} sent as one string, split into ${list.length} item${list.length === 1 ? '' : 's'}`);
        args[slot] = list;
        break;
      }
      case 'numbers': {
        const numbers = numbersOf(value);
        if (!numbers) { delete args[slot]; break; }
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'number')) note(slot, 'read', `${slot} read as numbers: ${numbers.join(', ')}`);
        args[slot] = numbers;
        break;
      }
      case 'number': {
        let n = toNumber(value);
        if (n === undefined) { delete args[slot]; notes.push(`${slot} "${String(value)}" is not a number, left out`); break; }
        if (spec.integer) n = Math.round(n);
        const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
        if (clamped !== n) note(slot, 'clamped', `${slot} ${n} kept within ${spec.min}–${spec.max} (${clamped})`);
        args[slot] = clamped;
        break;
      }
      case 'choice': {
        const hit = spec.values.find((v) => v.toLowerCase() === String(value).trim().toLowerCase());
        if (hit) args[slot] = hit; else { delete args[slot]; note(slot, 'ignored', `${slot} "${String(value)}" is not one of ${spec.values.join(', ')}; the default is used`); }
        break;
      }
      case 'boolean':
        if (typeof value === 'string') args[slot] = !/^(false|no|off|0)$/i.test(value.trim());
        break;
      default:
        break;
    }
  }

  // Colours: names and short forms to hex; too dark for the plate, lightened.
  for (const key of [...Object.entries(schema).filter(([, s]) => s.kind === 'color').map(([k]) => k), ...(opts.colourKeys ?? [])]) {
    if (typeof args[key] !== 'string' || !String(args[key]).trim()) continue;
    const given = String(args[key]).trim();
    const hex = toHex(given);
    if (!hex) { delete args[key]; note(key, 'ignored', `colour "${given}" not understood (give #rrggbb); the theme colour is used`); continue; }
    let out = hex;
    if (hex.toLowerCase() !== given.toLowerCase() && `#${given.toLowerCase()}` !== hex) note(key, 'mapped', `colour "${given}" read as ${hex}`);
    if (opts.plate && contrastOf(hex, opts.plate) < 3) { out = readableOn(hex, opts.plate); note(key, 'lightened', `colour ${hex} is too dark to read on the ${opts.plate} plate, lightened to ${out}`); }
    args[key] = out;
  }

  // Text for a slot this template lacks moves to a free one, or is reported as not shown.
  for (const key of TEXT_KEYS) {
    if (key in schema || empty(args[key])) continue;
    const text = textOf(args[key])!;
    const free = ['subtitle', 'kicker', 'title'].find((slot) => schema[slot]?.kind === 'text' && empty(args[slot]) && text.length <= (schema[slot] as TextSlot).max / MIN_FIT);
    delete args[key];
    if (free) { args[free] = text; note(free, 'moved', `${template} has no ${key}; its text shows as the ${free}`); } else note(key, 'ignored', `${template} has no ${key} and no free slot for it, so "${text.slice(0, 40)}" is not shown`);
  }

  // Fit: a list longer than the template shows is cut; long text is set smaller, down to MIN_FIT.
  for (const [slot, spec] of Object.entries(schema)) {
    if (spec.kind === 'list' && Array.isArray(args[slot])) {
      let items = args[slot] as string[];
      const list = spec as ListSlot;
      if (items.length > list.maxItems) {
        note(slot, 'clamped', `${slot}: ${template} shows ${list.maxItems}, so the last ${items.length - list.maxItems} of ${items.length} are left out — put them in a second graphic`);
        items = items.slice(0, list.maxItems);
        args[slot] = items;
      }
      if (list.min && items.length < list.min) return { args, adjustments, notes, error: `${template} needs at least ${list.min} ${slot} (got ${items.length}).` };
      const longest = Math.max(...items.map((item) => item.length));
      if (longest > list.itemMax / MIN_FIT) return { args, adjustments, notes, error: `A ${slot} item is ${longest} characters; ${template} fits ${list.itemMax} per item (${Math.floor(list.itemMax / MIN_FIT)} at its smallest type). Shorten the items to at most ${Math.floor(list.itemMax / MIN_FIT)} characters, or use "Heading — detail" with a short heading.` };
      if (longest > list.itemMax) { const scale = Math.floor((list.itemMax / longest) * 100) / 100; note(slot, 'shrunk', `${slot} set at ${Math.round(scale * 100)}% size to fit`, scale); }
    }
    if (spec.kind === 'text' && typeof args[slot] === 'string') {
      const text = args[slot] as string;
      if (text.length > spec.max / MIN_FIT) return { args, adjustments, notes, error: `${slot} is ${text.length} characters; ${template} fits ${spec.max} (${Math.floor(spec.max / MIN_FIT)} at its smallest type). Shorten ${slot} to at most ${Math.floor(spec.max / MIN_FIT)} characters${spec.max >= 30 ? ' or split it across two graphics' : ''}.` };
      if (text.length > spec.max) { const scale = Math.floor((spec.max / text.length) * 100) / 100; note(slot, 'shrunk', `${slot} set at ${Math.round(scale * 100)}% size to fit`, scale); }
    }
  }

  // A value per bar: extra values are cut; missing ones are asked for.
  const rows = Array.isArray(args.rows) ? (args.rows as string[]) : null;
  if (schema.values && rows && Array.isArray(args.values)) {
    const values = args.values as number[];
    if (values.length > rows.length) { args.values = values.slice(0, rows.length); note('values', 'clamped', `values: ${values.length} for ${rows.length} bars, the extra ${values.length - rows.length} left out`); }
    if (values.length < rows.length) return { args, adjustments, notes, error: `${template} needs one value per row: ${rows.length} rows, ${values.length} values.` };
  }
  return { args, adjustments, notes };
}

/** The per-slot type scale the builder applies, from the fix's "shrunk" adjustments. */
export const fitScales = (adjustments: Adjustment[]): Record<string, number> =>
  Object.fromEntries(adjustments.filter((a) => a.action === 'shrunk' && a.scale).map((a) => [a.slot, a.scale!]));

export const fixSummary = (notes: string[]) => (notes.length ? ` Auto-fixed: ${notes.join('; ')}.` : '');
