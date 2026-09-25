// React Bits — Backgrounds (57), rebuilt for video.
//
// Almost all of these are WebGL shaders on the web. Here each one is a layered gradient field, an
// SVG drawing or a CSS pattern with a paused loop, so it animates in the preview AND in the export
// (the frame renderer captures every frame). Every background accepts `colors` (2–4 hex: base,
// then highlights), `speed` and `intensity`; the default palette is the piece's own look, tuned
// toward the Crimson house style where the original was blue/violet.

import {
  L, P_ACCENT, P_INTENSITY, P_SPEED,
  accentStyle, bit, d, esc, hash, intensityOf, isColor, px, rng, speedOf, svg, textOf,
  type Bit, type BitContext, type BitLevel, type BitProp, type BitProps,
} from './core';

type Pal = [string, string, string, string];

const P_COLORS: BitProp = { name: 'colors', type: 'string[]', about: 'Two to four hex colours: base first, then highlights. Defaults to the background\'s own palette.' };
const BG_PROPS: BitProp[] = [P_COLORS, P_SPEED, P_INTENSITY, P_ACCENT];

const palette = (p: BitProps, fallback: Pal): Pal => {
  const own = L(p, 'colors', []).filter(isColor);
  if (own.length >= 2) {
    const out = own.slice(0, 4);
    while (out.length < 4) out.push(out[out.length - 1]);
    return out as Pal;
  }
  return fallback;
};

const BG_CSS = `
.rbx .bgx{position:absolute;inset:-4%;overflow:hidden}
.rbx .bgf{background-size:130% 130%,130% 130%,140% 140%,100% 100%}
.rbx .rbg-drift{animation-name:rbg-drift;animation-timing-function:ease-in-out;animation-direction:alternate}
.rbx .rbg-spin{animation-name:rbx-spin;animation-timing-function:linear}
.rbx .rbg-pulse{animation-name:rbg-pulse;animation-timing-function:ease-in-out}
.rbx .rbg-rain{animation-name:rbg-rain;animation-timing-function:linear}
.rbx .rbg-shimmer{animation-name:rbg-shimmer;animation-timing-function:ease-in-out;animation-direction:alternate}
.rbx .rbg-flow{animation-name:rbg-flow;animation-timing-function:linear}
.rbx .rbg-scan{animation-name:rbg-scan;animation-timing-function:linear}
.rbx .rbg-flicker{animation-name:rbg-flicker;animation-timing-function:steps(4,end)}
.rbx .rbg-sway{animation-name:rbg-sway;animation-timing-function:ease-in-out}
.rbx .grainx{pointer-events:none;background-image:radial-gradient(#ffffff22 1px,transparent 1.5px),radial-gradient(#00000033 1px,transparent 1.5px);background-size:calc(7px * var(--u)) calc(7px * var(--u)),calc(11px * var(--u)) calc(11px * var(--u));mix-blend-mode:overlay}
.rbx .vigx{pointer-events:none;background:radial-gradient(ellipse 80% 70% at 50% 50%,transparent 55%,#000000aa 100%)}
.rbx .scanl{pointer-events:none;background:repeating-linear-gradient(0deg,#0000 0,#0000 calc(3px * var(--u)),#00000066 calc(3px * var(--u)),#00000066 calc(5px * var(--u)))}
.rbx .gridl{background-image:linear-gradient(var(--gc,#ffffff22) 1px,transparent 1px),linear-gradient(90deg,var(--gc,#ffffff22) 1px,transparent 1px);background-size:var(--gs,calc(80px * var(--u))) var(--gs,calc(80px * var(--u)))}
.rbx .dotp{position:absolute;border-radius:50%}
@keyframes rbg-drift{from{background-position:0% 0%,100% 0%,50% 100%,0 0}to{background-position:100% 60%,0% 40%,60% 0%,0 0}}
@keyframes rbg-pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.08);opacity:1}}
@keyframes rbg-rain{from{background-position:0 0,0 0,0 0,0 0}to{background-position:0 100%,0 140%,0 80%,0 0}}
@keyframes rbg-shimmer{from{background-position:0% 0%,100% 0%,50% 100%,0 0;filter:saturate(.9)}to{background-position:80% 40%,20% 60%,60% 10%,0 0;filter:saturate(1.15)}}
@keyframes rbg-flow{from{background-position:0 0}to{background-position:0 100%}}
@keyframes rbg-scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
@keyframes rbg-flicker{0%,100%{opacity:1}25%{opacity:.85}50%{opacity:.95}75%{opacity:.8}}
@keyframes rbg-sway{0%,100%{transform:translateX(0)}50%{transform:translateX(calc(40px * var(--u)))}}
@keyframes rbg-rise{from{transform:translateY(0)}to{transform:translateY(-120vh)}}
@keyframes rbg-fall{from{transform:translateY(-20vh)}to{transform:translateY(120vh)}}
@keyframes rbg-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(var(--bh,-40vh))}}
@keyframes rbg-twinkle{0%,100%{opacity:.2}50%{opacity:1}}
@keyframes rbg-burst{from{transform:translate(0,0) scale(.2);opacity:1}to{transform:translate(var(--ox),var(--oy)) scale(1);opacity:0}}
@keyframes rbg-rush{from{background-size:20% 20%;opacity:.4}to{background-size:400% 400%;opacity:1}}
@keyframes rbg-flash{0%,92%,100%{opacity:0}93%,95%{opacity:1}94%{opacity:.4}}
@keyframes rbg-blink{0%,88%,100%{transform:scaleY(1)}93%{transform:scaleY(.06)}}
@keyframes rbg-wave{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-26px * var(--u)))}}
@keyframes rbg-marq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes rbg-marqr{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@keyframes rbg-flowx{from{background-position:0 0}to{background-position:100% 0}}
@keyframes rbg-dash{from{stroke-dashoffset:0}to{stroke-dashoffset:-400}}
`;

/** Four-corner colour field with a slow loop — the foundation of most React Bits backgrounds. */
const field = (c: Pal, loop: string, seconds: number, extra = ''): string =>
  `<div class="bgx bgf loop ${loop}" style="background-image:radial-gradient(120% 90% at 15% 10%,${c[1]} 0%,transparent 55%),radial-gradient(120% 100% at 85% 15%,${c[2]} 0%,transparent 50%),radial-gradient(140% 120% at 50% 100%,${c[3]} 0%,transparent 55%),linear-gradient(160deg,${c[0]},${c[0]});animation-duration:${seconds.toFixed(1)}s;${extra}"></div>`;
const solid = (c: Pal): string => `<div class="bgx" style="background:${c[0]}"></div>`;
const grain = (amount: number): string => `<div class="bgx grainx" style="opacity:${amount.toFixed(2)}"></div>`;
const vig = (): string => '<div class="bgx vigx"></div>';
/** Seeded particles: `make(i, x%, y%, r)` returns one element. */
const particles = (n: number, seed: number, make: (i: number, x: number, y: number, r: number, rand: () => number) => string): string => {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => make(i, rand() * 100, rand() * 100, rand(), rand)).join('');
};

const bg = (
  id: string, name: string, level: BitLevel, about: string, video: string, use: string, colors: Pal,
  build: (c: Pal, p: BitProps, ctx: BitContext, sp: number, k: number) => { html: string; css?: string },
  extraProps: BitProp[] = [],
): Bit => bit({
  id, name, category: 'background', level, about, video, use,
  props: [...BG_PROPS, ...extraProps], example: { colors: [...colors] }, seconds: 8, layout: 'fullscreen', tags: ['background', 'loop'],
  build: (p, ctx) => {
    const out = build(palette(p, colors), p, ctx, speedOf(p), intensityOf(p));
    return { html: `<div class="fill" style="${accentStyle(p)}">${out.html}</div>`, css: BG_CSS + (out.css ?? ''), box: { x: 0, y: 0, width: 1, height: 1 } };
  },
});

