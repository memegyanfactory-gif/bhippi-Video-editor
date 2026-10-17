// The AI's door to generation models the user downloaded in the Model Library (Settings → Model
// Library): MiniMax H3 (video, a hand-written graph) and the image, music and sound models that run
// from ComfyUI's workflow templates (comfyModels.ts), all through ComfyUI. Kept apart from
// aiTools.ts so it can be tested with fake dependencies; aiTools.ts wires the real ones
// (generate_with_library_model and the libraryModels list in local_media_capabilities).
import type { Asset, ToolResult } from './types';
import type { CapabilityChoice, ComfyRunRequest, ComfyStatus, LibraryEntry, LibraryListing, LibraryView } from './modelLibrary';
import { usable } from './modelLibrary';
import type { ObjectInfo } from './comfyTemplates';
import {
  COMFY_MODEL_IDS, COMFY_PROMPT_RULES, COMFY_TASKS, ComfyBuildError, aspectRatio, buildComfyGraph, comfyConfig, comfyLimits, isComfyModel,
  type ComfyBuild, type ComfyRequest, type ComfyTask,
} from './comfyModels';
import {
  H3_ASPECTS, H3_MAX_REF_AUDIO, H3_MAX_REF_IMAGES, H3_MAX_REF_VIDEOS, H3_MAX_SECONDS, H3_MIN_SECONDS, H3_MODEL_ID, H3_PROMPT_RULES, H3_TASKS,
  buildH3Graph, checkH3Prompt, clampH3Seconds, h3AspectFor, h3Duration, h3FilesFromEntry, h3NodeClasses, type H3Files, type H3Task,
} from './minimaxH3';

type Args = Record<string, unknown>;
const done = (summary: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: true, ...data, summary });
const fail = (error: string): ToolResult => ({ ok: false, error });

export const LIBRARY_TOOL = 'generate_with_library_model';
/** Models this tool can drive. */
export const LIBRARY_GENERATORS = [H3_MODEL_ID, ...COMFY_MODEL_IDS] as const;

const SETTINGS_HINT = 'Settings → Model Library';

/** Checker problems that only advise (the generation still runs). Everything else stops it before any GPU time is spent. */
const ADVISORY = /^(Write an overall_soundscape|Dialogue \d+ has no speaker ID)/;

/**
 * What local_media_capabilities tells the AI about the library: every model the user downloaded and
 * switched on. Switching a model on is the user's permission for the AI to use it.
 */
export function libraryModelsForAi(listing: LibraryListing | null): Record<string, unknown>[] {
  if (!listing) return [];
  return listing.models.filter(usable).map((view) => {
    const { entry, state } = view;
    const generator = (LIBRARY_GENERATORS as readonly string[]).includes(entry.id);
    const files = entry.id === H3_MODEL_ID ? h3FilesFromEntry(entry, state.installedVariant, state.installedAddons) : null;
    const h3 = files && !('error' in files) ? files : null;
    const tasks = entry.id === H3_MODEL_ID ? entry.tasks.filter((task) => task !== 'ref2va' || !!h3?.ref2vaUnet) : entry.tasks;
    return {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      tasks,
      output: entry.output ?? null,
      license: entry.license.notice ?? entry.license.name,
      installedSize: state.installedVariant,
      addons: state.installedAddons,
      ...(generator ? { useWith: LIBRARY_TOOL } : { useWith: 'not a generation tool: it is used as the editor chooses it (chat provider or its own tool)' }),
      ...(isComfyModel(entry.id) ? comfyModelForAi(entry, state.installedAddons) : {}),
      ...(entry.id === H3_MODEL_ID ? {
        turbo: !!h3?.turboLora,
        referenceToVideo: !!h3?.ref2vaUnet,
        limits: `${H3_MIN_SECONDS}-${H3_MAX_SECONDS} s at 24 fps, 768p, native stereo sound with dialogue in 11 languages; at most ${H3_MAX_REF_IMAGES} reference images, ${H3_MAX_REF_VIDEOS} videos and ${H3_MAX_REF_AUDIO} audio clips. Slow on a home GPU: expect minutes per clip.`,
        promptGuide: entry.promptGuide,
        promptRules: H3_PROMPT_RULES,
        cloudAlternative: entry.cloudAlternative ?? null,
      } : {}),
    };
  });
}

