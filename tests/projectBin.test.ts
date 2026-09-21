import { describe, expect, it } from 'vitest';
import { deleteBinEntries, newClip, newComp, newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

function projectWithTwoComps(): Project {
  const base = newProject('Bin');
  const a = base.comps[0];
  const b = { ...newComp({ name: 'B-roll' }), folderId: null };
  const footage = { ...newClip({ trackId: a.tracks[0].id, start: 0, duration: 4, source: { type: 'media', assetId: 'cam' } as const }), id: 'footage' };
  const nested = { ...newClip({ trackId: b.tracks[0].id, start: 0, duration: 4, source: { type: 'comp', compId: a.id } as const }), id: 'nested' };
  return {
    ...base,
    comps: [
      { ...a, clips: [footage] },
      { ...b, clips: [nested] },
    ],
    media: [{ assetId: 'cam', folderId: null, offline: false }],
    folders: [{ id: 'f1', name: 'Old', parentId: null }],
    activeCompId: a.id,
    openCompIds: [a.id, b.id],
  };
}

describe('deleteBinEntries', () => {
  it('deletes any comp, including the default one, without resurrecting it', () => {
    const project = projectWithTwoComps();
    const [a, b] = project.comps;
    const next = deleteBinEntries(project, [a.id]);
    expect(next.comps.map((comp) => comp.id)).toEqual([b.id]);
    // Clips reading the deleted comp go with it.
    expect(next.comps[0].clips).toHaveLength(0);
    expect(next.activeCompId).toBe(b.id);
    expect(next.openCompIds).toEqual([b.id]);
  });

  it('lets the last comp go and leaves a clean comp-less project', () => {
    const project = projectWithTwoComps();
    const next = deleteBinEntries(project, project.comps.map((comp) => comp.id));
    expect(next.comps).toHaveLength(0);
    expect(next.activeCompId).toBeNull();
    expect(next.openCompIds).toHaveLength(0);
  });

  it('moves folder children to the root instead of orphaning them', () => {
    const project = projectWithTwoComps();
    const withChild = {
      ...project,
      media: [{ assetId: 'cam', folderId: 'f1', offline: false }],
      comps: project.comps.map((comp, index) => (index === 1 ? { ...comp, folderId: 'f1' } : comp)),
    };
    const next = deleteBinEntries(withChild, ['f1']);
    expect(next.folders).toHaveLength(0);
    expect(next.media[0].folderId).toBeNull();
    expect(next.comps[1].folderId).toBeNull();
  });

  it('never touches disk files, only project references', () => {
    const project = projectWithTwoComps();
    const next = deleteBinEntries(project, ['cam']);
    expect(next.media).toHaveLength(0);
    expect(next.comps[0].clips).toHaveLength(0);
    expect(next.comps).toHaveLength(2);
  });
});
