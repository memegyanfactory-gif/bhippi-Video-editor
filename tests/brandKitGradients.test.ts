import { describe, expect, it } from 'vitest';
import { brandKitContext, brandKitQuickContext, brandKitVars, importBrandKit, mergeBrandKit, newBrandKit, resolveActiveKit } from '../src/lib/brandKit';
import { normalizeGradients } from '../src/lib/brandKit/gradients';

describe('saved text gradients', () => {
  const legacyKit = () => {
    const kit = newBrandKit({ name: 'Saved kit' });
    kit.colors.gradients = ['135deg #ff2d1a→#ff6a1a', '90deg #ff6a1a→#ffb347'] as unknown as typeof kit.colors.gradients;
    return kit;
  };
  it('prepares quick and production chat context without losing saved colours', () => {
    const kit = legacyKit();
    expect(brandKitContext(kit).colors.gradients).toContain('Gradient 1: 135deg #ff2d1a→#ff6a1a');
    expect(brandKitQuickContext(kit).colors.gradients).toHaveLength(2);
    expect(brandKitVars(kit)['--bk-gradient-1']).toBe('linear-gradient(135deg, #ff2d1a, #ff6a1a)');
    expect(kit.colors.gradients[0]).toBe('135deg #ff2d1a→#ff6a1a'); // No mutation of saved data.
  });
  it('normalizes selection, import and later edits', () => {
    const kit = legacyKit();
    expect(resolveActiveKit({ activeId: kit.id, kits: [kit] })?.colors.gradients[0].stops).toEqual(['#ff2d1a', '#ff6a1a']);
    const imported = importBrandKit(JSON.stringify(kit));
    expect('error' in imported).toBe(false);
    expect(mergeBrandKit(kit, 'colors', { gradients: ['90deg #ff6a1a→#ffb347'] }).colors.gradients[0].angle).toBe(90);
  });
  it('drops unusable entries and defaults incomplete object metadata safely', () => {
    expect(normalizeGradients([null, {}, 'bad', { stops: ['#112233', '#445566'] }])).toEqual([{ name: 'Gradient 4', angle: 135, stops: ['#112233', '#445566'], usage: '' }]);
  });
  it('keeps resolved kit identity stable between renders', () => {
    const kit = legacyKit();
    const doc = { activeId: kit.id, kits: [kit] };
    expect(resolveActiveKit(doc)).toBe(resolveActiveKit(doc));
    const valid = newBrandKit({ name: 'Valid kit' });
    expect(resolveActiveKit({ activeId: valid.id, kits: [valid] })).toBe(valid);
  });
});
