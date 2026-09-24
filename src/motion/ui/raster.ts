// Rasterises a UI screen (spec.ts) in the webview: the HTML is laid out off-screen in a shadow
// root, then drawn through the SVG foreignObject path the HTML graphics already use
// (lib/htmlFrames.ts), with the bundled fonts inlined. Out come the screen without its parts, one
// picture per `data-part` element (children parts left out, room for shadows around it) and the
// part map: boxes, nesting, corner radius, and the text style of fields the engine types into.
import { freezeStyles } from '../../lib/htmlFrames';
import { embeddedFontCss, BUNDLED_FONTS } from '../fonts';
import { liveTextTargets, type UiRaster, type UiRasterPart, type UiScreenSpec, type UiText } from './spec';

/** Stores one picture and returns the path (or URL) a footage source can load it from. */
export type SavePicture = (bytes: Uint8Array, name: string) => Promise<string>;

const MARGIN = 24;
const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '_');
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** `body`/`html` rules in the AI's CSS style the screen's root instead. */
export const scopeCss = (css: string) => css.replace(/(^|[},\s])(html|body)(?=[\s,.:#[{>+~])/g, '$1#ui-root');

function mount(html: string, css: string, w: number, h: number, background: string, dark: boolean) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${w}px;height:${h}px;overflow:hidden;pointer-events:none;contain:strict`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{all:initial}#ui-root{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${background};color:${dark ? '#eef0f6' : '#111827'};font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.4;box-sizing:border-box}#ui-root *{box-sizing:border-box}${scopeCss(css)}</style><div id="ui-root">${html}</div>`;
  document.body.appendChild(host);
  const root = shadow.getElementById('ui-root') as HTMLElement;
  return { root, unmount: () => host.remove() };
}

/** Pairs every live element under `live` with its clone. */
function pair(live: Element, clone: Element, map: Map<Element, HTMLElement>) {
  map.set(live, clone as HTMLElement);
  for (let i = 0; i < live.children.length && i < clone.children.length; i++) pair(live.children[i], clone.children[i], map);
}

const addStyle = (el: HTMLElement, css: string) => el.setAttribute('style', `${el.getAttribute('style') ?? ''};${css}`);

const toHex = (rgb: string) => {
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgb;
  const [r, g, b, a] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  const hex = [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return `#${hex}${a !== undefined && a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`;
};

async function draw(clone: HTMLElement, pseudo: string[], fonts: string, w: number, h: number, k: number): Promise<Uint8Array> {
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const style = document.createElement('style');
  style.textContent = `${fonts}\n${pseudo.join('\n')}`;
  clone.prepend(style);
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * k)}" height="${Math.round(h * k)}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the UI screen could not be rasterised'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the UI screen could not be encoded');
  return new Uint8Array(await blob.arrayBuffer());
}

function textOf(el: HTMLElement, box: [number, number, number, number]): UiText {
  const cs = getComputedStyle(el);
  const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : 'left';
  const left = box[0] + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
  const right = box[0] + box[2] - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
  return {
    value: (el.textContent ?? '').trim(),
    font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Inter',
    size: parseFloat(cs.fontSize) || 15,
    weight: parseInt(cs.fontWeight, 10) || 400,
    color: toHex(cs.color),
    align,
    x: align === 'left' ? left : align === 'right' ? right : (left + right) / 2,
    y: box[1] + box[3] / 2,
    width: right - left,
  };
}

/** Removes the element's own text (its child elements stay), so the engine can draw it live. */
function clearText(el: HTMLElement) {
  for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
  for (const child of Array.from(el.children)) if (!child.children.length) child.textContent = '';
}

const MOVERS = new Set(['drag', 'assemble']);

/** A screenshot with its parts marked by box: the parts are cut out of it (fields that are typed
 * into painted clean with the colour around them), and the screen under parts that travel is
 * filled the same way, so a dragged card leaves its slot empty. */
