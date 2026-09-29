// The weak-model template eval (docs/IMPROVEMENT-TODO.md item 46). Live runs on a small and a large
// model need the user's keys and cost money, so this measures the part that decides whether a
// small model's graphic looks right: the template tools, fed the input small models actually send
// (text too long for the box, colour names, lists as one string, numbers as strings, other words
// for a slot, a slot left out, a template id written loosely), and scored on what came out.
//
// A case is `good` when the graphic built with everything the model meant, fitting its box (lib/
// templateSlots.ts limits) in a readable colour; `recoverable` when the tool refused with an error
// that names what to fix, so the next call can succeed; `bad` when it built something wrong — text
// out of its box, a placeholder on screen, the model's content silently dropped, an unreadable
// colour — or refused without saying why. tests/weakModelEval.test.ts runs it and holds the score.
import { CRIMSON_TEMPLATES } from './motionGuide';
import { BRAND_SLOTS, CRIMSON_SLOTS, SLOT_ALIASES, type ListSlot, type SlotSchema, type TextSlot } from './templateSlots';

export type Profile = 'clean' | 'longish' | 'long' | 'stringly' | 'aliases' | 'extra-slots' | 'named-colour' | 'dark-colour' | 'missing' | 'loose-id';
export const PROFILES: Profile[] = ['clean', 'longish', 'long', 'stringly', 'aliases', 'extra-slots', 'named-colour', 'dark-colour', 'missing', 'loose-id'];
export const PROFILE_LABEL: Record<Profile, string> = {
  clean: 'Clean input (control)',
  longish: 'Text a bit long for the box (1.4×)',
  long: 'Text far too long for the box (2.2×)',
  stringly: 'Lists and numbers as strings',
  aliases: 'Other words for a slot',
  'extra-slots': 'Text for slots the template lacks',
  'named-colour': 'Colour by name ("red")',
  'dark-colour': 'Unreadable dark colour',
  missing: 'Required slot left out',
  'loose-id': 'Template id written loosely',
};

/** What the model meant, to check the result against. */
export type Intent = { texts: Record<string, string>; lists: Record<string, string[]>; numbers: number[]; accent?: 'red' | 'readable'; duration?: number; missing?: string[]; templateId: string };
export type EvalCase = { id: string; tool: 'create_motion_graphic' | 'create_motion_scene'; template: string; profile: Profile; args: Record<string, unknown>; intent: Intent };
/** A fix the tool reports it made (templateFix.ts): a slot shrunk to `scale`, a list clamped, a colour mapped… */
export type Adjustment = { slot: string; action: string; scale?: number };
export type Outcome = { ok: boolean; error?: string; summary?: string; texts: string[]; accent?: string; duration?: number; adjustments?: Adjustment[] };
export type Verdict = 'good' | 'recoverable' | 'bad';
export type Scored = { id: string; template: string; profile: Profile; verdict: Verdict; problems: string[] };

/** Text a template shows when it was given none: never what the model meant. */
export const PLACEHOLDERS = [
  'BHIPPI MOTION', 'Contrast — make the important thing unmistakable', 'Design — shape the meaning', 'Understand the idea',
  'Before — one long take, no hierarchy', '2019 — Idea', 'Prompt typed', 'Result ready',
];
const KIT_PLACEHOLDERS = ['Name', 'Title'];

// Made-up words, each index its own, so one slot's words never count as shown for another.
const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'be', 'da', 'fu', 'go'];
const word = (i: number) => `${SYLLABLES[i % 12]}${SYLLABLES[Math.floor(i / 12) % 12]}${SYLLABLES[Math.floor(i / 144) % 12]}`;
let nextWord = 0;
/** Fresh words up to about `chars` characters. */
function phrase(chars: number): string {
  const out: string[] = [];
  do out.push(word(nextWord++)); while (out.join(' ').length + 7 <= Math.max(6, chars));
  const text = out.join(' ');
  return text[0].toUpperCase() + text.slice(1);
}

