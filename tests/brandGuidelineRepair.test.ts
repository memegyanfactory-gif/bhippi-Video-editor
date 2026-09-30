import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), refsIngest: vi.fn(), refsSaveGuideline: vi.fn() },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { mergeBrandKitChecked, newBrandKit, repairBrandKit } from '../src/lib/brandKit/build';
import { deriveGuideline, guidelineOf } from '../src/lib/brandKit/guideline';
import { learningsBrief } from '../src/lib/brandKit/learnings';
import { motionBrandFromKit } from '../src/lib/brandKit/motionBrand';
import { findTemplate } from '../src/motion/kit';
import { buildInBrand } from '../src/motion/kit/brandify';
import { validateScene } from '../src/motion/validate';
import { BrandGuidelineView } from '../src/settings/BrandGuidelineView';
import { repairSettings } from '../src/lib/settingsRepair';
import type { Settings } from '../src/lib/types';

const title = (kit: ReturnType<typeof newBrandKit>) => buildInBrand(findTemplate('brand-title')!, { width: 1920, height: 1080 }, { title: 'Ship faster' }, motionBrandFromKit(kit));

describe('guideline refinements from a tool call', () => {
  it('turn a four-number ease into a curve and drop one that is not an ease (it broke every brand-* template)', () => {
    const kit = newBrandKit({ name: 'Acme' });
    const moveId = deriveGuideline(kit).moves[0].id;
    const patch = { moves: [{ id: moveId, elements: [{ name: 'Headline', role: 'headline', keys: [{ frame: 0, state: { opacity: 0 }, ease: [0.16, 1, 0.3, 1] }, { frame: '12', state: { opacity: '1' }, ease: { item: ['x'] }, note: { bad: true } }] }] }] };
    const { kit: next } = mergeBrandKitChecked(kit, 'guideline', patch);
    const keys = guidelineOf(next).moves.find((m) => m.id === moveId)!.elements[0].keys;
    expect(keys[0].ease).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(keys[1]).toEqual({ frame: 12, state: { opacity: 1 } });
    expect(validateScene(title(next))).toEqual([]);
    expect(() => renderToString(createElement(BrandGuidelineView, { kit: next, onReset: () => undefined }))).not.toThrow();
  });

  it('read XML-style lists and text numbers instead of dropping them', () => {
    const kit = newBrandKit({ name: 'Acme' });
    const layout = deriveGuideline(kit).layouts[0];
    const { kit: next } = mergeBrandKitChecked(kit, 'guideline', {
      dos: { item: ['Hold every title 2 s.'] },
      layouts: { item: [{ id: layout.id, zones: { item: [{ role: 'headline', name: 'Title', x: '0.1', y: '0.2', w: '0.5', h: '0.1' }] } }] },
      motion: { timing: { hold: '2.5' } },
    });
    const g = guidelineOf(next);
    expect(g.dos).toEqual(['Hold every title 2 s.']);
    expect(g.layouts.find((l) => l.id === layout.id)!.zones[0]).toMatchObject({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 });
    expect(g.motion.timing.hold).toBe(2.5);
  });

  it('sent in an "all" patch take the same checks, and later refinements still merge', () => {
    const kit = newBrandKit({ name: 'Acme' });
    const moveId = deriveGuideline(kit).moves[0].id;
    const { kit: next } = mergeBrandKitChecked(kit, 'all', { tagline: 'Fast', guideline: { moves: { item: [{ id: moveId, name: 'Rise' }] } } });
    expect(next.tagline).toBe('Fast');
    expect(guidelineOf(next).moves.find((m) => m.id === moveId)?.name).toBe('Rise');
    // It used to throw "not iterable" on the stored {"item": [...]} at the next refinement.
    expect(() => mergeBrandKitChecked(next, 'guideline', { moves: [{ id: moveId, use: 'Titles' }] })).not.toThrow();
  });

  it('keep a stored guideline with broken lists readable', () => {
    const kit = { ...newBrandKit({ name: 'Acme' }), guideline: { source: 'ai', version: 1, updatedAt: '', moves: { item: [null] }, dos: 'One rule.' } } as never;
    expect(() => guidelineOf(kit)).not.toThrow();
    expect(() => mergeBrandKitChecked(kit, 'guideline', { donts: ['No neon.'] })).not.toThrow();
    expect(guidelineOf(kit).dos).toEqual(['One rule.']);
  });
});

describe('what /train stored', () => {
  it('is fitted: a wrong-typed learnings list no longer breaks the panel or every chat turn', () => {
    const raw = { ...newBrandKit({ name: 'Acme' }), learnings: { item: [{ id: 'l1', area: 'pacing', text: 'Cut every 2 s.', sourceIds: ['s1'], confidence: '0.8', status: 'active', addedAt: '', updatedAt: '' }, 'junk', { id: 'l2', area: 'nonsense', text: 'x' }] }, sources: 'nope' };
    const kit = repairBrandKit(raw)!.kit;
    expect(kit.learnings).toHaveLength(1);
    expect(kit.learnings![0].confidence).toBe(0.8);
    expect(kit.sources).toEqual([]);
    expect(learningsBrief(kit)).toEqual(['Pacing: Cut every 2 s.']);
  });
});

describe('free-JSON settings', () => {
  it('are fitted so a bad layout, workspace, shortcut or preset cannot stop the app starting', () => {
    const stored = {
      layout: { hidden: null, docked: 'x', chatWidth: '300' },
      workspaces: [{ name: 'Edit', layout: { hidden: ['chat'] } }, null, { name: 'Broken', layout: 'x' }],
      shortcuts: { undo: [null, 'Ctrl+Z'], redo: 'Ctrl+Y' },
      export: { resolution: null, fps: null, quality: null, folder: null, presets: [null, { id: 'p', label: 'Web', settings: {} }] },
    } as unknown as Settings;
    const { settings, repaired } = repairSettings(stored);
    expect(repaired.sort()).toEqual(['export', 'layout', 'shortcuts', 'workspaces']);
    expect(settings.layout).toEqual({});
    expect(settings.workspaces).toEqual([{ name: 'Edit', layout: { hidden: ['chat'] } }]);
    expect(settings.shortcuts).toEqual({ undo: ['Ctrl+Z'], redo: ['Ctrl+Y'] });
    expect(settings.export.presets).toEqual([{ id: 'p', label: 'Web', settings: {} }]);
  });

  it('that are already right come back untouched', () => {
    const stored = { layout: { hidden: ['chat'], docked: [] }, workspaces: [], shortcuts: { undo: ['Ctrl+Z'] }, export: { resolution: null, fps: 29.97, quality: null, folder: null, presets: [] } } as unknown as Settings;
    const { settings, repaired } = repairSettings(stored);
    expect(repaired).toEqual([]);
    expect(settings).toBe(stored);
  });
});
