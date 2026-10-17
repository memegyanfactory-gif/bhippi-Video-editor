import { describe, expect, it } from 'vitest';
import { applyParsed, emptyBrief, parseBrief, type Brief } from '../src/lib/brandKit/brief';
import {
  PAIRINGS, archetypeDistance, sameLook, buildDirectionKit, colorName, ensureContrast, fixColors, generateDirections, hexToHsl, hslToHex, motionFor, pickThree, rankArchetypes, seedColors, traitsOf, voiceFor, wordmarkSvg,
} from '../src/lib/brandKit/directions';
import { ARCHETYPES, SYSTEM_FONTS, contrastRatio, validateBrandKit, findArchetype } from '../src/lib/brandKit';
import { brandSwatches, colorsInSvg, extractPalette, vividSwatches } from '../src/lib/brandKit/palette';

const briefOf = (text: string, patch: Partial<Brief> = {}): Brief => ({ ...applyParsed(emptyBrief(), parseBrief(text)), ...patch });

const BAKERY = 'A playful kids\' bakery in Mumbai called "Sunny Crumbs" with a hand-drawn feel, warm pinks';
const FINTECH = 'A serious, trustworthy fintech for first-time investors, clean and modern';
const FILM = 'A moody film studio called "Nightfall Pictures", cinematic and bold';

describe('parseBrief', () => {
  it('reads the name, industry, audience, city, feeling words and colours out of one sentence', () => {
    const p = parseBrief(BAKERY);
    expect(p.name).toBe('Sunny Crumbs');
    expect(p.industry).toBe('Bakery & café');
    expect(p.audience).toBe('Kids and their parents');
    expect(p.city).toBe('India');
    expect(p.words).toEqual(expect.arrayContaining(['Playful', 'Warm', 'Hand-drawn']));
    expect(p.sliders.serious!).toBeLessThan(0.3);
    expect(p.sliders.cool!).toBeLessThan(0.4);
    expect(p.colorHints).toContain('#F472B6');
  });

  it('finds a name after "called" without quotes, and ignores "we are a bakery"', () => {
    expect(parseBrief('A coffee roaster called Ember & Oak for night owls').name).toBe('Ember & Oak');
    expect(parseBrief('We are a bakery in Paris').name).toBeUndefined();
    expect(parseBrief('We are Pixel Bloom, a design studio').name).toBe('Pixel Bloom');
  });

  it('pushes the sliders the right way for serious, minimal, modern text', () => {
    const p = parseBrief(FINTECH);
    expect(p.sliders.serious!).toBeGreaterThan(0.7);
    expect(p.sliders.modern!).toBeGreaterThan(0.7);
    expect(p.industry).toBe('Fintech & finance');
    expect(parseBrief('a classic, timeless bookshop').sliders.modern!).toBeLessThan(0.3);
  });

  it('detects dark mode and an empty text parses to nothing', () => {
    expect(parseBrief(FILM).mode).toBe('dark');
    const none = parseBrief('   ');
    expect(none.words).toEqual([]);
    expect(none.name).toBeUndefined();
  });

  it('applyParsed only replaces what the text said', () => {
    const base = { ...emptyBrief(), name: 'Keep', audience: 'Mine' };
    const out = applyParsed(base, parseBrief('a playful bakery'));
    expect(out.name).toBe('Keep');
    expect(out.audience).toBe('Mine');
    expect(out.sliders.serious).toBeLessThan(0.5);
    expect(out.sliders.modern).toBe(0.5);
  });
});