/** The content a careful model would send for a template: every slot within its limits. */
function cleanContent(template: string, schema: SlotSchema): { args: Record<string, unknown>; intent: Intent } {
  const args: Record<string, unknown> = {};
  const intent: Intent = { texts: {}, lists: {}, numbers: [], templateId: template };
  let listLength = 0;
  for (const [name, slot] of Object.entries(schema)) {
    if (slot.kind === 'list') {
      listLength = template === 'comparison' ? 2 : Math.max(slot.min ?? 1, Math.min(3, slot.maxItems));
      const items = Array.from({ length: listLength }, () => phrase(Math.round(slot.itemMax * 0.6)));
      args[name] = items;
      intent.lists[name] = items;
    }
  }
  for (const [name, slot] of Object.entries(schema)) {
    if (slot.kind === 'text' && (slot.required || name !== 'badge')) {
      const text = name === 'metric' ? (template === 'countdown' ? '10' : '42%') : name === 'prefix' ? '$' : name === 'suffix' ? '%' : phrase(Math.round(slot.max * 0.7));
      args[name] = text;
      intent.texts[name] = text;
    } else if (slot.kind === 'numbers') {
      const values = Array.from({ length: listLength || 3 }, (_, i) => 12 + i * 17);
      args[name] = values;
      intent.numbers.push(...values);
    } else if (slot.kind === 'number' && slot.required) {
      args[name] = 37;
      intent.numbers.push(37);
    }
  }
  const words = Object.values(intent.texts).join(' ').split(/\s+/).filter((w) => w.length > 3);
  if ('accentWord' in schema && words.length && typeof args.title === 'string') args.accentWord = String(args.title).split(/\s+/).find((w) => w.length > 3) ?? words[0];
  return { args, intent };
}

const lengthen = (slot: TextSlot, times = 2.2) => phrase(Math.round(slot.max * times));

