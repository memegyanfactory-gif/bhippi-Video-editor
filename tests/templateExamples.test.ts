import { describe, expect, it } from 'vitest';
import { CRIMSON_TEMPLATES } from '../src/lib/motionGuide';
import { buildMotionGraphic } from '../src/lib/motionGraphics';
import { BRAND_EXAMPLES, CRIMSON_EXAMPLES, KINETIC_EXAMPLES, exampleCall } from '../src/lib/templateExamples';
import { PLACEHOLDERS } from '../src/lib/templateEval';
import { fixTemplateArgs } from '../src/lib/templateFix';
import { BRAND_SLOTS, CRIMSON_SLOTS, missingSlots, slotsFor } from '../src/lib/templateSlots';
import { findTemplate } from '../src/motion/kit';
import { KINETIC_TEMPLATES } from '../src/motion/kit/kineticTemplates';

describe('template examples', () => {
  it('has one for every house template, within its slots: nothing for the auto-fix to change', () => {
    expect(Object.keys(CRIMSON_EXAMPLES).sort()).toEqual(CRIMSON_TEMPLATES.map((t) => t.id).sort());
    for (const [id, args] of Object.entries(CRIMSON_EXAMPLES)) {
      const fixed = fixTemplateArgs(id, CRIMSON_SLOTS[id], args, { plate: '#100607' });
      expect(fixed.error, id).toBeUndefined();
      expect(fixed.notes, id).toEqual([]);
      expect(missingSlots(CRIMSON_SLOTS[id], args), id).toEqual([]);
      const html = buildMotionGraphic({ template: id, ...(args as Record<string, never>) }).html;
      for (const text of PLACEHOLDERS) expect(html, `${id} shows "${text}"`).not.toContain(text);
    }
  });

  it('has one for every brand template that builds', () => {
    expect(Object.keys(BRAND_EXAMPLES).sort()).toEqual([...Object.keys(BRAND_SLOTS), 'brand-transition'].sort());
    for (const [id, params] of Object.entries(BRAND_EXAMPLES)) {
      const spec = findTemplate(id)!;
      const fixed = fixTemplateArgs(id, slotsFor(id, spec.params)!, params);
      expect(fixed.error, id).toBeUndefined();
      expect(fixed.notes, id).toEqual([]);
      expect(spec.build({ width: 1920, height: 1080 }, params).layers.length, id).toBeGreaterThan(0);
    }
    expect(exampleCall('brand-stat')).toEqual({ tool: 'create_motion_scene', args: { template: 'brand-stat', params: BRAND_EXAMPLES['brand-stat'] } });
    expect(exampleCall('hook-promise')?.tool).toBe('create_motion_graphic');
    expect(exampleCall('fx-confetti')).toBeNull();
  });

  it('has one for every kinetic template, with its required words, that builds', () => {
    expect(Object.keys(KINETIC_EXAMPLES).sort()).toEqual(KINETIC_TEMPLATES.map((spec) => spec.id).sort());
    for (const [id, params] of Object.entries(KINETIC_EXAMPLES)) {
      const spec = findTemplate(id)!;
      const slots = slotsFor(id, spec.params)!;
      const fixed = fixTemplateArgs(id, slots, params);
      expect(fixed.error, id).toBeUndefined();
      expect(fixed.notes, id).toEqual([]);
      expect(missingSlots(slots, params), id).toEqual([]);
      expect(spec.build({ width: 1920, height: 1080 }, params).layers.length, id).toBeGreaterThan(1);
    }
    expect(exampleCall('type-on-voice')?.tool).toBe('create_motion_scene');
  });
});
