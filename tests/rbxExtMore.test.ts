import { describe, expect, it } from 'vitest';
import { ACETERNITY_BITS } from '../src/lib/rbx/ext/aceternity';
import { MAGIC_UI_BITS } from '../src/lib/rbx/ext/magicUi';
import { UIVERSE_BITS } from '../src/lib/rbx/ext/uiverse';
import { EXTENSION_BITS, REACT_BITS, UI_LIBRARY, buildReactBitsGraphic, findBit, libraryCounts, listBits } from '../src/lib/rbx';

const SETS = [
  { name: 'Magic UI', bits: MAGIC_UI_BITS, prefix: 'mu-', source: 'magic-ui', min: 50 },
  { name: 'Aceternity', bits: ACETERNITY_BITS, prefix: 'ace-', source: 'aceternity', min: 50 },
  { name: 'Uiverse', bits: UIVERSE_BITS, prefix: 'uv-', source: 'uiverse', min: 40 },
];

describe('Magic UI, Aceternity and Uiverse pieces', () => {
  for (const set of SETS) {
    it(`${set.name}: ${set.bits.length} pieces, prefixed, sourced and export-safe`, () => {
      expect(set.bits.length).toBeGreaterThanOrEqual(set.min);
      for (const bit of set.bits) {
        expect(bit.id, bit.name).toMatch(new RegExp(`^${set.prefix}[a-z0-9]+(-[a-z0-9]+)*$`));
        expect(bit.source).toBe(set.source);
        for (const props of [{}, bit.example]) {
          for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
            const built = buildReactBitsGraphic({ bit: bit.id, props, title: 'Motion is not difficult', subtitle: 'A line under it', rows: ['One — a', 'Two — b', 'Three — c'], values: [10, 40, 80], canvas });
            expect('error' in built, `${bit.id} ${JSON.stringify(props)}`).toBe(false);
            if ('error' in built) continue;
            expect(built.html.length, bit.id).toBeGreaterThan(80);
            expect(built.css).toContain('animation-play-state:paused');
            expect(built.css, bit.id).not.toMatch(/backdrop-filter/);
            expect(built.html + built.css, bit.id).not.toMatch(/url\(["']?https?:/);
            expect(built.html, bit.id).not.toMatch(/<img\b|<video\b|<canvas\b|<script\b|<iframe\b/);
            expect(built.html, bit.id).not.toMatch(/undefined|NaN/);
            expect(built.box.x + built.box.width).toBeLessThanOrEqual(1.0001);
            expect(built.box.y + built.box.height).toBeLessThanOrEqual(1.0001);
          }
        }
      }
    });
  }

  it('registers everything once in the shared library with no id collisions', () => {
    const ids = UI_LIBRARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(UI_LIBRARY.length).toBe(REACT_BITS.length + EXTENSION_BITS.length);
    const counts = libraryCounts();
    expect(counts['react-bits']).toBe(205);
    expect(counts['animate-css']).toBeGreaterThanOrEqual(90);
    expect(counts['open-props']).toBeGreaterThanOrEqual(50);
    expect(counts['magic-ui']).toBe(MAGIC_UI_BITS.length);
    expect(counts['aceternity']).toBe(ACETERNITY_BITS.length);
    expect(counts['uiverse']).toBe(UIVERSE_BITS.length);
    expect(findBit('mu-marquee')?.source).toBe('magic-ui');
    expect(findBit('ace-lamp-effect')?.source).toBe('aceternity');
    expect(findBit('uv-neon-button')?.source).toBe('uiverse');
    expect(findBit('Lamp Effect')?.id).toBe('ace-lamp-effect');
    expect(listBits({ source: 'uiverse', category: 'background' }).every((b) => b.id.startsWith('uv-'))).toBe(true);
    expect(listBits({ query: 'button' }).some((b) => b.source === 'uiverse')).toBe(true);
  });

  it('composes pieces from different libraries in one graphic', () => {
    const built = buildReactBitsGraphic({ background: 'ace-aurora-background', layers: [{ bit: 'mu-sparkles-text', props: { text: 'Hello' }, at: 0.2 }, { bit: 'uv-neon-button', props: { text: 'Play' }, layout: 'lower-third', at: 1 }, { bit: 'ac-bounce-in-up', layout: 'top-right', at: 1.5 }], title: 'Mix', duration: 6 });
    expect('error' in built).toBe(false);
    if ('error' in built) return;
    expect(built.bits).toEqual(['ace-aurora-background', 'mu-sparkles-text', 'uv-neon-button', 'ac-bounce-in-up']);
    expect(built.css).toContain('@keyframes mu-twinkle');
    expect(built.css).toContain('uv-neon');
  });
});
