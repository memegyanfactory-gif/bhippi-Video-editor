import { describe, expect, it } from 'vitest';
import { newClip, newComp, pasteAttributes, removeAttributes, tracksOf, type AttributeSet } from '../src/lib/timeline';
import type { AppliedEffect } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;
const limit = () => 60;
const only = (key: keyof AttributeSet): AttributeSet => ({ motion: false, opacity: false, crop: false, effects: false, speed: false, volume: false, mask: false, audio: false, [key]: true });
const grade: AppliedEffect = { id: 'fx-grade', effectId: 'lumetri', name: 'Lumetri Color', category: 'Color', enabled: true, params: { exposure: 0.4, lut: 'teal-orange' } };
const masked: AppliedEffect = { id: 'fx-blur', effectId: 'gaussian-blur', name: 'Blur', category: 'Blur', enabled: true, maskId: 'face', maskSide: 'inside', params: { radius: 12 } };

const setup = () => {
  const comp = newComp({ name: 'Test' });
  const [v1] = tracksOf(comp, 'video').map((track) => track.id);
  const source = newClip({ trackId: v1, start: 0, duration: 4, source: media, appliedEffects: [grade, masked] });
  const target = newClip({ trackId: v1, start: 5, duration: 4, source: media });
  return { comp: { ...comp, clips: [source, target] }, source, target };
};

describe('Paste Attributes', () => {
  it('copies the effect stack, colour grade included, with fresh ids', () => {
    const { comp, source, target } = setup();
    const next = pasteAttributes(comp, [target.id], source, only('effects'), limit);
    const pasted = next.clips.find((clip) => clip.id === target.id)!.appliedEffects ?? [];
    expect(pasted.map((effect) => effect.effectId)).toEqual(['lumetri']);
    expect(pasted[0].id).not.toBe(grade.id);
    expect(pasted[0].params).toEqual(grade.params);
    expect(pasted[0].params).not.toBe(grade.params);
  });

  it('leaves the effect stack alone when Effects is not ticked', () => {
    const { comp, source, target } = setup();
    const next = pasteAttributes(comp, [target.id], source, only('motion'), limit);
    expect(next.clips.find((clip) => clip.id === target.id)!.appliedEffects ?? []).toEqual([]);
  });

  it('Remove Attributes › Effects clears the stack', () => {
    const { comp, source } = setup();
    const next = removeAttributes(comp, [source.id], only('effects'), limit);
    expect(next.clips.find((clip) => clip.id === source.id)!.appliedEffects ?? []).toEqual([]);
  });
});
