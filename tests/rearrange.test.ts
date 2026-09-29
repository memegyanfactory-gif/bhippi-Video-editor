import { describe, expect, it } from 'vitest';
import { newClip, newComp, rearrangeClips, tracksOf } from '../src/lib/timeline';

const media = { type: 'media', assetId: 'v' } as const;
function shots() {
  const comp = newComp({ name: 'T' });
  const [v1] = tracksOf(comp, 'video');
  const clips = ['a', 'b', 'c', 'd'].map((id, i) => newClip({ id, trackId: v1.id, start: i * 2, duration: 2, source: media }));
  return { ...comp, clips };
}
const order = (comp: ReturnType<typeof shots>) => [...comp.clips].sort((x, y) => x.start - y.start).map((clip) => `${clip.id}@${clip.start}`);

describe('rearrange (Ctrl+drag)', () => {
  it('moves a shot later without leaving a hole', () => {
    // Drag b (2–4) to just after c ends (6): lands after c once b's gap closes.
    const result = rearrangeClips(shots(), ['b'], 4);
    expect(order(result!.comp)).toEqual(['a@0', 'c@2', 'b@4', 'd@6']);
  });
  it('moves a shot earlier, pushing the rest down', () => {
    const result = rearrangeClips(shots(), ['d'], -6);
    expect(order(result!.comp)).toEqual(['d@0', 'a@2', 'b@4', 'c@6']);
  });
  it('does nothing when dropped where it was', () => {
    expect(rearrangeClips(shots(), ['b'], 1)).toBeNull();
  });
});

describe('out-of-sync badges', () => {
  it('counts the frames a linked half slipped, and nothing when in sync', async () => {
    const { syncOffsetFrames, newComp, newClip, tracksOf } = await import('../src/lib/timeline');
    const comp = newComp({ name: 'T' });
    const [v1] = tracksOf(comp, 'video');
    const [a1] = tracksOf(comp, 'audio');
    const media = { type: 'media', assetId: 'v' } as const;
    const picture = newClip({ id: 'p', trackId: v1.id, start: 10, duration: 4, in: 2, linkId: 'L', source: media });
    const sound = newClip({ id: 's', trackId: a1.id, start: 10, duration: 4, in: 2, linkId: 'L', source: media });
    expect(syncOffsetFrames({ ...comp, clips: [picture, sound] }, picture, 30)).toBe(0);
    // The sound slipped 12 frames later on the timeline: the picture is 12 frames early.
    const slipped = { ...sound, start: 10.4 };
    const drifted = { ...comp, clips: [picture, slipped] };
    expect(syncOffsetFrames(drifted, picture, 30)).toBe(-12);
    expect(syncOffsetFrames(drifted, slipped, 30)).toBe(12);
    // Trimmed heads that stay lined up are in sync.
    expect(syncOffsetFrames({ ...comp, clips: [picture, { ...sound, start: 11, in: 3, duration: 3 }] }, picture, 30)).toBe(0);
  });
});
