// Pure helpers for the language-model browser (src/settings/llm): what a model can do, how old it
// is, which quantization to suggest, and the quick filters. No React and no IPC, so it is all
// unit-tested (tests/llmHub.test.ts). The Rust side is src-tauri/src/llm_hub.rs.
import type { HardwareInfo } from './ipc';
import { defaultVariant, fitOf, primaryVramGb, type FitResult } from './modelFit';
import type { HubDetail, HubModel, HubQuant, LibraryEntry } from './modelLibrary';

/** What llm_hub.rs sends on top of the contract's `HubModel`: who made the model and whether that is a known lab. */
export type HubRow = HubModel & {
  maker: string;
  /** The maker's logo (e.g. Qwen for unsloth's Qwen quantization), cached on disk. */
  makerAvatarPath: string | null;
  verified: boolean;
  pipelineTag: string | null;
};

export type HubFullDetail = HubDetail & Pick<HubRow, 'maker' | 'makerAvatarPath' | 'verified' | 'pipelineTag'>;

export type Capabilities = { vision: boolean; tools: boolean; reasoning: boolean };

const has = (tags: string[], ...words: string[]) => tags.some((tag) => words.some((word) => tag.toLowerCase().includes(word)));

/** Vision, tool use and reasoning of a Hugging Face model, from its pipeline, tags and chat template. */
export const hubCapabilities = (model: Pick<HubRow, 'tags' | 'pipelineTag' | 'name'>): Capabilities => {
  const name = model.name.toLowerCase();
  return {
    vision: /image-text|video-text|any-to-any|visual-question/.test(model.pipelineTag ?? '') || has(model.tags, 'vision', 'multimodal', 'image-text') || /(^|[-_.])(vl|vision|omni)([-_.]|$)/.test(name),
    tools: has(model.tags, 'tool-use', 'tool_use', 'function-calling', 'function_calling', 'tools'),
    reasoning: has(model.tags, 'thinking', 'reasoning') || /(thinking|reason|(^|[-_.])r1([-_.]|$)|qwq|distill)/.test(name),
  };
};

/** The same for one of Bhippi's own cards. */
export const entryCapabilities = (entry: Pick<LibraryEntry, 'tasks' | 'tags'>): Capabilities => ({
  vision: entry.tasks.includes('vision') || has(entry.tags, 'vision'),
  tools: entry.tasks.includes('tools') || has(entry.tags, 'tool'),
  reasoning: entry.tasks.includes('reasoning') || has(entry.tags, 'reasoning', 'thinking'),
});

/** `Qwen3.6-35B-A3B` is 3 (billion active parameters), `Foo-12B-A2.5B` is 2.5. */
export const activeParamsIn = (name: string): number | null => {
  const match = /[-_.]A(\d+(?:\.\d+)?)B(?![a-z])/i.exec(name);
  return match ? Number(match[1]) : null;
};

const MOE_ARCHITECTURES = ['deepseek2', 'deepseek3', 'dbrx', 'jamba', 'arctic', 'grok', 'llama4', 'gpt-oss', 'olmoe', 'smallthinker', 'minimax-m2', 'bailingmoe', 'bailingmoe2'];

/** Mixture-of-experts models say so in their architecture (`qwen35moe`) or their name (`-A3B`). */
export const looksMoe = (architecture: string | null | undefined, name: string): boolean =>
  (!!architecture && (architecture.includes('moe') || MOE_ARCHITECTURES.includes(architecture))) || activeParamsIn(name) !== null || /(^|[-_.])moe([-_.]|$)/i.test(name);

/** Memory estimates for the fit badge from a quantization's size; the same numbers llm_hub.rs writes into an added card. */
export const quantNeeds = (weightsBytes: number, projectorBytes: number, moe: boolean) => {
  const weights = weightsBytes / 1e9;
  const projector = projectorBytes / 1e9;
  const half = (value: number) => Math.ceil(value * 2) / 2;
  return {
    minVramGb: moe ? Math.max(2.5, half(weights * 0.07 + 2.5)) : 0,
    recVramGb: half(weights + projector + 2),
    minRamGb: Math.ceil((moe ? weights * 0.95 : weights) + projector + 5),
  };
};

