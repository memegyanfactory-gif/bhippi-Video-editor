// Split screens that suit the frame they are in, the way short-form and YouTube editors build them
// (conventions gathered 2026: OpusClip, TikTok Duet layouts, vertical gaming/podcast guides):
//
//   · 9:16 — stacked, full width: two people 50/50, facecam over gameplay/B-roll 40/60, three-up
//     for panels; the caption sits on the seam between the halves. PiP facecams go top-left, out of
//     the right-hand button rail and the bottom caption zone.
//   · 16:9 — side by side (50/50, or 60/40 for a guest), a 2×2 grid, a PiP facecam at ~28% width
//     bottom-right.
//   · 1:1 and 4:5 — stacked like vertical for two, a grid for four.
//
// Each cell is filled edge to edge: the clip is cropped to the cell's shape (centred, or on the
// `focus` point, e.g. the speaker's face) and scaled to it. Gutters are a few pixels, as in the wild.
import type { Box } from './layout';
import { safeFor } from './layout';
import type { Comp, Transform } from './types';

export type SplitLayout = 'auto' | 'stack' | 'side-by-side' | 'grid' | 'triple' | 'pip';

export type SplitOptions = {
  /** Share of the first cell along the split (0.2–0.8): 0.5 even, 0.4 facecam-over-gameplay. */
  ratio?: number;
  /** Gutter between cells, px at a 1080 short side (0–40, default 6). */
  gutter?: number;
  /** PiP: which corner, and its width as a share of the frame's width. */
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipSize?: number;
};

/** What `auto` means for this frame and number of clips. */
export function autoLayout(comp: Pick<Comp, 'width' | 'height'>, count: number): Exclude<SplitLayout, 'auto'> {
  if (count >= 4) return 'grid';
  if (count === 3) return 'triple';
  return comp.width > comp.height * 1.05 ? 'side-by-side' : 'stack';
}

/**
 * The cells of a layout, in frame units (0..1). Cell 0 is the top / left / main one. For `pip`,
 * cell 1 is a box of the PiP's width whose height the caller sets from the picture (see pipBox).
 */
export function splitCells(comp: Pick<Comp, 'width' | 'height'>, layout: SplitLayout, count: number, options: SplitOptions = {}): Box[] {
  const kind = layout === 'auto' ? autoLayout(comp, count) : layout;
  const short = Math.min(comp.width, comp.height);
  const gx = ((options.gutter ?? 6) / 1080) * short / comp.width;
  const gy = ((options.gutter ?? 6) / 1080) * short / comp.height;
  const ratio = Math.min(0.8, Math.max(0.2, options.ratio ?? 0.5));
  switch (kind) {
    case 'stack': {
      if (count <= 1) return [{ x: 0, y: 0, width: 1, height: 1 }];
      if (count === 2) return [{ x: 0, y: 0, width: 1, height: ratio - gy / 2 }, { x: 0, y: ratio + gy / 2, width: 1, height: 1 - ratio - gy / 2 }];
      return rows(count, gy);
    }
    case 'side-by-side': {
      if (count <= 1) return [{ x: 0, y: 0, width: 1, height: 1 }];
      if (count === 2) return [{ x: 0, y: 0, width: ratio - gx / 2, height: 1 }, { x: ratio + gx / 2, y: 0, width: 1 - ratio - gx / 2, height: 1 }];
      return columns(count, gx);
    }
    case 'triple':
      return comp.width > comp.height * 1.05 ? columns(3, gx) : rows(3, gy);
    case 'grid': {
      const w = (1 - gx) / 2;
      const h = (1 - gy) / 2;
      return [{ x: 0, y: 0, width: w, height: h }, { x: w + gx, y: 0, width: w, height: h }, { x: 0, y: h + gy, width: w, height: h }, { x: w + gx, y: h + gy, width: w, height: h }].slice(0, Math.max(1, Math.min(4, count)));
    }
    case 'pip':
      return [{ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: options.pipSize ?? (comp.height > comp.width ? 0.3 : 0.28), height: 0 }];
  }
}

