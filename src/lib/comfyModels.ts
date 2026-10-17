// The library's ComfyUI models that run from ComfyUI's official workflow templates (catalog:
// src-tauri/catalog/library/comfy-models.json, templates: public/comfy-templates). This file knows
// what each task takes, builds the API graph for one request, and holds the prompt rules per model
// family that the AI is shown. MiniMax H3 keeps its own hand-written graph (minimaxH3.ts).
import {
  applyFixed, applyLoaders, applySlots, applyWhenAbsent, classesOf, convertTemplate, finalizePrompt, templateClasses,
  type ApiPrompt, type ComfyTaskSpec, type FixedValue, type ObjectInfo, type UiTemplate,
} from './comfyTemplates';
import type { LibraryEntry, LibraryState } from './modelLibrary';

/** The library models driven through generate_with_library_model by a ComfyUI template (not MiniMax H3). */
export const COMFY_MODEL_IDS = [
  'z-image-turbo', 'flux2-klein-4b', 'ernie-image-turbo', 'qwen-image-2-1', 'qwen-image-2-1-turbo', 'qwen-image-edit-2511',
  'ace-step-1-5-xl-turbo', 'ace-step-1-5-turbo', 'stable-audio-3-medium', 'yue2-3b',
] as const;

export const isComfyModel = (id: string): boolean => (COMFY_MODEL_IDS as readonly string[]).includes(id);

export type ComfyTask = 't2i' | 'edit' | 'song' | 'audio';
export const COMFY_TASKS: ComfyTask[] = ['t2i', 'edit', 'song', 'audio'];

type Range = { default: number; min?: number; max?: number };
export type ComfyEntryConfig = {
  templates: Record<string, string>;
  tasks: Record<string, ComfyTaskSpec>;
  /** What an installed add-on changes: per add-on, per task, extra fixed values and parameter ranges. */
  addons?: Record<string, Record<string, { fixed?: FixedValue[]; params?: Record<string, unknown> }>>;
};

/** The entry's `comfy` block, or null when the entry is not a template-driven ComfyUI model. */
export function comfyConfig(entry: Pick<LibraryEntry, 'comfy'>): ComfyEntryConfig | null {
  const raw = entry.comfy as Partial<ComfyEntryConfig> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.templates || !raw.tasks) return null;
  return raw as ComfyEntryConfig;
}

/** Task parameters with an installed add-on's changes applied. */
export function taskParams(config: ComfyEntryConfig, task: string, addons: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(config.tasks[task]?.params ?? {}) };
  for (const id of addons) Object.assign(params, config.addons?.[id]?.[task]?.params ?? {});
  return params;
}

const range = (value: unknown): Range | null => (value && typeof value === 'object' && typeof (value as Range).default === 'number' ? (value as Range) : null);
const clampTo = (value: number, r: { min?: number; max?: number }) => Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, value));

// --- sizes --------------------------------------------------------------------------------------

