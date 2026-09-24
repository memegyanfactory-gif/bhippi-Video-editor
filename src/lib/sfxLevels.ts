// How loud generated sound effects sit, and how they are labelled. SFX are seasoning under the
// voice: at the old 0.55–0.7 linear gain (−3 to −5 dB) whooshes and impacts overpowered speech.
// These defaults put them 14–20 dB down, by kind, and every generated one says what it is.
import { freeTrack, SFX_DEFAULT_GAIN, tracksOf } from './timeline';
import type { Comp, SfxKind, Track } from './types';

/** Linear gain per kind (a whoosh reads at −16 dB; a pop or chime quieter; a riser sits low). */
export const SFX_GAIN: Record<SfxKind, number> = SFX_DEFAULT_GAIN;

/**
 * The same in dB. The @funny kinds are set from their measured loudness (all peak at −1.5 dBTP):
 * boom −13 LUFS raw → −14 dB, the loudest of them (≈ −27 LUFS); scratch −6 → −20; bleep (a full
 * sine, −4.6) → −18, just under the voice it replaces; swish, ding −16; glitch −18.
 */
export const SFX_GAIN_DB: Record<SfxKind, number> = { whoosh: -16, impact: -14, pop: -18, chime: -18, riser: -20, boom: -14, scratch: -20, bleep: -18, swish: -16, ding: -16, glitch: -18 };

/**
 * Sampled sounds from the SFX library arrive normalised to −16 LUFS (sfx_library.rs). Meme and
 * voice sounds ("bruh", a vine boom, a laugh) are the joke itself and sit higher than seasoning.
 */
export function sampleSfxDb(tags: readonly string[] = []): number {
  const loud = tags.some((tag) => /^(meme|voice|vocal|reaction|punchline|laugh|funny|comedy)$/i.test(tag));
  return loud ? -10 : -14;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "SFX · Whoosh — frame to card": what the clip is and why it is there. */
export function sfxName(kind: SfxKind, note?: string): string {
  return `SFX · ${capital(kind)}${note ? ` — ${note}` : ''}`;
}

/** The fields a generated SFX clip carries: its level, name and type. */
export function sfxClipFields(kind: SfxKind, note?: string, volume?: number) {
  return { volume: volume ?? SFX_GAIN[kind], name: sfxName(kind, note), audioType: 'sfx' as const, label: 'mango' as const };
}

/**
 * A free audio track for sound effects over [start, end): an existing "SFX" track when one is
 * free, else a new track, named "SFX" so sounds never land among dialogue or music unlabelled.
 */
export function sfxTrack(comp: Comp, start: number, end: number): { comp: Comp; track: Track } {
  const audio = tracksOf(comp, 'audio');
  const busy = (track: Track) => comp.clips.some((clip) => clip.trackId === track.id && clip.start < end - 1e-6 && clip.start + clip.duration > start + 1e-6);
  const existing = audio.find((track) => /^SFX\b/i.test(track.name) && !track.locked && !busy(track));
  if (existing) return { comp, track: existing };
  // Past every track that has anything on it, so a fresh track is made rather than a music gap used.
  const lastUsed = audio.reduce((max, track, index) => (comp.clips.some((clip) => clip.trackId === track.id) ? index : max), -1);
  const free = freeTrack(comp, 'audio', start, end, lastUsed + 1);
  const empty = !free.comp.clips.some((clip) => clip.trackId === free.track.id);
  if (!empty) return free;
  const track = { ...free.track, name: 'SFX' };
  return { comp: { ...free.comp, tracks: free.comp.tracks.map((t) => (t.id === track.id ? track : t)) }, track };
}