async function rasterizeShot(spec: UiScreenSpec, save: SavePicture, resolve: (path: string) => string): Promise<UiRaster> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = resolve(spec.screenshot!);
  await image.decode();
  const ratio = spec.screenshotScale ?? (spec.width ? image.naturalWidth / spec.width : 2);
  const w = spec.width ?? Math.round(image.naturalWidth / ratio);
  const h = spec.height ?? Math.round(image.naturalHeight / ratio);
  const k = spec.resolution ?? 2;
  const canvas = (cw: number, ch: number) => { const c = document.createElement('canvas'); c.width = Math.round(cw * k); c.height = Math.round(ch * k); return c; };
  const png = async (c: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png')))!.arrayBuffer());
  // The whole screenshot at the working density, to sample colours from.
  const full = canvas(w, h);
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(image, 0, 0, full.width, full.height);
  const sample = (x: number, y: number) => { const d = fctx.getImageData(Math.max(0, Math.min(full.width - 1, Math.round(x * k))), Math.max(0, Math.min(full.height - 1, Math.round(y * k))), 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
  const live = liveTextTargets(spec);
  const moving = new Set((spec.actions ?? []).flatMap((a) => (MOVERS.has(a.type) ? ('target' in a && a.target ? [a.target] : (spec.parts ?? []).filter((p) => !p.parent).map((p) => p.id)) : [])));
  const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number, r: number) => { c.beginPath(); c.roundRect(x * k, y * k, rw * k, rh * k, r * k); c.fill(); };

  const base = canvas(w, h);
  const bctx = base.getContext('2d')!;
  bctx.drawImage(full, 0, 0);
  for (const part of spec.parts ?? []) {
    if (!moving.has(part.id)) continue;
    const [x, y, pw, ph] = part.box;
    bctx.fillStyle = sample(x - 4, y - 4);
    roundRect(bctx, x - 1, y - 1, pw + 2, ph + 2, part.radius ?? 8);
  }
  const state: UiRaster['states'][number] = { id: 'main', base: await save(await png(base), 'main-screen.png'), parts: [] };
  for (const part of spec.parts ?? []) {
    const [x, y, pw, ph] = part.box;
    const c = canvas(pw + MARGIN * 2, ph + MARGIN * 2);
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = '#000';
    roundRect(ctx, MARGIN, MARGIN, pw, ph, part.radius ?? 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(full, x * k, y * k, pw * k, ph * k, MARGIN * k, MARGIN * k, pw * k, ph * k);
    ctx.restore();
    let text: UiText | undefined;
    if (live.has(part.id)) {
      const t = part.text ?? {};
      const inset = t.inset ?? 3;
      ctx.fillStyle = sample(x + inset + 2, y + ph / 2);
      roundRect(ctx, MARGIN + inset, MARGIN + inset, pw - inset * 2, ph - inset * 2, Math.max(0, (part.radius ?? 0) - inset));
      const align = t.align ?? 'left';
      const pad = Math.min(20, pw * 0.08);
      text = {
        value: t.value ?? '', font: t.font ?? 'Inter', size: t.size ?? Math.round(Math.min(ph * 0.36, 34)), weight: t.weight ?? 500, color: t.color ?? '#111827', align,
        x: align === 'left' ? x + pad : align === 'right' ? x + pw - pad : x + pw / 2, y: y + ph / 2, width: pw - pad * 2,
      };
    }
    state.parts.push({ id: part.id, box: part.box, path: await save(await png(c), `main-${slug(part.id)}.png`), margin: MARGIN, radius: part.radius ?? 0, ...(part.parent ? { parent: part.parent } : {}), ...(text ? { text } : {}) });
  }
  return { width: w, height: h, scale: k, background: sample(2, h - 2), states: [state] };
}

export async function rasterizeUi(spec: UiScreenSpec, save: SavePicture, resolve: (path: string) => string = (p) => p): Promise<UiRaster> {
  if (spec.screenshot) return rasterizeShot(spec, save, resolve);
  const w = spec.width ?? 1440;
  const h = spec.height ?? 900;
  const k = spec.resolution ?? 2;
  const dark = spec.theme === 'dark';
  const background = spec.background ?? (dark ? '#0f1117' : '#ffffff');
  const live = liveTextTargets(spec);
  const source = `${spec.html}\n${spec.css ?? ''}\n${(spec.states ?? []).map((s) => s.html).join('\n')}`;
  const families = ['Inter', ...BUNDLED_FONTS.filter((f) => source.includes(f))];
  const fonts = await embeddedFontCss(families);
  if (typeof document !== 'undefined' && document.fonts) await Promise.all(families.map((f) => document.fonts.load(`400 16px "${f}"`).catch(() => null)));
  const states: UiRaster['states'] = [];
  for (const state of [{ id: 'main', html: spec.html }, ...(spec.states ?? [])]) {
    const { root, unmount } = mount(state.html, spec.css ?? '', w, h, background, dark);
    try {
      await nextFrame();
      await nextFrame();
      const origin = root.getBoundingClientRect();
      const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-part]'));
      const boxOf = (el: Element): [number, number, number, number] => { const r = el.getBoundingClientRect(); return [r.left - origin.left, r.top - origin.top, r.width, r.height]; };
      const partOf = (el: Element | null): HTMLElement | null => (el ? el.parentElement?.closest<HTMLElement>('[data-part]') ?? null : null);
      const names = new Set<string>();
      const containers = new Map<Element, string>();
      const parts: UiRasterPart[] = [];
      const stateSlug = slug(state.id);

      // The screen without its parts.
      {
        const clone = root.cloneNode(true) as HTMLElement;
        const pseudo: string[] = [];
        freezeStyles(root, clone, pseudo, { n: 0 });
        const map = new Map<Element, HTMLElement>();
        pair(root, clone, map);
        for (const el of elements) if (!partOf(el)) addStyle(map.get(el)!, 'opacity:0');
        addStyle(clone, `position:relative;left:0;top:0;margin:0;background:${background}`);
        const base = await save(await draw(clone, pseudo, fonts, w, h, k), `${stateSlug}-screen.png`);
        states.push({ id: state.id, base, parts });
      }

      for (const el of elements) {
        let id = el.dataset.part || 'part';
        while (names.has(id)) id = `${id}_`;
        names.add(id);
        el.dataset.partId = id;
        const box = boxOf(el);
        if (box[2] < 1 || box[3] < 1) continue;
        const cw = box[2] + MARGIN * 2;
        const ch = box[3] + MARGIN * 2;
        // The part alone: frozen styles keep what it inherited; parts inside it are left out.
        const clone = el.cloneNode(true) as HTMLElement;
        const pseudo: string[] = [];
        freezeStyles(el, clone, pseudo, { n: 0 });
        const map = new Map<Element, HTMLElement>();
        pair(el, clone, map);
        for (const inner of el.querySelectorAll('[data-part]')) if (partOf(inner) === el) addStyle(map.get(inner)!, 'opacity:0');
        const liveText = live.has(el.dataset.part ?? '');
        const text = liveText ? textOf(el, box) : undefined;
        if (liveText) clearText(clone);
        addStyle(clone, `position:absolute;left:${MARGIN}px;top:${MARGIN}px;margin:0;width:${box[2]}px;height:${box[3]}px;opacity:1;transform:none`);
        const holder = document.createElement('div');
        holder.setAttribute('style', `position:relative;width:${cw}px;height:${ch}px;overflow:visible`);
        holder.appendChild(clone);
        const path = await save(await draw(holder, pseudo, fonts, cw, ch, k), `${stateSlug}-${slug(id)}.png`);
        const parent = partOf(el);
        parts.push({
          id, box, path, margin: MARGIN,
          ...(parent?.dataset.partId ? { parent: parent.dataset.partId } : {}),
          ...(el.parentElement ? { group: containers.get(el.parentElement) ?? (containers.set(el.parentElement, `g${containers.size + 1}`), containers.get(el.parentElement)!) } : {}),
          radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
          ...(text ? { text } : {}),
        });
      }
    } finally {
      unmount();
    }
  }
  return { width: w, height: h, scale: k, background, states };
}

