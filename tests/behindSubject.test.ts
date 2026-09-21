import { expect, it } from 'vitest';
import { textBehindSubject, mediaBehindSubject } from '../src/lib/behindSubject';
import { newClip, newComp, tracksOf } from '../src/lib/timeline';

it('builds real background, animated title and original matte in order without losing source timing', () => {
  const comp = newComp({ name: 'Shot' });
  const subject = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 2, in: 5, duration: 3, source: { type: 'media', assetId: 'footage' }, rotoMatte: 'matte.mkv', linkId: 'linked-audio' });
  comp.clips = [subject];
  const result = textBehindSubject(comp, subject.id, 'HELLO');
  const base = result.comp.clips.find(c => c.id === result.backgroundId)!;
  const title = result.comp.clips.find(c => c.id === result.titleId)!;
  const top = result.comp.clips.find(c => c.id === result.foregroundId)!;
  const tracks = tracksOf(result.comp, 'video').map(t => t.id);
  expect(tracks.indexOf(base.trackId)).toBeLessThan(tracks.indexOf(title.trackId));
  expect(tracks.indexOf(title.trackId)).toBeLessThan(tracks.indexOf(top.trackId));
  expect(base.in).toBe(5); expect(base.start).toBe(2); expect(base.rotoMatte).toBeNull();
  expect(base.volume).toBe(0); expect(base.keyframes.volume).toEqual([]);
  expect(top.rotoMatte).toBe('matte.mkv'); expect(top.linkId).toBe('linked-audio');
  expect(title.keyframes.opacity.length).toBe(2);
  expect(comp.clips).toHaveLength(1);
});
it('inserts media under depth foreground while retaining the scene and avoiding duplicate audio', () => {
  const comp = newComp({ name: 'Depth shot' });
  const source = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 2, in: 1, duration: 3, source: { type: 'media', assetId: 'scene' }, rotoMatte: 'depth.mkv' });
  comp.clips = [source];
  const result = mediaBehindSubject(comp, source.id, 'generated-lamp');
  const inserted = result.comp.clips.find(c => c.id === result.mediaId)!;
  expect(inserted.source).toEqual({ type: 'media', assetId: 'generated-lamp' });
  expect(inserted.in).toBe(0); expect(inserted.start).toBe(2); expect(inserted.duration).toBe(3);
  expect(inserted.volume).toBe(0);
  expect(result.comp.clips.find(c => c.id === result.foregroundId)!.rotoMatte).toBe('depth.mkv');
  expect(comp.clips).toHaveLength(1);
});
it('refuses to fake subject separation when no matte exists', () => {
  const comp = newComp({ name: 'Shot' });
  const source = newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 3, source: { type: 'media', assetId: 'footage' } });
  comp.clips = [source];
  expect(() => textBehindSubject(comp, source.id, 'Hello')).toThrow('Run Roto');
});
