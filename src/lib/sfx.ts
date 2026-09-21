// The same WAV files the export mixes in, so what you hear is what you render.
import { ClipChain, resumeAudio } from './audio';
import { fileSrc } from './ipc';
import type { SfxKind } from './types';

const sources = new Map<SfxKind, string>();

export function registerSfx(paths: Record<SfxKind, string>) {
  for (const [kind, path] of Object.entries(paths) as [SfxKind, string][]) sources.set(kind, fileSrc(path));
}

export const sfxSrc = (kind: SfxKind) => sources.get(kind) ?? '';

/** Previews an effect once (the Effects panel's play buttons). */
export function playSfx(kind: SfxKind, volume = 0.7) {
  const src = sources.get(kind);
  if (!src) return;
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.src = src;
  ClipChain.for(audio)?.configure({ channels: 'stereo', enhance: false, gain: volume });
  resumeAudio();
  void audio.play().catch(() => undefined);
}