describe('traits', () => {
  it('measures the extremes where they should be', () => {
    const t = (id: string) => traitsOf(findArchetype(id)!);
    expect(t('kids-bright').serious).toBeLessThan(0.4);
    expect(t('luxury-serif').serious).toBeGreaterThan(0.6);
    expect(t('minimal-mono').expressive).toBeLessThan(t('neon-cyber').expressive);
    expect(t('luxury-serif').modern).toBeLessThan(t('tech-gradient').modern);
    expect(t('warm-craft').cool).toBeLessThan(t('fintech-navy').cool);
    expect(t('cinematic-dark').dark).toBe(1);
    expect(t('warm-craft').dark).toBe(0);
  });

  it('keeps every trait inside 0…1', () => {
    for (const a of ARCHETYPES) for (const k of ['serious', 'expressive', 'cool', 'modern'] as const) {
      const v = traitsOf(a)[k];
      expect(v, `${a.id} ${k}`).toBeGreaterThanOrEqual(0);
      expect(v, `${a.id} ${k}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('ranking and picking three', () => {
  it('ranks the obvious archetype first for obvious briefs', () => {
    expect(rankArchetypes(briefOf(BAKERY))[0].archetype.id).toMatch(/warm-craft|playful-pastel|kids-bright|ref-kozymart/);
    expect(rankArchetypes(briefOf(FINTECH)).slice(0, 4).map((r) => r.archetype.id)).toEqual(expect.arrayContaining(['fintech-navy']));
    expect(rankArchetypes(briefOf(FILM)).slice(0, 3).map((r) => r.archetype.id)).toContain('cinematic-dark');
  });

  it('is deterministic', () => {
    const a = pickThree(briefOf(BAKERY)).map((p) => p.archetype.id);
    const b = pickThree(briefOf(BAKERY)).map((p) => p.archetype.id);
    expect(a).toEqual(b);
  });

  it('picks three different archetypes that are far apart', () => {
    for (const text of [BAKERY, FINTECH, FILM, 'a calm wellness studio in Copenhagen', 'neon esports crew called Voltage, loud and electric', '']) {
      const three = pickThree(briefOf(text));
      expect(three).toHaveLength(3);
      expect(new Set(three.map((t) => t.archetype.id)).size).toBe(3);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        expect(archetypeDistance(three[i].archetype, three[j].archetype), `${text}: ${three[i].archetype.id} vs ${three[j].archetype.id}`).toBeGreaterThan(0.3);
      }
    }
  });

  it('keeps the best-fitting archetype among the three', () => {
    for (const text of [BAKERY, FINTECH, FILM]) {
      const brief = briefOf(text);
      expect(pickThree(brief)[0].archetype.id).toBe(rankArchetypes(brief)[0].archetype.id);
    }
  });
});

describe('generateDirections', () => {
  for (const [label, text] of [['kids bakery', BAKERY], ['fintech', FINTECH], ['film studio', FILM]] as const) {
    it(`gives three valid, distinct directions for the ${label}`, () => {
      const brief = briefOf(text);
      const dirs = generateDirections(brief);
      expect(dirs).toHaveLength(3);
      expect(new Set(dirs.map((d) => d.title)).size).toBe(3);
      expect(new Set(dirs.map((d) => d.archetypeId)).size).toBe(3);
      expect(new Set(dirs.map((d) => d.palettes[0].colors.primary)).size).toBeGreaterThan(1);
      for (const d of dirs) {
        expect(validateBrandKit(d.kit), d.title).toEqual([]);
        expect(d.rationale.length).toBeGreaterThan(20);
        expect(d.kit.name).toBe(brief.name || 'My brand');
        expect(d.kit.logos[0]?.svg).toContain('<svg');
        expect(d.palettes).toHaveLength(3);
        expect(d.pairings).toHaveLength(3);
        expect(new Set(d.pairings.map((p) => p.display)).size).toBe(3);
        expect(d.kit.voiceGuide.samples.length).toBeGreaterThan(1);
        expect(d.kit.style).toBe(d.archetypeId);
      }
    });
  }

  it('keeps contrast at AA on every palette variant', () => {
    for (const text of [BAKERY, FINTECH, FILM]) {
      for (const d of generateDirections(briefOf(text, { colorHints: ['#facc15', '#38bdf8'] }))) {
        for (const p of d.palettes) {
          const c = p.colors;
          expect(contrastRatio(c.text, c.bg), `${d.title}/${p.id} text`).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(c.text, c.surface), `${d.title}/${p.id} text on surface`).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(c.primary, c.bg), `${d.title}/${p.id} primary`).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(c.accent, c.bg), `${d.title}/${p.id} accent`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('only uses system-safe fonts', () => {
    for (const p of PAIRINGS) for (const f of [p.display, p.heading, p.body, p.caption]) expect(SYSTEM_FONTS, p.id).toContain(f);
    for (const d of generateDirections(briefOf(BAKERY))) for (const p of d.pairings) for (const f of [p.display, p.heading, p.body, p.caption]) expect(SYSTEM_FONTS, `${d.title} ${p.label}`).toContain(f);
  });

  it('blends the colours the person owns (the logo colour leads the first direction)', () => {
    const brief = briefOf(FINTECH, { logoColors: ['#ff3d71'], logo: { svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff3d71"/></svg>', label: 'logo.svg' } });
    expect(seedColors(brief)[0]).toBe('#ff3d71');
    const [first, second] = generateDirections(brief);
    const hue = (hex: string) => hexToHsl(hex).h;
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(gap(hue(first.palettes[0].colors.primary), hue('#ff3d71'))).toBeLessThan(25);
    const withoutSeed = generateDirections(briefOf(FINTECH))[0];
    expect(gap(hue(first.palettes[0].colors.primary), hue('#ff3d71'))).toBeLessThan(gap(hue(withoutSeed.palettes[0].colors.primary), hue('#ff3d71')));
    expect(second).toBeTruthy();
  });

  it('uses the person\'s own logo instead of a wordmark', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle onclick="x()" r="4" fill="#123456"/></svg>';
    const dirs = generateDirections(briefOf(BAKERY, { logo: { svg, label: 'mine.svg' } }));
    for (const d of dirs) {
      expect(d.logo.generated).toBe(false);
      expect(d.kit.logos[0].svg).toContain('<circle');
      expect(d.kit.logos[0].svg).not.toMatch(/<script|onclick/);
    }
  });

  it('keeps a raster logo as a data URL', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const [d] = generateDirections(briefOf(BAKERY, { logo: { dataUrl, label: 'mine.png' } }));
    expect(d.kit.logos[0].dataUrl).toBe(dataUrl);
  });

  it('tunes motion by the sliders: playful and expressive moves faster with more bounce than serious and minimal', () => {
    const lively = generateDirections(briefOf('', { sliders: { serious: 0.05, expressive: 0.95, cool: 0.5, modern: 0.5 } }));
    const grave = generateDirections(briefOf('', { sliders: { serious: 0.95, expressive: 0.05, cool: 0.5, modern: 0.5 } }));
    const mean = (ds: typeof lively) => ds.reduce((s, d) => s + d.kit.motionGuide.enter, 0) / ds.length;
    expect(mean(lively)).toBeLessThan(mean(grave));
    expect(lively.reduce((s, d) => s + d.energy, 0)).toBeGreaterThan(grave.reduce((s, d) => s + d.energy, 0));
  });

  it('writes different voices for playful and serious briefs, with the name in the samples', () => {
    const arch = findArchetype('warm-craft')!;
    const playful = voiceFor(briefOf(BAKERY), arch, 0);
    const serious = voiceFor(briefOf('"Ledgerline" fintech', { sliders: { serious: 0.9, expressive: 0.3, cool: 0.6, modern: 0.7 } }), arch, 0);
    expect(playful.tone).toContain('playful');
    expect(serious.tone).toContain('assured');
    expect(serious.avoid).toContain('exclamation marks');
    expect(playful.avoid).toContain('corporate jargon');
    expect(playful.samples.some((s) => s.includes('Sunny Crumbs'))).toBe(true);
    expect(new Set([...playful.samples, ...serious.samples]).size).toBeGreaterThan(3);
    expect(voiceFor(briefOf(BAKERY), arch, 1).samples).not.toEqual(playful.samples);
  });

  it('rebuilds the kit for a refinement: palette, pairing and energy', () => {
    const [d] = generateDirections(briefOf(FINTECH));
    const a = buildDirectionKit(d, { palette: 0, pairing: 0, energy: 0.1 });
    const b = buildDirectionKit(d, { palette: 1, pairing: 1, energy: 0.95 });
    expect(a.kit.colors.tokens.find((t) => t.role === 'background')!.hex).toBe(d.palettes[0].colors.bg);
    expect(b.kit.colors.tokens.find((t) => t.role === 'background')!.hex).toBe(d.palettes[1].colors.bg);
    expect(b.kit.typography.display.family).toBe(d.pairings[1].display);
    expect(a.kit.motionGuide.intensity).toBe('calm');
    expect(b.kit.motionGuide.intensity).toBe('energetic');
    expect(b.kit.motionGuide.enter).toBeLessThan(a.kit.motionGuide.enter);
    expect(validateBrandKit(b.kit)).toEqual([]);
  });

  it('works on an empty brief and with a very long name', () => {
    expect(generateDirections(emptyBrief())).toHaveLength(3);
    const long = generateDirections(briefOf('', { name: 'The Extraordinarily Long Named Company & Sons Ltd' }));
    expect(long[0].kit.logos[0].svg).toContain('Extraordinarily');
    expect(validateBrandKit(long[0].kit)).toEqual([]);
  });
});

describe('small helpers', () => {
  it('motionFor spans a glide to a bounce', () => {
    expect(motionFor(0).intensity).toBe('calm');
    expect(motionFor(1).intensity).toBe('energetic');
    expect(motionFor(1).easing).toContain('1.56');
    expect(motionFor(0).enter).toBeGreaterThan(motionFor(1).enter);
  });

  it('ensureContrast and fixColors repair weak pairs', () => {
    expect(contrastRatio(ensureContrast('#fde68a', '#ffffff', 3), '#ffffff')).toBeGreaterThanOrEqual(3);
    const fixed = fixColors({ bg: '#ffffff', surface: '#f5f5f5', text: '#cccccc', muted: '#dddddd', primary: '#ffee00', accent: '#eeeeee', accent2: '#ffff99' });
    expect(contrastRatio(fixed.text, fixed.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(fixed.primary, fixed.bg)).toBeGreaterThanOrEqual(3);
  });

  it('round-trips hsl and names colours', () => {
    expect(hslToHex(hexToHsl('#3b5bff').h, hexToHsl('#3b5bff').s, hexToHsl('#3b5bff').l)).toBe('#3b5bff');
    expect(colorName('#111111')).toBe('ink black');
    expect(colorName('#2563eb')).toBe('blue');
  });

  it('escapes the name in a wordmark', () => {
    const svg = wordmarkSvg({ name: 'A<b> & "C"', family: 'Georgia', weight: 700, transform: 'none', tracking: '0em', color: '#111111', accent: '#ff0000', style: 'dot' });
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&amp;');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe('palette extraction', () => {
  const px = (rgb: number[], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat();

  it('finds the dominant colours of a flat two-colour image', () => {
    const data = new Uint8ClampedArray([...px([220, 30, 40], 700), ...px([20, 40, 200], 300)]);
    const palette = extractPalette(data, 2);
    expect(palette).toHaveLength(2);
    expect(palette[0].hex).toBe('#dc1e28');
    expect(palette[0].share).toBeCloseTo(0.7, 1);
    expect(palette[1].hex).toBe('#1428c8');
  });

  it('ignores transparent pixels and handles an empty image', () => {
    const data = new Uint8ClampedArray([...px([255, 0, 0], 50), ...Array.from({ length: 200 }, () => [0, 255, 0, 0]).flat()]);
    expect(extractPalette(data, 3).map((p) => p.hex)).toEqual(['#ff0000']);
    expect(extractPalette(new Uint8ClampedArray(0))).toEqual([]);
  });

  it('puts vivid colours ahead of big neutral fields and merges near-duplicates', () => {
    const data = new Uint8ClampedArray([...px([245, 245, 245], 800), ...px([250, 250, 250], 100), ...px([255, 90, 120], 60), ...px([255, 95, 125], 40)]);
    const swatches = brandSwatches(extractPalette(data, 6), 3);
    expect(swatches[0]).toMatch(/^#ff[56]/);
    expect(swatches.filter((s) => /^#f[ef]f[ef]f[ef]$/i.test(s)).length).toBeLessThanOrEqual(1);
    expect(vividSwatches(extractPalette(data, 6)).length).toBeLessThanOrEqual(2);
  });

  it('reads colours written into an SVG', () => {
    expect(colorsInSvg('<svg><path fill="#FF3D71"/><path fill="#ff3d71"/><rect style="fill:#123"/><circle stroke="#00aa55"/></svg>')).toEqual(expect.arrayContaining(['#ff3d71', '#00aa55']));
  });
});

describe('brand lines', () => {
  it('never uses an archetype\'s style description as the brand\'s description or tagline', () => {
    for (const text of [BAKERY, FINTECH, '']) {
      for (const d of generateDirections(briefOf(text))) {
        expect(d.kit.description, d.title).not.toBe(d.base.character);
        expect(d.kit.tagline, d.title).not.toBe(d.base.character);
        expect(d.kit.tagline.length, d.title).toBeGreaterThan(5);
      }
    }
  });
});

describe('distinct directions', () => {
  it('never repeats an archetype or a look, for many briefs', () => {
    const texts = [BAKERY, FINTECH, FILM, '', 'a calm wellness studio in Copenhagen', 'neon esports crew called Voltage, loud and electric', 'a heritage olive-oil label from Italy', 'a law firm', 'kids toy shop', 'luxury watch maker, dark'];
    for (const text of texts) {
      const three = pickThree(briefOf(text));
      expect(new Set(three.map((t) => t.archetype.id)).size, text).toBe(3);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(sameLook(three[i].archetype, three[j].archetype), `${text}: ${three[i].archetype.id}/${three[j].archetype.id}`).toBe(false);
      expect(new Set(generateDirections(briefOf(text)).map((d) => d.archetypeId)).size, text).toBe(3);
    }
  });

  it('takes the next best distinct archetype when a tiny pool cannot fill three', () => {
    const pool = ARCHETYPES.filter((a) => ['corporate-trust', 'fintech-navy', 'luxury-serif', 'neon-cyber'].includes(a.id));
    const three = pickThree(briefOf(FINTECH), pool);
    expect(new Set(three.map((t) => t.archetype.id)).size).toBe(3);
  });
});

describe('rationales', () => {
  const texts = [BAKERY, FINTECH, FILM, '', 'a calm wellness studio in Copenhagen', 'neon esports crew called Voltage, loud and electric', 'a heritage olive-oil label from Italy', 'a law firm', 'kids toy shop', 'luxury watch maker, dark'];
  it('differ in their first four words across the three directions, for 10 briefs', () => {
    for (const text of texts) {
      const lines = generateDirections(briefOf(text)).map((d) => d.rationale);
      const heads = lines.map((l) => l.split(/\s+/).slice(0, 4).join(' ').toLowerCase());
      expect(new Set(heads).size, `${text}: ${heads.join(' | ')}`).toBe(3);
      for (const l of lines) { expect(l.length).toBeGreaterThan(40); expect(l).toMatch(/^(Dark|Light), /); expect(l).toMatch(/\.$/); }
    }
  });
  it('names the direction\'s own palette, type and motion', () => {
    const [d] = generateDirections(briefOf(FILM));
    expect(d.rationale).toMatch(/canvas|space/);
    expect(d.rationale).toMatch(/motion/);
  });
});
