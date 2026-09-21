import { describe, expect, it } from 'vitest';

export type BinViewMode = 'list' | 'icon';
export type ThumbnailSizeCategory = 'small-icons' | 'medium-thumbnails' | 'large-thumbnails';

export function getBinViewFromSlider(val: number): { view: BinViewMode; size: number } {
  if (val <= 60) {
    return { view: 'list', size: 50 };
  }
  return { view: 'icon', size: val };
}

export function getThumbnailCategory(size: number): ThumbnailSizeCategory {
  if (size < 95) return 'small-icons';
  if (size < 160) return 'medium-thumbnails';
  return 'large-thumbnails';
}

describe('Project Bin View & Premiere Pro Slider Logic', () => {
  it('switches to list view when slider is at or below 60', () => {
    expect(getBinViewFromSlider(50)).toEqual({ view: 'list', size: 50 });
    expect(getBinViewFromSlider(60)).toEqual({ view: 'list', size: 50 });
  });

  it('switches to icon view and scales size smoothly when slider is above 60', () => {
    expect(getBinViewFromSlider(65)).toEqual({ view: 'icon', size: 65 });
    expect(getBinViewFromSlider(132)).toEqual({ view: 'icon', size: 132 });
    expect(getBinViewFromSlider(240)).toEqual({ view: 'icon', size: 240 });
  });

  it('categorizes thumbnail sizes into small icons, medium thumbnails, and large thumbnails', () => {
    expect(getThumbnailCategory(70)).toBe('small-icons');
    expect(getThumbnailCategory(90)).toBe('small-icons');
    expect(getThumbnailCategory(96)).toBe('medium-thumbnails');
    expect(getThumbnailCategory(132)).toBe('medium-thumbnails');
    expect(getThumbnailCategory(160)).toBe('large-thumbnails');
    expect(getThumbnailCategory(220)).toBe('large-thumbnails');
  });
});
