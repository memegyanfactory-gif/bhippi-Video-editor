// What the launch splash (BootSplash.tsx) says in its corner and when it may step aside.
//
// The license gate and App's boot report here as each real check finishes; the splash shows the
// lines one after another and opens onto the app once the license has answered and, when the app
// is unlocked, the project has loaded.
import { useSyncExternalStore } from 'react';

type BootSnapshot = {
  /** Every line reported so far, oldest first. */
  lines: string[];
  /** The license check has answered (or failed). */
  licenseSettled: boolean;
  /** App's boot finished (or failed): the editor behind the splash is ready to be seen. */
  appReady: boolean;
};

let snapshot: BootSnapshot = { lines: ['Starting Bhippi'], licenseSettled: false, appReady: false };
const listeners = new Set<() => void>();

function publish(next: Partial<BootSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

export const bootStore = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** A line said once is not repeated (React's dev double-mount runs the boot twice). */
  say(line: string) {
    if (!snapshot.lines.includes(line)) publish({ lines: [...snapshot.lines, line] });
  },
  /** Reports `done(value)` when the promise settles; the promise itself passes through unchanged. */
  step<T>(promise: Promise<T>, done: (value: T) => string | null): Promise<T> {
    void promise.then((value) => {
      const line = done(value);
      if (line) bootStore.say(line);
    }, () => undefined);
    return promise;
  },
  licenseSettled(line: string) {
    bootStore.say(line);
    if (!snapshot.licenseSettled) publish({ licenseSettled: true });
  },
  appReady(line = 'Ready') {
    bootStore.say(line);
    if (!snapshot.appReady) publish({ appReady: true });
  },
};

export function useBoot(): BootSnapshot {
  return useSyncExternalStore(bootStore.subscribe, bootStore.get);
}
