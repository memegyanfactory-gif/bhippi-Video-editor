import { describe, expect, it } from 'vitest';
import catalog from '../src/lib/caption-styles.json';
import { SYSTEM_FONTS } from '../src/lib/brandKit/build';
import { buildMotionGraphic, mogrtCanvas, usesCompCanvas } from '../src/lib/motionGraphics';
import { CARD_TEMPLATES, ROAST_TEXT_STYLES, type CardTemplateId } from '../src/lib/roast/types';
import { ROAST_CARD_IMAGE_PARAMS, ROAST_CARD_SPECS, buildRoastCard, cardCanvas, isRoastCardTemplate, rememberCardImage } from '../src/lib/roast/cards';

const LAND = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SAMPLE: Record<CardTemplateId, Record<string, unknown>> = {
  'roast-article-card': { headline: 'Actor quits film after one day', source: 'Daily Planet', date: '1 Sep 2026', image: PIXEL, highlight: 'after one day' },
  'roast-then-now': { then: PIXEL, now: PIXEL, thenLabel: 'THEN', nowLabel: 'NOW' },
  'roast-fact-strip': { text: 'The film has a runtime of 2h 54m.', highlight: 'runtime of 2h 54m', source: 'IMDb' },
  'roast-profile-card': { name: 'Anjali Arora', handle: '@anjaliarora', followers: 13400000, posts: 912, following: 280, avatar: PIXEL, bio: 'Actor' },
  'roast-poster-card': { image: PIXEL, title: 'Ramayana' },
  'roast-sticker-badge': { text: 'NO HATE', shape: 'heart' },
  'roast-title-card': { text: 'YOU ARE THE / REASON', photo: PIXEL },
  'roast-cta-fire': { text: 'COMMENT DOWN BELOW' },
};
const WORDS: Record<CardTemplateId, string[]> = {
  'roast-article-card': ['Actor quits film', 'Daily Planet', 'after one day'],
  'roast-then-now': ['THEN', 'NOW'],
  'roast-fact-strip': ['runtime of 2h 54m', 'IMDb'],
  'roast-profile-card': ['Anjali Arora', 'anjaliarora', '13.4M', '912'],
  'roast-poster-card': [],
  'roast-sticker-badge': ['NO', 'HATE'],
  'roast-title-card': ['YOU', 'ARE', 'THE', 'REASON'],
  'roast-cta-fire': ['COMMENT', 'DOWN', 'BELOW'],
};

