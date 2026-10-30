// The Create panel talks to the app through two window events, so the studio never holds the tool
// host or the chat (the Brand Studio's prompt bar works the same way, lib/brandKit/promptEvent.ts):
//
//   bhippi:music-create  run music_create_song with these args; `done` gets the tool result
//   bhippi:music-ask     send this text to Bhippi AI (it writes lyrics, then calls music_create_song)
//
// App.tsx listens to both. Progress lines from a running creation travel on a small bus.
import type { ToolResult } from '../../lib/types';

export const MUSIC_CREATE_EVENT = 'bhippi:music-create';
export const MUSIC_ASK_EVENT = 'bhippi:music-ask';

export type MusicCreateDetail = { args: Record<string, unknown>; done: (result: ToolResult) => void };
export type MusicAskDetail = { text: string };

/** Runs music_create_song through the app; resolves with its result. */
export function requestCreate(args: Record<string, unknown>): Promise<ToolResult> {
  return new Promise((resolve) => {
    let answered = false;
    const done = (result: ToolResult) => { answered = true; resolve(result); };
    window.dispatchEvent(new CustomEvent<MusicCreateDetail>(MUSIC_CREATE_EVENT, { detail: { args, done } }));
    // Nobody listening (the music lab page): say so instead of spinning forever.
    window.setTimeout(() => { if (!answered && !listening) resolve({ ok: false, error: 'Song creation runs inside the Bhippi app.' }); }, 50);
  });
}

let listening = false;
/** App.tsx marks that it handles the create event. */
export const setCreateListening = (on: boolean) => { listening = on; };

/** Hands a request to Bhippi AI in the chat. */
export function askMusicAi(text: string): boolean {
  if (!text.trim()) return false;
  window.dispatchEvent(new CustomEvent<MusicAskDetail>(MUSIC_ASK_EVENT, { detail: { text } }));
  return true;
}

const progressListeners = new Set<(message: string) => void>();
export function onCreateProgress(listener: (message: string) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}
export function createProgress(message: string): void {
  for (const listener of progressListeners) listener(message);
}
