// Opens and focuses the Music Studio from anywhere (the rail button, the AI's music_open_studio),
// and tells the AI whether it is open (the tool router sends the music tools whole while it is).
export type StudioWindow = 'playlist' | 'rack' | 'pianoroll' | 'mixer';
export type StudioRequest = {
  open: boolean;
  window?: StudioWindow;
  patternId?: string;
  channelId?: string;
  /** play: from `playFrom` in song mode; rewind: stop and put the play-from mark at the start. */
  transport?: 'play' | 'stop' | 'rewind';
  /** Song mode: where Play starts, in steps (the play-from mark). */
  playFrom?: number;
  mode?: 'pattern' | 'song';
  metronome?: boolean;
  snap?: 'none' | 'bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32' | '1/8T' | '1/16T';
  browser?: boolean;
  playlist?: boolean;
  panel?: { kind: 'instrument'; channelId: string } | { kind: 'effect'; insert: number; effectId: string };
  closePanels?: boolean;
};

const listeners = new Set<(request: StudioRequest) => void>();
let isOpen = false;

export const studioOpen = (): boolean => isOpen;
/** The studio reports its own state here when it mounts / unmounts. */
export const setStudioOpen = (open: boolean): void => { isOpen = open; };

export function requestStudio(request: StudioRequest): void {
  for (const listener of listeners) listener(request);
}

export function onStudioRequest(listener: (request: StudioRequest) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
