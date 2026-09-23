import { describe, expect, it } from 'vitest';
import { BrandKitSettings, applyDaisyTheme, archetypeLabel, cardMotion, chipsFromText, contrastBadge, linesFromText, nextKitName, sanitizeSvgMarkup } from '../src/settings/BrandKitSettings';
import { ARCHETYPES, newBrandKit } from '../src/lib/brandKit';

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
  it('labels archetype cards without the group suffix', () => {
    expect(archetypeLabel('Luban (reference)')).toBe('Luban');
    expect(archetypeLabel('Crimson (house)')).toBe('Crimson');
    expect(archetypeLabel('Editorial')).toBe('Editorial');
  });
  it('turns an archetype motion spec into card custom properties', () => {
    for (const arch of ARCHETYPES) {
      const vars = cardMotion(arch.motion);
      expect(vars['--bk-ease']).toBe(arch.motion.easing);
      expect(Number.parseFloat(vars['--bk-enter'])).toBeGreaterThanOrEqual(0.24);
      expect(Number.parseFloat(vars['--bk-enter'])).toBeLessThanOrEqual(1.1);
      expect(Number.parseFloat(vars['--bk-stagger'])).toBeGreaterThanOrEqual(0.04);
      expect(vars['--bk-lift'].endsWith('px')).toBe(true);
    }
  });
  it('exports the component', () => {
    expect(typeof BrandKitSettings).toBe('function');
  });
});
