import { describe, expect, it } from 'vitest';
import {
  evaluateSpline,
  generateTableValues,
  DEFAULT_CURVE_POINTS,
  INVERT_CURVE_POINTS,
  S_CURVE_POINTS,
} from '../src/components/CurvesEditor';
import { computeAppliedEffects } from '../src/lib/effectFilters';
import type { AppliedEffect } from '../src/lib/types';

describe('Curves Interpolation & Table Generation', () => {
  it('evaluates linear default curve accurately at endpoints and midpoints', () => {
    expect(evaluateSpline(DEFAULT_CURVE_POINTS, 0)).toBeCloseTo(0, 3);
    expect(evaluateSpline(DEFAULT_CURVE_POINTS, 0.5)).toBeCloseTo(0.5, 3);
    expect(evaluateSpline(DEFAULT_CURVE_POINTS, 1)).toBeCloseTo(1, 3);
  });

  it('evaluates invert negative curve accurately', () => {
    expect(evaluateSpline(INVERT_CURVE_POINTS, 0)).toBeCloseTo(1, 3);
    expect(evaluateSpline(INVERT_CURVE_POINTS, 0.5)).toBeCloseTo(0.5, 3);
    expect(evaluateSpline(INVERT_CURVE_POINTS, 1)).toBeCloseTo(0, 3);
  });

  it('evaluates S-curve contrast with compressed shadows and elevated highlights', () => {
    const shadow = evaluateSpline(S_CURVE_POINTS, 0.25);
    const highlight = evaluateSpline(S_CURVE_POINTS, 0.75);

    expect(shadow).toBeLessThan(0.25);
    expect(highlight).toBeGreaterThan(0.75);
    expect(evaluateSpline(S_CURVE_POINTS, 0)).toBe(0);
    expect(evaluateSpline(S_CURVE_POINTS, 1)).toBe(1);
  });

  it('clamps values within [0, 1] range strictly without overshoots', () => {
    expect(evaluateSpline(DEFAULT_CURVE_POINTS, -0.5)).toBe(0);
    expect(evaluateSpline(DEFAULT_CURVE_POINTS, 1.5)).toBe(1);
  });

  it('generates 32 space-separated lookup values for SVG feComponentTransfer', () => {
    const tableStr = generateTableValues(DEFAULT_CURVE_POINTS, DEFAULT_CURVE_POINTS, 32);
    const parts = tableStr.split(' ');
    expect(parts).toHaveLength(32);
    expect(parseFloat(parts[0])).toBeCloseTo(0, 3);
    expect(parseFloat(parts[31])).toBeCloseTo(1, 3);
  });
});

describe('Accurate Effect Engine (SVG Filters & CSS Pipeline)', () => {
  it('computes Curves effect with feComponentTransfer tableValues', () => {
    const fx: AppliedEffect = {
      id: 'test-curves',
      effectId: 'curves',
      name: 'Curves',
      category: 'Color Correction',
      enabled: true,
      params: {
        rTable: '0.0000 0.5000 1.0000',
        gTable: '0.0000 0.5000 1.0000',
        bTable: '0.0000 0.5000 1.0000',
      },
    };

    const visuals = computeAppliedEffects('clip-1', [fx]);
    expect(visuals.cssFilters).toHaveLength(1);
    expect(visuals.cssFilters[0]).toContain('url(#bhippi-fx-clip-1-test-curves)');
    expect(visuals.svgDefs).toHaveLength(1);
  });

  it('computes Levels effect with feComponentTransfer tableValues', () => {
    const fx: AppliedEffect = {
      id: 'test-levels',
      effectId: 'levels',
      name: 'Levels',
      category: 'Color Correction',
      enabled: true,
      params: {
        inputBlack: 10,
        inputWhite: 240,
        gamma: 1.2,
      },
    };

    const visuals = computeAppliedEffects('clip-1', [fx]);
    expect(visuals.cssFilters[0]).toContain('url(#bhippi-fx-clip-1-test-levels)');
    expect(visuals.svgDefs).toHaveLength(1);
  });

  it('computes Tint effect with luminance matrix and linear transfer', () => {
    const fx: AppliedEffect = {
      id: 'test-tint',
      effectId: 'tint',
      name: 'Tint',
      category: 'Color Correction',
      enabled: true,
      params: {
        mapBlackTo: '#102030',
        mapWhiteTo: '#ffeedd',
        amount: 80,
      },
    };

    const visuals = computeAppliedEffects('clip-1', [fx]);
    expect(visuals.cssFilters[0]).toContain('url(#bhippi-fx-clip-1-test-tint)');
    expect(visuals.svgDefs).toHaveLength(1);
  });

  it('bypasses effect computation when enabled is false', () => {
    const fx: AppliedEffect = {
      id: 'test-bypass',
      effectId: 'curves',
      name: 'Curves',
      category: 'Color Correction',
      enabled: false,
      params: {},
    };

    const visuals = computeAppliedEffects('clip-1', [fx]);
    expect(visuals.cssFilters).toHaveLength(0);
    expect(visuals.svgDefs).toHaveLength(0);
  });
});
