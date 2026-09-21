import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMove } from '../src/lib/motion';
import {
  RB_BACKGROUNDS,
  RB_CARDS,
  RB_MOTION,
  RB_TEXT,
  findRb,
  findRbBackground,
  parseRbStyle,
  rbBackgroundExportEffect,
  rbBackgroundFromName,
  rbBackgroundGradient,
  rbBackgroundStyle,
  rbEntrance,
  rbExportBase,
  rbMoveFor,
} from '../src/lib/reactbits';
import { textSource } from '../src/lib/timeline';

describe('reactbits engine catalogue', () => {
  it('covers the full library: text, motion, backgrounds, cards', () => {
    expect(RB_TEXT.length).toBe(32);
    expect(RB_MOTION.length).toBe(30);
    expect(RB_BACKGROUNDS.length).toBe(40);
    expect(RB_CARDS.length).toBe(12);
  });

  it('finds motions bare or prefixed, any case', () => {
    expect(findRb('rb-scrambled')?.label).toBe('Scrambled Text');
    expect(findRb('Scrambled')?.id).toBe('rb-scrambled');
    expect(findRb('RB-GLITCH')?.id).toBe('rb-glitch');
    expect(findRb('nope')).toBeUndefined();
  });

  it('every entrance degrades to a libass base the exporter understands', () => {
    const known = new Set(['pop', 'rise', 'blur', 'fade', 'type', 'glitch', 'spin', 'drop', 'skew', 'stretch', 'reveal', 'zoom-out']);
    for (const def of [...RB_TEXT, ...RB_MOTION]) {
      expect(known.has(def.exportBase), def.id).toBe(true);
      expect(findMove(def.move), def.id).toBeTruthy();
    }
  });

  it('every catalogue keyframe exists in the stylesheet', () => {
    const css = readFileSync('src/styles/app.css', 'utf8');
    for (const def of [...RB_TEXT, ...RB_MOTION]) {
      expect(css.includes(`@keyframes ${def.keyframe}`), def.keyframe).toBe(true);
    }
    for (const loop of ['drift', 'spin', 'pulse', 'rain', 'shimmer']) {
      expect(css.includes(`@keyframes rb-bg-${loop}`), loop).toBe(true);
    }
  });
});

describe('reactbits style parsing', () => {
  it('splits caption style and motion suffix', () => {
    expect(parseRbStyle('Hormozi+rb-scrambled')).toEqual({ base: 'Hormozi', motionId: 'rb-scrambled' });
    expect(parseRbStyle('rb-decrypted')).toEqual({ base: null, motionId: 'rb-decrypted' });
    expect(parseRbStyle('karaoke')).toEqual({ base: 'karaoke', motionId: null });
    expect(parseRbStyle(null)).toEqual({ base: null, motionId: null });
  });

  it('keeps motion ids on plain presets, drops caption style ids', () => {
    const title = textSource('title', { text: 'Hi', style: 'rb-decrypted' });
    expect(title.type === 'text' && title.style).toBe('rb-decrypted');
    const bogus = textSource('title', { text: 'Hi', style: 'hormozi' });
    expect(bogus.type === 'text' && bogus.style).toBeNull();
    const caption = textSource('caption', { text: 'Hi', style: 'Hormozi+rb-scrambled' });
    expect(caption.type === 'text' && caption.style).toBe('Hormozi+rb-scrambled');
  });

  it('entrances stay scrub-safe: paused with the caller delay', () => {
    const style = rbEntrance('rb-scrambled', -1.2, 0.3, 1.5) as Record<string, string>;
    expect(style.animationName).toMatch(/^rb-scrambled, cap-/);
    expect(style.animationDelay).toMatch(/^-1\.2s/);
    expect(style.animationPlayState).toBe('paused, paused');
    expect(rbEntrance('nope', 0)).toEqual({});
  });

  it('export base and move fall back sanely', () => {
    expect(rbExportBase('rb-glitch')).toBe('glitch');
    expect(rbExportBase('nope')).toBe('fade');
    expect(rbMoveFor('rb-scroll-expand')).toBe('scale-into-card');
  });
});

describe('reactbits backgrounds', () => {
  it('resolves matte names to backgrounds', () => {
    expect(rbBackgroundFromName('RB: Aurora')?.id).toBe('rb-aurora');
    expect(rbBackgroundFromName('rb-plasma')?.id).toBe('rb-plasma');
    expect(rbBackgroundFromName('plain blue')).toBeUndefined();
    expect(findRbBackground('CRT-WARP')?.id).toBe('rb-crt-warp');
  });

  it('preview style animates, export effect uses a rendered primitive', () => {
    const bg = rbBackgroundFromName('RB: Aurora')!;
    const preview = rbBackgroundStyle(bg);
    expect(preview.animationIterationCount).toBe('infinite');
    expect(typeof preview.backgroundImage).toBe('string');
    expect(rbBackgroundGradient(bg).topLeft).toMatch(/^#/);
    const fx = rbBackgroundExportEffect(bg);
    expect(fx.effectId).toBe('4-color-gradient');
    expect(fx.enabled).toBe(true);
  });
});
