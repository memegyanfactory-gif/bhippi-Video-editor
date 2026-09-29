// Caption Lab (/caption-lab.html on the dev server): every WatchFIWN caption style drawn by the
// renderer Bhippi uses, over a mid-grey plate, so the whole library can be looked over at once.
//   ?t=1.6       the moment to draw (the sample caption runs 0–3 s)
//   ?only=dyn    styles whose id contains the text
//   ?cols=6      grid columns
//   ?view=cards  the Subtitles tab's style cards (the same component), instead of whole frames
import '../../fonts/bundled.css';
import '../../fonts/fiwn.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FiwnStyleSample } from '../../editor/FiwnCaption';
import { drawFiwnCaption, ensureFiwnFonts, fiwnStyle, FIWN_STYLE_IDS, type FiwnCue } from './index';

const query = new URLSearchParams(location.search);
const time = Number(query.get('t') ?? 1.6);
const only = query.get('only');
const cols = Math.max(1, Number(query.get('cols') ?? 6));
const W = 480;
const H = 270;

const cue: FiwnCue = {
  start: 0,
  end: 3,
  text: 'This changes everything you know',
  words: [
    { word: 'This', start: 0.0, end: 0.3 },
    { word: 'changes', start: 0.3, end: 0.8 },
    { word: 'everything', start: 0.9, end: 1.6 },
    { word: 'you', start: 1.7, end: 1.9 },
    { word: 'know', start: 2.0, end: 2.6 },
  ],
};

document.body.style.cssText = `margin:0;background:#101014;color:#ddd;font:12px system-ui;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:8px;padding:8px`;
const ids = FIWN_STYLE_IDS.filter((id) => !only || id.toLowerCase().includes(only.toLowerCase()));

async function main() {
  let failed = 0;
  for (const id of ids) {
    const style = fiwnStyle(id)!;
    await ensureFiwnFonts(style);
    const cell = document.createElement('figure');
    cell.style.cssText = 'margin:0';
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const plate = ctx.createLinearGradient(0, 0, W, H);
    plate.addColorStop(0, '#3a4150');
    plate.addColorStop(1, '#6b5a4a');
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, W, H);
    const ok = drawFiwnCaption(ctx, cue, time, W, H, style);
    if (!ok) failed++;
    const label = document.createElement('figcaption');
    label.textContent = `${ok ? '' : '✗ '}${style.label} · ${id} · ${style.font}`;
    cell.append(canvas, label);
    document.body.append(cell);
  }
  document.title = `Caption Lab — ${ids.length} styles, ${failed} failed`;
  document.body.dataset.done = 'true';
}
/** The Subtitles tab's cards: each style's FiwnStyleSample at card size. */
function cards() {
  document.body.style.gridTemplateColumns = `repeat(${cols}, 180px)`;
  for (const id of ids) {
    const cell = document.createElement('figure');
    cell.style.cssText = 'margin:0;background:#1c1c22;border:1px solid #333;border-radius:6px;overflow:hidden';
    const sample = document.createElement('div');
    sample.style.cssText = 'aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden';
    const label = document.createElement('figcaption');
    label.style.cssText = 'padding:4px 6px';
    label.textContent = fiwnStyle(id)!.label;
    cell.append(sample, label);
    document.body.append(cell);
    const style = document.createElement('style');
    style.textContent = '.fiwn-style-sample{width:100%;height:100%;display:block}';
    document.head.append(style);
    createRoot(sample).render(createElement(FiwnStyleSample, { style: fiwnStyle(id)!, playing: false, fallback: 'failed' }));
  }
  document.body.dataset.done = 'true';
}
if (query.get('view') === 'cards') cards();
else void main();
