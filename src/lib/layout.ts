// Where a graphic goes, and what stops two of them landing on the same pixels.
//
// Helios used to place whatever it was told wherever it was told, which is how a title and three
// caption samples ended up stacked on top of each other. The reference film never does that: the
// frame is a set of slots, each slot holds one thing, type sits beside the speaker rather than
// over him, and when a card takes the middle the words move to an edge.
//
// So a frame here is a grid with a safe area, a set of named slots, and a record of what is
// already in them. Asking for a slot that is taken gives you the nearest free one instead, and
// asking for a slot over the subject moves you off him. Nothing overlaps because nothing can.
import type { Comp } from './types';

/** A rectangle in frame units: 0..1 across and down, origin top-left. */
export type Box = { x: number; y: number; width: number; height: number };

export type SlotName =
  | 'full'
  | 'upper-third' | 'lower-third' | 'centre'
  | 'left-half' | 'right-half'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'caption';

/**
 * The margin nothing important crosses. Broadcast uses 10%; short-form needs more, where the
 * platform puts its own chrome.
 *
 * SOCIAL_SAFE is the one box clear on TikTok, Reels and Shorts together for organic posts (2026):
 * the top 12% holds the tabs and search, the bottom 20% the caption, handle, audio and CTA, and the
 * right 13% the like/comment/share rail (TikTok's is 120–140 px of 1080). A caption at y=0.95 or a
 * card in the right strip is under the buttons. Meta's ad guidance is stricter (35% at the bottom);
 * ads should keep type above 0.65.
 */
export const SAFE = { top: 0.06, bottom: 0.06, left: 0.05, right: 0.05 };
export const SOCIAL_SAFE = { top: 0.12, bottom: 0.2, left: 0.06, right: 0.13 };
/** Feed posts (4:5, 3:4, 1:1) have no button rail; Instagram's grid trims about 3% off each side of a 4:5. */
export const FEED_SAFE = { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 };

/** The safe margins for a frame's shape: social for 9:16-like, feed for 4:5 / 3:4 / 1:1, broadcast for wide. */
export function safeFor(width: number, height: number): typeof SAFE {
  const tall = height / Math.max(1, width);
  if (tall >= 1.6) return SOCIAL_SAFE;
  if (tall >= 0.98) return FEED_SAFE;
  return SAFE;
}

export type Frame = {
  width: number;
  height: number;
  /** True for 9:16 and other tall frames, which need the social margins. */
  vertical: boolean;
  safe: typeof SAFE;
};

export const frameOf = (comp: Comp): Frame => {
  const vertical = comp.height > comp.width;
  return { width: comp.width, height: comp.height, vertical, safe: safeFor(comp.width, comp.height) };
};

/** The usable rectangle: the frame minus its safe margins. */
export function safeArea(frame: Frame): Box {
  return {
    x: frame.safe.left,
    y: frame.safe.top,
    width: 1 - frame.safe.left - frame.safe.right,
    height: 1 - frame.safe.top - frame.safe.bottom,
  };
}

export function slotBox(frame: Frame, slot: SlotName): Box {
  const area = safeArea(frame);
  const third = area.height / 3;
  const half = area.width / 2;
  const gutter = 0.02;
  switch (slot) {
    case 'full':
      return area;
    case 'upper-third':
      return { x: area.x, y: area.y, width: area.width, height: third };
    case 'centre':
      return { x: area.x, y: area.y + third, width: area.width, height: third };
    case 'lower-third':
      return { x: area.x, y: area.y + third * 2, width: area.width, height: third };
    case 'left-half':
      return { x: area.x, y: area.y, width: half - gutter, height: area.height };
    case 'right-half':
      return { x: area.x + half + gutter, y: area.y, width: half - gutter, height: area.height };
    case 'top-left':
      return { x: area.x, y: area.y, width: half - gutter, height: third };
    case 'top-right':
      return { x: area.x + half + gutter, y: area.y, width: half - gutter, height: third };
    case 'bottom-left':
      return { x: area.x, y: area.y + third * 2, width: half - gutter, height: third };
    case 'bottom-right':
      return { x: area.x + half + gutter, y: area.y + third * 2, width: half - gutter, height: third };
    case 'caption':
      // Captions live low but above the platform's own furniture, and never full width.
      return { x: area.x + area.width * 0.1, y: area.y + area.height * (frame.vertical ? 0.62 : 0.72), width: area.width * 0.8, height: area.height * 0.2 };
    default:
      return area;
  }
}

