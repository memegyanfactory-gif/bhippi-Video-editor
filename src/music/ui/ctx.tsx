// The Music Studio's shared state, split in two contexts so memoised rows do not re-render on every
// song change: `Actions` is stable (edit / drag / settle / transport / panels), `Studio` carries the
// song and the UI state. Every song edit goes through `edit` (one undo step) or `drag` + `settle`
// (a gesture: live while held, one undo step on release).
import { createContext, useContext, type MutableRefObject } from 'react';
import type { Asset, Project } from '../../lib/types';
import type { History } from '../../lib/history';
import type { AssetMap } from '../../lib/timeline';
import type { MusicEngineApi, SampleLoader } from '../engine/api';
import type { Channel, MusicProject, MusicView, Pattern } from '../types';
import type { SnapId } from './format';

export type StudioProps = {
  project: Project;
  history: History;
  assets: AssetMap;
  onClose: () => void;
  /** Imports a bounced WAV into the bin; answers the asset. */
  importAudio: (path: string) => Promise<Asset | null>;
  /** Lays a bin asset on the active video comp as the music bed. */
  placeOnTimeline: (assetId: string, seconds: number, beats: number[], downbeats: number[]) => void;
  toast: (t: { tone: 'info' | 'error' | 'success'; title: string; body?: string }) => void;
};

export type BottomWindow = 'rack' | 'pianoroll' | 'mixer';
export type Ui = {
  win: BottomWindow;
  playlist: boolean;
  browser: boolean;
  snapId: SnapId;
  metronome: boolean;
  playing: boolean;
  /** Where Play starts in song mode (steps), set by clicking the playlist ruler. */
  playFrom: number;
};

export type PanelRef = { id: string; kind: 'instrument'; channelId: string } | { id: string; kind: 'effect'; insert: number; effectId: string };
export type NewPanel = { kind: 'instrument'; channelId: string } | { kind: 'effect'; insert: number; effectId: string };

export type ConfirmRequest = { title: string; body: string; ok: string };

export type Studio = {
  song: MusicProject;
  ui: Ui;
  assets: AssetMap;
  /** The selected channel (song.view.selectedChannelId), if it exists. */
  channel: Channel | null;
  /** The active pattern (song.view.activePatternId). */
  pattern: Pattern | null;
  /** Snap in steps (0 = free). */
  snap: number;
  panels: PanelRef[];
};

export type Actions = {
  engine: MusicEngineApi;
  /** A finished edit: one undo step. */
  edit: (change: (song: MusicProject) => MusicProject, label: string) => void;
  /** A step inside a gesture: shown live; `change` always starts from the gesture's start. */
  drag: (change: (start: MusicProject) => MusicProject) => void;
  /** Ends a gesture: one undo step. */
  settle: (label: string) => void;
  /** View state (selection, window) — no undo step. */
  setView: (patch: Partial<MusicView>) => void;
  setUi: (patch: Partial<Ui>) => void;
  openPanel: (panel: NewPanel) => void;
  closePanel: (id: string) => void;
  /** Auditions a channel that may not be in the song yet (browser preview). */
  previewChannel: (channel: Channel, key?: number) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  play: (from?: number) => void;
  stop: () => void;
  toggle: () => void;
  /** Window view state (zoom, scroll) that survives switching windows. */
  store: MutableRefObject<Record<string, number>>;
  toast: StudioProps['toast'];
  importAudio: StudioProps['importAudio'];
  placeOnTimeline: StudioProps['placeOnTimeline'];
  /** The song right now, for handlers that must not close over a stale one. */
  getSong: () => MusicProject;
  /** Decodes a bin asset (sampler, bounce). */
  loadSample: SampleLoader;
};

export const StudioContext = createContext<Studio | null>(null);
export const ActionsContext = createContext<Actions | null>(null);

export function useStudio(): Studio {
  const v = useContext(StudioContext);
  if (!v) throw new Error('useStudio outside MusicStudio');
  return v;
}
export function useActions(): Actions {
  const v = useContext(ActionsContext);
  if (!v) throw new Error('useActions outside MusicStudio');
  return v;
}

/** Knob / fader plumbing: live change via `drag`, one undo step on release. */
export function useGesture(label: string): { live: (change: (start: MusicProject) => MusicProject) => void; end: () => void } {
  const { drag, settle } = useActions();
  return { live: drag, end: () => settle(`Music: ${label}`) };
}
