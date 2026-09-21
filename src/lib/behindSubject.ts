import { uid, isHexColor } from './editor';
import { addTracks, newClip, textSource } from './timeline';
import type { Comp } from './types';

/** Keep the real scene below editable text, and the existing subject matte above it. */
export function textBehindSubject(comp: Comp, clipId: string, text: string, color = '#ffffff') {
  const source = comp.clips.find(c => c.id === clipId);
  if (!source || !source.rotoMatte || source.source.type !== 'media') throw new Error('Run Roto on a media clip before placing text behind its subject.');
  const track = comp.tracks.find(t => t.id === source.trackId);
  if (!track || track.kind !== 'video' || track.locked) throw new Error('Choose an unlocked video clip.');
  if (!text.trim() || text.length > 500 || !isHexColor(color)) throw new Error('Supply a title up to 500 characters and a hex color.');
  const groupId = source.groupId ?? uid();
  const baseScale = source.transform.scale > 0 && source.transform.scale <= 5 ? Math.round(source.transform.scale * 100) : source.transform.scale;
  const base = { ...source, id: uid(), volume: 0, keyframes: { ...source.keyframes, volume: [] }, transform: { ...source.transform, scale: baseScale }, rotoMatte: null, rotoCorrections: [], linkId: null, groupId, name: 'Original background' };
  const titleTrack = addTracks(comp, 'video', 1);
  const titleTrackId = titleTrack.comp.tracks.filter(t => t.kind === 'video').at(-1)!.id;
  const foregroundTrack = addTracks(titleTrack.comp, 'video', 1);
  const foregroundTrackId = foregroundTrack.comp.tracks.filter(t => t.kind === 'video').at(-1)!.id;
  const title = newClip({ trackId: titleTrackId, start: source.start, duration: source.duration, source: textSource('title', { text, color }), groupId });
  title.keyframes = { ...title.keyframes, opacity: [{ time: 0, value: 0, easing: 'ease' }, { time: Math.min(0.35, source.duration / 2), value: 100, easing: 'linear' }], y: [{ time: 0, value: 0.06, easing: 'ease' }, { time: Math.min(0.45, source.duration / 2), value: 0, easing: 'linear' }] };
  return { comp: { ...foregroundTrack.comp, clips: [...comp.clips.map(c => c.id === source.id ? { ...c, trackId: foregroundTrackId, groupId, transform: { ...c.transform, scale: baseScale } } : c), base, title] }, titleId: title.id, foregroundId: source.id, backgroundId: base.id };
}

export function mediaBehindSubject(comp: Comp, clipId: string, assetId: string) {
  const layered = textBehindSubject(comp, clipId, 'Placeholder');
  return { ...layered, comp: { ...layered.comp, clips: layered.comp.clips.map(clip => clip.id === layered.titleId
    ? { ...newClip({ trackId: clip.trackId, start: clip.start, duration: clip.duration, source: { type: 'media', assetId }, groupId: clip.groupId }), id: clip.id, volume: 0, name: 'Media behind foreground' }
    : clip) }, mediaId: layered.titleId };
}
