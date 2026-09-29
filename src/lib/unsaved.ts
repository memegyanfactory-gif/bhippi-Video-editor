// Whether the open project has work that is not in a .bhippi file yet.
//
// A project opened from (or saved to) a file is unsaved once it differs from what was written.
// An untitled project has no file at all: its only copy is the session autosave, which the next
// New Project or Open replaces. So any untitled project with work in it counts as unsaved, even
// straight after launch, and replacing it always asks first.
import type { Project } from './types';

/** Whether the project holds anything worth keeping: media, or a clip on any comp. */
export const hasWork = (project: Project) => project.media.length > 0 || project.comps.some((comp) => comp.clips.length > 0);

/** `saved` is the project as last written to (or read from) `path`; null when never written. */
export function isUnsaved(project: Project, saved: Project | null, path: string | null | undefined): boolean {
  if (!path) return hasWork(project);
  return !!saved && saved !== project;
}
