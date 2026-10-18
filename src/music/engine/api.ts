// The audio engine's public surface (docs/MUSIC-STUDIO-PLAN.md §5). The studio UI and the AI tools
// import only from `src/music/engine` (index.ts), which implements these.
import type { MusicProject } from '../types';

/** Decodes a bin asset for the sampler / audio clips; null when it cannot. */
export type SampleLoader = (assetId: string) => Promise<AudioBuffer | null>;

export type PlayMode = 'pattern' | 'song';

export type Meter = { peakL: number; peakR: number; rmsL: number; rmsR: number };

export interface MusicEngineApi {
  /** Gives the engine the current song; params update in place without clicks, graph diffs by id. */
  setSong(song: MusicProject): void;
  /** Starts playback from `from` steps (default: 0 or the loop start). Resumes the AudioContext. */
  play(options?: { from?: number; mode?: PlayMode; patternId?: string }): Promise<void>;
  stop(): void;
  readonly playing: boolean;
  /** Playhead in steps (pattern-relative in pattern mode), or 0 when stopped. */
  position(): number;
  /** Auditions a note on a channel now (piano-roll click, browser preview). */
  previewNote(channelId: string, key: number, velocity?: number, seconds?: number): void;
  /** Live keyboard: held notes. */
  liveNoteOn(channelId: string, key: number, velocity?: number): void;
  liveNoteOff(channelId: string, key: number): void;
  /** Per-insert meters, index 0 = master, read by the mixer at ~30 fps. */
  meters(): Meter[];
  setMetronome(on: boolean): void;
  /** Releases the AudioContext. */
  dispose(): void;
}

export type RenderOptions = {
  sampleRate?: number;
  /** 'song' walks the playlist (default); 'pattern' renders one pattern (`patternId`, default the active one) `loops` times. */
  mode?: PlayMode;
  patternId?: string;
  loops?: number;
  /** Range in steps (song mode). */
  from?: number;
  to?: number;
  /** Seconds of tail after the end for reverb/delay (default 2). */
  tail?: number;
  /** Also render each insert that has sound on its own (post-fader). */
  stems?: boolean;
  loadSample?: SampleLoader;
};

export type RenderResult = {
  master: AudioBuffer;
  /** Insert index → its stem, when `stems` was asked. */
  stems?: Map<number, AudioBuffer>;
  /** Seconds of music before the tail. */
  duration: number;
  /** Beat and downbeat times in seconds (for the video timeline's beat grid). */
  beats: number[];
  downbeats: number[];
};

export type BufferAnalysis = {
  peakDb: number;
  rmsDb: number;
  /** Integrated loudness, approximate (K-weighted, gated). */
  lufs: number;
  clipped: boolean;
  /** Fraction of energy per band. */
  bands: { sub: number; low: number; lowMid: number; mid: number; high: number };
  /** Correlation between channels (1 mono … -1 out of phase). */
  correlation: number;
  /** Seconds-long windows' RMS in dB, for spotting empty or overloaded sections. */
  windows: number[];
};
