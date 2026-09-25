// The update store (lib/updater.ts) against a scripted updater.rs: each test gets a fresh store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../src/lib/ipc';

type Updater = (typeof import('../src/lib/updater'))['updater'];

const MB = 1024 ** 2;
const PATH = 'C:/updates/Bhippi-1.0.2-setup.exe';
const info = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: '1.0.1', latest: '1.0.2', available: true, size: 84 * MB, notes: null, uploadedAt: null, ready: null, dev: false, ...overrides,
});
const idle: UpdateStatus = { downloading: false, version: null, received: 0, total: null };
const event = (overrides: Partial<UpdateProgress>): UpdateProgress => ({ version: '1.0.2', received: 0, total: 84 * MB, state: 'downloading', path: null, error: null, ...overrides });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

/** updater.rs, one answer per command: a value, or a function of the call's arguments. */
let backend: Record<string, unknown> = {};
/** `bhippi://update`, as updater.rs would emit it. */
let emit: (payload: UpdateProgress) => void = () => {};
const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command);

async function freshStore(): Promise<Updater> {
  vi.resetModules();
  return (await import('../src/lib/updater')).updater;
}

beforeEach(() => {
  backend = { update_status: idle };
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (!(command in backend)) throw new Error(`unexpected ${command}`);
    const answer = backend[command];
    return typeof answer === 'function' ? answer(args) : answer;
  });
  listen.mockReset();
  listen.mockImplementation(async (_name: string, handler: (message: { payload: UpdateProgress }) => void) => {
    emit = (payload) => handler({ payload });
    return () => {};
  });
  vi.stubGlobal('window', { setTimeout: vi.fn(), setInterval: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('install', () => {
  it('runs once however often it is clicked while the project saves', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    backend.update_install = undefined;
    await updater.check();
    const save = deferred<boolean>();
    updater.setBeforeInstall(() => save.promise);

    void updater.install();
    expect(updater.get().phase).toBe('installing');
    void updater.install();
    void updater.install();
    save.resolve(true);
    await settle();
    expect(calls('update_install')).toEqual([['update_install', { path: PATH }]]);
  });

  it('stays ready when the save did not happen', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    await updater.check();
    updater.setBeforeInstall(async () => false);
    await updater.install();
    expect(updater.get().phase).toBe('ready');
    expect(calls('update_install')).toHaveLength(0);
  });

  it('downloads again when the installer is gone, instead of retrying the install', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    await updater.check();
    // Antivirus took it: updater.rs no longer finds it on disk.
    backend.update_install = () => { throw 'That isn’t a downloaded Bhippi update.'; };
    backend.update_check = info();
    await updater.install();
    expect(updater.get()).toMatchObject({ phase: 'available', error: null, failed: null });
    expect(updater.get().info?.ready).toBeNull();
  });

  it('assumes the installer is gone when bhippi.com cannot say', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    await updater.check();
    backend.update_install = () => { throw 'That isn’t a downloaded Bhippi update.'; };
    backend.update_check = () => { throw 'offline'; };
    await updater.install();
    expect(updater.get().phase).toBe('available');
    expect(updater.get().info?.ready).toBeNull();
  });

  it('offers the install again when the installer is there but did not start', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    await updater.check();
    backend.update_install = () => { throw 'Couldn’t start the installer: access denied'; };
    await updater.install();
    expect(updater.get()).toMatchObject({ phase: 'error', failed: 'install', error: 'Couldn’t start the installer: access denied' });
  });
});

describe('which step failed', () => {
  it('is the check when a check fails, whatever was known before', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    await updater.check();
    backend.update_check = () => { throw 'Couldn’t reach bhippi.com'; };
    await updater.check();
    expect(updater.get()).toMatchObject({ phase: 'error', failed: 'check', error: 'Couldn’t reach bhippi.com' });
    expect(updater.get().info?.ready).toBe(PATH);
  });

  it('is the download when the download fails', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    await updater.check();
    backend.update_download = () => { throw 'The download stopped'; };
    await updater.download();
    expect(updater.get()).toMatchObject({ phase: 'error', failed: 'download', error: 'The download stopped', progress: null });
  });

  it('leaves the screen alone when a background check fails', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    await updater.check();
    backend.update_check = () => { throw 'offline'; };
    await updater.check({ quiet: true });
    expect(updater.get()).toMatchObject({ phase: 'available', failed: null });
  });
});

