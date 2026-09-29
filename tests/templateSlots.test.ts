import { describe, expect, it } from 'vitest';
import { CRIMSON_TEMPLATES } from '../src/lib/motionGuide';
import { BRAND_SLOTS, CRIMSON_SLOTS, describeSlots, missingSlots, resolveTemplateId, slotFromProse, slotsFor } from '../src/lib/templateSlots';
import { MOTION_TEMPLATES } from '../src/motion/kit';

describe('template slot schemas', () => {
  it('cover every house template with the params it takes', () => {
    for (const spec of CRIMSON_TEMPLATES) {
      const slots = CRIMSON_SLOTS[spec.id];
      expect(slots, spec.id).toBeDefined();
      for (const param of spec.params) if (param !== 'accent') expect(Object.keys(slots), `${spec.id}.${param}`).toContain(param);
    }
    expect(Object.keys(CRIMSON_SLOTS).sort()).toEqual(CRIMSON_TEMPLATES.map((spec) => spec.id).sort());
  });

  it('give every motion-kit template a schema, brand ones with the hand-measured limits', () => {
    for (const spec of MOTION_TEMPLATES) {
      const slots = slotsFor(spec.id, spec.params)!;
      expect(Object.keys(slots).length, spec.id).toBeGreaterThanOrEqual(Object.keys(spec.params).length);
    }
    for (const id of Object.keys(BRAND_SLOTS)) expect(MOTION_TEMPLATES.some((spec) => spec.id === id), id).toBe(true);
    const title = slotsFor('brand-title', MOTION_TEMPLATES.find((spec) => spec.id === 'brand-title')!.params)!;
    expect(title.title).toMatchObject({ kind: 'text', required: true, max: 48 });
    expect(title.background?.kind).toBe('choice');
  });

  it('reads kit prose into typed slots', () => {
    expect(slotFromProse('number 0.2–3 (1) — how many particles')).toMatchObject({ kind: 'number', min: 0.2, max: 3 });
    expect(slotFromProse('string[] (≤5)')).toMatchObject({ kind: 'list', maxItems: 5 });
    expect(slotFromProse('"left" | "right" ("right") — where the panel sits')).toMatchObject({ kind: 'choice', values: ['left', 'right'] });
    expect(slotFromProse('boolean (true)').kind).toBe('boolean');
    expect(slotFromProse('string[2] — words left and right of the face')).toMatchObject({ kind: 'list', maxItems: 2 });
    expect(slotFromProse('colour (#2e6b3a) — the ink green').kind).toBe('color');
    expect(slotFromProse('footage { asset, in, matte } — the clip (required)')).toMatchObject({ kind: 'any', required: true });
    expect(slotFromProse('string ("2 days ago")')).toMatchObject({ kind: 'text', hint: '"2 days ago"' });
  });

  it('resolves template ids written loosely, and only when sure', () => {
    expect(resolveTemplateId('Hook promise', CRIMSON_TEMPLATES)).toBe('hook-promise');
    expect(resolveTemplateId('STAT_CHART', CRIMSON_TEMPLATES)).toBe('stat-chart');
    expect(resolveTemplateId('crimson lower third template', CRIMSON_TEMPLATES)).toBe('crimson-lower-third');
    expect(resolveTemplateId('countdown', CRIMSON_TEMPLATES)).toBe('countdown');
    expect(resolveTemplateId('lower third', CRIMSON_TEMPLATES)).toBe('crimson-lower-third');
    expect(resolveTemplateId('the stat-chart', CRIMSON_TEMPLATES)).toBe('stat-chart');
    expect(resolveTemplateId('title', CRIMSON_TEMPLATES)).toBeNull();
    expect(resolveTemplateId('something else', CRIMSON_TEMPLATES)).toBeNull();
  });

  it('names the required slots left empty, and describes a schema in one line', () => {
    expect(missingSlots(CRIMSON_SLOTS['stat-chart'], { title: 'Revenue', rows: [] })).toEqual(['rows', 'values']);
    expect(missingSlots(CRIMSON_SLOTS['cubes-reveal'], {})).toEqual([]);
    expect(describeSlots(CRIMSON_SLOTS['crimson-lower-third'])).toBe('title (text, required, ≤28 chars: the name); subtitle (text, ≤40 chars: the role); accentColor (color: #rrggbb, readable on a dark plate)');
  });
});
