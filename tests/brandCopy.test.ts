import { describe, expect, it } from 'vitest';
import { ARCHETYPES, kitFromArchetype, type BrandKit } from '../src/lib/brandKit';
import { brandCopy } from '../src/lib/brandKit/brandCopy';
import { ASPECTS, packItems, packScene, reelScene } from '../src/lib/brandKit/motionPack';

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const kitOf = (id: string, input: Record<string, unknown> = {}): BrandKit => kitFromArchetype(ARCHETYPES.find((a) => a.id === id)!, { brandName: 'Aurelia', ...input });

describe('brandCopy', () => {
  it('never returns the style description or archetype character, for any archetype', () => {
    for (const arch of ARCHETYPES) {
      const kit = kitFromArchetype(arch, { brandName: 'Aurelia' });
      const copy = brandCopy(kit);
      for (const line of [copy.tagline, copy.headline]) {
        expect(norm(kit.description).includes(norm(line)) && norm(line).length > 14, `${arch.id}: "${line}"`).toBe(false);
        expect(norm(line)).not.toBe(norm(arch.character));
        expect(line.length).toBeGreaterThan(0);
        expect(line.length).toBeLessThanOrEqual(90);
      }
    }
  });

  it('prefers the kit tagline, then a voice sample, then a composed line, then the name', () => {
    const own = brandCopy(kitOf('luxury-serif', { tagline: 'Made slowly. Worn for decades.' }));
    expect(own).toMatchObject({ tagline: 'Made slowly. Worn for decades.', source: 'tagline' });

    const voiced = kitOf('luxury-serif');
    voiced.voiceGuide = { ...voiced.voiceGuide, samples: ['Quiet things last longest.', 'Taste is a long game.'] };
    const v = brandCopy(voiced);
    expect(v.source).toBe('voice');
    expect(voiced.voiceGuide.samples).toContain(v.tagline);

    const composed = kitOf('luxury-serif', { values: ['Considered', 'Generous'] });
    composed.voiceGuide = { ...composed.voiceGuide, samples: [] };
    expect(brandCopy(composed)).toMatchObject({ tagline: 'Considered. Generous. Aurelia.', source: 'composed' });

    const industry = kitOf('luxury-serif', { industry: 'Fine jewellery' });
    industry.voiceGuide = { ...industry.voiceGuide, samples: [] };
    expect(brandCopy(industry).tagline).toBe('Aurelia — made for fine jewellery');

    const bare = kitOf('luxury-serif', { industry: '' });
    bare.voiceGuide = { ...bare.voiceGuide, samples: [] };
    bare.industry = '';
    expect(brandCopy(bare)).toMatchObject({ tagline: 'Aurelia', source: 'name' });
  });

  it('rejects a tagline or sample that is the description', () => {
    const kit = kitOf('luxury-serif', { tagline: 'x' });
    kit.tagline = kit.description;
    kit.voiceGuide = { ...kit.voiceGuide, samples: [kit.description, 'Ok'] };
    const copy = brandCopy(kit);
    expect(norm(copy.tagline)).not.toBe(norm(kit.description));
    expect(copy.source).not.toBe('tagline');
    expect(copy.source).not.toBe('voice');
  });

  it('is what the reel and the pack print: no scene text contains the description', () => {
    for (const arch of ARCHETYPES.filter((_, i) => i % 3 === 0)) {
      const kit = kitFromArchetype(arch, { brandName: 'Aurelia' });
      const scenes = [reelScene(kit), ...packItems(kit).map((i) => packScene(kit, i.id, ASPECTS['16:9'])!)];
      const printed = scenes.flatMap((s) => s.layers.flatMap((l) => (l.type === 'text' ? [l.text.text ?? (l.text.spans ?? []).map((x) => x.text).join('')] : []))).map(norm).join(' | ');
      const fragment = norm(kit.description).split(' ').slice(0, 6).join(' ');
      expect(printed.includes(fragment), `${arch.id}: ${fragment}`).toBe(false);
    }
  });
});

describe('pack posters', () => {
  it('every piece has a poster inside its duration', () => {
    for (const item of packItems(kitOf('sport-energy'))) {
      expect(item.poster).toBeGreaterThanOrEqual(0);
      expect(item.poster).toBeLessThan(item.seconds);
    }
  });

  it('a transition poster is mid-move, early in the piece', () => {
    for (const id of ['luxury-serif', 'sport-energy', 'minimal-mono']) {
      for (const item of packItems(kitOf(id)).filter((i) => i.group === 'transition')) expect(item.poster).toBeLessThan(item.seconds * 0.45);
    }
  });
});
