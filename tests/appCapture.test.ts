import { describe, expect, it } from 'vitest';
import { BHIPPI_PARTS, captureKey, parseSteps, resolveSelector, sheetParts, standinSource, type CaptureManifest } from '../src/lib/appCapture';

describe('capture sessions', () => {
  it('turns Bhippi part names into its real selectors', () => {
    expect(resolveSelector('@send')).toBe(BHIPPI_PARTS.send);
    expect(resolveSelector('.my-button')).toBe('.my-button');
    expect(resolveSelector('@nothing')).toBe('@nothing');
  });

  it('checks each step and says what to fix', () => {
    const { steps, problems } = parseSteps([
      { do: 'type', selector: '@field', text: 'Cut my clips on the beat', part: 'composer', partSelector: '@composer' },
      { do: 'click', selector: '@send' },
      { do: 'capture', part: 'timeline', selector: '@timeline', state: 'filled' },
      { do: 'fly' },
      { do: 'click' },
    ]);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ do: 'type', selector: BHIPPI_PARTS.field, partSelector: BHIPPI_PARTS.composer });
    expect(problems.join(' ')).toContain('"fly" is not an action');
    expect(problems.join(' ')).toContain('click needs a selector');
  });

  it('keys a session so the same capture of the same app version is reused', () => {
    const request = { name: 'bhippi', steps: parseSteps([{ do: 'capture', part: 'send', selector: '@send' }]).steps };
    expect(captureKey(request, '1.0.8')).toBe(captureKey({ ...request }, '1.0.8'));
    expect(captureKey(request, '1.0.9')).not.toBe(captureKey(request, '1.0.8'));
    expect(captureKey({ ...request, scale: 4 }, '1.0.8')).not.toBe(captureKey(request, '1.0.8'));
  });
});

describe('the stand-in for Bhippi\'s backend', () => {
  /** Runs the stand-in in a fresh fake window and returns its bridge. */
  const bridge = (answers: Record<string, unknown>) => {
    const fakeWindow: Record<string, unknown> = { innerWidth: 1920, innerHeight: 1080 };
    new Function('window', standinSource(answers).replace('{{FILES}}', 'http://127.0.0.1:9/f/'))(fakeWindow);
    return fakeWindow.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>; convertFileSrc: (path: string) => string; transformCallback: (fn: (data: unknown) => void) => number };
  };

  it('answers the UI from the real app state, lists empty, the rest null', async () => {
    const tauri = bridge({ settings_get: { theme: 'default', onboarded: true } });
    expect(await tauri.invoke('settings_get')).toEqual({ theme: 'default', onboarded: true });
    expect(await tauri.invoke('jobs_list')).toEqual([]);
    expect(await tauri.invoke('something_new')).toBeNull();
    expect(await tauri.invoke('plugin:window|inner_size')).toEqual({ width: 1920, height: 1080 });
  });

  it('serves local files from the capture server, backslashes and all', () => {
    const tauri = bridge({});
    expect(tauri.convertFileSrc('C:\\Users\\a\\thumb.png')).toBe(`http://127.0.0.1:9/f/${encodeURIComponent('C:/Users/a/thumb.png')}`);
  });

  it('lets the UI listen for events', async () => {
    const tauri = bridge({});
    const handler = tauri.transformCallback(() => undefined);
    expect(await tauri.invoke('plugin:event|listen', { event: 'jobs', handler })).toBe(1);
  });
});

describe('the contact sheet of parts', () => {
  it('shows each part\'s states, and typing as first, middle and last', () => {
    const part = (name: string, state: string) => ({ part: name, state, file: `${name}__${state}.png`, boxCss: [0, 0, 10, 10] as [number, number, number, number], pixels: [30, 30] as [number, number] });
    const manifest: CaptureManifest = {
      key: null, url: 'x', width: 1920, height: 1080, scale: 3, issues: [], dir: 'C:/p',
      parts: [part('send', 'idle'), part('send', 'pressed'), ...Array.from({ length: 11 }, (_, i) => part('composer', `t${String(i).padStart(2, '0')}`))],
    };
    const shown = sheetParts(manifest).flat().map((entry) => `${entry.part}:${entry.state}`);
    expect(shown).toEqual(['send:idle', 'send:pressed', 'composer:t00', 'composer:t05', 'composer:t10']);
  });
});