/** Every case: each Crimson template and each brand template under every profile that applies. */
export function evalCases(): EvalCase[] {
  nextWord = 0;
  const cases: EvalCase[] = [];
  const families: { tool: EvalCase['tool']; slots: Record<string, SlotSchema> }[] = [
    { tool: 'create_motion_graphic', slots: CRIMSON_SLOTS },
    { tool: 'create_motion_scene', slots: BRAND_SLOTS },
  ];
  for (const { tool, slots } of families) {
    for (const [template, schema] of Object.entries(slots)) {
      const wrap = (content: Record<string, unknown>, id = template) => (tool === 'create_motion_graphic' ? { template: id, ...content } : { template: id, params: content, sfx: false, nest: false });
      const add = (profile: Profile, content: Record<string, unknown>, intent: Intent, extra: Record<string, unknown> = {}, id = template) =>
        cases.push({ id: `${template}/${profile}`, tool, template, profile, args: { ...wrap(content, id), ...extra }, intent });
      const clean = () => cleanContent(template, schema);
      const hasText = Object.values(schema).some((slot) => slot.kind === 'text' || slot.kind === 'list');

      { const { args, intent } = clean(); add('clean', args, intent); }

      if (hasText) {
        const { args, intent } = clean();
        for (const [name, slot] of Object.entries(schema)) {
          if (slot.kind === 'text' && name in args && name !== 'metric' && slot.max >= 10) { args[name] = lengthen(slot); intent.texts[name] = String(args[name]); }
          if (slot.kind === 'list') {
            const list = slot as ListSlot;
            const items = Array.from({ length: list.maxItems + 3 }, () => phrase(list.itemMax * 2));
            args[name] = items;
            intent.lists[name] = items;
          }
        }
        add('long', args, intent);
      }

      if (hasText) {
        const { args, intent } = clean();
        for (const [name, slot] of Object.entries(schema)) {
          if (slot.kind === 'text' && name in args && name !== 'metric' && slot.max >= 10) { args[name] = lengthen(slot, 1.4); intent.texts[name] = String(args[name]); }
          if (slot.kind === 'list' && Array.isArray(args[name])) {
            const items = (args[name] as string[]).map(() => phrase(Math.round((slot as ListSlot).itemMax * 1.4)));
            args[name] = items;
            intent.lists[name] = items;
          }
        }
        add('longish', args, intent);
      }

      {
        const { args, intent } = clean();
        let changed = false;
        for (const [name, slot] of Object.entries(schema)) {
          if (slot.kind === 'list' && Array.isArray(args[name])) { args[name] = (args[name] as string[]).join(', '); changed = true; }
          if (slot.kind === 'numbers' && Array.isArray(args[name])) { args[name] = (args[name] as number[]).map(String); changed = true; }
          if (slot.kind === 'number' && typeof args[name] === 'number') { args[name] = String(args[name]); changed = true; }
        }
        // Commas inside an item would split it: the items the eval writes have none.
        if (tool === 'create_motion_graphic') { add('stringly', args, { ...intent, duration: 5 }, { duration: '5s' }); changed = true; }
        if (changed && tool !== 'create_motion_graphic') add('stringly', args, intent);
      }

      {
        const { args, intent } = clean();
        const renamed: Record<string, unknown> = {};
        let changed = false;
        for (const [name, value] of Object.entries(args)) {
          const alias = (SLOT_ALIASES[name] ?? []).find((word) => !(word in schema) && !(word in renamed) && !(word in args));
          if (alias && name !== 'accentWord') { renamed[alias] = value; changed = true; } else renamed[name] = value;
        }
        if (changed) add('aliases', renamed, intent);
      }

      // Text-like slots every model sends whatever the template: they must show, move or be reported.
      if (tool === 'create_motion_graphic') {
        const { args, intent } = clean();
        const extras: Record<string, string> = {};
        for (const [key, max] of [['subtitle', 30], ['kicker', 10], ['badge', 8]] as const) if (!(key in schema)) extras[key] = phrase(max);
        if (Object.keys(extras).length) add('extra-slots', { ...args, ...extras }, { ...intent, texts: { ...intent.texts, ...extras } });
      }

      if ('accentColor' in schema) {
        const { args, intent } = clean();
        add('named-colour', { ...args, accentColor: 'red' }, { ...intent, accent: 'red' });
        add('dark-colour', { ...args, accentColor: '#1a0508' }, { ...intent, accent: 'readable' });
      }

      const required = Object.entries(schema).filter(([, slot]) => 'required' in slot && slot.required).map(([name]) => name);
      if (required.length) add('missing', {}, { texts: {}, lists: {}, numbers: [], missing: required, templateId: template });

      {
        const { args, intent } = clean();
        const label = CRIMSON_TEMPLATES.find((spec) => spec.id === template)?.label;
        const loose = template.length % 2 && label ? label : template.replace(/-/g, '_').toUpperCase();
        add('loose-id', args, intent, {}, loose);
      }
    }
  }
  return cases;
}

// ───────────────────────────── scoring ─────────────────────────────

