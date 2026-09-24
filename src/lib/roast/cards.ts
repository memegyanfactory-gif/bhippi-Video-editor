// The @funny card graphics (docs/FUNNY-MODE-PLAN.md §1.4 "Cards" and §3.5 `card`, `title_card`,
// `sticker`, `cta`): a news "receipt", THEN / NOW torn cards, a fact strip, an Instagram profile, a
// poster, a sticker badge, the cold-open title card and the fire CTA.
//
// Each builder returns an html ClipSource that follows the motion-graphic export contract (the
// same one the Crimson and React Bits templates keep, see src/lib/htmlFrames.ts): paused CSS
// animations scrubbed by `--elapsed` (entrances by negative delays, exits by `--exit` counted from
// `--duration`), no backdrop-filter, no scripts, no external resources — pictures travel inside the
// markup as `data:` URLs (src/lib/brandKit/logoData.ts explains why a file URL renders blank in the
// export). Cards are designed on the comp's own canvas (`cardCanvas`, the same as `mogrtCanvas`), so
// a Reel gets a tall layout rather than a letterboxed 16:9 one. Fonts come from SYSTEM_FONTS only.
import { fileSrc } from '../ipc';
import type { AssetMap } from '../timeline';
import type { Comp } from '../types';
import { CARD_TEMPLATES, type CardTemplateId } from './types';

type Params = Record<string, unknown>;
export type Box = { x: number; y: number; width: number; height: number };
export type RoastCardSource = { type: 'html'; html: string; css: string; js?: string; title: string; template: CardTemplateId; box: Box };

export type RoastCardParam = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'image' | 'enum' | 'point';
  about: string;
  default?: unknown;
  values?: string[];
  required?: boolean;
};

export type RoastCardSpec = {
  id: CardTemplateId;
  label: string;
  /** When the model should reach for it. */
  use: string;
  params: RoastCardParam[];
  /** A good on-screen length, seconds (the card's exit follows the clip's own length). */
  seconds: number;
  /** True when the card is the whole picture (a black field), not something over the host. */
  fullFrame: boolean;
};

export const isRoastCardTemplate = (id: string | null | undefined): id is CardTemplateId => !!id && (CARD_TEMPLATES as readonly string[]).includes(id);

/** The canvas a card is designed on: the comp's, 1920 wide for landscape and 1080 wide for portrait (as `mogrtCanvas`). */
export function cardCanvas(comp: { width: number; height: number }): { width: number; height: number } {
  const width = comp.height > comp.width ? 1080 : 1920;
  return { width, height: Math.round((width * comp.height) / Math.max(1, comp.width)) };
}

// ───────────────────────── params ─────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (p: Params, keys: string[], fallback = ''): string => {
  for (const key of keys) {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return fallback;
};
const num = (p: Params, key: string, fallback: number, lo = -Infinity, hi = Infinity) => (typeof p[key] === 'number' && Number.isFinite(p[key]) ? clamp(p[key] as number, lo, hi) : fallback);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const colour = (p: Params, keys: string[], fallback: string) => {
  for (const key of keys) if (typeof p[key] === 'string' && HEX.test((p[key] as string).trim())) return (p[key] as string).trim();
  return fallback;
};
const oneOf = <T extends string>(p: Params, key: string, values: readonly T[], fallback: T): T => (values as readonly string[]).includes(String(p[key])) ? (p[key] as T) : fallback;

// ───────────────────────── pictures ─────────────────────────

const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml)(;[a-z0-9=.+-]+)*[;,]/i;
/** Pictures made export-safe (data URLs) for a path or asset id, filled by `prepareRoastCardImages`. */
const inlined = new Map<string, string>();

/** Remembers the data URL of a picture path (or asset id), so builds reference it inline. */
export const rememberCardImage = (ref: string, dataUrl: string) => { if (DATA_IMAGE.test(dataUrl)) inlined.set(ref, dataUrl); };

/**
 * A CSS `url(…)` for a picture param. Data URLs pass; a path or asset id that
 * `prepareRoastCardImages` inlined uses its data URL; any other local path falls back to the
 * webview's file URL, which previews but renders blank in the export — so inline first. Web URLs
 * are refused (the export contract has no network).
 */
function pictureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  const safe = (url: string) => `url('${url.replace(/['"()\\\s]/g, (c) => encodeURIComponent(c))}')`;
  if (DATA_IMAGE.test(v)) return safe(v);
  const hit = inlined.get(v);
  if (hit) return safe(hit);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^[a-z]:[\\/]/i.test(v)) return null;
  try {
    const url = fileSrc(v);
    return url ? safe(url) : null;
  } catch {
    return null;
  }
}

/** The picture params of each card (a data URL, a local path or an asset id). */
export const ROAST_CARD_IMAGE_PARAMS: Record<CardTemplateId, string[]> = {
  'roast-article-card': ['image'],
  'roast-then-now': ['then', 'now'],
  'roast-fact-strip': [],
  'roast-profile-card': ['avatar'],
  'roast-poster-card': ['image'],
  'roast-sticker-badge': [],
  'roast-title-card': ['photo', 'image'],
  'roast-cta-fire': [],
};

/** Aliases the executor may send instead: `photoAssetId` for `photo`, `<name>AssetId` generally. */
const assetKey = (name: string) => `${name}AssetId`;

/**
 * Makes a card's pictures export-safe before it is built: every picture param that names a local
 * path or a project asset (`<param>AssetId`, or an asset id in the param) becomes a data URL, scaled
 * down to `maxSide` px (JPEG when opaque, PNG when it has transparency — cut-outs keep their alpha).
 * Returns the params to build with, and the refs that could not be read.
 */
export async function prepareRoastCardImages(id: CardTemplateId, params: Params, assets?: AssetMap, maxSide = 1100): Promise<{ params: Params; missing: string[] }> {
  const out: Params = { ...params };
  const missing: string[] = [];
  for (const name of ROAST_CARD_IMAGE_PARAMS[id] ?? []) {
    const assetId = typeof params[assetKey(name)] === 'string' ? (params[assetKey(name)] as string) : null;
    const raw = typeof params[name] === 'string' && (params[name] as string).trim() ? (params[name] as string).trim() : assetId;
    if (!raw || DATA_IMAGE.test(raw)) continue;
    const asset = assets?.get(raw) ?? (assetId ? assets?.get(assetId) : undefined);
    const path = asset?.path ?? raw;
    try {
      const url = inlined.get(path) ?? (await shrinkToDataUrl(fileSrc(path), maxSide));
      inlined.set(path, url);
      inlined.set(raw, url);
      out[name] = url;
    } catch {
      missing.push(raw);
    }
  }
  return { params: out, missing };
}