/** What the AI is told about a template-driven ComfyUI model: its tasks, limits and prompt rules. */
function comfyModelForAi(entry: LibraryEntry, addons: string[]): Record<string, unknown> {
  const config = comfyConfig(entry);
  const tasks = Object.keys(config?.templates ?? {});
  const kind = entry.kind === 'image' ? 'picture' : 'audio';
  return {
    generates: kind,
    tasks,
    limits: comfyLimits(entry, addons),
    commercialUse: !/non-commercial|not for commercial|research/i.test(entry.license.summary.join(' ')),
    licenseSummary: entry.license.summary[0],
    promptGuide: entry.promptGuide,
    promptRules: COMFY_PROMPT_RULES[entry.promptGuide ?? ''] ?? [],
  };
}

/** A one-line reason a model is not usable, for the refusal the AI relays to the user. */
export function whyNotUsable(view: LibraryView | undefined, id: string): string | null {
  if (!view) return `The model "${id}" is not in the Model Library.`;
  if (!view.state.installedVariant) return `${view.entry.name} is not downloaded. Ask the user to download it in ${SETTINGS_HINT} (and read its licence there). Do not try to download it yourself.`;
  if (view.state.broken) return `${view.entry.name} is installed but unusable: ${view.state.broken}. Ask the user to repair or re-download it in ${SETTINGS_HINT}.`;
  if (!view.state.enabled) return `${view.entry.name} is downloaded but switched off. Ask the user to switch it on in ${SETTINGS_HINT}: that switch is their permission for me to use it. Meanwhile use another source (cloud generator, real footage).`;
  return null;
}

export type LibraryJob = { id: string; status: string; message: string; result: unknown };

export type LibraryGenDeps = {
  list: () => Promise<LibraryListing>;
  comfyStatus: () => Promise<ComfyStatus>;
  comfyStart: () => Promise<ComfyStatus>;
  comfyRun: (request: ComfyRunRequest) => Promise<{ jobId: string }>;
  jobs: () => Promise<LibraryJob[]>;
  importMedia: (paths: string[], folderId: string) => Promise<Asset[]>;
  assets: Map<string, Asset>;
  folderId: () => string;
  /** Shape of the timeline (16:9, 9:16...), used when nothing else says what aspect to make. */
  defaultAspect: string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  /** Longest a waiting call stays (default 90 minutes: H3 is slow on a home GPU). */
  timeoutMs?: number;
  /** Which model is in use per job (Model Library → In use); null when not known yet. Image and audio models follow it. */
  inUse?: () => Promise<CapabilityChoice[] | null>;
  /** A bundled ComfyUI workflow template by name (public/comfy-templates). */
  loadTemplate?: (name: string) => Promise<unknown>;
  /** The running ComfyUI's node definitions for some classes. */
  objectInfo?: (classes: string[]) => Promise<ObjectInfo>;
};

const strArg = (args: Args, key: string) => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()) : []);

/** The task the inputs imply, when the AI did not name one. */
export function inferH3Task(args: Args): H3Task {
  const refs = (args.references ?? {}) as Args;
  if (idList(refs.images).length || idList(refs.videos).length || idList(refs.audio).length) return 'ref2va';
  const first = !!strArg(args, 'firstFrameAssetId');
  const last = !!strArg(args, 'lastFrameAssetId');
  return first && last ? 'fl2va' : first ? 'i2va' : last ? 'l2va' : 't2va';
}

/** A short readable name for the result file when the AI gave none: the start of the first shot. */
function nameFrom(prompt: string): string {
  const shot = /\[Shot 1\]\s*([^.\n]{0,80})/.exec(prompt)?.[1] ?? prompt.slice(0, 60);
  return `MiniMax H3 ${shot.replace(/[<>:"/\\|?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50)}`.trim();
}