/**
 * The largest part of `box` that does not cover `blocker` — the strip left, right, above or below
 * it. This is what the reference film does with its opening title: the speaker stands in the
 * middle, so *Motion* takes the space to his left and *Design* the space to his right. A slot is
 * only unusable once the remainder is too small to read in.
 */
export function carve(box: Box, blocker: Box, least = 0.18): Box | null {
  if (!overlaps(box, blocker, 0)) return box;
  const options: Box[] = [
    { x: box.x, y: box.y, width: Math.max(0, blocker.x - box.x), height: box.height },
    { x: Math.max(box.x, blocker.x + blocker.width), y: box.y, width: Math.max(0, box.x + box.width - (blocker.x + blocker.width)), height: box.height },
    { x: box.x, y: box.y, width: box.width, height: Math.max(0, blocker.y - box.y) },
    { x: box.x, y: Math.max(box.y, blocker.y + blocker.height), width: box.width, height: Math.max(0, box.y + box.height - (blocker.y + blocker.height)) },
  ];
  const usable = options
    .filter((option) => option.width >= least && option.height >= 0.08)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return usable[0] ?? null;
}

export const overlaps = (a: Box, b: Box, slack = 0.01) =>
  a.x < b.x + b.width - slack && a.x + a.width > b.x + slack && a.y < b.y + b.height - slack && a.y + a.height > b.y + slack;

export const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Where a transform must put a layer for its centre to land on `box`'s centre. */
export const offsetFor = (box: Box) => ({ x: centreOf(box).x - 0.5, y: centreOf(box).y - 0.5 });

// ── keeping track of what is already on screen ────────────────────────────

export type Placed = { id: string; slot: SlotName; box: Box; weight: number };

/**
 * The frame's occupancy at one moment. `subject` is where the person is, when that is known — the
 * reference film puts type on the side the speaker is not using, and so does this.
 */
export class Occupancy {
  private readonly items: Placed[] = [];

  constructor(
    readonly frame: Frame,
    /** The subject's box, if the footage has been looked at. */
    readonly subject: Box | null = null,
    /**
     * True when the subject has been separated from their background, so a graphic can be drawn
     * *behind* them. That changes the rule entirely: without a matte the speaker's box is a
     * no-go area, but with one, type may run behind him — which is exactly how the reference film
     * puts "Motion" partly behind the presenter's shoulder. The type is still biased to the side
     * he is not using, so most of it stays readable.
     */
    readonly behind = false,
  ) {}

  get placed(): readonly Placed[] {
    return this.items;
  }

  taken(box: Box): boolean {
    if (this.items.some((item) => overlaps(item.box, box))) return true;
    // Without a matte the speaker is a no-go area. With one he is drawn on top, so he is not.
    return !this.behind && !!this.subject && overlaps(this.subject, box, 0.02);
  }

  add(id: string, slot: SlotName, weight = 1): Placed {
    return this.addBox(id, slot, slotBox(this.frame, slot), weight);
  }

  /** Records the box actually used, which may be a slot carved around the subject. */
  addBox(id: string, slot: SlotName, box: Box, weight = 1): Placed {
    const placed = { id, slot, box, weight };
    this.items.push(placed);
    return placed;
  }
}

/** Slots in the order a designer would reach for them, given what a graphic is for. */
const PREFERENCE: Record<string, SlotName[]> = {
  title: ['centre', 'upper-third', 'lower-third', 'left-half', 'right-half'],
  hook: ['centre', 'upper-third', 'lower-third'],
  caption: ['caption', 'lower-third', 'upper-third'],
  'lower-third': ['bottom-left', 'bottom-right', 'lower-third'],
  card: ['right-half', 'left-half', 'centre', 'bottom-right'],
  list: ['left-half', 'right-half', 'centre'],
  label: ['bottom-left', 'bottom-right', 'top-left', 'top-right'],
  thumbnail: ['bottom-right', 'bottom-left', 'top-right', 'top-left'],
  statement: ['centre', 'upper-third', 'lower-third'],
};

const ALL: SlotName[] = [
  'centre', 'upper-third', 'lower-third', 'left-half', 'right-half',
  'top-left', 'top-right', 'bottom-left', 'bottom-right', 'caption',
];

