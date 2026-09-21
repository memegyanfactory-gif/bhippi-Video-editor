import { afterEach, expect, it, vi } from 'vitest';
import { canvasImage } from '../src/lib/canvasImage';
import { automaticRotoEngine } from '../src/lib/rotoEngine';
import type { RotoCorrection } from '../src/lib/types';
afterEach(() => vi.unstubAllGlobals());
it('sets anonymous CORS before requesting canvas input', async () => {
  const order: string[] = [];
  class FakeImage {
    onload = () => {}; onerror = () => {};
    set crossOrigin(value: string) { order.push(value); }
    set src(value: string) { order.push(value); this.onload(); }
  }
  vi.stubGlobal('Image', FakeImage);
  await canvasImage('http://asset.localhost/mask.png');
  expect(order).toEqual(['anonymous', 'http://asset.localhost/mask.png']);
});
it('rejects inaccessible frames instead of leaving inference pending', async () => {
  class FakeImage { crossOrigin = ''; onerror = () => {}; set src(_: string) { this.onerror(); } }
  vi.stubGlobal('Image', FakeImage);
  await expect(canvasImage('missing')).rejects.toThrow('Cannot load');
});
it('runs automatic person Roto without a seed and SAM only with a first-frame foreground seed', () => {
  expect(automaticRotoEngine('sam2-vitmatte', [], 30)).toBe('rvm');
  const seed = { at: 0, mode: 'include' } as RotoCorrection;
  expect(automaticRotoEngine('sam2-vitmatte', [seed], 30)).toBe('sam2-vitmatte');
  expect(automaticRotoEngine('sam2-vitmatte', [{ ...seed, at: 1 }], 30)).toBe('rvm');
});