/** generate_with_library_model: one clip from a downloaded model, imported into the Generated bin. */
export async function runLibraryGeneration(args: Args, deps: LibraryGenDeps): Promise<ToolResult> {
  const named = strArg(args, 'model');
  const taskArg = strArg(args, 'task');
  // No model named: the task says what is wanted. Pictures and audio follow the model in use for that job; anything else is MiniMax H3, as before.
  if (!named && taskArg && (COMFY_TASKS as string[]).includes(taskArg)) return runComfyGeneration(args, deps, undefined);
  // No model and no task, but arguments only a picture or a song has (an edit's picture, lyrics): that is the job.
  if (!named && !taskArg) {
    const has = (key: string) => args[key] !== undefined && args[key] !== null && args[key] !== '';
    if (['lyrics', 'bpm', 'keyscale', 'timeSignature', 'language'].some(has)) return runComfyGeneration(args, deps, undefined, 'audio');
    if (['imageAssetId', 'image2AssetId', 'negativePrompt', 'megapixels', 'steps', 'cfg'].some(has)) return runComfyGeneration(args, deps, undefined, 'image');
  }
  const modelId = named ?? H3_MODEL_ID;
  if (!(LIBRARY_GENERATORS as readonly string[]).includes(modelId)) {
    return fail(`generate_with_library_model drives ${LIBRARY_GENERATORS.join(', ')}; "${modelId}" is not one of them. Check local_media_capabilities.libraryModels for what is on.`);
  }
  if (isComfyModel(modelId)) return runComfyGeneration(args, deps, modelId);
  let listing: LibraryListing;
  try { listing = await deps.list(); } catch (error) { return fail(`The Model Library could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  const view = listing.models.find((m) => m.entry.id === modelId);
  const blocked = whyNotUsable(view, modelId);
  if (blocked || !view) return fail(blocked ?? 'Model not found.');

  const files = h3FilesFromEntry(view.entry, view.state.installedVariant, view.state.installedAddons);
  if ('error' in files) return fail(files.error);
  const prompt = strArg(args, 'prompt');
  if (!prompt) return fail('Give a prompt in MiniMax H3 format (see local_media_capabilities.libraryModels[].promptRules).');

  const task = (strArg(args, 'task') as H3Task | undefined) ?? inferH3Task(args);
  if (!H3_TASKS.includes(task)) return fail(`task must be one of ${H3_TASKS.join(', ')}.`);
  const refsArg = (args.references ?? {}) as Args;
  const refIds = { images: idList(refsArg.images), videos: idList(refsArg.videos), audio: idList(refsArg.audio) };
  const firstId = strArg(args, 'firstFrameAssetId');
  const lastId = strArg(args, 'lastFrameAssetId');
  if (task === 'ref2va' && !(files as H3Files).ref2vaUnet) {
    return fail(`Reference-to-video needs the "Reference to video" add-on of ${view.entry.name}, which is not installed. Ask the user to add it in ${SETTINGS_HINT}, or use text, first-frame, last-frame or first+last-frame generation.`);
  }

  // Asset ids → files.
  const pick = (id: string, kind: Asset['kind'], what: string): { path: string; asset: Asset } | string => {
    const asset = deps.assets.get(id);
    if (!asset) return `${what} "${id}" is not in the project. Use asset IDs from get_project, import_media or an earlier generation.`;
    if (asset.missing) return `${what} "${asset.name}" is missing on disk.`;
    if (asset.kind !== kind) return `${what} "${asset.name}" is ${asset.kind === 'image' ? 'an image' : `a ${asset.kind}`}, not ${kind === 'image' ? 'an image' : `a ${kind}`}.`;
    return { path: asset.path, asset };
  };
  const frames: { first?: { path: string; asset: Asset }; last?: { path: string; asset: Asset } } = {};
  for (const [slot, id, what] of [['first', firstId, 'First frame'], ['last', lastId, 'Last frame']] as const) {
    if (!id) continue;
    const found = pick(id, 'image', what);
    if (typeof found === 'string') return fail(found);
    frames[slot] = found;
  }
  const refs: { images: string[]; videos: string[]; audio: string[] } = { images: [], videos: [], audio: [] };
  for (const [key, kind, what] of [['images', 'image', 'Reference image'], ['videos', 'video', 'Reference video'], ['audio', 'audio', 'Reference audio']] as const) {
    for (const id of refIds[key]) {
      const found = pick(id, kind, what);
      if (typeof found === 'string') return fail(found);
      refs[key].push(found.path);
    }
  }

  // Task and inputs have to agree before the prompt is judged.
  const needFirst = task === 'i2va' || task === 'fl2va';
  const needLast = task === 'fl2va' || task === 'l2va';
  if (needFirst && !frames.first) return fail(`${task} needs firstFrameAssetId (an imported image).`);
  if (needLast && !frames.last) return fail(`${task} needs lastFrameAssetId (an imported image).`);
  if (!needFirst && frames.first) return fail(`${task} does not use a first frame. Use task i2va or fl2va, or drop firstFrameAssetId.`);
  if (!needLast && frames.last) return fail(`${task} does not use a last frame. Use task l2va or fl2va, or drop lastFrameAssetId.`);
  if (task === 'ref2va' && !refs.images.length && !refs.videos.length && !refs.audio.length) return fail('ref2va needs references: images, videos or audio asset IDs.');
  if (task !== 'ref2va' && (refs.images.length || refs.videos.length || refs.audio.length)) return fail(`references only work with task ref2va (you chose ${task}).`);
  if (refs.images.length > H3_MAX_REF_IMAGES || refs.videos.length > H3_MAX_REF_VIDEOS || refs.audio.length > H3_MAX_REF_AUDIO) {
    return fail(`ref2va takes at most ${H3_MAX_REF_IMAGES} images, ${H3_MAX_REF_VIDEOS} videos and ${H3_MAX_REF_AUDIO} audio clips.`);
  }

  const requested = typeof args.seconds === 'number' && Number.isFinite(args.seconds) ? args.seconds : 5;
  const seconds = clampH3Seconds(requested);
  const real = h3Duration(seconds);
  const checked = checkH3Prompt(prompt, {
    task, seconds: real,
    imageCount: task === 'ref2va' ? undefined : (frames.first ? 1 : 0) + (frames.last ? 1 : 0),
    refs: task === 'ref2va' ? { images: refs.images.length, videos: refs.videos.length, audio: refs.audio.length } : undefined,
  });
  const blocking = checked.problems.filter((p) => !ADVISORY.test(p));
  const advisory = checked.problems.filter((p) => ADVISORY.test(p));
  if (blocking.length) {
    return fail(`The prompt is not in MiniMax H3's format, so nothing was generated (no GPU time spent). Fix these and call again: ${blocking.join(' · ')}${checked.fixes.length ? ` (Already repaired for you: ${checked.fixes.join(' · ')})` : ''} The format rules are in local_media_capabilities.libraryModels[].promptRules.`);
  }

  // ComfyUI: installed, running, with H3's nodes.
  let status: ComfyStatus;
  try {
    status = await deps.comfyStatus();
    if (!status.installed && status.source !== 'external') return fail(`ComfyUI, the engine that runs ${view.entry.name}, is not set up. Ask the user to install it in ${SETTINGS_HINT}.`);
    if (!status.running) status = await deps.comfyStart();
  } catch (error) { return fail(`ComfyUI could not be started: ${error instanceof Error ? error.message : String(error)}`); }
  const needed = h3NodeClasses(task, { videos: refs.videos.length, audio: refs.audio.length });
  const missing = status.missingNodes.filter((node) => needed.includes(node));
  if (missing.length) {
    return fail(`The ComfyUI that is running lacks the MiniMax H3 nodes it needs (${missing.join(', ')}). It must be ComfyUI 0.41 or newer: ask the user to update or reinstall ComfyUI in ${SETTINGS_HINT}.`);
  }

  const aspectArg = strArg(args, 'aspect');
  const aspect = aspectArg && (H3_ASPECTS as readonly string[]).includes(aspectArg)
    ? aspectArg
    : frames.first ? h3AspectFor(frames.first.asset.width, frames.first.asset.height) : frames.last ? h3AspectFor(frames.last.asset.width, frames.last.asset.height) : deps.defaultAspect;
  const seed = typeof args.seed === 'number' && Number.isFinite(args.seed) ? Math.floor(args.seed) : Math.floor(Math.random() * 2 ** 31);
  const useVideoAudio = args.useReferenceVideoAudio === true;

  let built;
  try {
    built = buildH3Graph({
      task, files: files as H3Files, seconds, aspect: aspect, seed, turbo: args.turbo === true, prompt: checked.prompt,
      firstFrame: frames.first?.path, lastFrame: frames.last?.path, references: refs, useVideoAudio,
    });
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }

  const outputName = strArg(args, 'name') ?? nameFrom(checked.prompt);
  let jobId: string;
  try {
    ({ jobId } = await deps.comfyRun({ graph: built.graph, inputs: built.inputs, label: `MiniMax H3 ${task}`, outputName, modelId }));
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }

  const info = {
    jobId, model: modelId, task, seconds: real, frames: built.frames, steps: built.steps, turbo: built.turbo, size: `${built.width}x${built.height}`, aspect, seed,
    fixes: checked.fixes, notes: [...built.notes, ...(requested !== seconds ? [`Length ${requested} s was outside ${H3_MIN_SECONDS}-${H3_MAX_SECONDS} s; used ${seconds} s.`] : [])], advisory,
    prompt: checked.prompt,
  };
  if (args.wait === false) {
    return done(`MiniMax H3 started as background job ${jobId} (${built.steps} steps, ${real.toFixed(2)} s). It can take many minutes on a home GPU. Import it with import_generated_media once generation_job shows it done.`, info);
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.timeoutMs ?? 90 * 60_000);
  while (Date.now() < deadline) {
    if (deps.signal?.aborted) return done(`Stopped waiting; MiniMax H3 job ${jobId} keeps running in the background. Import it later with import_generated_media.`, info);
    await sleep(1500);
    const job = (await deps.jobs()).find((entry) => entry.id === jobId);
    if (!job || job.status === 'running') continue;
    if (job.status !== 'done') return fail(`MiniMax H3 ${job.status}: ${job.message}`);
    const path = (job.result as { path?: string } | null)?.path;
    if (!path) return fail('MiniMax H3 finished but produced no video file.');
    const imported = await deps.importMedia([path], deps.folderId());
    if (!imported.length) return fail('The video was made but could not be imported into the project.');
    const asset = imported[0];
    const learned = checked.fixes.length ? ` Format repairs made to the prompt: ${checked.fixes.join(' · ')}.` : '';
    return done(`Generated and imported MiniMax H3 video "${asset.name}" (asset ID: ${asset.id}, ${real.toFixed(2)} s, with its own sound) into the Generated folder. Ready to place on the timeline.${learned}${advisory.length ? ` Worth fixing next time: ${advisory.join(' · ')}` : ''}`, { ...info, assetId: asset.id, assets: imported, path });
  }
  return done(`MiniMax H3 job ${jobId} is still running after the wait limit. Import it later with import_generated_media.`, info);
}

// --- pictures, music and sound from ComfyUI's workflow templates -------------------------------------

type ComfyJob = 'image' | 'audio';
const JOB_WORDS: Record<ComfyJob, { what: string; noun: string }> = {
  image: { what: 'images', noun: 'picture' },
  audio: { what: 'music or sound', noun: 'audio' },
};
const numArg = (args: Args, key: string): number | undefined => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);

