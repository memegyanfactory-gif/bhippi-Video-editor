// Typed slots for the house (Crimson) templates and the brand motion templates: what each one
// takes, what it needs, and how much fits (docs/TRAIN-AND-TEMPLATES-PLAN.md Part B). The limits are
// the template's own type size against its box at 1920 wide (about half an em per character, the
// lines the design allows), so text within them never runs out of the box. The eval
// (lib/templateEval.ts) scores builds against them and the auto-fix (lib/templateFix.ts) applies them.

export type TextSlot = { kind: 'text'; required?: boolean; max: number; hint?: string };
export type ListSlot = { kind: 'list'; required?: boolean; min?: number; maxItems: number; itemMax: number; hint?: string };
export type NumberSlot = { kind: 'number'; required?: boolean; min?: number; max?: number; integer?: boolean; hint?: string };
export type NumbersSlot = { kind: 'numbers'; required?: boolean; maxItems: number; hint?: string };
export type ColorSlot = { kind: 'color'; hint?: string };
export type WordSlot = { kind: 'word'; hint?: string };
export type ChoiceSlot = { kind: 'choice'; values: string[]; hint?: string };
export type BoolSlot = { kind: 'boolean'; hint?: string };
/** Footage, points, nested objects: passed through as given. */
export type AnySlot = { kind: 'any'; required?: boolean; hint?: string };
export type Slot = TextSlot | ListSlot | NumberSlot | NumbersSlot | ColorSlot | WordSlot | ChoiceSlot | BoolSlot | AnySlot;
export type SlotSchema = Record<string, Slot>;

const kicker = (max = 28): TextSlot => ({ kind: 'text', max, hint: 'small label above the title' });
const title = (max: number): TextSlot => ({ kind: 'text', required: true, max });
const subtitle = (max: number): TextSlot => ({ kind: 'text', max });
const rows = (maxItems: number, itemMax: number, min = 1, hint = 'one short line each; "Head — detail" splits into two'): ListSlot => ({ kind: 'list', required: true, min, maxItems, itemMax, hint });
const accent: ColorSlot = { kind: 'color', hint: '#rrggbb, readable on a dark plate' };
const activeIndex = (hint = 'the row to highlight, from 0'): NumberSlot => ({ kind: 'number', min: 0, max: 5, integer: true, hint });

/** Crimson templates (create_motion_graphic). */
export const CRIMSON_SLOTS: Record<string, SlotSchema> = {
  'hook-promise': { title: { ...title(40), hint: '3–7 word promise' }, subtitle: subtitle(100), kicker: kicker(), accentColor: accent },
  'ribbon-title': { title: title(36), subtitle: subtitle(80), kicker: kicker(), accentColor: accent },
  'teaching-card': { title: title(40), subtitle: subtitle(70), kicker: kicker(24), rows: rows(4, 50, 2), metric: { kind: 'text', max: 10, hint: 'a real number as the source states it' }, activeIndex: activeIndex(), accentColor: accent },
  'side-panel': { title: title(30), subtitle: subtitle(50), kicker: kicker(24), rows: rows(5, 40, 1), activeIndex: activeIndex(), accentColor: accent },
  'connected-map': { title: title(40), kicker: { kind: 'text', max: 6, hint: 'the hub label (≤6 characters)' }, rows: rows(4, 26, 2, 'a short node name; "Name — detail" adds a line under it'), accentColor: accent },
  'numbered-lanes': { title: title(40), subtitle: subtitle(80), kicker: kicker(), rows: rows(6, 40, 2), activeIndex: activeIndex(), accentColor: accent },
  'editorial-quote': { title: { ...title(70), hint: 'one sharp sentence' }, accentWord: { kind: 'word', hint: 'one word of the title, set in serif italic' }, subtitle: subtitle(60), kicker: kicker(), accentColor: accent },
  comparison: { title: title(40), subtitle: subtitle(80), kicker: kicker(50), rows: rows(2, 60, 2, 'exactly two: side A, side B'), accentColor: accent },
  'stat-chart': { title: title(40), subtitle: subtitle(60), kicker: kicker(30), rows: rows(6, 16, 2, 'bar labels'), values: { kind: 'numbers', required: true, maxItems: 6, hint: 'one real value per row' }, activeIndex: activeIndex('the key bar, from 0'), accentColor: accent },
  'timeline-roadmap': { title: title(40), subtitle: subtitle(80), kicker: kicker(), rows: rows(6, 24, 2, 'dates or stages in order'), activeIndex: activeIndex(), accentColor: accent },
  'cursor-demo': { title: title(32), subtitle: { kind: 'text', max: 28, hint: 'one line, typed out' }, kicker: kicker(24), rows: rows(3, 24, 1), accentColor: accent },
  'chapter-marker': { title: title(28), subtitle: subtitle(36), kicker: kicker(12), accentColor: accent },
  'caption-phrase': { title: { ...title(50), hint: 'the spoken phrase' }, accentWord: { kind: 'word' }, accentColor: accent },
  'crimson-lower-third': { title: { ...title(28), hint: 'the name' }, subtitle: { kind: 'text', max: 40, hint: 'the role' }, accentColor: accent },
  'cubes-reveal': { accentColor: accent },
  countdown: { metric: { kind: 'text', required: true, max: 6, hint: 'the number counted, e.g. "10" or "3:00"' }, title: subtitle(30), accentColor: accent },
  'breaking-news': { title: title(60), subtitle: subtitle(80), badge: { kind: 'text', max: 12, hint: 'the red tag, e.g. "BREAKING"' }, accentColor: accent },
};

