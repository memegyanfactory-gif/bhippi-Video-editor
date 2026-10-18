// Opens and focuses the Music Studio from anywhere (the rail button, the AI's music_open_studio),
// and tells the AI whether it is open (the tool router sends the music tools whole while it is).
export type StudioWindow = 'playlist' | 'rack' | 'pianoroll' | 'mixer';
export type StudioRequest = { open: boolean; window?: StudioWindow; patternId?: string; channelId?: string };

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