/** "16:9" -> 16/9; null when it is not a ratio. */
export function aspectRatio(aspect: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** The common aspect closest to a picture's shape. */
export function nearestAspect(width: number, height: number, choices: readonly string[]): string {
  const target = width > 0 && height > 0 ? width / height : 1;
  let best = choices[0] ?? '1:1';
  let bestGap = Infinity;
  for (const choice of choices) {
    const ratio = aspectRatio(choice);
    if (!ratio) continue;
    const gap = Math.abs(Math.log(ratio / target));
    if (gap < bestGap) { best = choice; bestGap = gap; }
  }
  return best;
}

/** Width and height for an aspect and a size in megapixels (1 MP = 1024 x 1024), in multiples of `multiple`, never past `maxMegapixels`. */
export function imageSize(aspect: string, megapixels: number, multiple: number, maxMegapixels: number): { width: number; height: number } {
  const ratio = aspectRatio(aspect) ?? 1;
  const mp = Math.min(Math.max(megapixels, 0.1), maxMegapixels);
  const area = mp * 1024 * 1024;
  const snap = (value: number) => Math.max(multiple, Math.round(value / multiple) * multiple);
  let width = snap(Math.sqrt(area * ratio));
  let height = snap(Math.sqrt(area / ratio));
  // Rounding up can overshoot the cap a little: step the longer side down.
  while (width * height > maxMegapixels * 1024 * 1024 * 1.02 && Math.max(width, height) > multiple * 4) {
    if (width >= height) width -= multiple; else height -= multiple;
  }
  return { width, height };
}

// --- the request -------------------------------------------------------------------------------

export type ComfyRequest = {
  prompt?: string;
  negative?: string;
  /** Image: shape of a new picture, e.g. 16:9. */
  aspect?: string;
  /** Image: size in megapixels (1 = about 1024 x 1024). */
  megapixels?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  /** Edit: the local files of the picture(s) to edit, in the order the prompt calls "image 1", "image 2". */
  images?: string[];
  /** Song: lyrics with [Verse] / [Chorus] tags. */
  lyrics?: string;
  /** Audio: length in seconds. */
  seconds?: number;
  bpm?: number;
  keyscale?: string;
  timesignature?: string | number;
  language?: string;
};

export type ComfyBuild = {
  graph: ApiPrompt;
  inputs: { path: string; as: string }[];
  kind: 'image' | 'audio';
  seed: number;
  /** What was really used, for the reply to the AI. */
  used: Record<string, unknown>;
  notes: string[];
};

export type ComfyBuildDeps = {
  /** The template JSON by name (public/comfy-templates/<name>.json). */
  loadTemplate: (name: string) => Promise<unknown>;
  /** Node definitions of the running ComfyUI for these classes. */
  objectInfo: (classes: string[]) => Promise<ObjectInfo>;
  /** Names the staged input files get; injectable so tests are stable. */
  stageName?: (index: number, path: string) => string;
};

export const ACE_LANGUAGES = [
  'ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'ko', 'la', 'lt', 'ms',
  'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sa', 'sk', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh', 'unknown',
] as const;
const KEYSCALE = /^[A-G][#b]? (major|minor)$/;
const TIME_SIGNATURES = ['2', '3', '4', '6'];

const defaultStageName = (index: number, path: string): string => {
  const ext = /\.(png|jpe?g|webp|bmp)$/i.exec(path)?.[1]?.toLowerCase() ?? 'png';
  return `bhippi-in-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}-${index + 1}.${ext}`;
};

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export class ComfyBuildError extends Error {}

/** Which model files and add-ons are on disk for the size in use. */
export function installedFiles(entry: LibraryEntry, state: Pick<LibraryState, 'installedVariant' | 'installedAddons'>, variantId?: string | null): { variant: string; dests: string[]; addons: string[] } {
  const variant = entry.variants.find((each) => each.id === (variantId ?? state.installedVariant)) ?? entry.variants.find((each) => each.id === state.installedVariant);
  if (!variant) throw new ComfyBuildError(`${entry.name} has no downloaded size.`);
  const addons = (state.installedAddons ?? []).filter((id) => entry.addons?.some((addon) => addon.id === id));
  const addonFiles = addons.flatMap((id) => entry.addons?.find((addon) => addon.id === id)?.files ?? []);
  return { variant: variant.id, dests: [...variant.files, ...addonFiles].map((file) => file.dest), addons };
}

/**
 * The API-format graph for one request: the entry's template converted with the server's node
 * definitions, then the model files, fixed values and the request written into their slots.
 */
export async function buildComfyGraph(
  entry: LibraryEntry,
  state: Pick<LibraryState, 'installedVariant' | 'installedAddons'>,
  task: ComfyTask,
  request: ComfyRequest,
  deps: ComfyBuildDeps,
  variantId?: string | null,
): Promise<ComfyBuild> {
  const config = comfyConfig(entry);
  const spec = config?.tasks[task];
  const templateName = config?.templates[task];
  if (!config || !spec || !templateName) throw new ComfyBuildError(`${entry.name} cannot do "${task}". It does: ${Object.keys(config?.templates ?? {}).join(', ') || 'nothing through this tool'}.`);
  if (!/^[A-Za-z0-9_.-]+$/.test(templateName)) throw new ComfyBuildError(`The workflow name "${templateName}" is not valid.`);
  const files = installedFiles(entry, state, variantId);
  const params = taskParams(config, task, files.addons);
  const notes: string[] = [];
  const used: Record<string, unknown> = { size: files.variant };
  const kind: 'image' | 'audio' = task === 'song' || task === 'audio' ? 'audio' : 'image';

  // The values that go into the template's slots.
  const values: Record<string, unknown> = {};
  const prompt = (request.prompt ?? '').trim();
  const slotNames = Object.keys(spec.slots);
  if (slotNames.includes('prompt') && !prompt) throw new ComfyBuildError('Give a prompt.');
  if (slotNames.includes('tags') && !prompt) throw new ComfyBuildError('Give a prompt: the style of the music as comma-separated tags.');
  if (slotNames.includes('prompt')) values.prompt = prompt;
  if (slotNames.includes('tags')) values.tags = prompt;
  const seed = typeof request.seed === 'number' && Number.isFinite(request.seed) ? Math.max(0, Math.floor(request.seed)) : randomSeed();
  if (slotNames.includes('seed')) values.seed = seed;
  used.seed = seed;

  const stepsRange = range(params.steps);
  if (stepsRange && slotNames.includes('steps')) {
    if (typeof request.steps === 'number' && Number.isFinite(request.steps)) {
      const steps = Math.round(clampTo(request.steps, stepsRange));
      if (steps !== Math.round(request.steps)) notes.push(`Steps ${request.steps} is outside ${stepsRange.min}-${stepsRange.max} for this model; used ${steps}.`);
      values.steps = steps;
      used.steps = steps;
    } else used.steps = stepsRange.default;
  } else if (typeof request.steps === 'number') notes.push('This model\'s step count is fixed by its workflow; steps was ignored.');
  else if (stepsRange) used.steps = stepsRange.default;

  const cfgRange = range(params.cfg);
  if (cfgRange && slotNames.includes('cfg') && typeof request.cfg === 'number' && Number.isFinite(request.cfg)) {
    values.cfg = clampTo(request.cfg, cfgRange);
    used.cfg = values.cfg;
  } else if (typeof request.cfg === 'number') notes.push('This model has no guidance setting; cfg was ignored.');

  if (request.negative?.trim()) {
    if (params.negative === true && slotNames.includes('negative')) values.negative = request.negative.trim();
    else notes.push('This model has no negative prompt; it was ignored. Say what you want instead of what to avoid.');
  }

  const inputs: { path: string; as: string }[] = [];

  if (kind === 'image') {
    if (task === 't2i') {
      const mp = range(params.megapixels);
      const multiple = typeof params.multiple === 'number' ? params.multiple : 16;
      const aspect = request.aspect && aspectRatio(request.aspect) ? request.aspect : '1:1';
      const size = imageSize(aspect, request.megapixels ?? mp?.default ?? 1, multiple, mp?.max ?? 2);
      if (request.megapixels !== undefined && mp?.max !== undefined && request.megapixels > mp.max) notes.push(`${request.megapixels} MP is more than this model takes; used ${mp.max} MP at most.`);
      values.width = size.width;
      values.height = size.height;
      used.width = size.width;
      used.height = size.height;
      used.aspect = aspect;
    } else {
      const wanted = typeof params.maxImages === 'number' ? params.maxImages : 1;
      const list = (request.images ?? []).filter(Boolean);
      if (!list.length) throw new ComfyBuildError('An edit needs the picture to edit: pass imageAssetId.');
      if (list.length > wanted) throw new ComfyBuildError(`${entry.name} takes at most ${wanted} picture${wanted === 1 ? '' : 's'}.`);
      const stage = deps.stageName ?? defaultStageName;
      list.forEach((path, index) => {
        const name = stage(index, path);
        inputs.push({ path, as: name });
        values[index === 0 ? 'image' : 'image2'] = name;
      });
      used.images = list.length;
      const mp = range(params.megapixels);
      if (mp && slotNames.includes('megapixels')) {
        const value = clampTo(request.megapixels ?? mp.default, { min: 0.1, max: mp.max });
        values.megapixels = value;
        used.megapixels = value;
      }
    }
  } else {
    const secs = range(params.seconds);
    if (secs && slotNames.includes('duration')) {
      const wanted = typeof request.seconds === 'number' && Number.isFinite(request.seconds) ? request.seconds : secs.default;
      const seconds = Math.round(clampTo(wanted, secs) * 10) / 10;
      if (seconds !== wanted) notes.push(`Length ${wanted} s is outside ${secs.min}-${secs.max} s for this model; used ${seconds} s.`);
      values.duration = seconds;
      used.seconds = seconds;
    }
    if (slotNames.includes('lyrics')) {
      const lyrics = (request.lyrics ?? '').trim();
      if (!lyrics && entry.id.startsWith('yue2')) throw new ComfyBuildError('YuE 2 sings lyrics: pass lyrics with [Verse] / [Chorus] tags. For an instrumental use ACE-Step or Stable Audio.');
      values.lyrics = lyrics || '[Instrumental]';
      used.instrumental = !lyrics;
    } else if (request.lyrics?.trim()) notes.push('This model does not sing lyrics; they were ignored.');
    if (slotNames.includes('bpm') && typeof request.bpm === 'number' && Number.isFinite(request.bpm)) {
      values.bpm = Math.round(clampTo(request.bpm, { min: 10, max: 300 }));
      used.bpm = values.bpm;
    }
    if (slotNames.includes('keyscale') && request.keyscale) {
      if (KEYSCALE.test(request.keyscale.trim())) { values.keyscale = request.keyscale.trim(); used.keyscale = values.keyscale; }
      else notes.push(`Key "${request.keyscale}" is not like "A minor" or "C# major"; it was ignored.`);
    }
    if (slotNames.includes('timesignature') && request.timesignature !== undefined) {
      const signature = String(request.timesignature).split('/')[0].trim();
      if (TIME_SIGNATURES.includes(signature)) { values.timesignature = signature; used.timesignature = signature; }
      else notes.push(`Time signature ${String(request.timesignature)} is not one of 2, 3, 4, 6; it was ignored.`);
    }
    if (slotNames.includes('language') && request.language) {
      const language = request.language.trim().toLowerCase();
      if ((ACE_LANGUAGES as readonly string[]).includes(language)) { values.language = language; used.language = language; }
      else notes.push(`Language "${request.language}" is not one of ACE-Step's codes (en, hi, es, zh, ja ...); the default was used.`);
    }
  }

  // Convert the template.
  const template = (await deps.loadTemplate(templateName)) as UiTemplate;
  const info = await deps.objectInfo(templateClasses(template));
  const converted = convertTemplate(template, info, { modes: spec.modes });
  if (converted.missing.length) {
    throw new ComfyBuildError(`The ComfyUI that is running lacks nodes this workflow needs (${converted.missing.join(', ')}). It must be ComfyUI 0.41 or newer.`);
  }
  const graph = converted.prompt;
  const addonFixed = files.addons.flatMap((id) => config.addons?.[id]?.[task]?.fixed ?? []);
  applyFixed(graph, [...(spec.fixed ?? []), ...addonFixed]);
  applyLoaders(graph, spec.loaders, files.dests, spec.optionalLoaders);
  applySlots(graph, spec.slots, values);
  applyWhenAbsent(graph, spec.whenAbsent, new Set(Object.keys(values)));
  finalizePrompt(graph, info);
  if (!Object.values(graph).some((node) => /^Save/.test(node.class_type))) throw new ComfyBuildError('The workflow has no Save step left after it was prepared.');
  const stillMissing = classesOf(graph).filter((name) => !info[name]);
  if (stillMissing.length) throw new ComfyBuildError(`The ComfyUI that is running lacks nodes this workflow needs (${stillMissing.join(', ')}).`);
  return { graph, inputs, kind, seed, used, notes };
}

// --- what the AI is told ---------------------------------------------------------------------------

/** Prompt rules per model family (entry.promptGuide), from each model's own guidance. */
export const COMFY_PROMPT_RULES: Record<string, string[]> = {
  'z-image': [
    'Z-Image Turbo: 8 steps, NO negative prompt (it is ignored): say what you want, never what to avoid.',
    'One plain, concrete paragraph in this order: subject, setting, light, camera and lens, style. English or Chinese.',
    'Strongest at photographic people and scenes. For illustration or 3D, name the medium. No quality spam ("masterpiece, 8k").',
    'Exact words on the picture go in "quotes"; keep them short (a few words).',
  ],
  'qwen-image': [
    'Qwen Image 2.1: write 80-200 words of natural language describing the finished picture: subject, composition, light, materials, style, colour.',
    'Text that must appear goes in "quotes" with where it sits, its look (heavy grotesque capitals, thin script) and colour. For posters and layouts describe each region (top headline, left column, footer).',
    'Transparent picture: write "This is an RGBA format image with transparency. <description>. The image has an alpha channel and a transparent background."',
    'Up to 2K: megapixels up to 4 (slow). Standard has 25 steps and an optional short negative prompt (blurry, extra fingers). Turbo is fixed at 8 steps with no negative prompt.',
    'Edit: one clear instruction saying what changes and what stays ("Replace the costume with image 2; keep the face and pose"). Refer to the pictures as image 1 and image 2.',
  ],
  'qwen-image-edit': [
    'Qwen Image Edit 2511: one clear instruction that says what to change and what to keep ("change the sofa leather in image 1 to the fur in image 2; keep the room unchanged").',
    'Refer to the pictures as "image 1" and "image 2" in the order of imageAssetId and image2AssetId.',
    'For text edits quote the old and the new text. The result keeps the first picture\'s shape; no size to choose.',
    '40 steps by default (slow); with the Lightning add-on installed it runs 4 steps. A short negative prompt is optional.',
  ],
  'flux2-klein': [
    'FLUX.2 [klein] 4B: 4 steps, NO negative prompt. Natural language, subject first, then setting, light, camera and style.',
    'Short strings of text go in "quotes". Keep prompts to one or two sentences for clean results; very long ones drift.',
    'Edit: a short instruction naming the change ("change the bag color to blue", "make it night"). The picture keeps its own shape; megapixels only sets the working size (1 default).',
  ],
  'ernie-image': [
    'ERNIE-Image Turbo: 8 steps, NO negative prompt. A long descriptive prompt in English or Chinese works best.',
    'It follows layout: describe each region, and put the exact text in "quotes" with its place and style.',
    'Use 1-2 megapixels; it is a large model, so ask for one picture at a time and keep the length of the prompt under about 200 words.',
  ],
  'ace-step': [
    'ACE-Step 1.5 writes a whole song. `prompt` = comma-separated style tags: genre, mood, instruments, vocal type, production words ("synthwave, 110 BPM, warm female vocals, analog synths, punchy drums, nostalgic").',
    '`lyrics` = the words to sing, with section tags in square brackets on their own line: [Verse], [Chorus], [Bridge], [Outro]; short lines (6-10 syllables); no stage directions inside. For an instrumental leave lyrics out.',
    'Fit the structure to `seconds` (10-240): 30 s is one verse and a chorus, not eight sections. Say `language` (ISO code like en, hi, es, zh, ja) when the lyrics are not English.',
    'Optional: bpm (10-300), keyscale ("A minor"), timesignature (2, 3, 4, 6). Do not name real artists. Saved as a lossless file.',
  ],
  'stable-audio-3': [
    'Stable Audio 3 makes sound effects, loops, instruments and instrumental music up to 380 s. It does NOT sing: for songs use ACE-Step.',
    'Describe the sound like a sound designer: source, material, space and manner ("heavy wooden door slam in a stone hallway, long reverb tail").',
    'Music: genre, tempo, key instruments, mood and the word "instrumental". Loops: say "seamless loop, 120 BPM". One-shots: "isolated, dry, no reverb". SFX: one clean event, no music.',
    'Ask for the length you need in `seconds` (1-5 s for effects, 15-60 s for beds). 8 steps; do not change them unless asked.',
  ],
  yue2: [
    'YuE 2 sings. `prompt` = the style: genre, voice, language, tempo, instruments ("English, warm female vocal, contemporary pop, 96 BPM, piano, restrained drums"). Keep musical directions out of the lyrics.',
    '`lyrics` is required: section tags [Verse] [Chorus] [Bridge] [Outro], only words to be sung.',
    '`seconds` is a maximum (20-120); the song ends when the lyrics do. Non-commercial licence: never for paid work.',
  ],
};

/** One-line limits for local_media_capabilities. */
export function comfyLimits(entry: LibraryEntry, addons: string[] = []): string {
  const config = comfyConfig(entry);
  if (!config) return '';
  const parts: string[] = [];
  for (const task of Object.keys(config.templates)) {
    const params = taskParams(config, task, addons);
    const bits: string[] = [];
    const steps = range(params.steps);
    if (steps) bits.push(`${steps.default} steps`);
    const secs = range(params.seconds);
    if (secs) bits.push(`${secs.min}-${secs.max} s`);
    const mp = range(params.megapixels);
    if (mp) bits.push(`up to ${mp.max} MP`);
    if (params.negative === true) bits.push('negative prompt allowed');
    if (typeof params.maxImages === 'number') bits.push(`${params.maxImages} picture${params.maxImages === 1 ? '' : 's'} in`);
    parts.push(`${task}: ${bits.join(', ')}`);
  }
  return parts.join(' · ');
}
