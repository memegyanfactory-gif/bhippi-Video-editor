import { describe, expect, it } from 'vitest';
import {
  addMask, effectScope, frameIndex, frameTime, magicMaskKey, maskStatus, newMagicMask, patchMask, pointsOnFrame, seekTime, wholeClipEffects,
} from '../src/lib/magicMask';
import { newClip, newProject } from '../src/lib/timeline';
import type { AppliedEffect, Clip, Project } from '../src/lib/types';

const effect = (id: string, patch: Partial<AppliedEffect> = {}): AppliedEffect => ({ id, effectId: 'black-white', name: 'B&W', category: 'Color', enabled: true, params: {}, ...patch });

function videoClip(): Clip {
  return newClip({ trackId: 'v1', start: 2, duration: 4, source: { type: 'media', assetId: 'a' }, in: 10 });
}

describe('Magic Mask frame arithmetic', () => {
  it('keeps a click on the frame the monitor showed, through storage and tracking', () => {
    const fps = 29.97;
    for (const source of [0, 0.01, 10.5, 123.456]) {
      const shown = frameIndex(source, fps);
      const at = frameTime(shown, fps);
      expect(Math.floor(at * fps + 1e-6)).toBe(shown);
      // FFmpeg keeps the first frame at or after the seek: frame `shown` starts at shown/fps.
      expect(seekTime(shown, fps)).toBeLessThanOrEqual(shown / fps);
      expect(seekTime(shown, fps)).toBeGreaterThan((shown - 1) / fps);
    }
  });

  it('finds the clicks on one frame only', () => {
    const mask = { ...newMagicMask(videoClip()), points: [
      { at: frameTime(300, 30), mode: 'include' as const, kind: 'click' as const, x: 0.5, y: 0.5, radius: 0, softness: 0 },
      { at: frameTime(301, 30), mode: 'include' as const, kind: 'click' as const, x: 0.4, y: 0.5, radius: 0, softness: 0 },
    ] };
    expect(pointsOnFrame(mask, 300, 30)).toHaveLength(1);
    expect(pointsOnFrame(mask, 302, 30)).toHaveLength(0);
  });
});

describe('Magic Mask status and scope', () => {
  it('goes stale when the clicks, quality or range change after tracking', () => {
    const clip = videoClip();
    const mask = { ...newMagicMask(clip), points: [{ at: 11, mode: 'include' as const, kind: 'click' as const, x: 0.5, y: 0.5, radius: 0, softness: 0 }] };
    expect(maskStatus(mask, clip)).toBe('untracked');
    const tracked = { ...mask, matte: 'C:/roto/run-1/matte.mkv', trackedKey: magicMaskKey(mask, clip) };
    expect(maskStatus(tracked, clip)).toBe('tracked');
    expect(maskStatus({ ...tracked, quality: 'better' }, clip)).toBe('stale');
    expect(maskStatus(tracked, { ...clip, duration: 5 })).toBe('stale');
    expect(maskStatus({ ...tracked, invert: true, feather: 8 }, clip)).toBe('tracked');
  });

  it('draws a masked effect only once its mask is tracked', () => {
    const clip = videoClip();
    const mask = newMagicMask(clip);
    const withMask = { ...clip, magicMasks: [mask], appliedEffects: [effect('whole'), effect('in', { maskId: mask.id }), effect('gone', { maskId: 'nope' })] };
    expect(effectScope(withMask, withMask.appliedEffects[1]).kind).toBe('off');
    expect(wholeClipEffects(withMask)?.map((fx) => fx.id)).toEqual(['whole']);
    const tracked = { ...withMask, magicMasks: [{ ...mask, matte: 'm.mkv' }] };
    expect(effectScope(tracked, { ...tracked.appliedEffects[1], maskSide: 'outside' })).toMatchObject({ kind: 'masked', outside: true });
  });

  it('switches off the effects of a deleted mask instead of spreading them over the clip', () => {
    const project = newProject();
    const comp = project.comps[0];
    const clip = { ...videoClip(), trackId: comp.tracks[0].id };
    const mask = newMagicMask(clip);
    let next: Project = { ...project, comps: [{ ...comp, clips: [{ ...clip, appliedEffects: [effect('fx', { maskId: mask.id })] }] }] };
    next = addMask(next, comp.id, clip.id, mask);
    expect(next.comps[0].clips[0].magicMasks).toHaveLength(1);
    next = patchMask(next, comp.id, clip.id, mask.id, () => null);
    const after = next.comps[0].clips[0];
    expect(after.magicMasks).toHaveLength(0);
    expect(after.appliedEffects?.[0]).toMatchObject({ enabled: false, maskId: null });
  });

  it('names new masks without reusing a taken name', () => {
    const clip = videoClip();
    const first = newMagicMask(clip);
    expect(first.name).toBe('Mask 1');
    expect(newMagicMask({ ...clip, magicMasks: [{ ...first, name: 'Mask 2' }] }).name).toBe('Mask 3');
  });
});
