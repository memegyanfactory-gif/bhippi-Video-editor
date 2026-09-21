// The Program playhead moves up to 60 times a second during playback. Keeping it outside React
// state means only the few components that draw it re-render, not the whole editor.
//
// `rate` is the shuttle speed (J/K/L): 1 plays, 2/4/8 fast-forward, negative plays backwards.
import { useSyncExternalStore } from 'react';

type Listener = () => void;

function createPlayhead() {
  let time = 0;
  let playing = false;
  let rate = 1;
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get: () => time,
    isPlaying: () => playing,
    rate: () => rate,
    set(next: number) {
      const safe = Number.isFinite(next) ? Math.max(0, next) : 0;
      if (safe !== time) {
        time = safe;
        notify();
      }
    },
    setPlaying(next: boolean, nextRate = 1) {
      if (next !== playing || (next && nextRate !== rate)) {
        playing = next;
        rate = next ? nextRate : 1;
        notify();
      }
    },
    /** Stops playback and parks the playhead. */
    seek(next: number) {
      this.setPlaying(false);
      this.set(next);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const playhead = createPlayhead();

export const usePlayhead = () => useSyncExternalStore(playhead.subscribe, playhead.get);
export const usePlaying = () => useSyncExternalStore(playhead.subscribe, playhead.isPlaying);
export const useRate = () => useSyncExternalStore(playhead.subscribe, playhead.rate);
