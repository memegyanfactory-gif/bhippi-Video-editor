import { describe, expect, it } from 'vitest';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import { hasWork, isUnsaved } from '../src/lib/unsaved';
import type { Project } from '../src/lib/types';

const withClip = (project: Project): Project => {
  const [comp] = project.comps;
  const [v1] = tracksOf(comp, 'video');
  const clip = newClip({ trackId: v1.id, start: 0, duration: 2, source: { type: 'media', assetId: 'a' } });
  return { ...project, comps: [{ ...comp, clips: [clip] }] };
};

describe('unsaved work', () => {
  it('an empty untitled project has nothing to lose', () => {
    const empty = newProject();
    expect(hasWork(empty)).toBe(false);
    expect(isUnsaved(empty, null, null)).toBe(false);
  });

  it('an untitled project with a clip always asks, even with no edits since launch', () => {
    const untitled = withClip(newProject());
    expect(isUnsaved(untitled, null, null)).toBe(true);
    // The boot path records the session project as "saved"; that must not hide it.
    expect(isUnsaved(untitled, untitled, null)).toBe(true);
  });

  it('an untitled project with imported media but no clips still asks', () => {
    const untitled = { ...newProject(), media: [{ assetId: 'a', folderId: null }] } as unknown as Project;
    expect(isUnsaved(untitled, null, undefined)).toBe(true);
  });

  it('a project with a file is unsaved only once it differs from what was written', () => {
    const saved = withClip(newProject());
    expect(isUnsaved(saved, saved, 'C:/p.bhippi')).toBe(false);
    const edited = { ...saved, name: 'Renamed' };
    expect(isUnsaved(edited, saved, 'C:/p.bhippi')).toBe(true);
  });
});
