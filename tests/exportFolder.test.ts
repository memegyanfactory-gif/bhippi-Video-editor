import { describe, expect, it } from 'vitest';
import { exportFolderFor, sameFolder } from '../src/lib/exportFolder';

describe('the export folder belongs to the project it was chosen in', () => {
  const project2 = 'C:\\Users\\me\\Documents\\Bhippi\\project2\\project2 Files\\Exports';
  const untitled = 'C:\\Users\\me\\Documents\\Bhippi\\Untitled project\\Exports';

  it('renders another project into its own Exports folder, not the last one used', () => {
    expect(exportFolderFor({ folder: project2, folderFor: project2 }, untitled)).toBe(untitled);
    // Remembered before folders were tied to projects: the project's own folder wins.
    expect(exportFolderFor({ folder: project2 }, untitled)).toBe(untitled);
  });

  it('keeps a folder picked in this project, wherever it is', () => {
    expect(exportFolderFor({ folder: 'D:\\Renders', folderFor: untitled }, untitled)).toBe('D:\\Renders');
    expect(exportFolderFor({ folder: 'D:\\Renders', folderFor: 'c:/users/me/documents/bhippi/untitled project/exports/' }, untitled)).toBe('D:\\Renders');
  });

  it('falls back to the folder chosen last when the project folder is unknown', () => {
    expect(exportFolderFor({ folder: project2, folderFor: project2 }, null)).toBe(project2);
    expect(exportFolderFor({ folder: null }, null)).toBeNull();
    expect(sameFolder('C:/A/b/', 'c:\\a\\B')).toBe(true);
    expect(sameFolder(null, 'c:\\a')).toBe(false);
  });
});
