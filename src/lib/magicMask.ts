// Magic Mask: click an object in the Program Monitor, see it masked straight away, track it through
// the clip, then limit any effect to inside or outside it — Resolve's Magic Mask, on SAM 2.1.
//
// The model side is src-tauri/src/magic_mask.rs (+ workers/magic_mask.py). Here: the masks as project
// data, the frame arithmetic that keeps a click on the frame it was made on, a tiny view store the
// Program Monitor and the preview layers share (which mask is active, the instant one-frame result),
// and the tracking run.
import { useSyncExternalStore } from 'react';
import { uid } from './editor';
import { api } from './ipc';
import { updateComp } from './timeline';
import type { AppliedEffect, Clip, MagicMask, Project, RotoCorrection } from './types';

export const MASK_COLORS = ['#ff3b5c', '#2fa8ff', '#ffc233', '#3ddc84', '#b06bff', '#ff8a3d'];

/** The longest source range one tracking pass covers (the Roto frame puller's own limit). */
export const MAX_TRACK_SECONDS = 300;

export function newMagicMask(clip: Clip): MagicMask {
  const taken = new Set((clip.magicMasks ?? []).map((mask) => mask.name));
  let n = (clip.magicMasks?.length ?? 0) + 1;
  while (taken.has(`Mask ${n}`)) n++;
  return { id: uid(), name: `Mask ${n}`, points: [], matte: null, trackedKey: null, invert: false, expand: 0, feather: 0, consistency: 0.5, quality: 'fast', color: MASK_COLORS[(n - 1) % MASK_COLORS.length] };
}

export const maskColor = (mask: MagicMask, index = 0) => mask.color ?? MASK_COLORS[index % MASK_COLORS.length];

/**
 * The source frame the monitor shows at source time `sourceTime`. A parked video element is aimed
 * half a frame late (Compositor `parkedAt`), so it shows the nearest frame, not the one before.
 */
export const frameIndex = (sourceTime: number, fps: number) => Math.max(0, Math.floor(sourceTime * fps + 0.5 + 1e-6));

/** A click's `at`: the middle of its frame, so rounding either way lands on the same frame. */
export const frameTime = (index: number, fps: number) => (index + 0.5) / fps;

/** Where FFmpeg must seek to hand back exactly frame `index` (it keeps the first frame at/after). */
export const seekTime = (index: number, fps: number) => Math.max(0, (index - 0.02) / fps);

export const pointsOnFrame = (mask: MagicMask, index: number, fps: number) => mask.points.filter((point) => Math.floor(point.at * fps + 1e-6) === index);

/** The source range a tracking pass covers: the whole clip. */
export function trackRange(clip: Clip): { from: number; seconds: number } {
  return { from: Math.max(0, clip.in), seconds: Math.max(1 / 120, clip.duration * clip.speed) };
}

/** What a matte was tracked from. When it differs from the mask's `trackedKey` the matte is stale. */
export function magicMaskKey(mask: MagicMask, clip: Clip): string {
  const { from, seconds } = trackRange(clip);
  const points = mask.points.map((p) => `${p.at.toFixed(4)}:${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.mode}`).join('|');
  return `v1|${from.toFixed(3)}|${seconds.toFixed(3)}|${mask.quality}|${mask.consistency.toFixed(2)}|${points}`;
}

export type MaskStatus = 'empty' | 'untracked' | 'stale' | 'tracked';
export function maskStatus(mask: MagicMask, clip: Clip): MaskStatus {
  if (!mask.points.some((p) => p.mode === 'include')) return mask.matte ? 'stale' : 'empty';
  if (!mask.matte) return 'untracked';
  return mask.trackedKey === magicMaskKey(mask, clip) ? 'tracked' : 'stale';
}

/** The mask an effect is limited to, and on which side; `off` when that mask is gone or untracked. */
export function effectScope(clip: Clip, fx: AppliedEffect): { kind: 'whole' } | { kind: 'masked'; mask: MagicMask; outside: boolean } | { kind: 'off' } {
  if (!fx.maskId) return { kind: 'whole' };
  const mask = clip.magicMasks?.find((entry) => entry.id === fx.maskId);
  if (!mask?.matte) return { kind: 'off' };
  return { kind: 'masked', mask, outside: fx.maskSide === 'outside' };
}

/** The effects that apply to the whole clip (the CSS filter on the layer); masked ones draw in MagicMaskLayer. */
export function wholeClipEffects(clip: Clip): AppliedEffect[] | undefined {
  if (!clip.appliedEffects?.some((fx) => fx.maskId)) return clip.appliedEffects;
  return clip.appliedEffects.filter((fx) => effectScope(clip, fx).kind === 'whole');
}

export function patchMask(project: Project, compId: string, clipId: string, maskId: string, change: (mask: MagicMask) => MagicMask | null): Project {
  return updateComp(project, compId, (comp) => ({
    ...comp,
    clips: comp.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const masks = (clip.magicMasks ?? []).flatMap((mask) => {
        if (mask.id !== maskId) return [mask];
        const next = change(mask);
        return next ? [next] : [];
      });
      // Deleting a mask releases the effects limited to it back to the whole clip would surprise:
      // they would suddenly cover everything. They are switched off instead.
      const gone = !masks.some((mask) => mask.id === maskId);
      const appliedEffects = gone ? clip.appliedEffects?.map((fx) => (fx.maskId === maskId ? { ...fx, enabled: false, maskId: null } : fx)) : clip.appliedEffects;
      return { ...clip, magicMasks: masks, appliedEffects };
    }),
  }));
}

