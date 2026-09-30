import { describe, expect, it } from 'vitest';
import { defaultSize, evaluateScene, layerBounds } from '../src/motion/evaluate';
import { KINETIC_TEMPLATES, onsetsFor, springKeys, typingTimes, zoomCurve } from '../src/motion/kit/kineticTemplates';
import { MOTION_TEMPLATES, findTemplate } from '../src/motion/kit';
import { buildInBrand } from '../src/motion/kit/brandify';
import { newBrandKit } from '../src/lib/brandKit/build';
import { motionBrandFromKit } from '../src/lib/brandKit/motionBrand';
import { slotsFor } from '../src/lib/templateSlots';
import { fixTemplateArgs } from '../src/lib/templateFix';
import { num, vec } from '../src/motion/anim';
import { layoutText } from '../src/motion/text';
import { validateScene } from '../src/motion/validate';
import type { Layer, MotionScene } from '../src/motion/types';

const shot = (i: number) => ({ path: `shots/shot${i}.mp4`, in: 0 });
const still = (i: number) => ({ path: `stills/still${i}.jpg`, kind: 'image' as const });
// "An editor with a producer inside." as the launch film heard it (song seconds).
const SONG_WORDS = [
  { text: 'An', start: 2.96, end: 3.1 }, { text: 'editor', start: 3.2, end: 3.7 }, { text: 'with', start: 5.76, end: 5.95 },
  { text: 'a', start: 6.08, end: 6.2 }, { text: 'producer', start: 6.32, end: 6.66 }, { text: 'inside', start: 6.72, end: 7.3 },
];

/** Params per template; `main` must stay on the canvas at the end, `active` must be drawn then. */
const CASES: Record<string, { params: Record<string, unknown>; main: string[]; active: string[] }> = {
  'type-on-voice': { params: { text: 'An editor with a producer inside.', words: SONG_WORDS, offset: 2.66, accent: 'producer' }, main: ['line'], active: ['backdrop', 'line'] },
  'fly-through-word': { params: { line: 'An editor with a producer inside.', word: 'producer', next: shot(2), at: 0.6 }, main: [], active: ['backdrop', 'word', 'next'] },
  'word-land': { params: { text: 'Describe the *edit* / you want.', times: [0.2, 0.45, 0.7, 0.95, 1.2] }, main: ['words'], active: ['backdrop', 'words'] },
  'label-pill': { params: { label: 'Bring your own AI', attach: [0.6, 0.3, 0.3, 0.3], side: 'below', dot: true }, main: ['pill-label'], active: ['pill', 'pill-label'] },
  'slam-tilt': { params: { media: still(3), title: 'Bhippi cuts the footage', label: '18 cuts, on the beat', at: 0.35 }, main: ['title'], active: ['backdrop', 'card', 'title', 'label'] },
  'whip-pan': { params: { from: shot(1), to: shot(2), direction: 'left', title: 'Music' }, main: ['title'], active: ['incoming', 'title'] },
  'match-grow': { params: { from: shot(1), to: shot(3), fromRect: [0.05, 0.7, 0.2, 0.2], anchorFrom: [0.5, 0.35], anchorTo: [0.5, 0.35] }, main: [], active: ['to'] },
  'logo-lockup': { params: { name: 'Bhippi', tagline: 'The AI video editor.', words: [{ text: 'The', start: 34.77 }, { text: 'AI', start: 34.93 }, { text: 'video', start: 35.25 }, { text: 'editor', start: 35.73 }], offset: 33.9, at: 0.15 }, main: ['wordmark', 'tagline'], active: ['backdrop', 'mark', 'wordmark', 'tagline'] },
  'end-card': { params: { name: 'Bhippi', tagline: 'The AI video editor', cta: 'Try it free', url: 'bhippi.com', backdrop: [still(1), still(2), still(3)], beats: [1.2, 1.8, 2.4] }, main: ['wordmark', 'tagline', 'cta-label', 'url'], active: ['backdrop', 'mark', 'wordmark', 'tagline', 'cta', 'url'] },
};

