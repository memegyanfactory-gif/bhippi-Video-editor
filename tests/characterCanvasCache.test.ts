import { describe, expect, it, vi } from 'vitest';
import * as svg from '../src/motion/vector/svg';
import * as path from '../src/motion/vector/path';
import { drawSvgMarkup } from '../src/motion/character/svgCanvas';

function context() {
  const painted: unknown[] = [];
  const state: Record<PropertyKey, unknown> = {};
  const noop = () => undefined;
  const ctx = new Proxy(state, {
    get: (target, key) => key === 'fill' ? () => painted.push(target.fillStyle) : target[key] ?? noop,
    set: (target, key, value) => { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, painted };
}

describe('character canvas drawing cache', () => {
  it('reuses XML and fallback path geometry across repeated renders while painting every frame', () => {
    const parse = vi.spyOn(svg, 'parseXml');
    const geometry = vi.spyOn(path, 'parseSvgPath');
    const { ctx, painted } = context();
    const markup = '<path d="M0 0L11 0L11 13Z" fill="#a1b2c3"/>';
    try {
      drawSvgMarkup(ctx, markup);
      drawSvgMarkup(ctx, markup);
      expect(parse).toHaveBeenCalledTimes(1);
      expect(geometry).toHaveBeenCalledTimes(1);
      expect(painted).toEqual(['#a1b2c3', '#a1b2c3']);
      drawSvgMarkup(ctx, markup.replace('#a1b2c3', '#f1e2d3'));
      expect(parse).toHaveBeenCalledTimes(2);
      expect(painted.at(-1)).toBe('#f1e2d3');
    } finally { parse.mockRestore(); geometry.mockRestore(); }
  });

  it('evicts old trees and bypasses oversized SVGs without disturbing a recent small drawing', () => {
    const parse = vi.spyOn(svg, 'parseXml');
    const { ctx } = context();
    const at = (i: number) => `<path d="M0 0L${i + 100} 0L3 4Z" fill="#123456"/>`;
    try {
      for (let i = 0; i < 80; i++) drawSvgMarkup(ctx, at(i));
      const afterPlayback = parse.mock.calls.length;
      drawSvgMarkup(ctx, at(79));
      expect(parse).toHaveBeenCalledTimes(afterPlayback);
      drawSvgMarkup(ctx, at(0));
      expect(parse).toHaveBeenCalledTimes(afterPlayback + 1);
      const oversized = `<!--${'x'.repeat(1_100_000)}-->${at(99)}`;
      drawSvgMarkup(ctx, oversized);
      drawSvgMarkup(ctx, oversized);
      expect(parse).toHaveBeenCalledTimes(afterPlayback + 3);
      drawSvgMarkup(ctx, at(0));
      expect(parse).toHaveBeenCalledTimes(afterPlayback + 3);
    } finally { parse.mockRestore(); }
  });

  it('reuses pattern tiles within a canvas but creates paint for a separate export context', () => {
    const tile = context();
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return tile.ctx; } });
    const preview = context(), exported = context();
    const previewPaint = { from: 'preview' }, exportPaint = { from: 'export' };
    const previewPattern = vi.fn(() => previewPaint), exportPattern = vi.fn(() => exportPaint);
    Object.assign(preview.ctx, { createPattern: previewPattern });
    Object.assign(exported.ctx, { createPattern: exportPattern });
    const markup = '<defs><pattern id="context-tile" width="4" height="4"><rect width="2" height="2" fill="#abc"/></pattern></defs><rect width="20" height="20" fill="url(#context-tile)"/>';
    try {
      drawSvgMarkup(preview.ctx, markup);
      drawSvgMarkup(preview.ctx, markup);
      drawSvgMarkup(exported.ctx, markup);
      expect(previewPattern).toHaveBeenCalledTimes(1);
      expect(exportPattern).toHaveBeenCalledTimes(1);
      expect(preview.painted).toEqual([previewPaint, previewPaint]);
      expect(exported.painted).toEqual([exportPaint]);
    } finally { vi.unstubAllGlobals(); }
  });
});
