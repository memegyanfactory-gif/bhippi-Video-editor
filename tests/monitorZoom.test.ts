import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, stepZoom, toggleFit, wheelDelta, wheelZoom } from '../src/lib/monitorZoom';

describe('monitor zoom, the way Premiere\'s monitors zoom', () => {
  const fit = 0.42;

  it('zooms in and out from Fit with the wheel, faster with Shift, within the limits', () => {
    const inward = wheelZoom(0, fit, -100);
    expect(inward).toBeGreaterThan(fit);
    expect(wheelZoom(0, fit, -100, true)).toBeGreaterThan(inward);
    expect(wheelZoom(0, fit, 100)).toBeLessThan(fit);
    expect(wheelZoom(MAX_ZOOM, fit, -240)).toBe(MAX_ZOOM);
    expect(wheelZoom(MIN_ZOOM, fit, 240)).toBe(MIN_ZOOM);
  });

  it('stops on Fit when a zoom passes through it, either way', () => {
    expect(wheelZoom(0.45, fit, 100)).toBe(0);
    expect(wheelZoom(0.4, fit, -100)).toBe(0);
    // From Fit it carries on past it.
    expect(wheelZoom(0, fit, 100)).toBeGreaterThan(0);
  });

  it('steps through the zoom levels with Fit among them, and toggles Fit with 100%', () => {
    expect(stepZoom(0, fit, 1)).toBe(0.5);
    expect(stepZoom(0, fit, -1)).toBe(0.25);
    expect(stepZoom(0.25, fit, 1)).toBe(0);
    expect(stepZoom(8, fit, 1)).toBe(8);
    expect(toggleFit(0)).toBe(1);
    expect(toggleFit(2)).toBe(0);
  });

  it('reads the wheel in pixels whatever the device reports, Shift + wheel included', () => {
    expect(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false })).toBe(48);
    expect(wheelDelta({ deltaX: -120, deltaY: 0, deltaMode: 0, shiftKey: true })).toBe(-120);
    expect(wheelDelta({ deltaX: -120, deltaY: 0, deltaMode: 0, shiftKey: false })).toBe(0);
  });
});

describe('a zoomed monitor pans to every edge', () => {
  // With plain `center` on the scroll area, a picture zoomed wider than the monitor put half its
  // overflow past the left and top edges, where no scrolling reaches: middle-drag could pan right
  // and down but never back to the left side of the picture. `safe center` starts it at the edge.
  it('centres the picture safely, so its overflow stays scrollable', () => {
    const css = readFileSync('src/styles/app.css', 'utf8');
    const rule = /\.monitor-frame \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('justify-content: safe center');
    expect(rule).toContain('align-items: safe center');
  });
});