/** Brand motion templates (create_motion_scene; text sizes come from the kit's type scale). */
export const BRAND_SLOTS: Record<string, SlotSchema> = {
  'brand-title': { title: title(48), kicker: kicker(), subtitle: subtitle(80), accentWord: { kind: 'word' } },
  'brand-lower-third': { name: { kind: 'text', required: true, max: 28 }, role: { kind: 'text', max: 40 } },
  'brand-stat': { value: { kind: 'number', required: true, hint: 'the real number' }, prefix: { kind: 'text', max: 3 }, suffix: { kind: 'text', max: 4 }, decimals: { kind: 'number', min: 0, max: 3, integer: true }, label: { kind: 'text', max: 40 } },
  'brand-panel': { title: title(30), points: { kind: 'list', maxItems: 5, itemMax: 40 }, side: { kind: 'choice', values: ['left', 'right'] } },
  'brand-logo-sting': { name: { kind: 'text', max: 24 }, tagline: { kind: 'text', max: 48 } },
  'brand-end-card': { headline: { kind: 'text', required: true, max: 40 }, cta: { kind: 'text', max: 24 }, accentWord: { kind: 'word' }, handle: { kind: 'text', max: 30 } },
};

/**
 * A slot from a motion-kit template's prose description ("number 0.2–3 (1) — how many particles",
 * "string[] (≤5)", '"left" | "right"', "footage { asset, in } — … (required)"), so every kit template
 * has a typed schema without a hand-written one.
 */
export function slotFromProse(prose: string): Slot {
  const text = prose.trim();
  const hint = text.includes('—') ? text.slice(text.indexOf('—') + 1).trim() : undefined;
  const head = text.split('—')[0].trim();
  const required = /\(required\)/i.test(text);
  // The quoted values outside the parenthesised default: '"left" | "right" ("right")'.
  const choices = [...new Set([...head.replace(/\([^)]*\)/g, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]))];
  if (choices.length >= 2 && /\|/.test(head)) return { kind: 'choice', values: choices, hint };
  const count = /(?:≤\s*(\d+))|(?:(\d+)\s*[–-]\s*(\d+)\s*(?:items|lanes|rows|lines|words|bars|\)))/.exec(head);
  const maxItems = count ? Number(count[1] ?? count[3]) : 8;
  const fixedLength = /^string\[(\d+)\]/i.exec(head);
  if (fixedLength) return { kind: 'list', required, maxItems: Number(fixedLength[1]), itemMax: 60, hint };
  if (/^(string\[\]|list|array of string)/i.test(head)) return { kind: 'list', required, maxItems, itemMax: 60, hint };
  if (/^number\[\]/i.test(head)) return { kind: 'numbers', required, maxItems, hint };
  if (/^(number|seconds|px)\b/i.test(head)) {
    const range = /(-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)/.exec(head.replace(/\([^)]*\)/g, ''));
    return { kind: 'number', required, ...(range ? { min: Number(range[1]), max: Number(range[2]) } : {}), hint: hint ?? (/\bs\b|seconds/.test(head) ? 'seconds' : undefined) };
  }
  if (/^boolean/i.test(head)) return { kind: 'boolean', hint };
  if (/^(colou?r|ink|line colour|fill)\b/i.test(head)) return { kind: 'color', hint };
  if (/^string\b/i.test(head)) return { kind: 'text', required, max: 80, hint: hint ?? (/\(([^)]+)\)/.exec(head)?.[1]) };
  return { kind: 'any', required, hint: text.length > 90 ? `${text.slice(0, 87)}…` : text };
}

