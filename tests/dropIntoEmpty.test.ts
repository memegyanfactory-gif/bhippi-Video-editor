import { describe, expect, it } from 'vitest';
import { dropIntoEmpty } from '../src/editor/Timeline';
import { newComp, newProject, tracksOf, type AssetMap } from '../src/lib/timeline';
import type { Asset } from '../src/lib/types';

const asset = (id: string, kind: Asset['kind'], seconds: number, width: number, height: number, fps: number | null, hasAudio = true): Asset => ({
  id, name: `${id}.mp4`, path: `C:/${id}.mp4`, kind, duration: seconds, width, height, fps, hasAudio, videoCodec: 'h264', audioCodec: hasAudio ? 'aac' : null,
  size: 1, importedAt: '2026-01-01', thumbnail: null, filmstrip: null, waveform: null, proxy: null, preview: 'native', missing: false, peaks: null,
});
const assets: AssetMap = new Map([
  ['phone', asset('phone', 'video', 12, 1080, 1920, 60)],
  ['wide', asset('wide', 'video', 5, 3840, 2160, 24)],
  ['song', asset('song', 'audio', 8, 0, 0, null)],
]);
const src = (id: string) => ({ source: { type: 'media' as const, assetId: id }, label: `${id}.mp4` });
const empty = () => ({ ...newProject(), comps: [], activeCompId: null, openCompIds: [] });

describe('dropIntoEmpty', () => {
  it('makes a comp at the clip size and rate, with linked picture and sound from zero', () => {
    const made = dropIntoEmpty(empty(), assets, null, [src('phone')], true)!;
    const comp = made.project.comps.find((item) => item.id === made.compId)!;
    expect([comp.name, comp.width, comp.height, comp.fps]).toEqual(['phone', 1080, 1920, 60]);
    expect(made.project.activeCompId).toBe(comp.id);
    expect(made.project.openCompIds).toContain(comp.id);
    expect(made.clips).toHaveLength(2);
    const [v1] = tracksOf(comp, 'video');
    const [a1] = tracksOf(comp, 'audio');
    expect(made.clips.map((clip) => [clip.trackId, clip.start, clip.duration])).toEqual([[v1.id, 0, 12], [a1.id, 0, 12]]);
    expect(made.clips[0].linkId).toBeTruthy();
    expect(made.clips[0].linkId).toBe(made.clips[1].linkId);
    expect(comp.tracks.map((track) => track.kind)).toEqual(['video', 'audio']);
  });

  it('fits an empty open comp to the clip and lays several files end to end', () => {
    const open = newComp({ name: 'Comp 1' });
    const project = { ...newProject(), comps: [open], activeCompId: open.id, openCompIds: [open.id] };
    const made = dropIntoEmpty(project, assets, open, [src('wide'), src('phone')], true)!;
    const comp = made.project.comps.find((item) => item.id === open.id)!;
    expect(made.project.comps).toHaveLength(1);
    expect([comp.width, comp.height, comp.fps]).toEqual([3840, 2160, 24]);
    const starts = made.clips.filter((clip) => tracksOf(comp, 'video').some((track) => track.id === clip.trackId)).map((clip) => clip.start);
    expect(starts).toEqual([0, 5]);
    expect(comp.tracks.map((track) => track.kind)).toEqual(['video', 'audio']);
  });

  it('keeps the frame size when only sound is dropped', () => {
    const made = dropIntoEmpty(empty(), assets, null, [src('song')], true)!;
    const comp = made.project.comps[0];
    expect([comp.width, comp.height]).toEqual([1920, 1080]);
    expect(made.clips).toHaveLength(1);
  });
});
