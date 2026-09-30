// The demo project: what capture_app_session shows when the user's library or timeline is empty.
//
// A captured Bhippi with nothing in it (empty bins, black monitors, a bare timeline) looks dead in
// a film, and every film agent faked footage by hand to fix it. The demo media pack
// (src-tauri/src/demo_pack.rs) is a few clips, stills and a music bed made with FFmpeg on demand;
// this builds a small edit from it (shots cut on the bed's bars, a title, a mark, markers, a
// conversation in the chat) that the capture's stand-in answers with. It is never saved: the
// user's own library and project are untouched.
import type { ChatMessage } from '../chat/ChatPanel';
import { DEFAULT_TRANSFORM, uid } from './editor';
import { addTransition, clipsForSource, newClip, newProject, textSource, tracksOf } from './timeline';
import type { Asset, Clip, Folder, LabelColor, MediaRef, Project, ProviderInfo } from './types';

/** The pack's pieces by their stable ids (demo_pack.rs RECIPES). */
export const DEMO_IDS = {
  dusk: 'demo-dusk',
  coast: 'demo-coast',
  city: 'demo-city',
  studio: 'demo-studio',
  mist: 'demo-mist',
  mark: 'demo-mark',
  bed: 'demo-bed',
} as const;

/** One bar of the bed (96 bpm, four beats): every cut lands on one. */
export const DEMO_BAR = 2.5;

/** The shots in order: which piece, how many bars, and its label on the timeline. */
const SHOTS: { id: string; bars: number; label: LabelColor; marker: string }[] = [
  { id: DEMO_IDS.dusk, bars: 2, label: 'mango', marker: 'Open' },
  { id: DEMO_IDS.coast, bars: 1, label: 'caribbean', marker: 'Horizon' },
  { id: DEMO_IDS.mist, bars: 1, label: 'teal', marker: 'Still' },
  { id: DEMO_IDS.city, bars: 2, label: 'rose', marker: 'Night' },
  { id: DEMO_IDS.studio, bars: 2, label: 'lavender', marker: 'Studio' },
];

/** Marker colours, one per section (from the marker swatches in the UI). */
const MARKER_COLORS = ['#FFC53D', '#2BD4C9', '#A78BFA', '#FF6FB5', '#3D7BFF'];

/** Whether a project has nothing on any timeline: a fresh or emptied project. */
export const projectIsEmpty = (project: Project) => project.comps.every((comp) => comp.clips.length === 0);

/**
 * A small finished-looking edit from the demo pack: the shots on V1 cut on the bars, the studio
 * shot's room tone linked below it, a title over the opening, the mark over the last shot, the
 * bed under everything, a dissolve and a dip to black, a marker on each section, and the pack
 * sorted into Footage, Stills and Music bins. A piece the pack could not make is left out and the
 * rest close up, so the edit still plays through.
 */
export function demoProject(pack: Asset[]): Project {
  const assets = new Map(pack.map((asset) => [asset.id, asset]));
  const project = newProject('Coastline (demo)');
  const folders: Folder[] = ['Footage', 'Stills', 'Music'].map((name) => ({ id: uid(), name, parentId: null }));
  const folderFor = (asset: Asset) => folders[asset.kind === 'video' ? 0 : asset.kind === 'image' ? 1 : 2].id;
  const media: MediaRef[] = pack.map((asset) => ({ assetId: asset.id, folderId: folderFor(asset), offline: false }));

  let comp = { ...project.comps[0], name: 'Main edit' };
  const [v1, v2, v3] = tracksOf(comp, 'video').map((track) => track.id);
  const [a1, a2] = tracksOf(comp, 'audio').map((track) => track.id);
  const clips: Clip[] = [];
  const markers = [];
  let at = 0;
  for (const shot of SHOTS) {
    const asset = assets.get(shot.id);
    if (!asset) continue;
    const length = shot.bars * DEMO_BAR;
    // Half a second in, as an editor would trim a clip's head; a still has all the time it needs.
    const start = asset.kind === 'video' ? Math.min(0.5, Math.max(0, asset.duration - length)) : 0;
    const duration = asset.kind === 'video' ? Math.min(length, asset.duration - start) : length;
    const placed = clipsForSource(project, assets, { type: 'media', assetId: asset.id }, { start: at, videoTrack: v1, audioTrack: a1, in: start, duration });
    clips.push(...placed.map((clip) => ({ ...clip, label: shot.label, ...(clip.trackId === a1 ? { audioType: 'ambience' as const, volume: 0.5 } : {}) })));
    markers.push({ id: uid(), time: at, name: shot.marker, color: MARKER_COLORS[markers.length % MARKER_COLORS.length] });
    at += duration;
  }
  const end = at;
  const opening = clips.find((clip) => clip.trackId === v1);
  if (opening) {
    clips.push(newClip({ trackId: v3, start: opening.start + 0.6, duration: Math.max(1, opening.duration - 1.2), source: textSource('title', { text: 'Coastline', subtitle: 'A short film', color: '#F3C78E' }) }));
  }
  const mark = assets.get(DEMO_IDS.mark);
  const last = clips.filter((clip) => clip.trackId === v1).at(-1);
  if (mark && last && last.duration > 2) {
    clips.push(newClip({ trackId: v2, start: last.start + 1, duration: last.duration - 1.5, source: { type: 'media', assetId: mark.id }, transform: { ...DEFAULT_TRANSFORM, scale: 32, y: -0.08, opacity: 90 } }));
  }
  const bed = assets.get(DEMO_IDS.bed);
  if (bed && end > 0) {
    clips.push(newClip({ trackId: a2, start: 0, duration: Math.min(end, bed.duration), source: { type: 'media', assetId: bed.id }, volume: 0.7, audioType: 'music', label: 'yellow' }));
  }
  comp = { ...comp, clips, markers };
  // A dissolve into the night shot and a dip to black at the very end, where there are clips for them.
  const night = clips.find((clip) => clip.trackId === v1 && clip.source.type === 'media' && clip.source.assetId === DEMO_IDS.city);
  if (night) comp = addTransition(comp, v1, night.start, 'cross-dissolve', 0.5, 0.05);
  if (last) comp = addTransition(comp, v1, end, 'dip-to-black', 0.8, 0.05);
  return { ...project, comps: [comp], media, folders, activeCompId: comp.id, openCompIds: [comp.id] };
}

