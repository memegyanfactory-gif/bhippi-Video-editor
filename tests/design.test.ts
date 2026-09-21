import { describe, expect, it } from 'vitest';
import { brandSummary, brandVars, deriveBrand, DEFAULT_BRAND } from '../src/lib/brand';
import { captionLines, freeSide, frameOf, frameWithSubject, Occupancy, overlaps, place, safeArea, slotBox, subjectBox } from '../src/lib/layout';
import { CURVES, findMove, MOVES, PRINCIPLES, sampleCurve, staggerTimes, wordTimes } from '../src/lib/motion';
import { newComp } from '../src/lib/timeline';
import { brandFromPack, findPack, packCatalogue, STYLE_PACKS } from '../src/lib/stylePacks';
import { findMove as findMoveByName } from '../src/lib/motion';

const wide = frameOf(newComp({ name: 'Wide', width: 1920, height: 1080, fps: 30 }));
const tall = frameOf(newComp({ name: 'Reel', width: 1080, height: 1920, fps: 30 }));

describe('layout: nothing lands on anything else', () => {
  it('keeps everything inside the safe area, with more room on a phone', () => {
    const area = safeArea(wide);
    expect(area.x).toBeGreaterThan(0);
    expect(area.x + area.width).toBeLessThanOrEqual(1);
    // A vertical frame reserves more at the bottom, where the platform puts its own buttons.
    expect(safeArea(tall).height).toBeLessThan(area.height);
    expect(slotBox(tall, 'caption').y + slotBox(tall, 'caption').height).toBeLessThan(0.86);
  });

  it('moves the second graphic when the first has taken the slot', () => {
    const frame = new Occupancy(wide);
    const title = place(frame, 'title', 'title-1');
    expect(title.slot).toBe('centre');
    expect(title.moved).toBe(false);

    // This is the bug from the screenshot: three more titles asking for the same middle.
    const second = place(frame, 'title', 'title-2');
    const third = place(frame, 'title', 'title-3');
    expect(second.slot).not.toBe('centre');
    expect(second.moved).toBe(true);
    expect(second.note).toContain('taken');
    expect(overlaps(title.box, second.box)).toBe(false);
    expect(overlaps(title.box, third.box)).toBe(false);
    expect(overlaps(second.box, third.box)).toBe(false);
  });

  it('will not put type over the speaker', () => {
    // The speaker stands in the middle-right of frame, as in the reference film.
    const subject = { x: 0.42, y: 0.15, width: 0.36, height: 0.8 };
    const frame = new Occupancy(wide, subject);
    const title = place(frame, 'title', 't');
    expect(overlaps(title.box, subject, 0.02)).toBe(false);
    // The free side is the one he is not standing in: he is right of centre, so type goes left.
    expect(freeSide(subject)).toBe('left');
    expect(freeSide({ x: 0.05, y: 0.1, width: 0.4, height: 0.8 })).toBe('right');
    expect(freeSide(null)).toBeNull();
  });

  it('says so when the frame really is full instead of pretending', () => {
    const frame = new Occupancy(wide);
    const placements = Array.from({ length: 12 }, (_, index) => place(frame, 'title', `x${index}`));
    const last = placements[placements.length - 1];
    expect(last.note).toContain('full');
  });

  it('works out how many caption lines fit', () => {
    expect(captionLines(wide, 6)).toBeGreaterThanOrEqual(1);
    // Bigger type, fewer lines.
    expect(captionLines(wide, 12)).toBeLessThanOrEqual(captionLines(wide, 6));
  });
});

