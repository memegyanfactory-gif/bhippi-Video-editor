import { describe, expect, it } from 'vitest';
import { clipsForSource, moveClips, newProject, setLinked, tracksOf, withLinked } from '../src/lib/timeline';
import type { Asset, Comp } from '../src/lib/types';

const asset: Asset = {
  id: 'a1', name: 'take.mp4', path: 'C:/take.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, fps: 30,
  hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', size: 10, importedAt: '', thumbnail: null, filmstrip: null,
  waveform: null, peaks: null, proxy: null, preview: 'native', missing: false,
};

/** A video placed with its sound: picture on V1, audio on A1, linked as one. */
const placed = () => {
  const project = { ...newProject(), media: [{ assetId: asset.id, folderId: null, offline: false }] };
  const assets = new Map([[asset.id, asset]]);
  const base = project.comps[0];
  const clips = clipsForSource(project, assets, { type: 'media', assetId: asset.id }, {
    start: 0,
    videoTrack: tracksOf(base, 'video')[0].id,
    audioTrack: tracksOf(base, 'audio')[0].id,
    duration: 5,
  });
  const comp: Comp = { ...base, clips };
  return { comp, video: clips.find((clip) => clip.trackId === tracksOf(base, 'video')[0].id)!, audio: clips.find((clip) => clip.trackId === tracksOf(base, 'audio')[0].id)! };
};

describe('unlinking really unlinks', () => {
  it('a placed video and its sound start as one', () => {
    const { comp, video, audio } = placed();
    expect(video.linkId).toBeTruthy();
    expect(video.linkId).toBe(audio.linkId);
    // Selecting the picture selects the sound with it.
    expect(withLinked(comp, [video.id]).sort()).toEqual([video.id, audio.id].sort());
  });

  it('after Unlink each one moves on its own', () => {
    const { comp, video, audio } = placed();
    const unlinked = setLinked(comp, [video.id], false);

    const stillVideo = unlinked.clips.find((clip) => clip.id === video.id)!;
    const stillAudio = unlinked.clips.find((clip) => clip.id === audio.id)!;
    expect(stillVideo.linkId).toBeNull();
    expect(stillAudio.linkId).toBeNull();
    // Nothing else binds them either — a group would keep them moving together.
    expect(stillVideo.groupId).toBeNull();
    expect(stillAudio.groupId).toBeNull();

    // Selecting the picture now selects only the picture.
    expect(withLinked(unlinked, [video.id])).toEqual([video.id]);

    // And moving it leaves the sound where it was.
    const moved = moveClips(unlinked, [video.id], 3, { video: 0, audio: 0 }, 'overwrite');
    if (!moved) throw new Error('the move should have been allowed');
    expect(moved.comp.clips.find((clip) => clip.id === video.id)!.start).toBeCloseTo(3, 3);
    expect(moved.comp.clips.find((clip) => clip.id === audio.id)!.start).toBeCloseTo(0, 3);
  });

  it('unlinking from either half unlinks the pair', () => {
    const { comp, audio } = placed();
    // Right-clicking the sound and choosing Unlink must free the picture too.
    const unlinked = setLinked(comp, [audio.id], false);
    expect(unlinked.clips.every((clip) => clip.linkId === null)).toBe(true);
  });
});