/** A short readable name for the result file when the AI gave none. */
function comfyName(entry: LibraryEntry, args: Args): string {
  const text = (strArg(args, 'prompt') ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/[<>:"/\\|?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return `${entry.name} ${text}`.trim();
}

/**
 * generate_with_library_model for a picture, a song or a sound: one result from a ComfyUI workflow
 * template model, imported into the Generated bin. Follows the model in use for the job; a job set
 * to None is refused, and so is a model that is not downloaded or not switched on.
 */
async function runComfyGeneration(args: Args, deps: LibraryGenDeps, modelId: string | undefined, jobHint?: ComfyJob): Promise<ToolResult> {
  let listing: LibraryListing;
  try { listing = await deps.list(); } catch (error) { return fail(`The Model Library could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  const requestedTask = strArg(args, 'task') as ComfyTask | undefined;
  if (requestedTask && !COMFY_TASKS.includes(requestedTask)) return fail(`task must be one of ${COMFY_TASKS.join(', ')} for pictures and audio (t2va, i2va... are MiniMax H3's video tasks).`);
  const named = modelId ? listing.models.find((view) => view.entry.id === modelId) : undefined;
  if (modelId && !named) return fail(`The model "${modelId}" is not in the Model Library.`);
  const job: ComfyJob = requestedTask ? (requestedTask === 't2i' || requestedTask === 'edit' ? 'image' : 'audio') : named ? (named.entry.kind === 'audio' ? 'audio' : 'image') : jobHint ?? 'image';
  const words = JOB_WORDS[job];

  // The model in use for this job decides. None means the AI does not do this job locally.
  let choices: CapabilityChoice[] | null = null;
  try { choices = deps.inUse ? await deps.inUse() : null; } catch { choices = null; }
  const choice = choices?.find((each) => each.capability === job);
  let view = named;
  if (choices) {
    if (!choice?.modelId) {
      return fail(`No local ${job} model is in use (${SETTINGS_HINT} → In use), so I do not make ${words.what} on this PC. Ask the user to put a downloaded model in use there${job === 'image' ? ', or use generate_cloud_media for pictures' : ''}.`);
    }
    const inUse = listing.models.find((each) => each.entry.id === choice.modelId);
    if (modelId && choice.modelId !== modelId) {
      return fail(`The ${job} model in use is ${inUse?.entry.name ?? choice.modelId}, not ${named?.entry.name ?? modelId}. Leave out "model" to use it, or ask the user to change it in ${SETTINGS_HINT} → In use.`);
    }
    view = inUse;
    if (!view) return fail(`The ${job} model in use (${choice.modelId}) is not in the Model Library.`);
    if (!isComfyModel(view.entry.id)) {
      return fail(`The ${job} model in use is ${view.entry.name}, which is used through generate_local_media (task "${job === 'image' ? 'image' : 'audio'}"), not through generate_with_library_model.`);
    }
  } else if (!view) {
    view = listing.models.filter(usable).find((each) => isComfyModel(each.entry.id) && each.entry.kind === job);
    if (!view) return fail(`No downloaded ${job} model is switched on. Ask the user to download one in ${SETTINGS_HINT} and put it in use.`);
  }
  const entry = view.entry;
  if (entry.kind !== job) return fail(`${entry.name} makes ${entry.kind === 'image' ? 'pictures' : 'audio'}, not ${words.what}.`);
  const blocked = whyNotUsable(view, entry.id);
  if (blocked) return fail(blocked);
  const config = comfyConfig(entry);
  if (!config) return fail(`${entry.name} has no workflow in this version of Bhippi.`);

  // Which task, and the pictures it reads.
  const imageId = strArg(args, 'imageAssetId');
  const image2Id = strArg(args, 'image2AssetId');
  const task: ComfyTask = requestedTask ?? (job === 'image' ? (imageId ? 'edit' : 't2i') : config.templates.song ? 'song' : 'audio');
  if (!config.templates[task]) return fail(`${entry.name} cannot do "${task}". It does: ${Object.keys(config.templates).join(', ')}.`);
  const picks: { path: string; asset: Asset }[] = [];
  for (const [id, what] of [[imageId, 'imageAssetId'], [image2Id, 'image2AssetId']] as const) {
    if (!id) continue;
    const asset = deps.assets.get(id);
    if (!asset) return fail(`${what} "${id}" is not in the project. Use asset IDs from get_project, import_media or an earlier generation.`);
    if (asset.missing) return fail(`"${asset.name}" is missing on disk.`);
    if (asset.kind !== 'image') return fail(`"${asset.name}" is ${asset.kind === 'video' ? 'a video' : `an ${asset.kind}`}, not a picture. Grab a frame first, or pick an image asset.`);
    picks.push({ path: asset.path, asset });
  }
  if (image2Id && !imageId) return fail('image2AssetId needs imageAssetId too (image 1 comes first).');
  if (task !== 'edit' && picks.length) return fail(`${task} does not take pictures. Use task edit, or drop imageAssetId.`);
  if (task === 'edit' && !picks.length) return fail('An edit needs the picture to change: pass imageAssetId (an imported image).');

  const aspectArg = strArg(args, 'aspect');
  const aspectNotes: string[] = [];
  let aspect = deps.defaultAspect;
  if (aspectArg) {
    const ratio = aspectRatio(aspectArg);
    if (ratio && ratio >= 1 / 3 && ratio <= 3) aspect = aspectArg;
    else aspectNotes.push(`Aspect "${aspectArg}" is not a ratio between 1:3 and 3:1; used ${aspect}.`);
  }
  const request: ComfyRequest = {
    prompt: strArg(args, 'prompt'),
    negative: strArg(args, 'negativePrompt'),
    aspect,
    megapixels: numArg(args, 'megapixels'),
    steps: numArg(args, 'steps'),
    cfg: numArg(args, 'cfg'),
    seed: numArg(args, 'seed'),
    images: picks.map((pick) => pick.path),
    lyrics: strArg(args, 'lyrics'),
    seconds: numArg(args, 'seconds'),
    bpm: numArg(args, 'bpm'),
    keyscale: strArg(args, 'keyscale'),
    timesignature: typeof args.timeSignature === 'string' || typeof args.timeSignature === 'number' ? (args.timeSignature as string | number) : undefined,
    language: strArg(args, 'language'),
  };

  // ComfyUI: installed and running.
  let status: ComfyStatus;
  try {
    status = await deps.comfyStatus();
    if (!status.installed && status.source !== 'external') return fail(`ComfyUI, the engine that runs ${entry.name}, is not set up. Ask the user to install it in ${SETTINGS_HINT}.`);
    if (!status.running) status = await deps.comfyStart();
  } catch (error) { return fail(`ComfyUI could not be started: ${error instanceof Error ? error.message : String(error)}`); }
  if (!deps.loadTemplate || !deps.objectInfo) return fail('This build of Bhippi cannot read ComfyUI workflows.');

  let built: ComfyBuild;
  try {
    built = await buildComfyGraph(entry, view.state, task, request, { loadTemplate: deps.loadTemplate, objectInfo: deps.objectInfo }, choice?.modelId === entry.id ? choice.variant : null);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return fail(error instanceof ComfyBuildError ? text : `${entry.name}'s workflow could not be prepared: ${text}`);
  }

  const outputName = strArg(args, 'name') ?? comfyName(entry, args);
  let jobId: string;
  try {
    ({ jobId } = await deps.comfyRun({ graph: built.graph, inputs: built.inputs, label: `${entry.name} ${task}`, outputName, modelId: entry.id, kind: built.kind }));
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }

  const info = { jobId, model: entry.id, name: entry.name, task, ...built.used, notes: [...aspectNotes, ...built.notes], prompt: request.prompt };
  const noun = words.noun;
  if (args.wait === false) {
    return done(`${entry.name} started as background job ${jobId}. Import the ${noun} with import_generated_media once generation_job shows it done.`, info);
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.timeoutMs ?? 90 * 60_000);
  while (Date.now() < deadline) {
    if (deps.signal?.aborted) return done(`Stopped waiting; ${entry.name} job ${jobId} keeps running in the background. Import it later with import_generated_media.`, info);
    await sleep(1500);
    const found = (await deps.jobs()).find((each) => each.id === jobId);
    if (!found || found.status === 'running') continue;
    if (found.status !== 'done') return fail(`${entry.name} ${found.status}: ${found.message}`);
    const path = (found.result as { path?: string } | null)?.path;
    if (!path) return fail(`${entry.name} finished but produced no ${noun} file.`);
    const imported = await deps.importMedia([path], deps.folderId());
    if (!imported.length) return fail(`The ${noun} was made but could not be imported into the project.`);
    const asset = imported[0];
    const detail = built.kind === 'image' ? `${built.used.width ?? asset.width ?? '?'}x${built.used.height ?? asset.height ?? '?'}` : `${String(built.used.seconds ?? '?')} s`;
    return done(`Generated and imported ${noun} "${asset.name}" (asset ID: ${asset.id}, ${detail}) with ${entry.name} into the Generated folder. Ready to place on the timeline.${built.notes.length ? ` Notes: ${built.notes.join(' · ')}` : ''}`, { ...info, assetId: asset.id, assets: imported, path });
  }
  return done(`${entry.name} job ${jobId} is still running after the wait limit. Import it later with import_generated_media.`, info);
}
