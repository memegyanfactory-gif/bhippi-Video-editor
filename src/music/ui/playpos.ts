// Where the playhead is, in the terms each window needs. The engine reports steps: pattern-relative in
// pattern mode, song steps in song mode. Windows that show one pattern map the song position onto the
// pattern clip under it.
import type { MusicEngineApi } from '../engine/api';
import { patternSteps } from '../model';
import type { MusicProject, Pattern } from '../types';
import type { Ui } from './ctx';

export type FollowMode = 0 | 1 | 2;

/** The playlist's line, in song steps: the play position while playing, the play-from mark when stopped. Null in pattern mode. */
export function songLine(engine: MusicEngineApi, ui: Ui, song: MusicProject): number | null {
  if (song.view.mode !== 'song') return null;
  return engine.playing ? engine.position() : ui.playFrom;
}

/** Every pattern sounding at `pos` with its local step: the active pattern in pattern mode, the pattern clips under the line in song mode. */
export function patternsAt(song: MusicProject, pos: number): { pattern: Pattern; step: number; len: number }[] {
  if (song.view.mode === 'pattern') {
    const pattern = song.patterns.find((p) => p.id === song.view.activePatternId) ?? song.patterns[0];
    if (!pattern) return [];
    const len = Math.max(1, patternSteps(song, pattern));
    return [{ pattern, step: pos % len, len }];
  }
  const out: { pattern: Pattern; step: number; len: number }[] = [];
  const tracks = song.playlist.tracks;
  for (const c of song.playlist.clips) {
    if (c.kind !== 'pattern' || c.muted || tracks[c.trackIndex]?.mute || pos < c.start || pos >= c.start + c.length) continue;
    const pattern = song.patterns.find((p) => p.id === c.patternId);
    if (!pattern) continue;
    const len = Math.max(1, patternSteps(song, pattern));
    out.push({ pattern, step: (pos - c.start + c.offset) % len, len });
  }
  return out;
}

/** The step of `patternId` under the playhead (0 when stopped in pattern mode), null when that pattern is not sounding. */
export function patternLine(engine: MusicEngineApi, song: MusicProject, patternId: string): number | null {
  if (!engine.playing) return song.view.mode === 'pattern' ? 0 : null;
  return patternsAt(song, engine.position()).find((p) => p.pattern.id === patternId)?.step ?? null;
}

/** The new horizontal scroll that keeps the line in view, or null to leave it. `x` is the line's content pixel. */
export function followScroll(mode: FollowMode, x: number, view: number, sx: number, maxX: number): number | null {
  if (mode === 0 || maxX <= 0) return null;
  if (mode === 1) {
    if (x >= sx && x <= sx + view - 12) return null;
    const to = Math.min(maxX, Math.max(0, x - 24));
    return Math.abs(to - sx) < 1 ? null : to;
  }
  const to = Math.min(maxX, Math.max(0, x - view * 0.4));
  return Math.abs(to - sx) < 1 ? null : to;
}
