// Updates from bhippi.com: one state that Settings › About and the title-bar download button both read.
//
// Helios checks shortly after it opens and every few hours after. A newer version downloads on its
// own (Settings › About can turn that off; development builds never do) and waits: installing
// closes Helios, so that is always the user's click, after the project is saved.
import { useSyncExternalStore } from 'react';
import { api, errorText, events, type UpdateInfo, type UpdateProgress } from './ipc';

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

/** A step that can fail; "Try again" repeats it. */
export type UpdateStep = 'check' | 'download' | 'install';

type Snapshot = {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  progress: { received: number; total: number | null } | null;
  error: string | null;
  /** The step `error` came from, in phase 'error'. */
  failed: UpdateStep | null;
  checkedAt: number | null;
};

const FIRST_CHECK_MS = 8_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let snapshot: Snapshot = { phase: 'idle', info: null, progress: null, error: null, failed: null, checkedAt: null };
const listeners = new Set<() => void>();
let beforeInstall: () => Promise<boolean> = async () => true;
/** The Settings switch, asked after every check that finds an update (`start` sets it). */
let autoDownload: () => boolean = () => false;
let started = false;
let listening = false;
/** Bumped by every download() and cancel(), so the late answer of a cancelled download is dropped. */
let downloads = 0;
/** The download() whose update_download call is still out: that call settles it, not the events. */
let awaiting = 0;
/** How many downloads ended on `helios://update`, and the last end, so one that ends while we ask about it is not missed. */
let ends = 0;
let lastEnd: UpdateProgress | null = null;

/** Download progress from updater.rs, whichever path started the download, and how it ended. */
function listen() {
  if (listening) return;
  listening = true;
  void events.update((event) => {
    if (event.state === 'downloading') {
      if (snapshot.phase === 'downloading') publish({ progress: { received: event.received, total: event.total } });
      return;
    }
    ends += 1;
    lastEnd = event;
    if (!awaiting) settle(event);
  });
}

/** How a download this page did not start (one it rejoined after a reload) ended. */
function settle(end: UpdateProgress) {
  if (snapshot.phase !== 'downloading') return;
  if (end.state === 'done' && end.path) finished(end.path);
  else if (end.state === 'cancelled') publish({ phase: snapshot.info?.available ? 'available' : 'idle', progress: null });
  else publish({ phase: 'error', failed: 'download', error: end.error || 'The download didn’t finish.', progress: null });
}

/** The installer is in and verified. */
function finished(path: string) {
  if (snapshot.info) {
    publish({ phase: 'ready', info: { ...snapshot.info, ready: path }, progress: null, error: null, failed: null });
    return;
  }
  // Rejoined before a check said which release this is: ask now, keeping the installer that just verified.
  void api.updateCheck().then(
    (info) => {
      if (snapshot.phase === 'downloading') publish({ phase: 'ready', info: { ...info, ready: path }, checkedAt: Date.now(), progress: null, error: null, failed: null });
    },
    (failure) => {
      if (snapshot.phase === 'downloading') publish({ phase: 'error', failed: 'check', error: errorText(failure), progress: null });
    },
  );
}

/**
 * A download still running in updater.rs because this window reloaded while it ran: show it
 * again, and let its events carry it on and end it.
 */
async function rejoin() {
  const seen = ends;
  const status = await api.updateStatus().catch(() => null);
  if (!status?.downloading || busy()) return;
  publish({ phase: 'downloading', progress: { received: status.received, total: status.total }, error: null, failed: null });
  if (ends !== seen && lastEnd) settle(lastEnd);
  if (snapshot.info) return;
  // What it is downloading (the headline, the notes), as a check would say.
  const info = await api.updateCheck().catch(() => null);
  if (info && !snapshot.info && snapshot.phase === 'downloading') publish({ info, checkedAt: Date.now() });
}

/** Every answer that finds an update downloads it when the Settings switch says so, whoever asked. */
function autoFetch(info: UpdateInfo | null) {
  if (info?.available && !info.ready && !info.dev && autoDownload()) void updater.download();
}

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

const busy = () => snapshot.phase === 'downloading' || snapshot.phase === 'installing';

