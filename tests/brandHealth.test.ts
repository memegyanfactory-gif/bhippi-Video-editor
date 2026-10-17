import { describe, expect, it, vi } from 'vitest';
import { newBrandKit, repairBrandKit, mergeBrandKit, validateBrandKit, contrastRatio } from '../src/lib/brandKit';
import { brandHealth, fixAll } from '../src/lib/brandKit/health';
import { BRAND_PROMPT_EVENT, brandPromptMessage, requestBrandChange } from '../src/lib/brandKit/promptEvent';
import {
  bezierAt, bezierToEasing, contrastLevel, easingToBezier, fixContrast, hexToHsl, hexToHsv, hslToHex, hsvToHex, inferPersonality, parseHex, personalityOf, personalityPhrase, tintScale,
} from '../src/lib/brandKit/studio';

const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';
const good = () => newBrandKit({ brandName: 'Acme', tagline: 'Make it', audience: 'Makers', values: ['Craft', 'Care'], logoSvg: svg });
const get = (kit: ReturnType<typeof good>, id: string) => brandHealth(kit).checks.find((c) => c.id === id)!;

describe('brand health', () => {
  it('scores a well-formed kit high and reports every check once', () => {
    const health = brandHealth(good(), { fontAvailable: () => true });
    expect(health.checks.map((c) => c.id)).toEqual(['contrast', 'accent', 'logo', 'vector', 'variants', 'fonts', 'palette', 'type', 'motion', 'voice', 'imagery', 'margin', 'identity']);
    expect(health.score).toBeGreaterThanOrEqual(75);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it('fails the logo checks when there is no logo', () => {
    const kit = newBrandKit({ brandName: 'Acme' });
    expect(get(kit, 'logo').status).toBe('fail');
    expect(get(kit, 'vector').status).toBe('fail');
  });

  it('warns on a raster-only logo and offers an inverse variant', () => {
    const kit = { ...good(), logos: [{ ...good().logos[0], svg: null, dataUrl: 'data:image/png;base64,AAAA', on: 'dark' as const }] };
    expect(get(kit, 'vector').status).toBe('warn');
    const variants = get(kit, 'variants');
    expect(variants.status).toBe('warn');
    const fixed = variants.fix!(kit);
    expect(fixed.logos).toHaveLength(2);
    expect(fixed.logos[1].on).toBe('light');
    expect(brandHealth(fixed).checks.find((c) => c.id === 'variants')!.status).toBe('pass');
  });

  it('catches low text contrast and the fix passes AA', () => {
    const base = good();
    const kit = mergeBrandKit(base, 'colors', { colors: { tokens: base.colors.tokens.map((t) => (t.role === 'text' ? { ...t, hex: '#444444' } : t)) } });
    const check = get(kit, 'contrast');
    expect(check.status).not.toBe('pass');
    const fixed = check.fix!(kit);
    const bg = fixed.colors.tokens.find((t) => t.role === 'background')!.hex;
    const text = fixed.colors.tokens.find((t) => t.role === 'text')!.hex;
    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(brandHealth(fixed).checks.find((c) => c.id === 'contrast')!.status).toBe('pass');
  });

  it('flags a missing palette role and adds it', () => {
    const base = good();
    const kit = { ...base, colors: { ...base.colors, tokens: base.colors.tokens.filter((t) => t.role !== 'muted' && t.role !== 'error') } };
    const check = get(kit, 'palette');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('muted');
    const fixed = check.fix!(kit);
    expect(fixed.colors.tokens.some((t) => t.role === 'muted')).toBe(true);
    expect(fixed.colors.tokens.some((t) => t.role === 'error')).toBe(true);
    expect(brandHealth(fixed).checks.find((c) => c.id === 'palette')!.status).toBe('pass');
  });

  it('uses the font availability the UI passes in', () => {
    const kit = good();
    const family = kit.typography.display.family;
    const health = brandHealth(kit, { fontAvailable: (f) => f !== family });
    const fonts = health.checks.find((c) => c.id === 'fonts')!;
    expect(fonts.status).toBe('warn');
    expect(fonts.message).toContain(family);
    const fixed = fonts.fix!(kit);
    expect(fixed.typography.display.family).toBe('Segoe UI');
    expect(brandHealth(kit).checks.find((c) => c.id === 'fonts')!.status).toBe('pass');
  });

  it('repairs an inverted type scale and out-of-range motion, margin and grade', () => {
    const kit = good();
    const broken = { ...kit, typography: { ...kit.typography, scale: { ...kit.typography.scale, hook: 3, body: 12 } }, motionGuide: { ...kit.motionGuide, enter: 4, exit: 9, stagger: 1, easing: 'wobble' }, layout: { ...kit.layout, safeMargin: 0.01 }, imagery: { ...kit.imagery, grade: { ...kit.imagery.grade, saturation: 0.95 } } };
    const health = brandHealth(broken);
    for (const id of ['type', 'motion', 'margin', 'imagery']) expect(health.checks.find((c) => c.id === id)!.status).toBe('warn');
    const fixed = fixAll(broken, health);
    const after = brandHealth(fixed);
    for (const id of ['type', 'motion', 'margin', 'imagery']) expect(after.checks.find((c) => c.id === id)!.status).toBe('pass');
    expect(after.score).toBeGreaterThan(health.score);
  });

  it('asks for the voice the kit lacks', () => {
    const kit = { ...good(), voiceGuide: { ...good().voiceGuide, tone: [], use: [], avoid: [], samples: [] } };
    expect(get(kit, 'voice').status).toBe('fail');
  });

  it('keeps a stored kit valid when personality and dont-samples are set', () => {
    const kit = mergeBrandKit(good(), 'identity', { personality: { tone: 0.2, expression: 0.8, temperature: 0.3, era: 0.9 } });
    expect(kit.personality).toEqual({ tone: 0.2, expression: 0.8, temperature: 0.3, era: 0.9 });
    expect(validateBrandKit(kit)).toEqual([]);
    expect(repairBrandKit(kit)!.kit.personality).toEqual(kit.personality);
    const withDonts = mergeBrandKit(kit, 'voice', { dontSamples: ['We leverage synergies.'] });
    expect(repairBrandKit(withDonts)!.kit.voiceGuide.dontSamples).toEqual(['We leverage synergies.']);
    // An old kit without the field still loads and gets an inferred starting point.
    const old = good();
    expect(old.personality).toBeUndefined();
    const inferred = personalityOf(old);
    expect(Object.values(inferred).every((n) => n >= 0 && n <= 1)).toBe(true);
    expect(inferPersonality(old)).toEqual(inferred);
  });
});

describe('studio helpers', () => {
  it('round-trips colours through HSL and HSV', () => {
    for (const hex of ['#2d8ceb', '#ff5d5d', '#123456', '#ffffff', '#000000', '#808080']) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
  it('parses typed hex', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc');
    expect(parseHex('2D8CEB')).toBe('#2d8ceb');
    expect(parseHex('nope')).toBeNull();
  });
  it('builds a nine-step scale around the colour', () => {
    const scale = tintScale('#2d8ceb');
    expect(scale).toHaveLength(9);
    expect(scale[4]).toMatchObject({ label: '500', hex: '#2d8ceb', base: true });
    expect(contrastRatio(scale[0].hex, '#ffffff')).toBeLessThan(contrastRatio(scale[8].hex, '#ffffff'));
  });
  it('grades and fixes contrast', () => {
    expect(contrastLevel(7.2)).toBe('AAA');
    expect(contrastLevel(4.6)).toBe('AA');
    expect(contrastLevel(3.1)).toBe('AA large');
    expect(contrastLevel(2)).toBe('fail');
    const fixed = fixContrast('#777777', '#808080');
    expect(contrastRatio(fixed, '#808080')).toBeGreaterThanOrEqual(4.5);
    expect(fixContrast('#ffffff', '#000000')).toBe('#ffffff');
  });
  it('reads and writes easings', () => {
    expect(easingToBezier('cubic-bezier(0.16, 1, 0.3, 1)')).toEqual([0.16, 1, 0.3, 1]);
    expect(easingToBezier('expo-out')).toEqual([0.16, 1, 0.3, 1]);
    expect(easingToBezier('wobble')).toBeNull();
    expect(bezierToEasing([0.34, 1.56, 0.64, 1])).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(bezierToEasing([2, -5, -1, 9])).toBe('cubic-bezier(1, -1, 0, 2)');
    const linear = easingToBezier('linear')!;
    expect(bezierAt(0.5, linear)).toBeCloseTo(0.5, 2);
    expect(bezierAt(0, linear)).toBe(0);
    expect(bezierAt(1, linear)).toBe(1);
    expect(bezierAt(0.3, [0.16, 1, 0.3, 1])).toBeGreaterThan(0.6);
  });
  it('describes personality in words', () => {
    expect(personalityPhrase({ tone: 0.1, expression: 0.9, temperature: 0.2, era: 0.8 })).toBe('playful, expressive, warm and modern');
    expect(personalityPhrase({ tone: 0.5, expression: 0.5, temperature: 0.5, era: 0.5 })).toBe('balanced');
  });
});

describe('brand prompt event', () => {
  it('frames the request and fires one window event', () => {
    const detail = { kitId: 'bk_1', kitName: 'Acme', text: 'make it feel more premium' };
    expect(brandPromptMessage(detail)).toBe("Update brand kit Acme (bk_1): make it feel more premium. Use the brand kit tools; change only what's asked.");
    vi.stubGlobal('window', new EventTarget());
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(BRAND_PROMPT_EVENT, listener);
    expect(requestBrandChange({ ...detail, text: '   ' })).toBe(false);
    expect(requestBrandChange(detail)).toBe(true);
    window.removeEventListener(BRAND_PROMPT_EVENT, listener);
    vi.unstubAllGlobals();
    expect(seen).toEqual([detail]);
  });
});
