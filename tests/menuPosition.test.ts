// Where dropdowns and submenus open (components/workspace.tsx menuPosition).
import { describe, expect, it } from 'vitest';
import { menuPosition } from '../src/components/workspace';

const view = { width: 1000, height: 600 };
const size = { width: 200, height: 120 };
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
const overlaps = (a: { left: number; width: number }, b: ReturnType<typeof rect>) => a.left < b.right - 2 && a.left + a.width > b.left + 2;

describe('submenus', () => {
  it('open to the right of the parent menu when there is room', () => {
    const parent = rect(100, 100, 230, 200);
    const at = menuPosition(size, view, { row: rect(100, 180, 230, 24), parent });
    expect(at).toEqual({ left: 328, top: 176 });
  });

  it('open to the left of the parent at the window\'s right edge, never over it', () => {
    // The Audio Visualizer panel's menu, hard against the right edge.
    const parent = rect(760, 60, 230, 200);
    const at = menuPosition(size, view, { row: rect(760, 200, 230, 24), parent });
    expect(at.left).toBe(562);
    expect(overlaps({ left: at.left, width: size.width }, parent)).toBe(false);
  });

  it('slide up just enough near the bottom instead of flipping over the parent', () => {
    const parent = rect(100, 400, 230, 190);
    const at = menuPosition(size, view, { row: rect(100, 560, 230, 24), parent });
    expect(at.top).toBe(600 - 120 - 4);
    expect(at.left).toBe(328);
  });

  it('stay inside the window when neither side fits', () => {
    const wide = { width: 600, height: 120 };
    const at = menuPosition(wide, view, { row: rect(300, 100, 400, 24), parent: rect(300, 80, 400, 200) });
    expect(at.left).toBeGreaterThanOrEqual(4);
    expect(at.left + wide.width).toBeLessThanOrEqual(996);
  });
});

describe('dropdowns', () => {
  it('open below the anchor, above it when there is no room below, and never off screen', () => {
    expect(menuPosition(size, view, { anchor: rect(50, 40, 20, 20), align: 'left' })).toEqual({ left: 50, top: 62 });
    expect(menuPosition(size, view, { anchor: rect(50, 540, 20, 20), align: 'left' }).top).toBe(540 - 120 - 2);
    expect(menuPosition(size, view, { anchor: rect(980, 40, 20, 20), align: 'left' }).left).toBe(1000 - 200 - 4);
    const tall = { width: 200, height: 580 };
    const at = menuPosition(tall, view, { anchor: rect(50, 300, 20, 20), align: 'left' });
    expect(at.top).toBeGreaterThanOrEqual(4);
    expect(at.top + tall.height).toBeLessThanOrEqual(596);
  });
});
