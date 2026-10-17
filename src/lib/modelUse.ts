// Which AI job a downloaded library model does, and whether it is switched on for it. The Model
// Library shows this as one clear button on every downloaded model: "Use for video", or
// "In use for video" with a way to stop. Pure, so the mapping can be tested.
import type { CapabilityChoice, LibraryCapability, LibraryEntry, LibraryVariant } from './modelLibrary';

type EntryShape = Pick<LibraryEntry, 'id' | 'kind' | 'tasks'>;

/** The job a model of this kind does. Null for the tools the AI calls on its own (depth, tracking, erase). */
export function capabilityOfEntry(entry: Pick<LibraryEntry, 'kind' | 'tasks'>): LibraryCapability | null {
  switch (entry.kind) {
    case 'video': return 'video';
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'voice': return 'voice';
    case 'speech': return 'speech';
    case 'llm': return 'llm';
    case 'matte': return entry.tasks.includes('roto') ? 'roto' : null;
  }
}

/** How each job reads in a sentence: "Use for video", "In use for cutouts". */
export const JOB_NAME: Record<LibraryCapability, string> = {
  video: 'video',
  image: 'images',
  audio: 'music and sound',
  voice: 'voice-over',
  speech: 'transcription',
  roto: 'cutouts',
  llm: 'chat',
};

export type UseState =
  /** The AI calls this model directly; there is nothing to switch. */
  | { mode: 'tool' }
  | { mode: 'off' | 'on'; capability: LibraryCapability; job: string };

/** The id the library stores for a job: ViTMatte is only ever used together with SAM 2.1. */
const storedId = (capability: LibraryCapability, id: string) => (capability === 'roto' && id === 'vitmatte' ? 'sam2' : id);

/** Whether the AI uses this model for its job right now, from the library's In use answer. */
export function useStateOf(entry: EntryShape, choices: CapabilityChoice[]): UseState {
  const capability = capabilityOfEntry(entry);
  if (!capability) return { mode: 'tool' };
  const chosen = choices.find((choice) => choice.capability === capability)?.modelId ?? null;
  return { mode: chosen !== null && chosen === storedId(capability, entry.id) ? 'on' : 'off', capability, job: JOB_NAME[capability] };
}

/** The local-media installer task a model downloads with (null for any other runtime). */
export function localTaskOf(entry: Pick<LibraryEntry, 'runtime' | 'install'>, variant?: Pick<LibraryVariant, 'install'>): string | null {
  if (entry.runtime !== 'local-media') return null;
  return variant?.install?.task ?? entry.install?.task ?? null;
}

/** Local-media tasks whose weights are gated on Hugging Face (FLUX.1 schnell, Stable Audio Open). */
const HF_GATED = new Set(['image-flux', 'audio']);
export const needsHfToken = (task: string | null): boolean => !!task && HF_GATED.has(task);

/** The button's words for a state; `tool` has no button, only a quiet note. */
export function useLabel(state: UseState): string {
  if (state.mode === 'tool') return 'Ready for the AI';
  return state.mode === 'on' ? `In use for ${state.job}` : `Use for ${state.job}`;
}

/** The In use row's headline: what Bhippi does for this job, or that it does not. */
export function jobSummary(capability: LibraryCapability, modelName: string | null): { on: boolean; text: string } {
  return modelName
    ? { on: true, text: `Bhippi uses: ${modelName}` }
    : { on: false, text: capability === 'llm' ? 'None: no local chat model' : 'None: the AI won’t do this on your PC' };
}