async function shrinkToDataUrl(url: string, maxSide: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`could not read ${url}`));
    el.src = url;
  });
  const k = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D canvas');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = false;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) { transparent = true; break; }
  return transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
}

// ───────────────────────── shared look ─────────────────────────

/** Seeded 0..1 noise (torn edges, sparks), so a card rebuilds identically. */
const hash = (i: number, salt = 1) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
const seedOf = (text: string) => { let h = 7; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 100003; return h; };

const BASE_CSS = `
.rc{position:absolute;inset:0;overflow:hidden;font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#fff;font-synthesis:none;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;
 --t:calc(var(--elapsed,0) * -1s);--exit:calc(var(--duration,4s) - .24s - var(--elapsed,0) * 1s);
 --pop:cubic-bezier(.3,1.55,.6,1);--eo:cubic-bezier(.16,1,.3,1);--ei:cubic-bezier(.55,0,.85,.25)}
.rc *{box-sizing:border-box;margin:0}
.rc .a{animation-fill-mode:both;animation-play-state:paused;animation-delay:calc(var(--t) + var(--d,0s))}
.rc .x{animation:rc-out .24s var(--ei) both paused;animation-delay:var(--exit)}
.rc .loop{animation-play-state:paused;animation-iteration-count:infinite;animation-timing-function:linear;animation-delay:calc(var(--t) + var(--d,0s))}
.rc .pop{animation-name:rc-pop;animation-duration:.55s;animation-timing-function:ease-out}
.rc .slide-r{animation-name:rc-slide-r;animation-duration:.6s;animation-timing-function:var(--pop)}
.rc .slide-l{animation-name:rc-slide-l;animation-duration:.6s;animation-timing-function:var(--pop)}
.rc .slide-u{animation-name:rc-slide-u;animation-duration:.6s;animation-timing-function:var(--pop)}
.rc .rise{animation-name:rc-rise;animation-duration:.45s;animation-timing-function:var(--eo)}
.rc .slam{animation-name:rc-slam;animation-duration:.42s;animation-timing-function:ease-out}
.rc .mark{background-image:linear-gradient(transparent 8%,var(--mark,#ffe14d) 8%,var(--mark,#ffe14d) 92%,transparent 92%);background-repeat:no-repeat;background-position:0 0;animation-name:rc-mark;animation-duration:.5s;animation-timing-function:var(--eo);padding:0 .12em;margin:0 -.06em;color:#111}
@keyframes rc-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.86)}}
@keyframes rc-pop{0%{opacity:0;transform:scale(.25) rotate(var(--r0,-8deg))}45%{opacity:1;transform:scale(1.09) rotate(calc(var(--rot,0deg) + 2deg))}70%{transform:scale(.97) rotate(calc(var(--rot,0deg) - 1deg))}100%{opacity:1;transform:scale(1) rotate(var(--rot,0deg))}}
@keyframes rc-slide-r{from{opacity:0;transform:translateX(var(--from,110%)) rotate(calc(var(--rot,0deg) + 6deg))}25%{opacity:1}to{opacity:1;transform:translateX(0) rotate(var(--rot,0deg))}}
@keyframes rc-slide-l{from{opacity:0;transform:translateX(calc(var(--from,110%) * -1)) rotate(calc(var(--rot,0deg) - 6deg))}25%{opacity:1}to{opacity:1;transform:translateX(0) rotate(var(--rot,0deg))}}
@keyframes rc-slide-u{from{opacity:0;transform:translateY(var(--from,90%)) rotate(calc(var(--rot,0deg) + 4deg))}25%{opacity:1}to{opacity:1;transform:translateY(0) rotate(var(--rot,0deg))}}
@keyframes rc-rise{from{opacity:0;transform:translateY(.45em);filter:blur(6px)}to{opacity:1;transform:translateY(0);filter:blur(0)}}
@keyframes rc-slam{0%{opacity:0;transform:scale(1.9);filter:blur(10px)}55%{opacity:1;transform:scale(.93);filter:blur(0)}78%{transform:scale(1.04)}100%{opacity:1;transform:scale(1);filter:blur(0)}}
@keyframes rc-mark{from{background-size:0% 100%}to{background-size:100% 100%}}
`;

type Layout = { W: number; H: number; k: number; portrait: boolean };
const px = (v: number) => `${Math.round(v * 10) / 10}px`;
const d = (s: number) => `--d:${s.toFixed(2)}s`;
const boxOf = (L: Layout, x: number, y: number, w: number, h: number): Box => {
  const x0 = clamp(x / L.W, 0, 1);
  const y0 = clamp(y / L.H, 0, 1);
  return { x: round4(x0), y: round4(y0), width: round4(clamp((x + w) / L.W, 0, 1) - x0), height: round4(clamp((y + h) / L.H, 0, 1) - y0) };
};
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Where a card of w × h sits for a placement word, inside the safe area (the host usually takes the centre). */
function place(L: Layout, placement: string, w: number, h: number, fallback: 'left' | 'right' | 'bottom' | 'center' | 'top'): { x: number; y: number } {
  const where = ['left', 'right', 'bottom', 'center', 'top'].includes(placement) ? placement : fallback;
  const mx = L.W * (L.portrait ? 0.06 : 0.05);
  const top = L.H * (L.portrait ? 0.12 : 0.07);
  const bottom = L.H * (L.portrait ? 0.18 : 0.07);
  const midY = clamp(L.H * 0.47 - h / 2, top, L.H - bottom - h);
  switch (where) {
    case 'left': return L.portrait ? { x: (L.W - w) / 2, y: midY } : { x: mx, y: midY };
    case 'right': return L.portrait ? { x: (L.W - w) / 2, y: midY } : { x: L.W - mx - w, y: midY };
    case 'top': return { x: (L.W - w) / 2, y: top };
    case 'bottom': return { x: (L.W - w) / 2, y: L.H - bottom - h };
    default: return { x: (L.W - w) / 2, y: (L.H - h) / 2 };
  }
}

const initials = (text: string) => text.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

/** 1234567 → "1.2M"; strings pass through. */
function compact(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  const fmt = (v: number, s: string) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${s}`;
  if (abs >= 1e9) return fmt(value / 1e9, 'B');
  if (abs >= 1e6) return fmt(value / 1e6, 'M');
  if (abs >= 1e4) return fmt(value / 1e3, 'K');
  return value.toLocaleString('en-US');
}

/** Marks the first occurrence of `phrase` in `text` (both escaped). */
function withMark(text: string, phrase: string, at: number, cls = 'mark a'): string {
  if (!phrase) return esc(text);
  const i = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<span class="${cls}" style="${d(at)}">${esc(text.slice(i, i + phrase.length))}</span>${esc(text.slice(i + phrase.length))}`;
}

