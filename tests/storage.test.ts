import { describe, expect, it } from 'vitest';
import { formatBytes, projectFolderName, STORAGE_CATEGORIES, storageKind, UNTITLED_PROJECT } from '../src/lib/storage';

describe('project folder names', () => {
  it('matches the Rust sanitiser', () => {
    expect(projectFolderName('My Film')).toBe('My Film');
    expect(projectFolderName('  a/b\\c:d*e?f"g<h>i|j  ')).toBe('a b c d e f g h i j');
    expect(projectFolderName('')).toBe(UNTITLED_PROJECT);
    expect(projectFolderName('  ... ')).toBe(UNTITLED_PROJECT);
    expect(projectFolderName('Trailer...')).toBe('Trailer');
    expect(projectFolderName('CON')).toBe('CON project');
    expect(projectFolderName('lpt3')).toBe('lpt3 project');
    expect(projectFolderName('Console')).toBe('Console');
    expect([...projectFolderName('x'.repeat(200))].length).toBe(80);
  });
});

describe('storage categories', () => {
  it('has unique ids and folders', () => {
    expect(new Set(STORAGE_CATEGORIES.map((c) => c.id)).size).toBe(STORAGE_CATEGORIES.length);
    expect(new Set(STORAGE_CATEGORIES.map((c) => c.folder)).size).toBe(STORAGE_CATEGORIES.length);
  });

  it('recognises files in a project folder by category', () => {
    const root = 'C:\\Users\\me\\Documents\\Helios';
    expect(storageKind(`${root}\\Launch\\Downloads\\clip.mp4`, root)).toBe('downloads');
    expect(storageKind(`${root}\\Launch\\Generated\\Images\\01abc\\cat.png`, root)).toBe('generated');
    expect(storageKind(`${root}\\Launch\\Clean plates\\Shot 01abc\\erased.mp4`, root)).toBe('generated');
    expect(storageKind(`${root}\\Launch\\Audio\\Voice-overs\\take.wav`, root)).toBe('voice-overs');
    expect(storageKind(`${root}\\Launch\\Audio\\SFX\\hit.wav`, root)).toBe('sfx');
    expect(storageKind(`${root}\\Launch\\Footage\\a.mp4`, root)).toBeNull();
    expect(storageKind('C:\\Users\\me\\Downloads\\camera.mp4', root)).toBeNull();
  });

  it('recognises the default Documents/Helios shape without a registered root', () => {
    expect(storageKind('C:/Users/me/Documents/Helios/Launch/Downloads/clip.mp4', null)).toBe('downloads');
    expect(storageKind('C:/Users/me/Downloads/clip.mp4', null)).toBeNull();
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});
