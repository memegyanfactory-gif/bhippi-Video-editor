import { describe, expect, it } from 'vitest';
import { BrandKitSettings, applyDaisyTheme, chipsFromText, contrastBadge, linesFromText, nextKitName, sanitizeSvgMarkup } from '../src/settings/BrandKitSettings';
import { newBrandKit } from '../src/lib/brandKit';

describe('Brand kit settings helpers', () => {
  it('splits chips and lines', () => {
    expect(chipsFromText(' a, b ,,c\nd ')).toEqual(['a', 'b', 'c', 'd']);
    expect(linesFromText('one\n\n two \nthree')).toEqual(['one', 'two', 'three']);
  });
  it('sanitises pasted SVG', () => {
    const svg = sanitizeSvgMarkup('<?xml version="1.0"?><svg onload="alert(1)" viewBox="0 0 1 1"><script>x()</script><circle r="1"/></svg>');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('onload');
  });
  it('grades contrast', () => {
    expect(contrastBadge('#ffffff', '#000000')).toMatchObject({ level: 'good' });
    expect(contrastBadge('#777777', '#555555').level).toBe('bad');
  });
  it('names duplicates without collisions', () => {
    expect(nextKitName('Acme', [])).toBe('Acme copy');
    expect(nextKitName('Acme', ['Acme copy'])).toBe('Acme copy 2');
  });
  it('applies a DaisyUI theme to a kit', () => {
    const kit = applyDaisyTheme(newBrandKit({ brandName: 'X' }), 'synthwave');
    expect(kit.colors.daisyTheme).toBe('synthwave');
    expect(applyDaisyTheme(kit, 'nope').colors.daisyTheme).toBe('synthwave');
  });
  it('exports the component', () => {
    expect(typeof BrandKitSettings).toBe('function');
  });
});
