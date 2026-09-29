// Bhippi's own music and backgrounds on the timeline: a composed score laid as a music bed, and a
// rendered plate laid under everything. Pure comp edits; the files come from compose_score and
// render_plate (src-tauri/src/score.rs, plates.rs) through aiTools.ts.
import { dbToGain } from './editor';
import { addTransition, freeTrack, newClip, placeClips, tracksOf } from './timeline';
import type { Comp } from './types';
import type { ScoreMood } from './ipc';

/** Lays `assetId` as the music bed from `start` for `duration` s on a free audio track, faded in and out. */
export function placeMusicBed(comp: Comp, assetId: string, start: number, duration: number, options: { db?: number; name?: string; fadeIn?: number; fadeOut?: number } = {}): { comp: Comp; clipId: string; trackId: string } {
  const free = freeTrack(comp, 'audio', start, start + duration);
  const clip = newClip({
    trackId: free.track.id, start, duration, source: { type: 'media', assetId },
    name: options.name ?? 'Music bed', volume: dbToGain(options.db ?? -6), audioType: 'music', label: 'forest',
  });
  let next = placeClips(free.comp, [clip], 'overwrite');
  const fadeIn = options.fadeIn ?? 0.25;
  const fadeOut = options.fadeOut ?? Math.min(1.5, duration / 4);
  if (fadeIn > 0) next = addTransition(next, free.track.id, start, 'constant-power', fadeIn, 0.05);
  if (fadeOut > 0) next = addTransition(next, free.track.id, start + duration, 'constant-power', fadeOut, 0.05);
  return { comp: next, clipId: clip.id, trackId: free.track.id };
}

/** Lays a background plate on V1 under everything, from `start` for `duration` s. */
export function placePlate(comp: Comp, assetId: string, start: number, duration: number, name = 'Background plate'): { comp: Comp; clipId: string } {
  const v1 = tracksOf(comp, 'video')[0];
  const busy = comp.clips.some((clip) => clip.trackId === v1.id && clip.start < start + duration && clip.start + clip.duration > start);
  const target = busy ? freeTrack(comp, 'video', start, start + duration, 0) : { comp, track: v1 };
  const clip = newClip({ trackId: target.track.id, start, duration, source: { type: 'media', assetId }, name, volume: 0, label: 'cerulean' });
  return { comp: placeClips(target.comp, [clip], 'overwrite'), clipId: clip.id };
}

/** A mood read from a music prompt or brief ("upbeat corporate", "dark tense", "lofi chill"). */
export function moodFromText(text: string | null | undefined): ScoreMood | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/\b(dark|tense|tension|ominous|thriller|crime|horror|noir|suspense)/.test(t)) return 'dark';
  if (/\b(cinematic|epic|trailer|orchestral|dramatic|documentary|emotional)/.test(t)) return 'cinematic';
  if (/\b(playful|fun|funny|quirky|kids|bouncy|comedy|meme|cute|happy)/.test(t)) return 'playful';
  if (/\b(corporate|saas|business|explainer|clean|optimistic|inspiring|uplifting)/.test(t)) return 'corporate';
  if (/\b(chill|lo-?fi|calm|ambient|relax|soft|mellow|vlog|acoustic|restrained)/.test(t)) return 'chill';
  if (/\b(energetic|edm|electronic|hype|drop|driving|upbeat|trap|house|techno|launch|showreel|pumping|four-on-the-floor)/.test(t)) return 'energetic';
  return null;
}

/** A tempo named in a prompt ("120 BPM"), when one is. */
export function bpmFromText(text: string | null | undefined): number | null {
  const match = /(\d{2,3})\s*-?\s*bpm/i.exec(text ?? '');
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 50 && value <= 200 ? value : null;
}
