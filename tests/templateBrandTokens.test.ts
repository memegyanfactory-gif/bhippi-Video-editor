import { describe, expect, it } from 'vitest';
import { findArchetype } from '../src/lib/brandKit/archetypes';
import { kitFromArchetype, retintGraphicHtml } from '../src/lib/brandKit/build';
import { buildCrimsonTemplate, CRIMSON_BASE_CSS } from '../src/lib/motionGuide';
import { CRIMSON_EXAMPLES } from '../src/lib/templateExamples';

/** Neutral black shadows and white highlights read on any kit; every other colour is a palette token. */
const NEUTRAL = /^#(0{3,6}[0-9a-f]{0,2}|f{3,6}[0-9a-f]{0,2}|0{6}[0-9a-f]{2}|1200004d|08000065|000c|ffffff05)$/i;

describe('house templates take every colour from the palette tokens', () => {
  it('uses no hard-coded colour but neutral shadows and highlights', () => {
    // The palette's own definitions (--void:#100607 …) are the tokens; every use goes through them.
    const colours = (text: string) => (text.replace(/--[a-z-]+:#[0-9a-fA-F]{6}/g, '').replace(/var\(--[a-z-]+,#[0-9a-fA-F]{6}\)/g, '').match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => !NEUTRAL.test(hex));
    expect(colours(CRIMSON_BASE_CSS)).toEqual([]);
    for (const [id, args] of Object.entries(CRIMSON_EXAMPLES)) {
      const built = buildCrimsonTemplate({ template: id, ...(args as Record<string, never>) })!;
      // The accent the builder writes (--mg-accent) is the one colour that comes in as a value.
      expect(colours(built.html.replace(/--mg-accent:#[0-9a-f]{6}/i, '')), id).toEqual([]);
      expect(colours(built.css.replace(CRIMSON_BASE_CSS, '')), id).toEqual([]);
    }
  });

  it('sets text in the kit text colour, and backs overlay text on light kits', () => {
    expect(CRIMSON_BASE_CSS).toContain('sans-serif;color:var(--white)');
    const lightKit = kitFromArchetype(findArchetype('ref-realest')!);
    const darkKit = kitFromArchetype(findArchetype('ref-capway')!);
    const html = buildCrimsonTemplate({ template: 'chapter-marker', title: 'Investing basics', kicker: '03' })!.html;
    expect(html).toContain('class="x onfoot"');
    expect(retintGraphicHtml(html, lightKit)).toContain('<div class="mgc light"');
    expect(retintGraphicHtml(html, darkKit)).toContain('<div class="mgc"');
    expect(retintGraphicHtml(html, darkKit)).not.toContain('mgc light');
  });
});
