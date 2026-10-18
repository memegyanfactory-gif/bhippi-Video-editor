import { describe, expect, it } from 'vitest';
import { defaultTransitions, newClip, newComp, tracksOf } from '../src/lib/timeline';
import type { Comp } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;

/** Two cuts on V1 and A1 meeting at 4s, linked in pairs. */
function cutAtFour(): Comp {
  const comp = newComp({ name: 'Test' });
  const v1 = tracksOf(comp, 'video')[0].id;
  const a1 = tracksOf(comp, 'audio')[0].id;
  const clips = [
    newClip({ trackId: v1, start: 0, duration: 4, source: media, linkId: 'one' }),
    newClip({ trackId: a1, start: 0, duration: 4, source: media, linkId: 'one' }),
    newClip({ trackId: v1, start: 4, duration: 4, source: media, linkId: 'two' }),
    newClip({ trackId: a1, start: 4, duration: 4, source: media, linkId: 'two' }),
  ];
  return { ...comp, clips, tracks: comp.tracks.map((track) => ({ ...track, targeted: track.id === v1 || track.id === a1 })) };
}
const targeted = (comp: Comp) => comp.tracks.filter((track) => track.targeted).map((track) => track.id);

describe('Ctrl+D and Ctrl+Shift+D', () => {
  it('with nothing selected, put one transition of their kind on the edit nearest the playhead', () => {
    const comp = cutAtFour();
    const video = defaultTransitions(comp, 'video', [], 4.2, targeted(comp), 'cross-dissolve', 1);
    expect(video.transitions).toHaveLength(1);
    expect(video.transitions[0]).toMatchObject({ kind: 'cross-dissolve', trackId: tracksOf(comp, 'video')[0].id, alignment: 'center' });

    const audio = defaultTransitions(comp, 'audio', [], 3.9, targeted(comp), 'constant-power', 1);
    expect(audio.transitions).toHaveLength(1);
    expect(audio.transitions[0]).toMatchObject({ kind: 'constant-power', trackId: tracksOf(comp, 'audio')[0].id });
  });

  it('with clips selected, only touch the selected clips of their kind', () => {
    const comp = cutAtFour();
    const all = comp.clips.map((clip) => clip.id);
    const video = defaultTransitions(comp, 'video', all, 0, targeted(comp), 'cross-dissolve', 1);
    expect(video.transitions.length).toBeGreaterThan(0);
    expect(video.transitions.every((item) => item.kind === 'cross-dissolve')).toBe(true);
    expect(video.transitions.every((item) => item.trackId === tracksOf(comp, 'video')[0].id)).toBe(true);
  });

  it('leave untargeted and locked tracks alone', () => {
    const comp = { ...cutAtFour(), tracks: cutAtFour().tracks.map((track) => ({ ...track, targeted: false })) };
    expect(defaultTransitions(comp, 'video', [], 4, targeted(comp), 'cross-dissolve', 1).transitions).toHaveLength(0);
    const locked = { ...cutAtFour() };
    const lockedComp = { ...locked, tracks: locked.tracks.map((track) => ({ ...track, locked: true })) };
    expect(defaultTransitions(lockedComp, 'video', [], 4, targeted(lockedComp), 'cross-dissolve', 1).transitions).toHaveLength(0);
  });
});
