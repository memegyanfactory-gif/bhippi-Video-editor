import { describe, expect, it } from 'vitest';
import { APP_CHORDS, chordAction, type KeyLike } from '../src/lib/chords';

/** A keydown as the browser reports it: `key` is what the layout types, `code` the physical key. */
const press = (key: string, code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyLike =>
  ({ key, code, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt });

describe('modifier chords', () => {
  it('a longer chord is not taken by the plain-Ctrl one on the same key', () => {
    expect(chordAction(press('X', 'KeyX', { ctrl: true, shift: true }))).toBe('clearInOut');
    expect(chordAction(press('O', 'KeyO', { ctrl: true, shift: true }))).toBe('clearOut');
    expect(chordAction(press('I', 'KeyI', { ctrl: true, shift: true }))).toBe('clearIn');
    expect(chordAction(press('M', 'KeyM', { ctrl: true, shift: true }))).toBe('previousMarker');
    expect(chordAction(press('m', 'KeyM', { ctrl: true, alt: true }))).toBe('clearMarker');
    expect(chordAction(press('M', 'KeyM', { ctrl: true, alt: true, shift: true }))).toBe('clearAllMarkers');
    expect(chordAction(press('r', 'KeyR', { ctrl: true, alt: true }))).toBe('rectangle');
    expect(chordAction(press('e', 'KeyE', { ctrl: true, alt: true }))).toBe('ellipse');
  });

  it('the plain-Ctrl chords still do what they did', () => {
    expect(chordAction(press('x', 'KeyX', { ctrl: true }))).toBe('cut');
    expect(chordAction(press('o', 'KeyO', { ctrl: true }))).toBe('open');
    expect(chordAction(press('i', 'KeyI', { ctrl: true }))).toBe('import');
    expect(chordAction(press('m', 'KeyM', { ctrl: true }))).toBe('export');
    expect(chordAction(press('r', 'KeyR', { ctrl: true }))).toBe('speed');
    expect(chordAction(press('e', 'KeyE', { ctrl: true }))).toBe('editOriginal');
    expect(chordAction(press('/', 'Slash', { ctrl: true }))).toBe('newFolder');
    expect(chordAction(press('Z', 'KeyZ', { ctrl: true, shift: true }))).toBe('redo');
  });

  it('reads shifted digits and the slash from the physical key', () => {
    expect(chordAction(press('?', 'Slash', { ctrl: true, shift: true }))).toBe('duplicate');
    expect(chordAction(press('#', 'Digit3', { shift: true }))).toBe('panel3');
    expect(chordAction(press('!', 'Digit1', { shift: true }))).toBe('panel1');
    expect(chordAction(press('(', 'Digit9', { shift: true }))).toBeNull();
    expect(chordAction(press('3', 'Digit3'))).toBeNull();
  });

  it('only file and app chords work without an open project', () => {
    expect(APP_CHORDS.has('open')).toBe(true);
    expect(APP_CHORDS.has('duplicate')).toBe(false);
    expect(APP_CHORDS.has('clearInOut')).toBe(false);
  });
});
