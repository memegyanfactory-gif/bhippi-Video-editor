// Speed tiers: the same model family offered at different sizes.
//
// Vendors ship one generation at several speeds — Gemini 2.5 Pro · Flash · Flash-Lite, GPT-5 ·
// mini · nano, Claude Opus · Sonnet · Haiku, Codex's Astra · Sol · Terra · Luna. Each is a real,
// separate model id. Grouping them lets the composer offer one "speed" rail that steps through
// the family, and lets the picker show a family as one row with its tiers beside it instead of
// a list that grows with every size.
//
// Effort variants (`gemini-3.8-flash-high` · `-medium` · `-low`) are a different axis and are
// handled by modelVariants.ts; tiers are always computed on the id with its effort suffix removed.
import { pickerModels, splitVariant } from './modelVariants';

/** One size a family comes in. Lower `rank` is faster; higher is smarter. */
export type SpeedStep = { id: string; label: string; rank: number };

/**
 * The words that name a size, fastest first. Longer phrases come before the words inside them
 * (`flash-lite` before `flash` and `lite`). A model with none of these words is its family's
 * full-size member, ranked with the balanced tiers.
 */
const TIERS: ReadonlyArray<readonly [token: string, rank: number, label: string]> = [
  ['flash-lite', 1, 'Flash-Lite'],
  ['nano', 0, 'Nano'],
  ['micro', 0, 'Micro'],
  ['lightning', 0, 'Lightning'],
  ['lite', 1, 'Lite'],
  ['haiku', 1, 'Haiku'],
  ['mini', 1, 'Mini'],
  ['small', 1, 'Small'],
  ['luna', 1, 'Luna'],
  ['instant', 1, 'Instant'],
  ['flash', 2, 'Flash'],
  ['fast', 2, 'Fast'],
  ['turbo', 2, 'Turbo'],
  ['terra', 2, 'Terra'],
  ['sonnet', 3, 'Sonnet'],
  ['sol', 3, 'Sol'],
  ['medium', 3, 'Medium'],
  ['pro', 4, 'Pro'],
  ['large', 4, 'Large'],
  ['plus', 4, 'Plus'],
  ['opus', 5, 'Opus'],
  ['astra', 5, 'Astra'],
  ['ultra', 5, 'Ultra'],
];

const FULL_RANK = 3;
const SEP = '[-_./:~]';
const PATTERNS = TIERS.map(([token, rank, label]) => ({
  rank,
  label,
  regex: new RegExp(`(^|${SEP})${token.replace(/-/g, '[-_]')}(?=$|${SEP})`, 'i'),
}));

/** The family an id belongs to and where it sits in it. */
export function tierOf(id: string): { family: string; rank: number; label: string; sized: boolean } {
  const base = splitVariant(id)?.base || id;
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(base);
    if (!match) continue;
    const family = (base.slice(0, match.index) + base.slice(match.index + match[0].length)).replace(/^[-_.:~]+/, '');
    return { family: family.toLowerCase(), rank: pattern.rank, label: pattern.label, sized: true };
  }
  return { family: base.toLowerCase(), rank: FULL_RANK, label: 'Full', sized: false };
}

/**
 * Every family with at least two sizes, keyed by family, members fastest first. A family counts
 * only when at least one member names its size — two unrelated full-size ids never group.
 */
export function tierFamilies(models: string[]): Map<string, SpeedStep[]> {
  const buckets = new Map<string, { steps: SpeedStep[]; sized: boolean }>();
  for (const id of pickerModels([...new Set(models)])) {
    const tier = tierOf(id);
    const bucket = buckets.get(tier.family) ?? { steps: [], sized: false };
    bucket.steps.push({ id, label: tier.label, rank: tier.rank });
    bucket.sized ||= tier.sized;
    buckets.set(tier.family, bucket);
  }
  const families = new Map<string, SpeedStep[]>();
  for (const [family, bucket] of buckets) {
    if (bucket.steps.length < 2 || !bucket.sized) continue;
    // Two ids with the same size word (a dated snapshot beside its alias) keep list order.
    const steps = bucket.steps
      .map((step, order) => ({ step, order }))
      .sort((a, b) => a.step.rank - b.step.rank || a.order - b.order)
      .map(({ step }) => step);
    // The size word alone reads as the label; when two share one, the ids tell them apart.
    const counts = new Map<string, number>();
    for (const step of steps) counts.set(step.label, (counts.get(step.label) ?? 0) + 1);
    families.set(family, steps.map((step) => (counts.get(step.label)! > 1 ? { ...step, label: shortTail(step.id) } : step)));
  }
  return families;
}

/** The sizes of the chosen model's family, fastest first; empty when it comes in one size. */
export function speedSteps(models: string[], chosen: string | null): SpeedStep[] {
  if (!chosen) return [];
  const family = tierOf(chosen).family;
  const steps = tierFamilies(models).get(family) ?? [];
  // The chosen id may be an effort variant of a member (`…-flash-high`); match on the base.
  const base = splitVariant(chosen)?.base || chosen;
  return steps.some((step) => (splitVariant(step.id)?.base || step.id) === base) ? steps : [];
}

/** Which step the chosen model is, by its base id. -1 when it is not in the family. */
export function speedIndex(steps: SpeedStep[], chosen: string | null): number {
  if (!chosen) return -1;
  const base = splitVariant(chosen)?.base || chosen;
  return steps.findIndex((step) => (splitVariant(step.id)?.base || step.id) === base);
}

function shortTail(id: string) {
  const base = splitVariant(id)?.base || id;
  return base.split('/').pop() ?? base;
}

