// Where a project's exports go. The folder chosen last is remembered with the project it was
// chosen in: a render of another project goes to that project's own Exports folder, not into the
// folder of whichever project was exported last.
import type { ExportPrefs } from './types';

const comparable = (path: string) => path.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase();

/** Whether two paths name the same folder (Windows: any slashes, any case). */
export function sameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && comparable(a) === comparable(b);
}

/**
 * The folder to render into: the one chosen last in this project, else the project's Exports
 * folder (`projectExports`), else whatever was chosen last when the project's folder is unknown.
 */
export function exportFolderFor(prefs: Pick<ExportPrefs, 'folder' | 'folderFor'>, projectExports: string | null): string | null {
  if (prefs.folder && sameFolder(prefs.folderFor, projectExports)) return prefs.folder;
  return projectExports || prefs.folder || null;
}
