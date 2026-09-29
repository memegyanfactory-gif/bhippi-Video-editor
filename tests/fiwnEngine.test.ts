// WatchFIWN's own checks of its dynamic caption engine (FIWN scripts/test-dynamic-captions.mjs),
// run against the copy Bhippi vendors, plus the parity Bhippi needs: the monitor and the export
// draw a caption with exactly the same canvas calls.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activePhrase, DYNAMIC_LAYOUTS, emphasisScore, groupPhrases, isFillerWord, normalizeWords, pickHeroId, sampleCueForStyle, tokensAtTime,
} from '../src/lib/fiwn/vendor/dynamic-captions.js';
import { MOTION_PRESET_IDS } from '../src/lib/fiwn/vendor/dynamic-presets-2.js';

const log: string[] = [];
vi.mock('../src/lib/ipc', () => ({ api: { mogrtFramesBegin: vi.fn(async (id: string) => `frames/${id}`) }, fileSrc: (p: string) => p }));
vi.mock('../src/lib/pngEncoder', () => ({
  openFrameWriter: vi.fn(async () => ({ pixels: async (index: number) => { log.push(`frame ${index}`); }, finish: async () => undefined, close: async () => undefined })),
}));

import { drawFiwnCaption, fiwnCue, fiwnStyle, FIWN_STYLE_IDS } from '../src/lib/fiwn';
import { renderFiwnCaptionsForExport } from '../src/lib/fiwn/export';
import { textGraphic } from '../src/lib/textGraphic';
import { newClip, newProject, textSource, tracksOf } from '../src/lib/timeline';
import type { Clip, Project } from '../src/lib/types';