/** How a quantization of a hub model fits this PC. */
export const quantFit = (quant: Pick<HubQuant, 'bytes'>, projectorBytes: number, moe: boolean, hw: HardwareInfo | null, freeGb: number | null): FitResult => {
  const needs = quantNeeds(quant.bytes, projectorBytes, moe);
  return fitOf({ ...needs, files: [{ url: '', dest: 'model.gguf', bytes: quant.bytes + projectorBytes }] }, hw, { runtime: 'llama-cpp', freeGb });
};

/** The quantization to suggest: the most accurate one that still runs well here, never past 6.7 bits (above that the gain is tiny); with no PC reading, the one nearest 4.5 bits. */
export const recommendQuant = (quants: HubQuant[], fits: (quant: HubQuant) => FitResult['fit'] | null): string | null => {
  const usable = quants.filter((quant) => (quant.bits ?? 99) <= 6.7 && (quant.bits ?? 0) >= 3);
  const good = usable.filter((quant) => { const fit = fits(quant); return fit === 'great' || fit === 'ok'; });
  if (good.length) return good.reduce((best, quant) => ((quant.bits ?? 0) > (best.bits ?? 0) ? quant : best)).quant;
  if (usable.length && usable.every((quant) => fits(quant) === 'checking')) return usable.reduce((best, quant) => (Math.abs((quant.bits ?? 9) - 4.5) < Math.abs((best.bits ?? 9) - 4.5) ? quant : best)).quant;
  return null;
};

/** "today", "yesterday", "63 days ago", "5 months ago", "2 years ago"; empty for a date it cannot read. */
export const relativeDate = (iso: string | null | undefined, now = Date.now()): string => {
  const then = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(then)) return '';
  const days = Math.max(0, Math.floor((now - then) / 86_400_000));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 90) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
};

/** 1234 -> "1.2K", 6663225 -> "6.7M". */
export const compact = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
};

/** "35B", "4.2B", "820M". */
export const paramsLabel = (billions: number | null | undefined): string => {
  if (!billions || billions <= 0) return '';
  if (billions < 1) return `${Math.round(billions * 1000)}M`;
  return `${billions >= 10 ? Math.round(billions) : Math.round(billions * 10) / 10}B`;
};

/** 262144 -> "256K", 131072 -> "128K", 1048576 -> "1M". */
export const contextLabel = (tokens: number | null | undefined): string => {
  if (!tokens) return '';
  if (tokens >= 1_048_576 && tokens % 1_048_576 === 0) return `${tokens / 1_048_576}M`;
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);
};

/** The name of a repo without its `-GGUF` tail, for display. */
export const displayName = (name: string): string => name.replace(/[-_.]gguf$/i, '');

// ---- quick filters ----------------------------------------------------------------------------

export type QuickFilter = 'fits' | 'moe' | 'vision' | 'coding' | 'reasoning' | 'distilled' | 'uncensored';

export const QUICK_FILTERS: { id: QuickFilter; label: string; hint: string }[] = [
  { id: 'fits', label: 'Fits this PC', hint: 'Hide models too big for this computer' },
  { id: 'moe', label: 'Mixture of experts', hint: 'Large models that only use a part of themselves per word, so they run fast' },
  { id: 'vision', label: 'Vision', hint: 'Models that can look at pictures' },
  { id: 'coding', label: 'Coding', hint: 'Models made for writing code' },
  { id: 'reasoning', label: 'Reasoning', hint: 'Models that think before they answer' },
  { id: 'distilled', label: 'Distilled', hint: 'Smaller models taught by a bigger one' },
  { id: 'uncensored', label: 'Uncensored', hint: 'Fine-tunes with the refusals removed (abliterated, uncensored)' },
];

/** What a filter adds to the search text; the others are checked on the results. */
const TERMS: Partial<Record<QuickFilter, string>> = { coding: 'coder', distilled: 'distill', uncensored: 'uncensored' };

/** The search text with the filters that work as search words added. */
export const searchText = (query: string, filters: ReadonlySet<QuickFilter>): string =>
  [query.trim(), ...[...filters].map((filter) => TERMS[filter]).filter((term): term is string => !!term && !query.toLowerCase().includes(term))].filter(Boolean).join(' ');

