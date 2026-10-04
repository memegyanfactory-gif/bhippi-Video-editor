// Where a project's files live on disk — the frontend half of src-tauri/src/storage.rs.
//
//   <storage root>/<Project name>/{Project, Footage, Downloads, Generated, Audio/…, Roto, …}
//
// A saved project owns the folder its .bhippi sits in (…/<folder>/Project/x.bhippi → <folder>),
// or "<name> Files" beside a .bhippi saved anywhere else; saving gathers its files there.
//
// The root is Documents/Bhippi unless Settings › Storage names another folder. These helpers are
// pure so the bin organiser and the Storage tab can share them (and tests can pin them).

export type StorageCategoryId =
  | 'project' | 'footage' | 'downloads' | 'generated' | 'voice-overs' | 'recordings' | 'sfx'
  | 'roto' | 'tracking' | 'clean-plates' | 'renders' | 'exports' | 'storyboard' | 'research' | 'guidelines' | '3d-renders' | 'ai-work';

export type StorageCategory = { id: StorageCategoryId; folder: string; label: string; blurb: string };

/** Mirrors `Category` in storage.rs — same ids, same folders, same order. */
export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  { id: 'project', folder: 'Project', label: 'Project', blurb: 'The .bhippi file and its autosave copy' },
  { id: 'footage', folder: 'Footage', label: 'Footage', blurb: 'Imported media, when copying into the project is on' },
  { id: 'downloads', folder: 'Downloads', label: 'Downloads', blurb: 'Clips and audio the AI fetched from the web' },
  { id: 'generated', folder: 'Generated', label: 'Generated', blurb: 'Images, video and audio from local models' },
  { id: 'voice-overs', folder: 'Audio/Voice-overs', label: 'Voice-overs', blurb: 'Takes read by a voice' },
  { id: 'recordings', folder: 'Audio/Recordings', label: 'Recordings', blurb: 'Microphone recordings' },
  { id: 'sfx', folder: 'Audio/SFX', label: 'Sound effects', blurb: 'Sound effects made for this project' },
  { id: 'roto', folder: 'Roto', label: 'Roto', blurb: 'Subject mattes and their previews' },
  { id: 'tracking', folder: 'Tracking', label: 'Tracking', blurb: 'Person and point tracking passes' },
  { id: 'clean-plates', folder: 'Clean plates', label: 'Clean plates', blurb: 'Magic eraser clips and background plates' },
  { id: 'renders', folder: 'Renders', label: 'Renders', blurb: 'Pre-rendered motion graphics' },
  { id: 'exports', folder: 'Exports', label: 'Exports', blurb: 'Finished videos — the default export folder' },
  { id: 'storyboard', folder: 'Documents/Storyboard', label: 'Storyboard', blurb: 'Storyboard frames' },
  { id: 'research', folder: 'Documents/Research', label: 'Research', blurb: 'References and pages gathered while planning' },
  { id: 'guidelines', folder: 'Documents/Guidelines', label: 'Guidelines', blurb: 'Guidelines, plans and todo lists the AI writes' },
  { id: '3d-renders', folder: '3D renders', label: '3D renders', blurb: 'Frames rendered in headless Blender' },
  { id: 'ai-work', folder: 'AI Work', label: 'AI Work', blurb: 'Scripts, renders and scratch files the AI makes with its own tools' },
];

export const UNTITLED_PROJECT = 'Untitled project';
/** Mirrors `storage::UNSAVED_DIR`: each project without a file keeps its files in `<root>/Unsaved projects/<key>`. */
export const UNSAVED_FOLDER = 'Unsaved projects';

/** A fresh key for an unsaved project's own folder: when it began, plus a few random letters. */
export function newUnsavedKey(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `${stamp} ${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A project name as a folder name — the same rules as `storage::sanitize`. */
export function projectFolderName(name: string): string {
  let out = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').split(/\s+/).filter(Boolean).join(' '); // eslint-disable-line no-control-regex -- strips control characters Windows rejects in file names
  out = [...out].slice(0, 80).join('');
  out = out.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!out) return UNTITLED_PROJECT;
  return RESERVED.test(out.split('.')[0]) ? `${out} project` : out;
}

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

let registeredRoot: string | null = null;

/** Tells the helpers where the storage root is now (from `storage_info`), for custom roots. */
export function registerStorageRoot(root: string | null) {
  registeredRoot = root ? norm(root) : null;
}

export type StorageKind = 'downloads' | 'generated' | 'voice-overs' | 'sfx';

const KIND_BY_FOLDER: [string, StorageKind][] = [
  ['downloads', 'downloads'],
  ['generated', 'generated'],
  ['clean plates', 'generated'],
  ['audio/voice-overs', 'voice-overs'],
  ['audio/recordings', 'voice-overs'],
  ['audio/sfx', 'sfx'],
];

/**
 * What a file inside a project folder is, from the category folder it sits in — `null` for
 * anything not under the storage root. Without a registered root the default `…/Bhippi/<project>/`
 * shape is recognised, so a file in the user's own Downloads is never mistaken for one.
 */
export function storageKind(path: string, root: string | null = registeredRoot): StorageKind | null {
  const file = norm(path);
  let rest: string | null = null;
  if (root) {
    if (file.startsWith(`${norm(root)}/`)) rest = file.slice(norm(root).length + 1);
  } else {
    const match = /\/bhippi\/(.+)$/.exec(file);
    if (match) rest = match[1];
  }
  if (!rest) return null;
  // An unsaved project's folder sits one level down, under "Unsaved projects/<key>".
  const unsaved = `${UNSAVED_FOLDER.toLowerCase()}/`;
  if (rest.startsWith(unsaved)) rest = rest.slice(unsaved.length);
  // Drop the project folder; what follows is the category.
  const inProject = rest.slice(rest.indexOf('/') + 1);
  if (rest.indexOf('/') < 0) return null;
  for (const [folder, kind] of KIND_BY_FOLDER) {
    if (inProject.startsWith(`${folder}/`)) return kind;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
