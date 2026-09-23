import { describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { downloadPercent, downloadedText, updater, useUpdaterPick, type UpdateSnapshot } from '../src/lib/updater';
import { updateTitle, updateTone, updateView } from '../src/components/UpdateParts';
import { UpdateButton, UpdatePanel } from '../src/components/UpdateButton';
import { UpdateSection } from '../src/settings/UpdateSection';
import type { UpdateInfo } from '../src/lib/ipc';
import type { Settings } from '../src/lib/types';

const MB = 1024 ** 2;
const info = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current: '1.0.1',
  latest: '1.0.2',
  available: true,
  size: 84 * MB,
  notes: 'Faster exports.',
  uploadedAt: null,
  ready: null,
  dev: false,
  ...overrides,
});
const state = (phase: UpdateSnapshot['phase'], overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({
  phase,
  info: null,
  progress: null,
  error: null,
  failed: null,
  checkedAt: null,
  ...overrides,
});
/** The visible words: React's `<!-- -->` text-node separators go, tags become spaces. */
const text = (html: string) => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('download progress helpers', () => {
  it('gives a whole, rounded-down percent only when the size is known', () => {
    expect(downloadPercent(null)).toBeNull();
    expect(downloadPercent({ received: 5, total: null })).toBeNull();
    expect(downloadPercent({ received: 0, total: 0 })).toBeNull();
    expect(downloadPercent({ received: 50, total: 200 })).toBe(25);
    expect(downloadPercent({ received: 199, total: 200 })).toBe(99);
    expect(downloadPercent({ received: 250, total: 200 })).toBe(100);
  });

  it('says what has arrived, and of how much when known', () => {
    expect(downloadedText(null)).toBe('');
    expect(downloadedText({ received: 5 * MB, total: null })).toBe('5.0 MB');
    expect(downloadedText({ received: 21 * MB, total: 84 * MB })).toBe('21.0 MB of 84.0 MB');
  });
});

describe('updateView', () => {
  it('keeps "up to date" on screen while asking again', () => {
    expect(updateView(state('checking', { info: info({ available: false, latest: '1.0.1' }) }))).toEqual({ kind: 'current', rechecking: true });
    expect(updateView(state('checking'))).toEqual({ kind: 'checking' });
    expect(updateView(state('checking', { info: info() }))).toEqual({ kind: 'checking' });
    expect(updateView(state('idle'))).toEqual({ kind: 'idle' });
  });

  it('carries the download percent', () => {
    expect(updateView(state('downloading', { progress: { received: 21 * MB, total: 84 * MB } }))).toEqual({ kind: 'downloading', percent: 25 });
    expect(updateView(state('downloading', { progress: { received: MB, total: null } }))).toEqual({ kind: 'downloading', percent: null });
  });

  it('retries the step that failed, not the one the known state suggests', () => {
    // A check that failed with the installer already downloaded is still a failed check.
    expect(updateView(state('error', { info: info({ ready: 'C:/update.exe' }), failed: 'check' }))).toEqual({ kind: 'error', retry: 'check' });
    expect(updateView(state('error', { info: info(), failed: 'check' }))).toEqual({ kind: 'error', retry: 'check' });
    expect(updateView(state('error', { info: info({ ready: 'C:/update.exe' }), failed: 'install' }))).toEqual({ kind: 'error', retry: 'install' });
    expect(updateView(state('error', { info: info(), failed: 'download' }))).toEqual({ kind: 'error', retry: 'download' });
    expect(updateTitle(updateView(state('error', { info: info({ ready: 'C:/update.exe' }), failed: 'check' })), '1.0.2')).toBe('Couldn’t check for updates');
  });

  it('guesses the step from what is known only when none was recorded', () => {
    expect(updateView(state('error'))).toEqual({ kind: 'error', retry: 'check' });
    expect(updateView(state('error', { info: info() }))).toEqual({ kind: 'error', retry: 'download' });
    expect(updateView(state('error', { info: info({ ready: 'C:/update.exe' }) }))).toEqual({ kind: 'error', retry: 'install' });
  });

  it('names and tones each state', () => {
    expect(updateTitle({ kind: 'current', rechecking: false }, '1.0.1')).toBe('You’re on the latest version');
    expect(updateTitle({ kind: 'available' }, '1.0.2')).toBe('Helios 1.0.2 is available');
    expect(updateTitle({ kind: 'downloading', percent: 3 }, '1.0.2')).toBe('Downloading Helios 1.0.2');
    expect(updateTitle({ kind: 'ready' }, null)).toBe('A new Helios is ready');
    expect(updateTone({ kind: 'current', rechecking: false })).toBe('good');
    expect(updateTone({ kind: 'downloading', percent: null })).toBe('new');
    expect(updateTone({ kind: 'error', retry: 'check' })).toBe('bad');
    expect(updateTone({ kind: 'checking' })).toBe('idle');
  });
});

describe('UpdatePanel', () => {
  const render = (snapshot: UpdateSnapshot) => renderToString(React.createElement(UpdatePanel, { state: snapshot, onDetails: () => {} }));

  it('says you are on the latest version, with Check again', () => {
    const out = text(render(state('current', { info: info({ available: false, latest: '1.0.1' }) })));
    expect(out).toContain('You’re on the latest version');
    expect(out).toContain('Helios 1.0.1');
    expect(out).toContain('Check again');
    expect(out).toContain('Details');
  });

  it('offers the new version with its size and one Download button', () => {
    const html = render(state('available', { info: info() }));
    expect(text(html)).toContain('Helios 1.0.2 is available');
    expect(text(html)).toContain('You have 1.0.1 · 84.0 MB');
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(text(html)).toContain('Download');
  });

  it('shows the download bar with bytes and percent', () => {
    const html = render(state('downloading', { info: info(), progress: { received: 21 * MB, total: 84 * MB } }));
    expect(text(html)).toContain('Downloading Helios 1.0.2');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="25"');
    expect(text(html)).toContain('21.0 MB of 84.0 MB');
    expect(text(html)).toContain('25%');
    expect(html).toContain('is-dropping');
    expect(text(html)).toContain('Cancel download');
  });

  it('asks to restart once the installer is in', () => {
    const out = text(render(state('ready', { info: info({ ready: 'C:/update.exe' }) })));
    expect(out).toContain('Helios 1.0.2 is ready');
    expect(out).toContain('Restart and install');
    expect(out).toContain('Your project is saved first');
  });

  it('explains a failure and offers Try again', () => {
    const out = text(render(state('error', { info: info(), error: 'bhippi.com could not be reached', failed: 'download' })));
    expect(out).toContain('The download didn’t finish');
    expect(out).toContain('bhippi.com could not be reached');
    expect(out).toContain('Try again');
  });

  it('says a failed check is a failed check, even with the installer in', () => {
    const out = text(render(state('error', { info: info({ ready: 'C:/update.exe' }), error: 'bhippi.com could not be reached', failed: 'check' })));
    expect(out).toContain('Couldn’t check for updates');
    expect(out).not.toContain('The installer didn’t start');
  });
});

describe('the title-bar button and the About card follow the store', () => {
  const settings = { autoUpdate: true } as Settings;
  const button = () => renderToString(React.createElement(UpdateButton, { onDetails: () => {} }));

  it('is a plain download button before anything is known', () => {
    const html = button();
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('lucide-download');
    expect(html).not.toContain('upd-dot');
    expect(html).not.toContain('upd-ring');
  });

  it('gets a dot when a newer version is out, and a ring while it downloads', async () => {
    invoke.mockImplementation((command: string) => (command === 'update_check' ? Promise.resolve(info()) : new Promise(() => {})));
    await updater.check();
    expect(button()).toContain('upd-dot new');

    void updater.download();
    expect(updater.get().phase).toBe('downloading');
    const html = button();
    expect(html).toContain('upd-ring');
    expect(html).toContain('is-dropping');
    expect(html).not.toContain('upd-dot');

    const card = renderToString(React.createElement(UpdateSection, { version: '1.0.1', settings, onSettings: () => {} }));
    expect(card).toContain('role="progressbar"');
    expect(text(card)).toContain('Cancel download');
    expect(text(card)).not.toContain('Check for updates');
    expect(text(card)).toContain('What’s new in 1.0.2');
    expect(text(card)).toContain('Download updates automatically');
    expect(card).toMatch(/type="checkbox" checked=""/);
  });

  it('lets the app read one plain value from the store', () => {
    const Phase = () => React.createElement('b', null, useUpdaterPick((snapshot) => snapshot.phase));
    expect(renderToString(React.createElement(Phase))).toBe('<b>downloading</b>');
  });
});
