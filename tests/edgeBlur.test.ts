import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { edgeBlurDefs, edgeBlurId, keepEdges } from '../src/editor/edgeBlur';

describe('edge-keeping blur in the preview', () => {
  it('swaps every CSS blur for the filter that keeps the picture edges, leaving the rest', () => {
    const { filter, radii } = keepEdges('brightness(1.2) blur(12px) contrast(1.1) blur( 3.25px )');
    expect(filter).toBe(`brightness(1.2) url(#${edgeBlurId(12)}) contrast(1.1) url(#${edgeBlurId(3.3)})`);
    expect(radii).toEqual([12, 3.3]);
  });

  it('leaves a filter with no blur, or no filter, alone', () => {
    expect(keepEdges('saturate(1.4)')).toEqual({ filter: 'saturate(1.4)', radii: [] });
    expect(keepEdges(undefined)).toEqual({ filter: undefined, radii: [] });
    expect(keepEdges('blur(0px)')).toEqual({ filter: undefined, radii: [] });
  });

  it('defines one filter per radius, clipped to the element, normalising colour and alpha', () => {
    const markup = renderToStaticMarkup(createElement('svg', null, createElement('defs', null, ...edgeBlurDefs([12, 12, 4]))));
    expect(markup.match(/<filter /g)).toHaveLength(2);
    expect(markup).toContain(`id="${edgeBlurId(12)}" x="0" y="0" width="1" height="1"`);
    // Two blurs (colour, and alpha over a solid box) recombined with `in`.
    expect(markup.match(/<feGaussianBlur/g)).toHaveLength(4);
    expect(markup).toContain('operator="in"');
  });
});
