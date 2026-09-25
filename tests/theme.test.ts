import { describe, expect, it } from 'vitest';
import { GLASS_DEFAULTS, GLASS_IMAGES, glassImageUrl, resolveGlass, resolveTheme } from '../src/lib/theme';

describe('color theme resolution', () => {
  it('defaults unless minimal is explicitly chosen', () => {
    expect(resolveTheme(null)).toBe('default');
    expect(resolveTheme(undefined)).toBe('default');
    expect(resolveTheme({ theme: null })).toBe('default');
    expect(resolveTheme({ theme: 'default' })).toBe('default');
    expect(resolveTheme({ theme: 'neon' })).toBe('default');
  });
  it('selects the minimalist theme on explicit choice', () => {
    expect(resolveTheme({ theme: 'minimal' })).toBe('minimal');
  });
});

describe('glass look resolution', () => {
  it('fills everything from the defaults when nothing is saved', () => {
    expect(resolveGlass(null)).toEqual(GLASS_DEFAULTS);
    expect(resolveGlass({ appearance: null })).toEqual(GLASS_DEFAULTS);
  });
  it('keeps valid choices and clamps the sliders', () => {
    const glass = resolveGlass({ appearance: { glass: { source: 'image', image: 'desert-dusk', tint: '#10b981', tintAmount: 140, blur: -3, opacity: 55 } } });
    expect(glass).toMatchObject({ source: 'image', image: 'desert-dusk', tint: '#10b981', tintAmount: 100, blur: 0, opacity: 55 });
  });
  it('drops unknown presets, bad colours and a custom source with no picture', () => {
    const glass = resolveGlass({ appearance: { glass: { source: 'custom', customImage: null, gradient: 'neon', image: 'nope', tint: 'red' } } });
    expect(glass).toMatchObject({ source: 'gradient', gradient: GLASS_DEFAULTS.gradient, image: GLASS_DEFAULTS.image, tint: GLASS_DEFAULTS.tint });
  });
  it('ships a thumbnail-backed entry for each of the six pictures', () => {
    expect(GLASS_IMAGES).toHaveLength(6);
    expect(glassImageUrl('ocean-shore', true)).toBe('/wallpapers/ocean-shore-thumb.jpg');
  });
});
