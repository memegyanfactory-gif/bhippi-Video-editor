// The editor's keyboard commands (src/lib/keymap.ts): what a key press runs, and changing keys.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindingOf, commandFor, COMMANDS, conflicts, display, findCommand, keymapFrom, normalizeBinding, overridesOf, refuseBinding, usersOf, type KeyLike } from '../src/lib/keymap';

/** A keydown as the browser reports it: `key` is what the layout types, `code` the physical key. */
const press = (key: string, code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyLike =>
  ({ key, code, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt });

const defaults = keymapFrom(null);

describe('what a key press runs, with the default keys', () => {
  it('a longer chord is not taken by the plain-Ctrl one on the same key', () => {
    expect(commandFor(defaults, press('X', 'KeyX', { ctrl: true, shift: true }))).toBe('clearInOut');
    expect(commandFor(defaults, press('O', 'KeyO', { ctrl: true, shift: true }))).toBe('clearOut');
    expect(commandFor(defaults, press('I', 'KeyI', { ctrl: true, shift: true }))).toBe('clearIn');
    expect(commandFor(defaults, press('M', 'KeyM', { ctrl: true, shift: true }))).toBe('previousMarker');
    expect(commandFor(defaults, press('m', 'KeyM', { ctrl: true, alt: true }))).toBe('clearMarker');
    expect(commandFor(defaults, press('M', 'KeyM', { ctrl: true, alt: true, shift: true }))).toBe('clearAllMarkers');
    expect(commandFor(defaults, press('r', 'KeyR', { ctrl: true, alt: true }))).toBe('rectangle');
  });

  it('the plain-Ctrl chords and bare keys do what they did', () => {
    expect(commandFor(defaults, press('x', 'KeyX', { ctrl: true }))).toBe('cut');
    expect(commandFor(defaults, press('/', 'Slash', { ctrl: true }))).toBe('newFolder');
    expect(commandFor(defaults, press('Z', 'KeyZ', { ctrl: true, shift: true }))).toBe('redo');
    expect(commandFor(defaults, press(' ', 'Space'))).toBe('playToggle');
    expect(commandFor(defaults, press(' ', 'Space', { ctrl: true, shift: true }))).toBe('playInToOut');
    expect(commandFor(defaults, press('ArrowLeft', 'ArrowLeft', { shift: true }))).toBe('stepBack5');
    expect(commandFor(defaults, press('ArrowLeft', 'ArrowLeft', { alt: true }))).toBe('nudgeLeft');
    expect(commandFor(defaults, press('Backspace', 'Backspace', { shift: true }))).toBe('rippleDelete');
    expect(commandFor(defaults, press('c', 'KeyC'))).toBe('toolRazor');
    expect(commandFor(defaults, press('+', 'NumpadAdd'))).toBe('zoomIn');
    expect(commandFor(defaults, press('+', 'Equal', { shift: true }))).toBe('allTaller');
  });

  it('reads shifted digits and symbols from the physical key, whatever the layout types', () => {
    expect(commandFor(defaults, press('?', 'Slash', { ctrl: true, shift: true }))).toBe('duplicate');
    expect(commandFor(defaults, press('#', 'Digit3', { shift: true }))).toBe('panel3');
    expect(commandFor(defaults, press('(', 'Digit9', { shift: true }))).toBeNull();
    expect(commandFor(defaults, press('3', 'Digit3'))).toBeNull();
    // An AZERTY "a" is the physical Q key: it runs what Q runs.
    expect(commandFor(defaults, press('a', 'KeyQ'))).toBe('rippleTrimPrevious');
  });

  it('a modifier on its own is not a key', () => {
    expect(bindingOf(press('Control', 'ControlLeft', { ctrl: true }))).toBeNull();
    expect(bindingOf(press('Shift', 'ShiftLeft', { shift: true }))).toBeNull();
  });

  it('only file and app commands work without an open project', () => {
    expect(findCommand('open')?.app).toBe(true);
    expect(findCommand('duplicate')?.app).toBeFalsy();
  });
});

describe('the command list', () => {
  it('has unique ids, and no two commands share a default key', () => {
    expect(new Set(COMMANDS.map((item) => item.id)).size).toBe(COMMANDS.length);
    expect([...conflicts(defaults).keys()]).toEqual([]);
    for (const item of COMMANDS) for (const key of item.keys) expect(normalizeBinding(key), `${item.id}: ${key}`).toBe(key);
  });

  it('every command is carried out by the editor', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    for (const item of COMMANDS) {
      if (/^panel\d$/.test(item.id)) continue;
      expect(app.includes(`case '${item.id}':`), `App.tsx does not handle ${item.id}`).toBe(true);
    }
  });
});

describe('changing keys', () => {
  it('saves only what differs from the defaults, and reads it back', () => {
    const map = keymapFrom(null);
    map.toolRazor = ['Ctrl+Alt+C'];
    map.snap = [];
    const saved = overridesOf(map);
    expect(saved).toEqual({ toolRazor: ['Ctrl+Alt+C'], snap: [] });
    const back = keymapFrom(saved);
    expect(back.toolRazor).toEqual(['Ctrl+Alt+C']);
    expect(back.snap).toEqual([]);
    expect(back.undo).toEqual(['Ctrl+Z']);
    expect(commandFor(back, press('c', 'KeyC', { ctrl: true, alt: true }))).toBe('toolRazor');
    expect(commandFor(back, press('c', 'KeyC'))).toBeNull();
    expect(commandFor(back, press('s', 'KeyS'))).toBeNull();
  });

  it('names the command a key is already used by', () => {
    const map = keymapFrom(null);
    expect(usersOf(map, 'Ctrl+K', 'toolRazor').map((item) => item.id)).toEqual(['addEdit']);
    expect(usersOf(map, 'Ctrl+K', 'addEdit')).toEqual([]);
    expect(usersOf(map, 'Ctrl+Alt+J')).toEqual([]);
    map.toolRazor = ['C', 'Ctrl+K'];
    expect(conflicts(map).get('Ctrl+K')?.map((item) => item.id)).toEqual(['toolRazor', 'addEdit']);
  });

  it('writes keys one way, and refuses the ones Windows keeps', () => {
    expect(normalizeBinding('shift+ctrl+s')).toBe('Ctrl+Shift+S');
    expect(normalizeBinding('Ctrl+Num+')).toBe('Ctrl+Num+');
    expect(normalizeBinding('Hyper+S')).toBeNull();
    expect(refuseBinding('Alt+F4')).toMatch(/closes the window/);
    expect(refuseBinding('Ctrl+Alt+J')).toBeNull();
    expect(display('Shift+Left')).toBe('Shift+←');
    expect(display('Ctrl+Num+')).toBe('Ctrl+Num+');
  });

  it('ignores saved keys it cannot read, and old ids', () => {
    const map = keymapFrom({ toolRazor: ['Hyper+C', 'Alt+C'], gone: ['X'] });
    expect(map.toolRazor).toEqual(['Alt+C']);
    expect('gone' in map).toBe(false);
  });
});