/** Rough size of a model at a usual 4-bit file, in GB, from its parameter count. */
const roughGb = (billions: number) => billions * 0.6;

/** Does a model plausibly run on this PC? A mixture of experts may spill into RAM; a dense model should mostly fit the card. Unknown sizes pass. */
export const fitsThisPc = (model: Pick<HubRow, 'paramsB' | 'architecture' | 'name'>, hw: HardwareInfo | null): boolean => {
  if (!hw || !model.paramsB) return true;
  const gb = roughGb(model.paramsB);
  const vram = primaryVramGb(hw)?.vramGb ?? 0;
  const ram = hw.ramGb ?? 16;
  const moe = looksMoe(model.architecture, model.name);
  return moe ? gb + 6 <= ram + vram * 0.8 : gb + 4 <= ram * 0.6 + vram * 0.9 && gb <= vram * 1.6 + 8;
};

/** The filters that are checked on the results (the others are in the search text). */
export const passesFilters = (model: HubRow, filters: ReadonlySet<QuickFilter>, hw: HardwareInfo | null): boolean => {
  const caps = hubCapabilities(model);
  if (filters.has('fits') && !fitsThisPc(model, hw)) return false;
  if (filters.has('moe') && !looksMoe(model.architecture, model.name)) return false;
  if (filters.has('vision') && !caps.vision) return false;
  if (filters.has('reasoning') && !caps.reasoning) return false;
  return true;
};

/** The same search and filters for one of Bhippi's own cards (its list is short, so all of it is checked here). */
export const entryMatches = (entry: LibraryEntry, query: string, filters: ReadonlySet<QuickFilter>, hw: HardwareInfo | null): boolean => {
  const needle = query.trim().toLowerCase();
  const words = [entry.name, entry.maker, entry.publisher?.name ?? '', entry.summary, ...entry.tags];
  if (needle && !words.some((text) => text.toLowerCase().includes(needle))) return false;
  if (!filters.size) return true;
  const caps = entryCapabilities(entry);
  const shape = (entry.variants.find((variant) => variant.default) ?? entry.variants[0])?.llm;
  const flat = `${entry.name} ${entry.tags.join(' ')}`.toLowerCase();
  if (filters.has('fits')) {
    const variant = defaultVariant(entry.variants, hw, entry.runtime);
    if (variant && fitOf(variant, hw, { runtime: entry.runtime }).fit === 'no') return false;
  }
  if (filters.has('moe') && !(shape?.moe ?? looksMoe(null, entry.name))) return false;
  if (filters.has('vision') && !caps.vision) return false;
  if (filters.has('coding') && !(entry.tasks.includes('code') || /code|coder/.test(flat))) return false;
  if (filters.has('reasoning') && !caps.reasoning) return false;
  if (filters.has('distilled') && !flat.includes('distill')) return false;
  if (filters.has('uncensored') && !/uncensored|abliterated/.test(flat)) return false;
  return true;
};

/** Filters that need results checked one by one, so the list may need more pages to fill. */
export const needsClientCheck = (filters: ReadonlySet<QuickFilter>): boolean => ['fits', 'moe', 'vision', 'reasoning'].some((filter) => filters.has(filter as QuickFilter));

/** A maker's name for display: "Qwen", "google" -> "Google", "meta-llama" -> "Meta Llama". */
export const prettyMaker = (name: string): string => {
  const known: Record<string, string> = { qwen: 'Qwen', google: 'Google', openai: 'OpenAI', 'meta-llama': 'Meta Llama', mistralai: 'Mistral AI', nvidia: 'NVIDIA', microsoft: 'Microsoft', 'deepseek-ai': 'DeepSeek', 'zai-org': 'Z.ai', 'ibm-granite': 'IBM Granite', liquidai: 'Liquid AI', allenai: 'Ai2', coherelabs: 'Cohere', moonshotai: 'Moonshot AI', minimaxai: 'MiniMax', 'xai-org': 'xAI', tiiuae: 'TII' };
  return known[name.toLowerCase()] ?? name;
};

/** The README with pictures and badge rows taken out (the app's page policy blocks remote images anyway). */
export const readmeText = (text: string): string =>
  text
    .replace(/<img[^>]*>/gi, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<\/?(?:div|p|center|picture|source|br)[^>]*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
