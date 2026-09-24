import { describe, expect, it } from 'vitest';
import { layoutText, retypedAt, typedAt } from '../src/motion/text';
import type { TextLayerData } from '../src/motion/types';

const measure = (text: string) => text.length * 10;
const shown = (data: TextLayerData, t: number) => layoutText(data, t, measure).glyphs.filter((g) => g.opacity > 0.01).map((g) => g.ch).join('');

describe('live typing', () => {
  it('types at the given rate from `at`', () => {
    const ty = { at: 1, cps: 10 };
    expect(typedAt(ty, 'Hello', 0.9).text).toBe('');
    expect(typedAt(ty, 'Hello', 1.0).text).toBe('H');
    expect(typedAt(ty, 'Hello', 1.25).text).toBe('HEL'.slice(0, 1) + 'el');
    expect(typedAt(ty, 'Hello', 5).text).toBe('Hello');
  });
  it('runs scripts: type, wait, backspace, retype (search cycles)', () => {
    const ty = { at: 0, cps: 10, backspaceCps: 20, script: [{ type: 'Top tech' }, { wait: 0.5 }, { backspace: 4 }, { type: 'ERP' }] };
    expect(typedAt(ty, '', 0.85).text).toBe('Top tech');
    // Backspaces at 20/s from 1.3 s: three by 1.4 s.
    expect(typedAt(ty, '', 1.4).text).toBe('Top t');
    expect(typedAt(ty, '', 10).text).toBe('Top ERP');
  });
  it('types a word at a time for fast prompts', () => {
    const ty = { at: 0, cps: 50, chunk: 'word' as const };
    expect(typedAt(ty, 'What can we optimize', 0.01).text).toBe('What ');
  });
  it('lays out only what is typed, so a centred line re-centres as it grows', () => {
    const data: TextLayerData = { text: 'Hello', align: 'center', type: { at: 0, cps: 10, fadeIn: 0 } };
    const early = layoutText(data, 0.15, measure);
    const late = layoutText(data, 1, measure);
    expect(early.glyphs.length).toBe(2);
    expect(late.glyphs.length).toBe(5);
    expect(early.width).toBeLessThan(late.width);
  });
  it('feathers the edge, colours the front and blinks a caret', () => {
    const data: TextLayerData = { text: 'abcdef', color: '#ffffff', type: { at: 0, cps: 10, fadeIn: 0, edge: 2, front: { color: '#8b5cf6', chars: 3 }, caret: 'bar', blink: 2 } };
    const f = layoutText(data, 0.55, measure);
    const letters = f.glyphs.filter((g) => g.ch !== '|');
    expect(letters.map((g) => g.ch).join('')).toBe('abcdef');
    expect(letters[5].opacity).toBeCloseTo(1 / 3, 3);
    expect(letters[4].opacity).toBeCloseTo(2 / 3, 3);
    expect(letters[5].color).toBe('#8b5cf6');
    expect(letters[2].color).toBe('#ffffff');
    const caret = f.glyphs[f.glyphs.length - 1];
    expect(caret.ch).toBe('|');
    // Idle long enough: the caret blinks off half the time.
    const off = [1.0, 1.25, 1.5, 1.75].map((t) => layoutText(data, t, measure).glyphs.at(-1)!.opacity);
    expect(off.some((o) => o === 0)).toBe(true);
    expect(off.some((o) => o > 0)).toBe(true);
  });
  it('retypes left to right and flashes the changed letters', () => {
    const r = retypedAt('Your customers', { to: 'No questions.', at: 0, cps: 10 }, 0.35);
    expect(r.text.startsWith('No ')).toBe(true);
    const data: TextLayerData = { text: 'cat', color: '#ffffff', retype: { to: 'car', at: 0, cps: 10, flash: '#b09aff' } };
    const f = layoutText(data, 0.31, measure);
    expect(f.glyphs.map((g) => g.ch).join('')).toBe('car');
    expect(f.glyphs[2].color).not.toBe('#ffffff');
    expect(f.glyphs[0].color).toBe('#ffffff');
  });
  it('scatters glyphs and brings them home', () => {
    const data: TextLayerData = { text: 'AI', scatter: { at: 0, duration: 0.5, spread: 300 } };
    const start = layoutText(data, 0.01, measure);
    const end = layoutText(data, 2, measure);
    expect(Math.abs(start.glyphs[0].dx) + Math.abs(start.glyphs[0].dy)).toBeGreaterThan(20);
    expect(end.glyphs[0].dx).toBeCloseTo(0, 5);
    expect(shown(data, 2)).toBe('AI');
  });
});

describe('line spacing and exit order', () => {
  it('collapses lines as lineSpacing goes to 0', () => {
    const open = layoutText({ text: 'Chat\nWith our\nAI Bot', lineSpacing: 100 }, 0, measure);
    const shut = layoutText({ text: 'Chat\nWith our\nAI Bot', lineSpacing: 0 }, 0, measure);
    const ys = (f: ReturnType<typeof layoutText>) => [...new Set(f.glyphs.map((g) => Math.round(g.y)))];
    expect(ys(open).length).toBe(3);
    expect(ys(shut).length).toBe(1);
  });
  it('exits in reverse order', () => {
    const data: TextLayerData = { text: 'many', cascade: { by: 'char', stagger: 0, duration: 0.01, from: { opacity: 100 }, exit: { at: 1, duration: 0.1, stagger: 0.2, order: 'reverse', to: { opacity: 0 } } } };
    const f = layoutText(data, 1.15, measure);
    expect(f.glyphs[3].opacity).toBeLessThan(0.01);
    expect(f.glyphs[0].opacity).toBeGreaterThan(0.99);
  });
});
