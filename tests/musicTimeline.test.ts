import { describe, expect, it } from 'vitest';
import { newComp, newProject } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import { newSong } from '../src/music/model';
import { placeSongLayer, songBeatsOnTimeline, songPlacement } from '../src/music/timeline';

function projectWithComp(): { project: Project; compId: string } {
  const comp = newComp({ name: 'Edit' });
  const project: Project = { ...newProject('Film'), comps: [comp], activeCompId: comp.id, openCompIds: [comp.id], music: newSong('Theme', 120) };
  return { project, compId: comp.id };
}

const bounce = (assetId: string, duration: number) => ({ assetId, duration, beats: [0, 0.5, 1, 1.5, 2], downbeats: [0, 2], bpm: 120, name: 'Theme' });

describe('the song as a music layer on the timeline', () => {
  it('lands on an audio track named Music with its beats remembered', () => {
    const { project, compId } = projectWithComp();
    const laid = placeSongLayer(project, compId, bounce('a1', 8), { start: 1, db: -6 });
    const comp = laid.project.comps[0];
    const clip = comp.clips.find((c) => c.id === laid.clipId)!;
    expect(clip.source).toEqual({ type: 'media', assetId: 'a1' });
    expect(clip.start).toBe(1);
    expect(clip.duration).toBe(8);
    expect(comp.tracks.find((t) => t.id === clip.trackId)).toMatchObject({ kind: 'audio', name: 'Music' });
    expect(laid.refreshed).toBe(false);
    expect(songPlacement(laid.project, compId)?.clipId).toBe(laid.clipId);
    // Snapping reads the beats in timeline seconds (offset by the clip's start).
    expect(songBeatsOnTimeline(laid.project, compId)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('sending the song again refreshes the same layer in place instead of adding a copy', () => {
    const { project, compId } = projectWithComp();
    const first = placeSongLayer(project, compId, bounce('a1', 8), { start: 2 });
    // The editor moves the clip and turns it down.
    const moved: Project = { ...first.project, comps: first.project.comps.map((c) => ({ ...c, clips: c.clips.map((clip) => (clip.id === first.clipId ? { ...clip, start: 4, volume: 0.25 } : clip)) })) };
    const second = placeSongLayer(moved, compId, bounce('a2', 10), { start: 0 });
    const music = second.project.comps[0].clips.filter((c) => c.source.type === 'media');
    expect(second.refreshed).toBe(true);
    expect(music).toHaveLength(1);
    expect(music[0]).toMatchObject({ start: 4, volume: 0.25, duration: 10, trackId: first.trackId, source: { type: 'media', assetId: 'a2' } });
    expect(second.project.music?.placements).toHaveLength(1);
  });

  it('a layer the editor deleted is placed fresh next time', () => {
    const { project, compId } = projectWithComp();
    const first = placeSongLayer(project, compId, bounce('a1', 8));
    const removed: Project = { ...first.project, comps: first.project.comps.map((c) => ({ ...c, clips: [] })) };
    expect(songPlacement(removed, compId)).toBeNull();
    const again = placeSongLayer(removed, compId, bounce('a1', 8));
    expect(again.refreshed).toBe(false);
    expect(again.project.comps[0].clips).toHaveLength(1);
  });
});
