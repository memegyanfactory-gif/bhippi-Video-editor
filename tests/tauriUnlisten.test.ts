import { describe, expect, it } from 'vitest';
import { guardTauriUnlisten } from '../src/lib/tauriUnlisten';

// What Tauri 2.11's unregister script does: reads the listener without checking it exists.
const tauri211 = () => {
  const listeners: Record<string, Record<number, { handlerId: number }>> = { 'job://progress': { 1: { handlerId: 7 } } };
  const unregistered: number[] = [];
  const win = {
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: (event: string, id: number) => {
        const forEvent = listeners[event];
        if (forEvent) {
          unregistered.push(forEvent[id].handlerId);
          delete forEvent[id];
        }
      },
    },
  };
  return { win, unregistered };
};

describe('removing a Tauri listener that is already gone', () => {
  it('throws the handlerId TypeError without the guard', () => {
    const { win } = tauri211();
    win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('job://progress', 1);
    expect(() => win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('job://progress', 1)).toThrow(/handlerId/);
  });

  it('is a no-op with the guard, and the first removal still works', () => {
    const { win, unregistered } = tauri211();
    guardTauriUnlisten(win);
    guardTauriUnlisten(win);
    win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('job://progress', 1);
    expect(() => win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('job://progress', 1)).not.toThrow();
    expect(unregistered).toEqual([7]);
  });

  it('does nothing outside Tauri', () => {
    expect(() => guardTauriUnlisten({})).not.toThrow();
  });
});