/**
 * A conversation mid-way for the chat panel: an ask, an answer that made the demo edit, and a
 * follow-up. The first provider the user really has signs the answers, so it reads as theirs.
 */
export function demoChat(providers: ProviderInfo[] = []): ChatMessage[] {
  const provider = providers.find((item) => item.offered) ?? providers[0];
  const signed = { providerId: provider?.id ?? 'claude', providerLabel: provider?.label ?? 'Claude', model: provider?.models[0] ?? null };
  const at = Date.now() - 6 * 60_000;
  const answer = (content: string, elapsedMs: number): ChatMessage => ({
    id: uid(), role: 'assistant', turnId: uid(), ...signed, content, thinking: '', steps: [], status: 'done', notes: [], fault: null, usage: null, elapsedMs, limit: null,
  });
  const question = (content: string, minutes: number): ChatMessage => ({ id: uid(), role: 'user', content, at: at + minutes * 60_000 });
  return [
    question('Cut these into a 20 second coastline teaser on the beat of the bed.', 0),
    answer('Done. Five shots cut on the bars of Evening bed (2.5 s each): dusk, the horizon, the misty still, the city at night and the studio. A title over the opening, the mark over the last shot, a dissolve into the night and a dip to black at the end. Each section has a marker so you can jump between them.', 41_000),
    question('Make the title a little warmer and hold it one more beat.', 4),
    answer('Warmed the title to the amber of the dusk sky and held it to 4.4 s, so it clears just before the cut to the horizon.', 12_000),
  ];
}

/** What demo mode filled in for a capture: the stand-in's project, library listing and chat. */
export type DemoStandIn = { project: Project; assets: Asset[]; chat: ChatMessage[]; filled: ('timeline' | 'bins' | 'chat')[] };

/** Which parts of the user's project would film empty: a bare timeline, bins with no media. */
export const demoGaps = (project: Project) => ({ timeline: projectIsEmpty(project), bins: project.media.length === 0 });

/**
 * What the capture's stand-in shows in demo mode (capture_app_session demo: true). Only what is
 * empty is filled: a bare timeline becomes the demo edit, the pack joins the bins in its own
 * folders beside anything already there, and the chat (always empty on the stand-in) gets a
 * conversation mid-way. The user's own clips and media stay as they are, and the pack's files
 * join the library listing only so its clips and bins resolve.
 */
export function demoStandIn(project: Project, assets: Asset[], pack: Asset[], providers: ProviderInfo[] = []): DemoStandIn {
  const gaps = demoGaps(project);
  const chat = demoChat(providers);
  if (!pack.length || (!gaps.timeline && !gaps.bins)) return { project, assets, chat, filled: ['chat'] };
  const known = new Set(assets.map((asset) => asset.id));
  const demo = demoProject(pack);
  return {
    project: {
      ...project,
      folders: [...project.folders, ...demo.folders],
      media: [...project.media, ...demo.media.filter((ref) => !project.media.some((mine) => mine.assetId === ref.assetId))],
      // An empty timeline's comps hold nothing to keep: the demo edit takes their place.
      ...(gaps.timeline ? { comps: demo.comps, activeCompId: demo.activeCompId, openCompIds: demo.openCompIds } : {}),
    },
    assets: [...assets, ...pack.filter((asset) => !known.has(asset.id))],
    chat,
    filled: gaps.timeline ? ['timeline', 'bins', 'chat'] : ['bins', 'chat'],
  };
}

/** What a demo capture's reply says was filled, so the model knows what its parts show. */
export function demoNote(project: Project, filled: string[]): string {
  const shown = filled.filter((what) => what !== 'chat');
  if (shown.length) return `Demo: the ${shown.join(' and ')} show the demo media pack, the chat a sample conversation.`;
  const gaps = demoGaps(project);
  return gaps.timeline || gaps.bins
    ? 'Demo: the demo media could not be made (FFmpeg is needed), so only the chat shows a sample conversation.'
    : 'Demo: your project already has media and a timeline, so only the chat shows a sample conversation.';
}
