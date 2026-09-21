// The repair that keeps a comp inside the invariants the backend checks. One overlap used to
// be enough to make `project_save` refuse the whole project, and then nothing saved for the
// rest of the session — so these pin the shape of the fix rather than just that it runs.
import { describe, expect, it } from 'vitest';
import { clipEnd, healComp, healProject, newClip, newComp, newProject, tracksOf } from '../src/lib/timeline';
import type { Clip, Comp, Project } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;

function setup(): { comp: Comp; v1: string; v2: string } {
  const comp = newComp({ name: 'Test' });
  const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
  return { comp, v1, v2 };
}

/** Puts clips on a comp without going through `placeClips`, the way a bad edit would. */
const withClips = (comp: Comp, clips: Clip[]): Comp => ({ ...comp, clips });
const on = (comp: Comp, trackId: string) =>
  comp.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((clip) => [+clip.start.toFixed(4), +clip.duration.toFixed(4)]);

describe('healComp', () => {
  it('leaves a comp that already keeps the rules exactly as it was', () => {
    const { comp, v1 } = setup();
    const good = withClips(comp, [
      newClip({ trackId: v1, start: 0, duration: 4, source: media }),
      newClip({ trackId: v1, start: 4, duration: 3, source: media }),
    ]);
    // Same object back: a healthy project must not churn React or the undo stack.
    expect(healComp(good)).toBe(good);
    expect(healProject({ ...newProject(), comps: [good] } as Project).comps[0]).toBe(good);
  });

  it('gives the earlier clip way to the later one, the way an overwrite drop would', () => {
    const { comp, v1 } = setup();
    const broken = withClips(comp, [
      newClip({ trackId: v1, start: 0, duration: 6, source: media }),
      newClip({ trackId: v1, start: 4, duration: 3, source: media }),
    ]);
    const healed = healComp(broken);
    expect(on(healed, v1)).toEqual([[0, 4], [4, 3]]);
    // And the result is stable: healing it again changes nothing.
    expect(healComp(healed)).toBe(healed);
  });

  it('drops a clip the one after it buries completely', () => {
    const { comp, v1 } = setup();
    const buried = newClip({ trackId: v1, start: 2, duration: 5, source: media });
    const healed = healComp(withClips(comp, [
      buried,
      newClip({ trackId: v1, start: 2, duration: 5, source: media }),
    ]));
    expect(healed.clips).toHaveLength(1);
    expect(on(healed, v1)).toEqual([[2, 5]]);
  });

  it('repairs each track on its own and leaves the others alone', () => {
    const { comp, v1, v2 } = setup();
    const healed = healComp(withClips(comp, [
      newClip({ trackId: v1, start: 0, duration: 9, source: media }),
      newClip({ trackId: v1, start: 5, duration: 2, source: media }),
      newClip({ trackId: v2, start: 0, duration: 9, source: media }),
    ]));
    expect(on(healed, v1)).toEqual([[0, 5], [5, 2]]);
    // Two clips at the same time on *different* tracks is the whole point of tracks.
    expect(on(healed, v2)).toEqual([[0, 9]]);
  });

  it('removes what can never be reached or drawn', () => {
    const { comp, v1 } = setup();
    const healed = healComp(withClips(comp, [
      newClip({ trackId: 'a-track-that-was-deleted', start: 0, duration: 3, source: media }),
      { ...newClip({ trackId: v1, start: 0, duration: 3, source: media }), start: Number.NaN },
      newClip({ trackId: v1, start: 4, duration: 2, source: media }),
    ]));
    expect(healed.clips).toHaveLength(1);
    expect(on(healed, v1)).toEqual([[4, 2]]);
  });

  it('pulls a clip that starts before zero back to the start', () => {
    const { comp, v1 } = setup();
    const healed = healComp(withClips(comp, [{ ...newClip({ trackId: v1, start: 0, duration: 3, source: media }), start: -2 }]));
    expect(healed.clips[0].start).toBe(0);
  });

  it('takes a transition with it when the clip it joined is gone', () => {
    const { comp, v1 } = setup();
    const doomed = newClip({ trackId: v1, start: 2, duration: 5, source: media });
    const survivor = newClip({ trackId: v1, start: 2, duration: 5, source: media });
    const healed = healComp({
      ...withClips(comp, [doomed, survivor]),
      transitions: [{ id: 't1', trackId: v1, kind: 'cross-dissolve', duration: 1, alignment: 'center', fromClip: doomed.id, toClip: survivor.id }],
    } as Comp);
    expect(healed.clips).toHaveLength(1);
    // A transition pointing at a clip that is not there is its own broken invariant.
    expect(healed.transitions).toHaveLength(0);
  });

  it('leaves a butt edit alone — touching is not overlapping', () => {
    const { comp, v1 } = setup();
    const first = newClip({ trackId: v1, start: 0, duration: 4, source: media });
    const second = newClip({ trackId: v1, start: clipEnd(first), duration: 4, source: media });
    const butted = withClips(comp, [first, second]);
    expect(healComp(butted)).toBe(butted);
  });
});
