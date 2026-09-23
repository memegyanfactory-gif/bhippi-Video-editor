// Files the Project bin: every loose entry into the folder its kind belongs in.
//
// The AI imports, downloads, generates and builds motion-graphic comps as it goes, and all of it
// used to land loose at the top of the bin — twenty cards and clips in one flat grid. These rules
// decide where each thing goes; organizeBin applies them. Only top-level entries are touched:
// anything already in a folder was put there on purpose.

import { uid } from './editor';
import { storageKind, type StorageKind } from './storage';
import type { AssetMap } from './timeline';
import type { Asset, Comp, Project } from './types';

export const CATEGORIES = ['Footage', 'B-roll', 'Motion Graphics', 'Generated', 'Backgrounds', 'Images', 'Music', 'SFX', 'Voice-over', 'Audio', 'Graphics'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Folder names already in a bin that mean the same thing, so an existing folder is reused. */
const ALIASES: Record<Category, string[]> = {
  Footage: ['footage', 'a-roll', 'a roll', 'camera', 'raw'],
  'B-roll': ['b-roll', 'b roll', 'broll', 'stock', 'cutaways'],
  'Motion Graphics': ['motion graphics', 'motion graphic', 'mogrt', 'mogrts', 'titles', 'cards'],
  Generated: ['generated', 'ai generated'],
  Backgrounds: ['backgrounds', 'background', 'bg', 'backdrops', 'plates'],
  Images: ['images', 'image', 'stills', 'photos', 'pictures'],
  Music: ['music', 'songs', 'soundtrack'],
  SFX: ['sfx', 'sound effects', 'sound fx', 'effects audio'],
  'Voice-over': ['voice-over', 'voice-overs', 'voiceover', 'voice over', 'vo', 'narration'],
  Audio: ['audio', 'sound'],
  Graphics: ['graphics', 'mattes', 'items'],
};

const BG = /(^|[^a-z])(bg|background|backgrounds|backdrop|plate|texture|wallpaper)([^a-z]|$)/i;
const MUSIC = /(^|[^a-z])(music|song|bgm|soundtrack|bed|score|beat)([^a-z]|$)/i;
const SFX_NAME = /(^|[^a-z])(sfx|whoosh|swoosh|riser|impact|hit|pop|click|ding|chime|boom|transition)([^a-z]|$)/i;
const VOICE = /(^|[^a-z])(voice|voiceover|voice-over|vo|narration|narrator|dialogue)([^a-z]|$)/i;
const BROLL = /(^|[^a-z])(b-?roll|broll|stock|cutaway|scene\d*)([^a-z]|$)/i;

const norm = (path: string) => path.replace(/\\/g, '/').toLowerCase();

/**
 * Which of Helios's own folders a file is in, if any: the project folders under the storage root
 * (Documents/Helios/<project>/Downloads, Generated, Audio/Voice-overs…) or, for files made before
 * those existed, the app data folder (studio.helios.desktop). Only those say where a file came
 * from — "downloads" alone would also match the user's own Windows Downloads folder, where their
 * camera footage often lives.
 */
function heliosFolder(path: string): StorageKind | null {
  const match = /\/studio\.helios\.desktop\/(downloads|generated|voice-overs|sfx)\//.exec(norm(path));
  return (match?.[1] as StorageKind | undefined) ?? storageKind(path);
}

/** A comp that is a graphic rather than a sequence: named [MOGRT], or only HTML/text/shape layers. */
export function isGraphicsComp(comp: Comp): boolean {
  if (/^\s*\[mogrt\]/i.test(comp.name)) return true;
  const pictures = comp.clips.filter((clip) => clip.enabled && clip.source.type !== 'sfx');
  return pictures.length > 0 && pictures.every((clip) => clip.source.type === 'html' || clip.source.type === 'text' || clip.source.type === 'shape');
}

/** How the project's timelines use an audio asset, if they say. */
function audioUse(project: Project, assetId: string): 'music' | 'sfx' | 'dialogue' | null {
  for (const comp of project.comps) {
    for (const clip of comp.clips) {
      if (clip.source.type === 'media' && clip.source.assetId === assetId && clip.audioType) {
        if (clip.audioType === 'music' || clip.audioType === 'sfx' || clip.audioType === 'dialogue') return clip.audioType;
      }
    }
  }
  return null;
}

/** The folder a media asset belongs in. */
export function mediaCategory(project: Project, asset: Asset): Category {
  const from = heliosFolder(asset.path);
  // The folders a file sits in say what it is as often as its name does ("channel-broll/…").
  const dirs = norm(asset.path).split('/').slice(0, -1).join('/');
  const name = `${asset.name.replace(/\.[^.]+$/, '')} ${dirs}`;
  if (from === 'generated') return 'Generated';
  if (asset.kind === 'image') return BG.test(name) ? 'Backgrounds' : 'Images';
  if (asset.kind === 'audio') {
    if (from === 'voice-overs') return 'Voice-over';
    const use = audioUse(project, asset.id);
    if (use === 'music') return 'Music';
    if (use === 'sfx' || from === 'sfx') return 'SFX';
    if (MUSIC.test(name)) return 'Music';
    if (SFX_NAME.test(name)) return 'SFX';
    if (VOICE.test(name) || use === 'dialogue') return 'Voice-over';
    return asset.duration > 0 && asset.duration < 4 ? 'SFX' : 'Audio';
  }
  if (BG.test(name)) return 'Backgrounds';
  if (from === 'downloads' || BROLL.test(name)) return 'B-roll';
  return 'Footage';
}

type Entry = { kind: 'media' | 'comp' | 'item'; id: string; name: string; category: Category };

/** Top-level entries that have a folder to go to (sequences stay where the editor keeps them). */
function looseEntries(project: Project, assets: AssetMap, only?: ReadonlySet<string>): Entry[] {
  const pick = (id: string) => !only || only.has(id);
  const out: Entry[] = [];
  for (const ref of project.media) {
    if (ref.folderId || !pick(ref.assetId)) continue;
    const asset = assets.get(ref.assetId);
    if (asset) out.push({ kind: 'media', id: asset.id, name: asset.name, category: mediaCategory(project, asset) });
  }
  for (const comp of project.comps) {
    if (comp.folderId || !pick(comp.id) || !isGraphicsComp(comp)) continue;
    out.push({ kind: 'comp', id: comp.id, name: comp.name, category: 'Motion Graphics' });
  }
  for (const item of project.items) {
    if (item.folderId || !pick(item.id)) continue;
    out.push({ kind: 'item', id: item.id, name: item.name, category: 'Graphics' });
  }
  return out;
}

/**
 * Moves loose entries into category folders, reusing a top-level folder with a matching name
 * (Music, "B roll", "MOGRTs"…) and creating the rest. `only` limits it to those entry ids — the
 * ones an AI call just added. Returns the new project and what moved where.
 */
export function organizeBin(project: Project, assets: AssetMap, only?: ReadonlySet<string>): { project: Project; moved: { name: string; folder: string }[] } {
  const entries = looseEntries(project, assets, only);
  if (!entries.length) return { project, moved: [] };
  const folders = [...project.folders];
  const folderFor = (category: Category) => {
    const names = new Set([category.toLowerCase(), ...ALIASES[category]]);
    const found = folders.find((folder) => !folder.parentId && names.has(folder.name.trim().toLowerCase()));
    if (found) return found.id;
    const created = { id: uid(), name: category, parentId: null };
    folders.push(created);
    return created.id;
  };
  const target = new Map(entries.map((entry) => [entry.id, folderFor(entry.category)]));
  const moved = entries.map((entry) => ({ name: entry.name, folder: folders.find((folder) => folder.id === target.get(entry.id))!.name }));
  return {
    project: {
      ...project,
      folders,
      media: project.media.map((ref) => (target.has(ref.assetId) && !ref.folderId ? { ...ref, folderId: target.get(ref.assetId)! } : ref)),
      comps: project.comps.map((comp) => (target.has(comp.id) && !comp.folderId ? { ...comp, folderId: target.get(comp.id)! } : comp)),
      items: project.items.map((item) => (target.has(item.id) && !item.folderId ? { ...item, folderId: target.get(item.id)! } : item)),
    },
    moved,
  };
}

/** Ids of every bin entry, to tell afterwards which ones a call added. */
export const binIds = (project: Project) => new Set([...project.media.map((ref) => ref.assetId), ...project.comps.map((comp) => comp.id), ...project.items.map((item) => item.id)]);

/** "7 files into Motion Graphics, 3 into B-roll" */
export function describeMoved(moved: { folder: string }[]): string {
  const counts = new Map<string, number>();
  for (const entry of moved) counts.set(entry.folder, (counts.get(entry.folder) ?? 0) + 1);
  return [...counts].map(([folder, count]) => `${count} into ${folder}`).join(', ');
}
