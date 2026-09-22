import { describe, expect, it } from 'vitest';
import {
  DAISY_THEMES, DAISY_THEME_IDS, contrastRatio, daisyThemeSummary, daisyThemeToBrandColors, findDaisyTheme,
  hexToRgb, mixHex, oklchToHex, parseOklch, relativeLuminance,
} from '../src/lib/brandKit/daisyThemes';
import type { DaisyTheme } from '../src/lib/brandKit/daisyThemes';
import type { ColorRole } from '../src/lib/brandKit/types';

const HEX = /^#[0-9A-F]{6}$/;
const COLOR_ROLES: ColorRole[] = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'success', 'warning', 'error', 'info', 'neutral', 'custom'];
const EXPECTED_IDS = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
  'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black', 'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
  'night', 'coffee', 'winter', 'dim', 'nord', 'sunset', 'caramellatte', 'abyss', 'silk',
];

const textOnBackground = (theme: DaisyTheme): number => contrastRatio(theme.colors.baseContent, theme.colors.base100);

describe('DaisyUI theme catalogue', () => {
  it('has all 35 DaisyUI v5 themes with unique ids, in DaisyUI order', () => {
    expect(DAISY_THEMES).toHaveLength(35);
    expect(new Set(DAISY_THEMES.map((t) => t.id)).size).toBe(35);
    expect(DAISY_THEMES.map((t) => t.id)).toEqual(EXPECTED_IDS);
    expect(DAISY_THEME_IDS).toEqual(EXPECTED_IDS);
  });

  it('gives every colour as 6-digit uppercase hex', () => {
    for (const theme of DAISY_THEMES) {
      const entries = Object.entries(theme.colors);
      expect(entries, theme.id).toHaveLength(20);
      for (const [key, hex] of entries) expect(hex, `${theme.id}.${key}`).toMatch(HEX);
    }
  });

  it('carries both schemes, with DaisyUI counts (21 light, 14 dark)', () => {
    const light = DAISY_THEMES.filter((t) => t.scheme === 'light');
    const dark = DAISY_THEMES.filter((t) => t.scheme === 'dark');
    expect(light.length).toBe(21);
    expect(dark.length).toBe(14);
    expect(light.length + dark.length).toBe(DAISY_THEMES.length);
  });

  it('keeps the shape values DaisyUI ships', () => {
    for (const theme of DAISY_THEMES) {
      for (const v of [theme.radius.selector, theme.radius.field, theme.radius.box, theme.size.selector, theme.size.field]) expect(v, theme.id).toMatch(/^\d*\.?\d+rem$/);
      expect(theme.border, theme.id).toMatch(/^\d+px$/);
      expect(typeof theme.depth).toBe('boolean');
      expect(typeof theme.noise).toBe('boolean');
      expect(theme.name.length, theme.id).toBeGreaterThan(0);
      expect(theme.character.length, theme.id).toBeGreaterThan(10);
      expect(theme.industries.length, theme.id).toBeGreaterThanOrEqual(2);
      expect(theme.industries.length, theme.id).toBeLessThanOrEqual(3);
    }
    expect(findDaisyTheme('cyberpunk')?.radius).toEqual({ selector: '0rem', field: '0rem', box: '0rem' });
    expect(findDaisyTheme('caramellatte')?.noise).toBe(true);
    expect(findDaisyTheme('light')?.depth).toBe(true);
    expect(findDaisyTheme('dracula')?.depth).toBe(false);
  });

  it('matches the hex values DaisyUI documents for well-known themes', () => {
    const light = findDaisyTheme('light')!;
    expect(light.colors.base100).toBe('#FFFFFF');
    expect(light.colors.primary).toBe('#422AD5');
    expect(light.colors.secondary).toBe('#F43098');
    expect(light.colors.accent).toBe('#00D3BB');
    expect(findDaisyTheme('dark')!.colors.base100).toBe('#1D232A');
    expect(findDaisyTheme('dark')!.colors.primary).toBe('#605DFF');
    expect(findDaisyTheme('dracula')!.colors.base100).toBe('#282A36');
    expect(findDaisyTheme('dracula')!.colors.primary).toBe('#FF79C6');
    expect(findDaisyTheme('nord')!.colors.base100).toBe('#ECEFF4');
    expect(findDaisyTheme('nord')!.colors.primary).toBe('#5E81AC');
    expect(findDaisyTheme('night')!.colors.base100).toBe('#0F172A');
  });
});

