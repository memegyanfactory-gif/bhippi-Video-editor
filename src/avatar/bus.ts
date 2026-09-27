// The line between the app and the avatar. App.tsx and the chat report turns, what the reply is
// doing and every tool call here; the avatar (when it is switched on) listens. With no listener
// every call is a no-op, so a switched-off avatar costs nothing — not even the DOM reads for clip
// positions.

import { activityForTool, clipIdsIn, diffTimeline, type Activity, type ClipDiff } from './brain';
import type { Project } from '../lib/types';

/** A clip as it was on screen when a tool started: where, and in what colour. */
export type Ghost = { id: string; x: number; y: number; w: number; h: number; color: string };

/** How a turn closed: it answered, the user stopped it, or it failed. */
export type TurnOutcome = 'done' | 'stopped' | 'failed';

export type AvatarEvent =
  /** `plugin`: a Plugin Maker turn — it builds a plugin and never touches the video. */
  | { type: 'turn'; turnId: string; busy: boolean; outcome?: TurnOutcome; plugin?: boolean }
  /** The model is thinking, or writing its reply in the chat. */
  | { type: 'chat'; turnId: string; what: 'thinking' | 'writing' }
  /** A step a CLI provider takes by itself (its own search, file read, command), as the chat lists it. */
  | { type: 'step'; turnId: string; id: string; verb: string; title: string; done: boolean }
  | { type: 'tool-start'; turnId: string; callId: string; name: string; activity: Activity | null; clipIds: string[] }
  | { type: 'tool-end'; turnId: string; callId: string; name: string; ok: boolean; diff: ClipDiff | null; ghosts: Ghost[] };

type Listener = (event: AvatarEvent) => void;

const listeners = new Set<Listener>();
const snapshots = new Map<string, Map<string, Ghost>>();

function snapshotClips(): Map<string, Ghost> {
  const out = new Map<string, Ghost>();
  for (const el of document.querySelectorAll<HTMLElement>('.tl-clip[data-clip-id]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1) continue;
    out.set(el.dataset.clipId!, { id: el.dataset.clipId!, x: rect.left, y: rect.top, w: rect.width, h: rect.height, color: getComputedStyle(el).backgroundColor });
  }
  return out;
}

export const avatarBus = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  get listening() {
    return listeners.size > 0;
  },
  emit(event: AvatarEvent) {
    for (const listener of listeners) {
      try { listener(event); } catch (error) { console.warn('avatar:', error); }
    }
  },
  /** A chat turn (or a council worker's turn) started, or closed with an outcome. `plugin` marks a Plugin Maker turn. */
  turn(turnId: string, busy: boolean, outcome?: TurnOutcome, plugin = false) {
    if (listeners.size) this.emit({ type: 'turn', turnId, busy, outcome, ...(plugin ? { plugin } : {}) });
  },
  /** A chunk of the model's thinking or of its reply arrived. */
  chat(turnId: string, what: 'thinking' | 'writing') {
    if (listeners.size) this.emit({ type: 'chat', turnId, what });
  },
  step(turnId: string, id: string, verb: string, title: string, done: boolean) {
    if (listeners.size) this.emit({ type: 'step', turnId, id, verb, title, done });
  },
  toolStart(turnId: string, callId: string, name: string, args: unknown) {
    if (!listeners.size) return;
    // Where every clip is now: a deleted clip's ghost is drawn where it stood.
    snapshots.set(callId, snapshotClips());
    this.emit({ type: 'tool-start', turnId, callId, name, activity: activityForTool(name), clipIds: clipIdsIn(args) });
  },
  toolEnd(turnId: string, callId: string, name: string, ok: boolean, before: Project, after: Project) {
    const snapshot = snapshots.get(callId);
    snapshots.delete(callId);
    if (!listeners.size) return;
    const diff = ok && before !== after ? diffTimeline(before, after) : null;
    const ghosts = diff && snapshot ? diff.removed.flatMap((id) => snapshot.get(id) ?? []) : [];
    this.emit({ type: 'tool-end', turnId, callId, name, ok, diff, ghosts });
  },
};
