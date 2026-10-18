// The song as a music layer on the video timeline. A bounce is placed once per composition, on an
// audio track named "Music", and remembered in the song (`MusicProject.placements`): sending the
// song again — from the studio or from music_render — swaps that clip's audio in place (keeping
// where it starts, its level and its track) instead of stacking a second copy, and the beat grid
// travels with it so snap_cuts_to_beats works without analysing the waveform.
import { dbToGain } from '../lib/editor';
import { addTracks, addTransition, newClip, placeClips, removeClips, tracksOf, updateComp } from '../lib/timeline';
import type { Comp, Project } from '../lib/types';
import type { SongPlacement } from './types';

export type SongBounce = { assetId: string; duration: number; beats: number[]; downbeats: number[]; bpm: number; name: string };

/** The placement of this project's song on `compId` whose clip is still on that timeline. */
export function songPlacement(project: Project, compId: string): SongPlacement | null {
  const placement = project.music?.placements?.find((p) => p.compId === compId);
  const comp = project.comps.find((c) => c.id === compId);
  return placement && comp?.clips.some((clip) => clip.id === placement.clipId) ? placement : null;
}

const MUSIC_TRACK = 'Music';

/** An audio track named Music that is free over the span, made (and named) when there is none. */
function musicTrack(comp: Comp, start: number, end: number): { comp: Comp; trackId: string } {
  const audio = tracksOf(comp, 'audio');
  const free = (trackId: string) => !comp.clips.some((clip) => clip.trackId === trackId && clip.start < end && clip.start + clip.duration > start);
  const named = audio.find((track) => track.name === MUSIC_TRACK && free(track.id));
  if (named) return { comp, trackId: named.id };
  // A new audio track after the last one, so music sits under dialogue and effects.
  const added = addTracks(comp, 'audio', 1, audio[audio.length - 1]?.id);
  const trackId = added.ids[0];
  return { comp: { ...added.comp, tracks: added.comp.tracks.map((track) => (track.id === trackId ? { ...track, name: MUSIC_TRACK } : track)) }, trackId };
}

/**
 * Lays (or refreshes) the song's music layer on a composition. Answers the new project, the clip
 * and whether an earlier layer was refreshed. `start` and `db` only apply to a first placement; a
 * refresh keeps what the editor set.
 */
export function placeSongLayer(project: Project, compId: string, bounce: SongBounce, options: { start?: number; db?: number } = {}): { project: Project; clipId: string; trackId: string; refreshed: boolean } {
  const before = songPlacement(project, compId);
  const comp0 = project.comps.find((c) => c.id === compId);
  if (!comp0) throw new Error('That composition is not in the project.');
  const old = before ? comp0.clips.find((clip) => clip.id === before.clipId) : undefined;
  const start = old?.start ?? Math.max(0, options.start ?? 0);
  const volume = old?.volume ?? dbToGain(options.db ?? -6);
  let comp = old ? removeClips(comp0, [old.id], false) : comp0;
  let trackId = old?.trackId ?? '';
  if (!old) {
    const made = musicTrack(comp, start, start + bounce.duration);
    comp = made.comp;
    trackId = made.trackId;
  }
  const clip = newClip({ trackId, start, duration: bounce.duration, source: { type: 'media', assetId: bounce.assetId }, name: `♪ ${bounce.name}`, volume, audioType: 'music', label: 'forest' });
  comp = placeClips(comp, [clip], 'overwrite');
  comp = addTransition(comp, trackId, start, 'constant-power', 0.25, 0.05);
  comp = addTransition(comp, trackId, start + bounce.duration, 'constant-power', Math.min(1.5, bounce.duration / 4), 0.05);
  // A production keeps its music (and beats) where the edit workflow reads them.
  if (comp.production) comp = { ...comp, production: { ...comp.production, music: { ...(comp.production.music ?? { source: 'generate' as const }), assetId: bounce.assetId, status: 'ready' as const, bpm: bounce.bpm, beats: bounce.beats }, updatedAt: Date.now() } };
  const placement: SongPlacement = { compId, clipId: clip.id, trackId, assetId: bounce.assetId, bpm: bounce.bpm, beats: bounce.beats, downbeats: bounce.downbeats, placedAt: Date.now() };
  const placements = [...(project.music?.placements ?? []).filter((p) => p.compId !== compId), placement];
  const next = updateComp(project, compId, () => comp);
  return { project: project.music ? { ...next, music: { ...project.music, placements } } : next, clipId: clip.id, trackId, refreshed: !!old };
}

/** The song's beats on the timeline (seconds) for a composition it is placed on, or null. */
export function songBeatsOnTimeline(project: Project, compId: string): number[] | null {
  const placement = songPlacement(project, compId);
  const clip = placement && project.comps.find((c) => c.id === compId)?.clips.find((c) => c.id === placement.clipId);
  if (!placement || !clip || !placement.beats.length) return null;
  return placement.beats.map((b) => clip.start + (b - clip.in) / clip.speed).filter((t) => t >= clip.start && t <= clip.start + clip.duration);
}