export const BACKGROUND_BITS: Bit[] = [
  bg('shape-waves', 'Shape Waves', 'intermediate', 'Rows of shapes undulate in waves.', 'Rows of SVG dots bob with a phase offset per column on a loop over a dark field.', 'Calm tech, data, wellness.', ['#0b0f19', '#1e293b', '#38bdf8', '#0b0f19'], (c, _p, _ctx, sp, k) => {
    const rows: string[] = [];
    for (let r = 0; r < 7; r++) for (let col = 0; col < 24; col++) rows.push(`<circle class="loop" cx="${40 + col * 80}" cy="${120 + r * 130}" r="${9 + r}" style="animation-name:rbg-wave;animation-duration:${(3 / sp).toFixed(2)}s;animation-timing-function:ease-in-out;${d(col * 0.09 + r * 0.2)};opacity:${(0.35 + r * 0.08).toFixed(2)}"/>`);
    return { html: `${solid(c)}${svg(rows.join(''), { style: `fill:${c[2]};transform:scale(${k})` })}${vig()}` };
  }),
  bg('aero-shards', 'Aero Shards', 'intermediate', 'Glass shards drift in haze.', 'Ten rotated translucent panels with rim highlights drift slowly over a misty field.', 'Premium tech reveals, hardware.', ['#0b1220', '#334155', '#93c5fd', '#0b1220'], (c, _p, ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 18 / sp)}${particles(10, hash(ctx.text + 'shards'), (i, x, y, r, rand) => `<div class="loop rbg-sway" style="position:absolute;left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${px(160 + r * 260)};height:${px(60 + r * 120)};transform:rotate(${(rand() * 60 - 30).toFixed(0)}deg);border-radius:${px(14)};background:linear-gradient(135deg,#ffffff22,#ffffff05);border:1px solid #ffffff44;box-shadow:inset 0 1px 0 #ffffff66;animation-duration:${((8 + i) / sp).toFixed(1)}s;${d(i * 0.7)}"></div>`)}${grain(0.2)}`,
  })),
  bg('ghost-fibers', 'Ghost Fibers', 'intermediate', 'Faint fibres curl in the dark.', 'Fourteen seeded SVG curves at low opacity sway on a loop over near-black.', 'Mystery, documentary, quiet intros.', ['#060606', '#1c1917', '#78716c', '#060606'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'fibers'));
    const paths = Array.from({ length: 14 }, (_, i) => `<path class="loop rbg-sway" d="M${rand() * 1920},-40 C${rand() * 1920},${rand() * 500} ${rand() * 1920},${500 + rand() * 500} ${rand() * 1920},1120" style="opacity:${(0.15 + rand() * 0.35).toFixed(2)};animation-duration:${((9 + i) / sp).toFixed(1)}s;${d(i * 0.5)}"/>`).join('');
    return { html: `${solid(c)}${svg(paths, { style: `fill:none;stroke:${c[2]};stroke-width:2` })}${vig()}` };
  }),
  bg('crt-warp', 'CRT Warp', 'intermediate', 'A curved CRT screen with scanlines and barrel glow.', 'Phosphor field, scanlines, a flicker loop and a barrel vignette inside a rounded screen.', 'Retro broadcasts, archives, VHS looks.', ['#0a0f0a', '#1a2e1a', '#4ade80', '#000000'], (c, _p, _ctx, sp, k) => ({
    html: `<div class="bgx" style="background:#000"></div><div class="bgx loop rbg-flicker" style="inset:2%;border-radius:8%/12%;overflow:hidden;background:radial-gradient(ellipse 70% 60% at 50% 45%,${c[2]}55 0%,${c[1]} 60%,${c[0]} 100%);animation-duration:${(0.4 / sp).toFixed(2)}s"><div class="bgx scanl" style="opacity:${(0.6 * k).toFixed(2)}"></div><div class="bgx loop rbg-scan" style="height:12%;background:linear-gradient(180deg,transparent,#ffffff18,transparent);animation-duration:${(3 / sp).toFixed(1)}s"></div></div>${vig()}`,
  })),
  bg('molten-metal', 'Molten Metal', 'advanced', 'Glowing cracks run through cooling rock.', 'A dark stone field with seeded SVG crack lines whose glow pulses, and an ember radial breathing beneath.', 'Intensity, forging, sport, drama.', ['#0c0a09', '#7c2d12', '#f97316', '#fbbf24'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'molten'));
    const cracks = Array.from({ length: 9 }, (_, i) => { let x = rand() * 1920; let y = rand() * 1080; let dd = `M${x.toFixed(0)},${y.toFixed(0)}`; for (let s = 0; s < 6; s++) { x += (rand() - 0.5) * 400; y += (rand() - 0.5) * 300; dd += ` L${x.toFixed(0)},${y.toFixed(0)}`; } return `<path class="loop rbg-pulse" d="${dd}" style="transform-origin:center;animation-duration:${((2 + rand() * 2) / sp).toFixed(1)}s;${d(i * 0.3)}"/>`; }).join('');
    return { html: `<div class="bgx" style="background:radial-gradient(ellipse 60% 50% at 50% 100%,${c[1]} 0%,${c[0]} 70%)"></div>${svg(cracks, { style: `fill:none;stroke:${c[2]};stroke-width:3;filter:drop-shadow(0 0 10px ${c[3]})` })}${grain(0.35)}${vig()}` };
  }),
  bg('gradient-waves', 'Gradient Waves', 'basic', 'Broad colour waves roll across the frame.', 'Three huge blurred ellipses of colour slide horizontally at different speeds over a drifting field.', 'Festivals, lifestyle, music beds.', ['#1e1b4b', '#7c3aed', '#f472b6', '#facc15'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 16 / sp)}${[1, 2, 3].map((i) => `<div class="loop rbg-sway" style="position:absolute;left:${-30 + i * 10}%;top:${10 + i * 22}%;width:90%;height:36%;border-radius:50%;background:${c[i]};filter:blur(${px(90)});opacity:.55;animation-duration:${((7 + i * 3) / sp).toFixed(1)}s;${d(i * 1.3)}"></div>`).join('')}`,
  })),
  bg('web-threads', 'Web Threads', 'advanced', 'A network mesh shimmers with connections.', 'Twenty-four seeded nodes joined to their nearest neighbours by faint SVG lines; nodes pulse in turn.', 'Data, AI, connectivity, networks.', ['#020617', '#172554', '#38bdf8', '#020617'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'web'));
    const nodes = Array.from({ length: 24 }, () => ({ x: rand() * 1920, y: rand() * 1080 }));
    const lines = nodes.map((a, i) => nodes.slice(i + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 420).map((b) => `<line x1="${a.x.toFixed(0)}" y1="${a.y.toFixed(0)}" x2="${b.x.toFixed(0)}" y2="${b.y.toFixed(0)}"/>`).join('')).join('');
    const dots = nodes.map((n, i) => `<circle class="loop rbg-pulse" cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="6" style="transform-origin:${n.x.toFixed(0)}px ${n.y.toFixed(0)}px;animation-duration:${(2.5 / sp).toFixed(1)}s;${d(i * 0.17)}"/>`).join('');
    return { html: `${field(c, 'rbg-drift', 20 / sp)}${svg(`<g style="stroke:${c[2]}55;stroke-width:1.5">${lines}</g><g style="fill:${c[2]}">${dots}</g>`)}` };
  }),
  bg('topography', 'Topography', 'basic', 'Contour lines breathe like a map.', 'Nested wobbly SVG ellipses (contours) sway slowly over a dark green field.', 'Outdoors, maps, documentaries.', ['#0c1a12', '#14532d', '#86efac', '#0c1a12'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}${svg(Array.from({ length: 12 }, (_, i) => `<ellipse class="loop rbg-sway" cx="${900 + i * 18}" cy="${560 - i * 10}" rx="${160 + i * 120}" ry="${90 + i * 70}" style="opacity:${(0.6 - i * 0.04).toFixed(2)};animation-duration:${((10 + i) / sp).toFixed(1)}s;${d(i * 0.4)};transform:rotate(${i * 3}deg);transform-origin:900px 560px"/>`).join(''), { style: `fill:none;stroke:${c[2]};stroke-width:2` })}${vig()}`,
  })),
  bg('light-tunnel', 'Light Tunnel', 'intermediate', 'Neon rings rush toward the camera.', 'A repeating radial ring pattern grows on a loop so the rings rush outward, with a bright core.', 'Intros, drops, travel, speed.', ['#000000', '#4c1d95', '#e879f9', '#0ea5e9'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="background:repeating-radial-gradient(circle at 50% 50%,${c[2]} 0,${c[2]} 2%,transparent 2.5%,transparent 9%,${c[3]} 9.5%,${c[3]} 10.5%,transparent 11%,transparent 20%);background-position:center;animation-name:rbg-rush;animation-duration:${(3 / sp).toFixed(1)}s;animation-timing-function:ease-in"></div><div class="bgx" style="background:radial-gradient(circle at 50% 50%,#fff 0%,${c[1]} 12%,transparent 40%)"></div>`,
  })),
  bg('sliced-waves', 'Sliced Waves', 'intermediate', 'Horizontal slices slide over a wave surface.', 'Eight horizontal strips each carry the same wave gradient at a different phase, moving on loops.', 'Glitch-art, fashion, music.', ['#111827', '#6d28d9', '#22d3ee', '#f472b6'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}${Array.from({ length: 8 }, (_, i) => `<div class="loop" style="position:absolute;left:-20%;width:140%;top:${i * 12.5}%;height:12.5%;background:linear-gradient(90deg,${c[1]},${c[2]},${c[3]},${c[1]});background-size:200% 100%;animation-name:rbg-flowx;animation-duration:${((6 + (i % 3) * 3) / sp).toFixed(1)}s;animation-timing-function:linear;animation-direction:${i % 2 ? 'reverse' : 'normal'};${d(i * 0.4)};opacity:.85"></div>`).join('')}`,
  })),
  bg('acid-squares', 'Acid Squares', 'intermediate', 'Saturated tiles phase hard.', 'A 12×7 grid of tiles flips colour in seeded loops with stepped timing.', 'Rave, streetwear, high energy.', ['#09090b', '#a3e635', '#ec4899', '#22d3ee'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'acid'));
    return { html: `${solid(c)}<div class="bgx" style="display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(7,1fr);gap:${px(4)}">${Array.from({ length: 84 }, (_, i) => `<i class="loop acidt" style="background:${c[1 + (i % 3)]};animation-duration:${((1 + rand() * 2) / sp).toFixed(2)}s;${d(rand() * 2)}"></i>`).join('')}</div>`, css: '.rbx .acidt{animation-name:rbg-twinkle;animation-timing-function:steps(2,end)}' };
  }),
  bg('scanner', 'Scanner', 'basic', 'A sweep line reveals a grid.', 'A fine grid with a bright horizontal scan bar sweeping top to bottom on a loop.', 'Security, tech, search, forensics.', ['#020617', '#082f49', '#38bdf8', '#020617'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx gridl" style="--gc:${c[2]}33;--gs:${px(70)}"></div><div class="bgx loop rbg-scan" style="height:18%;background:linear-gradient(180deg,transparent,${c[2]}55 60%,${c[2]} 100%);animation-duration:${(3.2 / sp).toFixed(1)}s"></div>${vig()}`,
  })),
  bg('ferrofluid', 'Ferrofluid', 'advanced', 'Magnetic spikes bloom from a black fluid.', 'Six glossy blobs with spiked conic edges pulse and merge under a contrast filter.', 'Science, premium idents, audio brands.', ['#030303', '#1f2937', '#9ca3af', '#000000'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'ferro'));
    return { html: `${solid(c)}<div class="bgx" style="filter:contrast(1.6) blur(${px(2)})">${Array.from({ length: 6 }, (_, i) => `<div class="loop rbg-pulse" style="position:absolute;left:${(20 + rand() * 60).toFixed(0)}%;top:${(20 + rand() * 60).toFixed(0)}%;width:${px(300 + rand() * 300)};height:${px(300 + rand() * 300)};margin:${px(-200)};border-radius:50%;background:radial-gradient(circle at 35% 35%,${c[2]} 0%,${c[1]} 30%,${c[0]} 70%),repeating-conic-gradient(${c[1]} 0 6deg,transparent 6deg 12deg);animation-duration:${((3 + rand() * 3) / sp).toFixed(1)}s;${d(i * 0.6)}"></div>`).join('')}</div>` };
  }),
  bg('lightfall', 'Lightfall', 'basic', 'A waterfall of light over dark.', 'Thirty seeded vertical light streaks fall at different speeds with soft blur.', 'Ceremony, worship, calm reveals.', ['#0a0a1a', '#312e81', '#e0e7ff', '#0a0a1a'], (c, _p, ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 22 / sp)}${particles(30, hash(ctx.text + 'fall'), (i, x, _y, r) => `<i class="loop" style="position:absolute;left:${x.toFixed(1)}%;top:-20%;width:${px(2 + r * 4)};height:${px(200 + r * 500)};background:linear-gradient(180deg,transparent,${c[2]},transparent);opacity:${(0.2 + r * 0.6).toFixed(2)};animation-name:rbg-fall;animation-duration:${((4 + r * 5) / sp).toFixed(1)}s;animation-timing-function:linear;${d(i * 0.37)}"></i>`)}`,
  })),
  bg('liquid-ether', 'Liquid Ether', 'basic', 'Ethereal smoke in pastel.', 'A soft pastel field drifting under heavy blur.', 'Dreams, beauty, spa, wellness.', ['#1c1033', '#7c6bb0', '#e9c8e6', '#2b1a4d'], (c, _p, _ctx, sp) => ({ html: `${field(c, 'rbg-drift', 14 / sp, `filter:blur(${px(40)})`)}${grain(0.15)}` })),
  bg('prism', 'Prism', 'intermediate', 'Refracted light fans out from a point.', 'A pastel conic fan spins slowly behind a white core, softened with blur.', 'Hope, morning, clarity, optics.', ['#0f172a', '#f8fafc', '#7dd3fc', '#c4b5fd'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop rbg-spin" style="left:-50%;top:-50%;width:200%;height:200%;background:conic-gradient(from 0deg,${c[2]}00 0%,${c[2]} 8%,${c[3]} 16%,${c[1]} 24%,${c[2]}00 34%,${c[3]} 50%,${c[2]}00 62%,${c[1]} 78%,${c[2]}00 100%);filter:blur(${px(30)});opacity:.75;animation-duration:${(40 / sp).toFixed(0)}s"></div><div class="bgx" style="background:radial-gradient(circle at 50% 50%,${c[1]} 0%,transparent 22%)"></div>`,
  })),
  bg('dark-veil', 'Dark Veil', 'basic', 'Heavy curtain folds part in the dark.', 'Vertical fold bands (repeating gradient) drift slowly under a deep vignette.', 'Drama, reveals, luxury, theatre.', ['#050505', '#1c1917', '#44403c', '#000000'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="background:repeating-linear-gradient(90deg,${c[0]} 0,${c[2]} 6%,${c[1]} 9%,${c[0]} 14%);background-size:60% 100%;animation-name:rbg-flowx;animation-duration:${(30 / sp).toFixed(0)}s;animation-timing-function:linear;opacity:.9"></div>${vig()}${grain(0.25)}`,
  })),
  bg('light-pillar', 'Light Pillar', 'basic', 'Vertical god-ray columns.', 'Five soft vertical gradient columns pulse in turn over a dark blue field.', 'Sacred, memorial, epic, awards.', ['#060913', '#1e3a8a', '#bfdbfe', '#060913'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}${[0, 1, 2, 3, 4].map((i) => `<div class="loop rbg-pulse" style="position:absolute;left:${12 + i * 19}%;top:-10%;width:${px(90 + i * 20)};height:120%;background:linear-gradient(180deg,transparent,${c[2]}66 40%,${c[2]}aa 55%,transparent);filter:blur(${px(18)});animation-duration:${((4 + i) / sp).toFixed(1)}s;${d(i * 0.8)}"></div>`).join('')}${vig()}`,
  })),
  bg('silk', 'Silk', 'basic', 'Silk fabric folds catching light.', 'A dark field with diagonal soft highlight bands drifting and skewing like cloth.', 'Luxury, beauty, fashion, calm.', ['#100607', '#5d1416', '#e9879e', '#1c0000'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 18 / sp)}<div class="bgx loop" style="background:repeating-linear-gradient(115deg,transparent 0,${c[2]}22 10%,transparent 20%,${c[2]}11 28%,transparent 40%);background-size:180% 180%;animation-name:rbg-drift;animation-duration:${(16 / sp).toFixed(0)}s;animation-timing-function:ease-in-out;animation-direction:alternate;transform:skewX(-8deg) scale(1.2)"></div>`,
  })),
  bg('floating-lines', 'Floating Lines', 'basic', 'Thin lines drift across the frame.', 'Twenty seeded horizontal hairlines slide left and right at different speeds.', 'Minimal tech, presentations, quiet beds.', ['#0a0a0a', '#262626', '#a3a3a3', '#0a0a0a'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}${particles(20, hash(ctx.text + 'lines'), (i, _x, y, r) => `<i class="loop rbg-sway" style="position:absolute;left:${(r * 40 - 10).toFixed(0)}%;top:${y.toFixed(1)}%;width:${(30 + r * 50).toFixed(0)}%;height:1px;background:linear-gradient(90deg,transparent,${c[2]},transparent);opacity:${(0.25 + r * 0.6).toFixed(2)};animation-duration:${((6 + r * 8) / sp).toFixed(1)}s;animation-direction:${i % 2 ? 'alternate-reverse' : 'alternate'};${d(i * 0.3)}"></i>`)}`,
  })),
  bg('side-rays', 'Side Rays', 'basic', 'Light rays sweep in from the side.', 'A conic ray fan anchored at the left edge rocks slowly, masked to fade toward the right.', 'Reveals, dawn, hope, interviews.', ['#0f0a0a', '#3b0a0a', '#f5d0c5', '#0f0a0a'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="left:-60%;top:-60%;width:200%;height:220%;background:repeating-conic-gradient(from 70deg at 30% 50%,${c[2]}00 0deg,${c[2]}44 4deg,${c[2]}00 9deg);mask-image:linear-gradient(90deg,#000 20%,transparent 80%);-webkit-mask-image:linear-gradient(90deg,#000 20%,transparent 80%);transform-origin:30% 50%;animation-name:rbg-rock;animation-duration:${(12 / sp).toFixed(0)}s;animation-timing-function:ease-in-out;filter:blur(${px(6)})"></div>${vig()}`,
    css: '@keyframes rbg-rock{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}',
  })),
  bg('light-rays', 'Light Rays', 'basic', 'Rays pour down from above.', 'A repeating conic ray fan anchored at the top centre rocks gently and fades toward the bottom.', 'Hope, faith, dawn, premium intros.', ['#08080c', '#1f1f2b', '#f8fafc', '#08080c'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="left:-50%;top:-120%;width:200%;height:260%;background:repeating-conic-gradient(from 160deg at 50% 50%,${c[2]}00 0deg,${c[2]}33 3deg,${c[2]}00 8deg);mask-image:linear-gradient(180deg,#000 45%,transparent 85%);-webkit-mask-image:linear-gradient(180deg,#000 45%,transparent 85%);transform-origin:50% 50%;animation-name:rbg-rock;animation-duration:${(14 / sp).toFixed(0)}s;animation-timing-function:ease-in-out;filter:blur(${px(5)})"></div>${vig()}`,
    css: '@keyframes rbg-rock{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}',
  })),
  bg('pixel-blast', 'Pixel Blast', 'intermediate', 'Pixels burst outward from the centre.', 'Sixty seeded squares fly out from the centre in staggered loops and fade.', 'Retro gaming, energy, drops.', ['#0b1026', '#1e293b', '#f472b6', '#38bdf8'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}<div style="position:absolute;left:50%;top:50%">${particles(60, hash(ctx.text + 'blast'), (i, _x, _y, r, rand) => { const ang = rand() * Math.PI * 2; const dist = 500 + r * 700; return `<i class="loop" style="position:absolute;width:${px(10 + r * 18)};height:${px(10 + r * 18)};background:${c[2 + (i % 2)]};--ox:${px(Math.cos(ang) * dist)};--oy:${px(Math.sin(ang) * dist)};animation-name:rbg-burst;animation-duration:${((1.5 + r) / sp).toFixed(2)}s;animation-timing-function:ease-out;${d(rand() * 2)}"></i>`; })}</div>`,
  })),
  bg('color-bends', 'Color Bends', 'basic', 'Bent bands of colour flow diagonally.', 'Wide rotated gradient bands drift and blur into bends of colour.', 'Fashion, culture, festivals.', ['#1a0533', '#7c3aed', '#ec4899', '#f59e0b'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="left:-40%;top:-40%;width:180%;height:180%;background:repeating-linear-gradient(35deg,${c[1]} 0,${c[2]} 12%,${c[3]} 24%,${c[1]} 36%);background-size:160% 160%;filter:blur(${px(28)});animation-name:rbg-drift;animation-duration:${(14 / sp).toFixed(0)}s;animation-timing-function:ease-in-out;animation-direction:alternate;transform:rotate(-8deg)"></div>${grain(0.15)}`,
  })),
  bg('evil-eye', 'Evil Eye', 'intermediate', 'A giant eye with rings that blinks.', 'Concentric ellipses, a radial iris and a pupil that pulses, with an occasional blink on a loop.', 'Mystery, thriller, surveillance.', ['#050208', '#1e0a2e', '#8b5cf6', '#f5f3ff'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="animation-name:rbg-blink;animation-duration:${(7 / sp).toFixed(1)}s;animation-timing-function:ease-in-out;transform-origin:50% 50%"><div style="position:absolute;left:50%;top:50%;width:${px(1100)};height:${px(520)};margin:${px(-260)} 0 0 ${px(-550)};border-radius:50%;background:radial-gradient(circle at 50% 50%,#000 0 ${px(90)},${c[2]} ${px(92)} ${px(150)},${c[1]} ${px(152)} ${px(210)},${c[3]}22 ${px(212)},transparent ${px(260)});box-shadow:0 0 ${px(120)} ${c[2]}66"></div>${[1, 2, 3].map((i) => `<div class="loop rbg-pulse" style="position:absolute;left:50%;top:50%;width:${px(1200 + i * 260)};height:${px(600 + i * 130)};margin:${px(-300 - i * 65)} 0 0 ${px(-600 - i * 130)};border-radius:50%;border:1px solid ${c[2]}66;animation-duration:${((4 + i) / sp).toFixed(1)}s;${d(i * 0.5)}"></div>`).join('')}</div>${vig()}`,
  })),
  bg('line-waves', 'Line Waves', 'basic', 'Sine waves ripple across the frame.', 'Six stacked SVG sine paths translate at different speeds and phases.', 'Audio, calm tech, podcasts.', ['#0b0f19', '#1e293b', '#60a5fa', '#0b0f19'], (c, _p, _ctx, sp) => {
    const wave = (amp: number, y: number) => { let dd = `M-100,${y}`; for (let x = 0; x <= 2100; x += 60) dd += ` ${x === 0 ? 'C' : ''}${x + 20},${y - amp} ${x + 40},${y + amp} ${x + 60},${y}`; return dd; };
    return { html: `${solid(c)}${svg([0, 1, 2, 3, 4, 5].map((i) => `<path class="loop rbg-sway" d="${wave(40 + i * 14, 300 + i * 100)}" style="opacity:${(0.9 - i * 0.12).toFixed(2)};animation-duration:${((4 + i) / sp).toFixed(1)}s;${d(i * 0.5)}"/>`).join(''), { style: `fill:none;stroke:${c[2]};stroke-width:2.5` })}` };
  }),
  bg('radar', 'Radar', 'intermediate', 'A radar sweep with blips.', 'Rings and a rotating conic sweep in a circle, with seeded blips popping as the sweep passes.', 'Security, tracking, tech, search.', ['#020a06', '#052e16', '#22c55e', '#020a06'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}<div style="position:absolute;left:50%;top:50%;width:${px(900)};height:${px(900)};margin:${px(-450)};border-radius:50%;overflow:hidden;background:repeating-radial-gradient(circle,${c[2]}44 0,${c[2]}44 1px,transparent 2px,transparent ${px(112)});box-shadow:inset 0 0 0 2px ${c[2]}66"><div class="bgx loop rbg-spin" style="inset:0;background:conic-gradient(from 0deg,${c[2]}aa 0deg,${c[2]}22 40deg,transparent 60deg);animation-duration:${(4 / sp).toFixed(1)}s"></div>${particles(8, hash(ctx.text + 'radar'), (i, x, y) => `<i class="loop dotp" style="left:${x.toFixed(0)}%;top:${y.toFixed(0)}%;width:${px(14)};height:${px(14)};background:${c[2]};box-shadow:0 0 ${px(14)} ${c[2]};animation-name:rbg-twinkle;animation-duration:${(4 / sp).toFixed(1)}s;animation-timing-function:steps(1,end);${d(i * 0.5)}"></i>`)}</div>${vig()}`,
  })),
  bg('soft-aurora', 'Soft Aurora', 'basic', 'A gentle aurora in pastel light.', 'A softly blurred field drifting very slowly in pale greens and lilacs.', 'Sleep, wellness, ambient, lullabies.', ['#0b1026', '#1b3a6b', '#5eead4', '#c4b5fd'], (c, _p, _ctx, sp) => ({ html: `${field(c, 'rbg-drift', 24 / sp, `filter:blur(${px(60)})`)}${grain(0.12)}` })),
  bg('aurora', 'Aurora', 'basic', 'Polar ribbons drift over a dark sky.', 'A drifting colour field plus two skewed, blurred ribbon bands sliding across it.', 'Night vlogs, music beds, intros.', ['#0b1026', '#1b3a6b', '#0e7c7b', '#141b34'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 16 / sp)}${[0, 1].map((i) => `<div class="loop rbg-sway" style="position:absolute;left:-20%;top:${18 + i * 22}%;width:140%;height:${px(180)};background:linear-gradient(90deg,transparent,${c[2]}88,${c[1]}aa,${c[2]}88,transparent);filter:blur(${px(30)});transform:skewY(-8deg) rotate(${i * 3}deg);animation-duration:${((10 + i * 4) / sp).toFixed(1)}s;${d(i * 2)}"></div>`).join('')}${grain(0.2)}`,
  })),
  bg('plasma', 'Plasma', 'basic', 'Charged blobs fold into each other.', 'A saturated four-colour field drifting under a contrast boost.', 'Gaming, EDM, high-energy loops.', ['#12041f', '#4c1d95', '#db2777', '#0ea5e9'], (c, _p, _ctx, sp) => ({ html: `${field(c, 'rbg-shimmer', 10 / sp, 'filter:contrast(1.25) saturate(1.2)')}` })),
  bg('plasma-wave', 'Plasma Wave', 'intermediate', 'Plasma with ripples rolling through it.', 'The plasma field plus a repeating radial ripple overlay flowing outward.', 'Sci-fi, energy, synth.', ['#12041f', '#7c3aed', '#db2777', '#0ea5e9'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-shimmer', 10 / sp, 'filter:contrast(1.2)')}<div class="bgx loop" style="background:repeating-radial-gradient(circle at 50% 60%,transparent 0,transparent 6%,${c[3]}33 7%,transparent 8%);animation-name:rbg-rush;animation-duration:${(6 / sp).toFixed(1)}s;animation-timing-function:linear;mix-blend-mode:screen"></div>`,
  })),
  bg('particles', 'Particles', 'basic', 'Dust motes drift up through light.', 'Sixty seeded soft dots rise slowly at different speeds over a dark field.', 'Weddings, memorials, gentle beds.', ['#0a0a12', '#23233a', '#e2e8f0', '#101018'], (c, _p, ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 20 / sp)}${particles(60, hash(ctx.text + 'particles'), (i, x, y, r) => `<i class="loop dotp" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${px(3 + r * 7)};height:${px(3 + r * 7)};background:${c[2]};opacity:${(0.25 + r * 0.6).toFixed(2)};box-shadow:0 0 ${px(10)} ${c[2]};animation-name:rbg-rise;animation-duration:${((12 + r * 14) / sp).toFixed(1)}s;animation-timing-function:linear;${d(i * 0.2)}"></i>`)}`,
  })),
  bg('gradient-blinds', 'Gradient Blinds', 'basic', 'Soft venetian bands of colour.', 'Repeating vertical gradient bands slide slowly across the frame.', 'Corporate, tech explainers, presentations.', ['#0f172a', '#1e3a8a', '#0ea5e9', '#0f172a'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="background:repeating-linear-gradient(90deg,${c[1]} 0,${c[2]} 4%,${c[0]} 8%,${c[0]} 10%);background-size:50% 100%;animation-name:rbg-flowx;animation-duration:${(20 / sp).toFixed(0)}s;animation-timing-function:linear;opacity:.9"></div>${vig()}`,
  })),
  bg('grainient', 'Grainient', 'basic', 'A grainy gradient wash.', 'A drifting two-tone field under heavy film grain.', 'Editorial, indie, lo-fi.', ['#1c1917', '#7c2d12', '#fbbf24', '#0c0a09'], (c, _p, _ctx, sp, k) => ({ html: `${field(c, 'rbg-drift', 16 / sp)}${grain(0.55 * k)}` })),
  bg('grid-scan', 'Grid Scan', 'basic', 'A grid lights up under a scanning band.', 'A grid; a bright band scans down and the cells it passes glow.', 'Tech, dashboards, cyber.', ['#020617', '#0f172a', '#22d3ee', '#020617'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx gridl" style="--gc:${c[2]}2a;--gs:${px(60)}"></div><div class="bgx loop rbg-scan" style="height:22%;background:linear-gradient(180deg,transparent,${c[2]}22 50%,${c[2]}99 100%);mix-blend-mode:screen;animation-duration:${(3.6 / sp).toFixed(1)}s"></div>`,
  })),
  bg('beams', 'Beams', 'basic', 'Light shafts sweep a dark stage.', 'Four blurred conic light shafts rotate slowly from the top of the frame.', 'Concerts, speeches, reveals.', ['#050505', '#1f2937', '#f59e0b', '#111827'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}${[0, 1, 2, 3].map((i) => `<div class="loop" style="position:absolute;left:${15 + i * 23}%;top:-10%;width:0;height:0;animation-name:rbg-rock;animation-duration:${((8 + i * 2) / sp).toFixed(1)}s;animation-timing-function:ease-in-out;${d(i * 0.9)}"><div style="position:absolute;left:${px(-90)};top:0;width:${px(180)};height:${px(1400)};background:linear-gradient(180deg,${c[2]}aa,${c[2]}22 60%,transparent);clip-path:polygon(45% 0,55% 0,100% 100%,0 100%);filter:blur(${px(10)})"></div></div>`).join('')}${vig()}`,
    css: '@keyframes rbg-rock{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(14deg)}}',
  })),
  bg('pixel-snow', 'Pixel Snow', 'basic', 'Chunky 8-bit snowfall.', 'Seeded square pixels fall at different speeds with stepped motion.', 'Retro gaming, winter edits.', ['#0b1026', '#1e293b', '#e2e8f0', '#94a3b8'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}${particles(70, hash(ctx.text + 'snow'), (i, x, y, r) => `<i class="loop" style="position:absolute;left:${x.toFixed(1)}%;top:${(y - 100).toFixed(1)}%;width:${px(8 + r * 12)};height:${px(8 + r * 12)};background:${c[2 + (i % 2)]};animation-name:rbg-fall;animation-duration:${((6 + r * 8) / sp).toFixed(1)}s;animation-timing-function:steps(24,end);${d(i * 0.15)}"></i>`)}`,
  })),
  bg('lightning', 'Lightning', 'advanced', 'Electric arcs crack through cloud.', 'A storm field; seeded SVG bolts flash with stepped timing at different moments while the whole frame flashes with them.', 'Drama, sport, drops, weather.', ['#020617', '#1e1b4b', '#7c3aed', '#38bdf8'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'bolt'));
    const bolts = Array.from({ length: 4 }, (_, i) => { let x = 300 + rand() * 1300; let y = -20; let dd = `M${x.toFixed(0)},${y}`; while (y < 900) { x += (rand() - 0.5) * 220; y += 80 + rand() * 120; dd += ` L${x.toFixed(0)},${y.toFixed(0)}`; } return `<path class="loop" d="${dd}" style="animation-name:rbg-flash;animation-duration:${((3 + i * 1.3) / sp).toFixed(1)}s;animation-timing-function:steps(1,end);${d(i * 0.8)}"/>`; }).join('');
    return { html: `${field(c, 'rbg-drift', 14 / sp)}${svg(bolts, { style: `fill:none;stroke:${c[3]};stroke-width:4;stroke-linejoin:round;filter:drop-shadow(0 0 14px ${c[3]})` })}<div class="bgx loop" style="background:${c[3]};mix-blend-mode:screen;animation-name:rbg-flash;animation-duration:${(3 / sp).toFixed(1)}s;animation-timing-function:steps(1,end);opacity:0"></div>${vig()}` };
  }),
  bg('prismatic-burst', 'Prismatic Burst', 'intermediate', 'A burst of prismatic light from the centre.', 'A multicolour conic burst spins behind a bright core, softened.', 'Celebrations, launches, awards.', ['#0a0612', '#f472b6', '#facc15', '#38bdf8'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop rbg-spin" style="left:-50%;top:-50%;width:200%;height:200%;background:repeating-conic-gradient(from 0deg,${c[1]} 0deg,${c[2]} 20deg,${c[3]} 40deg,${c[1]} 60deg);filter:blur(${px(24)}) saturate(1.2);opacity:.6;animation-duration:${(30 / sp).toFixed(0)}s"></div><div class="bgx" style="background:radial-gradient(circle at 50% 50%,#fff 0%,#ffffffaa 6%,transparent 30%)"></div>${vig()}`,
  })),
  bg('galaxy', 'Galaxy', 'intermediate', 'A starfield with nebula wash.', 'A nebula field drifts while 120 seeded stars twinkle and the whole sky rotates imperceptibly.', 'Space, dreams, night skies.', ['#030014', '#1a1040', '#5b21b6', '#0ea5e9'], (c, _p, ctx, sp) => ({
    html: `${field(c, 'rbg-drift', 24 / sp)}<div class="bgx loop rbg-spin" style="left:-30%;top:-30%;width:160%;height:160%;animation-duration:${(240 / sp).toFixed(0)}s">${particles(120, hash(ctx.text + 'stars'), (i, x, y, r) => `<i class="loop dotp" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${px(1.5 + r * 3)};height:${px(1.5 + r * 3)};background:#fff;animation-name:rbg-twinkle;animation-duration:${((1.5 + r * 3) / sp).toFixed(1)}s;animation-timing-function:ease-in-out;${d(i * 0.07)}"></i>`)}</div>`,
  })),
  bg('dither', 'Dither', 'basic', 'An ordered-dither retro gradient.', 'A pixelated dot grid over a shimmering two-tone gradient.', 'Vintage computing, lo-fi, zines.', ['#101010', '#3f3f46', '#e4e4e7', '#71717a'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-shimmer', 12 / sp)}<div class="bgx" style="background-image:radial-gradient(${c[0]} 45%,transparent 50%);background-size:${px(9)} ${px(9)};image-rendering:pixelated;opacity:.85"></div>`,
  })),
  bg('faulty-terminal', 'Faulty Terminal', 'intermediate', 'Glitching phosphor terminal text.', 'Rows of seeded glyphs in a green mono face flicker under scanlines with a stepped horizontal jitter.', 'Hacker, ARG, horror, retro tech.', ['#001103', '#003b1f', '#00ff66', '#001103'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'term'));
    const glyphs = '01<>/\\[]{}#$%&*+=-_:;.';
    const rows = Array.from({ length: 22 }, () => `<div class="loop rbg-flicker" style="white-space:nowrap;animation-duration:${((0.3 + rand() * 0.6) / sp).toFixed(2)}s;${d(rand())};opacity:${(0.25 + rand() * 0.5).toFixed(2)}">${esc(Array.from({ length: 90 }, () => glyphs[Math.floor(rand() * glyphs.length)]).join(''))}</div>`).join('');
    return { html: `${solid(c)}<div class="bgx mono" style="padding:2%;font-size:${px(26)};line-height:1.7;color:${c[2]};letter-spacing:.12em">${rows}</div><div class="bgx scanl"></div>${vig()}` };
  }),
  bg('ripple-grid', 'Ripple Grid', 'basic', 'Pond ripples cross a dot grid.', 'A dot grid with expanding rings radiating from the centre on staggered loops.', 'Calm tech, wellness, audio.', ['#0c1a2b', '#155e75', '#22d3ee', '#0c1a2b'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx" style="background-image:radial-gradient(${c[2]}66 1.5px,transparent 2px);background-size:${px(44)} ${px(44)}"></div>${[0, 1, 2].map((i) => `<div class="loop" style="position:absolute;left:50%;top:50%;width:${px(300)};height:${px(300)};margin:${px(-150)};border-radius:50%;border:${px(2)} solid ${c[2]};animation-name:rbx-ring;animation-duration:${(4 / sp).toFixed(1)}s;animation-timing-function:ease-out;${d(i * 1.3)}"></div>`).join('')}${vig()}`,
  })),
  bg('dot-field', 'Dot Field', 'basic', 'A breathing field of dots.', 'A dot pattern whose spacing pulses gently, lit by a drifting spotlight.', 'Minimal tech beds, presentations.', ['#0a0a0a', '#262626', '#a3a3a3', '#0a0a0a'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop" style="background-image:radial-gradient(${c[2]} 1.5px,transparent 2.5px);background-size:${px(36)} ${px(36)};animation-name:rbg-breathe;animation-duration:${(5 / sp).toFixed(1)}s;animation-timing-function:ease-in-out;opacity:.7"></div>${field(['transparent', c[1], c[1], 'transparent'] as Pal, 'rbg-drift', 18 / sp, 'mix-blend-mode:screen;opacity:.6')}`,
    css: `@keyframes rbg-breathe{0%,100%{background-size:${px(36)} ${px(36)}}50%{background-size:${px(44)} ${px(44)}}}`,
  })),
  bg('dot-grid', 'Dot Grid', 'basic', 'A quiet dot grid with a moving highlight.', 'A static dot grid; a soft spotlight drifts across it.', 'Minimal, documentation, product.', ['#0a0a0f', '#1f1f2e', '#8b8bb0', '#0a0a0f'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx" style="background-image:radial-gradient(${c[2]}77 1.5px,transparent 2px);background-size:${px(40)} ${px(40)}"></div><div class="bgx loop rbg-sway" style="left:10%;top:10%;width:60%;height:80%;background:radial-gradient(circle,${c[2]}33,transparent 60%);animation-duration:${(12 / sp).toFixed(0)}s;filter:blur(${px(20)})"></div>`,
  })),
  bg('threads', 'Threads', 'basic', 'Woven fibre lines flow.', 'Twelve SVG wavy lines with flowing dashes and a gentle sway.', 'Fabric, craft, fashion, music.', ['#171310', '#4a2c1a', '#c2703d', '#1c1410'], (c, _p, _ctx, sp) => {
    const wave = (y: number, amp: number) => { let dd = `M-100,${y}`; for (let x = 0; x <= 2100; x += 120) dd += ` Q${x + 30},${y - amp} ${x + 60},${y} T${x + 120},${y}`; return dd; };
    return { html: `${solid(c)}${svg(Array.from({ length: 12 }, (_, i) => `<path class="loop rbg-sway" d="${wave(140 + i * 75, 30 + (i % 3) * 20)}" style="stroke-dasharray:180 40;animation-duration:${((5 + i * 0.7) / sp).toFixed(1)}s;${d(i * 0.3)};opacity:${(0.4 + (i % 4) * 0.15).toFixed(2)}"/>`).join(''), { style: `fill:none;stroke:${c[2]};stroke-width:2;stroke-linecap:round` })}${vig()}` };
  }),
  bg('hyperspeed', 'Hyperspeed', 'intermediate', 'Warp streaks rush past the camera.', 'Radial SVG streaks from the centre with flowing dashes over a rushing ring pattern and a bright core.', 'Travel, transitions, energy, intros.', ['#000000', '#1e1b4b', '#ffffff', '#312e81'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'warp'));
    const streaks = Array.from({ length: 70 }, () => { const ang = rand() * Math.PI * 2; const r0 = 80 + rand() * 200; const r1 = 1400; return `<line class="loop" x1="${(960 + Math.cos(ang) * r0).toFixed(0)}" y1="${(540 + Math.sin(ang) * r0).toFixed(0)}" x2="${(960 + Math.cos(ang) * r1).toFixed(0)}" y2="${(540 + Math.sin(ang) * r1).toFixed(0)}" style="stroke-dasharray:${(60 + rand() * 200).toFixed(0)} 500;animation-name:rbg-dash;animation-duration:${((0.6 + rand() * 0.8) / sp).toFixed(2)}s;animation-timing-function:linear;${d(rand())};opacity:${(0.3 + rand() * 0.6).toFixed(2)}"/>`; }).join('');
    return { html: `${solid(c)}${svg(streaks, { style: `stroke:${c[2]};stroke-width:2` })}<div class="bgx" style="background:radial-gradient(circle at 50% 50%,${c[2]} 0%,${c[3]}aa 8%,transparent 30%)"></div>${vig()}` };
  }),
  bg('iridescence', 'Iridescence', 'basic', 'An oil-slick colour shift.', 'A four-colour field shimmering with saturation drift and a screen-blended highlight sweep.', 'Beauty, luxury, idents, cosmetics.', ['#1a0533', '#7c3aed', '#ec4899', '#22d3ee'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-shimmer', 9 / sp)}<div class="bgx loop" style="background:linear-gradient(110deg,transparent 30%,#ffffff33 50%,transparent 70%);background-size:250% 100%;animation-name:rbx-shimmer;animation-duration:${(6 / sp).toFixed(1)}s;animation-timing-function:linear;mix-blend-mode:screen"></div>`,
  })),
  bg('waves', 'Waves', 'basic', 'Layered sine dunes roll.', 'Four stacked layers of huge soft ellipses slide sideways at different speeds like dunes.', 'Calm beds, podcasts, meditation.', ['#082f49', '#0369a1', '#38bdf8', '#082f49'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}${[0, 1, 2, 3].map((i) => `<div class="loop rbg-sway" style="position:absolute;left:-40%;top:${45 + i * 14}%;width:180%;height:70%;border-radius:50% 50% 0 0/100% 100% 0 0;background:${i % 2 ? c[1] : c[2]};opacity:${(0.35 + i * 0.15).toFixed(2)};animation-duration:${((9 + i * 3) / sp).toFixed(1)}s;animation-direction:${i % 2 ? 'alternate-reverse' : 'alternate'};${d(i * 0.8)}"></div>`).join('')}`,
  })),
  bg('grid-distortion', 'Grid Distortion', 'intermediate', 'A perspective grid breathes toward the horizon.', 'A synthwave floor: a perspective grid whose lines flow toward the camera, under a glowing horizon.', 'Synthwave, retro drives, gaming.', ['#0d0221', '#3b0764', '#ff2fb3', '#0d0221'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx" style="background:linear-gradient(180deg,${c[0]} 0%,${c[1]} 48%,${c[2]}66 50%,${c[0]} 52%)"></div><div style="position:absolute;left:-50%;top:50%;width:200%;height:60%;perspective:${px(600)}"><div class="bgx gridl loop" style="inset:0;--gc:${c[2]}aa;--gs:${px(120)};transform:rotateX(62deg);transform-origin:50% 0;animation-name:rbg-flow;animation-duration:${(2.4 / sp).toFixed(1)}s;animation-timing-function:linear"></div></div>${vig()}`,
  })),
  bg('ballpit', 'Ballpit', 'intermediate', 'Soft bouncing orbs.', 'Fourteen seeded glossy balls bounce at different heights and speeds.', 'Kids, playful branding, fun.', ['#1e1b4b', '#7c3aed', '#f472b6', '#38bdf8'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}${particles(14, hash(ctx.text + 'balls'), (i, x, _y, r) => `<i class="loop dotp" style="left:${x.toFixed(1)}%;bottom:-5%;width:${px(90 + r * 160)};height:${px(90 + r * 160)};background:radial-gradient(circle at 35% 30%,#ffffffcc,${c[1 + (i % 3)]} 40%,${c[0]} 100%);--bh:${(-30 - r * 50).toFixed(0)}vh;animation-name:rbg-bounce;animation-duration:${((2.4 + r * 2) / sp).toFixed(2)}s;animation-timing-function:cubic-bezier(.45,0,.55,1);${d(i * 0.3)}"></i>`)}`,
  })),
  bg('orb', 'Orb', 'basic', 'A single glowing sphere.', 'A glossy sphere with a pulsing halo on a dark field.', 'Meditation, focus, premium, AI.', ['#020617', '#0f172a', '#38bdf8', '#020617'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="loop rbg-pulse" style="position:absolute;left:50%;top:50%;width:${px(700)};height:${px(700)};margin:${px(-350)};border-radius:50%;background:radial-gradient(circle,${c[2]}55 0%,transparent 60%);filter:blur(${px(30)});animation-duration:${(4 / sp).toFixed(1)}s"></div><div style="position:absolute;left:50%;top:50%;width:${px(420)};height:${px(420)};margin:${px(-210)};border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffffcc 0%,${c[2]} 22%,${c[1]} 60%,${c[0]} 100%);box-shadow:0 0 ${px(80)} ${c[2]}88"></div>`,
  })),
  bg('letter-glitch', 'Letter Glitch', 'intermediate', 'A wall of glyphs flickers.', 'A dense grid of seeded characters in mono green with each cell flickering on its own stepped loop.', 'Cyber, gaming intros, hacking.', ['#000000', '#052e16', '#22c55e', '#000000'], (c, _p, ctx, sp) => {
    const rand = rng(hash(ctx.text + 'glitchwall'));
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&';
    const cells = Array.from({ length: 30 * 14 }, () => `<i class="loop" style="animation-name:rbg-twinkle;animation-duration:${((0.6 + rand() * 2) / sp).toFixed(2)}s;animation-timing-function:steps(2,end);${d(rand() * 2)};color:${rand() > 0.85 ? '#fff' : c[2]}">${glyphs[Math.floor(rand() * glyphs.length)]}</i>`).join('');
    return { html: `${solid(c)}<div class="bgx mono" style="display:grid;grid-template-columns:repeat(30,1fr);grid-template-rows:repeat(14,1fr);font-size:${px(34)};font-weight:700;text-align:center;align-items:center">${cells}</div>${vig()}`, css: '.rbx .bgx.mono>i{font-style:normal;display:block}' };
  }),
  bg('grid-motion', 'Grid Motion', 'basic', 'Rows of tiles slide in alternate directions.', 'Four rows of small labelled tiles marquee left/right at different speeds.', 'Portfolio walls, showreels, recaps.', ['#0a0a0a', '#1f2937', '#d34b55', '#111827'], (c, _p, ctx, sp) => ({
    html: `${solid(c)}<div class="bgx col" style="justify-content:center;gap:${px(18)};opacity:.75">${[0, 1, 2, 3].map((r) => `<div style="white-space:nowrap;overflow:hidden"><div class="loop" style="display:inline-flex;gap:${px(18)};animation-name:${r % 2 ? 'rbg-marqr' : 'rbg-marq'};animation-duration:${((22 + r * 6) / sp).toFixed(0)}s;animation-timing-function:linear">${Array.from({ length: 16 }, (_, i) => `<div style="width:${px(260)};height:${px(170)};flex:none;border-radius:${px(16)};background:linear-gradient(160deg,${c[1 + ((i + r) % 3)]},${c[0]});display:flex;align-items:flex-end;padding:${px(14)};font-size:${px(22)};font-weight:700;color:#fff8">${esc(textOf({}, ctx, 'Bhippi'))} ${String(i + 1).padStart(2, '0')}</div>`).join('')}</div></div>`).join('')}</div>${vig()}`,
  })),
  bg('shape-grid', 'Shape Grid', 'basic', 'Geometric tiles phase in and out.', 'A grid of rounded squares whose opacity and rotation loop with a diagonal stagger.', 'Corporate motion beds, tech explainers.', ['#111827', '#1f2937', '#6b7280', '#030712'], (c, _p, _ctx, sp) => {
    const tiles: string[] = [];
    for (let r = 0; r < 8; r++) for (let col = 0; col < 14; col++) tiles.push(`<i class="loop shapet" style="animation-duration:${(4 / sp).toFixed(1)}s;${d((r + col) * 0.18)}"></i>`);
    return { html: `${solid(c)}<div class="bgx" style="display:grid;grid-template-columns:repeat(14,1fr);grid-template-rows:repeat(8,1fr);gap:${px(14)};padding:${px(14)}">${tiles.join('')}</div>${vig()}`, css: `.rbx .shapet{border-radius:${px(12)};background:${c[2]};animation-name:rbg-phase;animation-timing-function:ease-in-out}@keyframes rbg-phase{0%,100%{opacity:.12;transform:scale(.7) rotate(0)}50%{opacity:.5;transform:scale(1) rotate(45deg)}}` };
  }),
  bg('liquid-chrome', 'Liquid Chrome', 'intermediate', 'Molten metal flows.', 'A grey field shimmering under high contrast with a moving specular highlight.', 'Luxury, automotive, awards, tech.', ['#09090b', '#3f3f46', '#d4d4d8', '#18181b'], (c, _p, _ctx, sp) => ({
    html: `${field(c, 'rbg-shimmer', 8 / sp, 'filter:contrast(1.6) brightness(.9)')}<div class="bgx loop" style="background:linear-gradient(115deg,transparent 35%,#ffffff55 50%,transparent 65%);background-size:250% 100%;animation-name:rbx-shimmer;animation-duration:${(5 / sp).toFixed(1)}s;animation-timing-function:ease-in-out;mix-blend-mode:screen"></div>`,
  })),
  bg('balatro', 'Balatro', 'intermediate', 'A warped card-table plasma swirl.', 'A spinning, blurred conic swirl in green and gold with a saturation boost.', 'Gaming, streams, card games.', ['#052e2b', '#0d5c46', '#e2b93d', '#04211e'], (c, _p, _ctx, sp) => ({
    html: `${solid(c)}<div class="bgx loop rbg-spin" style="left:-60%;top:-60%;width:220%;height:220%;background:conic-gradient(from 0deg,${c[1]},${c[2]},${c[3]},${c[1]},${c[2]},${c[3]},${c[1]});filter:blur(${px(40)}) saturate(1.3);animation-duration:${(24 / sp).toFixed(0)}s"></div><div class="bgx" style="background:repeating-radial-gradient(circle at 50% 50%,transparent 0,transparent ${px(60)},#0000001a ${px(62)},transparent ${px(66)})"></div>${vig()}`,
  })),
];