// ── picker grouping ───────────────────────────────────────────────────────

/** One row of the picker: a single model, or a family with its sizes as pills. */
export type PickerEntry = {
  /** What the row picks when clicked: the chosen member, else the balanced one. */
  id: string;
  /** The row's title. */
  title: string;
  /** Section the row sits under (`anthropic`, `Gemini`, `Aliases`…). */
  group: string;
  /** Every member when this row is a family; empty for a single model. */
  tiers: SpeedStep[];
  /** Everything a search should match. */
  haystack: string;
};

const WORD_GROUPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude/i, 'Claude'],
  [/^(gpt|o\d|chatgpt|codex)/i, 'OpenAI'],
  [/^(gemini|gemma)/i, 'Gemini'],
  [/^grok/i, 'Grok'],
  [/^(llama|meta)/i, 'Llama'],
  [/^(qwen|qwq)/i, 'Qwen'],
  [/^(mistral|codestral|magistral|devstral|ministral|pixtral)/i, 'Mistral'],
  [/^deepseek/i, 'DeepSeek'],
  [/^(kimi|moonshot)/i, 'Kimi'],
  [/^glm/i, 'GLM'],
];

/** The section a model id belongs under. */
export function modelGroup(id: string): string {
  const parts = id.split('/');
  if (parts.length > 1) {
    // `openrouter/anthropic/claude-…` reads best as "openrouter · anthropic".
    if (parts.length > 2) return `${parts[0]} · ${parts[1].replace(/^~/, '')}`;
    // `openai/gpt-oss-120b` on Groq: the vendor is the section.
    return parts[0];
  }
  for (const [pattern, name] of WORD_GROUPS) if (pattern.test(id)) return name;
  // `opus`, `pro`, `flash-lite`: a CLI's own aliases, which follow the newest release.
  if (!/\d/.test(id)) return 'Aliases';
  return 'Other';
}

/** A readable title for an id: its last path segment without an effort suffix. */
export function modelTitle(id: string): string {
  return shortTail(id);
}

/**
 * The provider's models as picker rows, in the provider's own order, with every sized family
 * folded into one row. `chosen` decides which member a family row stands for.
 */
export function pickerEntries(models: string[], chosen: string | null): PickerEntry[] {
  const unique = pickerModels([...new Set(models)]);
  const families = tierFamilies(unique);
  const chosenBase = chosen ? splitVariant(chosen)?.base || chosen : null;
  const placed = new Set<string>();
  const entries: PickerEntry[] = [];
  for (const id of unique) {
    const family = tierOf(id).family;
    const tiers = families.get(family);
    if (!tiers) {
      entries.push({ id, title: modelTitle(id), group: modelGroup(id), tiers: [], haystack: id.toLowerCase() });
      continue;
    }
    if (placed.has(family)) continue;
    placed.add(family);
    const current = tiers.find((step) => (splitVariant(step.id)?.base || step.id) === chosenBase);
    const balanced = [...tiers].sort((a, b) => Math.abs(a.rank - FULL_RANK) - Math.abs(b.rank - FULL_RANK) || b.rank - a.rank)[0];
    const pick = current ?? balanced;
    entries.push({
      id: pick.id,
      title: familyTitle(family, tiers),
      group: modelGroup(tiers[0].id),
      tiers,
      haystack: tiers.map((step) => `${step.id} ${step.label}`).join(' ').toLowerCase(),
    });
  }
  return entries;
}

/** `gemini-2.5` for the 2.5 family; the provider's aliases have no family name of their own. */
function familyTitle(family: string, tiers: SpeedStep[]): string {
  const tail = family.split('/').pop()?.replace(/[-_.]+$/, '').replace(/^[-_.~]+/, '') ?? '';
  if (tail) return tail;
  return tiers.every((step) => !/\d/.test(step.id)) ? 'Latest (aliases)' : shortTail(tiers[0].id);
}

const UPPER = new Set(['gpt', 'oss', 'glm', 'qwq', 'vl', 'ai', 'r1', 'v3', 'v4', 'it']);

/**
 * How a model reads in the composer: `claude-sonnet-4-5-20250929` → "Claude Sonnet 4.5",
 * `gpt-5.1-codex-mini` → "GPT 5.1 Codex Mini", `gemini-2.5-flash-lite` → "Gemini 2.5 Flash Lite".
 * Dates are dropped (the raw id is always one hover away), runs of single numbers become a
 * version, and the rest is capitalised.
 */
export function prettyModel(id: string): string {
  const tail = shortTail(id).replace(/^~/, '').replace(/:(latest|free)$/i, '');
  const words: string[] = [];
  for (const token of tail.split(/[-_ ]+/).filter(Boolean)) {
    if (/^\d{6,8}$/.test(token) || /^\d{4}-\d{2}-\d{2}$/.test(token)) continue;
    const previous = words[words.length - 1];
    // `4` `5` → "4.5", but "GPT 5" + "1" (a single version) after a word stays a word apart.
    if (/^\d{1,2}$/.test(token) && previous && /^\d+(\.\d+)*$/.test(previous)) {
      words[words.length - 1] = `${previous}.${token}`;
      continue;
    }
    const lower = token.toLowerCase();
    if (UPPER.has(lower)) words.push(lower.toUpperCase());
    else if (/^o\d/.test(lower) || /^\d/.test(token) || /[A-Z]/.test(token.slice(1))) words.push(token);
    else words.push(lower[0].toUpperCase() + lower.slice(1));
  }
  return words.join(' ') || tail;
}