describe('findDaisyTheme', () => {
  it('finds by id case-insensitively', () => {
    expect(findDaisyTheme('Synthwave')?.id).toBe('synthwave');
    expect(findDaisyTheme('SYNTHWAVE')?.scheme).toBe('dark');
    expect(findDaisyTheme('  synthwave ')?.name).toBe('Synthwave');
  });
  it('also accepts the display name and rejects unknowns', () => {
    expect(findDaisyTheme('Caramel Latte')?.id).toBe('caramellatte');
    expect(findDaisyTheme('CMYK')?.id).toBe('cmyk');
    expect(findDaisyTheme('Lo-Fi')?.id).toBe('lofi');
    expect(findDaisyTheme('nope')).toBeUndefined();
    expect(findDaisyTheme('')).toBeUndefined();
  });
});

describe('daisyThemeToBrandColors', () => {
  const dark = findDaisyTheme('dark')!;
  const colors = daisyThemeToBrandColors(dark);

  it('yields at least 12 tokens whose roles come from the ColorRole union, all hex', () => {
    expect(colors.tokens.length).toBeGreaterThanOrEqual(12);
    for (const t of colors.tokens) {
      expect(COLOR_ROLES, t.name).toContain(t.role);
      expect(t.hex, t.name).toMatch(HEX);
      expect(t.usage.length, t.name).toBeGreaterThan(10);
      expect(t.name.length).toBeGreaterThan(0);
    }
    const roles = new Set(colors.tokens.map((t) => t.role));
    for (const r of ['primary', 'secondary', 'accent', 'neutral', 'background', 'surface', 'text', 'muted', 'info', 'success', 'warning', 'error']) expect(roles, r).toContain(r);
  });

  it('maps DaisyUI roles onto the brand roles', () => {
    const byRole = (role: ColorRole) => colors.tokens.find((t) => t.role === role)!.hex;
    expect(byRole('background')).toBe(dark.colors.base100);
    expect(byRole('surface')).toBe(dark.colors.base200);
    expect(byRole('text')).toBe(dark.colors.baseContent);
    expect(byRole('primary')).toBe(dark.colors.primary);
    expect(byRole('accent')).toBe(dark.colors.accent);
    expect(byRole('error')).toBe(dark.colors.error);
    const muted = byRole('muted');
    expect(muted).toMatch(HEX);
    expect(muted).not.toBe(dark.colors.baseContent);
    expect(muted).not.toBe(dark.colors.base100);
    // Muted sits between the text and the page in luminance.
    const [lo, hi] = [relativeLuminance(dark.colors.base100), relativeLuminance(dark.colors.baseContent)].sort((a, b) => a - b);
    expect(relativeLuminance(muted)).toBeGreaterThan(lo);
    expect(relativeLuminance(muted)).toBeLessThan(hi);
  });

  it('has the two gradients, rules, and the daisyTheme back-reference', () => {
    expect(colors.gradients).toHaveLength(2);
    expect(colors.gradients[0]).toMatchObject({ angle: 135, stops: [dark.colors.primary, dark.colors.secondary] });
    expect(colors.gradients[1]).toMatchObject({ angle: 90, stops: [dark.colors.accent, dark.colors.primary] });
    for (const g of colors.gradients) for (const s of g.stops) expect(s).toMatch(HEX);
    expect(colors.rules.length).toBeGreaterThanOrEqual(3);
    expect(colors.rules.length).toBeLessThanOrEqual(4);
    expect(colors.rules[0]).toMatch(/^Dark scheme/);
    expect(daisyThemeToBrandColors(findDaisyTheme('light')!).rules[0]).toMatch(/^Light scheme/);
    expect(colors.daisyTheme).toBe('dark');
    expect(colors.openPropsHue).toBeNull();
  });

  it('computes real WCAG ratios for the three pairs', () => {
    expect(colors.pairs.map((p) => p.use)).toEqual(['text on background', 'primary-content on primary', 'accent-content on accent']);
    for (const p of colors.pairs) {
      expect(p.fg).toMatch(HEX);
      expect(p.bg).toMatch(HEX);
      expect(p.ratio).toBe(contrastRatio(p.fg, p.bg));
      expect(p.ratio).toBeGreaterThanOrEqual(1);
      expect(p.ratio).toBeLessThanOrEqual(21);
    }
    expect(colors.pairs[0].ratio).toBeCloseTo(14.75, 1);
  });
});

