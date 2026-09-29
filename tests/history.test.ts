import { describe, expect, it } from 'vitest';
import { commitStep, historyStart, previewStep, settleStep, undoStep } from '../src/lib/history';
import { moveClipTo, newClip, newComp, newProject, tracksOf, trimEdge, updateComp } from '../src/lib/timeline';
import type { Comp, Project } from '../src/lib/types';

const media = { type: 'media', assetId: 'v' } as const;
const limit = () => 20;
const project = (comp: Comp): Project => ({ ...newProject(), comps: [comp], activeCompId: comp.id, openCompIds: [comp.id] });
const compOf = (value: Project) => value.comps[0];
const span = (comp: Comp, id: string) => {
  const clip = comp.clips.find((item) => item.id === id);
  return clip ? [clip.start, clip.start + clip.duration] : null;
};

describe('an assistant edit during a drag', () => {
  it('is kept by the drag and undoes as its own step', () => {
    const comp = newComp({ name: 'Test' });
    const [v1, v2] = tracksOf(comp, 'video').map((track) => track.id);
    const a = newClip({ trackId: v1, start: 0, duration: 5, source: media });
    const caption = newClip({ trackId: v2, start: 1, duration: 2, source: media });
    const before = project({ ...comp, clips: [a] });
    // The trim drag, rebuilt each step from where the gesture started (as Timeline's previewComp does).
    const trimTo = (end: number) => (present: Project, start: Project) => updateComp(present, comp.id, () => trimEdge(compOf(start), a.id, 'out', end, 'normal', limit));

    let state = historyStart(before);
    state = previewStep(state, trimTo(4));
    state = commitStep(state, (current) => updateComp(current, comp.id, (target) => ({ ...target, clips: [...target.clips, caption] })), 'AI: add caption');
    expect(span(compOf(state.present), caption.id)).toEqual([1, 3]);
    expect(span(compOf(state.present), a.id)).toEqual([0, 4]);
    state = previewStep(state, trimTo(3));
    state = settleStep(state, 'Trim');

    expect(span(compOf(state.present), caption.id)).toEqual([1, 3]);
    expect(span(compOf(state.present), a.id)).toEqual([0, 3]);

    state = undoStep(state);
    expect(state.presentLabel).toBe('AI: add caption');
    expect(span(compOf(state.present), caption.id)).toEqual([1, 3]);
    expect(span(compOf(state.present), a.id)).toEqual([0, 5]);

    state = undoStep(state);
    expect(compOf(state.present).clips.map((clip) => clip.id)).toEqual([a.id]);
    expect(span(compOf(state.present), a.id)).toEqual([0, 5]);
  });

  it('without a gesture, a commit is one plain step', () => {
    const comp = newComp({ name: 'Test' });
    const a = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 5, source: media });
    let state = historyStart(project(comp));
    state = commitStep(state, (current) => updateComp(current, comp.id, (target) => ({ ...target, clips: [a] })), 'Add');
    expect(state.pending).toBeNull();
    expect(state.past.map((entry) => entry.label)).toEqual(['Open']);
    expect(commitStep(state, (current) => current, 'Nothing')).toBe(state);
  });
});

describe('Properties › Start', () => {
  it('moves the clip with its linked audio and overwrites the neighbour, as a drag would', () => {
    const comp = newComp({ name: 'Test' });
    const v1 = tracksOf(comp, 'video')[0].id;
    const a1 = tracksOf(comp, 'audio')[0].id;
    const picture = newClip({ trackId: v1, start: 0, duration: 5, source: media, linkId: 'l' });
    const sound = newClip({ trackId: a1, start: 0, duration: 5, source: media, linkId: 'l' });
    const b = newClip({ trackId: v1, start: 5, duration: 5, source: media, in: 5 });
    const moved = moveClipTo({ ...comp, clips: [picture, sound, b] }, picture.id, 2) as Comp;
    expect(span(moved, picture.id)).toEqual([2, 7]);
    expect(span(moved, sound.id)).toEqual([2, 7]);
    const rest = moved.clips.filter((clip) => clip.trackId === v1 && clip.id !== picture.id).map((clip) => [clip.start, clip.start + clip.duration, clip.in]);
    expect(rest).toEqual([[7, 10, 7]]);
  });
});

describe('an AI turn as one undo step', () => {
  it('folds the turn\'s steps into one, named after the request', async () => {
    const { squashTurnStep } = await import('../src/lib/history');
    const start = newProject();
    let state = historyStart(start);
    state = commitStep(state, (p) => ({ ...p, name: 'a' }), 'AI: add_text');
    state = commitStep(state, (p) => ({ ...p, name: 'b' }), 'AI: place_clip');
    const folded = squashTurnStep(state, start, 'AI: "make an intro"');
    expect(folded.past).toHaveLength(1);
    expect(folded.presentLabel).toBe('AI: "make an intro"');
    expect(undoStep(folded).present).toBe(start);
  });

  it('leaves the steps apart when the user edited during the turn', async () => {
    const { squashTurnStep } = await import('../src/lib/history');
    const start = newProject();
    let state = historyStart(start);
    state = commitStep(state, (p) => ({ ...p, name: 'a' }), 'AI: add_text');
    state = commitStep(state, (p) => ({ ...p, name: 'mine' }), 'Trim');
    state = commitStep(state, (p) => ({ ...p, name: 'b' }), 'AI: place_clip');
    expect(squashTurnStep(state, start, 'AI: "x"')).toBe(state);
  });
});