const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'system-ui', 'inherit']);
/** Every family named in font-family declarations and font shorthands. */
function families(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/font-family:([^;}"]+(?:"[^"]*"[^;}"]*)*)/g)) out.push(...m[1].split(','));
  return out.map((f) => f.trim().replace(/^["']|["']$/g, '')).filter((f) => f && !GENERIC.has(f));
}

describe('roast cards', () => {
  it('specs every contract card, with its params', () => {
    expect(ROAST_CARD_SPECS.map((spec) => spec.id)).toEqual([...CARD_TEMPLATES]);
    for (const spec of ROAST_CARD_SPECS) {
      expect(spec.use.length, spec.id).toBeGreaterThan(60);
      expect(spec.params.length, spec.id).toBeGreaterThan(0);
      expect(spec.seconds, spec.id).toBeGreaterThan(0);
      for (const name of ROAST_CARD_IMAGE_PARAMS[spec.id]) if (name !== 'image' || spec.id !== 'roast-title-card') expect(spec.params.map((p) => p.name), spec.id).toContain(name);
      expect(isRoastCardTemplate(spec.id)).toBe(true);
      expect(usesCompCanvas(spec.id)).toBe(true);
    }
    expect(isRoastCardTemplate('lower-third')).toBe(false);
  });

  it('designs on the comp canvas, like every Crimson graphic', () => {
    for (const comp of [LAND, TALL, { width: 1080, height: 1080 }, { width: 3840, height: 2160 }]) expect(cardCanvas(comp)).toEqual(mogrtCanvas(comp));
  });

  it('builds an html clip source with its words, box and template, wide and tall', () => {
    for (const id of CARD_TEMPLATES) {
      for (const comp of [LAND, TALL]) {
        const card = buildRoastCard(id, SAMPLE[id], comp);
        expect(card.type).toBe('html');
        expect(card.template).toBe(id);
        expect(card.title.length, id).toBeGreaterThan(3);
        expect(card.html.startsWith('<div class="rc"'), id).toBe(true);
        for (const word of WORDS[id]) expect(card.html.toUpperCase(), `${id} ${word}`).toContain(word.toUpperCase());
        const { x, y, width, height } = card.box;
        expect(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.0001 && y + height <= 1.0001, `${id} ${JSON.stringify(card.box)}`).toBe(true);
        // Placed pixels stay on the design canvas.
        const canvas = cardCanvas(comp);
        for (const m of card.html.matchAll(/(?:left|top):(-?[\d.]+)px/g)) expect(Number(m[1]), id).toBeLessThanOrEqual(Math.max(canvas.width, canvas.height));
      }
    }
  });

  it('keeps the export contract: paused, time-scrubbed CSS, no scripts, no network, system fonts', () => {
    for (const id of CARD_TEMPLATES) {
      const card = buildRoastCard(id, { ...SAMPLE[id], image: 'https://example.com/x.jpg', avatar: 'http://example.com/a.png' }, LAND);
      const all = `${card.html}\n${card.css}`;
      expect(all, id).not.toMatch(/backdrop-filter/i);
      expect(all, id).not.toMatch(/url\(\s*['"]?https?:/i);
      expect(all, id).not.toMatch(/<script|<img\s|@import|@font-face|<iframe|<video|<link/i);
      expect(all, id).not.toMatch(/animation-play-state:\s*running|transition:/i);
      expect(card.js ?? '', id).toBe('');
      // Every animation is paused and driven by --elapsed (via --t) or the exit clock (--exit).
      expect(card.css).toContain('--t:calc(var(--elapsed,0) * -1s)');
      for (const m of card.css.matchAll(/animation:([^;}]+)/g)) expect(m[1], id).toMatch(/paused/);
      for (const m of card.css.matchAll(/animation-delay:([^;}]+)/g)) expect(m[1], id).toMatch(/var\(--(t|exit)\)/);
      for (const family of families(all)) expect(SYSTEM_FONTS, `${id} font ${family}`).toContain(family);
    }
  });

  it('embeds pictures as data URLs and refuses web ones', () => {
    const inline = buildRoastCard('roast-poster-card', { image: PIXEL }, LAND);
    expect(inline.html).toContain('data:image/png;base64');
    const web = buildRoastCard('roast-poster-card', { image: 'https://example.com/poster.jpg', title: 'Fallback' }, LAND);
    expect(web.html).not.toContain('example.com');
    expect(web.html).toContain('Fallback');
    // A path inlined ahead of the build is referenced by its data URL.
    rememberCardImage('C:/media/poster.jpg', PIXEL);
    expect(buildRoastCard('roast-poster-card', { image: 'C:/media/poster.jpg' }, LAND).html).toContain('data:image/png;base64');
  });

  it('escapes the copy it is given', () => {
    const card = buildRoastCard('roast-fact-strip', { text: '<script>alert(1)</script> & "quotes"' }, LAND);
    expect(card.html).not.toContain('<script>');
    expect(card.html).toContain('&lt;script&gt;');
  });

  it('splits the title card into a white line and a yellow punchword', () => {
    const slash = buildRoastCard('roast-title-card', { text: 'YOU ARE THE / REASON' }, LAND);
    expect(slash.html).toMatch(/tc-yellow[^>]*>REASON</);
    const last = buildRoastCard('roast-title-card', { text: 'I love India!', accent: '#00ff88' }, LAND);
    expect(last.html).toMatch(/tc-yellow[^>]*color:#00ff88[^>]*>INDIA!</);
    expect(buildRoastCard('roast-title-card', { line1: 'Top', line2: 'Bottom' }, TALL).html).toMatch(/>BOTTOM</);
  });

  it('draws every sticker shape and respects the placement words', () => {
    for (const shape of ['heart', 'burst', 'badge', 'circle']) expect(buildRoastCard('roast-sticker-badge', { text: 'FACT', shape }, LAND).html, shape).toContain('<svg');
    const left = buildRoastCard('roast-article-card', { headline: 'x', placement: 'left' }, LAND).box;
    const right = buildRoastCard('roast-article-card', { headline: 'x', placement: 'right' }, LAND).box;
    expect(left.x + left.width).toBeLessThan(0.5);
    expect(right.x).toBeGreaterThan(0.5);
    const strip = buildRoastCard('roast-fact-strip', { text: 'x' }, TALL).box;
    // Above the bottom 18% a phone app keeps for its own buttons.
    expect(strip.y + strip.height).toBeLessThanOrEqual(0.82 + 1e-6);
  });

  it('builds through create_motion_graphic\'s builder too', () => {
    const bundle = buildMotionGraphic({ template: 'roast-fact-strip', title: 'Runtime 2h 54m', canvas: mogrtCanvas(LAND), params: { highlight: '2h 54m' } });
    expect(bundle.template).toBe('roast-fact-strip');
    expect(bundle.html).toContain('Runtime');
    expect(bundle.box?.width).toBeGreaterThan(0);
  });

  it('refuses an unknown card', () => {
    expect(() => buildRoastCard('roast-nope' as CardTemplateId, {}, LAND)).toThrow(/Unknown roast card/);
  });
});

describe('roast keyword text styles', () => {
  const styles = catalog.styles;
  const keys = Object.keys(styles[0]).sort();

  it('adds the contract styles in a Meme category, on the shared schema', () => {
    expect(catalog.categories).toContain('Meme');
    for (const id of ROAST_TEXT_STYLES) {
      const style = styles.find((s) => s.id === id);
      expect(style, id).toBeTruthy();
      expect(Object.keys(style!).sort(), id).toEqual(keys);
      expect(style!.category).toBe('Meme');
      expect(SYSTEM_FONTS, id).toContain(style!.font);
      expect(Number.isInteger(style!.weight), id).toBe(true);
      for (const colour of [style!.color, style!.outline, style!.glow, style!.color2].filter(Boolean)) expect(colour, id).toMatch(/^#[0-9A-F]{8}$/);
    }
    expect(new Set(styles.map((s) => s.id)).size).toBe(styles.length);
  });

  it('gives each style its look', () => {
    const find = (id: string) => styles.find((s) => s.id === id)!;
    const meme = find('memeImpact');
    expect([meme.font, meme.color, meme.outline, meme.uppercase]).toEqual(['Impact', '#FFE600FF', '#000000FF', true]);
    expect(meme.outlineWidth * 0.05).toBeCloseTo(0.1); // stroke ≈ 10% of the size (caption_styles.rs: bord = fs·0.05·outlineWidth)
    expect(meme.shadow).toBe(true);
    const pop = find('roundedPop');
    expect(['Segoe UI Black', 'Arial Black']).toContain(pop.font);
    expect(pop.color).toBe('#FFFFFFFF');
    expect(pop.glow?.startsWith('#000000')).toBe(true);
    const label = find('labelStar');
    expect(label.size).toBeLessThan(meme.size);
    const fire = find('fireCta');
    expect([fire.font, fire.gradient, fire.uppercase]).toEqual(['Impact', true, true]);
    expect(fire.glow).toBeTruthy();
  });

  it('has an emoji style for emoji pops (a glyph font, preview only in colour)', () => {
    const emoji = styles.find((s) => s.id === 'emojiPop')!;
    expect(emoji.font).toMatch(/emoji/i);
    expect(emoji.outline).toBeNull();
    expect(Object.keys(emoji).sort()).toEqual(keys);
  });
});