function rows(count: number, gap: number): Box[] {
  const h = (1 - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: i * (h + gap), width: 1, height: h }));
}

function columns(count: number, gap: number): Box[] {
  const w = (1 - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: i * (w + gap), y: 0, width: w, height: 1 }));
}

/**
 * The PiP box for a picture of `sourceW`×`sourceH`: `width` of the frame wide, the picture's own
 * shape, tucked into `corner` inside the safe area. Vertical frames default to top-left (clear of
 * the button rail and the caption zone), wide ones to bottom-right.
 */
export function pipBox(comp: Pick<Comp, 'width' | 'height'>, sourceW: number, sourceH: number, width: number, corner?: SplitOptions['corner']): Box {
  const safe = safeFor(comp.width, comp.height);
  const place = corner ?? (comp.height > comp.width ? 'top-left' : 'bottom-right');
  const height = (width * comp.width * (sourceH / Math.max(1, sourceW))) / comp.height;
  const x = place.endsWith('left') ? safe.left : 1 - safe.right - width;
  const y = place.startsWith('top') ? safe.top : 1 - safe.bottom - height;
  return { x, y, width, height };
}

/**
 * The transform that fills `cell` with a picture of `sourceW`×`sourceH`: cropped to the cell's
 * shape around `focus` (source fractions, default the centre), then scaled and placed. Matches the
 * editor's placement (lib/editor.ts) and the export's, which size a cropped picture by its crop.
 */
export function fillCell(transform: Transform, sourceW: number, sourceH: number, comp: Pick<Comp, 'width' | 'height'>, cell: Box, focus: { x: number; y: number } = { x: 0.5, y: 0.5 }): Transform {
  const cellW = cell.width * comp.width;
  const cellH = cell.height * comp.height;
  const sourceAspect = sourceW / Math.max(1, sourceH);
  const cellAspect = cellW / Math.max(1e-6, cellH);
  let keepW = 1;
  let keepH = 1;
  if (sourceAspect > cellAspect) keepW = cellAspect / sourceAspect;
  else keepH = sourceAspect / cellAspect;
  // The kept window, centred on the focus but never past the picture's edge.
  const left = Math.min(1 - keepW, Math.max(0, focus.x - keepW / 2));
  const top = Math.min(1 - keepH, Math.max(0, focus.y - keepH / 2));
  const cropW = sourceW * keepW;
  const cropH = sourceH * keepH;
  const unit = Math.min(comp.width / cropW, comp.height / cropH);
  const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
  return {
    ...transform,
    fit: 'fit',
    scale: round((100 * cellW) / (cropW * unit), 3),
    x: round(cell.x + cell.width / 2 - 0.5),
    y: round(cell.y + cell.height / 2 - 0.5),
    rotation: 0,
    cropLeft: round(left * 100, 3),
    cropRight: round((1 - keepW - left) * 100, 3),
    cropTop: round(top * 100, 3),
    cropBottom: round((1 - keepH - top) * 100, 3),
  };
}

/** Where a caption belongs in the layout: on the seam of a vertical stack, else the usual lower band. */
export function captionBand(comp: Pick<Comp, 'width' | 'height'>, layout: Exclude<SplitLayout, 'auto'>, cells: Box[]): { y: number; note: string } {
  if ((layout === 'stack' || layout === 'triple') && cells.length >= 2) {
    const seam = cells[0].y + cells[0].height;
    return { y: seam, note: `put captions on the seam between the top and bottom pictures (y ≈ ${Math.round(seam * 100)}% of the height)` };
  }
  const safe = safeFor(comp.width, comp.height);
  return { y: 1 - safe.bottom - 0.08, note: 'captions go in the lower band, inside the safe area' };
}
