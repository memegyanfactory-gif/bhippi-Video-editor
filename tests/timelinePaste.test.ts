import { describe, expect, it } from 'vitest';
import { healComp, nestClips, newClip, newComp, newProject, pasteClips, textSource, trackIndex, trackLabel, trackOf, tracksOf, type ClipboardEntry } from '../src/lib/timeline';
import type { Clip, Comp, Project } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;
const project = (...comps: Comp[]): Project => ({ ...newProject(), comps, activeCompId: comps[0].id, openCompIds: [comps[0].id] });
/** What Copy puts on the clipboard: each clip with the kind and number of its track. */
const copy = (comp: Comp, clips: Clip[]) => ({
  comp: comp.id,
  clips: clips.map((clip): ClipboardEntry => ({ clip: { ...clip }, kind: trackOf(comp, clip.trackId)?.kind ?? 'video', index: Math.max(0, trackIndex(comp, clip.trackId)) })),
});

describe('paste into another comp', () => {
  it('keeps the kind and number of the track a clip was copied from, with a fresh group', () => {
    const first = newComp({ name: 'Comp 1' });
    const title = newClip({ trackId: tracksOf(first, 'video')[1].id, start: 2, duration: 3, source: textSource('title', { text: 'Hi' }), groupId: 'g1' });
    const source = { ...first, clips: [title] };
    const second = newComp({ name: 'Comp 2' });
    const pasted = pasteClips(project(source, second), second.id, copy(source, [title]), 0, 'overwrite');
    const dest = pasted.project.comps.find((comp) => comp.id === second.id) as Comp;
    expect(dest.clips).toHaveLength(1);
    const clip = dest.clips[0];
    expect(trackLabel(dest, clip.trackId)).toBe('V2');
    expect(clip.start).toBe(0);
    expect(clip.groupId).toBeTruthy();
    expect(clip.groupId).not.toBe('g1');
    expect(pasted.skipped).toEqual([]);
  });

  it('skips a nest pasted into its own child comp', () => {
    const parent = newComp({ name: 'Parent' });
    const inner = newClip({ trackId: tracksOf(parent, 'video')[0].id, start: 0, duration: 4, source: media });
    const nested = nestClips(project({ ...parent, clips: [inner] }), parent.id, [inner.id], 'Nested');
    expect(nested).not.toBeNull();
    const host = nested!.project.comps.find((comp) => comp.id === parent.id) as Comp;
    const nest = host.clips.find((clip) => clip.source.type === 'comp') as Clip;
    const pasted = pasteClips(nested!.project, nested!.compId, copy(host, [nest]), 0, 'overwrite');
    expect(pasted.skipped).toEqual([nest.id]);
    expect(pasted.ids).toEqual([]);
    expect(pasted.project).toBe(nested!.project);
  });
});

describe('heal', () => {
  it('moves a picture off an audio track to the same number of video track', () => {
    const comp = newComp({ name: 'Test' });
    const title = newClip({ trackId: tracksOf(comp, 'audio')[0].id, start: 0, duration: 2, source: textSource('title', { text: 'Hi' }) });
    const healed = healComp({ ...comp, clips: [title] });
    expect(healed.clips).toHaveLength(1);
    expect(trackLabel(healed, healed.clips[0].trackId)).toBe('V1');
  });
});