const hex = (value: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
const luminance = (rgb: readonly number[]) => {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
/** The plate Crimson graphics sit on. */
export const CRIMSON_PLATE = '#100607';

export const norm = (text: string) => text.toLowerCase().replace(/[—–-]/g, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (text: string) => norm(text).split(' ').filter((w) => w.length > 2);

/** Text a result shows: markup stripped and entities decoded, plus scene text layers. */
export function visibleTexts(json: string): string[] {
  const out: string[] = [];
  const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const m of json.matchAll(/"html":"((?:[^"\\]|\\.)*)"/g)) out.push(decode(JSON.parse(`"${m[1]}"`).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')));
  for (const m of json.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${m[1]}"`));
  return out;
}

export function scoreCase(c: EvalCase, outcome: Outcome): Scored {
  const problems: string[] = [];
  const base = { id: c.id, template: c.template, profile: c.profile };
  if (!outcome.ok) {
    const error = (outcome.error ?? '').toLowerCase();
    const names = c.intent.missing?.length ? c.intent.missing : c.profile === 'loose-id' ? [c.intent.templateId] : [];
    const helpful = names.length ? names.every((name) => error.includes(name.toLowerCase())) : /\b(give|use|needs?|must|expected|between|at most|only)\b/.test(error);
    return { ...base, verdict: helpful ? 'recoverable' : 'bad', problems: helpful ? [] : [`refused without saying what to fix: ${(outcome.error ?? '').slice(0, 120)}`] };
  }
  const schema = CRIMSON_SLOTS[c.template] ?? BRAND_SLOTS[c.template] ?? {};
  const shown = outcome.texts.map(norm).join(' \n ');
  const shownWords = new Set(shown.split(/[\s\n]+/));
  const noted = (slot: string) => (outcome.adjustments ?? []).some((a) => a.slot === slot);
  const scaleOf = (slot: string) => Math.max(0.6, Math.min(1, ...(outcome.adjustments ?? []).filter((a) => a.slot === slot && a.scale).map((a) => a.scale!)));

  if (c.intent.missing?.length) problems.push(`built without ${c.intent.missing.join(', ')} instead of asking for it`);
  const placeholders = c.tool === 'create_motion_graphic' ? PLACEHOLDERS : KIT_PLACEHOLDERS;
  for (const text of placeholders) {
    const n = norm(text);
    const meant = [...Object.values(c.intent.texts), ...Object.values(c.intent.lists).flat()].some((t) => norm(t).includes(n));
    if (!meant && (c.tool === 'create_motion_graphic' ? shown.includes(n) : outcome.texts.some((t) => norm(t) === n))) problems.push(`placeholder "${text}" on screen`);
  }
  for (const [slot, text] of Object.entries(c.intent.texts)) {
    const missing = wordsOf(text).filter((w) => !shownWords.has(w));
    if (missing.length && !noted(slot)) problems.push(`${slot} dropped (${missing.slice(0, 3).join(', ')} not shown)`);
    const limit = schema[slot];
    if (limit?.kind === 'text' && !missing.length && text.length > limit.max / scaleOf(slot)) problems.push(`${slot} overflows: ${text.length} chars where ${limit.max} fit`);
  }
  for (const [slot, items] of Object.entries(c.intent.lists)) {
    const limit = schema[slot] as ListSlot | undefined;
    const shownItems = items.filter((item) => wordsOf(item).every((w) => shownWords.has(w)));
    if (shownItems.length < items.length && !noted(slot)) problems.push(`${slot}: ${items.length - shownItems.length} of ${items.length} items silently dropped`);
    if (limit && shownItems.length > limit.maxItems) problems.push(`${slot}: ${shownItems.length} items where ${limit.maxItems} fit`);
    const long = shownItems.filter((item) => limit && item.length > limit.itemMax / scaleOf(slot));
    if (long.length) problems.push(`${slot}: ${long.length} item${long.length === 1 ? '' : 's'} overflow (${limit!.itemMax} chars fit)`);
  }
  for (const value of c.intent.numbers) if (!shownWords.has(String(value)) && !shown.includes(String(value))) problems.push(`number ${value} not shown`);
  if (c.intent.duration !== undefined && (outcome.duration === undefined || Math.abs(outcome.duration - c.intent.duration) > 0.05)) problems.push(`duration ${c.intent.duration}s ignored (got ${outcome.duration?.toFixed(2) ?? '?'}s)`);
  if (c.intent.accent) {
    const rgb = outcome.accent ? hex(outcome.accent) : null;
    if (!rgb) problems.push('no accent colour found');
    else {
      if (contrast(outcome.accent!, CRIMSON_PLATE) < 3) problems.push(`accent ${outcome.accent} unreadable on the plate (contrast ${contrast(outcome.accent!, CRIMSON_PLATE).toFixed(1)})`);
      if (c.intent.accent === 'red' && !(rgb[0] >= 150 && rgb[0] > rgb[1] * 1.6 && rgb[0] > rgb[2] * 1.4)) problems.push(`asked for red, got ${outcome.accent}`);
      if (c.intent.accent === 'red' && outcome.accent?.toLowerCase() === '#d34b55' && !noted('accentColor')) problems.push('"red" silently replaced by the default accent');
    }
  }
  return { ...base, verdict: problems.length ? 'bad' : 'good', problems };
}

export type Report = { total: number; good: number; recoverable: number; bad: number; score: number; byProfile: Record<string, { total: number; good: number; recoverable: number; bad: number }>; worst: Scored[] };

/** Score = good + recoverable, as a share of all cases: a small model gets there, in one call or two. */
export function summarize(scored: Scored[]): Report {
  const count = (list: Scored[]) => ({ total: list.length, good: list.filter((s) => s.verdict === 'good').length, recoverable: list.filter((s) => s.verdict === 'recoverable').length, bad: list.filter((s) => s.verdict === 'bad').length });
  const all = count(scored);
  const byProfile = Object.fromEntries(PROFILES.map((profile) => [profile, count(scored.filter((s) => s.profile === profile))]).filter(([, c]) => (c as { total: number }).total > 0));
  return { ...all, score: all.total ? (all.good + all.recoverable) / all.total : 0, byProfile, worst: scored.filter((s) => s.verdict === 'bad') };
}

export function reportMarkdown(report: Report, title: string): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  const lines = [
    `# ${title}`,
    '',
    'Generated by `BENCH_WRITE=1 npx vitest run tests/weakModelEval.test.ts` (`src/lib/templateEval.ts`).',
    '',
    `**Score: ${pct(report.good + report.recoverable, report.total)}** usable (${report.good} good + ${report.recoverable} recoverable of ${report.total}); ${report.bad} bad.`,
    '',
    '| Input a weak model sends | Cases | Good | Recoverable | Bad |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.byProfile).map(([profile, c]) => `| ${PROFILE_LABEL[profile as Profile]} | ${c.total} | ${c.good} | ${c.recoverable} | ${c.bad} |`),
    '',
  ];
  if (report.worst.length) {
    lines.push('## Bad results', '');
    for (const s of report.worst) lines.push(`- \`${s.id}\`: ${s.problems.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ───────────────────────────── live models ─────────────────────────────
// tests/liveModelEval.test.ts sends these requests to real (small, free) models through opencode
// and scores the tool calls they write with scoreCase, the same as the fixed cases above.

export type Brief = { id: string; request: string; templates: string[]; words?: string[]; numbers?: number[] };
export const BRIEFS: Brief[] = [
  { id: 'lower-third', request: 'Put a lower third on the speaker: Priya Raman, Head of Growth at Finlo.', templates: ['crimson-lower-third', 'lower-third'], words: ['Priya', 'Raman'] },
  { id: 'hook', request: 'Add an opening hook title: this video shows how to save your first $10,000 in one year, even on a small salary.', templates: ['hook-promise', 'kinetic-title', 'ribbon-title'], words: ['10,000'] },
  { id: 'chart', request: 'Show a bar chart of our revenue: 12, 19, 31 and 48 million dollars for 2021, 2022, 2023 and 2024. Highlight 2024.', templates: ['stat-chart'], numbers: [12, 19, 31, 48] },
  { id: 'teaching', request: 'Make a card that explains the 50/30/20 budget rule and its three parts: needs, wants and savings.', templates: ['teaching-card', 'side-panel'], words: ['needs', 'wants', 'savings'] },
  { id: 'compare', request: 'Compare renting and buying a home, fairly, side by side.', templates: ['comparison'], words: ['renting', 'buying'] },
  { id: 'news', request: 'Breaking news bar: markets fall 4% after the central bank rate decision.', templates: ['breaking-news'], words: ['markets'] },
  { id: 'quote', request: 'Show this quote big on screen, with "discipline" highlighted, in red: Discipline is choosing what you want most over what you want now.', templates: ['editorial-quote', 'caption-phrase'], words: ['discipline'] },
  { id: 'chapter', request: 'Add a small chapter marker: chapter 3, Investing basics.', templates: ['chapter-marker', 'ribbon-title'], words: ['investing'] },
  { id: 'roadmap', request: 'A roadmap graphic of the five steps to launch a product: research, prototype, test, launch, grow.', templates: ['numbered-lanes', 'timeline-roadmap', 'teaching-card'], words: ['research', 'prototype', 'launch'] },
  { id: 'countdown', request: 'A 10 second countdown before the reveal.', templates: ['countdown'], words: ['10'] },
  { id: 'panel', request: 'While I keep talking, show a side panel with my 4 rules for writing hooks, in my brand colour teal: be specific, open a loop, promise a payoff, cut the intro.', templates: ['side-panel', 'teaching-card'], words: ['specific', 'loop', 'payoff'] },
  { id: 'timeline', request: 'Company history timeline: founded 2015, first office 2017, IPO 2021, one million users 2024.', templates: ['timeline-roadmap', 'numbered-lanes'], words: ['2015', '2021', '2024'] },
];

const asList = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.map(String) : typeof value === 'string' && value.trim() ? value.split(/\s*(?:,|\n|;)\s*/).filter(Boolean) : undefined);

/** A case from a model's own call: what it meant is what it wrote, read through the slot aliases. */
export function liveCase(brief: Brief, args: Record<string, unknown>, model: string): EvalCase {
  const template = String(args.template ?? '');
  const schema = CRIMSON_SLOTS[template] ?? {};
  const intent: Intent = { texts: {}, lists: {}, numbers: [...(brief.numbers ?? [])], templateId: template };
  const canonical = (key: string) => (key in schema ? key : Object.keys(schema).find((slot) => (SLOT_ALIASES[slot] ?? []).includes(key)) ?? key);
  for (const [key, value] of Object.entries(args)) {
    const slot = canonical(key);
    const kind = schema[slot]?.kind ?? (['title', 'subtitle', 'kicker', 'badge', 'metric'].includes(slot) ? 'text' : slot === 'rows' ? 'list' : undefined);
    if (kind === 'text' && typeof value === 'string' && value.trim()) intent.texts[slot] = value;
    if (kind === 'list') { const list = asList(value); if (list?.length) intent.lists[slot] = list; }
  }
  if (typeof args.accentColor === 'string' && /red/i.test(brief.request) && !/^#/.test(args.accentColor)) intent.accent = 'red';
  else if (typeof args.accentColor === 'string') intent.accent = 'readable';
  return { id: `${model}/${brief.id}`, tool: 'create_motion_graphic', template, profile: 'clean', args, intent };
}

/** The prompt a small model gets: the tool as the app describes it, and the editor's request. */
export function livePrompt(tool: unknown, request: string, previous?: { args: unknown; error: string }): string {
  return [
    'You are the AI assistant inside a video editor. You can call one tool, create_motion_graphic, defined by this JSON:',
    JSON.stringify(tool),
    `The editor asked: "${request}"`,
    ...(previous ? [`You called it with ${JSON.stringify(previous.args)} and the tool answered with this error: ${previous.error}`, 'Fix the call.'] : []),
    'Reply with ONLY the JSON object of arguments for one create_motion_graphic call — no prose, no code fence.',
  ].join('\n\n');
}

/** The first JSON object in a model's reply (fenced or bare), or null. */
export function jsonFromReply(reply: string): Record<string, unknown> | null {
  const text = reply.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { const parsed = JSON.parse(text.slice(start, i + 1)); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* next */ }
        break;
      }
    }
  }
  return null;
}
