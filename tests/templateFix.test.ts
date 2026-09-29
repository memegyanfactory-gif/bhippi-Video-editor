import { describe, expect, it } from 'vitest';
import { buildCrimsonTemplate } from '../src/lib/motionGuide';
import { contrastOf, fitScales, fixTemplateArgs, readableOn, toHex, toNumber, toSeconds } from '../src/lib/templateFix';
import { BRAND_SLOTS, CRIMSON_SLOTS } from '../src/lib/templateSlots';

const PLATE = '#100607';

describe('template auto-fix', () => {
  it('reads colours, numbers and durations the way models write them', () => {
    expect(toHex('red')).toBe('#e5484d');
    expect(toHex('Teal')).toBe('#14b8a6');
    expect(toHex('#FA0')).toBe('#ffaa00');
    expect(toHex('rgb(20, 184, 166)')).toBe('#14b8a6');
    expect(toHex('ff0000')).toBe('#ff0000');
    expect(toHex('brandy')).toBeNull();
    expect(toNumber('$12.5M')).toBe(12.5);
    expect(toNumber('1,200')).toBe(1200);
    expect(toSeconds('5s')).toBe(5);
    expect(toSeconds('0:05')).toBe(5);
    expect(toSeconds('500ms')).toBe(0.5);
    expect(toSeconds('1.5 seconds')).toBe(1.5);
  });

  it('lightens a colour too dark for the plate, keeping its hue', () => {
    const out = readableOn('#1a0508', PLATE);
    expect(contrastOf(out, PLATE)).toBeGreaterThanOrEqual(3);
    expect(parseInt(out.slice(1, 3), 16)).toBeGreaterThan(parseInt(out.slice(3, 5), 16));
    const fixed = fixTemplateArgs('hook-promise', CRIMSON_SLOTS['hook-promise'], { title: 'Save more', accentColor: 'navy' }, { plate: PLATE });
    expect(contrastOf(String(fixed.args.accentColor), PLATE)).toBeGreaterThanOrEqual(3);
    expect(fixed.adjustments.map((a) => a.action)).toEqual(['mapped', 'lightened']);
  });

  it('turns other words and one-string lists into the slots', () => {
    const fixed = fixTemplateArgs('teaching-card', CRIMSON_SLOTS['teaching-card'], { heading: 'The 50/30/20 rule', bullets: 'Needs — 50%\nWants — 30%\nSavings — 20%', activeIndex: '1' });
    expect(fixed.error).toBeUndefined();
    expect(fixed.args).toMatchObject({ title: 'The 50/30/20 rule', rows: ['Needs — 50%', 'Wants — 30%', 'Savings — 20%'], activeIndex: 1 });
    expect(fixed.args.heading).toBeUndefined();
    const commas = fixTemplateArgs('stat-chart', CRIMSON_SLOTS['stat-chart'], { title: 'Revenue', rows: '2021, 2022, 2023', values: ['$12M', '19', 31] });
    expect(commas.args).toMatchObject({ rows: ['2021', '2022', '2023'], values: [12, 19, 31] });
    const objects = fixTemplateArgs('side-panel', CRIMSON_SLOTS['side-panel'], { title: 'Hooks', rows: [{ title: 'Be specific', detail: 'numbers beat adjectives' }, 'Open a loop'] });
    expect(objects.args.rows).toEqual(['Be specific — numbers beat adjectives', 'Open a loop']);
  });

  it('moves text for a slot the template lacks to a free one, or reports it', () => {
    const moved = fixTemplateArgs('countdown', CRIMSON_SLOTS.countdown, { metric: '10', subtitle: 'Get ready' });
    expect(moved.args).toMatchObject({ metric: '10', title: 'Get ready' });
    expect(moved.args.subtitle).toBeUndefined();
    const full = fixTemplateArgs('crimson-lower-third', CRIMSON_SLOTS['crimson-lower-third'], { title: 'Priya Raman', subtitle: 'Head of Growth', badge: 'SPEAKER' });
    expect(full.adjustments).toContainEqual({ slot: 'badge', action: 'ignored' });
  });

  it('sets text a little long smaller, and refuses text far too long with the limit', () => {
    const shrunk = fixTemplateArgs('crimson-lower-third', CRIMSON_SLOTS['crimson-lower-third'], { title: 'Dr. Priya Raman-Venkatesh, PhD' });
    const scale = fitScales(shrunk.adjustments).title;
    expect(scale).toBeLessThan(1);
    expect(30 * scale).toBeLessThanOrEqual(28);
    const html = buildCrimsonTemplate({ template: 'crimson-lower-third', title: 'Dr. Priya Raman-Venkatesh, PhD', fit: { title: scale } })!.html;
    expect(html).toContain(`font-size:${scale}em`);
    const refused = fixTemplateArgs('crimson-lower-third', CRIMSON_SLOTS['crimson-lower-third'], { title: 'x'.repeat(80) });
    expect(refused.error).toMatch(/title is 80 characters; crimson-lower-third fits 28 \(46 at its smallest type\)\. Shorten title to at most 46/);
  });

  it('cuts a list longer than the template shows, saying so, and needs a value per bar', () => {
    const lanes = fixTemplateArgs('teaching-card', CRIMSON_SLOTS['teaching-card'], { title: 'Steps', rows: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] });
    expect(lanes.args.rows).toHaveLength(4);
    expect(lanes.notes.join(' ')).toMatch(/shows 4, so the last 2 of 6 are left out/);
    const chart = fixTemplateArgs('stat-chart', CRIMSON_SLOTS['stat-chart'], { title: 'Revenue', rows: ['2021', '2022', '2023'], values: [1, 2] });
    expect(chart.error).toMatch(/one value per row: 3 rows, 2 values/);
  });

  it('fills a countdown from a number-only title or from its length', () => {
    expect(fixTemplateArgs('countdown', CRIMSON_SLOTS.countdown, { title: '10' }).args).toMatchObject({ metric: '10' });
    expect(fixTemplateArgs('countdown', CRIMSON_SLOTS.countdown, { title: 'Get ready', duration: '5s' }).args).toMatchObject({ metric: '5', title: 'Get ready', duration: 5 });
  });

  it('fixes brand motion params too', () => {
    const fixed = fixTemplateArgs('brand-panel', BRAND_SLOTS['brand-panel'], { heading: 'Rules', items: 'one; two; three', side: 'RIGHT' });
    expect(fixed.args).toMatchObject({ title: 'Rules', points: ['one', 'two', 'three'], side: 'right' });
    expect(fixTemplateArgs('brand-stat', BRAND_SLOTS['brand-stat'], { value: '37%', label: 'growth' }).args.value).toBe(37);
  });
});
