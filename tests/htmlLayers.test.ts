import { describe, expect, it } from 'vitest';
import { baseCss, htmlLayerInfo, layerCss, wholeGraphics } from '../src/lib/htmlLayers';
import { newClip, newComp } from '../src/lib/timeline';
import type { Clip, Comp } from '../src/lib/types';

// The DOM half (tagging a graphic's parts) runs in the browser; it was checked there against every
// graphic of a real project. These cover what the stack records and how the export treats it.

const graphic = { type: 'html' as const, html: '<div class="mgc"><div class="heading a">Hi</div></div>', css: '.mgc{color:red}', template: 'comparison', title: 'Hi' };

function stack(of: number, change: (clip: Clip, index: number) => Clip = (clip) => clip): Comp {
  const comp = newComp({ name: '[MOGRT] Hi' });
  const tracks = Array.from({ length: of }, () => ({ ...comp.tracks[0], id: Math.random().toString(36).slice(2) }));
  const clips = tracks.map((track, index) => change(newClip({ trackId: track.id, start: 0, duration: 4, source: { ...graphic, css: layerCss(graphic.css, 'abc', String(index), of) } }), index));
  return { ...comp, tracks: [...tracks, ...comp.tracks.filter((t) => t.kind === 'audio')], clips };
}

describe('HTML graphic layers', () => {
  it('records the stack in the CSS and gives the graphic its own CSS back', () => {
    const css = layerCss(graphic.css, 'abc', '2', 5);
    expect(htmlLayerInfo({ css })).toEqual({ stack: 'abc', layer: '2', of: 5 });
    expect(htmlLayerInfo({ css: graphic.css })).toBeNull();
    expect(baseCss(css)).toBe(graphic.css);
    // Re-layering an already layered CSS does not pile rules up.
    expect(baseCss(layerCss(css, 'abc', '3', 5))).toBe(graphic.css);
  });

  it('scopes every rule to its own copy of the graphic', () => {
    const css = layerCss(graphic.css, 'abc', '1', 3);
    const rules = css.split('/* helios-layers rules */')[1];
    for (const line of rules.trim().split('\n')) expect(line.startsWith('[data-hl-show="abc-1"]')).toBe(true);
    expect(layerCss(graphic.css, 'abc', 'rest', 3)).toContain('[data-hl-show="abc-rest"] [data-hl]');
  });

  it('exports an untouched graphic once, and a changed one layer by layer', () => {
    const whole = wholeGraphics(stack(3));
    expect(whole).toHaveLength(1);
    expect(whole[0].members).toHaveLength(3);
    expect(whole[0].source.css).toBe(graphic.css);
    // One layer slid later, one nudged, one missing: each renders on its own.
    expect(wholeGraphics(stack(3, (clip, i) => (i === 1 ? { ...clip, start: 1 } : clip)))).toEqual([]);
    expect(wholeGraphics(stack(3, (clip, i) => (i === 2 ? { ...clip, transform: { ...clip.transform, x: 0.1 } } : clip)))).toEqual([]);
    const missing = stack(3);
    expect(wholeGraphics({ ...missing, clips: missing.clips.slice(1) })).toEqual([]);
  });
});