export const updater = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** `quiet`: a background check, which keeps what it showed before if bhippi.com can't be reached. */
  async check({ quiet = false }: { quiet?: boolean } = {}): Promise<UpdateInfo | null> {
    if (busy()) return snapshot.info;
    const run = downloads;
    if (!quiet) publish({ phase: 'checking', error: null, failed: null });
    try {
      const info = await api.updateCheck();
      // A download started while this was asked: what it shows is newer than this answer.
      if (busy() || run !== downloads) return info;
      publish({ info, checkedAt: Date.now(), error: null, failed: null, phase: info.ready ? 'ready' : info.available ? 'available' : 'current' });
      autoFetch(info);
      return info;
    } catch (failure) {
      if (busy() || run !== downloads) return null;
      if (!quiet) publish({ phase: 'error', failed: 'check', error: errorText(failure) });
      else if (snapshot.phase === 'checking') publish({ phase: 'idle' });
      return null;
    }
  },

  async download() {
    if (busy() || !snapshot.info?.available) return;
    listen();
    const run = ++downloads;
    const seen = ends;
    awaiting = run;
    publish({ phase: 'downloading', progress: { received: 0, total: snapshot.info.size }, error: null, failed: null });
    let path: string | null = null;
    let failure: unknown = null;
    try {
      path = await api.updateDownload();
    } catch (error) {
      failure = error;
    }
    if (awaiting === run) awaiting = 0;
    // Cancelled meanwhile (and maybe started again): the panel already shows what came after.
    if (run !== downloads) return;
    if (path) {
      finished(path);
      return;
    }
    // Refused because one is already running (started before this window reloaded): follow it.
    const status = await api.updateStatus().catch(() => null);
    if (run !== downloads || snapshot.phase !== 'downloading') return;
    if (status?.downloading) publish({ progress: { received: status.received, total: status.total } });
    else if (ends !== seen && lastEnd) settle(lastEnd);
    else publish({ phase: 'error', failed: 'download', error: errorText(failure), progress: null });
  },

  /** Stops the download under way; the update is only available again, and updater.rs deletes the part. */
  async cancel() {
    if (snapshot.phase !== 'downloading') return;
    downloads += 1;
    publish({ phase: snapshot.info?.available ? 'available' : 'idle', progress: null });
    await api.updateCancel().catch(() => undefined);
  },

  async install() {
    const path = snapshot.info?.ready;
    if (!path || busy()) return;
    // 'installing' from the first moment: the save before it can take a while, and a second click
    // (the panel, the toast, Settings) must not start a second save and a second installer.
    publish({ phase: 'installing', error: null, failed: null });
    const saved = await beforeInstall().catch(() => false);
    if (!saved) {
      // Not saved (the app has said why): the update stays ready for another try.
      publish({ phase: 'ready' });
      return;
    }
    try {
      await api.updateInstall(path);
    } catch (failure) {
      // The installer may be gone (antivirus quarantine, a cleaned folder): ask what is really on
      // disk. Without it the update is only available again, so the next step downloads it.
      const fresh = await api.updateCheck().catch(() => null);
      const info = fresh ?? (snapshot.info && { ...snapshot.info, ready: null });
      if (info?.ready) {
        publish({ phase: 'error', failed: 'install', error: errorText(failure), info });
        return;
      }
      publish({ phase: info?.available ? 'available' : 'current', info, error: null, failed: null, checkedAt: fresh ? Date.now() : snapshot.checkedAt });
      autoFetch(info);
    }
  },

  /** What must happen before Helios closes for the installer — the app saves the open project. */
  setBeforeInstall(hook: () => Promise<boolean>) {
    beforeInstall = hook;
  },

  /** Background checks for the rest of the session; `auto()` reads the Settings switch each time. */
  start(auto: () => boolean) {
    if (started) return;
    started = true;
    autoDownload = auto;
    listen();
    void rejoin();
    const run = () => void updater.check({ quiet: true });
    window.setTimeout(run, FIRST_CHECK_MS);
    window.setInterval(run, EVERY_MS);
  },
};

/** What `useUpdater()` returns. */
export type UpdateSnapshot = Snapshot;

export function useUpdater(): Snapshot {
  // The third argument only matters to server rendering (the tests); in the app it is the same read.
  return useSyncExternalStore(updater.subscribe, updater.get, updater.get);
}

/**
 * One thing from the state, for a component that must not re-render on every download progress
 * event (the app itself). `pick` returns a plain value, compared with `===`.
 */
export function useUpdaterPick<T extends string | number | boolean | null>(pick: (state: Snapshot) => T): T {
  const read = () => pick(snapshot);
  return useSyncExternalStore(updater.subscribe, read, read);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

/** Whole percent of a download, or null while its size is unknown. Rounds down, so 100 means every byte is in. */
export function downloadPercent(progress: Snapshot['progress'] | undefined): number | null {
  if (!progress?.total || progress.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((progress.received / progress.total) * 100)));
}

/** "34.2 MB of 84.0 MB", or just what has arrived while the size is unknown. */
export function downloadedText(progress: Snapshot['progress'] | undefined): string {
  if (!progress) return '';
  return progress.total ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)}` : formatBytes(progress.received);
}
