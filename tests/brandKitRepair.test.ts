import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { repairArgs } from '../src/lib/argRepair';
import { brandBoard, brandKitSummary, importBrandKit, kitFromArchetypeChecked, mergeBrandKitChecked, newBrandKit, repairBrandKitDoc, resolveActiveKit, findArchetype } from '../src/lib/brandKit';
import { guidelineOf } from '../src/lib/brandKit/guideline';
import { BrandKitSettings } from '../src/settings/BrandKitSettings';
import type { Settings } from '../src/lib/types';

/** A kit as XML-style tool calls left it in a real settings file: wrapped lists, text numbers, text gradients. */
function brokenKit() {
  const kit = JSON.parse(JSON.stringify(newBrandKit({ name: 'Bhippi', style: 'bold-startup' })));
  kit.voiceGuide.tone = { item: ['confident', 'crafted'] };
  kit.voiceGuide.samples = { item: ['Edit video with AI. Keep it yours.', 'Say what you want, once.'] };
  kit.motionGuide.transitions = 'push, whip, cut';
  kit.motionGuide.principles = { item: ['Anticipation, action, settle - never linear.'] };
  kit.motionGuide.enter = '0.4';
  kit.motionGuide.hold = '1.4';
  kit.audio.tempo = '118-124 BPM';
  kit.colors.gradients = ['135deg #ff2d1a→#ff6a1a', '90deg #ff6a1a→#ffb347'];
  return kit;
}

describe('brand kits from outside Bhippi', () => {
  it('are fitted to the kit shape at load, keeping what the values meant', () => {
    const { doc, changed } = repairBrandKitDoc({ kits: [brokenKit()], activeId: null });
    expect(changed).toBe(true);
    const kit = doc.kits[0];
    expect(kit.voiceGuide.tone).toEqual(['confident', 'crafted']);
    // Line lists keep the commas inside their sentences.
    expect(kit.motionGuide.principles).toEqual(['Anticipation, action, settle - never linear.']);
    expect(kit.voiceGuide.samples).toHaveLength(2);
    expect(kit.motionGuide.transitions).toEqual(['push', 'whip', 'cut']);
    expect(kit.motionGuide.enter).toBe(0.4);
    expect(kit.motionGuide.hold).toBe(1.4);
    expect(kit.audio.tempo).toEqual([118, 124]);
    expect(kit.colors.gradients.map((g) => g.stops)).toEqual([['#ff2d1a', '#ff6a1a'], ['#ff6a1a', '#ffb347']]);
  });

  it('come back as the same objects when nothing needs repair, so a load writes nothing', () => {
    const good = newBrandKit({ name: 'Good' });
    const doc = { kits: [good], activeId: good.id };
    const once = repairBrandKitDoc(doc);
    expect(once.changed).toBe(false);
    expect(once.doc).toBe(doc);
    // A repaired document read back from disk (keys re-sorted) stays unchanged too.
    const again = repairBrandKitDoc(JSON.parse(JSON.stringify(repairBrandKitDoc({ kits: [brokenKit()], activeId: null }).doc)));
    expect(again.changed).toBe(false);
    expect(resolveActiveKit(doc)).toBe(good);
  });

  it('render in the Brand kit panel, its guideline and board', () => {
    const kit = repairBrandKitDoc({ kits: [brokenKit()], activeId: null }).doc.kits[0];
    expect(() => guidelineOf(kit)).not.toThrow();
    expect(() => brandBoard(kit)).not.toThrow();
    expect(brandKitSummary(kit)).toContain('push');
    const settings = { brandKits: { kits: [kit], activeId: kit.id } } as unknown as Settings;
    expect(() => renderToString(createElement(BrandKitSettings, { settings, onSettings: () => undefined, projectBrandKitId: kit.id, onProjectBrandKit: () => undefined }))).not.toThrow();
  });

  it('drop what is not a kit and a default that points at nothing', () => {
    const good = newBrandKit({ name: 'Good' });
    const { doc, changed } = repairBrandKitDoc({ kits: [good, 'junk', null], activeId: 'gone' });
    expect(changed).toBe(true);
    expect(doc.kits).toEqual([good]);
    expect(doc.activeId).toBeNull();
  });
});

describe('writes to a kit', () => {
  it('fit a wrong-typed AI patch, and name what they could not use', () => {
    const kit = newBrandKit({ name: 'Acme' });
    const fitted = mergeBrandKitChecked(kit, 'voice', { tone: { item: ['warm', 'direct'] }, samples: 'One line.\nAnother, with a comma.' });
    expect(fitted.kit.voiceGuide.tone).toEqual(['warm', 'direct']);
    expect(fitted.kit.voiceGuide.samples).toEqual(['One line.', 'Another, with a comma.']);
    expect(fitted.issues).toEqual([]);
    const refused = mergeBrandKitChecked(kit, 'motion', { enter: 'fast', transitions: 7 });
    expect(refused.kit.motionGuide.enter).toBe(kit.motionGuide.enter);
    expect(refused.kit.motionGuide.transitions).toEqual(kit.motionGuide.transitions);
    expect(refused.issues.join(' ')).toContain('motionGuide.enter must be a number');
    expect(refused.issues.join(' ')).toContain('motionGuide.transitions must be a list');
    // A typography face sent as a bare name keeps the kit's face (it used to throw on .family).
    const face = mergeBrandKitChecked(kit, 'typography', { display: 'Inter' });
    expect(face.kit.typography.display.family).toBe(kit.typography.display.family);
    expect(face.issues.join(' ')).toContain('typography.display must be an object');
  });

  it('fit the section overrides of a new kit (create_brand_kit)', () => {
    const arch = findArchetype('bold-startup')!;
    const { kit, issues } = kitFromArchetypeChecked(arch, { name: 'X', voice: { tone: { item: ['bold'] } } as never, motion: { enter: '0.5' } as never });
    expect(kit.voiceGuide.tone).toEqual(['bold']);
    expect(kit.motionGuide.enter).toBe(0.5);
    expect(issues).toEqual([]);
  });

  it('fit a pasted export', () => {
    const imported = importBrandKit(JSON.stringify(brokenKit()));
    expect('error' in imported).toBe(false);
    if (!('error' in imported)) expect(imported.motionGuide.transitions).toEqual(['push', 'whip', 'cut']);
  });
});

describe('tool arguments', () => {
  it('unwrap an XML-style {"item": [...]} list instead of wrapping it again', () => {
    const args = repairArgs('create_brand_kit', { values: { item: ['craft', 'speed'] } }) as { values: unknown };
    expect(args.values).toEqual(['craft', 'speed']);
    const one = repairArgs('create_brand_kit', { values: { item: 'craft' } }) as { values: unknown };
    expect(one.values).toEqual(['craft']);
  });
});