/** A canvas that writes every call and property set to `into`, numbers rounded (Node has no canvas). */
function recordingCanvas(into: string[]) {
  const round = (value: unknown) => (typeof value === 'number' ? Math.round(value * 100) / 100 : typeof value === 'object' ? '·' : value);
  const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: String(text).length * 12 });
      if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args: unknown[]) => { into.push(`${String(key)}(${args.map(round)})`); return { addColorStop: (...stop: unknown[]) => into.push(`stop(${stop.map(round)})`) }; };
      return (...args: unknown[]) => { into.push(`${String(key)}(${args.map(round)})`); };
    },
    set(target, key, value) {
      target[key] = value;
      if (key !== 'filter' || value !== 'none') into.push(`${String(key)}=${round(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe("WatchFIWN's dynamic caption engine", () => {
  const words = [
    { word: 'find', start: 0.0, end: 0.2 }, { word: 'a', start: 0.22, end: 0.3 }, { word: 'simple', start: 0.32, end: 0.62 },
    { word: 'way', start: 0.64, end: 0.82 }, { word: 'to', start: 0.84, end: 0.94 }, { word: 'break', start: 1.4, end: 1.66 },
    { word: 'it', start: 1.68, end: 1.78 }, { word: 'down.', start: 1.8, end: 2.1 }, { word: 'You', start: 2.12, end: 2.24 },
    { word: 'guys', start: 2.26, end: 2.46 }, { word: 'have', start: 2.48, end: 2.64 }, { word: 'been', start: 2.66, end: 2.82 },
    { word: 'asking', start: 2.84, end: 3.2 }, { word: 'me.', start: 3.22, end: 3.4 },
  ];
  const cue = { id: 't', start: 0, end: 3.5, text: words.map((w) => w.word).join(' '), words };
  const norm = normalizeWords(cue);
  const phrases = groupPhrases(norm, 6, 0.38);
  const ctx = recordingCanvas([]);
  const styleBase = { font: 'Inter', size: 5.4, weight: 800, color: '#fff', highlightColor: '#fff', outline: true, outlineColor: '#000', outlineW: 1, posX: 50, posY: 50 };

  it('groups speech into phrases at gaps and punctuation, six words at most', () => {
    expect(isFillerWord('the') && isFillerWord('to') && !isFillerWord('simple')).toBe(true);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(phrases.every((phrase) => phrase.length <= 6)).toBe(true);
    expect(phrases[0].some((w) => w.text === 'down.') || phrases.some((p) => p[p.length - 1].text.endsWith('.'))).toBe(true);
  });

  it('never makes a filler word the hero', () => {
    const hero = phrases[0].find((w) => w.id === pickHeroId(phrases[0]));
    expect(hero && !isFillerWord(hero.text)).toBe(true);
    expect(emphasisScore({ text: 'simple' }, 2, 5)).toBeGreaterThan(emphasisScore({ text: 'to' }, 4, 5));
  });

  it('keeps each layout\'s window of words', () => {
    const rolling = activePhrase(norm, 2.5, 'punch-cut');
    expect(rolling.length).toBeGreaterThanOrEqual(1);
    expect(rolling.length).toBeLessThanOrEqual(3);
    const kinetic = activePhrase(norm, 2.5, 'kinetic-sentence');
    expect(kinetic.length).toBeGreaterThanOrEqual(2);
    expect(kinetic.length).toBeLessThanOrEqual(5);
  });

  it.each(DYNAMIC_LAYOUTS)('%s lays words out in colour, inside the safe area', (kind) => {
    const tokens = tokensAtTime(ctx, cue, 2.5, 1080, 1920, { ...styleBase, dynamicLayout: kind });
    expect(tokens.length).toBeGreaterThan(0);
    const fills = new Set(tokens.map((t) => t.fill).filter(Boolean));
    expect(fills.size).toBeGreaterThanOrEqual(1);
    // FIWN's check that a layout colours its words in more than one ink holds for the 25 base
    // layouts; the motion-graphics presets paint their colour in their FX layer instead (FIWN's own
    // script fails this for them too, as of 2026-09-29).
    if (tokens.length >= 3 && !MOTION_PRESET_IDS.includes(kind)) expect(fills.size).toBeGreaterThanOrEqual(2);
    for (const t of tokens) {
      expect(t.x, t.text).toBeGreaterThan(1080 * 0.06);
      expect(t.x, t.text).toBeLessThan(1080 * 0.94);
      expect(t.y, t.text).toBeGreaterThan(1920 * 0.06);
      expect(t.y, t.text).toBeLessThan(1920 * 0.94);
    }
    expect(sampleCueForStyle(kind).words.length).toBeGreaterThanOrEqual(3);
  });

  // The 25 base layouts; motion-graphics presets may share an arrangement and differ in their FX
  // (FIWN's own script reports those as equal too, as of 2026-09-29).
  it('gives every base layout its own arrangement', () => {
    // Flying Type draws through its own engine (flying-type-caption.js), not these tokens, whose
    // arrangement it happens to share with Impact Slam.
    const base = DYNAMIC_LAYOUTS.filter((kind) => !MOTION_PRESET_IDS.includes(kind) && kind !== 'flying-type');
    const prints = base.map((kind) => {
      const tokens = tokensAtTime(ctx, cue, 2.5, 1080, 1920, { ...styleBase, dynamicLayout: kind });
      return `${Math.round(Math.min(...tokens.map((t) => t.x)))}:${Math.round(Math.max(...tokens.map((t) => t.y)))}:${tokens.length}:${tokens.map((t) => t.role).join(',')}`;
    });
    expect(new Set(prints).size).toBe(base.length);
  });

  it('works in wide and square frames too', () => {
    for (const [W, H] of [[1920, 1080], [1080, 1080]]) expect(tokensAtTime(ctx, cue, 1.7, W, H, { ...styleBase, dynamicLayout: 'hero-word' }).length).toBeGreaterThan(0);
  });
});

describe('monitor and export draw the same caption', () => {
  let canvasLog: string[] = [];
  class RecordingCanvas {
    constructor(public width: number, public height: number) {}
    getContext() { return recordingCanvas(canvasLog); }
  }
  beforeEach(() => { vi.stubGlobal('OffscreenCanvas', RecordingCanvas); });

  // One style from each family, dynamic and flat.
  const families = [...new Set(FIWN_STYLE_IDS.map((id) => fiwnStyle(id)!.category))];
  const sample = families.flatMap((family) => FIWN_STYLE_IDS.filter((id) => fiwnStyle(id)!.category === family).slice(0, 3));

  it.each(sample)('%s: every exported frame is the monitor\'s picture at that moment', async (id) => {
    const project = { ...newProject(), captionLook: 'fiwn' as const };
    const comp = { ...project.comps[0], fps: 10 };
    const [, v2] = tracksOf(comp, 'video');
    // Trimmed at the head and sped up, so the word timings go through the mapping on both sides.
    const clip = newClip({ trackId: v2.id, start: 4, duration: 1.5, in: 0.5, speed: 1.5, source: textSource('caption', { text: 'This changes everything', style: id, words: [0.6, 1.1, 1.5], wordEnds: [1.0, 1.4, 2.6] }) });
    const withClip: Project = { ...project, comps: [{ ...comp, clips: [clip] }] };
    for (const index of [0, 3, 9, 14]) {
      const time = Math.min(clip.start + index / 10, clip.start + clip.duration - 1e-3);
      const monitor: string[] = [];
      const cue = fiwnCue(textGraphic(withClip, clip as Clip & { source: { type: 'text' } } as never));
      // Motion text templates measure and cache their layout on first draw; both sides are
      // compared warm, as they are after the first frame.
      drawFiwnCaption(recordingCanvas([]), cue, time, 1920, 1080, fiwnStyle(id)!);
      drawFiwnCaption(recordingCanvas(monitor), cue, time, 1920, 1080, fiwnStyle(id)!);
      canvasLog = [];
      log.length = 0;
      await renderFiwnCaptionsForExport(withClip, comp.id, { times: [time] });
      const exported = canvasLog.filter((call) => !call.startsWith('clearRect(') && !call.startsWith('getImageData('));
      expect(log).toEqual([`frame ${index}`]);
      expect(exported, `frame ${index}`).toEqual(monitor);
    }
  });
});