describe('text-on-background contrast is at least 3:1 in every theme', () => {
  for (const theme of DAISY_THEMES) {
    it(`${theme.id}: ${theme.colors.baseContent} on ${theme.colors.base100}`, () => {
      const pair = daisyThemeToBrandColors(theme).pairs.find((p) => p.use === 'text on background')!;
      expect(pair.ratio).toBe(textOnBackground(theme));
      expect(pair.ratio, `${theme.id} text on background is ${pair.ratio}:1`).toBeGreaterThanOrEqual(3);
    });
  }
  it('reports every theme below 3:1 at once', () => {
    const failing = DAISY_THEMES.filter((t) => textOnBackground(t) < 3).map((t) => `${t.id} (${textOnBackground(t)}:1)`);
    expect(failing, `themes with text-on-background below 3:1: ${failing.join(', ')}`).toEqual([]);
  });
});

describe('daisyThemeSummary', () => {
  it('is one line containing the name, scheme and key hexes', () => {
    for (const theme of DAISY_THEMES) {
      const s = daisyThemeSummary(theme);
      expect(s).toContain(theme.name);
      expect(s).toContain(theme.scheme);
      expect(s).toContain(theme.colors.primary);
      expect(s).toContain(theme.colors.base100);
      expect(s).not.toContain('\n');
    }
    expect(daisyThemeSummary(findDaisyTheme('synthwave')!)).toContain('Synthwave');
  });
});

describe('colour maths', () => {
  it('converts OKLCH to hex the way DaisyUI documents its colours', () => {
    expect(parseOklch('oklch(45% 0.24 277.023)')).toBe('#422AD5');
    expect(parseOklch('oklch(45% 0.24 277.023)')).toBe(findDaisyTheme('light')!.colors.primary);
    expect(parseOklch('oklch(25.33% 0.016 252.42)')).toBe('#1D232A');
    expect(parseOklch('oklch(0.4533 0.24 277.023)')).toMatch(HEX);
    expect(parseOklch('oklch(45% 0.24 277.023 / 0.5)')).toBe('#422AD5');
    expect(parseOklch('#422ad5')).toBeNull();
    expect(parseOklch('hsl(200 50% 50%)')).toBeNull();
  });
  it('handles the achromatic axis and clamps out-of-gamut chroma per channel', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#FFFFFF');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    const grey = hexToRgb(oklchToHex(0.5, 0, 123))!;
    expect(Math.abs(grey[0] - grey[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(grey[1] - grey[2])).toBeLessThanOrEqual(1);
    // Acid's primary is far outside sRGB (chroma 0.357); it must still come back as valid hex.
    expect(oklchToHex(0.719, 0.357, 330.759)).toBe(findDaisyTheme('acid')!.colors.primary);
    expect(oklchToHex(0.719, 0.357, 330.759)).toMatch(HEX);
    expect(oklchToHex(2, 5, 0)).toBe('#FFFFFF');
    expect(oklchToHex(-1, 5, 0)).toBe('#000000');
  });
  it('implements WCAG relative luminance and contrast', () => {
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });
  it('parses hex leniently and mixes in sRGB', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('18181B')).toEqual([24, 24, 27]);
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('not a colour')).toBeNull();
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#FF0000', '#0000FF', 0.5)).toBe('#800080');
  });
});