describe('motion: the principles as numbers', () => {
  it('curves run from 0 to 1, and overshoot actually overshoots', () => {
    for (const [name, curve] of Object.entries(CURVES)) {
      expect(sampleCurve(curve, 0)).toBeCloseTo(0, 5);
      expect(sampleCurve(curve, 1)).toBeCloseTo(1, 5);
      expect(name.length).toBeGreaterThan(2);
    }
    // Follow-through passes its target on the way to settling.
    const peak = Math.max(...Array.from({ length: 40 }, (_, index) => sampleCurve(CURVES.overshoot, index / 39)));
    expect(peak).toBeGreaterThan(1);
    // Anticipation pulls back below zero first.
    const dip = Math.min(...Array.from({ length: 40 }, (_, index) => sampleCurve(CURVES.anticipate, index / 39)));
    expect(dip).toBeLessThan(0);
    // The standard curve does neither.
    const standard = Array.from({ length: 40 }, (_, index) => sampleCurve(CURVES.standard, index / 39));
    expect(Math.max(...standard)).toBeLessThanOrEqual(1.001);
    expect(Math.min(...standard)).toBeGreaterThanOrEqual(-0.001);
  });

  it('a stagger fits inside the time it is given', () => {
    const times = staggerTimes(12, 1.2);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeLessThanOrEqual(1.2);
    // In order, and no two at once.
    for (let index = 1; index < times.length; index++) expect(times[index]).toBeGreaterThan(times[index - 1]);
    expect(staggerTimes(1)).toEqual([0]);
    expect(wordTimes(4, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('every principle and move explains itself', () => {
    expect(Object.keys(PRINCIPLES).length).toBe(12);
    for (const [name, entry] of Object.entries(PRINCIPLES)) {
      expect(entry.about.length).toBeGreaterThan(20);
      expect(entry.use.length).toBeGreaterThan(20);
      expect(name).toMatch(/^[a-z-]+$/);
    }
    for (const move of MOVES) {
      expect(move.principles.length).toBeGreaterThan(0);
      expect(move.seconds).toBeGreaterThan(0.05);
      expect(Object.keys(move.to).length).toBeGreaterThan(0);
    }
    expect(findMove('pop')?.curve).toBe('overshoot');
    expect(findMove('nonsense')).toBeUndefined();
  });
});

describe('brand: derived from the project, not invented', () => {
  it('takes its accent from the footage and darkens the deepest colour for the field', () => {
    const brand = deriveBrand({ palette: ['#3A0A0F', '#7B1220', '#D9C8B4', '#101010'] });
    // The most colourful sample becomes the accent, pushed until it carries on a dark field.
    expect(brand.palette.accent).not.toBe(DEFAULT_BRAND.palette.accent);
    expect(brand.palette.ink.length).toBe(7);
    expect(brand.derivedFrom).toContain('4 colours');
  });

  it('falls back to the house accent when the footage has no colour in it', () => {
    const grey = deriveBrand({ palette: ['#2B2B2B', '#585858', '#9A9A9A'] });
    expect(grey.palette.accent).toBe('#E11D2E');
  });

  it('reads the tone from what is being said', () => {
    const hype = deriveBrand({ transcript: 'this insane hack made me rich, the fastest money secret' });
    const lesson = deriveBrand({ transcript: 'in this tutorial we explain each step of the guide' });
    expect(hype.type.title).toBeGreaterThan(lesson.type.title);
    expect(hype.motion.beat).toBeLessThan(lesson.motion.beat);
    expect(hype.motion.emphasis).toBe('overshoot');
    expect(lesson.name).toBe('Explainer');
  });

  it('sizes type up for a phone', () => {
    const comp = newComp({ name: 'Reel', width: 1080, height: 1920, fps: 30 });
    const vertical = deriveBrand({ comp });
    const horizontal = deriveBrand({ comp: newComp({ name: 'Wide', width: 1920, height: 1080, fps: 30 }) });
    expect(vertical.type.caption).toBeGreaterThan(horizontal.type.caption);
    expect(vertical.radius).toBeGreaterThan(horizontal.radius);
  });

  it('hands the graphics one set of variables, and a line anyone can read', () => {
    const brand = deriveBrand({ palette: ['#7B1220'] });
    const vars = brandVars(brand, 1080);
    expect(vars['--b-accent']).toBe(brand.palette.accent);
    expect(vars['--b-radius']).toMatch(/^\d+px$/);
    expect(vars['--b-entrance']).toContain('cubic-bezier');
    expect(brandSummary(brand)).toContain('Accent');
    expect(brandSummary(brand)).toContain('Derived from');
  });
});

describe('style packs: two films, written down', () => {
  it('each pack names its source and what it is for', () => {
    expect(STYLE_PACKS.length).toBeGreaterThanOrEqual(2);
    for (const pack of STYLE_PACKS) {
      expect(pack.source.length).toBeGreaterThan(10);
      expect(pack.about.length).toBeGreaterThan(80);
      expect(pack.suits.length).toBeGreaterThan(2);
      expect(pack.scenes.length).toBeGreaterThan(2);
      expect(pack.brand.palette.accent).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('every part of every scene uses a move that exists', () => {
    for (const pack of STYLE_PACKS) {
      for (const scene of pack.scenes) {
        expect(scene.seconds).toBeGreaterThan(0.5);
        for (const part of scene.parts) {
          expect(findMoveByName(part.move), `${pack.id}/${scene.name} uses ${part.move}`).toBeTruthy();
          expect(part.after).toBeLessThan(scene.seconds + 0.5);
        }
      }
    }
  });

  it('the two looks really are different looks', () => {
    const brief = findPack('crimson-brief');
    const glass = findPack('aflow-glass');
    if (!brief || !glass) throw new Error('both packs should be there');
    expect(brief.brand.palette.accent).not.toBe(glass.brand.palette.accent);
    // The brief keeps its type big for a talking head; the identity film is quieter and slower.
    expect(brief.brand.type.title).toBeGreaterThan(glass.brand.type.title);
    expect(glass.brand.motion.beat).toBeGreaterThan(brief.brand.motion.beat);
    expect(glass.materials).toContain('glass');
    expect(brief.materials).toContain('pill');
  });

  it('turns into a brand, sized for the frame it will play in', () => {
    const pack = findPack('crimson-brief');
    if (!pack) throw new Error('no pack');
    const wide = brandFromPack(pack);
    const phone = brandFromPack(pack, { vertical: true, captionStyle: 'hormozi' });
    expect(phone.type.caption).toBeGreaterThan(wide.type.caption);
    expect(phone.captionStyle).toBe('hormozi');
    expect(wide.derivedFrom).toContain(pack.source);
  });

  it('the catalogue stays small enough to put in a prompt', () => {
    const json = JSON.stringify(packCatalogue());
    expect(json.length).toBeLessThan(4000);
    expect(json).toContain('crimson-brief');
  });
});

describe('roto feeding the layout', () => {
  // The real numbers from the reference film's opening second, as the model produced them.
  const track = [
    { at: 0.0, x: 0.281, y: 0.146, width: 0.605, height: 0.854, cover: 0.283 },
    { at: 0.125, x: 0.291, y: 0.16, width: 0.584, height: 0.84, cover: 0.246 },
    { at: 0.25, x: 0.297, y: 0.153, width: 0.572, height: 0.847, cover: 0.244 },
    { at: 0.375, x: 0.299, y: 0.167, width: 0.564, height: 0.833, cover: 0.24 },
    { at: 0.5, x: 0.303, y: 0.174, width: 0.551, height: 0.826, cover: 0.233 },
  ];

  it('keeps clear of everywhere the speaker goes during the shot', () => {
    const box = subjectBox(track, 0, 0.5);
    if (!box) throw new Error('the speaker should have been found');
    // The union starts at the leftmost frame and ends at the rightmost, with a little padding.
    expect(box.x).toBeLessThanOrEqual(0.281);
    expect(box.x + box.width).toBeGreaterThanOrEqual(0.886);

    // With no matte, the speaker is a no-go area and the type keeps entirely clear of him.
    const avoiding = frameWithSubject(wide, track, 0, 0.5);
    const title = place(avoiding, 'title', 'hook');
    expect(overlaps(title.box, box, 0.02)).toBe(false);
    expect(title.box.x).toBeLessThan(0.3);

    // With a matte he is composited over the type, so it may run behind him — but it still leads
    // with the side he is not using, which is how the reference film sets "Motion" by his
    // shoulder rather than across it.
    const behind = frameWithSubject(wide, track, 0, 0.5, true);
    const word = place(behind, 'title', 'motion');
    expect(word.box.x).toBeLessThan(0.5);
    expect(word.box.width).toBeGreaterThan(title.box.width);
  });

  it('ignores frames where nobody was found, and says so when there are none', () => {
    const empty = [{ at: 0, x: 0, y: 0, width: 0, height: 0, cover: 0 }];
    expect(subjectBox(empty, 0, 1)).toBeNull();
    // Outside the span it falls back to the nearest frame rather than giving up.
    expect(subjectBox(track, 5, 6)).not.toBeNull();
  });
});