const sizeFor = (scene: MotionScene) => (layer: Layer, t: number): [number, number] => {
  if (layer.type === 'text') {
    const size = num(layer.text.size as number, t, 96);
    const frame = layoutText(layer.text, t, (s) => s.length * size * 0.55);
    return [frame.width, frame.height];
  }
  return defaultSize(scene, layer, t);
};
const anchorOf = (layer: Layer, size: [number, number], t: number) => {
  if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
  const s = num(layer.text.size as number, t, 96);
  const pad = layoutText(layer.text, t, (x) => x.length * s * 0.55).pad;
  return [layer.text.align === 'left' ? pad : size[0] - pad, size[1] / 2, 0];
};
const frameAt = (scene: MotionScene, t: number) => evaluateScene(scene, t, { sizeOf: sizeFor(scene), anchorOf });

/** Every keyframe list in the scene, with where it is. */
function keyLists(value: unknown, path = '', out: { path: string; times: number[] }[] = []) {
  if (Array.isArray(value)) value.forEach((v, i) => keyLists(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.k) && o.k.every((key) => key && typeof key === 'object' && 't' in (key as object))) out.push({ path, times: (o.k as { t: number }[]).map((key) => key.t) });
    for (const [k, v] of Object.entries(o)) if (k !== 'template') keyLists(v, `${path}.${k}`, out);
  }
  return out;
}

const glyphBox = (scene: MotionScene, id: string, t: number) => {
  const layer = scene.layers.find((l) => l.id === id)!;
  const frame = frameAt(scene, t);
  const b = layerBounds(frame, id)!;
  if (layer.type !== 'text') return b;
  const size = num(layer.text.size as number, t, 96);
  const pad = layoutText(layer.text, t, (x) => x.length * size * 0.55).pad;
  const k = frame.layers.find((l) => l.layer.id === id)!.matrix[0];
  return { x: b.x + pad * k, y: b.y + pad * k, width: b.width - 2 * pad * k, height: b.height - 2 * pad * k };
};

