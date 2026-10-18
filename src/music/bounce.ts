// Bounces the song to a WAV file in the project's Generated/Music folder: the engine renders it
// offline (the same graph as playback), the WAV encoder writes 24-bit PCM, and the Rust side saves
// it. Used by the Studio's Bounce button and by the AI's music_render, so a person and a model get
// the same file. The engine is imported on demand: it needs Web Audio, which only the app has.
import { api } from '../lib/ipc';
import type { PlayMode, RenderResult, SampleLoader } from './engine/api';
import { songLengthSteps } from './model';
import type { MusicProject } from './types';

export type BounceOptions = {
  /** File name without folders; unsafe characters are replaced. `.wav` is added. */
  name: string;
  loadSample?: SampleLoader;
  mode?: PlayMode;
  patternId?: string;
  /** Also write each mixer insert that has sound as its own `<name> - <insert>.wav`. */
  stems?: boolean;
  /** Range in steps (song mode). */
  from?: number;
  to?: number;
};

export type BounceResult = { path: string; result: RenderResult; stemPaths?: string[] };

/** A file name the Rust side accepts (`/^[A-Za-z0-9 _.-]+\.wav$/`). */
export function wavFileName(name: string): string {
  const base = name.replace(/\.wav$/i, '').replace(/[^A-Za-z0-9 _.-]+/g, '_').replace(/\s+/g, ' ').replace(/^[\s._-]+|[\s.]+$/g, '').slice(0, 80);
  return `${base || 'Song'}.wav`;
}

export async function bounceSong(song: MusicProject, options: BounceOptions): Promise<BounceResult> {
  const engine = await import('./engine');
  const result = await engine.renderSong(song, {
    mode: options.mode, patternId: options.patternId, from: options.from, to: options.to, stems: options.stems, loadSample: options.loadSample,
  });
  const file = wavFileName(options.name);
  const path = await api.musicSaveWav(file, engine.encodeWav(result.master, 24));
  let stemPaths: string[] | undefined;
  if (options.stems && result.stems?.size) {
    stemPaths = [];
    const stem = file.replace(/\.wav$/i, '');
    for (const [insert, buffer] of result.stems) {
      const label = song.mixer.inserts[insert]?.name ?? `Insert ${insert}`;
      stemPaths.push(await api.musicSaveWav(wavFileName(`${stem} - ${label}`), engine.encodeWav(buffer, 24)));
    }
  }
  return { path, result, ...(stemPaths ? { stemPaths } : {}) };
}

/** Whether a song has anything in its playlist to render in song mode. */
export const hasArrangement = (song: MusicProject): boolean => song.playlist.clips.length > 0 && songLengthSteps(song) > 0;