export const slotsFromProse = (params: Record<string, string>): SlotSchema => Object.fromEntries(Object.entries(params).map(([name, prose]) => [name, slotFromProse(prose)]));

/**
 * The schema of any template: the hand-measured house and brand slots (with the kit's other
 * params, like background and duration, read from its prose), or the kit template's prose read.
 */
export function slotsFor(template: string, kitParams?: Record<string, string>): SlotSchema | undefined {
  if (CRIMSON_SLOTS[template]) return CRIMSON_SLOTS[template];
  if (BRAND_SLOTS[template]) return { ...(kitParams ? slotsFromProse(kitParams) : {}), ...BRAND_SLOTS[template] };
  return kitParams ? slotsFromProse(kitParams) : undefined;
}

const loose = (id: string) => id.toLowerCase().replace(/\btemplate\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The template a loosely written id means ("Hook promise", "HOOK_PROMISE", "stat chart"): an exact
 * id, the same id spelled another way, a label, or the one id containing it. Null when unsure.
 */
export function resolveTemplateId(input: string, templates: { id: string; label?: string }[]): string | null {
  if (templates.some((t) => t.id === input)) return input;
  const want = loose(input);
  if (!want) return null;
  const same = templates.find((t) => loose(t.id) === want || (t.label && loose(t.label) === want));
  if (same) return same.id;
  // Part of an id only counts when it is more than one word ("lower third"): "title" is in too many.
  const containing = templates.filter((t) => want.includes(loose(t.id)) || (want.includes('-') && loose(t.id).includes(want)));
  return containing.length === 1 ? containing[0].id : null;
}

/** The required slots `args` leaves empty. */
export function missingSlots(schema: SlotSchema, args: Record<string, unknown>): string[] {
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  return Object.entries(schema).filter(([name, slot]) => 'required' in slot && slot.required && slot.kind !== 'any' && empty(args[name])).map(([name]) => name);
}

/** Words a weaker model uses for a slot, mapped to the slot's name (per template, only when it has that slot). */
export const SLOT_ALIASES: Record<string, string[]> = {
  title: ['text', 'heading', 'headline', 'name', 'label', 'caption', 'quote', 'main'],
  subtitle: ['subheading', 'subhead', 'description', 'body', 'role', 'tagline', 'sub', 'detail'],
  kicker: ['eyebrow', 'overline', 'tag', 'label'],
  rows: ['items', 'bullets', 'points', 'list', 'steps', 'lines', 'labels', 'options'],
  points: ['items', 'bullets', 'rows', 'list', 'steps', 'lines'],
  values: ['numbers', 'data', 'stats'],
  metric: ['number', 'value', 'stat', 'count'],
  accentColor: ['accent', 'color', 'colour', 'accentColour', 'brandColor'],
  name: ['title', 'text', 'person'],
  role: ['subtitle', 'job', 'position', 'description'],
  headline: ['title', 'text', 'heading'],
  cta: ['callToAction', 'button', 'action'],
  value: ['number', 'metric', 'stat'],
  label: ['caption', 'title', 'text'],
  badge: ['tag'],
  activeIndex: ['active', 'highlight', 'current', 'selected'],
};

/** One line per slot, as a model reads it: `title (text, required, ≤40 chars: 3–7 word promise)`. */
export function describeSlots(schema: SlotSchema): string {
  return Object.entries(schema).map(([name, slot]) => {
    const need = 'required' in slot && slot.required ? ', required' : '';
    const shape = slot.kind === 'text' ? `text${need}, ≤${slot.max} chars`
      : slot.kind === 'list' ? `list${need}, ${slot.min && slot.min > 1 ? `${slot.min}–` : '≤'}${slot.maxItems} items, ≤${slot.itemMax} chars each`
        : slot.kind === 'number' ? `number${need}${slot.min !== undefined && slot.max !== undefined ? `, ${slot.min}–${slot.max}` : ''}`
          : slot.kind === 'numbers' ? `numbers${need}, ≤${slot.maxItems}`
            : slot.kind === 'choice' ? slot.values.map((v) => `"${v}"`).join(' | ')
              : slot.kind === 'any' ? `object${need}` : slot.kind;
    return `${name} (${shape}${slot.hint ? `: ${slot.hint}` : ''})`;
  }).join('; ');
}
