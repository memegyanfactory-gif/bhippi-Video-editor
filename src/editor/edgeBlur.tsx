// Blur that keeps a picture's edges, the way the export blurs (FFmpeg's gblur repeats the edge
// pixels). CSS `blur()` counts everything outside the element as transparent black, so a blurred
// full-frame shot faded to a dark rim in the preview that the export never had — the very rim a
// blurred fill_background is there to hide. Chromium ignores `edgeMode` on feGaussianBlur, so this
// filter blurs and then divides by how much of the blur fell inside the picture: colour and alpha
// become the weighted average of the picture's own pixels (inside, exactly what CSS blur gives),
// and nothing spills past the element's box — as in the export.

import type { ReactNode } from 'react';

const CSS_BLUR = /blur\(\s*([\d.]+)px\s*\)/g;

/** One filter per radius (to a tenth of a pixel), shared by every clip that blurs by it. */
export const edgeBlurId = (px: number) => `helios-edge-blur-${Math.round(px * 10)}`;

/** `filter` with each CSS `blur(Npx)` swapped for the edge-keeping blur, and the radii those need. */
export function keepEdges(filter: string | undefined): { filter: string | undefined; radii: number[] } {
  if (!filter) return { filter, radii: [] };
  const radii: number[] = [];
  const swapped = filter.replace(CSS_BLUR, (_, value: string) => {
    const px = Math.round(Number(value) * 10) / 10;
    if (!(px > 0)) return '';
    radii.push(px);
    return `url(#${edgeBlurId(px)})`;
  });
  return { filter: swapped.replace(/\s+/g, ' ').trim() || undefined, radii };
}

function EdgeBlurFilter({ px }: { px: number }) {
  return (
    <filter id={edgeBlurId(px)} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
      {/* The picture blurred, then made opaque: its colour divided by the alpha the blur left. */}
      <feGaussianBlur in="SourceGraphic" stdDeviation={px} result="colour" />
      <feColorMatrix in="colour" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1" result="solid" />
      {/* Its alpha as colour over a box that is opaque everywhere inside the element; blurred the
          same way and divided, that is the picture's own alpha blurred without the outside. */}
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1" result="coverage" />
      <feGaussianBlur in="coverage" stdDeviation={px} result="spread" />
      <feColorMatrix in="spread" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="alpha" />
      <feComposite in="solid" in2="alpha" operator="in" />
    </filter>
  );
}

/** The filter definitions for these radii, once each. */
export function edgeBlurDefs(radii: Iterable<number>): ReactNode[] {
  return [...new Set(radii)].map((px) => <EdgeBlurFilter key={edgeBlurId(px)} px={px} />);
}