export type Placement = {
  slot: SlotName;
  box: Box;
  /** Where to put the layer's centre, as a transform offset in frame units. */
  offset: { x: number; y: number };
  /** True when the first choice was taken and this is the fallback. */
  moved: boolean;
  /** Why it moved, for the assistant to read back. */
  note: string | null;
};

/**
 * Finds room for one graphic. It tries what the kind of graphic wants first, then everything else,
 * and only gives up — returning the least-bad slot — when the frame is genuinely full.
 */
export function place(occupancy: Occupancy, kind: keyof typeof PREFERENCE | string, id: string, wanted?: SlotName): Placement {
  const order = [...(wanted ? [wanted] : []), ...(PREFERENCE[kind] ?? PREFERENCE.title), ...ALL];
  const seen = new Set<SlotName>();
  let first: SlotName | null = null;

  // With a matte, lead with the half the subject is not standing in: the graphic may pass behind
  // him, but it should still be mostly visible.
  const side = occupancy.behind ? freeSide(occupancy.subject) : null;
  if (side) order.unshift(side === 'left' ? 'left-half' : 'right-half');

  for (const slot of order) {
    if (seen.has(slot)) continue;
    seen.add(slot);
    first ??= slot;
    const full = slotBox(occupancy.frame, slot);
    // Beside the speaker rather than not at all: what is left of the slot once he is out of it.
    // When he can be drawn over the graphic, the slot is used whole.
    const box = occupancy.subject && !occupancy.behind ? carve(full, occupancy.subject) : full;
    if (!box) continue;
    if (occupancy.placed.some((item) => overlaps(item.box, box))) continue;
    occupancy.addBox(id, slot, box);
    const carved = box !== full;
    return {
      slot,
      box,
      offset: offsetFor(box),
      moved: slot !== first,
      note: slot === first
        ? (carved ? 'moved beside the subject' : null)
        : `${first} was taken, so this went to ${slot}${carved ? ', beside the subject' : ''}`,
    };
  }

  // Everything is occupied: stack it where it was asked for and say so, rather than pretending.
  const slot = first ?? 'centre';
  const box = slotBox(occupancy.frame, slot);
  occupancy.add(id, slot);
  return { slot, box, offset: offsetFor(box), moved: false, note: 'the frame is full; this one overlaps' };
}

/**
 * The side of the frame the speaker is not using. The reference film puts its type beside the
 * person, which only works if you know which half he is standing in.
 */
export function freeSide(subject: Box | null): 'left' | 'right' | null {
  if (!subject) return null;
  return centreOf(subject).x > 0.5 ? 'left' : 'right';
}

/** How many lines of caption fit, at a given type size, without crowding the frame. */
export function captionLines(frame: Frame, sizePercent: number): number {
  const box = slotBox(frame, 'caption');
  const lineHeight = (sizePercent / 100) * 1.25;
  return Math.max(1, Math.floor(box.height / lineHeight));
}

// ── what the roto pass found ──────────────────────────────────────────────

/** The subject boxes a matting pass produced, as `lib/roto.ts` caches them. */
export type SubjectTrack = { at: number; x: number; y: number; width: number; height: number; cover: number }[];

/**
 * The box to keep clear across a span of *source* time.
 *
 * A graphic that stays up for three seconds has to avoid everywhere the subject goes in those
 * three seconds, not where they happened to be when it appeared — otherwise the speaker walks
 * into the title. So this is the union of the frames inside the span, padded a little because a
 * matte's edge is soft and type should not graze it.
 */
export function subjectBox(track: SubjectTrack, from: number, to: number, pad = 0.015): Box | null {
  const inside = track.filter((frame) => frame.cover > 0.01 && frame.at >= from - 1e-6 && frame.at <= to + 1e-6);
  const frames = inside.length
    ? inside
    : track.filter((frame) => frame.cover > 0.01).sort((a, b) => Math.abs(a.at - (from + to) / 2) - Math.abs(b.at - (from + to) / 2)).slice(0, 1);
  if (frames.length === 0) return null;

  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    x: Math.max(0, left - pad),
    y: Math.max(0, top - pad),
    width: Math.min(1, right + pad) - Math.max(0, left - pad),
    height: Math.min(1, bottom + pad) - Math.max(0, top - pad),
  };
}

/** A frame that knows where the speaker is, ready to be placed into. */
export const frameWithSubject = (frame: Frame, track: SubjectTrack, from: number, to: number, behind = false) =>
  new Occupancy(frame, subjectBox(track, from, to), behind);
