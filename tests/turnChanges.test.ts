import { describe, expect, it } from 'vitest';
import { changeSummary, diffTurn } from '../src/lib/turnChanges';
import { newClip, newProject, tracksOf, updateComp } from '../src/lib/timeline';
import type { Clip } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;
const nameOf = (clip: Clip) => clip.name ?? clip.id;

describe('what an AI turn changed', () => {
  it('lists added, changed and removed clips in timeline order, and nothing untouched', () => {
    const project = newProject();
    const comp = project.comps[0];
    const [v1] = tracksOf(comp, 'video');
    const keep = newClip({ id: 'keep', trackId: v1.id, start: 0, duration: 2, source: media });
    const trim = newClip({ id: 'trim', trackId: v1.id, start: 2, duration: 2, source: media });
    const cut = newClip({ id: 'cut', trackId: v1.id, start: 4, duration: 2, source: media });
    const before = updateComp(project, comp.id, (c) => ({ ...c, clips: [keep, trim, cut] }));
    const title = newClip({ id: 'title', trackId: v1.id, start: 7, duration: 1, source: media });
    const after = updateComp(before, comp.id, (c) => ({ ...c, clips: [keep, { ...trim, duration: 1 }, title] }));
    const changes = diffTurn(before, after, nameOf);
    expect(changes.map((change) => [change.clipId, change.kind])).toEqual([['trim', 'changed'], ['cut', 'removed'], ['title', 'added']]);
    expect(changeSummary(changes)).toBe('1 added · 1 changed · 1 removed');
  });

  it('finds nothing when the turn only looked', () => {
    const project = newProject();
    expect(diffTurn(project, project, nameOf)).toEqual([]);
  });
});
