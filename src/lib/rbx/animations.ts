// React Bits — Animations (38), rebuilt for video.
//
// On the web these react to the pointer, the scroll or a hover. In a video nobody hovers, so every
// pointer-driven piece becomes a scripted moment: a cursor travels a fixed path, the surface
// responds, and the content settles — in causal order, once. Decorative pieces (borders, sheens,
// grain, rings) become paused loops around a glass card that carries the copy.

import {
  CARD_PROPS, N, P_ACCENT, P_INTENSITY, P_ROWS, P_SPEED, P_SUBTITLE, P_TEXT, S,
  accentStyle, bit, card, cursorSvg, d, esc, hash, intensityOf, pointerMoment, px, rng, rowsOf, scene, speedOf, svg, textOf, tile,
  type Bit,
} from './core';

export const ANIMATION_BITS: Bit[] = [
  bit({
    id: 'glow-cursor', name: 'Glow Cursor', category: 'animation', level: 'intermediate',
    about: 'A soft glow follows the cursor across a surface.',
    video: 'A scripted cursor crosses the card while a radial glow trails it; the glow settles under the heading.',
    use: 'Night footage, gaming, music, product cards with a light touch.',
    props: CARD_PROPS, example: { text: 'Glow follows the hand', subtitle: 'A light that pays attention' }, seconds: 5, tags: ['cursor', 'glow'],
    build: (p, ctx) => {
      const ptr = pointerMoment('glow', [{ x: 80, y: 520 }, { x: 420, y: 300 }, { x: 760, y: 340 }], 0.3, 1.6, false);
      return {
        html: scene(`<div class="fill center a rise" style="${d(0.05)}">${card(p, ctx)}</div><div class="glowblob a" style="${d(0.3)};animation-name:rbx-ptr-glow;animation-duration:1.6s"></div>${ptr.html}`),
        css: `${ptr.css}.rbx .glowblob{position:absolute;left:${px(-160)};top:${px(-160)};width:${px(340)};height:${px(340)};border-radius:50%;background:radial-gradient(circle,var(--accent) 0%,transparent 60%);opacity:.7;filter:blur(${px(20)});animation-timing-function:var(--ei);mix-blend-mode:screen}`,
      };
    },
  }),
  bit({
    id: 'scroll-expand', name: 'Scroll Expand', category: 'animation', level: 'advanced',
    about: 'A media frame expands from a thumbnail to full-bleed as you scroll, title parting around it.',
    video: 'A gradient placeholder frame blooms from 35% to the full frame over the clip while the title splits to the edges. Pair with set_keyframes on real footage for the same move on media.',
    use: 'Hook endings, reveals, chapter openers.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, { name: 'label', type: 'string', about: 'Caption inside the frame.' }], example: { text: 'Scroll to expand', label: 'FOOTAGE' }, seconds: 5, layout: 'fullscreen', tags: ['reveal', 'media'],
    build: (p, ctx) => {
      const words = textOf(p, ctx).split(/\s+/);
      const left = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      const right = words.slice(Math.ceil(words.length / 2)).join(' ');
      return {
        html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill center"><div class="expandframe a" style="${d(0.1)}">${tile(S(p, 'label', 'FOOTAGE'), 0, 'position:absolute;inset:0;border-radius:inherit')}</div></div><div class="fill row" style="justify-content:space-between;padding:0 ${px(80)}"><div class="hero a expandL" style="${d(0.1)}">${esc(left)}</div><div class="hero a expandR" style="${d(0.1)}">${esc(right)}</div></div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="small a fade" style="position:absolute;left:0;right:0;bottom:${px(70)};text-align:center;${d(2.2)}">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div>`,
        css: '.rbx .expandframe{position:relative;width:100%;height:100%;border-radius:calc(28px * var(--u));overflow:hidden;animation-name:rbx-expand;animation-duration:2.4s;animation-timing-function:var(--eo)}.rbx .expandL,.rbx .expandR{animation-duration:2.4s;animation-timing-function:var(--eo);white-space:nowrap}.rbx .expandL{animation-name:rbx-expandL}.rbx .expandR{animation-name:rbx-expandR}@keyframes rbx-expand{from{transform:scale(.35);border-radius:calc(28px * var(--u))}to{transform:scale(1);border-radius:0}}@keyframes rbx-expandL{from{transform:translateX(calc(300px * var(--u)));opacity:1}to{transform:translateX(0);opacity:.9}}@keyframes rbx-expandR{from{transform:translateX(calc(-300px * var(--u)));opacity:1}to{transform:translateX(0);opacity:.9}}',
      };
    },
  }),
  bit({
    id: 'ripple-distortion', name: 'Ripple Distortion', category: 'animation', level: 'intermediate',
    about: 'Water ripples distort the surface under the pointer.',
    video: 'Concentric rings radiate from the landing point on a loop while the card eases in behind them.',
    use: 'Calm reveals, nature, wellness, water brands.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Ripple Distortion', subtitle: 'Touch the surface' }, seconds: 5, tags: ['water', 'loop'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center a rise" style="${d(0.1)}">${card(p, ctx)}</div>${[0, 1, 2, 3].map((i) => `<i class="ring loop ripple" style="left:50%;top:50%;${d(i * 0.55)};animation-duration:${(2.2 / speedOf(p)).toFixed(2)}s"></i>`).join('')}`),
      css: `.rbx .ripple{position:absolute;width:${px(220)};height:${px(220)};margin:${px(-110)} 0 0 ${px(-110)};border-radius:50%;border:${px(2)} solid var(--accent);opacity:0;animation-name:rbx-ripple;animation-timing-function:ease-out}@keyframes rbx-ripple{from{transform:scale(.3);opacity:.8}to{transform:scale(3.4);opacity:0}}`,
    }),
  }),
  bit({
    id: 'elastic-mesh', name: 'Elastic Mesh', category: 'animation', level: 'advanced',
    about: 'A mesh surface wobbles like jelly when disturbed.',
    video: 'An SVG dot grid ripples with staggered scale wobbles from the centre, then relaxes as the card lands.',
    use: 'Comedy, bouncy branding, tech idents.',
    props: [...CARD_PROPS, P_INTENSITY], example: { text: 'Elastic Mesh' }, seconds: 5, tags: ['mesh', 'bounce'],
    build: (p, ctx) => {
      const dots: string[] = [];
      for (let r = 0; r < 9; r++) for (let c = 0; c < 15; c++) {
        const dist = Math.hypot(c - 7, r - 4);
        dots.push(`<circle class="a meshdot" cx="${100 + c * 122}" cy="${90 + r * 110}" r="6" style="transform-origin:${100 + c * 122}px ${90 + r * 110}px;${d(0.1 + dist * 0.07)}"/>`);
      }
      return {
        html: scene(`${svg(dots.join(''), { vb: '0 0 1920 1000', style: 'fill:var(--accent);opacity:.7' })}<div class="fill center a pop" style="${d(0.7)}">${card(p, ctx)}</div>`, 1400, 720, `--k:${intensityOf(p)}`),
        css: '.rbx .meshdot{animation-name:rbx-meshdot;animation-duration:1.2s;animation-timing-function:var(--spring)}@keyframes rbx-meshdot{0%{transform:scale(1)}30%{transform:scale(calc(1 + 2.4 * var(--k,1)))}60%{transform:scale(.6)}100%{transform:scale(1)}}',
      };
    },
  }),
  bit({
    id: 'swarm-cursor', name: 'Swarm Cursor', category: 'animation', level: 'advanced',
    about: 'A swarm of particles chases the cursor.',
    video: 'Sixty seeded motes converge on the cursor\'s landing point, then the card forms where they gathered.',
    use: 'Tech intros, futuristic titles, AI product moments.',
    props: CARD_PROPS, example: { text: 'Swarm Cursor', kicker: 'PARTICLES' }, seconds: 5, tags: ['particles', 'cursor'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const ptr = pointerMoment('swarm', [{ x: 60, y: 560 }, { x: 550, y: 310 }], 0.2, 1.2, false);
      const motes = Array.from({ length: 60 }, () => `<i class="mote a" style="--ox:${px((rand() - 0.5) * 1300)};--oy:${px((rand() - 0.5) * 800)};${d(0.4 + rand() * 0.9)};animation-duration:${(0.8 + rand() * 0.6).toFixed(2)}s;width:${px(4 + rand() * 6)};height:${px(4 + rand() * 6)}"></i>`).join('');
      return {
        html: scene(`<div class="fill" style="left:50%;top:50%">${motes}</div>${ptr.html}<div class="fill center a pop" style="${d(1.9)}">${card(p, ctx)}</div>`),
        css: `${ptr.css}.rbx .mote{position:absolute;left:0;top:0;border-radius:50%;background:var(--accent2);box-shadow:0 0 ${px(8)} var(--accent);animation-name:rbx-mote;animation-timing-function:var(--eo)}@keyframes rbx-mote{0%{opacity:0;transform:translate(var(--ox),var(--oy))}20%{opacity:1}100%{opacity:0;transform:translate(0,0) scale(.4)}}`,
      };
    },
  }),
  bit({
    id: 'halftone-reveal', name: 'Halftone Reveal', category: 'animation', level: 'intermediate',
    about: 'Print halftone dots grow to reveal the image.',
    video: 'A dot-pattern overlay shrinks its dots until the card beneath is fully visible.',
    use: 'Retro, comic, pop-art edits, magazine looks.',
    props: CARD_PROPS, example: { text: 'Halftone Reveal', kicker: 'PRINT' }, seconds: 4, tags: ['retro', 'print'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center">${card(p, ctx)}</div><div class="fill halftone a" style="${d(0.1)}"></div>`),
      css: '.rbx .halftone{background-image:radial-gradient(circle,var(--bg) 62%,transparent 66%);background-position:center;animation-name:rbx-halftone;animation-duration:1.6s;animation-timing-function:var(--ei)}@keyframes rbx-halftone{0%{background-size:calc(6px * var(--u)) calc(6px * var(--u));opacity:1}60%{background-size:calc(46px * var(--u)) calc(46px * var(--u));opacity:1}100%{background-size:calc(80px * var(--u)) calc(80px * var(--u));opacity:0}}',
    }),
  }),
  bit({
    id: 'pixel-swap', name: 'Pixel Swap', category: 'animation', level: 'intermediate',
    about: 'Pixel tiles flip to swap one image for another.',
    video: 'A tile grid over the "before" state fades away in seeded order, revealing the "after" state beneath.',
    use: 'Before/after, comparisons, upgrades.',
    props: [P_ACCENT, { name: 'before', type: 'string', about: 'The first state\'s label.' }, { name: 'after', type: 'string', about: 'The second state\'s label. Defaults to the title.' }],
    example: { before: 'Before', after: 'After' }, seconds: 5, tags: ['before-after', 'pixels'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const tiles: string[] = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 14; c++) tiles.push(`<i class="a pxtile" style="${d(1.2 + rand() * 1.1)}"></i>`);
      return {
        html: scene(`<div class="fill center glass"><div class="hero a fade" style="${d(1.6)}">${esc(S(p, 'after') || textOf(p, ctx))}</div></div><div class="fill pxgrid">${tiles.join('')}</div><div class="fill center"><div class="hero a pxbefore" style="${d(1.2)}">${esc(S(p, 'before', 'Before'))}</div></div>`, 1100, 620, accentStyle(p)),
        css: '.rbx .pxgrid{display:grid;grid-template-columns:repeat(14,1fr);grid-template-rows:repeat(8,1fr);border-radius:calc(24px * var(--u));overflow:hidden}.rbx .pxtile{background:var(--accent);animation-name:rbx-pxtile;animation-duration:.35s;animation-timing-function:var(--ei)}.rbx .pxbefore{animation-name:rbx-fadeout;animation-duration:.4s}@keyframes rbx-pxtile{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.2)}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}',
      };
    },
  }),
  bit({
    id: 'cursor-grid', name: 'Cursor Grid', category: 'animation', level: 'intermediate',
    about: 'A grid of cells lights up around the cursor.',
    video: 'A faint grid; a lens of light follows the scripted cursor and brightens the cells it passes, then the card lands.',
    use: 'Tech, data, cyber edits, dashboards.',
    props: CARD_PROPS, example: { text: 'Cursor Grid' }, seconds: 5, tags: ['grid', 'cursor'],
    build: (p, ctx) => {
      const ptr = pointerMoment('cgrid', [{ x: 60, y: 540 }, { x: 400, y: 200 }, { x: 760, y: 420 }], 0.3, 1.6, false);
      return {
        html: scene(`<div class="fill cgrid"></div><div class="lens a" style="${d(0.3)};animation-name:rbx-ptr-cgrid;animation-duration:1.6s"></div>${ptr.html}<div class="fill center a rise" style="${d(1.7)}">${card(p, ctx)}</div>`),
        css: `${ptr.css}.rbx .cgrid{background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:${px(60)} ${px(60)};opacity:.5}.rbx .lens{position:absolute;left:${px(-150)};top:${px(-150)};width:${px(340)};height:${px(340)};border-radius:50%;background:radial-gradient(circle,var(--accent) 0%,transparent 65%);opacity:.55;animation-timing-function:var(--ei);mix-blend-mode:screen}`,
      };
    },
  }),
  bit({
    id: 'animated-content', name: 'Animated Content', category: 'animation', level: 'basic',
    about: 'Content animates into view with a direction, distance and easing.',
    video: 'Kicker, heading, subtitle and rows rise in with a stagger; direction and distance are props.',
    use: 'Section reveals, feature lists, any block that must simply arrive well.',
    props: [...CARD_PROPS, P_ROWS, { name: 'direction', type: 'enum', values: ['up', 'down', 'left', 'right'], default: 'up', about: 'Where the content comes from.' }, { name: 'distance', type: 'number', default: 60, about: 'Design pixels travelled.' }],
    example: { text: 'Animated Content', subtitle: 'Direction, distance, easing', rows: ['Ease-out arrivals', 'One idea per frame'] }, seconds: 5, tags: ['reveal', 'list'],
    build: (p, ctx) => {
      const dir = S(p, 'direction', 'up');
      const dist = N(p, 'distance', 60);
      const vec = dir === 'down' ? `0,${px(-dist)}` : dir === 'left' ? `${px(dist)},0` : dir === 'right' ? `${px(-dist)},0` : `0,${px(dist)}`;
      const rows = rowsOf(p, ctx, []).map((r, i) => `<div class="body a acontent" style="margin-top:${px(14)};${d(0.5 + i * 0.14)}">• ${esc(r)}</div>`).join('');
      const k = S(p, 'kicker');
      const s = S(p, 'subtitle') || ctx.subtitle;
      return {
        html: scene(`<div class="fill center"><div class="glass" style="padding:${px(48)} ${px(60)};min-width:${px(600)};--vec:${vec}">${k ? `<div class="kicker a acontent" style="${d(0.05)}">${esc(k)}</div>` : ''}<div class="heading a acontent" style="${d(0.18)}">${esc(textOf(p, ctx))}</div>${s ? `<div class="small a acontent" style="margin-top:${px(10)};${d(0.32)}">${esc(s)}</div>` : ''}${rows}</div></div>`),
        css: '.rbx .acontent{animation-name:rbx-acontent;animation-duration:.7s;animation-timing-function:var(--eo)}@keyframes rbx-acontent{from{opacity:0;transform:translate(var(--vec,0,0))}to{opacity:1;transform:translate(0,0)}}',
      };
    },
  }),
  bit({
    id: 'fade-content', name: 'Fade Content', category: 'animation', level: 'basic',
    about: 'Content fades in, optionally from a blur.',
    video: 'A slow crossfade with a slight lift and blur-to-sharp on the card.',
    use: 'Quiet transitions, testimonials, reflective lines.',
    props: [...CARD_PROPS, { name: 'blur', type: 'boolean', default: true, about: 'Start blurred.' }, { name: 'seconds', type: 'number', default: 1.2, about: 'Fade length.' }],
    example: { text: 'Fade Content', subtitle: 'Nothing cuts on' }, seconds: 5, tags: ['soft'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="a ${p.blur === false ? 'fade' : 'blur-in'}" style="${d(0.05)};animation-duration:${Math.max(0.2, N(p, 'seconds', 1.2)).toFixed(2)}s">${card(p, ctx)}</div></div>`) }),
  }),
  bit({
    id: 'electric-border', name: 'Electric Border', category: 'animation', level: 'intermediate',
    about: 'A jittering electric current runs around the card edge.',
    video: 'Two SVG rectangles around the card: a blurred glow and a crisp dashed stroke whose dash offset flows on a loop with a stepped jitter.',
    use: 'Live badges, "new" tags, CTAs, gaming cards.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Electric Border', kicker: 'LIVE' }, seconds: 5, tags: ['border', 'loop'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="a pop ebwrap" style="${d(0.05)}">${svg('<rect class="ebglow loop" x="4" y="4" width="992" height="392" rx="26"/><rect class="ebline loop" x="4" y="4" width="992" height="392" rx="26" style="animation-duration:' + (1.6 / speedOf(p)).toFixed(2) + 's"/>', { vb: '0 0 1000 400', style: 'inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px)' })}${card(p, ctx, '', 'min-width:0;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center')}</div></div>`, 1100, 620, accentStyle(p)),
      css: '.rbx .ebwrap{position:relative;width:calc(1000px * var(--u));height:calc(400px * var(--u))}.rbx .ebglow{fill:none;stroke:var(--accent);stroke-width:10;filter:blur(8px);opacity:.6;animation-name:rbx-ebjit;animation-duration:.4s;animation-timing-function:steps(3,end)}.rbx .ebline{fill:none;stroke:var(--accent2);stroke-width:3;stroke-dasharray:60 26 8 26;animation-name:rbx-ebflow;animation-timing-function:linear}@keyframes rbx-ebflow{from{stroke-dashoffset:0}to{stroke-dashoffset:-240}}@keyframes rbx-ebjit{0%{transform:translate(0,0)}33%{transform:translate(1.5px,-1px)}66%{transform:translate(-1px,1.5px)}100%{transform:translate(0,0)}}',
    }),
  }),
  bit({
    id: 'orbit-images', name: 'Orbit Images', category: 'animation', level: 'intermediate',
    about: 'Images orbit a centre point in 3D.',
    video: 'Labelled tiles ride a slowly spinning ring around the centre word; each tile counter-rotates so it stays upright.',
    use: 'Team, cast, product line-ups, "everything in one place" moments.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { ...P_ROWS, about: 'Tile labels (3–8).' }, { name: 'radius', type: 'number', default: 320, about: 'Orbit radius in design px.' }],
    example: { text: 'Orbit', rows: ['Design', 'Motion', 'Sound', 'Edit', 'Ship'] }, seconds: 6, tags: ['gallery', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five']);
      const r = N(p, 'radius', 320);
      const dur = (20 / speedOf(p)).toFixed(1);
      const tiles = rows.map((label, i) => `<div class="a pop orbititem" style="transform:rotate(${((i * 360) / rows.length).toFixed(1)}deg) translateX(${px(r)});${d(0.3 + i * 0.1)}"><div class="loop orbitcounter" style="animation-duration:${dur}s">${tile(label, i, `width:${px(200)};height:${px(140)}`)}</div></div>`).join('');
      return {
        html: scene(`<div class="fill center"><div class="loop spin" style="position:relative;width:0;height:0;animation-duration:${dur}s">${tiles}</div></div><div class="fill center hero a rise" style="${d(0.1)}">${esc(textOf(p, ctx))}</div>`, 1400, 900, accentStyle(p)),
        css: '.rbx .orbititem{position:absolute;left:0;top:0;width:0;height:0}.rbx .orbititem>div{position:absolute;left:0;top:0;transform:translate(-50%,-50%)}.rbx .orbitcounter{animation-name:rbx-spin;animation-direction:reverse}',
      };
    },
  }),
  bit({
    id: 'pixel-transition', name: 'Pixel Transition', category: 'animation', level: 'intermediate',
    about: 'Content resolves through chunky pixels.',
    video: 'A grid of accent tiles covers the card and falls away in a seeded order over 1.2 s.',
    use: 'Retro cuts, gaming edits, 8-bit brands.',
    props: [...CARD_PROPS, { name: 'grid', type: 'number', default: 12, about: 'Columns of pixels (6–24).' }], example: { text: 'Pixel Transition' }, seconds: 4, tags: ['retro', 'pixels'],
    build: (p, ctx) => {
      const cols = Math.round(Math.min(24, Math.max(6, N(p, 'grid', 12))));
      const rows = Math.round(cols * 0.56);
      const rand = rng(hash(textOf(p, ctx)));
      const tiles = Array.from({ length: cols * rows }, () => `<i class="a pxout" style="${d(0.2 + rand() * 1.0)}"></i>`).join('');
      return {
        html: scene(`<div class="fill center">${card(p, ctx)}</div><div class="fill" style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);border-radius:${px(24)};overflow:hidden">${tiles}</div>`),
        css: '.rbx .pxout{background:var(--accent);animation-name:rbx-pxout;animation-duration:.2s;animation-timing-function:steps(1,end)}@keyframes rbx-pxout{from{opacity:1}to{opacity:0}}',
      };
    },
  }),
  bit({
    id: 'glare-hover', name: 'Glare Hover', category: 'animation', level: 'basic',
    about: 'A diagonal glare sweeps across the card on hover.',
    video: 'The card rises in, then a diagonal highlight sweeps across it once.',
    use: 'Product cards, thumbnails, premium tiles.',
    props: CARD_PROPS, example: { text: 'Glare Hover', subtitle: 'One sweep, then still' }, seconds: 4, tags: ['sheen'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="a rise glarewrap" style="${d(0.05)}">${card(p, ctx)}<div class="glare a" style="${d(0.8)}"></div></div></div>`),
      css: '.rbx .glarewrap{position:relative;overflow:hidden;border-radius:calc(24px * var(--u))}.rbx .glare{position:absolute;top:-20%;bottom:-20%;left:-40%;width:40%;background:linear-gradient(105deg,transparent 0%,#ffffff33 45%,#ffffff88 50%,#ffffff33 55%,transparent 100%);transform:skewX(-20deg);animation-name:rbx-glare;animation-duration:1.1s;animation-timing-function:var(--ei)}@keyframes rbx-glare{from{left:-40%}to{left:140%}}',
    }),
  }),
  bit({
    id: 'antigravity', name: 'Antigravity', category: 'animation', level: 'intermediate',
    about: 'Elements drift upward as if gravity were reversed.',
    video: 'Words or tiles float upward at seeded speeds with slow spin, then the heading holds in the middle.',
    use: 'Dreamy intros, space, "let go" moments.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { ...P_ROWS, about: 'Floating labels (default: the words of the copy).' }], example: { text: 'Let everything float', rows: ['ideas', 'noise', 'doubt', 'deadlines'] }, seconds: 6, layout: 'fullscreen', tags: ['float', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, textOf(p, ctx).split(/\s+/));
      const rand = rng(hash(textOf(p, ctx)));
      const items = rows.concat(rows).map((r, i) => `<span class="pill loop antig" style="left:${(4 + rand() * 88).toFixed(1)}%;${d(rand() * 4)};animation-duration:${(7 + rand() * 6) / speedOf(p)}s;opacity:${(0.4 + rand() * 0.5).toFixed(2)};filter:hue-rotate(${i * 17}deg)">${esc(r)}</span>`).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}">${items}<div class="fill center hero a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div></div>`, css: '.rbx .antig{position:absolute;top:100%;animation-name:rbx-antig;animation-timing-function:linear}@keyframes rbx-antig{from{transform:translateY(0) rotate(-6deg)}to{transform:translateY(calc(-120vh - 100%)) rotate(6deg)}}' };
    },
  }),
  bit({
    id: 'logo-loop', name: 'Logo Loop', category: 'animation', level: 'basic',
    about: 'An infinite marquee of logos.',
    video: 'A paused marquee of labelled chips (the rows) with fade masks at both ends.',
    use: 'Sponsors, "as seen on", tool stacks, partner walls.',
    props: [P_ACCENT, P_SPEED, { ...P_ROWS, about: 'Logo names.' }, { name: 'direction', type: 'enum', values: ['left', 'right'], default: 'left', about: 'Travel direction.' }],
    example: { rows: ['React', 'Vite', 'GSAP', 'Tauri', 'Rust', 'FFmpeg'] }, seconds: 6, layout: 'lower-third', tags: ['marquee', 'logos'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['React', 'Vite', 'GSAP', 'Tauri']);
      const chips = rows.map((r) => `<span class="logochip">${esc(r)}</span>`).join('');
      return {
        html: `<div class="x logoloop" style="${accentStyle(p)}"><div class="loop ${S(p, 'direction', 'left') === 'right' ? 'marquee-r' : 'marquee'}" style="display:inline-flex;animation-duration:${(14 / speedOf(p)).toFixed(1)}s">${chips.repeat(4)}</div></div>`,
        css: `.rbx .logoloop{width:100%;overflow:hidden;white-space:nowrap;mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}.rbx .logochip{display:inline-block;margin-right:${px(28)};padding:${px(14)} ${px(30)};border-radius:${px(14)};border:1px solid var(--line);background:var(--card);font-size:${px(30)};font-weight:700;letter-spacing:.02em}`,
      };
    },
  }),
  bit({
    id: 'target-cursor', name: 'Target Cursor', category: 'animation', level: 'intermediate',
    about: 'The cursor becomes corner brackets that snap to the hovered element.',
    video: 'Four corner brackets fly in from the frame edges and lock onto the card, rotating slightly as they settle.',
    use: 'Gaming, targeting gags, "we found it" reveals.',
    props: CARD_PROPS, example: { text: 'Target acquired', kicker: 'LOCK' }, seconds: 4, tags: ['cursor', 'brackets'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="tgtwrap a fade" style="${d(0.05)}">${card(p, ctx)}${['tl', 'tr', 'bl', 'br'].map((c, i) => `<i class="tgt ${c} a" style="${d(0.3 + i * 0.05)}"></i>`).join('')}</div></div>`),
      css: `.rbx .tgtwrap{position:relative}.rbx .tgt{position:absolute;width:${px(46)};height:${px(46)};border:${px(4)} solid var(--accent);animation-name:rbx-tgt;animation-duration:.7s;animation-timing-function:var(--spring)}.rbx .tgt.tl{left:${px(-18)};top:${px(-18)};border-right:0;border-bottom:0;--sx:-1;--sy:-1}.rbx .tgt.tr{right:${px(-18)};top:${px(-18)};border-left:0;border-bottom:0;--sx:1;--sy:-1}.rbx .tgt.bl{left:${px(-18)};bottom:${px(-18)};border-right:0;border-top:0;--sx:-1;--sy:1}.rbx .tgt.br{right:${px(-18)};bottom:${px(-18)};border-left:0;border-top:0;--sx:1;--sy:1}@keyframes rbx-tgt{from{opacity:0;transform:translate(calc(var(--sx) * 260px * var(--u)),calc(var(--sy) * 180px * var(--u))) rotate(35deg)}to{opacity:1;transform:translate(0,0) rotate(0)}}`,
    }),
  }),
  bit({
    id: 'magic-rings', name: 'Magic Rings', category: 'animation', level: 'intermediate',
    about: 'Concentric rings rotate and breathe behind content.',
    video: 'Dashed SVG rings spin at different speeds and directions behind the heading.',
    use: 'Idents, awards, mystical or sci-fi brands.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_SPEED], example: { text: 'Magic Rings' }, seconds: 5, tags: ['rings', 'loop'],
    build: (p, ctx) => {
      const rings = [180, 260, 340, 420].map((r, i) => `<circle class="loop mring" cx="500" cy="500" r="${r}" style="transform-origin:500px 500px;animation-duration:${((12 + i * 5) / speedOf(p)).toFixed(1)}s;animation-direction:${i % 2 ? 'reverse' : 'normal'};stroke-dasharray:${20 + i * 14} ${10 + i * 6};opacity:${(0.85 - i * 0.18).toFixed(2)}"/>`).join('');
      return {
        html: scene(`<div class="fill center"><div class="a pop" style="width:${px(900)};height:${px(900)};position:relative;${d(0.05)}">${svg(rings, { vb: '0 0 1000 1000', aspect: 'meet', style: 'fill:none;stroke:var(--accent);stroke-width:3' })}</div></div><div class="fill center col"><div class="hero a rise" style="${d(0.3)}">${esc(textOf(p, ctx))}</div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="small a rise" style="margin-top:${px(16)};${d(0.5)}">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div>`, 1000, 900, accentStyle(p)),
        css: '.rbx .mring{animation-name:rbx-spin;animation-timing-function:linear}',
      };
    },
  }),
  bit({
    id: 'laser-flow', name: 'Laser Flow', category: 'animation', level: 'advanced',
    about: 'A laser beam pours from above and lights the surface it hits.',
    video: 'A vertical beam of flowing gradient light lands on the card, which brightens; the flow is a paused background-position loop.',
    use: 'Premium reveals, hardware, launches.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Laser Flow', kicker: 'LAUNCH' }, seconds: 5, layout: 'fullscreen', tags: ['light', 'loop'],
    build: (p, ctx) => ({
      html: `<div class="x fill" style="${accentStyle(p)}"><div class="beam a" style="${d(0.05)}"><div class="fill loop beamflow" style="animation-duration:${(1.4 / speedOf(p)).toFixed(2)}s"></div></div><div class="fill center" style="padding-top:20%"><div class="a rise laserlit" style="${d(0.7)}">${card(p, ctx)}</div></div></div>`,
      css: `.rbx .beam{position:absolute;left:50%;top:-5%;width:${px(160)};height:75%;transform:translateX(-50%);transform-origin:50% 0;overflow:hidden;filter:blur(${px(2)});animation-name:rbx-beam;animation-duration:.9s;animation-timing-function:var(--eo);mask-image:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent)}.rbx .beamflow{background:repeating-linear-gradient(180deg,var(--accent) 0,var(--accent2) 12%,transparent 30%,var(--accent) 45%);background-size:100% 400%;opacity:.85;animation-name:rbx-beamflow;animation-timing-function:linear}.rbx .laserlit{box-shadow:0 0 ${px(80)} var(--accent)}@keyframes rbx-beam{from{transform:translateX(-50%) scaleY(0)}to{transform:translateX(-50%) scaleY(1)}}@keyframes rbx-beamflow{from{background-position:0 0}to{background-position:0 100%}}`,
    }),
  }),
  bit({
    id: 'magnet-lines', name: 'Magnet Lines', category: 'animation', level: 'intermediate',
    about: 'A field of short lines rotates to point at the cursor.',
    video: 'A 12×7 field of ticks, each turning from a seeded angle to point at the cursor\'s landing spot, where the heading appears.',
    use: 'Tech explainers, magnetic titles, attention metaphors.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Attention' }, seconds: 5, tags: ['field', 'cursor'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const target = { x: 550, y: 310 };
      const ticks: string[] = [];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 12; c++) {
        const x = 60 + c * 90;
        const y = 60 + r * 85;
        const ang = (Math.atan2(target.y - y, target.x - x) * 180) / Math.PI;
        ticks.push(`<i class="mtick a" style="left:${px(x)};top:${px(y)};--a0:${(rand() * 360).toFixed(0)}deg;--a1:${ang.toFixed(1)}deg;${d(0.3 + Math.hypot(c - 6, r - 3) * 0.05)}"></i>`);
      }
      const ptr = pointerMoment('mag', [{ x: 60, y: 560 }, target], 0.2, 1.0, false);
      return {
        html: scene(`${ticks.join('')}${ptr.html}<div class="fill center heading a pop" style="${d(1.3)}"><span class="pill" style="font-size:${px(40)}">${esc(textOf(p, ctx))}</span></div>`),
        css: `${ptr.css}.rbx .mtick{position:absolute;width:${px(40)};height:${px(4)};margin:${px(-2)} 0 0 ${px(-20)};background:var(--accent);border-radius:2px;opacity:.75;animation-name:rbx-mtick;animation-duration:.9s;animation-timing-function:var(--eo)}@keyframes rbx-mtick{from{transform:rotate(var(--a0))}to{transform:rotate(var(--a1))}}`,
      };
    },
  }),
  bit({
    id: 'ghost-cursor', name: 'Ghost Cursor', category: 'animation', level: 'intermediate',
    about: 'A trailing ghost follows the cursor and fades.',
    video: 'The cursor travels a curve; three translucent copies follow with growing delay, then a click lands the card.',
    use: 'Software demos, onboarding, "watch this" moments.',
    props: CARD_PROPS, example: { text: 'Ghost Cursor' }, seconds: 5, tags: ['cursor', 'trail'],
    build: (p, ctx) => {
      const path = [{ x: 80, y: 520 }, { x: 380, y: 160 }, { x: 700, y: 420 }, { x: 560, y: 300 }];
      const ptr = pointerMoment('ghost', path, 0.3, 1.8, true);
      const ghosts = [1, 2, 3].map((i) => `<div class="ptr a ghostptr" style="${d(0.3 + i * 0.09)};animation-name:rbx-ptr-ghost;animation-duration:1.8s;opacity:${(0.45 / i).toFixed(2)}">${cursorSvg()}</div>`).join('');
      return { html: scene(`${ghosts}${ptr.html}<div class="fill center a pop" style="${d(2.2)}">${card(p, ctx)}</div>`), css: `${ptr.css}.rbx .ghostptr{filter:blur(1px) drop-shadow(0 0 ${px(8)} var(--accent))}` };
    },
  }),
  bit({
    id: 'gradual-blur', name: 'Gradual Blur', category: 'animation', level: 'basic',
    about: 'A progressive blur gradient at the edge of a scroll area.',
    video: 'Rows of copy scroll upward behind a bottom-edge blur mask; the top stays sharp.',
    use: 'Credits, long lists, cinematic depth at the frame edge.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { ...P_ROWS, about: 'Lines that scroll through.' }], example: { text: 'Gradual Blur', rows: ['Written by', 'Edited by', 'Sound by', 'Colour by', 'Music by'] }, seconds: 6, tags: ['blur', 'scroll'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
      const list = rows.concat(rows).map((r) => `<div class="heading" style="padding:${px(10)} 0">${esc(r)}</div>`).join('');
      return {
        html: scene(`<div class="heading a rise" style="position:absolute;left:0;right:0;top:0;text-align:center;${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="gblur-win"><div class="loop gscroll" style="animation-duration:${(9 / speedOf(p)).toFixed(1)}s;text-align:center">${list}</div><div class="fill gblur-edge"></div></div>`, 1000, 620),
        css: `.rbx .gblur-win{position:absolute;left:0;right:0;top:${px(120)};bottom:0;overflow:hidden}.rbx .gscroll{animation-name:rbx-gscroll;animation-timing-function:linear}.rbx .gblur-edge{background:linear-gradient(180deg,transparent 40%,var(--bg) 100%)}@keyframes rbx-gscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}`,
      };
    },
  }),
  bit({
    id: 'click-spark', name: 'Click Spark', category: 'animation', level: 'basic',
    about: 'Sparks burst from the click point.',
    video: 'The cursor arrives on a button, presses it, and eight spark lines burst outward and fade.',
    use: 'Button presses, subscribe pops, "tap here" gags.',
    props: [P_TEXT, P_ACCENT, { name: 'button', type: 'string', default: 'Subscribe', about: 'Button label.' }], example: { text: 'Click Spark', button: 'Subscribe' }, seconds: 4, tags: ['button', 'spark'],
    build: (p, ctx) => {
      const ptr = pointerMoment('spark', [{ x: 120, y: 540 }, { x: 560, y: 336 }], 0.3, 1.1, false);
      const sparks = Array.from({ length: 8 }, (_, i) => `<i class="spark a" style="--ang:${i * 45}deg;${d(1.4)}"></i>`).join('');
      return {
        html: scene(`<div class="fill center col" style="gap:${px(30)}"><div class="heading a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="a press sparkbtn" style="${d(1.4)}">${esc(S(p, 'button', 'Subscribe'))}</div></div><div class="sparks" style="left:${px(550)};top:${px(336)}">${sparks}</div>${ptr.html}`),
        css: `${ptr.css}.rbx .sparkbtn{padding:${px(20)} ${px(48)};border-radius:999px;background:var(--accent);color:#fff;font-size:${px(34)};font-weight:700}.rbx .sparks{position:absolute;width:0;height:0}.rbx .spark{position:absolute;left:0;top:0;width:${px(4)};height:${px(26)};margin-left:${px(-2)};border-radius:2px;background:var(--accent2);transform-origin:50% 0;animation-name:rbx-spark;animation-duration:.5s;animation-timing-function:ease-out}@keyframes rbx-spark{from{opacity:1;transform:rotate(var(--ang)) translateY(${px(30)}) scaleY(1)}to{opacity:0;transform:rotate(var(--ang)) translateY(${px(110)}) scaleY(.2)}}`,
      };
    },
  }),
  bit({
    id: 'magnet', name: 'Magnet', category: 'animation', level: 'basic',
    about: 'An element leans toward the cursor and springs back.',
    video: 'The cursor approaches from below-left; the card leans toward it, then springs back to rest when the cursor leaves.',
    use: 'Playful cards, menu items, CTA buttons.',
    props: [...CARD_PROPS, P_INTENSITY], example: { text: 'Magnet', subtitle: 'Leans in, springs back' }, seconds: 4, tags: ['spring'],
    build: (p, ctx) => {
      const ptr = pointerMoment('magnet', [{ x: 60, y: 560 }, { x: 330, y: 440 }, { x: 60, y: 560 }], 0.4, 1.8, false);
      return { html: scene(`<div class="fill center"><div class="a magnetcard" style="${d(0.4)};--k:${intensityOf(p)}">${card(p, ctx)}</div></div>${ptr.html}`), css: `${ptr.css}.rbx .magnetcard{animation-name:rbx-magnet;animation-duration:1.8s;animation-timing-function:var(--spring)}@keyframes rbx-magnet{0%{transform:translate(0,0) rotate(0)}45%{transform:translate(calc(-40px * var(--u) * var(--k,1)),calc(30px * var(--u) * var(--k,1))) rotate(calc(-3deg * var(--k,1)))}100%{transform:translate(0,0) rotate(0)}}` };
    },
  }),
  bit({
    id: 'strands', name: 'Strands', category: 'animation', level: 'advanced',
    about: 'Hair-like strands sway and follow the pointer.',
    video: 'Twenty seeded SVG curves draw in and sway on a loop behind the heading.',
    use: 'Organic, beauty, sound-wave metaphors.',
    props: [P_TEXT, P_ACCENT, P_SPEED], example: { text: 'Strands' }, seconds: 6, layout: 'fullscreen', tags: ['organic', 'loop'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const strands = Array.from({ length: 20 }, (_, i) => {
        const x = 100 + i * 90 + rand() * 40;
        return `<path class="a draw strand" pathLength="1" d="M${x},1120 C${x - 120 + rand() * 240},760 ${x + 160 - rand() * 320},420 ${x + (rand() - 0.5) * 200},-40" style="${d(0.1 + i * 0.06)};opacity:${(0.25 + rand() * 0.5).toFixed(2)}"/>`;
      }).join('');
      return {
        html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill loop strandsway" style="animation-duration:${(6 / speedOf(p)).toFixed(1)}s;transform-origin:50% 100%">${svg(strands, { style: 'fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round' })}</div><div class="fill center hero a rise" style="${d(0.8)}">${esc(textOf(p, ctx))}</div></div>`,
        css: '.rbx .strand{animation-duration:1.6s}.rbx .strandsway{animation-name:rbx-sway;animation-timing-function:ease-in-out}@keyframes rbx-sway{0%,100%{transform:skewX(-3deg)}50%{transform:skewX(3deg)}}',
      };
    },
  }),
  bit({
    id: 'sticker-peel', name: 'Sticker Peel', category: 'animation', level: 'intermediate',
    about: 'A sticker with a corner that peels up on hover.',
    video: 'A rounded sticker drops in and its top-right corner peels back, showing the pale underside, then relaxes.',
    use: 'Unboxings, announcements, "new" labels, merch.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT], example: { text: 'NEW DROP', subtitle: 'Friday 9 am' }, seconds: 4, tags: ['sticker'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="a drop stickwrap" style="${d(0.05)}"><div class="sticker a peel" style="${d(0.9)}"><div class="display" style="font-size:${px(96)}">${esc(textOf(p, ctx))}</div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="body" style="opacity:.85">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div><div class="peelback a peelb" style="${d(0.9)}"></div></div></div>`),
      css: `.rbx .stickwrap{position:relative}.rbx .sticker{padding:${px(48)} ${px(64)};border-radius:${px(36)};background:var(--accent);color:#fff;text-align:center;box-shadow:0 ${px(24)} ${px(60)} #0006;animation-name:rbx-peel;animation-duration:1.6s;animation-timing-function:var(--spring)}.rbx .peelback{position:absolute;right:0;top:0;width:${px(150)};height:${px(150)};background:linear-gradient(225deg,transparent 50%,#f3d9d9 50%,#fff 100%);clip-path:polygon(100% 0,100% 100%,0 0);opacity:0;animation-name:rbx-peelb;animation-duration:1.6s;animation-timing-function:var(--spring);border-radius:0 ${px(36)} 0 0}@keyframes rbx-peel{0%{clip-path:polygon(0 0,100% 0,100% 100%,0 100%)}45%,60%{clip-path:polygon(0 0,72% 0,100% 28%,100% 100%,0 100%)}100%{clip-path:polygon(0 0,100% 0,100% 100%,0 100%)}}@keyframes rbx-peelb{0%{opacity:0;transform:scale(.2)}45%,60%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.2)}}`,
    }),
  }),
  bit({
    id: 'pixel-trail', name: 'Pixel Trail', category: 'animation', level: 'intermediate',
    about: 'Chunky pixels light up along the cursor path and fade.',
    video: 'Squares appear along the scripted path in order and fade a beat later; the heading lands at the end of the path.',
    use: 'Motion titles, sport graphics, retro cursors.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Pixel Trail' }, seconds: 4, tags: ['pixels', 'trail'],
    build: (p, ctx) => {
      const pts = Array.from({ length: 18 }, (_, i) => ({ x: 80 + i * 50, y: 320 + Math.sin(i / 2.6) * 150 }));
      const trail = pts.map((pt, i) => `<i class="pxdot a" style="left:${px(pt.x)};top:${px(pt.y)};${d(0.3 + i * 0.07)}"></i>`).join('');
      const ptr = pointerMoment('pxtrail', pts, 0.3, 1.3, false);
      return { html: scene(`${trail}${ptr.html}<div class="fill center hero a pop" style="${d(1.8)}">${esc(textOf(p, ctx))}</div>`), css: `${ptr.css}.rbx .pxdot{position:absolute;width:${px(34)};height:${px(34)};margin:${px(-17)} 0 0 ${px(-17)};background:var(--accent);animation-name:rbx-pxdot;animation-duration:.8s;animation-timing-function:steps(4,end)}@keyframes rbx-pxdot{0%{opacity:0}10%{opacity:1}100%{opacity:0}}` };
    },
  }),
  bit({
    id: 'cubes', name: 'Cubes', category: 'animation', level: 'advanced',
    about: 'A grid of 3D cubes tilts in a wave as the pointer passes.',
    video: 'A 10×6 tile grid tilts in a diagonal wave on a loop behind the heading; tiles carry faces so the tilt reads as depth.',
    use: 'Logo stings, transitions, tech backdrops.',
    props: [P_TEXT, P_ACCENT, P_SPEED], example: { text: 'Cubes' }, seconds: 6, layout: 'fullscreen', tags: ['3d', 'grid', 'loop'],
    build: (p, ctx) => {
      const tiles: string[] = [];
      for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) tiles.push(`<i class="cube loop" style="${d((r + c) * 0.12)};animation-duration:${(3.2 / speedOf(p)).toFixed(2)}s"></i>`);
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill cubegrid" style="perspective:${px(1400)}">${tiles.join('')}</div><div class="fill center hero a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div></div>`, css: `.rbx .cubegrid{display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(6,1fr);gap:${px(6)};padding:${px(6)}}.rbx .cube{background:linear-gradient(145deg,var(--card),#000);border:1px solid var(--line);animation-name:rbx-cube;animation-timing-function:ease-in-out;transform-style:preserve-3d}@keyframes rbx-cube{0%,100%{transform:rotateX(0) rotateY(0);background-color:var(--card)}50%{transform:rotateX(28deg) rotateY(-18deg);background-color:var(--accent)}}` };
    },
  }),
  bit({
    id: 'metallic-paint', name: 'Metallic Paint', category: 'animation', level: 'intermediate',
    about: 'Liquid-metal shading flows over a shape.',
    video: 'Gradient-clipped display type with a flowing chrome gradient and high contrast, after a pop entrance.',
    use: 'Premium intros, automotive, awards, luxury.',
    props: [P_TEXT, P_SPEED], example: { text: 'CHROME' }, seconds: 5, tags: ['chrome', 'loop'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="a pop" style="${d(0.05)}"><span class="chrome loop shimmer display" style="animation-duration:${(3.6 / speedOf(p)).toFixed(2)}s">${esc(textOf(p, ctx))}</span></div></div>`),
      css: '.rbx .chrome{display:inline-block;background:linear-gradient(100deg,#6b6b70 0%,#f5f5f7 18%,#8f8f96 32%,#ffffff 46%,#5a5a60 58%,#e8e8ec 74%,#7a7a80 88%,#f5f5f7 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:contrast(1.25);letter-spacing:-.02em}',
    }),
  }),
  bit({
    id: 'noise', name: 'Noise', category: 'animation', level: 'basic',
    about: 'Animated film grain over content.',
    video: 'Two layers of fine repeating radial gradients jitter in steps on a loop over the card.',
    use: 'Film looks, grunge, texture on flat colour.',
    props: [...CARD_PROPS, { name: 'amount', type: 'number', default: 0.35, about: '0–1 grain opacity.' }], example: { text: 'Noise', subtitle: 'Film grain, deterministic' }, seconds: 4, tags: ['grain', 'loop'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center a rise" style="${d(0.05)}">${card(p, ctx)}</div><div class="fill grain loop" style="opacity:${Math.min(1, Math.max(0, N(p, 'amount', 0.35)))}"></div>`),
      css: `.rbx .grain{pointer-events:none;background-image:radial-gradient(#ffffff2a 1px,transparent 1.5px),radial-gradient(#0000002a 1px,transparent 1.5px);background-size:${px(7)} ${px(7)},${px(11)} ${px(11)};mix-blend-mode:overlay;animation-name:rbx-grain;animation-duration:.5s;animation-timing-function:steps(5,end)}@keyframes rbx-grain{0%{background-position:0 0,0 0}20%{background-position:${px(3)} ${px(-2)},${px(-4)} ${px(3)}}40%{background-position:${px(-2)} ${px(4)},${px(5)} ${px(-1)}}60%{background-position:${px(4)} ${px(1)},${px(-2)} ${px(-5)}}80%{background-position:${px(-3)} ${px(-3)},${px(2)} ${px(4)}}100%{background-position:0 0,0 0}}`,
    }),
  }),
  bit({
    id: 'shape-blur', name: 'Shape Blur', category: 'animation', level: 'intermediate',
    about: 'A blurred shape follows the cursor over the surface.',
    video: 'A soft rounded blob trails the scripted cursor and settles behind the heading as its backlight.',
    use: 'Speed ramps, whoosh moments, soft spotlights.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Shape Blur' }, seconds: 4, tags: ['blur', 'cursor'],
    build: (p, ctx) => {
      const ptr = pointerMoment('shape', [{ x: 120, y: 500 }, { x: 700, y: 200 }, { x: 550, y: 310 }], 0.3, 1.5, false);
      return { html: scene(`<div class="shapeblob a" style="${d(0.3)};animation-name:rbx-ptr-shape;animation-duration:1.5s"></div>${ptr.html}<div class="fill center hero a rise" style="${d(1.2)}">${esc(textOf(p, ctx))}</div>`), css: `${ptr.css}.rbx .shapeblob{position:absolute;left:${px(-200)};top:${px(-140)};width:${px(400)};height:${px(280)};border-radius:45%;background:var(--accent);filter:blur(${px(40)});opacity:.75;animation-timing-function:var(--ei)}` };
    },
  }),
  bit({
    id: 'crosshair', name: 'Crosshair', category: 'animation', level: 'intermediate',
    about: 'Full-frame crosshair lines follow the cursor.',
    video: 'Horizontal and vertical reticle lines track the scripted cursor to the target, lock, and the label appears at the intersection.',
    use: 'Gaming, targeting gags, "right here" callouts.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Right here' }, seconds: 4, layout: 'fullscreen', tags: ['reticle', 'cursor'],
    build: (p, ctx) => {
      const ptr = pointerMoment('xhair', [{ x: 200, y: 900 }, { x: 1250, y: 380 }, { x: 960, y: 540 }], 0.3, 1.6, true);
      return {
        html: `<div class="x fill" style="${accentStyle(p)}"><div class="xh xh-v a" style="${d(0.3)};animation-name:rbx-xhv;animation-duration:1.6s"></div><div class="xh xh-h a" style="${d(0.3)};animation-name:rbx-xhh;animation-duration:1.6s"></div>${ptr.html}<div class="a pop" style="position:absolute;left:50%;top:50%;transform:translate(${px(40)},${px(-70)});${d(2.0)}"><span class="pill" style="font-size:${px(30)}">${esc(textOf(p, ctx))}</span></div></div>`,
        css: `${ptr.css}.rbx .xh{position:absolute;background:var(--accent);opacity:.8;animation-timing-function:var(--ei)}.rbx .xh-v{top:0;bottom:0;width:${px(2)}}.rbx .xh-h{left:0;right:0;height:${px(2)}}@keyframes rbx-xhv{0%{left:${px(200)}}50%{left:${px(1250)}}100%{left:${px(960)}}}@keyframes rbx-xhh{0%{top:${px(900)}}50%{top:${px(380)}}100%{top:${px(540)}}}`,
      };
    },
  }),
  bit({
    id: 'image-trail', name: 'Image Trail', category: 'animation', level: 'advanced',
    about: 'Images spawn along the cursor path and fade.',
    video: 'Labelled tiles appear along the scripted path with slight rotation and fade in order; the heading holds after.',
    use: 'Dance, sport, fashion, dynamic lower-thirds, portfolio teasers.',
    props: [P_TEXT, P_ACCENT, { ...P_ROWS, about: 'Tile labels (cycled along the trail).' }], example: { text: 'Image Trail', rows: ['01', '02', '03', '04', '05'] }, seconds: 5, tags: ['gallery', 'trail'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06']);
      const rand = rng(hash(textOf(p, ctx)));
      const pts = Array.from({ length: 9 }, (_, i) => ({ x: 120 + i * 105, y: 300 + Math.sin(i / 1.8) * 160 }));
      const trail = pts.map((pt, i) => `<div class="a imgt" style="left:${px(pt.x)};top:${px(pt.y)};--rot:${((rand() - 0.5) * 30).toFixed(1)}deg;${d(0.3 + i * 0.14)}">${tile(rows[i % rows.length], i, `width:${px(180)};height:${px(130)}`)}</div>`).join('');
      const ptr = pointerMoment('imgtrail', pts, 0.3, 1.4, false);
      return { html: scene(`${trail}${ptr.html}<div class="fill center heading a rise" style="${d(2.2)}"><span class="pill" style="font-size:${px(36)}">${esc(textOf(p, ctx))}</span></div>`), css: `${ptr.css}.rbx .imgt{position:absolute;transform:translate(-50%,-50%);animation-name:rbx-imgt;animation-duration:1.4s;animation-timing-function:var(--eo)}@keyframes rbx-imgt{0%{opacity:0;transform:translate(-50%,-50%) scale(.5) rotate(var(--rot))}15%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(var(--rot))}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-60%) scale(.9) rotate(0)}}` };
    },
  }),
  bit({
    id: 'ribbons', name: 'Ribbons', category: 'animation', level: 'intermediate',
    about: 'Silk ribbons flow behind the pointer.',
    video: 'Three thick gradient SVG ribbons draw across the frame and sway on a loop behind the heading.',
    use: 'Beauty, fashion, elegance, award idents.',
    props: [P_TEXT, P_ACCENT, P_SPEED], example: { text: 'Ribbons' }, seconds: 6, layout: 'fullscreen', tags: ['silk', 'loop'],
    build: (p, ctx) => {
      const ribbons = [0, 1, 2].map((i) => `<path class="a draw ribbon" pathLength="1" d="M-100,${400 + i * 140} C400,${200 + i * 160} 900,${800 - i * 120} 1400,${380 + i * 150} S1900,${300 + i * 100} 2100,${520 + i * 80}" style="${d(0.1 + i * 0.25)};stroke-width:${34 - i * 8};opacity:${(0.9 - i * 0.2).toFixed(2)};stroke:url(#rbx-ribgrad${i})"/>`).join('');
      const defs = [0, 1, 2].map((i) => `<linearGradient id="rbx-ribgrad${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--accent)"/><stop offset=".5" stop-color="var(--accent2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient>`).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill loop ribsway" style="animation-duration:${(7 / speedOf(p)).toFixed(1)}s">${svg(`<defs>${defs}</defs>${ribbons}`, { style: 'fill:none;stroke-linecap:round' })}</div><div class="fill center hero a rise" style="${d(1.2)}">${esc(textOf(p, ctx))}</div></div>`, css: '.rbx .ribbon{animation-duration:1.8s}.rbx .ribsway{animation-name:rbx-ribsway;animation-timing-function:ease-in-out}@keyframes rbx-ribsway{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-30px * var(--u)))}}' };
    },
  }),
  bit({
    id: 'splash-cursor', name: 'Splash Cursor', category: 'animation', level: 'intermediate',
    about: 'Fluid ink splashes bloom under the cursor.',
    video: 'Ink blobs bloom and dissolve at three points along the scripted path; the heading lands in the last splash.',
    use: 'Art channels, kids content, paint and craft brands.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Splash!' }, seconds: 4, tags: ['ink', 'cursor'],
    build: (p, ctx) => {
      const pts = [{ x: 200, y: 460 }, { x: 520, y: 220 }, { x: 550, y: 330 }];
      const ptr = pointerMoment('splash', pts, 0.3, 1.4, false);
      const blobs = pts.map((pt, i) => `<i class="splash a" style="left:${px(pt.x)};top:${px(pt.y)};${d(0.5 + i * 0.5)};filter:hue-rotate(${i * 30}deg) blur(${px(3)})"></i>`).join('');
      return { html: scene(`${blobs}${ptr.html}<div class="fill center hero a pop" style="${d(1.9)}">${esc(textOf(p, ctx))}</div>`), css: `${ptr.css}.rbx .splash{position:absolute;width:${px(360)};height:${px(320)};margin:${px(-160)} 0 0 ${px(-180)};border-radius:44% 56% 52% 48%/58% 44% 56% 42%;background:radial-gradient(circle at 40% 40%,var(--accent2),var(--accent) 70%);opacity:0;animation-name:rbx-splash;animation-duration:1.6s;animation-timing-function:var(--eo)}@keyframes rbx-splash{0%{opacity:0;transform:scale(.1) rotate(0)}20%{opacity:.9;transform:scale(1) rotate(12deg)}100%{opacity:0;transform:scale(1.5) rotate(30deg)}}` };
    },
  }),
  bit({
    id: 'meta-balls', name: 'Meta Balls', category: 'animation', level: 'intermediate',
    about: 'Gooey blobs merge and split as they move.',
    video: 'SVG circles under a goo filter (blur + alpha contrast) drift on loops so they fuse and part behind the heading.',
    use: 'Playful branding, idents, liquid metaphors.',
    props: [P_TEXT, P_ACCENT, P_SPEED], example: { text: 'Meta Balls' }, seconds: 6, tags: ['goo', 'loop'],
    build: (p, ctx) => {
      const balls = [[420, 320, 110, 0], [640, 300, 90, 1.2], [520, 420, 70, 2.1], [700, 430, 60, 0.6]].map(([x, y, r, delay], i) => `<circle class="loop mball" cx="${x}" cy="${y}" r="${r}" style="transform-origin:${x}px ${y}px;${d(delay)};animation-duration:${((4 + i) / speedOf(p)).toFixed(1)}s"/>`).join('');
      return { html: scene(`${svg(`<defs><filter id="rbx-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/></filter></defs><g style="filter:url(#rbx-goo);fill:var(--accent)">${balls}</g>`, { vb: '0 0 1100 620' })}<div class="fill center hero a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div>`, 1100, 620, accentStyle(p)), css: '.rbx .mball{animation-name:rbx-mball;animation-timing-function:ease-in-out}@keyframes rbx-mball{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(90px,-40px) scale(1.15)}66%{transform:translate(-70px,50px) scale(.9)}}' };
    },
  }),
  bit({
    id: 'blob-cursor', name: 'Blob Cursor', category: 'animation', level: 'basic',
    about: 'A soft blob replaces the cursor and eases after it.',
    video: 'Three blobs of decreasing size follow the scripted path with increasing lag, then settle behind the heading.',
    use: 'Friendly explainers, onboarding, wellness apps.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Blob Cursor' }, seconds: 4, tags: ['cursor', 'soft'],
    build: (p, ctx) => {
      const ptr = pointerMoment('blob', [{ x: 120, y: 520 }, { x: 640, y: 180 }, { x: 550, y: 310 }], 0.3, 1.5, false);
      const blobs = [0, 1, 2].map((i) => `<i class="blob a" style="${d(0.3 + i * 0.1)};animation-name:rbx-ptr-blob;animation-duration:1.5s;width:${px(120 - i * 30)};height:${px(120 - i * 30)};opacity:${(0.8 - i * 0.2).toFixed(1)}"></i>`).join('');
      return { html: scene(`${blobs}<div class="fill center hero a rise" style="${d(1.4)}">${esc(textOf(p, ctx))}</div>`), css: `${ptr.css}.rbx .blob{position:absolute;left:${px(-60)};top:${px(-60)};border-radius:50%;background:var(--accent);filter:blur(${px(4)});animation-timing-function:var(--ei)}` };
    },
  }),
  bit({
    id: 'star-border', name: 'Star Border', category: 'animation', level: 'basic',
    about: 'A moving star-light gradient traces the element\'s border.',
    video: 'An oversized conic gradient spins behind a masked border, so a light travels around the card edge on a loop.',
    use: 'Awards, wins, premium offers, featured cards.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Star Border', kicker: 'FEATURED' }, seconds: 5, tags: ['border', 'loop'],
    build: (p, ctx) => ({
      html: scene(`<div class="fill center"><div class="a pop sbwrap" style="${d(0.05)}"><div class="sbspin loop spin" style="animation-duration:${(4 / speedOf(p)).toFixed(1)}s"></div>${card(p, ctx, 'sbinner')}</div></div>`),
      css: `.rbx .sbwrap{position:relative;padding:${px(3)};border-radius:${px(27)};overflow:hidden}.rbx .sbspin{position:absolute;left:50%;top:50%;width:${px(1600)};height:${px(1600)};margin:${px(-800)} 0 0 ${px(-800)};background:conic-gradient(from 0deg,transparent 0 62%,var(--accent) 70%,#fff 74%,var(--accent) 78%,transparent 86%)}.rbx .sbinner{position:relative;z-index:1}`,
    }),
  }),
];
