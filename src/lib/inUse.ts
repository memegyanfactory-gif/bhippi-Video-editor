// The models the editor put "in use" for each job (Settings → Model Library → In use), as the AI sees
// them. The Rust side owns the choice (model_library_defaults); this file keeps the last answer so
// the synchronous edit-workflow gate can read it, and turns it into what local_media_capabilities
// tells the model: which model to use and which tool drives it.
import { libraryApi, type CapabilityChoice, type LibraryCapability } from './modelLibrary';
import { COMFY_MODEL_IDS } from './comfyModels';

/** The library models that are driven through generate_with_library_model instead of generate_local_media (MiniMax H3, and the ComfyUI template models for pictures, music and sound). */
const LIBRARY_TOOL_MODELS = new Set<string>(['minimax-h3', ...COMFY_MODEL_IDS]);
const LIBRARY_TOOL = 'generate_with_library_model';
/**
 * Image models that can also edit a picture (their catalog tasks include "edit"). With an image model
 * in use that only makes pictures (Z-Image Turbo, ERNIE…), picture edits stay with the local SDXL worker.
 */
const EDIT_MODELS = new Set<string>(['flux2-klein-4b', 'qwen-image-2-1', 'qwen-image-edit-2511']);

/** What the AI calls for a model in use. `task` is the generate_local_media task, when that is the tool. */
export function toolFor(capability: LibraryCapability, modelId: string): { tool: string; task?: string } | null {
  if (LIBRARY_TOOL_MODELS.has(modelId)) return { tool: LIBRARY_TOOL };
  switch (capability) {
    case 'video': return { tool: 'generate_local_media', task: 'video' };
    case 'image': return { tool: 'generate_local_media', task: 'image' };
    case 'audio': return { tool: 'generate_local_media', task: 'audio' };
    case 'voice': return { tool: 'synthesize_speech_voiceover' };
    case 'speech': return { tool: 'transcribe' };
    case 'roto': return { tool: 'rotoscope_clip' };
    case 'llm': return null; // a chat provider, not a tool
  }
}

let cache: CapabilityChoice[] | null = null;

/** Replaces the remembered answer (null forgets it, so the old "disable local generation" switch decides again). */
export function setInUse(choices: CapabilityChoice[] | null): void {
  cache = choices;
}

export const getInUse = (): CapabilityChoice[] | null => cache;

/** Asks the library which models are in use. A failed ask (no desktop shell, as in tests) keeps the last answer. */
export async function refreshInUse(): Promise<CapabilityChoice[] | null> {
  try {
    cache = await libraryApi.defaults();
  } catch {
    // keep whatever was known
  }
  return cache;
}

/** One line per job with a model in use: the model, its size, and the tool that drives it. */
export function inUseForAi(choices: CapabilityChoice[] | null): Record<string, unknown>[] {
  if (!choices) return [];
  return choices.flatMap((choice) => {
    if (!choice.modelId) return [];
    const found = choice.candidates.find((candidate) => candidate.modelId === choice.modelId && (choice.variant === null || candidate.variant === choice.variant));
    const driver = toolFor(choice.capability, choice.modelId);
    return [{
      capability: choice.capability,
      modelId: choice.modelId,
      name: found?.name ?? choice.modelId,
      size: found?.variantLabel ?? null,
      ...(driver ? { tool: driver.tool, ...(driver.task ? { task: driver.task } : {}) } : { tool: null }),
      note: choice.note,
    }];
  });
}

/** `generate_local_media` tasks per job the gate looks at. */
const TASK_JOB: Record<string, 'video' | 'image'> = { video: 'video', image: 'image', 'image-edit': 'image', 'image-inpaint': 'image' };

export type LocalGate = { allowed: true } | { allowed: false; why: string };

/**
 * May `generate_local_media` run this task? With the library's answer known, only the model in use for
 * that job counts (none = the AI does not do it locally; MiniMax H3 = use its own tool). Without it,
 * the old global switch decides, as before.
 */
export function localGenerationGate(task: string, choices: CapabilityChoice[] | null, switchedOff: boolean): LocalGate {
  // Music and sound are not switched off by the old setting; they only move to the library tool when a template model is in use for them.
  if (task === 'audio') {
    const audio = choices?.find((each) => each.capability === 'audio');
    if (audio?.modelId && LIBRARY_TOOL_MODELS.has(audio.modelId)) {
      return { allowed: false, why: `The audio model in use is ${audio.candidates.find((each) => each.modelId === audio.modelId)?.name ?? audio.modelId}: call ${LIBRARY_TOOL} (task "song" or "audio") instead of generate_local_media.` };
    }
    return { allowed: true };
  }
  const job = TASK_JOB[task];
  if (!job) return { allowed: true };
  if (!choices) return switchedOff ? { allowed: false, why: '' } : { allowed: true };
  const choice = choices.find((each) => each.capability === job);
  if (!choice?.modelId) return { allowed: false, why: `No local ${job} model is in use (Settings → Model Library → In use).` };
  const edit = task === 'image-edit' || task === 'image-inpaint';
  if (edit && LIBRARY_TOOL_MODELS.has(choice.modelId) && !EDIT_MODELS.has(choice.modelId)) return { allowed: true };
  if (LIBRARY_TOOL_MODELS.has(choice.modelId)) {
    return { allowed: false, why: `The ${job} model in use is ${choice.candidates.find((each) => each.modelId === choice.modelId)?.name ?? choice.modelId}: call ${LIBRARY_TOOL} instead of generate_local_media.` };
  }
  return { allowed: true };
}