describe('kinetic templates', () => {
  it('registers the nine specs in the catalogue, each with docs, params and a slot schema', () => {
    expect(KINETIC_TEMPLATES.map((s) => s.id)).toEqual(['type-on-voice', 'fly-through-word', 'word-land', 'label-pill', 'slam-tilt', 'whip-pan', 'match-grow', 'logo-lockup', 'end-card']);
    for (const spec of KINETIC_TEMPLATES) {
      expect(findTemplate(spec.id)).toBe(spec);
      expect(MOTION_TEMPLATES.filter((s) => s.id === spec.id)).toHaveLength(1);
      expect(spec.use.length, spec.id).toBeGreaterThan(80);
      expect(Object.keys(spec.params).length, spec.id).toBeGreaterThan(5);
      expect(Object.keys(slotsFor(spec.id, spec.params)!).length).toBeGreaterThanOrEqual(Object.keys(spec.params).length);
      // Defaults alone build a valid scene.
      expect(validateScene(spec.build({ width: 1920, height: 1080 }, {})), spec.id).toEqual([]);
    }
    expect(findTemplate('label-pill')!.fullFrame).toBe(false);
  });

  for (const spec of KINETIC_TEMPLATES) {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720]]) {
      it(`${spec.id} builds sanely at ${w}×${h}`, () => {
        const c = CASES[spec.id];
        const scene = spec.build({ width: w, height: h }, c.params);
        expect(validateScene(scene)).toEqual([]);
        expect([scene.width, scene.height]).toEqual([w, h]);
        expect(scene.template?.id).toBe(spec.id);
        expect(scene.cues?.length).toBeGreaterThan(0);
        // Every element is its own layer, named, with a unique id.
        expect(new Set(scene.layers.map((l) => l.id)).size).toBe(scene.layers.length);
        expect(scene.layers.length).toBeGreaterThan(1);
        // Deterministic.
        expect(JSON.stringify(spec.build({ width: w, height: h }, c.params))).toBe(JSON.stringify(scene));
        // Keys run forward in time.
        for (const list of keyLists(scene.layers)) for (let i = 1; i < list.times.length; i++) expect(list.times[i], `${list.path} key ${i}`).toBeGreaterThanOrEqual(list.times[i - 1]);
        for (const layer of scene.layers) if (layer.type === 'text' && layer.text.type?.times) {
          const times = layer.text.type.times;
          for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
        }
        for (const t of [0, 0.1, scene.duration * 0.25, scene.duration * 0.5, scene.duration * 0.75, scene.duration - 0.01]) {
          for (const layer of frameAt(scene, t).layers) {
            expect(layer.matrix.every(Number.isFinite), `${layer.layer.id} at ${t}`).toBe(true);
            expect(Number.isFinite(layer.opacity)).toBe(true);
          }
        }
        const end = frameAt(scene, scene.duration - 0.01);
        for (const id of c.active) expect(end.layers.find((l) => l.layer.id === id)?.active, `${id} active at end`).toBe(true);
        // The words stay in frame (the test's 0.55 em advance is wider than real type: a sliver of slack).
        const tol = 0.03 * w;
        for (const id of c.main) {
          const b = glyphBox(scene, id, scene.duration - 0.01);
          expect(b.x, `${id} left`).toBeGreaterThanOrEqual(-tol);
          expect(b.y, `${id} top`).toBeGreaterThanOrEqual(-tol);
          expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(w + tol);
          expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(h + tol);
        }
      });
    }
  }

  it('type-on-voice starts each word on its onset and types it at 46–66 ms a character', () => {
    const scene = findTemplate('type-on-voice')!.build({ width: 1920, height: 1080 }, CASES['type-on-voice'].params);
    const line = scene.layers.find((l) => l.id === 'line')!;
    if (line.type !== 'text') throw new Error('text');
    const times = line.text.type!.times!;
    const text = 'An editor with a producer inside.';
    expect(times).toHaveLength(Array.from(text).length);
    // Each word's first letter lands on its onset (scene seconds = song seconds − offset).
    let i = 0;
    for (const w of SONG_WORDS) {
      expect(times[i]).toBeCloseTo(w.start - 2.66, 5);
      const len = text.slice(i).indexOf(w.text) === 0 ? w.text.length : 0;
      const steps = times.slice(i + 1, i + len).map((t, k) => t - times[i + k]);
      // Where the next word leaves room, the step is the films' 46–66 ms.
      for (const s of steps) expect(s).toBeLessThanOrEqual(0.0661);
      if (w.text === 'editor') for (const s of steps) expect(s).toBeGreaterThanOrEqual(0.0459);
      i += w.text.length + 1;
    }
    // The line re-centres by gliding: between two frames the first letter moves less than half a character.
    const measure = (s: string) => s.length * 50;
    const firstX = (t: number) => {
      const f = layoutText(line.text, t, measure);
      return f.glyphs[0].x + f.glyphs[0].dx - f.width / 2;
    };
    for (let t = 0.3; t < 1.2; t += 1 / 30) expect(Math.abs(firstX(t + 1 / 30) - firstX(t))).toBeLessThan(25 * 0.75);
    // The accent word is in the accent colour.
    expect(line.text.spans!.find((s) => s.text.startsWith('producer'))?.color).toBe('#ff1f3d');
  });

  it('typing times squeeze a word sung faster than it can be typed, and never run backwards', () => {
    const onsets = onsetsFor(['a', 'longword', 'b'], [{ text: 'a', start: 0 }, { text: 'longword', start: 0.1 }, { text: 'b', start: 0.2 }], 0, 0.3);
    const times = typingTimes(onsets);
    expect(times[2]).toBeCloseTo(0.1, 5);
    expect(times[times.length - 1]).toBeCloseTo(0.2, 5);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    // A missed word does not shift the rest: "the" is skipped, "cat" still finds its time.
    const found = onsetsFor(['a', 'cat'], [{ text: 'a', start: 1 }, { text: 'the', start: 1.5 }, { text: 'cat', start: 2 }], 0, 0.3);
    expect(found.map((o) => o.start)).toEqual([1, 2]);
    // Bare onsets are taken in order; missing ones follow on.
    expect(onsetsFor(['x', 'y', 'z'], [{ text: '', start: 0.5 }], 0.2, 0.25).map((o) => o.start)).toEqual([0.5, 0.75, 1]);
  });

  it('fly-through-word zooms 270× on the launch curve and ends with the next scene filling the frame', () => {
    expect(zoomCurve(0)).toBeCloseTo(1, 6);
    expect(zoomCurve(1)).toBeCloseTo(270, 3);
    expect(zoomCurve(0.5)).toBeLessThan(Math.sqrt(270));
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
      const scene = findTemplate('fly-through-word')!.build({ width: w, height: h }, CASES['fly-through-word'].params);
      const rig = scene.layers.find((l) => l.id === 'rig')!;
      const zoom = (rig.transform!.scale as { k: { t: number; v: number }[] }).k;
      expect(zoom[0].v).toBeCloseTo(100, 3);
      expect(zoom[zoom.length - 1].v).toBeCloseTo(27000, 0);
      expect(zoom[zoom.length - 1].t - zoom[0].t).toBeCloseTo(1, 5);
      for (let i = 1; i < zoom.length; i++) expect(zoom[i].v).toBeGreaterThan(zoom[i - 1].v);
      // The line and the word are the same text, so they register exactly.
      const line = scene.layers.find((l) => l.id === 'line')!;
      const word = scene.layers.find((l) => l.id === 'word')!;
      if (line.type !== 'text' || word.type !== 'text') throw new Error('text');
      expect(line.text.spans!.map((s) => s.text).join('')).toBe(word.text.spans!.map((s) => s.text).join(''));
      expect(vec(line.transform!.position, 0, [])).toEqual(vec(word.transform!.position, 0, []));
      // The next scene shows inside the letters (matted, pixelated) and through the counter.
      const inLetters = scene.layers.find((l) => l.id === 'next-letters')!;
      expect(inLetters.matte).toEqual({ layer: 'word-matte', mode: 'alpha' });
      expect(inLetters.effects?.some((e) => e.type === 'mosaic')).toBe(true);
      expect(scene.layers.find((l) => l.id === 'word-matte')!.hidden).toBe(true);
      const next = scene.layers.find((l) => l.id === 'next')!;
      const box = vec(next.masks![0].box, scene.duration, []);
      expect(box[0]).toBeLessThan(0);
      expect(box[1]).toBeLessThan(0);
      expect(box[0] + box[2]).toBeGreaterThan(w);
      expect(box[1] + box[3]).toBeGreaterThan(h);
      expect(num(next.transform!.opacity, scene.duration, 0)).toBe(100);
      // A light zoom blur: 0.07 at its peak.
      const blur = scene.layers.find((l) => l.id === 'zoom-blur')!;
      expect(Math.max(...(blur.effects![0].amount as { k: { v: number }[] }).k.map((k) => k.v))).toBeCloseTo(0.07, 5);
    }
  });

  it('fly-through-word can type the line on the voice first and wait for it to settle', () => {
    const scene = findTemplate('fly-through-word')!.build({ width: 1920, height: 1080 }, { line: 'An editor with a producer inside.', word: 'producer', words: SONG_WORDS, offset: 2.66 });
    const word = scene.layers.find((l) => l.id === 'word')!;
    if (word.type !== 'text') throw new Error('text');
    const times = word.text.type!.times!;
    const zoom = ((scene.layers.find((l) => l.id === 'rig')!.transform!.scale as { k: { t: number }[] }).k)[0].t;
    expect(zoom).toBeGreaterThanOrEqual(times[times.length - 1] + 0.2);
    // Its caret is clear, so both layers lay out the same width.
    expect(word.text.type!.caretColor).toBe('#ffffff00');
  });

  it('word-land lands words grey and turns each white on its beat', () => {
    const scene = findTemplate('word-land')!.build({ width: 1920, height: 1080 }, { text: 'Connect your *AI*', times: [0.2, 0.6, 1.0] });
    const layer = scene.layers.find((l) => l.id === 'words')!;
    if (layer.type !== 'text') throw new Error('text');
    const colourOf = (t: number, word: number) => layoutText(layer.text, t, (s) => s.length * 50, { seed: 1 }).glyphs.find((g) => g.word === word)!.color;
    expect(colourOf(0.22, 0)).toBe('#8a8383');
    expect(colourOf(0.6, 0)).toBe('#f7f3f1');
    expect(colourOf(0.62, 1)).toBe('#8a8383');
    expect(colourOf(1.5, 2)).toBe('#f7f3f1');
    // Emphasis in an italic serif, set larger.
    const ai = layer.text.spans!.find((s) => s.text === 'AI')!;
    expect(ai.italic).toBe(true);
    expect(ai.font).toBe('Fraunces');
    expect(ai.size!).toBeGreaterThan(num(layer.text.size as number, 0, 0));
    // On a light look the ink is dark and the landing grey light.
    const light = findTemplate('word-land')!.build({ width: 1920, height: 1080 }, { text: 'Hello there', look: 'light' });
    const text = light.layers.find((l) => l.id === 'words')!;
    expect(text.type === 'text' && text.text.color).toBe('#17120f');
  });

  it('label-pill springs in, reveals its words after the body and holds them at least 0.6 s', () => {
    const spec = findTemplate('label-pill')!;
    const scene = spec.build({ width: 1920, height: 1080 }, { label: 'Titles, captions, Kai', at: 0.2, out: 0.3 });
    const pill = scene.layers.find((l) => l.id === 'pill')!;
    const label = scene.layers.find((l) => l.id === 'pill-label')!;
    expect(label.parent).toBe('pill');
    if (label.type !== 'text') throw new Error('text');
    expect(label.text.cascade!.delay).toBeCloseTo(0.3, 5);
    // Asked to leave at 0.3 s, it stays until its words have been readable for 0.6 s.
    const opacity = (pill.transform!.opacity as { k: { t: number; v: number }[] }).k;
    const leaves = opacity.find((k, i) => i > 0 && k.v === 100 && opacity[i + 1]?.v === 0)!.t;
    expect(leaves).toBeGreaterThanOrEqual(0.3 + 2 * 0.04 + 0.12 + 0.6 - 1e-6);
    // The body overshoots on its spring.
    const scale = (pill.transform!.scale as { k: { v: number }[] }).k.map((k) => k.v);
    expect(Math.max(...scale)).toBeGreaterThan(100);
    expect(scale[0]).toBe(78);
    // Attached below a box, it sits under it with the gap.
    const attached = spec.build({ width: 1920, height: 1080 }, { label: 'Project files', attach: [0.3, 0.2, 0.4, 0.4], side: 'below', gap: 38 });
    const at = vec((attached.layers[0].transform!.position as { k: { v: number[] }[] }).k.at(-1)!.v, 0, []);
    expect(at[0]).toBeCloseTo(0.5 * 1920, 3);
    expect(at[1]).toBeCloseTo(0.6 * 1080 + 38 + 21, 3);
    // Variants look different.
    const glass = spec.build({ width: 1920, height: 1080 }, { label: 'Project files', variant: 'glass' });
    expect(glass.layers[0].backdrop).toBeTruthy();
  });

  it('slam-tilt slams on its bar: 1.32 → 1, tilted back, de-blurring in 0.22 s', () => {
    const scene = findTemplate('slam-tilt')!.build({ width: 1920, height: 1080 }, { media: still(1), at: 0.5 });
    const card = scene.layers.find((l) => l.id === 'card')!;
    expect(card.threeD).toBe(true);
    expect(num(card.transform!.scale as number, 0.5, 0)).toBeCloseTo(132, 5);
    expect(num(card.transform!.scale as number, 0.72, 0)).toBeCloseTo(100, 5);
    expect(num(card.transform!.rotationX, 0.5, 0)).toBe(26);
    expect(num(card.transform!.rotationX, 0.72, 0)).toBe(13);
    expect(scene.cues!.some((c) => c.sound === 'impact' && c.at === 0.5)).toBe(true);
    const flat = findTemplate('slam-tilt')!.build({ width: 1920, height: 1080 }, { media: still(1), at: 0.5, tilt: 'flat' });
    expect(num(flat.layers.find((l) => l.id === 'card')!.transform!.rotationX, 0.72, 0)).toBe(0);
  });

  it('whip-pan throws the outgoing shot off and lands the incoming one under a directional blur', () => {
    const scene = findTemplate('whip-pan')!.build({ width: 1920, height: 1080 }, { from: shot(1), to: shot(2), at: 0.6, direction: 'left' });
    const out = scene.layers.find((l) => l.id === 'outgoing')!;
    const inc = scene.layers.find((l) => l.id === 'incoming')!;
    // The two shots pan as one strip: side by side the whole way, swapping around the whip's middle.
    for (const t of [0.3, 0.5, 0.6, 0.7, 0.9]) expect(vec(inc.transform!.position, t, [])[0] - vec(out.transform!.position, t, [])[0]).toBeCloseTo(1920, 3);
    expect(vec(out.transform!.position, 0.6, [])[0]).toBeLessThan(0);
    expect(vec(out.transform!.position, 0.6, [])[0]).toBeGreaterThan(-960);
    expect(vec(inc.transform!.position, scene.duration, [])[0]).toBeCloseTo(960, 3);
    const blur = scene.layers.find((l) => l.id === 'whip-blur')!;
    expect(blur.adjustment).toBe(true);
    expect(blur.effects![0]).toMatchObject({ type: 'directional-blur', direction: 90 });
    expect(num(blur.effects![0].length as never, 0.6, 0)).toBeGreaterThan(50);
    const up = findTemplate('whip-pan')!.build({ width: 1920, height: 1080 }, { direction: 'up' });
    expect(up.layers.find((l) => l.id === 'whip-blur')!.effects![0].direction).toBe(0);
  });

  it('match-grow lands the card\'s anchor on the next shot\'s anchor, then crossfades', () => {
    const scene = findTemplate('match-grow')!.build({ width: 1920, height: 1080 }, CASES['match-grow'].params);
    const card = scene.layers.find((l) => l.id === 'card')!;
    const landed = 0.3 + 0.28;
    // The anchor point of the card, in canvas pixels, is the position (the layer's anchor is that point).
    expect(vec(card.transform!.position, landed, [])).toEqual([960, 0.35 * 1080]);
    expect(num(card.transform!.scale as number, landed, 0)).toBeCloseTo((1920 / (0.2 * 1920)) * 100, 3);
    const to = scene.layers.find((l) => l.id === 'to')!;
    expect(num(to.transform!.opacity, landed, 0)).toBe(0);
    expect(num(to.transform!.opacity, landed + 0.1, 0)).toBe(100);
  });

  it('logo-lockup lands the mark, the wordmark 0.08 s later and the tagline on its words', () => {
    const scene = findTemplate('logo-lockup')!.build({ width: 1920, height: 1080 }, CASES['logo-lockup'].params);
    const mark = scene.layers.find((l) => l.id === 'mark')!;
    expect(num(mark.transform!.scale as number, 0.15, 0)).toBe(86);
    expect(num(mark.transform!.scale as number, 0.49, 0)).toBe(100);
    expect(scene.layers.find((l) => l.id === 'wordmark')!.in).toBeCloseTo(0.23, 5);
    const tagline = scene.layers.find((l) => l.id === 'tagline')!;
    if (tagline.type !== 'text') throw new Error('text');
    expect(tagline.text.cascade!.times![0]).toBeCloseTo(34.77 - 33.9 - 0.04, 4);
    // With a brand kit: the kit's name and logo, the brand's colours and fonts.
    const kit = newBrandKit({ style: 'tech-gradient', brandName: 'Flowbase', primary: '#2563eb', accent: '#22d3ee', background: '#0b1020', text: '#f8fafc', displayFont: 'Inter', bodyFont: 'Segoe UI' });
    const brand = { ...motionBrandFromKit(kit), logoAsset: 'logo-1' };
    const branded = buildInBrand(findTemplate('logo-lockup')!, { width: 1920, height: 1080 }, {}, brand);
    const logo = branded.layers.find((l) => l.id === 'mark')!;
    expect(logo.type === 'footage' && logo.source.asset).toBe('logo-1');
    const word = branded.layers.find((l) => l.id === 'wordmark')!;
    expect(word.type === 'text' && word.text.text).toBe('Flowbase');
  });

  it('end-card always holds at least 1.5 s after the last thing lands', () => {
    const spec = findTemplate('end-card')!;
    const scene = spec.build({ width: 1920, height: 1080 }, { ...CASES['end-card'].params, duration: 1 });
    const cta = scene.layers.find((l) => l.id === 'cta')!;
    const ring = scene.layers.find((l) => l.id === 'click-ring')!;
    const lastLand = Math.max((cta.in ?? 0) + 0.5, (ring.in ?? 0) + 0.4);
    expect(scene.duration - lastLand).toBeGreaterThanOrEqual(1.5 - 1e-9);
    // The shots drift far behind, faint and defocused.
    const shots = scene.layers.filter((l) => l.id.startsWith('shot-'));
    expect(shots).toHaveLength(3);
    for (const s of shots) expect(num(s.transform!.opacity, 0, 0)).toBe(26);
    // The mark beats on the given beats.
    const mark = scene.layers.find((l) => l.id === 'mark')!;
    expect(num(mark.transform!.scale as number, 1.28, 0)).toBeGreaterThan(101);
    // Without a call to action there is no cursor.
    expect(spec.build({ width: 1920, height: 1080 }, { name: 'Bhippi' }).layers.some((l) => l.id === 'cursor')).toBe(false);
  });

  it('looks and variants keep films apart', () => {
    for (const spec of KINETIC_TEMPLATES.filter((s) => 'look' in s.params)) {
      const looks = ['stage', 'light', 'dark', 'grid', 'none'].map((look) => JSON.stringify(spec.build({ width: 1920, height: 1080 }, { ...CASES[spec.id].params, look }).layers));
      expect(new Set(looks).size, spec.id).toBeGreaterThanOrEqual(spec.id === 'whip-pan' ? 1 : 5);
    }
    const kinds = ['rise', 'drop', 'slide', 'scale'].map((enter) => JSON.stringify(findTemplate('word-land')!.build({ width: 1920, height: 1080 }, { text: 'Hello there', enter })));
    expect(new Set(kinds).size).toBe(4);
  });

  it('takes brand colours and fonts: no house red left', () => {
    const kit = newBrandKit({ style: 'tech-gradient', brandName: 'Flowbase', primary: '#2563eb', accent: '#22d3ee', background: '#0b1020', text: '#f8fafc', displayFont: 'Inter', bodyFont: 'Segoe UI' });
    const brand = motionBrandFromKit(kit);
    const warmRed = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return r > 120 && r > g * 1.8 && r > b * 1.6; };
    for (const spec of KINETIC_TEMPLATES) {
      const scene = buildInBrand(spec, { width: 1920, height: 1080 }, CASES[spec.id].params, brand);
      expect(validateScene(scene), spec.id).toEqual([]);
      const colours = JSON.stringify({ ...scene, brand: undefined }).match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? [];
      expect(colours.filter((c) => warmRed(c.slice(0, 7))), spec.id).toEqual([]);
      for (const layer of scene.layers) if (layer.type === 'text') expect(Object.values(brand.fonts), `${spec.id} ${layer.id}`).toContain(layer.text.font);
    }
  });

  it('what a weaker model sends is read into the params', () => {
    const spec = findTemplate('type-on-voice')!;
    const fixed = fixTemplateArgs(spec.id, slotsFor(spec.id, spec.params)!, { title: 'Make my next video', look: 'LIGHT', caret: 'no' });
    expect(fixed.args.text).toBe('Make my next video');
    expect(fixed.args.look).toBe('light');
    expect(fixed.args.caret).toBe(false);
    // The word list passes through untouched.
    const list = fixTemplateArgs(spec.id, slotsFor(spec.id, spec.params)!, { text: 'x', words: SONG_WORDS });
    expect(list.args.words).toEqual(SONG_WORDS);
  });

  it('springKeys follow a damped spring and settle on the target', () => {
    const k = springKeys(1, 78, 100, 2.8, 0.6);
    expect(k[0]).toEqual({ t: 1, v: 78 });
    expect(k[k.length - 1].v).toBe(100);
    expect(Math.max(...k.map((x) => x.v))).toBeGreaterThan(100);
    for (let i = 1; i < k.length; i++) expect(k[i].t).toBeGreaterThan(k[i - 1].t);
  });
});
