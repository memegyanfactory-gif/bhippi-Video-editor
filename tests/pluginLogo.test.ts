import { describe, expect, it } from 'vitest';
import { LOGO_FILE, logoImage } from '../src/plugins/logo';
import { validateDraft } from '../src/plugins/drafts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const wrapped = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><image href="${href}" width="256" height="256"/></svg>\n`;

describe('plugin logos', () => {
  it('reads back the picture from a logo the Maker made', () => {
    expect(logoImage(wrapped(png))).toBe(png);
  });

  it('refuses anything else: scripts, remote images, other SVG', () => {
    expect(logoImage(wrapped('https://example.com/x.png'))).toBeNull();
    expect(logoImage(wrapped('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='))).toBeNull();
    expect(logoImage(wrapped(png).replace('</svg>', '<script>alert(1)</script></svg>'))).toBeNull();
    expect(logoImage('<svg onload="alert(1)"></svg>')).toBeNull();
    expect(logoImage(undefined)).toBeNull();
  });

  it('a draft with a logo.svg that is not one fails validation', () => {
    const files = {
      'manifest.json': JSON.stringify({ name: 'Logo test' }),
      'index.html': '<div>hi</div>',
      [LOGO_FILE]: '<svg onload="alert(1)"></svg>',
    };
    expect(validateDraft(files, new Set()).problems.some((problem) => problem.includes(LOGO_FILE))).toBe(true);
    expect(validateDraft({ ...files, [LOGO_FILE]: wrapped(png) }, new Set()).problems.some((problem) => problem.includes(LOGO_FILE))).toBe(false);
  });
});
