// The Settings › Brand kit preview (and render_brand_board) draw brandBoard() through
// HtmlMotionLayer: runtime HTML whose look lives in a <style> element and style="" attributes.
// Both regressions here left the preview a black frame of tiny unstyled text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, brandBoard, brandKitTheme, fontStack, newBrandKit } from '../src/lib/brandKit';

const root = join(__dirname, '..');

/** The attributes of the first tag in `html`, read the way the HTML tokenizer reads them. */
function firstTagAttributes(html: string): [string, string][] {
  const open = html.indexOf('<');
  let i = html.indexOf(' ', open);
  const attrs: [string, string][] = [];
  const decode = (v: string) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  while (i < html.length) {
    while (/\s/.test(html[i])) i++;
    if (html[i] === '>' || html[i] === '/') break;
    let name = '';
    do name += html[i++]; while (i < html.length && !/[\s/>=]/.test(html[i]));
    let value = '';
    if (html[i] === '=') {
      i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, i + 1);
        value = html.slice(i + 1, end);
        i = end + 1;
      } else {
        while (i < html.length && !/[\s>]/.test(html[i])) value += html[i++];
      }
    }
    attrs.push([name.toLowerCase(), decode(value)]);
  }
  return attrs;
}

describe('brand board markup', () => {
  it('keeps every CSS variable on the board root, font stacks with quotes included', () => {
    const kits = [newBrandKit({ style: 'organic-earth', brandName: 'Organic Earth' }), ...ARCHETYPES.map((a) => newBrandKit({ style: a.id, brandName: a.name }))];
    for (const kit of kits) {
      const theme = brandKitTheme(kit);
      const attrs = firstTagAttributes(brandBoard(kit).html);
      // Only class and style: a quote inside the style value would end it and spill the rest
      // of the declarations out as junk attributes ("palatino", "linotype\",", …).
      expect(attrs.map(([name]) => name), kit.name).toEqual(['class', 'style']);
      const style = attrs[1][1];
      expect(style).toContain('--u:1.0000');
      expect(style).toContain(`--bg:${theme.bg}`);
      expect(style).toContain(`--fg:${theme.fg}`);
      expect(style).toContain(`--accent:${theme.accent}`);
      expect(style).toContain(`--bk-display:${fontStack(kit.typography.display)}`);
      expect(style).toContain(`--bk-body:${fontStack(kit.typography.body)}`);
    }
  });
});

describe('runtime motion-graphic styles and the app CSP', () => {
  it('leaves style-src as written, so inline <style> and style="" in graphics are allowed', () => {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const security = conf.app.security;
    const styleSrc: string = security.csp['style-src'];
    expect(styleSrc).toContain("'unsafe-inline'");
    // Tauri nonces every <style> in the bundled HTML and adds that nonce to style-src
    // (tauri-utils html::inject_nonce_token, tauri manager::replace_csp_nonce). A nonce in
    // style-src makes the browser ignore 'unsafe-inline', which blocks every motion graphic's
    // <style> and style="" — unless Tauri is told to leave style-src alone.
    const off = security.dangerousDisableAssetCspModification;
    const tauriModifiesStyleSrc = off === true ? false : Array.isArray(off) ? !off.includes('style-src') : true;
    const indexHasStyle = /<style[\s>]/i.test(readFileSync(join(root, 'index.html'), 'utf8'));
    expect(tauriModifiesStyleSrc && indexHasStyle).toBe(false);
  });
});