export function addMask(project: Project, compId: string, clipId: string, mask: MagicMask): Project {
  return updateComp(project, compId, (comp) => ({ ...comp, clips: comp.clips.map((clip) => (clip.id === clipId ? { ...clip, magicMasks: [...(clip.magicMasks ?? []), mask] } : clip)) }));
}

// ─── The shared view ─────────────────────────────────────────────────────────────────────────

export type FramePreview = { clipId: string; maskId: string; frame: number; png: string };
export type MagicMaskView = {
  /** The mask new clicks go to, per clip. */
  active: Record<string, string>;
  /** The latest one-frame answer, shown until that frame's matte is tracked. */
  preview: FramePreview | null;
  busy: string | null;
  error: string | null;
  /** The clip whose masks are tinted over the picture (while the tool is in hand), or null. */
  overlay: string | null;
};

let view: MagicMaskView = { active: {}, preview: null, busy: null, error: null, overlay: null };
const listeners = new Set<() => void>();
export function setMagicMaskView(change: Partial<MagicMaskView> | ((current: MagicMaskView) => Partial<MagicMaskView>)) {
  view = { ...view, ...(typeof change === 'function' ? change(view) : change) };
  for (const listener of listeners) listener();
}
export const getMagicMaskView = () => view;
export function useMagicMaskView(): MagicMaskView {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getMagicMaskView);
}

// ─── Instant preview ─────────────────────────────────────────────────────────────────────────

let asking = 0;
/** Asks the resident picker for one frame's mask from that frame's clicks; last request wins. */
export async function previewFrame(clip: Clip, mask: MagicMask, assetId: string, index: number, fps: number): Promise<void> {
  const points = pointsOnFrame(mask, index, fps);
  const ticket = ++asking;
  if (!points.some((p) => p.mode === 'include')) {
    setMagicMaskView({ preview: null, busy: null });
    return;
  }
  setMagicMaskView({ busy: 'Masking…', error: null });
  try {
    const result = await api.magicMaskFrame(assetId, seekTime(index, fps), points);
    if (ticket !== asking) return;
    setMagicMaskView({ preview: { clipId: clip.id, maskId: mask.id, frame: index, png: result.png }, busy: null });
  } catch (error) {
    if (ticket !== asking) return;
    setMagicMaskView({ busy: null, error: error instanceof Error ? error.message : String(error) });
  }
}

// ─── Tracking ────────────────────────────────────────────────────────────────────────────────

export type TrackProgress = { fraction: number; message: string };

/**
 * Tracks `mask` through the whole of `clip` and returns the matte and the key it was tracked from.
 * Clicks outside the clip's source range are left out of this pass (they stay on the mask).
 */
export async function trackMagicMask(clip: Clip, mask: MagicMask, assetId: string, fps: number, signal?: AbortSignal, onProgress?: (progress: TrackProgress) => void): Promise<{ matte: string; key: string }> {
  const check = () => { if (signal?.aborted) throw new Error('Cancelled'); };
  const { from, seconds } = trackRange(clip);
  if (seconds > MAX_TRACK_SECONDS) throw new Error(`Magic Mask tracks up to ${MAX_TRACK_SECONDS / 60} minutes of source at a time; razor the clip and track each part.`);
  const points: RotoCorrection[] = mask.points
    .filter((p) => p.at >= from - 0.5 / fps && p.at < from + seconds)
    .map((p) => ({ ...p, at: Math.max(0, p.at - from) }));
  if (!points.some((p) => p.mode === 'include')) throw new Error('Click the object on a frame inside this clip first.');
  const key = magicMaskKey(mask, clip);
  onProgress?.({ fraction: 0, message: 'Pulling frames' });
  const pulled = await api.rotoFrames(assetId, from, seconds, fps);
  check();
  const jobId = await api.magicMaskTrackStart(pulled.runId, from, pulled.fps ?? fps, points, mask.quality, mask.consistency);
  for (;;) {
    if (signal?.aborted) { await api.jobCancel(jobId); check(); }
    const job = (await api.jobsList()).find((item) => item.id === jobId);
    if (!job) throw new Error('The Magic Mask job disappeared.');
    onProgress?.({ fraction: job.progress, message: job.message });
    if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.message);
    if (job.status === 'done') {
      const matte = (job.result as { roto?: { matte?: string | null } } | null)?.roto?.matte;
      if (!matte) throw new Error('Tracking finished without a matte.');
      return { matte, key };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** Tracks a mask of a clip in the project and writes the matte back as one undo step. */
export async function trackMaskInProject(history: { current: () => Project; commit: (next: (current: Project) => Project, label?: string) => void }, compId: string, clipId: string, maskId: string, fps: number, signal?: AbortSignal): Promise<void> {
  const clip = history.current().comps.find((comp) => comp.id === compId)?.clips.find((entry) => entry.id === clipId);
  const mask = clip?.magicMasks?.find((entry) => entry.id === maskId);
  if (!clip || !mask || clip.source.type !== 'media') throw new Error('That mask is no longer on a video clip.');
  const assetId = clip.source.assetId;
  setMagicMaskView({ busy: `Tracking ${mask.name}…`, error: null });
  try {
    const { matte, key } = await trackMagicMask(clip, mask, assetId, fps, signal, (progress) => setMagicMaskView({ busy: `Tracking ${mask.name} · ${Math.round(progress.fraction * 100)}% · ${progress.message}` }));
    history.commit((current) => patchMask(current, compId, clipId, maskId, (entry) => ({ ...entry, matte, trackedKey: key })), `Track ${mask.name}`);
    setMagicMaskView((current) => ({ busy: null, preview: current.preview?.maskId === maskId ? null : current.preview }));
  } catch (error) {
    setMagicMaskView({ busy: null, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