const wrap = (L: Layout, inner: string, extra = '') => `<div class="rc" style="--k:${L.k.toFixed(4)}${extra}">${inner}</div>`;

// ───────────────────────── the cards ─────────────────────────

type Built = { html: string; css: string; box: Box; title: string };

function articleCard(L: Layout, p: Params): Built {
  const { k } = L;
  const headline = str(p, ['headline', 'title', 'text'], 'Headline goes here');
  const source = str(p, ['source', 'site', 'publisher'], 'NEWS');
  const date = str(p, ['date', 'time']);
  const highlight = str(p, ['highlight', 'quote', 'line']);
  const accent = colour(p, ['accent', 'color'], '#d0021b');
  const image = pictureUrl(p.image);
  const w = L.portrait ? L.W * 0.86 : 660 * k;
  const pad = 28 * k;
  const imgH = image ? (w - pad * 2) * 0.5625 : 0;
  const headSize = (headline.length > 80 ? 34 : 40) * k * (L.portrait ? 1.15 : 1);
  const inHead = highlight && headline.toLowerCase().includes(highlight.toLowerCase());
  const bodyLines = highlight && !inHead ? Math.ceil((highlight.length * 15 * k) / (w - pad * 2)) : 0;
  const headLines = Math.ceil((headline.length * headSize * 0.5) / (w - pad * 2));
  const h = pad * 2 + 44 * k + (image ? imgH + 20 * k : 0) + headLines * headSize * 1.18 + (bodyLines ? 16 * k + bodyLines * 30 * k * 1.45 : 0) + 10 * k;
  const { x, y } = place(L, str(p, ['placement', 'side']), w, h, 'right');
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)}">
  <div class="a ${x + w / 2 < L.W / 2 ? 'slide-l' : 'slide-r'} art" style="${d(0)};--rot:${x + w / 2 < L.W / 2 ? 1.2 : -1.2}deg">
    <div class="art-top"><span class="art-logo" style="background:${accent}">${esc(initials(source).slice(0, 2))}</span><span class="art-src">${esc(source)}</span>${date ? `<span class="art-date">· ${esc(date)}</span>` : ''}</div>
    ${image ? `<div class="art-img" style="height:${px(imgH)};background-image:${image}"></div>` : ''}
    <div class="art-head">${inHead ? withMark(headline, highlight, 0.6) : esc(headline)}</div>
    ${highlight && !inHead ? `<div class="art-body"><span class="mark a" style="${d(0.6)}">${esc(highlight)}</span></div>` : ''}
  </div></div>`);
  const css = `.rc .art{background:#fff;color:#16181c;border-radius:${px(14 * k)};padding:${px(pad)};box-shadow:0 ${px(26 * k)} ${px(60 * k)} #000000a0,0 ${px(4 * k)} ${px(12 * k)} #0005;font-family:Arial,Helvetica,sans-serif}
.rc .art-top{display:flex;align-items:center;gap:${px(12 * k)};height:${px(44 * k)};font-size:${px(21 * k)}}
.rc .art-logo{width:${px(40 * k)};height:${px(40 * k)};border-radius:${px(8 * k)};color:#fff;font-weight:900;font-size:${px(17 * k)};display:flex;align-items:center;justify-content:center;letter-spacing:-.02em}
.rc .art-src{font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.rc .art-date{color:#6b6f76}
.rc .art-img{margin-top:${px(20 * k)};border-radius:${px(8 * k)};background-size:cover;background-position:center;background-color:#d9dce1}
.rc .art-head{margin-top:${px(18 * k)};font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:${px(headSize)};line-height:1.18;letter-spacing:-.01em}
.rc .art-body{margin-top:${px(16 * k)};font-size:${px(30 * k)};line-height:1.45;color:#2a2d33}`;
  return { html, css, box: boxOf(L, x, y, w, h), title: `Article card: ${headline.slice(0, 48)}` };
}

/** A torn edge down the left of a w × h panel, as clip-path points (x jitter within `depth`). */
function tornEdge(w: number, h: number, depth: number, seed: number, shift = 0): string {
  const steps = 26;
  const pts: string[] = [`${px(w)} 0px`, `${px(w)} ${px(h)}`];
  for (let i = steps; i >= 0; i--) {
    const yy = (h * i) / steps;
    const jag = (hash(i, seed) * 0.75 + (i % 2) * 0.25) * depth;
    pts.push(`${px(jag + shift)} ${px(yy)}`);
  }
  return `polygon(${pts.join(',')})`;
}

function thenNow(L: Layout, p: Params): Built {
  const { k } = L;
  const pw = L.portrait ? L.W * 0.43 : 300 * k;
  const ph = pw * 1.3;
  const tear = 34 * k;
  const w = pw * 2 - tear * 0.6;
  const thenImg = pictureUrl(p.then);
  const nowImg = pictureUrl(p.now);
  const thenLabel = str(p, ['thenLabel', 'labelThen'], 'THEN');
  const nowLabel = str(p, ['nowLabel', 'labelNow'], 'NOW');
  const thenText = str(p, ['thenText', 'thenCaption']);
  const nowText = str(p, ['nowText', 'nowCaption']);
  const seed = seedOf(`${thenLabel}${nowLabel}${thenText}${nowText}`);
  const { x, y } = place(L, str(p, ['placement', 'side']), w, ph, L.portrait ? 'bottom' : 'left');
  const nowW = pw + tear * 0.4;
  const panel = (img: string | null, label: string, caption: string, fallback: string) =>
    `<div class="tn-pic" style="${img ? `background-image:${img}` : `background-image:${fallback}`}"><div class="tn-label">${esc(label)}</div>${!img && caption ? `<div class="tn-cap">${esc(caption)}</div>` : ''}</div>`;
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(ph)}">
  <div class="a slide-u tn" style="${d(0)};--rot:${x + w / 2 < L.W / 2 ? -1.5 : 1.5}deg">
    <div class="tn-then">${panel(thenImg, thenLabel, thenText, 'linear-gradient(160deg,#8a6d4b,#3b2c1d)')}</div>
    <div class="a pop tn-now" style="${d(0.2)};--r0:4deg;left:${px(w - nowW)};width:${px(nowW)}">
      <div class="tn-paper" style="clip-path:${tornEdge(nowW, ph, tear * 0.55, seed)}"></div>
      <div class="tn-img" style="clip-path:${tornEdge(nowW, ph, tear * 0.55, seed, tear * 0.32)}">${panel(nowImg, nowLabel, nowText, 'linear-gradient(160deg,#3d6f9b,#15283a)')}</div>
    </div>
  </div></div>`);
  const css = `.rc .tn{position:absolute;inset:0;filter:drop-shadow(0 ${px(18 * k)} ${px(26 * k)} #000000a8)}
.rc .tn-then{position:absolute;left:0;top:0;width:${px(pw)};height:100%;border-radius:${px(10 * k)};overflow:hidden}
.rc .tn-now{position:absolute;top:0;height:100%;filter:drop-shadow(${px(-6 * k)} 0 ${px(8 * k)} #0000008c)}
.rc .tn-paper{position:absolute;inset:0;background:linear-gradient(90deg,#e9e3d6,#fbf8f1 40%,#fff);border-radius:0 ${px(10 * k)} ${px(10 * k)} 0}
.rc .tn-img{position:absolute;inset:0;border-radius:0 ${px(10 * k)} ${px(10 * k)} 0;overflow:hidden}
.rc .tn-pic{position:absolute;inset:0;background-size:cover;background-position:center}
.rc .tn-label{position:absolute;left:0;right:0;top:${px(16 * k)};text-align:center;font-family:"Segoe UI Black","Arial Black",sans-serif;font-size:${px(40 * k)};letter-spacing:.02em;color:#fff;text-shadow:0 ${px(3 * k)} ${px(10 * k)} #000c,0 0 ${px(2 * k)} #000}
.rc .tn-cap{position:absolute;left:${px(18 * k)};right:${px(18 * k)};bottom:${px(22 * k)};text-align:center;font-weight:800;font-size:${px(30 * k)};line-height:1.15;text-shadow:0 ${px(2 * k)} ${px(8 * k)} #000b}`;
  return { html, css, box: boxOf(L, x, y, w, ph), title: `${thenLabel} / ${nowLabel} card` };
}

function factStrip(L: Layout, p: Params): Built {
  const { k } = L;
  const text = str(p, ['text', 'fact', 'title'], 'A fact worth checking.');
  const highlight = str(p, ['highlight', 'phrase']);
  const source = str(p, ['source', 'label']);
  const size = (L.portrait ? 40 : 42) * k;
  const maxW = L.W * (L.portrait ? 0.88 : 0.9);
  const padX = 22 * k;
  const chip = source ? source.length * size * 0.62 + 30 * k : 0;
  const oneLine = text.length * size * 0.5 + chip + padX * 2;
  const w = Math.min(maxW, oneLine);
  const lines = Math.max(1, Math.ceil(oneLine / maxW));
  const h = lines * size * 1.3 + 22 * k;
  const { x, y } = place(L, str(p, ['placement', 'side']) || 'bottom', w, h, 'bottom');
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)}">
  <div class="a slide-l fs" style="${d(0)};--from:40%">${source ? `<span class="fs-chip">${esc(source)}</span>` : ''}<span class="fs-text">${withMark(text, highlight, 0.5, 'mark a fs-hl')}</span></div></div>`);
  const css = `.rc .fs{background:#fff;border-radius:${px(8 * k)};padding:${px(11 * k)} ${px(padX)};font-family:Arial,Helvetica,sans-serif;font-size:${px(size)};line-height:1.3;color:#4d5156;box-shadow:0 ${px(10 * k)} ${px(30 * k)} #00000070;text-align:left}
.rc .fs-chip{display:inline-block;margin-right:${px(14 * k)};padding:0 ${px(10 * k)};border-radius:${px(6 * k)};background:#f5c518;color:#111;font-weight:900;font-size:${px(size * 0.8)};vertical-align:.08em}
.rc .fs-hl{font-weight:700;color:#202124}`;
  return { html, css, box: boxOf(L, x, y, w, h), title: `Fact strip: ${text.slice(0, 48)}` };
}

const VERIFIED = (s: number) => `<svg width="${px(s)}" height="${px(s)}" viewBox="0 0 24 24" style="flex:none"><path fill="#1d9bf0" d="M12 1l2.6 2.3 3.5-.4.9 3.4 3.1 1.7-1.2 3.3 1.2 3.3-3.1 1.7-.9 3.4-3.5-.4L12 23l-2.6-2.3-3.5.4-.9-3.4-3.1-1.7 1.2-3.3L1.9 8.3 5 6.6l.9-3.4 3.5.4z"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7.5 12.3l3 3 6-6.2"/></svg>`;

function profileCard(L: Layout, p: Params): Built {
  const { k } = L;
  const s = L.portrait ? 1.35 : 1;
  const name = str(p, ['name', 'title'], 'Creator');
  const handle = str(p, ['handle', 'username'], name.toLowerCase().replace(/[^a-z0-9_.]+/g, '')).replace(/^@/, '');
  const avatar = pictureUrl(p.avatar);
  const bio = str(p, ['bio', 'subtitle']);
  const verified = p.verified !== false;
  const stats = [[compact(p.posts, '0'), 'posts'], [compact(p.followers, '0'), 'followers'], [compact(p.following, '0'), 'following']];
  const w = Math.min(L.W * 0.9, 660 * k * s);
  const h = (bio ? 262 : 222) * k * s;
  const { x, y } = place(L, str(p, ['placement', 'side']) || 'bottom', w, h, 'bottom');
  const u = k * s;
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">
  <div class="a slide-u ig" style="${d(0)}">
    <div class="ig-row"><div class="ig-ring"><div class="ig-av" style="${avatar ? `background-image:${avatar}` : ''}">${avatar ? '' : esc(initials(name))}</div></div>
      <div class="ig-main"><div class="ig-handle">${esc(handle)}${verified ? VERIFIED(26 * u) : ''}<span class="ig-btn a pop" style="${d(0.45)}">Follow</span></div>
        <div class="ig-stats">${stats.map(([v, l], i) => `<span class="a rise" style="${d(0.25 + i * 0.08)}"><b>${esc(v)}</b> ${l}</span>`).join('')}</div></div></div>
    <div class="ig-name">${esc(name)}</div>${bio ? `<div class="ig-bio">${esc(bio)}</div>` : ''}
  </div></div>`);
  const css = `.rc .ig{position:absolute;inset:0;background:#fff;color:#0f1419;border-radius:${px(22 * u)};padding:${px(26 * u)} ${px(30 * u)};box-shadow:0 ${px(24 * u)} ${px(60 * u)} #00000090;font-family:"Segoe UI",Arial,sans-serif}
.rc .ig-row{display:flex;align-items:center;gap:${px(26 * u)}}
.rc .ig-ring{flex:none;width:${px(118 * u)};height:${px(118 * u)};border-radius:50%;padding:${px(5 * u)};background:linear-gradient(45deg,#feda75,#fa7e1e 30%,#d62976 60%,#962fbf 80%,#4f5bd5)}
.rc .ig-av{width:100%;height:100%;border-radius:50%;border:${px(4 * u)} solid #fff;background-color:#dfe3e8;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${px(40 * u)};color:#5a6270}
.rc .ig-main{flex:1;min-width:0;overflow:hidden}
.rc .ig-handle{display:flex;align-items:center;gap:${px(8 * u)};font-size:${px(30 * u)};font-weight:600;white-space:nowrap}
.rc .ig-btn{margin-left:auto;background:#0095f6;color:#fff;font-size:${px(22 * u)};font-weight:700;padding:${px(8 * u)} ${px(22 * u)};border-radius:${px(10 * u)}}
.rc .ig-stats{display:flex;gap:${px(20 * u)};margin-top:${px(14 * u)};font-size:${px(22 * u)};color:#262626;white-space:nowrap}
.rc .ig-stats b{font-weight:700;color:#0f1419}
.rc .ig-name{margin-top:${px(16 * u)};font-weight:700;font-size:${px(23 * u)}}
.rc .ig-bio{margin-top:${px(4 * u)};font-size:${px(22 * u)};color:#3b3f45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
  return { html, css, box: boxOf(L, x, y, w, h), title: `Profile card: @${handle}` };
}

function posterCard(L: Layout, p: Params): Built {
  const { k } = L;
  const image = pictureUrl(p.image);
  const title = str(p, ['title', 'text']);
  const tilt = num(p, 'tilt', 4, -20, 20);
  const aspect = num(p, 'aspect', 2 / 3, 0.4, 1.8);
  const border = 14 * k;
  const h = L.portrait ? L.H * 0.4 : L.H * 0.62;
  const w = h * aspect;
  const where = str(p, ['placement', 'side']) || 'right';
  const { x, y } = place(L, where, w, h, 'right');
  const rot = x + w / 2 < L.W / 2 ? -tilt : tilt;
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">
  <div class="a pop po" style="${d(0)};--rot:${rot}deg;--r0:${rot * 3}deg">
    <div class="po-pic" style="${image ? `background-image:${image}` : ''}">${image ? '' : `<div class="po-title">${esc(title || 'POSTER')}</div>`}</div>
  </div></div>`);
  const css = `.rc .po{position:absolute;inset:0;background:#fff;padding:${px(border)};box-shadow:0 ${px(24 * k)} ${px(50 * k)} #000000b0,0 ${px(4 * k)} ${px(10 * k)} #0006}
.rc .po-pic{width:100%;height:100%;background-color:#1d2330;background-image:linear-gradient(170deg,#3a4660,#10131b);background-size:cover;background-position:center;display:flex;align-items:flex-end;justify-content:center}
.rc .po-title{padding:${px(24 * k)};text-align:center;font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:${px(46 * k)};line-height:1.05;color:#f3e6c8;text-shadow:0 ${px(3 * k)} ${px(12 * k)} #000}`;
  // The tilt widens the footprint a little.
  const grow = Math.abs(Math.sin((rot * Math.PI) / 180)) * h * 0.5;
  return { html, css, box: boxOf(L, x - grow, y - grow * 0.3, w + grow * 2, h + grow * 0.6), title: `Poster card${title ? `: ${title.slice(0, 40)}` : ''}` };
}

const STICKER_SHAPES = ['heart', 'burst', 'badge', 'circle'] as const;
const STICKER_COLOURS: Record<(typeof STICKER_SHAPES)[number], string> = { heart: '#ff1f5a', burst: '#ffd21f', badge: '#1f6dff', circle: '#ff7a00' };

function stickerSvg(shape: (typeof STICKER_SHAPES)[number], fill: string, seed: number): string {
  const edge = 'stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round"';
  switch (shape) {
    case 'heart':
      return `<svg viewBox="-3 -3 106 98" preserveAspectRatio="none" class="st-svg"><path d="M50 90 C 20 68 1 50 1 28 C 1 12 13 1 28 1 C 38 1 46 7 50 15 C 54 7 62 1 72 1 C 87 1 99 12 99 28 C 99 50 80 68 50 90 Z" fill="${fill}" ${edge}/><path d="M24 12 C 16 13 10 20 10 29" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/></svg>`;
    case 'burst': {
      const pts: string[] = [];
      const spikes = 16;
      for (let i = 0; i < spikes * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / spikes;
        const r = i % 2 === 0 ? 49 : 36 + hash(i, seed) * 4;
        pts.push(`${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`);
      }
      return `<svg viewBox="-3 -3 106 106" preserveAspectRatio="none" class="st-svg"><polygon points="${pts.join(' ')}" fill="${fill}" ${edge}/></svg>`;
    }
    case 'circle':
      return `<svg viewBox="-3 -3 106 106" preserveAspectRatio="none" class="st-svg"><circle cx="50" cy="50" r="48" fill="${fill}" ${edge}/><circle cx="50" cy="50" r="41" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.6" stroke-dasharray="3 2.4"/></svg>`;
    default:
      return `<svg viewBox="-3 -3 106 66" preserveAspectRatio="none" class="st-svg"><rect x="1" y="1" width="98" height="58" rx="14" fill="${fill}" ${edge}/><rect x="7" y="7" width="86" height="46" rx="9" fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.6" stroke-dasharray="3.2 2.4"/></svg>`;
  }
}

/**
 * A bare emoji sticker (the emoji_pop move and the bleep's mouth cover). Text clips export through
 * libass, which draws emoji as flat outlines; an html graphic keeps them in colour.
 */
function emojiSticker(L: Layout, p: Params): Built {
  const emoji = str(p, ['text', 'emoji'], '😂');
  const size = num(p, 'size', 0.16, 0.03, 0.8) * L.H;
  const cx = num(p, 'x', 0.78, 0, 1) * L.W;
  const cy = num(p, 'y', 0.28, 0, 1) * L.H;
  const x = clamp(cx - size / 2, 0, L.W - size);
  const y = clamp(cy - size / 2, 0, L.H - size);
  const rot = num(p, 'rotation', 0, -45, 45);
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(size)};height:${px(size)}">
  <div class="a pop em" style="${d(0)};--rot:${rot}deg;--r0:${rot - 18}deg;font-size:${px(size * 0.86)}">${esc(emoji)}</div></div>`);
  const css = `.rc .em{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;line-height:1;font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;filter:drop-shadow(0 ${px(8 * L.k)} ${px(14 * L.k)} #00000073)}`;
  return { html, css, box: boxOf(L, x, y, size, size), title: `Emoji: ${emoji}` };
}

function stickerBadge(L: Layout, p: Params): Built {
  if (p.shape === 'emoji') return emojiSticker(L, p);
  const shape = oneOf(p, 'shape', STICKER_SHAPES, 'heart');
  const text = str(p, ['text', 'title'], 'NO HATE');
  const fill = colour(p, ['color', 'fill', 'accent'], STICKER_COLOURS[shape]);
  const ink = colour(p, ['textColor', 'ink'], shape === 'burst' ? '#1a1a1a' : '#ffffff');
  const size = num(p, 'size', 0.4, 0.1, 0.9) * Math.min(L.W, L.H);
  const ratio = shape === 'heart' ? 0.92 : shape === 'badge' ? 0.62 : 1;
  const w = shape === 'badge' ? size * 1.25 : size;
  const h = w * ratio;
  const cx = num(p, 'x', L.portrait ? 0.5 : 0.2, 0, 1) * L.W;
  const cy = num(p, 'y', L.portrait ? 0.3 : 0.42, 0, 1) * L.H;
  const x = clamp(cx - w / 2, L.W * 0.03, L.W * 0.97 - w);
  const y = clamp(cy - h / 2, L.H * 0.04, L.H * 0.96 - h);
  const rot = num(p, 'rotation', -7, -45, 45);
  const words = text.split(/\s+/).filter(Boolean);
  const lines = words.length <= 1 ? [text] : words.length === 2 ? words : [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const inner = shape === 'heart' ? 0.62 : shape === 'burst' ? 0.66 : 0.8;
  const fs = Math.min(h * (lines.length > 1 ? 0.24 : 0.32), (w * inner) / (longest * 0.66));
  const html = wrap(L, `<div class="x" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}">
  <div class="a pop st" style="${d(0)};--rot:${rot}deg;--r0:${rot - 25}deg">${stickerSvg(shape, fill, seedOf(text))}
    <div class="st-text" style="font-size:${px(fs)};color:${ink};${shape === 'heart' ? 'padding-bottom:12%' : ''}">${lines.map((line) => `<div>${esc(line.toUpperCase())}</div>`).join('')}</div>
  </div></div>`);
  const css = `.rc .st{position:absolute;inset:0;filter:drop-shadow(0 ${px(12 * L.k)} ${px(18 * L.k)} #00000080)}
.rc .st-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.rc .st-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:"Segoe UI Black","Arial Black",sans-serif;line-height:.98;letter-spacing:.01em;text-shadow:0 ${px(3 * L.k)} ${px(6 * L.k)} #0000004d}`;
  return { html, css, box: boxOf(L, x, y, w, h), title: `Sticker: ${text.slice(0, 40)}` };
}

function titleCard(L: Layout, p: Params): Built {
  const { k } = L;
  const explicit = [str(p, ['line1', 'white']), str(p, ['line2', 'yellow', 'accentLine'])];
  let [white, yellow] = explicit;
  if (!white && !yellow) {
    const text = str(p, ['text', 'title'], 'YOU ARE THE REASON');
    const parts = text.split(/\s*(?:\n|\/|\|)\s*/).filter(Boolean);
    if (parts.length >= 2) [white, yellow] = [parts[0], parts.slice(1).join(' ')];
    else {
      const words = text.split(/\s+/).filter(Boolean);
      yellow = words.length > 1 ? words[words.length - 1] : text;
      white = words.length > 1 ? words.slice(0, -1).join(' ') : '';
    }
  }
  const accent = colour(p, ['accent', 'color'], '#ffe600');
  const photo = pictureUrl(p.photo) ?? pictureUrl(p.image);
  const cutout = oneOf(p, 'photoStyle', ['square', 'cutout'] as const, 'square') === 'cutout';
  const side = L.portrait ? 520 * k : 400 * k;
  const size = (L.portrait ? 104 : 96) * k;
  const whiteWords = white.split(/\s+/).filter(Boolean);
  const textW = L.portrait ? L.W * 0.86 : Math.min(L.W * 0.5, Math.max(...[white, yellow].map((line) => line.length * size * 0.62), size * 3));
  const gap = 44 * k;
  const groupW = L.portrait ? L.W * 0.86 : (photo ? side + gap : 0) + textW;
  const gx = (L.W - groupW) / 2;
  const photoX = L.portrait ? (L.W - side) / 2 : gx;
  const photoY = L.portrait ? L.H * 0.2 : (L.H - side) / 2;
  const textX = L.portrait ? gx : gx + (photo ? side + gap : 0);
  const textTop = L.portrait ? photoY + (photo ? side + gap * 1.3 : 0) : L.H / 2;
  const html = wrap(L, `<div class="tc-field"></div><div class="x" style="position:absolute;inset:0">
  ${photo ? `<div class="a pop tc-photo${cutout ? ' cut' : ''}" style="${d(0)};left:${px(photoX)};top:${px(photoY)};width:${px(side)};height:${px(side)};background-image:${photo};--r0:-6deg"></div>` : ''}
  <div class="tc-text" style="left:${px(textX)};top:${px(textTop)};width:${px(textW)};font-size:${px(size)};${L.portrait ? 'text-align:center' : 'transform:translateY(-50%)'}">
    ${white ? `<div class="tc-white">${whiteWords.map((word, i) => `<span class="a rise" style="${d(0.12 + i * 0.08)}">${esc(word.toUpperCase())}</span>`).join(' ')}</div>` : ''}
    <div class="tc-yellow a slam" style="${d(0.2 + whiteWords.length * 0.08)};color:${accent}">${esc(yellow.toUpperCase())}</div>
  </div></div>`);
  const css = `.rc .tc-field{position:absolute;inset:0;background:#000}
.rc .tc-photo{position:absolute;background-size:cover;background-position:center;border-radius:${px(6 * k)};box-shadow:0 ${px(16 * k)} ${px(40 * k)} #000000cc}
.rc .tc-photo.cut{background-size:contain;background-repeat:no-repeat;border-radius:0;box-shadow:none;filter:drop-shadow(${px(4 * k)} 0 0 #fff) drop-shadow(${px(-4 * k)} 0 0 #fff) drop-shadow(0 ${px(4 * k)} 0 #fff) drop-shadow(0 ${px(-4 * k)} 0 #fff) drop-shadow(0 ${px(14 * k)} ${px(24 * k)} #000c)}
.rc .tc-text{position:absolute;font-family:"Segoe UI Black","Arial Black",sans-serif;line-height:1.04;letter-spacing:-.005em}
.rc .tc-white{color:#fff}
.rc .tc-white span{display:inline-block}
.rc .tc-yellow{display:inline-block;transform-origin:20% 60%}`;
  return { html, css, box: { x: 0, y: 0, width: 1, height: 1 }, title: `Title card: ${[white, yellow].filter(Boolean).join(' / ').slice(0, 48)}` };
}

function ctaFire(L: Layout, p: Params): Built {
  const { k } = L;
  const text = str(p, ['text', 'title'], 'COMMENT DOWN BELOW').toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);
  const maxW = L.W * (L.portrait ? 0.88 : 0.86);
  const lines = L.portrait && text.length > 11 ? 2 : 1;
  const perLine = Math.ceil(text.length / lines);
  const size = Math.min((L.portrait ? 170 : 190) * k, maxW / (perLine * 0.55 + 0.4));
  const h = lines * size * 1.02;
  const y = L.portrait ? L.H * 0.66 - h / 2 : L.H * 0.86 - h;
  const seed = seedOf(text);
  const sparks = Array.from({ length: 16 }, (_, i) => {
    const sx = 8 + hash(i, seed) * 84;
    const size2 = (4 + hash(i, seed + 3) * 7) * k;
    const dur = 1.1 + hash(i, seed + 5) * 1.2;
    return `<i class="cta-spark loop" style="left:${sx.toFixed(1)}%;width:${px(size2)};height:${px(size2)};animation-duration:${dur.toFixed(2)}s;${d(-hash(i, seed + 7) * dur)}"></i>`;
  }).join('');
  const word = (w: string, i: number) => `<span class="cta-w a slam" style="${d(0.05 + i * 0.13)}"><span class="cta-g loop" style="${d(i * 0.21)}">${esc(w)}</span><span class="cta-s">${esc(w)}</span><span class="cta-f">${esc(w)}</span></span>`;
  const html = wrap(L, `<div class="x" style="position:absolute;inset:0">
  <div class="cta-glow a" style="${d(0)}"><div class="cta-glow-in loop"></div></div>
  <div class="cta-sparks">${sparks}</div>
  <div class="cta-text" style="top:${px(y)};font-size:${px(size)}">${words.map(word).join(' ')}</div>
  </div>`);
  const css = `.rc .cta-glow{position:absolute;left:-10%;right:-10%;bottom:${L.portrait ? '8%' : '-18%'};height:${L.portrait ? '55%' : '62%'};animation-name:rc-fade;animation-duration:.5s}
.rc .cta-glow-in{position:absolute;inset:0;background:radial-gradient(ellipse 50% 50% at 50% 60%,#ff2a00c0 0%,#ff4a0070 38%,#c0100020 66%,transparent 78%);animation-name:rc-flicker;animation-duration:1.3s}
.rc .cta-sparks{position:absolute;left:0;right:0;bottom:0;height:${L.portrait ? '48%' : '60%'}}
.rc .cta-spark{position:absolute;bottom:0;border-radius:50%;background:radial-gradient(circle,#fff6c0 0%,#ffb020 45%,#ff5a0000 72%);animation-name:rc-spark}
.rc .cta-text{position:absolute;left:0;right:0;text-align:center;${lines === 1 ? 'white-space:nowrap;' : ''}font-family:Impact,"Arial Black",sans-serif;line-height:1.02;letter-spacing:.012em;padding:0 4%}
.rc .cta-w{display:inline-grid;margin:0 .06em}
.rc .cta-w>span{grid-area:1/1;position:relative}
.rc .cta-g{z-index:0;color:#ff3000;text-shadow:0 0 ${px(12 * k)} #ff6a00,0 0 ${px(34 * k)} #ff2a00,0 0 ${px(70 * k)} #ff0000;-webkit-text-stroke:${px(14 * k)} #d81800;animation-name:rc-flame;animation-duration:.8s}
.rc .cta-s{z-index:1;color:transparent;-webkit-text-stroke:${px(9 * k)} #fff1c9}
.rc .cta-f{z-index:2;color:transparent;background-image:linear-gradient(180deg,#fff8b8 0%,#ffd21a 30%,#ff8c00 64%,#ff3b00 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
@keyframes rc-fade{from{opacity:0}to{opacity:1}}
@keyframes rc-flicker{0%{opacity:.85;transform:scale(1)}17%{opacity:1;transform:scale(1.03)}31%{opacity:.78}46%{opacity:.95;transform:scale(.99)}63%{opacity:.82}80%{opacity:1;transform:scale(1.02)}100%{opacity:.85;transform:scale(1)}}
@keyframes rc-flame{0%,100%{opacity:.92}25%{opacity:1}50%{opacity:.8}75%{opacity:.97}}
@keyframes rc-spark{0%{transform:translate(0,0) scale(1);opacity:0}12%{opacity:1}100%{transform:translate(${px(30 * k)},${px(-L.H * 0.45)}) scale(.3);opacity:0}}`;
  return { html, css, box: boxOf(L, L.W * 0.05, y, L.W * 0.9, h), title: `CTA: ${text.slice(0, 40)}` };
}

const BUILDERS: Record<CardTemplateId, (L: Layout, p: Params) => Built> = {
  'roast-article-card': articleCard,
  'roast-then-now': thenNow,
  'roast-fact-strip': factStrip,
  'roast-profile-card': profileCard,
  'roast-poster-card': posterCard,
  'roast-sticker-badge': stickerBadge,
  'roast-title-card': titleCard,
  'roast-cta-fire': ctaFire,
};

/**
 * Builds a roast card as an html clip source for `comp`: markup and CSS on the comp's design canvas,
 * the template id, a title for the timeline and the box it draws in (fractions of the frame, for
 * frame QA). The card enters with an overshoot and leaves in the last quarter second of the clip.
 */
export function buildRoastCard(id: CardTemplateId, params: Record<string, unknown>, comp: Pick<Comp, 'width' | 'height'>): RoastCardSource {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`Unknown roast card "${id}" (known: ${CARD_TEMPLATES.join(', ')})`);
  const canvas = cardCanvas(comp);
  const layout: Layout = { W: canvas.width, H: canvas.height, k: Math.min(canvas.width, canvas.height) / 1080, portrait: canvas.height > canvas.width };
  const built = builder(layout, params ?? {});
  return { type: 'html', html: built.html, css: BASE_CSS + built.css, title: built.title, template: id, box: built.box };
}

// ───────────────────────── specs ─────────────────────────

const PLACEMENT: RoastCardParam = { name: 'placement', type: 'enum', values: ['left', 'right', 'bottom', 'center', 'top'], about: 'where the card sits (the host keeps the middle)' };
const IMAGE_NOTE = 'a data: URL, a local path or an asset id (run prepareRoastCardImages first so it exports)';

export const ROAST_CARD_SPECS: RoastCardSpec[] = [
  {
    id: 'roast-article-card',
    label: 'News article receipt',
    use: 'Proof on screen: a white news-article card (source, date, optional picture, serif headline) slides in beside the host and one line gets a yellow highlighter sweep. Use when the host cites a report or a quote.',
    seconds: 4,
    fullFrame: false,
    params: [
      { name: 'headline', type: 'string', about: 'the article headline', required: true },
      { name: 'source', type: 'string', default: 'NEWS', about: 'site or publisher name' },
      { name: 'date', type: 'string', about: 'publication date as shown' },
      { name: 'image', type: 'image', about: `the article picture — ${IMAGE_NOTE}` },
      { name: 'highlight', type: 'string', about: 'the line to highlight: a phrase of the headline, or a line of body copy shown under it' },
      { name: 'accent', type: 'color', default: '#d0021b', about: 'the source logo colour' },
      { ...PLACEMENT, default: 'right' },
    ],
  },
  {
    id: 'roast-then-now',
    label: 'THEN / NOW torn cards',
    use: 'A before/after comparison: two pictures side by side, the NOW one ripping in over a torn-paper edge, THEN / NOW labels on top. For glow-ups, broken promises and "what they said vs what they did".',
    seconds: 4,
    fullFrame: false,
    params: [
      { name: 'then', type: 'image', about: `the before picture — ${IMAGE_NOTE}` },
      { name: 'now', type: 'image', about: `the after picture — ${IMAGE_NOTE}` },
      { name: 'thenLabel', type: 'string', default: 'THEN', about: 'left label' },
      { name: 'nowLabel', type: 'string', default: 'NOW', about: 'right label' },
      { name: 'thenText', type: 'string', about: 'caption shown when there is no before picture' },
      { name: 'nowText', type: 'string', about: 'caption shown when there is no after picture' },
      { ...PLACEMENT, default: 'left' },
    ],
  },
  {
    id: 'roast-fact-strip',
    label: 'Fact strip',
    use: 'A Google / IMDb style white snippet strip slides in at the bottom with the key phrase highlighted ("…has a runtime of 2h 54m"). For numbers and facts that make the joke.',
    seconds: 3.5,
    fullFrame: false,
    params: [
      { name: 'text', type: 'string', about: 'the fact, one sentence', required: true },
      { name: 'highlight', type: 'string', about: 'the phrase inside it to bold and highlight' },
      { name: 'source', type: 'string', about: 'a small chip before it ("IMDb", "Google")' },
      { ...PLACEMENT, default: 'bottom' },
    ],
  },
  {
    id: 'roast-profile-card',
    label: 'Instagram profile card',
    use: 'An Instagram-style profile header (ring avatar, handle, verified tick, posts / followers / following, name, bio, Follow) pops up. For "who is this person" and follower-count jokes.',
    seconds: 3.5,
    fullFrame: false,
    params: [
      { name: 'name', type: 'string', about: 'display name', required: true },
      { name: 'handle', type: 'string', about: 'username without @ (derived from the name when missing)' },
      { name: 'avatar', type: 'image', about: `profile picture — ${IMAGE_NOTE}` },
      { name: 'followers', type: 'string', about: 'number or text ("2.1M")' },
      { name: 'posts', type: 'string', about: 'number or text' },
      { name: 'following', type: 'string', about: 'number or text' },
      { name: 'bio', type: 'string', about: 'one bio line' },
      { name: 'verified', type: 'boolean', default: true, about: 'show the blue tick' },
      { ...PLACEMENT, default: 'bottom' },
    ],
  },
  {
    id: 'roast-poster-card',
    label: 'Poster card',
    use: 'A film poster or cover as a physical print: white border, deep shadow, a slight tilt, dropping in with a pop. For "this is the thing we are talking about".',
    seconds: 3.5,
    fullFrame: false,
    params: [
      { name: 'image', type: 'image', about: `the poster — ${IMAGE_NOTE}` },
      { name: 'title', type: 'string', about: 'shown on a dark card when there is no picture' },
      { name: 'tilt', type: 'number', default: 4, about: 'degrees; mirrored on the left side' },
      { name: 'aspect', type: 'number', default: 2 / 3, about: 'width / height of the picture' },
      { ...PLACEMENT, default: 'right' },
    ],
  },
  {
    id: 'roast-sticker-badge',
    label: 'Sticker badge',
    use: 'A die-cut sticker (heart, burst, badge or circle) with bold words wobbles in — the pink "NO HATE" heart disclaimer, "FACT", "100% REAL", "EXPOSED".',
    seconds: 2.5,
    fullFrame: false,
    params: [
      { name: 'text', type: 'string', about: 'one to three words', required: true },
      { name: 'shape', type: 'enum', values: [...STICKER_SHAPES, 'emoji'], default: 'heart', about: 'sticker outline; emoji: the text is one big colour emoji with no badge behind it (size = fraction of frame height)' },
      { name: 'color', type: 'color', about: 'fill (heart #ff1f5a, burst #ffd21f, badge #1f6dff, circle #ff7a00)' },
      { name: 'textColor', type: 'color', about: 'word colour (white; dark on the yellow burst)' },
      { name: 'x', type: 'number', default: 0.2, about: 'centre, fraction of the width' },
      { name: 'y', type: 'number', default: 0.42, about: 'centre, fraction of the height' },
      { name: 'size', type: 'number', default: 0.4, about: 'width as a share of the frame\'s short side' },
      { name: 'rotation', type: 'number', default: -7, about: 'degrees' },
    ],
  },
  {
    id: 'roast-title-card',
    label: 'Cold-open title card',
    use: 'A black card with the target\'s photo on the left and two lines of heavy type — white, then the punchword in yellow ("YOU ARE THE" / "REASON"). For the cold open and chapter punchlines.',
    seconds: 1.5,
    fullFrame: true,
    params: [
      { name: 'text', type: 'string', about: 'the words; "/" or a line break splits white from yellow, else the last word goes yellow', required: true },
      { name: 'line1', type: 'string', about: 'the white line (instead of text)' },
      { name: 'line2', type: 'string', about: 'the yellow line (instead of text)' },
      { name: 'photo', type: 'image', about: `the target's photo — ${IMAGE_NOTE}` },
      { name: 'photoStyle', type: 'enum', values: ['square', 'cutout'], default: 'square', about: 'a framed square, or a transparent cut-out with a white sticker edge' },
      { name: 'accent', type: 'color', default: '#ffe600', about: 'the second line\'s colour' },
    ],
  },
  {
    id: 'roast-cta-fire',
    label: 'Fire CTA',
    use: 'The closing call to action in flaming type: orange-to-red gradient letters with a cream edge and a red flame glow, slamming in word by word over a flickering red glow with rising sparks ("COMMENT DOWN BELOW").',
    seconds: 3,
    fullFrame: false,
    params: [{ name: 'text', type: 'string', default: 'COMMENT DOWN BELOW', about: 'two to four words' }],
  },
];

export const roastCardSpec = (id: string) => ROAST_CARD_SPECS.find((spec) => spec.id === id);
