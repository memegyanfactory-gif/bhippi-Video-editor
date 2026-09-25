// The AI pack (src-tauri/src/ai_pack.rs): one click installs the Python runtime, PyTorch (CUDA on
// an NVIDIA GPU) and the checkpoints behind Magic Mask, tracked Roto, depth, the magic eraser and
// the person tracker. Text-to-image and text-to-video models are not part of it.
import { invoke } from '@tauri-apps/api/core';

export type AiPackStatus = {
  python: boolean;
  libraries: boolean;
  cuda: boolean;
  /** [task id, installed] in install order. */
  tasks: [string, boolean][];
  /** Roughly what is left to download, MB. */
  remainingMb: number;
};

export const aiPackApi = {
  status: () => invoke<AiPackStatus>('ai_pack_status'),
  /** Starts the install as a background job; returns its id. */
  install: () => invoke<string>('ai_pack_install'),
};

/** Everything in the pack is in place. */
export const aiPackReady = (status: AiPackStatus | null) => !!status && status.python && status.libraries && status.tasks.every(([, done]) => done);

export const AI_PACK_FEATURES = 'Magic Mask, tracked Roto, depth occlusion, the magic eraser and the person tracker';