describe('automatic downloads', () => {
  it('follow every check that finds an update, not only the background one', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    backend.update_download = new Promise(() => {});
    updater.start(() => true);
    await updater.check();
    expect(calls('update_download')).toHaveLength(1);
    expect(updater.get().phase).toBe('downloading');
  });

  it('wait for the click when the switch is off, or on a development build', async () => {
    const off = await freshStore();
    backend.update_check = info();
    off.start(() => false);
    await off.check();
    expect(off.get().phase).toBe('available');

    const dev = await freshStore();
    backend.update_check = info({ dev: true });
    dev.start(() => true);
    await dev.check();
    expect(dev.get().phase).toBe('available');
    expect(calls('update_download')).toHaveLength(0);
  });

  it('fetch the installer again when it went missing', async () => {
    const updater = await freshStore();
    backend.update_check = info({ ready: PATH });
    backend.update_download = new Promise(() => {});
    updater.start(() => true);
    await updater.check();
    backend.update_install = () => { throw 'gone'; };
    backend.update_check = info();
    await updater.install();
    expect(calls('update_download')).toHaveLength(1);
    expect(updater.get().phase).toBe('downloading');
  });
});

describe('a download', () => {
  it('can be cancelled: back to available, and its late answer is not an error', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    const download = deferred<string>();
    backend.update_download = download.promise;
    backend.update_cancel = undefined;
    await updater.check();
    const running = updater.download();
    await settle();
    emit(event({ received: 10 * MB }));
    expect(updater.get().progress).toEqual({ received: 10 * MB, total: 84 * MB });

    await updater.cancel();
    expect(calls('update_cancel')).toHaveLength(1);
    expect(updater.get()).toMatchObject({ phase: 'available', progress: null });
    emit(event({ received: 11 * MB }));
    download.reject('The download was cancelled.');
    emit(event({ state: 'cancelled', received: 11 * MB }));
    await running;
    await settle();
    expect(updater.get()).toMatchObject({ phase: 'available', error: null, progress: null });
  });

  it('started before a reload is shown again, and its end event finishes it', async () => {
    const updater = await freshStore();
    backend.update_status = { downloading: true, version: '1.0.2', received: 30 * MB, total: 84 * MB } satisfies UpdateStatus;
    backend.update_check = info();
    updater.start(() => true);
    await settle();
    expect(updater.get()).toMatchObject({ phase: 'downloading', progress: { received: 30 * MB, total: 84 * MB } });
    expect(updater.get().info?.latest).toBe('1.0.2');
    // Rejoining is not a second download.
    expect(calls('update_download')).toHaveLength(0);

    emit(event({ received: 40 * MB }));
    expect(updater.get().progress?.received).toBe(40 * MB);
    emit(event({ state: 'done', received: 84 * MB, path: PATH }));
    expect(updater.get()).toMatchObject({ phase: 'ready', progress: null });
    expect(updater.get().info?.ready).toBe(PATH);
  });

  it('started before a reload reports its failure and its cancel', async () => {
    const failing = await freshStore();
    backend.update_status = { downloading: true, version: '1.0.2', received: 1, total: null } satisfies UpdateStatus;
    backend.update_check = info();
    failing.start(() => false);
    await settle();
    emit(event({ state: 'failed', error: 'The download stopped' }));
    expect(failing.get()).toMatchObject({ phase: 'error', failed: 'download', error: 'The download stopped' });

    const cancelled = await freshStore();
    cancelled.start(() => false);
    await settle();
    emit(event({ state: 'cancelled' }));
    expect(cancelled.get()).toMatchObject({ phase: 'available', progress: null });
  });

  it('that updater.rs refuses because one is already running follows that one', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    await updater.check();
    backend.update_download = () => { throw 'An update is already downloading.'; };
    backend.update_status = { downloading: true, version: '1.0.2', received: 50 * MB, total: 84 * MB } satisfies UpdateStatus;
    await updater.download();
    expect(updater.get()).toMatchObject({ phase: 'downloading', error: null, progress: { received: 50 * MB, total: 84 * MB } });
    emit(event({ state: 'done', received: 84 * MB, path: PATH }));
    expect(updater.get().phase).toBe('ready');
    expect(updater.get().info?.ready).toBe(PATH);
  });

  it('this page started ends with its own call, whatever the events say first', async () => {
    const updater = await freshStore();
    backend.update_check = info();
    const download = deferred<string>();
    backend.update_download = download.promise;
    await updater.check();
    const running = updater.download();
    await settle();
    emit(event({ state: 'done', received: 84 * MB, path: PATH }));
    download.resolve(PATH);
    await running;
    expect(updater.get()).toMatchObject({ phase: 'ready', progress: null });
    expect(updater.get().info?.ready).toBe(PATH);
  });
});
